// Real files, made by the Excel 16 on Kd's machine by COM automation
// (`tools/make-member-list-fixtures.ps1`; every person invented), opened as the
// server opens them (spec Part 3 §9.10). Each grid is pinned cell for cell:
// what Excel wrote is what the member list reads, digits and letters included.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { memberFileResultSchema, type MemberFileResult } from "@app/shared";
import { openMemberFileContents } from "../src/modules/orgs/memberList/openFile.js";
import { sniffMemberFile } from "../src/modules/orgs/memberList/sniff.js";
import { cellText } from "../src/modules/orgs/memberList/xlsx.adapter.js";

const EXCEL = new URL("./fixtures/member-list/excel/", import.meta.url);
const read = (name: string): Buffer => fs.readFileSync(new URL(name, EXCEL));

/** What the server makes of a file: the sniff, then the worker's own code, in-process. */
async function open(name: string): Promise<MemberFileResult> {
  const bytes = read(name);
  const sniffed = sniffMemberFile(bytes);
  if (sniffed.kind === "refused") return { ok: false, refusal: sniffed.refusal };
  return memberFileResultSchema.parse(await openMemberFileContents(sniffed.kind, bytes));
}

const HEADER = ["Member No", "Full Name", "Email", "Mobile", "Joined", "Status", "Paid"];

/** The sheet as the .xlsx keeps it: every number exact, every letter kept. */
const WORKBOOK_ROWS = [
  HEADER,
  ["000123", "José Álvarez", "jose@example.com", "+44 7911 123456", "2024-01-05", "Active", "TRUE"],
  ["000124", "Zoë Müller", "ZOE.MULLER@Example.com ", "07911 123456", "2024-02-01", "Frozen", "FALSE"],
  ["000125", "Łukasz Nowak", "lukasz@example.com", "919876543210", "2024-03-01", "Active", ""],
  ["000126", "अमित Sharma", "amit@example.com", "9876543210", "2024-03-02", "Expired", ""],
  ["1234567890123456", 'Long Id, With "Quote"', "long@example.com", "4155552671", "2024-03-03", "Active", ""],
  ["000127", "Hélène Dupont", "helene@example.com", "+33 6 12 34 56 78", "2024-03-04", "Pending", ""],
  ["000128", "Ann\r\nLee", "ann.lee@example.com", "(415) 555-0100", "2024-03-05", "Active", ""],
];

/** The same sheet as every CSV kind writes it: Excel shortens the 12- and
 *  16-digit numbers from a General cell before the file exists, and a cell's
 *  line break is a bare LF. */
const csvRows = (lukasz: string, amit: string): string[][] =>
  WORKBOOK_ROWS.map((row, i) => {
    if (i === 3) return [row[0] ?? "", lukasz, row[2] ?? "", "9.19877E+11", ...row.slice(4)];
    if (i === 4) return [row[0] ?? "", amit, ...row.slice(2)];
    if (i === 5) return ["1.23457E+15", ...row.slice(1)];
    if (i === 7) return [row[0] ?? "", "Ann\nLee", ...row.slice(2)];
    return row;
  });

const sheet = (name: string | null, rows: string[][]): unknown => ({ name, rows, truncated: { rows: false, columns: false } });

describe("Excel workbooks", () => {
  it.each([["book.xlsx"], ["book-strict.xlsx"]])("%s: every sheet, numbers exact, the hidden row read and warned of", async (file) => {
    expect(await open(file)).toEqual({
      ok: true,
      kind: "xlsx",
      sheets: [sheet("Members", WORKBOOK_ROWS), sheet("Staff", [["Coach"], ["Sam Coach"]])],
      facts: {},
      warnings: ["hidden_rows_or_columns"],
    });
  });
});

describe("every CSV kind Excel saves", () => {
  it.each([
    ["csv-utf8.csv", "utf-8", ",", "Łukasz Nowak", "अमित Sharma", []],
    ["unicode-text.txt", "utf-16le", "\t", "Łukasz Nowak", "अमित Sharma", []],
    // Excel wrote "?" for every letter outside the code page: gone before we see it.
    ["csv-comma.csv", "windows-1252", ",", "?ukasz Nowak", "???? Sharma", ["encoding_guessed"]],
    ["csv-mac.csv", "macintosh", ",", "?ukasz Nowak", "???? Sharma", ["encoding_guessed"]],
  ])("%s → %s", async (file, encoding, delimiter, lukasz, amit, warnings) => {
    expect(await open(file)).toEqual({
      ok: true,
      kind: "csv",
      sheets: [sheet(null, csvRows(lukasz, amit))],
      facts: { encoding, delimiter },
      warnings,
    });
  });

  it("csv-msdos.csv: the OEM code page cannot be told from 1252, so its accents read wrong (3a-ii warns)", async () => {
    const result = await open("csv-msdos.csv");
    if (!result.ok) throw new Error("refused");
    expect(result.facts).toEqual({ encoding: "windows-1252", delimiter: "," });
    const names = result.sheets[0]?.rows.map((row) => row[1]);
    // é is 82 in code page 850 and ‚ in 1252; ë is 89 and ‰; ü is 81, which
    // 1252 leaves undefined (a control character).
    expect(names?.slice(1, 3)).toEqual(["Jos‚ ?lvarez", "Zo‰ M\u0081ller"]);
  });
});

describe("files the list refuses, with the words that say the fix", () => {
  it.each([
    ["book.xls", { code: "old_excel_or_password" }],
    ["book-password.xlsx", { code: "old_excel_or_password" }],
    ["book.ods", { code: "other_zip", archive: "opendocument" }],
    ["book.xlsb", { code: "other_zip", archive: "excel_binary" }],
    ["web-page.xls", { code: "web_page_or_xml" }],
    ["single-file-web-page.xls", { code: "web_page_or_xml" }],
    ["xml-spreadsheet-2003.xls", { code: "web_page_or_xml" }],
  ])("%s", async (file, refusal) => {
    expect(await open(file)).toEqual({ ok: false, refusal });
  });
});

describe("a cell as text", () => {
  it.each([
    ["text, untrimmed", " Ann ", " Ann "],
    ["a number kept as Excel wrote it", "919876543210", "919876543210"],
    ["TRUE", true, "TRUE"],
    ["FALSE", false, "FALSE"],
    ["a date", new Date(Date.UTC(2024, 0, 5)), "2024-01-05"],
    ["a date read as UTC at midnight", new Date("2024-03-01T00:00:00.000Z"), "2024-03-01"],
    ["an impossible date", new Date(Number.NaN), ""],
    ["an empty cell", null, ""],
    ["a number the package parsed after all", 12.5, "12.5"],
    ["anything else", { x: 1 }, ""],
  ])("%s", (_label, value, text) => {
    expect(cellText(value)).toBe(text);
  });
});
