import { describe, expect, it } from "vitest";
import {
  isLargeMemberListChange,
  MEMBER_FILE_MAX_BASE64_CHARS,
  MEMBER_LIST_UPLOAD_GONE_WORDS,
  memberListModeSchema,
  memberListRowsQuerySchema,
  memberListUploadGoneSchema,
  memberListUploadRequestSchema,
  MEMBER_FILE_MAX_BYTES,
  MEMBER_FILE_MAX_COLUMNS,
  MEMBER_LIST_SKIP_WORDS,
  memberListMappingSchema,
  memberListSkipReasonSchema,
  memberListUnderstandResultSchema,
  memberListWarningSchema,
  memberListWarningWords,
  type MemberListWarning,
  memberFileOtherZipSchema,
  memberFileRefusalSchema,
  memberFileRefusalWords,
  memberFileResultSchema,
  type MemberFileRefusal,
} from "../src/memberList.js";

/** Every refusal the schema allows, each variant once. */
function everyRefusal(): MemberFileRefusal[] {
  const out: MemberFileRefusal[] = [];
  for (const option of memberFileRefusalSchema.options) {
    const code = option.shape.code;
    if ("options" in code) for (const c of code.options) out.push({ code: c });
    else if (code.value === "other_zip") for (const archive of memberFileOtherZipSchema.options) out.push({ code: "other_zip", archive });
    else if (code.value === "mapped_column_not_status") out.push({ code: "mapped_column_not_status", column: 3 });
    else out.push({ code: "unterminated_quote", row: 7 });
  }
  return out;
}

describe("member file refusals", () => {
  it("give every refusal its own words, each ending in what to do", () => {
    const all = everyRefusal();
    expect(all.length).toBe(21); // 15 plain codes, 4 kinds of other zip, 1 open quote, 1 mapped column
    const words = all.map((r) => memberFileRefusalWords(r));
    for (const w of words) {
      expect(w.length).toBeGreaterThan(20);
      expect(w.endsWith(".")).toBe(true);
    }
    expect(new Set(words).size).toBe(all.length);
  });

  it("never speak of the file's name, which the server never sees", () => {
    // Review of PR #85: "named like an Excel file" was said of a members.htm too.
    for (const w of everyRefusal().map((r) => memberFileRefusalWords(r))) {
      expect(w).not.toMatch(/\bnamed?\b|file name|extension/i);
    }
  });

  it("name the row of a quote left open, and the program for a zip that is not Excel", () => {
    expect(memberFileRefusalWords({ code: "unterminated_quote", row: 42 })).toMatch(/^Row 42 /);
    expect(memberFileRefusalWords({ code: "other_zip", archive: "numbers" })).toContain("Numbers");
    expect(memberFileRefusalWords({ code: "other_zip", archive: "opendocument" })).toContain("LibreOffice");
    expect(memberFileRefusalWords({ code: "web_page_or_xml" })).toContain("Save As");
  });

  it("say the size limit the server applies", () => {
    expect(MEMBER_FILE_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(memberFileRefusalWords({ code: "too_big" })).toContain("over 5 MB");
  });
});

describe("the shape a file opens into", () => {
  const grid = {
    ok: true,
    kind: "csv",
    sheets: [{ name: null, rows: [["Email"], ["a@example.com"]], truncated: { rows: false, columns: false } }],
    facts: { encoding: "utf-8", delimiter: "," },
    warnings: [],
  };

  it("accepts a grid and a refusal", () => {
    expect(memberFileResultSchema.safeParse(grid).success).toBe(true);
    expect(memberFileResultSchema.safeParse({ ok: false, refusal: { code: "busy" } }).success).toBe(true);
  });

  it.each([
    ["a zip refusal with no kind of zip", { ok: false, refusal: { code: "other_zip" } }],
    ["a quote refusal with no row", { ok: false, refusal: { code: "unterminated_quote" } }],
    ["a quote refusal at row 0", { ok: false, refusal: { code: "unterminated_quote", row: 0 } }],
    ["a code nobody sends", { ok: false, refusal: { code: "nope" } }],
    ["a two-character delimiter", { ...grid, facts: { delimiter: ";;" } }],
    ["an encoding the ladder never names", { ...grid, facts: { encoding: "ibm850" } }],
    ["a cell that is not text", { ...grid, sheets: [{ name: null, rows: [[1]], truncated: { rows: false, columns: false } }] }],
    ["a grid claiming to be refused", { ...grid, ok: false }],
    ["an unknown warning", { ...grid, warnings: ["looks_odd"] }],
  ])("refuses %s", (_label, value) => {
    expect(memberFileResultSchema.safeParse(value).success).toBe(false);
  });
});

describe("what the server says it understood (3a-ii)", () => {
  const mapping = memberListMappingSchema.parse({ headerRow: 0, email: [2], phone: [3] });

  it("fills in what a mapping leaves out, so nothing is ever undefined", () => {
    expect(mapping).toEqual({ sheet: null, headerRow: 0, fullName: null, firstName: null, lastName: null, email: [2], phone: [3], memberNumber: null, status: null });
  });

  it.each([
    ["no heading row at all, which is a real answer", { headerRow: null }],
    ["a mapping of every field", { headerRow: 1, sheet: 2, fullName: 0, firstName: 1, lastName: 2, email: [3, 4], phone: [5], memberNumber: 6, status: 7 }],
  ])("takes %s", (_label, sent) => {
    expect(memberListMappingSchema.safeParse(sent).success).toBe(true);
  });

  it.each([
    ["a mapping with no heading row given at all", { email: [1] }],
    ["a column past the widest sheet", { headerRow: 0, email: [MEMBER_FILE_MAX_COLUMNS] }],
    ["a column before the first", { headerRow: 0, email: [-1] }],
    ["more email columns than a person has", { headerRow: 0, email: [0, 1, 2, 3, 4, 5] }],
    ["a field nobody sends", { headerRow: 0, nickname: 1 }],
    ["a column that is not a whole number", { headerRow: 0, status: 1.5 }],
  ])("refuses %s", (_label, sent) => {
    expect(memberListMappingSchema.safeParse(sent).success).toBe(false);
  });

  const understanding = {
    ok: true,
    kind: "csv",
    facts: { encoding: "utf-8", delimiter: "," },
    sheet: { index: 0, name: null },
    headerRow: 0,
    headerFingerprint: "a".repeat(64),
    columns: [{ index: 0, header: "Email", samples: ["ann@example.com"], guess: "email", confidence: "header", headerSays: "email" }],
    mapping,
    needsMapping: false,
    rows: [{ row: 2, fullName: "Ann Lee", email: "ann@example.com", phone: "+919876543210", memberNumber: "000123", status: "Active", identityKey: "b".repeat(64) }],
    counts: { dataRows: 1, kept: 1, noContact: 0, duplicates: 0, withEmail: 1, withPhone: 1, withMemberNumber: 1, withStatus: 1 },
    statuses: [{ label: "Active", count: 1 }],
    skipped: [{ row: 3, reason: "no_contact" }],
    warnings: [{ code: "no_header_row" }],
  };

  it("takes a whole answer, and the same refusals as opening a file", () => {
    expect(memberListUnderstandResultSchema.safeParse(understanding).success).toBe(true);
    expect(memberListUnderstandResultSchema.safeParse({ ok: false, refusal: { code: "too_many_rows" } }).success).toBe(true);
  });

  it.each([
    ["a phone that is not E.164", { ...understanding, rows: [{ ...understanding.rows[0], phone: "9876543210" }] }],
    ["an identity key that is not a hash", { ...understanding, rows: [{ ...understanding.rows[0], identityKey: "not a hash" }] }],
    ["a row number of 0", { ...understanding, rows: [{ ...understanding.rows[0], row: 0 }] }],
    ["a status word nobody could have written", { ...understanding, statuses: [{ label: "Active", count: 0 }] }],
    ["a reason nobody sends", { ...understanding, skipped: [{ row: 3, reason: "felt like it" }] }],
    ["a warning nobody sends", { ...understanding, warnings: [{ code: "looks_odd" }] }],
    ["a counted warning with no count", { ...understanding, warnings: [{ code: "phones_unusual" }] }],
    ["four samples of one column", { ...understanding, columns: [{ ...understanding.columns[0], samples: ["a", "b", "c", "d"] }] }],
  ])("refuses %s", (_label, value) => {
    expect(memberListUnderstandResultSchema.safeParse(value).success).toBe(false);
  });
});

describe("the words a warning is shown with", () => {
  const every: MemberListWarning[] = [
    { code: "hidden_rows_or_columns" },
    { code: "encoding_guessed" },
    { code: "no_header_row" },
    { code: "question_marks_in_names", rows: 1 },
    { code: "garbled_names", rows: 2 },
    { code: "shortened_by_excel", rows: 3 },
    { code: "phones_need_country", rows: 1 },
    { code: "phones_unusual", rows: 4 },
    { code: "shared_emails", rows: 2 },
    { code: "placeholders", rows: 300, values: ["frontdesk@example.com"] },
    { code: "other_sheets_ignored", sheets: ["Staff", "Classes"] },
  ];

  it("cover every warning the server can send, each its own and each a sentence", () => {
    const codes = new Set(every.map((warning) => warning.code));
    for (const option of memberListWarningSchema.options) {
      const code = option.shape.code;
      if ("options" in code) for (const c of code.options) expect(codes.has(c)).toBe(true);
      else expect(codes.has(code.value)).toBe(true);
    }
    const words = every.map((warning) => memberListWarningWords(warning));
    for (const said of words) {
      expect(said.length).toBeGreaterThan(20);
      expect(said.endsWith(".")).toBe(true);
    }
    expect(new Set(words).size).toBe(every.length);
  });

  it("say one and many, and name what they are about", () => {
    expect(memberListWarningWords({ code: "shortened_by_excel", rows: 1 })).toContain("1 row has");
    expect(memberListWarningWords({ code: "shortened_by_excel", rows: 12 })).toContain("12 rows have");
    expect(memberListWarningWords({ code: "placeholders", rows: 300, values: ["desk@example.com"] })).toContain("desk@example.com");
    expect(memberListWarningWords({ code: "other_sheets_ignored", sheets: ["Staff"] })).toContain("Staff");
  });

  it("say what a skipped row was skipped for", () => {
    for (const reason of memberListSkipReasonSchema.options) {
      expect(MEMBER_LIST_SKIP_WORDS[reason].endsWith(".")).toBe(true);
    }
  });
});

describe("what the list's own shapes promise (3a-iii)", () => {
  it("the base64 ceiling is the file limit encoded, and nothing smaller", () => {
    // A body is refused on its LENGTH before a byte is decoded, so the ceiling has to
    // be at least what the biggest allowed file encodes to — one character short and
    // the largest legal file is refused for being too long.
    const biggest = Math.ceil(MEMBER_FILE_MAX_BYTES / 3) * 4;
    expect(MEMBER_FILE_MAX_BASE64_CHARS).toBe(biggest);
    expect(Buffer.alloc(MEMBER_FILE_MAX_BYTES).toString("base64").length).toBeLessThanOrEqual(MEMBER_FILE_MAX_BASE64_CHARS);
    // And not so generous that a body no file could fill gets through the schema.
    expect(Buffer.alloc(MEMBER_FILE_MAX_BYTES + 1024).toString("base64").length).toBeGreaterThan(MEMBER_FILE_MAX_BASE64_CHARS);
  });

  it.each([
    ["nothing", undefined, true, undefined],
    ["the first page", "0", true, 0],
    ["a page part way in", "500", true, 500],
    ["the last page a list could have", "9900", true, 9900],
    ["a number past any list", "100000", false, undefined],
    ["text", "abc", false, undefined],
    ["nothing at all", "", false, undefined],
    ["exponent form", "1e3", false, undefined],
    ["a negative", "-1", false, undefined],
    ["a leading zero", "00", false, undefined],
    ["a decimal", "1.5", false, undefined],
    ["spaces", " 5 ", false, undefined],
  ])("the cursor takes %s", (_label, cursor, ok, expected) => {
    // A query parameter is TEXT and is parsed into a number, never coerced from one
    // (trap #5): `z.coerce.number()` reads "" as 0 and "1e3" as 1,000, so a screen
    // asking for nothing would silently be answered the first page.
    const parsed = memberListRowsQuerySchema.safeParse(cursor === undefined ? { group: "new" } : { group: "new", cursor });
    expect(parsed.success, String(cursor)).toBe(ok);
    if (parsed.success) expect(parsed.data.cursor).toBe(expected);
  });

  it("the rows query takes only what it names", () => {
    expect(memberListRowsQuerySchema.safeParse({ group: "new", limit: "5" }).success).toBe(false);
    expect(memberListRowsQuerySchema.safeParse({}).success).toBe(false);
    expect(memberListRowsQuerySchema.safeParse({ group: "everybody" }).success).toBe(false);
  });

  it.each([
    [10, 100, false],
    [11, 100, true],
    [10, 50, false],
    [11, 50, true],
    [200, 2000, false],
    [201, 2000, true],
    [10, 0, false],
    [11, 0, true],
    [9, 9, false],
    [0, 0, false],
  ])("a change of %i out of %i needs a tick: %s", (changing, of, large) => {
    // max(10, 10 %), and the edges are the whole rule: a share alone is useless at 50
    // people and a count alone at 2,000 (§9.8). The same function answers the preview's
    // numbers and the confirm's refusal, so a screen can never promise what the server
    // will refuse.
    expect(isLargeMemberListChange(changing, of)).toBe(large);
  });

  it("an upload is either the whole list or people to add, and nothing else", () => {
    expect([...memberListModeSchema.options].sort()).toEqual(["add", "whole_list"]);
    expect(memberListUploadRequestSchema.safeParse({ contentBase64: "AAAA", mode: "replace" }).success).toBe(false);
    expect(memberListUploadRequestSchema.safeParse({ contentBase64: "AAAA", mode: "add" }).success).toBe(true);
    // A body with nothing in it is refused by the shape, before the service is reached.
    expect(memberListUploadRequestSchema.safeParse({ contentBase64: "", mode: "add" }).success).toBe(false);
  });

  it("every sentence for an upload that has gone says what to do about it", () => {
    for (const gone of memberListUploadGoneSchema.options) {
      const said = MEMBER_LIST_UPLOAD_GONE_WORDS[gone];
      expect(said.length).toBeGreaterThan(20);
      expect(said.endsWith(".")).toBe(true);
      // The server never sees a file's name and never says one (§9.9).
      expect(said).not.toContain(".csv");
      expect(said).not.toContain(".xlsx");
    }
  });
});
