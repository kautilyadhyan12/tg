// WHAT AN UPLOAD WOULD DO TO A GYM'S LIST — Part 3 §9.7, ONE PURE FUNCTION.
//
// **THE SQL ONLY FETCHES THE THREE SETS.** The preview, the confirm, the reads
// and 3a-iv's removal all call this one rule, so they cannot disagree about who
// is new, who changed, who is leaving, or which of a gym's members has dropped
// off its list. Four readers of one rule written four times in SQL is four
// answers to "is this member still a member here", and the one a screen shows
// would not be the one the confirm applies.
//
// **PURE: no clock, no database, no randomness.** `everListed` arrives as a
// boolean rather than a date for that reason — the rule needs to know that a
// member was once on a list, never when — so the same three sets in always give
// the same answer out, and the table test can state every case as data.
//
// **THE SAME RULE ANSWERS "WHAT DOES THE LIST SAY TODAY".** Read it with no rows
// and in `add` mode and the list to measure against is the stored list itself:
// nothing is new, changed, unchanged or gone, and every member's mark is what the
// console should print beside them right now. That is deliberate, and it is why
// the marks are here and not in a second query.
import {
  isLargeMemberListChange,
  MEMBER_LIST_MOST_OF_LIST_SHARE,
  type MemberListChangeCounts,
  type MemberListGuard,
  type MemberListMembers,
  type MemberListMode,
  type MemberListRow,
  type MemberListStatusChange,
} from "@app/shared";

/** One person already on the gym's list. */
export interface ListEntry {
  identityKey: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  memberNumber: string | null;
  status: string | null;
}

/** One of the gym's own app members, as the match reads them: live, not
 *  complimentary, not staff — the seat rule's own three conditions, applied by
 *  the caller's SQL (§9.7). The owner is member one and is on no export, so
 *  without those conditions every gym's owner would read "not on your list".
 *
 *  `email` is their VERIFIED address or null: an address nobody has proved is
 *  nobody's proof, and matching on one would let a stranger who typed a member's
 *  address be read as that member.
 *
 *  `everListed` is whether `last_listed_at` is set — that this person has been on
 *  a confirmed list at some point. It is what tells "dropped off the list" from
 *  "never was on it". */
export interface ListMember {
  userId: string;
  fullName: string;
  email: string | null;
  statedPhone: string | null;
  everListed: boolean;
}

export interface ReconcileInput {
  /** The people read out of the uploaded file, cleaned (§9.5). Empty asks what
   *  the stored list says today. */
  rows: readonly MemberListRow[];
  /** The gym's list as it stands. */
  entries: readonly ListEntry[];
  /** The gym's own app members. */
  members: readonly ListMember[];
  mode: MemberListMode;
  /** Whether this gym has ever confirmed a list. A gym that has not shows NO
   *  marks at all (§9.7): with nothing to be missing from, "never listed" beside
   *  every member would be an accusation about nobody. */
  hasList: boolean;
}

/** What the console prints beside one of the gym's members, measured against the
 *  list this reconcile is about — the uploaded file for a preview, the stored
 *  list for a read. */
export type MemberMark = "on_list" | "no_longer_listed" | "never_listed";

export interface ReconciledMember {
  userId: string;
  mark: MemberMark;
  /** This member is on the list being replaced and NOT on the new one, so the
   *  confirm is what would mark them. Already-unlisted members are not leaving:
   *  they left. This is the number the wrong-file guard measures (§9.8). */
  leaving: boolean;
}

/** One person as a preview shows them. `row` is the file's own row number, and
 *  null for somebody who is not in the file: an entry coming off the list, or a
 *  member who would be marked as having dropped off it. */
export interface ReconciledPerson {
  identityKey: string;
  row: number | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  memberNumber: string | null;
  status: string | null;
  /** The status this person carries on the list TODAY, where they are on it. */
  wasStatus: string | null;
  inApp: boolean;
}

export interface Reconciled {
  /** In the file and not on the list. */
  new: ReconciledPerson[];
  /** On the list under the same identity, carrying a different status word. */
  changed: ReconciledPerson[];
  unchanged: ReconciledPerson[];
  /** On the list and not in the file. Always empty in `add` mode, which takes
   *  nobody off — that falls out of the rule rather than being written as an
   *  exception, so no later edit can reintroduce it. */
  gone: ReconciledPerson[];
  /** The gym's own app members who would be marked as having dropped off. */
  membersLeaving: ReconciledPerson[];
  counts: MemberListChangeCounts;
  statuses: MemberListStatusChange[];
  members: MemberListMembers;
  guard: MemberListGuard;
  marks: ReconciledMember[];
}

/** One spelling for a status word, so two exports of one gym writing "Active"
 *  and "ACTIVE" are one word and nobody reads five hundred false changes. The
 *  word STORED is still the gym's own, as it first wrote it (§9.5): this folds
 *  only for the comparison. A null status and an empty one are both "no status".
 */
const foldStatus = (status: string | null): string => (status ?? "").trim().toLowerCase();

/** An address folded for comparison. Both sides are folded, always: a list's
 *  emails arrive through sign-in's own rule (already lower case) and a member's
 *  through a `citext` column, so today the two agree — and a rule that leans on
 *  that agreement is one migration away from matching nobody. */
const foldEmail = (email: string | null): string | null => {
  const text = (email ?? "").trim().toLowerCase();
  return text === "" ? null : text;
};

/** A phone number is kept in ONE shape (`MEMBER_LIST_PHONE_E164`), on a list
 *  entry and on a membership alike, so it is compared as written. Trimmed only,
 *  because a stored value that needed more than that would not have been stored. */
const foldPhone = (phone: string | null): string | null => {
  const text = (phone ?? "").trim();
  return text === "" ? null : text;
};

interface Contactable {
  email: string | null;
  phone: string | null;
}

/** Whether a person's email or phone is one of a set of each. An email is asked
 *  first because it is the address an invite would go to. */
const reaches = (person: Contactable, emails: ReadonlySet<string>, phones: ReadonlySet<string>): boolean => {
  const email = foldEmail(person.email);
  if (email !== null && emails.has(email)) return true;
  const phone = foldPhone(person.phone);
  return phone !== null && phones.has(phone);
};

const addContact = (person: Contactable, emails: Set<string>, phones: Set<string>): void => {
  const email = foldEmail(person.email);
  if (email !== null) emails.add(email);
  const phone = foldPhone(person.phone);
  if (phone !== null) phones.add(phone);
};

/** Every status word the upload touches, with what it does to the people carrying
 *  it.
 *
 *  **THE SPELLING SHOWN IS THE ONE THE FILE WROTE FIRST, IN THE FILE'S OWN ROW
 *  ORDER** — which is why the labels are registered before anything is counted.
 *  Registering them as the groups are walked instead put the first NEW person's
 *  spelling in front of an earlier unchanged one's, so a file whose row 2 said
 *  "Active" and whose row 3 said "ACTIVE" read back as "ACTIVE": a word the gym
 *  never wrote at the top of its own list, which is §9.5's "in the case it was
 *  first written in" broken by the order the code happened to loop in. A word only
 *  the stored list has ("Frozen", for people coming off) keeps the list's own
 *  spelling, which is why the entries come second.
 *
 *  A word registered and never counted is dropped: an `add` leaves the entries it
 *  does not mention in no group at all, and a status nobody on this upload carries
 *  is not one of its numbers. */
function statusBreakdown(
  order: { rows: readonly MemberListRow[]; entries: readonly ListEntry[] },
  groups: {
    new: readonly ReconciledPerson[];
    changed: readonly ReconciledPerson[];
    unchanged: readonly ReconciledPerson[];
    gone: readonly ReconciledPerson[];
  },
): MemberListStatusChange[] {
  const byWord = new Map<string, MemberListStatusChange>();
  const register = (status: string | null): MemberListStatusChange => {
    const folded = foldStatus(status);
    let row = byWord.get(folded);
    if (row === undefined) {
      // The label is the word as written, and "" where there is no status at all —
      // the same empty label the entries filter reads as "no status" (§9.9).
      row = { label: folded === "" ? "" : (status ?? "").trim(), count: 0, new: 0, changed: 0, unchanged: 0, gone: 0 };
      byWord.set(folded, row);
    }
    return row;
  };
  for (const row of order.rows) register(row.status);
  for (const entry of order.entries) register(entry.status);

  const bump = (status: string | null, group: "new" | "changed" | "unchanged" | "gone"): void => {
    const row = register(status);
    row[group] += 1;
    row.count += 1;
  };
  for (const person of groups.new) bump(person.status, "new");
  for (const person of groups.changed) bump(person.status, "changed");
  for (const person of groups.unchanged) bump(person.status, "unchanged");
  // A person coming off carries no word in the file, so theirs is the one the
  // list holds.
  for (const person of groups.gone) bump(person.wasStatus, "gone");
  return [...byWord.values()].filter((row) => row.count > 0);
}

/** WHAT THIS UPLOAD WOULD DO — and, with no rows, what the stored list says now.
 *
 *  The order of the work is the order the answers depend on each other: who the
 *  new list would hold, then which of the file's people are new, changed or
 *  unchanged, then who comes off, then what that means for the gym's own members,
 *  then the guard's numbers. */
export function reconcile(input: ReconcileInput): Reconciled {
  const { entries, members, mode, hasList } = input;

  // One person per identity key. Understanding a file already skips a row whose
  // person is on an earlier row (§9.5), so this is defence: two rows of one key
  // reaching here would otherwise be counted twice and written once.
  const rows: MemberListRow[] = [];
  const seen = new Set<string>();
  for (const row of input.rows) {
    if (seen.has(row.identityKey)) continue;
    seen.add(row.identityKey);
    rows.push(row);
  }

  const entriesByKey = new Map<string, ListEntry>();
  for (const entry of entries) entriesByKey.set(entry.identityKey, entry);

  // How the gym's own members are reached, so "is this person already in the
  // app" is one lookup per person rather than a scan per person.
  const memberEmails = new Set<string>();
  const memberPhones = new Set<string>();
  for (const member of members) addContact({ email: member.email, phone: member.statedPhone }, memberEmails, memberPhones);
  const inApp = (person: Contactable): boolean => reaches(person, memberEmails, memberPhones);

  // THE LIST AS IT WOULD BE. A whole-list upload IS the file; an add keeps
  // everybody already on the list beside it. Every "would this member still be
  // listed" question below is asked of this, which is what makes `add` mode take
  // nobody off without a single branch saying so.
  const newEmails = new Set<string>();
  const newPhones = new Set<string>();
  for (const row of rows) addContact(row, newEmails, newPhones);
  if (mode === "add") for (const entry of entries) addContact(entry, newEmails, newPhones);

  const fresh: ReconciledPerson[] = [];
  const changed: ReconciledPerson[] = [];
  const unchanged: ReconciledPerson[] = [];
  const kept = new Set<string>();
  for (const row of rows) {
    const entry = entriesByKey.get(row.identityKey);
    const person: ReconciledPerson = {
      identityKey: row.identityKey,
      row: row.row,
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      memberNumber: row.memberNumber,
      status: row.status,
      wasStatus: entry?.status ?? null,
      inApp: inApp(row),
    };
    if (entry === undefined) {
      fresh.push(person);
      continue;
    }
    kept.add(row.identityKey);
    if (foldStatus(entry.status) === foldStatus(row.status)) unchanged.push(person);
    else changed.push(person);
  }

  // WHO COMES OFF. An add takes nobody off, and the condition is the mode rather
  // than an empty set handed in, because `rows: []` in whole-list mode is a real
  // answer: an export of nobody would empty the list, and the guard is what
  // stops that going through unnoticed.
  const gone: ReconciledPerson[] =
    mode === "add"
      ? []
      : entries
          .filter((entry) => !kept.has(entry.identityKey))
          .map((entry) => ({
            identityKey: entry.identityKey,
            row: null,
            fullName: entry.fullName,
            email: entry.email,
            phone: entry.phone,
            memberNumber: entry.memberNumber,
            status: null,
            wasStatus: entry.status,
            inApp: inApp(entry),
          }));

  // THE GYM'S OWN MEMBERS. `listedNow` is how many of them the list being
  // replaced holds; `leaving` is how many of THOSE the new list does not.
  // Which ENTRY a member matches, not only whether one does: a leaving member is
  // shown with what the list still says about them. A family sharing one address
  // has several entries against it; the first is the one shown, because the list
  // itself offers nothing to choose between them and the point on the screen is
  // the status, not which relative it came from.
  const entryByEmail = new Map<string, ListEntry>();
  const entryByPhone = new Map<string, ListEntry>();
  for (const entry of entries) {
    const email = foldEmail(entry.email);
    if (email !== null && !entryByEmail.has(email)) entryByEmail.set(email, entry);
    const phone = foldPhone(entry.phone);
    if (phone !== null && !entryByPhone.has(phone)) entryByPhone.set(phone, entry);
  }
  const entryFor = (person: Contactable): ListEntry | null => {
    const email = foldEmail(person.email);
    const byEmail = email === null ? undefined : entryByEmail.get(email);
    if (byEmail !== undefined) return byEmail;
    const phone = foldPhone(person.phone);
    return (phone === null ? undefined : entryByPhone.get(phone)) ?? null;
  };
  const marks: ReconciledMember[] = [];
  const membersLeaving: ReconciledPerson[] = [];
  let listedNow = 0;
  for (const member of members) {
    const contact = { email: member.email, phone: member.statedPhone };
    const theirEntry = entryFor(contact);
    const onListNow = theirEntry !== null;
    const onNewList = reaches(contact, newEmails, newPhones);
    if (onListNow) listedNow += 1;
    const leaving = onListNow && !onNewList;
    if (hasList) {
      marks.push({
        userId: member.userId,
        mark: onNewList ? "on_list" : onListNow || member.everListed ? "no_longer_listed" : "never_listed",
        leaving,
      });
    }
    if (!leaving) continue;
    // Their name and address are the app's own, not the file's — the file is
    // exactly where they are missing from. `wasStatus` is what the list still
    // says about them, which is what staff read to judge whether the file is
    // wrong or the person really has left.
    // `leaving` is true only where an entry matched, so the entry is there: the
    // compiler follows that through the two booleans above and no fallback is
    // written for a case the rule cannot reach.
    membersLeaving.push({
      identityKey: theirEntry.identityKey,
      row: null,
      fullName: member.fullName,
      email: member.email,
      phone: member.statedPhone,
      memberNumber: theirEntry.memberNumber,
      status: null,
      wasStatus: theirEntry.status,
      inApp: true,
    });
  }

  const counts: MemberListChangeCounts = {
    new: fresh.length,
    changed: changed.length,
    unchanged: unchanged.length,
    gone: gone.length,
    alreadyInApp: fresh.filter((person) => person.inApp).length,
    canBeInvited: fresh.filter((person) => !person.inApp && foldEmail(person.email) !== null).length,
    noEmail: fresh.filter((person) => foldEmail(person.email) === null).length,
  };

  const listSize = entries.length;
  const guard: MemberListGuard = {
    entriesGoing: gone.length,
    listSize,
    membersLeaving: membersLeaving.length,
    membersListedNow: listedNow,
    needsTick:
      isLargeMemberListChange(gone.length, listSize) || isLargeMemberListChange(membersLeaving.length, listedNow),
    // The louder warning, and only for a whole-list upload: an add can take
    // nobody off, so there is no wrong file for it to be warning about.
    mostOfListWouldGo: mode === "whole_list" && listSize > 0 && gone.length > MEMBER_LIST_MOST_OF_LIST_SHARE * listSize,
  };

  return {
    new: fresh,
    changed,
    unchanged,
    gone,
    membersLeaving,
    counts,
    statuses: statusBreakdown({ rows, entries }, { new: fresh, changed, unchanged, gone }),
    members: { leaving: membersLeaving.length, listedNow },
    guard,
    marks,
  };
}
