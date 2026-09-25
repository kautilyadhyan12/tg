// A gym's leads (spec Part 3 §16.3; ROADMAP 20c-i). Thin: authenticate, parse, hand
// to the service, which checks the privilege before it spends the rate limit.
//
// Both limits are keyed on the user with an explicit `ipMax`: a front desk is one
// address with several staff signed in on it.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import { createLeadRequestSchema, joinLeadRequestSchema, leadsQuerySchema, updateLeadRequestSchema } from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { leadParamsSchema, orgParamsSchema } from "../schemas.js";
import * as service from "./service.js";

function parseOr400<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    // Issue paths and codes only, never the value: it is somebody's name or number.
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

export interface LeadRouteDeps {
  sql: Sql;
  redis: RedisLike;
}

export function registerLeadRoutes(app: FastifyInstance, deps: LeadRouteDeps): void {
  const leadDeps: service.LeadsDeps = { sql: deps.sql, now: () => new Date() };

  /** Reads follow a search box (one read after each pause in typing): the member
   *  list's read allowance. */
  const readLimit = createDualRateLimit({
    name: "leads_read",
    max: 600,
    ipMax: 2000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  /** A desk adds a lead a visit; 300 an hour each is far above that. */
  const writeLimit = createDualRateLimit({
    name: "leads_write",
    max: 300,
    ipMax: 900,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  /** False when the limiter has answered 429 itself. */
  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };
  const readGate = gate(readLimit);
  const writeGate = gate(writeLimit);
  const signedIn = { preHandler: [app.authenticate] };

  app.get("/v1/orgs/:gymId/leads", signedIn, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(leadsQuerySchema, req.query, req, reply);
    if (query === null) return;
    const page = await service.listLeads(leadDeps, requireUserId(req), params.gymId, query, readGate(req, reply));
    if (page === null) return;
    return reply.status(200).send(page);
  });

  app.get("/v1/orgs/:gymId/leads/:leadId", signedIn, async (req, reply) => {
    const params = parseOr400(leadParamsSchema, req.params, req, reply);
    if (params === null) return;
    const lead = await service.getLead(leadDeps, requireUserId(req), params.gymId, params.leadId, readGate(req, reply));
    if (lead === null) return;
    return reply.status(200).send({ lead });
  });

  app.post("/v1/orgs/:gymId/leads", signedIn, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(createLeadRequestSchema, req.body, req, reply);
    if (body === null) return;
    const lead = await service.createLead(leadDeps, requireUserId(req), params.gymId, body, writeGate(req, reply));
    if (lead === null) return;
    return reply.status(201).send({ lead });
  });

  /** PATCH: a field left out is left alone (`updateLeadRequestSchema`). */
  app.patch("/v1/orgs/:gymId/leads/:leadId", signedIn, async (req, reply) => {
    const params = parseOr400(leadParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(updateLeadRequestSchema, req.body, req, reply);
    if (body === null) return;
    const lead = await service.updateLead(leadDeps, requireUserId(req), params.gymId, params.leadId, body, writeGate(req, reply));
    if (lead === null) return;
    return reply.status(200).send({ lead });
  });

  app.delete("/v1/orgs/:gymId/leads/:leadId", signedIn, async (req, reply) => {
    const params = parseOr400(leadParamsSchema, req.params, req, reply);
    if (params === null) return;
    const done = await service.deleteLead(leadDeps, requireUserId(req), params.gymId, params.leadId, writeGate(req, reply));
    if (done === null) return;
    return reply.status(204).send();
  });

  /** Joined. The same request twice answers `already_joined` the second time. */
  app.post("/v1/orgs/:gymId/leads/:leadId/join", signedIn, async (req, reply) => {
    const params = parseOr400(leadParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(joinLeadRequestSchema, req.body ?? {}, req, reply);
    if (body === null) return;
    const answer = await service.joinLead(leadDeps, requireUserId(req), params.gymId, params.leadId, body, writeGate(req, reply));
    if (answer.kind === "rate_limited") return;
    if (answer.kind === "joined") return reply.status(200).send(answer.body);
    return reply.status(409).send({
      error: answer.error,
      message: answer.message,
      candidates: answer.candidates,
      requestId: req.id,
    });
  });
}
