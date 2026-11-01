import type { FoodSearchItem, Meal, MealChoice, MealItem, RecentFood } from "@app/shared";
import type { Amount } from "./measures";
import { totalsOf } from "./rows";

// Several foods added to one meal before it is saved (ROADMAP Stage 5 33b-i; Kd, 2026-10-30: "i eat
// oats and milk but after selecting oats it directly gets added i cannot choose milk"), as MyFitnessPal
// and Cronometer add foods to a meal: each food picked goes on a list, and one save keeps them as one meal.

/** A food as the amount box holds it: one the search found, or one logged before (`last`). */
export type BasketPick = Pick<FoodSearchItem, "canonical" | "name" | "source" | "measures" | "startsAt"> & Partial<Pick<FoodSearchItem, "kcal" | "packaged">> & { last?: RecentFood };

/** A food on the list: what is sent for it, its amount as it reads, and the server's numbers for it
 *  where they came back before it was put on the list. */
export interface BasketFood {
  key: string;
  name: string;
  chosen: MealChoice;
  amount: string;
  item: MealItem | null;
  /** What it was picked from, so a tap opens it again to change: the food and its amount as picked. */
  again?: { food: BasketPick; amount: Amount } | undefined;
}

/** The list with a food put back in its own place (changed), or added at its end. */
export function withBasketFood<T extends BasketFood>(list: readonly T[], food: T, at: string | null): T[] {
  return at !== null && list.some((f) => f.key === at) ? list.map((f) => (f.key === at ? { ...food, key: at } : f)) : [...list, food];
}

/** The meal's name: its one food, its two, or the first and how many more. */
export function basketName(foods: readonly Pick<BasketFood, "name">[]): string {
  const [first, second] = foods;
  if (first === undefined) return "Meal";
  const name =
    foods.length === 1 || second === undefined
      ? first.name
      : foods.length === 2
        ? `${first.name} & ${second.name}`
        : `${first.name} & ${String(foods.length - 1)} more`;
  return name.slice(0, 200);
}

/** The meal's numbers, where the server priced every food on the list; else none until it is sent. */
export function basketNumbers(foods: readonly Pick<BasketFood, "item">[]): { items: MealItem[]; totals: Meal["totals"] } | null {
  const items = foods.map((f) => f.item);
  if (items.length === 0 || items.some((i) => i === null)) return null;
  const known = items.filter((i): i is MealItem => i !== null);
  return { items: known, totals: totalsOf(known) };
}

/** "1 food", "2 foods". */
export const foodsWords = (n: number): string => (n === 1 ? "1 food" : `${String(n)} foods`);
