// The At risk page's reads (spec Part 3 §16.4; ROADMAP 20d-i). Every read names the gym
// in its WHERE. They gather; `atRiskOf` in `@app/shared` decides.
//
// A day somebody CAME is a check-in of any kind, or a day staff marked them as there
// without one: a class place marked Came, a personal training session marked attended.
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import { AT_RISK_READ_DAYS, GYM_COME_BACK_WAIT_DAYS, type AtRiskSettings } from "@app/shared";
import { lastOnePersonMessages } from "../messages/groupRepo.js";

type SqlOrTx = Sql | TransactionSql;

/** The days, of those read, staff marked somebody as there without a check-in:
 *  (entry_id, user_id, day). A class place names its account and, where it has one, the
 *  record; a personal training session names the record. */
function markedAttended(sql: SqlOrTx, gymId: string, today: string) {
  // The starts are indexed; a class's own day is at most a day either side of its instant.
  const from = sql`${today}::date - ${AT_RISK_READ_DAYS}::int`;
  const fromInstant = sql`(${today}::date - ${AT_RISK_READ_DAYS + 2}::int)::timestamp AT TIME ZONE 'UTC'`;
  return sql`
    SELECT b.entry_id, b.user_id, s.local_date AS day
    FROM gym_class_sessions s
    JOIN gym_class_bookings b ON b.gym_id = s.gym_id AND b.session_id = s.id AND b.status = 'attended'
    WHERE s.gym_id = ${gymId} AND s.starts_at > ${fromInstant} AND s.local_date > ${from}
    UNION ALL
    SELECT p.entry_id, NULL::uuid AS user_id, p.local_date AS day
    FROM gym_pt_appointments p
    WHERE p.gym_id = ${gymId} AND p.status = 'attended' AND p.entry_id IS NOT NULL
      AND p.starts_at > ${fromInstant} AND p.local_date > ${from}`;
}

const gymRowSchema = z.object({ today: z.string(), quiet_days: z.number().int(), weeks_came: z.number().int() });
const clockSchema = z.object({
  first_checkin_on: z.string().nullable(),
  last_checkin_on: z.string().nullable(),
  gym_days: z.array(z.string()),
});

export interface AtRiskClock {
  today: string;
  settings: AtRiskSettings;
  firstCheckinOn: string | null;
  lastCheckinOn: string | null;
  /** The days, of those a person's visits are read over, the gym checked anybody in. */
  gymDays: string[];
}

/** The gym's own day, its two numbers, and the days anybody came. Null when there is no
 *  such gym. */
export async function readClock(sql: SqlOrTx, gymId: string, now: Date): Promise<AtRiskClock | null> {
  const gyms = await sql<Record<string, unknown>[]>`
    SELECT to_char((${now}::timestamptz AT TIME ZONE g.timezone)::date, 'YYYY-MM-DD') AS today,
           g.at_risk_quiet_days AS quiet_days, g.at_risk_weeks_came AS weeks_came
    FROM gyms g WHERE g.id = ${gymId}`;
  if (gyms[0] === undefined) return null;
  const gym = gymRowSchema.parse(gyms[0]);
  const rows = await sql<Record<string, unknown>[]>`
    WITH marked AS MATERIALIZED (SELECT DISTINCT x.day FROM (${markedAttended(sql, gymId, gym.today)}) x)
    SELECT (SELECT to_char(min(a.day), 'YYYY-MM-DD') FROM gym_attendance a WHERE a.gym_id = ${gymId}) AS first_checkin_on,
           (SELECT to_char(max(a.day), 'YYYY-MM-DD') FROM gym_attendance a WHERE a.gym_id = ${gymId} AND a.day <= ${gym.today}::date) AS last_checkin_on,
           ARRAY(
             SELECT to_char(d.day, 'YYYY-MM-DD')
             FROM (SELECT ${gym.today}::date - n AS day FROM generate_series(0, ${AT_RISK_READ_DAYS}::int) AS n) d
             WHERE EXISTS (SELECT 1 FROM gym_attendance a WHERE a.gym_id = ${gymId} AND a.day = d.day)
                OR EXISTS (SELECT 1 FROM marked m WHERE m.day = d.day)
             ORDER BY d.day
           ) AS gym_days`;
  const row = clockSchema.parse(rows[0]);
  // A gym that marks its classes and scans nobody began, and was last seen, by those days.
  const firstDay = row.gym_days[0] ?? null;
  const lastDay = row.gym_days[row.gym_days.length - 1] ?? null;
  const earliest = [row.first_checkin_on, firstDay].flatMap((d) => (d === null ? [] : [d])).sort()[0] ?? null;
  const latest = [row.last_checkin_on, lastDay].flatMap((d) => (d === null ? [] : [d])).sort().reverse()[0] ?? null;
  return {
    today: gym.today,
    settings: { quietDays: gym.quiet_days, weeksCame: gym.weeks_came },
    firstCheckinOn: earliest,
    lastCheckinOn: latest,
    gymDays: row.gym_days,
  };
}

const candidateSchema = z.object({
  entry_id: z.string().nullable(),
  user_id: z.string().nullable(),
  name: z.string(),
  days: z.array(z.string()),
  holders: z.array(z.string()),
  staff: z.boolean(),
});

export interface AtRiskCandidate {
  entryId: string | null;
  /** Their app account, for somebody in the app with no record on the list. */
  userId: string | null;
  name: string;
  /** The days they were checked in, by any means, over the days read. */
  visitDays: string[];
  /** The live app accounts that hold the record. */
  holders: string[];
  staff: boolean;
}

/** Everybody on the gym's list, or in its app with no record, whose newest visit of the
 *  days read is `quietDays` or more back, with the days they came.
 *
 *  A visit is its record's: the one it names, or the record its account holds now. A
 *  visit of an account with no record is that account's. So somebody on the list and in
 *  the app is one person here, as on the Members list. A person taken off the list, or
 *  out of the app, is not read; the owner and the gym's staff are marked, for the caller
 *  to leave out. */
export async function readCandidates(sql: SqlOrTx, gymId: string, today: string, quietDays: number): Promise<AtRiskCandidate[]> {
  const rows = await sql<Record<string, unknown>[]>`
    -- Each person's newest visit first, with no sort: a big gym's visits are many and the
    -- people who have gone quiet few. Only their days are then read, by the visits' own
    -- indexes on a record and on an account. A person is ONE id throughout, their record's
    -- or else their account's, so every join here is an equality.
    WITH marked AS MATERIALIZED (${markedAttended(sql, gymId, today)}),
    last AS MATERIALIZED (
      SELECT a.entry_id AS raw_entry, a.user_id AS raw_user, max(a.day) AS last_on
      FROM (
        SELECT v.entry_id, v.user_id, v.day FROM gym_attendance v
        WHERE v.gym_id = ${gymId} AND v.day > ${today}::date - ${AT_RISK_READ_DAYS}::int
        UNION ALL
        SELECT m.entry_id, m.user_id, m.day FROM marked m
      ) a
      GROUP BY a.entry_id, a.user_id
    ),
    who AS MATERIALIZED (
      SELECT COALESCE(l.raw_entry, m.entry_id, l.raw_user) AS pid,
             COALESCE(l.raw_entry, m.entry_id) IS NOT NULL AS on_list,
             l.raw_entry, l.raw_user, l.last_on
      FROM last l
      LEFT JOIN gym_members m ON l.raw_entry IS NULL AND m.gym_id = ${gymId} AND m.user_id = l.raw_user AND m.removed_at IS NULL
    ),
    gone AS MATERIALIZED (
      SELECT w.pid, w.on_list, w.raw_entry, w.raw_user
      FROM who w
      JOIN (
        SELECT k.pid FROM who k
        GROUP BY k.pid
        HAVING max(k.last_on) <= ${today}::date - ${quietDays}::int
      ) q ON q.pid = w.pid
    ),
    days AS (
      SELECT g.pid, a.day
      FROM (SELECT DISTINCT pid, raw_entry FROM gone WHERE raw_entry IS NOT NULL) g
      JOIN gym_attendance a ON a.gym_id = ${gymId} AND a.entry_id = g.raw_entry
                           AND a.day > ${today}::date - ${AT_RISK_READ_DAYS}::int
      UNION
      SELECT g.pid, a.day
      FROM (SELECT DISTINCT pid, raw_user FROM gone WHERE raw_entry IS NULL) g
      JOIN gym_attendance a ON a.gym_id = ${gymId} AND a.user_id = g.raw_user AND a.entry_id IS NULL
                           AND a.day > ${today}::date - ${AT_RISK_READ_DAYS}::int
      UNION
      SELECT g.pid, m.day
      FROM (SELECT DISTINCT pid, raw_entry FROM gone WHERE raw_entry IS NOT NULL) g
      JOIN marked m ON m.entry_id = g.raw_entry
      UNION
      SELECT g.pid, m.day
      FROM (SELECT DISTINCT pid, raw_user FROM gone WHERE raw_entry IS NULL) g
      JOIN marked m ON m.user_id = g.raw_user AND m.entry_id IS NULL
    ),
    quiet AS (
      SELECT CASE WHEN p.on_list THEN p.pid END AS entry_id,
             CASE WHEN NOT p.on_list THEN p.pid END AS user_id,
             d.days
      FROM (SELECT pid, bool_or(on_list) AS on_list FROM gone GROUP BY pid) p
      JOIN (SELECT pid, array_agg(to_char(day, 'YYYY-MM-DD')) AS days FROM days GROUP BY pid) d ON d.pid = p.pid
    )
    SELECT q.entry_id, q.user_id, q.days,
           COALESCE(NULLIF(btrim(e.full_name), ''), h.first_name, au.display_name, '') AS name,
           COALESCE(h.holders, ARRAY[]::uuid[]) AS holders,
           (COALESCE(h.staff, false) OR COALESCE(g.owner_user_id = am.user_id, false) OR COALESCE(am.complimentary, false)
             OR EXISTS (SELECT 1 FROM gym_staff s WHERE s.gym_id = g.id AND s.user_id = am.user_id)) AS staff
    FROM quiet q
    JOIN gyms g ON g.id = ${gymId}
    LEFT JOIN gym_member_list_entries e ON e.gym_id = g.id AND e.id = q.entry_id AND e.former_at IS NULL
    LEFT JOIN gym_members am ON q.entry_id IS NULL AND am.gym_id = g.id AND am.user_id = q.user_id
                            AND am.removed_at IS NULL AND am.entry_id IS NULL
    LEFT JOIN users au ON au.id = am.user_id AND au.status = 'active'
    LEFT JOIN LATERAL (
      SELECT array_agg(m.user_id ORDER BY m.user_id) AS holders,
             (array_agg(u.display_name ORDER BY m.user_id))[1] AS first_name,
             bool_or(m.complimentary OR g.owner_user_id = m.user_id
                     OR EXISTS (SELECT 1 FROM gym_staff s WHERE s.gym_id = g.id AND s.user_id = m.user_id)) AS staff
      FROM gym_members m
      JOIN users u ON u.id = m.user_id AND u.status = 'active'
      WHERE m.gym_id = g.id AND m.entry_id = e.id AND m.removed_at IS NULL
    ) h ON e.id IS NOT NULL
    WHERE e.id IS NOT NULL OR au.id IS NOT NULL`;
  return rows.map((raw) => {
    const row = candidateSchema.parse(raw);
    return { entryId: row.entry_id, userId: row.user_id, name: row.name, visitDays: row.days, holders: row.holders, staff: row.staff };
  });
}

export interface LastMessage {
  /** One of the ready-made lines, or null with the gym's own words in `body`. */
  preset: string | null;
  body: string | null;
  sentAt: Date;
  /** When the gym may send them another; null when it may now. */
  messageableAt: Date | null;
}

/** The gym's newest come-back message to each of the accounts named, ready-made or its
 *  own words, and when the next may go: `GYM_COME_BACK_WAIT_DAYS` after it. */
export async function readLastMessages(sql: SqlOrTx, gymId: string, userIds: readonly string[], now: Date): Promise<Map<string, LastMessage>> {
  const out = new Map<string, LastMessage>();
  if (userIds.length === 0) return out;
  const wait = GYM_COME_BACK_WAIT_DAYS * 86_400_000;
  const put = (userId: string, message: { preset: string | null; body: string | null; sentAt: Date }): void => {
    const held = out.get(userId);
    if (held !== undefined && held.sentAt.getTime() >= message.sentAt.getTime()) return;
    const again = new Date(message.sentAt.getTime() + wait);
    out.set(userId, { ...message, messageableAt: again.getTime() > now.getTime() ? again : null });
  };
  const lines = await sql<{ user_id: string; preset: string; created_at: Date }[]>`
    SELECT DISTINCT ON (n.user_id) n.user_id, n.preset, n.created_at
    FROM gym_nudges n
    WHERE n.gym_id = ${gymId} AND n.user_id = ANY(${[...userIds]}::uuid[])
    ORDER BY n.user_id, n.created_at DESC`;
  for (const row of lines) put(row.user_id, { preset: row.preset, body: null, sentAt: row.created_at });
  for (const [userId, written] of await lastOnePersonMessages(sql, gymId, userIds)) put(userId, { preset: null, body: written.body, sentAt: written.sentAt });
  return out;
}

/** Has this gym sent this account a come-back message, ready-made or its own, inside the
 *  wait? Asked with the gym's row held, on the transaction's own clock. */
export async function comeBackTooSoon(tx: TransactionSql, gymId: string, userId: string): Promise<boolean> {
  const rows = await tx<{ soon: boolean }[]>`
    SELECT (
      EXISTS (
        SELECT 1 FROM gym_nudges n
        WHERE n.gym_id = ${gymId} AND n.user_id = ${userId}
          AND n.created_at > now() - make_interval(days => ${GYM_COME_BACK_WAIT_DAYS}::int)
      ) OR EXISTS (
        SELECT 1 FROM gym_group_messages g
        JOIN gym_member_messages c ON c.gym_id = g.gym_id AND c.kind = 'group' AND c.occasion = g.id::text
        WHERE g.gym_id = ${gymId} AND g.one_person AND c.user_id = ${userId}
          AND g.sent_at > now() - make_interval(days => ${GYM_COME_BACK_WAIT_DAYS}::int)
      )
    ) AS soon`;
  return rows[0]?.soon === true;
}

export async function writeSettings(tx: TransactionSql, gymId: string, settings: AtRiskSettings): Promise<AtRiskSettings | null> {
  const before = await tx<{ quiet_days: number; weeks_came: number }[]>`
    SELECT at_risk_quiet_days AS quiet_days, at_risk_weeks_came AS weeks_came FROM gyms WHERE id = ${gymId}`;
  const was = before[0];
  if (was === undefined) return null;
  await tx`UPDATE gyms SET at_risk_quiet_days = ${settings.quietDays}, at_risk_weeks_came = ${settings.weeksCame} WHERE id = ${gymId}`;
  return { quietDays: was.quiet_days, weeksCame: was.weeks_came };
}

/** Is this account in this gym's app now, and not deleted? The ready-made line's own test
 *  (`sendGymNudge`), with the account's status. */
export async function liveMember(tx: TransactionSql, gymId: string, userId: string): Promise<boolean> {
  const rows = await tx<{ one: number }[]>`
    SELECT 1 AS one
    FROM gym_members m JOIN users u ON u.id = m.user_id AND u.status = 'active'
    WHERE m.gym_id = ${gymId} AND m.user_id = ${userId} AND m.removed_at IS NULL AND m.complimentary = false`;
  return rows.length > 0;
}
