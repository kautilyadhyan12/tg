// The statements that read and write a gym's bills and payments (spec Part 3 §14.2;
// ROADMAP 18a-i). With `billsRepo.ts` and the give in `heldRepo.ts`, the only files
// that touch the two tables.
//
// Every statement carries `gym_id` in its WHERE. A write runs in its caller's
// transaction, under the gym's lock and the record's.
import type { Sql, TransactionSql } from "postgres";
import {
  memberBillStatusSchema,
  memberPaymentMethodSchema,
  type MemberBillStatus,
  type MemberPaymentMethod,
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
});

/** Every bill of the memberships named, each with what has been paid against it. */
export async function billsFor(sql: Sql | TransactionSql, gymId: string, membershipIds: readonly string[]): Promise<BillRow[]> {
  if (membershipIds.length === 0) return [];
  const rows = await sql<RawBill[]>`
    SELECT b.id, b.held_membership_id, b.period_index, b.amount_minor, b.currency,
           b.due_on::text AS due_on, b.covers_from::text AS covers_from, b.covers_to::text AS covers_to, b.status,
           COALESCE((SELECT sum(p.amount_minor) FROM gym_member_payments p
                     WHERE p.gym_id = b.gym_id AND p.bill_id = b.id AND p.undone_at IS NULL), 0)::int AS paid_minor
    FROM gym_member_bills b
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
}

/** The payments that stand on the memberships named, in the order they were recorded. */
export async function paymentsFor(sql: Sql | TransactionSql, gymId: string, membershipIds: readonly string[]): Promise<PaymentRow[]> {
  if (membershipIds.length === 0) return [];
  const rows = await sql<
    { id: string; bill_id: string; held_membership_id: string; period_index: number; seq: string; amount_minor: number; method: string; paid_on: string; by: string | null }[]
  >`
    SELECT p.id, p.bill_id, b.held_membership_id, b.period_index, p.seq::text AS seq, p.amount_minor, p.method,
           p.paid_on::text AS paid_on, u.display_name AS by
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
  }));
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
