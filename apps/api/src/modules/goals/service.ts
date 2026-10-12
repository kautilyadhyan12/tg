// A person's goals: kept, changed, removed, and measured on every read from what the
// server already holds. The health rules are read here each time and never stored.
import type { Sql } from "postgres";
import {
  MAX_GOALS,
  goalKindSchema,
  goalPeriodSchema,
  goalsResponseSchema,
  type Goal,
  type GoalHeld,
  type GoalKind,
  type GoalsResponse,
  type NoDeficitReason,
  type PutGoalRequest,
} from "@app/shared";
import { dayInTz, reconciledStreak, safeTimeZone } from "../gamification/service.js";
import { targetsForPlan } from "../nutrition/service.js";
import { getUserPlanAndCutRules, getUserSyncContext } from "../users/service.js";
import { goalHeld, measureGoal, windowSpan, type GoalFacts, type GoalRules, type StoredGoal } from "./measure.js";
import * as repo from "./repo.js";
import { starterGoals } from "./starter.js";

export interface GoalsDeps {
  sql: Sql;
  now?: () => Date;
}

/** Typed failure for the central error mapper; the message is safe to show. */
export class GoalsError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "GoalsError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

type PlanRead = Awaited<ReturnType<typeof getUserPlanAndCutRules>>;

/** The person's rules from their own answers. A yes on the health question holds a
 *  weight to lose even while the age is unanswered, when the plan's own list is empty. */
function rulesOf(read: PlanRead): GoalRules {
  const health = read.answers.health;
  const fromHealth: NoDeficitReason[] = [
    ...(health?.hasCondition === true ? (["health_answer"] as const) : []),
    ...(health?.safeMode === true ? (["safe_mode"] as const) : []),
  ];
  return {
    safeMode: health?.safeMode === true,
    weightGoal: read.answers.goal ?? null,
    noCutReasons: read.noCutReasons.length > 0 ? read.noCutReasons : fromHealth,
  };
}

const WORKOUT_KINDS: readonly GoalKind[] = ["training_days", "calories_burned", "active_minutes"];
const MEAL_KINDS: readonly GoalKind[] = ["calories_within", "protein", "food_logged_days"];

const storedOf = (row: repo.GoalRow): StoredGoal => ({
  kind: goalKindSchema.parse(row.kind),
  period: goalPeriodSchema.nullable().parse(row.period),
  target: row.target,
  exerciseId: row.exerciseId,
});

async function measured(deps: GoalsDeps, userId: string, rows: readonly repo.GoalRow[]): Promise<Goal[]> {
  const { sql } = deps;
  const stored = rows.map(storedOf);
  const of = (kinds: readonly GoalKind[]) => stored.filter((g) => kinds.includes(g.kind));
  const has = (kind: GoalKind) => stored.some((g) => g.kind === kind);

  const ctx = await getUserSyncContext(sql, userId);
  const timeZone = safeTimeZone(ctx.timezone);
  const today = dayInTz((deps.now ?? (() => new Date()))(), timeZone);
  const read = await getUserPlanAndCutRules(sql, userId, null);

  const workoutSpan = windowSpan(of(WORKOUT_KINDS), today);
  const mealSpan = windowSpan(of(MEAL_KINDS), today);
  const visitSpan = windowSpan(of(["gym_visits"]), today);
  const exerciseIds = [...new Set(stored.flatMap((g) => (g.kind === "reps_in_set" && g.exerciseId !== null ? [g.exerciseId] : [])))];

  const [workoutDays, mealDays, visitDays, bestReps, streak, rings] = await Promise.all([
    workoutSpan === null ? [] : repo.workoutDays(sql, userId, timeZone, workoutSpan.start, workoutSpan.end),
    mealSpan === null ? [] : repo.mealDays(sql, userId, timeZone, mealSpan.start, mealSpan.end),
    visitSpan === null ? [] : repo.visitDays(sql, userId, visitSpan.start, visitSpan.end),
    exerciseIds.length === 0 ? new Map<string, number>() : repo.bestReps(sql, userId, exerciseIds),
    has("streak") ? reconciledStreak({ sql }, userId, ctx.timezone).then((s) => s.current) : 0,
    // The rings' own answer, so a calories goal can never show a second daily number.
    has("calories_within") || has("protein") ? targetsForPlan({ sql }, userId, read).then((t) => t.targets) : null,
  ]);

  const facts: GoalFacts = {
    today,
    rules: rulesOf(read),
    workoutDays,
    mealDays,
    visitDays,
    bestReps,
    streak,
    weightKg: read.answers.weightKg ?? null,
    targetWeightKg: read.answers.targetWeightKg ?? null,
    healthyFloorKg: read.plan.plan?.flags.flatMap((f) => (f.code === "target_below_healthy_weight" ? [f.floorKg] : []))[0] ?? null,
    planReady: read.plan.plan !== null,
    rings: rings === null ? null : { kcal: rings.kcal, proteinG: rings.proteinG },
  };

  return rows.map((row, i) => {
    const goal = stored[i];
    if (goal === undefined) throw new Error("a goal row lost its parsed half");
    return {
      id: row.id,
      kind: goal.kind,
      period: goal.period,
      exerciseId: row.exerciseId,
      exerciseSlug: row.exerciseSlug,
      setBy: row.setBy === "app" ? "app" : "user",
      ...measureGoal(goal, facts),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

/** The app's own goals, given once, on the first read after setup is finished. One the
 *  person removes stays removed: the mark is on the account and outlives a setup reset. */
async function giveStarterGoals(deps: GoalsDeps, userId: string): Promise<void> {
  const { sql } = deps;
  if (!(await repo.starterDue(sql, userId))) return;
  const read = await getUserPlanAndCutRules(sql, userId, null);
  const goals = starterGoals(
    { trainingDays: read.answers.trainingDays ?? null, sessionMinutes: read.answers.sessionMinutes ?? null },
    rulesOf(read),
  );
  await sql.begin(async (tx) => {
    await repo.lockGoalsOf(tx, userId);
    if (!(await repo.claimStarter(tx, userId))) return;
    let room = MAX_GOALS - (await repo.countGoals(tx, userId));
    for (const goal of goals) {
      if (room <= 0) break;
      if (await repo.insertStarterGoal(tx, userId, goal)) room -= 1;
    }
  });
}

export async function listGoals(deps: GoalsDeps, userId: string): Promise<GoalsResponse> {
  await giveStarterGoals(deps, userId);
  const rows = await repo.listGoals(deps.sql, userId);
  const goals = rows.length === 0 ? [] : await measured(deps, userId, rows);
  return goalsResponseSchema.parse({ goals, max: MAX_GOALS });
}

const HELD_MESSAGE: Readonly<Record<GoalHeld["code"], string>> = {
  safe_mode: "This goal waits until a professional has cleared you to train.",
  no_weight_loss: "Your plan holds your weight steady, so it sets no weight to lose.",
};

/** Add a goal, or change the one with this id. The same request twice leaves one goal. */
export async function putGoal(
  deps: GoalsDeps,
  userId: string,
  id: string,
  body: PutGoalRequest,
): Promise<{ created: boolean; goal: Goal }> {
  const { sql } = deps;
  // The same rule the read runs: a goal that would be held today is not taken.
  const held = goalHeld(body.kind, rulesOf(await getUserPlanAndCutRules(sql, userId, null)));
  if (held !== null) throw new GoalsError(409, "goal_held", HELD_MESSAGE[held.code]);

  let created: boolean;
  try {
    created = await sql.begin(async (tx) => {
      await repo.lockGoalsOf(tx, userId);
      const holder = await repo.ownGoal(tx, userId, id);
      if (holder !== null) {
        if (holder.kind !== body.kind || holder.exerciseId !== body.exerciseId) {
          throw new GoalsError(409, "goal_kind_fixed", "A goal keeps its kind. Remove it and add the one you want.");
        }
        await repo.updateGoal(tx, userId, id, body);
        return false;
      }
      if ((await repo.countGoals(tx, userId)) >= MAX_GOALS) {
        throw new GoalsError(409, "goal_limit", `You can keep up to ${String(MAX_GOALS)} goals. Remove one to add another.`);
      }
      // Asked only of a new goal: a kept one is still changeable after its exercise leaves the library.
      if (body.exerciseId !== null && !(await repo.liveExerciseExists(tx, body.exerciseId))) {
        throw new GoalsError(400, "unknown_exercise", "That exercise is not in the library.");
      }
      // An id somebody else holds fails on the key, and reads as no goal at all.
      await repo.insertGoal(tx, userId, id, body);
      return true;
    });
  } catch (err) {
    if (repo.isGoalTwice(err)) throw new GoalsError(409, "goal_exists", "You already have this goal. Change that one.");
    if (repo.isGoalIdClash(err)) throw new GoalsError(404, "not_found", "Goal not found.");
    throw err;
  }

  const goal = (await listGoals(deps, userId)).goals.find((g) => g.id === id);
  // Removed by another request between the write and the read.
  if (goal === undefined) throw new GoalsError(404, "not_found", "Goal not found.");
  return { created, goal };
}

export async function deleteGoal(deps: GoalsDeps, userId: string, id: string): Promise<boolean> {
  return await repo.deleteGoal(deps.sql, userId, id);
}
