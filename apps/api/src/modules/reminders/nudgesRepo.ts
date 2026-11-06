// THE STREAK REMINDER, BADGES AND THE SUNDAY SUMMARY (ROADMAP Stage 5 item 19e-ii): what their sender reads
// and writes. Every statement names the person in its WHERE.
import type { Sql, TransactionSql } from "postgres";

type SqlOrTx = Sql | TransactionSql;

/** The zones of everybody active with a phone that may be told: the sender works out each one's clock once. */
export async function nudgeZones(sql: SqlOrTx, userIds?: readonly string[]): Promise<string[]> {
  const rows = await sql<{ zone: string }[]>`
    SELECT DISTINCT COALESCE(u.timezone, '') AS zone
    FROM users u
    WHERE u.status = 'active' AND (u.push_streak OR u.push_badges OR u.push_summary)
      AND EXISTS (SELECT 1 FROM push_tokens p WHERE p.user_id = u.id)
      ${userIds === undefined ? sql`` : sql`AND u.id IN ${sql(userIds)}`}`;
  return rows.map((row) => row.zone);
}

export interface NudgeClock {
  zone: string;
  day: string;
  minute: number;
  weekday: number;
  /** The Monday of the week `day` is in. */
  monday: string;
}

export interface NudgePerson {
  userId: string;
  zone: string;
  pushStreak: boolean;
  pushBadges: boolean;
  pushSummary: boolean;
  summaryWeek: string | null;
  recentPushes: Date[];
  lastActiveAt: Date;
  streak: { current: number; longest: number; lastActivityDate: string | null; freezesAvailable: number };
  /** Badges earned within the telling days and not told, oldest first. */
  untold: string[];
}

/** Everybody who may be owed one of the three at this minute on their clock: none went today, and the
 *  streak reminder's or the summary's time is now, or a badge is waiting during the day. The sender
 *  decides the rest. `streakFrom`, `summaryFrom`: the minute each is due from; `due`: how long it stays
 *  due; `open`, `close`: the day's hours. */
export async function owedNudges(
  sql: SqlOrTx,
  input: {
    clocks: readonly NudgeClock[];
    streakFrom: number;
    summaryFrom: number;
    due: number;
    open: number;
    close: number;
    streakLeast: number;
    badgesSince: Date;
    /** Nobody who has not opened the app since then: none of the three goes to them. */
    openedSince: Date;
    userIds?: readonly string[] | undefined;
  },
): Promise<NudgePerson[]> {
  const { clocks, streakFrom, summaryFrom, due, open, close, streakLeast, badgesSince, openedSince, userIds } = input;
  if (clocks.length === 0) return [];
  const rows = await sql<
    {
      user_id: string;
      zone: string;
      push_streak: boolean;
      push_badges: boolean;
      push_summary: boolean;
      summary_week: string | null;
      recent_pushes: Date[];
      last_active_at: Date;
      current: number | null;
      longest: number | null;
      last_activity_date: string | null;
      freezes_available: number | null;
      untold: string[];
    }[]
  >`
    WITH c AS (
      SELECT * FROM unnest(
        ${clocks.map((c) => c.zone)}::text[], ${clocks.map((c) => c.day)}::date[],
        ${clocks.map((c) => c.minute)}::int[], ${clocks.map((c) => c.weekday)}::int[],
        ${clocks.map((c) => c.monday)}::date[]
      ) AS c(zone, day, minute, weekday, monday)
      WHERE c.minute BETWEEN ${open} AND ${close - 1}
    )
    SELECT u.id AS user_id, c.zone, u.push_streak, u.push_badges, u.push_summary, u.summary_week::text AS summary_week,
           u.recent_pushes, COALESCE(u.last_active_at, u.created_at) AS last_active_at,
           s.current, s.longest, s.last_activity_date::text AS last_activity_date, s.freezes_available,
           COALESCE(b.codes, '{}') AS untold
    FROM users u
    JOIN c ON c.zone = COALESCE(u.timezone, '')
    LEFT JOIN streaks s ON s.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT array_agg(a.code ORDER BY a.earned_at, a.code) AS codes FROM user_achievements a
      WHERE a.user_id = u.id AND a.told_at IS NULL AND a.earned_at >= ${badgesSince}
    ) b ON u.push_badges
    WHERE u.status = 'active'
      AND (u.nudge_day IS NULL OR u.nudge_day < c.day)
      AND COALESCE(u.last_active_at, u.created_at) >= ${openedSince}
      AND EXISTS (SELECT 1 FROM push_tokens p WHERE p.user_id = u.id)
      AND (
        (u.push_streak AND s.current >= ${streakLeast} AND c.minute BETWEEN ${streakFrom} AND ${streakFrom + due - 1})
        OR (u.push_summary AND c.weekday = 7 AND (u.summary_week IS NULL OR u.summary_week < c.monday)
            AND c.minute BETWEEN ${summaryFrom} AND ${summaryFrom + due - 1})
        -- A badge waits on a Sunday until its summary is had or its time is past: the summary tells it.
        OR (u.push_badges AND b.codes IS NOT NULL AND NOT (
              u.push_summary AND c.weekday = 7 AND (u.summary_week IS NULL OR u.summary_week < c.monday)
              AND c.minute < ${summaryFrom + due}))
      )
      ${userIds === undefined ? sql`` : sql`AND u.id IN ${sql(userIds)}`}
    ORDER BY u.id`;
  return rows.map((row) => ({
    userId: row.user_id,
    zone: row.zone,
    pushStreak: row.push_streak,
    pushBadges: row.push_badges,
    pushSummary: row.push_summary,
    summaryWeek: row.summary_week,
    recentPushes: row.recent_pushes,
    lastActiveAt: row.last_active_at,
    streak: {
      current: row.current ?? 0,
      longest: row.longest ?? 0,
      lastActivityDate: row.last_activity_date,
      freezesAvailable: row.freezes_available ?? 0,
    },
    untold: row.untold,
  }));
}

/** Badges older than the telling days and never told are not told at all. */
export async function dropStaleBadges(sql: SqlOrTx, before: Date, userIds?: readonly string[]): Promise<void> {
  await sql`
    UPDATE user_achievements SET told_at = now()
    WHERE told_at IS NULL AND earned_at < ${before}
      ${userIds === undefined ? sql`` : sql`AND user_id IN ${sql(userIds)}`}`;
}

export interface Claimed {
  prevDay: string | null;
  prevWeek: string | null;
  /** The badges taken with it, oldest first. */
  badges: string[];
}

/** Takes today's one notice of the three, once: a second run at the same instant gets null. With `monday`,
 *  the week's summary too; with `badgesSince`, the person's badges earned since then and not told, marked
 *  told at `at`. One statement, so the day and the badges are taken together or not at all. Comes back with
 *  what it held before, to be put back if no phone could be reached. */
export async function claim(
  sql: SqlOrTx,
  input: { userId: string; day: string; monday: string | null; badgesSince: Date | null; at: Date },
): Promise<Claimed | null> {
  const { userId, day, monday, badgesSince, at } = input;
  const rows = await sql<{ prev_day: string | null; prev_week: string | null; badges: string[] | null }[]>`
    WITH o AS (
      SELECT nudge_day AS prev_day, summary_week AS prev_week FROM users
      WHERE id = ${userId} AND (nudge_day IS NULL OR nudge_day < ${day}::date)
        ${monday === null ? sql`` : sql`AND (summary_week IS NULL OR summary_week < ${monday}::date)`}
      FOR UPDATE
    ),
    d AS (
      UPDATE users u SET nudge_day = ${day}::date
        ${monday === null ? sql`` : sql`, summary_week = ${monday}::date`}
      FROM o WHERE u.id = ${userId}
      RETURNING o.prev_day, o.prev_week
    ),
    b AS (
      UPDATE user_achievements SET told_at = ${at}
      WHERE user_id = ${userId} AND told_at IS NULL AND ${badgesSince !== null}
        AND earned_at >= ${badgesSince ?? at} AND EXISTS (SELECT 1 FROM d)
      RETURNING code, earned_at
    )
    SELECT d.prev_day::text AS prev_day, d.prev_week::text AS prev_week,
           (SELECT array_agg(b.code ORDER BY b.earned_at, b.code) FROM b) AS badges
    FROM d`;
  const row = rows[0];
  return row === undefined ? null : { prevDay: row.prev_day, prevWeek: row.prev_week, badges: row.badges ?? [] };
}

/** No phone was reached: today's notice and its badges are owed again, unless something else took the day
 *  since. */
export async function unclaim(sql: SqlOrTx, input: { userId: string; day: string; monday: string | null; taken: Claimed; at: Date }): Promise<void> {
  const { userId, day, monday, taken, at } = input;
  await sql`
    UPDATE users SET nudge_day = ${taken.prevDay}::date
      ${monday === null ? sql`` : sql`, summary_week = ${taken.prevWeek}::date`}
    WHERE id = ${userId} AND nudge_day = ${day}::date`;
  if (taken.badges.length > 0) {
    await sql`
      UPDATE user_achievements SET told_at = NULL
      WHERE user_id = ${userId} AND code IN ${sql(taken.badges)} AND told_at = ${at}`;
  }
}

/** The week's summary is not sent (two weeks with nothing done): it is had for the week. */
export async function skipSummary(sql: SqlOrTx, userId: string, monday: string): Promise<void> {
  await sql`
    UPDATE users SET summary_week = ${monday}::date
    WHERE id = ${userId} AND (summary_week IS NULL OR summary_week < ${monday}::date)`;
}

/** Whether the person did anything that keeps a streak today on their clock: a workout, a run that counts,
 *  or a visit (Kd 2026-09-01). `since`: a bound well before the day began, for the index. */
export async function activeOn(sql: SqlOrTx, userId: string, zone: string, day: string, since: Date, runFromM: number): Promise<boolean> {
  const rows = await sql<{ yes: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM workouts WHERE user_id = ${userId} AND started_at >= ${since}
        AND (started_at AT TIME ZONE ${zone})::date = ${day}::date
    ) OR EXISTS (
      SELECT 1 FROM runs WHERE user_id = ${userId} AND started_at >= ${since}
        AND distance_m >= ${runFromM} AND run_calc_version IS NOT NULL
        AND (started_at AT TIME ZONE ${zone})::date = ${day}::date
    ) OR EXISTS (
      SELECT 1 FROM gym_attendance WHERE user_id = ${userId} AND day = ${day}::date
    ) AS yes`;
  return rows[0]?.yes === true;
}

export interface WeekCounts {
  workouts: number;
  runs: number;
  visits: number;
}

/** Each person's workouts, counted runs and days they visited a place, in the week from `monday` and the
 *  week before it, on `zone`'s clock: one read for everybody whose summary is due in that zone. */
export async function twoWeeksOf(
  sql: SqlOrTx,
  input: { userIds: readonly string[]; zone: string; monday: string; runFromM: number },
): Promise<Map<string, { thisWeek: WeekCounts; lastWeek: WeekCounts }>> {
  const { userIds, zone, monday, runFromM } = input;
  const out = new Map<string, { thisWeek: WeekCounts; lastWeek: WeekCounts }>();
  if (userIds.length === 0) return out;
  const rows = await sql<{ user_id: string; this_w: number; last_w: number; this_r: number; last_r: number; this_v: number; last_v: number }[]>`
    SELECT p.user_id, w.this_w, w.last_w, r.this_r, r.last_r, v.this_v, v.last_v
    FROM unnest(${userIds}::uuid[]) AS p(user_id)
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE x.d >= ${monday}::date)::int AS this_w, count(*) FILTER (WHERE x.d < ${monday}::date)::int AS last_w
      FROM (SELECT (started_at AT TIME ZONE ${zone})::date AS d FROM workouts
            WHERE user_id = p.user_id AND started_at >= (${monday}::date - 8)::timestamp AT TIME ZONE 'UTC') x
      WHERE x.d BETWEEN ${monday}::date - 7 AND ${monday}::date + 6
    ) w
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE x.d >= ${monday}::date)::int AS this_r, count(*) FILTER (WHERE x.d < ${monday}::date)::int AS last_r
      FROM (SELECT (started_at AT TIME ZONE ${zone})::date AS d FROM runs
            WHERE user_id = p.user_id AND distance_m >= ${runFromM} AND run_calc_version IS NOT NULL
              AND started_at >= (${monday}::date - 8)::timestamp AT TIME ZONE 'UTC') x
      WHERE x.d BETWEEN ${monday}::date - 7 AND ${monday}::date + 6
    ) r
    CROSS JOIN LATERAL (
      SELECT count(DISTINCT day) FILTER (WHERE day >= ${monday}::date)::int AS this_v,
             count(DISTINCT day) FILTER (WHERE day < ${monday}::date)::int AS last_v
      FROM gym_attendance WHERE user_id = p.user_id AND day BETWEEN ${monday}::date - 7 AND ${monday}::date + 6
    ) v`;
  for (const row of rows) {
    out.set(row.user_id, {
      thisWeek: { workouts: row.this_w, runs: row.this_r, visits: row.this_v },
      lastWeek: { workouts: row.last_w, runs: row.last_r, visits: row.last_v },
    });
  }
  return out;
}
