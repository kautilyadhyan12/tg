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
  type OwnerCardResponse,
  type SendCoOwnerRequestResponse,
  type SendOwnerRequestResponse,
} from "@app/shared";
import type { Sql } from "postgres";
import { closeSuperseded, type BillingDeps } from "../../billing/service.js";
import { cleanGymText, GYM_TEXT_IN_EMAIL_CHARS, gymNameForEmail } from "../invites/gymText.js";
import { defaultPrivilegesFor, OrgsError, requirePrivilege, requireStaff, requireWritablePrivilege } from "../service.js";
import { emailHmac } from "../invites/address.js";
import { suppressionsFor } from "../invites/repo.js";
import type { CoOwnerEmailSender } from "./email.js";
import { openCardWindow, pointBack, settleCard } from "./paidHandOver.js";
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
const paidPlan = (): OrgsError => new OrgsError(409, "paid_plan", OWNER_REQUEST_WORDS.paid_plan);
const planRefusal = (kind: "paid_plan" | "plan_overdue" | "plan_ending"): OrgsError => new OrgsError(409, kind, OWNER_REQUEST_WORDS[kind]);
const cardUnavailable = (): OrgsError => new OrgsError(503, "card_unavailable", OWNER_REQUEST_WORDS.card_unavailable);
const requestGone = (): OrgsError => new OrgsError(409, "request_gone", OWNER_REQUEST_WORDS.request_gone);

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
    case "plan_ending":
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
  // A card window open for them is pointed back at the plan's payer first, so Paddle refuses
  // it even in a tab still open; Accept pressed meanwhile opens it again, and it goes round.
  for (let tries = 0; tries < 3; tries++) {
    const window = (await repo.gymOwnerId(deps.sql, gymId)) === actorUserId ? await repo.openCardWindowTo(deps.sql, gymId, userId) : null;
    if (window !== null) {
      const paddle = deps.billing?.paddle ?? null;
      if (deps.billing === null || paddle === null) throw cardUnavailable();
      const back = await pointBack(deps.billing, paddle, window);
      if (back === "retry") throw cardUnavailable();
      if (back === "saved") {
        // Their card was saved before Cancel: the hand-over went through.
        if ((await settleCard(deps.billing, window, defaultPrivilegesFor("owner"))) === "accepted") {
          throw new OrgsError(409, "card_saved", OWNER_REQUEST_WORDS.card_saved);
        }
        throw cardUnavailable();
      }
    }
    const outcome = await repo.cancelOwnerRequest(deps.sql, { gymId, userId, actorUserId, now: deps.now(), cardOpenedAt: window?.openedAt ?? null });
    switch (outcome.kind) {
      case "owner_only":
        throw notOwner();
      case "no_request":
        throw new OrgsError(404, "no_request", OWNER_REQUEST_WORDS.no_request);
      case "cancelled":
        return { status: "cancelled" };
      case "card_reopened":
        continue;
    }
  }
  throw cardUnavailable();
}

export async function myOwnerRequest(deps: CoOwnerDeps, userId: string, gymId: string): Promise<MyOwnerRequestResponse> {
  await requireStaff(deps, gymId, userId);
  const request = await repo.myOwnerRequest(deps.sql, { gymId, userId, now: deps.now() });
  if (request === null) return { request: null };
  const plan = await repo.gymHandOverPlan(deps.sql, gymId);
  return {
    request: { id: request.id, ownerName: request.ownerName.trim(), expiresAt: request.expiresAt.toISOString(), cardNeeded: plan.kind === "paddle" },
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
      throw requestGone();
    case "paid_plan":
      throw paidPlan();
    case "plan_overdue":
    case "plan_ending":
      throw planRefusal(outcome.kind);
    case "card_needed": {
      if (deps.billing === null) throw cardUnavailable();
      const opened = await openCardWindow(deps.billing, { gymId, requestId, userId, subscriptionRef: outcome.subscriptionRef, email: outcome.email, stored: outcome.stored });
      switch (opened.kind) {
        case "opened":
          return { status: "card_needed", card: opened.card };
        case "request_gone":
          throw requestGone();
        case "email_unusable":
          throw new OrgsError(409, "email_unusable", OWNER_REQUEST_WORDS.email_unusable);
        case "unavailable":
          throw cardUnavailable();
      }
      break;
    }
    case "accepted":
      // After the hand-over is saved: the old owner's payment windows can no longer be paid.
      if (deps.billing !== null) await closeSuperseded(deps.billing, outcome.closed);
      return { status: "accepted" };
    case "declined":
      return { status: "declined" };
  }
  throw cardUnavailable();
}

/** Paddle's window said the card was saved: the gym is theirs once Paddle confirms it. Asked
 *  by the person the request was sent to and nobody else; the worker asks too. */
export async function ownerCardSaved(deps: CoOwnerDeps, userId: string, gymId: string, requestId: string): Promise<OwnerCardResponse> {
  await requireStaff(deps, gymId, userId);
  const window = await repo.cardWindowOf(deps.sql, { gymId, requestId, userId });
  if (window === null) throw new OrgsError(404, "no_request", OWNER_REQUEST_WORDS.request_gone);
  if (window.state !== "pending" && window.state !== "accepted") throw requestGone();
  if (deps.billing === null) return { status: "waiting" };
  const outcome = await settleCard(deps.billing, window, defaultPrivilegesFor("owner"));
  if (outcome === "request_gone") throw requestGone();
  return { status: outcome };
}
