// The Reports page's reads (ROADMAP 21a-i, 21a-ii): counts of the gym's member list, its
// leads, its visits and its classes.
// Every read names the gym in the WHERE and returns counts, never a person.
import type { Sql } from "postgres";
import { z } from "zod";
import { REPORT_MONTHS, type AttendanceWindows, type ReportClassCounts } from "@app/shared";

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
 *  month's "at its start" is everybody who had started before its first day, had not left
 *  before it, and was on the list before the month ended: a list imported in September
 *  with last year's join dates fills no month before September, when nobody on it could
 *  have been seen to leave. */
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
        (count(p.started) FILTER (WHERE p.started < m.first_day AND p.listed_on < m.next_first
                                    AND (p.left_on IS NULL OR p.left_on >= m.first_day)))::int AS active_at_start,
        (count(p.started) FILTER (WHERE p.started >= m.first_day AND p.started < m.next_first))::int AS joined,
        (count(p.started) FILTER (WHERE p.left_on >= m.first_day AND p.left_on < m.next_first))::int AS left_count,
        (count(p.started) FILTER (WHERE p.started < m.first_day AND p.listed_on < m.next_first
                                    AND p.left_on >= m.first_day AND p.left_on < m.next_first))::int AS left_of_start
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

const visitClockSchema = z.object({ today: z.string(), first_visit_on: z.string().nullable() });

/** The gym's own day today, and the day of its first check-in. */
export async function readVisitClock(sql: Sql, gymId: string, timezone: string, now: Date): Promise<{ today: string; firstVisitOn: string | null }> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT to_char((${now}::timestamptz AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD') AS today,
           (SELECT to_char(min(a.day), 'YYYY-MM-DD') FROM gym_attendance a WHERE a.gym_id = ${gymId}) AS first_visit_on`;
  const row = visitClockSchema.parse(rows[0]);
  return { today: row.today, firstVisitOn: row.first_visit_on };
}

const visitCountsSchema = z.object({
  days: z.array(z.object({ day: z.string(), visits: count })),
  weeks: z.array(z.object({ weekStart: z.string(), visits: count, people: count })),
  hours: z.array(z.object({ weekday: z.number().int(), hour: z.number().int(), visits: count })),
  hours_no_time: count,
  members: count,
  member_visits: count,
  member_visitors: count,
});
export type VisitCounts = z.infer<typeof visitCountsSchema>;

/** The gym's visits counted over the report's windows, in two passes over the days shown.
 *
 *  A visit is a row of the Attendance page, so a day here and a day there are one number.
 *  A person is their record on the list, or their app account when the visit has none. A
 *  visit's hour is on the gym's clock; one staff added on a later day has no hour. Visits
 *  a member counts the people on the list today and only their visits.
 *
 *  The hours are counted by the quarter-hour first and put on the gym's clock after: every
 *  zone is a whole number of quarter-hours from UTC, and a few thousand quarter-hours are
 *  converted where every visit would have been. The member window is whole weeks, so the
 *  pass that counts people by the week serves it too. */
export async function readVisitCounts(
  sql: Sql,
  gymId: string,
  timezone: string,
  today: string,
  windows: AttendanceWindows,
): Promise<VisitCounts> {
  const hoursFrom = windows.hours?.from ?? null;
  const hoursTo = windows.hours?.to ?? null;
  const memberFrom = windows.member?.from ?? null;
  const memberTo = windows.member?.to ?? null;
  const rows = await sql<Record<string, unknown>[]>`
    WITH by_quarter AS MATERIALIZED (
      SELECT a.day,
             CASE WHEN a.day >= ${hoursFrom}::date AND a.day <= ${hoursTo}::date AND a.hours_status <> 'added_later'
                  THEN date_bin('15 minutes', a.marked_at, TIMESTAMPTZ '2000-01-01 00:00:00+00') END AS quarter,
             COALESCE(a.day >= ${hoursFrom}::date AND a.day <= ${hoursTo}::date AND a.hours_status = 'added_later', false) AS no_time,
             count(*)::int AS visits
      FROM gym_attendance a
      WHERE a.gym_id = ${gymId} AND a.day >= ${windows.weeksFrom}::date AND a.day <= ${today}::date
      GROUP BY 1, 2, 3
    ),
    by_person AS MATERIALIZED (
      SELECT (a.day - (extract(isodow FROM a.day)::int - 1)) AS week_start,
             COALESCE(a.entry_id, a.user_id) AS who, a.entry_id, count(*)::int AS visits
      FROM gym_attendance a
      WHERE a.gym_id = ${gymId} AND a.day >= ${windows.weeksFrom}::date AND a.day <= ${today}::date
      GROUP BY 1, 2, 3
    ),
    of_members AS (
      SELECT COALESCE(sum(p.visits), 0)::int AS visits, count(DISTINCT p.entry_id)::int AS visitors
      FROM by_person p
      JOIN gym_member_list_entries e ON e.id = p.entry_id AND e.gym_id = ${gymId} AND e.former_at IS NULL
      WHERE p.week_start >= ${memberFrom}::date AND p.week_start <= ${memberTo}::date
    )
    SELECT
      (SELECT COALESCE(json_agg(json_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'visits', d.visits)), '[]'::json)
       FROM (SELECT day, sum(visits)::int AS visits FROM by_quarter WHERE day >= ${windows.daysFrom}::date GROUP BY day) d) AS days,
      (SELECT COALESCE(json_agg(json_build_object('weekStart', to_char(w.week_start, 'YYYY-MM-DD'), 'visits', w.visits, 'people', w.people)), '[]'::json)
       FROM (SELECT week_start, sum(visits)::int AS visits, count(DISTINCT who)::int AS people FROM by_person GROUP BY 1) w) AS weeks,
      (SELECT COALESCE(json_agg(json_build_object('weekday', h.weekday, 'hour', h.hour, 'visits', h.visits)), '[]'::json)
       FROM (SELECT extract(isodow FROM day)::int AS weekday, extract(hour FROM quarter AT TIME ZONE ${timezone})::int AS hour, sum(visits)::int AS visits
             FROM by_quarter WHERE quarter IS NOT NULL GROUP BY 1, 2) h) AS hours,
      (SELECT COALESCE(sum(visits), 0)::int FROM by_quarter WHERE no_time) AS hours_no_time,
      (SELECT count(*)::int FROM gym_member_list_entries e WHERE e.gym_id = ${gymId} AND e.former_at IS NULL) AS members,
      (SELECT visits FROM of_members) AS member_visits,
      (SELECT visitors FROM of_members) AS member_visitors`;
  return visitCountsSchema.parse(rows[0]);
}

const classCountsSchema = z.object({
  name: z.string(),
  classes: count,
  limitedClasses: count,
  places: count,
  booked: count,
  bookings: count,
  attended: count,
  noShows: count,
});

/** Whether the gym has set up any class, and the classes that started from `fromDay` on
 *  the gym's calendar up to now, counted for each class the gym runs. A cancelled class
 *  is not counted; a place is taken while it is booked, came or no-show. */
export async function readClassCounts(
  sql: Sql,
  gymId: string,
  timezone: string,
  fromDay: string,
  now: Date,
): Promise<{ ever: boolean; types: ReportClassCounts[] }> {
  const ever = await sql<{ ever: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM gym_class_types t WHERE t.gym_id = ${gymId}) AS ever`;
  const rows = await sql<Record<string, unknown>[]>`
    SELECT t.name,
           count(*)::int AS classes,
           (count(*) FILTER (WHERE s.places IS NOT NULL))::int AS "limitedClasses",
           COALESCE(sum(s.places), 0)::int AS places,
           COALESCE(sum(LEAST(b.taken, s.places)) FILTER (WHERE s.places IS NOT NULL), 0)::int AS booked,
           COALESCE(sum(b.taken), 0)::int AS bookings,
           COALESCE(sum(b.attended), 0)::int AS attended,
           COALESCE(sum(b.no_shows), 0)::int AS "noShows"
    FROM gym_class_sessions s
    JOIN gym_class_types t ON t.id = s.class_type_id AND t.gym_id = s.gym_id
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE k.status IN ('booked', 'attended', 'no_show')) AS taken,
             count(*) FILTER (WHERE k.status = 'attended') AS attended,
             count(*) FILTER (WHERE k.status = 'no_show') AS no_shows
      FROM gym_class_bookings k
      WHERE k.gym_id = s.gym_id AND k.session_id = s.id
    ) b
    WHERE s.gym_id = ${gymId} AND s.status = 'scheduled'
      AND s.starts_at >= (${fromDay}::date::timestamp AT TIME ZONE ${timezone})
      AND s.starts_at <= ${now}::timestamptz
    GROUP BY t.id, t.name`;
  return { ever: ever[0]?.ever === true, types: z.array(classCountsSchema).parse(rows) };
}
