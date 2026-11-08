// A person's own diet plan (ROADMAP 34e-i): the only file that reads or writes
// `diet_plans` and the food row of `recommended_choices` (31f; the gym named since 31g). Every statement is
// keyed on the signed-in person's own id.
import type { Sql } from "postgres";
import { z } from "zod";
import { foodChoiceSchema, mealItemSchema, mealTypeSchema, type FoodChoice } from "@app/shared";

const storedMealSchema = z.object({ mealType: mealTypeSchema, items: z.array(mealItemSchema).min(1) }).strict();
export type StoredMeal = z.infer<typeof storedMealSchema>;
/** Seven days, Monday first. */
const storedDaysSchema = z.array(z.array(storedMealSchema)).length(7);
export type StoredDays = z.infer<typeof storedDaysSchema>;

export const EMPTY_WEEK: StoredDays = [[], [], [], [], [], [], []];
/** How many of the phone's change ids are kept to know a change sent twice: more
 *  than a phone holds unsent, so an old whole-day change sent again is never made again. */
const KEPT_CHANGES = 500;

/** The person's own pick for food: `gymId` names the gym for the gym's plan, null for the others. */
export interface Picked { choice: FoodChoice; gymId: string | null }
/** `choice`: the person's own pick for food, null where they have not picked. */
export interface StoredPlan { days: StoredDays; recentChanges: readonly string[]; choice: Picked | null }

export const hasAMeal = (days: StoredDays): boolean => days.some((meals) => meals.length > 0);
const choiceOf = (stored: { choice: string | null; gymId: string | null } | undefined): Picked | null =>
  stored?.choice == null ? null : { choice: foodChoiceSchema.parse(stored.choice), gymId: stored.gymId };

export async function getDietPlan(sql: Sql, userId: string): Promise<StoredPlan> {
  const rows = await sql<{ days: unknown; recentChanges: string[] | null; choice: string | null; gymId: string | null }[]>`
    SELECT p.days, p.recent_changes AS "recentChanges", c.choice, c.gym_id AS "gymId"
    FROM (SELECT ${userId}::uuid AS user_id) AS me
    LEFT JOIN diet_plans p ON p.user_id = me.user_id
    LEFT JOIN recommended_choices c ON c.user_id = me.user_id AND c.kind = 'food'`;
  const row = rows[0];
  const choice = choiceOf(row);
  return row?.days == null
    ? { days: EMPTY_WEEK, recentChanges: [], choice }
    : { days: storedDaysSchema.parse(row.days), recentChanges: row.recentChanges ?? [], choice };
}

/** The person's pick for food, kept as sent: the same pick sent twice is the same pick. Whether the
 *  person may pick that gym is the service's check, made before this. */
export async function setFoodChoice(sql: Sql, userId: string, picked: Picked): Promise<void> {
  await sql`
    INSERT INTO recommended_choices (user_id, kind, choice, gym_id) VALUES (${userId}, 'food', ${picked.choice}, ${picked.gymId})
    ON CONFLICT (user_id, kind) DO UPDATE SET choice = EXCLUDED.choice, gym_id = EXCLUDED.gym_id, updated_at = now()`;
}

/** One change to the person's plan, under a lock on their row: `change` reads the
 *  week as it is and returns it changed, or throws to change nothing. A change id
 *  already made is not made again, and the week is returned as it is. The first
 *  meals put in an empty week make the person's pick My plan: they built it to see it. */
export async function changeDietPlan(
  sql: Sql,
  userId: string,
  changeId: string,
  change: (days: StoredDays) => StoredDays,
): Promise<{ days: StoredDays; choice: Picked | null }> {
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
    const chosen = async (): Promise<Picked | null> => {
      const picked = await tx<{ choice: string; gymId: string | null }[]>`
        SELECT choice, gym_id AS "gymId" FROM recommended_choices WHERE user_id = ${userId} AND kind = 'food'`;
      return choiceOf(picked[0]);
    };
    if (row.made) return { days, choice: await chosen() };
    const next = storedDaysSchema.parse(change(days));
    await tx`
      UPDATE diet_plans
      SET days = ${tx.json(next)},
          recent_changes = (${changeId}::uuid || recent_changes)[1:${KEPT_CHANGES}],
          updated_at = now()
      WHERE user_id = ${userId}`;
    if (!hasAMeal(days) && hasAMeal(next)) {
      await tx`
        INSERT INTO recommended_choices (user_id, kind, choice) VALUES (${userId}, 'food', 'mine')
        ON CONFLICT (user_id, kind) DO UPDATE SET choice = 'mine', gym_id = NULL, updated_at = now()`;
    }
    return { days: next, choice: await chosen() };
  });
}
