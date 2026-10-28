import type { Meal, MealPage, MealType, NutritionTargetsResponse } from "@app/shared";
import { count } from "../dashboard/words";

// One day of the person's food, in the phone's own days, as the browser reads it
// (apps/web/src/pages/Nutrition.jsx, Card 5d): the meals list has no date filter, so newest-first
// pages are read until one passes the day. Every number is the server's; the phone only adds them up.

export const MEAL_PAGE_SIZE = 100;
export const MOST_MEAL_PAGES = 10;

export const MEAL_TYPES: readonly { type: MealType; name: string }[] = [
  { type: "breakfast", name: "Breakfast" },
  { type: "lunch", name: "Lunch" },
  { type: "dinner", name: "Dinner" },
  { type: "snack", name: "Snack" },
];

export const mealTypeName = (type: MealType): string => MEAL_TYPES.find((m) => m.type === type)?.name ?? "Meal";

export function startOfDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

export function addDays(day: Date, n: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);
}

export const sameDay = (a: Date, b: Date): boolean => startOfDay(a).getTime() === startOfDay(b).getTime();

export function inDay(takenAt: string, day: Date): boolean {
  const t = Date.parse(takenAt);
  return t >= startOfDay(day).getTime() && t < addDays(startOfDay(day), 1).getTime();
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Today", "Yesterday", else "Mon, 26 Oct". */
export function dayWords(day: Date, now: Date): string {
  if (sameDay(day, now)) return "Today";
  if (sameDay(day, addDays(now, -1))) return "Yesterday";
  return `${WEEKDAYS[day.getDay()] ?? ""}, ${String(day.getDate())} ${MONTHS[day.getMonth()] ?? ""}`;
}

/** A meal saved with no section of its own sits where its hour puts it, as on the browser. */
export function sectionOf(meal: Pick<Meal, "mealType" | "takenAt">): MealType {
  if (meal.mealType !== null) return meal.mealType;
  const h = new Date(meal.takenAt).getHours();
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 19) return "snack";
  if (h < 22) return "dinner";
  return "snack";
}

/** The day's meals from newest-first pages. `cut`: the day lies deeper than the pages read. */
export async function walkDay(
  readPage: (cursor: string | null) => Promise<MealPage | null>,
  day: Date,
): Promise<{ meals: Meal[]; cut: boolean } | null> {
  const from = startOfDay(day).getTime();
  const meals: Meal[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < MOST_MEAL_PAGES; pages += 1) {
    const page = await readPage(cursor);
    if (page === null) return null;
    let older = false;
    for (const meal of page.items) {
      if (inDay(meal.takenAt, day)) meals.push(meal);
      if (Date.parse(meal.takenAt) < from) older = true;
    }
    if (older || page.nextCursor === null) return { meals, cut: false };
    cursor = page.nextCursor;
  }
  return { meals, cut: true };
}

export interface Sums {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** What the day's meals come to, from each meal's own totals as the server worked them out. */
export function daySums(meals: readonly { totals: Meal["totals"] | null }[]): Sums {
  const sum = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  for (const { totals } of meals) {
    if (totals === null) continue;
    sum.kcal += totals.kcalPoint;
    sum.proteinG += totals.proteinG;
    sum.carbsG += totals.carbsG;
    sum.fatG += totals.fatG;
  }
  return { kcal: Math.round(sum.kcal), proteinG: Math.round(sum.proteinG), carbsG: Math.round(sum.carbsG), fatG: Math.round(sum.fatG) };
}

export const kcalWords = (n: number): string => `${count(n)} kcal`;

/** "680 kcal left", or how far past it the day went ("120 kcal over"). */
export function leftWords(target: number, eaten: number, unit: "kcal" | "g"): string {
  const left = Math.round(target - eaten);
  const n = count(Math.abs(left));
  const amount = unit === "kcal" ? `${n} kcal` : `${n} g`;
  return left < 0 ? `${amount} over` : `${amount} left`;
}

/** The rings' line when the plan holds back a calorie cut: true of the plan only, so it is said only
 *  while the rings show the plan's numbers. */
export function noCutWords(targets: NutritionTargetsResponse): string | null {
  if (targets.source !== "app" || targets.targets === null || !targets.targets.noCalorieCut) return null;
  return "Your plan has no calorie cut, so these calories keep your weight.";
}
