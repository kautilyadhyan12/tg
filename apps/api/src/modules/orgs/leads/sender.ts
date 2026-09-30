// "Send them for me" (Part 3 §16.3; ROADMAP 20c-v-a; RULINGS 2026-09-27): the worker
// sends each lead's follow-up on its day, for the gym, through the invitations' checks,
// caps, kill switch and unsubscribe.
//
// No row waits in a queue for a lead: the lead's own due day is the queue. The worker
// takes a due lead under its lock and writes one row for that lead, tick and step — a
// unique row, so a second run or a second worker can never take the same email again.
// Just before sending it looks again, with the lead locked, and anything that changed
// (the tick off, a new status or address, Stop pressed, staff marking it sent) stops it.
//
// Resend's answer is one of three, as for invitations (`invites/sender.ts`). It went: the
// lead's count moves on. It did not go: it waits, and a week of that gives it back to
// staff. It may have gone: tried again under the same idempotency key, and after 20
// hours taken as sent, because the same email twice is worse than one missing.
import {
  authEmailSchema,
  GYM_POSTAL_ADDRESS_MAX_CHARS,
  LEAD_EMAILS_PER_MONTH,
  LEAD_SEND_TAG,
  leadFirstName,
  leadStatusSchema,
} from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { leadFollowUpEmail, memberInviteFrom } from "../../../email/templates.js";
import type { InviteEmail, InviteTransport } from "../../../email/resend.js";
import { dayInTz } from "../../gamification/streak.js";
import { insertAudit } from "../repo.js";
import { emailDomain, emailHmac, isSharedAddress } from "../invites/address.js";
import type { MailCheck } from "../invites/decide.js";
import { cleanGymText, gymNameForEmail } from "../invites/gymText.js";
import type { MailDomainCheck } from "../invites/mailDomain.js";
import { heldAddresses, suppressionsFor } from "../invites/repo.js";
import { INVITE_SENDING } from "../invites/sender.js";
import type { InviteSender, InviteSettings } from "../invites/settings.js";
import { inviteLinkToken } from "../invites/token.js";
import * as repo from "./emailsRepo.js";
import { followUpDueOn } from "./followUp.js";
import { decideLeadSend, type LeadSendDecision } from "./sendRule.js";

/** The most characters of a lead's first name an email shows. */
const FIRST_NAME_IN_EMAIL_CHARS = 30;

export interface LeadSenderDeps {
  sql: Sql;
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
  settings: InviteSettings;
  sender: InviteSender;
  transport: InviteTransport;
  mailDomain: MailDomainCheck;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Smaller numbers for a test; production passes nothing. */
  limits?: Partial<Record<"perRun" | "perMonth", number>>;
  /** Only these gyms' leads, for a test that shares its database with a developer's own
   *  gyms; production passes nothing. */
  gymIds?: readonly string[];
}

export interface LeadSendRun {
  paused: boolean;
  sent: number;
  /** Not sent to this address, with a reason staff see. */
  skipped: number;
  /** Not due any more when looked at again; forgotten. */
  dropped: number;
  failed: number;
  /** May have gone; tried again later. */
  retried: number;
  /** Did not go; waiting to be tried again. */
  held: number;
  stoppedByProvider: boolean;
  capped: boolean;
}

/** Wait before the next try, by how many tries have been made. */
const RETRY_AFTER_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];

/** What one email came to, as the run counts it. */
type Tally = "sent" | "skipped" | "failed" | "retried" | "held";

/** The first name an email greets, from a name anybody could type into the gym's page:
 *  cleaned as the gym's own words are (a web address taken out whole), then only letters,
 *  their marks, apostrophes and hyphens kept, which is all a first name needs — so no dot of
 *  any script, slash or colon is left to make one (the security pass over 20c, 2026-09-30). */
export function firstNameForEmail(fullName: string): string {
  return cleanGymText(leadFirstName(fullName), FIRST_NAME_IN_EMAIL_CHARS).replace(/[^\p{L}\p{M}'’-]/gu, "");
}

/** Send what is due, up to one run's worth. Safe to run twice at once. */
export async function sendDueLeadEmails(deps: LeadSenderDeps): Promise<LeadSendRun> {
  const run: LeadSendRun = {
    paused: deps.settings.paused,
    sent: 0,
    skipped: 0,
    dropped: 0,
    failed: 0,
    retried: 0,
    held: 0,
    stoppedByProvider: false,
    capped: false,
  };
  if (deps.settings.paused) return run;
  const perRun = deps.limits?.perRun ?? INVITE_SENDING.perRun;
  const perMonth = deps.limits?.perMonth ?? LEAD_EMAILS_PER_MONTH;
  const skipGyms: string[] = [];
  const skipLeads: string[] = [];
  for (let taken = 0; taken < perRun; taken++) {
    const claim = await repo.claimNextLeadSend(deps.sql, {
      now: deps.now(),
      leaseMs: INVITE_SENDING.leaseMs,
      platformPerDay: deps.settings.perDay,
      perMonth,
      hmacOf: (email) => emailHmac(deps.settings.hmacKey, email),
      gymIds: deps.gymIds ?? null,
      skipGyms,
      skipLeads,
    });
    if (claim === null) break;
    if (claim === "capped") {
      run.capped = true;
      break;
    }
    const outcome = await sendOne(deps, claim);
    if (outcome === "stop") {
      run.held += 1;
      run.stoppedByProvider = true;
      break;
    }
    if (typeof outcome === "object") {
      // Not due after all: passed over for the rest of this run, so a gym that cannot
      // send now, or a lead the claim and the rule see differently, is not taken again.
      if (outcome.of === "gym") skipGyms.push(claim.gymId);
      else if (claim.leadId !== null) skipLeads.push(claim.leadId);
      run.dropped += 1;
      continue;
    }
    run[outcome] += 1;
    if (outcome === "sent") await deps.sleep(INVITE_SENDING.gapMs);
  }
  return run;
}

/** A tally, "stop" (Resend refused the key, the account or the rate), or not due after all. */
type Outcome = Tally | "stop" | { of: "gym" | "lead" };

async function sendOne(deps: LeadSenderDeps, claim: repo.ClaimedLeadSend): Promise<Outcome> {
  const now = deps.now();
  // It may already have gone and Resend has forgotten, or will soon forget, its key.
  if (claim.maybeSentAt !== null && now.getTime() - claim.maybeSentAt.getTime() >= INVITE_SENDING.unknownAfterMs) {
    return await finishMaybeSent(deps, claim);
  }
  const email = claim.email;
  if (email === null) throw new Error(`lead send ${claim.id} is being sent with no address`);

  let looked = await lookAgain(deps, claim, email, null);
  if (looked.decision.kind === "check_mail") {
    looked = await lookAgain(deps, claim, email, await deps.mailDomain(emailDomain(email)));
  }
  const { decision, message } = looked;
  switch (decision.kind) {
    case "drop":
      if (claim.maybeSentAt !== null) return await finishMaybeSent(deps, claim);
      if (!(await repo.dropSend(deps.sql, claim))) return leaseLost(deps, claim);
      return { of: decision.of };
    case "skip":
      if (claim.maybeSentAt !== null) return await finishMaybeSent(deps, claim);
      return await finish(deps, claim, { kind: "skipped", reason: decision.reason });
    case "retry":
    case "check_mail":
      return await hold(deps, claim, "dns_unavailable");
    case "send":
      break;
  }
  if (message === null) return leaseLost(deps, claim);
  const result = await deps.transport.send(message);
  switch (result.kind) {
    case "sent":
      return await finishSent(deps, claim, result.id);
    case "not_sent": {
      deps.log.warn(
        { event: "lead_email.send_refused", sendId: claim.id, gymId: claim.gymId, status: result.status },
        "the email service refused a lead's follow-up email; it waits",
      );
      const reason = result.status === 400 || result.status === 422 ? "provider_refused" : "provider_unavailable";
      const held = await hold(deps, claim, reason);
      // A key, an account or a rate problem is every email's: the run stops.
      return held === "held" && [401, 403, 429].includes(result.status) ? "stop" : held;
    }
    case "unclear": {
      deps.log.warn(
        { event: "lead_email.send_unclear", sendId: claim.id, gymId: claim.gymId, status: result.status, attempts: claim.attempts },
        "a lead's follow-up email may not have gone; it will be tried again under the same key",
      );
      await repo.retrySend(deps.sql, claim, new Date(now.getTime() + retryAfter(claim)));
      return "retried";
    }
  }
}

/** Look at the email again with the lead locked, and decide. A send is marked "may have
 *  gone" in the same transaction, so staff marking the same email by hand after this
 *  point are refused, and before it are seen here. */
async function lookAgain(
  deps: LeadSenderDeps,
  claim: repo.ClaimedLeadSend,
  email: string,
  mail: MailCheck | null,
): Promise<{ decision: LeadSendDecision; message: InviteEmail | null }> {
  const now = deps.now();
  return await deps.sql.begin(async (tx) => {
    const ctx = await repo.lockSendContext(tx, claim, now);
    const suppression = (await suppressionsFor(tx, claim.gymId, [claim.emailHmac])).get(claim.emailHmac) ?? null;
    const onMemberList = (await heldAddresses(tx, claim.gymId, [email])).has(email.toLowerCase());
    const gym = ctx.gym;
    const lead = ctx.lead;
    const gymName = gym === null ? "" : gymNameForEmail(gym.name);
    const postal = gym === null ? "" : cleanGymText(gym.postalAddress ?? "", GYM_POSTAL_ADDRESS_MAX_CHARS);
    const decision = decideLeadSend({
      gym:
        gym === null
          ? null
          : {
              active: gym.active,
              onPlan: gym.onPlan,
              switchedOn: gym.sendForMe && gym.replyTo !== null,
              stopped: gym.stopped,
              hasPostalAddress: postal !== "",
              named: gymName !== "",
            },
      lead:
        lead === null
          ? null
          : {
              isNew: lead.status === "new",
              sameTick: lead.sameTick,
              sameAddress: lead.email !== null && lead.email.toLowerCase() === email.toLowerCase(),
              nextStep: lead.sent === claim.step - 1,
              due: lead.due,
            },
      suppression,
      onMemberList,
      addressValid: authEmailSchema.safeParse(email).success,
      shared: isSharedAddress(email),
      mail,
    });
    if (decision.kind !== "send") return { decision, message: null };
    if (gym === null || lead === null || gym.replyTo === null) throw new Error("decideLeadSend allowed a send without a gym, a lead or a reply address");
    const message = leadMessage(deps, claim, email, { gymName, postal, replyTo: gym.replyTo, fullName: lead.fullName });
    if (message === null || !(await repo.markMaybeSent(tx, claim, now))) return { decision, message: null };
    return { decision, message };
  });
}

function leadMessage(
  deps: LeadSenderDeps,
  claim: repo.ClaimedLeadSend,
  email: string,
  words: { gymName: string; postal: string; replyTo: string; fullName: string },
): InviteEmail | null {
  const unsubscribeLink = `${deps.sender.apiOrigin}/v1/email/leads/unsubscribe?t=${inviteLinkToken(deps.settings.hmacKey, "lead_unsubscribe", claim.id)}`;
  const letter = leadFollowUpEmail({
    to: email,
    step: claim.step,
    firstName: firstNameForEmail(words.fullName),
    gymName: words.gymName,
    postalAddress: words.postal,
    unsubscribeLink,
  });
  if (letter === null) return null;
  return {
    ...letter,
    from: deps.sender.from === null ? "" : memberInviteFrom(deps.sender.from, words.gymName),
    replyTo: words.replyTo,
    headers: {
      "List-Unsubscribe": `<${unsubscribeLink}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    idempotencyKey: `lead-follow-up-${claim.id}`,
    tags: [{ name: LEAD_SEND_TAG, value: claim.id }],
  };
}

const retryAfter = (claim: repo.ClaimedLeadSend): number =>
  RETRY_AFTER_MS[Math.min(claim.attempts - 1, RETRY_AFTER_MS.length - 1)] ?? 60_000;

/** It went: the row is finished and the lead's count moves on, in one transaction. */
async function finishSent(deps: LeadSenderDeps, claim: repo.ClaimedLeadSend, providerId: string | null): Promise<Tally> {
  const at = deps.now();
  const mine = await deps.sql.begin(async (tx) => {
    if (!(await repo.finishSend(tx, claim, { kind: "sent", providerId }, at))) return false;
    await countOnLead(tx, claim, at);
    return true;
  });
  if (!mine) return leaseLost(deps, claim);
  return "sent";
}

/** It may have gone: taken as sent, so the lead is never sent it again, and staff are
 *  not asked to send it either. */
async function finishMaybeSent(deps: LeadSenderDeps, claim: repo.ClaimedLeadSend): Promise<Tally> {
  const at = claim.maybeSentAt ?? deps.now();
  const mine = await deps.sql.begin(async (tx) => {
    if (!(await repo.finishSend(tx, claim, { kind: "failed", reason: "send_unknown" }, deps.now()))) return false;
    await countOnLead(tx, claim, at);
    return true;
  });
  if (!mine) return leaseLost(deps, claim);
  return "failed";
}

/** The lead has had `step`, if it is still at the address the email went to and has not
 *  moved on: the count, when, and the next one's day. */
async function countOnLead(tx: TransactionSql, claim: repo.ClaimedLeadSend, at: Date): Promise<void> {
  if (claim.leadId === null || claim.email === null) return;
  const ctx = await repo.lockSendContext(tx, claim, at);
  const lead = ctx.lead;
  const gym = ctx.gym;
  if (lead === null || gym === null || lead.email === null || lead.email.toLowerCase() !== claim.email.toLowerCase()) return;
  if (lead.sent !== claim.step - 1) return;
  const status = leadStatusSchema.parse(lead.status);
  const dueOn = followUpDueOn({
    status,
    ticked: lead.emailOkAt !== null,
    sent: claim.step,
    tickDay: lead.emailOkAt === null ? null : dayInTz(lead.emailOkAt, gym.timezone),
    lastSentDay: dayInTz(at, gym.timezone),
  });
  await repo.writeLeadSent(tx, claim.gymId, claim.leadId, { step: claim.step, lastAt: at, dueOn });
  await insertAudit(tx, {
    actorUserId: null,
    gymId: claim.gymId,
    action: "org.lead_follow_up_sent",
    targetType: "lead",
    targetId: claim.leadId,
    meta: { step: String(claim.step), by: "app" },
  });
}

/** It did not go this time: it waits. A week of that gives it back to staff, and says so
 *  on the lead's panel. */
async function hold(deps: LeadSenderDeps, claim: repo.ClaimedLeadSend, reason: string): Promise<Tally> {
  const now = deps.now();
  if (claim.maybeSentAt === null && now.getTime() - claim.createdAt.getTime() >= INVITE_SENDING.holdMs) {
    return await finish(deps, claim, { kind: "failed", reason }, true);
  }
  // This attempt certainly did not send, so the row says what it said before it.
  await repo.retrySend(deps.sql, claim, new Date(now.getTime() + retryAfter(claim)), claim.maybeSentAt);
  return "held";
}

async function finish(deps: LeadSenderDeps, claim: repo.ClaimedLeadSend, outcome: repo.LeadSendOutcome, certainlyNotSent = false): Promise<Tally> {
  const mine = await repo.finishSend(deps.sql, claim, outcome, deps.now(), certainlyNotSent);
  if (!mine) return leaseLost(deps, claim);
  return outcome.kind;
}

function leaseLost(deps: LeadSenderDeps, claim: repo.ClaimedLeadSend): Tally {
  deps.log.warn({ event: "lead_email.lease_lost", sendId: claim.id, gymId: claim.gymId }, "a lead's follow-up email's lease was taken over");
  return "held";
}
