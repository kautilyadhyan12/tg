// A GYM'S EVENTS: THE ROUTES (spec Part 3 §15.4; ROADMAP 19c-i). Authenticate, Zod-parse,
// and the service decides who may read or write. Registered from `registerOrgRoutes`.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import {
  GYM_EVENT_POSTER_MAX_BYTES,
  addGymEventRequestSchema,
  cancelGymEventRequestSchema,
  changeGymEventRequestSchema,
  comeToEventRequestSchema,
  gymEventParamsSchema,
  gymEventPersonParamsSchema,
  gymEventPosterParamsSchema,
} from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { createLine } from "../classes/bookingsService.js";
import { orgParamsSchema } from "../schemas.js";
import * as places from "./places.js";
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

/** An event's words and its poster as base64, with JSON's own punctuation. */
const EVENT_BODY_LIMIT = Math.ceil(GYM_EVENT_POSTER_MAX_BYTES / 3) * 4 + 64 * 1024;

export function registerEventRoutes(app: FastifyInstance, deps: Omit<service.EventsDeps, "log"> & { redis: RedisLike }): void {
  const eventsDeps: service.EventsDeps = { sql: deps.sql, now: deps.now, photos: deps.photos, log: app.log };
  const placesDeps: places.PlacesDeps = { sql: deps.sql, now: deps.now, inLine: createLine() };
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
  const readLimit = limiter("orgs_events_read", 600, 6000);
  const comingLimit = limiter("orgs_events_coming", 120, 6000);
  const posterLimit = limiter("orgs_events_poster", 6000, 60_000);
  const staffReadLimit = limiter("orgs_events_staff_read", 1200, 6000);
  const staffSaveLimit = limiter("orgs_events_staff_save", 120, 600);
  const staffWriteLimit = limiter("orgs_events_staff_write", 300, 1500);

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

  app.get("/v1/orgs/:gymId/events", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const events = await service.getEvents(eventsDeps, requireUserId(req), params.gymId, gate(readLimit)(req, reply));
    if (events === null) return;
    return reply.status(200).send(events);
  });

  // For a member, or staff holding the tick. Served as a picture and nothing else. The
  // poster's id is in its address, so a new poster is a new address; a browser may keep
  // one but asks again every time it shows it (`no-cache`).
  app.get("/v1/orgs/:gymId/events/:eventId/poster/:posterId", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymEventPosterParamsSchema, req.params, req, reply);
    if (params === null) return;
    const etag = `"${params.posterId}"`;
    const has = req.headers["if-none-match"] === etag;
    const file = await service.getPoster(eventsDeps, requireUserId(req), params.gymId, params.eventId, params.posterId, !has, gate(posterLimit)(req, reply));
    if (file === null) return;
    void reply.header("cache-control", "private, no-cache").header("etag", etag);
    if (file === "same") return reply.status(304).send();
    return reply
      .status(200)
      .header("content-type", file.contentType)
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .send(Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength));
  });

  // "I'm coming", "Join the waitlist" and the claim of a freed place: the request's key
  // makes the same tap twice one place.
  app.post("/v1/orgs/:gymId/events/:eventId/coming", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymEventParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(comeToEventRequestSchema, req.body, req, reply);
    if (body === null) return;
    const userId = requireUserId(req);
    if ((await places.come(placesDeps, userId, params.gymId, params.eventId, body, gate(comingLimit)(req, reply))) === null) return;
    return reply.status(200).send({ event: await service.memberEvent(eventsDeps, userId, params.gymId, params.eventId) });
  });

  // "Can't come", or leaving the waitlist.
  app.delete("/v1/orgs/:gymId/events/:eventId/coming", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymEventParamsSchema, req.params, req, reply);
    if (params === null) return;
    const userId = requireUserId(req);
    if ((await places.notComing(placesDeps, userId, params.gymId, params.eventId, gate(comingLimit)(req, reply))) === null) return;
    return reply.status(200).send({ event: await service.memberEvent(eventsDeps, userId, params.gymId, params.eventId) });
  });

  // ── STAFF HOLDING `posts.manage` ──

  app.get("/v1/orgs/:gymId/events/:eventId/people", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymEventParamsSchema, req.params, req, reply);
    if (params === null) return;
    const people = await places.getPeople(placesDeps, requireUserId(req), params.gymId, params.eventId, gate(staffReadLimit)(req, reply));
    if (people === null) return;
    return reply.status(200).send(people);
  });

  app.delete("/v1/orgs/:gymId/events/:eventId/people/:placeId", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymEventPersonParamsSchema, req.params, req, reply);
    if (params === null) return;
    const staffId = requireUserId(req);
    if ((await places.removePerson(placesDeps, staffId, params.gymId, params.eventId, params.placeId, gate(staffWriteLimit)(req, reply))) === null) return;
    const people = await places.getPeople(placesDeps, staffId, params.gymId, params.eventId, () => Promise.resolve(true));
    return reply.status(200).send(people);
  });

  app.get("/v1/orgs/:gymId/events/staff", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const events = await service.getStaffEvents(eventsDeps, requireUserId(req), params.gymId, gate(staffReadLimit)(req, reply));
    if (events === null) return;
    return reply.status(200).send(events);
  });

  // An event's body may hold a poster of 1 MB, and reading it holds the server's one
  // thread. So who is asking, the tick and the limit are settled BEFORE the body is read.
  const maySave = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // An address that names no gym is answered here too, or its body would be read.
    const params = parseOr400(orgParamsSchema.passthrough(), req.params, req, reply);
    if (params === null) return;
    await service.requireEventStaff(eventsDeps, requireUserId(req), params.gymId);
    await staffSaveLimit(req, reply);
  };

  app.post("/v1/orgs/:gymId/events", { bodyLimit: EVENT_BODY_LIMIT, onRequest: [app.authenticate, maySave] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(addGymEventRequestSchema, req.body, req, reply);
    if (body === null) return;
    return reply.status(201).send({ event: await service.addEvent(eventsDeps, requireUserId(req), params.gymId, body) });
  });

  app.put("/v1/orgs/:gymId/events/:eventId", { bodyLimit: EVENT_BODY_LIMIT, onRequest: [app.authenticate, maySave] }, async (req, reply) => {
    const params = parseOr400(gymEventParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(changeGymEventRequestSchema, req.body, req, reply);
    if (body === null) return;
    return reply.status(200).send({ event: await service.changeEvent(eventsDeps, requireUserId(req), params.gymId, params.eventId, body) });
  });

  app.put("/v1/orgs/:gymId/events/:eventId/cancelled", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(gymEventParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(cancelGymEventRequestSchema, req.body, req, reply);
    if (body === null) return;
    const event = await service.setCancelled(eventsDeps, requireUserId(req), params.gymId, params.eventId, body.cancelled, gate(staffWriteLimit)(req, reply));
    if (event === null) return;
    return reply.status(200).send({ event });
  });
}
