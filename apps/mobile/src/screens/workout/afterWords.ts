import { EFFORT_WORDS, type AfterIdea, type AfterRecord, type RunExercise, type SavedSet, type XpView } from "@app/shared";
import { holdWords, weightWords, wholeWeight, type Units } from "../../library/records";
import { count } from "../dashboard/words";

// The words of a workout's last screen (ROADMAP Stage 5 64a-iii, Kd's drawing of 2026-11-21). Pure.

/** A big weight, whole, with its thousands: "1,445 kg". */
const liftedWords = (grams: number, units: Units): string => {
  const [n, unit] = wholeWeight(grams, units);
  return `${count(Number(n))} ${unit}`;
};

const repsWords = (n: number): string => `${count(n)} ${n === 1 ? "rep" : "reps"}`;
/** A set's reps or time: "10 reps", "45 s", "1:15". */
const doneWords = (measuredIn: "reps" | "time", n: number): string => (measuredIn === "time" ? holdWords(n) : repsWords(n));

/** Calories as an estimate, at the weight they were worked out at: the person's own, or the 70 kg used where none is
 *  given, as the exercise's page says it. */
export function kcalLine(kcal: number, weightKg: number | null, units: Units): string {
  const at = weightWords(Math.round((weightKg ?? 70) * 1000), units);
  return weightKg === null ? `About ${count(kcal)} kcal, at ${at}` : `About ${count(kcal)} kcal for you, at ${at}`;
}

/** Where the XP came from: "50 for the workout · 10 for your streak · 150 for a new badge". */
export function xpWhy(forWorkout: number, forStreak: number, forBadges: number): string {
  return [
    `${count(forWorkout)} for the workout`,
    forStreak > 0 ? `${count(forStreak)} for your streak` : null,
    forBadges > 0 ? `${count(forBadges)} for a new badge` : null,
  ]
    .filter((x) => x !== null)
    .join(" · ");
}

/** "184/374 XP → Level 4". */
export const xpNext = (xp: Pick<XpView, "level" | "xpInLevel" | "xpForNext">): string =>
  `${count(xp.xpInLevel)}/${count(xp.xpForNext)} XP → Level ${count(xp.level + 1)}`;

/** The level bar's share, 0 to 1. */
export const xpShare = (xp: Pick<XpView, "progressPct">): number => Math.max(0, Math.min(1, xp.progressPct / 100));

export const streakWords = (days: number): string => `${count(days)}-day streak`;
/** What keeps the streak going: tomorrow where today already counts; today where it does not yet (a workout read after
 *  midnight, or one saved later from an earlier day), so nobody waits for tomorrow and loses it. */
export const streakNext = (days: number, today: boolean): string => (today ? `Train tomorrow to make it ${count(days + 1)}` : "Train today to keep it");

const KIND_WORDS: Readonly<Record<AfterRecord["kind"], string>> = {
  heaviest: "Heaviest",
  most_reps: "Most reps",
  best_estimated_1rm: "Best one-rep max (estimate)",
  longest_hold: "Longest hold",
  most_lifted: "Most lifted in one workout",
};

/** The set's number within its own exercise ("set 2" of Barbell Curl), from its place in the whole workout. */
function setNumber(done: readonly SavedSet[], position: number): number | null {
  const set = done[position];
  if (set === undefined) return null;
  return done.slice(0, position + 1).filter((s) => s.exercise === set.exercise).length;
}

export interface RecordRow {
  key: string;
  kind: string;
  where: string;
  value: string;
}

/** A new record as a row: what it is, which exercise and set, and what it was. */
export function recordRow(r: AfterRecord, done: readonly SavedSet[], units: Units): RecordRow {
  const name = r.exerciseName ?? r.exercise;
  const n = r.position === null ? null : setNumber(done, r.position);
  const value =
    r.kind === "most_lifted" ? liftedWords(r.value, units)
    : r.kind === "heaviest" || r.kind === "best_estimated_1rm" ? weightWords(r.value, units)
    : r.kind === "longest_hold" ? holdWords(r.value)
    : repsWords(r.value);
  return { key: `${r.exercise}:${r.kind}:${String(r.position)}`, kind: KIND_WORDS[r.kind], where: n === null ? name : `${name} · set ${String(n)}`, value };
}

export interface SetRow {
  key: string;
  n: string;
  done: string;
  /** "of 10" where the set stopped short of its target; empty otherwise. */
  of: string;
  weight: string;
  pr: boolean;
}

export interface ExerciseBlock {
  key: string;
  exercise: string;
  name: string;
  kind: string;
  /** "3 sets · 1,445 kg lifted". */
  line: string;
  sets: SetRow[];
}

/** Every set done, exercise by exercise in the order each was first done, from what the phone holds. A set that made a
 *  record is marked PR. An exercise twice in a workout is one block. */
export function exerciseBlocks(done: readonly SavedSet[], plan: readonly RunExercise[], records: readonly AfterRecord[], units: Units): ExerciseBlock[] {
  const prAt = new Set(records.flatMap((r) => (r.position === null ? [] : [r.position])));
  const blocks = new Map<string, ExerciseBlock & { grams: number }>();
  done.forEach((s, position) => {
    let b = blocks.get(s.exercise);
    if (b === undefined) {
      const ex = plan.find((p) => p.exercise === s.exercise);
      b = { key: s.exercise, exercise: s.exercise, name: ex?.name ?? s.exercise, kind: ex?.kind ?? "strength", line: "", sets: [], grams: 0 };
      blocks.set(s.exercise, b);
    }
    if (s.measuredIn === "reps" && s.weightGrams !== null) b.grams += s.done * s.weightGrams;
    b.sets.push({
      key: String(position),
      n: String(b.sets.length + 1),
      done: doneWords(s.measuredIn, s.done),
      of: s.done < s.target ? `of ${doneWords(s.measuredIn, s.target).replace(/ reps?$/, "")}` : "",
      weight: s.weightGrams === null ? "" : weightWords(s.weightGrams, units),
      pr: prAt.has(position),
    });
  });
  return [...blocks.values()].map(({ grams, ...b }) => {
    const sets = `${String(b.sets.length)} ${b.sets.length === 1 ? "set" : "sets"}`;
    return { ...b, line: grams > 0 ? `${sets} · ${liftedWords(grams, units)} lifted` : sets };
  });
}

/** "3 exercises · 8 sets". */
export function setsHeading(blocks: readonly ExerciseBlock[]): string {
  const sets = blocks.reduce((n, b) => n + b.sets.length, 0);
  return `${String(blocks.length)} ${blocks.length === 1 ? "exercise" : "exercises"} · ${String(sets)} ${sets === 1 ? "set" : "sets"}`;
}

export const WHEN_WORDS: Readonly<Record<AfterIdea["when"], string>> = { soon: "Within 30 minutes", meal: "Within 2 hours" };

/** "162 kcal · 19 g protein". */
export const ideaTotals = (idea: AfterIdea["idea"]): string => `${count(idea.totals.kcal)} kcal · ${String(Math.round(idea.totals.proteinG))} g protein`;

/** Under the stars: their word, and whether they are kept. `waits`: a press not yet on the server; `onPhone`: the workout
 *  itself is on the phone only (no internet). */
export function starWords(stars: number | null, waits: boolean, onPhone: boolean): string {
  if (stars === null) return "Tap a star";
  const word = EFFORT_WORDS[stars - 1] ?? "";
  if (onPhone) return `${word} · Saved on this phone`;
  return waits ? word : `${word} · Saved`;
}

export const starSay = (n: number): string => `${String(n)} of 5: ${EFFORT_WORDS[n - 1] ?? ""}`;

/** The water reminder (the old summary's), in the person's units. */
export const waterWords = (units: Units): string =>
  units === "imperial" ? "Drink about 500 ml (17 fl oz) of water in the next 30 minutes." : "Drink about 500 ml of water in the next 30 minutes.";
