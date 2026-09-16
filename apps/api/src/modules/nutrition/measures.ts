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

/** A measure's name as the screen can hold it: at most forty characters. SR Legacy
 *  writes whole sentences into the column ("3 oz with bone, cooked (yield after
 *  bone and fat removed)"); 762 of the table's measures, in 692 foods, run past
 *  forty (counted 2026-09-16). A long name is cut where a clause of it ends —
 *  before a bracket or at a comma: "3 oz with bone, cooked" — never inside a
 *  bracket it leaves open ("(yield after"), and never through a word. Nothing is
 *  cut so short it cannot be told apart — a long "cup, chopped into …" must never
 *  read as a plain "cup", the food's own cup (`gramsPerMl`): a clause end that
 *  would leave fewer than half the allowance is passed over for the last space,
 *  and a bracket whose dropping would do the same is closed instead ("unit (yield
 *  from 1 lb ready-to-cook…)"). A dangling comma or bracket goes, from a short
 *  name as from a cut one: SR Legacy's own "cup," (fdc 175258) is a cup. */
const MEASURE_NAME_MAX = 40;
const CLAUSE_MIN = MEASURE_NAME_MAX / 2;
const DANGLING = /[\s,;:([{-]+$/u;
const readable = (name: string): string => {
  const whole = name.trim().replace(DANGLING, "");
  // USDA's own text can leave a bracket open ("potato large (3" to 4-1/4" dia."):
  // a short name gets it closed.
  if (whole.length <= MEASURE_NAME_MAX) return whole.lastIndexOf("(") > whole.lastIndexOf(")") ? `${whole})` : whole;
  const cut = whole.slice(0, MEASURE_NAME_MAX);
  const clauseEnd = Math.max(cut.lastIndexOf(" ("), cut.lastIndexOf(","));
  const lastSpace = cut.lastIndexOf(" ");
  // One word longer than the whole allowance has no space to cut at; it is cut
  // where it must be rather than left to overflow the screen.
  const piece = clauseEnd >= CLAUSE_MIN ? cut.slice(0, clauseEnd) : lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  const open = piece.lastIndexOf("(");
  if (open <= piece.lastIndexOf(")")) return piece.replace(DANGLING, "");
  const before = piece.slice(0, open).replace(DANGLING, "");
  return before.length >= CLAUSE_MIN ? before : `${piece.replace(DANGLING, "")}…)`;
};

/** The survey release's own filler rows, which name no amount anyone could pick:
 *  "Guideline amount per fl oz of beverage" and its kind (315 rows in 192 foods,
 *  counted 2026-09-16), and "Quantity not specified" (the importer drops those
 *  already). Matched on the name, amount aside ("1 guideline amount per item"). */
const SURVEY_FILLER = /^(?:guideline amount|quantity not specified)/i;

/** Whether a USDA row is a household measure a person can pick: its amount is
 *  known, and it is no survey filler. SR Legacy writes an amount of 0 on 18 rows
 *  (counted 2026-09-16) whose gram weight is no amount of what the text names —
 *  frozen kale's "package (10 oz)" at 94 g beside its real 284 g — so a row with
 *  an amount of 0 is a measure only where its own text states the amount. */
export function isHouseholdMeasure(portion: Pick<UsdaPortion, "amount" | "unit">): boolean {
  if (portion.amount === 0 && !LEADING_AMOUNT.test(portion.unit.trim())) return false;
  return !SURVEY_FILLER.test(usdaMeasureName(portion));
}

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
 *  has no USDA entry, or the table is not loaded. `ownServing` is false for a food
 *  of the USDA table, whose serving is one of those measures by construction
 *  (`usdaServing`), and so is never a measure of its own. */
export interface MeasureSource {
  serving: number;
  unit: string;
  portions: readonly UsdaPortion[];
  ownServing: boolean;
}

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
/** Two weights of one measure, as two tables round them. */
const sameWeight = (a: number, b: number): boolean => Math.abs(a - b) < 0.05;
/** A serving named by weight alone, as our list's "g" foods and a label that
 *  gives only grams or millilitres are ("30 g", "250 ml"). */
const byWeight = (unit: string): boolean => sameName(unit, "g") || sameName(unit, "ml");

/** A serving of one ounce, as two tables round it (28 g on our list, 28.35 g on
 *  USDA's): within half a gram of the international ounce. */
const isOneOunce = (grams: number): boolean => Math.abs(grams - OUNCE.grams) <= 0.5;

/** A food's own serving as a measure, or null where another measure already is
 *  it: grams cover a serving of 100 g by weight (and a label that gives no weight
 *  reads as that, `servingOf`), the ounce covers an "oz" serving, and a USDA
 *  measure of the same NAME is that measure, whatever either table rounds its
 *  weight to — our milk's "cup" of 240 g beside USDA's 244 was two cups on one
 *  list. A serving by weight is called "serving". */
function servingMeasure(source: MeasureSource, usda: readonly FoodMeasure[]): FoodMeasure | null {
  const { serving, unit } = source;
  if (!source.ownServing || !(serving > 0 && serving <= MAX_ITEM_GRAMS)) return null;
  if (byWeight(unit)) return serving === 100 ? null : { id: "serving", name: "serving", grams: serving };
  if (sameName(unit, OUNCE.name) || unit.trim() === "") return null;
  if (usda.some((m) => sameName(m.name, unit))) return null;
  return { id: "serving", name: unit.trim().slice(0, 60), grams: serving };
}

/** Every measure the food can be logged by, in the order a picker shows them: its
 *  own serving, USDA's measures in USDA's own order, grams, ounces. A USDA row that
 *  is no household measure (`isHouseholdMeasure`), weighs nothing or more than one
 *  item of a meal may, is plainly grams or an ounce, or repeats an earlier one's
 *  name and weight (SR Legacy lists beef jerky's "oz" twice), is left out. Two USDA
 *  measures of one name and two weights stay: they are USDA's own two sizes (a
 *  granola bar of 21 g and one of 25), told apart by their grams. */
export function foodMeasures(source: MeasureSource): FoodMeasure[] {
  const usda: FoodMeasure[] = [];
  for (const portion of source.portions) {
    if (!isHouseholdMeasure(portion)) continue;
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
 *  once; else the USDA measure its serving names — of the same weight first, then
 *  of the same name (the one that took the serving's place); else a USDA food's
 *  first measure; an ounce, for a serving of one ounce; else the serving's grams
 *  (dark chocolate served by 30 g starts at 30 g, not at an ounce's 28). */
export function startingMeasure(source: Pick<MeasureSource, "serving" | "unit" | "ownServing">, measures: readonly FoodMeasure[]): { measure: string; amount: number } {
  const { serving, unit } = source;
  const usda = measures.filter((m) => m.id.startsWith("usda-"));
  const own = measures.find((m) => m.id === "serving") ??
    usda.find((m) => sameName(m.name, unit) && sameWeight(m.grams, serving)) ??
    usda.find((m) => sameName(m.name, unit)) ??
    (source.ownServing ? undefined : usda[0]);
  if (own !== undefined) return { measure: own.id, amount: 1 };
  if (sameName(unit, OUNCE.name) && isOneOunce(serving)) return { measure: OUNCE.id, amount: 1 };
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
