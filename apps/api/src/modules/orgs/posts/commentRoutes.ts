// COMMENTS ON A GYM'S UPDATES: THE ROUTES (ROADMAP Stage 5 17e; spec Part 3 §15.2). Who is asking is
// settled before the limit, so a stranger's 404 is never a 429 and never counts against the address
// a gym's members share. Registered from `registerOrgRoutes`.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  addGymPostCommentRequestSchema,
  gymPostCommentParamsSchema,
  gymPostCommentSettingsSchema,
  gymPostCommentsQuerySchema,
  gymPostParamsSchema,
  gymPostReactorsQuerySchema,
  keepGymPostRequestSchema,
  reactToGymPostRequestSchema,
  reportGymPostCommentRequestSchema,
} from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema, gymInPath } from "../schemas.js";
import * as service from "./commentsService.js";
import * as staff from "./commentsStaffService.js";
import { parseOr400, requireUserId } from "./routes.js";

const COMMENT_BODY_LIMIT = 16 * 1024;

export function registerPostCommentRoutes(app: FastifyInstance, deps: service.CommentsDeps & { redis: RedisLike }): void {
  const commentDeps: service.CommentsDeps = { sql: deps.sql, now: deps.now };
  const limiter = (name: string, max: number, ipMax: number) =>
    createDualRateLimit({
      name,
      max,
      ipMax,
      windowMs: 60 * 60 * 1000,
      identifier: (req) => req.authUser?.id ?? null,
      // Each gym has its own count at an address: one gym in a building cannot use up another's. The limit is asked after
      // who is asking, so nobody can charge a gym they are not in.
      ipScope: gymInPath,
      redis: deps.redis,
    });
  // A whole gym's members share one address on its wi-fi, hence each explicit `ipMax`.
  const readLimit = limiter("orgs_comments_read", 900, 9000);
  // The day's hundred are counted in the database; this only stops a flood of tries.
  const addLimit = limiter("orgs_comments_add", 150, 3000);
  const reactLimit = limiter("orgs_comments_react", 300, 6000);
  const writeLimit = limiter("orgs_comments_write", 60, 3000);
  const staffReadLimit = limiter("orgs_comments_staff_read", 1200, 6000);
  // Staff have no daily limit on words; this only stops a flood.
  const staffWriteLimit = limiter("orgs_comments_staff_write", 300, 1500);

  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };

  app.get("/v1/orgs/:gymId/posts/:postId/comments", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymPostParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(gymPostCommentsQuerySchema, req.query, req, reply);
    if (query === null) return;
    const page = await service.getComments(commentDeps, requireUserId(req), params.gymId, params.postId, query.after, gate(readLimit)(req, reply));
    if (page === null) return;
    return reply.status(200).send(page);
  });

  app.post("/v1/orgs/:gymId/posts/:postId/comments", { bodyLimit: COMMENT_BODY_LIMIT, preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymPostParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(addGymPostCommentRequestSchema, req.body, req, reply);
    if (body === null) return;
    const userId = requireUserId(req);
    await service.requireCommenter(commentDeps, userId, params.gymId);
    await addLimit(req, reply);
    if (reply.sent) return;
    return reply.status(201).send(await service.addComment(commentDeps, userId, params.gymId, params.postId, body));
  });

  app.get("/v1/orgs/:gymId/post-comments/:commentId/replies", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymPostCommentParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(gymPostCommentsQuerySchema, req.query, req, reply);
    if (query === null) return;
    const page = await service.getReplies(commentDeps, requireUserId(req), params.gymId, params.commentId, query.after, gate(readLimit)(req, reply));
    if (page === null) return;
    return reply.status(200).send(page);
  });

  app.delete("/v1/orgs/:gymId/post-comments/:commentId", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymPostCommentParamsSchema, req.params, req, reply);
    if (params === null) return;
    const done = await service.removeOwnComment(commentDeps, requireUserId(req), params.gymId, params.commentId, gate(writeLimit)(req, reply));
    if (done === null) return;
    return reply.status(200).send({ removed: true });
  });

  app.put("/v1/orgs/:gymId/post-comments/:commentId/reaction", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymPostCommentParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(reactToGymPostRequestSchema, req.body, req, reply);
    if (body === null) return;
    const done = await service.reactToComment(commentDeps, requireUserId(req), params.gymId, params.commentId, body.reaction, gate(reactLimit)(req, reply));
    if (done === null) return;
    return reply.status(200).send(done);
  });

  app.post("/v1/orgs/:gymId/post-comments/:commentId/report", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymPostCommentParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(reportGymPostCommentRequestSchema, req.body, req, reply);
    if (body === null) return;
    const done = await service.reportComment(commentDeps, requireUserId(req), params.gymId, params.commentId, body.reason, body.note, gate(writeLimit)(req, reply));
    if (done === null) return;
    return reply.status(200).send({ reported: true });
  });

  app.put("/v1/orgs/:gymId/post-comments/:commentId/block", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymPostCommentParamsSchema, req.params, req, reply);
    if (params === null) return;
    const done = await service.blockCommenter(commentDeps, requireUserId(req), params.gymId, params.commentId, gate(writeLimit)(req, reply));
    if (done === null) return;
    return reply.status(200).send({ blocked: true });
  });

  // ── FOR STAFF HOLDING posts.manage: the tick is asked before the limit (17e-ii). ──

  app.get("/v1/orgs/:gymId/posts/:postId/comments/staff", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymPostParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(gymPostCommentsQuerySchema, req.query, req, reply);
    if (query === null) return;
    const page = await staff.getComments(commentDeps, requireUserId(req), params.gymId, params.postId, query.after, gate(staffReadLimit)(req, reply));
    if (page === null) return;
    return reply.status(200).send(page);
  });

  app.post("/v1/orgs/:gymId/posts/:postId/comments/staff", { bodyLimit: COMMENT_BODY_LIMIT, preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymPostParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(addGymPostCommentRequestSchema, req.body, req, reply);
    if (body === null) return;
    const added = await staff.addComment(commentDeps, requireUserId(req), params.gymId, params.postId, body, gate(staffWriteLimit)(req, reply));
    if (added === null) return;
    return reply.status(201).send(added);
  });

  app.get("/v1/orgs/:gymId/post-comments/:commentId/replies/staff", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymPostCommentParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(gymPostCommentsQuerySchema, req.query, req, reply);
    if (query === null) return;
    const page = await staff.getReplies(commentDeps, requireUserId(req), params.gymId, params.commentId, query.after, gate(staffReadLimit)(req, reply));
    if (page === null) return;
    return reply.status(200).send(page);
  });

  app.delete("/v1/orgs/:gymId/post-comments/:commentId/staff", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymPostCommentParamsSchema, req.params, req, reply);
    if (params === null) return;
    const done = await staff.removeComment(commentDeps, requireUserId(req), params.gymId, params.commentId, gate(staffWriteLimit)(req, reply));
    if (done === null) return;
    return reply.status(200).send({ removed: true });
  });

  app.get("/v1/orgs/:gymId/post-comments/:commentId/reactions", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymPostCommentParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(gymPostReactorsQuerySchema, req.query, req, reply);
    if (query === null) return;
    const who = await staff.getReactors(commentDeps, requireUserId(req), params.gymId, params.commentId, query.reaction, gate(staffReadLimit)(req, reply));
    if (who === null) return;
    return reply.status(200).send(who);
  });

  app.get("/v1/orgs/:gymId/post-comments/reported", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const reported = await staff.getReported(commentDeps, requireUserId(req), params.gymId, gate(staffReadLimit)(req, reply));
    if (reported === null) return;
    return reply.status(200).send(reported);
  });

  app.post("/v1/orgs/:gymId/post-comments/:commentId/keep", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymPostCommentParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(keepGymPostRequestSchema, req.body, req, reply);
    if (body === null) return;
    const done = await staff.keepReported(commentDeps, requireUserId(req), params.gymId, params.commentId, body, gate(staffWriteLimit)(req, reply));
    if (done === null) return;
    return reply.status(200).send(done);
  });

  app.put("/v1/orgs/:gymId/post-comments/settings", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(gymPostCommentSettingsSchema, req.body, req, reply);
    if (body === null) return;
    const settings = await staff.setMembersCanComment(commentDeps, requireUserId(req), params.gymId, body.membersCanComment, gate(staffWriteLimit)(req, reply));
    if (settings === null) return;
    return reply.status(200).send(settings);
  });
}
