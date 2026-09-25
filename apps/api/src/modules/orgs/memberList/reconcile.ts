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
  MEMBER_LIST_EXTRA_FIELD_PREFIX,
  MEMBER_LIST_FIELD_WORDS,
  MEMBER_LIST_MOST_OF_LIST_SHARE,
  type MemberListChangeCounts,
  type MemberListExtraChange,
  type MemberListField,
  type MemberListFieldChange,
  type MemberListGuard,
  type MemberListHandEdits,
  type MemberListMembers,
  type MemberListMode,
  type MemberListRow,
  type MemberListStatusChange,
} from "@app/shared";
import { fold, identityKey } from "./fields.js";
import { matchRows } from "./samePerson.js";

/** One person the gym's list holds — on it, or FORMER (§11.1).
 *
 *  **THE WIDER FIELDS ARE HERE BECAUSE "CHANGED" IS NOW ABOUT ALL OF THEM** (§11.4).
 *  Until 3a-v-b the only thing that could differ between a file's row and a stored
 *  entry was the status word; a record now holds the gym's membership and payment
 *  words, three dates and every one of the gym's own columns, and any of them
 *  differing is a change. Since 3a-vi the four behind the identity key — name, address,
 *  phone and member number — can change too: a row is matched to its record by
 *  `samePerson.ts`, not by the key. */
export interface ListEntry {
  /** The record's own id: what a membership's `entry_id` names. */
  id: string;
  identityKey: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  memberNumber: string | null;
  status: string | null;
  membershipType: string | null;
  /** A plain calendar day as text, never a `Date`: the rule is pure and a `Date` is
   *  a zone waiting to be applied. The repo casts the column to text for this. */
  joinedOn: string | null;
  endsOn: string | null;
  endsOnKind: "ends" | "renews" | null;
  paymentStatus: string | null;
  dateOfBirth: string | null;
  /** The gym's own columns as this record holds them, by catalogue key (§11.1). */
  extra: Readonly<Record<string, string>>;
  /** WHICH FIELDS STAFF EDITED BY HAND SINCE THE LAST UPLOAD — names only (§11.4).
   *  A standard field by its own name, one of the gym's own columns as
   *  `extra:<key>`. */
  handEdited: readonly string[];
  /** This person has been taken off the list and is kept as a FORMER record
   *  (§11.1). A former record is not on the list: it is in no group's `gone`, in no
   *  count of the list's size, invited by nothing, and it makes no member read "on
   *  your list". A file that holds them again REVIVES this same record. */
  former: boolean;
}

/** One of the gym's own app members: LIVE, and that is the only condition the
 *  caller's SQL applies. `seatCounted` carries the rest of the seat rule.
 *
 *  **TWO QUESTIONS ARE ASKED OF THIS LIST AND THEY ARE NOT THE SAME QUESTION**, which
 *  is the whole reason the flag exists (review of PR #88, High-1). "Does one of this
 *  gym's people already have the app" is true of the owner, of a trainer who trains
 *  here too, and of somebody on a free place. "Does this person occupy a PAID SEAT"
 *  is not — the seat rule excludes complimentary members and staff, and §9.7 excludes
 *  them from the marks for a good reason: the owner is member one and may be on no
 *  export, so without that every gym's owner would read "no longer listed".
 *
 *  Answering the FIRST question with the second is what this fixes. It printed "not
 *  in the app" beside three people who were holding it, and counted them in
 *  `canBeInvited` — the number 3b's Invite button acts on. A real gym's export has
 *  its owner and its trainers on it.
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
  /** Whether this member occupies a paid seat: live, not complimentary, not staff.
   *  The marks, `leaving`, the guard and the seat count use only these; "already in
   *  the app" uses every live member. */
  seatCounted: boolean;
  /** The record the invitation they joined with was for (`gym_members.entry_id`), or
   *  null: joined by a code, or a family address at the time. When set, THAT record
   *  alone decides whether they are on the list (`onListOf`). */
  joinedEntryId: string | null;
}

/** ONE OF THE GYM'S OWN COLUMNS AS THIS FILE BRINGS IT (§11.1): the catalogue key an
 *  entry's document is written under, the heading the gym wrote, and WHERE the cell
 *  sits in each row's `extra` list.
 *
 *  `at` is carried rather than recomputed because the list handed in is the file's
 *  fields FILTERED to the ones this gym keeps — a heading the gym has never had, when
 *  its catalogue is already full, is not kept and not compared — and filtering a list
 *  whose positions are its meaning is how a gym's "Locker" column ends up read out of
 *  its "Notes" cell. */
export interface KeptField {
  key: string;
  label: string;
  at: number;
}

/** WHICH STANDARD FIELDS THIS FILE ACTUALLY CARRIES, which decides both what can
 *  change and what is written.
 *
 *  **A FIELD THE FILE HAS NO COLUMN FOR IS LEFT ALONE, NOT BLANKED**, and that is the
 *  one rule here that reverses what 3a-iii-b did with the status word. A whole-list
 *  upload is the gym's list of PEOPLE as of today; it is not a statement that every
 *  column the gym has ever kept is now empty. A gym exporting a narrower report — no
 *  membership type, no dates — would otherwise wipe those columns off every one of its
 *  people, and the columns a file most often leaves out are exactly the ones §11.2
 *  refuses to keep in the first place. So a file with no status column now leaves the
 *  gym's status words where they are, where before 3a-v-b it emptied them. */
export interface CarriedFields {
  fullName: boolean;
  email: boolean;
  phone: boolean;
  memberNumber: boolean;
  status: boolean;
  membershipType: boolean;
  joinedOn: boolean;
  endsOn: boolean;
  paymentStatus: boolean;
  dateOfBirth: boolean;
}

export interface ReconcileInput {
  /** The people read out of the uploaded file, cleaned (§9.5). Empty asks what
   *  the stored list says today. */
  rows: readonly MemberListRow[];
  /** The gym's list as it stands, FORMER records included. */
  entries: readonly ListEntry[];
  /** The gym's own app members. */
  members: readonly ListMember[];
  /** Which of the file's own columns this gym keeps, and where each sits in a row's
   *  `extra` list. Empty where the file brought none. */
  keptFields: readonly KeptField[];
  /** Which standard fields the file carries at all. */
  carries: CarriedFields;
  /** Whether the end-or-renewal column's heading said "ends" or "renews" — one answer
   *  for the whole file (§11.1), stored per entry because the gym's next export can
   *  say the other thing and a typed-in person has no column at all. It moves with
   *  `endsOn` and never on its own. */
  endsOnKind: "ends" | "renews" | null;
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
  /** The key this person's record has once the upload is applied. */
  identityKey: string;
  /** The id of the record this person is, or null for somebody the list does not hold
   *  yet — what a member's `joinedEntryId` is compared with on a read. */
  entryId: string | null;
  /** The key the matched record has NOW — what an update finds it by. Null for somebody
   *  the list does not hold yet. */
  entryKey: string | null;
  /** WHERE THIS PERSON SITS IN THE ROWS THIS RULE WAS GIVEN, counting from 0, and
   *  null for somebody who is not in the file at all.
   *
   *  It exists so that a page of names can be cut straight out of the stored file
   *  instead of working the whole comparison out again (spec 9.9). It is an index
   *  into `Reconciled.rows` — the rows AFTER duplicates were dropped — and never
   *  into whatever array the caller happened to hand in, which is why that array
   *  comes back alongside it. */
  at: number | null;
  row: number | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  memberNumber: string | null;
  status: string | null;
  /** The status this person carries on the list TODAY, where they are on it. */
  wasStatus: string | null;
  inApp: boolean;
  /** THE STORAGE NAMES OF THE CARRIED FIELDS THIS FILE WOULD REALLY CHANGE for this one
   *  person — a standard field by its own name, one of the gym's own columns as
   *  `extra:<key>`. Empty for anybody the file does not change, which is everybody in
   *  `new`, `unchanged` and `gone`.
   *
   *  **IT IS HERE FOR ONE JOB: CLEARING THE RIGHT HAND-EDIT MARKS** (§11.4). A record
   *  remembers which fields staff typed in; once an upload has written over one, that
   *  mark has done its work and goes, or the gym would be asked to tick the same lost
   *  correction every month for ever. The marks that stay are the ones this file left
   *  alone — including a field it carries and AGREES with, because next month's file
   *  may not, and staff are owed the question then too. */
  moved: readonly string[];
}

export interface Reconciled {
  /** The rows this answer is about, with duplicates dropped — what every `at`
   *  counts into. Stored beside the groups, so an index can never point at a row
   *  that was never kept. */
  rows: MemberListRow[];
  /** IN THE FILE AND NOT ON THE LIST AS IT STANDS — in the file's own row order, and
   *  the group staff read as "these people are being added". Since 3a-v-b it holds two
   *  kinds, `added` and `returning` below, because one of them is an INSERT and the
   *  other is a former record coming back to life. */
  new: ReconciledPerson[];
  /** The subset of `new` the gym has never had: the rows to INSERT. */
  added: ReconciledPerson[];
  /** THE SUBSET OF `new` THE GYM HAS HAD BEFORE — a FORMER record the file holds
   *  again (§11.1). Not an insert: the same row is revived, keeping its id and
   *  everything that hangs off it, which is the whole reason nobody is deleted any
   *  more. Inserting instead would raise on the identity key's UNIQUE, which covers
   *  former rows — and if it did not, the gym would have two records of one person. */
  returning: ReconciledPerson[];
  /** On the list under the same identity, with at least one carried field different
   *  (§11.4). Before 3a-v-b that could only be the status word. */
  changed: ReconciledPerson[];
  unchanged: ReconciledPerson[];
  /** On the list and not in the file — marked FORMER, never deleted (§11.1). Always
   *  empty in `add` mode, which takes nobody off — that falls out of the rule rather
   *  than being written as an exception, so no later edit can reintroduce it.
   *
   *  **A RECORD THAT IS ALREADY FORMER IS NOT IN HERE.** They came off some earlier
   *  upload; marking them former again would write a fresh date over the day they
   *  really left and would put them in the wrong-file guard's numbers for every upload
   *  for ever — the same mistake `leaving` avoids on the members' side. */
  gone: ReconciledPerson[];
  /** FIELD BY FIELD, WHAT THE `changed` PEOPLE'S RECORDS WOULD MOVE (§11.4), and the
   *  same for the gym's own columns. Only fields something would really change appear,
   *  and the order is the fields' own.
   *
   *  **The `returning` are not counted here**, and that is on purpose: a former record
   *  coming back has every carried field written from the file, so counting it would
   *  put every field on the list for somebody staff are already being told is being
   *  added. What this answers is "you said 412 records change — change HOW", which is
   *  a question about people who are already on the list. */
  fieldChanges: MemberListFieldChange[];
  extraChanges: MemberListExtraChange[];
  /** WHICH OF STAFF'S OWN CORRECTIONS THIS FILE WOULD WRITE OVER (§11.4) — how many
   *  records, and the field names in plain English. Counted over the `changed` AND the
   *  `returning`, because losing a correction on a record coming back is the same
   *  loss. `entries: 0` is the ordinary case and needs no tick. */
  handEdits: MemberListHandEdits;
  /** The gym's own app members who would be marked as having dropped off. */
  membersLeaving: ReconciledPerson[];
  counts: MemberListChangeCounts;
  statuses: MemberListStatusChange[];
  members: MemberListMembers;
  guard: MemberListGuard;
  marks: ReconciledMember[];
  /** The gym's own members who are on the list being replaced or would be on the new
   *  one — what a confirm stamps `last_listed_at` on (§9.7). See `MembersSide`. */
  onEitherList: string[];
}

/** One spelling for a status word, so two exports of one gym writing "Active"
 *  and "ACTIVE" are one word and nobody reads five hundred false changes. The
 *  word STORED is still the gym's own, as it first wrote it (§9.5): this folds
 *  only for the comparison. A null status and an empty one are both "no status".
 */
const foldStatus = (status: string | null): string => (status ?? "").trim().toLowerCase();

/** THE SAME FOLD, FOR ALL THREE OF THE GYM'S OWN WORDS (§11.1). A status, a membership
 *  type and a payment word are three lists of words the app attaches no meaning to,
 *  compared the one way everywhere: case and spaces folded, a null and an empty one
 *  the same. A second rule for the two new ones would be two answers to "did this
 *  change". */
const foldWord = foldStatus;

/** A plain calendar day as text, or nothing. Both sides come from `MEMBER_LIST_DAY` —
 *  the file's through `dates.ts` and the record's cast to text by the repo — so there
 *  is one shape and no zone in the comparison at all. */
const foldDay = (day: string | null): string => (day ?? "").trim();

/** One of the gym's own cells. A key the record has never held and a cell the person
 *  left blank are the same thing to this comparison, which is what stops a gym's first
 *  upload of a new column reading as a change for everybody who left it empty. */
const foldCell = (cell: string | undefined): string => cell ?? "";

/** WHICH CARRIED FIELDS DIFFER BETWEEN A FILE'S ROW AND THE RECORD IT MATCHED.
 *
 *  **ONLY WHAT THE FILE CARRIES IS EVEN LOOKED AT** (`CarriedFields`), so a file with
 *  no membership-type column can neither change one nor blank one. A name is compared
 *  folded (case and accents), as the identity key compares it.
 *
 *  `endsOnKind` rides with `endsOn` and is never a change of its own. A gym whose
 *  heading went from "Expiry" to "Renewal date" IS a change worth writing — the screen
 *  prints a different sentence — and calling it an `endsOn` change is what keeps the
 *  breakdown a list of things staff recognise instead of growing a field name that is
 *  really a property of a column. */
function changedFields(row: MemberListRow, entry: ListEntry, carries: CarriedFields, endsOnKind: "ends" | "renews" | null): MemberListField[] {
  const moved: MemberListField[] = [];
  if (carries.fullName && fold(row.fullName) !== fold(entry.fullName)) moved.push("fullName");
  if (carries.email && foldEmail(row.email) !== foldEmail(entry.email)) moved.push("email");
  if (carries.phone && foldPhone(row.phone) !== foldPhone(entry.phone)) moved.push("phone");
  if (carries.memberNumber && foldNumber(row.memberNumber) !== foldNumber(entry.memberNumber)) moved.push("memberNumber");
  if (carries.status && foldWord(row.status) !== foldWord(entry.status)) moved.push("status");
  if (carries.membershipType && foldWord(row.membershipType) !== foldWord(entry.membershipType)) moved.push("membershipType");
  if (carries.joinedOn && foldDay(row.joinedOn) !== foldDay(entry.joinedOn)) moved.push("joinedOn");
  // THE KIND IS ONLY COMPARED WHERE THERE IS A DAY FOR IT TO BE ABOUT, which mirrors
  // exactly what the write stores (`insertEntries` and `updateEntries` both null it with
  // the day, and the table's own CHECK forbids anything else). Compared unconditionally
  // it made every person whose end-or-renewal cell is EMPTY read as `changed` on every
  // upload for ever: the file's "renews" against the record's NULL, the write then
  // storing NULL again, so the next upload said exactly the same thing — a false number
  // on the one field the breakdown exists to watch, a version bump for a confirm that
  // moved nothing, and a hand-edit mark cleared for a field nothing overwrote (round
  // one, High-2).
  const rowKind = row.endsOn === null ? null : endsOnKind;
  if (carries.endsOn && (foldDay(row.endsOn) !== foldDay(entry.endsOn) || rowKind !== entry.endsOnKind)) moved.push("endsOn");
  if (carries.paymentStatus && foldWord(row.paymentStatus) !== foldWord(entry.paymentStatus)) moved.push("paymentStatus");
  if (carries.dateOfBirth && foldDay(row.dateOfBirth) !== foldDay(entry.dateOfBirth)) moved.push("dateOfBirth");
  return moved;
}

/** The same, for the gym's own columns: the keys whose cell would change. */
function changedExtra(row: MemberListRow, entry: ListEntry, keptFields: readonly KeptField[]): KeptField[] {
  const moved: KeptField[] = [];
  for (const field of keptFields) {
    if (foldCell(row.extra[field.at]) !== foldCell(entry.extra[field.key])) moved.push(field);
  }
  return moved;
}

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

/** A member number compared as the identity key compares it: case folded. */
const foldNumber = (memberNumber: string | null): string => (memberNumber ?? "").trim().toLowerCase();

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

/** WHETHER A MEMBER IS ON A LIST (RULINGS 2026-09-25; ROADMAP 3a-vi-b).
 *
 *  A member who joined by invitation is the record that invitation was for. That
 *  record alone answers: on the list while it is, off it once it has come off — even
 *  when somebody else still listed shares their email (a parent who left, a child who
 *  stays on the parent's address), and whatever the gym's software has since done to
 *  the record's email or phone. Only a member with no such record is matched by
 *  proved email, then stated phone (§9.7).
 *
 *  `holds` says whether the list in question holds the joined record; `reaches` asks
 *  the contact question of the same list. Deleting a record clears the link, so a
 *  member whose record was deleted arrives with `joinedEntryId` null. */
export function onListOf(
  member: { joinedEntryId: string | null },
  holds: (id: string) => boolean,
  reaches: () => boolean,
): boolean {
  return member.joinedEntryId === null ? reaches() : holds(member.joinedEntryId);
}

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

/** One of the gym's own app members, with what its list says about them today. The
 *  three extra answers come from the entries where this is built inside `reconcile`,
 *  and from one statement (`repo.membersAgainstList`) where a read builds it — the same
 *  question asked of the same data, never a second opinion. */
export interface MemberOnList extends ListMember {
  onList: boolean;
  entryStatus: string | null;
  entryMemberNumber: string | null;
}

export interface MembersSide {
  marks: ReconciledMember[];
  membersLeaving: ReconciledPerson[];
  /** How many of the gym's members the list being replaced holds — what `leaving` is
   *  measured against by the wrong-file guard (§9.8). */
  listedNow: number;
  /** EVERY MEMBER THE OLD LIST HOLDS OR THE NEW ONE WOULD — §9.7's "stamp
   *  `last_listed_at` on every member who is on the list being replaced OR on the new
   *  one", as user ids, worked out by the same rule that decides every other member
   *  answer here.
   *
   *  **The UNION is the whole point and each half is there for its own reason.** The new
   *  list's people are stamped because they are listed now; the OLD list's people are
   *  stamped so that somebody the preview called "no longer listed" still reads as
   *  no longer listed after the confirm — without it, a member who has just come off
   *  would fall back to "never listed" and the gym would be told it had never had them.
   *
   *  **IT IS NOT GATED ON `hasList`, AND `marks` IS.** A gym's very first confirm has no
   *  list to be missing from, so there are no marks to print — but everybody the file
   *  reaches is listed from that moment, and computing this inside the gate would leave
   *  a gym's first two hundred members unstamped with nothing to say so. */
  onEitherList: string[];
}

/** WHAT AN UPLOAD WOULD DO TO THE GYM'S OWN MEMBERS — pure, and worked out fresh on
 *  every single read.
 *
 *  **NOTHING THIS ANSWERS IS EVER STORED** (review of PR #87, High-1 and High-2). Every
 *  one of these answers moves when a member joins, proves their address, gives the gym a
 *  phone number or leaves — and none of those touches the gym's LIST, so the list's own
 *  version cannot say when they are stale. Stored, "Amara Okafor, not in the app" was
 *  read by staff for a whole hour after Amara signed up. And storing a leaving member's
 *  name, proved address and phone number put a person's own data in a table the Day-14
 *  purge does not touch. Computing it every time cannot go stale by construction, which
 *  a longer freshness check could not promise.
 *
 *  `reachesNewList` is the one thing the caller supplies: whether the list AFTER this
 *  upload can reach this member. `reconcile` answers it from the file's rows it holds; a
 *  read answers it from the staged file's contacts (`repo.stagedContacts`) and the
 *  records its groups matched. Both ask `onListOf`. */
export function membersAgainstNewList(
  members: readonly MemberOnList[],
  reachesNewList: (member: MemberOnList) => boolean,
  hasList: boolean,
): MembersSide {
  const marks: ReconciledMember[] = [];
  const membersLeaving: ReconciledPerson[] = [];
  const onEitherList: string[] = [];
  let listedNow = 0;
  for (const member of members) {
    const onNewList = reachesNewList(member);
    if (member.onList) listedNow += 1;
    const leaving = member.onList && !onNewList;
    // Outside the `hasList` gate deliberately — see the field's own note.
    if (onNewList || member.onList) onEitherList.push(member.userId);
    if (hasList) {
      marks.push({
        userId: member.userId,
        mark: onNewList ? "on_list" : member.onList || member.everListed ? "no_longer_listed" : "never_listed",
        leaving,
      });
    }
    if (!leaving) continue;
    // Their name and address are the app's OWN, not the file's — the file is exactly
    // where they are missing from — which is why none of this is stored. `wasStatus` is
    // what the list still says about them, what staff read to judge whether the file is
    // wrong or the person really has left.
    membersLeaving.push({
      identityKey: "",
      entryId: null,
      entryKey: null,
      at: null,
      row: null,
      fullName: member.fullName,
      email: member.email,
      phone: member.statedPhone,
      memberNumber: member.entryMemberNumber,
      status: null,
      wasStatus: member.entryStatus,
      inApp: true,
      moved: [],
    });
  }
  return { marks, membersLeaving, listedNow, onEitherList };
}

/** THE THREE ANSWERS ABOUT THE PEOPLE A FILE WOULD ADD (§9.6): already in the app ·
 *  could be invited (has an address and is not in the app) · no address at all.
 *
 *  **ONE FUNCTION, CALLED WHERE THE FILE IS STAGED AND AGAIN ON EVERY READ** (review of
 *  PR #87, High-A). The read counted its own way once, and worked `canBeInvited` out by
 *  SUBTRACTION — everybody with an address, minus everybody already in the app. That is
 *  the same number only while every member the file reaches also has an address IN the
 *  file, and §9.7's backup match means one need not: a member is matched by the phone
 *  number they gave the gym. One such row made the upload answer `canBeInvited: 0` and
 *  a second look at the same upload answer **-1** — a number `memberListChangeCounts`
 *  forbids, on a screen staff were about to act on. Counted directly, in one place,
 *  there is nothing left to drift.
 *
 *  **They do not partition, and that is deliberate**: somebody already in the app whose
 *  row carries no address is counted under `alreadyInApp` AND under `noEmail`, because
 *  both sentences are true of them. The three are facts about the new people, not slices
 *  of them, so no test may assert that they sum to `new`. */
export function inviteCounts(
  people: readonly { email: string | null; inApp: boolean }[],
): { alreadyInApp: number; canBeInvited: number; noEmail: number } {
  let alreadyInApp = 0;
  let canBeInvited = 0;
  let noEmail = 0;
  for (const person of people) {
    const reachable = foldEmail(person.email) !== null;
    if (person.inApp) alreadyInApp += 1;
    else if (reachable) canBeInvited += 1;
    if (!reachable) noEmail += 1;
  }
  return { alreadyInApp, canBeInvited, noEmail };
}

/** WHAT THIS UPLOAD WOULD DO — and, with no rows, what the stored list says now.
 *
 *  The order of the work is the order the answers depend on each other: who the
 *  new list would hold, then which of the file's people are new, changed or
 *  unchanged, then who comes off, then what that means for the gym's own members,
 *  then the guard's numbers. */
export function reconcile(input: ReconcileInput): Reconciled {
  const { entries, members, mode, hasList, keptFields, carries, endsOnKind } = input;

  // THE LIST AS IT STANDS IS THE CURRENT RECORDS, and every count, every match and
  // every "who comes off" below is about those alone. The FORMER records are still
  // needed — a file that holds one of those people revives that very row — so they
  // arrive in the same array and are told apart here, once, rather than by each
  // reader remembering to ask (§11.1).
  const current = entries.filter((entry) => !entry.former);

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

  // WHICH RECORD EACH ROW IS (RULINGS 2026-09-24, 2026-09-25) — so a new phone, a new
  // address or a corrected name is an update to the same record, not one person gone
  // and another new. Only a whole list can say somebody was renamed: in an add, a record
  // missing from the file has not left.
  const matched = matchRows(rows, entries, carries, mode === "whole_list");

  // How the gym's own members are reached, so "is this person already in the
  // app" is one lookup per person rather than a scan per person. EVERY live member
  // counts here, seat or no seat: the owner and the trainers have the app too.
  const memberEmails = new Set<string>();
  const memberPhones = new Set<string>();
  for (const member of members) addContact({ email: member.email, phone: member.statedPhone }, memberEmails, memberPhones);
  // A record somebody joined with is in the app whatever its email says now.
  const joinedIds = new Set(members.flatMap((member) => (member.joinedEntryId === null ? [] : [member.joinedEntryId])));
  const inApp = (person: Contactable, entry: ListEntry | undefined): boolean =>
    (entry !== undefined && joinedIds.has(entry.id)) || reaches(person, memberEmails, memberPhones);

  // THE LIST AS IT WOULD BE. A whole-list upload IS the file; an add keeps
  // everybody already on the list beside it. Every "would this member still be
  // listed" question below is asked of this, which is what makes `add` mode take
  // nobody off without a single branch saying so.
  const newEmails = new Set<string>();
  const newPhones = new Set<string>();
  for (const row of rows) addContact(row, newEmails, newPhones);
  if (mode === "add") for (const entry of current) addContact(entry, newEmails, newPhones);

  const fresh: ReconciledPerson[] = [];
  const added: ReconciledPerson[] = [];
  const returning: ReconciledPerson[] = [];
  const changed: ReconciledPerson[] = [];
  const unchanged: ReconciledPerson[] = [];
  const kept = new Set<string>();
  // The breakdown's counters. A Map keyed by the field, so the ORDER a field first
  // moved in is the order staff read — the fields' own order in the record, because
  // `changedFields` walks them in it.
  const fieldCounts = new Map<MemberListField, number>();
  const extraCounts = new Map<string, { label: string; count: number }>();
  const editedFields = new Set<string>();
  let editedEntries = 0;

  /** What this file would write over that a member of staff typed in (§11.4), counted
   *  for one record. NAMES ONLY: the entry says WHICH fields were edited and this asks
   *  only whether the file disagrees with one of them. */
  const countHandEdits = (entry: ListEntry, moved: readonly MemberListField[], movedExtra: readonly KeptField[]): void => {
    if (entry.handEdited.length === 0) return;
    const edited = new Set(entry.handEdited);
    let any = false;
    for (const field of moved) {
      if (!edited.has(field)) continue;
      editedFields.add(MEMBER_LIST_FIELD_WORDS[field]);
      any = true;
    }
    for (const field of movedExtra) {
      if (!edited.has(`${MEMBER_LIST_EXTRA_FIELD_PREFIX}${field.key}`)) continue;
      // The gym's own heading, as the gym wrote it: the only name staff would know it by.
      editedFields.add(field.label);
      any = true;
    }
    if (any) editedEntries += 1;
  };

  for (const [at, row] of rows.entries()) {
    const entry = matched[at]?.entry;
    const moved = entry === undefined ? [] : changedFields(row, entry, carries, endsOnKind);
    const movedExtra = entry === undefined ? [] : changedExtra(row, entry, keptFields);
    // The key the record will have once written: the file's value for each field it
    // carries, the record's own for each it does not — exactly what the update writes.
    const nextKey =
      entry === undefined
        ? row.identityKey
        : identityKey({
            fullName: carries.fullName ? row.fullName : entry.fullName,
            email: carries.email ? row.email : entry.email,
            phone: carries.phone ? row.phone : entry.phone,
            memberNumber: carries.memberNumber ? row.memberNumber : entry.memberNumber,
          });
    const person: ReconciledPerson = {
      identityKey: nextKey,
      entryId: entry?.id ?? null,
      entryKey: entry?.identityKey ?? null,
      at,
      row: row.row,
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      memberNumber: row.memberNumber,
      status: row.status,
      wasStatus: entry?.status ?? null,
      inApp: inApp(row, entry),
      moved: [...moved, ...movedExtra.map((field) => `${MEMBER_LIST_EXTRA_FIELD_PREFIX}${field.key}`)],
    };
    if (entry === undefined) {
      fresh.push(person);
      added.push(person);
      continue;
    }
    // A FORMER RECORD THE FILE HOLDS AGAIN IS THE SAME PERSON COMING BACK (§11.1).
    // They are `new` to the list as it stands — which is what staff are deciding
    // about — and they are not an INSERT, because the row is already there with
    // everything that hangs off it.
    if (entry.former) {
      fresh.push(person);
      returning.push(person);
      countHandEdits(entry, moved, movedExtra);
      continue;
    }
    kept.add(entry.identityKey);
    if (moved.length === 0 && movedExtra.length === 0) {
      unchanged.push(person);
      continue;
    }
    changed.push(person);
    for (const field of moved) fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
    for (const field of movedExtra) {
      const seen = extraCounts.get(field.key);
      if (seen === undefined) extraCounts.set(field.key, { label: field.label, count: 1 });
      else seen.count += 1;
    }
    countHandEdits(entry, moved, movedExtra);
  }

  // WHO COMES OFF. An add takes nobody off, and the condition is the mode rather
  // than an empty set handed in, because `rows: []` in whole-list mode is a real
  // answer: an export of nobody would empty the list, and the guard is what
  // stops that going through unnoticed.
  const gone: ReconciledPerson[] =
    mode === "add"
      ? []
      : current
          .filter((entry) => !kept.has(entry.identityKey))
          .map((entry) => ({
            identityKey: entry.identityKey,
            entryId: entry.id,
            entryKey: entry.identityKey,
            at: null,
            row: null,
            fullName: entry.fullName,
            email: entry.email,
            phone: entry.phone,
            memberNumber: entry.memberNumber,
            status: null,
            wasStatus: entry.status,
            inApp: inApp(entry, entry),
            // Nothing of theirs is written: they come OFF the list, and what happens
            // to them is a date on their own record (§11.1).
            moved: [],
          }));

  // THE GYM'S OWN MEMBERS. `listedNow` is how many of them the list being
  // replaced holds; `leaving` is how many of THOSE the new list does not.
  // Which ENTRY a member matches, not only whether one does: a leaving member is
  // shown with what the list still says about them. A family sharing one address
  // has several entries against it; the first is the one shown, because the list
  // itself offers nothing to choose between them and the point on the screen is
  // the status, not which relative it came from.
  // CURRENT RECORDS ONLY, and this is the line that keeps a former record from
  // admitting anybody (§11.1, §10.2). A member matched to somebody the gym took off
  // its list would read "on your list", hold a seat's worth of the gym's trust, and
  // be counted where an invite is decided.
  const entryByEmail = new Map<string, ListEntry>();
  const entryByPhone = new Map<string, ListEntry>();
  for (const entry of current) {
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
  // THE MEMBERS' SIDE IS THE SAME RULE A READ USES, called here with the entries
  // this function was handed and there with one statement's answer. One function,
  // so a preview read an hour later cannot say something different about a person
  // than the preview that was staged.
  // ...and THIS half is the seat rule's own set, because a mark, a leaver and the
  // guard's numbers are about the paid places, and because §9.7 keeps the owner out
  // of "no longer listed".
  const currentById = new Map(current.map((entry) => [entry.id, entry]));
  // The records the list holds once this upload is applied: every row's record
  // (kept or coming back), and for an add everybody already on it.
  const listedAfter = new Set<string>();
  for (const match of matched) if (match !== null) listedAfter.add(match.entry.id);
  if (mode === "add") for (const entry of current) listedAfter.add(entry.id);
  const onTheList = members
    .filter((member) => member.seatCounted)
    .map((member) => {
      const entry =
        member.joinedEntryId === null
          ? entryFor({ email: member.email, phone: member.statedPhone })
          : (currentById.get(member.joinedEntryId) ?? null);
      return {
        ...member,
        onList: entry !== null,
        entryStatus: entry?.status ?? null,
        entryMemberNumber: entry?.memberNumber ?? null,
      };
    });
  const side = membersAgainstNewList(
    onTheList,
    (member) =>
      onListOf(
        member,
        (id) => listedAfter.has(id),
        () => reaches({ email: member.email, phone: member.statedPhone }, newEmails, newPhones),
      ),
    hasList,
  );
  const { marks, membersLeaving, listedNow, onEitherList } = side;

  const counts: MemberListChangeCounts = {
    new: fresh.length,
    returning: returning.length,
    changed: changed.length,
    unchanged: unchanged.length,
    gone: gone.length,
    ...inviteCounts(fresh),
  };

  const listSize = current.length;
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

  const fieldChanges: MemberListFieldChange[] = [...fieldCounts].map(([field, count]) => ({ field, count }));
  const extraChanges: MemberListExtraChange[] = [...extraCounts].map(([key, seen]) => ({ key, label: seen.label, count: seen.count }));
  const handEdits: MemberListHandEdits = { entries: editedEntries, fields: [...editedFields] };

  return {
    rows,
    new: fresh,
    added,
    returning,
    changed,
    unchanged,
    gone,
    fieldChanges,
    extraChanges,
    handEdits,
    membersLeaving,
    counts,
    statuses: statusBreakdown({ rows, entries: current }, { new: fresh, changed, unchanged, gone }),
    members: { leaving: membersLeaving.length, listedNow },
    guard,
    marks,
    onEitherList,
  };
}
