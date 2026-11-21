// After a workout (spec Part 2 §13.6, job 64a-iii): what the server adds to the phone's own summary of a
// workout it has saved, the effort stars given after it, and the cool-down stretches. The phone shows the
// time, the sets and the stretches from what it holds, so they show with no internet; the server works out
// what has value (calories, XP, records) and the meal ideas, which follow the person's diet and day.
import { z } from "zod";
import { xpViewSchema } from "../gamification.js";
import { mealIdeaSchema } from "../nutrition.js";
import { RECORD_KINDS } from "./workoutHistory.js";
import { EXERCISE_MUSCLE_LABELS } from "./words.js";

/** A new record in this workout, with what it was: grams for the heaviest, the estimated one-rep max and most
 *  lifted; reps for most reps; whole seconds for the longest hold. `position` is the set that made it; null for
 *  most lifted, which is the whole workout's. */
export const afterRecordSchema = z.object({
  exercise: z.string(),
  /** The Library's name; null for an exercise the Library never had, which the phone shows by its id word. */
  exerciseName: z.string().nullable(),
  measuredIn: z.enum(["reps", "time"]),
  kind: z.enum(RECORD_KINDS),
  position: z.number().int().nullable(),
  value: z.number().int(),
});
export type AfterRecord = z.infer<typeof afterRecordSchema>;

/** When to eat an idea, counted from the workout: something small soon, then a meal. */
export const afterIdeaSchema = z.object({ when: z.enum(["soon", "meal"]), idea: mealIdeaSchema });
export type AfterIdea = z.infer<typeof afterIdeaSchema>;

/** GET /v1/training/workouts/:id/summary: the person's own workout only. */
export const workoutAfterSchema = z.object({
  workoutId: z.uuid(),
  /** The calories the save worked out; an estimate. */
  kcalPoint: z.number().int().nullable(),
  /** The person's weight they are worked out at; null where none is given (the server then uses 70 kg). */
  weightKg: z.number().nullable(),
  /** The stars as the server holds them; null for none. */
  effort: z.number().int().min(1).max(5).nullable(),
  xp: z.object({
    /** What this workout earned: `forWorkout` and `forStreak` together. */
    earned: z.number().int(),
    forWorkout: z.number().int(),
    /** The day's first workout keeping the streak going; 0 otherwise. */
    forStreak: z.number().int(),
    /** The person's level now. */
    view: xpViewSchema,
  }),
  /** Days in a row with a workout or a gym visit, now. */
  streak: z.number().int(),
  records: z.array(afterRecordSchema),
  food: z.object({
    ideas: z.array(afterIdeaSchema),
    /** The allergy warning every idea is shown with: a summary without one is never read, so no idea is drawn bare. */
    caution: z.string().trim().min(1),
    labelCaution: z.string().trim().min(1).nullable(),
  }),
});
export type WorkoutAfter = z.infer<typeof workoutAfterSchema>;

/** PUT /v1/training/workouts/:id/effort: how hard it was, 1 (too easy) to 5 (very hard). */
export const workoutEffortSchema = z.object({ effort: z.number().int().min(1).max(5) }).strict();
export type WorkoutEffort = z.infer<typeof workoutEffortSchema>;
/** Its answer: the stars the workout now holds. */
export const workoutEffortGivenSchema = z.object({ workoutId: z.uuid(), effort: z.number().int().min(1).max(5) });

/** The stars' words, 1 to 5. */
export const EFFORT_WORDS = ["Too easy", "Easy", "Just right", "Challenging", "Very hard"] as const;

/** A cool-down stretch and how long to hold it. */
export interface Stretch {
  name: string;
  howLong: string;
}

// The stretches and their words are the old summary's, ported (RULINGS 2026-08-06, kept by spec §13); what
// picks them now reads the Library's muscles by their plain names, the same words the old rules matched.
const RULES: readonly { names: readonly string[]; stretch: Stretch }[] = [
  { names: ["Quadriceps", "Glutes"], stretch: { name: "Hip flexor stretch", howLong: "30 seconds each side" } },
  { names: ["Chest", "Shoulders"], stretch: { name: "Chest doorway stretch", howLong: "30 seconds" } },
  { names: ["Hamstrings"], stretch: { name: "Seated hamstring stretch", howLong: "45 seconds" } },
  { names: ["Abs", "Obliques"], stretch: { name: "Cat-cow stretch", howLong: "10 reps" } },
];
const WHOLE_BODY: readonly Stretch[] = [
  { name: "Full body stretch", howLong: "5 minutes" },
  { name: "Child's pose", howLong: "30 seconds" },
  { name: "Neck rolls", howLong: "10 each direction" },
];

const PLAIN = new Map<string, string>(Object.entries(EXERCISE_MUSCLE_LABELS).map(([id, label]) => [id, label.name]));

/** The stretches after a workout, from the main muscles of its exercises, in the rules' order; the whole-body
 *  three where no rule matches. A muscle word the phone does not know is passed over. */
export function stretchesFor(mainMuscles: readonly string[]): Stretch[] {
  const names = new Set<string>();
  for (const m of mainMuscles) {
    const name = PLAIN.get(m);
    if (name !== undefined) names.add(name);
  }
  const out = RULES.filter((r) => r.names.some((n) => names.has(n))).map((r) => r.stretch);
  return out.length === 0 ? [...WHOLE_BODY] : out;
}


/** The stars given on the phone, waiting there until the server has them. Each press is its own, under its own id,
 *  and they are sent in the order pressed, so the last one pressed is the one the server keeps. */
export const waitingEffortSchema = z
  .object({ id: z.string().min(1).max(120), workoutId: z.uuid(), effort: z.number().int().min(1).max(5) })
  .strict();
export type WaitingEffort = z.infer<typeof waitingEffortSchema>;
