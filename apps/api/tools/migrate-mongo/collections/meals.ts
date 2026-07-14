// P2.7d — meals stage. Transforms a legacy `meal_logs` doc into a `meal_logs`
// row with ONE synthetic `items[]` entry, and inserts it idempotently. Field
// contract mirrors modules/nutrition/repo.ts createMeal, but with legacy-fixed
// values (confirmed=true, origin='manual', portion_source='legacy',
// nutrition_sources=['legacy_model'], calc_version=0) per DECISIONS 2026-07-13.
// GAP-A: legacy meals lack grams + a nutrition source, but mealItemSchema
// (@app/shared) requires both and re-validates on every read — so the item is
// synthesized with a placeholder portion flagged portionSource='legacy'.
import { z } from "zod";
import type { Sql } from "postgres";
import type { MealItem } from "@app/shared";
import { uuidv5 } from "../uuid5.js";

// Boundary parse (R2.3) — only the fields the transform reads. `_id`/`user_id`
// arrive as reader-normalized hex strings (mongo.ts). Dropped (GAP-B):
// meal_type, fiber_g, notes, quantity. Lenient; unknown keys pass through.
const legacyMealSchema = z
  .object({
    _id: z.string().min(1),
    user_id: z.string().min(1),
    food_name: z.string().nullish(),
    kcal: z.number().nullish(),
    protein_g: z.number().nullish(),
    carbs_g: z.number().nullish(),
    fat_g: z.number().nullish(),
    consumed_at: z.union([z.date(), z.string()]).nullish(),
  })
  .passthrough();

function toDate(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Finite non-negative number, else 0 (macros are z.number().nonnegative()). */
function toNonNeg(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Non-negative integer kcal (schema: z.number().int().nonnegative()). */
function toKcalInt(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

export interface MealRow {
  id: string;
  userId: string;
  takenAt: Date;
  mealName: string | null;
  items: [MealItem]; // exactly one synthetic item
  kcalPoint: number;
  kcalLow: number;
  kcalHigh: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  legacyMongoId: string;
}

/** Pure transform — null when the doc is too malformed to migrate (missing
 *  `consumed_at`, which maps to the NOT NULL `taken_at`). */
export function transformMeal(doc: unknown): MealRow | null {
  const parsed = legacyMealSchema.safeParse(doc);
  if (!parsed.success) return null;
  const m = parsed.data;

  const takenAt = toDate(m.consumed_at);
  if (takenAt === null) return null; // taken_at is NOT NULL

  const kcalPoint = toKcalInt(m.kcal);
  const kcalLow = Math.round(kcalPoint * 0.7);
  const kcalHigh = Math.round(kcalPoint * 1.3);
  const proteinG = toNonNeg(m.protein_g);
  const carbsG = toNonNeg(m.carbs_g);
  const fatG = toNonNeg(m.fat_g);
  const name = typeof m.food_name === "string" && m.food_name.trim() !== "" ? m.food_name.trim() : "Legacy meal";

  // GAP-A synthetic item: placeholder grams flagged portionSource='legacy';
  // nutritionSource='curated' (enum has no legacy value — row-level
  // nutrition_sources carries the honest 'legacy_model' provenance).
  const item: MealItem = {
    name,
    canonical: name,
    gramsPoint: 100,
    gramsRange: [70, 130],
    portionSource: "legacy",
    nutritionSource: "curated",
    kcalPoint,
    kcalLow,
    kcalHigh,
    proteinG,
    carbsG,
    fatG,
  };

  return {
    id: uuidv5(m._id),
    userId: uuidv5(m.user_id),
    takenAt,
    mealName: name,
    items: [item],
    kcalPoint,
    kcalLow,
    kcalHigh,
    proteinG,
    carbsG,
    fatG,
    legacyMongoId: m._id,
  };
}

/** Idempotent insert (ON CONFLICT (id) — deterministic UUIDv5 PK). Row totals
 *  equal the single item; fixed legacy values per DECISIONS. */
export async function insertMeal(sql: Sql, r: MealRow): Promise<number> {
  const res = await sql`
    INSERT INTO meal_logs (id, user_id, taken_at, meal_name, items,
                           kcal_point, kcal_low, kcal_high,
                           protein_g, carbs_g, fat_g,
                           confirmed, origin, portion_source, nutrition_sources,
                           calc_version, legacy_mongo_id)
    VALUES (${r.id}, ${r.userId}, ${r.takenAt}, ${r.mealName}, ${sql.json(r.items)},
            ${r.kcalPoint}, ${r.kcalLow}, ${r.kcalHigh},
            ${r.proteinG}, ${r.carbsG}, ${r.fatG},
            true, 'manual', 'legacy', ${["legacy_model"]},
            0, ${r.legacyMongoId})
    ON CONFLICT (id) DO NOTHING`;
  return res.count;
}
