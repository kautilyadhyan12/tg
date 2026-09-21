// THE MEMBER LIST (spec Part 3 §9). The gym's own list of its members, uploaded
// as a spreadsheet and kept in the app. Shared shapes and every constant live
// here (§9.3); the server code is in `apps/api/src/modules/orgs/memberList/`.
//
// 3a-i, opening a file safely (§9.4): what an uploaded file may be, what it is
// opened into — a grid of text cells, one per sheet — and every refusal, in the
// server's own words, each saying what to do next. A screen prints the words
// as sent; it never writes its own.
import { z } from "zod";

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

/** The five things the list keeps, and the two ways a name is written. */
export const memberListFieldSchema = z.enum(["fullName", "firstName", "lastName", "email", "phone", "memberNumber", "status"]);
export type MemberListField = z.infer<typeof memberListFieldSchema>;

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
  identityKey: sha256Schema,
});
export type MemberListRow = z.infer<typeof memberListRowSchema>;

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
] as const;
const PLAIN_WARNINGS = ["hidden_rows_or_columns", "encoding_guessed", "no_header_row"] as const;

/** What was noticed about the file as a whole (§9.5). Nothing here stops an
 *  upload; each one is a sentence staff can act on. */
export const memberListWarningSchema = z.discriminatedUnion("code", [
  z.object({ code: z.enum(PLAIN_WARNINGS) }),
  z.object({ code: z.enum(COUNTED_WARNINGS), rows: z.number().int().positive() }),
  z.object({ code: z.literal("other_sheets_ignored"), sheets: z.array(z.string()) }),
  z.object({ code: z.literal("placeholders"), rows: z.number().int().positive(), values: z.array(z.string()) }),
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
  counts: z.object({
    dataRows: z.number().int().min(0),
    kept: z.number().int().min(0),
    noContact: z.number().int().min(0),
    duplicates: z.number().int().min(0),
    withEmail: z.number().int().min(0),
    withPhone: z.number().int().min(0),
    withMemberNumber: z.number().int().min(0),
    withStatus: z.number().int().min(0),
  }),
  /** Every status word in the file, in the case it was first written in, with
   *  how many people carry it. The app attaches no meaning to any of them. */
  statuses: z.array(z.object({ label: z.string(), count: z.number().int().positive() })),
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
});
export type MemberListChangeCounts = z.infer<typeof memberListChangeCountsSchema>;

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

/** CONFIRM THIS UPLOAD. The one field is the tick the wrong-file guard asks for,
 *  and it is asked for ON THAT REQUEST (§9.8): a gym that acknowledged a large
 *  change an hour ago has acknowledged nothing about this press. Absent is the
 *  same as false — so a screen that forgets to send it cannot apply one. */
export const memberListConfirmRequestSchema = z
  .object({ acknowledgeLargeChange: z.boolean().optional() })
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

/** THE TWO REFUSALS THAT CARRY NUMBERS, and why they are not sentences alone.
 *
 *  Both mean "we did NOT do that, and here is what we saw", and a screen cannot ask
 *  the right question without the figures: a large change has to show staff what
 *  would go before it asks them to tick, and a changed list has to say which
 *  version it measured against and which it found, or "somebody changed it" is a
 *  dead end. Every other refusal in this module is a sentence alone, because there
 *  is nothing to show. Neither carries anything about a PERSON — a version is the
 *  gym's own list's, and the guard is counts. */
export const MEMBER_LIST_CONFIRM_REFUSAL_WORDS = {
  list_changed:
    "Your list changed while you were looking at this preview, so nothing was applied. Upload the file again to see what it would do now.",
  large_change:
    "This would change more of your list than we apply without asking. Check the numbers below, then confirm again to go ahead.",
} as const;

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

/** THE LIST AS IT STANDS. A gym that has never confirmed one answers `hasList:
 *  false` with everything at zero rather than a 404: "you have no list yet" is a
 *  screen, and a missing route is not. */
export const memberListViewSchema = z.object({
  hasList: z.boolean(),
  version: z.number().int().min(0),
  lastConfirmedAt: z.string().nullable(),
  counts: memberListCountsSchema,
  statuses: z.array(memberListStatusCountSchema),
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
  source: memberListEntrySourceSchema,
  inApp: z.boolean(),
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
export const memberListEntriesQuerySchema = z
  .object({
    filter: z.enum(["all", "in_app", "not_in_app"]).optional(),
    status: z
      .union([
        z.string().max(MEMBER_LIST_MAX_STATUS_CHARS),
        z.array(z.string().max(MEMBER_LIST_MAX_STATUS_CHARS)).max(MEMBER_LIST_STATUS_FILTERS_MAX),
      ])
      .optional(),
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
