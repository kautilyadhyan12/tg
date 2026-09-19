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
 *  - a number in plain digits, never through a JavaScript number, so
 *    `919876543210` and a 16-digit member number stay exact (`parseNumber`
 *    hands over the stored text; `plainNumberText` writes it out);
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

/** The largest shift of the decimal point written out; past it the stored
 *  text is kept as it is (no phone or member number is anywhere near). */
const MAX_EXPONENT = 30;

/** A number cell's stored text in plain digits. Excel stores `919876543210` as
 *  that; Google Sheets stores it as `9.1987654321E11` (measured 2026-09-19 on
 *  Kd's download), every digit present. Written out by moving the decimal point
 *  in the text itself, so nothing passes through a float: the same number reads
 *  the same from either, and 3a-ii never mistakes Google's form for a number
 *  Excel cut short in a CSV (`9.19877E+11`, the digits gone). Text that is not a
 *  number in exponent form is returned unchanged. */
export function plainNumberText(stored: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(stored);
  if (match === null) return stored;
  const [, sign = "", whole = "", fraction = "", exponentText = ""] = match;
  const exponent = Number(exponentText);
  if (Math.abs(exponent) > MAX_EXPONENT) return stored;
  const digits = whole + fraction;
  const point = whole.length + exponent;
  let text: string;
  if (point >= digits.length) text = digits + "0".repeat(point - digits.length);
  else if (point <= 0) text = `0.${"0".repeat(-point)}${digits}`;
  else text = `${digits.slice(0, point)}.${digits.slice(point)}`;
  text = text.replace(/^0+(?=\d)/, "");
  if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
  return text === "0" ? "0" : sign === "-" ? `-${text}` : text;
}

/** Every sheet of a rebuilt workbook, or null when the package cannot read it
 *  (a workbook it finds broken). The package's own error is dropped unread: its
 *  message can quote a cell, and a cell never reaches a log (§9.9). */
export async function readRepackedXlsx(repacked: Buffer): Promise<RawSheet[] | null> {
  let sheets;
  try {
    sheets = await readXlsxFile(repacked, { parseNumber: plainNumberText, trim: false });
  } catch {
    return null;
  }
  return sheets.map((sheet) => ({ name: sheet.sheet, rows: sheet.data }));
}
