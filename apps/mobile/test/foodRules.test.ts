import { describe, expect, it } from "vitest";
import type { Meal, MealPage, NutritionTargetsResponse } from "@app/shared";
import { MOST_MEAL_PAGES, aboutKcal, addDays, creditsFor, hasEstimate, itemMark, monthWeeks, monthWords, uncountedWords, daySums, dayWords, leftWords, noCutWords, sectionOf, walkDay } from "../src/screens/food/day";
import { amountFor, startWords, chosenItem, shownMeasures, loggedAmount, measureWords, startingAmount, stepped, underAGram, unitWords } from "../src/screens/food/measures";

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
    // Dinner until midnight, a late-night snack after it (Kd, 2026-10-30).
    expect([2, 7, 12, 17, 20, 23].map((h) => sectionOf({ mealType: null, takenAt: at(2026, 10, 27, h) }))).toEqual([
      "snack",
      "breakfast",
      "lunch",
      "snack",
      "dinner",
      "dinner",
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

describe("a found food as the search lists it (Kd, 32b-ii-b: never per 100 g)", () => {
  // The server's calories at the start, as the search sends them.
  const food = (startsAt: { measure: string; amount: number }, measures: { id: string; name: string; grams: number }[]) => {
    const m = measures.find((x) => x.id === startsAt.measure);
    return { startsKcal: Math.round((52 * (m?.grams ?? 1) * startsAt.amount) / 100), startsAt, measures };
  };
  it("is its calories at the amount it starts at, in the words a person counts by", () => {
    expect(startWords(food({ measure: "serving", amount: 1 }, [{ id: "serving", name: "apple", grams: 180 }]))).toBe("94 kcal · 1 apple");
    expect(startWords(food({ measure: "usda-1", amount: 1 }, [{ id: "usda-1", name: "half cup", grams: 122 }]))).toBe("63 kcal · half cup");
    expect(startWords(food({ measure: "usda-1", amount: 1 }, [{ id: "usda-1", name: "2 tbsp", grams: 32 }]))).toBe("17 kcal · 2 tbsp");
    expect(startWords(food({ measure: "usda-1", amount: 2 }, [{ id: "usda-1", name: "slice", grams: 25 }]))).toBe("26 kcal · 2 slice");
    expect(startWords(food({ measure: "g", amount: 100 }, [{ id: "g", name: "g", grams: 1 }]))).toBe("52 kcal · 100 g");
  });
});

describe("the measures offered (Kd, 32b-ii-b: the apple's cups confused him)", () => {
  // The foods' measures as the server sends them now (search, 2026-10-29).
  const ms = (...rows: [string, string, number][]) => rows.map(([id, name, grams]) => ({ id, name, grams }));
  const G: [string, string, number] = ["g", "g", 1];
  const OZ: [string, string, number] = ["oz", "oz", 28.35];
  const apple = ms(["serving", "apple", 180], ["usda-1", "cup, quartered or chopped", 125], ["usda-2", "cup slices", 109], ["usda-3", "large", 223], ["usda-4", "medium", 182], ["usda-5", "small", 149], ["usda-6", "extra small", 101], ["usda-7", "serving", 242], G, OZ);
  const milk = ms(["usda-1", "cup", 244], ["usda-2", "fl oz", 30.5], ["usda-3", "tbsp", 15.2], ["usda-4", "quart", 976], G, OZ);
  const bacon = ms(["usda-1", "3 oz", 85], ["usda-2", "slice cooked", 8.1], G, OZ);
  const rice = ms(["usda-1", "cup", 158], G, OZ);
  const paneer = ms(G, OZ);
  const ids = (shown: { name: string }[]) => shown.map((x) => x.name);

  it("are the food's counts and grams: an apple, its sizes, never its cups", () => {
    expect(ids(shownMeasures(apple, "serving", false))).toEqual(["apple", "large", "medium", "small", "g"]);
  });

  it("are a cup and grams for a food poured or scooped, and its count for a food counted", () => {
    expect(ids(shownMeasures(milk, "usda-1", false))).toEqual(["cup", "g"]);
    // One more than those is shown, never hidden behind "More measures (1)".
    expect(ids(shownMeasures(rice, "usda-1", false))).toEqual(["cup", "g", "oz"]);
    expect(ids(shownMeasures(bacon, "usda-2", false))).toEqual(["slice cooked", "g"]);
    expect(ids(shownMeasures(paneer, "g", false))).toEqual(["g", "oz"]);
  });

  it("offer two counts of one weight once: an egg, and a large one that weighs the same", () => {
    const egg = ms(["serving", "egg", 46], ["usda-1", "large", 46], ["usda-2", "cup", 243], G, OZ);
    expect(ids(shownMeasures(egg, "serving", false))).toEqual(["egg", "g"]);
  });

  it("keep the one picked in view, and show every one when asked", () => {
    expect(ids(shownMeasures(apple, "usda-1", false))).toEqual(["apple", "cup, quartered or chopped", "large", "medium", "small", "g"]);
    expect(ids(shownMeasures(milk, "oz", false))).toEqual(["cup", "g", "oz"]);
    // Every one when asked, the ones offered first still first.
    expect(ids(shownMeasures(apple, "serving", true))).toEqual(["apple", "large", "medium", "small", "g", "cup, quartered or chopped", "cup slices", "extra small", "serving", "oz"]);
  });
});

describe("a scan's estimate", () => {
  it("makes a meal's calories about, and says so beside the food, as on the browser", () => {
    expect(hasEstimate([{ nutritionSource: "usda" }, { nutritionSource: "estimate" }])).toBe(true);
    expect(hasEstimate([{ nutritionSource: "curated" }, { nutritionSource: "own" }])).toBe(false);
    expect(hasEstimate(null)).toBe(false);
    expect(aboutKcal(462, true)).toBe("about 462 kcal");
    expect(aboutKcal(1250, false)).toBe("1,250 kcal");
    expect([itemMark({ nutritionSource: "estimate" }), itemMark({ nutritionSource: "own" }), itemMark({ nutritionSource: "usda" })]).toEqual([
      " · estimate",
      " · your numbers",
      "",
    ]);
  });
});

describe("the month to pick a day from", () => {
  it("runs Monday to Sunday, with no day before the 1st or after the last", () => {
    const october = monthWeeks(new Date(2026, 9, 1));
    expect(monthWords(new Date(2026, 9, 1))).toBe("October 2026");
    // 1 October 2026 is a Thursday.
    expect(october[0]?.map((d) => d?.getDate() ?? null)).toEqual([null, null, null, 1, 2, 3, 4]);
    expect(october.flat().filter((d) => d !== null)).toHaveLength(31);
    expect(october.every((w) => w.length === 7)).toBe(true);
    expect(october.at(-1)?.map((d) => d?.getDate() ?? null)).toEqual([26, 27, 28, 29, 30, 31, null]);
    // February 2027 starts on a Monday and fills four weeks exactly.
    expect(monthWeeks(new Date(2027, 1, 1))).toHaveLength(4);
  });
});

describe("the food data's credits", () => {
  const words = (c: ReturnType<typeof creditsFor>[number]) => c.parts.map((p) => p.text).join("");

  it("name USDA and carry Open Food Facts' licence notice, each only where its food is on screen", () => {
    expect(creditsFor(new Set(["curated", "estimate"]))).toEqual([]);
    const both = creditsFor(new Set(["usda", "openfoodfacts"]));
    expect(both.map((c) => c.key)).toEqual(["usda", "openfoodfacts"]);
    const usda = both[0];
    expect(usda === undefined ? "" : words(usda)).toBe("Food data from USDA FoodData Central, U.S. Department of Agriculture, Agricultural Research Service.");
    const off = both[1];
    expect(off === undefined ? "" : words(off)).toBe(
      "Packaged products contain information from Open Food Facts, which is made available here under the Open Database License (ODbL).",
    );
    expect(off?.parts.flatMap((p) => ("link" in p ? [p.link] : []))).toEqual(["https://openfoodfacts.org", "https://opendatacommons.org/licenses/odbl/1-0/"]);
  });
});

describe("a meal still waiting for its numbers", () => {
  it("is said, one or many", () => {
    expect(uncountedWords(1)).toBe("1 meal is waiting for its numbers. They come once it is sent.");
    expect(uncountedWords(3)).toBe("3 meals are waiting for their numbers. They come once they are sent.");
  });
});
