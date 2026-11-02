import { describe, expect, it } from "vitest";
import { foodsOfRow, loggedOfDay, planDayName, planDayOf, planMealAsMeal, stepDay } from "../src/screens/food/planRules";

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
