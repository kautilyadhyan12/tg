// Meal ideas for what is left of a person's day (ROADMAP 34d-i). Pure: the same
// day, person and numbers in give the same ideas out, so a screen opened twice
// in a day shows the same ones, and the next day's are drawn afresh (Kd,
// 2026-09-13: the ideas vary).
//
// Every idea is made of foods of the app's own list, at an amount of the food's
// own serving, priced by the list's own numbers. Only the foods named in the
// pools below are ever suggested: plain meat, fish, eggs, dairy, beans, grains,
// vegetables, fruit, nuts and home-style dishes. The rest of the list (fried
// food, sweets, fast food, alcohol, sugary drinks) is found by search and never
// offered (RULINGS 2026-09-12: it is a health app).
//
// The diet is a ceiling (RULINGS 2026-09-13): `dietAllows` is the one rule, so a
// vegetarian is never offered meat and a non-vegetarian is offered meatless
// ideas too.
import { dietAllows, type Diet, type MealIdea, type MealIdeaKind, type SuggestedFood, type SuggestedMeal } from "@app/shared";
import { CURATED_FOODS, type CuratedFood } from "./foods.js";

export type SuggestRole = "protein" | "starch" | "vegetable" | "fruit" | "dish" | "base" | "topping";

/** The foods that may be suggested, by the part of a meal each plays. A dish is
 *  a meal's main part by itself; one marked `true` is eaten with a starch beside
 *  it (a soup, a stew, a curry, a salad). */
const POOL_NAMES: Readonly<Record<Exclude<SuggestRole, "dish">, readonly string[]>> = {
  protein: [
    "Chicken breast (grilled)", "Chicken thigh (cooked)", "Turkey breast (cooked)", "Ground turkey (cooked)",
    "Steak (sirloin, cooked)", "Pork tenderloin (cooked)", "Ground beef 90% (cooked)",
    "Salmon (cooked)", "Cod (cooked)", "Tilapia (cooked)", "Shrimp (cooked)", "Tuna steak (cooked)", "Trout (cooked)",
    "Haddock (cooked)", "Tuna (canned in water)",
    "Eggs (scrambled)", "Egg (hard-boiled)", "Omelette (plain)",
    "Cottage cheese (low-fat)", "Paneer (Indian cottage cheese)",
    "Tofu (firm)", "Tempeh", "Lentils (cooked)", "Chickpeas (cooked)", "Black beans (cooked)", "Kidney beans (cooked)",
    "Edamame (cooked)",
  ],
  starch: [
    "Rice (brown, cooked)", "Rice (white, cooked)", "Quinoa (cooked)", "Pasta (whole wheat, cooked)", "Pasta (cooked)",
    "Couscous (cooked)", "Potato (baked)", "Potato (boiled)", "Sweet potato (baked)", "Barley (cooked)", "Bulgur (cooked)",
    "Whole wheat bread", "Rye bread", "Roti / Chapati (homemade flatbread, no fat)",
  ],
  vegetable: [
    "Broccoli (cooked)", "Spinach (cooked)", "Green beans (cooked)", "Carrots (cooked)", "Asparagus (cooked)",
    "Cauliflower (cooked)", "Mixed vegetables (cooked)", "Salad (green, no dressing)", "Zucchini",
    "Brussels sprouts (cooked)", "Kale (cooked)", "Peas (green, cooked)", "Bell pepper", "Tomato", "Mushrooms",
  ],
  fruit: [
    "Apple", "Banana", "Orange", "Strawberries", "Blueberries", "Grapes", "Pear", "Peach", "Kiwi", "Raspberries",
    "Mango", "Pineapple",
  ],
  base: [
    "Greek yogurt (plain, nonfat)", "Cottage cheese (low-fat)", "Yogurt (plain, low-fat)", "Oatmeal (cooked)",
    "Whole wheat bread", "Rye bread", "French bread / sourdough",
  ],
  topping: ["Almonds", "Walnuts", "Peanut butter", "Almond butter", "Pumpkin seeds", "Pistachios"],
};

const DISH_NAMES: readonly (readonly [name: string, withStarch: boolean])[] = [
  ["Lentil soup", true], ["Chili con carne", true], ["Beef stew", true], ["Chicken noodle soup", true],
  ["Tomato soup", true], ["Ratatouille", true], ["Dal (lentil curry)", true], ["Chana masala (chickpea curry)", true],
  ["Chicken curry", true], ["Vegetable curry", true], ["Palak paneer (spinach and cheese curry)", true],
  ["Sambar (lentil and vegetable stew)", true], ["Greek salad (no dressing)", true], ["Cobb salad (no dressing)", true],
  ["Caesar salad (with chicken, no dressing)", true], ["Chicken stir-fry (with vegetables)", true],
  ["Beef and broccoli", true], ["Teriyaki chicken", true], ["Tandoori chicken", true], ["Ceviche", true],
  ["Rice and beans, meatless (black beans and white rice)", false], ["Rice and beans with meat", false],
  ["Spaghetti bolognese", false], ["Paella (seafood)", false], ["Bibimbap", false], ["Tabbouleh", false],
  ["Khichdi (rice and mung beans, with ghee)", false], ["Sandwich (turkey)", false],
];

const BY_NAME: ReadonlyMap<string, CuratedFood> = new Map(CURATED_FOODS.map((f) => [f.name, f]));
const named = (name: string): CuratedFood => {
  const food = BY_NAME.get(name);
  if (food === undefined) throw new Error(`a suggested food is not on the food list: "${name}"`);
  return food;
};

/** Every food that may be suggested, by its part. */
export const SUGGEST_POOLS: Readonly<Record<SuggestRole, readonly CuratedFood[]>> = {
  protein: POOL_NAMES.protein.map(named),
  starch: POOL_NAMES.starch.map(named),
  vegetable: POOL_NAMES.vegetable.map(named),
  fruit: POOL_NAMES.fruit.map(named),
  base: POOL_NAMES.base.map(named),
  topping: POOL_NAMES.topping.map(named),
  dish: DISH_NAMES.map(([name]) => named(name)),
};
const DISH_WITH_STARCH: ReadonlySet<string> = new Set(DISH_NAMES.filter(([, w]) => w).map(([name]) => named(name).canonical));

/** The least a day must have left for a meal to be suggested, and the least one idea holds. */
export const LEAST_MEAL_KCAL = 150;
/** No idea is sized past this many usual meals, so a day with nothing logged by
 *  evening is not answered with one huge plate. */
export const MOST_MEAL_SHARE = 1.5;
/** No idea is sized past this: a plate of the list's foods at amounts a person
 *  would serve holds about this much. A day with more left gets more meals. */
export const MOST_MEAL_KCAL = 800;
/** The most meals a reply holds (screen 9 asks for two to six a day). */
export const MOST_MEALS = 6;
/** Past this a yogurt bowl or toast cannot be made big enough, and a second plate takes its place. */
const MOST_LIGHT_KCAL = 500;
/** Under this a meal is a light one only. */
const LEAST_PLATE_KCAL = 300;
export const IDEAS_PER_MEAL = 3;
/** How far an idea's calories may be from the meal's, as a share of them. */
export const IDEA_TOLERANCE = 0.2;

interface Bounds { step: number; min: number; max: number }

/** The amounts a food may be suggested at, in grams. A food served by weight
 *  moves 25 g at a time; a cup by the half cup; anything counted (an egg, a
 *  slice, a potato, "2 tbsp") by the whole one. */
function boundsFor(food: CuratedFood, role: SuggestRole): Bounds {
  if (food.unit === "g") {
    const [min, max] =
      role === "protein" ? [75, 250] : role === "starch" ? [75, 350] : role === "vegetable" ? [75, 200]
      : role === "fruit" ? [100, 200] : role === "dish" ? [150, 500] : role === "base" ? [100, 300] : [25, 75];
    return { step: 25, min, max };
  }
  const half = food.unit === "cup";
  const most = role === "dish" ? 2 : role === "protein" ? 4 : role === "base" && half ? 1.5 : 2;
  return { step: half ? food.serving / 2 : food.serving, min: half ? food.serving / 2 : food.serving, max: most * food.serving };
}

interface Part { food: CuratedFood; role: SuggestRole; share: number; bounds: Bounds; grams: number }

const kcalOf = (food: CuratedFood, grams: number): number => Math.round((food.kcal * grams) / 100);
const round1 = (v: number): number => Math.round(v * 10) / 10;
const partsKcal = (parts: readonly Part[]): number => parts.reduce((n, p) => n + kcalOf(p.food, p.grams), 0);

/** Each part at its share of the meal, on a step of its own; then one step at a
 *  time, whichever brings the whole nearest the meal's calories, until none does. */
function sized(shares: readonly (readonly [CuratedFood, SuggestRole, number])[], kcalTarget: number): Part[] {
  const parts = shares.map(([food, role, share]): Part => {
    const bounds = boundsFor(food, role);
    const wanted = ((share * kcalTarget) / food.kcal) * 100;
    const stepped = Math.round(wanted / bounds.step) * bounds.step;
    return { food, role, share, bounds, grams: Math.min(bounds.max, Math.max(bounds.min, stepped)) };
  });
  for (let round = 0; round < 40; round++) {
    const off = Math.abs(kcalTarget - partsKcal(parts));
    let best: { part: Part; grams: number; off: number } | null = null;
    for (const part of parts) {
      for (const grams of [part.grams - part.bounds.step, part.grams + part.bounds.step]) {
        if (grams < part.bounds.min - 1e-9 || grams > part.bounds.max + 1e-9) continue;
        const next = Math.abs(kcalTarget - (partsKcal(parts) - kcalOf(part.food, part.grams) + kcalOf(part.food, grams)));
        if (next < off && (best === null || next < best.off)) best = { part, grams, off: next };
      }
    }
    if (best === null) break;
    best.part.grams = best.grams;
  }
  return parts;
}

const toFood = (part: Part): SuggestedFood => ({
  canonical: part.food.canonical,
  name: part.food.name,
  grams: round1(part.grams),
  servings: Math.round((part.grams / part.food.serving) * 1000) / 1000,
  unit: part.food.unit,
  kcal: kcalOf(part.food, part.grams),
  proteinG: round1((part.food.proteinG * part.grams) / 100),
  carbsG: round1((part.food.carbsG * part.grams) / 100),
  fatG: round1((part.food.fatG * part.grams) / 100),
});

function toIdea(kind: MealIdeaKind, parts: readonly Part[]): MealIdea {
  const items = parts.map(toFood);
  return {
    kind,
    items,
    totals: {
      kcal: items.reduce((n, i) => n + i.kcal, 0),
      proteinG: round1(items.reduce((n, i) => n + i.proteinG, 0)),
      carbsG: round1(items.reduce((n, i) => n + i.carbsG, 0)),
      fatG: round1(items.reduce((n, i) => n + i.fatG, 0)),
    },
  };
}

/** A number from a text, the same for the same text (FNV-1a, 32 bits). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Numbers from 0 up to 1 that follow from the seed alone (mulberry32). */
function drawer(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SuggestInput {
  /** What tells one person's ideas from another's on the same day. */
  seed: string;
  /** The person's day, YYYY-MM-DD. */
  day: string;
  diet: Diet;
  mealsPerDay: number;
  /** The day's calories, and how many of them are eaten. */
  kcalTarget: number;
  kcalEaten: number;
  mealsLogged: number;
}

export interface Suggested { kcalLeft: number; meals: SuggestedMeal[] }

/** The ideas for each meal still to come today; none once under LEAST_MEAL_KCAL is left.
 *  An idea whose foods cannot be sized to within IDEA_TOLERANCE of the meal is left out. */
export function suggestMeals(input: SuggestInput): Suggested {
  const kcalLeft = Math.round(input.kcalTarget - input.kcalEaten);
  if (kcalLeft < LEAST_MEAL_KCAL) return { kcalLeft, meals: [] };

  const usual = input.kcalTarget / input.mealsPerDay;
  const stillToEat = Math.max(1, input.mealsPerDay - input.mealsLogged);
  const most = Math.min(usual * MOST_MEAL_SHARE, MOST_MEAL_KCAL);
  const count = Math.min(MOST_MEALS, Math.max(1, Math.min(stillToEat, Math.floor(kcalLeft / LEAST_MEAL_KCAL)), Math.ceil(kcalLeft / MOST_MEAL_KCAL)));
  const kcalTarget = Math.round(Math.min(kcalLeft / count, most));

  const next = drawer(hash(`${input.seed}|${input.day}`));
  const allowed = (role: SuggestRole): CuratedFood[] => SUGGEST_POOLS[role].filter((f) => dietAllows(input.diet, f.diet));
  const used = new Set<string>();
  /** One of the pool, not yet in an idea of this reply while one is left. */
  const pick = (pool: readonly CuratedFood[]): CuratedFood => {
    const fresh = pool.filter((f) => !used.has(f.canonical));
    const from = fresh.length > 0 ? fresh : pool;
    const food = from[Math.floor(next() * from.length)];
    if (food === undefined) throw new Error(`no food to suggest for the diet "${input.diet}"`);
    used.add(food.canonical);
    return food;
  };
  const isBread = (food: CuratedFood): boolean => food.unit === "slice";

  const plate = (): Part[] =>
    sized([[pick(allowed("protein")), "protein", 0.42], [pick(allowed("starch")), "starch", 0.48], [pick(allowed("vegetable")), "vegetable", 0.1]], kcalTarget);
  const dish = (): Part[] => {
    const main = pick(allowed("dish"));
    return DISH_WITH_STARCH.has(main.canonical)
      ? sized([[main, "dish", 0.55], [pick(allowed("starch")), "starch", 0.35], [pick(allowed("vegetable")), "vegetable", 0.1]], kcalTarget)
      : sized([[main, "dish", 0.85], [pick(allowed("fruit")), "fruit", 0.15]], kcalTarget);
  };
  const light = (): Part[] => {
    const base = pick(allowed("base"));
    // Bread takes a spread; a bowl takes nuts or seeds.
    const toppings = allowed("topping").filter((f) => !isBread(base) || f.unit === "2 tbsp");
    return sized([[base, "base", 0.4], [pick(allowed("fruit")), "fruit", 0.25], [pick(toppings), "topping", 0.35]], kcalTarget);
  };

  /** A small meal: a bowl with fruit, or fruit with nuts or seeds. */
  const snack = (): Part[] =>
    next() < 0.5
      ? sized([[pick(allowed("base").filter((f) => !isBread(f))), "base", 0.6], [pick(allowed("fruit")), "fruit", 0.4]], kcalTarget)
      : sized([[pick(allowed("fruit")), "fruit", 0.4], [pick(allowed("topping")), "topping", 0.6]], kcalTarget);

  const near = (parts: readonly Part[]): boolean => Math.abs(partsKcal(parts) - kcalTarget) <= kcalTarget * IDEA_TOLERANCE;
  /** The shape drawn again, a few times, until its foods can be sized to the meal. */
  const drawn = (shape: () => Part[]): Part[] => {
    let parts = shape();
    for (let tries = 0; tries < 12 && !near(parts); tries++) parts = shape();
    return parts;
  };

  const kinds: readonly MealIdeaKind[] =
    kcalTarget < LEAST_PLATE_KCAL ? ["light", "light", "light"] : kcalTarget > MOST_LIGHT_KCAL ? ["plate", "dish", "plate"] : ["plate", "dish", "light"];
  const shapes: Readonly<Record<MealIdeaKind, () => Part[]>> = { plate, dish, light: kcalTarget < LEAST_PLATE_KCAL ? snack : light };
  const meals: SuggestedMeal[] = [];
  for (let m = 0; m < count; m++) {
    const ideas = kinds.map((kind) => ({ kind, parts: drawn(shapes[kind]) })).filter((i) => near(i.parts));
    meals.push({ kcalTarget, ideas: ideas.map((i) => toIdea(i.kind, i.parts)) });
  }
  return { kcalLeft, meals };
}
