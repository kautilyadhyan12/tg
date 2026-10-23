// Failed payments (ROADMAP 18d-iii-ii-b): the gym's bills and fees still owed whose newest charge to
// a card on file was declined. "Newest" is read as the person's page reads it (`chargesOfBills`): a
// bill's charges by the bill, and for a period a press made before its bill was open, which keeps
// no bill. Every statement names the gym.
import type { Sql, TransactionSql } from "postgres";
import { memberFeeKindSchema, type MemberFeeKind } from "@app/shared";

type SqlOrTx = Sql | TransactionSql;

export interface FailedBill {
  billId: string;
  entryId: string;
  name: string;
  past: boolean;
  membershipId: string;
  typeName: string;
  periodIndex: number | null;
  covers: { from: string; to: string } | null;
  fee: { kind: MemberFeeKind; forName: string; on: string; to: string | null } | null;
  amountMinor: number;
  paidMinor: number;
  currency: string;
  declinedAt: Date;
}

/** Every one of them, newest decline first. A gym's declines are found by their own index
 *  (`gym_card_charges_card_idx`); a bill since paid, cancelled or charged again is left out. */
export async function failedBills(sql: SqlOrTx, gymId: string): Promise<FailedBill[]> {
  const rows = await sql<
    {
      bill_id: string;
      entry_id: string;
      full_name: string;
      past: boolean;
      membership_id: string;
      type_name: string;
      period_index: number | null;
      fee: string | null;
      fee_for: string | null;
      covers_from: string | null;
      covers_to: string | null;
      amount_minor: number;
      paid_minor: number;
      currency: string;
      declined_at: Date;
    }[]
  >`
    WITH declined AS (
      SELECT DISTINCT COALESCE(c.bill_id, pb.id) AS bill_id
      FROM gym_card_charges c
      LEFT JOIN gym_member_bills pb
        ON c.bill_id IS NULL AND pb.gym_id = c.gym_id AND pb.held_membership_id = c.held_membership_id
       AND pb.period_index = c.period_index AND pb.fee IS NULL
      WHERE c.gym_id = ${gymId} AND c.outcome = 'declined'
    )
    SELECT b.id AS bill_id, h.entry_id, e.full_name, e.former_at IS NOT NULL AS past, h.id AS membership_id, t.name AS type_name,
           b.period_index, b.fee, b.fee_for, b.covers_from::text AS covers_from, b.covers_to::text AS covers_to,
           b.amount_minor, b.currency,
           COALESCE((SELECT sum(p.amount_minor) FROM gym_member_payments p
                     WHERE p.gym_id = b.gym_id AND p.bill_id = b.id AND p.undone_at IS NULL), 0)::int AS paid_minor,
           n.started_at AS declined_at
    FROM declined d
    JOIN gym_member_bills b ON b.gym_id = ${gymId} AND b.id = d.bill_id AND b.status = 'open'
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
    CROSS JOIN LATERAL (
      SELECT x.outcome, x.started_at
      FROM (
        SELECT c.outcome, c.started_at, c.id FROM gym_card_charges c
        WHERE c.gym_id = b.gym_id AND c.bill_id = b.id
        UNION ALL
        SELECT c.outcome, c.started_at, c.id FROM gym_card_charges c
        WHERE b.fee IS NULL AND c.gym_id = b.gym_id AND c.bill_id IS NULL
          AND c.held_membership_id = b.held_membership_id AND c.period_index = b.period_index
      ) x
      ORDER BY x.started_at DESC, x.id DESC
      LIMIT 1
    ) n
    WHERE n.outcome = 'declined'
    ORDER BY n.started_at DESC, b.id`;
  return rows.map((r) => {
    const kind = r.fee === null ? null : memberFeeKindSchema.parse(r.fee);
    return {
      billId: r.bill_id,
      entryId: r.entry_id,
      name: r.full_name,
      past: r.past,
      membershipId: r.membership_id,
      typeName: r.type_name,
      periodIndex: r.period_index,
      covers: kind === null && r.covers_from !== null && r.covers_to !== null ? { from: r.covers_from, to: r.covers_to } : null,
      fee:
        kind === null || r.covers_from === null
          ? null
          : { kind, forName: r.fee_for !== null && r.fee_for !== "" ? r.fee_for : r.type_name, on: r.covers_from, to: kind === "freeze" ? r.covers_to : null },
      amountMinor: r.amount_minor,
      paidMinor: r.paid_minor,
      currency: r.currency,
      declinedAt: r.declined_at,
    };
  });
}
