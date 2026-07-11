// P1.10d/P2.1 — POST /v1/workouts/sync (v1 §5.3; Part 4 §3.5). Route order per
// R3.3: authenticate (P2.1 preHandler — replaced the SYNC_DEV_USER_ID seam) →
// parse → idempotency header check → handler. Entitlement/quota/per-route rate
// limits are not metered on this path in v1; the global limiter applies.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import { progressQuerySchema, workoutListQuerySchema, workoutSyncPayloadSchema } from "./schemas.js";
import * as service from "./service.js";
import { handleWorkoutSync } from "./service.js";
import { ForeignWorkoutError } from "./repo.js";
import type { RedisLike } from "../../redis.js";

/** Zod-parse the querystring; 400 with issue paths/codes only (R3.10).
 *  Generic over the schema so .default() outputs stay non-optional. */
function parseQuery<S extends z.ZodTypeAny>(
  schema: S,
  req: FastifyRequest,
  reply: FastifyReply,
): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(req.query);
  if (!parsed.success) {
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
      requestId: req.id,
    });
    return null;
  }
  return parsed.data;
}

function authedUserId(req: FastifyRequest): string {
  const userId = req.authUser?.id;
  if (userId === undefined) throw new Error("authenticate preHandler did not run");
  return userId;
}

export function registerWorkoutRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike }): void {
  const readDeps: service.ReadDeps = { sql: deps.sql, redis: deps.redis };
  app.post("/v1/workouts/sync", { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");

    const parsed = workoutSyncPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "validation_error",
        // Issue paths/codes only — never echo received values (R3.10).
        message: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.code}`)
          .join("; "),
        requestId: req.id,
      });
    }

    // v1 §5.3: the POST carries an Idempotency-Key; it IS the client workout
    // id (R3.5). A mismatch means a buggy client — reject loudly, don't guess.
    const idempotencyKey = req.headers["idempotency-key"];
    if (idempotencyKey !== parsed.data.workoutId) {
      return reply.status(400).send({
        error: "idempotency_key_mismatch",
        message: "Idempotency-Key header must equal body workoutId",
        requestId: req.id,
      });
    }

    try {
      const result = await handleWorkoutSync(deps.sql, userId, parsed.data);
      if (result.skippedSets > 0) {
        req.log.warn(
          { workoutId: result.workoutId, skippedSets: result.skippedSets },
          "sync: sets skipped (unknown exercise slug)",
        );
      }
      return await reply
        .status(result.status === "created" ? 201 : 200)
        .send({ workoutId: result.workoutId, status: result.status });
    } catch (err) {
      if (err instanceof ForeignWorkoutError) {
        // R3.2's prescribed 404. (A 404-vs-201 difference is still a weak
        // existence oracle for a guessed id — acceptable: ids are uuid v4.)
        return reply.status(404).send({
          error: "not_found",
          message: "workout not found",
          requestId: req.id,
        });
      }
      throw err; // central error mapper handles 5xx (R8.1)
    }
  });

  // ── history (v1 §6.1; R3.3 order: authn → parse → handler; R7.3 cursor) ──
  app.get("/v1/workouts", { preHandler: [app.authenticate] }, async (req, reply) => {
    const query = parseQuery(workoutListQuerySchema, req, reply);
    if (query === null) return;
    const page = await service.listWorkouts(readDeps, authedUserId(req), query);
    return reply.status(200).send(page);
  });

  app.get<{ Params: { id: string } }>("/v1/workouts/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params;
    const notFound = () =>
      reply.status(404).send({ error: "not_found", message: "workout not found", requestId: req.id });
    // Non-uuid ids read as absent (same 404 as a foreign id — R3.2, no oracle).
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return notFound();
    }
    const detail = await service.getWorkout(deps.sql, authedUserId(req), id);
    if (detail === null) return notFound();
    return reply.status(200).send(detail);
  });

  // ── progress (progress.py ports) ─────────────────────────────────────────
  app.get("/v1/progress/overview", { preHandler: [app.authenticate] }, async (req, reply) => {
    const query = parseQuery(progressQuerySchema, req, reply);
    if (query === null) return;
    return reply.status(200).send(await service.progressOverview(readDeps, authedUserId(req), query.period));
  });

  app.get("/v1/progress/trend", { preHandler: [app.authenticate] }, async (req, reply) => {
    const query = parseQuery(progressQuerySchema, req, reply);
    if (query === null) return;
    return reply.status(200).send(await service.progressTrend(readDeps, authedUserId(req), query.period));
  });

  app.get("/v1/progress/weekly", { preHandler: [app.authenticate] }, async (req, reply) => {
    const query = parseQuery(progressQuerySchema, req, reply);
    if (query === null) return;
    return reply.status(200).send(await service.progressWeekly(readDeps, authedUserId(req), query.period));
  });

  app.get("/v1/progress/heatmap", { preHandler: [app.authenticate] }, async (req, reply) => {
    return reply.status(200).send(await service.progressHeatmap(readDeps, authedUserId(req)));
  });

  app.get("/v1/progress/distribution", { preHandler: [app.authenticate] }, async (req, reply) => {
    const query = parseQuery(progressQuerySchema, req, reply);
    if (query === null) return;
    return reply
      .status(200)
      .send(await service.progressDistribution(readDeps, authedUserId(req), query.period));
  });

  app.get("/v1/progress/records", { preHandler: [app.authenticate] }, async (req, reply) => {
    return reply.status(200).send(await service.personalRecords(readDeps, authedUserId(req)));
  });
}
