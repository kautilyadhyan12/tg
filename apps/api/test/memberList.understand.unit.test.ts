// A whole file understood (spec Part 3 §9.5, §9.10): the rules of the two
// tables beside this one put together over real grids, in the order §9.5 sets —
// each cell, then placeholders, then whether a row can be used at all, then who
// it is, then duplicates. Written before review.
//
// Every person here is invented.
import { describe, expect, it } from "vitest";
import {
  MEMBER_LIST_MAX_DATA_ROWS,
  MEMBER_LIST_SKIPPED_SHOWN,
  type MemberFileGrid,
  type MemberFileWarning,
  type MemberListMapping,
  type MemberListUnderstanding,
  memberFileRefusalWords,
  memberListUnderstandResultSchema,
} from "@app/shared";
import { type UnderstandOptions, fingerprintOf, understandMemberGrid } from "../src/modules/orgs/memberList/understand.js";

const ch = (code: number): string => String.fromCodePoint(code);

interface SheetInput {
  name?: string | null;
  rows: string[][];
  truncated?: { rows: boolean; columns: boolean };
}

const gridOf = (sheets: SheetInput[], warnings: MemberFileWarning[] = []): MemberFileGrid => ({
  ok: true,
  kind: "csv",
  sheets: sheets.map((sheet) => ({ name: sheet.name ?? null, rows: sheet.rows, truncated: sheet.truncated ?? { rows: false, columns: false } })),
  facts: {},
  warnings,
});

const readGrid = (grid: MemberFileGrid, options: Partial<UnderstandOptions> = {}): MemberListUnderstanding => {
  const result = understandMemberGrid(grid, { country: "IN", ...options });
  // Everything that comes out crosses a wire to a screen, so it is checked
  // against the contract every time, not only in the one test that says so.
  expect(memberListUnderstandResultSchema.safeParse(result).success).toBe(true);
  if (!result.ok) throw new Error(`refused: ${result.refusal.code}`);
  return result;
};

const read = (rows: string[][], options: Partial<UnderstandOptions> = {}): MemberListUnderstanding => readGrid(gridOf([{ rows }]), options);

const refusalOf = (grid: MemberFileGrid, options: Partial<UnderstandOptions> = {}): string => {
  const result = understandMemberGrid(grid, { country: "IN", ...options });
  expect(memberListUnderstandResultSchema.safeParse(result).success).toBe(true);
  return result.ok ? "not refused" : result.refusal.code;
};

const PEOPLE = [
  ["Member No", "Full Name", "Email", "Mobile", "Status"],
  ["000123", "Ann Lee", "ann@example.com", "9876543210", "Active"],
  ["000124", "Bo Chen", "BO@Example.com", "09876543211", "Frozen"],
  ["000125", "Cara Diaz", "cara@example.com", "+91 98765 43212", "Active"],
];

describe("an ordinary export", () => {
  it("is read into the five things the list keeps", () => {
    const read5 = read(PEOPLE);
    const withoutKey = (row: MemberListUnderstanding["rows"][number]): Omit<MemberListUnderstanding["rows"][number], "identityKey"> => ({
      row: row.row,
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      memberNumber: row.memberNumber,
      status: row.status,
    });
    expect(read5.rows.map(withoutKey)).toEqual([
      { row: 2, fullName: "Ann Lee", email: "ann@example.com", phone: "+919876543210", memberNumber: "000123", status: "Active" },
      { row: 3, fullName: "Bo Chen", email: "bo@example.com", phone: "+919876543211", memberNumber: "000124", status: "Frozen" },
      { row: 4, fullName: "Cara Diaz", email: "cara@example.com", phone: "+919876543212", memberNumber: "000125", status: "Active" },
    ]);
    for (const row of read5.rows) expect(row.identityKey).toMatch(/^[0-9a-f]{64}$/);
    expect(read5.counts).toEqual({ dataRows: 3, kept: 3, noContact: 0, duplicates: 0, withEmail: 3, withPhone: 3, withMemberNumber: 3, withStatus: 3 });
    expect(read5.needsMapping).toBe(false);
    expect(read5.warnings).toEqual([]);
    expect(read5.skipped).toEqual([]);
  });

  it("counts the gym's own status words, the most used first", () => {
    expect(read(PEOPLE).statuses).toEqual([
      { label: "Active", count: 2 },
      { label: "Frozen", count: 1 },
    ]);
  });

  it("groups one word written two ways under the way it was written first", () => {
    const rows = [["Email", "Status"], ["a@example.com", "Active"], ["b@example.com", "ACTIVE"], ["c@example.com", "active"]];
    expect(read(rows).statuses).toEqual([{ label: "Active", count: 3 }]);
  });

  it("says which column it read and how sure it is", () => {
    const columns = read(PEOPLE).columns;
    expect(columns.map((column) => column.guess)).toEqual(["memberNumber", "fullName", "email", "phone", "status"]);
    expect(columns.every((column) => column.confidence === "header")).toBe(true);
    expect(columns[2]?.samples).toEqual(["ann@example.com", "BO@Example.com", "cara@example.com"]);
  });

  it("keeps the spreadsheet's own row numbers under a title block", () => {
    const rows = [["Jorhat Fitness — members"], [], ["Full Name", "Email"], ["Ann Lee", "ann@example.com"]];
    const found = read(rows);
    expect(found.headerRow).toBe(2);
    expect(found.rows[0]?.row).toBe(4);
    expect(found.counts.dataRows).toBe(1);
  });

  it("counts only the rows that hold something", () => {
    const rows = [["Full Name", "Email"], ["Ann Lee", "ann@example.com"], [], ["Bo Chen", "bo@example.com"]];
    expect(read(rows).counts.dataRows).toBe(2);
  });
});

describe("a row that cannot be used", () => {
  it("is skipped where it has neither an email nor a phone, with its row number and the reason", () => {
    const rows = [["Full Name", "Email", "Mobile"], ["Ann Lee", "ann@example.com", ""], ["Bo Chen", "", ""], ["Totals", "", ""]];
    const found = read(rows);
    expect(found.counts).toMatchObject({ dataRows: 3, kept: 1, noContact: 2 });
    expect(found.skipped).toEqual([
      { row: 3, reason: "no_contact" },
      { row: 4, reason: "no_contact" },
    ]);
  });

  it("is kept where the email is unreadable but a phone is there", () => {
    const rows = [
      ["Full Name", "Email", "Mobile"],
      ["Ann Lee", "not given", "9876543210"],
      ["Bo Chen", "b@example.com", "9876543211"],
      ["Cara Diaz", "c@example.com", "9876543212"],
    ];
    const found = read(rows);
    expect(found.counts).toMatchObject({ kept: 3, withEmail: 2, withPhone: 3 });
    expect(found.rows[0]?.email).toBe(null);
  });

  it("is counted but not listed past the two hundredth", () => {
    const rows: string[][] = [["Full Name", "Email"]];
    for (let i = 0; i < 250; i++) rows.push([`Person ${String(i)}`, ""]);
    for (let i = 0; i < 5; i++) rows.push([`Member ${String(i)}`, `m${String(i)}@example.com`]);
    const found = read(rows);
    expect(found.counts).toMatchObject({ kept: 5, noContact: 250 });
    expect(found.skipped).toHaveLength(MEMBER_LIST_SKIPPED_SHOWN);
  });
});

describe("the same person twice", () => {
  it("keeps the first and counts the rest", () => {
    const rows = [["Full Name", "Email"], ["Ann Lee", "ann@example.com"], ["Ann Lee", "ANN@example.com"], ["Bo Chen", "bo@example.com"]];
    const found = read(rows);
    expect(found.counts).toMatchObject({ kept: 2, duplicates: 1 });
    expect(found.skipped).toEqual([{ row: 3, reason: "duplicate" }]);
  });

  it("is not two people because their status changed", () => {
    const first = read([["Full Name", "Email", "Status"], ["Ann Lee", "ann@example.com", "Active"]]);
    const later = read([["Full Name", "Email", "Status"], ["Ann Lee", "ann@example.com", "Expired"]]);
    expect(first.rows[0]?.identityKey).toBe(later.rows[0]?.identityKey);
    expect(first.rows[0]?.status).toBe("Active");
    expect(later.rows[0]?.status).toBe("Expired");
  });

  it("is two people where a family shares one address", () => {
    const rows = [["Full Name", "Email"], ["Ann Lee", "family@example.com"], ["Bo Lee", "family@example.com"]];
    const found = read(rows);
    expect(found.counts.kept).toBe(2);
    expect(found.warnings).toContainEqual({ code: "shared_emails", rows: 2 });
  });
});

describe("the front desk's own details", () => {
  const withFrontDesk = (howMany: number): string[][] => {
    const rows: string[][] = [["Full Name", "Email", "Mobile"]];
    for (let i = 0; i < howMany; i++) rows.push([`Person ${String(i)}`, "frontdesk@example.com", "9876543210"]);
    rows.push(["Ann Lee", "ann@example.com", "9876543211"]);
    return rows;
  };

  it("are dropped from every row once they are on more than five", () => {
    const found = read(withFrontDesk(6));
    expect(found.counts).toMatchObject({ dataRows: 7, kept: 1, noContact: 6 });
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0]?.email).toBe("ann@example.com");
    expect(found.warnings).toContainEqual({ code: "placeholders", rows: 6, values: ["frontdesk@example.com", "+919876543210"] });
  });

  it("are somebody's own details at five", () => {
    const found = read(withFrontDesk(5));
    // Five people sharing an address are five people, and only the first of
    // five identical rows is kept: they differ by name here, so all are.
    expect(found.counts.kept).toBe(6);
    expect(found.warnings.some((warning) => warning.code === "placeholders")).toBe(false);
  });

  it("do not stop a row that has something else of its own", () => {
    const rows: string[][] = [["Full Name", "Email", "Mobile"]];
    for (let i = 0; i < 6; i++) rows.push([`Person ${String(i)}`, "frontdesk@example.com", `98765432${String(10 + i)}`]);
    const found = read(rows);
    expect(found.counts).toMatchObject({ kept: 6, withEmail: 0, withPhone: 6 });
  });
});

describe("what the file says about itself", () => {
  it("passes on what opening it noticed", () => {
    const found = readGrid(gridOf([{ rows: PEOPLE }], ["hidden_rows_or_columns", "encoding_guessed"]));
    expect(found.warnings).toContainEqual({ code: "hidden_rows_or_columns" });
    expect(found.warnings).toContainEqual({ code: "encoding_guessed" });
  });

  it("says when there was no row of headings", () => {
    const rows = [["Ann Lee", "ann@example.com"], ["Bo Chen", "bo@example.com"], ["Cara Diaz", "cara@example.com"]];
    const found = read(rows);
    expect(found.headerRow).toBe(null);
    expect(found.headerFingerprint).toBe(null);
    expect(found.warnings).toContainEqual({ code: "no_header_row" });
  });

  it("counts the numbers a spreadsheet shortened", () => {
    const rows = [
      ["Full Name", "Email", "Mobile"],
      ["Ann Lee", "ann@example.com", "9.19877E+11"],
      ["Bo Chen", "bo@example.com", "9876543211"],
      ["Cara Diaz", "cara@example.com", "9876543212"],
      ["Dev Rao", "dev@example.com", "9876543213"],
    ];
    expect(read(rows).warnings).toContainEqual({ code: "shortened_by_excel", rows: 1 });
  });

  it("counts the numbers it could not read for want of a country", () => {
    const rows = [
      ["Full Name", "Email", "Mobile"],
      ["Ann Lee", "ann@example.com", "9876543210"],
      ["Bo Chen", "bo@example.com", "+14155552671"],
      ["Cara Diaz", "cara@example.com", "+14155552672"],
      ["Dev Rao", "dev@example.com", "+14155552673"],
    ];
    const found = read(rows, { country: null });
    expect(found.warnings).toContainEqual({ code: "phones_need_country", rows: 1 });
    expect(found.counts.withPhone).toBe(3);
  });

  it("counts the numbers that are not the shape their country hands out", () => {
    const rows = [["Full Name", "Email", "Mobile"], ["Ann Lee", "ann@example.com", "00000000000"], ["Bo Chen", "bo@example.com", "9876543211"]];
    expect(read(rows).warnings).toContainEqual({ code: "phones_unusual", rows: 1 });
  });

  it("counts the names an export turned into question marks", () => {
    const rows = [["Full Name", "Email"], ["?ukasz Nowak", "lukasz@example.com"], ["Ann Lee", "ann@example.com"]];
    expect(read(rows).warnings).toContainEqual({ code: "question_marks_in_names", rows: 1 });
  });

  it("counts the names read in the wrong alphabet, and leaves a real name alone", () => {
    const rows = [
      ["Full Name", "Email"],
      [`H${ch(0x201a)}l${ch(0x160)}ne Dupont`, "helene@example.com"],
      [`${ch(0x160)}imun Bak${ch(0x161)}`, "simun@example.com"],
      ["Ann Lee", "ann@example.com"],
    ];
    expect(read(rows).warnings).toContainEqual({ code: "garbled_names", rows: 1 });
  });

  it("names the sheets it did not read", () => {
    const found = readGrid(
      gridOf([
        { name: "Instructions", rows: [["How to use this export"], ["Ask the front desk"]] },
        { name: "Members", rows: PEOPLE },
        { name: "Classes", rows: [["Class", "Time"], ["Yoga", "07:00"]] },
      ]),
    );
    expect(found.sheet).toEqual({ index: 1, name: "Members" });
    expect(found.warnings).toContainEqual({ code: "other_sheets_ignored", sheets: ["Instructions", "Classes"] });
    expect(found.counts.kept).toBe(3);
  });

  it("names a sheet with no name of its own by its place in the workbook, not by its place in what is left", () => {
    const found = readGrid(
      gridOf([
        { name: null, rows: [["How to use this export"]] },
        { name: null, rows: PEOPLE },
        { name: null, rows: [["Class", "Time"], ["Yoga", "07:00"]] },
      ]),
    );
    expect(found.sheet.index).toBe(1);
    expect(found.warnings).toContainEqual({ code: "other_sheets_ignored", sheets: ["Sheet 1", "Sheet 3"] });
  });
});

describe("a file nothing can be read from", () => {
  it("asks staff which column is which rather than refusing", () => {
    const rows = [["Full Name", "Joined"], ["Ann Lee", "2024-01-05"], ["Bo Chen", "2024-02-01"]];
    const found = read(rows);
    expect(found.needsMapping).toBe(true);
    expect(found.rows).toEqual([]);
    expect(found.counts).toMatchObject({ dataRows: 2, kept: 0 });
    expect(found.columns.map((column) => column.header)).toEqual(["Full Name", "Joined"]);
    expect(found.columns[1]?.samples).toEqual(["2024-01-05", "2024-02-01"]);
  });

  it.each([
    ["a sheet cut across", { rows: PEOPLE, truncated: { rows: false, columns: true } }, "too_many_columns"],
    ["a sheet cut short", { rows: PEOPLE, truncated: { rows: true, columns: false } }, "too_many_rows"],
    ["headings and nothing else", { rows: [["Full Name", "Email"]] }, "no_rows"],
    ["nothing at all", { rows: [] }, "no_rows"],
  ])("%s is refused", (_label, sheet: SheetInput, code) => {
    expect(refusalOf(gridOf([sheet]))).toBe(code);
  });

  it("refuses a file holding more people than one list may", () => {
    const rows: string[][] = [["Full Name", "Email"]];
    for (let i = 0; i <= MEMBER_LIST_MAX_DATA_ROWS; i++) rows.push([`Person ${String(i)}`, `p${String(i)}@example.com`]);
    expect(refusalOf(gridOf([{ rows }]))).toBe("too_many_rows");
  });

  it("says something true of a sheet cut short by its BLANK rows, which hold far fewer people", () => {
    // Review of PR #86: a list of 5,011 people with a blank row after each one
    // runs past the sheet's cut, and was told it "holds more than 10,000
    // people". The words a gym is shown have to be true of its own file (§9.9).
    const rows: string[][] = [["Full Name", "Email"]];
    for (let i = 0; i < 5011; i++) {
      rows.push([`Person ${String(i)}`, `p${String(i)}@example.com`]);
      rows.push([]);
    }
    const cut: SheetInput = { rows, truncated: { rows: true, columns: false } };
    expect(refusalOf(gridOf([cut]))).toBe("too_many_rows");
    const words = memberFileRefusalWords({ code: "too_many_rows" });
    expect(words).not.toMatch(/holds more than/i);
    expect(words).toMatch(/blank rows/i);
  });

  it("takes a file of exactly as many people as one list may", () => {
    const rows: string[][] = [["Full Name", "Email"]];
    for (let i = 0; i < MEMBER_LIST_MAX_DATA_ROWS; i++) rows.push([`Person ${String(i)}`, `p${String(i)}@example.com`]);
    expect(read(rows).counts.kept).toBe(MEMBER_LIST_MAX_DATA_ROWS);
  });
});

describe("the status column", () => {
  const withWords = (howMany: number): string[][] => {
    const rows: string[][] = [["Email", "Status"]];
    for (let i = 0; i < howMany; i++) rows.push([`p${String(i)}@example.com`, `Word ${String(i)}`]);
    return rows;
  };

  it("is not guessed where it holds more different words than a status has", () => {
    const found = read(withWords(21));
    expect(found.mapping.status).toBe(null);
    expect(found.counts.withStatus).toBe(0);
  });

  it("is guessed at twenty", () => {
    expect(read(withWords(20)).mapping.status).toBe(1);
  });

  it("refuses a hand mapping of a column that is not one, and says why", () => {
    const mapping: MemberListMapping = { sheet: null, headerRow: 0, fullName: null, firstName: null, lastName: null, email: [0], phone: [], memberNumber: null, status: 1 };
    const result = understandMemberGrid(gridOf([{ rows: withWords(21) }]), { country: "IN", mapping });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal).toEqual({ code: "mapped_column_not_status", column: 1 });
  });

  it("reads a column of yes and no under its own heading", () => {
    const rows = [["Email", "Active"], ["a@example.com", "Yes"], ["b@example.com", "No"], ["c@example.com", "TRUE"]];
    expect(read(rows).rows.map((row) => row.status)).toEqual(["Active", "Not active", "Active"]);
  });

  it("drops the is from a heading such as Is Active", () => {
    const rows = [["Email", "Is Active"], ["a@example.com", "Yes"], ["b@example.com", "No"]];
    expect(read(rows).rows.map((row) => row.status)).toEqual(["Active", "Not active"]);
  });

  it("leaves yes and no as written under a heading that says status", () => {
    const rows = [["Email", "Status"], ["a@example.com", "Yes"], ["b@example.com", "No"]];
    expect(read(rows).rows.map((row) => row.status)).toEqual(["Yes", "No"]);
  });

  it("is never a payment's", () => {
    const rows = [["Email", "Payment Status"], ["a@example.com", "Paid"], ["b@example.com", "Overdue"]];
    expect(read(rows).mapping.status).toBe(null);
  });
});

describe("staff's own mapping", () => {
  const rows = [["A", "B", "C", "D"], ["Ann Lee", "ann@example.com", "9876543210", "Active"]];
  const mapping: MemberListMapping = { sheet: null, headerRow: 0, fullName: 0, firstName: null, lastName: null, email: [1], phone: [2], memberNumber: null, status: 3 };

  it("is used as sent, with nothing guessed", () => {
    const found = read(rows, { mapping });
    expect(found.mapping).toEqual(mapping);
    expect(found.rows[0]).toMatchObject({ fullName: "Ann Lee", email: "ann@example.com", phone: "+919876543210", status: "Active" });
    expect(found.columns[1]?.confidence).toBe("chosen");
  });

  it("reads a file with no headings at all when staff say so", () => {
    const noHeadings = [["Ann Lee", "ann@example.com", "9876543210", "Active"]];
    const found = read(noHeadings, { mapping: { ...mapping, headerRow: null } });
    expect(found.headerRow).toBe(null);
    expect(found.counts.kept).toBe(1);
    expect(found.rows[0]?.row).toBe(1);
  });

  it("drops a column that is not in the file rather than obeying it", () => {
    const found = read(rows, { mapping: { ...mapping, memberNumber: 40 } });
    expect(found.mapping.memberNumber).toBe(null);
    expect(found.counts.kept).toBe(1);
  });

  it("asks again where what staff sent holds no email and no phone", () => {
    const found = read(rows, { mapping: { ...mapping, email: [], phone: [] } });
    expect(found.needsMapping).toBe(true);
  });
});

describe("the mapping this gym used last time", () => {
  const rows = [["A", "B"], ["Ann Lee", "ann@example.com"]];
  const remembered: MemberListMapping = { sheet: null, headerRow: 0, fullName: 0, firstName: null, lastName: null, email: [1], phone: [], memberNumber: null, status: null };

  it("is used again where the headings are the same, and says so", () => {
    // Headings nothing here knows: no column would be guessed at all, which is
    // why this gym mapped them by hand and why remembering them matters.
    const fingerprint = fingerprintOf(rows, 0);
    expect(read(rows).needsMapping).toBe(true);
    if (fingerprint === null) throw new Error("the headings have no fingerprint");
    const found = read(rows, { remembered: { fingerprint, mapping: remembered } });
    expect(found.mapping.email).toEqual([1]);
    expect(found.mapping.fullName).toBe(0);
    expect(found.columns[1]?.confidence).toBe("remembered");
    expect(found.rows[0]).toMatchObject({ fullName: "Ann Lee", email: "ann@example.com" });
  });

  it("is not used where the headings have changed", () => {
    const found = read(rows, { remembered: { fingerprint: "0".repeat(64), mapping: remembered } });
    expect(found.mapping.fullName).toBe(null);
    expect(found.needsMapping).toBe(true);
  });

  it("is the same fingerprint for the same headings written differently", () => {
    const one = fingerprintOf([["E-Mail", "Full Name"], ["a@example.com", "Ann Lee"]], 0);
    const two = fingerprintOf([["e-mail ", "FULL NAME"], ["b@example.com", "Bo Chen"]], 0);
    expect(one).toBe(two);
  });

  it("is a different fingerprint for different headings", () => {
    const one = read([["Email", "Full Name"], ["a@example.com", "Ann Lee"]]).headerFingerprint;
    const two = read([["Email", "Mobile"], ["a@example.com", "9876543210"]]).headerFingerprint;
    expect(one).not.toBe(two);
  });
});

describe("whose email would be invited", () => {
  // The worst thing this card can get wrong: an address read from the wrong
  // column is an invitation to somebody who is not a member, and the gym's
  // invitation is its yes (§9.2 rule 11) — that person joins the gym.
  const withNominee = [
    ["Nominee Email", "Email", "Full Name"],
    ["nominee1@example.com", "member1@example.com", "Ann Lee"],
    ["nominee2@example.com", "", "Bo Chen"],
    ["nominee3@example.com", "member3@example.com", "Cara Diaz"],
  ];

  it("never the nominee's, even where the member's own column is empty", () => {
    const found = read(withNominee);
    expect(found.mapping.email).toEqual([1]);
    expect(found.rows.map((row) => row.email)).toEqual(["member1@example.com", "member3@example.com"]);
    // Bo Chen has nothing of his own in the file, so he is reported as having
    // no contact details — never invited at the address beside his name.
    expect(found.counts).toMatchObject({ dataRows: 3, kept: 2, noContact: 1 });
    expect(found.skipped).toEqual([{ row: 3, reason: "no_contact" }]);
    expect(found.columns[0]).toMatchObject({ header: "Nominee Email", headerSays: "email", guess: null });
  });

  it("nobody's, where the only email column in the file is somebody else's", () => {
    const rows = [
      ["Father's Name", "Nominee Email", "Full Name"],
      ["Raj Sharma", "nominee1@example.com", "Ann Lee"],
      ["Bob Chen", "nominee2@example.com", "Bo Chen"],
    ];
    const found = read(rows);
    // Nothing of the member's is readable, so staff are asked rather than
    // three strangers being invited into the gym.
    expect(found.needsMapping).toBe(true);
    expect(found.rows).toEqual([]);
  });

  it("the member's own, where staff say that is what the column is", () => {
    const mapping: MemberListMapping = { sheet: null, headerRow: 0, fullName: 2, firstName: null, lastName: null, email: [0], phone: [], memberNumber: null, status: null };
    const found = read(withNominee, { mapping });
    expect(found.rows.map((row) => row.email)).toEqual(["nominee1@example.com", "nominee2@example.com", "nominee3@example.com"]);
  });
});

describe("a column the server disbelieved", () => {
  it("says what its heading claimed, so a screen can tell staff why it was not used", () => {
    const rows = [["Email", "Mobile"], ["N/A", "9876543210"], ["N/A", "9876543211"], ["cara@example.com", "9876543212"]];
    const found = read(rows);
    expect(found.columns[0]).toMatchObject({ header: "Email", headerSays: "email", guess: null, confidence: null });
    expect(found.counts.withEmail).toBe(0);
  });

  it("says the same of a heading that names somebody who is not the member", () => {
    const rows = [["Email", "Emergency Contact Phone"], ["ann@example.com", "9876543210"], ["bo@example.com", "9876543211"]];
    expect(read(rows).columns[1]).toMatchObject({ headerSays: "phone", guess: null });
  });

  it("claims nothing for a column whose heading names no field at all", () => {
    expect(read(PEOPLE).columns[3]).toMatchObject({ header: "Mobile", headerSays: "phone", guess: "phone" });
    const joined = read([["Full Name", "Email", "Joined"], ["Ann Lee", "ann@example.com", "2024-01-05"], ["Bo Chen", "bo@example.com", "2024-02-01"]]);
    expect(joined.columns[2]).toMatchObject({ header: "Joined", headerSays: null, guess: null });
  });
});

describe("a row whose first column is empty", () => {
  it("falls back to the next email column, in order", () => {
    const rows = [
      ["Email", "Secondary Email", "Full Name"],
      ["", "spare@example.com", "Ann Lee"],
      ["main@example.com", "spare2@example.com", "Bo Chen"],
      ["not an address", "third@example.com", "Cara Diaz"],
      ["dev@example.com", "spare4@example.com", "Dev Rao"],
      ["eve@example.com", "spare5@example.com", "Eve Roy"],
    ];
    expect(read(rows).rows.map((row) => row.email)).toEqual(["spare@example.com", "main@example.com", "third@example.com", "dev@example.com", "eve@example.com"]);
  });

  it("falls back to the next phone column, in order", () => {
    const rows = [
      ["Mobile", "Home Phone", "Email"],
      ["", "9876543210", "a@example.com"],
      ["9876543211", "9876543212", "b@example.com"],
    ];
    expect(read(rows).rows.map((row) => row.phone)).toEqual(["+919876543210", "+919876543211"]);
  });

  it("keeps the row, its email and the whole file when one cell holds a number no list could hold", () => {
    const rows = [
      ["Full Name", "Email", "Mobile"],
      ["Ann Lee", "ann@example.com", "030 123456789012"],
      ["Bo Chen", "bo@example.com", "030 12345678"],
      ["Cara Diaz", "cara@example.com", "030 12345679"],
    ];
    const found = read(rows, { country: "DE" });
    expect(found.counts).toMatchObject({ kept: 3, withEmail: 3, withPhone: 2 });
    expect(found.rows[0]).toMatchObject({ fullName: "Ann Lee", email: "ann@example.com", phone: null });
  });
});
