// Orgs routes (thin, R7.1). Order per R3.3: authn → Zod parse → service
// (which owns authz/role checks) → repo (which owns tenancy).
//
// No entitlement or quota middleware: creating and joining an org are not
// metered, and gating the JOIN on the joiner's own plan would be backwards —
// the gym's plan is what grants them anything (Part 4 §4.1).
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import type { RedisLike } from "../../redis.js";
import {
  createOrgRequestSchema,
  joinOrgRequestSchema,
  orgMemberListQuerySchema,
  orgParamsSchema,
} from "./schemas.js";
import * as service from "./service.js";

/** Zod-parse a request part; 400 with issue paths/codes only (R3.10 — never
 *  the offending value, which can be user data). Generic over the schema so
 *  `.default()` fields keep their non-optional OUTPUT type. */
function parseOr400<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
): z.output<S> | null {
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

function requireUserId(req: FastifyRequest): string {
  const userId = req.authUser?.id;
  if (userId === undefined) throw new Error("authenticate preHandler did not run");
  return userId;
}

export interface OrgRouteOverrides {
  /** Tests inject a deterministic source to drive the slug/code collision
   *  retry; production uses `node:crypto`. */
  randomBytes?: (n: number) => Uint8Array;
}

export function registerOrgRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; redis: RedisLike },
  overrides: OrgRouteOverrides = {},
): void {
  const orgDeps: service.OrgsDeps = {
    sql: deps.sql,
    redis: deps.redis,
    randomBytes: overrides.randomBytes ?? ((n) => randomBytes(n)),
  };

  app.post("/v1/orgs", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = parseOr400(createOrgRequestSchema, req.body, req, reply);
    if (body === null) return;
    const created = await service.createOrg(orgDeps, requireUserId(req), body);
    return reply.status(201).send(created);
  });

  app.get("/v1/orgs/mine", { preHandler: [app.authenticate] }, async (req, reply) => {
    const orgs = await service.listMyOrgs(orgDeps, requireUserId(req));
    return reply.status(200).send(orgs);
  });

  app.post("/v1/orgs/join", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = parseOr400(joinOrgRequestSchema, req.body, req, reply);
    if (body === null) return;
    const joined = await service.joinOrg(orgDeps, requireUserId(req), body);
    return reply.status(200).send(joined);
  });

  app.get("/v1/orgs/:gymId/members", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(orgMemberListQuerySchema, req.query, req, reply);
    if (query === null) return;
    const page = await service.listOrgMembers(orgDeps, requireUserId(req), params.gymId, query);
    return reply.status(200).send(page);
  });
}
