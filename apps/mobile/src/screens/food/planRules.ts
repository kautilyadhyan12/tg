import type { DietPlanMeal, MealItem, WaitingMeal } from "@app/shared";
import { ideaName } from "./ideaRules";

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

/** What the outbox keeps for a planned meal logged: by canonical and grams, as the plan priced it, so
 *  the server saves the numbers the plan showed. */
export function planMealAsMeal(meal: Pick<DietPlanMeal, "mealType" | "items" | "totals">, id: string, now: Date): WaitingMeal {
  return {
    id,
    body: {
      id,
      mealName: ideaName(meal),
      takenAt: now.toISOString(),
      mealType: meal.mealType,
      items: meal.items.map((i) => ({ canonical: i.canonical, grams: i.gramsPoint })),
    },
    items: meal.items,
    totals: meal.totals,
    tried: false,
  };
}
