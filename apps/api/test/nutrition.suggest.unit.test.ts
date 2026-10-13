// Meal ideas (ROADMAP 34d-i): the rule that picks them. The first block is the
// job's worst thing: a food with meat, fish, egg or milk in it offered to somebody
// who does not eat it. It reads every suggested food's own TABLE words (the three
// fixtures `tools/check-food-sources.ts` holds to the downloads), never our names
// or our labels alone.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DIET_LADDER, dietAllows, mealIdeaSchema, type Diet, type MealIdea } from "@app/shared";
import { CURATED_FOODS, type CuratedFood } from "../src/modules/nutrition/foods.js";
import {
  IDEAS_PER_MEAL, IDEA_TOLERANCE, LEAST_MEAL_KCAL, MOST_MEALS, MOST_MEAL_KCAL, SUGGEST_POOLS, suggestMeals, type SuggestInput,
} from "../src/modules/nutrition/suggest.js";

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
  "goat", "mutton", "venison", "bison", "octopus", "eel",
];
const EGG_WORDS = ["egg", "mayonnaise", "omelet", "meringue", "yolk"];
const DAIRY_WORDS = ["milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "whey", "casein", "ghee", "paneer", "curd", "kefir", "honey"];
/** Plant foods whose table words hold an animal word ("grated meat" is USDA's coconut). */
const PLANT_PHRASES = ["peanut butter", "almond butter", "butternut", "soy milk", "soymilk", "coconut milk", "almond milk", "oat milk", "eggplant", "cream of tartar", "grated meat"];

/** The lowest diet that eats a food its table describes in these words and groups. */
function lowestByWords(texts: readonly string[], groups: readonly string[]): Diet {
  let text = ` ${texts.join(" | ").toLowerCase()} `;
  for (const phrase of PLANT_PHRASES) text = text.replaceAll(phrase, " ");
  const has = (list: readonly string[]): boolean => list.some((w) => new RegExp(`[^a-z]${w}`).test(text));
  if (groups.some((g) => MEAT_GROUPS.has(g)) || has(MEAT_WORDS)) return "non_vegetarian";
  if (has(EGG_WORDS)) return "vegetarian_eggs";
  if (groups.includes("Dairy and Egg Products") || has(DAIRY_WORDS)) return "vegetarian";
  return "vegan";
}

/** What a food's own table says it is. */
function tableLowest(food: CuratedFood): Diet {
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
const foodOf = (canonical: string): CuratedFood => {
  const food = BY_CANONICAL.get(canonical);
  if (food === undefined) throw new Error(`an idea holds a food that is not on the list: ${canonical}`);
  return food;
};

const DIETS: readonly Diet[] = ["vegan", "vegetarian", "vegetarian_eggs", "non_vegetarian"];
const day = (n: number): string => `2026-03-${String(n).padStart(2, "0")}`;
const input = (over: Partial<SuggestInput> = {}): SuggestInput => ({
  seed: "person-1", day: day(11), diet: "non_vegetarian", mealsPerDay: 3, kcalTarget: 2000, kcalEaten: 0, mealsLogged: 0, ...over,
});
const ideasOf = (over: Partial<SuggestInput>): MealIdea[] => suggestMeals(input(over)).meals.flatMap((m) => m.ideas);

/** Every case of the sweep: 28 days, 5 people, 6 day sizes, 4 meal counts, 4 points in the day. */
function* sweep(diet: Diet): Generator<SuggestInput> {
  for (let d = 1; d <= 28; d++) {
    for (const kcalTarget of [1200, 1500, 1800, 2200, 2800, 3500]) {
      for (const mealsPerDay of [2, 3, 4, 6]) {
        for (const eaten of [0, 0.3, 0.6, 0.9]) {
          yield input({ seed: `person-${String(d % 5)}`, day: day(d), diet, mealsPerDay, kcalTarget, kcalEaten: Math.round(kcalTarget * eaten), mealsLogged: Math.round(mealsPerDay * eaten) });
        }
      }
    }
  }
}

describe("THE WORST THING: nobody is offered a food their diet does not eat", () => {
  it("reads an animal food in a table's words, the ones no suggested food has among them", () => {
    expect(lowestByWords(["Soup, ham and bean"], ["Soups, Sauces, and Gravies"])).toBe("non_vegetarian");
    expect(lowestByWords(["Bread, naan", "Egg, whole, raw"], ["Baked Products", "Baked Products"])).toBe("vegetarian_eggs");
    expect(lowestByWords(["Rice with ghee"], [])).toBe("vegetarian");
    expect(lowestByWords(["Kimchi", "Sauce, fish, ready-to-serve"], ["Vegetables and Vegetable Products"])).toBe("non_vegetarian");
    expect(lowestByWords(["Jelly", "Gelatins, dry powder"], ["Sweets"])).toBe("non_vegetarian");
    expect(lowestByWords(["Soup, vegetable, made with chicken broth"], [])).toBe("non_vegetarian");
    expect(lowestByWords(["Peanut butter, smooth", "Squash, butternut"], ["Legumes and Legume Products"])).toBe("vegan");
    expect(lowestByWords(["Cheddar"], ["Dairy and Egg Products"])).toBe("vegetarian");
  });

  it("every food that may be suggested is labelled no lower than its own table's words put it", () => {
    const wrong = Object.values(SUGGEST_POOLS).flat()
      .filter((f) => DIET_LADDER[f.diet] < DIET_LADDER[tableLowest(f)])
      .map((f) => `${f.name}: labelled ${f.diet}, its table says ${tableLowest(f)}`);
    expect(wrong).toEqual([]);
  });

  it.each(DIETS.filter((d) => d !== "non_vegetarian"))("a %s person: no idea, on any day, holds a food their diet rules out", (diet) => {
    const offered = new Set<string>();
    let ideas = 0;
    for (const one of sweep(diet)) {
      for (const idea of suggestMeals(one).meals.flatMap((m) => m.ideas)) {
        ideas++;
        for (const item of idea.items) offered.add(item.canonical);
      }
    }
    expect(ideas).toBeGreaterThan(5000);
    const wrong = [...offered].map(foodOf)
      .filter((f) => !dietAllows(diet, f.diet) || !dietAllows(diet, tableLowest(f)))
      .map((f) => `${f.name} (${f.diet}; its table: ${tableLowest(f)})`);
    expect(wrong).toEqual([]);
  });

  it("every diet has foods for every part of a meal", () => {
    for (const diet of DIETS) {
      for (const [role, pool] of Object.entries(SUGGEST_POOLS)) {
        expect(pool.filter((f) => dietAllows(diet, f.diet)).length, `${diet} ${role}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("what is suggested", () => {
  it("only the foods of the pools, and never fried food, sweets, fast food, alcohol or a sugary drink", () => {
    const pool = new Set(Object.values(SUGGEST_POOLS).flat().map((f) => f.canonical));
    const never = [
      "Bacon (cooked)", "Fried chicken", "Chicken nuggets", "Hot dog", "Hamburger (fast food)", "Cheeseburger", "Pizza (pepperoni)",
      "French fries", "Potato chips", "Donut (glazed)", "Ice cream (vanilla)", "Milk chocolate", "Chocolate cake", "Cheesecake",
      "Coke / cola", "Energy drink", "Beer (regular)", "Wine (red)", "Spirits (vodka, gin, rum, whiskey)", "Sugar (white)",
      "Salami", "Pepperoni", "Corn dog", "Churros",
    ];
    for (const name of never) {
      const food = CURATED_FOODS.find((f) => f.name === name);
      expect(food, name).toBeDefined();
      expect(pool.has(food?.canonical ?? ""), name).toBe(false);
    }
    for (const diet of DIETS) {
      for (const one of sweep(diet)) {
        for (const idea of suggestMeals(one).meals.flatMap((m) => m.ideas)) {
          for (const item of idea.items) expect(pool.has(item.canonical), item.name).toBe(true);
        }
      }
    }
  });

  it("a non-vegetarian is offered meat and meatless ideas over a month", () => {
    const kinds = new Set<boolean>();
    for (let d = 1; d <= 28; d++) {
      for (const idea of ideasOf({ day: day(d) })) kinds.add(idea.items.some((i) => foodOf(i.canonical).diet === "non_vegetarian"));
    }
    expect([...kinds].sort()).toEqual([false, true]);
  });

  it("the same person on the same day gets the same ideas, and other ones the next day and beside another person", () => {
    const today = suggestMeals(input());
    expect(suggestMeals(input())).toEqual(today);
    expect(suggestMeals(input({ day: day(12) }))).not.toEqual(today);
    expect(suggestMeals(input({ seed: "person-2" }))).not.toEqual(today);
  });

  it("no food twice among one reply's ideas while the pools hold another", () => {
    const mains = suggestMeals(input()).meals.flatMap((m) => m.ideas).map((i) => i.items[0]?.canonical);
    expect(new Set(mains).size).toBe(mains.length);
  });
});

describe("how many meals, and how big: every class of day", () => {
  const cases: readonly (readonly [name: string, over: Partial<SuggestInput>, meals: number, kcalTarget: number | null])[] = [
    ["nothing eaten, three meals a day", {}, 3, 667],
    ["one meal logged", { kcalEaten: 600, mealsLogged: 1 }, 2, 700],
    ["two meals logged", { kcalEaten: 1300, mealsLogged: 2 }, 1, 700],
    ["every meal logged and calories still left: one more", { kcalEaten: 1500, mealsLogged: 3 }, 1, 500],
    ["more meals logged than the answer", { kcalEaten: 1500, mealsLogged: 5 }, 1, 500],
    ["nothing left", { kcalEaten: 2000, mealsLogged: 3 }, 0, null],
    ["over the day's calories", { kcalEaten: 2600, mealsLogged: 3 }, 0, null],
    ["one calorie under the least a meal holds", { kcalEaten: 2000 - LEAST_MEAL_KCAL + 1, mealsLogged: 2 }, 0, null],
    ["exactly the least a meal holds", { kcalEaten: 2000 - LEAST_MEAL_KCAL, mealsLogged: 2 }, 1, LEAST_MEAL_KCAL],
    ["little left for many meals: fewer, none under the least", { mealsPerDay: 6, kcalEaten: 1600, mealsLogged: 1 }, 2, 200],
    ["nothing logged by evening: no meal past one and a half usual ones", { mealsPerDay: 6, kcalTarget: 1800, mealsLogged: 5 }, 3, 450],
    ["a big day in two meals: more meals, none past the most", { mealsPerDay: 2, kcalTarget: 3500 }, 5, 700],
    ["the biggest day: never more than six meals", { mealsPerDay: 2, kcalTarget: 6000 }, MOST_MEALS, MOST_MEAL_KCAL],
  ];
  it.each(cases)("%s", (_name, over, meals, kcalTarget) => {
    const reply = suggestMeals(input(over));
    expect(reply.meals.length).toBe(meals);
    for (const meal of reply.meals) expect(meal.kcalTarget).toBe(kcalTarget);
    expect(reply.kcalLeft).toBe(Math.round(input(over).kcalTarget - input(over).kcalEaten));
  });

  it("a small meal is a light one, and a big one is never a bowl or toast", () => {
    expect(ideasOf({ kcalEaten: 1800, mealsLogged: 2 }).map((i) => i.kind)).toEqual(["light", "light", "light"]);
    expect(ideasOf({ kcalTarget: 2400 }).map((i) => i.kind)).not.toContain("light");
    expect(ideasOf({ kcalTarget: 1200 }).slice(0, 3).map((i) => i.kind)).toEqual(["plate", "dish", "light"]);
  });

  it.each(DIETS)("a %s person: every meal has its three ideas, each near the meal's calories, at amounts of the food's own serving", (diet) => {
    for (const one of sweep(diet)) {
      const reply = suggestMeals(one);
      expect(reply.meals.length).toBeLessThanOrEqual(MOST_MEALS);
      for (const meal of reply.meals) {
        expect(meal.kcalTarget).toBeGreaterThanOrEqual(LEAST_MEAL_KCAL);
        expect(meal.kcalTarget).toBeLessThanOrEqual(MOST_MEAL_KCAL);
        expect(meal.ideas.length, JSON.stringify(one)).toBe(IDEAS_PER_MEAL);
        for (const idea of meal.ideas) {
          expect(mealIdeaSchema.safeParse(idea).success).toBe(true);
          expect(Math.abs(idea.totals.kcal - meal.kcalTarget)).toBeLessThanOrEqual(meal.kcalTarget * IDEA_TOLERANCE);
          expect(idea.totals.kcal).toBe(idea.items.reduce((n, i) => n + i.kcal, 0));
          for (const item of idea.items) {
            const food = foodOf(item.canonical);
            // The number a meal logged at these grams would carry.
            expect(item.kcal).toBe(Math.round((food.kcal * item.grams) / 100));
            expect(item.unit).toBe(food.unit);
            expect(item.servings).toBeCloseTo(item.grams / food.serving, 2);
            const step = food.unit === "g" ? 25 : food.unit === "cup" ? food.serving / 2 : food.serving;
            expect((item.grams / step) % 1, `${item.name} ${String(item.grams)} g`).toBeCloseTo(0, 6);
            // Two cups of a soup at most.
            expect(item.grams).toBeLessThanOrEqual(510);
          }
        }
      }
    }
  });
});
