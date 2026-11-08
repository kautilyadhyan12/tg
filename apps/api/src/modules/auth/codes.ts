// SIGN-IN BY 6-DIGIT EMAIL CODE — the rules, in one place (Kd 2026-09-07):
//   · a code lasts ten minutes and a resend REPLACES it
//   · the resend is offered after sixty seconds
//   · three UNUSED codes per address per rolling day (the first and two
//     resends, Kd 2026-10-13); past them the sign-in door asks for the robot check and
//     sends one more (Kd 2026-10-27: "keep 3 and if asks again then 1 after robot check"), then the address waits until tomorrow. A code that
//     signed the person in does not count (Kd 2026-09-08): signing in twice
//     in a day is normal, and the cap is against emails nobody proved
//   · five wrong guesses kill the code; every wrong code is told in one sentence, so a
//     stranger's guess never learns that somebody has a code waiting
//   · the stored value is an HMAC, never the code; single use; one UPDATE
//   · asking for a code never says whether the address has an account, and
//     never creates one — the account is created when the code is PROVED
//
// The same mechanism serves four purposes: the sign-in door, the code
// Settings asks for before deleting an account (bound to the account), the one the website's Delete
// your account page sends to the address typed, and the code sent to a NEW
// address before the account moves to it. They are counted separately
// (purpose is in every key), so asking to delete never spends a sign-in.
// A code may be bound to an account (`boundTo`, change email's): it is kept,
// counted, ended and found as that account's, and the account's id is in its
// hash, so only the account that asked for it can prove it, and another account
// asking for the same address never touches it.
import { timingSafeEqual } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "postgres";
import { SIGN_IN_CODE_RULES } from "@app/shared";
import type { AppConfig } from "../../config.js";
import { AuthError, WrongGuessError } from "./errors.js";
import * as repo from "./repo.js";
import type { CodePurpose, SignInCodeRow } from "./repo.js";
import { mintSixDigitCode, signInCodeHash } from "./tokens.js";

export type { CodePurpose } from "./repo.js";

export interface CodeDeps {
  sql: Sql;
  config: AppConfig;
  log: FastifyBaseLogger;
}

/** How a code reaches the person. Injected per purpose so the two emails have
 *  different words, and so tests can capture the code (it is stored hashed —
 *  the database cannot give it back, by design). */
export type CodeSender = (email: string, code: string) => Promise<void>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Rows are pruned two days after creation — twice the cap window, so a clock
 *  skew can never prune a row the cap still needs. */
const PRUNE_AFTER_MS = 2 * DAY_MS;

const roundUpSeconds = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));

function tooManyToday(retryAfterMs: number): AuthError {
  const hours = Math.max(1, Math.ceil(retryAfterMs / (60 * 60 * 1000)));
  return new AuthError(
    429,
    "code_limit",
    `You have asked for too many codes today. Try again in about ${String(hours)} hour${hours === 1 ? "" : "s"}.`,
    roundUpSeconds(retryAfterMs),
  );
}

/** Past the day's free codes: the sign-in door answers with the robot check. */
export class RobotCheckNeeded extends Error {
  constructor() {
    super("past the day's free codes, the robot check is needed");
    this.name = "RobotCheckNeeded";
  }
}

function tooSoon(retryAfterMs: number): AuthError {
  const seconds = roundUpSeconds(retryAfterMs);
  return new AuthError(
    429,
    "code_too_soon",
    `Please wait ${String(seconds)} second${seconds === 1 ? "" : "s"} before asking for a new code.`,
    seconds,
  );
}

/** The purpose as the hash reads it: an account's id joins it when the code is bound to one. */
const hashPurpose = (purpose: CodePurpose, boundTo: string | undefined): string =>
  boundTo === undefined ? purpose : `${purpose}:${boundTo}`;

/** Change-email codes an address may be sent in a day before it takes no NEW account asking for it:
 *  each account's own three are counted apart, so without this a crowd of accounts could fill one
 *  inbox. An account that asked for the address before the cap filled keeps its own three, so a
 *  crowd that comes after cannot stop the address's owner (item 19's security pass, L1); an inbox
 *  gets at most this many plus two more for each account that was in before it filled. */
export const CHANGE_EMAIL_CODES_PER_ADDRESS_PER_DAY = 10;

/** The address's own ceiling, over every account's unproved codes for it (newest first). It names
 *  the address, never the person asking, and reads the same whether the address has an account. */
function refuseIfAddressFull(everyone: Date[], now: number): void {
  const cap = CHANGE_EMAIL_CODES_PER_ADDRESS_PER_DAY;
  if (everyone.length < cap) return;
  const retryAt = (everyone[cap - 1]?.getTime() ?? now) + DAY_MS;
  throw new AuthError(429, "address_limit", "This address has had too many codes today. Try again tomorrow.", roundUpSeconds(retryAt - now));
}

/** The two send-side rules, decided over this address's recent codes (newest
 *  first, used ones included). Runs INSIDE the issue transaction, under the
 *  address's lock, so two requests arriving together cannot both read "one so
 *  far" and both issue.
 *   · The day cap counts only codes nobody proved: a code that signed the
 *     person in is a sign-in, not a send to cap (Kd 2026-09-08).
 *   · The sixty-second gap is measured from the newest code of ANY state — a
 *     sign-in does not open the door to an immediate resend. */
function refuseIfOverRules(recent: SignInCodeRow[], now: number, robot: RobotAnswer | undefined): void {
  const unproved = recent.filter((r) => r.usedAt === null);
  // A door with no robot check (the delete-account code) stops at the free three.
  const cap = robot === undefined ? SIGN_IN_CODE_RULES.maxCodesPerDay : SIGN_IN_CODE_RULES.maxCodesPerDayWithRobotCheck;
  if (unproved.length >= cap) {
    // The day's window opens again when the cap-th newest of them is a day old.
    const freeing = unproved[cap - 1];
    const retryAt = (freeing?.createdAt.getTime() ?? now) + DAY_MS;
    throw tooManyToday(retryAt - now);
  }
  const latest = recent[0];
  if (latest !== undefined) {
    const gapMs = SIGN_IN_CODE_RULES.resendAfterSeconds * 1000;
    const sinceLast = now - latest.createdAt.getTime();
    if (sinceLast < gapMs) throw tooSoon(gapMs - sinceLast);
  }
  if (robot === "not_passed" && unproved.length >= SIGN_IN_CODE_RULES.maxCodesPerDay) throw new RobotCheckNeeded();
}

/** Whether this request passed the robot check; a door with none passes undefined. */
export type RobotAnswer = "passed" | "not_passed";

/** Ask for a code. Enforces the day cap and the resend gap, mints and stores
 *  the code (hashed), sends it, and takes the row back if the send fails so a
 *  failed email never spends one of the day's three. Same outcome whether or not
 *  the address has an account. */
export async function requestCode(
  deps: CodeDeps,
  input: { email: string; purpose: CodePurpose; robot?: RobotAnswer; boundTo?: string },
  send: CodeSender,
): Promise<{ resendAfterSeconds: number; expiresInSeconds: number }> {
  const now = Date.now();
  const code = mintSixDigitCode();
  const issued = await repo.issueCode(deps.sql, {
    email: input.email,
    purpose: input.purpose,
    codeHash: signInCodeHash(deps.config.JWT_SECRET, { purpose: hashPurpose(input.purpose, input.boundTo), email: input.email, code }),
    expiresAt: new Date(now + SIGN_IN_CODE_RULES.ttlSeconds * 1000),
    pruneBefore: new Date(now - PRUNE_AFTER_MS),
    since: new Date(now - DAY_MS),
    userId: input.boundTo ?? null,
    check: (recent, everyone) => {
      refuseIfOverRules(recent, now, input.robot);
      if (input.boundTo !== undefined && recent.length === 0) refuseIfAddressFull(everyone, now);
    },
  });

  try {
    await send(input.email, code);
  } catch (err) {
    // The row is withdrawn so the failed send does not count against the day
    // — and the person is told, plainly, rather than left waiting for an email
    // that is not coming. R3.10: error CLASS only; provider errors echo
    // addresses.
    await repo.withdrawCode(deps.sql, issued);
    deps.log.warn(
      { errName: err instanceof Error ? err.name : typeof err, event: "email.code.send_failed", purpose: input.purpose },
      "code email send failed",
    );
    throw new AuthError(503, "code_send_failed", "We could not send the code. Please try again in a minute.");
  }

  return {
    resendAfterSeconds: SIGN_IN_CODE_RULES.resendAfterSeconds,
    expiresInSeconds: SIGN_IN_CODE_RULES.ttlSeconds,
  };
}

/** Whether this exact code proved this address within a code's life: the same press sent again
 *  after its answer was lost. Only the holder of the code can learn anything from it. */
export async function provedLately(deps: CodeDeps, input: { email: string; purpose: CodePurpose; code: string }): Promise<boolean> {
  const presented = Buffer.from(
    signInCodeHash(deps.config.JWT_SECRET, { purpose: hashPurpose(input.purpose, undefined), email: input.email, code: input.code }),
    "hex",
  );
  const since = new Date(Date.now() - SIGN_IN_CODE_RULES.ttlSeconds * 1000);
  const hashes = await repo.findProvedCodeHashes(deps.sql, input.email, input.purpose, since);
  return hashes.some((hash) => {
    const stored = Buffer.from(hash, "hex");
    return stored.length === presented.length && timingSafeEqual(stored, presented);
  });
}

/** One sentence for a wrong, expired, used or burned code and for an address with none: a
 *  count of tries left told a stranger that somebody there had a code waiting (the
 *  security pass on item 12, L3). */
export const WRONG_CODE_WORDS = "That code didn’t work. Check it and try again, or ask for a new one.";
const invalidCode = () => new AuthError(400, "invalid_code", WRONG_CODE_WORDS);

/** Prove a code. Wrong, expired, used, or no code at all → the same 400. Right → the
 *  code is consumed, single use, and the caller may act for the address. */
export async function redeemCode(
  deps: CodeDeps,
  input: { email: string; purpose: CodePurpose; code: string; boundTo?: string },
): Promise<void> {
  const live = await repo.findLiveCode(deps.sql, input.email, input.purpose, input.boundTo ?? null);
  if (live === null) throw invalidCode();
  // The try is taken BEFORE the guess is compared, in one statement, so guesses sent
  // at the same moment get five tries between them, never one each. No try left:
  // nothing is compared.
  const attempts = await repo.takeAttempt(deps.sql, live.id, SIGN_IN_CODE_RULES.maxAttempts);
  if (attempts === null) throw invalidCode();

  const expected = Buffer.from(live.codeHash, "hex");
  const presented = Buffer.from(
    signInCodeHash(deps.config.JWT_SECRET, { purpose: hashPurpose(input.purpose, input.boundTo), email: input.email, code: input.code }),
    "hex",
  );
  const matches = expected.length === presented.length && timingSafeEqual(expected, presented);
  if (!matches) {
    if (SIGN_IN_CODE_RULES.maxAttempts - attempts <= 0) await repo.expireCode(deps.sql, live.id);
    throw new WrongGuessError(400, "invalid_code", WRONG_CODE_WORDS);
  }
  // Two presentations of the right code at once: exactly one wins.
  if (!(await repo.consumeCode(deps.sql, live.id))) throw invalidCode();
}
