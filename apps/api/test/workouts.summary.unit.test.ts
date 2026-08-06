// Post-workout summary — the PURE pieces: the ported meal/stretch/record tables
// and the per-workout XP figure. No DB, so these run everywhere.
//
// These assertions are the port's proof. `summaryContent.ts` claims to be a
// verbatim port of `backend-ml/app/routers/workouts.py:562-639`; a comment
// saying so is not evidence, and this project has recorded a "port" whose own
// record was the only thing certifying it more than once. Every expectation
// below is the STRING or THRESHOLD from that Python file.
import { describe, expect, it } from "vitest";
import {
  mealSuggestionsFor,
  personalRecordsFor,
  primaryMusclesFor,
  stretchesFor,
} from "../src/modules/workouts/summaryContent.js";
import { isStreakContinuationDay, xpEarnedForWorkout } from "../src/modules/gamification/xp.js";

describe("meal suggestions (workouts.py:600-615, verbatim)", () => {
  it("the >400 band, and its boundary is EXCLUSIVE", () => {
    expect(mealSuggestionsFor(401)).toEqual([
      { meal: "Protein shake + banana", timing: "Within 30 mins" },
      { meal: "Grilled chicken + rice + vegetables", timing: "Within 2 hours" },
      { meal: "Greek yogurt with berries", timing: "1 hour before bed" },
    ]);
    // Python is `if calories > 400`, so 400 itself falls to the middle band.
    // A `>=` port would be invisible on every other input.
    expect(mealSuggestionsFor(400)).toHaveLength(2);
  });

  it("the >200 band, and its boundary is EXCLUSIVE", () => {
    expect(mealSuggestionsFor(201)).toEqual([
      { meal: "Protein shake or chocolate milk", timing: "Within 30 mins" },
      { meal: "Eggs + whole grain toast + avocado", timing: "Within 2 hours" },
    ]);
    expect(mealSuggestionsFor(200)[0]?.meal).toBe("Banana + peanut butter");
  });

  it("the low band, and a NULL kcal takes it — Python's `.get(…, 0)`", () => {
    const low = [
      { meal: "Banana + peanut butter", timing: "Within 30 mins" },
      { meal: "Light salad with grilled protein", timing: "Within 2 hours" },
    ];
    expect(mealSuggestionsFor(0)).toEqual(low);
    expect(mealSuggestionsFor(null)).toEqual(low);
  });
});

describe("stretches (workouts.py:617-639, verbatim)", () => {
  it("each muscle rule fires on either of its two names", () => {
    expect(stretchesFor(new Set(["Quadriceps"]))).toEqual(["Hip flexor stretch — 30 seconds each side"]);
    expect(stretchesFor(new Set(["Glutes"]))).toEqual(["Hip flexor stretch — 30 seconds each side"]);
    expect(stretchesFor(new Set(["Chest"]))).toEqual(["Chest doorway stretch — 30 seconds"]);
    expect(stretchesFor(new Set(["Shoulders"]))).toEqual(["Chest doorway stretch — 30 seconds"]);
    expect(stretchesFor(new Set(["Hamstrings"]))).toEqual(["Seated hamstring stretch — 45 seconds"]);
    expect(stretchesFor(new Set(["Abs"]))).toEqual(["Cat-cow stretch — 10 reps"]);
    expect(stretchesFor(new Set(["Obliques"]))).toEqual(["Cat-cow stretch — 10 reps"]);
  });

  it("rules accumulate, in the Python file's order", () => {
    expect(stretchesFor(new Set(["Hamstrings", "Abs", "Quadriceps"]))).toEqual([
      "Hip flexor stretch — 30 seconds each side",
      "Seated hamstring stretch — 45 seconds",
      "Cat-cow stretch — 10 reps",
    ]);
  });

  it("no match falls back to the generic three — never an empty list", () => {
    expect(stretchesFor(new Set(["Forearms"]))).toEqual([
      "Full body stretch — 5 minutes",
      "Child's pose — 30 seconds",
      "Neck rolls — 10 each direction",
    ]);
    expect(stretchesFor(new Set())).toHaveLength(3);
  });
});

describe("primaryMusclesFor — the join the stretch rules depend on", () => {
  // THE LOAD-BEARING ASSERTION. The rules above match on exact strings from the
  // seed; if the content file ever spelled a muscle differently, every workout
  // would quietly fall through to the generic fallback and no other test here
  // would notice. This pins a real catalog slug to a real rule.
  it("a real squat resolves to muscles that reach a real rule", () => {
    const muscles = primaryMusclesFor(["squat"]);
    expect(muscles.has("Quadriceps") || muscles.has("Glutes")).toBe(true);
    expect(stretchesFor(muscles)).toContain("Hip flexor stretch — 30 seconds each side");
  });

  it("an unknown slug contributes nothing rather than throwing", () => {
    expect(primaryMusclesFor(["not_an_exercise"]).size).toBe(0);
  });

  it("muscles are UNIONED across the workout's exercises, not per-set duplicated", () => {
    expect(primaryMusclesFor(["squat", "squat"])).toEqual(primaryMusclesFor(["squat"]));
  });
});

describe("personal records (workouts.py:562-586)", () => {
  const none = {
    maxKcalWorkoutId: null,
    longestWorkoutId: null,
    bestAvgFormWorkoutId: null,
    maxKcalValue: null,
    longestValue: null,
    bestAvgFormValue: null,
  };

  it("claims only the records THIS workout holds, in the Python file's order", () => {
    expect(
      personalRecordsFor("w1", {
        ...none,
        longestWorkoutId: "w1",
        longestValue: 1800,
        bestAvgFormWorkoutId: "w1",
        bestAvgFormValue: 92,
        maxKcalWorkoutId: "w1",
        maxKcalValue: 210,
      }),
    ).toEqual(["Longest workout session!", "Best form accuracy!", "Most calories burned!"]);
  });

  it("another workout holding the record yields NOTHING for this one", () => {
    expect(
      personalRecordsFor("w1", { ...none, longestWorkoutId: "w2", longestValue: 9000 }),
    ).toEqual([]);
  });

  it("a ZERO value is not a record — Python required `> 0`", () => {
    // Without the `value > 0` test a first-ever workout with 0 kcal would be
    // congratulated for "Most calories burned!".
    expect(
      personalRecordsFor("w1", { ...none, maxKcalWorkoutId: "w1", maxKcalValue: 0 }),
    ).toEqual([]);
  });

  it("no records at all is an empty list, which is a FACT and not a failed read", () => {
    expect(personalRecordsFor("w1", none)).toEqual([]);
  });
});

describe("xpEarnedForWorkout (badges.py constants via XP_REWARDS)", () => {
  it("base 50, with no bonuses", () => {
    expect(xpEarnedForWorkout({ avgFormScore: 79, isStreakContinuation: false })).toBe(50);
  });

  it("+20 at exactly 80, +50 at exactly 100 — the thresholds are INCLUSIVE", () => {
    expect(xpEarnedForWorkout({ avgFormScore: 80, isStreakContinuation: false })).toBe(70);
    expect(xpEarnedForWorkout({ avgFormScore: 99, isStreakContinuation: false })).toBe(70);
    expect(xpEarnedForWorkout({ avgFormScore: 100, isStreakContinuation: false })).toBe(100);
  });

  it("an UNSCORED workout earns the base only — never a bonus from a null", () => {
    expect(xpEarnedForWorkout({ avgFormScore: null, isStreakContinuation: false })).toBe(50);
  });

  it("+10 for a streak continuation, and it stacks with the form bonus", () => {
    // This is the deliberate departure from the old SUMMARY endpoint, which
    // omitted the streak bonus its own COMPLETE endpoint awarded. Kd approved
    // including it; pinned here so a later "port fidelity" fix cannot silently
    // reintroduce a figure that disagrees with the XP total beside it.
    expect(xpEarnedForWorkout({ avgFormScore: null, isStreakContinuation: true })).toBe(60);
    expect(xpEarnedForWorkout({ avgFormScore: 100, isStreakContinuation: true })).toBe(110);
  });
});

describe("isStreakContinuationDay", () => {
  it("true only when the IMMEDIATELY preceding day is an activity day", () => {
    expect(isStreakContinuationDay(["2026-08-04", "2026-08-05"], "2026-08-05")).toBe(true);
    expect(isStreakContinuationDay(["2026-08-03", "2026-08-05"], "2026-08-05")).toBe(false);
  });

  it("a lone first workout is not a continuation of itself", () => {
    expect(isStreakContinuationDay(["2026-08-05"], "2026-08-05")).toBe(false);
  });

  it("a LATER day does not make an earlier one a continuation", () => {
    // Direction matters: `dayDiff(prev, cur) === 1` is not symmetric, and a
    // symmetric test would award +10 to the first workout of every streak.
    expect(isStreakContinuationDay(["2026-08-06"], "2026-08-05")).toBe(false);
  });

  it("crosses a month boundary", () => {
    expect(isStreakContinuationDay(["2026-07-31"], "2026-08-01")).toBe(true);
  });
});
