// A MESSAGE TO A CHOSEN GROUP: the only file that reads or writes `gym_group_messages`
// and `gym_member_messages_off` (spec Part 3 §16.8; ROADMAP 20f-i). It also writes each
// person's copy into `gym_member_messages`, reads who holds one and removes the copies with
// their message (20f-ii). Every statement names the gym.
import { GYM_GROUP_MESSAGE_KIND, type GymInboxKind, type GymMessageKind } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";

type SqlOrTx = Sql | TransactionSql;

/** One selected record of this gym, with what decides whether its person is sent a message. */
export interface GroupStateRow {
  entryId: string;
  name: string;
  /** No longer a member: the record is kept, the person is not written to. */
  former: boolean;
  /** The live app accounts on this record, at this gym. */
  userIds: string[];
  /** One of them has switched this gym's group messages off. */
  off: boolean;
}

/** The selected records that are this gym's, in the list's order. An id of another gym's
 *  record, or of none, is not in the answer. An account counts only while it is in this
 *  gym now and is not deleted. */
export async function groupStateOf(sql: SqlOrTx, gymId: string, entryIds: readonly string[]): Promise<GroupStateRow[]> {
  if (entryIds.length === 0) return [];
  const rows = await sql<{ id: string; name: string; former: boolean; user_ids: string[]; off: boolean }[]>`
    SELECT e.id, e.full_name AS name, (e.former_at IS NOT NULL) AS former,
           coalesce(a.user_ids, '{}'::uuid[]) AS user_ids, coalesce(a.off, false) AS off
    FROM gym_member_list_entries e
    LEFT JOIN LATERAL (
      SELECT array_agg(m.user_id ORDER BY m.user_id) AS user_ids,
             bool_or(EXISTS (
               SELECT 1 FROM gym_member_messages_off o
               WHERE o.gym_id = m.gym_id AND o.user_id = m.user_id AND o.kind = ${GYM_GROUP_MESSAGE_KIND}
             )) AS off
      FROM gym_members m
      JOIN users u ON u.id = m.user_id AND u.status = 'active'
      WHERE m.gym_id = ${gymId} AND m.entry_id = e.id AND m.removed_at IS NULL
    ) a ON true
    WHERE e.gym_id = ${gymId} AND e.id = ANY (${[...entryIds]}::uuid[])
    ORDER BY e.full_name, e.id`;
  return rows.map((row) => ({ entryId: row.id, name: row.name, former: row.former, userIds: row.user_ids, off: row.off }));
}

/** How many group messages the gym has sent on this day of its own calendar. */
export async function sentOnDay(sql: SqlOrTx, gymId: string, gymDay: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_group_messages WHERE gym_id = ${gymId} AND gym_day = ${gymDay}::date`;
  return rows[0]?.n ?? 0;
}

/** The message already sent from this box, if one was. */
export async function byKey(sql: SqlOrTx, gymId: string, sendKey: string): Promise<{ id: string; people: number; body: string } | null> {
  const rows = await sql<{ id: string; people: number; body: string }[]>`
    SELECT id, people, body FROM gym_group_messages WHERE gym_id = ${gymId} AND send_key = ${sendKey}`;
  return rows[0] ?? null;
}

export interface NewGroupMessage {
  gymId: string;
  sentBy: string;
  body: string;
  gymDay: string;
  sendKey: string;
  userIds: readonly string[];
}

/** Writes the message and one copy for each person, in the caller's transaction. Each copy
 *  is written only for an account that is in this gym at that instant and is not deleted,
 *  whatever the list of ids holds. Answers the message's id and how many copies were written. */
export async function insertGroupMessage(tx: TransactionSql, message: NewGroupMessage, now: Date, keptDays: number): Promise<{ id: string; sent: number }> {
  const expires = new Date(now.getTime() + keptDays * 86_400_000);
  const made = await tx<{ id: string }[]>`
    INSERT INTO gym_group_messages (gym_id, sent_by, body, gym_day, sent_at, people, send_key)
    VALUES (${message.gymId}, ${message.sentBy}, ${message.body}, ${message.gymDay}::date, ${now}, ${message.userIds.length}, ${message.sendKey})
    RETURNING id`;
  const id = made[0]?.id;
  if (id === undefined) throw new Error("gym_group_messages insert returned no row");
  const copies = await tx<{ id: string }[]>`
    INSERT INTO gym_member_messages (gym_id, user_id, kind, occasion, body, gym_day, sent_at, expires_at)
    SELECT ${message.gymId}, m.user_id, ${GYM_GROUP_MESSAGE_KIND}, ${id}::text, ${message.body}, ${message.gymDay}::date, ${now}, ${expires}
    FROM unnest(${[...message.userIds]}::uuid[]) AS picked (user_id)
    JOIN gym_members m ON m.gym_id = ${message.gymId} AND m.user_id = picked.user_id AND m.removed_at IS NULL
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    ON CONFLICT (gym_id, user_id, kind, occasion) DO NOTHING
    RETURNING id`;
  // Nobody at all: the caller sends nothing and the transaction is undone.
  if (copies.length > 0 && copies.length !== message.userIds.length) {
    await tx`UPDATE gym_group_messages SET people = ${copies.length} WHERE gym_id = ${message.gymId} AND id = ${id}`;
  }
  return { id, sent: copies.length };
}

// ── THE LIST OF SENT MESSAGES (20f-ii) ──

export interface SentMessageRow {
  id: string;
  body: string;
  sentAt: Date;
  people: number;
  /** Null when that member of staff's account is gone. */
  sentByName: string | null;
}

/** This gym's sent messages, newest first, sent after `since`. `after` is the id of the
 *  last message of the page before; an id that is not this gym's message gives no rows. */
export async function sentMessages(sql: SqlOrTx, gymId: string, since: Date, after: string | null, limit: number): Promise<SentMessageRow[]> {
  const rows = await sql<{ id: string; body: string; sent_at: Date; people: number; sent_by_name: string | null }[]>`
    SELECT g.id, g.body, g.sent_at, g.people,
           CASE WHEN u.deleted_at IS NULL THEN u.display_name END AS sent_by_name
    FROM gym_group_messages g
    LEFT JOIN users u ON u.id = g.sent_by
    WHERE g.gym_id = ${gymId} AND g.sent_at > ${since}
      AND (${after}::uuid IS NULL OR (g.sent_at, g.id) < (
        SELECT p.sent_at, p.id FROM gym_group_messages p WHERE p.gym_id = ${gymId} AND p.id = ${after}::uuid))
    ORDER BY g.sent_at DESC, g.id DESC
    LIMIT ${limit}`;
  return rows.map((row) => ({ id: row.id, body: row.body, sentAt: row.sent_at, people: row.people, sentByName: row.sent_by_name }));
}

/** How many people this gym's message was sent to, or null when it is not this gym's
 *  message or was sent at or before `since`. */
export async function sentMessagePeopleCount(sql: SqlOrTx, gymId: string, messageId: string, since: Date): Promise<number | null> {
  const rows = await sql<{ people: number }[]>`
    SELECT people FROM gym_group_messages WHERE gym_id = ${gymId} AND id = ${messageId} AND sent_at > ${since}`;
  return rows[0]?.people ?? null;
}

/** Who holds a copy of this gym's message, by the name the gym's list has for them (their
 *  own name where they are on no record), in name order: the first `limit`, and how many
 *  in all. Read from the gym's people to their copy, so it never walks every copy the gym
 *  has. Somebody whose account is deleted is not named. Of a person's stays at the gym,
 *  one that has a record is read before one that has none, then the newest. */
export async function sentMessagePeople(
  sql: SqlOrTx,
  gymId: string,
  messageId: string,
  limit: number,
): Promise<{ people: { entryId: string | null; name: string }[]; named: number }> {
  const rows = await sql<{ entry_id: string | null; name: string; named: number }[]>`
    WITH got AS (
      SELECT DISTINCT ON (m.user_id) m.user_id, e.id AS entry_id,
             coalesce(nullif(e.full_name, ''), u.display_name) AS name
      FROM gym_members m
      JOIN gym_member_messages x
        ON x.gym_id = m.gym_id AND x.user_id = m.user_id AND x.kind = ${GYM_GROUP_MESSAGE_KIND} AND x.occasion = ${messageId}
      JOIN users u ON u.id = m.user_id AND u.status = 'active' AND u.deleted_at IS NULL
      LEFT JOIN gym_member_list_entries e ON e.gym_id = m.gym_id AND e.id = coalesce(m.entry_id, m.removed_entry_id)
      WHERE m.gym_id = ${gymId}
      ORDER BY m.user_id, (coalesce(m.entry_id, m.removed_entry_id) IS NULL), m.joined_at DESC
    )
    SELECT entry_id, name, (count(*) OVER ())::int AS named FROM got ORDER BY name, user_id LIMIT ${limit}`;
  return { people: rows.map((row) => ({ entryId: row.entry_id, name: row.name })), named: rows[0]?.named ?? 0 };
}

/** Removes every gym's messages sent at or before `before`, each with every person's copy
 *  of it (the hourly job). Run twice it removes nothing more. */
export async function forgetGroupMessages(sql: SqlOrTx, before: Date): Promise<{ messages: number; copies: number }> {
  const rows = await sql<{ messages: number; copies: number }[]>`
    WITH gone AS (
      DELETE FROM gym_group_messages WHERE sent_at <= ${before} RETURNING id, gym_id
    ), copies AS (
      DELETE FROM gym_member_messages m USING gone
      WHERE m.gym_id = gone.gym_id AND m.kind = ${GYM_GROUP_MESSAGE_KIND} AND m.occasion = gone.id::text
      RETURNING m.id
    )
    SELECT (SELECT count(*) FROM gone)::int AS messages, (SELECT count(*) FROM copies)::int AS copies`;
  return rows[0] ?? { messages: 0, copies: 0 };
}

// ── THE MEMBER'S OWN SWITCH ──

/** Whether this person has switched this gym's group messages off. */
export async function groupMessagesOff(sql: SqlOrTx, gymId: string, userId: string): Promise<boolean> {
  const rows = await sql<{ one: number }[]>`
    SELECT 1 AS one FROM gym_member_messages_off
    WHERE gym_id = ${gymId} AND user_id = ${userId} AND kind = ${GYM_GROUP_MESSAGE_KIND}`;
  return rows.length > 0;
}

/** Sets the person's own switch. Asked twice it is set once. */
export async function setGroupMessages(sql: SqlOrTx, gymId: string, userId: string, on: boolean, now: Date): Promise<void> {
  await setKindSwitch(sql, gymId, userId, GYM_GROUP_MESSAGE_KIND, on, now);
}

/** Sets the person's own switch for one kind at this gym. Asked twice it is set once. */
export async function setKindSwitch(sql: SqlOrTx, gymId: string, userId: string, kind: GymInboxKind, on: boolean, now: Date): Promise<void> {
  if (on) {
    await sql`
      DELETE FROM gym_member_messages_off
      WHERE gym_id = ${gymId} AND user_id = ${userId} AND kind = ${kind}`;
    return;
  }
  await sql`
    INSERT INTO gym_member_messages_off (gym_id, user_id, kind, created_at)
    VALUES (${gymId}, ${userId}, ${kind}, ${now})
    ON CONFLICT (gym_id, user_id, kind) DO NOTHING`;
}

/** The automatic kinds the person has switched off at this gym. */
export async function kindsOff(sql: SqlOrTx, gymId: string, userId: string): Promise<GymMessageKind[]> {
  const rows = await sql<{ kind: GymMessageKind }[]>`
    SELECT kind FROM gym_member_messages_off
    WHERE gym_id = ${gymId} AND user_id = ${userId} AND kind <> ${GYM_GROUP_MESSAGE_KIND}
    ORDER BY kind`;
  return rows.map((row) => row.kind);
}
