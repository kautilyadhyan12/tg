// A FEE FOR A LATE CANCEL OR A NO-SHOW (spec Part 3 §14.2; ROADMAP 18h-i, and 18h-ii for
// personal training).
//
// The worst thing this could do to a real person: put a fee on somebody who came, or on
// somebody else's bills. So a fee is opened only for a booking that IS late-cancelled or a
// no-show as the write that made it so commits (read again here, under the gym's lock that
// write holds), only on the membership that booking itself used, and it is taken off by
// itself, unpaid, when staff change the no-show to came or the class does not run. Whether
// it costs anything is `classFeeFor`'s to say. A personal training session is held to the
// same: a fee only for a session that IS late-cancelled or a no-show, on the membership the
// session itself used, taken off unpaid when staff mark them came, with the session's own
// two amounts (`openPtFees`, `removePtFees`).
//
// A fee is a bill of its own (`gym_member_bills`, no period, `0136`): paid all at once, with
// a receipt, or waived by staff. It never moves a membership's dates or its count of paid
// periods, and the period rules never read it (`billsFor` and the rest read periods alone).
// With `billsSql.ts` and `billsRepo.ts`, the only files that write the bills.
import type { Sql, TransactionSql } from "postgres";
import {
  classFeeFor,
  memberBillStatusSchema,
  memberFeeKindSchema,
  memberPaymentMethodSchema,
  paymentVoidReasonSchema,
  type ClassFees,
  type MemberBillStatus,
  type MemberFeeKind,
  type MemberPaymentByHand,
  type MemberPaymentMethod,
  type PaymentVoidReason,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { fullName } from "../leaderboard/rank.js";
import { insertAudit } from "../repo.js";
import { lockedEntry } from "./heldRepo.js";
import { billOf, insertPayment, type BillTax, type Voided } from "./billsSql.js";

const STATUS_FOR: Record<MemberFeeKind, "late_cancelled" | "no_show"> = { late_cancel: "late_cancelled", no_show: "no_show" };

/** In a statement that names a fee's bill `b`: its booking is still the late cancel or the
 *  no-show it was opened for, in a class that runs, or its personal training session still
 *  is (18h-ii). False once staff marked them came, the class was cancelled or removed, or
 *  the booking or session is gone. */
const stillOwedSql = (sql: Sql | TransactionSql) => sql`
  (EXISTS (SELECT 1 FROM gym_class_bookings k
           JOIN gym_class_sessions s ON s.gym_id = k.gym_id AND s.id = k.session_id
           WHERE k.gym_id = b.gym_id AND k.id = b.class_booking_id AND s.status = 'scheduled'
             AND k.status = CASE b.fee WHEN 'late_cancel' THEN 'late_cancelled' ELSE 'no_show' END)
   OR EXISTS (SELECT 1 FROM gym_pt_appointments a
              WHERE a.gym_id = b.gym_id AND a.id = b.pt_appointment_id
                AND a.status = CASE b.fee WHEN 'late_cancel' THEN 'late_cancelled' ELSE 'no_show' END))`;

/** The class fees of a gym, as the database holds them. */
export async function classFeesOf(sql: Sql | TransactionSql, gymId: string): Promise<ClassFees> {
  const [row] = await sql<{ late: number; no_show: number }[]>`
    SELECT class_late_cancel_fee_minor AS late, class_no_show_fee_minor AS no_show FROM gyms WHERE id = ${gymId}`;
  return row === undefined ? { lateCancelMinor: 0, noShowMinor: 0 } : { lateCancelMinor: row.late, noShowMinor: row.no_show };
}

export async function setClassFees(tx: TransactionSql, gymId: string, fees: ClassFees): Promise<void> {
  await tx`
    UPDATE gyms SET class_late_cancel_fee_minor = ${fees.lateCancelMinor}, class_no_show_fee_minor = ${fees.noShowMinor}
    WHERE id = ${gymId}`;
}

/** THESE BOOKINGS WERE JUST LATE-CANCELLED, OR MARKED NO-SHOW: each opens its fee where the
 *  rule says it costs something. In the caller's transaction, under the gym's lock, after
 *  the booking's own write. A booking already holding a fee that stands, or one staff
 *  waived, opens none: the same press twice, a run and a mark together, or a no-show
 *  marked again after a waive, are one fee or none. Answers how many it opened. */
export async function openClassFees(tx: TransactionSql, gymId: string, bookingIds: readonly string[], fee: MemberFeeKind, now: Date): Promise<number> {
  if (bookingIds.length === 0) return 0;
  const rows = await tx<
    {
      id: string;
      held_membership_id: string | null;
      pack_charged: boolean;
      currency: string;
      tax_name: string | null;
      tax_bp: number | null;
      class_name: string;
      class_day: string;
      timezone: string;
      late: number;
      no_show: number;
    }[]
  >`
    SELECT b.id, b.held_membership_id, b.pack_charged, h.currency, r.name AS tax_name, r.rate_bp AS tax_bp,
           left(t.name, 80) AS class_name, s.local_date::text AS class_day, g.timezone,
           g.class_late_cancel_fee_minor AS late, g.class_no_show_fee_minor AS no_show
    FROM gym_class_bookings b
    JOIN gyms g ON g.id = b.gym_id
    JOIN gym_class_sessions s ON s.gym_id = b.gym_id AND s.id = b.session_id
    JOIN gym_class_types t ON t.gym_id = s.gym_id AND t.id = s.class_type_id
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id AND h.entry_id IS NOT NULL
    LEFT JOIN gym_tax_rates r ON r.gym_id = h.gym_id AND r.id = h.tax_rate_id
    WHERE b.gym_id = ${gymId} AND b.id = ANY(${[...bookingIds]}::uuid[]) AND b.status = ${STATUS_FOR[fee]}
      AND NOT EXISTS (SELECT 1 FROM gym_member_bills x
                      WHERE x.gym_id = b.gym_id AND x.class_booking_id = b.id AND (x.status <> 'void' OR x.void_reason = 'waived'))`;
  const opening = rows.flatMap((row) => {
    const minor = classFeeFor({ fee, heldMembershipId: row.held_membership_id, packCharged: row.pack_charged, fees: { lateCancelMinor: row.late, noShowMinor: row.no_show } });
    if (minor === 0 || row.held_membership_id === null) return [];
    // The amount the gym set is what the person pays: the membership's rate is inside it.
    const tax = row.tax_name === null || row.tax_bp === null ? null : { name: row.tax_name, bp: row.tax_bp, included: true };
    const bill = billOf(minor, tax);
    return [
      {
        m: row.held_membership_id,
        b: row.id,
        a: bill.amountMinor,
        tm: bill.tax?.minor ?? 0,
        tb: bill.tax?.bp ?? 0,
        tn: bill.tax?.name ?? null,
        ti: bill.tax?.included ?? null,
        c: row.currency,
        d: dayInTz(now, row.timezone),
        day: row.class_day,
        n: row.class_name,
      },
    ];
  });
  if (opening.length === 0) return 0;
  const opened = await tx<{ id: string }[]>`
    INSERT INTO gym_member_bills
      (gym_id, held_membership_id, period_index, fee, fee_for, class_booking_id, amount_minor, tax_minor, tax_bp, tax_name, tax_included,
       currency, due_on, covers_from, covers_to, created_at, updated_at)
    SELECT ${gymId}, r.m, NULL, ${fee}, r.n, r.b, r.a, r.tm, r.tb, r.tn, r.ti, r.c, r.d, r.day, r.day, ${now}, ${now}
    FROM jsonb_to_recordset(${tx.json(opening)}) AS r(m uuid, b uuid, a int, tm int, tb int, tn text, ti boolean, c text, d date, day date, n text)
    ON CONFLICT (class_booking_id) WHERE class_booking_id IS NOT NULL AND status <> 'void' DO NOTHING
    RETURNING id`;
  if (opened.length > 0) {
    await insertAudit(tx, {
      actorUserId: null,
      gymId,
      action: "org.member_fees_opened",
      targetType: "gym",
      targetId: gymId,
      meta: { fee, bills: String(opened.length) },
    });
  }
  return opened.length;
}

/** THESE BOOKINGS NO LONGER OWE A FEE: marked came after a no-show, or their class did not
 *  run. An unpaid fee is taken off, kept and marked; one paid stays paid, for staff to void
 *  its payment if they mean to. In the caller's transaction, under the gym's lock. Answers
 *  how many it took off. */
export async function removeClassFees(tx: TransactionSql, gymId: string, bookingIds: readonly string[], now: Date): Promise<number> {
  if (bookingIds.length === 0) return 0;
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_member_bills SET status = 'void', updated_at = ${now}
    WHERE gym_id = ${gymId} AND class_booking_id = ANY(${[...bookingIds]}::uuid[]) AND status = 'open'
    RETURNING id`;
  if (rows.length > 0) {
    await insertAudit(tx, {
      actorUserId: null,
      gymId,
      action: "org.member_fees_removed",
      targetType: "gym",
      targetId: gymId,
      meta: { bills: String(rows.length) },
    });
  }
  return rows.length;
}

// ── Personal training (18h-ii) ──────────────────────────────────────────────

/** Personal training's two fees of a gym, as the database holds them. */
export async function ptFeesOf(sql: Sql | TransactionSql, gymId: string): Promise<ClassFees> {
  const [row] = await sql<{ late: number; no_show: number }[]>`
    SELECT pt_late_cancel_fee_minor AS late, pt_no_show_fee_minor AS no_show FROM gyms WHERE id = ${gymId}`;
  return row === undefined ? { lateCancelMinor: 0, noShowMinor: 0 } : { lateCancelMinor: row.late, noShowMinor: row.no_show };
}

/** What a session's fee is called on the person's page, a receipt and a download:
 *  "Personal training with Ravi", or without a name where the trainer has none or is gone. */
export function ptFeeFor(trainer: { displayName: string | null; email: string | null } | null): string {
  const name = trainer === null || trainer.displayName === null ? null : fullName({ displayName: trainer.displayName, email: trainer.email, recordName: null }).name;
  return (name === null ? "Personal training" : `Personal training with ${name}`).slice(0, 80);
}

/** THESE SESSIONS WERE JUST LATE-CANCELLED, OR MARKED NO-SHOW: each opens its fee where the
 *  rule says it costs something, as `openClassFees` does for a class. In the caller's
 *  transaction, under the gym's lock, after the session's own write. A session already
 *  holding a fee that stands, or one staff waived, opens none. Answers how many it opened. */
export async function openPtFees(tx: TransactionSql, gymId: string, appointmentIds: readonly string[], fee: MemberFeeKind, now: Date): Promise<number> {
  if (appointmentIds.length === 0) return 0;
  const rows = await tx<
    {
      id: string;
      held_membership_id: string | null;
      pack_charged: boolean;
      currency: string;
      tax_name: string | null;
      tax_bp: number | null;
      trainer_name: string | null;
      trainer_email: string | null;
      day: string;
      timezone: string;
      late: number;
      no_show: number;
    }[]
  >`
    SELECT a.id, a.held_membership_id, a.pack_charged, h.currency, r.name AS tax_name, r.rate_bp AS tax_bp,
           u.display_name AS trainer_name, u.email::text AS trainer_email, a.local_date::text AS day, g.timezone,
           g.pt_late_cancel_fee_minor AS late, g.pt_no_show_fee_minor AS no_show
    FROM gym_pt_appointments a
    JOIN gyms g ON g.id = a.gym_id
    JOIN gym_held_memberships h ON h.gym_id = a.gym_id AND h.id = a.held_membership_id AND h.entry_id IS NOT NULL
    LEFT JOIN gym_tax_rates r ON r.gym_id = h.gym_id AND r.id = h.tax_rate_id
    LEFT JOIN users u ON u.id = a.trainer_user_id
    WHERE a.gym_id = ${gymId} AND a.id = ANY(${[...appointmentIds]}::uuid[]) AND a.status = ${STATUS_FOR[fee]}
      AND NOT EXISTS (SELECT 1 FROM gym_member_bills x
                      WHERE x.gym_id = a.gym_id AND x.pt_appointment_id = a.id AND (x.status <> 'void' OR x.void_reason = 'waived'))`;
  const opening = rows.flatMap((row) => {
    const minor = classFeeFor({ fee, heldMembershipId: row.held_membership_id, packCharged: row.pack_charged, fees: { lateCancelMinor: row.late, noShowMinor: row.no_show } });
    if (minor === 0 || row.held_membership_id === null) return [];
    // The amount the gym set is what the person pays: the membership's rate is inside it.
    const tax = row.tax_name === null || row.tax_bp === null ? null : { name: row.tax_name, bp: row.tax_bp, included: true };
    const bill = billOf(minor, tax);
    return [
      {
        m: row.held_membership_id,
        s: row.id,
        a: bill.amountMinor,
        tm: bill.tax?.minor ?? 0,
        tb: bill.tax?.bp ?? 0,
        tn: bill.tax?.name ?? null,
        ti: bill.tax?.included ?? null,
        c: row.currency,
        d: dayInTz(now, row.timezone),
        day: row.day,
        n: ptFeeFor(row.trainer_name === null ? null : { displayName: row.trainer_name, email: row.trainer_email }),
      },
    ];
  });
  if (opening.length === 0) return 0;
  const opened = await tx<{ id: string }[]>`
    INSERT INTO gym_member_bills
      (gym_id, held_membership_id, period_index, fee, fee_for, pt_appointment_id, amount_minor, tax_minor, tax_bp, tax_name, tax_included,
       currency, due_on, covers_from, covers_to, created_at, updated_at)
    SELECT ${gymId}, r.m, NULL, ${fee}, r.n, r.s, r.a, r.tm, r.tb, r.tn, r.ti, r.c, r.d, r.day, r.day, ${now}, ${now}
    FROM jsonb_to_recordset(${tx.json(opening)}) AS r(m uuid, s uuid, a int, tm int, tb int, tn text, ti boolean, c text, d date, day date, n text)
    ON CONFLICT (pt_appointment_id) WHERE pt_appointment_id IS NOT NULL AND status <> 'void' DO NOTHING
    RETURNING id`;
  if (opened.length > 0) {
    await insertAudit(tx, {
      actorUserId: null,
      gymId,
      action: "org.member_fees_opened",
      targetType: "gym",
      targetId: gymId,
      meta: { fee, bills: String(opened.length), of: "pt" },
    });
  }
  return opened.length;
}

/** THESE SESSIONS NO LONGER OWE A FEE: marked came after a no-show. An unpaid fee is taken
 *  off, kept and marked; one paid stays paid, for staff to void its payment if they mean to. */
export async function removePtFees(tx: TransactionSql, gymId: string, appointmentIds: readonly string[], now: Date): Promise<number> {
  if (appointmentIds.length === 0) return 0;
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_member_bills SET status = 'void', updated_at = ${now}
    WHERE gym_id = ${gymId} AND pt_appointment_id = ANY(${[...appointmentIds]}::uuid[]) AND status = 'open'
    RETURNING id`;
  if (rows.length > 0) {
    await insertAudit(tx, {
      actorUserId: null,
      gymId,
      action: "org.member_fees_removed",
      targetType: "gym",
      targetId: gymId,
      meta: { bills: String(rows.length), of: "pt" },
    });
  }
  return rows.length;
}

/** THESE CLASSES WILL NOT RUN: every unpaid fee of a booking of theirs comes off. */
export async function removeClassFeesOf(tx: TransactionSql, gymId: string, sessionIds: readonly string[], now: Date): Promise<number> {
  if (sessionIds.length === 0) return 0;
  const rows = await tx<{ id: string }[]>`
    SELECT b.id FROM gym_class_bookings b
    WHERE b.gym_id = ${gymId} AND b.session_id = ANY(${[...sessionIds]}::uuid[])`;
  return await removeClassFees(tx, gymId, rows.map((row) => row.id), now);
}

// ── A person's page ─────────────────────────────────────────────────────────

export interface FeeRow {
  id: string;
  membershipId: string;
  fee: MemberFeeKind;
  /** A class's fee, or a personal training session's. */
  of: "class" | "pt";
  forName: string;
  on: string;
  amountMinor: number;
  tax: BillTax | null;
  currency: string;
  dueOn: string;
  status: MemberBillStatus;
  waived: { on: string; by: string | null } | null;
  /** Its booking still counts as the late cancel or no-show it was opened for. */
  stillOwed: boolean;
}

export interface FeePaymentRow {
  id: string;
  billId: string;
  amountMinor: number;
  method: MemberPaymentMethod;
  paidOn: string;
  by: string | null;
  receiptNumber: number;
  /** Null for one that stands. */
  voided: Voided<PaymentVoidReason> | null;
}

/** How many settled fees (paid or waived) a membership's box shows, newest first; every
 *  unpaid one is shown however many there are. */
export const SETTLED_FEES_SHOWN = 50;

/** The fees of the memberships named that a person's page shows, newest first: every
 *  unpaid one and the newest settled ones (`SETTLED_FEES_SHOWN`), with their payments,
 *  standing and voided. One taken off by itself is shown only where it ever had a payment. */
export async function feesFor(sql: Sql | TransactionSql, gymId: string, membershipIds: readonly string[]): Promise<{ fees: FeeRow[]; payments: FeePaymentRow[] }> {
  if (membershipIds.length === 0) return { fees: [], payments: [] };
  const ids = [...membershipIds];
  const fees = await sql<
    {
      id: string;
      held_membership_id: string;
      fee: string;
      fee_for: string;
      covers_from: string;
      amount_minor: number;
      tax_minor: number;
      tax_bp: number;
      tax_name: string | null;
      tax_included: boolean | null;
      currency: string;
      due_on: string;
      status: string;
      void_reason: string | null;
      voided_on: string | null;
      voided_by_name: string | null;
      still_owed: boolean;
      of_pt: boolean;
    }[]
  >`
    SELECT x.id, x.held_membership_id, x.fee, x.fee_for, x.of_pt, x.covers_from, x.amount_minor, x.tax_minor, x.tax_bp,
           x.tax_name, x.tax_included, x.currency, x.due_on, x.status, x.void_reason, x.voided_on, v.display_name AS voided_by_name, x.still_owed
    FROM (
      SELECT b.id, b.held_membership_id, b.fee, b.fee_for, b.covers_from::text AS covers_from, b.amount_minor, b.tax_minor, b.tax_bp,
             b.tax_name, b.tax_included, b.currency, b.due_on::text AS due_on, b.status, b.void_reason, b.voided_on::text AS voided_on,
             b.voided_by, b.created_at, ${stillOwedSql(sql)} AS still_owed, b.pt_appointment_id IS NOT NULL AS of_pt,
             row_number() OVER (PARTITION BY b.held_membership_id, b.status = 'open' ORDER BY b.created_at DESC, b.id) AS n
      FROM gym_member_bills b
      WHERE b.gym_id = ${gymId} AND b.held_membership_id = ANY(${ids}::uuid[]) AND b.fee IS NOT NULL
        AND (b.status <> 'void' OR b.void_reason = 'waived'
             OR EXISTS (SELECT 1 FROM gym_member_payments q WHERE q.gym_id = b.gym_id AND q.bill_id = b.id))
    ) x
    LEFT JOIN users v ON v.id = x.voided_by
    WHERE x.status = 'open' OR x.n <= ${SETTLED_FEES_SHOWN}
    ORDER BY x.created_at DESC, x.id`;
  const billIds = fees.map((r) => r.id);
  type RawFeePayment = {
    id: string;
    bill_id: string;
    amount_minor: number;
    method: string;
    paid_on: string;
    by: string | null;
    receipt_number: number;
    undone: boolean;
    void_reason: string | null;
    voided_on: string | null;
    voided_by: string | null;
  };
  const payments =
    billIds.length === 0
      ? []
      : await sql<RawFeePayment[]>`
        SELECT p.id, p.bill_id, p.amount_minor, p.method, p.paid_on::text AS paid_on, u.display_name AS by, p.receipt_number,
               p.undone_at IS NOT NULL AS undone, p.void_reason, (p.undone_at AT TIME ZONE g.timezone)::date::text AS voided_on,
               v.display_name AS voided_by
        FROM gym_member_payments p
        JOIN gyms g ON g.id = p.gym_id
        LEFT JOIN users u ON u.id = p.recorded_by
        LEFT JOIN users v ON v.id = p.undone_by
        WHERE p.gym_id = ${gymId} AND p.bill_id = ANY(${billIds}::uuid[])
        ORDER BY p.seq`;
  return {
    fees: fees.map((r) => ({
      id: r.id,
      membershipId: r.held_membership_id,
      // Text under a CHECK: parsed, so a kind this build does not know fails here.
      fee: memberFeeKindSchema.parse(r.fee),
      of: r.of_pt ? "pt" : "class",
      forName: r.fee_for,
      on: r.covers_from,
      amountMinor: r.amount_minor,
      tax: r.tax_name === null || r.tax_included === null ? null : { name: r.tax_name, bp: r.tax_bp, included: r.tax_included, minor: r.tax_minor },
      currency: r.currency,
      dueOn: r.due_on,
      status: memberBillStatusSchema.parse(r.status),
      waived: r.void_reason === "waived" && r.voided_on !== null ? { on: r.voided_on, by: r.voided_by_name } : null,
      stillOwed: r.still_owed,
    })),
    payments: payments.map((r) => ({
      id: r.id,
      billId: r.bill_id,
      amountMinor: r.amount_minor,
      method: memberPaymentMethodSchema.parse(r.method),
      paidOn: r.paid_on,
      by: r.by,
      receiptNumber: r.receipt_number,
      voided:
        r.undone && r.voided_on !== null
          ? { reason: r.void_reason === null ? null : paymentVoidReasonSchema.parse(r.void_reason), on: r.voided_on, by: r.voided_by }
          : null,
    })),
  };
}

// ── Staff settle a fee ──────────────────────────────────────────────────────

export type FeeWriteOutcome =
  | { kind: "ok" }
  | { kind: "entry_not_found" }
  | { kind: "fee_not_found" }
  | { kind: "payment_not_found" }
  | { kind: "request_reused" }
  /** A past member's payment is voided only once they are back on the list, as a period's is. */
  | { kind: "past_member" }
  /** The fee is paid, waived or taken off, or is not the amount the screen showed. */
  | { kind: "fee_changed" };

/** One fee of one membership of one record, held to the commit; null where it is not theirs. */
async function lockedFee(
  tx: TransactionSql,
  input: { gymId: string; entryId: string; membershipId: string; billId: string },
): Promise<{ id: string; status: MemberBillStatus; amount_minor: number; currency: string; fee: string } | null> {
  const [row] = await tx<{ id: string; status: string; amount_minor: number; currency: string; fee: string }[]>`
    SELECT b.id, b.status, b.amount_minor, b.currency, b.fee
    FROM gym_member_bills b
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    WHERE b.gym_id = ${input.gymId} AND b.id = ${input.billId} AND b.held_membership_id = ${input.membershipId}
      AND h.entry_id = ${input.entryId} AND b.fee IS NOT NULL
    FOR UPDATE OF b`;
  return row === undefined ? null : { ...row, status: memberBillStatusSchema.parse(row.status) };
}

/** Staff record that a fee was paid, all of it, with a receipt. The same request twice is
 *  one payment. */
export async function recordFeePayment(
  sql: Sql,
  input: {
    gymId: string;
    entryId: string;
    membershipId: string;
    billId: string;
    requestKey: string;
    amountMinor: number;
    method: MemberPaymentByHand;
    today: string;
    actorUserId: string;
    now: Date;
  },
): Promise<FeeWriteOutcome> {
  return await sql.begin(async (tx): Promise<FeeWriteOutcome> => {
    if ((await lockedEntry(tx, input.gymId, input.entryId)) === null) return { kind: "entry_not_found" };
    const [byKey] = await tx<{ bill_id: string; amount_minor: number; method: string; undone: boolean }[]>`
      SELECT bill_id, amount_minor, method, undone_at IS NOT NULL AS undone
      FROM gym_member_payments WHERE gym_id = ${input.gymId} AND request_key = ${input.requestKey}`;
    if (byKey !== undefined) {
      const same = byKey.bill_id === input.billId && byKey.amount_minor === input.amountMinor && byKey.method === input.method && !byKey.undone;
      return same ? { kind: "ok" } : { kind: "request_reused" };
    }
    const fee = await lockedFee(tx, input);
    if (fee === null) return { kind: "fee_not_found" };
    if (fee.status !== "open" || fee.amount_minor !== input.amountMinor) return { kind: "fee_changed" };
    const recorded = await insertPayment(
      tx,
      {
        gymId: input.gymId,
        billId: fee.id,
        amountMinor: fee.amount_minor,
        currency: fee.currency,
        method: input.method,
        requestKey: input.requestKey,
        paidOn: input.today,
        recordedBy: input.actorUserId,
        provider: null,
      },
      input.now,
    );
    if (recorded === null) throw new Error("a fee's payment was not recorded under the gym's lock");
    const paymentId = recorded.id;
    await tx`UPDATE gym_member_bills SET status = 'paid', updated_at = ${input.now} WHERE gym_id = ${input.gymId} AND id = ${fee.id}`;
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.member_fee_paid",
      targetType: "gym_member_payment",
      targetId: paymentId,
      meta: {
        entryId: input.entryId,
        membershipId: input.membershipId,
        billId: fee.id,
        fee: fee.fee,
        amountMinor: String(fee.amount_minor),
        currency: fee.currency,
        method: input.method,
        ...(recorded.paidByName === null ? {} : { paidBy: recorded.paidByName }),
      },
    });
    return { kind: "ok" };
  });
}

/** Staff waive an unpaid fee: the person no longer owes it. Kept, marked with who and when.
 *  Pressed twice, waived once. */
export async function waiveFee(
  sql: Sql,
  input: { gymId: string; entryId: string; membershipId: string; billId: string; today: string; actorUserId: string; now: Date },
): Promise<FeeWriteOutcome> {
  return await sql.begin(async (tx): Promise<FeeWriteOutcome> => {
    if ((await lockedEntry(tx, input.gymId, input.entryId)) === null) return { kind: "entry_not_found" };
    const fee = await lockedFee(tx, input);
    if (fee === null) return { kind: "fee_not_found" };
    const [waived] = await tx<{ waived: boolean }[]>`
      SELECT void_reason = 'waived' AS waived FROM gym_member_bills WHERE gym_id = ${input.gymId} AND id = ${fee.id}`;
    if (waived?.waived === true) return { kind: "ok" };
    if (fee.status !== "open") return { kind: "fee_changed" };
    await tx`
      UPDATE gym_member_bills
      SET status = 'void', void_reason = 'waived', voided_on = ${input.today}::date, voided_by = ${input.actorUserId}, updated_at = ${input.now}
      WHERE gym_id = ${input.gymId} AND id = ${fee.id} AND status = 'open'`;
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.member_fee_waived",
      targetType: "gym_member_bill",
      targetId: fee.id,
      meta: { entryId: input.entryId, membershipId: input.membershipId, fee: fee.fee, amountMinor: String(fee.amount_minor), currency: fee.currency },
    });
    return { kind: "ok" };
  });
}

/** Staff void the payment of a fee, recorded by mistake: the fee is owed again, where its
 *  booking or session is still the late cancel or no-show it was for; where staff have since
 *  marked them came or the class did not run, it is taken off instead, so nobody who came owes it. The
 *  row is kept, marked with who, when and why. Pressed twice, voided once. */
export async function voidFeePayment(
  sql: Sql,
  input: { gymId: string; entryId: string; membershipId: string; billId: string; paymentId: string; reason: PaymentVoidReason; actorUserId: string; now: Date },
): Promise<FeeWriteOutcome> {
  return await sql.begin(async (tx): Promise<FeeWriteOutcome> => {
    const entry = await lockedEntry(tx, input.gymId, input.entryId);
    if (entry === null) return { kind: "entry_not_found" };
    const fee = await lockedFee(tx, input);
    if (fee === null) return { kind: "fee_not_found" };
    const [payment] = await tx<{ undone: boolean; amount_minor: number }[]>`
      SELECT undone_at IS NOT NULL AS undone, amount_minor FROM gym_member_payments
      WHERE gym_id = ${input.gymId} AND id = ${input.paymentId} AND bill_id = ${fee.id}`;
    if (payment === undefined) return { kind: "payment_not_found" };
    if (payment.undone) return { kind: "ok" };
    if (entry.past) return { kind: "past_member" };
    await tx`
      UPDATE gym_member_payments SET undone_at = ${input.now}, undone_by = ${input.actorUserId}, void_reason = ${input.reason}
      WHERE gym_id = ${input.gymId} AND id = ${input.paymentId} AND undone_at IS NULL`;
    await tx`
      UPDATE gym_member_bills b SET status = CASE WHEN ${stillOwedSql(tx)} THEN 'open' ELSE 'void' END, updated_at = ${input.now}
      WHERE b.gym_id = ${input.gymId} AND b.id = ${fee.id} AND b.status = 'paid'`;
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.member_fee_payment_voided",
      targetType: "gym_member_payment",
      targetId: input.paymentId,
      meta: { entryId: input.entryId, membershipId: input.membershipId, billId: fee.id, fee: fee.fee, amountMinor: String(payment.amount_minor), currency: fee.currency, reason: input.reason },
    });
    return { kind: "ok" };
  });
}
