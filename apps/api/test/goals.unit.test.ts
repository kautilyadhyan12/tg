// Goals, the pure half (ROADMAP Stage 5 item 30a): which goals are held for whom, the
// days a period covers, how each kind is measured, and what a request may ask for.
import { describe, expect, it } from "vitest";
import {
  GOAL_KIND_RULES,
  goalKindSchema,
  goalSchema,
  goalTargetMax,
  putGoalRequestSchema,
  type GoalKind,
  type GoalPeriod,
} from "@app/shared";
import { goalHeld, goalWindow, measureGoal, windowSpan, type GoalFacts, type GoalRules } from "../src/modules/goals/measure.js";

const KINDS = goalKindSchema.options;
const EXERCISE = "11111111-1111-4111-8111-111111111111";

const FREE: GoalRules = { safeMode: false, weightGoal: "lose", noCutReasons: [] };

const facts = (over: Partial<GoalFacts> = {}): GoalFacts => ({
  today: "2026-03-11",
  rules: FREE,
  workoutDays: [],
  mealDays: [],
  visitDays: [],
  bestReps: new Map(),
  streak: 0,
  weightKg: 70,
  targetWeightKg: 65,
  healthyFloorKg: null,
  planReady: true,
  rings: { kcal: 1800, proteinG: 120 },
  ...over,
});

describe("THE WORST THING: nobody the plan may not cut is given a weight to lose or less to eat", () => {
  const noCut: [string, GoalRules][] = [
    ["under 18", { safeMode: false, weightGoal: "lose", noCutReasons: ["under_18"] }],
    ["a yes on the health question", { safeMode: false, weightGoal: "lose", noCutReasons: ["health_answer"] }],
    ["Safe mode", { safeMode: true, weightGoal: "lose", noCutReasons: ["health_answer", "safe_mode"] }],
    ["under 18 with a yes", { safeMode: false, weightGoal: "lose", noCutReasons: ["under_18", "health_answer"] }],
  ];

  it.each(noCut)("%s: a weight to lose is held, with the reasons, and shows no number", (_name, rules) => {
    expect(goalHeld("weight", rules)).toEqual({ code: "no_weight_loss", reasons: rules.noCutReasons });
    const m = measureGoal({ kind: "weight", period: null, target: null, exerciseId: null }, facts({ rules }));
    expect(m).toMatchObject({ target: null, current: null, reached: null, needs: null });
    expect(m.held).toEqual({ code: "no_weight_loss", reasons: rules.noCutReasons });
  });

  it.each(noCut)("%s: keeping or gaining weight is not held", (_name, rules) => {
    expect(goalHeld("weight", { ...rules, weightGoal: "maintain" })).toBeNull();
    expect(goalHeld("weight", { ...rules, weightGoal: "gain" })).toBeNull();
  });

  it("a person the plan may cut keeps a weight to lose", () => {
    expect(goalHeld("weight", FREE)).toBeNull();
  });

  it("the calories goal has no number of its own: its target is the rings' number and nothing typed", () => {
    expect(goalTargetMax("calories_within", "day")).toBeNull();
    expect(putGoalRequestSchema.safeParse({ kind: "calories_within", period: "day", target: 900, exerciseId: null }).success).toBe(false);
    // A stored target is not read either: the rings' number wins.
    const m = measureGoal({ kind: "calories_within", period: "day", target: 900, exerciseId: null }, facts({ rings: { kcal: 1901, proteinG: 110 } }));
    expect(m.target).toBe(1901);
  });
});

describe("THE WORST THING, by the target: a weight goal never shows a target the plan refuses", () => {
  const goal = { kind: "weight" as const, period: null, target: null, exerciseId: null };
  const GAIN: GoalRules = { ...FREE, weightGoal: "gain" };

  it("a target under the lowest healthy weight is shown as that weight, never the typed one", () => {
    const m = measureGoal(goal, facts({ targetWeightKg: 40, healthyFloorKg: 50.4 }));
    expect(m).toMatchObject({ direction: "at_most", target: 50.4, current: 70, reached: false, needs: null });
    // Already at or under the lowest healthy weight: nothing to lose, and no number.
    for (const weightKg of [50.4, 48]) {
      expect(measureGoal(goal, facts({ weightKg, targetWeightKg: 40, healthyFloorKg: 50.4 }))).toMatchObject({
        target: null,
        reached: null,
        needs: "target_weight",
      });
    }
    // A target at or over the healthy weight is the person's own.
    expect(measureGoal(goal, facts({ targetWeightKg: 55, healthyFloorKg: null })).target).toBe(55);
  });

  const wrongSide: [string, Partial<GoalFacts>][] = [
    ["lose, 70 kg, target 83", { targetWeightKg: 83 }],
    ["lose, 70 kg, target 70", { targetWeightKg: 70 }],
    ["gain, 70 kg, target 65 kept from a loss", { targetWeightKg: 65, rules: GAIN }],
    ["gain, 70 kg, target 70", { targetWeightKg: 70, rules: GAIN }],
  ];
  it.each(wrongSide)("%s: never reached, and a new target is asked for", (_name, over) => {
    expect(measureGoal(goal, facts(over))).toMatchObject({ target: null, current: 70, reached: null, needs: "target_weight", held: null });
  });

  it.each(wrongSide)("%s: the food goals ask for a new target weight too, not for setup", (_name, over) => {
    for (const kind of ["calories_within", "protein"] as const) {
      const m = measureGoal({ kind, period: "day", target: null, exerciseId: null }, facts({ ...over, rings: null }));
      expect(m).toMatchObject({ target: null, reached: null, needs: "target_weight" });
    }
  });

  it("with setup unfinished the food goals ask for setup", () => {
    const m = measureGoal({ kind: "protein", period: "day", target: null, exerciseId: null }, facts({ targetWeightKg: 83, rings: null, planReady: false }));
    expect(m.needs).toBe("plan");
  });
});

describe("Safe mode holds the goals that ask for more effort, and no other", () => {
  const safe: GoalRules = { safeMode: true, weightGoal: "maintain", noCutReasons: ["health_answer", "safe_mode"] };
  const expected: Record<GoalKind, boolean> = {
    training_days: false,
    streak: false,
    gym_visits: false,
    calories_burned: true,
    active_minutes: true,
    reps_in_set: true,
    weight: false,
    calories_within: false,
    protein: false,
    food_logged_days: false,
  };

  it.each(KINDS)("%s", (kind) => {
    expect(goalHeld(kind, safe)).toEqual(expected[kind] ? { code: "safe_mode" } : null);
    // A yes that a professional has cleared is not Safe mode.
    expect(goalHeld(kind, { ...safe, safeMode: false, noCutReasons: ["health_answer"] })).toBeNull();
  });

  it("a held goal keeps its window and shows no number", () => {
    const m = measureGoal(
      { kind: "calories_burned", period: "week", target: 2000, exerciseId: null },
      facts({ rules: safe, workoutDays: [{ day: "2026-03-10", kcal: 900, ms: 3_600_000 }] }),
    );
    expect(m).toEqual({
      unit: "kcal",
      direction: "at_least",
      target: null,
      current: null,
      reached: null,
      held: { code: "safe_mode" },
      needs: null,
      window: { start: "2026-03-09", end: "2026-03-15" },
    });
  });
});

describe("the days a period covers", () => {
  const cases: [GoalPeriod, string, string, string][] = [
    ["day", "2026-03-11", "2026-03-11", "2026-03-11"],
    ["week", "2026-03-11", "2026-03-09", "2026-03-15"], // a Wednesday
    ["week", "2026-03-09", "2026-03-09", "2026-03-15"], // a Monday is its week's first day
    ["week", "2026-03-15", "2026-03-09", "2026-03-15"], // a Sunday is its week's last
    ["week", "2026-01-01", "2025-12-29", "2026-01-04"], // a week that began last year
    ["week", "2024-02-29", "2024-02-26", "2024-03-03"], // across the end of a leap February
    ["month", "2026-03-11", "2026-03-01", "2026-03-31"],
    ["month", "2024-02-10", "2024-02-01", "2024-02-29"],
    ["month", "2026-02-28", "2026-02-01", "2026-02-28"],
    ["month", "2026-12-31", "2026-12-01", "2026-12-31"],
    ["year", "2026-03-11", "2026-01-01", "2026-12-31"],
    ["year", "2024-12-31", "2024-01-01", "2024-12-31"],
  ];
  it.each(cases)("%s around %s is %s to %s", (period, today, start, end) => {
    expect(goalWindow(period, today)).toEqual({ start, end });
  });

  it("several goals are read over the days they cover between them", () => {
    const g = (period: GoalPeriod | null) => ({ kind: "training_days" as const, period, target: 1, exerciseId: null });
    expect(windowSpan([g(null)], "2026-01-01")).toBeNull();
    expect(windowSpan([g("week"), g(null)], "2026-01-01")).toEqual({ start: "2025-12-29", end: "2026-01-04" });
    expect(windowSpan([g("week"), g("year")], "2026-01-01")).toEqual({ start: "2025-12-29", end: "2026-12-31" });
  });
});

describe("how each kind is measured", () => {
  const workoutDays = [
    { day: "2026-01-20", kcal: 100, ms: 10 * 60_000 },
    { day: "2026-03-02", kcal: 200, ms: 20 * 60_000 },
    { day: "2026-03-08", kcal: 300, ms: 30 * 60_000 }, // the Sunday before this week
    { day: "2026-03-09", kcal: 400, ms: 40 * 60_000 },
    { day: "2026-03-11", kcal: 500, ms: 50 * 60_000 + 59_999 },
  ];
  const mealDays = [
    { day: "2026-02-27", kcal: 1500, proteinG: 80 },
    { day: "2026-03-10", kcal: 2100, proteinG: 130 },
    { day: "2026-03-11", kcal: 1200, proteinG: 90.4 },
  ];
  const visitDays = ["2025-12-31", "2026-03-01", "2026-03-09", "2026-03-10"];
  const f = facts({ workoutDays, mealDays, visitDays, bestReps: new Map([[EXERCISE, 18]]), streak: 6 });

  const cases: [GoalKind, GoalPeriod | null, number | null, number, boolean][] = [
    ["training_days", "week", 2, 2, true],
    ["training_days", "month", 5, 4, false],
    ["training_days", "year", 5, 5, true],
    ["gym_visits", "week", 3, 2, false],
    ["gym_visits", "month", 3, 3, true],
    ["gym_visits", "year", 4, 3, false], // last year's visit is not this year's
    ["food_logged_days", "week", 2, 2, true],
    ["food_logged_days", "month", 3, 2, false],
    ["food_logged_days", "year", 3, 3, true],
    ["calories_burned", "day", 500, 500, true],
    ["calories_burned", "week", 901, 900, false],
    ["calories_burned", "month", 1400, 1400, true],
    ["calories_burned", "year", 1500, 1500, true],
    ["active_minutes", "day", 51, 50, false], // 50 min 59 s is 50 minutes
    ["active_minutes", "week", 90, 90, true],
    ["active_minutes", "year", 151, 150, false],
    ["streak", null, 7, 6, false],
    ["streak", null, 6, 6, true],
    ["reps_in_set", null, 20, 18, false],
    ["reps_in_set", null, 18, 18, true],
  ];
  it.each(cases)("%s over %s, target %s: %s, reached %s", (kind, period, target, current, reached) => {
    const m = measureGoal({ kind, period, target, exerciseId: kind === "reps_in_set" ? EXERCISE : null }, f);
    expect(m).toMatchObject({ target, current, reached, direction: "at_least", held: null, needs: null });
    expect(m.unit).toBe(GOAL_KIND_RULES[kind].unit);
    expect(m.window).toEqual(period === null ? null : goalWindow(period, "2026-03-11"));
  });

  it("reps for an exercise never done are none, not somebody else's best", () => {
    const m = measureGoal({ kind: "reps_in_set", period: null, target: 10, exerciseId: "22222222-2222-4222-8222-222222222222" }, f);
    expect(m).toMatchObject({ current: 0, reached: false });
  });

  it("calories within: today's food against the rings' number, and a day with nothing logged is not kept", () => {
    const goal = { kind: "calories_within" as const, period: "day" as const, target: null, exerciseId: null };
    expect(measureGoal(goal, f)).toMatchObject({ direction: "at_most", target: 1800, current: 1200, reached: true });
    expect(measureGoal(goal, facts({ mealDays: [{ day: "2026-03-11", kcal: 1801, proteinG: 0 }] }))).toMatchObject({ current: 1801, reached: false });
    expect(measureGoal(goal, facts({ mealDays: [{ day: "2026-03-11", kcal: 1800, proteinG: 0 }] }))).toMatchObject({ reached: true });
    expect(measureGoal(goal, facts({ mealDays: [{ day: "2026-03-10", kcal: 900, proteinG: 0 }] }))).toMatchObject({ current: 0, reached: false });
    expect(measureGoal(goal, facts({ rings: null }))).toMatchObject({ target: null, current: null, reached: null, needs: "plan" });
  });

  it("protein: today's grams against the rings' number", () => {
    const goal = { kind: "protein" as const, period: "day" as const, target: null, exerciseId: null };
    expect(measureGoal(goal, f)).toMatchObject({ direction: "at_least", unit: "g", target: 120, current: 90, reached: false });
    expect(measureGoal(goal, facts({ mealDays: [{ day: "2026-03-11", kcal: 0, proteinG: 120 }] }))).toMatchObject({ reached: true });
    expect(measureGoal(goal, facts({ rings: null }))).toMatchObject({ target: null, needs: "plan" });
  });

  it("weight reads setup's choice and target, and judges only what it can", () => {
    const goal = { kind: "weight" as const, period: null, target: null, exerciseId: null };
    const lose = (weightKg: number | null) => measureGoal(goal, facts({ weightKg }));
    expect(lose(70)).toMatchObject({ unit: "kg", direction: "at_most", target: 65, current: 70, reached: false, window: null });
    // The weight has met the target: the plan asks for a new one, and so does the goal.
    expect(lose(65)).toMatchObject({ target: null, reached: null, needs: "target_weight" });
    expect(lose(null)).toMatchObject({ current: null, reached: null });

    const gain = (weightKg: number) => measureGoal(goal, facts({ weightKg, targetWeightKg: 75, rules: { ...FREE, weightGoal: "gain" } }));
    expect(gain(70)).toMatchObject({ direction: "at_least", target: 75, reached: false });
    expect(gain(75.5)).toMatchObject({ target: null, reached: null, needs: "target_weight" });

    const steady = measureGoal(goal, facts({ rules: { ...FREE, weightGoal: "maintain" } }));
    expect(steady).toMatchObject({ direction: "steady", target: null, current: 70, reached: null, needs: null });

    expect(measureGoal(goal, facts({ targetWeightKg: null }))).toMatchObject({ target: null, reached: null, needs: "target_weight" });
    expect(measureGoal(goal, facts({ planReady: false }))).toMatchObject({ target: null, reached: null, needs: "plan" });
    expect(measureGoal(goal, facts({ rules: { ...FREE, weightGoal: null } }))).toMatchObject({ target: null, needs: "plan" });
  });
});

describe("what a request may ask for", () => {
  const ok = (v: unknown) => putGoalRequestSchema.safeParse(v).success;
  const PERIODS: GoalPeriod[] = ["day", "week", "month", "year"];

  it.each(KINDS)("%s takes its own periods, target and exercise, and no other", (kind) => {
    const rule = GOAL_KIND_RULES[kind];
    const exerciseId = rule.exercise ? EXERCISE : null;
    for (const period of [null, ...PERIODS]) {
      const fits = period === null ? rule.periods.length === 0 : rule.periods.includes(period);
      const max = goalTargetMax(kind, period);
      const target = max === null ? null : 1;
      expect(ok({ kind, period, target, exerciseId }), `${kind} over ${String(period)}`).toBe(fits);
      if (!fits) continue;
      // The exercise is there exactly when the kind names one.
      expect(ok({ kind, period, target, exerciseId: rule.exercise ? null : EXERCISE })).toBe(false);
      if (max === null) {
        expect(ok({ kind, period, target: 1, exerciseId })).toBe(false);
      } else {
        expect(ok({ kind, period, target: max, exerciseId })).toBe(true);
        expect(ok({ kind, period, target: max + 1, exerciseId })).toBe(false);
        expect(ok({ kind, period, target: null, exerciseId })).toBe(false);
        expect(ok({ kind, period, target: 0, exerciseId })).toBe(false);
        expect(ok({ kind, period, target: 1.5, exerciseId })).toBe(false);
      }
    }
  });

  it("the ceilings are a period's days: seven training days in a week, 31 in a month", () => {
    expect(goalTargetMax("training_days", "week")).toBe(7);
    expect(goalTargetMax("training_days", "month")).toBe(31);
    expect(goalTargetMax("gym_visits", "year")).toBe(366);
    expect(goalTargetMax("calories_burned", "day")).toBe(5000);
    expect(goalTargetMax("active_minutes", "week")).toBe(4200);
  });

  it("refuses a kind the server cannot measure yet, and anything extra", () => {
    for (const kind of ["run_distance", "hold_time", "master_exercise", "mobility_sessions", "measurement"]) {
      expect(ok({ kind, period: "week", target: 1, exerciseId: null }), kind).toBe(false);
    }
    expect(ok({ kind: "streak", period: null, target: 7, exerciseId: null, setBy: "app" })).toBe(false);
    expect(ok({ kind: "streak", period: null, target: 7, exerciseId: null, userId: EXERCISE })).toBe(false);
    expect(ok({ kind: "reps_in_set", period: null, target: 10, exerciseId: "not-an-id" })).toBe(false);
  });

  it("a held goal cannot carry a number in the reply", () => {
    const held = {
      id: EXERCISE,
      kind: "weight",
      period: null,
      exerciseId: null,
      exerciseSlug: null,
      setBy: "user",
      unit: "kg",
      direction: "at_most",
      target: null,
      current: null,
      reached: null,
      held: { code: "no_weight_loss", reasons: ["under_18"] },
      needs: null,
      window: null,
      createdAt: "2026-03-11T00:00:00.000Z",
      updatedAt: "2026-03-11T00:00:00.000Z",
    };
    expect(goalSchema.safeParse(held).success).toBe(true);
    expect(goalSchema.safeParse({ ...held, target: 60 }).success).toBe(false);
    expect(goalSchema.safeParse({ ...held, current: 70 }).success).toBe(false);
  });
});
