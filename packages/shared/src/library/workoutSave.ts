// Saving one whole workout from the phone (spec Part 2 §13.5, job 61a): POST /v1/workouts, under the
// id the phone made, which is also its Idempotency-Key. Sent twice it is one workout. A set names its
// exercise by the Library's id word; an exercise the server does not know refuses the whole save
// (`workoutSaveRefusalSchema`), so nothing is dropped in silence.
//
// The phone measures the workout's length with its steady clock (`endedAt` is `startedAt` plus the
// time that passed), so a clock changed during a workout never makes its sets outlast it. It sends the
// time trained beside it (`trainedMs`, job 64a-ii-b): the length less every pause, which is what the
// workout counts as (Hours Trained, the minutes challenges, goals, the gym's numbers).
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
  /** Each counted rep's form score, in all the camera sets of one workout (job 64b-i): 200 sets of 50 reps. A phone keeps
   *  to it (job 64b-ii), so the biggest save stays inside the route's body and list limits. */
  repScoresMost: 10_000,
  /** A set's mistakes seen made, and its movement's count readings: more than any exercise file has (the squat has 12
   *  mistakes and 2 count rules). */
  faultsMost: 32,
  romStatsMost: 8,
  /** The furthest a count rule's reading can be, either way: a reading is degrees or a share of a body length. */
  romStatMost: 1000,
} as const;

const L = WORKOUT_SAVE_LIMITS;

/** Words with no NUL character in them: Postgres refuses one in text, and a save it refuses would be
 *  a 500, which a phone sends again for ever. Refused here instead, as a broken phone. */
const noNul = (s: string): boolean => !s.includes("\u0000");
const NUL = { message: "a NUL character" };

/** How a set was counted: by the person, by a timer, or by the camera (job 64b-i). A set done with Follow along is the
 *  person's own count or a timer's, never the camera's: the camera was off. */
export const setCountedSchema = z.enum(["hand", "timer", "camera"]);
export type SetCounted = z.infer<typeof setCountedSchema>;

/** A mistake's id word, as an exercise's camera file names it (`movementDefinition.ts`'s own rule). */
const mistakeIdSchema = z
  .string()
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/);
/** A movement's count rule's name ("depth", "knees bent"), as its movement file names it (`movementRuleSchema`). */
const ruleNameSchema = z
  .string()
  .max(60)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ]*$/);
const fewKeys = (most: number) => (r: Record<string, unknown>) => Object.keys(r).length <= most;

/** What the camera judged of a set, where the exercise has a camera file of its own (spec §2.4's set summary, as the
 *  movement engine makes it: `SetRecord.summary`). The set's own fields are not repeated here (its exercise, place, reps,
 *  time and length), and its form score is the server's, worked out from `repScores` (`setFormScore`). */
export const cameraSummarySchema = z
  .object({
    /** The exercise's camera file's version. */
    definitionVersion: z.number().int().min(1).max(2_147_483_647),
    /** Each counted rep's form score where the camera could judge it, in order. */
    repScores: z.array(z.number().int().min(0).max(100)).max(L.repsMost),
    /** For each mistake seen made, in how many reps. */
    faultCounts: z.record(mistakeIdSchema, z.number().int().min(1).max(L.repsMost)).refine(fewKeys(L.faultsMost), { message: `more than ${String(L.faultsMost)} mistakes` }),
    /** How long the camera read the person; the server keeps no more than the set lasted. */
    watchedMs: z.number().int().min(0).max(L.lengthMostMs),
    /** A counted rep's own time, the mean; null with none counted. */
    tempoMsAvg: z.number().int().min(0).max(L.lengthMostMs).nullable(),
    /** Each of the movement's count rules' readings, the mean over the counted reps; null with none counted. */
    romStats: z
      .record(ruleNameSchema, z.number().min(-L.romStatMost).max(L.romStatMost))
      .refine(fewKeys(L.romStatsMost), { message: `more than ${String(L.romStatsMost)} readings` })
      .nullable(),
    /** Where the body stood to the phone at the bottom of the counted reps. */
    view: z.enum(["front", "side", "unknown"]),
  })
  .strict();
export type CameraSummary = z.infer<typeof cameraSummarySchema>;

/** A set counted by the camera (job 64b-i; spec §13.3, §13.5). Numbers and the movement files' own words only: never a
 *  picture, a body point, or anything else of the person's body, and a field the server does not know refuses the whole
 *  save. */
export const cameraSetSchema = z
  .object({
    /** What the camera itself counted, in the set's own unit (reps, or whole seconds held), whatever the person changed
     *  by hand: kept beside the set's `done` for the proof table's numbers after launch (§12.5). */
    done: z.number().int().min(0).max(L.secondsMost),
    /** The person left the camera and counted the rest themselves ("chosen": Count this set myself), or the camera stopped
     *  ("camera_stopped"); null when the camera counted the set to its end. */
    left: z.enum(["chosen", "camera_stopped"]).nullable(),
    /** The movement engine that counted it. */
    engineVersion: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/),
    /** Null for an exercise the camera counts but does not judge yet: no camera file of its own (the squat's twins until
     *  exercise folder 1's job 54 writes theirs). */
    summary: cameraSummarySchema.nullable(),
  })
  .strict();
export type CameraSetFacts = z.infer<typeof cameraSetSchema>;

/** A set's form score: the mean of its reps' scores, rounded; null with none, never a good one. The server's own, as the
 *  movement engine's summary works it out. */
export function setFormScore(repScores: readonly number[]): number | null {
  if (repScores.length === 0) return null;
  return Math.round(repScores.reduce((a, b) => a + b, 0) / repScores.length);
}

/** A workout's form score: the mean of its camera sets' form scores, rounded; null with none (the old save route's own
 *  rule, which XP and the badges read). */
export function workoutFormScore(setScores: readonly (number | null)[]): number | null {
  const scored = setScores.filter((s): s is number => s !== null);
  return scored.length === 0 ? null : Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);
}

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
    /** What the camera made of it: present on a set counted by the camera, and on no other (job 64b-i). Absent from every
     *  set kept on a phone before it. */
    camera: cameraSetSchema.optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.measuredIn === "reps") {
      for (const field of ["target", "done"] as const) {
        if (s[field] > L.repsMost) ctx.addIssue({ code: "custom", message: `reps above ${String(L.repsMost)}`, path: [field] });
      }
    }
    // THE WORST THING HERE: a form score kept for a set no camera watched. The camera's facts go with a camera set alone.
    if ((s.counted === "camera") !== (s.camera !== undefined)) {
      ctx.addIssue({ code: "custom", message: "the camera's facts belong to a set counted by the camera, and to no other", path: ["camera"] });
    }
    if (s.camera !== undefined) {
      if (s.measuredIn === "reps" && s.camera.done > L.repsMost) {
        ctx.addIssue({ code: "custom", message: `reps above ${String(L.repsMost)}`, path: ["camera", "done"] });
      }
      const scores = s.camera.summary?.repScores.length ?? 0;
      // A score for each rep the camera counted, at most; a set measured in time has no reps to score.
      if (scores > (s.measuredIn === "reps" ? s.camera.done : 0)) {
        ctx.addIssue({ code: "custom", message: "more rep scores than reps the camera counted", path: ["camera", "summary", "repScores"] });
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

/** How long a workout's sets and their rests lasted together. */
export function setsAndRestsMs(sets: readonly Pick<SavedSet, "durationMs" | "restSeconds">[]): number {
  return sets.reduce((sum, s) => sum + s.durationMs + (s.restSeconds ?? 0) * 1000, 0);
}

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
    /** The time trained: the workout's length less every pause, as its screen showed it, within the length and
     *  never shorter than its sets and rests. Absent from a workout kept on a phone before job 64a-ii-b: the
     *  server then counts its sets and rests (`trainedMsOf`), never its pauses. */
    trainedMs: z.number().int().min(0).max(L.lengthMostMs).optional(),
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
    const usedMs = setsAndRestsMs(w.sets);
    if (usedMs > lengthMs + L.slackMsEachSet * w.sets.length) {
      ctx.addIssue({ code: "custom", message: "the sets and rests last longer than the workout", path: ["sets"] });
    }
    if (w.trainedMs !== undefined && w.trainedMs > lengthMs) {
      ctx.addIssue({ code: "custom", message: "the time trained is longer than the workout", path: ["trainedMs"] });
    }
    if (w.trainedMs !== undefined && usedMs > w.trainedMs + L.slackMsEachSet * w.sets.length) {
      ctx.addIssue({ code: "custom", message: "the sets and rests last longer than the time trained", path: ["trainedMs"] });
    }
    if (w.heart.some(([at]) => at > lengthMs)) {
      ctx.addIssue({ code: "custom", message: "a heart rate after the workout ended", path: ["heart"] });
    }
    if (repScoresIn(w.sets) > L.repScoresMost) {
      ctx.addIssue({ code: "custom", message: `more than ${String(L.repScoresMost)} rep scores in one workout`, path: ["sets"] });
    }
  });

/** Every rep score a workout's camera sets carry. */
export const repScoresIn = (sets: readonly Pick<SavedSet, "camera">[]): number => sets.reduce((n, s) => n + (s.camera?.summary?.repScores.length ?? 0), 0);
export type WorkoutSave = z.infer<typeof workoutSaveSchema>;

/** What a saved workout counts as trained: the phone's time trained, or, for a workout kept on a phone before it
 *  sent one, its sets and rests within its length. A pause is never counted. */
export function trainedMsOf(w: Pick<WorkoutSave, "startedAt" | "endedAt" | "sets" | "trainedMs">): number {
  if (w.trainedMs !== undefined) return w.trainedMs;
  return Math.min(setsAndRestsMs(w.sets), Math.max(0, Date.parse(w.endedAt) - Date.parse(w.startedAt)));
}

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
