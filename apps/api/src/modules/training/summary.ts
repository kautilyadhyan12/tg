// After a workout (spec Part 2 §13.6, job 64a-iii): what the server adds to the phone's own summary of one of the
// person's workouts, and the effort stars given after it. Composed from reads that already exist: the workout set
// by set with its new records (`historyWorkout`, keyed by the person, so somebody else's workout reads as absent),
// XP and the streak through the gamification module, and the meal ideas from the one rule that makes them. The
// phone shows the time, the sets and the stretches from what it holds; the server works out what has value.
import { FOOD_ALLERGY_CAUTION, recordValues, type WorkoutAfter } from "@app/shared";
import type { Sql } from "postgres";
import { ACHIEVEMENTS, badgeXpForCodes } from "../gamification/badges.js";
import { listEarned } from "../gamification/repo.js";
import { dayInTz, getMe as getGamificationMe, isContinuationDay, safeTimeZone } from "../gamification/service.js";
import { XP_REWARDS, xpEarnedForWorkout } from "../gamification/xp.js";
import { getAfterWorkoutIdeas } from "../nutrition/service.js";
import { getUserSyncContext } from "../users/service.js";
import { hasEarlierWorkoutOnDay } from "../workouts/repo.js";
import type { RedisLike } from "../../redis.js";
import { historyWorkout } from "./history.js";
import { nextSaveAfter, ownWorkout } from "./historyRepo.js";
import { setEffort } from "./repo.js";

export interface SummaryDeps {
  sql: Sql;
  redis: RedisLike;
  now?: () => Date;
}

/** Badges are awarded just after a save commits (`onWorkoutSynced`, within a second); one awarded within this long of the
 *  workout's own save, before any other workout or run was saved, is this workout's (round one L7). */
export const BADGES_OF_A_SAVE_MS = 10_000;
/** The badges a workout can earn: never a meal's (first meal, protein days, a photo meal), which a meal logged in the
 *  same moment could award. */
const MEAL_STATS = new Set(["total_meals", "protein_target_streak", "photo_meals_logged"]);
const WORKOUT_BADGES = new Set(ACHIEVEMENTS.filter((a) => !MEAL_STATS.has(a.criteria.stat)).map((a) => a.code));

/** The summary of the person's own workout; null for one that is not theirs or does not exist. */
export async function workoutSummary(deps: SummaryDeps, userId: string, workoutId: string): Promise<WorkoutAfter | null> {
  const [row, w] = await Promise.all([ownWorkout(deps.sql, userId, workoutId), historyWorkout(deps, userId, workoutId)]);
  if (row === null || w === null) return null;
  const ctx = await getUserSyncContext(deps.sql, userId);
  const tz = safeTimeZone(ctx.timezone);
  const [me, isContinuation, hasEarlierToday, food, earned] = await Promise.all([
    getGamificationMe({ sql: deps.sql }, userId, ctx.timezone),
    isContinuationDay({ sql: deps.sql }, userId, ctx.timezone, row.started_at),
    hasEarlierWorkoutOnDay(deps.sql, userId, row.id, row.started_at, tz),
    // The meal ideas follow the person's diet as it is now, as the old summary's do.
    getAfterWorkoutIdeas({ sql: deps.sql }, userId, { id: row.id, startedAt: row.started_at, kcalBurned: row.kcal_point }),
    listEarned(deps.sql, userId),
  ]);
  const saved = row.created_at.getTime();
  const next = await nextSaveAfter(deps.sql, userId, row.id, row.created_at);
  const until = Math.min(saved + BADGES_OF_A_SAVE_MS, next?.getTime() ?? Infinity);
  const badges = earned
    .filter((b) => WORKOUT_BADGES.has(b.code) && b.earnedAt.getTime() >= saved && b.earnedAt.getTime() < until)
    .map((b) => b.code);
  const forBadges = badgeXpForCodes(badges);
  const today = dayInTz((deps.now ?? (() => new Date()))(), tz);
  // One streak bonus a day, to the day's first workout, as the XP total counts it.
  const forWorkout = xpEarnedForWorkout({ avgFormScore: row.avg_form_score, isStreakContinuation: false });
  const forStreak = isContinuation && !hasEarlierToday ? XP_REWARDS.streak_day : 0;
  return {
    workoutId: row.id,
    kcalPoint: row.kcal_point,
    // The weight the save worked the calories out at, never today's: a weigh-in since would make the line false.
    weightKg: row.kcal_weight_grams === null ? null : row.kcal_weight_grams / 1000,
    effort: row.effort,
    xp: { earned: forWorkout + forStreak + forBadges, forWorkout, forStreak, forBadges, view: me.xp },
    streak: { days: me.streak.current, today: me.streak.lastActivityDate === today },
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
