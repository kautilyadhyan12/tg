// A person's workout history and the records of each exercise (spec Part 2 §13.5, job 61b). A free plan
// reads back as many days as the old history does (`historyGate`, the same rule), and says so in
// `limitedToDays`. "New record" in a workout is told against everything before it, whatever the plan:
// it says only whether the set beat the person's own past, and saying it against a part of that past
// would call a lift a record that is not one.
import type { Sql } from "postgres";
import {
  HISTORY_DAY_WORKOUTS_MOST,
  type ExerciseRecords,
  type HistoryDay,
  type HistoryMonth,
  type HistorySet,
  type HistoryWorkout,
} from "@app/shared";
import { z } from "zod";
import type { RedisLike } from "../../redis.js";
import { safeTimeZone } from "../gamification/streak.js";
import { getUserSyncContext } from "../users/service.js";
import { historyGate } from "../workouts/service.js";
import * as repo from "./historyRepo.js";
import { exerciseRecords, newRecordsIn, unitAndDone, type SetFact } from "./records.js";

export interface HistoryDeps {
  sql: Sql;
  redis: RedisLike;
}

async function personZone(sql: Sql, userId: string): Promise<string> {
  return safeTimeZone((await getUserSyncContext(sql, userId)).timezone);
}

export async function historyMonth(deps: HistoryDeps, userId: string, month: string): Promise<HistoryMonth> {
  const [gate, zone] = await Promise.all([historyGate(deps, userId), personZone(deps.sql, userId)]);
  const days = await repo.monthDays(deps.sql, userId, month, zone, gate.floor);
  return { month, days: days.map((d) => ({ day: d.day, workouts: d.n })), limitedToDays: gate.limitedToDays };
}

export async function historyDay(deps: HistoryDeps, userId: string, day: string): Promise<HistoryDay> {
  const [gate, zone] = await Promise.all([historyGate(deps, userId), personZone(deps.sql, userId)]);
  const rows = await repo.dayWorkouts(deps.sql, userId, day, zone, gate.floor, HISTORY_DAY_WORKOUTS_MOST);
  return {
    day,
    workouts: rows.map((r) => ({
      workoutId: r.id,
      name: r.name,
      startedAt: r.started_at.toISOString(),
      endedAt: r.ended_at?.toISOString() ?? null,
      durationMs: r.duration_ms,
      setsCount: r.sets_count,
      kcalPoint: r.kcal_point,
      exercises: r.exercises ?? [],
    })),
    total: rows[0]?.total ?? 0,
    limitedToDays: gate.limitedToDays,
  };
}

const fact = (r: repo.SetRow): SetFact => ({
  workoutId: r.workout_id,
  startedAt: r.started_at.toISOString(),
  exercise: r.slug,
  position: r.set_index,
  ...unitAndDone(r.measured_in, r.reps, r.hold_ms),
  weightGrams: r.weight_grams,
});

/** How a set was counted. A set saved by the old route keeps only its mode: the engine's was the camera's,
 *  a typed one was by hand; one with neither is unknown. */
function countedOf(r: repo.SetRow): HistorySet["counted"] {
  if (r.counted === "camera" || r.counted === "hand" || r.counted === "timer") return r.counted;
  return r.mode === "engine" ? "camera" : r.mode === "log_only" ? "hand" : null;
}

// Parse, don't cast: the columns' CHECKs hold these, and this proves it on the way out.
const platformSchema = z.enum(["web", "android", "ios"]);
const startedFromSchema = z.enum(["saved", "app_plan", "gym_plan", "none"]).nullable();

/** One of the person's workouts set by set, with its new records; null for one that is not theirs. */
export async function historyWorkout(deps: HistoryDeps, userId: string, workoutId: string): Promise<HistoryWorkout | null> {
  const w = await repo.ownWorkout(deps.sql, userId, workoutId);
  if (w === null) return null;
  const sets = await repo.workoutSets(deps.sql, userId, workoutId);
  const exerciseIds = [...new Set(sets.map((s) => s.exercise_id))];
  const before = exerciseIds.length === 0 ? [] : await repo.exerciseSets(deps.sql, userId, exerciseIds, { before: { startedAt: w.started_at, workoutId: w.id }, floor: null });
  return {
    workoutId: w.id,
    name: w.name,
    startedAt: w.started_at.toISOString(),
    endedAt: w.ended_at?.toISOString() ?? null,
    timeZone: w.time_zone,
    startedFrom: startedFromSchema.parse(w.started_from),
    effort: w.effort,
    heartAvg: w.heart_avg,
    heartMax: w.heart_max,
    durationMs: w.duration_ms,
    kcalPoint: w.kcal_point,
    kcalCalcVersion: w.kcal_calc_version,
    platform: platformSchema.parse(w.platform),
    sets: sets.map((s) => {
      const f = fact(s);
      return {
        position: s.set_index,
        exercise: s.slug,
        exerciseName: s.name,
        measuredIn: f.measuredIn,
        target: s.target,
        done: f.done,
        weightGrams: s.weight_grams,
        restSeconds: s.rest_seconds,
        durationMs: s.duration_ms,
        counted: countedOf(s),
      };
    }),
    newRecords: newRecordsIn(sets.map(fact), before.map(fact)),
  };
}

/** The records of one exercise, or null for an id word the server never had. */
export async function recordsOf(deps: HistoryDeps, userId: string, exercise: string): Promise<ExerciseRecords | null> {
  const exerciseId = await repo.exerciseIdOf(deps.sql, exercise);
  if (exerciseId === null) return null;
  const gate = await historyGate(deps, userId);
  const sets = await repo.exerciseSets(deps.sql, userId, [exerciseId], { before: null, floor: gate.floor });
  return { exercise, ...exerciseRecords(sets.map(fact)), limitedToDays: gate.limitedToDays };
}
