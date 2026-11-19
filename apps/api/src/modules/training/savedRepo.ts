// A person's saved workouts (spec Part 2 §13.5, job 61c): the only file of them that touches the
// database. A saved workout is the person's own: it is read, changed and deleted with its owner in the
// WHERE, and its sets are written and read only through a saved workout of that owner.
import type { Sql, TransactionSql } from "postgres";

/** How many ids of deleted saved workouts are kept for one person; past it the oldest go. A delete is
 *  answered for an id the server never held too (a save of it may be on its way), so without a bound one
 *  account could add rows for ever. */
export const REMOVED_IDS_KEPT_MOST = 1000;

/** One saved workout id is saved or deleted by one request at a time, whoever sends it, so a save and
 *  somebody else's delete of one id can never both pass their check (as `lockRunId` for a run). Taken
 *  before the person's own lock, by every request, so the two are always taken in one order. */
export async function lockId(tx: TransactionSql, id: string): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`saved_workout:${id}`}))`;
}

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
  /** `sameOrNewer`: the server holds this change already, or a newer one, made at `editedAt`. */
  | { kind: "mine"; sameOrNewer: boolean; editedAt: Date };

/** Whose saved workout this id is, and whether the change sent is older than the one kept. A row of the
 *  person's own is locked until the transaction ends. */
export async function savedState(tx: TransactionSql, id: string, userId: string, editedAt: string): Promise<SavedState> {
  const rows = await tx<{ mine: boolean; same_or_newer: boolean; edited_at: Date }[]>`
    SELECT user_id = ${userId} AS mine, edited_at >= ${editedAt}::timestamptz AS same_or_newer, edited_at
    FROM saved_workouts WHERE id = ${id} FOR UPDATE`;
  const row = rows[0];
  if (row !== undefined) return row.mine ? { kind: "mine", sameOrNewer: row.same_or_newer, editedAt: row.edited_at } : { kind: "theirs" };
  const removed = await tx<{ mine: boolean }[]>`SELECT user_id = ${userId} AS mine FROM saved_workout_removed_ids WHERE id = ${id}`;
  const r = removed[0];
  return r === undefined ? { kind: "none" } : r.mine ? { kind: "removed" } : { kind: "theirs" };
}

export async function countOf(tx: TransactionSql, userId: string): Promise<number> {
  const rows = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM saved_workouts WHERE user_id = ${userId}`;
  return rows[0]?.n ?? 0;
}

/** Makes the saved workout unless its id is taken: its change's time as kept, or null when this request
 *  did not make it. */
export async function insertSaved(tx: TransactionSql, id: string, userId: string, name: string, editedAt: string): Promise<Date | null> {
  const made = await tx<{ edited_at: Date }[]>`
    INSERT INTO saved_workouts (id, user_id, name, edited_at) VALUES (${id}, ${userId}, ${name}, ${editedAt})
    ON CONFLICT (id) DO NOTHING RETURNING edited_at`;
  return made[0]?.edited_at ?? null;
}

/** Saves a change to the person's own saved workout: its change's time as kept, or null when it was not theirs. */
export async function updateSaved(tx: TransactionSql, id: string, userId: string, name: string, editedAt: string): Promise<Date | null> {
  const changed = await tx<{ edited_at: Date }[]>`
    UPDATE saved_workouts SET name = ${name}, edited_at = ${editedAt}, updated_at = now()
    WHERE id = ${id} AND user_id = ${userId} RETURNING edited_at`;
  return changed[0]?.edited_at ?? null;
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
 *  the delete. The person's newest `REMOVED_IDS_KEPT_MOST` are kept. False only for an id that is somebody
 *  else's. Run under `lockId` and the person's lock. */
export async function removeSaved(tx: TransactionSql, id: string, userId: string): Promise<boolean> {
  const theirs = await tx`
    SELECT 1 FROM saved_workouts WHERE id = ${id} AND user_id <> ${userId}
    UNION ALL SELECT 1 FROM saved_workout_removed_ids WHERE id = ${id} AND user_id <> ${userId}`;
  if (theirs.length > 0) return false;
  await tx`DELETE FROM saved_workouts WHERE id = ${id} AND user_id = ${userId}`;
  const kept = await tx`
    INSERT INTO saved_workout_removed_ids (id, user_id) VALUES (${id}, ${userId})
    ON CONFLICT (id) DO NOTHING RETURNING id`;
  // Already kept: the same person's delete sent twice (`lockId` holds off anybody else's).
  if (kept.length === 0) return true;
  await tx`
    DELETE FROM saved_workout_removed_ids WHERE id IN (
      SELECT id FROM saved_workout_removed_ids WHERE user_id = ${userId}
      ORDER BY removed_at DESC, id OFFSET ${REMOVED_IDS_KEPT_MOST})`;
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
