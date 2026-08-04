// P2.3 — progress read contracts (ports of progress.py's five reads onto
// Part 4 §3.5 SQL; data-shaped — labels/emoji/formatting are the client's).
// Periods ported from progress.py:13-19.
import { z } from "zod";

export const progressPeriodSchema = z.enum(["7d", "30d", "90d", "1y", "all"]);
export type ProgressPeriod = z.infer<typeof progressPeriodSchema>;

export const progressQuerySchema = z
  .object({ period: progressPeriodSchema.default("30d") })
  .strict();
export type ProgressQuery = z.infer<typeof progressQuerySchema>;

/** progress.py:71-82 semantics; hours→durationMs (client formats), calories
 *  →kcal point values (banding per 2B §2.3 is display). consistencyPct =
 *  min(100, round(workouts/days×100)) for bounded periods, 0 for 'all'
 *  (progress.py:63-69 verbatim). */
/** Part 4 §0.2 read-gate flag (P2.4 GAP-4), on every progress read: the PLAN'S
 *  history limit in days — **whether or not it bound this particular request**
 *  — and null when the plan is UNLIMITED.
 *
 *  Reworded 2026-08-04 alongside its twin in `workouts.ts` (T3 round 2 on the
 *  date window, F1). The old wording — "aggregates cover at most this many
 *  days; null = the full requested window" — describes the RESPONSE, and the
 *  field describes the PLAN. The distinction was harmless while every request
 *  was unbounded and is not now: a request whose own window is newer than the
 *  gate is not clamped by anything, and this field still reports the plan's 90.
 *
 *  **Do not "fix" that by returning null.** DECISIONS 2026-07-11 (P2.4 GAP-4)
 *  fixes `null = unlimited`, so null on an unclamped request tells a free user
 *  their plan has no history limit — the one lie here a reader cannot recover
 *  from. This comment exists because the reworded twin left this declaration
 *  behind, and a stale sentence is what invites exactly that edit. */
const limitedToDays = z.number().int().nullable();

export const progressOverviewSchema = z.object({
  totalWorkouts: z.number().int(),
  totalKcal: z.number().int(),
  totalDurationMs: z.number().int(),
  avgFormScore: z.number().int().nullable(),
  currentStreak: z.number().int(),
  longestStreak: z.number().int(),
  consistencyPct: z.number().int(),
  limitedToDays,
});
export type ProgressOverview = z.infer<typeof progressOverviewSchema>;

/** Day buckets in the USER's timezone (Part 7 §3.1 rule applied uniformly;
 *  DECISIONS P2.3 GAP-3). date = 'YYYY-MM-DD'. */
export const trendPointSchema = z.object({
  date: z.string(),
  kcal: z.number().int(),
  workouts: z.number().int(),
});
export const progressTrendSchema = z.object({ points: z.array(trendPointSchema), limitedToDays });
export type ProgressTrend = z.infer<typeof progressTrendSchema>;

export const weeklyPointSchema = z.object({
  isoYear: z.number().int(),
  isoWeek: z.number().int(),
  workouts: z.number().int(),
  kcal: z.number().int(),
});
export const progressWeeklySchema = z.object({ points: z.array(weeklyPointSchema), limitedToDays });
export type ProgressWeekly = z.infer<typeof progressWeeklySchema>;

/** Last 365 days (progress.py:194). */
export const progressHeatmapSchema = z.object({
  days: z.array(z.object({ date: z.string(), count: z.number().int(), kcal: z.number().int() })),
  limitedToDays,
});
export type ProgressHeatmap = z.infer<typeof progressHeatmapSchema>;

/** Family distribution (Part 2 §5 F1–F12; replaces the old category field —
 *  DECISIONS P2.3 GAP-4). Counted per SET, the granular unit we store. */
export const progressDistributionSchema = z.object({
  families: z.array(z.object({ family: z.string(), sets: z.number().int() })),
  limitedToDays,
});
export type ProgressDistribution = z.infer<typeof progressDistributionSchema>;

/** Personal records (progress.py:254-324, data-shaped). */
const recordRefSchema = z
  .object({ workoutId: z.string().uuid(), value: z.number() })
  .nullable();
export const personalRecordsSchema = z.object({
  maxKcalWorkout: recordRefSchema,
  longestWorkout: recordRefSchema, // value = durationMs
  bestAvgForm: recordRefSchema, // value = avg_form_score
  totalWorkouts: z.number().int(),
  longestStreak: z.number().int(),
  limitedToDays,
});
export type PersonalRecords = z.infer<typeof personalRecordsSchema>;
