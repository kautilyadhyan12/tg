// The At risk page's reads (spec Part 3 §16.4; ROADMAP 20d-i). Every read names the gym
// in its WHERE. They gather; `atRiskOf` in `@app/shared` decides.
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import { AT_RISK_READ_DAYS, type AtRiskSettings } from "@app/shared";

type SqlOrTx = Sql | TransactionSql;

const clockSchema = z.object({
  today: z.string(),
  quiet_days: z.number().int(),
  weeks_came: z.number().int(),
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

/** The gym's own day, its two numbers, and the days it checked anybody in. Null when
 *  there is no such gym. */
export async function readClock(sql: SqlOrTx, gymId: string, now: Date): Promise<AtRiskClock | null> {
  const rows = await sql<Record<string, unknown>[]>`
    WITH g AS (
      SELECT g.id, (${now}::timestamptz AT TIME ZONE g.timezone)::date AS today,
             g.at_risk_quiet_days, g.at_risk_weeks_came
      FROM gyms g WHERE g.id = ${gymId}
    )
    SELECT to_char(g.today, 'YYYY-MM-DD') AS today,
           g.at_risk_quiet_days AS quiet_days, g.at_risk_weeks_came AS weeks_came,
           (SELECT to_char(min(a.day), 'YYYY-MM-DD') FROM gym_attendance a WHERE a.gym_id = g.id) AS first_checkin_on,
           (SELECT to_char(max(a.day), 'YYYY-MM-DD') FROM gym_attendance a WHERE a.gym_id = g.id AND a.day <= g.today) AS last_checkin_on,
           ARRAY(
             SELECT to_char(d.day, 'YYYY-MM-DD')
             FROM (SELECT g.today - n AS day FROM generate_series(0, ${AT_RISK_READ_DAYS}::int) AS n) d
             WHERE EXISTS (SELECT 1 FROM gym_attendance a WHERE a.gym_id = g.id AND a.day = d.day)
             ORDER BY d.day
           ) AS gym_days
    FROM g`;
  if (rows[0] === undefined) return null;
  const row = clockSchema.parse(rows[0]);
  return {
    today: row.today,
    settings: { quietDays: row.quiet_days, weeksCame: row.weeks_came },
    firstCheckinOn: row.first_checkin_on,
    lastCheckinOn: row.last_checkin_on,
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
    WITH v AS MATERIALIZED (
      SELECT COALESCE(a.entry_id, m.entry_id) AS entry_id,
             CASE WHEN COALESCE(a.entry_id, m.entry_id) IS NULL THEN a.user_id END AS user_id,
             a.day
      FROM gym_attendance a
      LEFT JOIN gym_members m ON a.entry_id IS NULL AND m.gym_id = a.gym_id AND m.user_id = a.user_id AND m.removed_at IS NULL
      WHERE a.gym_id = ${gymId} AND a.day > ${today}::date - ${AT_RISK_READ_DAYS}::int
    ),
    quiet AS (
      SELECT v.entry_id, v.user_id, array_agg(DISTINCT to_char(v.day, 'YYYY-MM-DD')) AS days
      FROM v
      GROUP BY v.entry_id, v.user_id
      HAVING max(v.day) <= ${today}::date - ${quietDays}::int
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
  preset: string;
  sentAt: Date;
  /** When the gym may send them another; null when it may now. */
  messageableAt: Date | null;
}

/** The gym's newest come-back message to each of the accounts named, and when the next
 *  may go: the seven days `sendGymNudge` holds. */
export async function readLastMessages(sql: SqlOrTx, gymId: string, userIds: readonly string[], now: Date): Promise<Map<string, LastMessage>> {
  const out = new Map<string, LastMessage>();
  if (userIds.length === 0) return out;
  const rows = await sql<{ user_id: string; preset: string; created_at: Date; messageable_at: Date | null }[]>`
    SELECT DISTINCT ON (n.user_id) n.user_id, n.preset, n.created_at,
           CASE WHEN n.created_at > ${now}::timestamptz - interval '7 days' THEN n.created_at + interval '7 days' END AS messageable_at
    FROM gym_nudges n
    WHERE n.gym_id = ${gymId} AND n.user_id = ANY(${[...userIds]}::uuid[])
    ORDER BY n.user_id, n.created_at DESC`;
  for (const row of rows) out.set(row.user_id, { preset: row.preset, sentAt: row.created_at, messageableAt: row.messageable_at });
  return out;
}

export async function writeSettings(tx: TransactionSql, gymId: string, settings: AtRiskSettings): Promise<AtRiskSettings | null> {
  const before = await tx<{ quiet_days: number; weeks_came: number }[]>`
    SELECT at_risk_quiet_days AS quiet_days, at_risk_weeks_came AS weeks_came FROM gyms WHERE id = ${gymId}`;
  const was = before[0];
  if (was === undefined) return null;
  await tx`UPDATE gyms SET at_risk_quiet_days = ${settings.quietDays}, at_risk_weeks_came = ${settings.weeksCame} WHERE id = ${gymId}`;
  return { quietDays: was.quiet_days, weeksCame: was.weeks_came };
}
