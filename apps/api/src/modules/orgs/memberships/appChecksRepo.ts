// Overview's Payments to check in Square (ROADMAP 18k-vi): the people who may have one. More than the person's page would
// show, never fewer: the page's own read then says what is to check (`appChecks.ts`).
import type { Sql } from "postgres";

/** A person with a page in the app that ended needing a check (`CHECK_OUTCOMES`) that may still stand: a purchase not
 *  marked checked; the newest such page of a membership's bills, where that period's bill is not settled; the newest of a
 *  fee's, where the fee is still open. The newest first, at most `limit`. */
export async function peopleToCheck(sql: Sql, gymId: string, limit: number): Promise<{ entryId: string; name: string }[]> {
  const rows = await sql<{ entry_id: string; name: string }[]>`
    WITH c AS (
      SELECT a.entry_id, a.finished_at FROM gym_app_payments a
      WHERE a.gym_id = ${gymId} AND a.membership_type_id IS NOT NULL AND a.entry_id IS NOT NULL
        AND a.outcome IN ('not_recorded','gone','no_answer') AND a.cleared_at IS NULL
      UNION ALL
      SELECT h.entry_id, b.finished_at
      FROM (
        SELECT DISTINCT ON (a.held_membership_id) a.held_membership_id, a.period_index, a.finished_at
        FROM gym_app_payments a
        WHERE a.gym_id = ${gymId} AND a.membership_type_id IS NULL AND a.fee_bill_id IS NULL
          AND a.outcome IN ('not_recorded','gone','no_answer')
        ORDER BY a.held_membership_id, a.finished_at DESC, a.id
      ) b
      JOIN gym_held_memberships h ON h.gym_id = ${gymId} AND h.id = b.held_membership_id
      WHERE NOT EXISTS (
        SELECT 1 FROM gym_member_bills x
        WHERE x.gym_id = ${gymId} AND x.held_membership_id = b.held_membership_id AND x.period_index = b.period_index AND x.status <> 'open'
      )
      UNION ALL
      SELECT h.entry_id, f.finished_at
      FROM (
        SELECT DISTINCT ON (a.fee_bill_id) a.fee_bill_id, a.held_membership_id, a.finished_at
        FROM gym_app_payments a
        WHERE a.gym_id = ${gymId} AND a.fee_bill_id IS NOT NULL AND a.outcome IN ('not_recorded','gone','no_answer')
        ORDER BY a.fee_bill_id, a.finished_at DESC, a.id
      ) f
      JOIN gym_member_bills x ON x.gym_id = ${gymId} AND x.id = f.fee_bill_id AND x.status = 'open'
      JOIN gym_held_memberships h ON h.gym_id = ${gymId} AND h.id = f.held_membership_id
    )
    SELECT c.entry_id, e.full_name AS name
    FROM c
    JOIN gym_member_list_entries e ON e.gym_id = ${gymId} AND e.id = c.entry_id
    GROUP BY c.entry_id, e.full_name
    ORDER BY max(c.finished_at) DESC, c.entry_id
    LIMIT ${limit}`;
  return rows.map((r) => ({ entryId: r.entry_id, name: r.name }));
}
