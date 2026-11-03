// PHONE NOTIFICATIONS FOR A PLACE (ROADMAP Stage 5 item 18b-ii-a): the only file that reads or clears
// what a class booking or an event place is owed (`push_due`, migration 0193). Classes and events
// write it as places change hands (`owePlaceFree`, `moveIn`); the worker sends it here.
import type { Sql, TransactionSql } from "postgres";
import type { PlaceNotice } from "@app/shared";

type SqlOrTx = Sql | TransactionSql;

export type PlaceWhat = "class" | "event";

export interface DuePlace {
  what: PlaceWhat;
  /** The booking's or the event place's own row. */
  rowId: string;
  gymId: string;
  userId: string;
  /** The class session or the event. */
  subjectId: string;
  due: PlaceNotice;
  /** When it became owed, to the microsecond, as text: the run pages on from it. */
  dueAt: string;
  gymName: string;
  gymZone: string;
  clockFormat: string;
  userZone: string | null;
  /** Owed for longer than a notice is told for: taken off with no send. */
  stale: boolean;
}

export interface DueMark {
  at: string;
  rowId: string;
}

/** One page of the places owed a notice, oldest first, after `after`: the run pages on past those left
 *  for the morning, so they never hold up the rest. */
export async function duePlaces(
  sql: SqlOrTx,
  input: { since: Date; limit: number; after: DueMark | null; gymIds?: readonly string[] | undefined },
): Promise<DuePlace[]> {
  const { since, limit, after, gymIds } = input;
  const gyms = gymIds === undefined ? null : [...gymIds];
  const rows = await sql<
    { what: PlaceWhat; row_id: string; gym_id: string; user_id: string; subject_id: string; due: PlaceNotice; due_at: string; gym_name: string; gym_zone: string; clock_format: string; user_zone: string | null; stale: boolean }[]
  >`
    SELECT x.what, x.row_id, x.gym_id, x.user_id, x.subject_id, x.due, x.due_at_raw::text AS due_at,
           g.name AS gym_name, g.timezone AS gym_zone, g.clock_format, u.timezone AS user_zone,
           x.due_at_raw < ${since} AS stale
    FROM (
      SELECT 'class'::text AS what, b.id AS row_id, b.gym_id, b.user_id, b.session_id AS subject_id, b.push_due AS due,
             b.push_due_at AS due_at_raw
      FROM gym_class_bookings b
      WHERE b.push_due IS NOT NULL AND (${gyms}::uuid[] IS NULL OR b.gym_id = ANY(${gyms}::uuid[]))
      UNION ALL
      SELECT 'event'::text, p.id, p.gym_id, p.user_id, p.event_id, p.push_due, p.push_due_at
      FROM gym_event_places p
      WHERE p.push_due IS NOT NULL AND (${gyms}::uuid[] IS NULL OR p.gym_id = ANY(${gyms}::uuid[]))
    ) x
    JOIN gyms g ON g.id = x.gym_id
    JOIN users u ON u.id = x.user_id
    ${after === null ? sql`` : sql`WHERE (x.due_at_raw, x.row_id) > (${after.at}::timestamptz, ${after.rowId}::uuid)`}
    ORDER BY x.due_at_raw, x.row_id
    LIMIT ${limit}`;
  return rows.map((r) => ({
    what: r.what,
    rowId: r.row_id,
    gymId: r.gym_id,
    userId: r.user_id,
    subjectId: r.subject_id,
    due: r.due,
    dueAt: r.due_at,
    gymName: r.gym_name,
    gymZone: r.gym_zone,
    clockFormat: r.clock_format,
    userZone: r.user_zone,
    stale: r.stale,
  }));
}

const table = (sql: SqlOrTx, what: PlaceWhat) => (what === "class" ? sql`gym_class_bookings` : sql`gym_event_places`);

/** Takes the notice off the row, once: a second run at the same instant, or a change since that owes
 *  something new, gets false back and sends nothing for this one. */
export async function claimDue(sql: SqlOrTx, place: Pick<DuePlace, "what" | "rowId" | "due" | "dueAt">): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE ${table(sql, place.what)} SET push_due = NULL
    WHERE id = ${place.rowId} AND push_due = ${place.due} AND push_due_at = ${place.dueAt}::timestamptz
    RETURNING id`;
  return rows.length === 1;
}

/** Puts back a notice this run took and Firebase did not take, so the next run tries again; never over
 *  something owed since. */
export async function unclaimDue(sql: SqlOrTx, place: Pick<DuePlace, "what" | "rowId" | "due" | "dueAt">): Promise<void> {
  await sql`
    UPDATE ${table(sql, place.what)} SET push_due = ${place.due}, push_due_at = ${place.dueAt}::timestamptz
    WHERE id = ${place.rowId} AND push_due IS NULL AND push_due_at = ${place.dueAt}::timestamptz`;
}
