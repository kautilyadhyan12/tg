// What a food's own table says it is (ROADMAP 34d-i): the lowest diet that eats a
// food its table describes in these words and groups. It reads the three fixtures
// `tools/check-food-sources.ts` holds to the downloads, never our names or our labels
// alone. Shared by the meal ideas' tests and the diet plan's (34e-i).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Diet } from "@app/shared";
import { CURATED_FOODS, type CuratedFood } from "../src/modules/nutrition/foods.js";

const fixture = <T extends z.ZodType>(file: string, entry: T): Record<string, z.infer<T>> =>
  z.object({ foods: z.record(z.string().min(1), entry) }).parse(JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", file), "utf8"))).foods;
const words = z.string().min(1);
const USDA = fixture("usda-sr-food-groups.json", z.tuple([words, words]));
const SURVEY = fixture("usda-fndds-ingredients.json", z.tuple([words, z.array(z.tuple([words, z.string()])).min(1)]));
const COFID = fixture("uk-cofid-names.json", z.tuple([words, z.string()]));

const MEAT_GROUPS = new Set([
  "Poultry Products", "Sausages and Luncheon Meats", "Pork Products", "Beef Products",
  "Finfish and Shellfish Products", "Lamb, Veal, and Game Products",
]);
const MEAT_WORDS = [
  "beef", "pork", "chicken", "turkey", "lamb", "veal", "bacon", "ham", "sausage", "meat", "fish", "anchov", "tuna", "salmon",
  "shrimp", "prawn", "clam", "oyster", "crab", "lard", "tallow", "gelatin", "duck", "liver", "steak", "cod", "haddock",
  "mussel", "scallop", "lobster", "squid", "sardine", "herring", "mackerel", "trout", "broth", "stock", "suet", "tilapia",
  "goat", "mutton", "venison", "bison", "octopus", "eel", "salami", "chorizo", "pepperoni", "prosciutto", "pancetta",
  "rabbit", "quail", "snail", "roe",
];
const EGG_WORDS = ["egg", "mayonnaise", "omelet", "meringue", "yolk"];
const DAIRY_WORDS = ["milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "whey", "casein", "ghee", "paneer", "curd", "kefir", "honey"];
/** Plant foods whose table words hold an animal word ("grated meat" is USDA's coconut). */
const PLANT_PHRASES = ["peanut butter", "almond butter", "butternut", "soy milk", "soymilk", "coconut milk", "almond milk", "oat milk", "eggplant", "cream of tartar", "grated meat"];

/** The lowest diet that eats a food its table describes in these words and groups. */
export function lowestByWords(texts: readonly string[], groups: readonly string[]): Diet {
  let text = ` ${texts.join(" | ").toLowerCase()} `;
  for (const phrase of PLANT_PHRASES) text = text.replaceAll(phrase, " ");
  const has = (list: readonly string[]): boolean => list.some((w) => new RegExp(`[^a-z]${w}`).test(text));
  if (groups.some((g) => MEAT_GROUPS.has(g)) || has(MEAT_WORDS)) return "non_vegetarian";
  if (has(EGG_WORDS)) return "vegetarian_eggs";
  if (groups.includes("Dairy and Egg Products") || has(DAIRY_WORDS)) return "vegetarian";
  return "vegan";
}

/** What a food's own table says it is. */
export function tableLowest(food: CuratedFood): Diet {
  const [table, id = ""] = food.citation.split(":");
  if (table === "usda-sr") {
    const entry = USDA[id];
    if (entry === undefined) throw new Error(`no table words for ${food.name}`);
    return lowestByWords([entry[0]], [entry[1]]);
  }
  if (table === "usda-fndds") {
    const entry = SURVEY[id];
    if (entry === undefined) throw new Error(`no table words for ${food.name}`);
    return lowestByWords([entry[0], ...entry[1].map(([name]) => name)], entry[1].map(([, group]) => group));
  }
  const entry = COFID[id];
  if (entry === undefined) throw new Error(`no table words for ${food.name}`);
  return lowestByWords([entry[0], entry[1]], []);
}

const BY_CANONICAL = new Map(CURATED_FOODS.map((f) => [f.canonical, f]));
export const foodOf = (canonical: string): CuratedFood => {
  const food = BY_CANONICAL.get(canonical);
  if (food === undefined) throw new Error(`an idea holds a food that is not on the list: ${canonical}`);
  return food;
};
