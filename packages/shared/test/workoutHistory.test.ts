// The calendar's days (64a-v): which ranges of days a phone may ask for in one read, and the values of a workout's
// new records, named by one rule for the screen after a workout and for its page in History.
import { describe, expect, it } from "vitest";
import { estimatedOneRepMaxGrams, historyRangeQuerySchema, recordValues, type HistoryWorkout } from "../src/index.js";

describe("the calendar's days asked for in one read", () => {
  it.each([
    ["a year that ends today", { from: "2025-11-23", to: "2026-11-22" }, true],
    ["a leap year's 366 days", { from: "2024-01-01", to: "2024-12-31" }, true],
    ["one day", { from: "2026-11-22", to: "2026-11-22" }, true],
    ["367 days", { from: "2025-11-21", to: "2026-11-22" }, false],
    ["from after to", { from: "2026-11-23", to: "2026-11-22" }, false],
    ["a day not on the calendar", { from: "2026-02-30", to: "2026-03-02" }, false],
    ["no to", { from: "2026-11-01" }, false],
    ["a word more", { from: "2026-11-01", to: "2026-11-02", x: "1" }, false],
  ])("%s: %s", (_case, query, ok) => {
    expect(historyRangeQuerySchema.safeParse(query).success).toBe(ok);
  });
});

describe("what each new record was", () => {
  const set = (position: number, exercise: string, measuredIn: "reps" | "time", done: number, weightGrams: number | null) => ({
    position, exercise, exerciseName: exercise === "plank" ? "Plank" : "Barbell Curl", measuredIn, target: null, done, weightGrams, restSeconds: null, durationMs: 30_000, counted: "hand" as const, formScore: null,
  });
  const sets: HistoryWorkout["sets"] = [set(3, "barbell_curl", "reps", 10, 30_000), set(5, "barbell_curl", "reps", 8, 32_500), set(9, "plank", "time", 75, null)];

  it.each([
    ["heaviest is its set's weight", { kind: "heaviest" as const, position: 5 }, 32_500],
    ["most reps is its set's reps", { kind: "most_reps" as const, position: 3 }, 10],
    ["the estimate is Epley's on its set", { kind: "best_estimated_1rm" as const, position: 5 }, estimatedOneRepMaxGrams(32_500, 8)],
    ["most lifted is the exercise's sets in reps together", { kind: "most_lifted" as const, position: null }, 10 * 30_000 + 8 * 32_500],
  ])("%s", (_case, r, value) => {
    expect(recordValues({ sets, newRecords: [{ exercise: "barbell_curl", measuredIn: "reps", ...r }] })).toEqual([{ exercise: "barbell_curl", exerciseName: "Barbell Curl", measuredIn: "reps", ...r, value }]);
  });

  it("the longest hold is its set's seconds; a record whose set is not in the workout is left out, never valued at 0", () => {
    expect(recordValues({ sets, newRecords: [{ exercise: "plank", measuredIn: "time", kind: "longest_hold", position: 9 }] })[0]?.value).toBe(75);
    expect(recordValues({ sets, newRecords: [{ exercise: "barbell_curl", measuredIn: "reps", kind: "heaviest", position: 4 }] })).toEqual([]);
  });
});
