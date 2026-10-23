// A business's membership agreement (ROADMAP 18u-i):
//   GET    /v1/orgs/:gymId/agreement        its words and how many memberships signed them (`org.manage`)
//   PUT    /v1/orgs/:gymId/agreement        save the words
//   DELETE /v1/orgs/:gymId/agreement        stop asking for it
//   GET    /v1/orgs/:gymId/member-list/entries/:entryId/memberships/:membershipId/agreement         the desk's box (`members.confirm`)
//   POST   /v1/orgs/:gymId/member-list/entries/:entryId/memberships/:membershipId/agreement/sign    the person signs
//   POST   /v1/orgs/:gymId/member-list/entries/:entryId/memberships/:membershipId/agreement/email   the copy, emailed again
// Authenticate, then who the caller is at this gym, then the limit, then the handler: the
// service asks the tick first and the limit after it.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { saveGymAgreementBodySchema, signMembershipAgreementBodySchema } from "@app/shared";
import type { Sql } from "postgres";
import type { z } from "zod";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { heldMembershipParamsSchema, orgParamsSchema } from "../schemas.js";
import type { AgreementEmailSender } from "./email.js";
import * as service from "./service.js";

const HOUR_MS = 60 * 60 * 1000;

function parseOr400<S extends z.ZodTypeAny>(schema: S, value: unknown, req: FastifyRequest, reply: FastifyReply): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    // Issue paths and codes only, never the value. The first ten: a body can be long.
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues
        .slice(0, 10)
        .map((issue) => `${issue.path.join(".")}: ${issue.code}`)
        .join("; "),
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

export function registerAgreementRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; redis: RedisLike; now: () => Date; email: AgreementEmailSender; addressKey: Buffer | null },
): void {
  const agreementDeps: service.AgreementDeps = { sql: deps.sql, now: deps.now, email: deps.email, addressKey: deps.addressKey, log: app.log };
  const byPerson = (req: FastifyRequest): string | null => req.authUser?.id ?? null;
  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };

  // Settings reads once a visit and after each save; a gym's few staff share an address.
  const staffReadLimit = createDualRateLimit({ name: "agreement_staff_read", max: 300, ipMax: 900, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  const staffWriteLimit = createDualRateLimit({ name: "agreement_staff_write", max: 30, ipMax: 90, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  // The desk: one member of staff giving a queue of new people their memberships on a busy
  // evening, a few staff on one address, and a gym moving in signing its members up in a day.
  const deskReadLimit = createDualRateLimit({ name: "agreement_desk_read", max: 600, ipMax: 1800, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  const deskSignLimit = createDualRateLimit({ name: "agreement_desk_sign", max: 200, ipMax: 600, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  // Each is an email to a member: a few an hour is the desk's whole need.
  const copyLimit = createDualRateLimit({ name: "agreement_copy_email", max: 30, ipMax: 90, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });

  const url = "/v1/orgs/:gymId/agreement";

  app.get(url, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const agreement = await service.getGymAgreement(agreementDeps, requireUserId(req), params.gymId, gate(staffReadLimit)(req, reply));
    if (agreement === null) return;
    return reply.status(200).header("cache-control", "no-store").send(agreement);
  });

  app.put(url, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(saveGymAgreementBodySchema, req.body, req, reply);
    if (body === null) return;
    const agreement = await service.saveGymAgreement(agreementDeps, requireUserId(req), params.gymId, body.text, gate(staffWriteLimit)(req, reply));
    if (agreement === null) return;
    return reply.status(200).header("cache-control", "no-store").send(agreement);
  });

  app.delete(url, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const agreement = await service.stopGymAgreement(agreementDeps, requireUserId(req), params.gymId, gate(staffWriteLimit)(req, reply));
    if (agreement === null) return;
    return reply.status(200).header("cache-control", "no-store").send(agreement);
  });

  const deskUrl = "/v1/orgs/:gymId/member-list/entries/:entryId/memberships/:membershipId/agreement";

  app.get(deskUrl, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(heldMembershipParamsSchema, req.params, req, reply);
    if (params === null) return;
    const box = await service.getMembershipAgreement(agreementDeps, requireUserId(req), params.gymId, params.entryId, params.membershipId, gate(deskReadLimit)(req, reply));
    if (box === null) return;
    return reply.status(200).header("cache-control", "no-store").send(box);
  });

  app.post(`${deskUrl}/sign`, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(heldMembershipParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(signMembershipAgreementBodySchema, req.body, req, reply);
    if (body === null) return;
    const signed = await service.signMembershipAgreement(
      agreementDeps,
      requireUserId(req),
      params.gymId,
      params.entryId,
      params.membershipId,
      body,
      gate(deskSignLimit)(req, reply),
    );
    if (signed === null) return;
    return reply.status(200).header("cache-control", "no-store").send(signed);
  });

  app.post(`${deskUrl}/email`, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(heldMembershipParamsSchema, req.params, req, reply);
    if (params === null) return;
    const sent = await service.emailAgreementCopy(agreementDeps, requireUserId(req), params.gymId, params.entryId, params.membershipId, gate(copyLimit)(req, reply));
    if (sent === null) return;
    return reply.status(200).header("cache-control", "no-store").send(sent);
  });
}
