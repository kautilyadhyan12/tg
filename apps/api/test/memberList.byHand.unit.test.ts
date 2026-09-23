// KEEPING THE LIST BY HAND — the table tests for the pure rules (ROADMAP 3a-iv;
// Part 3 §9.8, §9.9, §11.2, §11.6; CLAUDE.md §4).
//
// The first block is the one core rule: which of a gym's members "Remove all"
// takes out of the gym. Every class of member is a row, named for what a wrong
// answer would do to that person.
//
// The typed values are written the way people type them — phone numbers in each
// market's own format, an address with capitals and a trailing space, card numbers
// with spaces and inside a note, published test card numbers — not the rule's own
// patterns.
import { describe, expect, it } from "vitest";
import type { MemberListEntryPatch } from "@app/shared";
import { applyTyped, EMPTY_VALUES, mergeValues, type EntryValues, type TypedContext } from "../src/modules/orgs/memberList/byHand.js";
import type { MemberOnList } from "../src/modules/orgs/memberList/reconcile.js";
import { unlistedDigest, unlistedGroup, unlistedPage } from "../src/modules/orgs/memberList/unlisted.js";

// ── Who "Remove all" removes ────────────────────────────────────────────────

const member = (userId: string, fullName: string, over: Partial<MemberOnList> = {}): MemberOnList => ({
  userId,
  fullName,
  email: null,
  statedPhone: null,
  everListed: false,
  seatCounted: true,
  onList: false,
  entryStatus: null,
  entryMemberNumber: null,
  ...over,
});

/** One gym's members, one of each class. `onList` is what the SQL match answers:
 *  a CURRENT record reaches their proved email, else the phone they gave. */
const GYM: MemberOnList[] = [
  member("u01", "Listed by email", { email: "a@x.example", onList: true, everListed: true }),
  member("u02", "Listed by phone", { statedPhone: "+447911123456", onList: true, everListed: true }),
  // On a list today but never stamped (joined after the confirm): still on it.
  member("u03", "Listed, never stamped", { email: "c@x.example", onList: true, everListed: false }),
  member("u04", "Dropped off", { everListed: true }),
  member("u05", "Never listed"),
  // Their unproved address is on the list; an unproved address proves nothing.
  member("u06", "Unverified address", { email: null }),
  // The owner holds a free seat and is on no export.
  member("u07", "The owner", { seatCounted: false }),
  member("u08", "A trainer", { seatCounted: false }),
  member("u09", "A trainer who was listed once", { seatCounted: false, everListed: true }),
  member("u10", "A free place", { seatCounted: false }),
  // Only a FORMER record reaches them, which is off the list.
  member("u11", "Matched only to a former record", { everListed: true }),
  // Two members of one household reached by one current record.
  member("u12", "Household parent", { email: "h@x.example", onList: true, everListed: true }),
  member("u13", "Household child", { email: "h@x.example", onList: true, everListed: true }),
];

const ids = (people: readonly MemberOnList[]) => people.map((p) => p.userId);

describe("the members 'Remove all' removes (the one core rule)", () => {
  it("never_listed holds only paid-seat members who were never on the list", () => {
    expect(ids(unlistedGroup(GYM, true, "never_listed")).sort()).toEqual(["u05", "u06"]);
  });

  it("no_longer_listed holds only paid-seat members who were on it and are not now", () => {
    expect(ids(unlistedGroup(GYM, true, "no_longer_listed")).sort()).toEqual(["u04", "u11"]);
  });

  it.each([
    ["u01", "reached by a current record's email"],
    ["u02", "reached by a current record's phone"],
    ["u03", "on the list but never stamped"],
    ["u07", "the owner"],
    ["u08", "a trainer"],
    ["u09", "a trainer who was listed once"],
    ["u10", "a free place"],
    ["u12", "a household parent on the list"],
    ["u13", "a household child on the list"],
  ])("%s (%s) is in neither group", (userId) => {
    const both = [...unlistedGroup(GYM, true, "never_listed"), ...unlistedGroup(GYM, true, "no_longer_listed")];
    expect(ids(both)).not.toContain(userId);
  });

  it("a gym that has no list removes nobody: there is nothing to be missing from", () => {
    expect(unlistedGroup(GYM, false, "never_listed")).toEqual([]);
    expect(unlistedGroup(GYM, false, "no_longer_listed")).toEqual([]);
  });

  it("the group is in name order, the id breaking a tie", () => {
    const people = [member("b", "Same"), member("a", "Same"), member("c", "Alpha")];
    expect(ids(unlistedGroup(people, true, "never_listed"))).toEqual(["c", "a", "b"]);
  });
});

describe("the group's digest", () => {
  it("names the exact set: the same people in any order give the same digest", () => {
    expect(unlistedDigest("g1", "never_listed", ["a", "b"])).toBe(unlistedDigest("g1", "never_listed", ["b", "a"]));
  });

  it("one person out and another in, the count unchanged, is a different digest", () => {
    expect(unlistedDigest("g1", "never_listed", ["a", "b"])).not.toBe(unlistedDigest("g1", "never_listed", ["a", "c"]));
  });

  it("another gym's set or the other group never matches", () => {
    const mine = unlistedDigest("g1", "never_listed", ["a"]);
    expect(unlistedDigest("g2", "never_listed", ["a"])).not.toBe(mine);
    expect(unlistedDigest("g1", "no_longer_listed", ["a"])).not.toBe(mine);
  });

  it("an empty group has a digest of its own", () => {
    expect(unlistedDigest("g1", "never_listed", [])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("a page of the group", () => {
  const people = unlistedGroup(
    Array.from({ length: 5 }, (_, i) => member(`u${String(i)}`, `Person ${String(i)}`)),
    true,
    "never_listed",
  );

  it("cuts after the last person shown and says whether there is more", () => {
    const first = unlistedPage(people, null, 2);
    expect(ids(first.shown)).toEqual(["u0", "u1"]);
    expect(first.last?.userId).toBe("u1");
    const second = unlistedPage(people, { name: "Person 1", id: "u1" }, 2);
    expect(ids(second.shown)).toEqual(["u2", "u3"]);
    const third = unlistedPage(people, { name: "Person 3", id: "u3" }, 2);
    expect(ids(third.shown)).toEqual(["u4"]);
    expect(third.last).toBeUndefined();
  });
});

// ── What staff type ─────────────────────────────────────────────────────────

const GB: TypedContext = { country: "GB", fields: new Map([["locker_no", "Locker No"], ["notes", "Notes"]]) };
const US: TypedContext = { country: "US", fields: new Map() };
const IN: TypedContext = { country: "IN", fields: new Map() };
const DE: TypedContext = { country: "DE", fields: new Map() };

const typed = (patch: MemberListEntryPatch, context: TypedContext = GB, stored: EntryValues = EMPTY_VALUES) =>
  applyTyped(stored, patch, context);

const valuesOf = (patch: MemberListEntryPatch, context: TypedContext = GB): EntryValues => {
  const out = typed(patch, context);
  if (!out.ok) throw new Error(`refused: ${out.refusal.code}`);
  return out.values;
};

const refusalOf = (patch: MemberListEntryPatch, context: TypedContext = GB, stored: EntryValues = EMPTY_VALUES): string => {
  const out = typed(patch, context, stored);
  if (out.ok) throw new Error("was not refused");
  return out.refusal.code;
};

describe("a typed phone number, in each market's own way of writing it", () => {
  it.each([
    [GB, "07911 123456", "+447911123456"],
    [GB, "+44 7911 123456", "+447911123456"],
    [GB, "(0)7911-123-456", "+447911123456"],
    [US, "(415) 555-2671", "+14155552671"],
    [US, "415.555.2671", "+14155552671"],
    [IN, "98765 43210", "+919876543210"],
    [IN, "+91-98765-43210", "+919876543210"],
    [GB, "+61 412 345 678", "+61412345678"],
  ])("%# %s is kept as %s", (context, raw, e164) => {
    expect(valuesOf({ phone: raw }, context).phone).toBe(e164);
  });

  it.each(["hello", "12", "+44 7911 1234567890123"])("%s is refused as a phone number", (raw) => {
    expect(refusalOf({ phone: raw, email: "a@x.example" })).toBe("bad_phone");
  });

  // Mobiles written the international way with no spaces, whose digits happen to pass
  // the card check digit and start with a card's 4 (review round one, High 3).
  it.each([
    [GB, "+4915100015838"],
    [GB, "+4915112345678"],
    [GB, "+4366401234563"],
    [GB, "+4366401234571"],
  ])("%# the mobile %s is kept, never read as a card", (context, raw) => {
    expect(valuesOf({ phone: raw }, context).phone).toBe(raw);
  });

  // The same kind of number written with "00" for the "+", Europe's and India's usual way,
  // whose digits pass the card check digit (the re-check of round one).
  it.each([
    [DE, "0049 151 00000400", "+4915100000400"],
    [GB, "0044 7911 000001", "+447911000001"],
    [IN, "0091 98000 00029", "+919800000029"],
  ])("%# %s is read as the phone %s, never as a card", (context, raw, e164) => {
    expect(valuesOf({ phone: raw }, context).phone).toBe(e164);
  });

  // A published 13-digit Visa test number is also a valid German landline in form, so a
  // German gym reading the phone first would keep it; the prefix-aware card rule is
  // asked before the phone is read.
  it("a 13-digit test card typed into a German gym's phone box is refused", () => {
    expect(refusalOf({ phone: "4222222222222" }, DE)).toBe("card_number");
    expect(refusalOf({ phone: "4222 2222 2222 2" }, DE)).toBe("card_number");
  });
});

describe("a typed email address", () => {
  it("is kept the way sign-in keeps it: trimmed and lower case", () => {
    expect(valuesOf({ email: "  Ann.Bell@Gmail.COM " }).email).toBe("ann.bell@gmail.com");
  });

  it.each(["ann.bell", "ann@", "Ann Bell <ann@x.example>", "a@x.example; b@x.example"])("%s is refused", (raw) => {
    expect(refusalOf({ email: raw })).toBe("bad_email");
  });
});

describe("a card number typed into any field is refused (§11.2)", () => {
  // Published test card numbers (Visa, Mastercard, Amex, Discover), written as a
  // person writes them.
  it.each([
    [{ fullName: "4111 1111 1111 1111" }, "name"],
    [{ memberNumber: "5555555555554444" }, "member number"],
    [{ memberNumber: "M-4111 1111 1111 1111" }, "member number"],
    [{ phone: "4111-1111-1111-1111" }, "phone number"],
    [{ status: "paid by card 3782 822463 10005" }, "status"],
    [{ membershipType: "6011 1111 1111 1117" }, "membership type"],
    [{ paymentStatus: "Visa 4111111111111111" }, "payment status"],
    [{ extra: { notes: "card on file 5555-5555-5555-4444" } }, "Notes"],
    // Copied from an email or a web page: no-break spaces, full-width digits, zero-width
    // joiners (review round one, High 2). The field is tidied before it is asked.
    [{ fullName: "Ada 4111 1111 1111 1111" }, "name"],
    [{ fullName: "Ada ４１１１１１１１１１１１１１１１" }, "name"],
    [{ fullName: "Ada 4111‍1111‍1111‍1111" }, "name"],
    [{ status: "4111 1111 1111 1111" }, "status"],
    [{ extra: { notes: "card 4111 1111 1111 1111" } }, "Notes"],
    // A card number as the local part of an address (review round one, Low 1).
    [{ fullName: "Ada", email: "4111111111111111@example.com" }, "email address"],
    // A card typed into the phone box, which the phone reader cannot read.
    [{ phone: "4111 1111 1111 1111" }, "phone number"],
  ] as const)("%j is refused, naming the %s", (patch, field) => {
    const out = typed({ email: "a@x.example", ...patch });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.code).toBe("card_number");
    expect(out.refusal.message).toContain(field);
    expect(out.refusal.message).not.toMatch(/\d{4}/);
  });

  it.each([
    [{ memberNumber: "M-00123" }, "M-00123"],
    [{ memberNumber: "0042" }, "0042"],
    // Sixteen digits that fail the card check digit: a key tag, kept.
    [{ memberNumber: "1234567890123456" }, "1234567890123456"],
  ])("an ordinary member number %j is kept", (patch, kept) => {
    expect(valuesOf({ email: "a@x.example", ...patch }).memberNumber).toBe(kept);
  });
});

describe("names, words and dates", () => {
  it.each(["José Álvarez", "Zoë Müller", "Siobhán O'Brien", "Nguyễn Thị Hoa"])("the name %s is kept as written", (name) => {
    expect(valuesOf({ fullName: name, email: "a@x.example" }).fullName).toBe(name);
  });

  it("spaces are tidied the way a file's cells are", () => {
    const values = valuesOf({ fullName: "  Ann   Bell ", status: " Active  member ", email: "a@x.example" });
    expect(values.fullName).toBe("Ann Bell");
    expect(values.status).toBe("Active member");
  });

  it.each(["2025-02-29", "2026-04-31", "2026-13-01", "1899-12-31"])("%s is not a real day", (day) => {
    expect(refusalOf({ email: "a@x.example", joinedOn: day })).toBe("bad_day");
  });

  it("an end kind needs an end date", () => {
    expect(refusalOf({ email: "a@x.example", endsOnKind: "renews" })).toBe("ends_kind_without_day");
    expect(valuesOf({ email: "a@x.example", endsOn: "2027-01-31", endsOnKind: "renews" }).endsOnKind).toBe("renews");
  });

  it("emptying the end date empties its kind", () => {
    const stored = valuesOf({ email: "a@x.example", endsOn: "2027-01-31", endsOnKind: "ends" });
    const out = typed({ endsOn: null }, GB, stored);
    expect(out.ok && out.values.endsOnKind).toBe(null);
  });

  it("a new end date keeps the kind it had", () => {
    const stored = valuesOf({ email: "a@x.example", endsOn: "2027-01-31", endsOnKind: "renews" });
    const out = typed({ endsOn: "2027-06-30" }, GB, stored);
    expect(out.ok && out.values.endsOnKind).toBe("renews");
  });
});

describe("the gym's own columns", () => {
  it("a key the gym keeps is written; one it does not is refused", () => {
    expect(valuesOf({ email: "a@x.example", extra: { locker_no: "L-12" } }).extra).toEqual({ locker_no: "L-12" });
    expect(refusalOf({ email: "a@x.example", extra: { shoe_size: "9" } })).toBe("unknown_field");
  });
});

describe("a record needs an email or a phone", () => {
  it("adding with neither is refused", () => {
    expect(refusalOf({ fullName: "Ann" })).toBe("needs_contact");
  });

  it("emptying the only contact is refused", () => {
    const stored = valuesOf({ email: "a@x.example" });
    expect(refusalOf({ email: null }, GB, stored)).toBe("needs_contact");
    expect(refusalOf({ email: "" }, GB, stored)).toBe("needs_contact");
  });
});

describe("what a change marks as edited by hand (§11.4)", () => {
  const stored = valuesOf({
    fullName: "Ann Bell",
    email: "a@x.example",
    status: "Active",
    endsOn: "2027-01-31",
    endsOnKind: "ends",
    extra: { locker_no: "L-1" },
  });

  it.each([
    [{ status: "Frozen" }, ["status"]],
    [{ membershipType: "Gold" }, ["membershipType"]],
    [{ endsOnKind: "renews" }, ["endsOn"]],
    [{ extra: { locker_no: "L-2" } }, ["extra:locker_no"]],
    [{ status: "Active" }, []],
    [{ extra: { locker_no: "L-1" } }, []],
  ] as const)("%j marks %j", (patch, edited) => {
    const out = typed(patch, GB, stored);
    expect(out.ok && out.edited).toEqual(edited);
  });

  it("the four identity fields are never marked, and are reported as identity changes", () => {
    const out = typed({ fullName: "Anne Bell", email: "anne@x.example", phone: "07911 123456", memberNumber: "M-1" }, GB, stored);
    expect(out.ok && out.edited).toEqual([]);
    expect(out.ok && out.identityFields).toEqual(["fullName", "email", "phone", "memberNumber"]);
  });

  it("a field left out is left alone", () => {
    const out = typed({ status: "Frozen" }, GB, stored);
    expect(out.ok && out.values).toEqual({ ...stored, status: "Frozen" });
  });
});

// ── Joining two records ─────────────────────────────────────────────────────

describe("joining two records keeps the kept record and fills only its blanks", () => {
  const keep: EntryValues = {
    ...EMPTY_VALUES,
    fullName: "John Smith",
    email: "john@x.example",
    status: "Active",
    extra: { locker_no: "", notes: "Prefers mornings" },
  };
  const gone: EntryValues = {
    ...EMPTY_VALUES,
    fullName: "Jon Smith",
    email: "jon@x.example",
    phone: "+447911123456",
    memberNumber: "M-9",
    status: "Frozen",
    membershipType: "Gold",
    endsOn: "2027-01-31",
    endsOnKind: "renews",
    extra: { locker_no: "L-4", notes: "Old note" },
  };

  it("the kept identity and every value it has stay; its empty ones are filled", () => {
    const { values, filled } = mergeValues(keep, gone);
    expect(values.fullName).toBe("John Smith");
    expect(values.email).toBe("john@x.example");
    expect(values.phone).toBeNull();
    expect(values.memberNumber).toBeNull();
    expect(values.status).toBe("Active");
    expect(values.membershipType).toBe("Gold");
    expect(values.endsOn).toBe("2027-01-31");
    expect(values.endsOnKind).toBe("renews");
    expect(values.extra).toEqual({ locker_no: "L-4", notes: "Prefers mornings" });
    expect(filled).toEqual(["membershipType", "endsOn", "extra:locker_no"]);
  });

  it("two records with nothing to fill change nothing", () => {
    expect(mergeValues(gone, keep).filled).toEqual([]);
  });
});
