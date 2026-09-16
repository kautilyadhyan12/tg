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
  SCAN_START_TOLERANCE_PERCENT,
  dishwareGrams,
  foodMeasures,
  gramsPerMl,
  isHouseholdMeasure,
  measureGrams,
  scanStart,
  startingMeasure,
  usdaMeasureName,
  type MeasureSource,
  type ScanStart,
  type UsdaPortion,
} from "../src/modules/nutrition/measures.js";
import { MAX_ITEM_GRAMS } from "@app/shared";

const portion = (seqNum: number, unit: string, gramWeight: number, amount: number | null = 1): UsdaPortion => ({ seqNum, amount, unit, gramWeight });
const brief = (measures: readonly FoodMeasure[]): string[] => measures.map((m) => `${m.id} ${m.name} ${String(m.grams)}`);
const OZ = `oz oz ${String(OUNCE.grams)}`;
/** A food of our list or a packaged product: its serving is its own. */
const own = (serving: number, unit: string, portions: UsdaPortion[] = []): MeasureSource => ({ serving, unit, portions, ownServing: true });
/** A food of the USDA table, or a scan's estimate: its serving is no measure of its own. */
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
      "no serving of its own where a USDA measure has its name near its weight (our milk's cup of 240 g, USDA's 244)",
      own(240, "cup", [portion(1, "cup", 244)]),
      ["usda-1 cup 244", "g g 1", OZ],
    ],
    ["a tenth off is near (a cup of 240 g, USDA's 264)", own(240, "cup", [portion(1, "cup", 264)]), ["usda-1 cup 264", "g g 1", OZ]],
    ["a tenth below is near (a cup of 240 g, USDA's 216)", own(240, "cup", [portion(1, "cup", 216)]), ["usda-1 cup 216", "g g 1", OZ]],
    [
      "just past a tenth is another size: both stay (a cup of 240 g, USDA's 265)",
      own(240, "cup", [portion(1, "cup", 265)]),
      ["serving cup 240", "usda-1 cup 265", "g g 1", OZ],
    ],
    [
      "our serving stays beside USDA's measure of its name at another size (our blueberry muffin of 113 g, USDA's 31 g muffin)",
      own(113, "muffin", [portion(1, "muffin", 31), portion(2, "medium", 113)]),
      ["serving muffin 113", "usda-1 muffin 31", "usda-2 medium 113", "g g 1", OZ],
    ],
    [
      "one of two USDA measures of its name near its weight is enough to drop it",
      own(240, "cup", [portion(1, "cup", 150), portion(2, "cup", 244)]),
      ["usda-1 cup 150", "usda-2 cup 244", "g g 1", OZ],
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
    // Every measure crosses the contract, no two share an id, and a serving of our
    // own never sits beside a USDA measure of its name near its weight.
    for (const m of measures) expect(foodMeasureSchema.safeParse(m).success, m.id).toBe(true);
    expect(new Set(measures.map((m) => m.id)).size).toBe(measures.length);
    const own = measures.find((m) => m.id === "serving");
    if (own !== undefined) {
      const twins = measures.filter((m) => m.id !== own.id && m.name.toLowerCase() === own.name.toLowerCase() && Math.abs(m.grams - own.grams) <= own.grams / 10);
      expect(twins).toEqual([]);
    }
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
    ["USDA's measure of its serving's name near its weight, once", own(240, "cup", [portion(1, "cup", 244)]), { measure: "usda-1", amount: 1 }],
    ["of two USDA measures of its name, the one near its weight", own(240, "cup", [portion(1, "cup", 150), portion(2, "cup", 244)]), { measure: "usda-2", amount: 1 }],
    ["of two near its weight, the nearer", own(240, "cup", [portion(1, "cup", 262), portion(2, "cup", 236)]), { measure: "usda-2", amount: 1 }],
    ["its own serving beside USDA's measure of its name at another size (the 113 g muffin)", own(113, "muffin", [portion(1, "muffin", 31)]), { measure: "serving", amount: 1 }],
    ["a USDA food's first measure, once", usdaFood(70, "half cup", [portion(1, "cup", 70, 0.5), portion(2, "nut", 1.2)]), { measure: "usda-1", amount: 1 }],
    ["frozen kale's real package, not the 94 g row", usdaFood(94, "package (10 oz)", KALE_PORTIONS), { measure: "usda-2", amount: 1 }],
    ["a USDA food whose serving row is no measure: its first measure", usdaFood(142, "cup", [portion(0, "cup", 142, 0), portion(1, "tbsp", 9)]), { measure: "usda-1", amount: 1 }],
    ["a USDA food with no measure: 100 g", usdaFood(100, "g", []), { measure: "g", amount: 100 }],
    ["grams of a serving by weight", own(100, "g"), { measure: "g", amount: 100 }],
    ["a label's weight, as its serving", own(30, "g"), { measure: "serving", amount: 1 }],
    ["an ounce, for a serving of one ounce", own(28, "oz"), { measure: "oz", amount: 1 }],
    ["an ounce, for USDA's own ounce of 28.35 g", usdaFood(28.35, "oz", [portion(1, "oz", 28.35)]), { measure: "oz", amount: 1 }],
    [
      "an ounce, for a USDA food served by one, never its first measure (a graham cracker crust of 183 g)",
      usdaFood(28.35, "oz", [portion(1, "oz", 28.35), portion(2, "crust, single 9\"", 183)]),
      { measure: "oz", amount: 1 },
    ],
    ["the grams, for an 'oz' serving that is no ounce (dark chocolate by 30 g)", own(30, "oz"), { measure: "g", amount: 30 }],
    ["the grams, for a USDA 'oz' row of 31 g", usdaFood(31, "oz", [portion(1, "oz", 31)]), { measure: "g", amount: 31 }],
    ["the grams, for a USDA 'oz' row of 31 g, never its first measure", usdaFood(31, "oz", [portion(1, "oz", 31), portion(2, "bar", 40)]), { measure: "g", amount: 31 }],
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

describe("where a food the photo scan saw starts on the photo sheet (RULINGS 2026-09-16)", () => {
  /** A food whose measures are the USDA rows given, plus grams and ounces. */
  const fed = (...portions: UsdaPortion[]): MeasureSource => usdaFood(portions[0]?.gramWeight ?? 100, portions[0]?.unit ?? "g", portions);
  const at = (measure: string, amount: number, grams: number): ScanStart => ({ measure, amount, grams, estimated: false });
  const estimate = (measure: string, amount: number, grams: number): ScanStart => ({ measure, amount, grams, estimated: true });

  it("holds a count to 30 % of the photo's grams, and no more for a small food (RULINGS 2026-09-17)", () => {
    expect(SCAN_START_TOLERANCE_PERCENT).toBe(30);
  });

  it.each<[string, MeasureSource, number | null, number | null, ScanStart]>([
    // A count of a measure that weighs what the photo saw.
    ["two slices at the photo's 60 g", fed(portion(1, "slice", 30)), 2, 60, at("usda-1", 2, 60)],
    ["six nuggets of 16 g at 96 g, never six of a 96 g serving", own(96, "serving", [portion(1, "nugget", 16)]), 6, 96, at("usda-1", 6, 96)],
    ["two cups of stew at 510 g: whatever the count names, the grams agree", fed(portion(1, "cup", 255)), 2, 510, at("usda-1", 2, 510)],
    ["three 65 g bottles of a label's pack at 195 g", own(65, "bottle"), 3, 195, at("serving", 3, 195)],
    // 30 % of the photo's grams, each way: at the edge is near, past it is not.
    ["30 % over is near", fed(portion(1, "piece", 130)), 1, 100, at("usda-1", 1, 130)],
    ["past 30 % over is not", fed(portion(1, "piece", 131)), 1, 100, estimate("g", 100, 100)],
    ["30 % under is near", fed(portion(1, "piece", 70)), 1, 100, at("usda-1", 1, 70)],
    ["past 30 % under is not", fed(portion(1, "piece", 69)), 1, 100, estimate("g", 100, 100)],
    // A small food is held to the same 30 %, never to a fixed number of grams:
    // 10 g of almonds, counted 1, are no one 1 g almond (Kd, RULINGS 2026-09-17).
    ["10 g of almonds counted 1 are no one almond", fed(portion(1, "cup, whole", 143), portion(2, "almond", 1.2)), 1, 10, estimate("g", 10, 10)],
    ["30 % over a small food is near", fed(portion(1, "piece", 26)), 1, 20, at("usda-1", 1, 26)],
    ["past it is not, though only 7 g", fed(portion(1, "piece", 27)), 1, 20, estimate("g", 20, 20)],
    ["30 % under a small food is near", fed(portion(1, "piece", 14)), 1, 20, at("usda-1", 1, 14)],
    ["past it under is not, though only 7 g", fed(portion(1, "piece", 13)), 1, 20, estimate("g", 20, 20)],
    ["30 % of 200 g is exactly 60 g, and near", fed(portion(1, "cup, chopped", 140)), 1, 200, at("usda-1", 1, 140)],
    // Compared as the row will weigh it, to the whole gram.
    ["26.4 g is the row's 26 g, 30 % over", fed(portion(1, "piece", 26.4)), 1, 20, at("usda-1", 1, 26)],
    ["26.6 g is the row's 27 g, past it", fed(portion(1, "piece", 26.6)), 1, 20, estimate("g", 20, 20)],
    // Of several near, the nearest; of two as near, the earlier in the food's list.
    ["the nearest size", fed(portion(1, "small", 101), portion(2, "medium", 118), portion(3, "large", 136)), 1, 120, at("usda-2", 1, 118)],
    ["the earlier of two as near", fed(portion(1, "short", 110), portion(2, "tall", 130)), 1, 120, at("usda-1", 1, 110)],
    ["our own serving is as good a measure as USDA's, and comes first", own(180, "apple", [portion(4, "medium (3\" dia)", 182)]), 1, 181, at("serving", 1, 180)],
    // Grams and ounces are weights, never what a photo counts.
    ["never an ounce, even at the photo's grams", fed(), 1, 28, estimate("g", 28, 28)],
    ["never an ounce beside a measure too far off", fed(portion(1, "bar", 40)), 1, 29, estimate("g", 29, 29)],
    // No count, nothing to multiply; no grams, nothing to check a count against.
    ["no count: the photo's grams, even where a measure weighs them", fed(portion(1, "cup", 158)), null, 158, estimate("g", 158, 158)],
    ["no grams: our food's own serving, as Add food starts it", own(180, "apple", [portion(4, "medium (3\" dia)", 182)]), 2, null, estimate("serving", 1, 180)],
    ["no grams: a USDA food's first measure, as Add food starts it", fed(portion(1, "1 cup", 230, null), portion(2, "1 piece", 45, null)), 2, null, estimate("usda-1", 1, 230)],
    // The photo's own grams, to the whole gram and never under one.
    ["the photo's grams to the whole gram", fed(), null, 12.4, estimate("g", 12, 12)],
    ["never under a gram", fed(), null, 0.3, estimate("g", 1, 1)],
    // Only a start the save would take.
    ["a count that weighs under a gram is no start, even at the photo's gram", fed(portion(1, "leaf", 0.4)), 1, 1, estimate("g", 1, 1)],
    ["three of it weigh the photo's gram", fed(portion(1, "leaf", 0.4)), 3, 1, at("usda-1", 3, 1)],
    ["past what one item of a meal may weigh is no start", fed(portion(1, "tray", 400)), 30, MAX_ITEM_GRAMS, estimate("g", MAX_ITEM_GRAMS, MAX_ITEM_GRAMS)],
    ["what one item may weigh, exactly, is", fed(portion(1, "tray", 400)), 25, MAX_ITEM_GRAMS, at("usda-1", 25, MAX_ITEM_GRAMS)],
    // Kd's plates and PR #71's review cases, as the form writes them.
    ["100 g of scrambled eggs are no large egg of 61 g", fed(portion(1, "large", 61), portion(2, "cup", 220)), 1, 100, estimate("g", 100, 100)],
    ["a 250 g mug of iced coffee is no 496 g medium", fed(portion(1, "fl oz", 30), portion(2, "medium", 496)), 1, 250, estimate("g", 250, 250)],
    ["ten banana slices are no ten bananas", own(120, "banana", [portion(1, "cup, sliced", 150), portion(2, "medium", 118)]), 10, 60, estimate("g", 60, 60)],
    ["a cereal bowl of cornflakes is no 30 g cup, nor 375 g of water", fed(portion(1, "cup", 30)), 1, 45, estimate("g", 45, 45)],
    ["two bowls of them are no two cups", fed(portion(1, "cup", 30)), 2, 90, estimate("g", 90, 90)],
    ["a cup of almonds is their own 143 g cup, not 240 g", fed(portion(1, "cup, whole", 143), portion(2, "almond", 1.2)), 1, 143, at("usda-1", 1, 143)],
    ["twenty almonds are twenty almonds", fed(portion(1, "cup, whole", 143), portion(2, "almond", 1.2)), 20, 26, at("usda-2", 20, 24)],
  ])("%s", (_, source, count, seenGrams, expected) => {
    const measures = foodMeasures(source);
    const start = scanStart(source, measures, count, seenGrams);
    expect(start).toEqual(expected);
  });

  it("always starts at one of the food's own measures, at what that amount of it weighs, and only at a count near the photo's grams", () => {
    const sources: MeasureSource[] = [
      usdaFood(100, "g", []),
      own(180, "apple", [portion(1, "cup slices", 109), portion(2, "medium", 182), portion(3, "small", 149)]),
      usdaFood(30, "slice", [portion(1, "slice", 30), portion(2, "cup, crumbs", 108), portion(3, "leaf", 0.4)]),
      own(65, "bottle"),
      own(30, "g"),
    ];
    for (const source of sources) {
      const measures = foodMeasures(source);
      for (const count of [null, 1, 2, 3, 6, 30]) {
        for (const seen of [null, 0.4, 1, 9.5, 20, 64, 100, 181, 2000, MAX_ITEM_GRAMS]) {
          const label = `${source.unit} ×${String(count)} at ${String(seen)}`;
          const start = scanStart(source, measures, count, seen);
          const measure = measures.find((m) => m.id === start.measure);
          expect(measure, label).toBeDefined();
          if (measure === undefined) continue;
          expect(start.grams, label).toBe(measureGrams(measure, start.amount));
          expect(start.grams, label).toBeGreaterThanOrEqual(1);
          expect(start.grams, label).toBeLessThanOrEqual(MAX_ITEM_GRAMS);
          if (start.estimated) continue;
          // A start that is no estimate is the photo's own count of a counted measure, near its grams.
          expect([start.amount, measure.id === GRAM.id || measure.id === OUNCE.id], label).toEqual([count, false]);
          expect(seen, label).not.toBeNull();
          expect(100 * Math.abs(start.grams - (seen ?? 0)), label).toBeLessThanOrEqual(SCAN_START_TOLERANCE_PERCENT * (seen ?? 0));
        }
      }
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
