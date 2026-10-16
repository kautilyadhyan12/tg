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
  type AnswerCoOwnerRequestResponse,
  type CancelCoOwnerRequestResponse,
  type MyCoOwnerRequestResponse,
  type SendCoOwnerRequestResponse,
} from "@app/shared";
import type { Sql } from "postgres";
import { cleanGymText, GYM_TEXT_IN_EMAIL_CHARS, gymNameForEmail } from "../invites/gymText.js";
import { defaultPrivilegesFor, OrgsError, requirePrivilege, requireStaff, requireWritablePrivilege } from "../service.js";
import type { CoOwnerEmailSender } from "./email.js";
import * as repo from "./repo.js";

export interface CoOwnerDeps {
  sql: Sql;
  email: CoOwnerEmailSender;
  webOrigin: string;
  now: () => Date;
  log: { warn: (obj: object, msg: string) => void };
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
  if (outcome.email !== null) {
    try {
      await deps.email.sendCoOwnerRequest({
        to: outcome.email,
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
