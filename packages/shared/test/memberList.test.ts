import { describe, expect, it } from "vitest";
import {
  MEMBER_FILE_MAX_BYTES,
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
    else out.push({ code: "unterminated_quote", row: 7 });
  }
  return out;
}

describe("member file refusals", () => {
  it("give every refusal its own words, each ending in what to do", () => {
    const all = everyRefusal();
    expect(all.length).toBe(17); // 12 plain codes, 4 kinds of other zip, 1 open quote
    const words = all.map((r) => memberFileRefusalWords(r));
    for (const w of words) {
      expect(w.length).toBeGreaterThan(20);
      expect(w.endsWith(".")).toBe(true);
    }
    expect(new Set(words).size).toBe(all.length);
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
