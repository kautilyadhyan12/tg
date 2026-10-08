// STAFF NOTES AND TAGS — the statements (ROADMAP Stage 2 item 5d; spec Part 3 §18.13).
// Every one carries the gym in its WHERE: a note or tag of another gym is not there.
import { MEMBER_NOTES_PAGE, type MemberGymTag, type MemberNote, type MemberTag } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";

export type SqlOrTx = Sql | TransactionSql;

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

/** One record's newest notes, newest first: one page, however many a join has left it.
 *  A deleted account's name is not shown. */
export async function notesOf(sql: SqlOrTx, gymId: string, entryId: string): Promise<MemberNote[]> {
  const rows = await sql<NoteRow[]>`
    SELECT n.id, n.body, n.created_at,
           CASE WHEN u.deleted_at IS NULL THEN u.display_name END AS author_name
    FROM gym_member_notes n
    LEFT JOIN users u ON u.id = n.author_user_id
    WHERE n.gym_id = ${gymId} AND n.entry_id = ${entryId}
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT ${MEMBER_NOTES_PAGE}`;
  return rows.map(toNote);
}

/** The page of one record's notes older than its note `beforeNoteId`, and whether there
 *  are older still; null when the record has no such note. */
export async function notesOlderThan(
  sql: SqlOrTx,
  gymId: string,
  entryId: string,
  beforeNoteId: string,
): Promise<{ notes: MemberNote[]; more: boolean } | null> {
  const from = await sql<{ id: string }[]>`
    SELECT id FROM gym_member_notes
    WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND id = ${beforeNoteId}`;
  if (from[0] === undefined) return null;
  // The two times are compared inside Postgres, which keeps a finer time than a Date carries.
  const rows = await sql<NoteRow[]>`
    SELECT n.id, n.body, n.created_at,
           CASE WHEN u.deleted_at IS NULL THEN u.display_name END AS author_name
    FROM gym_member_notes n
    LEFT JOIN users u ON u.id = n.author_user_id
    WHERE n.gym_id = ${gymId} AND n.entry_id = ${entryId}
      AND (n.created_at, n.id) < (
        SELECT c.created_at, c.id FROM gym_member_notes c
        WHERE c.gym_id = ${gymId} AND c.entry_id = ${entryId} AND c.id = ${beforeNoteId})
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT ${MEMBER_NOTES_PAGE + 1}`;
  return { notes: rows.slice(0, MEMBER_NOTES_PAGE).map(toNote), more: rows.length > MEMBER_NOTES_PAGE };
}

export async function countNotes(sql: SqlOrTx, gymId: string, entryId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
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

export async function tagByName(tx: SqlOrTx, gymId: string, name: string): Promise<MemberTag | null> {
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

// ── Tags on the Members list (5d-ii) ──

/** Every tag the gym has made, by name, with how many members and past members hold it.
 *  A tag's rows are found by the gym and the tag, and each record by its id alone, so the
 *  statement has one plan whatever Postgres believes the tables hold: on a list of 10,000
 *  just tagged, a record looked up by its gym was a minute. The record's gym is checked in
 *  the count. */
export async function gymTagsCounted(sql: SqlOrTx, gymId: string): Promise<MemberGymTag[]> {
  return await sql<MemberGymTag[]>`
    SELECT t.id, t.name,
           (count(*) FILTER (WHERE e.gym_id = t.gym_id AND e.former_at IS NULL))::int AS people,
           (count(*) FILTER (WHERE e.gym_id = t.gym_id AND e.former_at IS NOT NULL))::int AS "pastPeople"
    FROM gym_member_tags t
    LEFT JOIN gym_member_entry_tags et ON et.gym_id = t.gym_id AND et.tag_id = t.id
    LEFT JOIN gym_member_list_entries e ON e.id = et.entry_id
    WHERE t.gym_id = ${gymId}
    GROUP BY t.id, t.name
    ORDER BY lower(t.name)`;
}

export async function tagById(sql: SqlOrTx, gymId: string, tagId: string): Promise<MemberTag | null> {
  const rows = await sql<MemberTag[]>`
    SELECT id, name FROM gym_member_tags WHERE gym_id = ${gymId} AND id = ${tagId}`;
  return rows[0] ?? null;
}

/** One selected record as a tag press reads it. */
export interface TagStateRow {
  entryId: string;
  name: string;
  /** How many tags the record holds. */
  held: number;
  /** Whether it holds the tag asked about. */
  has: boolean;
}

/** These records of this gym, in the list's order; `tagId` null is a tag not made yet.
 *  Two reads of one table each, put together here: joined in one statement, a list of
 *  10,000 just tagged took most of a minute while Postgres's counts were out of date. */
export async function tagStateOf(sql: SqlOrTx, gymId: string, entryIds: readonly string[], tagId: string | null): Promise<TagStateRow[]> {
  const ids = [...entryIds];
  const [records, tags] = await Promise.all([
    sql<{ id: string; name: string }[]>`
      SELECT id, full_name AS name
      FROM gym_member_list_entries
      WHERE gym_id = ${gymId} AND id = ANY (${ids}::uuid[])
      ORDER BY full_name, id`,
    sql<{ entry_id: string; held: number; has: boolean }[]>`
      SELECT entry_id, count(*)::int AS held, coalesce(bool_or(tag_id = ${tagId}::uuid), false) AS has
      FROM gym_member_entry_tags
      WHERE gym_id = ${gymId} AND entry_id = ANY (${ids}::uuid[])
      GROUP BY entry_id`,
  ]);
  const byRecord = new Map(tags.map((row) => [row.entry_id, row]));
  return records.map((record) => ({ entryId: record.id, name: record.name, held: byRecord.get(record.id)?.held ?? 0, has: byRecord.get(record.id)?.has ?? false }));
}

/** The records of this gym that hold this one of its tags: the list's tag filter. */
export async function entryIdsWithTag(sql: SqlOrTx, gymId: string, tagId: string): Promise<string[]> {
  const rows = await sql<{ entry_id: string }[]>`
    SELECT entry_id FROM gym_member_entry_tags WHERE gym_id = ${gymId} AND tag_id = ${tagId}`;
  return rows.map((row) => row.entry_id);
}

/** Puts one of the gym's tags on these records; how many got it. The caller has read the
 *  records and the tag as this gym's in the same transaction, and the table's two foreign
 *  keys refuse a record or a tag of any other gym. */
export async function putTagOnMany(tx: TransactionSql, gymId: string, entryIds: readonly string[], tagId: string, userId: string): Promise<number> {
  const rows = await tx<{ entry_id: string }[]>`
    INSERT INTO gym_member_entry_tags (gym_id, entry_id, tag_id, created_by)
    SELECT ${gymId}, picked.id, ${tagId}, ${userId}
    FROM unnest(${[...entryIds]}::uuid[]) AS picked (id)
    ON CONFLICT (entry_id, tag_id) DO NOTHING
    RETURNING entry_id`;
  return rows.length;
}

export async function takeTagOffMany(tx: TransactionSql, gymId: string, entryIds: readonly string[], tagId: string): Promise<number> {
  const rows = await tx<{ entry_id: string }[]>`
    DELETE FROM gym_member_entry_tags
    WHERE gym_id = ${gymId} AND tag_id = ${tagId} AND entry_id = ANY (${[...entryIds]}::uuid[])
    RETURNING entry_id`;
  return rows.length;
}

export async function renameTag(tx: TransactionSql, gymId: string, tagId: string, name: string): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_member_tags SET name = ${name} WHERE gym_id = ${gymId} AND id = ${tagId} RETURNING id`;
  return rows.length === 1;
}

/** How many records hold one of the gym's tags: members and past members together. */
export async function countTagHolders(tx: TransactionSql, gymId: string, tagId: string): Promise<number> {
  const held = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_member_entry_tags WHERE gym_id = ${gymId} AND tag_id = ${tagId}`;
  return held[0]?.n ?? 0;
}

/** Deletes one of the gym's tags, and with it the tag on every record that held it; false
 *  when the gym has no such tag. */
export async function deleteTag(tx: TransactionSql, gymId: string, tagId: string): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    DELETE FROM gym_member_tags WHERE gym_id = ${gymId} AND id = ${tagId} RETURNING id`;
  return rows.length === 1;
}
