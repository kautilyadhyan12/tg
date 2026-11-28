import { cameraSummarySchema, type CameraSummary, type EngineSetSummary } from "@app/shared";
import type { CameraEnd } from "../library/workoutRun";

// The camera in a workout (ROADMAP Stage 5 64b-ii): what a set keeps of the camera's judgement, in the save's own shape
// (spec Part 2 §13.5, "As built in 64b-i"). Pure.

/** The movement engine's set summary (§2.4) as a workout keeps it: the camera's own facts less the set's own fields, checked
 *  whole by the save's schema. Anything it would refuse is no judgement at all: the set then has no form score, never a
 *  refused workout. Null for an exercise with no form rules. */
export function cameraSummaryOf(s: EngineSetSummary | null): CameraSummary | null {
  if (s === null) return null;
  const kept = cameraSummarySchema.safeParse({
    definitionVersion: s.definitionVersion,
    repScores: s.repScores,
    faultCounts: s.faultCounts,
    watchedMs: s.watchedMs ?? 0,
    tempoMsAvg: s.tempoMsAvg,
    romStats: s.romStats,
    view: s.view,
  });
  return kept.success ? kept.data : null;
}

/** What `LiveSet.end` says of a set, as the workout takes it: the camera's count in all, a hold's time (its summary's, where
 *  it has one; the workout keeps the most the camera said), and its judgement. */
export function cameraEndOf(end: { readonly reps: number; readonly summary: EngineSetSummary | null }): CameraEnd {
  return { reps: end.reps, heldMs: end.summary?.holdMs ?? 0, summary: cameraSummaryOf(end.summary) };
}
