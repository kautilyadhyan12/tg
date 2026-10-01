// Staff invited by email (Part 3 §10.3; ROADMAP 4a-i).
//   POST   /v1/orgs/:gymId/staff/invites                  invite an address as manager or trainer
//   GET    /v1/orgs/:gymId/staff/invites                  what is waiting
//   DELETE /v1/orgs/:gymId/staff/invites/:inviteId        cancel, or take an ended one off the list
//   GET    /v1/orgs/staff-invitations                     the caller's own, by their proved address
//   POST   /v1/orgs/staff-invitations/:invitationId/accept
//   POST   /v1/orgs/staff-invitations/:invitationId/decline
// The owner's three need `staff.manage`, checked in the service. The caller's own need
// only a sign-in: their proved address is the whole credential.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import { createStaffInviteRequestSchema, staffInvitationParamsSchema, staffInviteParamsSchema } from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import type { InviteSettings } from "../invites/settings.js";
import { orgParamsSchema } from "../schemas.js";
import * as service from "./service.js";

const HOUR_MS = 60 * 60 * 1000;

function parseOr400<S extends z.ZodTypeAny>(schema: S, value: unknown, req: FastifyRequest, reply: FastifyReply): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
      requestId: req.id,
    });
    return null;
  }
  return parsed.data;
}

function callerOf(req: FastifyRequest): service.Caller {
  const user = req.authUser;
  if (user === undefined) throw new Error("authenticate preHandler did not run");
  return user;
}

export function registerStaffInviteRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; redis: RedisLike; invites: InviteSettings | null; now?: () => Date },
): void {
  const inviteDeps: service.StaffInviteDeps = { sql: deps.sql, invites: deps.invites, now: deps.now ?? (() => new Date()) };
  const byPerson = (req: FastifyRequest): string | null => req.authUser?.id ?? null;
  // Every invitation is an email: the gym's own caps (20 a day) are the real limit; this
  // stops a script. Owners of several gyms can share one office address.
  const createLimit = createDualRateLimit({ name: "staff_invite_create", max: 30, ipMax: 300, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  // The console asks once on its front page.
  const readLimit = createDualRateLimit({ name: "staff_invitation_read", max: 60, ipMax: 3000, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  // A gym's whole staff may accept from its one wi-fi address.
  const answerLimit = createDualRateLimit({ name: "staff_invitation_answer", max: 10, ipMax: 600, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });

  app.post("/v1/orgs/:gymId/staff/invites", { preHandler: [app.authenticate, createLimit] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(createStaffInviteRequestSchema, req.body, req, reply);
    if (body === null) return;
    return reply.status(201).send(await service.createStaffInvite(inviteDeps, callerOf(req).id, params.gymId, body));
  });

  app.get("/v1/orgs/:gymId/staff/invites", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    return reply.status(200).send(await service.listStaffInvites(inviteDeps, callerOf(req).id, params.gymId));
  });

  app.delete("/v1/orgs/:gymId/staff/invites/:inviteId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(staffInviteParamsSchema, req.params, req, reply);
    if (params === null) return;
    return reply.status(200).send(await service.cancelStaffInvite(inviteDeps, callerOf(req).id, params.gymId, params.inviteId));
  });

  app.get("/v1/orgs/staff-invitations", { preHandler: [app.authenticate, readLimit] }, async (req, reply) => {
    return reply.status(200).send(await service.myStaffInvitations(inviteDeps, callerOf(req)));
  });

  app.post("/v1/orgs/staff-invitations/:invitationId/accept", { preHandler: [app.authenticate, answerLimit] }, async (req, reply) => {
    const params = parseOr400(staffInvitationParamsSchema, req.params, req, reply);
    if (params === null) return;
    return reply.status(200).send(await service.acceptStaffInvitation(inviteDeps, callerOf(req), params.invitationId));
  });

  app.post("/v1/orgs/staff-invitations/:invitationId/decline", { preHandler: [app.authenticate, answerLimit] }, async (req, reply) => {
    const params = parseOr400(staffInvitationParamsSchema, req.params, req, reply);
    if (params === null) return;
    return reply.status(200).send(await service.declineStaffInvitation(inviteDeps, callerOf(req), params.invitationId));
  });
}
