// A person's own diet plan (ROADMAP 34e-i; RULINGS 2026-09-12): a week, Monday to
// Sunday, that repeats until they change it. The app makes it from the meal ideas'
// own rule, sized to the rings' calories, so the rules that hold a calorie cut hold
// here; the person swaps a meal, puts in their own foods, changes an amount, adds or
// removes a meal. Every food is priced as a logged meal's is, so a planned meal logs
// at the numbers the plan shows. Each change carries the phone's own id: sent twice,
// it is made once.
import {
  DIET_LABEL_CAUTION, FOOD_ALLERGY_CAUTION, dietAllows, dietPlanResponseSchema,
  type ChosenItem, type DietPlanDayReply, type DietPlanMake, type DietPlanResponse, type MakeDietPlanRequest,
  type Diet, type MealIdea, type MealItem, type PutDietPlanDayRequest, type SwapDietPlanMealRequest,
} from "@app/shared";
import { getUserFoodAnswers } from "../users/service.js";
import { planDay, swapMeal } from "./dietPlan.js";
import { CURATED_FOODS } from "./foods.js";
import { changeDietPlan, getDietPlan as readDietPlan, type StoredDays, type StoredMeal } from "./dietPlanRepo.js";
import { NutritionError, getTargets, resolveChosenItems, totals, type NutritionDeps } from "./service.js";

type Targets = NonNullable<Awaited<ReturnType<typeof getTargets>>["targets"]>;
interface Person { make: DietPlanMake; diet: Awaited<ReturnType<typeof getUserFoodAnswers>>["diet"]; mealsPerDay: number | null; targets: Targets | null }

async function person(deps: Pick<NutritionDeps, "sql">, userId: string): Promise<Person> {
  const [{ diet, mealsPerDay }, { targets }] = await Promise.all([getUserFoodAnswers(deps.sql, userId), getTargets(deps, userId)]);
  const missing = [...(diet === null ? ["diet" as const] : []), ...(mealsPerDay === null ? ["mealsPerDay" as const] : [])];
  const make: DietPlanMake = missing.length > 0 ? { status: "needs_answers", missing } : targets === null ? { status: "needs_plan" } : { status: "ok" };
  return { make, diet, mealsPerDay, targets };
}

const whole = (n: number): number => Math.round(n);

const DIET_OF: ReadonlyMap<string, Diet> = new Map(CURATED_FOODS.map((f) => [f.canonical, f.diet]));
/** The foods of the list the diet does not eat. */
const outsideDiet = (items: readonly MealItem[], diet: Diet | null): string[] =>
  diet === null ? [] : items.flatMap((i) => {
    const its = i.nutritionSource === "curated" ? DIET_OF.get(i.canonical) : undefined;
    return its === undefined || dietAllows(diet, its) ? [] : [i.name];
  });

function dayReply(day: number, meals: readonly StoredMeal[], who: Person): DietPlanDayReply {
  const { targets } = who;
  const withTotals = meals.map((m) => ({ mealType: m.mealType, items: m.items, totals: totals(m.items), outsideDiet: outsideDiet(m.items, who.diet) }));
  const all = totals(meals.flatMap((m) => m.items));
  const planned = { kcal: all.kcalPoint, proteinG: whole(all.proteinG), carbsG: whole(all.carbsG), fatG: whole(all.fatG) };
  const target = targets === null ? null : { kcal: targets.kcal, proteinG: targets.proteinG, carbsG: targets.carbsG, fatG: targets.fatG };
  const off = target === null ? null : {
    kcal: planned.kcal - target.kcal, proteinG: planned.proteinG - target.proteinG,
    carbsG: planned.carbsG - target.carbsG, fatG: planned.fatG - target.fatG,
  };
  return { day, meals: withTotals, planned, target, off };
}

function reply(days: StoredDays, who: Person): DietPlanResponse {
  return dietPlanResponseSchema.parse({
    days: days.map((meals, at) => dayReply(at + 1, meals, who)),
    make: who.make,
    caution: FOOD_ALLERGY_CAUTION,
    labelCaution: who.diet === "non_vegetarian" ? null : DIET_LABEL_CAUTION,
  });
}

export async function getDietPlan(deps: Pick<NutritionDeps, "sql">, userId: string): Promise<DietPlanResponse> {
  const [plan, who] = await Promise.all([readDietPlan(deps.sql, userId), person(deps, userId)]);
  return reply(plan.days, who);
}

/** Each list of chosen foods priced, in one pass, as a logged meal's are. */
async function priced(deps: NutritionDeps, userId: string, lists: readonly (readonly ChosenItem[])[]): Promise<MealItem[][]> {
  const items = lists.length === 0 ? [] : await resolveChosenItems(deps, userId, lists.flat());
  let at = 0;
  return lists.map((list) => {
    const mine = items.slice(at, at + list.length);
    at += list.length;
    return mine;
  });
}

const chosenOf = (idea: MealIdea): ChosenItem[] => idea.items.map((i) => ({ canonical: i.canonical, grams: i.grams }));

const refusal = (make: Exclude<DietPlanMake, { status: "ok" }>): NutritionError =>
  make.status === "needs_answers"
    ? new NutritionError(409, "needs_answers", "Answer the food questions in setup to get a meal plan.")
    : new NutritionError(409, "needs_plan", "Finish setup to get a meal plan.");

/** The app's plan, for the whole week or the days named; it replaces what they held. */
export async function makeDietPlan(deps: NutritionDeps, userId: string, input: MakeDietPlanRequest): Promise<DietPlanResponse> {
  const who = await person(deps, userId);
  if (who.make.status !== "ok") throw refusal(who.make);
  const { diet, mealsPerDay, targets } = who;
  if (diet === null || mealsPerDay === null || targets === null) throw refusal({ status: "needs_plan" });
  const days = input.days ?? [1, 2, 3, 4, 5, 6, 7];
  const made = days.map((day) => planDay({ seed: `${userId}|make|${input.changeId}`, day, diet, mealsPerDay, kcalTarget: targets.kcal }));
  const items = await priced(deps, userId, made.flatMap((meals) => meals.map((m) => chosenOf(m.idea))));
  let at = 0;
  const week = await changeDietPlan(deps.sql, userId, input.changeId, (current) => {
    const next = current.map((meals) => [...meals]);
    days.forEach((day, i) => {
      next[day - 1] = (made[i] ?? []).map((m) => ({ mealType: m.mealType, items: items[at++] ?? [] }));
    });
    return next;
  });
  return reply(week, who);
}

/** A day as the person sent it, whole. Their own foods need no setup answer. */
export async function putDietPlanDay(
  deps: NutritionDeps,
  userId: string,
  day: number,
  input: PutDietPlanDayRequest,
): Promise<DietPlanResponse> {
  const items = await priced(deps, userId, input.meals.map((m) => m.items));
  const meals = input.meals.map((m, i) => ({ mealType: m.mealType, items: items[i] ?? [] }));
  const week = await changeDietPlan(deps.sql, userId, input.changeId, (current) => current.map((old, at) => (at === day - 1 ? meals : old)));
  return reply(week, await person(deps, userId));
}

const sameMeal = (a: StoredMeal | undefined, b: StoredMeal): boolean => a !== undefined && JSON.stringify(a) === JSON.stringify(b);

/** Another idea for one meal of a day, near its calories and of the person's diet. */
export async function swapDietPlanMeal(
  deps: NutritionDeps,
  userId: string,
  day: number,
  input: SwapDietPlanMealRequest,
): Promise<DietPlanResponse> {
  const [plan, who] = await Promise.all([readDietPlan(deps.sql, userId), person(deps, userId)]);
  if (plan.recentChanges.includes(input.changeId)) return reply(plan.days, who);
  const meal = plan.days[day - 1]?.[input.meal];
  if (meal === undefined) throw new NutritionError(404, "not_found", "Meal not found.");
  if (who.diet === null) throw refusal({ status: "needs_answers", missing: ["diet"] });
  const idea = swapMeal({
    seed: `${userId}|swap|${input.changeId}`, diet: who.diet, mealType: meal.mealType,
    kcal: totals(meal.items).kcalPoint, foods: meal.items.map((i) => i.canonical),
  });
  if (idea === null) throw new NutritionError(409, "no_other_meal", "No other meal of this size fits your diet.");
  const [items = []] = await priced(deps, userId, [chosenOf(idea)]);
  const week = await changeDietPlan(deps.sql, userId, input.changeId, (current) => {
    const meals = current[day - 1] ?? [];
    // Changed since it was read (another change came first): the idea was made for a meal that is gone.
    if (!sameMeal(meals[input.meal], meal)) throw new NutritionError(409, "plan_changed", "Your plan has changed. Open it again to swap this meal.");
    return current.map((old, at) => (at === day - 1 ? old.map((m, i) => (i === input.meal ? { mealType: m.mealType, items } : m)) : old));
  });
  return reply(week, who);
}
