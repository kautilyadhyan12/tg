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
//   each cell → placeholders → usable → identity → duplicates
// A front-desk address on 300 rows has to go BEFORE "has this row any contact
// details at all", or 300 people would be invited to one inbox.
import { createHash } from "node:crypto";
import {
  MEMBER_LIST_MAX_DATA_ROWS,
  MEMBER_LIST_MAX_STATUS_WORDS,
  MEMBER_LIST_MOST_COLUMNS_PER_FIELD,
  MEMBER_LIST_PLACEHOLDERS_SHOWN,
  MEMBER_LIST_PLACEHOLDER_ROWS,
  MEMBER_LIST_SKIPPED_SHOWN,
  type MemberFileGrid,
  type MemberFileSheet,
  type MemberListColumn,
  type MemberListConfidence,
  type MemberListMapping,
  type MemberListRow,
  type MemberListSkipped,
  type MemberListUnderstandResult,
  type MemberListWarning,
} from "@app/shared";
import type { CountryCode } from "libphonenumber-js/max";
import { tidyCell } from "./cells.js";
import { type Rows, columnStats, describeColumns, findHeaderRow, guessMapping } from "./columns.js";
import { booleanStatus, cleanEmail, cleanMemberNumber, cleanName, cleanStatus, fold, identityKey, isBooleanWord } from "./fields.js";
import { isWritten } from "./grid.js";
import { normaliseHeader, readHeader } from "./headerWords.js";
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
 *  list longer than one person can have, is dropped rather than obeyed. */
function fitMapping(mapping: MemberListMapping, width: number, rows: number): MemberListMapping {
  const inside = (index: number | null): number | null => (index !== null && index < width ? index : null);
  const list = (indexes: readonly number[]): number[] => [...new Set(indexes.filter((index) => index < width))].slice(0, MEMBER_LIST_MOST_COLUMNS_PER_FIELD);
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
  };
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

const countUp = (counts: Map<string, number>, value: string | null): void => {
  if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
};

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

  const fitted = chosen === null ? null : fitMapping(chosen, width, rows.length);
  // A remembered mapping is tried on the row it was MADE for, not on the row
  // the guess would land on: a gym whose headings we cannot read at all is
  // exactly the gym that mapped them by hand.
  const remembers = fitted !== null || remembered === null ? null : fingerprintOf(rows, remembered.mapping.headerRow) === remembered.fingerprint ? remembered : null;
  const headerRow = fitted !== null ? fitted.headerRow : remembers !== null ? remembers.mapping.headerRow : findHeaderRow(rows);
  const stats = columnStats(rows, headerRow, country, { parsePhones: true });
  const fingerprint = fingerprintOf(rows, headerRow);

  let whole: MemberListConfidence | null = null;
  let mapping: MemberListMapping;
  let confidence: ReadonlyMap<number, MemberListConfidence> = new Map();
  if (fitted !== null) {
    whole = "chosen";
    mapping = fitted;
  } else if (remembers !== null) {
    whole = "remembered";
    mapping = { ...fitMapping(remembers.mapping, width, rows.length), sheet: null, headerRow };
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
  const ignored = grid.sheets.filter((_, index) => index !== sheetIndex).map((other, index) => other.name ?? `Sheet ${String(index + 1)}`);
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
      counts: { dataRows, kept: 0, noContact: 0, duplicates: 0, withEmail: 0, withPhone: 0, withMemberNumber: 0, withStatus: 0 },
      statuses: [],
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
    const seen = new Set<string>();
    let boolish = true;
    for (let r = firstDataRow; r < rows.length && seen.size <= MEMBER_LIST_MAX_STATUS_WORDS; r++) {
      const text = tidyCell(rows[r]?.[statusColumn] ?? "");
      if (text === "") continue;
      seen.add(text.toLowerCase());
      if (!isBooleanWord(text)) boolish = false;
    }
    if (seen.size > MEMBER_LIST_MAX_STATUS_WORDS) {
      if (chosen !== null) return { ok: false, refusal: { code: "mapped_column_not_status", column: statusColumn } };
      statusColumn = null;
      mapping = { ...mapping, status: null };
    } else if (boolish && seen.size > 0) {
      // Yes and no under a heading such as "Active" read "Active" and "Not
      // active"; under a heading that already says "status" they stay as typed.
      const header = stats[statusColumn]?.header ?? "";
      const reading = readHeader(header);
      if (!(reading.field === "status" && reading.rank === 0) && header !== "") statusWords = header.replace(LEADING_IS, "");
    }
  }

  const drafts: Draft[] = [];
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
    const draft = draftRow(row, r, mapping, country, status);
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
  const keptEmails = new Map<string, number>();
  let noContact = 0;
  let duplicates = 0;
  let unusualPhones = 0;
  const counts = { withEmail: 0, withPhone: 0, withMemberNumber: 0, withStatus: 0 };
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
    keptRows.push({ row: draft.row, ...person, identityKey: key });
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
      const folded = fold(draft.status);
      const already = statuses.get(folded);
      if (already === undefined) statuses.set(folded, { label: draft.status, count: 1 });
      else already.count++;
    }
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
  ];
  for (const warning of counted) if ("rows" in warning && warning.rows > 0) warnings.push(warning);
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
    counts: { dataRows, kept: keptRows.length, noContact, duplicates, ...counts },
    statuses: [...statuses.values()].sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
    skipped,
    warnings,
  };
}
