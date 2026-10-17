// The statements that read and write a gym's bills, payments and refunds (spec Part 3
// §14.2; ROADMAP 18a-i and 18a-ii; the day's takings for the Sell page, 18b-i). With `billsRepo.ts`, `feesRepo.ts` and the give in `heldRepo.ts`,
// the only files that touch the three tables.
//
// A late cancel or no-show fee (18h-i) is a bill with no period. What a membership's periods
// are worked out from reads periods alone (`billsFor` to `voidedRefundsFor`); what counts
// money owed or taken reads fees too.
//
// Every statement carries `gym_id` in its WHERE. A write runs in its caller's
// transaction, under the gym's lock and the record's.
import type { Sql, TransactionSql } from "postgres";
import { nextReceipt } from "../receipts/repo.js";
import {
  billAmounts,
  billCancelReasonSchema,
  MEMBER_FEE_WORDS,
  feeItemName,
  memberFeeKindSchema,
  memberBillStatusSchema,
  memberPaymentByHandSchema,
  memberPaymentMethodSchema,
  paymentVoidReasonSchema,
  refundReasonSchema,
  refundVoidReasonSchema,
  type BillCancelReason,
  type MemberBillStatus,
  type MemberPaymentByHand,
  type MemberPaymentMethod,
  type PaymentVoidReason,
  type RefundReason,
  type RefundVoidReason,
  type TaxApplied,
} from "@app/shared";

/** What a bill is for, in a statement that names its bill `b` and its membership's type
 *  `t`: the type's name, or a fee's own (`feeItemName`, 18h-i). */
export const billItemSql = (sql: Sql | TransactionSql) => sql`
  CASE b.fee WHEN 'late_cancel' THEN ${MEMBER_FEE_WORDS.late_cancel}::text || ' · ' || b.fee_for
             WHEN 'no_show' THEN ${MEMBER_FEE_WORDS.no_show}::text || ' · ' || b.fee_for
             ELSE t.name END`;

/** The tax inside a bill's amount, as it was opened (18b-iii). */
export interface BillTax {
  name: string;
  bp: number;
  included: boolean;
  minor: number;
}

/** WHAT ONE BILL IS OPENED AT: its price after any discount (`listedMinor`), with the tax
 *  of the rate its membership was sold with, by the one rule (`billAmounts`). A taxed
 *  price is capped where it is set (`TAXED_PRICE_MINOR_MAX`), so a bill that does not fit
 *  is a fault, never a bill. */
export function billOf(listedMinor: number, tax: TaxApplied | null): { amountMinor: number; tax: BillTax | null } {
  const amounts = billAmounts(listedMinor, tax);
  if (!amounts.ok) throw new Error(`a bill could not be worked out: ${amounts.reason}`);
  return { amountMinor: amounts.totalMinor, tax: tax === null ? null : { name: tax.name, bp: tax.bp, included: tax.included, minor: amounts.taxMinor } };
}

export interface BillRow {
  id: string;
  membershipId: string;
  periodIndex: number;
  amountMinor: number;
  /** The tax in `amountMinor`, as it was opened; null for none. */
  tax: BillTax | null;
  currency: string;
  dueOn: string;
  /** The days it was opened for; null for a membership of one period. */
  covers: { from: string; to: string } | null;
  status: MemberBillStatus;
  /** The payments that stand, added up. */
  paidMinor: number;
  /** The refunds that stand against those payments, added up. */
  refundedMinor: number;
  /** Where staff cancelled it: why, on which of the gym's days, and who (null where
   *  they have since left the app). Null on any other bill. */
  cancelled: { reason: BillCancelReason; on: string; by: string | null } | null;
}

interface RawBill {
  id: string;
  held_membership_id: string;
  period_index: number;
  amount_minor: number;
  tax_minor: number;
  tax_bp: number;
  tax_name: string | null;
  tax_included: boolean | null;
  currency: string;
  due_on: string;
  covers_from: string | null;
  covers_to: string | null;
  status: string;
  paid_minor: number;
  refunded_minor: number;
  void_reason: string | null;
  voided_on: string | null;
  voided_by_name: string | null;
}

const bill = (r: RawBill): BillRow => ({
  id: r.id,
  membershipId: r.held_membership_id,
  periodIndex: r.period_index,
  amountMinor: r.amount_minor,
  tax: r.tax_name === null || r.tax_included === null ? null : { name: r.tax_name, bp: r.tax_bp, included: r.tax_included, minor: r.tax_minor },
  currency: r.currency,
  dueOn: r.due_on,
  covers: r.covers_from === null || r.covers_to === null ? null : { from: r.covers_from, to: r.covers_to },
  // Text under a CHECK: parsed, so a status this build does not know fails here.
  status: memberBillStatusSchema.parse(r.status),
  paidMinor: r.paid_minor,
  refundedMinor: r.refunded_minor,
  cancelled:
    r.void_reason === null || r.voided_on === null ? null : { reason: billCancelReasonSchema.parse(r.void_reason), on: r.voided_on, by: r.voided_by_name },
});

/** Every bill of a period of the memberships named, each with what has been paid against it. */
export async function billsFor(sql: Sql | TransactionSql, gymId: string, membershipIds: readonly string[]): Promise<BillRow[]> {
  if (membershipIds.length === 0) return [];
  const rows = await sql<RawBill[]>`
    SELECT b.id, b.held_membership_id, b.period_index, b.amount_minor, b.tax_minor, b.tax_bp, b.tax_name, b.tax_included, b.currency,
           b.due_on::text AS due_on, b.covers_from::text AS covers_from, b.covers_to::text AS covers_to, b.status,
           COALESCE((SELECT sum(p.amount_minor) FROM gym_member_payments p
                     WHERE p.gym_id = b.gym_id AND p.bill_id = b.id AND p.undone_at IS NULL), 0)::int AS paid_minor,
           COALESCE((SELECT sum(r.amount_minor) FROM gym_member_refunds r
                     JOIN gym_member_payments p ON p.gym_id = r.gym_id AND p.id = r.payment_id
                     WHERE r.gym_id = b.gym_id AND p.bill_id = b.id AND p.undone_at IS NULL AND r.undone_at IS NULL), 0)::int AS refunded_minor,
           b.void_reason, b.voided_on::text AS voided_on, v.display_name AS voided_by_name
    FROM gym_member_bills b
    LEFT JOIN users v ON v.id = b.voided_by
    WHERE b.gym_id = ${gymId} AND b.held_membership_id = ANY(${[...membershipIds]}::uuid[]) AND b.period_index IS NOT NULL
    ORDER BY b.held_membership_id, b.period_index DESC`;
  return rows.map(bill);
}

export interface PaymentRow {
  id: string;
  billId: string;
  membershipId: string;
  periodIndex: number;
  seq: number;
  amountMinor: number;
  method: MemberPaymentMethod;
  paidOn: string;
  /** Who recorded it; null where they have since left the app. */
  by: string | null;
  /** The refunds that stand against it, added up. */
  refundedMinor: number;
  receiptNumber: number;
}

/** The payments that stand on the periods of the memberships named, in the order they were recorded. */
export async function paymentsFor(sql: Sql | TransactionSql, gymId: string, membershipIds: readonly string[]): Promise<PaymentRow[]> {
  if (membershipIds.length === 0) return [];
  const rows = await sql<
    { id: string; bill_id: string; held_membership_id: string; period_index: number; seq: string; amount_minor: number; method: string; paid_on: string; by: string | null; refunded_minor: number; receipt_number: number }[]
  >`
    SELECT p.id, p.bill_id, b.held_membership_id, b.period_index, p.seq::text AS seq, p.amount_minor, p.method,
           p.paid_on::text AS paid_on, u.display_name AS by, p.receipt_number,
           COALESCE((SELECT sum(r.amount_minor) FROM gym_member_refunds r
                     WHERE r.gym_id = p.gym_id AND r.payment_id = p.id AND r.undone_at IS NULL), 0)::int AS refunded_minor
    FROM gym_member_payments p
    JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
    LEFT JOIN users u ON u.id = p.recorded_by
    WHERE p.gym_id = ${gymId} AND b.held_membership_id = ANY(${[...membershipIds]}::uuid[]) AND p.undone_at IS NULL AND b.period_index IS NOT NULL
    ORDER BY p.seq`;
  return rows.map((r) => ({
    id: r.id,
    billId: r.bill_id,
    membershipId: r.held_membership_id,
    periodIndex: r.period_index,
    seq: Number(r.seq),
    amountMinor: r.amount_minor,
    method: memberPaymentMethodSchema.parse(r.method),
    paidOn: r.paid_on,
    by: r.by,
    refundedMinor: r.refunded_minor,
    receiptNumber: r.receipt_number,
  }));
}

export interface RefundRow {
  id: string;
  paymentId: string;
  membershipId: string;
  amountMinor: number;
  method: MemberPaymentByHand;
  refundedOn: string;
  reason: RefundReason;
  by: string | null;
  receiptNumber: number;
}

/** The refunds that stand against the standing payments of the memberships named, in the
 *  order they were noted. */
export async function refundsFor(sql: Sql | TransactionSql, gymId: string, membershipIds: readonly string[]): Promise<RefundRow[]> {
  if (membershipIds.length === 0) return [];
  const rows = await sql<
    { id: string; payment_id: string; held_membership_id: string; amount_minor: number; method: string; refunded_on: string; reason: string; by: string | null; receipt_number: number }[]
  >`
    SELECT r.id, r.payment_id, b.held_membership_id, r.amount_minor, r.method, r.refunded_on::text AS refunded_on, r.reason,
           u.display_name AS by, r.receipt_number
    FROM gym_member_refunds r
    JOIN gym_member_payments p ON p.gym_id = r.gym_id AND p.id = r.payment_id
    JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
    LEFT JOIN users u ON u.id = r.recorded_by
    WHERE r.gym_id = ${gymId} AND b.held_membership_id = ANY(${[...membershipIds]}::uuid[])
      AND r.undone_at IS NULL AND p.undone_at IS NULL AND b.period_index IS NOT NULL
    ORDER BY r.created_at, r.id`;
  return rows.map((r) => ({
    id: r.id,
    paymentId: r.payment_id,
    membershipId: r.held_membership_id,
    amountMinor: r.amount_minor,
    method: memberPaymentByHandSchema.parse(r.method),
    refundedOn: r.refunded_on,
    reason: refundReasonSchema.parse(r.reason),
    by: r.by,
    receiptNumber: r.receipt_number,
  }));
}

/** Who voided a row, on the gym's own day, and why: null for a reason before 0126. */
export interface Voided<R> {
  reason: R | null;
  on: string;
  by: string | null;
}

export type VoidedPaymentRow = Omit<PaymentRow, "refundedMinor"> & { voided: Voided<PaymentVoidReason> };
export type VoidedRefundRow = RefundRow & { voided: Voided<RefundVoidReason> };

/** The payments staff voided on the memberships named (18o), in the order they were
 *  recorded: for the person's page alone, which shows them struck through. Nothing that
 *  counts money reads this. */
export async function voidedPaymentsFor(sql: Sql | TransactionSql, gymId: string, membershipIds: readonly string[]): Promise<VoidedPaymentRow[]> {
  if (membershipIds.length === 0) return [];
  const rows = await sql<
    {
      id: string;
      bill_id: string;
      held_membership_id: string;
      period_index: number;
      seq: string;
      amount_minor: number;
      method: string;
      paid_on: string;
      by: string | null;
      receipt_number: number;
      void_reason: string | null;
      voided_on: string;
      voided_by: string | null;
    }[]
  >`
    SELECT p.id, p.bill_id, b.held_membership_id, b.period_index, p.seq::text AS seq, p.amount_minor, p.method,
           p.paid_on::text AS paid_on, u.display_name AS by, p.receipt_number, p.void_reason,
           (p.undone_at AT TIME ZONE g.timezone)::date::text AS voided_on, v.display_name AS voided_by
    FROM gym_member_payments p
    JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
    JOIN gyms g ON g.id = p.gym_id
    LEFT JOIN users u ON u.id = p.recorded_by
    LEFT JOIN users v ON v.id = p.undone_by
    WHERE p.gym_id = ${gymId} AND b.held_membership_id = ANY(${[...membershipIds]}::uuid[]) AND p.undone_at IS NOT NULL AND b.period_index IS NOT NULL
    ORDER BY p.seq`;
  return rows.map((r) => ({
    id: r.id,
    billId: r.bill_id,
    membershipId: r.held_membership_id,
    periodIndex: r.period_index,
    seq: Number(r.seq),
    amountMinor: r.amount_minor,
    method: memberPaymentMethodSchema.parse(r.method),
    paidOn: r.paid_on,
    by: r.by,
    receiptNumber: r.receipt_number,
    voided: { reason: r.void_reason === null ? null : paymentVoidReasonSchema.parse(r.void_reason), on: r.voided_on, by: r.voided_by },
  }));
}

/** The refunds staff voided on the memberships named (18o), against any of their payments,
 *  in the order they were noted: for the person's page alone, as above. */
export async function voidedRefundsFor(sql: Sql | TransactionSql, gymId: string, membershipIds: readonly string[]): Promise<VoidedRefundRow[]> {
  if (membershipIds.length === 0) return [];
  const rows = await sql<
    {
      id: string;
      payment_id: string;
      held_membership_id: string;
      amount_minor: number;
      method: string;
      refunded_on: string;
      reason: string;
      by: string | null;
      receipt_number: number;
      void_reason: string | null;
      voided_on: string;
      voided_by: string | null;
    }[]
  >`
    SELECT r.id, r.payment_id, b.held_membership_id, r.amount_minor, r.method, r.refunded_on::text AS refunded_on, r.reason,
           u.display_name AS by, r.receipt_number, r.void_reason,
           (r.undone_at AT TIME ZONE g.timezone)::date::text AS voided_on, v.display_name AS voided_by
    FROM gym_member_refunds r
    JOIN gym_member_payments p ON p.gym_id = r.gym_id AND p.id = r.payment_id
    JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
    JOIN gyms g ON g.id = r.gym_id
    LEFT JOIN users u ON u.id = r.recorded_by
    LEFT JOIN users v ON v.id = r.undone_by
    WHERE r.gym_id = ${gymId} AND b.held_membership_id = ANY(${[...membershipIds]}::uuid[]) AND r.undone_at IS NOT NULL AND b.period_index IS NOT NULL
    ORDER BY r.created_at, r.id`;
  return rows.map((r) => ({
    id: r.id,
    paymentId: r.payment_id,
    membershipId: r.held_membership_id,
    amountMinor: r.amount_minor,
    method: memberPaymentByHandSchema.parse(r.method),
    refundedOn: r.refunded_on,
    reason: refundReasonSchema.parse(r.reason),
    by: r.by,
    receiptNumber: r.receipt_number,
    voided: { reason: r.void_reason === null ? null : refundVoidReasonSchema.parse(r.void_reason), on: r.voided_on, by: r.voided_by },
  }));
}

/** What the Members list reads of the bills, one statement, for the records named or for
 *  the whole gym (null):
 *  - `owedSince`: each record with a bill still open that fell due on or before `today`,
 *    and the earliest such day, whichever of its memberships the bill is for (one that
 *    is over too), a fee's among them (18h-i);
 *  - `notCharged`: the memberships with no money kept for their newest period counted
 *    as paid: its bill was cancelled by staff, or refunded in full. */
export async function listBillFacts(
  sql: Sql | TransactionSql,
  gymId: string,
  today: string,
  entryIds: readonly string[] | null,
): Promise<{ owedSince: Map<string, string>; notCharged: Set<string> }> {
  const facts = { owedSince: new Map<string, string>(), notCharged: new Set<string>() };
  if (entryIds !== null && entryIds.length === 0) return facts;
  const ids = entryIds === null ? null : [...entryIds];
  const rows = await sql<{ entry_id: string; id: string; since: string | null; not_charged: boolean }[]>`
    SELECT h.entry_id, h.id,
           min(b.due_on) FILTER (WHERE b.status = 'open')::text AS since,
           COALESCE(bool_or(b.status <> 'open' AND b.period_index = h.paid_periods - 1), false) AS not_charged
    FROM gym_member_bills b
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    WHERE b.gym_id = ${gymId}
      AND ((b.status = 'open' AND b.due_on <= ${today}::date) OR (b.status = 'void' AND b.void_reason IS NOT NULL) OR b.status = 'refunded')
      AND (${ids}::uuid[] IS NULL OR h.entry_id = ANY(${ids}::uuid[]))
    GROUP BY h.entry_id, h.id`;
  for (const row of rows) {
    const had = facts.owedSince.get(row.entry_id);
    if (row.since !== null && (had === undefined || row.since < had)) facts.owedSince.set(row.entry_id, row.since);
    if (row.not_charged) facts.notCharged.add(row.id);
  }
  return facts;
}

export interface NewBill {
  membershipId: string;
  periodIndex: number;
  /** What the person pays, its tax in (`billOf`). */
  amountMinor: number;
  tax: BillTax | null;
  currency: string;
  dueOn: string;
  covers: { from: string; to: string } | null;
}

/** Opens bills, one statement. A period that already has a bill is left as it is, so two
 *  runs at one instant open one; the answer is the bills this call opened. */
export async function insertBills(
  tx: TransactionSql,
  gymId: string,
  bills: readonly NewBill[],
  now: Date,
): Promise<{ id: string; membershipId: string; periodIndex: number }[]> {
  if (bills.length === 0) return [];
  const payload = bills.map((b) => ({
    m: b.membershipId,
    i: b.periodIndex,
    a: b.amountMinor,
    tm: b.tax?.minor ?? 0,
    tb: b.tax?.bp ?? 0,
    tn: b.tax?.name ?? null,
    ti: b.tax?.included ?? null,
    c: b.currency,
    d: b.dueOn,
    f: b.covers?.from ?? null,
    t: b.covers?.to ?? null,
  }));
  const rows = await tx<{ id: string; held_membership_id: string; period_index: number }[]>`
    INSERT INTO gym_member_bills
      (gym_id, held_membership_id, period_index, amount_minor, tax_minor, tax_bp, tax_name, tax_included, currency, due_on, covers_from, covers_to, created_at, updated_at)
    SELECT ${gymId}, r.m, r.i, r.a, r.tm, r.tb, r.tn, r.ti, r.c, r.d, r.f, r.t, ${now}, ${now}
    FROM jsonb_to_recordset(${tx.json(payload)}) AS r(m uuid, i int, a int, tm int, tb int, tn text, ti boolean, c text, d date, f date, t date)
    ON CONFLICT (held_membership_id, period_index) DO NOTHING
    RETURNING id, held_membership_id, period_index`;
  return rows.map((r) => ({ id: r.id, membershipId: r.held_membership_id, periodIndex: r.period_index }));
}

export async function setBillStatus(tx: TransactionSql, gymId: string, billId: string, status: MemberBillStatus, now: Date): Promise<void> {
  await tx`
    UPDATE gym_member_bills SET status = ${status}, updated_at = ${now}
    WHERE gym_id = ${gymId} AND id = ${billId}`;
}

/** Cancels open bills with their membership (`billsAtCancel`): they are kept, marked. */
export async function voidBills(tx: TransactionSql, gymId: string, billIds: readonly string[], now: Date): Promise<void> {
  if (billIds.length === 0) return;
  await tx`
    UPDATE gym_member_bills SET status = 'void', updated_at = ${now}
    WHERE gym_id = ${gymId} AND id = ANY(${[...billIds]}::uuid[]) AND status = 'open'`;
}

/** The gym's past members who still owe: a bill of theirs is open and has fallen due on
 *  or before `today`. With each, the two words of the gym's own list that still describe
 *  them, folded as the list's filter folds them; their Payment word is "Payment due". */
export async function pastOwing(
  sql: Sql | TransactionSql,
  gymId: string,
  today: string,
): Promise<{ entryId: string; status: string; membershipType: string }[]> {
  const rows = await sql<{ id: string; status: string; membership_type: string }[]>`
    SELECT e.id, lower(coalesce(e.status, '')) AS status, lower(coalesce(e.membership_type, '')) AS membership_type
    FROM gym_member_list_entries e
    WHERE e.gym_id = ${gymId} AND e.former_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM gym_member_bills b
        JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
        WHERE b.gym_id = e.gym_id AND h.entry_id = e.id AND b.status = 'open' AND b.due_on <= ${today}::date
      )`;
  return rows.map((r) => ({ entryId: r.id, status: r.status, membershipType: r.membership_type }));
}

/** Staff cancel one open bill: kept, marked, with who, when and why. False where it was
 *  no longer open. */
export async function cancelBill(
  tx: TransactionSql,
  input: { gymId: string; billId: string; reason: BillCancelReason; on: string; by: string; now: Date },
): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_member_bills
    SET status = 'void', void_reason = ${input.reason}, voided_on = ${input.on}::date, voided_by = ${input.by}, updated_at = ${input.now}
    WHERE gym_id = ${input.gymId} AND id = ${input.billId} AND status = 'open'
    RETURNING id`;
  return rows.length === 1;
}

export interface NewRefund {
  gymId: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  method: MemberPaymentByHand;
  reason: RefundReason;
  requestKey: string;
  /** The gym's own day. */
  refundedOn: string;
  recordedBy: string;
}

/** Notes a refund, with the gym's next receipt number (18g-i). Null where this request is
 *  already noted: nothing is added. */
export async function insertRefund(tx: TransactionSql, r: NewRefund, now: Date): Promise<string | null> {
  const [row] = await tx<{ id: string }[]>`
    WITH n AS (${nextReceipt(tx, r.gymId)})
    INSERT INTO gym_member_refunds
      (gym_id, payment_id, amount_minor, currency, method, reason, request_key, refunded_on, recorded_by, created_at, receipt_number)
    SELECT ${r.gymId}, ${r.paymentId}, ${r.amountMinor}, ${r.currency}, ${r.method}, ${r.reason}, ${r.requestKey},
           ${r.refundedOn}::date, ${r.recordedBy}, ${now}, n.number
    FROM n
    ON CONFLICT DO NOTHING
    RETURNING id`;
  return row?.id ?? null;
}

export interface NewPayment {
  gymId: string;
  billId: string;
  amountMinor: number;
  currency: string;
  method: MemberPaymentMethod;
  requestKey: string;
  /** The gym's own day. */
  paidOn: string;
  recordedBy: string | null;
  /** A payment company's own id for this payment (18d). */
  provider: { name: string; paymentId: string } | null;
}

/** Records a payment, with the gym's next receipt number (18g-i). Null where this request,
 *  or this payment of a company's, is already recorded: nothing is added. */
export async function insertPayment(tx: TransactionSql, p: NewPayment, now: Date): Promise<string | null> {
  const [row] = await tx<{ id: string }[]>`
    WITH n AS (${nextReceipt(tx, p.gymId)})
    INSERT INTO gym_member_payments
      (gym_id, bill_id, amount_minor, currency, method, provider, provider_payment_id, request_key, paid_on, recorded_by, created_at, receipt_number)
    SELECT ${p.gymId}, ${p.billId}, ${p.amountMinor}, ${p.currency}, ${p.method}, ${p.provider?.name ?? null},
           ${p.provider?.paymentId ?? null}, ${p.requestKey}, ${p.paidOn}::date, ${p.recordedBy}, ${now}, n.number
    FROM n
    ON CONFLICT DO NOTHING
    RETURNING id`;
  return row?.id ?? null;
}

export interface DayPaymentRow {
  id: string;
  typeName: string;
  amountMinor: number;
  currency: string;
  method: MemberPaymentMethod;
  paidAt: Date;
  by: string | null;
  /** Null where the record was deleted for good since (18m). */
  entryId: string | null;
  personName: string | null;
  receiptNumber: number;
}

/** THE MEMBERSHIP PAYMENTS RECORDED ON ONE OF THE GYM'S DAYS that stand (18b-i: the Sell
 *  page's takings), newest first, with what they add up to by how they were paid and in
 *  which money, and the refunds noted that day. */
export async function paymentsOn(
  sql: Sql | TransactionSql,
  gymId: string,
  day: string,
  limit: number,
): Promise<{ payments: DayPaymentRow[]; count: number; sums: { method: MemberPaymentMethod; currency: string; count: number; totalMinor: number }[]; refunds: { currency: string; totalMinor: number }[] }> {
  const [rows, sums, refunds] = await Promise.all([
    sql<{ id: string; type_name: string; fee: string | null; fee_for: string | null; amount_minor: number; currency: string; method: string; created_at: Date; by: string | null; entry_id: string | null; full_name: string | null; receipt_number: number }[]>`
      SELECT p.id, t.name AS type_name, b.fee, b.fee_for, p.amount_minor, p.currency, p.method, p.created_at, u.display_name AS by, h.entry_id, e.full_name, p.receipt_number
      FROM gym_member_payments p
      JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
      LEFT JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
      LEFT JOIN users u ON u.id = p.recorded_by
      WHERE p.gym_id = ${gymId} AND p.paid_on = ${day}::date AND p.undone_at IS NULL
      ORDER BY p.seq DESC
      LIMIT ${limit}`,
    sql<{ method: string; currency: string; n: number; total: string }[]>`
      SELECT method, currency, count(*)::int AS n, sum(amount_minor)::text AS total
      FROM gym_member_payments
      WHERE gym_id = ${gymId} AND paid_on = ${day}::date AND undone_at IS NULL
      GROUP BY method, currency`,
    sql<{ currency: string; total: string }[]>`
      SELECT r.currency, sum(r.amount_minor)::text AS total
      FROM gym_member_refunds r
      JOIN gym_member_payments p ON p.gym_id = r.gym_id AND p.id = r.payment_id
      WHERE r.gym_id = ${gymId} AND r.refunded_on = ${day}::date AND r.undone_at IS NULL AND p.undone_at IS NULL
      GROUP BY r.currency`,
  ]);
  const count = sums.reduce((n, row) => n + row.n, 0);
  return {
    payments: rows.map((r) => ({
      id: r.id,
      // A fee is named for what it was for, never for the membership it is on.
      typeName: r.fee === null || r.fee_for === null ? r.type_name : feeItemName(memberFeeKindSchema.parse(r.fee), r.fee_for),
      amountMinor: r.amount_minor,
      currency: r.currency,
      method: memberPaymentMethodSchema.parse(r.method),
      paidAt: r.created_at,
      by: r.by,
      entryId: r.entry_id,
      personName: r.full_name,
      receiptNumber: r.receipt_number,
    })),
    count,
    // One money is never added to another: each sum says which it is in.
    sums: sums.map((row) => ({ method: memberPaymentMethodSchema.parse(row.method), currency: row.currency, count: row.n, totalMinor: Number(row.total) })),
    refunds: refunds.map((row) => ({ currency: row.currency, totalMinor: Number(row.total) })),
  };
}

/** How many days after its due date this gym's unpaid bill reads Overdue. */
export async function overdueDaysOf(sql: Sql | TransactionSql, gymId: string): Promise<number> {
  const [row] = await sql<{ bills_overdue_days: number }[]>`SELECT bills_overdue_days FROM gyms WHERE id = ${gymId}`;
  return row?.bills_overdue_days ?? 0;
}

export async function setOverdueDays(tx: TransactionSql, gymId: string, days: number): Promise<void> {
  await tx`UPDATE gyms SET bills_overdue_days = ${days} WHERE id = ${gymId}`;
}
