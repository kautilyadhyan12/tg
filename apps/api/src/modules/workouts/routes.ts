// P1.10d/P2.1 — POST /v1/workouts/sync (v1 §5.3; Part 4 §3.5). Route order per
// R3.3: authenticate (P2.1 preHandler — replaced the SYNC_DEV_USER_ID seam) →
// parse → idempotency header check → handler. Entitlement/quota/per-route rate
// limits are not metered on this path in v1; the global limiter applies.
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { workoutSyncPayloadSchema } from "./schemas.js";
import { handleWorkoutSync } from "./service.js";
import { ForeignWorkoutError } from "./repo.js";

export function registerWorkoutRoutes(app: FastifyInstance, deps: { sql: Sql }): void {
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
}
