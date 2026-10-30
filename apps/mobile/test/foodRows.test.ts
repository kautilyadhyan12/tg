import { describe, expect, it } from "vitest";
import type { Meal, MealItem, WaitingChange } from "@app/shared";
import {
  amountOf,
  clockWords,
  foodLines,
  foodNames,
  foodsHeld,
  measuresWithoutServer,
  serverRow,
  steppedTime,
  totalsOf,
  typedAmount,
  waitingRow,
  withAmount,
  withChanges,
  without,
} from "../src/screens/food/rows";

// How a meal reads while a change to it waits to be sent (ROADMAP 32b-ii-a): every class of case.

const ID = "11111111-1111-4111-8111-111111111111";
const item = (name: string, grams: number, kcal: number, over: Partial<MealItem> = {}): MealItem => ({
  name, canonical: name.toLowerCase(), gramsPoint: grams, gramsRange: [grams, grams], portionSource: "default", nutritionSource: "usda",
  kcalPoint: kcal, kcalLow: kcal, kcalHigh: kcal, proteinG: 1, carbsG: 2, fatG: 3, ...over,
});
const OATS = item("Oats", 81, 307, { measure: { id: "usda-1", name: "cup", amount: 1 } });
const BANANA = item("Banana", 118, 105, { measure: { id: "serving", name: "banana", amount: 1 } });
const meal: Meal = {
  id: ID, takenAt: "2026-10-28T12:30:00.000Z", mealType: "lunch", mealName: "Lunch plate", items: [OATS, BANANA],
  totals: totalsOf([OATS, BANANA]), confirmed: true, origin: "manual", portionSource: "default", nutritionSources: ["usda"], calcVersion: 1, itemsVersion: "v1",
};
const change = (body: Partial<WaitingChange["body"]>, over: Partial<WaitingChange> = {}): WaitingChange => ({
  id: ID, name: "Lunch plate", body: { changeId: "22222222-2222-4222-8222-222222222222", ...body }, items: null, totals: null, foods: null, tried: false, ...over,
});

describe("a meal with changes waiting", () => {
  it("with none reads as the server has it", () => {
    expect(withChanges(serverRow(meal), undefined)).toEqual(serverRow(meal));
    expect(withChanges(serverRow(meal), [])).toEqual(serverRow(meal));
  });

  it("takes each change's name, meal and time in the order made, and waits", () => {
    const row = withChanges(serverRow(meal), [change({ mealName: "First", mealType: "dinner" }), change({ mealName: "Second" })]);
    expect([row.name, row.mealType, row.section, row.waiting]).toEqual(["Second", "dinner", "dinner", true]);
    expect(row.totals).toEqual(meal.totals);
    expect(row.foodsChange).toBeNull();
  });

  it("with no meal of its own, sits where its new time puts it", () => {
    const untyped = serverRow({ ...meal, mealType: null, takenAt: new Date(2026, 9, 28, 8, 0).toISOString() });
    expect(untyped.section).toBe("breakfast");
    expect(withChanges(untyped, [change({ takenAt: new Date(2026, 9, 28, 20, 0).toISOString() })]).section).toBe("dinner");
  });

  it("whose foods changed with the server's preview reads its numbers; with none, not known", () => {
    const priced = [item("Oats", 122, 461, { measure: { id: "usda-1", name: "cup", amount: 1.5 } }), BANANA];
    const withPreview = withChanges(serverRow(meal), [change({ items: [{ from: 0, canonical: "oats", measure: "usda-1", amount: 1.5 }, { from: 1 }], itemsVersion: "v1" }, { items: priced, totals: totalsOf(priced) })]);
    expect(withPreview.totals?.kcalPoint).toBe(566);
    expect(foodLines(withPreview).map((l) => [l.name, l.amount, l.kcal])).toEqual([["Oats", "1.5 × cup · 122 g", 461], ["Banana", "1 × banana · 118 g", 105]]);
    const offline = withChanges(serverRow(meal), [
      change({ items: [{ from: 0, canonical: "oats", measure: "usda-1", amount: 1.5 }, { from: 1 }], itemsVersion: "v1" }, { foods: [{ name: "Oats", amount: "1.5 × cup" }, { name: "Banana", amount: "1 × banana · 118 g" }] }),
    ]);
    expect(offline.totals).toBeNull();
    expect(foodLines(offline).map((l) => l.kcal)).toEqual([null, null]);
    expect(foodsHeld(offline)).toBe("change_waiting");
  });

  it("a later name change keeps the foods change before it", () => {
    const foods = change({ items: [{ from: 1 }], itemsVersion: "v1" }, { items: [BANANA], totals: totalsOf([BANANA]) });
    const row = withChanges(serverRow(meal), [foods, change({ mealName: "Just a banana" })]);
    expect([row.name, row.totals?.kcalPoint, row.foodsChange]).toEqual(["Just a banana", 105, foods]);
  });
});

describe("a food titled by what the photo saw, while a change waits", () => {
  it("still says the food its numbers are from (33b-ii's worst thing, round one)", () => {
    const seen: MealItem = { ...BANANA, seenAs: "Ripe plantain" };
    const offline = withChanges(serverRow(meal), [
      change({ items: [{ from: 0 }], itemsVersion: "v1" }, { foods: [{ ...foodNames(seen), amount: "Part of Bowl, full" }] }),
    ]);
    expect(foodLines(offline)[0]).toEqual({ name: "Ripe plantain", numbersFrom: { name: BANANA.name, source: BANANA.nutritionSource }, amount: "Part of Bowl, full", kcal: null });
    expect(foodNames(BANANA)).toEqual({ name: BANANA.name });
    // A change kept before this job has no such line, and still reads.
    expect(foodLines(withChanges(serverRow(meal), [change({ items: [{ from: 0 }], itemsVersion: "v1" }, { foods: [{ name: "Oats", amount: "1 cup" }] })]))[0]?.numbersFrom).toBeNull();
  });
});

describe("whose foods can be changed", () => {
  it("a saved meal's can; one still waiting to be sent, or with a foods change waiting, cannot", () => {
    expect(foodsHeld(serverRow(meal))).toBeNull();
    const waiting = waitingRow({ id: ID, body: { id: ID, mealName: "Oats", takenAt: meal.takenAt, items: [{ canonical: "oats", grams: 81 }] }, items: null, totals: null, tried: false });
    expect(foodsHeld(waiting)).toBe("not_sent");
    expect(foodsHeld(withChanges(serverRow(meal), [change({ mealName: "Renamed" })]))).toBeNull();
  });
});

describe("a food's new amount", () => {
  const cases: [string, MealItem, { measure: string; amount: string }][] = [
    ["a food list measure", OATS, { measure: "usda-1", amount: "1" }],
    ["ounces", item("Almonds", 28.35, 164, { measure: { id: "oz", name: "oz", amount: 1 } }), { measure: "oz", amount: "1" }],
    ["grams", item("Curd", 75, 45, { measure: { id: "g", name: "g", amount: 75 } }), { measure: "g", amount: "75" }],
    ["no measure (a scan's grams)", item("Dal", 152.4, 180), { measure: "g", amount: "152" }],
    ["a saved dish, by its grams", item("Khichdi", 180, 210, { measure: { id: "dish", name: "My bowl", amount: 0.5 } }), { measure: "g", amount: "180" }],
    ["under half a gram, one gram", item("Saffron", 0.2, 0), { measure: "g", amount: "1" }],
  ];
  for (const [name, logged, want] of cases) {
    it(`starts from ${name}`, () => {
      expect(amountOf(logged)).toEqual(want);
    });
  }

  it("with no answer from the server, offers grams and the food's own measure", () => {
    expect(measuresWithoutServer(OATS)).toEqual([{ id: "g", name: "g", grams: 1 }, { id: "usda-1", name: "cup", grams: 81 }]);
    expect(measuresWithoutServer(item("Dal", 150, 180))).toEqual([{ id: "g", name: "g", grams: 1 }]);
  });

  it("names every other food as it was saved, and the one changed by its new amount", () => {
    expect(withAmount([OATS, BANANA], 0, "oats", { measure: "usda-1", amount: 1.5 })).toEqual([{ from: 0, canonical: "oats", measure: "usda-1", amount: 1.5 }, { from: 1 }]);
    expect(without([OATS, BANANA], 0)).toEqual([{ from: 1 }]);
  });

  it("reads before the server weighs it", () => {
    expect(typedAmount({ id: "usda-1", name: "cup", grams: 81 }, 1.5)).toBe("1.5 × cup");
    expect(typedAmount({ id: "g", name: "g", grams: 1 }, 150)).toBe("150 g");
    expect(typedAmount({ id: "oz", name: "oz", grams: 28.35 }, 2)).toBe("2 oz");
  });
});

describe("a meal's time", () => {
  it("steps a quarter of an hour, never off its own day", () => {
    const at = (h: number, m: number) => new Date(2026, 9, 28, h, m).toISOString();
    expect(steppedTime(at(12, 30), 1)).toBe(at(12, 45));
    expect(steppedTime(at(12, 30), -1)).toBe(at(12, 15));
    expect(steppedTime(at(0, 10), -1)).toBe(at(0, 10));
    expect(steppedTime(at(23, 50), 1)).toBe(at(23, 50));
  });

  it("reads as a twelve-hour clock", () => {
    const at = (h: number, m: number) => new Date(2026, 9, 28, h, m).toISOString();
    expect([clockWords(at(0, 5)), clockWords(at(8, 30)), clockWords(at(12, 0)), clockWords(at(23, 45))]).toEqual(["12:05 AM", "8:30 AM", "12:00 PM", "11:45 PM"]);
  });
});
