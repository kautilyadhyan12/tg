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
  memberListMappingSchema,
  memberListModeSchema,
  memberListStagedFileSchema,
  memberListUploadStatusSchema,
  memberListUploadSummarySchema,
  type MemberListMapping,
  type MemberListMode,
  type MemberListStagedFile,
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
  file: memberListStagedFileSchema.nullable(),
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
  /** What the server understood of the file, or null once the upload is
   *  finished with. */
  file: MemberListStagedFile | null;
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
      rows: unknown;
      created_at: Date;
      expires_at: Date;
    }[]
  >`
    SELECT id, status, mode, file_kind, file_sha256, file_bytes, header_fingerprint,
           mapping, base_version, summary, rows, created_at, expires_at
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
    file: row.rows,
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
    file: stale ? null : shape.data.file,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
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
