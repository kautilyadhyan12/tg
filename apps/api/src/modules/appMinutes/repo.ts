// The minutes the app is open on screen each day (ROADMAP Stage 2 item 14a-ii, migration 0227),
// sent by the person's own phone (Stage 5 item 21f). Every row is keyed by the person sending it.
import type { Sql } from "postgres";
import { APP_MINUTES_KEEP_DAYS, type AppMinutesDay } from "@app/shared";

let known: Promise<Set<string>> | null = null;

/** The time zones Postgres knows, read once: a day is kept only in a zone the admin page can read
 *  it back in. */
export async function knownZones(sql: Sql): Promise<Set<string>> {
  known ??= sql<{ name: string }[]>`SELECT name FROM pg_timezone_names`.then(
    (rows) => new Set(rows.map((r) => r.name)),
    (err: unknown) => {
      known = null;
      throw err;
    },
  );
  return await known;
}

/** Keeps each day sent, as the higher of the total held and the total sent; a day older than
 *  APP_MINUTES_KEEP_DAYS or after the phone's tomorrow, in its own zone, is not kept. Answers how
 *  many were kept (or already as high). A day sent again writes nothing. */
export async function saveMinutes(sql: Sql, userId: string, days: readonly AppMinutesDay[], now: Date): Promise<number> {
  if (days.length === 0) return 0;
  const rows = await sql<{ kept: number }[]>`
    WITH sent AS (
      SELECT s.day, s.minutes, s.zone
      FROM jsonb_to_recordset(${sql.json(days.map((d) => ({ day: d.day, minutes: d.minutes, zone: d.zone })))}::jsonb)
        AS s(day date, minutes int, zone text)
    ), ok AS (
      SELECT * FROM sent
      WHERE sent.day <= (${now}::timestamptz AT TIME ZONE sent.zone)::date + 1
        AND sent.day > (${now}::timestamptz AT TIME ZONE sent.zone)::date - ${APP_MINUTES_KEEP_DAYS}::int
    ), saved AS (
      INSERT INTO app_minutes (user_id, day, minutes, zone)
      SELECT ${userId}, ok.day, ok.minutes, ok.zone FROM ok
      ON CONFLICT (user_id, day) DO UPDATE
        SET minutes = EXCLUDED.minutes, zone = EXCLUDED.zone, updated_at = now()
        WHERE EXCLUDED.minutes > app_minutes.minutes
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM ok)::int AS kept`;
  return rows[0]?.kept ?? 0;
}
