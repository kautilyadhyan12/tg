import { MAX_ITEM_GRAMS, type ChosenItem, type FoodMeasure, type FoodSearchItem, type MealItem } from "@app/shared";

// Adding a food by one of its own measures, as the browser does (apps/web/src/components/nutrition/
// measures.js, RULINGS 2026-09-16). The SERVER works out every gram and calorie from its own list of
// the food's measures: these only shape what the picker offers, what it sends, and how an item reads.
// A saved dish as a measure comes with 32b-ii.

/** What the picker holds: one of the food's measures and the amount as typed. */
export interface Amount {
  measure: string;
  amount: string;
}

/** The starting measure the server named, at its amount. */
export function startingAmount(food: Pick<FoodSearchItem, "startsAt">): Amount {
  return { measure: food.startsAt.measure, amount: formatAmount(food.startsAt.amount) };
}

/** Another measure picked: grams start at 100, any other measure at one. */
export function amountFor(measure: FoodMeasure): Amount {
  return { measure: measure.id, amount: measure.id === "g" ? "100" : "1" };
}

/** How far − and + move an amount: ten grams, or half of any other measure. */
const step = (measure: string): number => (measure === "g" ? 10 : 0.5);

/** An amount one step of − (−1) or + (+1) away, on the step's grid, never past the server's bound,
 *  and never below one step — or below a smaller amount the person typed, which − leaves as it is. */
export function stepped(amount: Amount, direction: 1 | -1): Amount {
  const size = step(amount.measure);
  const typed = Number.parseFloat(amount.amount);
  const from = Number.isFinite(typed) && typed > 0 ? typed : 0;
  const next = direction > 0 ? Math.floor(from / size + 1e-9) * size + size : Math.ceil(from / size - 1e-9) * size - size;
  const lowest = from > 0 && from < size ? from : size;
  return { measure: amount.measure, amount: formatAmount(Math.min(MAX_ITEM_GRAMS, Math.max(lowest, next))) };
}

/** What is sent for the food, or null while the amount is no amount. */
export function chosenItem(canonical: string, amount: Amount): ChosenItem | null {
  const n = Number(amount.amount.trim().replace(",", "."));
  if (amount.amount.trim() === "" || !Number.isFinite(n) || n <= 0 || n > MAX_ITEM_GRAMS) return null;
  return { canonical, measure: amount.measure, amount: n };
}

/** Whether the amount comes to less than a gram, which the server weighs to the whole gram and
 *  refuses as nothing (a quarter of a 1.2 g nut). */
export function underAGram(measure: FoodMeasure | undefined, amount: Amount): boolean {
  const n = Number(amount.amount.trim().replace(",", "."));
  return measure !== undefined && Number.isFinite(n) && n > 0 && Math.round(n * measure.grams) < 1;
}

/** The server's refusal of an amount, in the person's words, by its code; null for any other. */
const AMOUNT_REFUSALS: Readonly<Record<string, string>> = {
  portion_out_of_range: "That amount is too small or too large. Pick another amount.",
  unknown_measure: "That measure isn't one of this food's. Pick one from the list.",
};
export const amountRefusal = (error: string): string | null => AMOUNT_REFUSALS[error] ?? null;

/** An amount as a person reads it: no float noise ("1.5", "0.25"). */
export const formatAmount = (n: number): string => String(Math.round(n * 100) / 100);

/** What the amount beside − and + counts, so a number never stands alone. */
export function unitWords(measure: FoodMeasure | undefined): string {
  if (measure === undefined) return "";
  if (measure.id === "g") return "grams";
  if (measure.id === "oz") return "ounces";
  return measure.name;
}

/** A measure as its chip reads: grams and ounces spelled out, any other with what one weighs. */
export function measureWords(measure: FoodMeasure): string {
  if (measure.id === "g") return "grams";
  if (measure.id === "oz") return "ounces";
  return `${measure.name} · ${formatAmount(measure.grams)} g`;
}

/** A logged item's amount, in the browser's words: "1.5 × cup · 237 g", "60 g", "My bowl, half full · 180 g". */
export function loggedAmount(item: Pick<MealItem, "measure" | "gramsPoint">): string {
  const grams = `${String(Math.round(item.gramsPoint))} g`;
  const m = item.measure;
  if (m === undefined || m.id === "g") return grams;
  if (m.id === "dish") {
    const fill = FILL_WORDS[m.amount];
    return fill === undefined ? `${formatAmount(m.amount)} × ${m.name} · ${grams}` : `${m.name}, ${fill} · ${grams}`;
  }
  if (m.id === "oz") return `${formatAmount(m.amount)} oz · ${grams}`;
  return `${formatAmount(m.amount)} × ${m.name} · ${grams}`;
}

const FILL_WORDS: Readonly<Record<number, string>> = { 0.25: "quarter full", 0.5: "half full", 0.75: "three quarters full", 1: "full" };
