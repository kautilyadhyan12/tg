// ROADMAP 7a-iv-g — changing a food already logged (RULINGS 2026-09-17). The two
// rules an edit of a saved meal turns on, each as one table over every class of
// case: which saved item each edited item is, and the person's own numbers per
// 100 g, their calories worked out from protein, carbs and fat.
import { describe, expect, it } from "vitest";
import { mealEditItemSchema, patchMealRequestSchema, per100gSchema, type MealEditItem } from "@app/shared";
import { KCAL_PER_GRAM, ownPer100g, savedPlaces } from "../src/modules/nutrition/mealEdit.js";

const meal = (...canonicals: string[]) => canonicals.map((canonical) => ({ canonical }));
/** An edit by grams, naming its saved item or not. */
const g = (canonical: string, from?: number): MealEditItem => (from === undefined ? { canonical, grams: 100 } : { canonical, grams: 100, from });
/** An edit that keeps a saved item as it is. */
const keep = (from: number): MealEditItem => ({ from });

describe("savedPlaces: which saved item each edit is", () => {
  const cases: [string, string[], MealEditItem[], (number | null)[] | null][] = [
    // Named items.
    ["named, in order", ["a", "b"], [g("a", 0), g("b", 1)], [0, 1]],
    ["named, reordered", ["a", "b"], [g("b", 1), g("a", 0)], [1, 0]],
    ["kept items name theirs", ["a", "b", "c"], [keep(2), keep(0)], [2, 0]],
    ["a food named with a measure", ["a"], [{ canonical: "a", measure: "serving", amount: 2, from: 0 }], [0]],
    ["a food named with a dish", ["a"], [{ canonical: "a", dishwareId: "00000000-0000-4000-8000-000000000000", fillLevel: 0.5, from: 0 }], [0]],
    ["one removed, the rest named", ["a", "b", "c"], [keep(0), keep(2)], [0, 2]],
    // The meal changed after the screen read it: no item is guessed.
    ["named past the end", ["a"], [g("a", 1)], null],
    ["kept past the end", ["a"], [keep(3)], null],
    ["named, another food there", ["a", "b"], [g("b", 0)], null],
    ["an empty meal named", [], [keep(0)], null],
    // Unnamed items: their own place where it is that food, else the first of it.
    ["unnamed, in place", ["a", "b"], [g("a"), g("b")], [0, 1]],
    ["unnamed, moved", ["b", "a"], [g("a"), g("b")], [1, 0]],
    ["unnamed, new to the meal", ["a"], [g("a"), g("c")], [0, null]],
    ["unnamed, into an empty meal", [], [g("a")], [null]],
    ["unnamed, one food twice, in place", ["a", "a"], [g("a"), g("a")], [0, 1]],
    ["unnamed, the first of two removed", ["a", "b", "a"], [g("a"), g("a")], [0, 2]],
    ["unnamed, order kept past a removed other food", ["x", "a", "a"], [g("a"), g("a")], [1, 2]],
    ["unnamed, more of a food than the meal holds", ["a"], [g("a"), g("a")], [0, null]],
    // Named items claim first; an unnamed one never takes a named one's item.
    ["unnamed in the place a named one took", ["a", "a"], [g("a"), g("a", 0)], [1, 0]],
    ["unnamed beside a kept one of the same food", ["a", "a"], [keep(1), g("a")], [1, 0]],
    ["unnamed, every item of its food named", ["a", "a"], [keep(0), keep(1), g("a")], [0, 1, null]],
  ];
  it.each(cases)("%s", (_name, saved, edits, expected) => {
    expect(savedPlaces(meal(...saved), edits)).toEqual(expected);
  });

  it("never gives one saved item to two edits, whatever the edits", () => {
    const foods = ["a", "b"];
    const edits: MealEditItem[][] = [];
    // Every list of up to three edits of foods a and b, unnamed or named 0–2.
    const one: MealEditItem[] = foods.flatMap((f) => [g(f), g(f, 0), g(f, 1), g(f, 2)]).concat([keep(0), keep(1), keep(2)]);
    for (const x of one) for (const y of one) { edits.push([x, y]); for (const z of one) edits.push([x, y, z]); }
    for (const saved of [["a"], ["a", "a"], ["a", "b", "a"], ["b", "a", "a"]]) {
      for (const list of edits) {
        const named = list.flatMap((e) => (e.from === undefined ? [] : [e.from]));
        if (new Set(named).size !== named.length) continue; // the contract refuses these
        const places = savedPlaces(meal(...saved), list);
        if (places === null) continue;
        const taken = places.filter((p): p is number => p !== null);
        expect(new Set(taken).size, JSON.stringify([saved, list])).toBe(taken.length);
        // Every item found is the same food as its edit.
        for (const [at, place] of places.entries()) {
          const edit = list[at];
          if (place !== null && edit !== undefined && "canonical" in edit) expect(saved[place]).toBe(edit.canonical);
        }
      }
    }
  });

  it("the contract refuses a saved item named twice, a kept item with anything beside it, and own numbers past 10,000 g", () => {
    expect(patchMealRequestSchema.safeParse({ items: [keep(0), g("a", 0)] }).success).toBe(false);
    expect(patchMealRequestSchema.safeParse({ items: [keep(0), keep(1)] }).success).toBe(true);
    expect(mealEditItemSchema.safeParse({ from: 0, grams: 100 }).success).toBe(false);
    expect(mealEditItemSchema.safeParse({ from: 30 }).success).toBe(false);
    expect(mealEditItemSchema.safeParse({ from: -1 }).success).toBe(false);
    expect(mealEditItemSchema.safeParse({ from: 1.5 }).success).toBe(false);
    expect(mealEditItemSchema.safeParse({ canonical: "a", grams: 100, own: { proteinG: 1, carbsG: 1, fatG: 1 } }).success).toBe(true);
    expect(mealEditItemSchema.safeParse({ canonical: "a", grams: 100, own: null }).success).toBe(true);
    expect(mealEditItemSchema.safeParse({ canonical: "a", grams: 100, own: { proteinG: -1, carbsG: 1, fatG: 1 } }).success).toBe(false);
    expect(mealEditItemSchema.safeParse({ canonical: "a", grams: 100, own: { proteinG: 10_001, carbsG: 0, fatG: 0 } }).success).toBe(false);
    expect(mealEditItemSchema.safeParse({ canonical: "a", grams: 100, own: { proteinG: 1, carbsG: 1 } }).success).toBe(false);
    expect(mealEditItemSchema.safeParse({ canonical: "a", grams: 100, own: { proteinG: 1, carbsG: 1, fatG: 1, kcal: 9 } }).success).toBe(false);
    expect(mealEditItemSchema.safeParse({ from: 0, own: null }).success).toBe(false);
    expect(patchMealRequestSchema.safeParse({ items: [] }).success).toBe(false);
  });
});

describe("ownPer100g: the person's own numbers, per 100 g", () => {
  const cases: [string, { proteinG: number; carbsG: number; fatG: number }, number, { kcal: number; proteinG: number; carbsG: number; fatG: number } | null][] = [
    ["a label's numbers", { proteinG: 30, carbsG: 3, fatG: 20 }, 150, { kcal: 208, proteinG: 20, carbsG: 2, fatG: 40 / 3 }],
    ["a gram of protein is 4 kcal", { proteinG: 1, carbsG: 0, fatG: 0 }, 100, { kcal: 4, proteinG: 1, carbsG: 0, fatG: 0 }],
    ["a gram of carbohydrate is 4 kcal", { proteinG: 0, carbsG: 1, fatG: 0 }, 100, { kcal: 4, proteinG: 0, carbsG: 1, fatG: 0 }],
    ["a gram of fat is 9 kcal", { proteinG: 0, carbsG: 0, fatG: 1 }, 100, { kcal: 9, proteinG: 0, carbsG: 0, fatG: 1 }],
    ["nothing at all (black coffee)", { proteinG: 0, carbsG: 0, fatG: 0 }, 240, { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }],
    ["decimals, as a label gives them", { proteinG: 2.5, carbsG: 12.4, fatG: 0.8 }, 50, { kcal: (4 * 2.5 + 4 * 12.4 + 9 * 0.8) * 2, proteinG: 5, carbsG: 24.8, fatG: 1.6 }],
    ["all fat, as heavy as the food", { proteinG: 0, carbsG: 0, fatG: 14 }, 14, { kcal: 900, proteinG: 0, carbsG: 0, fatG: 100 }],
    ["all protein, as heavy as the food", { proteinG: 0.69, carbsG: 0, fatG: 0 }, 0.69, { kcal: 400, proteinG: 100, carbsG: 0, fatG: 0 }],
    ["heavier than the food", { proteinG: 100, carbsG: 40, fatG: 20 }, 150, null],
    ["a hair heavier than the food", { proteinG: 50, carbsG: 50, fatG: 0.01 }, 100, null],
    ["no grams", { proteinG: 0, carbsG: 0, fatG: 0 }, 0, null],
    ["grams below nothing", { proteinG: 0, carbsG: 0, fatG: 0 }, -5, null],
    ["grams that are no number", { proteinG: 0, carbsG: 0, fatG: 0 }, Number.NaN, null],
  ];
  it.each(cases)("%s", (_name, own, grams, expected) => {
    const got = ownPer100g(own, grams);
    if (expected === null) { expect(got).toBeNull(); return; }
    expect(got).not.toBeNull();
    for (const key of ["kcal", "proteinG", "carbsG", "fatG"] as const) expect(got?.[key], key).toBeCloseTo(expected[key], 9);
  });

  it("the calories always agree with protein, carbs and fat, and every figure fits a meal item", () => {
    expect(KCAL_PER_GRAM).toEqual({ protein: 4, carbs: 4, fat: 9 });
    for (const grams of [0.69, 1, 7, 33, 100, 150, 600, 9_999.5]) {
      for (const share of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.3, 0.3, 0.4], [0.1, 0.05, 0.02], [1 / 3, 1 / 3, 1 / 3]]) {
        const [p = 0, c = 0, f = 0] = share;
        const own = { proteinG: p * grams, carbsG: c * grams, fatG: f * grams };
        if (own.proteinG + own.carbsG + own.fatG > grams) continue;
        const figures = ownPer100g(own, grams);
        expect(figures, JSON.stringify([grams, share])).not.toBeNull();
        if (figures === null) continue;
        // What the contract says a meal item's figures may be.
        expect(per100gSchema.safeParse(figures).success, JSON.stringify([grams, share, figures])).toBe(true);
        expect(figures.kcal).toBeCloseTo(4 * figures.proteinG + 4 * figures.carbsG + 9 * figures.fatG, 6);
        // And back at the grams typed, the numbers typed.
        expect((figures.proteinG * grams) / 100).toBeCloseTo(own.proteinG, 6);
      }
    }
  });
});
