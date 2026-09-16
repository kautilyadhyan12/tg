// ROADMAP 7a-iv-a — the contract for adding a food by measure: a chosen item is
// grams, a saved dish, or one of the food's own measures, and never two of them.
import { describe, expect, it } from "vitest";
import { chosenItemSchema, foodSearchItemSchema, mealItemSchema, measureIdSchema } from "../src/index.js";

describe("measureIdSchema", () => {
  it.each(["g", "oz", "serving", "usda-1", "usda-9999"])("takes %s", (id) => {
    expect(measureIdSchema.safeParse(id).success).toBe(true);
  });

  // An id is looked up in the food's own list, so only the shapes that list makes are ids at all.
  it.each(["cup", "usda-", "usda-12345", "USDA-1", "usda-1 ", "dish", "", "g;DROP"])("refuses %j", (id) => {
    expect(measureIdSchema.safeParse(id).success).toBe(false);
  });
});

describe("chosenItemSchema's measure arm", () => {
  const measured = { canonical: "apple", measure: "usda-4", amount: 1.5 };

  it("takes a food, one of its measures and how many", () => {
    expect(chosenItemSchema.parse(measured)).toEqual(measured);
  });

  it("is one arm only: a measure never rides with grams or a dish", () => {
    expect(chosenItemSchema.safeParse({ ...measured, grams: 100 }).success).toBe(false);
    expect(chosenItemSchema.safeParse({ ...measured, dishwareId: "0f8fad5b-d9cb-469f-a165-70867728950e", fillLevel: 0.5 }).success).toBe(false);
  });

  it("refuses an amount of nothing, below it, or past what a meal item may weigh in grams", () => {
    for (const amount of [0, -1, 10_001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(chosenItemSchema.safeParse({ ...measured, amount }).success, String(amount)).toBe(false);
    }
    expect(chosenItemSchema.safeParse({ ...measured, measure: "g", amount: 10_000 }).success).toBe(true);
  });
});

describe("a meal item's measure", () => {
  const item = {
    name: "Apple", canonical: "apple", gramsPoint: 273, gramsRange: [273, 273], portionSource: "default", nutritionSource: "curated",
    kcalPoint: 142, kcalLow: 142, kcalHigh: 142, proteinG: 0.7, carbsG: 37.7, fatG: 0.5,
  };

  it("is kept where it was logged by one, and absent where it was not", () => {
    const logged = { ...item, measure: { id: "usda-4", name: "medium (3\" dia)", amount: 1.5 } };
    expect(mealItemSchema.parse(logged).measure).toEqual(logged.measure);
    expect(mealItemSchema.parse(item).measure).toBeUndefined();
    expect(mealItemSchema.safeParse({ ...item, measure: { id: "dish", name: "My bowl", amount: 0 } }).success).toBe(false);
  });
});

describe("foodSearchItemSchema", () => {
  const food = {
    canonical: "apple", name: "Apple", kcal: 52, proteinG: 0.26, carbsG: 13.81, fatG: 0.17, fiberG: 2.4, serving: 180, unit: "apple", source: "curated",
    measures: [{ id: "serving", name: "apple", grams: 180 }, { id: "g", name: "g", grams: 1 }],
    startsAt: { measure: "serving", amount: 1 },
  };

  it("carries at least one measure, and the one the food starts at", () => {
    expect(foodSearchItemSchema.safeParse(food).success).toBe(true);
    expect(foodSearchItemSchema.safeParse({ ...food, measures: [] }).success).toBe(false);
    expect(foodSearchItemSchema.safeParse({ ...food, startsAt: undefined }).success).toBe(false);
    // A start that is none of its measures is no start a picker could show.
    expect(foodSearchItemSchema.safeParse({ ...food, startsAt: { measure: "oz", amount: 1 } }).success).toBe(false);
  });
});
