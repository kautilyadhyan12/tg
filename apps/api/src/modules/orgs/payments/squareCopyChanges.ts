// What a member's change copies to their customer in Square (ROADMAP 18d-iii-b-ii-b-ii-b-i; spec Part 3 §14.8;
// rulings/2026-10-28-18d-iii-b-ii-b-ii-b-i.md).
//
// A change is copied, nothing else: of the parts that changed here since Square last agreed with the record (its name,
// its email, its phone), a part is sent only when Square does not already hold the same, and the parts that did not
// change are never touched, so a customer that was in Square before the app linked it keeps the name and email the
// business typed ("Amy L. Lee", another email) while a new phone is copied. A name Square already holds is the same
// words, folded (case, accents and punctuation off), whichever way they are split into given and family name; an email
// is the same by its folded form, a phone by its E.164 form as the list keeps it.
// A part the record no longer has (a phone taken off) is cleared in Square, so the gym's Square keeps nothing the
// gym removed.
//
// Pure: the same record and customer in give the same change out.
import type { CountryCode } from "libphonenumber-js/max";
import { cardNameParts } from "@app/shared";
import { nameParts } from "../invites/nameCheck.js";
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

/** A name's folded words, in order: "AMY" "LEE" and "Amy Lee" are the same, "Amy L. Lee" and "Amy Lee-Chen" are not. */
const words = (...names: (string | null | undefined)[]): string => names.flatMap((n) => nameParts(n ?? "")).join(" ");

export function changesToCopy(record: CopyRecord, due: CopyDue, now: CopyNow, country: CountryCode | null): CopyChange {
  const change: CopyChange = {};
  if (due.name && words(now.givenName, now.familyName) !== words(record.fullName)) {
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
