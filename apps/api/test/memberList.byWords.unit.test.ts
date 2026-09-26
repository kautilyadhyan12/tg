// REMOVE BY STATUS AND THE CSV FILE — the pure rules, every class of case (5b-iii).
import { describe, expect, it } from "vitest";
import { byWordsDigest, byWordsGroup, removedByWords, type MemberForWords, type RecordWords } from "../src/modules/orgs/memberList/byWords.js";
import { contentDisposition, csvField, csvHeader, csvLine, exportFileName, type CsvShape } from "../src/modules/orgs/memberList/exportCsv.js";
import type { EntryRow } from "../src/modules/orgs/memberList/repo.js";
import type { WordFilters } from "../src/modules/orgs/invites/repo.js";

const GYM = "00000000-0000-4000-8000-000000000001";
const OTHER_GYM = "00000000-0000-4000-8000-000000000002";

const words = (status: string | null, paymentStatus: string | null = null, membershipType: string | null = null): RecordWords => ({
  status,
  membershipType,
  paymentStatus,
});

const person = (over: Partial<MemberForWords> & { userId: string }): MemberForWords => ({
  fullName: over.userId,
  email: null,
  joinedAt: new Date("2026-09-01T00:00:00Z"),
  seatCounted: true,
  joined: null,
  reaching: [],
  ...over,
});

/** Filters as the service folds them: case and spaces down, "" is "no word". */
const only = (statuses: string[] | null, paymentStatuses: string[] | null = null, membershipTypes: string[] | null = null): WordFilters => ({
  statuses,
  membershipTypes,
  paymentStatuses,
});

describe("removedByWords: who a removal by status takes out", () => {
  const cancelled = only(["cancelled"]);
  const cases: { name: string; member: MemberForWords; filters: WordFilters; removed: boolean }[] = [
    // The record they joined with decides alone.
    { name: "joined record carries the word", member: person({ userId: "a", joined: { current: true, words: words("Cancelled") } }), filters: cancelled, removed: true },
    { name: "joined record does not carry it", member: person({ userId: "a", joined: { current: true, words: words("Active") } }), filters: cancelled, removed: false },
    { name: "joined record came off the list (no longer listed, not this group)", member: person({ userId: "a", joined: { current: false, words: words("Cancelled") } }), filters: cancelled, removed: false },
    // Reached by address: every record holding it must carry the word.
    { name: "one record by address, carries it", member: person({ userId: "a", reaching: [words("Cancelled")] }), filters: cancelled, removed: true },
    { name: "two records by address, both carry it", member: person({ userId: "a", reaching: [words("Cancelled"), words("cancelled")] }), filters: cancelled, removed: true },
    { name: "a mother Active, her son Cancelled, one address", member: person({ userId: "a", reaching: [words("Active"), words("Cancelled")] }), filters: cancelled, removed: false },
    { name: "the son's word listed first changes nothing", member: person({ userId: "a", reaching: [words("Cancelled"), words("Active")] }), filters: cancelled, removed: false },
    { name: "a record with no status beside a Cancelled one", member: person({ userId: "a", reaching: [words(null), words("Cancelled")] }), filters: cancelled, removed: false },
    { name: "no record reaches them (not on the list)", member: person({ userId: "a" }), filters: cancelled, removed: false },
    // Never a place that is not a paid seat.
    { name: "owner or staff, joined record Cancelled", member: person({ userId: "a", seatCounted: false, joined: { current: true, words: words("Cancelled") } }), filters: cancelled, removed: false },
    { name: "free place, record by address Cancelled", member: person({ userId: "a", seatCounted: false, reaching: [words("Cancelled")] }), filters: cancelled, removed: false },
    // The words, as the Filter reads them.
    { name: "case and spaces folded on the record", member: person({ userId: "a", reaching: [words(" CANCELLED ")] }), filters: cancelled, removed: true },
    { name: "a spelling the gym never used matches nothing", member: person({ userId: "a", reaching: [words("Cancelled")] }), filters: only(["canceled"]), removed: false },
    { name: "one of two words ticked", member: person({ userId: "a", reaching: [words("Expired")] }), filters: only(["cancelled", "expired"]), removed: true },
    { name: "each record may carry a different ticked word", member: person({ userId: "a", reaching: [words("Expired"), words("Cancelled")] }), filters: only(["cancelled", "expired"]), removed: true },
    { name: "'no status' ticked, record has none", member: person({ userId: "a", reaching: [words(null)] }), filters: only([""]), removed: true },
    { name: "'no status' ticked, record has a word", member: person({ userId: "a", reaching: [words("Active")] }), filters: only([""]), removed: false },
    { name: "two kinds both asked: both carried", member: person({ userId: "a", reaching: [words("Cancelled", "Overdue")] }), filters: only(["cancelled"], ["overdue"]), removed: true },
    { name: "two kinds both asked: one missing", member: person({ userId: "a", reaching: [words("Cancelled", "Paid")] }), filters: only(["cancelled"], ["overdue"]), removed: false },
    { name: "membership word alone", member: person({ userId: "a", reaching: [words("Active", null, "Trial")] }), filters: only(null, null, ["trial"]), removed: true },
    { name: "a word in another kind does not count", member: person({ userId: "a", reaching: [words("Active", "Cancelled")] }), filters: cancelled, removed: false },
  ];
  it.each(cases)("$name → removed: $removed", ({ member, filters, removed }) => {
    expect(removedByWords(member, filters)).toBe(removed);
  });

  it("the group is sorted by name then id, and holds only those removed", () => {
    const group = byWordsGroup(
      [
        person({ userId: "3", fullName: "Zed", reaching: [words("Cancelled")] }),
        person({ userId: "2", fullName: "Amy", reaching: [words("Cancelled")] }),
        person({ userId: "1", fullName: "Amy", reaching: [words("Cancelled")] }),
        person({ userId: "4", fullName: "Bob", reaching: [words("Active")] }),
      ],
      cancelled,
    );
    expect(group.map((m) => m.userId)).toEqual(["1", "2", "3"]);
  });
});

describe("byWordsDigest: the set's fingerprint", () => {
  const base = byWordsDigest(GYM, only(["cancelled", "expired"]), ["b", "a"]);
  it("does not depend on the order of the words or the people", () => {
    expect(byWordsDigest(GYM, only(["expired", "cancelled"]), ["a", "b"])).toBe(base);
  });
  it("changes with the gym, the words, the kind of word and the people", () => {
    const others = [
      byWordsDigest(OTHER_GYM, only(["cancelled", "expired"]), ["a", "b"]),
      byWordsDigest(GYM, only(["cancelled"]), ["a", "b"]),
      byWordsDigest(GYM, only(null, ["cancelled", "expired"]), ["a", "b"]),
      byWordsDigest(GYM, only(["cancelled", "expired"]), ["a", "c"]),
      byWordsDigest(GYM, only(["cancelled", "expired"]), ["a"]),
    ];
    for (const other of others) expect(other).not.toBe(base);
    expect(new Set(others).size).toBe(others.length);
  });
  it("tells 'no status' apart from no word asked", () => {
    expect(byWordsDigest(GYM, only([""]), [])).not.toBe(byWordsDigest(GYM, only(null), []));
  });
});

describe("csvField: nothing Excel would run", () => {
  const guarded = ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx", "\nx", "＝1", "＋1", "－1", "＠x"];
  it.each(guarded)("%j gets a TAB inside its quotes", (value) => {
    expect(csvField(value)).toBe(`"\t${value}"`);
  });
  const plain = ["Ann", "a=b", "1-2", "", "2026-09-26", " =x"];
  it.each(plain)("%j is written as it is", (value) => {
    expect(csvField(value)).toBe(`"${value}"`);
  });
  it("doubles quotes and keeps commas and line breaks inside the field", () => {
    expect(csvField('Bob, "Bobby"\nJones')).toBe('"Bob, ""Bobby""\nJones"');
    expect(csvField('="x"')).toBe('"\t=""x"""');
  });
  it("a shape the server checked keeps its plus or minus", () => {
    expect(csvField("+447700900111", true)).toBe('"+447700900111"');
    expect(csvField("-x@example.com", true)).toBe('"-x@example.com"');
  });
});

describe("the file's columns", () => {
  const row = (over: Partial<EntryRow>): EntryRow => ({
    entryId: "e",
    fullName: "Ann",
    email: null,
    phone: null,
    memberNumber: null,
    status: null,
    membershipType: null,
    joinedOn: null,
    endsOn: null,
    endsOnKind: null,
    paymentStatus: null,
    dateOfBirth: null,
    formerAt: null,
    source: "typed",
    inApp: false,
    extra: null,
    ...over,
  });
  const shape = (ends: number, renews: number, withRemoved = false): CsvShape => ({ fields: [{ key: "locker", label: "Locker" }], dated: { ends, renews }, withRemoved });
  const heads = (s: CsvShape) => csvHeader(s).trim().split(",");

  it.each([
    { ends: 0, renews: 0, dates: ['"End date"'] },
    { ends: 4, renews: 0, dates: ['"End date"'] },
    { ends: 0, renews: 4, dates: ['"Renewal date"'] },
    { ends: 1, renews: 3, dates: ['"End date"', '"Renewal date"'] },
  ])("$ends end dates and $renews renewal dates → $dates", ({ ends, renews, dates }) => {
    expect(heads(shape(ends, renews))).toEqual([
      '"Name"', '"Email"', '"Phone"', '"Member number"', '"Status"', '"Membership"', '"Join date"', ...dates,
      '"Payment status"', '"Date of birth"', '"Locker"',
    ]);
  });

  it("with both kinds, each date sits under its own kind; the gym's column and the removal day follow", () => {
    const both = shape(1, 1, true);
    const renews = csvLine(row({ endsOn: "2026-12-01", endsOnKind: "renews", extra: { locker: "L-1" }, formerAt: new Date("2026-09-20T10:00:00Z") }), both);
    const ends = csvLine(row({ endsOn: "2026-10-01", endsOnKind: "ends" }), both);
    expect(renews).toBe('"Ann","","","","","","","","2026-12-01","","","L-1","2026-09-20"\r\n');
    expect(ends).toBe('"Ann","","","","","","","2026-10-01","","","","",""\r\n');
    expect(heads(both).at(-1)).toBe('"Removed from list"');
  });
});

describe("the file's name says what it holds", () => {
  const day = "2026-09-26";
  it.each([
    { query: {}, name: "All members 2026-09-26.csv" },
    { query: { status: "Cancelled" }, name: "Cancelled members 2026-09-26.csv" },
    { query: { status: ["Cancelled", "Expired"], paymentStatus: "Overdue" }, name: "Cancelled or Expired, Overdue members 2026-09-26.csv" },
    { query: { status: "" }, name: "No status members 2026-09-26.csv" },
    { query: { membershipType: ["Gold", ""] }, name: "Gold or No membership members 2026-09-26.csv" },
    { query: { records: "former" as const }, name: "Past members 2026-09-26.csv" },
    { query: { status: "Active", filter: "in_app" as const }, name: "Active members in the app 2026-09-26.csv" },
    { query: { filter: "not_in_app" as const }, name: "All members not in the app 2026-09-26.csv" },
    { query: { query: "ann" }, name: "All members matching ann 2026-09-26.csv" },
    { query: { status: "Paid/Unpaid: <new>" }, name: "Paid Unpaid new members 2026-09-26.csv" },
  ])("$name", ({ query, name }) => {
    expect(exportFileName(query, "members", day)).toBe(name);
  });
  it("uses the organisation's own word", () => {
    expect(exportFileName({ records: "former" }, "clients", day)).toBe("Past clients 2026-09-26.csv");
  });
  it("is never too long to read", () => {
    const name = exportFileName({ query: "x".repeat(200) }, "members", day);
    expect(name.length).toBeLessThanOrEqual(100 + " 2026-09-26.csv".length);
  });
  it("sends the exact name, and a plain one for old browsers", () => {
    expect(contentDisposition("Cancelled members 2026-09-26.csv")).toBe(
      "attachment; filename=\"Cancelled members 2026-09-26.csv\"; filename*=UTF-8''Cancelled%20members%202026-09-26.csv",
    );
    expect(contentDisposition("Annulé members 2026-09-26.csv")).toBe(
      "attachment; filename=\"Annul_ members 2026-09-26.csv\"; filename*=UTF-8''Annul%C3%A9%20members%202026-09-26.csv",
    );
  });
});
