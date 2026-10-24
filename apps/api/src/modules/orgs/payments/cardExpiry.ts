// A REMINDER BEFORE A CARD EXPIRES (ROADMAP 18d-iii-c; spec Part 3 §14.8; rulings/2026-10-21-money-plan.md):
// the gym's own choice, off until it switches it on in Bills. From 6 in the morning, gym time, on the
// first day of the month a card on file expires, the worker emails its holder from the gym, once for
// that card and expiry date, where the card pays for a membership that renews (the holder's own, or
// that of somebody they pay for). A card Square updates with a new date, or a new card, is not
// reminded about until its own last month. Through the invitations' sender, after the decline emails
// each minute.
//
// THE WORST THING here is somebody emailed about a card that is not theirs, or emailed by a gym that
// never switched these on. So the cardholder is the card's own record, the address is that record's,
// and the statement before each email reads the rule again (`stillDue` in `cardExpiryRepo.ts`): the
// gym's switch, the same card with the same date on the same record, in the account the gym is
// connected to, and the same address. An address that bounced or was refused anywhere is never sent
// to. A service email about the card they saved, so neither the app's daily cap nor an unsubscribe from
// the gym's other emails holds it, as the decline emails'.
import { authEmailSchema, cardName, leadFirstName, leadGreeting } from "@app/shared";
import type { Sql } from "postgres";
import type { InviteEmail, InviteTransport } from "../../../email/resend.js";
import { cardExpiringEmail, memberInviteFrom } from "../../../email/templates.js";
import { emailHmac } from "../invites/address.js";
import { cleanGymText, GYM_TEXT_IN_EMAIL_CHARS, gymNameForEmail } from "../invites/gymText.js";
import { INVITE_SENDING } from "../invites/sender.js";
import type { InviteSender, InviteSettings } from "../invites/settings.js";
import * as repo from "./cardExpiryRepo.js";
import type { SquareEnvironment } from "./square.js";

/** The tag the email carries: its row in `gym_card_expiry_notices`. */
export const CARD_EXPIRY_SEND_TAG = "card_expiry_send";

export interface CardExpiryDeps {
  sql: Sql;
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
  settings: InviteSettings;
  sender: InviteSender;
  transport: InviteTransport;
  /** The Square environment this server charges cards in; null where Square is not set up, and
   *  nothing new is written. */
  environment: SquareEnvironment | null;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Only these gyms' emails, for a test that shares its database; production passes nothing. */
  gymIds?: readonly string[];
}

export interface CardExpiryRun {
  /** Skipped for an address that can now be emailed (corrected, or no longer refused): written again. */
  revived: number;
  queued: number;
  sent: number;
  skipped: number;
  dropped: number;
  failed: number;
  retried: number;
  stoppedByProvider: boolean;
}

/** Wait before the next try, by how many tries have been made. */
const RETRY_AFTER_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];

type Tally = "sent" | "skipped" | "dropped" | "failed" | "retried";

/** Write the reminders that are due, then send what is due, up to one run's worth. Safe to run twice
 *  at once. */
export async function sendDueCardExpiryNotices(deps: CardExpiryDeps): Promise<CardExpiryRun> {
  const run: CardExpiryRun = { revived: 0, queued: 0, sent: 0, skipped: 0, dropped: 0, failed: 0, retried: 0, stoppedByProvider: false };
  if (deps.settings.paused) return run;
  if (deps.environment !== null) {
    run.revived = await reviveCorrected(deps);
    run.queued = await repo.queueDueNotices(deps.sql, { environment: deps.environment, now: deps.now(), gymIds: deps.gymIds ?? null });
  }
  for (let taken = 0; taken < INVITE_SENDING.perRun; taken++) {
    const claim = await repo.claimNextNotice(deps.sql, { now: deps.now(), leaseMs: INVITE_SENDING.leaseMs, gymIds: deps.gymIds ?? null });
    if (claim === null) break;
    const outcome = await sendOne(deps, claim);
    if (outcome === "stop") {
      run.retried += 1;
      run.stoppedByProvider = true;
      break;
    }
    run[outcome] += 1;
    if (outcome === "sent") await deps.sleep(INVITE_SENDING.gapMs);
  }
  return run;
}

/** A reminder skipped for its address, whose record has an address now that can be emailed, is taken
 *  off so the queue writes it again for that address. Answers how many. */
async function reviveCorrected(deps: CardExpiryDeps): Promise<number> {
  const skipped = (await repo.skippedForAddress(deps.sql, { now: deps.now(), gymIds: deps.gymIds ?? null })).flatMap((row) =>
    row.email !== null && authEmailSchema.safeParse(row.email).success ? [{ ...row, hmac: emailHmac(deps.settings.hmacKey, row.email) }] : [],
  );
  const blocked = await repo.blockedOf(
    deps.sql,
    skipped.map((row) => row.hmac),
  );
  const open = skipped.filter((row) => !blocked.has(row.hmac));
  for (const row of open) await repo.dropSkipped(deps.sql, row);
  return open.length;
}

async function sendOne(deps: CardExpiryDeps, claim: repo.ClaimedNotice): Promise<Tally | "stop"> {
  const now = deps.now();
  // It may already have gone and Resend has forgotten, or will soon forget, its key.
  if (claim.maybeSentAt !== null && now.getTime() - claim.maybeSentAt.getTime() >= INVITE_SENDING.unknownAfterMs) {
    return await finish(deps, claim, { kind: "failed", reason: "send_unknown" });
  }
  const email = claim.email;
  if (email === null || !authEmailSchema.safeParse(email).success) return await stop(deps, claim, "address_invalid");
  const hmac = emailHmac(deps.settings.hmacKey, email);
  const facts = await repo.noticeFacts(deps.sql, claim, now);
  if (!facts.due || facts.gym === null || facts.card === null) return await notDue(deps, claim, hmac);
  const gymName = gymNameForEmail(facts.gym.name);
  if (gymName === "") return await stop(deps, claim, "gym_gone");
  const message = noticeMessage(deps, claim, email, gymName, facts);
  if (!(await repo.markMaybeSent(deps.sql, claim, hmac, now))) return await notDue(deps, claim, hmac);
  const result = await deps.transport.send(message);
  switch (result.kind) {
    case "sent":
      return await finish(deps, claim, { kind: "sent", providerId: result.id });
    case "not_sent": {
      deps.log.warn({ event: "card_expiry.send_refused", noticeId: claim.id, gymId: claim.gymId, status: result.status }, "the email service refused a card expiry reminder; it waits");
      const held = await hold(deps, claim, result.status === 400 || result.status === 422 ? "provider_refused" : "provider_unavailable");
      // A key, an account or a rate problem is every email's: the run stops.
      return held === "retried" && [401, 403, 429].includes(result.status) ? "stop" : held;
    }
    case "unclear": {
      deps.log.warn({ event: "card_expiry.send_unclear", noticeId: claim.id, gymId: claim.gymId, status: result.status }, "a card expiry reminder may not have gone; it will be tried again under the same key");
      await repo.retryNotice(deps.sql, claim, new Date(now.getTime() + retryAfter(claim)));
      return "retried";
    }
  }
}

const retryAfter = (claim: repo.ClaimedNotice): number => RETRY_AFTER_MS[Math.min(claim.attempts - 1, RETRY_AFTER_MS.length - 1)] ?? 60_000;

/** "November 2026": the card's last month. */
function monthWords(month: number, year: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, 15)));
}

/** "your membership", "Tom Lee's membership", "memberships for you and Tom Lee", "memberships for Tom
 *  Lee, Ann Lee and 2 others". */
export function paysForWords(self: boolean, others: readonly string[]): string {
  const names = others.map((name) => cleanGymText(name, GYM_TEXT_IN_EMAIL_CHARS)).map((name) => (name === "" ? "somebody on your account" : name));
  if (names.length === 0) return "your membership";
  if (!self && names.length === 1) return `${names[0] ?? ""}'s membership`;
  const shown = [...(self ? ["you"] : []), ...names];
  const listed = shown.length > 4 ? [...shown.slice(0, 3), `${String(shown.length - 3)} others`] : shown;
  const last = listed[listed.length - 1] ?? "";
  return `memberships for ${listed.length === 1 ? last : `${listed.slice(0, -1).join(", ")} and ${last}`}`;
}

/** The email's words, from the facts read just now. */
export function noticeLines(gymName: string, facts: repo.NoticeFacts): Omit<Parameters<typeof cardExpiringEmail>[0], "to"> {
  const gym = facts.gym ?? { contactEmail: null, contactPhone: null };
  const card = facts.card ?? { brand: "", last4: "0000", expMonth: 1, expYear: 2000 };
  const contact = [gym.contactPhone === null ? null : `call ${gym.contactPhone}`, gym.contactEmail === null ? null : `email ${gym.contactEmail}`].filter((x): x is string => x !== null);
  return {
    gymName,
    greeting: leadGreeting(cleanGymText(leadFirstName(facts.holderName ?? ""), GYM_TEXT_IN_EMAIL_CHARS)),
    // "Visa ending in 1111", as a card is named to its holder.
    what: `Your ${cardName(card).replace(" ending ", " ending in ")} expires at the end of ${monthWords(card.expMonth, card.expYear)}.`,
    paysFor: `It pays for ${paysForWords(facts.paysForSelf, facts.paysForOthers)} at ${gymName}.`,
    ask: `To keep your payments going, please give ${gymName} your new card at the front desk before then.`,
    contact: contact.length === 0 ? null : `If you have any questions, you can ${contact.join(" or ")}.`,
  };
}

function noticeMessage(deps: CardExpiryDeps, claim: repo.ClaimedNotice, email: string, gymName: string, facts: repo.NoticeFacts): InviteEmail {
  const letter = cardExpiringEmail({ to: email, ...noticeLines(gymName, facts) });
  const replyTo = facts.gym?.contactEmail ?? null;
  return {
    ...letter,
    from: deps.sender.from === null ? "" : memberInviteFrom(deps.sender.from, gymName),
    headers: {},
    idempotencyKey: `card-expiry-${claim.id}`,
    tags: [{ name: CARD_EXPIRY_SEND_TAG, value: claim.id }],
    ...(replyTo === null ? {} : { replyTo }),
  };
}

/** No longer due by the rule (switched off, another card or date, nothing renewing on it, another
 *  address on the record, the record gone), or the address blocked. Never handed over: taken off, so
 *  it is written again if it becomes due again; a blocked address is kept as skipped. */
async function notDue(deps: CardExpiryDeps, claim: repo.ClaimedNotice, hmac: string): Promise<Tally> {
  if (claim.maybeSentAt !== null) return await finish(deps, claim, { kind: "failed", reason: "send_unknown" });
  if (await repo.addressBlocked(deps.sql, hmac)) return await finish(deps, claim, { kind: "skipped", reason: "address_blocked" });
  if (!(await repo.dropNotice(deps.sql, claim))) {
    deps.log.warn({ event: "card_expiry.lease_lost", noticeId: claim.id, gymId: claim.gymId }, "a card expiry reminder's lease was taken over");
    return "retried";
  }
  return "dropped";
}

/** The email will not be sent. If an earlier attempt may have reached Resend, that is what it says,
 *  never "not sent". */
async function stop(deps: CardExpiryDeps, claim: repo.ClaimedNotice, reason: string): Promise<Tally> {
  return claim.maybeSentAt === null ? await finish(deps, claim, { kind: "skipped", reason }) : await finish(deps, claim, { kind: "failed", reason: "send_unknown" });
}

/** It did not go this time: it waits. A week of that gives it up. */
async function hold(deps: CardExpiryDeps, claim: repo.ClaimedNotice, reason: string): Promise<Tally> {
  const now = deps.now();
  if (claim.maybeSentAt === null && now.getTime() - claim.createdAt.getTime() >= INVITE_SENDING.holdMs) return await finish(deps, claim, { kind: "failed", reason });
  await repo.retryNotice(deps.sql, claim, new Date(now.getTime() + retryAfter(claim)));
  return "retried";
}

async function finish(deps: CardExpiryDeps, claim: repo.ClaimedNotice, outcome: repo.NoticeOutcome): Promise<Tally> {
  if (!(await repo.finishNotice(deps.sql, claim, outcome, deps.now()))) {
    deps.log.warn({ event: "card_expiry.lease_lost", noticeId: claim.id, gymId: claim.gymId }, "a card expiry reminder's lease was taken over");
    return "retried";
  }
  return outcome.kind;
}
