// ROADMAP 7a-iii-b — what each food a scan sees is priced by: the model's own
// estimate and when it is no number, the 3× wrong-food check, the order of the
// tables, the estimate row, and Kd's eight plates run through the photo sheet, so
// a change in any of those rules shows here as a diff.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mealVisionEvidenceSchema, type VisionItem } from "@app/shared";
import { findCurated } from "../src/modules/nutrition/foods.js";
import type { FoodReference } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import {
  ENERGY_SLACK_KCAL,
  ENERGY_TOLERANCE,
  ESTIMATE_CANONICAL_PREFIX,
  MAX_ESTIMATE_KCAL_PER_100G,
  WRONG_FOOD_MIN_GAP_KCAL,
  WRONG_FOOD_RATIO,
  estimateFood,
  estimatePer100g,
  isWrongFood,
  priceScannedFood,
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

  it("is no number past the energy food carries, or with a macro heavier than the food", () => {
    expect(MAX_ESTIMATE_KCAL_PER_100G).toBe(900);
    // 10 g of pure fat is 90 kcal: 900 per 100 g, the most there is.
    expect(estimatePer100g(seen({ grams: 10, kcal: 90, protein_g: 0, carbs_g: 0, fat_g: 10 }))).toEqual({ kcal: 900, proteinG: 0, carbsG: 0, fatG: 100 });
    // 91 kcal from the same 10 g of fat: the macros still make it within rounding,
    // and no macro outweighs the food, so the 900 is the only rule that refuses it.
    expect(estimatePer100g(seen({ grams: 10, kcal: 91, protein_g: 0, carbs_g: 0, fat_g: 10 }))).toBeNull();
    for (const macro of ["protein_g", "carbs_g"] as const) {
      expect(estimatePer100g(seen({ grams: 10, kcal: 44, protein_g: 0, carbs_g: 0, fat_g: 0, [macro]: 11 })), macro).toBeNull();
      expect(estimatePer100g(seen({ grams: 10, kcal: 40, protein_g: 0, carbs_g: 0, fat_g: 0, [macro]: 10 })), macro).not.toBeNull();
    }
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

describe("the order a scanned food is priced in", () => {
  /** Lookups that answer from the given foods and say which were asked. */
  const lookups = (answers: { ourList?: FoodReference; usda?: FoodReference; packaged?: FoodReference }) => {
    const asked: string[] = [];
    const ask = (rung: keyof typeof answers) => (hint: string): FoodReference | null => {
      asked.push(`${rung}:${hint}`);
      return answers[rung] ?? null;
    };
    const table: ScanLookups = {
      ourList: ask("ourList"),
      usda: (hint) => Promise.resolve(ask("usda")(hint)),
      packaged: (hint) => Promise.resolve(ask("packaged")(hint)),
    };
    return { asked, table };
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

// ── Kd's eight plates (2026-09-16) ───────────────────────────────────────────
// The model's replies to his eight photos, as it wrote them on 2026-09-16 with
// this card's prompt (the text only; no photo is in the repository). Each goes
// through the reply's schema and the photo sheet with our list as it is, no
// packaged products, and the three USDA foods the loaded table gave these plates'
// unlisted foods that day (`usdaFoodForScan`, figures copied from FoodData
// Central): so a rule that changes what a plate shows changes this test.
const PLATES = join(import.meta.dirname, "fixtures", "plates");

const USDA_THAT_DAY: ReadonlyMap<string, FoodReference> = new Map([
  ["pumpkin", { canonical: "usda_fndds_2709692", name: "Pumpkin, cooked", kcal: 52, proteinG: 1.05, carbsG: 6.77, fatG: 2.84, fiberG: 0.5, serving: 230, unit: "cup", source: "usda" }],
  ["lemon", { canonical: "usda_fndds_2709168", name: "Lemon, raw", kcal: 29, proteinG: 1.1, carbsG: 9.32, fatG: 0.3, fiberG: 2.8, serving: 65, unit: "fruit", source: "usda" }],
  ["iced coffee", { canonical: "usda_fndds_2710428", name: "Iced Coffee, brewed", kcal: 1, proteinG: 0.09, carbsG: 0, fatG: 0.02, fiberG: 0, serving: 30, unit: "fl oz", source: "usda" }],
]);

const plateLookups: ScanLookups = {
  ourList: (hint) => {
    const food = findCurated(hint);
    return food === null ? null : { canonical: food.canonical, name: food.name, kcal: food.kcal, proteinG: food.proteinG, carbsG: food.carbsG, fatG: food.fatG, fiberG: food.fiberG, serving: food.serving, unit: food.unit, source: "curated" };
  },
  usda: (hint) => Promise.resolve(USDA_THAT_DAY.get(hint) ?? null),
  packaged: () => Promise.resolve(null),
};

/** Each row as the sheet shows it: name, tag, grams, kcal, the stepper's pieces. */
type Row = [string, string, number, number, number | null];

const EXPECTED: Record<string, { rows: Row[]; unknown: string[] }> = {
  // The toast plate: every food is on the sheet, and the latte, which no table
  // names, is the model's own figures.
  "download-1.json": { rows: [
    ["French bread / sourdough", "curated", 100, 272, 2], ["Avocado", "curated", 100, 160, null], ["Egg (fried)", "curated", 50, 98, 1],
    ["Bacon (cooked)", "curated", 100, 548, null], ["Brie", "curated", 28, 94, null], ["Ham (sliced)", "curated", 28, 46, 1],
    ["Apple", "curated", 180, 94, 1], ["Almonds", "curated", 28, 162, null], ["latte", "estimate", 240, 130, 1],
  ], unknown: [] },
  // USDA's brewed iced coffee is 1 kcal per 100 g and the model saw 40: another food.
  "download-2.json": { rows: [
    ["avocado toast with egg", "estimate", 220, 380, 1], ["Asparagus (cooked)", "curated", 100, 22, null], ["cherry tomatoes", "estimate", 60, 11, 6],
    ["Pork sausage (cooked)", "curated", 46, 150, 2], ["Shrimp (cooked)", "curated", 100, 99, null], ["iced coffee", "estimate", 200, 80, 1],
  ], unknown: [] },
  "download-3.json": { rows: [
    ["Chicken breast (cooked)", "curated", 100, 165, null], ["Shrimp (cooked)", "curated", 100, 99, null], ["Egg (whole, large)", "curated", 50, 72, 1],
    ["Broccoli (cooked)", "curated", 100, 35, null], ["Corn (cooked)", "curated", 100, 96, null], ["Pumpkin, cooked", "usda", 460, 239, 2],
    ["Orange juice", "curated", 240, 108, 1],
  ], unknown: [] },
  "download-4.json": { rows: [
    ["Salmon (cooked)", "curated", 100, 206, null], ["Roast potatoes", "curated", 100, 126, null], ["Broccoli (cooked)", "curated", 100, 35, null],
    ["Lemon, raw", "usda", 65, 19, null],
  ], unknown: [] },
  "download-5.json": { rows: [
    ["avocado toast", "estimate", 120, 280, 1], ["Eggs (scrambled)", "curated", 50, 75, 1], ["Strawberries", "curated", 100, 32, null],
  ], unknown: [] },
  "download-6.json": { rows: [
    ["bread", "estimate", 60, 160, 2], ["Peanut butter", "curated", 32, 191, null], ["Jam", "curated", 20, 56, null],
    ["Avocado", "curated", 100, 160, null], ["Eggs (scrambled)", "curated", 50, 75, 1], ["Blueberries", "curated", 100, 57, null],
    ["Raspberries", "curated", 100, 52, null],
  ], unknown: [] },
  "download.json": { rows: [
    ["banana toast", "estimate", 220, 450, 1], ["egg bacon toast", "estimate", 250, 420, 1], ["iced coffee", "estimate", 250, 110, 1],
  ], unknown: [] },
  "minimalist-meal-planner-inspiration-idea-120.json": { rows: [
    ["Egg (hard-boiled)", "curated", 150, 233, 3], ["Roast potatoes", "curated", 100, 126, null], ["Chicken breast (cooked)", "curated", 100, 165, null],
    ["Corn (cooked)", "curated", 100, 96, null], ["Broccoli (cooked)", "curated", 100, 35, null],
  ], unknown: [] },
};

describe("Kd's eight plates through the photo sheet", () => {
  const files = readdirSync(PLATES).filter((name) => name.endsWith(".json")).sort();

  it("are all here, each a reply the schema reads", () => {
    expect(files).toEqual(Object.keys(EXPECTED).sort());
    for (const file of files) expect(mealVisionEvidenceSchema.safeParse(JSON.parse(readFileSync(join(PLATES, file), "utf8"))).success, file).toBe(true);
  });

  for (const [file, expected] of Object.entries(EXPECTED)) {
    it(`${file}: every food the model saw is on the sheet or named, as pinned`, async () => {
      const evidence = mealVisionEvidenceSchema.parse(JSON.parse(readFileSync(join(PLATES, file), "utf8")));
      const prices = await Promise.all(evidence.items.map((item) => priceScannedFood(item, plateLookups)));
      const sheet = scanSheet(evidence, prices, []);
      expect(sheet.items.map((i): Row => [i.name, i.nutritionSource, i.gramsPoint, i.kcalPoint, i.pieces])).toEqual(expected.rows);
      expect(sheet.unknownItems).toEqual(expected.unknown);
      // Nothing is dropped: every item is a row or named under "Not in the total".
      expect(sheet.items.length + sheet.unknownItems.length).toBe(evidence.items.length + evidence.unknown_items.length);
      // The draft holds exactly the foods and portions the sheet shows, in order.
      expect(sheet.draftItems.map((d) => [d.canonical, d.gramsPoint])).toEqual(sheet.items.map((i) => [i.canonical, i.gramsPoint]));
      expect(sheet.foods.map((f) => f.canonical)).toEqual(sheet.items.map((i) => i.canonical));
      // An estimate row carries its figures, and at the model's grams its kcal is the model's own.
      for (const [at, row] of sheet.items.entries()) {
        const seenItem = evidence.items.filter((_, i) => prices[i]?.kind !== "none")[at];
        if (row.nutritionSource === "estimate") {
          expect(row.canonical.startsWith("est_"), row.name).toBe(true);
          expect(row.per100g, row.name).toBeDefined();
          expect(row.kcalPoint, row.name).toBe(seenItem?.kcal);
        } else {
          expect(row.per100g, row.name).toBeUndefined();
        }
      }
    });
  }
});
