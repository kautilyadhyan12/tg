// THE CARDHOLDER TOLD (ROADMAP 18d-iii-ii-a; spec Part 3 §14.8): with a bill's first decline, the
// worker emails whoever's card it is, from the gym, that the payment did not go through, whether the
// card will be tried again, and to pay another way within 7 days (Visa; Square: "When possible,
// inform buyers when a decline occurs"). One email a bill, through the invitations' sender, after
// the staff invitations each minute.
//
// It is owed to the cardholder, so neither the app's daily cap nor an unsubscribe from the gym's
// other emails holds it; an address that bounced or was refused anywhere is never sent to, and a
// bill paid meanwhile sends nothing. The bill tells staff when nobody was emailed.
import { CARD_RETRY, addDays, authEmailSchema, cardDeclineClassOf, cardDeclineReasonOf, cardName, formatMinor, leadFirstName, leadGreeting, type CardDeclineReason } from "@app/shared";
import type { Sql } from "postgres";
import type { InviteEmail, InviteTransport } from "../../../email/resend.js";
import { cardDeclinedEmail, memberInviteFrom } from "../../../email/templates.js";
import { emailHmac } from "../invites/address.js";
import { cleanGymText, GYM_TEXT_IN_EMAIL_CHARS, gymNameForEmail } from "../invites/gymText.js";
import { INVITE_SENDING } from "../invites/sender.js";
import type { InviteSender, InviteSettings } from "../invites/settings.js";
import * as repo from "./cardNoticesRepo.js";

/** The tag the email carries: its row in `gym_card_decline_notices`. */
export const CARD_NOTICE_SEND_TAG = "card_notice_send";

export interface CardNoticeDeps {
  sql: Sql;
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
  settings: InviteSettings;
  sender: InviteSender;
  transport: InviteTransport;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Only these gyms' emails, for a test that shares its database; production passes nothing. */
  gymIds?: readonly string[];
}

export interface CardNoticeRun {
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
  stoppedByProvider: boolean;
}

/** Wait before the next try, by how many tries have been made. */
const RETRY_AFTER_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];

/** The decline's reason as the cardholder reads it. */
const REASON_WORDS: Readonly<Record<CardDeclineReason, string>> = {
  insufficient_funds: "There wasn't enough money on the card.",
  expired: "The card has expired.",
  call_bank: "Your bank asks you to contact them.",
  closed: "The card's account is closed.",
  declined: "Your bank didn't give a reason.",
};

type Tally = "sent" | "skipped" | "failed" | "retried";

/** Send what is due, up to one run's worth. Safe to run twice at once. */
export async function sendDueCardNotices(deps: CardNoticeDeps): Promise<CardNoticeRun> {
  const run: CardNoticeRun = { sent: 0, skipped: 0, failed: 0, retried: 0, stoppedByProvider: false };
  if (deps.settings.paused) return run;
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

async function sendOne(deps: CardNoticeDeps, claim: repo.ClaimedNotice): Promise<Tally | "stop"> {
  const now = deps.now();
  // It may already have gone and Resend has forgotten, or will soon forget, its key.
  if (claim.maybeSentAt !== null && now.getTime() - claim.maybeSentAt.getTime() >= INVITE_SENDING.unknownAfterMs) {
    return await finish(deps, claim, { kind: "failed", reason: "send_unknown" });
  }
  const email = claim.email;
  if (email === null || !authEmailSchema.safeParse(email).success) return await stop(deps, claim, "address_invalid");
  const facts = await repo.noticeFacts(deps.sql, claim);
  if (facts.gym === null || !facts.gym.active || facts.charge === null) return await stop(deps, claim, "gym_gone");
  if (facts.bill === null) return await stop(deps, claim, "paid");
  const gymName = gymNameForEmail(facts.gym.name);
  if (gymName === "") return await stop(deps, claim, "gym_gone");
  const hmac = emailHmac(deps.settings.hmacKey, email);
  const message = noticeMessage(deps, claim, email, gymName, facts.gym, facts.bill, facts.charge);
  if (!(await repo.markMaybeSent(deps.sql, claim, hmac, now))) {
    // Paid meanwhile, the address blocked, or the claim no longer this run's.
    const again = await repo.noticeFacts(deps.sql, claim);
    return await stop(deps, claim, again.bill === null ? "paid" : "address_blocked");
  }
  const result = await deps.transport.send(message);
  switch (result.kind) {
    case "sent":
      return await finish(deps, claim, { kind: "sent", providerId: result.id });
    case "not_sent": {
      deps.log.warn({ event: "card_notice.send_refused", noticeId: claim.id, gymId: claim.gymId, status: result.status }, "the email service refused a payment notice; it waits");
      const held = await hold(deps, claim, result.status === 400 || result.status === 422 ? "provider_refused" : "provider_unavailable");
      // A key, an account or a rate problem is every email's: the run stops.
      return held === "retried" && [401, 403, 429].includes(result.status) ? "stop" : held;
    }
    case "unclear": {
      deps.log.warn({ event: "card_notice.send_unclear", noticeId: claim.id, gymId: claim.gymId, status: result.status }, "a payment notice may not have gone; it will be tried again under the same key");
      await repo.retryNotice(deps.sql, claim, new Date(now.getTime() + retryAfter(claim)));
      return "retried";
    }
  }
}

const retryAfter = (claim: repo.ClaimedNotice): number => RETRY_AFTER_MS[Math.min(claim.attempts - 1, RETRY_AFTER_MS.length - 1)] ?? 60_000;

/** "October 26" in the US and Canada, "26 October" elsewhere: the gym's own country's way. */
function dayWords(day: string, country: string | null): string {
  return new Intl.DateTimeFormat(`en-${country ?? "US"}`, { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00Z`));
}

/** The email's words, from the facts read just now. */
export function noticeLines(
  gymName: string,
  gym: { country: string | null; contactEmail: string | null; contactPhone: string | null },
  bill: { fee: string | null },
  charge: NonNullable<repo.NoticeFacts["charge"]>,
): Omit<Parameters<typeof cardDeclinedEmail>[0], "to"> {
  const amount = formatMinor(charge.amountMinor, charge.currency);
  const forName = charge.forName === null ? "" : cleanGymText(charge.forName, GYM_TEXT_IN_EMAIL_CHARS);
  const whose = forName === "" ? "your" : `${forName}'s`;
  const purpose = bill.fee === "freeze" ? `${whose} freeze fee` : `${whose} membership`;
  const card = cardName(charge);
  const code = charge.code ?? "UNKNOWN";
  const next =
    // Charged again since: what the app does next is no longer this email's to say.
    charge.newer
      ? null
      : charge.nextTryOn !== null
        ? `We'll try the card again on ${dayWords(charge.nextTryOn, gym.country)}.`
        : cardDeclineClassOf(code) === "new_card"
          ? "This card can't be charged again, so please pay another way."
          : "We won't try the card again by ourselves. Your bank can tell you more.";
  const contact = [gym.contactPhone === null ? null : `call ${gym.contactPhone}`, gym.contactEmail === null ? null : `email ${gym.contactEmail}`].filter((x): x is string => x !== null);
  return {
    gymName,
    greeting: leadGreeting(cleanGymText(leadFirstName(charge.holderName ?? ""), GYM_TEXT_IN_EMAIL_CHARS)),
    what: `Your card payment of ${amount} to ${gymName} for ${purpose} didn't go through.`,
    why: `${card} was declined on ${dayWords(charge.on, gym.country)}. ${REASON_WORDS[cardDeclineReasonOf(code)]}`,
    next,
    payBy: `Please pay by ${dayWords(addDays(charge.on, CARD_RETRY.noticeDays), gym.country)}: at the front desk, or with another card.`,
    contact: contact.length === 0 ? null : `Questions? You can ${contact.join(" or ")}.`,
  };
}

function noticeMessage(
  deps: CardNoticeDeps,
  claim: repo.ClaimedNotice,
  email: string,
  gymName: string,
  gym: NonNullable<repo.NoticeFacts["gym"]>,
  bill: NonNullable<repo.NoticeFacts["bill"]>,
  charge: NonNullable<repo.NoticeFacts["charge"]>,
): InviteEmail {
  const letter = cardDeclinedEmail({ to: email, ...noticeLines(gymName, gym, bill, charge) });
  return {
    ...letter,
    from: deps.sender.from === null ? "" : memberInviteFrom(deps.sender.from, gymName),
    headers: {},
    idempotencyKey: `card-notice-${claim.id}`,
    tags: [{ name: CARD_NOTICE_SEND_TAG, value: claim.id }],
    ...(gym.contactEmail === null ? {} : { replyTo: gym.contactEmail }),
  };
}

/** The email will not be sent. If an earlier attempt may have reached Resend, that is what it says,
 *  never "not sent". */
async function stop(deps: CardNoticeDeps, claim: repo.ClaimedNotice, reason: string): Promise<Tally> {
  return claim.maybeSentAt === null ? await finish(deps, claim, { kind: "skipped", reason }) : await finish(deps, claim, { kind: "failed", reason: "send_unknown" });
}

/** It did not go this time: it waits. A week of that gives it up. */
async function hold(deps: CardNoticeDeps, claim: repo.ClaimedNotice, reason: string): Promise<Tally> {
  const now = deps.now();
  if (claim.maybeSentAt === null && now.getTime() - claim.createdAt.getTime() >= INVITE_SENDING.holdMs) return await finish(deps, claim, { kind: "failed", reason });
  await repo.retryNotice(deps.sql, claim, new Date(now.getTime() + retryAfter(claim)));
  return "retried";
}

async function finish(deps: CardNoticeDeps, claim: repo.ClaimedNotice, outcome: repo.NoticeOutcome): Promise<Tally> {
  if (!(await repo.finishNotice(deps.sql, claim, outcome, deps.now()))) {
    deps.log.warn({ event: "card_notice.lease_lost", noticeId: claim.id, gymId: claim.gymId }, "a payment notice's lease was taken over");
    return "retried";
  }
  return outcome.kind;
}
