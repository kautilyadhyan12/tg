// Saving one whole workout from the phone (spec Part 2 §13.5, job 61a): POST /v1/workouts, under the
// id the phone made, which is also its Idempotency-Key. Sent twice it is one workout. A set names its
// exercise by the Library's id word; an exercise the server does not know refuses the whole save
// (`workoutSaveRefusalSchema`), so nothing is dropped in silence.
//
// The phone measures the workout's length with its steady clock (`endedAt` is `startedAt` plus the
// time that passed), so a clock changed during a workout never makes its sets outlast it.
import { z } from "zod";
import { HEART_BPM_LEAST, HEART_BPM_MOST } from "../heartRate.js";
import { instantSchema } from "../time.js";
import { exerciseIdSchema } from "./exerciseFile.js";

/** The limits of what a phone may report. Past them, the save is refused as a broken phone. */
export const WORKOUT_SAVE_LIMITS = {
  setsMost: 200,
  repsMost: 1000,
  /** A set measured in time: four hours. */
  secondsMost: 4 * 3600,
  /** 1,000 kg, in grams: above every lift and every machine's stack. */
  weightGramsMost: 1_000_000,
  restSecondsMost: 3600,
  lengthMostMs: 12 * 3_600_000,
  nameMost: 60,
  /** A heart rate every second for the longest workout. */
  heartMost: 12 * 3600,
  /** How far a set's own times may run past the workout's length, for each set: whole seconds of rest
   *  rounded up. */
  slackMsEachSet: 1000,
} as const;

const L = WORKOUT_SAVE_LIMITS;

/** Words with no NUL character in them: Postgres refuses one in text, and a save it refuses would be
 *  a 500, which a phone sends again for ever. Refused here instead, as a broken phone. */
const noNul = (s: string): boolean => !s.includes("\u0000");
const NUL = { message: "a NUL character" };

export const setCountedSchema = z.enum(["hand", "timer"]);
export type SetCounted = z.infer<typeof setCountedSchema>;

/** One set. `target` and `done` are in the set's own unit: reps, or seconds for a set measured in
 *  time. Weight is in whole grams, shown in the person's kg or lb. */
export const savedSetSchema = z
  .object({
    exercise: exerciseIdSchema,
    /** Its place in the workout, from 0: every place once. */
    position: z.number().int().min(0).max(L.setsMost - 1),
    measuredIn: z.enum(["reps", "time"]),
    target: z.number().int().min(1).max(L.secondsMost),
    done: z.number().int().min(0).max(L.secondsMost),
    weightGrams: z.number().int().min(1).max(L.weightGramsMost).nullable(),
    /** The rest taken after this set; null when there was none (the last set, or a rest skipped). */
    restSeconds: z.number().int().min(0).max(L.restSecondsMost).nullable(),
    /** How long the set itself lasted. */
    durationMs: z.number().int().min(0).max(L.lengthMostMs),
    counted: setCountedSchema,
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.measuredIn === "reps") {
      for (const field of ["target", "done"] as const) {
        if (s[field] > L.repsMost) ctx.addIssue({ code: "custom", message: `reps above ${String(L.repsMost)}`, path: [field] });
      }
    }
    // A set's time cannot be more than the set lasted (a second of rounding allowed).
    if (s.measuredIn === "time" && s.done * 1000 > s.durationMs + 1000) {
      ctx.addIssue({ code: "custom", message: "time done longer than the set", path: ["done"] });
    }
  });
export type SavedSet = z.infer<typeof savedSetSchema>;

/** The heart rate from a connected monitor: [ms into the workout, beats a minute]. */
const workoutHeartSchema = z
  .array(z.tuple([z.number().int().min(0).max(L.lengthMostMs), z.number().int().min(HEART_BPM_LEAST).max(HEART_BPM_MOST)]))
  .max(L.heartMost);

export const workoutSaveSchema = z
  .object({
    workoutId: z.uuid(),
    /** The workout's name; null for one with none. */
    name: z.string().trim().min(1).max(L.nameMost).refine(noNul, NUL).nullable(),
    startedAt: instantSchema,
    endedAt: instantSchema,
    /** The person's time zone during it, as the phone names it. One the server cannot use is kept as none. */
    timeZone: z.string().min(1).max(64).refine(noNul, NUL),
    /** What it was started from: the person's saved workout, the app's plan, the gym's plan, or nothing. */
    startedFrom: z.enum(["saved", "app_plan", "gym_plan", "none"]),
    /** The effort stars, 1 to 5; null when none was given. */
    effort: z.number().int().min(1).max(5).nullable(),
    heart: workoutHeartSchema,
    platform: z.enum(["android", "ios"]),
    /** The app's own version, as the phone reports it. */
    appVersion: z.string().min(1).max(40).refine(noNul, NUL),
    sets: z.array(savedSetSchema).min(1).max(L.setsMost),
  })
  .strict()
  .superRefine((w, ctx) => {
    const lengthMs = Date.parse(w.endedAt) - Date.parse(w.startedAt);
    if (!(lengthMs >= 0 && lengthMs <= L.lengthMostMs)) {
      ctx.addIssue({ code: "custom", message: "the workout ends before it starts, or lasts longer than 12 hours", path: ["endedAt"] });
      return;
    }
    const places = new Set(w.sets.map((s) => s.position));
    if (places.size !== w.sets.length || w.sets.some((s) => s.position >= w.sets.length)) {
      ctx.addIssue({ code: "custom", message: "each place in the workout once, from 0", path: ["sets"] });
    }
    const usedMs = w.sets.reduce((sum, s) => sum + s.durationMs + (s.restSeconds ?? 0) * 1000, 0);
    if (usedMs > lengthMs + L.slackMsEachSet * w.sets.length) {
      ctx.addIssue({ code: "custom", message: "the sets and rests last longer than the workout", path: ["sets"] });
    }
    if (w.heart.some(([at]) => at > lengthMs)) {
      ctx.addIssue({ code: "custom", message: "a heart rate after the workout ended", path: ["heart"] });
    }
  });
export type WorkoutSave = z.infer<typeof workoutSaveSchema>;

/** The answer to a save: 201 created, or 200 when this workout was saved already. */
export const workoutSavedSchema = z.object({ workoutId: z.uuid(), status: z.enum(["created", "duplicate"]) });
export type WorkoutSaved = z.infer<typeof workoutSavedSchema>;

/** The 400 for a workout that ends more than five minutes past the server's clock: a phone whose clock runs fast.
 *  Its own word, so the phone keeps the workout and sends it again once the server's clock has passed its end,
 *  never refusing it for good. */
export const WORKOUT_NOT_ENDED = "not_ended_yet";

/** The answer when the server does not know an exercise (422): their id words. The phone keeps the
 *  workout, reads the Library again and sends it again. */
export const workoutSaveRefusalSchema = z.object({
  error: z.literal("unknown_exercise"),
  exercises: z.array(z.string()).min(1),
  requestId: z.string(),
});
export type WorkoutSaveRefusal = z.infer<typeof workoutSaveRefusalSchema>;
