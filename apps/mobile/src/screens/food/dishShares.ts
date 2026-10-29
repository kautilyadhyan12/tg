import type { MealEditItem, MealItem } from "@app/shared";

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
