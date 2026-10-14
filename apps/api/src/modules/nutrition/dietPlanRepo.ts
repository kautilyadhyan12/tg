// A person's own diet plan (ROADMAP 34e-i): the only file that reads or writes
// `diet_plans`. Every statement is keyed on the signed-in person's own id.
import type { Sql } from "postgres";
import { z } from "zod";
import { mealItemSchema, mealTypeSchema } from "@app/shared";

const storedMealSchema = z.object({ mealType: mealTypeSchema, items: z.array(mealItemSchema).min(1) }).strict();
export type StoredMeal = z.infer<typeof storedMealSchema>;
/** Seven days, Monday first. */
const storedDaysSchema = z.array(z.array(storedMealSchema)).length(7);
export type StoredDays = z.infer<typeof storedDaysSchema>;

export const EMPTY_WEEK: StoredDays = [[], [], [], [], [], [], []];
/** How many of the phone's change ids are kept to know a change sent twice: more
 *  than a phone holds unsent, so an old whole-day change sent again is never made again. */
const KEPT_CHANGES = 500;

export interface StoredPlan { days: StoredDays; recentChanges: readonly string[] }

export async function getDietPlan(sql: Sql, userId: string): Promise<StoredPlan> {
  const rows = await sql<{ days: unknown; recentChanges: string[] }[]>`
    SELECT days, recent_changes AS "recentChanges" FROM diet_plans WHERE user_id = ${userId}`;
  const row = rows[0];
  return row === undefined ? { days: EMPTY_WEEK, recentChanges: [] } : { days: storedDaysSchema.parse(row.days), recentChanges: row.recentChanges };
}

/** One change to the person's plan, under a lock on their row: `change` reads the
 *  week as it is and returns it changed, or throws to change nothing. A change id
 *  already made is not made again, and the week is returned as it is. */
export async function changeDietPlan(
  sql: Sql,
  userId: string,
  changeId: string,
  change: (days: StoredDays) => StoredDays,
): Promise<StoredDays> {
  return await sql.begin(async (tx) => {
    await tx`
      INSERT INTO diet_plans (user_id, days) VALUES (${userId}, ${tx.json(EMPTY_WEEK)})
      ON CONFLICT (user_id) DO NOTHING`;
    const rows = await tx<{ days: unknown; made: boolean }[]>`
      SELECT days, ${changeId}::uuid = ANY(recent_changes) AS made
      FROM diet_plans WHERE user_id = ${userId} FOR UPDATE`;
    const row = rows[0];
    if (row === undefined) throw new Error("the diet plan row was not written");
    const days = storedDaysSchema.parse(row.days);
    if (row.made) return days;
    const next = storedDaysSchema.parse(change(days));
    await tx`
      UPDATE diet_plans
      SET days = ${tx.json(next)},
          recent_changes = (${changeId}::uuid || recent_changes)[1:${KEPT_CHANGES}],
          updated_at = now()
      WHERE user_id = ${userId}`;
    return next;
  });
}
