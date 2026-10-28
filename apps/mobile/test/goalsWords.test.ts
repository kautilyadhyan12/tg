import { describe, expect, it } from "vitest";
import { GOAL_KIND_RULES, goalTargetMax, type Goal, type GoalKind } from "@app/shared";
import { goal } from "./goalFixture";
import {
  KIND_ORDER,
  checkTarget,
  exerciseName,
  freePeriods,
  goalLine,
  goalName,
  goalProgress,
  newGoalId,
  startingTarget,
  summaryWords,
  targetLabel,
  weightWords,
} from "../src/screens/goals/words";

const HELD = { target: null, current: null, reached: null } as const;

describe("the worst thing: a held goal shows no number to chase, only why", () => {
  it.each([
    [["under_18"], "No weight loss, because you're under 18"],
    [["health_answer"], "No weight loss, because of your health answer"],
    [["safe_mode"], "No weight loss, because Safe mode is on"],
    [["under_18", "health_answer"], "No weight loss, because you're under 18 and of your health answer"],
  ] as const)("a weight goal held for %j", (reasons, words) => {
    const held = goal({ kind: "weight", direction: "at_most", ...HELD, held: { code: "no_weight_loss", reasons: [...reasons] } });
    expect(goalProgress(held, "metric")).toEqual({ kind: "held", words });
    // Its line names the goal and no weight.
    expect(goalLine(held, "metric")).toBe("Weight");
  });

  it.each(["calories_burned", "active_minutes", "reps_in_set"] as const)("Safe mode holds %s", (kind) => {
    const held = goal({ kind, ...HELD, held: { code: "safe_mode" }, exerciseId: kind === "reps_in_set" ? "5e4d3c2b-1a0f-4e9d-8c7b-6a5f4e3d2c1b" : null });
    expect(goalProgress(held, "metric")).toEqual({ kind: "held", words: "Paused while Safe mode is on" });
    expect(goalLine(held, "metric")).not.toMatch(/\d/);
  });
});

describe("each kind in words", () => {
  const cases: [Partial<Goal> & Pick<Goal, "kind">, string, string][] = [
    [{ kind: "training_days", period: "week" }, "Train 4 days a week", "2 of 4 days this week"],
    [{ kind: "training_days", period: "month", target: 1, current: 0 }, "Train 1 day a month", "0 of 1 day this month"],
    [{ kind: "streak", target: 30, current: 12 }, "Keep a 30-day streak", "12 of 30 days"],
    [{ kind: "gym_visits", period: "week", target: 3, current: 3, reached: true }, "Check in 3 days a week", "3 of 3 days this week"],
    [{ kind: "calories_burned", period: "day", target: 400, current: 1250 }, "Burn 400 kcal a day", "1,250 of 400 kcal today"],
    [{ kind: "active_minutes", period: "week", target: 150, current: 45 }, "150 active minutes a week", "45 of 150 minutes this week"],
    [{ kind: "reps_in_set", target: 20, current: 14, exerciseId: "5e4d3c2b-1a0f-4e9d-8c7b-6a5f4e3d2c1b", exerciseSlug: "jump_squat" }, "Jump squat: 20 reps in one set", "14 of 20 reps"],
    [{ kind: "weight", direction: "at_most", target: 75, current: 82.4 }, "Reach 75 kg", "82.4 kg now"],
    [{ kind: "weight", direction: "steady", target: 70, current: 70, reached: null }, "Keep your weight at 70 kg", "70 kg now"],
    [{ kind: "weight", direction: "at_least", target: 80, current: null, reached: false }, "Reach 80 kg", "No weigh-in yet"],
    [{ kind: "calories_within", direction: "at_most", target: 2100, current: 1420 }, "Eat within 2,100 kcal a day", "1,420 of 2,100 kcal today"],
    [{ kind: "calories_within", direction: "at_most", target: 2100, current: 2300 }, "Eat within 2,100 kcal a day", "200 kcal over today"],
    [{ kind: "protein", target: 140, current: 86 }, "Eat 140 g protein a day", "86 of 140 g today"],
    [{ kind: "food_logged_days", period: "week", target: 5, current: 1 }, "Log food 5 days a week", "1 of 5 days this week"],
  ];
  it.each(cases)("%j", (more, line, progress) => {
    const g = goal(more);
    expect(goalLine(g, "metric")).toBe(line);
    expect(goalProgress(g, "metric").words).toBe(progress);
  });

  it("every kind has a line", () => {
    expect([...KIND_ORDER].sort()).toEqual(Object.keys(GOAL_KIND_RULES).sort());
  });

  it("a weight in pounds for somebody who uses them", () => {
    expect(weightWords(75, "imperial")).toBe("165 lb");
    expect(goalLine(goal({ kind: "weight", direction: "at_most", target: 75, current: 82 }), "imperial")).toBe("Reach 165 lb");
  });

  it("a goal waiting on an answer says which", () => {
    expect(goalProgress(goal({ kind: "protein", target: null, current: 40, reached: null, needs: "plan" }), "metric")).toEqual({
      kind: "needs",
      words: "Finish setup to set this goal",
    });
    expect(goalProgress(goal({ kind: "weight", target: null, current: 80, reached: null, needs: "target_weight" }), "metric").words).toBe(
      "Pick a target weight to set this goal",
    );
  });

  it("a calories goal kept to is ticked done; one over its number draws no climbed trail", () => {
    const within = goal({ kind: "calories_within", direction: "at_most", target: 2100, current: 1900, reached: true });
    expect(goalProgress(within, "metric")).toEqual({ kind: "done", words: "1,900 of 2,100 kcal today" });
    const over = goal({ kind: "calories_within", direction: "at_most", target: 2100, current: 2300, reached: false });
    expect(goalProgress(over, "metric")).toEqual({ kind: "going", words: "200 kcal over today", share: null });
  });

  it("a reached goal is done; a share fills the bar only where more is closer or the day fills up", () => {
    expect(goalProgress(goal({ kind: "training_days", period: "week", target: 4, current: 5, reached: true }), "metric").kind).toBe("done");
    expect(goalProgress(goal({ kind: "training_days", period: "week" }), "metric")).toMatchObject({ share: 0.5 });
    expect(goalProgress(goal({ kind: "weight", direction: "at_most", target: 75, current: 82 }), "metric")).toMatchObject({ share: null });
  });

  it("the summary counts only the goals the server judges", () => {
    const goals = [
      goal({ kind: "training_days", reached: true }),
      goal({ kind: "protein", reached: false }),
      goal({ kind: "weight", direction: "steady", reached: null }),
      goal({ kind: "weight", direction: "at_most", ...HELD, held: { code: "no_weight_loss", reasons: ["under_18"] } }),
    ];
    expect(summaryWords(goals)).toBe("1 of 2 reached");
    expect(summaryWords([goals[2] as Goal])).toBeNull();
  });
});

describe("adding and changing", () => {
  it("offers only the periods the person has no goal of yet; reps in one set is never full", () => {
    const kept = [goal({ kind: "training_days", period: "week" }), goal({ kind: "training_days", period: "year" })];
    expect(freePeriods("training_days", kept)).toEqual(["month"]);
    expect(freePeriods("protein", [goal({ kind: "protein" })])).toEqual([]);
    expect(freePeriods("streak", [])).toEqual([null]);
    expect(freePeriods("reps_in_set", [goal({ kind: "reps_in_set", exerciseId: "5e4d3c2b-1a0f-4e9d-8c7b-6a5f4e3d2c1b" })])).toEqual([null]);
  });

  it("every starting number fits its kind and period, and none is typed where the plan sets it", () => {
    for (const kind of Object.keys(GOAL_KIND_RULES) as GoalKind[]) {
      const rule = GOAL_KIND_RULES[kind];
      for (const period of rule.periods.length === 0 ? [null] : rule.periods) {
        const start = startingTarget(kind, period);
        const max = goalTargetMax(kind, period);
        if (max === null) expect([kind, start]).toEqual([kind, null]);
        else expect([kind, period, start !== null && start >= 1 && start <= max]).toEqual([kind, period, true]);
      }
    }
    expect(startingTarget("active_minutes", "week")).toBe(150);
    expect(startingTarget("training_days", "week")).toBe(3);
  });

  it.each([
    ["4", "training_days", "week", { ok: true, target: 4 }],
    ["7", "training_days", "week", { ok: true, target: 7 }],
    ["8", "training_days", "week", { ok: false, words: "Enter a number from 1 to 7." }],
    ["0", "training_days", "week", { ok: false, words: "Enter a number from 1 to 7." }],
    ["", "streak", null, { ok: false, words: "Enter a number from 1 to 1,000." }],
    ["2.5", "active_minutes", "day", { ok: false, words: "Enter a number from 1 to 600." }],
    ["-3", "active_minutes", "day", { ok: false, words: "Enter a number from 1 to 600." }],
    [" 30 ", "active_minutes", "day", { ok: true, target: 30 }],
  ] as const)("%j for %s %s", (typed, kind, period, result) => {
    expect(checkTarget(typed, kind, period)).toEqual(result);
  });

  it.each([
    ["training_days", "week", "Days a week"],
    ["calories_burned", "day", "Kcal a day"],
    ["active_minutes", "month", "Minutes a month"],
    ["streak", null, "Days in a row"],
    ["reps_in_set", null, "Reps"],
  ] as const)("the number box for %s %s reads %s", (kind, period, label) => {
    expect(targetLabel(kind, period)).toBe(label);
  });

  it("a reps goal is named by its exercise", () => {
    expect(goalName({ kind: "reps_in_set", exerciseSlug: "jump_squat" })).toBe("Jump squat");
    expect(goalName({ kind: "protein", exerciseSlug: null })).toBe("Protein");
  });

  it("a goal id is a UUID in small letters, new each time", () => {
    const a = newGoalId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newGoalId()).not.toBe(a);
    expect(exerciseName("worlds_greatest_stretch")).toBe("Worlds greatest stretch");
  });
});
