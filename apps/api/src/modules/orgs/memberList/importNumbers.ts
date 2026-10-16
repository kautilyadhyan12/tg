// AN IMPORT'S MEMBER NUMBERS (ROADMAP 5e-ii; Kd, 2026-10-16, `rulings/2026-10-16-5e-i.md`).
//
// The file wins. A number the file gives a row is that person's, whoever held it. A row
// whose cell is blank, or a file with no member-number column, keeps the number the record
// already has: a blank never wipes one. Everybody the file holds who still has no number is
// given the gym's next ones (`memberNumbers.ts`), in the file's order.
//
// A record that holds a number the file gives to somebody else, and that this file does
// not give another number, is moved to the next free number after those, and named on
// Review: the file's person keeps the number, so no two people end up holding one. Two rows
// of the file with one number keep it both (the file says so, and Review warns).
//
// Every number that goes from a record, and the highest given, raises the kept numbers, so
// the app never gives any of them again (5e-i).
//
// Pure: the same rows, records and kept numbers in give the same numbers out.
import { keptWith, nextMemberNumbers } from "./memberNumbers.js";

export interface NumberedRecord {
  id: string;
  fullName: string;
  memberNumber: string | null;
}

export interface NumberingInput {
  /** The file's rows, deduplicated, in the file's order. */
  rows: readonly { fullName: string; memberNumber: string | null }[];
  /** The record each row is, by its place in `rows`; null for somebody new. */
  matched: readonly (NumberedRecord | null)[];
  /** Every record of the gym, current and past, in the order they came on the list. */
  entries: readonly NumberedRecord[];
  /** Whether the file has a member-number column at all. */
  carried: boolean;
  /** The highest number kept of each sequence (`memberNumbers.ts`). */
  kept: Readonly<Record<string, string>>;
}

/** A record whose number the file gives to somebody else. `to` is null only where the
 *  gym's next number would be longer than a member number may be. */
export interface MovedNumber {
  entryId: string;
  fullName: string;
  from: string;
  to: string | null;
  /** The first row of the file given `from`. */
  toName: string;
  /** Its place in `rows` where the file holds this record (with a blank cell), else null. */
  at: number | null;
}

export interface ImportNumbers {
  /** Each row's member number once written, by its place in `rows`. */
  numbers: (string | null)[];
  /** How many of the file's people who had no number are given one, and the first and
   *  last of those numbers (one run of the gym's sequence). */
  given: number;
  first: string | null;
  last: string | null;
  /** Whether that run continues numbers the gym has (or has had); false where it starts at 1. */
  continued: boolean;
  /** How many of the file's people with no number get none: the run reached a number longer
   *  than a member number may be. */
  notGiven: number;
  moved: MovedNumber[];
  /** The kept numbers after this import, or null where they do not change. */
  kept: Record<string, string> | null;
}

const text = (value: string | null): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};
/** Folded as the identity key and the duplicates index fold a number. */
const folded = (value: string): string => value.toLowerCase();

export function importNumbers(input: NumberingInput): ImportNumbers {
  const { rows, matched, entries, carried } = input;
  const fileNumber = (at: number): string | null => (carried ? text(rows[at]?.memberNumber ?? null) : null);

  // Every number the file gives, folded, with the first row given it.
  const claimedBy = new Map<string, number>();
  for (let at = 0; at < rows.length; at++) {
    const number = fileNumber(at);
    if (number !== null && !claimedBy.has(folded(number))) claimedBy.set(folded(number), at);
  }
  const nameAt = (at: number | undefined): string => (at === undefined ? "" : (rows[at]?.fullName ?? ""));

  const numbers: (string | null)[] = rows.map(() => null);
  const numberless: number[] = [];
  const movedRows: { at: number; record: NumberedRecord; from: string }[] = [];
  const gone: string[] = [];
  const inFile = new Set<string>();

  for (let at = 0; at < rows.length; at++) {
    const record = matched[at] ?? null;
    if (record !== null) inFile.add(record.id);
    const own = record === null ? null : text(record.memberNumber);
    const number = fileNumber(at);
    if (number !== null) {
      numbers[at] = number;
      if (own !== null && folded(own) !== folded(number)) gone.push(own);
    } else if (own === null || record === null) {
      numberless.push(at);
    } else if (claimedBy.has(folded(own))) {
      movedRows.push({ at, record, from: own });
      gone.push(own);
    } else {
      numbers[at] = own;
    }
  }

  // The records this file does not hold whose number it gives to somebody else.
  const movedRecords: NumberedRecord[] = [];
  const stays: string[] = [];
  for (const entry of entries) {
    if (inFile.has(entry.id)) continue;
    const own = text(entry.memberNumber);
    if (own === null) continue;
    if (claimedBy.has(folded(own))) {
      movedRecords.push(entry);
      gone.push(own);
    } else {
      stays.push(own);
    }
  }

  // Every number held once the file is written; the ones that went only raise the kept.
  const held = [...numbers.filter((number): number is string => number !== null), ...stays];
  let kept: Readonly<Record<string, string>> = input.kept;
  const keep = (number: string): void => {
    kept = keptWith(kept, number) ?? kept;
  };
  for (const number of gone) keep(number);

  const wanted = numberless.length + movedRows.length + movedRecords.length;
  const next = wanted === 0 ? [] : nextMemberNumbers(held, Object.values(kept), wanted);
  let used = 0;
  const take = (): string | null => {
    const number = next[used] ?? null;
    if (number !== null) used += 1;
    return number;
  };

  for (const at of numberless) numbers[at] = take();
  const given = used;
  const notGiven = numberless.length - given;
  const continued = [...held, ...Object.values(kept)].some((number) => /[0-9]$/.test(number));
  const first = given > 0 ? (next[0] ?? null) : null;
  const last = given > 0 ? (next[given - 1] ?? null) : null;

  const moved: MovedNumber[] = [];
  for (const { at, record, from } of movedRows) {
    const to = take();
    numbers[at] = to;
    moved.push({ entryId: record.id, fullName: record.fullName, from, to, toName: nameAt(claimedBy.get(folded(from))), at });
  }
  for (const record of movedRecords) {
    const from = text(record.memberNumber) ?? "";
    moved.push({ entryId: record.id, fullName: record.fullName, from, to: take(), toName: nameAt(claimedBy.get(folded(from))), at: null });
  }

  const highest = used > 0 ? next[used - 1] : undefined;
  if (highest !== undefined) keep(highest);

  return { numbers, given, first, last, continued, notGiven, moved, kept: kept === input.kept ? null : { ...kept } };
}
