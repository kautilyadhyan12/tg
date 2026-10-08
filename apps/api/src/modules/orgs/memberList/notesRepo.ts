// STAFF NOTES AND TAGS — the statements (ROADMAP Stage 2 item 5d; spec Part 3 §18.13).
// Every one carries the gym in its WHERE: a note or tag of another gym is not there.
import type { MemberNote, MemberTag } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";

type SqlOrTx = Sql | TransactionSql;

interface NoteRow {
  id: string;
  body: string;
  author_name: string | null;
  created_at: Date;
}

const toNote = (row: NoteRow): MemberNote => ({
  id: row.id,
  body: row.body,
  authorName: row.author_name,
  createdAt: row.created_at.toISOString(),
});

/** One record's notes, newest first. A deleted account's name is not shown. */
export async function notesOf(sql: SqlOrTx, gymId: string, entryId: string): Promise<MemberNote[]> {
  const rows = await sql<NoteRow[]>`
    SELECT n.id, n.body, n.created_at,
           CASE WHEN u.deleted_at IS NULL THEN u.display_name END AS author_name
    FROM gym_member_notes n
    LEFT JOIN users u ON u.id = n.author_user_id
    WHERE n.gym_id = ${gymId} AND n.entry_id = ${entryId}
    ORDER BY n.created_at DESC, n.id DESC`;
  return rows.map(toNote);
}

export async function countNotes(tx: TransactionSql, gymId: string, entryId: string): Promise<number> {
  const rows = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_member_notes WHERE gym_id = ${gymId} AND entry_id = ${entryId}`;
  return rows[0]?.n ?? 0;
}

/** The note this press already made on this record, if it did. */
export async function noteByRequest(sql: SqlOrTx, gymId: string, entryId: string, requestKey: string): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM gym_member_notes
    WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND request_key = ${requestKey}`;
  return rows[0]?.id ?? null;
}

/** Null when the press's key is already used in this gym. */
export async function insertNote(
  tx: TransactionSql,
  note: { gymId: string; entryId: string; body: string; authorUserId: string; requestKey: string; at: Date },
): Promise<string | null> {
  const rows = await tx<{ id: string }[]>`
    INSERT INTO gym_member_notes (gym_id, entry_id, body, author_user_id, request_key, created_at)
    VALUES (${note.gymId}, ${note.entryId}, ${note.body}, ${note.authorUserId}, ${note.requestKey}, ${note.at})
    ON CONFLICT (gym_id, request_key) DO NOTHING
    RETURNING id`;
  return rows[0]?.id ?? null;
}

export async function deleteNote(tx: TransactionSql, gymId: string, entryId: string, noteId: string): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    DELETE FROM gym_member_notes
    WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND id = ${noteId}
    RETURNING id`;
  return rows.length === 1;
}

/** One record's tags, by name. */
export async function tagsOf(sql: SqlOrTx, gymId: string, entryId: string): Promise<MemberTag[]> {
  return await sql<MemberTag[]>`
    SELECT t.id, t.name
    FROM gym_member_entry_tags et
    JOIN gym_member_tags t ON t.gym_id = et.gym_id AND t.id = et.tag_id
    WHERE et.gym_id = ${gymId} AND et.entry_id = ${entryId}
    ORDER BY lower(t.name)`;
}

/** Every tag the gym has made, by name. */
export async function gymTags(sql: SqlOrTx, gymId: string): Promise<MemberTag[]> {
  return await sql<MemberTag[]>`
    SELECT id, name FROM gym_member_tags WHERE gym_id = ${gymId} ORDER BY lower(name)`;
}

export async function tagByName(tx: TransactionSql, gymId: string, name: string): Promise<MemberTag | null> {
  const rows = await tx<MemberTag[]>`
    SELECT id, name FROM gym_member_tags WHERE gym_id = ${gymId} AND lower(name) = lower(${name})`;
  return rows[0] ?? null;
}

export async function insertTag(tx: TransactionSql, gymId: string, name: string, userId: string): Promise<MemberTag> {
  const rows = await tx<MemberTag[]>`
    INSERT INTO gym_member_tags (gym_id, name, created_by)
    VALUES (${gymId}, ${name}, ${userId})
    RETURNING id, name`;
  const row = rows[0];
  if (row === undefined) throw new Error("a tag was inserted and did not come back");
  return row;
}

/** False when the record already had it. */
export async function putTagOn(tx: TransactionSql, gymId: string, entryId: string, tagId: string, userId: string): Promise<boolean> {
  const rows = await tx<{ tag_id: string }[]>`
    INSERT INTO gym_member_entry_tags (gym_id, entry_id, tag_id, created_by)
    VALUES (${gymId}, ${entryId}, ${tagId}, ${userId})
    ON CONFLICT (entry_id, tag_id) DO NOTHING
    RETURNING tag_id`;
  return rows.length === 1;
}

export async function takeTagOff(tx: TransactionSql, gymId: string, entryId: string, tagId: string): Promise<boolean> {
  const rows = await tx<{ tag_id: string }[]>`
    DELETE FROM gym_member_entry_tags
    WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND tag_id = ${tagId}
    RETURNING tag_id`;
  return rows.length === 1;
}

/** Two records joined: the notes and tags of the one not kept become the kept one's. A
 *  tag both had is one tag. */
export async function moveNotesAndTags(tx: TransactionSql, gymId: string, fromEntryId: string, toEntryId: string): Promise<void> {
  await tx`
    UPDATE gym_member_notes SET entry_id = ${toEntryId}
    WHERE gym_id = ${gymId} AND entry_id = ${fromEntryId}`;
  await tx`
    INSERT INTO gym_member_entry_tags (gym_id, entry_id, tag_id, created_by, created_at)
    SELECT gym_id, ${toEntryId}, tag_id, created_by, created_at
    FROM gym_member_entry_tags
    WHERE gym_id = ${gymId} AND entry_id = ${fromEntryId}
    ON CONFLICT (entry_id, tag_id) DO NOTHING`;
}
