// P2.3 — workout history contracts (v1 §6.1 workouts: "history, PRs";
// Part 4 §3.5 columns). List = keyset cursor on (started_at, id) DESC.
import { z } from "zod";
import { setModeSchema } from "./events.js";
import { instantSchema } from "./time.js";

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
    from: instantSchema.optional(),
    to: instantSchema.optional(),
  })
  .strict()
  // An inverted window is a caller BUG, and it returns zero rows — which on a
  // history screen is indistinguishable from "you never trained". This card
  // exists because that exact confusion reached a user, so it is a 400 rather
  // than a silently empty page.
  // Compared as INSTANTS, never as strings: an offset admits
  // `…T00:00:00+05:30`, which sorts after `…T00:00:00Z` lexically while being
  // five and a half hours EARLIER.
  //
  // NOTE FOR ANYONE READING THIS AS A SAFETY NET: it is not one. It only runs
  // when BOTH bounds are present, so it can never be the place a single bad
  // bound is caught — the T3 on `b80bd3c` found exactly that, a one-bound
  // request reaching the DB layer and 500ing there while the two-bound request
  // was politely refused. Each bound is now proven parseable by
  // `instantSchema` on its own; this only orders two already-valid instants.
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
  /** Part 4 §0.2 history read-gate (P2.4 GAP-4): the PLAN'S history limit in
   *  days — **whether or not it bound this particular request** — and null when
   *  the plan is UNLIMITED.
   *
   *  Reworded 2026-08-04 (T3 on `b80bd3c`, F4). The old wording said "results
   *  were clamped to this many days", which the date window made false: ask for
   *  a `from` NEWER than the gate and nothing is clamped, yet the field still
   *  reports 90. **The field's meaning is not changing to match** — DECISIONS
   *  2026-07-11 (P2.4 GAP-4) fixes `null = unlimited`, so returning null when a
   *  request happened not to be clamped would tell a free user their plan has
   *  no limit. That is the more dangerous of the two lies, and it is the one a
   *  reader cannot recover from. The comment was the thing that was wrong.
   *
   *  For a reader: this answers "what does my plan allow", not "was this
   *  response cut short". The calendar's `monthClamp` already treats it that
   *  way — it compares the plan window against the month on screen, which is a
   *  plan question and not a request question. */
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

// ── the post-workout summary (GET /v1/workouts/:id/summary) ──────────────────
//
// The new-API home for the screen shown straight after a workout. It replaces
// the old backend's `GET /workouts/:id/summary`, whose payload was snake_case;
// this one is camelCase and the web renames at the reader (the nutrition-targets
// precedent, DECISIONS 2026-07-11 — "the API speaks camelCase").
//
// EVERY FIELD IS SERVER-COMPUTED (R3.1). The client sends nothing that decides
// XP, records, calories or form — it renders what it is given. That is the whole
// reason this endpoint exists rather than the page assembling it from three
// other reads: two surfaces computing one number is how they come to disagree.

export const mealSuggestionSchema = z.object({ meal: z.string(), timing: z.string() });
export type MealSuggestion = z.infer<typeof mealSuggestionSchema>;

export const workoutSummarySchema = z.object({
  workoutId: z.string().uuid(),
  startedAt: z.string(),
  /** Time the user was actually mid-set: Σ per-set durationMs, in WHOLE
   *  SECONDS. Seconds and not minutes because a rounded-to-minutes duration is
   *  what printed a 9-second workout as "0m" on the calendar (DECISIONS :4182);
   *  the unit a duration is carried in should not change on its way to a label.
   *
   *  **CLAMPED to `durationSeconds` when both are known** (2026-08-07): a part
   *  cannot exceed its whole, and a client stopwatch that counted paused time
   *  made it do exactly that on screen. The bound is a definition, not an
   *  estimate — time inside sets is a subset of time in the session. */
  activeSeconds: z.number().int().nullable(),
  /** `workouts.duration_ms` in WHOLE SECONDS.
   *
   *  **TODAY THIS IS THE SAME NUMBER AS `activeSeconds`, and callers must not
   *  present the two as a contrast.** The first version of this comment said
   *  "the whole session, wall clock" — FALSE, and it is the reason the summary
   *  screen printed "31s" above "1 min total" with a tooltip explaining the
   *  difference: `repo.syncWorkout` derives `duration_ms` as
   *  `sets.reduce((a, s) => a + s.durationMs, 0)`, i.e. the identical sum.
   *  Verified against the live DB before this wording was changed: 12 of 12
   *  workouts had `duration_ms` exactly equal to the sum of their sets.
   *
   *  **The wall-clock session time is not stored anywhere in the new API.** The
   *  client measures it (`ActiveWorkout`'s elapsed seconds) and the sync
   *  contract has no field for it; the old backend carried it as
   *  `duration_minutes`. That gap has its own `OWED.md` line. The field stays
   *  because it is the honest name for what IS stored, and because the day a
   *  real session duration lands it is where it belongs — at which point the two
   *  diverge and every consumer works unchanged. */
  durationSeconds: z.number().int().nullable(),
  /** kcal_point — 2B §2.3 display banding stays the client's job. NULL means
   *  the workout carries no estimate, never 0. */
  caloriesBurned: z.number().int().nullable(),
  /** avg_form_score. NULL = nothing scored this workout (every set log-only),
   *  which the client must render as "not scored" and never as a grade. */
  formAccuracy: z.number().int().nullable(),
  /** DISTINCT exercises in the workout — the count the old screen showed. */
  exercisesCount: z.number().int(),
  currentStreak: z.number().int(),
  currentLevel: z.number().int(),
  currentXp: z.number().int(),
  /** What THIS workout's completion contributed, from the ported XP constants
   *  (badges.py via xp.ts). Server-computed; the 100-XP-per-level curve is
   *  never copied into a client (DECISIONS :1110). */
  xpEarned: z.number().int(),
  /** Display strings, already chosen server-side — empty array means "no record
   *  set", which is a fact, not a failed read. */
  personalRecords: z.array(z.string()),
  mealSuggestions: z.array(mealSuggestionSchema),
  stretches: z.array(z.string()),
});
export type WorkoutSummary = z.infer<typeof workoutSummarySchema>;
