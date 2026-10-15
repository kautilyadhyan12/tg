// A gym gone for good (ROADMAP Stage 4 item 14): the only file of it that touches the
// database. `sweep.ts` decides; this reads and writes.
import type { Sql, TransactionSql } from "postgres";

type SqlOrTx = Sql | TransactionSql;

/** How long a gym with no plan and no sign-in keeps its list (Kd, RULINGS 2026-10-02). */
export const GONE_AFTER_MONTHS = 6;
/** The first email goes this many days before the day it names. */
export const FIRST_NOTICE_DAYS = 30;

export interface DueGym {
  gymId: string;
  /** The later of the plan's end (the gym's start, with no plan ever) and its staff's
   *  last sign-in. */
  countedFrom: Date;
  /** `countedFrom` and six calendar months, in UTC. */
  dueAt: Date;
}

/** The gyms whose first email is due by `now`, and whose list this round has not
 *  already deleted. A gym on a live plan is never here; nor is a gym with an ended plan
 *  nobody dated, since its six months cannot be counted.
 *
 *  A sign-in is `users.last_active_at` of any of its staff: written at every sign-in and
 *  session renewal, at most once an hour (`auth/repo.ts` `markUsed`). Never the
 *  `refresh_tokens` rows, which the spec's retention deletes 30 days after they expire. */
export async function dueGyms(sql: SqlOrTx, now: Date, gymIds: readonly string[] | null): Promise<DueGym[]> {
  const rows = await sql<{ gym_id: string; counted_from: Date; due_at: Date }[]>`
    WITH plans AS (
      -- Every gym's plans in one pass: whether one is live, whether one ended undated, and
      -- the latest end.
      SELECT s.owner_id,
        bool_or(s.status IN ('trialing','active','past_due')) AS live,
        bool_or(s.ended_at IS NULL AND s.status NOT IN ('trialing','active','past_due')) AS undated,
        max(s.ended_at) AS ended_at
      FROM subscriptions s
      WHERE s.owner_type = 'gym' AND (${gymIds}::uuid[] IS NULL OR s.owner_id = ANY(${gymIds}::uuid[]))
      GROUP BY s.owner_id
    ), dark AS (
      -- To the thousandth of a second, as a JavaScript Date holds it: the round is matched
      -- on this value when it comes back.
      SELECT g.id,
        date_trunc('milliseconds', GREATEST(
          CASE WHEN p.owner_id IS NULL THEN g.created_at ELSE p.ended_at END,
          (SELECT max(u.last_active_at) FROM gym_staff st JOIN users u ON u.id = st.user_id
            WHERE st.gym_id = g.id)
        )) AS counted_from
      FROM gyms g LEFT JOIN plans p ON p.owner_id = g.id
      WHERE (${gymIds}::uuid[] IS NULL OR g.id = ANY(${gymIds}::uuid[]))
        AND NOT coalesce(p.live, false)
        AND NOT coalesce(p.undated, false)
    ), timed AS (
      SELECT id, counted_from,
        ((counted_from AT TIME ZONE 'UTC') + ${GONE_AFTER_MONTHS} * INTERVAL '1 month') AT TIME ZONE 'UTC' AS due_at
      FROM dark
    )
    SELECT t.id AS gym_id, t.counted_from, t.due_at
    FROM timed t
    WHERE t.due_at - ${FIRST_NOTICE_DAYS} * INTERVAL '1 day' <= ${now}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM gym_gone_for_good d
        WHERE d.gym_id = t.id AND d.list_deleted_at IS NOT NULL AND d.list_deleted_at >= t.counted_from)
    ORDER BY t.id`;
  return rows.map((r) => ({ gymId: r.gym_id, countedFrom: r.counted_from, dueAt: r.due_at }));
}

export interface Round {
  countedFrom: Date;
  deletesAt: Date | null;
  monthClaimedAt: Date | null;
  monthSentAt: Date | null;
  weekClaimedAt: Date | null;
  weekSentAt: Date | null;
}

interface RoundRow {
  counted_from: Date;
  deletes_at: Date | null;
  month_claimed_at: Date | null;
  month_sent_at: Date | null;
  week_claimed_at: Date | null;
  week_sent_at: Date | null;
}

/** This round's row, made or started again: a `countedFrom` that moved (a sign-in, a
 *  plan) clears both emails and the day they named. Locked for the caller's transaction. */
export async function roundFor(tx: TransactionSql, gymId: string, countedFrom: Date): Promise<Round> {
  await tx`
    INSERT INTO gym_gone_for_good (gym_id, counted_from) VALUES (${gymId}, ${countedFrom})
    ON CONFLICT (gym_id) DO UPDATE
    SET counted_from = EXCLUDED.counted_from, deletes_at = NULL,
        month_claimed_at = NULL, month_sent_at = NULL, month_recipients = NULL,
        week_claimed_at = NULL, week_sent_at = NULL, week_recipients = NULL
    WHERE gym_gone_for_good.counted_from IS DISTINCT FROM EXCLUDED.counted_from`;
  const [row] = await tx<RoundRow[]>`
    SELECT counted_from, deletes_at, month_claimed_at, month_sent_at, week_claimed_at, week_sent_at
    FROM gym_gone_for_good WHERE gym_id = ${gymId} FOR UPDATE`;
  if (row === undefined) throw new Error("gone-for-good round missing after its upsert");
  return {
    countedFrom: row.counted_from,
    deletesAt: row.deletes_at,
    monthClaimedAt: row.month_claimed_at,
    monthSentAt: row.month_sent_at,
    weekClaimedAt: row.week_claimed_at,
    weekSentAt: row.week_sent_at,
  };
}

export type Notice = "month" | "week";

/** The database's own clock, read under the gym's lock: what a claim is stamped with and
 *  timed against, so a run that started long ago never makes another run's claim look old. */
export async function claimClock(tx: TransactionSql): Promise<Date> {
  const [row] = await tx<{ at: Date }[]>`SELECT date_trunc('milliseconds', clock_timestamp()) AS at`;
  if (row === undefined) throw new Error("clock_timestamp returned no row");
  return row.at;
}

/** The email is about to go: its claim, and the day it will name. */
export async function claimNotice(tx: TransactionSql, gymId: string, notice: Notice, at: Date, deletesAt: Date): Promise<void> {
  if (notice === "month") {
    await tx`UPDATE gym_gone_for_good SET month_claimed_at = ${at}, deletes_at = ${deletesAt} WHERE gym_id = ${gymId}`;
  } else {
    await tx`UPDATE gym_gone_for_good SET week_claimed_at = ${at}, deletes_at = ${deletesAt} WHERE gym_id = ${gymId}`;
  }
}

/** The email went to `recipients` people. Only the claim it was sent under is marked: a
 *  round started again meanwhile is left as it is. False when nothing was marked. */
export async function markSent(
  sql: SqlOrTx,
  input: { gymId: string; notice: Notice; countedFrom: Date; claimedAt: Date; recipients: number; at: Date },
): Promise<boolean> {
  const rows =
    input.notice === "month"
      ? await sql`
          UPDATE gym_gone_for_good SET month_sent_at = ${input.at}, month_recipients = ${input.recipients}
          WHERE gym_id = ${input.gymId} AND counted_from = ${input.countedFrom} AND month_claimed_at = ${input.claimedAt}
          RETURNING gym_id`
      : await sql`
          UPDATE gym_gone_for_good SET week_sent_at = ${input.at}, week_recipients = ${input.recipients}
          WHERE gym_id = ${input.gymId} AND counted_from = ${input.countedFrom} AND week_claimed_at = ${input.claimedAt}
          RETURNING gym_id`;
  return rows.length > 0;
}

/** Nothing went: the claim is let go, and the next run tries again. */
export async function releaseClaim(
  sql: SqlOrTx,
  input: { gymId: string; notice: Notice; countedFrom: Date; claimedAt: Date },
): Promise<void> {
  if (input.notice === "month") {
    await sql`
      UPDATE gym_gone_for_good SET month_claimed_at = NULL
      WHERE gym_id = ${input.gymId} AND counted_from = ${input.countedFrom} AND month_claimed_at = ${input.claimedAt}
        AND month_sent_at IS NULL`;
  } else {
    await sql`
      UPDATE gym_gone_for_good SET week_claimed_at = NULL
      WHERE gym_id = ${input.gymId} AND counted_from = ${input.countedFrom} AND week_claimed_at = ${input.claimedAt}
        AND week_sent_at IS NULL`;
  }
}

export async function markListDeleted(tx: TransactionSql, gymId: string, at: Date): Promise<void> {
  await tx`UPDATE gym_gone_for_good SET list_deleted_at = ${at} WHERE gym_id = ${gymId}`;
}

export interface NoticeGym {
  name: string;
  slug: string;
  orgType: string;
  timezone: string;
}

export async function noticeGym(sql: SqlOrTx, gymId: string): Promise<NoticeGym | null> {
  const [row] = await sql<{ name: string; slug: string; org_type: string; timezone: string }[]>`
    SELECT name, slug, org_type, timezone FROM gyms WHERE id = ${gymId}`;
  return row === undefined ? null : { name: row.name, slug: row.slug, orgType: row.org_type, timezone: row.timezone };
}

/** The gym's staff whose address is proved (a sign-in code, Google or the verification
 *  link: the marker `auth/repo.ts` `recordVerifiedEmail` keeps), for the ticks the sweep
 *  checks. An address typed at `POST /v1/auth/register` and never proved may be anybody's,
 *  so it is never emailed, and its gym is then never emptied. */
export async function staffWithEmail(sql: SqlOrTx, gymId: string): Promise<{ userId: string; email: string }[]> {
  const rows = await sql<{ user_id: string; email: string }[]>`
    SELECT s.user_id, u.email::text AS email FROM gym_staff s JOIN users u ON u.id = s.user_id
    WHERE s.gym_id = ${gymId} AND u.status = 'active' AND u.email IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM one_time_tokens t
        WHERE t.user_id = u.id AND t.purpose = 'verify_email' AND t.used_at IS NOT NULL)
    ORDER BY u.email`;
  return rows.map((r) => ({ userId: r.user_id, email: r.email }));
}

/** Was one of these people told about ANOTHER gym too recently for a second email tonight:
 *  staff at a gym whose email went in the 20 hours to `now` (the night's clock, which
 *  stamps `*_sent_at`), or is going now (a claim under an hour old by the database's clock
 *  with nothing marked sent). Kept in the database, so a retry or a second run the same
 *  night sees it; two runs at once each claim before they ask, so at most one sends. */
export async function toldElsewhereTonight(sql: SqlOrTx, gymId: string, userIds: readonly string[], now: Date): Promise<boolean> {
  const rows = await sql<{ told: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM gym_staff s JOIN gym_gone_for_good d ON d.gym_id = s.gym_id
      WHERE s.user_id = ANY(${userIds}::uuid[]) AND s.gym_id <> ${gymId}
        AND (
          (d.month_sent_at > ${now}::timestamptz - INTERVAL '20 hours' AND d.month_sent_at <= ${now}::timestamptz)
          OR (d.week_sent_at > ${now}::timestamptz - INTERVAL '20 hours' AND d.week_sent_at <= ${now}::timestamptz)
          OR (d.month_sent_at IS NULL AND d.month_claimed_at > clock_timestamp() - INTERVAL '1 hour')
          OR (d.week_sent_at IS NULL AND d.week_claimed_at > clock_timestamp() - INTERVAL '1 hour')
        )
    ) AS told`;
  return rows[0]?.told ?? true;
}

/** When this gym's list was last deleted for being gone for good, or null. */
export async function listDeletedAt(sql: SqlOrTx, gymId: string): Promise<Date | null> {
  const [row] = await sql<{ list_deleted_at: Date | null }[]>`
    SELECT list_deleted_at FROM gym_gone_for_good WHERE gym_id = ${gymId}`;
  return row?.list_deleted_at ?? null;
}
