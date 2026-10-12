// A goal measured against what the server keeps. PURE: the day, the person's rules and
// the day totals come in, the numbers go out. The service reads; this file decides.
import {
  GOAL_KIND_RULES,
  type Goal,
  type GoalHeld,
  type GoalKind,
  type GoalPeriod,
  type NoDeficitReason,
  type WeightGoal,
} from "@app/shared";

export interface DayWindow {
  start: string;
  end: string;
}

const utcDay = (day: string): Date => new Date(`${day}T00:00:00Z`);
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

/** The days a period covers around `today` ('YYYY-MM-DD', the person's own day): the
 *  calendar day, the week from Monday to Sunday, the calendar month, the calendar year. */
export function goalWindow(period: GoalPeriod, today: string): DayWindow {
  const d = utcDay(today);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  switch (period) {
    case "day":
      return { start: today, end: today };
    case "week": {
      const sinceMonday = (d.getUTCDay() + 6) % 7;
      const start = new Date(Date.UTC(year, month, d.getUTCDate() - sinceMonday));
      const end = new Date(Date.UTC(year, month, d.getUTCDate() - sinceMonday + 6));
      return { start: dayOf(start), end: dayOf(end) };
    }
    case "month":
      return { start: dayOf(new Date(Date.UTC(year, month, 1))), end: dayOf(new Date(Date.UTC(year, month + 1, 0))) };
    case "year":
      return { start: dayOf(new Date(Date.UTC(year, 0, 1))), end: dayOf(new Date(Date.UTC(year, 11, 31))) };
  }
}

/** What the person's own answers say today. Read on every request, because they change
 *  under a stored goal: a birthday passes, the health question is answered again. */
export interface GoalRules {
  safeMode: boolean;
  weightGoal: WeightGoal | null;
  /** Why this person's plan may hold no calorie cut; empty when a cut is allowed. */
  noCutReasons: readonly NoDeficitReason[];
}

/** THE health rule on goals (RULINGS 2026-09-07), run when a goal is added and on every
 *  read. Safe mode holds the goals that ask for more effort (energy and strength), and
 *  consistency and food goals go on. Nobody under 18, with a yes on the health question
 *  or in Safe mode is given a weight to lose. */
export function goalHeld(kind: GoalKind, rules: GoalRules): GoalHeld | null {
  const family = GOAL_KIND_RULES[kind].family;
  if (rules.safeMode && (family === "energy" || family === "strength")) return { code: "safe_mode" };
  if (kind === "weight" && rules.weightGoal === "lose" && rules.noCutReasons.length > 0) {
    return { code: "no_weight_loss", reasons: [...rules.noCutReasons] };
  }
  return null;
}

export interface WorkoutDay {
  day: string;
  kcal: number;
  ms: number;
}

export interface MealDay {
  day: string;
  kcal: number;
  proteinG: number;
}

export interface GoalFacts {
  /** 'YYYY-MM-DD' in the person's own time zone. */
  today: string;
  rules: GoalRules;
  workoutDays: readonly WorkoutDay[];
  mealDays: readonly MealDay[];
  visitDays: readonly string[];
  /** The most reps in one set, by exercise id. */
  bestReps: ReadonlyMap<string, number>;
  streak: number;
  weightKg: number | null;
  targetWeightKg: number | null;
  /** The lowest healthy weight, where the plan says the target is under it; else null. */
  healthyFloorKg: number | null;
  /** Setup's answers are complete enough for a plan. */
  planReady: boolean;
  /** The rings' own numbers, or null while the plan cannot give them. */
  rings: { kcal: number; proteinG: number } | null;
}

export interface StoredGoal {
  kind: GoalKind;
  period: GoalPeriod | null;
  target: number | null;
  exerciseId: string | null;
}

export type MeasuredGoal = Pick<Goal, "unit" | "direction" | "target" | "current" | "reached" | "held" | "needs" | "window">;

const within = (day: string, w: DayWindow): boolean => day >= w.start && day <= w.end;

/** The weight a "lose" goal runs to: the person's target, or the lowest healthy weight
 *  where the target is under it, as the plan does. Null: nothing to lose. */
function loseTargetKg(facts: GoalFacts): number | null {
  const floor = facts.healthyFloorKg;
  if (facts.targetWeightKg === null || floor === null || facts.targetWeightKg >= floor) return facts.targetWeightKg;
  return facts.weightKg !== null && facts.weightKg <= floor ? null : floor;
}

/** The target is on the wrong side of the weight for the choice, or the weight has met
 *  it: the plan and the rings then ask for a new target, and so does every goal. */
function needsNewTargetWeight(facts: GoalFacts): boolean {
  const aim = facts.rules.weightGoal;
  if (aim === null || aim === "maintain") return false;
  const target = aim === "lose" ? loseTargetKg(facts) : facts.targetWeightKg;
  if (target === null) return true;
  if (facts.weightKg === null) return false;
  return aim === "lose" ? target >= facts.weightKg : target <= facts.weightKg;
}

export function measureGoal(goal: StoredGoal, facts: GoalFacts): MeasuredGoal {
  const unit = GOAL_KIND_RULES[goal.kind].unit;
  const window = goal.period === null ? null : goalWindow(goal.period, facts.today);
  const held = goalHeld(goal.kind, facts.rules);
  if (held !== null) {
    const direction = goal.kind === "weight" ? "at_most" : "at_least";
    return { unit, direction, target: null, current: null, reached: null, held, needs: null, window };
  }
  const base = { unit, held: null, needs: null, window } as const;
  const atLeast = (current: number, target: number | null): MeasuredGoal => ({
    ...base,
    direction: "at_least",
    target,
    current,
    reached: target === null ? null : current >= target,
  });
  // Why the rings have no number: setup is unfinished, or it is finished and the target weight is stale.
  const ringsNeed = facts.planReady && needsNewTargetWeight(facts) ? "target_weight" : "plan";
  const inWindow = <T extends { day: string }>(days: readonly T[]): T[] =>
    window === null ? [] : days.filter((d) => within(d.day, window));

  switch (goal.kind) {
    case "training_days":
      return atLeast(inWindow(facts.workoutDays).length, goal.target);
    case "gym_visits":
      return atLeast(window === null ? 0 : facts.visitDays.filter((d) => within(d, window)).length, goal.target);
    case "food_logged_days":
      return atLeast(inWindow(facts.mealDays).length, goal.target);
    case "calories_burned":
      return atLeast(inWindow(facts.workoutDays).reduce((sum, d) => sum + d.kcal, 0), goal.target);
    case "active_minutes":
      return atLeast(Math.floor(inWindow(facts.workoutDays).reduce((sum, d) => sum + d.ms, 0) / 60000), goal.target);
    case "streak":
      return atLeast(facts.streak, goal.target);
    case "reps_in_set":
      return atLeast(goal.exerciseId === null ? 0 : (facts.bestReps.get(goal.exerciseId) ?? 0), goal.target);
    case "protein": {
      if (facts.rings === null) return { ...base, direction: "at_least", target: null, current: null, reached: null, needs: ringsNeed };
      return atLeast(Math.round(inWindow(facts.mealDays).reduce((sum, d) => sum + d.proteinG, 0)), facts.rings.proteinG);
    }
    case "calories_within": {
      if (facts.rings === null) return { ...base, direction: "at_most", target: null, current: null, reached: null, needs: ringsNeed };
      const logged = inWindow(facts.mealDays);
      const current = logged.reduce((sum, d) => sum + d.kcal, 0);
      // A day with nothing logged is not a day kept within calories.
      return { ...base, direction: "at_most", target: facts.rings.kcal, current, reached: logged.length > 0 && current <= facts.rings.kcal };
    }
    case "weight": {
      const current = facts.weightKg;
      const aim = facts.rules.weightGoal;
      if (!facts.planReady || aim === null) return { ...base, direction: "steady", target: null, current, reached: null, needs: "plan" };
      if (aim === "maintain") return { ...base, direction: "steady", target: null, current, reached: null };
      const direction = aim === "lose" ? "at_most" : "at_least";
      const target = aim === "lose" ? loseTargetKg(facts) : facts.targetWeightKg;
      if (target === null || needsNewTargetWeight(facts)) {
        return { ...base, direction, target: null, current, reached: null, needs: "target_weight" };
      }
      // Past this line the weight has not met the target, or is not known.
      return { ...base, direction, target, current, reached: current === null ? null : false };
    }
  }
}

/** The days these goals count between them, or null when none has a period. */
export function windowSpan(goals: readonly StoredGoal[], today: string): DayWindow | null {
  const windows = goals.flatMap((g) => (g.period === null ? [] : [goalWindow(g.period, today)]));
  const first = windows[0];
  if (first === undefined) return null;
  return windows.reduce<DayWindow>(
    (span, w) => ({ start: w.start < span.start ? w.start : span.start, end: w.end > span.end ? w.end : span.end }),
    first,
  );
}
