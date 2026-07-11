// P2.3 — gamification contracts (v1 §6.1; Part 4 §3.8; Part 7 §3).
// XP deliberately absent (DECISIONS P2.3 GAP-1: no storage in Part 4).
import { z } from "zod";

export const streakViewSchema = z.object({
  current: z.number().int(),
  longest: z.number().int(),
  lastActivityDate: z.string().nullable(), // 'YYYY-MM-DD' in the user's timezone
  freezesAvailable: z.number().int(),
});
export type StreakView = z.infer<typeof streakViewSchema>;

export const earnedAchievementSchema = z.object({
  code: z.string(),
  earnedAt: z.string(),
});

export const gamificationMeSchema = z.object({
  streak: streakViewSchema,
  achievements: z.array(earnedAchievementSchema),
});
export type GamificationMe = z.infer<typeof gamificationMeSchema>;
