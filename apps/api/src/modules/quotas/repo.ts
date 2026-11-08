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

class NotGivenBack extends Error {}

/** Takes out a use, and only then runs `giveBack`, in one transaction: the row stays unless the
 *  count was given back too, and a use already taken out gives nothing back. The person's own id
 *  keeps it to their row. true = taken out and given back. */
export async function unrecordUse(sql: Sql, userId: string, useId: string, giveBack: () => Promise<boolean>): Promise<boolean> {
  return await sql.begin(async (tx) => {
    const gone = await tx`DELETE FROM metered_uses WHERE id = ${useId} AND user_id = ${userId} RETURNING 1`;
    if (gone.length === 0) return false;
    if (!(await giveBack())) throw new NotGivenBack();
    return true;
  }).catch((err: unknown) => {
    if (err instanceof NotGivenBack) return false;
    throw err;
  });
}
