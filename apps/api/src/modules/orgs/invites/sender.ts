// The worker's half of an invitation (Part 3 §9.12): take each email that is due,
// check it again with facts read that moment (`decideSend`), and send it.
//
// The database row is the queue. A press writes the row in the same transaction as the
// invitation, so nothing can be queued without its record or recorded without being
// queued; the worker leases one row at a time under the caps and names its lease in
// every write that finishes it. A worker that dies mid-send leaves a lease that runs
// out, and the next run sends again under the same idempotency key, which Resend
// answers without sending twice.
import { authEmailSchema, GYM_POSTAL_ADDRESS_MAX_CHARS, type MemberInviteEmailReason } from "@app/shared";
import type { Sql } from "postgres";
import { memberInviteEmail, memberInviteFrom } from "../../../email/templates.js";
import type { InviteEmail, InviteSendResult, InviteTransport } from "../../../email/resend.js";
import { emailDomain, emailHmac, isSharedAddress } from "./address.js";
import { decideSend, type SendFacts } from "./decide.js";
import { cleanGymText, GYM_TEXT_IN_EMAIL_CHARS } from "./gymText.js";
import { addressInApp } from "./inApp.js";
import type { MailDomainCheck } from "./mailDomain.js";
import * as repo from "./repo.js";
import type { InviteSettings } from "./settings.js";
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
  /** Tries before an email that keeps failing is given up. */
  maxAttempts: 6,
} as const;

/** The sender outside production with no invitations mailbox configured: it writes
 *  the email's two links to the log (never the address) and reports it sent. */
export function devInviteTransport(log: { info: (obj: object, msg: string) => void }): InviteTransport {
  return {
    send(message) {
      const links = message.text.match(/https?:\/\/\S+/g) ?? [];
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
  transport: InviteTransport;
  mailDomain: MailDomainCheck;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Smaller caps for a test; production passes nothing. */
  limits?: Partial<Record<"gymPerDay" | "trialGymPerDay" | "perRun", number>>;
}

export interface SendRun {
  paused: boolean;
  staleFailed: number;
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
  /** The whole app reached its day's cap during this run. */
  capped: boolean;
}

/** Send what is due, up to one run's worth. Safe to run twice at once. */
export async function sendDueInvites(deps: SenderDeps): Promise<SendRun> {
  const run: SendRun = { paused: deps.settings.paused, staleFailed: 0, sent: 0, skipped: 0, failed: 0, retried: 0, capped: false };
  if (deps.settings.paused) return run;
  run.staleFailed = await repo.failStaleSends(deps.sql, deps.now());
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
    run[outcome] += 1;
    if (outcome === "sent") await deps.sleep(INVITE_SENDING.gapMs);
  }
  return run;
}

type Tally = "sent" | "skipped" | "failed" | "retried";

async function sendOne(deps: SenderDeps, claim: repo.ClaimedSend): Promise<Tally> {
  const email = claim.email;
  if (email === null) return await finish(deps, claim, { kind: "skipped", reason: "not_on_list" });
  const ctx = await repo.sendContext(deps.sql, claim);
  const hmac = emailHmac(deps.settings.hmacKey, email);
  const suppression = (await repo.suppressionsFor(deps.sql, claim.gymId, [hmac])).get(hmac) ?? null;
  const facts: SendFacts = {
    inviteState: ctx.invite?.state ?? null,
    addressMatchesInvite: ctx.invite?.hmac === hmac,
    gym:
      ctx.gym === null
        ? null
        : { active: ctx.gym.active, onPlan: ctx.gym.onPlan, hasPostalAddress: (ctx.gym.postalAddress ?? "") !== "" },
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
      return await finish(deps, claim, { kind: "skipped", reason: decision.reason });
    case "retry":
    case "check_mail":
      return await retry(deps, claim, "dns_unavailable");
    case "send":
      break;
  }
  if (ctx.gym === null || ctx.gym.postalAddress === null) throw new Error("decideSend allowed a send without a gym address");
  const message = inviteMessage(deps.settings, claim, email, ctx.gym);
  const result: InviteSendResult = await deps.transport.send(message);
  switch (result.kind) {
    case "sent":
      return await finish(deps, claim, { kind: "sent", providerId: result.id });
    case "refused":
      return await finish(deps, claim, { kind: "failed", reason: "provider_refused" });
    case "retry":
      deps.log.warn(
        { event: "invite.send_retry", sendId: claim.id, gymId: claim.gymId, status: result.status, attempts: claim.attempts },
        "an invitation email could not be sent and will be tried again",
      );
      return await retry(deps, claim, "provider_unavailable");
  }
}

function inviteMessage(
  settings: InviteSettings,
  claim: repo.ClaimedSend,
  email: string,
  gym: NonNullable<repo.SendContext["gym"]>,
): InviteEmail {
  const gymName = cleanGymText(gym.name, GYM_TEXT_IN_EMAIL_CHARS);
  const city = gym.city === null ? "" : cleanGymText(gym.city, GYM_TEXT_IN_EMAIL_CHARS);
  const unsubscribeLink = `${settings.apiOrigin}/v1/email/unsubscribe?t=${unsubscribeToken(settings.hmacKey, claim.inviteId)}`;
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
    from: settings.from === null ? "" : memberInviteFrom(settings.from, gymName),
    headers: {
      "List-Unsubscribe": `<${unsubscribeLink}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    idempotencyKey: `member-invite-${claim.id}`,
  };
}

async function finish(deps: SenderDeps, claim: repo.ClaimedSend, outcome: repo.SendOutcome): Promise<Tally> {
  const mine = await repo.finishSend(deps.sql, claim, outcome, deps.now());
  if (!mine) {
    deps.log.warn({ event: "invite.lease_lost", sendId: claim.id, gymId: claim.gymId }, "an invitation email's lease was taken over");
  }
  return outcome.kind;
}

async function retry(deps: SenderDeps, claim: repo.ClaimedSend, reason: MemberInviteEmailReason): Promise<Tally> {
  if (claim.attempts >= INVITE_SENDING.maxAttempts) return await finish(deps, claim, { kind: "failed", reason });
  const wait = RETRY_AFTER_MS[Math.min(claim.attempts - 1, RETRY_AFTER_MS.length - 1)] ?? 60_000;
  await repo.retrySend(deps.sql, claim, new Date(deps.now().getTime() + wait));
  return "retried";
}
