// Saving a workout from the phone (spec Part 2 §13.5, job 61a): the only file of this module that
// touches the database. A workout is the person's own: it is read and written with its owner in the
// WHERE, and a set is written only by the request that made its workout.
import type { TransactionSql } from "postgres";

/** The posted workout id is somebody else's. Answered 404, as an id that does not exist is. */
export class ForeignWorkoutError extends Error {
  constructor() {
    super("workout does not belong to the authenticated user");
    this.name = "ForeignWorkoutError";
  }
}

/** Holds off a publish of the Library while this save runs, and waits for one that is running: a
 *  publish asks whether a saved set names an exercise before it removes it, so no set may land
 *  between its question and its answer (job 60b, `library/repo.ts` lockPublishing). */
export async function holdLibrary(tx: TransactionSql): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock_shared(hashtext('library:publish'))`;
}

/** Whose workout this id is: "mine", "theirs", or null for none yet. */
export async function workoutOwner(tx: TransactionSql, workoutId: string, userId: string): Promise<"mine" | "theirs" | null> {
  const rows = await tx<{ mine: boolean }[]>`SELECT user_id = ${userId} AS mine FROM workouts WHERE id = ${workoutId}`;
  const row = rows[0];
  return row === undefined ? null : row.mine ? "mine" : "theirs";
}

export interface KnownExercise {
  exerciseId: string;
  met: number;
}

/** The exercises the Library knows, of these id words: every one it has a row for, a removed one
 *  included. A phone that did a workout before the exercise's file was deleted still saves it, and the
 *  next publish finds the set and brings the exercise back as 'hidden' (`library/plan.ts`), so
 *  history names it. Only an id word the Library never had is unknown. */
export async function knownExercises(tx: TransactionSql, slugs: readonly string[]): Promise<Map<string, KnownExercise>> {
  const rows = await tx<{ slug: string; exercise_id: string; met: string }[]>`
    SELECT e.slug, l.exercise_id, l.met
    FROM library_exercises l JOIN exercises e ON e.id = l.exercise_id
    WHERE e.slug = ANY(${[...slugs]}::text[])`;
  return new Map(rows.map((r) => [r.slug, { exerciseId: r.exercise_id, met: Number(r.met) }]));
}

export interface WorkoutRow {
  id: string;
  userId: string;
  startedAt: string;
  endedAt: string;
  platform: string;
  appVersion: string;
  setsCount: number;
  totalReps: number;
  durationMs: number;
  kcalPoint: number;
  kcalCalcVersion: number;
  name: string | null;
  timeZone: string;
  startedFrom: string;
  effort: number | null;
  heartAvg: number | null;
  heartMax: number | null;
}

/** Inserts the workout unless its id is taken; true when this request made it. */
export async function insertWorkout(tx: TransactionSql, w: WorkoutRow): Promise<boolean> {
  // `engine_version` is the build of the app that sent it (the old route's own meaning, sync.ts).
  const inserted = await tx`
    INSERT INTO workouts (id, user_id, started_at, ended_at, platform, engine_version, bundle_version,
                          sets_count, total_reps, avg_form_score, duration_ms, quality_flags,
                          kcal_point, kcal_calc_version, name, time_zone, started_from, effort,
                          heart_avg, heart_max)
    VALUES (${w.id}, ${w.userId}, ${w.startedAt}, ${w.endedAt}, ${w.platform}, ${w.appVersion}, NULL,
            ${w.setsCount}, ${w.totalReps}, NULL, ${w.durationMs}, '{}',
            ${w.kcalPoint}, ${w.kcalCalcVersion}, ${w.name}, ${w.timeZone}, ${w.startedFrom}, ${w.effort},
            ${w.heartAvg}, ${w.heartMax})
    ON CONFLICT (id) DO NOTHING`;
  return inserted.count === 1;
}

export interface SetRow {
  exerciseId: string;
  position: number;
  measuredIn: "reps" | "time";
  target: number;
  done: number;
  weightGrams: number | null;
  restSeconds: number | null;
  durationMs: number;
  counted: "hand" | "timer";
}

/** Every set of a workout this request made, in one statement. A set counted by hand or by timer is
 *  marked 'log_only' for the old readers: nothing analysed it. Reps done go in `reps`, time done in
 *  `hold_ms`. */
export async function insertSets(tx: TransactionSql, workoutId: string, userId: string, startedAt: string, sets: readonly SetRow[]): Promise<void> {
  const values = sets.map((s) => ({
    exercise_id: s.exerciseId,
    set_index: s.position,
    reps: s.measuredIn === "reps" ? s.done : 0,
    hold_ms: s.measuredIn === "time" ? s.done * 1000 : null,
    duration_ms: s.durationMs,
    counted: s.counted,
    measured_in: s.measuredIn,
    target: s.target,
    weight_grams: s.weightGrams,
    rest_seconds: s.restSeconds,
  }));
  await tx`
    INSERT INTO workout_sets (workout_id, user_id, exercise_id, started_at, set_index, mode, reps, hold_ms,
                              duration_ms, counted, measured_in, target, weight_grams, rest_seconds)
    SELECT ${workoutId}, ${userId}, x.exercise_id, ${startedAt}, x.set_index, 'log_only', x.reps, x.hold_ms,
           x.duration_ms, x.counted, x.measured_in, x.target, x.weight_grams, x.rest_seconds
    FROM jsonb_to_recordset(${tx.json(values)}::jsonb)
      AS x(exercise_id uuid, set_index smallint, reps smallint, hold_ms integer, duration_ms integer,
           counted text, measured_in text, target integer, weight_grams integer, rest_seconds integer)`;
}
