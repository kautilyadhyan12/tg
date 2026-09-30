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
import { pageTurnedAwayKey } from "./service.js";

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
/** Of a page's 120 an hour, what one address may spend once the page has taken 60. */
const ENQUIRY_PAGE_ADDRESS_SHARE = 10;
const ENQUIRY_PAGE_BUSY_FROM = 60;
/** Failed robot checks one address may make at one page in an hour. */
const ENQUIRY_ROBOT_FAILS_MAX = 30;

const ENQUIRY_PAGE_WINDOW_S = 60 * 60;

const notFound = (req: FastifyRequest, reply: FastifyReply): FastifyReply =>
  reply.status(404).send({ error: "page_not_found", message: ENQUIRY_WORDS.not_found, requestId: req.id });

export interface GymPageRouteDeps {
  sql: Sql;
  redis: RedisLike;
  robotCheck: RobotCheck;
  photos: PhotoStore;
  addressKey: Buffer | null;
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
  const pageDeps: service.GymPageDeps = { sql: deps.sql, now: () => new Date(), robotCheck: deps.robotCheck, photos: deps.photos, log: app.log, addressKey: deps.addressKey };

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
  /** The form: 60 messages an hour from one address to one page, and 600 from one address to
   *  every page together, spent only once the robot check passed. Per page, never one
   *  allowance for the whole app: a mobile carrier puts thousands of phones behind one
   *  address (the security pass over 20c, 2026-09-30). */
  const enquiryAddressLimit = createDualRateLimit({
    name: "gym_enquiry",
    max: 60,
    ipMax: 600,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => `${slugOf(req) ?? ""}:${req.ip}`,
    redis: deps.redis,
  });
  /** …and 120 messages an hour to one page, counted only once the robot check passed. Once
   *  the page has taken half its hour, one address may take only 10 of it: nobody can keep a
   *  gym's page "busy" alone, and a quiet page never refuses people sharing one address (the
   *  security pass over 20c, 2026-09-30). A refusal is counted for the gym's Leads page.
   *  Redis down: let it through with a log, as the address limit does. */
  const pageRoom = (req: FastifyRequest, slug: string) => async (): Promise<boolean> => {
    const taken = Number((await deps.redis.get(`rl:gym_enquiry_page:${slug}`)) ?? "0");
    const share = await deps.redis.incrWithTtl(`rl:gym_enquiry_page_addr:${slug}:${req.ip}`, ENQUIRY_PAGE_WINDOW_S);
    const busy = taken >= ENQUIRY_PAGE_BUSY_FROM && share !== null && share > ENQUIRY_PAGE_ADDRESS_SHARE;
    const count = busy ? null : await deps.redis.incrWithTtl(`rl:gym_enquiry_page:${slug}`, ENQUIRY_PAGE_WINDOW_S);
    if (!busy && (count === null || share === null)) {
      req.log.warn({ event: "ratelimit.open_redis_down", limiter: "gym_enquiry_page" }, "rate limiter failing open (Redis unavailable)");
      return true;
    }
    const room = !busy && count !== null && count <= ENQUIRY_PAGE_MAX;
    if (!room) await deps.redis.incrWithTtl(pageTurnedAwayKey(slug), ENQUIRY_PAGE_WINDOW_S);
    return room;
  };
  /** A page's robot checks that failed from one address: past 30 an hour, that address is
   *  refused at that page before the check is asked again. Real people there are never
   *  counted, and another gym's page is not touched. */
  const robotKey = (req: FastifyRequest, slug: string) => `rl:gym_enquiry_robot:${slug}:${req.ip}`;
  const robotRoom = (req: FastifyRequest, reply: FastifyReply, slug: string) => async (): Promise<boolean> => {
    const failed = Number((await deps.redis.get(robotKey(req, slug))) ?? "0");
    if (failed < ENQUIRY_ROBOT_FAILS_MAX) return true;
    await reply.status(429).send({ error: "rate_limited", message: "Too many attempts. Please try again later.", requestId: req.id });
    return false;
  };
  const robotFailed = (req: FastifyRequest, slug: string) => async (): Promise<void> => {
    await deps.redis.incrWithTtl(robotKey(req, slug), ENQUIRY_PAGE_WINDOW_S);
  };
  /** Adding, removing and moving photos. Each photo is its own request, so swapping a
   *  full page of ten is 21 (ten removes, ten adds, one order): 300 an hour is fourteen
   *  such swaps for one person, across every gym they own, and 1,000 an address lets
   *  several owners at one address (a co-working space, a carrier's gateway) do the same. */
  const photoWriteLimit = createDualRateLimit({
    name: "gym_page_photo_write",
    max: 300,
    ipMax: 1000,
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
    const photo = await service.addPhoto(pageDeps, requireUserId(req), params.gymId, bytes, body.uploadKey, gate(photoWriteLimit)(req, reply));
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
      robotRoom: robotRoom(req, reply, slug),
      robotFailed: robotFailed(req, slug),
      address: gate(enquiryAddressLimit)(req, reply),
      page: pageRoom(req, slug),
    });
    if (done === null) return;
    return reply.status(202).send({ received: true });
  });
}
