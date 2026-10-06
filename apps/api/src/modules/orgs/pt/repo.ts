// PERSONAL TRAINING: the only file that reads or writes a trainer's hours and the sessions
// booked with them (spec Part 3 §13.5; ROADMAP 17e-i).
//
// Every statement carries `gym_id`. Every write runs under the gym's row lock
// (`lockOrgRow`), the lock every timetable, member-list and membership write takes first,
// so a session is decided against hours, bookings and memberships nobody else is changing.
// Under that, the table's own EXCLUDE constraint refuses two sessions of one trainer that
// overlap; one person in two sessions at once is refused by the rule under the lock.
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import {
  CLASS_MINUTES_MAX,
  PT_HOLDS_TIME,
  PT_SESSION_MINUTES_MAX,
  ptAppointmentStatusSchema,
  ptHoursRangeSchema,
  ptSessionMinutesSchema,
  type PtAppointmentStatus,
  type PtHoursRange,
  type PtSessionMinutes,
  type PtSpan,
  type PtTime,
  type PtTimeOffSpan,
} from "@app/shared";

type SqlOrTx = Sql | TransactionSql;

export interface GymClock {
  timezone: string;
  freeCancelMinutes: number;
  /** Whether the gym has any membership type on its price list. */
  hasTypes: boolean;
}

export async function gymClock(sql: SqlOrTx, gymId: string): Promise<GymClock | null> {
  const rows = await sql<{ timezone: string; free: number; has_types: boolean }[]>`
    SELECT g.timezone, g.booking_free_cancel_minutes AS free,
           EXISTS (SELECT 1 FROM gym_membership_types mt WHERE mt.gym_id = g.id AND mt.archived_at IS NULL) AS has_types
    FROM gyms g WHERE g.id = ${gymId}`;
  const r = rows[0];
  return r === undefined ? null : { timezone: r.timezone, freeCancelMinutes: r.free, hasTypes: r.has_types };
}

export interface TrainerRow {
  userId: string;
  displayName: string;
  email: string | null;
  offers: boolean;
  sessionMinutes: PtSessionMinutes | null;
  hours: PtHoursRange[];
}

const rawTrainer = z.object({
  user_id: z.string(),
  display_name: z.string(),
  email: z.string().nullable(),
  offers: z.boolean().nullable(),
  session_minutes: ptSessionMinutesSchema.nullable(),
  hours: z.array(ptHoursRangeSchema),
});

/** The gym's staff, each with their personal-training hours; `onlyUserId` names one. A
 *  gym's staff are few, and a trainer has at most 21 ranges. */
export async function staffTrainers(sql: SqlOrTx, gymId: string, onlyUserId: string | null): Promise<TrainerRow[]> {
  const rows = await sql`
    SELECT st.user_id, u.display_name, u.email, t.offers, t.session_minutes,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object('weekday', h.weekday, 'fromMinute', h.from_minute, 'toMinute', h.to_minute)
                              ORDER BY h.weekday, h.from_minute)
             FROM gym_trainer_hours h WHERE h.gym_id = st.gym_id AND h.user_id = st.user_id
           ), '[]'::jsonb) AS hours
    FROM gym_staff st
    JOIN users u ON u.id = st.user_id
    LEFT JOIN gym_trainers t ON t.gym_id = st.gym_id AND t.user_id = st.user_id
    WHERE st.gym_id = ${gymId} AND (${onlyUserId}::uuid IS NULL OR st.user_id = ${onlyUserId}::uuid)
    ORDER BY lower(u.display_name), st.user_id`;
  return rows.map((row) => {
    const r = rawTrainer.parse(row);
    return {
      userId: r.user_id,
      displayName: r.display_name,
      email: r.email,
      offers: r.offers ?? false,
      sessionMinutes: r.session_minutes,
      hours: r.hours,
    };
  });
}

/** A trainer's hours replaced whole. The caller holds the gym's lock and has checked
 *  that the person is on the gym's staff. */
export async function saveTrainer(
  tx: TransactionSql,
  input: { gymId: string; userId: string; offers: boolean; sessionMinutes: number; hours: readonly PtHoursRange[]; now: Date },
): Promise<void> {
  await tx`
    INSERT INTO gym_trainers (gym_id, user_id, offers, session_minutes, updated_at)
    VALUES (${input.gymId}, ${input.userId}, ${input.offers}, ${input.sessionMinutes}, ${input.now})
    ON CONFLICT (gym_id, user_id) DO UPDATE
    SET offers = EXCLUDED.offers, session_minutes = EXCLUDED.session_minutes, updated_at = EXCLUDED.updated_at`;
  await tx`DELETE FROM gym_trainer_hours WHERE gym_id = ${input.gymId} AND user_id = ${input.userId}`;
  if (input.hours.length === 0) return;
  await tx`
    INSERT INTO gym_trainer_hours (gym_id, user_id, weekday, from_minute, to_minute)
    SELECT ${input.gymId}, ${input.userId}, h.weekday, h.from_minute, h.to_minute
    FROM unnest(${input.hours.map((h) => h.weekday)}::int[], ${input.hours.map((h) => h.fromMinute)}::int[],
                ${input.hours.map((h) => h.toMinute)}::int[]) AS h(weekday, from_minute, to_minute)`;
}

export interface TimedSlot extends PtTime {
  startsAtMs: number;
}

/** Each clock time as an instant in the gym's zone, in one statement. A time the gym's
 *  clock does not have on that day (the hour the clocks go forward over) is left out. */
export async function instantsOf(sql: SqlOrTx, timezone: string, times: readonly PtTime[]): Promise<TimedSlot[]> {
  if (times.length === 0) return [];
  const rows = await sql<{ day: string; minute: number; starts_at: Date }[]>`
    SELECT c.day::text AS day, c.minute, s.starts_at
    FROM unnest(${times.map((t) => t.localDate)}::date[], ${times.map((t) => t.startMinute)}::int[]) AS c(day, minute)
    CROSS JOIN LATERAL (SELECT (c.day + make_interval(mins => c.minute)) AT TIME ZONE ${timezone} AS starts_at) s
    WHERE (s.starts_at AT TIME ZONE ${timezone}) = (c.day + make_interval(mins => c.minute))
    ORDER BY s.starts_at`;
  return rows.map((r) => ({ localDate: r.day, startMinute: r.minute, startsAtMs: r.starts_at.getTime() }));
}

/** The time a trainer, or a person, is already booked for between two instants. */
export async function takenBy(
  sql: SqlOrTx,
  gymId: string,
  who: { trainerId: string } | { entryId: string },
  from: Date,
  to: Date,
): Promise<PtSpan[]> {
  const rows = await sql<{ starts_at: Date; ends_at: Date }[]>`
    SELECT starts_at, ends_at FROM gym_pt_appointments
    WHERE gym_id = ${gymId}
      AND ${"trainerId" in who ? sql`trainer_user_id = ${who.trainerId}` : sql`entry_id = ${who.entryId}`}
      AND status = ANY(${[...PT_HOLDS_TIME]}::text[])
      AND starts_at < ${to} AND ends_at > ${from}`;
  return rows.map((r) => ({ fromMs: r.starts_at.getTime(), toMs: r.ends_at.getTime() }));
}

export interface AppointmentRow {
  id: string;
  trainerId: string | null;
  entryId: string | null;
  heldMembershipId: string | null;
  localDate: string;
  localStartMinute: number;
  minutes: number;
  startsAt: Date;
  status: PtAppointmentStatus;
  packCharged: boolean;
  personName: string | null;
  membership: string | null;
}

const rawAppointment = z.object({
  id: z.string(),
  trainer_user_id: z.string().nullable(),
  entry_id: z.string().nullable(),
  held_membership_id: z.string().nullable(),
  local_date: z.string(),
  local_start_minute: z.number().int(),
  minutes: z.number().int(),
  starts_at: z.date(),
  status: ptAppointmentStatusSchema,
  pack_charged: z.boolean(),
  person_name: z.string().nullable(),
  membership: z.string().nullable(),
});

function toAppointment(row: unknown): AppointmentRow {
  const r = rawAppointment.parse(row);
  return {
    id: r.id,
    trainerId: r.trainer_user_id,
    entryId: r.entry_id,
    heldMembershipId: r.held_membership_id,
    localDate: r.local_date,
    localStartMinute: r.local_start_minute,
    minutes: r.minutes,
    startsAt: r.starts_at,
    status: r.status,
    packCharged: r.pack_charged,
    personName: r.person_name,
    membership: r.membership,
  };
}

const APPOINTMENT = (sql: SqlOrTx) => sql`
  a.id, a.trainer_user_id, a.entry_id, a.held_membership_id, a.local_date::text AS local_date, a.local_start_minute,
  a.minutes, a.starts_at, a.status, a.pack_charged, e.full_name AS person_name,
  (SELECT mt.name FROM gym_held_memberships h
   JOIN gym_membership_types mt ON mt.gym_id = h.gym_id AND mt.id = h.membership_type_id
   WHERE h.gym_id = a.gym_id AND h.id = a.held_membership_id) AS membership`;

const FROM = (sql: SqlOrTx) => sql`
  FROM gym_pt_appointments a
  LEFT JOIN gym_member_list_entries e ON e.gym_id = a.gym_id AND e.id = a.entry_id`;

/** One trainer's sessions that hold their time on these days of the gym's, the earliest first. */
export async function appointmentsOf(sql: SqlOrTx, gymId: string, trainerId: string, fromDay: string, toDay: string): Promise<AppointmentRow[]> {
  const rows = await sql`
    SELECT ${APPOINTMENT(sql)} ${FROM(sql)}
    WHERE a.gym_id = ${gymId} AND a.trainer_user_id = ${trainerId}
      AND a.status = ANY(${[...PT_HOLDS_TIME]}::text[])
      AND a.local_date BETWEEN ${fromDay}::date AND ${toDay}::date
    ORDER BY a.starts_at, a.id`;
  return rows.map(toAppointment);
}

/** One session of this gym, or null. `lock`: held until the transaction ends. */
export async function appointmentById(sql: SqlOrTx, gymId: string, id: string, lock: boolean): Promise<AppointmentRow | null> {
  const rows = await sql`
    SELECT ${APPOINTMENT(sql)} ${FROM(sql)}
    WHERE a.gym_id = ${gymId} AND a.id = ${id}
    ${lock ? sql`FOR UPDATE OF a` : sql``}`;
  const row = rows[0];
  return row === undefined ? null : toAppointment(row);
}

/** The session a request made, if it has made one. */
export async function byKey(sql: SqlOrTx, gymId: string, requestKey: string): Promise<AppointmentRow | null> {
  const rows = await sql`
    SELECT ${APPOINTMENT(sql)} ${FROM(sql)}
    WHERE a.gym_id = ${gymId} AND a.request_key = ${requestKey}`;
  const row = rows[0];
  return row === undefined ? null : toAppointment(row);
}

/** A person on the gym's list now: not a past member's record. */
export async function currentEntry(sql: SqlOrTx, gymId: string, entryId: string): Promise<{ fullName: string } | null> {
  const rows = await sql<{ full_name: string }[]>`
    SELECT full_name FROM gym_member_list_entries
    WHERE gym_id = ${gymId} AND id = ${entryId} AND former_at IS NULL`;
  const r = rows[0];
  return r === undefined ? null : { fullName: r.full_name };
}

/** Postgres's code for a row an EXCLUDE constraint refused. */
const EXCLUSION_VIOLATION = "23P01";

/** A session booked. Null where the table itself refused it: the trainer already has one
 *  that overlaps. */
export async function insertAppointment(
  tx: TransactionSql,
  input: {
    gymId: string;
    trainerId: string;
    entryId: string;
    heldMembershipId: string | null;
    localDate: string;
    startMinute: number;
    startsAt: Date;
    minutes: number;
    packCharged: boolean;
    requestKey: string;
    bookedBy: string;
    now: Date;
  },
): Promise<string | null> {
  try {
    const rows = await tx.savepoint(
      (sp) => sp<{ id: string }[]>`
        INSERT INTO gym_pt_appointments
          (gym_id, trainer_user_id, entry_id, held_membership_id, local_date, local_start_minute, starts_at, ends_at, minutes,
           status, pack_charged, request_key, booked_by, created_at)
        VALUES (${input.gymId}, ${input.trainerId}, ${input.entryId}, ${input.heldMembershipId}, ${input.localDate}::date,
                ${input.startMinute}, ${input.startsAt}, ${new Date(input.startsAt.getTime() + input.minutes * 60_000)}, ${input.minutes},
                'booked', ${input.packCharged}, ${input.requestKey}, ${input.bookedBy}, ${input.now})
        RETURNING id`,
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("a session's insert returned no row");
    return id;
  } catch (err) {
    if (z.object({ code: z.literal(EXCLUSION_VIOLATION) }).safeParse(err).success) return null;
    throw err;
  }
}

export async function markCancelled(
  tx: TransactionSql,
  input: { gymId: string; id: string; status: "cancelled" | "late_cancelled"; packCharged: boolean; now: Date },
): Promise<void> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_pt_appointments
    SET status = ${input.status}, cancelled_at = ${input.now}, pack_charged = ${input.packCharged}
    WHERE gym_id = ${input.gymId} AND id = ${input.id} AND status = 'booked'
    RETURNING id`;
  if (rows.length !== 1) throw new Error("a session was not there to cancel");
}

export interface PersonRow {
  entryId: string;
  fullName: string;
}

/** People on the gym's list now whose name or email holds `query` (everybody for an empty
 *  one). Those holding anything in use whose type includes personal training come first
 *  (a pack with nothing left, or past its days on `day`, does not count), then by name:
 *  an order only, so the page of people is the likely ones. What each of
 *  them can be booked on is the booking rule's to say, never this statement's. */
export async function peopleFor(sql: SqlOrTx, gymId: string, query: string, day: string, limit: number): Promise<PersonRow[]> {
  // `%`, `_` and `\` typed by staff are letters to look for, not patterns.
  const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await sql<{ id: string; full_name: string }[]>`
    SELECT e.id, e.full_name
    FROM gym_member_list_entries e
    WHERE e.gym_id = ${gymId} AND e.former_at IS NULL
      AND (${query} = '' OR e.full_name ILIKE ${like} OR e.email ILIKE ${like})
    ORDER BY NOT EXISTS (
               SELECT 1 FROM gym_held_memberships h
               JOIN gym_membership_types mt ON mt.gym_id = h.gym_id AND mt.id = h.membership_type_id
               WHERE h.gym_id = e.gym_id AND h.entry_id = e.id AND h.status IN ('active','frozen') AND mt.includes_pt
                 AND NOT (h.kind = 'pack' AND (h.classes_left = 0 OR h.starts_on + h.pack_days + h.frozen_days < ${day}::date))),
             lower(e.full_name), e.id
    LIMIT ${limit}`;
  return rows.map((r) => ({ entryId: r.id, fullName: r.full_name }));
}
export interface CoachedClass {
  name: string;
  localDate: string;
  localStartMinute: number;
  minutes: number;
  fromMs: number;
  toMs: number;
}

/** The taught classes a member of staff coaches on these days of the gym's (and the day
 *  before, for one that runs past midnight): not cancelled, and not an open-gym slot,
 *  during which a trainer gives sessions like anybody else. The earliest first. */
export async function classesCoached(
  sql: SqlOrTx,
  gymId: string,
  trainerId: string,
  timezone: string,
  fromDay: string,
  toDay: string,
): Promise<CoachedClass[]> {
  const rows = await sql<{ name: string; local_date: string; local_start_minute: number; minutes: number; starts_at: Date }[]>`
    SELECT t.name, s.local_date::text AS local_date, s.local_start_minute, s.minutes, s.starts_at
    FROM gym_class_sessions s
    JOIN gym_class_types t ON t.id = s.class_type_id AND t.gym_id = s.gym_id
    WHERE s.gym_id = ${gymId} AND s.coach_user_id = ${trainerId} AND s.status = 'scheduled' AND NOT t.open_gym
      AND s.starts_at >= ((${fromDay}::date - 1)::timestamp AT TIME ZONE ${timezone})
      AND s.starts_at < ((${toDay}::date + 1)::timestamp AT TIME ZONE ${timezone})
    ORDER BY s.starts_at, s.id`;
  return rows.map((r) => ({
    name: r.name,
    localDate: r.local_date,
    localStartMinute: r.local_start_minute,
    minutes: r.minutes,
    fromMs: r.starts_at.getTime(),
    toMs: r.starts_at.getTime() + r.minutes * 60_000,
  }));
}

/** The running time slots this member of staff coaches: the ones whose classes take their
 *  time, for a booking at the calendar's far edge to write first. */
export async function coachedSlotIds(sql: SqlOrTx, gymId: string, trainerId: string): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT s.id FROM gym_class_schedules s
    JOIN gym_class_types t ON t.id = s.class_type_id AND t.gym_id = s.gym_id
    WHERE s.gym_id = ${gymId} AND s.coach_user_id = ${trainerId} AND s.ended_at IS NULL AND t.archived_at IS NULL`;
  return rows.map((r) => r.id);
}

export interface SessionUnderClass {
  appointmentId: string;
  trainerName: string;
  trainerEmail: string | null;
  personName: string | null;
  localDate: string;
  localStartMinute: number;
  minutes: number;
  className: string;
  /** The class's own row on the calendar. */
  classId: string;
}

/** The sessions booked with these trainers, not yet over, that a taught class they coach
 *  runs into: one row a session and class, the earliest session first. The other side of
 *  `classesCoached`, for the timetable to ask before it puts a class over one (17e-iii-a).
 *  The calendar is walked by the gym's own index; each class looks up the trainer's sessions
 *  near its time. */
export async function sessionsUnderClasses(sql: SqlOrTx, gymId: string, trainerIds: readonly string[], now: Date): Promise<SessionUnderClass[]> {
  if (trainerIds.length === 0) return [];
  const rows = await sql<
    {
      id: string;
      trainer_name: string;
      trainer_email: string | null;
      person_name: string | null;
      local_date: string;
      local_start_minute: number;
      minutes: number;
      class_name: string;
      class_id: string;
    }[]
  >`
    SELECT a.id, u.display_name AS trainer_name, u.email AS trainer_email, e.full_name AS person_name,
           a.local_date::text AS local_date, a.local_start_minute, a.minutes,
           t.name AS class_name, s.id AS class_id
    FROM gym_class_sessions s
    JOIN gym_class_types t ON t.id = s.class_type_id AND t.gym_id = s.gym_id AND NOT t.open_gym
    JOIN gym_pt_appointments a
      ON a.gym_id = s.gym_id AND a.trainer_user_id = s.coach_user_id
     AND a.status = ANY(${[...PT_HOLDS_TIME]}::text[])
     AND a.starts_at < s.starts_at + make_interval(mins => s.minutes)
     AND a.starts_at > s.starts_at - make_interval(mins => ${PT_SESSION_MINUTES_MAX}::int)
     AND a.ends_at > s.starts_at
     AND a.ends_at > ${now}
    JOIN users u ON u.id = a.trainer_user_id
    LEFT JOIN gym_member_list_entries e ON e.gym_id = a.gym_id AND e.id = a.entry_id
    WHERE s.gym_id = ${gymId} AND s.coach_user_id = ANY(${[...trainerIds]}::uuid[]) AND s.status = 'scheduled'
      AND s.starts_at > ${now}::timestamptz - make_interval(mins => ${CLASS_MINUTES_MAX}::int)
    ORDER BY a.starts_at, a.id, s.starts_at, s.id`;
  return rows.map((r) => ({
    appointmentId: r.id,
    trainerName: r.trainer_name,
    trainerEmail: r.trainer_email,
    personName: r.person_name,
    localDate: r.local_date,
    localStartMinute: r.local_start_minute,
    minutes: r.minutes,
    className: r.class_name,
    classId: r.class_id,
  }));
}

// ── A TRAINER'S TIME OFF (17e-iii-b) ──

export interface TimeOffRow extends PtTimeOffSpan {
  id: string;
  userId: string;
  fromMs: number;
  toMs: number;
}

interface RawTimeOff {
  id: string;
  user_id: string;
  from_date: string;
  to_date: string;
  from_minute: number | null;
  to_minute: number | null;
  starts_at: Date;
  ends_at: Date;
}

const toTimeOff = (r: RawTimeOff): TimeOffRow => ({
  id: r.id,
  userId: r.user_id,
  fromDate: r.from_date,
  toDate: r.to_date,
  fromMinute: r.from_minute,
  toMinute: r.to_minute,
  fromMs: r.starts_at.getTime(),
  toMs: r.ends_at.getTime(),
});

const TIME_OFF = (sql: SqlOrTx) => sql`
  o.id, o.user_id, o.from_date::text AS from_date, o.to_date::text AS to_date, o.from_minute, o.to_minute, o.starts_at, o.ends_at`;

/** The time off, not over at `now`, of the gym's trainers (`onlyUserId` names one), the
 *  earliest first. */
export async function timeOffComing(sql: SqlOrTx, gymId: string, onlyUserId: string | null, now: Date): Promise<TimeOffRow[]> {
  const rows = await sql<RawTimeOff[]>`
    SELECT ${TIME_OFF(sql)} FROM gym_trainer_time_off o
    WHERE o.gym_id = ${gymId} AND (${onlyUserId}::uuid IS NULL OR o.user_id = ${onlyUserId}::uuid) AND o.ends_at > ${now}
    ORDER BY o.starts_at, o.id`;
  return rows.map(toTimeOff);
}

/** One trainer's time off that touches these days of the gym's. */
export async function timeOffOn(sql: SqlOrTx, gymId: string, trainerId: string, fromDay: string, toDay: string): Promise<TimeOffRow[]> {
  const rows = await sql<RawTimeOff[]>`
    SELECT ${TIME_OFF(sql)} FROM gym_trainer_time_off o
    WHERE o.gym_id = ${gymId} AND o.user_id = ${trainerId} AND o.from_date <= ${toDay}::date AND o.to_date >= ${fromDay}::date
    ORDER BY o.starts_at, o.id`;
  return rows.map(toTimeOff);
}

/** The time off a request made, if it has made one. */
export async function timeOffByKey(sql: SqlOrTx, gymId: string, requestKey: string): Promise<TimeOffRow | null> {
  const rows = await sql<RawTimeOff[]>`
    SELECT ${TIME_OFF(sql)} FROM gym_trainer_time_off o WHERE o.gym_id = ${gymId} AND o.request_key = ${requestKey}`;
  const row = rows[0];
  return row === undefined ? null : toTimeOff(row);
}

/** A time off as two instants in the gym's zone: whole days run from the first midnight to
 *  the midnight after the last. `onTheClock`: the end comes after the start, and for hours
 *  of one day both times are ones the gym's clock has on it (the hour the clocks go
 *  forward over is not, and Postgres would read it as the hour after). */
export async function timeOffInstants(sql: SqlOrTx, timezone: string, off: PtTimeOffSpan): Promise<{ from: Date; to: Date; onTheClock: boolean }> {
  const rows = await sql<{ starts_at: Date; ends_at: Date; start_real: boolean; end_real: boolean }[]>`
    SELECT i.starts_at, i.ends_at,
           (i.starts_at AT TIME ZONE ${timezone}) = c.starts AS start_real,
           (i.ends_at AT TIME ZONE ${timezone}) = c.ends AS end_real
    FROM (SELECT ${off.fromDate}::date + make_interval(mins => ${off.fromMinute ?? 0}::int) AS starts,
                 ${off.toDate}::date + make_interval(mins => ${off.toMinute ?? 1440}::int) AS ends) c
    CROSS JOIN LATERAL (SELECT c.starts AT TIME ZONE ${timezone} AS starts_at, c.ends AT TIME ZONE ${timezone} AS ends_at) i`;
  const r = rows[0];
  if (r === undefined) throw new Error("a time off had no instants");
  const wholeDays = off.fromMinute === null || off.toMinute === null;
  return { from: r.starts_at, to: r.ends_at, onTheClock: r.ends_at.getTime() > r.starts_at.getTime() && (wholeDays || (r.start_real && r.end_real)) };
}

/** Works out again the two instants of every time off of a gym from its own days and
 *  times, in the zone the gym has now: called in the step that changes the zone, so a day
 *  off goes on being that day on the gym's clock. One whose times the new zone's clock
 *  would put out of order keeps the instants it had. */
export async function reworkTimeOffInstants(tx: TransactionSql, gymId: string): Promise<void> {
  await tx`
    UPDATE gym_trainer_time_off o SET starts_at = t.starts_at, ends_at = t.ends_at
    FROM (
      SELECT x.id,
             ((x.from_date + make_interval(mins => COALESCE(x.from_minute, 0))) AT TIME ZONE g.timezone) AS starts_at,
             ((x.to_date + make_interval(mins => COALESCE(x.to_minute, 1440))) AT TIME ZONE g.timezone) AS ends_at
      FROM gym_trainer_time_off x JOIN gyms g ON g.id = x.gym_id
      WHERE x.gym_id = ${gymId}
    ) t
    WHERE o.gym_id = ${gymId} AND o.id = t.id AND t.ends_at > t.starts_at`;
}

/** A time off written. The caller holds the gym's lock and has checked the trainer. */
export async function insertTimeOff(
  tx: TransactionSql,
  input: { gymId: string; userId: string; off: PtTimeOffSpan; from: Date; to: Date; requestKey: string; createdBy: string; now: Date },
): Promise<string> {
  const rows = await tx<{ id: string }[]>`
    INSERT INTO gym_trainer_time_off (gym_id, user_id, from_date, to_date, from_minute, to_minute, starts_at, ends_at, request_key, created_by, created_at)
    VALUES (${input.gymId}, ${input.userId}, ${input.off.fromDate}::date, ${input.off.toDate}::date, ${input.off.fromMinute}, ${input.off.toMinute},
            ${input.from}, ${input.to}, ${input.requestKey}, ${input.createdBy}, ${input.now})
    RETURNING id`;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("a time off's insert returned no row");
  return id;
}

/** One time off of this trainer's removed; false where it was not there. */
export async function deleteTimeOff(tx: TransactionSql, gymId: string, userId: string, id: string): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    DELETE FROM gym_trainer_time_off WHERE gym_id = ${gymId} AND user_id = ${userId} AND id = ${id} RETURNING id`;
  return rows.length > 0;
}

export interface InTimeOff {
  id: string;
  name: string | null;
  localDate: string;
  localStartMinute: number;
  minutes: number;
}

/** The sessions booked with a trainer, not over at `now`, that run into a span of time: the
 *  earliest first. */
export async function sessionsInSpan(sql: SqlOrTx, gymId: string, trainerId: string, from: Date, to: Date, now: Date): Promise<InTimeOff[]> {
  const rows = await sql<{ id: string; name: string | null; local_date: string; local_start_minute: number; minutes: number }[]>`
    SELECT a.id, e.full_name AS name, a.local_date::text AS local_date, a.local_start_minute, a.minutes
    FROM gym_pt_appointments a
    LEFT JOIN gym_member_list_entries e ON e.gym_id = a.gym_id AND e.id = a.entry_id
    WHERE a.gym_id = ${gymId} AND a.trainer_user_id = ${trainerId}
      AND a.status = ANY(${[...PT_HOLDS_TIME]}::text[])
      AND a.starts_at < ${to} AND a.ends_at > ${from} AND a.ends_at > ${now}
    ORDER BY a.starts_at, a.id`;
  return rows.map((r) => ({ id: r.id, name: r.name, localDate: r.local_date, localStartMinute: r.local_start_minute, minutes: r.minutes }));
}

/** The taught classes on the calendar a member of staff coaches, not over at `now`, that
 *  run into a span of time: as `classesCoached` counts them, the earliest first. */
export async function classesInSpan(sql: SqlOrTx, gymId: string, trainerId: string, from: Date, to: Date, now: Date): Promise<InTimeOff[]> {
  const rows = await sql<{ id: string; name: string; local_date: string; local_start_minute: number; minutes: number }[]>`
    SELECT s.id, t.name, s.local_date::text AS local_date, s.local_start_minute, s.minutes
    FROM gym_class_sessions s
    JOIN gym_class_types t ON t.id = s.class_type_id AND t.gym_id = s.gym_id
    WHERE s.gym_id = ${gymId} AND s.coach_user_id = ${trainerId} AND s.status = 'scheduled' AND NOT t.open_gym
      AND s.starts_at < ${to}
      AND s.starts_at > ${from}::timestamptz - make_interval(mins => ${CLASS_MINUTES_MAX}::int)
      AND s.starts_at + make_interval(mins => s.minutes) > GREATEST(${from}::timestamptz, ${now}::timestamptz)
    ORDER BY s.starts_at, s.id`;
  return rows.map((r) => ({ id: r.id, name: r.name, localDate: r.local_date, localStartMinute: r.local_start_minute, minutes: r.minutes }));
}
