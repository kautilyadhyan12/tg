// A small Excel (.xlsx) writer for the payments download (ROADMAP 18n): a file that opens
// tidy — bold headings with filter arrows, the top row kept in place, columns wide enough,
// real dates and money with two decimals — which a CSV cannot carry.
//
// An .xlsx is a ZIP of XML parts. Each part is deflated as it is written and the file goes
// out a slice at a time, so a gym's whole history is never held in memory whole. Each
// entry's sizes follow its data (the ZIP "data descriptor"), as streaming writers do. Text
// is always an inline string, never a formula, so a name typed as "=HYPERLINK(…)" is only
// ever text; characters XML cannot hold are dropped.
import { Readable, pipeline } from "node:stream";
import { createDeflateRaw, crc32 } from "node:zlib";

export type Cell =
  | { kind: "text"; value: string; bold?: boolean }
  | { kind: "int"; value: number }
  | { kind: "money"; minor: number; bold?: boolean }
  | { kind: "date"; day: string }
  | null;

export interface Sheet {
  name: string;
  /** Each column's width in characters. */
  widths: readonly number[];
  /** A bold first row that stays in place, with filter arrows when `filter`. */
  header: readonly string[];
  filter: boolean;
  /** The rows under it, a slice at a time. */
  rows: AsyncIterable<Cell[][]> | Iterable<Cell[][]>;
}

// Styles, by their place in cellXfs below.
const STYLE = { text: 0, header: 1, date: 2, money: 3, int: 4, moneyBold: 5, textBold: 6 } as const;

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="d mmm yyyy"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="7">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

/** A column's letters: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Text as XML holds it: escaped, without the characters XML 1.0 refuses (a control
 *  character, a lone surrogate), and no longer than a cell takes. */
export function xmlText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .slice(0, 32_000)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Excel's number for a day: days since 30 December 1899. */
export function excelDay(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000) + 25_569;
}

function cellXml(cell: Cell, ref: string): string {
  if (cell === null) return "";
  switch (cell.kind) {
    case "text":
      if (cell.value === "") return "";
      return `<c r="${ref}" t="inlineStr" s="${String(cell.bold === true ? STYLE.textBold : STYLE.text)}"><is><t xml:space="preserve">${xmlText(cell.value)}</t></is></c>`;
    case "int":
      return `<c r="${ref}" s="${String(STYLE.int)}"><v>${String(cell.value)}</v></c>`;
    case "money":
      return `<c r="${ref}" s="${String(cell.bold === true ? STYLE.moneyBold : STYLE.money)}"><v>${(cell.minor / 100).toFixed(2)}</v></c>`;
    case "date":
      return `<c r="${ref}" s="${String(STYLE.date)}"><v>${String(excelDay(cell.day))}</v></c>`;
  }
}

function rowXml(cells: readonly Cell[], row: number, header: boolean): string {
  const xml = cells
    .map((cell, i) => {
      const ref = `${columnName(i)}${String(row)}`;
      return header && cell?.kind === "text" ? `<c r="${ref}" t="inlineStr" s="${String(STYLE.header)}"><is><t>${xmlText(cell.value)}</t></is></c>` : cellXml(cell, ref);
    })
    .join("");
  return `<row r="${String(row)}">${xml}</row>`;
}

/** The parts of one sheet, a slice at a time. `done` learns its last row for the filter. */
async function* sheetXml(sheet: Sheet, done: (lastRow: number) => void): AsyncGenerator<string> {
  const cols = sheet.widths.map((w, i) => `<col min="${String(i + 1)}" max="${String(i + 1)}" width="${String(w)}" customWidth="1"/>`).join("");
  yield '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>` +
    rowXml(
      sheet.header.map((value) => ({ kind: "text", value })),
      1,
      true,
    );
  let row = 1;
  for await (const slice of sheet.rows) {
    yield slice.map((cells) => rowXml(cells, ++row, false)).join("");
  }
  const filter = sheet.filter ? `<autoFilter ref="A1:${columnName(sheet.header.length - 1)}${String(row)}"/>` : "";
  yield `</sheetData>${filter}</worksheet>`;
  done(row);
}

// ── The ZIP around the parts ──

const DOS_DATE = (1 << 5) | 1; // 1 January 1980: no clock in the file.

interface Written {
  name: Buffer;
  crc: number;
  size: number;
  packed: number;
  offset: number;
}

const u16 = (n: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

/** Flags: sizes after the data (bit 3), names in UTF-8 (bit 11). */
const FLAGS = 0x0808;

async function* zipEntry(name: string, parts: AsyncIterable<string> | Iterable<string>, offset: number, written: Written[]): AsyncGenerator<Buffer> {
  const entry: Written = { name: Buffer.from(name, "utf8"), crc: 0, size: 0, packed: 0, offset };
  const header = Buffer.concat([u32(0x04034b50), u16(20), u16(FLAGS), u16(8), u16(0), u16(DOS_DATE), u32(0), u32(0), u32(0), u16(entry.name.length), u16(0), entry.name]);
  yield header;
  async function* bytes(): AsyncGenerator<Buffer> {
    for await (const part of parts) {
      const b = Buffer.from(part, "utf8");
      entry.crc = crc32(b, entry.crc);
      entry.size += b.length;
      yield b;
    }
  }
  const deflate = createDeflateRaw({ level: 6 });
  pipeline(Readable.from(bytes()), deflate, () => {});
  for await (const out of deflate) {
    if (!Buffer.isBuffer(out)) throw new Error("deflate gave no bytes");
    entry.packed += out.length;
    yield out;
  }
  yield Buffer.concat([u32(0x08074b50), u32(entry.crc), u32(entry.packed), u32(entry.size)]);
  written.push(entry);
}

function centralDirectory(written: readonly Written[], offset: number): Buffer {
  const entries = written.map((e) =>
    Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(FLAGS), u16(8), u16(0), u16(DOS_DATE),
      u32(e.crc), u32(e.packed), u32(e.size), u16(e.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(e.offset), e.name,
    ]),
  );
  const directory = Buffer.concat(entries);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(written.length), u16(written.length), u32(directory.length), u32(offset), u16(0)]);
  return Buffer.concat([directory, end]);
}

/** The workbook, a slice at a time: its sheets in order, the first one open. */
export async function* xlsxFile(sheets: readonly Sheet[]): AsyncGenerator<Buffer> {
  const written: Written[] = [];
  let offset = 0;
  async function* put(name: string, parts: AsyncIterable<string> | Iterable<string>): AsyncGenerator<Buffer> {
    for await (const b of zipEntry(name, parts, offset, written)) {
      offset += b.length;
      yield b;
    }
  }
  const sheetsXml = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${String(i + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  yield* put(
    "[Content_Types].xml",
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        `${sheetsXml}</Types>`,
    ],
  );
  yield* put(
    "_rels/.rels",
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ],
  );
  yield* put("xl/styles.xml", [STYLES_XML]);
  const lastRows: number[] = [];
  for (const [i, sheet] of sheets.entries()) {
    yield* put(`xl/worksheets/sheet${String(i + 1)}.xml`, sheetXml(sheet, (last) => (lastRows[i] = last)));
  }
  const rels = sheets.map((_, i) => `<Relationship Id="rId${String(i + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(i + 1)}.xml"/>`).join("");
  yield* put(
    "xl/_rels/workbook.xml.rels",
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `${rels}<Relationship Id="rId${String(sheets.length + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
  );
  // The filter's range is named once its last row is known, as Excel itself writes it.
  const names = sheets
    .flatMap((sheet, i) =>
      sheet.filter ? [`<definedName name="_xlnm._FilterDatabase" localSheetId="${String(i)}" hidden="1">'${xmlText(sheet.name)}'!$A$1:$${columnName(sheet.header.length - 1)}$${String(lastRows[i] ?? 1)}</definedName>`] : [],
    )
    .join("");
  const list = sheets.map((sheet, i) => `<sheet name="${xmlText(sheet.name)}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`).join("");
  yield* put(
    "xl/workbook.xml",
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<bookViews><workbookView activeTab="0"/></bookViews><sheets>${list}</sheets>${names === "" ? "" : `<definedNames>${names}</definedNames>`}</workbook>`,
    ],
  );
  yield centralDirectory(written, offset);
}
