import { planItemChoice, type DietPlanMeal, type FoodMeasure, type MealChoice, type MealItem, type MealType, type WaitingMeal } from "@app/shared";
import type { BasketFood } from "./basket";
import { itemMark } from "./day";
import { ideaName } from "./ideaRules";
import { loggedAmount } from "./measures";
import { amountOf, foodTitle } from "./rows";

// A person's meal plan (ROADMAP Stage 5 34e-ii-a), as the phone shows and logs it.

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** Whether the person has a plan: a meal on any day of the week. */
export const hasMeals = (plan: { days: readonly { meals: readonly unknown[] }[] }): boolean => plan.days.some((d) => d.meals.length > 0);

/** The plan's day for a date, in the phone's own time: 1 is Monday, 7 Sunday. */
export const planDayOf = (at: Date): number => ((at.getDay() + 6) % 7) + 1;

export const planDayName = (day: number): string => DAY_NAMES[day - 1] ?? "";

/** The next day of the week, or the one before: the week goes round. */
export const stepDay = (day: number, by: 1 | -1): number => ((day - 1 + by + 7) % 7) + 1;

const sameFoods = (a: readonly string[], b: readonly string[]): boolean => {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((c, at) => c === y[at]);
};

/** Which meals of a day are already logged today. A logged meal counts by its foods, whatever its amount
 *  or the meal it was moved to, and counts for one planned meal only: two snacks of the same food need two. */
export function loggedOfDay(meals: readonly Pick<DietPlanMeal, "items">[], foodsToday: readonly (readonly string[])[]): boolean[] {
  const left = [...foodsToday];
  return meals.map((meal) => {
    const foods = meal.items.map((i) => i.canonical);
    const at = left.findIndex((logged) => sameFoods(logged, foods));
    if (at < 0) return false;
    left.splice(at, 1);
    return true;
  });
}

/** The foods of a meal on today's list. A meal waiting to send has only those it was sent with; a
 *  change waiting to send has only those saved. */
export function foodsOfRow(
  row: { id: string; items: readonly Pick<MealItem, "canonical">[] | null; saved: { items: readonly Pick<MealItem, "canonical">[] } | null },
  waiting: readonly Pick<WaitingMeal, "id" | "body">[],
): string[] {
  const known = row.items ?? row.saved?.items;
  if (known !== undefined) return known.map((i) => i.canonical);
  return (waiting.find((m) => m.id === row.id)?.body.items ?? []).flatMap((i) => ("canonical" in i ? [i.canonical] : []));
}

/** What the outbox keeps for a planned meal logged: its foods as the plan holds them, and which meal of
 *  the person's own plan it is, so the server saves the numbers the plan showed (round one of 34e-ii-b,
 *  H4). A gym's meal (31g) names none: the server prices its foods as any meal logged by hand. */
export function planMealAsMeal(meal: Pick<DietPlanMeal, "mealType" | "items" | "totals">, id: string, now: Date, planned: { day: number; meal: number } | null): WaitingMeal {
  return {
    id,
    body: {
      id,
      mealName: ideaName(meal),
      takenAt: now.toISOString(),
      mealType: meal.mealType,
      items: meal.items.map(planItemChoice),
      ...(planned === null ? {} : { planned }),
    },
    items: meal.items,
    totals: meal.totals,
    tried: false,
  };
}

/** A planned food as the food box holds it, to change its amount or take it off: sent back as it is, the
 *  server keeps it at the plan's numbers; a tap opens it at its amount with its own measures. */
export function planBasketFood(item: MealItem, measures: readonly FoodMeasure[], key: string): BasketFood {
  const chosen = planItemChoice(item);
  const amount = amountOf(item);
  const source = item.nutritionSource;
  // An own food opens again in its own form, from what it is sent as.
  const again =
    source === "own" || "own" in chosen
      ? undefined
      : { food: { canonical: item.canonical, name: item.name, source, measures: [...measures], startsAt: { measure: amount.measure, amount: Number(amount.amount) } }, amount };
  return { key, name: foodTitle(item), chosen, amount: loggedAmount(item) + itemMark(item), item, again };
}

/** Where a meal goes in a day as people eat them: breakfast, lunch, a snack, dinner. */
const MEAL_ORDER: Record<MealType, number> = { breakfast: 0, lunch: 1, snack: 2, dinner: 3 };

/** A day's meals with a new one put in its place: after the last meal that comes before or with it. */
export function withNewMeal<T extends { mealType: MealType }>(meals: readonly T[], meal: T): T[] {
  let at = 0;
  meals.forEach((m, i) => {
    if (MEAL_ORDER[m.mealType] <= MEAL_ORDER[meal.mealType]) at = i + 1;
  });
  return [...meals.slice(0, at), meal, ...meals.slice(at)];
}

/** A day of the plan as it is sent again whole, with one meal's foods in place of its own (`at`), a new
 *  meal put in its place (`at` null), or one meal taken out (`items` null). Every other food is sent as it
 *  is, so the server keeps it at the numbers the plan showed. */
export function dayWithMeal(
  meals: readonly Pick<DietPlanMeal, "mealType" | "items">[],
  change: { at: number | null; mealType: MealType; items: readonly MealChoice[] | null },
): { mealType: MealType; items: MealChoice[] }[] {
  const kept = meals.map((m) => ({ mealType: m.mealType, items: m.items.map(planItemChoice) }));
  const { at, items } = change;
  if (at === null) return items === null ? kept : withNewMeal(kept, { mealType: change.mealType, items: [...items] });
  if (items === null) return kept.filter((_, i) => i !== at);
  return kept.map((m, i) => (i === at ? { mealType: m.mealType, items: [...items] } : m));
}
