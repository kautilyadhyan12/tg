// Each counted use of a metered feature, kept with when (ROADMAP Stage 2 item 14a-ii, migration
// 0227): the admin page reads a person's meal scans and route plans day by day from here, since the
// quota's Redis counter forgets each day.
import type { Sql } from "postgres";
import type { MeteredFeatureName } from "./schemas.js";

export async function recordUse(sql: Sql, feature: MeteredFeatureName, userId: string, at: Date): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO metered_uses (user_id, feature, at) VALUES (${userId}, ${feature}, ${at}) RETURNING id`;
  const row = rows[0];
  if (row === undefined) throw new Error("metered_uses insert returned no row");
  return row.id;
}

/** Takes out a use that was given back; the person's own id keeps it to their row. */
export async function unrecordUse(sql: Sql, userId: string, useId: string): Promise<void> {
  await sql`DELETE FROM metered_uses WHERE id = ${useId} AND user_id = ${userId}`;
}
