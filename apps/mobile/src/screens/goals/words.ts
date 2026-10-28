import {
  GOAL_KIND_RULES,
  goalTargetMax,
  type Goal,
  type GoalKind,
  type GoalPeriod,
  type NoDeficitReason,
} from "@app/shared";
import type { IconName } from "../../look/Icon";
import { NOT_KNOWN, count } from "../dashboard/words";

// What Your Goals says about each goal (ROADMAP Stage 5 item 31b). The server measures every goal and
// holds the ones the health rules hold; these only put its numbers into words.

export const KIND_NAMES: Readonly<Record<GoalKind, string>> = {
  training_days: "Training days",
  streak: "Streak",
  gym_visits: "Check-ins",
  calories_burned: "Calories burned",
  active_minutes: "Active minutes",
  reps_in_set: "Reps in one set",
  weight: "Weight",
  calories_within: "Calories",
  protein: "Protein",
  food_logged_days: "Food logged",
};

export const KIND_ICONS: Readonly<Record<GoalKind, IconName>> = {
  training_days: "calendar",
  streak: "flame",
  gym_visits: "building",
  calories_burned: "zap",
  active_minutes: "clock",
  reps_in_set: "dumbbell",
  weight: "ruler",
  calories_within: "utensils",
  protein: "apple",
  food_logged_days: "book",
};

/** The order a person picks from when adding a goal. */
export const KIND_ORDER: readonly GoalKind[] = [
  "training_days",
  "active_minutes",
  "calories_burned",
  "streak",
  "gym_visits",
  "reps_in_set",
  "weight",
  "calories_within",
  "protein",
  "food_logged_days",
];

export const PERIOD_NAMES: Readonly<Record<GoalPeriod, string>> = { day: "Day", week: "Week", month: "Month", year: "Year" };
const EACH: Readonly<Record<GoalPeriod, string>> = { day: "a day", week: "a week", month: "a month", year: "a year" };
const NOW: Readonly<Record<GoalPeriod, string>> = { day: "today", week: "this week", month: "this month", year: "this year" };

const LB_PER_KG = 1 / 0.45359237;

/** A weight in the person's own units: whole pounds, or kilograms to one place where it has one. */
export function weightWords(kg: number, units: string): string {
  if (units === "imperial") return `${count(Math.round(kg * LB_PER_KG))} lb`;
  const tenth = Math.round(kg * 10) / 10;
  return `${Number.isInteger(tenth) ? count(tenth) : tenth.toFixed(1)} kg`;
}

/** "squat_jump" → "Squat jump": the library's own names reach the phone with exercise folder 2's item 60. */
export function exerciseName(slug: string | null): string {
  if (slug === null || slug === "") return "Exercise";
  const words = slug.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type GoalFacts = Pick<Goal, "kind" | "period" | "target" | "direction" | "exerciseSlug">;

/** What the goal asks, in one line: "Train 4 days a week". With no target (held, or waiting on an
 *  answer), only its name. */
export function goalLine(goal: GoalFacts, units: string): string {
  const t = goal.target;
  const each = goal.period === null ? "" : ` ${EACH[goal.period]}`;
  if (t === null) return goal.kind === "reps_in_set" ? exerciseName(goal.exerciseSlug) : KIND_NAMES[goal.kind];
  switch (goal.kind) {
    case "training_days":
      return `Train ${count(t)} ${t === 1 ? "day" : "days"}${each}`;
    case "streak":
      return `Keep a ${count(t)}-day streak`;
    case "gym_visits":
      return `Check in ${count(t)} ${t === 1 ? "day" : "days"}${each}`;
    case "calories_burned":
      return `Burn ${count(t)} kcal${each}`;
    case "active_minutes":
      return `${count(t)} active minutes${each}`;
    case "reps_in_set":
      return `${exerciseName(goal.exerciseSlug)}: ${count(t)} reps in one set`;
    case "weight":
      return goal.direction === "steady" ? `Keep your weight at ${weightWords(t, units)}` : `Reach ${weightWords(t, units)}`;
    case "calories_within":
      return `Eat within ${count(t)} kcal${each}`;
    case "protein":
      return `Eat ${count(t)} g protein${each}`;
    case "food_logged_days":
      return `Log food ${count(t)} ${t === 1 ? "day" : "days"}${each}`;
  }
}

const REASON_WORDS: Readonly<Record<NoDeficitReason, string>> = {
  under_18: "you're under 18",
  health_answer: "of your health answer",
  safe_mode: "Safe mode is on",
};

function reasonList(reasons: readonly NoDeficitReason[]): string {
  const words = reasons.map((r) => REASON_WORDS[r]);
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

export type Progress =
  | { kind: "held"; words: string }
  | { kind: "needs"; words: string }
  | { kind: "done"; words: string }
  | { kind: "going"; words: string; share: number | null };

const UNIT_WORDS: Readonly<Record<Goal["unit"], (n: number) => string>> = {
  days: (n) => (n === 1 ? "day" : "days"),
  kcal: () => "kcal",
  minutes: (n) => (n === 1 ? "minute" : "minutes"),
  reps: (n) => (n === 1 ? "rep" : "reps"),
  kg: () => "kg",
  g: () => "g",
};

/** Where the goal stands: held, waiting on an answer, reached, or how far along. A share for the bar
 *  only where more is closer (at least) or the day's food fills up to its number (at most). */
export function goalProgress(goal: Goal, units: string): Progress {
  if (goal.held !== null) {
    return goal.held.code === "safe_mode"
      ? { kind: "held", words: "Paused while Safe mode is on" }
      : { kind: "held", words: `No weight loss, because ${reasonList(goal.held.reasons)}` };
  }
  if (goal.needs === "plan") return { kind: "needs", words: "Finish setup to set this goal" };
  if (goal.needs === "target_weight") return { kind: "needs", words: "Pick a target weight to set this goal" };
  const now = goal.period === null ? "" : ` ${NOW[goal.period]}`;
  const cur = goal.current;
  const t = goal.target;
  if (goal.kind === "weight") {
    if (goal.reached === true) return { kind: "done", words: "Reached" };
    return { kind: "going", words: cur === null ? "No weigh-in yet" : `${weightWords(cur, units)} now`, share: null };
  }
  if (cur === null || t === null) return { kind: "going", words: NOT_KNOWN, share: null };
  if (goal.direction === "at_most") {
    // Over its number: the words alone, never a trail climbed to the top as if it were reached.
    if (cur > t) return { kind: "going", words: `${count(cur - t)} ${UNIT_WORDS[goal.unit](cur - t)} over${now}`, share: null };
    if (goal.reached === true) return { kind: "done", words: `${count(cur)} of ${count(t)} ${UNIT_WORDS[goal.unit](t)}${now}` };
    return { kind: "going", words: `${count(cur)} of ${count(t)} ${UNIT_WORDS[goal.unit](t)}${now}`, share: t > 0 ? cur / t : 0 };
  }
  if (goal.reached === true) return { kind: "done", words: `${count(cur)} of ${count(t)} ${UNIT_WORDS[goal.unit](t)}${now}` };
  return { kind: "going", words: `${count(cur)} of ${count(t)} ${UNIT_WORDS[goal.unit](t)}${now}`, share: t > 0 ? Math.min(cur / t, 1) : 0 };
}

/** "3 of 5 reached", over the goals the server judges; null when it judges none. */
export function summaryWords(goals: readonly Goal[]): string | null {
  const judged = goals.filter((g) => g.reached !== null);
  if (judged.length === 0) return null;
  return `${count(judged.filter((g) => g.reached === true).length)} of ${count(judged.length)} reached`;
}

/** The periods a kind may take that this person has no goal of yet. Reps in one set is one goal an
 *  exercise, so it is never full. */
export function freePeriods(kind: GoalKind, goals: readonly Pick<Goal, "kind" | "period">[]): (GoalPeriod | null)[] {
  if (kind === "reps_in_set") return [null];
  const rule = GOAL_KIND_RULES[kind];
  const all: (GoalPeriod | null)[] = rule.periods.length === 0 ? [null] : [...rule.periods];
  return all.filter((p) => !goals.some((g) => g.kind === kind && g.period === p));
}

/** A starting number for a new goal, so the box opens filled in: a week's worth, spread over the period. */
const PER_WEEK: Readonly<Partial<Record<GoalKind, number>>> = {
  training_days: 3,
  gym_visits: 3,
  calories_burned: 2000,
  // The WHO's 150 minutes a week of moderate activity.
  active_minutes: 150,
  food_logged_days: 5,
};
const MARKS: Readonly<Partial<Record<GoalKind, number>>> = { streak: 7, reps_in_set: 10 };

export function startingTarget(kind: GoalKind, period: GoalPeriod | null): number | null {
  const max = goalTargetMax(kind, period);
  if (max === null) return null;
  const mark = MARKS[kind];
  if (mark !== undefined) return Math.min(mark, max);
  const week = PER_WEEK[kind] ?? 1;
  const scaled = period === "day" ? week / 7 : period === "month" ? week * 4 : period === "year" ? week * 52 : week;
  return Math.max(1, Math.min(Math.round(scaled), max));
}

/** A typed target: a whole number from 1 to the kind's most for the period, or the sentence that says why not. */
export function checkTarget(typed: string, kind: GoalKind, period: GoalPeriod | null): { ok: true; target: number } | { ok: false; words: string } {
  const max = goalTargetMax(kind, period);
  if (max === null) return { ok: false, words: "" };
  const n = /^\d+$/.test(typed.trim()) ? Number(typed.trim()) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > max) return { ok: false, words: `Enter a number from 1 to ${count(max)}.` };
  return { ok: true, target: n };
}

const UNIT_LABELS: Readonly<Record<Goal["unit"], string>> = { days: "Days", kcal: "Kcal", minutes: "Minutes", reps: "Reps", kg: "Kg", g: "Grams" };

/** The number box's label: "Days a week", "Kcal a day", "Days in a row", "Reps". */
export function targetLabel(kind: GoalKind, period: GoalPeriod | null): string {
  if (kind === "streak") return "Days in a row";
  const unit = UNIT_LABELS[GOAL_KIND_RULES[kind].unit];
  return period === null ? unit : `${unit} ${EACH[period]}`;
}

/** A goal's own name, as a box opened on it is headed: its exercise for reps in one set. */
export function goalName(goal: Pick<Goal, "kind" | "exerciseSlug">): string {
  return goal.kind === "reps_in_set" ? exerciseName(goal.exerciseSlug) : KIND_NAMES[goal.kind];
}

/** A goal id made on the phone, in small letters: the same request sent twice is one goal. */
export function newGoalId(random: () => number = Math.random): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16));
  hex[12] = "4";
  hex[16] = (8 + Math.floor(random() * 4)).toString(16);
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
