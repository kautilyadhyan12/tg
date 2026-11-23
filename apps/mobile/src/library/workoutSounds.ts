import type { WorkoutRun } from "@app/shared";
import { endsAt, type Press } from "./workoutRun";

// The sounds of a workout (ROADMAP Stage 5 64a-vi; spec Part 2 §13.8, the browser's four): a tick for each rep counted
// by +, two beeps when a set ends, a beep at each of the last 3 seconds of a rest, a get-ready or a set measured in time,
// and a rising "go" when the next set starts after a rest or a get-ready. Pure: the workout before a press and after it
// give the sounds, so the same presses always sound the same. The player only plays them (`sound/player.ts`).

export type WorkoutSound = "rep" | "setEnd" | "count" | "go";

/** A tick that moved the clocks on by more than this played nothing: the app was asleep, and a burst of old beeps
 *  would say nothing true about now. */
export const SOUND_LATE_MS = 1500;
const COUNT_FROM_S = 3;

/** What a press sounds: `after` is the workout it left, null when it ended with nothing to keep. None while paused,
 *  for Pause and Resume, or for the app opened again. */
export function soundsOf(before: WorkoutRun, after: WorkoutRun | null, p: Press, now: number): WorkoutSound[] {
  if (after === null || before.paused || p.kind === "back" || p.kind === "pause" || p.kind === "resume") return [];
  if (p.kind === "tick" && now - before.seenAt > SOUND_LATE_MS) return [];
  if (after.done.length > before.done.length) return ["setEnd"];
  if ((before.phase === "rest" || before.phase === "ready") && after.phase === "set") return ["go"];
  if (p.kind === "count" && p.by === 1 && after.count > before.count) return ["rep"];
  if (p.kind === "tick" && after.phase === before.phase && after.phaseAt === before.phaseAt && after.ex === before.ex && after.set === before.set) {
    const end = endsAt(before);
    const endAfter = endsAt(after);
    if (end === null || endAfter === null) return [];
    const leftBefore = end - before.activeMs;
    const leftAfter = endAfter - after.activeMs;
    for (let s = COUNT_FROM_S; s >= 1; s--) {
      if (leftBefore > s * 1000 && leftAfter <= s * 1000) return ["count"];
    }
  }
  return [];
}
