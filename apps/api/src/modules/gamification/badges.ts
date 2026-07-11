// P2.3 — achievement catalog + evaluator, ported from badges.py (v1 §6.1:
// "Port badges.py/challenges.py logic"; Part 4 §3.8: achievements "seeded
// from badges.py port"). XP rewards NOT ported (DECISIONS P2.3 GAP-1: no
// storage). Variety re-keyed to families F1–F12 (GAP-4). Values cited to
// badges.py lines. Meal/coach/photo criteria are seeded but their stats
// evaluate to 0 until those modules land (P2.5/P2.6) — data, not code.
import { z } from "zod";

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
  criteria: Criteria;
}

// badges.py:20-198 — same ids, icons; names become message keys (R5-style
// message-keys-not-strings, v1 §5.2).
export const ACHIEVEMENTS: readonly AchievementSeed[] = [
  { code: "first_workout", nameKey: "achievement.first_workout", icon: "🎯", criteria: { stat: "total_workouts", gte: 1 } },
  { code: "ten_workouts", nameKey: "achievement.ten_workouts", icon: "💪", criteria: { stat: "total_workouts", gte: 10 } },
  { code: "fifty_workouts", nameKey: "achievement.fifty_workouts", icon: "🏆", criteria: { stat: "total_workouts", gte: 50 } },
  { code: "hundred_workouts", nameKey: "achievement.hundred_workouts", icon: "⭐", criteria: { stat: "total_workouts", gte: 100 } },
  { code: "streak_3", nameKey: "achievement.streak_3", icon: "🔥", criteria: { stat: "current_streak", gte: 3 } }, // gitleaks:allow
  { code: "streak_7", nameKey: "achievement.streak_7", icon: "🔥", criteria: { stat: "current_streak", gte: 7 } }, // gitleaks:allow
  { code: "streak_30", nameKey: "achievement.streak_30", icon: "🔥", criteria: { stat: "current_streak", gte: 30 } }, // gitleaks:allow
  { code: "streak_100", nameKey: "achievement.streak_100", icon: "💎", criteria: { stat: "current_streak", gte: 100 } }, // gitleaks:allow
  { code: "form_perfect", nameKey: "achievement.form_perfect", icon: "🎨", criteria: { stat: "perfect_form_count", gte: 1 } },
  { code: "form_master", nameKey: "achievement.form_master", icon: "🧘", criteria: { stat: "avg_form_last5", gte: 90, minWorkouts: 5 } },
  { code: "calorie_1k", nameKey: "achievement.calorie_1k", icon: "⚡", criteria: { stat: "total_kcal", gte: 1000 } }, // gitleaks:allow
  { code: "calorie_10k", nameKey: "achievement.calorie_10k", icon: "🌋", criteria: { stat: "total_kcal", gte: 10000 } }, // gitleaks:allow
  { code: "early_bird", nameKey: "achievement.early_bird", icon: "🌅", criteria: { stat: "morning_workouts", gte: 5 } },
  { code: "night_owl", nameKey: "achievement.night_owl", icon: "🌙", criteria: { stat: "night_workouts", gte: 5 } },
  { code: "variety_5", nameKey: "achievement.variety_5", icon: "🎭", criteria: { stat: "families_tried", gte: 5 } }, // gitleaks:allow
  { code: "variety_all", nameKey: "achievement.variety_all", icon: "🌈", criteria: { stat: "families_tried", gte: 12 } },
  { code: "first_meal", nameKey: "achievement.first_meal", icon: "🍎", criteria: { stat: "total_meals", gte: 1 } },
  { code: "macro_master", nameKey: "achievement.macro_master", icon: "🥩", criteria: { stat: "protein_target_streak", gte: 7 } },
  { code: "first_chat", nameKey: "achievement.first_chat", icon: "💬", criteria: { stat: "coach_messages", gte: 1 } },
  { code: "photo_meal", nameKey: "achievement.photo_meal", icon: "📸", criteria: { stat: "photo_meals_logged", gte: 1 } },
];

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
