// WHOSE RECORD IS A PERSON IN THE APP (spec Part 3 §18.4, §18.6). Pure.
//
// `membersAgainstList` finds the record §9.7 matches each person to. Every screen that says
// "this record's person is in the app", and every removal that ends someone's app with a
// record, asks through these, so the word on a row and what Remove does cannot disagree
// (round one of 5b-v-a-i, High-1 and High-2).
import type { MemberAgainstList } from "./repo.js";

/** The current record that is certainly this person's, or null: a family sharing one
 *  email whose sign-up name is on none of its records is nobody's for certain. */
export function currentRecordOf(member: MemberAgainstList): string | null {
  return member.unsure === null ? member.entryId : null;
}

/** The past record that is certainly this person's: the one they joined with, when no
 *  current record keeps them on the list. A past record found only by an email is never
 *  enough — it can be a relative's on a shared family address. */
export function pastRecordOf(member: MemberAgainstList): string | null {
  return member.joinedFormer && !member.onList ? member.joinedEntryId : null;
}

/** The current records that read "In the app": each certain match, and every record of a
 *  shared email whose person the list cannot pick out. */
export function inAppRecordIds(members: readonly MemberAgainstList[]): string[] {
  const ids = new Set<string>();
  for (const member of members) {
    const own = currentRecordOf(member);
    if (own !== null) ids.add(own);
    for (const record of member.unsure?.records ?? []) ids.add(record.id);
  }
  return [...ids];
}
