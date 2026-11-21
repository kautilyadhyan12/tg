// A person's workout history and the sets its records are worked out from (spec Part 2 §13.5, job 61b).
// Reads only. Every row is fetched with its owner in the WHERE: a workout by its user_id, a set by its
// own user_id AND its workout's, so a set can never be read through somebody else's workout.
//
// A day is the day in the time zone the workout was done in, or in the person's own zone for a workout
// kept without one (`fallbackZone`). Zones run from 12 hours behind to 14 ahead, so a day or a month is
// first narrowed to its own dates with a day either side, which the index on (user_id, started_at)
// answers, and then matched exactly.
import type { Sql } from "postgres";

export interface ListedRow {
  id: string;
  name: string | null;
  started_at: Date;
  ended_at: Date | null;
  duration_ms: number | null;
  sets_count: number;
  kcal_point: number | null;
  exercises: string[] | null;
  total: number;
}

/** The days of a month the person worked out on, and how many workouts on each. `month` is "YYYY-MM". */
export async function monthDays(sql: Sql, userId: string, month: string, fallbackZone: string, floor: Date | null): Promise<{ day: string; n: number }[]> {
  const first = `${month}-01`;
  return sql<{ day: string; n: number }[]>`
    WITH w AS (
      SELECT (started_at AT TIME ZONE COALESCE(time_zone, ${fallbackZone}))::date AS day
      FROM workouts
      WHERE user_id = ${userId}
        AND started_at >= (${first}::date - 1)::timestamp AT TIME ZONE 'UTC'
        AND started_at < (${first}::date + interval '1 month 1 day') AT TIME ZONE 'UTC'
        AND (${floor === null} OR started_at >= ${floor}))
    SELECT to_char(day, 'YYYY-MM-DD') AS day, count(*)::int AS n
    FROM w WHERE date_trunc('month', day) = ${first}::date
    GROUP BY day ORDER BY day`;
}

/** A day's workouts in the order they started, the first `most`; each row carries how many there are. */
export async function dayWorkouts(sql: Sql, userId: string, day: string, fallbackZone: string, floor: Date | null, most: number): Promise<ListedRow[]> {
  return sql<ListedRow[]>`
    SELECT w.id, w.name, w.started_at, w.ended_at, w.duration_ms, w.sets_count, w.kcal_point,
           (SELECT array_agg(x.slug ORDER BY x.first_place)
              FROM (SELECT e.slug, min(s.set_index) AS first_place
                      FROM workout_sets s JOIN exercises e ON e.id = s.exercise_id
                     WHERE s.workout_id = w.id AND s.user_id = ${userId}
                     GROUP BY e.slug) x) AS exercises,
           count(*) OVER ()::int AS total
    FROM workouts w
    WHERE w.user_id = ${userId}
      AND w.started_at >= (${day}::date - 1)::timestamp AT TIME ZONE 'UTC'
      AND w.started_at < (${day}::date + 2)::timestamp AT TIME ZONE 'UTC'
      AND (w.started_at AT TIME ZONE COALESCE(w.time_zone, ${fallbackZone}))::date = ${day}::date
      AND (${floor === null} OR w.started_at >= ${floor})
    ORDER BY w.started_at, w.id
    LIMIT ${most}`;
}

export interface WorkoutRow {
  id: string;
  name: string | null;
  started_at: Date;
  ended_at: Date | null;
  time_zone: string | null;
  started_from: string | null;
  effort: number | null;
  heart_avg: number | null;
  heart_max: number | null;
  duration_ms: number | null;
  kcal_point: number | null;
  kcal_calc_version: number | null;
  platform: string;
  /** The camera's form score for the whole workout; null for one with no camera set. */
  avg_form_score: number | null;
}

/** The person's own workout, or null for one that is not theirs or does not exist. */
export async function ownWorkout(sql: Sql, userId: string, workoutId: string): Promise<WorkoutRow | null> {
  const rows = await sql<WorkoutRow[]>`
    SELECT id, name, started_at, ended_at, time_zone, started_from, effort, heart_avg, heart_max,
           duration_ms, kcal_point, kcal_calc_version, platform, avg_form_score
    FROM workouts WHERE id = ${workoutId} AND user_id = ${userId}`;
  return rows[0] ?? null;
}

export interface SetRow {
  workout_id: string;
  started_at: Date;
  exercise_id: string;
  slug: string;
  /** The Library's name; null for an exercise the Library never had. */
  name: string | null;
  set_index: number;
  measured_in: string | null;
  reps: number;
  hold_ms: number | null;
  target: number | null;
  weight_grams: number | null;
  rest_seconds: number | null;
  duration_ms: number;
  counted: string | null;
  mode: string | null;
}

const setColumns = (sql: Sql) => sql`
  s.workout_id, w.started_at, s.exercise_id, e.slug,
  l.entry->'text'->'en'->>'name' AS name,
  s.set_index, s.measured_in, s.reps, s.hold_ms, s.target, s.weight_grams, s.rest_seconds,
  s.duration_ms, s.counted, s.mode`;

/** One workout's sets, in their places. */
export async function workoutSets(sql: Sql, userId: string, workoutId: string): Promise<SetRow[]> {
  return sql<SetRow[]>`
    SELECT ${setColumns(sql)}
    FROM workout_sets s
      JOIN workouts w ON w.id = s.workout_id AND w.user_id = ${userId}
      JOIN exercises e ON e.id = s.exercise_id
      LEFT JOIN library_exercises l ON l.exercise_id = e.id
    WHERE s.workout_id = ${workoutId} AND s.user_id = ${userId}
    ORDER BY s.set_index`;
}

export interface Window {
  /** Only workouts that started before this one (by start, then id); null for no such bound. */
  before: { startedAt: Date; workoutId: string } | null;
  /** Only workouts from this instant on (a free plan's days); null for all. */
  floor: Date | null;
}

/** A set as the records read it. */
export interface FactRow {
  workout_id: string;
  started_at: Date;
  slug: string;
  set_index: number;
  measured_in: string | null;
  reps: number;
  hold_ms: number | null;
  weight_grams: number | null;
}

const inWindow = (sql: Sql, userId: string, exerciseIds: readonly string[], { before, floor }: Window) => sql`
  s.user_id = ${userId} AND s.exercise_id = ANY(${[...exerciseIds]}::uuid[])
  AND (${before === null} OR (w.started_at, w.id) < (${before?.startedAt ?? null}::timestamptz, ${before?.workoutId ?? null}::uuid))
  AND (${floor === null} OR w.started_at >= ${floor})`;

/** The sets of these exercises that can hold a record of a set: of each set that was done the same way
 *  (the same exercise, unit, reps, time and weight), only the first. Every record of a set is the first
 *  set with the best value, and a value is worked out from those columns alone, so the first of each is
 *  enough, whatever the record (`records.ts`). Five years of one exercise is then a few hundred rows,
 *  not thousands. */
export async function recordCandidates(sql: Sql, userId: string, exerciseIds: readonly string[], window: Window): Promise<FactRow[]> {
  return sql<FactRow[]>`
    SELECT DISTINCT ON (s.exercise_id, s.measured_in, s.reps, s.hold_ms, s.weight_grams)
           s.workout_id, w.started_at, e.slug, s.set_index, s.measured_in, s.reps, s.hold_ms, s.weight_grams
    FROM workout_sets s
      JOIN workouts w ON w.id = s.workout_id AND w.user_id = ${userId}
      JOIN exercises e ON e.id = s.exercise_id
    WHERE ${inWindow(sql, userId, exerciseIds, window)}
    ORDER BY s.exercise_id, s.measured_in, s.reps, s.hold_ms, s.weight_grams, w.started_at, w.id, s.set_index`;
}

/** What each workout lifted of each exercise: the weight times the reps of its sets with a weight and
 *  reps done, kept apart by how each set's unit is kept, so `records.ts` decides which are in reps. */
export interface LiftedRow {
  workout_id: string;
  started_at: Date;
  slug: string;
  measured_in: string | null;
  held: boolean;
  grams: number;
}

export async function liftedByWorkout(sql: Sql, userId: string, exerciseIds: readonly string[], window: Window): Promise<LiftedRow[]> {
  return sql<LiftedRow[]>`
    SELECT s.workout_id, w.started_at, e.slug, s.measured_in, s.hold_ms IS NOT NULL AS held,
           sum(s.weight_grams::bigint * s.reps)::float8 AS grams
    FROM workout_sets s
      JOIN workouts w ON w.id = s.workout_id AND w.user_id = ${userId}
      JOIN exercises e ON e.id = s.exercise_id
    WHERE ${inWindow(sql, userId, exerciseIds, window)} AND s.weight_grams IS NOT NULL AND s.reps > 0
    GROUP BY s.workout_id, w.started_at, w.id, e.slug, s.measured_in, s.hold_ms IS NOT NULL`;
}

/** Every set of one exercise in the person's latest `most` workouts of it in which a set of it was done
 *  (reps in a set kept in reps; a whole second in a set kept in time, as `records.ts` reads a set's unit). */
export async function recentSets(sql: Sql, userId: string, exerciseId: string, floor: Date | null, most: number): Promise<FactRow[]> {
  return sql<FactRow[]>`
    WITH latest AS (
      SELECT w.id, w.started_at
      FROM workouts w
      WHERE w.user_id = ${userId}
        AND (${floor === null} OR w.started_at >= ${floor})
        AND EXISTS (
          SELECT 1 FROM workout_sets s
          WHERE s.workout_id = w.id AND s.user_id = ${userId} AND s.exercise_id = ${exerciseId}
            AND CASE COALESCE(s.measured_in, CASE WHEN s.hold_ms IS NOT NULL THEN 'time' ELSE 'reps' END)
                  WHEN 'time' THEN COALESCE(s.hold_ms, 0) >= 1000 ELSE s.reps > 0 END)
      ORDER BY w.started_at DESC, w.id DESC
      LIMIT ${most})
    SELECT s.workout_id, l.started_at, e.slug, s.set_index, s.measured_in, s.reps, s.hold_ms, s.weight_grams
    FROM latest l
      JOIN workout_sets s ON s.workout_id = l.id AND s.user_id = ${userId} AND s.exercise_id = ${exerciseId}
      JOIN exercises e ON e.id = s.exercise_id`;
}

/** The day of each of the person's own workouts asked for, in the zone it was done in, or `fallbackZone`. */
export async function workoutDaysOf(sql: Sql, userId: string, workoutIds: readonly string[], fallbackZone: string): Promise<{ id: string; day: string }[]> {
  if (workoutIds.length === 0) return [];
  return sql<{ id: string; day: string }[]>`
    SELECT id, to_char((started_at AT TIME ZONE COALESCE(time_zone, ${fallbackZone}))::date, 'YYYY-MM-DD') AS day
    FROM workouts WHERE user_id = ${userId} AND id = ANY(${[...workoutIds]}::uuid[])`;
}

/** The exercise's own id, or null for an id word the server never had. */
export async function exerciseIdOf(sql: Sql, slug: string): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`SELECT id FROM exercises WHERE slug = ${slug}`;
  return rows[0]?.id ?? null;
}
