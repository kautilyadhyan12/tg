import type { ExerciseRecords, PhoneLibraryEntry } from "@app/shared";

// An exercise's records on its page (ROADMAP Stage 5 63c, Kd's drawing of 2026-11-20): heaviest as the loaded bar,
// most reps, best volume and longest hold on the gym's LED timer, and the person's last times as its bars. What is
// drawn comes from here: which record leads, the plates that make up a weight, the bars against the record. Pure.

/** The person's own records of one exercise. */
export const recordsPath = (exercise: string): string => `/v1/training/exercises/${encodeURIComponent(exercise)}/records`;

export type Units = "metric" | "imperial";

const KG_PER_LB = 0.45359237;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** One decimal at most, none when whole: 32.5, 35. */
const tenth = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

/** A weight's number in the person's units, and its unit: ["32.5", "kg"], ["71.7", "lb"]. */
export function weightParts(grams: number, units: Units): [string, "kg" | "lb"] {
  const kg = grams / 1000;
  return units === "imperial" ? [tenth(kg / KG_PER_LB), "lb"] : [tenth(kg), "kg"];
}

export const weightWords = (grams: number, units: Units): string => weightParts(grams, units).join(" ");

/** A big weight as a whole number, for the timer's digits: 880. */
export function wholeWeight(grams: number, units: Units): [string, "kg" | "lb"] {
  const kg = grams / 1000;
  return [String(Math.round(units === "imperial" ? kg / KG_PER_LB : kg)), units === "imperial" ? "lb" : "kg"];
}

/** A hold for the timer's digits: "0:45", "1:15", "1:02:05". */
export function clockWords(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${String(h)}:${String(m).padStart(2, "0")}:${ss}` : `${String(m)}:${ss}`;
}

/** A hold in words: "45 s", "1:15". */
export const holdWords = (seconds: number): string => (seconds < 60 ? `${String(Math.max(0, Math.floor(seconds)))} s` : clockWords(seconds));

/** The day of an instant on this phone: "14 Nov". */
export function dayWords(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getDate())} ${MONTHS[d.getMonth()] ?? ""}`;
}

/** The record that leads: its bars are the person's last times. */
export type Lead = "heaviest" | "mostReps" | "longestHold";

/** A time exercise is led by its longest hold, one in reps by its heaviest where the person has lifted a weight in it,
 *  else by its most reps. Sets are kept in their own unit, so an exercise may hold records of the other unit only
 *  (it was measured otherwise before): those lead then. Null when the person has no record of it. */
export function leadOf(measuredIn: "reps" | "time", r: ExerciseRecords): Lead | null {
  const has = { heaviest: r.reps.heaviest !== null, mostReps: r.reps.mostReps !== null, longestHold: r.time.longestHold !== null };
  const order: readonly Lead[] = measuredIn === "time" ? ["longestHold", "heaviest", "mostReps"] : ["heaviest", "mostReps", "longestHold"];
  return order.find((k) => has[k]) ?? null;
}

/** The record's value and the workout it was made in. */
function recordOf(lead: Lead, r: ExerciseRecords): { value: number; workoutId: string } | null {
  const set = lead === "heaviest" ? r.reps.heaviest : lead === "mostReps" ? r.reps.mostReps : r.time.longestHold;
  if (set === null) return null;
  const value = lead === "heaviest" ? set.weightGrams : set.done;
  return value === null || value <= 0 ? null : { value, workoutId: set.workoutId };
}

/** How many lights a bar has. */
export const BAR_LIGHTS = 8;

export interface Bar {
  workoutId: string;
  day: string;
  /** That workout's best of the leading kind; null where it did none of that kind. */
  value: number | null;
  /** Lights lit, 0 to `BAR_LIGHTS`: as far as the value came to the record, at least one for anything done. */
  lit: number;
  /** The workout the record was made in. */
  record: boolean;
}

/** One bar for each of the person's latest workouts of the exercise, the earliest first. */
export function barsOf(lead: Lead, r: ExerciseRecords): Bar[] {
  const best = recordOf(lead, r);
  return r.recent.map((w) => {
    const value = lead === "heaviest" ? w.reps.heaviestGrams : lead === "mostReps" ? w.reps.mostReps : w.time.longestHold;
    const lit = value === null || best === null ? 0 : Math.max(1, Math.min(BAR_LIGHTS, Math.round((value / best.value) * BAR_LIGHTS)));
    return { workoutId: w.workoutId, day: dayWords(w.startedAt), value, lit, record: best !== null && w.workoutId === best.workoutId };
  });
}

/** The one-rep max to show: none where it is below the heaviest weight lifted (an estimate from a lighter set can
 *  never be more true than the weight itself). */
export function oneRepMaxGrams(r: ExerciseRecords): number | null {
  const estimate = r.reps.bestEstimated1rm?.estimateGrams ?? null;
  const heaviest = r.reps.heaviest?.weightGrams ?? null;
  if (estimate === null) return null;
  return heaviest !== null && estimate < heaviest ? null : estimate;
}

/** The standard bar, and the standard plates largest first (red 25, blue 20, yellow 15, green 10, white 5, and the
 *  change plates in the same colours). */
export const BAR_KG = 20;
export const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 2, 1.5, 1, 0.5] as const;
export type PlateKg = (typeof PLATES_KG)[number];

/** The plates that make up `kg` on one side, largest first; null where they cannot make it exactly. */
export function platesFor(kg: number): PlateKg[] | null {
  let half = Math.round(kg * 2);
  if (half < 0 || Math.abs(kg * 2 - half) > 1e-6) return null;
  const out: PlateKg[] = [];
  for (const p of PLATES_KG) {
    while (half >= p * 2) {
      out.push(p);
      half -= p * 2;
    }
  }
  return half === 0 ? out : null;
}

/** The loaded bar of the heaviest set: a standard 20 kg bar, the plates a side that make the weight exactly, and the
 *  estimate's extra beyond them, rounded down to plates. Only for a barbell exercise, in kilograms, from 20 kg; null
 *  otherwise, and the weight is told by its number alone: a bar is never drawn loaded with a weight it does not hold. */
export function loadedBar(entry: PhoneLibraryEntry, units: Units, heaviestGrams: number, estimateGrams: number | null): { side: PlateKg[]; extra: PlateKg[] } | null {
  if (units !== "metric" || !entry.equipment.includes("barbell")) return null;
  const kg = heaviestGrams / 1000;
  if (kg < BAR_KG) return null;
  const side = platesFor((kg - BAR_KG) / 2);
  if (side === null) return null;
  const more = estimateGrams === null ? 0 : Math.floor(((estimateGrams - heaviestGrams) / 1000 / 2) * 2) / 2;
  return { side, extra: more > 0 ? (platesFor(more) ?? []) : [] };
}
