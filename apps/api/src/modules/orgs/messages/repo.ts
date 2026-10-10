// A GYM'S MESSAGES TO A MEMBER: reads and writes `gym_member_messages` (spec Part 3 §16.1;
// ROADMAP 20a). Every statement names the gym and the person. The copies of a message to a
// group are written, read back by message and removed in `groupRepo.ts`.
import { GYM_GROUP_MESSAGE_KIND, type GymMessageKind } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { COUNTED_METHODS, countedDays, soloHolders } from "../leaderboard/visits.js";

type SqlOrTx = Sql | TransactionSql;

export interface MemberGate {
  name: string;
  open: boolean;
  live: boolean;
  member: boolean;
  joinedAt: Date | null;
  /** The phone and email the gym typed for its members (ROADMAP 20a-iii). */
  contactPhone: string | null;
  contactEmail: string | null;
}

/** The gym for a live app member of it: null for a gym that is not there, `member` false
 *  for anybody who is not in it now. `joinedAt` is when this stay in the gym began. */
export async function memberGate(sql: SqlOrTx, gymId: string, userId: string): Promise<MemberGate | null> {
  const rows = await sql<{ name: string; open: boolean; live: boolean; joined_at: Date | null; contact_phone: string | null; contact_email: string | null }[]>`
    SELECT g.name, g.status = 'active' AS open, g.contact_phone, g.contact_email,
           EXISTS (
             SELECT 1 FROM subscriptions s
             WHERE s.owner_type = 'gym' AND s.owner_id = g.id AND s.status IN ('trialing','active','past_due')
           ) AS live,
           (
             SELECT m.joined_at FROM gym_members m JOIN users u ON u.id = m.user_id AND u.status = 'active'
             WHERE m.gym_id = g.id AND m.user_id = ${userId} AND m.removed_at IS NULL
           ) AS joined_at
    FROM gyms g WHERE g.id = ${gymId}`;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    name: row.name,
    open: row.open,
    live: row.live,
    member: row.joined_at !== null,
    joinedAt: row.joined_at,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
  };
}

export interface InboxRow {
  id: string;
  kind: string;
  body: string;
  sentAt: Date;
  read: boolean;
}

/** The person's messages from this gym that are still in the inbox, newest first: sent
 *  since they joined this time, and not past their 30 days. The join is read from its own
 *  row, to the microsecond: a JS instant drops them, and would let in a message from just
 *  before the stay. */
export async function inboxRows(sql: SqlOrTx, gymId: string, userId: string, now: Date, max: number): Promise<InboxRow[]> {
  const rows = await sql<{ id: string; kind: string; body: string; sent_at: Date; read: boolean }[]>`
    SELECT id, kind, body, sent_at, read_at IS NOT NULL AS read
    FROM gym_member_messages
    WHERE gym_id = ${gymId} AND user_id = ${userId}
      AND sent_at >= (SELECT m.joined_at FROM gym_members m WHERE m.gym_id = ${gymId} AND m.user_id = ${userId} AND m.removed_at IS NULL)
      AND sent_at <= ${now} AND expires_at > ${now}
    ORDER BY sent_at DESC, id
    LIMIT ${max}`;
  return rows.map((row) => ({ id: row.id, kind: row.kind, body: row.body, sentAt: row.sent_at, read: row.read }));
}

/** How many of them the person has not opened. */
export async function unreadCount(sql: SqlOrTx, gymId: string, userId: string, now: Date): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_member_messages
    WHERE gym_id = ${gymId} AND user_id = ${userId} AND read_at IS NULL
      AND sent_at >= (SELECT m.joined_at FROM gym_members m WHERE m.gym_id = ${gymId} AND m.user_id = ${userId} AND m.removed_at IS NULL)
      AND sent_at <= ${now} AND expires_at > ${now}`;
  return rows[0]?.n ?? 0;
}

/** That count for every gym the person is a live member of, in one read, for the list of
 *  their gyms (ROADMAP 20a-ii). It holds `memberGate`'s rule and `unreadCount`'s together:
 *  a gym that is closed or on no plan, and a gym with nothing new, are not in the answer. */
export async function unreadCounts(sql: SqlOrTx, userId: string, now: Date): Promise<Map<string, number>> {
  const rows = await sql<{ gym_id: string; n: number }[]>`
    SELECT m.gym_id, count(*)::int AS n
    FROM gym_members m
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    JOIN gyms g ON g.id = m.gym_id AND g.status = 'active'
    JOIN gym_member_messages x ON x.gym_id = m.gym_id AND x.user_id = m.user_id
    WHERE m.user_id = ${userId} AND m.removed_at IS NULL
      AND x.read_at IS NULL
      AND x.sent_at >= m.joined_at AND x.sent_at <= ${now} AND x.expires_at > ${now}
      AND EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.owner_type = 'gym' AND s.owner_id = g.id AND s.status IN ('trialing','active','past_due')
      )
    GROUP BY m.gym_id`;
  return new Map(rows.map((row) => [row.gym_id, row.n]));
}

/** Marks as read the person's own messages from this gym sent up to `upTo`. Asked twice,
 *  the first instant is kept. */
export async function markRead(sql: SqlOrTx, gymId: string, userId: string, upTo: Date, now: Date): Promise<void> {
  await sql`
    UPDATE gym_member_messages SET read_at = ${now}
    WHERE gym_id = ${gymId} AND user_id = ${userId} AND read_at IS NULL AND sent_at <= ${upTo}`;
}

// ── WHAT THE WORKER READS AND WRITES ──

/** The gyms with somebody in them: the only gyms a message can be due in. It reads no
 *  gym's clock, so a gym whose time zone cannot be read fails alone, in its own turn.
 *  `gymIds` is for tests on a shared database. */
export async function gymsWithPeople(sql: SqlOrTx, gymIds: readonly string[] | null): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT g.id FROM gyms g
    WHERE EXISTS (SELECT 1 FROM gym_members m WHERE m.gym_id = g.id AND m.removed_at IS NULL)
      ${gymIds === null ? sql`` : sql`AND g.id = ANY(${[...gymIds]}::uuid[])`}
    ORDER BY g.id`;
  return rows.map((row) => row.id);
}

export interface GymNow {
  name: string;
  open: boolean;
  live: boolean;
  /** Today, and the hour, on the gym's own clock. */
  today: string;
  hour: number;
}

export async function gymNow(tx: SqlOrTx, gymId: string, now: Date): Promise<GymNow | null> {
  const rows = await tx<{ name: string; open: boolean; live: boolean; today: string; hour: number }[]>`
    SELECT g.name, g.status = 'active' AS open,
           EXISTS (
             SELECT 1 FROM subscriptions s
             WHERE s.owner_type = 'gym' AND s.owner_id = g.id AND s.status IN ('trialing','active','past_due')
           ) AS live,
           (${now}::timestamptz AT TIME ZONE g.timezone)::date::text AS today,
           extract(hour FROM ${now}::timestamptz AT TIME ZONE g.timezone)::int AS hour
    FROM gyms g WHERE g.id = ${gymId}`;
  return rows[0] ?? null;
}

/** The days, of the `days` up to `today`, on which the desk or staff checked anybody in
 *  at the time, newest first. Asked a day at a time, so it reads the visits' index by day
 *  and never a gym's whole year. */
export async function gymVisitDays(sql: SqlOrTx, gymId: string, today: string, days: number): Promise<string[]> {
  const rows = await sql<{ day: string }[]>`
    SELECT d.day::text AS day
    FROM (SELECT ${today}::date - n AS day FROM generate_series(0, ${days}::int - 1) AS n) d
    WHERE EXISTS (
      SELECT 1 FROM gym_attendance a
      WHERE a.gym_id = ${gymId} AND a.day = d.day AND a.method IN ${sql([...COUNTED_METHODS])} AND a.hours_status <> 'added_later'
    )
    ORDER BY d.day DESC`;
  return rows.map((row) => row.day);
}

/** One stay of one person in the gym, with what the message rule reads about them. */
export interface MessagePerson {
  userId: string;
  displayName: string;
  /** The day they joined, on the gym's calendar, and in UTC. */
  joinedOn: string;
  joinedUtcOn: string;
  /** This stay is live and their account is not deleted. */
  member: boolean;
  former: boolean;
  staff: boolean;
  /** The kinds they switched off at this gym. */
  off: GymMessageKind[];
  /** `MM-DD`, or null where the list holds no date of birth to trust. */
  birthday: string | null;
  /** Their visit days, the newest, and how many are today or yesterday. */
  visits: number;
  lastVisitOn: string | null;
  recentVisitDays: number;
  sent: { kind: GymMessageKind; occasion: string; day: string }[];
}

/** As many records of one gym with one date of birth as mark it a stand-in an export wrote
 *  for "not known", never a birthday. */
export const SHARED_BIRTH_DATE_RECORDS = 5;

/** `everybody`: everybody in the gym now, and everybody who joined in the last `days`
 *  whatever became of them since: the rule, not this read, decides who is sent anything.
 *  Without it, only those who joined in the last `days`, with no visit and no birthday
 *  read for them: all a Welcome needs, and the read the sender makes four times an hour.
 *
 *  A visit is its account's, or its record's one live holder's (`soloHolders`); a birthday
 *  is read from the record that one person holds alone, so two accounts on one record have
 *  none. A date of birth is not a birthday when the person would be over 110 or not yet
 *  born, when it is 1 January 1970, or when `SHARED_BIRTH_DATE_RECORDS` of the gym's
 *  records share it. `sent` is the automatic messages only. */
export async function peopleForMessages(tx: SqlOrTx, gymId: string, now: Date, today: string, days: number, everybody: boolean): Promise<MessagePerson[]> {
  const nobody = tx`SELECT NULL::uuid AS entry_id, NULL::uuid AS user_id WHERE false`;
  const noVisits = tx`SELECT NULL::uuid AS owner_id, 0 AS visits, NULL::text AS last_on, 0 AS recent WHERE false`;
  const joinedLately = tx`m.joined_at > ${now}::timestamptz - make_interval(days => ${days}::int)`;
  const rows = await tx<
    {
      user_id: string;
      display_name: string;
      joined_on: string;
      joined_utc_on: string;
      member: boolean;
      former: boolean;
      staff: boolean;
      off: GymMessageKind[];
      birthday: string | null;
      visits: number;
      last_visit_on: string | null;
      recent_visit_days: number;
      sent: MessagePerson["sent"];
    }[]
  >`
    WITH solo AS MATERIALIZED (${everybody ? soloHolders(tx, gymId) : nobody}),
    pv AS MATERIALIZED (${
      everybody
        ? tx`
      SELECT c.owner_id, count(*)::int AS visits, max(c.day)::text AS last_on,
             (count(*) FILTER (WHERE c.day >= ${today}::date - 1))::int AS recent
      FROM (${countedDays(tx, gymId, today)}) c
      GROUP BY c.owner_id`
        : noVisits
    }),
    stand_in AS (
      SELECT e.date_of_birth FROM gym_member_list_entries e
      WHERE e.gym_id = ${gymId} AND e.date_of_birth IS NOT NULL
      GROUP BY e.date_of_birth
      HAVING count(*) >= ${SHARED_BIRTH_DATE_RECORDS}
    )
    SELECT m.user_id, u.display_name,
           (m.joined_at AT TIME ZONE g.timezone)::date::text AS joined_on,
           (m.joined_at AT TIME ZONE 'UTC')::date::text AS joined_utc_on,
           (m.removed_at IS NULL AND u.status = 'active') AS member,
           EXISTS (
             SELECT 1 FROM gym_member_list_entries e
             WHERE e.gym_id = g.id AND e.id = coalesce(m.entry_id, m.removed_entry_id) AND e.former_at IS NOT NULL
           ) AS former,
           (g.owner_user_id = m.user_id OR EXISTS (SELECT 1 FROM gym_staff s WHERE s.gym_id = g.id AND s.user_id = m.user_id)) AS staff,
           ARRAY(
             SELECT o.kind FROM gym_member_messages_off o
             WHERE o.gym_id = g.id AND o.user_id = m.user_id AND o.kind <> ${GYM_GROUP_MESSAGE_KIND}
             ORDER BY o.kind
           ) AS off,
           CASE WHEN m.removed_at IS NULL AND own.date_of_birth <= ${today}::date
                     AND own.date_of_birth > ${today}::date - interval '110 years'
                     AND own.date_of_birth <> DATE '1970-01-01'
                     AND stand_in.date_of_birth IS NULL
                THEN to_char(own.date_of_birth, 'MM-DD') END AS birthday,
           coalesce(pv.visits, 0) AS visits, pv.last_on AS last_visit_on, coalesce(pv.recent, 0) AS recent_visit_days,
           coalesce((
             SELECT json_agg(json_build_object('kind', x.kind, 'occasion', x.occasion, 'day', x.gym_day::text))
             FROM gym_member_messages x
             WHERE x.gym_id = g.id AND x.user_id = m.user_id AND x.kind <> ${GYM_GROUP_MESSAGE_KIND}
           ), '[]'::json) AS sent
    FROM gyms g
    JOIN gym_members m ON m.gym_id = g.id
    JOIN users u ON u.id = m.user_id
    LEFT JOIN pv ON pv.owner_id = m.user_id
    LEFT JOIN solo ON solo.user_id = m.user_id AND solo.entry_id = m.entry_id
    LEFT JOIN gym_member_list_entries own ON own.gym_id = g.id AND own.id = solo.entry_id
    LEFT JOIN stand_in ON stand_in.date_of_birth = own.date_of_birth
    WHERE g.id = ${gymId} AND m.joined_at <= ${now}
      AND ${everybody ? tx`(m.removed_at IS NULL OR ${joinedLately})` : joinedLately}
    ORDER BY m.joined_at, m.id`;
  return rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    joinedOn: row.joined_on,
    joinedUtcOn: row.joined_utc_on,
    member: row.member,
    former: row.former,
    staff: row.staff,
    off: row.off,
    birthday: row.birthday,
    visits: row.visits,
    lastVisitOn: row.last_visit_on,
    recentVisitDays: row.recent_visit_days,
    sent: row.sent,
  }));
}

/** Has the day's whole read of this gym been made for `today`, on its own calendar? */
export async function dayDone(sql: SqlOrTx, gymId: string, today: string): Promise<boolean> {
  const rows = await sql<{ one: number }[]>`SELECT 1 AS one FROM gym_message_days WHERE gym_id = ${gymId} AND day >= ${today}::date`;
  return rows.length > 0;
}

/** Marks it made. Marked twice, or after a later day was, it changes nothing. */
export async function markDayDone(sql: SqlOrTx, gymId: string, today: string): Promise<void> {
  await sql`
    INSERT INTO gym_message_days (gym_id, day) VALUES (${gymId}, ${today}::date)
    ON CONFLICT (gym_id) DO UPDATE SET day = EXCLUDED.day WHERE gym_message_days.day < EXCLUDED.day`;
}

/** Forgets it, so the next run reads the whole gym again: its settings changed. */
export async function forgetDay(sql: SqlOrTx, gymId: string): Promise<void> {
  await sql`DELETE FROM gym_message_days WHERE gym_id = ${gymId}`;
}

export interface NewMessage {
  gymId: string;
  userId: string;
  kind: GymMessageKind;
  occasion: string;
  body: string;
  gymDay: string;
}

/** Writes the messages in one statement, and answers how many were written. One whose
 *  occasion already has its message is not: the unique index, so two runs at one instant
 *  still send once. */
export async function insertMessages(tx: SqlOrTx, messages: readonly NewMessage[], now: Date, keptDays: number): Promise<number> {
  if (messages.length === 0) return 0;
  const expires = new Date(now.getTime() + keptDays * 86_400_000);
  const values = messages.map((m) => ({ gym_id: m.gymId, user_id: m.userId, kind: m.kind, occasion: m.occasion, body: m.body, gym_day: m.gymDay, sent_at: now, expires_at: expires }));
  const rows = await tx<{ id: string }[]>`
    INSERT INTO gym_member_messages ${tx(values)}
    ON CONFLICT (gym_id, user_id, kind, occasion) DO NOTHING
    RETURNING id`;
  return rows.length;
}
