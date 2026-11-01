// A person's own foods read from a pack's label (ROADMAP Stage 5 33b-iii-c). Every read and write
// holds the owner in its WHERE: a label is never anybody else's. A removed label stays as a row, as a
// meal's removed id does: a late save cannot bring it back, and a meal waiting on the phone still prices.
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
  /** When it was last saved, to the microsecond, as text: what a change is checked against. */
  seen: string;
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
  seen: string | null;
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((word, at) => word === b[at]);
const sameValues = (row: LabelFoodRow, v: LabelFoodValues): boolean =>
  row.name === v.name && row.unit === v.unit && row.kcal === v.kcal && row.protein_g === v.proteinG && row.carbs_g === v.carbsG && row.fat_g === v.fatG
  && row.serving_amount === v.servingAmount && sameList(row.contains, v.contains) && sameList(row.may_contain, v.mayContain);

/** How long a removed label stays, for a meal still waiting on a phone, and how many of one person's. */
const REMOVED_KEPT_DAYS = 30;
const REMOVED_KEPT_MOST = LABEL_FOODS_MOST;

const COLUMNS = "id, code, name, unit, kcal, protein_g, carbs_g, fat_g, serving_amount, contains, may_contain, updated_at::text AS seen";

export async function labelFoodByCode(sql: Sql, userId: string, code: string): Promise<LabelFoodRow | null> {
  const [row] = await sql<LabelFoodRow[]>`SELECT ${sql.unsafe(COLUMNS)} FROM member_label_foods WHERE user_id = ${userId} AND code = ${code} AND removed_at IS NULL`;
  return row ?? null;
}

export async function labelFoodsOf(sql: Sql, userId: string): Promise<LabelFoodRow[]> {
  return await sql<LabelFoodRow[]>`SELECT ${sql.unsafe(COLUMNS)} FROM member_label_foods WHERE user_id = ${userId} AND removed_at IS NULL ORDER BY updated_at DESC, id LIMIT ${LABEL_FOODS_MOST}`;
}

export async function labelFoodById(sql: Sql, userId: string, id: string): Promise<LabelFoodRow | null> {
  const [row] = await sql<LabelFoodRow[]>`SELECT ${sql.unsafe(COLUMNS)} FROM member_label_foods WHERE user_id = ${userId} AND id = ${id} AND removed_at IS NULL`;
  return row ?? null;
}

/** A label as a meal prices it: removed since or not, as it is the owner's. */
export async function labelFoodForMeal(sql: Sql, userId: string, id: string): Promise<LabelFoodRow | null> {
  const [row] = await sql<LabelFoodRow[]>`SELECT ${sql.unsafe(COLUMNS)} FROM member_label_foods WHERE user_id = ${userId} AND id = ${id}`;
  return row ?? null;
}

/** Keeps a label, one person's saves one at a time. The same id again changes that row, whose barcode
 *  stays; a barcode the person already kept changes the one they have, so a save sent twice is one food.
 *  "taken": an id somebody else holds, or a label removed, which a late save does not bring back.
 *  "other_code": the id holds another barcode. "changed": saved since it was read. "full": the most one
 *  person may keep. */
export async function saveLabelFood(sql: Sql, userId: string, id: string, v: LabelFoodValues): Promise<LabelFoodRow | "taken" | "full" | "other_code" | "changed"> {
  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`label:${userId}`}))`;
    const [held] = await tx<{ user_id: string; code: string | null; removed: boolean; seen: string }[]>`
      SELECT user_id, code, removed_at IS NOT NULL AS removed, updated_at::text AS seen FROM member_label_foods WHERE id = ${id}`;
    const same = held ?? null;
    if (same !== null && (same.user_id !== userId || same.removed)) return "taken";
    if (same !== null && v.code !== null && same.code !== v.code) return "other_code";
    if (same !== null && v.seen !== null && same.seen !== v.seen) {
      // The person's own save sent again, its answer having been lost: not somebody else's change.
      const [row] = await tx<LabelFoodRow[]>`SELECT ${tx.unsafe(COLUMNS)} FROM member_label_foods WHERE id = ${id}`;
      return row !== undefined && sameValues(row, v) ? row : "changed";
    }
    const [byCode] = same !== null || v.code === null ? [] : await tx<{ id: string }[]>`
      SELECT id FROM member_label_foods WHERE user_id = ${userId} AND code = ${v.code} AND removed_at IS NULL`;
    const target = same !== null ? id : byCode?.id ?? null;
    if (target !== null) {
      const [changed] = await tx<LabelFoodRow[]>`
        UPDATE member_label_foods SET name = ${v.name}, unit = ${v.unit}, kcal = ${v.kcal}, protein_g = ${v.proteinG}, carbs_g = ${v.carbsG}, fat_g = ${v.fatG},
          serving_amount = ${v.servingAmount}, contains = ${tx.array([...v.contains])}, may_contain = ${tx.array([...v.mayContain])}, updated_at = clock_timestamp()
        WHERE id = ${target} AND user_id = ${userId}
        RETURNING ${tx.unsafe(COLUMNS)}`;
      return changed ?? "taken";
    }
    const [kept] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM member_label_foods WHERE user_id = ${userId} AND removed_at IS NULL`;
    if ((kept?.n ?? 0) >= LABEL_FOODS_MOST) return "full";
    const [made] = await tx<LabelFoodRow[]>`
      INSERT INTO member_label_foods (id, user_id, code, name, unit, kcal, protein_g, carbs_g, fat_g, serving_amount, contains, may_contain)
      VALUES (${id}, ${userId}, ${v.code}, ${v.name}, ${v.unit}, ${v.kcal}, ${v.proteinG}, ${v.carbsG}, ${v.fatG}, ${v.servingAmount}, ${tx.array([...v.contains])}, ${tx.array([...v.mayContain])})
      RETURNING ${tx.unsafe(COLUMNS)}`;
    return made ?? "taken";
  });
}

export async function removeLabelFood(sql: Sql, userId: string, id: string): Promise<boolean> {
  const gone = await sql`UPDATE member_label_foods SET removed_at = now() WHERE id = ${id} AND user_id = ${userId} AND removed_at IS NULL`;
  if (gone.count === 0) return false;
  await sql`
    DELETE FROM member_label_foods WHERE user_id = ${userId} AND removed_at IS NOT NULL AND (
      removed_at < now() - make_interval(days => ${REMOVED_KEPT_DAYS})
      OR id NOT IN (SELECT id FROM member_label_foods WHERE user_id = ${userId} AND removed_at IS NOT NULL ORDER BY removed_at DESC, id LIMIT ${REMOVED_KEPT_MOST}))`;
  return true;
}
