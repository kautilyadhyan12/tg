// Builds zip archives inside the member list's tests — the honest ones and the
// booby-trapped ones (spec Part 3 §9.10: bombs are built in the test, never
// committed). Every field a bomb lies in can be set by hand.
import zlib from "node:zlib";

export interface KitPart {
  name: string;
  data: Buffer;
  deflate?: boolean;
  /** Overrides, for lying: what the headers SAY. */
  size?: number;
  compressedSize?: number;
  crc?: number;
  flags?: number;
  method?: number;
  /** Streaming writers put zeros in the local header and the truth after the data. */
  dataDescriptor?: boolean;
  /** Bytes written as a UTF-8 name, when `name` cannot say them (a bad sequence). */
  nameBytes?: Buffer;
}

export interface KitOptions {
  before?: Buffer;
  after?: Buffer;
  comment?: Buffer;
  zip64Locator?: boolean;
  disk?: number;
  entriesHere?: number;
  entries?: number;
  directorySize?: number;
  /** Extra central-directory records pointing at an earlier part's local header. */
  alsoPointAt?: Array<{ part: number; name: string }>;
}

export function buildZip(parts: KitPart[], options: KitOptions = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  const offsets: number[] = [];
  const records: Buffer[][] = [];
  let offset = 0;
  for (const part of parts) {
    const name = part.nameBytes ?? Buffer.from(part.name, "utf-8");
    const data = part.deflate === true ? zlib.deflateRawSync(part.data, { level: 9 }) : part.data;
    const crc = part.crc ?? zlib.crc32(part.data) >>> 0;
    const size = part.size ?? part.data.length;
    const compressedSize = part.compressedSize ?? data.length;
    const method = part.method ?? (part.deflate === true ? 8 : 0);
    const flags = (part.flags ?? 0) | (part.dataDescriptor === true ? 0x0008 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    if (part.dataDescriptor !== true) {
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(compressedSize, 18);
      local.writeUInt32LE(size, 22);
    }
    local.writeUInt16LE(name.length, 26);
    const pieces = [local, name, data];
    if (part.dataDescriptor === true) {
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressedSize, 8);
      descriptor.writeUInt32LE(size, 12);
      pieces.push(descriptor);
    }
    offsets.push(offset);
    locals.push(...pieces);
    offset += pieces.reduce((sum, p) => sum + p.length, 0);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    records.push([central, name]);
  }
  records.forEach(([central], i) => central?.writeUInt32LE(offsets[i] ?? 0, 42));
  for (const record of records) centrals.push(...record);
  for (const extra of options.alsoPointAt ?? []) {
    const source = records[extra.part]?.[0];
    if (source === undefined) throw new Error("no such part");
    const central = Buffer.from(source);
    const name = Buffer.from(extra.name, "utf-8");
    central.writeUInt16LE(name.length, 28);
    centrals.push(central, name);
  }
  const directory = Buffer.concat(centrals);
  const count = parts.length + (options.alsoPointAt?.length ?? 0);
  const comment = options.comment ?? Buffer.alloc(0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(options.disk ?? 0, 4);
  end.writeUInt16LE(options.entriesHere ?? count, 8);
  end.writeUInt16LE(options.entries ?? count, 10);
  end.writeUInt32LE(options.directorySize ?? directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  const locator = options.zip64Locator === true ? Buffer.alloc(20) : Buffer.alloc(0);
  if (options.zip64Locator === true) locator.writeUInt32LE(0x07064b50, 0);
  return Buffer.concat([options.before ?? Buffer.alloc(0), ...locals, directory, locator, end, comment, options.after ?? Buffer.alloc(0)]);
}

const xml = (body: string): Buffer => Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`, "utf-8");

/** An inline-string cell, for the hand-written sheet. */
const cell = (ref: string, text: string): string => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;

/** A sheet's XML from rows of text (A1 references, inline strings). */
export function sheetXml(rows: string[][], rowAttributes = "", extra = ""): string {
  const body = rows
    .map((row, r) => `<row r="${String(r + 1)}"${rowAttributes}>${row.map((text, c) => cell(`${String.fromCharCode(65 + c)}${String(r + 1)}`, text)).join("")}</row>`)
    .join("");
  return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${extra}<sheetData>${body}</sheetData></worksheet>`;
}

/** The smallest workbook the package reads: one sheet of inline strings. */
export function workbookParts(sheet = sheetXml([["Email"], ["ann@example.com"]])): KitPart[] {
  return [
    {
      name: "[Content_Types].xml",
      data: xml(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ),
      deflate: true,
    },
    {
      name: "_rels/.rels",
      data: xml(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
      deflate: true,
    },
    {
      name: "xl/workbook.xml",
      data: xml(
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Members" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      deflate: true,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: xml(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      deflate: true,
    },
    { name: "xl/worksheets/sheet1.xml", data: xml(sheet), deflate: true },
  ];
}

/** A1-style column letters: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** A workbook as Excel writes a big one: every text cell an index into one
 *  shared strings table. */
export function sharedStringsWorkbookParts(rows: string[][]): KitPart[] {
  const index = new Map<string, number>();
  const strings: string[] = [];
  const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const sheetRows = rows.map((row, r) => {
    const cells = row.map((text, c) => {
      let i = index.get(text);
      if (i === undefined) {
        i = strings.length;
        index.set(text, i);
        strings.push(text);
      }
      return `<c r="${columnName(c)}${String(r + 1)}" t="s"><v>${String(i)}</v></c>`;
    });
    return `<row r="${String(r + 1)}">${cells.join("")}</row>`;
  });
  const parts = workbookParts(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows.join("")}</sheetData></worksheet>`);
  const rels = parts.find((p) => p.name === "xl/_rels/workbook.xml.rels");
  if (rels === undefined) throw new Error("no workbook relationships");
  rels.data = xml(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
  );
  // Excel marks a string to keep its spaces only where it has spaces to keep.
  const table = strings.map((s) => (s.trim() === s ? `<si><t>${escape(s)}</t></si>` : `<si><t xml:space="preserve">${escape(s)}</t></si>`)).join("");
  parts.push({
    name: "xl/sharedStrings.xml",
    data: xml(`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${String(rows.length * (rows[0]?.length ?? 0))}" uniqueCount="${String(strings.length)}">${table}</sst>`),
    deflate: true,
  });
  return parts;
}

/** Every entry of an archive as its central directory lists it (to read back
 *  what `zipSafe.ts` wrote). */
export function listZip(zip: Buffer): Array<{ name: string; method: number; flags: number; size: number; compressedSize: number; data: Buffer }> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    const nameLength = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf-8");
    const local = zip.readUInt32LE(at + 42);
    const compressedSize = zip.readUInt32LE(at + 20);
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    out.push({
      name,
      method: zip.readUInt16LE(at + 10),
      flags: zip.readUInt16LE(at + 8),
      size: zip.readUInt32LE(at + 24),
      compressedSize,
      data: zip.subarray(dataStart, dataStart + compressedSize),
    });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return out;
}

/** The review of PR #85's amplifier: every cell of a `rows` × `columns` sheet
 *  points at ONE shared string. Tiny on disk and in the worker; one copy per cell
 *  wherever the grid is posted. */
export function sharedStringBombParts(rows: number, columns: number, text: string): KitPart[] {
  const cells = Array.from({ length: columns }, (_, c) => `<c r="${columnName(c)}@" t="s"><v>0</v></c>`).join("");
  const body = Array.from({ length: rows }, (_, r) => `<row r="${String(r + 1)}">${cells.replace(/@/g, String(r + 1))}</row>`).join("");
  const parts = sharedStringsWorkbookParts([["x"]]);
  const sheet = parts.find((p) => p.name === "xl/worksheets/sheet1.xml");
  const strings = parts.find((p) => p.name === "xl/sharedStrings.xml");
  if (sheet === undefined || strings === undefined) throw new Error("no sheet or strings");
  sheet.data = xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`);
  strings.data = xml(`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>${text}</t></si></sst>`);
  return parts;
}
