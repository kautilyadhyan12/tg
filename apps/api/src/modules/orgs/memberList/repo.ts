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
  MEMBER_LIST_MAX_EDITED_FIELDS,
  MEMBER_LIST_MAX_ENTRY_MEMBERS,
  MEMBER_LIST_STATUS_CHIPS_MAX,
  memberListEditedFieldSchema,
  memberListEntrySourceSchema,
  memberListExtraDocumentSchema,
  memberListGroupsSchema,
  memberListMappingSchema,
  memberListModeSchema,
  memberListStoredPersonSchema,
  memberListStagedFileSchema,
  memberListStagedShellSchema,
  memberListUploadStatusSchema,
  memberListUploadSummarySchema,
  type MemberListEntrySource,
  type MemberListGroups,
  type MemberListMapping,
  type MemberListMode,
  type MemberListRecords,
  type MemberListStoredPerson,
  type MemberListRowGroup,
  type MemberListStagedFile,
  type MemberListStagedShell,
  type MemberListUploadStatus,
  type MemberListUploadSummary,
} from "@app/shared";
import type { EntryValues } from "./byHand.js";
import type { CarriedFields, ListEntry, ListMember } from "./reconcile.js";

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
  /** The record they joined with is current; with no such record, a current entry of
   *  this gym matches their verified email, else their stated phone. */
  onList: boolean;
  /** WHICH entry, so a read of the kept list can say which of its people are already
   *  members here. Null where no entry matches.
   *
   *  **It is the entry this ONE member matched, chosen by §9.7's own order, not every
   *  entry that could reach them.** A family sharing one address has several entries
   *  against it and `reconcile`'s `entryFor` takes the first; this takes the same one,
   *  so the list's "already in the app" ticks and the preview's agree about a household
   *  instead of the screen and the rule telling a gym two different stories. */
  entryId: string | null;
  /** That entry's own status word and member number, for showing a leaving member with
   *  what the list still says about them. Null where no entry matches. */
  entryStatus: string | null;
  entryMemberNumber: string | null;
  /** WHICH FORMER RECORD THIS MEMBER MATCHES, AND NOTHING ELSE (round one, Low-2).
   *
   *  It answers one question only: a page asked for the gym's FORMER records has to be
   *  able to say "this one is somebody who is in the app", and the match above
   *  deliberately cannot, because it excludes former records so that one can never
   *  admit anybody or be counted where an invite is decided (§11.1).
   *
   *  So it is read by a page's `inApp` tick when the page was asked for the former
   *  records, and by NOTHING else: not the marks, not `leaving`, not the guard, not a
   *  chip, not `canBeInvited`. */
  formerEntryId: string | null;
  /** When this membership began, for a screen naming the person. */
  joinedAt: Date;
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

/** THE GYM'S PEOPLE, in the order the list was built — the ones on it AND the FORMER
 *  records (§11.1).
 *
 *  **THE FORMER RECORDS COME TOO, AND THE RULE TELLS THEM APART.** A file that holds
 *  somebody the gym took off revives that very row, so a read that left them out would
 *  make the confirm try to INSERT a person the identity key's UNIQUE already covers —
 *  and the gym would have two records of one person if it did not. Everything else the
 *  rule answers is about the current records alone, which is one `filter` inside it
 *  rather than a condition every reader has to remember.
 *
 *  **THE DATES ARE CAST TO TEXT ON THE WAY OUT.** `postgres.js` turns a `date` column
 *  into a JavaScript `Date` — midnight in whatever zone the process happens to run in —
 *  and the rule is pure and compares plain days. `::text` gives `YYYY-MM-DD`, the one
 *  shape `MEMBER_LIST_DAY` describes and the shape the file's own reading produces. */
export async function listEntries(sql: SqlOrTx, gymId: string): Promise<ListEntry[]> {
  const rows = await sql<
    {
      id: string;
      identity_key: string;
      full_name: string;
      email: string | null;
      phone_e164: string | null;
      member_number: string | null;
      status: string | null;
      membership_type: string | null;
      joined_on: string | null;
      ends_on: string | null;
      ends_on_kind: string | null;
      payment_status: string | null;
      date_of_birth: string | null;
      extra: unknown;
      hand_edited: string[];
      former: boolean;
    }[]
  >`
    SELECT id, identity_key, full_name, email::text AS email, phone_e164, member_number, status,
           membership_type,
           joined_on::text     AS joined_on,
           ends_on::text       AS ends_on,
           ends_on_kind,
           payment_status,
           date_of_birth::text AS date_of_birth,
           extra,
           hand_edited,
           (former_at IS NOT NULL) AS former
    FROM gym_member_list_entries
    WHERE gym_id = ${gymId}
    ORDER BY listed_seq`;
  return rows.map((row) => ({
    id: row.id,
    identityKey: row.identity_key,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone_e164,
    memberNumber: row.member_number,
    status: row.status,
    membershipType: row.membership_type,
    joinedOn: row.joined_on,
    endsOn: row.ends_on,
    endsOnKind: parseEndsOnKind(row.ends_on_kind, row.identity_key),
    paymentStatus: row.payment_status,
    dateOfBirth: row.date_of_birth,
    extra: parseExtra(row.extra, row.identity_key),
    handEdited: parseHandEdited(row.hand_edited, row.identity_key),
    former: row.former,
  }));
}

/** The gym's own columns as one record holds them, PARSED — see the schema's own note
 *  for why this is not ceremony: a document read wrong is an upload writing over a
 *  column it should have left alone. Loud, and with no cell in the message: the id is
 *  an identity key, which is a hash. */
function parseExtra(value: unknown, identityKey: string): Record<string, string> {
  const parsed = memberListExtraDocumentSchema.safeParse(value);
  if (!parsed.success) throw new Error(`member-list entry ${identityKey} holds extra fields that no longer parse`);
  return parsed.data;
}

/** The field NAMES one record remembers being edited by hand (§11.4), parsed the same
 *  way and for the same reason: a name nothing recognises would quietly stop guarding
 *  the field it is about. */
function parseHandEdited(value: readonly string[], identityKey: string): string[] {
  const parsed = z.array(memberListEditedFieldSchema).max(MEMBER_LIST_MAX_EDITED_FIELDS).safeParse(value);
  if (!parsed.success) throw new Error(`member-list entry ${identityKey} holds hand-edited field names that no longer parse`);
  return parsed.data;
}

/** "Ends" or "renews", as the gym's own heading said (§11.1). A CHECK on the table
 *  allows only those two, so anything else is a state the database forbids. */
function parseEndsOnKind(value: string | null, identityKey: string): "ends" | "renews" | null {
  if (value === null) return null;
  if (value === "ends" || value === "renews") return value;
  throw new Error(`member-list entry ${identityKey} holds an end-or-renewal kind that no longer parses`);
}

/** ONE OF THE GYM'S OWN COLUMNS, from its catalogue (§11.1). */
export interface FieldRow {
  key: string;
  label: string;
  ord: number;
}

/** THE GYM'S OWN COLUMNS, in the gym's own order. At most
 *  `MEMBER_LIST_MAX_EXTRA_FIELDS` rows, so this is read whole wherever it is wanted. */
export async function listFields(sql: SqlOrTx, gymId: string): Promise<FieldRow[]> {
  const rows = await sql<{ key: string; label: string; ord: number }[]>`
    SELECT key, label, ord
    FROM gym_member_list_fields
    WHERE gym_id = ${gymId}
    ORDER BY ord, key`;
  return rows.map((row) => ({ key: row.key, label: row.label, ord: row.ord }));
}

/** THE GYM'S CATALOGUE, GROWN BY WHAT THIS FILE BRINGS — the WRITE half, and the write
 *  half ALONE (round one, High-1).
 *
 *  **IT IS SPLIT FROM THE RULE THAT DECIDES WHAT TO ADD, AND THE SPLIT IS THE FIX.**
 *  This used to read, grow and INSERT in one call, made before the confirm's two tick
 *  gates — and a gate `return`s out of `sql.begin`, which COMMITS. So a confirm that
 *  answered "NOTHING was changed" had already written the file's new headings into the
 *  gym's catalogue, which is a bounded per-gym resource (40) that nothing ever prunes:
 *  any member of staff could fill a gym's forty slots with headings from files it never
 *  applied, by uploading wide files the wrong-file guard refuses — the guard's ORDINARY
 *  case, not an edge. The reviewer drove it on both gates.
 *
 *  Now `listFields` + the pure `growFields` answer the rule BEFORE the gates, and this
 *  runs after them, immediately before the entries are written and under the same gym
 *  row lock — so two staff confirming differently-shaped files still cannot both claim
 *  the last free field.
 *
 *  **IT GROWS AND IS NEVER REPLACED.** A whole-list upload is the gym's list of PEOPLE
 *  as of today, not a statement that the columns it leaves out have stopped existing:
 *  the cells under them are still on the gym's people and the person's page still shows
 *  them. So a heading already in the catalogue keeps its key and its place, and only
 *  headings the gym has never had are appended.
 *
 *  **THE CEILING IS APPLIED HERE BECAUSE THIS IS WHERE THE GYM'S ROWS CAN BE COUNTED.**
 *  The reader caps ONE file at `MEMBER_LIST_MAX_EXTRA_FIELDS` columns; without a cap on
 *  the catalogue a gym uploading differently-shaped exports would accumulate fields
 *  without limit, which is an unbounded document on every one of its people and an
 *  unbounded reply on every page. A CHECK cannot count a jsonb object's keys (it would
 *  need a set-returning function, and a CHECK may hold no subquery), so the bound is
 *  here and the documents are only ever written from what this returns.
 *
 *  **THE LABEL IS THE SPELLING THE GYM WROTE FIRST**, like a status word (§9.7): a gym
 *  whose two exports head one column "Locker" and "LOCKER" reads its own first word,
 *  and `ON CONFLICT DO NOTHING` is what says so rather than a later file winning.
 *
 *  It answers the WHOLE catalogue after the growth, so the caller has one list to write
 *  every document from and there is no second read to disagree with it. */
export async function addFields(tx: TransactionSql, gymId: string, fresh: readonly FieldRow[]): Promise<void> {
  if (fresh.length === 0) return;
  const payload = fresh.map((field) => ({ key: field.key, label: field.label, ord: field.ord }));
  await tx`
    INSERT INTO gym_member_list_fields (gym_id, key, label, ord)
    SELECT ${gymId}, r.key, r.label, r.ord
    FROM jsonb_to_recordset(${tx.json(payload)}) AS r(key text, label text, ord int)
    ON CONFLICT (gym_id, key) DO NOTHING`;
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
      seat_counted: boolean;
      joined_entry_id: string | null;
    }[]
  >`
    SELECT m.user_id,
           u.display_name,
           (m.complimentary = false
            AND NOT EXISTS (
              SELECT 1 FROM gym_staff s WHERE s.gym_id = m.gym_id AND s.user_id = m.user_id)) AS seat_counted,
           CASE
             WHEN EXISTS (
               SELECT 1 FROM one_time_tokens t
               WHERE t.user_id = m.user_id AND t.purpose = 'verify_email' AND t.used_at IS NOT NULL)
             THEN u.email::text
             ELSE NULL
           END AS email,
           m.stated_phone_e164,
           (m.last_listed_at IS NOT NULL) AS ever_listed,
           j.id AS joined_entry_id
    FROM gym_members m
    JOIN users u ON u.id = m.user_id
    -- The record the member joined with (membersAgainstList has the rule).
    LEFT JOIN gym_member_list_entries j ON j.gym_id = m.gym_id AND j.id = m.entry_id
    WHERE m.gym_id = ${gymId}
      AND m.removed_at IS NULL
    ORDER BY m.joined_at, m.user_id`;
  return rows.map((row) => ({
    userId: row.user_id,
    fullName: row.display_name,
    email: row.email,
    statedPhone: row.stated_phone_e164,
    everListed: row.ever_listed,
    seatCounted: row.seat_counted,
    joinedEntryId: row.joined_entry_id,
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
    await lockGym(tx, input.gymId);
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
  /** When THIS upload was applied, or null. Read back for a confirm that finds its
   *  upload already confirmed: the answer has to be this file's own instant, and
   *  `gym_member_lists.last_confirmed_at` would be a LATER upload's the moment the
   *  gym has confirmed anything since. */
  confirmedAt: Date | null;
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
interface UploadColumns {
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
  confirmed_at: Date | null;
}

export async function uploadFor(
  sql: SqlOrTx,
  gymId: string,
  uploadId: string,
  now: Date,
): Promise<UploadRow | null> {
  const rows = await sql<UploadColumns[]>`
    SELECT id, status, mode, file_kind, file_sha256, file_bytes, header_fingerprint,
           mapping, base_version, summary, (rows IS NOT NULL) AS has_rows, created_at,
           expires_at, confirmed_at
    FROM gym_member_list_uploads
    WHERE gym_id = ${gymId} AND id = ${uploadId}`;
  const row = rows[0];
  if (row === undefined) return null;
  return toUploadRow(row, uploadId, now);
}

/** THE SAME UPLOAD, WITH ITS ROW LOCKED — the confirm's second lock, taken after the
 *  gym's (§9.7's order: gym row, then child rows, which `stageUpload` states once and
 *  everything here follows).
 *
 *  **THE GYM'S LOCK ALREADY SERIALISES TWO CONFIRMS OF THIS GYM, so this one is not
 *  what makes the confirm safe** — it is what stops an upload's own row moving under a
 *  transaction that has decided to confirm it, including from the expiry sweep, which
 *  takes no gym lock at all and would otherwise be free to mark it `expired` between
 *  this read and the UPDATE that confirms it.
 *
 *  `FOR UPDATE` and not `FOR NO KEY UPDATE`: this row is nobody's foreign key target
 *  except `gym_member_lists.last_confirmed_upload_id`, which the same transaction
 *  writes. */
export async function lockUploadFor(
  tx: TransactionSql,
  gymId: string,
  uploadId: string,
  now: Date,
): Promise<UploadRow | null> {
  const rows = await tx<UploadColumns[]>`
    SELECT id, status, mode, file_kind, file_sha256, file_bytes, header_fingerprint,
           mapping, base_version, summary, (rows IS NOT NULL) AS has_rows, created_at,
           expires_at, confirmed_at
    FROM gym_member_list_uploads
    WHERE gym_id = ${gymId} AND id = ${uploadId}
    FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) return null;
  return toUploadRow(row, uploadId, now);
}

/** One upload row's columns as this module is willing to believe them. Written once
 *  and used by both readers above, so a locked read and an unlocked one can never
 *  disagree about whether an upload has expired or what it holds. */
function toUploadRow(row: UploadColumns, uploadId: string, now: Date): UploadRow {
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
    confirmedAt: row.confirmed_at,
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
  // The stored document is taken apart ONCE, in a materialised step: written as
  // `u.rows -> 'understanding' -> 'rows'` inside the per-person lookup, Postgres
  // unpacked the whole document again for every one of the hundred people — at 10,000
  // people with 30 of the gym's own columns that is 2 MB a hundred times, and a page
  // held the one database connection for seconds.
  const rows = inTheFile
    ? await sql<{ total: number; people: unknown }[]>`
        WITH doc AS MATERIALIZED (
          SELECT u.rows -> 'groups' -> ${key} AS grp, u.rows -> 'understanding' -> 'rows' AS file
          FROM gym_member_list_uploads u
          WHERE u.gym_id = ${gymId} AND u.id = ${uploadId} AND u.rows IS NOT NULL
        )
        SELECT jsonb_array_length(doc.grp) AS total,
               COALESCE((
                 SELECT jsonb_agg(
                          (doc.file -> ((g ->> 'at')::int))
                          || jsonb_build_object('wasStatus', g -> 'wasStatus', 'entryId', g -> 'entryId')
                          ORDER BY ord)
                 FROM jsonb_array_elements(doc.grp) WITH ORDINALITY AS t(g, ord)
                 WHERE ord > ${cursor}::int AND ord <= ${cursor + limit}::int
               ), '[]'::jsonb) AS people
        FROM doc`
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
 *  **THE EMAIL CHANNEL WINS, AND ONLY THEN THE FIRST ENTRY ON THE LIST.** §9.7 matches
 *  on the verified address first and falls to the phone only when there is none, which is
 *  what `reconcile`'s `entryFor` does in this process — so the channel comes before
 *  the list's own order. Ordering by age alone answered a different person's row:
 *  a member whose proved address matches a NEWER entry and whose stated phone matches an
 *  OLDER one was shown with the older entry's status word and member number ("was
 *  Frozen, OLD-1" where the list says "Active, NEW-2"). Both the single `OR` lateral and
 *  the first UNION ALL had it; the review of PR #87 found it in the re-check.
 *
 *  A FAMILY SHARING ONE ADDRESS has several entries against it, and the first of them is
 *  what `reconcile` takes, because the list itself offers nothing to choose between
 *  them. **`ORDER BY created_at` did NOT take the first** — one confirm gives every row
 *  the same instant, so the tie fell to a random uuid and this lateral could answer a
 *  different entry from the pure rule about the same member, and a different one again on
 *  the next read. `listed_seq` is what "first" means; see the column's own note.
 *
 *  **A FORMER RECORD MATCHES NOBODY, AND `former_at IS NULL` IN BOTH CHANNELS IS WHERE
 *  THAT IS ENFORCED** (§11.1, §11.2 of the re-plan's §10.2). Since 3a-v-b a person the
 *  gym has taken off is kept rather than deleted, so without this every member the gym
 *  has EVER listed would go on reading "on your list" for ever: the mark beside them,
 *  the words shown against them, and the tick that says they are already in the app
 *  would all come off a record the gym believes it has removed. It is the same two
 *  conditions `reconcile` applies in this process by measuring everything against the
 *  current records, which is why one function still answers for both.
 *
 *  **A MEMBER WHO JOINED BY INVITATION IS THE RECORD THEY JOINED WITH** (RULINGS
 *  2026-09-25, ROADMAP 3a-vi-b; `reconcile`'s `onListOf`). `j` is that record; while it
 *  exists neither contact channel runs, so a changed email keeps them on the list and a
 *  relative still listed on their address does not keep somebody whose own record has
 *  come off. */
export async function membersAgainstList(
  sql: SqlOrTx,
  gymId: string,
  /** Only the members this email or phone could reach, who joined with one of these
   *  records, or who are these users (one person's page, one address's holders, one
   *  roster page). Each is still matched against the whole list, so the answer is the
   *  same one the full read gives for them. */
  reaching?: { email: string | null; phone: string | null; entryIds?: readonly string[]; userIds?: readonly string[] },
): Promise<MemberAgainstList[]> {
  const narrowed = reaching !== undefined;
  const reachEmail = reaching?.email ?? null;
  const reachPhone = reaching?.phone ?? null;
  const reachEntries = [...(reaching?.entryIds ?? [])];
  const reachUsers = [...(reaching?.userIds ?? [])];
  const rows = await sql<
    {
      user_id: string;
      display_name: string;
      email: string | null;
      stated_phone_e164: string | null;
      ever_listed: boolean;
      seat_counted: boolean;
      entry_id: string | null;
      entry_status: string | null;
      entry_member_number: string | null;
      on_list: boolean;
      former_entry_id: string | null;
      joined_entry_id: string | null;
      joined_at: Date;
    }[]
  >`
    SELECT m.user_id,
           m.joined_at,
           u.display_name,
           (m.complimentary = false
            AND NOT EXISTS (
              SELECT 1 FROM gym_staff s WHERE s.gym_id = m.gym_id AND s.user_id = m.user_id)) AS seat_counted,
           CASE WHEN v.proved THEN u.email::text ELSE NULL END AS email,
           m.stated_phone_e164,
           (m.last_listed_at IS NOT NULL) AS ever_listed,
           e.id            AS entry_id,
           e.status        AS entry_status,
           e.member_number AS entry_member_number,
           (e.id IS NOT NULL) AS on_list,
           f.id            AS former_entry_id,
           j.id            AS joined_entry_id
    FROM gym_members m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN gym_member_list_entries j ON j.gym_id = m.gym_id AND j.id = m.entry_id
    CROSS JOIN LATERAL (
      SELECT EXISTS (
               SELECT 1 FROM one_time_tokens t
               WHERE t.user_id = m.user_id AND t.purpose = 'verify_email' AND t.used_at IS NOT NULL) AS proved
    ) v
    LEFT JOIN LATERAL (
      SELECT c.id, c.status, c.member_number
      FROM (
        (SELECT j.id, j.status, j.member_number, j.listed_seq, 0 AS channel
         WHERE j.id IS NOT NULL AND j.former_at IS NULL)
        UNION ALL
        (SELECT x.id, x.status, x.member_number, x.listed_seq, 1 AS channel
         FROM gym_member_list_entries x
         WHERE x.gym_id = m.gym_id AND x.former_at IS NULL AND j.id IS NULL AND v.proved AND x.email = u.email
         ORDER BY x.listed_seq
         LIMIT 1)
        UNION ALL
        (SELECT x.id, x.status, x.member_number, x.listed_seq, 2 AS channel
         FROM gym_member_list_entries x
         WHERE x.gym_id = m.gym_id AND x.former_at IS NULL AND j.id IS NULL
           AND m.stated_phone_e164 IS NOT NULL AND x.phone_e164 = m.stated_phone_e164
         ORDER BY x.listed_seq
         LIMIT 1)
      ) c
      ORDER BY c.channel, c.listed_seq
      LIMIT 1
    ) e ON true
    -- THE SAME MATCH OVER THE FORMER RECORDS, ANSWERING ONE QUESTION ONLY: which former
    -- record belongs to somebody who IS in the app, so the page that shows them can say
    -- so (round one, Low-2). It is deliberately no part of on_list, entry_status or
    -- anything the marks, the counts and the chips read -- a former record admits nobody
    -- and is invited by nothing, which is what the lateral above is for.
    LEFT JOIN LATERAL (
      SELECT c.id
      FROM (
        (SELECT j.id, j.listed_seq, 0 AS channel
         WHERE j.id IS NOT NULL AND j.former_at IS NOT NULL)
        UNION ALL
        (SELECT x.id, x.listed_seq, 1 AS channel
         FROM gym_member_list_entries x
         WHERE x.gym_id = m.gym_id AND x.former_at IS NOT NULL AND j.id IS NULL AND v.proved AND x.email = u.email
         ORDER BY x.listed_seq
         LIMIT 1)
        UNION ALL
        (SELECT x.id, x.listed_seq, 2 AS channel
         FROM gym_member_list_entries x
         WHERE x.gym_id = m.gym_id AND x.former_at IS NOT NULL AND j.id IS NULL
           AND m.stated_phone_e164 IS NOT NULL AND x.phone_e164 = m.stated_phone_e164
         ORDER BY x.listed_seq
         LIMIT 1)
      ) c
      ORDER BY c.channel, c.listed_seq
      LIMIT 1
    ) f ON true
    WHERE m.gym_id = ${gymId}
      AND m.removed_at IS NULL
      -- On the plain columns, so the members are narrowed before the laterals run; an
      -- unproved address still matches no entry (the lateral asks v.proved).
      AND (NOT ${narrowed}::boolean
           OR u.email = ${reachEmail}::citext
           OR (m.stated_phone_e164 IS NOT NULL AND m.stated_phone_e164 = ${reachPhone}::text)
           OR m.entry_id = ANY(${reachEntries}::uuid[])
           OR m.user_id = ANY(${reachUsers}::uuid[]))
    ORDER BY m.joined_at, m.user_id`;
  return rows.map((row) => ({
    userId: row.user_id,
    fullName: row.display_name,
    email: row.email,
    statedPhone: row.stated_phone_e164,
    everListed: row.ever_listed,
    seatCounted: row.seat_counted,
    onList: row.on_list,
    entryId: row.entry_id,
    entryStatus: row.entry_status,
    entryMemberNumber: row.entry_member_number,
    formerEntryId: row.former_entry_id ?? null,
    joinedEntryId: row.joined_entry_id,
    joinedAt: row.joined_at,
  }));
}

/** WHY SOME OF THE GYM'S MEMBERS ARE NOT ON ITS LIST, for the roster (3a-vi-b): when
 *  each FORMER record came off, and the name on the first current record holding each
 *  address. Both are the gym's own data about its list, asked by id and address in
 *  this gym only. */
export async function offListFacts(
  sql: SqlOrTx,
  gymId: string,
  formerEntryIds: readonly string[],
  emails: readonly string[],
): Promise<{ takenOffAt: Map<string, Date>; nameByEmail: Map<string, string> }> {
  const takenOffAt = new Map<string, Date>();
  const nameByEmail = new Map<string, string>();
  if (formerEntryIds.length > 0) {
    const rows = await sql<{ id: string; former_at: Date }[]>`
      SELECT id, former_at FROM gym_member_list_entries
      WHERE gym_id = ${gymId} AND id = ANY(${[...formerEntryIds]}::uuid[]) AND former_at IS NOT NULL`;
    for (const row of rows) takenOffAt.set(row.id, row.former_at);
  }
  if (emails.length > 0) {
    const rows = await sql<{ email: string; full_name: string }[]>`
      SELECT DISTINCT ON (lower(email::text)) lower(email::text) AS email, full_name
      FROM gym_member_list_entries
      WHERE gym_id = ${gymId} AND former_at IS NULL AND email = ANY(${[...emails]}::citext[])
      ORDER BY lower(email::text), listed_seq`;
    for (const row of rows) nameByEmail.set(row.email, row.full_name);
  }
  return { takenOffAt, nameByEmail };
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
  // The gym's own column headings (3a-v-b). Nothing points at them once the entries
  // are gone, and a catalogue outliving the gym it belongs to would be the one row of
  // this feature the archive sweep left behind.
  await tx`DELETE FROM gym_member_list_fields WHERE gym_id = ${gymId}`;
  await tx`DELETE FROM gym_member_lists WHERE gym_id = ${gymId}`;
}

// ── PRESSING CONFIRM (3a-iii-b; §9.7) ───────────────────────────────────────
//
// **EVERY STATEMENT BELOW RUNS INSIDE ONE TRANSACTION THAT HOLDS THE GYM'S ROW**,
// which the service takes before it reads anything it will decide on. Each is
// written to be safe run twice, because a transaction that is retried after a
// serialisation failure runs them all again: the insert conflicts away, the update
// writes the word that is already there, the delete deletes nothing the second time.

/** A uuid that is never any row's id, for the unused half of the cursor comparison
 *  on the first page. The boolean beside it is what decides which half counts;
 *  Postgres still has to be handed a value of the right type for the branch it will
 *  not take. */
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

/** THE GYM'S ROW, LOCKED — the module's one lock order, gym row then child rows.
 *
 *  Written once and called by everything here for a reason the module has already
 *  been bitten by elsewhere: an ordering decided per-function is an ordering that
 *  eventually reverses somewhere and deadlocks. The JOIN door takes the APPLICATION
 *  row first and then this one (`claimSeat`'s caller), which is a different pair, so
 *  the two paths meet only here — and both take THIS row, which is exactly why a
 *  join and a confirm cannot interleave (§9.7). */
export async function lockGym(tx: TransactionSql, gymId: string): Promise<void> {
  await tx`SELECT 1 FROM gyms WHERE id = ${gymId} FOR UPDATE`;
}

/** One person as the list stores them. Not `ListEntry`: that one carries the
 *  identity key of somebody already on the list, and this is what goes ON it. */
export interface EntryToWrite {
  fullName: string;
  email: string | null;
  phone: string | null;
  memberNumber: string | null;
  status: string | null;
  membershipType: string | null;
  joinedOn: string | null;
  endsOn: string | null;
  endsOnKind: "ends" | "renews" | null;
  paymentStatus: string | null;
  dateOfBirth: string | null;
  /** The gym's own columns for this person, by catalogue key (§11.1). */
  extra: Record<string, string>;
  identityKey: string;
}

/** ONE PERSON WHOSE RECORD MOVES — the same payload for a change and for a FORMER
 *  record coming back, because the two write the same fields and differ in one SET.
 *
 *  `clear` is the hand-edit marks this write has done the work of: the field NAMES this
 *  file really overwrote for this one person (§11.4). Everything else stays marked. */
export interface EntryChange extends EntryToWrite {
  /** The key the record has now; `identityKey` is the one it is given. */
  entryKey: string;
  clear: readonly string[];
}

/** THE PEOPLE A CONFIRM ADDS — ONE STATEMENT, WHATEVER THE FILE HOLDS.
 *
 *  **`jsonb_to_recordset` IS NOT A STYLE CHOICE AND THE MEASUREMENT IS WHY** (§9.9,
 *  measured 2026-09-20): `postgres.js` refuses more than 65,534 parameters in one
 *  statement, so a row of placeholders per person fails at about eight thousand
 *  people — inside the ten thousand this module accepts. One document is one
 *  parameter, so this statement is the same size for a gym of ten and a gym of ten
 *  thousand, and there is no size at which the confirm stops working.
 *
 *  **`ON CONFLICT DO NOTHING` ON THE IDENTITY KEY is what makes a repeated confirm
 *  write nothing** rather than raise, which matters because a raised 23505 aborts
 *  the whole surrounding transaction — the same declarative idempotence the join
 *  door uses, for the same reason.
 *
 *  It returns what it actually inserted, and the caller checks that against what the
 *  rule said it would: under the gym's lock the two cannot differ, so a difference
 *  is a fault of ours and the confirm refuses rather than reporting a number that is
 *  not what happened. */
export async function insertEntries(
  tx: TransactionSql,
  gymId: string,
  people: readonly EntryToWrite[],
  source: MemberListEntrySource,
): Promise<number> {
  if (people.length === 0) return 0;
  const payload = people.map((person, index) => ({
    full_name: person.fullName,
    email: person.email,
    phone_e164: person.phone,
    member_number: person.memberNumber,
    status: person.status,
    membership_type: person.membershipType,
    joined_on: person.joinedOn,
    ends_on: person.endsOn,
    // A KIND ONLY WHERE THERE IS A DAY FOR IT TO BE ABOUT, which is the table's own
    // CHECK: "Renews" beside no date is half a sentence, and a file whose heading said
    // "renews" still has rows with the cell empty.
    ends_on_kind: person.endsOn === null ? null : person.endsOnKind,
    payment_status: person.paymentStatus,
    date_of_birth: person.dateOfBirth,
    extra: person.extra,
    identity_key: person.identityKey,
    // THE FILE'S OWN ROW ORDER, which `listed_seq` is then stamped in: see the
    // column's own note for the three answers that hang on it.
    ord: index,
  }));
  const rows = await tx<{ id: string }[]>`
    INSERT INTO gym_member_list_entries
      (gym_id, full_name, email, phone_e164, member_number, status, membership_type,
       joined_on, ends_on, ends_on_kind, payment_status, date_of_birth, extra,
       identity_key, source)
    SELECT ${gymId}, r.full_name, r.email, r.phone_e164, r.member_number, r.status,
           r.membership_type, r.joined_on, r.ends_on, r.ends_on_kind, r.payment_status,
           r.date_of_birth, r.extra, r.identity_key, ${source}
    FROM jsonb_to_recordset(${tx.json(payload)})
      AS r(full_name text, email text, phone_e164 text, member_number text,
           status text, membership_type text, joined_on date, ends_on date,
           ends_on_kind text, payment_status text, date_of_birth date, extra jsonb,
           identity_key text, ord int)
    ORDER BY r.ord
    ON CONFLICT (gym_id, identity_key) DO NOTHING
    RETURNING id`;
  return rows.length;
}

/** THE PEOPLE WHOSE RECORDS MOVE — one statement, in place, and the same statement for
 *  a change and for a FORMER record coming back (§11.1, §11.4).
 *
 *  **The record is found by the key it has now and given the key the rule worked out**
 *  (3a-vi): a row is matched to its record by member number, email or phone, so the
 *  name, address, phone and member number can change like any other carried field. The
 *  rule never gives two records one key (`samePerson.ts`), so the UNIQUE holds mid-statement.
 *
 *  **A FIELD THE FILE DOES NOT CARRY IS LEFT ALONE, AND THE `carries` FLAGS ARE HOW.**
 *  Each is a boolean PARAMETER inside a CASE, not a SET list built as text: a gym
 *  uploading a narrower export — name and address only — must not have its membership
 *  words, its dates and its own columns emptied off every one of its people, and the
 *  columns a file legitimately leaves out are exactly the ones §11.2 refuses to keep.
 *
 *  **THE GYM'S OWN COLUMNS ARE MERGED WITH `||` AND NEVER REPLACED.** `e.extra ||
 *  r.extra` writes every key this file carries, blank cell and all, and leaves every
 *  key it does not mention where it was — which is the same rule as the standard
 *  fields, expressed in the one operator jsonb has for it.
 *
 *  **`former_at` IS CLEARED BY A PARAMETER TOO**, so reviving a record and changing one
 *  are one statement. A change sets it to NULL where it is already NULL, which costs
 *  nothing and cannot be the wrong answer; a revive is the only caller that means it.
 *
 *  **AND THE HAND-EDIT MARKS THIS WRITE HAS ANSWERED ARE REMOVED, PER PERSON.** Only
 *  the names this file really overwrote for that one record: a mark on a field the file
 *  left alone, or agrees with, is owed the same question next month (§11.4). */
export async function updateEntries(
  tx: TransactionSql,
  gymId: string,
  changes: readonly EntryChange[],
  carries: CarriedFields,
  revive: boolean,
): Promise<number> {
  if (changes.length === 0) return 0;
  const payload = changes.map((change) => ({
    entry_key: change.entryKey,
    identity_key: change.identityKey,
    full_name: change.fullName,
    email: change.email,
    phone_e164: change.phone,
    member_number: change.memberNumber,
    status: change.status,
    membership_type: change.membershipType,
    joined_on: change.joinedOn,
    ends_on: change.endsOn,
    ends_on_kind: change.endsOn === null ? null : change.endsOnKind,
    payment_status: change.paymentStatus,
    date_of_birth: change.dateOfBirth,
    extra: change.extra,
    clear: [...change.clear],
  }));
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_member_list_entries e
    SET full_name      = CASE WHEN ${carries.fullName} THEN r.full_name ELSE e.full_name END,
        email          = CASE WHEN ${carries.email} THEN r.email::citext ELSE e.email END,
        phone_e164     = CASE WHEN ${carries.phone} THEN r.phone_e164 ELSE e.phone_e164 END,
        member_number  = CASE WHEN ${carries.memberNumber} THEN r.member_number ELSE e.member_number END,
        identity_key   = r.identity_key,
        status         = CASE WHEN ${carries.status} THEN r.status ELSE e.status END,
        membership_type = CASE WHEN ${carries.membershipType} THEN r.membership_type ELSE e.membership_type END,
        joined_on      = CASE WHEN ${carries.joinedOn} THEN r.joined_on ELSE e.joined_on END,
        ends_on        = CASE WHEN ${carries.endsOn} THEN r.ends_on ELSE e.ends_on END,
        ends_on_kind   = CASE WHEN ${carries.endsOn} THEN r.ends_on_kind ELSE e.ends_on_kind END,
        payment_status = CASE WHEN ${carries.paymentStatus} THEN r.payment_status ELSE e.payment_status END,
        date_of_birth  = CASE WHEN ${carries.dateOfBirth} THEN r.date_of_birth ELSE e.date_of_birth END,
        extra          = e.extra || r.extra,
        former_at      = CASE WHEN ${revive} THEN NULL ELSE e.former_at END,
        hand_edited    = (
          SELECT coalesce(array_agg(name), '{}'::text[])
          FROM unnest(e.hand_edited) AS name
          WHERE name <> ALL(r.clear)
        )
    FROM jsonb_to_recordset(${tx.json(payload)})
      AS r(entry_key text, identity_key text, full_name text, email text, phone_e164 text,
           member_number text, status text, membership_type text, joined_on date,
           ends_on date, ends_on_kind text, payment_status text, date_of_birth date,
           extra jsonb, clear text[])
    WHERE e.gym_id = ${gymId} AND e.identity_key = r.entry_key
    RETURNING e.id`;
  return rows.length;
}

/** THE PEOPLE COMING OFF — marked FORMER with the instant they came off, never deleted
 *  (§11.1). One statement, keys only.
 *
 *  **NOBODY IS DELETED FROM A GYM'S LIST ANY MORE**, which reverses §9.2 rule 2: the
 *  visits, the reports and a returning member's history all hang off this row, so a
 *  management app keeps it. The gym can still delete a former record for good.
 *
 *  **`former_at IS NULL` IS IN THE `WHERE` AND IT IS LOAD-BEARING.** The rule never
 *  hands an already-former person here — they are not on the list to come off it — and
 *  if anything ever did, this would write a fresh date over the day they really left.
 *  It also makes the statement safe to run twice, which is what the module asks of
 *  every write inside the confirm.
 *
 *  An array of keys rather than a document because there is nothing to carry but the
 *  key, and `= ANY($1)` is one parameter like the document is: the eight-thousand
 *  ceiling above is about placeholders, not about how many values one array holds. */
export async function markEntriesFormer(
  tx: TransactionSql,
  gymId: string,
  identityKeys: readonly string[],
  at: Date,
): Promise<number> {
  if (identityKeys.length === 0) return 0;
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_member_list_entries
    SET former_at = ${at}
    WHERE gym_id = ${gymId} AND identity_key = ANY(${identityKeys}::text[]) AND former_at IS NULL
    RETURNING id`;
  return rows.length;
}

/** "THIS GYM HAS YOU ON ITS LIST, AS OF NOW" — stamped on every member the list being
 *  replaced holds OR the new one does (§9.7, `reconcile`'s `onEitherList`).
 *
 *  **THE OLD LIST'S PEOPLE ARE STAMPED TOO, AND THAT IS THE POINT OF THE UNION.**
 *  What the preview called "no longer listed" has to read the same after the confirm;
 *  `last_listed_at` is the only thing that tells a member who dropped OFF a list from
 *  one who was never on it, so a member coming off today gets their stamp on the way
 *  out and reads as "no longer listed" rather than "never listed" — the gym being
 *  told it never had somebody it has just removed.
 *
 *  `removed_at IS NULL` because a membership that has ended is not on anybody's list
 *  and its columns are its record of what was true when it ended. */
export async function stampListed(
  tx: TransactionSql,
  gymId: string,
  userIds: readonly string[],
  at: Date,
): Promise<number> {
  if (userIds.length === 0) return 0;
  const rows = await tx<{ user_id: string }[]>`
    UPDATE gym_members
    SET last_listed_at = ${at}
    WHERE gym_id = ${gymId} AND user_id = ANY(${userIds}::uuid[]) AND removed_at IS NULL
    RETURNING user_id`;
  return rows.length;
}

/** THE LIST ITSELF, MOVED ON — created on a gym's first confirm and updated after,
 *  in ONE statement so there is no "does the row exist yet" to get wrong.
 *
 *  **THE VERSION IS BUMPED ONLY WHEN SOMETHING CHANGED** (§9.7). It is what a preview
 *  is measured against, so bumping it for a confirm that wrote nothing would throw
 *  away every other preview open in the gym for no reason — and the same file
 *  uploaded twice is exactly the case where nothing changed.
 *
 *  **`last_confirmed_at` AND THE UPLOAD MOVE EVEN THEN**, because the gym DID confirm
 *  this file and the record of which file the list came from is what a mapping is
 *  remembered from next month (§9.5). */
export async function moveListOn(
  tx: TransactionSql,
  input: { gymId: string; uploadId: string; at: Date; bump: boolean },
): Promise<number> {
  const step = input.bump ? 1 : 0;
  const rows = await tx<{ version: number }[]>`
    INSERT INTO gym_member_lists (gym_id, version, last_confirmed_upload_id, last_confirmed_at)
    VALUES (${input.gymId}, ${step}, ${input.uploadId}, ${input.at})
    ON CONFLICT (gym_id) DO UPDATE
      SET version = gym_member_lists.version + ${step},
          last_confirmed_upload_id = EXCLUDED.last_confirmed_upload_id,
          last_confirmed_at = EXCLUDED.last_confirmed_at
    RETURNING version`;
  const version = rows[0]?.version;
  if (version === undefined) throw new Error("moving a member list on returned no row");
  return version;
}

/** THE UPLOAD, FINISHED WITH — and its cells gone in the same statement that says so.
 *
 *  `rows = NULL` beside the status is §9.6's CHECK made to hold rather than promised:
 *  a confirmed upload still holding a member's name, address and phone number is a
 *  state nothing else in the system would ever notice.
 *
 *  **`summary` IS OVERWRITTEN WITH WHAT WAS APPLIED, not what the preview guessed.**
 *  The rule was worked out again under the lock on the list as it is now, and that
 *  answer is the one this upload's record keeps — so pressing Confirm a second time
 *  reads back what the first press did and not a stale story about the same file.
 *
 *  `AND status = 'staged'` is the last word on a race this transaction already holds
 *  the gym's lock against: it costs nothing and it means no path can ever confirm an
 *  upload twice, including one that arrives some day without the lock. */
export async function markUploadConfirmed(
  tx: TransactionSql,
  input: { gymId: string; uploadId: string; at: Date; summary: MemberListUploadSummary },
): Promise<void> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_member_list_uploads
    SET status = 'confirmed', confirmed_at = ${input.at}, rows = NULL,
        summary = ${tx.json(input.summary)}
    WHERE gym_id = ${input.gymId} AND id = ${input.uploadId} AND status = 'staged'
    RETURNING id`;
  if (rows.length !== 1) {
    throw new Error(`confirming member-list upload ${input.uploadId} moved ${String(rows.length)} rows`);
  }
}

// ── READING THE LIST THE GYM KEEPS (3a-iii-b; §9.9) ─────────────────────────

/** One of the gym's own status words on its kept list, with the three numbers a
 *  filter chip shows. */
/** The chips AND the whole-list numbers, from ONE statement. The chips are capped
 *  (`MEMBER_LIST_STATUS_CHIPS_MAX`); the totals never are. */
export interface StatusCounts {
  totals: { entries: number; inApp: number; canBeInvited: number; noEmail: number; former: number };
  /** The gym's own words, each kind capped at `MEMBER_LIST_STATUS_CHIPS_MAX` (§11.1). */
  statuses: StatusCountRow[];
  membershipTypes: StatusCountRow[];
  paymentStatuses: StatusCountRow[];
}

/** WHICH OF THE THREE KINDS OF THE GYM'S OWN WORD A CHIP IS COUNTING (§11.1). One
 *  statement answers all three and labels each group with its kind, so the three sets of
 *  chips and the header's numbers come out of one pass over the gym's list. */
type WordKind = "status" | "membership_type" | "payment_status";

export interface StatusCountRow {
  label: string;
  count: number;
  inApp: number;
  canBeInvited: number;
  noEmail: number;
}

/** WHAT THE LIST HOLDS, BY THE GYM'S OWN WORD — one pass over this gym's entries.
 *
 *  **"ALREADY IN THE APP" IS AN ARRAY OF ENTRY IDS HANDED IN, AND THAT IS THE SHAPE
 *  THAT KEEPS THIS CHEAP AND KEEPS IT HONEST.** The question is "does one of this
 *  gym's members reach this entry", and the answer already exists in exactly one
 *  place: `membersAgainstList`, which the preview reads too, matching on the proved
 *  address first and the stated phone second. Asked again here — an EXISTS per entry
 *  against the members — it would be ten thousand lookups to answer two hundred
 *  questions, the shape review of PR #87 found costing 207 ms on the one connection
 *  the whole API shares, AND it would be a second opinion that could disagree with
 *  the preview about one person. The members are bounded by what a gym can hold, so
 *  the array is small where the entries are many.
 *
 *  **THE WORDS ARE FOLDED THE WAY THE RULE FOLDS THEM.** `lower(coalesce(status,''))`
 *  is `reconcile`'s `foldStatus` in SQL — a stored word is already trimmed with its
 *  spaces collapsed (`cleanStatus`), so lower-casing is the whole of the difference,
 *  and a status of NULL and one of '' are one group here as they are one word there.
 *  The `(gym_id, lower(status))` index does not serve the coalesce and is not asked
 *  to: this reads every entry of the gym once whatever it does, because the email and
 *  the id are not in that index either.
 *
 *  **THE LABEL IS THE SPELLING THE LIST WROTE FIRST**, which is §9.5's rule for the
 *  preview applied to the kept list, so a gym reading its own chips sees its own word
 *  and not whichever row the database happened to reach first — which is exactly what it
 *  did read while this ordered by `created_at`, because one confirm gives every row the
 *  same instant and the tie fell to a random uuid. Measured: 16 of 40 confirms whose file
 *  wrote "Active" first read the chip back as "ACTIVE". See `listed_seq`'s own note. */
export async function listStatusCounts(
  sql: SqlOrTx,
  gymId: string,
  inAppEntryIds: readonly string[],
): Promise<StatusCounts> {
  const rows = await sql<
    {
      t_entries: number;
      t_in_app: number;
      t_can_be_invited: number;
      t_no_email: number;
      t_former: number;
      kind: string | null;
      label: string | null;
      count: number | null;
      in_app: number | null;
      can_be_invited: number | null;
      no_email: number | null;
    }[]
  >`
    -- MATERIALIZED, AND THAT ONE WORD IS WHY THREE KINDS OF CHIP COST ONE PASS. Three
    -- GROUP BYs over the same rows would otherwise be three scans of a gym's whole
    -- list; this reads it once and aggregates the result three ways.
    WITH mine AS MATERIALIZED (
      SELECT e.status, e.membership_type, e.payment_status, e.listed_seq,
             (e.id = ANY(${inAppEntryIds}::uuid[])) AS in_app,
             (e.id <> ALL(${inAppEntryIds}::uuid[]) AND e.email IS NOT NULL) AS can_be_invited,
             (e.email IS NULL) AS no_email
      FROM gym_member_list_entries e
      -- THE LIST AS IT STANDS. A former record is somebody the gym has taken off, so
      -- it is in no chip and no count here: a chip is what staff click to act on
      -- people, and one whose number held an ex-member would offer them an invite
      -- (§11.1).
      WHERE e.gym_id = ${gymId} AND e.former_at IS NULL
    ),
    -- THE WHOLE LIST, COUNTED FROM THE ROWS AND NEVER FROM THE CHIPS. The chips have a
    -- ceiling and these numbers must not: summing the CAPPED rows made a gym past the
    -- ceiling read "200 people" over a list of 205, and left canBeInvited short by the
    -- truncated groups (review of PR #88, High-3). One statement still answers both,
    -- which is the point: two would be two answers to one question.
    totals AS (
      SELECT count(*)::int AS t_entries,
             count(*) FILTER (WHERE mine.in_app)::int AS t_in_app,
             count(*) FILTER (WHERE mine.can_be_invited)::int AS t_can_be_invited,
             count(*) FILTER (WHERE mine.no_email)::int AS t_no_email
      FROM mine
    ),
    -- The people the gym has taken off. Its own line, because it is not part of any
    -- number above it (§11.1) and staff need to know the records are there.
    former AS (
      SELECT count(*)::int AS t_former
      FROM gym_member_list_entries e
      WHERE e.gym_id = ${gymId} AND e.former_at IS NOT NULL
    ),
    -- THREE KINDS OF THE GYM'S OWN WORD, ONE SHAPE, ONE FOLD. lower(coalesce(x,'')) is
    -- the rule's own foldWord in SQL for each of them — a stored word is already trimmed
    -- with its spaces collapsed (cleanStatus), so lower-casing is the whole of the
    -- difference, and a NULL and an empty one are one group here as they are one word
    -- there. The label is the spelling the list wrote FIRST (§9.5's rule for the preview,
    -- applied to the kept list), which listed_seq is what makes answerable.
    grouped AS (
      SELECT 'status' AS kind,
             (array_agg(mine.status ORDER BY mine.listed_seq))[1] AS label,
             count(*)::int AS count,
             count(*) FILTER (WHERE mine.in_app)::int AS in_app,
             count(*) FILTER (WHERE mine.can_be_invited)::int AS can_be_invited,
             count(*) FILTER (WHERE mine.no_email)::int AS no_email,
             min(mine.listed_seq) AS first_seq
      FROM mine
      GROUP BY lower(coalesce(mine.status, ''))
      UNION ALL
      SELECT 'membership_type' AS kind,
             (array_agg(mine.membership_type ORDER BY mine.listed_seq))[1] AS label,
             count(*)::int AS count,
             count(*) FILTER (WHERE mine.in_app)::int AS in_app,
             count(*) FILTER (WHERE mine.can_be_invited)::int AS can_be_invited,
             count(*) FILTER (WHERE mine.no_email)::int AS no_email,
             min(mine.listed_seq) AS first_seq
      FROM mine
      GROUP BY lower(coalesce(mine.membership_type, ''))
      UNION ALL
      SELECT 'payment_status' AS kind,
             (array_agg(mine.payment_status ORDER BY mine.listed_seq))[1] AS label,
             count(*)::int AS count,
             count(*) FILTER (WHERE mine.in_app)::int AS in_app,
             count(*) FILTER (WHERE mine.can_be_invited)::int AS can_be_invited,
             count(*) FILTER (WHERE mine.no_email)::int AS no_email,
             min(mine.listed_seq) AS first_seq
      FROM mine
      GROUP BY lower(coalesce(mine.payment_status, ''))
    ),
    -- EACH KIND CAPPED ON ITS OWN, so a gym with two hundred status words does not
    -- lose its membership chips to them. The cut is by the list's own order, so what a
    -- gym past a ceiling loses is its rarest words and never a count of PEOPLE — the
    -- totals above are taken from the rows, before any of this.
    capped AS (
      SELECT r.kind, r.label, r.count, r.in_app, r.can_be_invited, r.no_email, r.first_seq
      FROM (
        SELECT g.*, row_number() OVER (PARTITION BY g.kind ORDER BY g.first_seq) AS rn
        FROM grouped g
      ) r
      WHERE r.rn <= ${MEMBER_LIST_STATUS_CHIPS_MAX}
    )
    SELECT t.t_entries, t.t_in_app, t.t_can_be_invited, t.t_no_email, f.t_former,
           c.kind, c.label, c.count, c.in_app, c.can_be_invited, c.no_email
    FROM totals t
    CROSS JOIN former f
    -- A GYM WITH NO ENTRIES STILL ANSWERS ONE ROW, which is what lets an empty list
    -- carry its zeroes: totals and former are one row each whatever the list holds.
    LEFT JOIN capped c ON true
    ORDER BY c.kind, c.first_seq`;
  const first = rows[0];
  const totals = {
    entries: first?.t_entries ?? 0,
    inApp: first?.t_in_app ?? 0,
    canBeInvited: first?.t_can_be_invited ?? 0,
    noEmail: first?.t_no_email ?? 0,
    former: first?.t_former ?? 0,
  };
  // `count` is null on the one all-null row an empty list answers with, and never null
  // for a real group — which is the test for it: `label` is not, since the people with
  // NO word of that kind are a real group whose label is null.
  const of = (kind: WordKind): StatusCountRow[] =>
    rows
      .filter((row) => row.count !== null && row.kind === kind)
      .map((row) => ({
        // "" is the people with no word of this kind at all — the same empty label the
        // entries filter reads as "none" (§9.9, §11.5), and the same one the preview's
        // own breakdown uses.
        label: row.label ?? "",
        count: row.count ?? 0,
        inApp: row.in_app ?? 0,
        canBeInvited: row.can_be_invited ?? 0,
        noEmail: row.no_email ?? 0,
      }));
  return { totals, statuses: of("status"), membershipTypes: of("membership_type"), paymentStatuses: of("payment_status") };
}

/** One person on the kept list, as a page of it shows them. */
export interface EntryRow {
  entryId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  memberNumber: string | null;
  status: string | null;
  membershipType: string | null;
  joinedOn: string | null;
  endsOn: string | null;
  endsOnKind: "ends" | "renews" | null;
  paymentStatus: string | null;
  dateOfBirth: string | null;
  formerAt: Date | null;
  source: MemberListEntrySource;
  inApp: boolean;
}

export interface EntriesPageInput {
  gymId: string;
  inAppEntryIds: readonly string[];
  /** Null is "everybody"; an empty list would be "nobody" and is not a filter
   *  anybody can ask for, which is why the two are told apart rather than both
   *  arriving as `[]`. Each word is already folded by the caller.
   *
   *  The three read the three kinds of the gym's own word (§11.5) and are ANDed: a
   *  gym asking for its Gold members who are overdue means both. */
  statuses: readonly string[] | null;
  membershipTypes: readonly string[] | null;
  paymentStatuses: readonly string[] | null;
  /** Which records to cut the page from (§11.5). `current` is the default everywhere. */
  records: MemberListRecords;
  filter: "all" | "in_app" | "not_in_app";
  /** The invitation filter (§11.5): only these entries, or all but these; null for
   *  no filter. The ids are worked out by the caller from the address HMACs. */
  invitation: { ids: readonly string[]; include: boolean } | null;
  /** Already escaped for LIKE by the caller, or null. */
  like: string | null;
  cursor: { name: string; id: string } | null;
  limit: number;
}

/** ONE PAGE OF THE LIST, AND HOW MANY THE FILTERS MATCH IN ALL — one statement.
 *
 *  **THE TOTAL IS COUNTED OVER THE SAME FILTERED SET THE PAGE IS CUT FROM**, in the
 *  same statement, so a screen saying "312 Active" and the names under it can never
 *  be answers to two different questions asked a moment apart.
 *
 *  **THE ONE-ROW `totals` ON THE OUTSIDE IS WHAT MAKES AN EMPTY PAGE STILL CARRY ITS
 *  TOTAL.** `SELECT (SELECT count(*) …) FROM filtered` answers nothing at all when
 *  the page is empty — no rows in, no rows out — and a search that matches nobody
 *  would have come back with no total rather than zero. A LEFT JOIN LATERAL onto a
 *  count that always has exactly one row cannot do that.
 *
 *  **THE CURSOR IS THE LAST PERSON, NOT A PLACE.** Paging by offset through a list a
 *  colleague is editing skips people and shows others twice; `(full_name, id) >
 *  (last name, last id)` cannot, and the id is in it so two people with the same name
 *  are still two pages apart rather than one blocking the other. The comparison and
 *  the ORDER BY read the same column with the same collation, which is what keeps
 *  them agreeing about what "after" means. */
export async function entriesPage(
  sql: SqlOrTx,
  input: EntriesPageInput,
): Promise<{ total: number; entries: EntryRow[] }> {
  const statuses = input.statuses === null ? null : [...input.statuses];
  const membershipTypes = input.membershipTypes === null ? null : [...input.membershipTypes];
  const paymentStatuses = input.paymentStatuses === null ? null : [...input.paymentStatuses];
  const invitedIds = input.invitation === null ? null : [...input.invitation.ids];
  const invitedInclude = input.invitation?.include ?? true;
  const rows = await sql<
    {
      total: number;
      id: string | null;
      full_name: string | null;
      email: string | null;
      phone_e164: string | null;
      member_number: string | null;
      status: string | null;
      membership_type: string | null;
      joined_on: string | null;
      ends_on: string | null;
      ends_on_kind: string | null;
      payment_status: string | null;
      date_of_birth: string | null;
      former_at: Date | null;
      source: string | null;
      in_app: boolean | null;
    }[]
  >`
    WITH filtered AS (
      SELECT e.id, e.full_name, e.email::text AS email, e.phone_e164, e.member_number,
             e.status, e.membership_type,
             e.joined_on::text     AS joined_on,
             e.ends_on::text       AS ends_on,
             e.ends_on_kind,
             e.payment_status,
             e.date_of_birth::text AS date_of_birth,
             e.former_at, e.source,
             (e.id = ANY(${input.inAppEntryIds}::uuid[])) AS in_app
      FROM gym_member_list_entries e
      WHERE e.gym_id = ${input.gymId}
        -- CURRENT RECORDS UNLESS THE FORMER ONES WERE ASKED FOR BY NAME (§11.5). The
        -- default is what every screen means by the list; a former record appearing in
        -- a page nobody asked for is somebody the gym believes it has removed standing
        -- among its members.
        AND (${input.records}::text = 'all'
             OR (${input.records}::text = 'current' AND e.former_at IS NULL)
             OR (${input.records}::text = 'former' AND e.former_at IS NOT NULL))
        AND (${statuses}::text[] IS NULL
             OR lower(coalesce(e.status, '')) = ANY(${statuses}::text[]))
        AND (${membershipTypes}::text[] IS NULL
             OR lower(coalesce(e.membership_type, '')) = ANY(${membershipTypes}::text[]))
        AND (${paymentStatuses}::text[] IS NULL
             OR lower(coalesce(e.payment_status, '')) = ANY(${paymentStatuses}::text[]))
        AND (${input.like}::text IS NULL
             OR e.full_name ILIKE ${input.like}::text
             OR e.email::text ILIKE ${input.like}::text
             OR coalesce(e.phone_e164, '') ILIKE ${input.like}::text
             OR coalesce(e.member_number, '') ILIKE ${input.like}::text)
        AND (${input.filter}::text = 'all'
             OR (${input.filter}::text = 'in_app'
                 AND e.id = ANY(${input.inAppEntryIds}::uuid[]))
             OR (${input.filter}::text = 'not_in_app'
                 AND e.id <> ALL(${input.inAppEntryIds}::uuid[])))
        AND (${invitedIds}::uuid[] IS NULL
             OR (${invitedInclude}::boolean AND e.id = ANY(${invitedIds}::uuid[]))
             OR (NOT ${invitedInclude}::boolean AND e.id <> ALL(${invitedIds}::uuid[])))
    ),
    totals AS (SELECT count(*)::int AS total FROM filtered)
    SELECT t.total, f.id, f.full_name, f.email, f.phone_e164, f.member_number,
           f.status, f.membership_type, f.joined_on, f.ends_on, f.ends_on_kind,
           f.payment_status, f.date_of_birth, f.former_at, f.source, f.in_app
    FROM totals t
    LEFT JOIN LATERAL (
      SELECT *
      FROM filtered
      WHERE ${input.cursor === null}
         OR (filtered.full_name, filtered.id)
            > (${input.cursor?.name ?? ""}::text, ${input.cursor?.id ?? EMPTY_UUID}::uuid)
      ORDER BY filtered.full_name, filtered.id
      LIMIT ${input.limit}
    ) f ON true`;
  const total = rows[0]?.total ?? 0;
  const entries: EntryRow[] = [];
  for (const row of rows) {
    // The LEFT JOIN gives one all-null row when the page is empty, which is how the
    // total survives; it is not a person and is skipped here.
    if (row.id === null) continue;
    const source = memberListEntrySourceSchema.safeParse(row.source);
    if (!source.success) throw new Error(`member-list entry ${row.id} holds a source that no longer parses`);
    entries.push({
      entryId: row.id,
      fullName: row.full_name ?? "",
      email: row.email,
      phone: row.phone_e164,
      memberNumber: row.member_number,
      status: row.status,
      membershipType: row.membership_type,
      joinedOn: row.joined_on,
      endsOn: row.ends_on,
      endsOnKind: parseEndsOnKind(row.ends_on_kind, row.id),
      paymentStatus: row.payment_status,
      dateOfBirth: row.date_of_birth,
      formerAt: row.former_at,
      source: source.data,
      inApp: row.in_app ?? false,
    });
  }
  return { total, entries };
}

/** TELL POSTGRES WHAT IS NOW IN THE TABLE, after a confirm has filled it.
 *
 *  A confirm writes up to ten thousand rows into a table whose statistics still say
 *  it holds ONE — statistics are table-wide, so that is the true state before
 *  anybody has a list — and the planner then costs the per-member lookup in
 *  `membersAgainstList` against a table it believes is empty. That statement answers
 *  everything about a gym's own people and runs on the preview read and on every
 *  page of names, on the ONE connection the whole API shares.
 *
 *  **Measured 2026-09-21** (`.cost/stale.ts`, 10,000 entries against 200 members,
 *  three runs each, the processor at its full 2,592 MHz): stale **39.7 · 22.1 ·
 *  21.6 ms**, and after this **10.2 · 9.8 · 9.3 ms**. Walking the whole list a page
 *  at a time straight after a confirm was **3,198 ms** with it and **4,514 ms**
 *  without. Autovacuum reaches the same place by itself within about a minute; the
 *  minute in question is the one where staff are looking at the list they have just
 *  confirmed and paging through it.
 *
 *  Postgres's own manual says to run this after a bulk load, which is exactly what a
 *  confirm is. **It costs 269 ms at ten thousand rows**, once, and a gym confirms a
 *  list about once a month. It is a modest win bought cheaply, not a rescue: an
 *  earlier note here claimed a hundredfold and 3,152 ms, which is not reproducible
 *  and is struck.
 *
 *  **IT RUNS AFTER THE TRANSACTION HAS COMMITTED**, so the gym's row lock is already
 *  released and nothing waits on it but the connection; and it is HOUSEKEEPING, so a
 *  failure is warned about and never fails a confirm that has already been applied. */
export async function analyseEntries(sql: Sql): Promise<void> {
  await sql`ANALYZE gym_member_list_entries`;
}

// ── KEEPING THE LIST BY HAND (3a-iv; §9.9, §11.6) ───────────────────────────
//
// Every write below runs inside a transaction that holds the gym's row
// (`lockGym`), the lock the confirm and the join door take, so a typed change,
// a confirm and a join are applied one at a time and a check made here (is this
// person already on the list?) stays true until the write that relies on it.

/** One record as staff see and change it. */
export interface StoredEntry {
  id: string;
  identityKey: string;
  values: EntryValues;
  handEdited: string[];
  formerAt: Date | null;
  source: MemberListEntrySource;
}

interface StoredEntryRow {
  id: string;
  identity_key: string;
  full_name: string;
  email: string | null;
  phone_e164: string | null;
  member_number: string | null;
  status: string | null;
  membership_type: string | null;
  joined_on: string | null;
  ends_on: string | null;
  ends_on_kind: string | null;
  payment_status: string | null;
  date_of_birth: string | null;
  extra: unknown;
  hand_edited: string[];
  former_at: Date | null;
  source: string;
}

function toStored(row: StoredEntryRow): StoredEntry {
  const source = memberListEntrySourceSchema.safeParse(row.source);
  if (!source.success) throw new Error(`member-list entry ${row.id} holds a source that no longer parses`);
  return {
    id: row.id,
    identityKey: row.identity_key,
    values: {
      fullName: row.full_name,
      email: row.email,
      phone: row.phone_e164,
      memberNumber: row.member_number,
      status: row.status,
      membershipType: row.membership_type,
      joinedOn: row.joined_on,
      endsOn: row.ends_on,
      endsOnKind: parseEndsOnKind(row.ends_on_kind, row.id),
      paymentStatus: row.payment_status,
      dateOfBirth: row.date_of_birth,
      extra: parseExtra(row.extra, row.id),
    },
    handEdited: parseHandEdited(row.hand_edited, row.id),
    formerAt: row.former_at,
    source: source.data,
  };
}

/** One record of this gym's list, current or former. Null when it is not this
 *  gym's, which the caller answers as not found. */
export async function entryFor(sql: SqlOrTx, gymId: string, entryId: string): Promise<StoredEntry | null> {
  const rows = await sql<StoredEntryRow[]>`
    SELECT id, identity_key, full_name, email::text AS email, phone_e164, member_number,
           status, membership_type,
           joined_on::text     AS joined_on,
           ends_on::text       AS ends_on,
           ends_on_kind, payment_status,
           date_of_birth::text AS date_of_birth,
           extra, hand_edited, former_at, source
    FROM gym_member_list_entries
    WHERE gym_id = ${gymId} AND id = ${entryId}`;
  const row = rows[0];
  return row === undefined ? null : toStored(row);
}

/** The record of this gym that already holds `identityKey`, if any. */
export async function entryHolding(
  sql: SqlOrTx,
  gymId: string,
  identityKey: string,
): Promise<{ id: string; former: boolean } | null> {
  const rows = await sql<{ id: string; former: boolean }[]>`
    SELECT id, (former_at IS NOT NULL) AS former
    FROM gym_member_list_entries
    WHERE gym_id = ${gymId} AND identity_key = ${identityKey}`;
  return rows[0] ?? null;
}

/** A person typed in, or put on the list from their membership. The caller has
 *  already checked under the gym's lock that nobody holds the key. */
export async function insertEntry(
  tx: TransactionSql,
  gymId: string,
  values: EntryValues,
  identityKey: string,
  source: MemberListEntrySource,
): Promise<string> {
  const rows = await tx<{ id: string }[]>`
    INSERT INTO gym_member_list_entries
      (gym_id, full_name, email, phone_e164, member_number, status, membership_type,
       joined_on, ends_on, ends_on_kind, payment_status, date_of_birth, extra,
       identity_key, source)
    VALUES (${gymId}, ${values.fullName}, ${values.email}, ${values.phone}, ${values.memberNumber},
            ${values.status}, ${values.membershipType}, ${values.joinedOn}::date, ${values.endsOn}::date,
            ${values.endsOn === null ? null : values.endsOnKind}, ${values.paymentStatus},
            ${values.dateOfBirth}::date, ${tx.json(values.extra)}, ${identityKey}, ${source})
    RETURNING id`;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("inserting a member-list entry returned no row");
  return id;
}

/** One record written whole: every field, its key, its hand-edit marks and whether
 *  it is former. */
export async function writeEntry(
  tx: TransactionSql,
  gymId: string,
  entryId: string,
  write: { values: EntryValues; identityKey: string; handEdited: readonly string[]; formerAt: Date | null },
): Promise<void> {
  const { values } = write;
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_member_list_entries
    SET full_name       = ${values.fullName},
        email           = ${values.email},
        phone_e164      = ${values.phone},
        member_number   = ${values.memberNumber},
        status          = ${values.status},
        membership_type = ${values.membershipType},
        joined_on       = ${values.joinedOn}::date,
        ends_on         = ${values.endsOn}::date,
        ends_on_kind    = ${values.endsOn === null ? null : values.endsOnKind},
        payment_status  = ${values.paymentStatus},
        date_of_birth   = ${values.dateOfBirth}::date,
        extra           = ${tx.json(values.extra)},
        identity_key    = ${write.identityKey},
        hand_edited     = ${[...write.handEdited]}::text[],
        former_at       = ${write.formerAt}
    WHERE gym_id = ${gymId} AND id = ${entryId}
    RETURNING id`;
  if (rows.length !== 1) throw new Error(`writing member-list entry ${entryId} moved ${String(rows.length)} rows`);
}

/** Take a record off the list (a date) or put it back (null). False when it was
 *  already in that state. */
export async function setEntryFormer(tx: TransactionSql, gymId: string, entryId: string, at: Date | null): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_member_list_entries
    SET former_at = ${at}
    WHERE gym_id = ${gymId} AND id = ${entryId}
      AND ((${at}::timestamptz IS NULL AND former_at IS NOT NULL)
           OR (${at}::timestamptz IS NOT NULL AND former_at IS NULL))
    RETURNING id`;
  return rows.length === 1;
}

/** A record deleted for good: a former one deleted, or the one not kept when two
 *  are joined. A membership linked to it keeps its membership and loses the link (the
 *  foreign key's ON DELETE SET NULL); the last test in
 *  `memberList.byHand.routes.test.ts` lists every table that points at a record. */
export async function deleteEntry(tx: TransactionSql, gymId: string, entryId: string): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    DELETE FROM gym_member_list_entries
    WHERE gym_id = ${gymId} AND id = ${entryId}
    RETURNING id`;
  return rows.length === 1;
}

/** Two records joined: the memberships linked to the one not kept are linked to the
 *  kept one (§13.2). */
export async function moveMembershipLinks(tx: TransactionSql, gymId: string, fromEntryId: string, toEntryId: string): Promise<number> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_members SET entry_id = ${toEntryId}
    WHERE gym_id = ${gymId} AND entry_id = ${fromEntryId}
    RETURNING id`;
  return rows.length;
}

/** The list moved by hand: its version up by one, and the list created for a gym
 *  whose first change is a typed person. */
export async function bumpListVersion(tx: TransactionSql, gymId: string): Promise<number> {
  const rows = await tx<{ version: number }[]>`
    INSERT INTO gym_member_lists (gym_id, version)
    VALUES (${gymId}, 1)
    ON CONFLICT (gym_id) DO UPDATE SET version = gym_member_lists.version + 1
    RETURNING version`;
  const version = rows[0]?.version;
  if (version === undefined) throw new Error("moving a member list on by hand returned no row");
  return version;
}

/** §9.7's stamp for a change by hand: every live member a current record reaches by
 *  these contacts (their proved email or the phone they gave), so a member whose
 *  record is later taken off reads "no longer listed" and not "never listed". */
export async function stampListedByContact(
  tx: TransactionSql,
  gymId: string,
  contacts: readonly { email: string | null; phone: string | null }[],
  /** Records whose members joined with them: listed whatever their contact says (3a-vi-b). */
  entryIds: readonly string[],
  at: Date,
): Promise<number> {
  const emails = contacts.flatMap((c) => (c.email === null ? [] : [c.email]));
  const phones = contacts.flatMap((c) => (c.phone === null ? [] : [c.phone]));
  if (emails.length === 0 && phones.length === 0 && entryIds.length === 0) return 0;
  const rows = await tx<{ user_id: string }[]>`
    UPDATE gym_members m
    SET last_listed_at = ${at}
    FROM users u
    WHERE u.id = m.user_id
      AND m.gym_id = ${gymId}
      AND m.removed_at IS NULL
      AND ((u.email = ANY(${emails}::citext[])
            AND EXISTS (
              SELECT 1 FROM one_time_tokens t
              WHERE t.user_id = m.user_id AND t.purpose = 'verify_email' AND t.used_at IS NOT NULL))
           OR (m.stated_phone_e164 IS NOT NULL AND m.stated_phone_e164 = ANY(${phones}::text[]))
           OR m.entry_id = ANY(${[...entryIds]}::uuid[]))
    RETURNING m.user_id`;
  return rows.length;
}

export interface MemberVisitRow {
  userId: string;
  displayName: string;
  joinedAt: Date;
  visits: number;
  lastVisitOn: string | null;
}

/** When each of these live members joined, and their visits here since (§2.4: a gym
 *  sees attendance, and only during the membership). */
export async function memberVisits(sql: SqlOrTx, gymId: string, userIds: readonly string[]): Promise<MemberVisitRow[]> {
  if (userIds.length === 0) return [];
  const rows = await sql<{ user_id: string; display_name: string; joined_at: Date; visits: number; last_visit_on: string | null }[]>`
    SELECT m.user_id, u.display_name, m.joined_at,
           (SELECT count(*)::int FROM gym_attendance a
             WHERE a.gym_id = m.gym_id AND a.user_id = m.user_id AND a.marked_at >= m.joined_at) AS visits,
           (SELECT max(a.day)::text FROM gym_attendance a
             WHERE a.gym_id = m.gym_id AND a.user_id = m.user_id AND a.marked_at >= m.joined_at) AS last_visit_on
    FROM gym_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.gym_id = ${gymId} AND m.user_id = ANY(${[...userIds]}::uuid[]) AND m.removed_at IS NULL
    ORDER BY m.joined_at, m.user_id
    LIMIT ${MEMBER_LIST_MAX_ENTRY_MEMBERS}`;
  return rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    joinedAt: row.joined_at,
    visits: row.visits,
    lastVisitOn: row.last_visit_on,
  }));
}

/** A live member of this gym as the list would hold them: their name, their proved
 *  email or null, and the phone they gave the gym. Null when they are not a live
 *  member here. */
export async function memberContact(
  sql: SqlOrTx,
  gymId: string,
  userId: string,
): Promise<{ displayName: string; email: string | null; phone: string | null } | null> {
  const rows = await sql<{ display_name: string; email: string | null; stated_phone_e164: string | null }[]>`
    SELECT u.display_name,
           CASE
             WHEN EXISTS (
               SELECT 1 FROM one_time_tokens t
               WHERE t.user_id = m.user_id AND t.purpose = 'verify_email' AND t.used_at IS NOT NULL)
             THEN u.email::text
             ELSE NULL
           END AS email,
           m.stated_phone_e164
    FROM gym_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.gym_id = ${gymId} AND m.user_id = ${userId} AND m.removed_at IS NULL`;
  const row = rows[0];
  return row === undefined ? null : { displayName: row.display_name, email: row.email, phone: row.stated_phone_e164 };
}

/** "REMOVE ALL": the memberships closed, in one statement — `removeMember`'s own
 *  write for a set. The owner, staff and free places are refused here as well as by
 *  the rule that chose the set. */
export async function closeMemberships(
  tx: TransactionSql,
  gymId: string,
  userIds: readonly string[],
  at: Date,
): Promise<{ membershipId: string; userId: string }[]> {
  if (userIds.length === 0) return [];
  const rows = await tx<{ id: string; user_id: string }[]>`
    UPDATE gym_members m
    SET removed_at = ${at}
    WHERE m.gym_id = ${gymId}
      AND m.user_id = ANY(${[...userIds]}::uuid[])
      AND m.removed_at IS NULL
      AND m.complimentary = false
      AND NOT EXISTS (SELECT 1 FROM gym_staff s WHERE s.gym_id = m.gym_id AND s.user_id = m.user_id)
    RETURNING m.id, m.user_id`;
  return rows.map((row) => ({ membershipId: row.id, userId: row.user_id }));
}

/** How many people an earlier "Remove all" of this exact set removed, since `since`, or
 *  null when there was none: the summary audit row keeps the set's digest. */
export async function unlistedRemovalByDigest(
  tx: TransactionSql,
  gymId: string,
  group: string,
  digest: string,
  since: Date,
): Promise<number | null> {
  const rows = await tx<{ removed: string | null }[]>`
    SELECT meta->>'removed' AS removed
    FROM audit_log
    WHERE gym_id = ${gymId} AND at >= ${since}
      AND action = 'org.member_list_unlisted_removed'
      AND meta->>'group' = ${group} AND meta->>'digest' = ${digest}
    ORDER BY at DESC
    LIMIT 1`;
  const removed = rows[0]?.removed;
  return removed === undefined || removed === null ? null : Number(removed);
}

/** One `org.member_removed` audit row per closed membership, as a single removal
 *  writes, in one statement. */
export async function insertRemovalAudits(
  tx: TransactionSql,
  input: { actorUserId: string; gymId: string; group: string; removed: readonly { membershipId: string; userId: string }[] },
): Promise<void> {
  if (input.removed.length === 0) return;
  const payload = input.removed.map((r) => ({ membership_id: r.membershipId, user_id: r.userId }));
  await tx`
    INSERT INTO audit_log (actor_user_id, gym_id, action, target_type, target_id, meta)
    SELECT ${input.actorUserId}, ${input.gymId}, 'org.member_removed', 'gym_member', r.membership_id,
           jsonb_build_object('removedUserId', r.user_id, 'via', 'remove_unlisted', 'group', ${input.group}::text)
    FROM jsonb_to_recordset(${tx.json(payload)}) AS r(membership_id text, user_id text)`;
}
