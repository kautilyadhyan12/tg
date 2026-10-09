// A GYM'S MESSAGES TO A MEMBER: the only file that reads or writes `gym_member_messages`
// (spec Part 3 §16.1; ROADMAP 20a). Every statement names the gym and the person.
import type { GymMessageKind } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";

type SqlOrTx = Sql | TransactionSql;

/** The gym for a live app member of it: null for a gym that is not there, `member` false
 *  for anybody who is not in it now. `joinedAt` is when this stay in the gym began. */
export async function memberGate(sql: SqlOrTx, gymId: string, userId: string): Promise<{ name: string; open: boolean; live: boolean; member: boolean; joinedAt: Date | null } | null> {
  const rows = await sql<{ name: string; open: boolean; live: boolean; joined_at: Date | null }[]>`
    SELECT g.name, g.status = 'active' AS open,
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
  return { name: row.name, open: row.open, live: row.live, member: row.joined_at !== null, joinedAt: row.joined_at };
}

export interface InboxRow {
  id: string;
  kind: string;
  body: string;
  sentAt: Date;
  read: boolean;
}

/** The person's messages from this gym that are still in the inbox, newest first: sent
 *  since they joined this time, and not past their 30 days. */
export async function inboxRows(sql: SqlOrTx, gymId: string, userId: string, since: Date, now: Date, max: number): Promise<InboxRow[]> {
  const rows = await sql<{ id: string; kind: string; body: string; sent_at: Date; read: boolean }[]>`
    SELECT id, kind, body, sent_at, read_at IS NOT NULL AS read
    FROM gym_member_messages
    WHERE gym_id = ${gymId} AND user_id = ${userId}
      AND sent_at >= ${since} AND sent_at <= ${now} AND expires_at > ${now}
    ORDER BY sent_at DESC, id
    LIMIT ${max}`;
  return rows.map((row) => ({ id: row.id, kind: row.kind, body: row.body, sentAt: row.sent_at, read: row.read }));
}

/** How many of them the person has not opened. */
export async function unreadCount(sql: SqlOrTx, gymId: string, userId: string, since: Date, now: Date): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_member_messages
    WHERE gym_id = ${gymId} AND user_id = ${userId} AND read_at IS NULL
      AND sent_at >= ${since} AND sent_at <= ${now} AND expires_at > ${now}`;
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

/** The gyms where somebody who joined in the last `days` is still in and has had no
 *  Welcome since: the only gyms a Welcome can be due in, so a gym with nothing to send is
 *  not held. `gymIds` is for tests on a shared database. */
export async function gymsWithNewPeople(sql: SqlOrTx, now: Date, days: number, gymIds: readonly string[] | null): Promise<string[]> {
  const rows = await sql<{ gym_id: string }[]>`
    SELECT DISTINCT m.gym_id FROM gym_members m
    WHERE m.joined_at > ${now}::timestamptz - make_interval(days => ${days}::int) AND m.joined_at <= ${now}
      AND m.removed_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM gym_member_messages x
        WHERE x.gym_id = m.gym_id AND x.user_id = m.user_id AND x.kind = 'welcome' AND x.sent_at >= m.joined_at
      )
      ${gymIds === null ? sql`` : sql`AND m.gym_id = ANY(${[...gymIds]}::uuid[])`}
    ORDER BY m.gym_id`;
  return rows.map((row) => row.gym_id);
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

/** One stay of one person in the gym, with what the message rule reads about them. */
export interface NewPerson {
  userId: string;
  displayName: string;
  /** The day they joined, on the gym's calendar, and in UTC. */
  joinedOn: string;
  joinedUtcOn: string;
  /** This stay is live and their account is not deleted. */
  member: boolean;
  former: boolean;
  staff: boolean;
  sent: { kind: GymMessageKind; occasion: string; day: string }[];
}

/** Everybody who joined the gym in the last `days`, whatever became of them since: the
 *  rule, not this read, decides who is sent anything. */
export async function newPeople(tx: SqlOrTx, gymId: string, now: Date, days: number): Promise<NewPerson[]> {
  const rows = await tx<{ user_id: string; display_name: string; joined_on: string; joined_utc_on: string; member: boolean; former: boolean; staff: boolean; sent: NewPerson["sent"] }[]>`
    SELECT m.user_id, u.display_name,
           (m.joined_at AT TIME ZONE g.timezone)::date::text AS joined_on,
           (m.joined_at AT TIME ZONE 'UTC')::date::text AS joined_utc_on,
           (m.removed_at IS NULL AND u.status = 'active') AS member,
           EXISTS (
             SELECT 1 FROM gym_member_list_entries e
             WHERE e.gym_id = g.id AND e.id = coalesce(m.entry_id, m.removed_entry_id) AND e.former_at IS NOT NULL
           ) AS former,
           (g.owner_user_id = m.user_id OR EXISTS (SELECT 1 FROM gym_staff s WHERE s.gym_id = g.id AND s.user_id = m.user_id)) AS staff,
           coalesce((
             SELECT json_agg(json_build_object('kind', x.kind, 'occasion', x.occasion, 'day', x.gym_day::text))
             FROM gym_member_messages x WHERE x.gym_id = g.id AND x.user_id = m.user_id
           ), '[]'::json) AS sent
    FROM gyms g
    JOIN gym_members m ON m.gym_id = g.id
    JOIN users u ON u.id = m.user_id
    WHERE g.id = ${gymId}
      AND m.joined_at > ${now}::timestamptz - make_interval(days => ${days}::int) AND m.joined_at <= ${now}
    ORDER BY m.joined_at, m.id`;
  return rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    joinedOn: row.joined_on,
    joinedUtcOn: row.joined_utc_on,
    member: row.member,
    former: row.former,
    staff: row.staff,
    sent: row.sent,
  }));
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
