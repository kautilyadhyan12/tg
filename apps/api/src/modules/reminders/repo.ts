// THE WORKOUT AND MEAL REMINDERS (ROADMAP Stage 5 item 19e-i): the only file that reads or writes
// `training_reminders`. Every statement names the person in its WHERE.
import type { ReminderKind } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";

type SqlOrTx = Sql | TransactionSql;

export interface ReminderRow {
  kind: ReminderKind;
  isOn: boolean;
  minute: number;
  days: number;
  paused: boolean;
}

export async function readReminders(sql: SqlOrTx, userId: string): Promise<ReminderRow[]> {
  const rows = await sql<{ kind: ReminderKind; is_on: boolean; minute: number; days: number; paused: boolean }[]>`
    SELECT kind, is_on, minute, days, paused_at IS NOT NULL AS paused
    FROM training_reminders WHERE user_id = ${userId}`;
  return rows.map((row) => ({ kind: row.kind, isOn: row.is_on, minute: row.minute, days: row.days, paused: row.paused }));
}

/** The person's zone and when they last opened the app (`users.last_active_at`, written at a sign-in
 *  and each renewed session), or null for an account that is not active. */
export async function readPerson(sql: SqlOrTx, userId: string): Promise<{ zone: string | null } | null> {
  const rows = await sql<{ timezone: string | null }[]>`SELECT timezone FROM users WHERE id = ${userId} AND status = 'active'`;
  const row = rows[0];
  return row === undefined ? null : { zone: row.timezone };
}

/** Saves one reminder whole. Turning it on ends a pause. A time already past today on the person's clock
 *  counts as today's, so a save never sends at once; a time still to come today may go today, unless
 *  today's has already gone. */
export async function saveReminder(
  sql: SqlOrTx,
  input: { userId: string; kind: ReminderKind; on: boolean; minute: number; days: number; today: string; nowMinute: number },
): Promise<void> {
  const { userId, kind, on, minute, days, today, nowMinute } = input;
  const passed = minute <= nowMinute;
  await sql`
    INSERT INTO training_reminders AS t (user_id, kind, is_on, minute, days, sent_day, paused_at, updated_at)
    VALUES (${userId}, ${kind}, ${on}, ${minute}, ${days}, ${passed ? today : null}::date, NULL, now())
    ON CONFLICT (user_id, kind) DO UPDATE SET
      is_on = EXCLUDED.is_on, minute = EXCLUDED.minute, days = EXCLUDED.days, updated_at = now(),
      paused_at = CASE WHEN EXCLUDED.is_on THEN NULL ELSE t.paused_at END,
      sent_day = CASE
        WHEN ${passed} THEN GREATEST(COALESCE(t.sent_day, ${today}::date), ${today}::date)
        ELSE t.sent_day
      END`;
}

/** The zones of everybody with a reminder on and not paused: the sweep works out each one's clock once. */
export async function liveZones(sql: SqlOrTx, userIds?: readonly string[]): Promise<string[]> {
  const rows = await sql<{ zone: string }[]>`
    SELECT DISTINCT COALESCE(u.timezone, '') AS zone
    FROM training_reminders t JOIN users u ON u.id = t.user_id
    WHERE t.is_on AND t.paused_at IS NULL AND u.status = 'active'
      ${userIds === undefined ? sql`` : sql`AND t.user_id IN ${sql(userIds)}`}`;
  return rows.map((row) => row.zone);
}

export interface OwedRow {
  userId: string;
  kind: ReminderKind;
  minute: number;
  zone: string;
}

/** Reminders still owed today and near now on each person's own clock: on, not paused, today one of
 *  their days, not yet sent or skipped today, their time between `REMINDER_DUE_MINUTES` ago and
 *  `REMINDER_BUNDLE_MINUTES` ahead. `clocks`: each raw zone string (as `liveZones` gave it) with its
 *  day, minute and weekday. */
export async function owedNear(
  sql: SqlOrTx,
  input: { clocks: readonly { zone: string; day: string; minute: number; weekday: number }[]; before: number; ahead: number; userIds?: readonly string[] | undefined },
): Promise<OwedRow[]> {
  const { clocks, before, ahead, userIds } = input;
  if (clocks.length === 0) return [];
  const rows = await sql<{ user_id: string; kind: ReminderKind; minute: number; zone: string }[]>`
    WITH c AS (
      SELECT * FROM unnest(
        ${clocks.map((c) => c.zone)}::text[], ${clocks.map((c) => c.day)}::date[],
        ${clocks.map((c) => c.minute)}::int[], ${clocks.map((c) => c.weekday)}::int[]
      ) AS c(zone, day, minute, weekday)
    )
    SELECT t.user_id, t.kind, t.minute, c.zone
    FROM training_reminders t
    JOIN users u ON u.id = t.user_id AND u.status = 'active'
    JOIN c ON c.zone = COALESCE(u.timezone, '')
    WHERE t.is_on AND t.paused_at IS NULL
      AND (t.sent_day IS NULL OR t.sent_day < c.day)
      AND (t.days & (1 << (c.weekday - 1))) <> 0
      AND t.minute BETWEEN c.minute - ${before} AND c.minute + ${ahead}
      ${userIds === undefined ? sql`` : sql`AND t.user_id IN ${sql(userIds)}`}
    ORDER BY t.user_id, t.minute`;
  return rows.map((row) => ({ userId: row.user_id, kind: row.kind, minute: row.minute, zone: row.zone }));
}

/** A reminder taken for today: the day it held before, and the save it was taken from (`updated_at` as
 *  text, to the millionth; a Date keeps only the thousandth). */
export interface Taken {
  kind: ReminderKind;
  prev: string | null;
  saved: string;
}

/** Takes the person's reminders for today, once: a second run at the same instant gets none back. Each
 *  comes back with the day it held before, to be put back if no phone could be reached. */
export async function claim(sql: SqlOrTx, userId: string, kinds: readonly ReminderKind[], day: string): Promise<Taken[]> {
  if (kinds.length === 0) return [];
  return sql<Taken[]>`
    WITH o AS (
      SELECT kind, sent_day AS prev FROM training_reminders
      WHERE user_id = ${userId} AND kind IN ${sql(kinds)} AND is_on AND paused_at IS NULL
        AND (sent_day IS NULL OR sent_day < ${day}::date)
      FOR UPDATE
    )
    UPDATE training_reminders t SET sent_day = ${day}::date
    FROM o WHERE t.user_id = ${userId} AND t.kind = o.kind
    RETURNING t.kind, o.prev::text AS prev, t.updated_at::text AS saved`;
}

/** Of these, the reminders still on and not paused: read again just before a send, so a switch-off made
 *  while the run was reading never goes. */
export async function stillOn(sql: SqlOrTx, userId: string, kinds: readonly ReminderKind[]): Promise<ReminderKind[]> {
  if (kinds.length === 0) return [];
  const rows = await sql<{ kind: ReminderKind }[]>`
    SELECT kind FROM training_reminders
    WHERE user_id = ${userId} AND kind IN ${sql(kinds)} AND is_on AND paused_at IS NULL`;
  return rows.map((row) => row.kind);
}

/** Firebase reached no phone: today's is owed again, unless the person saved it since (a save at a time
 *  already past holds today as well, and waits for tomorrow). */
export async function unclaim(sql: SqlOrTx, userId: string, taken: readonly Taken[], day: string): Promise<void> {
  for (const one of taken) {
    await sql`
      UPDATE training_reminders SET sent_day = ${one.prev}::date
      WHERE user_id = ${userId} AND kind = ${one.kind} AND sent_day = ${day}::date
        AND updated_at = ${one.saved}::text::timestamptz`;
  }
}

/** Paused by itself: the person had not opened the app for a week. Turning it on again ends it. */
export async function pause(sql: SqlOrTx, userId: string, kinds: readonly ReminderKind[], now: Date): Promise<void> {
  if (kinds.length === 0) return;
  await sql`
    UPDATE training_reminders SET paused_at = ${now}
    WHERE user_id = ${userId} AND kind IN ${sql(kinds)} AND is_on AND paused_at IS NULL`;
}

/** Whether the person opened the app since `since`: a sign-in or a renewed session. */
export async function openedSince(sql: SqlOrTx, userId: string, since: Date): Promise<boolean> {
  const rows = await sql<{ yes: boolean }[]>`
    SELECT COALESCE(last_active_at, created_at) >= ${since} AS yes FROM users WHERE id = ${userId}`;
  return rows[0]?.yes === true;
}

/** Whether the person trained today on their clock: a workout begun today, or a visit to a place today
 *  (a visit keeps a streak, Kd 2026-09-01). `since`: a bound well before the day began, for the index. */
export async function trainedOn(sql: SqlOrTx, userId: string, zone: string, day: string, since: Date): Promise<boolean> {
  const rows = await sql<{ yes: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM workouts
      WHERE user_id = ${userId} AND started_at >= ${since}
        AND (started_at AT TIME ZONE ${zone})::date = ${day}::date
    ) OR EXISTS (
      SELECT 1 FROM gym_attendance WHERE user_id = ${userId} AND day = ${day}::date
    ) AS yes`;
  return rows[0]?.yes === true;
}

/** The person's meals of the last two days: their kind as chosen, and when. */
export async function recentMeals(sql: SqlOrTx, userId: string, since: Date): Promise<{ mealType: string | null; takenAt: Date }[]> {
  const rows = await sql<{ meal_type: string | null; taken_at: Date }[]>`
    SELECT meal_type, taken_at FROM meal_logs WHERE user_id = ${userId} AND taken_at >= ${since}`;
  return rows.map((row) => ({ mealType: row.meal_type, takenAt: row.taken_at }));
}
