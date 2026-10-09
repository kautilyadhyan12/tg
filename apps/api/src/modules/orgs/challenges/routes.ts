// A GYM'S CHALLENGES: THE ROUTES (spec Part 3 §15.6; ROADMAP 19d-i). Authenticate,
// Zod-parse, and the service decides who may read or write. Registered from
// `registerOrgRoutes`.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import {
  addGymChallengeRequestSchema,
  cancelGymChallengeRequestSchema,
  changeGymChallengeRequestSchema,
  gymChallengeParamsSchema,
  pickChallengeTeamRequestSchema,
  setChallengeScoresRequestSchema,
  setChallengeTeamPeopleRequestSchema,
  staffChallengeBoardQuerySchema,
} from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
import * as service from "./service.js";

const ISSUES_SAID = 10;

function parseOr400<S extends z.ZodTypeAny>(schema: S, value: unknown, req: FastifyRequest, reply: FastifyReply): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    // Issue paths and codes only, never the offending value, and the first few.
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues.slice(0, ISSUES_SAID).map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
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

export function registerChallengeRoutes(app: FastifyInstance, deps: service.ChallengesDeps & { redis: RedisLike }): void {
  const challengesDeps: service.ChallengesDeps = { sql: deps.sql, now: deps.now };
  const limiter = (name: string, max: number, ipMax: number) =>
    createDualRateLimit({
      name,
      max,
      ipMax,
      windowMs: 60 * 60 * 1000,
      identifier: (req) => req.authUser?.id ?? null,
      redis: deps.redis,
    });
  // A whole gym's members share one address on its wi-fi, hence each explicit `ipMax`.
  const readLimit = limiter("orgs_challenges_read", 600, 6000);
  const joinLimit = limiter("orgs_challenges_join", 120, 6000);
  const staffReadLimit = limiter("orgs_challenges_staff_read", 1200, 6000);
  const staffWriteLimit = limiter("orgs_challenges_staff_write", 300, 1500);

  // Every route asks who is reading or writing first and the limit after it, so a
  // stranger's 404 is never a 429 and never counts against the gym's shared address.
  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };

  // ── MEMBERS ──

  app.get("/v1/orgs/:gymId/challenges", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const challenges = await service.getChallenges(challengesDeps, requireUserId(req), params.gymId, gate(readLimit)(req, reply));
    if (challenges === null) return;
    return reply.status(200).send(challenges);
  });

  app.get("/v1/orgs/:gymId/challenges/:challengeId/board", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymChallengeParamsSchema, req.params, req, reply);
    if (params === null) return;
    const board = await service.getBoard(challengesDeps, requireUserId(req), params.gymId, params.challengeId, gate(readLimit)(req, reply));
    if (board === null) return;
    return reply.status(200).send(board);
  });

  // Join, and leave: each asked twice is done once, so neither needs a key.
  app.put("/v1/orgs/:gymId/challenges/:challengeId/joined", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymChallengeParamsSchema, req.params, req, reply);
    if (params === null) return;
    const challenge = await service.setJoined(challengesDeps, requireUserId(req), params.gymId, params.challengeId, true, gate(joinLimit)(req, reply));
    if (challenge === null) return;
    return reply.status(200).send({ challenge });
  });

  app.delete("/v1/orgs/:gymId/challenges/:challengeId/joined", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymChallengeParamsSchema, req.params, req, reply);
    if (params === null) return;
    const challenge = await service.setJoined(challengesDeps, requireUserId(req), params.gymId, params.challengeId, false, gate(joinLimit)(req, reply));
    if (challenge === null) return;
    return reply.status(200).send({ challenge });
  });

  // A member's own team, where members pick. Picked twice it is one pick.
  app.put("/v1/orgs/:gymId/challenges/:challengeId/team", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymChallengeParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(pickChallengeTeamRequestSchema, req.body, req, reply);
    if (body === null) return;
    const challenge = await service.pickTeam(challengesDeps, requireUserId(req), params.gymId, params.challengeId, body.teamId, gate(joinLimit)(req, reply));
    if (challenge === null) return;
    return reply.status(200).send({ challenge });
  });

  // ── STAFF HOLDING `leaderboard.manage` ──

  app.get("/v1/orgs/:gymId/challenges/staff", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const challenges = await service.getStaffChallenges(challengesDeps, requireUserId(req), params.gymId, gate(staffReadLimit)(req, reply));
    if (challenges === null) return;
    return reply.status(200).send(challenges);
  });

  app.get("/v1/orgs/:gymId/challenges/:challengeId/board/staff", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymChallengeParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(staffChallengeBoardQuerySchema, req.query, req, reply);
    if (query === null) return;
    const board = await service.getStaffBoard(challengesDeps, requireUserId(req), params.gymId, params.challengeId, query.page, gate(staffReadLimit)(req, reply));
    if (board === null) return;
    return reply.status(200).send(board);
  });

  app.post("/v1/orgs/:gymId/challenges", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(addGymChallengeRequestSchema, req.body, req, reply);
    if (body === null) return;
    const challenge = await service.addChallenge(challengesDeps, requireUserId(req), params.gymId, body, gate(staffWriteLimit)(req, reply));
    if (challenge === null) return;
    return reply.status(201).send({ challenge });
  });

  app.put("/v1/orgs/:gymId/challenges/:challengeId", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymChallengeParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(changeGymChallengeRequestSchema, req.body, req, reply);
    if (body === null) return;
    const challenge = await service.changeChallenge(challengesDeps, requireUserId(req), params.gymId, params.challengeId, body, gate(staffWriteLimit)(req, reply));
    if (challenge === null) return;
    return reply.status(200).send({ challenge });
  });

  app.put("/v1/orgs/:gymId/challenges/:challengeId/cancelled", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymChallengeParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(cancelGymChallengeRequestSchema, req.body, req, reply);
    if (body === null) return;
    const challenge = await service.setCancelled(challengesDeps, requireUserId(req), params.gymId, params.challengeId, body.cancelled, gate(staffWriteLimit)(req, reply));
    if (challenge === null) return;
    return reply.status(200).send({ challenge });
  });

  // Numbers staff type for a challenge of the gym's own count.
  app.put("/v1/orgs/:gymId/challenges/:challengeId/scores", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymChallengeParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(setChallengeScoresRequestSchema, req.body, req, reply);
    if (body === null) return;
    const saved = await service.setScores(challengesDeps, requireUserId(req), params.gymId, params.challengeId, body, gate(staffWriteLimit)(req, reply));
    if (saved === null) return;
    return reply.status(200).send(saved);
  });

  // Who is in which team, put there by staff.
  app.put("/v1/orgs/:gymId/challenges/:challengeId/team-people", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymChallengeParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(setChallengeTeamPeopleRequestSchema, req.body, req, reply);
    if (body === null) return;
    const saved = await service.setTeamPeople(challengesDeps, requireUserId(req), params.gymId, params.challengeId, body, gate(staffWriteLimit)(req, reply));
    if (saved === null) return;
    return reply.status(200).send(saved);
  });
}
