// After a workout (spec Part 2 §13.6, job 64a-iii): what the server adds to the phone's own summary of one of the
// person's workouts, and the effort stars given after it. Composed from reads that already exist: the workout set
// by set with its new records (`historyWorkout`, keyed by the person, so somebody else's workout reads as absent),
// XP and the streak through the gamification module, and the meal ideas from the one rule that makes them. The
// phone shows the time, the sets and the stretches from what it holds; the server works out what has value.
import { FOOD_ALLERGY_CAUTION, type AfterRecord, type HistoryWorkout, type WorkoutAfter } from "@app/shared";
import type { Sql } from "postgres";
import { getMe as getGamificationMe, isContinuationDay, safeTimeZone } from "../gamification/service.js";
import { XP_REWARDS, xpEarnedForWorkout } from "../gamification/xp.js";
import { getAfterWorkoutIdeas } from "../nutrition/service.js";
import { getUserSyncContext } from "../users/service.js";
import { hasEarlierWorkoutOnDay } from "../workouts/repo.js";
import type { RedisLike } from "../../redis.js";
import { historyWorkout } from "./history.js";
import { ownWorkout } from "./historyRepo.js";
import { estimatedOneRepMaxGrams } from "./records.js";
import { setEffort } from "./repo.js";

export interface SummaryDeps {
  sql: Sql;
  redis: RedisLike;
}

/** What each new record was, from the set that made it (or, for most lifted, every set in reps of its exercise). */
export function recordValues(w: Pick<HistoryWorkout, "sets" | "newRecords">): AfterRecord[] {
  const out: AfterRecord[] = [];
  for (const r of w.newRecords) {
    const named = w.sets.find((s) => s.exercise === r.exercise);
    const exerciseName = named?.exerciseName ?? null;
    if (r.kind === "most_lifted") {
      const grams = w.sets
        .filter((s) => s.exercise === r.exercise && s.measuredIn === "reps")
        .reduce((sum, s) => sum + s.done * (s.weightGrams ?? 0), 0);
      out.push({ ...r, exerciseName, value: grams });
      continue;
    }
    const set = w.sets.find((s) => s.position === r.position);
    if (set === undefined) continue;
    const value =
      r.kind === "heaviest" ? set.weightGrams
      : r.kind === "best_estimated_1rm" ? estimatedOneRepMaxGrams(set.weightGrams, set.done)
      : set.done;
    if (value === null) continue;
    out.push({ ...r, exerciseName, value });
  }
  return out;
}

/** The summary of the person's own workout; null for one that is not theirs or does not exist. */
export async function workoutSummary(deps: SummaryDeps, userId: string, workoutId: string): Promise<WorkoutAfter | null> {
  const [row, w] = await Promise.all([ownWorkout(deps.sql, userId, workoutId), historyWorkout(deps, userId, workoutId)]);
  if (row === null || w === null) return null;
  const ctx = await getUserSyncContext(deps.sql, userId);
  const tz = safeTimeZone(ctx.timezone);
  const [me, isContinuation, hasEarlierToday, food] = await Promise.all([
    getGamificationMe({ sql: deps.sql }, userId, ctx.timezone),
    isContinuationDay({ sql: deps.sql }, userId, ctx.timezone, row.started_at),
    hasEarlierWorkoutOnDay(deps.sql, userId, row.id, row.started_at, tz),
    // The meal ideas follow the person's diet as it is now, as the old summary's do.
    getAfterWorkoutIdeas({ sql: deps.sql }, userId, { id: row.id, startedAt: row.started_at, kcalBurned: row.kcal_point }),
  ]);
  // One streak bonus a day, to the day's first workout, as the XP total counts it.
  const forWorkout = xpEarnedForWorkout({ avgFormScore: row.avg_form_score, isStreakContinuation: false });
  const forStreak = isContinuation && !hasEarlierToday ? XP_REWARDS.streak_day : 0;
  return {
    workoutId: row.id,
    kcalPoint: row.kcal_point,
    weightKg: ctx.weightKg !== null && ctx.weightKg > 0 ? ctx.weightKg : null,
    effort: row.effort,
    xp: { earned: forWorkout + forStreak, forWorkout, forStreak, view: me.xp },
    streak: me.streak.current,
    records: recordValues(w),
    food: {
      ideas: food.ideas.map(({ when, idea }) => ({ when, idea })),
      caution: FOOD_ALLERGY_CAUTION,
      labelCaution: food.labelCaution,
    },
  };
}

/** The effort stars of the person's own workout; false where it is not theirs. */
export async function giveEffort(deps: Pick<SummaryDeps, "sql">, userId: string, workoutId: string, effort: number): Promise<boolean> {
  return setEffort(deps.sql, userId, workoutId, effort);
}
