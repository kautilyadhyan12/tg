import { describe, expect, it } from "vitest";
import { MORE_NOT_KNOWN, dailyAmountsFor, type MoreNutrients } from "@app/shared";
import { figureLines, figuresFromALabel, missingFoodsWords } from "../src/screens/food/figures";

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
      key: "sodiumMg", name: "Sodium", value: "3 mg*", note: "Limit 2,300 mg",
    });
  });

  it("every food known: the amount alone, beside the published one", () => {
    const lines = figureLines([lentils], false, woman);
    expect(line(lines, "fiberG")).toMatchObject({ name: "Fibre", value: "11.9 g", note: "Recommended 25 g" });
    expect(line(lines, "sodiumMg")).toMatchObject({ value: "3 mg", note: "Limit 2,300 mg" });
    expect(line(lines, "ironMg")).toMatchObject({ value: "5 mg", note: "Recommended 18 mg" });
  });

  it("a measured 0 reads 0; a figure no food gives reads No data, never 0", () => {
    expect(line(figureLines([lentils], false, null), "vitaminDUg")?.value).toBe("0 µg");
    expect(line(figureLines([lentils], false, woman), "unsatFatG")).toMatchObject({ value: "No data", note: null });
    expect(line(figureLines([pizza], false, woman), "vitaminDUg")).toMatchObject({ value: "No data", note: "Recommended 15 µg" });
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
    expect(missingFoodsWords([lentils, pizza, old])).toBe("* Some data is missing for Lentils, Pizza and Oats.");
  });

  it("a meal not here yet marks every figure, and none alone reads No data", () => {
    expect(line(figureLines([lentils], true, null), "fiberG")?.value).toBe("11.9 g*");
    expect(line(figureLines([], true, null), "fiberG")?.value).toBe("No data");
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
