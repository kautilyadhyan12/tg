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
  measureGrams,
  startingMeasure,
  type MeasureSource,
  type UsdaPortion,
} from "../src/modules/nutrition/measures.js";

const portion = (seqNum: number, unit: string, gramWeight: number, amount: number | null = 1): UsdaPortion => ({ seqNum, amount, unit, gramWeight });
const brief = (measures: readonly FoodMeasure[]): string[] => measures.map((m) => `${m.id} ${m.name} ${String(m.grams)}`);

// USDA's own rows for an apple (SR Legacy 171688, the entry our list's Apple cites).
const APPLE_PORTIONS = [
  portion(1, "cup, quartered or chopped", 125), portion(2, "cup slices", 109), portion(3, "large (3-1/4\" dia)", 223),
  portion(4, "medium (3\" dia)", 182), portion(5, "small (2-3/4\" dia)", 149), portion(6, "extra small (2-1/2\" dia)", 101),
  portion(7, "NLEA serving", 242),
];

describe("the measures a food carries", () => {
  it.each<[string, MeasureSource, string[]]>([
    [
      "a USDA food: its measures in USDA's order, named by the importer's rule, then grams and ounces",
      { serving: 234, unit: "cup", portions: [portion(1, "1 cup", 234, null), portion(2, "1/2 cup", 117, null), portion(3, "1 tablespoon", 15, null)] },
      ["usda-1 cup 234", "usda-2 half cup 117", "usda-3 tablespoon 15", "g g 1", `oz oz ${String(OUNCE.grams)}`],
    ],
    [
      "SR Legacy's amount in its own column",
      { serving: 70, unit: "half cup", portions: [portion(1, "cup", 70, 0.5), portion(2, "spears (1/2\" base)", 60, 4)] },
      ["usda-1 half cup 70", "usda-2 4 spears (1/2\" base) 60", "g g 1", `oz oz ${String(OUNCE.grams)}`],
    ],
    [
      "our list's own serving first, where no USDA measure has its name and weight (an apple of 180 g)",
      { serving: 180, unit: "apple", portions: APPLE_PORTIONS },
      [
        "serving apple 180", "usda-1 cup, quartered or chopped 125", "usda-2 cup slices 109", "usda-3 large (3-1/4\" dia) 223",
        "usda-4 medium (3\" dia) 182", "usda-5 small (2-3/4\" dia) 149", "usda-6 extra small (2-1/2\" dia) 101", "usda-7 NLEA serving 242",
        "g g 1", `oz oz ${String(OUNCE.grams)}`,
      ],
    ],
    [
      "no serving of its own where USDA's measure of that name weighs the same (cornflakes by the 30 g cup)",
      { serving: 30, unit: "cup", portions: [portion(1, "1 cup", 30, null), portion(2, "1 prepackaged single serving", 30, null)] },
      ["usda-1 cup 30", "usda-2 prepackaged single serving 30", "g g 1", `oz oz ${String(OUNCE.grams)}`],
    ],
    [
      "a serving of the same name but another weight is its own measure",
      { serving: 28, unit: "slice", portions: [portion(1, "slice", 26)] },
      ["serving slice 28", "usda-1 slice 26", "g g 1", `oz oz ${String(OUNCE.grams)}`],
    ],
    [
      "a food served by 100 g with no USDA entry: grams and ounces only",
      { serving: 100, unit: "g", portions: [] },
      ["g g 1", `oz oz ${String(OUNCE.grams)}`],
    ],
    [
      "a label that gives only a weight: its serving, by that weight",
      { serving: 30, unit: "g", portions: [] },
      ["serving serving 30", "g g 1", `oz oz ${String(OUNCE.grams)}`],
    ],
    [
      "a label in millilitres weighs as grams",
      { serving: 250, unit: "ml", portions: [] },
      ["serving serving 250", "g g 1", `oz oz ${String(OUNCE.grams)}`],
    ],
    [
      "a packaged product's pack",
      { serving: 125, unit: "pot", portions: [] },
      ["serving pot 125", "g g 1", `oz oz ${String(OUNCE.grams)}`],
    ],
    [
      "our list's ounce servings are the ounce",
      { serving: 28, unit: "oz", portions: [] },
      ["g g 1", `oz oz ${String(OUNCE.grams)}`],
    ],
    [
      "USDA measures that are grams or the ounce, weigh nothing or more than a meal item may, or repeat one, are left out",
      { serving: 28.35, unit: "oz", portions: [portion(1, "oz", 28.35), portion(2, "piece, large", 20), portion(3, "oz", 28.35), portion(4, "g", 1), portion(5, "whole ham", 10_001), portion(6, "piece, large", 20)] },
      ["usda-2 piece, large 20", "g g 1", `oz oz ${String(OUNCE.grams)}`],
    ],
    [
      "a serving that weighs nothing, or has no name, is no measure",
      { serving: 0, unit: "bar", portions: [] },
      ["g g 1", `oz oz ${String(OUNCE.grams)}`],
    ],
  ])("%s", (_, source, expected) => {
    const measures = foodMeasures(source);
    expect(brief(measures)).toEqual(expected);
    // Every measure crosses the contract, and no two share an id.
    for (const m of measures) expect(foodMeasureSchema.safeParse(m).success, m.id).toBe(true);
    expect(new Set(measures.map((m) => m.id)).size).toBe(measures.length);
  });

  it("a nameless serving is left out as a weightless one is", () => {
    expect(brief(foodMeasures({ serving: 40, unit: "  ", portions: [] }))).toEqual(["g g 1", `oz oz ${String(OUNCE.grams)}`]);
  });
});

describe("the measure a food starts at", () => {
  it.each<[string, MeasureSource, { measure: string; amount: number }]>([
    ["its own serving, once", { serving: 180, unit: "apple", portions: APPLE_PORTIONS }, { measure: "serving", amount: 1 }],
    ["USDA's measure that is its serving, once", { serving: 30, unit: "cup", portions: [portion(1, "1 cup", 30, null)] }, { measure: "usda-1", amount: 1 }],
    ["a USDA food's first measure, once", { serving: 70, unit: "half cup", portions: [portion(1, "cup", 70, 0.5), portion(2, "nut", 1.2)] }, { measure: "usda-1", amount: 1 }],
    ["grams of a serving by weight", { serving: 100, unit: "g", portions: [] }, { measure: "g", amount: 100 }],
    ["a label's weight, as its serving", { serving: 30, unit: "g", portions: [] }, { measure: "serving", amount: 1 }],
    ["an ounce, for an ounce serving", { serving: 28, unit: "oz", portions: [] }, { measure: "oz", amount: 1 }],
    ["100 g, where the serving weighs nothing", { serving: 0, unit: "g", portions: [] }, { measure: "g", amount: 100 }],
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
      const measures = foodMeasures({ serving: food.serving, unit: food.unit, portions: [] });
      expect(measures.map((m) => m.id), food.canonical).toContain(startingMeasure(food, measures).measure);
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

  it("a millilitre weighs what the food's own cup says, else Appendix B's medium density", () => {
    const cup = (name: string, grams: number): FoodMeasure => ({ id: "usda-1", name, grams });
    expect(gramsPerMl([cup("cup", 30), GRAM, OUNCE])).toBe(30 / CUP_ML);
    expect(gramsPerMl([cup("half cup", 70), GRAM])).toBe(70 / (CUP_ML / 2));
    // The first cup wins; a cup of something else ("cup, chopped") is not the food's cup.
    expect(gramsPerMl([cup("cup, chopped", 140), { id: "usda-2", name: "Cup", grams: 158 }])).toBe(158 / CUP_ML);
    expect(gramsPerMl([cup("cup, quartered or chopped", 125), GRAM, OUNCE])).toBe(MEDIUM_G_PER_ML);
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
