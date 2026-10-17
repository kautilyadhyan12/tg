// Who pays for a person (spec Part 3 §14.2; ROADMAP 18i): authenticate, a limit asked only
// of the gym's own staff, Zod-parse, then the service, which owns the authorisation.
//
//   GET    /v1/orgs/:gymId/member-list/entries/:entryId/payer   who pays for them, and whom they pay for (`members.confirm`)
//   PUT    /v1/orgs/:gymId/member-list/entries/:entryId/payer   name who pays for them (`billing.members`)
//   DELETE /v1/orgs/:gymId/member-list/entries/:entryId/payer   they pay for themselves again
//
// Each answers with the person's side of it.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import { setMemberPayerRequestSchema } from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { memberListEntryParamsSchema } from "../schemas.js";
import { staffOnly } from "../staffLimit.js";
import * as service from "./service.js";

function parseOr400<S extends z.ZodTypeAny>(schema: S, value: unknown, req: FastifyRequest, reply: FastifyReply): z.output<S> | null {
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

export function registerPayerRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike }): void {
  const payersDeps: service.PayersDeps = { sql: deps.sql };
  const limitOf = (name: string, max: number, ipMax: number) =>
    createDualRateLimit({ name, max, ipMax, windowMs: 60 * 60 * 1000, identifier: (req) => req.authUser?.id ?? null, redis: deps.redis });
  /** Read with every person's page that is opened, and once for each person a payer pays
   *  for. A gym's staff share one address, so the address ceiling is several people's. */
  const readLimit = limitOf("org_member_payer_read", 1200, 6000);
  const writeLimit = limitOf("org_member_payer_write", 300, 900);
  const url = "/v1/orgs/:gymId/member-list/entries/:entryId/payer";

  app.get(url, { preHandler: [app.authenticate, staffOnly(deps.sql, readLimit)] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const answer = await service.getPayers(payersDeps, requireUserId(req), params.gymId, params.entryId);
    return reply.status(200).header("cache-control", "no-store").send(answer);
  });

  app.put(url, { preHandler: [app.authenticate, staffOnly(deps.sql, writeLimit)] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(setMemberPayerRequestSchema, req.body, req, reply);
    if (body === null) return;
    const answer = await service.setPayer(payersDeps, requireUserId(req), params.gymId, params.entryId, body.payerEntryId);
    return reply.status(200).send(answer);
  });

  app.delete(url, { preHandler: [app.authenticate, staffOnly(deps.sql, writeLimit)] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const answer = await service.removePayer(payersDeps, requireUserId(req), params.gymId, params.entryId);
    return reply.status(200).send(answer);
  });
}
