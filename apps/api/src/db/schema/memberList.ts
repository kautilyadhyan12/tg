// THE GYM'S OWN LIST OF PEOPLE (Part 3 §9.6; ROADMAP Stage 2 item 3a-iii).
//
// A gym uploads the list its own software exports, and the app keeps it so that
// staff can see who of their members is in the app, invite the ones who are not,
// and be told when somebody has dropped off the gym's list. THREE TABLES:
//
//   gym_member_lists          one row per gym that has ever confirmed a list,
//                             holding the version every read and every write is
//                             checked against;
//   gym_member_list_entries   exactly the newest confirmed list, one row per
//                             person on it;
//   gym_member_list_uploads   a file waiting for a yes, with the rows the
//                             preview was worked out from.
//
// **THE LIST IS THE GYM'S RECORD, HELD FOR THE GYM, AND THAT DECIDES THE
// PRIVACY FOOTING.** An entry points at no user: it is a name, an address and a
// phone number the gym gave us about somebody who may never have opened the app.
// So a person's own export does not carry it, the Day-14 purge does not touch
// it, and what closes it is the GYM closing — `archiveSweep.ts` deletes all
// three tables' rows in the same transaction that archives the gym. The only
// user link in the three is an upload's uploader, which is why
// `gym_member_list_uploads` alone joins `privacy/tables.ts`, on `gym_closures`'
// footing.
//
// **NOTHING HERE IS EMAILED BY ANYTHING IN THIS CARD.** The gym's invite is its
// own decision (§9.2 rule 11) and it is 3b's; an upload and a confirm write rows
// and send nothing.
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { check } from "drizzle-orm/pg-core";
import { citext, createdAt } from "./common.js";
import { gyms } from "./tenancy.js";
import { users } from "./identity.js";

/** ONE ROW PER GYM THAT HAS EVER CONFIRMED A LIST, and the row every write to
 *  the list locks.
 *
 *  `version` is what makes a preview answerable: it is bumped by every change to
 *  the list, so a confirm can say "the list I worked this out against is still
 *  the list" and refuse rather than apply a stale answer. A gym with no row here
 *  has never confirmed anything, which is why no member reads "no longer listed"
 *  until one exists (§9.7). */
export const gymMemberLists = pgTable("gym_member_lists", {
  gymId: uuid("gym_id")
    .primaryKey()
    .references(() => gyms.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(0),
  lastConfirmedUploadId: uuid("last_confirmed_upload_id"),
  lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** EXACTLY THE NEWEST CONFIRMED LIST — not a history. A confirm in whole-list
 *  mode inserts, updates and deletes until this table IS the file; nothing keeps
 *  yesterday's list, because the gym's own software is the record of that and a
 *  second copy would be a second answer to "who is a member here".
 *
 *  `identity_key` is what tells one person from another (§9.5): the name, email,
 *  phone and member number, and NOT the status — so "Active" becoming "Expired"
 *  changes this row in place instead of removing a person and adding one. It is
 *  unique per gym, which is what makes a confirm's three statements safe to run
 *  twice.
 *
 *  `status` IS THE GYM'S OWN WORD, never ours (§9.5). We attach no meaning to
 *  it: "Frozen", "On hold" and "Due" mean whatever that gym means, and the app
 *  only ever counts and groups them. The index folds case because two exports of
 *  one gym write "Active" and "ACTIVE".
 *
 *  Every row has an email or a phone (the CHECK): a person with neither cannot
 *  be matched to an app member or invited, so understanding a file skips them
 *  and counts them rather than storing a row nothing can be done with. */
export const gymMemberListEntries = pgTable(
  "gym_member_list_entries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull().default(""),
    email: citext("email"),
    phoneE164: text("phone_e164"),
    memberNumber: text("member_number"),
    status: text("status"),
    identityKey: text("identity_key").notNull(),
    source: text("source").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("gym_member_list_entries_identity_uq").on(t.gymId, t.identityKey),
    index("gym_member_list_entries_gym_email_idx").on(t.gymId, t.email),
    index("gym_member_list_entries_gym_phone_idx").on(t.gymId, t.phoneE164),
    // "how many Active, how many Frozen" — read once per console load, and the
    // filter behind the list screen's status chips (§9.9).
    index("gym_member_list_entries_gym_status_idx").on(t.gymId, sql`lower(${t.status})`),
    check("gym_member_list_entries_full_name_check", sql`length(${t.fullName}) <= 120`),
    check("gym_member_list_entries_email_check", sql`${t.email} IS NULL OR length(${t.email}) <= 254`),
    check("gym_member_list_entries_phone_check", sql`${t.phoneE164} IS NULL OR ${t.phoneE164} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check("gym_member_list_entries_member_number_check", sql`${t.memberNumber} IS NULL OR length(${t.memberNumber}) <= 64`),
    check("gym_member_list_entries_status_check", sql`${t.status} IS NULL OR length(${t.status}) <= 40`),
    check("gym_member_list_entries_identity_key_check", sql`${t.identityKey} ~ '^[0-9a-f]{64}$'`),
    check("gym_member_list_entries_source_check", sql`${t.source} IN ('upload','typed','member')`),
    check("gym_member_list_entries_contact_check", sql`${t.email} IS NOT NULL OR ${t.phoneE164} IS NOT NULL`),
  ],
);

/** A FILE WAITING FOR A YES. An upload is staged and answered with a preview;
 *  nothing about the gym's people changes until staff confirm it.
 *
 *  **`rows` HOLDS THE FILE'S OWN CELLS AND IS EMPTIED THE MOMENT THE UPLOAD IS
 *  FINISHED WITH** — confirmed, superseded or expired. That is the whole reason
 *  the document is split in two: `summary` is counts, and the gym's own status
 *  words, which say nothing about any one person and are what makes a confirmed
 *  upload's record readable; `rows` is the names, addresses, phone numbers and
 *  three sample cells of every column, which nobody needs once the answer has
 *  been applied or thrown away.
 *
 *  `base_version` is the list's version the preview was worked out against, so a
 *  confirm can refuse a stale answer (§9.7). `file_sha256` is what lets the
 *  preview say "this is the same file you already applied". `header_fingerprint`
 *  is the heading row's own fingerprint, so next month's export of the same
 *  shape is mapped the same way without guessing again (§9.5).
 *
 *  `expires_at` is written by the inserting statement rather than a DEFAULT: the
 *  expiry job and the tests drive an injectable clock, and a DEFAULT of
 *  `now() + interval` would be a second clock in the database that no test can
 *  move. */
export const gymMemberListUploads = pgTable(
  "gym_member_list_uploads",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("staged"),
    mode: text("mode").notNull(),
    fileKind: text("file_kind").notNull(),
    fileSha256: text("file_sha256").notNull(),
    fileBytes: integer("file_bytes").notNull(),
    headerFingerprint: text("header_fingerprint"),
    mapping: jsonb("mapping").notNull(),
    baseVersion: integer("base_version").notNull(),
    summary: jsonb("summary").notNull(),
    rows: jsonb("rows"),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    // The gym's one staged upload: found to supersede it, to read it back, and
    // by the expiry job. Partial, because a gym accumulates confirmed rows for
    // ever and only ever has one staged.
    index("gym_member_list_uploads_staged_idx")
      .on(t.gymId, t.createdAt.desc())
      .where(sql`${t.status} = 'staged'`),
    index("gym_member_list_uploads_expiry_idx").on(t.expiresAt).where(sql`${t.status} = 'staged'`),
    index("gym_member_list_uploads_gym_created_idx").on(t.gymId, t.createdAt.desc()),
    check("gym_member_list_uploads_status_check", sql`${t.status} IN ('staged','confirmed','superseded','expired')`),
    check("gym_member_list_uploads_mode_check", sql`${t.mode} IN ('whole_list','add')`),
    check("gym_member_list_uploads_file_kind_check", sql`${t.fileKind} IN ('csv','xlsx')`),
    check("gym_member_list_uploads_file_sha256_check", sql`${t.fileSha256} ~ '^[0-9a-f]{64}$'`),
    check("gym_member_list_uploads_file_bytes_check", sql`${t.fileBytes} > 0 AND ${t.fileBytes} <= 5242880`),
    check(
      "gym_member_list_uploads_header_fingerprint_check",
      sql`${t.headerFingerprint} IS NULL OR ${t.headerFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check("gym_member_list_uploads_base_version_check", sql`${t.baseVersion} >= 0`),
    // The cells go when the upload is finished with, and the only state that may
    // still hold them is `staged`. A CHECK rather than a comment, because
    // "confirmed, and still holding a member's address" is exactly the state
    // nothing else in the system would ever notice.
    check("gym_member_list_uploads_rows_only_staged_check", sql`${t.status} = 'staged' OR ${t.rows} IS NULL`),
    check("gym_member_list_uploads_confirmed_at_check", sql`(${t.status} = 'confirmed') = (${t.confirmedAt} IS NOT NULL)`),
  ],
);
