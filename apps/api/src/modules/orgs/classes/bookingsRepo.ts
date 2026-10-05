// CLASS BOOKINGS: the only file that reads or writes them (spec Part 3 §13.4; ROADMAP
// 17c-i).
//
// Every statement carries `gym_id`, and a class is found by its gym and its id together.
// Every write runs under the gym's row lock (`lockOrgRow`, the lock every timetable,
// member-list and membership write takes first) and then the class's own row: the places
// are counted and a pack is charged inside that, so two requests cannot both take the
// last place, and no membership moves while a booking reads it.
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import {
  CLASS_BOOKING_COUNTED,
  CLASS_BOOKING_HOLDS_PLACE,
  bookingPeriod,
  classBookingStatusSchema,
  type ClassBookingSettings,
  type ClassBookingStatus,
  type HeldCover,
} from "@app/shared";
import { heldForBooking } from "../memberships/heldRepo.js";

type SqlOrTx = Sql | TransactionSql;

export interface BookingSession {
  id: string;
  classTypeId: string;
  className: string;
  openGym: boolean;
  localDate: string;
  localStartMinute: number;
  startsAt: Date;
  minutes: number;
  places: number | null;
  cancelled: boolean;
  coachUserId: string | null;
}

/** One class of this gym, or null. `lock`: held until the transaction ends. */
export async function sessionById(sql: SqlOrTx, gymId: string, sessionId: string, lock: boolean): Promise<BookingSession | null> {
  const rows = await sql<
    {
      id: string;
      class_type_id: string;
      name: string;
      open_gym: boolean;
      local_date: string;
      local_start_minute: number;
      starts_at: Date;
      minutes: number;
      places: number | null;
      status: string;
      coach_user_id: string | null;
    }[]
  >`
    SELECT s.id, s.class_type_id, t.name, t.open_gym, s.local_date::text AS local_date, s.local_start_minute,
           s.starts_at, s.minutes, s.places, s.status, s.coach_user_id
    FROM gym_class_sessions s
    JOIN gym_class_types t ON t.id = s.class_type_id AND t.gym_id = s.gym_id
    WHERE s.gym_id = ${gymId} AND s.id = ${sessionId}
    ${lock ? sql`FOR UPDATE OF s` : sql``}`;
  const r = rows[0];
  if (r === undefined) return null;
  return {
    id: r.id,
    classTypeId: r.class_type_id,
    className: r.name,
    openGym: r.open_gym,
    localDate: r.local_date,
    localStartMinute: r.local_start_minute,
    startsAt: r.starts_at,
    minutes: r.minutes,
    places: r.places,
    cancelled: r.status === "cancelled",
    coachUserId: r.coach_user_id,
  };
}

export interface BookingRow {
  id: string;
  seq: number;
  sessionId: string;
  userId: string;
  status: ClassBookingStatus;
  heldMembershipId: string | null;
  packCharged: boolean;
}

const rawBooking = z.object({
  id: z.string(),
  seq: z.coerce.number().int(),
  session_id: z.string(),
  user_id: z.string(),
  status: classBookingStatusSchema,
  held_membership_id: z.string().nullable(),
  pack_charged: z.boolean(),
});

function toBooking(row: unknown): BookingRow {
  const r = rawBooking.parse(row);
  return {
    id: r.id,
    seq: r.seq,
    sessionId: r.session_id,
    userId: r.user_id,
    status: r.status,
    heldMembershipId: r.held_membership_id,
    packCharged: r.pack_charged,
  };
}

const BOOKING = (sql: SqlOrTx) => sql`id, seq, session_id, user_id, status, held_membership_id, pack_charged`;

/** Everything a booking decision reads about one class and one person, in one statement
 *  (a booking write holds the gym's lock for as long as its statements take). */
export interface BookingContext {
  session: BookingSession;
  settings: ClassBookingSettings & { timezone: string };
  /** How many hold a place in the class, and how many wait. */
  counts: { booked: number; waitlisted: number };
  /** Whether the gym has any membership type on its price list. */
  gymHasTypes: boolean;
  /** The person as a booker: a live app member of the gym with an active account, and
   *  their record on its list where the list says which is theirs and it is not a past
   *  member's. Null: not a member now. */
  booker: { entryId: string | null } | null;
  /** Their newest booking of the class: the one in use where there is one, else the last
   *  one they cancelled. */
  latest: BookingRow | null;
}

const rawContext = z.object({
  id: z.string(),
  class_type_id: z.string(),
  name: z.string(),
  open_gym: z.boolean(),
  local_date: z.string(),
  local_start_minute: z.number().int(),
  starts_at: z.date(),
  minutes: z.number().int(),
  places: z.number().int().nullable(),
  session_status: z.string(),
  coach_user_id: z.string().nullable(),
  opens: z.number().int(),
  free: z.number().int(),
  handover: z.number().int(),
  waitlist: z.number().int(),
  timezone: z.string(),
  booked: z.number().int(),
  waitlisted: z.number().int(),
  has_types: z.boolean(),
  member: z.boolean(),
  entry_id: z.string().nullable(),
  mine_id: z.string().nullable(),
});

/** One class of this gym as one person meets it, or null where the gym has no such class.
 *  `lock`: the class's row is held until the transaction ends. The counts are right for
 *  a write only under the gym's lock, taken in a statement before this one. */
export async function contextOf(sql: SqlOrTx, gymId: string, sessionId: string, userId: string, lock: boolean): Promise<BookingContext | null> {
  const rows = await sql`
    SELECT s.id, s.class_type_id, t.name, t.open_gym, s.local_date::text AS local_date, s.local_start_minute,
           s.starts_at, s.minutes, s.places, s.status AS session_status, s.coach_user_id,
           g.booking_opens_days AS opens, g.booking_free_cancel_minutes AS free,
           g.waitlist_handover_minutes AS handover, g.waitlist_max AS waitlist, g.timezone,
           (SELECT count(*)::int FROM gym_class_bookings b
            WHERE b.gym_id = s.gym_id AND b.session_id = s.id AND b.status = ANY(${[...CLASS_BOOKING_HOLDS_PLACE]}::text[])) AS booked,
           (SELECT count(*)::int FROM gym_class_bookings b
            WHERE b.gym_id = s.gym_id AND b.session_id = s.id AND b.status = 'waitlisted') AS waitlisted,
           EXISTS (SELECT 1 FROM gym_membership_types mt WHERE mt.gym_id = s.gym_id AND mt.archived_at IS NULL) AS has_types,
           (m.user_id IS NOT NULL AND u.id IS NOT NULL) AS member, e.id AS entry_id,
           mine.id AS mine_id, mine.seq, mine.session_id, mine.user_id, mine.status, mine.held_membership_id, mine.pack_charged
    FROM gym_class_sessions s
    JOIN gym_class_types t ON t.id = s.class_type_id AND t.gym_id = s.gym_id
    JOIN gyms g ON g.id = s.gym_id
    LEFT JOIN gym_members m ON m.gym_id = s.gym_id AND m.user_id = ${userId} AND m.removed_at IS NULL
    LEFT JOIN users u ON u.id = m.user_id AND u.status = 'active'
    LEFT JOIN gym_member_list_entries e ON e.gym_id = m.gym_id AND e.id = m.entry_id AND e.former_at IS NULL
    LEFT JOIN LATERAL (
      SELECT ${BOOKING(sql)} FROM gym_class_bookings b
      WHERE b.gym_id = s.gym_id AND b.session_id = s.id AND b.user_id = ${userId}
      ORDER BY b.seq DESC LIMIT 1
    ) mine ON true
    WHERE s.gym_id = ${gymId} AND s.id = ${sessionId}
    ${lock ? sql`FOR UPDATE OF s` : sql``}`;
  const row = rows[0];
  if (row === undefined) return null;
  const r = rawContext.parse(row);
  return {
    session: {
      id: r.id,
      classTypeId: r.class_type_id,
      className: r.name,
      openGym: r.open_gym,
      localDate: r.local_date,
      localStartMinute: r.local_start_minute,
      startsAt: r.starts_at,
      minutes: r.minutes,
      places: r.places,
      cancelled: r.session_status === "cancelled",
      coachUserId: r.coach_user_id,
    },
    settings: { opensDays: r.opens, freeCancelMinutes: r.free, handoverMinutes: r.handover, waitlistMax: r.waitlist, timezone: r.timezone },
    counts: { booked: r.booked, waitlisted: r.waitlisted },
    gymHasTypes: r.has_types,
    booker: r.member ? { entryId: r.entry_id } : null,
    latest: r.mine_id === null ? null : toBooking({ ...row, id: r.mine_id }),
  };
}

/** The booking this gym keeps under a request's key, whoever made it. */
export async function byKey(sql: SqlOrTx, gymId: string, requestKey: string): Promise<BookingRow | null> {
  const rows = await sql`
    SELECT ${BOOKING(sql)} FROM gym_class_bookings WHERE gym_id = ${gymId} AND request_key = ${requestKey}`;
  return rows[0] === undefined ? null : toBooking(rows[0]);
}

/** A waitlisted person's place in line, 1 for the first. */
export async function waitlistPlace(sql: SqlOrTx, gymId: string, sessionId: string, seq: number): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_class_bookings
    WHERE gym_id = ${gymId} AND session_id = ${sessionId} AND status = 'waitlisted' AND seq <= ${seq}`;
  return rows[0]?.n ?? 0;
}

/** The class's waitlist, first in line first. */
export async function waitlistOf(tx: TransactionSql, gymId: string, sessionId: string): Promise<BookingRow[]> {
  const rows = await tx`
    SELECT ${BOOKING(tx)} FROM gym_class_bookings
    WHERE gym_id = ${gymId} AND session_id = ${sessionId} AND status = 'waitlisted'
    ORDER BY seq`;
  return rows.map(toBooking);
}

/** The person as a booker: a live app member of the gym with an active account, and their
 *  record on its list where the list says which is theirs and it is not a past member's.
 *  Null: not a member now. */
export async function bookerOf(sql: SqlOrTx, gymId: string, userId: string): Promise<{ entryId: string | null } | null> {
  const rows = await sql<{ entry_id: string | null }[]>`
    SELECT e.id AS entry_id
    FROM gym_members m
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    LEFT JOIN gym_member_list_entries e ON e.gym_id = m.gym_id AND e.id = m.entry_id AND e.former_at IS NULL
    WHERE m.gym_id = ${gymId} AND m.user_id = ${userId} AND m.removed_at IS NULL
    LIMIT 1`;
  const r = rows[0];
  return r === undefined ? null : { entryId: r.entry_id };
}

/** The record's memberships in use, each with its bookings already counted in the week
 *  and the month the class is in (the gym's own days). */
export async function coversOf(sql: SqlOrTx, gymId: string, entryId: string, session: BookingSession): Promise<HeldCover[]> {
  const held = await heldForBooking(sql, gymId, entryId, session.classTypeId);
  const limited = held.filter((h) => h.bookingsPeriod !== null).map((h) => h.id);
  const used = new Map<string, { week: number; month: number }>();
  if (limited.length > 0) {
    const week = bookingPeriod(session.localDate, "week");
    const month = bookingPeriod(session.localDate, "month");
    const rows = await sql<{ id: string; week: number; month: number }[]>`
      SELECT b.held_membership_id AS id,
             count(*) FILTER (WHERE s.local_date BETWEEN ${week.from}::date AND ${week.to}::date)::int AS week,
             count(*) FILTER (WHERE s.local_date BETWEEN ${month.from}::date AND ${month.to}::date)::int AS month
      FROM gym_class_bookings b
      JOIN gym_class_sessions s ON s.gym_id = b.gym_id AND s.id = b.session_id
      WHERE b.gym_id = ${gymId} AND b.held_membership_id = ANY(${limited}::uuid[])
        AND b.status = ANY(${[...CLASS_BOOKING_COUNTED]}::text[])
        AND s.local_date BETWEEN LEAST(${week.from}::date, ${month.from}::date) AND GREATEST(${week.to}::date, ${month.to}::date)
      GROUP BY b.held_membership_id`;
    for (const r of rows) used.set(r.id, { week: r.week, month: r.month });
  }
  return held.map((h) => ({ ...h, used: h.bookingsPeriod === null ? 0 : (used.get(h.id)?.[h.bookingsPeriod] ?? 0) }));
}

/** A new booking, holding a place or waiting. */
export async function insertBooking(
  tx: TransactionSql,
  input: {
    gymId: string;
    sessionId: string;
    userId: string;
    entryId: string | null;
    requestKey: string;
    status: "booked" | "waitlisted";
    heldMembershipId: string | null;
    packCharged: boolean;
    now: Date;
  },
): Promise<void> {
  const booked = input.status === "booked";
  await tx`
    INSERT INTO gym_class_bookings
      (gym_id, session_id, user_id, entry_id, request_key, status, held_membership_id, pack_charged, created_at, booked_at)
    VALUES (${input.gymId}, ${input.sessionId}, ${input.userId}, ${input.entryId}, ${input.requestKey}, ${input.status},
            ${booked ? input.heldMembershipId : null}, ${booked && input.packCharged}, ${input.now}, ${booked ? input.now : null})`;
}

/** Somebody waiting is given the place. */
export async function moveIn(
  tx: TransactionSql,
  input: { gymId: string; bookingId: string; entryId: string | null; heldMembershipId: string | null; packCharged: boolean; now: Date },
): Promise<void> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_class_bookings
    SET status = 'booked', booked_at = ${input.now}, entry_id = ${input.entryId},
        held_membership_id = ${input.heldMembershipId}, pack_charged = ${input.packCharged}
    WHERE gym_id = ${input.gymId} AND id = ${input.bookingId} AND status = 'waitlisted'
    RETURNING id`;
  if (rows.length !== 1) throw new Error("a waitlisted booking was not there to move in");
}

/** A booking cancelled, free or late. */
export async function markCancelled(
  tx: TransactionSql,
  input: { gymId: string; bookingId: string; status: "cancelled" | "late_cancelled"; packCharged: boolean; now: Date },
): Promise<void> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_class_bookings
    SET status = ${input.status}, cancelled_at = ${input.now}, pack_charged = ${input.packCharged}
    WHERE gym_id = ${input.gymId} AND id = ${input.bookingId} AND status IN ('booked','waitlisted')
    RETURNING id`;
  if (rows.length !== 1) throw new Error("a booking was not there to cancel");
}

export interface StaffBookingRow {
  bookingId: string;
  status: ClassBookingStatus;
  displayName: string;
  email: string | null;
  recordName: string | null;
  membership: string | null;
  packCharged: boolean;
  at: Date;
}

/** The class's bookings of these statuses for staff, in the order they were made. The
 *  name is the account's while it is active, and the record's as the list has it now. */
export async function staffList(
  sql: SqlOrTx,
  gymId: string,
  sessionId: string,
  statuses: readonly ClassBookingStatus[],
  limit: number,
): Promise<StaffBookingRow[]> {
  const rows = await sql<
    {
      id: string;
      status: string;
      display_name: string | null;
      email: string | null;
      record_name: string | null;
      membership: string | null;
      pack_charged: boolean;
      at: Date;
    }[]
  >`
    SELECT b.id, b.status, b.pack_charged, COALESCE(b.cancelled_at, b.booked_at, b.created_at) AS at,
           CASE WHEN u.status = 'active' THEN u.display_name END AS display_name,
           CASE WHEN u.status = 'active' THEN u.email::text END AS email,
           nullif(btrim(e.full_name), '') AS record_name,
           t.name AS membership
    FROM gym_class_bookings b
    JOIN users u ON u.id = b.user_id
    LEFT JOIN gym_member_list_entries e ON e.gym_id = b.gym_id AND e.id = b.entry_id
    LEFT JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    LEFT JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    WHERE b.gym_id = ${gymId} AND b.session_id = ${sessionId} AND b.status = ANY(${[...statuses]}::text[])
    ORDER BY b.seq
    LIMIT ${limit}`;
  return rows.map((r) => ({
    bookingId: r.id,
    status: classBookingStatusSchema.parse(r.status),
    displayName: r.display_name ?? "",
    email: r.email,
    recordName: r.record_name,
    membership: r.membership,
    packCharged: r.pack_charged,
    at: r.at,
  }));
}

export async function countStatus(sql: SqlOrTx, gymId: string, sessionId: string, status: ClassBookingStatus): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_class_bookings
    WHERE gym_id = ${gymId} AND session_id = ${sessionId} AND status = ${status}`;
  return rows[0]?.n ?? 0;
}
