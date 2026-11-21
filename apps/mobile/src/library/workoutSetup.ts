import { KCAL_REST_MET, KCAL_WEIGHT_UNKNOWN_KG, WORKOUT_SAVE_LIMITS, type PhoneLibraryEntry, type PlannedSet } from "@app/shared";
import { SETS_MOST, type Item, type Plan } from "./myWorkout";
import { BAR_KG, clockWords, holdWords, type Units, weightParts, weightWords } from "./records";

// Setting up an exercise's sets in My Workout (ROADMAP Stage 5 64a-i, Kd's drawing of 2026-11-20): what + and − do to
// sets, reps or time, weight and rest, for every set at once or for one, what a row says, and about how long and how
// many calories the whole workout is. Pure: the screen only draws it.

/** The rest after each set until the person changes it: the browser's builder started every exercise at 60 s. */
export const REST_START = 60;
/** The longest rest offered here; a saved workout allows an hour. */
export const REST_MOST = 600;
export const REST_STEP = 15;
/** Reps of one set, as a workout's save allows. */
export const REPS_MOST = WORKOUT_SAVE_LIMITS.repsMost;
/** A set measured in time: from 5 s to an hour. */
export const TIME_LEAST = 5;
export const TIME_MOST = 3600;
/** The heaviest weight offered, as a workout's save allows. */
export const WEIGHT_MOST_GRAMS = WORKOUT_SAVE_LIMITS.weightGramsMost;
/** A standard bar in pounds, where the person counts in pounds. */
export const BAR_LB = 45;
/** The browser's estimate of a rep: 3 s. */
export const SECONDS_A_REP = 3;

const GRAMS_PER_LB = 453.59237;

/** The Library's starting numbers for an exercise: its sets of its reps or time, no weight, 60 s of rest. */
export function startPlan(entry: PhoneLibraryEntry): Plan | null {
  const { measuredIn, start } = entry.set;
  const target = measuredIn === "time" ? start.seconds : start.reps;
  if (target === undefined || start.sets < 1) return null;
  const sets = Array.from({ length: Math.min(SETS_MOST, start.sets) }, (): PlannedSet => ({ target, weightGrams: null, restSeconds: REST_START }));
  return { measuredIn: measuredIn === "time" ? "time" : "reps", sets };
}

/** An exercise's sets: the person's own, else the Library's starting numbers; null for one the phone cannot read. */
export function planOf(item: Item, entry: PhoneLibraryEntry | null): Plan | null {
  return item.plan ?? (entry === null ? null : startPlan(entry));
}

export type Field = "sets" | "target" | "weight" | "rest";

/** One step of a time: 5 s under a minute, 15 s to five minutes, 30 s past it, so the next of every step comes back. */
export function stepTime(seconds: number, by: -1 | 1): number {
  const size = by > 0 ? (seconds < 60 ? 5 : seconds < 300 ? 15 : 30) : seconds <= 60 ? 5 : seconds <= 300 ? 15 : 30;
  return Math.min(TIME_MOST, Math.max(TIME_LEAST, seconds + by * size));
}

/** One step of a weight, in the person's units: 2.5 kg or 5 lb. From none, + gives the empty bar for a barbell (20 kg,
 *  45 lb) and one step for anything else; back down there, − gives none. */
export function stepWeight(grams: number | null, by: -1 | 1, units: Units, barbell: boolean): number | null {
  const per = units === "imperial" ? GRAMS_PER_LB : 1000;
  const size = units === "imperial" ? 5 : 2.5;
  const bare = barbell ? (units === "imperial" ? BAR_LB : BAR_KG) : 0;
  if (grams === null) return by > 0 ? Math.round((bare > 0 ? bare : size) * per) : null;
  const now = Math.round((grams / per) * 10) / 10;
  const next = now + by * size;
  if (next <= 0 || (bare > 0 && next < bare)) return null;
  return Math.min(WEIGHT_MOST_GRAMS, Math.round(next * per));
}

/** A weight the person typed (Kd: "a manually writing weight with a option should also be there"), in their units, to
 *  one decimal, as the screen shows a weight: "47.5", "47,5" and " 50 " are read; empty or 0 is no weight. Text that is
 *  not such a number is "unread", a weight past what a save allows "heavy", and the box says which (review L1, L3). */
export type Typed = { kind: "ok"; grams: number | null } | { kind: "unread" } | { kind: "heavy" };

export function typedWeight(text: string, units: Units): Typed {
  const t = text.trim().replace(",", ".");
  if (t === "") return { kind: "ok", grams: null };
  if (!/^\d{1,5}(\.\d)?$/.test(t)) return { kind: "unread" };
  const value = Number(t);
  if (value === 0) return { kind: "ok", grams: null };
  const grams = Math.round(value * (units === "imperial" ? GRAMS_PER_LB : 1000));
  return grams > WEIGHT_MOST_GRAMS ? { kind: "heavy" } : { kind: "ok", grams };
}

/** One weight given to one set (`which`) or to every set (`which` null). The same plan where nothing changed. */
export function withWeight(plan: Plan, grams: number | null, which: number | null): Plan {
  const sets = plan.sets.map((s, i) => ((which === null || i === which) && s.weightGrams !== grams ? { ...s, weightGrams: grams } : s));
  return sets.some((s, i) => s !== plan.sets[i]) ? { ...plan, sets } : plan;
}

/** Whether a press can change anything: + at the most, or − at the least, does nothing. */
export function canStep(plan: Plan, field: Field, by: -1 | 1, which: number | null, units: Units, barbell: boolean): boolean {
  return changed(plan, field, by, which, units, barbell) !== plan;
}

/** A press of + (1) or − (-1) on one field, for one set (`which`) or for every set (`which` null). Every set takes the
 *  first set's number after the press, so what the controls show (the first set's) is what every set then holds, and
 *  sets that differed are made the same (Kd's click-through, 2026-11-20: with each moving by its own step the screen
 *  showed "--" and a press seemed to do nothing). Sets are added as a copy of the last and taken from the end. The plan
 *  given back is the same one where nothing changed. */
export function changed(plan: Plan, field: Field, by: -1 | 1, which: number | null, units: Units, barbell: boolean): Plan {
  if (field === "sets") {
    if (by > 0) {
      const last = plan.sets[plan.sets.length - 1];
      return last === undefined || plan.sets.length >= SETS_MOST ? plan : { ...plan, sets: [...plan.sets, { ...last }] };
    }
    return plan.sets.length <= 1 ? plan : { ...plan, sets: plan.sets.slice(0, -1) };
  }
  const one = (s: PlannedSet): PlannedSet => {
    if (field === "target") {
      const target = plan.measuredIn === "time" ? stepTime(s.target, by) : Math.min(REPS_MOST, Math.max(1, s.target + by));
      return target === s.target ? s : { ...s, target };
    }
    if (field === "weight") {
      const weightGrams = stepWeight(s.weightGrams, by, units, barbell);
      return weightGrams === s.weightGrams ? s : { ...s, weightGrams };
    }
    const now = s.restSeconds ?? 0;
    const rest = Math.min(REST_MOST, Math.max(0, now + by * REST_STEP));
    return rest === now ? s : { ...s, restSeconds: rest };
  };
  const first = plan.sets[0];
  if (first === undefined) return plan;
  let sets: PlannedSet[];
  if (which !== null) {
    sets = plan.sets.map((s, i) => (i === which ? one(s) : s));
  } else {
    const led = one(first);
    sets = plan.sets.map((s) => {
      const next: PlannedSet = field === "target" ? { ...s, target: led.target } : field === "weight" ? { ...s, weightGrams: led.weightGrams } : { ...s, restSeconds: led.restSeconds };
      return next.target === s.target && next.weightGrams === s.weightGrams && next.restSeconds === s.restSeconds ? s : next;
    });
  }
  return sets.some((s, i) => s !== plan.sets[i]) ? { ...plan, sets } : plan;
}

/** Whether every set has the same value of a field. */
export function same(plan: Plan, field: Exclude<Field, "sets">): boolean {
  const pick = (s: PlannedSet) => (field === "target" ? s.target : field === "weight" ? s.weightGrams : (s.restSeconds ?? 0));
  const first = plan.sets[0];
  return first === undefined || plan.sets.every((s) => pick(s) === pick(first));
}

/** A set's target in words: "10 reps", "30 s", "1:15". */
export const targetWords = (plan: Plan, s: PlannedSet): string => (plan.measuredIn === "time" ? holdWords(s.target) : `${String(s.target)} ${s.target === 1 ? "rep" : "reps"}`);

export const restWords = (seconds: number | null): string => (seconds === null || seconds === 0 ? "no rest" : `rest ${clockWords(seconds)}`);

/** A row's line: "3 × 10 reps · 20 kg · rest 1:00"; sets that differ are named each: "3 sets · 10, 10, 6 reps · 20 to
 *  25 kg · rest varies". "each side" where the exercise is done for each side. */
export function planLine(plan: Plan, units: Units, eachSide: boolean): string {
  const first = plan.sets[0];
  if (first === undefined) return "";
  const side = eachSide ? " each side" : "";
  const n = plan.sets.length;
  let head: string;
  if (same(plan, "target")) head = `${String(n)} × ${targetWords(plan, first)}${side}`;
  else if (plan.measuredIn === "time") head = `${String(n)} sets · ${plan.sets.map((s) => holdWords(s.target)).join(", ")}${side}`;
  else head = `${String(n)} sets · ${plan.sets.map((s) => String(s.target)).join(", ")} reps${side}`;
  const grams = plan.sets.map((s) => s.weightGrams).filter((g): g is number => g !== null);
  let weight: string | null = null;
  if (grams.length > 0) {
    const lo = Math.min(...grams);
    const hi = Math.max(...grams);
    const [loN, unit] = weightParts(lo, units);
    const range = lo === hi ? `${loN} ${unit}` : `${loN} to ${weightParts(hi, units).join(" ")}`;
    weight = grams.length === n ? range : `${range} on some sets`;
  }
  const rest = same(plan, "rest") ? restWords(first.restSeconds) : "rest varies";
  return [head, weight, rest].filter((x) => x !== null).join(" · ");
}

/** A time for the timer's digits: "00:30", "01:15", "60:00". */
export function clockDigits(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export interface Estimate {
  minutes: number;
  /** Null until the person's weight has been heard (undefined), so nobody is told calories at a weight that is not theirs. */
  kcal: number | null;
  /** The weight the calories were reckoned at where the person has given none (70 kg), said beside them with Add your
   *  weight, as the exercise's page does (review H2); null where it is their own. */
  assumedKg: number | null;
}

/** About how long the workout takes and burns, as a saved workout's calories are reckoned (MET × kg × hours, rest at
 *  1.8): a rep is 3 s, a set "each side" twice over, and the rest after every set but the workout's very last (review
 *  L5). Exercises the phone cannot read are left out; no calories are said where one exercise's MET is not known. */
export function estimate(items: readonly Item[], entryOf: (id: string) => PhoneLibraryEntry | null, weightKg: number | null | undefined): Estimate {
  const own = weightKg !== undefined && weightKg !== null && weightKg > 0;
  const kg = weightKg === undefined ? null : own ? weightKg : KCAL_WEIGHT_UNKNOWN_KG;
  const read = items.flatMap((item) => {
    const entry = entryOf(item.id);
    const plan = planOf(item, entry);
    return entry === null || plan === null ? [] : [{ entry, plan }];
  });
  let seconds = 0;
  let kcal = 0;
  // An exercise whose MET the phone could not read would make the calories too low: then none are said.
  let known = kg !== null;
  read.forEach(({ entry, plan }, e) => {
    plan.sets.forEach((s, i) => {
      const work = (plan.measuredIn === "time" ? s.target : s.target * SECONDS_A_REP) * (entry.set.eachSide ? 2 : 1);
      const last = e === read.length - 1 && i === plan.sets.length - 1;
      const rest = last ? 0 : (s.restSeconds ?? 0);
      seconds += work + rest;
      if (entry.met === null) known = false;
      else if (kg !== null) kcal += (entry.met * kg * work + KCAL_REST_MET * kg * rest) / 3600;
    });
  });
  return {
    minutes: seconds === 0 ? 0 : Math.max(1, Math.round(seconds / 60)),
    kcal: known ? Math.round(kcal) : null,
    assumedKg: kg !== null && !own ? KCAL_WEIGHT_UNKNOWN_KG : null,
  };
}

/** "about 14 min", "about 1 h 5 min". */
export function minutesWords(minutes: number): string {
  if (minutes < 60) return `about ${String(minutes)} min`;
  const m = minutes % 60;
  return `about ${String(Math.floor(minutes / 60))} h${m === 0 ? "" : ` ${String(m)} min`}`;
}

/** The line under the workout's name: "3 exercises · about 14 min · about 95 kcal", and "about 95 kcal at 70 kg" where
 *  the person has given no weight. */
export function summaryLine(count: number, e: Estimate, units: Units): string {
  const parts = [`${String(count)} ${count === 1 ? "exercise" : "exercises"}`];
  if (e.minutes > 0) parts.push(minutesWords(e.minutes));
  if (e.kcal !== null && e.minutes > 0) parts.push(`about ${String(e.kcal)} kcal${e.assumedKg === null ? "" : ` at ${weightWords(e.assumedKg * 1000, units)}`}`);
  return parts.join(" · ");
}
