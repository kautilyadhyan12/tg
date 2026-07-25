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
