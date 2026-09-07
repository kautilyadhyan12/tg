// SIGN-IN BY 6-DIGIT EMAIL CODE — the rules, in one place (Kd 2026-09-07):
//   · a code lasts ten minutes and a resend REPLACES it
//   · the resend is offered after sixty seconds
//   · two UNUSED codes per address per rolling day (the first and its one
//     resend); after that the address waits until tomorrow. A code that
//     signed the person in does not count (Kd 2026-09-08): signing in twice
//     in a day is normal, and the cap is against emails nobody proved
//   · five wrong guesses kill the code
//   · the stored value is an HMAC, never the code; single use; one UPDATE
//   · asking for a code never says whether the address has an account, and
//     never creates one — the account is created when the code is PROVED
//
// The same mechanism serves two purposes: the sign-in door and the code
// Settings asks for before deleting an account. They are counted separately
// (purpose is in every key), so asking to delete never spends a sign-in.
import { timingSafeEqual } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "postgres";
import { SIGN_IN_CODE_RULES } from "@app/shared";
import type { AppConfig } from "../../config.js";
import { AuthError } from "./errors.js";
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

function tooSoon(retryAfterMs: number): AuthError {
  const seconds = roundUpSeconds(retryAfterMs);
  return new AuthError(
    429,
    "code_too_soon",
    `Please wait ${String(seconds)} second${seconds === 1 ? "" : "s"} before asking for a new code.`,
    seconds,
  );
}

/** The two send-side rules, decided over this address's recent codes (newest
 *  first, used ones included). Runs INSIDE the issue transaction, under the
 *  address's lock, so two requests arriving together cannot both read "one so
 *  far" and both issue.
 *   · The day cap counts only codes nobody proved: a code that signed the
 *     person in is a sign-in, not a send to cap (Kd 2026-09-08).
 *   · The sixty-second gap is measured from the newest code of ANY state — a
 *     sign-in does not open the door to an immediate resend. */
function refuseIfOverRules(recent: SignInCodeRow[], now: number): void {
  const unproved = recent.filter((r) => r.usedAt === null);
  if (unproved.length >= SIGN_IN_CODE_RULES.maxCodesPerDay) {
    const oldest = unproved[unproved.length - 1];
    const retryAt = (oldest?.createdAt.getTime() ?? now) + DAY_MS;
    throw tooManyToday(retryAt - now);
  }
  const latest = recent[0];
  if (latest !== undefined) {
    const gapMs = SIGN_IN_CODE_RULES.resendAfterSeconds * 1000;
    const sinceLast = now - latest.createdAt.getTime();
    if (sinceLast < gapMs) throw tooSoon(gapMs - sinceLast);
  }
}

/** Ask for a code. Enforces the day cap and the resend gap, mints and stores
 *  the code (hashed), sends it, and takes the row back if the send fails so a
 *  failed email never spends one of the day's two. Same outcome whether or not
 *  the address has an account. */
export async function requestCode(
  deps: CodeDeps,
  input: { email: string; purpose: CodePurpose },
  send: CodeSender,
): Promise<{ resendAfterSeconds: number; expiresInSeconds: number }> {
  const now = Date.now();
  const code = mintSixDigitCode();
  const id = await repo.issueCode(deps.sql, {
    email: input.email,
    purpose: input.purpose,
    codeHash: signInCodeHash(deps.config.JWT_SECRET, { purpose: input.purpose, email: input.email, code }),
    expiresAt: new Date(now + SIGN_IN_CODE_RULES.ttlSeconds * 1000),
    pruneBefore: new Date(now - PRUNE_AFTER_MS),
    since: new Date(now - DAY_MS),
    check: (recent) => {
      refuseIfOverRules(recent, now);
    },
  });

  try {
    await send(input.email, code);
  } catch (err) {
    // The row is withdrawn so the failed send does not count against the day
    // — and the person is told, plainly, rather than left waiting for an email
    // that is not coming. R3.10: error CLASS only; provider errors echo
    // addresses.
    await repo.deleteCode(deps.sql, id);
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

const invalidCode = () =>
  new AuthError(400, "invalid_code", "That code is wrong or has expired. Ask for a new one.");

/** Prove a code. Wrong, expired, used, or no code at all → the same 400 (with
 *  the tries left, when there are any). Right → the code is consumed, single
 *  use, and the caller may act for the address. */
export async function redeemCode(
  deps: CodeDeps,
  input: { email: string; purpose: CodePurpose; code: string },
): Promise<void> {
  const live = await repo.findLiveCode(deps.sql, input.email, input.purpose);
  if (live === null) throw invalidCode();
  // DEFENCE IN DEPTH, not a guarantee: `recordFailedAttempt` expires the row in
  // the same statement that counts the fifth guess, so `findLiveCode` never
  // returns an exhausted code and this line is unreachable today. It stays so
  // that a future writer who changes that statement cannot open the door by
  // accident; no test can observe it, and none claims to.
  if (live.attempts >= SIGN_IN_CODE_RULES.maxAttempts) throw invalidCode();

  const expected = Buffer.from(live.codeHash, "hex");
  const presented = Buffer.from(
    signInCodeHash(deps.config.JWT_SECRET, { purpose: input.purpose, email: input.email, code: input.code }),
    "hex",
  );
  const matches = expected.length === presented.length && timingSafeEqual(expected, presented);
  if (!matches) {
    const attempts = await repo.recordFailedAttempt(deps.sql, live.id, SIGN_IN_CODE_RULES.maxAttempts);
    const left = SIGN_IN_CODE_RULES.maxAttempts - attempts;
    if (left <= 0) {
      throw new AuthError(400, "invalid_code", "Too many wrong tries. Ask for a new code.");
    }
    throw new AuthError(
      400,
      "invalid_code",
      `That code is not right. You have ${String(left)} ${left === 1 ? "try" : "tries"} left.`,
    );
  }
  // Two presentations of the right code at once: exactly one wins.
  if (!(await repo.consumeCode(deps.sql, live.id))) throw invalidCode();
}
