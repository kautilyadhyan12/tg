// ROADMAP 7a-iv-a — the measures a food is logged by (RULINGS 2026-09-16, the
// portion redesign). Every food carries its own household measures, as the
// professional food trackers log food: a person picks one and an amount, and the
// server works out the grams from THIS list, never from what a request says a
// measure weighs.
//
// Where a food's measures come from:
//   - USDA's own household measures (`usda_food_portions`), for a food of the USDA
//     table and for a food of our list that copies its numbers from a USDA entry;
//   - the food's own serving, where no other measure of that name weighs the same
//     (our list's "nugget", a packaged product's label);
//   - always grams and ounces.
import { MAX_ITEM_GRAMS, type FoodMeasure } from "@app/shared";

export const GRAM: FoodMeasure = { id: "g", name: "g", grams: 1 };
/** An ounce is a sixteenth of the international pound, which is 0.45359237 kg
 *  exactly (the international yard and pound agreement of 1959). */
export const OUNCE: FoodMeasure = { id: "oz", name: "oz", grams: 28.349523125 };

/** A household measure as USDA's portion table holds it. `amount` is SR Legacy's
 *  own column; the survey release writes the amount into `unit` and leaves it null. */
export interface UsdaPortion {
  seqNum: number;
  amount: number | null;
  unit: string;
  gramWeight: number;
}

/** A measure's leading amount, where its text carries one ("1 cup", "1/2 cup"). */
const LEADING_AMOUNT = /^(\d*\.?\d+|\d+\/\d+)\s+(\S.*)$/;

/** A measure's name as the screen can hold it: at most forty characters, cut at
 *  a SPACE and never through a word. SR Legacy writes whole sentences into the
 *  column ("3 oz with bone, cooked (yield after bone and fat removed)"), and a
 *  blind cut at forty left 110 of the table's 129 longest names ending mid-word
 *  — "3 oz with bone, cooked (yield after bone" — and 19 ending in a space
 *  (counted 2026-09-16 on the loaded table). A dangling comma or bracket goes,
 *  from a short name as from a cut one, so what is left reads as words: SR
 *  Legacy's own "cup," (fdc 175258) is a cup. */
const MEASURE_NAME_MAX = 40;
const DANGLING = /[\s,;:([{-]+$/u;
const readable = (name: string): string => {
  const whole = name.trim().replace(DANGLING, "");
  if (whole.length <= MEASURE_NAME_MAX) return whole;
  const cut = whole.slice(0, MEASURE_NAME_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  // One word longer than the whole allowance has no space to cut at; it is cut
  // where it must be rather than left to overflow the screen.
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(DANGLING, "");
};

/** What one of this measure is called, by the same rule the packaged-product
 *  reader uses for a label's serving (`openfoodfacts.adapter.ts`): one of it is
 *  named by its own words ("cup"), a half is "half cup", and any other count
 *  keeps its number ("2 tbsp"). SR Legacy states the amount in its own column
 *  and the words in `modifier`; the survey release writes both together in
 *  `portion_description`, so the amount is read off the front of the text. The
 *  importer names a food's serving by it too (`tools/usda-files.ts`). */
export function usdaMeasureName(portion: Pick<UsdaPortion, "amount" | "unit">): string {
  const stated = portion.amount !== null && portion.amount > 0 ? portion.amount : null;
  const led = stated === null ? LEADING_AMOUNT.exec(portion.unit) : null;
  const fraction = led?.[1]?.split("/");
  const amount =
    stated ??
    (fraction === undefined
      ? 1
      : fraction.length === 2
        ? Number(fraction[0]) / Number(fraction[1])
        : Number(fraction[0]));
  const words = (led?.[2] ?? portion.unit).trim();
  if (words === "" || !Number.isFinite(amount) || amount <= 0) return readable(portion.unit);
  if (amount === 1) return readable(words);
  if (amount === 0.5) return readable(`half ${words}`);
  return readable(`${String(amount)} ${words}`);
}

/** What a food's measures are made from: its own serving (grams of one `unit`)
 *  and the USDA household measures of the entry it is, or cites — none where it
 *  has no USDA entry, or the table is not loaded. */
export interface MeasureSource {
  serving: number;
  unit: string;
  portions: readonly UsdaPortion[];
}

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
/** Two weights of one measure, as two tables round them. */
const sameWeight = (a: number, b: number): boolean => Math.abs(a - b) < 0.05;
/** A serving named by weight alone, as our list's "g" foods and a label that
 *  gives only grams or millilitres are ("30 g", "250 ml"). */
const byWeight = (unit: string): boolean => sameName(unit, "g") || sameName(unit, "ml");

/** A food's own serving as a measure, or null where another measure already is
 *  it: grams cover a serving of 100 g by weight (and a label that gives no weight
 *  reads as that, `servingOf`), the ounce covers our list's "oz" servings, and a
 *  USDA measure of the same name and weight is the same measure. A serving by
 *  weight is called "serving". */
function servingMeasure(source: MeasureSource, usda: readonly FoodMeasure[]): FoodMeasure | null {
  const { serving, unit } = source;
  if (!(serving > 0 && serving <= MAX_ITEM_GRAMS)) return null;
  if (byWeight(unit)) return serving === 100 ? null : { id: "serving", name: "serving", grams: serving };
  if (sameName(unit, OUNCE.name) || unit.trim() === "") return null;
  if (usda.some((m) => sameName(m.name, unit) && sameWeight(m.grams, serving))) return null;
  return { id: "serving", name: unit.trim().slice(0, 60), grams: serving };
}

/** Every measure the food can be logged by, in the order a picker shows them: its
 *  own serving, USDA's measures in USDA's own order, grams, ounces. A USDA measure
 *  that weighs nothing or more than one item of a meal may, or is plainly grams or
 *  an ounce, or repeats an earlier one's name and weight (SR Legacy lists beef
 *  jerky's "oz" twice), is left out. */
export function foodMeasures(source: MeasureSource): FoodMeasure[] {
  const usda: FoodMeasure[] = [];
  for (const portion of source.portions) {
    const name = usdaMeasureName(portion);
    if (!(portion.gramWeight > 0 && portion.gramWeight <= MAX_ITEM_GRAMS)) continue;
    if (sameName(name, GRAM.name) || sameName(name, OUNCE.name)) continue;
    if (usda.some((m) => sameName(m.name, name) && sameWeight(m.grams, portion.gramWeight))) continue;
    usda.push({ id: `usda-${String(portion.seqNum)}`, name, grams: portion.gramWeight });
  }
  const own = servingMeasure(source, usda);
  return [...(own === null ? [] : [own]), ...usda, GRAM, OUNCE];
}

/** The measure and amount a food starts at when it is picked: its own serving
 *  once, as the measure of that name and weight; grams of it, for a serving by
 *  weight; an ounce, for our list's "oz" servings. */
export function startingMeasure(source: Pick<MeasureSource, "serving" | "unit">, measures: readonly FoodMeasure[]): { measure: string; amount: number } {
  const { serving, unit } = source;
  const own = measures.find((m) => m.id === "serving") ??
    measures.find((m) => m.id.startsWith("usda-") && sameName(m.name, unit) && sameWeight(m.grams, serving));
  if (own !== undefined) return { measure: own.id, amount: 1 };
  if (sameName(unit, OUNCE.name)) return { measure: OUNCE.id, amount: 1 };
  return { measure: GRAM.id, amount: serving > 0 && serving <= MAX_ITEM_GRAMS ? serving : 100 };
}

/** The grams `amount` of a measure weighs, to the whole gram. */
export const measureGrams = (measure: FoodMeasure, amount: number): number => Math.round(amount * measure.grams);

/** A cup, in millilitres: Appendix B's global starter set (Part 2B). */
export const CUP_ML = 240;
/** Appendix B's "medium" density class — dal, sambar and most curries — which a
 *  food with no cup of its own is weighed by. */
export const MEDIUM_G_PER_ML = 1;

/** What a millilitre of the food weighs: its own cup, where its measures have one
 *  named "cup" or "half cup" (a cup of cornflakes is 30 g, not 240), else
 *  Appendix B's medium density. */
export function gramsPerMl(measures: readonly FoodMeasure[]): number {
  for (const m of measures) {
    if (sameName(m.name, "cup")) return m.grams / CUP_ML;
    if (sameName(m.name, "half cup")) return m.grams / (CUP_ML / 2);
  }
  return MEDIUM_G_PER_ML;
}

/** Grams from a saved dish: volume (ml) × how full (0–1) × what a millilitre of
 *  the food weighs. The ONE saved-dish formula: the dish measure a person picks
 *  (service.ts) and the photo resolver's dish rung (portion-priors.ts) both read it. */
export function dishwareGrams(volumeMl: number, fillLevel: number, gramsPerMlOfFood: number): number {
  return Math.round(volumeMl * fillLevel * gramsPerMlOfFood);
}
