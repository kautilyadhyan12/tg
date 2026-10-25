// What live news reads from the database (ROADMAP Stage 4 item 18).
import type { Sql } from "postgres";

/** The gyms whose leaderboards may show this person: every gym they are a live member of. */
export async function gymsOfMember(sql: Sql, userId: string): Promise<string[]> {
  const rows = await sql<{ gym_id: string }[]>`
    SELECT gym_id FROM gym_members WHERE user_id = ${userId} AND removed_at IS NULL`;
  return rows.map((r) => r.gym_id);
}
