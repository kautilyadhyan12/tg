// What the server makes of one uploaded file (spec Part 3 §9.5): which sheet,
// which row of headings, which column is which, and every row cleaned into the
// five things a member list keeps — a name, an email, a phone, a member number
// and the gym's own status word.
//
// Nothing here decides anything about a PERSON. It reads a file and says what
// it found, with every problem in plain words; who is new, who has gone and who
// is already in the app is 3a-iii's rule, worked out from these rows and the
// list already stored. That is why this file has no clock, no database and no
// network: the same file understood twice is the same rows twice.
//
// The order of the rules is the order of §9.5 and it matters:
//   never-keep → each cell → placeholders → usable → identity → duplicates
// A front-desk address on 300 rows has to go BEFORE "has this row any contact
// details at all", or 300 people would be invited to one inbox — and §11.2's
// never-keep rules go before ALL of it, so a column of card numbers is gone
// before any field can be guessed onto it and before any cell of it is sampled
// into an answer. Nothing dropped here ever reaches the request's own thread.
import { createHash } from "node:crypto";
import {
  MEMBER_LIST_DATE_FIELDS,
  MEMBER_LIST_MAX_DATA_ROWS,
  MEMBER_LIST_MAX_EXTRA_CHARS,
  MEMBER_LIST_MAX_EXTRA_FIELDS,
  MEMBER_LIST_MAX_FIELD_KEY_CHARS,
  MEMBER_LIST_MAX_FIELD_LABEL_CHARS,
  MEMBER_LIST_MAX_STATUS_WORDS,
  MEMBER_LIST_MAX_TYPE_WORDS,
  MEMBER_LIST_MOST_COLUMNS_PER_FIELD,
  MEMBER_LIST_PLACEHOLDERS_SHOWN,
  MEMBER_LIST_PLACEHOLDER_ROWS,
  MEMBER_LIST_SKIPPED_SHOWN,
  type MemberFileGrid,
  type MemberFileSheet,
  type MemberListColumn,
  type MemberListConfidence,
  type MemberListDateColumn,
  type MemberListDateField,
  type MemberListDateOrder,
  type MemberListExtraField,
  type MemberListField,
  type MemberListMapping,
  type MemberListRow,
  type MemberListSkipped,
  type MemberListUnderstandResult,
  type MemberListWarning,
} from "@app/shared";
import type { CountryCode } from "libphonenumber-js/max";
import { tidyCell } from "./cells.js";
import { type ColumnStat, type Rows, columnStats, describeColumns, findHeaderRow, guessMapping } from "./columns.js";
import { evidenceOf, mostlyDates, readDay, settleOrder } from "./dates.js";
import { booleanStatus, cleanEmail, cleanMemberNumber, cleanName, cleanStatus, cut, fold, identityKey, isBooleanWord } from "./fields.js";
import { isWritten } from "./grid.js";
import { endsOrRenews, normaliseHeader, readHeader } from "./headerWords.js";
import { type SheetHints, cardShapedCell, sheetHints } from "./neverKeep.js";
import { type PhoneReading, readCountry, readPhone } from "./phone.js";

/** A `?` anywhere in a name: a Windows export of a name in an alphabet the code
 *  page could not write, so the letters were lost when the file was saved.
 *  Measured on Excel's own ANSI export (2026-09-19): `Łukasz` came out
 *  `?ukasz` and `अमित` came out `????`, with no letter left beside the marks at
 *  all — which is why this counts the mark and not what sits next to it. */
const QUESTION_MARK_IN_NAME = /\?/;
/** A name read in the wrong code page. `H‚lŠne` is a DOS file read as 1252;
 *  `Šimun` is a real Croatian name, so those letters count only between two
 *  small letters, where no alphabet puts them. */
const GARBLED_NEXT_TO_LETTER = /[\u201a\u0192\u201e\u2020\u2021\u02c6\u2030\u2039]\p{L}|\p{L}[\u201a\u0192\u201e\u2020\u2021\u02c6\u2030\u2039]/u;
const GARBLED_INSIDE_A_WORD = /\p{Ll}[\u0160\u0152\u017d\u0178]\p{Ll}/u;
/** "Is Active" is a column of yes and no; the word it stands for is "Active". */
const LEADING_IS = /^is\s+/i;

export interface RememberedMapping {
  /** The fingerprint of the headings the mapping was made for. */
  fingerprint: string;
  mapping: MemberListMapping;
}

export interface UnderstandOptions {
  /** The gym's country, for the phone numbers. A country the phone package does
   *  not know is treated as none at all — nothing is ever read by a guess. */
  country: string | null;
  /** Staff's own mapping, which is used as sent: nothing is guessed. */
  mapping?: MemberListMapping | null;
  /** The mapping this gym's last confirmed upload used, and the headings it was
   *  made for. Used again where this file's headings are the same ones. */
  remembered?: RememberedMapping | null;
}

/** The headings' own fingerprint, so the same export next month is mapped the
 *  same way without guessing again. Built from the headings as the word lists
 *  read them, so a change of case or of punctuation is still the same file.
 *  It is taken from the row itself and costs nothing, which is what lets a
 *  remembered mapping be tried BEFORE the file is read: a gym whose headings we
 *  cannot read at all is exactly the gym that mapped them by hand, and it must
 *  not have to do it again every month. */
export function fingerprintOf(rows: Rows, headerRow: number | null): string | null {
  if (headerRow === null) return null;
  const row = rows[headerRow];
  if (row === undefined) return null;
  return createHash("sha256")
    .update(row.map((cell) => normaliseHeader(cell)).join("\n"), "utf8")
    .digest("hex");
}

/** A mapping cut to what this sheet can hold: a column past its width, or a
 *  list longer than one person can have, is dropped rather than obeyed — and so
 *  is a column §11.2 never keeps. THAT is what "cannot be switched back on"
 *  comes to: staff may map any column they like except those, and a mapping
 *  that names one is obeyed for everything else and misses that column, which
 *  the preview shows with its reason and no guess beside it. */
function fitMapping(mapping: MemberListMapping, width: number, rows: number, dropped: ReadonlySet<number>): MemberListMapping {
  const kept = (index: number): boolean => index < width && !dropped.has(index);
  const inside = (index: number | null): number | null => (index !== null && kept(index) ? index : null);
  const list = (indexes: readonly number[]): number[] => [...new Set(indexes.filter(kept))].slice(0, MEMBER_LIST_MOST_COLUMNS_PER_FIELD);
  return {
    sheet: mapping.sheet,
    headerRow: mapping.headerRow !== null && mapping.headerRow < rows ? mapping.headerRow : null,
    fullName: inside(mapping.fullName),
    firstName: inside(mapping.firstName),
    lastName: inside(mapping.lastName),
    email: list(mapping.email),
    phone: list(mapping.phone),
    memberNumber: inside(mapping.memberNumber),
    status: inside(mapping.status),
    membershipType: inside(mapping.membershipType),
    joinedOn: inside(mapping.joinedOn),
    endsOn: inside(mapping.endsOn),
    paymentStatus: inside(mapping.paymentStatus),
    dateOfBirth: inside(mapping.dateOfBirth),
    dontKeep: [...new Set(mapping.dontKeep.filter((index) => index < width))],
    dateOrder: mapping.dateOrder.filter((flip) => kept(flip.column)),
  };
}

/** Which columns of this sheet are never kept (§11.2), by their place in it. */
const droppedColumns = (stats: readonly ColumnStat[]): Set<number> =>
  new Set(stats.filter((stat) => stat.neverKept !== null).map((stat) => stat.index));

/** The headings as the never-keep rules read them, for the two facts no single
 *  heading can settle on its own: whether the sheet carries an address at all
 *  (which makes a bare "PIN" a postcode and not a door code) and whether it
 *  carries bank columns (which makes a bare "Account Number" a bank account
 *  and not the gym's own number for a member). */
function hintsOf(rows: Rows, headerRow: number | null): SheetHints {
  if (headerRow === null) return { hasAddress: false, hasBank: false };
  return sheetHints((rows[headerRow] ?? []).map((cell) => tidyCell(cell)));
}

/** A key for one of the gym's own columns, built from the heading the gym
 *  wrote. 3a-v-b writes an entry's document under it, so the same heading must
 *  give the same key next month — which is why it is built from the heading and
 *  not from where the column happens to sit. A column with no heading has
 *  nothing else to be named by, so it is named by its place. */
function extraKey(header: string | null, index: number, taken: Set<string>): string {
  const room = MEMBER_LIST_MAX_FIELD_KEY_CHARS - 6;
  const base = normaliseHeader(header ?? "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, room);
  let key = base === "" ? `column_${String(index + 1)}` : base;
  if (taken.has(key)) {
    let n = 2;
    while (taken.has(`${key}_${String(n)}`)) n++;
    key = `${key}_${String(n)}`;
  }
  taken.add(key);
  return key;
}

const widthOf = (rows: Rows): number => rows.reduce((widest, row) => Math.max(widest, row.length), 0);

/** Which sheet holds the members: the first that yields an email or a phone
 *  column. The others are named in a warning, never read. Every sheet is looked
 *  at with the cheap rules only — no phone number is parsed until the sheet is
 *  chosen — so a workbook of many sheets costs no more than one. */
function chooseSheet(sheets: readonly MemberFileSheet[], country: CountryCode | null, remembered: RememberedMapping | null): number {
  if (sheets.length <= 1) return 0;
  // The sheet whose headings this gym's last upload was mapped on, first.
  const last = remembered === null ? null : remembered.mapping.sheet;
  if (remembered !== null && last !== null) {
    const sheet = sheets[last];
    if (sheet !== undefined && fingerprintOf(sheet.rows, remembered.mapping.headerRow) === remembered.fingerprint) return last;
  }
  for (let index = 0; index < sheets.length; index++) {
    const sheet = sheets[index];
    if (sheet === undefined) continue;
    const headerRow = findHeaderRow(sheet.rows);
    const { mapping } = guessMapping(columnStats(sheet.rows, headerRow, country, { parsePhones: false }), headerRow);
    if (mapping.email.length > 0 || mapping.phone.length > 0) return index;
  }
  return 0;
}

interface Draft {
  row: number;
  fullName: string;
  email: string | null;
  phone: string | null;
  memberNumber: string | null;
  status: string | null;
  unusualPhone: boolean;
  shortened: boolean;
  needsCountry: boolean;
}

/** One date column, its order already settled for the whole column (§11.3). */
interface DatePlan {
  field: MemberListDateField;
  column: number;
  order: MemberListDateOrder;
  /** Where the order came from, and the cells that could not be read — filled
   *  as the rows go by, and said back to staff in `dateColumns`. */
  from: MemberListDateColumn["from"];
  notRead: number;
  example: MemberListDateColumn["example"];
}

/** One column of the gym's own WORDS — a membership type or a payment status.
 *  `words` is the heading a column of yes and no stands for, exactly as the
 *  status column uses it: "Paid" with a Yes and a No reads "Paid" and "Not paid". */
interface WordPlan {
  column: number;
  words: string | null;
}

/** Everything Part 2 added, worked out once for the file and then read off
 *  every row (§11.1): the two word columns, the three date columns, and the
 *  gym's own extra columns in the order the rows carry them. */
interface WidePlan {
  membershipType: WordPlan | null;
  paymentStatus: WordPlan | null;
  dates: DatePlan[];
  extra: readonly MemberListExtraField[];
}

interface WideCounts {
  /** Cells dropped on their own for being shaped like a payment card (§11.2). */
  cards: number;
  /** Cells of the gym's own columns that were longer than we keep. */
  cellsCut: number;
}

interface Wide {
  membershipType: string | null;
  joinedOn: string | null;
  endsOn: string | null;
  paymentStatus: string | null;
  dateOfBirth: string | null;
  extra: string[];
}

/** One row's wider cells. A card-shaped cell is dropped wherever it sits, so
 *  this is the only place a gym's own column is read at all — and a column
 *  §11.2 dropped never reaches here, because it is not in the plan. */
function wideRow(row: readonly string[], plan: WidePlan, counts: WideCounts): Wide {
  const word = (at: WordPlan | null): string | null => {
    if (at === null) return null;
    const raw = row[at.column] ?? "";
    const value = at.words === null ? cleanStatus(raw) : booleanStatus(raw, at.words);
    if (value === null) return null;
    if (cardShapedCell(value)) {
      counts.cards++;
      return null;
    }
    return value;
  };
  const days: Record<MemberListDateField, string | null> = { joinedOn: null, endsOn: null, dateOfBirth: null };
  for (const date of plan.dates) {
    const raw = row[date.column] ?? "";
    const day = readDay(raw, date.order);
    if (day === null) {
      if (isWritten(raw)) date.notRead++;
      continue;
    }
    days[date.field] = day;
    // The one cell the reading is SHOWN with: one that could have been read
    // either way round, which is the only kind the column's order decided.
    if (date.example === null && evidenceOf(raw) === "either") date.example = { raw: tidyCell(raw), read: day };
  }
  const extra: string[] = [];
  for (const field of plan.extra) {
    const text = tidyCell(row[field.column] ?? "");
    if (text !== "" && cardShapedCell(text)) {
      counts.cards++;
      extra.push("");
      continue;
    }
    if (text.length > MEMBER_LIST_MAX_EXTRA_CHARS) {
      counts.cellsCut++;
      extra.push(cut(text, MEMBER_LIST_MAX_EXTRA_CHARS));
      continue;
    }
    extra.push(text);
  }
  return {
    membershipType: word(plan.membershipType),
    joinedOn: days.joinedOn,
    endsOn: days.endsOn,
    paymentStatus: word(plan.paymentStatus),
    dateOfBirth: days.dateOfBirth,
    extra,
  };
}

/** One row's cells as one person. The phone and email columns are tried in
 *  order: a row whose first email is empty or unreadable falls back to the
 *  next, which is how a file with "Email" and "Secondary email" is read. */
function draftRow(row: readonly string[], at: number, mapping: MemberListMapping, country: CountryCode | null, status: string | null): Draft {
  const cell = (index: number | null): string => (index === null ? "" : (row[index] ?? ""));
  let email: string | null = null;
  for (const index of mapping.email) {
    email = cleanEmail(cell(index));
    if (email !== null) break;
  }
  let phone: PhoneReading = { e164: null, unusual: false, shortened: false, needsCountry: false };
  let shortened = false;
  let needsCountry = false;
  for (const index of mapping.phone) {
    phone = readPhone(cell(index), country);
    shortened = shortened || phone.shortened;
    needsCountry = needsCountry || phone.needsCountry;
    if (phone.e164 !== null) break;
  }
  const memberNumber = cleanMemberNumber(cell(mapping.memberNumber));
  return {
    row: at + 1,
    fullName: cleanName({ full: cell(mapping.fullName), first: cell(mapping.firstName), last: cell(mapping.lastName) }),
    email,
    phone: phone.e164,
    memberNumber: memberNumber.value,
    status,
    unusualPhone: phone.unusual,
    shortened: (phone.e164 === null && shortened) || (memberNumber.value === null && memberNumber.shortened),
    needsCountry: phone.e164 === null && needsCountry,
  };
}

/** Every value that sits on more rows than a person's own ever could: the front
 *  desk's own address or number, put in the file so no row is empty. It belongs
 *  to nobody, so it is dropped from every row that carries it (§9.5). */
function placeholdersIn(counts: ReadonlyMap<string, number>): Set<string> {
  const found = new Set<string>();
  for (const [value, rows] of counts) if (rows > MEMBER_LIST_PLACEHOLDER_ROWS) found.add(value);
  return found;
}

/** How many different words a column holds, and whether they are all a yes or
 *  a no. Counted over EVERY row and not the sample: one unexpected word on row
 *  9,000 is exactly what says a column is a note and not a state (§9.5), and
 *  stopping one past the cap is what keeps that cheap. */
function wordsInColumn(rows: Rows, from: number, column: number, cap: number): { distinct: number; boolish: boolean } {
  const seen = new Set<string>();
  let boolish = true;
  for (let r = from; r < rows.length && seen.size <= cap; r++) {
    const text = tidyCell(rows[r]?.[column] ?? "");
    if (text === "") continue;
    seen.add(text.toLowerCase());
    if (!isBooleanWord(text)) boolish = false;
  }
  return { distinct: seen.size, boolish };
}

/** The word a column of yes and no stands for: "Is Active" reads "Active" and
 *  "Not active". A heading that already names the field plainly keeps its cells
 *  as they were typed. */
function standsFor(header: string, field: MemberListField): string | null {
  const reading = readHeader(header);
  if (header === "" || (reading.field === field && reading.rank === 0)) return null;
  return header.replace(LEADING_IS, "");
}

const countUp = (counts: Map<string, number>, value: string | null): void => {
  if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
};

/** A gym's own words as filter chips: the commonest first, and ties settled by
 *  the word itself so the same file always reads back the same way. */
const chipsOf = (words: ReadonlyMap<string, { label: string; count: number }>): { label: string; count: number }[] =>
  [...words.values()].sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

export function understandMemberGrid(grid: MemberFileGrid, options: UnderstandOptions): MemberListUnderstandResult {
  const country = readCountry(options.country);
  const chosen = options.mapping ?? null;
  const remembered = options.remembered ?? null;
  const askedFor = chosen?.sheet;
  const sheetIndex = askedFor !== undefined && askedFor !== null && askedFor < grid.sheets.length ? askedFor : chooseSheet(grid.sheets, country, remembered);
  const sheet = grid.sheets[sheetIndex];
  if (sheet === undefined) return { ok: false, refusal: { code: "no_rows" } };
  const rows = sheet.rows;
  const width = widthOf(rows);

  // A remembered mapping is tried on the row it was MADE for, not on the row
  // the guess would land on: a gym whose headings we cannot read at all is
  // exactly the gym that mapped them by hand.
  const remembers = chosen !== null || remembered === null ? null : fingerprintOf(rows, remembered.mapping.headerRow) === remembered.fingerprint ? remembered : null;
  const chosenHeaderRow = chosen === null || chosen.headerRow === null || chosen.headerRow >= rows.length ? null : chosen.headerRow;
  const headerRow = chosen !== null ? chosenHeaderRow : remembers !== null ? remembers.mapping.headerRow : findHeaderRow(rows);
  // §11.2 runs HERE, before a field can be guessed onto any column: the cells
  // of a column it drops are counted for the verdict and then never used for
  // anything else — not a sample, not a mapping, not a row.
  const hints = hintsOf(rows, headerRow);
  const stats = columnStats(rows, headerRow, country, { parsePhones: true, hints });
  const dropped = droppedColumns(stats);
  const fitted = chosen === null ? null : fitMapping(chosen, width, rows.length, dropped);
  const fingerprint = fingerprintOf(rows, headerRow);

  let whole: MemberListConfidence | null = null;
  let mapping: MemberListMapping;
  let confidence: ReadonlyMap<number, MemberListConfidence> = new Map();
  if (fitted !== null) {
    whole = "chosen";
    mapping = fitted;
  } else if (remembers !== null) {
    whole = "remembered";
    mapping = { ...fitMapping(remembers.mapping, width, rows.length, dropped), sheet: null, headerRow };
  } else {
    const guessed = guessMapping(stats, headerRow);
    mapping = guessed.mapping;
    confidence = guessed.confidence;
  }

  const firstDataRow = headerRow === null ? 0 : headerRow + 1;
  let dataRows = 0;
  for (let r = firstDataRow; r < rows.length; r++) {
    const row = rows[r];
    if (row !== undefined && row.some(isWritten)) dataRows++;
  }

  // A sheet cut at its limit is refused rather than half read: the column or the
  // people past the cut are exactly the ones nobody would notice were missing.
  if (sheet.truncated.columns) return { ok: false, refusal: { code: "too_many_columns" } };
  if (sheet.truncated.rows || dataRows > MEMBER_LIST_MAX_DATA_ROWS) return { ok: false, refusal: { code: "too_many_rows" } };
  if (dataRows === 0) return { ok: false, refusal: { code: "no_rows" } };

  const warnings: MemberListWarning[] = grid.warnings.map((code) => ({ code }));
  if (headerRow === null) warnings.push({ code: "no_header_row" });
  // Named before the read one is taken out, so an unnamed sheet is called by
  // its own place in the workbook and never by its place in what is left.
  const ignored = grid.sheets.map((other, index) => other.name ?? `Sheet ${String(index + 1)}`).filter((_, index) => index !== sheetIndex);
  if (ignored.length > 0) warnings.push({ code: "other_sheets_ignored", sheets: ignored });

  const describe = (map: MemberListMapping): MemberListColumn[] => describeColumns(stats, map, confidence, whole);
  const nothingRead = mapping.email.length === 0 && mapping.phone.length === 0;
  if (nothingRead) {
    return {
      ok: true,
      kind: grid.kind,
      facts: grid.facts,
      sheet: { index: sheetIndex, name: sheet.name },
      headerRow,
      headerFingerprint: fingerprint,
      columns: describe(mapping),
      mapping,
      needsMapping: true,
      rows: [],
      // Nothing is kept from a file staff have not yet mapped, so it has no
      // extra fields and no dates either: which of the gym's OWN columns are
      // kept depends on which ones the standard fields took.
      extraFields: [],
      dateColumns: [],
      endsOnKind: null,
      counts: {
        dataRows,
        kept: 0,
        noContact: 0,
        duplicates: 0,
        withEmail: 0,
        withPhone: 0,
        withMemberNumber: 0,
        withStatus: 0,
        withMembershipType: 0,
        withJoinedOn: 0,
        withEndsOn: 0,
        withPaymentStatus: 0,
        withDateOfBirth: 0,
      },
      statuses: [],
      membershipTypes: [],
      paymentStatuses: [],
      skipped: [],
      warnings,
    };
  }

  // The status column, whose words are the gym's own. A column of more than
  // twenty different words is not a state of membership — it is a note, an
  // address or a date — so it is never guessed, and a hand mapping of one is
  // refused rather than turned into twenty filters nobody can use.
  let statusColumn = mapping.status;
  let statusWords: string | null = null;
  if (statusColumn !== null) {
    const { distinct, boolish } = wordsInColumn(rows, firstDataRow, statusColumn, MEMBER_LIST_MAX_STATUS_WORDS);
    if (distinct > MEMBER_LIST_MAX_STATUS_WORDS) {
      if (chosen !== null) return { ok: false, refusal: { code: "mapped_column_not_status", column: statusColumn } };
      statusColumn = null;
      mapping = { ...mapping, status: null };
    } else if (boolish && distinct > 0) {
      // Yes and no under a heading such as "Active" read "Active" and "Not
      // active"; under a heading that already says "status" they stay as typed.
      statusWords = standsFor(stats[statusColumn]?.header ?? "", "status");
    }
  }

  // The gym's own word for what a person BOUGHT and whether they have PAID
  // (§11.1), read the same way and under the same guard. A column of too many
  // different words is a note, not a state; a column of dates is neither, and
  // §11.1 is explicit that no status is ever worked out from a date. Where
  // staff mapped such a column themselves it is left unread rather than
  // refused — the preview shows it with no guess beside it — because unlike
  // the status these two are new and no refusal of theirs has ever been shown.
  const wordPlan = (field: "membershipType" | "paymentStatus", cap: number): WordPlan | null => {
    const column = mapping[field];
    if (column === null) return null;
    const stat = stats[column];
    if (stat !== undefined && mostlyDates(stat.dates, stat.written)) {
      mapping = { ...mapping, [field]: null };
      return null;
    }
    const { distinct, boolish } = wordsInColumn(rows, firstDataRow, column, cap);
    if (distinct > cap) {
      mapping = { ...mapping, [field]: null };
      return null;
    }
    return { column, words: boolish && distinct > 0 ? standsFor(stat?.header ?? "", field) : null };
  };
  const membershipTypePlan = wordPlan("membershipType", MEMBER_LIST_MAX_TYPE_WORDS);
  const paymentStatusPlan = wordPlan("paymentStatus", MEMBER_LIST_MAX_STATUS_WORDS);

  // The date columns, each settled ONCE for the whole column (§11.3).
  const flipped = new Map(mapping.dateOrder.map((flip) => [flip.column, flip.order]));
  const datePlans: DatePlan[] = [];
  for (const field of MEMBER_LIST_DATE_FIELDS) {
    const column = mapping[field];
    if (column === null) continue;
    const settled = settleOrder(stats[column]?.dateEvidence ?? [], options.country, flipped.get(column) ?? null);
    datePlans.push({ field, column, order: settled.order, from: settled.from, notRead: 0, example: null });
  }
  const endsOnKind = mapping.endsOn === null ? null : endsOrRenews(stats[mapping.endsOn]?.header ?? null);

  // Every other column is this gym's OWN field, under this gym's own heading
  // (§11.1) — except the ones §11.2 never keeps, and the ones staff ticked
  // "don't keep". A column empty on every row keeps nothing and is not one.
  const standard = new Set<number>();
  for (const at of [mapping.fullName, mapping.firstName, mapping.lastName, mapping.memberNumber, statusColumn, mapping.membershipType, mapping.joinedOn, mapping.endsOn, mapping.paymentStatus, mapping.dateOfBirth]) {
    if (at !== null) standard.add(at);
  }
  for (const at of [...mapping.email, ...mapping.phone]) standard.add(at);
  const notWanted = new Set(mapping.dontKeep);
  const takenKeys = new Set<string>();
  const extraFields: MemberListExtraField[] = [];
  let extraLeftOut = 0;
  for (const stat of stats) {
    if (stat.neverKept !== null || standard.has(stat.index) || notWanted.has(stat.index) || stat.written === 0) continue;
    if (extraFields.length >= MEMBER_LIST_MAX_EXTRA_FIELDS) {
      extraLeftOut++;
      continue;
    }
    extraFields.push({ key: extraKey(stat.header, stat.index, takenKeys), label: cut(stat.header ?? "", MEMBER_LIST_MAX_FIELD_LABEL_CHARS), column: stat.index });
  }
  const plan: WidePlan = { membershipType: membershipTypePlan, paymentStatus: paymentStatusPlan, dates: datePlans, extra: extraFields };
  const wideCounts: WideCounts = { cards: 0, cellsCut: 0 };

  const drafts: (Draft & Wide)[] = [];
  const emailRows = new Map<string, number>();
  const phoneRows = new Map<string, number>();
  let questionMarks = 0;
  let garbled = 0;
  let shortened = 0;
  let needsCountry = 0;
  for (let r = firstDataRow; r < rows.length; r++) {
    const row = rows[r];
    if (row === undefined || !row.some(isWritten)) continue;
    const raw = statusColumn === null ? "" : (row[statusColumn] ?? "");
    const status = statusWords === null ? cleanStatus(raw) : booleanStatus(raw, statusWords);
    const narrow = draftRow(row, r, mapping, country, status);
    // A name that is a card number is a card number, whatever column it sat in.
    const draft: Draft & Wide = { ...narrow, ...wideRow(row, plan, wideCounts) };
    if (cardShapedCell(draft.fullName)) {
      wideCounts.cards++;
      draft.fullName = "";
    }
    if (QUESTION_MARK_IN_NAME.test(draft.fullName)) questionMarks++;
    if (GARBLED_NEXT_TO_LETTER.test(draft.fullName) || GARBLED_INSIDE_A_WORD.test(draft.fullName)) garbled++;
    if (draft.shortened) shortened++;
    if (draft.needsCountry) needsCountry++;
    countUp(emailRows, draft.email);
    countUp(phoneRows, draft.phone);
    drafts.push(draft);
  }

  const placeholderEmails = placeholdersIn(emailRows);
  const placeholderPhones = placeholdersIn(phoneRows);
  const placeholderValues = [...placeholderEmails, ...placeholderPhones];
  let placeholderCount = 0;

  const keptRows: MemberListRow[] = [];
  const skipped: MemberListSkipped[] = [];
  const keys = new Set<string>();
  const statuses = new Map<string, { label: string; count: number }>();
  const membershipTypes = new Map<string, { label: string; count: number }>();
  const paymentStatuses = new Map<string, { label: string; count: number }>();
  const chip = (into: Map<string, { label: string; count: number }>, label: string): void => {
    const folded = fold(label);
    const already = into.get(folded);
    if (already === undefined) into.set(folded, { label, count: 1 });
    else already.count++;
  };
  const keptEmails = new Map<string, number>();
  let noContact = 0;
  let duplicates = 0;
  let unusualPhones = 0;
  const counts = {
    withEmail: 0,
    withPhone: 0,
    withMemberNumber: 0,
    withStatus: 0,
    withMembershipType: 0,
    withJoinedOn: 0,
    withEndsOn: 0,
    withPaymentStatus: 0,
    withDateOfBirth: 0,
  };
  const skip = (row: number, reason: "no_contact" | "duplicate"): void => {
    if (skipped.length < MEMBER_LIST_SKIPPED_SHOWN) skipped.push({ row, reason });
  };
  for (const draft of drafts) {
    const email = draft.email !== null && placeholderEmails.has(draft.email) ? null : draft.email;
    const phone = draft.phone !== null && placeholderPhones.has(draft.phone) ? null : draft.phone;
    if (email !== draft.email || phone !== draft.phone) placeholderCount++;
    if (email === null && phone === null) {
      noContact++;
      skip(draft.row, "no_contact");
      continue;
    }
    const person = { fullName: draft.fullName, email, phone, memberNumber: draft.memberNumber, status: draft.status };
    const key = identityKey(person);
    if (keys.has(key)) {
      duplicates++;
      skip(draft.row, "duplicate");
      continue;
    }
    keys.add(key);
    keptRows.push({
      row: draft.row,
      ...person,
      membershipType: draft.membershipType,
      joinedOn: draft.joinedOn,
      endsOn: draft.endsOn,
      paymentStatus: draft.paymentStatus,
      dateOfBirth: draft.dateOfBirth,
      extra: draft.extra,
      identityKey: key,
    });
    if (email !== null) {
      counts.withEmail++;
      keptEmails.set(email, (keptEmails.get(email) ?? 0) + 1);
    }
    if (phone !== null) {
      counts.withPhone++;
      if (draft.unusualPhone) unusualPhones++;
    }
    if (draft.memberNumber !== null) counts.withMemberNumber++;
    if (draft.status !== null) {
      counts.withStatus++;
      chip(statuses, draft.status);
    }
    if (draft.membershipType !== null) {
      counts.withMembershipType++;
      chip(membershipTypes, draft.membershipType);
    }
    if (draft.paymentStatus !== null) {
      counts.withPaymentStatus++;
      chip(paymentStatuses, draft.paymentStatus);
    }
    if (draft.joinedOn !== null) counts.withJoinedOn++;
    if (draft.endsOn !== null) counts.withEndsOn++;
    if (draft.dateOfBirth !== null) counts.withDateOfBirth++;
  }
  let sharedEmails = 0;
  for (const row of keptRows) if (row.email !== null && (keptEmails.get(row.email) ?? 0) > 1) sharedEmails++;

  const counted: MemberListWarning[] = [
    { code: "question_marks_in_names", rows: questionMarks },
    { code: "garbled_names", rows: garbled },
    { code: "shortened_by_excel", rows: shortened },
    { code: "phones_need_country", rows: needsCountry },
    { code: "phones_unusual", rows: unusualPhones },
    { code: "shared_emails", rows: sharedEmails },
    { code: "cells_cut", rows: wideCounts.cellsCut },
    { code: "dates_not_read", rows: datePlans.reduce((sum, date) => sum + date.notRead, 0) },
    { code: "card_cells_dropped", rows: wideCounts.cards },
  ];
  for (const warning of counted) if ("rows" in warning && warning.rows > 0) warnings.push(warning);
  if (extraLeftOut > 0) warnings.push({ code: "extra_columns_left_out", columns: extraLeftOut });
  if (placeholderCount > 0) warnings.push({ code: "placeholders", rows: placeholderCount, values: placeholderValues.slice(0, MEMBER_LIST_PLACEHOLDERS_SHOWN) });

  return {
    ok: true,
    kind: grid.kind,
    facts: grid.facts,
    sheet: { index: sheetIndex, name: sheet.name },
    headerRow,
    headerFingerprint: fingerprint,
    columns: describe(mapping),
    mapping,
    needsMapping: false,
    rows: keptRows,
    extraFields,
    dateColumns: datePlans.map((date) => ({ column: date.column, field: date.field, order: date.order, from: date.from, example: date.example, notRead: date.notRead })),
    endsOnKind,
    counts: { dataRows, kept: keptRows.length, noContact, duplicates, ...counts },
    statuses: chipsOf(statuses),
    membershipTypes: chipsOf(membershipTypes),
    paymentStatuses: chipsOf(paymentStatuses),
    skipped,
    warnings,
  };
}
