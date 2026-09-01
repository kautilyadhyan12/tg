// P2.3 — gamification service (v1 §6.1; Part 7 §3). Called by the workouts
// module at sync (service interface, R7.1) and by its own /me route. All
// mutations are retry-safe: streak transitions are day-idempotent and awards
// upsert (R3.5).
import type { Sql } from "postgres";
import * as repo from "./repo.js";
import { badgeXpForCodes, earnedCodes } from "./badges.js";
import {
  computeTotalXp,
  countStreakContinuationDays,
  isStreakContinuationDay,
  xpProgress,
} from "./xp.js";
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
    // `getStreakDays`, NOT `getActivityDays` — Kd ruled gym attendance keeps a
    // streak alive (:27900 §3). `recomputeXp` below deliberately still reads the
    // workouts-only list; a reviewer should mutate one into the other and watch
    // an XP test go red.
    const days = await repo.getStreakDays(tx, userId, tz);
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
  await recomputeXp(deps, userId, tz); // AFTER awards — badge XP is part of the total
  return state;
}

/** Recompute lifetime XP from committed history and upsert it (idempotent,
 *  retry-safe — never an $inc; see xp.ts). Runs AFTER awardAchievements
 *  because badge XP is part of the total. An advisory lock (lockXpForUser)
 *  serializes concurrent syncs for the user — INCLUDING the first sync, when no
 *  user_xp row exists yet (T3 F1: a SELECT … FOR UPDATE would lock nothing there
 *  and let two first-syncs lose an update). Since the total is a pure function
 *  of committed rows, serialized recompute is exactly correct. */
async function recomputeXp(deps: GamificationDeps, userId: string, tz: string): Promise<number> {
  // NOT exported (T3 F5): both callers are in this file, and an external caller
  // could not know the ordering rule that XP must be recomputed AFTER awards.
  // safeTimeZone is re-applied here rather than trusted from the caller —
  // getActivityDays' contract requires a validated zone, and the guard is
  // idempotent, so being self-contained costs nothing.
  const zone = safeTimeZone(tz);
  return await deps.sql.begin(async (tx) => {
    await repo.lockXpForUser(tx, userId); // serialize concurrent recompute (T3 F1)
    const counts = await repo.getXpAccrualCounts(tx, userId);
    const days = await repo.getActivityDays(tx, userId, zone);
    const earned = await repo.listEarned(tx, userId);
    const total = computeTotalXp({
      workoutCount: counts.workoutCount,
      perfectFormWorkouts: counts.perfectFormWorkouts,
      excellentFormWorkouts: counts.excellentFormWorkouts,
      streakContinuationDays: countStreakContinuationDays(days),
      badgeXp: badgeXpForCodes(earned.map((e) => e.code)),
    });
    await repo.upsertXp(tx, userId, total);
    return total;
  });
}

/** P2.6a meal hook: meal stats now come from meal_logs (origin is a real
 * column, never JSONB-filtered). Awards are idempotent upserts. */
export async function onMealLogged(
  deps: GamificationDeps,
  userId: string,
  timezone: string | null,
): Promise<void> {
  const tz = safeTimeZone(timezone);
  const stats = await repo.getStats(deps.sql, userId, tz);
  const streak = await reconciledStreak(deps, userId, timezone);
  const codes = earnedCodes({ ...stats, current_streak: streak.current });
  await repo.awardAchievements(deps.sql, userId, codes);
  // A meal can earn a badge (first_meal, macro_master, photo_meal), whose tier
  // XP is part of the total — recompute so XP stays consistent with awards.
  await recomputeXp(deps, userId, tz);
}

/** GOING TO THE GYM KEEPS A STREAK ALIVE — Kd, 2026-09-01 (:27900 §3), at the
 *  attendance card's plan gate, overruling the recommendation to defer it.
 *
 *  **A SERVICE INTERFACE, CALLED BY THE ORGS MODULE (R7.1)** — the same seam
 *  `workouts` and `nutrition` already use. Nothing outside this module reaches
 *  into gamification's repo or its streak internals.
 *
 *  **IT REPLAYS THE STREAK AND AWARDS BADGES, AND IT PAYS NO PER-DAY XP.** The
 *  replay reads `getStreakDays` (workouts ∪ attendance); `recomputeXp` below
 *  reads `getActivityDays` (workouts alone), so an attendance-only day extends a
 *  streak and adds no continuation XP. **The XP that CAN move here is a badge's
 *  own tier XP** — `streak_3/7/30/100` are reachable by attendance now, which is
 *  the ruling and not a leak (Kd answered "streaks and badges", and a badge's XP
 *  is part of the badge). `recomputeXp` runs AFTER the awards for the reason
 *  every other hook in this file runs it there: badge XP is part of the total.
 *
 *  **THE CALLER ONLY CALLS THIS FOR A NEW ROW.** A repeated tap in the same slot
 *  is idempotent at the database and changes no day, so re-running this would be
 *  work with no possible effect — and `recomputeXp` takes an advisory lock per
 *  user, which a member hammering a button should not be able to queue behind.
 *
 *  **A FAILURE HERE MUST NOT LOSE THE ATTENDANCE**, which is why the orgs
 *  service calls it after its own transaction has committed and swallows the
 *  error the way `nutrition` does: the row is the record, and a streak is
 *  recomputed from committed history on the next read anyway. */
export async function onAttendanceMarked(
  deps: GamificationDeps,
  userId: string,
  timezone: string | null,
): Promise<void> {
  const tz = safeTimeZone(timezone);
  const state = await deps.sql.begin(async (tx) => {
    const stored = await repo.getStreakForUpdate(tx, userId);
    const days = await repo.getStreakDays(tx, userId, tz);
    const replayed = replayActivityDays(days);
    const after: StreakState = {
      ...replayed,
      // §3.3: longest is displayed for ever and is never shrunk by a replay over
      // a history that may have been pruned (retention sweeps, DPDP).
      longest: Math.max(replayed.longest, stored.longest),
    };
    await repo.upsertStreak(tx, userId, after);
    return after;
  });
  const stats = await repo.getStats(deps.sql, userId, tz);
  const codes = earnedCodes({ ...stats, current_streak: state.current });
  await repo.awardAchievements(deps.sql, userId, codes);
  await recomputeXp(deps, userId, tz); // AFTER awards — badge XP is part of the total
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

/** Did the workout that happened at `when` land on the day after another
 *  activity day? Part of this module's service interface (R7.1) — the workouts
 *  module needs it for the post-workout summary's XP figure and must not reach
 *  into gamification's repo or its streak internals to get it.
 *
 *  The day is bucketed in the USER'S timezone, like every other day boundary in
 *  this system (Part 7 §3.1; playbook trap #8). Wrapped in `begin` because
 *  `getActivityDays` takes a transaction handle; the read needs no isolation of
 *  its own, so this is a type obligation rather than a correctness one. */
export async function isContinuationDay(
  deps: GamificationDeps,
  userId: string,
  timezone: string | null,
  when: Date,
): Promise<boolean> {
  const tz = safeTimeZone(timezone);
  const days = await deps.sql.begin(async (tx) => repo.getActivityDays(tx, userId, tz));
  return isStreakContinuationDay(days, dayInTz(when, tz));
}

export async function getMe(
  deps: GamificationDeps,
  userId: string,
  timezone: string | null,
): Promise<GamificationMe> {
  const streak = await reconciledStreak(deps, userId, timezone);
  const earned = await repo.listEarned(deps.sql, userId);
  // XP is a plain read: it is recomputed + stored at every workout sync / meal
  // log, so the stored value is already current here (no write-on-read).
  const p = xpProgress(await repo.getXp(deps.sql, userId));
  return {
    streak: {
      current: streak.current,
      longest: streak.longest,
      lastActivityDate: streak.lastActivityDate,
      freezesAvailable: streak.freezesAvailable,
    },
    xp: {
      total: p.xp,
      level: p.level,
      xpInLevel: p.xpInLevel,
      xpForNext: p.xpForNext,
      progressPct: p.progressPct,
      nextLevelAt: p.nextLevelAt,
    },
    achievements: earned.map((e) => ({ code: e.code, earnedAt: e.earnedAt.toISOString() })),
  };
}
