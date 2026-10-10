// The statements that read and write a gym's bills, payments and refunds (spec Part 3
// §14.2; ROADMAP 18a-i and 18a-ii). With `billsRepo.ts` and the give in `heldRepo.ts`,
// the only files that touch the three tables.
//
// Every statement carries `gym_id` in its WHERE. A write runs in its caller's
// transaction, under the gym's lock and the record's.
import type { Sql, TransactionSql } from "postgres";
import {
  billCancelReasonSchema,
  memberBillStatusSchema,
  memberPaymentByHandSchema,
  memberPaymentMethodSchema,
  refundReasonSchema,
  type BillCancelReason,
  type MemberBillStatus,
  type MemberPaymentByHand,
  type MemberPaymentMethod,
  type RefundReason,
} from "@app/shared";

export interface BillRow {
  id: string;
  membershipId: string;
  periodIndex: number;
  amountMinor: number;
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

/** Every bill of the memberships named, each with what has been paid against it. */
export async function billsFor(sql: Sql | TransactionSql, gymId: string, membershipIds: readonly string[]): Promise<BillRow[]> {
  if (membershipIds.length === 0) return [];
  const rows = await sql<RawBill[]>`
    SELECT b.id, b.held_membership_id, b.period_index, b.amount_minor, b.currency,
           b.due_on::text AS due_on, b.covers_from::text AS covers_from, b.covers_to::text AS covers_to, b.status,
           COALESCE((SELECT sum(p.amount_minor) FROM gym_member_payments p
                     WHERE p.gym_id = b.gym_id AND p.bill_id = b.id AND p.undone_at IS NULL), 0)::int AS paid_minor,
           COALESCE((SELECT sum(r.amount_minor) FROM gym_member_refunds r
                     JOIN gym_member_payments p ON p.gym_id = r.gym_id AND p.id = r.payment_id
                     WHERE r.gym_id = b.gym_id AND p.bill_id = b.id AND p.undone_at IS NULL AND r.undone_at IS NULL), 0)::int AS refunded_minor,
           b.void_reason, b.voided_on::text AS voided_on, v.display_name AS voided_by_name
    FROM gym_member_bills b
    LEFT JOIN users v ON v.id = b.voided_by
    WHERE b.gym_id = ${gymId} AND b.held_membership_id = ANY(${[...membershipIds]}::uuid[])
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
}

/** The payments that stand on the memberships named, in the order they were recorded. */
export async function paymentsFor(sql: Sql | TransactionSql, gymId: string, membershipIds: readonly string[]): Promise<PaymentRow[]> {
  if (membershipIds.length === 0) return [];
  const rows = await sql<
    { id: string; bill_id: string; held_membership_id: string; period_index: number; seq: string; amount_minor: number; method: string; paid_on: string; by: string | null; refunded_minor: number }[]
  >`
    SELECT p.id, p.bill_id, b.held_membership_id, b.period_index, p.seq::text AS seq, p.amount_minor, p.method,
           p.paid_on::text AS paid_on, u.display_name AS by,
           COALESCE((SELECT sum(r.amount_minor) FROM gym_member_refunds r
                     WHERE r.gym_id = p.gym_id AND r.payment_id = p.id AND r.undone_at IS NULL), 0)::int AS refunded_minor
    FROM gym_member_payments p
    JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
    LEFT JOIN users u ON u.id = p.recorded_by
    WHERE p.gym_id = ${gymId} AND b.held_membership_id = ANY(${[...membershipIds]}::uuid[]) AND p.undone_at IS NULL
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
}

/** The refunds that stand against the standing payments of the memberships named, in the
 *  order they were noted. */
export async function refundsFor(sql: Sql | TransactionSql, gymId: string, membershipIds: readonly string[]): Promise<RefundRow[]> {
  if (membershipIds.length === 0) return [];
  const rows = await sql<
    { id: string; payment_id: string; held_membership_id: string; amount_minor: number; method: string; refunded_on: string; reason: string; by: string | null }[]
  >`
    SELECT r.id, r.payment_id, b.held_membership_id, r.amount_minor, r.method, r.refunded_on::text AS refunded_on, r.reason,
           u.display_name AS by
    FROM gym_member_refunds r
    JOIN gym_member_payments p ON p.gym_id = r.gym_id AND p.id = r.payment_id
    JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
    LEFT JOIN users u ON u.id = r.recorded_by
    WHERE r.gym_id = ${gymId} AND b.held_membership_id = ANY(${[...membershipIds]}::uuid[])
      AND r.undone_at IS NULL AND p.undone_at IS NULL
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
  }));
}

/** For the Members list: each current record with a bill still open that fell due on or
 *  before `today`, and the earliest such day, whichever of its memberships the bill is
 *  for (one that is over too). Asked of the records named, or of the whole gym (null). */
export async function owedSinceByEntry(
  sql: Sql | TransactionSql,
  gymId: string,
  today: string,
  entryIds: readonly string[] | null,
): Promise<Map<string, string>> {
  if (entryIds !== null && entryIds.length === 0) return new Map();
  const ids = entryIds === null ? null : [...entryIds];
  const rows = await sql<{ entry_id: string; since: string }[]>`
    SELECT h.entry_id, min(b.due_on)::text AS since
    FROM gym_member_bills b
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    WHERE b.gym_id = ${gymId} AND b.status = 'open' AND b.due_on <= ${today}::date
      AND (${ids}::uuid[] IS NULL OR h.entry_id = ANY(${ids}::uuid[]))
    GROUP BY h.entry_id`;
  return new Map(rows.map((r) => [r.entry_id, r.since]));
}

export interface NewBill {
  membershipId: string;
  periodIndex: number;
  amountMinor: number;
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
  const payload = bills.map((b) => ({ m: b.membershipId, i: b.periodIndex, a: b.amountMinor, c: b.currency, d: b.dueOn, f: b.covers?.from ?? null, t: b.covers?.to ?? null }));
  const rows = await tx<{ id: string; held_membership_id: string; period_index: number }[]>`
    INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, covers_from, covers_to, created_at, updated_at)
    SELECT ${gymId}, r.m, r.i, r.a, r.c, r.d, r.f, r.t, ${now}, ${now}
    FROM jsonb_to_recordset(${tx.json(payload)}) AS r(m uuid, i int, a int, c text, d date, f date, t date)
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

/** Notes a refund. Null where this request is already noted: nothing is added. */
export async function insertRefund(tx: TransactionSql, r: NewRefund, now: Date): Promise<string | null> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO gym_member_refunds
      (gym_id, payment_id, amount_minor, currency, method, reason, request_key, refunded_on, recorded_by, created_at)
    VALUES (${r.gymId}, ${r.paymentId}, ${r.amountMinor}, ${r.currency}, ${r.method}, ${r.reason}, ${r.requestKey},
            ${r.refundedOn}::date, ${r.recordedBy}, ${now})
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

/** Records a payment. Null where this request, or this payment of a company's, is
 *  already recorded: nothing is added. */
export async function insertPayment(tx: TransactionSql, p: NewPayment, now: Date): Promise<string | null> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO gym_member_payments
      (gym_id, bill_id, amount_minor, currency, method, provider, provider_payment_id, request_key, paid_on, recorded_by, created_at)
    VALUES (${p.gymId}, ${p.billId}, ${p.amountMinor}, ${p.currency}, ${p.method}, ${p.provider?.name ?? null},
            ${p.provider?.paymentId ?? null}, ${p.requestKey}, ${p.paidOn}::date, ${p.recordedBy}, ${now})
    ON CONFLICT DO NOTHING
    RETURNING id`;
  return row?.id ?? null;
}

/** How many days after its due date this gym's unpaid bill reads Overdue. */
export async function overdueDaysOf(sql: Sql | TransactionSql, gymId: string): Promise<number> {
  const [row] = await sql<{ bills_overdue_days: number }[]>`SELECT bills_overdue_days FROM gyms WHERE id = ${gymId}`;
  return row?.bills_overdue_days ?? 0;
}

export async function setOverdueDays(tx: TransactionSql, gymId: string, days: number): Promise<void> {
  await tx`UPDATE gyms SET bills_overdue_days = ${days} WHERE id = ${gymId}`;
}
