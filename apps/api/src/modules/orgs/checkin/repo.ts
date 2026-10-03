// Check-in's reads and writes (spec Part 3 §12; ROADMAP 16a). Every statement names its
// gym in the WHERE, and a device is found by its key's hash alone and then knows its gym.
import type { Sql, TransactionSql } from "postgres";
import {
  CHECKIN_DEVICES_MAX,
  gymAttendanceMethodSchema,
  gymClockFormatSchema,
  type GymAttendanceMethod,
  type GymClockFormat,
} from "@app/shared";
import { readAttendanceContext } from "../repo.js";
import type { ScanPeriod, VisitToday } from "./scanRule.js";

type SqlOrTx = Sql | TransactionSql;

export interface DeviceRow {
  id: string;
  name: string;
  state: "waiting" | "on" | "off";
  linkExpiresAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
}

interface RawDevice {
  id: string;
  name: string;
  state: string;
  link_expires_at: Date | null;
  last_seen_at: Date | null;
  created_at: Date;
}

const toDevice = (row: RawDevice): DeviceRow => ({
  id: row.id,
  name: row.name,
  state: row.state === "on" ? "on" : row.state === "waiting" ? "waiting" : "off",
  linkExpiresAt: row.state === "waiting" ? row.link_expires_at : null,
  lastSeenAt: row.last_seen_at,
  createdAt: row.created_at,
});

/** A device's state, worked out by the database's clock in each statement below: a link
 *  that ran out unopened leaves the device off. */

export async function devicesFor(sql: SqlOrTx, gymId: string): Promise<DeviceRow[]> {
  const rows = await sql<RawDevice[]>`
    SELECT id, name, CASE WHEN switched_off_at IS NOT NULL THEN 'off' WHEN key_hash IS NOT NULL THEN 'on' WHEN link_expires_at > now() THEN 'waiting' ELSE 'off' END AS state,
           link_expires_at, last_seen_at, created_at
    FROM gym_checkin_devices
    WHERE gym_id = ${gymId}
    ORDER BY created_at, id
    LIMIT ${CHECKIN_DEVICES_MAX}`;
  return rows.map(toDevice);
}

/** The gym's devices are counted under the gym's lock, so two adds cannot pass the cap together. */
export async function countDevices(tx: TransactionSql, gymId: string): Promise<number> {
  const rows = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_checkin_devices WHERE gym_id = ${gymId}`;
  return rows[0]?.n ?? 0;
}

export async function insertDevice(
  tx: TransactionSql,
  input: { gymId: string; name: string; linkHash: string; linkMinutes: number; createdBy: string },
): Promise<DeviceRow> {
  const rows = await tx<RawDevice[]>`
    INSERT INTO gym_checkin_devices (gym_id, name, link_hash, link_expires_at, created_by_user_id)
    VALUES (${input.gymId}, ${input.name}, ${input.linkHash},
            now() + make_interval(mins => ${input.linkMinutes}), ${input.createdBy})
    RETURNING id, name, CASE WHEN switched_off_at IS NOT NULL THEN 'off' WHEN key_hash IS NOT NULL THEN 'on' WHEN link_expires_at > now() THEN 'waiting' ELSE 'off' END AS state, link_expires_at, last_seen_at, created_at`;
  const row = rows[0];
  if (row === undefined) throw new Error("adding a check-in device returned no row");
  return toDevice(row);
}

/** How long after a link is made a second one for the same device is refused. */
const LINK_JUST_MADE_SECONDS = 10;

/** A new link: the key the device held stops working at once, and a device switched off
 *  is on again once the link is opened. `just_made` when a link made in the last few
 *  seconds is still waiting: the row's own lock decides between two presses at once. */
export async function renewLink(
  tx: TransactionSql,
  input: { gymId: string; deviceId: string; linkHash: string; linkMinutes: number },
): Promise<DeviceRow | "just_made" | null> {
  const rows = await tx<RawDevice[]>`
    UPDATE gym_checkin_devices
    SET key_hash = NULL, switched_off_at = NULL, link_hash = ${input.linkHash},
        link_expires_at = now() + make_interval(mins => ${input.linkMinutes})
    WHERE gym_id = ${input.gymId} AND id = ${input.deviceId}
      AND NOT (link_hash IS NOT NULL
               AND link_expires_at > now() + make_interval(mins => ${input.linkMinutes}) - make_interval(secs => ${LINK_JUST_MADE_SECONDS}))
    RETURNING id, name, CASE WHEN switched_off_at IS NOT NULL THEN 'off' WHEN key_hash IS NOT NULL THEN 'on' WHEN link_expires_at > now() THEN 'waiting' ELSE 'off' END AS state, link_expires_at, last_seen_at, created_at`;
  const row = rows[0];
  if (row !== undefined) return toDevice(row);
  const there = await tx`SELECT 1 FROM gym_checkin_devices WHERE gym_id = ${input.gymId} AND id = ${input.deviceId}`;
  return there.length === 0 ? null : "just_made";
}

/** Switched off: its key and any open link stop working in the same statement. Doing it
 *  twice leaves the first time it was switched off. */
export async function switchOff(tx: TransactionSql, gymId: string, deviceId: string): Promise<DeviceRow | null> {
  const rows = await tx<RawDevice[]>`
    UPDATE gym_checkin_devices
    SET key_hash = NULL, link_hash = NULL, link_expires_at = NULL,
        switched_off_at = COALESCE(switched_off_at, now())
    WHERE gym_id = ${gymId} AND id = ${deviceId}
    RETURNING id, name, CASE WHEN switched_off_at IS NOT NULL THEN 'off' WHEN key_hash IS NOT NULL THEN 'on' WHEN link_expires_at > now() THEN 'waiting' ELSE 'off' END AS state, link_expires_at, last_seen_at, created_at`;
  const row = rows[0];
  return row === undefined ? null : toDevice(row);
}

/** The tablet opens its link: in one statement the link is used up and the key written,
 *  so a link opened twice at once gives one device a key. Only an open gym's link works. */
export async function claimLink(
  sql: Sql,
  linkHash: string,
  keyHash: string,
): Promise<{ gymName: string; deviceName: string } | null> {
  const rows = await sql<{ gym_name: string; device_name: string }[]>`
    UPDATE gym_checkin_devices d
    SET key_hash = ${keyHash}, link_hash = NULL, link_expires_at = NULL, last_seen_at = now()
    FROM gyms g
    WHERE d.link_hash = ${linkHash} AND d.link_expires_at > now() AND d.switched_off_at IS NULL
      AND g.id = d.gym_id AND g.status = 'active'
    RETURNING g.name AS gym_name, d.name AS device_name`;
  const row = rows[0];
  return row === undefined ? null : { gymName: row.gym_name, deviceName: row.device_name };
}

export interface DeskDevice {
  deviceId: string;
  gymId: string;
  gymName: string;
  timezone: string;
  clockFormat: GymClockFormat;
}

/** The device a key belongs to, if it is switched on and its gym is open. */
export async function deviceByKey(sql: SqlOrTx, keyHash: string): Promise<DeskDevice | null> {
  const rows = await sql<{ id: string; gym_id: string; gym_name: string; timezone: string; clock_format: string }[]>`
    SELECT d.id, d.gym_id, g.name AS gym_name, g.timezone, g.clock_format
    FROM gym_checkin_devices d
    JOIN gyms g ON g.id = d.gym_id
    WHERE d.key_hash = ${keyHash} AND d.switched_off_at IS NULL AND g.status = 'active'`;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    deviceId: row.id,
    gymId: row.gym_id,
    gymName: row.gym_name,
    timezone: row.timezone,
    clockFormat: gymClockFormatSchema.parse(row.clock_format),
  };
}

/** "Last seen", written at most once a minute. */
export async function touchDevice(sql: SqlOrTx, gymId: string, deviceId: string): Promise<void> {
  await sql`
    UPDATE gym_checkin_devices SET last_seen_at = now()
    WHERE gym_id = ${gymId} AND id = ${deviceId}
      AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 minute')`;
}

// ── WHO A READ NAMES ──

export interface RecordWords {
  id: string;
  fullName: string;
  status: string | null;
  payment: string | null;
}

interface RawRecord {
  id: string;
  full_name: string;
  status: string | null;
  payment_status: string | null;
}

const toRecord = (row: RawRecord): RecordWords => ({
  id: row.id,
  fullName: row.full_name,
  status: row.status,
  payment: row.payment_status,
});

export async function recordWords(sql: SqlOrTx, gymId: string, entryId: string): Promise<RecordWords | null> {
  const rows = await sql<RawRecord[]>`
    SELECT id, full_name, status, payment_status FROM gym_member_list_entries
    WHERE gym_id = ${gymId} AND id = ${entryId}`;
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export interface FoundRecord extends RecordWords {
  memberNumber: string | null;
  email: string | null;
  phone: string | null;
}

interface RawFoundRecord extends RawRecord {
  member_number: string | null;
  email: string | null;
  phone_e164: string | null;
}

const toFound = (row: RawFoundRecord): FoundRecord => ({
  ...toRecord(row),
  memberNumber: row.member_number,
  email: row.email,
  phone: row.phone_e164,
});

/** One of the gym's CURRENT records, by id: a former record lets nobody in. */
export async function currentRecord(sql: SqlOrTx, gymId: string, entryId: string): Promise<FoundRecord | null> {
  const rows = await sql<RawFoundRecord[]>`
    SELECT id, full_name, status, payment_status, member_number, email::text AS email, phone_e164
    FROM gym_member_list_entries
    WHERE gym_id = ${gymId} AND id = ${entryId} AND former_at IS NULL`;
  const row = rows[0];
  return row === undefined ? null : toFound(row);
}

/** The gym's current records a search finds, by what the box names: name, member number,
 *  and email. The email is matched and sent only for staff who keep the list (`withEmail`). */
export async function recordsLike(
  sql: SqlOrTx,
  gymId: string,
  like: string,
  limit: number,
  withEmail: boolean,
): Promise<FoundRecord[]> {
  const rows = await sql<RawFoundRecord[]>`
    SELECT id, full_name, status, payment_status, member_number,
           CASE WHEN ${withEmail} THEN email::text END AS email, phone_e164
    FROM gym_member_list_entries
    WHERE gym_id = ${gymId} AND former_at IS NULL
      AND (full_name ILIKE ${like}
           OR (${withEmail} AND email::text ILIKE ${like})
           OR coalesce(member_number, '') ILIKE ${like})
    ORDER BY lower(full_name), id
    LIMIT ${limit}`;
  return rows.map(toFound);
}

/** The gym's live members in the app a search finds, by their name or email; `byName`
 *  false is one found by their email alone. */
export async function appMembersLike(
  sql: SqlOrTx,
  gymId: string,
  like: string,
  limit: number,
): Promise<{ userId: string; displayName: string; email: string; byName: boolean }[]> {
  const rows = await sql<{ user_id: string; display_name: string; email: string; by_name: boolean }[]>`
    SELECT m.user_id, u.display_name, u.email::text AS email, u.display_name ILIKE ${like} AS by_name
    FROM gym_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.gym_id = ${gymId} AND m.removed_at IS NULL AND u.status = 'active'
      AND (u.display_name ILIKE ${like} OR u.email::text ILIKE ${like})
    ORDER BY lower(u.display_name), u.id
    LIMIT ${limit}`;
  return rows.map((row) => ({ userId: row.user_id, displayName: row.display_name, email: row.email, byName: row.by_name }));
}

/** The active account on an address, if there is one. */
export async function accountByEmail(sql: SqlOrTx, email: string): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email} AND status = 'active'`;
  return rows[0]?.id ?? null;
}

/** The gym's CURRENT records with this member number, folding case as its index does;
 *  two are enough to know the number does not say who. */
export async function recordsByMemberNumber(
  sql: SqlOrTx,
  gymId: string,
  memberNumber: string,
): Promise<(RecordWords & { email: string | null; phone: string | null })[]> {
  const rows = await sql<(RawRecord & { email: string | null; phone_e164: string | null })[]>`
    SELECT id, full_name, status, payment_status, email::text AS email, phone_e164
    FROM gym_member_list_entries
    WHERE gym_id = ${gymId} AND lower(member_number) = lower(${memberNumber}) AND former_at IS NULL
    ORDER BY listed_seq
    LIMIT 2`;
  return rows.map((row) => ({ ...toRecord(row), email: row.email, phone: row.phone_e164 }));
}

/** An account's name, and the gym's current records on its address when the address is
 *  proved (the email is the link between a person and their record, RULINGS 2026-09-28). */
export async function recordsByProvedEmail(
  sql: SqlOrTx,
  gymId: string,
  userId: string,
): Promise<{ displayName: string; records: RecordWords[] } | null> {
  const users = await sql<{ display_name: string; proved: boolean }[]>`
    SELECT u.display_name,
           EXISTS (SELECT 1 FROM one_time_tokens t
                   WHERE t.user_id = u.id AND t.purpose = 'verify_email' AND t.used_at IS NOT NULL) AS proved
    FROM users u WHERE u.id = ${userId} AND u.status = 'active'`;
  const user = users[0];
  if (user === undefined) return null;
  if (!user.proved) return { displayName: user.display_name, records: [] };
  const rows = await sql<RawRecord[]>`
    SELECT e.id, e.full_name, e.status, e.payment_status
    FROM gym_member_list_entries e
    JOIN users u ON u.id = ${userId}
    WHERE e.gym_id = ${gymId} AND e.former_at IS NULL AND e.email = u.email
    ORDER BY e.listed_seq
    LIMIT 20`;
  return { displayName: user.display_name, records: rows.map(toRecord) };
}

// ── THE VISIT ──

export interface Who {
  userId: string | null;
  entryId: string | null;
}

/** The gym's period now, its day, and this person's visits there today — by their
 *  account or their record, since either may carry an earlier visit. */
export async function scanContext(
  sql: Sql,
  gymId: string,
  who: Who,
): Promise<{ day: string; period: ScanPeriod; visitsToday: VisitToday[]; timezone: string; clockFormat: GymClockFormat } | null> {
  const ctx = await readAttendanceContext(sql, gymId);
  if (ctx === null) return null;
  const rows = await sql<{ slot_key: string; marked_at: Date }[]>`
    SELECT slot_key, marked_at FROM gym_attendance
    WHERE gym_id = ${gymId} AND day = ${ctx.day}::date
      AND (user_id = ${who.userId}::uuid OR entry_id = ${who.entryId}::uuid)`;
  return {
    day: ctx.day,
    period: { hoursStatus: ctx.hoursStatus, opensMinute: ctx.opensMinute, closesMinute: ctx.closesMinute },
    visitsToday: rows.map((row) => ({ slotKey: row.slot_key, markedAt: row.marked_at })),
    timezone: ctx.timezone,
    clockFormat: ctx.clockFormat,
  };
}

/** A person named by both their account and their record: their visits of the day that
 *  carry only one of the two are given the other, so one person is one person on every
 *  count. A visit is left as it is where the same period already holds one for them.
 *  Answers how many visits changed. */
export async function joinVisits(sql: SqlOrTx, gymId: string, day: string, who: Who): Promise<number> {
  if (who.userId === null || who.entryId === null) return 0;
  const rows = await sql<{ n: number }[]>`
    WITH account AS (
      UPDATE gym_attendance a SET user_id = ${who.userId}
      WHERE a.gym_id = ${gymId} AND a.day = ${day}::date AND a.entry_id = ${who.entryId} AND a.user_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM gym_attendance o
          WHERE o.gym_id = a.gym_id AND o.user_id = ${who.userId} AND o.day = a.day AND o.slot_key = a.slot_key)
      RETURNING 1
    ),
    record AS (
      UPDATE gym_attendance a SET entry_id = ${who.entryId}
      WHERE a.gym_id = ${gymId} AND a.day = ${day}::date AND a.user_id = ${who.userId} AND a.entry_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM gym_attendance o
          WHERE o.gym_id = a.gym_id AND o.entry_id = ${who.entryId} AND o.day = a.day AND o.slot_key = a.slot_key)
      RETURNING 1
    )
    SELECT ((SELECT count(*) FROM account) + (SELECT count(*) FROM record))::int AS n`;
  return rows[0]?.n ?? 0;
}

/** Writes the visit, or finds the one already there: the database's two unique keys (an
 *  account's, a record's) decide when two scans race, never a read before the write.
 *
 *  Null when the record it names is no longer on the list. The record is held from the
 *  first statement to the commit, and a join of two records holds both of its own
 *  (`lockEntries`): a visit lands before the join moves the record's visits, or waits for
 *  the join and finds the record gone. */
export async function insertVisit(
  sql: Sql,
  input: {
    gymId: string;
    who: Who;
    deviceId: string | null;
    markedBy: string | null;
    method: GymAttendanceMethod;
    day: string;
    period: ScanPeriod;
    slotKey: string;
  },
): Promise<{ inserted: true; markedAt: Date; joined: number } | { inserted: false; firstAt: Date; joined: number } | null> {
  return await sql.begin(async (tx) => {
    if (input.who.entryId !== null) {
      const held = await tx`
        SELECT 1 FROM gym_member_list_entries
        WHERE gym_id = ${input.gymId} AND id = ${input.who.entryId} AND former_at IS NULL
        FOR KEY SHARE`;
      if (held.length === 0) return null;
    }
    const inserted = await tx<{ marked_at: Date }[]>`
      INSERT INTO gym_attendance
        (gym_id, user_id, entry_id, device_id, marked_by_user_id, day, method, hours_status,
         session_opens_minute, session_closes_minute, slot_key)
      VALUES (${input.gymId}, ${input.who.userId}, ${input.who.entryId}, ${input.deviceId}, ${input.markedBy},
              ${input.day}::date, ${input.method}, ${input.period.hoursStatus},
              ${input.period.opensMinute}, ${input.period.closesMinute}, ${input.slotKey})
      ON CONFLICT DO NOTHING
      RETURNING marked_at`;
    const joined = await joinVisits(tx, input.gymId, input.day, input.who);
    const row = inserted[0];
    if (row !== undefined) return { inserted: true as const, markedAt: row.marked_at, joined };
    const first = await tx<{ marked_at: Date | null }[]>`
      SELECT min(marked_at) AS marked_at FROM gym_attendance
      WHERE gym_id = ${input.gymId} AND day = ${input.day}::date AND slot_key = ${input.slotKey}
        AND (user_id = ${input.who.userId}::uuid OR entry_id = ${input.who.entryId}::uuid)`;
    const firstAt = first[0]?.marked_at;
    // The conflict was with a row that names this account or record, so it is there.
    if (firstAt === undefined || firstAt === null) throw new Error("a visit's conflict found no visit");
    return { inserted: false as const, firstAt, joined };
  });
}

// ── THE LIVE LOG (16b-ii) ──

export interface LogVisit {
  id: string;
  markedAt: Date;
  name: string;
  method: GymAttendanceMethod;
  by: string | null;
  status: string | null;
  payment: string | null;
}

/** A poll asks again from a little before its newest visit: a visit stamped just before
 *  that one but saved just after it is still found, and the screen keeps each id once. */
const LOG_OVERLAP_SECONDS = 5;

/** Today's newest visits at the gym, by its own day: the gym's record name first, as the
 *  desk shows it, and the desk or the member of staff that made each. */
export async function logVisits(
  sql: SqlOrTx,
  gymId: string,
  since: Date | null,
  limit: number,
): Promise<{ day: string; timezone: string; clockFormat: GymClockFormat; visits: LogVisit[] } | null> {
  const gyms = await sql<{ day: string; timezone: string; clock_format: string }[]>`
    SELECT (now() AT TIME ZONE timezone)::date::text AS day, timezone, clock_format FROM gyms WHERE id = ${gymId}`;
  const gym = gyms[0];
  if (gym === undefined) return null;
  const rows = await sql<
    { id: string; marked_at: Date; method: string; name: string; by: string | null; status: string | null; payment_status: string | null }[]
  >`
    SELECT a.id, a.marked_at, a.method, e.status, e.payment_status,
           coalesce(nullif(btrim(e.full_name), ''), u.display_name, '') AS name,
           CASE WHEN a.device_id IS NOT NULL THEN d.name
                WHEN a.method = 'staff' THEN coalesce(s.display_name, '')
                ELSE NULL END AS by
    FROM gym_attendance a
    LEFT JOIN gym_member_list_entries e ON e.gym_id = a.gym_id AND e.id = a.entry_id
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN gym_checkin_devices d ON d.gym_id = a.gym_id AND d.id = a.device_id
    LEFT JOIN users s ON s.id = a.marked_by_user_id
    WHERE a.gym_id = ${gymId} AND a.day = ${gym.day}::date
      AND (${since}::timestamptz IS NULL
           OR a.marked_at > ${since}::timestamptz - make_interval(secs => ${LOG_OVERLAP_SECONDS}))
    ORDER BY a.marked_at DESC, a.id DESC
    LIMIT ${limit}`;
  return {
    day: gym.day,
    timezone: gym.timezone,
    clockFormat: gymClockFormatSchema.parse(gym.clock_format),
    visits: rows.map((row) => ({
      id: row.id,
      markedAt: row.marked_at,
      name: row.name,
      method: gymAttendanceMethodSchema.parse(row.method),
      by: row.by,
      status: row.status,
      payment: row.payment_status,
    })),
  };
}
