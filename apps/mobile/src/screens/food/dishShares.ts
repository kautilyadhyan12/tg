import type { MealEditItem, MealItem } from "@app/shared";
import { chosenItem } from "./measures";
import { amountOf } from "./rows";

// A meal eaten from one dish (ROADMAP Stage 5 33b-i; Kd, 2026-10-30): a person eats rice, dal and sabzi
// from one bowl, not three. Each food is given its part of the dish in the proportions it has now, and
// the server weighs the dish and the part (`share`, packages/shared). Proportions only: no grams or
// calories are worked out here.

/** Each food's part of the dish, from what each weighs now: the same order, together the whole. */
export function sharesOf(grams: readonly number[]): number[] {
  const total = grams.reduce((sum, g) => sum + Math.max(0, g), 0);
  if (!(total > 0)) return [];
  // Thousandths, never 0: a food on the meal always has some of the dish.
  const shares = grams.map((g) => Math.min(1, Math.max(0.001, Math.round((Math.max(0, g) / total) * 1000) / 1000)));
  // Rounded, they may come to a hair more than the dish: the largest gives it back.
  const over = Math.round((shares.reduce((sum, x) => sum + x, 0) - 1) * 1000) / 1000;
  if (over > 0) {
    const largest = shares.indexOf(Math.max(...shares));
    shares[largest] = Math.round(((shares[largest] ?? 0) - over) * 1000) / 1000;
  }
  return shares;
}

/** A logged meal's foods eaten from one dish: each food of the lists its part of the dish, in the
 *  proportions it was saved at; the person's own foods kept as saved. Null where only own foods are left. */
export function wholeDishEdits(items: readonly MealItem[], dishId: string, fill: number): MealEditItem[] | null {
  const sharing = items.flatMap((it, i) => (it.nutritionSource === "own" ? [] : [i]));
  if (sharing.length === 0) return null;
  const shares = sharesOf(sharing.map((i) => items[i]?.gramsPoint ?? 0));
  return items.map((it, i): MealEditItem => {
    const at = sharing.indexOf(i);
    return at === -1 ? { from: i } : { from: i, canonical: it.canonical, dishwareId: dishId, fillLevel: fill, share: shares[at] ?? 1 };
  });
}

/** A logged meal's one dish undone: each food of the lists at the amount it had before (`before`, by
 *  place, where the same food is still there), else at the grams it weighs now. */
export function wholeDishOffEdits(items: readonly MealItem[], before: readonly MealItem[] | null): MealEditItem[] {
  return items.map((it, i): MealEditItem => {
    if (it.nutritionSource === "own") return { from: i };
    const had = before?.[i];
    const chosen = had?.canonical === it.canonical ? chosenItem(it.canonical, amountOf(had)) : null;
    return chosen !== null && "measure" in chosen ? { from: i, ...chosen } : { from: i, canonical: it.canonical, grams: Math.max(1, Math.round(it.gramsPoint)) };
  });
}

/** The one dish every food of the lists is a part of, as the photo's meal holds them now; null where
 *  they are not all one dish at one fill. */
export function sharedDish(amounts: readonly { measure: string; amount: string; share?: number | undefined }[]): { id: string; fill: number } | null {
  const first = amounts[0];
  if (first === undefined || !first.measure.startsWith("dish:")) return null;
  const same = amounts.every((a) => a.share !== undefined && a.measure === first.measure && a.amount === first.amount);
  return same ? { id: first.measure.slice("dish:".length), fill: Number(first.amount) } : null;
}

/** The same for a logged meal's foods, by the dish's name. */
export function sharedDishOfItems(items: readonly MealItem[]): { name: string; fill: number } | null {
  const measures = items.filter((i) => i.nutritionSource !== "own").map((i) => i.measure);
  const first = measures[0];
  if (first?.id !== "dish") return null;
  return measures.every((m) => m?.share !== undefined && m.name === first.name && m.amount === first.amount) ? { name: first.name, fill: first.amount } : null;
}
