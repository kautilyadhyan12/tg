// THE LEADERBOARD'S ROUTES (spec Part 3 §15.5): authenticate, rate limit, Zod-parse, and
// the service decides who may read. Registered from `registerOrgRoutes`.
//
// One limiter for the reads, keyed on the person: an open board refreshes every minute,
// and a whole gym's members share one address on its wi-fi, hence the explicit `ipMax`.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import {
  leaderboardPersonParamsSchema,
  leaderboardProfileQuerySchema,
  leaderboardQuerySchema,
  setLeaderboardVisibilityRequestSchema,
} from "@app/shared";
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
    // Issue paths and codes only, never the offending value (R3.10).
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

export function registerLeaderboardRoutes(
  app: FastifyInstance,
  deps: service.LeaderboardDeps & { redis: RedisLike },
): void {
  const readLimit = createDualRateLimit({
    name: "orgs_leaderboard_read",
    max: 600,
    ipMax: 6000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const writeLimit = createDualRateLimit({
    name: "users_leaderboard_visibility",
    max: 60,
    ipMax: 3000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.get("/v1/orgs/:gymId/leaderboard", { preHandler: [app.authenticate, readLimit] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(leaderboardQuerySchema, req.query, req, reply);
    if (query === null) return;
    return reply.status(200).send(await service.getLeaderboard(deps, requireUserId(req), params.gymId, query));
  });

  app.get("/v1/orgs/:gymId/leaderboard/mine", { preHandler: [app.authenticate, readLimit] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(leaderboardQuerySchema, req.query, req, reply);
    if (query === null) return;
    return reply.status(200).send(await service.getMyCounted(deps, requireUserId(req), params.gymId, query));
  });

  app.get(
    "/v1/orgs/:gymId/leaderboard/people/:userId",
    { preHandler: [app.authenticate, readLimit] },
    async (req, reply) => {
      const params = parseOr400(leaderboardPersonParamsSchema, req.params, req, reply);
      if (params === null) return;
      const query = parseOr400(leaderboardProfileQuerySchema, req.query, req, reply);
      if (query === null) return;
      return reply
        .status(200)
        .send(await service.getProfile(deps, requireUserId(req), params.gymId, params.userId, query.period));
    },
  );

  app.get("/v1/users/me/leaderboard", { preHandler: [app.authenticate, readLimit] }, async (req, reply) => {
    return reply.status(200).send(await service.getVisibility(deps, requireUserId(req)));
  });

  app.put("/v1/users/me/leaderboard", { preHandler: [app.authenticate, writeLimit] }, async (req, reply) => {
    const body = parseOr400(setLeaderboardVisibilityRequestSchema, req.body, req, reply);
    if (body === null) return;
    return reply.status(200).send(await service.setVisibility(deps, requireUserId(req), body.hidden));
  });
}
