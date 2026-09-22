// Reading a gym's dates (spec Part 3 §11.3): the join date, the end-or-renewal
// date and the date of birth, each as a plain calendar day.
//
// **03/04/2026 IS TWO DIFFERENT DAYS** and no cell can say which. So nothing
// here guesses cell by cell: the ORDER is settled once for a whole COLUMN, in
// this order —
//
//   1. staff's own switch, where they flipped it;
//   2. the file's own evidence — any cell whose first part is over 12 is
//      day-first, any whose second part is over 12 is month-first;
//   3. the gym's country;
//
// and whichever it was, the preview says it back with a real cell of the column
// beside it ("We read 03/04/2026 as 3 April 2026"). A cell that is no date at
// all is left empty and counted, never guessed.
//
// A date that says its own order is never touched by any of that: an ISO date,
// and a date with the month written out, are read as they stand. Excel's own
// typed dates arrive here as ISO already (`xlsx.adapter.ts`), which is what
// "a typed Excel date is taken as it is" comes to.
//
// No clock. `understand.ts` has none, and a rule that read "today" would give
// two answers for one file.
import { MEMBER_LIST_DATE_SHARE, type MemberListDateOrder } from "@app/shared";
import { tidyCell } from "./cells.js";

/** A date written in numbers: three groups, any of the separators a spreadsheet
 *  or a person uses. */
const NUMBERS = /^(\d{1,4})[/.\-\s](\d{1,2})[/.\-\s](\d{1,4})$/;
/** An ISO day, which says its own order. A time after it is ignored: a gym's
 *  export often writes midnight, and midnight where is not a question a
 *  birthday asks. */
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
/** A month written out, before or after the day: "3 Apr 2026", "Apr 3, 2026". */
const MONTH_FIRST_WORDS = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})$/;
const DAY_FIRST_WORDS = /^(\d{1,2})(?:st|nd|rd|th)?\.?[\s-]+([A-Za-z]{3,9})\.?[\s,-]+(\d{2,4})$/;

const MONTHS = new Map<string, number>();
for (const [index, name] of ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].entries()) {
  MONTHS.set(name, index + 1);
  MONTHS.set(name.slice(0, 3), index + 1);
}
// The one abbreviation that is not the first three letters, as a gym's export
// and a person both write it.
MONTHS.set("sept", 9);

/** Excel's own two-digit-year rule, which is the one a gym's file was written
 *  under: 00 to 29 is this century, 30 to 99 the last one. It is a rule and not
 *  a guess, so it is the same on every machine and in every year — nothing here
 *  may ask what year it is. */
const TWO_DIGIT_PIVOT = 30;
const fourDigitYear = (year: number, written: number): number => (written > 2 ? year : year < TWO_DIGIT_PIVOT ? 2000 + year : 1900 + year);

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const leap = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** The furthest apart two dates on a member record can honestly be: a person
 *  born in 1900 and a membership that renews in 2099. Anything outside is a
 *  reference number or a price that happened to be written with slashes. */
const FIRST_YEAR = 1900;
const LAST_YEAR = 2099;

/** A day as `YYYY-MM-DD`, or null where those three numbers are no real day —
 *  31 April and 29 February 2025 among them. */
export function dayOf(year: number, month: number, day: number): string | null {
  if (year < FIRST_YEAR || year > LAST_YEAR || month < 1 || month > 12 || day < 1) return null;
  const longest = month === 2 && leap(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  if (day > longest) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** What one cell says about which way round its column is written. */
export type DateEvidence = "dayFirst" | "monthFirst" | "either" | "none";

interface Numbers {
  first: number;
  second: number;
  year: number;
  yearDigits: number;
  /** Whether the year was written first (2026/04/03), which is ISO's own order
   *  however the groups are separated — so the column's order never touches it. */
  yearFirst: boolean;
}

/** A cell's three numbers, with the year already picked out: a four-digit group
 *  at either end is the year, and nothing else can be. */
function numbersOf(text: string): Numbers | null {
  const match = NUMBERS.exec(text);
  if (match === null) return null;
  const [, a = "", b = "", c = ""] = match;
  if (a.length === 4) return { first: Number(b), second: Number(c), year: Number(a), yearDigits: 4, yearFirst: true };
  if (b.length > 2) return null;
  return { first: Number(a), second: Number(b), year: Number(c), yearDigits: c.length, yearFirst: false };
}

/** What a cell proves about its column's order, on its own. */
export function evidenceOf(raw: string): DateEvidence {
  const text = tidyCell(raw);
  if (text === "") return "none";
  // A date that says its own order proves nothing about the ones that do not.
  if (ISO.test(text) || MONTH_FIRST_WORDS.test(text) || DAY_FIRST_WORDS.test(text)) return "none";
  const numbers = numbersOf(text);
  if (numbers === null || numbers.yearFirst) return "none";
  if (numbers.first > 12 && numbers.second <= 12) return "dayFirst";
  if (numbers.second > 12 && numbers.first <= 12) return "monthFirst";
  return "either";
}

/** One cell as a calendar day, read the way its column was settled. */
export function readDay(raw: string, order: MemberListDateOrder): string | null {
  const text = tidyCell(raw);
  if (text === "") return null;

  const iso = ISO.exec(text);
  if (iso !== null) return dayOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const monthFirstWords = MONTH_FIRST_WORDS.exec(text);
  if (monthFirstWords !== null) {
    const month = MONTHS.get((monthFirstWords[1] ?? "").toLowerCase());
    if (month === undefined) return null;
    return dayOf(fourDigitYear(Number(monthFirstWords[3]), (monthFirstWords[3] ?? "").length), month, Number(monthFirstWords[2]));
  }
  const dayFirstWords = DAY_FIRST_WORDS.exec(text);
  if (dayFirstWords !== null) {
    const month = MONTHS.get((dayFirstWords[2] ?? "").toLowerCase());
    if (month === undefined) return null;
    return dayOf(fourDigitYear(Number(dayFirstWords[3]), (dayFirstWords[3] ?? "").length), month, Number(dayFirstWords[1]));
  }

  const numbers = numbersOf(text);
  if (numbers === null) return null;
  const year = fourDigitYear(numbers.year, numbers.yearDigits);
  // Year first is ISO's order, whatever sat between the groups.
  if (numbers.yearFirst) return dayOf(year, numbers.first, numbers.second);
  // A group over 12 says what it is whatever the column was settled as: the
  // column's order only ever decides the cells that COULD be either.
  if (numbers.first > 12) return dayOf(year, numbers.second, numbers.first);
  if (numbers.second > 12) return dayOf(year, numbers.first, numbers.second);
  return order === "dayFirst" ? dayOf(year, numbers.second, numbers.first) : dayOf(year, numbers.first, numbers.second);
}

/** Whether a cell reads as a date under EITHER order — what counts a column's
 *  cells before its order is settled. */
export const looksLikeADate = (raw: string): boolean => readDay(raw, "dayFirst") !== null || readDay(raw, "monthFirst") !== null;

/** The countries that write the month first. The United States is the only one
 *  of the app's markets that does; the Philippines and the US island territories
 *  follow it. Everywhere else — the United Kingdom, Ireland, India, Australia,
 *  New Zealand, South Africa, and Canada, whose own government asks for ISO —
 *  writes the day first. */
const MONTH_FIRST_COUNTRIES = new Set(["US", "PH", "FM", "MH", "PW", "AS", "GU", "MP", "PR", "VI"]);

/** Which way round a country writes a date. */
export const countryOrder = (country: string | null): MemberListDateOrder =>
  country !== null && MONTH_FIRST_COUNTRIES.has(country.toUpperCase()) ? "monthFirst" : "dayFirst";

export interface SettledOrder {
  order: MemberListDateOrder;
  from: "file" | "country" | "chosen" | "none";
}

/** A column's order, settled once for the whole column (§11.3). The file's own
 *  evidence beats the country; staff's switch beats both. Where the file says
 *  one thing on one row and the other on another, the file is not trusted at
 *  all and the country decides — two rows cannot both be right. */
export function settleOrder(evidence: readonly DateEvidence[], country: string | null, chosen: MemberListDateOrder | null): SettledOrder {
  if (chosen !== null) return { order: chosen, from: "chosen" };
  let dayFirst = false;
  let monthFirst = false;
  let anyEither = false;
  for (const seen of evidence) {
    if (seen === "dayFirst") dayFirst = true;
    else if (seen === "monthFirst") monthFirst = true;
    else if (seen === "either") anyEither = true;
  }
  if (dayFirst !== monthFirst) return { order: dayFirst ? "dayFirst" : "monthFirst", from: "file" };
  // Nothing in the column could be read either way, so nothing was decided:
  // every cell said its own order (ISO, or a written-out month).
  if (!dayFirst && !monthFirst && !anyEither) return { order: countryOrder(country), from: "none" };
  return { order: countryOrder(country), from: "country" };
}

/** Whether enough of a column's looked-at cells read as dates for it to be one. */
export const mostlyDates = (dates: number, written: number): boolean => written > 0 && dates / written >= MEMBER_LIST_DATE_SHARE;
