// A workout being done on the phone (spec Part 2 §13.6, job 64a-ii), and the finished ones waiting for the
// server. Both are files of the phone's own, read back through these shapes: a workout in progress is written
// at every step, so a closed app or a dead battery loses nothing, and a finished one waits on the phone until
// the server has it (`workoutSaveSchema`, sent under its own id, so sent twice it is one workout).
import { z } from "zod";
import { HEART_BPM_LEAST, HEART_BPM_MOST } from "../heartRate.js";
import { instantSchema } from "../time.js";
import { exerciseIdSchema } from "./exerciseFile.js";
import { plannedSetSchema } from "./plannedWorkout.js";
import { cameraSummarySchema, savedSetSchema, WORKOUT_SAVE_LIMITS } from "./workoutSave.js";

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
    /** The camera counts it on this phone (job 64b-ii): offered each time the exercise starts. Absent: by hand, as every
     *  exercise of a workout kept before it. */
    camera: z.literal(true).optional(),
  })
  .strict();
export type RunExercise = z.infer<typeof runExerciseSchema>;

const ms = z.number().int().min(0).max(W.lengthMostMs * 4);

/** The set being counted by the camera (job 64b-ii): what the set took of the camera's count, the camera's own count when
 *  it last said, and, once the person left it or it stopped, why and what it had judged by then. Numbers and the movement
 *  files' own words only, as the save's (`cameraSummarySchema`): nothing of the body. */
export const runCameraSchema = z
  .object({
    /** Reps the camera counted that the set took (none while paused). */
    done: z.number().int().min(0).max(W.repsMost),
    /** A hold's time the set took of the camera's, ms. */
    heldMs: z.number().int().min(0).max(W.secondsMost * 1000),
    /** The camera's own count and time held when it last said, whatever the set took. */
    seenReps: z.number().int().min(0).max(W.repsMost),
    seenHeldMs: z.number().int().min(0).max(W.secondsMost * 1000),
    /** "chosen": Count this set myself; "camera_stopped": the camera or its model stopped; null while it counts. */
    left: z.enum(["chosen", "camera_stopped"]).nullable(),
    /** What the camera judged of the set, once it ended or was left; null before, and for an exercise with no form rules. */
    summary: cameraSummarySchema.nullable(),
    /** The workout's whole clock when this camera set began: a new one each time it begins again. */
    at: ms,
  })
  .strict();
export type RunCamera = z.infer<typeof runCameraSchema>;
/** When a rest or a get-ready ends: up to an hour's rest past the longest clock (round one, H2). */
const endsMs = z.number().int().min(0).max(W.lengthMostMs * 4 + W.restSecondsMost * 1000 + 10_000);

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
    phaseEndsAt: endsMs.nullable(),
    count: z.number().int().min(0).max(W.repsMost),
    paused: z.boolean(),
    totalMs: ms,
    activeMs: ms,
    seenAt: z.number().int().min(0),
    done: z.array(savedSetSchema).max(W.setsMost),
    /** "saved": started from one of the person's saved workouts (64a-iv); absent for nothing, as a file kept before it. */
    startedFrom: z.literal("saved").optional(),
    /** The heart rate from the person's own monitor (64a-vi): [ms on the workout's whole clock, beats a minute], in order,
     *  one a second at most, kept only while its clocks ran, never past what a save allows. Absent: none, as a file kept
     *  before it. */
    heart: z
      .array(z.tuple([z.number().int().min(0).max(W.lengthMostMs), z.number().int().min(HEART_BPM_LEAST).max(HEART_BPM_MOST)]))
      .max(W.heartMost)
      .optional(),
    /** How the exercise being done is counted (job 64b-ii), asked as it starts where the camera counts it: absent until
     *  answered, and for an exercise the camera does not count. */
    way: z.enum(["camera", "hand"]).optional(),
    /** The set being counted by the camera; absent for every other set. */
    cam: runCameraSchema.optional(),
    /** The set being followed with the exercise's clip, the camera off (Follow along); absent otherwise. */
    follow: z.literal(true).optional(),
  })
  .strict()
  .refine((r) => (r.cam === undefined && r.follow === undefined) || r.way === "camera", { message: "a camera set where the camera was chosen", path: ["cam"] })
  .refine((r) => r.cam === undefined || r.follow === undefined, { message: "a set followed has the camera off", path: ["follow"] })
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
