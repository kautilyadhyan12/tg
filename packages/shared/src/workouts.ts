// P2.3 — workout history contracts (v1 §6.1 workouts: "history, PRs";
// Part 4 §3.5 columns). List = keyset cursor on (started_at, id) DESC.
import { z } from "zod";
import { setModeSchema } from "./events.js";

export const workoutListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    /** `<startedAt ISO>|<workout uuid>` from the previous page's nextCursor. */
    cursor: z.string().max(120).optional(),
    /** HALF-OPEN window on `started_at`: `from` inclusive, `to` exclusive.
     *
     *  Added because a cursor list with no date filter forces a client that
     *  wants ONE MONTH to page backwards from today until it arrives — and a
     *  capped walk gives up, drawing an EMPTY month for anyone whose history is
     *  deeper than the cap. That is not hypothetical: 1,000 workouts is four
     *  sessions a week for five years (Kd, 2026-08-04). The meal reader made
     *  the same trade under the same constraint and recorded a server-side date
     *  filter as "the documented upgrade path if history runs deeper"
     *  (DECISIONS 2026-07-19, Card 5d) — this is that path, taken.
     *
     *  ABSOLUTE INSTANTS, not calendar dates, and deliberately so. A calendar
     *  month is local to the VIEWER; the server has no business deciding whose
     *  midnight it is here. The caller converts its own local month boundaries
     *  to instants, which keeps every day boundary exactly where it already
     *  lives (users.timezone server-side for streaks; the viewer's local day
     *  for calendar GROUPING only — DECISIONS 2026-07-21, playbook trap #8).
     *
     *  These NARROW the window; they never widen it. The Part 4 §0.2 plan
     *  read-gate still floors the result (service `clamp`), so a free user
     *  asking for last year gets the same honest empty answer plus
     *  `limitedToDays` — asking for a range is not a way around the gate. */
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  // An inverted window is a caller BUG, and it returns zero rows — which on a
  // history screen is indistinguishable from "you never trained". This card
  // exists because that exact confusion reached a user, so it is a 400 rather
  // than a silently empty page.
  // Compared as INSTANTS, never as strings: `offset: true` admits
  // `…T00:00:00+05:30`, which sorts after `…T00:00:00Z` lexically while being
  // five and a half hours EARLIER.
  .refine((q) => q.from === undefined || q.to === undefined || Date.parse(q.from) < Date.parse(q.to), {
    message: "`to` must be later than `from`",
    path: ["to"],
  });
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
