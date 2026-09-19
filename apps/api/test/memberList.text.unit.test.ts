// The text side of opening a member file (spec Part 3 §9.4, §9.10): the
// decoding ladder, the delimiter rule, the CSV reader and the grid's limits,
// each as a table over every class of case, written before review.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEMBER_FILE_MAX_CELL_CHARS,
  MEMBER_FILE_MAX_COLUMNS,
  MEMBER_FILE_MAX_GRID_CELLS,
  MEMBER_FILE_MAX_GRID_CHARS,
  MEMBER_FILE_MAX_SHEET_ROWS,
  memberFileResultSchema,
} from "@app/shared";
import { detectDelimiter, readCsvRecords, readSepLine } from "../src/modules/orgs/memberList/csv.js";
import { assertMemberFileDecoders, decodeMemberText, decodeWindows1252, looksLikeMacLineEnds } from "../src/modules/orgs/memberList/decodeText.js";
import { GridBudget, GridBuilder, cutCell } from "../src/modules/orgs/memberList/grid.js";
import { openTextFile } from "../src/modules/orgs/memberList/openFile.js";

const bytes = (...parts: Array<string | number[]>): Buffer =>
  Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))));
const utf16 = (text: string, big = false): Buffer => {
  const le = Buffer.from(text, "utf16le");
  return big ? le.swap16() : le;
};

describe("the decoding ladder", () => {
  it.each([
    ["a UTF-8 mark", bytes([0xef, 0xbb, 0xbf]), Buffer.from("Zoë,x", "utf-8"), "utf-8", false, "Zoë,x"],
    ["a UTF-16LE mark", bytes([0xff, 0xfe]), utf16("Zoë\tx"), "utf-16le", false, "Zoë\tx"],
    ["a UTF-16BE mark", bytes([0xfe, 0xff]), utf16("Zoë\tx", true), "utf-16be", false, "Zoë\tx"],
    ["UTF-8 with no mark", Buffer.alloc(0), Buffer.from("Łukasz,अमित", "utf-8"), "utf-8", false, "Łukasz,अमित"],
    ["plain ASCII", Buffer.alloc(0), Buffer.from("a,b\r\n", "utf-8"), "utf-8", false, "a,b\r\n"],
    ["windows-1252 (é is E9, the euro 80)", Buffer.alloc(0), bytes("Jos", [0xe9], " ", [0x80], "\r\n"), "windows-1252", true, "José €\r\n"],
    ["Mac Roman with bare CRs (é is 8E)", Buffer.alloc(0), bytes("a\rJos", [0x8e], "\rb\r"), "macintosh", true, "a\rJosé\rb\r"],
    ["Excel's Mac file: bare CRs and a final CRLF", Buffer.alloc(0), bytes("a\rJos", [0x8e], "\rb\r\n"), "macintosh", true, "a\rJosé\rb\r\n"],
    ["one bare CR and one CRLF: Mac (at least as many)", Buffer.alloc(0), bytes("h\rJos", [0x8e], "\r\n"), "macintosh", true, "h\rJosé\r\n"],
    ["CRLF only: windows-1252", Buffer.alloc(0), bytes("h\r\nJos", [0xe9], "\r\n"), "windows-1252", true, "h\r\nJosé\r\n"],
    ["more LF than bare CR: windows-1252", Buffer.alloc(0), bytes("h\nb\nc\rJos", [0xe9]), "windows-1252", true, "h\nb\nc\rJosé"],
  ])("%s", (_label, mark, body, encoding, guessed, text) => {
    expect(decodeMemberText(Buffer.concat([mark, body]))).toEqual({ ok: true, text, encoding, guessed });
  });

  it.each([
    ["a NUL in UTF-8 text", Buffer.from("a,b\u0000c", "utf-8")],
    ["UTF-16 with no mark", utf16("Email\r\nann@example.com")],
    ["a UTF-32LE mark", bytes([0xff, 0xfe, 0x00, 0x00], [0x61, 0, 0, 0])],
    ["a UTF-8 mark over bytes that are not UTF-8", bytes([0xef, 0xbb, 0xbf], "Jos", [0xe9])],
    ["a UTF-16LE mark over an odd number of bytes", bytes([0xff, 0xfe], [0x61, 0x00, 0x62])],
    ["a picture", bytes([0x89], "PNG\r\n", [0x1a, 0x0a, 0, 0, 0, 0x0d], "IHDR")],
  ])("refuses %s as unreadable text", (_label, input) => {
    expect(decodeMemberText(input)).toEqual({ ok: false, refusal: { code: "unreadable_text" } });
  });

  it("reads windows-1252's 0x80–0x9F as letters and signs, not as Node's control characters", () => {
    // Python's cp1252 over bytes 0x80..0x9F, the five holes as WHATWG keeps them.
    const cp1252 =
      "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f" +
      "\u0090‘’“”•–—˜™š›œ\u009džŸ";
    expect(decodeWindows1252(Uint8Array.from({ length: 32 }, (_, i) => 0x80 + i))).toBe(cp1252);
    expect(decodeWindows1252(Uint8Array.from({ length: 128 }, (_, i) => i))).toBe(
      String.fromCharCode(...Array.from({ length: 128 }, (_, i) => i)),
    );
    expect(decodeWindows1252(Uint8Array.from({ length: 96 }, (_, i) => 0xa0 + i))).toBe(
      String.fromCharCode(...Array.from({ length: 96 }, (_, i) => 0xa0 + i)),
    );
    expect(decodeMemberText(bytes([0x8a], "imun ", [0x8e], "agar,", [0x93], "Coach", [0x94], "\r\n"))).toEqual({
      ok: true,
      text: "Šimun Žagar,“Coach”\r\n",
      encoding: "windows-1252",
      guessed: true,
    });
  });

  it("counts line ends on the bytes", () => {
    expect(looksLikeMacLineEnds(bytes("a\rb\rc\r\n"))).toBe(true);
    expect(looksLikeMacLineEnds(bytes("a\r\nb\r\n"))).toBe(false);
    expect(looksLikeMacLineEnds(bytes("a,b"))).toBe(false);
  });
});

describe("the decoders the API needs at boot", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("are all in this Node build", () => {
    expect(() => {
      assertMemberFileDecoders();
    }).not.toThrow();
  });

  it("stop the boot when one is missing, naming it", () => {
    const Real = TextDecoder;
    vi.stubGlobal(
      "TextDecoder",
      class extends Real {
        constructor(label?: string) {
          if (label === "macintosh") throw new RangeError("not supported");
          super(label);
        }
      },
    );
    expect(() => {
      assertMemberFileDecoders();
    }).toThrow(/macintosh/);
  });
});

describe("a sep= line", () => {
  it.each([
    ["sep=;\r\nName;Email", { delimiter: ";", rest: "Name;Email" }],
    ["sep=\t\nName", { delimiter: "\t", rest: "Name" }],
    ["sep=|\rName", { delimiter: "|", rest: "Name" }],
    ["SEP=,\r\nx", { delimiter: ",", rest: "x" }],
    ["sep=,", { delimiter: ",", rest: "" }],
    ['sep="\r\nx', null],
    ["sep=;;\r\nx", null],
    ["sep=\r\nx", null],
    [" sep=;\r\nx", null],
    ["Name,sep=;", null],
  ])("%j", (text, expected) => {
    expect(readSepLine(text)).toEqual(expected);
  });
});

describe("the delimiter rule", () => {
  it.each([
    ["commas", "Name,Email,Phone\r\nAnn,a@example.com,1\r\nBo,b@example.com,2\r\n", ","],
    ["semicolons, with commas inside the names", "Name;Email\r\nSmith, John;j@example.com\r\nLee, Ann;a@example.com\r\n", ";"],
    ["semicolons with decimal commas", "Name;Paid;Email\r\nAnn;12,50;a@example.com\r\nBo;7,25;b@example.com\r\n", ";"],
    ["tabs", "Name\tEmail\r\nAnn\ta@example.com\r\n", "\t"],
    ["bars", "Name|Email\nAnn|a@example.com\n", "|"],
    ["one column of emails", "a@example.com\r\nb@example.com\r\n", ","],
    ["a title block above the header", "Gold's Gym members\r\n\r\nName,Email\r\nAnn,a@example.com\r\nBo,b@example.com\r\n", ","],
    ["quoted commas in a semicolon file", 'Name;Email\r\n"Smith, John";j@example.com\r\n"Lee, Ann";a@example.com\r\n', ";"],
    ["a quoted semicolon in a comma file", 'Name,Note\r\nAnn,"a;b;c"\r\nBo,"d;e"\r\n', ","],
    ["commas and tabs equally steady: most fields wins", "a,b,c\td\r\ne,f,g\th\r\n", ","],
    ["an equal tie: the order , ; TAB |", "a,b;c\r\nd,e;f\r\n", ","],
    ["Excel's blank rows written as commas", "Name,Email\r\n,\r\n,\r\nAnn,a@example.com\r\n", ","],
    ["commas on rows of different widths: the steady one-field candidates are not delimiters", "a,b,c\r\nd,e\r\nf,g,h\r\n", ","],
    ["empty text", "", ","],
    ["only empty lines", "\r\n\r\n", ","],
  ])("%s", (_label, text, delimiter) => {
    expect(detectDelimiter(text)).toBe(delimiter);
  });

  it("keeps only candidates averaging MORE than 1.99 fields", () => {
    // Semicolons average exactly 1.9 over these ten records: dropped, so the
    // one-column default wins.
    const text = `${Array.from({ length: 9 }, () => "a;b").join("\r\n")}\r\nc\r\n`;
    expect(detectDelimiter(text)).toBe(",");
    expect(detectDelimiter(`${Array.from({ length: 10 }, () => "a;b").join("\r\n")}\r\n`)).toBe(";");
  });

  it("reads only the first ten records that are not empty lines", () => {
    const head = Array.from({ length: 10 }, () => "a;b").join("\r\n");
    expect(detectDelimiter(`${head}\r\n${Array.from({ length: 50 }, () => "c,d,e,f").join("\r\n")}`)).toBe(";");
  });
});

function records(text: string, delimiter = ",", keep = MEMBER_FILE_MAX_COLUMNS): { rows: unknown[]; read: unknown } {
  const rows: unknown[] = [];
  const read = readCsvRecords(text, delimiter, keep, (fields, fieldCount, writtenPastKept) => {
    rows.push(writtenPastKept || fieldCount !== fields.length ? { fields, fieldCount, writtenPastKept } : fields);
    return true;
  });
  return { rows, read };
}

describe("the CSV reader", () => {
  it.each([
    ["CRLF", "a,b\r\nc,d\r\n", [["a", "b"], ["c", "d"]]],
    ["LF", "a,b\nc,d\n", [["a", "b"], ["c", "d"]]],
    ["bare CR", "a,b\rc,d\r", [["a", "b"], ["c", "d"]]],
    ["no line end at the end", "a,b\r\nc,d", [["a", "b"], ["c", "d"]]],
    ["an empty line in the middle", "a\r\n\r\nb", [["a"], [""], ["b"]]],
    ["empty fields", ",a,,b,", [["", "a", "", "b", ""]]],
    ["a quoted field", '"a,b",c', [["a,b", "c"]]],
    ["a doubled quote", '"say ""hi""",x', [['say "hi"', "x"]]],
    ["an empty quoted field", '"",x', [["", "x"]]],
    ["a quoted CRLF kept as typed", '"Ann\r\nLee",x\r\ny', [["Ann\r\nLee", "x"], ["y"]]],
    ["a quoted LF (Excel's Alt+Enter)", '"Ann\nLee",x', [["Ann\nLee", "x"]]],
    ["text after the closing quote kept", '"abc"def,x', [["abcdef", "x"]]],
    ["a space after the closing quote kept", '"abc" ,x', [["abc ", "x"]]],
    ["a quote inside an unquoted field is a letter", 'ab"c,x', [['ab"c', "x"]]],
    ["a quote after a space does not open a field", ' "a,b"', [[' "a', 'b"']]],
    ["a delimiter at the very end", "a,", [["a", ""]]],
    ["spaces kept", " a , b ", [[" a ", " b "]]],
    ["semicolons", "a;b,c", [["a", "b,c"]], ";"],
    ["tabs", "a\tb", [["a", "b"]], "\t"],
  ])("%s", (_label, text, expected, delimiter = ",") => {
    expect(records(text, delimiter)).toEqual({ rows: expected, read: { ok: true } });
  });

  it.each([
    ["on the first row", '"abc', 1],
    ["on the third row, counting an empty line", 'a\r\n\r\n"b,c\r\nd', 3],
    ["after a doubled quote", 'a\r\n"b""', 2],
    ["opened after a field", 'a,"b', 1],
  ])("refuses a quote left open %s", (_label, text, row) => {
    expect(records(text).read).toEqual({ ok: false, unterminatedAtRow: row });
  });

  it("keeps the first fields only, and says whether a later one was written", () => {
    expect(records("a,b,c,d", ",", 2).rows).toEqual([{ fields: ["a", "b"], fieldCount: 4, writtenPastKept: true }]);
    expect(records("a,b,, ,\t", ",", 2).rows).toEqual([{ fields: ["a", "b"], fieldCount: 5, writtenPastKept: false }]);
  });

  it("stops when the sink says so", () => {
    const seen: string[][] = [];
    const read = readCsvRecords("a\nb\nc\n", ",", 10, (fields) => {
      seen.push(fields);
      return seen.length < 2;
    });
    expect(read).toEqual({ ok: true });
    expect(seen).toEqual([["a"], ["b"]]);
  });
});

describe("the grid's limits", () => {
  const grid = (rows: string[][], writtenPastCut: boolean[] = []): ReturnType<GridBuilder["finish"]> => {
    const g = new GridBuilder("Sheet", new GridBudget());
    rows.forEach((row, i) => g.addRow(row, writtenPastCut[i] ?? false));
    return g.finish();
  };
  const plain = { rows: false, columns: false };

  it.each([
    ["pads every row to the widest written one", [["a"], ["b", "c", ""]], [["a", ""], ["b", "c"]], plain],
    ["keeps blank rows inside the sheet", [["a"], [""], ["  "], ["b"]], [["a"], [""], [""], ["b"]], plain],
    ["drops blank rows after the last written one", [["a"], [""], [" ", "\t"], []], [["a"]], plain],
    ["drops blank rows before nothing at all", [[""], []], [], plain],
    ["drops trailing blank cells", [["a", "", " "], ["b"]], [["a"], ["b"]], plain],
    ["keeps white space inside a written cell", [[" a "]], [[" a "]], plain],
  ])("%s", (_label, rows, expected, truncated) => {
    expect(grid(rows)).toEqual({ name: "Sheet", rows: expected, truncated });
  });

  it("cuts at the last column and says so only when something was written past it", () => {
    const wide = (last: string): string[] => [...Array<string>(MEMBER_FILE_MAX_COLUMNS).fill("x"), last];
    expect(grid([wide("")]).truncated).toEqual(plain);
    expect(grid([wide(" ")]).truncated).toEqual(plain);
    const cut = grid([wide("y")]);
    expect(cut.truncated).toEqual({ rows: false, columns: true });
    expect(cut.rows[0]?.length).toBe(MEMBER_FILE_MAX_COLUMNS);
  });

  it("counts a row written only past the cut as a written row", () => {
    const row = [...Array<string>(MEMBER_FILE_MAX_COLUMNS).fill(""), "far"];
    expect(grid([["a"], row, ["b"]])).toEqual({ name: "Sheet", rows: [["a"], [""], ["b"]], truncated: { rows: false, columns: true } });
    expect(grid([["a"], [], ["b"]], [false, true])).toEqual({ name: "Sheet", rows: [["a"], [""], ["b"]], truncated: { rows: false, columns: true } });
  });

  it("keeps exactly the last row and cuts one written row more", () => {
    const full = (): GridBuilder => {
      const g = new GridBuilder(null, new GridBudget());
      for (let i = 0; i < MEMBER_FILE_MAX_SHEET_ROWS; i++) expect(g.addRow([`r${String(i)}`])).toBe(true);
      return g;
    };
    expect(full().finish().truncated).toEqual(plain);
    const g = full();
    expect(g.addRow([""])).toBe(true);
    expect(g.addRow(["one more"])).toBe(false);
    expect(g.addRow(["and another"])).toBe(false);
    const sheet = g.finish();
    expect(sheet.rows.length).toBe(MEMBER_FILE_MAX_SHEET_ROWS);
    expect(sheet.truncated).toEqual({ rows: true, columns: false });
  });

  it("counts blank rows inside the sheet towards the cut, but not blank rows after it", () => {
    const blanks = (): GridBuilder => {
      const g = new GridBuilder(null, new GridBudget());
      g.addRow(["a"]);
      for (let i = 0; i < MEMBER_FILE_MAX_SHEET_ROWS; i++) g.addRow([""]);
      return g;
    };
    expect(blanks().finish()).toEqual({ name: null, rows: [["a"]], truncated: plain });
    const g = blanks();
    expect(g.addRow(["b"])).toBe(false);
    expect(g.finish().truncated.rows).toBe(true);
  });

  it("keeps nothing more once the sheet is finished", () => {
    const g = new GridBuilder(null, new GridBudget());
    g.addRow(["a"]);
    g.finish();
    expect(g.addRow(["b"])).toBe(false);
    expect(g.finish().rows).toEqual([["a"]]);
  });

  it("cuts a cell at its limit, never inside a character", () => {
    expect(cutCell("x".repeat(MEMBER_FILE_MAX_CELL_CHARS + 5))).toBe("x".repeat(MEMBER_FILE_MAX_CELL_CHARS));
    expect(cutCell("x".repeat(MEMBER_FILE_MAX_CELL_CHARS))).toBe("x".repeat(MEMBER_FILE_MAX_CELL_CHARS));
    const emojiAtTheEdge = `${"x".repeat(MEMBER_FILE_MAX_CELL_CHARS - 1)}😀tail`;
    expect(cutCell(emojiAtTheEdge)).toBe("x".repeat(MEMBER_FILE_MAX_CELL_CHARS - 1));
    const long = grid([["y".repeat(MEMBER_FILE_MAX_CELL_CHARS * 2)]]);
    expect(long.rows[0]?.[0]?.length).toBe(MEMBER_FILE_MAX_CELL_CHARS);
  });
});

describe("a text file, opened", () => {
  it("answers its grid, the delimiter and how it was read", () => {
    const result = openTextFile(bytes("sep=;\r\nName;Email\r\nJos", [0xe9], ";j@example.com\r\n"));
    expect(memberFileResultSchema.parse(result)).toEqual({
      ok: true,
      kind: "csv",
      sheets: [{ name: null, rows: [["Name", "Email"], ["José", "j@example.com"]], truncated: { rows: false, columns: false } }],
      facts: { encoding: "windows-1252", delimiter: ";" },
      warnings: ["encoding_guessed"],
    });
  });

  it("names the row of a quote left open, counting from the first row after sep=", () => {
    expect(openTextFile(Buffer.from('sep=,\r\nName\r\nAnn\r\n"Bo', "utf-8"))).toEqual({
      ok: false,
      refusal: { code: "unterminated_quote", row: 3 },
    });
  });

  it("refuses text it cannot read", () => {
    expect(openTextFile(Buffer.from("a\u0000b"))).toEqual({ ok: false, refusal: { code: "unreadable_text" } });
  });

  it("reads 5 MiB of empty lines into no rows at all, and 5 MiB of commas into no columns", () => {
    const lines = openTextFile(Buffer.alloc(5 * 1024 * 1024, 0x0a));
    expect(lines.ok && lines.sheets[0]).toEqual({ name: null, rows: [], truncated: { rows: false, columns: false } });
    const commas = openTextFile(Buffer.alloc(5 * 1024 * 1024, 0x2c));
    expect(commas.ok && commas.sheets[0]).toEqual({ name: null, rows: [], truncated: { rows: false, columns: false } });
  });

  it("stops reading at the row cut, even with millions of rows below it", () => {
    // The grid alone would come out the same if the reader went on to the end,
    // so the rows handed to the grid are counted: one past the cut, then stop.
    const addRow = vi.spyOn(GridBuilder.prototype, "addRow");
    try {
      const text = "a\n".repeat(MEMBER_FILE_MAX_SHEET_ROWS + 2_000_000);
      const result = openTextFile(Buffer.from(text));
      expect(result.ok && result.sheets[0]?.rows.length).toBe(MEMBER_FILE_MAX_SHEET_ROWS);
      expect(result.ok && result.sheets[0]?.truncated).toEqual({ rows: true, columns: false });
      expect(addRow).toHaveBeenCalledTimes(MEMBER_FILE_MAX_SHEET_ROWS + 1);
    } finally {
      addRow.mockRestore();
    }
  });
});

describe("the grid's budget, all sheets together", () => {
  const cell = "x".repeat(MEMBER_FILE_MAX_CELL_CHARS);

  it("takes exactly its characters and stops one character past them", () => {
    const budget = new GridBudget();
    const g = new GridBuilder(null, budget);
    const whole = Math.floor(MEMBER_FILE_MAX_GRID_CHARS / MEMBER_FILE_MAX_CELL_CHARS);
    for (let i = 0; i < whole; i++) expect(g.addRow([cell])).toBe(true);
    expect(g.addRow(["y".repeat(MEMBER_FILE_MAX_GRID_CHARS - whole * MEMBER_FILE_MAX_CELL_CHARS)])).toBe(true);
    expect(budget.exceeded).toBe(false);
    expect(g.addRow(["z"])).toBe(false);
    expect(budget.exceeded).toBe(true);
    expect(g.addRow(["z"])).toBe(false);
  });

  it("counts a cell as it will be posted: cut to its limit", () => {
    const budget = new GridBudget();
    const g = new GridBuilder(null, budget);
    const rows = Math.floor(MEMBER_FILE_MAX_GRID_CHARS / MEMBER_FILE_MAX_CELL_CHARS);
    for (let i = 0; i < rows; i++) expect(g.addRow([`${cell}${cell}`])).toBe(true);
    expect(budget.exceeded).toBe(false);
  });

  it("counts every padded cell, so one wide row makes every row wide", () => {
    const budget = new GridBudget();
    const g = new GridBuilder(null, budget);
    const rows = Math.floor(MEMBER_FILE_MAX_GRID_CELLS / MEMBER_FILE_MAX_COLUMNS);
    for (let i = 0; i < rows - 1; i++) expect(g.addRow(["a"])).toBe(true);
    const wide = Array<string>(MEMBER_FILE_MAX_COLUMNS).fill("b");
    expect(g.addRow(wide)).toBe(true);
    expect(budget.exceeded).toBe(false);
    expect(g.finish().rows.length).toBe(rows);
  });

  it("carries one sheet's cells and characters into the next", () => {
    const budget = new GridBudget();
    const first = new GridBuilder("One", budget);
    const half = Math.floor(MEMBER_FILE_MAX_GRID_CHARS / MEMBER_FILE_MAX_CELL_CHARS / 2);
    for (let i = 0; i < half; i++) first.addRow([cell]);
    first.finish();
    const second = new GridBuilder("Two", budget);
    for (let i = 0; i < half; i++) expect(second.addRow([cell])).toBe(true);
    expect(second.addRow([cell, cell])).toBe(false);
    expect(budget.exceeded).toBe(true);
    const third = new GridBuilder("Three", budget);
    expect(third.addRow(["a"])).toBe(false);
  });

  it("carries cells into the next sheet too", () => {
    const budget = new GridBudget();
    const first = new GridBuilder("One", budget);
    const wide = Array<string>(MEMBER_FILE_MAX_COLUMNS).fill("a");
    const rows = Math.floor(MEMBER_FILE_MAX_GRID_CELLS / MEMBER_FILE_MAX_COLUMNS / 2);
    for (let i = 0; i < rows; i++) first.addRow(wide);
    first.finish();
    const second = new GridBuilder("Two", budget);
    for (let i = 0; i < rows; i++) expect(second.addRow(wide)).toBe(true);
    expect(second.addRow(["a"])).toBe(false);
  });
});
