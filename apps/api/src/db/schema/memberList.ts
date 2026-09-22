// THE GYM'S OWN LIST OF PEOPLE (Part 3 §9.6; ROADMAP Stage 2 item 3a-iii).
//
// A gym uploads the list its own software exports, and the app keeps it so that
// staff can see who of their members is in the app, invite the ones who are not,
// and be told when somebody has dropped off the gym's list. THREE TABLES:
//
//   gym_member_lists          one row per gym that has ever confirmed a list,
//                             holding the version every read and every write is
//                             checked against;
//   gym_member_list_entries   the gym's people — the newest confirmed list, plus
//                             the FORMER records of everybody it has taken off;
//   gym_member_list_fields    the gym's own column headings (3a-v-b), which an
//                             entry's `extra` document is written under;
//   gym_member_list_uploads   a file waiting for a yes, with the rows the
//                             preview was worked out from.
//
// **SINCE 3a-v-b THE RECORD IS DURABLE AND IT IS WIDER** (§11.1, Part 2 of the
// 2026-09-21 re-plan). Wider: beside the five things a list kept, an entry holds
// the gym's membership word, its payment word, the join date, the end-or-renewal
// date with which of the two its heading said, the date of birth, and every
// other column the gym had under the gym's own heading. Durable: nobody is
// deleted any more — somebody who drops off an uploaded list is marked FORMER
// with the date, because a management app's visits, reports and returning
// members all hang off the record, which reverses §9.2 rule 2.
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
import { bigserial, date, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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

/** THE GYM'S PEOPLE. Every row with `former_at IS NULL` is the newest confirmed
 *  list, and that set is what "the list" means everywhere else; every row with a
 *  `former_at` is somebody the gym has had and taken off.
 *
 *  **A CONFIRM NO LONGER DELETES ANYBODY** (§11.1, 3a-v-b). It inserts the people the
 *  file has and the list has not, revives the FORMER records it holds again, writes
 *  what changed, and marks the rest former with the instant they came off. Before
 *  3a-v-b it deleted them, on §9.2 rule 2's reasoning that the gym's own software is
 *  the record of yesterday — which is true of a LIST and false of a management app,
 *  where the visits, the reports and a returning member's history all hang off this
 *  row. The gym can still delete a former record for good.
 *
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
    // ── THE WIDER RECORD (Part 3 §11.1; ROADMAP 3a-v-b) ─────────────────────
    //
    // A management app's member record holds what the gym's own software held.
    // Each of these is THE GYM'S OWN WORD or a plain calendar day; the app
    // attaches no meaning to any of the words (§11.1), never reads a payment
    // word as a state of membership, and never works a status out from a date.
    membershipType: text("membership_type"),
    // `date` and not `timestamptz`: a join date and a birthday are the same day
    // in every country, and a timestamp would need a zone to be read back —
    // which is the shape day maths goes wrong in (CLAUDE.md §4).
    joinedOn: date("joined_on"),
    endsOn: date("ends_on"),
    // WHICH OF THE TWO THE GYM'S OWN HEADING SAID, so a screen prints "Renews 3
    // Oct" rather than choosing for the gym. It is a property of the COLUMN the
    // date came from and it is stored per ENTRY anyway: a gym's next export can
    // say the other thing, and 3a-iv's typed-in person has no column at all.
    endsOnKind: text("ends_on_kind"),
    paymentStatus: text("payment_status"),
    dateOfBirth: date("date_of_birth"),
    /** THE GYM'S OWN COLUMNS, under the gym's own keys — one document per person,
     *  against the per-gym catalogue in `gym_member_list_fields` (§11.1).
     *
     *  **A DOCUMENT AND NOT A ROW PER FIELD, and the reason is the read.** Every
     *  screen that shows one of these people shows ALL of their fields at once
     *  (§11.6's person page), so a row per field would be forty rows to join for
     *  one person and four hundred thousand rows for a list of ten thousand — where
     *  the document is fetched with the person for nothing. Nothing filters on one
     *  of these columns in this build (§11.1: "not filter chips in the first
     *  build"), which is the only thing a row per field would buy.
     *
     *  **IT IS MERGED BY KEY AND NEVER REPLACED WHOLE.** A gym exporting a narrower
     *  report next month would otherwise wipe every column that report does not
     *  mention — and the columns a file legitimately leaves out are exactly the ones
     *  §11.2 refuses to keep. A key the file carries is written, blank cell and all;
     *  a key it does not mention is left where it was. */
    extra: jsonb("extra").notNull().default({}),
    /** WHEN THIS PERSON CAME OFF THE LIST, or NULL while they are on it (§11.1).
     *
     *  **NOBODY IS DELETED FROM A GYM'S LIST ANY MORE**, which reverses §9.2 rule 2:
     *  a management app's record is durable, because the visits, the reports and a
     *  returning member's history all hang off it. A former record admits nobody
     *  (§10.2), is invited by nothing, is left out of a page unless it is asked for,
     *  and makes no member read "on your list".
     *
     *  The UNIQUE on `(gym_id, identity_key)` covers former rows too, which is
     *  exactly what makes a returning person the SAME record: the next upload that
     *  holds them clears this column instead of inserting somebody new. */
    formerAt: timestamp("former_at", { withTimezone: true }),
    /** WHICH FIELDS STAFF EDITED BY HAND SINCE THE LAST UPLOAD — names only, never
     *  values (§11.4). A standard field by its own name, one of the gym's own
     *  columns as `extra:<key>`.
     *
     *  An upload that would write over one of these lists the FIELDS and needs a
     *  tick on that request, as the wrong-file guard does; after the tick the file
     *  wins and the names it wrote are cleared. Empty is the ordinary case, and the
     *  screen that fills it is 3a-iv's. */
    handEdited: text("hand_edited").array().notNull().default(sql`'{}'::text[]`),
    identityKey: text("identity_key").notNull(),
    source: text("source").notNull(),
    // WHERE THIS PERSON CAME IN THE LIST, and the only column that can say so.
    //
    // **`created_at` CANNOT, AND THAT IS NOT A SUBTLETY — IT IS THE WHOLE REASON
    // THIS COLUMN EXISTS.** `now()` is the TRANSACTION's clock, so every row one
    // confirm writes carries the same instant to the microsecond; ordering by it
    // leaves the tie to `id`, which is `gen_random_uuid()`. Measured 2026-09-21 on
    // a copy of this table: of 40 confirms whose file wrote "Active" before
    // "ACTIVE", 16 read the gym's own chip back as "ACTIVE". Three separate
    // answers hang on "which entry came first" — the spelling shown on a status
    // chip and the order the chips come in (§9.9), which entry a member is matched
    // to when a family shares one address (§9.7), and the order the pure rule is
    // handed the list in — so all three were random, and two reads a second apart
    // could disagree.
    //
    // A sequence, not the file's row number, because a later confirm and 3a-iv's
    // typed-in person must APPEND rather than restart at one. The confirm's INSERT
    // orders by the file's own row order so the numbers follow the list.
    listedSeq: bigserial("listed_seq", { mode: "bigint" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("gym_member_list_entries_identity_uq").on(t.gymId, t.identityKey),
    index("gym_member_list_entries_gym_email_idx").on(t.gymId, t.email),
    index("gym_member_list_entries_gym_phone_idx").on(t.gymId, t.phoneE164),
    // "how many Active, how many Frozen" — read once per console load, and the
    // filter behind the list screen's status chips (§9.9).
    index("gym_member_list_entries_gym_status_idx").on(t.gymId, sql`lower(${t.status})`),
    // The gym's list in its own order, which every preview and every confirm reads
    // whole: an ordered index scan instead of a sort of up to ten thousand rows.
    index("gym_member_list_entries_gym_seq_idx").on(t.gymId, t.listedSeq),
    check("gym_member_list_entries_full_name_check", sql`length(${t.fullName}) <= 120`),
    check("gym_member_list_entries_email_check", sql`${t.email} IS NULL OR length(${t.email}) <= 254`),
    check("gym_member_list_entries_phone_check", sql`${t.phoneE164} IS NULL OR ${t.phoneE164} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check("gym_member_list_entries_member_number_check", sql`${t.memberNumber} IS NULL OR length(${t.memberNumber}) <= 64`),
    check("gym_member_list_entries_status_check", sql`${t.status} IS NULL OR length(${t.status}) <= 40`),
    check(
      "gym_member_list_entries_membership_type_check",
      sql`${t.membershipType} IS NULL OR length(${t.membershipType}) <= 40`,
    ),
    check(
      "gym_member_list_entries_payment_status_check",
      sql`${t.paymentStatus} IS NULL OR length(${t.paymentStatus}) <= 40`,
    ),
    check("gym_member_list_entries_ends_on_kind_check", sql`${t.endsOnKind} IS NULL OR ${t.endsOnKind} IN ('ends','renews')`),
    // A DAY WITHOUT A DATE IS A KIND WITHOUT ANYTHING TO SAY IT ABOUT. "Renews"
    // beside no date is a screen printing half a sentence.
    check("gym_member_list_entries_ends_on_kind_needs_day_check", sql`${t.endsOnKind} IS NULL OR ${t.endsOn} IS NOT NULL`),
    // The gym's own columns are an OBJECT of keys, never a list and never a bare
    // value: the document is merged by key, and a jsonb array would merge into
    // nonsense with nothing saying so.
    check("gym_member_list_entries_extra_object_check", sql`jsonb_typeof(${t.extra}) = 'object'`),
    // HOW MANY KEYS THE DOCUMENT MAY HOLD IS NOT A CHECK HERE, AND THAT IS A
    // POSTGRES LIMIT AND NOT A CHOICE: counting a jsonb object's keys needs
    // `jsonb_object_keys`, a set-returning function, and a CHECK constraint may hold
    // no subquery. So the ceiling lives where the gym's own rows can be counted —
    // `gym_member_list_fields` is capped at `MEMBER_LIST_MAX_EXTRA_FIELDS` a gym in
    // `repo.reconcileFields`, and a document's keys are only ever written from that
    // catalogue, so it is bounded by construction rather than by assertion.
    // Field NAMES, never values, and never more of them than there are fields.
    check("gym_member_list_entries_hand_edited_check", sql`array_length(${t.handEdited}, 1) IS NULL OR array_length(${t.handEdited}, 1) <= 52`),
    check("gym_member_list_entries_identity_key_check", sql`${t.identityKey} ~ '^[0-9a-f]{64}$'`),
    check("gym_member_list_entries_source_check", sql`${t.source} IN ('upload','typed','member')`),
    check("gym_member_list_entries_contact_check", sql`${t.email} IS NOT NULL OR ${t.phoneE164} IS NOT NULL`),
  ],
);

/** THE GYM'S OWN COLUMNS — its catalogue of extra fields (Part 3 §11.1; 3a-v-b).
 *
 *  One row per heading the gym's files have ever brought that is not one of the ten
 *  standard fields and is not a column §11.2 refuses. An entry's `extra` document is
 *  written under these keys, which is why the key is built from the HEADING and never
 *  from where the column happened to sit: next month's export with its columns in a
 *  different order has to land in the same fields.
 *
 *  **THE CATALOGUE OUTLIVES ANY ONE FILE, and a whole-list upload does NOT replace
 *  it.** A gym that exports a narrower report one month has not stopped keeping the
 *  columns that report leaves out — the people's cells under them are still there and
 *  the person's page still shows them. That is also why it needs its own ceiling: the
 *  FILE's forty (`MEMBER_LIST_MAX_EXTRA_FIELDS`) bounds one upload, and without a cap
 *  here a gym uploading differently-shaped exports would accumulate fields without
 *  limit, which is an unbounded document on every one of its people.
 *
 *  `ord` is the order the gym's screens show them in: the order they were first seen,
 *  appended to, so a heading never moves once staff have learnt where it is.
 *
 *  It holds NO user link — it is a list of the gym's own column headings — so
 *  `privacy/tables.ts` gains nothing, and what ends it is the gym ending. */
export const gymMemberListFields = pgTable(
  "gym_member_list_fields",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    ord: integer("ord").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // THE KEY IS WHAT AN ENTRY'S DOCUMENT IS WRITTEN UNDER, so one per gym, and the
    // uniqueness is what makes "add the fields this file brings" safe to run twice.
    unique("gym_member_list_fields_key_uq").on(t.gymId, t.key),
    // Read whole, in the gym's own order, on every confirm and every list read.
    index("gym_member_list_fields_gym_ord_idx").on(t.gymId, t.ord),
    check("gym_member_list_fields_key_check", sql`${t.key} ~ '^[a-z0-9_]{1,64}$'`),
    check("gym_member_list_fields_label_check", sql`length(${t.label}) <= 80`),
    check("gym_member_list_fields_ord_check", sql`${t.ord} >= 0`),
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
