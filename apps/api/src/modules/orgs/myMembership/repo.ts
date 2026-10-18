// MY MEMBERSHIP: WHOSE IT IS (spec Part 3 §14.2; ROADMAP 18j). The reader's own record of a
// gym, and the record a receipt is for. Every read names the gym.
import type { Sql } from "postgres";

export interface Reader {
  gymName: string;
  timezone: string;
  /** The record the reader's live account is linked to; null for none. */
  entryId: string | null;
  /** The live app accounts of active people holding that record, the reader's among them. */
  holders: number;
}

/** The reader as a live app member of an active gym, or null for anybody else. */
export async function readerOf(sql: Sql, gymId: string, userId: string): Promise<Reader | null> {
  const [row] = await sql<{ name: string; timezone: string; entry_id: string | null; holders: number }[]>`
    SELECT g.name, g.timezone, m.entry_id,
           (SELECT count(*) FROM gym_members o JOIN users u ON u.id = o.user_id AND u.status = 'active'
            WHERE o.gym_id = g.id AND o.entry_id = m.entry_id AND o.removed_at IS NULL)::int AS holders
    FROM gyms g
    JOIN gym_members m ON m.gym_id = g.id AND m.user_id = ${userId} AND m.removed_at IS NULL
    JOIN users r ON r.id = m.user_id AND r.status = 'active'
    WHERE g.id = ${gymId} AND g.status = 'active'`;
  return row === undefined ? null : { gymName: row.name, timezone: row.timezone, entryId: row.entry_id, holders: row.holders };
}

/** The record a receipt of the gym is for: the person sold to, or whose membership a payment
 *  or a refund was on. Null where the gym has no receipt by that number, or its person is gone. */
export async function receiptEntry(sql: Sql, gymId: string, number: number): Promise<string | null> {
  const rows = await sql<{ entry_id: string | null }[]>`
    SELECT s.entry_id FROM gym_sales s
    WHERE s.gym_id = ${gymId} AND s.receipt_number = ${number}
    UNION ALL
    SELECT s.entry_id FROM gym_sale_refunds f
    JOIN gym_sales s ON s.gym_id = f.gym_id AND s.id = f.sale_id
    WHERE f.gym_id = ${gymId} AND f.receipt_number = ${number}
    UNION ALL
    SELECT h.entry_id FROM gym_member_payments p
    JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    WHERE p.gym_id = ${gymId} AND p.receipt_number = ${number}
    UNION ALL
    SELECT h.entry_id FROM gym_member_refunds r
    JOIN gym_member_payments p ON p.gym_id = r.gym_id AND p.id = r.payment_id
    JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    WHERE r.gym_id = ${gymId} AND r.receipt_number = ${number}`;
  // A sale of several lines is one receipt on several rows, all for one person.
  const owners = new Set(rows.map((r) => r.entry_id));
  if (owners.size > 1) throw new Error("one receipt number is on two people's rows");
  return rows[0]?.entry_id ?? null;
}
