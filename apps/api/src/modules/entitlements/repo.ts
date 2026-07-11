// P2.4 — entitlements repo: the ONLY file that reads plans/subscriptions/
// gym_members for resolution (v1 §6.2). The candidate query is Part 4 §4.1's
// canonical SQL VERBATIM (R4.5) — do not "improve" it.
import type { Sql } from "postgres";

export interface CandidateRow {
  rank: number;
  entitlements: unknown; // own subscription's plan doc (null for gym rows)
  memberEntitlements: unknown; // gym plan's member doc (null for own rows)
}

export async function getCandidates(sql: Sql, userId: string): Promise<CandidateRow[]> {
  const rows = await sql<
    { rank: number; entitlements: unknown; member_entitlements: unknown }[]
  >`
    SELECT p.rank, p.entitlements, NULL::jsonb AS member_entitlements
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.owner_type='user' AND s.owner_id=${userId} AND s.status IN
    ('trialing','active','past_due')
    UNION ALL
    SELECT p.rank, NULL, p.member_entitlements
    FROM gym_members m
    JOIN subscriptions s ON s.owner_type='gym' AND s.owner_id=m.gym_id
                         AND s.status IN ('trialing','active','past_due')
    JOIN plans p ON p.id = s.plan_id
    WHERE m.user_id=${userId} AND m.removed_at IS NULL`;
  return rows.map((r) => ({
    rank: r.rank,
    entitlements: r.entitlements,
    memberEntitlements: r.member_entitlements,
  }));
}

/** The free plan document — the merge base (§4.1 "start from the `free`
 *  plan document"). Seeded by Part 4 §8; absence is a boot-order bug. */
export async function getFreePlanDoc(sql: Sql): Promise<unknown> {
  const rows = await sql<{ entitlements: unknown }[]>`
    SELECT entitlements FROM plans WHERE code = 'free'`;
  if (rows[0] === undefined) throw new Error("plans seed missing the 'free' row (Part 4 §8)");
  return rows[0].entitlements;
}
