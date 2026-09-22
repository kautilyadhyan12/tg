// THE TIMETABLE'S ROUTES (Part 3 §13.3), thin as every other route file in this
// module: authenticate, Zod-parse, hand to the service, which owns the
// authorisation. Registered from `registerOrgRoutes` — the same console behind
// the same gates, sharing its deps.
//
// **ONE RATE LIMIT COVERS ALL SIX, AND ITS `ipMax` IS EXPLICIT.** A gym's front
// desk is ONE address with several staff signed in on it (the shared-address
// class this repo has been bitten by more than once), so a per-address ceiling
// equal to the per-person one would throttle the second person to touch the
// screen. Keyed on the USER, so one gym cannot spend another's allowance and one
// member of staff cannot spend a colleague's.
//
// **THE LIMITER IS A `preHandler` HERE AND NOT CALLED FROM THE SERVICE**, which
// is the opposite of `memberList/routes.ts` and is the right way round for these
// routes: nothing behind them is expensive enough that a refused caller's
// allowance matters, and a preHandler is the shape every other route in this
// module uses. The member list moved its limiter inside the handler because
// reading a file costs a worker and fifteen seconds; a timetable write costs one
// short transaction.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import {
  createGymClassScheduleRequestSchema,
  createGymClassTypeRequestSchema,
  updateGymClassTypeRequestSchema,
} from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { classScheduleParamsSchema, classTypeParamsSchema, orgParamsSchema } from "../schemas.js";
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

export interface ClassRouteDeps {
  sql: Sql;
  redis: RedisLike;
}

export function registerClassRoutes(app: FastifyInstance, deps: ClassRouteDeps): void {
  const classDeps: service.ClassesDeps = { sql: deps.sql, now: () => new Date() };

  /** A timetable is set in bursts — a gym typing in twenty classes on its first
   *  afternoon — and then hardly touched. 300 an hour each is far above that and
   *  far below anything that could hurt; 900 from one address lets three people
   *  at the front desk work at once without any of them noticing the other. */
  const limit = createDualRateLimit({
    name: "org_classes",
    max: 300,
    ipMax: 900,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const guarded = { preHandler: [app.authenticate, limit] };

  app.get("/v1/orgs/:gymId/classes", guarded, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const timetable = await service.getTimetable(classDeps, requireUserId(req), params.gymId);
    return reply.status(200).send(timetable);
  });

  /** 201: this mints a row with an id of its own. The BODY is the whole
   *  timetable all the same — see `gymClassMutationResponseSchema` — because
   *  saving a class changes what every other screen on this page shows. */
  app.post("/v1/orgs/:gymId/classes", guarded, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(createGymClassTypeRequestSchema, req.body, req, reply);
    if (body === null) return;
    const timetable = await service.createClassType(
      classDeps,
      requireUserId(req),
      params.gymId,
      body,
    );
    return reply.status(201).send(timetable);
  });

  /** PUT and not PATCH: the body is EVERY field, so this replaces a class rather
   *  than merging into one — `setGymHours`' reasoning, and the reason is sharper
   *  here. `places: null` means "no limit"; under a merge it would be
   *  indistinguishable from "leave it alone", and a gym clearing the cap on its
   *  open-gym slot would silently keep it.
   *
   *  PUT reaches a browser only through a CORS PREFLIGHT — the failure
   *  `fastify.inject` is structurally unable to see. `app.ts` lists PUT (the
   *  hours and staff-privileges routes already depend on it), and the
   *  click-through is what proves it in a real browser. */
  app.put("/v1/orgs/:gymId/classes/:classTypeId", guarded, async (req, reply) => {
    const params = parseOr400(classTypeParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(updateGymClassTypeRequestSchema, req.body, req, reply);
    if (body === null) return;
    const timetable = await service.updateClassType(
      classDeps,
      requireUserId(req),
      params.gymId,
      params.classTypeId,
      body,
    );
    return reply.status(200).send(timetable);
  });

  /** DELETE is the honest method for "take this off my timetable", and what it
   *  performs is an ARCHIVE — the class is kept, its future dates are not (see
   *  `repo.archiveClassType`). The same request twice leaves the same state and
   *  answers 404 the second time, which is what a caller should be told: the
   *  thing it asked about is no longer on the live timetable. */
  app.delete("/v1/orgs/:gymId/classes/:classTypeId", guarded, async (req, reply) => {
    const params = parseOr400(classTypeParamsSchema, req.params, req, reply);
    if (params === null) return;
    const timetable = await service.archiveClassType(
      classDeps,
      requireUserId(req),
      params.gymId,
      params.classTypeId,
    );
    return reply.status(200).send(timetable);
  });

  /** BRING IT BACK. POST and not PUT: it is an action on a thing, not a
   *  replacement of it, and the same request twice answers 404 the second time
   *  — which is what a caller acting on a stale list should be told. */
  app.post("/v1/orgs/:gymId/classes/:classTypeId/restore", guarded, async (req, reply) => {
    const params = parseOr400(classTypeParamsSchema, req.params, req, reply);
    if (params === null) return;
    const timetable = await service.restoreClassType(
      classDeps,
      requireUserId(req),
      params.gymId,
      params.classTypeId,
    );
    return reply.status(200).send(timetable);
  });

  app.post("/v1/orgs/:gymId/classes/:classTypeId/repeats", guarded, async (req, reply) => {
    const params = parseOr400(classTypeParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(createGymClassScheduleRequestSchema, req.body, req, reply);
    if (body === null) return;
    const timetable = await service.createSchedule(
      classDeps,
      requireUserId(req),
      params.gymId,
      params.classTypeId,
      body,
    );
    return reply.status(201).send(timetable);
  });

  /** STOP A REPEAT. The repeat id is addressed under its GYM, never alone — the
   *  pair is the key everywhere in this module, and a route that accepts an id
   *  on its own is a route where somebody eventually trusts the wrong one. */
  app.delete("/v1/orgs/:gymId/class-repeats/:scheduleId", guarded, async (req, reply) => {
    const params = parseOr400(classScheduleParamsSchema, req.params, req, reply);
    if (params === null) return;
    const timetable = await service.endSchedule(
      classDeps,
      requireUserId(req),
      params.gymId,
      params.scheduleId,
    );
    return reply.status(200).send(timetable);
  });
}
