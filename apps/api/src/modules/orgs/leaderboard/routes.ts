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
  setLeaderboardBoardsRequestSchema,
  setLeaderboardTakenOffRequestSchema,
  setLeaderboardVisibilityRequestSchema,
  staffLeaderboardQuerySchema,
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

  // ── THE BOARD IN THE CONSOLE (19a-iii). The service asks the `leaderboard.manage` tick
  // first and the limit after it, so a stranger's 404 is never a 429. ──
  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };
  // The page asks again every minute; a gym's staff share its one address.
  const staffReadLimit = createDualRateLimit({
    name: "orgs_leaderboard_staff_read",
    max: 1200,
    ipMax: 6000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const staffWriteLimit = createDualRateLimit({
    name: "orgs_leaderboard_staff_write",
    max: 300,
    ipMax: 1500,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.get("/v1/orgs/:gymId/leaderboard/staff", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(staffLeaderboardQuerySchema, req.query, req, reply);
    if (query === null) return;
    const board = await service.getStaffLeaderboard(deps, requireUserId(req), params.gymId, query, gate(staffReadLimit)(req, reply));
    if (board === null) return;
    return reply.status(200).send(board);
  });

  app.get("/v1/orgs/:gymId/leaderboard/staff/people/:userId", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(leaderboardPersonParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(leaderboardProfileQuerySchema, req.query, req, reply);
    if (query === null) return;
    const profile = await service.getStaffProfile(
      deps,
      requireUserId(req),
      params.gymId,
      params.userId,
      query.period,
      gate(staffReadLimit)(req, reply),
    );
    if (profile === null) return;
    return reply.status(200).send(profile);
  });

  app.get(
    "/v1/orgs/:gymId/leaderboard/staff/people/:userId/counted",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const params = parseOr400(leaderboardPersonParamsSchema, req.params, req, reply);
      if (params === null) return;
      const query = parseOr400(leaderboardQuerySchema, req.query, req, reply);
      if (query === null) return;
      const counted = await service.getStaffCounted(
        deps,
        requireUserId(req),
        params.gymId,
        params.userId,
        query,
        gate(staffReadLimit)(req, reply),
      );
      if (counted === null) return;
      return reply.status(200).send(counted);
    },
  );

  app.put("/v1/orgs/:gymId/leaderboard/staff/people/:userId", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(leaderboardPersonParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(setLeaderboardTakenOffRequestSchema, req.body, req, reply);
    if (body === null) return;
    const done = await service.setTakenOff(
      deps,
      requireUserId(req),
      params.gymId,
      params.userId,
      body.takenOff,
      gate(staffWriteLimit)(req, reply),
    );
    if (done === null) return;
    return reply.status(200).send(done);
  });

  app.put("/v1/orgs/:gymId/leaderboard/staff/boards", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(setLeaderboardBoardsRequestSchema, req.body, req, reply);
    if (body === null) return;
    const done = await service.setBoardOff(deps, requireUserId(req), params.gymId, body.board, body.off, gate(staffWriteLimit)(req, reply));
    if (done === null) return;
    return reply.status(200).send(done);
  });
}
