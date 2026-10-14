// P2.3 — gamification service (v1 §6.1; Part 7 §3). Called by the workouts
// module at sync (service interface, R7.1) and by its own /me route. All
// mutations are retry-safe: streak transitions are day-idempotent and awards
// upsert (R3.5).
import type { Sql, TransactionSql } from "postgres";
import * as repo from "./repo.js";
import { badgeXpForCodes, earnedCodes } from "./badges.js";
import {
  computeTotalXp,
  countStreakContinuationDays,
  isStreakContinuationDay,
  xpProgress,
} from "./xp.js";
import { dayInTz, reconcile, replayActivityDays, safeTimeZone, type StreakState } from "./streak.js";
import { weeklyChallengeCodeSchema, type GamificationMe, type WeeklyChallengeCode, type WeeklyChallenges } from "@app/shared";
import { getPlanHealth, getUserFitnessLevel, getUserSyncContext } from "../users/service.js";
import {
  NO_FACTS,
  challengeXp,
  codesToHold,
  measureChallenge,
  pausedBySafeMode,
  pickChallenges,
  weekOf,
  type WeekFacts,
} from "./challenges.js";

// Part of this module's service interface (R7.1) — other modules import the
// tz helper from here, never from the internal streak.ts (T3 P2.3 nit).
export { dayInTz, safeTimeZone } from "./streak.js";

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
async function recomputeXp(deps: GamificationDeps, userId: string, tz: string, now: Date = new Date()): Promise<number> {
  // NOT exported (T3 F5): every caller is in this file, and an external caller
  // could not know the ordering rule that XP must be recomputed AFTER awards.
  // safeTimeZone is re-applied here rather than trusted from the caller —
  // getActivityDays' contract requires a validated zone, and the guard is
  // idempotent, so being self-contained costs nothing.
  const zone = safeTimeZone(tz);
  // Safe mode on now pauses this week's challenges not yet done, for the rest of the week (35b).
  const safeMode = (await getPlanHealth(deps.sql, userId))?.safeMode === true;
  const thisWeek = weekOf(dayInTz(now, zone)).weekStart;
  return await deps.sql.begin(async (tx) => {
    await repo.lockXpForUser(tx, userId); // serialize concurrent recompute (T3 F1)
    if (safeMode) await holdThisWeek(tx, userId, thisWeek);
    const counts = await repo.getXpAccrualCounts(tx, userId);
    const days = await repo.getActivityDays(tx, userId, zone);
    const earned = await repo.listEarned(tx, userId);
    const total =
      computeTotalXp({
        workoutCount: counts.workoutCount,
        perfectFormWorkouts: counts.perfectFormWorkouts,
        excellentFormWorkouts: counts.excellentFormWorkouts,
        streakContinuationDays: countStreakContinuationDays(days),
        badgeXp: badgeXpForCodes(earned.map((e) => e.code)),
      }) + (await weeklyChallengeXp(tx, userId));
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

/** The week's codes as kept, minus any the app no longer has. */
const codesOf = (stored: readonly string[]): WeeklyChallengeCode[] =>
  stored.flatMap((c) => {
    const parsed = weeklyChallengeCodeSchema.safeParse(c);
    return parsed.success ? [parsed.data] : [];
  });

/** Safe mode is on: this week's challenges not yet done are paused for the rest of the
 *  week, and one already done keeps its XP (35b). Inside recomputeXp's lock. */
async function holdThisWeek(tx: TransactionSql, userId: string, weekStart: string): Promise<void> {
  const week = await repo.getWeekPicks(tx, userId, weekStart);
  if (week === null) return;
  const [facts] = await repo.weekFacts(tx, userId, safeTimeZone(week.timeZone), [weekStart]);
  const held = codesToHold(codesOf(week.codes), codesOf(week.heldCodes), facts ?? NO_FACTS);
  if (held.length !== week.heldCodes.length) await repo.setHeldCodes(tx, userId, weekStart, held);
}

/** XP from every week's done challenges (ROADMAP 35b), worked out again from the person's
 *  own workouts and meals, so a workout sent twice never pays twice. Each week is read in
 *  the zone it was picked in. Inside recomputeXp's lock. */
async function weeklyChallengeXp(tx: TransactionSql, userId: string): Promise<number> {
  const weeks = await repo.listWeekPicks(tx, userId);
  const facts = new Map<string, WeekFacts>();
  for (const zone of new Set(weeks.map((w) => w.timeZone))) {
    const inZone = weeks.filter((w) => w.timeZone === zone).map((w) => w.weekStart);
    for (const f of await repo.weekFacts(tx, userId, safeTimeZone(zone), inZone)) facts.set(f.weekStart, f);
  }
  return challengeXp(
    weeks.map((w) => ({ weekStart: w.weekStart, codes: codesOf(w.codes), heldCodes: codesOf(w.heldCodes) })),
    facts,
  );
}

/** The health answer was saved (ROADMAP 35b): if Safe mode is on now, this week's
 *  challenges but the gentle two are paused, and the XP is worked out again so a paused
 *  one pays nothing. */
export async function onHealthAnswered(deps: GamificationDeps, userId: string): Promise<void> {
  const ctx = await getUserSyncContext(deps.sql, userId);
  await recomputeXp(deps, userId, safeTimeZone(ctx.timezone));
}

const CAMERA_LOOKBACK_MS = 28 * 86_400_000;

/** This week's challenges (ROADMAP 35b): picked on the first read of the week and kept
 *  until Sunday, then measured from the person's own workouts and meals. */
export async function getWeeklyChallenges(
  deps: GamificationDeps,
  userId: string,
  now: Date = new Date(),
): Promise<WeeklyChallenges> {
  const ctx = await getUserSyncContext(deps.sql, userId);
  const tz = safeTimeZone(ctx.timezone);
  const { weekStart, weekEnd } = weekOf(dayInTz(now, tz));
  const safeMode = (await getPlanHealth(deps.sql, userId))?.safeMode === true;
  const pick = async (): Promise<WeeklyChallengeCode[]> =>
    pickChallenges({
      userId,
      weekStart,
      fitnessLevel: await getUserFitnessLevel(deps.sql, userId),
      safeMode,
      weightKnown: ctx.weightKg !== null,
      usedCamera: await repo.usedCameraBetween(deps.sql, userId, new Date(now.getTime() - CAMERA_LOOKBACK_MS), now),
    });

  const kept = await repo.getWeekPicks(deps.sql, userId, weekStart);
  // A week already part done pays at once, not at the next workout; and Safe mode pauses
  // this week's other challenges before any of them is shown or paid.
  let changed = false;
  if (kept === null) {
    changed = await repo.insertWeekPicks(deps.sql, userId, weekStart, tz, await pick());
  } else if (codesOf(kept.codes).length === 0) {
    // Every challenge kept for the week is one the app no longer has.
    await repo.replaceWeekPicks(deps.sql, userId, weekStart, kept.codes, tz, await pick());
    changed = true;
  } else if (safeMode) {
    const [before] = await repo.weekFacts(deps.sql, userId, safeTimeZone(kept.timeZone), [weekStart]);
    const held = codesOf(kept.heldCodes);
    changed = codesToHold(codesOf(kept.codes), held, before ?? NO_FACTS).length !== held.length;
  }
  if (changed) await recomputeXp(deps, userId, tz, now);
  const week = await repo.getWeekPicks(deps.sql, userId, weekStart);
  if (week === null) throw new Error("the week's challenges were not kept");

  const [facts] = await repo.weekFacts(deps.sql, userId, safeTimeZone(week.timeZone), [weekStart]);
  const held = codesOf(week.heldCodes);
  const challenges = codesOf(week.codes).map((code) => {
    const done = measureChallenge(code, facts ?? NO_FACTS, false).done;
    return measureChallenge(code, facts ?? NO_FACTS, held.includes(code) || (safeMode && pausedBySafeMode(code) && !done));
  });
  return {
    weekStart,
    weekEnd,
    challenges,
    xpThisWeek: challenges.reduce((sum, c) => sum + (c.done && c.held === null ? c.xp : 0), 0),
  };
}
