// DOWNLOAD PAYMENTS (spec Part 3 §14.3; ROADMAP 18n). The file names people and what they
// paid, so it is read only by the owner and staff the owner gives both Reports and payments
// (`mayDownloadPayments`). A stranger gets `requireStaff`'s 404. The audit row says who
// downloaded which days and how many lines, never a name.
import type { Sql } from "postgres";
import {
  PAYMENTS_DOWNLOAD_WORDS,
  PAYMENTS_FILE_HEADINGS,
  coversWords,
  dayWords,
  mayDownloadPayments,
  memberCurrencyForCountry,
  paymentLine,
  paymentsDownloadSummarySchema,
  paymentsFileName,
  type PaymentsDownloadQuery,
  type PaymentsDownloadSummary,
  type PaymentsTotals,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { insertAudit } from "../repo.js";
import { OrgsError, requireStaff } from "../service.js";
import * as repo from "./repo.js";
import { xlsxFile, type Cell, type Sheet } from "./xlsx.js";

export interface PaymentsDownloadDeps {
  sql: Sql;
  now: () => Date;
}

export interface Days {
  from: string;
  to: string;
  everyDay: boolean;
  /** The gym's own currency, for totals with nothing in them. */
  currency: string;
}

/** Staff who may download, and the days asked: with none, the gym's first line to today.
 *  Asked before the limit, so a refused ask spends nothing. */
export async function requireReader(deps: PaymentsDownloadDeps, userId: string, gymId: string, query: PaymentsDownloadQuery): Promise<Days> {
  const { org, privileges } = await requireStaff(deps, gymId, userId);
  if (!mayDownloadPayments(privileges)) throw new OrgsError(403, "forbidden", PAYMENTS_DOWNLOAD_WORDS.no_payments);
  // What its members pay in, as Reports counts it; never the money the gym pays us in (18s).
  const currency = memberCurrencyForCountry(org.country) ?? org.currencyDisplay;
  if (query.from !== undefined && query.to !== undefined) return { from: query.from, to: query.to, everyDay: false, currency };
  const today = dayInTz(deps.now(), org.timezone);
  const first = await repo.firstDay(deps.sql, gymId);
  return { from: first !== null && first < today ? first : today, to: today, everyDay: true, currency };
}

/** No line on the days still totals 0 in the gym's own currency. */
const shownTotals = (days: Days, totals: readonly PaymentsTotals[]): readonly PaymentsTotals[] =>
  totals.length > 0 ? totals : [{ currency: days.currency, paidMinor: 0, soldMinor: 0, refundedMinor: 0, netMinor: 0 }];

export async function summary(deps: PaymentsDownloadDeps, gymId: string, days: Days): Promise<PaymentsDownloadSummary> {
  const { lines, totals } = await repo.totals(deps.sql, gymId, days.from, days.to);
  return paymentsDownloadSummarySchema.parse({ from: days.from, to: days.to, lines, totals: shownTotals(days, totals) });
}

const WIDTHS = [13, 10, 21, 26, 26, 36, 11, 20, 18, 14, 12, 18, 30, 20];
const MONEY_HEADINGS = new Set(["Amount", "Tax", "Amount counted"]);

/** What Totals says of Reports: Reports counts the gym's own currency only, so a file with
 *  another currency names which Collected matches, and one without the gym's says nothing. */
export function reportsSentence(gymCurrency: string, totals: readonly PaymentsTotals[]): string | null {
  if (!totals.some((t) => t.currency === gymCurrency)) return null;
  return totals.length === 1
    ? "Collected is the same as Collected on Reports for these days."
    : `Collected in ${gymCurrency} is the same as Collected on Reports for these days.`;
}

/** The Totals sheet: each currency's column, in Reports' and the Download box's own words. */
function totalsSheet(days: Days, lines: number, totals: readonly PaymentsTotals[]): Sheet {
  const money = (pick: (t: PaymentsTotals) => number, bold = false): Cell[] => totals.map((t) => ({ kind: "money", minor: pick(t), currency: t.currency, bold }));
  const reports = reportsSentence(days.currency, totals);
  const rows: Cell[][] = [
    [{ kind: "text", value: "Days" }, { kind: "text", value: days.from === days.to ? dayWords(days.from) : coversWords(days.from, days.to) }],
    [{ kind: "text", value: "Transactions" }, { kind: "int", value: lines }],
    [],
    [{ kind: "text", value: "Memberships" }, ...money((t) => t.paidMinor)],
    [{ kind: "text", value: "Product sales" }, ...money((t) => t.soldMinor)],
    [{ kind: "text", value: "Refunded" }, ...money((t) => -t.refundedMinor)],
    [{ kind: "text", value: "Collected", bold: true }, ...money((t) => t.netMinor, true)],
    [],
    [{ kind: "text", value: reports === null ? "Voided transactions are listed and count 0." : `Voided transactions are listed and count 0. ${reports}` }],
  ];
  return { name: "Totals", widths: [24, ...totals.map(() => 18)], header: ["Totals", ...totals.map((t) => t.currency)], filter: false, rows: [rows] };
}

export interface PaymentsFile {
  filename: string;
  chunks: AsyncIterable<Buffer>;
}

/** The file for the days, after its audit row. The row is written before the file goes, so a
 *  file cut off half-way, which has still left the app, has its note too. The pages stop at
 *  the last receipt Totals counted, so a line recorded while a large file is written is in
 *  neither. A line voided or refunded in that second can still read so in Payments and not
 *  in Totals: one snapshot would hold a pooled connection for as long as the asker reads,
 *  which a slow reader could stretch across the pool. */
export async function file(deps: PaymentsDownloadDeps, userId: string, gymId: string, days: Days): Promise<PaymentsFile> {
  const { lines, lastReceipt, totals } = await repo.totals(deps.sql, gymId, days.from, days.to);
  await deps.sql.begin(async (tx) => {
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.payments_downloaded",
      targetType: "gym",
      targetId: gymId,
      meta: { from: days.from, to: days.to, everyDay: days.everyDay ? "yes" : "no", lines: String(lines) },
    });
  });
  // One currency names itself in the money headings; more than one get a column of their own.
  const mixed = totals.length > 1;
  const single = totals[0]?.currency ?? days.currency;
  const header = [...PAYMENTS_FILE_HEADINGS.map((h) => (!mixed && MONEY_HEADINGS.has(h) ? `${h} (${single})` : h)), ...(mixed ? ["Currency"] : [])];

  async function* rows(): AsyncGenerator<Cell[][]> {
    let after: { on: string; receipt: number; line: number } | null = null;
    for (;;) {
      const page = await repo.linesPage(deps.sql, gymId, days.from, days.to, lastReceipt, after);
      if (page.length === 0) return;
      yield page.map((row): Cell[] => {
        const line = paymentLine(row);
        const currency: Cell[] = mixed ? [{ kind: "text", value: row.currency }] : [];
        return [
          { kind: "date", day: line.on },
          { kind: "int", value: line.receipt },
          { kind: "text", value: line.type },
          { kind: "text", value: line.person },
          { kind: "text", value: line.paidBy },
          { kind: "text", value: line.details },
          line.forReceipt === null ? null : { kind: "int", value: line.forReceipt },
          { kind: "text", value: line.refundReason },
          { kind: "text", value: line.method },
          { kind: "money", minor: line.amountMinor, currency: row.currency },
          { kind: "money", minor: line.taxMinor, currency: row.currency },
          { kind: "money", minor: line.countedMinor, currency: row.currency },
          { kind: "text", value: line.status },
          { kind: "text", value: line.by },
          ...currency,
        ];
      });
      const last = page[page.length - 1];
      if (last === undefined || page.length < repo.DOWNLOAD_PAGE) return;
      after = { on: last.on, receipt: last.receipt, line: last.line };
    }
  }

  const sheets: Sheet[] = [
    { name: "Payments", widths: mixed ? [...WIDTHS, 10] : WIDTHS, header, filter: true, rows: rows() },
    totalsSheet(days, lines, shownTotals(days, totals)),
  ];
  return { filename: paymentsFileName(days.from, days.to, days.everyDay), chunks: xlsxFile(sheets) };
}
