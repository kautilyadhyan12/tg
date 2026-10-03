// WHOSE VISIT IT IS, AND THE STREAK (spec Part 3 §15.5). One rule each, used by the
// leaderboard and by the console's "On a roll", so the two never show different numbers.
// Attendance and Overview count a person as their account OR their record (16b-ii), which
// is a head count for staff, not this rule.
import type { Sql, TransactionSql } from "postgres";

type SqlOrTx = Sql | TransactionSql;

/** The visits a board counts: the desk's scans and staff check-ins. The member's own old
 *  "I'm here" tap (`manual`) and the app's code (`qr`) never count. */
export const COUNTED_METHODS = ["pass", "key_tag", "staff"] as const;

/** Every visit at the gym, with `owner_id`: the visit's `user_id`, or, when it has none,
 *  the one live app member holding its record (`gym_members.entry_id`). A record two live
 *  members hold (a household) gives its account-less visits to nobody. */
export function visitsWithOwner(sql: SqlOrTx, gymId: string) {
  return sql`
    SELECT a.id, a.day, a.marked_at, a.method, a.device_id, a.marked_by_user_id,
           coalesce(a.user_id, solo.user_id) AS owner_id
    FROM gym_attendance a
    LEFT JOIN (
      SELECT m.entry_id, min(m.user_id::text)::uuid AS user_id
      FROM gym_members m JOIN users u ON u.id = m.user_id AND u.status = 'active'
      WHERE m.gym_id = ${gymId} AND m.removed_at IS NULL AND m.entry_id IS NOT NULL
      GROUP BY m.entry_id
      HAVING count(*) = 1
    ) solo ON a.user_id IS NULL AND solo.entry_id = a.entry_id
    WHERE a.gym_id = ${gymId}`;
}

/** Every counted visit with its owner: (owner_id, day), up to and including `today`. */
function countedVisits(sql: SqlOrTx, gymId: string, today: string) {
  return sql`
    SELECT v.owner_id, v.day
    FROM (${visitsWithOwner(sql, gymId)}) v
    WHERE v.method IN ('pass','key_tag','staff') AND v.owner_id IS NOT NULL AND v.day <= ${today}::date`;
}

/** Each person's gym days: (owner_id, day), one row a day, up to and including `today`. */
export function countedDays(sql: SqlOrTx, gymId: string, today: string) {
  return sql`SELECT DISTINCT c.owner_id, c.day FROM (${countedVisits(sql, gymId, today)}) c`;
}

/** Each person's streak now and their gym weeks since `sinceWeek`: (owner_id, weeks,
 *  from_week, recent). A gym week is a Monday-to-Sunday in which the gym counted a visit
 *  by anybody, app or not; a week with none is skipped by every streak, neither counting
 *  nor breaking it. `weeks` counts the gym's weeks in a row ending with this week or
 *  the gym week before it — last week keeps a streak alive until this Sunday ends — and
 *  is 0 with `from_week` null when no streak is alive. One row for everybody with a gym
 *  week since `sinceWeek` or a live streak. */
export function streaks(sql: SqlOrTx, gymId: string, today: string, sinceWeek: string) {
  return sql`
    -- One read of the visits: each (owner, week), a null owner standing for visits that
    -- are nobody's in the app, which still make the week the gym's.
    WITH cw AS MATERIALIZED (
      SELECT v.owner_id, date_trunc('week', v.day)::date AS wk
      FROM (${visitsWithOwner(sql, gymId)}) v
      WHERE v.method IN ('pass','key_tag','staff') AND v.day <= ${today}::date
      GROUP BY 1, 2
    ),
    gw AS (
      SELECT wk, row_number() OVER (ORDER BY wk DESC)::int AS gi
      FROM (SELECT DISTINCT wk FROM cw) w
    ),
    pw AS (
      SELECT owner_id, wk FROM cw WHERE owner_id IS NOT NULL
    ),
    isl AS (
      SELECT pw.owner_id, pw.wk, gw.gi,
             gw.gi - (row_number() OVER (PARTITION BY pw.owner_id ORDER BY gw.gi))::int AS grp
      FROM pw JOIN gw ON gw.wk = pw.wk
    ),
    runs AS (
      SELECT owner_id, min(gi) AS first_gi, count(*)::int AS weeks, min(wk) AS from_week
      FROM isl GROUP BY owner_id, grp
    ),
    alive AS (
      SELECT r.owner_id, r.weeks, r.from_week
      FROM runs r
      WHERE r.first_gi = 1
         OR (r.first_gi = 2
             AND (SELECT gw.wk FROM gw WHERE gw.gi = 1) = date_trunc('week', ${today}::date)::date)
    ),
    recent AS (
      SELECT owner_id, array_agg(wk::text ORDER BY wk) AS recent
      FROM pw WHERE wk >= ${sinceWeek}::date
      GROUP BY owner_id
    )
    SELECT coalesce(alive.owner_id, recent.owner_id) AS owner_id,
           coalesce(alive.weeks, 0) AS weeks,
           alive.from_week,
           coalesce(recent.recent, '{}'::text[]) AS recent
    FROM alive FULL JOIN recent ON recent.owner_id = alive.owner_id`;
}
