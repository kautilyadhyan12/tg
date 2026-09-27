// LEADS FROM A FILE — ROADMAP Stage 2 item 20c-iii; spec Part 3 §16.3.
//
// A gym's list of enquiries, exported from other software or kept in a spreadsheet,
// read by the member list's own file reader (§9.4, §11.2: card numbers, bank details,
// ID numbers, passwords and health notes are dropped before anything is read) and
// shown back before anything is saved: who will be added, who will not, and why.
// Nothing is kept until staff press Add, and what is added is exactly what they saw.
//
// **NO LEAD FROM A FILE EVER ARRIVES TICKED "Happy to hear from us"**, whatever the
// file says. A file cannot show that the person agreed to be emailed; staff tick each
// lead who did, as they do for a lead added by hand.
import { z } from "zod";
import { LEAD_MAX_NOTES_CHARS, LEADS_MAX_PER_GYM, LEAD_SOURCE_WORDS, leadSourceSchema } from "./leads.js";
import {
  MEMBER_FILE_MAX_ARCHIVE_ENTRIES,
  MEMBER_FILE_MAX_BASE64_CHARS,
  MEMBER_FILE_MAX_COLUMNS,
  MEMBER_FILE_MAX_SHEET_ROWS,
  MEMBER_LIST_COLUMN_SAMPLES,
  MEMBER_LIST_MAX_DATA_ROWS,
  MEMBER_LIST_MAX_NAME_CHARS,
  MEMBER_LIST_MOST_COLUMNS_PER_FIELD,
  MEMBER_LIST_PLACEHOLDER_ROWS,
  memberFileRefusalSchema,
  memberListNeverKeptReasonSchema,
  type MemberFileRefusal,
} from "./memberList.js";

/** What a lead's file can fill in. The status is not here: every lead from a file is New. */
export const LEAD_FILE_FIELDS = ["fullName", "firstName", "lastName", "email", "phone", "source", "notes"] as const;
export const leadFileFieldSchema = z.enum(LEAD_FILE_FIELDS);
export type LeadFileField = z.infer<typeof leadFileFieldSchema>;

/** Each field as the column picker names it. */
export const LEAD_FILE_FIELD_WORDS: Readonly<Record<LeadFileField, string>> = {
  fullName: "Name",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  source: "Heard of you from",
  notes: "Notes",
};

/** The most characters of a "heard of you from" cell kept in the notes. */
export const LEAD_FILE_MAX_SOURCE_WORD_CHARS = 60;
/** The most different "heard of you from" words the preview lists. */
export const LEAD_FILE_MAX_SOURCE_WORDS = 50;

const columnIndexSchema = z.number().int().min(0).max(MEMBER_FILE_MAX_COLUMNS - 1);

/** Which column holds what, by its place in the sheet counting from 0. Staff may send
 *  one of their own; then nothing is guessed. `headerRow` null says the file has no
 *  headings. `email` and `phone` are tried in order, as on the member list. */
export const leadFileMappingSchema = z
  .object({
    sheet: z.number().int().min(0).max(MEMBER_FILE_MAX_ARCHIVE_ENTRIES).nullable().default(null),
    headerRow: z.number().int().min(0).max(MEMBER_FILE_MAX_SHEET_ROWS).nullable(),
    fullName: columnIndexSchema.nullable().default(null),
    firstName: columnIndexSchema.nullable().default(null),
    lastName: columnIndexSchema.nullable().default(null),
    email: z.array(columnIndexSchema).max(MEMBER_LIST_MOST_COLUMNS_PER_FIELD).default([]),
    phone: z.array(columnIndexSchema).max(MEMBER_LIST_MOST_COLUMNS_PER_FIELD).default([]),
    source: columnIndexSchema.nullable().default(null),
    notes: columnIndexSchema.nullable().default(null),
  })
  .strict();
export type LeadFileMapping = z.infer<typeof leadFileMappingSchema>;

/** One column as staff see it: its heading, up to three of its cells, and what the
 *  server made of it. A column that is never kept shows its reason and no cells. */
export const leadFileColumnSchema = z
  .object({
    index: columnIndexSchema,
    header: z.string().nullable(),
    samples: z.array(z.string()).max(MEMBER_LIST_COLUMN_SAMPLES),
    guess: leadFileFieldSchema.nullable(),
    neverKept: memberListNeverKeptReasonSchema.nullable(),
  })
  .strict();
export type LeadFileColumn = z.infer<typeof leadFileColumnSchema>;

/** One lead as the file gives it, cleaned by the member list's rules. `sourceWord` is
 *  the file's own word where it is not already one of ours ("Instagram" beside Social
 *  media); it is written into the notes, so nothing the file said is lost. */
export const leadFileRowSchema = z
  .object({
    row: z.number().int().positive(),
    fullName: z.string().min(1).max(MEMBER_LIST_MAX_NAME_CHARS),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    source: leadSourceSchema,
    sourceWord: z.string().max(LEAD_FILE_MAX_SOURCE_WORD_CHARS).nullable(),
    notes: z.string().max(LEAD_MAX_NOTES_CHARS),
  })
  .strict();
export type LeadFileRow = z.infer<typeof leadFileRowSchema>;

/** How the file's "heard of you from" words were sorted, with how many carry each. */
export const leadFileSourceWordSchema = z
  .object({
    word: z.string().max(LEAD_FILE_MAX_SOURCE_WORD_CHARS),
    source: leadSourceSchema,
    count: z.number().int().positive(),
  })
  .strict();
export type LeadFileSourceWord = z.infer<typeof leadFileSourceWordSchema>;

const LEAD_FILE_PLAIN_WARNINGS = ["hidden_rows_or_columns", "encoding_guessed", "no_header_row"] as const;
const LEAD_FILE_COUNTED_WARNINGS = [
  "question_marks_in_names",
  "garbled_names",
  "shortened_by_excel",
  "phones_need_country",
  "phones_unusual",
  "card_cells_dropped",
  /** Notes longer than a lead keeps, cut to fit. */
  "notes_cut",
] as const;

export const leadFileWarningSchema = z.discriminatedUnion("code", [
  z.object({ code: z.enum(LEAD_FILE_PLAIN_WARNINGS) }).strict(),
  z.object({ code: z.enum(LEAD_FILE_COUNTED_WARNINGS), rows: z.number().int().positive() }).strict(),
  z.object({ code: z.literal("other_sheets_ignored"), sheets: z.array(z.string()) }).strict(),
  z.object({ code: z.literal("placeholders"), rows: z.number().int().positive(), values: z.array(z.string()) }).strict(),
]);
export type LeadFileWarning = z.infer<typeof leadFileWarningSchema>;

const fileCountsSchema = z
  .object({
    /** Rows with anything written on them, below the headings. */
    dataRows: z.number().int().min(0),
    /** No email and no phone. */
    noContact: z.number().int().min(0),
    /** An email or phone but no name. */
    noName: z.number().int().min(0),
    /** The same email or phone as an earlier row. */
    twiceInFile: z.number().int().min(0),
  })
  .strict();

/** What the file reader makes of a leads file (in its worker thread). */
export const leadFileUnderstandingSchema = z
  .object({
    ok: z.literal(true),
    sheet: z.object({ index: z.number().int().min(0), name: z.string().nullable() }).strict(),
    headerRow: z.number().int().min(0).nullable(),
    columns: z.array(leadFileColumnSchema),
    mapping: leadFileMappingSchema,
    /** No email or phone column was found: nothing is read until staff say which is which. */
    needsMapping: z.boolean(),
    rows: z.array(leadFileRowSchema).max(MEMBER_LIST_MAX_DATA_ROWS),
    counts: fileCountsSchema,
    sources: z.array(leadFileSourceWordSchema).max(LEAD_FILE_MAX_SOURCE_WORDS),
    warnings: z.array(leadFileWarningSchema),
  })
  .strict();
export type LeadFileUnderstanding = z.infer<typeof leadFileUnderstandingSchema>;

export const leadFileResultSchema = z.discriminatedUnion("ok", [
  leadFileUnderstandingSchema,
  z.object({ ok: z.literal(false), refusal: memberFileRefusalSchema }).strict(),
]);
export type LeadFileResult = z.infer<typeof leadFileResultSchema>;

/** One person on the check screen. */
export const leadFilePersonSchema = z
  .object({
    row: z.number().int().positive(),
    fullName: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    source: leadSourceSchema,
  })
  .strict();
export type LeadFilePerson = z.infer<typeof leadFilePersonSchema>;

/** The check screen: who will be added, who will not and why, before anything is saved.
 *  `expected` names exactly the leads `add` holds; Add sends it back, and the server
 *  adds them only if the file and the gym still give that same list. */
export const leadFilePreviewSchema = z
  .object({
    sheet: z.object({ index: z.number().int().min(0), name: z.string().nullable() }).strict(),
    headerRow: z.number().int().min(0).nullable(),
    columns: z.array(leadFileColumnSchema),
    mapping: leadFileMappingSchema,
    needsMapping: z.boolean(),
    counts: fileCountsSchema.extend({
      add: z.number().int().min(0),
      alreadyLead: z.number().int().min(0),
      alreadyMember: z.number().int().min(0),
    }),
    add: z.array(leadFilePersonSchema),
    alreadyLead: z.array(leadFilePersonSchema),
    alreadyMember: z.array(leadFilePersonSchema),
    /** A later row with an email or phone an earlier added row has. The very same
     *  person twice is only counted. */
    twiceInFile: z.array(leadFilePersonSchema),
    sources: z.array(leadFileSourceWordSchema).max(LEAD_FILE_MAX_SOURCE_WORDS),
    warnings: z.array(leadFileWarningSchema),
    /** The gym's leads now, and how many more it may keep. */
    leadsNow: z.number().int().min(0),
    room: z.number().int().min(0),
    expected: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type LeadFilePreview = z.infer<typeof leadFilePreviewSchema>;

export const leadFileCheckRequestSchema = z
  .object({
    contentBase64: z.string().min(1).max(MEMBER_FILE_MAX_BASE64_CHARS),
    mapping: leadFileMappingSchema.optional(),
  })
  .strict();
export type LeadFileCheckRequest = z.infer<typeof leadFileCheckRequestSchema>;

export const leadFileCheckResponseSchema = z.object({ preview: leadFilePreviewSchema }).strict();
export type LeadFileCheckResponse = z.infer<typeof leadFileCheckResponseSchema>;

/** Add: the same file, the mapping the check screen showed, its `expected`, and staff's
 *  tick that they may store these people's details (as the member list asks, §9.12). */
export const leadFileAddRequestSchema = z
  .object({
    contentBase64: z.string().min(1).max(MEMBER_FILE_MAX_BASE64_CHARS),
    mapping: leadFileMappingSchema,
    expected: z.string().regex(/^[0-9a-f]{64}$/),
    permissionConfirmed: z.literal(true),
  })
  .strict();
export type LeadFileAddRequest = z.infer<typeof leadFileAddRequestSchema>;

export const leadFileAddResponseSchema = z.object({ added: z.number().int().min(0) }).strict();
export type LeadFileAddResponse = z.infer<typeof leadFileAddResponseSchema>;

/** The 409 when the file or the gym no longer gives the list staff checked. */
export const LEAD_FILE_CHANGED_ERROR = "lead_file_changed";

const count = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n.toLocaleString("en")} ${many}`);

/** The tick before Add; `{gym}` is the gym's name. */
export const LEAD_FILE_PERMISSION_WORDS = "These people asked {gym} about joining, and I have permission to store their details.";

export const LEAD_FILE_WORDS = {
  tick: "Everyone added starts as New, with “Happy to hear from us” unticked. A file can't show that someone agreed to emails, so tick it yourself on each lead who did.",
  add_reason: "Not in your leads or on your member list yet.",
  already_lead_reason: "Already in your leads with the same email or phone. Left as they are: their status and notes don't change.",
  already_member_reason: "On your member list with the same name and the same email or phone, so they aren't added as leads.",
  changed: "Your leads or member list changed since you checked this file, so nothing was added. Check the file again.",
  nothing_to_add: "Nobody in this file can be added. Everyone is below, with the reason.",
  needs_mapping: "We couldn't find an email or phone column. Choose which column is which below, then check again.",
  needs_name: "Choose the column with the person's name, or the first and last name columns.",
  needs_contact: "Choose the column with the email address or the phone number.",
  full: (room: number, adding: number): string =>
    `A gym can keep ${LEADS_MAX_PER_GYM.toLocaleString("en")} leads and you have room for ${count(room, "more", "more")}, so these ${adding.toLocaleString("en")} can't all be added. Delete leads you no longer need, or split the file, then check it again.`,
  added: (n: number): string => `${count(n, "lead", "leads")} added.`,
  no_contact: (n: number): string => `${count(n, "row has", "rows have")} no email and no phone, so ${n === 1 ? "it was" : "they were"} skipped. A lead needs one, so you can reach them.`,
  no_name: (n: number): string => `${count(n, "row has", "rows have")} no name, so ${n === 1 ? "it was" : "they were"} skipped.`,
  twice_in_file_reason: "The same email or phone as someone above, and a lead has its own. Add them by hand with their own details.",
  twice_in_file: (n: number): string =>
    `${count(n, "row repeats", "rows repeat")} an email or phone from an earlier row, so only the first is added.`,
} as const;

/** "Instagram → Social media". */
export const leadFileSourceWordLine = (entry: LeadFileSourceWord): string =>
  `${entry.word} → ${LEAD_SOURCE_WORDS[entry.source]} (${entry.count.toLocaleString("en")})`;

const WHAT_TO_UPLOAD = "Upload your leads as a CSV or Excel (.xlsx) file";

/** A refused file, in words about leads (the member list's own say "member list"). */
export function leadFileRefusalWords(refusal: MemberFileRefusal): string {
  switch (refusal.code) {
    case "empty_file":
      return "This file is empty. Export your leads again and upload the new file.";
    case "too_big":
      return "This file is over 5 MB. Save just the sheet with your leads as CSV and try again.";
    case "old_excel_or_password":
      return "This is an older Office file, such as an .xls, or a file with a password, which we can't open. In Excel choose File → Save As → Excel Workbook (.xlsx), with no password, or save it as CSV.";
    case "pdf":
      return `This is a PDF. ${WHAT_TO_UPLOAD}: export it from your software as a spreadsheet.`;
    case "web_page_or_xml":
      return "This file holds a web page or XML, not a spreadsheet we can read. If Excel opens it, choose File → Save As → Excel Workbook (.xlsx), or save it as CSV, and upload that.";
    case "not_a_spreadsheet":
      return `This file is damaged or cut short. Export your leads again and upload the new file.`;
    case "unsafe_archive":
      return "This file is built in a way we can't open safely. If it is an Excel file, open it in Excel, save a fresh copy as .xlsx, and upload that.";
    case "unreadable_excel":
      return "We couldn't read this Excel file. Open it in Excel, choose File → Save As → Excel Workbook (.xlsx), or save it as CSV, and upload that.";
    case "unreadable_text":
      return `We couldn't read this file as a spreadsheet or as text. ${WHAT_TO_UPLOAD}; from Excel, “CSV UTF-8” keeps every letter.`;
    case "too_many_rows":
      return `This sheet is longer than we can read. A file may hold ${MEMBER_LIST_MAX_DATA_ROWS.toLocaleString("en")} leads: take out any blank rows, or split the file, and upload again.`;
    case "too_many_columns":
      return `This sheet is more than ${String(MEMBER_FILE_MAX_COLUMNS)} columns wide. Copy the columns you need into a new sheet, and upload that.`;
    case "no_rows":
      return "This file has no people in it, only headings or empty rows. Export your leads again and upload the new file.";
    case "parse_timeout":
      return "This file took too long to read. Save just the sheet with your leads as CSV and upload that.";
    case "too_complex":
      return "This file is too large or complex to read. Save just the sheet with your leads as CSV and upload that.";
    case "busy":
      return "Other files are being read right now. Try again in a minute.";
    case "other_zip":
      return refusal.archive === "opendocument"
        ? "This is an OpenDocument file, as LibreOffice and OpenOffice save. Open it there, choose File → Save As → Excel 2007-365 (.xlsx), or save it as CSV, and upload that."
        : refusal.archive === "numbers"
          ? "This is an Apple Numbers, Pages or Keynote file. If it holds your leads, choose File → Export To → Excel or CSV in Numbers, and upload that."
          : refusal.archive === "excel_binary"
            ? "This is an Excel Binary Workbook (.xlsb). In Excel choose File → Save As → Excel Workbook (.xlsx), or save it as CSV, and upload that."
            : `This file is not a spreadsheet we can read. ${WHAT_TO_UPLOAD}.`;
    case "mapped_column_not_status":
      // The leads reader reads no status column; kept so every refusal has words.
      return `This file can't be read as leads. ${WHAT_TO_UPLOAD}.`;
    case "unterminated_quote":
      return `Row ${String(refusal.row)} opens a quote mark (") that never closes, so the rest of the file can't be read. Fix that row in your spreadsheet, or save the file again from Excel or Google Sheets, and upload it.`;
  }
}

/** A warning about the file as a whole, in words about leads. */
export function leadFileWarningWords(warning: LeadFileWarning): string {
  switch (warning.code) {
    case "hidden_rows_or_columns":
      return "Some rows or columns in this file are hidden. They have been read, so anyone hidden is below too.";
    case "encoding_guessed":
      return "This file doesn't say how its letters were saved, so we read them the likeliest way. Check the names below; from Excel, “CSV UTF-8” keeps every letter.";
    case "no_header_row":
      return "This file has no row of headings, so each column was worked out from what is in it. Check the columns before you add anyone.";
    case "question_marks_in_names":
      return `${count(warning.rows, "name holds", "names hold")} a “?” where a letter should be. The export lost those letters — from Excel, choose “CSV UTF-8” and export again.`;
    case "garbled_names":
      return `${count(warning.rows, "name has", "names have")} letters that came out wrong, such as “H‚lŠne” for “Hélène”. Export the file again as “CSV UTF-8”.`;
    case "shortened_by_excel":
      return `${count(warning.rows, "row has", "rows have")} a number the spreadsheet shortened, such as 9.19877E+11, so its last digits are gone. We never guess them back: set that column to Text in your spreadsheet and export again.`;
    case "phones_need_country":
      return `${count(warning.rows, "phone number was", "phone numbers were")} left out because this gym has no country set. Set the gym's country in Settings, or write the numbers with their country code, and check again.`;
    case "phones_unusual":
      return `${count(warning.rows, "phone number doesn't", "phone numbers don't")} look like a normal number for their country. They have been kept — check them before you call.`;
    case "card_cells_dropped":
      return `${count(warning.rows, "cell was dropped because it is shaped like a payment card number", "cells were dropped because they are shaped like payment card numbers")}. We never store card details, wherever they sit in a file.`;
    case "notes_cut":
      return `${count(warning.rows, "note was", "notes were")} longer than ${LEAD_MAX_NOTES_CHARS.toLocaleString("en")} characters and ${warning.rows === 1 ? "was" : "were"} cut to fit.`;
    case "other_sheets_ignored":
      return `This file has more than one sheet. Only one was read; these were ignored: ${warning.sheets.join(", ")}.`;
    case "placeholders":
      return `The same contact details sit on more than ${String(MEMBER_LIST_PLACEHOLDER_ROWS)} rows, so they are the gym's own, not a person's: ${warning.values.join(", ")}. They were left out of ${count(warning.rows, "row", "rows")}.`;
  }
}
