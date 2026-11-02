import { describe, expect, it } from "vitest";
import type { MealType } from "@app/shared";
import { dayWithMeal, foodsOfRow, loggedOfDay, planBasketFood, planDayName, planDayOf, planMealAsMeal, stepDay, withNewMeal } from "../src/screens/food/planRules";

const meal = (...foods: string[]) => ({ items: foods.map((canonical) => ({ canonical })) }) as never;

describe("which planned meals are already logged", () => {
  it.each([
    ["nothing logged", [["a", "b"], ["c"]], [], [false, false]],
    ["the same foods in another order", [["a", "b"]], [["b", "a"]], [true]],
    ["only some of the foods is not the meal", [["a", "b"]], [["a"]], [false]],
    ["more foods than planned is not the meal", [["a"]], [["a", "b"]], [false]],
    ["a logged meal counts for one planned meal: the second of two the same stays open", [["a"], ["a"]], [["a"]], [true, false]],
    ["two logged count for two", [["a"], ["a"]], [["a"], ["a"]], [true, true]],
    ["a food twice in a meal is not the food once", [["a", "a"]], [["a"]], [false]],
    ["an unrelated meal counts for nothing", [["a"]], [["z"]], [false]],
    ["the later meal logged first leaves the earlier open", [["a"], ["b"]], [["b"]], [false, true]],
  ])("%s", (_name, planned, logged, want) => {
    expect(loggedOfDay(planned.map((foods) => meal(...foods)), logged)).toEqual(want);
  });
});

describe("the foods of a row on today's list", () => {
  const body = { items: [{ canonical: "w", grams: 10 }] };
  it.each([
    ["the server's foods", { id: "1", items: [{ canonical: "a" }], saved: null }, ["a"]],
    ["the saved foods while a change has none yet: it still counts as logged", { id: "1", items: null, saved: { items: [{ canonical: "s" }] } }, ["s"]],
    ["a meal waiting to send, by what it was sent with", { id: "2", items: null, saved: null }, ["w"]],
    ["unknown", { id: "3", items: null, saved: null }, []],
  ])("%s", (_name, row, want) => {
    expect(foodsOfRow(row, [{ id: "2", body } as never])).toEqual(want);
  });
});

describe("a planned meal logged", () => {
  it("is sent by canonical and the plan's own grams, under its own meal, with the plan's totals", () => {
    const totals = { kcalPoint: 640, kcalLow: 600, kcalHigh: 700, proteinG: 40, carbsG: 60, fatG: 10 };
    const items = [{ canonical: "rice_white", name: "Rice", gramsPoint: 212 }, { canonical: "dal", name: "Dal", gramsPoint: 150 }];
    const kept = planMealAsMeal({ mealType: "snack", items, totals } as never, "id-1", new Date("2026-11-02T10:00:00.000Z"));
    expect(kept.body).toEqual({
      id: "id-1",
      mealName: "Rice + Dal",
      takenAt: "2026-11-02T10:00:00.000Z",
      mealType: "snack",
      items: [{ canonical: "rice_white", grams: 212 }, { canonical: "dal", grams: 150 }],
    });
    expect(kept.totals).toEqual(totals);
  });
});

describe("the plan's days", () => {
  it.each([
    ["2026-11-02T12:00:00", 1, "Monday"],
    ["2026-11-07T12:00:00", 6, "Saturday"],
    ["2026-11-08T12:00:00", 7, "Sunday"],
  ])("%s is day %i", (at, day, name) => {
    expect(planDayOf(new Date(at))).toBe(day);
    expect(planDayName(day)).toBe(name);
  });
  it("the week goes round", () => {
    expect(stepDay(7, 1)).toBe(1);
    expect(stepDay(1, -1)).toBe(7);
    expect(stepDay(3, 1)).toBe(4);
  });
});

describe("where a new meal goes in a day (34e-ii-b)", () => {
  const day = (...types: MealType[]) => types.map((mealType) => ({ mealType }));
  it.each<[string, MealType[], MealType, MealType[]]>([
    ["an empty day", [], "dinner", ["dinner"]],
    ["breakfast before everything", ["lunch", "dinner"], "breakfast", ["breakfast", "lunch", "dinner"]],
    ["a snack between lunch and dinner", ["breakfast", "lunch", "dinner"], "snack", ["breakfast", "lunch", "snack", "dinner"]],
    ["dinner last", ["breakfast", "snack"], "dinner", ["breakfast", "snack", "dinner"]],
    ["a second lunch after the first", ["breakfast", "lunch", "dinner"], "lunch", ["breakfast", "lunch", "lunch", "dinner"]],
    ["a day out of order keeps its order: after the last meal that comes before", ["dinner", "breakfast"], "lunch", ["dinner", "breakfast", "lunch"]],
  ])("%s", (_name, meals, type, want) => {
    expect(withNewMeal(day(...meals), { mealType: type }).map((m) => m.mealType)).toEqual(want);
  });
});

describe("a day sent back whole (34e-ii-b)", () => {
  const food = (canonical: string, gramsPoint: number, own = false) =>
    ({ canonical, gramsPoint, name: canonical, nutritionSource: own ? "own" : "usda", ...(own ? { per100g: { kcal: 400, proteinG: 10, carbsG: 50, fatG: 20 } } : {}) }) as never;
  const meals = [
    { mealType: "breakfast" as const, items: [food("oats", 80)] },
    { mealType: "lunch" as const, items: [food("rice", 200), food("own_curry", 150, true)] },
  ];
  it("every food not changed goes back as it was: a list food by its grams, an own food by its own numbers", () => {
    expect(dayWithMeal(meals, { at: 0, mealType: "breakfast", items: [{ canonical: "oats", measure: "usda-1", amount: 2 }] })).toEqual([
      { mealType: "breakfast", items: [{ canonical: "oats", measure: "usda-1", amount: 2 }] },
      { mealType: "lunch", items: [{ canonical: "rice", grams: 200 }, { name: "own_curry", grams: 150, own: { proteinG: 15, carbsG: 75, fatG: 30 } }] },
    ]);
  });
  it("a meal taken out leaves the others in order", () => {
    expect(dayWithMeal(meals, { at: 0, mealType: "breakfast", items: null }).map((m) => m.mealType)).toEqual(["lunch"]);
  });
  it("a new meal goes in its place, the others untouched", () => {
    const sent = dayWithMeal(meals, { at: null, mealType: "dinner", items: [{ canonical: "dal", grams: 150 }] });
    expect(sent.map((m) => m.mealType)).toEqual(["breakfast", "lunch", "dinner"]);
    expect(sent[0]).toEqual({ mealType: "breakfast", items: [{ canonical: "oats", grams: 80 }] });
  });
});

describe("a planned food in the food box (34e-ii-b)", () => {
  it("a list food opens at its amount with its own measures; an own food opens in its own form", () => {
    const listFood = { canonical: "rice", gramsPoint: 158, name: "Rice", nutritionSource: "usda", measure: { id: "usda-1", name: "cup", amount: 1 } } as never;
    const measures = [{ id: "g", name: "g", grams: 1 }, { id: "usda-1", name: "cup", grams: 158 }];
    const kept = planBasketFood(listFood, measures, "k1");
    expect(kept.chosen).toEqual({ canonical: "rice", grams: 158 });
    expect(kept.again?.amount).toEqual({ measure: "usda-1", amount: "1" });
    expect(kept.again?.food.measures).toEqual(measures);
    const own = planBasketFood({ canonical: "own_curry", gramsPoint: 150, name: "Curry", nutritionSource: "own", per100g: { kcal: 400, proteinG: 10, carbsG: 50, fatG: 20 } } as never, [], "k2");
    expect(own.again).toBeUndefined();
    expect(own.chosen).toEqual({ name: "Curry", grams: 150, own: { proteinG: 15, carbsG: 75, fatG: 30 } });
    expect(own.amount).toBe("150 g · your numbers");
  });
});
