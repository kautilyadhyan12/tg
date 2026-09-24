// KEEPING THE WIDER RECORD — the table test for the rules 3a-v-b adds to the ONE pure
// rule (Part 3 §11.1, §11.2, §11.4; CLAUDE.md §4: "a rule that picks, ranks or
// thresholds ships with a table test over every class of case BEFORE review").
//
// **THE FIRST BLOCK IS THE WORST THING THIS JOB COULD DO TO A REAL PERSON**, and it is
// first because the rulebook says it is (CLAUDE.md §2.1, RULINGS 2026-09-20): their
// payment card number, their government ID or a medical note stored in our database
// under their name. 3a-v-a taught the file READER to drop those cells; this is the first
// job that WRITES the wider row, so it is the first where a cell the reader missed
// reaches a real table. The cases are the published test card numbers of the schemes
// themselves — outside the code, as §4 demands — not numbers invented to match our own
// check-digit routine.
//
// **THE SECOND BLOCK IS THE OTHER WORST THING: AN EX-MEMBER OFFERED A WAY BACK IN.**
// Nobody is deleted from a gym's list any more (§11.1), so every count, every chip and
// every match has to mean "the list as it STANDS" or a person the gym took off is
// counted where an invite is decided (3b).
//
// **THE HEADINGS COME FROM REAL PRODUCTS' EXPORTS**, for the reason memory
// `outside-the-code-means-outside-my-own-list` records: a table built while reading our
// own arrays proves only that the arrays match themselves. §11.9 cites Gymdesk's "Data
// Imports Overview" field list and PushPress's migration page; the headings below are
// theirs ("Zip/Postal Code", "Check-in Code", "Custom Field 1", "Emergency Contact
// Name", "Gender", "Address 1"), including ones no list of ours has ever heard of.
import { describe, expect, it } from "vitest";
import {
  MEMBER_LIST_MAX_EXTRA_CHARS,
  MEMBER_LIST_MAX_EXTRA_FIELDS,
  MEMBER_LIST_MAX_STATUS_CHARS,
  type MemberListExtraField,
  type MemberListRow,
} from "@app/shared";
import { extraForWriting, growFields, keptFields, wordForWriting, type FieldSlot } from "../src/modules/orgs/memberList/extraFields.js";
import { identityKey } from "../src/modules/orgs/memberList/fields.js";
import {
  reconcile,
  type CarriedFields,
  type KeptField,
  type ListEntry,
  type ListMember,
  type Reconciled,
  type ReconcileInput,
} from "../src/modules/orgs/memberList/reconcile.js";

// ---------------------------------------------------------------------------
// The fixtures. Every person is invented; every heading is a real product's.
// ---------------------------------------------------------------------------

/** The four things the identity key is made of, and nothing else (§9.5). Every person
 *  here is invented. */
interface Who {
  fullName: string;
  email: string | null;
  phone: string | null;
  memberNumber: string | null;
}

const WHO: Who = { fullName: "Ada Nkemdirim", email: "ada@members.example", phone: null, memberNumber: "M-1" };
const OTHER: Who = { fullName: "Bo Fenwick", email: "bo@members.example", phone: null, memberNumber: "M-2" };

const row = (who: Who, over: Partial<MemberListRow> = {}): MemberListRow => ({
  row: 2,
  fullName: who.fullName,
  email: who.email,
  phone: who.phone,
  memberNumber: who.memberNumber,
  status: null,
  membershipType: null,
  joinedOn: null,
  endsOn: null,
  paymentStatus: null,
  dateOfBirth: null,
  extra: [],
  identityKey: identityKey(who),
  ...over,
});

const entry = (who: Who, over: Partial<ListEntry> = {}): ListEntry => ({
  identityKey: identityKey(who),
  fullName: who.fullName,
  email: who.email,
  phone: who.phone,
  memberNumber: who.memberNumber,
  status: null,
  membershipType: null,
  joinedOn: null,
  endsOn: null,
  endsOnKind: null,
  paymentStatus: null,
  dateOfBirth: null,
  extra: {},
  handEdited: [],
  former: false,
  ...over,
});

const member = (over: Partial<ListMember> & { userId: string }): ListMember => ({
  fullName: `Member ${over.userId}`,
  email: null,
  statedPhone: null,
  everListed: false,
  seatCounted: true,
  ...over,
});

const ALL: CarriedFields = {
  fullName: true,
  email: true,
  phone: true,
  memberNumber: true,
  status: true,
  membershipType: true,
  joinedOn: true,
  endsOn: true,
  paymentStatus: true,
  dateOfBirth: true,
};

const run = (input: Omit<ReconcileInput, "keptFields" | "carries" | "endsOnKind"> & Partial<ReconcileInput>): Reconciled =>
  reconcile({ keptFields: [], carries: ALL, endsOnKind: null, ...input });

/** One of the gym's own columns, as the catalogue and the rows agree on it. */
const kept = (key: string, label: string, at: number): KeptField => ({ key, label, at });

// ===========================================================================
// THE WORST THING: A NEVER-KEPT CELL REACHING THE DATABASE (§11.2)
// ===========================================================================

describe("the worst thing: what is written is checked against §11.2 again", () => {
  /** The schemes' own published test numbers (Visa, Mastercard, Amex, Discover), which
   *  is where 3a-v-a's vectors come from too: a card the card industry itself publishes
   *  as a card, never one made up to satisfy our own routine. */
  const CARDS = [
    "4111111111111111",
    "4242424242424242",
    "5500000000000004",
    "5555555555554444",
    "340000000000009",
    "378282246310005",
    "6011000000000004",
  ];

  it.each(CARDS)("a card-shaped cell in ANY of the gym's own columns is not written: %s", (card) => {
    // "Custom Field 1" is Gymdesk's own name for a gym's own column, and a gym that
    // kept its card numbers in one is exactly the file this rule is for.
    const written = extraForWriting([card], [kept("custom_field_1", "Custom Field 1", 0)]);
    expect(written.document).toEqual({ custom_field_1: "" });
    expect(written.cardsDropped).toBe(1);
  });

  it.each([
    ["written in fours, as a person types one", "4111 1111 1111 1111"],
    ["written with dashes", "4111-1111-1111-1111"],
    ["written with en dashes, as a word processor makes them", "4111–1111–1111–1111"],
  ])("a card is dropped however it is written — %s", (_label, cell) => {
    const written = extraForWriting([cell], [kept("notes", "Notes", 0)]);
    expect(written.document).toEqual({ notes: "" });
    expect(written.cardsDropped).toBe(1);
  });

  // ── A CARD INSIDE A SENTENCE (round one, High-4) ─────────────────────────────
  //
  // This block replaces one that PINNED the opposite as a deliberate limit. The
  // reviewer raised it anyway, and was right to: a free-text "Notes" column is mostly
  // ordinary notes, so the COLUMN rule does not drop it, and a cell that merely
  // contains a card is not a card-shaped CELL either — so a live Visa number sat in
  // the database under a member's name. §11.2's own sentence is "13 to 19 digits …
  // that pass the card check digit — in ANY column".
  //
  // The note is kept and only the card's own digits go, which is what makes it
  // affordable: the recorded objection was that Luhn passes about one made-up run in
  // ten, and that objection is about BLANKING a cell, not about redacting a run.
  it.each([
    ["the way a gym writes it", "Card on file 4111 1111 1111 1111 (Visa)", "Card on file [card number removed] (Visa)"],
    ["mid-sentence, with a date after it", "paid by card 5555 5555 5555 4444 on 2 Jan", "paid by card [card number removed] on 2 Jan"],
    ["with dashes", "card 4111-1111-1111-1111, exp 03/27", "card [card number removed], exp 03/27"],
    // A CARD WITH MORE DIGITS BESIDE IT, separated only by a space: the whole run is
    // twenty digits and twenty is not a card, so a rule that checked the run whole
    // would miss it. The spans tried are aligned to the groups a card is written in.
    ["with a year after it", "4111 1111 1111 1111 2024", "[card number removed] 2024"],
    ["with a year before it", "2024 4111 1111 1111 1111", "2024 [card number removed]"],
    ["two of them in one note", "cards 4111111111111111 and 4242424242424242", "cards [card number removed] and [card number removed]"],
    // A card joined straight on to a phone number that starts with "+" (the re-check of
    // 3a-iv): only the phone's own first group is exempt, never what follows it.
    ["after a phone, by a comma", "+447911123456,4111111111111111", "+447911123456,[card number removed]"],
    ["after a spaced phone", "Mob +44 7911 123456 4111 1111 1111 1111", "Mob +44 7911 123456 [card number removed]"],
    ["after a country code, by dots", "+44.4111.1111.1111.1111", "+44.[card number removed]"],
    // A card glued to a "+" (the second re-check): only a group that can start a phone —
    // a 1–3 digit country code, or a whole 7–15 digit number — is exempt.
    ["glued to a plus", "+4111111111111111", "+[card number removed]"],
    ["glued to a word and a plus", "Visa+4111111111111111", "Visa+[card number removed]"],
    ["grouped after a plus", "+4111 1111 1111 1111", "+[card number removed]"],
  ])("a card written inside a note is taken out of it and the note kept — %s", (_label, cell, expected) => {
    const written = extraForWriting([cell], [kept("notes", "Notes", 0)]);
    expect(written.document["notes"]).toBe(expected);
    expect(written.cardsDropped).toBeGreaterThan(0);
  });

  it.each([
    ["a note with no number in it", "prefers mornings"],
    ["a 13-digit invoice number that fails the check digit", "invoice 1234567890123"],
    ["a phone number", "phone 07911 100001"],
    ["a sort code and an account number", "sort 20-00-00 acc 12345678"],
    ["years", "member since 2019, renewed 2024-2025"],
    ["a run far too long to be a card", "ref 998877665544332211009988"],
    // Number lists, which the first version of this rule destroyed (re-check, Open-1):
    // it tried every span of groups, and one in ten passes Luhn.
    ["a visits log", "visits 9 12 15 11 8 14 10 13"],
    ["a weight log", "72.5 73.1 73.4 72.9 72.6 72.2 71.8 71.9 71.5 71.2"],
    ["a lifting log", "bench 60 62.5 65 67.5 70 72.5 75 kg"],
    ["six years in a row", "renewed 2019 2020 2021 2022 2023 2024"],
    ["a pack's sessions", "PT 10 pack: 1 2 3 4 5 6 7 8 9 10 used"],
    ["a card-shaped number no issuer uses", "invoice 1234 5678 9012 3456"],
    ["a dashed code", "108-64-91"],
    // Each of these passes Luhn, so only the issuer prefix and the grouping rule keep
    // them: four years a member renewed in (no issuer starts 2000–2220), and a dashed
    // code grouped 4-2-2-2-3 as no card ever is.
    ["membership years that pass Luhn", "renewed 2023 2024 2025 2026"],
    ["a dashed code that passes Luhn", "kit 6955-17-19-43-102"],
    // International mobiles with no spaces whose digits pass Luhn and start with a 4
    // (review of 3a-iv, High 3): a card is never written after a "+".
    ["a German mobile, the international way", "emergency +4915100015838"],
    ["an Austrian mobile, the international way", "+4366401234563 (mum)"],
    ["a mobile with a year after it", "+4915100015838 2024"],
  ])("…and an ordinary note is left exactly as the gym wrote it — %s", (_label, cell) => {
    const written = extraForWriting([cell], [kept("notes", "Notes", 0)]);
    expect(written.document["notes"]).toBe(cell);
    expect(written.cardsDropped).toBe(0);
  });

  it.each([
    ["dots", "4111.1111.1111.1111"],
    ["commas", "4111,1111,1111,1111"],
    ["slashes", "4111/1111/1111/1111"],
    ["Amex, 4-6-5", "3782 822463 10005"],
    ["Diners, 4-6-4", "3622 720627 1667"],
  ])("a card is found whatever it is written with — %s", (_label, card) => {
    const written = extraForWriting([`on file ${card} thanks`], [kept("notes", "Notes", 0)]);
    expect(written.document["notes"]).toBe("on file [card number removed] thanks");
  });

  it("only the card is replaced: the separators and numbers around it stay as written", () => {
    // The first version rebuilt every digit run with single spaces, so "108-64-91"
    // came back as "108 64 91" beside a card it had found.
    const written = extraForWriting(["ref 108-64-91, card 4111-1111-1111-1111, locker 12"], [kept("notes", "Notes", 0)]);
    expect(written.document["notes"]).toBe("ref 108-64-91, card [card number removed], locker 12");
  });

  it("a card inside one of the gym's own WORDS is taken out of it too", () => {
    // A status of "paid by card 4111 1111 1111 1111" is a note somebody put in the
    // wrong column. What must not survive is the number.
    expect(wordForWriting("paid by card 4111 1111 1111 1111")).toEqual({
      value: "paid by card [card number removed]",
      card: true,
    });
    expect(wordForWriting("Paid in full")).toEqual({ value: "Paid in full", card: false });
  });

  it("a word at its 40-character cap stays within it after the card is replaced", () => {
    // The marker is longer than a card written without spaces, so a word on its cap
    // came back at 42 and the table's CHECK refused the row (re-check, §3).
    const word = "pay by card 4111 1111 1111 1111 on 2 Jan";
    expect(word).toHaveLength(MEMBER_LIST_MAX_STATUS_CHARS);
    const out = wordForWriting(word);
    expect(out.card).toBe(true);
    expect(out.value?.length ?? 0).toBeLessThanOrEqual(MEMBER_LIST_MAX_STATUS_CHARS);
    expect(out.value).not.toMatch(/4111/);
  });

  it("THE KEY IS STILL WRITTEN, EMPTY — because the document is MERGED and a missing key would keep the old cell", () => {
    // This is the case a `continue` would have got wrong: leave the key out and
    // `e.extra || r.extra` keeps whatever the record held, which is the very cell this
    // write was dropping. Empty under the key is what "kept under the gym's own
    // heading, minus the never-keep list" means.
    const written = extraForWriting(["4111111111111111"], [kept("notes", "Notes", 0)]);
    expect(Object.keys(written.document)).toEqual(["notes"]);
    expect(written.document["notes"]).toBe("");
  });

  it.each([
    ["a member number the gym uses that fails the check digit", "4111111111111112"],
    ["a twelve-digit member number", "123456789012"],
    ["a date", "2026-10-03"],
    ["a locker number", "Locker 214"],
    ["a UK postcode", "LS1 4AP"],
  ])("a cell that is NOT a card is written as it is — %s", (_label, cell) => {
    const written = extraForWriting([cell], [kept("custom_field_1", "Custom Field 1", 0)]);
    expect(written.document).toEqual({ custom_field_1: cell });
    expect(written.cardsDropped).toBe(0);
  });

  it("the three WORDS a record keeps are asked the same question, so a card cannot be written as a status", () => {
    expect(wordForWriting("4111111111111111")).toEqual({ value: null, card: true });
    expect(wordForWriting("Gold")).toEqual({ value: "Gold", card: false });
    expect(wordForWriting("Overdue")).toEqual({ value: "Overdue", card: false });
    // Not a word at all is not a card either, and must not become one.
    expect(wordForWriting(null)).toEqual({ value: null, card: false });
    expect(wordForWriting("")).toEqual({ value: "", card: false });
  });

  it("a cut never splits a character in two, which the database would refuse", () => {
    // An emoji is two UTF-16 units. Sliced between them, the lone half is JSON that
    // Postgres's jsonb rejects, and the confirm would fail on the row.
    const cell = `${"x".repeat(MEMBER_LIST_MAX_EXTRA_CHARS - 1)}\u{1F4AA}`;
    const written = extraForWriting([cell], [kept("notes", "Notes", 0)]);
    const note = written.document["notes"] ?? "";
    expect(note.length).toBeLessThanOrEqual(MEMBER_LIST_MAX_EXTRA_CHARS);
    expect(/[\uD800-\uDBFF]$/.test(note)).toBe(false);
  });

  it("a cell longer than we keep is cut, not dropped, and the cut is where the limit is", () => {
    const long = "x".repeat(MEMBER_LIST_MAX_EXTRA_CHARS + 50);
    const written = extraForWriting([long], [kept("notes", "Notes", 0)]);
    expect(written.document["notes"]).toHaveLength(MEMBER_LIST_MAX_EXTRA_CHARS);
    expect(written.cardsDropped).toBe(0);
  });

  it("a column the gym does not keep contributes NOTHING to the document, whatever its cell holds", () => {
    // Two cells, one kept column: a rule that walked the CELLS instead of the kept
    // fields would write the second cell under the first key — the "Locker read out of
    // Notes" class, which is why `at` is carried rather than recomputed.
    const written = extraForWriting(["Locker 214", "4111111111111111"], [kept("locker_no", "Locker No", 0)]);
    expect(written.document).toEqual({ locker_no: "Locker 214" });
    expect(written.cardsDropped).toBe(0);
  });
});

// ===========================================================================
// THE OTHER WORST THING: AN EX-MEMBER STILL COUNTED (§11.1)
// ===========================================================================

describe("former records: kept, and off the list in every sense", () => {
  it("somebody the file no longer holds is GONE ONCE and never again", () => {
    // The first upload takes them off. The SECOND must not: `gone` is what a confirm
    // marks former, so an already-former record in it would have a fresh date written
    // over the day they really left, and would sit in the wrong-file guard's numbers
    // for every upload for ever — the same mistake `leaving` avoids on the members'
    // side.
    const first = run({ rows: [row(WHO)], entries: [entry(WHO), entry(OTHER)], members: [], mode: "whole_list", hasList: true });
    expect(first.gone.map((p) => p.fullName)).toEqual([OTHER.fullName]);

    const after = run({
      rows: [row(WHO)],
      entries: [entry(WHO), entry(OTHER, { former: true })],
      members: [],
      mode: "whole_list",
      hasList: true,
    });
    expect(after.gone).toEqual([]);
    expect(after.counts.gone).toBe(0);
  });

  it("a former record is in NO count of the list's size, so the wrong-file guard measures the living list", () => {
    const living = Array.from({ length: 12 }, (_, i) =>
      entry({ fullName: `P${String(i)}`, email: `p${String(i)}@members.example`, phone: null, memberNumber: null }),
    );
    const dead = Array.from({ length: 200 }, (_, i) =>
      entry({ fullName: `D${String(i)}`, email: `d${String(i)}@members.example`, phone: null, memberNumber: null }, { former: true }),
    );
    const out = run({ rows: [], entries: [...living, ...dead], members: [], mode: "whole_list", hasList: true });
    // 12, not 212. Measured against 212 the guard would think emptying the whole list
    // was a 5 % change and wave it through without a tick.
    expect(out.guard.listSize).toBe(12);
    expect(out.guard.entriesGoing).toBe(12);
    expect(out.guard.needsTick).toBe(true);
    expect(out.guard.mostOfListWouldGo).toBe(true);
  });

  it("A MEMBER WHOSE ONLY MATCH IS A FORMER RECORD IS NOT ON THE LIST — the mark, the words and the leaving count all say so", () => {
    const out = run({
      rows: [],
      entries: [entry(WHO, { former: true, status: "Active", memberNumber: "M-1" })],
      members: [member({ userId: "u1", email: WHO.email, everListed: true })],
      mode: "add",
      hasList: true,
    });
    // "add" with no rows asks what the stored list says TODAY (§9.7). The gym took
    // this person off, so the console must not print "on your list" beside them.
    expect(out.marks).toEqual([{ userId: "u1", mark: "no_longer_listed", leaving: false }]);
    expect(out.members).toEqual({ leaving: 0, listedNow: 0 });
    expect(out.membersLeaving).toEqual([]);
  });

  it("a former record does not put its address back on the list in ADD mode", () => {
    // An add keeps everybody already ON the list beside the file. A former record is
    // not on it, so it must not be carried into the list the members are measured
    // against — otherwise taking somebody off and then adding one person would quietly
    // relist everybody the gym has ever had.
    const out = run({
      rows: [row(OTHER)],
      entries: [entry(WHO, { former: true })],
      members: [member({ userId: "u1", email: WHO.email, everListed: true })],
      mode: "add",
      hasList: true,
    });
    expect(out.marks).toEqual([{ userId: "u1", mark: "no_longer_listed", leaving: false }]);
  });

  it("a file that holds a former person again REVIVES that record: new to the list, returning to the gym, and never an INSERT", () => {
    const out = run({
      rows: [row(WHO, { status: "Active" })],
      entries: [entry(WHO, { former: true, status: "Expired" })],
      members: [],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.counts.new).toBe(1);
    expect(out.counts.returning).toBe(1);
    expect(out.counts.changed).toBe(0);
    expect(out.added).toEqual([]);
    expect(out.returning.map((p) => p.fullName)).toEqual([WHO.fullName]);
    // The status the list still held, so a screen can print what they came back from.
    expect(out.returning[0]?.wasStatus).toBe("Expired");
    // An INSERT here would raise on the identity key's UNIQUE, which covers former
    // rows — and if it did not, the gym would hold two records of one person.
    expect(out.new).toHaveLength(1);
  });

  it("somebody the gym has never had is ADDED and is not counted as returning", () => {
    const out = run({ rows: [row(WHO)], entries: [], members: [], mode: "whole_list", hasList: true });
    expect(out.counts).toMatchObject({ new: 1, returning: 0 });
    expect(out.added).toHaveLength(1);
    expect(out.returning).toEqual([]);
  });

  it("`returning` is a SLICE of `new` and not a group beside it", () => {
    const out = run({
      rows: [row(WHO, { status: "Active" }), row(OTHER, { status: "Active" })],
      entries: [entry(OTHER, { former: true })],
      members: [],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.counts.new).toBe(2);
    expect(out.counts.returning).toBe(1);
    expect(out.added).toHaveLength(1);
    expect(out.new).toHaveLength(2);
  });
});

// ===========================================================================
// WHAT "CHANGED" MEANS NOW: FIELD BY FIELD (§11.4)
// ===========================================================================

describe("changed, field by field", () => {
  interface Case {
    label: string;
    file: Partial<MemberListRow>;
    stored: Partial<ListEntry>;
    /** The field names the breakdown should name, or [] for no change at all. */
    fields: string[];
  }

  const cases: Case[] = [
    { label: "the gym's status word moved", file: { status: "Frozen" }, stored: { status: "Active" }, fields: ["status"] },
    {
      label: "the gym's membership word moved — 'Gold' to 'Student 12 months'",
      file: { membershipType: "Student 12 months" },
      stored: { membershipType: "Gold" },
      fields: ["membershipType"],
    },
    {
      label: "the payment word moved, and it is NOT read as a state of membership",
      file: { paymentStatus: "Overdue" },
      stored: { paymentStatus: "Paid" },
      fields: ["paymentStatus"],
    },
    { label: "the join date moved", file: { joinedOn: "2026-04-03" }, stored: { joinedOn: "2025-04-03" }, fields: ["joinedOn"] },
    { label: "the end date moved", file: { endsOn: "2026-10-03" }, stored: { endsOn: "2026-09-03" }, fields: ["endsOn"] },
    {
      label: "the date of birth moved, which is the one nobody should be changing often",
      file: { dateOfBirth: "1991-02-07" },
      stored: { dateOfBirth: "1991-07-02" },
      fields: ["dateOfBirth"],
    },
    {
      label: "SEVERAL fields moved at once, and each is named",
      file: { status: "Frozen", membershipType: "Gold", endsOn: "2026-10-03" },
      stored: { status: "Active", membershipType: "Silver", endsOn: "2026-09-03" },
      fields: ["status", "membershipType", "endsOn"],
    },
    {
      label: "A WORD THAT DIFFERS ONLY BY CASE IS NOT A CHANGE — two exports of one gym write Gold and GOLD",
      file: { membershipType: "GOLD" },
      stored: { membershipType: "Gold" },
      fields: [],
    },
    {
      label: "…nor by the spaces around it",
      file: { paymentStatus: "Paid" },
      stored: { paymentStatus: "Paid" },
      fields: [],
    },
    {
      label: "the same day is not a change",
      file: { joinedOn: "2026-04-03", endsOn: "2027-04-02", dateOfBirth: "1991-02-07" },
      stored: { joinedOn: "2026-04-03", endsOn: "2027-04-02", dateOfBirth: "1991-02-07" },
      fields: [],
    },
    {
      label: "A FILE'S EMPTY CELL AGAINST A STORED WORD IS A CHANGE — the gym cleared it in its own software",
      file: { status: null },
      stored: { status: "Active" },
      fields: ["status"],
    },
    {
      label: "and a stored nothing against a file's word is a change the other way",
      file: { membershipType: "Gold" },
      stored: { membershipType: null },
      fields: ["membershipType"],
    },
  ];

  it.each(cases)("$label", ({ file, stored, fields }) => {
    const out = run({
      rows: [row(WHO, file)],
      entries: [entry(WHO, stored)],
      members: [],
      mode: "whole_list",
      hasList: true,
    });
    if (fields.length === 0) {
      expect(out.counts).toMatchObject({ changed: 0, unchanged: 1 });
      expect(out.fieldChanges).toEqual([]);
      return;
    }
    expect(out.counts).toMatchObject({ changed: 1, unchanged: 0 });
    expect(out.fieldChanges.map((change) => change.field)).toEqual(fields);
    expect(out.fieldChanges.every((change) => change.count === 1)).toBe(true);
  });

  it("THE KIND WITHOUT A DAY IS NOT A CHANGE, so the same file twice does not say so for ever", () => {
    // Round one, High-2. The write only ever stores a kind where there is a day for it
    // (both statements null it with the day, and the table's own CHECK forbids anything
    // else), so comparing the file's "renews" against the record's NULL called every
    // person with an EMPTY end cell `changed` — on every upload, for ever. Three things
    // at once: a number staff read that is false, on the one field the breakdown exists
    // to watch; a version bump for a confirm that moved nothing; and a hand-edit mark
    // cleared for a field nothing overwrote.
    const out = run({
      rows: [row(WHO, { endsOn: null })],
      entries: [entry(WHO, { endsOn: null, endsOnKind: null })],
      members: [],
      mode: "whole_list",
      hasList: true,
      endsOnKind: "renews",
    });
    expect(out.counts).toMatchObject({ changed: 0, unchanged: 1 });
    expect(out.fieldChanges).toEqual([]);
    expect(out.unchanged[0]?.moved).toEqual([]);
  });

  it("…and a day arriving where there was none IS a change, kind and all", () => {
    const out = run({
      rows: [row(WHO, { endsOn: "2027-04-02" })],
      entries: [entry(WHO, { endsOn: null, endsOnKind: null })],
      members: [],
      mode: "whole_list",
      hasList: true,
      endsOnKind: "renews",
    });
    expect(out.fieldChanges).toEqual([{ field: "endsOn", count: 1 }]);
  });

  it("the end-or-renewal KIND moving is an `endsOn` change, though the day itself did not move", () => {
    // A gym whose heading went from "Expiry Date" to "Renewal Date" is telling its
    // members a different sentence — "Ends 3 Oct" becomes "Renews 3 Oct" — so the
    // record has to be written. It is counted under `endsOn` rather than growing a
    // field name that is really a property of a column.
    const out = run({
      rows: [row(WHO, { endsOn: "2026-10-03" })],
      entries: [entry(WHO, { endsOn: "2026-10-03", endsOnKind: "ends" })],
      members: [],
      mode: "whole_list",
      hasList: true,
      endsOnKind: "renews",
    });
    expect(out.counts.changed).toBe(1);
    expect(out.fieldChanges).toEqual([{ field: "endsOn", count: 1 }]);
  });

  it("the breakdown COUNTS PEOPLE PER FIELD, so a badly-read date column cannot hide inside one number", () => {
    // The case this whole breakdown exists for: 412 records "changed" could be 412
    // corrected phone numbers or 412 dates read the wrong way round off one column,
    // and §11.3's date switch is useless if nothing says which.
    const people = Array.from({ length: 5 }, (_, i) => ({
      fullName: `P${String(i)}`,
      email: `p${String(i)}@members.example`,
      phone: null,
      memberNumber: null,
    }));
    const out = run({
      rows: people.map((who, i) => ({ ...row(who, { joinedOn: "2026-03-04", status: i === 0 ? "Frozen" : "Active" }), row: i + 2 })),
      entries: people.map((who) => entry(who, { joinedOn: "2026-04-03", status: "Active" })),
      members: [],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.counts.changed).toBe(5);
    expect(out.fieldChanges).toEqual([
      { field: "status", count: 1 },
      { field: "joinedOn", count: 5 },
    ]);
  });

  it("A FIELD THE FILE DOES NOT CARRY IS LEFT ALONE — a narrower export does not empty a gym's record", () => {
    // The class this reverses: before 3a-v-b a file with no status column emptied
    // every status word the gym had. A gym exporting name and address only must not
    // lose its membership types, its dates and its payment words off every person —
    // and the columns a file leaves out are exactly the ones §11.2 refuses to keep.
    const out = run({
      rows: [row(WHO)],
      entries: [
        entry(WHO, {
          status: "Active",
          membershipType: "Gold",
          joinedOn: "2024-01-08",
          endsOn: "2027-01-07",
          endsOnKind: "renews",
          paymentStatus: "Paid",
          dateOfBirth: "1991-02-07",
        }),
      ],
      members: [],
      mode: "whole_list",
      hasList: true,
      carries: { fullName: true, email: true, phone: true, memberNumber: true, status: false, membershipType: false, joinedOn: false, endsOn: false, paymentStatus: false, dateOfBirth: false },
    });
    expect(out.counts).toMatchObject({ changed: 0, unchanged: 1 });
    expect(out.fieldChanges).toEqual([]);
  });

  it("…and a file that carries only SOME of them changes only those", () => {
    const out = run({
      rows: [row(WHO, { status: "Frozen" })],
      entries: [entry(WHO, { status: "Active", membershipType: "Gold", dateOfBirth: "1991-02-07" })],
      members: [],
      mode: "whole_list",
      hasList: true,
      carries: { ...ALL, membershipType: false, dateOfBirth: false },
    });
    expect(out.fieldChanges).toEqual([{ field: "status", count: 1 }]);
  });
});

// ===========================================================================
// THE GYM'S OWN COLUMNS (§11.1)
// ===========================================================================

describe("the gym's own columns", () => {
  const LOCKER = kept("locker_no", "Locker No", 0);
  const GENDER = kept("gender", "Gender", 1);

  it("a cell of the gym's own column moving is a change, named by the heading the GYM wrote", () => {
    const out = run({
      rows: [row(WHO, { extra: ["214", "F"] })],
      entries: [entry(WHO, { extra: { locker_no: "118", gender: "F" } })],
      members: [],
      mode: "whole_list",
      hasList: true,
      keptFields: [LOCKER, GENDER],
    });
    expect(out.counts.changed).toBe(1);
    expect(out.extraChanges).toEqual([{ key: "locker_no", label: "Locker No", count: 1 }]);
    expect(out.fieldChanges).toEqual([]);
  });

  it("A KEY THE RECORD HAS NEVER HELD AND AN EMPTY CELL ARE THE SAME THING — a gym's first upload of a new column is not a change for everybody who left it blank", () => {
    const out = run({
      rows: [row(WHO, { extra: ["", ""] })],
      entries: [entry(WHO, { extra: {} })],
      members: [],
      mode: "whole_list",
      hasList: true,
      keptFields: [LOCKER, GENDER],
    });
    expect(out.counts).toMatchObject({ changed: 0, unchanged: 1 });
    expect(out.extraChanges).toEqual([]);
  });

  it("A KEY THE RECORD HOLDS THAT THIS FILE DOES NOT CARRY IS NOT COMPARED — the document is merged, never replaced", () => {
    // A gym exporting a narrower report has not stopped keeping the columns it leaves
    // out; the cells are still on its people and the person's page still shows them.
    const out = run({
      rows: [row(WHO, { extra: ["214"] })],
      entries: [entry(WHO, { extra: { locker_no: "214", emergency_contact_name: "Ife Nkemdirim" } })],
      members: [],
      mode: "whole_list",
      hasList: true,
      keptFields: [LOCKER],
    });
    expect(out.counts).toMatchObject({ changed: 0, unchanged: 1 });
    expect(out.extraChanges).toEqual([]);
  });

  it("the cell is read at the field's OWN place in the row, so filtering the file's columns cannot shift them", () => {
    // The gym keeps only the SECOND of this file's two columns. Reading `extra[0]` for
    // it would compare the gym's "Locker No" against its "Gender" cell.
    const out = run({
      rows: [row(WHO, { extra: ["214", "F"] })],
      entries: [entry(WHO, { extra: { gender: "F" } })],
      members: [],
      mode: "whole_list",
      hasList: true,
      keptFields: [kept("gender", "Gender", 1)],
    });
    expect(out.counts).toMatchObject({ changed: 0, unchanged: 1 });
  });
});

// ===========================================================================
// STAFF'S OWN CORRECTIONS (§11.4)
// ===========================================================================

describe("hand edits: a correction is never written over without a tick", () => {
  it("a field staff typed in, which this file would change, is reported by its plain name", () => {
    const out = run({
      rows: [row(WHO, { phone: null, status: "Frozen" })],
      entries: [entry(WHO, { status: "Active", handEdited: ["status"] })],
      members: [],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.handEdits).toEqual({ entries: 1, fields: ["status"] });
  });

  it("the NAMES are plain English, not the field's own spelling in the code", () => {
    const out = run({
      rows: [row(WHO, { endsOn: "2026-10-03", dateOfBirth: "1991-02-07" })],
      entries: [entry(WHO, { endsOn: "2026-09-03", dateOfBirth: "1991-07-02", handEdited: ["endsOn", "dateOfBirth"] })],
      members: [],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.handEdits).toEqual({ entries: 1, fields: ["end or renewal date", "date of birth"] });
  });

  it("A FIELD STAFF TYPED IN THAT THIS FILE AGREES WITH IS NOT REPORTED — there is nothing to lose", () => {
    const out = run({
      rows: [row(WHO, { status: "Active" })],
      entries: [entry(WHO, { status: "Active", handEdited: ["status"] })],
      members: [],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.handEdits).toEqual({ entries: 0, fields: [] });
  });

  it("…and neither is one the file does not CARRY at all", () => {
    const out = run({
      rows: [row(WHO)],
      entries: [entry(WHO, { membershipType: "Gold", handEdited: ["membershipType"] })],
      members: [],
      mode: "whole_list",
      hasList: true,
      carries: { ...ALL, membershipType: false },
    });
    expect(out.handEdits).toEqual({ entries: 0, fields: [] });
  });

  it("one of the GYM'S OWN columns is reported by the gym's own heading, which is the only name staff know it by", () => {
    const out = run({
      rows: [row(WHO, { extra: ["Ife Nkemdirim"] })],
      entries: [
        entry(WHO, {
          extra: { emergency_contact_name: "Ife N." },
          handEdited: ["extra:emergency_contact_name"],
        }),
      ],
      members: [],
      mode: "whole_list",
      hasList: true,
      keptFields: [kept("emergency_contact_name", "Emergency Contact Name", 0)],
    });
    expect(out.handEdits).toEqual({ entries: 1, fields: ["Emergency Contact Name"] });
  });

  it("A RETURNING RECORD'S CORRECTIONS COUNT TOO — coming back rewrites the whole record from the file", () => {
    const out = run({
      rows: [row(WHO, { status: "Active" })],
      entries: [entry(WHO, { former: true, status: "Expired", handEdited: ["status"] })],
      members: [],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.counts.returning).toBe(1);
    expect(out.handEdits).toEqual({ entries: 1, fields: ["status"] });
  });

  it("the count is RECORDS and the names are a set, so ten people losing one field is one field and ten records", () => {
    const people = Array.from({ length: 10 }, (_, i) => ({
      fullName: `P${String(i)}`,
      email: `p${String(i)}@members.example`,
      phone: null,
      memberNumber: null,
    }));
    const out = run({
      rows: people.map((who, i) => ({ ...row(who, { status: "Frozen" }), row: i + 2 })),
      entries: people.map((who) => entry(who, { status: "Active", handEdited: ["status"] })),
      members: [],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.handEdits).toEqual({ entries: 10, fields: ["status"] });
  });

  it("`moved` names exactly the fields this file overwrote, so only those marks are cleared", () => {
    // A mark on a field the file left alone, or agrees with, is owed the same question
    // next month — so clearing every mark on a changed record would quietly drop the
    // guard for the fields this file never touched.
    const out = run({
      // The file AGREES about the membership type and the locker, and differs on the
      // status. So only the status mark has done its work.
      rows: [row(WHO, { status: "Frozen", membershipType: "Gold", extra: ["214"] })],
      entries: [
        entry(WHO, {
          status: "Active",
          membershipType: "Gold",
          extra: { locker_no: "214" },
          handEdited: ["status", "membershipType", "extra:locker_no"],
        }),
      ],
      members: [],
      mode: "whole_list",
      hasList: true,
      keptFields: [kept("locker_no", "Locker No", 0)],
    });
    expect(out.changed[0]?.moved).toEqual(["status"]);
    expect(out.handEdits).toEqual({ entries: 1, fields: ["status"] });
  });

  it("nobody the file ADDS has anything to lose, so a fresh row's `moved` is empty", () => {
    const out = run({ rows: [row(WHO, { status: "Active" })], entries: [], members: [], mode: "whole_list", hasList: true });
    expect(out.added[0]?.moved).toEqual([]);
    expect(out.handEdits).toEqual({ entries: 0, fields: [] });
  });
});

// ===========================================================================
// THE CATALOGUE (§11.1)
// ===========================================================================

describe("the gym's catalogue of its own columns", () => {
  /** Headings from real products' exports and templates (§11.9): Gymdesk's own field
   *  list and PushPress's migration page, plus ones no list of ours has heard of. */
  const REAL = [
    { key: "zip_postal_code", label: "Zip/Postal Code" },
    { key: "check_in_code", label: "Check-in Code" },
    { key: "emergency_contact_name", label: "Emergency Contact Name" },
    { key: "custom_field_1", label: "Custom Field 1" },
    { key: "gender", label: "Gender" },
    { key: "locker_no", label: "Locker No" },
    { key: "gotra", label: "Gotra" },
    { key: "batch", label: "Batch" },
  ];

  it("a heading the gym already has keeps its key, its FIRST spelling and its place", () => {
    const have: FieldSlot[] = [{ key: "locker_no", label: "Locker No", ord: 0 }];
    const { catalogue, fresh } = growFields(have, [{ key: "locker_no", label: "LOCKER NO" }], MEMBER_LIST_MAX_EXTRA_FIELDS);
    expect(fresh).toEqual([]);
    expect(catalogue).toEqual(have);
  });

  it("headings the gym has never had are appended in the file's own order, after what it has", () => {
    const have: FieldSlot[] = [{ key: "gender", label: "Gender", ord: 0 }];
    const { catalogue, fresh } = growFields(have, REAL, MEMBER_LIST_MAX_EXTRA_FIELDS);
    expect(fresh.map((f) => f.key)).toEqual([
      "zip_postal_code",
      "check_in_code",
      "emergency_contact_name",
      "custom_field_1",
      "locker_no",
      "gotra",
      "batch",
    ]);
    expect(fresh.map((f) => f.ord)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(catalogue).toHaveLength(8);
  });

  it("THE CEILING IS THE GYM'S AND NOT THE FILE'S: a gym already at it keeps every column it has and adds none", () => {
    const have: FieldSlot[] = Array.from({ length: MEMBER_LIST_MAX_EXTRA_FIELDS }, (_, i) => ({
      key: `field_${String(i)}`,
      label: `Field ${String(i)}`,
      ord: i,
    }));
    const { catalogue, fresh } = growFields(have, REAL, MEMBER_LIST_MAX_EXTRA_FIELDS);
    expect(fresh).toEqual([]);
    expect(catalogue).toEqual(have);
  });

  it("…and a gym with room for two takes the FIRST two, which is the file's own left-to-right order", () => {
    const have: FieldSlot[] = Array.from({ length: MEMBER_LIST_MAX_EXTRA_FIELDS - 2 }, (_, i) => ({
      key: `field_${String(i)}`,
      label: `Field ${String(i)}`,
      ord: i,
    }));
    const { fresh } = growFields(have, REAL, MEMBER_LIST_MAX_EXTRA_FIELDS);
    expect(fresh.map((f) => f.key)).toEqual(["zip_postal_code", "check_in_code"]);
  });

  it("the next place carries on from the highest the gym has, never from how many rows it has", () => {
    // A gym that has deleted a field has a gap in its order; restarting at the count
    // would collide with a key it still holds.
    const have: FieldSlot[] = [{ key: "gender", label: "Gender", ord: 7 }];
    const { fresh } = growFields(have, [{ key: "batch", label: "Batch" }], MEMBER_LIST_MAX_EXTRA_FIELDS);
    expect(fresh).toEqual([{ key: "batch", label: "Batch", ord: 8 }]);
  });

  it("AN UNNAMED COLUMN KEEPS ITS KEY WHEN A NAMED ONE IS INSERTED BESIDE IT (round one, High-3)", () => {
    // Keyed by its place in the sheet, one unnamed column became a SECOND catalogue
    // field the moment any column was inserted to its left — the same cell stored
    // twice under two keys, both with an empty label, and nothing clearing the stale
    // one because a whole-list upload MERGES the document. Numbered among the unnamed
    // columns instead, it is stable under every insertion of a named one.
    const before: MemberListExtraField[] = [
      { key: "unnamed_1", label: "Column 6", column: 5 },
      { key: "notes", label: "Notes", column: 6 },
    ];
    const after: MemberListExtraField[] = [
      { key: "notes", label: "Notes", column: 6 },
      { key: "town", label: "Town", column: 5 },
      { key: "unnamed_1", label: "Column 7", column: 7 },
    ];
    const grown = growFields([], before, MEMBER_LIST_MAX_EXTRA_FIELDS);
    const grownAgain = growFields(grown.catalogue, after, MEMBER_LIST_MAX_EXTRA_FIELDS);
    // One slot for the unnamed column, not two, and the gym's FIRST label for it.
    expect(grownAgain.catalogue.map((f) => f.key)).toEqual(["unnamed_1", "notes", "town"]);
    expect(grownAgain.catalogue[0]?.label).toBe("Column 6");
    // …and the cell lands under the one key, read at the column's new place.
    const { kept: mine } = keptFields(grownAgain.catalogue, after);
    expect(mine.map((f) => `${f.key}@${String(f.at)}`)).toEqual(["notes@0", "town@1", "unnamed_1@2"]);
  });

  it("what the gym keeps is matched to the file BY POSITION, and what it does not keep is counted", () => {
    const fileFields: MemberListExtraField[] = [
      { key: "zip_postal_code", label: "Zip/Postal Code", column: 5 },
      { key: "gotra", label: "Gotra", column: 6 },
      { key: "batch", label: "Batch", column: 7 },
    ];
    const catalogue: FieldSlot[] = [
      { key: "batch", label: "Batch", ord: 0 },
      { key: "zip_postal_code", label: "Postcode", ord: 1 },
    ];
    const { kept: mine, over } = keptFields(catalogue, fileFields);
    // `at` is the place in the ROW's own cells, which is the file field's index and
    // never the sheet column or the catalogue's order.
    expect(mine).toEqual([
      { key: "zip_postal_code", label: "Postcode", at: 0 },
      { key: "batch", label: "Batch", at: 2 },
    ]);
    // "Gotra" is a heading this gym does not keep, so it is counted and named to staff
    // by the preview's own warning rather than silently dropped.
    expect(over).toBe(1);
    // THE LABEL IS THE CATALOGUE'S, so what staff read is the heading their gym has
    // always used — "Postcode" — and not this month's export's wording.
    expect(mine[0]?.label).toBe("Postcode");
  });
});
