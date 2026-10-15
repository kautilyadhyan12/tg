// A person's own diet plan (ROADMAP 34e-i): the week the app makes, and another idea
// for one meal of it. Pure: the same person, change and numbers in give the same plan
// out. Every meal is an idea of the meal ideas' own rule (`ideaMaker`), so the foods,
// the diet rule and the amounts are the same as theirs.
import { MOST_PLAN_MEALS, type Diet, type MealIdea, type MealIdeaKind, type MealType } from "@app/shared";
import { LEAST_MEAL_KCAL, MOST_LIGHT_KCAL, MOST_MEALS, MOST_MEAL_KCAL, hash, ideaMaker } from "./suggest.js";

/** Each meal's share of the day, by its kind. */
const WEIGHT: Readonly<Record<MealType, number>> = { breakfast: 3, lunch: 4, dinner: 4, snack: 1.5 };
/** The most one meal of the plan holds: breakfast and a snack are a bowl, toast or
 *  fruit with nuts, which cannot be made bigger than this. */
const MOST: Readonly<Record<MealType, number>> = {
  breakfast: MOST_LIGHT_KCAL, snack: MOST_LIGHT_KCAL, lunch: MOST_MEAL_KCAL, dinner: MOST_MEAL_KCAL,
};
/** The meals of a day by how many there are (screen 9 asks for two to six). */
const LAYOUT: Readonly<Record<number, readonly MealType[]>> = {
  2: ["lunch", "dinner"],
  3: ["breakfast", "lunch", "dinner"],
  4: ["breakfast", "lunch", "snack", "dinner"],
  5: ["breakfast", "snack", "lunch", "snack", "dinner"],
  6: ["breakfast", "snack", "lunch", "snack", "dinner", "snack"],
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
  const own = LAYOUT[Math.min(Math.max(mealsPerDay, 2), MOST_MEALS)] ?? [];
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
    const make = ideaMaker(`${input.seed}|${String(input.day)}|${String(draw)}`, input.diet);
    let turn = input.day;
    const meals = slots.flatMap((slot): PlannedMeal[] => {
      const kind = kindOf(slot.mealType, slot.mealType === "lunch" || slot.mealType === "dinner" ? turn++ : turn);
      const idea = make(Math.round(slot.kcal * AIM_OVER), kind);
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
}

/** Another idea for one meal: of the same kind and near the same calories (held to
 *  the bounds a meal of its kind has), of other foods where the diet has them. Null
 *  where none but the same foods can be made. */
export function swapMeal(input: SwapInput): MealIdea | null {
  const kcal = Math.min(Math.max(Math.round(input.kcal), LEAST_MEAL_KCAL), Math.round(MOST[input.mealType] * AIM_OVER));
  const now = foodsKey(input.foods);
  for (let draw = 0; draw < DAY_DRAWS; draw++) {
    const seed = `${input.seed}|${String(draw)}`;
    const idea = ideaMaker(seed, input.diet, input.foods)(kcal, kindOf(input.mealType, hash(seed)));
    if (idea !== null && foodsKey(idea.items.map((i) => i.canonical)) !== now) return idea;
  }
  return null;
}
