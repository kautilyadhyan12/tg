import type { WorkoutRun } from "@app/shared";
import { holdWords, weightWords, type Units } from "../../library/records";
import { leftOf, nextOf, setOf } from "../../library/workoutRun";

// The words and numbers of the workout's own screen (64a-ii, Kd's drawing of 2026-11-21). Pure.

const two = (n: number): string => String(n).padStart(2, "0");

/** The workout's time: "12:31", "1:02:03". */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  return h > 0 ? `${String(h)}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

/** A countdown as the wall timer lights it: "00:45", rounded up, so 0:00 is the moment it ends. */
export const countdown = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${two(Math.min(99, Math.floor(s / 60)))}:${two(s % 60)}`;
};

const repsWords = (n: number): string => `${String(n)} ${n === 1 ? "rep" : "reps"}`;

/** A set's target in words: "10 reps", "45 s", "1:15". */
export const targetWords = (measuredIn: "reps" | "time", target: number): string => (measuredIn === "time" ? holdWords(target) : repsWords(target));

/** What the main button does now, said as what it keeps: "Set done · 7 reps", the target where none were counted. */
export function mainWords(r: WorkoutRun): string {
  if (r.paused) return "Resume";
  if (r.phase === "rest") return "Skip rest";
  if (r.phase === "ready") return "Start now";
  const { exercise, target } = setOf(r);
  if (exercise.measuredIn === "time") return `Set done · ${holdWords(Math.min(target, Math.floor((r.activeMs - r.phaseAt) / 1000)))}`;
  return `Set done · ${repsWords(r.count > 0 ? r.count : target)}`;
}

/** Over the picture: where the workout is, or, in a rest, what comes next. */
export function eyebrowWords(r: WorkoutRun): string {
  if (r.phase === "rest") return "Coming up next";
  const { exercise } = setOf(r);
  return `Exercise ${String(r.ex + 1)} of ${String(r.exercises.length)} · Set ${String(r.set + 1)} of ${String(exercise.sets.length)}`;
}

/** A set in one line: "Set 2 of 3 · 10 reps · 35 kg". */
export function setLine(r: WorkoutRun, units: Units): string {
  const { exercise, target, weightGrams } = setOf(r);
  return [`Set ${String(r.set + 1)} of ${String(exercise.sets.length)}`, targetWords(exercise.measuredIn, target), weightGrams === null ? null : weightWords(weightGrams, units)].filter((x) => x !== null).join(" · ");
}

/** Next up: the next set of this exercise, or the next exercise; the last set says so. */
export function nextWords(r: WorkoutRun, units: Units): string {
  const next = nextOf(r);
  if (next === null) return "The last set of this workout";
  const there = { ...r, ex: next.ex, set: next.set };
  if (next.ex === r.ex) return setLine(there, units);
  const { exercise, target } = setOf(there);
  return `${exercise.name} · ${String(exercise.sets.length)} × ${targetWords(exercise.measuredIn, target)}`;
}

/** The ring's share still to run, 1 at its start, 0 at its end; null for a set by hand. */
export function ringShare(r: WorkoutRun): number | null {
  const left = leftOf(r);
  return left === null ? null : Math.max(0, Math.min(1, left.leftMs / left.ofMs));
}
