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
import { dietAllows, mealTypeAtHour, type Diet, type MealIdea, type MealIdeaKind, type MealType, type SuggestedFood, type SuggestedMeal } from "@app/shared";
import { CURATED_FOODS, type CuratedFood } from "./foods.js";

export type SuggestRole =
  | "protein" | "starch" | "bread" | "curry_side" | "vegetable" | "fruit" | "bowl" | "toast" | "nuts" | "spread" | "eggs" | "milk" | "dish";

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
  // Oats are eaten cooked with milk (Kd, 2026-11-02); soy milk for a vegan.
  milk: ["Milk (2%)", "Soy milk"],
  // Breakfast eggs, with toast and fruit.
  eggs: ["Eggs (scrambled)", "Egg (hard-boiled)", "Omelette (plain)"],
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
  spread: pool("spread"), eggs: pool("eggs"), milk: pool("milk"), dish: DISH_NAMES.map(([name]) => named(name)),
};
const OATS = named("Oatmeal (cooked)").canonical;

/** Total sugars per 100 g of the suggested foods that may hold added sugar (bread, spreads,
 *  dishes, soy milk), from USDA's own table, read 2026-11-03. Total sugars are never less than
 *  the added ones, so an idea held under the limit by these is under it by its added sugars.
 *  Fruit, vegetables, plain milk, plain yogurt, grains, beans, nuts, meat, fish and eggs hold
 *  only their own sugars, which the Dietary Guidelines do not count as added. The three home
 *  dishes cited from the UK's table (chana masala, khichdi, tandoori chicken) and roti hold
 *  no sugar in their recipes and are not in USDA's table. */
const SUGARS: readonly (readonly [name: string, gramsPer100g: number])[] = [
  ["Almond butter", 4.43], ["Beef and broccoli", 1.23], ["Beef stew", 1.57], ["Bibimbap", 1.52],
  ["Caesar salad (with chicken, no dressing)", 0.99], ["Chicken curry", 2.56], ["Chicken noodle soup", 0.81],
  ["Chicken stir-fry (with vegetables)", 2.93], ["Chili con carne", 1.48], ["Cobb salad (no dressing)", 1.1],
  ["Dal (lentil curry)", 1.71], ["French bread / sourdough", 4.62], ["Hummus", 0.62], ["Lentil soup", 1.72],
  ["Minestrone", 1.04], ["Paella (seafood)", 0.92], ["Palak paneer (spinach and cheese curry)", 1.89],
  ["Peanut butter", 10.49], ["Ratatouille", 3.39], ["Rice and beans with meat", 0.25],
  ["Rice and beans, meatless (black beans and white rice)", 0.2], ["Rye bread", 3.85],
  ["Sambar (lentil and vegetable stew)", 1.97], ["Sandwich (turkey)", 3.2], ["Soy milk", 0.41],
  ["Spaghetti bolognese", 2.44], ["Tabbouleh", 1.34], ["Teriyaki chicken", 1.47], ["Tomato soup", 4.16],
  ["Vegetable curry", 3.18], ["Whole wheat bread", 4.34],
];
const SUGARS_PER_100G: ReadonlyMap<string, number> = new Map(SUGARS.map(([name, g]) => [named(name).canonical, g]));
/** Where a person is, as far as their food goes (Kd, 2026-11-03): India, where beef and pork
 *  are not suggested; the US, Canada, Europe, Australia and New Zealand, where Indian dishes
 *  are not; anywhere else, or not known, nothing taken away. */
export type FoodRegion = "india" | "west" | "other";
const WEST_PREFIXES = ["Europe/", "Australia/", "US/", "Canada/", "America/Indiana/", "America/Kentucky/", "America/North_Dakota/"];
const WEST_ZONES = new Set([
  "Pacific/Honolulu", "Pacific/Auckland", "Pacific/Chatham", "NZ", "NZ-CHAT", "GB", "Eire",
  "Atlantic/Reykjavik", "Atlantic/Canary", "Atlantic/Madeira", "Atlantic/Faroe", "Atlantic/Azores",
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage",
  "America/Adak", "America/Boise", "America/Detroit", "America/Juneau", "America/Sitka", "America/Yakutat", "America/Nome",
  "America/Metlakatla", "America/Menominee", "America/Indianapolis", "America/Louisville",
  "America/Toronto", "America/Vancouver", "America/Edmonton", "America/Winnipeg", "America/Halifax", "America/St_Johns",
  "America/Regina", "America/Moncton", "America/Glace_Bay", "America/Goose_Bay", "America/Whitehorse", "America/Dawson",
  "America/Dawson_Creek", "America/Fort_Nelson", "America/Creston", "America/Iqaluit", "America/Rankin_Inlet",
  "America/Resolute", "America/Cambridge_Bay", "America/Inuvik", "America/Swift_Current", "America/Atikokan",
  "America/Blanc-Sablon", "America/Thunder_Bay", "America/Nipigon", "America/Rainy_River", "America/Yellowknife",
  "America/Pangnirtung", "America/Montreal",
]);
/** The person's region from their time zone, the one place the app keeps where they are. */
export function regionOf(timeZone: string | null): FoodRegion {
  if (timeZone === null) return "other";
  if (timeZone === "Asia/Kolkata" || timeZone === "Asia/Calcutta") return "india";
  if (WEST_ZONES.has(timeZone) || WEST_PREFIXES.some((p) => timeZone.startsWith(p))) return "west";
  return "other";
}
/** The suggested foods that hold beef or pork by their own table's words (counted 2026-11-03). */
const BEEF_OR_PORK = [
  "Steak (sirloin, cooked)", "Pork tenderloin (cooked)", "Ground beef 90% (cooked)", "Cobb salad (no dressing)", "Chili con carne",
  "Beef stew", "Beef and broccoli", "Rice and beans with meat", "Spaghetti bolognese", "Paella (seafood)", "Bibimbap",
];
const INDIAN_DISHES = [
  "Dal (lentil curry)", "Chana masala (chickpea curry)", "Chicken curry", "Vegetable curry", "Palak paneer (spinach and cheese curry)",
  "Sambar (lentil and vegetable stew)", "Tandoori chicken", "Khichdi (rice and mung beans, with ghee)", "Roti / Chapati (homemade flatbread, no fat)",
];
const NOT_IN: Readonly<Record<FoodRegion, ReadonlySet<string>>> = {
  india: new Set(BEEF_OR_PORK.map((n) => named(n).canonical)),
  west: new Set(INDIAN_DISHES.map((n) => named(n).canonical)),
  other: new Set(),
};
/** Whether a food may be suggested to somebody in the region. */
export const regionAllows = (region: FoodRegion, canonical: string): boolean => !NOT_IN[region].has(canonical);

/** The Dietary Guidelines for Americans 2025–2030, p. 4: "one meal should contain no more
 *  than 10 grams of added sugars." */
export const MOST_MEAL_ADDED_SUGAR_G = 10;
/** The most added sugar an idea can hold, in grams. */
export const addedSugarAtMost = (items: readonly { canonical: string; grams: number }[]): number =>
  items.reduce((n, i) => n + ((SUGARS_PER_100G.get(i.canonical) ?? 0) * i.grams) / 100, 0);

/** The protein one meal is drawn for, in grams. */
export interface ProteinAim { leastG: number; aimG: number; mostG: number; withCarbs: boolean }
/** ISSN 2017 (Jäger): at least 0.25 g of protein per kg of body weight a meal. */
export const LEAST_MEAL_PROTEIN_PER_KG = 0.25;
/** Schoenfeld and Aragon, JISSN 2018: 0.4 g/kg a meal, 0.55 at the most. */
export const AIM_MEAL_PROTEIN_PER_KG = 0.4;
export const MOST_MEAL_PROTEIN_PER_KG = 0.55;
/** Thomas, Erdman and Burke 2016: about 0.3 g/kg after exercise, with carbohydrate. */
export const AFTER_WORKOUT_PROTEIN_PER_KG = 0.3;
/** Within this long of a workout's end, the next meal is the meal after it. */
export const AFTER_WORKOUT_MS = 2 * 60 * 60 * 1000;

/** A meal's protein: its share of what the day has left, never under the least a meal
 *  holds nor over the most. With no share (no day's number), aimed at 0.4 g/kg; the meal after
 *  a workout at about 0.3 g/kg, with carbohydrate. A snack
 *  in the week is not a meal, and has no least. */
export function proteinAim(weightKg: number, shareG: number | null, opts: { afterWorkout?: boolean; snack?: boolean } = {}): ProteinAim {
  const least = opts.snack === true ? 0 : LEAST_MEAL_PROTEIN_PER_KG * weightKg;
  const most = MOST_MEAL_PROTEIN_PER_KG * weightKg;
  const wanted = opts.afterWorkout === true
    ? AFTER_WORKOUT_PROTEIN_PER_KG * weightKg
    : shareG ?? AIM_MEAL_PROTEIN_PER_KG * weightKg;
  return { leastG: least, aimG: Math.min(most, Math.max(least, wanted)), mostG: most, withCarbs: opts.afterWorkout === true };
}

/** How far an idea is from its protein: under the least or over the most weighs ten times. */
function proteinMiss(proteinG: number, carbsG: number, aim: ProteinAim): number {
  const out = Math.max(0, aim.leastG - proteinG) + Math.max(0, proteinG - aim.mostG) + (aim.withCarbs ? Math.max(0, proteinG - carbsG) : 0);
  return 10 * out + Math.abs(proteinG - aim.aimG);
}
/** An idea within this share under its aim is near enough to take at once. */
const NEAR_AIM = 0.1;
const proteinMet = (proteinG: number, carbsG: number, aim: ProteinAim): boolean =>
  proteinG >= Math.max(aim.leastG, aim.aimG * (1 - NEAR_AIM)) - 0.05 && proteinG <= aim.mostG + 0.05 && (!aim.withCarbs || carbsG >= proteinG);
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
export const MOST_LIGHT_KCAL = 450;
/** Under this a meal is a light one only. */
const LEAST_PLATE_KCAL = 300;
/** How far an idea's calories may be from the meal's, as a share of them. */
export const IDEA_TOLERANCE = 0.2;
/** How many times one shape is drawn for one idea before it is given up. */
const DRAWS = 100;
/** How a week is drawn. It draws ideas for every meal of seven days, a dozen times a day, so
 *  there, once `staleDraws` drawn ideas that fit come one after another no nearer the protein,
 *  the best is kept, and the calories move half as far for protein so the day lands near its
 *  own and is not drawn again. The day's ideas draw them all. */
export const WEEK_DRAWING = { staleDraws: 6, kcalRoom: IDEA_TOLERANCE / 4 } as const;

interface Bounds { step: number; min: number; max: number }

/** A food served by weight, in grams: the least and the most of it in one idea. */
const BY_WEIGHT: Readonly<Record<SuggestRole, readonly [min: number, max: number]>> = {
  protein: [75, 200], starch: [75, 250], curry_side: [75, 250], vegetable: [75, 200], fruit: [100, 150], dish: [150, 400],
  bowl: [100, 250], bread: [25, 75], toast: [25, 75], nuts: [25, 50], spread: [25, 50], eggs: [50, 150], milk: [120, 240],
};
/** A counted food (an egg, a slice, a potato, "2 tbsp"): the most of them in one idea. */
const MOST_COUNTED: Readonly<Record<SuggestRole, number>> = {
  protein: 3, starch: 2, curry_side: 2, vegetable: 2, fruit: 1, dish: 2, bowl: 1, bread: 2, toast: 2, nuts: 2, spread: 2, eggs: 3, milk: 1,
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
function sized(shares: readonly Share[], kcalTarget: number, protein?: ProteinAim, kcalRoom: number = PROTEIN_KCAL_ROOM): Part[] {
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
  if (protein !== undefined) towardProtein(parts, kcalTarget, protein, kcalRoom);
  return parts;
}

/** How far the calories may move from the meal's while an idea is brought to its protein:
 *  a quarter of what an idea may be off by, so the protein never costs the calories, and a week's
 *  days still land near theirs. */
const PROTEIN_KCAL_ROOM = IDEA_TOLERANCE / 2;
const partsProtein = (parts: readonly Part[]): number => parts.reduce((n, p) => n + (p.food.proteinG * p.grams) / 100, 0);
const partsCarbs = (parts: readonly Part[]): number => parts.reduce((n, p) => n + (p.food.carbsG * p.grams) / 100, 0);

/** One step of one part, or one up and another down, at a time, whichever brings the idea
 *  nearest its protein while its calories stay within `kcalRoom` of the meal's. */
function towardProtein(parts: Part[], kcalTarget: number, aim: ProteinAim, kcalRoom: number): void {
  type Move = readonly (readonly [Part, number])[];
  const can = (p: Part, grams: number): boolean => grams >= p.bounds.min - 1e-9 && grams <= p.bounds.max + 1e-9;
  /** The idea's miss after the moves, or null where they leave its calories out of room. */
  const after = (moves: Move): number | null => {
    const was = moves.map(([p]) => p.grams);
    for (const [p, g] of moves) p.grams = g;
    const kcalOk = Math.abs(partsKcal(parts) - kcalTarget) <= kcalTarget * kcalRoom;
    const miss = proteinMiss(partsProtein(parts), partsCarbs(parts), aim);
    moves.forEach(([p], i) => { p.grams = was[i] ?? p.grams; });
    return kcalOk ? miss : null;
  };
  for (let round = 0; round < 40; round++) {
    const now = proteinMiss(partsProtein(parts), partsCarbs(parts), aim);
    let best: Move | null = null;
    let bestMiss = now - 1e-6;
    for (const move of movesNow(parts)) {
      if (!move.every(([p, g]) => can(p, g))) continue;
      const miss = after(move);
      if (miss !== null && miss < bestMiss) { best = move; bestMiss = miss; }
    }
    if (best === null) break;
    for (const [p, g] of best) p.grams = g;
  }
}

/** Every move of one step from where the parts stand now. */
function movesNow(parts: readonly Part[]): (readonly (readonly [Part, number])[])[] {
  const out: (readonly (readonly [Part, number])[])[] = [];
  for (const a of parts) {
    for (const da of [-1, 1]) {
      out.push([[a, a.grams + da * a.bounds.step]]);
      for (const b of parts) if (b !== a) out.push([[a, a.grams + da * a.bounds.step], [b, b.grams - da * b.bounds.step]]);
    }
  }
  return out;
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
export function hash(text: string): number {
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

/** What the meal ideas know of the person for their protein (31d). */
export interface ProteinNumbers {
  weightKg: number;
  /** The day's protein; null where the day has no number for it. */
  dayTargetG: number | null;
  /** The protein logged today. */
  eatenG: number;
}

export interface SuggestInput extends DayNumbers {
  /** What tells one person's ideas from another's on the same day. */
  seed: string;
  /** The person's day, YYYY-MM-DD. */
  day: string;
  diet: Diet;
  /** Absent: the ideas are drawn for calories alone. */
  protein?: ProteinNumbers;
  /** The hour of the person's own clock, 0–23, which says which meal is next. */
  hour?: number;
  /** A workout of the person's ended within AFTER_WORKOUT_MS: the next meal is the meal after it. */
  afterWorkout?: boolean;
  /** Where the person is (`regionOf`); absent, nothing is taken away. */
  region?: FoodRegion;
}

export interface Suggested { kcalLeft: number; meals: SuggestedMeal[] }

/** The meals of a day by how many there are (screen 9 asks for two to six). */
export const MEAL_LAYOUT: Readonly<Record<number, readonly MealType[]>> = {
  2: ["lunch", "dinner"],
  3: ["breakfast", "lunch", "dinner"],
  4: ["breakfast", "lunch", "snack", "dinner"],
  5: ["breakfast", "snack", "lunch", "snack", "dinner"],
  6: ["breakfast", "snack", "lunch", "snack", "dinner", "snack"],
};

/** The meals still to come: the next is the meal of the hour (a snack's hours before dinner
 *  are dinner's), or the meal after those already logged where that is later; then the
 *  person's own day after it; past its end, dinner. */
export function mealsAhead(mealsPerDay: number, hour: number, count: number, mealsLogged = 0): MealType[] {
  const layout = MEAL_LAYOUT[Math.min(Math.max(mealsPerDay, 2), MOST_MEALS)] ?? [];
  const now = mealTypeAtHour(hour);
  // Before 4 am the meal is the night's dinner, as the phone logs it (ideaRules.ts).
  const next: MealType = hour < 4 || now === "snack" ? "dinner" : now;
  const order: Readonly<Record<MealType, number>> = { breakfast: 0, lunch: 1, snack: 1.5, dinner: 2 };
  const byHour = layout.findIndex((t) => t !== "snack" && order[t] >= order[next]);
  const meals = layout.flatMap((t, at) => (t === "snack" ? [] : [at]));
  const byLogged = meals[mealsLogged] ?? -1;
  const from = byHour < 0 || byLogged < 0 ? -1 : Math.max(byHour, byLogged);
  const rest = from < 0 ? [] : layout.slice(from);
  return Array.from({ length: count }, (_, i): MealType => rest[i] ?? "dinner");
}

/** The three ideas of a meal, by its size and, where known, its time: breakfast and a snack
 *  are a bowl, toast or eggs; lunch and dinner a plate or a dish (spec Part 6 §16.6). */
export function kindsFor(kcalTarget: number, mealType?: MealType): readonly [MealIdeaKind, MealIdeaKind, MealIdeaKind] {
  if (kcalTarget < LEAST_PLATE_KCAL) return ["light", "light", "light"];
  if (mealType === "breakfast" || mealType === "snack") return ["light", "light", "light"];
  if (mealType !== undefined) return ["plate", "dish", "plate"];
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
 *  no more than `mostKcal` and MOST_IDEA_GRAMS of food, and is in the reply once;
 *  null where none can be made so. The same seed gives the same ideas in the same order.
 *  Foods `avoid` names are drawn only once no other fits. */
export function ideaMaker(
  seed: string,
  diet: Diet,
  avoid: Iterable<string> = [],
  region: FoodRegion = "other",
  drawing: { staleDraws: number; kcalRoom: number } = { staleDraws: Infinity, kcalRoom: PROTEIN_KCAL_ROOM },
): (kcalTarget: number, wanted: MealIdeaKind, mostKcal?: number, leastKcal?: number, protein?: ProteinAim) => MealIdea | null {
  const next = drawer(hash(seed));
  const allowed = (role: SuggestRole): CuratedFood[] => SUGGEST_POOLS[role].filter((f) => dietAllows(diet, f.diet) && regionAllows(region, f.canonical));
  /** The foods already in an idea of this reply, and those `avoid` names (a meal being swapped). */
  const used = new Set<string>(avoid);
  /** The foods of a meal being swapped: an idea holding one is taken only where no other fits. */
  const swappedOut = new Set<string>(used);
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

  return (kcalTarget, wanted, mostKcal = Infinity, leastKcal = 0, protein) => {
    const size = (...shares: Share[]): Part[] => sized(shares, kcalTarget, protein, drawing.kcalRoom);
    /** A bowl; oats with milk beside them (Kd, 2026-11-02: oats are "mixed with milk"). */
    const bowl = (bowlShare: number, ...rest: Share[]): Part[] => {
      const base = pick("bowl");
      return base.canonical === OATS
        ? size([base, "bowl", bowlShare * 0.65], [pick("milk"), "milk", bowlShare * 0.35], ...rest)
        : size([base, "bowl", bowlShare], ...rest);
    };
    const plate = (): Part[] => size([pick("protein"), "protein", 0.42], [pick("starch"), "starch", 0.48], [pick("vegetable"), "vegetable", 0.1]);
    const dish = (): Part[] => {
      const main = pick("dish");
      const side = DISH_SIDE.get(main.canonical) ?? "fruit";
      return side === "fruit"
        ? size([main, "dish", 0.85], [pick("fruit"), "fruit", 0.15])
        : size([main, "dish", side === "bread" ? 0.6 : 0.55], [pick(side), side, side === "bread" ? 0.4 : 0.45]);
    };
    /** A bowl with fruit and nuts, toast with fruit and a spread, or eggs with toast and fruit. */
    const light = (): Part[] => {
      const forms = allowed("eggs").length > 0 ? 3 : 2;
      const form = Math.floor(next() * forms);
      if (form === 0) return bowl(0.4, [pick("fruit"), "fruit", 0.25], [pick("nuts"), "nuts", 0.35]);
      if (form === 1) return size([pick("toast"), "toast", 0.4], [pick("fruit"), "fruit", 0.25], [pick("spread"), "spread", 0.35]);
      return size([pick("eggs"), "eggs", 0.5], [pick("toast"), "toast", 0.3], [pick("fruit"), "fruit", 0.2]);
    };
    /** A small meal: a bowl with fruit, fruit with nuts or seeds, or toast with a spread. */
    const snack = (): Part[] => {
      const form = next();
      if (form < 1 / 3) {
        // A small bowl of oats is oats and milk.
        const base = pick("bowl");
        return base.canonical === OATS
          ? size([base, "bowl", 0.65], [pick("milk"), "milk", 0.35])
          : size([base, "bowl", 0.6], [pick("fruit"), "fruit", 0.4]);
      }
      if (form < 2 / 3) return size([pick("fruit"), "fruit", 0.4], [pick("nuts"), "nuts", 0.6]);
      return size([pick("toast"), "toast", 0.45], [pick("spread"), "spread", 0.55]);
    };
    const shapes: Readonly<Record<MealIdeaKind, () => Part[]>> = { plate, dish, light: kcalTarget < LEAST_PLATE_KCAL ? snack : light };
    const fits = (parts: readonly Part[]): boolean =>
      Math.abs(partsKcal(parts) - kcalTarget) <= kcalTarget * IDEA_TOLERANCE && partsKcal(parts) <= mostKcal && partsKcal(parts) >= leastKcal
      && partsGrams(parts) <= MOST_IDEA_GRAMS && !given.has(keyOf(parts))
      && addedSugarAtMost(parts.map((p) => ({ canonical: p.food.canonical, grams: p.grams }))) <= MOST_MEAL_ADDED_SUGAR_G;
    const met = (parts: readonly Part[]): boolean => protein === undefined || proteinMet(partsProtein(parts), partsCarbs(parts), protein);
    const missOf = (parts: readonly Part[]): number =>
      (protein === undefined ? 0 : proteinMiss(partsProtein(parts), partsCarbs(parts), protein)) + (parts.some((p) => swappedOut.has(p.food.canonical)) ? 1e6 : 0);

    // The shape drawn again until its foods can be sized to the meal. Where no
    // dish or bowl of the diet can be (a vegan's big meal), a plate takes its place.
    // An idea at its calories that meets its protein is taken at once; where none of the
    // draws does, the one nearest its protein (spec Part 6 §16.6: the most protein the
    // diet's foods can reach at the meal's calories).
    // A dish that cannot reach the meal's least protein gives way to a plate that can; a breakfast stays a breakfast.
    const reachesLeast = (parts: readonly Part[]): boolean => protein === undefined || partsProtein(parts) >= protein.leastG - 0.05;
    let chosen: { kind: MealIdeaKind; parts: Part[] } | null = null;
    for (const kind of kcalTarget < LEAST_PLATE_KCAL || wanted === "plate" ? [wanted] : [wanted, "plate"] as const) {
      let best: Part[] | null = null;
      // Draws that fit without coming nearer the protein than the best so far; past `drawing.staleDraws`
      // of them the best is kept, so a meal the foods cannot reach costs a few draws, not all.
      let stale = 0;
      for (let tries = 0; tries <= DRAWS && stale < drawing.staleDraws; tries++) {
        freshOnly = tries < DRAWS / 4;
        const parts = shapes[kind]();
        if (!fits(parts)) continue;
        if (best === null || missOf(parts) < missOf(best)) {
          best = parts;
          stale = 0;
        } else stale++;
        if (met(parts) && !parts.some((p) => swappedOut.has(p.food.canonical))) break;
      }
      if (best === null) continue;
      if (chosen === null || missOf(best) < missOf(chosen.parts)) chosen = { kind, parts: best };
      if (wanted !== "dish" || reachesLeast(best)) break;
    }
    if (chosen === null) return null;
    given.add(keyOf(chosen.parts));
    for (const part of chosen.parts) used.add(part.food.canonical);
    return toIdea(chosen.kind, chosen.parts);
  };
}

/** The ideas for each meal still to come today; none once under LEAST_MEAL_KCAL is left.
 *  An idea that cannot be made to its meal's calories is left out. */
export function suggestMeals(input: SuggestInput): Suggested {
  const { kcalLeft, count, kcalTarget } = mealSizes(input);
  const make = ideaMaker(`${input.seed}|${input.day}`, input.diet, [], input.region);
  const types = input.hour === undefined ? null : mealsAhead(input.mealsPerDay, input.hour, count, input.mealsLogged);
  const p = input.protein;
  // The day's protein still to eat, shared across the meals still to come (spec Part 6 §16.6, 1 and 2).
  const shareG = p === undefined || p.dayTargetG === null ? null : Math.max(0, p.dayTargetG - p.eatenG) / Math.max(1, count);
  const meals: SuggestedMeal[] = [];
  for (let m = 0; m < count; m++) {
    const ideas: MealIdea[] = [];
    const aim = p === undefined ? undefined : proteinAim(p.weightKg, shareG, { afterWorkout: m === 0 && input.afterWorkout === true });
    for (const wanted of kindsFor(kcalTarget, types?.[m])) {
      // Under the least a meal holds, a logged idea would not count as a meal, and would be offered again.
      const idea = make(kcalTarget, wanted, Infinity, LEAST_MEAL_KCAL, aim);
      if (idea !== null) ideas.push(idea);
    }
    if (ideas.length > 0) meals.push({ kcalTarget, ideas });
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
  /** The person's weight, for the protein after the workout; null where not known. */
  weightKg: number | null;
  region?: FoodRegion;
}
export type AfterWorkoutWhen = "soon" | "meal";
export interface AfterWorkoutIdea { when: AfterWorkoutWhen; kcalTarget: number; idea: MealIdea }

/** What to eat after a workout: something small soon, then a meal, both out of
 *  what the day has left: the two ideas' food together never holds more. None
 *  once under LEAST_MEAL_KCAL is left. The same workout on the same day's
 *  numbers gets the same ideas; a meal logged since changes them. */
export function suggestAfterWorkout(input: AfterWorkoutInput): AfterWorkoutIdea[] {
  const burned = input.kcalBurned ?? 0;
  const band = burned > 400 ? "high" : burned > 200 ? "middle" : "low";
  const sizes = input.day === null ? null : mealSizes(input.day);
  if (sizes !== null && sizes.count === 0) return [];
  /** What the day has left for the ideas still to make. */
  let room = sizes === null ? Infinity : sizes.kcalLeft;
  const make = ideaMaker(input.seed, input.diet, [], input.region);
  const out: AfterWorkoutIdea[] = [];
  const add = (when: AfterWorkoutWhen, kcalTarget: number, kind: MealIdeaKind): void => {
    if (kcalTarget < LEAST_MEAL_KCAL) return;
    const aim = input.weightKg === null ? undefined : proteinAim(input.weightKg, null, { afterWorkout: true });
    const idea = make(kcalTarget, kind, room, 0, aim);
    if (idea === null) return;
    room -= idea.totals.kcal;
    out.push({ when, kcalTarget, idea });
  };
  add("soon", Math.min(SOON_KCAL[band], room), "light");
  // The meal is sized to what the small idea's own food left, so the two never hold more than the day.
  const mealKcal = sizes === null ? MEAL_KCAL_WITHOUT_A_PLAN[band] : Math.min(sizes.kcalTarget, room);
  add("meal", mealKcal, mealKcal < LEAST_PLATE_KCAL ? "light" : hash(input.seed) % 2 === 0 ? "plate" : "dish");
  return out;
}
