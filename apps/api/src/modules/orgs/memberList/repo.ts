// THE ONLY FILE THAT TOUCHES THE DATABASE FOR A GYM'S MEMBER LIST (R3.8; Part 3
// §9.6–§9.9).
//
// **EVERY ROW IS FETCHED WITH ITS GYM IN THE `WHERE`, WITHOUT EXCEPTION.** An
// upload id is a uuid a screen holds, and the harm on the other side of getting
// this wrong is not an error message: it is one gym reading the names, email
// addresses and phone numbers of another gym's members, most of whom never opened
// this app. So no statement here takes an id alone, not even to check a row
// exists — which is why `stagedUpload` takes the gym and the id together and
// there is no `uploadById`.
//
// **THE THREE SETS THE RULE NEEDS ARE FETCHED AND NOTHING IS DECIDED HERE**
// (§9.7). Who is new, who changed, who is leaving and what the guard says are
// `reconcile`'s, so that the preview, the confirm, the reads and 3a-iv's removal
// cannot answer differently.
import { z } from "zod";
import type { Sql, TransactionSql } from "postgres";
import {
  memberListGroupsSchema,
  memberListMappingSchema,
  memberListModeSchema,
  memberListStoredPersonSchema,
  memberListStagedFileSchema,
  memberListStagedShellSchema,
  memberListUploadStatusSchema,
  memberListUploadSummarySchema,
  type MemberListGroups,
  type MemberListMapping,
  type MemberListMode,
  type MemberListStoredPerson,
  type MemberListRowGroup,
  type MemberListStagedFile,
  type MemberListStagedShell,
  type MemberListUploadStatus,
  type MemberListUploadSummary,
} from "@app/shared";
import type { ListEntry, ListMember } from "./reconcile.js";

type SqlOrTx = Sql | TransactionSql;

/** An upload row's stored values as this module is willing to read them back.
 *  Every one of the six has a CHECK or a schema behind it in the table, and every
 *  one is parsed anyway: the CHECK is what makes this succeed, and this is what
 *  makes the types true. */
const storedShapeSchema = z.object({
  status: memberListUploadStatusSchema,
  mode: memberListModeSchema,
  fileKind: z.enum(["csv", "xlsx"]),
  mapping: memberListMappingSchema,
  summary: memberListUploadSummarySchema,
});

/** Where a gym's list stands, and what its last confirmed upload was. Null for a
 *  gym that has never confirmed one — which is what makes "this member dropped
 *  off your list" impossible to say about a gym that has no list (§9.7). */
export interface ListState {
  version: number;
  lastConfirmedAt: Date | null;
  /** The sha256 of the file that was last applied, so a preview can say "this is
   *  the same file you already confirmed" rather than letting staff apply it
   *  twice and wonder why nothing happened. */
  lastFileSha256: string | null;
  /** The mapping that upload used, with the headings it was made for, so next
   *  month's export of the same shape is mapped the same way without guessing
   *  again (§9.5). A gym whose headings we cannot read is exactly the gym that
   *  mapped them by hand, and it must not have to do it every month. */
  lastMapping: MemberListMapping | null;
  lastHeaderFingerprint: string | null;
}

/** One of the gym's own app members, and what its list says about them today. */
export interface MemberAgainstList extends ListMember {
  /** An entry of this gym matches their verified email, else their stated phone. */
  onList: boolean;
  /** That entry's own status word and member number, for showing a leaving member with
   *  what the list still says about them. Null where no entry matches. */
  entryStatus: string | null;
  entryMemberNumber: string | null;
}

export async function listState(sql: SqlOrTx, gymId: string): Promise<ListState | null> {
  const rows = await sql<
    {
      version: number;
      last_confirmed_at: Date | null;
      last_sha: string | null;
      last_mapping: unknown;
      last_fingerprint: string | null;
    }[]
  >`
    SELECT l.version,
           l.last_confirmed_at,
           u.file_sha256        AS last_sha,
           u.mapping            AS last_mapping,
           u.header_fingerprint AS last_fingerprint
    FROM gym_member_lists l
    -- The gym is on the JOIN as well as the outer WHERE. It cannot differ today
    -- (the id is this gym's own column) and it is written anyway: a join that
    -- reaches another gym's upload through one mis-set column is the one shape
    -- this file exists to make impossible.
    LEFT JOIN gym_member_list_uploads u
      ON u.id = l.last_confirmed_upload_id AND u.gym_id = l.gym_id
    WHERE l.gym_id = ${gymId}`;
  const row = rows[0];
  if (row === undefined) return null;
  // Parsed on the way out, like any other outside input: a mapping is a jsonb
  // document, and one left half-shaped by a later migration or a hand-run
  // statement would otherwise be handed to the reader as if it were a mapping.
  const mapping = row.last_mapping === null ? null : memberListMappingSchema.safeParse(row.last_mapping);
  return {
    version: row.version,
    lastConfirmedAt: row.last_confirmed_at,
    lastFileSha256: row.last_sha,
    lastMapping: mapping !== null && mapping.success ? mapping.data : null,
    lastHeaderFingerprint: row.last_fingerprint,
  };
}

/** The gym's list as it stands, in the order it was built. */
export async function listEntries(sql: SqlOrTx, gymId: string): Promise<ListEntry[]> {
  const rows = await sql<
    {
      identity_key: string;
      full_name: string;
      email: string | null;
      phone_e164: string | null;
      member_number: string | null;
      status: string | null;
    }[]
  >`
    SELECT identity_key, full_name, email::text AS email, phone_e164, member_number, status
    FROM gym_member_list_entries
    WHERE gym_id = ${gymId}
    ORDER BY created_at, id`;
  return rows.map((row) => ({
    identityKey: row.identity_key,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone_e164,
    memberNumber: row.member_number,
    status: row.status,
  }));
}

/** THE GYM'S OWN APP MEMBERS, as the match reads them (§9.7).
 *
 *  **THE THREE CONDITIONS ARE THE SEAT RULE'S OWN** — live, not complimentary,
 *  not staff — and they are written out here rather than shared as an `sql`
 *  fragment (R3.8 forbids interpolating one). The owner holds a complimentary
 *  seat and is on no gym's export, so without the second condition EVERY gym's
 *  owner would read "not on your list"; staff are the same story. `claimSeat`
 *  and `listMembers` carry the same two conditions, and a test drives this
 *  answer beside the seat count on one fixture.
 *
 *  **THE EMAIL IS THE VERIFIED ONE OR NOTHING.** An address nobody has proved is
 *  nobody's proof: matching on one would let anybody who typed a member's address
 *  into their own account be read as that member, and an invite is the gym's yes
 *  (§9.2 rule 11). The EXISTS is `isEmailVerified`'s own derivation — a CONSUMED
 *  `verify_email` token, `users` having no verified column — and `used_at IS NOT
 *  NULL` is the whole of it: a superseded token has its `expires_at` moved and
 *  its `used_at` left alone, so counting anything looser would count one. */
export async function listMembers(sql: SqlOrTx, gymId: string): Promise<ListMember[]> {
  const rows = await sql<
    {
      user_id: string;
      display_name: string;
      email: string | null;
      stated_phone_e164: string | null;
      ever_listed: boolean;
    }[]
  >`
    SELECT m.user_id,
           u.display_name,
           CASE
             WHEN EXISTS (
               SELECT 1 FROM one_time_tokens t
               WHERE t.user_id = m.user_id AND t.purpose = 'verify_email' AND t.used_at IS NOT NULL)
             THEN u.email::text
             ELSE NULL
           END AS email,
           m.stated_phone_e164,
           (m.last_listed_at IS NOT NULL) AS ever_listed
    FROM gym_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.gym_id = ${gymId}
      AND m.removed_at IS NULL
      AND m.complimentary = false
      AND NOT EXISTS (
        SELECT 1 FROM gym_staff s WHERE s.gym_id = m.gym_id AND s.user_id = m.user_id)
    ORDER BY m.joined_at, m.user_id`;
  return rows.map((row) => ({
    userId: row.user_id,
    fullName: row.display_name,
    email: row.email,
    statedPhone: row.stated_phone_e164,
    everListed: row.ever_listed,
  }));
}

export interface StageUpload {
  gymId: string;
  uploadedByUserId: string;
  mode: MemberListMode;
  fileKind: "csv" | "xlsx";
  fileSha256: string;
  fileBytes: number;
  headerFingerprint: string | null;
  mapping: MemberListMapping;
  baseVersion: number;
  summary: MemberListUploadSummary;
  file: MemberListStagedFile;
  expiresAt: Date;
}

/** STAGE ONE UPLOAD AND SUPERSEDE THE GYM'S EARLIER ONE, in one transaction
 *  under the gym's row lock.
 *
 *  **THE LOCK IS THE MODULE'S OWN ORDER — gym row, then child rows** (`claimSeat`
 *  states it once and everything here follows it, because an ordering decided
 *  per-function is an ordering that eventually reverses somewhere and deadlocks).
 *  It is taken for a reason this half can already reach: two staff uploading at
 *  the same moment must not both end up staged, or a confirm would apply
 *  whichever file the screen happened to be showing.
 *
 *  **SUPERSEDING EMPTIES THE OLD ROW'S CELLS.** `rows` is set to NULL in the same
 *  statement that moves the status, so no file's names and addresses outlive the
 *  moment the file stopped being the answer — which the table's own CHECK then
 *  holds for every later writer too. */
export async function stageUpload(sql: Sql, input: StageUpload): Promise<string> {
  return await sql.begin(async (tx) => {
    await tx`SELECT 1 FROM gyms WHERE id = ${input.gymId} FOR UPDATE`;
    await tx`
      UPDATE gym_member_list_uploads
      SET status = 'superseded', rows = NULL
      WHERE gym_id = ${input.gymId} AND status = 'staged'`;
    const rows = await tx<{ id: string }[]>`
      INSERT INTO gym_member_list_uploads
        (gym_id, uploaded_by_user_id, status, mode, file_kind, file_sha256, file_bytes,
         header_fingerprint, mapping, base_version, summary, rows, expires_at)
      VALUES
        (${input.gymId}, ${input.uploadedByUserId}, 'staged', ${input.mode}, ${input.fileKind},
         ${input.fileSha256}, ${input.fileBytes}, ${input.headerFingerprint},
         ${tx.json(input.mapping)}, ${input.baseVersion}, ${tx.json(input.summary)},
         ${tx.json(input.file)}, ${input.expiresAt})
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("staging a member-list upload returned no row");
    return id;
  });
}

export interface UploadRow {
  id: string;
  status: MemberListUploadStatus;
  mode: MemberListMode;
  fileKind: "csv" | "xlsx";
  fileSha256: string;
  fileBytes: number;
  headerFingerprint: string | null;
  mapping: MemberListMapping;
  baseVersion: number;
  summary: MemberListUploadSummary;
  /** Whether the file's own cells are still held. **The cells themselves are NOT
   *  read here**, and that is the point: at ten thousand people the document is the
   *  most expensive thing in this module to fetch and to parse, and neither route
   *  needs all of it. A page asks the database for its hundred rows
   *  (`stagedPage`); a preview asks for everything except the rows
   *  (`stagedShell`); only a preview whose list has MOVED since it was staged pays
   *  for the whole thing (`stagedFile`). */
  hasCells: boolean;
  createdAt: Date;
  expiresAt: Date;
}

/** ONE UPLOAD OF THIS GYM, by both ids together. There is deliberately no
 *  `uploadById`: the only way to ask for an upload in this module is to say whose
 *  it is.
 *
 *  **A STAGED UPLOAD PAST ITS OWN `expires_at` IS ANSWERED AS EXPIRED WITHOUT
 *  WAITING FOR THE JOB.** The hourly sweep is housekeeping — it frees the cells —
 *  and nothing correct may depend on it having run: a preview read a minute after
 *  its hour must be as gone as one read a day later. `now` is handed in so the
 *  clock is the caller's and a test can move it. */
export async function uploadFor(
  sql: SqlOrTx,
  gymId: string,
  uploadId: string,
  now: Date,
): Promise<UploadRow | null> {
  const rows = await sql<
    {
      id: string;
      status: string;
      mode: string;
      file_kind: string;
      file_sha256: string;
      file_bytes: number;
      header_fingerprint: string | null;
      mapping: unknown;
      base_version: number;
      summary: unknown;
      has_rows: boolean;
      created_at: Date;
      expires_at: Date;
    }[]
  >`
    SELECT id, status, mode, file_kind, file_sha256, file_bytes, header_fingerprint,
           mapping, base_version, summary, (rows IS NOT NULL) AS has_rows, created_at, expires_at
    FROM gym_member_list_uploads
    WHERE gym_id = ${gymId} AND id = ${uploadId}`;
  const row = rows[0];
  if (row === undefined) return null;
  // PARSED, NOT CAST, INCLUDING THE THREE TEXT COLUMNS WITH A CHECK BEHIND THEM.
  // The CHECK is what makes the parse succeed; the parse is what makes the type
  // true. A cast here would be the one place in the module where the compiler's
  // word for "this is a mode" came from nothing but a comment, and the column is
  // one ALTER away from carrying a fourth value nothing in the code handles.
  const shape = storedShapeSchema.safeParse({
    status: row.status,
    mode: row.mode,
    fileKind: row.file_kind,
    mapping: row.mapping,
    summary: row.summary,
  });
  // A document we wrote that no longer parses is a fault of the server's own, not
  // of whoever asked: loud, and with no cell in the message.
  if (!shape.success) {
    throw new Error(`member-list upload ${uploadId} holds a stored value that no longer parses`);
  }
  const stale = shape.data.status === "staged" && row.expires_at.getTime() <= now.getTime();
  return {
    id: row.id,
    status: stale ? "expired" : shape.data.status,
    mode: shape.data.mode,
    fileKind: shape.data.fileKind,
    fileSha256: row.file_sha256,
    fileBytes: row.file_bytes,
    headerFingerprint: row.header_fingerprint,
    mapping: shape.data.mapping,
    baseVersion: row.base_version,
    summary: shape.data.summary,
    // An expired upload's cells are answered as gone even before the sweep has
    // emptied the column, so the two agree at every instant.
    hasCells: !stale && row.has_rows,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** EVERYTHING THE SERVER UNDERSTOOD OF THE FILE EXCEPT THE ROWS — the columns with
 *  their sample cells, the warnings, the skipped rows, the file's own facts and its
 *  counts. This is what a preview is built from, and it stays small whatever the file
 *  holds: a hundred columns of three samples each, at most two hundred skipped rows,
 *  and a handful of warnings.
 *
 *  `- 'rows'` is the whole optimisation: the database drops the ten thousand people
 *  before the answer crosses to this process, so nothing here parses them. */
export async function stagedShell(sql: SqlOrTx, gymId: string, uploadId: string): Promise<MemberListStagedShell | null> {
  const rows = await sql<{ shell: unknown }[]>`
    SELECT (rows -> 'understanding') - 'rows' AS shell
    FROM gym_member_list_uploads
    WHERE gym_id = ${gymId} AND id = ${uploadId} AND rows IS NOT NULL`;
  const held = rows[0]?.shell;
  if (held === undefined || held === null) return null;
  const parsed = memberListStagedShellSchema.safeParse(held);
  if (!parsed.success) throw new Error(`member-list upload ${uploadId} holds a file document that no longer parses`);
  return parsed.data;
}

/** ONE PAGE OF A GROUP, CUT OUT BY THE DATABASE.
 *
 *  **NOTHING HERE READS THE WHOLE FILE, AND THAT IS THE WHOLE REASON THIS FUNCTION
 *  EXISTS.** A page used to cost a fetch of every row, a parse of every row, a fetch
 *  of every person already on the list and a full re-run of the comparison rule — to
 *  show a hundred names. Measured before the change: a page of a ten-thousand-person
 *  gym took 242-414 ms and stalled this process for up to 121 ms, the same whichever
 *  page it was, so looking through one gym's list was 33 seconds of work and about
 *  twelve seconds in which the server answered nobody at all.
 *
 *  The grouping was worked out once, when the file was staged (`memberListGroupsSchema`).
 *  For a group of people IN the file, each entry is a place in `rows` plus the one
 *  thing the row itself cannot say — what the list said about them before — and the
 *  row is merged with it here, by the database, so only the hundred rows of this page
 *  are ever built. For `gone`, whom the file does not hold, the entries are already
 *  the answer. **Nothing here says whether somebody is in the app**: that is a fact
 *  about one of the gym's members, never stored, and the service fills it in from the
 *  members as they are now (review of PR #87, High-1).
 *
 *  `WITH ORDINALITY` numbers the group in its own order from 1, so the cursor is a
 *  plain offset into that order and no row's place depends on how jsonb stores it.
 *
 *  Both bounds are whole numbers worked out HERE and cast in the statement: Postgres
 *  cannot add two parameters it has no type for (`operator is not unique: unknown +
 *  unknown`), and arithmetic on a page's edge belongs where the numbers already are. */
export async function stagedPage(
  sql: SqlOrTx,
  gymId: string,
  uploadId: string,
  group: MemberListRowGroup,
  cursor: number,
  limit: number,
): Promise<{ total: number; people: MemberListStoredPerson[] } | null> {
  // The two shapes are read by two statements rather than one with a branch inside
  // it: a CASE over jsonb in the middle of a lateral is the kind of SQL nobody reads
  // twice, and these are two different questions.
  const inTheFile = group === "new" || group === "changed" || group === "unchanged";
  const key = group === "members_leaving" ? "membersLeaving" : group;
  const rows = inTheFile
    ? await sql<{ total: number; people: unknown }[]>`
        SELECT jsonb_array_length(u.rows -> 'groups' -> ${key}) AS total,
               COALESCE((
                 SELECT jsonb_agg(
                          (u.rows -> 'understanding' -> 'rows' -> ((g ->> 'at')::int))
                          || jsonb_build_object('wasStatus', g -> 'wasStatus')
                          ORDER BY ord)
                 FROM jsonb_array_elements(u.rows -> 'groups' -> ${key}) WITH ORDINALITY AS t(g, ord)
                 WHERE ord > ${cursor}::int AND ord <= ${cursor + limit}::int
               ), '[]'::jsonb) AS people
        FROM gym_member_list_uploads u
        WHERE u.gym_id = ${gymId} AND u.id = ${uploadId} AND u.rows IS NOT NULL`
    : await sql<{ total: number; people: unknown }[]>`
        SELECT jsonb_array_length(u.rows -> 'groups' -> ${key}) AS total,
               COALESCE((
                 SELECT jsonb_agg(g ORDER BY ord)
                 FROM jsonb_array_elements(u.rows -> 'groups' -> ${key}) WITH ORDINALITY AS t(g, ord)
                 WHERE ord > ${cursor}::int AND ord <= ${cursor + limit}::int
               ), '[]'::jsonb) AS people
        FROM gym_member_list_uploads u
        WHERE u.gym_id = ${gymId} AND u.id = ${uploadId} AND u.rows IS NOT NULL`;
  const row = rows[0];
  if (row === undefined) return null;
  // THE TOTAL IS PARSED TOO, and not because a document we wrote is expected to be
  // wrong: `jsonb_array_length` of a key that is not there answers SQL NULL, not an
  // error, so a document missing a group — one written before this shape existed, or
  // by a hand-run statement — would send `total: null` to a screen and break the
  // reply's own contract with nothing anywhere saying so. A place pointing past the
  // end of the rows is caught by the people below, where the merge yields a null the
  // person shape refuses.
  const page = z
    .object({ total: z.number().int().min(0), people: z.array(memberListStoredPersonSchema) })
    .safeParse({ total: row.total, people: row.people });
  if (!page.success) throw new Error(`member-list upload ${uploadId} holds a group that no longer parses`);
  return page.data;
}

/** THE GROUPING ALONE — which people fell into which group, without the rows they point
 *  into. Small whatever the file holds: a place and a status word each, and the gym's own
 *  record of anybody coming off the list. A preview is built from this and `stagedShell`,
 *  so neither read fetches ten thousand people back into this process. */
export async function stagedGroups(sql: SqlOrTx, gymId: string, uploadId: string): Promise<MemberListGroups | null> {
  const rows = await sql<{ groups: unknown }[]>`
    SELECT rows -> 'groups' AS groups
    FROM gym_member_list_uploads
    WHERE gym_id = ${gymId} AND id = ${uploadId} AND rows IS NOT NULL`;
  const held = rows[0]?.groups;
  if (held === undefined || held === null) return null;
  const parsed = memberListGroupsSchema.safeParse(held);
  if (!parsed.success) throw new Error(`member-list upload ${uploadId} holds groups that no longer parse`);
  return parsed.data;
}

/** HOW THE FILE CAN REACH EACH OF ITS PEOPLE — the emails and the phone numbers of the
 *  staged rows, in the rows' own order, and nothing else.
 *
 *  **IT EXISTS SO THAT A READ CAN ANSWER EVERY QUESTION ABOUT THE GYM'S OWN MEMBERS
 *  AFRESH WITHOUT READING THE WHOLE FILE** (review of PR #87, High-1). Whether somebody
 *  is already in the app, how many seats are used, which members would be marked as
 *  having dropped off — none of those can be stored, because nothing a gym does to its
 *  LIST moves when a member joins or proves an address. All of them need only these two
 *  arrays of strings, which the database builds and which cost a fraction of parsing ten
 *  thousand people back into objects.
 *
 *  `jsonb_path_query_array` keeps the rows' order, so index `n` here is the same person
 *  as place `n` in a stored group. A row with no email answers JSON null and keeps its
 *  place; dropping the nulls would shift everybody after it onto somebody else. */
export async function stagedContacts(
  sql: SqlOrTx,
  gymId: string,
  uploadId: string,
): Promise<{ emails: (string | null)[]; phones: (string | null)[] } | null> {
  const rows = await sql<{ emails: unknown; phones: unknown }[]>`
    SELECT jsonb_path_query_array(rows, '$.understanding.rows[*].email') AS emails,
           jsonb_path_query_array(rows, '$.understanding.rows[*].phone') AS phones
    FROM gym_member_list_uploads
    WHERE gym_id = ${gymId} AND id = ${uploadId} AND rows IS NOT NULL`;
  const row = rows[0];
  if (row === undefined) return null;
  const parsed = z
    .object({ emails: z.array(z.string().nullable()), phones: z.array(z.string().nullable()) })
    .safeParse({ emails: row.emails, phones: row.phones });
  if (!parsed.success) throw new Error(`member-list upload ${uploadId} holds rows that no longer parse`);
  if (parsed.data.emails.length !== parsed.data.phones.length) {
    throw new Error(`member-list upload ${uploadId} holds ${String(parsed.data.emails.length)} emails and ${String(parsed.data.phones.length)} phones`);
  }
  return parsed.data;
}

/** THE GYM'S OWN APP MEMBERS, AND WHETHER ITS LIST HOLDS THEM — one statement, read
 *  fresh on every read of a preview.
 *
 *  It is `listMembers` plus the one question that used to cost fetching every entry into
 *  this process: does an entry of this gym match this member? The matched entry's own
 *  words come back with it, so a leaving member can be shown with what the list still
 *  says about them.
 *
 *  **THE SHAPE IS THE WHOLE POINT, AND THE FIRST VERSION OF IT READ TWO MILLION ROWS TO
 *  ANSWER TWO HUNDRED QUESTIONS** (review of PR #87, High-B). It asked one lateral with
 *  `email = … OR phone_e164 = …`, and used neither index: an `OR` across two columns
 *  rules both out, and casting `u.email` to `text` cast the citext COLUMN to text with
 *  it, so the index on it no longer applied. Measured on 200 members against 10,000
 *  entries: a sequential scan per member, 284–339 ms, on the single Postgres connection
 *  the whole API shares — and it ran on the preview read and on every page of names,
 *  growing as members × entries. Split into a UNION ALL of the two matches, each its
 *  own indexed lookup, the same answer costs single-digit milliseconds.
 *
 *  **The citext comparison is also the correct one.** `x.email = u.email` is citext to
 *  citext, which folds case exactly as `reconcile`'s `foldEmail` does in this process.
 *  The cast made it text to text, so SQL answered case-SENSITIVELY while the pure rule
 *  answered case-insensitively — the two could disagree about one person, and a test
 *  drives that case directly rather than trusting that sign-in lower-cases everything
 *  it stores today.
 *
 *  **THE EMAIL IS THE VERIFIED ONE OR NOTHING, and the three conditions are the seat
 *  rule's own** — live, not complimentary, not staff. `listMembers`' header carries the
 *  full reasoning for both; this statement is the same rule with one more column, and a
 *  test drives the two side by side so they cannot drift.
 *
 *  A FAMILY SHARING ONE ADDRESS has several entries against it; `ORDER BY e.created_at`
 *  inside the lateral takes the first, which is what `reconcile` does in this process,
 *  because the list itself offers nothing to choose between them. */
export async function membersAgainstList(sql: SqlOrTx, gymId: string): Promise<MemberAgainstList[]> {
  const rows = await sql<
    {
      user_id: string;
      display_name: string;
      email: string | null;
      stated_phone_e164: string | null;
      ever_listed: boolean;
      entry_status: string | null;
      entry_member_number: string | null;
      on_list: boolean;
    }[]
  >`
    SELECT m.user_id,
           u.display_name,
           CASE WHEN v.proved THEN u.email::text ELSE NULL END AS email,
           m.stated_phone_e164,
           (m.last_listed_at IS NOT NULL) AS ever_listed,
           e.status        AS entry_status,
           e.member_number AS entry_member_number,
           (e.id IS NOT NULL) AS on_list
    FROM gym_members m
    JOIN users u ON u.id = m.user_id
    CROSS JOIN LATERAL (
      SELECT EXISTS (
               SELECT 1 FROM one_time_tokens t
               WHERE t.user_id = m.user_id AND t.purpose = 'verify_email' AND t.used_at IS NOT NULL) AS proved
    ) v
    LEFT JOIN LATERAL (
      SELECT c.id, c.status, c.member_number
      FROM (
        (SELECT x.id, x.status, x.member_number, x.created_at
         FROM gym_member_list_entries x
         WHERE x.gym_id = m.gym_id AND v.proved AND x.email = u.email
         ORDER BY x.created_at, x.id
         LIMIT 1)
        UNION ALL
        (SELECT x.id, x.status, x.member_number, x.created_at
         FROM gym_member_list_entries x
         WHERE x.gym_id = m.gym_id AND m.stated_phone_e164 IS NOT NULL AND x.phone_e164 = m.stated_phone_e164
         ORDER BY x.created_at, x.id
         LIMIT 1)
      ) c
      ORDER BY c.created_at, c.id
      LIMIT 1
    ) e ON true
    WHERE m.gym_id = ${gymId}
      AND m.removed_at IS NULL
      AND m.complimentary = false
      AND NOT EXISTS (
        SELECT 1 FROM gym_staff s WHERE s.gym_id = m.gym_id AND s.user_id = m.user_id)
    ORDER BY m.joined_at, m.user_id`;
  return rows.map((row) => ({
    userId: row.user_id,
    fullName: row.display_name,
    email: row.email,
    statedPhone: row.stated_phone_e164,
    everListed: row.ever_listed,
    onList: row.on_list,
    entryStatus: row.entry_status,
    entryMemberNumber: row.entry_member_number,
  }));
}

/** THE WHOLE DOCUMENT, rows and all — the expensive read, and the only caller is a
 *  preview whose gym has changed its list since the file was staged, which makes the
 *  stored grouping stale and the comparison worth running again (§9.7). Rare by
 *  construction: nothing but a confirm or a typed-in person moves the version. */
export async function stagedFile(sql: SqlOrTx, gymId: string, uploadId: string): Promise<MemberListStagedFile | null> {
  const rows = await sql<{ rows: unknown }[]>`
    SELECT rows FROM gym_member_list_uploads
    WHERE gym_id = ${gymId} AND id = ${uploadId} AND rows IS NOT NULL`;
  const held = rows[0]?.rows;
  if (held === undefined || held === null) return null;
  const parsed = memberListStagedFileSchema.safeParse(held);
  if (!parsed.success) throw new Error(`member-list upload ${uploadId} holds cells that no longer parse`);
  return parsed.data;
}

/** THE HOURLY HOUSEKEEPING (§9.6, `orgs.member_list_expiry`): a staged upload
 *  nobody confirmed becomes `expired` and its cells go.
 *
 *  Set-based, and its own WHERE excludes the state it produces, so running it
 *  twice is a no-op and a retry is free. The clock is injected — a sweep is
 *  exactly the kind of code that cannot be tested against `now()`. */
export async function expireStagedUploads(
  sql: Sql,
  now: Date,
  gymIds: readonly string[] | null,
): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_member_list_uploads
    SET status = 'expired', rows = NULL
    WHERE status = 'staged' AND expires_at <= ${now}
      -- id = ANY(NULL) is NULL rather than false, which filters every row out,
      -- so the IS NULL test comes first - sweep.ts's own shape, and the reason
      -- the nightly jobs in this module all carry it.
      AND (${gymIds}::uuid[] IS NULL OR gym_id = ANY(${gymIds}::uuid[]))
    RETURNING id`;
  return rows.length;
}

/** EVERYTHING THIS GYM'S LIST IS, DELETED — called inside the transaction that
 *  archives a gym (§9.6). The list is the gym's record, held for the gym, so what
 *  ends it is the gym ending. Takes the transaction, never its own, because a
 *  gym archived and its list kept is exactly the half-state nothing else would
 *  notice. */
export async function deleteListForGym(tx: TransactionSql, gymId: string): Promise<void> {
  await tx`DELETE FROM gym_member_list_uploads WHERE gym_id = ${gymId}`;
  await tx`DELETE FROM gym_member_list_entries WHERE gym_id = ${gymId}`;
  await tx`DELETE FROM gym_member_lists WHERE gym_id = ${gymId}`;
}
