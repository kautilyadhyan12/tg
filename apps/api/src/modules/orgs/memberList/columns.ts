// Which row holds the headings, and which column holds which field (spec Part 3
// §9.5). Two rules, and the second is the one that matters:
//
//   A heading is a HINT. A column's own cells DECIDE.
//
// A file from a gym's software has headings in a language and a wording nobody
// here has seen; a file a gym typed itself may have no headings at all, or a
// title and a blank line above them. So the heading row is found by what a row
// of headings looks like — words we know, and none of the people's own details
// that every other row holds — and a heading is believed only where enough of
// its column's cells are the thing it claims.
//
// What this never does is guess a member number or a status from values: no
// shape tells a member number from an invoice number, and a gym's status word
// is its own. Those come from a heading or from staff, or not at all.
import {
  MEMBER_FILE_HEADER_SCAN_ROWS,
  MEMBER_LIST_COLUMN_SAMPLES,
  MEMBER_LIST_HEADER_CONFIRM_SHARE,
  MEMBER_LIST_HEADER_LEAST_SCORE,
  MEMBER_LIST_HEADER_VALUE_PENALTY,
  MEMBER_LIST_HEADER_WORD_SCORE,
  MEMBER_LIST_MAX_STATUS_WORDS,
  MEMBER_LIST_MAX_TYPE_WORDS,
  MEMBER_LIST_MOST_COLUMNS_PER_FIELD,
  MEMBER_LIST_VALUES_ONLY_SHARE,
  MEMBER_LIST_VALUE_SAMPLE_CELLS,
  type MemberListColumn,
  type MemberListConfidence,
  type MemberListField,
  type MemberListMapping,
  type MemberListNeverKeptReason,
} from "@app/shared";
import type { CountryCode } from "libphonenumber-js/max";
import { couldBePhone, looksLikeEmail, tidyCell } from "./cells.js";
import { type DateEvidence, evidenceOf, looksLikeADate, mostlyDates } from "./dates.js";
import { isWritten } from "./grid.js";
import { type HeaderReading, readHeader } from "./headerWords.js";
import { type ColumnShapes, type SheetHints, cardShapedCell, governmentIdShaped, ibanShaped, neverKeptColumn, worthChecking } from "./neverKeep.js";
import { isPhoneValue } from "./phone.js";

export type Rows = readonly (readonly string[])[];

/** Which row of a sheet is the headings, counting from 0, or null where the
 *  sheet has none: the first 20 rows that hold anything are scored, two for
 *  each heading word and three off for each of somebody's own details, and the
 *  best row scoring at least two wins. A file whose first row is a title, or a
 *  page of instructions above the list, lands on the right row this way; a file
 *  that starts straight in with the people scores nothing and has no headings. */
export function findHeaderRow(rows: Rows): number | null {
  let best: number | null = null;
  let bestScore = MEMBER_LIST_HEADER_LEAST_SCORE - 1;
  let looked = 0;
  for (let r = 0; r < rows.length && looked < MEMBER_FILE_HEADER_SCAN_ROWS; r++) {
    const row = rows[r];
    if (row === undefined) continue;
    let score = 0;
    let written = 0;
    for (const cell of row) {
      const text = tidyCell(cell);
      if (text === "") continue;
      written++;
      if (looksLikeEmail(text) || couldBePhone(text)) score -= MEMBER_LIST_HEADER_VALUE_PENALTY;
      else if (readHeader(text).isHeaderWord) score += MEMBER_LIST_HEADER_WORD_SCORE;
    }
    if (written === 0) continue;
    looked++;
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

export interface ColumnStat {
  index: number;
  /** The heading as it was written, or null where the sheet has no headings. */
  header: string | null;
  reading: HeaderReading | null;
  /** How many of the column's cells were looked at (at most the sample). */
  written: number;
  emails: number;
  phones: number;
  /** Cells that read as a calendar day under one order or the other (§11.3). */
  dates: number;
  /** What each looked-at cell proved about the column's date order. */
  dateEvidence: DateEvidence[];
  /** The different words the column holds, folded, counted up to one past the
   *  membership-type cap: what tells a status or a type from a note or a date. */
  distinct: number;
  /** The self-checking shapes §11.2 drops a whole column for. */
  shapes: ColumnShapes;
  /** Why nothing of this column is kept, or null where it is kept (§11.2). */
  neverKept: MemberListNeverKeptReason | null;
  samples: string[];
}

const shareOf = (count: number, written: number): number => (written === 0 ? 0 : count / written);

export interface StatOptions {
  /** Whether a cell that could be a phone number is handed to the phone
   *  package. False counts what COULD be one, which is all that is needed to
   *  tell which sheet of a workbook holds the members, and costs nothing: the
   *  package is about 0.04 ms a call, and a workbook may hold many sheets. */
  parsePhones: boolean;
  /** What the sheet as a whole says, for the two never-keep rules no heading can
   *  settle on its own (§11.2). Left out while choosing which SHEET holds the
   *  members, where nothing is kept yet and nothing is dropped yet. */
  hints?: SheetHints;
}

/** What each column holds, over its first written cells. Every column stops at
 *  the sample, so a ten-thousand-row file costs the same as a two-hundred-row
 *  one; the phone package is only asked about a cell that could hold a number
 *  at all (`couldBePhone`). */
export function columnStats(rows: Rows, headerRow: number | null, country: CountryCode | null, options: StatOptions): ColumnStat[] {
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  const headings = headerRow === null ? undefined : rows[headerRow];
  const stats: ColumnStat[] = [];
  for (let c = 0; c < width; c++) {
    const raw = headings?.[c];
    const header = raw === undefined ? null : tidyCell(raw);
    stats.push({
      index: c,
      header: headings === undefined ? null : (header ?? ""),
      reading: header === null || header === "" ? null : readHeader(header),
      written: 0,
      emails: 0,
      phones: 0,
      dates: 0,
      dateEvidence: [],
      distinct: 0,
      shapes: { written: 0, cards: 0, ibans: 0, governmentIds: 0 },
      neverKept: null,
      samples: [],
    });
  }
  const distinctWords = stats.map(() => new Set<string>());
  let collecting = width;
  for (let r = headerRow === null ? 0 : headerRow + 1; r < rows.length && collecting > 0; r++) {
    const row = rows[r];
    if (row === undefined) continue;
    for (let c = 0; c < width; c++) {
      const stat = stats[c];
      const words = distinctWords[c];
      if (stat === undefined || words === undefined || stat.written >= MEMBER_LIST_VALUE_SAMPLE_CELLS) continue;
      const raw = row[c];
      if (raw === undefined || !isWritten(raw)) continue;
      const text = tidyCell(raw);
      if (text === "") continue;
      stat.written++;
      // A cell shaped like a payment card is never SHOWN either (§11.2). The
      // three cells beside a heading are a real file's own data on a real
      // screen, so a card left in them is a card kept.
      const card = cardShapedCell(text);
      if (!card && stat.samples.length < MEMBER_LIST_COLUMN_SAMPLES) stat.samples.push(text);
      // What the column IS, which decides both what is kept from it and what is
      // never kept. Counted in the one pass the sample already costs.
      if (options.hints !== undefined) {
        if (words.size <= MEMBER_LIST_MAX_TYPE_WORDS) words.add(text.toLowerCase());
        if (looksLikeADate(text)) {
          stat.dates++;
          stat.dateEvidence.push(evidenceOf(text));
        }
        stat.shapes.written++;
        if (card) stat.shapes.cards++;
        else if (worthChecking(text)) {
          if (ibanShaped(text)) stat.shapes.ibans++;
          else if (governmentIdShaped(text)) stat.shapes.governmentIds++;
        }
      }
      if (looksLikeEmail(text)) stat.emails++;
      // With no country on the gym, only a number written with its own country
      // code can be READ (§9.5) — but the column is still the phone column, and
      // a gym whose numbers are all local would otherwise lose it and never be
      // told to set its country. So the shape is what counts it here, and the
      // row rule still refuses to guess a country for any of them.
      else if (options.parsePhones && country !== null ? isPhoneValue(text, country) : couldBePhone(text)) stat.phones++;
      if (stat.written === MEMBER_LIST_VALUE_SAMPLE_CELLS) collecting--;
    }
  }
  const hints = options.hints;
  if (hints !== undefined) {
    for (const stat of stats) {
      stat.distinct = distinctWords[stat.index]?.size ?? 0;
      stat.neverKept = neverKeptColumn(stat.header, stat.shapes, hints);
    }
  }
  return stats;
}

interface Headed {
  stat: ColumnStat;
  reading: HeaderReading;
}

const byRankThenFilledThenPlace = (a: Headed, b: Headed): number =>
  a.reading.rank - b.reading.rank || b.stat.written - a.stat.written || a.stat.index - b.stat.index;

export interface GuessedMapping {
  mapping: MemberListMapping;
  /** Why each mapped column was taken: its heading, or its cells alone. */
  confidence: ReadonlyMap<number, MemberListConfidence>;
}

/** Which column is which, from the headings and the cells (§9.5). */
export function guessMapping(stats: readonly ColumnStat[], headerRow: number | null): GuessedMapping {
  const headed: Headed[] = [];
  // A column §11.2 never keeps is not a candidate for ANYTHING: it is dropped
  // before a field can be guessed onto it, so an export whose "Card Number"
  // really holds cards can never become this gym's member numbers.
  for (const stat of stats) {
    if (stat.neverKept !== null) continue;
    if (stat.reading !== null && stat.reading.field !== null) headed.push({ stat, reading: stat.reading });
  }
  const headedFor = (field: MemberListField): Headed[] =>
    headed.filter((h) => h.reading.field === field && !h.reading.never.has(field)).sort(byRankThenFilledThenPlace);

  const confidence = new Map<number, MemberListConfidence>();
  const taken = new Set<number>();
  const take = (index: number, why: MemberListConfidence): number => {
    taken.add(index);
    confidence.set(index, why);
    return index;
  };

  // Headings first: a column that says what it is can never be taken from it by
  // another field's values (a member number reads as a possible phone number).
  const email = headedFor("email")
    .filter((h) => shareOf(h.stat.emails, h.stat.written) >= MEMBER_LIST_HEADER_CONFIRM_SHARE)
    .map((h) => take(h.stat.index, "header"));
  const phone = headedFor("phone")
    .filter((h) => shareOf(h.stat.phones, h.stat.written) >= MEMBER_LIST_HEADER_CONFIRM_SHARE)
    .map((h) => take(h.stat.index, "header"));

  const first = headedFor("firstName");
  const last = headedFor("lastName");
  let full = headedFor("fullName");
  if (first.length > 0) {
    // Magicline writes the surname under "Name" beside a "First name" column.
    // The word is only moved where a first name is there to be beside.
    for (const h of full) if (h.reading.word === "name") last.push({ stat: h.stat, reading: { ...h.reading, field: "lastName", rank: 1 } });
    full = full.filter((h) => h.reading.word !== "name");
    last.sort(byRankThenFilledThenPlace);
  }
  const one = (candidates: readonly Headed[]): number | null => {
    const found = candidates.find((h) => !taken.has(h.stat.index));
    return found === undefined ? null : take(found.stat.index, "header");
  };
  const fullName = one(full);
  const firstName = one(first);
  const lastName = one(last);
  // Neither of these is ever guessed from what a column holds (§9.5).
  const memberNumber = one(headedFor("memberNumber"));

  // The gym's own WORDS: a status, a membership type, a payment word. A column
  // of dates is none of them (§11.1: no status is ever worked out from a date),
  // and neither is a column of too many different words — that is a note.
  const words = (field: "status" | "membershipType" | "paymentStatus", most: number): number | null =>
    one(headedFor(field).filter((h) => !mostlyDates(h.stat.dates, h.stat.written) && h.stat.distinct <= most));
  const status = words("status", MEMBER_LIST_MAX_STATUS_WORDS);
  const membershipType = words("membershipType", MEMBER_LIST_MAX_TYPE_WORDS);
  const paymentStatus = words("paymentStatus", MEMBER_LIST_MAX_STATUS_WORDS);

  // The gym's own DATES, which are believed only where the cells read as dates:
  // a heading is a hint here as everywhere else (§11.3).
  const dated = (field: "joinedOn" | "endsOn" | "dateOfBirth"): number | null =>
    one(headedFor(field).filter((h) => mostlyDates(h.stat.dates, h.stat.written)));
  const joinedOn = dated("joinedOn");
  const endsOn = dated("endsOn");
  const dateOfBirth = dated("dateOfBirth");

  // Then the columns whose heading says nothing — or that have no heading at
  // all — on their cells alone, and only where nearly every cell agrees.
  // §11.2 again, and it is NOT enough to have skipped these while reading the
  // headings: a bank account number and an Aadhaar number are both twelve or
  // so digits, which is a possible phone number, so a column dropped for its
  // heading was being taken back on its cells and shown as the member's phone.
  const unheaded = stats.filter((stat) => stat.neverKept === null && !taken.has(stat.index) && (stat.reading === null || stat.reading.field === null));
  const byValues = (field: "email" | "phone", count: (stat: ColumnStat) => number): number[] =>
    unheaded
      .filter((stat) => stat.reading?.never.has(field) !== true && shareOf(count(stat), stat.written) >= MEMBER_LIST_VALUES_ONLY_SHARE)
      .sort((a, b) => b.written - a.written || a.index - b.index)
      .map((stat) => take(stat.index, "values"));
  email.push(...byValues("email", (stat) => stat.emails));
  phone.push(...byValues("phone", (stat) => stat.phones));
  // Every column after the fifth is one more phone number to parse on every one
  // of ten thousand rows, and nobody's list has six email columns.
  email.splice(MEMBER_LIST_MOST_COLUMNS_PER_FIELD);
  phone.splice(MEMBER_LIST_MOST_COLUMNS_PER_FIELD);

  return {
    mapping: {
      sheet: null,
      headerRow,
      fullName,
      firstName,
      lastName,
      email,
      phone,
      memberNumber,
      status,
      membershipType,
      joinedOn,
      endsOn,
      paymentStatus,
      dateOfBirth,
      dontKeep: [],
      dateOrder: [],
    },
    confidence,
  };
}

/** Which field a column was given, if any. */
export function fieldOf(mapping: MemberListMapping, index: number): MemberListField | null {
  if (mapping.email.includes(index)) return "email";
  if (mapping.phone.includes(index)) return "phone";
  if (mapping.fullName === index) return "fullName";
  if (mapping.firstName === index) return "firstName";
  if (mapping.lastName === index) return "lastName";
  if (mapping.memberNumber === index) return "memberNumber";
  if (mapping.status === index) return "status";
  if (mapping.membershipType === index) return "membershipType";
  if (mapping.joinedOn === index) return "joinedOn";
  if (mapping.endsOn === index) return "endsOn";
  if (mapping.paymentStatus === index) return "paymentStatus";
  if (mapping.dateOfBirth === index) return "dateOfBirth";
  return null;
}

/** Every column as staff see it: its heading, three of its own cells, and what
 *  the server made of it. A guess staff cannot see is a guess they cannot
 *  correct, so every column is here — including the ones nothing was made of. */
export function describeColumns(
  stats: readonly ColumnStat[],
  mapping: MemberListMapping,
  confidence: ReadonlyMap<number, MemberListConfidence>,
  whole: MemberListConfidence | null,
): MemberListColumn[] {
  return stats.map((stat) => {
    const guess = fieldOf(mapping, stat.index);
    return {
      index: stat.index,
      // A column §11.2 drops shows its heading and its reason and NOTHING of
      // its own cells: three sample cells of a bank column are three people's
      // bank details, and the whole point is that they never leave the worker.
      header: stat.header,
      samples: stat.neverKept === null ? stat.samples : [],
      guess,
      confidence: guess === null ? null : (whole ?? confidence.get(stat.index) ?? null),
      headerSays: stat.reading?.field ?? null,
      neverKept: stat.neverKept,
    };
  });
}
