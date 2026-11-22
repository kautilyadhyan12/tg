// A person's workout history and records for each exercise (spec Part 2 §13.5, job 61b): a month's days,
// a day's workouts, one workout set by set, and the records of one exercise. Records are worked out from
// the sets when they are read and never stored. Every answer is the person's own.
import { z } from "zod";
import { exerciseIdSchema } from "./exerciseFile.js";

const dayIsReal = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** A month, "2026-11". */
export const historyMonthSchema = z.string().regex(/^20\d\d-(0[1-9]|1[0-2])$/, { message: "a month as YYYY-MM" });
/** A day, "2026-11-18", that is on the calendar. */
export const historyDaySchema = z
  .string()
  .regex(/^20\d\d-\d\d-\d\d$/, { message: "a day as YYYY-MM-DD" })
  .refine(dayIsReal, { message: "a day on the calendar" });

export const historyMonthQuerySchema = z.object({ month: historyMonthSchema }).strict();

/** The most days one read of the calendar's days covers: a year, a leap year's included. */
export const HISTORY_RANGE_DAYS_MOST = 366;

const dayNumber = (s: string): number => Date.parse(`${s}T00:00:00Z`) / 86_400_000;

/** The days from `from` to `to`, both included, at most `HISTORY_RANGE_DAYS_MOST` of them (job 64a-v): the
 *  calendar's year, its months and its days read by one rule. */
export const historyRangeQuerySchema = z
  .object({ from: historyDaySchema, to: historyDaySchema })
  .strict()
  .refine((q) => q.from <= q.to, { message: "from on or before to", path: ["from"] })
  .refine((q) => dayNumber(q.to) - dayNumber(q.from) < HISTORY_RANGE_DAYS_MOST, { message: `at most ${String(HISTORY_RANGE_DAYS_MOST)} days`, path: ["to"] });

/** The days from `from` to `to` the person worked out on, as `historyMonthOutSchema` counts them. */
export const historyRangeOutSchema = z.object({
  from: historyDaySchema,
  to: historyDaySchema,
  days: z.array(z.object({ day: z.string(), workouts: z.number().int().min(1) })),
  limitedToDays: z.number().int().nullable(),
});
export type HistoryRange = z.infer<typeof historyRangeOutSchema>;

/** How many of a day's workouts one answer lists, in the order they started. */
export const HISTORY_DAY_WORKOUTS_MOST = 100;

/** Days, in the time zone each workout was done in (the person's own zone for one kept without one). A
 *  free plan reads back `limitedToDays` days; null when the plan has no limit. */
export const historyMonthOutSchema = z.object({
  month: historyMonthSchema,
  days: z.array(z.object({ day: z.string(), workouts: z.number().int().min(1) })),
  limitedToDays: z.number().int().nullable(),
});
export type HistoryMonth = z.infer<typeof historyMonthOutSchema>;

export const historyWorkoutListedSchema = z.object({
  workoutId: z.uuid(),
  name: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  setsCount: z.number().int(),
  kcalPoint: z.number().int().nullable(),
  /** Its exercises' id words, each once, in the order they were first done. */
  exercises: z.array(z.string()),
  /** Each exercise's Library name, in the same order (64a-v); null for one the Library never had, which the phone names
   *  as a workout's page does. */
  exerciseNames: z.array(z.string().nullable()),
});
export type HistoryWorkoutListed = z.infer<typeof historyWorkoutListedSchema>;

export const historyDayOutSchema = z.object({
  day: historyDaySchema,
  /** The first `HISTORY_DAY_WORKOUTS_MOST`; `total` says how many there are. */
  workouts: z.array(historyWorkoutListedSchema),
  total: z.number().int(),
  limitedToDays: z.number().int().nullable(),
});
export type HistoryDay = z.infer<typeof historyDayOutSchema>;

/** A record told of a set: heaviest weight, most reps, best estimated one-rep max (Epley's formula, an
 *  estimate), longest hold; and most lifted, told of the whole workout. */
export const RECORD_KINDS = ["heaviest", "most_reps", "best_estimated_1rm", "longest_hold", "most_lifted"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const historySetSchema = z.object({
  position: z.number().int(),
  exercise: z.string(),
  /** The Library's name for it; null for an exercise the Library never had, which the phone shows by
   *  its id word. */
  exerciseName: z.string().nullable(),
  /** The set's own unit, as it was done. */
  measuredIn: z.enum(["reps", "time"]),
  /** Null for a set saved before targets were kept. */
  target: z.number().int().nullable(),
  /** Reps, or whole seconds for a set measured in time. */
  done: z.number().int(),
  weightGrams: z.number().int().nullable(),
  restSeconds: z.number().int().nullable(),
  durationMs: z.number().int(),
  /** Null for a set saved before this was kept. */
  counted: z.enum(["camera", "hand", "timer"]).nullable(),
});
export type HistorySet = z.infer<typeof historySetSchema>;

/** A new record in this workout, told against everything the person did before it. `position` is the
 *  set that made it; null for most lifted, which is the whole workout's. */
export const newRecordSchema = z.object({
  exercise: z.string(),
  measuredIn: z.enum(["reps", "time"]),
  kind: z.enum(RECORD_KINDS),
  position: z.number().int().nullable(),
});
export type NewRecord = z.infer<typeof newRecordSchema>;

export const historyWorkoutSchema = z.object({
  workoutId: z.uuid(),
  name: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  timeZone: z.string().nullable(),
  startedFrom: z.enum(["saved", "app_plan", "gym_plan", "none"]).nullable(),
  effort: z.number().int().nullable(),
  heartAvg: z.number().int().nullable(),
  heartMax: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  kcalPoint: z.number().int().nullable(),
  kcalCalcVersion: z.number().int().nullable(),
  /** The body weight its calories were worked out at when it was saved; null where none was given (70 kg). */
  kcalWeightKg: z.number().nullable(),
  platform: z.enum(["web", "android", "ios"]),
  sets: z.array(historySetSchema),
  newRecords: z.array(newRecordSchema),
});
export type HistoryWorkout = z.infer<typeof historyWorkoutSchema>;

/** Epley's estimate (1985) is not used past 10 reps, where it strays most (LeSuer et al., 1997). */
export const EPLEY_REPS_MOST = 10;

/** The estimated one-rep max in whole grams, or null for a set it is not worked out for. One rep is the
 *  weight itself. */
export function estimatedOneRepMaxGrams(weightGrams: number | null, reps: number): number | null {
  if (weightGrams === null || reps < 1 || reps > EPLEY_REPS_MOST) return null;
  return reps === 1 ? weightGrams : Math.floor((weightGrams * (30 + reps)) / 30);
}

/** The set a record was made in. */
export const recordSetSchema = z.object({
  workoutId: z.uuid(),
  startedAt: z.string(),
  position: z.number().int(),
  done: z.number().int(),
  weightGrams: z.number().int().nullable(),
});
export type RecordSet = z.infer<typeof recordSetSchema>;

/** How many of the person's latest workouts of an exercise its records also give, one best each. */
export const RECENT_WORKOUTS_MOST = 7;

/** One of the person's latest workouts of an exercise, with its own best of each kind (null where it did
 *  none of that kind): the screen draws the person's last times against their record. */
export const recentWorkoutSchema = z.object({
  workoutId: z.uuid(),
  startedAt: z.string(),
  reps: z.object({ heaviestGrams: z.number().int().nullable(), mostReps: z.number().int().nullable() }),
  time: z.object({ longestHold: z.number().int().nullable(), heaviestGrams: z.number().int().nullable() }),
});
export type RecentWorkout = z.infer<typeof recentWorkoutSchema>;

export const exerciseRecordsSchema = z.object({
  exercise: exerciseIdSchema,
  /** Sets measured in reps. */
  reps: z.object({
    heaviest: recordSetSchema.nullable(),
    mostReps: recordSetSchema.nullable(),
    bestEstimated1rm: recordSetSchema.extend({ estimateGrams: z.number().int() }).nullable(),
    mostLifted: z.object({ workoutId: z.uuid(), startedAt: z.string(), grams: z.number().int() }).nullable(),
  }),
  /** Sets measured in time: a hold, a carry. */
  time: z.object({
    longestHold: recordSetSchema.nullable(),
    heaviest: recordSetSchema.nullable(),
  }),
  /** The person's latest workouts of it in which something was done, at most `RECENT_WORKOUTS_MOST`, the
   *  earliest first; within a free plan's days, as the records are. */
  recent: z.array(recentWorkoutSchema).max(RECENT_WORKOUTS_MOST),
  /** The day of each workout this answer names, in the zone it was done in (the person's own zone for one kept
   *  without one), as History tells a day. */
  days: z.record(z.uuid(), historyDaySchema),
  limitedToDays: z.number().int().nullable(),
});
export type ExerciseRecords = z.infer<typeof exerciseRecordsSchema>;
