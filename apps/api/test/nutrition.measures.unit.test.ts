// ROADMAP 7a-iv-a — the measures a food is logged by (RULINGS 2026-09-16, the
// portion redesign): which measures a food carries, the one it starts at, and
// what an amount of one weighs. Every kind of food the search returns is a row of
// the tables below, so a rule that drops or doubles a measure shows as a diff.
import { describe, expect, it } from "vitest";
import { foodMeasureSchema, type FoodMeasure } from "@app/shared";
import { curatedUsdaFdcId, CURATED_FOODS } from "../src/modules/nutrition/foods.js";
import {
  CUP_ML,
  GRAM,
  MEDIUM_G_PER_ML,
  OUNCE,
  dishwareGrams,
  foodMeasures,
  gramsPerMl,
  isHouseholdMeasure,
  measureGrams,
  startingMeasure,
  usdaMeasureName,
  type MeasureSource,
  type UsdaPortion,
} from "../src/modules/nutrition/measures.js";

const portion = (seqNum: number, unit: string, gramWeight: number, amount: number | null = 1): UsdaPortion => ({ seqNum, amount, unit, gramWeight });
const brief = (measures: readonly FoodMeasure[]): string[] => measures.map((m) => `${m.id} ${m.name} ${String(m.grams)}`);
const OZ = `oz oz ${String(OUNCE.grams)}`;
/** A food of our list, a packaged product or an estimate: its serving is its own. */
const own = (serving: number, unit: string, portions: UsdaPortion[] = []): MeasureSource => ({ serving, unit, portions, ownServing: true });
/** A food of the USDA table: its serving is one of its USDA measures. */
const usdaFood = (serving: number, unit: string, portions: UsdaPortion[]): MeasureSource => ({ serving, unit, portions, ownServing: false });

// USDA's own rows for an apple (SR Legacy 171688, the entry our list's Apple cites).
const APPLE_PORTIONS = [
  portion(1, "cup, quartered or chopped", 125), portion(2, "cup slices", 109), portion(3, "large (3-1/4\" dia)", 223),
  portion(4, "medium (3\" dia)", 182), portion(5, "small (2-3/4\" dia)", 149), portion(6, "extra small (2-1/2\" dia)", 101),
  portion(7, "NLEA serving", 242),
];
// USDA's own rows for frozen kale (SR Legacy 169239): an amount of 0 on a package
// of 94 g, beside the package's real 284 g.
const KALE_PORTIONS = [portion(0, "package (10 oz)", 94, 0), portion(1, "cup", 67, 0.33), portion(2, "package (10 oz)", 284, 1)];

describe("the measures a food carries", () => {
  it.each<[string, MeasureSource, string[]]>([
    [
      "a USDA food: its measures in USDA's order, named by the importer's rule, then grams and ounces",
      usdaFood(234, "cup", [portion(1, "1 cup", 234, null), portion(2, "1/2 cup", 117, null), portion(3, "1 tablespoon", 15, null)]),
      ["usda-1 cup 234", "usda-2 half cup 117", "usda-3 tablespoon 15", "g g 1", OZ],
    ],
    [
      "SR Legacy's amount in its own column",
      usdaFood(70, "half cup", [portion(1, "cup", 70, 0.5), portion(2, "spears (1/2\" base)", 60, 4)]),
      ["usda-1 half cup 70", "usda-2 4 spears (1/2\" base) 60", "g g 1", OZ],
    ],
    [
      "never a row of amount 0 whose text states none (frozen kale's 94 g package), even where the table still serves by it",
      usdaFood(94, "package (10 oz)", KALE_PORTIONS),
      ["usda-1 0.33 cup 67", "usda-2 package (10 oz) 284", "g g 1", OZ],
    ],
    [
      "a row of amount 0 whose own text states its amount",
      usdaFood(240, "cup", [portion(1, "1 cup", 240, 0)]),
      ["usda-1 cup 240", "g g 1", OZ],
    ],
    [
      "never a survey filler row, whatever amount it carries",
      usdaFood(240, "cup", [
        portion(1, "1 cup", 244, null), portion(2, "Guideline amount per fl oz of beverage", 2.5, null),
        portion(3, "1 guideline amount per item", 30, null), portion(4, "Quantity not specified", 280, null),
      ]),
      ["usda-1 cup 244", "g g 1", OZ],
    ],
    [
      "our list's own serving first, where no USDA measure has its name (an apple of 180 g)",
      own(180, "apple", APPLE_PORTIONS),
      [
        "serving apple 180", "usda-1 cup, quartered or chopped 125", "usda-2 cup slices 109", "usda-3 large (3-1/4\" dia) 223",
        "usda-4 medium (3\" dia) 182", "usda-5 small (2-3/4\" dia) 149", "usda-6 extra small (2-1/2\" dia) 101", "usda-7 NLEA serving 242",
        "g g 1", OZ,
      ],
    ],
    [
      "no serving of its own where a USDA measure has its name and weight (cornflakes by the 30 g cup)",
      own(30, "cup", [portion(1, "1 cup", 30, null), portion(2, "1 prepackaged single serving", 30, null)]),
      ["usda-1 cup 30", "usda-2 prepackaged single serving 30", "g g 1", OZ],
    ],
    [
      "no serving of its own where a USDA measure has its name at another weight (our milk's cup of 240 g, USDA's 244)",
      own(240, "cup", [portion(1, "cup", 244)]),
      ["usda-1 cup 244", "g g 1", OZ],
    ],
    [
      "a USDA food's serving is never a measure of its own, even one its measures no longer hold",
      usdaFood(142, "cup", [portion(0, "cup", 142, 0), portion(1, "tbsp", 9)]),
      ["usda-1 tbsp 9", "g g 1", OZ],
    ],
    [
      "USDA's own two sizes of one name stay, told apart by their grams",
      usdaFood(21, "bar", [portion(1, "bar", 21), portion(2, "bar", 25)]),
      ["usda-1 bar 21", "usda-2 bar 25", "g g 1", OZ],
    ],
    ["a food served by 100 g with no USDA entry: grams and ounces only", own(100, "g"), ["g g 1", OZ]],
    ["a label that gives only a weight: its serving, by that weight", own(30, "g"), ["serving serving 30", "g g 1", OZ]],
    ["a label in millilitres weighs as grams", own(250, "ml"), ["serving serving 250", "g g 1", OZ]],
    ["a packaged product's pack", own(125, "pot"), ["serving pot 125", "g g 1", OZ]],
    ["an ounce serving is the ounce", own(28, "oz"), ["g g 1", OZ]],
    [
      "USDA measures that are grams or the ounce, weigh nothing or more than a meal item may, or repeat one, are left out",
      usdaFood(28.35, "oz", [portion(1, "oz", 28.35), portion(2, "piece, large", 20), portion(3, "oz", 28.35), portion(4, "g", 1), portion(5, "whole ham", 10_001), portion(6, "piece, large", 20)]),
      ["usda-2 piece, large 20", "g g 1", OZ],
    ],
    ["a serving that weighs nothing is no measure", own(0, "bar"), ["g g 1", OZ]],
    ["a serving with no name is no measure", own(40, "  "), ["g g 1", OZ]],
  ])("%s", (_, source, expected) => {
    const measures = foodMeasures(source);
    expect(brief(measures)).toEqual(expected);
    // Every measure crosses the contract, and no two share an id or, from two tables, a name.
    for (const m of measures) expect(foodMeasureSchema.safeParse(m).success, m.id).toBe(true);
    expect(new Set(measures.map((m) => m.id)).size).toBe(measures.length);
    const own = measures.find((m) => m.id === "serving");
    if (own !== undefined) expect(measures.filter((m) => m.name.toLowerCase() === own.name.toLowerCase())).toHaveLength(1);
  });
});

describe("which USDA rows are household measures", () => {
  it.each<[string, Pick<UsdaPortion, "amount" | "unit">, boolean]>([
    ["an SR row with its amount", { amount: 1, unit: "cup" }, true],
    ["a survey row whose text carries its amount", { amount: null, unit: "1 cup" }, true],
    ["a survey row with no amount in its text", { amount: null, unit: "cup" }, true],
    ["an amount of 0 its text does not state", { amount: 0, unit: "package (10 oz)" }, false],
    ["an amount of 0 its text states", { amount: 0, unit: "2 tbsp" }, true],
    ["a guideline filler", { amount: null, unit: "Guideline amount per cup of hot cereal" }, false],
    ["a guideline filler with an amount in front", { amount: null, unit: "1 guideline amount per item" }, false],
    ["the survey's unspecified quantity", { amount: null, unit: "Quantity not specified" }, false],
    ["a measure that merely mentions a guideline", { amount: 1, unit: "cup (per dietary guideline)" }, true],
  ])("%s", (_, given, expected) => {
    expect(isHouseholdMeasure(given)).toBe(expected);
  });
});

describe("a long measure name", () => {
  it.each<[string, string]>([
    // A bracket or comma ends a clause: the name is cut there, never inside a bracket it cannot close.
    ["piece, cooked, excluding refuse (yield from 1 lb raw meat with refuse)", "piece, cooked, excluding refuse"],
    ["3 oz with bone, cooked (yield after bone and fat removed)", "3 oz with bone, cooked"],
    ["slice of a very large loaf indeed, sliced thinly", "slice of a very large loaf indeed"],
    ["cup, chopped into small pieces (packed, and more words to pass forty)", "cup, chopped into small pieces"],
    // Dropping the bracket would leave too little to tell apart: it is closed instead.
    ["unit (yield from 1 lb ready-to-cook chicken)", "unit (yield from 1 lb ready-to-cook…)"],
    ["cup (some very long parenthetical that goes on and on)", "cup (some very long parenthetical that…)"],
    // USDA's own text with a bracket it never closed.
    ["potato large (3\" to 4-1/4\" dia.", "potato large (3\" to 4-1/4\" dia.)"],
    // No clause end: at the last space.
    ["serving serving size varied from 1 to 3 enchiladas and a half", "serving serving size varied from 1 to 3"],
    // A clause end too early would leave a plain "cup": cut at the last space instead.
    ["cup, chopped into very small pieces for the salad bowl", "cup, chopped into very small pieces for"],
  ])("%s → %s", (unit, expected) => {
    const name = usdaMeasureName({ amount: 1, unit });
    expect(name).toBe(expected);
    expect(name.length).toBeLessThanOrEqual(42);
    expect(name.split("(").length).toBe(name.split(")").length);
  });

  it("is never cut to a plain cup, which would read as the food's own cup", () => {
    for (const tail of ["", " for the salad bowl and some more words", " (packed, and more words to pass forty)"]) {
      expect(usdaMeasureName({ amount: 1, unit: `cup, chopped into small pieces${tail}` }).toLowerCase()).not.toBe("cup");
    }
  });
});

describe("the measure a food starts at", () => {
  it.each<[string, MeasureSource, { measure: string; amount: number }]>([
    ["its own serving, once", own(180, "apple", APPLE_PORTIONS), { measure: "serving", amount: 1 }],
    ["USDA's measure of its serving's name and weight, once", own(30, "cup", [portion(1, "1 cup", 30, null)]), { measure: "usda-1", amount: 1 }],
    ["USDA's measure of its serving's name at another weight, once", own(240, "cup", [portion(1, "cup", 244)]), { measure: "usda-1", amount: 1 }],
    ["a USDA food's first measure, once", usdaFood(70, "half cup", [portion(1, "cup", 70, 0.5), portion(2, "nut", 1.2)]), { measure: "usda-1", amount: 1 }],
    ["frozen kale's real package, not the 94 g row", usdaFood(94, "package (10 oz)", KALE_PORTIONS), { measure: "usda-2", amount: 1 }],
    ["a USDA food whose serving row is no measure: its first measure", usdaFood(142, "cup", [portion(0, "cup", 142, 0), portion(1, "tbsp", 9)]), { measure: "usda-1", amount: 1 }],
    ["a USDA food with no measure: 100 g", usdaFood(100, "g", []), { measure: "g", amount: 100 }],
    ["grams of a serving by weight", own(100, "g"), { measure: "g", amount: 100 }],
    ["a label's weight, as its serving", own(30, "g"), { measure: "serving", amount: 1 }],
    ["an ounce, for a serving of one ounce", own(28, "oz"), { measure: "oz", amount: 1 }],
    ["an ounce, for USDA's own ounce of 28.35 g", usdaFood(28.35, "oz", [portion(1, "oz", 28.35)]), { measure: "oz", amount: 1 }],
    ["the grams, for an 'oz' serving that is no ounce (dark chocolate by 30 g)", own(30, "oz"), { measure: "g", amount: 30 }],
    ["the grams, for a USDA 'oz' row of 31 g", usdaFood(31, "oz", [portion(1, "oz", 31)]), { measure: "g", amount: 31 }],
    ["100 g, where the serving weighs nothing", own(0, "g"), { measure: "g", amount: 100 }],
  ])("%s", (_, source, expected) => {
    const measures = foodMeasures(source);
    const start = startingMeasure(source, measures);
    expect(start).toEqual(expected);
    expect(measures.map((m) => m.id)).toContain(start.measure);
  });

  it("is one of its own measures for every food of our list, whatever USDA entry it cites", () => {
    // Without the USDA table (as in CI) each food has only its serving; with it,
    // the cited entry's measures too (the measures route test).
    for (const food of CURATED_FOODS) {
      const source = own(food.serving, food.unit);
      const measures = foodMeasures(source);
      expect(measures.map((m) => m.id), food.canonical).toContain(startingMeasure(source, measures).measure);
    }
  });
});

describe("what an amount of a measure weighs", () => {
  it("is the amount times one of it, to the whole gram", () => {
    const medium: FoodMeasure = { id: "usda-4", name: "medium (3\" dia)", grams: 182 };
    expect(measureGrams(medium, 1)).toBe(182);
    expect(measureGrams(medium, 1.5)).toBe(273);
    expect(measureGrams(OUNCE, 2)).toBe(57);
    expect(measureGrams(GRAM, 250)).toBe(250);
    // A quarter of a 1.2 g almond is no gram at all: the service refuses a 0.
    expect(measureGrams({ id: "usda-2", name: "almond", grams: 1.2 }, 0.25)).toBe(0);
  });

  it("a millilitre weighs what the food's own first cup says, else Appendix B's medium density", () => {
    const cup = (id: string, name: string, grams: number): FoodMeasure => ({ id, name, grams });
    expect(gramsPerMl([cup("usda-1", "cup", 30), GRAM, OUNCE])).toBe(30 / CUP_ML);
    expect(gramsPerMl([cup("usda-1", "half cup", 70), GRAM])).toBe(70 / (CUP_ML / 2));
    // Two plain cups (our milk's 240 g and USDA's 244): the first.
    expect(gramsPerMl([cup("serving", "cup", 240), cup("usda-1", "cup", 244)])).toBe(240 / CUP_ML);
    expect(gramsPerMl([cup("usda-1", "cup", 244), cup("serving", "cup", 240)])).toBe(244 / CUP_ML);
    // A cup of something else ("cup, chopped") is not the food's cup.
    expect(gramsPerMl([cup("usda-1", "cup, chopped", 140), cup("usda-2", "Cup", 158)])).toBe(158 / CUP_ML);
    expect(gramsPerMl([cup("usda-1", "cup, quartered or chopped", 125), GRAM, OUNCE])).toBe(MEDIUM_G_PER_ML);
    expect(gramsPerMl([])).toBe(MEDIUM_G_PER_ML);
  });

  it("a saved dish is its volume × how full × a millilitre of the food", () => {
    expect(dishwareGrams(360, 0.5, 70 / 120)).toBe(105);
    expect(dishwareGrams(360, 0.5, MEDIUM_G_PER_ML)).toBe(180);
    expect(dishwareGrams(350, 1, 30 / CUP_ML)).toBe(44);
  });
});

describe("the USDA entry a food of our list has its measures from", () => {
  it("is the entry it cites, and none for a CoFID food or a name not on the list", () => {
    expect(curatedUsdaFdcId("apple")).toBe(171688);
    expect(curatedUsdaFdcId("cereal_cornflakes")).toBe(2708453);
    expect(curatedUsdaFdcId("roti_chapati")).toBeNull(); // CoFID
    expect(curatedUsdaFdcId("usda_sr_171688")).toBeNull();
    expect(curatedUsdaFdcId("not_a_food")).toBeNull();
    // Every food of the list that cites USDA reads its entry; the rest read none.
    for (const food of CURATED_FOODS) {
      expect(curatedUsdaFdcId(food.canonical) === null, food.canonical).toBe(food.citation.startsWith("uk-cofid:"));
    }
  });
});
