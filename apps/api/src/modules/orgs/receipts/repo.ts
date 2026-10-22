// RECEIPTS (spec Part 3 §14.3; ROADMAP 18g-i): the gym's own numbers, and one receipt read
// from the row it is for. Every read carries the gym in its WHERE.
import type { PendingQuery, Row, Sql, TransactionSql } from "postgres";
import {
  billAmounts,
  memberPaymentByHandSchema,
  memberPaymentMethodSchema,
  receiptAmounts,
  receiptBalance,
  type PaymentReceipt,
  type RefundReceipt,
  type SaleReceipt,
} from "@app/shared";
import { billItemSql } from "../memberships/billsSql.js";

/** The gym's next receipt number, as the CTE `n` (`number`) of the statement that writes
 *  the payment, refund or sale it is for: the count and the row move together or not at
 *  all, and the gym's row lock takes two at one instant one after the other. THE ONE DOOR:
 *  the database keeps a number once in each of the four tables, not across them, so every
 *  writer of a payment, a refund or a sale takes its number here. */
export function nextReceipt(tx: TransactionSql, gymId: string): PendingQuery<Row[]> {
  return tx`UPDATE gyms SET receipts_issued = receipts_issued + 1 WHERE id = ${gymId} RETURNING receipts_issued AS number`;
}

/** A record with no name typed is still somebody: the receipt says so. */
const NO_NAME = "No name on their record";
const personName = (name: string | null): string => (name === null || name.trim() === "" ? NO_NAME : name);

/** A receipt as its row holds it: the gym's name and address are the caller's. */
export type ReceiptRow = Omit<SaleReceipt, "gym"> | Omit<PaymentReceipt, "gym"> | Omit<RefundReceipt, "gym">;

const taxOf = (r: { tax_bp: number; tax_name: string | null; tax_included: boolean | null; tax_minor: number }) =>
  r.tax_bp > 0 ? { name: r.tax_name, bp: r.tax_bp, included: r.tax_included === true, minor: r.tax_minor } : null;

const coversOf = (r: { covers_from: string | null; covers_to: string | null }) =>
  r.covers_from === null || r.covers_to === null ? null : { from: r.covers_from, to: r.covers_to };

/** A sale (18q): every line of it under its one number. */
async function saleReceipt(sql: Sql, gymId: string, number: number): Promise<ReceiptRow | null> {
  const rows = await sql<
    {
      id: string;
      item_name: string;
      quantity: number;
      unit_price_minor: number;
      tax_minor: number;
      total_minor: number;
      tax_bp: number;
      tax_name: string | null;
      tax_included: boolean;
      discount_name: string | null;
      discount_minor: number;
      currency: string;
      method: string;
      sold_on: string;
      by: string | null;
      entry_id: string | null;
      full_name: string | null;
      for_member: boolean;
      cancelled: boolean;
    }[]
  >`
    SELECT s.id, s.for_member, s.item_name, s.quantity, s.unit_price_minor, s.tax_minor, s.total_minor, s.tax_bp, s.tax_name, s.tax_included,
           s.discount_name, s.discount_minor, s.currency, s.method, s.sold_on::text AS sold_on, u.display_name AS by,
           s.entry_id, e.full_name, s.undone_at IS NOT NULL AS cancelled
    FROM gym_sales s
    LEFT JOIN gym_member_list_entries e ON e.gym_id = s.gym_id AND e.id = s.entry_id
    LEFT JOIN users u ON u.id = s.recorded_by
    WHERE s.gym_id = ${gymId} AND s.receipt_number = ${number}
    ORDER BY s.line_no`;
  const r = rows[0];
  if (r === undefined) return null;
  const refunds = await sql<{ receipt_number: number; refunded_on: string; amount_minor: number; item_name: string }[]>`
    SELECT f.receipt_number, f.refunded_on::text AS refunded_on, f.amount_minor, s.item_name
    FROM gym_sale_refunds f
    JOIN gym_sales s ON s.gym_id = f.gym_id AND s.id = f.sale_id
    WHERE f.gym_id = ${gymId} AND f.sale_id = ANY(${rows.map((line) => line.id)}::uuid[]) AND f.undone_at IS NULL
    ORDER BY f.receipt_number`;
  return {
    kind: "sale",
    number,
    on: r.sold_on,
    person: r.entry_id === null ? null : personName(r.full_name),
    // Sold to somebody whose record was deleted for good since: theirs, and nobody named.
    personDeleted: r.entry_id === null && r.for_member,
    paidBy: null,
    paidByDeleted: false,
    by: r.by,
    currency: r.currency,
    cancelled: r.cancelled,
    lines: rows.map((line) => ({
      name: line.item_name,
      quantity: line.quantity,
      unitPriceMinor: line.unit_price_minor,
      amounts: receiptAmounts({
        totalMinor: line.total_minor,
        listedMinor: line.unit_price_minor * line.quantity,
        tax: taxOf(line),
        discount: line.discount_name === null ? null : { name: line.discount_name, minor: line.discount_minor },
      }),
    })),
    totalMinor: rows.reduce((n, line) => n + line.total_minor, 0),
    // Text under a CHECK: parsed, so a method this build does not know fails here.
    method: memberPaymentByHandSchema.parse(r.method),
    refunds: refunds.map((f) => ({ number: f.receipt_number, on: f.refunded_on, amountMinor: f.amount_minor, item: rows.length > 1 ? f.item_name : null })),
  };
}

/** A refund of a sale at the desk (18p): what went back, for which sale's receipt. */
async function saleRefundReceipt(sql: Sql, gymId: string, number: number): Promise<ReceiptRow | null> {
  const [r] = await sql<
    {
      amount_minor: number;
      currency: string;
      method: string;
      refunded_on: string;
      cancelled: boolean;
      by: string | null;
      entry_id: string | null;
      full_name: string | null;
      for_member: boolean;
      item_name: string;
      for_receipt: number;
    }[]
  >`
    SELECT f.amount_minor, f.currency, f.method, f.refunded_on::text AS refunded_on,
           (f.undone_at IS NOT NULL OR s.undone_at IS NOT NULL) AS cancelled,
           u.display_name AS by, s.entry_id, e.full_name, s.for_member, s.item_name, s.receipt_number AS for_receipt
    FROM gym_sale_refunds f
    JOIN gym_sales s ON s.gym_id = f.gym_id AND s.id = f.sale_id
    LEFT JOIN gym_member_list_entries e ON e.gym_id = s.gym_id AND e.id = s.entry_id
    LEFT JOIN users u ON u.id = f.recorded_by
    WHERE f.gym_id = ${gymId} AND f.receipt_number = ${number}`;
  if (r === undefined) return null;
  return {
    kind: "refund",
    number,
    on: r.refunded_on,
    person: r.entry_id === null ? null : personName(r.full_name),
    personDeleted: r.entry_id === null && r.for_member,
    paidBy: null,
    paidByDeleted: false,
    by: r.by,
    currency: r.currency,
    cancelled: r.cancelled,
    forReceipt: r.for_receipt,
    item: { name: r.item_name, covers: null },
    refundedMinor: r.amount_minor,
    method: memberPaymentByHandSchema.parse(r.method),
  };
}

/** A membership bill's amounts as its receipt prints them. A membership sold with a discount
 *  (18b-ii-b) prints its full price and the discount on each bill the discount came off: with
 *  "every" its kept price is already after it, so the full price is that and the discount;
 *  with "first" its kept price is the full one, and the bill that came to the price less the
 *  discount, at the bill's own tax, is the one it came off. A bill opened at the full price
 *  prints no discount. */
function billReceiptAmounts(r: {
  bill_minor: number;
  joining_fee: number;
  tax_minor: number;
  tax_bp: number;
  tax_name: string | null;
  tax_included: boolean | null;
  held_price: number;
  discount_name: string | null;
  discount_minor: number;
  discount_payments: string | null;
}) {
  const tax = taxOf(r);
  const plain = receiptAmounts({ totalMinor: r.bill_minor, tax, discount: null });
  if (r.discount_name === null || r.discount_minor <= 0 || r.discount_payments === null) return plain;
  // A joining fee (18t) is listed with the membership's price, and no discount comes off it.
  const listed = (r.discount_payments === "every" ? r.held_price + r.discount_minor : r.held_price) + r.joining_fee;
  const applied = tax === null ? null : { name: tax.name ?? "", bp: tax.bp, included: tax.included };
  const came = billAmounts(listed - r.discount_minor, applied);
  if (!came.ok || came.totalMinor !== r.bill_minor) return plain;
  return receiptAmounts({ totalMinor: r.bill_minor, listedMinor: listed, tax, discount: { name: r.discount_name, minor: r.discount_minor } });
}

async function paymentReceipt(sql: Sql, gymId: string, number: number): Promise<ReceiptRow | null> {
  const [r] = await sql<
    {
      id: string;
      amount_minor: number;
      currency: string;
      method: string;
      paid_on: string;
      cancelled: boolean;
      by: string | null;
      full_name: string | null;
      person_deleted: boolean;
      paid_by_name: string | null;
      paid_by_deleted: boolean;
      type_name: string;
      bill_minor: number;
      joining_fee: number;
      covers_from: string | null;
      covers_to: string | null;
      tax_minor: number;
      tax_bp: number;
      tax_name: string | null;
      tax_included: boolean | null;
      paid_before: number;
      held_price: number;
      discount_name: string | null;
      discount_minor: number;
      discount_payments: string | null;
    }[]
  >`
    SELECT h.price_minor AS held_price, CASE WHEN b.fee IS NULL THEN h.discount_name END AS discount_name, h.discount_minor, h.discount_payments, p.id, p.amount_minor, p.currency, p.method, p.paid_on::text AS paid_on, p.undone_at IS NOT NULL AS cancelled,
           u.display_name AS by, e.full_name, (h.entry_id IS NULL) AS person_deleted, p.paid_by_name, p.paid_by_deleted, ${billItemSql(sql)} AS type_name,
           b.amount_minor AS bill_minor, b.joining_fee_minor AS joining_fee, b.covers_from::text AS covers_from, b.covers_to::text AS covers_to,
           b.tax_minor, b.tax_bp, b.tax_name, b.tax_included,
           COALESCE((SELECT sum(q.amount_minor) FROM gym_member_payments q
                     WHERE q.gym_id = p.gym_id AND q.bill_id = p.bill_id AND q.undone_at IS NULL AND q.seq < p.seq), 0)::int AS paid_before
    FROM gym_member_payments p
    JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    LEFT JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
    LEFT JOIN users u ON u.id = p.recorded_by
    WHERE p.gym_id = ${gymId} AND p.receipt_number = ${number}`;
  if (r === undefined) return null;
  const refunds = await sql<{ receipt_number: number; refunded_on: string; amount_minor: number }[]>`
    SELECT receipt_number, refunded_on::text AS refunded_on, amount_minor
    FROM gym_member_refunds
    WHERE gym_id = ${gymId} AND payment_id = ${r.id} AND undone_at IS NULL
    ORDER BY created_at, id`;
  return {
    kind: "payment",
    number,
    on: r.paid_on,
    person: r.person_deleted ? null : personName(r.full_name),
    personDeleted: r.person_deleted,
    paidBy: r.paid_by_name,
    paidByDeleted: r.paid_by_deleted,
    by: r.by,
    currency: r.currency,
    cancelled: r.cancelled,
    item: { name: r.type_name, covers: coversOf(r) },
    amounts: billReceiptAmounts(r),
    joiningFeeMinor: r.joining_fee,
    paidMinor: r.amount_minor,
    method: memberPaymentMethodSchema.parse(r.method),
    balance: receiptBalance(r.bill_minor, r.paid_before, r.amount_minor),
    refunds: refunds.map((f) => ({ number: f.receipt_number, on: f.refunded_on, amountMinor: f.amount_minor })),
  };
}

async function refundReceipt(sql: Sql, gymId: string, number: number): Promise<ReceiptRow | null> {
  const [r] = await sql<
    {
      amount_minor: number;
      currency: string;
      method: string;
      refunded_on: string;
      cancelled: boolean;
      by: string | null;
      full_name: string | null;
      person_deleted: boolean;
      paid_by_name: string | null;
      paid_by_deleted: boolean;
      type_name: string;
      covers_from: string | null;
      covers_to: string | null;
      for_receipt: number;
    }[]
  >`
    SELECT r.amount_minor, r.currency, r.method, r.refunded_on::text AS refunded_on,
           (r.undone_at IS NOT NULL OR p.undone_at IS NOT NULL) AS cancelled,
           u.display_name AS by, e.full_name, (h.entry_id IS NULL) AS person_deleted, p.paid_by_name, p.paid_by_deleted, ${billItemSql(sql)} AS type_name,
           b.covers_from::text AS covers_from, b.covers_to::text AS covers_to, p.receipt_number AS for_receipt
    FROM gym_member_refunds r
    JOIN gym_member_payments p ON p.gym_id = r.gym_id AND p.id = r.payment_id
    JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    LEFT JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
    LEFT JOIN users u ON u.id = r.recorded_by
    WHERE r.gym_id = ${gymId} AND r.receipt_number = ${number}`;
  if (r === undefined) return null;
  return {
    kind: "refund",
    number,
    on: r.refunded_on,
    person: r.person_deleted ? null : personName(r.full_name),
    personDeleted: r.person_deleted,
    // Given back to whoever paid it.
    paidBy: r.paid_by_name,
    paidByDeleted: r.paid_by_deleted,
    by: r.by,
    currency: r.currency,
    cancelled: r.cancelled,
    forReceipt: r.for_receipt,
    item: { name: r.type_name, covers: coversOf(r) },
    refundedMinor: r.amount_minor,
    method: memberPaymentByHandSchema.parse(r.method),
  };
}

/** The gym as its receipts head it: its name and the postal address it typed. */
export async function gymOnReceipt(sql: Sql, gymId: string): Promise<{ name: string; address: string | null } | null> {
  const [g] = await sql<{ name: string; postal_address: string | null }[]>`SELECT name, postal_address FROM gyms WHERE id = ${gymId}`;
  return g === undefined ? null : { name: g.name, address: g.postal_address };
}

/** One of the gym's receipts by its number, or null where the gym has none by it. A number
 *  is one row's in the gym: the four reads ask the four tables, and one answers. */
export async function readReceipt(sql: Sql, gymId: string, number: number): Promise<ReceiptRow | null> {
  const found = await Promise.all([
    saleReceipt(sql, gymId, number),
    paymentReceipt(sql, gymId, number),
    refundReceipt(sql, gymId, number),
    saleRefundReceipt(sql, gymId, number),
  ]);
  const rows = found.filter((r): r is ReceiptRow => r !== null);
  if (rows.length > 1) throw new Error("one receipt number is on two rows");
  return rows[0] ?? null;
}
