import {
  measureIdSchema,
  type FoodMeasure,
  type Meal,
  type MealEditItem,
  type MealItem,
  type MealType,
  type WaitingChange,
  type WaitingMeal,
} from "@app/shared";
import { itemMark, sectionOf } from "./day";
import { FILL_CHOICES, formatAmount, loggedAmount, type Amount } from "./measures";

// A meal on the day's list, and how a change to it reads while it waits to be sent (ROADMAP 32b-ii-a).
// Every number is the server's: a meal's foods changed with no signal have no numbers until it is sent.

/** One meal on the day's list: the server's, or one still waiting on the phone. */
export interface Row {
  id: string;
  name: string;
  takenAt: string;
  mealType: MealType | null;
  section: MealType;
  items: MealItem[] | null;
  totals: Meal["totals"] | null;
  /** Something about it waits to be sent: the meal itself, or a change to it. */
  waiting: boolean;
  /** The meal as the server has it, whose foods a change names by place; null while it waits to be sent. */
  saved: { items: MealItem[]; itemsVersion: string } | null;
  /** The newest change to its foods still waiting to be sent: its foods read from it. */
  foodsChange: WaitingChange | null;
}

export function serverRow(meal: Meal): Row {
  return {
    id: meal.id,
    name: meal.mealName ?? meal.items[0]?.name ?? "Meal",
    takenAt: meal.takenAt,
    mealType: meal.mealType,
    section: sectionOf(meal),
    items: meal.items,
    totals: meal.totals,
    waiting: false,
    saved: { items: meal.items, itemsVersion: meal.itemsVersion },
    foodsChange: null,
  };
}

export function waitingRow(meal: WaitingMeal): Row {
  const mealType = meal.body.mealType ?? null;
  return {
    id: meal.id,
    name: meal.body.mealName,
    takenAt: meal.body.takenAt,
    mealType,
    section: sectionOf({ mealType, takenAt: meal.body.takenAt }),
    items: meal.items,
    totals: meal.totals,
    waiting: true,
    saved: null,
    foodsChange: null,
  };
}

/** The meal as its changes still waiting leave it, in the order they were made. */
export function withChanges(row: Row, changes: readonly WaitingChange[] | undefined): Row {
  if (changes === undefined || changes.length === 0) return row;
  const next: Row = { ...row, waiting: true };
  for (const change of changes) {
    const body = change.body;
    if (body.mealName !== undefined) next.name = body.mealName;
    if (body.takenAt !== undefined) next.takenAt = body.takenAt;
    if (body.mealType !== undefined) next.mealType = body.mealType;
    if (body.items !== undefined) {
      next.items = change.items;
      next.totals = change.totals;
      next.foodsChange = change;
    }
  }
  next.section = sectionOf({ mealType: next.mealType, takenAt: next.takenAt });
  return next;
}

/** One of a meal's foods as its box reads: its name, its amount, and its calories where known. */
export interface FoodLine {
  name: string;
  /** Where the name is what the photo saw: the food its numbers are from, and that food's source (33b-ii). */
  numbersFrom: { name: string; source: MealItem["nutritionSource"] } | null;
  amount: string;
  kcal: number | null;
}

/** What a logged food is called: what the photo saw, where that is not its food's name (33b-ii). */
export const foodTitle = (item: Pick<MealItem, "name" | "seenAs">): string => item.seenAs ?? item.name;

const lineOf = (item: MealItem): FoodLine => ({
  name: foodTitle(item),
  numbersFrom: item.seenAs === undefined ? null : { name: item.name, source: item.nutritionSource },
  amount: loggedAmount(item) + itemMark(item),
  kcal: item.kcalPoint,
});

export function foodLines(row: Row): FoodLine[] {
  const change = row.foodsChange;
  if (change === null) return (row.items ?? []).map(lineOf);
  if (change.items !== null) return change.items.map(lineOf);
  return (change.foods ?? []).map((f) => ({ name: f.name, numbersFrom: null, amount: f.amount, kcal: null }));
}

/** Whether the meal's foods can be changed now, and if not, why: a meal still waiting to be sent has
 *  no foods on the server to name, and a change to its foods still waiting was made from foods the
 *  server may already have changed. */
export function foodsHeld(row: Row): "not_sent" | "change_waiting" | null {
  if (row.saved === null) return "not_sent";
  if (row.foodsChange !== null) return "change_waiting";
  return null;
}

/** A logged food's amount as the picker starts it: its own measure where the food list names it, else
 *  its grams. */
export function amountOf(item: MealItem): Amount {
  const m = item.measure;
  if (m !== undefined && m.id !== "g" && measureIdSchema.safeParse(m.id).success) return { measure: m.id, amount: formatAmount(m.amount) };
  return { measure: "g", amount: String(Math.max(1, Math.round(item.gramsPoint))) };
}

/** The measures a logged food is offered with no answer from the server: grams, and its own measure. */
export function measuresWithoutServer(item: MealItem): FoodMeasure[] {
  const grams: FoodMeasure = { id: "g", name: "g", grams: 1 };
  const start = amountOf(item);
  const own = item.measure;
  if (start.measure === "g" || own === undefined || own.amount <= 0) return [grams];
  return [grams, { id: own.id, name: own.name, grams: item.gramsPoint / own.amount }];
}

/** The meal's foods with food `at` at a new amount: every other food named as it was saved. */
export function withAmount(
  saved: readonly MealItem[],
  at: number,
  canonical: string,
  amount: { measure: string; amount: number } | { dishwareId: string; fillLevel: number },
): MealEditItem[] {
  return saved.map((_, i): MealEditItem => (i === at ? { from: i, canonical, ...amount } : { from: i }));
}

/** The meal's foods less food `at`. */
export function without(saved: readonly MealItem[], at: number): MealEditItem[] {
  return saved.flatMap((_, i): MealEditItem[] => (i === at ? [] : [{ from: i }]));
}

/** What foods come to: the sum of the server's own numbers for each. */
export function totalsOf(items: readonly MealItem[]): Meal["totals"] {
  const sum = (pick: (item: MealItem) => number) => items.reduce((n, item) => n + pick(item), 0);
  return {
    kcalPoint: sum((i) => i.kcalPoint),
    kcalLow: sum((i) => i.kcalLow),
    kcalHigh: sum((i) => i.kcalHigh),
    proteinG: sum((i) => i.proteinG),
    carbsG: sum((i) => i.carbsG),
    fatG: sum((i) => i.fatG),
  };
}

/** What the meal comes to without food `at`. */
export const totalsWithout = (saved: readonly MealItem[], at: number): Meal["totals"] => totalsOf(saved.filter((_, i) => i !== at));

/** A new amount as it reads before the server has weighed it: "3 × roti", "150 g", "2 oz". */
export function typedAmount(measure: FoodMeasure | undefined, amount: number, dish: { label: string } | null = null): string {
  if (dish !== null) return `${dish.label}, ${FILL_CHOICES.find((f) => f.value === amount)?.words ?? "how full not picked"}`;
  if (measure === undefined || measure.id === "g") return `${formatAmount(amount)} g`;
  if (measure.id === "oz") return `${formatAmount(amount)} oz`;
  return `${formatAmount(amount)} × ${measure.name}`;
}

/** The step of the meal's time: a quarter of an hour, as standard time pickers step. */
export const TIME_STEP_MINUTES = 15;

/** The meal's time one step earlier (-1) or later (+1), never off its own day. */
export function steppedTime(takenAt: string, direction: 1 | -1): string {
  const at = new Date(takenAt);
  const next = new Date(at.getTime() + direction * TIME_STEP_MINUTES * 60_000);
  if (next.getFullYear() !== at.getFullYear() || next.getMonth() !== at.getMonth() || next.getDate() !== at.getDate()) return at.toISOString();
  return next.toISOString();
}

/** "8:30 AM", in the phone's own time. */
export function clockWords(takenAt: string): string {
  const at = new Date(takenAt);
  const h = at.getHours();
  const m = at.getMinutes();
  return `${String(h % 12 === 0 ? 12 : h % 12)}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
