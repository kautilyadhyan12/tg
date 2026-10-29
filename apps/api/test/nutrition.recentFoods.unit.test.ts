// ROADMAP Stage 5 32b-ii-a — which foods are the person's recent ones, and at what amount: every
// class of case, as a table.
import { describe, expect, it } from "vitest";
import { RECENT_FOODS_MOST, type MealItem } from "@app/shared";
import { recentFoods } from "../src/modules/nutrition/recentFoods.js";

const item = (canonical: string, over: Partial<MealItem> = {}): MealItem => ({
  name: canonical.replace(/_/g, " "), canonical, gramsPoint: 100, gramsRange: [100, 100], portionSource: "default",
  nutritionSource: "curated", kcalPoint: 150, kcalLow: 150, kcalHigh: 150, proteinG: 5, carbsG: 20, fatG: 4, ...over,
});
const picked = (meals: MealItem[][]) => recentFoods(meals.map((items) => ({ items }))).map((f) => [f.canonical, f.add.measure, f.add.amount]);

describe("recent foods", () => {
  const cases: { name: string; meals: MealItem[][]; want: (string | number)[][] }[] = [
    { name: "no meals", meals: [], want: [] },
    {
      name: "newest meal first, a meal's foods in order",
      meals: [[item("oats"), item("banana")], [item("rice")]],
      want: [["oats", "g", 100], ["banana", "g", 100], ["rice", "g", 100]],
    },
    {
      name: "a food had twice is listed once, at its newest amount",
      meals: [[item("oats", { measure: { id: "usda-12", name: "cup", amount: 1.5 }, gramsPoint: 122 })], [item("oats", { measure: { id: "usda-12", name: "cup", amount: 1 } })]],
      want: [["oats", "usda-12", 1.5]],
    },
    {
      name: "the same food twice in one meal is listed once",
      meals: [[item("roti", { measure: { id: "serving", name: "roti", amount: 2 } }), item("roti", { measure: { id: "serving", name: "roti", amount: 1 } })]],
      want: [["roti", "serving", 2]],
    },
    {
      name: "the scan's estimate and the person's own numbers are left out, and do not hide an older table row",
      meals: [[item("dal", { nutritionSource: "estimate" }), item("paneer", { nutritionSource: "own" })], [item("dal")]],
      want: [["dal", "g", 100]],
    },
    {
      name: "a packaged product and a USDA food are kept",
      meals: [[item("off:5000159407236", { nutritionSource: "openfoodfacts", measure: { id: "serving", name: "bar", amount: 1 } }), item("usda:171287", { nutritionSource: "usda" })]],
      want: [["off:5000159407236", "serving", 1], ["usda:171287", "g", 100]],
    },
    {
      name: "a saved dish, grams, ounces, and a measure the list does not name: by grams, ounces kept",
      meals: [[
        item("khichdi", { measure: { id: "dish", name: "My bowl", amount: 0.5 }, gramsPoint: 180.4 }),
        item("curd", { measure: { id: "g", name: "g", amount: 75 }, gramsPoint: 75 }),
        item("almonds", { measure: { id: "oz", name: "oz", amount: 1 }, gramsPoint: 28.35 }),
        item("ghee", { measure: { id: "tbsp-old", name: "tablespoon", amount: 1 }, gramsPoint: 13.6 }),
      ]],
      want: [["khichdi", "g", 180], ["curd", "g", 75], ["almonds", "oz", 1], ["ghee", "g", 14]],
    },
    {
      name: "under half a gram is added as one gram, never none",
      meals: [[item("saffron", { gramsPoint: 0.2, gramsRange: [0.2, 0.2] })]],
      want: [["saffron", "g", 1]],
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(picked(c.meals)).toEqual(c.want);
    });
  }

  it(`stops at ${String(RECENT_FOODS_MOST)}, the newest`, () => {
    const meals = Array.from({ length: 15 }, (_, i) => [item(`food_${String(i)}`)]);
    expect(picked(meals).map(([c]) => c)).toEqual(Array.from({ length: RECENT_FOODS_MOST }, (_, i) => `food_${String(i)}`));
  });

  it("carries the food as it was last logged, the server's own numbers for that amount", () => {
    const logged = item("oats", { name: "Oats, rolled", measure: { id: "usda-12", name: "cup", amount: 1.5 }, gramsPoint: 122, kcalPoint: 462 });
    expect(recentFoods([{ items: [logged] }])).toEqual([{ canonical: "oats", source: "curated", add: { measure: "usda-12", amount: 1.5 }, item: logged }]);
  });
});
