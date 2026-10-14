// A gym's waiver (ROADMAP 3e-i):
//   GET    /v1/orgs/:gymId/waiver        the gym's words and how many have signed (`org.manage`)
//   PUT    /v1/orgs/:gymId/waiver        save the words
//   DELETE /v1/orgs/:gymId/waiver        stop asking for it
//   GET    /v1/orgs/:gymId/waiver/mine   a member reads it, with their own signature
//   POST   /v1/orgs/:gymId/waiver/sign   a member signs the wording they were shown
//   GET    /v1/orgs/:gymId/member-list/entries/:entryId/waiver        the desk's box (3e-ii, `members.confirm`)
//   POST   /v1/orgs/:gymId/member-list/entries/:entryId/waiver/sign   a person signs at the desk
// Authenticate, then who the caller is at this gym, then the limit, then the handler: the
// service asks the tick or the membership first and the limit after it.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { saveGymWaiverBodySchema, signAtDeskBodySchema, signWaiverBodySchema } from "@app/shared";
import type { Sql } from "postgres";
import type { z } from "zod";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { memberListEntryParamsSchema, orgParamsSchema } from "../schemas.js";
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

export function registerWaiverRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike; now: () => Date }): void {
  const waiverDeps: service.WaiverDeps = { sql: deps.sql, now: deps.now };
  const byPerson = (req: FastifyRequest): string | null => req.authUser?.id ?? null;
  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };

  // Settings reads once a visit and after each save; a gym's few staff share an address.
  const staffReadLimit = createDualRateLimit({ name: "waiver_staff_read", max: 300, ipMax: 900, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  const staffWriteLimit = createDualRateLimit({ name: "waiver_staff_write", max: 30, ipMax: 90, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  // A gym's members on its one wi-fi address: 200 people each opening their gym's page a
  // few times an hour, and each signing once (and again after a change of words).
  const memberReadLimit = createDualRateLimit({ name: "waiver_member_read", max: 120, ipMax: 6000, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  const signLimit = createDualRateLimit({ name: "waiver_sign", max: 10, ipMax: 600, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  // The desk (3e-ii): one member of staff signing a queue of new people in on a busy
  // evening, and a gym's few staff on one address.
  const deskReadLimit = createDualRateLimit({ name: "waiver_desk_read", max: 300, ipMax: 900, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  const deskSignLimit = createDualRateLimit({ name: "waiver_desk_sign", max: 60, ipMax: 180, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });

  const url = "/v1/orgs/:gymId/waiver";

  app.get(url, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const waiver = await service.getGymWaiver(waiverDeps, requireUserId(req), params.gymId, gate(staffReadLimit)(req, reply));
    if (waiver === null) return;
    return reply.status(200).header("cache-control", "no-store").send(waiver);
  });

  app.put(url, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(saveGymWaiverBodySchema, req.body, req, reply);
    if (body === null) return;
    const waiver = await service.saveGymWaiver(waiverDeps, requireUserId(req), params.gymId, body.text, gate(staffWriteLimit)(req, reply));
    if (waiver === null) return;
    return reply.status(200).header("cache-control", "no-store").send(waiver);
  });

  app.delete(url, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const waiver = await service.stopGymWaiver(waiverDeps, requireUserId(req), params.gymId, gate(staffWriteLimit)(req, reply));
    if (waiver === null) return;
    return reply.status(200).header("cache-control", "no-store").send(waiver);
  });

  app.get(`${url}/mine`, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const mine = await service.getMyWaiver(waiverDeps, requireUserId(req), params.gymId, gate(memberReadLimit)(req, reply));
    if (mine === null) return;
    return reply.status(200).header("cache-control", "no-store").send(mine);
  });

  app.post(`${url}/sign`, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(signWaiverBodySchema, req.body, req, reply);
    if (body === null) return;
    const signed = await service.signMyWaiver(waiverDeps, requireUserId(req), params.gymId, body, gate(signLimit)(req, reply));
    if (signed === null) return;
    return reply.status(200).header("cache-control", "no-store").send(signed);
  });

  const deskUrl = "/v1/orgs/:gymId/member-list/entries/:entryId/waiver";

  app.get(deskUrl, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const desk = await service.getDeskWaiver(waiverDeps, requireUserId(req), params.gymId, params.entryId, gate(deskReadLimit)(req, reply));
    if (desk === null) return;
    return reply.status(200).header("cache-control", "no-store").send(desk);
  });

  app.post(`${deskUrl}/sign`, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(signAtDeskBodySchema, req.body, req, reply);
    if (body === null) return;
    const signed = await service.signAtDesk(waiverDeps, requireUserId(req), params.gymId, params.entryId, body, gate(deskSignLimit)(req, reply));
    if (signed === null) return;
    return reply.status(200).header("cache-control", "no-store").send(signed);
  });
}
