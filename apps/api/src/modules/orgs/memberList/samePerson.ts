// Which record on a gym's list each row of a file is (RULINGS 2026-09-24, spec §11.4).
//
// A row is the same person as a record when their member numbers match, else their
// email (where several share one, the name picks), else their phone (when one of the
// two has no email, or both have the same name). Never one person: on a member-number
// match, a different name AND a different email or phone; on an email or phone match,
// a different name AND a different member number, or a different date of birth.
// Everything else that differs is an update to that record.
//
// Pure: the same rows and records in give the same pairs out.
import { nameParts } from "../invites/nameCheck.js";
import { fold } from "./fields.js";

/** What a row or a record says about who someone is. */
export interface WhoFields {
  fullName: string;
  email: string | null;
  phone: string | null;
  memberNumber: string | null;
  dateOfBirth: string | null;
}

/** Which of those the file has a column for. A field it has no column for says nothing. */
export interface WhoCarried {
  fullName: boolean;
  email: boolean;
  phone: boolean;
  memberNumber: boolean;
  dateOfBirth: boolean;
}

/** How a row was recognised: `same` is every carried field equal, nothing to update. */
export type MatchedBy = "same" | "memberNumber" | "email" | "phone";

export interface Match<E> {
  entry: E;
  by: MatchedBy;
}

const text = (value: string | null): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};
const emailOf = (who: WhoFields): string | null => text(who.email)?.toLowerCase() ?? null;
const phoneOf = (who: WhoFields): string | null => text(who.phone);
const numberOf = (who: WhoFields): string | null => text(who.memberNumber)?.toLowerCase() ?? null;
const birthOf = (who: WhoFields): string | null => text(who.dateOfBirth);
/** The words of a name in any order, so "Shah, Priya" and "Priya Shah" pick the same record. */
const nameWordsOf = (who: WhoFields): string | null => {
  const parts = nameParts(who.fullName);
  return parts.length === 0 ? null : [...parts].sort().join(" ");
};

/** The carried fields exactly as the identity key sees them (`fields.ts`), so two people
 *  equal here would be given the same key once the record is updated. */
function sameSignature(who: WhoFields, carries: WhoCarried): string {
  return [
    carries.fullName ? fold(who.fullName) : "",
    carries.email ? (who.email ?? "") : "",
    carries.phone ? (who.phone ?? "") : "",
    carries.memberNumber ? (who.memberNumber ?? "").toLowerCase() : "",
  ].join("\n");
}

/** Pairs each row with at most one record and each record with at most one row.
 *
 *  Each step runs over every row before the next begins, so a row that matches on
 *  everything is never beaten to its record by a weaker match earlier in the file.
 *  Current records are offered before former ones. */
export function matchRows<E extends WhoFields & { former: boolean }>(
  rows: readonly WhoFields[],
  entries: readonly E[],
  carries: WhoCarried,
): (Match<E> | null)[] {
  const ordered = [...entries.filter((entry) => !entry.former), ...entries.filter((entry) => entry.former)];
  const matches: (Match<E> | null)[] = rows.map(() => null);
  const taken = new Set<E>();

  const differ = (a: string | null, b: string | null): boolean => a !== null && b !== null && a !== b;
  const sameName = (row: WhoFields, entry: E): boolean => {
    const words = carries.fullName ? nameWordsOf(row) : null;
    return words !== null && words === nameWordsOf(entry);
  };
  /** Facts that say two people are different, whatever else they share. A member number
   *  can be edited by staff (Mindbody's "SOK1234" becoming "XSOK1234") or handed to
   *  somebody else with a key fob (GymMaster), so on its own it neither joins nor parts
   *  two people: it takes a different name as well. */
  const contradicts = (row: WhoFields, entry: E, by: MatchedBy): boolean => {
    const namesDiffer = !sameName(row, entry);
    if (by === "memberNumber") {
      const contactDiffers = (carries.email && differ(emailOf(row), emailOf(entry))) || (carries.phone && differ(phoneOf(row), phoneOf(entry)));
      return namesDiffer && contactDiffers;
    }
    if (namesDiffer && carries.memberNumber && differ(numberOf(row), numberOf(entry))) return true;
    if (carries.dateOfBirth && differ(birthOf(row), birthOf(entry))) return true;
    // A family sharing one phone has two names and two addresses; one person who changed
    // address keeps their name (RULINGS 2026-09-24's own second month: Emma's new email).
    if (by === "phone") return namesDiffer && carries.email && emailOf(row) !== null && emailOf(entry) !== null;
    return false;
  };

  // Every carried field equal: the person as the list already has them.
  const bySignature = new Map<string, E[]>();
  for (const entry of ordered) {
    const signature = sameSignature(entry, carries);
    const list = bySignature.get(signature);
    if (list === undefined) bySignature.set(signature, [entry]);
    else list.push(entry);
  }
  rows.forEach((row, at) => {
    const found = bySignature.get(sameSignature(row, carries))?.find((entry) => !taken.has(entry));
    if (found === undefined) return;
    matches[at] = { entry: found, by: "same" };
    taken.add(found);
  });

  const step = (by: Exclude<MatchedBy, "same">, carried: boolean, valueOf: (who: WhoFields) => string | null): void => {
    if (!carried) return;
    const entriesByValue = new Map<string, E[]>();
    for (const entry of ordered) {
      if (taken.has(entry)) continue;
      const value = valueOf(entry);
      if (value === null) continue;
      const list = entriesByValue.get(value);
      if (list === undefined) entriesByValue.set(value, [entry]);
      else list.push(entry);
    }
    const rowsByValue = new Map<string, number[]>();
    rows.forEach((row, at) => {
      if (matches[at] !== null) return;
      const value = valueOf(row);
      if (value === null || !entriesByValue.has(value)) return;
      const list = rowsByValue.get(value);
      if (list === undefined) rowsByValue.set(value, [at]);
      else list.push(at);
    });
    for (const [value, rowsHere] of rowsByValue) {
      const entriesHere = entriesByValue.get(value) ?? [];
      const pair = (at: number, entry: E): void => {
        matches[at] = { entry, by };
        taken.add(entry);
      };
      // The name picks first: a family sharing one address keeps each person's record.
      for (const at of rowsHere) {
        const row = rows[at];
        const words = row === undefined ? null : nameWordsOf(row);
        if (row === undefined || words === null) continue;
        const found = entriesHere.find((entry) => !taken.has(entry) && nameWordsOf(entry) === words && !contradicts(row, entry, by));
        if (found !== undefined) pair(at, found);
      }
      // Then one row left and one record it can be: a changed name on an unshared value.
      const rowsLeft = rowsHere.filter((at) => matches[at] === null);
      const onlyRow = rowsLeft.length === 1 ? rowsLeft[0] : undefined;
      const row = onlyRow === undefined ? undefined : rows[onlyRow];
      if (onlyRow === undefined || row === undefined) continue;
      const entriesLeft = entriesHere.filter((entry) => !taken.has(entry));
      const onlyEntry = entriesLeft.length === 1 ? entriesLeft[0] : undefined;
      if (onlyEntry !== undefined && !contradicts(row, onlyEntry, by)) pair(onlyRow, onlyEntry);
    }
  };
  step("memberNumber", carries.memberNumber, numberOf);
  step("email", carries.email, emailOf);
  step("phone", carries.phone, phoneOf);
  return matches;
}
