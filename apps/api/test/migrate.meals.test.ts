// P2.7d — pure transform tests for the meals stage (no DB/Mongo). The key
// guard: the synthesized item must pass @app/shared mealItemSchema, else every
// migrated meal 500s on read (nutrition/repo.ts:60).
import { describe, expect, it } from "vitest";
import { mealItemSchema } from "@app/shared";
import { transformMeal } from "../tools/migrate-mongo/collections/meals.js";
import { uuidv5 } from "../tools/migrate-mongo/uuid5.js";

const mid = "6a0d8b84808fba26c9adde34";
const uid = "6a0d468a98494b5b25602e8e";

function meal(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: mid,
    user_id: uid,
    meal_type: "breakfast",
    food_name: "Apple",
    quantity: 1,
    kcal: 240,
    protein_g: 0.6,
    carbs_g: 60,
    fat_g: 0.6,
    fiber_g: 8,
    notes: "Estimated from photo: Fresh Apples",
    consumed_at: "2026-05-20T10:23:00.970Z",
    ...over,
  };
}

describe("transformMeal", () => {
  it("builds a schema-VALID single item + row totals; ±30% kcal band", () => {
    const row = transformMeal(meal());
    expect(row).not.toBeNull();
    if (row === null) return;

    expect(row.id).toBe(uuidv5(mid));
    expect(row.userId).toBe(uuidv5(uid));
    expect(row.legacyMongoId).toBe(mid);
    expect(row.mealName).toBe("Apple");
    expect(row.kcalPoint).toBe(240);
    expect(row.kcalLow).toBe(168); // round(240*0.7)
    expect(row.kcalHigh).toBe(312); // round(240*1.3)

    // THE guard: the item conforms to mealItemSchema (reads won't 500)
    expect(row.items).toHaveLength(1);
    expect(() => mealItemSchema.parse(row.items[0])).not.toThrow();
    const item = row.items[0];
    expect(item.portionSource).toBe("legacy"); // honest "not a real measurement" flag
    expect(item.nutritionSource).toBe("curated"); // enum has no legacy value
    expect(item.gramsPoint).toBe(100);
    expect(item.gramsRange).toEqual([70, 130]);
    expect(item.kcalPoint).toBe(240);
    expect(item.proteinG).toBe(0.6);
    expect(item.carbsG).toBe(60);
    expect(item.fatG).toBe(0.6);
  });

  it("drops meal_type/fiber_g/notes/quantity (no target)", () => {
    const row = transformMeal(meal());
    expect(Object.keys(row ?? {})).not.toContain("meal_type");
    expect(Object.keys(row ?? {})).not.toContain("fiber_g");
    expect(Object.keys(row ?? {})).not.toContain("notes");
    expect(Object.keys(row ?? {})).not.toContain("quantity");
    // grams are NOT derived from quantity (would be misleading)
    expect(row?.items[0]?.gramsPoint).toBe(100);
  });

  it("missing consumed_at → null (taken_at is NOT NULL)", () => {
    expect(transformMeal(meal({ consumed_at: null }))).toBeNull();
    expect(transformMeal(meal({ consumed_at: "not-a-date" }))).toBeNull();
  });

  it("missing/invalid kcal + macros → 0, still a valid item", () => {
    const row = transformMeal({ _id: mid, user_id: uid, consumed_at: "2026-05-20T10:23:00Z" });
    expect(row?.kcalPoint).toBe(0);
    expect(row?.kcalLow).toBe(0);
    expect(row?.kcalHigh).toBe(0);
    expect(row?.mealName).toBe("Legacy meal"); // food_name absent → fallback
    expect(() => mealItemSchema.parse(row?.items[0])).not.toThrow();
  });

  it("negative macros clamp to 0 (schema requires nonnegative)", () => {
    const row = transformMeal(meal({ protein_g: -5, fat_g: -1 }));
    expect(row?.items[0]?.proteinG).toBe(0);
    expect(row?.items[0]?.fatG).toBe(0);
    expect(() => mealItemSchema.parse(row?.items[0])).not.toThrow();
  });

  it("is deterministic: same doc → same id", () => {
    expect(transformMeal(meal())?.id).toBe(transformMeal(meal())?.id);
  });
});
