// P2.3 — gamification repo: the ONLY file that touches streaks /
// user_achievements, plus the read-side stats aggregates over the workout
// tables that the badge evaluator needs (reads only — workout writes stay in
// the workouts repo). Every query keyed by userId (R3.2).
import type { Sql, TransactionSql } from "postgres";
import type { StreakState } from "./streak.js";
import { EMPTY_STREAK } from "./streak.js";

// A pooled handle OR a transaction context — safe for plain reads. The FOR
// UPDATE lock below is typed TransactionSql (NOT this), because on a pooled
// handle FOR UPDATE autocommits and releases the lock immediately (the DPDP
// round-5 lesson, DECISIONS 2026-07-23).
type SqlOrTx = Sql | TransactionSql;

interface StreakDbRow {
  current: number;
  longest: number;
  last_activity_date: string | null; // date column → 'YYYY-MM-DD'
  freezes_available: number;
}

const toState = (r: StreakDbRow | undefined): StreakState =>
  r === undefined
    ? EMPTY_STREAK
    : {
        current: r.current,
        longest: r.longest,
        lastActivityDate: r.last_activity_date,
        freezesAvailable: r.freezes_available,
      };

/** Row-locked read inside the caller's transaction: two concurrent syncs of
 *  the same user serialize here — no lost streak increments. */
export async function getStreakForUpdate(tx: TransactionSql, userId: string): Promise<StreakState> {
  const rows = await tx<StreakDbRow[]>`
    SELECT current, longest, last_activity_date::text, freezes_available
    FROM streaks WHERE user_id = ${userId} FOR UPDATE`;
  return toState(rows[0]);
}

export async function upsertStreak(
  tx: TransactionSql,
  userId: string,
  state: StreakState,
): Promise<void> {
  await tx`
    INSERT INTO streaks (user_id, current, longest, last_activity_date, freezes_available, updated_at)
    VALUES (${userId}, ${state.current}, ${state.longest}, ${state.lastActivityDate},
            ${state.freezesAvailable}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      current = EXCLUDED.current,
      longest = EXCLUDED.longest,
      last_activity_date = EXCLUDED.last_activity_date,
      freezes_available = EXCLUDED.freezes_available,
      updated_at = now()`;
}

export interface EarnedRow {
  code: string;
  earnedAt: Date;
}

export async function listEarned(sql: SqlOrTx, userId: string): Promise<EarnedRow[]> {
  const rows = await sql<{ code: string; earned_at: Date }[]>`
    SELECT code, earned_at FROM user_achievements
    WHERE user_id = ${userId} ORDER BY earned_at ASC, code ASC`;
  return rows.map((r) => ({ code: r.code, earnedAt: r.earned_at }));
}

/** Idempotent award (R3.5): a retried sync re-inserting the same codes is a
 *  no-op; earned_at keeps the FIRST earn. */
export async function awardAchievements(sql: Sql, userId: string, codes: string[]): Promise<void> {
  for (const code of codes) {
    await sql`
      INSERT INTO user_achievements (user_id, code)
      VALUES (${userId}, ${code})
      ON CONFLICT (user_id, code) DO NOTHING`;
  }
}

/** Serialize XP recompute for ONE user across concurrent syncs, via an advisory
 *  TRANSACTION lock. It serializes whether or not the user_xp row exists yet —
 *  unlike `SELECT … FOR UPDATE`, which locks NOTHING on a first-ever sync (no
 *  row to lock) and let two first-syncs race to a lost update (T3 F1). The XP
 *  value is not read here: recompute derives it in full from committed rows, so
 *  the lock only has to make the read-then-upsert atomic against another sync.
 *
 *  Typed TransactionSql, NOT SqlOrTx (T3 F2). The lock is TRANSACTION-scoped:
 *  on a POOLED handle it would be taken and released inside one implicit
 *  transaction and serialize NOTHING. Round 1 of this card widened the type so
 *  a reserved-connection test could drive it and left a COMMENT in place of the
 *  guard — which is precisely the trade the DPDP round-5 review flagged as a
 *  silent footgun (DECISIONS 2026-07-23). The type makes the misuse
 *  unrepresentable instead; the test drives two real `sql.begin` transactions. */
export async function lockXpForUser(tx: TransactionSql, userId: string): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`xp:${userId}`}))`;
}

export async function upsertXp(tx: TransactionSql, userId: string, totalXp: number): Promise<void> {
  await tx`
    INSERT INTO user_xp (user_id, total_xp, updated_at)
    VALUES (${userId}, ${totalXp}, now())
    ON CONFLICT (user_id) DO UPDATE SET total_xp = EXCLUDED.total_xp, updated_at = now()`;
}

/** Read total_xp (no lock) for the /me read; 0 when the user has never synced. */
export async function getXp(sql: SqlOrTx, userId: string): Promise<number> {
  const rows = await sql<{ total_xp: number }[]>`
    SELECT total_xp FROM user_xp WHERE user_id = ${userId}`;
  return rows[0]?.total_xp ?? 0;
}

/** Workout-side XP accrual counts (base + form bonuses), badges.py-faithful:
 *  avg_form_score >= 100 → perfect (+50), 80..99 → excellent (+20), mutually
 *  exclusive (workouts.py:222-225). A NULL score counts toward the base but
 *  earns no bonus (matches the old form_accuracy default of 0). */
export async function getXpAccrualCounts(
  sql: SqlOrTx,
  userId: string,
): Promise<{ workoutCount: number; perfectFormWorkouts: number; excellentFormWorkouts: number }> {
  const [r] = await sql<{ workout_count: string; perfect: string; excellent: string }[]>`
    SELECT count(*) AS workout_count,
           count(*) FILTER (WHERE avg_form_score >= 100) AS perfect,
           count(*) FILTER (WHERE avg_form_score >= 80 AND avg_form_score < 100) AS excellent
    FROM workouts WHERE user_id = ${userId}`;
  return {
    workoutCount: Number(r?.workout_count ?? 0),
    perfectFormWorkouts: Number(r?.perfect ?? 0),
    excellentFormWorkouts: Number(r?.excellent ?? 0),
  };
}

/** Distinct qualifying-activity days ('YYYY-MM-DD', user TZ) — the §3.5
 *  replay input. Today: workouts; runs/F12 sessions join the UNION when
 *  their modules land. timeZone is safeTimeZone-validated, bound as a value. */
export async function getActivityDays(
  tx: TransactionSql,
  userId: string,
  timeZone: string,
): Promise<string[]> {
  const rows = await tx<{ day: string }[]>`
    SELECT DISTINCT to_char(started_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day
    FROM workouts WHERE user_id = ${userId} ORDER BY day ASC`;
  return rows.map((r) => r.day);
}

/** Badge-evaluator stats from PG (badges.py stats keys, SQL-derived).
 *  timeZone is a validated IANA name (safeTimeZone) — parameterized value,
 *  used only for the §3.1 user-local day/hour bucketing. */
export async function getStats(
  sql: Sql,
  userId: string,
  timeZone: string,
): Promise<Record<string, number>> {
  const [agg] = await sql<
    {
      total_workouts: string;
      total_kcal: string;
      perfect_form_count: string;
      morning_workouts: string;
      night_workouts: string;
    }[]
  >`
    SELECT count(*) AS total_workouts,
           coalesce(sum(kcal_point), 0) AS total_kcal,
           count(*) FILTER (WHERE avg_form_score = 100) AS perfect_form_count,
           -- badges.py:129 "before 8am" / :137 "after 9pm" (R0.4)
           count(*) FILTER (WHERE extract(hour FROM started_at AT TIME ZONE ${timeZone}) < 8)
             AS morning_workouts,
           count(*) FILTER (WHERE extract(hour FROM started_at AT TIME ZONE ${timeZone}) >= 21)
             AS night_workouts
    FROM workouts WHERE user_id = ${userId}`;
  const [form] = await sql<{ avg_form_last5: string | null }[]>`
    SELECT avg(avg_form_score) AS avg_form_last5 FROM (
      SELECT avg_form_score FROM workouts
      WHERE user_id = ${userId} AND avg_form_score IS NOT NULL
      ORDER BY started_at DESC LIMIT 5) last5`;
  const [fam] = await sql<{ families_tried: string }[]>`
    SELECT count(DISTINCT e.family) AS families_tried
    FROM workout_sets s JOIN exercises e ON e.id = s.exercise_id
    WHERE s.user_id = ${userId}`;
  const [meals] = await sql<{ total_meals: string; photo_meals_logged: string }[]>`
    SELECT count(*) AS total_meals,
           count(*) FILTER (WHERE origin = 'photo') AS photo_meals_logged
    FROM meal_logs WHERE user_id = ${userId}`;
  return {
    total_workouts: Number(agg?.total_workouts ?? 0),
    total_kcal: Number(agg?.total_kcal ?? 0),
    perfect_form_count: Number(agg?.perfect_form_count ?? 0),
    morning_workouts: Number(agg?.morning_workouts ?? 0),
    night_workouts: Number(agg?.night_workouts ?? 0),
    avg_form_last5: form?.avg_form_last5 === null || form === undefined ? 0 : Number(form.avg_form_last5),
    families_tried: Number(fam?.families_tried ?? 0),
    total_meals: Number(meals?.total_meals ?? 0),
    photo_meals_logged: Number(meals?.photo_meals_logged ?? 0),
  };
}
