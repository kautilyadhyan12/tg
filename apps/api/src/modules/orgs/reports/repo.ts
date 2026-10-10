// The Reports page's reads (ROADMAP 21a-i): counts of the gym's member list and its leads.
// Every read names the gym in the WHERE and returns counts, never a person.
import type { Sql } from "postgres";
import { z } from "zod";
import { REPORT_MONTHS } from "@app/shared";

const count = z.number().int().min(0);
const countsRowSchema = z.object({
  today: z.string(),
  months: z.array(z.object({ month: z.string(), activeAtStart: count, joined: count, left: count, leftOfStart: count })),
  active_now: count,
  ever_left: z.boolean(),
  first_listed_on: z.string().nullable(),
  list_changed_on: z.string().nullable(),
  stay_leavers: count,
  stay_days: z.number().min(0),
});
export type MemberCounts = z.infer<typeof countsRowSchema>;

/** The gym's list counted month by month on the gym's own calendar, in one pass.
 *
 *  A person starts on the join date the gym gave, when it is earlier than the day they
 *  went on the list, and otherwise on that day; they leave on the day they came off. A
 *  month's "at its start" is everybody who had started before its first day and had not
 *  left before it. */
export async function readMemberCounts(sql: Sql, gymId: string, timezone: string, now: Date): Promise<MemberCounts> {
  const rows = await sql<Record<string, unknown>[]>`
    WITH clock AS (
      SELECT (${now}::timestamptz AT TIME ZONE ${timezone})::date AS today,
             date_trunc('month', ${now}::timestamptz AT TIME ZONE ${timezone})::date AS this_month
    ),
    people AS MATERIALIZED (
      SELECT LEAST(e.joined_on, (e.created_at AT TIME ZONE ${timezone})::date) AS started,
             (e.created_at AT TIME ZONE ${timezone})::date AS listed_on,
             (e.former_at AT TIME ZONE ${timezone})::date AS left_on
      FROM gym_member_list_entries e
      WHERE e.gym_id = ${gymId}
    ),
    months AS (
      SELECT (c.this_month - make_interval(months => n))::date AS first_day,
             (c.this_month - make_interval(months => n - 1))::date AS next_first
      FROM clock c, generate_series(0, ${REPORT_MONTHS - 1}) AS n
    ),
    by_month AS (
      SELECT m.first_day,
        (count(p.started) FILTER (WHERE p.started < m.first_day AND (p.left_on IS NULL OR p.left_on >= m.first_day)))::int AS active_at_start,
        (count(p.started) FILTER (WHERE p.started >= m.first_day AND p.started < m.next_first))::int AS joined,
        (count(p.started) FILTER (WHERE p.left_on >= m.first_day AND p.left_on < m.next_first))::int AS left_count,
        (count(p.started) FILTER (WHERE p.started < m.first_day AND p.left_on >= m.first_day AND p.left_on < m.next_first))::int AS left_of_start
      FROM months m
      LEFT JOIN people p ON true
      GROUP BY m.first_day
    ),
    shown AS (SELECT min(first_day) AS from_day FROM months)
    SELECT to_char(c.today, 'YYYY-MM-DD') AS today,
      (SELECT json_agg(json_build_object(
                'month', to_char(b.first_day, 'YYYY-MM'),
                'activeAtStart', b.active_at_start,
                'joined', b.joined,
                'left', b.left_count,
                'leftOfStart', b.left_of_start) ORDER BY b.first_day)
       FROM by_month b) AS months,
      (SELECT count(*)::int FROM people WHERE left_on IS NULL) AS active_now,
      EXISTS (SELECT 1 FROM people WHERE left_on IS NOT NULL) AS ever_left,
      (SELECT to_char(min(listed_on), 'YYYY-MM-DD') FROM people) AS first_listed_on,
      (SELECT to_char(GREATEST(max(listed_on), max(left_on)), 'YYYY-MM-DD') FROM people) AS list_changed_on,
      (SELECT count(*)::int FROM people p, shown s WHERE p.left_on >= s.from_day) AS stay_leavers,
      (SELECT COALESCE(sum(GREATEST(p.left_on - p.started, 0)), 0)::float8
       FROM people p, shown s WHERE p.left_on >= s.from_day) AS stay_days
    FROM clock c`;
  return countsRowSchema.parse(rows[0]);
}

export interface LeadCounts {
  source: string;
  leads: number;
  joined: number;
}

/** The gym's leads by where they came from, and how many of each are marked Joined. */
export async function readLeadCounts(sql: Sql, gymId: string): Promise<LeadCounts[]> {
  return await sql<LeadCounts[]>`
    SELECT source, count(*)::int AS leads, (count(*) FILTER (WHERE status = 'joined'))::int AS joined
    FROM gym_leads
    WHERE gym_id = ${gymId}
    GROUP BY source`;
}
