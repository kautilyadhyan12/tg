// The movement engine's frame (ROADMAP 50c-i; spec Part 2 §12.2): every person the pose
// model found, the picture's points, the 3D points, how sure the model is, which way is
// down. A frame the engine reads must be one a pose model could have given; anything else
// is refused whole, so it can decide nothing. The odd numbers a real model does give are
// accepted: on Kd's barbell video a point lay at y 2.08, far below the picture, and on his
// dumbbell video a depth reached -2.1 (both measured 2026-11-16).
import { describe, expect, it } from "vitest";
import {
  DOWN_TOLERANCE,
  MAX_PEOPLE,
  POINT_LIMIT,
  bodyPointsHeaderSchema,
  movementFrameSchema,
  type BodyPointsHeader,
  type MovementFrame,
  type SeenPerson,
} from "../src/index.js";

function person(shift = 0): SeenPerson {
  return {
    points: Array.from({ length: 33 }, (_, i) => [0.3 + shift + i * 0.01, 0.1 + i * 0.02, -0.2 + i * 0.01, 0.98, 0.99]),
    world: Array.from({ length: 33 }, (_, i) => [-0.2 + i * 0.01, -0.6 + i * 0.04, 0.05]),
  };
}
function frame(over: Partial<MovementFrame> = {}): MovementFrame {
  return { t: 33.3, aspect: 1080 / 1920, down: [0, 1, 0], people: [person()], ...over };
}
const accepts = (v: unknown): boolean => movementFrameSchema.safeParse(v).success;

describe("a frame the engine reads", () => {
  it("holds every person the model found, or nobody", () => {
    expect(accepts(frame())).toBe(true);
    expect(accepts(frame({ people: [] }))).toBe(true);
    expect(accepts(frame({ people: Array.from({ length: MAX_PEOPLE }, (_, n) => person(n * 0.05)) }))).toBe(true);
  });

  it("keeps the odd numbers a real model gives", () => {
    const odd = person();
    odd.points[28] = [0.61, 2.08, -2.1, 0, 0.001]; // an ankle far below the picture, unseen
    odd.points[15] = [-0.4, 0.5, 2.55, 1, 1];
    expect(accepts(frame({ people: [odd] }))).toBe(true);
    expect(accepts(frame({ people: [{ ...person(), world: null }] }))).toBe(true);
    expect(accepts(frame({ down: null }))).toBe(true);
  });

  it("is refused for a broken number anywhere in it", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, POINT_LIMIT + 1, -(POINT_LIMIT + 1)]) {
      const p = person();
      p.points[11] = [bad, 0.3, 0, 0.9, 0.9];
      expect(accepts(frame({ people: [p] }))).toBe(false);
      const w = person();
      w.world = (w.world ?? []).map((pt, i) => (i === 25 ? [pt[0], bad, pt[2]] : pt));
      expect(accepts(frame({ people: [w] }))).toBe(false);
    }
  });

  it("is refused when the model's sureness is no share", () => {
    for (const [vis, pres] of [[1.01, 0.5], [-0.01, 0.5], [0.5, 1.2], [0.5, -1]]) {
      const p = person();
      p.points[0] = [0.5, 0.2, 0, vis ?? 0, pres ?? 0];
      expect(accepts(frame({ people: [p] }))).toBe(false);
    }
  });

  it("is refused for a person who is not 33 points, or a point that is not five numbers", () => {
    const short = person();
    short.points.pop();
    expect(accepts(frame({ people: [short] }))).toBe(false);
    expect(accepts(frame({ people: [{ ...person(), points: [...person().points, [0, 0, 0, 1, 1]] }] }))).toBe(false);
    expect(accepts({ ...frame(), people: [{ ...person(), points: person().points.map((p) => p.slice(0, 4)) }] })).toBe(false);
    expect(accepts({ ...frame(), people: [{ ...person(), world: person().world?.slice(1) }] })).toBe(false);
  });

  it("is refused for more people than a frame holds", () => {
    expect(accepts(frame({ people: Array.from({ length: MAX_PEOPLE + 1 }, () => person()) }))).toBe(false);
  });

  it("is refused when down is not a unit vector, or the picture has no possible shape", () => {
    expect(accepts(frame({ down: [0, 9.81, 0] }))).toBe(false);
    expect(accepts(frame({ down: [0, 1 + DOWN_TOLERANCE * 2, 0] }))).toBe(false);
    expect(accepts(frame({ down: [0, 0, 0] }))).toBe(false);
    expect(accepts(frame({ down: [0.6, 0.8, 0] }))).toBe(true);
    for (const aspect of [0, 0.1, 6, Number.NaN]) expect(accepts(frame({ aspect }))).toBe(false);
  });

  it("is refused for a time before the set, or anything it does not name", () => {
    expect(accepts(frame({ t: -1 }))).toBe(false);
    expect(accepts({ ...frame(), kp: [] })).toBe(false);
    expect(accepts({ ...frame(), people: [{ ...person(), id: 1 }] })).toBe(false);
  });
});

describe("a body-points file's header", () => {
  const header: BodyPointsHeader = {
    label: "squat_reference",
    source: "video",
    picture: { width: 1080, height: 1920 },
    videoFps: 30,
    fps: 30,
    model: { file: "pose_landmarker_heavy", people: 6, minDetection: 0.5, minPresence: 0.5, minTracking: 0.5 },
    madeWith: { tool: "measure-points", version: 1 },
  };

  it("says what was measured and how", () => {
    expect(bodyPointsHeaderSchema.safeParse(header).success).toBe(true);
  });

  it("never carries a path, a typed name or anything it does not name", () => {
    for (const label of ["D:\\vidoe referene\\squat", "../squat", "Kd's squat", "", "a".repeat(81)]) {
      expect(bodyPointsHeaderSchema.safeParse({ ...header, label }).success).toBe(false);
    }
    expect(bodyPointsHeaderSchema.safeParse({ ...header, model: { ...header.model, file: "C:/models/heavy" } }).success).toBe(false);
    expect(bodyPointsHeaderSchema.safeParse({ ...header, video: "squat.mp4" }).success).toBe(false);
    expect(bodyPointsHeaderSchema.safeParse({ ...header, model: { ...header.model, people: MAX_PEOPLE + 1 } }).success).toBe(false);
  });
});
