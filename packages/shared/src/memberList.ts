// THE MEMBER LIST (spec Part 3 §9). The gym's own list of its members, uploaded
// as a spreadsheet and kept in the app. Shared shapes and every constant live
// here (§9.3); the server code is in `apps/api/src/modules/orgs/memberList/`.
//
// 3a-i, opening a file safely (§9.4): what an uploaded file may be, what it is
// opened into — a grid of text cells, one per sheet — and every refusal, in the
// server's own words, each saying what to do next. A screen prints the words
// as sent; it never writes its own.
import { z } from "zod";
import {
  memberInviteBlockedSchema,
  memberInviteOneSchema,
  memberInviteSkippedSchema,
  memberListInvitationFilterSchema,
  memberListInvitationSchema,
} from "./memberInvites.js";

// ---------------------------------------------------------------------------
// Limits (§9.9)
// ---------------------------------------------------------------------------

/** The biggest file accepted, in bytes, after the upload's base64 is decoded. */
export const MEMBER_FILE_MAX_BYTES = 5 * 1024 * 1024;
/** The most an Excel file's parts may inflate to, all together. */
export const MEMBER_FILE_MAX_INFLATED_BYTES = 25 * 1024 * 1024;
/** The most entries an Excel file's archive may hold (Apache POI's figure). */
export const MEMBER_FILE_MAX_ARCHIVE_ENTRIES = 1_000;
/** The most people one list may hold. */
export const MEMBER_LIST_MAX_DATA_ROWS = 10_000;
/** How far down a sheet the header row is looked for (3a-ii). */
export const MEMBER_FILE_HEADER_SCAN_ROWS = 20;
/** Where a sheet is cut: the most people plus room for a title block above the
 *  header. A sheet with anything written below this row is marked as cut. */
export const MEMBER_FILE_MAX_SHEET_ROWS = MEMBER_LIST_MAX_DATA_ROWS + MEMBER_FILE_HEADER_SCAN_ROWS;
/** Where a sheet is cut across; anything written right of it marks it as cut. */
export const MEMBER_FILE_MAX_COLUMNS = 100;
/** The longest cell kept, in characters; the rest of a longer cell is dropped
 *  (no field the list keeps is anywhere near it: a name, an address, a number). */
export const MEMBER_FILE_MAX_CELL_CHARS = 2_000;
/** The most cells a file's grid may hold, all sheets together: one sheet at its
 *  cut. Excel's own 10,000 × 30 list is 300,030 cells (measured 2026-09-19). */
export const MEMBER_FILE_MAX_GRID_CELLS = MEMBER_FILE_MAX_SHEET_ROWS * MEMBER_FILE_MAX_COLUMNS;
/** The most characters a file's grid may hold, all sheets together: as many as
 *  the largest CSV can, so an Excel file holds no more than a CSV may. Excel's
 *  own 10,000 × 30 list is 2,900,908 characters (measured 2026-09-19). Counted in
 *  the worker because a workbook can point a million cells at one shared string,
 *  nearly free there and copied once per cell into the request's thread
 *  (review of PR #85: a 0.8 MB file took that thread past 1 GB). */
export const MEMBER_FILE_MAX_GRID_CHARS = MEMBER_FILE_MAX_BYTES;
/** The longest tag an Excel part may hold, from its `<` to its `>`. The Excel
 *  package takes 74 s over one closed 1 MiB tag and 173 s over an unclosed one
 *  (measured 2026-09-19; 32 and 44 ms at 256 KiB); a real part's longest tag is
 *  a few hundred characters. */
export const MEMBER_FILE_MAX_TAG_CHARS = 64 * 1024;
/** A file still being read after this long is refused and its reader stopped. */
export const MEMBER_FILE_PARSE_TIMEOUT_MS = 15_000;
/** How many files one server process reads at the same time. */
export const MEMBER_FILE_PARSES_AT_ONCE = 2;
/** The reader's own memory ceiling, in MB of JavaScript heap. */
export const MEMBER_FILE_WORKER_HEAP_MB = 256;

// ---------------------------------------------------------------------------
// What a file opens into
// ---------------------------------------------------------------------------

/** How a text file's bytes were read. `macintosh` and `windows-1252` are
 *  guesses (no mark, and not valid UTF-8), which the `encoding_guessed` warning
 *  says. */
export const memberFileEncodingSchema = z.enum(["utf-8", "utf-16le", "utf-16be", "macintosh", "windows-1252"]);
export type MemberFileEncoding = z.infer<typeof memberFileEncodingSchema>;

/** What was noticed about the whole file while opening it:
 *  - `hidden_rows_or_columns`: an Excel sheet hides rows or columns, which a
 *    filtered export also does — they ARE read;
 *  - `encoding_guessed`: a text file had no mark saying how it was saved and was
 *    not UTF-8, so its letters were read by the likeliest guess. */
export const memberFileWarningSchema = z.enum(["hidden_rows_or_columns", "encoding_guessed"]);
export type MemberFileWarning = z.infer<typeof memberFileWarningSchema>;

/** One sheet as text. Every row is as wide as the sheet's widest written cell
 *  (at most `MEMBER_FILE_MAX_COLUMNS`); a blank row inside the sheet is kept so
 *  row numbers match what the gym sees; blank rows after the last written one
 *  are dropped. `truncated` says whether anything was written below or right of
 *  the cut. A CSV's one sheet has no name. */
export const memberFileSheetSchema = z.object({
  name: z.string().nullable(),
  rows: z.array(z.array(z.string())),
  truncated: z.object({ rows: z.boolean(), columns: z.boolean() }),
});
export type MemberFileSheet = z.infer<typeof memberFileSheetSchema>;

/** What the file itself turned out to be, which a screen shows beside the
 *  columns so staff can see it was read the way they saved it. */
export const memberFileFactsSchema = z.object({
  encoding: memberFileEncodingSchema.optional(),
  /** The character between a CSV's columns: named by a `sep=` line, else found. */
  delimiter: z.string().length(1).optional(),
});
export type MemberFileFacts = z.infer<typeof memberFileFactsSchema>;

export const memberFileGridSchema = z.object({
  ok: z.literal(true),
  kind: z.enum(["xlsx", "csv"]),
  sheets: z.array(memberFileSheetSchema),
  facts: memberFileFactsSchema,
  warnings: z.array(memberFileWarningSchema),
});
export type MemberFileGrid = z.infer<typeof memberFileGridSchema>;

// ---------------------------------------------------------------------------
// Refusals (§9.9) — each one's words say the fix
// ---------------------------------------------------------------------------

/** Which kind of zip a zip that is not an Excel workbook is, so the words can
 *  name the program that saves it as one. */
export const memberFileOtherZipSchema = z.enum(["opendocument", "numbers", "excel_binary", "other"]);
export type MemberFileOtherZip = z.infer<typeof memberFileOtherZipSchema>;

const PLAIN_REFUSAL_CODES = [
  "empty_file",
  "too_big",
  "old_excel_or_password",
  "pdf",
  "web_page_or_xml",
  "not_a_spreadsheet",
  "unsafe_archive",
  "unreadable_excel",
  "unreadable_text",
  "too_many_rows",
  "too_many_columns",
  "no_rows",
  "parse_timeout",
  "too_complex",
  "busy",
] as const;

export const memberFileRefusalSchema = z.discriminatedUnion("code", [
  z.object({ code: z.enum(PLAIN_REFUSAL_CODES) }),
  z.object({ code: z.literal("other_zip"), archive: memberFileOtherZipSchema }),
  /** The column staff chose as the status holds too many different words
   *  to be one (§9.5). `column` is its place in the sheet, counting from 0. */
  z.object({ code: z.literal("mapped_column_not_status"), column: z.number().int().min(0) }),
  /** `row` counts records from the top as the gym's spreadsheet shows them. */
  z.object({ code: z.literal("unterminated_quote"), row: z.number().int().positive() }),
]);
export type MemberFileRefusal = z.infer<typeof memberFileRefusalSchema>;
export type MemberFileRefusalCode = MemberFileRefusal["code"];

export const memberFileRefusedSchema = z.object({ ok: z.literal(false), refusal: memberFileRefusalSchema });
export type MemberFileRefused = z.infer<typeof memberFileRefusedSchema>;

/** What opening a file gives: its grid, or one refusal. */
export const memberFileResultSchema = z.discriminatedUnion("ok", [memberFileGridSchema, memberFileRefusedSchema]);
export type MemberFileResult = z.infer<typeof memberFileResultSchema>;

const SAVE_AS_XLSX_OR_CSV = "choose File → Save As → Excel Workbook (.xlsx), or save it as CSV, and upload that.";

/** Each sentence is true of EVERY file that draws it — the server never sees a
 *  file's name (spec Part 3 §9.4), and one mark in the bytes can belong to more
 *  than one program (review of PR #85). */
const OTHER_ZIP_WORDS: Readonly<Record<MemberFileOtherZip, string>> = {
  opendocument:
    "This is an OpenDocument file, as LibreOffice and OpenOffice save. Open it there, choose File → Save As → Excel 2007-365 (.xlsx), or save it as CSV, and upload that.",
  numbers:
    "This is an Apple Numbers, Pages or Keynote file. If it is your member list in Numbers, choose File → Export To → Excel or CSV, and upload that.",
  excel_binary: `This is an Excel Binary Workbook (.xlsb). In Excel ${SAVE_AS_XLSX_OR_CSV}`,
  other: "This file is not a spreadsheet we can read. Upload your member list as a CSV or Excel (.xlsx) file.",
};

type PlainRefusalCode = (typeof PLAIN_REFUSAL_CODES)[number];
const PLAIN_WORDS: Readonly<Record<PlainRefusalCode, string>> = {
  empty_file: "This file is empty. Export your member list again and upload the new file.",
  too_big: "This file is over 5 MB. Save just the member sheet as CSV and try again.",
  old_excel_or_password:
    "This is an older Office file, such as an .xls, or a file with a password, which we can't open. In Excel choose File → Save As → Excel Workbook (.xlsx), with no password, or save it as CSV.",
  pdf: "This is a PDF. The member list has to be a spreadsheet: export it from your software as CSV or Excel (.xlsx) and upload that.",
  web_page_or_xml: `This file holds a web page or XML, not a spreadsheet we can read. If Excel opens it, ${SAVE_AS_XLSX_OR_CSV}`,
  not_a_spreadsheet: "This file is damaged or cut short. Export your member list again, as CSV or Excel (.xlsx), and upload the new file.",
  unsafe_archive:
    "This file is built in a way we can't open safely. If it is an Excel file, open it in Excel, save a fresh copy as .xlsx, and upload that.",
  unreadable_excel: `We couldn't read this Excel file. Open it in Excel, ${SAVE_AS_XLSX_OR_CSV}`,
  unreadable_text:
    "We couldn't read this file as a spreadsheet or as text. Upload your member list as a CSV or Excel (.xlsx) file; from Excel, “CSV UTF-8” keeps every letter.",
  too_many_rows:
    "This sheet is longer than we can read. A member list may hold 10,000 people: take out any blank rows between them, or split the file — one for each location, say — and upload again.",
  too_many_columns:
    "This sheet is more than 100 columns wide. Copy the columns your member list needs into a new sheet, and upload that.",
  no_rows: "This file has no people in it, only headings or empty rows. Export your member list again and upload the new file.",
  parse_timeout: "This file took too long to read. Save just the member sheet as CSV and upload that.",
  too_complex: "This file is too large or complex to read. Save just the member sheet as CSV and upload that.",
  busy: "Other files are being read right now. Try again in a minute.",
};

/** The sentence a refusal is shown with — the server's, printed as sent. */
export function memberFileRefusalWords(refusal: MemberFileRefusal): string {
  switch (refusal.code) {
    case "other_zip":
      return OTHER_ZIP_WORDS[refusal.archive];
    case "mapped_column_not_status":
      return `The column you chose as the status holds more than ${String(MEMBER_LIST_MAX_STATUS_WORDS)} different words, so it is not a status. Choose the column that says Active, Expired or Frozen, or leave the status out.`;
    case "unterminated_quote":
      return `Row ${String(refusal.row)} opens a quote mark (") that never closes, so the rest of the file can't be read. Fix that row in your spreadsheet, or save the file again from Excel or Google Sheets, and upload it.`;
    default:
      return PLAIN_WORDS[refusal.code];
  }
}

// ---------------------------------------------------------------------------
// 3a-ii, understanding the grid (§9.5): which row holds the headings, which
// column holds which field, and every row cleaned. What comes out is what the
// list keeps — a name, an email, a phone, a member number and the gym's own
// status word — plus the problems, in plain words a screen prints as sent.
// ---------------------------------------------------------------------------

/** How many of a column's written cells are looked at to see what it holds. */
export const MEMBER_LIST_VALUE_SAMPLE_CELLS = 200;
/** What a column headed "Email" must hold to be believed: this share of its
 *  looked-at cells shaped like an email (or, for phone, readable as one). */
export const MEMBER_LIST_HEADER_CONFIRM_SHARE = 0.6;
/** What a column with no usable heading must hold to be taken on its values
 *  alone. Higher, because nothing but the cells says what the column is. */
export const MEMBER_LIST_VALUES_ONLY_SHARE = 0.8;
/** A row's score as the heading row: this much for each known heading word. */
export const MEMBER_LIST_HEADER_WORD_SCORE = 2;
/** …and this much off for each cell that is somebody's email or phone, which a
 *  heading row never holds. */
export const MEMBER_LIST_HEADER_VALUE_PENALTY = 3;
/** The lowest score a row may have and still be the heading row. */
export const MEMBER_LIST_HEADER_LEAST_SCORE = 2;
/** More different words than this in a column and it is not a status column. */
export const MEMBER_LIST_MAX_STATUS_WORDS = 20;
/** An email or phone on more rows than this is the front desk's own, not a
 *  member's, and is dropped from every row that carries it. */
export const MEMBER_LIST_PLACEHOLDER_ROWS = 5;
/** …and this many of them are named in the warning's words. */
export const MEMBER_LIST_PLACEHOLDERS_SHOWN = 5;
/** How many skipped rows are listed with their row numbers and reasons. */
export const MEMBER_LIST_SKIPPED_SHOWN = 200;
/** The most columns one field may be read from. A list of "Email" and
 *  "Secondary email" is real; a sixth is a file nobody exported on purpose,
 *  and each one is another number to read on every one of ten thousand rows. */
export const MEMBER_LIST_MOST_COLUMNS_PER_FIELD = 5;

/** How many of a column's cells are shown beside its heading, so staff can see
 *  what the server is looking at. */
export const MEMBER_LIST_COLUMN_SAMPLES = 3;

/** The ONE shape a phone number is kept in: E.164, 7 to 15 digits, which is
 *  ITU-T E.164 itself and 3a-iii's column CHECK. The reader clamps to it and
 *  the row below refuses anything else, so a number the phone package calls
 *  "possible" but that no list could hold is never produced at all (review of
 *  PR #86: a German number with a long direct dial reads as 16 digits and
 *  Gibraltar's as 19, and one such cell failed the whole file's own contract). */
export const MEMBER_LIST_PHONE_E164 = /^\+[1-9][0-9]{6,14}$/;

/** The longest name kept; a longer one is cut. */
export const MEMBER_LIST_MAX_NAME_CHARS = 120;
/** Longer than this is not an address at all (RFC 5321) and is never parsed. */
export const MEMBER_LIST_MAX_EMAIL_CHARS = 254;
/** The longest member number kept; a longer one is dropped. */
export const MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS = 64;
/** The longest status word kept; a longer one is cut. */
export const MEMBER_LIST_MAX_STATUS_CHARS = 40;

/** How many of a gym's OWN columns are kept beside the standard fields, as that
 *  gym's extra fields (§11.1). Past this, the columns furthest to the right are
 *  left out and the preview says how many. */
export const MEMBER_LIST_MAX_EXTRA_FIELDS = 40;
/** The longest an extra field's cell is kept; a longer one is cut and counted
 *  (§11.1). A gym's own column may hold a paragraph of notes; ten thousand
 *  paragraphs are what this keeps out of one staged upload. */
export const MEMBER_LIST_MAX_EXTRA_CHARS = 500;
/** The longest extra field key and label kept. The key is what an entry's JSON
 *  document is written under; the label is the heading as the gym wrote it. */
export const MEMBER_LIST_MAX_FIELD_KEY_CHARS = 64;
export const MEMBER_LIST_MAX_FIELD_LABEL_CHARS = 80;
/** More different words than this in a column and it is not a membership type
 *  (§11.3) — it is a note or a date. Higher than the status cap: a gym may
 *  genuinely sell forty plans, and none of them is a state of membership. */
export const MEMBER_LIST_MAX_TYPE_WORDS = 60;
/** What share of a column's looked-at cells must carry a shape before the whole
 *  column is dropped for it (§11.2: "a column that is mostly such cells"). */
export const MEMBER_LIST_NEVER_KEEP_SHARE = 0.6;
/** What share of a column's looked-at cells must read as dates before it is
 *  believed to be a date column, once its heading has said it is one. */
export const MEMBER_LIST_DATE_SHARE = 0.6;

/** A plain calendar day, as every date on a member record is kept: no time and
 *  no time zone. A birthday is the same day in every country. */
export const MEMBER_LIST_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const memberListDaySchema = z.string().regex(MEMBER_LIST_DAY);

/** The things the list keeps, and the two ways a name is written. The five
 *  after `status` were added 2026-09-21 by Part 2 of the re-plan (§11.1): a
 *  management app's record holds what the gym's own software held. */
export const memberListFieldSchema = z.enum([
  "fullName",
  "firstName",
  "lastName",
  "email",
  "phone",
  "memberNumber",
  "status",
  "membershipType",
  "joinedOn",
  "endsOn",
  "paymentStatus",
  "dateOfBirth",
]);
export type MemberListField = z.infer<typeof memberListFieldSchema>;

/** The three fields read as a calendar day rather than kept as the gym's word. */
export const MEMBER_LIST_DATE_FIELDS = ["joinedOn", "endsOn", "dateOfBirth"] as const;
export type MemberListDateField = (typeof MEMBER_LIST_DATE_FIELDS)[number];

/** EACH KEPT FIELD IN PLAIN ENGLISH, because two things staff READ field names
 *  rather than count them: what an upload would change, field by field (§11.4), and
 *  which of their own corrections it is about to write over. A screen prints these as
 *  sent; it never writes its own (§9.9). */
export const MEMBER_LIST_FIELD_WORDS: Readonly<Record<MemberListField, string>> = {
  fullName: "name",
  firstName: "first name",
  lastName: "last name",
  email: "email address",
  phone: "phone number",
  memberNumber: "member number",
  status: "status",
  membershipType: "membership type",
  joinedOn: "join date",
  endsOn: "end or renewal date",
  paymentStatus: "payment status",
  dateOfBirth: "date of birth",
};

/** How one of the gym's OWN columns is named wherever a field NAME is wanted: this
 *  prefix and the catalogue key. A standard field is named by itself. */
export const MEMBER_LIST_EXTRA_FIELD_PREFIX = "extra:";

/** THE NAME OF ONE FIELD A MEMBER OF STAFF EDITED BY HAND (§11.4, §11.6) — a standard
 *  field by its own name, or one of the gym's own columns as `extra:<key>`.
 *
 *  **NAMES ONLY, NEVER VALUES, AND THAT IS THE WHOLE SHAPE OF IT.** What an entry
 *  remembers is THAT somebody corrected the phone number, never what they corrected
 *  it from: a third copy of a person's phone number, kept only to guard the second,
 *  is one more place it can leak from, and the guard does not need it — the file's
 *  value and the column's are both there to be compared. */
export const memberListEditedFieldSchema = z.union([
  memberListFieldSchema,
  z.string().regex(new RegExp(`^${MEMBER_LIST_EXTRA_FIELD_PREFIX}[a-z0-9_]{1,${String(MEMBER_LIST_MAX_FIELD_KEY_CHARS)}}$`)),
]);
export type MemberListEditedField = z.infer<typeof memberListEditedFieldSchema>;

/** The most field names one entry can remember: every standard field plus every one of
 *  the gym's own columns, so nothing unbounded reaches a reply or a row. */
export const MEMBER_LIST_MAX_EDITED_FIELDS = memberListFieldSchema.options.length + MEMBER_LIST_MAX_EXTRA_FIELDS;

/** Which way round a column's two-number dates are read. `dayFirst` is
 *  03/04/2026 → 3 April; `monthFirst` is 3 April → March 4. */
export const memberListDateOrderSchema = z.enum(["dayFirst", "monthFirst"]);
export type MemberListDateOrder = z.infer<typeof memberListDateOrderSchema>;

/** Why a column is never kept, whatever the gym or its staff want (§11.2). */
export const memberListNeverKeptReasonSchema = z.enum(["payment_card", "bank_details", "government_id", "password_or_pin", "medical"]);
export type MemberListNeverKeptReason = z.infer<typeof memberListNeverKeptReasonSchema>;

/** The sentence a dropped column is named with. It says what was seen and never
 *  what any cell held: the cells are gone before this is written. */
export const MEMBER_LIST_NEVER_KEPT_WORDS: Readonly<Record<MemberListNeverKeptReason, string>> = {
  payment_card: "Not kept: this looks like payment card numbers. We never store card details.",
  bank_details: "Not kept: this looks like bank account details. We never store them.",
  government_id: "Not kept: this looks like government ID numbers. We never store them.",
  password_or_pin: "Not kept: this looks like passwords, PINs or door codes. We never store them.",
  medical: "Not kept: this looks like medical or health notes. We never store health details.",
};

/** Why a column is believed to hold what it does:
 *  - `chosen`: staff said so, by sending their own mapping;
 *  - `remembered`: this gym's last confirmed upload had the same headings;
 *  - `header`: its heading is a known word AND its cells agree;
 *  - `values`: there was no usable heading and the cells alone decided. */
export const memberListConfidenceSchema = z.enum(["chosen", "remembered", "header", "values"]);
export type MemberListConfidence = z.infer<typeof memberListConfidenceSchema>;

const columnIndexSchema = z.number().int().min(0).max(MEMBER_FILE_MAX_COLUMNS - 1);

/** Which column holds what, by its place in the sheet counting from 0. Staff
 *  may send one of their own; then nothing is guessed. `headerRow` is required
 *  and null says "this file has no headings", which is a real answer.
 *  `email` and `phone` are lists IN ORDER: a row whose first one is empty or
 *  unreadable falls back to the next. */
export const memberListMappingSchema = z
  .object({
    sheet: z.number().int().min(0).max(MEMBER_FILE_MAX_ARCHIVE_ENTRIES).nullable().default(null),
    headerRow: z.number().int().min(0).max(MEMBER_FILE_MAX_SHEET_ROWS).nullable(),
    fullName: columnIndexSchema.nullable().default(null),
    firstName: columnIndexSchema.nullable().default(null),
    lastName: columnIndexSchema.nullable().default(null),
    email: z.array(columnIndexSchema).max(MEMBER_LIST_MOST_COLUMNS_PER_FIELD).default([]),
    phone: z.array(columnIndexSchema).max(MEMBER_LIST_MOST_COLUMNS_PER_FIELD).default([]),
    memberNumber: columnIndexSchema.nullable().default(null),
    status: columnIndexSchema.nullable().default(null),
    membershipType: columnIndexSchema.nullable().default(null),
    joinedOn: columnIndexSchema.nullable().default(null),
    endsOn: columnIndexSchema.nullable().default(null),
    paymentStatus: columnIndexSchema.nullable().default(null),
    dateOfBirth: columnIndexSchema.nullable().default(null),
    /** Columns staff chose not to keep at all (§11.3). Everything else that is
     *  not a standard field above becomes one of the gym's extra fields, so
     *  this is the only way to say "leave that column out". A column the server
     *  never keeps is not here — it cannot be switched either way. */
    dontKeep: z.array(columnIndexSchema).max(MEMBER_FILE_MAX_COLUMNS).default([]),
    /** Staff flipping a date column's reading (§11.3). A column not named here
     *  is read the way the file's own evidence, else the gym's country, says. */
    dateOrder: z
      .array(z.object({ column: columnIndexSchema, order: memberListDateOrderSchema }).strict())
      .max(MEMBER_FILE_MAX_COLUMNS)
      .default([]),
  })
  .strict();
export type MemberListMapping = z.infer<typeof memberListMappingSchema>;

/** One column as staff see it: its heading as written, up to three of its own
 *  cells, and what the server made of it. */
export const memberListColumnSchema = z.object({
  index: columnIndexSchema,
  header: z.string().nullable(),
  samples: z.array(z.string()).max(MEMBER_LIST_COLUMN_SAMPLES),
  guess: memberListFieldSchema.nullable(),
  confidence: memberListConfidenceSchema.nullable(),
  /** What the heading CLAIMED, before the column's own cells were looked at.
   *  A column with `headerSays` and no `guess` is one the server disbelieved —
   *  its cells disagreed with its heading, or it names somebody who is not the
   *  member — which is the one thing staff can act on (review of PR #86). */
  headerSays: memberListFieldSchema.nullable(),
  /** Why nothing of this column is kept (§11.2), or null where it is kept. Its
   *  `samples` are empty when this is set: the cells were dropped in the file
   *  reader and never crossed to the API at all. It cannot be switched back on. */
  neverKept: memberListNeverKeptReasonSchema.nullable(),
});
export type MemberListColumn = z.infer<typeof memberListColumnSchema>;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/** One person, cleaned. `row` is the spreadsheet's own row number, so a screen
 *  can say where a person came from. `identityKey` is what tells one row from
 *  another (§9.5): the name, email, phone and member number, NOT the status —
 *  so "Active" becoming "Expired" changes a person in place. */
export const memberListRowSchema = z.object({
  row: z.number().int().positive(),
  fullName: z.string().max(MEMBER_LIST_MAX_NAME_CHARS),
  email: z.string().max(MEMBER_LIST_MAX_EMAIL_CHARS).nullable(),
  phone: z.string().regex(MEMBER_LIST_PHONE_E164).nullable(),
  memberNumber: z.string().max(MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS).nullable(),
  status: z.string().max(MEMBER_LIST_MAX_STATUS_CHARS).nullable(),
  /** The gym's own word for what this person bought ("Gold"), never read as a
   *  state of membership and never worked out from a date (§11.1). */
  membershipType: z.string().max(MEMBER_LIST_MAX_STATUS_CHARS).nullable(),
  joinedOn: memberListDaySchema.nullable(),
  /** The day the membership ends or renews; WHICH of the two its heading said
   *  is `endsOnKind` on the file, because it is one answer for the column. */
  endsOn: memberListDaySchema.nullable(),
  paymentStatus: z.string().max(MEMBER_LIST_MAX_STATUS_CHARS).nullable(),
  dateOfBirth: memberListDaySchema.nullable(),
  /** This person's cells under the gym's OWN headings, IN THE ORDER of the
   *  file's `extraFields` — a list and not an object, so a heading is written
   *  once for the file instead of once for each of ten thousand people. An
   *  empty string is a cell the person left blank. */
  extra: z.array(z.string().max(MEMBER_LIST_MAX_EXTRA_CHARS)).max(MEMBER_LIST_MAX_EXTRA_FIELDS),
  identityKey: sha256Schema,
});
export type MemberListRow = z.infer<typeof memberListRowSchema>;

/** One of the gym's own columns, kept under the gym's own heading (§11.1). The
 *  `key` is what an entry's document is written under and never changes for a
 *  heading; the `label` is the heading as the gym wrote it. */
export const memberListExtraFieldSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(MEMBER_LIST_MAX_FIELD_KEY_CHARS)
      .regex(/^[a-z0-9_]+$/),
    label: z.string().max(MEMBER_LIST_MAX_FIELD_LABEL_CHARS),
    column: columnIndexSchema,
  })
  .strict();
export type MemberListExtraField = z.infer<typeof memberListExtraFieldSchema>;

/** ONE PERSON'S CELLS UNDER THE GYM'S OWN COLUMNS, as the record keeps them: the
 *  catalogue key to the cell (§11.1).
 *
 *  **IT IS PARSED ON THE WAY OUT OF THE DATABASE LIKE ANY OTHER OUTSIDE INPUT**, and
 *  here that is not ceremony: the rule compares this document against the file's cells
 *  to decide what CHANGED, so a document left half-shaped by a later migration or a
 *  hand-run statement would read as "every column of this person is different" and the
 *  upload would write over the lot. */
export const memberListExtraDocumentSchema = z
  .record(z.string().regex(/^[a-z0-9_]+$/).max(MEMBER_LIST_MAX_FIELD_KEY_CHARS), z.string().max(MEMBER_LIST_MAX_EXTRA_CHARS))
  // AND HOW MANY KEYS — the bound that could not be a CHECK on the table, because
  // counting a jsonb object's keys needs a set-returning function and a CHECK may hold
  // no subquery. The migration's note says the ceiling "holds by construction" since a
  // document is only ever written from the catalogue; this is the one place that can
  // actually check it, and it did not (round one, Low-3).
  .refine((document) => Object.keys(document).length <= MEMBER_LIST_MAX_EXTRA_FIELDS, {
    message: `a member record may hold at most ${String(MEMBER_LIST_MAX_EXTRA_FIELDS)} of the gym's own columns`,
  });
export type MemberListExtraDocument = z.infer<typeof memberListExtraDocumentSchema>;

/** How one date column was read, said back to staff so they can flip it
 *  (§11.3): "We read 03/04/2026 as 3 April 2026". */
export const memberListDateColumnSchema = z
  .object({
    column: columnIndexSchema,
    field: z.enum(MEMBER_LIST_DATE_FIELDS),
    order: memberListDateOrderSchema,
    /** Where the order came from: the file's own evidence (a cell whose first
     *  or second part is over 12), the gym's country, or staff's own switch.
     *  `none` is a column every cell of which said its own order — an ISO date
     *  or a written-out month — where nothing was decided at all. */
    from: z.enum(["file", "country", "chosen", "none"]),
    /** One cell of the column and what it was read as, so the reading can be
     *  checked by eye. Null where the column held no two-number date. */
    example: z.object({ raw: z.string().max(MEMBER_FILE_MAX_CELL_CHARS), read: memberListDaySchema }).strict().nullable(),
    /** Cells of the column that are no date at all. They are left empty and
     *  counted, never guessed (§11.3). */
    notRead: z.number().int().min(0),
  })
  .strict();
export type MemberListDateColumn = z.infer<typeof memberListDateColumnSchema>;


/** Why a row of the file is not a person on the list. */
export const memberListSkipReasonSchema = z.enum(["no_contact", "duplicate"]);
export type MemberListSkipReason = z.infer<typeof memberListSkipReasonSchema>;

export const memberListSkippedSchema = z.object({
  row: z.number().int().positive(),
  reason: memberListSkipReasonSchema,
});
export type MemberListSkipped = z.infer<typeof memberListSkippedSchema>;

/** The reason a skipped row is shown with. */
export const MEMBER_LIST_SKIP_WORDS: Readonly<Record<MemberListSkipReason, string>> = {
  no_contact: "No email address and no phone number, so nobody can be invited or matched.",
  duplicate: "The same person is on an earlier row of this file.",
};

const COUNTED_WARNINGS = [
  "question_marks_in_names",
  "garbled_names",
  "shortened_by_excel",
  "phones_need_country",
  "phones_unusual",
  "shared_emails",
  /** Cells of the gym's own columns that were longer than we keep (§11.1). */
  "cells_cut",
  /** Cells in a date column that are no date, left empty rather than guessed. */
  "dates_not_read",
  /** Cells dropped on their own because they are shaped like a payment card,
   *  wherever they sat (§11.2). The column around them is kept. */
  "card_cells_dropped",
] as const;
const PLAIN_WARNINGS = ["hidden_rows_or_columns", "encoding_guessed", "no_header_row"] as const;

/** What was noticed about the file as a whole (§9.5). Nothing here stops an
 *  upload; each one is a sentence staff can act on. */
export const memberListWarningSchema = z.discriminatedUnion("code", [
  z.object({ code: z.enum(PLAIN_WARNINGS) }),
  z.object({ code: z.enum(COUNTED_WARNINGS), rows: z.number().int().positive() }),
  z.object({ code: z.literal("other_sheets_ignored"), sheets: z.array(z.string()) }),
  z.object({ code: z.literal("placeholders"), rows: z.number().int().positive(), values: z.array(z.string()) }),
  /** A file wider than the extra fields a gym may hold (§11.1). The columns
   *  furthest to the right are left out, and this says how many. */
  z.object({ code: z.literal("extra_columns_left_out"), columns: z.number().int().positive() }),
  /** THE GYM ALREADY KEEPS AS MANY OF ITS OWN COLUMNS AS IT MAY (§11.1), so columns
   *  this file brings that the gym has never had are not kept.
   *
   *  **IT IS NOT `extra_columns_left_out` AND THE DIFFERENCE MATTERS TO STAFF.** That
   *  one is about THIS FILE being wider than we read, and moving a column left fixes
   *  it. This one is about the GYM's catalogue being full — every column already in it
   *  is kept as usual, and moving anything left changes nothing. The catalogue grows
   *  across uploads and a whole-list upload does not replace it, so a gym that has
   *  uploaded several differently-shaped exports can reach the ceiling with a file of
   *  five columns. It is worked out where the gym's own catalogue can be read, which
   *  is the request thread and not the file reader. */
  z.object({ code: z.literal("gym_fields_full"), columns: z.number().int().positive() }),
]);
export type MemberListWarning = z.infer<typeof memberListWarningSchema>;
export type MemberListWarningCode = MemberListWarning["code"];

/** What the server made of one file. `needsMapping` is true when it could not
 *  find an email or a phone column: the file is NOT refused — its columns and
 *  their cells go back so staff can say which is which (§9.9). */
export const memberListUnderstandingSchema = z.object({
  ok: z.literal(true),
  kind: z.enum(["xlsx", "csv"]),
  facts: memberFileFactsSchema,
  sheet: z.object({ index: z.number().int().min(0), name: z.string().nullable() }),
  headerRow: z.number().int().min(0).nullable(),
  /** The heading row's own fingerprint. The gym's next upload with the same one
   *  is mapped the same way without guessing again (`remembered`). */
  headerFingerprint: sha256Schema.nullable(),
  columns: z.array(memberListColumnSchema),
  mapping: memberListMappingSchema,
  needsMapping: z.boolean(),
  rows: z.array(memberListRowSchema),
  /** The gym's own columns, in the order the rows' `extra` lists carry them. */
  extraFields: z.array(memberListExtraFieldSchema).max(MEMBER_LIST_MAX_EXTRA_FIELDS),
  /** How each date column was read, and whether anything was left empty. */
  dateColumns: z.array(memberListDateColumnSchema),
  /** Whether the end-or-renewal column's own heading said "ends" or "renews",
   *  so a screen says "Renews 3 Oct" rather than guessing (§11.1). Null where
   *  there is no such column, or its heading said neither. */
  endsOnKind: z.enum(["ends", "renews"]).nullable(),
  counts: z.object({
    dataRows: z.number().int().min(0),
    kept: z.number().int().min(0),
    noContact: z.number().int().min(0),
    duplicates: z.number().int().min(0),
    withEmail: z.number().int().min(0),
    withPhone: z.number().int().min(0),
    withMemberNumber: z.number().int().min(0),
    withStatus: z.number().int().min(0),
    withMembershipType: z.number().int().min(0),
    withJoinedOn: z.number().int().min(0),
    withEndsOn: z.number().int().min(0),
    withPaymentStatus: z.number().int().min(0),
    withDateOfBirth: z.number().int().min(0),
  }),
  /** Every status word in the file, in the case it was first written in, with
   *  how many people carry it. The app attaches no meaning to any of them. */
  statuses: z.array(z.object({ label: z.string(), count: z.number().int().positive() })),
  /** The same, for the gym's own membership types and payment words (§11.1):
   *  each is a filter chip with its count, in the gym's own spelling. */
  membershipTypes: z.array(z.object({ label: z.string(), count: z.number().int().positive() })),
  paymentStatuses: z.array(z.object({ label: z.string(), count: z.number().int().positive() })),
  skipped: z.array(memberListSkippedSchema).max(MEMBER_LIST_SKIPPED_SHOWN),
  warnings: z.array(memberListWarningSchema),
});
export type MemberListUnderstanding = z.infer<typeof memberListUnderstandingSchema>;

/** Understanding a file gives what it holds, or one refusal — the same
 *  refusals opening it can give, so a route has one vocabulary. */
export const memberListUnderstandResultSchema = z.discriminatedUnion("ok", [memberListUnderstandingSchema, memberFileRefusedSchema]);
export type MemberListUnderstandResult = z.infer<typeof memberListUnderstandResultSchema>;

const numberWords = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${String(n)} ${many}`);

/** The sentence a warning is shown with — the server's, printed as sent. */
export function memberListWarningWords(warning: MemberListWarning): string {
  switch (warning.code) {
    case "hidden_rows_or_columns":
      return "Some rows or columns in this file are hidden. They have been read, so anyone hidden is on the list too.";
    case "encoding_guessed":
      return "This file doesn't say how its letters were saved, so we read them the likeliest way. Check the names below; from Excel, “CSV UTF-8” keeps every letter.";
    case "no_header_row":
      return "This file has no row of headings, so each column was worked out from what is in it. Check the columns below before you confirm.";
    case "question_marks_in_names":
      return `${numberWords(warning.rows, "name holds", "names hold")} a “?” where a letter should be. The export lost those letters — from Excel, choose “CSV UTF-8” and export again.`;
    case "garbled_names":
      return `${numberWords(warning.rows, "name has", "names have")} letters that came out wrong, such as “H‚lŠne” for “Hélène”. The file was saved in an older alphabet — export it again as “CSV UTF-8”.`;
    case "shortened_by_excel":
      return `${numberWords(warning.rows, "row has", "rows have")} a number the spreadsheet shortened, such as 9.19877E+11, so its last digits are gone. We never guess them back: set that column to Text in your spreadsheet and export again.`;
    case "phones_need_country":
      return `${numberWords(warning.rows, "phone number was", "phone numbers were")} left out because this gym has no country set. Set the gym's country in Settings, or write the numbers with their country code, and upload again.`;
    case "phones_unusual":
      return `${numberWords(warning.rows, "phone number doesn't", "phone numbers don't")} look like a normal number for their country. They have been kept — check them before you invite anyone.`;
    case "shared_emails":
      return `${numberWords(warning.rows, "person shares", "people share")} an email address with someone else on the list, as a family often does. Everyone is kept.`;
    case "placeholders":
      return `The same contact details sit on more than ${String(MEMBER_LIST_PLACEHOLDER_ROWS)} rows, so they are the gym's own, not a member's: ${warning.values.join(", ")}. They were left out of ${numberWords(warning.rows, "row", "rows")}.`;
    case "other_sheets_ignored":
      return `This file has more than one sheet. Only the one with the members was read; these were ignored: ${warning.sheets.join(", ")}.`;
    case "cells_cut":
      return `${numberWords(warning.rows, "cell was", "cells were")} longer than ${String(MEMBER_LIST_MAX_EXTRA_CHARS)} characters and were cut to fit. The rest of each one is not kept.`;
    case "dates_not_read":
      return `${numberWords(warning.rows, "cell in a date column is", "cells in date columns are")} not a date, so they were left empty rather than guessed. Check the date columns below.`;
    case "card_cells_dropped":
      return `${numberWords(warning.rows, "cell was dropped because it is shaped like a payment card number", "cells were dropped because they are shaped like payment card numbers")}. We never store card details, wherever they sit in a file.`;
    case "extra_columns_left_out":
      return `This file has more of the gym's own columns than we keep. The ${String(warning.columns)} furthest to the right were left out; move the ones you need further left and upload again.`;
    case "gym_fields_full":
      return `Your gym already keeps ${String(MEMBER_LIST_MAX_EXTRA_FIELDS)} of its own columns, which is as many as we hold, so ${numberWords(warning.columns, "column in this file is", "columns in this file are")} not kept. Everything else in the file is kept as usual.`;
  }
}

// ── Out of 3a-iii: the gym's list on the server (§9.6–§9.9) ─────────────────
// An upload is STAGED and answered with a preview; nothing about the gym's
// people changes and nobody is emailed until staff confirm it (§9.2 rule 10).
// The words and numbers below are the ones the preview, the confirm and every
// later read all share, so a screen and the server cannot disagree about what a
// count means.

/** The most base64 characters a file's bytes can arrive as: `MEMBER_FILE_MAX_BYTES`
 *  encoded, which is four characters for every three bytes, rounded up to the
 *  next group of four. A body longer than this holds no file we would accept, so
 *  it is refused before anything is decoded. */
export const MEMBER_FILE_MAX_BASE64_CHARS = Math.ceil(MEMBER_FILE_MAX_BYTES / 3) * 4;

/** How long a staged upload lives before it is thrown away (§9.9). A preview is
 *  worked out against the list as it was, so it goes stale; an hour is long
 *  enough for staff to read the names behind the numbers, and short enough that
 *  the cells of a file nobody confirmed are not kept. */
export const MEMBER_LIST_UPLOAD_TTL_MINUTES = 60;

/** How many files ONE GYM has being read at a time, beside the two a server
 *  process (review of PR #85: two slow files held both places for every gym). */
export const MEMBER_LIST_PARSES_PER_GYM = 1;

/** A change is large when it is more than this MANY and more than this SHARE of
 *  what it is measured against (§9.8). A share alone is useless at 50 people and
 *  a count alone at 2,000, which is why identity products ship both (Okta's
 *  import safeguard 20 %, Microsoft Entra's 500 deletions, Okta's entitlement
 *  safeguard 10 % and 100). */
export const MEMBER_LIST_LARGE_CHANGE_LEAST = 10;
export const MEMBER_LIST_LARGE_CHANGE_SHARE = 0.1;

/** Whether taking `changing` off `of` is a large change: more than
 *  `max(10, 10 %)`. THE ONE RULE — the preview's numbers and the confirm's
 *  refusal both read it, so a screen can never promise what the server refuses.
 *  `of` is 0 for a gym with no list, where the most this allows is 10 and
 *  nothing can go anyway. */
export function isLargeMemberListChange(changing: number, of: number): boolean {
  return changing > Math.max(MEMBER_LIST_LARGE_CHANGE_LEAST, MEMBER_LIST_LARGE_CHANGE_SHARE * of);
}

/** More of the list than this coming off a whole-list upload is the likeliest
 *  wrong file — a list of new joiners exported instead of everybody — so the
 *  preview says so first and offers "add these people instead" (§9.8). */
export const MEMBER_LIST_MOST_OF_LIST_SHARE = 0.5;

/** How many names one page of the preview's rows holds. */
export const MEMBER_LIST_ROWS_PAGE = 100;

/** What an upload says it is: the gym's WHOLE list, or people to ADD to it. An
 *  add takes nobody off and flags nobody, which is what makes it the safe answer
 *  to a wrong file. */
export const memberListModeSchema = z.enum(["whole_list", "add"]);
export type MemberListMode = z.infer<typeof memberListModeSchema>;

/** Where a staged upload has got to. `superseded` is the gym's earlier staged
 *  upload once a newer one arrives; `expired` is one nobody confirmed in time. */
export const memberListUploadStatusSchema = z.enum(["staged", "confirmed", "superseded", "expired"]);
export type MemberListUploadStatus = z.infer<typeof memberListUploadStatusSchema>;

/** How somebody came to be on the list: out of a file, typed in by staff
 *  (3a-iv), or copied from an app member who joined by code (3a-iv). */
export const memberListEntrySourceSchema = z.enum(["upload", "typed", "member"]);
export type MemberListEntrySource = z.infer<typeof memberListEntrySourceSchema>;

/** Which people a preview's names are asked for. `members_leaving` is not a
 *  group of the file at all — it is this gym's own app members who would be
 *  marked "no longer listed" — and it is here because it is the one staff most
 *  need to read before they confirm anything. */
export const memberListRowGroupSchema = z.enum(["new", "changed", "unchanged", "gone", "members_leaving"]);
export type MemberListRowGroup = z.infer<typeof memberListRowGroupSchema>;

/** What an upload would do to the list (§9.7). `new`, `changed`, `unchanged` and
 *  `gone` are told apart by the identity key, so a person whose status went from
 *  "Active" to "Expired" is CHANGED and not one person gone and another arrived.
 *  The three under `new` split it up: already in the app · could be invited (has
 *  an email and is not in the app) · no email, so nobody can be invited.
 *  An upload in `add` mode never has any `gone`. */
export const memberListChangeCountsSchema = z.object({
  new: z.number().int().min(0),
  changed: z.number().int().min(0),
  unchanged: z.number().int().min(0),
  gone: z.number().int().min(0),
  alreadyInApp: z.number().int().min(0),
  canBeInvited: z.number().int().min(0),
  noEmail: z.number().int().min(0),
  /** OF THE `new`, HOW MANY THE GYM HAS HAD BEFORE — a FORMER record coming back
   *  (§11.1). Since 3a-v-b nobody is deleted from a list: somebody who drops off one
   *  becomes former with the date, and uploading them again revives that same record
   *  with whatever hangs on it. They are `new` to the list as it stands, which is what
   *  staff are deciding about, and this says how many of them are not new to the gym.
   *
   *  It is a SLICE of `new` and not a group beside it, so no test may add the two. */
  returning: z.number().int().min(0).default(0),
});
export type MemberListChangeCounts = z.infer<typeof memberListChangeCountsSchema>;

/** WHAT AN UPLOAD WOULD CHANGE, FIELD BY FIELD (§11.4) — one row per kept field, with
 *  how many people's records it would move.
 *
 *  **`changed` ON ITS OWN STOPPED BEING AN ANSWER THE DAY THE ROW GOT WIDER.** Before
 *  3a-v-b the only thing that could differ was the status word, so "412 changed" said
 *  what would happen. Now a record holds ten fields and the gym's own columns beside
 *  them, and "412 changed" could be 412 corrected phone numbers or 412 dates read the
 *  wrong way round off one badly-ordered column — which is exactly the mistake §11.3's
 *  date switch exists to catch, and the count that would have hidden it. */
export const memberListFieldChangeSchema = z
  .object({ field: memberListFieldSchema, count: z.number().int().positive() })
  .strict();
export type MemberListFieldChange = z.infer<typeof memberListFieldChangeSchema>;

/** The same, for one of the gym's OWN columns, named by the heading the gym wrote. */
export const memberListExtraChangeSchema = z
  .object({
    key: z.string().max(MEMBER_LIST_MAX_FIELD_KEY_CHARS),
    label: z.string().max(MEMBER_LIST_MAX_FIELD_LABEL_CHARS),
    count: z.number().int().positive(),
  })
  .strict();
export type MemberListExtraChange = z.infer<typeof memberListExtraChangeSchema>;

/** WHICH OF STAFF'S OWN CORRECTIONS AN UPLOAD WOULD WRITE OVER (§11.4) — the refusal's
 *  numbers, and the one thing a screen needs to ask the question with.
 *
 *  `fields` is field NAMES in plain English, already the words a screen prints, and
 *  never a value and never a person: "3 people's phone number and membership type
 *  would be replaced by this file" is the whole sentence, and naming the people would
 *  put a page of addresses inside an error reply (§9.9). */
export const memberListHandEditsSchema = z
  .object({
    entries: z.number().int().min(0),
    fields: z.array(z.string().max(MEMBER_LIST_MAX_FIELD_LABEL_CHARS)).max(MEMBER_LIST_MAX_EDITED_FIELDS),
  })
  .strict();
export type MemberListHandEdits = z.infer<typeof memberListHandEditsSchema>;

/** One of the gym's own status words, with what the upload does to the people
 *  carrying it. The app attaches no meaning to the word itself. */
export const memberListStatusChangeSchema = z.object({
  label: z.string(),
  count: z.number().int().min(0),
  new: z.number().int().min(0),
  changed: z.number().int().min(0),
  unchanged: z.number().int().min(0),
  gone: z.number().int().min(0),
});
export type MemberListStatusChange = z.infer<typeof memberListStatusChangeSchema>;

/** The gym's own app members against this upload. `listedNow` is how many of
 *  them the list being replaced holds, which is what `leaving` is measured
 *  against (§9.8). Neither number is ever a name. */
export const memberListMembersSchema = z.object({
  leaving: z.number().int().min(0),
  listedNow: z.number().int().min(0),
});
export type MemberListMembers = z.infer<typeof memberListMembersSchema>;

/** The wrong-file guard's own numbers, worked out for the preview and worked out
 *  AGAIN under the lock when anybody confirms (§9.8). `needsTick` true means the
 *  confirm refuses unless that one request carries the tick.
 *  `mostOfListWouldGo` is the preview's louder warning: more than half the list
 *  coming off, where the answer is usually "add these people instead". */
export const memberListGuardSchema = z.object({
  entriesGoing: z.number().int().min(0),
  listSize: z.number().int().min(0),
  membersLeaving: z.number().int().min(0),
  membersListedNow: z.number().int().min(0),
  needsTick: z.boolean(),
  mostOfListWouldGo: z.boolean(),
});
export type MemberListGuard = z.infer<typeof memberListGuardSchema>;

/** Where the gym stands on its plan's seats, so staff can see before they invite
 *  anybody that the list may be bigger than the gym can admit. `cap` is null
 *  when nothing caps it. Nothing here refuses an upload: a list may be longer
 *  than the seats, because being on a gym's list is not holding a seat. */
export const memberListSeatSchema = z.object({
  cap: z.number().int().min(0).nullable(),
  liveMembers: z.number().int().min(0),
  listSize: z.number().int().min(0),
});
export type MemberListSeat = z.infer<typeof memberListSeatSchema>;

/** THE PREVIEW — what an upload WOULD do, and the only answer the upload route
 *  gives. Everything in it is a count, a column's own heading with three of its
 *  cells, or a sentence; the people themselves are read one page at a time from
 *  the rows route, so a screen shows a number before it shows anybody's address.
 *
 *  `needsMapping` true means no email and no phone column could be found: the
 *  file is NOT refused (§9.9) — the columns and their cells come back so staff
 *  can say which is which, and the list counts are all zero because no person
 *  could be read out of it. */
export const memberListPreviewSchema = z.object({
  uploadId: z.string().uuid(),
  mode: memberListModeSchema,
  expiresAt: z.string(),
  /** The gym's last CONFIRMED upload was byte for byte this file. Confirming it
   *  again writes nothing, and the screen can say so. */
  sameAsLastUpload: z.boolean(),
  kind: z.enum(["xlsx", "csv"]),
  facts: memberFileFactsSchema,
  sheet: z.object({ index: z.number().int().min(0), name: z.string().nullable() }),
  headerRow: z.number().int().min(0).nullable(),
  columns: z.array(memberListColumnSchema),
  mapping: memberListMappingSchema,
  needsMapping: z.boolean(),
  /** What the FILE held, as understanding it counted (§9.5). */
  file: memberListUnderstandingSchema.shape.counts,
  /** What it would do to the LIST. */
  list: memberListChangeCountsSchema,
  statuses: z.array(memberListStatusChangeSchema),
  /** Field by field, what the `changed` people's records would move (§11.4). Only
   *  fields something would actually change appear. */
  fieldChanges: z.array(memberListFieldChangeSchema).max(memberListFieldSchema.options.length).default([]),
  extraChanges: z.array(memberListExtraChangeSchema).max(MEMBER_LIST_MAX_EXTRA_FIELDS).default([]),
  /** Staff's own corrections this file would write over (§11.4). `entries: 0` means
   *  none, and the confirm needs no tick for them. */
  handEdits: memberListHandEditsSchema.default({ entries: 0, fields: [] }),
  members: memberListMembersSchema,
  skipped: z.array(memberListSkippedSchema).max(MEMBER_LIST_SKIPPED_SHOWN),
  warnings: z.array(memberListWarningSchema),
  seat: memberListSeatSchema,
  guard: memberListGuardSchema,
});
export type MemberListPreview = z.infer<typeof memberListPreviewSchema>;

/** One person on a preview's page of names, and where they came from. A row of
 *  the FILE carries its own row number; a member who would be marked "no longer
 *  listed" is not in the file at all, so `row` is null for them. */
export const memberListPreviewPersonSchema = z.object({
  row: z.number().int().positive().nullable(),
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  memberNumber: z.string().nullable(),
  status: z.string().nullable(),
  /** The status this person carries on the list TODAY, for a `changed` row; null
   *  everywhere else, so a screen can print "Active → Frozen" without asking
   *  twice. */
  wasStatus: z.string().nullable(),
  inApp: z.boolean(),
});
export type MemberListPreviewPerson = z.infer<typeof memberListPreviewPersonSchema>;

/** One page of the names behind a preview's numbers, before anybody confirms. */
export const memberListRowsPageSchema = z.object({
  group: memberListRowGroupSchema,
  total: z.number().int().min(0),
  people: z.array(memberListPreviewPersonSchema).max(MEMBER_LIST_ROWS_PAGE),
  /** Where the next page starts, or null at the end. */
  cursor: z.number().int().min(0).nullable(),
});
export type MemberListRowsPage = z.infer<typeof memberListRowsPageSchema>;

/** WHAT THE SERVER UNDERSTOOD OF A STAGED UPLOAD'S FILE, held in one document
 *  that is thrown away the moment the upload is confirmed, superseded or expired
 *  (§9.6: `rows` becomes NULL).
 *
 *  **IT IS THE WHOLE UNDERSTANDING, NOT ONLY THE ROWS, AND THAT IS WIDER THAN
 *  §9.6's COLUMN NAME SUGGESTS** — on purpose. Everything a file's own cells can
 *  reach goes in one place and leaves in one statement: the rows, the columns with
 *  three of their cells each, the warnings (two of which quote a cell's words — a
 *  shared front-desk address, an ignored sheet's name), and the file's own facts.
 *  Split across two columns, the day somebody adds a field to one of them is the
 *  day a member's address outlives the file it came from, and nothing would say
 *  so. The upload's `summary` is what survives, and it is counts.
 *
 *  It is parsed on the way back out of the database like any other outside input:
 *  our own write today is a document some later migration or hand-run statement
 *  could leave half-shaped, and a preview built on an unparsed document is a
 *  screen showing something false. */
/** WHICH PEOPLE FELL INTO WHICH GROUP, worked out ONCE when the file was staged.
 *
 *  **THIS IS WHAT STOPS A PAGE OF NAMES COSTING THE WHOLE FILE.** Without it, showing
 *  a hundred names meant reading every row back out of the database, checking it
 *  against every person already on the list, and then throwing all but a hundred away
 *  — measured at 33 seconds of work, and 12 seconds of the server answering nobody,
 *  to look through one ten-thousand-person gym. With it, a page is a hundred rows cut
 *  out of the stored file by the database itself.
 *
 *  **TWO SHAPES, because the groups are two different things.** `new`, `changed` and
 *  `unchanged` are people IN the file, so they are kept as their places in `rows`
 *  (counting from 0) — a number each, not a second copy of everybody. `gone` and
 *  `gone` is somebody the file does NOT hold — a person coming off the list —
 *  so there is nothing to point at and they are kept as they will be shown.
 *
 *  **THE GYM'S OWN APP MEMBERS ARE NOT IN HERE AT ALL** (review of PR #87, High-1 and
 *  High-2). Who would be marked as having dropped off is worked out on every read: it
 *  is an answer about members, so storing it both went stale and put a member's own
 *  name, PROVED email address and phone number into a table the Day-14 purge does not
 *  touch and a person's own export does not carry.
 *
 *  **IT IS AS FRESH AS THE PREVIEW IT BELONGS TO, AND NO FRESHER.** It was worked out
 *  against the list at `base_version`; if the list has moved since, the whole preview
 *  is stale and is worked out again from the rows (9.7's rule, unchanged). So this is
 *  not a cache that can be wrong — it is the answer, with the version it is the answer
 *  for stored beside it. */
/** One person of the FILE in a group: where they sit in `rows`, plus the one thing the
 *  row itself cannot say — what the list said about them before, so a screen can print
 *  "Active → Frozen".
 *
 *  **`inApp` IS NOT HERE, AND THAT IS THE WHOLE POINT** (review of PR #87, High-1).
 *  Whether somebody is already in the app is a fact about one of the GYM's OWN MEMBERS,
 *  and nothing a gym does to its list moves when a member joins, proves their address
 *  or leaves. Stored, it went stale the moment somebody signed up — and staff read
 *  "Amara Okafor, not in the app" for the preview's whole hour while she was, which is
 *  exactly the burst RULINGS 2026-09-20 describes. So no fact about a member is ever
 *  stored: every one of them is worked out again on every read, which cannot go stale
 *  by construction, where a longer freshness check could miss a case and go quiet. */
const memberListGroupedRowSchema = z
  .object({ at: z.number().int().min(0), wasStatus: z.string().nullable() })
  .strict();

/** Somebody the gym's list holds who is not in the file — stored as the GYM's own
 *  record of them, which is what the list is. `inApp` is filled in on every read, for
 *  the reason above. */
export const memberListStoredPersonSchema = memberListPreviewPersonSchema.omit({ inApp: true });
export type MemberListStoredPerson = z.infer<typeof memberListStoredPersonSchema>;

export const memberListGroupsSchema = z
  .object({
    new: z.array(memberListGroupedRowSchema),
    changed: z.array(memberListGroupedRowSchema),
    unchanged: z.array(memberListGroupedRowSchema),
    gone: z.array(memberListStoredPersonSchema),
  })
  .strict();
export type MemberListGroups = z.infer<typeof memberListGroupsSchema>;

/** EVERYTHING THE SERVER UNDERSTOOD OF A STAGED FILE EXCEPT THE ROWS. A preview is
 *  built from this, and it stays small whatever the file holds — at most a hundred
 *  columns of three sample cells each, two hundred skipped rows and a few warnings —
 *  so showing a gym what its file would do never costs reading ten thousand people
 *  back out of the database. */
export const memberListStagedShellSchema = memberListUnderstandingSchema.omit({ rows: true });
export type MemberListStagedShell = z.infer<typeof memberListStagedShellSchema>;

export const memberListStagedFileSchema = z
  .object({ understanding: memberListUnderstandingSchema, groups: memberListGroupsSchema })
  .strict();
export type MemberListStagedFile = z.infer<typeof memberListStagedFileSchema>;

/** THE COUNTS OF AN UPLOAD, kept for the record after its cells have gone
 *  (§9.6: `summary`, counts only — never a name, an address or a number). The
 *  gym's own status WORDS are here, because "Active" and "Frozen" say nothing
 *  about any one person and a confirmed upload's record is unreadable without
 *  them. */
export const memberListUploadSummarySchema = z
  .object({
    file: memberListUnderstandingSchema.shape.counts,
    list: memberListChangeCountsSchema,
    statuses: z.array(memberListStatusChangeSchema),
    /** The field-by-field breakdown and the hand edits, kept for the record with
     *  everything else here — counts and field NAMES, never a value (§11.4). The
     *  three carry `.default(…)` so a summary written before 3a-v-b still parses:
     *  this document is read back out of the database on every look at a confirmed
     *  upload, and a shape that refuses last month's row would make the record
     *  unreadable rather than out of date. */
    fieldChanges: z.array(memberListFieldChangeSchema).max(memberListFieldSchema.options.length).default([]),
    extraChanges: z.array(memberListExtraChangeSchema).max(MEMBER_LIST_MAX_EXTRA_FIELDS).default([]),
    handEdits: memberListHandEditsSchema.default({ entries: 0, fields: [] }),
    members: memberListMembersSchema,
    guard: memberListGuardSchema,
    needsMapping: z.boolean(),
    /** Where the gym stood on seats when the file was read. Counts, like everything
     *  else here. It is kept so that reading a preview back does not have to fetch
     *  every member again just to say "42 of 500 seats": the seat rule lives in one
     *  place (`repo.listMembers`) and a second copy of it in a COUNT would be a
     *  second answer to "who costs this gym money". */
    seat: memberListSeatSchema,
  })
  .strict();
export type MemberListUploadSummary = z.infer<typeof memberListUploadSummarySchema>;

/** Why a staged upload cannot be read or confirmed any more. Each is the
 *  SERVER'S sentence, printed as sent (§9.9), and each says what to do. */
export const memberListUploadGoneSchema = z.enum(["upload_expired", "upload_superseded", "upload_already_confirmed"]);
export type MemberListUploadGone = z.infer<typeof memberListUploadGoneSchema>;

export const MEMBER_LIST_UPLOAD_GONE_WORDS: Readonly<Record<MemberListUploadGone, string>> = {
  upload_expired: "This preview has expired, so nothing was changed. Upload the file again to see it fresh.",
  upload_superseded: "A newer file has been uploaded for this gym, so this preview is out of date. Use the newest one.",
  upload_already_confirmed: "This file has already been applied to the list, so there is nothing left to confirm.",
};

// ── The routes' own shapes (§9.9) ───────────────────────────────────────────

/** UPLOAD A FILE. `contentBase64` is the file's bytes; staff may paste rows
 *  copied out of a spreadsheet instead (RULINGS 2026-09-20), which arrive as
 *  tab-separated text and are read by the same reader, so this needs nothing of
 *  its own for them.
 *
 *  The length ceiling is the file limit encoded, checked before anything is
 *  decoded: a body longer than this cannot hold a file we would accept, and
 *  refusing it on its length costs nothing.
 *
 *  `mapping` is staff saying which column is which. Sent, NOTHING is guessed
 *  (§9.5) — which is the answer for a gym whose headings are in another language,
 *  or in no row at all. */
export const memberListUploadRequestSchema = z
  .object({
    contentBase64: z.string().min(1).max(MEMBER_FILE_MAX_BASE64_CHARS),
    mode: memberListModeSchema,
    mapping: memberListMappingSchema.optional(),
  })
  .strict();
export type MemberListUploadRequest = z.infer<typeof memberListUploadRequestSchema>;

export const memberListPreviewResponseSchema = z.object({ preview: memberListPreviewSchema });
export type MemberListPreviewResponse = z.infer<typeof memberListPreviewResponseSchema>;

/** WHICH NAMES, AND FROM WHERE. `cursor` is an offset into the group, and it is a
 *  STRING on the wire parsed into a number, never coerced from one (trap #5): a
 *  query parameter is text, and `z.coerce.number()` would read "" as 0 and
 *  "1e3" as 1,000. Its ceiling is one digit past the longest list allowed, so no
 *  cursor can be a number nothing could index. */
export const memberListRowsQuerySchema = z
  .object({
    group: memberListRowGroupSchema,
    cursor: z
      .string()
      .regex(/^(?:0|[1-9][0-9]{0,4})$/)
      .transform(Number)
      .optional(),
  })
  .strict();
export type MemberListRowsQuery = z.infer<typeof memberListRowsQuerySchema>;

export const memberListRowsResponseSchema = z.object({ page: memberListRowsPageSchema });
export type MemberListRowsResponse = z.infer<typeof memberListRowsResponseSchema>;

// ── Pressing Confirm, and the list you keep (3a-iii-b; §9.7–§9.9) ───────────

/** CONFIRM THIS UPLOAD. Both fields are ticks, and both are asked for ON THAT
 *  REQUEST (§9.8, §11.4): a gym that acknowledged a large change or a lost correction
 *  an hour ago has acknowledged nothing about this press. Absent is the same as
 *  false — so a screen that forgets to send one cannot apply it.
 *
 *  **THEY ARE TWO TICKS AND NOT ONE, because they are two different questions.** "More
 *  of your list would come off than we apply without asking" is about the FILE being
 *  the wrong file; "this would replace corrections your own staff typed in" is about
 *  the file being right and somebody's work being lost anyway. A screen that asked
 *  them together would let a yes to either stand for a yes to both. */
export const memberListConfirmRequestSchema = z
  .object({ acknowledgeLargeChange: z.boolean().optional(), acknowledgeHandEdits: z.boolean().optional() })
  .strict();
export type MemberListConfirmRequest = z.infer<typeof memberListConfirmRequestSchema>;

/** WHAT PRESSING CONFIRM DID.
 *
 *  **`applied` IS WHAT WAS APPLIED, NOT WHAT THE PREVIEW PROMISED.** The rule is
 *  worked out AGAIN under the gym's lock, on the list as it is at that instant, and
 *  these are that answer's numbers — which is also what the upload's own record
 *  keeps, so pressing Confirm twice reads back the same sentence rather than a
 *  second, different story about one file.
 *
 *  **`alreadyConfirmed` true means THIS PRESS CHANGED NOTHING** because the upload
 *  was already applied. It is a 200 and not a refusal: two staff pressing one
 *  button, or a screen retrying after the reply was lost, is not an error and must
 *  not read like one.
 *
 *  `version` is the list's version NOW, which is what a later removal has to name
 *  (3a-iv), so it is read live rather than stored. `confirmedAt` is THIS upload's
 *  own instant and never a later upload's. */
export const memberListConfirmedSchema = z.object({
  uploadId: z.string().uuid(),
  alreadyConfirmed: z.boolean(),
  version: z.number().int().min(0),
  confirmedAt: z.string(),
  applied: memberListChangeCountsSchema,
  statuses: z.array(memberListStatusChangeSchema),
  members: memberListMembersSchema,
});
export type MemberListConfirmed = z.infer<typeof memberListConfirmedSchema>;

export const memberListConfirmResponseSchema = z.object({ confirmed: memberListConfirmedSchema });
export type MemberListConfirmResponse = z.infer<typeof memberListConfirmResponseSchema>;

/** THE THREE REFUSALS THAT CARRY NUMBERS, and why they are not sentences alone.
 *
 *  Each means "we did NOT do that, and here is what we saw", and a screen cannot ask
 *  the right question without the figures: a large change has to show staff what
 *  would go before it asks them to tick, a changed list has to say which version it
 *  measured against and which it found, or "somebody changed it" is a dead end, and a
 *  lost correction has to name the FIELDS or "your edits would be replaced" tells
 *  nobody whether it matters. Every other refusal in this module is a sentence alone,
 *  because there is nothing to show. None carries anything about a PERSON — a version
 *  is the gym's own list's, the guard is counts, and the hand edits are field names. */
export const MEMBER_LIST_CONFIRM_REFUSAL_WORDS = {
  list_changed:
    "Your list changed while you were looking at this preview, so nothing was applied. Upload the file again to see what it would do now.",
  large_change:
    "This would change more of your list than we apply without asking. Check the numbers below, then confirm again to go ahead.",
  hand_edits:
    "This file would replace details your staff typed in here. Check the fields below, then confirm again to let the file win.",
} as const;

export const memberListHandEditsRefusalSchema = z.object({
  error: z.literal("hand_edits"),
  message: z.string(),
  handEdits: memberListHandEditsSchema,
  requestId: z.string().optional(),
});

export const memberListListChangedSchema = z.object({
  error: z.literal("list_changed"),
  message: z.string(),
  /** The version the preview was worked out against, and the one the list is on now. */
  baseVersion: z.number().int().min(0),
  version: z.number().int().min(0),
});

export const memberListLargeChangeSchema = z.object({
  error: z.literal("large_change"),
  message: z.string(),
  guard: memberListGuardSchema,
});

/** WHAT THE GYM'S LIST HOLDS — for the whole list, and for each of its own status
 *  words. `inApp` is how many of those people are already members here;
 *  `canBeInvited` is how many have an email address and are not.
 *
 *  **THE THREE DO NOT PARTITION AND MUST NOT BE MADE TO**, which is `inviteCounts`'
 *  own rule and holds here for the same reason: somebody already in the app whose
 *  entry carries no address is counted under `inApp` AND under `noEmail`, because
 *  both sentences are true of them. No test may assert that they sum to `entries`. */
export const memberListCountsSchema = z.object({
  entries: z.number().int().min(0),
  inApp: z.number().int().min(0),
  canBeInvited: z.number().int().min(0),
  noEmail: z.number().int().min(0),
  /** HOW MANY FORMER RECORDS THE GYM HOLDS (§11.1) — people it has had and has taken
   *  off, kept so that their visits, reports and a return survive.
   *
   *  **IT IS NOT PART OF ANY OTHER NUMBER HERE**, and that is the point of it being
   *  its own line: `entries`, `inApp`, `canBeInvited` and `noEmail` are all about the
   *  list as it STANDS, which is what every screen and every invite means by the list.
   *  A former record admits nobody and is invited by nothing, so counting one under
   *  `canBeInvited` would be an ex-member offered a way back in by a number. */
  former: z.number().int().min(0).default(0),
});
export type MemberListCounts = z.infer<typeof memberListCountsSchema>;

/** One of the gym's own status words on the list it keeps, with the same numbers —
 *  the filter chips of item 5's screen ("Active 312 · Frozen 88"), each able to say
 *  how many people it could reach before anybody presses anything.
 *
 *  `label` is the gym's own spelling, and "" is the people with no status at all —
 *  the same empty label `GET /entries` reads as "no status" (§9.9). */
export const memberListStatusCountSchema = z.object({
  label: z.string(),
  count: z.number().int().min(0),
  inApp: z.number().int().min(0),
  canBeInvited: z.number().int().min(0),
});
export type MemberListStatusCount = z.infer<typeof memberListStatusCountSchema>;

/** THE MOST STATUS CHIPS ONE LIST CAN ANSWER WITH, and the reason it needs saying.
 *
 *  A FILE may hold `MEMBER_LIST_MAX_STATUS_WORDS` different words and no more, or the column is
 *  not a status at all (§9.5). **A LIST is not a file**: a whole-list upload replaces
 *  it, but an `add` keeps everyone already on it, so words accumulate across uploads,
 *  and 3a-iv types them in one at a time. Nothing bounded that, so the reply grew with
 *  the gym's history — up to one chip per person in the worst case (review of PR #88,
 *  Low-5).
 *
 *  Ten times the per-file rule, so no gym using status words as status words is ever
 *  cut: this is a ceiling on an unbounded reply, not a limit anybody should meet. The
 *  read LIMITs to it, and the chips come back in the list's own order, so what a gym
 *  past the ceiling loses is its rarest words and never a count of PEOPLE.
 *
 *  **`counts` IS THE WHOLE LIST AND THE CAP DOES NOT REACH IT** — summed inside the
 *  same statement, BEFORE the cut, which is not what the first version of this did.
 *  It added the capped rows up, so a gym past the ceiling read "200 people" above a
 *  list of 205 and `canBeInvited` was short by the truncated groups (review of PR
 *  #88, High-3). There is no second statement to disagree with: one query answers the
 *  header and the chips, which is the whole reason it is one query. */
export const MEMBER_LIST_STATUS_CHIPS_MAX = 200;

/** THE LIST AS IT STANDS. A gym that has never confirmed one answers `hasList:
 *  false` with everything at zero rather than a 404: "you have no list yet" is a
 *  screen, and a missing route is not. */
export const memberListViewSchema = z.object({
  hasList: z.boolean(),
  version: z.number().int().min(0),
  lastConfirmedAt: z.string().nullable(),
  counts: memberListCountsSchema,
  statuses: z.array(memberListStatusCountSchema).max(MEMBER_LIST_STATUS_CHIPS_MAX),
  /** THE GYM'S OWN MEMBERSHIP AND PAYMENT WORDS, as chips with the same numbers
   *  (§11.1). Three kinds of word, one shape, one cap and one rule for all three: the
   *  app attaches no meaning to any of them, shows each in the spelling the list wrote
   *  first, and folds case and spaces when it compares. A payment word is never read
   *  as a state of membership and neither is ever worked out from a date (§11.1).
   *
   *  **THEY COUNT THE LIST AS IT STANDS AND LEAVE THE FORMER RECORDS OUT**, like every
   *  other number beside them: a chip is something staff click to act on people, and a
   *  chip whose count included people the gym has taken off would offer an ex-member
   *  up for an invite. */
  membershipTypes: z.array(memberListStatusCountSchema).max(MEMBER_LIST_STATUS_CHIPS_MAX).default([]),
  paymentStatuses: z.array(memberListStatusCountSchema).max(MEMBER_LIST_STATUS_CHIPS_MAX).default([]),
  /** The gym's own columns, in the order they were first seen, so the person's page
   *  (3a-iv) and item 5's screen show them in the gym's own order and under the gym's
   *  own heading. At most `MEMBER_LIST_MAX_EXTRA_FIELDS` a gym (§11.1). */
  fields: z
    .array(z.object({ key: z.string(), label: z.string() }).strict())
    .max(MEMBER_LIST_MAX_EXTRA_FIELDS)
    .default([]),
});
export type MemberListView = z.infer<typeof memberListViewSchema>;

export const memberListViewResponseSchema = z.object({ list: memberListViewSchema });
export type MemberListViewResponse = z.infer<typeof memberListViewResponseSchema>;

/** ONE PERSON ON THE LIST THE GYM KEEPS. The id is here because 3a-iv changes and
 *  removes one by it; everything else is what the GYM said about them, plus the one
 *  thing only this app knows — whether they are already a member here. */
export const memberListEntrySchema = z.object({
  entryId: z.string().uuid(),
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  memberNumber: z.string().nullable(),
  status: z.string().nullable(),
  /** The five the gym's file also gave (§11.1), each the gym's own word or a plain
   *  calendar day. `endsOnKind` says which of "ends" and "renews" the heading said, so
   *  a screen prints "Renews 3 Oct" rather than choosing for the gym. */
  membershipType: z.string().nullable(),
  joinedOn: memberListDaySchema.nullable(),
  endsOn: memberListDaySchema.nullable(),
  endsOnKind: z.enum(["ends", "renews"]).nullable(),
  paymentStatus: z.string().nullable(),
  dateOfBirth: memberListDaySchema.nullable(),
  /** When this person was taken off the list, or null while they are on it (§11.1).
   *  A former record admits nobody, is invited by nothing, and is left out of a page
   *  unless it is asked for. */
  formerAt: z.string().nullable(),
  source: memberListEntrySourceSchema,
  inApp: z.boolean(),
  /** The gym's invitation to this record's address, or null if it was never invited
   *  (§9.12). */
  invitation: memberListInvitationSchema.nullable().default(null),
  /** **THE GYM'S OWN COLUMNS ARE NOT HERE, AND THAT IS DELIBERATE.** A page holds a
   *  hundred people and a gym may keep forty of its own columns of up to five hundred
   *  characters each, so carrying them would be two megabytes of a screen that shows
   *  none of it — the extra fields belong on ONE person's page (§11.6, 3a-iv), where
   *  they are read and where there is one of them. This comment is the field that is
   *  missing, so nobody adds it here by accident. */
});
export type MemberListEntry = z.infer<typeof memberListEntrySchema>;

/** How many names one page of the kept list holds. */
export const MEMBER_LIST_ENTRIES_PAGE = 100;

/** The longest search staff can type: long enough for a full name and an address,
 *  short enough that nothing unbounded reaches a scan of a gym's whole list. */
export const MEMBER_LIST_QUERY_MAX_CHARS = 120;

/** How many status words one request may filter on. A gym's list is capped at 20
 *  different words when a column is read as a status (§9.5), and this sits above
 *  that so ticking every chip on the screen is always allowed. */
export const MEMBER_LIST_STATUS_FILTERS_MAX = 25;

/** WHICH OF THE GYM'S OWN PEOPLE TO SHOW.
 *
 *  `status` may be given more than once, and an EMPTY one means "the people with no
 *  status at all" (§9.9) — which is why it is a plain string and not a non-empty
 *  one: a gym whose export has no status column has a whole list of them, and they
 *  have to be reachable. A status is matched with its case and spaces folded, like
 *  everywhere else in this module a status word is compared.
 *
 *  `cursor` is OPAQUE — the server's own record of where the last page ended, sent
 *  straight back. A screen never builds one, so nothing here describes its
 *  contents: what it is made of is the server's business, and it is parsed there
 *  like any other outside input. */
const wordFilterSchema = z
  .union([
    z.string().max(MEMBER_LIST_MAX_STATUS_CHARS),
    z.array(z.string().max(MEMBER_LIST_MAX_STATUS_CHARS)).max(MEMBER_LIST_STATUS_FILTERS_MAX),
  ])
  .optional();

/** Which records a page is cut from (§11.5). `current` is the default and is what
 *  every screen means by the list; `former` is the people the gym has taken off, and
 *  `all` is both — asked for by name, never by leaving a filter out, because a former
 *  record appearing in a page nobody asked for is somebody the gym believes it has
 *  removed standing in a list of its members. */
export const memberListRecordsSchema = z.enum(["current", "former", "all"]);
export type MemberListRecords = z.infer<typeof memberListRecordsSchema>;

export const memberListEntriesQuerySchema = z
  .object({
    filter: z.enum(["all", "in_app", "not_in_app"]).optional(),
    status: wordFilterSchema,
    /** The gym's own membership and payment words, each matched with case and spaces
     *  folded and each with the same "empty means the people with none" rule as
     *  `status` (§11.5). Three filters of one shape, because they are three lists of
     *  the gym's own words and the app attaches no meaning to any of them. */
    membershipType: wordFilterSchema,
    paymentStatus: wordFilterSchema,
    records: memberListRecordsSchema.optional(),
    /** Who has been invited, and how it stands (§11.5). */
    invitation: memberListInvitationFilterSchema.optional(),
    query: z.string().max(MEMBER_LIST_QUERY_MAX_CHARS).optional(),
    cursor: z.string().max(512).optional(),
  })
  .strict();
export type MemberListEntriesQuery = z.infer<typeof memberListEntriesQuerySchema>;

/** One page of the list the gym keeps. `total` is how many the filters match IN
 *  ALL, not how many are on this page, so a screen can say "312 Active" without
 *  asking a second question — and it is counted over the same filtered set the page
 *  is cut from, in the same statement, so the two can never disagree. */
export const memberListEntriesPageSchema = z.object({
  total: z.number().int().min(0),
  entries: z.array(memberListEntrySchema).max(MEMBER_LIST_ENTRIES_PAGE),
  cursor: z.string().nullable(),
});
export type MemberListEntriesPage = z.infer<typeof memberListEntriesPageSchema>;

export const memberListEntriesResponseSchema = z.object({ page: memberListEntriesPageSchema });
export type MemberListEntriesResponse = z.infer<typeof memberListEntriesResponseSchema>;

// ── Invite (3b-i-a; §9.12, §11.5) ───────────────────────────────────────────

/** Who an Invite is for: the list's current people, narrowed by the gym's own words
 *  exactly as `GET /entries` narrows them. No filter is everybody. */
const inviteFilterShape = {
  status: wordFilterSchema,
  membershipType: wordFilterSchema,
  paymentStatus: wordFilterSchema,
};

export const memberInvitePreviewQuerySchema = z.object(inviteFilterShape).strict();
export type MemberInvitePreviewQuery = z.infer<typeof memberInvitePreviewQuerySchema>;

/** What an Invite would do now: how many it would reach, who it leaves out and why,
 *  and the list's version. The press sends `version` and `reach` back. `blocked` says
 *  why the gym cannot send at all yet, or null. */
export const memberInvitePreviewSchema = z
  .object({
    version: z.number().int().min(0),
    reach: z.number().int().min(0),
    skipped: memberInviteSkippedSchema,
    blocked: memberInviteBlockedSchema.nullable(),
  })
  .strict();
export type MemberInvitePreview = z.infer<typeof memberInvitePreviewSchema>;

export const memberInvitePreviewResponseSchema = z.object({ preview: memberInvitePreviewSchema });
export type MemberInvitePreviewResponse = z.infer<typeof memberInvitePreviewResponseSchema>;

/** Press Invite. If the list's version or the number the preview showed has moved,
 *  nobody is invited and the answer carries the new preview. */
export const memberInviteRequestSchema = z
  .object({ ...inviteFilterShape, version: z.number().int().min(0), expectedCount: z.number().int().min(0) })
  .strict();
export type MemberInviteRequest = z.infer<typeof memberInviteRequestSchema>;

export const memberInvitedSchema = z
  .object({ queued: z.number().int().min(0), skipped: memberInviteSkippedSchema, version: z.number().int().min(0) })
  .strict();
export type MemberInvited = z.infer<typeof memberInvitedSchema>;

export const memberInvitedResponseSchema = z.object({ invited: memberInvitedSchema });
export type MemberInvitedResponse = z.infer<typeof memberInvitedResponseSchema>;

export const memberInviteChangedSchema = z.object({
  error: z.literal("invite_changed"),
  message: z.string(),
  preview: memberInvitePreviewSchema,
  requestId: z.string().optional(),
});

// ── Keeping the list by hand (3a-iv; §9.9, §11.6) ───────────────────────────

/** The longest phone number staff may type, before it is read. */
export const MEMBER_LIST_MAX_TYPED_PHONE_CHARS = 40;

/** The most app members one person's page lists against one record (a household
 *  sharing an address is the case with more than one). */
export const MEMBER_LIST_MAX_ENTRY_MEMBERS = 100;

const extraKeySchema = z.string().regex(new RegExp(`^[a-z0-9_]{1,${String(MEMBER_LIST_MAX_FIELD_KEY_CHARS)}}$`));

const extraInputSchema = z
  .record(extraKeySchema, z.string().max(MEMBER_LIST_MAX_EXTRA_CHARS))
  .refine((extra) => Object.keys(extra).length <= MEMBER_LIST_MAX_EXTRA_FIELDS, { message: "too many fields" });

/** "Add member" (§11.6). Every field as staff typed it; the server cleans each one
 *  by the file's own rules and refuses what it cannot keep. Email or phone is
 *  required, checked by the server. `extra` is keyed by the gym's own catalogue. */
export const memberListEntryInputSchema = z
  .object({
    fullName: z.string().max(MEMBER_LIST_MAX_NAME_CHARS).optional(),
    email: z.string().max(MEMBER_LIST_MAX_EMAIL_CHARS).optional(),
    phone: z.string().max(MEMBER_LIST_MAX_TYPED_PHONE_CHARS).optional(),
    memberNumber: z.string().max(MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS).optional(),
    status: z.string().max(MEMBER_LIST_MAX_STATUS_CHARS).optional(),
    membershipType: z.string().max(MEMBER_LIST_MAX_STATUS_CHARS).optional(),
    joinedOn: memberListDaySchema.optional(),
    endsOn: memberListDaySchema.optional(),
    endsOnKind: z.enum(["ends", "renews"]).optional(),
    paymentStatus: z.string().max(MEMBER_LIST_MAX_STATUS_CHARS).optional(),
    dateOfBirth: memberListDaySchema.optional(),
    extra: extraInputSchema.optional(),
    /** "Add and invite": invite the person in the same step (§9.12). */
    invite: z.boolean().optional(),
  })
  .strict();
export type MemberListEntryInput = z.infer<typeof memberListEntryInputSchema>;

/** Changing one person. A field left out is left alone; `null` empties it. An
 *  `extra` key set to "" empties that column. At least one field.
 *
 *  `acknowledgeLeavesList` is the tick for a change that would leave app members
 *  reached by no record (409 `leaves_list`); asked of this request only. */
export const memberListEntryPatchSchema = z
  .object({
    fullName: z.string().max(MEMBER_LIST_MAX_NAME_CHARS).optional(),
    email: z.string().max(MEMBER_LIST_MAX_EMAIL_CHARS).nullable().optional(),
    phone: z.string().max(MEMBER_LIST_MAX_TYPED_PHONE_CHARS).nullable().optional(),
    memberNumber: z.string().max(MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS).nullable().optional(),
    status: z.string().max(MEMBER_LIST_MAX_STATUS_CHARS).nullable().optional(),
    membershipType: z.string().max(MEMBER_LIST_MAX_STATUS_CHARS).nullable().optional(),
    joinedOn: memberListDaySchema.nullable().optional(),
    endsOn: memberListDaySchema.nullable().optional(),
    endsOnKind: z.enum(["ends", "renews"]).nullable().optional(),
    paymentStatus: z.string().max(MEMBER_LIST_MAX_STATUS_CHARS).nullable().optional(),
    dateOfBirth: memberListDaySchema.nullable().optional(),
    extra: extraInputSchema.optional(),
    acknowledgeLeavesList: z.boolean().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).some((key) => key !== "acknowledgeLeavesList"), { message: "nothing to change" });
export type MemberListEntryPatch = z.infer<typeof memberListEntryPatchSchema>;

/** Join two records of one person (PushPress's merge): the record this is sent
 *  to is the one NOT kept; `keepEntryId` is the one that stays. The tick is as for a
 *  change. */
export const memberListMergeRequestSchema = z
  .object({ keepEntryId: z.string().uuid(), acknowledgeLeavesList: z.boolean().optional() })
  .strict();
export type MemberListMergeRequest = z.infer<typeof memberListMergeRequestSchema>;

/** One of the gym's own columns on one person's page, under the gym's heading. */
export const memberListEntryFieldValueSchema = z
  .object({
    key: z.string().max(MEMBER_LIST_MAX_FIELD_KEY_CHARS),
    label: z.string().max(MEMBER_LIST_MAX_FIELD_LABEL_CHARS),
    value: z.string().max(MEMBER_LIST_MAX_EXTRA_CHARS),
  })
  .strict();
export type MemberListEntryFieldValue = z.infer<typeof memberListEntryFieldValueSchema>;

/** An app member this record belongs to, and only what §2.4 lets a gym see:
 *  when they joined and their visits here during this membership. */
export const memberListEntryMemberSchema = z
  .object({
    userId: z.string().uuid(),
    displayName: z.string(),
    joinedAt: z.string(),
    visits: z.number().int().min(0),
    lastVisitOn: memberListDaySchema.nullable(),
  })
  .strict();
export type MemberListEntryMember = z.infer<typeof memberListEntryMemberSchema>;

/** One person's page (§11.6): the page row, every one of the gym's own columns in
 *  the gym's order, which fields staff edited by hand, and the app members this
 *  record belongs to. */
export const memberListEntryDetailSchema = memberListEntrySchema.extend({
  extra: z.array(memberListEntryFieldValueSchema).max(MEMBER_LIST_MAX_EXTRA_FIELDS),
  handEdited: z.array(memberListEditedFieldSchema).max(MEMBER_LIST_MAX_EDITED_FIELDS),
  members: z.array(memberListEntryMemberSchema).max(MEMBER_LIST_MAX_ENTRY_MEMBERS),
});
export type MemberListEntryDetail = z.infer<typeof memberListEntryDetailSchema>;

export const memberListEntryResponseSchema = z.object({ entry: memberListEntryDetailSchema });
export type MemberListEntryResponse = z.infer<typeof memberListEntryResponseSchema>;

/** What a write by hand did. `already_on_list` and `already_taken_off` wrote
 *  nothing; `unchanged` is a change that matched what was stored. */
export const memberListEntryOutcomeSchema = z.enum([
  "added",
  "revived",
  "already_on_list",
  "changed",
  "unchanged",
  "taken_off",
  "already_taken_off",
  "restored",
  "merged",
]);
export type MemberListEntryOutcome = z.infer<typeof memberListEntryOutcomeSchema>;

/** `version` is the list's version after the write, which a later removal names. */
export const memberListEntryWrittenSchema = z
  .object({
    outcome: memberListEntryOutcomeSchema,
    entry: memberListEntryDetailSchema,
    version: z.number().int().min(0),
    /** What "Add and invite" did about the invitation; absent for any other write. */
    invite: memberInviteOneSchema.optional(),
  })
  .strict();
export type MemberListEntryWritten = z.infer<typeof memberListEntryWrittenSchema>;

export const memberListEntryDeletedSchema = z
  .object({ deleted: z.literal(true), version: z.number().int().min(0) })
  .strict();
export type MemberListEntryDeleted = z.infer<typeof memberListEntryDeletedSchema>;

/** A change that would make this record the same person as another one: 409, with
 *  the other record's id so a screen can open it, or offer to join the two.
 *  `former_record` when that other record is a former one. */
export const memberListAlreadyOnListSchema = z.object({
  error: z.enum(["already_on_list", "former_record"]),
  message: z.string(),
  entryId: z.string().uuid(),
  requestId: z.string().optional(),
});

/** A change or a join that would leave app members reached by no current record, so
 *  they would read "no longer on your list": 409 with how many, never who. */
export const memberListLeavesListSchema = z.object({
  error: z.literal("leaves_list"),
  message: z.string(),
  members: z.number().int().positive(),
  requestId: z.string().optional(),
});

/** Which of the gym's app members a removal is about (§9.7's marks). */
export const memberListUnlistedGroupSchema = z.enum(["no_longer_listed", "never_listed"]);
export type MemberListUnlistedGroup = z.infer<typeof memberListUnlistedGroupSchema>;

export const memberListUnlistedQuerySchema = z
  .object({ group: memberListUnlistedGroupSchema, cursor: z.string().max(512).optional() })
  .strict();
export type MemberListUnlistedQuery = z.infer<typeof memberListUnlistedQuerySchema>;

/** One app member in the group: the name, their proved address or null, and when
 *  they joined. */
export const memberListUnlistedPersonSchema = z
  .object({ userId: z.string().uuid(), displayName: z.string(), email: z.string().nullable(), joinedAt: z.string() })
  .strict();
export type MemberListUnlistedPerson = z.infer<typeof memberListUnlistedPersonSchema>;

/** The people "Remove all" would remove, a page at a time. `total`, `version` and
 *  `digest` describe the WHOLE group and are sent back with the removal, which is
 *  refused unless the group is still exactly this one. */
export const memberListUnlistedPageSchema = z
  .object({
    group: memberListUnlistedGroupSchema,
    version: z.number().int().min(0),
    total: z.number().int().min(0),
    digest: sha256Schema,
    people: z.array(memberListUnlistedPersonSchema).max(MEMBER_LIST_ENTRIES_PAGE),
    cursor: z.string().nullable(),
  })
  .strict();
export type MemberListUnlistedPage = z.infer<typeof memberListUnlistedPageSchema>;

export const memberListUnlistedResponseSchema = z.object({ page: memberListUnlistedPageSchema });
export type MemberListUnlistedResponse = z.infer<typeof memberListUnlistedResponseSchema>;

/** Remove the whole group from the gym in one call (§9.8, §9.9). The three
 *  numbers are the ones the page showed; the tick is asked of this request only. */
export const memberListRemoveUnlistedRequestSchema = z
  .object({
    group: memberListUnlistedGroupSchema,
    version: z.number().int().min(0),
    expectedCount: z.number().int().min(0),
    digest: sha256Schema,
    acknowledgeLargeChange: z.boolean().optional(),
  })
  .strict();
export type MemberListRemoveUnlistedRequest = z.infer<typeof memberListRemoveUnlistedRequestSchema>;

/** `alreadyRemoved` answers the same press again (a retry, or the second of two staff):
 *  these people were removed by an earlier press, and nobody was removed now. */
export const memberListRemovedSchema = z
  .object({ group: memberListUnlistedGroupSchema, removed: z.number().int().min(0), alreadyRemoved: z.boolean() })
  .strict();
export type MemberListRemoved = z.infer<typeof memberListRemovedSchema>;

export const memberListRemovedResponseSchema = z.object({ removed: memberListRemovedSchema });
export type MemberListRemovedResponse = z.infer<typeof memberListRemovedResponseSchema>;

/** The removal's two refusals, each with what the server found, so a screen can
 *  show it before asking again. Counts and a version only, never a person. */
export const memberListRemoveChangedSchema = z.object({
  error: z.literal("list_changed"),
  message: z.string(),
  version: z.number().int().min(0),
  total: z.number().int().min(0),
  digest: sha256Schema,
  requestId: z.string().optional(),
});

export const memberListRemoveLargeSchema = z.object({
  error: z.literal("large_change"),
  message: z.string(),
  removing: z.number().int().min(0),
  of: z.number().int().min(0),
  requestId: z.string().optional(),
});

/** The server's sentences for writes by hand, printed as sent (§9.9). */
export const MEMBER_LIST_BY_HAND_WORDS = {
  needs_contact: "Add an email address or a phone number. The list needs one of them to tell people apart.",
  bad_email: "That email address doesn't look right. Check it and try again.",
  bad_phone: "That phone number doesn't look right. Check it, or start it with + and the country code.",
  bad_member_number: "That member number can't be stored as it is. Check it and try again.",
  bad_day: "That date isn't a real day. Check it and try again.",
  ends_kind_without_day: "Choose the end or renewal date first.",
  unknown_field: "That column isn't one of your list's columns.",
  already_on_list: "This person is already on your list.",
  former_record: "A former record already has these details. Put it back, or join the two records.",
  leaves_list_change:
    "This would leave people who use the app off your list, because their details would no longer match. Check the change, then confirm to go ahead.",
  leaves_list_merge:
    "This would leave people who use the app off your list, because only the record you are removing has their details. Keep that record instead, or confirm to go ahead.",
  entry_not_found: "That person could not be found on your list.",
  member_not_found: "That person isn't a member here.",
  not_former: "Take this person off the list before deleting their record for good.",
  no_contact:
    "We don't have a proven email address or a phone number for this person, so they can't be put on the list from here. Add them by hand instead.",
  merge_same: "Choose a different record to keep.",
  list_changed: "Your list or your members changed while you were looking, so nobody was removed. Look at the names again.",
  large_change:
    "This would remove more of your members than we do without asking. Check the number, then confirm again to go ahead.",
} as const;

/** The sentence for a card number typed into a field, naming the field. */
export const memberListCardTypedWords = (field: string): string =>
  `The ${field} looks like a payment card number. We never store card details, so nothing was saved.`;
