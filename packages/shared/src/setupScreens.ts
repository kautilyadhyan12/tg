// Setup's screens, their words and their rules: what each screen asks, when a
// screen counts as answered, the wheels and their units, the words the plan
// panel uses, and the save queue. Moved here from the web's onboardingModel.js
// (ROADMAP Stage 5 item 14a) so the browser and the phone ask the same things in
// the same words. Every NUMBER of the plan is the server's (GET/PATCH
// /v1/users/me/onboarding); nothing here computes a plan.
import type { HealthScreening } from "./health.js";
import type { OnboardingAnswers } from "./onboarding.js";
import {
  MUSCLE_GAIN_PACE,
  PACE_KG_PER_WEEK,
  formulaFor,
  healthyWeightFloorKg,
  planInputsSchema,
  type DayActivity,
  type NoDeficitReason,
  type PlanNumbers,
  type PlanPace,
} from "./plan.js";
import { ORG_TYPES_PHRASE } from "./orgWords.js";
import { ADULT_AGE } from "./users.js";

/** Pounds to kilograms, as the web's weight boxes convert them. */
export const KG_PER_LB = 0.453592;

export type Units = "metric" | "imperial";
type Direction = "lose" | "maintain" | "gain";

/** The answers as the screens read them: the server's, with the taps still on
 *  their way laid over, and screen 8's health answer from its own route. */
export type SetupAnswers = { [K in keyof OnboardingAnswers]?: OnboardingAnswers[K] | undefined } & {
  health?: HealthScreening | null | undefined;
};

interface Row<V> {
  value: V;
  label: string;
}
interface RowWithDesc<V> extends Row<V> {
  desc: string;
}

// ── What the screens offer (each table's values are the shared enum's) ──────

/** Screen 1's weight choice: the one answer that sets the calories. */
export const WEIGHT_GOALS: readonly Row<Direction>[] = [
  { value: "lose", label: "Lose weight" },
  { value: "maintain", label: "Keep my weight" },
  { value: "gain", label: "Gain weight" },
];

type FitnessGoal = OnboardingAnswers["fitnessGoals"][number];
/** Screen 1's "also work on": any number, none of which moves the calories. */
export const GOALS: readonly Row<FitnessGoal>[] = [
  { value: "muscle_gain", label: "Build muscle" },
  { value: "strength", label: "Get stronger" },
  { value: "general_fitness", label: "Get fitter" },
  { value: "endurance", label: "Endurance and running" },
  { value: "flexibility", label: "Flexibility" },
  { value: "posture", label: "Posture" },
  { value: "balance", label: "Better balance" },
  { value: "stress_relief", label: "Stress relief" },
  { value: "stay_healthy", label: "Stay healthy" },
];

export const GENDERS: readonly Row<NonNullable<OnboardingAnswers["gender"]>>[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

export const PACES: readonly Row<PlanPace>[] = [
  { value: "gentle", label: "Gentle" },
  { value: "steady", label: "Steady" },
  { value: "brisk", label: "Brisk" },
];

export const DAYS: readonly RowWithDesc<DayActivity>[] = [
  { value: "sitting", label: "Mostly sitting", desc: "Desk work, driving, studying" },
  { value: "on_feet", label: "On my feet some of the day", desc: "Teaching, shop work, errands" },
  { value: "active", label: "On my feet most of the day", desc: "Nursing, waiting tables, a trade" },
  { value: "very_active", label: "Hard physical work", desc: "Building sites, farming, lifting loads" },
];

export const LEVELS: readonly RowWithDesc<NonNullable<OnboardingAnswers["fitnessLevel"]>>[] = [
  { value: "beginner", label: "Beginner", desc: "New to exercise, or back after a long break" },
  { value: "intermediate", label: "Intermediate", desc: "I train regularly and know most moves" },
  { value: "advanced", label: "Advanced", desc: "I train hard and want a push" },
];

export const TRAINING_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
export const SESSION_MINUTES: readonly number[] = [15, 20, 30, 45, 60, 90];

type Equipment = OnboardingAnswers["availableEquipment"][number];
export const EQUIPMENT: readonly Row<Equipment>[] = [
  { value: "none", label: "No equipment" },
  { value: "dumbbells", label: "Dumbbells" },
  { value: "resistance_bands", label: "Resistance bands" },
  { value: "kettlebells", label: "Kettlebells" },
  { value: "pull_up_bar", label: "Pull-up bar" },
  { value: "gym", label: "A gym" },
];

/** Screen 9's diet, in the order RULINGS 2026-09-10 names them. Each line says
 *  what the meal suggestions may offer; nothing here changes a calorie. */
export const DIETS: readonly RowWithDesc<NonNullable<OnboardingAnswers["diet"]>>[] = [
  { value: "vegetarian", label: "Vegetarian", desc: "No meat or fish. Milk and dairy are fine" },
  { value: "vegetarian_eggs", label: "Vegetarian with eggs", desc: "No meat or fish. Eggs and dairy are fine" },
  { value: "non_vegetarian", label: "Non-vegetarian", desc: "Anything — meat, fish, eggs and dairy" },
  { value: "vegan", label: "Vegan", desc: "No animal food at all" },
];

/** How many sittings the day's food is split across. */
export const MEALS_PER_DAY: readonly number[] = [2, 3, 4, 5, 6];

// ── The screens, and which of them a person still has to answer ─────────────

export type SetupScreenId =
  | "goal"
  | "about"
  | "target"
  | "day"
  | "training"
  | "week"
  | "equipment"
  | "health"
  | "food"
  | "gym"
  | "plan";

export interface SetupScreen {
  id: SetupScreenId;
  title: string;
  desc: string;
}

export const SCREENS: readonly SetupScreen[] = [
  { id: "goal", title: "Your goal", desc: "Pick one from the top row, and any of the rest" },
  { id: "about", title: "About you", desc: "The numbers your plan is built on" },
  { id: "target", title: "Your target", desc: "Where you are heading, and how fast" },
  { id: "day", title: "Your day", desc: "How active you are outside workouts" },
  { id: "training", title: "Your training", desc: "Where you are starting from" },
  { id: "week", title: "Your week", desc: "How often, and for how long" },
  { id: "equipment", title: "Equipment", desc: "What you have to train with" },
  { id: "health", title: "Health", desc: "One question, so your plan is careful" },
  { id: "food", title: "Food", desc: "What you eat, so meals can be suggested" },
  { id: "gym", title: `Your ${ORG_TYPES_PHRASE}`, desc: `Only if a ${ORG_TYPES_PHRASE} invited you` },
  { id: "plan", title: "Your plan", desc: "Check it, adjust anything, then finish" },
];

const answered = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;

/** The direction the calorie maths works in: the weight choice itself. Null
 *  until it is picked. */
export const directionOf = (weightGoal: string | null | undefined): Direction | null =>
  weightGoal === "lose" || weightGoal === "maintain" || weightGoal === "gain" ? weightGoal : null;

/** The side a target weight must be on: 'lose' or 'gain', or null. */
export const targetDirection = (weightGoal: string | null | undefined): "lose" | "gain" | null =>
  weightGoal === "lose" || weightGoal === "gain" ? weightGoal : null;

/** Only a weight choice that moves the weight asks for a target and a pace.
 *  Before one is picked the target screen stays in the list, so the step
 *  count does not jump when "Lose weight" is chosen. */
export const asksTarget = (weightGoal: string | null | undefined): boolean => directionOf(weightGoal) !== "maintain";

/** The screens in the order this person meets them. */
export const visibleScreens = (answers: SetupAnswers): SetupScreen[] =>
  SCREENS.filter((s) => s.id !== "target" || asksTarget(answers.weightGoal));

/** A screen is answered when every question it asks has an answer. Screen 1's
 *  goals may be none and screen 5's push-ups and plank may be "Not sure", so
 *  there only the weight choice and the self-rating count. Screen 8's answer is
 *  the health screening's own (`health.answered`). "Your gym" asks nothing, and
 *  the plan counts as answered exactly when every other screen is. */
export function screenAnswered(id: SetupScreenId, a: SetupAnswers): boolean {
  switch (id) {
    case "goal":
      return answered(a.weightGoal);
    case "about":
      return answered(a.age) && a.age >= ADULT_AGE && answered(a.gender) && answered(a.heightCm) && answered(a.weightKg);
    case "target":
      return (
        !asksTarget(a.weightGoal) ||
        (answered(a.targetWeightKg) &&
          answered(a.pace) &&
          !targetWrongSide(directionOf(a.weightGoal), a.targetWeightKg, a.weightKg))
      );
    case "day":
      return answered(a.dayActivity);
    case "training":
      return answered(a.fitnessLevel);
    case "week":
      return answered(a.trainingDays) && answered(a.sessionMinutes);
    case "equipment":
      return Array.isArray(a.availableEquipment) && a.availableEquipment.length > 0;
    case "health":
      return a.health?.answered === true;
    case "food":
      return answered(a.diet) && answered(a.mealsPerDay);
    case "gym":
      return true;
    case "plan":
      return visibleScreens(a).every((s) => s.id === "plan" || screenAnswered(s.id, a));
  }
}

const lastOf = <T>(list: readonly T[], fallback: T): T => list[list.length - 1] ?? fallback;
const FIRST_SCREEN: SetupScreen = { id: "goal", title: "Your goal", desc: "" };

/** Where a returning person lands: the first screen still unanswered, or the
 *  last one when every screen has its answer. */
export function firstOpenScreen(answers: SetupAnswers): SetupScreenId {
  const screens = visibleScreens(answers);
  return (screens.find((s) => !screenAnswered(s.id, answers)) ?? lastOf(screens, FIRST_SCREEN)).id;
}

/** Where the step bar may jump: every screen up to the first one still
 *  unanswered. A screen past that would skip a question. */
export function reachableScreens(answers: SetupAnswers): Set<SetupScreenId> {
  const screens = visibleScreens(answers);
  const open = screens.findIndex((s) => !screenAnswered(s.id, answers));
  return new Set(screens.slice(0, open === -1 ? screens.length : open + 1).map((s) => s.id));
}

/** The screen that asks each answer the plan can be missing. */
export const SCREEN_OF_MISSING: Readonly<Record<string, SetupScreenId>> = {
  goal: "goal",
  age: "about",
  gender: "about",
  heightCm: "about",
  weightKg: "about",
  targetWeightKg: "target",
  pace: "target",
  dayActivity: "day",
  trainingDays: "week",
  sessionMinutes: "week",
  health: "health",
  diet: "food",
  mealsPerDay: "food",
};

export const MISSING_LABELS: Readonly<Record<string, string>> = {
  goal: "your weight goal",
  age: "your age",
  gender: "your gender",
  heightCm: "your height",
  weightKg: "your weight",
  targetWeightKg: "your target weight",
  pace: "a pace",
  dayActivity: "your day",
  trainingDays: "training days a week",
  sessionMinutes: "session length",
  health: "the health question",
  diet: "your diet",
  mealsPerDay: "how many meals a day",
};

/** The answers SETUP needs that the PLAN's own missing list can never carry, in
 *  screen order: the health question and screen 9's two food answers. Only a
 *  refused finish names them (`missingSetupAnswerSchema`). */
export const SETUP_ONLY_ANSWERS: readonly string[] = ["health", "diet", "mealsPerDay"];

const setupOnlyAnswered = (key: string, a: SetupAnswers): boolean => {
  if (key === "health") return screenAnswered("health", a);
  if (key === "diet") return answered(a.diet);
  return answered(a.mealsPerDay);
};

/** What still stands between this person and Finish: what the server said the
 *  PLAN is missing, plus whichever of the three above are still open. */
export function openSetupAnswers(serverOpen: readonly string[], answers: SetupAnswers): string[] {
  const fromPlan = serverOpen.filter((k) => !SETUP_ONLY_ANSWERS.includes(k));
  return [...fromPlan, ...SETUP_ONLY_ANSWERS.filter((k) => !setupOnlyAnswered(k, answers))];
}

export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${lastOf(items, "")}`;
}

/** The server's missing list in words. An unknown key passes through rather
 *  than being dropped. */
export const missingText = (missing: readonly string[]): string => listText(missing.map((k) => MISSING_LABELS[k] ?? k));

// ── Equipment: "No equipment" stands alone ──────────────────────────────────

const EQUIPMENT_ORDER = EQUIPMENT.map((e) => e.value);
const inOrder = (set: Set<string>): Equipment[] => EQUIPMENT_ORDER.filter((v) => set.has(v));

/** One tap on screen 7. "No equipment" clears the rest, and anything else
 *  clears "No equipment": the server refuses the two together. */
export function toggleEquipment(current: readonly string[], value: Equipment): Equipment[] {
  if (value === "none") return current.includes("none") ? [] : ["none"];
  const next = new Set(current.filter((v) => v !== "none"));
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return inOrder(next);
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** An answer the old form wrote may hold "none" beside real equipment, which
 *  the server now refuses. Loaded, the real equipment wins. */
export function cleanEquipment(loaded: unknown): Equipment[] {
  const set = new Set(strings(loaded));
  if (set.has("none") && set.size > 1) set.delete("none");
  return inOrder(set);
}

// ── Screen 1's goals: any number, and nothing to untick ─────────────────────

const GOAL_ORDER = GOALS.map((g) => g.value);

/** One tap on "also work on": the goal is ticked or unticked, and the list
 *  keeps the screen's order. */
export function toggleGoal(current: unknown, value: FitnessGoal): FitnessGoal[] {
  const next = new Set(strings(current));
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return GOAL_ORDER.filter((v) => next.has(v));
}

// ── The wheels and their units (Kd, 2026-09-10: nothing typed, nothing
//    pre-filled) ───────────────────────────────────────────────────────────
//
// Each wheel lists whole steps in the units on screen. A stored answer outside
// a list stretches the list to include it. Until the person touches a wheel it
// rests on the row named `…_REST` here, display-only, and reads "Not set";
// nothing is saved until it is moved.

const CM_PER_IN = 2.54;
const round = (n: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** Pounds and feet where the language tag says the US (or one of the two other
 *  countries that weigh in pounds); kilograms and centimetres everywhere else. */
export function defaultUnits(language: unknown): Units {
  return typeof language === "string" && /-(US|LR|MM)$/i.test(language) ? "imperial" : "metric";
}

export function range(from: number, to: number, step = 1): number[] {
  const out: number[] = [];
  for (let v = from; v <= to; v += step) out.push(v);
  return out;
}

/** `list` with `value` added in order, when it is not already on it. */
export function including(list: number[], value: number | null | undefined): number[] {
  if (!answered(value) || list.includes(value)) return list;
  return [...list, value].sort((a, b) => a - b);
}

/** Whole numbers from `from` to `to`, stretched to reach `value`. */
const stretched = (from: number, to: number, value: number | null | undefined): number[] =>
  answered(value) ? range(Math.min(from, value), Math.max(to, value)) : range(from, to);

/** The row a − or + tap lands on: one row along `list`, never off its ends. */
export function stepIn(list: readonly number[], current: number, by: number): number {
  const i = list.indexOf(current);
  return list[Math.max(0, Math.min(list.length - 1, (i === -1 ? 0 : i) + by))] ?? current;
}

export const AGE_REST = 30;
/** 18 to 120: the server's rails. An age kept from before is still shown. */
export const ageList = (age: number | null | undefined): number[] => stretched(ADULT_AGE, 120, age);

export interface WeightParts {
  whole: number;
  tenth: number;
}

/** Weight: whole kilograms or pounds on one column, tenths on the other. */
export const WEIGHT_REST: Readonly<Record<Units, number>> = { metric: 70, imperial: 154 };
const WEIGHT_WHOLES: Readonly<Record<Units, readonly [number, number]>> = { metric: [30, 250], imperial: [66, 550] };
export const TENTHS: readonly number[] = range(0, 9);

export function weightParts(kg: number, units: Units): WeightParts {
  const tenths = Math.round((units === "imperial" ? kg / KG_PER_LB : kg) * 10);
  return { whole: Math.floor(tenths / 10), tenth: tenths % 10 };
}

/** The kilograms a pair of rows means, to the two decimals the server stores. */
export function kgFromParts({ whole, tenth }: WeightParts, units: Units): number {
  const v = whole + tenth / 10;
  return round(units === "imperial" ? v * KG_PER_LB : v, 2);
}

export function weightWholes(units: Units, whole: number | null | undefined): number[] {
  const [from, to] = WEIGHT_WHOLES[units];
  return stretched(from, to, whole);
}

export const weightShown = ({ whole, tenth }: WeightParts, units: Units): string =>
  `${String(whole)}.${String(tenth)} ${units === "imperial" ? "lb" : "kg"}`;

// ── Screen 3: the target is always on the goal's side of the weight (Kd,
//    2026-09-11) ─────────────────────────────────────────────────────────────

/** A stored target on the wrong side: at or above the weight for a loss, at
 *  or below it for a gain. */
export function targetWrongSide(
  direction: Direction | null,
  targetKg: number | null | undefined,
  weightKg: number | null | undefined,
): boolean {
  if (!answered(targetKg) || !answered(weightKg)) return false;
  return direction === "gain" ? targetKg <= weightKg : targetKg >= weightKg;
}

/** Screen 3's words for such a target, in the units on show. */
export function wrongSideText(direction: Direction | null, targetKg: number, weightKg: number, units: Units): string {
  const side = direction === "gain" ? "above" : "below";
  const shown = (kg: number): string => weightShown(weightParts(kg, units), units);
  return `${shown(targetKg)} is not ${side} your current ${shown(weightKg)}. Pick a weight ${side} it.`;
}

const tenthsOf = ({ whole, tenth }: WeightParts): number => whole * 10 + tenth;
const partsOf = (tenths: number): WeightParts => ({ whole: Math.floor(tenths / 10), tenth: tenths % 10 });

/** The rows the target wheel offers: whole units strictly on the goal's side
 *  of the current weight, stretched to reach `at`. */
export function targetWholes(
  units: Units,
  direction: Direction | null,
  weight: WeightParts,
  at: WeightParts | null = null,
): number[] {
  const [from, to] = WEIGHT_WHOLES[units];
  if (direction === "gain") {
    const min = weight.tenth === 9 ? weight.whole + 1 : weight.whole;
    return range(min, Math.max(to, weight.whole + 1, at?.whole ?? to));
  }
  const max = weight.tenth === 0 ? weight.whole - 1 : weight.whole;
  return range(Math.min(from, max, at?.whole ?? from), max);
}

/** The tenths offered beside `whole`: all ten, except on the weight's own
 *  whole, where only the tenths past it remain. */
export function targetTenths(direction: Direction | null, weight: WeightParts, whole: number): readonly number[] {
  if (whole !== weight.whole) return TENTHS;
  return direction === "gain" ? range(weight.tenth + 1, 9) : range(0, weight.tenth - 1);
}

/** The allowed row nearest the weight: one tenth along the goal's side. */
export const targetEdge = (direction: Direction | null, weight: WeightParts): WeightParts =>
  partsOf(tenthsOf(weight) + (direction === "gain" ? 1 : -1));

/** Where the wheel rests while unset: the nearest WHOLE number on the goal's side. */
export function targetRest(direction: Direction | null, weight: WeightParts): WeightParts {
  if (direction === "gain") return { whole: weight.whole + 1, tenth: 0 };
  return { whole: weight.tenth === 0 ? weight.whole - 1 : weight.whole, tenth: 0 };
}

/** A pick pulled onto the allowed side. */
export function clampTarget(direction: Direction | null, weight: WeightParts, parts: WeightParts): WeightParts {
  const wrong = direction === "gain" ? tenthsOf(parts) <= tenthsOf(weight) : tenthsOf(parts) >= tenthsOf(weight);
  return wrong ? targetEdge(direction, weight) : parts;
}

/** The row the wheel shows for a stored target on the goal's side: its own
 *  row, unless rounding lands it on the weight's own row; then the nearest row
 *  on the goal's side. */
export const targetRow = (direction: Direction | null, weight: WeightParts, targetKg: number, units: Units): WeightParts =>
  clampTarget(direction, weight, weightParts(targetKg, units));

// ── Screen 3: a target under the lowest healthy weight is said as it is
//    picked, and can still be picked (Kd, 2026-09-14) ──────────────────────

/** The lowest healthy weight for these answers' height, age and gender, in
 *  kilograms to one decimal, or null until all three are answered on the
 *  plan's own rails. */
export function healthyFloorKg(a: SetupAnswers): number | null {
  const age = planInputsSchema.shape.age.safeParse(a.age);
  const height = planInputsSchema.shape.heightCm.safeParse(a.heightCm);
  if (!age.success || !height.success || !answered(a.gender)) return null;
  return healthyWeightFloorKg(height.data, age.data, formulaFor(a.gender));
}

/** The number a weight reads on a wheel: its row, in the units on show. */
export const rowValue = (kg: number, units: Units): number => {
  const { whole, tenth } = weightParts(kg, units);
  return whole + tenth / 10;
};

/** The row setup shows a target on, in the units on show. */
export function targetShownRow(direction: Direction | null, a: SetupAnswers, units: Units): WeightParts {
  const target = a.targetWeightKg ?? 0;
  const side = targetDirection(direction);
  if (side === null || !answered(a.weightKg) || targetWrongSide(side, a.targetWeightKg, a.weightKg)) {
    return weightParts(target, units);
  }
  return targetRow(side, weightParts(a.weightKg, units), target, units);
}

/** `targetShownRow` as a number, or null while there is no target. */
export function targetShownValue(direction: Direction | null, a: SetupAnswers, units: Units): number | null {
  if (!answered(a.targetWeightKg)) return null;
  const { whole, tenth } = targetShownRow(direction, a, units);
  return whole + tenth / 10;
}

/** The number `weightLabel` prints for a weight. */
function labelValue(kg: number, units: Units): number {
  return units === "imperial" ? round(kg / KG_PER_LB, 1) : round(kg, 2);
}

export function weightLabel(kg: number, units: Units): string {
  return `${String(labelValue(kg, units))} ${units === "imperial" ? "lb" : "kg"}`;
}

/** Whether a weight that reads `shown` on screen reads under `floorKg` as the
 *  screens name it (`weightLabel`). */
export function readsBelow(shown: number | null | undefined, floorKg: number | null | undefined, units: Units): boolean {
  if (!answered(shown) || !answered(floorKg)) return false;
  return Math.round(shown * 100) < Math.round(labelValue(floorKg, units) * 100);
}

/** The flag's sentence, on screen 3 and in the plan panel alike. */
export const belowHealthyText = (floorKg: number, units: Units, age: number | null | undefined): string =>
  `Your target is below the lowest healthy weight for your height${
    answered(age) && age < ADULT_AGE ? " and age" : ""
  }, ${weightLabel(floorKg, units)}.`;

/** Screen 3's line under the target wheel, or null when there is nothing to
 *  say: a "Lose weight" target on the right side of the weight that is under
 *  the lowest healthy weight in kilograms AND reads under it on screen. */
export function healthyTargetLine(
  direction: Direction | null,
  a: SetupAnswers,
  units: Units,
  shown: { target?: number; weight?: number } = {},
): string | null {
  if (direction !== "lose" || !answered(a.weightKg) || !answered(a.targetWeightKg)) return null;
  if (targetWrongSide(direction, a.targetWeightKg, a.weightKg)) return null;
  const floorKg = healthyFloorKg(a);
  if (floorKg === null || !(a.targetWeightKg < floorKg)) return null;
  if (!readsBelow(shown.target ?? targetShownValue(direction, a, units), floorKg, units)) return null;
  const first = belowHealthyText(floorKg, units, a.age);
  if (floorKg < a.weightKg) return `${first} Your plan will not take you below it.`;
  const weightShownNow = shown.weight ?? rowValue(a.weightKg, units);
  const already = readsBelow(weightShownNow, floorKg, units) ? "You already weigh less" : "You are already at it";
  return `${first} ${already}, so your plan will not lower your weight.`;
}

/** Height: whole centimetres, or feet and inches. */
export interface MetricHeight {
  cm: number;
}
export interface ImperialHeight {
  ft: number;
  inch: number;
}
export type HeightParts = MetricHeight | ImperialHeight;

export const HEIGHT_REST: { metric: MetricHeight; imperial: ImperialHeight } = {
  metric: { cm: 170 },
  imperial: { ft: 5, inch: 7 },
};
export const INCHES: readonly number[] = range(0, 11);

export function heightParts(cm: number, units: "imperial"): ImperialHeight;
export function heightParts(cm: number, units: "metric"): MetricHeight;
export function heightParts(cm: number, units: Units): HeightParts;
export function heightParts(cm: number, units: Units): HeightParts {
  if (units !== "imperial") return { cm: Math.round(cm) };
  const totalIn = Math.round(cm / CM_PER_IN);
  return { ft: Math.floor(totalIn / 12), inch: totalIn % 12 };
}

export function cmFromParts(parts: HeightParts, units: Units): number {
  if ("ft" in parts) return units === "imperial" ? round((parts.ft * 12 + parts.inch) * CM_PER_IN, 2) : 0;
  return parts.cm;
}

export const heightCmList = (cm: number | null | undefined): number[] => stretched(100, 250, cm);
export const heightFeetList = (ft: number | null | undefined): number[] => stretched(3, 8, ft);
export const heightShown = (parts: HeightParts, units: Units): string => {
  if ("ft" in parts) return `${String(parts.ft)} ft ${String(parts.inch)} in`;
  return units === "imperial" ? "" : `${String(parts.cm)} cm`;
};

/** One inch along, carried into the feet. */
export function stepInches(parts: ImperialHeight, by: number): ImperialHeight {
  const total = parts.ft * 12 + parts.inch + by;
  return { ft: Math.floor(total / 12), inch: ((total % 12) + 12) % 12 };
}

/** Screen 5: plain questions, a guess is fine (Kd, 2026-09-10). */
export const PUSH_UPS_REST = 10;
export const pushUpList = (n: number | null | undefined): number[] => stretched(0, 100, n);
export const pushUpShown = (n: number): string => `${String(n)} ${n === 1 ? "push-up" : "push-ups"}`;

export const PLANK_REST = 30;
/** Five-second rows up to five minutes, plus any stored answer off that grid. */
export const plankList = (s: number | null | undefined): number[] => including(range(0, 300, 5), s);
export function plankShown(s: number): string {
  if (s < 60) return `${String(s)} s`;
  const rest = s % 60;
  return rest === 0 ? `${String(s / 60)} min` : `${String(Math.floor(s / 60))} min ${String(rest)} s`;
}

// ── The plan panel's words ──────────────────────────────────────────────────

export const kcalText = (n: number): string => new Intl.NumberFormat("en-US").format(n);

/** A YYYY-MM-DD day as "Mar 12, 2027", formatted in UTC on purpose: the day is
 *  already the person's own. */
export function dayText(day: string): string {
  const [y = 1970, m = 1, d = 1] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** A pace card's rate, from the shared table the plan maths reads. */
export function paceText(pace: PlanPace, units: Units): string {
  const kg = PACE_KG_PER_WEEK[pace];
  return units === "imperial" ? `about ${String(round(kg / KG_PER_LB, 1))} lb a week` : `about ${String(kg)} kg a week`;
}

/** "550 less than the 1,817 you burn": the plan's two numbers. */
export function changeLine(plan: PlanNumbers): string {
  const burn = kcalText(plan.dailyBurnKcal);
  const d = plan.dailyChangeKcal;
  if (d < 0) return `${kcalText(-d)} less than the ${burn} you burn a day`;
  if (d > 0) return `${kcalText(d)} more than the ${burn} you burn a day`;
  return `The same as the ${burn} you burn a day`;
}

/** Where the plan runs to, or null when the flags say it all. */
export function targetLine(plan: PlanNumbers, units: Units): string | null {
  if (plan.daysToTarget !== null && plan.finishDate !== null) {
    return `Reach ${weightLabel(plan.plannedTargetKg, units)} around ${dayText(plan.finishDate)}.`;
  }
  if (plan.dailyChangeKcal === 0) return `Keeps your weight at ${weightLabel(plan.plannedTargetKg, units)}.`;
  return null;
}

const PACE_LABEL: Readonly<Record<PlanPace, string>> = { gentle: "Gentle", steady: "Steady", brisk: "Brisk" };
const NO_CUT_REASON: Readonly<Record<NoDeficitReason, string>> = {
  under_18: "you are under 18",
  health_answer: "you answered yes to the health question",
  safe_mode: "Safe mode is on",
};

/** Every sanity rule the server raised, as one plain sentence each. */
export function flagLines(
  plan: PlanNumbers,
  direction: Direction | null,
  units: Units,
  targetShown: number | null = null,
): string[] {
  const codes = new Set(plan.flags.map((f) => f.code));
  const lines = plan.flags.map((f): string | null => {
    switch (f.code) {
      case "target_wrong_direction":
        return `Your target is not ${direction === "gain" ? "above" : "below"} your current weight, so this plan keeps your weight where it is.`;
      case "target_below_healthy_weight":
        return readsBelow(targetShown, f.floorKg, units) ? belowHealthyText(f.floorKg, units, plan.workings.resting.age) : null;
      case "pace_over_a_year":
        return f.suggestedPace
          ? `At this pace your target is more than a year away. The ${PACE_LABEL[f.suggestedPace].toLowerCase()} pace gets there within a year.`
          : "At this pace your target is more than a year away, and no pace gets there within a year.";
      case "calorie_floor_applied":
        return `Calories never go below ${kcalText(f.floorKcal)} a day in this app${
          direction === "lose" && !codes.has("target_out_of_reach") ? ", so this plan is slower than the pace you picked" : ""
        }.`;
      case "no_deficit":
        return `This plan has no calorie cut because ${listText(f.reasons.map((r) => NO_CUT_REASON[r]))}.`;
      case "target_out_of_reach":
        return "This target cannot be reached on these calories, so this plan keeps your weight where it is.";
      case "cut_limits_muscle_gain":
        return `Building muscle while losing weight: a cut of more than ${kcalText(f.limitKcal)} kcal a day mostly stops muscle growing.${
          f.suggestedPace ? ` The ${PACE_LABEL[f.suggestedPace].toLowerCase()} pace leaves room for it.` : ""
        }`;
    }
  });
  return lines.filter((line): line is string => line !== null);
}

/** The note under the live number on the screens that ask: the opening
 *  sentence of the plan screen's disclaimer, word for word. */
export const PLAN_NOTE = "These numbers are general guidance, not medical advice.";

// ── "How is this worked out?" (Kd, 2026-09-10) ──────────────────────────────
// Every figure is the server's (`plan.workings`); these are only its words.

const num = (n: number): string => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
const sign = (n: number): string => (n < 0 ? "−" : "+");

const DAY_SOURCE: Readonly<Record<DayActivity, string>> = {
  sitting: "the standard figure for a day spent mostly sitting",
  on_feet: "the app's own estimate for a day partly on your feet",
  active: "the app's own estimate for a day mostly on your feet",
  very_active: "the app's own estimate for a day of hard physical work",
};

export const WORKING_NOTE = "Each step is rounded to a whole calorie or gram.";
export const METRIC_NOTE = "The formulas work in kilograms and centimetres.";

const MORTON =
  "the amount a review of 49 studies suggests for anyone trying to build as much muscle as they can (Morton and colleagues, 2018)";
const PROTEIN_SOURCE: Readonly<Record<Direction, (g: string) => string>> = {
  lose: (g) =>
    `${g} g per kilo for a weight-loss goal: sports nutrition recommends 1.4 to 2.0 g per kilo a day for people who train, and more while eating less, to keep muscle (ISSN, 2017).`,
  maintain: (g) =>
    `${g} g per kilo, inside the 1.4 to 2.0 g per kilo a day sports nutrition recommends for people who train (ISSN, 2017).`,
  gain: (g) =>
    `${g} g per kilo for a weight-gain goal: the top of the 1.6 to 2.2 g per kilo a day a review recommends for people who lift weights while eating more than they burn (Iraki and colleagues, 2019).`,
};
const BUILD_MUSCLE_SOURCE = (g: string): string => `${g} g per kilo because you are building muscle: ${MORTON}.`;

export interface WorkingStep {
  title: string;
  sum: string;
  note: string | null;
}

/** The steps, in order; `note` names the source. Every number is the plan's own. */
export function workingSteps(plan: PlanNumbers, direction: Direction | null): WorkingStep[] {
  const w = plan.workings;
  const r = w.resting;
  const t = w.training;
  const steps: WorkingStep[] = [
    {
      title: "Resting burn",
      sum: `10 × ${num(r.weightKg)} kg + 6.25 × ${num(r.heightCm)} cm − 5 × ${String(r.age)} years ${sign(r.constant)} ${num(Math.abs(r.constant))} = ${kcalText(r.kcal)} kcal`,
      note: `The Mifflin-St Jeor equation (1990), which the Academy of Nutrition and Dietetics recommends: ${
        r.formula === "female" ? "its version for women" : "its version for men, which the app uses for every answer but Female"
      }.`,
    },
    {
      title: "Your day",
      sum: `${kcalText(r.kcal)} × ${num(w.day.factor)} = ${kcalText(w.day.kcal)} kcal`,
      note: `${num(w.day.factor)} is ${DAY_SOURCE[w.day.activity]}.`,
    },
    {
      title: "Your training",
      sum: `${num(t.kcalPerKgHour)} × ${num(t.weightKg)} kg × ${num(t.trainingDays * t.sessionMinutes)} minutes ÷ 60 ÷ 7 days = ${kcalText(t.kcal)} kcal a day`,
      note: `${String(t.trainingDays)} ${t.trainingDays === 1 ? "session" : "sessions"} of ${String(t.sessionMinutes)} minutes a week. A workout burns about ${num(t.kcalPerKgHour)} kcal per kilo per hour: the app's own estimate.`,
    },
    {
      title: "You burn",
      sum: `${kcalText(w.day.kcal)} + ${kcalText(t.kcal)} = ${kcalText(plan.dailyBurnKcal)} kcal a day`,
      note: null,
    },
  ];
  if (w.change) {
    const muscle = plan.flags.find((f) => f.code === "cut_limits_muscle_gain");
    steps.push({
      title: "Your pace",
      sum: `${num(w.change.kgPerWeek)} kg a week × ${kcalText(w.change.kcalPerKg)} kcal ÷ 7 days = ${kcalText(Math.abs(w.change.kcal))} kcal a day`,
      note: `${kcalText(w.change.kcalPerKg)} kcal per kilo is the usual planning figure (Wishnofsky). Real weight change is often slower, so the date is an estimate.${
        muscle
          ? ` A review of trials that trained while eating less found that a cut of about ${kcalText(muscle.limitKcal)} kcal a day stopped the muscle training builds (Murphy and Koehler, 2022).`
          : ""
      }`,
    });
  }
  const floored = w.beforeFloorKcal < w.floorKcal;
  const eat = w.change
    ? `${kcalText(plan.dailyBurnKcal)} ${sign(w.change.kcal)} ${kcalText(Math.abs(w.change.kcal))} = ${kcalText(w.beforeFloorKcal)} kcal`
    : `${kcalText(w.beforeFloorKcal)} kcal`;
  let eatNote: string | null = null;
  if (floored) eatNote = `The app never sets fewer than ${kcalText(w.floorKcal)} kcal a day.`;
  else if (!w.change) eatNote = "The same as you burn, so your weight stays where it is.";
  steps.push({
    title: "To eat",
    sum: floored ? `${eat}, under the floor, so ${kcalText(plan.targetKcal)} kcal a day` : `${eat} a day`,
    note: eatNote,
  });
  const p = w.protein;
  const source = p.buildMuscle ? BUILD_MUSCLE_SOURCE : direction === null ? null : PROTEIN_SOURCE[direction];
  const counted =
    p.referenceBmi === null
      ? ""
      : `Counted on ${num(p.weightKg)} kg, the weight at a BMI of ${num(p.referenceBmi)} for your height, rather than your ${num(r.weightKg)} kg, as protein guidance for heavier bodies does (Weijs, 2025). `;
  steps.push(
    {
      title: "Protein",
      sum:
        plan.proteinG === p.wantedG
          ? `${num(p.gPerKg)} g × ${num(p.weightKg)} kg = ${String(p.wantedG)} g`
          : `${num(p.gPerKg)} g × ${num(p.weightKg)} kg would be ${String(p.wantedG)} g, more than the day's calories leave room for, so ${String(plan.proteinG)} g`,
      note: `${counted}${source ? source(num(p.gPerKg)) : `${num(p.gPerKg)} g per kilo is the app's own figure for your goal.`}`,
    },
    {
      title: "Fat",
      sum: `${num(w.fatShare * 100)}% of ${kcalText(plan.targetKcal)} kcal ÷ 9 kcal a gram = ${String(plan.fatG)} g`,
      note: "The app's own share.",
    },
    {
      title: "Carbohydrates",
      sum: `The rest of the calories ÷ 4 kcal a gram = ${String(plan.carbsG)} g`,
      note: `Never under ${String(w.carbsFloorG)} g a day.`,
    },
  );
  if (w.finish && plan.daysToTarget !== null) {
    steps.push({
      title: "Your finish date",
      sum: `${num(w.finish.kgToMove)} kg × ${kcalText(w.finish.kcalPerKg)} kcal ÷ ${kcalText(Math.abs(plan.dailyChangeKcal))} kcal a day = ${kcalText(plan.daysToTarget)} days`,
      note: "Rounded up to a whole day.",
    });
  }
  return steps;
}

/** The mark on screen 3's pace card that leaves muscle room to grow, for
 *  someone building muscle while losing weight (Kd, 2026-09-13): only where
 *  another pace would cut more. */
export const MUSCLE_PACE_NOTE = "Best if you also build muscle";
export function paceNote(
  pace: PlanPace,
  direction: Direction | null,
  a: SetupAnswers,
  plan: PlanNumbers | null = null,
): string | null {
  if (MUSCLE_GAIN_PACE === null || pace !== MUSCLE_GAIN_PACE) return null;
  const marked = MUSCLE_GAIN_PACE;
  const buildsMuscle = Array.isArray(a.fitnessGoals) && a.fitnessGoals.includes("muscle_gain");
  const canCut = answered(a.age) && a.age >= ADULT_AGE && a.health?.hasCondition !== true;
  const byPace = plan?.dailyChangeKcalByPace ?? null;
  const cut = (p: PlanPace): number => (byPace === null ? 0 : Math.max(0, -byPace[p]));
  const anotherCutsMore = byPace === null || PACES.some((p) => cut(p.value) > cut(marked));
  return direction === "lose" && buildsMuscle && canCut && anotherCutsMore ? MUSCLE_PACE_NOTE : null;
}

// ── Saving as you go ────────────────────────────────────────────────────────

export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

/** The edits still waiting once `sent` has been answered, either way: a key
 *  whose edit is still the value that was sent is settled; a key tapped again
 *  since keeps its newer value, which is still on its way. */
export function settleEdits<T extends Record<string, unknown>>(edits: T, sent: Record<string, unknown>): Partial<T> {
  const next: Partial<T> = { ...edits };
  for (const [key, value] of Object.entries(sent)) {
    if (Object.hasOwn(next, key) && sameValue(Reflect.get(next, key), value)) Reflect.deleteProperty(next, key);
  }
  return next;
}

export interface SaveQueue<P> {
  save: (patch: P) => void;
  /** Resolves once everything has been answered: true when no save made or
   *  finished since the call failed. */
  settled: () => Promise<boolean>;
}

/** One save on the wire at a time, in the order they were made. Taps made
 *  while one is out are merged into the next, so the last answer is always
 *  the one stored: two requests in flight could land in either order. */
export function createSaveQueue<P extends Record<string, unknown>, R>({
  send,
  onSaved,
  onFailed,
}: {
  send: (patch: P) => Promise<R>;
  onSaved: (reply: R, sent: P) => void;
  onFailed: (err: unknown, sent: P) => void;
}): SaveQueue<P> {
  let pending: P | null = null;
  let running = false;
  let failures = 0;
  let waiters: ((failuresNow: number) => void)[] = [];

  const pump = async (): Promise<void> => {
    running = true;
    while (pending !== null) {
      const patch: P = pending;
      pending = null;
      try {
        onSaved(await send(patch), patch);
      } catch (err) {
        failures += 1;
        onFailed(err, patch);
      }
    }
    running = false;
    const done = waiters;
    waiters = [];
    for (const resolve of done) resolve(failures);
  };

  return {
    save(patch) {
      pending = { ...(pending ?? {}), ...patch };
      if (!running) void pump();
    },
    settled() {
      const before = failures;
      if (!running && pending === null) return Promise.resolve(true);
      return new Promise((resolve) => {
        waiters.push((now) => {
          resolve(now === before);
        });
      });
    },
  };
}
