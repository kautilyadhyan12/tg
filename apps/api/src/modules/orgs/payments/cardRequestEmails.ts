// THE EMAIL SENT WITH EACH CARD REQUEST (ROADMAP 18d-vii; Kd, 2026-11-14: "a email also be sent as user may not
// see it in the app"). Ask to add card writes one email for each person asked whose record has an address that
// can be emailed, in the same transaction as their inbox message; the worker sends them one at a time through the
// invitations' sender, after the renewal reminders each minute.
//
// THE WORST THING here is somebody emailed about a card for a gym or a membership that is not theirs to pay. So
// the check before each email reads the record again under a hold (a card saved, a payer set or a removal
// waits) and works the ONE rule out again (`cardRequestPlan`'s first four reasons): still a current member,
// nobody else paying, no card on file in the account the gym takes cards through, still paying for a renewal,
// and the same address on the record. A service email about their membership, as the card expiry email is:
// neither the app's daily cap nor an unsubscribe from the gym's other emails holds it. An address that bounced or
// was refused anywhere never.
import { authEmailSchema, leadFirstName, leadGreeting } from "@app/shared";
import type { Sql } from "postgres";
import type { InviteEmail, InviteTransport } from "../../../email/resend.js";
import { cardRequestEmail, memberInviteFrom } from "../../../email/templates.js";
import { emailHmac } from "../invites/address.js";
import { cleanGymText, GYM_TEXT_IN_EMAIL_CHARS, gymNameForEmail } from "../invites/gymText.js";
import { INVITE_SENDING } from "../invites/sender.js";
import type { InviteSender, InviteSettings } from "../invites/settings.js";
import * as repo from "./cardRequestsRepo.js";
import type { SquareEnvironment } from "./square.js";

/** The tag the email carries: its row in `gym_card_request_emails`. */
export const CARD_REQUEST_SEND_TAG = "card_request_send";

export interface CardRequestEmailDeps {
  sql: Sql;
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
  settings: InviteSettings;
  sender: InviteSender;
  transport: InviteTransport;
  /** The Square environment cards are kept in; null where Square is not set up, and nothing is sent. */
  environment: SquareEnvironment | null;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Only these gyms' emails, for a test that shares its database; production passes nothing. */
  gymIds?: readonly string[];
}

export interface CardRequestEmailRun {
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

/** Send what is due, up to one run's worth. Safe to run twice at once. */
export async function sendDueCardRequestEmails(deps: CardRequestEmailDeps): Promise<CardRequestEmailRun> {
  const run: CardRequestEmailRun = { sent: 0, skipped: 0, dropped: 0, failed: 0, retried: 0, stoppedByProvider: false };
  if (deps.settings.paused) return run;
  for (let taken = 0; taken < INVITE_SENDING.perRun; taken++) {
    const claim = await repo.claimNextEmail(deps.sql, { now: deps.now(), leaseMs: INVITE_SENDING.leaseMs, gymIds: deps.gymIds ?? null });
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

interface Letter {
  name: string;
  own: string[];
  others: boolean;
}

/** Still due as it was written: the one rule's first four reasons, for this record, and the same address. */
function stillDue(row: repo.RequestStateRow | undefined, email: string): row is repo.RequestStateRow {
  return row !== undefined && !row.former && row.payerName === null && !row.hasCard && row.renews && (row.email ?? "").trim().toLowerCase() === email.trim().toLowerCase();
}

async function sendOne(deps: CardRequestEmailDeps, claim: repo.ClaimedEmail): Promise<Tally | "stop"> {
  const now = deps.now();
  // It may already have gone and Resend has forgotten, or will soon forget, its key.
  if (claim.maybeSentAt !== null && now.getTime() - claim.maybeSentAt.getTime() >= INVITE_SENDING.unknownAfterMs) {
    return await finish(deps, claim, { kind: "failed", reason: "send_unknown" });
  }
  const email = claim.email;
  if (email === null || !authEmailSchema.safeParse(email).success) return await stop(deps, claim, "address_invalid");
  const entryId = claim.entryId;
  if (entryId === null) return await stop(deps, claim, "record_gone");
  const hmac = emailHmac(deps.settings.hmacKey, email);
  const gym = await repo.gymContact(deps.sql, claim.gymId);
  const gymName = gym === null ? "" : gymNameForEmail(gym.name);
  if (gym === null || gymName === "") return await stop(deps, claim, "gym_gone");

  // The check and the mark in one hold: what is sent is what the record is at that moment.
  const checked = await deps.sql.begin(async (tx): Promise<Letter | "not_due" | "lost"> => {
    await repo.holdRecord(tx, claim.gymId, entryId);
    const account = await repo.cardsAccountOf(tx, deps.environment, claim.gymId);
    if (account === null) return "not_due";
    const [row] = await repo.requestStateOf(tx, claim.gymId, [entryId], account, now);
    if (!stillDue(row, email)) return "not_due";
    return (await repo.markEmailMaybeSent(tx, claim, hmac, now)) ? { name: row.name, own: row.ownTypes, others: row.paysForOthers } : "lost";
  });
  if (checked === "not_due" || checked === "lost") return await notDue(deps, claim, hmac);

  const result = await deps.transport.send(message(deps, claim, email, gymName, gym, checked));
  switch (result.kind) {
    case "sent":
      return await finish(deps, claim, { kind: "sent", providerId: result.id });
    case "not_sent": {
      deps.log.warn({ event: "card_request_email.send_refused", emailId: claim.id, gymId: claim.gymId, status: result.status }, "the email service refused a card request email; it waits");
      const held = await hold(deps, claim, result.status === 400 || result.status === 422 ? "provider_refused" : "provider_unavailable");
      // A key, an account or a rate problem is every email's: the run stops.
      return held === "retried" && [401, 403, 429].includes(result.status) ? "stop" : held;
    }
    case "unclear": {
      deps.log.warn({ event: "card_request_email.send_unclear", emailId: claim.id, gymId: claim.gymId, status: result.status }, "a card request email may not have gone; it will be tried again under the same key");
      await repo.retryEmail(deps.sql, claim, new Date(now.getTime() + retryAfter(claim)));
      return "retried";
    }
  }
}

const retryAfter = (claim: repo.ClaimedEmail): number => RETRY_AFTER_MS[Math.min(claim.attempts - 1, RETRY_AFTER_MS.length - 1)] ?? 60_000;

/** The email's words, from the record read just now: the one membership by name, else "your membership", or
 *  "the memberships you pay for", as the inbox message says it. */
export function cardRequestLines(gymName: string, gym: { contactEmail: string | null; contactPhone: string | null }, letter: Letter): Omit<Parameters<typeof cardRequestEmail>[0], "to"> {
  const clean = (text: string) => cleanGymText(text, GYM_TEXT_IN_EMAIL_CHARS);
  const [only] = letter.own;
  const named = !letter.others && letter.own.length === 1 && only !== undefined ? clean(only) : "";
  const contact = [gym.contactPhone === null ? null : `call ${gym.contactPhone}`, gym.contactEmail === null ? null : `email ${gym.contactEmail}`].filter((x): x is string => x !== null);
  return {
    gymName,
    greeting: leadGreeting(clean(leadFirstName(letter.name))),
    ask: letter.others
      ? `${gymName} asks you to add a card for the memberships you pay for.`
      : named === ""
        ? `${gymName} asks you to add a card for your membership.`
        : `${gymName} asks you to add a card for your ${named} membership.`,
    then: letter.others ? "Once it is added, it is charged automatically each time one of them renews." : "Once it is added, it is charged automatically each time the membership renews.",
    contact: contact.length === 0 ? null : `If you have any questions, you can ${contact.join(" or ")}.`,
    others: letter.others,
  };
}

function message(
  deps: CardRequestEmailDeps,
  claim: repo.ClaimedEmail,
  email: string,
  gymName: string,
  gym: { contactEmail: string | null; contactPhone: string | null },
  letter: Letter,
): InviteEmail {
  const letterWords = cardRequestEmail({ to: email, ...cardRequestLines(gymName, gym, letter) });
  return {
    ...letterWords,
    from: deps.sender.from === null ? "" : memberInviteFrom(deps.sender.from, gymName),
    headers: {},
    idempotencyKey: `card-request-${claim.id}`,
    tags: [{ name: CARD_REQUEST_SEND_TAG, value: claim.id }],
    ...(gym.contactEmail === null ? {} : { replyTo: gym.contactEmail }),
  };
}

/** No longer due as it was written (a card saved, somebody else pays, nothing renews, left, another address), or
 *  the address blocked. Never handed over: taken off; a blocked address is kept as skipped. */
async function notDue(deps: CardRequestEmailDeps, claim: repo.ClaimedEmail, hmac: string): Promise<Tally> {
  if (claim.maybeSentAt !== null) return await finish(deps, claim, { kind: "failed", reason: "send_unknown" });
  if ((await repo.blockedOf(deps.sql, [hmac])).size > 0) return await finish(deps, claim, { kind: "skipped", reason: "address_blocked" });
  if (!(await repo.dropEmail(deps.sql, claim))) {
    deps.log.warn({ event: "card_request_email.lease_lost", emailId: claim.id, gymId: claim.gymId }, "a card request email's lease was taken over");
    return "retried";
  }
  return "dropped";
}

/** The email will not be sent. If an earlier attempt may have reached Resend, that is what it says, never "not sent". */
async function stop(deps: CardRequestEmailDeps, claim: repo.ClaimedEmail, reason: string): Promise<Tally> {
  return claim.maybeSentAt === null ? await finish(deps, claim, { kind: "skipped", reason }) : await finish(deps, claim, { kind: "failed", reason: "send_unknown" });
}

/** It did not go this time: it waits. A week of that gives it up. */
async function hold(deps: CardRequestEmailDeps, claim: repo.ClaimedEmail, reason: string): Promise<Tally> {
  const now = deps.now();
  if (claim.maybeSentAt === null && now.getTime() - claim.createdAt.getTime() >= INVITE_SENDING.holdMs) return await finish(deps, claim, { kind: "failed", reason });
  await repo.retryEmail(deps.sql, claim, new Date(now.getTime() + retryAfter(claim)));
  return "retried";
}

async function finish(deps: CardRequestEmailDeps, claim: repo.ClaimedEmail, outcome: repo.EmailOutcome): Promise<Tally> {
  if (!(await repo.finishEmail(deps.sql, claim, outcome, deps.now()))) {
    deps.log.warn({ event: "card_request_email.lease_lost", emailId: claim.id, gymId: claim.gymId }, "a card request email's lease was taken over");
    return "retried";
  }
  return outcome.kind;
}
