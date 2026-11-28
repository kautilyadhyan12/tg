// POST /v1/workouts: one whole workout from the phone (spec Part 2 §13.5, job 61a); and the reads of a
// person's history and records (job 61b), further down. Save route order:
// authenticate → the person's own rate limit → parse → handler. Its id is its Idempotency-Key, as a
// run's is. The old save route, POST /v1/workouts/sync, stays as it is for the web's old pages.
//
// Answers: 201 saved · 200 saved already · 400 a broken phone (its fields, never its values) · 404
// somebody else's id · 422 an exercise the Library does not know, with their id words.
//
// Saved workouts (job 61c), at the end: list, read one, save or save a change (PUT, under the phone's
// own id), delete. Somebody else's saved workout is 404 to every one of them.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import {
  SAVED_EDITED_AHEAD,
  WORKOUT_NOT_ENDED,
  WORKOUT_SAVE_LIMITS,
  exerciseIdSchema,
  historyDaySchema,
  historyMonthQuerySchema,
  historyRangeQuerySchema,
  PLANNED_WORKOUT_LIMITS,
  savedWorkoutWriteSchema,
  workoutEffortSchema,
  workoutSaveSchema,
  type SavedWorkoutsFull,
  type WorkoutSaveRefusal,
} from "@app/shared";
import { z } from "zod";
import { historyDay, historyMonth, historyRange, historyWorkout, recordsOf } from "./history.js";
import type { RedisLike } from "../../redis.js";
import { createDualRateLimit } from "../auth/rateLimit.js";
import { tellMembersLeaderboards, type LiveNewsSender } from "../live/news.js";
import { LIST_ITEMS_MOST } from "../../listLimit.js";
import { ForeignWorkoutError, RefusedSaveError, UnknownExercisesError, saveWorkout } from "./service.js";
import { giveEffort, workoutSummary } from "./summary.js";
import { ForeignSavedError, FutureEditError, SavedFullError, deleteSaved, listSaved, readSaved, writeSaved } from "./saved.js";

/** Twelve hours of heart rate at one a second, as text, is about 0.6 MB; the biggest save the schema takes, with 200
 *  camera sets at their longest (job 64b-i), 1.2 MB, measured under it in `training.camera.unit.test.ts`. */
export const BODY_MOST_BYTES = 1.5 * 1024 * 1024;
export const LIST_ITEMS_FOR_SAVE = LIST_ITEMS_MOST + WORKOUT_SAVE_LIMITS.heartMost * 3 + WORKOUT_SAVE_LIMITS.repScoresMost;
/** The most object keys in a save: the biggest the schema takes holds 12,412 (200 camera sets of 62 keys each, at their
 *  most, and the workout's own 12), measured in `training.camera.unit.test.ts` (round one, H1). */
export const OBJECT_MEMBERS_FOR_SAVE = 15_000;

const validationError = (req: FastifyRequest, reply: FastifyReply, message: string) =>
  reply.status(400).send({ error: "validation_error", message, requestId: req.id });

/** A part of a field's path, cut short: a record's key is the phone's own word. */
const pathWords = (path: readonly PropertyKey[]): string => path.map((p) => String(p).slice(0, 40)).join(".");

/** A refused save's problems for the phone: where each is and what is wrong, never a value it sent; at most ten, and
 *  unknown keys named by at most five of their names (round one, H1: 5,000 unknown keys made a reply of every name). */
export function saveIssueWords(e: z.ZodError, most = 10): string {
  const words = e.issues.slice(0, most).map((i) => {
    if (i.code !== "unrecognized_keys") return `${pathWords(i.path)}: ${i.message}`;
    const named = i.keys.slice(0, 5).map((k) => `"${k.slice(0, 40)}"`).join(", ");
    const more = i.keys.length > 5 ? ` and ${String(i.keys.length - 5)} more` : "";
    return `${pathWords(i.path)}: unknown keys ${named}${more}`;
  });
  if (e.issues.length > most) words.push(`and ${String(e.issues.length - most)} more problems`);
  return words.join("; ");
}

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
    { onRequest: [app.authenticate, saveLimit], bodyLimit: BODY_MOST_BYTES, config: { listItemsMost: LIST_ITEMS_FOR_SAVE, objectMembersMost: OBJECT_MEMBERS_FOR_SAVE } },
    async (req, reply) => {
      const userId = req.authUser?.id;
      if (userId === undefined) throw new Error("authenticate did not run");

      const parsed = workoutSaveSchema.safeParse(req.body);
      // Issue paths and messages only, never a value the phone sent.
      if (!parsed.success) return validationError(req, reply, saveIssueWords(parsed.error));
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
          return reply.status(400).send({ error: WORKOUT_NOT_ENDED, message: "endedAt: the workout has not ended yet", requestId: req.id });
        }
        throw err;
      }
    },
  );

  // ── history and records (job 61b): reads of the person's own workouts. Route order: authenticate →
  // the person's own read limit → parse → handler. A workout that is not theirs is the same 404 as one
  // that does not exist, and so is an exercise the server never had.
  const readLimit = createDualRateLimit({
    name: "training_read",
    max: 120,
    ipMax: null,
    windowMs: 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const readDeps = { sql: deps.sql, redis: deps.redis };
  const owner = (req: FastifyRequest): string => {
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate did not run");
    return userId;
  };
  const notFound = (req: FastifyRequest, reply: FastifyReply, what: string) =>
    reply.status(404).send({ error: "not_found", message: `${what} not found`, requestId: req.id });
  const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");

  app.get("/v1/training/month", { onRequest: [app.authenticate, readLimit] }, async (req, reply) => {
    const parsed = historyMonthQuerySchema.safeParse(req.query);
    if (!parsed.success) return validationError(req, reply, issues(parsed.error));
    return reply.status(200).send(await historyMonth(readDeps, owner(req), parsed.data.month));
  });

  // The calendar's days (64a-v): a year of them in one read, counted as the month and the day are.
  app.get("/v1/training/days", { onRequest: [app.authenticate, readLimit] }, async (req, reply) => {
    const parsed = historyRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) return validationError(req, reply, issues(parsed.error));
    return reply.status(200).send(await historyRange(readDeps, owner(req), parsed.data.from, parsed.data.to));
  });

  app.get<{ Params: { day: string } }>("/v1/training/days/:day", { onRequest: [app.authenticate, readLimit] }, async (req, reply) => {
    const parsed = historyDaySchema.safeParse(req.params.day);
    if (!parsed.success) return validationError(req, reply, `day: ${issues(parsed.error)}`);
    return reply.status(200).send(await historyDay(readDeps, owner(req), parsed.data));
  });

  app.get<{ Params: { id: string } }>("/v1/training/workouts/:id", { onRequest: [app.authenticate, readLimit] }, async (req, reply) => {
    // A broken id reads as absent: the same 404 as somebody else's.
    const parsed = z.uuid().safeParse(req.params.id);
    if (!parsed.success) return notFound(req, reply, "workout");
    const found = await historyWorkout(readDeps, owner(req), parsed.data);
    return found === null ? notFound(req, reply, "workout") : reply.status(200).send(found);
  });

  // ── after a workout (job 64a-iii): what the server adds to the phone's own summary, and the effort stars given
  // after the save. Somebody else's workout is the same 404 as one that does not exist.
  app.get<{ Params: { id: string } }>("/v1/training/workouts/:id/summary", { onRequest: [app.authenticate, readLimit] }, async (req, reply) => {
    const parsed = z.uuid().safeParse(req.params.id);
    if (!parsed.success) return notFound(req, reply, "workout");
    const found = await workoutSummary({ ...readDeps, now }, owner(req), parsed.data);
    return found === null ? notFound(req, reply, "workout") : reply.status(200).send(found);
  });

  // Thirty a minute for the person, never by address: a press on each star is one each.
  const effortLimit = createDualRateLimit({
    name: "workout_effort",
    max: 30,
    ipMax: null,
    windowMs: 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  app.put<{ Params: { id: string } }>("/v1/training/workouts/:id/effort", { onRequest: [app.authenticate, effortLimit] }, async (req, reply) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) return notFound(req, reply, "workout");
    const parsed = workoutEffortSchema.safeParse(req.body);
    if (!parsed.success) return validationError(req, reply, issues(parsed.error));
    const given = await giveEffort({ sql: deps.sql }, owner(req), id.data, parsed.data.effort);
    return given ? reply.status(200).send({ workoutId: id.data, effort: parsed.data.effort }) : notFound(req, reply, "workout");
  });

  app.get<{ Params: { exercise: string } }>("/v1/training/exercises/:exercise/records", { onRequest: [app.authenticate, readLimit] }, async (req, reply) => {
    const parsed = exerciseIdSchema.safeParse(req.params.exercise);
    if (!parsed.success) return notFound(req, reply, "exercise");
    const found = await recordsOf(readDeps, owner(req), parsed.data);
    return found === null ? notFound(req, reply, "exercise") : reply.status(200).send(found);
  });

  // ── saved workouts (job 61c). Route order: authenticate → the person's own limit → parse → handler.
  // A save or a delete is safe to send twice: the id is the phone's own.
  const savedWriteLimit = createDualRateLimit({
    name: "saved_workout_write",
    max: 30,
    ipMax: null,
    windowMs: 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const savedDeps = { sql: deps.sql, now };

  app.get("/v1/training/saved", { onRequest: [app.authenticate, readLimit] }, async (req, reply) => {
    return reply.status(200).send(await listSaved(savedDeps, owner(req)));
  });

  app.get<{ Params: { id: string } }>("/v1/training/saved/:id", { onRequest: [app.authenticate, readLimit] }, async (req, reply) => {
    const parsed = z.uuid().safeParse(req.params.id);
    if (!parsed.success) return notFound(req, reply, "saved workout");
    const found = await readSaved(savedDeps, owner(req), parsed.data);
    return found === null ? notFound(req, reply, "saved workout") : reply.status(200).send(found);
  });

  app.put<{ Params: { id: string } }>("/v1/training/saved/:id", { onRequest: [app.authenticate, savedWriteLimit] }, async (req, reply) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) return validationError(req, reply, "id: a saved workout's id is a UUID");
    const parsed = savedWorkoutWriteSchema.safeParse(req.body);
    if (!parsed.success) return validationError(req, reply, issues(parsed.error));
    try {
      const written = await writeSaved(savedDeps, owner(req), id.data, parsed.data);
      return await reply.status(written.status === "created" ? 201 : 200).send({ id: id.data, ...written });
    } catch (err) {
      if (err instanceof ForeignSavedError) return notFound(req, reply, "saved workout");
      if (err instanceof UnknownExercisesError) {
        const refusal: WorkoutSaveRefusal = { error: "unknown_exercise", exercises: [...err.exercises], requestId: req.id };
        return reply.status(422).send(refusal);
      }
      if (err instanceof SavedFullError) {
        const full: SavedWorkoutsFull = { error: "saved_workouts_full", most: PLANNED_WORKOUT_LIMITS.savedMost, requestId: req.id };
        return reply.status(409).send(full);
      }
      if (err instanceof FutureEditError) {
        return reply.status(400).send({ error: SAVED_EDITED_AHEAD, message: "editedAt: later than the server's clock", serverTime: now().toISOString(), requestId: req.id });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>("/v1/training/saved/:id", { onRequest: [app.authenticate, savedWriteLimit] }, async (req, reply) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) return notFound(req, reply, "saved workout");
    return (await deleteSaved(savedDeps, owner(req), id.data)) ? reply.status(204).send() : notFound(req, reply, "saved workout");
  });
}
