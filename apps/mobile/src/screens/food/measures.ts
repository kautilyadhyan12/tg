import { count } from "../dashboard/words";
import { MAX_ITEM_GRAMS, isCountMeasure, isWeightMeasure, type ChosenItem, type FoodMeasure, type FoodSearchItem, type MealItem } from "@app/shared";

// Adding a food by one of its own measures, as the browser does (apps/web/src/components/nutrition/
// measures.js, RULINGS 2026-09-16). The SERVER works out every gram and calorie from its own list of
// the food's measures: these only shape what the picker offers, what it sends, and how an item reads.
// A saved dish is a measure too (32b-ii-b): its key is "dish:" and its id, its amount how full it was.

/** What the picker holds: one of the food's measures and the amount as typed. */
export interface Amount {
  measure: string;
  amount: string;
  /** The meal was eaten from one dish: this food's part of it (33b-i). */
  share?: number | undefined;
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

/** How full a dish was, in words, never as a fraction (Kd, RULINGS 2026-09-17): nothing is picked
 *  until the person picks it (Kd, 2026-07-18). */
export const FILL_CHOICES = [
  { label: "Quarter", words: "quarter full", value: 0.25 },
  { label: "Half", words: "half full", value: 0.5 },
  { label: "Three quarters", words: "three quarters full", value: 0.75 },
  { label: "Full", words: "full", value: 1 },
] as const;

const DISH_KEY = "dish:";
/** No measure picked: the one picked was tapped again (Kd, 32b-ii-b). The amount waits for one. */
export const NO_MEASURE = "";
/** A saved dish as the picker's measure. */
export const dishMeasure = (id: string): string => `${DISH_KEY}${id}`;
/** The saved dish a measure names, or null for a food's own measure. */
export const dishOf = (measure: string): string | null => (measure.startsWith(DISH_KEY) ? measure.slice(DISH_KEY.length) : null);

/** What is sent for the food, or null while the amount is no amount. A dish is sent with how full it
 *  was, and is no amount until that is picked. */
export function chosenItem(canonical: string, amount: Amount): ChosenItem | null {
  if (amount.measure === NO_MEASURE) return null;
  const dish = dishOf(amount.measure);
  if (dish !== null) {
    const fill = FILL_CHOICES.find((f) => String(f.value) === amount.amount);
    if (fill === undefined) return null;
    return { canonical, dishwareId: dish, fillLevel: fill.value, ...(amount.share === undefined ? {} : { share: amount.share }) };
  }
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
  unknown_dishware: "That dish isn't saved any more. Pick another measure.",
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
  // A pack sold by volume says its own size: a litre of oil is not 1000 g.
  if (measure.id === "pack" && measure.name.endsWith(" ml)")) return measure.name;
  return `${measure.name} · ${formatAmount(measure.grams)} g`;
}

/** A logged item's amount, in the browser's words: "1.5 × cup · 237 g", "60 g", "My bowl, half full · 180 g". */
export function loggedAmount(item: Pick<MealItem, "measure" | "gramsPoint">): string {
  const grams = `${String(Math.round(item.gramsPoint))} g`;
  const m = item.measure;
  if (m === undefined || m.id === "g") return grams;
  if (m.id === "dish") {
    const fill = FILL_WORDS[m.amount];
    // Its part of a dish the whole meal was eaten from.
    if (m.share !== undefined) return `Part of ${m.name}${fill === undefined ? "" : `, ${fill}`} · ${grams}`;
    return fill === undefined ? `${formatAmount(m.amount)} × ${m.name} · ${grams}` : `${m.name}, ${fill} · ${grams}`;
  }
  if (m.id === "oz") return `${formatAmount(m.amount)} oz · ${grams}`;
  return `${formatAmount(m.amount)} × ${m.name} · ${grams}`;
}

const FILL_WORDS: Readonly<Record<number, string>> = Object.fromEntries(FILL_CHOICES.map((f) => [f.value, f.words]));

/** How many of a food's counts are offered before "More measures": the food and a few sizes. */
export const FIRST_COUNTS = 4;

/** The measures offered first, as a person thinks of the food (Kd, 32b-ii-b: "cup, quartered or
 *  chopped, cup slices and many more" confused him): its counts — an apple, a large one, a medium
 *  one — or, where it has none, its first cup or spoon; then grams; and the one picked where it is
 *  none of those. The rest wait behind More measures, in the server's order; every one once the
 *  person asks for more. */
export function shownMeasures(measures: readonly FoodMeasure[], picked: string | null, all: boolean): FoodMeasure[] {
  const own = measures.filter((m) => m.id !== "g" && m.id !== "oz");
  // Two counts of one weight are one choice offered twice ("egg · 46 g", "large · 46 g"): the first.
  const counts = own
    .filter((m) => isCountMeasure(m.name))
    .filter((m, i, all) => !all.slice(0, i).some((e) => Math.abs(e.grams - m.grams) < 0.5))
    .slice(0, FIRST_COUNTS);
  const scoop = own.find((m) => !isCountMeasure(m.name) && !isWeightMeasure(m.name));
  const first = counts.length > 0 ? counts : scoop === undefined ? [] : [scoop];
  const main = measures.filter((m) => first.includes(m) || m.id === "g" || m.id === picked);
  const rest = measures.filter((m) => !main.includes(m));
  // One more is shown, never hidden behind a link of its own.
  return all || rest.length <= 1 ? [...main, ...rest] : main;
}

/** A found food as the search lists it: the server's calories at the amount it starts at, as a person
 *  counts it ("94 kcal · 1 apple"), never per 100 g. */
export function startWords(food: Pick<FoodSearchItem, "startsKcal" | "measures" | "startsAt">): string {
  const m = food.measures.find((x) => x.id === food.startsAt.measure);
  const amount = food.startsAt.amount;
  const grams = (m?.grams ?? 1) * amount;
  // A measure that says its own amount ("half cup", "2 tbsp") is not "1 half cup".
  const named = amount === 1 && /^(?:\d|half\b|quarter\b)/i.test(m?.name ?? "");
  const words =
    m === undefined || m.id === "g" ? `${formatAmount(grams)} g` : m.id === "oz" ? `${formatAmount(amount)} oz` : named ? m.name : `${formatAmount(amount)} ${m.name}`;
  return `${count(food.startsKcal)} kcal · ${words}`;
}
