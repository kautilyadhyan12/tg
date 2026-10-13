// The Reports page's reads (ROADMAP 21a-i, 21a-ii, 21b-i, 21d-i): counts of the gym's member list, its
// leads, its visits and its classes.
// Every read names the gym in the WHERE and returns counts, never a person.
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import { REPORT_MONTHS, newCountedFrom, type AttendanceWindows, type ReportClassCounts } from "@app/shared";

const count = z.number().int().min(0);
const countsRowSchema = z.object({
  today: z.string(),
  months: z.array(z.object({ month: z.string(), activeAtStart: count, joined: count, left: count, leftOfStart: count })),
  active_now: count,
  ever_left: z.boolean(),
  first_listed_on: z.string().nullable(),
  list_changed_on: z.string().nullable(),
  period_joined: count,
  period_left: count,
  stay_leavers: count,
  stay_days: z.number().min(0),
});
export type MemberCounts = z.infer<typeof countsRowSchema>;

/** Everybody the gym's list has held, as two WITH parts, `gone` and `people`: for each
 *  person the day they started, the day they went on the list, and the day they left.
 *  One rule for every count of who is new and who has left (Reports, and Overview's Last
 *  7 days box), so two pages never give two answers. */
export function listPeople(sql: Sql | TransactionSql, gymId: string, timezone: string, gone: readonly { id: string; on: string }[]) {
  return sql`
    gone AS (
      SELECT g.id, g.left_on
      FROM unnest(${gone.map((g) => g.id)}::uuid[], ${gone.map((g) => g.on)}::date[]) AS g(id, left_on)
    ),
    people AS MATERIALIZED (
      SELECT LEAST(e.joined_on, (e.created_at AT TIME ZONE ${timezone})::date) AS started,
             (e.created_at AT TIME ZONE ${timezone})::date AS listed_on,
             (e.former_at AT TIME ZONE ${timezone})::date AS removed_on,
             -- Taken off the list wins, or the day their membership was already over by
             -- then. LEAST skips a NULL: no such day is the day they came off.
             COALESCE(CASE WHEN e.former_at IS NOT NULL THEN
                        LEAST((e.former_at AT TIME ZONE ${timezone})::date,
                              CASE WHEN e.membership_ended_on IS NOT NULL
                                   THEN GREATEST(e.membership_ended_on, (e.created_at AT TIME ZONE ${timezone})::date) END)
                      END,
                      -- GREATEST skips a NULL: nobody without a day is given their listing day.
                      CASE WHEN g.left_on IS NOT NULL THEN GREATEST(g.left_on, (e.created_at AT TIME ZONE ${timezone})::date) END) AS left_on
      FROM gym_member_list_entries e
      LEFT JOIN gone g ON g.id = e.id
      WHERE e.gym_id = ${gymId}
    )`;
}

/** The gym's list counted month by month on the gym's own calendar, in one pass.
 *
 *  A person starts on the join date the gym gave, when it is earlier than the day they
 *  went on the list, and otherwise on that day; they leave on the day they came off, or,
 *  still on the list, on the day in `gone`: the day their last membership here ended or
 *  was cancelled (21c-ii), which the caller reads from the Members list's own rule, and
 *  never a day before the record itself was made (two records joined can leave an old
 *  membership on a newer record). Somebody whose membership was already over when they
 *  came off the list left on that earlier day (`membership_ended_on`, 21c-iii): a month
 *  that has closed does not change because staff tidied up afterwards. `today` is the gym's own day, the caller's one. A
 *  month's "at its start" is everybody who had started before its first day, had not left
 *  before it, and was on the list before the month ended: a list imported in September
 *  with last year's join dates fills no month before September, when nobody on it could
 *  have been seen to leave. New, left and the stay of those who left are also counted
 *  from `periodFrom`, the first day of the period the page shows; new never in the month
 *  the list began (`newCountedFrom`). */
export async function readMemberCounts(
  sql: Sql | TransactionSql,
  gymId: string,
  timezone: string,
  today: string,
  gone: readonly { id: string; on: string }[],
  periodFrom: string,
): Promise<MemberCounts> {
  const first = await sql<{ first_listed_on: string | null }[]>`
    SELECT to_char(min((e.created_at AT TIME ZONE ${timezone})::date), 'YYYY-MM-DD') AS first_listed_on
    FROM gym_member_list_entries e WHERE e.gym_id = ${gymId}`;
  // No list: nobody is counted, and this day is never read.
  const newFrom = newCountedFrom(first[0]?.first_listed_on ?? null, periodFrom) ?? periodFrom;
  const rows = await sql<Record<string, unknown>[]>`
    WITH clock AS (
      SELECT ${today}::date AS today, date_trunc('month', ${today}::date)::date AS this_month
    ),
    ${listPeople(sql, gymId, timezone, gone)},
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
    shown AS (SELECT ${periodFrom}::date AS from_day)
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
      (SELECT to_char(GREATEST(max(listed_on), max(removed_on)), 'YYYY-MM-DD') FROM people) AS list_changed_on,
      (SELECT count(*)::int FROM people p WHERE p.started >= ${newFrom}::date) AS period_joined,
      (SELECT count(*)::int FROM people p, shown s WHERE p.left_on >= s.from_day) AS period_left,
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

/** The gym's leads added from `periodFrom` on, on the gym's calendar, by where they came
 *  from, with how many of each are marked Joined; and whether it has any lead at all. */
export async function readLeadCounts(sql: Sql, gymId: string, timezone: string, periodFrom: string): Promise<{ any: boolean; sources: LeadCounts[] }> {
  const sources = await sql<LeadCounts[]>`
    SELECT source, count(*)::int AS leads, (count(*) FILTER (WHERE status = 'joined'))::int AS joined
    FROM gym_leads
    WHERE gym_id = ${gymId} AND created_at >= (${periodFrom}::date::timestamp AT TIME ZONE ${timezone})
    GROUP BY source`;
  const any = await sql<{ any: boolean }[]>`SELECT EXISTS (SELECT 1 FROM gym_leads WHERE gym_id = ${gymId}) AS any`;
  return { any: any[0]?.any === true, sources };
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
  people: count,
  members: count,
  member_visits: count,
  member_visitors: count,
});
export type VisitCounts = z.infer<typeof visitCountsSchema>;

/** The gym's visits counted over the report's period, in two passes over its days.
 *
 *  A visit is a row of the Attendance page, so a day here and a day there are one number.
 *  A person is their record on the list, or their app account when the visit has none. A
 *  visit's hour and its weekday are read off one moment on the gym's clock; one staff
 *  added on a later day has no hour. Visits a member counts the people on the list today
 *  who were on it when the weeks counted began, and only their visits: somebody added
 *  since could not have come. A visit that names only an app account is its member's.
 *
 *  The hours are counted by the quarter-hour first and put on the gym's clock after: every
 *  zone is a whole number of quarter-hours from UTC, and a few thousand quarter-hours are
 *  converted where every visit would have been. A week is Monday to Sunday; the one the
 *  period begins in starts on the period's first day. The whole weeks are among them, so
 *  the pass that counts people by the week serves visits a member too. The hours are
 *  counted over every day of the period (`windows.hours`). */
export async function readVisitCounts(
  sql: Sql,
  gymId: string,
  timezone: string,
  today: string,
  windows: AttendanceWindows,
): Promise<VisitCounts> {
  const from = windows.period.from;
  const hoursFrom = windows.hours?.from ?? null;
  const hoursTo = windows.hours?.to ?? null;
  const memberFrom = windows.whole?.from ?? null;
  const memberTo = windows.whole?.to ?? null;
  const rows = await sql<Record<string, unknown>[]>`
    WITH by_quarter AS MATERIALIZED (
      SELECT a.day,
             CASE WHEN a.day >= ${hoursFrom}::date AND a.day <= ${hoursTo}::date AND a.hours_status <> 'added_later'
                  THEN date_bin('15 minutes', a.marked_at, TIMESTAMPTZ '2000-01-01 00:00:00+00') END AS quarter,
             COALESCE(a.day >= ${hoursFrom}::date AND a.day <= ${hoursTo}::date AND a.hours_status = 'added_later', false) AS no_time,
             count(*)::int AS visits
      FROM gym_attendance a
      WHERE a.gym_id = ${gymId} AND a.day >= ${from}::date AND a.day <= ${today}::date
      GROUP BY 1, 2, 3
    ),
    by_person AS MATERIALIZED (
      SELECT GREATEST(a.day - (extract(isodow FROM a.day)::int - 1), ${from}::date) AS week_start,
             COALESCE(a.entry_id, a.user_id) AS who, COALESCE(a.entry_id, m.entry_id) AS entry_id, count(*)::int AS visits
      FROM gym_attendance a
      LEFT JOIN gym_members m ON a.entry_id IS NULL AND m.gym_id = a.gym_id AND m.user_id = a.user_id AND m.removed_at IS NULL
      WHERE a.gym_id = ${gymId} AND a.day >= ${from}::date AND a.day <= ${today}::date
      GROUP BY 1, 2, 3
    ),
    members AS MATERIALIZED (
      SELECT e.id FROM gym_member_list_entries e
      WHERE e.gym_id = ${gymId} AND e.former_at IS NULL
        AND (e.created_at AT TIME ZONE ${timezone})::date <= ${memberFrom}::date
    ),
    of_members AS (
      SELECT COALESCE(sum(p.visits), 0)::int AS visits, count(DISTINCT p.entry_id)::int AS visitors
      FROM by_person p
      JOIN members e ON e.id = p.entry_id
      WHERE p.week_start >= ${memberFrom}::date AND p.week_start <= ${memberTo}::date
    )
    SELECT
      (SELECT COALESCE(json_agg(json_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'visits', d.visits)), '[]'::json)
       FROM (SELECT day, sum(visits)::int AS visits FROM by_quarter GROUP BY day) d) AS days,
      (SELECT COALESCE(json_agg(json_build_object('weekStart', to_char(w.week_start, 'YYYY-MM-DD'), 'visits', w.visits, 'people', w.people)), '[]'::json)
       FROM (SELECT week_start, sum(visits)::int AS visits, count(DISTINCT who)::int AS people FROM by_person GROUP BY 1) w) AS weeks,
      (SELECT COALESCE(json_agg(json_build_object('weekday', h.weekday, 'hour', h.hour, 'visits', h.visits)), '[]'::json)
       FROM (SELECT extract(isodow FROM quarter AT TIME ZONE ${timezone})::int AS weekday, extract(hour FROM quarter AT TIME ZONE ${timezone})::int AS hour, sum(visits)::int AS visits
             FROM by_quarter WHERE quarter IS NOT NULL GROUP BY 1, 2) h) AS hours,
      (SELECT COALESCE(sum(visits), 0)::int FROM by_quarter WHERE no_time) AS hours_no_time,
      (SELECT count(DISTINCT who)::int FROM by_person) AS people,
      (SELECT count(*)::int FROM members) AS members,
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

const moneyGymSchema = z.object({
  country: z.string().nullable(),
  bills_overdue_days: count,
  paid_currencies: z.array(z.string()),
  held_currency: z.string().nullable(),
});

/** How many days after its due date an unpaid bill reads Overdue, and the currencies the
 *  gym's notebook holds: those of its standing payments, the newest first, and its newest
 *  membership's. A membership keeps the currency it was given in, so after a gym's
 *  country changes its money is still there to count. */
export async function readMoneyGym(
  sql: Sql | TransactionSql,
  gymId: string,
): Promise<{ country: string | null; overdueAfterDays: number; paidCurrencies: string[]; heldCurrency: string | null }> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT g.country, g.bills_overdue_days,
           (SELECT COALESCE(array_agg(x.currency ORDER BY x.newest DESC), '{}')
            FROM (SELECT p.currency, max(p.seq) AS newest FROM gym_member_payments p
                  WHERE p.gym_id = g.id AND p.undone_at IS NULL GROUP BY p.currency) x) AS paid_currencies,
           (SELECT h.currency FROM gym_held_memberships h
            WHERE h.gym_id = g.id
            ORDER BY h.created_at DESC, h.id LIMIT 1) AS held_currency
    FROM gyms g WHERE g.id = ${gymId}`;
  const row = moneyGymSchema.parse(rows[0]);
  return { country: row.country, overdueAfterDays: row.bills_overdue_days, paidCurrencies: row.paid_currencies, heldCurrency: row.held_currency };
}

/** Sums of money are whole minor units; added up they can pass an int4. */
const minor = z.number().int().min(0);
const moneyRowSchema = z.object({
  any_membership: z.boolean(),
  first_paid_on: z.string().nullable(),
  other_currency: z.boolean(),
  months: z.array(
    z.object({ typeId: z.string(), typeName: z.string(), month: z.string(), paidMinor: minor, refundedMinor: minor, periodPaidMinor: minor, periodRefundedMinor: minor }),
  ),
  current_minor: minor,
  current_people: count,
  past_minor: minor,
  past_people: count,
  overdue_minor: minor,
  overdue_people: count,
});
export type MoneyCounts = z.infer<typeof moneyRowSchema>;

/** The gym's notebook added up, in one statement: money in `currency` only.
 *
 *  A payment counts in the month of the gym's day it was paid on, a refund in the month
 *  the money went back, each only while it stands (one taken back is kept, marked, and is
 *  not money). A refund of a payment that was taken back is not counted either. Both are
 *  given for each membership type, over the last `REPORT_MONTHS` months, with the part of
 *  each that falls from `periodFrom` on: the first day of the period the page shows,
 *  never earlier than those months.
 *
 *  Owed is every bill still open whose day has come, less what is paid on it, for the
 *  people on the list and for past members apart; overdue is the part of both that is
 *  more than `overdueAfterDays` past its due date, as `memberBillState` reads one bill. */
export async function readMoney(
  sql: Sql | TransactionSql,
  gymId: string,
  today: string,
  currency: string,
  overdueAfterDays: number,
  periodFrom: string,
): Promise<MoneyCounts> {
  const rows = await sql<Record<string, unknown>[]>`
    WITH clock AS (
      SELECT ${today}::date AS today,
             (date_trunc('month', ${today}::date) - make_interval(months => ${REPORT_MONTHS - 1}))::date AS from_day
    ),
    paid AS (
      SELECT h.membership_type_id AS type_id, to_char(p.paid_on, 'YYYY-MM') AS month, sum(p.amount_minor) AS minor,
             COALESCE(sum(p.amount_minor) FILTER (WHERE p.paid_on >= ${periodFrom}::date), 0) AS period_minor
      FROM gym_member_payments p
      JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      CROSS JOIN clock c
      WHERE p.gym_id = ${gymId} AND p.undone_at IS NULL AND p.currency = ${currency} AND p.paid_on >= c.from_day
      GROUP BY 1, 2
    ),
    refunded AS (
      SELECT h.membership_type_id AS type_id, to_char(r.refunded_on, 'YYYY-MM') AS month, sum(r.amount_minor) AS minor,
             COALESCE(sum(r.amount_minor) FILTER (WHERE r.refunded_on >= ${periodFrom}::date), 0) AS period_minor
      FROM gym_member_refunds r
      JOIN gym_member_payments p ON p.gym_id = r.gym_id AND p.id = r.payment_id
      JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      CROSS JOIN clock c
      WHERE r.gym_id = ${gymId} AND r.undone_at IS NULL AND p.undone_at IS NULL AND r.currency = ${currency}
        AND r.refunded_on >= c.from_day
      GROUP BY 1, 2
    ),
    by_month AS (
      SELECT COALESCE(p.type_id, r.type_id) AS type_id, COALESCE(p.month, r.month) AS month,
             COALESCE(p.minor, 0) AS paid_minor, COALESCE(r.minor, 0) AS refunded_minor,
             COALESCE(p.period_minor, 0) AS period_paid_minor, COALESCE(r.period_minor, 0) AS period_refunded_minor
      FROM paid p
      FULL JOIN refunded r ON r.type_id = p.type_id AND r.month = p.month
    ),
    owed AS (
      SELECT (e.former_at IS NOT NULL) AS past, e.id AS entry_id, (b.due_on + ${overdueAfterDays}::int < c.today) AS overdue,
             b.amount_minor - COALESCE((SELECT sum(p.amount_minor) FROM gym_member_payments p
                                        WHERE p.gym_id = b.gym_id AND p.bill_id = b.id AND p.undone_at IS NULL), 0) AS left_minor
      FROM gym_member_bills b
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
      CROSS JOIN clock c
      WHERE b.gym_id = ${gymId} AND b.status = 'open' AND b.due_on <= c.today AND b.currency = ${currency}
    )
    SELECT
      EXISTS (SELECT 1 FROM gym_held_memberships h WHERE h.gym_id = ${gymId}) AS any_membership,
      (SELECT to_char(min(p.paid_on), 'YYYY-MM-DD') FROM gym_member_payments p
       WHERE p.gym_id = ${gymId} AND p.undone_at IS NULL AND p.currency = ${currency}) AS first_paid_on,
      (EXISTS (SELECT 1 FROM gym_member_payments p
               WHERE p.gym_id = ${gymId} AND p.undone_at IS NULL AND p.currency <> ${currency})
       OR EXISTS (SELECT 1 FROM gym_member_bills b, clock c
                  WHERE b.gym_id = ${gymId} AND b.status = 'open' AND b.due_on <= c.today AND b.currency <> ${currency})) AS other_currency,
      (SELECT COALESCE(json_agg(json_build_object(
                'typeId', m.type_id, 'typeName', t.name, 'month', m.month,
                'paidMinor', m.paid_minor, 'refundedMinor', m.refunded_minor,
                'periodPaidMinor', m.period_paid_minor, 'periodRefundedMinor', m.period_refunded_minor)), '[]'::json)
       FROM by_month m
       JOIN gym_membership_types t ON t.gym_id = ${gymId} AND t.id = m.type_id) AS months,
      (SELECT COALESCE(sum(left_minor) FILTER (WHERE NOT past), 0)::float8 FROM owed) AS current_minor,
      (SELECT (count(DISTINCT entry_id) FILTER (WHERE NOT past))::int FROM owed) AS current_people,
      (SELECT COALESCE(sum(left_minor) FILTER (WHERE past), 0)::float8 FROM owed) AS past_minor,
      (SELECT (count(DISTINCT entry_id) FILTER (WHERE past))::int FROM owed) AS past_people,
      (SELECT COALESCE(sum(left_minor) FILTER (WHERE overdue), 0)::float8 FROM owed) AS overdue_minor,
      (SELECT (count(DISTINCT entry_id) FILTER (WHERE overdue))::int FROM owed) AS overdue_people`;
  return moneyRowSchema.parse(rows[0]);
}
