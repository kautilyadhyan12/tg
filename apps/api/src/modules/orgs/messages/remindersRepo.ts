// WHAT THE CLASS REMINDER READS (spec Part 3 §16.2; ROADMAP 20b-iii): a gym's bookings of
// classes and personal training sessions that start soon. Every statement names the gym.
//
// A class booking is its account's. A session is its record's, so it is a person's only
// where that person holds the record alone (`soloHolders`): a record two accounts share is
// nobody's, and neither is reminded. Every booking in the window is read whatever its
// status: `classReminderDue`, not this read, decides who is reminded.
import type { ClassReminderWhat } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { soloHolders } from "../leaderboard/visits.js";

type SqlOrTx = Sql | TransactionSql;

export interface ReminderBooking {
  what: ClassReminderWhat;
  id: string;
  userId: string;
  displayName: string;
  /** The class's name, or the trainer's for a session. */
  title: string | null;
  online: boolean;
  status: string;
  classStatus: string;
  /** When it starts and when the person got their place, on the gym's own clock. */
  day: string;
  startMinute: number;
  bookedDay: string | null;
  bookedMinute: number | null;
  /** A live member of the gym in the app, with an account that is not deleted. */
  member: boolean;
  former: boolean;
  /** They switched the reminder off at this gym. */
  off: boolean;
}

/** The gym's bookings that start after `now` and within `hours` of it. */
export async function bookingsStartingSoon(sql: SqlOrTx, gymId: string, now: Date, hours: number): Promise<ReminderBooking[]> {
  const until = new Date(now.getTime() + hours * 3_600_000);
  const localMinute = (at: ReturnType<SqlOrTx>) => sql`(extract(hour FROM ${at} AT TIME ZONE g.timezone) * 60 + extract(minute FROM ${at} AT TIME ZONE g.timezone))::int`;
  const off = (userId: ReturnType<SqlOrTx>) => sql`
    EXISTS (SELECT 1 FROM gym_member_messages_off o WHERE o.gym_id = g.id AND o.user_id = ${userId} AND o.kind = 'class_reminder')`;
  const rows = await sql<
    {
      what: ClassReminderWhat;
      id: string;
      user_id: string;
      display_name: string;
      title: string | null;
      online: boolean;
      status: string;
      class_status: string;
      day: string;
      start_minute: number;
      booked_day: string | null;
      booked_minute: number | null;
      member: boolean;
      former: boolean;
      off: boolean;
    }[]
  >`
    SELECT 'class' AS what, b.id, b.user_id, u.display_name, t.name AS title, s.online,
           b.status, s.status AS class_status,
           s.local_date::text AS day, s.local_start_minute AS start_minute,
           (b.booked_at AT TIME ZONE g.timezone)::date::text AS booked_day,
           ${localMinute(sql`b.booked_at`)} AS booked_minute,
           (u.status = 'active' AND EXISTS (
             SELECT 1 FROM gym_members m WHERE m.gym_id = g.id AND m.user_id = b.user_id AND m.removed_at IS NULL
           )) AS member,
           EXISTS (
             SELECT 1 FROM gym_members m
             JOIN gym_member_list_entries e ON e.gym_id = m.gym_id AND e.id = m.entry_id
             WHERE m.gym_id = g.id AND m.user_id = b.user_id AND m.removed_at IS NULL AND e.former_at IS NOT NULL
           ) AS former,
           ${off(sql`b.user_id`)} AS off
    FROM gym_class_sessions s
    JOIN gyms g ON g.id = s.gym_id
    JOIN gym_class_types t ON t.id = s.class_type_id
    JOIN gym_class_bookings b ON b.gym_id = s.gym_id AND b.session_id = s.id
    JOIN users u ON u.id = b.user_id
    WHERE s.gym_id = ${gymId} AND s.starts_at > ${now} AND s.starts_at <= ${until}
    UNION ALL
    SELECT 'session' AS what, a.id, solo.user_id, u.display_name, tu.display_name AS title, false AS online,
           a.status, 'scheduled' AS class_status,
           a.local_date::text AS day, a.local_start_minute AS start_minute,
           (a.created_at AT TIME ZONE g.timezone)::date::text AS booked_day,
           ${localMinute(sql`a.created_at`)} AS booked_minute,
           true AS member,
           (e.former_at IS NOT NULL) AS former,
           ${off(sql`solo.user_id`)} AS off
    FROM gym_pt_appointments a
    JOIN gyms g ON g.id = a.gym_id
    JOIN (${soloHolders(sql, gymId)}) solo ON solo.entry_id = a.entry_id
    JOIN users u ON u.id = solo.user_id
    JOIN gym_member_list_entries e ON e.gym_id = a.gym_id AND e.id = a.entry_id
    LEFT JOIN users tu ON tu.id = a.trainer_user_id
    WHERE a.gym_id = ${gymId} AND a.starts_at > ${now} AND a.starts_at <= ${until}
      -- A trainer whose own record a session is booked on is not reminded of themself.
      AND solo.user_id IS DISTINCT FROM a.trainer_user_id
    ORDER BY day, start_minute, id`;
  return rows.map((row) => ({
    what: row.what,
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    title: row.title,
    online: row.online,
    status: row.status,
    classStatus: row.class_status,
    day: row.day,
    startMinute: row.start_minute,
    bookedDay: row.booked_day,
    bookedMinute: row.booked_minute,
    member: row.member,
    former: row.former,
    off: row.off,
  }));
}

/** Of these reminders, the ones this gym already sent, by person: read by the occasions'
 *  own index, and only for the ones that would otherwise go now. */
export async function remindersSent(sql: SqlOrTx, gymId: string, wanted: readonly { userId: string; occasion: string }[]): Promise<Map<string, string[]>> {
  const sent = new Map<string, string[]>();
  if (wanted.length === 0) return sent;
  const rows = await sql<{ user_id: string; occasion: string }[]>`
    SELECT user_id, occasion FROM gym_member_messages
    WHERE gym_id = ${gymId} AND kind = 'class_reminder'
      AND user_id = ANY(${[...new Set(wanted.map((w) => w.userId))]}::uuid[])
      AND occasion = ANY(${[...new Set(wanted.map((w) => w.occasion))]}::text[])`;
  for (const row of rows) sent.set(row.user_id, [...(sent.get(row.user_id) ?? []), row.occasion]);
  return sent;
}

/** Does the gym have anything a person can book: a class on its calendar from `today` on,
 *  a trainer who offers personal training, or a session still to come? */
export async function hasBookings(sql: SqlOrTx, gymId: string, today: string): Promise<boolean> {
  const rows = await sql<{ any: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM gym_class_sessions s WHERE s.gym_id = ${gymId} AND s.status = 'scheduled' AND s.local_date >= ${today}::date)
        OR EXISTS (SELECT 1 FROM gym_trainers t WHERE t.gym_id = ${gymId} AND t.offers)
        OR EXISTS (SELECT 1 FROM gym_pt_appointments a WHERE a.gym_id = ${gymId} AND a.status = 'booked' AND a.local_date >= ${today}::date) AS any`;
  return rows[0]?.any ?? false;
}
