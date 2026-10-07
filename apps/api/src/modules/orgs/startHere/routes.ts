// The "Start here" list's routes (ROADMAP 23b): authenticate, rate-limit, Zod-parse, hand
// to the service, which owns the authorisation.
//
//   GET /v1/orgs/:gymId/start-here   the steps this member of staff can do, each done or not
//   PUT /v1/orgs/:gymId/start-here   hide the list for the gym, or show it again (`org.manage`)
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import { setStartHereRequestSchema } from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
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

export function registerStartHereRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike; now: () => Date }): void {
  const startHereDeps: service.StartHereDeps = { sql: deps.sql, now: deps.now };

  /** Read once each time Overview opens. Keyed on the person; a gym's whole staff share
   *  one address, so the address ceiling is ten times one person's. */
  const limit = createDualRateLimit({
    name: "orgs_start_here",
    max: 300,
    ipMax: 3000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const guarded = { preHandler: [app.authenticate, limit] };

  app.get("/v1/orgs/:gymId/start-here", guarded, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    return reply.status(200).send(await service.getStartHere(startHereDeps, requireUserId(req), params.gymId));
  });

  app.put("/v1/orgs/:gymId/start-here", guarded, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(setStartHereRequestSchema, req.body, req, reply);
    if (body === null) return;
    return reply.status(200).send(await service.setStartHereHidden(startHereDeps, requireUserId(req), params.gymId, body.hidden));
  });
}
