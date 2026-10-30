// ROADMAP Stage 5 33b-ii — a scanned food is titled by what the scanner saw, and the food its
// numbers are from is always its `name`, shown under the title; "Not this?" offers the close
// foods. Kd's eight plates (fixtures/luna-match-check.json) are Luna's real words; the rest are
// names the code has never heard of. The route runs in nutrition.scan.routes.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MEAL_CLOSE_FOODS_MOST, foodSearchItemSchema, mealPhotoItemSchema, mealVisionEvidenceSchema, type FoodMeasure, type FoodSearchItem, type VisionEvidence, type VisionItem } from "@app/shared";
import type { FoodReference } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import { estimateFood, offeredFoodsOf, seenNameOf, type ScanPrice } from "../src/modules/nutrition/scanMatch.js";
import { scanSheet } from "../src/modules/nutrition/service.js";

const food = (canonical: string, name: string, kcal: number, source: FoodReference["source"] = "usda"): FoodReference =>
  ({ canonical, name, kcal, proteinG: 1, carbsG: 1, fatG: 1, fiberG: null, serving: 100, unit: "g", source });
const seen = (name: string, hint: string): VisionItem =>
  ({ name, canonical_hint: hint, count: null, grams: 150, kcal: 300, protein_g: 20, carbs_g: 20, fat_g: 10 });
const GRAMS: FoodMeasure = { id: "g", name: "g", grams: 1 };
const measures = (): readonly FoodMeasure[] => [GRAMS];
const searchItem = (f: FoodReference): FoodSearchItem => ({
  canonical: f.canonical, name: f.name, kcal: f.kcal, proteinG: 1, carbsG: 1, fatG: 1, fiberG: null, serving: 100, unit: "g",
  source: f.source, measures: [GRAMS], startsAt: { measure: "g", amount: 100 }, startsKcal: f.kcal,
});

const fixture = z.object({
  plates: z.array(z.object({
    photo: z.string(),
    reply: z.unknown(),
    foods: z.array(z.object({ found: z.object({ canonical: z.string(), name: z.string(), kcal: z.number() }).nullable() })),
  })),
}).parse(JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "luna-match-check.json"), "utf8")));

describe("the worst thing: a food titled by what the photo saw, with another food's numbers, and nothing saying so", () => {
  it("on Kd's eight plates, every priced food's name is the food its numbers are from, and a different seen name is only ever the title above it", () => {
    let titled = 0;
    for (const plate of fixture.plates) {
      const evidence: VisionEvidence = mealVisionEvidenceSchema.parse(plate.reply);
      const prices: ScanPrice[] = evidence.items.map((_, at) => {
        const found = plate.foods[at]?.found ?? null;
        return found === null ? { kind: "none" } : { kind: "table", food: food(found.canonical, found.name, found.kcal) };
      });
      const sheet = scanSheet(evidence, prices, measures);
      let row = 0;
      for (const price of prices) {
        if (price.kind !== "table") continue;
        const item = mealPhotoItemSchema.parse(sheet.items[row++]);
        expect(item.name, plate.photo).toBe(price.food.name);
        expect(item.canonical, plate.photo).toBe(price.food.canonical);
        // The numbers are that food's, at the grams shown, whatever the title says.
        expect(Math.abs(item.kcalPoint - (price.food.kcal * item.gramsPoint) / 100), plate.photo).toBeLessThanOrEqual(1);
        if (item.seenAs !== undefined) {
          titled += 1;
          expect(item.seenAs.toLowerCase(), plate.photo).not.toBe(item.name.toLowerCase());
        }
      }
    }
    // Most of the eight plates' foods read as their food; some do not ("Roasted potato" over "Roast potatoes").
    expect(titled).toBeGreaterThan(0);
  });

  it("the cases of Kd's plates: what is titled, and what reads as its food", () => {
    const cases: [seenName: string, hint: string, foodName: string, title: string | undefined][] = [
      ["roasted potato", "roasted potato", "Roast potatoes", "Roasted potato"],
      ["chicken", "cooked chicken", "Chicken wing, NS as to cooking method", "Chicken"],
      ["iced coffee with milk", "iced coffee", "Iced Coffee, pre-lightened and pre-sweetened", "Iced coffee with milk"],
      ["leafy greens", "arugula", "Arugula", "Leafy greens"],
      ["avocado", "avocado", "Avocado", undefined],
      ["fried egg", "fried egg", "Egg (fried)", undefined],
      ["scrambled eggs", "scrambled eggs", "Eggs (scrambled)", undefined],
      ["bacon", "bacon", "Bacon (cooked)", "Bacon"],
    ];
    for (const [name, hint, foodName, title] of cases) {
      expect(seenNameOf(seen(name, hint), food("x", foodName, 100, "curated")), name).toBe(title);
    }
  });

  it("names the code has never heard of: Kd's taco, an Indian thali's foods, and a model's \"N/A\"", () => {
    expect(seenNameOf(seen("tacos with beef", "beef taco"), food("taco", "Taco", 220, "curated"))).toBe("Tacos with beef");
    expect(seenNameOf(seen("paneer butter masala", "paneer makhani"), food("p", "Paneer makhani", 240, "curated"))).toBe("Paneer butter masala");
    expect(seenNameOf(seen("jeera rice", "jeera rice"), food("j", "Jeera   Rice", 150, "curated"))).toBeUndefined();
    // No name of its own: titled by its hint, as the sheet already names it.
    expect(seenNameOf(seen("N/A", "dal tadka"), food("d", "Dal (lentil curry)", 120, "curated"))).toBe("Dal tadka");
    // An estimate is already named by what the photo saw.
    expect(seenNameOf(seen("kabocha squash", "kabocha squash"), estimateFood("kabocha squash", { kcal: 40, proteinG: 1, carbsG: 9, fatG: 0 }, 100, new Set()))).toBeUndefined();
  });
});

describe("\"Not this?\": the close foods a scanned food offers", () => {
  const around = [food("a", "Roast potatoes", 150, "curated"), food("b", "Potato (baked)", 93, "curated"), food("a", "Roast potatoes", 150, "curated"),
    food("c", "Potato, roasted", 140), food("d", "Potato, boiled", 87), food("e", "Potato chips", 536), food("f", "Hash brown", 265)];

  it("never offers the food it is now, each food once, at most five", () => {
    const offered = offeredFoodsOf("a", null, around);
    expect(offered.map((f) => f.canonical)).toEqual(["b", "c", "d", "e", "f"]);
    expect(offered.length).toBeLessThanOrEqual(MEAL_CLOSE_FOODS_MOST);
  });

  it("offers first the food the words found, where the check put another in its place", () => {
    expect(offeredFoodsOf("c", food("w", "Chicken wing", 290), around).map((f) => f.canonical)).toEqual(["w", "a", "b", "d", "e"]);
  });

  it("a food with nothing close offers nothing, and the search is still there", () => {
    expect(offeredFoodsOf("a", null, [])).toEqual([]);
  });

  it("the sheet carries each food's close foods, ready to pick as the search's are, never the food itself", () => {
    const evidence = mealVisionEvidenceSchema.parse({ meal_name: "Dinner", items: [["roasted potatoes", "roast potatoes", null, 200, 300, 4, 40, 12]], unknown_items: [], photo_quality: "good" });
    const close = [around[0], around[1], around[3]].flatMap((f) => (f === undefined ? [] : [searchItem(f)]));
    const sheet = scanSheet(evidence, [{ kind: "table", food: food("a", "Roast potatoes", 150, "curated") }], measures, () => close);
    const item = mealPhotoItemSchema.parse(sheet.items[0]);
    expect(item.closeFoods.map((f) => f.canonical)).toEqual(["b", "c"]);
    for (const f of item.closeFoods) foodSearchItemSchema.parse(f);
    expect(sheet.draftItems[0]?.seenAs).toBe("Roasted potatoes");
  });

  it("a scan kept on a phone from before this job, with no close foods, still reads", () => {
    const scanned = mealPhotoItemSchema.parse(scanSheet(
      mealVisionEvidenceSchema.parse({ meal_name: "M", items: [["apple", "apple", 1, 150, 78, 0, 20, 0]], unknown_items: [], photo_quality: "good" }),
      [{ kind: "table", food: food("apple", "Apple", 52, "curated") }], measures,
    ).items[0]);
    const before = Object.fromEntries(Object.entries(scanned).filter(([key]) => key !== "closeFoods"));
    expect(mealPhotoItemSchema.parse(before).closeFoods).toEqual([]);
  });
});
