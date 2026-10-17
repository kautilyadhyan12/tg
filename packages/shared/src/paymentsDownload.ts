// DOWNLOAD PAYMENTS — Part 3 §14.3; ROADMAP Stage 2 item 18n.
//
// A spreadsheet of every membership payment, membership refund, product sale and product
// refund on the days picked, for the gym's accountant: one line each, with its receipt
// number, in the gym's own words. A line voided by staff stays in the file, marked, and
// counts 0, as accounting software lists a void. The totals are Reports' own: payments
// and sales taken, less refunds given back, by the day each was taken or given back.
import { z } from "zod";
import { isRealDay } from "./discounts.js";
import {
  MEMBER_PAYMENT_METHOD_WORDS,
  PAYMENT_VOID_REASON_WORDS,
  REFUND_REASON_WORDS,
  REFUND_VOID_REASON_WORDS,
  type MemberPaymentMethod,
} from "./memberBills.js";
import { SALE_VOID_REASON_WORDS } from "./register.js";
import { SALE_REFUND_REASON_WORDS } from "./saleRefunds.js";
import type { OrgPrivilege } from "./orgs.js";

/** Who may take the file (Kd, 2026-10-16: "owner and whoever owner allows"): the owner, and
 *  staff the owner gives both Reports and payments, the people who see Money on Reports.
 *  The route, the plan box and the emails before a gym is emptied all read this one list. */
export const PAYMENTS_DOWNLOAD_PRIVILEGES: readonly OrgPrivilege[] = ["reports.read", "billing.members"];
export const mayDownloadPayments = (privileges: readonly string[]): boolean =>
  PAYMENTS_DOWNLOAD_PRIVILEGES.every((p) => privileges.includes(p));

const daySchema = z.string().refine(isRealDay, "not_a_day");
const minorSchema = z.number().int();

/** The days asked for: both, or neither for every day the gym has. */
export const paymentsDownloadQuerySchema = z
  .object({ from: daySchema.optional(), to: daySchema.optional() })
  .strict()
  .refine((q) => (q.from === undefined) === (q.to === undefined), { message: "from_and_to_together" })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, { message: "from_after_to" });
export type PaymentsDownloadQuery = z.infer<typeof paymentsDownloadQuerySchema>;

/** One currency's totals over the days: what Reports calls Collected, in its parts. */
export const paymentsTotalsSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    paidMinor: minorSchema,
    soldMinor: minorSchema,
    refundedMinor: minorSchema,
    /** Payments and sales, less refunds. */
    netMinor: minorSchema,
  })
  .strict();
export type PaymentsTotals = z.infer<typeof paymentsTotalsSchema>;

/** What the file will hold, said in the box before it is downloaded. */
export const paymentsDownloadSummarySchema = z
  .object({
    /** The days the file covers; with no days asked, the gym's first line to today. */
    from: daySchema,
    to: daySchema,
    /** Every line, voided ones too. */
    lines: z.number().int().min(0),
    totals: z.array(paymentsTotalsSchema),
  })
  .strict();
export type PaymentsDownloadSummary = z.infer<typeof paymentsDownloadSummarySchema>;

export const PAYMENTS_DOWNLOAD_WORDS = {
  no_payments: "Your role doesn't allow you to download payments.",
  walk_in: "Walk-in",
  deleted: "A deleted member",
  no_name: "No name on their record",
  voided: "Voided",
  refunded: "Refunded",
  part_refunded: "Part refunded",
} as const;

export type PaymentLineKind = "payment" | "refund" | "sale" | "sale_refund";

export const PAYMENT_LINE_KIND_WORDS: Readonly<Record<PaymentLineKind, string>> = {
  payment: "Membership payment",
  refund: "Membership refund",
  sale: "Product sale",
  sale_refund: "Product refund",
};

/** The file's columns, in order. The money columns' headings carry the currency. */
export const PAYMENTS_FILE_HEADINGS = [
  "Date",
  "Receipt",
  "Type",
  "Person",
  "Details",
  "Refund of receipt",
  "Reason for refund",
  "Payment method",
  "Amount",
  "Tax",
  "Amount counted",
  "Status",
  "Recorded by",
] as const;

/** One line as the database holds it, before it is put in words. */
export interface PaymentLineRow {
  kind: PaymentLineKind;
  on: string;
  receipt: number;
  /** The record's name; null with no record (a walk-in, or deleted for good). */
  name: string | null;
  /** The record was deleted for good since. */
  personDeleted: boolean;
  /** A product sold to nobody on the list. */
  walkIn: boolean;
  /** What it was for: a membership type's name, or the product's. */
  item: string;
  quantity: number | null;
  coversFrom: string | null;
  coversTo: string | null;
  /** What was paid, sold or given back. */
  amountMinor: number;
  /** The whole it was part of (the bill, or the sale) and the tax inside that whole. */
  wholeMinor: number;
  wholeTaxMinor: number;
  method: MemberPaymentMethod;
  /** Staff voided it, or the payment or sale a refund was for. */
  voided: boolean;
  voidReason: string | null;
  /** For a refund: the receipt it gave back on, and why. */
  forReceipt: number | null;
  refundReason: string | null;
  /** For a payment or sale: what refunds standing against it gave back, any day. */
  refundedMinor: number;
  by: string | null;
}

/** One line of the file in words and signed numbers. */
export interface PaymentLine {
  on: string;
  receipt: number;
  type: string;
  person: string;
  details: string;
  forReceipt: number | null;
  refundReason: string;
  method: string;
  /** Signed: a refund is minus. */
  amountMinor: number;
  /** The tax inside what counts; 0 for a voided line. */
  taxMinor: number;
  /** What it adds to the totals: 0 for a voided line. */
  countedMinor: number;
  status: string;
  by: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "1 Oct 2026" from "2026-10-01". */
export function dayWords(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${String(d)} ${MONTHS[(m ?? 1) - 1] ?? ""} ${String(y)}`;
}

/** "1 Oct – 31 Oct 2026", the year once where both share it; one day alone, a fee's (18h-i). */
export function coversWords(from: string, to: string): string {
  if (from === to) return dayWords(from);
  const a = dayWords(from);
  const b = dayWords(to);
  return from.slice(0, 4) === to.slice(0, 4) ? `${a.slice(0, -5)} – ${b}` : `${a} – ${b}`;
}

/** The tax inside part of a whole: its share, rounded to the minor unit. All of a whole
 *  is its whole tax exactly. */
export function taxShare(partMinor: number, wholeMinor: number, wholeTaxMinor: number): number {
  if (wholeMinor <= 0 || wholeTaxMinor <= 0) return 0;
  if (partMinor >= wholeMinor) return wholeTaxMinor;
  return Math.round((partMinor * wholeTaxMinor) / wholeMinor);
}

const lookup = (words: Readonly<Record<string, string>>, key: string | null): string | null =>
  key !== null && Object.hasOwn(words, key) ? (words[key] ?? null) : null;

function voidWords(row: PaymentLineRow): string {
  const reasons: Readonly<Record<PaymentLineKind, Readonly<Record<string, string>>>> = {
    payment: PAYMENT_VOID_REASON_WORDS,
    refund: REFUND_VOID_REASON_WORDS,
    sale: SALE_VOID_REASON_WORDS,
    sale_refund: REFUND_VOID_REASON_WORDS,
  };
  const reason = lookup(reasons[row.kind], row.voidReason);
  return reason === null ? PAYMENTS_DOWNLOAD_WORDS.voided : `${PAYMENTS_DOWNLOAD_WORDS.voided} · ${reason}`;
}

function personWords(row: PaymentLineRow): string {
  if (row.personDeleted) return PAYMENTS_DOWNLOAD_WORDS.deleted;
  if (row.walkIn) return PAYMENTS_DOWNLOAD_WORDS.walk_in;
  return row.name === null || row.name.trim() === "" ? PAYMENTS_DOWNLOAD_WORDS.no_name : row.name;
}

function detailsWords(row: PaymentLineRow): string {
  if (row.kind === "sale" || row.kind === "sale_refund") return row.quantity === null ? row.item : `${String(row.quantity)} × ${row.item}`;
  return row.coversFrom === null || row.coversTo === null ? row.item : `${row.item} · ${coversWords(row.coversFrom, row.coversTo)}`;
}

/** A database line in the file's words. */
export function paymentLine(row: PaymentLineRow): PaymentLine {
  const refund = row.kind === "refund" || row.kind === "sale_refund";
  const sign = refund ? -1 : 1;
  const tax = taxShare(row.amountMinor, row.wholeMinor, row.wholeTaxMinor);
  let status = "";
  if (row.voided) status = voidWords(row);
  else if (!refund && row.refundedMinor > 0)
    status = row.refundedMinor >= row.amountMinor ? PAYMENTS_DOWNLOAD_WORDS.refunded : PAYMENTS_DOWNLOAD_WORDS.part_refunded;
  const reasons = row.kind === "refund" ? REFUND_REASON_WORDS : SALE_REFUND_REASON_WORDS;
  return {
    on: row.on,
    receipt: row.receipt,
    type: PAYMENT_LINE_KIND_WORDS[row.kind],
    person: personWords(row),
    details: detailsWords(row),
    forReceipt: refund ? row.forReceipt : null,
    refundReason: refund ? (lookup(reasons, row.refundReason) ?? "") : "",
    method: MEMBER_PAYMENT_METHOD_WORDS[row.method],
    amountMinor: sign * row.amountMinor,
    taxMinor: row.voided ? 0 : sign * tax,
    countedMinor: row.voided ? 0 : sign * row.amountMinor,
    status,
    by: row.by ?? "",
  };
}

/** The file's name: "Payments 1 Oct 2026 – 31 Oct 2026.xlsx", one day's, or every day's to today. */
export function paymentsFileName(from: string, to: string, everyDay: boolean): string {
  if (everyDay) return `All payments to ${dayWords(to)}.xlsx`;
  return from === to ? `Payments ${dayWords(from)}.xlsx` : `Payments ${dayWords(from)} – ${dayWords(to)}.xlsx`;
}
