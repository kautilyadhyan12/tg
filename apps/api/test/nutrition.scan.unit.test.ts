// ROADMAP 7a-iii-b — what each food a scan sees is priced by: the model's own
// estimate and when it is no number, the 3× wrong-food check, the energy a USDA
// entry must agree with, the order of the tables, and the estimate row; and
// ROADMAP 7a-iv-b — where each priced food's row starts. The plates run through
// the real lookups in nutrition.scan.routes.test.ts.
import { describe, expect, it } from "vitest";
import { mealPhotoItemSchema, per100gSchema, type FoodMeasure, type VisionEvidence, type VisionItem } from "@app/shared";
import type { FoodReference } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import {
  COOKING_WORDS,
  ENERGY_SLACK_KCAL,
  ENERGY_TOLERANCE,
  ESTIMATE_CANONICAL_PREFIX,
  KEPT_WORDS,
  MAX_ESTIMATE_KCAL_PER_100G,
  MAX_SHORTENED_NAME_WORDS,
  PREPARATION_WORDS,
  SHORTER_NAME_TIE_KCAL,
  WRONG_FOOD_MIN_GAP_KCAL,
  WRONG_FOOD_RATIO,
  agreesWithScan,
  contradicts,
  energySeen,
  estimateFood,
  estimatePer100g,
  isWrongFood,
  priceScannedFood,
  type EnergySeen,
  type ScanLookups,
  type ScanPrice,
} from "../src/modules/nutrition/scanMatch.js";
import { scanSheet } from "../src/modules/nutrition/service.js";

/** A scanned food, with the model's five figures as given. */
const seen = (figures: Partial<Pick<VisionItem, "grams" | "kcal" | "protein_g" | "carbs_g" | "fat_g">>, hint = "zqxfood"): VisionItem => ({
  name: hint, canonical_hint: hint, count: null,
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

interface Answers {
  ourList?: FoodReference;
  /** Our list's food, and its other versions, for each shorter name. */
  versions?: ReadonlyMap<string, readonly FoodReference[]>;
  usda?: FoodReference;
  /** Whether USDA's answer holds every word rather than being the food of that name. */
  usdaByEveryWord?: boolean;
  packaged?: FoodReference;
}

/** Lookups that answer from the given foods and say what was asked, in order, and with what energy. */
const lookups = (answers: Answers) => {
  const asked: string[] = [];
  const usdaSaw: (EnergySeen | null)[] = [];
  const table: ScanLookups = {
    ourList: (hint) => {
      asked.push(`ourList:${hint}`);
      return answers.ourList ?? null;
    },
    ourListVersions: (name) => {
      asked.push(`ourListVersions:${name}`);
      return answers.versions?.get(name) ?? [];
    },
    usda: (hint, energy) => {
      asked.push(`usda:${hint}`);
      usdaSaw.push(energy);
      return Promise.resolve(answers.usda === undefined ? null : { food: answers.usda, byEveryWord: answers.usdaByEveryWord ?? false });
    },
    packaged: (hint) => {
      asked.push(`packaged:${hint}`);
      return Promise.resolve(answers.packaged ?? null);
    },
  };
  return { asked, usdaSaw, table };
};

describe("the order a scanned food is priced in", () => {
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
    const far = (name: string, source: FoodReference["source"]) => tableFood(name, 301, source);
    const runs: [string, Answers, FoodReference][] = [
      ["ourList", { ourList: far("ours far", "curated") }, far("ours far", "curated")],
      ["usda", { usda: far("usda far", "usda") }, far("usda far", "usda")],
      ["usda", { usda: far("usda far", "usda"), usdaByEveryWord: true }, far("usda far", "usda")],
      ["packaged", { packaged: far("packaged far", "openfoodfacts") }, far("packaged far", "openfoodfacts")],
    ];
    for (const [rung, answers, food] of runs) {
      const run = lookups(answers);
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

describe("a name our list holds only shorter (ROADMAP 7a-iv-i, and the reviews of PR #80 and #81)", () => {
  // The model saw 200 g at 200 kcal: 100 kcal per 100 g, good to 60 kcal on the plate.
  const figures = { grams: 200, kcal: 200, protein_g: 0, carbs_g: 50, fat_g: 0 };
  const ESTIMATE = { kind: "estimate", per100g: { kcal: 100, proteinG: 0, carbsG: 25, fatG: 0 }, grams: 200 } as const;
  const food = (name: string, kcal = 100, source: FoodReference["source"] = "curated") => tableFood(name, kcal, source);
  const versions = (...entries: [string, FoodReference[]][]) => new Map(entries);
  interface Case {
    label: string;
    hint: string;
    answers: Answers;
    figures?: Partial<Pick<VisionItem, "grams" | "kcal" | "protein_g" | "carbs_g" | "fat_g">>;
    expected: ScanPrice;
    /** Everything asked, in order. */
    asked: string[];
  }
  const cases: Case[] = [
    {
      label: "our list's food of the name with the way it was cooked dropped, where the food carries what the model saw",
      hint: "steamed zqxfood",
      answers: { versions: versions(["zqxfood", [food("Zqxfood")]]) },
      expected: { kind: "table", food: food("Zqxfood") },
      // Never a packaged product: our list's food is found first.
      asked: ["ourList:steamed zqxfood", "usda:steamed zqxfood", "ourListVersions:zqxfood"],
    },
    {
      label: "the longest shorter name our list holds, which drops the fewest words",
      hint: "pan fried zqxsausage",
      answers: { versions: versions(["fried zqxsausage", [food("Zqxsausage (fried)")]], ["zqxsausage", [food("Zqxsausage")]]) },
      expected: { kind: "table", food: food("Zqxsausage (fried)") },
      asked: ["ourList:pan fried zqxsausage", "usda:pan fried zqxsausage", "ourListVersions:fried zqxsausage"],
    },
    {
      label: "two words of how it was cooked, dropped one at a time",
      hint: "pan fried zqxsausage",
      answers: { versions: versions(["zqxsausage", [food("Zqxsausage")]]) },
      expected: { kind: "table", food: food("Zqxsausage") },
      asked: ["ourList:pan fried zqxsausage", "usda:pan fried zqxsausage", "ourListVersions:fried zqxsausage", "ourListVersions:zqxsausage"],
    },
    {
      label: "no food, and no shorter name asked, where the first word can be what the food is (vegan butter is no butter)",
      hint: "vegan zqxbutter",
      answers: { versions: versions(["zqxbutter", [food("Zqxbutter")]]) },
      expected: { ...ESTIMATE, overruled: null },
      asked: ["ourList:vegan zqxbutter", "usda:vegan zqxbutter", "packaged:vegan zqxbutter"],
    },
    {
      label: "no food where such a word comes after a word of how it was cooked: never shortened past it",
      hint: "grilled vegan zqxburger",
      answers: { versions: versions(["zqxburger", [food("Zqxburger")]]) },
      expected: { ...ESTIMATE, overruled: null },
      asked: ["ourList:grilled vegan zqxburger", "usda:grilled vegan zqxburger", "ourListVersions:vegan zqxburger", "packaged:grilled vegan zqxburger"],
    },
    {
      label: "the shorter name that keeps such a word, where our list holds it",
      hint: "sliced smoked zqxham",
      answers: { versions: versions(["smoked zqxham", [food("Smoked zqxham")]], ["zqxham", [food("Zqxham")]]) },
      expected: { kind: "table", food: food("Smoked zqxham") },
      asked: ["ourList:sliced smoked zqxham", "usda:sliced smoked zqxham", "ourListVersions:smoked zqxham"],
    },
    {
      label: "no food where the longest shorter name's food is not what the model saw: never a still shorter name",
      hint: "pan fried zqxsausage",
      answers: { versions: versions(["fried zqxsausage", [food("Zqxsausage (fried)", 300)]], ["zqxsausage", [food("Zqxsausage")]]) },
      expected: { ...ESTIMATE, overruled: null },
      asked: ["ourList:pan fried zqxsausage", "usda:pan fried zqxsausage", "ourListVersions:fried zqxsausage", "packaged:pan fried zqxsausage"],
    },
    {
      label: "no food where the first version the words allow is not what the model saw: never another version for its calories",
      hint: "warm zqxmilk",
      answers: { versions: versions(["zqxmilk", [food("Zqxmilk (whole)", 300), food("Zqxmilk (skim)", 100)]]) },
      expected: { ...ESTIMATE, overruled: null },
      asked: ["ourList:warm zqxmilk", "usda:warm zqxmilk", "ourListVersions:zqxmilk", "packaged:warm zqxmilk"],
    },
    {
      label: "the first version the dropped words do not contradict (steamed carrots are the cooked ones)",
      hint: "steamed zqxcarrots",
      answers: { versions: versions(["zqxcarrots", [food("Zqxcarrots (raw)"), food("Zqxcarrots (cooked)")]]) },
      expected: { kind: "table", food: food("Zqxcarrots (cooked)") },
      asked: ["ourList:steamed zqxcarrots", "usda:steamed zqxcarrots", "ourListVersions:zqxcarrots"],
    },
    {
      label: "no food where every version contradicts them (steamed dumplings are no fried ones), and no shorter name",
      hint: "steamed zqxdumplings",
      answers: { versions: versions(["zqxdumplings", [food("Zqxdumplings (zqxpork, fried)")]]) },
      expected: { ...ESTIMATE, overruled: null },
      asked: ["ourList:steamed zqxdumplings", "usda:steamed zqxdumplings", "ourListVersions:zqxdumplings", "packaged:steamed zqxdumplings"],
    },
    {
      label: "no food, and nothing shortened or asked about, where the model gave no usable number",
      hint: "steamed zqxfood",
      answers: { versions: versions(["zqxfood", [food("Zqxfood")]]) },
      figures: { fat_g: null },
      expected: { kind: "none" },
      asked: ["ourList:steamed zqxfood", "usda:steamed zqxfood", "packaged:steamed zqxfood"],
    },
    {
      label: "our list's shorter name where the whole name's food is another food: no other table is asked the whole name",
      hint: "steamed zqxfood",
      answers: { ourList: food("Zqxfar", 301), versions: versions(["zqxfood", [food("Zqxfood")]]) },
      expected: { kind: "table", food: food("Zqxfood") },
      asked: ["ourList:steamed zqxfood", "ourListVersions:zqxfood"],
    },
    {
      label: "the estimate, naming the whole name's other food, where no shorter name has one either",
      hint: "steamed zqxfood",
      answers: { usda: food("Zqxfar", 301, "usda") },
      expected: { ...ESTIMATE, overruled: food("Zqxfar", 301, "usda") },
      asked: ["ourList:steamed zqxfood", "usda:steamed zqxfood", "ourListVersions:zqxfood"],
    },
    {
      label: "USDA's food of every word where ours of a shorter name is further than it from what the model saw",
      hint: "grilled zqxshrimp",
      answers: { usda: food("Zqxshrimp, grilled", 100, "usda"), usdaByEveryWord: true, versions: versions(["zqxshrimp", [food("Zqxshrimp (cooked)", 110.1)]]) },
      expected: { kind: "table", food: food("Zqxshrimp, grilled", 100, "usda") },
      asked: ["ourList:grilled zqxshrimp", "usda:grilled zqxshrimp", "ourListVersions:zqxshrimp"],
    },
    {
      label: "ours of a shorter name where USDA's food of every word is no more than 10 kcal per 100 g nearer",
      hint: "roasted zqxalmonds",
      answers: { usda: food("Zqxalmonds, honey roasted", 100, "usda"), usdaByEveryWord: true, versions: versions(["zqxalmonds", [food("Zqxalmonds", 110)]]) },
      expected: { kind: "table", food: food("Zqxalmonds", 110) },
      asked: ["ourList:roasted zqxalmonds", "usda:roasted zqxalmonds", "ourListVersions:zqxalmonds"],
    },
    {
      label: "ours of a shorter name where USDA's food of every word is the further one",
      hint: "roasted zqxalmonds",
      answers: { usda: food("Zqxalmonds, honey roasted", 80, "usda"), usdaByEveryWord: true, versions: versions(["zqxalmonds", [food("Zqxalmonds")]]) },
      expected: { kind: "table", food: food("Zqxalmonds") },
      asked: ["ourList:roasted zqxalmonds", "usda:roasted zqxalmonds", "ourListVersions:zqxalmonds"],
    },
    {
      label: "ours of a shorter name where USDA's food of every word is another food",
      hint: "roasted zqxalmonds",
      answers: { usda: food("Zqxalmonds, candied", 301, "usda"), usdaByEveryWord: true, versions: versions(["zqxalmonds", [food("Zqxalmonds")]]) },
      expected: { kind: "table", food: food("Zqxalmonds") },
      asked: ["ourList:roasted zqxalmonds", "usda:roasted zqxalmonds", "ourListVersions:zqxalmonds"],
    },
    {
      label: "USDA's food of every word where our list has no shorter name, as before",
      hint: "roasted zqxalmonds",
      answers: { usda: food("Zqxalmonds, honey roasted", 80, "usda"), usdaByEveryWord: true },
      expected: { kind: "table", food: food("Zqxalmonds, honey roasted", 80, "usda") },
      asked: ["ourList:roasted zqxalmonds", "usda:roasted zqxalmonds", "ourListVersions:zqxalmonds"],
    },
    {
      label: "the estimate, naming USDA's other food, where USDA's food of every word is another food and our list has none",
      hint: "roasted zqxalmonds",
      answers: { usda: food("Zqxalmonds, candied", 301, "usda"), usdaByEveryWord: true },
      expected: { ...ESTIMATE, overruled: food("Zqxalmonds, candied", 301, "usda") },
      asked: ["ourList:roasted zqxalmonds", "usda:roasted zqxalmonds", "ourListVersions:zqxalmonds"],
    },
    {
      label: "USDA's food of every word, never ours, where a word of the name can be what the food is, even at the model's own calories (vegetable lasagna is no meat lasagna)",
      hint: "vegetable zqxlasagna",
      answers: { usda: food("Zqxlasagna, vegetable", 130, "usda"), usdaByEveryWord: true, versions: versions(["zqxlasagna", [food("Zqxlasagna (meat)")]]) },
      expected: { kind: "table", food: food("Zqxlasagna, vegetable", 130, "usda") },
      asked: ["ourList:vegetable zqxlasagna", "usda:vegetable zqxlasagna"],
    },
    {
      label: "a name of ten words, shortened",
      hint: "the some a an of with small hot iced zqxfood",
      answers: { versions: versions(["zqxfood", [food("Zqxfood")]]) },
      expected: { kind: "table", food: food("Zqxfood") },
      asked: [
        "ourList:the some a an of with small hot iced zqxfood", "usda:the some a an of with small hot iced zqxfood",
        "ourListVersions:some a an of with small hot iced zqxfood", "ourListVersions:a an of with small hot iced zqxfood",
        "ourListVersions:an of with small hot iced zqxfood", "ourListVersions:of with small hot iced zqxfood", "ourListVersions:with small hot iced zqxfood",
        "ourListVersions:small hot iced zqxfood", "ourListVersions:hot iced zqxfood", "ourListVersions:iced zqxfood", "ourListVersions:zqxfood",
      ],
    },
    {
      label: "a name of eleven words, never shortened",
      hint: "the some a an of with small hot iced warm zqxfood",
      answers: { versions: versions(["zqxfood", [food("Zqxfood")]]) },
      expected: { ...ESTIMATE, overruled: null },
      asked: ["ourList:the some a an of with small hot iced warm zqxfood", "usda:the some a an of with small hot iced warm zqxfood", "packaged:the some a an of with small hot iced warm zqxfood"],
    },
    {
      label: "a name's words as the food list reads them: accents folded, lower case, anything else a space",
      hint: "Pan-Sautéed  ZQXFOOD!",
      answers: { versions: versions(["zqxfood", [food("Zqxfood")]]) },
      expected: { kind: "table", food: food("Zqxfood") },
      asked: ["ourList:Pan-Sautéed  ZQXFOOD!", "usda:Pan-Sautéed  ZQXFOOD!", "ourListVersions:sauteed zqxfood", "ourListVersions:zqxfood"],
    },
  ];

  for (const c of cases) {
    it(`is ${c.label}`, async () => {
      const run = lookups(c.answers);
      expect(await priceScannedFood(seen({ ...figures, ...c.figures }, c.hint), run.table)).toEqual(c.expected);
      expect(run.asked).toEqual(c.asked);
    });
  }

  it("is shortened past every word that says only how a food was cooked, cut or served", async () => {
    for (const word of PREPARATION_WORDS) {
      const run = lookups({ versions: versions(["zqxfood", [food("Zqxfood")]]) });
      expect(await priceScannedFood(seen(figures, `${word} zqxfood`), run.table), word).toEqual({ kind: "table", food: food("Zqxfood") });
    }
    // LanguaL's four ways of cooking, and the ways a food is kept.
    expect(new Set(COOKING_WORDS.values())).toEqual(new Set(["dry heat", "moist heat", "with fat", "microwave"]));
    expect(KEPT_WORDS).toEqual(new Set(["canned", "pickled", "smoked", "dried", "cured"]));
  });

  it("is never shortened past a word that can say what the food is, what was taken out or put in, its kind, its brand or who it is for, whatever the calories", async () => {
    // Every such word of both reviews' names and this card's probes, at the calories of
    // the food the shorter name would read as: a substitute is made to match them.
    const words = [
      "vegan", "veg", "veggie", "vegetarian", "vegetable", "plant", "based", "meatless", "soy", "dairy", "free", "lactose", "gluten",
      "eggless", "decaf", "skim", "light", "diet", "breakfast", "margherita", "hawaiian", "masala", "jeera", "matcha", "brown", "sharp",
      "roma", "cherry", "frozen", "smoked", "pickled", "canned", "dried", "cured", "deli", "sweet", "plain", "soft", "pulled", "minced",
      "chicken", "lemon", "coconut", "quorn", "honey", "crispy",
    ];
    for (const word of words) {
      const run = lookups({ versions: versions(["zqxfood", [food("Zqxfood")]]) });
      expect(await priceScannedFood(seen(figures, `${word} zqxfood`), run.table), word).toEqual({ ...ESTIMATE, overruled: null });
      expect(run.asked, word).toEqual([`ourList:${word} zqxfood`, `usda:${word} zqxfood`, `packaged:${word} zqxfood`]);
    }
  });

  it.each<[string, string, boolean]>([
    // Cooked, by any way or plainly, against raw or kept.
    ["steamed", "Zqxcarrots (raw)", true],
    ["cooked", "Zqxcarrots (raw)", true],
    ...[...KEPT_WORDS].map((kept): [string, string, boolean] => ["boiled", `Zqxfood (${kept})`, true]),
    ["grilled", "Zqxtuna (canned in water)", true],
    // Raw against cooked, by any way or plainly, or kept.
    ["raw", "Zqxbroccoli (cooked)", true],
    ["raw", "Zqxdumplings (zqxpork, fried)", true],
    ["raw", "Zqxtuna (canned in water)", true],
    ["raw", "Zqxcarrots (raw)", false],
    // Fresh against kept only.
    ["fresh", "Zqxtuna (canned in water)", true],
    ["fresh", "Zqxbroccoli (cooked)", false],
    ["fresh", "Zqxcarrots (raw)", false],
    // A way of cooking against one of another of LanguaL's groups, and never against one of its own or a plain "cooked".
    ["steamed", "Zqxdumplings (zqxpork, fried)", true],
    ["boiled", "Zqxpotato (baked)", true],
    ["microwaved", "Zqxpotato (boiled)", true],
    ["roasted", "Zqxpotato (baked)", false],
    ["grilled", "Zqxpotato (baked)", false],
    ["steamed", "Zqxpotato (boiled)", false],
    ["sauteed", "Zqxegg (fried)", false],
    ["grilled", "Zqxbroccoli (cooked)", false],
    ["cooked", "Zqxpotato (baked)", false],
    ["pan fried", "Zqxfood (boiled)", true],
    // Where the food's name says it outside its brackets too.
    ["steamed", "Fried zqxfish (coated)", true],
    ["baked", "Roast zqxpotatoes", false],
    ["fried", "Zqxidli (steamed rice cake)", true],
    ["boiled", "Zqxegg (hard-boiled)", false],
    // How it is cut, sized or served contradicts nothing.
    ["mashed", "Zqxcarrots (raw)", false],
    ["iced", "Zqxtuna (canned in water)", false],
    ["hot", "Zqxdumplings (zqxpork, fried)", false],
    ["baby", "Zqxspinach (raw)", false],
    ["steamed", "Zqxfood", false],
  ])("contradicts: %s against %s is %s", (dropped, name, expected) => {
    expect(contradicts(dropped.split(" "), name)).toBe(expected);
  });

  it("holds the shorter name's food to the model's own error on the plate, 30 % or 10 kcal, not to three times", async () => {
    expect([MAX_SHORTENED_NAME_WORDS, SHORTER_NAME_TIE_KCAL]).toEqual([10, 10]);
    const priced = async (kcalPer100g: number, plateFigures: Partial<typeof figures> = figures): Promise<ScanPrice> =>
      priceScannedFood(seen({ ...figures, ...plateFigures }, "steamed zqxfood"), lookups({ versions: versions(["zqxfood", [food("zqxfood", kcalPer100g)]]) }).table);
    // 200 kcal the model saw in 200 g: 140 to 260 on the plate, 70 to 130 per 100 g.
    const cases: [number, boolean][] = [[130, true], [130.1, false], [70, true], [69.9, false], [100, true]];
    for (const [kcal, taken] of cases) expect((await priced(kcal)).kind, String(kcal)).toBe(taken ? "table" : "estimate");
    // Each of those refused is well within three times: the rule is the tighter one.
    expect(isWrongFood(130.1, { kcal: 100, proteinG: 0, carbsG: 0, fatG: 0 }) || isWrongFood(69.9, { kcal: 100, proteinG: 0, carbsG: 0, fatG: 0 })).toBe(false);
    // 20 kcal in 20 g: 30 % is 6, so the 10 kcal holds — 10 to 30 on the plate, 50 to 150 per 100 g.
    const small = { grams: 20, kcal: 20, carbs_g: 5 };
    for (const [kcal, taken] of [[150, true], [150.1, false], [50, true], [49.9, false]] as const) {
      expect((await priced(kcal, small)).kind, `small ${String(kcal)}`).toBe(taken ? "table" : "estimate");
    }
    expect(agreesWithScan(130, 200, 200)).toBe(true);
    expect(agreesWithScan(130.1, 200, 200)).toBe(false);
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

describe("where each priced food's row starts on the photo sheet (ROADMAP 7a-iv-b)", () => {
  const evidence = (...items: VisionItem[]): VisionEvidence => ({ meal_name: "Zqx plate", items, unknown_items: [], photo_quality: "good" });
  // USDA's own row, as the loaded table holds it: served by the cup, and a piece of it weighs 30 g.
  const usdaPumpkin: FoodReference = { canonical: "usda_fndds_2709692", name: "Pumpkin, cooked", kcal: 52, proteinG: 1.05, carbsG: 6.77, fatG: 2.84, fiberG: 0.5, serving: 230, unit: "cup", source: "usda" };
  const CUP: FoodMeasure = { id: "usda-1", name: "cup", grams: 230 };
  const PIECE: FoodMeasure = { id: "usda-2", name: "piece", grams: 30 };
  const GRAMS: FoodMeasure = { id: "g", name: "g", grams: 1 };
  const OUNCES: FoodMeasure = { id: "oz", name: "oz", grams: 28.349523125 };
  /** Every food's measures, as the service would read them: the pumpkin's USDA
   *  cup and piece, grams and ounces. */
  const pumpkinMeasures = (): readonly FoodMeasure[] => [CUP, PIECE, GRAMS, OUNCES];
  // Kd's plate "download (3)": 60 g of pumpkin in two pieces, at 30 kcal.
  const pumpkin: VisionItem = { ...seen({ grams: 60, kcal: 30, protein_g: 1, carbs_g: 7, fat_g: 0 }, "pumpkin"), count: 2 };
  const table = (food: FoodReference): ScanPrice => ({ kind: "table", food });

  it("is the photo's count of one of the food's measures where that weighs near the grams it saw", () => {
    const sheet = scanSheet(evidence(pumpkin), [table(usdaPumpkin)], pumpkinMeasures);
    expect(sheet.items[0]).toMatchObject({
      name: "Pumpkin, cooked", nutritionSource: "usda", gramsPoint: 60, gramsRange: [60, 60], portionSource: "default", kcalPoint: 31,
      measures: [CUP, PIECE, GRAMS, OUNCES], startsAt: { measure: "usda-2", amount: 2 }, portionEstimated: false,
    });
    expect(sheet.draftItems).toEqual([{ canonical: "usda_fndds_2709692", gramsPoint: 60, gramsRange: [60, 60], portionSource: "default" }]);
    // Every row crosses the contract the web reads.
    for (const row of sheet.items) expect(mealPhotoItemSchema.safeParse(row).success).toBe(true);
  });

  it("is the photo's own grams, an estimate, where no count of a measure comes near them", () => {
    // Three pieces are 90 g, 50 % past the 60 g the photo saw.
    for (const item of [{ ...pumpkin, count: 3 }, { ...pumpkin, count: null }]) {
      const sheet = scanSheet(evidence(item), [table(usdaPumpkin)], pumpkinMeasures);
      expect(sheet.items[0], String(item.count)).toMatchObject({ gramsPoint: 60, startsAt: { measure: "g", amount: 60 }, portionEstimated: true, kcalPoint: 31 });
    }
  });

  it("is the same rule for every table's food: our list's and a packaged product's too, never the rule they had", () => {
    for (const source of ["curated", "openfoodfacts"] as const) {
      const food: FoodReference = { ...usdaPumpkin, canonical: `zqx_${source}`, name: `Zqx ${source}`, source };
      expect(scanSheet(evidence(pumpkin), [table(food)], pumpkinMeasures).items[0], source).toMatchObject({ gramsPoint: 60, startsAt: { measure: "usda-2", amount: 2 }, portionEstimated: false });
    }
  });

  it("is where Add food starts the food, an estimate, where the model gave no grams", () => {
    const sheet = scanSheet(evidence({ ...pumpkin, grams: null }), [table(usdaPumpkin)], pumpkinMeasures);
    expect(sheet.items[0]).toMatchObject({ gramsPoint: 230, startsAt: { measure: "usda-1", amount: 1 }, portionEstimated: true, kcalPoint: 120 });
  });

  it("is the model's grams for an estimate, which has only grams and ounces to be measured by", () => {
    const asked: FoodReference[] = [];
    const sheet = scanSheet(
      evidence({ ...pumpkin, canonical_hint: "zqxpumpkin", count: 1 }),
      [{ kind: "estimate", per100g: { kcal: 50, proteinG: 1.7, carbsG: 11.7, fatG: 0 }, grams: 60, overruled: null }],
      (food) => { asked.push(food); return [GRAMS, OUNCES]; },
    );
    expect(sheet.items[0]).toMatchObject({ nutritionSource: "estimate", gramsPoint: 60, measures: [GRAMS, OUNCES], startsAt: { measure: "g", amount: 60 }, portionEstimated: true, kcalPoint: 30 });
    expect(asked.map((food) => food.canonical)).toEqual(["est_pumpkin"]);
  });
});
