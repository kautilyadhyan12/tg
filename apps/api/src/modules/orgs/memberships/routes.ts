// The membership types' routes (spec Part 3 §13.1; ROADMAP 17a-i): authenticate,
// rate-limit, Zod-parse, hand to the service, which owns the authorisation.
//
//   GET    /v1/orgs/:gymId/membership-types                   the price list (`members.read`)
//   POST   /v1/orgs/:gymId/membership-types                   add a type (`memberships.manage`)
//   PUT    /v1/orgs/:gymId/membership-types/:typeId           change one, every field
//   DELETE /v1/orgs/:gymId/membership-types/:typeId           archive it
//   POST   /v1/orgs/:gymId/membership-types/:typeId/restore   put it back
//
// Every change answers with the whole price list.
//
// A person's memberships (§13.2; 17a-ii), under their record on the gym's list:
//
//   GET  /v1/orgs/:gymId/member-list/entries/:entryId/memberships            (`members.confirm`)
//   POST /v1/orgs/:gymId/member-list/entries/:entryId/memberships            give one
//   POST …/memberships/:membershipId/freeze | unfreeze | cancel | paid       change one
//
// Each answers with the person's memberships.
//
// A list's membership word linked to a type (§13.2; 17a-iii), all on `members.confirm`:
//
//   GET  /v1/orgs/:gymId/membership-words            the list's words and their links
//   POST /v1/orgs/:gymId/membership-words/preview    who a link would give the type to
//   POST /v1/orgs/:gymId/membership-words/link       link it, and give it to them
//   POST /v1/orgs/:gymId/membership-words/unlink     forget the link; nobody changes
//
// The word travels in the body, never the address: it is a cell of the gym's file.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import {
  MEMBERSHIP_HAS_BOOKINGS_ERROR,
  cancelHeldMembershipRequestSchema,
  giveHeldMembershipRequestSchema,
  membershipLinkPreviewRequestSchema,
  membershipLinkRequestSchema,
  membershipUnlinkRequestSchema,
  billSettingsSchema,
  paidHeldMembershipRequestSchema,
  recordMemberPaymentRequestSchema,
  cancelMemberBillRequestSchema,
  noteMemberRefundRequestSchema,
  saveGymMembershipTypeRequestSchema,
  updateGymMembershipTypeRequestSchema,
} from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import {
  heldMembershipParamsSchema,
  memberPaymentParamsSchema,
  memberBillParamsSchema,
  memberRefundParamsSchema,
  memberListEntryParamsSchema,
  membershipTypeParamsSchema,
  orgParamsSchema,
} from "../schemas.js";
import { staffOnly } from "../staffLimit.js";
import * as held from "./heldService.js";
import * as service from "./service.js";
import * as words from "./wordsService.js";

function parseOr400<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    // Issue paths and codes only, never the offending value.
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
      requestId: req.id,
    });
    return null;
  }
  return parsed.data;
}

function requireUserId(req: FastifyRequest): string {
  const userId = req.authUser?.id;
  if (userId === undefined) throw new Error("authenticate preHandler did not run");
  return userId;
}

/** A change to one membership answered: the person's memberships, or the 409 a cancel
 *  answers while it would end bookings nobody has confirmed. */
function sendHeld(reply: FastifyReply, req: FastifyRequest, answer: Awaited<ReturnType<typeof held.moveHeldMembership>>) {
  if (answer.kind === "ok") return reply.status(200).send(answer.body);
  return reply.status(409).send({
    error: MEMBERSHIP_HAS_BOOKINGS_ERROR,
    message:
      answer.ending.ptSessions === undefined
        ? "They have classes booked on this membership. Those bookings will end if you go ahead."
        : answer.ending.booked === 0
          ? "They have personal training sessions booked on this membership. Those sessions will be cancelled if you go ahead."
          : "They have classes and personal training sessions booked on this membership. Those will end if you go ahead.",
    ending: answer.ending,
    requestId: req.id,
  });
}

export interface MembershipRouteDeps {
  sql: Sql;
  redis: RedisLike;
  /** Tests move the clock; production uses the real one. A cancel decides which sessions
   *  and classes are still to come by it, so it is the clock a booking reads. */
  now?: () => Date;
}

export function registerMembershipRoutes(app: FastifyInstance, deps: MembershipRouteDeps): void {
  const now = deps.now ?? (() => new Date());
  const membershipDeps: service.MembershipsDeps = { sql: deps.sql, now };

  /** Keyed on the person; the address ceiling is three times theirs, so three
   *  staff at one front desk never throttle each other. */
  const limit = createDualRateLimit({
    name: "org_membership_types",
    max: 300,
    ipMax: 900,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const guarded = { preHandler: [app.authenticate, staffOnly(deps.sql, limit)] };

  app.get("/v1/orgs/:gymId/membership-types", guarded, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const list = await service.getMembershipTypes(membershipDeps, requireUserId(req), params.gymId);
    return reply.status(200).send(list);
  });

  app.post("/v1/orgs/:gymId/membership-types", guarded, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(saveGymMembershipTypeRequestSchema, req.body, req, reply);
    if (body === null) return;
    const list = await service.createMembershipType(membershipDeps, requireUserId(req), params.gymId, body);
    return reply.status(201).send(list);
  });

  app.put("/v1/orgs/:gymId/membership-types/:typeId", guarded, async (req, reply) => {
    const params = parseOr400(membershipTypeParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(updateGymMembershipTypeRequestSchema, req.body, req, reply);
    if (body === null) return;
    const list = await service.updateMembershipType(
      membershipDeps,
      requireUserId(req),
      params.gymId,
      params.typeId,
      body,
    );
    return reply.status(200).send(list);
  });

  app.delete("/v1/orgs/:gymId/membership-types/:typeId", guarded, async (req, reply) => {
    const params = parseOr400(membershipTypeParamsSchema, req.params, req, reply);
    if (params === null) return;
    const list = await service.archiveMembershipType(
      membershipDeps,
      requireUserId(req),
      params.gymId,
      params.typeId,
    );
    return reply.status(200).send(list);
  });

  app.post("/v1/orgs/:gymId/membership-types/:typeId/restore", guarded, async (req, reply) => {
    const params = parseOr400(membershipTypeParamsSchema, req.params, req, reply);
    if (params === null) return;
    const list = await service.restoreMembershipType(
      membershipDeps,
      requireUserId(req),
      params.gymId,
      params.typeId,
    );
    return reply.status(200).send(list);
  });

  // ── A person's memberships ──

  const heldDeps: held.HeldDeps = { sql: deps.sql, now };
  /** The changes' own allowance, so a busy desk never uses up the price list's: a gym
   *  moving in gives its 200 members a membership each. The read sits under the app-wide
   *  limit alone, as the person's page it is drawn on does. */
  const heldLimit = createDualRateLimit({
    name: "org_held_memberships",
    max: 300,
    ipMax: 900,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const heldGuarded = { preHandler: [app.authenticate, staffOnly(deps.sql, heldLimit)] };
  const heldUrl = "/v1/orgs/:gymId/member-list/entries/:entryId/memberships";

  app.get(heldUrl, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const list = await held.getHeldMemberships(heldDeps, requireUserId(req), params.gymId, params.entryId);
    return reply.status(200).send(list);
  });

  app.post(heldUrl, heldGuarded, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(giveHeldMembershipRequestSchema, req.body, req, reply);
    if (body === null) return;
    const list = await held.giveHeldMembership(heldDeps, requireUserId(req), params.gymId, params.entryId, body);
    return reply.status(201).send(list);
  });

  app.post(`${heldUrl}/:membershipId/freeze`, heldGuarded, async (req, reply) => {
    const params = parseOr400(heldMembershipParamsSchema, req.params, req, reply);
    if (params === null) return;
    const answer = await held.moveHeldMembership(
      heldDeps,
      requireUserId(req),
      params.gymId,
      params.entryId,
      params.membershipId,
      { type: "freeze" },
    );
    return sendHeld(reply, req, answer);
  });

  app.post(`${heldUrl}/:membershipId/unfreeze`, heldGuarded, async (req, reply) => {
    const params = parseOr400(heldMembershipParamsSchema, req.params, req, reply);
    if (params === null) return;
    const answer = await held.moveHeldMembership(
      heldDeps,
      requireUserId(req),
      params.gymId,
      params.entryId,
      params.membershipId,
      { type: "unfreeze" },
    );
    return sendHeld(reply, req, answer);
  });

  app.post(`${heldUrl}/:membershipId/cancel`, heldGuarded, async (req, reply) => {
    const params = parseOr400(heldMembershipParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(cancelHeldMembershipRequestSchema, req.body, req, reply);
    if (body === null) return;
    const answer = await held.moveHeldMembership(
      heldDeps,
      requireUserId(req),
      params.gymId,
      params.entryId,
      params.membershipId,
      { type: "cancel", when: body.when },
      body.confirmBookings ?? null,
      body.confirmPtSessions ?? null,
    );
    return sendHeld(reply, req, answer);
  });

  app.post(`${heldUrl}/:membershipId/paid`, heldGuarded, async (req, reply) => {
    const params = parseOr400(heldMembershipParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(paidHeldMembershipRequestSchema, req.body, req, reply);
    if (body === null) return;
    // Since 18a-i this only takes back a mark that has no payment behind it: a period
    // is paid by recording its payment, below.
    const list = await held.undoPaidMark(heldDeps, requireUserId(req), params.gymId, params.entryId, params.membershipId, body.paidPeriods);
    return reply.status(200).send(list);
  });

  // ── Bills and payments (§14.2; 18a-i) ──

  /** Payments have their own allowance, apart from the other changes to a membership:
   *  a desk on the first of the month records one for most of its members. */
  const paymentLimit = createDualRateLimit({
    name: "org_member_payments",
    max: 300,
    ipMax: 900,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const paymentGuarded = { preHandler: [app.authenticate, staffOnly(deps.sql, paymentLimit)] };

  app.post(`${heldUrl}/:membershipId/payments`, paymentGuarded, async (req, reply) => {
    const params = parseOr400(heldMembershipParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(recordMemberPaymentRequestSchema, req.body, req, reply);
    if (body === null) return;
    const list = await held.recordMemberPayment(heldDeps, requireUserId(req), params.gymId, params.entryId, params.membershipId, body);
    return reply.status(200).send(list);
  });

  app.post(`${heldUrl}/:membershipId/payments/:paymentId/undo`, paymentGuarded, async (req, reply) => {
    const params = parseOr400(memberPaymentParamsSchema, req.params, req, reply);
    if (params === null) return;
    const list = await held.undoMemberPayment(heldDeps, requireUserId(req), params.gymId, params.entryId, params.membershipId, params.paymentId);
    return reply.status(200).send(list);
  });

  // ── Cancel a bill, note a refund (§14.2; 18a-ii): the payments' own allowance ──

  app.post(`${heldUrl}/:membershipId/bills/:billId/cancel`, paymentGuarded, async (req, reply) => {
    const params = parseOr400(memberBillParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(cancelMemberBillRequestSchema, req.body, req, reply);
    if (body === null) return;
    const list = await held.cancelMemberBill(heldDeps, requireUserId(req), params.gymId, params.entryId, params.membershipId, params.billId, body);
    return reply.status(200).send(list);
  });

  app.post(`${heldUrl}/:membershipId/payments/:paymentId/refunds`, paymentGuarded, async (req, reply) => {
    const params = parseOr400(memberPaymentParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(noteMemberRefundRequestSchema, req.body, req, reply);
    if (body === null) return;
    const list = await held.noteMemberRefund(heldDeps, requireUserId(req), params.gymId, params.entryId, params.membershipId, params.paymentId, body);
    return reply.status(200).send(list);
  });

  app.post(`${heldUrl}/:membershipId/payments/:paymentId/refunds/:refundId/undo`, paymentGuarded, async (req, reply) => {
    const params = parseOr400(memberRefundParamsSchema, req.params, req, reply);
    if (params === null) return;
    const list = await held.undoMemberRefund(
      heldDeps,
      requireUserId(req),
      params.gymId,
      params.entryId,
      params.membershipId,
      params.paymentId,
      params.refundId,
    );
    return reply.status(200).send(list);
  });

  const billSettingsUrl = "/v1/orgs/:gymId/bill-settings";

  app.get(billSettingsUrl, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    return reply.status(200).send(await held.getBillSettings(heldDeps, requireUserId(req), params.gymId));
  });

  app.put(billSettingsUrl, heldGuarded, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(billSettingsSchema, req.body, req, reply);
    if (body === null) return;
    return reply.status(200).send(await held.saveBillSettings(heldDeps, requireUserId(req), params.gymId, body));
  });

  // ── A list's word linked to a type ──

  const wordsUrl = "/v1/orgs/:gymId/membership-words";

  app.get(wordsUrl, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    return reply.status(200).send(await words.getMembershipWords(heldDeps, requireUserId(req), params.gymId));
  });

  app.post(`${wordsUrl}/preview`, heldGuarded, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(membershipLinkPreviewRequestSchema, req.body, req, reply);
    if (body === null) return;
    return reply.status(200).send(await words.previewMembershipLink(heldDeps, requireUserId(req), params.gymId, body));
  });

  app.post(`${wordsUrl}/link`, heldGuarded, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(membershipLinkRequestSchema, req.body, req, reply);
    if (body === null) return;
    return reply.status(200).send(await words.linkMembershipWord(heldDeps, requireUserId(req), params.gymId, body));
  });

  app.post(`${wordsUrl}/unlink`, heldGuarded, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(membershipUnlinkRequestSchema, req.body, req, reply);
    if (body === null) return;
    return reply.status(200).send(await words.unlinkMembershipWord(heldDeps, requireUserId(req), params.gymId, body));
  });
}
