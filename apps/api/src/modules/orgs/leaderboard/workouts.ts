// WHICH WORKOUTS COUNT (spec Part 3 §15.5, Workout days). One rule, read by the board and
// by the person's own "what counted", so a number always equals its list.
import type { Sql, TransactionSql } from "postgres";
import { LEADERBOARD_WORKOUT_EARLY_MINUTES, LEADERBOARD_WORKOUT_SAVE_DAYS } from "@app/shared";

type SqlOrTx = Sql | TransactionSql;

export interface WorkoutRange {
  gymId: string;
  /** The instant of the read. */
  at: string;
  /** The period in the gym's calendar; `from` null for all time. */
  from: string | null;
  to: string;
}

/** Every app workout of the gym's live members whose gym day is in the period:
 *  (id, owner_id, started_at, created_at, day, why). `day` is the gym's own calendar day
 *  of its start. `why` is null for a workout that counts: one that has started, within
 *  the person's current membership, with a set holding a rep or a hold, and reached the
 *  server no earlier than an hour before its start (a phone's fast clock) and within seven
 *  days after it; else the first reason it does not. The sync route takes any start time,
 *  so a workout saved before it happened never counts, whenever it is read. A home workout
 *  counts at each of the person's gyms. */
export function memberWorkouts(sql: SqlOrTx, input: WorkoutRange) {
  // Whole hours: `+ interval '7 days'` on a timestamptz follows the session's clock changes.
  const saveHours = LEADERBOARD_WORKOUT_SAVE_DAYS * 24;
  return sql`
    SELECT w.id, m.user_id AS owner_id, w.started_at, w.created_at,
           (w.started_at AT TIME ZONE g.timezone)::date AS day,
           CASE WHEN w.created_at < w.started_at - make_interval(mins => ${LEADERBOARD_WORKOUT_EARLY_MINUTES}::int) THEN 'saved_early'
                WHEN w.started_at > ${input.at}::timestamptz THEN 'future'
                WHEN w.started_at < m.joined_at THEN 'before_joining'
                WHEN w.sets_count < 1 THEN 'no_sets'
                WHEN w.total_reps < 1 AND NOT EXISTS (
                  SELECT 1 FROM workout_sets hs WHERE hs.workout_id = w.id AND hs.hold_ms > 0
                ) THEN 'no_sets'
                WHEN w.created_at > w.started_at + make_interval(hours => ${saveHours}::int) THEN 'saved_late'
           END AS why
    FROM gym_members m
    JOIN gyms g ON g.id = m.gym_id
    JOIN workouts w ON w.user_id = m.user_id
      -- For the index only, a day wider than any zone's offset: the dates below decide.
      AND w.started_at < (${input.to}::date + 2)::timestamp AT TIME ZONE 'UTC'
      AND (${input.from}::date IS NULL OR w.started_at >= (${input.from}::date - 1)::timestamp AT TIME ZONE 'UTC')
    WHERE m.gym_id = ${input.gymId} AND m.removed_at IS NULL
      AND (w.started_at AT TIME ZONE g.timezone)::date <= ${input.to}::date
      AND (${input.from}::date IS NULL OR (w.started_at AT TIME ZONE g.timezone)::date >= ${input.from}::date)`;
}

/** Each person's workout days in the period: (owner_id, day), one row a day. */
export function countedWorkoutDays(sql: SqlOrTx, input: WorkoutRange) {
  return sql`SELECT DISTINCT x.owner_id, x.day FROM (${memberWorkouts(sql, input)}) x WHERE x.why IS NULL`;
}
