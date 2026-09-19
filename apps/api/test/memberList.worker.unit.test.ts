// The worker's wiring (spec Part 3 §9.4, §9.10): the real worker thread is
// spawned for each kind of file, under its real time limit, heap cap and
// two-at-once rule. Inside vitest the worker loads through tsx, not vite, so
// nothing in it is mocked; what it computes is tested in-process by the other
// memberList files, and here only that it is the thing answering.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { MEMBER_LIST_MAX_DATA_ROWS } from "@app/shared";
import { openMemberFileContents } from "../src/modules/orgs/memberList/openFile.js";
import { memberFilesOpen, parseMemberFile } from "../src/modules/orgs/memberList/parseMemberFile.js";
import { buildZip, sharedStringBombParts, sharedStringsWorkbookParts, sheetXml, workbookParts } from "./memberList.zipKit.js";

const EXCEL = new URL("./fixtures/member-list/excel/", import.meta.url);
const read = (name: string): Buffer => fs.readFileSync(new URL(name, EXCEL));

/** A worker's first start transpiles its modules through tsx: about 750 ms
 *  measured, more on a loaded machine. */
const WORKER_TEST_MS = 60_000;

/** The biggest list a gym may upload: 10,000 people and a header, 30 columns. */
function fullSizeRows(): string[][] {
  const header = Array.from({ length: 30 }, (_, c) => `Column ${String(c + 1)}`);
  header.splice(0, 5, "Member No", "Full Name", "Email", "Mobile", "Status");
  const rows = [header];
  for (let i = 0; i < MEMBER_LIST_MAX_DATA_ROWS; i++) {
    const n = String(i).padStart(5, "0");
    const row = [`M${n}`, `Member ${n} Álvarez`, `member${n}@example.com`, `+1 415 555 ${n.slice(1)}`, i % 3 === 0 ? "Expired" : "Active"];
    for (let c = 5; c < 30; c++) row.push(`note ${String(c)} for ${n}`);
    rows.push(row);
  }
  return rows;
}

describe("the worker", () => {
  it(
    "answers an Excel workbook and a CSV exactly as the code it runs answers in-process",
    async () => {
      for (const [file, kind] of [["book.xlsx", "zip"], ["csv-utf8.csv", "text"]] as const) {
        const bytes = read(file);
        expect(await parseMemberFile(bytes)).toEqual(await openMemberFileContents(kind, bytes));
      }
    },
    WORKER_TEST_MS,
  );

  it("refuses what the sniff refuses without starting a worker", async () => {
    const pending = parseMemberFile(read("book.xls"));
    expect(memberFilesOpen()).toBe(0);
    expect(await pending).toEqual({ ok: false, refusal: { code: "old_excel_or_password" } });
  });

  it(
    "counts a file as open from the moment its worker is asked for, and not after",
    async () => {
      const pending = parseMemberFile(read("csv-utf8.csv"));
      expect(memberFilesOpen()).toBe(1);
      await pending;
      expect(memberFilesOpen()).toBe(0);
    },
    WORKER_TEST_MS,
  );

  it(
    "stops a worker at the time limit, terminating it, and answers parse_timeout",
    async () => {
      // A worker that ends by itself exits 0; one terminated exits 1. At 50 ms
      // the worker has not even loaded its modules (about 750 ms), so only a
      // terminate can end it before it answers.
      let exited: (code: number) => void = () => undefined;
      const exit = new Promise<number>((resolve) => {
        exited = resolve;
      });
      expect(await parseMemberFile(read("book.xlsx"), { timeoutMs: 50, onWorkerExit: (code) => {
        exited(code);
      } })).toEqual({
        ok: false,
        refusal: { code: "parse_timeout" },
      });
      expect(await exit).toBe(1);
      expect(memberFilesOpen()).toBe(0);
      // The next file is read as usual.
      expect((await parseMemberFile(read("csv-utf8.csv"))).ok).toBe(true);
    },
    WORKER_TEST_MS,
  );

  it(
    "reads two files at once and answers a third busy",
    async () => {
      const first = parseMemberFile(read("book.xlsx"));
      const second = parseMemberFile(read("csv-utf8.csv"));
      expect(await parseMemberFile(read("csv-comma.csv"))).toEqual({ ok: false, refusal: { code: "busy" } });
      expect((await first).ok).toBe(true);
      expect((await second).ok).toBe(true);
      expect((await parseMemberFile(read("csv-comma.csv"))).ok).toBe(true);
    },
    WORKER_TEST_MS,
  );

  it(
    "answers too_complex when a file needs more memory than the worker may have, and the API goes on",
    async () => {
      const rows = fullSizeRows();
      const csv = Buffer.from(rows.map((r) => r.join(",")).join("\r\n"), "utf-8");
      expect(await parseMemberFile(csv, { heapMb: 8 })).toEqual({ ok: false, refusal: { code: "too_complex" } });
      expect(memberFilesOpen()).toBe(0);
    },
    WORKER_TEST_MS,
  );

  it(
    "leaves the caller's bytes whole: the worker is handed a copy",
    async () => {
      const pooled = Buffer.from("Email\r\nann@example.com\r\n", "utf-8");
      const neighbour = Buffer.from("a neighbour in the same pool", "utf-8");
      const big = read("book.xlsx");
      const bigCopy = Buffer.from(big);
      expect((await parseMemberFile(pooled)).ok).toBe(true);
      expect((await parseMemberFile(big)).ok).toBe(true);
      expect(pooled.toString("utf-8")).toBe("Email\r\nann@example.com\r\n");
      expect(neighbour.toString("utf-8")).toBe("a neighbour in the same pool");
      expect(big.equals(bigCopy)).toBe(true);
    },
    WORKER_TEST_MS,
  );

  it(
    "refuses a workbook whose cells all point at one long string, before the grid reaches this thread",
    async () => {
      // Review of PR #85, C1: 300,000 cells on one 2,000-letter string took this
      // thread's heap from 12 MB past 1 GB. The budget stops it in the worker.
      const bomb = buildZip(sharedStringBombParts(3_000, 100, "अ".repeat(2_000)));
      expect(bomb.length).toBeLessThan(1024 * 1024);
      const heapBefore = process.memoryUsage().heapUsed;
      expect(await parseMemberFile(bomb)).toEqual({ ok: false, refusal: { code: "too_complex" } });
      expect(process.memoryUsage().heapUsed - heapBefore).toBeLessThan(100 * 1024 * 1024);
    },
    WORKER_TEST_MS,
  );

  it.each([
    ["one tag never closed", `<row r="1" ${"a".repeat(1024 * 1024)}`],
    ["a > inside quotes, then the tag runs on", `<row r="1"><c r="A1" t=">" ${"a ".repeat(512 * 1024)}`],
    ["one long tag that does close", `<row r="1" ${"a".repeat(1024 * 1024)}></row>`],
    ["rows with no > for the hidden-row check", "<row a ".repeat(150_000)],
  ])(
    "answers a sheet with %s well inside the time limit",
    async (_label, inside) => {
      const sheet = sheetXml([["Email"]]).replace("<sheetData>", `<sheetData>${inside}`);
      const t0 = performance.now();
      expect(await parseMemberFile(buildZip(workbookParts(sheet)))).toEqual({ ok: false, refusal: { code: "unsafe_archive" } });
      expect(performance.now() - t0).toBeLessThan(5_000);
    },
    WORKER_TEST_MS,
  );

  it(
    "reads the biggest list allowed, as CSV and as Excel, whole and inside the time limit",
    async () => {
      const rows = fullSizeRows();
      const csv = Buffer.from(rows.map((r) => r.join(",")).join("\r\n"), "utf-8");
      const xlsx = buildZip(sharedStringsWorkbookParts(rows));
      for (const bytes of [csv, xlsx]) {
        const result = await parseMemberFile(bytes);
        if (!result.ok) throw new Error(`refused: ${result.refusal.code}`);
        const sheet = result.sheets[0];
        if (sheet === undefined) throw new Error("no sheet");
        expect(sheet.truncated).toEqual({ rows: false, columns: false });
        expect(sheet.rows.length).toBe(MEMBER_LIST_MAX_DATA_ROWS + 1);
        expect(sheet.rows[MEMBER_LIST_MAX_DATA_ROWS]?.slice(0, 3)).toEqual(["M09999", "Member 09999 Álvarez", "member09999@example.com"]);
        expect(sheet.rows.every((row) => row.length === 30)).toBe(true);
      }
    },
    WORKER_TEST_MS,
  );
});
