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
import { createDualRateLimit } from "../auth/rateLimit.js";
import {
  applicationParamsSchema,
  createOrgRequestSchema,
  joinOrgRequestSchema,
  memberParamsSchema,
  orgApplicationListQuerySchema,
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

  // OWED (2026-08-18): `/v1/orgs/join` had no per-route limit, only the global
  // 300/min floor. It is closed here because this card rewrites the route
  // anyway, and it is now the door a stranger with a leaked code knocks on.
  //
  // THE TWO NUMBERS ARE DIFFERENT ON PURPOSE, and the IP one is the one worth
  // reading twice. A real person applies to their gym ONCE, so 10/hour per
  // ACCOUNT is already absurdly generous. But the normal case for the IP
  // dimension is thirty members standing in the same gym on the same wi-fi
  // signing up on induction day — a tight per-IP number would lock out the
  // exact scenario the feature exists for. 120/hour per IP still bounds a
  // script pointed at the 32^6 code space (~1.07 billion) to nothing.
  // No § governs either figure; both are recorded in DECISIONS as chosen.
  const applyLimit = createDualRateLimit({
    name: "orgs_apply",
    max: 10,
    ipMax: 120,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.post(
    "/v1/orgs/join",
    { preHandler: [app.authenticate, applyLimit] },
    async (req, reply) => {
      const body = parseOr400(joinOrgRequestSchema, req.body, req, reply);
      if (body === null) return;
      const applied = await service.applyToOrg(orgDeps, requireUserId(req), body);
      return reply.status(200).send(applied);
    },
  );

  /** The applicant's own waiting list. Declared BEFORE `/v1/orgs/:gymId/...`
   *  would matter if these shared a prefix — they do not, but the ordering
   *  convention in this file is deliberate and `applications` is a literal
   *  segment that must never be read as a gym id. */
  app.get("/v1/orgs/applications/mine", { preHandler: [app.authenticate] }, async (req, reply) => {
    const applications = await service.listMyApplications(orgDeps, requireUserId(req));
    return reply.status(200).send(applications);
  });

  app.get(
    "/v1/orgs/:gymId/applications",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(orgParamsSchema, req.params, req, reply);
      if (params === null) return;
      const query = parseOr400(orgApplicationListQuerySchema, req.query, req, reply);
      if (query === null) return;
      const page = await service.listOrgApplications(
        orgDeps,
        requireUserId(req),
        params.gymId,
        query,
      );
      return reply.status(200).send(page);
    },
  );

  app.post(
    "/v1/orgs/:gymId/applications/:applicationId/confirm",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(applicationParamsSchema, req.params, req, reply);
      if (params === null) return;
      const result = await service.confirmOrgApplication(
        orgDeps,
        requireUserId(req),
        params.gymId,
        params.applicationId,
      );
      return reply.status(200).send(result);
    },
  );

  app.post(
    "/v1/orgs/:gymId/applications/:applicationId/reject",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(applicationParamsSchema, req.params, req, reply);
      if (params === null) return;
      const result = await service.rejectOrgApplication(
        orgDeps,
        requireUserId(req),
        params.gymId,
        params.applicationId,
      );
      return reply.status(200).send(result);
    },
  );

  // Part 3 §3.3's `GET /codes`, read half — the console's only way to show an
  // owner their own join code after the day they created the gym.
  app.get("/v1/orgs/:gymId/codes", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const codes = await service.listOrgCodes(orgDeps, requireUserId(req), params.gymId);
    return reply.status(200).send(codes);
  });

  app.get("/v1/orgs/:gymId/members", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(orgMemberListQuerySchema, req.query, req, reply);
    if (query === null) return;
    const page = await service.listOrgMembers(orgDeps, requireUserId(req), params.gymId, query);
    return reply.status(200).send(page);
  });

  // Part 3 §4.3's remove flow. DELETE and not POST because it IS a deletion of
  // the relationship (the row is closed, never dropped) and because the method
  // makes the retry semantics obvious: the same request twice leaves the same
  // state and answers the same way.
  //
  // The browser reaches this through a CORS PREFLIGHT, which is the one thing
  // a `fastify.inject` test cannot see — the Card-4 smoke found DELETE/PATCH/PUT
  // dead app-wide behind 250 green tests. `app.ts` lists DELETE in its allowed
  // methods (verified before this route was written), and the smoke sheet's
  // remove step is what proves it in a real browser.
  app.delete(
    "/v1/orgs/:gymId/members/:userId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(memberParamsSchema, req.params, req, reply);
      if (params === null) return;
      const result = await service.removeOrgMember(
        orgDeps,
        requireUserId(req),
        params.gymId,
        params.userId,
      );
      return reply.status(200).send(result);
    },
  );
}
