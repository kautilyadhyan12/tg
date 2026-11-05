// The meal plans a gym gives its members (ROADMAP Stage 2 24a-i): the only file that reads or
// writes `gym_meal_plans`. Every statement is keyed on the gym as well as the plan, so one gym's
// id never reaches another gym's plan.
import type { Sql } from "postgres";
import { z } from "zod";
import { mealItemSchema, mealTypeSchema } from "@app/shared";

const storedMealSchema = z.object({ mealType: mealTypeSchema, items: z.array(mealItemSchema).min(1) }).strict();
export type StoredMeal = z.infer<typeof storedMealSchema>;
/** Seven days, Monday first, as a person's own plan keeps them. */
const storedDaysSchema = z.array(z.array(storedMealSchema)).length(7);
export type StoredDays = z.infer<typeof storedDaysSchema>;

export const EMPTY_WEEK: StoredDays = [[], [], [], [], [], [], []];
/** How many change ids are kept to know a change sent twice. */
const KEPT_CHANGES = 200;

export interface StoredGymPlan {
  id: string;
  name: string;
  days: StoredDays;
  recentChanges: readonly string[];
  writtenBy: string | null;
  changedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PlanRow {
  id: string;
  name: string;
  days: unknown;
  recent_changes: string[] | null;
  written_by: string | null;
  changed_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const asPlan = (r: PlanRow): StoredGymPlan => ({
  id: r.id,
  name: r.name,
  days: storedDaysSchema.parse(r.days),
  recentChanges: r.recent_changes ?? [],
  writtenBy: r.written_by,
  changedBy: r.changed_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** A name is shown only for an account still in use, as a post's author is. */
const PLAN_COLUMNS = (sql: Sql) => sql`
  p.id, p.name, p.days, p.recent_changes, p.created_at, p.updated_at,
  CASE WHEN w.status = 'active' THEN nullif(btrim(w.display_name), '') END AS written_by,
  CASE WHEN c.status = 'active' THEN nullif(btrim(c.display_name), '') END AS changed_by`;

export async function listPlans(sql: Sql, gymId: string): Promise<StoredGymPlan[]> {
  const rows = await sql<PlanRow[]>`
    SELECT ${PLAN_COLUMNS(sql)}
    FROM gym_meal_plans p
    LEFT JOIN users w ON w.id = p.written_by_user_id
    LEFT JOIN users c ON c.id = p.changed_by_user_id
    WHERE p.gym_id = ${gymId}
    ORDER BY lower(p.name), p.id`;
  return rows.map(asPlan);
}

export async function getPlan(sql: Sql, gymId: string, planId: string): Promise<StoredGymPlan | null> {
  const rows = await sql<PlanRow[]>`
    SELECT ${PLAN_COLUMNS(sql)}
    FROM gym_meal_plans p
    LEFT JOIN users w ON w.id = p.written_by_user_id
    LEFT JOIN users c ON c.id = p.changed_by_user_id
    WHERE p.gym_id = ${gymId} AND p.id = ${planId}`;
  const row = rows[0];
  return row === undefined ? null : asPlan(row);
}

export type CreateOutcome = "made" | "already" | "elsewhere" | "name_taken" | "too_many";

/** A new, empty plan under the browser's own id. The same id sent again is the plan already made;
 *  an id another gym holds is refused, as is a name the gym already uses and a gym at its most. */
export async function createPlan(sql: Sql, gymId: string, staffId: string, planId: string, name: string, most: number): Promise<CreateOutcome> {
  try {
    return await createLocked(sql, gymId, staffId, planId, name, most);
  } catch (err) {
    // A rename to this name, or another gym's plan under this id, landing at the same instant.
    if (!isUniqueViolation(err)) throw err;
    return typeof err === "object" && err !== null && "constraint_name" in err && err.constraint_name === "gym_meal_plans_pkey" ? "elsewhere" : "name_taken";
  }
}

async function createLocked(sql: Sql, gymId: string, staffId: string, planId: string, name: string, most: number): Promise<CreateOutcome> {
  return await sql.begin(async (tx) => {
    // One gym's new plans one at a time: two at once cannot both pass the count. NO KEY UPDATE, so the
    // gym's other writes (a check-in, a booking) never wait on it.
    await tx`SELECT id FROM gyms WHERE id = ${gymId} FOR NO KEY UPDATE`;
    const held = await tx<{ gym_id: string }[]>`SELECT gym_id FROM gym_meal_plans WHERE id = ${planId}`;
    const owner = held[0];
    if (owner !== undefined) return owner.gym_id === gymId ? "already" : "elsewhere";
    const counted = await tx<{ n: number; taken: boolean }[]>`
      SELECT count(*)::int AS n, coalesce(bool_or(lower(name) = lower(${name})), false) AS taken
      FROM gym_meal_plans WHERE gym_id = ${gymId}`;
    const count = counted[0];
    if (count?.taken === true) return "name_taken";
    if ((count?.n ?? 0) >= most) return "too_many";
    await tx`
      INSERT INTO gym_meal_plans (id, gym_id, name, days, written_by_user_id, changed_by_user_id)
      VALUES (${planId}, ${gymId}, ${name}, ${tx.json(EMPTY_WEEK)}, ${staffId}, ${staffId})`;
    return "made";
  });
}

/** The plan's new name; false where the gym has no such plan, "name_taken" where another of its plans has it. */
export async function renamePlan(sql: Sql, gymId: string, planId: string, staffId: string, name: string): Promise<boolean | "name_taken"> {
  const taken = await sql<{ id: string }[]>`
    SELECT id FROM gym_meal_plans WHERE gym_id = ${gymId} AND lower(name) = lower(${name}) AND id <> ${planId}`;
  if (taken.length > 0) return "name_taken";
  try {
    const rows = await sql<{ id: string }[]>`
      UPDATE gym_meal_plans SET name = ${name}, changed_by_user_id = ${staffId}, updated_at = now()
      WHERE gym_id = ${gymId} AND id = ${planId}
      RETURNING id`;
    return rows.length > 0;
  } catch (err) {
    // Two renames to one name at the same instant: the index answers for the second.
    if (isUniqueViolation(err)) return "name_taken";
    throw err;
  }
}

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === "object" && err !== null && "code" in err && err.code === "23505";

/** One change to a plan's week, under a lock on its row: `change` reads the week as it is and
 *  returns it changed, or throws to change nothing. A change id already made is not made again.
 *  Null where the gym has no such plan. */
export async function changePlanDays(
  sql: Sql,
  gymId: string,
  planId: string,
  staffId: string,
  changeId: string,
  change: (days: StoredDays) => StoredDays,
): Promise<boolean> {
  return await sql.begin(async (tx) => {
    const rows = await tx<{ days: unknown; made: boolean }[]>`
      SELECT days, ${changeId}::uuid = ANY(recent_changes) AS made
      FROM gym_meal_plans WHERE gym_id = ${gymId} AND id = ${planId} FOR UPDATE`;
    const row = rows[0];
    if (row === undefined) return false;
    if (row.made) return true;
    const next = storedDaysSchema.parse(change(storedDaysSchema.parse(row.days)));
    await tx`
      UPDATE gym_meal_plans
      SET days = ${tx.json(next)},
          recent_changes = (${changeId}::uuid || recent_changes)[1:${KEPT_CHANGES}],
          changed_by_user_id = ${staffId},
          updated_at = now()
      WHERE gym_id = ${gymId} AND id = ${planId}`;
    return true;
  });
}

/** False where the gym has no such plan, or it was deleted already. */
export async function deletePlan(sql: Sql, gymId: string, planId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`DELETE FROM gym_meal_plans WHERE gym_id = ${gymId} AND id = ${planId} RETURNING id`;
  return rows.length > 0;
}
