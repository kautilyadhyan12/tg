import { describe, expect, it } from "vitest";
import {
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
    columns: [{ index: 0, header: "Email", samples: ["ann@example.com"], guess: "email", confidence: "header" }],
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
