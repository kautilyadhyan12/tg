// The worker's half of a staff invitation (Part 3 §10.3; ROADMAP 4a-i): take each email
// that is due, check it again with facts read that moment (`decideStaffSend`), and send
// it — after the member invitations and the leads' follow-ups, under the same daily cap,
// kill switch, sender and retry rules (`invites/sender.ts`).
import { authEmailSchema, STAFF_INVITE_DAYS, STAFF_INVITE_SEND_TAG, staffRoleWord, type StaffInviteEmailReason } from "@app/shared";
import type { Sql } from "postgres";
import { memberInviteFrom, staffInviteEmail } from "../../../email/templates.js";
import type { InviteEmail, InviteTransport } from "../../../email/resend.js";
import { emailDomain, emailHmac } from "../invites/address.js";
import { cleanGymText, GYM_TEXT_IN_EMAIL_CHARS, gymNameForEmail } from "../invites/gymText.js";
import type { MailDomainCheck } from "../invites/mailDomain.js";
import { suppressionsFor } from "../invites/repo.js";
import { INVITE_SENDING } from "../invites/sender.js";
import type { InviteSender, InviteSettings } from "../invites/settings.js";
import { decideStaffSend, type StaffSendFacts } from "./decide.js";
import * as repo from "./sendRepo.js";

/** The page the email's link opens: it sends the person to sign in through the Manage door. */
export const STAFF_INVITE_LINK_PATH = "/staff-invitation";

export interface StaffSenderDeps {
  sql: Sql;
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
  settings: InviteSettings;
  sender: InviteSender;
  transport: InviteTransport;
  mailDomain: MailDomainCheck;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Only these gyms' emails, for a test that shares its database; production passes nothing. */
  gymIds?: readonly string[];
}

export interface StaffSendRun {
  paused: boolean;
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
  held: number;
  stoppedByProvider: boolean;
  capped: boolean;
}

/** Wait before the next try, by how many tries have been made. */
const RETRY_AFTER_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];

type Tally = "sent" | "skipped" | "failed" | "retried" | "held";

/** Send what is due, up to one run's worth. Safe to run twice at once. */
export async function sendDueStaffInvites(deps: StaffSenderDeps): Promise<StaffSendRun> {
  const run: StaffSendRun = {
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
  for (let taken = 0; taken < INVITE_SENDING.perRun; taken++) {
    const claim = await repo.claimNextStaffSend(deps.sql, {
      now: deps.now(),
      leaseMs: INVITE_SENDING.leaseMs,
      platformPerDay: deps.settings.perDay,
      gymIds: deps.gymIds ?? null,
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

async function sendOne(deps: StaffSenderDeps, claim: repo.ClaimedStaffSend): Promise<Tally | "stop"> {
  const now = deps.now();
  // It may already have gone and Resend has forgotten, or will soon forget, its key.
  if (claim.maybeSentAt !== null && now.getTime() - claim.maybeSentAt.getTime() >= INVITE_SENDING.unknownAfterMs) {
    return await finish(deps, claim, { kind: "failed", reason: "send_unknown" });
  }
  const email = claim.email;
  if (email === null) return await stop(deps, claim, "invitation_closed");
  const ctx = await repo.staffSendContext(deps.sql, claim, now);
  const hmac = emailHmac(deps.settings.hmacKey, email);
  const suppression = (await suppressionsFor(deps.sql, claim.gymId, [hmac])).get(hmac) ?? null;
  const gymName = ctx.gym === null ? "" : gymNameForEmail(ctx.gym.name);
  const facts: StaffSendFacts = {
    inviteOpen: ctx.invite !== null && ctx.invite.open && ctx.invite.role !== null && ctx.invite.email.toLowerCase() === email.toLowerCase(),
    gym:
      ctx.gym === null
        ? null
        : { active: ctx.gym.active, onPlan: ctx.gym.onPlan, stopped: ctx.gym.stopped, named: gymName !== "" },
    suppression,
    addressValid: authEmailSchema.safeParse(email).success,
    mail: null,
  };
  let decision = decideStaffSend(facts);
  if (decision.kind === "check_mail") decision = decideStaffSend({ ...facts, mail: await deps.mailDomain(emailDomain(email)) });
  switch (decision.kind) {
    case "skip":
      return await stop(deps, claim, decision.reason);
    case "retry":
    case "check_mail":
      return await hold(deps, claim, "dns_unavailable");
    case "send":
      break;
  }
  if (ctx.gym === null || ctx.invite?.role == null) throw new Error("decideStaffSend allowed a send without a gym or a role");
  const message = staffMessage(deps, claim, email, {
    gymName,
    inviterName: cleanGymText(ctx.invite.inviterName ?? "", GYM_TEXT_IN_EMAIL_CHARS),
    role: staffRoleWord(ctx.invite.role, ctx.gym.orgType),
  });
  if (!(await repo.markMaybeSent(deps.sql, claim, now))) return leaseLost(deps, claim);
  const result = await deps.transport.send(message);
  switch (result.kind) {
    case "sent":
      return await finish(deps, claim, { kind: "sent", providerId: result.id });
    case "not_sent": {
      deps.log.warn(
        { event: "staff_invite.send_refused", sendId: claim.id, gymId: claim.gymId, status: result.status },
        "the email service refused a staff invitation email; it waits",
      );
      const reason: StaffInviteEmailReason = result.status === 400 || result.status === 422 ? "provider_refused" : "provider_unavailable";
      const held = await hold(deps, claim, reason);
      // A key, an account or a rate problem is every email's: the run stops.
      return held === "held" && [401, 403, 429].includes(result.status) ? "stop" : held;
    }
    case "unclear": {
      deps.log.warn(
        { event: "staff_invite.send_unclear", sendId: claim.id, gymId: claim.gymId, status: result.status, attempts: claim.attempts },
        "a staff invitation email may not have gone; it will be tried again under the same key",
      );
      await repo.retrySend(deps.sql, claim, new Date(now.getTime() + retryAfter(claim)));
      return "retried";
    }
  }
}

const retryAfter = (claim: repo.ClaimedStaffSend): number =>
  RETRY_AFTER_MS[Math.min(claim.attempts - 1, RETRY_AFTER_MS.length - 1)] ?? 60_000;

function staffMessage(
  deps: StaffSenderDeps,
  claim: repo.ClaimedStaffSend,
  email: string,
  words: { gymName: string; inviterName: string; role: string },
): InviteEmail {
  const letter = staffInviteEmail({
    to: email,
    inviterName: words.inviterName,
    gymName: words.gymName,
    role: words.role,
    days: STAFF_INVITE_DAYS,
    signInLink: `${deps.settings.webOrigin}${STAFF_INVITE_LINK_PATH}`,
  });
  return {
    ...letter,
    from: deps.sender.from === null ? "" : memberInviteFrom(deps.sender.from, words.gymName),
    headers: {},
    idempotencyKey: `staff-invite-${claim.id}`,
    tags: [{ name: STAFF_INVITE_SEND_TAG, value: claim.id }],
  };
}

/** The email will not be sent. If an earlier attempt may have reached Resend, that is
 *  what it says, never "not sent". */
async function stop(deps: StaffSenderDeps, claim: repo.ClaimedStaffSend, reason: StaffInviteEmailReason): Promise<Tally> {
  return claim.maybeSentAt === null
    ? await finish(deps, claim, { kind: "skipped", reason })
    : await finish(deps, claim, { kind: "failed", reason: "send_unknown" });
}

/** It did not go this time: it waits, and nothing is spent. A week of that gives it up. */
async function hold(deps: StaffSenderDeps, claim: repo.ClaimedStaffSend, reason: StaffInviteEmailReason): Promise<Tally> {
  const now = deps.now();
  if (claim.maybeSentAt === null && now.getTime() - claim.createdAt.getTime() >= INVITE_SENDING.holdMs) {
    return await finish(deps, claim, { kind: "failed", reason }, true);
  }
  // This attempt certainly did not send, so the row says what it said before it.
  await repo.retrySend(deps.sql, claim, new Date(now.getTime() + retryAfter(claim)), claim.maybeSentAt);
  return "held";
}

async function finish(deps: StaffSenderDeps, claim: repo.ClaimedStaffSend, outcome: repo.StaffSendOutcome, certainlyNotSent = false): Promise<Tally> {
  const mine = await repo.finishSend(deps.sql, claim, outcome, deps.now(), certainlyNotSent);
  if (!mine) return leaseLost(deps, claim);
  return outcome.kind;
}

function leaseLost(deps: StaffSenderDeps, claim: repo.ClaimedStaffSend): Tally {
  deps.log.warn({ event: "staff_invite.lease_lost", sendId: claim.id, gymId: claim.gymId }, "a staff invitation email's lease was taken over");
  return "held";
}
