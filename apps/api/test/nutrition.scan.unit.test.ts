// ROADMAP 7a-iii-b — what each food a scan sees is priced by: the model's own
// estimate and when it is no number, the 3× wrong-food check, the energy a USDA
// entry must agree with, the order of the tables, the estimate row, and the
// portion each priced food is served by. Kd's eight plates run through the real
// lookups in nutrition.scan.routes.test.ts.
import { describe, expect, it } from "vitest";
import { mealVesselSchema, per100gSchema, type MealVessel, type VisionEvidence, type VisionItem } from "@app/shared";
import type { FoodReference } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import {
  ENERGY_SLACK_KCAL,
  ENERGY_TOLERANCE,
  ESTIMATE_CANONICAL_PREFIX,
  MAX_ESTIMATE_KCAL_PER_100G,
  WRONG_FOOD_MIN_GAP_KCAL,
  WRONG_FOOD_RATIO,
  energySeen,
  estimateFood,
  estimatePer100g,
  isWrongFood,
  priceScannedFood,
  type EnergySeen,
  type ScanLookups,
} from "../src/modules/nutrition/scanMatch.js";
import { scanSheet } from "../src/modules/nutrition/service.js";

/** A scanned food, with the model's five figures as given. */
const seen = (figures: Partial<Pick<VisionItem, "grams" | "kcal" | "protein_g" | "carbs_g" | "fat_g">>, hint = "zqxfood"): VisionItem => ({
  name: hint, canonical_hint: hint, vessel: null, fill_level: null, size_class: null, count: null,
  grams: 100, kcal: 100, protein_g: 0, carbs_g: 25, fat_g: 0, ...figures,
});

const tableFood = (name: string, kcal: number, source: FoodReference["source"] = "curated"): FoodReference => ({
  canonical: `${source}_${name}`, name, kcal, proteinG: 0, carbsG: kcal / 4, fatG: 0, fiberG: null, serving: 100, unit: "g", source,
});

describe("the model's own estimate", () => {
  it("is its figures per 100 g", () => {
    // 150 g of chicken at 240 kcal: 30 g protein and 12 g fat make 228 kcal, within 30 %.
    expect(estimatePer100g(seen({ grams: 150, kcal: 240, protein_g: 30, carbs_g: 0, fat_g: 12 }))).toEqual({ kcal: 160, proteinG: 20, carbsG: 0, fatG: 8 });
    // A glass of water: nothing in it, and that is a number.
    expect(estimatePer100g(seen({ grams: 250, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }))).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });

  it("is no number where any of the five is missing", () => {
    for (const slot of ["grams", "kcal", "protein_g", "carbs_g", "fat_g"] as const) {
      expect(estimatePer100g(seen({ [slot]: null })), slot).toBeNull();
    }
  });

  it("is no number where its macros do not make its kcal: 30 % either way, or 10 kcal on a small item", () => {
    expect([ENERGY_TOLERANCE, ENERGY_SLACK_KCAL]).toEqual([0.3, 10]);
    // 100 kcal: macros making 70 to 130 are an estimate, and a hair past either end is not.
    expect(estimatePer100g(seen({ kcal: 100, carbs_g: 32.5 }))).not.toBeNull();
    expect(estimatePer100g(seen({ kcal: 100, carbs_g: 32.6 }))).toBeNull();
    expect(estimatePer100g(seen({ kcal: 100, carbs_g: 17.5 }))).not.toBeNull();
    expect(estimatePer100g(seen({ kcal: 100, carbs_g: 17.4 }))).toBeNull();
    // 20 kcal: 30 % is 6, so the 10 kcal of rounding is what holds — 10 to 30.
    expect(estimatePer100g(seen({ kcal: 20, carbs_g: 7.5 }))).not.toBeNull();
    expect(estimatePer100g(seen({ kcal: 20, carbs_g: 7.6 }))).toBeNull();
    expect(estimatePer100g(seen({ kcal: 20, carbs_g: 2.5 }))).not.toBeNull();
    expect(estimatePer100g(seen({ kcal: 20, carbs_g: 2.4 }))).toBeNull();
    // A lemon as the eight plates wrote it: 40 g, 12 kcal, 4 g of carbohydrate (16 kcal).
    expect(estimatePer100g(seen({ grams: 40, kcal: 12, protein_g: 0, carbs_g: 4, fat_g: 0 }))).not.toBeNull();
    // Kcal with no macros behind them at all is a contradiction, not a food.
    expect(estimatePer100g(seen({ kcal: 500, carbs_g: 0 }))).toBeNull();
  });

  it("is no number past the energy food carries", () => {
    expect(MAX_ESTIMATE_KCAL_PER_100G).toBe(900);
    // 10 g of pure fat is 90 kcal: 900 per 100 g, the most there is.
    expect(estimatePer100g(seen({ grams: 10, kcal: 90, protein_g: 0, carbs_g: 0, fat_g: 10 }))).toEqual({ kcal: 900, proteinG: 0, carbsG: 0, fatG: 100 });
    // 91 kcal from the same 10 g of fat: the macros still make it within rounding,
    // and they weigh no more than the food, so the 900 is the only rule that refuses it.
    expect(estimatePer100g(seen({ grams: 10, kcal: 91, protein_g: 0, carbs_g: 0, fat_g: 10 }))).toBeNull();
  });

  it("is no number where its protein, carbohydrate and fat together weigh more than the food", () => {
    // Every case below passes the other rules — its macros make its kcal, and it is
    // under 900 kcal per 100 g — so the weight is the only rule that decides it.
    const cases: [string, Partial<Pick<VisionItem, "grams" | "kcal" | "protein_g" | "carbs_g" | "fat_g">>, boolean][] = [
      // Each macro alone: a gram over the food's weight, and at it.
      ["protein over", { grams: 10, kcal: 44, protein_g: 11, carbs_g: 0, fat_g: 0 }, false],
      ["protein at", { grams: 10, kcal: 40, protein_g: 10, carbs_g: 0, fat_g: 0 }, true],
      ["carbohydrate over", { grams: 10, kcal: 44, protein_g: 0, carbs_g: 11, fat_g: 0 }, false],
      ["carbohydrate at", { grams: 10, kcal: 40, protein_g: 0, carbs_g: 10, fat_g: 0 }, true],
      ["fat over", { grams: 10, kcal: 90, protein_g: 0, carbs_g: 0, fat_g: 11 }, false],
      ["fat at", { grams: 10, kcal: 90, protein_g: 0, carbs_g: 0, fat_g: 10 }, true],
      // None heavier than the food alone, together heavier: 60 g of protein and 60 g
      // of carbohydrate in 100 g at 480 kcal, and all three.
      ["two together over", { grams: 100, kcal: 480, protein_g: 60, carbs_g: 60, fat_g: 0 }, false],
      ["three together over", { grams: 10, kcal: 59, protein_g: 4, carbs_g: 4, fat_g: 3 }, false],
      ["three together at", { grams: 10, kcal: 55, protein_g: 4, carbs_g: 3, fat_g: 3 }, true],
    ];
    for (const [label, figures, isNumber] of cases) expect(estimatePer100g(seen(figures)) !== null, label).toBe(isNumber);
  });

  it("reads a macro exactly as heavy as the food at 100 g per 100 g, never a rounding past what a saved meal accepts", () => {
    // 0.69 g of protein in 0.69 g: multiplied before dividing, this reads
    // 100.00000000000001 g, which the meal's own contract (at most 100) refuses.
    const estimate = estimatePer100g(seen({ grams: 0.69, kcal: 2.76, protein_g: 0.69, carbs_g: 0, fat_g: 0 }));
    expect(estimate?.proteinG).toBe(100);
    expect(per100gSchema.safeParse(estimate).success).toBe(true);
  });
});

describe("a table food the model's energy says is another food", () => {
  it("is more than three times from it, either way, and more than 10 kcal per 100 g apart", () => {
    expect([WRONG_FOOD_RATIO, WRONG_FOOD_MIN_GAP_KCAL]).toEqual([3, 10]);
    const model = (kcal: number) => ({ kcal, proteinG: 0, carbsG: 0, fatG: 0 });
    const cases: [number, number, boolean][] = [
      // "juice" read as a concentrate, and the other way round.
      [159, 45, true], [45, 159, true],
      // Three times is not more than three times.
      [45, 135, false], [45, 135.1, true], [135, 45, false], [135.1, 45, true],
      // Next to no energy on either side is rounding, not another food…
      [1, 4, false], [0, 10, false], [1, 11, false],
      // …until the gap is more than 10: a diet cola for a cola, black tea for milky.
      [1, 11.1, true], [0, 42, true], [42, 0, true],
      [160, 165, false], [0, 0, false],
    ];
    for (const [table, estimate, wrong] of cases) expect(isWrongFood(table, model(estimate)), `${String(table)} vs ${String(estimate)}`).toBe(wrong);
  });

  it("never is where the model gave no usable number", () => {
    expect(isWrongFood(900, null)).toBe(false);
  });
});

describe("the energy a scan saw, which chooses among USDA entries of one name", () => {
  const at = (kcal: number): EnergySeen | null => energySeen({ kcal, proteinG: 0, carbsG: 0, fatG: 0 });

  it("is the model's energy per 100 g, good to 30 %, or to 10 kcal where that is more", () => {
    const hundred = at(100);
    expect(hundred?.kcal).toBe(100);
    expect(hundred?.slack).toBeCloseTo(30, 9);
    // A raw radish at 16: 30 % is under 5, so 10 holds.
    expect(at(16)).toEqual({ kcal: 16, slack: 10 });
    expect(at(0)).toEqual({ kcal: 0, slack: 10 });
  });

  it("is none where the model gave no usable number", () => {
    expect(energySeen(null)).toBeNull();
  });
});

describe("the order a scanned food is priced in", () => {
  /** Lookups that answer from the given foods and say which were asked, and with what energy. */
  const lookups = (answers: { ourList?: FoodReference; usda?: FoodReference; packaged?: FoodReference }) => {
    const asked: string[] = [];
    const usdaSaw: (EnergySeen | null)[] = [];
    const ask = (rung: keyof typeof answers) => (hint: string): FoodReference | null => {
      asked.push(`${rung}:${hint}`);
      return answers[rung] ?? null;
    };
    const table: ScanLookups = {
      ourList: ask("ourList"),
      usda: (hint, energy) => {
        usdaSaw.push(energy);
        return Promise.resolve(ask("usda")(hint));
      },
      packaged: (hint) => Promise.resolve(ask("packaged")(hint)),
    };
    return { asked, usdaSaw, table };
  };
  const plate = seen({ grams: 200, kcal: 200, protein_g: 0, carbs_g: 50, fat_g: 0 }, "zqxdish");
  const ours = tableFood("ours", 110);
  const usda = tableFood("usda", 90, "usda");
  const packaged = tableFood("packaged", 120, "openfoodfacts");

  it("is our list, then USDA, then a packaged product, each asked only when the one above has nothing", async () => {
    const all = lookups({ ourList: ours, usda, packaged });
    expect(await priceScannedFood(plate, all.table)).toEqual({ kind: "table", food: ours });
    expect(all.asked).toEqual(["ourList:zqxdish"]);
    const noOurs = lookups({ usda, packaged });
    expect(await priceScannedFood(plate, noOurs.table)).toEqual({ kind: "table", food: usda });
    expect(noOurs.asked).toEqual(["ourList:zqxdish", "usda:zqxdish"]);
    const onlyPackaged = lookups({ packaged });
    expect(await priceScannedFood(plate, onlyPackaged.table)).toEqual({ kind: "table", food: packaged });
    expect(onlyPackaged.asked).toEqual(["ourList:zqxdish", "usda:zqxdish", "packaged:zqxdish"]);
  });

  it("asks USDA with the energy the model saw, and with none where it gave no usable number", async () => {
    const withNumbers = lookups({});
    await priceScannedFood(plate, withNumbers.table);
    // 200 kcal in 200 g is 100 per 100 g, good to 30.
    expect(withNumbers.usdaSaw).toHaveLength(1);
    expect(withNumbers.usdaSaw[0]?.kcal).toBe(100);
    expect(withNumbers.usdaSaw[0]?.slack).toBeCloseTo(30, 9);
    const noNumber = lookups({});
    await priceScannedFood({ ...plate, fat_g: null }, noNumber.table);
    expect(noNumber.usdaSaw).toEqual([null]);
  });

  it("is the model's estimate where no table has the food, and nothing where it gave no number either", async () => {
    expect(await priceScannedFood(plate, lookups({}).table)).toEqual({ kind: "estimate", per100g: { kcal: 100, proteinG: 0, carbsG: 25, fatG: 0 }, grams: 200, overruled: null });
    expect(await priceScannedFood({ ...plate, kcal: null }, lookups({}).table)).toEqual({ kind: "none" });
  });

  it("gives a table food 3× from the model's energy way to the estimate, whichever table answered, never to the next table", async () => {
    // The model saw 100 kcal per 100 g; each table's food here is over 300.
    for (const [rung, food] of [["ourList", tableFood("ours far", 301)], ["usda", tableFood("usda far", 301, "usda")], ["packaged", tableFood("packaged far", 301, "openfoodfacts")]] as const) {
      const run = lookups(rung === "ourList" ? { ourList: food } : rung === "usda" ? { usda: food } : { packaged: food });
      expect(await priceScannedFood(plate, run.table), rung).toEqual({ kind: "estimate", per100g: { kcal: 100, proteinG: 0, carbsG: 25, fatG: 0 }, grams: 200, overruled: food });
      expect(run.asked.at(-1), rung).toBe(`${rung}:zqxdish`);
    }
    // Where the model gave no usable number, the table food stands however far off.
    const noNumber = { ...plate, protein_g: null };
    expect(await priceScannedFood(noNumber, lookups({ ourList: tableFood("ours far", 301) }).table)).toEqual({ kind: "table", food: tableFood("ours far", 301) });
  });

  it("never asks a table by a name that says there is none, and prices no item that has no name at all", async () => {
    // Every table answers anything here, as a live search answers almost any word.
    const answering = { ourList: ours, usda, packaged };
    for (const word of ["unknown", "N/A", " none ", "null", ""]) {
      // A real name over a hint that says there is none: the model's own figures, shown by that name.
      const named = lookups(answering);
      expect(await priceScannedFood({ ...plate, name: "Zqx fritter", canonical_hint: word }, named.table), JSON.stringify(word))
        .toEqual({ kind: "estimate", per100g: { kcal: 100, proteinG: 0, carbsG: 25, fatG: 0 }, grams: 200, overruled: null });
      expect(named.asked, JSON.stringify(word)).toEqual([]);
      // No name either: no food, whatever figures it carries, and nothing is asked.
      const nameless = lookups(answering);
      expect(await priceScannedFood({ ...plate, name: "Unknown", canonical_hint: word }, nameless.table), JSON.stringify(word)).toEqual({ kind: "none" });
      expect(nameless.asked, JSON.stringify(word)).toEqual([]);
    }
    // A name that says there is none over a real hint is still asked by the hint.
    const hinted = lookups(answering);
    expect(await priceScannedFood({ ...plate, name: "unknown", canonical_hint: "zqxdish" }, hinted.table)).toEqual({ kind: "table", food: ours });
    expect(hinted.asked).toEqual(["ourList:zqxdish"]);
  });
});

describe("an estimate row", () => {
  const figures = { kcal: 180, proteinG: 6, carbsG: 20, fatG: 8 };

  it("is its own food, served by the grams the model saw, under a canonical no table uses", () => {
    expect(ESTIMATE_CANONICAL_PREFIX).toBe("est_");
    expect(estimateFood("Avocado toast", figures, 120, new Set())).toEqual({
      canonical: "est_avocado_toast", name: "Avocado toast", ...figures, fiberG: null, serving: 120, unit: "g", source: "estimate",
    });
    // Accents fold as the food list folds a name; a name with no letters is still a food.
    expect(estimateFood("Crème brûlée", figures, 90, new Set()).canonical).toBe("est_creme_brulee");
    expect(estimateFood("???", figures, 90, new Set()).canonical).toBe("est_food");
    // A canonical is at most 120 characters where a meal's item is sent back.
    expect(estimateFood("a".repeat(300), figures, 90, new Set()).canonical).toHaveLength(104);
  });

  it("never shares a canonical with another food of the same scan", () => {
    const taken = new Set(["est_toast", "est_toast_2"]);
    expect(estimateFood("Toast", figures, 60, taken).canonical).toBe("est_toast_3");
    expect(estimateFood("toast!", figures, 60, new Set(["est_toast"])).canonical).toBe("est_toast_2");
  });
});

describe("the portion a priced food is served by on the photo sheet", () => {
  const evidence = (...items: VisionItem[]): VisionEvidence => ({ meal_name: "Zqx plate", items, unknown_items: [], photo_quality: "good" });
  // USDA's own row, as the loaded table holds it: served by the cup.
  const usdaPumpkin: FoodReference = { canonical: "usda_fndds_2709692", name: "Pumpkin, cooked", kcal: 52, proteinG: 1.05, carbsG: 6.77, fatG: 2.84, fiberG: 0.5, serving: 230, unit: "cup", source: "usda" };
  // Kd's plate "download (3)": 60 g of pumpkin in two pieces, at 30 kcal.
  const pumpkin: VisionItem = { ...seen({ grams: 60, kcal: 30, protein_g: 1, carbs_g: 7, fat_g: 0 }, "pumpkin"), vessel: "plate", fill_level: 0.2, count: 2 };

  it("is the grams the model saw for a USDA food, its count what the stepper steps by — never USDA's cup times the count", () => {
    const sheet = scanSheet(evidence(pumpkin), [{ kind: "table", food: usdaPumpkin }]);
    expect(sheet.items[0]).toMatchObject({ name: "Pumpkin, cooked", nutritionSource: "usda", gramsPoint: 60, gramsRange: [60, 60], portionSource: "default", pieces: 2, kcalPoint: 31 });
    expect(sheet.draftItems).toEqual([{ canonical: "usda_fndds_2709692", gramsPoint: 60, gramsRange: [60, 60], portionSource: "default" }]);
    // A vessel the model names does not change it: that rule is our list's, until 7a-iv-b.
    const inKatori = scanSheet(evidence({ ...pumpkin, vessel: "katori" }), [{ kind: "table", food: usdaPumpkin }]);
    expect(inKatori.items[0]).toMatchObject({ gramsPoint: 60, portionSource: "default", pieces: 2 });
  });

  it("is USDA's own serving once, uncounted, where the model gave no grams", () => {
    const sheet = scanSheet(evidence({ ...pumpkin, grams: null }), [{ kind: "table", food: usdaPumpkin }]);
    expect(sheet.items[0]).toMatchObject({ gramsPoint: 230, gramsRange: [230, 230], portionSource: "default", pieces: null, kcalPoint: 120 });
  });

  it("is the rule our list's foods and packaged products were scanned by before this card, until 7a-iv (Kd, 2026-09-16)", () => {
    // The same food served by the same cup, from our list: two pieces read as two cups.
    for (const source of ["curated", "openfoodfacts"] as const) {
      const food: FoodReference = { ...usdaPumpkin, canonical: `zqx_${source}`, name: `Zqx ${source}`, source };
      expect(scanSheet(evidence(pumpkin), [{ kind: "table", food }]).items[0], source).toMatchObject({ gramsPoint: 460, pieces: 2 });
    }
  });

  it("is the model's grams for an estimate, with its count", () => {
    const sheet = scanSheet(evidence({ ...pumpkin, canonical_hint: "zqxpumpkin" }), [{ kind: "estimate", per100g: { kcal: 50, proteinG: 1.7, carbsG: 11.7, fatG: 0 }, grams: 60, overruled: null }]);
    expect(sheet.items[0]).toMatchObject({ nutritionSource: "estimate", gramsPoint: 60, pieces: 2, kcalPoint: 30 });
  });

  it("reaches Appendix B's own container for every vessel Appendix B measures, and the food's serving for every other", () => {
    // A food of our list served by 100 g, at medium density, in each vessel full.
    const food: FoodReference = { canonical: "zqx_weighed", name: "Zqx weighed", kcal: 100, proteinG: 0, carbsG: 25, fatG: 0, fiberG: null, serving: 100, unit: "g", source: "curated" };
    const serving: [number, [number, number], string] = [100, [100, 100], "default"];
    const expected: Record<MealVessel, [number, [number, number], string]> = {
      katori: [175, [150, 200], "regional_prior"], // the standard katori, 150–200 ml
      "large bowl": [275, [250, 300], "regional_prior"],
      "thali section": [125, [100, 150], "regional_prior"], // grams, never ml × density
      tumbler: [175, [150, 200], "regional_prior"], // the steel tumbler
      "chai cup": [125, [100, 150], "regional_prior"],
      cup: [240, [240, 240], "regional_prior"],
      mug: [325, [300, 350], "regional_prior"],
      tablespoon: [15, [15, 15], "regional_prior"],
      teaspoon: [5, [5, 5], "regional_prior"],
      bowl: serving, glass: serving, can: serving, bottle: serving, pot: serving, plate: serving,
    };
    expect(Object.keys(expected).sort()).toEqual([...mealVesselSchema.options].sort());
    for (const vessel of mealVesselSchema.options) {
      const item: VisionItem = { ...seen({ grams: null }, "zqxweighed"), vessel, fill_level: 1 };
      const [row] = scanSheet(evidence(item), [{ kind: "table", food }]).items;
      expect([row?.gramsPoint, row?.gramsRange, row?.portionSource], vessel).toEqual(expected[vessel]);
    }
  });
});
