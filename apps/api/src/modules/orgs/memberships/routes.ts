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
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import { saveGymMembershipTypeRequestSchema } from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { membershipTypeParamsSchema, orgParamsSchema } from "../schemas.js";
import * as service from "./service.js";

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

export interface MembershipRouteDeps {
  sql: Sql;
  redis: RedisLike;
}

export function registerMembershipRoutes(app: FastifyInstance, deps: MembershipRouteDeps): void {
  const membershipDeps: service.MembershipsDeps = { sql: deps.sql, now: () => new Date() };

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
  const guarded = { preHandler: [app.authenticate, limit] };

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
    const body = parseOr400(saveGymMembershipTypeRequestSchema, req.body, req, reply);
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
}
