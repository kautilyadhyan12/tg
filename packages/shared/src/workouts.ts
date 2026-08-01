// P2.3 — workout history contracts (v1 §6.1 workouts: "history, PRs";
// Part 4 §3.5 columns). List = keyset cursor on (started_at, id) DESC.
import { z } from "zod";
import { setModeSchema } from "./events.js";

export const workoutListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    /** `<startedAt ISO>|<workout uuid>` from the previous page's nextCursor. */
    cursor: z.string().max(120).optional(),
  })
  .strict();
export type WorkoutListQuery = z.infer<typeof workoutListQuerySchema>;

export const workoutListItemSchema = z.object({
  id: z.string().uuid(),
  startedAt: z.string(),
  platform: z.enum(["web", "android", "ios"]),
  setsCount: z.number().int(),
  totalReps: z.number().int(),
  avgFormScore: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  kcalPoint: z.number().int().nullable(), // 2B §2.3: display banding is the client's job
  kcalCalcVersion: z.number().int().nullable(),
  qualityFlags: z.array(z.string()),
});
export type WorkoutListItem = z.infer<typeof workoutListItemSchema>;

export const workoutPageSchema = z.object({
  items: z.array(workoutListItemSchema),
  nextCursor: z.string().nullable(),
  /** Part 4 §0.2 history read-gate (P2.4 GAP-4): non-null = results were
   *  clamped to this many days by the caller's plan; null = unlimited. */
  limitedToDays: z.number().int().nullable(),
});
export type WorkoutPage = z.infer<typeof workoutPageSchema>;

export const workoutSetViewSchema = z.object({
  setIndex: z.number().int(),
  exerciseSlug: z.string(),
  view: z.string().nullable(),
  reps: z.number().int(),
  holdMs: z.number().int().nullable(),
  durationMs: z.number().int(),
  avgFormScore: z.number().int().nullable(),
  repScores: z.array(z.number().int()).nullable(),
  faultCounts: z.record(z.string(), z.number().int()),
  tempoMsAvg: z.number().int().nullable(),
  romStats: z.record(z.string(), z.number()).nullable(),
  /** 'engine' | 'log_only', or NULL for a set stored before migration 0009 —
   *  unknown, and deliberately not back-claimed as either. A reader must show
   *  the distinction rather than assume: a log-only set is a number the user
   *  typed, not a measurement. */
  mode: setModeSchema.nullable(),
  // Nullable as of the log-only card: a set the engine never ran on has no
  // engine version and no definition version. A reader must not print a
  // placeholder here — there was no engine.
  engineVersion: z.string().nullable(),
  definitionVersion: z.number().int().nullable(),
});
export type WorkoutSetView = z.infer<typeof workoutSetViewSchema>;

export const workoutDetailSchema = workoutListItemSchema.extend({
  engineVersion: z.string(),
  bundleVersion: z.number().int().nullable(),
  sets: z.array(workoutSetViewSchema),
});
export type WorkoutDetail = z.infer<typeof workoutDetailSchema>;
