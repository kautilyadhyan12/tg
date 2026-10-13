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

/** The words of USDA's description, lower case, each without its plural ending
 *  ("Ice creams" is cream, "Anchovies" anchovy, "Sandwiches" sandwich). */
const singular = (w: string): string => (w.endsWith("ies") && w.length > 4 ? `${w.slice(0, -3)}y` : w.endsWith("ches") || w.endsWith("shes") ? w.slice(0, -2) : w.endsWith("s") && !w.endsWith("ss") && w.length > 3 ? w.slice(0, -1) : w);
const wordsOf = (description: string): string[] => description.toLowerCase().split(/[^a-z]+/).filter((w) => w !== "").map(singular);

/** A word of a description that is meat, fish or shellfish in any food group: USDA
 *  files a beef jerky under Snacks, a pepperoni pizza under Fast Foods and a
 *  dressing with anchovy under Fats and Oils. */
const MEAT_AND_FISH_WORDS = new Set([
  "beef", "pork", "chicken", "turkey", "lamb", "veal", "bacon", "ham", "sausage", "pepperoni", "salami", "meat", "meatball",
  "fish", "anchovy", "tuna", "salmon", "shrimp", "clam", "oyster", "crab", "lard", "tallow", "gelatin",
  "frankfurter", "hamburger", "cheeseburger",
]);
const EGG_WORDS = new Set(["egg", "mayonnaise"]);
const DAIRY_WORDS = new Set(["milk", "cheese", "cheesecake", "butter", "cream", "yogurt", "whey", "casein", "buttermilk", "ghee"]);

/** The lowest diet USDA's own words allow the food, or null where they name no
 *  animal food. The food group decides first; the description's words are for the
 *  groups that mix foods. */
function lowestDiet(description: string, group: string, excused: readonly string[] = []): Diet | null {
  const words = wordsOf(description).filter((w) => !excused.includes(w));
  if (MEAT_AND_FISH_GROUPS.has(group) || words.some((w) => MEAT_AND_FISH_WORDS.has(w))) return "non_vegetarian";
  if (words.some((w) => EGG_WORDS.has(w))) return "vegetarian_eggs";
  if (group === "Dairy and Egg Products" || words.some((w) => DAIRY_WORDS.has(w)) || words[0] === "honey") return "vegetarian";
  return null;
}

/** The words of one entry's description that name no animal food there, with the
 *  reason. Only those words are excused: the rest of the description is still read. */
const NO_ANIMAL_FOOD: ReadonlyMap<string, readonly [words: readonly string[], why: string]> = new Map<string, readonly [readonly string[], string]>([
  ["172796", [["hamburger"], "a roll FOR a hamburger or hot dog, plain"]],
  ["170173", [["milk", "meat"], "coconut milk, pressed from the coconut's white, which USDA calls its meat"]],
  ["174266", [["butter"], "peanut butter is ground peanuts"]],
  ["168588", [["butter"], "almond butter is ground almonds"]],
  ["170189", [["butter"], "sesame butter is ground sesame seeds"]],
  ["174832", [["milk"], "almond milk is almonds and water"]],
]);

const srId = (food: CuratedFood): string | null => /^usda-sr:(\d+)$/.exec(food.citation)?.[1] ?? null;

// What this holds and what it cannot: a label is never lower than an animal food
// USDA's food group or description NAMES. An animal food the description does not
// name (lard in refried beans, egg in a brownie, milk in white bread) is held only
// by the pinned table in nutrition.foods.unit.test.ts; no food added in 34c-i is
// such a dish, and 34c-ii, which adds dishes, reads each entry's ingredients.
describe("a food's diet, against USDA's own description and food group", () => {
  it("is never lower than the animal food USDA's group or description names", () => {
    const wrong: string[] = [];
    for (const food of CURATED_FOODS) {
      const id = srId(food);
      if (id === null) continue;
      const [description, group] = USDA[id] ?? ["", ""];
      const lowest = lowestDiet(description, group, NO_ANIMAL_FOOD.get(id)?.[0]);
      if (lowest !== null && DIET_LADDER[food.diet] < DIET_LADDER[lowest]) wrong.push(`${food.name} is ${food.diet}; USDA: "${description}" (${group}) is ${lowest} at the lowest`);
    }
    expect(wrong).toEqual([]);
  });

  it("excuses a word only where the description holds it", () => {
    for (const [id, [words]] of NO_ANIMAL_FOOD) expect(wordsOf(USDA[id]?.[0] ?? ""), id).toEqual(expect.arrayContaining([...words]));
  });

  it("reads a plural, and a word the list's own names do not have", () => {
    expect(lowestDiet("Ice creams, vanilla", "Sweets")).toBe("vegetarian");
    expect(lowestDiet("Cake, cheesecake, commercially prepared", "Baked Products")).toBe("vegetarian");
    expect(lowestDiet("Salad dressing, caesar dressing, regular, with anchovies", "Fats and Oils")).toBe("non_vegetarian");
    expect(lowestDiet("Mollusks, whelk, unspecified, cooked, moist heat", "Finfish and Shellfish Products")).toBe("non_vegetarian");
    expect(lowestDiet("Eggs, scrambled, frozen mixture", "Fast Foods")).toBe("vegetarian_eggs");
    expect(lowestDiet("Lentils, mature seeds, cooked, boiled, without salt", "Legumes and Legume Products")).toBeNull();
    expect(lowestDiet("Rolls, hamburger or hotdog, plain", "Baked Products", ["hamburger"])).toBeNull();
    expect(lowestDiet("Rolls, hamburger or hotdog, with cheese", "Baked Products", ["hamburger"])).toBe("vegetarian");
  });

  it("has USDA's description and food group for every SR Legacy entry the list cites, and for no other", () => {
    const cited = CURATED_FOODS.map(srId).filter((id): id is string => id !== null);
    expect(Object.keys(USDA).sort()).toEqual([...cited].sort());
  });
});
