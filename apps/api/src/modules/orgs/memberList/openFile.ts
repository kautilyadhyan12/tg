// What the worker does with a file the sniff let through (spec Part 3 §9.4):
// an Excel archive is opened safely, rebuilt and read; text is decoded and read
// as a CSV. Out comes a grid of text cells, or one refusal. Pure apart from the
// package it calls, so the tests run it in-process as well as in the worker.
import { MEMBER_FILE_MAX_COLUMNS, type MemberFileResult, type MemberFileSheet } from "@app/shared";
import { detectDelimiter, readCsvRecords, readSepLine } from "./csv.js";
import { decodeMemberText } from "./decodeText.js";
import { GridBudget, GridBuilder } from "./grid.js";
import { cellText, readRepackedXlsx } from "./xlsx.adapter.js";
import { openZipSafely } from "./zipSafe.js";

export type OpenableKind = "zip" | "text";

export async function openXlsxFile(bytes: Uint8Array): Promise<MemberFileResult> {
  const safe = openZipSafely(bytes);
  if (!safe.ok) return { ok: false, refusal: safe.refusal };
  const sheets = await readRepackedXlsx(safe.repacked);
  if (sheets === null) return { ok: false, refusal: { code: "unreadable_excel" } };
  const budget = new GridBudget();
  const grids: MemberFileSheet[] = [];
  for (const sheet of sheets) {
    const grid = new GridBuilder(sheet.name, budget);
    for (const row of sheet.rows) {
      if (!grid.addRow(row.map(cellText))) break;
    }
    grids.push(grid.finish());
    if (budget.exceeded) return { ok: false, refusal: { code: "too_complex" } };
  }
  return { ok: true, kind: "xlsx", sheets: grids, facts: {}, warnings: safe.warnings };
}

export function openTextFile(bytes: Uint8Array): MemberFileResult {
  const decoded = decodeMemberText(bytes);
  if (!decoded.ok) return { ok: false, refusal: decoded.refusal };
  const sep = readSepLine(decoded.text);
  const text = sep?.rest ?? decoded.text;
  const delimiter = sep?.delimiter ?? detectDelimiter(text);
  const budget = new GridBudget();
  const grid = new GridBuilder(null, budget);
  const read = readCsvRecords(text, delimiter, MEMBER_FILE_MAX_COLUMNS, (fields, _count, writtenPastKept) =>
    grid.addRow(fields, writtenPastKept),
  );
  if (!read.ok) return { ok: false, refusal: { code: "unterminated_quote", row: read.unterminatedAtRow } };
  const sheet = grid.finish();
  // A CSV is at most MEMBER_FILE_MAX_BYTES and one sheet, so within the budget
  // by construction; the check keeps the two readers one rule.
  if (budget.exceeded) return { ok: false, refusal: { code: "too_complex" } };
  return {
    ok: true,
    kind: "csv",
    sheets: [sheet],
    facts: { encoding: decoded.encoding, delimiter },
    warnings: decoded.guessed ? ["encoding_guessed"] : [],
  };
}

export async function openMemberFileContents(kind: OpenableKind, bytes: Uint8Array): Promise<MemberFileResult> {
  return kind === "zip" ? openXlsxFile(bytes) : openTextFile(bytes);
}
