// P2.3 — gamification contracts (v1 §6.1; Part 4 §3.8; Part 7 §3).
// XP storage added 2026-07-24 (Kd ruling: KEEP the feature, add storage —
// discharges the P2.3 GAP-1 deferral). The values are RECOMPUTED from history
// server-side and served here; the browser never computes them (the badges.py
// curve is the only source).
import { z } from "zod";

export const streakViewSchema = z.object({
  current: z.number().int(),
  longest: z.number().int(),
  lastActivityDate: z.string().nullable(), // 'YYYY-MM-DD' in the user's timezone
  freezesAvailable: z.number().int(),
});
export type StreakView = z.infer<typeof streakViewSchema>;

/** XP + level view. camelCase — the API speaks camelCase and the web renames
 *  on repoint (the nutrition-targets precedent). `total` is the recomputed
 *  lifetime XP; every other field is a pure function of it (badges.py
 *  xp_progress:240-253), so the client renders a level bar without doing math. */
export const xpViewSchema = z.object({
  total: z.number().int(),
  level: z.number().int(),
  xpInLevel: z.number().int(),
  xpForNext: z.number().int(),
  progressPct: z.number(),
  nextLevelAt: z.number().int(),
});
export type XpView = z.infer<typeof xpViewSchema>;

export const earnedAchievementSchema = z.object({
  code: z.string(),
  earnedAt: z.string(),
});

export const gamificationMeSchema = z.object({
  streak: streakViewSchema,
  xp: xpViewSchema,
  achievements: z.array(earnedAchievementSchema),
});
export type GamificationMe = z.infer<typeof gamificationMeSchema>;

// ── Weekly challenges (ROADMAP 35b) ─────────────────────────────────────────
// Three a week, Monday to Sunday in the person's own time zone, picked by the
// server and kept for the week. Each is measured on every read from what the
// server already holds; the words are the screen's, keyed on `code`.

export const weeklyChallengeCodeSchema = z.enum([
  "train_days_3",
  "train_days_5",
  "train_days_7",
  "burn_kcal_1500",
  "burn_kcal_3000",
  "train_minutes_120",
  "train_minutes_300",
  "form_80_workouts_3",
  "form_90_workouts_3",
  "families_3",
  "families_5",
  "food_days_5",
  "food_days_7",
]);
export type WeeklyChallengeCode = z.infer<typeof weeklyChallengeCodeSchema>;

/** What a challenge counts. `form_80_workouts` and `form_90_workouts` count workouts the
 *  camera scored at least that well; `families` counts the exercise families tried. */
export const weeklyChallengeMeasureSchema = z.enum([
  "training_days",
  "kcal_burned",
  "training_minutes",
  "form_80_workouts",
  "form_90_workouts",
  "families",
  "food_days",
]);
export type WeeklyChallengeMeasure = z.infer<typeof weeklyChallengeMeasureSchema>;

export const weeklyChallengeDifficultySchema = z.enum(["easy", "medium", "hard"]);
export type WeeklyChallengeDifficulty = z.infer<typeof weeklyChallengeDifficultySchema>;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const weeklyChallengeSchema = z.object({
  code: weeklyChallengeCodeSchema,
  measure: weeklyChallengeMeasureSchema,
  difficulty: weeklyChallengeDifficultySchema,
  target: z.number().int().positive(),
  /** This week so far; 0 when nothing counts yet. */
  current: z.number().int().nonnegative(),
  done: z.boolean(),
  /** The XP it gives when done, once. */
  xp: z.number().int().positive(),
  /** Safe mode came on after the week's challenges were picked: this one asks for more
   *  effort than Safe mode allows, so the screen does not urge it. */
  held: z.object({ code: z.literal("safe_mode") }).nullable(),
});
export type WeeklyChallenge = z.infer<typeof weeklyChallengeSchema>;

export const weeklyChallengesQuerySchema = z.object({}).strict();

export const weeklyChallengesSchema = z.object({
  weekStart: isoDay, // Monday, in the person's own time zone
  weekEnd: isoDay, // Sunday
  challenges: z.array(weeklyChallengeSchema).min(1).max(3),
  /** XP from this week's done challenges. */
  xpThisWeek: z.number().int().nonnegative(),
});
export type WeeklyChallenges = z.infer<typeof weeklyChallengesSchema>;
