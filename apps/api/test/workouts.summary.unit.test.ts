// Post-workout summary — the PURE pieces: the meal/stretch/record tables and
// the per-workout XP figure. No DB, so these run everywhere.
//
// These assertions are the proof. The stretches and the record labels are ported
// from `backend-ml/app/routers/workouts.py:562-639`, and each such expectation is
// the STRING from that Python file. The meal ideas are not ported: they come from
// the day's own rule (ROADMAP 34d-ii).
import { describe, expect, it } from "vitest";
import { mealSuggestionSchema } from "@app/shared";
import { SUGGEST_POOLS, suggestAfterWorkout } from "../src/modules/nutrition/suggest.js";
import {
  amountWords,
  mealSuggestionsFrom,
  personalRecordsFor,
  primaryMusclesFor,
  stretchesFor,
} from "../src/modules/workouts/summaryContent.js";
import { isStreakContinuationDay, xpEarnedForWorkout } from "../src/modules/gamification/xp.js";

describe("the meal ideas in the card's words (34d-ii; the rule itself is nutrition.suggest.unit.test.ts)", () => {
  const ideas = suggestAfterWorkout({ seed: "person-1|workout-1", diet: "vegan", kcalBurned: 450, day: null });

  it("each food with its amount, joined, and timings that count from the workout", () => {
    const said = mealSuggestionsFrom(ideas);
    expect(said.map((s) => s.timing)).toEqual(["Within 30 mins", "Within 2 hours"]);
    said.forEach((one, at) => {
      const idea = ideas[at]?.idea;
      expect(one.idea).toEqual(idea);
      expect(one.meal).toBe(idea?.items.map((i) => `${i.name} (${amountWords(i)})`).join(" + "));
      expect(mealSuggestionSchema.safeParse(one).success).toBe(true);
    });
  });

  it.each([
    [{ unit: "g", grams: 150, servings: 1.5 }, "150 g"],
    [{ unit: "g", grams: 112.5, servings: 1.125 }, "113 g"],
    [{ unit: "cup", grams: 120, servings: 0.5 }, "½ cup"],
    [{ unit: "cup", grams: 240, servings: 1 }, "1 cup"],
    [{ unit: "cup", grams: 360, servings: 1.5 }, "1½ cups"],
    [{ unit: "oz", grams: 28, servings: 1 }, "1 oz"],
    [{ unit: "2 tbsp", grams: 32, servings: 1 }, "2 tbsp"],
    [{ unit: "2 tbsp", grams: 64, servings: 2 }, "4 tbsp"],
    [{ unit: "slice", grams: 32, servings: 1 }, "1 slice"],
    [{ unit: "slice", grams: 64, servings: 2 }, "2 slices"],
    [{ unit: "egg", grams: 150, servings: 3 }, "3 eggs"],
    [{ unit: "potato", grams: 346, servings: 2 }, "2 potatoes"],
    [{ unit: "peach", grams: 150, servings: 1 }, "1 peach"],
    [{ unit: "peach", grams: 300, servings: 2 }, "2 peaches"],
    [{ unit: "sandwich", grams: 400, servings: 2 }, "2 sandwiches"],
    [{ unit: "banana", grams: 118, servings: 1 }, "1 banana"],
    [{ unit: "container", grams: 170, servings: 1 }, "1 container"],
  ])("%o reads %s", (item, words) => {
    expect(amountWords(item)).toBe(words);
  });

  it("every unit a suggested food has is said in words, never in grams unless it is weighed", () => {
    for (const food of Object.values(SUGGEST_POOLS).flat()) {
      const words = amountWords({ unit: food.unit, grams: food.serving, servings: 1 });
      expect(words, food.name).toMatch(food.unit === "g" ? /^\d+ g$/ : /^\d+ [a-z]+$/);
      if (food.unit !== "g") expect(words, food.name).not.toMatch(/ g$/);
    }
  });

  it("no ideas is no lines", () => {
    expect(mealSuggestionsFrom([])).toEqual([]);
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
