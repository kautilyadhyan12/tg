// P2.3 — gamification service (v1 §6.1; Part 7 §3). Called by the workouts
// module at sync (service interface, R7.1) and by its own /me route. All
// mutations are retry-safe: streak transitions are day-idempotent and awards
// upsert (R3.5).
import type { Sql } from "postgres";
import * as repo from "./repo.js";
import { earnedCodes } from "./badges.js";
import { dayInTz, recordActivity, reconcile, safeTimeZone, type StreakState } from "./streak.js";
import type { GamificationMe } from "@app/shared";

export interface GamificationDeps {
  sql: Sql;
}

/** Sync-time hook: register qualifying activity (Part 7 §3.1) for the
 *  workout's OWN start instant (offline syncs credit the day the workout
 *  happened), then award any newly-reachable achievements. */
export async function onWorkoutSynced(
  deps: GamificationDeps,
  userId: string,
  startedAt: Date,
  timezone: string | null,
): Promise<StreakState> {
  const tz = safeTimeZone(timezone);
  const day = dayInTz(startedAt, tz);
  const state = await deps.sql.begin(async (tx) => {
    const before = await repo.getStreakForUpdate(tx, userId);
    const after = recordActivity(before, day);
    await repo.upsertStreak(tx, userId, after);
    return after;
  });
  const stats = await repo.getStats(deps.sql, userId, tz);
  const codes = earnedCodes({ ...stats, current_streak: state.current });
  await repo.awardAchievements(deps.sql, userId, codes);
  return state;
}

/** Read-side lazy reconciliation (DECISIONS GAP-5): freezes owed for missed
 *  days are spent NOW so the user always reads post-sweep truth; persisted
 *  only when something changed. */
export async function reconciledStreak(
  deps: GamificationDeps,
  userId: string,
  timezone: string | null,
): Promise<StreakState> {
  const tz = safeTimeZone(timezone);
  const today = dayInTz(new Date(), tz);
  return await deps.sql.begin(async (tx) => {
    const before = await repo.getStreakForUpdate(tx, userId);
    const after = reconcile(before, today);
    if (
      after.current !== before.current ||
      after.freezesAvailable !== before.freezesAvailable ||
      after.lastActivityDate !== before.lastActivityDate
    ) {
      await repo.upsertStreak(tx, userId, after);
    }
    return after;
  });
}

export async function getMe(
  deps: GamificationDeps,
  userId: string,
  timezone: string | null,
): Promise<GamificationMe> {
  const streak = await reconciledStreak(deps, userId, timezone);
  const earned = await repo.listEarned(deps.sql, userId);
  return {
    streak: {
      current: streak.current,
      longest: streak.longest,
      lastActivityDate: streak.lastActivityDate,
      freezesAvailable: streak.freezesAvailable,
    },
    achievements: earned.map((e) => ({ code: e.code, earnedAt: e.earnedAt.toISOString() })),
  };
}
