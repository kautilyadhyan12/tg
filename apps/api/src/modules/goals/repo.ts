// The only file that touches `user_goals`, with the reads over a person's own workouts,
// meals and visits that measure a goal. Every query is keyed by the person's id.
import type { Sql, TransactionSql } from "postgres";
import type { MealDay, WorkoutDay } from "./measure.js";

type SqlOrTx = Sql | TransactionSql;

export interface GoalRow {
  id: string;
  kind: string;
  period: string | null;
  target: number | null;
  exerciseId: string | null;
  exerciseSlug: string | null;
  setBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface GoalDbRow {
  id: string;
  kind: string;
  period: string | null;
  target: number | null;
  exercise_id: string | null;
  exercise_slug: string | null;
  set_by: string;
  created_at: Date;
  updated_at: Date;
}

export async function listGoals(sql: SqlOrTx, userId: string): Promise<GoalRow[]> {
  const rows = await sql<GoalDbRow[]>`
    SELECT g.id, g.kind, g.period, g.target, g.exercise_id, e.slug AS exercise_slug, g.set_by,
           g.created_at, g.updated_at
    FROM user_goals g LEFT JOIN exercises e ON e.id = g.exercise_id
    WHERE g.user_id = ${userId}
    ORDER BY g.created_at ASC, g.id ASC`;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    period: r.period,
    target: r.target,
    exerciseId: r.exercise_id,
    exerciseSlug: r.exercise_slug,
    setBy: r.set_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** One person's goal writes run one at a time, so two requests cannot both pass the count. */
export async function lockGoalsOf(tx: TransactionSql, userId: string): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`goals:${userId}`}))`;
}

export async function countGoals(tx: TransactionSql, userId: string): Promise<number> {
  const [r] = await tx<{ n: string }[]>`SELECT count(*) AS n FROM user_goals WHERE user_id = ${userId}`;
  return Number(r?.n ?? 0);
}

/** Whoever holds this id, if anybody: the id is the phone's own, so it may be a stranger's. */
export async function goalHolder(
  tx: TransactionSql,
  id: string,
): Promise<{ userId: string; kind: string; exerciseId: string | null } | null> {
  const [r] = await tx<{ user_id: string; kind: string; exercise_id: string | null }[]>`
    SELECT user_id, kind, exercise_id FROM user_goals WHERE id = ${id} FOR UPDATE`;
  return r === undefined ? null : { userId: r.user_id, kind: r.kind, exerciseId: r.exercise_id };
}

export interface GoalWrite {
  kind: string;
  period: string | null;
  target: number | null;
  exerciseId: string | null;
}

export async function insertGoal(tx: TransactionSql, userId: string, id: string, v: GoalWrite): Promise<void> {
  await tx`
    INSERT INTO user_goals (id, user_id, kind, period, target, exercise_id, set_by)
    VALUES (${id}, ${userId}, ${v.kind}, ${v.period}, ${v.target}, ${v.exerciseId}, 'user')`;
}

/** A goal the person changes is theirs from then on, whoever set it first. */
export async function updateGoal(tx: TransactionSql, userId: string, id: string, v: GoalWrite): Promise<void> {
  await tx`
    UPDATE user_goals SET period = ${v.period}, target = ${v.target}, set_by = 'user', updated_at = now()
    WHERE id = ${id} AND user_id = ${userId}`;
}

export async function deleteGoal(sql: Sql, userId: string, id: string): Promise<boolean> {
  const rows = await sql`DELETE FROM user_goals WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
  return rows.length > 0;
}

/** The id clashed with a row another request wrote in the same instant. */
export function isGoalIdClash(err: unknown): boolean {
  return isUnique(err, "user_goals_pkey");
}

/** The person already has a goal of this kind, period and exercise. */
export function isGoalTwice(err: unknown): boolean {
  return isUnique(err, "user_goals_one_of_each_uq");
}

function isUnique(err: unknown, constraint: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "23505" &&
    "constraint_name" in err &&
    err.constraint_name === constraint
  );
}

export async function liveExerciseExists(sql: SqlOrTx, exerciseId: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM exercises WHERE id = ${exerciseId} AND status = 'live'`;
  return rows.length > 0;
}

/** Workout totals by the person's own day, from `from` to `to`. The instant bounds are a
 *  day wider than the days asked for, so the index serves any time zone. */
export async function workoutDays(
  sql: SqlOrTx,
  userId: string,
  timeZone: string,
  from: string,
  to: string,
): Promise<WorkoutDay[]> {
  const rows = await sql<{ day: string; kcal: string; ms: string }[]>`
    SELECT d::text AS day, coalesce(sum(kcal_point), 0) AS kcal, coalesce(sum(duration_ms), 0) AS ms
    FROM (
      SELECT (started_at AT TIME ZONE ${timeZone})::date AS d, kcal_point, duration_ms
      FROM workouts
      WHERE user_id = ${userId}
        AND started_at >= (${from}::date - 1)::timestamp AT TIME ZONE 'UTC'
        AND started_at < (${to}::date + 2)::timestamp AT TIME ZONE 'UTC'
    ) w
    WHERE d BETWEEN ${from}::date AND ${to}::date
    GROUP BY d ORDER BY d`;
  return rows.map((r) => ({ day: r.day, kcal: Number(r.kcal), ms: Number(r.ms) }));
}

export async function mealDays(
  sql: SqlOrTx,
  userId: string,
  timeZone: string,
  from: string,
  to: string,
): Promise<MealDay[]> {
  const rows = await sql<{ day: string; kcal: string; protein_g: string }[]>`
    SELECT d::text AS day, coalesce(sum(kcal_point), 0) AS kcal, coalesce(sum(protein_g), 0) AS protein_g
    FROM (
      SELECT (taken_at AT TIME ZONE ${timeZone})::date AS d, kcal_point, protein_g
      FROM meal_logs
      WHERE user_id = ${userId}
        AND taken_at >= (${from}::date - 1)::timestamp AT TIME ZONE 'UTC'
        AND taken_at < (${to}::date + 2)::timestamp AT TIME ZONE 'UTC'
    ) m
    WHERE d BETWEEN ${from}::date AND ${to}::date
    GROUP BY d ORDER BY d`;
  return rows.map((r) => ({ day: r.day, kcal: Number(r.kcal), proteinG: Number(r.protein_g) }));
}

/** The days the person came to a gym. A visit's day is the one the gym and the member saw
 *  when it was made, kept as stored (as the streak reads it). */
export async function visitDays(sql: SqlOrTx, userId: string, from: string, to: string): Promise<string[]> {
  const rows = await sql<{ day: string }[]>`
    SELECT DISTINCT day::text AS day FROM gym_attendance
    WHERE user_id = ${userId} AND day BETWEEN ${from}::date AND ${to}::date
    ORDER BY day`;
  return rows.map((r) => r.day);
}

/** The most reps in one set for each exercise asked for. Owned through the workout, as
 *  the export reads sets. */
export async function bestReps(sql: SqlOrTx, userId: string, exerciseIds: readonly string[]): Promise<Map<string, number>> {
  const rows = await sql<{ exercise_id: string; reps: number }[]>`
    SELECT s.exercise_id, max(s.reps)::int AS reps
    FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
    WHERE w.user_id = ${userId} AND s.exercise_id = ANY(${[...exerciseIds]}::uuid[])
    GROUP BY s.exercise_id`;
  return new Map(rows.map((r) => [r.exercise_id, r.reps]));
}
