import { WORKOUT_SAVE_LIMITS } from "@app/shared";
import type { Units } from "../library/records";
import { stepTime, stepWeight } from "../library/workoutSetup";

// "Try the camera" (ROADMAP Stage 5 53a): one set with the camera, on a folder's copy, before the workout carries the
// camera itself (job 64b). The set's own steps, pure: the camera's count, the person's own changes to it, the target and
// the weight, as the workout's set by hand has them (64a-ii, the same steps of a weight and a time).

export interface TrySet {
  readonly measuredIn: "reps" | "time";
  /** Reps, or seconds. */
  readonly target: number;
  readonly weightGrams: number | null;
  /** Reps the camera counted for the set, and a hold's time held. */
  readonly cameraReps: number;
  readonly heldMs: number;
  /** The camera's own count and time held when it last said, whatever the set took of them. */
  readonly cameraLast: { readonly reps: number; readonly heldMs: number };
  /** The person's own changes to the count: what is shown is the camera's count with them. */
  readonly byHand: number;
  readonly paused: boolean;
  /** The camera stopped: the set goes on by hand. */
  readonly stopped: boolean;
  readonly done: boolean;
}

export type TryPress =
  | { kind: "camera"; reps: number; heldMs: number }
  | { kind: "count"; by: 1 | -1 }
  | { kind: "target"; by: 1 | -1 }
  | { kind: "weight"; by: 1 | -1; units: Units }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "reset" }
  | { kind: "stopped" }
  | { kind: "done" };

export const startTry = (measuredIn: "reps" | "time", target: number): TrySet => ({
  measuredIn,
  target,
  weightGrams: null,
  cameraReps: 0,
  heldMs: 0,
  cameraLast: { reps: 0, heldMs: 0 },
  byHand: 0,
  paused: false,
  stopped: false,
  done: false,
});

/** The count shown: the camera's with the person's own changes, never below 0. */
export const shownReps = (s: TrySet): number => Math.max(0, Math.min(WORKOUT_SAVE_LIMITS.repsMost, s.cameraReps + s.byHand));

/** The set has reached its target. */
const reached = (s: TrySet): boolean => (s.measuredIn === "time" ? s.heldMs >= s.target * 1000 : shownReps(s) >= s.target);

export function pressTry(s: TrySet, p: TryPress): TrySet {
  if (s.done) return s;
  const next = ((): TrySet => {
    switch (p.kind) {
      case "camera": {
        // What the camera counted since it last said; while paused nothing it sees is the set's.
        const reps = Math.max(0, p.reps - s.cameraLast.reps);
        const held = Math.max(0, p.heldMs - s.cameraLast.heldMs);
        const last = { reps: Math.max(s.cameraLast.reps, p.reps), heldMs: Math.max(s.cameraLast.heldMs, p.heldMs) };
        if (s.paused) return { ...s, cameraLast: last };
        return { ...s, cameraLast: last, cameraReps: s.cameraReps + reps, heldMs: s.heldMs + held };
      }
      case "count":
        if (s.measuredIn === "time") return s;
        return { ...s, byHand: shownReps(s) + p.by < 0 ? s.byHand : s.byHand + p.by };
      case "target": {
        const target = s.measuredIn === "time" ? stepTime(s.target, p.by) : Math.max(1, Math.min(WORKOUT_SAVE_LIMITS.repsMost, s.target + p.by));
        return { ...s, target };
      }
      case "weight":
        return { ...s, weightGrams: stepWeight(s.weightGrams, p.by, p.units, false) };
      case "pause":
        return { ...s, paused: true };
      case "resume":
        return { ...s, paused: false };
      case "reset":
        return { ...s, byHand: -s.cameraReps };
      case "stopped":
        return { ...s, stopped: true };
      case "done":
        return { ...s, done: true };
    }
  })();
  return !next.done && reached(next) ? { ...next, done: true } : next;
}
