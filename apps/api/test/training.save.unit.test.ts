// What a phone may report in a saved workout, and the one calorie formula (spec Part 2 §13.5, job
// 61a): a table over every limit, each just inside and just outside, and the formula's every kind of
// time. No database.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { workoutSaveSchema, type SavedSet } from "@app/shared";
import { kcalForSave, type KcalSet } from "../src/modules/training/calories.js";

const set = (over: Partial<SavedSet> = {}): SavedSet => ({
  exercise: "squat",
  position: 0,
  measuredIn: "reps",
  target: 12,
  done: 12,
  weightGrams: null,
  restSeconds: 60,
  durationMs: 40_000,
  counted: "hand",
  ...over,
});

const START = "2026-11-18T08:00:00.000Z";
const at = (ms: number) => new Date(Date.parse(START) + ms).toISOString();

const workout = (over: Record<string, unknown> = {}) => ({
  workoutId: randomUUID(),
  name: "Leg day",
  startedAt: START,
  endedAt: at(30 * 60_000),
  timeZone: "Asia/Kolkata",
  startedFrom: "none",
  effort: 4,
  heart: [],
  platform: "android",
  appVersion: "1.0.0",
  sets: [set()],
  ...over,
});

/** Where the refusal points, or "ok". */
const verdict = (body: unknown): string => {
  const parsed = workoutSaveSchema.safeParse(body);
  return parsed.success ? "ok" : (parsed.error.issues[0]?.path.join(".") ?? "?");
};

describe("what a phone may report in a saved workout", () => {
  const cases: [string, unknown, string][] = [
    ["a whole workout", workout(), "ok"],
    ["no name", workout({ name: null }), "ok"],
    ["a name of spaces", workout({ name: "   " }), "name"],
    ["a name of 60", workout({ name: "x".repeat(60) }), "ok"],
    ["a name of 61", workout({ name: "x".repeat(61) }), "name"],
    ["a name with 60 spaces after it, trimmed first", workout({ name: `Leg day${" ".repeat(60)}` }), "ok"],
    ["a field the server does not know", workout({ calories: 900 }), ""],
    ["no sets", workout({ sets: [] }), "sets"],
    ["200 sets", workout({ endedAt: at(12 * 3_600_000), sets: Array.from({ length: 200 }, (_, i) => set({ position: i, durationMs: 1000, restSeconds: null })) }), "ok"],
    ["201 sets", workout({ endedAt: at(12 * 3_600_000), sets: Array.from({ length: 201 }, (_, i) => set({ position: i, durationMs: 1000, restSeconds: null })) }), "sets"],
    ["an id word in capitals", workout({ sets: [set({ exercise: "Squat" })] }), "sets.0.exercise"],
    ["ends before it starts", workout({ endedAt: at(-1) }), "endedAt"],
    ["ends as it starts", workout({ endedAt: START, sets: [set({ durationMs: 0, restSeconds: null })] }), "ok"],
    ["12 hours", workout({ endedAt: at(12 * 3_600_000) }), "ok"],
    ["12 hours and a second", workout({ endedAt: at(12 * 3_600_000 + 1000) }), "endedAt"],
    ["one place twice", workout({ sets: [set(), set()] }), "sets"],
    ["a place left out", workout({ sets: [set(), set({ position: 2 })] }), "sets"],
    ["two places out of order", workout({ sets: [set({ position: 1 }), set()] }), "ok"],
    // Two sets of 40 s and a minute's rest each in 3 minutes: 200 s used, 180 s long, 2 s of slack.
    ["sets and rests longer than the workout", workout({ endedAt: at(180_000), sets: [set(), set({ position: 1 })] }), "sets"],
    ["sets and rests exactly the workout and its slack", workout({ endedAt: at(198_000), sets: [set(), set({ position: 1 })] }), "ok"],
    ["sets and rests a millisecond past the slack", workout({ endedAt: at(197_999), sets: [set(), set({ position: 1 })] }), "sets"],
    ["1000 reps", workout({ sets: [set({ target: 1000, done: 1000 })] }), "ok"],
    ["1001 reps done", workout({ sets: [set({ done: 1001 })] }), "sets.0.done"],
    ["a target of 1001 reps", workout({ sets: [set({ target: 1001 })] }), "sets.0.target"],
    ["a NUL character in the name", workout({ name: "Leg\u0000day" }), "name"],
    ["a NUL character in the app version", workout({ appVersion: "1.0\u0000" }), "appVersion"],
    ["a NUL character in the time zone", workout({ timeZone: "Asia/Kolkata\u0000" }), "timeZone"],
    ["a target of nothing", workout({ sets: [set({ target: 0 })] }), "sets.0.target"],
    ["nothing done", workout({ sets: [set({ done: 0 })] }), "ok"],
    ["a set of four hours", workout({ endedAt: at(5 * 3_600_000), sets: [set({ measuredIn: "time", target: 14_400, done: 14_400, durationMs: 14_400_000 })] }), "ok"],
    ["a set of four hours and a second", workout({ endedAt: at(5 * 3_600_000), sets: [set({ measuredIn: "time", target: 14_401, done: 30, durationMs: 30_000 })] }), "sets.0.target"],
    ["a time a second longer than the set", workout({ sets: [set({ measuredIn: "time", target: 30, done: 31, durationMs: 30_000 })] }), "ok"],
    ["a time more than a second longer than the set", workout({ sets: [set({ measuredIn: "time", target: 30, done: 32, durationMs: 30_000 })] }), "sets.0.done"],
    ["a gram", workout({ sets: [set({ weightGrams: 1 })] }), "ok"],
    ["a weight of nothing", workout({ sets: [set({ weightGrams: 0 })] }), "sets.0.weightGrams"],
    ["1,000 kg", workout({ sets: [set({ weightGrams: 1_000_000 })] }), "ok"],
    ["a gram more than 1,000 kg", workout({ sets: [set({ weightGrams: 1_000_001 })] }), "sets.0.weightGrams"],
    ["half a gram", workout({ sets: [set({ weightGrams: 1.5 })] }), "sets.0.weightGrams"],
    ["an hour's rest", workout({ endedAt: at(2 * 3_600_000), sets: [set({ restSeconds: 3600 })] }), "ok"],
    ["an hour and a second's rest", workout({ endedAt: at(2 * 3_600_000), sets: [set({ restSeconds: 3601 })] }), "sets.0.restSeconds"],
    ["counted by camera (job 64b adds it)", workout({ sets: [{ ...set(), counted: "camera" }] }), "sets.0.counted"],
    ["six stars", workout({ effort: 6 }), "effort"],
    ["no stars", workout({ effort: null }), "ok"],
    ["a heart rate at the end", workout({ heart: [[30 * 60_000, 120]] }), "ok"],
    ["a heart rate after the end", workout({ heart: [[30 * 60_000 + 1, 120]] }), "heart"],
    ["a heart rate of 20", workout({ heart: [[0, 20]] }), "heart.0.1"],
    ["from the web", workout({ platform: "web" }), "platform"],
    ["an app version of nothing", workout({ appVersion: "" }), "appVersion"],
    ["started from a plan of the gym's", workout({ startedFrom: "gym_plan" }), "ok"],
    ["started from a word the server does not know", workout({ startedFrom: "friend" }), "startedFrom"],
  ];
  it.each(cases)("%s", (_name, body, expected) => {
    expect(verdict(body)).toBe(expected);
  });
});

describe("the one calorie formula (version 4)", () => {
  const s = (met: number, durationMs: number, done: number, restSeconds: number | null): KcalSet => ({ met, durationMs, done, restSeconds });
  const HOUR = 3_600_000;
  const cases: [string, KcalSet[], number | null, number, number][] = [
    // 3.0×70×40/3600 + 1.8×70×60/3600 + 3.5×70×30/3600 + 1.8×70×90/3600 + 2.8×70×30.5/3600 = 11.29
    ["the route test's workout, at the 70 kg default", [s(3, 40_000, 12, 60), s(3.5, 30_000, 8, 90), s(2.8, 30_500, 30, null)], null, 30 * 60_000, 11],
    ["an hour at MET 10 and 70 kg", [s(10, HOUR, 1, null)], null, HOUR, 700],
    ["the person's own weight", [s(10, HOUR, 1, null)], 100, HOUR, 1000],
    ["a weight of nothing reads as the default", [s(10, HOUR, 1, null)], 0, HOUR, 700],
    ["a set with nothing done is rest", [s(10, HOUR, 0, null)], null, HOUR, 126],
    ["an hour's rest", [s(10, 0, 1, 3600)], null, HOUR, 126],
    ["a set longer than the workout stops at its end", [s(10, 2 * HOUR, 1, null)], null, HOUR, 700],
    ["rest after the workout's end is nothing", [s(10, HOUR, 1, 3600)], null, HOUR, 700],
    ["time is spent in the order of the sets", [s(10, HOUR, 1, null), s(20, HOUR, 1, null)], null, HOUR, 700],
    ["a workout of no time", [s(10, HOUR, 1, 60)], null, 0, 0],
    // A pause is time in the workout with no set and no rest: charged at nothing.
    ["a pause", [s(10, HOUR / 2, 1, null)], null, HOUR, 350],
  ];
  it.each(cases)("%s", (_name, sets, weightKg, lengthMs, expected) => {
    expect(kcalForSave(sets, weightKg, lengthMs)).toBe(expected);
  });
});
