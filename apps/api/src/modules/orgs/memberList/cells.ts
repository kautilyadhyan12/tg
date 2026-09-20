// What one cell of the grid really says (spec Part 3 §9.5). A file is typed by
// people and written by a dozen programs, so before any rule reads a cell it is
// put in one shape: composed characters joined (NFKC), the invisible ones out,
// and its white space made ordinary. Nothing here decides anything — the rules
// in `columns.ts`, `fields.ts` and `phone.ts` do — so every one of them reads
// the same text, and a test of one is a test of all.
//
// Digits are folded to ASCII here too. NFKC folds the full-width digits of a
// Japanese keyboard; it does NOT fold Devanagari, Arabic-Indic or any other
// script's, and the phone package folds only some of them (measured 2026-09-19:
// `९८७६५४३२१०` reads as nothing at all). A gym in Delhi or Cairo may hold
// numbers in its own digits, so every decimal digit of every script the app
// could plausibly meet is folded before a number is read.

/** Zero-width characters a copy-and-paste leaves behind, and the mark a file
 *  keeps after its first line. They are removed, not turned into spaces. */
const ZERO_WIDTH = /[\u200b\u200c\u200d\u2060\ufeff]/g;
/** C0 and C1 control characters, except the three that end a line or a column
 *  (kept so `phone.ts` can still see two numbers written one above the other).
 *  Excel writes U+000B inside a cell for a line break typed with Alt+Enter. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const WHITESPACE = /\s+/g;

/** The zero of every decimal digit block a member file could plausibly carry.
 *  Unicode gives each block ten code points in order, so the zero is all that
 *  is needed. */
const DIGIT_ZEROS = [
  0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0de6, 0x0e50, 0x0ed0,
  0x0f20, 0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1b50, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xabf0,
  0xff10,
];
const DIGITS = new Map<string, string>();
for (const zero of DIGIT_ZEROS) {
  for (let d = 0; d <= 9; d++) DIGITS.set(String.fromCodePoint(zero + d), String(d));
}
/** Every digit that is not ASCII, in one pass. */
const OTHER_DIGITS = new RegExp(`[${[...DIGITS.keys()].join("")}]`, "g");

/** Every decimal digit of every script above as 0-9. ASCII text is untouched. */
export const foldDigits = (text: string): string => text.replace(OTHER_DIGITS, (d) => DIGITS.get(d) ?? d);

/** A cell as its writer meant it, with its line breaks still in place: joined
 *  characters, no invisible ones, ASCII digits. */
export const normaliseCell = (raw: string): string => foldDigits(raw.normalize("NFKC").replace(ZERO_WIDTH, "").replace(CONTROL, ""));

/** A cell as a screen shows it: `normaliseCell`, then every run of white space
 *  — line breaks and no-break spaces among them — one plain space, and trimmed. */
export const tidyCell = (raw: string): string => normaliseCell(raw).replace(WHITESPACE, " ").trim();

/** Whether a cell is somebody's email address, by shape alone: one `@`, both
 *  sides written, and a dot inside the right-hand side. Written out rather than
 *  as a pattern so a 2,000-character cell costs one pass and never backtracks.
 *  The rule that DECIDES is sign-in's own (`fields.ts`); this is what counts a
 *  column's cells (§9.5) and what keeps a row of real addresses from being read
 *  as the headings. */
function isAddressShaped(text: string): boolean {
  if (text.length < 5 || text.length > 254) return false;
  const at = text.indexOf("@");
  if (at < 1 || at !== text.lastIndexOf("@")) return false;
  const domain = text.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  if (dot < 1 || dot > domain.length - 3) return false;
  for (const c of text) if (c === " " || c === "\t" || c === "\n" || c === "\r") return false;
  return true;
}

export function looksLikeEmail(text: string): boolean {
  // "Ann Lee <ann@gym.com>", as an address book writes it and as a gym types it
  // into a sheet. The cleaner reads that cell as an address (`fields.ts`), so a
  // column full of them is an email column and must be counted as one.
  const open = text.lastIndexOf("<");
  const inside = open > 0 && text.endsWith(">") ? text.slice(open + 1, -1).trim() : text;
  return isAddressShaped(inside);
}

/** What Excel and Google Sheets put in a cell holding more digits than the
 *  column shows. Both write it; only one of them keeps every digit. */
const SCIENTIFIC = /^(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/;
/** More than this and the exponent is not a spreadsheet's doing. */
const MOST_EXPONENT = 30;

/** What a cell written in exponent form really is: all of its digits, digits
 *  the spreadsheet has thrown away, or not a whole number at all. */
export type Scientific = { kind: "digits"; digits: string } | { kind: "shortened" } | { kind: "other" };

/** `9.19876543210E+11` is every digit of 919876543210 — Google Sheets writes
 *  every number in a `.xlsx` that way (measured 2026-09-19) and loses nothing.
 *  `9.19877E+11` is Excel showing six digits of a number it no longer holds;
 *  the rest are gone for good and are never guessed back (§9.5). */
export function expandScientific(text: string): Scientific {
  const match = SCIENTIFIC.exec(text);
  if (match === null) return { kind: "other" };
  const [, whole = "", fraction = "", exponent = ""] = match;
  const power = Number(exponent);
  // More digits after the point than the exponent moves it leaves a fraction,
  // so the cell held a measurement or a price, never a number of ours.
  if (power > MOST_EXPONENT || fraction.length > power) return { kind: "other" };
  if (fraction.length < power) return { kind: "shortened" };
  return { kind: "digits", digits: whole + fraction };
}

/** How many ASCII digits a cell holds (fold them first). */
export function digitCount(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x30 && c <= 0x39) n++;
  }
  return n;
}

/** The fewest and most digits anything that could be a telephone number holds:
 *  E.164 allows fifteen, and a cell may carry an extension or a second number
 *  after it. Below seven is a room number, a year or a door code. */
const FEWEST_PHONE_DIGITS = 7;
const MOST_PHONE_DIGITS = 24;
/** Enough for "ext." or "x" beside the number, not enough for a name. */
const MOST_PHONE_LETTERS = 6;
/** Three groups with a short one in the middle: a date in any country's order.
 *  No telephone number anywhere is written with a one or two digit middle. */
const DATE_LIKE = /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/;

/** Whether a cell is worth handing to the phone package at all. It is asked of
 *  every sampled cell of every column, so it never parses and never allocates:
 *  the package costs about 0.04 ms a call (measured 2026-09-19), which 20,000
 *  sampled cells would turn into most of a second. */
export function couldBePhone(text: string): boolean {
  const digits = digitCount(text);
  if (digits < FEWEST_PHONE_DIGITS || digits > MOST_PHONE_DIGITS) return false;
  if (text.includes("@")) return false;
  // A joining date IS a possible phone number to the package — measured
  // 2026-09-19: `2024/01/05` reads as a German landline, valid and all. A
  // column of them under no heading at all would otherwise become the phone
  // column. Nobody writes a telephone number as a date or a time.
  const withoutTel = text.toLowerCase().startsWith("tel:") ? text.slice(4) : text;
  if (withoutTel.includes(":") || DATE_LIKE.test(withoutTel.trim())) return false;
  // A name with a number in it is not a phone number. A few letters are: an
  // extension is written "x123" or "ext. 5", and the package reads both.
  let letters = 0;
  for (const c of text) if (/\p{L}/u.test(c) && ++letters > MOST_PHONE_LETTERS) return false;
  return true;
}
