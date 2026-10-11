// WHOSE VISIT IT IS, AND THE STREAK (spec Part 3 §15.5). One rule each, used by the
// leaderboard and by the console's "On a roll", so the two never show different numbers.
// Attendance and Overview count a person as their account OR their record (16b-ii), which
// is a head count for staff, not this rule.
import type { Sql, TransactionSql } from "postgres";

type SqlOrTx = Sql | TransactionSql;

/** The visits a board counts: the desk's scans and staff check-ins. The member's own old
 *  "I'm here" tap (`manual`) and the app's code (`qr`) never count. */
export const COUNTED_METHODS = ["pass", "key_tag", "staff"] as const;

/** The gym's weeks (Mondays) up to `today`: a week in which the desk or staff checked
 *  somebody in at the time. A visit added on a later day makes no week the gym's. */
export function gymWeeks(sql: SqlOrTx, gymId: string, today: string) {
  return sql`
    SELECT DISTINCT date_trunc('week', a.day)::date AS wk
    FROM gym_attendance a
    WHERE a.gym_id = ${gymId} AND a.method IN ('pass','key_tag','staff')
      AND a.hours_status <> 'added_later' AND a.day <= ${today}::date`;
}

/** Each record held by exactly ONE live app member of the gym: (entry_id, user_id). */
export function soloHolders(sql: SqlOrTx, gymId: string) {
  return sql`
    SELECT m.entry_id, min(m.user_id::text)::uuid AS user_id
    FROM gym_members m JOIN users u ON u.id = m.user_id AND u.status = 'active'
    WHERE m.gym_id = ${gymId} AND m.removed_at IS NULL AND m.entry_id IS NOT NULL
    GROUP BY m.entry_id
    HAVING count(*) = 1`;
}

/** Every visit at the gym, with `owner_id`: the visit's `user_id`, or, when it has none,
 *  the one live app member holding its record (`gym_members.entry_id`). A record two live
 *  members hold (a household) gives its account-less visits to nobody. */
export function visitsWithOwner(sql: SqlOrTx, gymId: string) {
  return sql`
    SELECT a.id, a.day, a.marked_at, a.method, a.hours_status, a.device_id, a.marked_by_user_id,
           coalesce(a.user_id, solo.user_id) AS owner_id
    FROM gym_attendance a
    LEFT JOIN (${soloHolders(sql, gymId)}) solo ON a.user_id IS NULL AND solo.entry_id = a.entry_id
    WHERE a.gym_id = ${gymId}`;
}

/** Every visit staff removed at the gym (19a-iv), with the owner the same rule gives it. */
export function removedVisitsWithOwner(sql: SqlOrTx, gymId: string) {
  return sql`
    SELECT r.id, r.day, r.marked_at, r.removed_at, r.removed_by_user_id,
           coalesce(r.user_id, solo.user_id) AS owner_id
    FROM gym_attendance_removed r
    LEFT JOIN (${soloHolders(sql, gymId)}) solo ON r.user_id IS NULL AND solo.entry_id = r.entry_id
    WHERE r.gym_id = ${gymId}`;
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
 *  week since `sinceWeek` or a live streak.
 *
 *  A visit staff added on a later day (19a-iv) counts for its own person and never makes a
 *  silent week the gym's: fixing one person's week must not break everybody else's streak. */
export function streaks(sql: SqlOrTx, gymId: string, today: string, sinceWeek: string) {
  return sql`
    -- One read of the visits: each (owner, week), a null owner standing for visits that
    -- are nobody's in the app, which still make the week the gym's.
    WITH cw AS MATERIALIZED (
      SELECT v.owner_id, date_trunc('week', v.day)::date AS wk,
             bool_or(v.hours_status <> 'added_later') AS at_the_time
      FROM (${visitsWithOwner(sql, gymId)}) v
      WHERE v.method IN ('pass','key_tag','staff') AND v.day <= ${today}::date
      GROUP BY 1, 2
    ),
    gw AS (
      SELECT wk, row_number() OVER (ORDER BY wk DESC)::int AS gi
      FROM (SELECT DISTINCT wk FROM cw WHERE at_the_time) w
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
      SELECT pw.owner_id, array_agg(pw.wk::text ORDER BY pw.wk) AS recent
      FROM pw JOIN gw ON gw.wk = pw.wk
      WHERE pw.wk >= ${sinceWeek}::date
      GROUP BY pw.owner_id
    )
    SELECT coalesce(alive.owner_id, recent.owner_id) AS owner_id,
           coalesce(alive.weeks, 0) AS weeks,
           alive.from_week,
           coalesce(recent.recent, '{}'::text[]) AS recent
    FROM alive FULL JOIN recent ON recent.owner_id = alive.owner_id`;
}
