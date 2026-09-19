// The one door to `read-excel-file` (Kd's yes, RULINGS 2026-09-17). It is handed
// ONLY the archive `zipSafe.ts` rebuilt, never an upload (spec Part 3 §9.4), and
// its types stop here: out come every sheet's rows of plain values, which
// `cellText` turns into text one row at a time (a sheet the package padded to a
// million rows is never copied whole).
import readXlsxFile from "read-excel-file/node";

export interface RawSheet {
  name: string;
  rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

/** A package value as the text a gym typed:
 *  - text as is, untrimmed (the cleaning is 3a-ii's, where every field has its rule);
 *  - a number as Excel stored it, never through a JavaScript number, so
 *    `919876543210` and a 16-digit member number stay exact (`parseNumber`);
 *  - TRUE / FALSE;
 *  - a date as YYYY-MM-DD (Excel's date has no time zone; the package reads it as UTC);
 *  - an empty cell, or a formula whose result was never saved, as "". */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  if (typeof value === "number") return String(value);
  return "";
}

/** Every sheet of a rebuilt workbook, or null when the package cannot read it
 *  (a workbook it finds broken). The package's own error is dropped unread: its
 *  message can quote a cell, and a cell never reaches a log (§9.9). */
export async function readRepackedXlsx(repacked: Buffer): Promise<RawSheet[] | null> {
  let sheets;
  try {
    sheets = await readXlsxFile(repacked, { parseNumber: (s: string) => s, trim: false });
  } catch {
    return null;
  }
  return sheets.map((sheet) => ({ name: sheet.sheet, rows: sheet.data }));
}
