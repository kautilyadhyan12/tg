import { describe, expect, it } from "vitest";
import type { MealItem, MealPhotoAnalysis } from "@app/shared";
import { basketName, basketNumbers, foodsWords } from "../src/screens/food/basket";
import { sharedDish, sharedDishOfItems, sharesOf, wholeDishEdits } from "../src/screens/food/dishShares";
import { chosenItem, dishMeasure, loggedAmount } from "../src/screens/food/measures";
import { newSheet, sheetItems, withRowFood, withWholeDish } from "../src/screens/food/photo";

// A meal eaten from one dish (Kd, 2026-10-30): "the person is not taking each food in individual
// utensils … keep the dish option inside foods but as well as outside … to add as a bulk".

const BOWL = "00000000-0000-4000-8000-00000000d153";

describe("each food's part of one dish", () => {
  it("follows what each weighs now, together the whole dish", () => {
    expect(sharesOf([150, 100])).toEqual([0.6, 0.4]);
    expect(sharesOf([200, 100, 100])).toEqual([0.5, 0.25, 0.25]);
    expect(sharesOf([300])).toEqual([1]);
    // A food that weighs next to nothing still has some of the dish; nothing at all has no shares.
    expect(sharesOf([999, 0.1])).toEqual([0.999, 0.001]);
    expect(sharesOf([1, 1, 1])).toEqual([0.333, 0.333, 0.333]);
    expect(sharesOf([2, 1, 1, 1, 1, 1]).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1);
    expect(sharesOf([])).toEqual([]);
    expect(sharesOf([0, 0])).toEqual([]);
  });

  it("is sent with the dish, and a logged food reads as part of it", () => {
    expect(chosenItem("rice", { measure: dishMeasure(BOWL), amount: "1", share: 0.6 })).toEqual({ canonical: "rice", dishwareId: BOWL, fillLevel: 1, share: 0.6 });
    expect(chosenItem("rice", { measure: dishMeasure(BOWL), amount: "1" })).toEqual({ canonical: "rice", dishwareId: BOWL, fillLevel: 1 });
    expect(loggedAmount({ gramsPoint: 225, measure: { id: "dish", name: "My bowl", amount: 1, share: 0.6 } })).toBe("Part of My bowl, full · 225 g");
    expect(loggedAmount({ gramsPoint: 120, measure: { id: "dish", name: "Bowl", amount: 0.5, share: 0.4 } })).toBe("Part of Bowl, half full · 120 g");
  });
});

const measures = [{ id: "g" as const, name: "g", grams: 1 }];
const scanned = (name: string, canonical: string, grams: number): MealPhotoAnalysis["items"][number] => ({
  name, canonical, gramsPoint: grams, gramsRange: [grams, grams], portionSource: "default", nutritionSource: "curated",
  kcalPoint: grams, kcalLow: grams, kcalHigh: grams, proteinG: 1, carbsG: 1, fatG: 1, measures, startsAt: { measure: "g", amount: grams }, portionEstimated: false,
});
const ANALYSIS: MealPhotoAnalysis = {
  scanToken: "s".repeat(40), mealName: "Thali",
  items: [scanned("Rice", "rice", 150), scanned("Dal", "dal", 100), scanned("Sabzi", "sabzi", 50)],
  unknownItems: [], photoQuality: "good", totals: { kcalPoint: 300, kcalLow: 300, kcalHigh: 300, proteinG: 3, carbsG: 3, fatG: 3 }, confirmed: false,
};
const NOW = new Date(2026, 9, 30, 20, 0);
const TACO = { name: "Chicken taco", grams: 150, own: { proteinG: 18, carbsG: 20, fatG: 9 } };

describe("a photo's meal eaten from one dish", () => {
  it("gives each food of the lists its part of the dish; the person's own food keeps its grams", () => {
    const sheet = withRowFood(newSheet(ANALYSIS, NOW), "s2", { own: TACO });
    const shared = withWholeDish(sheet, BOWL, 0.75, [150, 100, 150]);
    expect(sheetItems(shared ?? sheet)).toEqual([
      { canonical: "rice", dishwareId: BOWL, fillLevel: 0.75, share: 0.6 },
      { canonical: "dal", dishwareId: BOWL, fillLevel: 0.75, share: 0.4 },
      TACO,
    ]);
  });

  it("waits while a food's weight is not known, and a food changed to another takes the dish too", () => {
    const sheet = newSheet(ANALYSIS, NOW);
    expect(withWholeDish(sheet, BOWL, 1, [150, null, 50])).toBeNull();
    const milk = withRowFood(sheet, "s0", { food: { canonical: "milk", name: "Milk", source: "usda", measures, startsAt: { measure: "g", amount: 240 } }, amount: { measure: "g", amount: "200" } });
    expect(sheetItems(withWholeDish(milk, BOWL, 1, [200, 100, 100]) ?? milk)?.[0]).toEqual({ canonical: "milk", dishwareId: BOWL, fillLevel: 1, share: 0.5 });
  });
});

const item = (name: string, canonical: string, grams: number, source: MealItem["nutritionSource"] = "curated"): MealItem => ({
  name, canonical, gramsPoint: grams, gramsRange: [grams, grams], portionSource: "default", nutritionSource: source,
  kcalPoint: grams, kcalLow: grams, kcalHigh: grams, proteinG: 1, carbsG: 1, fatG: 1,
});

describe("a logged meal eaten from one dish", () => {
  it("names each saved food once: those of the lists with their part, the own food kept", () => {
    expect(wholeDishEdits([item("Rice", "rice", 150), item("Taco", "own_taco", 150, "own"), item("Dal", "dal", 50)], BOWL, 1)).toEqual([
      { from: 0, canonical: "rice", dishwareId: BOWL, fillLevel: 1, share: 0.75 },
      { from: 1 },
      { from: 2, canonical: "dal", dishwareId: BOWL, fillLevel: 1, share: 0.25 },
    ]);
    expect(wholeDishEdits([item("Taco", "own_taco", 150, "own")], BOWL, 1)).toBeNull();
  });
});

describe("which dish a meal shows as its one dish", () => {
  it("is the dish every food is a part of, at one fill; else none", () => {
    const part = (fill: string, share = 0.5) => ({ measure: dishMeasure(BOWL), amount: fill, share });
    expect(sharedDish([part("1"), part("1")])).toEqual({ id: BOWL, fill: 1 });
    expect(sharedDish([part("1"), part("0.5")])).toBeNull();
    expect(sharedDish([part("1"), { measure: "g", amount: "100" }])).toBeNull();
    expect(sharedDish([{ measure: dishMeasure(BOWL), amount: "1" }])).toBeNull();
    expect(sharedDish([])).toBeNull();
    const dishItem = (fill: number): MealItem => ({ ...item("Rice", "rice", 100), measure: { id: "dish", name: "My bowl", amount: fill, share: 0.5 } });
    expect(sharedDishOfItems([dishItem(0.75), dishItem(0.75), item("Taco", "own_taco", 150, "own")])).toEqual({ name: "My bowl", fill: 0.75 });
    expect(sharedDishOfItems([dishItem(0.75), item("Dal", "dal", 50)])).toBeNull();
  });
});

describe("a typed meal of several foods (Kd, 2026-10-30: oats and milk)", () => {
  const oats = { name: "Oats, rolled", item: item("Oats, rolled", "oats", 81) };
  const milk = { name: "Milk (whole)", item: item("Milk (whole)", "milk", 244) };
  it("is named by its food, its two, or the first and how many more", () => {
    expect(basketName([oats])).toBe("Oats, rolled");
    expect(basketName([oats, milk])).toBe("Oats, rolled & Milk (whole)");
    expect(basketName([oats, milk, oats])).toBe("Oats, rolled & 2 more");
    expect(basketName([{ name: "x".repeat(300) }])).toHaveLength(200);
    expect(foodsWords(1)).toBe("1 food");
    expect(foodsWords(2)).toBe("2 foods");
  });
  it("adds up the server's numbers only where it priced every food", () => {
    expect(basketNumbers([oats, milk])?.totals.kcalPoint).toBe(81 + 244);
    expect(basketNumbers([oats, { item: null }])).toBeNull();
    expect(basketNumbers([])).toBeNull();
  });
});
