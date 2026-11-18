// The one calorie formula of a workout saved from the phone (spec Part 2 §13.5, job 61a): version 4.
// kcal = MET × weight in kg × hours (Part 2B §2.2), with the three kinds of time Kd ruled on 2026-08-07:
// a set's own time at its exercise's MET from the Library, rest at REST_MET, a pause at nothing. A set
// with nothing done is charged as rest, never at its exercise's MET (the zero-rep set, 2026-08-10).
// Each set's time and then its rest are spent against the workout's own length, in the order of the
// sets, so the calories never stand for more time than the workout lasted. Pure.
import { DEFAULT_WEIGHT_KG, REST_MET } from "../workouts/calories.js";

export const KCAL_CALC_VERSION_SAVE = 4;

export interface KcalSet {
  /** The exercise's MET, read from the Library. */
  met: number;
  durationMs: number;
  done: number;
  restSeconds: number | null;
}

const HOUR_MS = 3_600_000;

/** `sets` in the order they were done. */
export function kcalForSave(sets: readonly KcalSet[], weightKg: number | null, lengthMs: number): number {
  const weight = weightKg !== null && weightKg > 0 ? weightKg : DEFAULT_WEIGHT_KG;
  let left = Math.max(0, lengthMs);
  let kcal = 0;
  const spend = (ms: number, met: number): void => {
    const spent = Math.min(Math.max(0, ms), left);
    left -= spent;
    kcal += met * weight * (spent / HOUR_MS);
  };
  for (const s of sets) {
    spend(s.durationMs, s.done > 0 ? s.met : REST_MET);
    spend((s.restSeconds ?? 0) * 1000, REST_MET);
  }
  return Math.round(kcal);
}
