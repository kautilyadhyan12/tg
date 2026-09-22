// The four fields beside the phone, each cleaned by its own rule (spec Part 3
// §9.5), and the key that tells one person on a list from another.
//
// The email rule is SIGN-IN'S OWN (`authEmailSchema`). That is the point of it:
// a list email and the email someone signs in with are then equal or not equal
// by construction, and no gym's member can be on a list under an address the
// app would never accept. Everything before it is undoing what a spreadsheet or
// an address book did to the address — `mailto:`, "Ann <ann@gym.com>", two
// addresses in one cell — never a rule of its own about what an address is.
import { createHash } from "node:crypto";
import {
  MEMBER_LIST_MAX_EMAIL_CHARS,
  MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS,
  MEMBER_LIST_MAX_NAME_CHARS,
  MEMBER_LIST_MAX_STATUS_CHARS,
  authEmailSchema,
} from "@app/shared";
import { expandScientific, tidyCell } from "./cells.js";
import { cardShapedCell } from "./neverKeep.js";

/** Text cut to `most` characters, never between the two halves of a character
 *  outside the basic plane. */
export function cut(text: string, most: number): string {
  if (text.length <= most) return text;
  const last = text.charCodeAt(most - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? most - 1 : most);
}

/** A person's name, from one column or from two. Empty is allowed: a screen
 *  shows the email instead, and a list entry with no name is still a member. */
export function cleanName(parts: { full?: string; first?: string; last?: string }): string {
  const full = tidyCell(parts.full ?? "");
  if (full !== "") return cut(full, MEMBER_LIST_MAX_NAME_CHARS);
  const both = `${tidyCell(parts.first ?? "")} ${tidyCell(parts.last ?? "")}`.replace(/\s+/g, " ").trim();
  return cut(both, MEMBER_LIST_MAX_NAME_CHARS);
}

const MAILTO = /^mailto:/i;
/** What a sentence or a list leaves on the end of an address. */
const TRAILING_PUNCTUATION = /[.,;:]+$/;
/** An address book writes "Ann Bell <ann@gym.com>"; a gym's export sometimes
 *  writes two addresses in one cell. */
const EMAIL_PIECES = /[;,/|\s]+/;

/** One cell as at most one email address — sign-in's own rule, so the list and
 *  sign-in can never disagree about what an address is. */
export function cleanEmail(raw: string): string | null {
  const text = tidyCell(raw).replace(MAILTO, "");
  if (text === "") return null;
  const open = text.indexOf("<");
  const close = text.indexOf(">", open + 1);
  const inside = open >= 0 && close > open + 1 ? text.slice(open + 1, close) : text;
  for (const piece of inside.split(EMAIL_PIECES)) {
    const candidate = piece.replace(MAILTO, "").replace(TRAILING_PUNCTUATION, "");
    // Longer than an address may be (RFC 5321), so no pattern is ever run over
    // it: a 2,000-character cell is never handed to a matcher.
    if (candidate.length === 0 || candidate.length > MEMBER_LIST_MAX_EMAIL_CHARS) continue;
    const parsed = authEmailSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return null;
}

/** A whole number a spreadsheet wrote as a decimal, and nothing else. */
const NUMBER_TRAILING_ZEROS = /^(\d+)\.0+$/;
/** What a gym's software writes in a member-number column that is empty. */
const EMPTY_WORDS = new Set(["0", "-", "--", "n/a", "na", "none", "null", "nil"]);

export interface NumberReading {
  value: string | null;
  /** A spreadsheet shortened it and its last digits are gone (§9.5). */
  shortened: boolean;
  /** It was a payment card number and was dropped (§11.2), so the reader can
   *  count it with the cards dropped everywhere else in the file. */
  card: boolean;
}

/** The gym's own number for a member, as text: it is shown, matched on and
 *  never counted with. */
export function cleanMemberNumber(raw: string): NumberReading {
  const text = tidyCell(raw);
  if (text === "") return { value: null, shortened: false, card: false };
  const scientific = expandScientific(text);
  if (scientific.kind === "shortened") return { value: null, shortened: true, card: false };
  const whole = NUMBER_TRAILING_ZEROS.exec(scientific.kind === "digits" ? scientific.digits : text);
  const value = whole?.[1] ?? (scientific.kind === "digits" ? scientific.digits : text);
  if (EMPTY_WORDS.has(value.toLowerCase())) return { value: null, shortened: false, card: false };
  // Dropped whole, never cut: half a member number is another member's number.
  if (value.length > MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS) return { value: null, shortened: false, card: false };
  // `cardShapedCell` and not the bare-digits rule (review of PR #90, Critical
  // 1): a card typed the way a person types it — "4111 1111 1111 1111" — has
  // spaces in it, and asking the bare-digits rule kept it as the member's own
  // number while the same card without spaces was dropped. Every other place
  // §11.2 drops a card cell asks this one; this was the odd one out.
  if (cardShapedCell(value)) return { value: null, shortened: false, card: true };
  return { value, shortened: false, card: false };
}

const TRUE_WORDS = new Set(["yes", "y", "true", "1"]);
const FALSE_WORDS = new Set(["no", "n", "false", "0"]);

/** Whether a word is a yes or a no rather than a state of membership. */
export const isBooleanWord = (text: string): boolean => TRUE_WORDS.has(text.toLowerCase()) || FALSE_WORDS.has(text.toLowerCase());

/** The gym's own status word, as it wrote it. The app attaches no meaning to
 *  any of them — it filters by them and chooses who is invited by them, nothing
 *  else (§9.2 rule 10) — so no list of ours can be wrong about a gym's word. */
export function cleanStatus(raw: string): string | null {
  const text = tidyCell(raw);
  return text === "" ? null : cut(text, MEMBER_LIST_MAX_STATUS_CHARS);
}

/** A column of yes and no under a heading such as "Active" is a status: it
 *  reads "Active" and "Not active" (§9.5), in the gym's own word, so the
 *  filter says what the gym's spreadsheet says. */
export function booleanStatus(raw: string, header: string): string | null {
  const text = tidyCell(raw).toLowerCase();
  const word = tidyCell(header);
  if (word === "") return null;
  if (TRUE_WORDS.has(text)) return cut(word, MEMBER_LIST_MAX_STATUS_CHARS);
  if (!FALSE_WORDS.has(text)) return null;
  const lowered = word === word.toUpperCase() ? word : `${word.slice(0, 1).toLowerCase()}${word.slice(1)}`;
  return cut(`Not ${lowered}`, MEMBER_LIST_MAX_STATUS_CHARS);
}

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Text as it is COMPARED rather than shown: two spellings that differ only by
 *  case or by an accent are one name, and one status word. */
export const fold = (text: string): string =>
  text.toLowerCase().normalize("NFD").replace(COMBINING_MARKS, "").normalize("NFC").replace(/\s+/g, " ").trim();

/** What tells one row of a list from another (§9.5): the four things that say
 *  WHO someone is, and NOT the status — so a member going from "Active" to
 *  "Expired" is the same person, changed in place, and not one person gone and
 *  another arrived. Nothing durable hangs on it, so a corrected spelling is
 *  honestly one person gone and one new and costs nothing. */
export function identityKey(row: { fullName: string; email: string | null; phone: string | null; memberNumber: string | null }): string {
  const parts = [row.email ?? "", row.phone ?? "", (row.memberNumber ?? "").toLowerCase(), fold(row.fullName)];
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
}
