// PERSONAL TRAINING: THE ROUTES (spec Part 3 §13.5; ROADMAP 17e-i). Authenticate,
// Zod-parse, and the service decides who may read or write. Registered from
// `registerOrgRoutes`.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import { PT_LATE_CANCEL_ERROR, bookPtRequestSchema, cancelPtRequestSchema, ptWeekQuerySchema, savePtTrainerRequestSchema } from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
import * as service from "./service.js";

const trainerParamsSchema = z.object({ gymId: z.string().uuid(), userId: z.string().uuid() }).strict();
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

  app.get("/v1/orgs/:gymId/pt/week", staff, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(ptWeekQuerySchema, req.query, req, reply);
    if (query === null) return;
    const week = await service.getWeek(ptDeps, requireUserId(req), params.gymId, query, gate(readLimit)(req, reply));
    if (week === null) return;
    return reply.status(200).send(week);
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
}
