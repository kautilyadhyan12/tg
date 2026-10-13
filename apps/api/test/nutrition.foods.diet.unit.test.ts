// A food's diet against what USDA itself says the food is (ROADMAP 34c-i). The
// worst a label can do is offer meat, fish, egg or milk to somebody who does not
// eat it, so no label is checked against our own names: fixtures/
// usda-sr-food-groups.json holds USDA's description and food group of every SR
// Legacy entry the list cites, and `tools/check-food-sources.ts` holds that file
// to the download.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DIET_LADDER, type Diet } from "@app/shared";
import { CURATED_FOODS, type CuratedFood } from "../src/modules/nutrition/foods.js";

const groupsSchema = z.object({ foods: z.record(z.string().regex(/^\d+$/), z.tuple([z.string().min(1), z.string().min(1)])) });
const USDA = groupsSchema.parse(JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "usda-sr-food-groups.json"), "utf8"))).foods;

/** USDA's food groups that hold only meat, poultry, fish or shellfish. */
const MEAT_AND_FISH_GROUPS = new Set([
  "Poultry Products", "Sausages and Luncheon Meats", "Pork Products", "Beef Products",
  "Finfish and Shellfish Products", "Lamb, Veal, and Game Products",
]);

/** The words of USDA's description, lower case. */
const wordsOf = (description: string): string[] => description.toLowerCase().split(/[^a-z]+/).filter((w) => w !== "");

/** A word of a description that is meat, fish or shellfish in any food group: USDA
 *  files a beef jerky under Snacks, a pepperoni pizza under Fast Foods and a
 *  dressing with anchovy under Fats and Oils. */
const MEAT_AND_FISH_WORDS = new Set([
  "beef", "pork", "chicken", "turkey", "lamb", "veal", "bacon", "ham", "sausage", "pepperoni", "salami", "meat", "meatballs",
  "fish", "anchovy", "anchovies", "tuna", "salmon", "shrimp", "clam", "clams", "oyster", "crab", "lard", "tallow", "gelatin",
  "frankfurter", "hamburger", "cheeseburger",
]);
const EGG_WORDS = new Set(["egg", "eggs", "mayonnaise"]);
const DAIRY_WORDS = new Set(["milk", "cheese", "butter", "cream", "yogurt", "whey", "casein", "buttermilk", "ghee"]);

/** The lowest diet USDA's own words allow the food, or null where they name no
 *  animal food. The food group decides first; the description's words are for the
 *  groups that mix foods. */
function lowestDiet(description: string, group: string): Diet | null {
  const words = wordsOf(description);
  if (MEAT_AND_FISH_GROUPS.has(group) || words.some((w) => MEAT_AND_FISH_WORDS.has(w))) return "non_vegetarian";
  if (words.some((w) => EGG_WORDS.has(w))) return "vegetarian_eggs";
  if (group === "Dairy and Egg Products" || words.some((w) => DAIRY_WORDS.has(w)) || words[0] === "honey") return "vegetarian";
  return null;
}

/** Entries whose description holds one of those words and no animal food, each
 *  with the reason. Nothing else is excused. */
const NO_ANIMAL_FOOD: ReadonlyMap<string, string> = new Map([
  ["172796", "a roll FOR a hamburger or hot dog, plain"],
  ["170173", "coconut milk, pressed from the coconut's white, which USDA calls its meat"],
  ["174266", "peanut butter is ground peanuts"],
  ["168588", "almond butter is ground almonds"],
  ["170189", "sesame butter is ground sesame seeds"],
  ["174832", "almond milk is almonds and water"],
]);

const srId = (food: CuratedFood): string | null => /^usda-sr:(\d+)$/.exec(food.citation)?.[1] ?? null;

describe("a food's diet, against USDA's own description and food group", () => {
  it("is never lower than the animal food USDA says it is or holds", () => {
    const wrong: string[] = [];
    for (const food of CURATED_FOODS) {
      const id = srId(food);
      if (id === null || NO_ANIMAL_FOOD.has(id)) continue;
      const [description, group] = USDA[id] ?? ["", ""];
      const lowest = lowestDiet(description, group);
      if (lowest !== null && DIET_LADDER[food.diet] < DIET_LADDER[lowest]) wrong.push(`${food.name} is ${food.diet}; USDA: "${description}" (${group}) is ${lowest} at the lowest`);
    }
    expect(wrong).toEqual([]);
  });

  it("has USDA's description and food group for every SR Legacy entry the list cites, and for no other", () => {
    const cited = CURATED_FOODS.map(srId).filter((id): id is string => id !== null);
    expect(Object.keys(USDA).sort()).toEqual([...cited].sort());
  });
});
