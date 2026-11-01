import { describe, expect, it } from "vitest";
import { MORE_NOT_KNOWN, dailyAmountsFor, type MoreNutrients } from "@app/shared";
import { figureLines, figuresFromALabel } from "../src/screens/food/figures";

// ROADMAP Stage 5 34b. Real figures: 150 g of USDA's "Lentils, mature seeds, cooked, boiled, without
// salt", read from the loaded table on 2026-11-01. The pizza stands for any food with no figures: a
// scan's estimate, or the person's own numbers.
const lentils = {
  canonical: "usda_lentils",
  nutritionSource: "usda" as const,
  more: { ...MORE_NOT_KNOWN, fiberG: 11.9, sugarsG: 2.7, satFatG: 0.1, sodiumMg: 3, potassiumMg: 554, calciumMg: 29, ironMg: 5, magnesiumMg: 54, vitaminDUg: 0 },
};
const pizza = { canonical: "est_pizza", nutritionSource: "estimate" as const, more: MORE_NOT_KNOWN };
const woman = dailyAmountsFor(30, "female").amounts;
const line = (lines: ReturnType<typeof figureLines>, key: keyof MoreNutrients) => lines.find((l) => l.key === key);

describe("the ten figures, read as a list", () => {
  it("the worst thing: a food with no sodium figure never lets the day read as the whole amount", () => {
    expect(line(figureLines([lentils, pizza], false, woman), "sodiumMg")).toEqual({
      key: "sodiumMg", name: "Sodium", value: "about 3 mg", note: "1 food not known · no more than 2,300 mg a day",
    });
  });

  it("every food known: the amount alone, beside the published one", () => {
    const lines = figureLines([lentils], false, woman);
    expect(line(lines, "fiberG")).toMatchObject({ name: "Fibre", value: "11.9 g", note: "Of about 25 g a day" });
    expect(line(lines, "sodiumMg")).toMatchObject({ value: "3 mg", note: "No more than 2,300 mg a day" });
    expect(line(lines, "ironMg")).toMatchObject({ value: "5 mg", note: "Of about 18 mg a day" });
  });

  it("a measured 0 reads 0; a figure no food gives reads Not known, never 0", () => {
    expect(line(figureLines([lentils], false, null), "vitaminDUg")?.value).toBe("0 µg");
    expect(line(figureLines([lentils], false, woman), "unsatFatG")).toMatchObject({ value: "Not known", note: null });
    expect(line(figureLines([pizza], false, woman), "vitaminDUg")).toMatchObject({ value: "Not known", note: "About 15 µg a day" });
  });

  it("no published amount: no reference, and none invented", () => {
    expect(line(figureLines([lentils], false, woman), "sugarsG")).toMatchObject({ value: "2.7 g", note: null });
  });

  it("the amounts not loaded: the figures still show", () => {
    expect(line(figureLines([lentils], false, null), "fiberG")).toMatchObject({ value: "11.9 g", note: null });
  });

  it("several foods missing it are counted, and a food saved before the figures were kept is one of them", () => {
    const old = { canonical: "oats", nutritionSource: "usda" as const, more: undefined };
    expect(line(figureLines([lentils, pizza, old], false, null), "ironMg")).toMatchObject({ value: "about 5 mg", note: "2 foods not known" });
  });

  it("a meal not here yet makes every figure about, and none alone reads Not known", () => {
    expect(line(figureLines([lentils], true, null), "fiberG")?.value).toBe("about 11.9 g");
    expect(line(figureLines([], true, null), "fiberG")?.value).toBe("Not known");
  });

  it("marks the thousands", () => {
    const big = { ...lentils, more: { ...lentils.more, sodiumMg: 2345 } };
    expect(line(figureLines([big], false, null), "sodiumMg")?.value).toBe("2,345 mg");
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
