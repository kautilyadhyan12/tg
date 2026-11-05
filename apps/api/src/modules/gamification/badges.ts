// P2.3 — achievement catalog + evaluator, ported from badges.py (v1 §6.1:
// "Port badges.py/challenges.py logic"; Part 4 §3.8: achievements "seeded
// from badges.py port"). Each badge's `tier` is ported from badges.py:11-16,
// which the XP recompute reads for badge XP (DECISIONS 2026-07-24 — XP storage
// added; the P2.3 GAP-1 "XP not ported" deferral is discharged). Variety
// re-keyed to families F1–F12 (GAP-4). Values cited to badges.py lines.
// Meal/photo criteria are seeded but their stats evaluate to 0 until
// those modules land (P2.5/P2.6) — data, not code.
import { z } from "zod";
import type { Badge } from "@app/shared";
import { bandOf } from "../nutrition/foodWeek.js";
import { TIER_XP, type BadgeTier } from "./xp.js";

/** criteria jsonb shape (Part 4 §3.8). stat = key into the evaluator's
 *  stats record; minWorkouts = form_master's "over 5 workouts" guard
 *  (badges.py:284). */
export const criteriaSchema = z
  .object({
    stat: z.string().min(1),
    gte: z.number(),
    minWorkouts: z.number().int().positive().optional(),
  })
  .strict();
export type Criteria = z.infer<typeof criteriaSchema>;

export interface AchievementSeed {
  code: string;
  nameKey: string;
  icon: string;
  /** badges.py tier; drives badge XP (TIER_XP). Not stored in the DB
   *  `achievements` table (no column) — seed.ts ignores it; the future badge
   *  catalog card is where it lands in the DB if that endpoint serves it. */
  tier: BadgeTier;
  criteria: Criteria;
}

// badges.py:20-198 — same ids, icons, tiers; names become message keys
// (R5-style message-keys-not-strings, v1 §5.2).
export const ACHIEVEMENTS: readonly AchievementSeed[] = [
  { code: "first_workout", nameKey: "achievement.first_workout", icon: "🎯", tier: "bronze", criteria: { stat: "total_workouts", gte: 1 } },
  { code: "ten_workouts", nameKey: "achievement.ten_workouts", icon: "💪", tier: "silver", criteria: { stat: "total_workouts", gte: 10 } },
  { code: "fifty_workouts", nameKey: "achievement.fifty_workouts", icon: "🏆", tier: "gold", criteria: { stat: "total_workouts", gte: 50 } },
  { code: "hundred_workouts", nameKey: "achievement.hundred_workouts", icon: "⭐", tier: "platinum", criteria: { stat: "total_workouts", gte: 100 } },
  { code: "streak_3", nameKey: "achievement.streak_3", icon: "🔥", tier: "bronze", criteria: { stat: "current_streak", gte: 3 } }, // gitleaks:allow
  { code: "streak_7", nameKey: "achievement.streak_7", icon: "🔥", tier: "silver", criteria: { stat: "current_streak", gte: 7 } }, // gitleaks:allow
  { code: "streak_30", nameKey: "achievement.streak_30", icon: "🔥", tier: "gold", criteria: { stat: "current_streak", gte: 30 } }, // gitleaks:allow
  { code: "streak_100", nameKey: "achievement.streak_100", icon: "💎", tier: "platinum", criteria: { stat: "current_streak", gte: 100 } }, // gitleaks:allow
  { code: "form_perfect", nameKey: "achievement.form_perfect", icon: "🎨", tier: "silver", criteria: { stat: "perfect_form_count", gte: 1 } },
  { code: "form_master", nameKey: "achievement.form_master", icon: "🧘", tier: "gold", criteria: { stat: "avg_form_last5", gte: 90, minWorkouts: 5 } },
  { code: "calorie_1k", nameKey: "achievement.calorie_1k", icon: "⚡", tier: "bronze", criteria: { stat: "total_kcal", gte: 1000 } }, // gitleaks:allow
  { code: "calorie_10k", nameKey: "achievement.calorie_10k", icon: "🌋", tier: "gold", criteria: { stat: "total_kcal", gte: 10000 } }, // gitleaks:allow
  { code: "early_bird", nameKey: "achievement.early_bird", icon: "🌅", tier: "silver", criteria: { stat: "morning_workouts", gte: 5 } },
  { code: "night_owl", nameKey: "achievement.night_owl", icon: "🌙", tier: "silver", criteria: { stat: "night_workouts", gte: 5 } },
  { code: "variety_5", nameKey: "achievement.variety_5", icon: "🎭", tier: "silver", criteria: { stat: "families_tried", gte: 5 } }, // gitleaks:allow
  { code: "variety_all", nameKey: "achievement.variety_all", icon: "🌈", tier: "gold", criteria: { stat: "families_tried", gte: 12 } },
  { code: "first_meal", nameKey: "achievement.first_meal", icon: "🍎", tier: "bronze", criteria: { stat: "total_meals", gte: 1 } },
  { code: "macro_master", nameKey: "achievement.macro_master", icon: "🥩", tier: "gold", criteria: { stat: "protein_target_streak", gte: 7 } },
  { code: "photo_meal", nameKey: "achievement.photo_meal", icon: "📸", tier: "bronze", criteria: { stat: "photo_meals_logged", gte: 1 } },
];

/** code → tier, built once from the catalog so the two cannot drift. */
const TIER_BY_CODE: ReadonlyMap<string, BadgeTier> = new Map(
  ACHIEVEMENTS.map((a) => [a.code, a.tier]),
);

/** badges.py:280-300 / gamification.py:246-262 — the XP a set of EARNED badges
 *  grants, summed by tier. An unknown code contributes 0 (defensive; the
 *  evaluator only ever produces codes from ACHIEVEMENTS). */
export function badgeXpForCodes(codes: readonly string[]): number {
  let sum = 0;
  for (const code of codes) {
    const tier = TIER_BY_CODE.get(code);
    if (tier !== undefined) sum += TIER_XP[tier];
  }
  return sum;
}

export type Stats = Readonly<Record<string, number>>;

/** badges.py:257-308 check engine, generalized: a stat the codebase can't
 *  produce yet simply reads 0 (never earned, never crashes). */
export function evaluate(criteria: Criteria, stats: Stats): boolean {
  const value = stats[criteria.stat] ?? 0;
  if (criteria.minWorkouts !== undefined && (stats["total_workouts"] ?? 0) < criteria.minWorkouts) {
    return false;
  }
  return value >= criteria.gte;
}

export function earnedCodes(stats: Stats): string[] {
  return ACHIEVEMENTS.filter((a) => evaluate(a.criteria, stats)).map((a) => a.code);
}

/** A day of food as Macro Master reads it: the protein logged that day and the day's
 *  own protein target, as "Your week in food" kept it (food_day_targets). */
export interface ProteinDay {
  day: string; // YYYY-MM-DD in the person's time zone
  eatenG: number;
  targetG: number;
}

/** The days in a row the person hit their protein target (ROADMAP 35c-iii; Macro Master),
 *  ending today, or yesterday while today has not hit it yet. A day hits when its protein
 *  is not under the target as "Your week in food" bands it (within 10 % counts), so the
 *  two screens agree; a day with no target kept, or a target of 0, never counts. */
export function proteinRun(days: readonly ProteinDay[], today: string): number {
  const hit = new Set(days.filter((d) => d.targetG > 0 && bandOf(d.eatenG, d.targetG) !== "under").map((d) => d.day));
  let day = hit.has(today) ? today : dayBefore(today);
  let run = 0;
  while (hit.has(day)) {
    run += 1;
    day = dayBefore(day);
  }
  return run;
}

function dayBefore(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) throw new Error(`not a day: ${day}`);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** Every badge for the person (ROADMAP 35c-iii): earned ones with their day, the rest
 *  with how far along they are. `current` never passes the target, and is floored, so
 *  an average of 89.6 reads 89 of 90 and never as reached. */
export function badgeList(stats: Stats, earned: ReadonlyMap<string, Date>): Badge[] {
  return ACHIEVEMENTS.map((a): Badge => {
    const at = earned.get(a.code);
    const { gte, minWorkouts } = a.criteria;
    const value = Math.floor(stats[a.criteria.stat] ?? 0);
    const workouts = Math.floor(stats["total_workouts"] ?? 0);
    return {
      code: a.code,
      tier: a.tier,
      xp: TIER_XP[a.tier],
      earnedAt: at === undefined ? null : at.toISOString(),
      current: at === undefined ? Math.min(Math.max(value, 0), gte) : gte,
      target: gte,
      workoutsFirst:
        minWorkouts === undefined ? null : { current: at === undefined ? Math.min(workouts, minWorkouts) : minWorkouts, target: minWorkouts },
    };
  });
}
