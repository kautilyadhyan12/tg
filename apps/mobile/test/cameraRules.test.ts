import { KEYPOINT_COUNT, KP, WORKOUT_SAVE_LIMITS } from "@app/shared";
import { describe, expect, it } from "vitest";
import { downOf, frameOf, type PoseEvent } from "../src/camera/poseFrame";
import { BODY_LINES, BODY_RULES } from "../src/camera/skeleton";
import { ended, pressTry, shownReps, startTry, type TryPress, type TrySet } from "../src/camera/trySet";
import { CAMERA_DIGITS, CAMERA_TILE, cameraSizes } from "../src/look/sizing";

// The camera screen's rules that need no screen (ROADMAP Stage 5 53a): which way is down from the phone's gravity, an
// answer of the pose model made into the engine's frame (or refused whole), the rules the phone draws the body by, and
// the set's own steps.

const g = 9.81;
const deg = Math.PI / 180;

describe("which way is down, in the selfie camera's picture", () => {
  it.each<[string, number[], [number, number, number] | null]>([
    ["upright, facing the person", [0, g, 0], [0, 1, 0]],
    // Stood on the floor, leaning back 14 degrees (52a-ii-b-ii-a's middle): the camera looks up a little, so down leans
    // towards the camera in its picture.
    ["on the floor, leaning back 14°", [0, g * Math.cos(14 * deg), g * Math.sin(14 * deg)], [0, Math.cos(14 * deg), -Math.sin(14 * deg)]],
    ["leaning forward 10°", [0, g * Math.cos(10 * deg), -g * Math.sin(10 * deg)], [0, Math.cos(10 * deg), Math.sin(10 * deg)]],
    // Turned on its long side, its left edge down: Android reads gravity up the phone's x; the selfie picture's right is
    // the phone's left, so down is to the picture's right.
    ["on its long side, its left edge down", [g, 0, 0], [1, 0, 0]],
    ["on its long side, its right edge down", [-g, 0, 0], [-1, 0, 0]],
    ["flat on its back, facing the ceiling", [0, 0, g], [0, 0, -1]],
    ["tilted 15° in the picture", [-g * Math.sin(15 * deg), g * Math.cos(15 * deg), 0], [-Math.sin(15 * deg), Math.cos(15 * deg), 0]],
    ["being moved: far from Earth's pull", [0, 13, 0], null],
    ["falling", [0, 2, 0], null],
    ["no reading", [], null],
    ["two numbers", [0, g], null],
    ["a broken number", [0, Number.NaN, 0], null],
  ])("%s", (_, gravity, down) => {
    const got = downOf(gravity, 0);
    if (down === null) {
      expect(got).toBeNull();
      return;
    }
    expect(got).not.toBeNull();
    down.forEach((v, k) => {
      expect(got?.[k]).toBeCloseTo(v, 9);
    });
  });

  it("a reading a little off Earth's pull is made a unit, as the engine asks", () => {
    const d = downOf([0.3, 10.9, 1.1], 0);
    expect(Math.hypot(...(d ?? [0, 0, 0]))).toBeCloseTo(1, 12);
  });

  // A tablet's own axes are its natural way up, on its side; the app stands upright, so its screen, and the picture turned
  // upright for it, are turned 90 or 270 degrees from them (round one: "down" turned 90 degrees on such a phone). Each
  // stands upright, facing the person: down is down the picture whatever the turn.
  it.each<[string, number[], number, [number, number, number] | null]>([
    ["a phone upright", [0, g, 0], 0, [0, 1, 0]],
    ["a tablet upright, its screen turned 90°", [g, 0, 0], 90, [0, 1, 0]],
    ["a tablet upright, its screen turned 270°", [-g, 0, 0], 270, [0, 1, 0]],
    ["a phone upside down, its screen turned 180°", [0, -g, 0], 180, [0, 1, 0]],
    ["a tablet upright and leaning back 14°, turned 90°", [g * Math.cos(14 * deg), 0, g * Math.sin(14 * deg)], 90, [0, Math.cos(14 * deg), -Math.sin(14 * deg)]],
    ["a tablet tilted 15° in the picture, turned 90°", [g * Math.cos(15 * deg), g * Math.sin(15 * deg), 0], 90, [-Math.sin(15 * deg), Math.cos(15 * deg), 0]],
    ["a turn that is no quarter turn", [0, g, 0], 45, null],
    ["a broken turn", [0, g, 0], Number.NaN, null],
  ])("%s", (_, gravity, turn, down) => {
    const got = downOf(gravity, turn);
    if (down === null) {
      expect(got).toBeNull();
      return;
    }
    expect(got).not.toBeNull();
    down.forEach((v, k) => {
      expect(got?.[k]).toBeCloseTo(v, 9);
    });
  });
});

const standing = (): number[] => {
  const points: number[] = [];
  for (let k = 0; k < KEYPOINT_COUNT; k++) points.push(0.5, 0.2 + (0.7 * k) / KEYPOINT_COUNT, 0, 0.9, 0.95);
  return points;
};
const world = (): number[] => Array.from({ length: KEYPOINT_COUNT * 3 }, (_, k) => (k % 3 === 1 ? 0.5 : 0.01));
const answer = (over: Partial<PoseEvent> = {}): PoseEvent => ({ t: 0, width: 480, height: 640, gravity: [0, g, 0], turn: 0, people: [{ points: standing(), world: world() }], ...over });

describe("an answer of the pose model, as the engine's frame", () => {
  it("a whole answer is a frame: its picture's shape, down, and the person", () => {
    const f = frameOf(answer(), 1000);
    expect(f?.t).toBe(1000);
    expect(f?.aspect).toBeCloseTo(0.75, 12);
    expect(f?.down).toEqual([0, 1, 0]);
    expect(f?.people).toHaveLength(1);
    expect(f?.people[0]?.points[0]).toEqual([0.5, 0.2, 0, 0.9, 0.95]);
    expect(f?.people[0]?.world).toHaveLength(KEYPOINT_COUNT);
  });

  it("nobody found is a frame of nobody; no 3D points is a person without them; no gravity is no down", () => {
    expect(frameOf(answer({ people: [] }), 0)?.people).toEqual([]);
    expect(frameOf(answer({ people: [{ points: standing(), world: [] }] }), 0)?.people[0]?.world).toBeNull();
    expect(frameOf(answer({ gravity: [] }), 0)?.down).toBeNull();
  });

  it("the model's sureness strayed a hair past its ends is taken at its end", () => {
    const points = standing();
    points[3] = 1.0000002;
    points[4] = -0.0000001;
    expect(frameOf(answer({ people: [{ points, world: world() }] }), 0)?.people[0]?.points[0]?.slice(3)).toEqual([1, 0]);
  });

  it.each<[string, Partial<PoseEvent>]>([
    ["a point missing", { people: [{ points: standing().slice(0, -5), world: world() }] }],
    ["a 3D point missing", { people: [{ points: standing(), world: world().slice(0, -3) }] }],
    ["a point a hundred pictures away", { people: [{ points: [200, ...standing().slice(1)], world: world() }] }],
    ["a broken number", { people: [{ points: [Number.NaN, ...standing().slice(1)], world: world() }] }],
    ["no picture", { width: 0 }],
    ["a picture with no height", { height: 0 }],
    ["a picture far too wide", { width: 48_000 }],
    ["seven people", { people: Array.from({ length: 7 }, () => ({ points: standing(), world: world() })) }],
  ])("refused whole: %s", (_, over) => {
    expect(frameOf(answer(over), 0)).toBeNull();
  });
});

describe("the body the phone draws over the picture it read it from (53a)", () => {
  it("the lines it joins, one pair after another, and every point one the model gives", () => {
    expect(BODY_RULES.lines).toEqual(BODY_LINES.flatMap(([a, b]) => [a, b]));
    for (const k of [...BODY_RULES.lines, ...BODY_RULES.joints, BODY_RULES.nose]) {
      expect(Number.isInteger(k) && k >= 0 && k < KEYPOINT_COUNT).toBe(true);
    }
  });

  it("the arms, shoulders and hips, the trunk's sides and the legs; every big joint ringed; the head for the corners", () => {
    expect(BODY_RULES.lines).toHaveLength(24);
    expect(BODY_RULES.joints).toEqual([
      KP.left_shoulder,
      KP.right_shoulder,
      KP.left_elbow,
      KP.right_elbow,
      KP.left_wrist,
      KP.right_wrist,
      KP.left_hip,
      KP.right_hip,
      KP.left_knee,
      KP.right_knee,
      KP.left_ankle,
      KP.right_ankle,
    ]);
    expect(BODY_RULES.nose).toBe(KP.nose);
  });

  it("a point the model gives less than an even chance of being seen is not drawn; the corners a little out", () => {
    expect(BODY_RULES.sure).toBe(0.5);
    expect(BODY_RULES.room).toBe(0.06);
  });
});

describe("the set's own steps (Try the camera)", () => {
  const run = (s: TrySet, ...ps: TryPress[]): TrySet => ps.reduce(pressTry, s);
  const reps = startTry("reps", 10);

  it.each<[string, TryPress[], number, boolean]>([
    ["the camera's count is shown", [{ kind: "camera", reps: 3, heldMs: 0 }], 3, false],
    ["a rep added by hand is added to the camera's", [{ kind: "camera", reps: 3, heldMs: 0 }, { kind: "count", by: 1 }], 4, false],
    ["a rep taken off by hand, then the camera counts on", [{ kind: "camera", reps: 3, heldMs: 0 }, { kind: "count", by: -1 }, { kind: "camera", reps: 4, heldMs: 0 }], 3, false],
    ["never below 0", [{ kind: "count", by: -1 }, { kind: "count", by: -1 }], 0, false],
    // The screen starts the camera's own count again with it (TryCamera): its next count is 1.
    ["Reset set: back to 0, and the new count counted from there", [{ kind: "camera", reps: 5, heldMs: 0 }, { kind: "count", by: 1 }, { kind: "reset" }, { kind: "camera", reps: 1, heldMs: 0 }], 1, false],
    ["paused, what the camera counts is not the set's", [{ kind: "pause" }, { kind: "camera", reps: 2, heldMs: 0 }, { kind: "resume" }, { kind: "camera", reps: 3, heldMs: 0 }], 1, false],
    ["the target reached ends the set by itself", [{ kind: "camera", reps: 10, heldMs: 0 }], 10, true],
    ["the target lowered to the count ends it", [{ kind: "camera", reps: 9, heldMs: 0 }, { kind: "target", by: -1 }], 9, true],
    ["Set done ends it where it is", [{ kind: "camera", reps: 4, heldMs: 0 }, { kind: "done" }], 4, true],
    ["after the end nothing changes", [{ kind: "done" }, { kind: "camera", reps: 4, heldMs: 0 }, { kind: "count", by: 1 }], 0, true],
  ])("%s", (_, presses, shown, done) => {
    const s = run(reps, ...presses);
    expect(shownReps(s)).toBe(shown);
    expect(s.done).toBe(done);
  });

  it("a hold's Reset set starts its time again", () => {
    const hold = run(startTry("time", 20), { kind: "camera", reps: 0, heldMs: 12_000 }, { kind: "reset" });
    expect(hold.heldMs).toBe(0);
    expect(run(hold, { kind: "camera", reps: 0, heldMs: 3_000 }).heldMs).toBe(3_000);
  });

  it("at the most reps a set may hold, a press more changes nothing, and the next press less is felt", () => {
    // A target past the most, so the set does not end at it.
    const full = run(startTry("reps", WORKOUT_SAVE_LIMITS.repsMost + 1), { kind: "camera", reps: WORKOUT_SAVE_LIMITS.repsMost, heldMs: 0 });
    expect(shownReps(full)).toBe(WORKOUT_SAVE_LIMITS.repsMost);
    expect(run(full, { kind: "count", by: 1 })).toEqual(full);
    expect(shownReps(run(full, { kind: "count", by: 1 }, { kind: "count", by: -1 }))).toBe(WORKOUT_SAVE_LIMITS.repsMost - 1);
  });

  it("as the set ends, a rep the camera judged only then is the set's, unless it was paused", () => {
    const done = run(reps, { kind: "camera", reps: 4, heldMs: 0 }, { kind: "done" });
    expect(shownReps(ended(done, 5))).toBe(5);
    expect(ended(done, 5).done).toBe(true);
    expect(shownReps(ended(done, 4))).toBe(4);
    const paused = run(reps, { kind: "camera", reps: 4, heldMs: 0 }, { kind: "pause" }, { kind: "done" });
    expect(shownReps(ended(paused, 5))).toBe(4);
  });

  it("a hold ends at its target time held, and its count cannot be pressed", () => {
    const hold = startTry("time", 20);
    expect(run(hold, { kind: "camera", reps: 0, heldMs: 19_900 }).done).toBe(false);
    expect(run(hold, { kind: "camera", reps: 0, heldMs: 20_000 }).done).toBe(true);
    expect(run(hold, { kind: "count", by: 1 })).toEqual(hold);
    expect(run(hold, { kind: "target", by: 1 }).target).toBe(25);
  });

  it("the weight takes the workout's own steps; the camera stopping leaves the count as it was", () => {
    expect(run(reps, { kind: "weight", by: 1, units: "metric" }).weightGrams).toBe(2500);
    expect(run(reps, { kind: "weight", by: 1, units: "metric" }, { kind: "weight", by: -1, units: "metric" }).weightGrams).toBeNull();
    const stopped = run(reps, { kind: "camera", reps: 4, heldMs: 0 }, { kind: "stopped" }, { kind: "count", by: 1 });
    expect([stopped.stopped, shownReps(stopped)]).toEqual([true, 5]);
  });
});

describe("the camera screen's corners fit every phone", () => {
  it("as drawn on Kd's phone, and never more of a short screen's height", () => {
    expect(cameraSizes(960)).toEqual({ digits: CAMERA_DIGITS, tile: { width: CAMERA_TILE.width, height: CAMERA_TILE.height } });
    expect(cameraSizes(2000)).toEqual(cameraSizes(960));
    const short = cameraSizes(480);
    expect(short.digits).toBe(56);
    expect(short.tile.height).toBeLessThanOrEqual(118);
    expect(short.tile.width / short.tile.height).toBeCloseTo(CAMERA_TILE.width / CAMERA_TILE.height, 1);
  });
});
