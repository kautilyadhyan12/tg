import { describe, expect, it } from "vitest";
import type { RunExercise, WorkoutRun } from "@app/shared";
import { press, startRun, type Press } from "../src/library/workoutRun";
import { SOUND_LATE_MS, soundsOf, type WorkoutSound } from "../src/library/workoutSounds";

// The workout's sounds (64a-vi; the browser's four): each row is a workout, presses at seconds from Start, and the
// sounds the LAST press makes. The ones before it only bring the workout to its place.

const T0 = Date.parse("2026-11-23T10:00:00.000Z");
const ID = "33333333-3333-4333-8333-333333333333";
const set = (target: number, rest: number | null): RunExercise["sets"][number] => ({ target, weightGrams: null, restSeconds: rest });
const curl: RunExercise = { exercise: "barbell_curl", name: "Barbell Curl", kind: "strength", measuredIn: "reps", barbell: true, sets: [set(3, 10), set(3, 10)] };
const plank: RunExercise = { exercise: "plank", name: "Plank", kind: "strength", measuredIn: "time", barbell: false, sets: [set(10, 10), set(10, null)] };
const squat: RunExercise = { exercise: "squat", name: "Squat", kind: "strength", measuredIn: "reps", barbell: false, sets: [set(5, null)] };

/** Plays the presses; the sounds of the last one. A tick every 250 ms runs between presses, as the screen's clock does. */
function last(exercises: RunExercise[], presses: [number, Press][], ticking = true): WorkoutSound[] {
  const start = startRun({ workoutId: ID, name: "", now: T0, timeZone: "UTC", exercises });
  if (start === null) throw new Error("no run");
  let run: WorkoutRun = start;
  let heard: WorkoutSound[] = [];
  const at = (ms: number, p: Press) => {
    const out = press(run, p, T0 + ms);
    heard = soundsOf(run, out.kind === "gone" ? null : out.run, p, T0 + ms);
    if (out.kind === "on") run = out.run;
  };
  let t = 0;
  for (const [s, p] of presses) {
    if (ticking) for (; t + 250 < s * 1000; t += 250) at(t + 250, { kind: "tick" });
    t = s * 1000;
    at(t, p);
  }
  return heard;
}

describe("the workout's sounds", () => {
  it.each<[string, RunExercise[], [number, Press][], WorkoutSound[]]>([
    ["+ counts a rep: a tick", [curl], [[1, { kind: "count", by: 1 }]], ["rep"]],
    ["− takes one away: nothing", [curl], [[1, { kind: "count", by: 1 }], [2, { kind: "count", by: -1 }]], []],
    ["the rep that reaches the target ends the set: two beeps, not a tick", [curl], [[1, { kind: "count", by: 1 }], [2, { kind: "count", by: 1 }], [3, { kind: "count", by: 1 }]], ["setEnd"]],
    ["Set done: two beeps", [curl], [[5, { kind: "main" }]], ["setEnd"]],
    ["the rest's third second from the end: a beep", [curl], [[5, { kind: "main" }], [12, { kind: "tick" }]], ["count"]],
    ["the rest's second second from the end: a beep", [curl], [[5, { kind: "main" }], [13, { kind: "tick" }]], ["count"]],
    ["the rest's last second: a beep", [curl], [[5, { kind: "main" }], [14, { kind: "tick" }]], ["count"]],
    ["the rest with more than 3 seconds left: nothing", [curl], [[5, { kind: "main" }], [11.75, { kind: "tick" }]], []],
    ["the rest runs out and the next set starts: go", [curl], [[5, { kind: "main" }], [15, { kind: "tick" }]], ["go"]],
    ["Skip rest: go", [curl], [[5, { kind: "main" }], [6, { kind: "main" }]], ["go"]],
    ["get-ready's last seconds: a beep", [plank], [[8, { kind: "tick" }]], ["count"]],
    ["get-ready runs out: go", [plank], [[10, { kind: "tick" }]], ["go"]],
    ["Start now: go", [plank], [[2, { kind: "main" }]], ["go"]],
    ["a timed set's last seconds: a beep", [plank], [[10, { kind: "tick" }], [18, { kind: "tick" }]], ["count"]],
    ["a timed set runs out: two beeps", [plank], [[10, { kind: "tick" }], [20, { kind: "tick" }]], ["setEnd"]],
    ["the last set of the workout ends: two beeps", [squat], [[5, { kind: "main" }]], ["setEnd"]],
    ["a set ending into the next with no rest: two beeps, no go", [squat, curl], [[5, { kind: "main" }]], ["setEnd"]],
    ["Pause: nothing", [curl], [[1, { kind: "pause" }]], []],
    ["paused, + does nothing and sounds nothing", [curl], [[1, { kind: "pause" }], [2, { kind: "count", by: 1 }]], []],
    ["paused through the rest's end: nothing", [curl], [[5, { kind: "main" }], [6, { kind: "pause" }], [30, { kind: "tick" }]], []],
    ["Resume: nothing", [curl], [[1, { kind: "pause" }], [2, { kind: "resume" }]], []],
    ["coming back to the app: nothing, whatever ended meanwhile", [curl], [[5, { kind: "main" }], [60, { kind: "back" }]], []],
    ["−15 that ends the rest: go", [curl], [[5, { kind: "main" }], [6, { kind: "rest", by: -1 }]], ["go"]],
    ["+15 in a rest: nothing", [curl], [[5, { kind: "main" }], [6, { kind: "rest", by: 1 }]], []],
    ["the target raised: nothing", [curl], [[1, { kind: "target", by: 1 }]], []],
    ["Reset set: nothing", [curl], [[1, { kind: "count", by: 1 }], [2, { kind: "reset" }]], []],
    ["Skip exercise into a set by hand: nothing", [curl, squat], [[1, { kind: "skipExercise" }]], []],
    ["End and save: nothing", [curl], [[5, { kind: "main" }], [6, { kind: "end" }]], []],
  ])("%s", (_name, exercises, presses, sounds) => {
    expect(last(exercises, presses)).toEqual(sounds);
  });

  it("a tick after the app slept (no tick for longer than SOUND_LATE_MS) plays nothing, even where a rest ended", () => {
    expect(SOUND_LATE_MS).toBe(1500);
    expect(last([curl], [[5, { kind: "main" }], [16, { kind: "tick" }]], false)).toEqual([]);
  });

  it("a workout ended with nothing kept plays nothing", () => {
    const run = startRun({ workoutId: ID, name: "", now: T0, timeZone: "UTC", exercises: [curl] });
    if (run === null) throw new Error("no run");
    expect(soundsOf(run, null, { kind: "end" }, T0 + 1000)).toEqual([]);
  });
});
