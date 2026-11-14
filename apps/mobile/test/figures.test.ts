import { describe, expect, it } from "vitest";
import { MORE_NOT_KNOWN, dailyAmountsFor, type MoreNutrients } from "@app/shared";
import { figureLines, figuresFromALabel, jarFill, missingFoodsWords, shareSaid, shareWords } from "../src/screens/food/figures";
import { LEVELS, fillLevel, fillTop } from "../src/screens/food/jarLevels";

// ROADMAP Stage 5 34b. Real figures: 150 g of USDA's "Lentils, mature seeds, cooked, boiled, without
// salt", read from the loaded table on 2026-11-01. The pizza stands for any food with no figures: a
// scan's estimate, or the person's own numbers.
const lentils = {
  name: "Lentils",
  canonical: "usda_lentils",
  nutritionSource: "usda" as const,
  more: { ...MORE_NOT_KNOWN, fiberG: 11.9, sugarsG: 2.7, satFatG: 0.1, sodiumMg: 3, potassiumMg: 554, calciumMg: 29, ironMg: 5, magnesiumMg: 54, vitaminDUg: 0 },
};
const pizza = { name: "Pizza", canonical: "est_pizza", nutritionSource: "estimate" as const, more: MORE_NOT_KNOWN };
const woman = dailyAmountsFor(30, "female").amounts;
const line = (lines: ReturnType<typeof figureLines>, key: keyof MoreNutrients) => lines.find((l) => l.key === key);

describe("the ten figures, read as a list", () => {
  it("the worst thing: a food with no sodium figure never lets the day read as the whole amount", () => {
    expect(line(figureLines([lentils, pizza], false, woman), "sodiumMg")).toEqual({
      key: "sodiumMg", name: "Sodium", value: "3 mg*", note: "Limit 2,300 mg", share: 3 / 2300, limit: true, incomplete: true,
    });
  });

  it("every food known: the amount alone, beside the published one", () => {
    const lines = figureLines([lentils], false, woman);
    expect(line(lines, "fiberG")).toMatchObject({ name: "Fibre", value: "11.9 g", note: "Recommended 25 g" });
    expect(line(lines, "sodiumMg")).toMatchObject({ value: "3 mg", note: "Limit 2,300 mg" });
    expect(line(lines, "ironMg")).toMatchObject({ value: "5 mg", note: "Recommended 18 mg" });
  });

  it("a measured 0 reads 0; a figure no food gives reads No data, never 0", () => {
    expect(line(figureLines([lentils], false, null), "vitaminDUg")?.value).toBe("0 mcg");
    expect(line(figureLines([lentils], false, woman), "unsatFatG")).toMatchObject({ value: "No data", note: null });
    expect(line(figureLines([pizza], false, woman), "vitaminDUg")).toMatchObject({ value: "No data", note: "Recommended 15 mcg" });
  });

  it("no published amount: no reference, and none invented", () => {
    expect(line(figureLines([lentils], false, woman), "sugarsG")).toMatchObject({ value: "2.7 g", note: null });
  });

  it("the amounts not loaded: the figures still show", () => {
    expect(line(figureLines([lentils], false, null), "fiberG")).toMatchObject({ value: "11.9 g", note: null });
  });

  it("the foods missing it are named, and a food saved before the figures were kept is one of them", () => {
    const old = { name: "Oats", canonical: "oats", nutritionSource: "usda" as const, more: undefined };
    expect(line(figureLines([lentils, pizza, old], false, null), "ironMg")).toMatchObject({ value: "5 mg*", note: null });
    expect(missingFoodsWords([lentils, pizza, old])).toBe("* Some data is missing for Pizza and Oats.");
  });

  it("a meal not here yet marks every figure, and none alone reads No data", () => {
    expect(line(figureLines([lentils], true, null), "fiberG")?.value).toBe("11.9 g*");
    expect(line(figureLines([], true, null), "fiberG")?.value).toBe("No data");
  });

  it("a list with no foods reads No data, never 0", () => {
    expect(line(figureLines([], false, null), "sodiumMg")?.value).toBe("No data");
  });

  it("marks the thousands", () => {
    const big = { ...lentils, more: { ...lentils.more, sodiumMg: 2345 } };
    expect(line(figureLines([big], false, null), "sodiumMg")?.value).toBe("2,345 mg");
  });
});

describe("the line naming the foods", () => {
  const whole = { ...lentils, more: { ...lentils.more, unsatFatG: 1 } };
  it("no line where every total is whole, or where a row already reads No data", () => {
    expect(missingFoodsWords([whole])).toBeNull();
    expect(missingFoodsWords([pizza])).toBeNull();
  });
  it("names only foods missing a starred total, never one missing a figure no food gives", () => {
    expect(missingFoodsWords([lentils, pizza])).toBe("* Some data is missing for Pizza.");
  });
  it("names one, two, and then a count; what the photo saw is the name the person knows", () => {
    expect(missingFoodsWords([whole, pizza])).toBe("* Some data is missing for Pizza.");
    expect(missingFoodsWords([whole, pizza, { ...pizza, name: "Dal" }])).toBe("* Some data is missing for Pizza and Dal.");
    expect(missingFoodsWords([whole, pizza, { ...pizza, name: "A" }, { ...pizza, name: "B" }, { ...pizza, name: "C" }])).toBe("* Some data is missing for Pizza, A and 2 more.");
    expect(missingFoodsWords([whole, { ...pizza, seenAs: "Slice" }])).toBe("* Some data is missing for Slice.");
  });
});

describe("whose figures they are", () => {
  it("a packaged product that gave a figure says its label; one that gave none, or a table's food, does not", () => {
    const pack = { canonical: "pack_8901719101038", nutritionSource: "usda" as const, more: { ...MORE_NOT_KNOWN, sodiumMg: 40 } };
    expect(figuresFromALabel([pack])).toBe(true);
    expect(figuresFromALabel([{ ...pack, canonical: "off_8901719101038", nutritionSource: "openfoodfacts" as const }])).toBe(true);
    expect(figuresFromALabel([{ ...pack, more: MORE_NOT_KNOWN }])).toBe(false);
    expect(figuresFromALabel([lentils, pizza])).toBe(false);
  });
});

describe("the pantry: each nutrient filled to its share of the published amount (32c-ii-a)", () => {
  it("every class of share: part, none, a measured 0, past full, no figure, no published amount, an incomplete total", () => {
    const lines = figureLines([lentils], false, woman);
    // Part of the amount: lentils' 5 mg of iron of 18 mg.
    expect(line(lines, "ironMg")).toMatchObject({ share: 5 / 18, limit: false });
    expect(shareWords(line(lines, "ironMg")?.share ?? null)).toBe("28%");
    expect(jarFill(5 / 18)).toBeCloseTo(0.278, 3);
    // A limit, not a target.
    expect(line(lines, "sodiumMg")).toMatchObject({ share: 3 / 2300, limit: true });
    expect(shareWords(3 / 2300)).toBe("0%");
    // A measured 0 is an empty picture at 0 %, never "No data".
    expect(line(lines, "vitaminDUg")).toMatchObject({ value: "0 mcg", share: 0 });
    expect([jarFill(0), shareWords(0)]).toEqual([0, "0%"]);
    // Past the amount: the picture stops at full, the words say all of it.
    expect([jarFill(1.3), shareWords(1.3)]).toEqual([1, "130%"]);
    // No figure from any food: no share, so an empty picture and no percent.
    expect(line(figureLines([pizza], false, woman), "vitaminDUg")).toMatchObject({ value: "No data", share: null });
    expect([jarFill(null), shareWords(null)]).toEqual([0, null]);
    // No published amount (sugars), or the daily amounts not loaded: no share invented.
    expect(line(lines, "sugarsG")?.share).toBeNull();
    expect(line(figureLines([lentils], false, null), "ironMg")?.share).toBeNull();
    // An incomplete total keeps its * on the badge too, never a plain share (round one, H1), and says it.
    const partIron = line(figureLines([lentils, pizza], false, woman), "ironMg");
    expect(partIron).toMatchObject({ value: "5 mg*", share: 5 / 18, incomplete: true });
    expect(shareWords(partIron?.share ?? null, partIron?.incomplete)).toBe("28%*");
    expect(partIron === undefined ? "" : shareSaid(partIron)).toBe(". 28% of the recommended amount, from the foods that give it");
    // Meals of the day not here yet make every total incomplete; a whole total has no *.
    expect(line(figureLines([lentils], true, woman), "ironMg")).toMatchObject({ value: "5 mg*", incomplete: true });
    expect(line(lines, "ironMg")).toMatchObject({ value: "5 mg", incomplete: false });
    expect(shareSaid({ share: 3 / 2300, limit: true, incomplete: false })).toBe(". 0% of the limit");
    expect(shareSaid({ share: null, limit: false, incomplete: false })).toBe("");
    // Nothing that is not a number ever fills a picture.
    expect([jarFill(Number.NaN), shareWords(Number.POSITIVE_INFINITY)]).toEqual([0, null]);
  });
});

describe("the pantry's pictures fill by what they hold, never by their height (round one, H2)", () => {
  it("empty at the foot, full at the top, higher for every larger share, for every nutrient", () => {
    for (const [key, levels] of Object.entries(LEVELS) as [keyof typeof LEVELS, readonly number[]][]) {
      expect(levels).toHaveLength(21);
      expect(fillLevel(key, 0)).toBe(levels[0]);
      expect(fillLevel(key, 1)).toBe(levels[20]);
      // Past full or under empty, never past the picture.
      expect([fillLevel(key, 1.5), fillLevel(key, -1)]).toEqual([levels[20], levels[0]]);
      for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeLessThan(levels[i - 1] ?? 0);
    }
  });

  it("a quarter of the cheese is a quarter of what it holds: its level as measured, well under a quarter of its height", () => {
    // The cheese runs from 11 (its point) to 38 (its foot). A quarter of its height is 31.25; a quarter of
    // what it holds lies at 34.7, its wide foot holding most of it.
    expect(fillLevel("satFatG", 0.25)).toBeCloseTo(33.8, 5);
    expect(fillLevel("satFatG", 0.25)).toBeGreaterThan(31.25);
    // Between two measured shares, a straight line: 12.5 % halfway from 10 % to 15 %.
    expect(fillLevel("satFatG", 0.125)).toBeCloseTo((36.4 + 35.5) / 2, 5);
    // The ear of wheat holds little at its foot: half of it lies far above half its height.
    expect(fillLevel("fiberG", 0.5)).toBeCloseTo(19.3, 5);
  });
});

describe("the fill as drawn (round one's untested fill)", () => {
  it("no share, no figure, a share of 0 or not a number: no fill at all; past full: full; else the measured level", () => {
    expect([fillTop("ironMg", null), fillTop("ironMg", 0), fillTop("ironMg", Number.NaN)]).toEqual([null, null, null]);
    expect(fillTop("ironMg", 1.54)).toEqual({ level: 5.6, swell: 2.6 });
    expect(fillTop("ironMg", 5 / 18)?.level).toBeCloseTo(fillLevel("ironMg", 5 / 18), 9);
    // Low in the picture, never upside down: a small share sits near the foot (45), a large one near the top.
    expect(fillTop("ironMg", 0.1)?.level).toBeGreaterThan(35);
    expect(fillTop("ironMg", 0.9)?.level).toBeLessThan(12);
    // A sliver of the cheese's limit: its wave no taller than the fill under it.
    const sliver = fillTop("satFatG", 0.01);
    expect(sliver?.swell).toBeCloseTo(2 * (38 - fillLevel("satFatG", 0.01)), 9);
    expect(sliver?.swell).toBeLessThan(0.5);
  });
});
