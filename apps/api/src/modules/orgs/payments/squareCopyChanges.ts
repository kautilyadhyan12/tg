// What a member's change copies to their customer in Square (ROADMAP 18d-iii-b-ii-b-ii-b-i; spec Part 3 §14.8;
// rulings/2026-10-28-18d-iii-b-ii-b-ii-b-i.md).
//
// A change is copied, nothing else: of the parts that changed here since Square last agreed with the record (its name,
// its email, its phone), a part is sent only when Square does not already hold the same, and the parts that did not
// change are never touched, so a customer that was in Square before the app linked it keeps the name and email the
// business typed ("Amy L. Lee", another email) while a new phone is copied. A phone is the same by its E.164 form as the
// list keeps it, an email by its folded form. A name is judged by who made the customer:
// - one the app made holds the name the app sent, split as `cardNameParts` splits it, so it is the same only when it is
//   exactly that (a case-only or accent-only correction of the record is a real correction and is copied);
// - one the business had before the app linked it may be typed another way ("AMY L.", capitals, no accents), so it is the
//   same when its words are the same once case, punctuation and the accents of Latin letters are folded; every other
//   script keeps its marks, since in Devanagari, Thai or Arabic the vowel signs tell different names apart.
// A part the record no longer has (a phone taken off) is cleared in Square, so the gym's Square keeps nothing the
// gym removed.
//
// Pure: the same record and customer in give the same change out.
import type { CountryCode } from "libphonenumber-js/max";
import { cardNameParts } from "@app/shared";
import { squareEmail, squarePhone } from "./squareMembersPlan.js";

/** The record, as the list holds it: `phone` in E.164 or null. */
export interface CopyRecord {
  fullName: string;
  email: string | null;
  phone: string | null;
}

/** Which parts of the record differ from what Square last agreed with. */
export interface CopyDue {
  name: boolean;
  email: boolean;
  phone: boolean;
}

/** The customer as Square shows them now. */
export interface CopyNow {
  givenName?: string | null | undefined;
  familyName?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
}

/** What to send: a part left out stays as it is in Square; null clears it. */
export interface CopyChange {
  givenName?: string | null;
  familyName?: string | null;
  email?: string | null;
  phone?: string | null;
}

export const copyIsEmpty = (change: CopyChange): boolean => Object.keys(change).length === 0;

/** A name as written, composed (NFC) and trimmed. */
const written = (name: string | null | undefined): string => (name ?? "").normalize("NFC").trim();

/** A name's words as one string, to ask whether two spellings are one name the business may have typed another way: lower
 *  case, apostrophes and punctuation off, and the accents of LATIN letters off ("José", "Jose"). The marks of every other
 *  script stay, so रीना and राना, or सिंह and सुंह, are two names. */
export function foldedName(...names: (string | null | undefined)[]): string {
  return names
    .map((n) => n ?? "")
    .join(" ")
    .normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/['’ʼ`]/g, "")
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((part) => part !== "")
    .join(" ");
}

/** Square holds this name already: exactly, for a customer the app made; by the folded words, for one the business had. */
function holdsName(record: CopyRecord, now: CopyNow, joined: boolean): boolean {
  if (joined) return foldedName(now.givenName, now.familyName) === foldedName(record.fullName);
  const sent = cardNameParts(record.fullName);
  return written(now.givenName) === written(sent.givenName) && written(now.familyName) === written(sent.familyName);
}

/** `joined`: the customer was Square's before the app linked it, not one the app made. */
export function changesToCopy(record: CopyRecord, due: CopyDue, now: CopyNow, country: CountryCode | null, joined: boolean): CopyChange {
  const change: CopyChange = {};
  if (due.name && !holdsName(record, now, joined)) {
    const { givenName, familyName } = cardNameParts(record.fullName);
    change.givenName = givenName === "" ? null : givenName;
    change.familyName = familyName === "" ? null : familyName;
  }
  if (due.email && squareEmail(record.email) !== squareEmail(now.email)) {
    change.email = squareEmail(record.email) === null ? null : (record.email ?? "").trim();
  }
  if (due.phone && record.phone !== squarePhone(now.phone, country)) {
    change.phone = record.phone === null || record.phone === "" ? null : record.phone;
  }
  return change;
}
