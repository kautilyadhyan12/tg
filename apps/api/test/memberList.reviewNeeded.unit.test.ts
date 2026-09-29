// Review needed (ROADMAP 5b-v-d-iv; RULINGS 2026-09-29): what an import found wrong on a
// person stays on their record until staff fix it.
//
// The worst thing this could do is put one person's problem on somebody else: a repeat
// row's broken date on the first person, a row with no contact marking anybody, a
// family's shared email marking both. The first block reads the real exports Excel 16
// and Google Sheets wrote (the files 3a-i opens, every person invented) and names who
// is marked, and a hand-made file for the problems those exports do not have.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  memberFileResultSchema,
  memberListReviewKey,
  memberListUnderstandResultSchema,
  parseMemberListReviewKey,
  type MemberFileGrid,
  type MemberListReviewItem,
  type MemberListRow,
  type MemberListUnderstanding,
} from "@app/shared";
import { openMemberFileContents } from "../src/modules/orgs/memberList/openFile.js";
import type { CarriedFields, KeptField, ListEntry, ReconciledPerson } from "../src/modules/orgs/memberList/reconcile.js";
import {
  importReviews,
  reviewAfterChecked,
  reviewAfterEdit,
  reviewAfterImport,
  type ReviewState,
} from "../src/modules/orgs/memberList/review.js";
import { sniffMemberFile } from "../src/modules/orgs/memberList/sniff.js";
import { understandMemberGrid } from "../src/modules/orgs/memberList/understand.js";

const FIXTURES = new URL("./fixtures/member-list/", import.meta.url);

async function understandFile(file: string): Promise<MemberListUnderstanding> {
  const bytes = fs.readFileSync(new URL(file, FIXTURES));
  const sniffed = sniffMemberFile(bytes);
  if (sniffed.kind === "refused") throw new Error(`refused at the sniff: ${sniffed.refusal.code}`);
  const opened = memberFileResultSchema.parse(await openMemberFileContents(sniffed.kind, bytes));
  if (!opened.ok) throw new Error(`refused at opening: ${opened.refusal.code}`);
  return understood(understandMemberGrid(opened, { country: "IN" }));
}

function understood(result: ReturnType<typeof understandMemberGrid>): MemberListUnderstanding {
  expect(memberListUnderstandResultSchema.safeParse(result).success).toBe(true);
  if (!result.ok) throw new Error(`refused: ${result.refusal.code}`);
  return result;
}

const read = (rows: string[][], country: string | null = "IN"): MemberListUnderstanding => {
  const grid: MemberFileGrid = { ok: true, kind: "csv", sheets: [{ name: null, rows, truncated: { rows: false, columns: false } }], facts: {}, warnings: [] };
  return understood(understandMemberGrid(grid, { country }));
};

/** Each kept person by name, with what their record will be marked with. */
const marksOf = (found: MemberListUnderstanding): Record<string, string[]> =>
  Object.fromEntries(found.rows.map((row) => [row.fullName, row.review.map(memberListReviewKey)]));

/** Only the people marked. */
const marked = (found: MemberListUnderstanding): Record<string, string[]> =>
  Object.fromEntries(Object.entries(marksOf(found)).filter(([, keys]) => keys.length > 0));

describe("the worst thing: a problem lands only on the person whose own cells had it", () => {
  it("Excel's CSV UTF-8: Łukasz's cut mobile and the cut member number, and nobody else", async () => {
    expect(marked(await understandFile("excel/csv-utf8.csv"))).toEqual({
      "Łukasz Nowak": ["number_cut:phone"],
      'Long Id, With "Quote"': ["number_cut:memberNumber"],
    });
  });

  it("Excel's CSV (comma): the two names that lost letters, as well as the two cut numbers", async () => {
    expect(marked(await understandFile("excel/csv-comma.csv"))).toEqual({
      "?ukasz Nowak": ["letters_lost:fullName", "number_cut:phone"],
      "???? Sharma": ["letters_lost:fullName"],
      'Long Id, With "Quote"': ["number_cut:memberNumber"],
    });
  });

  it("Excel's CSV (MS-DOS): exactly the three names read in another alphabet have broken letters", async () => {
    const found = await understandFile("excel/csv-msdos.csv");
    const garbled = found.rows.filter((row) => row.review.some((item) => item.problem === "letters_garbled")).map((row) => row.row);
    expect(garbled).toEqual([2, 3, 7]);
  });

  it("Google Sheets' CSV: only the member number Google cut; the .xlsx and Excel's own workbook mark nobody", async () => {
    expect(marked(await understandFile("google/google-sheets.csv"))).toEqual({ 'Long Id, With "Quote"': ["number_cut:memberNumber"] });
    expect(marked(await understandFile("google/google-sheets.xlsx"))).toEqual({});
    expect(marked(await understandFile("excel/book.xlsx"))).toEqual({});
  });

  // Every counted warning 5b-v-d-iii lists, each on its own person, and the two that
  // mark nobody: a family's shared email and a card number, which is not the person's.
  const people: string[][] = [
    ["Name", "Email", "Mobile", "Joined", "Notes"],
    ["Ann Lee", "ann@example.com", "9876543210", "2024-01-05", "Prefers mornings"],
    ["?ukasz Nowak", "lukasz@example.com", "9876543211", "2024-01-06", ""],
    [`H${String.fromCodePoint(0x201a)}l${String.fromCodePoint(0x160)}ne Dupont`, "helene@example.com", "9876543212", "2024-01-07", ""],
    ["Cy Shah", "cy@example.com", "9.19877E+11", "2024-01-08", ""],
    ["Di Park", "di@example.com", "00000000000", "2024-01-09", ""],
    ["Ed Moss", "ed@example.com", "9876543215", "sometime in March", ""],
    ["Flo Kerr", "flo@example.com", "9876543216", "2024-01-11", "n".repeat(700)],
    ["Gus Tan", "family@example.com", "9876543217", "2024-01-12", ""],
    ["Hana Tan", "FAMILY@example.com", "9876543218", "2024-01-13", ""],
    ["Ivy Cole", "", "", "not a date", "walk-in"],
    ["Jon Bell", "jon@example.com", "9876543220", "2024-01-15", "card 4242 4242 4242 4242 on file"],
    // Ann again, her row repeated with a date nobody can read: the repeat is skipped, and
    // what it had wrong is nobody's.
    ["Ann Lee", "ann@example.com", "9876543210", "next spring", "Prefers mornings"],
  ];

  it("each counted warning marks its own person; a repeat row, a row with no contact, a shared email and a card mark nobody", () => {
    const found = read(people);
    expect(marksOf(found)).toEqual({
      "Ann Lee": [],
      "?ukasz Nowak": ["letters_lost:fullName"],
      [`H${String.fromCodePoint(0x201a)}l${String.fromCodePoint(0x160)}ne Dupont`]: ["letters_garbled:fullName"],
      "Cy Shah": ["number_cut:phone"],
      "Di Park": ["phone_unusual:phone"],
      "Ed Moss": ["not_a_date:joinedOn"],
      "Flo Kerr": ["cell_cut:extra:notes"],
      "Gus Tan": [],
      "Hana Tan": [],
      "Jon Bell": [],
    });
    // The warnings still say what they said: this job adds marks, it takes no warning away.
    expect(found.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["shared_emails", "card_cells_dropped", "dates_not_read"]));
  });

  it("a phone left out for want of a country marks that person, and a number it could read marks nobody", () => {
    const found = read(
      [
        ["Name", "Email", "Phone"],
        ["Ann Lee", "ann@example.com", "+44 7911 123456"],
        ["Bo Chen", "bo@example.com", "07911 123457"],
      ],
      null,
    );
    expect(marksOf(found)).toEqual({ "Ann Lee": [], "Bo Chen": ["no_country:phone"] });
  });

  it("the front desk's own email marks each person whose own email it stood in for, by the email alone", () => {
    const rows: string[][] = [["Name", "Email", "Mobile"]];
    for (let i = 0; i < 6; i++) rows.push([`Desk ${String(i)}`, "desk@gym.example", `987654320${String(i)}`]);
    rows.push(["Ann Lee", "ann@example.com", "9876543210"]);
    const found = read(rows);
    expect(marksOf(found)["Desk 0"]).toEqual(["front_desk:email"]);
    expect(found.rows.filter((row) => row.review.length > 0)).toHaveLength(6);
    expect(marksOf(found)["Ann Lee"]).toEqual([]);
  });

  it("a date column other than Joined is named by its own field", () => {
    const found = read([
      ["Name", "Email", "Date of birth", "Renewal date"],
      ["Ann Lee", "ann@example.com", "1990-12-31", "a while"],
      ["Bo Chen", "bo@example.com", "who knows", "2026-10-01"],
      ["Cy Shah", "cy@example.com", "1985-03-04", "2026-10-02"],
      ["Di Park", "di@example.com", "1979-07-08", "2026-10-03"],
      ["Ed Moss", "ed@example.com", "2001-11-12", "2026-10-04"],
    ]);
    expect(marked(found)).toEqual({ "Ann Lee": ["not_a_date:endsOn"], "Bo Chen": ["not_a_date:dateOfBirth"] });
  });
});

// ── The rule, case by case ──────────────────────────────────────────────────

const item = (problem: MemberListReviewItem["problem"], field: string): MemberListReviewItem => {
  const parsed = parseMemberListReviewKey(`${problem}:${field}`);
  if (parsed === null) throw new Error(`not an item: ${problem}:${field}`);
  return parsed;
};
const state = (needsReview: string[], reviewChecked: string[] = []): ReviewState => ({ needsReview, reviewChecked });
const PHONE_ODD = "phone_unusual:phone";
const DATE_BAD = "not_a_date:joinedOn";
const NAME_LOST = "letters_lost:fullName";
const NAME_GARBLED = "letters_garbled:fullName";

interface Case {
  name: string;
  now: ReviewState | null;
  found: MemberListReviewItem[];
  carried: string[];
  moved: string[];
  want: ReviewState;
}

const ALL = ["fullName", "email", "phone", "memberNumber", "joinedOn"];

const CASES: Case[] = [
  { name: "a new person with a problem is marked", now: null, found: [item("phone_unusual", "phone")], carried: ALL, moved: [], want: state([PHONE_ODD]) },
  { name: "a new person with none is not", now: null, found: [], carried: ALL, moved: [], want: state([]) },
  { name: "a problem on a field the import does not write marks nobody", now: null, found: [item("not_a_date", "joinedOn")], carried: ["fullName", "email"], moved: [], want: state([]) },
  { name: "someone imported before marks existed, same value, is marked now", now: state([]), found: [item("phone_unusual", "phone")], carried: ALL, moved: [], want: state([PHONE_ODD]) },
  { name: "a later file with a good value clears the mark", now: state([PHONE_ODD]), found: [], carried: ALL, moved: ["phone"], want: state([]) },
  { name: "a later file with the same good value clears it too", now: state([PHONE_ODD]), found: [], carried: ALL, moved: [], want: state([]) },
  { name: "a file without that column leaves the mark where it is", now: state([DATE_BAD]), found: [], carried: ["fullName", "email", "phone"], moved: [], want: state([DATE_BAD]) },
  { name: "the same problem again is still one mark", now: state([PHONE_ODD]), found: [item("phone_unusual", "phone")], carried: ALL, moved: [], want: state([PHONE_ODD]) },
  { name: "It's correct holds while the value stays the same", now: state([], [PHONE_ODD]), found: [item("phone_unusual", "phone")], carried: ALL, moved: [], want: state([], [PHONE_ODD]) },
  { name: "a changed value with the same problem is marked again, and the check goes", now: state([], [PHONE_ODD]), found: [item("phone_unusual", "phone")], carried: ALL, moved: ["phone"], want: state([PHONE_ODD]) },
  { name: "a changed value with no problem clears the check", now: state([], [PHONE_ODD]), found: [], carried: ALL, moved: ["phone"], want: state([]) },
  { name: "a check on a column the file leaves out stays", now: state([], [DATE_BAD]), found: [], carried: ["fullName", "email"], moved: ["email"], want: state([], [DATE_BAD]) },
  {
    name: "two problems on one field, one checked: the other is still marked",
    now: state([NAME_GARBLED], [NAME_LOST]),
    found: [item("letters_lost", "fullName"), item("letters_garbled", "fullName")],
    carried: ALL,
    moved: [],
    want: state([NAME_GARBLED], [NAME_LOST]),
  },
  {
    name: "a change to one field leaves another field's mark alone",
    now: state([DATE_BAD, PHONE_ODD]),
    found: [item("not_a_date", "joinedOn")],
    carried: ["fullName", "email", "joinedOn"],
    moved: ["email"],
    want: state([DATE_BAD, PHONE_ODD]),
  },
];

describe("after an import", () => {
  it.each(CASES)("$name", ({ now, found, carried, moved, want }) => {
    const got = reviewAfterImport(now, { found, carried: new Set(carried), moved: new Set(moved) });
    // The order of a record's items means nothing.
    expect({ needsReview: [...got.needsReview].sort(), reviewChecked: [...got.reviewChecked].sort() }).toEqual({
      needsReview: [...want.needsReview].sort(),
      reviewChecked: [...want.reviewChecked].sort(),
    });
  });
});

describe("after staff change a field by hand", () => {
  it("that field's problems and checks go, and every other field's stay", () => {
    const now = state([PHONE_ODD, DATE_BAD, NAME_LOST], [NAME_GARBLED]);
    expect(reviewAfterEdit(now, ["phone"])).toEqual(state([DATE_BAD, NAME_LOST], [NAME_GARBLED]));
    expect(reviewAfterEdit(now, ["fullName"])).toEqual(state([PHONE_ODD, DATE_BAD]));
    expect(reviewAfterEdit(now, ["email", "status"])).toEqual(now);
  });

  it("one of the gym's own columns is its own field, never another of them", () => {
    const now = state(["cell_cut:extra:notes", "cell_cut:extra:notes_2"]);
    expect(reviewAfterEdit(now, ["extra:notes"])).toEqual(state(["cell_cut:extra:notes_2"]));
  });
});

describe("It's correct", () => {
  it("moves the one item to checked; twice is once; an item already gone changes nothing", () => {
    const now = state([PHONE_ODD, DATE_BAD]);
    const once = reviewAfterChecked(now, item("phone_unusual", "phone"));
    expect(once).toEqual(state([DATE_BAD], [PHONE_ODD]));
    expect(reviewAfterChecked(once, item("phone_unusual", "phone"))).toEqual(once);
    expect(reviewAfterChecked(once, item("letters_lost", "fullName"))).toEqual(once);
  });

  it("checking one problem of a field leaves the field's other problem marked", () => {
    expect(reviewAfterChecked(state([NAME_LOST, NAME_GARBLED]), item("letters_lost", "fullName"))).toEqual(state([NAME_GARBLED], [NAME_LOST]));
  });
});

// ── The import's list of records to write ───────────────────────────────────

const CARRIES: CarriedFields = {
  fullName: true,
  email: true,
  phone: true,
  memberNumber: false,
  status: false,
  membershipType: false,
  joinedOn: true,
  endsOn: false,
  paymentStatus: false,
  dateOfBirth: false,
};

const rowOf = (row: number, fullName: string, review: MemberListReviewItem[]): MemberListRow => ({
  row,
  fullName,
  email: `${fullName.toLowerCase().replace(/ /g, ".")}@example.com`,
  phone: null,
  memberNumber: null,
  status: null,
  membershipType: null,
  joinedOn: null,
  endsOn: null,
  paymentStatus: null,
  dateOfBirth: null,
  extra: [],
  identityKey: "0".repeat(64),
  review,
});

const personAt = (at: number, row: MemberListRow, entryId: string | null, moved: string[] = []): ReconciledPerson => ({
  identityKey: `key-${row.fullName}`,
  entryId,
  entryKey: entryId === null ? null : `key-${row.fullName}`,
  at,
  row: row.row,
  fullName: row.fullName,
  email: row.email,
  phone: null,
  memberNumber: null,
  status: null,
  wasStatus: null,
  inApp: false,
  moved,
});

const entryOf = (id: string, review: ReviewState): ListEntry => ({
  id,
  identityKey: `key-${id}`,
  fullName: id,
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
  extra: {},
  handEdited: [],
  review,
  former: false,
});

describe("the import's records to write", () => {
  it("names each record by its own key, turns the file's column into the gym's, and leaves out the unchanged", () => {
    const rows = [
      rowOf(2, "Ann Lee", [item("cell_cut", "extra:locker_notes")]),
      rowOf(3, "Bo Chen", [item("cell_cut", "extra:coach")]),
      rowOf(4, "Cy Shah", []),
      rowOf(5, "Di Park", [item("not_a_date", "joinedOn")]),
    ];
    // The file's second column is the gym's `notes`; its first, `coach`, is not kept (the
    // gym's columns are full), so what it had wrong marks nobody.
    const fileFields = [
      { key: "coach", label: "Coach", column: 5 },
      { key: "locker_notes", label: "Locker notes", column: 6 },
    ];
    const kept: KeptField[] = [{ key: "notes", label: "Locker notes", at: 1 }];
    const out = importReviews({
      rows,
      added: [personAt(0, rows[0] ?? rowOf(0, "", []), null), personAt(1, rows[1] ?? rowOf(0, "", []), null)],
      held: [personAt(2, rows[2] ?? rowOf(0, "", []), "cy", []), personAt(3, rows[3] ?? rowOf(0, "", []), "di", [])],
      entries: [entryOf("cy", state([])), entryOf("di", state([], [DATE_BAD]))],
      fileFields,
      kept,
      carries: CARRIES,
    });
    // Ann: marked on the gym's column. Bo: nothing kept, nothing written. Cy: nothing to
    // change. Di: checked, same value: left as it is.
    expect(out).toEqual([{ identityKey: "key-Ann Lee", review: state(["cell_cut:extra:notes"]) }]);
  });

  it("a record the list was not read with is a fault, never a guess", () => {
    const row = rowOf(2, "Ann Lee", []);
    expect(() =>
      importReviews({ rows: [row], added: [], held: [personAt(0, row, "missing")], entries: [], fileFields: [], kept: [], carries: CARRIES }),
    ).toThrow(/not read with the list/);
  });
});
