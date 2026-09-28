// A gym's own page (ROADMAP 20c-iv-a): the console's two routes behind sign-in, and the
// two public ones anybody with the link uses — no cookie, no sign-in.
//
// The public form is limited per internet address and per page, separately: people
// behind one phone carrier's address, or at one gym's wi-fi, share an address, and the
// robot check, not the address limit, is what stops robots. The page's allowance is
// spent only by sends that passed the robot check (`service.sendEnquiry`), so robots
// cannot use it up for the people after them.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import {
  addGymPagePhotoRequestSchema,
  ENQUIRY_WORDS,
  GYM_PAGE_PHOTO_MAX_BYTES,
  gymEnquiryRequestSchema,
  orderGymPagePhotosRequestSchema,
  setGymPageRequestSchema,
} from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
import type { PhotoStore } from "./photoStore.js";
import type { RobotCheck } from "./robotCheck.js";
import * as service from "./service.js";

/** The slug in a page's address: what `slugifyName` makes, and nothing else. */
const slugParamsSchema = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,100}$/) }).strict();

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

/** A slug the schema refuses is the same 404 as a page that is off. */
const slugOf = (req: FastifyRequest): string | null => {
  const parsed = slugParamsSchema.safeParse(req.params);
  return parsed.success ? parsed.data.slug : null;
};

const ENQUIRY_PAGE_MAX = 120;
const ENQUIRY_PAGE_WINDOW_S = 60 * 60;

const notFound = (req: FastifyRequest, reply: FastifyReply): FastifyReply =>
  reply.status(404).send({ error: "page_not_found", message: ENQUIRY_WORDS.not_found, requestId: req.id });

export interface GymPageRouteDeps {
  sql: Sql;
  redis: RedisLike;
  robotCheck: RobotCheck;
  photos: PhotoStore;
}

const photoParamsSchema = z.object({ gymId: z.string().uuid(), photoId: z.string().uuid() }).strict();
const publicPhotoParamsSchema = slugParamsSchema.extend({ photoId: z.string().uuid() }).strict();

/** A photo's base64 and JSON's own punctuation; the app's default body limit is small
 *  on purpose, so this door alone takes a photo. */
const PHOTO_BODY_LIMIT = Math.ceil(GYM_PAGE_PHOTO_MAX_BYTES / 3) * 4 + 1024;

/** A photo is served as a picture and nothing else: its checked type, never sniffed,
 *  and no script or style can run from it. */
function sendPhoto(reply: FastifyReply, file: service.PhotoFile, cache: string): FastifyReply {
  return reply
    .status(200)
    .header("content-type", file.contentType)
    .header("x-content-type-options", "nosniff")
    .header("content-security-policy", "default-src 'none'; sandbox")
    .header("cache-control", cache)
    .send(Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength));
}

export function registerGymPageRoutes(app: FastifyInstance, deps: GymPageRouteDeps): void {
  const pageDeps: service.GymPageDeps = { sql: deps.sql, now: () => new Date(), robotCheck: deps.robotCheck, photos: deps.photos, log: app.log };

  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };

  /** The console: a page opened, a page saved. */
  const readLimit = createDualRateLimit({
    name: "gym_page_read",
    max: 600,
    ipMax: 2000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const writeLimit = createDualRateLimit({
    name: "gym_page_write",
    max: 60,
    ipMax: 200,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  /** Anybody opening a page: by address alone. */
  const publicReadLimit = createDualRateLimit({
    name: "gym_page_public_read",
    max: 600,
    ipMax: 600,
    windowMs: 60 * 60 * 1000,
    identifier: () => null,
    redis: deps.redis,
  });
  /** The form: 60 sends an hour from one address, whatever they carry. */
  const enquiryAddressLimit = createDualRateLimit({
    name: "gym_enquiry",
    max: 60,
    ipMax: 60,
    windowMs: 60 * 60 * 1000,
    identifier: () => null,
    redis: deps.redis,
  });
  /** …and 120 messages an hour to one page, counted only once the robot check passed.
   *  Redis down: let it through with a log, as the address limit does. */
  const pageRoom = (req: FastifyRequest, slug: string) => async (): Promise<boolean> => {
    const count = await deps.redis.incrWithTtl(`rl:gym_enquiry_page:${slug}`, ENQUIRY_PAGE_WINDOW_S);
    if (count === null) {
      req.log.warn({ event: "ratelimit.open_redis_down", limiter: "gym_enquiry_page" }, "rate limiter failing open (Redis unavailable)");
      return true;
    }
    return count <= ENQUIRY_PAGE_MAX;
  };
  /** Adding, removing and moving photos: at most 10 on a page, so 60 an hour is room
   *  to change one's mind many times. */
  const photoWriteLimit = createDualRateLimit({
    name: "gym_page_photo_write",
    max: 60,
    ipMax: 200,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  /** A page opened is its photos fetched too, up to ten of them. */
  const publicPhotoLimit = createDualRateLimit({
    name: "gym_page_public_photo",
    max: 6000,
    ipMax: 6000,
    windowMs: 60 * 60 * 1000,
    identifier: () => null,
    redis: deps.redis,
  });
  const signedIn = { preHandler: [app.authenticate] };

  app.get("/v1/orgs/:gymId/page", signedIn, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const page = await service.getGymPage(pageDeps, requireUserId(req), params.gymId, gate(readLimit)(req, reply));
    if (page === null) return;
    return reply.status(200).send({ page });
  });

  app.put("/v1/orgs/:gymId/page", signedIn, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(setGymPageRequestSchema, req.body, req, reply);
    if (body === null) return;
    const page = await service.setGymPage(pageDeps, requireUserId(req), params.gymId, body, gate(writeLimit)(req, reply));
    if (page === null) return;
    return reply.status(200).send({ page });
  });

  // ── PHOTOS (20c-iv-b) ──

  app.post("/v1/orgs/:gymId/page/photos", { bodyLimit: PHOTO_BODY_LIMIT, preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(addGymPagePhotoRequestSchema, req.body, req, reply);
    if (body === null) return;
    const bytes = new Uint8Array(Buffer.from(body.contentBase64, "base64"));
    const photo = await service.addPhoto(pageDeps, requireUserId(req), params.gymId, bytes, gate(photoWriteLimit)(req, reply));
    if (photo === null) return;
    return reply.status(201).send({ photo });
  });

  app.put("/v1/orgs/:gymId/page/photos/order", signedIn, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(orderGymPagePhotosRequestSchema, req.body, req, reply);
    if (body === null) return;
    const photos = await service.orderPhotos(pageDeps, requireUserId(req), params.gymId, body.photoIds, gate(photoWriteLimit)(req, reply));
    if (photos === null) return;
    return reply.status(200).send({ photos });
  });

  app.delete("/v1/orgs/:gymId/page/photos/:photoId", signedIn, async (req, reply) => {
    const params = parseOr400(photoParamsSchema, req.params, req, reply);
    if (params === null) return;
    const photos = await service.removePhoto(pageDeps, requireUserId(req), params.gymId, params.photoId, gate(photoWriteLimit)(req, reply));
    if (photos === null) return;
    return reply.status(200).send({ photos });
  });

  app.get("/v1/orgs/:gymId/page/photos/:photoId", signedIn, async (req, reply) => {
    const params = parseOr400(photoParamsSchema, req.params, req, reply);
    if (params === null) return;
    const file = await service.staffPhoto(pageDeps, requireUserId(req), params.gymId, params.photoId, gate(readLimit)(req, reply));
    if (file === null) return;
    return sendPhoto(reply, file, "private, no-store");
  });

  app.get("/v1/public/gyms/:slug/photos/:photoId", async (req, reply) => {
    await publicPhotoLimit(req, reply);
    if (reply.sent) return;
    const parsed = publicPhotoParamsSchema.safeParse(req.params);
    if (!parsed.success) return notFound(req, reply);
    const file = await service.publicPhoto(pageDeps, parsed.data.slug, parsed.data.photoId);
    // A few minutes in a browser's cache: a page switched off takes its photos with it
    // soon after, not only for the next visitor.
    return sendPhoto(reply, file, "public, max-age=300");
  });

  app.get("/v1/public/gyms/:slug", async (req, reply) => {
    await publicReadLimit(req, reply);
    if (reply.sent) return;
    const slug = slugOf(req);
    if (slug === null) return notFound(req, reply);
    const page = await service.publicPage(pageDeps, slug);
    return reply.status(200).header("cache-control", "no-store").send({ page });
  });

  app.post("/v1/public/gyms/:slug/enquiries", async (req, reply) => {
    const slug = slugOf(req);
    if (slug === null) return notFound(req, reply);
    const body = parseOr400(gymEnquiryRequestSchema, req.body, req, reply);
    if (body === null) return;
    const done = await service.sendEnquiry(pageDeps, slug, body, {
      address: gate(enquiryAddressLimit)(req, reply),
      page: pageRoom(req, slug),
    });
    if (done === null) return;
    return reply.status(202).send({ received: true });
  });
}
