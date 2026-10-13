// The starter goals, the pure half (ROADMAP Stage 5 item 30b): which goals the app gives
// to whom, and with what numbers. The expected kinds are written out here, never read
// from the rule they check.
import { describe, expect, it } from "vitest";
import { putGoalRequestSchema, type GoalKind, type NoDeficitReason, type WeightGoal } from "@app/shared";
import type { GoalRules } from "../src/modules/goals/measure.js";
import { starterGoals } from "../src/modules/goals/starter.js";

const ANSWERS = { trainingDays: 3, sessionMinutes: 45 };
const kindsFor = (rules: GoalRules): GoalKind[] => starterGoals(ANSWERS, rules).map((g) => g.kind);

const rules = (weightGoal: WeightGoal | null, noCutReasons: NoDeficitReason[] = [], safeMode = false): GoalRules => ({
  safeMode,
  weightGoal,
  noCutReasons,
});

describe("THE WORST THING: nobody the plan may not cut is handed a weight to lose", () => {
  const noCut: [string, NoDeficitReason[], boolean][] = [
    ["under 18", ["under_18"], false],
    ["a yes on the health question, cleared", ["health_answer"], false],
    ["Safe mode", ["health_answer", "safe_mode"], true],
    ["under 18 with a yes", ["under_18", "health_answer"], false],
    ["under 18 in Safe mode", ["under_18", "health_answer", "safe_mode"], true],
  ];

  it.each(noCut)("%s, wanting to lose weight: no weight goal", (_name, reasons, safeMode) => {
    expect(kindsFor(rules("lose", reasons, safeMode))).not.toContain("weight");
  });

  it.each(noCut)("%s, keeping or gaining weight: the weight goal is given", (_name, reasons, safeMode) => {
    expect(kindsFor(rules("maintain", reasons, safeMode))).toContain("weight");
    expect(kindsFor(rules("gain", reasons, safeMode))).toContain("weight");
  });
});

describe("the set, for every class of person", () => {
  const cases: [string, GoalRules, GoalKind[]][] = [
    ["an adult losing weight", rules("lose"), ["training_days", "active_minutes", "calories_within", "protein", "weight"]],
    ["an adult keeping weight", rules("maintain"), ["training_days", "active_minutes", "calories_within", "protein", "weight"]],
    ["an adult gaining weight", rules("gain"), ["training_days", "active_minutes", "calories_within", "protein", "weight"]],
    ["no weight choice", rules(null), ["training_days", "active_minutes", "calories_within", "protein"]],
    ["under 18, losing", rules("lose", ["under_18"]), ["training_days", "active_minutes", "calories_within", "protein"]],
    ["under 18, gaining", rules("gain", ["under_18"]), ["training_days", "active_minutes", "calories_within", "protein", "weight"]],
    ["a yes, cleared, losing", rules("lose", ["health_answer"]), ["training_days", "active_minutes", "calories_within", "protein"]],
    ["a yes, cleared, keeping", rules("maintain", ["health_answer"]), ["training_days", "active_minutes", "calories_within", "protein", "weight"]],
    ["Safe mode, losing", rules("lose", ["health_answer", "safe_mode"], true), ["training_days", "calories_within", "protein"]],
    ["Safe mode, keeping", rules("maintain", ["health_answer", "safe_mode"], true), ["training_days", "calories_within", "protein", "weight"]],
    ["Safe mode, gaining", rules("gain", ["health_answer", "safe_mode"], true), ["training_days", "calories_within", "protein", "weight"]],
  ];

  it.each(cases)("%s", (_name, r, kinds) => {
    expect(kindsFor(r)).toEqual(kinds);
  });

  it("every goal is one a person could have added, and none repeats", () => {
    for (const [, r] of cases) {
      const goals = starterGoals(ANSWERS, r);
      for (const g of goals) expect(putGoalRequestSchema.safeParse(g).success, g.kind).toBe(true);
      expect(new Set(goals.map((g) => g.kind)).size).toBe(goals.length);
    }
  });
});

describe("the numbers are the person's own answers", () => {
  const byKind = (answers: { trainingDays: number | null; sessionMinutes: number | null }) =>
    Object.fromEntries(starterGoals(answers, rules("lose")).map((g) => [g.kind, g]));

  it("3 days of 45 minutes: 3 training days and 135 active minutes a week", () => {
    const set = byKind(ANSWERS);
    expect(set["training_days"]).toEqual({ kind: "training_days", period: "week", target: 3, exerciseId: null });
    expect(set["active_minutes"]).toEqual({ kind: "active_minutes", period: "week", target: 135, exerciseId: null });
  });

  it("7 days of 240 minutes, the most setup takes, still fits", () => {
    const set = byKind({ trainingDays: 7, sessionMinutes: 240 });
    expect(set["training_days"]?.target).toBe(7);
    expect(set["active_minutes"]?.target).toBe(1680);
  });

  it("calories, protein and weight carry no typed number: the plan gives it on every read", () => {
    const set = byKind(ANSWERS);
    for (const kind of ["calories_within", "protein", "weight"]) expect(set[kind]?.target, kind).toBeNull();
  });

  it.each([
    ["no training days answered", { trainingDays: null, sessionMinutes: 45 }, ["calories_within", "protein", "weight"]],
    ["no session length answered", { trainingDays: 3, sessionMinutes: null }, ["training_days", "calories_within", "protein", "weight"]],
    ["no days a week", { trainingDays: 0, sessionMinutes: 45 }, ["calories_within", "protein", "weight"]],
    ["no minutes", { trainingDays: 3, sessionMinutes: 0 }, ["training_days", "calories_within", "protein", "weight"]],
  ])("%s: no goal is made from it, and no nought", (_name, answers, kinds) => {
    expect(starterGoals(answers, rules("lose")).map((g) => g.kind)).toEqual(kinds);
  });
});
