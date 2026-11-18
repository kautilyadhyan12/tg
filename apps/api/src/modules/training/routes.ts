// POST /v1/workouts: one whole workout from the phone (spec Part 2 §13.5, job 61a). Route order:
// authenticate → the person's own rate limit → parse → handler. Its id is its Idempotency-Key, as a
// run's is. The old save route, POST /v1/workouts/sync, stays as it is for the web's old pages.
//
// Answers: 201 saved · 200 saved already · 400 a broken phone (its fields, never its values) · 404
// somebody else's id · 422 an exercise the Library does not know, with their id words.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { WORKOUT_SAVE_LIMITS, workoutSaveSchema, type WorkoutSaveRefusal } from "@app/shared";
import type { RedisLike } from "../../redis.js";
import { createDualRateLimit } from "../auth/rateLimit.js";
import { tellMembersLeaderboards, type LiveNewsSender } from "../live/news.js";
import { LIST_ITEMS_MOST } from "../../listLimit.js";
import { ForeignWorkoutError, RefusedSaveError, UnknownExercisesError, saveWorkout } from "./service.js";

/** Twelve hours of heart rate at one a second, as text, is about 0.6 MB. */
const BODY_MOST_BYTES = 1024 * 1024;
const LIST_ITEMS_FOR_SAVE = LIST_ITEMS_MOST + WORKOUT_SAVE_LIMITS.heartMost * 3;

const validationError = (req: FastifyRequest, reply: FastifyReply, message: string) =>
  reply.status(400).send({ error: "validation_error", message, requestId: req.id });

export function registerTrainingRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; redis: RedisLike; news: LiveNewsSender; now?: () => Date },
): void {
  const now = deps.now ?? (() => new Date());
  // Ten a minute for a person, as a run's save; never by address, so a gym's members on one wi-fi
  // never use up each other's.
  const saveLimit = createDualRateLimit({
    name: "workout_save",
    max: 10,
    ipMax: null,
    windowMs: 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.post(
    "/v1/workouts",
    { onRequest: [app.authenticate, saveLimit], bodyLimit: BODY_MOST_BYTES, config: { listItemsMost: LIST_ITEMS_FOR_SAVE } },
    async (req, reply) => {
      const userId = req.authUser?.id;
      if (userId === undefined) throw new Error("authenticate did not run");

      const parsed = workoutSaveSchema.safeParse(req.body);
      // Issue paths and messages only, never a value the phone sent.
      if (!parsed.success) return validationError(req, reply, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      if (req.headers["idempotency-key"] !== parsed.data.workoutId) {
        return reply.status(400).send({ error: "idempotency_key_mismatch", message: "Idempotency-Key header must equal body workoutId", requestId: req.id });
      }

      try {
        const { status } = await saveWorkout({ sql: deps.sql, now }, userId, parsed.data);
        // A new workout may be a workout day on the leaderboard of each of the person's gyms.
        if (status === "created") tellMembersLeaderboards(deps.sql, deps.news, app.log, userId);
        return await reply.status(status === "created" ? 201 : 200).send({ workoutId: parsed.data.workoutId, status });
      } catch (err) {
        if (err instanceof ForeignWorkoutError) return reply.status(404).send({ error: "not_found", message: "workout not found", requestId: req.id });
        if (err instanceof UnknownExercisesError) {
          const refusal: WorkoutSaveRefusal = { error: "unknown_exercise", exercises: [...err.exercises], requestId: req.id };
          return reply.status(422).send(refusal);
        }
        if (err instanceof RefusedSaveError) {
          return validationError(req, reply, err.problem === "time_zone" ? "timeZone: not a time zone" : "endedAt: the workout has not ended yet");
        }
        throw err;
      }
    },
  );
}
