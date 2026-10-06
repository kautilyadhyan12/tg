// WHO IS COMING TO AN EVENT, in the database (spec Part 3 §15.4; ROADMAP 19c-ii). The only
// file that reads or writes `gym_event_places`.
//
// Every statement names the gym. A write runs under the gym's row lock and then the
// event's own row: the places are counted inside that, so two requests cannot both take
// the last one, and nobody leaves the gym while a place is given to them.
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import { eventBookingSettings, gymEventPlaceStatusSchema, type ClassBookingSettings, type GymEventPlaceStatus } from "@app/shared";

type SqlOrTx = Sql | TransactionSql;

export interface PlaceRow {
  id: string;
  seq: number;
  eventId: string;
  userId: string;
  status: GymEventPlaceStatus;
}

/** Everything a decision reads about one event and one person, in one statement. */
export interface PlaceContext {
  event: { id: string; startsAt: Date; endsAt: Date; places: number | null; cancelled: boolean };
  settings: ClassBookingSettings;
  counts: { coming: number; waitlisted: number };
  /** The person as somebody who may come: a live app member of the gym with an active
   *  account, and their record on its list where it is not a past member's. Null: not a
   *  member now, or nobody was asked about. */
  member: { entryId: string | null } | null;
  /** Their newest place at the event: the one in use, else the last one they gave up. */
  latest: PlaceRow | null;
}

const rawContext = z.object({
  id: z.string(),
  starts_at: z.date(),
  ends_at: z.date(),
  places: z.number().int().nullable(),
  cancelled: z.boolean(),
  handover: z.number().int(),
  waitlist: z.number().int(),
  coming: z.number().int(),
  waitlisted: z.number().int(),
  member: z.boolean(),
  entry_id: z.string().nullable(),
  mine_id: z.string().nullable(),
  mine_seq: z.coerce.number().int().nullable(),
  mine_status: gymEventPlaceStatusSchema.nullable(),
});

/** One event of this gym as one person meets it (`userId` null: as nobody), or null where
 *  the gym has no such event. `lock`: the event's row is held until the transaction ends.
 *  The counts are right for a write only under the gym's lock, taken before this. */
export async function contextOf(sql: SqlOrTx, gymId: string, eventId: string, userId: string | null, lock: boolean): Promise<PlaceContext | null> {
  const rows = await sql`
    SELECT e.id, e.starts_at, e.ends_at, e.places, (e.cancelled_at IS NOT NULL) AS cancelled,
           g.waitlist_handover_minutes AS handover, g.waitlist_max AS waitlist,
           (SELECT count(*)::int FROM gym_event_places p
            WHERE p.gym_id = e.gym_id AND p.event_id = e.id AND p.status = 'coming') AS coming,
           (SELECT count(*)::int FROM gym_event_places p
            WHERE p.gym_id = e.gym_id AND p.event_id = e.id AND p.status = 'waitlisted') AS waitlisted,
           (m.user_id IS NOT NULL AND u.id IS NOT NULL) AS member, l.id AS entry_id,
           mine.id AS mine_id, mine.seq AS mine_seq, mine.status AS mine_status
    FROM gym_events e
    JOIN gyms g ON g.id = e.gym_id
    LEFT JOIN gym_members m ON m.gym_id = e.gym_id AND m.user_id = ${userId}::uuid AND m.removed_at IS NULL
    LEFT JOIN users u ON u.id = m.user_id AND u.status = 'active'
    LEFT JOIN gym_member_list_entries l ON l.gym_id = m.gym_id AND l.id = m.entry_id AND l.former_at IS NULL
    LEFT JOIN LATERAL (
      SELECT p.id, p.seq, p.status FROM gym_event_places p
      WHERE p.gym_id = e.gym_id AND p.event_id = e.id AND p.user_id = ${userId}::uuid
      ORDER BY p.seq DESC LIMIT 1
    ) mine ON true
    WHERE e.gym_id = ${gymId} AND e.id = ${eventId}
    ${lock ? sql`FOR UPDATE OF e` : sql``}`;
  const row = rows[0];
  if (row === undefined) return null;
  const r = rawContext.parse(row);
  return {
    event: { id: r.id, startsAt: r.starts_at, endsAt: r.ends_at, places: r.places, cancelled: r.cancelled },
    settings: eventBookingSettings({ handoverMinutes: r.handover, waitlistMax: r.waitlist }),
    counts: { coming: r.coming, waitlisted: r.waitlisted },
    member: r.member ? { entryId: r.entry_id } : null,
    latest:
      r.mine_id === null || r.mine_seq === null || r.mine_status === null || userId === null
        ? null
        : { id: r.mine_id, seq: r.mine_seq, eventId: r.id, userId, status: r.mine_status },
  };
}

/** The gym's waitlist settings as an event is counted with them; null for no such gym. */
export async function settingsOf(sql: SqlOrTx, gymId: string): Promise<ClassBookingSettings | null> {
  const rows = await sql<{ handover: number; waitlist: number }[]>`
    SELECT waitlist_handover_minutes AS handover, waitlist_max AS waitlist FROM gyms WHERE id = ${gymId}`;
  const r = rows[0];
  return r === undefined ? null : eventBookingSettings({ handoverMinutes: r.handover, waitlistMax: r.waitlist });
}

/** The place this gym keeps under a request's key, whoever made it: the request that made
 *  it, or the one that claimed it from the waitlist. */
export async function byKey(sql: SqlOrTx, gymId: string, requestKey: string): Promise<{ userId: string; eventId: string } | null> {
  const rows = await sql<{ user_id: string; event_id: string }[]>`
    SELECT user_id, event_id FROM gym_event_places
    WHERE gym_id = ${gymId} AND (request_key = ${requestKey} OR claim_key = ${requestKey})
    ORDER BY seq LIMIT 1`;
  const r = rows[0];
  return r === undefined ? null : { userId: r.user_id, eventId: r.event_id };
}

export interface EventCounts {
  coming: number;
  waitlisted: number;
}

/** How many are coming to, and waiting for, each of these events. One statement. */
export async function countsOf(sql: SqlOrTx, gymId: string, eventIds: readonly string[]): Promise<Map<string, EventCounts>> {
  const counts = new Map<string, EventCounts>();
  if (eventIds.length === 0) return counts;
  const rows = await sql<{ event_id: string; coming: number; waitlisted: number }[]>`
    SELECT event_id,
           count(*) FILTER (WHERE status = 'coming')::int AS coming,
           count(*) FILTER (WHERE status = 'waitlisted')::int AS waitlisted
    FROM gym_event_places
    WHERE gym_id = ${gymId} AND event_id = ANY(${[...eventIds]}::uuid[]) AND status IN ('coming','waitlisted')
    GROUP BY event_id`;
  for (const r of rows) counts.set(r.event_id, { coming: r.coming, waitlisted: r.waitlisted });
  return counts;
}

export interface MyPlace {
  status: "coming" | "waitlisted";
  /** 1 for the first in line; null unless waiting. */
  waitlistPlace: number | null;
}

/** This person's place in use at each of these events. One statement. */
export async function minesOf(sql: SqlOrTx, gymId: string, userId: string, eventIds: readonly string[]): Promise<Map<string, MyPlace>> {
  const mine = new Map<string, MyPlace>();
  if (eventIds.length === 0) return mine;
  const rows = await sql<{ event_id: string; status: string; place: number }[]>`
    SELECT p.event_id, p.status,
           (SELECT count(*)::int FROM gym_event_places w
            WHERE w.gym_id = p.gym_id AND w.event_id = p.event_id AND w.status = 'waitlisted' AND w.seq <= p.seq) AS place
    FROM gym_event_places p
    WHERE p.gym_id = ${gymId} AND p.user_id = ${userId} AND p.event_id = ANY(${[...eventIds]}::uuid[])
      AND p.status IN ('coming','waitlisted')`;
  for (const r of rows) {
    mine.set(r.event_id, r.status === "coming" ? { status: "coming", waitlistPlace: null } : { status: "waitlisted", waitlistPlace: r.place });
  }
  return mine;
}

/** The event's waitlist, first in line first, each with their record if they are still a
 *  live member of the gym; `member` false: passed over, and they keep their place in line. */
export async function waitlistOf(tx: TransactionSql, gymId: string, eventId: string): Promise<{ placeId: string; member: boolean; entryId: string | null }[]> {
  const rows = await tx<{ id: string; member: boolean; entry_id: string | null }[]>`
    SELECT p.id, (m.user_id IS NOT NULL AND u.id IS NOT NULL) AS member, l.id AS entry_id
    FROM gym_event_places p
    LEFT JOIN gym_members m ON m.gym_id = p.gym_id AND m.user_id = p.user_id AND m.removed_at IS NULL
    LEFT JOIN users u ON u.id = m.user_id AND u.status = 'active'
    LEFT JOIN gym_member_list_entries l ON l.gym_id = m.gym_id AND l.id = m.entry_id AND l.former_at IS NULL
    WHERE p.gym_id = ${gymId} AND p.event_id = ${eventId} AND p.status = 'waitlisted'
    ORDER BY p.seq`;
  return rows.map((r) => ({ placeId: r.id, member: r.member, entryId: r.entry_id }));
}

/** A new place: coming, or waiting. */
export async function insertPlace(
  tx: TransactionSql,
  input: { gymId: string; eventId: string; userId: string; entryId: string | null; requestKey: string; status: "coming" | "waitlisted"; now: Date },
): Promise<void> {
  await tx`
    INSERT INTO gym_event_places (gym_id, event_id, user_id, entry_id, request_key, status, created_at, coming_at)
    VALUES (${input.gymId}, ${input.eventId}, ${input.userId}, ${input.entryId}, ${input.requestKey}, ${input.status},
            ${input.now}, ${input.status === "coming" ? input.now : null})`;
}

/** Somebody waiting is given the place. `claimKey`: the person's own request; null where
 *  the place was handed to them. */
export async function moveIn(tx: TransactionSql, input: { gymId: string; placeId: string; entryId: string | null; claimKey: string | null; now: Date }): Promise<void> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_event_places
    SET status = 'coming', coming_at = ${input.now}, entry_id = ${input.entryId}, claim_key = ${input.claimKey}
    WHERE gym_id = ${input.gymId} AND id = ${input.placeId} AND status = 'waitlisted'
    RETURNING id`;
  if (rows.length !== 1) throw new Error("a waitlisted place was not there to move in");
}

export async function markCancelled(tx: TransactionSql, gymId: string, placeId: string, now: Date): Promise<void> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_event_places SET status = 'cancelled', cancelled_at = ${now}
    WHERE gym_id = ${gymId} AND id = ${placeId} AND status IN ('coming','waitlisted')
    RETURNING id`;
  if (rows.length !== 1) throw new Error("a place was not there to cancel");
}

/** One place of this event, whatever its status; null where the event has none such. */
export async function placeById(tx: TransactionSql, gymId: string, eventId: string, placeId: string): Promise<{ id: string; status: GymEventPlaceStatus } | null> {
  const rows = await tx<{ id: string; status: string }[]>`
    SELECT id, status FROM gym_event_places WHERE gym_id = ${gymId} AND event_id = ${eventId} AND id = ${placeId}`;
  const r = rows[0];
  return r === undefined ? null : { id: r.id, status: gymEventPlaceStatusSchema.parse(r.status) };
}

export interface PersonRow {
  placeId: string;
  displayName: string;
  email: string | null;
  recordName: string | null;
  at: Date;
}

/** The event's people of one status for staff, in the order they were made. The name is
 *  the account's while it is active, and the record's as the list has it now. */
export async function peopleOf(sql: SqlOrTx, gymId: string, eventId: string, status: "coming" | "waitlisted", limit: number): Promise<PersonRow[]> {
  const rows = await sql<{ id: string; display_name: string | null; email: string | null; record_name: string | null; at: Date }[]>`
    SELECT p.id, COALESCE(p.coming_at, p.created_at) AS at,
           CASE WHEN u.status = 'active' THEN u.display_name END AS display_name,
           CASE WHEN u.status = 'active' THEN u.email::text END AS email,
           nullif(btrim(l.full_name), '') AS record_name
    FROM gym_event_places p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN gym_member_list_entries l ON l.gym_id = p.gym_id AND l.id = p.entry_id
    WHERE p.gym_id = ${gymId} AND p.event_id = ${eventId} AND p.status = ${status}
    ORDER BY p.seq
    LIMIT ${limit}`;
  return rows.map((r) => ({ placeId: r.id, displayName: r.display_name ?? "", email: r.email, recordName: r.record_name, at: r.at }));
}

/** THESE PEOPLE HAVE LEFT THE GYM: their places at events that have not started end.
 *  Answers the events a place was freed at. Run again it finds nothing left to end. */
export async function endPlacesOf(tx: TransactionSql, gymId: string, userIds: readonly string[], at: Date): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await tx<{ event_id: string; was: string }[]>`
    WITH old AS (
      SELECT p.id, p.status FROM gym_event_places p
      WHERE p.gym_id = ${gymId} AND p.user_id = ANY(${[...userIds]}::uuid[]) AND p.status IN ('coming','waitlisted')
        AND EXISTS (SELECT 1 FROM gym_events e WHERE e.gym_id = p.gym_id AND e.id = p.event_id AND e.starts_at > ${at})
      FOR UPDATE
    )
    UPDATE gym_event_places p SET status = 'cancelled', cancelled_at = ${at}
    FROM old WHERE p.id = old.id
    RETURNING p.event_id, old.status AS was`;
  return [...new Set(rows.filter((r) => r.was === "coming").map((r) => r.event_id))];
}

/** Which of this gym's events that have not started somebody is waiting for: all of them,
 *  or those among `eventIds`. The soonest first. */
export async function eventsWithWaitlist(tx: TransactionSql, gymId: string, now: Date, eventIds: readonly string[] | null): Promise<string[]> {
  if (eventIds !== null && eventIds.length === 0) return [];
  const rows = await tx<{ id: string }[]>`
    SELECT e.id FROM gym_events e
    WHERE e.gym_id = ${gymId} AND e.starts_at > ${now} AND e.cancelled_at IS NULL
      AND (${eventIds === null ? null : [...eventIds]}::uuid[] IS NULL OR e.id = ANY(${eventIds === null ? null : [...eventIds]}::uuid[]))
      AND EXISTS (SELECT 1 FROM gym_event_places p WHERE p.gym_id = e.gym_id AND p.event_id = e.id AND p.status = 'waitlisted')
    ORDER BY e.starts_at, e.id`;
  return rows.map((r) => r.id);
}
