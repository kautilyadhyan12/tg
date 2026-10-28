import { describe, expect, it } from "vitest";
import type { Meal, MealPage, NutritionTargetsResponse } from "@app/shared";
import { MOST_MEAL_PAGES, addDays, daySums, dayWords, leftWords, noCutWords, sectionOf, walkDay } from "../src/screens/food/day";
import { FIRST_MEASURES, amountFor, chosenItem, shownMeasures, loggedAmount, measureWords, startingAmount, stepped, underAGram, unitWords } from "../src/screens/food/measures";

const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).toISOString();

function meal(id: number, takenAt: string, kcal = 100): Meal {
  return {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    takenAt,
    mealType: null,
    mealName: "Oats",
    items: [],
    totals: { kcalPoint: kcal, kcalLow: kcal, kcalHigh: kcal, proteinG: 1.4, carbsG: 2.4, fatG: 0.4 },
    confirmed: true,
    origin: "manual",
    portionSource: "default",
    nutritionSources: [],
    calcVersion: 1,
    itemsVersion: "v1",
  };
}

describe("the day's meals", () => {
  const day = new Date(2026, 9, 27);

  it("are read from newest-first pages until a page passes the day", async () => {
    const pages: Record<string, MealPage> = {
      first: { items: [meal(1, at(2026, 10, 28, 9)), meal(2, at(2026, 10, 27, 20))], nextCursor: "c2" },
      c2: { items: [meal(3, at(2026, 10, 27, 7)), meal(4, at(2026, 10, 26, 22))], nextCursor: "c3" },
    };
    const asked: (string | null)[] = [];
    const walked = await walkDay((cursor) => {
      asked.push(cursor);
      return Promise.resolve(pages[cursor ?? "first"] ?? null);
    }, day);
    expect(walked?.meals.map((m) => m.id.slice(-1))).toEqual(["2", "3"]);
    expect(walked?.cut).toBe(false);
    expect(asked).toEqual([null, "c2"]);
  });

  it("say so when the day lies deeper than the pages read", async () => {
    const walked = await walkDay(() => Promise.resolve({ items: [meal(1, at(2026, 10, 28, 9))], nextCursor: "more" }), day);
    expect(walked).toEqual({ meals: [], cut: true });
    let pages = 0;
    await walkDay(() => {
      pages += 1;
      return Promise.resolve({ items: [], nextCursor: "more" });
    }, day);
    expect(pages).toBe(MOST_MEAL_PAGES);
  });

  it("are nothing, never an empty day, when a page could not be read", async () => {
    expect(await walkDay(() => Promise.resolve(null), day)).toBeNull();
  });

  it("add up the server's own totals, and leave out a meal whose numbers are not known yet", () => {
    expect(daySums([{ totals: meal(1, "").totals }, { totals: meal(2, "", 250).totals }, { totals: null }])).toEqual({
      kcal: 350,
      proteinG: 3,
      carbsG: 5,
      fatG: 1,
    });
  });

  it("sit in the section the person picked, else where the hour puts it", () => {
    expect(sectionOf({ mealType: "dinner", takenAt: at(2026, 10, 27, 8) })).toBe("dinner");
    expect([7, 12, 17, 20, 23].map((h) => sectionOf({ mealType: null, takenAt: at(2026, 10, 27, h) }))).toEqual([
      "breakfast",
      "lunch",
      "snack",
      "dinner",
      "snack",
    ]);
  });

  it("are named Today, Yesterday, or by the date", () => {
    const now = new Date(2026, 9, 28, 10);
    expect(dayWords(now, now)).toBe("Today");
    expect(dayWords(addDays(now, -1), now)).toBe("Yesterday");
    expect(dayWords(addDays(now, -2), now)).toBe("Mon, 26 Oct");
  });
});

describe("what is left of the day", () => {
  it("is said as left, or as how far over", () => {
    expect(leftWords(2100, 1420, "kcal")).toBe("680 kcal left");
    expect(leftWords(70, 82, "g")).toBe("12 g over");
    expect(leftWords(2100, 3350, "kcal")).toBe("1,250 kcal over");
  });
});

describe("a plan with no calorie cut", () => {
  const plan = { kcal: 2300, bmr: 1600, tdee: 2300, proteinG: 120, carbsG: 280, fatG: 75, noCalorieCut: true };
  const response = (over: Partial<NutritionTargetsResponse>): NutritionTargetsResponse => ({
    targets: plan,
    missing: [],
    targetWrongSide: false,
    source: "app",
    appTargets: plan,
    own: null,
    ownHeld: null,
    ...over,
  });

  it("says so under the plan's own numbers", () => {
    expect(noCutWords(response({}))).toBe("Your plan has no calorie cut, so these calories keep your weight.");
  });

  it("says nothing where the plan has a cut, or the rings show the person's own numbers", () => {
    expect(noCutWords(response({ targets: { ...plan, noCalorieCut: false } }))).toBeNull();
    const own = { kcal: 2400, proteinG: 120, carbsG: 280, fatG: 75 };
    expect(noCutWords(response({ source: "own", own, targets: { ...plan, ...own } }))).toBeNull();
    expect(noCutWords(response({ targets: null, appTargets: null, missing: ["weightKg"] }))).toBeNull();
  });
});

describe("an amount", () => {
  const cup = { id: "usda-1", name: "cup", grams: 158 };
  const grams = { id: "g", name: "g", grams: 1 };
  const nut = { id: "piece-2", name: "nut", grams: 1.2 };

  it("starts where the server says the food starts", () => {
    expect(startingAmount({ startsAt: { measure: "usda-1", amount: 1.5 } })).toEqual({ measure: "usda-1", amount: "1.5" });
    expect(amountFor(grams)).toEqual({ measure: "g", amount: "100" });
    expect(amountFor(cup)).toEqual({ measure: "usda-1", amount: "1" });
  });

  it("steps by ten grams or half a measure, never below one step or past the server's bound", () => {
    expect(stepped({ measure: "usda-1", amount: "1" }, 1)).toEqual({ measure: "usda-1", amount: "1.5" });
    expect(stepped({ measure: "usda-1", amount: "0.5" }, -1)).toEqual({ measure: "usda-1", amount: "0.5" });
    expect(stepped({ measure: "usda-1", amount: "0.25" }, -1)).toEqual({ measure: "usda-1", amount: "0.25" });
    expect(stepped({ measure: "g", amount: "95" }, 1)).toEqual({ measure: "g", amount: "100" });
    expect(stepped({ measure: "g", amount: "" }, 1)).toEqual({ measure: "g", amount: "10" });
    expect(stepped({ measure: "g", amount: "10000" }, 1)).toEqual({ measure: "g", amount: "10000" });
  });

  it("is sent only when it is an amount", () => {
    expect(chosenItem("oats", { measure: "usda-1", amount: "1,5" })).toEqual({ canonical: "oats", measure: "usda-1", amount: 1.5 });
    for (const bad of ["", "0", "-1", "abc", "10001", "1.5.2"]) expect(chosenItem("oats", { measure: "usda-1", amount: bad })).toBeNull();
  });

  it("under a gram is caught before it is sent", () => {
    expect(underAGram(nut, { measure: "piece-2", amount: "0.25" })).toBe(true);
    expect(underAGram(nut, { measure: "piece-2", amount: "1" })).toBe(false);
  });

  it("reads in plain words", () => {
    expect(unitWords(grams)).toBe("grams");
    expect(unitWords({ id: "oz", name: "oz", grams: 28.35 })).toBe("ounces");
    expect(measureWords(cup)).toBe("cup · 158 g");
    expect(loggedAmount({ gramsPoint: 237, measure: { id: "usda-1", name: "cup", amount: 1.5 } })).toBe("1.5 × cup · 237 g");
    expect(loggedAmount({ gramsPoint: 60 })).toBe("60 g");
    expect(loggedAmount({ gramsPoint: 180, measure: { id: "dish", name: "My bowl", amount: 0.5 } })).toBe("My bowl, half full · 180 g");
  });
});

describe("the measures offered", () => {
  const m = (n: number) => ({ id: `usda-${String(n)}`, name: `m${String(n)}`, grams: n });
  const banana = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(m);

  it("are a few, with the one picked kept in view, and every one when asked", () => {
    expect(shownMeasures(banana, "usda-1", false).map((x) => x.id)).toEqual(["usda-1", "usda-2", "usda-3", "usda-4"]);
    expect(shownMeasures(banana, "usda-9", false).map((x) => x.id)).toEqual(["usda-1", "usda-2", "usda-3", "usda-4", "usda-9"]);
    expect(shownMeasures(banana, "usda-1", true)).toHaveLength(10);
  });

  it("are all shown when there is only one more than the few", () => {
    expect(shownMeasures(banana.slice(0, FIRST_MEASURES + 1), null, false)).toHaveLength(FIRST_MEASURES + 1);
  });
});
