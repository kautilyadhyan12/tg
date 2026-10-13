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

export type SuggestRole =
  | "protein" | "starch" | "bread" | "curry_side" | "vegetable" | "fruit" | "bowl" | "toast" | "nuts" | "spread" | "dish";

/** The foods that may be suggested, by the part of a meal each plays. */
const POOL_NAMES: Readonly<Record<Exclude<SuggestRole, "dish">, readonly string[]>> = {
  protein: [
    "Chicken breast (grilled)", "Chicken thigh (cooked)", "Turkey breast (cooked)", "Ground turkey (cooked)",
    "Steak (sirloin, cooked)", "Pork tenderloin (cooked)", "Ground beef 90% (cooked)",
    "Salmon (cooked)", "Cod (cooked)", "Tilapia (cooked)", "Shrimp (cooked)", "Tuna steak (cooked)", "Trout (cooked)",
    "Haddock (cooked)", "Tuna (canned in water)",
    "Eggs (scrambled)", "Egg (hard-boiled)", "Omelette (plain)", "Paneer (Indian cottage cheese)",
    "Tofu (firm)", "Tempeh", "Lentils (cooked)", "Chickpeas (cooked)", "Black beans (cooked)", "Kidney beans (cooked)",
    "Edamame (cooked)",
  ],
  // Beside a protein food, a stew or a stir-fry.
  starch: [
    "Rice (brown, cooked)", "Rice (white, cooked)", "Quinoa (cooked)", "Pasta (whole wheat, cooked)", "Pasta (cooked)",
    "Couscous (cooked)", "Potato (baked)", "Potato (boiled)", "Sweet potato (baked)", "Barley (cooked)", "Bulgur (cooked)",
  ],
  // Beside a soup or a salad, never beside a curry or on a plate.
  bread: ["Whole wheat bread", "Rye bread", "French bread / sourdough"],
  curry_side: ["Rice (brown, cooked)", "Rice (white, cooked)", "Roti / Chapati (homemade flatbread, no fat)"],
  vegetable: [
    "Broccoli (cooked)", "Spinach (cooked)", "Green beans (cooked)", "Carrots (cooked)", "Asparagus (cooked)",
    "Cauliflower (cooked)", "Mixed vegetables (cooked)", "Salad (green, no dressing)", "Zucchini",
    "Brussels sprouts (cooked)", "Kale (cooked)", "Peas (green, cooked)", "Bell pepper", "Tomato", "Mushrooms",
  ],
  fruit: [
    "Apple", "Banana", "Orange", "Strawberries", "Blueberries", "Grapes", "Pear", "Peach", "Kiwi", "Raspberries",
    "Mango", "Pineapple",
  ],
  // A bowl takes fruit, and nuts or seeds.
  bowl: ["Greek yogurt (plain, nonfat)", "Cottage cheese (low-fat)", "Yogurt (plain, low-fat)", "Oatmeal (cooked)", "Soy milk"],
  // Toast takes a spread, and fruit.
  toast: ["Whole wheat bread", "Rye bread", "French bread / sourdough"],
  nuts: ["Almonds", "Walnuts", "Pumpkin seeds", "Pistachios", "Cashews", "Peanuts"],
  spread: ["Peanut butter", "Almond butter", "Hummus"],
};

/** What is eaten beside a dish: bread beside a soup or a salad, rice or roti
 *  beside a curry, a grain or potato beside a stew or a stir-fry, and fruit
 *  after a dish that is a meal by itself. */
type DishSide = "bread" | "curry_side" | "starch" | "fruit";
const DISH_NAMES: readonly (readonly [name: string, side: DishSide])[] = [
  ["Lentil soup", "bread"], ["Chicken noodle soup", "bread"], ["Tomato soup", "bread"], ["Minestrone", "bread"],
  ["Cobb salad (no dressing)", "bread"], ["Caesar salad (with chicken, no dressing)", "bread"],
  ["Dal (lentil curry)", "curry_side"], ["Chana masala (chickpea curry)", "curry_side"], ["Chicken curry", "curry_side"],
  ["Vegetable curry", "curry_side"], ["Palak paneer (spinach and cheese curry)", "curry_side"],
  ["Sambar (lentil and vegetable stew)", "curry_side"], ["Tandoori chicken", "curry_side"],
  ["Chili con carne", "starch"], ["Beef stew", "starch"], ["Ratatouille", "starch"],
  ["Chicken stir-fry (with vegetables)", "starch"], ["Beef and broccoli", "starch"], ["Teriyaki chicken", "starch"],
  ["Rice and beans, meatless (black beans and white rice)", "fruit"], ["Rice and beans with meat", "fruit"],
  ["Spaghetti bolognese", "fruit"], ["Paella (seafood)", "fruit"], ["Bibimbap", "fruit"], ["Tabbouleh", "fruit"],
  ["Khichdi (rice and mung beans, with ghee)", "fruit"], ["Sandwich (turkey)", "fruit"],
];

const BY_NAME: ReadonlyMap<string, CuratedFood> = new Map(CURATED_FOODS.map((f) => [f.name, f]));
const named = (name: string): CuratedFood => {
  const food = BY_NAME.get(name);
  if (food === undefined) throw new Error(`a suggested food is not on the food list: "${name}"`);
  return food;
};
const pool = (role: Exclude<SuggestRole, "dish">): CuratedFood[] => POOL_NAMES[role].map(named);

/** Every food that may be suggested, by its part. */
export const SUGGEST_POOLS: Readonly<Record<SuggestRole, readonly CuratedFood[]>> = {
  protein: pool("protein"), starch: pool("starch"), bread: pool("bread"), curry_side: pool("curry_side"),
  vegetable: pool("vegetable"), fruit: pool("fruit"), bowl: pool("bowl"), toast: pool("toast"), nuts: pool("nuts"),
  spread: pool("spread"), dish: DISH_NAMES.map(([name]) => named(name)),
};
const DISH_SIDE: ReadonlyMap<string, DishSide> = new Map(DISH_NAMES.map(([name, side]) => [named(name).canonical, side]));

/** The least a day must have left for a meal to be suggested, and the least one idea holds. */
export const LEAST_MEAL_KCAL = 150;
/** No idea is sized past this many usual meals, so a day with nothing logged by
 *  evening is not answered with one huge plate. */
export const MOST_MEAL_SHARE = 1.5;
/** No idea is sized past this: a plate of the list's foods at amounts a person
 *  would serve holds about this much. A day with more left gets more meals. */
export const MOST_MEAL_KCAL = 700;
/** The most meals a reply holds (screen 9 asks for two to six a day). */
export const MOST_MEALS = 6;
/** The most food one idea puts on the table, in grams. */
export const MOST_IDEA_GRAMS = 750;
/** Past this a bowl or toast cannot be made big enough, and a second plate takes its place. */
const MOST_LIGHT_KCAL = 450;
/** Under this a meal is a light one only. */
const LEAST_PLATE_KCAL = 300;
/** How far an idea's calories may be from the meal's, as a share of them. */
export const IDEA_TOLERANCE = 0.2;
/** How many times one shape is drawn for one idea before it is given up. */
const DRAWS = 100;

interface Bounds { step: number; min: number; max: number }

/** A food served by weight, in grams: the least and the most of it in one idea. */
const BY_WEIGHT: Readonly<Record<SuggestRole, readonly [min: number, max: number]>> = {
  protein: [75, 200], starch: [75, 250], curry_side: [75, 250], vegetable: [75, 200], fruit: [100, 150], dish: [150, 400],
  bowl: [100, 250], bread: [25, 75], toast: [25, 75], nuts: [25, 50], spread: [25, 50],
};
/** A counted food (an egg, a slice, a potato, "2 tbsp"): the most of them in one idea. */
const MOST_COUNTED: Readonly<Record<SuggestRole, number>> = {
  protein: 3, starch: 2, curry_side: 2, vegetable: 2, fruit: 1, dish: 2, bowl: 1, bread: 2, toast: 2, nuts: 2, spread: 2,
};

/** The amounts a food may be suggested at, in grams. A food served by weight
 *  moves 25 g at a time; a cup by the half cup, one and a half at most; anything
 *  counted by the whole one. */
function boundsFor(food: CuratedFood, role: SuggestRole): Bounds {
  if (food.unit === "g") {
    const [min, max] = BY_WEIGHT[role];
    return { step: 25, min, max };
  }
  if (food.unit === "cup") return { step: food.serving / 2, min: food.serving / 2, max: 1.5 * food.serving };
  return { step: food.serving, min: food.serving, max: MOST_COUNTED[role] * food.serving };
}

interface Part { food: CuratedFood; role: SuggestRole; bounds: Bounds; grams: number }
type Share = readonly [CuratedFood, SuggestRole, number];

const kcalOf = (food: CuratedFood, grams: number): number => Math.round((food.kcal * grams) / 100);
const round1 = (v: number): number => Math.round(v * 10) / 10;
const partsKcal = (parts: readonly Part[]): number => parts.reduce((n, p) => n + kcalOf(p.food, p.grams), 0);
const partsGrams = (parts: readonly Part[]): number => parts.reduce((n, p) => n + p.grams, 0);

/** Each part at its share of the meal, on a step of its own; then one step at a
 *  time, whichever brings the whole nearest the meal's calories, until none does. */
function sized(shares: readonly Share[], kcalTarget: number): Part[] {
  const parts = shares.map(([food, role, share]): Part => {
    const bounds = boundsFor(food, role);
    const wanted = ((share * kcalTarget) / food.kcal) * 100;
    const stepped = Math.round(wanted / bounds.step) * bounds.step;
    return { food, role, bounds, grams: Math.min(bounds.max, Math.max(bounds.min, stepped)) };
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

export interface DayNumbers {
  mealsPerDay: number;
  /** The day's calories, and how many of them are eaten. */
  kcalTarget: number;
  kcalEaten: number;
  /** The meals logged today; a snack is not one. */
  mealsLogged: number;
}

export interface SuggestInput extends DayNumbers {
  /** What tells one person's ideas from another's on the same day. */
  seed: string;
  /** The person's day, YYYY-MM-DD. */
  day: string;
  diet: Diet;
}

export interface Suggested { kcalLeft: number; meals: SuggestedMeal[] }

/** The three ideas of a meal, by its size. */
export function kindsFor(kcalTarget: number): readonly [MealIdeaKind, MealIdeaKind, MealIdeaKind] {
  if (kcalTarget < LEAST_PLATE_KCAL) return ["light", "light", "light"];
  return kcalTarget > MOST_LIGHT_KCAL ? ["plate", "dish", "plate"] : ["plate", "dish", "light"];
}

/** How many meals are still to come in a day, and the calories of each; none
 *  once under LEAST_MEAL_KCAL is left. */
export function mealSizes(day: DayNumbers): { kcalLeft: number; count: number; kcalTarget: number } {
  const kcalLeft = Math.round(day.kcalTarget - day.kcalEaten);
  if (kcalLeft < LEAST_MEAL_KCAL) return { kcalLeft, count: 0, kcalTarget: 0 };
  const usual = day.kcalTarget / day.mealsPerDay;
  const stillToEat = Math.max(1, day.mealsPerDay - day.mealsLogged);
  const most = Math.min(usual * MOST_MEAL_SHARE, MOST_MEAL_KCAL);
  const count = Math.min(MOST_MEALS, Math.max(1, Math.min(stillToEat, Math.floor(kcalLeft / LEAST_MEAL_KCAL)), Math.ceil(kcalLeft / MOST_MEAL_KCAL)));
  return { kcalLeft, count, kcalTarget: Math.round(Math.min(kcalLeft / count, most)) };
}

/** Makes one reply's ideas, one at a time: `wanted` sized to `kcalTarget`, of
 *  foods the diet allows. An idea is within IDEA_TOLERANCE of its calories, holds
 *  MOST_IDEA_GRAMS of food at most, and is in the reply once; null where none can
 *  be made so. The same seed gives the same ideas in the same order. */
function ideaMaker(seed: string, diet: Diet): (kcalTarget: number, wanted: MealIdeaKind) => MealIdea | null {
  const next = drawer(hash(seed));
  const allowed = (role: SuggestRole): CuratedFood[] => SUGGEST_POOLS[role].filter((f) => dietAllows(diet, f.diet));
  /** The foods already in an idea of this reply. */
  const used = new Set<string>();
  /** Whether a draw keeps to foods not yet in the reply. */
  let freshOnly = true;
  /** One of the role's foods: one not yet in the reply while any is left, unless
   *  the draws so far found none of those that fits. */
  const pick = (role: SuggestRole): CuratedFood => {
    const all = allowed(role);
    const fresh = freshOnly ? all.filter((f) => !used.has(f.canonical)) : [];
    const from = fresh.length > 0 ? fresh : all;
    const food = from[Math.floor(next() * from.length)];
    if (food === undefined) throw new Error(`no ${role} to suggest for the diet "${diet}"`);
    return food;
  };
  /** The ideas already in the reply, each by its foods and amounts. */
  const given = new Set<string>();
  const keyOf = (parts: readonly Part[]): string => parts.map((p) => `${p.food.canonical}:${String(p.grams)}`).sort().join("|");

  return (kcalTarget, wanted) => {
    const size = (...shares: Share[]): Part[] => sized(shares, kcalTarget);
    const plate = (): Part[] => size([pick("protein"), "protein", 0.42], [pick("starch"), "starch", 0.48], [pick("vegetable"), "vegetable", 0.1]);
    const dish = (): Part[] => {
      const main = pick("dish");
      const side = DISH_SIDE.get(main.canonical) ?? "fruit";
      return side === "fruit"
        ? size([main, "dish", 0.85], [pick("fruit"), "fruit", 0.15])
        : size([main, "dish", side === "bread" ? 0.6 : 0.55], [pick(side), side, side === "bread" ? 0.4 : 0.45]);
    };
    const light = (): Part[] =>
      next() < 0.5
        ? size([pick("bowl"), "bowl", 0.4], [pick("fruit"), "fruit", 0.25], [pick("nuts"), "nuts", 0.35])
        : size([pick("toast"), "toast", 0.4], [pick("fruit"), "fruit", 0.25], [pick("spread"), "spread", 0.35]);
    /** A small meal: a bowl with fruit, fruit with nuts or seeds, or toast with a spread. */
    const snack = (): Part[] => {
      const form = next();
      if (form < 1 / 3) return size([pick("bowl"), "bowl", 0.6], [pick("fruit"), "fruit", 0.4]);
      if (form < 2 / 3) return size([pick("fruit"), "fruit", 0.4], [pick("nuts"), "nuts", 0.6]);
      return size([pick("toast"), "toast", 0.45], [pick("spread"), "spread", 0.55]);
    };
    const shapes: Readonly<Record<MealIdeaKind, () => Part[]>> = { plate, dish, light: kcalTarget < LEAST_PLATE_KCAL ? snack : light };
    const fits = (parts: readonly Part[]): boolean =>
      Math.abs(partsKcal(parts) - kcalTarget) <= kcalTarget * IDEA_TOLERANCE && partsGrams(parts) <= MOST_IDEA_GRAMS && !given.has(keyOf(parts));

    // The shape drawn again until its foods can be sized to the meal. Where no
    // dish or bowl of the diet can be (a vegan's big meal), a plate takes its place.
    for (const kind of kcalTarget < LEAST_PLATE_KCAL || wanted === "plate" ? [wanted] : [wanted, "plate"] as const) {
      freshOnly = true;
      let parts = shapes[kind]();
      for (let tries = 0; tries < DRAWS && !fits(parts); tries++) {
        freshOnly = tries < DRAWS / 4;
        parts = shapes[kind]();
      }
      if (!fits(parts)) continue;
      given.add(keyOf(parts));
      for (const part of parts) used.add(part.food.canonical);
      return toIdea(kind, parts);
    }
    return null;
  };
}

/** The ideas for each meal still to come today; none once under LEAST_MEAL_KCAL is left.
 *  An idea that cannot be made to its meal's calories is left out. */
export function suggestMeals(input: SuggestInput): Suggested {
  const { kcalLeft, count, kcalTarget } = mealSizes(input);
  const make = ideaMaker(`${input.seed}|${input.day}`, input.diet);
  const meals: SuggestedMeal[] = [];
  for (let m = 0; m < count; m++) {
    const ideas: MealIdea[] = [];
    for (const wanted of kindsFor(kcalTarget)) {
      const idea = make(kcalTarget, wanted);
      if (idea !== null) ideas.push(idea);
    }
    meals.push({ kcalTarget, ideas });
  }
  return { kcalLeft, meals };
}

// ── after a workout (ROADMAP 34d-ii) ─────────────────────────────────────────

/** Something small soon after the workout: bigger after a harder one. The
 *  thresholds are the old card's (over 400 kcal burned, over 200). */
const SOON_KCAL = { high: 250, middle: 200, low: 150 } as const;
/** The meal after it, for somebody whose day has no calorie number yet. */
const MEAL_KCAL_WITHOUT_A_PLAN = { high: 600, middle: 450, low: 300 } as const;

export interface AfterWorkoutInput {
  /** What tells one workout's ideas from another's. */
  seed: string;
  diet: Diet;
  kcalBurned: number | null;
  /** The day the workout is in: as it stands for today's, with nothing eaten for
   *  an earlier day's; null where the person has no calorie number yet. */
  day: DayNumbers | null;
}
export type AfterWorkoutWhen = "soon" | "meal";
export interface AfterWorkoutIdea { when: AfterWorkoutWhen; kcalTarget: number; idea: MealIdea }

/** What to eat after a workout: something small soon, then a meal, both out of
 *  what the day has left, so the two are never sized past it. None once under
 *  LEAST_MEAL_KCAL is left. The same workout gets the same ideas. */
export function suggestAfterWorkout(input: AfterWorkoutInput): AfterWorkoutIdea[] {
  const burned = input.kcalBurned ?? 0;
  const band = burned > 400 ? "high" : burned > 200 ? "middle" : "low";
  let soonKcal: number = SOON_KCAL[band];
  let mealKcal: number = MEAL_KCAL_WITHOUT_A_PLAN[band];
  if (input.day !== null) {
    const sizes = mealSizes(input.day);
    if (sizes.count === 0) return [];
    soonKcal = Math.min(soonKcal, sizes.kcalLeft);
    mealKcal = Math.min(sizes.kcalTarget, sizes.kcalLeft - soonKcal);
  }
  const make = ideaMaker(input.seed, input.diet);
  const wanted: readonly (readonly [AfterWorkoutWhen, number, MealIdeaKind])[] = [
    ["soon", soonKcal, "light"],
    ["meal", mealKcal, mealKcal < LEAST_PLATE_KCAL ? "light" : hash(input.seed) % 2 === 0 ? "plate" : "dish"],
  ];
  const out: AfterWorkoutIdea[] = [];
  for (const [when, kcalTarget, kind] of wanted) {
    if (kcalTarget < LEAST_MEAL_KCAL) continue;
    const idea = make(kcalTarget, kind);
    if (idea !== null) out.push({ when, kcalTarget, idea });
  }
  return out;
}
