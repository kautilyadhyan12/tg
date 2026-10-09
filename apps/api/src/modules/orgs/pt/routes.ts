// PERSONAL TRAINING: THE ROUTES (spec Part 3 §13.5; ROADMAP 17e-i). Authenticate,
// Zod-parse, and the service decides who may read or write. Registered from
// `registerOrgRoutes`.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import {
  PT_LATE_CANCEL_ERROR,
  PT_TIME_OFF_OVER_ERROR,
  addPtTimeOffRequestSchema,
  bookPtRequestSchema,
  cancelPtRequestSchema,
  markPtRequestSchema,
  memberBookPtRequestSchema,
  memberCancelPtRequestSchema,
  memberPtQuerySchema,
  ptPeopleQuerySchema,
  ptWeekQuerySchema,
  savePtTrainerRequestSchema,
} from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
import { createLine } from "../classes/bookingsService.js";
import * as memberService from "./memberService.js";
import * as service from "./service.js";

const trainerParamsSchema = z.object({ gymId: z.string().uuid(), userId: z.string().uuid() }).strict();
const timeOffParamsSchema = z.object({ gymId: z.string().uuid(), userId: z.string().uuid(), timeOffId: z.string().uuid() }).strict();
const appointmentParamsSchema = z.object({ gymId: z.string().uuid(), appointmentId: z.string().uuid() }).strict();

function parseOr400<S extends z.ZodTypeAny>(schema: S, value: unknown, req: FastifyRequest, reply: FastifyReply): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    // Issue paths and codes only, never the offending value; the first ten.
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues
        .slice(0, 10)
        .map((i) => `${i.path.join(".")}: ${i.code}`)
        .join("; "),
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

export function registerPtRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike; now: () => Date }): void {
  const ptDeps: service.PtDeps = { sql: deps.sql, now: deps.now };
  const limiter = (name: string, max: number, ipMax: number) =>
    createDualRateLimit({
      name,
      max,
      ipMax,
      windowMs: 60 * 60 * 1000,
      identifier: (req) => req.authUser?.id ?? null,
      redis: deps.redis,
    });
  // Staff only; a gym's staff share its front-desk address, hence each explicit `ipMax`.
  const readLimit = limiter("orgs_pt_read", 1200, 6000);
  const writeLimit = limiter("orgs_pt_write", 300, 900);

  // Standing first and the limit after it: a stranger's 404 is never a 429.
  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };
  const staff = { preHandler: app.authenticate };

  app.get("/v1/orgs/:gymId/pt/trainers", staff, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const list = await service.getTrainers(ptDeps, requireUserId(req), params.gymId, gate(readLimit)(req, reply));
    if (list === null) return;
    return reply.status(200).send(list);
  });

  // PUT: a trainer's hours, all of them every time.
  app.put("/v1/orgs/:gymId/pt/trainers/:userId", staff, async (req, reply) => {
    const params = parseOr400(trainerParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(savePtTrainerRequestSchema, req.body, req, reply);
    if (body === null) return;
    const list = await service.saveTrainer(ptDeps, requireUserId(req), params.gymId, params.userId, body, gate(writeLimit)(req, reply));
    if (list === null) return;
    return reply.status(200).send(list);
  });

  // A trainer's time off. With sessions or classes in it, 409 `time_off_over_bookings` names
  // them until the request sends their `mark` as `confirm`. The same `requestKey` again adds nothing.
  app.post("/v1/orgs/:gymId/pt/trainers/:userId/time-off", staff, async (req, reply) => {
    const params = parseOr400(trainerParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(addPtTimeOffRequestSchema, req.body, req, reply);
    if (body === null) return;
    try {
      const list = await service.addTimeOff(ptDeps, requireUserId(req), params.gymId, params.userId, body, gate(writeLimit)(req, reply));
      if (list === null) return;
      return await reply.status(200).send(list);
    } catch (err) {
      if (!(err instanceof service.PtTimeOffAsk)) throw err;
      return reply.status(409).send({ error: PT_TIME_OFF_OVER_ERROR, message: err.message, over: err.over, requestId: req.id });
    }
  });

  app.delete("/v1/orgs/:gymId/pt/trainers/:userId/time-off/:timeOffId", staff, async (req, reply) => {
    const params = parseOr400(timeOffParamsSchema, req.params, req, reply);
    if (params === null) return;
    const list = await service.removeTimeOff(ptDeps, requireUserId(req), params.gymId, params.userId, params.timeOffId, gate(writeLimit)(req, reply));
    if (list === null) return;
    return reply.status(200).send(list);
  });

  app.get("/v1/orgs/:gymId/pt/week", staff, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(ptWeekQuerySchema, req.query, req, reply);
    if (query === null) return;
    const week = await service.getWeek(ptDeps, requireUserId(req), params.gymId, query, gate(readLimit)(req, reply));
    if (week === null) return;
    return reply.status(200).send(week);
  });

  // Who a session can be booked for: the member list, people with personal training first.
  app.get("/v1/orgs/:gymId/pt/people", staff, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(ptPeopleQuerySchema, req.query, req, reply);
    if (query === null) return;
    const people = await service.getPeople(ptDeps, requireUserId(req), params.gymId, query, gate(readLimit)(req, reply));
    if (people === null) return;
    return reply.status(200).send(people);
  });

  // The same `requestKey` again answers the session it made and changes nothing.
  app.post("/v1/orgs/:gymId/pt/appointments", staff, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(bookPtRequestSchema, req.body, req, reply);
    if (body === null) return;
    const appointment = await service.book(ptDeps, requireUserId(req), params.gymId, body, gate(writeLimit)(req, reply));
    if (appointment === null) return;
    return reply.status(200).send({ appointment });
  });

  // Past the free time it answers 409 `late_cancel` until the request says `lateOk`.
  app.post("/v1/orgs/:gymId/pt/appointments/:appointmentId/cancel", staff, async (req, reply) => {
    const params = parseOr400(appointmentParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(cancelPtRequestSchema, req.body, req, reply);
    if (body === null) return;
    try {
      const appointment = await service.cancel(ptDeps, requireUserId(req), params.gymId, params.appointmentId, body, gate(writeLimit)(req, reply));
      if (appointment === null) return;
      return await reply.status(200).send({ appointment });
    } catch (err) {
      if (!(err instanceof service.PtLateCancel)) throw err;
      return reply.status(409).send({ error: PT_LATE_CANCEL_ERROR, message: err.message, packCharged: err.packCharged, requestId: req.id });
    }
  });

  // Came or no-show, once the session has started (17e-iv-b). The same mark again is a 200.
  app.post("/v1/orgs/:gymId/pt/appointments/:appointmentId/mark", staff, async (req, reply) => {
    const params = parseOr400(appointmentParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(markPtRequestSchema, req.body, req, reply);
    if (body === null) return;
    const appointment = await service.mark(ptDeps, requireUserId(req), params.gymId, params.appointmentId, body, gate(writeLimit)(req, reply));
    if (appointment === null) return;
    return reply.status(200).send({ appointment });
  });

  // ── MEMBERS: THEIR OWN SESSIONS (17e-ii) ──

  const memberDeps: memberService.MemberPtDeps = { ...ptDeps, inLine: createLine() };
  // A gym's members share its wi-fi's address, hence each explicit `ipMax`.
  const memberReadLimit = limiter("orgs_pt_member_read", 1200, 60_000);
  const memberWriteLimit = limiter("orgs_pt_member_write", 120, 12_000);
  const member = { preHandler: app.authenticate };

  // Seven days of the gym's trainers' available times, with the reader's own sessions.
  app.get("/v1/orgs/:gymId/member-pt", member, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(memberPtQuerySchema, req.query, req, reply);
    if (query === null) return;
    const view = await memberService.getMemberPt(ptDeps, requireUserId(req), params.gymId, query, gate(memberReadLimit)(req, reply));
    if (view === null) return;
    return reply.status(200).send(view);
  });

  // The body names no person: the session is the reader's own.
  app.post("/v1/orgs/:gymId/member-pt/sessions", member, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberBookPtRequestSchema, req.body, req, reply);
    if (body === null) return;
    const session = await memberService.memberBook(memberDeps, requireUserId(req), params.gymId, body, gate(memberWriteLimit)(req, reply));
    if (session === null) return;
    return reply.status(200).send({ session });
  });

  app.post("/v1/orgs/:gymId/member-pt/sessions/:appointmentId/cancel", member, async (req, reply) => {
    const params = parseOr400(appointmentParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberCancelPtRequestSchema, req.body, req, reply);
    if (body === null) return;
    try {
      const session = await memberService.memberCancel(memberDeps, requireUserId(req), params.gymId, params.appointmentId, body, gate(memberWriteLimit)(req, reply));
      if (session === null) return;
      return await reply.status(200).send({ session });
    } catch (err) {
      if (!(err instanceof service.PtLateCancel)) throw err;
      // A member's late cancel keeps the session used; the box says so before they confirm.
      return reply.status(409).send({ error: PT_LATE_CANCEL_ERROR, message: err.message, packCharged: err.packCharged, requestId: req.id });
    }
  });
}
