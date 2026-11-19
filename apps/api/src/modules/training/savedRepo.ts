// A person's saved workouts (spec Part 2 §13.5, job 61c): the only file of them that touches the
// database. A saved workout is the person's own: it is read, changed and deleted with its owner in the
// WHERE, and its sets are written and read only through a saved workout of that owner.
import type { Sql, TransactionSql } from "postgres";

/** One person's saved workouts are changed one request at a time, so two new ones sent at the same
 *  instant cannot both pass the limit. The two-number key is a space of its own, apart from the
 *  Library's one-number lock. */
export async function lockPerson(tx: TransactionSql, userId: string): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(hashtext('saved_workouts'), hashtext(${userId}))`;
}

export type SavedState =
  | { kind: "none" }
  | { kind: "theirs" }
  | { kind: "removed" }
  /** `sameOrNewer`: the server holds this change already, or a newer one. */
  | { kind: "mine"; sameOrNewer: boolean };

/** Whose saved workout this id is, and whether the change sent is older than the one kept. A row of the
 *  person's own is locked until the transaction ends. */
export async function savedState(tx: TransactionSql, id: string, userId: string, editedAt: string): Promise<SavedState> {
  const rows = await tx<{ mine: boolean; same_or_newer: boolean }[]>`
    SELECT user_id = ${userId} AS mine, edited_at >= ${editedAt}::timestamptz AS same_or_newer
    FROM saved_workouts WHERE id = ${id} FOR UPDATE`;
  const row = rows[0];
  if (row !== undefined) return row.mine ? { kind: "mine", sameOrNewer: row.same_or_newer } : { kind: "theirs" };
  const removed = await tx<{ mine: boolean }[]>`SELECT user_id = ${userId} AS mine FROM saved_workout_removed_ids WHERE id = ${id}`;
  const r = removed[0];
  return r === undefined ? { kind: "none" } : r.mine ? { kind: "removed" } : { kind: "theirs" };
}

export async function countOf(tx: TransactionSql, userId: string): Promise<number> {
  const rows = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM saved_workouts WHERE user_id = ${userId}`;
  return rows[0]?.n ?? 0;
}

/** Makes the saved workout unless its id is taken; true when this request made it. */
export async function insertSaved(tx: TransactionSql, id: string, userId: string, name: string, editedAt: string): Promise<boolean> {
  const made = await tx`
    INSERT INTO saved_workouts (id, user_id, name, edited_at) VALUES (${id}, ${userId}, ${name}, ${editedAt})
    ON CONFLICT (id) DO NOTHING`;
  return made.count === 1;
}

/** Saves a change to the person's own saved workout; true when it was theirs. */
export async function updateSaved(tx: TransactionSql, id: string, userId: string, name: string, editedAt: string): Promise<boolean> {
  const changed = await tx`
    UPDATE saved_workouts SET name = ${name}, edited_at = ${editedAt}, updated_at = now()
    WHERE id = ${id} AND user_id = ${userId}`;
  return changed.count === 1;
}

export interface SavedSetRow {
  exercisePlace: number;
  setPlace: number;
  exerciseId: string;
  measuredIn: "reps" | "time";
  target: number;
  weightGrams: number | null;
  restSeconds: number | null;
}

/** Puts these sets in place of the saved workout's own, in two statements. Both reach only a saved
 *  workout of this person: somebody else's id changes nothing. */
export async function replaceSets(tx: TransactionSql, id: string, userId: string, sets: readonly SavedSetRow[]): Promise<void> {
  await tx`
    DELETE FROM saved_workout_sets s USING saved_workouts w
    WHERE s.saved_workout_id = ${id} AND w.id = s.saved_workout_id AND w.user_id = ${userId}`;
  const values = sets.map((s) => ({
    exercise_place: s.exercisePlace,
    set_place: s.setPlace,
    exercise_id: s.exerciseId,
    measured_in: s.measuredIn,
    target: s.target,
    weight_grams: s.weightGrams,
    rest_seconds: s.restSeconds,
  }));
  await tx`
    INSERT INTO saved_workout_sets (saved_workout_id, exercise_place, set_place, exercise_id, measured_in, target,
                                    weight_grams, rest_seconds)
    SELECT w.id, x.exercise_place, x.set_place, x.exercise_id, x.measured_in, x.target, x.weight_grams, x.rest_seconds
    FROM saved_workouts w,
         jsonb_to_recordset(${tx.json(values)}::jsonb)
           AS x(exercise_place smallint, set_place smallint, exercise_id uuid, measured_in text, target integer,
                weight_grams integer, rest_seconds integer)
    WHERE w.id = ${id} AND w.user_id = ${userId}`;
}

/** Deletes the person's saved workout and keeps its id for them, so a save of it still on its way keeps
 *  nothing. An id that is no saved workout yet is kept too: a save the phone gave up on may arrive after
 *  the delete. False only for an id that is somebody else's. */
export async function removeSaved(tx: TransactionSql, id: string, userId: string): Promise<boolean> {
  const theirs = await tx`
    SELECT 1 FROM saved_workouts WHERE id = ${id} AND user_id <> ${userId}
    UNION ALL SELECT 1 FROM saved_workout_removed_ids WHERE id = ${id} AND user_id <> ${userId}`;
  if (theirs.length > 0) return false;
  await tx`DELETE FROM saved_workouts WHERE id = ${id} AND user_id = ${userId}`;
  const kept = await tx`
    INSERT INTO saved_workout_removed_ids (id, user_id) VALUES (${id}, ${userId})
    ON CONFLICT (id) DO NOTHING RETURNING id`;
  // Another person's save or delete of this id landed in between: nothing of theirs was touched.
  if (kept.length === 0) {
    const mine = await tx`SELECT 1 FROM saved_workout_removed_ids WHERE id = ${id} AND user_id = ${userId}`;
    return mine.length > 0;
  }
  return true;
}

export interface ListedRow {
  id: string;
  name: string;
  edited_at: Date;
  sets_count: number;
  exercises: string[] | null;
}

/** The person's saved workouts, the most recently changed first, each with its exercises' id words in the
 *  order they first come, and its number of sets. */
export async function listOf(sql: Sql, userId: string): Promise<ListedRow[]> {
  return await sql<ListedRow[]>`
    SELECT w.id, w.name, w.edited_at,
           (SELECT count(*)::int FROM saved_workout_sets s WHERE s.saved_workout_id = w.id) AS sets_count,
           (SELECT array_agg(q.slug ORDER BY q.first_place)
            FROM (SELECT e.slug, min(s.exercise_place) AS first_place
                  FROM saved_workout_sets s JOIN exercises e ON e.id = s.exercise_id
                  WHERE s.saved_workout_id = w.id
                  GROUP BY e.slug) q) AS exercises
    FROM saved_workouts w
    WHERE w.user_id = ${userId}
    ORDER BY w.edited_at DESC, w.id`;
}

export interface OneRow {
  id: string;
  name: string;
  edited_at: Date;
}

export interface OneSetRow {
  exercise_place: number;
  set_place: number;
  slug: string;
  measured_in: string;
  target: number;
  weight_grams: number | null;
  rest_seconds: number | null;
}

/** The person's own saved workout and its sets in order; null for one that is not theirs or not there. */
export async function oneOf(sql: Sql, userId: string, id: string): Promise<{ row: OneRow; sets: OneSetRow[] } | null> {
  const rows = await sql<OneRow[]>`SELECT id, name, edited_at FROM saved_workouts WHERE id = ${id} AND user_id = ${userId}`;
  const row = rows[0];
  if (row === undefined) return null;
  const sets = await sql<OneSetRow[]>`
    SELECT s.exercise_place, s.set_place, e.slug, s.measured_in, s.target, s.weight_grams, s.rest_seconds
    FROM saved_workout_sets s
    JOIN saved_workouts w ON w.id = s.saved_workout_id AND w.user_id = ${userId}
    JOIN exercises e ON e.id = s.exercise_id
    WHERE s.saved_workout_id = ${id}
    ORDER BY s.exercise_place, s.set_place`;
  return { row, sets };
}
