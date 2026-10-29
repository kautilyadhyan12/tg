// ROADMAP Stage 5 32b-ii-a (Kd, 2026-10-28 and 2026-10-29) — the foods a person logged before, as
// MyFitnessPal, Cronometer and MacroFactor open Add food on: their last different foods, each opening
// at the amount they last had. Pure, so the pick is one table test.
import { RECENT_FOODS_MOST, measureIdSchema, type MealItem, type RecentFood } from "@app/shared";

/** A recent food before its measures are read (the service adds them). */
export type RecentPick = Omit<RecentFood, "measures">;

/** How many of the person's newest meals the list is read from. */
export const RECENT_MEALS_READ = 60;

/** The newest different foods in `meals` (newest first, each meal's foods in order), at most
 *  `RECENT_FOODS_MOST`. A food is the same food by its canonical name. A food priced by the scan's
 *  estimate or by the person's own numbers is left out: added again, its table would price it, not
 *  what they had. A food last had by a saved dish, or by a measure the food list no longer names, is
 *  given here by its grams; the service then starts it where the search does (`recentFoodsOf`). */
export function recentFoods(meals: readonly { items: readonly MealItem[] }[]): RecentPick[] {
  const seen = new Set<string>();
  const out: RecentPick[] = [];
  for (const meal of meals) {
    for (const item of meal.items) {
      if (out.length >= RECENT_FOODS_MOST) return out;
      const source = item.nutritionSource;
      if (source === "estimate" || source === "own" || seen.has(item.canonical)) continue;
      seen.add(item.canonical);
      const m = item.measure;
      const byMeasure = m !== undefined && m.id !== "g" && measureIdSchema.safeParse(m.id).success;
      out.push({
        canonical: item.canonical,
        source,
        add: byMeasure ? { measure: m.id, amount: m.amount } : { measure: "g", amount: Math.max(1, Math.round(item.gramsPoint)) },
        item,
      });
    }
  }
  return out;
}
