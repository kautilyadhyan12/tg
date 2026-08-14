// Part 2 §2.4 — engine outputs: three event levels plus one document.
import { z } from "zod";

// View classification (§3.3) as emitted in events; 'unknown' before classification.
export const viewSchema = z.enum(["front", "side", "unknown"]);
export type View = z.infer<typeof viewSchema>;

export const calibrationStateSchema = z.enum(["pending", "ready"]);

// FrameResult — every analyzed frame; feeds the overlay and live UI.
export const frameResultSchema = z
  .object({
    phase: z.string(), // FSM phase id from the definition (§3.6)
    repCount: z.number().int().nonnegative(),
    isActive: z.boolean(),
    view: viewSchema,
    visibilityOk: z.boolean(),
    liveCue: z.string().nullable(), // message KEY (App A), not display text
    signals: z.record(z.string(), z.number()), // the small set the definition declares
    calibrationState: calibrationStateSchema,
  })
  .strict();
export type FrameResult = z.infer<typeof frameResultSchema>;

// RepEvent — at the moment a rep is credited.
export const repEventSchema = z
  .object({
    repIndex: z.number().int().positive(),
    score: z.number().int().min(0).max(100),
    faults: z.array(z.string()), // fault ids observed in that rep cycle
    durationMs: z.number().nonnegative(),
    phaseTimings: z.record(z.string(), z.number().nonnegative()), // ms in descent/bottom/ascent
    romExtreme: z.number(), // e.g. min knee angle reached
    view: viewSchema,
  })
  .strict();
export type RepEvent = z.infer<typeof repEventSchema>;

// HoldTick / HoldEvent — isometric family only (§2.4).
export const holdTickSchema = z
  .object({
    qualifyingMs: z.number().nonnegative(), // accumulated qualifying ms
    inBand: z.boolean(),
  })
  .strict();
export type HoldTick = z.infer<typeof holdTickSchema>;

export const holdEventSchema = z
  .object({
    totalQualifyingMs: z.number().nonnegative(),
    longestContiguousMs: z.number().nonnegative(),
    endedAtMs: z.number().nonnegative(), // session-relative, like PoseFrame.t
  })
  .strict();
export type HoldEvent = z.infer<typeof holdEventSchema>;

// Upper bounds = the Part 4 §3.5 column types these fields land in
// (set_index/reps → smallint; duration_ms/hold_ms/tempo_ms_avg/
// definition_version → int4). Values Zod would pass but PG would overflow
// must be a 400 at the boundary, never a 500 in the route (P1.10d T3).
export const SMALLINT_MAX = 32_767;
export const INT4_MAX = 2_147_483_647;

// SetSummary — at set end; THE only thing that leaves the device (§2.4,
// byte-compatible with v1 §5.3; Part 4 §3.5 stores these fields per set).
//
// TWO KINDS OF SET (log-only card, Kd-ruled 2026-08-01). Part 6 §3.6's
// degradation ladder ends in "log-only mode: pose unavailable on this device →
// manual rep counting", and its own user-facing copy promises "your workout
// still counts". Until now only ENGINE sets could be expressed here, and
// DECISIONS 2026-07-10 (P1.10c) therefore refused to sync an all-log-only
// workout — correct while the legacy backend still recorded them, and a
// data-loss hole the moment that backend is switched off, since only 3 of the
// 58 catalog exercises have a definition today.
//
// The split is a UNION rather than a pile of nullable fields, because the two
// kinds have genuinely different obligations: an engine set MUST carry its
// provenance, and a log-only set MUST NOT carry a form claim. A single object
// with everything optional could express neither rule.
const setSummaryBase = z.object({
  exercise: z.string(), // exercise slug
  setIndex: z.number().int().positive().max(SMALLINT_MAX),
  reps: z.number().int().nonnegative().max(SMALLINT_MAX),
  durationMs: z.number().int().nonnegative().max(INT4_MAX),
  tempoMsAvg: z.number().int().nonnegative().max(INT4_MAX).nullable(),
  romStats: z.record(z.string(), z.number()).nullable(),
  view: viewSchema,
  holdMs: z.number().int().nonnegative().max(INT4_MAX).nullable(), // isometrics: qualifying hold time
  calibration: z.record(z.string(), z.unknown()).nullable(),
});

/** A set the engine analysed. `mode` is OPTIONAL here for backward
 *  compatibility: every client shipped before this card omits it, and its
 *  payload already proves the kind by carrying both provenance fields — which
 *  this branch requires. Reading that as 'engine' is reading the data, not
 *  guessing at it. */
export const engineSetSummarySchema = setSummaryBase
  .extend({
    mode: z.literal("engine").optional(),
    /** HOW MUCH OF THIS SET THE CAMERA COULD ACTUALLY WATCH, in ms — the
     *  Kd-ruled payload addition of 2026-08-14, and the thing that lets the
     *  server stop guessing exercise time from `reps × tempoMsAvg`.
     *
     *  §2.4 declares SetSummary's fields and this adds one, so it is a ruled
     *  extension, not an invention (R0.2) — the same shape as the 2026-08-07
     *  `durationSeconds`/`restSeconds` ruling one level out. OPTIONAL is what
     *  keeps Part 2 §10's byte-match gate green BY CONSTRUCTION rather than by
     *  argument: the §2.4 document still parses and still round-trips
     *  unchanged, and every payload queued in an outbox before this card
     *  syncs and prices exactly as it would have.
     *
     *  A CLIENT MEASUREMENT the server cannot observe or re-derive — the v1
     *  §14 nuance to R3.1, same class as the rep count beside it. The server
     *  clamps it to the set's own span before storing (a set cannot be watched
     *  for longer than it lasted) and P4.y plausibility-checks it like
     *  everything else the client reports. Bound: `watched_ms` int4. */
    watchedMs: z.number().int().nonnegative().max(INT4_MAX).optional(),
    avgFormScore: z.number().int().min(0).max(100).nullable(), // null: no scored reps (e.g. timer tracking)
    repScores: z.array(z.number().int().min(0).max(100)),
    faultCounts: z.record(z.string(), z.number().int().positive()),
    // T3 round 1 F6: this was a bare z.string(), so `engineVersion: ""` was
    // accepted alongside `avgFormScore: 100` — verified. That hollowed out the
    // reason absent-`mode` may be read as 'engine' ("its payload already proves
    // the kind by carrying both provenance fields"): an empty string proves
    // nothing. NB this makes the field PRESENT, not TRUE — see setModeSchema.
    engineVersion: z.string().min(1),
    definitionVersion: z.number().int().positive().max(INT4_MAX),
  })
  .strict();

/** A set the user counted themselves. Every scoring field is pinned to its
 *  EMPTY value rather than left optional: the schema is where "nothing measured
 *  this" is enforced, so a client cannot smuggle a form score onto a set nothing
 *  watched. The same three rules are enforced again by a CHECK constraint in
 *  migration 0009 — belt and braces, because this is the one claim the feature
 *  must never be able to make. */
export const logOnlySetSummarySchema = setSummaryBase
  .extend({
    mode: z.literal("log_only"),
    /** Pinned null for the same reason every scoring field here is: nothing
     *  watched a hand-counted set, so "how long did the camera watch" has no
     *  answer but zero, and zero would read as a measurement. `.optional()`
     *  because every client shipped before this card omits the key entirely. */
    watchedMs: z.null().optional(),
    avgFormScore: z.null(),
    // T3 round 1 F5: this was `z.array(z.never()).max(0)`, so the WIRE demanded
    // `[]` while the COLUMN demands NULL, and repo.ts translated between them
    // under a comment calling `[]` a fabrication. The contract now states the
    // same thing the database does, and the translation is gone: one rule, in
    // one place, agreed by both ends.
    repScores: z.null(),
    faultCounts: z.record(z.string(), z.never()).refine((f) => Object.keys(f).length === 0, {
      message: "a log-only set cannot carry faults — nothing analysed it",
    }),
    // Null, never a sentinel: '0' or 'none' in a column meaning "which engine
    // scored this" reads like a real answer. There was no engine.
    engineVersion: z.null(),
    definitionVersion: z.null(),
  })
  .strict();

export const setSummarySchema = z.union([engineSetSummarySchema, logOnlySetSummarySchema]);
export type SetSummary = z.infer<typeof setSummarySchema>;
export type EngineSetSummary = z.infer<typeof engineSetSummarySchema>;
export type LogOnlySetSummary = z.infer<typeof logOnlySetSummarySchema>;

/** The stored kind of a set. `null` in the DB means UNKNOWN — every row written
 *  before migration 0009 predates the distinction and is not back-claimed as
 *  either.
 *
 *  **`mode = 'engine'` IS A CLIENT CLAIM, NOT A VERIFICATION** (T3 round 1 F6).
 *  Nothing server-side checks that the named engine version is real, that the
 *  exercise even HAS a definition, or that the scores came from a run of it —
 *  the pre-existing threat model at OWED:484-496 (XP is entirely
 *  client-determined; sync has no per-route rate limit) is unchanged by this
 *  card. v1 §14's "verified entries only" must NOT read this column as proof;
 *  it narrows the field, and the P4.y plausibility work is what can make it
 *  mean more. Recorded here because this card is what makes the column
 *  queryable, and a queryable column invites exactly that misreading. */
export const setModeSchema = z.enum(["engine", "log_only"]);
export type SetMode = z.infer<typeof setModeSchema>;
