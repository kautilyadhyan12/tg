// PHONE NOTIFICATIONS FOR A PLACE (ROADMAP Stage 5 item 18b-ii-a): the only file that reads or clears
// what a class booking or an event place is owed (`push_due`, migration 0194). Classes and events
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
  /** This person was told about this class or event within `PLACE_FREE_AGAIN_MINUTES`. */
  toldLately: boolean;
}

export interface DueMark {
  at: string;
  rowId: string;
}

/** One page of the places owed a notice, oldest first, after `after`: the run pages on past those left
 *  for the morning, so they never hold up the rest. */
export async function duePlaces(
  sql: SqlOrTx,
  input: { since: Date; toldSince: Date; claimedBefore: Date; limit: number; after: DueMark | null; gymIds?: readonly string[] | undefined },
): Promise<DuePlace[]> {
  const { since, toldSince, claimedBefore, limit, after, gymIds } = input;
  const gyms = gymIds === undefined ? null : [...gymIds];
  const rows = await sql<
    { what: PlaceWhat; row_id: string; gym_id: string; user_id: string; subject_id: string; due: PlaceNotice; due_at: string; gym_name: string; gym_zone: string; clock_format: string; user_zone: string | null; stale: boolean; told_lately: boolean }[]
  >`
    SELECT x.what, x.row_id, x.gym_id, x.user_id, x.subject_id, x.due, x.due_at_raw::text AS due_at,
           g.name AS gym_name, g.timezone AS gym_zone, g.clock_format, u.timezone AS user_zone,
           x.due_at_raw < ${since} AS stale, COALESCE(x.told_at > ${toldSince}, false) AS told_lately
    FROM (
      SELECT 'class'::text AS what, b.id AS row_id, b.gym_id, b.user_id, b.session_id AS subject_id, b.push_due AS due,
             b.push_due_at AS due_at_raw, b.push_told_at AS told_at
      FROM gym_class_bookings b
      WHERE b.push_due IS NOT NULL AND (b.push_claimed_at IS NULL OR b.push_claimed_at < ${claimedBefore})
        AND (${gyms}::uuid[] IS NULL OR b.gym_id = ANY(${gyms}::uuid[]))
      UNION ALL
      SELECT 'event'::text, p.id, p.gym_id, p.user_id, p.event_id, p.push_due, p.push_due_at, p.push_told_at
      FROM gym_event_places p
      WHERE p.push_due IS NOT NULL AND (p.push_claimed_at IS NULL OR p.push_claimed_at < ${claimedBefore})
        AND (${gyms}::uuid[] IS NULL OR p.gym_id = ANY(${gyms}::uuid[]))
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
    toldLately: r.told_lately,
  }));
}

const table = (sql: SqlOrTx, what: PlaceWhat) => (what === "class" ? sql`gym_class_bookings` : sql`gym_event_places`);

/** Takes the notice, once: a second run at the same instant, a change since that owes something new,
 *  or (for a free place) a person told about this class or event within the hour, gets false back and
 *  sends nothing for this one. The row stays owed until `settleDue`, so a run that stops halfway loses
 *  nothing: past `claimedBefore` the next run takes it again. */
export async function claimDue(
  sql: SqlOrTx,
  place: Pick<DuePlace, "what" | "rowId" | "gymId" | "due" | "dueAt">,
  input: { claimedAt: Date; claimedBefore: Date; toldSince: Date },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE ${table(sql, place.what)} SET push_claimed_at = ${input.claimedAt}
    WHERE gym_id = ${place.gymId} AND id = ${place.rowId} AND push_due = ${place.due} AND push_due_at = ${place.dueAt}::timestamptz
      AND (push_claimed_at IS NULL OR push_claimed_at < ${input.claimedBefore})
      AND (push_due <> 'free' OR push_told_at IS NULL OR push_told_at <= ${input.toldSince})
    RETURNING id`;
  return rows.length === 1;
}

/** What this run took is handled: the notice comes off the row unless something new is owed since, and
 *  `told` is when a phone had it. */
export async function settleDue(
  sql: SqlOrTx,
  place: Pick<DuePlace, "what" | "rowId" | "gymId" | "due" | "dueAt">,
  claimedAt: Date,
  told: Date | null,
): Promise<void> {
  const same = sql`push_due = ${place.due} AND push_due_at = ${place.dueAt}::timestamptz`;
  await sql`
    UPDATE ${table(sql, place.what)}
    SET push_due = CASE WHEN ${same} THEN NULL ELSE push_due END,
        push_told_at = COALESCE(${told}::timestamptz, push_told_at),
        push_claimed_at = NULL
    WHERE gym_id = ${place.gymId} AND id = ${place.rowId} AND push_claimed_at = ${claimedAt}`;
}

/** Puts back a notice this run took and Firebase did not take, so the next run tries again. */
export async function unclaimDue(sql: SqlOrTx, place: Pick<DuePlace, "what" | "rowId" | "gymId">, claimedAt: Date): Promise<void> {
  await sql`
    UPDATE ${table(sql, place.what)} SET push_claimed_at = NULL
    WHERE gym_id = ${place.gymId} AND id = ${place.rowId} AND push_claimed_at = ${claimedAt}`;
}
