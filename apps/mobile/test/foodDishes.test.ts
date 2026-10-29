import { describe, expect, it } from "vitest";
import type { WaitingChange, WaitingMeal } from "@app/shared";
import { dishWaiting, dishWords, newDish } from "../src/screens/food/dishes";
import { chosenItem, dishMeasure, dishOf, loggedAmount } from "../src/screens/food/measures";
import { fourWords, holdWords, macroKcal, wholeNumber } from "../src/screens/food/numbers";
import { typedAmount, withAmount } from "../src/screens/food/rows";

// ROADMAP 32b-ii-b: what the phone sends and says for a saved dish and the rings' own numbers.

const BOWL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("a saved dish as a food's amount", () => {
  it("is sent with how full it was, and is no amount until that is picked", () => {
    const measure = dishMeasure(BOWL);
    expect(dishOf(measure)).toBe(BOWL);
    expect(dishOf("usda-1")).toBeNull();
    expect(chosenItem("oats_rolled", { measure, amount: "" })).toBeNull();
    expect(chosenItem("oats_rolled", { measure, amount: "0.4" })).toBeNull();
    expect(chosenItem("oats_rolled", { measure, amount: "0.5" })).toEqual({ canonical: "oats_rolled", dishwareId: BOWL, fillLevel: 0.5 });
    expect(chosenItem("oats_rolled", { measure, amount: "1" })).toEqual({ canonical: "oats_rolled", dishwareId: BOWL, fillLevel: 1 });
    // A food's own measure is sent as before.
    expect(chosenItem("oats_rolled", { measure: "usda-1", amount: "1.5" })).toEqual({ canonical: "oats_rolled", measure: "usda-1", amount: 1.5 });
  });

  it("changes a logged food to a dish, every other food kept as saved", () => {
    expect(withAmount([{}, {}] as never, 1, "oats_rolled", { dishwareId: BOWL, fillLevel: 0.75 })).toEqual([
      { from: 0 },
      { from: 1, canonical: "oats_rolled", dishwareId: BOWL, fillLevel: 0.75 },
    ]);
  });

  it("reads in words, never as a fraction", () => {
    expect(typedAmount(undefined, 0.75, { label: "My blue bowl" })).toBe("My blue bowl, three quarters full");
    expect(loggedAmount({ gramsPoint: 180, measure: { id: "dish", name: "My blue bowl", amount: 0.5 } })).toBe("My blue bowl, half full · 180 g");
    expect(dishWords({ label: "Mug", volumeMl: 325 })).toBe("Mug · 325 ml");
  });
});

describe("a new dish", () => {
  it("is a size, or a size in ml, with the person's name or one from its size", () => {
    expect(newDish("", null, "")).toBeNull();
    expect(newDish("", "Mug", "")).toEqual({ label: "My mug", containerClass: "mug", volumeMl: 325 });
    expect(newDish("  Soup bowl ", "Bowl", "")).toEqual({ label: "Soup bowl", containerClass: "cereal_bowl", volumeMl: 375 });
    expect(newDish("", "ml", "450")).toEqual({ label: "My dish", containerClass: "custom", volumeMl: 450 });
    expect(newDish("Jug", "ml", "1,5")).toEqual({ label: "Jug", containerClass: "custom", volumeMl: 2 });
  });

  it("refuses a size in ml the server would not take", () => {
    for (const ml of ["", "0", "0.4", "-5", "10001", "abc"]) expect(newDish("Jug", "ml", ml)).toBeNull();
    expect(newDish("Jug", "ml", "10000")).toMatchObject({ volumeMl: 10_000 });
  });
});

describe("a dish a waiting meal was weighed with", () => {
  const meal = (items: object[]): WaitingMeal =>
    ({ id: "m", body: { id: "m", mealName: "Oats", takenAt: "2026-10-29T08:00:00.000Z", items }, items: null, totals: null, tried: true }) as unknown as WaitingMeal;
  const change = (items: object[] | undefined): WaitingChange =>
    ({ id: "m2", name: "Oats", body: { changeId: "c", ...(items === undefined ? {} : { items, itemsVersion: "v1" }) }, items: null, totals: null, foods: null, tried: false }) as unknown as WaitingChange;

  it("is found in a waiting meal or a waiting change to one, and in nothing else", () => {
    const none = { waiting: [], changing: new Map() };
    expect(dishWaiting(none, BOWL)).toBe(false);
    expect(dishWaiting({ waiting: [meal([{ canonical: "oats", dishwareId: BOWL, fillLevel: 1 }])], changing: new Map() }, BOWL)).toBe(true);
    expect(dishWaiting({ waiting: [meal([{ canonical: "oats", measure: "g", amount: 50 }])], changing: new Map() }, BOWL)).toBe(false);
    expect(dishWaiting({ waiting: [meal([{ canonical: "oats", dishwareId: "other", fillLevel: 1 }])], changing: new Map() }, BOWL)).toBe(false);
    expect(dishWaiting({ waiting: [], changing: new Map([["m2", [change([{ from: 0 }, { from: 1, canonical: "oats", dishwareId: BOWL, fillLevel: 0.5 }])]]]) }, BOWL)).toBe(true);
    expect(dishWaiting({ waiting: [], changing: new Map([["m2", [change(undefined)]]]) }, BOWL)).toBe(false);
  });
});

describe("the rings' own numbers", () => {
  it("takes whole numbers only", () => {
    expect(wholeNumber("2000")).toBe(2000);
    expect(wholeNumber(" 60 ")).toBe(60);
    expect(wholeNumber("0")).toBe(0);
    for (const t of ["", "1.5", "-1", "2,000", "abc", "1234567"]) expect(wholeNumber(t)).toBeNull();
  });

  it("says what the macros come to and the four in one line", () => {
    expect(macroKcal({ proteinG: 150, carbsG: 200, fatG: 60 })).toBe(1940);
    expect(fourWords({ kcal: 2300, proteinG: 120, carbsG: 280, fatG: 75 }).replaceAll("\u00a0", " ")).toBe("2,300 kcal · Protein 120 g · Carbs 280 g · Fat 75 g");
    // A unit never stands alone at the start of a line.
    expect(fourWords({ kcal: 2300, proteinG: 120, carbsG: 280, fatG: 75 })).toContain("Fat\u00a075\u00a0g");
  });

  it("names the number that holds the person's own back, for every reason the server gives", () => {
    expect(holdWords(null)).toBeNull();
    expect(holdWords({ code: "below_floor", floorKcal: 1200 })).toBe("Your own calories can’t be used below the app’s lowest of 1,200 kcal a day.");
    expect(holdWords({ code: "no_cut_below_maintenance", maintenanceKcal: 2300, reasons: ["under_18"] })).toBe(
      "Your plan holds no calorie cut now, so your own calories can’t be used below 2,300 kcal a day, what keeps your weight.",
    );
    expect(holdWords({ code: "plan_incomplete" })).toBe("Your own numbers are kept. Answer the setup questions to use them.");
  });
});
