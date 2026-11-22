import { describe, expect, it } from "vitest";
import { workoutRunSchema, workoutSaveSchema, type RunExercise, type WorkoutRun } from "@app/shared";
import { AWAY_MOST_MS, CLOCK_MOST_MS, firstSets, leftOf, press, READY_MS, setsInAll, shownAt, startRun, toSave, type Press } from "../src/library/workoutRun";

// The workout's steps (64a-ii; spec Part 2 §13.6): the same presses in give the same workout out. Each row is a
// workout, a list of presses each at a time in seconds from Start, and what the workout must then be.

const T0 = Date.parse("2026-11-21T10:00:00.000Z");
const ID = "11111111-1111-4111-8111-111111111111";

const reps = (n: number, rest: number | null = 60, kg: number | null = null): RunExercise["sets"][number] => ({ target: n, weightGrams: kg, restSeconds: rest });
const curl: RunExercise = { exercise: "barbell_curl", name: "Barbell Curl", kind: "strength", measuredIn: "reps", barbell: true, sets: [reps(10, 60, 20_000), reps(10, 60, 20_000)] };
const squat: RunExercise = { exercise: "squat", name: "Squat", kind: "strength", measuredIn: "reps", barbell: false, sets: [reps(12, 0)] };
const plank: RunExercise = { exercise: "plank", name: "Plank", kind: "strength", measuredIn: "time", barbell: false, sets: [reps(30, 30), reps(30, 30)] };

function begin(exercises: RunExercise[]): WorkoutRun {
  const run = startRun({ workoutId: ID, name: "Full body", now: T0, timeZone: "Asia/Kolkata", exercises });
  if (run === null) throw new Error("no run");
  return run;
}

/** Presses at seconds from Start; "gone" once the workout ended with nothing kept. */
function play(exercises: RunExercise[], presses: [number, Press][]): WorkoutRun | "gone" {
  let run = begin(exercises);
  for (const [at, p] of presses) {
    const out = press(run, p, T0 + at * 1000);
    if (out.kind === "gone") return "gone";
    run = out.run;
    // Every step is a workout the phone's file can hold.
    expect(workoutRunSchema.safeParse(run).success).toBe(true);
  }
  return run;
}

const sets = (r: WorkoutRun | "gone") => (r === "gone" ? r : r.done.map((s) => [s.exercise, s.done, s.restSeconds, s.durationMs]));
const where = (r: WorkoutRun | "gone") => (r === "gone" ? r : [r.phase, r.ex, r.set]);

describe("the workout's steps", () => {
  it.each<[string, RunExercise[], [number, Press][], unknown, unknown]>([
    ["starts at its first set, counting nothing", [curl], [], ["set", 0, 0], []],
    ["a timed first set gets 10 s to get ready", [plank], [], ["ready", 0, 0], []],
    ["Set done with reps counted keeps them, and its rest starts", [curl], [[2, { kind: "count", by: 1 }], [3, { kind: "count", by: 1 }], [20, { kind: "main" }]], ["rest", 0, 1], [["barbell_curl", 2, null, 20_000]]],
    ["Set done with none counted keeps the target", [curl], [[25, { kind: "main" }]], ["rest", 0, 1], [["barbell_curl", 10, null, 25_000]]],
    ["a minus at none stays at none", [curl], [[1, { kind: "count", by: -1 }], [25, { kind: "main" }]], ["rest", 0, 1], [["barbell_curl", 10, null, 25_000]]],
    ["the set ends by itself at its target", [{ ...curl, sets: [reps(2), reps(2)] }], [[1, { kind: "count", by: 1 }], [2, { kind: "count", by: 1 }]], ["rest", 0, 1], [["barbell_curl", 2, null, 2000]]],
    ["the rest runs out by itself and the next set starts", [curl], [[20, { kind: "main" }], [81, { kind: "tick" }]], ["set", 0, 1], [["barbell_curl", 10, 60, 20_000]]],
    ["Skip rest keeps the rest taken", [curl], [[20, { kind: "main" }], [35, { kind: "main" }]], ["set", 0, 1], [["barbell_curl", 10, 15, 20_000]]],
    ["+15 makes the rest longer", [curl], [[20, { kind: "main" }], [21, { kind: "rest", by: 1 }], [81, { kind: "tick" }]], ["rest", 0, 1], [["barbell_curl", 10, null, 20_000]]],
    ["−15 past the time already rested ends it", [curl], [[20, { kind: "main" }], [60, { kind: "rest", by: -1 }], [61, { kind: "rest", by: -1 }], [62, { kind: "rest", by: -1 }]], ["set", 0, 1], [["barbell_curl", 10, 41, 20_000]]],
    ["the set just done is put right during its rest", [curl], [[20, { kind: "main" }], [21, { kind: "last", by: 1 }], [22, { kind: "last", by: 1 }], [23, { kind: "last", by: -1 }]], ["rest", 0, 1], [["barbell_curl", 11, null, 20_000]]],
    ["Reset set counts again from none and restarts its clock", [curl], [[2, { kind: "count", by: 1 }], [10, { kind: "reset" }], [15, { kind: "main" }]], ["rest", 0, 1], [["barbell_curl", 10, null, 5000]]],
    ["a lower target the reps already reach ends the set", [curl], [...Array.from({ length: 4 }, (_, i): [number, Press] => [2 + i, { kind: "count", by: 1 }]), ...Array.from({ length: 6 }, (_, i): [number, Press] => [6 + i, { kind: "target", by: -1 }])], ["rest", 0, 1], [["barbell_curl", 4, null, 11_000]]],
    ["no rest after a set: the next starts at once", [squat, curl], [[30, { kind: "main" }]], ["set", 1, 0], [["squat", 12, null, 30_000]]],
    ["get ready runs out, the timer runs out, and its rest starts", [plank], [[10, { kind: "tick" }], [45, { kind: "tick" }]], ["rest", 0, 1], [["plank", 30, null, 30_000]]],
    ["Start now skips get-ready", [plank], [[3, { kind: "main" }], [40, { kind: "tick" }]], ["rest", 0, 1], [["plank", 30, null, 30_000]]],
    ["Set done on a timer keeps the time held", [plank], [[10, { kind: "tick" }], [22, { kind: "main" }]], ["rest", 0, 1], [["plank", 12, null, 12_000]]],
    ["after Skip exercise a timed set gets ready", [squat, curl, plank], [[5, { kind: "main" }], [10, { kind: "main" }], [70, { kind: "tick" }], [75, { kind: "skipExercise" }]], ["ready", 2, 0], [["squat", 12, null, 5000], ["barbell_curl", 10, 60, 5000]]],
    ["a timed set after its rest is not given get-ready", [curl, plank], [[5, { kind: "main" }], [6, { kind: "main" }], [10, { kind: "main" }], [70, { kind: "tick" }]], ["set", 1, 0], [["barbell_curl", 10, 1, 5000], ["barbell_curl", 10, 60, 4000]]],
    ["paused, no clock moves the workout", [plank], [[10, { kind: "tick" }], [15, { kind: "pause" }], [300, { kind: "tick" }], [301, { kind: "count", by: 1 }]], ["set", 0, 0], []],
    ["Resume carries on where it was", [plank], [[10, { kind: "tick" }], [15, { kind: "pause" }], [300, { kind: "main" }], [325, { kind: "tick" }]], ["rest", 0, 1], [["plank", 30, null, 30_000]]],
    ["Skip exercise goes to the next exercise's first set", [curl, squat], [[3, { kind: "skipExercise" }]], ["set", 1, 0], []],
    ["Skip exercise on the last with nothing done keeps nothing", [squat], [[3, { kind: "skipExercise" }]], "gone", "gone"],
    ["Skip exercise on the last with sets done ends and keeps them", [curl, squat], [[5, { kind: "main" }], [10, { kind: "main" }], [15, { kind: "skipExercise" }], [20, { kind: "skipExercise" }]], ["done", 1, 0], [["barbell_curl", 10, 5, 5000]]],
    ["End with nothing done keeps nothing", [curl], [[5, { kind: "end" }]], "gone", "gone"],
    ["End during a rest keeps the rest taken", [curl], [[5, { kind: "main" }], [25, { kind: "end" }]], ["done", 0, 1], [["barbell_curl", 10, 20, 5000]]],
    ["End during a set keeps the sets done, not the one begun", [curl], [[5, { kind: "main" }], [10, { kind: "main" }], [12, { kind: "count", by: 1 }], [14, { kind: "end" }]], ["done", 0, 1], [["barbell_curl", 10, 5, 5000]]],
    ["the last set done ends the workout", [squat], [[30, { kind: "main" }]], ["done", 0, 0], [["squat", 12, null, 30_000]]],
    ["the phone's clock set back moves nothing back; the second after it still counts", [curl], [[20, { kind: "main" }], [5, { kind: "tick" }], [6, { kind: "main" }]], ["set", 0, 1], [["barbell_curl", 10, 1, 20_000]]],
  ])("%s", (_name, exercises, presses, place, done) => {
    const out = play(exercises, presses);
    expect(where(out)).toEqual(place);
    expect(sets(out)).toEqual(done);
  });

  it("a set's target and weight are changed for that set alone", () => {
    const out = play([curl], [[1, { kind: "weight", by: 1, units: "metric" }], [2, { kind: "target", by: 1 }], [5, { kind: "main" }]]);
    if (out === "gone") throw new Error("gone");
    expect(out.done[0]).toMatchObject({ target: 11, done: 11, weightGrams: 22_500 });
    expect(out.exercises[0]?.sets[1]).toEqual(reps(10, 60, 20_000));
    // A barbell's weight from none starts at the empty bar.
    const bare = play([{ ...curl, sets: [reps(10, 60, null)] }], [[1, { kind: "weight", by: 1, units: "metric" }]]);
    if (bare === "gone") throw new Error("gone");
    expect(bare.exercises[0]?.sets[0]?.weightGrams).toBe(20_000);
  });

  it("a timed set's target can be cut below the time held, and it ends at once", () => {
    const out = play([plank], [[10, { kind: "tick" }], [32, { kind: "target", by: -1 }], [33, { kind: "target", by: -1 }]]);
    expect(sets(out)).toEqual([["plank", 20, null, 23_000]]);
  });
});

describe("a set or a rest left open (round one, H2)", () => {
  it("a set by hand left open 13 hours with the app in front is kept as no longer than a save allows, and the workout is still saved", () => {
    const out = play([curl], [[20, { kind: "main" }], [30, { kind: "main" }], [30 + 13 * 3600, { kind: "tick" }], [30 + 13 * 3600 + 1, { kind: "main" }]]);
    if (out === "gone") throw new Error("gone");
    expect(where(out)).toEqual(["done", 0, 1]);
    const used = out.done.reduce((t, s) => t + s.durationMs + (s.restSeconds ?? 0) * 1000, 0);
    expect(used).toBe(12 * 3_600_000);
    expect(workoutSaveSchema.safeParse(toSave(out, "android", "x")).success).toBe(true);
  });

  it("a rest begun near the longest clock still makes a workout its file can hold", () => {
    const out = play([curl], [[5, { kind: "pause" }], [5 + 48 * 3600, { kind: "resume" }], [5 + 48 * 3600 + 1, { kind: "tick" }], [CLOCK_MOST_MS / 1000 + 10, { kind: "main" }]]);
    if (out === "gone") throw new Error("gone");
    expect(workoutRunSchema.safeParse(out).success).toBe(true);
  });

  it("a workout of more than 200 sets does the first 200 (round one, L3)", () => {
    const many = Array.from({ length: 25 }, (_, i): RunExercise => ({ ...curl, exercise: i % 2 === 0 ? "barbell_curl" : "squat", sets: Array.from({ length: 10 }, () => reps(10)) }));
    expect(firstSets(many).reduce((n, e) => n + e.sets.length, 0)).toBe(200);
    expect(firstSets(many)).toHaveLength(20);
    expect(setsInAll(begin(many))).toBe(200);
  });
});

describe("away from the app", () => {
  it("back within 10 minutes: every phase that ended meanwhile ended at its own time, in order", () => {
    // Set done at 20 s, its 60 s rest, the next set by hand, still being done.
    const out = play([curl, plank], [[20, { kind: "main" }], [20 + 5 * 60, { kind: "back" }]]);
    expect(where(out)).toEqual(["set", 0, 1]);
    expect(sets(out)).toEqual([["barbell_curl", 10, 60, 20_000]]);
    // A plank left running ends at its 30 s, its rest at its 30 s, the next plank at its 30 s: done, nothing past it.
    const plankOut = play([plank], [[10, { kind: "tick" }], [10 + 8 * 60, { kind: "back" }]]);
    expect(where(plankOut)).toEqual(["done", 0, 1]);
    expect(sets(plankOut)).toEqual([["plank", 30, 30, 30_000], ["plank", 30, null, 30_000]]);
    if (plankOut === "gone") throw new Error("gone");
    expect(plankOut.totalMs).toBe(10_000 + 90_000);
  });

  it("back after more than 10 minutes: paused from when it was last seen, those minutes not counted as training", () => {
    const out = play([curl], [[20, { kind: "main" }], [20 + AWAY_MOST_MS / 1000 + 1, { kind: "back" }]]);
    if (out === "gone") throw new Error("gone");
    expect(out.paused).toBe(true);
    expect(out.activeMs).toBe(20_000);
    expect(out.totalMs).toBe(20_000 + AWAY_MOST_MS + 1000);
    expect(where(out)).toEqual(["rest", 0, 1]);
  });

  it("paused, the time shown stops (Kd's drawing: Pause stops every clock), while the whole goes on for the save's length", () => {
    const out = play([curl], [[30, { kind: "pause" }]]);
    if (out === "gone") throw new Error("gone");
    const later = shownAt(out, T0 + 600_000);
    expect(later.activeMs).toBe(30_000);
    expect(later.totalMs).toBe(600_000);
  });

  it("the clocks the screen shows move with no press", () => {
    const run = begin([plank]);
    expect(leftOf(shownAt(run, T0 + 4000))).toEqual({ leftMs: READY_MS - 4000, ofMs: READY_MS });
    expect(leftOf(shownAt(run, T0 + 15_000))).toEqual({ leftMs: 25_000, ofMs: 30_000 });
    expect(leftOf(begin([curl]))).toBeNull();
  });
});

describe("the workout as the server takes it", () => {
  it("passes the save's own rules, its length covering its sets and rests", () => {
    const out = play([curl, plank], [[5, { kind: "count", by: 1 }], [20, { kind: "main" }], [40, { kind: "pause" }], [100, { kind: "resume" }], [120, { kind: "main" }], [200, { kind: "main" }], [260, { kind: "tick" }], [400, { kind: "end" }]]);
    if (out === "gone") throw new Error("gone");
    const save = toSave(out, "android", "phone 1.0.0");
    expect(workoutSaveSchema.safeParse(save).success).toBe(true);
    expect(save).toMatchObject({ workoutId: ID, name: "Full body", startedAt: "2026-11-21T10:00:00.000Z", timeZone: "Asia/Kolkata", startedFrom: "none", effort: null, heart: [] });
    expect(save?.sets.map((s) => s.position)).toEqual(save?.sets.map((_, i) => i));
    expect(save?.sets.map((s) => s.counted)).toEqual(["hand", "hand", "timer", "timer"]);
  });

  it.each<[string, "saved" | "none" | undefined, string]>([
    ["started from a saved workout (64a-iv)", "saved", "saved"],
    ["started from nothing", "none", "none"],
    ["a workout kept before 64a-iv, with no mark", undefined, "none"],
  ])("what it was started from: %s", (_, startedFrom, want) => {
    const run = startRun({ workoutId: ID, name: "Legs", now: T0, timeZone: "UTC", exercises: [squat], ...(startedFrom === undefined ? {} : { startedFrom }) });
    if (run === null) throw new Error("no run");
    expect(workoutRunSchema.safeParse(run).success).toBe(true);
    const out = press(run, { kind: "main" }, T0 + 1000);
    if (out.kind !== "on") throw new Error("gone");
    expect(toSave(out.run, "android", "x")?.startedFrom).toBe(want);
  });

  it("an unnamed workout is sent with no name, and nothing done sends nothing", () => {
    const run = startRun({ workoutId: ID, name: "  ", now: T0, timeZone: "UTC", exercises: [squat] });
    if (run === null) throw new Error("no run");
    expect(toSave(run, "android", "x")).toBeNull();
    const out = press(run, { kind: "main" }, T0 + 1000);
    if (out.kind !== "on") throw new Error("gone");
    expect(toSave(out.run, "android", "x")?.name).toBeNull();
  });

  it("a workout left paused for days is sent as no more than 12 hours, still covering its sets", () => {
    const out = play([curl], [[20, { kind: "main" }], [25, { kind: "pause" }], [3 * 86_400, { kind: "tick" }], [3 * 86_400 + 1, { kind: "end" }]]);
    if (out === "gone") throw new Error("gone");
    const save = toSave(out, "android", "x");
    expect(workoutSaveSchema.safeParse(save).success).toBe(true);
    expect(Date.parse(save?.endedAt ?? "") - T0).toBe(12 * 3_600_000);
    expect(save?.trainedMs).toBe(25_000);
  });

  it("the time trained is the time the screen showed, every pause left out (64a-ii-b's worst thing)", () => {
    // 20 s of curl, paused 5 hours, resumed: 30 s more of the set, then End.
    const out = play([curl], [[20, { kind: "main" }], [25, { kind: "pause" }], [5 * 3600 + 25, { kind: "resume" }], [5 * 3600 + 55, { kind: "end" }]]);
    if (out === "gone") throw new Error("gone");
    const save = toSave(out, "android", "x");
    expect(workoutSaveSchema.safeParse(save).success).toBe(true);
    expect(save?.trainedMs).toBe(55_000);
    expect(save?.trainedMs).toBe(out.activeMs);
    expect(Date.parse(save?.endedAt ?? "") - T0).toBe(5 * 3_600_000 + 55_000);
  });

  it("a workout with no pause is trained for its whole length", () => {
    const out = play([curl], [[20, { kind: "main" }], [50, { kind: "end" }]]);
    if (out === "gone") throw new Error("gone");
    const save = toSave(out, "android", "x");
    expect(save?.trainedMs).toBe(50_000);
    expect(Date.parse(save?.endedAt ?? "") - T0).toBe(50_000);
  });

  it("away more than 10 minutes, those minutes are not trained", () => {
    const out = play([curl], [[20, { kind: "main" }], [20 + 3600, { kind: "back" }], [20 + 3600 + 5, { kind: "end" }]]);
    if (out === "gone") throw new Error("gone");
    const save = toSave(out, "android", "x");
    expect(save?.trainedMs).toBe(20_000);
  });

  it("trained past 12 hours is sent as 12, within the length and covering its sets", () => {
    const out = play([curl], [[20, { kind: "main" }], [13 * 3600, { kind: "tick" }], [13 * 3600 + 1, { kind: "end" }]]);
    if (out === "gone") throw new Error("gone");
    const save = toSave(out, "android", "x");
    expect(workoutSaveSchema.safeParse(save).success).toBe(true);
    expect(save?.trainedMs).toBe(12 * 3_600_000);
  });

  it("no exercise, no workout", () => {
    expect(startRun({ workoutId: ID, name: "", now: T0, timeZone: "UTC", exercises: [] })).toBeNull();
  });
});
