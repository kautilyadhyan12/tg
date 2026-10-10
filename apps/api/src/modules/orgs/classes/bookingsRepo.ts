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
  type PtBookingSettings,
  type ClassBookingStatus,
  type HeldCover,
} from "@app/shared";
import { heldForBooking, heldForClasses } from "../memberships/heldRepo.js";

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
  online: boolean;
  onlineLink: string | null;
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
      online: boolean;
      online_link: string | null;
    }[]
  >`
    SELECT s.id, s.class_type_id, t.name, t.open_gym, s.local_date::text AS local_date, s.local_start_minute,
           s.starts_at, s.minutes, s.places, s.status, s.coach_user_id, s.online, s.online_link
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
    online: r.online,
    onlineLink: r.online_link,
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
  online: z.boolean(),
  online_link: z.string().nullable(),
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

/** The classes of this gym that `which` chooses, each as one person meets it. */
async function contexts(sql: SqlOrTx, gymId: string, userId: string, which: ReturnType<SqlOrTx>, tail: ReturnType<SqlOrTx>): Promise<BookingContext[]> {
  const rows = await sql`
    SELECT s.id, s.class_type_id, t.name, t.open_gym, s.local_date::text AS local_date, s.local_start_minute,
           s.starts_at, s.minutes, s.places, s.status AS session_status, s.coach_user_id, s.online, s.online_link,
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
    WHERE s.gym_id = ${gymId} AND ${which}
    ${tail}`;
  return rows.map((row) => {
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
        online: r.online,
        onlineLink: r.online_link,
      },
      settings: { opensDays: r.opens, freeCancelMinutes: r.free, handoverMinutes: r.handover, waitlistMax: r.waitlist, timezone: r.timezone },
      counts: { booked: r.booked, waitlisted: r.waitlisted },
      gymHasTypes: r.has_types,
      booker: r.member ? { entryId: r.entry_id } : null,
      latest: r.mine_id === null ? null : toBooking({ ...row, id: r.mine_id }),
    };
  });
}

/** One class of this gym as one person meets it, or null where the gym has no such class.
 *  `lock`: the class's row is held until the transaction ends. The counts are right for
 *  a write only under the gym's lock, taken in a statement before this one. */
export async function contextOf(sql: SqlOrTx, gymId: string, sessionId: string, userId: string, lock: boolean): Promise<BookingContext | null> {
  return (await contexts(sql, gymId, userId, sql`s.id = ${sessionId}`, lock ? sql`FOR UPDATE OF s` : sql``))[0] ?? null;
}

/** The gym's classes that have not started, on its own days `from` to `to`, the soonest
 *  first, each as this person meets it: at most `limit`. With them an online class under
 *  way that this person holds a place in: its link is theirs until it ends, so one that
 *  began on the day before `from` and runs past midnight is still there. A plain read. */
export async function comingContexts(
  sql: SqlOrTx,
  gymId: string,
  userId: string,
  when: { now: Date; from: string; to: string; limit: number },
): Promise<BookingContext[]> {
  return await contexts(
    sql,
    gymId,
    userId,
    sql`s.local_date BETWEEN ${when.from}::date - 1 AND ${when.to}::date
        AND ((s.starts_at > ${when.now} AND s.local_date >= ${when.from}::date)
             OR (s.online AND s.status = 'scheduled' AND s.starts_at <= ${when.now}
                 AND s.starts_at + make_interval(mins => s.minutes) > ${when.now}
                 AND EXISTS (SELECT 1 FROM gym_class_bookings o
                             WHERE o.gym_id = s.gym_id AND o.session_id = s.id AND o.user_id = ${userId}
                               AND o.status = ANY(${[...CLASS_BOOKING_HOLDS_PLACE]}::text[]))))`,
    sql`ORDER BY s.starts_at, s.id LIMIT ${when.limit}`,
  );
}

/** The booking this gym keeps under a request's key, whoever made it: the request that
 *  made it, or the one that claimed its place from the waitlist. */
export async function byKey(sql: SqlOrTx, gymId: string, requestKey: string): Promise<BookingRow | null> {
  const rows = await sql`
    SELECT ${BOOKING(sql)} FROM gym_class_bookings
    WHERE gym_id = ${gymId} AND (request_key = ${requestKey} OR claim_key = ${requestKey})
    ORDER BY seq LIMIT 1`;
  return rows[0] === undefined ? null : toBooking(rows[0]);
}

/** A waitlisted person's place in line, 1 for the first. */
export async function waitlistPlace(sql: SqlOrTx, gymId: string, sessionId: string, seq: number): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_class_bookings
    WHERE gym_id = ${gymId} AND session_id = ${sessionId} AND status = 'waitlisted' AND seq <= ${seq}`;
  return rows[0]?.n ?? 0;
}

export interface Waiter {
  bookingId: string;
  userId: string;
  /** As `BookingContext.booker`: null where they are not a member now. */
  booker: { entryId: string | null } | null;
}

/** The class's waitlist, first in line first, each person as a booker, in one statement. */
export async function waitlistOf(sql: SqlOrTx, gymId: string, sessionId: string): Promise<Waiter[]> {
  const rows = await sql<{ id: string; user_id: string; member: boolean; entry_id: string | null }[]>`
    SELECT b.id, b.user_id, (m.user_id IS NOT NULL AND u.id IS NOT NULL) AS member, e.id AS entry_id
    FROM gym_class_bookings b
    LEFT JOIN gym_members m ON m.gym_id = b.gym_id AND m.user_id = b.user_id AND m.removed_at IS NULL
    LEFT JOIN users u ON u.id = m.user_id AND u.status = 'active'
    LEFT JOIN gym_member_list_entries e ON e.gym_id = m.gym_id AND e.id = m.entry_id AND e.former_at IS NULL
    WHERE b.gym_id = ${gymId} AND b.session_id = ${sessionId} AND b.status = 'waitlisted'
    ORDER BY b.seq`;
  return rows.map((r) => ({ bookingId: r.id, userId: r.user_id, booker: r.member ? { entryId: r.entry_id } : null }));
}

/** `waitlistOf` for many classes at once, by class. One statement. */
export async function waitlistsOf(sql: SqlOrTx, gymId: string, sessionIds: readonly string[]): Promise<Map<string, Waiter[]>> {
  const lines = new Map<string, Waiter[]>();
  if (sessionIds.length === 0) return lines;
  const rows = await sql<{ id: string; session_id: string; user_id: string; member: boolean; entry_id: string | null }[]>`
    SELECT b.id, b.session_id, b.user_id, (m.user_id IS NOT NULL AND u.id IS NOT NULL) AS member, e.id AS entry_id
    FROM gym_class_bookings b
    LEFT JOIN gym_members m ON m.gym_id = b.gym_id AND m.user_id = b.user_id AND m.removed_at IS NULL
    LEFT JOIN users u ON u.id = m.user_id AND u.status = 'active'
    LEFT JOIN gym_member_list_entries e ON e.gym_id = m.gym_id AND e.id = m.entry_id AND e.former_at IS NULL
    WHERE b.gym_id = ${gymId} AND b.session_id = ANY(${[...sessionIds]}::uuid[]) AND b.status = 'waitlisted'
    ORDER BY b.seq`;
  for (const r of rows) {
    lines.set(r.session_id, [...(lines.get(r.session_id) ?? []), { bookingId: r.id, userId: r.user_id, booker: r.member ? { entryId: r.entry_id } : null }]);
  }
  return lines;
}

/** These records' memberships in use, by record, each with its bookings already counted in
 *  the week and the month the class is in (the gym's own days). A class staff cancelled
 *  is not counted. Two statements, however many records. */
export async function coversOf(
  sql: SqlOrTx,
  gymId: string,
  entryIds: readonly string[],
  session: BookingSession,
): Promise<Map<string, HeldCover[]>> {
  const covers = new Map<string, HeldCover[]>();
  if (entryIds.length === 0) return covers;
  const held = await heldForBooking(sql, gymId, entryIds, session.classTypeId);
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
        AND s.status <> 'cancelled'
        AND s.local_date BETWEEN LEAST(${week.from}::date, ${month.from}::date) AND GREATEST(${week.to}::date, ${month.to}::date)
      GROUP BY b.held_membership_id`;
    for (const r of rows) used.set(r.id, { week: r.week, month: r.month });
  }
  for (const { entryId, ...h } of held) {
    const list = covers.get(entryId) ?? [];
    list.push({ ...h, used: h.bookingsPeriod === null ? 0 : (used.get(h.id)?.[h.bookingsPeriod] ?? 0) });
    covers.set(entryId, list);
  }
  return covers;
}

/** `coversOf` for many classes at once: by class, then by record, the memberships in use
 *  of the records `recordsOf` names for that class, as the class meets them. Two
 *  statements, however many classes and records. A plain read. */
export async function coversOfClasses(
  sql: SqlOrTx,
  gymId: string,
  sessions: readonly BookingSession[],
  recordsOf: (sessionId: string) => readonly string[],
): Promise<Map<string, Map<string, HeldCover[]>>> {
  const covers = new Map<string, Map<string, HeldCover[]>>();
  const entryIds = [...new Set(sessions.flatMap((s) => recordsOf(s.id)))];
  if (entryIds.length === 0) return covers;
  const rows = await heldForClasses(sql, gymId, entryIds);
  const heldBy = new Map<string, Omit<(typeof rows)[number], "entryId">[]>();
  for (const { entryId, ...h } of rows) heldBy.set(entryId, [...(heldBy.get(entryId) ?? []), h]);
  const limited = rows.filter((h) => h.bookingsPeriod !== null).map((h) => h.id);
  const periods = new Map(sessions.map((s) => [s.id, { week: bookingPeriod(s.localDate, "week"), month: bookingPeriod(s.localDate, "month") }]));
  // Their counted bookings by membership and day, over every week and month the classes are in.
  const counted = new Map<string, { day: string; n: number }[]>();
  if (limited.length > 0) {
    const ends = [...periods.values()].flatMap((p) => [p.week.from, p.week.to, p.month.from, p.month.to]).sort();
    const rows = await sql<{ id: string; day: string; n: number }[]>`
      SELECT b.held_membership_id AS id, s.local_date::text AS day, count(*)::int AS n
      FROM gym_class_bookings b
      JOIN gym_class_sessions s ON s.gym_id = b.gym_id AND s.id = b.session_id
      WHERE b.gym_id = ${gymId} AND b.held_membership_id = ANY(${limited}::uuid[])
        AND b.status = ANY(${[...CLASS_BOOKING_COUNTED]}::text[])
        AND s.status <> 'cancelled'
        AND s.local_date BETWEEN ${ends[0] ?? ""}::date AND ${ends[ends.length - 1] ?? ""}::date
      GROUP BY b.held_membership_id, s.local_date`;
    for (const r of rows) counted.set(r.id, [...(counted.get(r.id) ?? []), { day: r.day, n: r.n }]);
  }
  for (const session of sessions) {
    const period = periods.get(session.id);
    const byRecord = new Map<string, HeldCover[]>();
    for (const record of recordsOf(session.id)) {
      byRecord.set(
        record,
        (heldBy.get(record) ?? []).map(({ coversAll, classTypeIds, ...h }) => {
          const within = h.bookingsPeriod === null || period === undefined ? null : period[h.bookingsPeriod];
          const used = within === null ? 0 : (counted.get(h.id) ?? []).reduce((sum, c) => (c.day >= within.from && c.day <= within.to ? sum + c.n : sum), 0);
          return { ...h, coversClass: coversAll || classTypeIds.includes(session.classTypeId), used };
        }),
      );
    }
    covers.set(session.id, byRecord);
  }
  return covers;
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
  input: {
    gymId: string;
    bookingId: string;
    entryId: string | null;
    heldMembershipId: string | null;
    packCharged: boolean;
    /** The person's own Claim request; null where the place was handed to them. */
    claimKey: string | null;
    now: Date;
  },
): Promise<void> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_class_bookings
    SET status = 'booked', booked_at = ${input.now}, entry_id = ${input.entryId},
        held_membership_id = ${input.heldMembershipId}, pack_charged = ${input.packCharged},
        claim_key = ${input.claimKey}
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
    WHERE gym_id = ${input.gymId} AND id = ${input.bookingId} AND status IN ('booked','waitlisted','attended','no_show')
    RETURNING id`;
  if (rows.length !== 1) throw new Error("a booking was not there to cancel");
}

export interface StaffBookingRow {
  bookingId: string;
  status: ClassBookingStatus;
  displayName: string;
  email: string | null;
  recordName: string | null;
  /** Their record on the gym's list as it is now; null where it has gone. */
  entryId: string | null;
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
      entry_id: string | null;
      membership: string | null;
      pack_charged: boolean;
      at: Date;
    }[]
  >`
    SELECT b.id, b.status, b.pack_charged, COALESCE(b.cancelled_at, b.booked_at, b.created_at) AS at, e.id AS entry_id,
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
    entryId: r.entry_id,
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

// ── WHEN A CLASS OR A PERSON GOES (17c-ii-a) ──

/** One class as a hand-over reads it: no one person in it. */
export type ClassContext = Pick<BookingContext, "session" | "settings" | "counts" | "gymHasTypes">;

const rawClassContext = rawContext.omit({ member: true, entry_id: true, mine_id: true });

/** One class of this gym with its counts, its row held until the transaction ends; null
 *  where the gym has no such class. For a write under the gym's lock. */
export async function classContext(tx: TransactionSql, gymId: string, sessionId: string): Promise<ClassContext | null> {
  const rows = await tx`
    SELECT s.id, s.class_type_id, t.name, t.open_gym, s.local_date::text AS local_date, s.local_start_minute,
           s.starts_at, s.minutes, s.places, s.status AS session_status, s.coach_user_id, s.online, s.online_link,
           g.booking_opens_days AS opens, g.booking_free_cancel_minutes AS free,
           g.waitlist_handover_minutes AS handover, g.waitlist_max AS waitlist, g.timezone,
           (SELECT count(*)::int FROM gym_class_bookings b
            WHERE b.gym_id = s.gym_id AND b.session_id = s.id AND b.status = ANY(${[...CLASS_BOOKING_HOLDS_PLACE]}::text[])) AS booked,
           (SELECT count(*)::int FROM gym_class_bookings b
            WHERE b.gym_id = s.gym_id AND b.session_id = s.id AND b.status = 'waitlisted') AS waitlisted,
           EXISTS (SELECT 1 FROM gym_membership_types mt WHERE mt.gym_id = s.gym_id AND mt.archived_at IS NULL) AS has_types
    FROM gym_class_sessions s
    JOIN gym_class_types t ON t.id = s.class_type_id AND t.gym_id = s.gym_id
    JOIN gyms g ON g.id = s.gym_id
    WHERE s.gym_id = ${gymId} AND s.id = ${sessionId}
    FOR UPDATE OF s`;
  const row = rows[0];
  if (row === undefined) return null;
  const r = rawClassContext.parse(row);
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
      online: r.online,
      onlineLink: r.online_link,
    },
    settings: { opensDays: r.opens, freeCancelMinutes: r.free, handoverMinutes: r.handover, waitlistMax: r.waitlist, timezone: r.timezone },
    counts: { booked: r.booked, waitlisted: r.waitlisted },
    gymHasTypes: r.has_types,
  };
}

/** Which of these classes have somebody waiting, the soonest first. */
export async function classesWithWaitlist(tx: TransactionSql, gymId: string, sessionIds: readonly string[]): Promise<string[]> {
  if (sessionIds.length === 0) return [];
  const rows = await tx<{ id: string }[]>`
    SELECT s.id FROM gym_class_sessions s
    WHERE s.gym_id = ${gymId} AND s.id = ANY(${[...sessionIds]}::uuid[])
      AND EXISTS (SELECT 1 FROM gym_class_bookings b WHERE b.gym_id = s.gym_id AND b.session_id = s.id AND b.status = 'waitlisted')
    ORDER BY s.starts_at, s.id`;
  return rows.map((r) => r.id);
}

/** This gym's coming classes that somebody is waiting for, the soonest first. */
export async function comingClassesWithWaitlist(tx: TransactionSql, gymId: string, now: Date): Promise<string[]> {
  const rows = await tx<{ id: string }[]>`
    SELECT s.id FROM gym_class_sessions s
    WHERE s.gym_id = ${gymId} AND s.starts_at > ${now} AND s.status = 'scheduled'
      AND EXISTS (SELECT 1 FROM gym_class_bookings b WHERE b.gym_id = s.gym_id AND b.session_id = s.id AND b.status = 'waitlisted')
    ORDER BY s.starts_at, s.id`;
  return rows.map((r) => r.id);
}

export interface EndedBooking {
  userId: string;
  sessionId: string;
  /** What it was: `booked` or `waitlisted`, and for a class that will not run also
   *  `attended`, `no_show` and a `late_cancelled` whose pack had kept the charge. */
  was: ClassBookingStatus;
  /** The pack this booking's class goes back to; null where none was charged. */
  packMembershipId: string | null;
}

/** BOOKINGS ENDED BY SOMETHING OTHER THAN THE PERSON'S OWN CANCEL. Each becomes
 *  `cancelled` and stops being charged to its pack; the caller gives the classes back
 *  (`packMembershipId`) in the same transaction, under the gym's lock. Run again it finds
 *  nothing left to end.
 *
 *  `classes`: these classes will not run (staff cancelled or removed them), so everything
 *  on them ends, and a late cancel whose pack kept the charge loses the charge too.
 *  `people`: these people have left the gym, so their bookings of classes that have not
 *  started end (a place a check-in marked came before the start is one of them); a class
 *  already started is history and stays.
 *  `records`: these records have come off the gym's list, so the bookings made on them
 *  end the same way, whether or not the person's app has ended.
 *  `membership`: staff cancelled this membership, so the places booked on it end. */
export async function endBookings(
  tx: TransactionSql,
  gymId: string,
  which: { classes: readonly string[] } | { people: readonly string[]; now: Date } | { records: readonly string[]; now: Date } | MembershipScope,
  at: Date,
): Promise<EndedBooking[]> {
  if ("classes" in which && which.classes.length === 0) return [];
  if ("people" in which && which.people.length === 0) return [];
  if ("records" in which && which.records.length === 0) return [];
  const notStarted = (now: Date) => tx`
    b.status IN ('booked','waitlisted','attended')
    AND EXISTS (SELECT 1 FROM gym_class_sessions s
                WHERE s.gym_id = b.gym_id AND s.id = b.session_id AND s.starts_at > ${now})`;
  const chosen =
    "classes" in which
      ? tx`b.session_id = ANY(${[...which.classes]}::uuid[])
           AND (b.status IN ('booked','waitlisted','attended','no_show') OR (b.status = 'late_cancelled' AND b.pack_charged))`
      : "people" in which
        ? tx`b.user_id = ANY(${[...which.people]}::uuid[]) AND ${notStarted(which.now)}`
        : "records" in which
          ? tx`b.entry_id = ANY(${[...which.records]}::uuid[]) AND ${notStarted(which.now)}`
          : tx`EXISTS (SELECT 1 FROM gym_class_sessions s
                     WHERE s.gym_id = b.gym_id AND s.id = b.session_id AND ${onMembership(tx, which)})`;
  const rows = await tx<{ user_id: string; session_id: string; was: string; charged: boolean; held_membership_id: string | null }[]>`
    WITH old AS (
      SELECT b.id, b.status, b.pack_charged, b.held_membership_id
      FROM gym_class_bookings b
      WHERE b.gym_id = ${gymId} AND ${chosen}
      FOR UPDATE
    )
    UPDATE gym_class_bookings b
    SET status = CASE WHEN old.status = 'late_cancelled' THEN 'late_cancelled' ELSE 'cancelled' END,
        cancelled_at = COALESCE(b.cancelled_at, ${at}), pack_charged = false
    FROM old
    WHERE b.id = old.id
    RETURNING b.user_id, b.session_id, old.status AS was, old.pack_charged AS charged, old.held_membership_id`;
  return rows.map((r) => ({
    userId: r.user_id,
    sessionId: r.session_id,
    was: classBookingStatusSchema.parse(r.was),
    packMembershipId: r.charged ? r.held_membership_id : null,
  }));
}

/** The bookings of classes that are being removed go with them. Only after `endBookings`
 *  has ended them and their packs have their classes back. */
export async function deleteBookingsOf(tx: TransactionSql, gymId: string, sessionIds: readonly string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  await tx`DELETE FROM gym_class_bookings WHERE gym_id = ${gymId} AND session_id = ANY(${[...sessionIds]}::uuid[])`;
}

/** Which classes a change would end the bookings of: one class, a time slot's coming
 *  classes (from a date, when the change has one), or every coming class of one kind. */
export type EndingScope = { by: "session"; id: string } | { by: "slot"; id: string; from: string | null } | { by: "class"; id: string };

/** The places booked on one held membership, in classes that have not started (marked
 *  came by a check-in before the start or not): all of them, or those on a day after
 *  `afterDay` (the membership's last day). Somebody
 *  waiting has no membership on their row yet, so no waitlist place is among them. */
export interface MembershipScope {
  membership: string;
  now: Date;
  afterDay: string | null;
}

const onMembership = (sql: SqlOrTx, m: MembershipScope) => sql`
  b.held_membership_id = ${m.membership} AND b.status IN ('booked','attended') AND s.starts_at > ${m.now}
  AND (${m.afterDay}::date IS NULL OR s.local_date > ${m.afterDay}::date)`;

export type EndingWhere = { sessionIds: readonly string[] } | { scope: EndingScope; now: Date } | MembershipScope;

const endingWhere = (sql: SqlOrTx, where: EndingWhere) => {
  if ("membership" in where) return onMembership(sql, where);
  if ("sessionIds" in where) return sql`s.id = ANY(${[...where.sessionIds]}::uuid[])`;
  const { scope, now } = where;
  if (scope.by === "session") return sql`s.id = ${scope.id}`;
  if (scope.by === "class") return sql`s.class_type_id = ${scope.id} AND s.starts_at > ${now}`;
  return sql`s.schedule_id = ${scope.id} AND s.starts_at > ${now} AND s.local_date >= COALESCE(${scope.from}::date, s.local_date)`;
};

/** The mark of no bookings at all: sha256 of nothing. */
const NO_BOOKINGS_MARK = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** BOOKINGS, not people: somebody booked on three of the classes is three. */
export interface EndingCounts {
  /** One value for exactly these bookings (their ids), so a box confirmed is confirmed
   *  for the bookings it named and no others. */
  mark: string;
  /** Classes with at least one booking that holds a place or waits. */
  classes: number;
  booked: number;
  waiting: number;
}

/** How many bookings hold a place or wait in those classes. */
export async function endingCounts(sql: SqlOrTx, gymId: string, where: EndingWhere): Promise<EndingCounts> {
  if ("sessionIds" in where && where.sessionIds.length === 0) return { classes: 0, booked: 0, waiting: 0, mark: NO_BOOKINGS_MARK };
  const rows = await sql<EndingCounts[]>`
    SELECT count(DISTINCT b.session_id)::int AS classes,
           count(*) FILTER (WHERE b.status <> 'waitlisted')::int AS booked,
           count(*) FILTER (WHERE b.status = 'waitlisted')::int AS waiting,
           encode(sha256(convert_to(coalesce(string_agg(b.id::text, ',' ORDER BY b.id), ''), 'UTF8')), 'hex') AS mark
    FROM gym_class_bookings b
    JOIN gym_class_sessions s ON s.gym_id = b.gym_id AND s.id = b.session_id
    WHERE b.gym_id = ${gymId} AND b.status IN ('booked','waitlisted','attended','no_show') AND ${endingWhere(sql, where)}`;
  return rows[0] ?? { classes: 0, booked: 0, waiting: 0, mark: NO_BOOKINGS_MARK };
}

export interface EndingPersonRow {
  bookingId: string;
  waiting: boolean;
  displayName: string;
  email: string | null;
  recordName: string | null;
  className: string;
  localDate: string;
  localStartMinute: number;
}

/** The bookings those counts are of, in the order they were made, a page at a time
 *  (`after`: the id of the last booking already shown; one this gym does not have
 *  answers nothing). `seq` is one counter for every gym and is never sent out. */
export async function endingPeople(sql: SqlOrTx, gymId: string, where: EndingWhere, after: string | null, limit: number): Promise<EndingPersonRow[]> {
  if ("sessionIds" in where && where.sessionIds.length === 0) return [];
  const rows = await sql<
    {
      id: string;
      status: string;
      display_name: string | null;
      email: string | null;
      record_name: string | null;
      name: string;
      local_date: string;
      local_start_minute: number;
    }[]
  >`
    SELECT b.id, b.status,
           CASE WHEN u.status = 'active' THEN u.display_name END AS display_name,
           CASE WHEN u.status = 'active' THEN u.email::text END AS email,
           nullif(btrim(e.full_name), '') AS record_name,
           t.name, s.local_date::text AS local_date, s.local_start_minute
    FROM gym_class_bookings b
    JOIN gym_class_sessions s ON s.gym_id = b.gym_id AND s.id = b.session_id
    JOIN gym_class_types t ON t.gym_id = s.gym_id AND t.id = s.class_type_id
    JOIN users u ON u.id = b.user_id
    LEFT JOIN gym_member_list_entries e ON e.gym_id = b.gym_id AND e.id = b.entry_id
    WHERE b.gym_id = ${gymId} AND b.status IN ('booked','waitlisted','attended','no_show') AND ${endingWhere(sql, where)}
      ${after === null ? sql`` : sql`AND b.seq > (SELECT c.seq FROM gym_class_bookings c WHERE c.gym_id = ${gymId} AND c.id = ${after})`}
    ORDER BY b.seq
    LIMIT ${limit}`;
  return rows.map((r) => ({
    bookingId: r.id,
    waiting: r.status === "waitlisted",
    displayName: r.display_name ?? "",
    email: r.email,
    recordName: r.record_name,
    className: r.name,
    localDate: r.local_date,
    localStartMinute: r.local_start_minute,
  }));
}

export interface BookingRules {
  settings: ClassBookingSettings;
  pt: PtBookingSettings;
}

/** The gym's four booking settings and personal training's two; null where there is no
 *  such gym. */
export async function readSettings(sql: SqlOrTx, gymId: string): Promise<BookingRules | null> {
  const rows = await sql<{ opens: number; free: number; handover: number; waitlist: number; pt_opens: number; pt_free: number }[]>`
    SELECT booking_opens_days AS opens, booking_free_cancel_minutes AS free,
           waitlist_handover_minutes AS handover, waitlist_max AS waitlist,
           pt_opens_days AS pt_opens, pt_free_cancel_minutes AS pt_free
    FROM gyms WHERE id = ${gymId}`;
  const r = rows[0];
  if (r === undefined) return null;
  return {
    settings: { opensDays: r.opens, freeCancelMinutes: r.free, handoverMinutes: r.handover, waitlistMax: r.waitlist },
    pt: { opensDays: r.pt_opens, freeCancelMinutes: r.pt_free },
  };
}

export async function writeSettings(tx: TransactionSql, gymId: string, { settings: s, pt }: BookingRules): Promise<void> {
  await tx`
    UPDATE gyms
    SET booking_opens_days = ${s.opensDays}, booking_free_cancel_minutes = ${s.freeCancelMinutes},
        waitlist_handover_minutes = ${s.handoverMinutes}, waitlist_max = ${s.waitlistMax},
        pt_opens_days = ${pt.opensDays}, pt_free_cancel_minutes = ${pt.freeCancelMinutes}
    WHERE id = ${gymId}`;
}

// ── CHECK-IN MEETS BOOKINGS (17f) ──

export interface MarkableBooking {
  id: string;
  status: ClassBookingStatus;
  cancelled: boolean;
  startsAt: Date;
  minutes: number;
}

const toMarkable = (r: { id: string; status: string; session_status: string; starts_at: Date; minutes: number }): MarkableBooking => ({
  id: r.id,
  status: classBookingStatusSchema.parse(r.status),
  cancelled: r.session_status === "cancelled",
  startsAt: r.starts_at,
  minutes: r.minutes,
});

/** THIS account's bookings of the gym's classes that start within a day either side of
 *  `now`: the ones a check-in now could be for, which the rule then chooses among.
 *  Found by the account alone, never by a record or a name. Never an online class: a
 *  check-in at the gym says nothing about who was on a video call. `lock`: held to the commit. */
export async function bookingsNear(sql: SqlOrTx, gymId: string, userId: string, now: Date, lock: boolean): Promise<MarkableBooking[]> {
  const rows = await sql<{ id: string; status: string; session_status: string; starts_at: Date; minutes: number }[]>`
    SELECT b.id, b.status, s.status AS session_status, s.starts_at, s.minutes
    FROM gym_class_sessions s
    JOIN gym_class_bookings b ON b.gym_id = s.gym_id AND b.session_id = s.id
    WHERE s.gym_id = ${gymId} AND b.user_id = ${userId} AND NOT s.online
      AND s.starts_at BETWEEN ${now}::timestamptz - interval '1 day' AND ${now}::timestamptz + interval '1 day'
    ${lock ? sql`FOR UPDATE OF b` : sql``}`;
  return rows.map(toMarkable);
}

/** One booking of one class of this gym, held to the commit; null where there is none. */
export async function bookingInClass(tx: TransactionSql, gymId: string, sessionId: string, bookingId: string): Promise<{ id: string; status: ClassBookingStatus } | null> {
  const rows = await tx<{ id: string; status: string }[]>`
    SELECT id, status FROM gym_class_bookings
    WHERE gym_id = ${gymId} AND session_id = ${sessionId} AND id = ${bookingId}
    FOR UPDATE`;
  const r = rows[0];
  return r === undefined ? null : { id: r.id, status: classBookingStatusSchema.parse(r.status) };
}

/** One booking of one class of this gym as a removal by staff reads it, held to the
 *  commit; null where there is none. */
export async function bookingToRemove(
  tx: TransactionSql,
  gymId: string,
  sessionId: string,
  bookingId: string,
): Promise<{ id: string; status: ClassBookingStatus; heldMembershipId: string | null; packCharged: boolean } | null> {
  const rows = await tx<{ id: string; status: string; held_membership_id: string | null; pack_charged: boolean }[]>`
    SELECT id, status, held_membership_id, pack_charged FROM gym_class_bookings
    WHERE gym_id = ${gymId} AND session_id = ${sessionId} AND id = ${bookingId}
    FOR UPDATE`;
  const r = rows[0];
  return r === undefined
    ? null
    : { id: r.id, status: classBookingStatusSchema.parse(r.status), heldMembershipId: r.held_membership_id, packCharged: r.pack_charged };
}

/** These bookings marked came or no-show: only places that are held, so a place given
 *  up in the meantime stays given up. The pack and the limit are not touched: both
 *  marks keep the class used. Answers how many changed. */
export async function markAs(tx: TransactionSql, gymId: string, ids: readonly string[], to: "attended" | "no_show", from: readonly ClassBookingStatus[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_class_bookings SET status = ${to}
    WHERE gym_id = ${gymId} AND id = ANY(${[...ids]}::uuid[]) AND status = ANY(${[...from]}::text[]) AND status <> ${to}
    RETURNING id`;
  return rows.length;
}

/** The gyms with a place still booked in a class that ended at least `afterMinutes` ago
 *  and started no more than `lookbackHours` (and a day) ago. `only`: of these gyms. */
export async function gymsWithEndedBooked(
  sql: SqlOrTx,
  now: Date,
  afterMinutes: number,
  lookbackHours: number,
  only: readonly string[] | null,
): Promise<string[]> {
  const rows = await sql<{ gym_id: string }[]>`
    SELECT DISTINCT s.gym_id
    FROM gym_class_sessions s
    WHERE s.status = 'scheduled' AND NOT s.online
      AND s.starts_at > ${now}::timestamptz - make_interval(hours => ${lookbackHours + 24})
      AND s.starts_at + make_interval(mins => s.minutes + ${afterMinutes}) <= ${now}::timestamptz
      AND EXISTS (SELECT 1 FROM gym_class_bookings b WHERE b.gym_id = s.gym_id AND b.session_id = s.id AND b.status = 'booked')
      ${only === null ? sql`` : sql`AND s.gym_id = ANY(${[...only]}::uuid[])`}
    ORDER BY s.gym_id`;
  return rows.map((r) => r.gym_id);
}

/** A visit `a` at the gym of class `s` on the class's day, or in the twelve hours before
 *  it starts (a class soon after midnight). Any kind of visit. */
const thatDay = (sql: SqlOrTx) => sql`
  a.gym_id = s.gym_id AND a.day BETWEEN s.local_date - 1 AND s.local_date
  AND (a.day = s.local_date OR a.marked_at BETWEEN s.starts_at - interval '12 hours' AND s.starts_at)`;

export interface EndedBooked extends MarkableBooking {
  /** A check-in inside the class's window: by the booking's own account, or only on a
   *  record the booking was made for or the person now holds. */
  visit: "account" | "record" | null;
  /** Their account or record has a visit of any kind at the gym on the class's day. */
  hereThatDay: boolean;
  /** The gym checked anybody in inside that window. */
  gymCheckedIn: boolean;
}

/** One gym's places still booked in classes that ended at least `afterMinutes` ago, each
 *  with the check-ins of its class's window (`beforeMinutes` before the start until the
 *  end), held to the commit. A check-in is a pass, a key tag or staff's own: a visit
 *  staff added for an earlier day has no hour of its own, and a member's own tap is
 *  nobody's word but theirs. A pass is its account's own word. A key tag's visit, or
 *  staff's, is the account's only where nobody else holds or has held its record: a
 *  record two people share names neither, and one of them showing a pass later that day
 *  is written onto the morning's visit (`joinVisits`) without having been at the class.
 *  A class nobody was checked in for is read once and its places' check-ins not at all: the rule
 *  leaves them whatever else is true, and such classes are most of what a run reads.
 *  `lock`: the places are held to the commit, for a write under the gym's lock. */
export async function endedBooked(
  tx: SqlOrTx,
  gymId: string,
  when: { now: Date; afterMinutes: number; beforeMinutes: number; lookbackHours: number },
  lock: boolean,
): Promise<EndedBooked[]> {
  const inWindow = tx`
    a.gym_id = s.gym_id AND a.method IN ('pass','key_tag','staff') AND a.slot_key <> 'added_later'
    AND a.day BETWEEN s.local_date - 1 AND s.local_date + 1
    AND a.marked_at BETWEEN s.starts_at - make_interval(mins => ${when.beforeMinutes}) AND s.starts_at + make_interval(mins => s.minutes)`;
  const rows = await tx<
    {
      id: string;
      status: string;
      session_status: string;
      starts_at: Date;
      minutes: number;
      by_account: boolean;
      by_record: boolean;
      here_that_day: boolean;
      gym_checked_in: boolean;
    }[]
  >`
    WITH s AS MATERIALIZED (
      SELECT s.id, s.gym_id, s.status, s.starts_at, s.minutes, s.local_date,
             EXISTS (SELECT 1 FROM gym_attendance a WHERE ${inWindow}) AS gym_checked_in
      FROM gym_class_sessions s
      WHERE s.gym_id = ${gymId} AND s.status = 'scheduled' AND NOT s.online
        AND s.starts_at > ${when.now}::timestamptz - make_interval(hours => ${when.lookbackHours + 24})
        AND s.starts_at + make_interval(mins => s.minutes + ${when.afterMinutes}) <= ${when.now}::timestamptz
    )
    SELECT b.id, b.status, s.status AS session_status, s.starts_at, s.minutes, s.gym_checked_in,
           (s.gym_checked_in AND EXISTS (
              SELECT 1 FROM gym_attendance a
              WHERE ${inWindow} AND a.user_id = b.user_id
                AND (a.method = 'pass' OR a.entry_id IS NULL OR NOT EXISTS (
                      SELECT 1 FROM gym_members o
                      WHERE o.gym_id = a.gym_id AND o.entry_id = a.entry_id AND o.user_id <> b.user_id)))) AS by_account,
           (s.gym_checked_in AND EXISTS (SELECT 1 FROM gym_attendance a WHERE ${inWindow} AND a.entry_id IN (b.entry_id, m.entry_id))) AS by_record,
           (s.gym_checked_in
            AND (EXISTS (SELECT 1 FROM gym_attendance a WHERE ${thatDay(tx)} AND a.user_id = b.user_id)
                 OR EXISTS (SELECT 1 FROM gym_attendance a WHERE ${thatDay(tx)} AND a.entry_id IN (b.entry_id, m.entry_id)))) AS here_that_day
    FROM s
    JOIN gym_class_bookings b ON b.gym_id = s.gym_id AND b.session_id = s.id AND b.status = 'booked'
    LEFT JOIN gym_members m ON m.gym_id = b.gym_id AND m.user_id = b.user_id AND m.removed_at IS NULL
    ${lock ? tx`FOR UPDATE OF b` : tx``}`;
  return rows.map((r) => ({
    ...toMarkable(r),
    visit: r.by_account ? "account" : r.by_record ? "record" : null,
    hereThatDay: r.here_that_day,
    gymCheckedIn: r.gym_checked_in,
  }));
}

/** A place a check-in marked came, in a class that has not started, is the booked place
 *  it was once the check-in no longer stands for it. Two cases, each under the gym's lock.
 *
 *  `visitOf`: staff removed a visit of this account (the wrong person was checked in):
 *  their places go back where no visit of theirs is left at the gym that day (`thatDay`).
 *  The day, not the window: a second scan the same day writes no visit of its own.
 *  `moved`: these classes' times may have changed: a place goes back where the class now
 *  starts more than `beforeMinutes` from `now`, so no check-in made so far is in its
 *  window. A class whose time did not change is never in that case: its place was marked
 *  inside the window, and the clock only goes forward.
 *  Answers how many places went back. */
export async function putBackToBooked(
  tx: TransactionSql,
  gymId: string,
  which: { visitOf: string } | { moved: readonly string[]; beforeMinutes: number },
  now: Date,
): Promise<number> {
  if ("moved" in which && which.moved.length === 0) return 0;
  const unfounded =
    "visitOf" in which
      ? tx`b.user_id = ${which.visitOf}
           AND NOT EXISTS (SELECT 1 FROM gym_attendance a WHERE ${thatDay(tx)} AND a.user_id = b.user_id)`
      : tx`s.id = ANY(${[...which.moved]}::uuid[]) AND s.starts_at - make_interval(mins => ${which.beforeMinutes}) > ${now}`;
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_class_bookings b SET status = 'booked'
    FROM gym_class_sessions s
    WHERE s.gym_id = b.gym_id AND s.id = b.session_id
      AND b.gym_id = ${gymId} AND b.status = 'attended' AND s.starts_at > ${now} AND ${unfounded}
    RETURNING b.id`;
  return rows.length;
}
