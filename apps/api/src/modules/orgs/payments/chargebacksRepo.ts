// What the app keeps of a chargeback (ROADMAP 18d-iv-e-i; `chargebacks.ts`). One row a dispute at a gym, unique by Square's id, holding
// what Square said last: an older answer arriving late never moves a newer one back.
import { chargebackReasonSchema, chargebackStateSchema, memberFeeKindSchema, type ChargebackReason, type ChargebackSeen, type ChargebackState, type ChargebackToAnswer, type MemberFeeKind } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { insertAudit } from "../repo.js";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

interface RawSeen {
  id: string;
  amount_minor: number;
  currency: string;
  state: string;
  reason: string | null;
  due_on: string | null;
  due_passed: boolean;
  brand: string | null;
  last4: string | null;
}

const seenOf = (r: RawSeen, now: { reason: ChargebackReason | null; state: ChargebackState }): ChargebackSeen => ({
  id: r.id,
  amountMinor: r.amount_minor,
  currency: r.currency,
  state: now.state,
  reason: now.reason,
  dueOn: r.due_on,
  duePassed: r.due_passed,
  card: r.brand === null || r.last4 === null ? null : { brand: r.brand, last4: r.last4 },
});
const seen = (r: RawSeen): ChargebackSeen => {
  const reason = chargebackReasonSchema.safeParse(r.reason);
  return seenOf(r, { state: chargebackStateSchema.parse(r.state), reason: reason.success ? reason.data : null });
};

const seenColumns = (sql: SqlOrTx, now: Date) => sql`
  q.id, q.amount_minor, q.currency, q.state, q.reason, q.brand, q.last4,
  (q.due_at AT TIME ZONE g.timezone)::date::text AS due_on, COALESCE(q.due_at <= ${now}, false) AS due_passed`;

/** The chargebacks that stop the app charging whoever pays for membership `h` by itself, for a NOT EXISTS: one on a payment of that
 *  membership, or of any membership the same person pays for, unless the gym won it or the bank closed its question. */
export const chargebackStops = (sql: SqlOrTx) => sql`
      SELECT 1 FROM gym_square_disputes q
      JOIN gym_member_payments pay ON pay.gym_id = q.gym_id AND pay.provider = 'square' AND pay.provider_payment_id = q.square_payment_id
      JOIN gym_member_bills paid ON paid.gym_id = pay.gym_id AND paid.id = pay.bill_id
      JOIN gym_held_memberships held ON held.gym_id = paid.gym_id AND held.id = paid.held_membership_id
      WHERE q.gym_id = h.gym_id AND q.state NOT IN ('WON','INQUIRY_CLOSED')
        AND (held.id = h.id
             OR COALESCE((SELECT x.payer_entry_id FROM gym_member_payers x WHERE x.gym_id = held.gym_id AND x.entry_id = held.entry_id), held.entry_id)
              = COALESCE((SELECT x.payer_entry_id FROM gym_member_payers x WHERE x.gym_id = h.gym_id AND x.entry_id = h.entry_id), h.entry_id))`;

/** Which of these memberships the app no longer charges by itself. */
export async function chargesStoppedOf(sql: SqlOrTx, gymId: string, membershipIds: readonly string[]): Promise<Set<string>> {
  if (membershipIds.length === 0) return new Set();
  const rows = await sql<{ id: string }[]>`
    SELECT h.id FROM gym_held_memberships h
    WHERE h.gym_id = ${gymId} AND h.id = ANY(${[...membershipIds]}::uuid[]) AND EXISTS (${chargebackStops(sql)})`;
  return new Set(rows.map((r) => r.id));
}

export async function disputeKnown(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, squareDisputeId: string): Promise<boolean> {
  const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_square_disputes WHERE gym_id = ${gymId} AND environment = ${environment} AND square_dispute_id = ${squareDisputeId}`;
  return row !== undefined;
}

/** Square's record, written once and kept current, and told to Staff activity when it first comes and each time its state moves. */
export async function writeDispute(
  sql: Sql,
  d: {
    gymId: string;
    environment: SquareEnvironment;
    accountId: string;
    squareDisputeId: string;
    squarePaymentId: string;
    amountMinor: number;
    currency: string;
    state: ChargebackState;
    reason: ChargebackReason | null;
    dueAt: Date | null;
    card: { brand: string; last4: string } | null;
    squareUpdatedAt: Date | null;
    now: Date;
  },
): Promise<void> {
  await sql.begin(async (tx) => {
    const [was] = await tx<{ id: string; state: string }[]>`
      SELECT id, state FROM gym_square_disputes WHERE gym_id = ${d.gymId} AND environment = ${d.environment} AND square_dispute_id = ${d.squareDisputeId} FOR UPDATE`;
    const [row] = await tx<{ id: string; state: string }[]>`
      INSERT INTO gym_square_disputes (gym_id, environment, account_id, square_dispute_id, square_payment_id, amount_minor, currency, state, reason, due_at, brand, last4, square_updated_at, changed_at)
      VALUES (${d.gymId}, ${d.environment}, ${d.accountId}, ${d.squareDisputeId}, ${d.squarePaymentId}, ${d.amountMinor}, ${d.currency}, ${d.state}, ${d.reason}, ${d.dueAt},
              ${d.card?.brand ?? null}, ${d.card?.last4 ?? null}, ${d.squareUpdatedAt}, ${d.now})
      ON CONFLICT (gym_id, environment, square_dispute_id) DO UPDATE
      SET state = EXCLUDED.state, reason = EXCLUDED.reason, due_at = EXCLUDED.due_at, amount_minor = EXCLUDED.amount_minor, currency = EXCLUDED.currency,
          square_updated_at = EXCLUDED.square_updated_at, changed_at = EXCLUDED.changed_at
      WHERE gym_square_disputes.square_updated_at IS NULL OR EXCLUDED.square_updated_at IS NULL OR EXCLUDED.square_updated_at >= gym_square_disputes.square_updated_at
      RETURNING id, state`;
    // An older answer changed nothing; two workers at one instant wait on the row or on the unique index, and only the first says so.
    if (row === undefined || was?.state === row.state) return;
    const [person] = await tx<{ entry_id: string | null }[]>`
      SELECT h.entry_id FROM gym_member_payments p
      JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      WHERE p.gym_id = ${d.gymId} AND p.provider = 'square' AND p.provider_payment_id = ${d.squarePaymentId}
      UNION ALL
      SELECT s.entry_id FROM gym_sales s WHERE s.gym_id = ${d.gymId} AND s.square_payment_id = ${d.squarePaymentId}
      LIMIT 1`;
    const entryId = person?.entry_id ?? null;
    await insertAudit(tx, {
      actorUserId: null,
      gymId: d.gymId,
      action: "org.chargeback",
      targetType: entryId === null ? "gym_square_dispute" : "gym_member_list_entry",
      targetId: entryId ?? row.id,
      meta: { ...(entryId === null ? {} : { entryId }), amountMinor: String(d.amountMinor), currency: d.currency, state: d.state },
    });
  });
}

/** Each payment's chargebacks, oldest first. */
export async function chargebacksOfPayments(sql: SqlOrTx, gymId: string, paymentIds: readonly string[], now: Date): Promise<Map<string, ChargebackSeen[]>> {
  const out = new Map<string, ChargebackSeen[]>();
  if (paymentIds.length === 0) return out;
  const rows = await sql<(RawSeen & { payment_id: string })[]>`
    SELECT p.id AS payment_id, ${seenColumns(sql, now)}
    FROM gym_square_disputes q
    JOIN gyms g ON g.id = q.gym_id
    JOIN gym_member_payments p ON p.gym_id = q.gym_id AND p.provider = 'square' AND p.provider_payment_id = q.square_payment_id
    WHERE q.gym_id = ${gymId} AND p.id = ANY(${[...paymentIds]}::uuid[])
    ORDER BY q.created_at, q.id`;
  for (const r of rows) out.set(r.payment_id, [...(out.get(r.payment_id) ?? []), seen(r)]);
  return out;
}

/** The same for sales, by the sale's first line. */
export async function chargebacksOfSales(sql: SqlOrTx, gymId: string, saleIds: readonly string[], now: Date): Promise<Map<string, ChargebackSeen[]>> {
  const out = new Map<string, ChargebackSeen[]>();
  if (saleIds.length === 0) return out;
  const rows = await sql<(RawSeen & { sale_id: string })[]>`
    SELECT s.id AS sale_id, ${seenColumns(sql, now)}
    FROM gym_square_disputes q
    JOIN gyms g ON g.id = q.gym_id
    JOIN gym_sales s ON s.gym_id = q.gym_id AND s.square_payment_id = q.square_payment_id
    WHERE q.gym_id = ${gymId} AND s.id = ANY(${[...saleIds]}::uuid[])
    ORDER BY q.created_at, q.id`;
  for (const r of rows) out.set(r.sale_id, [...(out.get(r.sale_id) ?? []), seen(r)]);
  return out;
}

export type ChargebackRow = Omit<ChargebackToAnswer, "member"> & { member: { entryId: string; typeName: string; fee: MemberFeeKind | null } | null };

/** Those still to answer, the soonest date first: Square still waits on the gym, and its date has not passed. */
export async function chargebacksToAnswer(sql: Sql, gymId: string, members: boolean, now: Date, from: number, limit: number): Promise<{ count: number; rows: ChargebackRow[] }> {
  const rows = await sql<
    (RawSeen & { at: Date | null; total: number; name: string | null; past: boolean; person_deleted: boolean; entry_id: string | null; type_name: string | null; fee: string | null; sale_id: string | null; sold_on: string | null; item_name: string | null; more: number })[]
  >`
    WITH open AS (
      SELECT ${seenColumns(sql, now)}, q.due_at AS at, q.square_payment_id, q.gym_id
      FROM gym_square_disputes q
      JOIN gyms g ON g.id = q.gym_id
      WHERE q.gym_id = ${gymId} AND q.state IN ('EVIDENCE_REQUIRED','INQUIRY_EVIDENCE_REQUIRED','UNKNOWN') AND (q.due_at IS NULL OR q.due_at > ${now})
    ),
    listed AS (
      SELECT o.*, e.full_name AS name, e.former_at IS NOT NULL AS past, false AS person_deleted, e.id AS entry_id, t.name AS type_name, b.fee,
             NULL::uuid AS sale_id, NULL::text AS sold_on, NULL::text AS item_name, 0 AS more
      FROM open o
      JOIN gym_member_payments p ON p.gym_id = o.gym_id AND p.provider = 'square' AND p.provider_payment_id = o.square_payment_id AND p.undone_at IS NULL
      JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
      JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
      WHERE ${members}::boolean
      UNION ALL
      SELECT o.*, e.full_name, COALESCE(e.former_at IS NOT NULL, false), s.entry_id IS NULL AND s.for_member, NULL, NULL, NULL,
             s.id, s.sold_on::text, s.item_name, (SELECT count(*)::int - 1 FROM gym_sales l WHERE l.gym_id = s.gym_id AND l.receipt_number = s.receipt_number)
      FROM open o
      JOIN gym_sales s ON s.gym_id = o.gym_id AND s.square_payment_id = o.square_payment_id AND s.line_no = 1 AND s.undone_at IS NULL
      LEFT JOIN gym_member_list_entries e ON e.gym_id = s.gym_id AND e.id = s.entry_id
    )
    SELECT l.*, count(*) OVER ()::int AS total
    FROM listed l
    ORDER BY l.at NULLS FIRST, l.id
    LIMIT ${limit} OFFSET ${from}`;
  const count = rows[0]?.total ?? (from === 0 ? 0 : from);
  return {
    count,
    rows: rows.map((r) => {
      const fee = memberFeeKindSchema.safeParse(r.fee);
      return {
        ...seen(r),
        name: r.name,
        past: r.past,
        personDeleted: r.person_deleted,
        member: r.entry_id === null ? null : { entryId: r.entry_id, typeName: r.type_name ?? "", fee: fee.success ? fee.data : null },
        sale: r.sale_id === null || r.sold_on === null ? null : { saleId: r.sale_id, day: r.sold_on, item: r.item_name ?? "", more: r.more },
      };
    }),
  };
}
