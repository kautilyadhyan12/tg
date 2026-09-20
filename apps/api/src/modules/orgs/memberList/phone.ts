// Reading a telephone number out of a spreadsheet cell (spec Part 3 §9.5).
//
// Every rule below is one of the 52 vectors measured on `libphonenumber-js`
// 1.13.13 (`/max`, full metadata) on 2026-09-19 and re-run here. What the
// package does NOT do on its own, and what would be a WRONG number if we let it
// through, is the reason each rule exists:
//   `919876543210.0`      → +919198765432100   a General cell's trailing ".0"
//   `555-1234 / 555-9876` → +155512345559876   two numbers in one cell, glued
//   `९८७६५४३२१०`          → nothing            Devanagari digits are not folded
//   `9.19876543210E+11`   → nothing            what Excel writes for a 12-digit
//                                              number in a General column
// So the cell is taken apart here and each piece handed over on its own, and a
// number Excel SHORTENED (`9.19877E+11`, the last digits gone for good) is said
// to be shortened and never guessed back.
//
// `extract: false` is what the package is asked for: without it, it hunts for a
// number inside any text at all, which turns a house number in an address into
// somebody's phone. A wrong number is worse than a missing one (§9.2 rule 4).
//
// The country of the number is never read back (`.country`): measured, a
// perfectly ordinary British mobile comes back as Guernsey. Only its E.164 text
// is kept, which is what one member's number is matched to another's by.
import { MEMBER_LIST_PHONE_E164 } from "@app/shared";
import { type CountryCode, getCountries, parsePhoneNumberFromString } from "libphonenumber-js/max";
import { couldBePhone, digitCount, expandScientific, normaliseCell } from "./cells.js";

/** A gym's country as the phone package knows it, or null — which is also what
 *  a country it does not know becomes, so nothing is ever read by a guess. */
export function readCountry(value: string | null | undefined): CountryCode | null {
  if (value === undefined || value === null) return null;
  const wanted = value.trim().toUpperCase();
  for (const country of getCountries()) if (country === wanted) return country;
  return null;
}

/** Two numbers in one cell are written apart by one of these, or on two lines.
 *  A space is NOT one of them: most of the world writes one number with spaces
 *  in it. */
const PIECES = /[/;,|\n\r\u000b\u000c]|\s+or\s+/i;
/** A whole number a spreadsheet wrote as a decimal. Loose on purpose: Google
 *  Sheets writes "+91 98765 43210.0", which is a number with a point on the end
 *  and not a decimal at all. What is left still has to look like a number. */
const TRAILING_ZEROS = /\.0+$/;
/** Dashes a word processor or a phone's keyboard writes instead of "-". */
const DASHES = /[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/g;
const LEADING_APOSTROPHE = /^['\u2018\u2019]/;

export interface PhoneReading {
  /** The number in the one form everything else compares, or null. */
  e164: string | null;
  /** Read, but not a number this country hands out — kept, and counted, because
   *  both sides use one version of the package's metadata, so a range too new
   *  for it still matches itself (§9.5). */
  unusual: boolean;
  /** A spreadsheet shortened it (`9.19877E+11`) and its last digits are gone.
   *  Never repaired: the number that comes back would be somebody else's. */
  shortened: boolean;
  /** It could be a number, but nothing says which country and the gym has none
   *  set, so it was left alone. */
  needsCountry: boolean;
}

const NOTHING: PhoneReading = { e164: null, unusual: false, shortened: false, needsCountry: false };

/** One cell as at most one telephone number. The first piece that could be a
 *  number wins; the rest are left alone. */
export function readPhone(raw: string, country: CountryCode | null): PhoneReading {
  const cell = normaliseCell(raw);
  if (digitCount(cell) === 0) return NOTHING;
  let shortened = false;
  let needsCountry = false;
  for (const rawPiece of cell.split(PIECES)) {
    const piece = rawPiece.replace(DASHES, "-").replace(/\s+/g, " ").trim().replace(LEADING_APOSTROPHE, "").trim();
    const withoutScheme = piece.toLowerCase().startsWith("tel:") ? piece.slice(4).trim() : piece;
    const scientific = expandScientific(withoutScheme);
    if (scientific.kind === "shortened") {
      shortened = true;
      continue;
    }
    const text = (scientific.kind === "digits" ? scientific.digits : withoutScheme).replace(TRAILING_ZEROS, "");
    if (!couldBePhone(text)) continue;
    if (country === null && !text.startsWith("+")) {
      needsCountry = true;
      continue;
    }
    // Measured: a non-string throws a TypeError rather than answering. Nothing
    // here passes one, and a cell that somehow still breaks the package is a
    // cell we have no number for — never a reason to refuse the whole file.
    let parsed;
    try {
      parsed = country === null ? parsePhoneNumberFromString(text, { extract: false }) : parsePhoneNumberFromString(text, { defaultCountry: country, extract: false });
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined || !parsed.isPossible()) continue;
    // "Possible" to the package is WIDER than a list can hold: measured, a
    // German number with a long direct dial reads as 16 digits and one written
    // for Gibraltar as 19, and a number with a stripped leading zero as 6. Such
    // a cell is not a number we can keep, so the row falls through to its next
    // phone column and keeps its email — rather than the whole file failing its
    // own contract on one cell of row 4,000 (review of PR #86).
    if (!MEMBER_LIST_PHONE_E164.test(parsed.number)) continue;
    return { e164: parsed.number, unusual: !parsed.isValid(), shortened: false, needsCountry: false };
  }
  return { e164: null, unusual: false, shortened, needsCountry };
}

/** Whether a cell holds a number this gym could store — what a column's cells
 *  are counted by when deciding what the column is (§9.5). */
export const isPhoneValue = (raw: string, country: CountryCode | null): boolean => readPhone(raw, country).e164 !== null;
