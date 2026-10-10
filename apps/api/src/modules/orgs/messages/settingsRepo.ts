// A GYM'S SETTINGS FOR ITS AUTOMATIC MESSAGES: the only file that reads or writes
// `gym_message_settings` (spec Part 3 §16.2; ROADMAP 20b-i). Every statement names the gym.
import type { GymMessageKind, GymMessageSettingRow } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { COUNTED_METHODS } from "../leaderboard/visits.js";

type SqlOrTx = Sql | TransactionSql;

/** The gym's rows, one a kind it has ever saved. A kind with none has its starting values. */
export async function settingRows(sql: SqlOrTx, gymId: string): Promise<GymMessageSettingRow[]> {
  const rows = await sql<{ kind: GymMessageKind; is_on: boolean; own_line: string | null; days: number | null; milestones: number[] | null }[]>`
    SELECT kind, is_on, own_line, days, milestones FROM gym_message_settings WHERE gym_id = ${gymId} ORDER BY kind`;
  return rows.map((row) => ({ kind: row.kind, on: row.is_on, ownLine: row.own_line, days: row.days, milestones: row.milestones }));
}

/** Keeps the rows in one statement. Saved twice they are kept once. */
export async function writeSettingRows(tx: TransactionSql, gymId: string, rows: readonly GymMessageSettingRow[], now: Date): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map((row) => ({
    gym_id: gymId,
    kind: row.kind,
    is_on: row.on,
    own_line: row.ownLine,
    days: row.days,
    milestones: row.milestones === null ? null : [...row.milestones],
    updated_at: now,
  }));
  await tx`
    INSERT INTO gym_message_settings ${tx(values)}
    ON CONFLICT (gym_id, kind) DO UPDATE
    SET is_on = EXCLUDED.is_on, own_line = EXCLUDED.own_line, days = EXCLUDED.days, milestones = EXCLUDED.milestones, updated_at = EXCLUDED.updated_at`;
}

/** Today on the gym's own calendar, or null for a gym that is not there. */
export async function gymToday(sql: SqlOrTx, gymId: string, now: Date): Promise<string | null> {
  const rows = await sql<{ today: string }[]>`
    SELECT (${now}::timestamptz AT TIME ZONE g.timezone)::date::text AS today FROM gyms g WHERE g.id = ${gymId}`;
  return rows[0]?.today ?? null;
}

/** Did the desk or staff check anybody in at this gym in the `days` up to `today`? */
export async function checkedInLately(sql: SqlOrTx, gymId: string, today: string, days: number): Promise<boolean> {
  const rows = await sql<{ one: number }[]>`
    SELECT 1 AS one FROM gym_attendance a
    WHERE a.gym_id = ${gymId} AND a.method IN ${sql([...COUNTED_METHODS])}
      AND a.day <= ${today}::date AND a.day > ${today}::date - ${days}::int
    LIMIT 1`;
  return rows.length > 0;
}
