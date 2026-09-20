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

export const memberFileGridSchema = z.object({
  ok: z.literal(true),
  kind: z.enum(["xlsx", "csv"]),
  sheets: z.array(memberFileSheetSchema),
  facts: z.object({
    encoding: memberFileEncodingSchema.optional(),
    /** The character between a CSV's columns: named by a `sep=` line, else found. */
    delimiter: z.string().length(1).optional(),
  }),
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
  "parse_timeout",
  "too_complex",
  "busy",
] as const;

export const memberFileRefusalSchema = z.discriminatedUnion("code", [
  z.object({ code: z.enum(PLAIN_REFUSAL_CODES) }),
  z.object({ code: z.literal("other_zip"), archive: memberFileOtherZipSchema }),
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
  parse_timeout: "This file took too long to read. Save just the member sheet as CSV and upload that.",
  too_complex: "This file is too large or complex to read. Save just the member sheet as CSV and upload that.",
  busy: "Other files are being read right now. Try again in a minute.",
};

/** The sentence a refusal is shown with — the server's, printed as sent. */
export function memberFileRefusalWords(refusal: MemberFileRefusal): string {
  switch (refusal.code) {
    case "other_zip":
      return OTHER_ZIP_WORDS[refusal.archive];
    case "unterminated_quote":
      return `Row ${String(refusal.row)} opens a quote mark (") that never closes, so the rest of the file can't be read. Fix that row in your spreadsheet, or save the file again from Excel or Google Sheets, and upload it.`;
    default:
      return PLAIN_WORDS[refusal.code];
  }
}
