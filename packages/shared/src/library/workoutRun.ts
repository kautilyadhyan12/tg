// A workout being done on the phone (spec Part 2 §13.6, job 64a-ii), and the finished ones waiting for the
// server. Both are files of the phone's own, read back through these shapes: a workout in progress is written
// at every step, so a closed app or a dead battery loses nothing, and a finished one waits on the phone until
// the server has it (`workoutSaveSchema`, sent under its own id, so sent twice it is one workout).
import { z } from "zod";
import { instantSchema } from "../time.js";
import { exerciseIdSchema } from "./exerciseFile.js";
import { plannedSetSchema } from "./plannedWorkout.js";
import { savedSetSchema, WORKOUT_SAVE_LIMITS } from "./workoutSave.js";

const W = WORKOUT_SAVE_LIMITS;

/** Sets of one exercise in a workout being done, as My Workout sets them up. */
export const RUN_SETS_MOST = 10;
export const RUN_EXERCISES_MOST = 50;

/** One exercise of the workout, as it was when Start workout was pressed: the screen needs nothing else, so the
 *  workout goes on with no internet and whatever the Library says meanwhile. */
export const runExerciseSchema = z
  .object({
    exercise: exerciseIdSchema,
    name: z.string().min(1).max(120),
    /** Its kind, for its picture until each exercise has its own (job 62). */
    kind: z.string().min(1).max(40),
    measuredIn: z.enum(["reps", "time"]),
    /** A barbell exercise's weight starts at the empty bar. */
    barbell: z.boolean(),
    sets: z.array(plannedSetSchema).min(1).max(RUN_SETS_MOST),
  })
  .strict();
export type RunExercise = z.infer<typeof runExerciseSchema>;

const ms = z.number().int().min(0).max(W.lengthMostMs * 4);

/** The workout in progress. Its clocks are milliseconds of the workout itself: `totalMs` everything since it
 *  started, `activeMs` the same less every pause, each moved on by the time that passed, never back. A phase
 *  starts at `phaseAt` on the active clock; a rest or a get-ready ends at `phaseEndsAt`, a set measured in time
 *  at its target. `seenAt` is the phone's clock when it was last moved on. */
export const workoutRunSchema = z
  .object({
    v: z.literal(1),
    workoutId: z.uuid(),
    name: z.string().max(W.nameMost),
    startedAt: instantSchema,
    timeZone: z.string().min(1).max(64),
    exercises: z.array(runExerciseSchema).min(1).max(RUN_EXERCISES_MOST),
    ex: z.number().int().min(0).max(RUN_EXERCISES_MOST - 1),
    set: z.number().int().min(0).max(RUN_SETS_MOST - 1),
    phase: z.enum(["ready", "set", "rest", "done"]),
    phaseAt: ms,
    phaseEndsAt: ms.nullable(),
    count: z.number().int().min(0).max(W.repsMost),
    paused: z.boolean(),
    totalMs: ms,
    activeMs: ms,
    seenAt: z.number().int().min(0),
    done: z.array(savedSetSchema).max(W.setsMost),
  })
  .strict()
  .refine((r) => r.ex < r.exercises.length && r.set < (r.exercises[r.ex]?.sets.length ?? 0), { message: "where the workout is", path: ["set"] })
  .refine((r) => r.activeMs <= r.totalMs, { message: "active time within the whole", path: ["activeMs"] });
export type WorkoutRun = z.infer<typeof workoutRunSchema>;

/** A workout the server would not take (a broken phone's, or an id it does not hold for this person): said on
 *  the phone until the person presses OK. */
export const refusedWorkoutSchema = z
  .object({
    workoutId: z.uuid(),
    name: z.string().max(W.nameMost).nullable(),
    endedAt: instantSchema,
    message: z.string().min(1).max(500),
  })
  .strict();
export type RefusedWorkout = z.infer<typeof refusedWorkoutSchema>;

/** The frame of a file of things waiting for the server: each thing in it is read on its own, so one that cannot
 *  be read never loses the rest. */
export const waitingFileSchema = z.object({
  version: z.literal(1),
  waiting: z.array(z.unknown()),
  refused: z.array(z.unknown()),
});
