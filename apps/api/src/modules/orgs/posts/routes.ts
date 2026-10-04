// A GYM'S UPDATES: THE ROUTES (spec Part 3 §15.2; ROADMAP 19b-i). Authenticate, Zod-parse,
// and the service decides who may read or write. Registered from `registerOrgRoutes`.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import {
  GYM_PAGE_PHOTO_MAX_BYTES,
  GYM_POST_MAX_PHOTOS,
  addGymPostRequestSchema,
  gymPostParamsSchema,
  gymPostPhotoParamsSchema,
  gymPostReactorsQuerySchema,
  gymPostsQuerySchema,
  pinGymPostRequestSchema,
  reactToGymPostRequestSchema,
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

/** A post's words and up to four photos as base64, with JSON's own punctuation. */
const POST_BODY_LIMIT = GYM_POST_MAX_PHOTOS * (Math.ceil(GYM_PAGE_PHOTO_MAX_BYTES / 3) * 4 + 8) + 16 * 1024;

export function registerPostRoutes(app: FastifyInstance, deps: Omit<service.PostsDeps, "log"> & { redis: RedisLike }): void {
  const postsDeps: service.PostsDeps = { sql: deps.sql, now: deps.now, photos: deps.photos, log: app.log };
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
  const readLimit = limiter("orgs_posts_read", 600, 6000);
  // A page is up to 23 posts of four photos each.
  const photoLimit = limiter("orgs_posts_photo", 6000, 60_000);
  const reactLimit = limiter("orgs_posts_react", 300, 6000);
  const staffReadLimit = limiter("orgs_posts_staff_read", 1200, 6000);
  const staffPostLimit = limiter("orgs_posts_staff_post", 60, 300);
  const staffWriteLimit = limiter("orgs_posts_staff_write", 300, 1500);

  // The staff routes ask the tick first and the limit after it, so a stranger's 404 is
  // never a 429.
  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };

  // ── MEMBERS ──

  app.get("/v1/orgs/:gymId/posts", { preHandler: [app.authenticate, readLimit] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(gymPostsQuerySchema, req.query, req, reply);
    if (query === null) return;
    return reply.status(200).send(await service.getPosts(postsDeps, requireUserId(req), params.gymId, query.before));
  });

  app.put("/v1/orgs/:gymId/posts/:postId/reaction", { preHandler: [app.authenticate, reactLimit] }, async (req, reply) => {
    const params = parseOr400(gymPostParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(reactToGymPostRequestSchema, req.body, req, reply);
    if (body === null) return;
    return reply.status(200).send(await service.react(postsDeps, requireUserId(req), params.gymId, params.postId, body.reaction));
  });

  // For a member, or staff holding the tick. Served as a picture and nothing else; kept
  // by the reader's own browser for a few minutes, so a removed post's photo goes soon.
  app.get("/v1/orgs/:gymId/posts/:postId/photos/:photoId", { preHandler: [app.authenticate, photoLimit] }, async (req, reply) => {
    const params = parseOr400(gymPostPhotoParamsSchema, req.params, req, reply);
    if (params === null) return;
    const file = await service.getPhoto(postsDeps, requireUserId(req), params.gymId, params.postId, params.photoId);
    return reply
      .status(200)
      .header("content-type", file.contentType)
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("cache-control", "private, max-age=300")
      .send(Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength));
  });

  // ── STAFF HOLDING `posts.manage` ──

  app.get("/v1/orgs/:gymId/posts/staff", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(gymPostsQuerySchema, req.query, req, reply);
    if (query === null) return;
    const posts = await service.getStaffPosts(postsDeps, requireUserId(req), params.gymId, query.before, gate(staffReadLimit)(req, reply));
    if (posts === null) return;
    return reply.status(200).send(posts);
  });

  app.get("/v1/orgs/:gymId/posts/:postId/reactions", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymPostParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(gymPostReactorsQuerySchema, req.query, req, reply);
    if (query === null) return;
    const who = await service.getReactors(postsDeps, requireUserId(req), params.gymId, params.postId, query.reaction, gate(staffReadLimit)(req, reply));
    if (who === null) return;
    return reply.status(200).send(who);
  });

  // A post's body is up to 11 MB of photos, and reading it holds the server's one thread.
  // So who is asking, the tick and the limit are settled BEFORE the body is read: anybody
  // who may not post is answered without it.
  const mayPost = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const params = orgParamsSchema.safeParse(req.params);
    if (!params.success) return;
    await service.requirePoster(postsDeps, requireUserId(req), params.data.gymId);
    await staffPostLimit(req, reply);
  };

  app.post("/v1/orgs/:gymId/posts", { bodyLimit: POST_BODY_LIMIT, onRequest: [app.authenticate, mayPost] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(addGymPostRequestSchema, req.body, req, reply);
    if (body === null) return;
    return reply.status(201).send({ post: await service.addPost(postsDeps, requireUserId(req), params.gymId, body) });
  });

  app.put("/v1/orgs/:gymId/posts/:postId/pin", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymPostParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(pinGymPostRequestSchema, req.body, req, reply);
    if (body === null) return;
    const post = await service.setPinned(postsDeps, requireUserId(req), params.gymId, params.postId, body.pinned, gate(staffWriteLimit)(req, reply));
    if (post === null) return;
    return reply.status(200).send({ post });
  });

  app.delete("/v1/orgs/:gymId/posts/:postId", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymPostParamsSchema, req.params, req, reply);
    if (params === null) return;
    const done = await service.removePost(postsDeps, requireUserId(req), params.gymId, params.postId, gate(staffWriteLimit)(req, reply));
    if (done === null) return;
    return reply.status(200).send({ removed: true });
  });
}
