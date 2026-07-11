// P2.3 — gamification service (v1 §6.1; Part 7 §3). Called by the workouts
// module at sync (service interface, R7.1) and by its own /me route. All
// mutations are retry-safe: streak transitions are day-idempotent and awards
// upsert (R3.5).
import type { Sql } from "postgres";
import * as repo from "./repo.js";
import { earnedCodes } from "./badges.js";
import { dayInTz, reconcile, replayActivityDays, safeTimeZone, type StreakState } from "./streak.js";
import type { GamificationMe } from "@app/shared";

// Part of this module's service interface (R7.1) — other modules import the
// tz helper from here, never from the internal streak.ts (T3 P2.3 nit).
export { safeTimeZone } from "./streak.js";

export interface GamificationDeps {
  sql: Sql;
}

/** Sync-time hook, run on EVERY sync including retries (T3 P2.3 finding 2:
 *  gating on 'created' lost the streak forever if this threw after the
 *  workout committed — now a retry heals). Part 7 §3.5: streak state is
 *  RECOMPUTED from the full qualifying-day history (replay), so late
 *  offline workouts retroactively restore a lost streak, and the whole
 *  operation is idempotent by construction (R3.5). */
export async function onWorkoutSynced(
  deps: GamificationDeps,
  userId: string,
  timezone: string | null,
): Promise<StreakState> {
  const tz = safeTimeZone(timezone);
  const state = await deps.sql.begin(async (tx) => {
    const stored = await repo.getStreakForUpdate(tx, userId); // serializes concurrent syncs
    const days = await repo.getActivityDays(tx, userId, tz);
    const replayed = replayActivityDays(days);
    const after: StreakState = {
      ...replayed,
      // §3.3: longest is displayed forever — never shrunk by a replay over a
      // history that may have been pruned (retention sweeps, DPDP).
      longest: Math.max(replayed.longest, stored.longest),
    };
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
