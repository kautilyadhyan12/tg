import { MEAL_MOST_FOODS, MOST_PLAN_MEALS, planItemChoice } from '@app/shared';

// THE MEAL PLANS A GYM GIVES ITS MEMBERS, the console's words and rules (ROADMAP Stage 2 24a-i;
// spec Part 6 §16.6). A plan is written as the phone's own meal plan is: a week, Monday first,
// a day at a time; meals of Breakfast, Lunch, Dinner or Snack; foods from the food list by
// grams or one of their own measures, or a food of the writer's own with its protein, carbs and
// fat. Every number shown is the server's.

export function canManagePlans(privileges) {
  return Array.isArray(privileges) && privileges.includes('plans.manage');
}

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The phone's own names, in its own order. */
export const MEAL_TYPES = [
  { type: 'breakfast', name: 'Breakfast' },
  { type: 'lunch', name: 'Lunch' },
  { type: 'dinner', name: 'Dinner' },
  { type: 'snack', name: 'Snack' },
];
export const mealTypeName = (type) => MEAL_TYPES.find((m) => m.type === type)?.name ?? 'Meal';
export { MEAL_MOST_FOODS, MOST_PLAN_MEALS };

const whole = (n) => Math.round(n).toLocaleString('en-US');
export const formatAmount = (n) => String(Math.round(n * 100) / 100);

/** A day's or a meal's numbers, in one line. */
export function numbersLine({ kcal, proteinG, carbsG, fatG }) {
  return `${whole(kcal)} kcal · ${whole(proteinG)} g protein · ${whole(carbsG)} g carbs · ${whole(fatG)} g fat`;
}

export const mealNumbers = (totals) => ({ kcal: totals.kcalPoint, proteinG: totals.proteinG, carbsG: totals.carbsG, fatG: totals.fatG });

/** How many meals the week holds. */
export function mealsLine(n) {
  if (n === 0) return 'No meals yet';
  return n === 1 ? '1 meal a week' : `${String(n)} meals a week`;
}

function dayOf(iso, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso));
  }
}

/** Who wrote it and when it last changed, on the gym's own calendar. */
export function byLine(plan, timeZone) {
  const when = dayOf(plan.updatedAt, timeZone);
  const by = plan.writtenBy === null ? null : `By ${plan.writtenBy}`;
  const changed = plan.changedBy !== null && plan.changedBy !== plan.writtenBy ? `Changed ${when} by ${plan.changedBy}` : `Changed ${when}`;
  return by === null ? changed : `${by} · ${changed}`;
}

/** A food's amount as the phone writes it: "118 g", "2 × medium (7" to 7-7/8" long) · 236 g". */
export function itemAmount(item) {
  const grams = `${String(Math.round(item.gramsPoint))} g`;
  const m = item.measure;
  if (m === undefined || m.id === 'g' || m.id === 'dish') return grams;
  if (m.id === 'oz') return `${formatAmount(m.amount)} oz · ${grams}`;
  return `${formatAmount(m.amount)} × ${m.name} · ${grams}`;
}

let rowCounter = 0;
const rowKey = () => `row-${String(++rowCounter)}`;

/** A food of a meal already in the plan, as the meal's box holds it. `measures`: the food's own,
 *  read from the server, or null while they are not read. Kept as it was until it is changed. */
export function rowOfItem(item, measures) {
  if (item.nutritionSource === 'own') {
    return { key: rowKey(), kind: 'own', name: item.name, grams: item.gramsPoint, per100g: item.per100g ?? null, item, changed: false };
  }
  const measure = item.measure !== undefined && item.measure.id !== 'dish' ? item.measure.id : 'g';
  const amount = measure === 'g' ? Math.round(item.gramsPoint) : item.measure.amount;
  return { key: rowKey(), kind: 'list', name: item.name, canonical: item.canonical, measures: measures ?? null, measure, amount, item, changed: false };
}

/** A food picked from the search, at the amount it starts at. */
export function rowOfFood(food) {
  return {
    key: rowKey(),
    kind: 'list',
    name: food.name,
    canonical: food.canonical,
    measures: food.measures,
    measure: food.startsAt.measure,
    amount: food.startsAt.amount,
    item: null,
    changed: true,
  };
}

/** The writer's own food, as typed: its name, the grams and its protein, carbs and fat for them. */
export function rowOfOwn({ name, grams, proteinG, carbsG, fatG }) {
  const g = Number(grams);
  return {
    key: rowKey(),
    kind: 'own',
    name: name.trim(),
    grams: g,
    per100g: { proteinG: (Number(proteinG) * 100) / g, carbsG: (Number(carbsG) * 100) / g, fatG: (Number(fatG) * 100) / g },
    item: null,
    changed: true,
  };
}

/** Why an own food cannot be added, in one sentence, or null. */
export function ownFoodProblem({ name, grams, proteinG, carbsG, fatG }) {
  if (name.trim() === '') return 'Give the food a name.';
  const g = Number(grams);
  if (!Number.isFinite(g) || g <= 0) return 'Enter how many grams.';
  const parts = [proteinG, carbsG, fatG].map((v) => (v === '' ? 0 : Number(v)));
  if (parts.some((v) => !Number.isFinite(v) || v < 0)) return 'Enter protein, carbs and fat as numbers of grams.';
  if (parts.reduce((a, b) => a + b, 0) > g) return 'Protein, carbs and fat together can’t weigh more than the food.';
  return null;
}

/** An own food's protein, carbs and fat at its grams, as the phone sends them. */
function ownAt(per100g, grams) {
  const at = (per100, round) => round(((per100 * grams) / 100) * 1e6) / 1e6;
  const own = (round) => ({ proteinG: at(per100g.proteinG, round), carbsG: at(per100g.carbsG, round), fatG: at(per100g.fatG, round) });
  const typed = own(Math.round);
  return typed.proteinG + typed.carbsG + typed.fatG <= grams ? typed : own(Math.floor);
}

/** What the server is sent for one food of the box. A food unchanged is sent as it was saved. */
export function choiceOf(row) {
  if (!row.changed && row.item !== null) return planItemChoice(row.item);
  if (row.kind === 'own') return { name: row.name.slice(0, 80), grams: row.grams, own: ownAt(row.per100g ?? { proteinG: 0, carbsG: 0, fatG: 0 }, row.grams) };
  return row.measure === 'g' ? { canonical: row.canonical, grams: row.amount } : { canonical: row.canonical, measure: row.measure, amount: row.amount };
}

/** Where a meal goes in a day as people eat them, the phone's own order: breakfast, lunch, a snack, dinner. */
const MEAL_ORDER = { breakfast: 0, lunch: 1, snack: 2, dinner: 3 };

/** A day's meals with a new one put in its place: after the last meal that comes before or with it. */
function withNewMeal(meals, meal) {
  let at = 0;
  meals.forEach((m, i) => {
    if (MEAL_ORDER[m.mealType] <= MEAL_ORDER[meal.mealType]) at = i + 1;
  });
  return [...meals.slice(0, at), meal, ...meals.slice(at)];
}

/** The meal of the day a new Breakfast, Lunch or Dinner goes into: the day's own one where it has it, so
 *  its foods join it. A snack is a meal of its own each time: two a day is usual. -1 for a new meal. */
export function mealToJoin(day, mealType) {
  return mealType === 'snack' ? -1 : day.meals.findIndex((m) => m.mealType === mealType);
}

/** A day's meals as the server takes them, with one meal changed (`at`), added (`at` null) or
 *  removed (`rows` null). */
export function dayMeals(day, at, mealType, rows) {
  const kept = day.meals.map((m) => ({ mealType: m.mealType, items: m.items.map(planItemChoice) }));
  if (rows === null) return kept.filter((_, i) => i !== at);
  const meal = { mealType, items: rows.map(choiceOf) };
  return at === null ? withNewMeal(kept, meal) : kept.map((m, i) => (i === at ? meal : m));
}

/** A measure's name in the amount box. */
export function measureLabel(m) {
  if (m.id === 'g') return 'grams';
  if (m.id === 'oz') return 'ounces';
  return `${m.name} (${formatAmount(m.grams)} g)`;
}

/** What a food of the search says beside its name: its calories at the amount it starts at. */
export function foodLine(food) {
  const m = food.measures.find((x) => x.id === food.startsAt.measure);
  const amount = m === undefined || m.id === 'g' ? `${formatAmount(food.startsAt.amount)} g` : `${formatAmount(food.startsAt.amount)} × ${m.name}`;
  return `${whole(food.startsKcal)} kcal · ${amount}`;
}

/** A packaged food's allergens, as its pack lists them, or null. */
export function allergensLine(food) {
  const listed = food.packaged?.allergens ?? [];
  return listed.length === 0 ? null : `Contains ${listed.join(', ')}`;
}

export const PLAN_WORDS = {
  pageSub: (words) => `Meal plans you write for your ${words.people}.`,
  none: 'No meal plans yet. Write your first one with New meal plan.',
  created: (name) => `${name} is ready. Add its meals, a day at a time.`,
  renamed: 'Name saved.',
  deleted: (name) => `${name} was deleted.`,
  mealSaved: (meal, day) => `${meal} saved to ${day}.`,
  mealRemoved: (meal, day) => `${meal} removed from ${day}.`,
  dayEmpty: (day) => `No meals on ${day} yet.`,
  dayFull: `A day holds ${String(MOST_PLAN_MEALS)} meals at most.`,
  mealFull: `A meal holds ${String(MEAL_MOST_FOODS)} foods at most.`,
  deleteAsk: (name) => `Delete ${name}?`,
  deleteWhy: 'Its meals are deleted with it. This can’t be undone.',
  leaveAsk: 'Save your changes?',
  leaveWhy: (meal, day) => `Your changes to ${meal} on ${day} aren’t saved yet.`,
};
