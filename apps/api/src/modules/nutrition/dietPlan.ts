// A person's own diet plan (ROADMAP 34e-i): the week the app makes, and another idea
// for one meal of it. Pure: the same person, change and numbers in give the same plan
// out. Every meal is an idea of the meal ideas' own rule (`ideaMaker`), so the foods,
// the diet rule and the amounts are the same as theirs.
import { MOST_PLAN_MEALS, type Diet, type MealIdea, type MealIdeaKind, type MealType } from "@app/shared";
import { LEAST_MEAL_KCAL, MEAL_LAYOUT, MOST_LIGHT_KCAL, MOST_MEALS, MOST_MEAL_KCAL, hash, ideaMaker, proteinAim, type FoodRegion, type ProteinAim } from "./suggest.js";

/** Each meal's share of the day, by its kind. */
const WEIGHT: Readonly<Record<MealType, number>> = { breakfast: 3, lunch: 4, dinner: 4, snack: 1.5 };
/** The most one meal of the plan holds: breakfast and a snack are a bowl, toast or
 *  fruit with nuts, which cannot be made bigger than this. */
const MOST: Readonly<Record<MealType, number>> = {
  breakfast: MOST_LIGHT_KCAL, snack: MOST_LIGHT_KCAL, lunch: MOST_MEAL_KCAL, dinner: MOST_MEAL_KCAL,
};
/** How many times a day is drawn again to bring it nearer its calories. */
const DAY_DRAWS = 12;
/** Each meal is sized this share over its calories, so most drawn days reach the day's
 *  (an idea may come out a fifth either side of its own). */
const AIM_OVER = 1.04;
/** A drawn day at its calories and no more than this share over them is kept at once. */
const NEAR_ENOUGH = 0.03;

export interface PlanSlot { mealType: MealType; kcal: number }

/** Each meal's calories: shared by WEIGHT, none past its MOST nor under LEAST_MEAL_KCAL.
 *  Where the person's meals cannot hold the day, snacks are added after them, up to
 *  `mostMeals`; past what those can hold the day is left short, and its reply says by how much. */
export function planSlots(mealsPerDay: number, kcalTarget: number, mostMeals: number = MOST_MEALS): PlanSlot[] {
  const own = MEAL_LAYOUT[Math.min(Math.max(mealsPerDay, 2), MOST_MEALS)] ?? [];
  let slots: PlanSlot[] = [];
  for (let extra = 0; own.length + extra <= mostMeals; extra++) {
    slots = shared([...own, ...Array.from({ length: extra }, (): MealType => "snack")], kcalTarget);
    // Each meal is rounded on its own, so a day that holds its calories may read up to half a calorie a meal short.
    if (slots.reduce((n, s) => n + s.kcal, 0) >= kcalTarget - slots.length / 2) break;
  }
  return slots;
}

/** The day shared out by weight; a meal that would fall outside its bounds is held
 *  at the bound and the rest shared again among the others. */
function shared(types: readonly MealType[], kcalTarget: number): PlanSlot[] {
  const kcal: (number | null)[] = types.map(() => null);
  for (;;) {
    const open = types.flatMap((t, at) => (kcal[at] === null ? [{ t, at }] : []));
    if (open.length === 0) break;
    const left = kcalTarget - kcal.reduce<number>((n, k) => n + (k ?? 0), 0);
    const weight = open.reduce((n, o) => n + WEIGHT[o.t], 0);
    const share = (t: MealType): number => (left * WEIGHT[t]) / weight;
    const low = open.find((o) => share(o.t) < LEAST_MEAL_KCAL);
    const high = open.find((o) => share(o.t) > MOST[o.t]);
    if (low !== undefined) kcal[low.at] = LEAST_MEAL_KCAL;
    else if (high !== undefined) kcal[high.at] = MOST[high.t];
    else for (const o of open) kcal[o.at] = share(o.t);
  }
  return types.map((mealType, at) => ({ mealType, kcal: Math.round(kcal[at] ?? 0) }));
}

/** The idea a meal of this kind is: a bowl, toast or fruit for breakfast and a snack;
 *  a plate or a dish for lunch and dinner, turn about. */
function kindOf(mealType: MealType, turn: number): MealIdeaKind {
  if (mealType === "breakfast" || mealType === "snack") return "light";
  return turn % 2 === 0 ? "plate" : "dish";
}

export interface PlannedMeal { mealType: MealType; idea: MealIdea }

export interface PlanDayInput {
  /** What tells one person's plan, and one making of it, from another. */
  seed: string;
  /** 1 is Monday. */
  day: number;
  diet: Diet;
  mealsPerDay: number;
  kcalTarget: number;
  /** The person's weight and the day's protein (31d); absent, the meals are drawn for calories alone. */
  protein?: { weightKg: number; dayTargetG: number | null };
  /** Where the person is (`regionOf`); absent, nothing is taken away. */
  region?: FoodRegion;
}

/** A meal's protein in the week: the day's shared by each meal's calories (spec Part 6 §16.6). */
export function slotProtein(protein: PlanDayInput["protein"], mealType: MealType, kcal: number, dayKcal: number): ProteinAim | undefined {
  if (protein === undefined) return undefined;
  const share = protein.dayTargetG === null || dayKcal <= 0 ? null : (protein.dayTargetG * kcal) / dayKcal;
  return proteinAim(protein.weightKg, share, { snack: mealType === "snack" });
}

/** One day of the plan: an idea for each meal, drawn again until the day is near its
 *  calories, and the draw nearest at or over them kept, else the nearest. A plan never
 *  offers less than the day's calories (under 18, in pregnancy or with a flagged answer
 *  the app may not cut, and for anyone else the target is already the cut): where no
 *  draw reaches them, the server makes the amounts bigger (dietPlanService.ts). */
export function planDay(input: PlanDayInput): PlannedMeal[] {
  const slots = planSlots(input.mealsPerDay, input.kcalTarget, MOST_PLAN_MEALS);
  const sumOf = (meals: readonly PlannedMeal[]): number => meals.reduce((n, m) => n + m.idea.totals.kcal, 0);
  let best: { meals: PlannedMeal[]; kcal: number } | null = null;
  /** Over the day beats under it; then the nearer. */
  const better = (kcal: number, than: number): boolean =>
    kcal >= input.kcalTarget !== than >= input.kcalTarget ? kcal >= input.kcalTarget : Math.abs(kcal - input.kcalTarget) < Math.abs(than - input.kcalTarget);
  for (let draw = 0; draw < DAY_DRAWS; draw++) {
    const make = ideaMaker(`${input.seed}|${String(input.day)}|${String(draw)}`, input.diet, [], input.region);
    let turn = input.day;
    const meals = slots.flatMap((slot): PlannedMeal[] => {
      const kind = kindOf(slot.mealType, slot.mealType === "lunch" || slot.mealType === "dinner" ? turn++ : turn);
      const idea = make(Math.round(slot.kcal * AIM_OVER), kind, Infinity, 0, slotProtein(input.protein, slot.mealType, slot.kcal, input.kcalTarget));
      return idea === null ? [] : [{ mealType: slot.mealType, idea }];
    });
    const kcal = sumOf(meals);
    if (best === null || better(kcal, best.kcal)) best = { meals, kcal };
    if (kcal >= input.kcalTarget && kcal <= input.kcalTarget * (1 + NEAR_ENOUGH)) break;
  }
  return best?.meals ?? [];
}

/** The foods of a meal, as a set, to tell one idea from another. */
const foodsKey = (canonicals: readonly string[]): string => [...new Set(canonicals)].sort().join("|");

export interface SwapInput {
  seed: string;
  diet: Diet;
  mealType: MealType;
  /** The meal's calories as it stands. */
  kcal: number;
  /** The foods the meal holds now. */
  foods: readonly string[];
  /** The protein the meal is drawn for (`slotProtein`); absent, calories alone. */
  protein?: ProteinAim | undefined;
  region?: FoodRegion;
}

/** Another idea for one meal: of the same kind and near the same calories (held to
 *  the bounds a meal of its kind has), of other foods where the diet has them. Null
 *  where none but the same foods can be made. */
export function swapMeal(input: SwapInput): MealIdea | null {
  const kcal = Math.min(Math.max(Math.round(input.kcal), LEAST_MEAL_KCAL), Math.round(MOST[input.mealType] * AIM_OVER));
  const now = foodsKey(input.foods);
  for (let draw = 0; draw < DAY_DRAWS; draw++) {
    const seed = `${input.seed}|${String(draw)}`;
    const idea = ideaMaker(seed, input.diet, input.foods, input.region)(kcal, kindOf(input.mealType, hash(seed)), Infinity, 0, input.protein);
    if (idea !== null && foodsKey(idea.items.map((i) => i.canonical)) !== now) return idea;
  }
  return null;
}
