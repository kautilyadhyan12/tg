// The real exports, understood (spec Part 3 §9.5, §9.10): the same files 3a-i
// opens — written by the Excel 16 on Kd's machine and by Google Sheets, every
// person invented — carried through to the rows a gym's list would hold.
//
// This is the wiring test for the whole card: the rules of the three tables
// beside it, run over files nobody here typed.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { type MemberFileGrid, memberFileResultSchema, memberListUnderstandResultSchema, type MemberListUnderstanding } from "@app/shared";
import { understandMemberFile } from "../src/modules/orgs/memberList/parseMemberFile.js";
import { openMemberFileContents } from "../src/modules/orgs/memberList/openFile.js";
import { sniffMemberFile } from "../src/modules/orgs/memberList/sniff.js";
import { understandMemberGrid } from "../src/modules/orgs/memberList/understand.js";

const FIXTURES = new URL("./fixtures/member-list/", import.meta.url);

/** The sniff, then the worker's own code in-process, then the understanding —
 *  the route's own path (3a-iii) with the worker taken out of it. */
async function understand(file: string, country: string | null = "IN"): Promise<MemberListUnderstanding> {
  const bytes = fs.readFileSync(new URL(file, FIXTURES));
  const sniffed = sniffMemberFile(bytes);
  if (sniffed.kind === "refused") throw new Error(`refused at the sniff: ${sniffed.refusal.code}`);
  const opened = memberFileResultSchema.parse(await openMemberFileContents(sniffed.kind, bytes));
  if (!opened.ok) throw new Error(`refused at opening: ${opened.refusal.code}`);
  const grid: MemberFileGrid = opened;
  const result = understandMemberGrid(grid, { country });
  expect(memberListUnderstandResultSchema.safeParse(result).success).toBe(true);
  if (!result.ok) throw new Error(`refused: ${result.refusal.code}`);
  return result;
}

const NAMES = ["José Álvarez", "Zoë Müller", "Łukasz Nowak", "अमित Sharma", 'Long Id, With "Quote"', "Hélène Dupont", "Ann Lee"];
const EMAILS = ["jose@example.com", "zoe.muller@example.com", "lukasz@example.com", "amit@example.com", "long@example.com", "helene@example.com", "ann.lee@example.com"];
const STATUSES = [
  { label: "Active", count: 4 },
  { label: "Expired", count: 1 },
  { label: "Frozen", count: 1 },
  { label: "Pending", count: 1 },
];

describe("the Excel workbook", () => {
  it("is read into seven people, on the sheet that holds them", async () => {
    const found = await understand("excel/book.xlsx");
    expect(found.sheet).toEqual({ index: 0, name: "Members" });
    expect(found.headerRow).toBe(0);
    expect(found.mapping).toMatchObject({ memberNumber: 0, fullName: 1, email: [2], phone: [3], status: 5 });
    expect(found.counts).toMatchObject({ dataRows: 7, kept: 7, noContact: 0, duplicates: 0, withEmail: 7, withPhone: 7, withMemberNumber: 7, withStatus: 7 });
    expect(found.rows.map((row) => row.fullName)).toEqual(NAMES);
    expect(found.rows.map((row) => row.email)).toEqual(EMAILS);
    expect(found.statuses).toEqual(STATUSES);
  });

  it("keeps a sixteen-digit member number exactly, and puts a name written on two lines on one", async () => {
    const found = await understand("excel/book.xlsx");
    expect(found.rows[4]?.memberNumber).toBe("1234567890123456");
    expect(found.rows[6]?.fullName).toBe("Ann Lee");
  });

  it("reads every number in the gym's country, and says the one column it left alone", async () => {
    const found = await understand("excel/book.xlsx");
    expect(found.rows.map((row) => row.phone)).toEqual([
      "+447911123456",
      "+917911123456",
      "+919876543210",
      "+919876543210",
      "+914155552671",
      "+33612345678",
      "+914155550100",
    ]);
    expect(found.warnings).toContainEqual({ code: "other_sheets_ignored", sheets: ["Staff"] });
    expect(found.warnings).toContainEqual({ code: "hidden_rows_or_columns" });
  });

  it("never reads the joining date as a phone number, nor the paid column as a status", async () => {
    const found = await understand("excel/book.xlsx");
    expect(found.columns[4]).toMatchObject({ header: "Joined", guess: null });
    expect(found.columns[6]).toMatchObject({ header: "Paid", guess: null });
  });
});

describe("every CSV kind Excel saves", () => {
  it("CSV UTF-8: the same seven people, with the two numbers Excel shortened said so", async () => {
    const found = await understand("excel/csv-utf8.csv");
    expect(found.counts).toMatchObject({ dataRows: 7, kept: 7, withEmail: 7, withPhone: 6, withMemberNumber: 6 });
    expect(found.rows.map((row) => row.fullName)).toEqual(NAMES);
    expect(found.statuses).toEqual(STATUSES);
    // Łukasz's 12-digit mobile and the 16-digit member number are gone from
    // the file itself: two rows, never guessed back.
    expect(found.warnings).toContainEqual({ code: "shortened_by_excel", rows: 2 });
    expect(found.rows[2]?.phone).toBe(null);
    expect(found.rows[4]?.memberNumber).toBe(null);
  });

  it("Unicode Text: tab separated, UTF-16, and the same seven people", async () => {
    const found = await understand("excel/unicode-text.txt");
    expect(found.counts.kept).toBe(7);
    expect(found.rows.map((row) => row.fullName)).toEqual(NAMES);
  });

  it("CSV (comma): the letters Excel could not write are question marks, and are counted", async () => {
    const found = await understand("excel/csv-comma.csv");
    expect(found.counts.kept).toBe(7);
    expect(found.rows[2]?.fullName).toBe("?ukasz Nowak");
    expect(found.warnings).toContainEqual({ code: "question_marks_in_names", rows: 2 });
    expect(found.warnings).toContainEqual({ code: "encoding_guessed" });
  });

  it("CSV (MS-DOS): names read in the wrong code page are counted as garbled", async () => {
    const found = await understand("excel/csv-msdos.csv");
    const garbled = found.warnings.find((warning) => warning.code === "garbled_names");
    expect(garbled).toBeDefined();
    if (garbled !== undefined && "rows" in garbled) expect(garbled.rows).toBeGreaterThanOrEqual(2);
  });
});

describe("Google Sheets, as Kd downloaded it", () => {
  it("the .xlsx: every number written in exponent form is read whole", async () => {
    const found = await understand("google/google-sheets.xlsx");
    expect(found.counts).toMatchObject({ kept: 7, withPhone: 7, withMemberNumber: 7 });
    expect(found.rows[2]?.phone).toBe("+919876543210");
    expect(found.rows[4]?.memberNumber).toBe("1234567890123456");
  });

  it("the CSV: the joining dates are not read as anybody's phone number", async () => {
    const found = await understand("google/google-sheets.csv");
    expect(found.mapping.phone).toEqual([3]);
    expect(found.columns[4]).toMatchObject({ header: "Joined", guess: null });
    expect(found.rows.map((row) => row.phone)).not.toContain(null);
  });

  it("the CSV: the member number Google shortened is said to be shortened", async () => {
    const found = await understand("google/google-sheets.csv");
    expect(found.rows[4]?.memberNumber).toBe(null);
    expect(found.warnings).toContainEqual({ code: "shortened_by_excel", rows: 1 });
  });
});

describe("through the real worker, which is how the route reads a file", () => {
  const job = { country: "IN", mapping: null, remembered: null };

  it("gives exactly what understanding it here gives, and never the file's cells", async () => {
    const bytes = fs.readFileSync(new URL("excel/book.xlsx", FIXTURES));
    const throughWorker = await understandMemberFile(bytes, job);
    expect(throughWorker).toEqual(await understand("excel/book.xlsx"));
    // What crosses back is the people, not the grid: 3a-i's cells stay in the
    // worker, and the request's own thread never holds them (§9.5).
    expect(throughWorker).not.toHaveProperty("sheets");
  });

  it("answers a refusal from opening the file as a refusal", async () => {
    const bytes = fs.readFileSync(new URL("excel/book.xls", FIXTURES));
    const result = await understandMemberFile(bytes, job);
    expect(result).toEqual({ ok: false, refusal: { code: "old_excel_or_password" } });
  });

  it("still stops at the time limit", async () => {
    const bytes = fs.readFileSync(new URL("excel/book.xlsx", FIXTURES));
    const result = await understandMemberFile(bytes, job, { timeoutMs: 1 });
    expect(result).toEqual({ ok: false, refusal: { code: "parse_timeout" } });
  });
});

describe("a gym with no country set", () => {
  it("reads only the numbers written with their own country code, and says so", async () => {
    const found = await understand("excel/book.xlsx", null);
    expect(found.rows.map((row) => row.phone)).toEqual(["+447911123456", null, null, null, null, "+33612345678", null]);
    expect(found.warnings).toContainEqual({ code: "phones_need_country", rows: 5 });
    expect(found.counts.kept).toBe(7);
  });
});
