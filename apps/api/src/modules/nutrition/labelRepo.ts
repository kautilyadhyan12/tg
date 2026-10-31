// A person's own foods read from a pack's label (ROADMAP Stage 5 33b-iii-c). Every read and write
// holds the owner in its WHERE: a label is never anybody else's.
import type { Sql } from "postgres";

/** The most foods one person keeps this way, all of them listed so each can be changed or removed:
 *  nobody has this many packs, and a script stops here. */
export const LABEL_FOODS_MOST = 200;

export interface LabelFoodRow {
  id: string;
  code: string | null;
  name: string;
  unit: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  serving_amount: number | null;
  contains: string[];
  may_contain: string[];
}

export interface LabelFoodValues {
  code: string | null;
  name: string;
  unit: "g" | "ml";
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingAmount: number | null;
  contains: readonly string[];
  mayContain: readonly string[];
}

const COLUMNS = "id, code, name, unit, kcal, protein_g, carbs_g, fat_g, serving_amount, contains, may_contain";

export async function labelFoodByCode(sql: Sql, userId: string, code: string): Promise<LabelFoodRow | null> {
  const [row] = await sql<LabelFoodRow[]>`SELECT ${sql.unsafe(COLUMNS)} FROM member_label_foods WHERE user_id = ${userId} AND code = ${code}`;
  return row ?? null;
}

export async function labelFoodsOf(sql: Sql, userId: string): Promise<LabelFoodRow[]> {
  return await sql<LabelFoodRow[]>`SELECT ${sql.unsafe(COLUMNS)} FROM member_label_foods WHERE user_id = ${userId} ORDER BY updated_at DESC, id LIMIT ${LABEL_FOODS_MOST}`;
}

export async function labelFoodById(sql: Sql, userId: string, id: string): Promise<LabelFoodRow | null> {
  const [row] = await sql<LabelFoodRow[]>`SELECT ${sql.unsafe(COLUMNS)} FROM member_label_foods WHERE user_id = ${userId} AND id = ${id}`;
  return row ?? null;
}

/** Keeps a label. The same id again changes that row, whose barcode stays; a barcode the person already
 *  kept changes the one they have, so a save sent twice is one food. "taken" is an id somebody else
 *  holds; "full" is the most one person may keep. */
export async function saveLabelFood(sql: Sql, userId: string, id: string, v: LabelFoodValues): Promise<LabelFoodRow | "taken" | "full"> {
  const [changed] = await sql<LabelFoodRow[]>`
    UPDATE member_label_foods SET name = ${v.name}, unit = ${v.unit}, kcal = ${v.kcal}, protein_g = ${v.proteinG}, carbs_g = ${v.carbsG}, fat_g = ${v.fatG},
      serving_amount = ${v.servingAmount}, contains = ${sql.array([...v.contains])}, may_contain = ${sql.array([...v.mayContain])}, updated_at = now()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING ${sql.unsafe(COLUMNS)}`;
  if (changed !== undefined) return changed;
  try {
    const [made] = await sql<LabelFoodRow[]>`
      INSERT INTO member_label_foods (id, user_id, code, name, unit, kcal, protein_g, carbs_g, fat_g, serving_amount, contains, may_contain)
      SELECT ${id}, ${userId}, ${v.code}, ${v.name}, ${v.unit}, ${v.kcal}, ${v.proteinG}, ${v.carbsG}, ${v.fatG}, ${v.servingAmount}, ${sql.array([...v.contains])}, ${sql.array([...v.mayContain])}
      WHERE (SELECT count(*) FROM member_label_foods WHERE user_id = ${userId}) < ${LABEL_FOODS_MOST}
      ON CONFLICT (user_id, code) WHERE code IS NOT NULL DO UPDATE SET
        name = EXCLUDED.name, unit = EXCLUDED.unit, kcal = EXCLUDED.kcal, protein_g = EXCLUDED.protein_g, carbs_g = EXCLUDED.carbs_g, fat_g = EXCLUDED.fat_g,
        serving_amount = EXCLUDED.serving_amount, contains = EXCLUDED.contains, may_contain = EXCLUDED.may_contain, updated_at = now()
      RETURNING ${sql.unsafe(COLUMNS)}`;
    return made ?? "full";
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
      // The same save at the same moment holds this id for this person: that row is the answer.
      return (await labelFoodById(sql, userId, id)) ?? "taken";
    }
    throw err;
  }
}

export async function removeLabelFood(sql: Sql, userId: string, id: string): Promise<boolean> {
  const gone = await sql`DELETE FROM member_label_foods WHERE id = ${id} AND user_id = ${userId}`;
  return gone.count > 0;
}
