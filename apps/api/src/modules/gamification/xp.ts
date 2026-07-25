// XP / level math, ported VERBATIM from badges.py (Kd-authorised XP storage,
// DECISIONS 2026-07-24; the P1.8a constant-preservation discipline). PURE —
// numbers in, numbers out, no I/O and no clock.
//
// The CURVE and the reward CONSTANTS are copied line-for-line (R5.4). The
// ACCRUAL, however, is a RECOMPUTE from full history, NOT the old backend's
// live `$inc` (workouts.py:216-300). This is a deliberate DEVIATION, recorded
// in DECISIONS: the sync hook runs on every retry (DECISIONS 2026-07-11 P2.3
// T3 finding 2), and an `$inc` would double-count XP on a retried sync — the
// exact hazard the streak recompute already exists to avoid. It is idempotent
// by construction. Production starts empty, so there is no legacy `$inc` total
// to reconcile against.
//
// DO NOT re-add the sentence that used to sit here ("recomputing with the same
// constants yields the same total for any real history"). It was FALSE, no test
// carried it, and it was deleted at T3 round 3. The CONSTANTS are verbatim; the
// TOTALS deliberately diverge from the old backend on three axes, all recorded
// in DECISIONS under the D5 addendum:
//   1. DAY BUCKETING — old: `datetime.utcnow().date()` (workouts.py:234);
//      new: the user's own timezone (Part IV #8 forbids day math anywhere else).
//   2. ACTIVITY TIME vs SYNC TIME — the old backend compared the SYNC INSTANT
//      against `lastWorkoutDate`, itself written as `datetime.utcnow()` at
//      :262, so its streak XP tracked WHEN A SYNC ARRIVED. This recompute
//      buckets each workout's own `started_at`. A Monday workout synced on
//      Wednesday therefore scores differently under each.
//   3. RETROACTIVE BACKFILL — a late offline sync that fills a day gap creates
//      +10s the old `$inc` could never award (it only ever compared against the
//      previous sync). That is not a corner case, it is the DESIGNED path: the
//      same retroactive-restore semantics already ruled for streaks
//      (Part 7 §3.5; DECISIONS 2026-07-11 P2.3 T3 finding 1).
// All three are consequences of recompute-from-history being the correct model,
// not defects — but they are DIVERGENCES, and calling them equivalence is how a
// wrong premise gets reused later as fact.
import { dayDiff } from "./streak.js";

/** badges.py:202-211. Only workout / form / streak / badge XP is ever actually
 *  AWARDED by the old backend (grep-verified across backend-ml/app/routers:
 *  workouts.py + gamification.py). `meal_logged`, `coach_message`,
 *  `photo_analyzed` and `challenge_completed` are ported for completeness but
 *  WIRED TO NOTHING — the old app never awarded them (the same dead-constant
 *  class as the calendar `xp_earned`), and inventing that accrual would add a
 *  feature the spec is silent on (R0.2). */
export const XP_REWARDS = {
  workout_completed: 50,
  form_excellent_bonus: 20, //  form >= 80  (badges.py:204; applied :224-225)
  form_perfect_bonus: 50, //    form >= 100 (badges.py:205; applied :222-223)
  streak_day: 10, //            per consecutive-day continuation (:206; :247)
  meal_logged: 5, //            UNWIRED — old backend never awarded it
  challenge_completed: 200, //  UNWIRED — no challenge-completion path exists
  coach_message: 2, //          UNWIRED
  photo_analyzed: 15, //        UNWIRED
} as const;

/** badges.py:11-16 — XP a badge grants, by tier. */
export const TIER_XP = {
  bronze: 50,
  silver: 150,
  gold: 400,
  platinum: 1000,
} as const;
export type BadgeTier = keyof typeof TIER_XP;

/** badges.py:215-227 — XP required to REACH `level`. Python `int()` truncates a
 *  positive toward zero, i.e. `Math.floor` here. `Math.pow` may differ by ULPs
 *  across JS engines (Part IV #7), but flooring to an integer absorbs it and
 *  there is no cross-engine golden to match (production starts empty). */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(level - 1, 1.8));
}

/** badges.py:230-237 — current level for a total XP; the 200 loop cap is ported
 *  verbatim (nobody realistically reaches it under this curve). */
export function levelForXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) {
    level += 1;
    if (level > 200) break;
  }
  return level;
}

export interface XpProgress {
  level: number;
  xp: number;
  xpInLevel: number;
  xpForNext: number;
  progressPct: number;
  nextLevelAt: number;
}

/** badges.py:240-253. `progressPct` rounds to 1 dp; Python `round()` is
 *  half-to-even and `Math.round` half-up — a measure-zero divergence on a
 *  display bar (the rounding class ruled 2026-07-07). Goldens are chosen off
 *  the .5 boundary. */
export function xpProgress(xp: number): XpProgress {
  const current = levelForXp(xp);
  const base = xpForLevel(current);
  const next = xpForLevel(current + 1);
  const span = Math.max(next - base, 1);
  return {
    level: current,
    xp,
    xpInLevel: xp - base,
    xpForNext: next - base,
    progressPct: Math.round(((xp - base) / span) * 100 * 10) / 10,
    nextLevelAt: next,
  };
}

export interface XpAccrualInputs {
  /** count of the user's workouts — base 50 each (workouts.py:221). */
  workoutCount: number;
  /** workouts with avg_form_score >= 100 — +50 each (:222-223). */
  perfectFormWorkouts: number;
  /** workouts with avg_form_score in [80, 100) — +20 each (:224-225). */
  excellentFormWorkouts: number;
  /** consecutive-calendar-day continuations in the activity history — +10 each. */
  streakContinuationDays: number;
  /** total XP granted by the badges the user has earned (badges.py TIER_XP). */
  badgeXp: number;
}

/** The whole recompute: total XP = the same components the old backend `$inc`'d
 *  live, summed over full history so the result is a pure function of committed
 *  rows (idempotent, retry-safe). */
export function computeTotalXp(inp: XpAccrualInputs): number {
  return (
    XP_REWARDS.workout_completed * inp.workoutCount +
    XP_REWARDS.form_perfect_bonus * inp.perfectFormWorkouts +
    XP_REWARDS.form_excellent_bonus * inp.excellentFormWorkouts +
    XP_REWARDS.streak_day * inp.streakContinuationDays +
    inp.badgeXp
  );
}

/** workouts.py:245-247 awarded +10 each time a workout landed on the calendar
 *  day immediately after the previous workout day. Recomputed here as the count
 *  of adjacent pairs exactly one day apart in the sorted DISTINCT activity days.
 *  Freeze-bridged gaps do NOT count (the old app reset on any gap > 1 day;
 *  freezes are a new-arch streak mechanic and were never part of this XP rule —
 *  DECISIONS 2026-07-24 D5). */
export function countStreakContinuationDays(days: readonly string[]): number {
  const sorted = [...days].sort();
  let count = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev !== undefined && cur !== undefined && dayDiff(prev, cur) === 1) count += 1;
  }
  return count;
}
