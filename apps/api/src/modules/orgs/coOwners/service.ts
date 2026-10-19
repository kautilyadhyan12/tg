// Co-owners (ROADMAP Stage 2 item 4b-i; Kd 2026-10-16). The owner's side: Send request and
// Cancel request on a person of the Staff tab. The asked person's side: their request on
// the gym's Overview, Accept and Decline.
//
// Only the gym's own owner (`gyms.owner_user_id`) sends or cancels: a co-owner holds
// `staff.manage` and passes that gate, and the repo refuses them by the owner's id. Accept
// gives the owner's usual ticks; the owner stays the gym's owner.
import {
  CO_OWNER_REQUEST_DAYS,
  CO_OWNER_WORDS,
  OWNER_REQUEST_DAYS,
  OWNER_REQUEST_WORDS,
  type AnswerCoOwnerRequestResponse,
  type AnswerOwnerRequestResponse,
  type CancelCoOwnerRequestResponse,
  type CancelOwnerRequestResponse,
  type MyCoOwnerRequestResponse,
  type MyOwnerRequestResponse,
  type SendCoOwnerRequestResponse,
  type SendOwnerRequestResponse,
} from "@app/shared";
import type { Sql } from "postgres";
import { closeSuperseded, endHandedOverPlan, type BillingDeps } from "../../billing/service.js";
import { cleanGymText, GYM_TEXT_IN_EMAIL_CHARS, gymNameForEmail } from "../invites/gymText.js";
import { defaultPrivilegesFor, OrgsError, requirePrivilege, requireStaff, requireWritablePrivilege } from "../service.js";
import { emailHmac } from "../invites/address.js";
import { suppressionsFor } from "../invites/repo.js";
import type { CoOwnerEmailSender } from "./email.js";
import * as repo from "./repo.js";

export interface CoOwnerDeps {
  sql: Sql;
  email: CoOwnerEmailSender;
  /** The invitations' address key, to find an address that bounced, complained or
   *  unsubscribed; null when invitations are off (then no address is known to be). */
  addressKey: Buffer | null;
  webOrigin: string;
  now: () => Date;
  log: { warn: (obj: object, msg: string) => void };
  /** Paddle and Razorpay, to cancel the payment windows a hand-over closes; null where neither
   *  is set up (a window paid anyway is then set aside and refunded when it arrives). */
  billing: BillingDeps | null;
}

const ownerOnly = (): OrgsError => new OrgsError(403, "owner_only", CO_OWNER_WORDS.owner_only);

export async function sendCoOwnerRequest(deps: CoOwnerDeps, actorUserId: string, gymId: string, userId: string): Promise<SendCoOwnerRequestResponse> {
  await requireWritablePrivilege(deps, gymId, actorUserId, "staff.manage");
  const outcome = await repo.sendRequest(deps.sql, { gymId, userId, actorUserId, now: deps.now(), days: CO_OWNER_REQUEST_DAYS });
  switch (outcome.kind) {
    case "owner_only":
      throw ownerOnly();
    case "not_staff":
      throw new OrgsError(404, "not_staff", CO_OWNER_WORDS.not_staff);
    case "already_owner":
      throw new OrgsError(409, "already_owner", CO_OWNER_WORDS.already_owner);
    case "already_requested":
      throw new OrgsError(409, "already_requested", CO_OWNER_WORDS.already_requested);
    case "sent":
      break;
  }
  // The request is saved before the email goes: an email that fails leaves it waiting on
  // their Overview, and the owner is told it was not emailed.
  let emailed = false;
  const address = outcome.email;
  const suppressed = address !== null && deps.addressKey !== null && (await suppressionsFor(deps.sql, gymId, [emailHmac(deps.addressKey, address)])).size > 0;
  if (address !== null && !suppressed && (await repo.claimEmail(deps.sql, { gymId, userId, requestId: outcome.requestId, now: deps.now() }))) {
    try {
      await deps.email.sendCoOwnerRequest({
        to: address,
        ownerName: cleanGymText(outcome.ownerName, GYM_TEXT_IN_EMAIL_CHARS),
        gymName: gymNameForEmail(outcome.gymName),
        days: CO_OWNER_REQUEST_DAYS,
        consoleLink: `${deps.webOrigin}/console/${encodeURIComponent(outcome.gymSlug)}`,
      });
      emailed = true;
    } catch (err) {
      deps.log.warn({ event: "co_owner.email_failed", gymId, errName: err instanceof Error ? err.name : typeof err }, "a co-owner request email was not sent");
    }
  }
  return { request: { userId, expiresAt: outcome.expiresAt.toISOString() }, emailed };
}

export async function cancelCoOwnerRequest(deps: CoOwnerDeps, actorUserId: string, gymId: string, userId: string): Promise<CancelCoOwnerRequestResponse> {
  await requirePrivilege(deps, gymId, actorUserId, "staff.manage");
  const outcome = await repo.cancelRequest(deps.sql, { gymId, userId, actorUserId, now: deps.now() });
  switch (outcome.kind) {
    case "owner_only":
      throw ownerOnly();
    case "no_request":
      throw new OrgsError(404, "no_request", CO_OWNER_WORDS.no_request);
    case "cancelled":
      return { status: "cancelled" };
  }
}

export async function myCoOwnerRequest(deps: CoOwnerDeps, userId: string, gymId: string): Promise<MyCoOwnerRequestResponse> {
  await requireStaff(deps, gymId, userId);
  const request = await repo.myRequest(deps.sql, { gymId, userId, now: deps.now() });
  return {
    request: request === null ? null : { id: request.id, ownerName: request.ownerName.trim(), expiresAt: request.expiresAt.toISOString() },
  };
}

export async function answerCoOwnerRequest(
  deps: CoOwnerDeps,
  userId: string,
  gymId: string,
  requestId: string,
  accept: boolean,
): Promise<AnswerCoOwnerRequestResponse> {
  await requireStaff(deps, gymId, userId);
  const outcome = await repo.answerRequest(deps.sql, {
    gymId,
    requestId,
    userId,
    accept,
    ownerPrivileges: defaultPrivilegesFor("owner"),
    now: deps.now(),
  });
  switch (outcome.kind) {
    case "not_found":
      throw new OrgsError(404, "no_request", CO_OWNER_WORDS.request_gone);
    case "request_gone":
      throw new OrgsError(409, "request_gone", CO_OWNER_WORDS.request_gone);
    case "accepted":
    case "declined":
      return { status: outcome.kind };
  }
}

// ── The owner hands the gym to a co-owner (ROADMAP 4b-ii) ──────────────────────────────────
// The same gates as a co-owner request: `staff.manage` lets the owner and every co-owner
// through, and the repo refuses anybody who is not the gym's own owner by its owner id.

const notOwner = (): OrgsError => new OrgsError(403, "owner_only", OWNER_REQUEST_WORDS.owner_only);
const planRefusal = (kind: "paid_plan" | "plan_overdue" | "plan_unclear" | "plan_renewing"): OrgsError =>
  new OrgsError(409, kind, OWNER_REQUEST_WORDS[kind]);

/** Tell Paddle the gym's handed-over plan ends with its month, now rather than at the worker's
 *  next minute. A failure is logged and left to the worker. */
async function endHandedOverPlans(billing: BillingDeps, gymId: string): Promise<void> {
  const plan = await repo.handedOverPlanRef(billing.sql, gymId);
  if (plan !== null) await endHandedOverPlan(billing, { gymId, ...plan });
}

export async function sendOwnerRequest(deps: CoOwnerDeps, actorUserId: string, gymId: string, userId: string): Promise<SendOwnerRequestResponse> {
  // Not the read-only gate a co-owner request has: a gym past its trial with no plan is handed
  // over too, often to the partner who will pay for it.
  await requirePrivilege(deps, gymId, actorUserId, "staff.manage");
  const outcome = await repo.sendOwnerRequest(deps.sql, { gymId, userId, actorUserId, now: deps.now(), days: OWNER_REQUEST_DAYS });
  switch (outcome.kind) {
    case "owner_only":
      throw notOwner();
    case "not_staff":
      throw new OrgsError(404, "not_staff", OWNER_REQUEST_WORDS.not_staff);
    case "not_co_owner":
      throw new OrgsError(409, "not_co_owner", OWNER_REQUEST_WORDS.not_co_owner);
    case "paid_plan":
    case "plan_overdue":
    case "plan_unclear":
      throw planRefusal(outcome.kind);
    case "already_requested":
      throw new OrgsError(409, "already_requested", OWNER_REQUEST_WORDS.already_requested);
    case "sent":
      break;
  }
  // Saved before the email goes, as a co-owner request is.
  let emailed = false;
  const address = outcome.email;
  const suppressed = address !== null && deps.addressKey !== null && (await suppressionsFor(deps.sql, gymId, [emailHmac(deps.addressKey, address)])).size > 0;
  if (address !== null && !suppressed && (await repo.claimOwnerEmail(deps.sql, { gymId, userId, requestId: outcome.requestId, now: deps.now() }))) {
    try {
      await deps.email.sendOwnerRequest({
        to: address,
        ownerName: cleanGymText(outcome.ownerName, GYM_TEXT_IN_EMAIL_CHARS),
        gymName: gymNameForEmail(outcome.gymName),
        days: OWNER_REQUEST_DAYS,
        consoleLink: `${deps.webOrigin}/console/${encodeURIComponent(outcome.gymSlug)}`,
      });
      emailed = true;
    } catch (err) {
      deps.log.warn({ event: "owner_request.email_failed", gymId, errName: err instanceof Error ? err.name : typeof err }, "an owner request email was not sent");
    }
  }
  return { request: { userId, expiresAt: outcome.expiresAt.toISOString() }, emailed };
}

export async function cancelOwnerRequest(deps: CoOwnerDeps, actorUserId: string, gymId: string, userId: string): Promise<CancelOwnerRequestResponse> {
  await requirePrivilege(deps, gymId, actorUserId, "staff.manage");
  const outcome = await repo.cancelOwnerRequest(deps.sql, { gymId, userId, actorUserId, now: deps.now() });
  switch (outcome.kind) {
    case "owner_only":
      throw notOwner();
    case "no_request":
      throw new OrgsError(404, "no_request", OWNER_REQUEST_WORDS.no_request);
    case "cancelled":
      return { status: "cancelled" };
  }
}

export async function myOwnerRequest(deps: CoOwnerDeps, userId: string, gymId: string): Promise<MyOwnerRequestResponse> {
  await requireStaff(deps, gymId, userId);
  const request = await repo.myOwnerRequest(deps.sql, { gymId, userId, now: deps.now() });
  if (request === null) return { request: null };
  const plan = await repo.gymHandOverPlan(deps.sql, gymId);
  return {
    request: {
      id: request.id,
      ownerName: request.ownerName.trim(),
      expiresAt: request.expiresAt.toISOString(),
      planStops: repo.planStops(plan),
    },
  };
}

export async function answerOwnerRequest(
  deps: CoOwnerDeps,
  userId: string,
  gymId: string,
  requestId: string,
  accept: boolean,
): Promise<AnswerOwnerRequestResponse> {
  await requireStaff(deps, gymId, userId);
  const outcome = await repo.answerOwnerRequest(deps.sql, {
    gymId,
    requestId,
    userId,
    accept,
    ownerPrivileges: defaultPrivilegesFor("owner"),
    now: deps.now(),
  });
  switch (outcome.kind) {
    case "not_found":
      throw new OrgsError(404, "no_request", OWNER_REQUEST_WORDS.request_gone);
    case "request_gone":
      throw new OrgsError(409, "request_gone", OWNER_REQUEST_WORDS.request_gone);
    case "paid_plan":
    case "plan_overdue":
    case "plan_unclear":
    case "plan_renewing":
      throw planRefusal(outcome.kind);
    case "accepted":
      // After the hand-over is saved: the old owner's payment windows can no longer be paid,
      // and their plan stops renewing at Paddle (the worker tells Paddle again if this fails).
      if (deps.billing !== null) {
        await closeSuperseded(deps.billing, outcome.closed);
        if (outcome.planEnds) await endHandedOverPlans(deps.billing, gymId);
      }
      return { status: "accepted" };
    case "declined":
      return { status: "declined" };
  }
}
