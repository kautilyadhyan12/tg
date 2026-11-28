import { describe, expect, it } from "vitest";
import { MOVEMENT_ENGINE_VERSION } from "@app/movement";
import { setFormScore, WORKOUT_SAVE_LIMITS, workoutRunSchema, workoutSaveSchema, type CameraSummary, type EngineSetSummary, type RunExercise, type SavedSet, type WorkoutRun } from "@app/shared";
import { cameraFor } from "../src/camera/cameraExercises";
import { cameraEndOf, cameraSummaryOf } from "../src/camera/workoutCamera";
import { asking, cameraReached, endsAt, following, press, startRun, toSave, tracking, type CameraEnd, type Press } from "../src/library/workoutRun";

// The camera in a workout (ROADMAP Stage 5 64b-ii; spec Part 2 §11.8 steps 3 to 6, §13.5): the workout's steps for a set the
// camera counts, as a table. Each row is a workout, presses at seconds from Start, and what it must then be.
//
// THE WORST THING THIS JOB COULD DO TO A REAL PERSON: a form score kept for a set no camera watched (a set counted by hand,
// by a timer, or followed with the clip), shown on their history and paid in XP as if the camera had judged it. That comes
// first, every way a set can be done without the camera, with the camera saying all the while that it counted.

const T0 = Date.parse("2026-11-28T10:00:00.000Z");
const ID = "22222222-2222-4222-8222-222222222222";
const L = WORKOUT_SAVE_LIMITS;

const sets = (n: number, target: number, rest: number | null = 60): RunExercise["sets"] => Array.from({ length: n }, () => ({ target, weightGrams: null, restSeconds: rest }));
/** The squat, which the camera counts and judges (its own camera file), three sets of 10 with a minute's rest. */
const squat: RunExercise = { exercise: "squat", name: "Squat", kind: "strength", measuredIn: "reps", barbell: false, sets: sets(3, 10), camera: true };
/** A hold the camera times (the workout's steps take any exercise as data). */
const hold: RunExercise = { exercise: "l_sit", name: "L-sit", kind: "core", measuredIn: "time", barbell: false, sets: sets(2, 20, 30), camera: true };
/** An exercise the camera does not count. */
const curl: RunExercise = { exercise: "barbell_curl", name: "Barbell Curl", kind: "strength", measuredIn: "reps", barbell: true, sets: sets(2, 8) };

/** A squat set's judgement as the engine makes it: a score for each rep, a mistake seen in two. */
const judged = (scores: number[]): CameraSummary => ({ definitionVersion: 3, repScores: scores, faultCounts: { knees_cave_in: 2 }, watchedMs: 30_000, tempoMsAvg: 2400, romStats: { depth: 92.5 }, view: "front" });
const end = (reps: number, summary: CameraSummary | null = judged(Array.from({ length: reps }, () => 80)), heldMs = 0): CameraEnd => ({ reps, heldMs, summary });

/** The camera saying its count at each of `at` seconds: 1, 2, … */
const counts = (from: number, n: number, every = 3, first = 1): [number, Press][] => Array.from({ length: n }, (_, i): [number, Press] => [from + i * every, { kind: "camera", reps: first + i, heldMs: 0 }]);

function play(exercises: RunExercise[], presses: [number, Press][]): WorkoutRun {
  const start = startRun({ workoutId: ID, name: "Legs", now: T0, timeZone: "Asia/Kolkata", exercises });
  if (start === null) throw new Error("no run");
  let run = start;
  for (const [at, p] of presses) {
    const out = press(run, p, T0 + at * 1000);
    if (out.kind === "gone") throw new Error("gone");
    run = out.run;
    // Every step is a workout the phone's file can hold.
    const kept = workoutRunSchema.safeParse(JSON.parse(JSON.stringify(run)));
    expect(kept.success, JSON.stringify(kept.error?.issues)).toBe(true);
  }
  return run;
}

/** The sets the workout keeps, as the server takes them: checked whole by the save's own schema. */
function saved(run: WorkoutRun): SavedSet[] {
  const ended = press(run, { kind: "end" }, T0 + 3_600_000);
  if (ended.kind === "gone") return [];
  const save = toSave(ended.run, "android", "phone 1.0.0");
  const checked = workoutSaveSchema.safeParse(save);
  expect(checked.success, JSON.stringify(checked.error?.issues)).toBe(true);
  return save?.sets ?? [];
}

const score = (s: SavedSet | undefined): number | null => setFormScore(s?.camera?.summary?.repScores ?? []);

describe("the worst thing first: a form score only for a set the camera counted", () => {
  // Every row: the camera says 10 reps all through, and its set's end says a whole judged set. None of it may be kept.
  const cameraAllAlong: [number, Press][] = [...counts(30, 10), [70, { kind: "cameraDone", end: end(10) }], [71, { kind: "leave", why: "chosen", end: end(10) }]];
  it.each<[string, RunExercise[], [number, Press][], SavedSet["counted"], number]>([
    ["Count manually, then the set by hand", [squat], [[5, { kind: "way", way: "hand" }], ...cameraAllAlong, [80, { kind: "count", by: 1 }], [81, { kind: "main" }]], "hand", 1],
    ["an exercise the camera does not count", [curl], [...cameraAllAlong, [90, { kind: "main" }]], "hand", 8],
    ["the camera's answer before the question is answered, then Count manually", [squat], [...counts(1, 3), [5, { kind: "cameraDone", end: end(3) }], [6, { kind: "way", way: "hand" }], [30, { kind: "main" }]], "hand", 10],
    ["Follow along after the camera had counted, the person's own count after it", [squat], [[2, { kind: "way", way: "camera" }], ...counts(5, 4), [20, { kind: "follow" }], ...counts(25, 6, 3, 5), [60, { kind: "cameraDone", end: end(10) }], [61, { kind: "followed", done: 9 }]], "hand", 9],
    ["Follow along, then its own Count this set myself, then Set done", [squat], [[2, { kind: "way", way: "camera" }], ...counts(5, 4), [20, { kind: "follow" }], [30, { kind: "handSet" }], ...counts(31, 5, 1, 5), [40, { kind: "leave", why: "chosen", end: end(9) }], [45, { kind: "main" }]], "hand", 10],
    ["a hold followed with the clip is the timer's", [hold], [[2, { kind: "way", way: "camera" }], [5, { kind: "camera", reps: 0, heldMs: 4000 }], [10, { kind: "follow" }], [32, { kind: "followed", done: 20 }]], "timer", 20],
    ["a hold, Count manually, the timer to its end", [hold], [[1, { kind: "way", way: "hand" }], [5, { kind: "camera", reps: 0, heldMs: 30_000 }], [12, { kind: "tick" }], [33, { kind: "tick" }]], "timer", 20],
  ])("%s: no camera facts, no form score", (_, exercises, presses, counted, done) => {
    const first = saved(play(exercises, presses))[0];
    expect(first?.counted).toBe(counted);
    expect(first?.done).toBe(done);
    expect(first?.camera).toBeUndefined();
    expect(score(first)).toBeNull();
  });

  it("the camera's facts are on a camera set alone, set by set: hand, camera, then the next exercise by hand", () => {
    const run = play(
      [{ ...squat, sets: sets(1, 10, 0) }, { ...squat, exercise: "kettlebell_goblet_squat", name: "Kettlebell Goblet Squat", sets: sets(1, 5, 0) }],
      [[2, { kind: "way", way: "camera" }], ...counts(5, 10), [40, { kind: "cameraDone", end: end(10) }], [41, { kind: "way", way: "hand" }], ...counts(42, 5), [50, { kind: "main" }]],
    );
    expect(run.phase).toBe("done");
    const [a, b] = saved(run);
    expect([a?.counted, b?.counted]).toEqual(["camera", "hand"]);
    expect(score(a)).toBe(80);
    expect(b?.camera).toBeUndefined();
  });
});

describe("the question, as each exercise the camera counts starts", () => {
  it.each<[string, RunExercise[], [number, Press][], boolean, string | undefined]>([
    ["asked at the first set", [squat], [], true, undefined],
    ["not asked for an exercise the camera does not count", [curl], [], false, undefined],
    ["Start with camera", [squat], [[3, { kind: "way", way: "camera" }]], false, "camera"],
    ["Count manually", [squat], [[3, { kind: "way", way: "hand" }]], false, "hand"],
    ["asked again at the next exercise the camera counts", [{ ...squat, sets: sets(1, 10, 0) }, squat], [[3, { kind: "way", way: "hand" }], [20, { kind: "main" }]], true, undefined],
    ["not asked again for the same exercise's next set", [squat], [[3, { kind: "way", way: "hand" }], [20, { kind: "main" }], [81, { kind: "tick" }]], false, "hand"],
    ["Skip exercise answers nothing: the next one asks for itself", [squat, { ...squat, exercise: "kettlebell_goblet_squat" }], [[3, { kind: "skipExercise" }]], true, undefined],
  ])("%s", (_, exercises, presses, asks, way) => {
    const run = play(exercises, presses);
    expect(asking(run)).toBe(asks);
    expect(run.way).toBe(way);
  });

  it("while it asks, the set waits: a hold's get-ready does not run out, nothing is counted, and the set's time starts at the answer", () => {
    const waiting = play([hold], [[30, { kind: "tick" }], [31, { kind: "count", by: 1 }], [32, { kind: "main" }], [33, { kind: "target", by: 1 }]]);
    expect([waiting.phase, waiting.done.length, asking(waiting), endsAt(waiting)]).toEqual(["ready", 0, true, null]);
    expect(waiting.exercises[0]?.sets[0]?.target).toBe(20);
    const byHand = play([squat], [[40, { kind: "way", way: "hand" }], [55, { kind: "main" }]]);
    expect(byHand.done[0]?.durationMs).toBe(15_000);
  });
});

describe("a set the camera counts", () => {
  it("ends at its target only with what the camera judged: the screen sends it, the workout keeps it, and its rest starts", () => {
    const counting = play([squat], [[2, { kind: "way", way: "camera" }], ...counts(5, 10)]);
    expect([tracking(counting), cameraReached(counting), counting.phase, counting.count, counting.cam?.done]).toEqual([true, true, "set", 10, 10]);
    const run = play([squat], [[2, { kind: "way", way: "camera" }], ...counts(5, 10), [33, { kind: "cameraDone", end: end(10, judged([90, 80, 70, 100, 90, 80, 70, 100, 90, 80])) }]]);
    expect([run.phase, run.set, run.cam, tracking(run)]).toEqual(["rest", 1, undefined, false]);
    const set = run.done[0];
    expect(set).toMatchObject({ counted: "camera", done: 10, durationMs: 31_000, camera: { done: 10, left: null, engineVersion: MOVEMENT_ENGINE_VERSION } });
    expect(score(set)).toBe(85);
  });

  it("the rest over, the next set is the camera's again, with nothing asked and a judgement of its own", () => {
    const run = play([squat], [[2, { kind: "way", way: "camera" }], ...counts(5, 10), [33, { kind: "cameraDone", end: end(10) }], [94, { kind: "tick" }]]);
    expect([run.phase, run.set, asking(run), tracking(run), run.count, run.cam?.done, run.cam?.summary]).toEqual(["set", 1, false, true, 0, 0, null]);
  });

  it.each<[string, [number, Press][], number, number]>([
    ["the person's own + adds to the set, never to the camera's count", [...counts(5, 4), [20, { kind: "count", by: 1 }], [21, { kind: "count", by: 1 }]], 6, 4],
    ["a − takes one off the set; never below none", [...counts(5, 1), [9, { kind: "count", by: -1 }], [10, { kind: "count", by: -1 }]], 0, 1],
    ["while paused nothing the camera counts is the set's", [...counts(5, 2), [12, { kind: "pause" }], ...counts(13, 3, 1, 3), [20, { kind: "resume" }], [22, { kind: "camera", reps: 6, heldMs: 0 }]], 3, 3],
    ["a count that goes back takes nothing", [[5, { kind: "camera", reps: 4, heldMs: 0 }], [6, { kind: "camera", reps: 2, heldMs: 0 }]], 4, 4],
    ["a broken count takes nothing", [[5, { kind: "camera", reps: Number.NaN, heldMs: 0 }], [6, { kind: "camera", reps: -3, heldMs: 0 }], [7, { kind: "camera", reps: 1e9, heldMs: 0 }]], L.repsMost, L.repsMost],
    ["Reset set: from none again, and the camera's own count with it", [...counts(5, 4), [20, { kind: "reset" }], [25, { kind: "camera", reps: 2, heldMs: 0 }]], 2, 2],
  ])("%s", (_, presses, count, cameraDone) => {
    const run = play([{ ...squat, sets: sets(1, L.repsMost) }], [[2, { kind: "way", way: "camera" }], ...presses]);
    expect([run.count, run.cam?.done]).toEqual([count, cameraDone]);
  });

  it("a lower target the count reaches waits for the camera's judgement; the screen then ends the set with it", () => {
    const run = play([squat], [[2, { kind: "way", way: "camera" }], ...counts(5, 6), ...Array.from({ length: 4 }, (_, i): [number, Press] => [30 + i, { kind: "target", by: -1 }])]);
    expect([run.phase, cameraReached(run), run.exercises[0]?.sets[0]?.target]).toEqual(["set", true, 6]);
  });

  it("Set done (in its box) before the target keeps what was counted, never the target", () => {
    const run = play([squat], [[2, { kind: "way", way: "camera" }], ...counts(5, 3), [20, { kind: "main" }], [21, { kind: "cameraDone", end: end(3) }]]);
    expect(run.done[0]).toMatchObject({ counted: "camera", done: 3, target: 10, camera: { done: 3 } });
  });

  it("the camera's last rep, judged only as the set ends, is the set's", () => {
    const run = play([squat], [[2, { kind: "way", way: "camera" }], ...counts(5, 3), [20, { kind: "cameraDone", end: end(4) }]]);
    expect(run.done[0]).toMatchObject({ done: 4, camera: { done: 4 } });
  });

  it.each<[string, (summary: CameraSummary) => CameraSummary | null, number, number | null]>([
    ["a score for each rep: kept", (s) => s, 10, 80],
    ["more scores than reps the camera counted: none kept, never a score the save refuses", (s) => ({ ...s, repScores: [...s.repScores, 100] }), 10, null],
    ["an exercise with no form rules: counted by the camera, with no form score", () => null, 10, null],
  ])("%s", (_, change, reps, want) => {
    const run = play([squat], [[2, { kind: "way", way: "camera" }], ...counts(5, reps), [40, { kind: "cameraDone", end: end(reps, change(judged(Array.from({ length: reps }, () => 80)))) }]]);
    const set = saved(run)[0];
    expect(set?.counted).toBe("camera");
    expect(score(set)).toBe(want);
  });

  it("past the rep scores a workout may send, a set keeps no judgement rather than a save the server refuses", () => {
    // Ten sets of 1,000 reps: 10,000 scores, every one a save takes; then one set more.
    const big: RunExercise = { ...squat, sets: Array.from({ length: 10 }, () => ({ target: 1000, weightGrams: null, restSeconds: null })) };
    const presses: [number, Press][] = [[1, { kind: "way", way: "camera" }]];
    for (let i = 0; i < 10; i++) presses.push([2 + i * 2, { kind: "camera", reps: 1000, heldMs: 0 }], [3 + i * 2, { kind: "cameraDone", end: end(1000) }]);
    presses.push([30, { kind: "way", way: "camera" }], [31, { kind: "camera", reps: 1000, heldMs: 0 }], [32, { kind: "cameraDone", end: end(1000) }]);
    const all = saved(play([big, { ...squat, sets: sets(1, 1000, null) }], presses));
    expect(all.map((s) => s.counted)).toEqual(Array.from({ length: 11 }, () => "camera"));
    expect(all.map((s) => s.camera?.summary === null)).toEqual([...Array.from({ length: 10 }, () => false), true]);
  });
});

describe("leaving the camera in a set", () => {
  it.each<["chosen" | "camera_stopped"]>([["chosen"], ["camera_stopped"]])("%s: the rest by hand, kept as the camera's set with what it had judged", (why) => {
    const left = play([squat], [[2, { kind: "way", way: "camera" }], ...counts(5, 4), [20, { kind: "leave", why, end: end(5, judged([90, 80, 70, 60, 50])) }], ...counts(21, 3, 1, 6)]);
    expect([tracking(left), left.count, left.cam?.done, left.cam?.left]).toEqual([false, 5, 5, why]);
    const run = play([squat], [[2, { kind: "way", way: "camera" }], ...counts(5, 4), [20, { kind: "leave", why, end: end(5, judged([90, 80, 70, 60, 50])) }], [25, { kind: "count", by: 1 }], [30, { kind: "main" }]]);
    const set = saved(run)[0];
    expect(set).toMatchObject({ counted: "camera", done: 6, camera: { done: 5, left: why } });
    expect(score(set)).toBe(70);
    // The next set is the camera's again.
    expect([run.phase, run.way]).toEqual(["rest", "camera"]);
  });

  it("a hold left goes on as the workout's own timer, from the time the camera saw it held", () => {
    const run = play([hold], [[2, { kind: "way", way: "camera" }], [10, { kind: "camera", reps: 0, heldMs: 8000 }], [30, { kind: "leave", why: "chosen", end: end(0, null, 8000) }], [41, { kind: "tick" }], [43, { kind: "tick" }]]);
    const set = saved(run)[0];
    expect(set).toMatchObject({ counted: "camera", measuredIn: "time", done: 20, camera: { done: 8, left: "chosen", summary: null } });
  });

  it("Start with camera on a set counted by hand: the reps already counted are kept, the camera counts on from them", () => {
    const run = play([squat], [[2, { kind: "way", way: "hand" }], [5, { kind: "count", by: 1 }], [6, { kind: "count", by: 1 }], [8, { kind: "way", way: "camera" }], ...counts(10, 8)]);
    expect([run.way, tracking(run), run.count, run.cam?.done, cameraReached(run)]).toEqual(["camera", true, 10, 8, true]);
  });

  it("a set already left to the person is not taken back by the camera", () => {
    const run = play([squat], [[2, { kind: "way", way: "camera" }], [10, { kind: "leave", why: "camera_stopped", end: end(0, null) }], [12, { kind: "way", way: "camera" }]]);
    expect([tracking(run), run.cam?.left]).toEqual([false, "camera_stopped"]);
  });

  it("a set followed: the same exercise's next sets are followed too, the camera still off, until it is turned on again", () => {
    const followed: [number, Press][] = [[2, { kind: "way", way: "camera" }], [20, { kind: "follow" }], [50, { kind: "followed", done: 9 }]];
    const resting = play([squat], followed);
    expect([resting.phase, following(resting), tracking(resting), resting.cam]).toEqual(["rest", false, false, undefined]);
    // The rest over: set 2 is followed, with no camera.
    const next = play([squat], [...followed, [111, { kind: "tick" }], ...counts(112, 3)]);
    expect([next.phase, next.set, following(next), tracking(next), next.cam, next.count]).toEqual(["set", 1, true, false, undefined, 0]);
    expect(saved(play([squat], [...followed, [111, { kind: "tick" }], [140, { kind: "followed", done: 8 }]])).map((x) => [x.counted, x.done, x.camera])).toEqual([["hand", 9, undefined], ["hand", 8, undefined]]);
    // Camera off, tap to turn on: that set and the ones after it are the camera's.
    const back = play([squat], [...followed, [111, { kind: "tick" }], [115, { kind: "way", way: "camera" }], ...counts(120, 10), [160, { kind: "cameraDone", end: end(10) }], [221, { kind: "tick" }]]);
    expect([back.set, tracking(back), following(back)]).toEqual([2, true, false]);
    // The next exercise is asked about afresh, whatever the last one did.
    const other = play([{ ...squat, sets: sets(1, 10, 0) }, squat], followed);
    expect([asking(other), other.way, other.follow]).toEqual([true, undefined, undefined]);
  });
  it("Follow along, then back to the camera: the set starts again, the camera's", () => {
    const run = play([squat], [[2, { kind: "way", way: "camera" }], ...counts(5, 4), [20, { kind: "follow" }], [30, { kind: "way", way: "camera" }]]);
    expect([following(run), tracking(run), run.count, run.cam?.done, run.phaseAt]).toEqual([false, true, 0, 0, 30_000]);
  });
});

describe("a hold the camera times", () => {
  it("its time runs only while the camera sees it held, and it ends at its target with the camera's seconds", () => {
    const waiting = play([hold], [[2, { kind: "way", way: "camera" }], [60, { kind: "tick" }]]);
    expect([waiting.phase, endsAt(waiting), waiting.done.length]).toEqual(["set", null, 0]);
    const run = play([hold], [[2, { kind: "way", way: "camera" }], [15, { kind: "camera", reps: 0, heldMs: 12_000 }], [30, { kind: "camera", reps: 0, heldMs: 20_000 }]]);
    expect(cameraReached(run)).toBe(true);
    const done = play([hold], [[2, { kind: "way", way: "camera" }], [15, { kind: "camera", reps: 0, heldMs: 12_000 }], [30, { kind: "camera", reps: 0, heldMs: 20_000 }], [30, { kind: "cameraDone", end: end(0, null, 20_400) }]]);
    expect(saved(done)[0]).toMatchObject({ counted: "camera", done: 20, durationMs: 28_000, camera: { done: 20, summary: null } });
  });
});

describe("the engine's judgement in the save's shape", () => {
  const engine = (more: Partial<EngineSetSummary> = {}): EngineSetSummary => ({
    exercise: "squat", setIndex: 1, reps: 3, durationMs: 9000, tempoMsAvg: 2500, romStats: { depth: 95 }, view: "front", holdMs: null, calibration: null,
    mode: "engine", watchedMs: 8800, avgFormScore: 80, repScores: [70, 80, 90], faultCounts: { knees_cave_in: 1 }, engineVersion: MOVEMENT_ENGINE_VERSION, definitionVersion: 3, ...more,
  });
  it("keeps the camera's own facts, and none of the set's own fields", () => {
    expect(cameraSummaryOf(engine())).toEqual({ definitionVersion: 3, repScores: [70, 80, 90], faultCounts: { knees_cave_in: 1 }, watchedMs: 8800, tempoMsAvg: 2500, romStats: { depth: 95 }, view: "front" });
  });
  it.each<[string, Partial<EngineSetSummary>]>([
    ["a mistake named outside the files' own rule", { faultCounts: { "Knees In!": 1 } }],
    ["a reading named outside the movement's own rule", { romStats: { "x;drop": 1 } }],
    ["a reading past ±1000", { romStats: { depth: 5000 } }],
    ["more mistakes than the save takes", { faultCounts: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`m${String(i)}`, 1])) }],
  ])("%s: no judgement at all", (_, more) => {
    expect(cameraSummaryOf(engine(more))).toBeNull();
  });
  it("an exercise with no form rules has none, and a hold's time is its summary's", () => {
    expect(cameraEndOf({ reps: 4, summary: null })).toEqual({ reps: 4, heldMs: 0, summary: null });
    expect(cameraEndOf({ reps: 0, summary: engine({ holdMs: 21_000, repScores: [] }) }).heldMs).toBe(21_000);
  });
});

describe("which exercises the camera counts in a workout", () => {
  it.each<[string, "reps" | "time", string | null]>([
    ["squat", "reps", "squat"],
    ["kettlebell_goblet_squat", "reps", "goblet"],
    ["squat", "time", null],
    ["barbell_curl", "reps", null],
    ["plank", "time", null],
  ])("%s measured in %s", (id, measuredIn, key) => {
    expect(cameraFor(id, measuredIn)?.key ?? null).toBe(key);
  });
});
