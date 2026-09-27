// A LEADS FILE, READ (ROADMAP 20c-iii; spec Part 3 §16.3). Runs in the member file
// reader's worker thread, after the file is opened, and hands the request's thread
// the leads it holds — never the file's cells.
//
// The member list's reader does the reading (§9.5): which sheet, which row of
// headings, the never-kept columns of §11.2 dropped before anything is guessed, names,
// emails and phones cleaned by its rules, the front desk's own address on every row
// left out, the same person twice kept once. This file adds what a lead has and a
// member record does not: where they heard of the gym and the notes. Pure: no clock,
// no database, no network.
//
// Nothing here decides whether anyone is emailed. A lead from a file never carries
// "Happy to hear from us": there is no field for it below, and the service never sets
// it on an insert from a file.
import {
  LEAD_FILE_SKIPPED_SHOWN,
  LEAD_FILE_MAX_SOURCE_WORD_CHARS,
  LEAD_MAX_NOTES_CHARS,
  LEAD_SOURCE_WORDS,
  MEMBER_FILE_MAX_CELL_CHARS,
  type LeadFileColumn,
  type LeadFileField,
  type LeadFileMapping,
  type LeadFileResult,
  type LeadFileRow,
  type LeadFileSkipped,
  type LeadFileUnderstanding,
  type LeadFileWarning,
  type LeadSource,
  type MemberFileGrid,
  type MemberListMapping,
  type MemberListWarning,
} from "@app/shared";
import { tidyCell } from "../memberList/cells.js";
import { type ColumnStat, columnStats, findHeaderRow, guessMapping } from "../memberList/columns.js";
import { cleanName, cut, fold } from "../memberList/fields.js";
import { normaliseHeader } from "../memberList/headerWords.js";
import { cardShapedCell, withoutCardNumbers } from "../memberList/neverKeep.js";
import { readCountry } from "../memberList/phone.js";
import { chooseSheet, hintsOf, understandMemberGrid } from "../memberList/understand.js";
import { sourceOfWord } from "./sourceWords.js";

export interface LeadFileJob {
  /** The gym's country, for the phone numbers. */
  country: string | null;
  /** Staff's own mapping, used as sent; null to guess. */
  mapping: LeadFileMapping | null;
}

/** Headings that say where the person heard of the gym, as whole words, best first.
 *  Read from the vendors' own pages (2026-09-27): "Lead Source" (Glofox, ClubReady,
 *  Wodify, TeamUp), "Marketing Source" and "Contact Method" (ABC GymSales), "Referral
 *  Type" and "Initial Contact Was" (ClubReady), "Source" (Gymdesk), "Referred by"
 *  (PushPress; Mindbody's `referredBy`), "Original Traffic Source" (HubSpot). */
const SOURCE_HEADINGS = [
  "source",
  "heard",
  "hear",
  "referred by",
  "referredby",
  "referral type",
  "referral",
  "found us",
  "channel",
  "contact method",
  "initial contact",
];
/** Headings that are notes about the enquiry: "Notes" (GymSales, Gymdesk, Mailchimp),
 *  "Key Note" (ClubReady). */
const NOTES_HEADINGS = ["note", "notes", "comment", "comments", "message", "enquiry", "inquiry", "remarks", "remark"];
/** A heading that holds one of these is a date, an id or somebody's own detail, not a
 *  source or a note: "Prospect Added Date", "External ID", "Staff Notes Email". */
const NOT_SOURCE_OR_NOTES = ["date", "id", "email", "phone", "owner", "staff", "salesperson", "assigned"];

const holds = (header: string, word: string): boolean => ` ${header} `.includes(` ${word} `);

/** How well a heading names one of `words`: its place in the list, or null. */
function headingRank(stat: ColumnStat, words: readonly string[]): number | null {
  if (stat.header === null) return null;
  const header = normaliseHeader(stat.header);
  if (header === "" || NOT_SOURCE_OR_NOTES.some((word) => holds(header, word))) return null;
  const at = words.findIndex((word) => holds(header, word));
  return at === -1 ? null : at;
}

/** The column whose heading names one of `words` best; the leftmost of equals. */
function bestHeaded(stats: readonly ColumnStat[], words: readonly string[]): number | null {
  let best: { index: number; rank: number } | null = null;
  for (const stat of stats) {
    const rank = headingRank(stat, words);
    if (rank !== null && (best === null || rank < best.rank)) best = { index: stat.index, rank };
  }
  return best?.index ?? null;
}

const widthOf = (rows: readonly (readonly string[])[]): number => rows.reduce((widest, row) => Math.max(widest, row.length), 0);

/** A mapping cut to this sheet: a column past its width, or one §11.2 never keeps, is
 *  dropped rather than obeyed. */
function fitMapping(mapping: LeadFileMapping, sheet: number, headerRow: number | null, width: number, dropped: ReadonlySet<number>): LeadFileMapping {
  const kept = (index: number): boolean => index < width && !dropped.has(index);
  const inside = (index: number | null): number | null => (index !== null && kept(index) ? index : null);
  const list = (indexes: readonly number[]): number[] => [...new Set(indexes.filter(kept))];
  return {
    sheet,
    headerRow,
    fullName: inside(mapping.fullName),
    firstName: inside(mapping.firstName),
    lastName: inside(mapping.lastName),
    email: list(mapping.email),
    phone: list(mapping.phone),
    source: inside(mapping.source),
    notes: inside(mapping.notes),
  };
}

/** The member list's guess for the name, email and phone; then the source and the
 *  notes by their headings, from the columns left. */
function guessLeadMapping(stats: readonly ColumnStat[], sheet: number, headerRow: number | null): LeadFileMapping {
  const { mapping } = guessMapping(stats, headerRow);
  const taken = new Set<number>([...mapping.email, ...mapping.phone]);
  for (const at of [mapping.fullName, mapping.firstName, mapping.lastName]) if (at !== null) taken.add(at);
  const free = stats.filter((stat) => stat.neverKept === null && !taken.has(stat.index));
  const source = bestHeaded(free, SOURCE_HEADINGS);
  const notes = bestHeaded(
    free.filter((stat) => stat.index !== source),
    NOTES_HEADINGS,
  );
  return {
    sheet,
    headerRow,
    fullName: mapping.fullName,
    firstName: mapping.firstName,
    lastName: mapping.lastName,
    email: mapping.email,
    phone: mapping.phone,
    source,
    notes,
  };
}

function fieldOf(mapping: LeadFileMapping, index: number): LeadFileField | null {
  if (mapping.email.includes(index)) return "email";
  if (mapping.phone.includes(index)) return "phone";
  if (mapping.fullName === index) return "fullName";
  if (mapping.firstName === index) return "firstName";
  if (mapping.lastName === index) return "lastName";
  if (mapping.source === index) return "source";
  if (mapping.notes === index) return "notes";
  return null;
}

function columnsOf(stats: readonly ColumnStat[], mapping: LeadFileMapping): LeadFileColumn[] {
  return stats.map((stat) => ({
    index: stat.index,
    header: stat.header,
    // A never-kept column shows its heading and its reason, and none of its cells.
    samples: stat.neverKept === null ? stat.samples : [],
    guess: fieldOf(mapping, stat.index),
    neverKept: stat.neverKept,
  }));
}

/** The member reader asked for the name, email and phone only: every other column is
 *  "don't keep", so none of them becomes one of the gym's own member fields. */
function memberMappingOf(mapping: LeadFileMapping, width: number): MemberListMapping {
  const dontKeep: number[] = [];
  for (let index = 0; index < width; index++) dontKeep.push(index);
  return {
    sheet: mapping.sheet,
    headerRow: mapping.headerRow,
    fullName: mapping.fullName,
    firstName: mapping.firstName,
    lastName: mapping.lastName,
    email: mapping.email,
    phone: mapping.phone,
    memberNumber: null,
    status: null,
    membershipType: null,
    joinedOn: null,
    endsOn: null,
    paymentStatus: null,
    dateOfBirth: null,
    dontKeep,
    dateOrder: [],
  };
}

/** One free-text cell as it may be kept: tidied, a cell that IS a card number dropped,
 *  a card number inside it taken out (§11.2). */
function keptText(raw: string, cards: { n: number }): string {
  const text = tidyCell(raw);
  if (text === "") return "";
  if (cardShapedCell(text)) {
    cards.n++;
    return "";
  }
  const scrubbed = withoutCardNumbers(text);
  cards.n += scrubbed.removed;
  return scrubbed.text;
}

/** A warning of the member reader that means the same for a leads file, or null. */
function passedOn(warning: MemberListWarning): LeadFileWarning | null {
  switch (warning.code) {
    case "hidden_rows_or_columns":
    case "encoding_guessed":
    case "no_header_row":
      return { code: warning.code };
    case "question_marks_in_names":
    case "garbled_names":
    case "shortened_by_excel":
    case "phones_need_country":
    case "phones_unusual":
      return { code: warning.code, rows: warning.rows };
    case "other_sheets_ignored":
      return { code: warning.code, sheets: warning.sheets };
    case "placeholders":
      return { code: warning.code, rows: warning.rows, values: warning.values };
    // Counted again below with the lead's own cells.
    case "card_cells_dropped":
    // Nothing the leads reader keeps: a shared email is "twice in the file", and no
    // date or own column is read.
    case "shared_emails":
    case "cells_cut":
    case "dates_not_read":
    case "extra_columns_left_out":
    case "gym_fields_full":
      return null;
  }
}

export function understandLeadGrid(grid: MemberFileGrid, job: LeadFileJob): LeadFileResult {
  const country = readCountry(job.country);
  const chosen = job.mapping;
  const askedFor = chosen?.sheet ?? null;
  const sheetIndex = askedFor !== null && askedFor < grid.sheets.length ? askedFor : chooseSheet(grid.sheets, country, null);
  const sheet = grid.sheets[sheetIndex];
  if (sheet === undefined) return { ok: false, refusal: { code: "no_rows" } };
  const rows = sheet.rows;
  const width = widthOf(rows);
  const headerRow = chosen === null ? findHeaderRow(rows) : chosen.headerRow !== null && chosen.headerRow < rows.length ? chosen.headerRow : null;
  // §11.2 first: a column it drops is never a candidate for anything below.
  const stats = columnStats(rows, headerRow, country, { parsePhones: true, hints: hintsOf(rows, headerRow) });
  const dropped = new Set(stats.filter((stat) => stat.neverKept !== null).map((stat) => stat.index));
  const mapping = chosen === null ? guessLeadMapping(stats, sheetIndex, headerRow) : fitMapping(chosen, sheetIndex, headerRow, width, dropped);

  const understood = understandMemberGrid(grid, { country: job.country, mapping: memberMappingOf(mapping, width) });
  if (!understood.ok) return understood;

  const warnings: LeadFileWarning[] = [];
  for (const warning of understood.warnings) {
    const kept = passedOn(warning);
    if (kept !== null) warnings.push(kept);
  }
  const base: Pick<LeadFileUnderstanding, "sheet" | "headerRow" | "columns" | "mapping"> = {
    sheet: understood.sheet,
    headerRow: understood.headerRow,
    columns: columnsOf(stats, mapping),
    mapping,
  };
  if (understood.needsMapping) {
    return {
      ok: true,
      ...base,
      needsMapping: true,
      rows: [],
      counts: { dataRows: understood.counts.dataRows, noContact: 0, noName: 0, twiceInFile: 0 },
      skipped: [],
      warnings,
    };
  }

  const cards = { n: 0 };
  let noName = 0;
  let notesCut = 0;
  const leads: LeadFileRow[] = [];
  const cell = (row: number, column: number | null): string => (column === null ? "" : (rows[row - 1]?.[column] ?? ""));
  // Every row not read as a lead is named on the check screen, with its reason: the
  // reader's own (no email or phone, the same person twice) and a row with no name.
  const skipped: LeadFileSkipped[] = understood.skipped.map((entry) => ({
    row: entry.row,
    fullName: cleanName({ full: cell(entry.row, mapping.fullName), first: cell(entry.row, mapping.firstName), last: cell(entry.row, mapping.lastName) }),
    reason: entry.reason === "no_contact" ? "no_contact" : "same_person",
  }));
  for (const person of understood.rows) {
    if (person.fullName === "") {
      noName++;
      skipped.push({ row: person.row, fullName: "", reason: "no_name" });
      continue;
    }
    const word = cut(keptText(cell(person.row, mapping.source), cards), LEAD_FILE_MAX_SOURCE_WORD_CHARS);
    const source: LeadSource = word === "" ? "other" : sourceOfWord(word);
    // The file's own word goes into the notes unless it IS one of ours, so nothing
    // the file said is lost when "Instagram" becomes Social media.
    const ours = word !== "" && fold(word) === fold(LEAD_SOURCE_WORDS[source]);
    const sourceWord = word === "" || ours ? null : word;
    const raw = cell(person.row, mapping.notes);
    const written = keptText(raw, cards);
    const joined = [written, sourceWord === null ? "" : `Heard of you from: ${sourceWord}`].filter((part) => part !== "").join("\n");
    // A cell at the reader's own limit was cut there already (`cutCell`), silently.
    if (raw.length >= MEMBER_FILE_MAX_CELL_CHARS || joined.length > LEAD_MAX_NOTES_CHARS) notesCut++;
    leads.push({
      row: person.row,
      fullName: person.fullName,
      email: person.email,
      phone: person.phone,
      source,
      sourceWord,
      notes: cut(joined, LEAD_MAX_NOTES_CHARS),
    });
  }

  const memberCards = understood.warnings.find((warning) => warning.code === "card_cells_dropped");
  const cardCells = cards.n + (memberCards !== undefined && "rows" in memberCards ? memberCards.rows : 0);
  if (cardCells > 0) warnings.push({ code: "card_cells_dropped", rows: cardCells });
  if (notesCut > 0) warnings.push({ code: "notes_cut", rows: notesCut });

  return {
    ok: true,
    ...base,
    needsMapping: false,
    rows: leads,
    // The same person twice is counted here; two people on one email or phone are the
    // plan's to settle (`filePlan.ts`), after it knows who is already a member.
    counts: { dataRows: understood.counts.dataRows, noContact: understood.counts.noContact, noName, twiceInFile: understood.counts.duplicates },
    skipped: skipped.sort((a, b) => a.row - b.row).slice(0, LEAD_FILE_SKIPPED_SHOWN),
    warnings,
  };
}
