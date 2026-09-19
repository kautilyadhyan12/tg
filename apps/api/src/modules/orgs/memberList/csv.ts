// Reading a CSV (spec Part 3 §9.4): which character sits between the columns,
// and one hand-written reader for the records. No CSV package: the rules below
// are Excel's, and each is a row of the table test.
//
// - A first line `sep=X` names the delimiter and is not data (Excel writes and
//   reads it).
// - Otherwise the delimiter is found as Papa Parse finds it, over `,` `;` TAB
//   `|`: read the first 10 records that are not empty lines with each; keep the
//   candidates averaging more than 1.99 fields; the lowest change in field count
//   between one record and the next wins, then the most fields, then that
//   order; none kept → `,` (a one-column list of emails is a real file).
// - A quote opens a field only as its first character; `""` inside is one
//   quote; text after the closing quote is kept as typed, as Excel keeps it.
// - CRLF, LF and CR each end a record outside quotes; inside, they are the
//   cell's own line breaks.
// - A quote still open at the end of the file refuses it, naming the row.

/** The characters a delimiter is looked for among, in the order that breaks a tie. */
export const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"] as const;
const SAMPLE_RECORDS = 10;
const LEAST_AVERAGE_FIELDS = 1.99;

const QUOTE = 0x22;
const CR = 0x0d;
const LF = 0x0a;

/** Receives each record: the fields kept (at most `keepFields`), how many
 *  fields it really had, and whether a field past `keepFields` held more than
 *  white space. Returns false to stop reading. */
export type RecordSink = (fields: string[], fieldCount: number, writtenPastKept: boolean) => boolean;

export type CsvRead = { ok: true } | { ok: false; unterminatedAtRow: number };

/** Where the unquoted text starting at `from` stops: the delimiter, a line end
 *  or the end of the text. */
function stopAt(text: string, from: number, delimiter: number): number {
  let i = from;
  for (; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === delimiter || c === CR || c === LF) break;
  }
  return i;
}

/** Reads `text` record by record into `sink`. Row numbers count records from 1,
 *  empty lines included, as the gym's spreadsheet shows them. */
export function readCsvRecords(text: string, delimiter: string, keepFields: number, sink: RecordSink): CsvRead {
  const d = delimiter.charCodeAt(0);
  const n = text.length;
  let i = 0;
  let row = 0;
  while (i < n) {
    row++;
    const fields: string[] = [];
    let fieldCount = 0;
    let writtenPastKept = false;
    for (;;) {
      let value: string;
      if (text.charCodeAt(i) === QUOTE) {
        i++;
        value = "";
        for (;;) {
          const close = text.indexOf('"', i);
          if (close === -1) return { ok: false, unterminatedAtRow: row };
          if (text.charCodeAt(close + 1) === QUOTE) {
            value += text.slice(i, close + 1);
            i = close + 2;
            continue;
          }
          value += text.slice(i, close);
          i = close + 1;
          break;
        }
        const tail = stopAt(text, i, d);
        value += text.slice(i, tail);
        i = tail;
      } else {
        const stop = stopAt(text, i, d);
        value = text.slice(i, stop);
        i = stop;
      }
      fieldCount++;
      if (fields.length < keepFields) fields.push(value);
      else if (value.trim() !== "") writtenPastKept = true;
      if (i < n && text.charCodeAt(i) === d) {
        i++;
        continue;
      }
      // A line end, or the end of the text.
      if (i < n) i += text.charCodeAt(i) === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
      break;
    }
    if (!sink(fields, fieldCount, writtenPastKept)) return { ok: true };
  }
  return { ok: true };
}

/** A first line `sep=X`: the delimiter it names and the text after it. */
export function readSepLine(text: string): { delimiter: string; rest: string } | null {
  const match = /^sep=([^"\r\n])(\r\n|\n|\r|$)/i.exec(text);
  const delimiter = match?.[1];
  if (match === null || delimiter === undefined) return null;
  return { delimiter, rest: text.slice(match[0].length) };
}

export function detectDelimiter(text: string): string {
  let best: { delimiter: string; change: number; average: number } | null = null;
  for (const candidate of CANDIDATE_DELIMITERS) {
    const counts: number[] = [];
    readCsvRecords(text, candidate, 1, (fields, fieldCount) => {
      if (fieldCount === 1 && fields[0] === "") return true; // an empty line
      counts.push(fieldCount);
      return counts.length < SAMPLE_RECORDS;
    });
    if (counts.length === 0) continue;
    const average = counts.reduce((sum, c) => sum + c, 0) / counts.length;
    if (average <= LEAST_AVERAGE_FIELDS) continue;
    let change = 0;
    for (let k = 1; k < counts.length; k++) change += Math.abs((counts[k] ?? 0) - (counts[k - 1] ?? 0));
    if (best === null || change < best.change || (change === best.change && average > best.average)) {
      best = { delimiter: candidate, change, average };
    }
  }
  return best?.delimiter ?? ",";
}
