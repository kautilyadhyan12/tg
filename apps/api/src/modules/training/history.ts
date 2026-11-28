// A person's workout history and the records of each exercise (spec Part 2 §13.5, job 61b). A free plan
// reads back as many days as the old history does (`historyGate`, the same rule), and says so in
// `limitedToDays`. "New record" in a workout is told against everything before it, whatever the plan:
// it says only whether the set beat the person's own past, and saying it against a part of that past
// would call a lift a record that is not one.
import type { Sql } from "postgres";
import {
  HISTORY_DAY_WORKOUTS_MOST,
  RECENT_WORKOUTS_MOST,
  type ExerciseRecords,
  type HistoryDay,
  type HistoryMonth,
  type HistoryRange,
  type HistorySet,
  type HistoryWorkout,
} from "@app/shared";
import { z } from "zod";
import type { RedisLike } from "../../redis.js";
import { historyGate } from "../workouts/service.js";
import * as repo from "./historyRepo.js";
import { exerciseRecords, namedWorkouts, newRecordsIn, recentBests, unitAndDone, type LiftedWorkout, type SetFact } from "./records.js";

export interface HistoryDeps {
  sql: Sql;
  redis: RedisLike;
}

export async function historyMonth(deps: HistoryDeps, userId: string, month: string): Promise<HistoryMonth> {
  const gate = await historyGate(deps, userId);
  const days = await repo.monthDays(deps.sql, userId, month, gate.timeZone, gate.floor);
  return { month, days: days.map((d) => ({ day: d.day, workouts: d.n })), limitedToDays: gate.limitedToDays };
}

/** The days from `from` to `to` the person worked out on (64a-v): the calendar's year, months and days by one rule. */
export async function historyRange(deps: HistoryDeps, userId: string, from: string, to: string): Promise<HistoryRange> {
  const gate = await historyGate(deps, userId);
  const days = await repo.rangeDays(deps.sql, userId, from, to, gate.timeZone, gate.floor);
  return { from, to, days: days.map((d) => ({ day: d.day, workouts: d.n })), limitedToDays: gate.limitedToDays };
}

export async function historyDay(deps: HistoryDeps, userId: string, day: string): Promise<HistoryDay> {
  const gate = await historyGate(deps, userId);
  const rows = await repo.dayWorkouts(deps.sql, userId, day, gate.timeZone, gate.floor, HISTORY_DAY_WORKOUTS_MOST);
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
      exerciseNames: r.exercise_names ?? [],
    })),
    total: rows[0]?.total ?? 0,
    limitedToDays: gate.limitedToDays,
  };
}

const fact = (r: repo.FactRow): SetFact => ({
  workoutId: r.workout_id,
  startedAt: r.started_at.toISOString(),
  exercise: r.slug,
  position: r.set_index,
  ...unitAndDone(r.measured_in, r.reps, r.hold_ms),
  weightGrams: r.weight_grams,
});

/** What each workout lifted, of the sets in reps: a group's unit is decided by the same rule as a set's. */
function lifted(rows: readonly repo.LiftedRow[]): LiftedWorkout[] {
  const sums = new Map<string, LiftedWorkout>();
  for (const r of rows) {
    if (unitAndDone(r.measured_in, 0, r.held ? 0 : null).measuredIn !== "reps") continue;
    const key = `${r.workout_id}|${r.slug}`;
    const sum = sums.get(key);
    if (sum === undefined) sums.set(key, { workoutId: r.workout_id, startedAt: r.started_at.toISOString(), exercise: r.slug, grams: r.grams });
    else sum.grams += r.grams;
  }
  return [...sums.values()];
}

/** The sets a record can be made of, and what each workout lifted, in one window. */
async function pastOf(sql: Sql, userId: string, exerciseIds: readonly string[], window: repo.Window): Promise<{ sets: SetFact[]; lifted: LiftedWorkout[] }> {
  if (exerciseIds.length === 0) return { sets: [], lifted: [] };
  const [sets, sums] = await Promise.all([repo.recordCandidates(sql, userId, exerciseIds, window), repo.liftedByWorkout(sql, userId, exerciseIds, window)]);
  return { sets: sets.map(fact), lifted: lifted(sums) };
}

/** How a set was counted. A set saved by the old route keeps only its mode: the engine's was the camera's,
 *  a typed one was by hand; one with neither is unknown. */
function countedOf(r: repo.SetRow): HistorySet["counted"] {
  if (r.counted === "camera" || r.counted === "hand" || r.counted === "timer") return r.counted;
  return r.mode === "engine" ? "camera" : r.mode === "log_only" ? "hand" : null;
}

/** A stored form score as History sends it: none for one outside 0 to 100, which nothing in the database bounds (the old
 *  import kept the old app's own number unclamped) and which the phone would refuse, leaving the workout unopened (round
 *  one, L2). */
const formScoreOf = (v: number | null): number | null => (v !== null && Number.isInteger(v) && v >= 0 && v <= 100 ? v : null);

// Parse, don't cast: the columns' CHECKs hold these, and this proves it on the way out.
const platformSchema = z.enum(["web", "android", "ios"]);
const startedFromSchema = z.enum(["saved", "app_plan", "gym_plan", "none"]).nullable();

/** One of the person's workouts set by set, with its new records; null for one that is not theirs. */
export async function historyWorkout(deps: HistoryDeps, userId: string, workoutId: string): Promise<HistoryWorkout | null> {
  const w = await repo.ownWorkout(deps.sql, userId, workoutId);
  if (w === null) return null;
  const sets = await repo.workoutSets(deps.sql, userId, workoutId);
  const exerciseIds = [...new Set(sets.map((s) => s.exercise_id))];
  const before = await pastOf(deps.sql, userId, exerciseIds, { before: { startedAt: w.started_at, workoutId: w.id }, floor: null });
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
    kcalWeightKg: w.kcal_weight_grams === null ? null : w.kcal_weight_grams / 1000,
    platform: platformSchema.parse(w.platform),
    formScore: formScoreOf(w.avg_form_score),
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
        // A set by hand or by timer never has one: the database refuses it (0249's checks).
        formScore: formScoreOf(s.avg_form_score),
      };
    }),
    newRecords: newRecordsIn(sets.map(fact), before.sets, before.lifted),
  };
}

/** The records of one exercise, with the person's latest workouts of it, or null for an id word the server
 *  never had. */
export async function recordsOf(deps: HistoryDeps, userId: string, exercise: string): Promise<ExerciseRecords | null> {
  const exerciseId = await repo.exerciseIdOf(deps.sql, exercise);
  if (exerciseId === null) return null;
  const gate = await historyGate(deps, userId);
  const [past, recent] = await Promise.all([
    pastOf(deps.sql, userId, [exerciseId], { before: null, floor: gate.floor }),
    repo.recentSets(deps.sql, userId, exerciseId, gate.floor, RECENT_WORKOUTS_MOST),
  ]);
  const records = exerciseRecords(past.sets, past.lifted);
  const latest = recentBests(recent.map(fact));
  const days = await repo.workoutDaysOf(deps.sql, userId, namedWorkouts(records, latest), gate.timeZone);
  return { exercise, ...records, recent: latest, days: Object.fromEntries(days.map((d) => [d.id, d.day])), limitedToDays: gate.limitedToDays };
}
