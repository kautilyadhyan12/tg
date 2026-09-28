// DOWNLOAD CSV OF THE PEOPLE SELECTED (spec Part 3 §18.5; ROADMAP 5b-v-b-i; the file
// itself built in 5b-iii and taken from its paused branch).
//
// The file holds exactly the people selected — the ones ticked, or everyone "Select all"
// chose if that is still the same set — with every column the list keeps and the gym's
// own. It is written a slice at a time, so the one database connection answers other
// requests in between and ten thousand people are never held in memory whole.
//
// Excel runs a cell that starts with = + - @ (or a TAB, CR, LF, or their full-width
// forms) as a formula. Such a cell gets a TAB at the front of its quoted field, which
// Excel keeps when the file is saved again (OWASP's advice; an apostrophe is stripped on
// save). The email and phone columns hold only shapes the server checked and are written
// as they are, so "+44 …" keeps its plus.
import { MEMBER_APP_FILTER_WORDS, orgWords, type MemberListExportRequest, type MemberListFilter } from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { insertAudit } from "../repo.js";
import { requirePrivilege } from "../service.js";
import * as repo from "./repo.js";
import { selectedIds } from "./selection.js";
import type { MemberListDeps } from "./service.js";

/** How many records one read of the file takes. */
export const EXPORT_PAGE = 500;

/** A cell Excel would run as a formula. */
const FORMULA_START = /^[=+\-@\t\r\n＝＋－＠]/u;

/** One quoted field. `checked` is a shape the server made (an email, an E.164 phone),
 *  written as it is; everything else is free text and guarded. */
export function csvField(value: string, checked = false): string {
  const guarded = !checked && FORMULA_START.test(value) ? `\t${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

type Row = repo.ExportRow;

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
  /** Some of the people are past members, so the day each became one is a column. */
  withPast: boolean;
}

/** The fixed columns, in the order a person's page shows them, with the screen's words.
 *  The date column is named by its kind, which is how the importer reads it back; only
 *  a set holding both kinds gets both columns. */
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
    ...(shape.withPast ? ["Past member since"] : []),
  ];
  return `${headings.map((heading) => csvField(heading)).join(",")}\r\n`;
}

export function csvLine(row: Row, shape: CsvShape): string {
  const cells = [
    ...columns(shape).map((column) => csvField(column.value(row) ?? "", column.checked === true)),
    ...shape.fields.map((field) => csvField(row.extra[field.key] ?? "")),
    ...(shape.withPast ? [csvField(row.formerAt?.toISOString().slice(0, 10) ?? "")] : []),
  ];
  return `${cells.join(",")}\r\n`;
}

const NONE_WORDS = { status: "No status", membershipType: "No membership", paymentStatus: "No payment status" } as const;

const asList = <T>(asked: T | T[] | undefined): T[] => (asked === undefined ? [] : Array.isArray(asked) ? asked : [asked]);

/** The file's name says what it holds, in the gym's own words: "Cancelled members
 *  2026-09-26.csv", "Past members 2026-09-26.csv", "Selected members 2026-09-26.csv" for
 *  people ticked one by one. `people` is the organisation's word. */
export function exportFileName(filter: MemberListFilter | null, people: string, day: string): string {
  let name: string;
  if (filter === null) {
    name = `Selected ${people}`;
  } else if ((filter.records ?? "current") === "former") {
    name = `Past ${people}`;
  } else {
    const kinds = (["status", "membershipType", "paymentStatus"] as const).flatMap((kind) => {
      const shown = asList(filter[kind]).map((word) => (word.trim() === "" ? NONE_WORDS[kind] : word.trim()));
      return shown.length === 0 ? [] : [shown.join(" or ")];
    });
    const app = asList(filter.app).map((word) => MEMBER_APP_FILTER_WORDS[word]);
    if (app.length > 0) kinds.push(app.join(" or "));
    name = kinds.length === 0 ? `All ${people}` : `${kinds.join(", ")} ${people}`;
    if (filter.records === "all") name += ` and past ${people}`;
    if (filter.filter === "in_app") name += " in the app";
    if (filter.filter === "not_in_app") name += " not in the app";
  }
  const typed = (filter?.query ?? "").trim();
  if (typed !== "") name += ` matching ${typed}`;
  // Nothing a computer refuses in a file name, and not too long to read.
  const clean = name
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
  return `${clean.charAt(0).toUpperCase()}${clean.slice(1)} ${day}.csv`;
}

/** The download header: an ASCII name for old browsers, and the exact name (RFC 6266). */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const exact = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${exact}`;
}

/** Excel reads a CSV as UTF-8 only when it starts with the byte-order mark. */
const BOM = "\uFEFF";

export interface ExportFile {
  filename: string;
  /** The file, a slice at a time. */
  chunks: AsyncIterable<string>;
}

/** The people selected as a CSV file, for staff who may see the list. Null when the rate
 *  limit has already answered. The audit row says who downloaded how many, never the
 *  names. A "Select all" whose set has moved throws `SelectionChanged` before anything is
 *  read. */
export async function exportSelected(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  request: MemberListExportRequest,
  limit: () => Promise<boolean>,
): Promise<ExportFile | null> {
  const { org } = await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const { selection } = request;
  const ids = await selectedIds(deps, gymId, selection);
  const [counts, fields] = await Promise.all([repo.exportShapeOf(deps.sql, gymId, ids), repo.listFields(deps.sql, gymId)]);
  const shape: CsvShape = { fields, dated: { ends: counts.ends, renews: counts.renews }, withPast: counts.former > 0 };
  await deps.sql.begin(async (tx) => {
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.member_list_exported",
      targetType: "member_list",
      targetId: gymId,
      meta: { chosenBy: selection.kind, rows: String(ids.length) },
    });
  });

  async function* chunks(): AsyncGenerator<string> {
    yield BOM + csvHeader(shape);
    for (let from = 0; from < ids.length; from += EXPORT_PAGE) {
      const rows = await repo.exportRows(deps.sql, gymId, ids.slice(from, from + EXPORT_PAGE));
      yield rows.map((row) => csvLine(row, shape)).join("");
    }
  }

  const filter = selection.kind === "all" ? selection.filter : null;
  return { filename: exportFileName(filter, orgWords(org.orgType).people, dayInTz(deps.now(), org.timezone)), chunks: chunks() };
}
