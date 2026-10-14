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

// ── Predictions (ROADMAP 35a; spec Part 2B §5) ───────────────────────────────
// Reflections of the person's own pattern, worked out the same way every time: the
// same workouts give the same answer until the day changes. Each part is hidden below
// its own data gate rather than guessed. Words are the screen's; these are the facts.

/** The rules' version, so a later change to them is never mistaken for the person's. */
export const PREDICTIONS_CALC_VERSION = 1;

/** The predictions take no query; anything sent is refused, never quietly read. */
export const progressPredictionsQuerySchema = z.object({}).strict();

export const PREDICTION_GATES = {
  /** Workouts in the 28 days before today, and a first workout at least 7 days before
   *  today (so every weekday has a day of its own), for the next 7 days' calories. */
  forecastWorkouts: 5,
  forecastDaysSinceFirst: 7,
  /** Finished weeks since the person's first workout, for this week's goal. */
  weekGoalWeeks: 3,
  /** Workouts in the last 6 weeks, at least 3 of them in each half, for a steady pace. */
  steadyWorkouts: 8,
  steadyEachSide: 3,
  /** Workouts with a form score in the last 90 days, for the best time of day. */
  bestTimeWorkouts: 6,
} as const;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const int = z.number().int();

export const forecastDaySchema = z.object({
  date: day,
  kcalPoint: int,
  kcalLow: int,
  kcalHigh: int,
});

/** few_workouts: under 5 workouts in the 28 days before today · too_new: the first
 *  workout was under 7 days ago. */
export const forecastHiddenReasonSchema = z.enum(["few_workouts", "too_new"]);

export const calorieForecastSchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(false), reason: forecastHiddenReasonSchema, workouts: int, needed: int }),
  z.object({
    available: z.literal(true),
    /** Tomorrow and the six days after it. */
    days: z.array(forecastDaySchema).length(7),
    totalPoint: int,
    totalLow: int,
    totalHigh: int,
  }),
]);
export type CalorieForecast = z.infer<typeof calorieForecastSchema>;

/** reached: the goal is met this week · on_track · doable: `moreNeeded` days more ·
 *  tough: the week is unlikely, and one session still keeps the streak. Never a percent. */
export const weekGoalBandSchema = z.enum(["reached", "on_track", "doable", "tough"]);
export type WeekGoalBand = z.infer<typeof weekGoalBandSchema>;

export const weekGoalPredictionSchema = z.union([
  z.object({ available: z.literal(false), reason: z.literal("no_goal") }),
  z.object({ available: z.literal(false), reason: z.literal("few_weeks"), weeks: int, needed: int }),
  z.object({
    available: z.literal(true),
    /** The person's training-days goal for a week. */
    target: int,
    /** Days trained this week, Monday to today. */
    done: int,
    /** Days of this week still free to train on, today included when nothing is logged yet. */
    daysLeft: int,
    moreNeeded: int,
    band: weekGoalBandSchema,
  }),
]);
export type WeekGoalPrediction = z.infer<typeof weekGoalPredictionSchema>;

/** One figure's average in the 4 weeks before and the last 2 weeks; null where either
 *  side has nothing to average or the earlier one is 0. */
export const steadyFigureSchema = z
  .object({ before: int, recent: int, changePct: z.number() })
  .nullable();

/** few_workouts: under the gate · nothing_to_compare: enough workouts, and no figure
 *  that both sides have with an earlier average above 0. */
export const steadyHiddenReasonSchema = z.enum(["few_workouts", "nothing_to_compare"]);

export const steadyPaceSchema = z.discriminatedUnion("available", [
  z.object({
    available: z.literal(false),
    reason: steadyHiddenReasonSchema,
    recent: int,
    before: int,
    needed: int,
    neededEachSide: int,
  }),
  z.object({
    available: z.literal(true),
    /** Every figure that could be compared moved less than 5 % either way. */
    steady: z.boolean(),
    recentDays: z.literal(14),
    kcal: steadyFigureSchema,
    minutes: steadyFigureSchema,
    form: steadyFigureSchema,
  }),
]);
export type SteadyPace = z.infer<typeof steadyPaceSchema>;

/** Morning 5:00–11:59 · afternoon 12:00–16:59 · evening 17:00–21:59 · night 22:00–4:59,
 *  in the person's own time zone. */
export const timeSlotSchema = z.enum(["morning", "afternoon", "evening", "night"]);
export type TimeSlot = z.infer<typeof timeSlotSchema>;

export const bestTimeSchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(false), workouts: int, needed: int }),
  z.object({
    available: z.literal(true),
    /** Null until a time of day holds 2 workouts. */
    best: timeSlotSchema.nullable(),
    slots: z.array(z.object({ slot: timeSlotSchema, workouts: int, avgForm: int })),
  }),
]);
export type BestTime = z.infer<typeof bestTimeSchema>;

export const progressPredictionsSchema = z.object({
  calcVersion: z.literal(PREDICTIONS_CALC_VERSION),
  /** Workouts in the last 90 days, the most any part reads. */
  workouts: int,
  forecast: calorieForecastSchema,
  weekGoal: weekGoalPredictionSchema,
  steady: steadyPaceSchema,
  bestTime: bestTimeSchema,
  limitedToDays,
});
export type ProgressPredictions = z.infer<typeof progressPredictionsSchema>;
