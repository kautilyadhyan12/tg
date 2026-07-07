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

// SetSummary — at set end; THE only thing that leaves the device (§2.4,
// byte-compatible with v1 §5.3; Part 4 §3.5 stores these fields per set).
export const setSummarySchema = z
  .object({
    exercise: z.string(), // exercise slug
    setIndex: z.number().int().positive(),
    reps: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    avgFormScore: z.number().int().min(0).max(100).nullable(), // null: no scored reps (e.g. timer tracking)
    repScores: z.array(z.number().int().min(0).max(100)),
    faultCounts: z.record(z.string(), z.number().int().positive()),
    tempoMsAvg: z.number().int().nonnegative().nullable(),
    romStats: z.record(z.string(), z.number()).nullable(),
    view: viewSchema,
    holdMs: z.number().int().nonnegative().nullable(), // isometrics: qualifying hold time
    calibration: z.record(z.string(), z.unknown()).nullable(),
    engineVersion: z.string(),
    definitionVersion: z.number().int().positive(),
  })
  .strict();
export type SetSummary = z.infer<typeof setSummarySchema>;
