// CLASS BOOKINGS: THE ROUTES (spec Part 3 §13.4; ROADMAP 17c-i). Authenticate, Zod-parse,
// and the service decides who may read or write. Registered from `registerOrgRoutes`.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import {
  CLASS_LATE_CANCEL_ERROR,
  bookClassRequestSchema,
  cancelClassBookingRequestSchema,
  bookingSettingsBodySchema,
  classBookingsEndingQuerySchema,
  markClassBookingRequestSchema,
  memberClassesQuerySchema,
} from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { classBookingParamsSchema, classSessionParamsSchema, orgParamsSchema } from "../schemas.js";
import * as service from "./bookingsService.js";

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

export function registerClassBookingRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike; now: () => Date }): void {
  const bookingDeps: service.BookingsDeps = { sql: deps.sql, now: deps.now, inLine: service.createLine() };
  const limiter = (name: string, max: number, ipMax: number) =>
    createDualRateLimit({
      name,
      max,
      ipMax,
      windowMs: 60 * 60 * 1000,
      identifier: (req) => req.authUser?.id ?? null,
      redis: deps.redis,
    });
  // A whole gym books from one address on its wi-fi when a popular class opens (§13.7:
  // two hundred people inside a minute), hence each explicit `ipMax`.
  const readLimit = limiter("orgs_bookings_read", 1200, 60_000);
  const writeLimit = limiter("orgs_bookings_write", 120, 12_000);
  const staffReadLimit = limiter("orgs_bookings_staff_read", 1200, 6000);

  // Membership first and the limit after it: a stranger's 404 is never a 429.
  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };

  // ── MEMBERS ──

  // A week of the gym's coming classes, each with the reader's own booking.
  app.get("/v1/orgs/:gymId/member-classes", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(memberClassesQuerySchema, req.query, req, reply);
    if (query === null) return;
    const list = await service.getMemberClasses(bookingDeps, requireUserId(req), params.gymId, query, gate(readLimit)(req, reply));
    if (list === null) return;
    return reply.status(200).send(list);
  });

  app.get("/v1/orgs/:gymId/class-sessions/:sessionId/booking", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(classSessionParamsSchema, req.params, req, reply);
    if (params === null) return;
    const booking = await service.getBooking(bookingDeps, requireUserId(req), params.gymId, params.sessionId, gate(readLimit)(req, reply));
    if (booking === null) return;
    return reply.status(200).send({ booking });
  });

  // Book, Join waitlist (`joinWaitlist`) and Claim. The same `requestKey` again answers
  // the booking it made and changes nothing.
  app.post("/v1/orgs/:gymId/class-sessions/:sessionId/booking", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(classSessionParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(bookClassRequestSchema, req.body, req, reply);
    if (body === null) return;
    const booking = await service.book(bookingDeps, requireUserId(req), params.gymId, params.sessionId, body, gate(writeLimit)(req, reply));
    if (booking === null) return;
    return reply.status(200).send({ booking });
  });

  // Cancel a booking or leave the waitlist. Past the free time it answers 409
  // `late_cancel` until the request says `lateOk`.
  app.post("/v1/orgs/:gymId/class-sessions/:sessionId/booking/cancel", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(classSessionParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(cancelClassBookingRequestSchema, req.body, req, reply);
    if (body === null) return;
    try {
      const booking = await service.cancel(bookingDeps, requireUserId(req), params.gymId, params.sessionId, body.lateOk, gate(writeLimit)(req, reply));
      if (booking === null) return;
      return await reply.status(200).send({ booking });
    } catch (err) {
      if (!(err instanceof service.LateCancel)) throw err;
      return reply.status(409).send({ error: CLASS_LATE_CANCEL_ERROR, message: err.message, packCharged: err.packCharged, requestId: req.id });
    }
  });

  // ── STAFF HOLDING `schedule.manage`, AND THE CLASS'S OWN COACH ──

  app.get("/v1/orgs/:gymId/class-sessions/:sessionId/bookings", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(classSessionParamsSchema, req.params, req, reply);
    if (params === null) return;
    const list = await service.getSessionBookings(bookingDeps, requireUserId(req), params.gymId, params.sessionId, gate(staffReadLimit)(req, reply));
    if (list === null) return;
    return reply.status(200).send(list);
  });

  // Came or no-show, once the class has started (17f). The same mark again is a 200. A
  // class of forty marked by three staff at one desk is well inside these.
  const markLimit = limiter("orgs_bookings_mark", 600, 1800);
  app.post("/v1/orgs/:gymId/class-sessions/:sessionId/bookings/:bookingId/mark", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(classBookingParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(markClassBookingRequestSchema, req.body, req, reply);
    if (body === null) return;
    const list = await service.markBooking(
      bookingDeps,
      requireUserId(req),
      params.gymId,
      params.sessionId,
      params.bookingId,
      body,
      gate(markLimit)(req, reply),
    );
    if (list === null) return;
    return reply.status(200).send(list);
  });

  // ── STAFF HOLDING `schedule.manage` ──

  // Staff set a timetable and its settings now and then; three at one front desk share
  // an address. The service asks who they are first, as for members above.
  const staffLimit = limiter("orgs_bookings_staff", 300, 900);
  const staff = { preHandler: app.authenticate };

  // Whose bookings a change to the timetable would end: the whole list, a page at a time.
  app.get("/v1/orgs/:gymId/class-bookings/ending", staff, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(classBookingsEndingQuerySchema, req.query, req, reply);
    if (query === null) return;
    const list = await service.getEndingBookings(bookingDeps, requireUserId(req), params.gymId, query, gate(staffLimit)(req, reply));
    if (list === null) return;
    return reply.status(200).send(list);
  });

  app.get("/v1/orgs/:gymId/booking-settings", staff, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const settings = await service.getBookingSettings(bookingDeps, requireUserId(req), params.gymId, gate(staffLimit)(req, reply));
    if (settings === null) return;
    return reply.status(200).send(settings);
  });

  // PUT: all four, and personal training's two, every time.
  app.put("/v1/orgs/:gymId/booking-settings", staff, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(bookingSettingsBodySchema, req.body, req, reply);
    if (body === null) return;
    const saved = await service.setBookingSettings(bookingDeps, requireUserId(req), params.gymId, body, gate(staffLimit)(req, reply));
    if (saved === null) return;
    return reply.status(200).send(saved);
  });
}
