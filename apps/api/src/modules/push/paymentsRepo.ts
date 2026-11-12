// PAYMENT RECEIVED, FOR THE PHONE (ROADMAP Stage 5 item 20h): the only file that reads or clears what a paid page in the
// app is owed (`push_due_at`, migration 0236) for sending. The page's recording writes it (`appPaymentsRepo.recordPaid`,
// `appPurchasesRepo.recordBought`) when nobody was asking; the member's own phone reading the page takes it off
// (`paidSeen`); the worker sends it here.
import type { Sql, TransactionSql } from "postgres";
import { memberFeeKindSchema, type PaymentPaidFor } from "@app/shared";
import { boughtOf } from "../orgs/payments/appPurchasesRepo.js";

type SqlOrTx = Sql | TransactionSql;

export interface DuePayment {
  id: string;
  gymId: string;
  gymName: string;
  /** The member's account that pressed Pay; null once that account is gone. */
  userId: string | null;
  amountMinor: number;
  currency: string;
  /** What it paid for; null where it can no longer be read (a membership or line deleted since). */
  paidFor: PaymentPaidFor | null;
  /** When it became owed, to the microsecond, as text: the run pages on from it. */
  dueAt: string;
  /** Owed for longer than a notification is told for: taken off with no send. */
  stale: boolean;
}

export interface DuePaymentMark {
  at: string;
  id: string;
}

/** One page of the payments owed a notification and not taken by a run still sending, oldest first, after `after`. */
export async function duePayments(
  sql: SqlOrTx,
  input: { since: Date; claimedBefore: Date; limit: number; after: DuePaymentMark | null; gymIds?: readonly string[] | undefined },
): Promise<DuePayment[]> {
  const { since, claimedBefore, limit, after, gymIds } = input;
  const gyms = gymIds === undefined ? null : [...gymIds];
  const rows = await sql<
    {
      id: string;
      gym_id: string;
      gym_name: string;
      opened_by: string | null;
      amount_minor: number;
      taken_minor: number | null;
      currency: string;
      bought: unknown;
      membership_type_id: string | null;
      fee: string | null;
      type_name: string | null;
      due_at: string;
      stale: boolean;
    }[]
  >`
    SELECT a.id, a.gym_id, g.name AS gym_name, a.opened_by, a.amount_minor, a.taken_minor, a.currency, a.bought,
           a.membership_type_id,
           (SELECT b.fee FROM gym_member_bills b WHERE b.gym_id = a.gym_id AND b.id = a.fee_bill_id) AS fee,
           (SELECT t.name FROM gym_held_memberships h
              JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
             WHERE h.gym_id = a.gym_id AND h.id = a.held_membership_id) AS type_name,
           a.push_due_at::text AS due_at, a.push_due_at < ${since} AS stale
    FROM gym_app_payments a
    JOIN gyms g ON g.id = a.gym_id
    WHERE a.push_due_at IS NOT NULL AND (a.push_claimed_at IS NULL OR a.push_claimed_at < ${claimedBefore})
      AND (${gyms}::uuid[] IS NULL OR a.gym_id = ANY(${gyms}::uuid[]))
      ${after === null ? sql`` : sql`AND (a.push_due_at, a.id) > (${after.at}::timestamptz, ${after.id}::uuid)`}
    ORDER BY a.push_due_at, a.id
    LIMIT ${limit}`;
  return rows.map((r) => {
    // A fee's kind is text under a CHECK: parsed, so one this build does not know names nothing.
    const fee = r.fee === null ? null : memberFeeKindSchema.safeParse(r.fee);
    const bought = r.membership_type_id === null ? null : (boughtOf({ typeId: r.membership_type_id, bought: r.bought })?.typeName ?? null);
    const paidFor: PaymentPaidFor | null = r.membership_type_id !== null
      ? bought === null
        ? null
        : { kind: "bought", name: bought }
      : fee !== null
        ? fee.success
          ? { kind: "fee", fee: fee.data }
          : null
        : r.type_name === null
          ? null
          : { kind: "membership", name: r.type_name };
    return {
      id: r.id,
      gymId: r.gym_id,
      gymName: r.gym_name,
      userId: r.opened_by,
      // What Square took from the card, where it named it in the page's money; else what the page asked.
      amountMinor: r.taken_minor ?? r.amount_minor,
      currency: r.currency,
      paidFor,
      dueAt: r.due_at,
      stale: r.stale,
    };
  });
}

/** Taken by this run: false where another run took it first, or the member's phone read it meanwhile. */
export async function claimPayment(sql: SqlOrTx, p: Pick<DuePayment, "gymId" | "id">, input: { claimedAt: Date; claimedBefore: Date }): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_app_payments SET push_claimed_at = ${input.claimedAt}
    WHERE gym_id = ${p.gymId} AND id = ${p.id} AND push_due_at IS NOT NULL
      AND (push_claimed_at IS NULL OR push_claimed_at < ${input.claimedBefore})
    RETURNING id`;
  return rows.length === 1;
}

/** Firebase did not answer: put back for the next run, unless another run has taken it since. */
export async function unclaimPayment(sql: SqlOrTx, p: Pick<DuePayment, "gymId" | "id">, claimedAt: Date): Promise<void> {
  await sql`UPDATE gym_app_payments SET push_claimed_at = NULL WHERE gym_id = ${p.gymId} AND id = ${p.id} AND push_claimed_at = ${claimedAt}`;
}

/** Sent, or nothing true to send (stale, switched off, no phone signed in): owed no more. */
export async function settlePayment(sql: SqlOrTx, p: Pick<DuePayment, "gymId" | "id">, claimedAt: Date): Promise<void> {
  await sql`UPDATE gym_app_payments SET push_due_at = NULL, push_claimed_at = NULL WHERE gym_id = ${p.gymId} AND id = ${p.id} AND push_claimed_at = ${claimedAt}`;
}
