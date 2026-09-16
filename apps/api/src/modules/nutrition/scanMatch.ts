// ROADMAP 7a-iii-b — what each food a scan sees is priced by. The model names
// every food it sees with its own grams, kcal and macros; the app prices each one
// from a food table where a table has it, and from the model's own figures,
// marked "estimate", where none does — never a wrong food and never a blank
// (RULINGS 2026-09-15, as amended; the plan, RULINGS 2026-09-16).
//
// The table lookups are handed in, so the order below is tested on its own; the
// service gives it our list, the USDA table and packaged products.
import { isNoValueWord, type Per100g, type VisionItem } from "@app/shared";
import { slug } from "./foods.js";
import type { FoodReference } from "./openfoodfacts.adapter.js";

/** The most energy an estimate may carry per 100 g: pure fat is 900 kcal, and
 *  USDA's highest foods, beef tallow and lard, 902 (measured 2026-09-16). */
export const MAX_ESTIMATE_KCAL_PER_100G = 900;

/** How far an estimate's macros may put its energy from its kcal: 30 % either way
 *  (the plan's 0.7–1.3), or 10 kcal where that is more. The 10 kcal is rounding,
 *  not leniency: the model writes whole grams, so each macro can be half a gram
 *  out — up to 8.5 kcal between them — and on a lemon or a few asparagus spears
 *  that alone is more than 30 %. */
export const ENERGY_TOLERANCE = 0.3;
export const ENERGY_SLACK_KCAL = 10;

/** The model's own figures for one food, per 100 g, or null where they are no
 *  number: a slot left empty, protein, carbohydrate and fat that together weigh
 *  more than the food they are part of, energy past what food carries, or macros
 *  whose energy (4 kcal a gram of protein and carbohydrate, 9 of fat) is not the
 *  kcal it gave. An estimate that contradicts itself is not shown as one. */
export function estimatePer100g(item: Pick<VisionItem, "grams" | "kcal" | "protein_g" | "carbs_g" | "fat_g">): Per100g | null {
  const { grams, kcal, protein_g: protein, carbs_g: carbs, fat_g: fat } = item;
  if (grams === null || kcal === null || protein === null || carbs === null || fat === null) return null;
  // One weight, not three: 60 g of protein and 60 g of carbohydrate are no 100 g
  // food, though neither is heavier than it alone.
  if (protein + carbs + fat > grams) return null;
  const energy = 4 * protein + 4 * carbs + 9 * fat;
  if (Math.abs(energy - kcal) > Math.max(ENERGY_TOLERANCE * kcal, ENERGY_SLACK_KCAL)) return null;
  // Divided before it is multiplied, so a macro no heavier than the food is never
  // read past 100 g per 100 g by the rounding of its last digit.
  const per100 = (v: number): number => (v / grams) * 100;
  const figures = { kcal: per100(kcal), proteinG: per100(protein), carbsG: per100(carbs), fatG: per100(fat) };
  if (figures.kcal > MAX_ESTIMATE_KCAL_PER_100G) return null;
  return figures;
}

/** What the model saw a food's energy as, per 100 g, and how far off that estimate
 *  can be: 30 %, or 10 kcal — the same tolerance the model's own macros are held
 *  to against its kcal (above). Every USDA entry that close to the estimate is as
 *  near as any other; so is one within `USDA_TIE_KCAL` of the nearest entry
 *  (`repo.usdaFoodForScan`). */
export interface EnergySeen { kcal: number; slack: number }

/** How close, in kcal per 100 g, a USDA entry must be to the nearest entry of its
 *  name to be as near, wherever the estimate's error ends: a gap this small is two
 *  ways of making one food, not a photo telling them apart — "Pumpkin, cooked"
 *  (52) and "Pumpkin, canned, cooked" (56). Its own rule, not the macros' rounding
 *  above, though both are 10 today. */
export const USDA_TIE_KCAL = 10;

export function energySeen(estimate: Per100g | null): EnergySeen | null {
  if (estimate === null) return null;
  return { kcal: estimate.kcal, slack: Math.max(ENERGY_TOLERANCE * estimate.kcal, ENERGY_SLACK_KCAL) };
}

/** A table food more than three times from the model's own energy per 100 g,
 *  either way, is another food than the one on the plate ("juice" read as a
 *  concentrate), and gives way to the estimate — where the two also differ by
 *  more than 10 kcal per 100 g. Below that the gap is rounding on a food with
 *  next to no energy (black coffee at 1 kcal per 100 g against 4), not a
 *  different food; a diet cola read for a cola (0 against 42) is still one. */
export const WRONG_FOOD_RATIO = 3;
export const WRONG_FOOD_MIN_GAP_KCAL = 10;

export function isWrongFood(tableKcalPer100g: number, estimate: Per100g | null): boolean {
  if (estimate === null) return false;
  const high = Math.max(tableKcalPer100g, estimate.kcal);
  const low = Math.min(tableKcalPer100g, estimate.kcal);
  return high > WRONG_FOOD_RATIO * low && high - low > WRONG_FOOD_MIN_GAP_KCAL;
}

/** Where a scanned food's numbers can come from, in the order they are asked. */
export interface ScanLookups {
  /** Our own list, by whole words (`findCurated`). */
  ourList(hint: string): FoodReference | null;
  /** The USDA table: the food itself by name, then every word; among the entries
   *  a name finds equally, the plainest of those as near to what the model saw as
   *  its estimate can tell. */
  usda(hint: string, seen: EnergySeen | null): Promise<FoodReference | null>;
  /** A packaged product whose name holds every word. */
  packaged(hint: string): Promise<FoodReference | null>;
}

export type ScanPrice =
  /** A table has the food, and its energy agrees with what the model saw. */
  | { kind: "table"; food: FoodReference }
  /** No table has it, or the one that answered is another food (`overruled`). */
  | { kind: "estimate"; per100g: Per100g; grams: number; overruled: FoodReference | null }
  /** Nothing has it and the model gave no usable number: left out of the total, and named. */
  | { kind: "none" };

/** Our list → USDA → a packaged product → the model's estimate. A lower table is
 *  asked only when the one above has nothing, and whichever answers is checked
 *  against the model's own energy; one that fails gives way to the estimate, not
 *  to the next table, since the next table's answer to the same name is the same
 *  guess made worse.
 *
 *  A table is asked by a name only. A canonical_hint that says there is none
 *  ("unknown", "N/A") would find whatever a table happens to call by that word, so
 *  no table is asked: the model's own figures price the food, shown by its name.
 *  An item with no name either is no food anyone can be shown, and nothing prices
 *  it — the prompt puts a food the model cannot name in unknown_items. */
export async function priceScannedFood(item: VisionItem, lookups: ScanLookups): Promise<ScanPrice> {
  const estimate = estimatePer100g(item);
  const hint = item.canonical_hint;
  const hinted = !isNoValueWord(hint);
  if (!hinted && isNoValueWord(item.name)) return { kind: "none" };
  const food = hinted
    ? (lookups.ourList(hint) ?? (await lookups.usda(hint, energySeen(estimate))) ?? (await lookups.packaged(hint)))
    : null;
  if (food !== null && !isWrongFood(food.kcal, estimate)) return { kind: "table", food };
  if (estimate !== null && item.grams !== null) return { kind: "estimate", per100g: estimate, grams: item.grams, overruled: food };
  return { kind: "none" };
}

/** The prefix no other canonical has: our list's are words, USDA's `usda_…` and
 *  packaged products' `off_…`. */
export const ESTIMATE_CANONICAL_PREFIX = "est_";

/** An estimate row as the rest of the pipeline reads a food: its own figures per
 *  100 g, served by the grams the model saw. `taken` holds the canonicals the
 *  scan already uses, so two foods of one name ("toast" twice) never share one —
 *  a meal's items are told apart by canonical. */
export function estimateFood(name: string, per100g: Per100g, grams: number, taken: ReadonlySet<string>): FoodReference {
  const base = `${ESTIMATE_CANONICAL_PREFIX}${slug(name).slice(0, 100) || "food"}`;
  let canonical = base;
  for (let n = 2; taken.has(canonical); n++) canonical = `${base}_${String(n)}`;
  return { canonical, name, ...per100g, fiberG: null, serving: grams, unit: "g", source: "estimate" };
}
