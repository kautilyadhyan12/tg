// A food's diet against what its own table says the food is (ROADMAP 34c-i to
// 34c-iii). The worst a label can do is offer meat, fish, egg or milk to somebody
// who does not eat it, so no label is checked against our own names. Three files
// in fixtures/ hold each table's words, and `tools/check-food-sources.ts` holds
// them to the downloads: USDA's description and food group of every SR Legacy
// entry the list cites (usda-sr-food-groups.json), what USDA makes every survey
// entry from, each ingredient with its food group (usda-fndds-ingredients.json),
// and CoFID's name and note (uk-cofid-names.json).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DIET_LADDER, type Diet } from "@app/shared";
import { CURATED_FOODS, type CuratedFood } from "../src/modules/nutrition/foods.js";

const fixture = <T extends z.ZodType>(file: string, entry: T): Record<string, z.infer<T>> =>
  z.object({ foods: z.record(z.string().min(1), entry) }).parse(JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", file), "utf8"))).foods;

const words = z.string().min(1);
const USDA = fixture("usda-sr-food-groups.json", z.tuple([words, words]));
const SURVEY = fixture("usda-fndds-ingredients.json", z.tuple([words, z.array(z.tuple([words, z.string()])).min(1)]));
const COFID = fixture("uk-cofid-names.json", z.tuple([words, z.string()]));

/** USDA's food groups that hold only meat, poultry, fish or shellfish. */
const MEAT_AND_FISH_GROUPS = new Set([
  "Poultry Products", "Sausages and Luncheon Meats", "Pork Products", "Beef Products",
  "Finfish and Shellfish Products", "Lamb, Veal, and Game Products",
]);

/** USDA's food groups that hold no animal food unless a description names one. */
const PLANT_GROUPS = new Set([
  "Vegetables and Vegetable Products", "Fruits and Fruit Juices", "Spices and Herbs", "Nut and Seed Products",
  "Legumes and Legume Products", "Cereal Grains and Pasta", "Beverages",
]);

/** The words of a description, lower case, each without its plural ending
 *  ("Ice creams" is cream, "Anchovies" anchovy, "Sandwiches" sandwich). */
const singular = (w: string): string => (w.endsWith("ies") && w.length > 4 ? `${w.slice(0, -3)}y` : w.endsWith("ches") || w.endsWith("shes") ? w.slice(0, -2) : w.endsWith("s") && !w.endsWith("ss") && w.length > 3 ? w.slice(0, -1) : w);
const wordsOf = (description: string): string[] => description.toLowerCase().split(/[^a-z]+/).filter((w) => w !== "").map(singular);

/** A word of a description that is meat, fish or shellfish in any food group: USDA
 *  files a beef jerky under Snacks, a pepperoni pizza under Fast Foods, a chicken
 *  broth under Soups and a dressing with anchovy under Fats and Oils. */
const MEAT_AND_FISH_WORDS = new Set([
  "beef", "pork", "chicken", "turkey", "lamb", "veal", "bacon", "ham", "sausage", "pepperoni", "salami", "meat", "meatball",
  "fish", "anchovy", "tuna", "salmon", "shrimp", "clam", "oyster", "crab", "lard", "tallow", "gelatin",
  "frankfurter", "hamburger", "cheeseburger",
  "duck", "venison", "bison", "liver", "steak", "chorizo", "bologna", "kielbasa", "prosciutto", "pastrami", "bratwurst", "poultry",
  "mollusk", "crustacean", "cod", "haddock", "pollock", "mussel", "scallop", "lobster", "squid", "sardine", "herring",
  "kipper", "mackerel", "trout", "scampi", "prawn", "worcestershire", "suet", "dripping", "haggi",
  "eel", "octopus", "bonito", "roe", "snapper", "mutton",
]);
const EGG_WORDS = new Set(["egg", "mayonnaise", "omelette", "omelet", "meringue", "pavlova", "yolk", "ladyfinger"]);
const DAIRY_WORDS = new Set([
  "milk", "cheese", "cheesecake", "butter", "cream", "yogurt", "whey", "casein", "buttermilk", "ghee",
  "yoghurt", "parmesan", "mozzarella", "cheddar", "ricotta", "feta", "gruyere", "paneer", "custard", "lassi", "curd",
]);

/** An ingredient whose animal food USDA's description does not name: the phrase,
 *  and the lowest diet that eats it. */
const HIDDEN: readonly (readonly [phrase: string, diet: Diet, what: string])[] = [
  ["refried beans, canned, traditional", "non_vegetarian", "lard"],
  ["salad dressing, thousand island", "vegetarian_eggs", "egg yolk"],
  ["cake, sponge", "vegetarian_eggs", "egg"],
];

const higher = (a: Diet | null, b: Diet | null): Diet | null => (a === null ? b : b === null ? a : DIET_LADDER[a] >= DIET_LADDER[b] ? a : b);

/** The lowest diet a table's own words allow the food, or null where they name no
 *  animal food. The food group decides first; the description's words are for the
 *  groups that mix foods. */
function lowestDiet(description: string, group: string, excused: readonly string[] = []): Diet | null {
  const named = wordsOf(description).filter((w) => !excused.includes(w));
  if (MEAT_AND_FISH_GROUPS.has(group) || named.some((w) => MEAT_AND_FISH_WORDS.has(w))) return "non_vegetarian";
  const hidden = HIDDEN.filter(([phrase]) => description.toLowerCase().includes(phrase)).reduce<Diet | null>((diet, [, lowest]) => higher(diet, lowest), null);
  if (hidden === "non_vegetarian") return hidden;
  if (hidden === "vegetarian_eggs" || named.some((w) => EGG_WORDS.has(w))) return "vegetarian_eggs";
  if (group === "Dairy and Egg Products" || named.some((w) => DAIRY_WORDS.has(w)) || named[0] === "honey") return "vegetarian";
  return null;
}

/** The words of one entry's description, or of one ingredient's, that name no
 *  animal food there, with the reason. Only those words are excused: the rest of
 *  the description is still read. Keyed by the entry's FDC id, or by the
 *  ingredient's own description. */
const NO_ANIMAL_FOOD: ReadonlyMap<string, readonly [words: readonly string[], why: string]> = new Map<string, readonly [readonly string[], string]>([
  ["172796", [["hamburger"], "a roll FOR a hamburger or hot dog, plain"]],
  ["170173", [["milk", "meat"], "coconut milk, pressed from the coconut's white, which USDA calls its meat"]],
  ["174266", [["butter"], "peanut butter is ground peanuts"]],
  ["168588", [["butter"], "almond butter is ground almonds"]],
  ["170189", [["butter"], "sesame butter is ground sesame seeds"]],
  ["174832", [["milk"], "almond milk is almonds and water"]],
  ["2705412", [["milk"], "oat milk is oats and water"]],
  ["Restaurant, Chinese, fried rice, without meat", [["meat"], "WITHOUT meat"]],
  ["Restaurant, Chinese, vegetable lo mein, without meat", [["meat"], "WITHOUT meat"]],
  ["Nuts, coconut milk, raw (liquid expressed from grated meat and water)", [["milk", "meat"], "coconut milk, and the coconut's white"]],
  ["Sesame butter, creamy", [["butter"], "sesame butter is ground sesame seeds"]],
  ["2709032", [["milk"], "rice cooked in coconut milk"]],
  ["Sauce, peanut, made from peanut butter, water, soy sauce", [["butter"], "peanut butter is ground peanuts"]],
]);

/** A UK-table dish labelled below non-vegetarian whose CoFID words do not settle
 *  its label: a real label or the maker's own recipe, read on 2026-10-13, with
 *  where it was read. CoFID lists no ingredients, so this is what holds them. */
const REAL_LABELS: ReadonlyMap<string, readonly [where: string, ingredients: string]> = new Map<string, readonly [string, string]>([
  ["crumpet_toasted", ["Warburtons' own crumpet recipe (foodanddrink.scotsman.com/food/warburtons-crumpets-recipe)", "plain white flour, water, salt, sugar, baking powder, dried yeast"]],
  ["shortbread", ["Walkers Pure Butter Shortbread Fingers (walkersshortbread.com/shortbread-fingers)", "wheat flour (wheat flour, calcium carbonate, iron, niacin, thiamin), butter (milk) (32%), sugar, salt"]],
  ["oat_flapjack_british_oat_bar", ["Tesco 20 Flapjack Bites (tesco.com/groceries/en-GB/products/268394986)", "oats (39%), sweetened condensed skimmed milk, partially inverted sugar syrup, glucose syrup, sugar, butter (milk), palm oil, rapeseed oil, salt, flavouring"]],
  ["hot_cross_bun", ["Tesco Finest hot cross buns, as bakedbyclo.com/are-hot-cross-buns-vegan gives the label", "butter (milk), buttermilk powder (milk), honey"]],
  ["pavlova_with_fruit_and_cream", ["Tesco Raspberry Pavlova 310G (tesco.com/groceries/en-GB/products/291745550)", "sugar, whipping cream (milk) (28%), pasteurised egg white, raspberries (17%), water, cornflour, citric acid, stabilisers (carob gum, xanthan gum), caramelised sugar syrup, flavouring"]],
]);

/** UK-table foods on the list before 34c-ii, each a single food or a dish the
 *  list's own comment explains (`foods.ts`); not re-read here. */
const COFID_BEFORE = new Set(["muesli", "roti_chapati", "paneer", "chana_masala"]);

const cited = (food: CuratedFood, table: string): string | null => (food.citation.startsWith(`${table}:`) ? food.citation.slice(table.length + 1) : null);

const V = "vegetarian", E = "vegetarian_eggs";
/** Ingredients of the survey foods labelled below non-vegetarian that neither a
 *  food group nor a word settles: USDA files each under a group that mixes foods,
 *  or under none. Each was read, and is given the lowest diet that eats its usual
 *  version: null for a plant, a mineral or a vitamin; vegetarian for a bread or a
 *  spread that usually holds milk, as the list's own white bread is labelled. A
 *  new ingredient lands here only by being read. */
const READ: ReadonlyMap<string, Diet | null> = new Map<string, Diet | null>([
  ["Bread, Italian", V], ["Bread, crumbs, dry, grated, plain", V], ["Bread, white, commercially prepared", V],
  ["Margarine, regular, 80% fat, composite, stick, with salt", V],
  ["Margarine, regular, 80% fat, composite, stick, with salt, with added vitamin D", V],
  ["Margarine-like, vegetable oil spread, 60% fat, tub, with salt", V],
  ["Margarine-like, vegetable oil spread, 60% fat, tub, with salt, with added vitamin D", V],
  ["Formulated bar, ZONE PERFECT CLASSIC CRUNCH BAR, mixed flavors", V],
  ["Pie Crust, Cookie-type, Graham Cracker, Ready Crust", V],
  ["Fast foods, hush puppies", E], ["Salad dressing, coleslaw", E],
  ["Doughnuts, yeast-leavened, glazed, enriched (includes honey buns)", E],
  ["Sauce, hoisin, ready-to-serve", null], ["Sauce, teriyaki, ready-to-serve", null], ["Snacks, plantain chips, salted", null],
  ["Sauce, peanut, made from peanut butter, water, soy sauce", null],
  ["Restaurant, Chinese, fried rice, without meat", E], ["Restaurant, Chinese, vegetable lo mein, without meat", E], ["Sesame butter, creamy", null],
  ["Calcium as ingredient", null], ["Folic acid as ingredient", null], ["Iron as ingredient", null],
  ["Vitamin B composite in cereals", null], ["Vitamin B-12 as ingredient", null], ["Vitamin D as ingredient", null],
  ["Cereals, corn grits, white, regular and quick, enriched, dry", null], ["Cereals, oats, regular and quick, not fortified, dry", null],
  ["Cocoa, dry powder, unsweetened", null], ["Flour, rice, glutinous", null], ["Jams and preserves", null], ["Jellies", null],
  ["LOW SODIUM: Tomato juice, canned", null], ["Leavening agents, baking powder, double-acting, sodium aluminum sulfate", null],
  ["Leavening agents, baking soda", null], ["Lettuce, romaine, green, raw", null],
  ["Oil, canola", null], ["Oil, corn", null], ["Oil, olive, extra light", null], ["Oil, olive, extra virgin", null],
  ["Oil, soybean", null], ["Oil, sunflower", null], ["Onions, red, raw", null], ["Onions, white, raw", null], ["Onions, yellow, raw", null],
  ["Phyllo dough", null], ["Pie crust, standard-type, frozen, ready-to-bake, enriched, baked", null],
  ["Sauce, pasta, spaghetti/marinara, ready-to-serve", null], ["Shortening, vegetable, household, composite", null],
  ["Snacks, CLIF BAR, mixed flavors", null], ["Snacks, tortilla chips, plain, white corn, salted", null], ["Spinach, baby", null],
  ["Sugars, granulated", null], ["Syrup, NESTLE, chocolate", null], ["Tomato, roma", null], ["Tomatoes, grape, raw", null],
  ["Tortillas, ready-to-bake or -fry, flour, refrigerated", null],
]);

/** What one ingredient allows: its group and words, and what reading it found. */
const ingredientLowest = (name: string, group: string): Diet | null =>
  higher(lowestDiet(name, group, NO_ANIMAL_FOOD.get(name)?.[0]), READ.get(name) ?? null);

/** What USDA's ingredient list allows a survey food: the highest of its own
 *  description's and each ingredient's. */
function surveyLowest(id: string): Diet | null {
  const [description, ingredients] = SURVEY[id] ?? ["", []];
  return ingredients.reduce<Diet | null>((diet, [name, group]) => higher(diet, ingredientLowest(name, group)), lowestDiet(description, "", NO_ANIMAL_FOOD.get(id)?.[0]));
}

// What this holds and what it cannot. A label is never lower than an animal food
// the table NAMES: in an SR Legacy entry's group or description, in any ingredient
// of a survey entry, in CoFID's name or note. A survey dish USDA makes from one
// bought food (a frozen pierogi, a restaurant tamale) and a CoFID dish show no
// ingredients, so an animal food their words do not name (dripping under a
// Yorkshire pudding, stock in a risotto) is held only by the pinned table in
// nutrition.foods.unit.test.ts; a UK-table dish labelled below non-vegetarian is
// held to a real label besides (`REAL_LABELS`).
describe("a food's diet, against its table's own words", () => {
  it("is never lower than the animal food USDA's group or description names (SR Legacy)", () => {
    const wrong: string[] = [];
    for (const food of CURATED_FOODS) {
      const id = cited(food, "usda-sr");
      if (id === null) continue;
      const [description, group] = USDA[id] ?? ["", ""];
      const lowest = lowestDiet(description, group, NO_ANIMAL_FOOD.get(id)?.[0]);
      if (lowest !== null && DIET_LADDER[food.diet] < DIET_LADDER[lowest]) wrong.push(`${food.name} is ${food.diet}; USDA: "${description}" (${group}) is ${lowest} at the lowest`);
    }
    expect(wrong).toEqual([]);
  });

  it("is never lower than any ingredient USDA makes the dish from (survey foods)", () => {
    const wrong: string[] = [];
    for (const food of CURATED_FOODS) {
      const id = cited(food, "usda-fndds");
      if (id === null) continue;
      const lowest = surveyLowest(id);
      if (lowest !== null && DIET_LADDER[food.diet] < DIET_LADDER[lowest]) {
        const [description, ingredients] = SURVEY[id] ?? ["", []];
        const named = ingredients.filter(([name, group]) => ingredientLowest(name, group) === lowest).map(([name]) => name);
        wrong.push(`${food.name} is ${food.diet}; USDA makes "${description}" from ${named.join(" · ")}: ${lowest} at the lowest`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("has read every ingredient that no food group and no word settles, in a dish labelled for somebody who eats no meat", () => {
    const unread = new Set<string>();
    const met = new Set<string>();
    for (const food of CURATED_FOODS) {
      const id = cited(food, "usda-fndds");
      if (id === null || food.diet === "non_vegetarian") continue;
      for (const [name, group] of SURVEY[id]?.[1] ?? []) {
        if (PLANT_GROUPS.has(group) || group === "Dairy and Egg Products") continue;
        if (lowestDiet(name, group, NO_ANIMAL_FOOD.get(name)?.[0]) !== null) continue;
        met.add(name);
        if (!READ.has(name)) unread.add(name);
      }
    }
    expect([...unread].sort()).toEqual([]);
    expect([...READ.keys()].filter((name) => !met.has(name))).toEqual([]);
  });

  it("is never lower than the animal food CoFID's name or note names", () => {
    const wrong: string[] = [];
    for (const food of CURATED_FOODS) {
      const id = cited(food, "uk-cofid");
      if (id === null) continue;
      const [name, note] = COFID[id] ?? ["", ""];
      const lowest = higher(lowestDiet(name, ""), lowestDiet(note, ""));
      if (lowest !== null && DIET_LADDER[food.diet] < DIET_LADDER[lowest]) wrong.push(`${food.name} is ${food.diet}; CoFID: "${name}" (${note}) is ${lowest} at the lowest`);
    }
    expect(wrong).toEqual([]);
  });

  it("holds a UK-table dish labelled for somebody who eats no meat to CoFID's own words or to a real label", () => {
    // CoFID's words name no animal food for a crumpet, shortbread or a flapjack, and none for a Cornish pasty or a
    // moussaka either: so a label below non-vegetarian needs more than their silence.
    const unheld: string[] = [];
    for (const food of CURATED_FOODS) {
      const id = cited(food, "uk-cofid");
      if (id === null || food.diet === "non_vegetarian" || COFID_BEFORE.has(food.canonical)) continue;
      const [name, note] = COFID[id] ?? ["", ""];
      const label = REAL_LABELS.get(food.canonical);
      if (label === undefined) {
        if (higher(lowestDiet(name, ""), lowestDiet(note, "")) !== food.diet) unheld.push(`${food.name}: CoFID's words do not say ${food.diet}, and no real label is kept`);
        continue;
      }
      const lowest = lowestDiet(label[1], "");
      if (lowest !== null && DIET_LADDER[food.diet] < DIET_LADDER[lowest]) unheld.push(`${food.name} is ${food.diet}; ${label[0]} holds ${lowest}`);
    }
    expect(unheld).toEqual([]);
    for (const canonical of REAL_LABELS.keys()) expect(CURATED_FOODS.some((food) => food.canonical === canonical && food.citation.startsWith("uk-cofid:")), canonical).toBe(true);
  });

  it("excuses a word only where the description holds it", () => {
    const ingredients = new Set(Object.values(SURVEY).flatMap(([, list]) => list.map(([name]) => name)));
    for (const [key, [excused]] of NO_ANIMAL_FOOD) {
      const description = USDA[key]?.[0] ?? SURVEY[key]?.[0] ?? (ingredients.has(key) ? key : "");
      expect(wordsOf(description), key).toEqual(expect.arrayContaining([...excused]));
    }
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

  it("reads an ingredient as USDA writes it, in a group that mixes foods or in none", () => {
    // Ingredient lines of dishes this list does NOT hold, from the survey release's input_food.csv.
    expect(lowestDiet("Soup, stock, fish, home-prepared", "Soups, Sauces, and Gravies")).toBe("non_vegetarian");
    expect(lowestDiet("Soup, chicken broth, ready-to-serve", "Soups, Sauces, and Gravies")).toBe("non_vegetarian");
    expect(lowestDiet("Sauce, worcestershire", "Soups, Sauces, and Gravies")).toBe("non_vegetarian");
    expect(lowestDiet("Gelatins, dry powder, unsweetened", "Sweets")).toBe("non_vegetarian");
    expect(lowestDiet("Refried beans, canned, traditional, reduced sodium", "Legumes and Legume Products")).toBe("non_vegetarian");
    expect(lowestDiet("Refried beans, canned, vegetarian", "Legumes and Legume Products")).toBeNull();
    expect(lowestDiet("Mollusks, squid, mixed species, raw", "")).toBe("non_vegetarian");
    expect(lowestDiet("Salad dressing, mayonnaise, regular", "Fats and Oils")).toBe("vegetarian_eggs");
    expect(lowestDiet("Cheese, monterey jack, solid", "")).toBe("vegetarian");
    expect(lowestDiet("Oil, olive, extra virgin", "")).toBeNull();
  });

  it("has each table's own words for every entry the list cites, and for no other", () => {
    for (const [table, held] of [["usda-sr", USDA], ["usda-fndds", SURVEY], ["uk-cofid", COFID]] as const) {
      const ids = CURATED_FOODS.map((food) => cited(food, table)).filter((id): id is string => id !== null);
      expect(Object.keys(held).sort(), table).toEqual([...ids].sort());
    }
  });
});
