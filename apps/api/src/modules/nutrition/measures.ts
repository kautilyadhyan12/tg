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
 *  (`usdaServing`), and for a scan's estimate, whose serving is only the grams the
 *  photo saw: neither is ever a measure of its own. */
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

/** A measure of the serving's own name is that serving, as another table weighs
 *  it, where it is within a tenth of the serving's weight: our milk's "cup" of
 *  240 g and USDA's 244, almond milk's 240 and 262. Further off it is another size
 *  of that name — our blueberry muffin of 113 g and USDA's "muffin" of 31 g. */
const nearServing = (serving: number, grams: number): boolean => Math.abs(grams - serving) <= serving / 10;

/** A food's own serving as a measure, or null where another measure already is
 *  it: grams cover a serving of 100 g by weight (and a label that gives no weight
 *  reads as that, `servingOf`), the ounce covers an "oz" serving, and a USDA
 *  measure of the same NAME near its weight (`nearServing`) is that measure — two
 *  cups of 240 and 244 g on one list are one cup. A same-named USDA measure of
 *  another size stays beside it, told apart by its grams. A serving by weight is
 *  called "serving". */
function servingMeasure(source: MeasureSource, usda: readonly FoodMeasure[]): FoodMeasure | null {
  const { serving, unit } = source;
  if (!source.ownServing || !(serving > 0 && serving <= MAX_ITEM_GRAMS)) return null;
  if (byWeight(unit)) return serving === 100 ? null : { id: "serving", name: "serving", grams: serving };
  if (sameName(unit, OUNCE.name) || unit.trim() === "") return null;
  if (usda.some((m) => sameName(m.name, unit) && nearServing(serving, m.grams))) return null;
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

/** The measure and amount a food starts at when it is picked — its serving, by
 *  whichever measure is it: its own serving once; else the USDA measure of its
 *  serving's name nearest its weight (the one that took the serving's place, or,
 *  where the serving's own row is no measure, the nearest size of that name). A
 *  serving of "oz" starts at one ounce where it weighs one, else at its grams (dark
 *  chocolate served by 30 g starts at 30 g, not at an ounce's 28), never at another
 *  measure: a graham cracker crust served by the ounce is not its 183 g crust. Only
 *  then a USDA food's first measure; else the serving's grams. */
export function startingMeasure(source: Pick<MeasureSource, "serving" | "unit" | "ownServing">, measures: readonly FoodMeasure[]): { measure: string; amount: number } {
  const { serving, unit } = source;
  const usda = measures.filter((m) => m.id.startsWith("usda-"));
  const nearest = usda
    .filter((m) => sameName(m.name, unit))
    .sort((a, b) => Math.abs(a.grams - serving) - Math.abs(b.grams - serving))[0];
  const own = measures.find((m) => m.id === "serving") ?? nearest;
  if (own !== undefined) return { measure: own.id, amount: 1 };
  const grams = { measure: GRAM.id, amount: serving > 0 && serving <= MAX_ITEM_GRAMS ? serving : 100 };
  if (sameName(unit, OUNCE.name)) return isOneOunce(serving) ? { measure: OUNCE.id, amount: 1 } : grams;
  const first = source.ownServing ? undefined : usda[0];
  return first === undefined ? grams : { measure: first.id, amount: 1 };
}

/** The grams `amount` of a measure weighs, to the whole gram. */
export const measureGrams = (measure: FoodMeasure, amount: number): number => Math.round(amount * measure.grams);

/** How near the grams the photo saw a scanned food's count of one of its measures
 *  must come for its row to start at that measure, in percent of those grams
 *  (RULINGS 2026-09-16, the portion redesign). Kd picked 30 % over three times: on
 *  his eight plates the model writes a count of 1 for almost every food, and within
 *  3× his 100 g of scrambled eggs was one large egg (61 g) and his 250 g mug of iced
 *  coffee USDA's "medium" (496 g). The "or 10 g" that came with it went on
 *  2026-09-17 (RULINGS): it started 10 g of almonds, counted 1, at one 1 g almond. */
export const SCAN_START_TOLERANCE_PERCENT = 30;

/** Where a scanned row starts: the measure and amount, what they weigh, and whether
 *  that is an estimate — no measure the photo's count agreed with. */
export interface ScanStart { measure: string; amount: number; grams: number; estimated: boolean }

/** Where a food the photo scan saw starts on the photo sheet (RULINGS 2026-09-16):
 *  at the photo's count of one of its own measures where that weighs within
 *  `SCAN_START_TOLERANCE_PERCENT` of the grams the photo saw, as the row will weigh
 *  it (to the whole gram) — the nearest such measure, the earlier in the food's
 *  list where two are as near — else at those grams, an estimate, so no row starts
 *  further than that from what the photo saw. Grams and ounces are units of weight, not
 *  anything a photo counts, so a count is never of them. A measure's count is only
 *  a start the save would take: no more than one item of a meal may weigh (one
 *  that rounds to no gram at all is 100 % from any grams, so never near). Where
 *  the photo gave no count there is nothing to multiply; where
 *  it gave no weight there is nothing to check a count against, so the food starts
 *  where Add food starts it (`startingMeasure`), an estimate too. No word of the
 *  food's name is read: the grams decide. */
export function scanStart(
  source: Pick<MeasureSource, "serving" | "unit" | "ownServing">,
  measures: readonly FoodMeasure[],
  count: number | null,
  seenGrams: number | null,
): ScanStart {
  if (seenGrams === null) {
    const start = startingMeasure(source, measures);
    const measure = measures.find((m) => m.id === start.measure) ?? GRAM;
    return { ...start, grams: measureGrams(measure, start.amount), estimated: true };
  }
  let best: (ScanStart & { off: number }) | null = null;
  for (const measure of measures) {
    if (count === null || measure.id === GRAM.id || measure.id === OUNCE.id) continue;
    const grams = measureGrams(measure, count);
    const off = Math.abs(grams - seenGrams);
    // In whole percents, so 30 % of whole grams is exact: 60 g off 200 g is near.
    if (grams > MAX_ITEM_GRAMS || 100 * off > SCAN_START_TOLERANCE_PERCENT * seenGrams) continue;
    if (best === null || off < best.off) best = { measure: measure.id, amount: count, grams, estimated: false, off };
  }
  if (best !== null) return { measure: best.measure, amount: best.amount, grams: best.grams, estimated: false };
  const seen = Math.min(MAX_ITEM_GRAMS, Math.max(1, Math.round(seenGrams)));
  return { measure: GRAM.id, amount: seen, grams: seen, estimated: true };
}

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
 *  the food weighs. The ONE saved-dish formula, read wherever a person picks a
 *  dish as a measure (service.ts); a scan never picks one for them (RULINGS
 *  2026-07-18). */
export function dishwareGrams(volumeMl: number, fillLevel: number, gramsPerMlOfFood: number): number {
  return Math.round(volumeMl * fillLevel * gramsPerMlOfFood);
}
