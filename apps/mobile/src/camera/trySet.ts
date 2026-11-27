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
  /** The camera stopped, or the person took the count over: the set goes on by hand, and nothing of the camera's counts. */
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
        // Once the set is counted by hand, the camera's count is not the set's, even a rep judged as the set ends.
        if (s.stopped) return s;
        // What the camera counted since it last said; while paused nothing it sees is the set's.
        const reps = Math.max(0, p.reps - s.cameraLast.reps);
        const held = Math.max(0, p.heldMs - s.cameraLast.heldMs);
        const last = { reps: Math.max(s.cameraLast.reps, p.reps), heldMs: Math.max(s.cameraLast.heldMs, p.heldMs) };
        if (s.paused) return { ...s, cameraLast: last };
        return { ...s, cameraLast: last, cameraReps: s.cameraReps + reps, heldMs: s.heldMs + held };
      }
      case "count": {
        if (s.measuredIn === "time") return s;
        // A press that would take the count past its ends changes nothing, so the next press the other way is felt.
        const shown = shownReps(s) + p.by;
        return shown < 0 || shown > WORKOUT_SAVE_LIMITS.repsMost ? s : { ...s, byHand: s.byHand + p.by };
      }
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
        // The set starts again: its count, its time held and the camera's own, which starts again with it (TryCamera).
        return { ...s, cameraReps: 0, heldMs: 0, cameraLast: { reps: 0, heldMs: 0 }, byHand: 0 };
      case "stopped":
        return { ...s, stopped: true };
      case "done":
        return { ...s, done: true };
    }
  })();
  return !next.done && reached(next) ? { ...next, done: true } : next;
}

/** The set as it ends: the camera's last count taken, a rep it judged only at the end included (`LiveSet.end`). */
export function ended(s: TrySet, cameraReps: number): TrySet {
  return { ...pressTry({ ...s, done: false }, { kind: "camera", reps: cameraReps, heldMs: s.cameraLast.heldMs }), done: true };
}
