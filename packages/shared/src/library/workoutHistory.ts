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
  platform: z.enum(["web", "android", "ios"]),
  sets: z.array(historySetSchema),
  newRecords: z.array(newRecordSchema),
});
export type HistoryWorkout = z.infer<typeof historyWorkoutSchema>;

/** The set a record was made in. */
export const recordSetSchema = z.object({
  workoutId: z.uuid(),
  startedAt: z.string(),
  position: z.number().int(),
  done: z.number().int(),
  weightGrams: z.number().int().nullable(),
});
export type RecordSet = z.infer<typeof recordSetSchema>;

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
  limitedToDays: z.number().int().nullable(),
});
export type ExerciseRecords = z.infer<typeof exerciseRecordsSchema>;
