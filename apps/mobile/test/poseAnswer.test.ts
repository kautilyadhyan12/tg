import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeBodyPoints } from "../../../packages/movement/scripts/bodyPoints";
import { CAMERA_EXERCISES } from "../src/camera/cameraExercises";
import { LiveSet } from "../src/camera/liveSet";
import { answerOf, type PoseEvent } from "../src/camera/poseFrame";

// The camera module's answers, checked whole before anything of them is read (the camera's security pass, L1): a broken
// answer is no frame at all, never a thrown error in the screen, and a broken first answer never spoils the set after it.

const EARTH = 9.81;

/** A real set: the living-room woman's three prisoner squats, facing the phone, as the camera module would send them. */
function squats(): PoseEvent[] {
  const file = join(__dirname, "..", "..", "..", "packages", "movement", "test", "movement-points", "prisoner_squat_1.bodypoints");
  const { frames } = decodeBodyPoints(new Uint8Array(readFileSync(file)));
  const first = frames[0];
  const last = frames[frames.length - 1];
  const step = (frames[1]?.t ?? 0) - (first?.t ?? 0);
  if (first === undefined || last === undefined || step <= 0) throw new Error("no video");
  const n = Math.round(1000 / step);
  const all = [...Array.from({ length: n }, (_, k) => ({ ...first, t: first.t + k * step })), ...frames.map((f) => ({ ...f, t: f.t + n * step })), ...Array.from({ length: n }, (_, k) => ({ ...last, t: last.t + (n + k + 1) * step }))];
  return all.map((f) => {
    const down = f.down ?? [0, 1, 0];
    return {
      t: 7_000_000 + f.t,
      width: 480 * f.aspect,
      height: 480,
      gravity: [down[0] * EARTH, down[1] * EARTH, -down[2] * EARTH],
      turn: 0,
      people: f.people.map((p) => ({ points: p.points.flat(), world: p.world === null ? [] : p.world.flat() })),
    };
  });
}

const SQUATS = squats();
const good = SQUATS[0];
if (good === undefined) throw new Error("no answer");
const person = good.people[0];
if (person === undefined) throw new Error("no person");

const BROKEN: readonly (readonly [string, unknown])[] = [
  ["nothing", undefined],
  ["not an answer", "squat"],
  ["no people", { ...good, people: undefined }],
  ["no gravity", { ...good, gravity: undefined }],
  ["a person with no 3D points field", { ...good, people: [{ points: person.points }] }],
  ["a person's points cut short", { ...good, people: [{ ...person, points: person.points.slice(0, 10) }] }],
  ["3D points neither 33 nor none", { ...good, people: [{ ...person, world: [0, 0, 0] }] }],
  ["a point not a number", { ...good, people: [{ ...person, points: person.points.map((v, i) => (i === 3 ? "x" : v)) }] }],
  ["a point infinite", { ...good, people: [{ ...person, points: person.points.map((v, i) => (i === 3 ? Infinity : v)) }] }],
  ["no clock", { ...good, t: undefined }],
  ["a clock not a number", { ...good, t: Number.NaN }],
  ["seven people", { ...good, people: Array.from({ length: 7 }, () => person) }],
];

describe("a broken answer is no frame at all", () => {
  it.each(BROKEN)("%s: refused whole, and the screen is told nothing", (_, answer) => {
    expect(answerOf(answer)).toBeNull();
    const squat = CAMERA_EXERCISES.find((e) => e.key === "squat");
    if (squat === undefined) throw new Error("no squat");
    const live = new LiveSet(squat.counts, squat.camera, 1);
    const before = live.next(good);
    expect(() => live.next(answer)).not.toThrow();
    expect(live.next(answer)).toEqual({ ...before, say: null });
  });

  it("a good answer passes as it came", () => {
    expect(answerOf(good)).toEqual(good);
  });

  it("a broken first answer spoils nothing: the set after it counts as with none", () => {
    const squat = CAMERA_EXERCISES.find((e) => e.key === "squat");
    if (squat === undefined) throw new Error("no squat");
    const count = (first: readonly unknown[]): number => {
      const live = new LiveSet(squat.counts, squat.camera, 1);
      let reps = 0;
      for (const a of [...first, ...SQUATS]) reps = live.next(a).reps;
      return reps;
    };
    expect(count([])).toBe(3);
    for (const [, answer] of BROKEN) expect(count([answer])).toBe(3);
  });
});
