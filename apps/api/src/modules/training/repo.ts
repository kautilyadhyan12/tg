// Saving a workout from the phone (spec Part 2 §13.5, job 61a): the only file of this module that
// touches the database. A workout is the person's own: it is read and written with its owner in the
// WHERE, and a set is written only by the request that made its workout.
import type { Sql, TransactionSql } from "postgres";
import { setFormScore, type CameraSetFacts, type SetCounted } from "@app/shared";

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
  /** Null for a zone the server cannot use (`namedTimeZone`). */
  timeZone: string | null;
  startedFrom: string;
  effort: number | null;
  heartAvg: number | null;
  heartMax: number | null;
  /** The body weight `kcalPoint` was worked out at, in grams; null where the person had given none. */
  kcalWeightGrams: number | null;
  /** The mean of its camera sets' form scores (job 64b-i); null with none, as the old route's, which XP reads. */
  avgFormScore: number | null;
}

/** Inserts the workout unless its id is taken; true when this request made it. */
export async function insertWorkout(tx: TransactionSql, w: WorkoutRow): Promise<boolean> {
  // `engine_version` is the build of the app that sent it (the old route's own meaning, sync.ts).
  const inserted = await tx`
    INSERT INTO workouts (id, user_id, started_at, ended_at, platform, engine_version, bundle_version,
                          sets_count, total_reps, avg_form_score, duration_ms, quality_flags,
                          kcal_point, kcal_calc_version, name, time_zone, started_from, effort,
                          heart_avg, heart_max, kcal_weight_grams)
    VALUES (${w.id}, ${w.userId}, ${w.startedAt}, ${w.endedAt}, ${w.platform}, ${w.appVersion}, NULL,
            ${w.setsCount}, ${w.totalReps}, ${w.avgFormScore}, ${w.durationMs}, '{}',
            ${w.kcalPoint}, ${w.kcalCalcVersion}, ${w.name}, ${w.timeZone}, ${w.startedFrom}, ${w.effort},
            ${w.heartAvg}, ${w.heartMax}, ${w.kcalWeightGrams})
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
  counted: SetCounted;
  /** What the camera made of it, on a set counted by the camera alone. */
  camera?: CameraSetFacts | undefined;
}

/** A set's columns as they are written: by hand or by timer 'log_only' with nothing of a camera, by the camera 'engine'
 *  with the camera's facts. Its form score is the server's own, from the reps' scores (`setFormScore`); the time the
 *  camera watched is kept no longer than the set lasted, as the old route keeps it. */
export function setColumns(s: SetRow): Record<string, string | number | number[] | Record<string, number> | null> {
  const own = {
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
  };
  const camera = s.counted === "camera" ? s.camera : undefined;
  if (camera === undefined) {
    return { ...own, mode: "log_only", camera_done: null, left_camera: null, engine_version: null, definition_version: null, view: null, watched_ms: null, avg_form_score: null, rep_scores: null, fault_counts: {}, tempo_ms_avg: null, rom_stats: null };
  }
  const f = camera.summary;
  return {
    ...own,
    mode: "engine",
    camera_done: camera.done,
    left_camera: camera.left,
    engine_version: camera.engineVersion,
    definition_version: f?.definitionVersion ?? null,
    view: f?.view ?? null,
    watched_ms: f === null ? null : Math.min(f.watchedMs, s.durationMs),
    avg_form_score: f === null ? null : setFormScore(f.repScores),
    rep_scores: f?.repScores ?? null,
    fault_counts: f?.faultCounts ?? {},
    tempo_ms_avg: f?.tempoMsAvg ?? null,
    rom_stats: f?.romStats ?? null,
  };
}

/** Every set of a workout this request made, in one statement. Reps done go in `reps`, time done in `hold_ms`. */
export async function insertSets(tx: TransactionSql, workoutId: string, userId: string, startedAt: string, sets: readonly SetRow[]): Promise<void> {
  await tx`
    INSERT INTO workout_sets (workout_id, user_id, exercise_id, started_at, set_index, mode, reps, hold_ms,
                              duration_ms, counted, measured_in, target, weight_grams, rest_seconds,
                              camera_done, left_camera, engine_version, definition_version, view, watched_ms,
                              avg_form_score, rep_scores, fault_counts, tempo_ms_avg, rom_stats)
    SELECT ${workoutId}, ${userId}, x.exercise_id, ${startedAt}, x.set_index, x.mode, x.reps, x.hold_ms,
           x.duration_ms, x.counted, x.measured_in, x.target, x.weight_grams, x.rest_seconds,
           x.camera_done, x.left_camera, x.engine_version, x.definition_version, x.view, x.watched_ms,
           x.avg_form_score, x.rep_scores, x.fault_counts, x.tempo_ms_avg, x.rom_stats
    FROM jsonb_to_recordset(${tx.json(sets.map(setColumns))}::jsonb)
      AS x(exercise_id uuid, set_index smallint, mode text, reps smallint, hold_ms integer, duration_ms integer,
           counted text, measured_in text, target integer, weight_grams integer, rest_seconds integer,
           camera_done integer, left_camera text, engine_version text, definition_version integer, view text,
           watched_ms integer, avg_form_score smallint, rep_scores smallint[], fault_counts jsonb, tempo_ms_avg integer,
           rom_stats jsonb)`;
}

/** The effort stars of the person's own workout (job 64a-iii), given after it was saved; false where the workout
 *  is not theirs or does not exist. Sent twice it is the same. */
export async function setEffort(sql: Sql, userId: string, workoutId: string, effort: number): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE workouts SET effort = ${effort} WHERE id = ${workoutId} AND user_id = ${userId} RETURNING id`;
  return rows.length > 0;
}
