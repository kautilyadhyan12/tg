// Which record on a gym's list each row of a file is (RULINGS 2026-09-24, 2026-09-25;
// spec §11.4).
//
// A row is the same person as a record, in this order, each step over the whole file
// before the next:
//   1. every field the file carries is equal;
//   2. the same name and the same member number, else email, else phone;
//   3. a whole-list upload only: a different name on an email that exactly one record
//      of the list holds and one row of the file (a corrected spelling, a married name,
//      a parent who left and a child new on that parent's lone email).
// A member number or a phone never joins two different names (a key fob handed to the
// next member, a family landline), and a different date of birth parts two people on
// an email or phone match. Everything else that differs is an update to that record.
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

/** How a row was recognised: `same` is every carried field equal, nothing to update;
 *  `renamed` is step 3. */
export type MatchedBy = "same" | "memberNumber" | "email" | "phone" | "renamed";

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
/** The words of a name in any order, so "Shah, Priya" and "Priya Shah" are one name. */
const nameWords = (fullName: string): string | null => {
  const parts = nameParts(fullName);
  return parts.length === 0 ? null : [...parts].sort().join(" ");
};
const nameWordsOf = (who: WhoFields): string | null => nameWords(who.fullName);

/** Step 2's test of a name, for the rest of the module: the same words in any order,
 *  and an empty name is nobody's. */
export function sameName(a: string, b: string): boolean {
  const words = nameWords(a);
  return words !== null && words === nameWords(b);
}

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

const push = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
};

/** Pairs each row with at most one record and each record with at most one row.
 *  `renames` is false for an upload that adds people: a record missing from such a file
 *  has not left, so no row may take it over under another name. */
export function matchRows<E extends WhoFields & { former: boolean }>(
  rows: readonly WhoFields[],
  entries: readonly E[],
  carries: WhoCarried,
  renames: boolean,
): (Match<E> | null)[] {
  const ordered = [...entries.filter((entry) => !entry.former), ...entries.filter((entry) => entry.former)];
  const matches: (Match<E> | null)[] = rows.map(() => null);
  const taken = new Set<E>();
  const pair = (at: number, entry: E, by: MatchedBy): void => {
    matches[at] = { entry, by };
    taken.add(entry);
  };
  const birthsDiffer = (row: WhoFields, entry: E): boolean => {
    if (!carries.dateOfBirth) return false;
    const a = birthOf(row);
    const b = birthOf(entry);
    return a !== null && b !== null && a !== b;
  };

  // 1. Every carried field equal.
  const bySignature = new Map<string, E[]>();
  for (const entry of ordered) push(bySignature, sameSignature(entry, carries), entry);
  rows.forEach((row, at) => {
    const found = bySignature.get(sameSignature(row, carries))?.find((entry) => !taken.has(entry));
    if (found !== undefined) pair(at, found, "same");
  });

  // 2. The same name and one of the three keys. A file without a name column has no
  //    name to be the same, and goes on to step 3 alone.
  const steps: { by: "memberNumber" | "email" | "phone"; carried: boolean; valueOf: (who: WhoFields) => string | null }[] = [
    { by: "memberNumber", carried: carries.memberNumber, valueOf: numberOf },
    { by: "email", carried: carries.email, valueOf: emailOf },
    { by: "phone", carried: carries.phone, valueOf: phoneOf },
  ];
  if (carries.fullName) {
    for (const step of steps) {
      if (!step.carried) continue;
      const byKey = new Map<string, E[]>();
      for (const entry of ordered) {
        const value = step.valueOf(entry);
        const words = nameWordsOf(entry);
        if (value !== null && words !== null) push(byKey, `${value}\n${words}`, entry);
      }
      rows.forEach((row, at) => {
        if (matches[at] !== null) return;
        const value = step.valueOf(row);
        const words = nameWordsOf(row);
        if (value === null || words === null) return;
        const found = byKey
          .get(`${value}\n${words}`)
          ?.find((entry) => !taken.has(entry) && (step.by === "memberNumber" || !birthsDiffer(row, entry)));
        if (found !== undefined) pair(at, found, step.by);
      });
    }
  }

  // 3. A different name on an email one record holds and one remaining row brings.
  if (!renames || !carries.email) return matches;
  const holders = new Map<string, E[]>();
  for (const entry of ordered) {
    const email = emailOf(entry);
    if (email !== null) push(holders, email, entry);
  }
  const rowsLeft = new Map<string, number[]>();
  rows.forEach((row, at) => {
    const email = matches[at] === null ? emailOf(row) : null;
    if (email !== null) push(rowsLeft, email, at);
  });
  for (const [email, ats] of rowsLeft) {
    const onList = holders.get(email) ?? [];
    const at = ats.length === 1 ? ats[0] : undefined;
    const entry = onList.length === 1 ? onList[0] : undefined;
    const row = at === undefined ? undefined : rows[at];
    if (at === undefined || row === undefined || entry === undefined || taken.has(entry)) continue;
    const numbersDiffer = carries.memberNumber && numberOf(row) !== null && numberOf(entry) !== null && numberOf(row) !== numberOf(entry);
    if (numbersDiffer || birthsDiffer(row, entry)) continue;
    pair(at, entry, "renamed");
  }
  return matches;
}
