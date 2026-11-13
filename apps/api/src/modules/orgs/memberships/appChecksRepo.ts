// Overview's Payments to check in Square (ROADMAP 18k-vi): who holds the memberships with one, and those people.
import type { Sql } from "postgres";

/** The record holding each of these memberships now. */
export async function holdersOf(sql: Sql, gymId: string, membershipIds: readonly string[]): Promise<Map<string, string>> {
  if (membershipIds.length === 0) return new Map();
  const rows = await sql<{ id: string; entry_id: string }[]>`
    SELECT id, entry_id FROM gym_held_memberships WHERE gym_id = ${gymId} AND id = ANY(${[...membershipIds]}::uuid[])`;
  return new Map(rows.map((r) => [r.id, r.entry_id]));
}

/** These records' names on the gym's list, and whether each is a past member's. */
export async function peopleOf(sql: Sql, gymId: string, entryIds: readonly string[]): Promise<Map<string, { name: string; past: boolean }>> {
  if (entryIds.length === 0) return new Map();
  const rows = await sql<{ id: string; full_name: string; past: boolean }[]>`
    SELECT id, full_name, former_at IS NOT NULL AS past FROM gym_member_list_entries WHERE gym_id = ${gymId} AND id = ANY(${[...entryIds]}::uuid[])`;
  return new Map(rows.map((r) => [r.id, { name: r.full_name, past: r.past }]));
}
