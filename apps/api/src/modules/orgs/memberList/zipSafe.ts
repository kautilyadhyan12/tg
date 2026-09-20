// Opening an Excel file's archive safely, and rebuilding it before the Excel
// reader sees it (spec Part 3 §9.4). Node's `zlib` only, no package.
//
// **WHY THIS FILE EXISTS.** `read-excel-file` 9.3.10 unzips with a sequential
// reader that believes each part's LOCAL header and allocates the size it
// declares, and nothing caps what it inflates. Measured 2026-09-19: a 139-byte
// file whose header claimed 200 MB took the process from 46 MB to 447 MB; a
// 153 KB file of honest headers inflated to 150 MB. So the package never sees an
// uploaded archive. This file reads the archive from its central directory,
// bounds-checks every offset and length, inflates only the XML parts under a
// hard cap, and writes a FRESH archive of only those parts — stored, with their
// true sizes and checksums, nothing else. Its sequential reader and our
// central-directory reader then cannot disagree about what is inside.
import zlib from "node:zlib";
import {
  MEMBER_FILE_MAX_ARCHIVE_ENTRIES,
  MEMBER_FILE_MAX_INFLATED_BYTES,
  MEMBER_FILE_MAX_TAG_CHARS,
  type MemberFileOtherZip,
  type MemberFileRefusal,
  type MemberFileWarning,
} from "@app/shared";

export type SafeXlsx =
  | { ok: true; repacked: Buffer; warnings: MemberFileWarning[] }
  | { ok: false; refusal: MemberFileRefusal };

const END_SIGNATURE = 0x06054b50;
const END_SIZE = 22;
const MAX_COMMENT = 0xffff;
const CENTRAL_SIGNATURE = 0x02014b50;
const CENTRAL_SIZE = 46;
const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_SIZE = 30;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8_NAME = 0x0800;
const STORED = 0;
const DEFLATED = 8;

/** Thrown inside this file only, and caught at its door. */
class ArchiveRefused extends Error {
  constructor(readonly refusal: MemberFileRefusal) {
    super(refusal.code);
  }
}
const unsafe = (): ArchiveRefused => new ArchiveRefused({ code: "unsafe_archive" });

interface Entry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

/** Throws unless `length` bytes from `offset` lie inside the file. */
function need(buf: Buffer, offset: number, length: number): void {
  if (offset < 0 || length < 0 || offset + length > buf.length) throw unsafe();
}

/** The end-of-central-directory record: the one whose comment ends exactly at
 *  the end of the file. No signature at all is not a zip (a download cut short
 *  loses its end); a signature that ends nowhere is bytes after the archive. */
function findEnd(buf: Buffer): number {
  const lowest = Math.max(0, buf.length - END_SIZE - MAX_COMMENT);
  let sawSignature = false;
  for (let at = buf.length - END_SIZE; at >= lowest; at--) {
    if (buf.readUInt32LE(at) !== END_SIGNATURE) continue;
    sawSignature = true;
    if (at + END_SIZE + buf.readUInt16LE(at + 20) === buf.length) return at;
  }
  throw sawSignature ? unsafe() : new ArchiveRefused({ code: "not_a_spreadsheet" });
}

function decodeName(bytes: Buffer, flags: number): string {
  if ((flags & FLAG_UTF8_NAME) === 0) return bytes.toString("latin1");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw unsafe();
  }
}

/** A name that could reach outside the archive or mean two things. */
function isUnsafeName(name: string): boolean {
  return (
    name === "" ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    name.includes("..") ||
    name.includes("\\") ||
    name.includes("\u0000")
  );
}

function readCentralDirectory(buf: Buffer): { entries: Entry[]; directoryStart: number } {
  const end = findEnd(buf);
  const disk = buf.readUInt16LE(end + 4);
  const directoryDisk = buf.readUInt16LE(end + 6);
  const entriesHere = buf.readUInt16LE(end + 8);
  const entries = buf.readUInt16LE(end + 10);
  const directorySize = buf.readUInt32LE(end + 12);
  const directoryOffset = buf.readUInt32LE(end + 16);
  // ZIP64 is never needed under 5 MiB, and a spanned archive is never an upload.
  // Its sentinels are refused here; its end record and locator sit between the
  // directory and this end record, which the contiguity rule below refuses.
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw unsafe();
  if (disk !== 0 || directoryDisk !== 0 || entriesHere !== entries) throw unsafe();
  if (entries > MEMBER_FILE_MAX_ARCHIVE_ENTRIES) throw unsafe();
  // The directory must end where the end record starts: bytes before the archive
  // (which shift every offset) or between the two are refused, not repaired.
  if (directoryOffset + directorySize !== end) throw unsafe();

  const list: Entry[] = [];
  const seen = new Set<string>();
  let at = directoryOffset;
  for (let i = 0; i < entries; i++) {
    if (at + CENTRAL_SIZE > end || buf.readUInt32LE(at) !== CENTRAL_SIGNATURE) throw unsafe();
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const compressedSize = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const startDisk = buf.readUInt16LE(at + 34);
    const localOffset = buf.readUInt32LE(at + 42);
    const recordLength = CENTRAL_SIZE + nameLength + extraLength + commentLength;
    if (at + recordLength > end) throw unsafe();
    if ((flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) !== 0) {
      throw new ArchiveRefused({ code: "old_excel_or_password" });
    }
    if (method !== STORED && method !== DEFLATED) throw unsafe();
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff || startDisk !== 0) {
      throw unsafe();
    }
    const name = decodeName(buf.subarray(at + CENTRAL_SIZE, at + CENTRAL_SIZE + nameLength), flags);
    const key = name.toLowerCase();
    if (isUnsafeName(name) || seen.has(key)) throw unsafe();
    seen.add(key);
    list.push({ name, flags, method, crc, compressedSize, size, localOffset });
    at += recordLength;
  }
  if (at !== end) throw unsafe();
  return { entries: list, directoryStart: directoryOffset };
}

/** An archive with no workbook: which program saves it as one, where the
 *  archive says so. */
function otherZip(names: ReadonlySet<string>): MemberFileOtherZip {
  if (names.has("mimetype") && names.has("content.xml")) return "opendocument";
  if (names.has("index/document.iwa")) return "numbers";
  if (names.has("xl/workbook.bin")) return "excel_binary";
  return "other";
}

/** The XML an Excel reader needs; everything else (images, printer settings, a
 *  macro project) is left behind and never inflated. */
const isXmlPart = (name: string): boolean => /\.(xml|rels)$/i.test(name);

interface Range {
  start: number;
  end: number;
}

/** Where an entry's data starts, read from its local header, and the byte range
 *  the header and data take together. */
function localRange(buf: Buffer, entry: Entry, directoryStart: number): { dataStart: number; range: Range } {
  need(buf, entry.localOffset, LOCAL_SIZE);
  if (buf.readUInt32LE(entry.localOffset) !== LOCAL_SIGNATURE) throw unsafe();
  const dataStart = entry.localOffset + LOCAL_SIZE + buf.readUInt16LE(entry.localOffset + 26) + buf.readUInt16LE(entry.localOffset + 28);
  const dataEnd = dataStart + entry.compressedSize;
  // Every entry's data lies before the central directory.
  if (dataEnd > directoryStart) throw unsafe();
  return { dataStart, range: { start: entry.localOffset, end: dataEnd } };
}

/** Two entries sharing bytes is the overlapping-files bomb: one small block of
 *  data inflated again for every entry that points at it. */
function refuseOverlaps(ranges: Range[]): void {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const before = sorted[i - 1];
    const here = sorted[i];
    if (before !== undefined && here !== undefined && here.start < before.end) throw unsafe();
  }
}

function inflate(compressed: Buffer, entry: Entry): Buffer {
  let out: Buffer;
  if (entry.method === STORED) {
    if (entry.compressedSize !== entry.size) throw unsafe();
    out = compressed;
  } else {
    try {
      // The declared size is the cap: a part may not inflate past what the
      // directory says it is, and the directory's sizes are capped in total.
      out = zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size) });
    } catch {
      throw unsafe();
    }
  }
  if (out.length !== entry.size || zlib.crc32(out) >>> 0 !== entry.crc >>> 0) throw unsafe();
  return out;
}

/** The package reads every part as UTF-8 (`new TextDecoder().decode`), so the
 *  checks read it the same way: what they see is what it will see. */
const partText = (part: Buffer): string => new TextDecoder("utf-8").decode(part);

const DECLARATION = /<!(?:doctype|entity)/i;
const SHEET_DATA = /<(?:[\w.-]+:)?sheetData\b/;
/** Never scans past the next `<` or `>`: with `[^>]*?` every `<row` of a part
 *  with no `>` scanned to its end, growing with the square of the size — 409 ms
 *  at 64 KiB measured here on the pattern alone, 759 ms by the review of PR #85,
 *  which found it, and 4.0 s at 128 KiB. */
const HIDDEN_ROW_OR_COLUMN = /<(?:[\w.-]+:)?(?:row|col)\b[^<>]*?\shidden\s*=\s*["'](?:1|true)["']/;

export const hasHiddenRowsOrColumns = (text: string): boolean => SHEET_DATA.test(text) && HIDDEN_ROW_OR_COLUMN.test(text);

const GREATER_THAN = 0x3e;
const DOUBLE_QUOTE = 0x22;
const SINGLE_QUOTE = 0x27;

/** The ends of the markup that is not a tag, which the package reads quickly
 *  however long (measured: 1 MiB left open, 13–23 ms). */
const CLOSERS: ReadonlyArray<readonly [string, string]> = [
  ["<!--", "-->"],
  ["<![CDATA[", "]]>"],
  ["<?", "?>"],
];

/** Whether every tag in a part ends within MEMBER_FILE_MAX_TAG_CHARS, counted
 *  from its `<` to the first `>` outside a quoted value, and every comment,
 *  CDATA section and processing instruction ends at all. The Excel package's
 *  time grows much faster than a tag's length — 74 s for one closed 1 MiB tag,
 *  94 s for one whose early `>` sits inside quotes, 173 s for one never closed
 *  (measured 2026-09-19) — and one such upload would hold a reading slot for
 *  the whole time limit. One pass, linear in the part. */
export function tagsAreShort(text: string): boolean {
  let at = text.indexOf("<");
  while (at !== -1) {
    const closer = CLOSERS.find(([open]) => text.startsWith(open, at));
    let next: number;
    if (closer !== undefined) {
      const end = text.indexOf(closer[1], at + closer[0].length);
      if (end === -1) return false;
      next = end + closer[1].length;
    } else {
      const limit = Math.min(text.length, at + MEMBER_FILE_MAX_TAG_CHARS);
      let quote = 0;
      let i = at + 1;
      for (; i < limit; i++) {
        const c = text.charCodeAt(i);
        if (quote !== 0) {
          if (c === quote) quote = 0;
        } else if (c === DOUBLE_QUOTE || c === SINGLE_QUOTE) quote = c;
        else if (c === GREATER_THAN) break;
      }
      if (i >= limit) return false;
      next = i + 1;
    }
    at = text.indexOf("<", next);
  }
  return true;
}

/** A fresh archive of `parts`, stored: no compression, no data descriptors, no
 *  extra fields, no comments, true sizes and checksums. */
export function writeStoredZip(parts: ReadonlyArray<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = Buffer.from(part.name, "utf-8");
    const flags = /^[\x20-\x7e]*$/.test(part.name) ? 0 : FLAG_UTF8_NAME;
    const crc = zlib.crc32(part.data) >>> 0;
    const local = Buffer.alloc(LOCAL_SIZE);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(STORED, 8);
    local.writeUInt16LE(0x0021, 12); // 1980-01-01, the earliest date a zip can say
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(part.data.length, 18);
    local.writeUInt32LE(part.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(CENTRAL_SIZE);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(STORED, 10);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(part.data.length, 20);
    central.writeUInt32LE(part.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, part.data);
    centrals.push(central, name);
    offset += LOCAL_SIZE + name.length + part.data.length;
  }
  const directory = Buffer.concat(centrals);
  const endRecord = Buffer.alloc(END_SIZE);
  endRecord.writeUInt32LE(END_SIGNATURE, 0);
  endRecord.writeUInt16LE(parts.length, 8);
  endRecord.writeUInt16LE(parts.length, 10);
  endRecord.writeUInt32LE(directory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, endRecord]);
}

export function openZipSafely(bytes: Uint8Array): SafeXlsx {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    const { entries, directoryStart } = readCentralDirectory(buf);
    const names = new Set(entries.map((e) => e.name.toLowerCase()));
    if (!names.has("[content_types].xml") || !names.has("xl/workbook.xml")) {
      return { ok: false, refusal: { code: "other_zip", archive: otherZip(names) } };
    }
    const located = entries.map((entry) => ({ entry, ...localRange(buf, entry, directoryStart) }));
    refuseOverlaps(located.map((l) => l.range));

    const wanted = located.filter((l) => isXmlPart(l.entry.name));
    // More than the cap, as the directory declares it: an honest workbook far
    // past the list's 10,000 rows, or a bomb claiming big sizes. Either way the
    // fix is the member sheet alone as CSV, which the words of `too_complex` say.
    const declared = wanted.reduce((sum, l) => sum + l.entry.size, 0);
    if (declared > MEMBER_FILE_MAX_INFLATED_BYTES) throw new ArchiveRefused({ code: "too_complex" });

    const parts: Array<{ name: string; data: Buffer }> = [];
    const warnings = new Set<MemberFileWarning>();
    for (const { entry, dataStart } of wanted) {
      const data = inflate(buf.subarray(dataStart, dataStart + entry.compressedSize), entry);
      const text = partText(data);
      if (DECLARATION.test(text) || !tagsAreShort(text)) throw unsafe();
      // A worksheet, wherever the archive keeps it. A filtered view is stored as
      // hidden rows, so this also says "exported a filter".
      if (hasHiddenRowsOrColumns(text)) warnings.add("hidden_rows_or_columns");
      parts.push({ name: entry.name, data });
    }
    return { ok: true, repacked: writeStoredZip(parts), warnings: [...warnings] };
  } catch (error) {
    if (error instanceof ArchiveRefused) return { ok: false, refusal: error.refusal };
    throw error;
  }
}
