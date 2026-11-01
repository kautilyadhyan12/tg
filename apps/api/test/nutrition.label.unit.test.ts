import { describe, expect, it } from "vitest";
import { MORE_NOT_KNOWN, MORE_NUTRIENTS, moreForGrams, sumMoreNutrients } from "@app/shared";
import { labelMore } from "../src/modules/nutrition/openfoodfacts.adapter.js";

// A product label's ten further figures (ROADMAP 34a). The first four are the
// `nutriments` of Open Food Facts' product PAGE for these barcodes on 2026-10-13,
// as they were; the fifth is a hit of the search address the app asks, which
// sends fewer figures; then cases no real label of these had.

describe("a product label's further figures", () => {
  it.each([
    ["Campbell's Cream of Mushroom Soup, 0051000012616: a US label with minerals and no magnesium",
      { fiber_100g: 0, sugars_100g: 0.833333333333333, "saturated-fat_100g": 0.833333333333333, sodium_100g: 0.716666666666667, sodium_unit: "g", salt_100g: 1.79166666666667, potassium_100g: 0.0416666666666667, potassium_unit: "g", calcium_100g: 0.00833333333333333, iron_100g: 0.000166666666666667, "vitamin-d_100g": 0 },
      { fiberG: 0, sugarsG: 0.833, satFatG: 0.833, unsatFatG: null, sodiumMg: 716.667, potassiumMg: 41.667, calciumMg: 8.333, ironMg: 0.167, magnesiumMg: null, vitaminDUg: 0 }],
    ["Nutella, 3017620422003: a European label, salt and sodium and no minerals",
      { fiber_100g: 0, sugars_100g: 56.3, "saturated-fat_100g": 10.6, sodium_100g: 0.0428, sodium_unit: "g", salt_100g: 0.107 },
      { fiberG: 0, sugarsG: 56.3, satFatG: 10.6, unsatFatG: null, sodiumMg: 42.8, potassiumMg: null, calciumMg: null, ironMg: null, magnesiumMg: null, vitaminDUg: null }],
    ["Coca-Cola Original, 5449000000996: no fibre on the label, and a sodium of nought that IS on it",
      { sugars_100g: 10.6, "saturated-fat_100g": 0, sodium_100g: 0, sodium_unit: "g", salt_100g: 0 },
      { fiberG: null, sugarsG: 10.6, satFatG: 0, unsatFatG: null, sodiumMg: 0, potassiumMg: null, calciumMg: null, ironMg: null, magnesiumMg: null, vitaminDUg: null }],
    ["Cheerios, 0016000275287",
      { fiber_100g: 10.2564102564103, sugars_100g: 5.12820512820513, "saturated-fat_100g": 1.28205128205128, sodium_100g: 0.487179487179487, salt_100g: 1.21794871794872 },
      { fiberG: 10.256, sugarsG: 5.128, satFatG: 1.282, unsatFatG: null, sodiumMg: 487.179, potassiumMg: null, calciumMg: null, ironMg: null, magnesiumMg: null, vitaminDUg: null }],
    ["Campbell's soup cream of mushroom, 0051000129680, as the search sent it: four of the ten",
      { "energy-kcal_100g": 83, proteins_100g: 1.67, sugars_100g: 0.83, fat_100g: 5.83, salt_100g: 1.8125, sodium_100g: 0.725, fiber_100g: 0, "saturated-fat_100g": 0.83, carbohydrates_100g: 6.67 },
      { ...MORE_NOT_KNOWN, fiberG: 0, sugarsG: 0.83, satFatG: 0.83, sodiumMg: 725 }],
    ["both kinds of unsaturated fat are added together, and one alone is not the whole",
      { "monounsaturated-fat_100g": 21.021, "polyunsaturated-fat_100g": 3.043 },
      { ...MORE_NOT_KNOWN, unsatFatG: 24.064 }],
    ["one kind of unsaturated fat alone", { "monounsaturated-fat_100g": 21.021 }, MORE_NOT_KNOWN],
    ["a label that prints salt and no sodium: sodium is salt over 2.5",
      { salt_100g: 1.25 },
      { ...MORE_NOT_KNOWN, sodiumMg: 500 }],
    ["figures sent as text, as some entries are",
      { sodium_100g: "0.2", fiber_100g: "3.5", calcium_100g: "" },
      { ...MORE_NOT_KNOWN, sodiumMg: 200, fiberG: 3.5 }],
    ["milligrams typed where grams belong (480 g of sodium in 100 g): not known, never a number",
      { sodium_100g: 480, iron_100g: 8, "vitamin-d_100g": 0.01, fiber_100g: 250, potassium_100g: 20, calcium_100g: 9, magnesium_100g: 1, "monounsaturated-fat_100g": 80, "polyunsaturated-fat_100g": 70 },
      MORE_NOT_KNOWN],
    ["a figure below nought, or not a number at all",
      { sodium_100g: -0.2, potassium_100g: "a lot", calcium_100g: null, iron_100g: Number.NaN, magnesium_100g: {} },
      MORE_NOT_KNOWN],
    ["a label with none of the ten", { "energy-kcal_100g": 250 }, MORE_NOT_KNOWN],
  ])("%s", (_name, nutriments, expected) => {
    expect(labelMore(nutriments)).toEqual(expected);
  });
});

describe("the figures for an amount, and their sum", () => {
  const per100g = { fiberG: 2.6, sugarsG: 12.23, satFatG: 0.112, unsatFatG: 0.105, sodiumMg: 1, potassiumMg: 358, calciumMg: 5, ironMg: 0.26, magnesiumMg: 27, vitaminDUg: null };

  it("an amount scales each figure and keeps a gap a gap", () => {
    expect(moreForGrams(per100g, 120)).toEqual({ fiberG: 3.1, sugarsG: 14.7, satFatG: 0.1, unsatFatG: 0.1, sodiumMg: 1, potassiumMg: 430, calciumMg: 6, ironMg: 0.3, magnesiumMg: 32, vitaminDUg: null });
    expect(moreForGrams(MORE_NOT_KNOWN, 500)).toEqual(MORE_NOT_KNOWN);
  });

  it("a sum adds the foods that give a figure and counts the foods that do not, a food with no figures at all among them", () => {
    const sum = sumMoreNutrients([
      { more: { ...MORE_NOT_KNOWN, sodiumMg: 530, fiberG: 0.6 } },
      { more: { ...MORE_NOT_KNOWN, sodiumMg: 0, fiberG: 0.25 } },
      { more: MORE_NOT_KNOWN },
      {},
    ]);
    expect(sum.sodiumMg).toEqual({ amount: 530, notKnown: 2 });
    expect(sum.fiberG).toEqual({ amount: 0.9, notKnown: 2 });
    expect(sum.ironMg).toEqual({ amount: 0, notKnown: 4 });
    expect(Object.keys(sum)).toEqual([...MORE_NUTRIENTS]);
    // No food at all: nothing is missing and nothing is eaten.
    expect(sumMoreNutrients([]).sodiumMg).toEqual({ amount: 0, notKnown: 0 });
  });
});
