// AN IMPORT'S MEMBER NUMBERS — the table test for the pure rule (ROADMAP 5e-ii; Kd,
// 2026-10-16). Every class of case the rule decides about a person: whose a number is once
// the file is written, who is given one, and who is moved off one. The last two blocks pin
// the run of numbers to the one-at-a-time rule and the rule to the import's own wiring.
import { describe, expect, it } from "vitest";
import { MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS, type MemberListRow } from "@app/shared";
import { identityKey } from "../src/modules/orgs/memberList/fields.js";
import { importNumbers, type NumberedRecord, type NumberingInput } from "../src/modules/orgs/memberList/importNumbers.js";
import { nextMemberNumber, nextMemberNumbers } from "../src/modules/orgs/memberList/memberNumbers.js";
import { reconcile, type CarriedFields, type ListEntry } from "../src/modules/orgs/memberList/reconcile.js";

const rec = (id: string, memberNumber: string | null, fullName = `Record ${id}`): NumberedRecord => ({ id, fullName, memberNumber });
const row = (fullName: string, memberNumber: string | null = null) => ({ fullName, memberNumber });

interface Case {
  name: string;
  input: Partial<NumberingInput> & Pick<NumberingInput, "rows">;
  numbers: (string | null)[];
  given?: [number, string | null, string | null];
  moved?: { entryId: string; from: string; to: string | null; toName: string; at: number | null }[];
  kept?: Record<string, string> | null;
}

const run = (input: Case["input"]) =>
  importNumbers({ matched: input.rows.map(() => null), entries: [], carried: true, kept: {}, ...input });

const CASES: Case[] = [
  {
    name: "the file's number is the person's, over the one their record holds",
    input: { rows: [row("Asha", "77")], matched: [rec("a", "5")], entries: [rec("a", "5")] },
    numbers: ["77"],
    given: [0, null, null],
    moved: [],
    kept: { "": "5" },
  },
  {
    name: "a blank cell keeps the record's number",
    input: { rows: [row("Asha", "  ")], matched: [rec("a", "5")], entries: [rec("a", "5")] },
    numbers: ["5"],
    kept: null,
  },
  {
    name: "a file with no number column keeps the record's number, whatever a cell says",
    input: { rows: [row("Asha", "77")], matched: [rec("a", "5")], entries: [rec("a", "5")], carried: false },
    numbers: ["5"],
    kept: null,
  },
  {
    name: "new people with no number are given the next ones, in the file's order",
    input: { rows: [row("New A"), row("Has", "10"), row("New B")], entries: [rec("x", "8")] },
    numbers: ["11", "10", "12"],
    given: [2, "11", "12"],
    moved: [],
    kept: { "": "12" },
  },
  {
    name: "a record the file holds with no number anywhere is given one",
    input: { rows: [row("Asha")], matched: [rec("a", null)], entries: [rec("a", null), rec("b", "3")] },
    numbers: ["4"],
    given: [1, "4", "4"],
  },
  {
    name: "a file with no number column numbers everybody without one, once",
    input: { rows: [row("A"), row("B")], matched: [rec("a", "M0041"), null], entries: [rec("a", "M0041")], carried: false },
    numbers: ["M0041", "M0042"],
    given: [1, "M0042", "M0042"],
  },
  {
    name: "a record the file leaves out whose number it gives somebody else is moved, after the numberless",
    input: { rows: [row("Ravi", "1"), row("Chitra")], entries: [rec("asha", "1", "Asha"), rec("bina", "2", "Bina")], kept: { "": "2" } },
    numbers: ["1", "3"],
    given: [1, "3", "3"],
    moved: [{ entryId: "asha", from: "1", to: "4", toName: "Ravi", at: null }],
    kept: { "": "4" },
  },
  {
    name: "a record the file holds with a blank cell whose number another row is given is moved, named with its row",
    input: { rows: [row("Ravi", "1"), row("Asha", "")], matched: [null, rec("asha", "1", "Asha")], entries: [rec("asha", "1", "Asha")] },
    numbers: ["1", "2"],
    given: [0, null, null],
    moved: [{ entryId: "asha", from: "1", to: "2", toName: "Ravi", at: 1 }],
  },
  {
    name: "a record given another number by the file is not moved when its old one goes to somebody else",
    input: { rows: [row("Ravi", "1"), row("Asha", "9")], matched: [null, rec("asha", "1", "Asha")], entries: [rec("asha", "1", "Asha")] },
    numbers: ["1", "9"],
    moved: [],
    kept: { "": "1" },
  },
  {
    name: "one number on two rows: both keep it, nobody is moved",
    input: { rows: [row("Om", "500"), row("Ria", "500")], entries: [] },
    numbers: ["500", "500"],
    moved: [],
    kept: null,
  },
  {
    name: "a past record holding the number is moved too",
    input: { rows: [row("Gita", "B101")], entries: [rec("esha", "B101", "Esha"), rec("dev", "B200", "Dev")] },
    numbers: ["B101"],
    moved: [{ entryId: "esha", from: "B101", to: "B201", toName: "Gita", at: null }],
  },
  {
    name: "a number is the same whatever its case, and every record holding it is moved",
    input: { rows: [row("Kiran", "gg-0042")], entries: [rec("a", "GG-0042", "A"), rec("b", "Gg-0042", "B")] },
    numbers: ["gg-0042"],
    moved: [
      { entryId: "a", from: "GG-0042", to: "gg-0043", toName: "Kiran", at: null },
      { entryId: "b", from: "Gg-0042", to: "gg-0044", toName: "Kiran", at: null },
    ],
  },
  {
    name: "the gym's style is continued, zeros in front kept",
    input: { rows: [row("New")], entries: [rec("a", "M0009"), rec("b", "M0010"), rec("c", "77")] },
    numbers: ["M0011"],
  },
  {
    name: "a kept number is never given, and the file may give one",
    input: { rows: [row("Typed", "900"), row("New")], entries: [rec("a", "1")], kept: { "": "950" } },
    numbers: ["900", "951"],
    kept: { "": "951" },
  },
  {
    name: "numbers too long to give: nobody is given one, and a moved record holds none",
    input: {
      rows: [row("File", "9".repeat(MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS)), row("New")],
      entries: [rec("a", "9".repeat(MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS), "A")],
    },
    numbers: ["9".repeat(MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS), null],
    given: [0, null, null],
    moved: [{ entryId: "a", from: "9".repeat(MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS), to: null, toName: "File", at: null }],
  },
  {
    name: "nobody to number: nothing given, nothing moved, nothing kept",
    input: { rows: [row("A", "1")], matched: [rec("a", "1")], entries: [rec("a", "1"), rec("b", "2")] },
    numbers: ["1"],
    given: [0, null, null],
    moved: [],
    kept: null,
  },
  {
    name: "a number with no digits at its end is kept as written and continues nothing",
    input: { rows: [row("Gold", "GOLD"), row("New")], entries: [rec("a", "Guest")] },
    numbers: ["GOLD", "1"],
  },
];

describe("an import's member numbers: every class of case", () => {
  it.each(CASES)("$name", (c) => {
    const out = run(c.input);
    expect(out.numbers).toEqual(c.numbers);
    if (c.given !== undefined) expect([out.given, out.first, out.last]).toEqual(c.given);
    if (c.moved !== undefined) expect(out.moved.map(({ entryId, from, to, toName, at }) => ({ entryId, from, to, toName, at }))).toEqual(c.moved);
    if (c.kept !== undefined) expect(out.kept).toEqual(c.kept);
    // Whatever the case: no number is held by two people unless the file gave it to both.
    const fileGave = new Set(c.input.rows.map((r) => (r.memberNumber ?? "").trim().toLowerCase()).filter((n) => n !== ""));
    const movedIds = new Set(out.moved.map((move) => move.entryId));
    const inFile = new Set((c.input.matched ?? []).flatMap((m) => (m === null ? [] : [m.id])));
    const held = [
      ...out.numbers,
      ...out.moved.filter((move) => move.at === null).map((move) => move.to),
      ...(c.input.entries ?? []).filter((e) => !inFile.has(e.id) && !movedIds.has(e.id)).map((e) => e.memberNumber),
    ].flatMap((n) => (n === null ? [] : [n.toLowerCase()]));
    const twice = held.filter((n, i) => held.indexOf(n) !== i && !fileGave.has(n));
    expect(twice).toEqual([]);
  });

  it("the same rows and records in any order of the kept numbers give the same answer", () => {
    const input = { rows: [row("A"), row("B", "M0005")], entries: [rec("x", "M0001")], kept: { m: "M0007", "": "40" } };
    const flipped = { ...input, kept: { "": "40", m: "M0007" } };
    expect(run(input)).toEqual(run(flipped));
  });
});

describe("a run of numbers is what giving them one at a time would give", () => {
  const SETS: [string[], string[]][] = [
    [[], []],
    [["1041"], []],
    [["M0041", "M0040", "m0039"], []],
    [["M0099"], []],
    [["999"], []],
    [["7", "A1", "A2"], ["A9"]],
    [[], ["X0005"]],
    [["2024-0045", "2024-0046", "17"], ["2024-0100"]],
    [["GOLD", "Guest"], []],
    [["9".repeat(MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS - 1)], []],
  ];
  it.each(SETS)("%j kept %j", (numbers, kept) => {
    const oneByOne: string[] = [];
    const held = [...numbers];
    for (let i = 0; i < 25; i++) {
      const next = nextMemberNumber(held, kept);
      if (next === null) break;
      oneByOne.push(next);
      held.push(next);
    }
    expect(nextMemberNumbers(numbers, kept, 25)).toEqual(oneByOne);
  });
});

describe("the import's own rule writes the numbers it settles", () => {
  const carries: CarriedFields = {
    fullName: true,
    email: true,
    phone: false,
    memberNumber: true,
    status: false,
    membershipType: false,
    joinedOn: false,
    endsOn: false,
    paymentStatus: false,
    dateOfBirth: false,
  };
  const who = (fullName: string, email: string, memberNumber: string | null) => ({ fullName, email, phone: null, memberNumber });
  const fileRow = (at: number, w: ReturnType<typeof who>): MemberListRow => ({
    row: at,
    review: [],
    ...w,
    status: null,
    membershipType: null,
    joinedOn: null,
    endsOn: null,
    paymentStatus: null,
    dateOfBirth: null,
    extra: [],
    identityKey: identityKey(w),
  });
  const entry = (id: string, w: ReturnType<typeof who>): ListEntry => ({
    id,
    identityKey: identityKey(w),
    review: { needsReview: [], reviewChecked: [] },
    ...w,
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
  });

  it("a different name on a number is a different person: added with it, the holder moved", () => {
    const asha = entry("0000000a-0000-4000-8000-000000000000", who("Asha Rao", "asha@x.example", "1"));
    const bina = entry("0000000b-0000-4000-8000-000000000000", who("Bina Das", "bina@x.example", "2"));
    const out = reconcile({
      rows: [fileRow(2, who("Ravi Kumar", "ravi@x.example", "1")), fileRow(3, who("Bina Das", "bina@x.example", null)), fileRow(4, who("Chitra Menon", "chitra@x.example", null))],
      entries: [asha, bina],
      members: [],
      keptFields: [],
      carries,
      endsOnKind: null,
      mode: "add",
      hasList: true,
      numbering: { kept: { "": "2" } },
    });
    expect(out.added.map((p) => [p.fullName, p.memberNumber])).toEqual([
      ["Ravi Kumar", "1"],
      ["Chitra Menon", "3"],
    ]);
    // The key an added record is written with carries the number it is given.
    expect(out.added[1]?.identityKey).toBe(identityKey(who("Chitra Menon", "chitra@x.example", "3")));
    expect(out.unchanged.map((p) => [p.fullName, p.memberNumber])).toEqual([["Bina Das", "2"]]);
    expect(out.numbers?.moved.map((m) => [m.fullName, m.from, m.to])).toEqual([["Asha Rao", "1", "4"]]);
  });

  it("without numbering, the rule numbers nobody (a read of the list)", () => {
    const out = reconcile({
      rows: [fileRow(2, who("Chitra Menon", "chitra@x.example", null))],
      entries: [],
      members: [],
      keptFields: [],
      carries,
      endsOnKind: null,
      mode: "add",
      hasList: true,
    });
    expect(out.numbers).toBeNull();
    expect(out.added[0]?.memberNumber).toBeNull();
  });
});
