// The safe unzip and re-pack (spec Part 3 §9.4, §9.10): every booby trap built
// here, never committed, and each one refused before a byte of it is inflated
// past its cap. The last block reads a rebuilt archive with the real package.
import zlib from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMBER_FILE_MAX_ARCHIVE_ENTRIES, MEMBER_FILE_MAX_INFLATED_BYTES, MEMBER_FILE_MAX_TAG_CHARS } from "@app/shared";
import { hasHiddenRowsOrColumns, openZipSafely, tagsAreShort } from "../src/modules/orgs/memberList/zipSafe.js";
import { readRepackedXlsx } from "../src/modules/orgs/memberList/xlsx.adapter.js";
import { buildZip, listZip, sheetXml, workbookParts, type KitPart } from "./memberList.zipKit.js";

const MiB = 1024 * 1024;

function refusal(zip: Buffer): unknown {
  const result = openZipSafely(zip);
  return result.ok ? "opened" : result.refusal;
}

/** The minimal workbook with its sheet swapped, or one part changed. */
function withPart(change: (parts: KitPart[]) => KitPart[]): Buffer {
  return buildZip(change(workbookParts()));
}

describe("an honest workbook", () => {
  it("opens, and the rebuilt archive holds only its XML parts, stored, with true sizes and no descriptors", () => {
    const zip = buildZip([
      ...workbookParts(),
      { name: "xl/vbaProject.bin", data: Buffer.from("macro project"), deflate: true },
      { name: "xl/media/image1.png", data: Buffer.alloc(64, 7) },
      { name: "docProps/", data: Buffer.alloc(0) },
    ]);
    const result = openZipSafely(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entries = listZip(result.repacked);
    expect(entries.map((e) => e.name)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
    ]);
    for (const entry of entries) {
      expect(entry.method).toBe(0);
      expect(entry.flags & 0x0008).toBe(0);
      expect(entry.compressedSize).toBe(entry.size);
    }
    expect(entries[4]?.data.toString("utf-8")).toContain("ann@example.com");
    expect(result.warnings).toEqual([]);
  });

  it("opens again from its own rebuilt archive, unchanged", () => {
    const first = openZipSafely(buildZip(workbookParts()));
    if (!first.ok) throw new Error("the honest workbook was refused");
    const second = openZipSafely(first.repacked);
    if (!second.ok) throw new Error("the rebuilt workbook was refused");
    expect(second.repacked.equals(first.repacked)).toBe(true);
  });

  it("opens with data descriptors, as a streaming writer leaves them", () => {
    const zip = buildZip(workbookParts().map((p) => ({ ...p, dataDescriptor: true })));
    expect(refusal(zip)).toBe("opened");
  });

  it("writes every number in the plain digits the file holds, never through a JavaScript number", async () => {
    const sheet =
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      '<row r="1"><c r="A1"><v>12345678901234567890</v></c><c r="B1"><v>9.1987654321E+11</v></c><c r="C1"><v>0.30000000000000004</v></c></row>' +
      "</sheetData></worksheet>";
    const result = openZipSafely(buildZip(workbookParts(sheet)));
    if (!result.ok) throw new Error("refused");
    const sheets = await readRepackedXlsx(result.repacked);
    expect(sheets?.[0]?.rows).toEqual([["12345678901234567890", "919876543210", "0.30000000000000004"]]);
  });

  it("reads through the package from the rebuilt archive", async () => {
    const result = openZipSafely(buildZip(workbookParts(sheetXml([["Email", "Phone"], ["ann@example.com", "919876543210"]]))));
    if (!result.ok) throw new Error("refused");
    const sheets = await readRepackedXlsx(result.repacked);
    expect(sheets?.map((s) => ({ name: s.name, rows: s.rows }))).toEqual([
      { name: "Members", rows: [["Email", "Phone"], ["ann@example.com", "919876543210"]] },
    ]);
  });
});

describe("booby-trapped archives (§9.10)", () => {
  const sheet = (data: Buffer, extra: Partial<KitPart> = {}): Buffer =>
    withPart((parts) => parts.map((p) => (p.name === "xl/worksheets/sheet1.xml" ? { ...p, data, ...extra } : p)));

  it.each([
    ["a part declaring 1 KB that inflates to 26 MiB", () => sheet(Buffer.alloc(26 * MiB, 0x20), { size: 1024 })],
    ["a part declaring more than it inflates to", () => sheet(Buffer.from("<worksheet/>"), { size: 4096 })],
    ["a CRC that does not match", () => sheet(Buffer.from("<worksheet/>"), { crc: 1234 })],
    ["a stored part whose sizes differ", () => sheet(Buffer.from("<worksheet/>"), { deflate: false, size: 3 })],
    ["a compression method other than stored or deflate", () => sheet(Buffer.from("<worksheet/>"), { method: 12 })],
    ["a deflate stream that is not one", () => sheet(Buffer.from("<worksheet/>"), { deflate: false, method: 8 })],
    ["ZIP64 sizes", () => sheet(Buffer.from("<worksheet/>"), { size: 0xffffffff })],
    ["a DOCTYPE in a part", () => sheet(Buffer.from('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><worksheet/>'))],
    ["an ENTITY in a part", () => sheet(Buffer.from("<worksheet><!ENTITY a 'b'></worksheet>"))],
    ["a doctype in lower case", () => sheet(Buffer.from("<!doctype worksheet><worksheet/>"))],
    ["overlapping entries (one block inflated for two names)", () => buildZip(workbookParts(), { alsoPointAt: [{ part: 4, name: "xl/worksheets/sheet2.xml" }] })],
    ["a ZIP64 end locator", () => buildZip(workbookParts(), { zip64Locator: true })],
    ["a spanned archive", () => buildZip(workbookParts(), { disk: 1 })],
    ["an end record whose two entry counts differ", () => buildZip(workbookParts(), { entriesHere: 4 })],
    ["a directory size that does not match", () => buildZip(workbookParts(), { directorySize: 10 })],
    ["junk before the archive", () => buildZip(workbookParts(), { before: Buffer.from("junk") })],
    ["junk after the archive", () => buildZip(workbookParts(), { after: Buffer.from("junk") })],
    ["more entries than the end record says", () => buildZip(workbookParts(), { entries: 4, entriesHere: 4 })],
  ])("%s → unsafe_archive", (_label, make) => {
    expect(refusal(make())).toEqual({ code: "unsafe_archive" });
  });

  it.each([
    ["a header claiming 200 MB (the measured attack)", () => sheet(Buffer.from("<worksheet/>"), { size: 200 * MiB })],
    ["a 1,000:1 deflate declaring its true 26 MiB", () => sheet(Buffer.alloc(26 * MiB, 0x20))],
  ])("%s → too_complex, refused on what it declares before a byte is inflated", (_label, make) => {
    const inflate = vi.spyOn(zlib, "inflateRawSync");
    expect(refusal(make())).toEqual({ code: "too_complex" });
    expect(inflate).not.toHaveBeenCalled();
    inflate.mockRestore();
  });

  it("refuses 1,001 entries and opens 1,000", () => {
    const filler = (count: number): KitPart[] =>
      Array.from({ length: count }, (_, i) => ({ name: `xl/media/f${String(i)}.bin`, data: Buffer.alloc(0) }));
    const base = workbookParts();
    expect(refusal(buildZip([...base, ...filler(MEMBER_FILE_MAX_ARCHIVE_ENTRIES - base.length)]))).toBe("opened");
    expect(refusal(buildZip([...base, ...filler(MEMBER_FILE_MAX_ARCHIVE_ENTRIES - base.length + 1)]))).toEqual({ code: "unsafe_archive" });
  });

  it("opens XML parts worth exactly the inflate cap and refuses one byte more", () => {
    const parts = (last: number): KitPart[] => {
      const base = workbookParts();
      const used = base.reduce((sum, p) => sum + p.data.length, 0);
      return [...base, { name: "xl/filler.xml", data: Buffer.alloc(MEMBER_FILE_MAX_INFLATED_BYTES - used + last, 0x20), deflate: true }];
    };
    expect(refusal(buildZip(parts(0)))).toBe("opened");
    expect(refusal(buildZip(parts(1)))).toEqual({ code: "too_complex" });
  });

  it("never inflates a part it leaves behind: a 26 MiB image does not count against the cap", () => {
    const zip = buildZip([...workbookParts(), { name: "xl/media/huge.bin", data: Buffer.alloc(26 * MiB), deflate: true }]);
    expect(refusal(zip)).toBe("opened");
  });

  it.each([
    ["../evil.xml"],
    ["xl/../../evil.xml"],
    ["/etc/evil.xml"],
    ["C:evil.xml"],
    ["xl\\evil.xml"],
    ["xl/evil\u0000.xml"],
  ])("refuses the entry name %j", (name) => {
    expect(refusal(buildZip([...workbookParts(), { name, data: Buffer.from("<x/>") }]))).toEqual({ code: "unsafe_archive" });
  });

  it.each([["xl/workbook.xml"], ["XL/Workbook.XML"]])("refuses a second entry named %j", (name) => {
    expect(refusal(buildZip([...workbookParts(), { name, data: Buffer.from("<x/>") }]))).toEqual({ code: "unsafe_archive" });
  });

  it("refuses a name flagged UTF-8 that is not", () => {
    const part: KitPart = { name: "", nameBytes: Buffer.from([0x78, 0xc3, 0x28]), flags: 0x0800, data: Buffer.from("<x/>") };
    expect(refusal(buildZip([...workbookParts(), part]))).toEqual({ code: "unsafe_archive" });
  });

  it("refuses a local header that is not one", () => {
    const zip = buildZip(workbookParts());
    zip.writeUInt32LE(0x12345678, 0);
    expect(refusal(zip)).toEqual({ code: "unsafe_archive" });
  });

  it.each([
    ["the traditional password flag", 0x0001],
    ["the strong-encryption flag", 0x0040],
  ])("answers %s as a workbook with a password", (_label, flags) => {
    const zip = withPart((parts) => parts.map((p, i) => (i === 4 ? { ...p, flags } : p)));
    expect(refusal(zip)).toEqual({ code: "old_excel_or_password" });
  });

  it("answers a file cut short (no end record) as not a spreadsheet", () => {
    const zip = buildZip(workbookParts());
    expect(refusal(zip.subarray(0, zip.length - 30))).toEqual({ code: "not_a_spreadsheet" });
    expect(refusal(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toEqual({ code: "not_a_spreadsheet" });
  });

  it("keeps the end record whose comment runs to the end of the file", () => {
    expect(refusal(buildZip(workbookParts(), { comment: Buffer.from("made by a tool") }))).toBe("opened");
  });
});

describe("zips that are not an Excel workbook", () => {
  it.each([
    ["OpenDocument", [{ name: "mimetype", data: Buffer.from("application/vnd.oasis.opendocument.spreadsheet") }, { name: "content.xml", data: Buffer.from("<x/>") }], "opendocument"],
    ["Apple Numbers", [{ name: "Index/Document.iwa", data: Buffer.from("x") }, { name: "Metadata/Properties.plist", data: Buffer.from("x") }], "numbers"],
    ["Excel Binary", [{ name: "[Content_Types].xml", data: Buffer.from("<x/>") }, { name: "xl/workbook.bin", data: Buffer.from("x") }], "excel_binary"],
    ["a Word document", [{ name: "[Content_Types].xml", data: Buffer.from("<x/>") }, { name: "word/document.xml", data: Buffer.from("<x/>") }], "other"],
    ["a workbook with no content types", [{ name: "xl/workbook.xml", data: Buffer.from("<x/>") }], "other"],
    ["an empty archive", [], "other"],
  ] as const)("%s → other_zip %s", (_label, parts, archive) => {
    expect(refusal(buildZip(parts.map((p) => ({ ...p }))))).toEqual({ code: "other_zip", archive });
  });
});

describe("hidden rows and columns", () => {
  const warnings = (sheet: string): unknown => {
    const result = openZipSafely(buildZip(workbookParts(sheet)));
    return result.ok ? result.warnings : result.refusal;
  };

  it.each([
    ["a hidden row", sheetXml([["Email"], ["ann@example.com"]], ' hidden="1"'), ["hidden_rows_or_columns"]],
    ["hidden as true", sheetXml([["Email"]], ' hidden="true"'), ["hidden_rows_or_columns"]],
    ["a hidden column", sheetXml([["Email"]], "", '<cols><col min="1" max="1" width="9" hidden="1"/></cols>'), ["hidden_rows_or_columns"]],
    ["a prefixed row", '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1" hidden="1"/></x:sheetData></x:worksheet>', ["hidden_rows_or_columns"]],
    ["hidden=\"0\"", sheetXml([["Email"]], ' hidden="0"'), []],
    ["no hidden attribute", sheetXml([["Email"]], ' spans="1:1"'), []],
    ["the <cols> wrapper alone", sheetXml([["Email"]], "", "<cols hidden=\"1\"></cols>"), []],
  ])("%s", (_label, sheet, expected) => {
    expect(warnings(sheet)).toEqual(expected);
  });

  it("does not look for them outside a worksheet", () => {
    const zip = buildZip([...workbookParts(), { name: "xl/custom.xml", data: Buffer.from('<list><row hidden="1"/></list>') }]);
    const result = openZipSafely(zip);
    expect(result.ok && result.warnings).toEqual([]);
  });
});

describe("the deflate cap is the declared size", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks zlib for no more than each part declares, so a bomb stops at its cap", () => {
    // 50 MiB of spaces deflates to about 50 KB. Declared as 1 KiB, inflation must
    // stop at 1 KiB: the refusal alone cannot show that (a whole inflation
    // would be refused too, AFTER allocating the 50 MiB), so the call is read.
    const data = Buffer.alloc(50 * MiB, 0x20);
    expect(zlib.deflateRawSync(data).length).toBeLessThan(100_000);
    const inflate = vi.spyOn(zlib, "inflateRawSync");
    const zip = withPart((parts) => [...parts, { name: "xl/bomb.xml", data, deflate: true, size: 1024 }]);
    expect(refusal(zip)).toEqual({ code: "unsafe_archive" });
    const caps = inflate.mock.calls.map(([, options]) => options?.maxOutputLength);
    expect(caps).toContain(1024);
  });
});

describe("tags a part may hold (the Excel package slows past a long one)", () => {
  /** A tag `length` characters long from its "<" to its ">". */
  const tag = (length: number): string => `<c ${"a".repeat(length - 5)}/>`;

  it.each([
    ["no markup at all", "just text", true],
    ["an empty part", "", true],
    ["a declaration, a comment, CDATA and ordinary tags", '<?xml version="1.0"?><!-- note --><w><![CDATA[ <not a tag> ]]><c r="A1"/></w>', true],
    ["a > inside a double-quoted value", '<c t="a>b" r="A1"/>', true],
    ["a > inside a single-quoted value", "<c t='a>b' r='A1'/>", true],
    ["a tag exactly at the limit", tag(MEMBER_FILE_MAX_TAG_CHARS), true],
    ["a tag one character over", tag(MEMBER_FILE_MAX_TAG_CHARS + 1), false],
    ["a tag never closed", "<c r=\"A1\"", false],
    ["a > inside quotes, then the tag runs on", `<c t=">" ${"a ".repeat(MEMBER_FILE_MAX_TAG_CHARS)}`, false],
    ["a quote never closed", `<c t="${"a".repeat(10)}>`, false],
    ["a comment never closed", "<w><!-- > </w>", false],
    ["CDATA never closed", "<w><![CDATA[ > </w>", false],
    ["an instruction never closed", "<?xml version='1.0' >", false],
    ["a long text node", `<t>${"a".repeat(4 * MEMBER_FILE_MAX_TAG_CHARS)}</t>`, true],
    ["a long comment, closed", `<!--${"a".repeat(4 * MEMBER_FILE_MAX_TAG_CHARS)}-->`, true],
    ["a < in a tag's value", '<c t="a<b"/>', true],
  ])("%s", (_label, text, expected) => {
    expect(tagsAreShort(text)).toBe(expected);
  });

  it("counts the tag helper right", () => {
    expect(tag(MEMBER_FILE_MAX_TAG_CHARS).length).toBe(MEMBER_FILE_MAX_TAG_CHARS);
  });

  it("refuses a sheet holding a tag past the limit", () => {
    const long = sheetXml([["Email"]]).replace("<sheetData>", `<sheetData><row r="9" ${"a".repeat(MEMBER_FILE_MAX_TAG_CHARS)}></row>`);
    expect(refusal(buildZip(workbookParts(long)))).toEqual({ code: "unsafe_archive" });
  });

  it("checks tags and hidden rows in time linear in the part", () => {
    // Each of these took minutes before (a row with no ">" scanned to the end of
    // the part for every "<row"); a mebibyte now takes milliseconds.
    const rowsNoClose = `<sheetData>${"<row a ".repeat(150_000)}`;
    const t0 = performance.now();
    expect(hasHiddenRowsOrColumns(rowsNoClose)).toBe(false);
    expect(tagsAreShort(`<w>${"<c a='b'>".repeat(100_000)}</w>`)).toBe(true);
    expect(performance.now() - t0).toBeLessThan(2_000);
  });
});
