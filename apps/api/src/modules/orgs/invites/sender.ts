// The worker's half of an invitation (Part 3 §9.12): take each email that is due,
// check it again with facts read that moment (`decideSend`), and send it.
//
// The database row is the queue. A press writes the row in the same transaction as the
// invitation, so nothing can be queued without its record or recorded without being
// queued; the worker leases one row at a time under the caps and names its lease in
// every write that finishes it.
//
// Resend's answer is one of three. It went. It did not go (a 4xx: our request, our key
// or account, the rate): the email waits and nothing is spent, and a week of that gives
// it up, after which a press may queue it again. Or it may have gone (a timeout, a 5xx):
// the row is marked before every hand-over, the next try goes first and under the same
// idempotency key, and once 20 hours have passed since the mark it is never handed to
// Resend again — Resend keeps a key for 24 — and ends as "may have gone".
import { authEmailSchema, GYM_POSTAL_ADDRESS_MAX_CHARS, INVITE_SEND_TAG, type MemberInviteEmailReason } from "@app/shared";
import type { Sql } from "postgres";
import { memberInviteEmail, memberInviteFrom } from "../../../email/templates.js";
import type { InviteEmail, InviteTransport } from "../../../email/resend.js";
import { emailDomain, emailHmac, isSharedAddress } from "./address.js";
import { decideSend, type SendFacts } from "./decide.js";
import { cleanGymText, GYM_TEXT_IN_EMAIL_CHARS, gymNameForEmail } from "./gymText.js";
import { addressInApp } from "./inApp.js";
import type { MailDomainCheck } from "./mailDomain.js";
import * as repo from "./repo.js";
import type { InviteSender, InviteSettings } from "./settings.js";
import { unsubscribeToken } from "./token.js";

/** The caps and pacing. A gym may send 500 invitations in any 24 hours, 200 while on
 *  trial (its whole member cap); the whole app is capped by INVITE_EMAILS_PER_DAY. */
export const INVITE_SENDING = {
  gymPerDay: 500,
  trialGymPerDay: 200,
  /** Emails one run takes before it stops; the schedule runs every minute. */
  perRun: 120,
  leaseMs: 5 * 60 * 1000,
  /** At most five a second, half of Resend's ten a second for the whole account. */
  gapMs: 200,
  /** After this long since an email may have reached Resend, it is never handed over again. */
  unknownAfterMs: 20 * 60 * 60 * 1000,
  /** An email Resend keeps refusing, or whose domain cannot be asked, is given up after this. */
  holdMs: 7 * 24 * 60 * 60 * 1000,
} as const;

/** The sender outside production with no invitations mailbox configured: it writes the
 *  join link and the send's key to the log, never the address or the unsubscribe token,
 *  and reports the email sent. */
export function devInviteTransport(log: { info: (obj: object, msg: string) => void }): InviteTransport {
  return {
    send(message) {
      const links = (message.text.match(/https?:\/\/\S+/g) ?? []).filter((link) => !link.includes("/v1/email/unsubscribe"));
      log.info(
        { event: "email.invite.dev", idempotencyKey: message.idempotencyKey, subject: message.subject, links },
        "DEV ONLY — invitation email (no invitations mailbox configured)",
      );
      return Promise.resolve({ kind: "sent", id: null });
    },
  };
}

/** Wait before the next try, by how many tries have been made. */
const RETRY_AFTER_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];

export interface SenderDeps {
  sql: Sql;
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
  settings: InviteSettings;
  sender: InviteSender;
  transport: InviteTransport;
  mailDomain: MailDomainCheck;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Smaller caps for a test; production passes nothing. */
  limits?: Partial<Record<"gymPerDay" | "trialGymPerDay" | "perRun", number>>;
}

export interface SendRun {
  paused: boolean;
  sent: number;
  skipped: number;
  failed: number;
  /** May have gone; tried again later. */
  retried: number;
  /** Did not go; waiting to be tried again. */
  held: number;
  /** Resend refused the key, the account or the rate, so the run stopped. */
  stoppedByProvider: boolean;
  /** The whole app reached its day's cap during this run. */
  capped: boolean;
}

/** Send what is due, up to one run's worth. Safe to run twice at once. */
export async function sendDueInvites(deps: SenderDeps): Promise<SendRun> {
  const run: SendRun = {
    paused: deps.settings.paused,
    sent: 0,
    skipped: 0,
    failed: 0,
    retried: 0,
    held: 0,
    stoppedByProvider: false,
    capped: false,
  };
  if (deps.settings.paused) return run;
  const limits = {
    gymPerDay: deps.limits?.gymPerDay ?? INVITE_SENDING.gymPerDay,
    trialGymPerDay: deps.limits?.trialGymPerDay ?? INVITE_SENDING.trialGymPerDay,
    perRun: deps.limits?.perRun ?? INVITE_SENDING.perRun,
  };
  for (let taken = 0; taken < limits.perRun; taken++) {
    const claim = await repo.claimNextSend(deps.sql, {
      now: deps.now(),
      leaseMs: INVITE_SENDING.leaseMs,
      platformPerDay: deps.settings.perDay,
      gymPerDay: limits.gymPerDay,
      trialGymPerDay: limits.trialGymPerDay,
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
    run[outcome] += 1;
    if (outcome === "sent") await deps.sleep(INVITE_SENDING.gapMs);
  }
  return run;
}

type Tally = "sent" | "skipped" | "failed" | "retried" | "held" | "stop";

async function sendOne(deps: SenderDeps, claim: repo.ClaimedSend): Promise<Tally> {
  const now = deps.now();
  // It may already have gone and Resend has forgotten, or will soon forget, its key.
  if (claim.maybeSentAt !== null && now.getTime() - claim.maybeSentAt.getTime() >= INVITE_SENDING.unknownAfterMs) {
    return await finish(deps, claim, { kind: "failed", reason: "send_unknown" });
  }
  const email = claim.email;
  if (email === null) return await stop(deps, claim, "not_on_list");
  const ctx = await repo.sendContext(deps.sql, claim);
  const hmac = emailHmac(deps.settings.hmacKey, email);
  const suppression = (await repo.suppressionsFor(deps.sql, claim.gymId, [hmac])).get(hmac) ?? null;
  const gymName = ctx.gym === null ? "" : gymNameForEmail(ctx.gym.name);
  const facts: SendFacts = {
    inviteState: ctx.invite?.state ?? null,
    addressMatchesInvite: ctx.invite?.hmac === hmac,
    gym:
      ctx.gym === null
        ? null
        : {
            active: ctx.gym.active,
            onPlan: ctx.gym.onPlan,
            stopped: ctx.gym.stopped,
            hasPostalAddress: (ctx.gym.postalAddress ?? "") !== "",
            named: gymName !== "",
          },
    onList: ctx.holders.length > 0,
    inApp: await addressInApp(deps.sql, claim.gymId, email, ctx.holders),
    suppression,
    addressValid: authEmailSchema.safeParse(email).success,
    shared: isSharedAddress(email),
    mail: null,
  };
  let decision = decideSend(facts);
  if (decision.kind === "check_mail") decision = decideSend({ ...facts, mail: await deps.mailDomain(emailDomain(email)) });
  switch (decision.kind) {
    case "skip":
      return await stop(deps, claim, decision.reason);
    case "retry":
    case "check_mail":
      return await hold(deps, claim, "dns_unavailable");
    case "send":
      break;
  }
  if (ctx.gym === null) throw new Error("decideSend allowed a send without a gym");
  const message = inviteMessage(deps.settings, deps.sender, claim, email, ctx.gym, gymName);
  if (!(await repo.markMaybeSent(deps.sql, claim, now))) return leaseLost(deps, claim);
  const result = await deps.transport.send(message);
  switch (result.kind) {
    case "sent":
      return await finish(deps, claim, { kind: "sent", providerId: result.id });
    case "not_sent": {
      deps.log.warn(
        { event: "invite.send_refused", sendId: claim.id, gymId: claim.gymId, status: result.status },
        "the email service refused an invitation email; it waits",
      );
      const reason: MemberInviteEmailReason = result.status === 400 || result.status === 422 ? "provider_refused" : "provider_unavailable";
      const held = await hold(deps, claim, reason);
      // A key, an account or a rate problem is every email's: the run stops.
      return held === "held" && [401, 403, 429].includes(result.status) ? "stop" : held;
    }
    case "unclear": {
      deps.log.warn(
        { event: "invite.send_unclear", sendId: claim.id, gymId: claim.gymId, status: result.status, attempts: claim.attempts },
        "an invitation email may not have gone; it will be tried again under the same key",
      );
      await repo.retrySend(deps.sql, claim, new Date(now.getTime() + retryAfter(claim)));
      return "retried";
    }
  }
}

const retryAfter = (claim: repo.ClaimedSend): number =>
  RETRY_AFTER_MS[Math.min(claim.attempts - 1, RETRY_AFTER_MS.length - 1)] ?? 60_000;

function inviteMessage(
  settings: InviteSettings,
  sender: InviteSender,
  claim: repo.ClaimedSend,
  email: string,
  gym: NonNullable<repo.SendContext["gym"]>,
  gymName: string,
): InviteEmail {
  const city = gym.city === null ? "" : cleanGymText(gym.city, GYM_TEXT_IN_EMAIL_CHARS);
  const unsubscribeLink = `${sender.apiOrigin}/v1/email/unsubscribe?t=${unsubscribeToken(settings.hmacKey, claim.inviteId)}`;
  const words = memberInviteEmail({
    to: email,
    gymName,
    gymCity: city === "" ? null : city,
    postalAddress: cleanGymText(gym.postalAddress ?? "", GYM_POSTAL_ADDRESS_MAX_CHARS),
    joinLink: `${settings.webOrigin}/join/${encodeURIComponent(gym.slug)}`,
    unsubscribeLink,
  });
  return {
    ...words,
    from: sender.from === null ? "" : memberInviteFrom(sender.from, gymName),
    headers: {
      "List-Unsubscribe": `<${unsubscribeLink}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    idempotencyKey: `member-invite-${claim.id}`,
    tags: [{ name: INVITE_SEND_TAG, value: claim.id }],
  };
}

/** The email will not be sent. If an earlier attempt may have reached Resend, that is
 *  what it says, never "not sent". */
async function stop(deps: SenderDeps, claim: repo.ClaimedSend, reason: MemberInviteEmailReason): Promise<Tally> {
  return claim.maybeSentAt === null
    ? await finish(deps, claim, { kind: "skipped", reason })
    : await finish(deps, claim, { kind: "failed", reason: "send_unknown" });
}

/** It did not go this time: it waits, and nothing is spent. A week of that gives it up,
 *  and then a press may queue it again. */
async function hold(deps: SenderDeps, claim: repo.ClaimedSend, reason: MemberInviteEmailReason): Promise<Tally> {
  const now = deps.now();
  if (claim.maybeSentAt === null && now.getTime() - claim.createdAt.getTime() >= INVITE_SENDING.holdMs) {
    return await finish(deps, claim, { kind: "failed", reason }, true);
  }
  // This attempt certainly did not send, so the row says what it said before it.
  await repo.retrySend(deps.sql, claim, new Date(now.getTime() + retryAfter(claim)), claim.maybeSentAt);
  return "held";
}

async function finish(deps: SenderDeps, claim: repo.ClaimedSend, outcome: repo.SendOutcome, certainlyNotSent = false): Promise<Tally> {
  const mine = await repo.finishSend(deps.sql, claim, outcome, deps.now(), certainlyNotSent);
  if (!mine) leaseLost(deps, claim);
  return outcome.kind;
}

function leaseLost(deps: SenderDeps, claim: repo.ClaimedSend): Tally {
  deps.log.warn({ event: "invite.lease_lost", sendId: claim.id, gymId: claim.gymId }, "an invitation email's lease was taken over");
  return "held";
}
