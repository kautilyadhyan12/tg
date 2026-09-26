// THE LIST AS A CSV FILE (5b-iii; Part 3 §9.9).
//
// The download holds exactly what "Your list" shows — the same filters and search, read
// by the same statement — every page at once, with the gym's own columns. It is written
// a page at a time, so the one database connection answers other requests between pages
// and a list of ten thousand people is never held in memory whole.
//
// Excel runs a cell that starts with = + - @ (or a TAB, CR, LF, or their full-width
// forms) as a formula. Such a cell gets a TAB at the front of its quoted field, which
// Excel keeps when the file is saved again (OWASP's advice since 2026-01; an apostrophe
// is stripped on save). The email and phone columns hold only shapes the server checked
// and are written as they are, so "+44 …" keeps its plus.
import type { MemberListExportQuery } from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { insertAudit } from "../repo.js";
import { requirePrivilege } from "../service.js";
import * as repo from "./repo.js";
import { entriesFilter, type MemberListDeps } from "./service.js";

/** How many records one read of the export takes. */
export const EXPORT_PAGE = 500;

/** A cell Excel would run as a formula. */
const FORMULA_START = /^[=+\-@\t\r\n＝＋－＠]/u;

/** One quoted field. `checked` is a shape the server made (an email, an E.164 phone),
 *  written as it is; everything else is free text and guarded. */
export function csvField(value: string, checked = false): string {
  const guarded = !checked && FORMULA_START.test(value) ? `\t${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

type Row = repo.EntryRow;

interface Column {
  heading: string;
  value: (row: Row) => string | null;
  checked?: boolean;
}

const endDate: Column = { heading: "End date", value: (row) => (row.endsOnKind === "renews" ? null : row.endsOn) };
const renewalDate: Column = { heading: "Renewal date", value: (row) => (row.endsOnKind === "renews" ? row.endsOn : null) };

export interface CsvShape {
  /** The gym's own columns, in the catalogue's order. */
  fields: readonly { key: string; label: string }[];
  /** How many of the people carry an end date and how many a renewal date. */
  dated: { ends: number; renews: number };
  /** Past members were asked for, so the day each was removed is a column. */
  withRemoved: boolean;
}

/** The fixed columns, in the order a person's page shows them, with the screen's words.
 *  The date column is named by its kind, which is how the importer reads it back; only
 *  a list holding both kinds gets both columns. */
function columns(shape: CsvShape): Column[] {
  const { ends, renews } = shape.dated;
  const dates = ends > 0 && renews > 0 ? [endDate, renewalDate] : renews > 0 ? [renewalDate] : [endDate];
  return [
    { heading: "Name", value: (row) => row.fullName },
    { heading: "Email", value: (row) => row.email, checked: true },
    { heading: "Phone", value: (row) => row.phone, checked: true },
    { heading: "Member number", value: (row) => row.memberNumber },
    { heading: "Status", value: (row) => row.status },
    { heading: "Membership", value: (row) => row.membershipType },
    { heading: "Join date", value: (row) => row.joinedOn },
    ...dates,
    { heading: "Payment status", value: (row) => row.paymentStatus },
    { heading: "Date of birth", value: (row) => row.dateOfBirth },
  ];
}

export function csvHeader(shape: CsvShape): string {
  const headings = [
    ...columns(shape).map((column) => column.heading),
    ...shape.fields.map((field) => field.label),
    ...(shape.withRemoved ? ["Removed from list"] : []),
  ];
  return `${headings.map((heading) => csvField(heading)).join(",")}\r\n`;
}

export function csvLine(row: Row, shape: CsvShape): string {
  const cells = [
    ...columns(shape).map((column) => csvField(column.value(row) ?? "", column.checked === true)),
    ...shape.fields.map((field) => csvField(row.extra?.[field.key] ?? "")),
    ...(shape.withRemoved ? [csvField(row.formerAt?.toISOString().slice(0, 10) ?? "")] : []),
  ];
  return `${cells.join(",")}\r\n`;
}

/** Excel reads a CSV as UTF-8 only when it starts with the byte-order mark. */
const BOM = "\uFEFF";

export interface ExportFile {
  filename: string;
  /** The file, a page at a time. */
  chunks: AsyncIterable<string>;
}

/** The list as a CSV file, for staff who may see the list. Null when the rate limit has
 *  already answered. The audit row says who downloaded how many, never the names. */
export async function exportList(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  query: MemberListExportQuery,
  limit: () => Promise<boolean>,
): Promise<ExportFile | null> {
  const { org } = await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const [filter, fields] = await Promise.all([entriesFilter(deps, gymId, query), repo.listFields(deps.sql, gymId)]);
  const read = (cursor: { name: string; id: string } | null) =>
    repo.entriesPage(deps.sql, { ...filter, cursor, limit: EXPORT_PAGE + 1, withExtra: true });
  const first = await read(null);
  const shape: CsvShape = { fields, dated: first.dated, withRemoved: filter.records !== "current" };
  await deps.sql.begin(async (tx) => {
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.member_list_exported",
      targetType: "member_list",
      targetId: gymId,
      meta: { records: filter.records, rows: String(first.total) },
    });
  });

  async function* chunks(): AsyncGenerator<string> {
    yield BOM + csvHeader(shape);
    let page = first;
    for (;;) {
      const shown = page.entries.slice(0, EXPORT_PAGE);
      yield shown.map((row) => csvLine(row, shape)).join("");
      const last = shown[shown.length - 1];
      if (page.entries.length <= EXPORT_PAGE || last === undefined) return;
      page = await read({ name: last.fullName, id: last.entryId });
    }
  }

  return { filename: `members-${dayInTz(deps.now(), org.timezone)}.csv`, chunks: chunks() };
}
