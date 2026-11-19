// A planned workout, and a person's saved workouts (spec Part 2 §13.5, job 61c). A planned workout is ONE
// shape: a name and, in order, exercises with their sets, each set's target, weight and rest. A person's
// saved workouts use it now; the app's weekly plan (item 36) and the gym's plan (Stage 2's 24b) use the
// same shape when their folders build them.
//
// A saved workout is kept under the id the phone made: PUT /v1/training/saved/:id saves it or saves a
// change to it, and sent twice is one. `editedAt` is when the person last changed it on the phone: a change
// older than the one the server holds keeps nothing, so a late send never undoes a newer change.
import { z } from "zod";
import { instantSchema } from "../time.js";
import { exerciseIdSchema } from "./exerciseFile.js";
import { WORKOUT_SAVE_LIMITS } from "./workoutSave.js";

const W = WORKOUT_SAVE_LIMITS;

export const PLANNED_WORKOUT_LIMITS = {
  /** Exercises in one planned workout. */
  exercisesMost: 50,
  /** Sets in one planned workout, all its exercises together: as many as a workout done may hold. */
  setsMost: W.setsMost,
  nameMost: W.nameMost,
  /** Saved workouts a person may keep, on every plan (Kd, 2026-11-19). */
  savedMost: 50,
} as const;

const P = PLANNED_WORKOUT_LIMITS;

const noNul = (s: string): boolean => !s.includes("\u0000");

/** One set of an exercise: its target in the exercise's unit (reps, or seconds for one measured in time),
 *  its weight in whole grams (shown in the person's kg or lb), and the rest after it. */
export const plannedSetSchema = z
  .object({
    target: z.number().int().min(1).max(W.secondsMost),
    weightGrams: z.number().int().min(1).max(W.weightGramsMost).nullable(),
    /** The rest after this set; null for none. */
    restSeconds: z.number().int().min(0).max(W.restSecondsMost).nullable(),
  })
  .strict();
export type PlannedSet = z.infer<typeof plannedSetSchema>;

/** One exercise of the plan, with its sets in order. Its unit is kept as the phone's list had it. */
export const plannedExerciseSchema = z
  .object({
    exercise: exerciseIdSchema,
    measuredIn: z.enum(["reps", "time"]),
    sets: z.array(plannedSetSchema).min(1).max(P.setsMost),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.measuredIn !== "reps") return;
    e.sets.forEach((s, i) => {
      if (s.target > W.repsMost) ctx.addIssue({ code: "custom", message: `reps above ${String(W.repsMost)}`, path: ["sets", i, "target"] });
    });
  });
export type PlannedExercise = z.infer<typeof plannedExerciseSchema>;

const plannedFields = {
  name: z.string().trim().min(1).max(P.nameMost).refine(noNul, { message: "a NUL character" }),
  exercises: z.array(plannedExerciseSchema).min(1).max(P.exercisesMost),
};

const setsWithinLimit = (w: { exercises: readonly PlannedExercise[] }, ctx: z.RefinementCtx): void => {
  const sets = w.exercises.reduce((sum, e) => sum + e.sets.length, 0);
  if (sets > P.setsMost) ctx.addIssue({ code: "custom", message: `more than ${String(P.setsMost)} sets`, path: ["exercises"] });
};

/** A planned workout: a name and its exercises in order. */
export const plannedWorkoutSchema = z.object(plannedFields).strict().superRefine(setsWithinLimit);
export type PlannedWorkout = z.infer<typeof plannedWorkoutSchema>;

/** No finer than a millisecond, as a phone's clock gives it: a finer one would be kept finer than it reads
 *  back, so the phone's own copy would never match the server's. */
const toTheMillisecond = (s: string): boolean => !/\.\d{4,}/.test(s);

/** The body of PUT /v1/training/saved/:id. */
export const savedWorkoutWriteSchema = z
  .object({ ...plannedFields, editedAt: instantSchema.refine(toTheMillisecond, { message: "to the millisecond at most" }) })
  .strict()
  .superRefine(setsWithinLimit);
export type SavedWorkoutWrite = z.infer<typeof savedWorkoutWriteSchema>;

/** The answer to a save: 201 created; 200 updated, unchanged (the server holds this change or a newer
 *  one), or removed (the person deleted it: nothing is kept, and the phone forgets it). `editedAt` is the
 *  time of the change the server holds (null once removed): when it differs from the
 *  phone's, the server holds a newer change, and the phone reads the saved workout again. */
export const savedWorkoutWrittenSchema = z.object({
  id: z.uuid(),
  status: z.enum(["created", "updated", "unchanged", "removed"]),
  editedAt: z.string().nullable(),
});
export type SavedWorkoutWritten = z.infer<typeof savedWorkoutWrittenSchema>;

/** The answer (409) to a new saved workout past the person's limit. */
export const savedWorkoutsFullSchema = z.object({
  error: z.literal("saved_workouts_full"),
  most: z.number().int(),
  requestId: z.string(),
});
export type SavedWorkoutsFull = z.infer<typeof savedWorkoutsFullSchema>;

/** One saved workout, whole. */
export const savedWorkoutSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  editedAt: z.string(),
  exercises: z.array(plannedExerciseSchema),
});
export type SavedWorkout = z.infer<typeof savedWorkoutSchema>;

/** The person's saved workouts, the most recently changed first: each one's exercises (their id words, in
 *  order, each once) and how many sets it holds. The phone names an exercise from its own Library list. */
export const savedWorkoutListSchema = z.object({
  savedWorkouts: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      editedAt: z.string(),
      exercises: z.array(z.string()),
      setsCount: z.number().int(),
    }),
  ),
  most: z.number().int(),
});
export type SavedWorkoutList = z.infer<typeof savedWorkoutListSchema>;
