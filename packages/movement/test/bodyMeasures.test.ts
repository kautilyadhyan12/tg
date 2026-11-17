// The body measures (ROADMAP 50c-iii, spec Part 2 §12.2 stage 4) on bodies made by hand, where
// the right answer is known: each body is drawn on the picture exactly as its 3D points lie, then
// changed in one way only (the phone tilted, the picture's shape, nearer, smaller, a foot lifted).
import { describe, expect, it } from "vitest";
import { KP, type Down } from "@app/shared";
import { BodyMeasures, MEASURE_LIST, type MeasureName, type MeasuredBody, type SteadyBody } from "../src/index.js";

type P = [number, number, number];

/** A body seen from its left side, facing the picture's left, sitting with thighs level, shins
 *  upright, upper arms hanging and forearms reaching forward: every joint at 90° or 0°. Metres,
 *  centred between the hips, y down, z away from the camera (the near side is the left). */
function seated(): P[] {
  const body: P[] = Array.from({ length: 33 }, (): P => [-0.08, -0.68, 0]);
  const both = (left: number, right: number, x: number, y: number): void => {
    body[left] = [x, y, -0.1];
    body[right] = [x, y, 0.1];
  };
  both(KP.left_shoulder, KP.right_shoulder, 0, -0.5);
  both(KP.left_elbow, KP.right_elbow, 0, -0.22);
  both(KP.left_wrist, KP.right_wrist, -0.25, -0.22);
  both(KP.left_pinky, KP.right_pinky, -0.31, -0.21);
  both(KP.left_index, KP.right_index, -0.32, -0.22);
  both(KP.left_thumb, KP.right_thumb, -0.29, -0.24);
  both(KP.left_hip, KP.right_hip, 0, 0);
  both(KP.left_knee, KP.right_knee, -0.42, 0);
  both(KP.left_ankle, KP.right_ankle, -0.42, 0.42);
  both(KP.left_heel, KP.right_heel, -0.36, 0.48);
  both(KP.left_foot_index, KP.right_foot_index, -0.55, 0.48);
  return body;
}

/** The same side-on body standing: legs straight, arms hanging. */
function standingSide(): P[] {
  const body = seated();
  const set = (left: number, right: number, x: number, y: number): void => {
    body[left] = [x, y, -0.1];
    body[right] = [x, y, 0.1];
  };
  set(KP.left_wrist, KP.right_wrist, 0, 0.04);
  set(KP.left_knee, KP.right_knee, 0, 0.42);
  set(KP.left_ankle, KP.right_ankle, 0, 0.84);
  set(KP.left_heel, KP.right_heel, 0.06, 0.9);
  set(KP.left_foot_index, KP.right_foot_index, -0.13, 0.9);
  return body;
}

/** Lying on a bench with the head towards the camera, as from the head end of the bench: the
 *  trunk runs away from the camera, its shoulders 3 cm higher on the picture than its hips. */
function lyingHeadToCamera(): P[] {
  const body: P[] = Array.from({ length: 33 }, (): P => [0, -0.06, -0.72]);
  const both = (left: number, right: number, x: number, y: number, z: number): void => {
    body[left] = [x, y, z];
    body[right] = [-x, y, z];
  };
  both(KP.left_shoulder, KP.right_shoulder, 0.2, -0.03, -0.5);
  both(KP.left_elbow, KP.right_elbow, 0.32, 0.05, -0.45);
  both(KP.left_wrist, KP.right_wrist, 0.3, -0.2, -0.45);
  both(KP.left_hip, KP.right_hip, 0.1, 0, 0);
  both(KP.left_knee, KP.right_knee, 0.15, 0, 0.42);
  both(KP.left_ankle, KP.right_ankle, 0.15, 0.42, 0.45);
  both(KP.left_heel, KP.right_heel, 0.15, 0.48, 0.42);
  both(KP.left_foot_index, KP.right_foot_index, 0.15, 0.48, 0.6);
  return body;
}

interface Look {
  readonly aspect?: number;
  /** Picture heights a metre. */
  readonly size?: number;
  readonly down?: Down | null;
  /** Points the possible-body check refused. */
  readonly hidden?: readonly number[];
  /** Where the body's middle is on the picture, metres from the picture's top left. */
  readonly at?: readonly [number, number];
}

/** One frame: the 3D points drawn on the picture as they lie, depth dropped. */
function frame(t: number, world: readonly P[], look: Look = {}): SteadyBody {
  const aspect = look.aspect ?? 9 / 16;
  const size = look.size ?? 0.45;
  const [ax, ay] = look.at ?? [0.6, 0.9];
  const hidden = new Set(look.hidden ?? []);
  const points = world.map((w, i) => (hidden.has(i) ? null : { x: (size * (ax + w[0])) / aspect, y: size * (ay + w[1]), world: w }));
  return { t, aspect, down: look.down === undefined ? [0, 1, 0] : look.down, size, points, refused: points.map((p) => (p === null ? "hidden" : null)) };
}

/** `frames` of one body through one BodyMeasures, in order; the last one's measures. */
function measure(frames: readonly SteadyBody[]): MeasuredBody[] {
  const m = new BodyMeasures();
  return frames.map((f) => m.next(f));
}
function once(world: readonly P[], look: Look = {}): MeasuredBody {
  const last = measure([frame(0, world, look)])[0];
  if (last === undefined) throw new Error("no frame");
  return last;
}
function read(body: MeasuredBody, name: MeasureName): { flat: number | null; world: number | null; shown: number | null } {
  const r = body.readings.get(name);
  if (r === undefined) throw new Error(`no ${name}`);
  return r;
}

function rotateInPicture(p: readonly number[], degrees: number): P {
  const a = (degrees * Math.PI) / 180;
  const [x = 0, y = 0, z = 0] = p;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
}
function pitch(p: readonly number[], degrees: number): P {
  const a = (degrees * Math.PI) / 180;
  const [x = 0, y = 0, z = 0] = p;
  return [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
}

describe("the worst thing: a part pointing at the camera is never read on the flat picture", () => {
  it("the lying man's trunk, seen from the head end of the bench: refused flat, about 90° in 3D", () => {
    const body = once(lyingHeadToCamera());
    const trunk = read(body, "trunk lean");
    // On the picture the trunk is 6 cm long against 1 m of its two sides together, and points
    // up: read flat it would say "upright". Each side alone shows 0.2 of itself.
    expect(trunk.flat).toBeNull();
    expect(trunk.shown).toBeCloseTo(0.06 / Math.hypot(0.06, 1), 6);
    expect(trunk.world).toBeCloseTo((Math.acos(0.06 / Math.hypot(0.06, 1)) * 180) / Math.PI, 6);
  });

  it("a joint one of whose parts points at the camera is refused flat; the same joint across the picture is read", () => {
    const body = seated();
    // The left forearm reaches straight at the camera instead of forward.
    body[KP.left_wrist] = [0, -0.22, -0.35];
    const m = once(body);
    expect(read(m, "left elbow").flat).toBeNull();
    expect(read(m, "left elbow").world).toBeCloseTo(90, 6);
    expect(read(m, "right elbow").flat).toBeCloseTo(90, 6);
  });
});

describe("a body whose answers are known", () => {
  const m = once(seated());

  it("every measure of the list is read or refused, none missing", () => {
    expect([...m.readings.keys()]).toEqual(MEASURE_LIST.map((x) => x.name));
  });

  it("the joints, flat and in 3D", () => {
    for (const [name, angle] of [
      ["left knee", 90],
      ["left hip", 90],
      ["left elbow", 90],
      ["left shoulder", 0],
      ["right knee", 90],
    ] as const) {
      expect([name, read(m, name).flat]).toEqual([name, expect.closeTo(angle, 6)]);
      expect([name, read(m, name).world]).toEqual([name, expect.closeTo(angle, 6)]);
      expect([name, read(m, name).shown]).toEqual([name, expect.closeTo(1, 6)]);
    }
  });

  it("the leans against down", () => {
    for (const [name, angle] of [
      ["trunk lean", 0],
      ["left thigh lean", 90],
      ["left shin lean", 0],
      ["left upper arm lean", 0],
      ["left forearm lean", 90],
    ] as const) {
      expect([name, read(m, name).flat]).toEqual([name, expect.closeTo(angle, 6)]);
      expect([name, read(m, name).world]).toEqual([name, expect.closeTo(angle, 6)]);
    }
  });

  it("the heights above the floor, in legs (0.84 m), and the body's own lengths", () => {
    expect(m.leg).toBeCloseTo(0.84, 9);
    expect(m.trunk).toBeCloseTo(0.5, 9);
    expect(read(m, "hips height").flat).toBeCloseTo(0.48 / 0.84, 6);
    expect(read(m, "hips height").world).toBeCloseTo(0.48 / 0.84, 6);
    expect(read(m, "left ankle height").flat).toBeCloseTo(0.06 / 0.84, 6);
    expect(read(m, "left wrist height").world).toBeCloseTo(0.7 / 0.84, 6);
  });

  it("the feet apart across the body, which the side view cannot show: 3D only", () => {
    expect(read(m, "feet apart").world).toBeCloseTo(0.2 / 0.5, 6);
    expect(read(m, "feet apart").flat).toBeNull();
    expect(read(m, "feet apart").shown).toBeCloseTo(0, 6);
  });

  it("left against right: the left's reading less the right's", () => {
    const body = seated();
    body[KP.right_ankle] = [-0.42 - 0.42 * Math.sin(Math.PI / 6), 0.42 * Math.cos(Math.PI / 6), 0.1];
    body[KP.right_heel] = [-0.6, 0.45, 0.1];
    body[KP.right_foot_index] = [-0.75, 0.38, 0.1];
    const r = read(once(body), "knees, left against right");
    expect(r.flat).toBeCloseTo(-30, 6);
    expect(r.world).toBeCloseTo(-30, 6);
  });
});

describe("the same body, seen differently, measures the same", () => {
  const base = once(seated());
  const same = (other: MeasuredBody, which: "flat" | "world" | "both"): void => {
    for (const { name } of MEASURE_LIST) {
      const a = read(base, name);
      const b = read(other, name);
      // Within a ten-thousandth of a degree (or of a length): an angle near 0 or 180 is where
      // the rounding of the turned points shows most.
      const near = (x: number | null, y: number | null): boolean => (x === null) === (y === null) && (x === null || y === null || Math.abs(x - y) < 1e-4);
      if (which !== "world") expect([name, "flat", near(a.flat, b.flat)]).toEqual([name, "flat", true]);
      if (which !== "flat") expect([name, "3D", near(a.world, b.world)]).toEqual([name, "3D", true]);
    }
  };

  it("a wide picture and a tall one", () => {
    same(once(seated(), { aspect: 16 / 9 }), "both");
  });

  it("nearer the phone and further from it", () => {
    same(once(seated(), { size: 0.2 }), "both");
    same(once(seated(), { size: 0.8, at: [0.3, 0.6] }), "both");
  });

  it("a child: every length 0.6 times", () => {
    const child = once(seated().map((p) => [p[0] * 0.6, p[1] * 0.6, p[2] * 0.6]));
    same(child, "both");
    expect(child.leg).toBeCloseTo(0.84 * 0.6, 9);
  });

  it("the phone turned 20° in its own plane, with down turned the same", () => {
    const turned = seated().map((p) => rotateInPicture(p, 20));
    const down = rotateInPicture([0, 1, 0], 20);
    same(once(turned, { down }), "both");
  });

  it("the phone tipped back 30°: the 3D readings are the same; flat, a height is shown at cos 30° at most", () => {
    const tipped = seated().map((p) => pitch(p, 30));
    const down = pitch([0, 1, 0], 30);
    const m = once(tipped, { down });
    same(m, "world");
    const hips = read(m, "hips height");
    expect(hips.shown).toBeLessThanOrEqual(Math.cos(Math.PI / 6) + 1e-9);
    expect(hips.shown).toBeGreaterThan(0.5);
    expect(read(once(seated()), "hips height").shown).toBeGreaterThan(0.94);
  });
});

describe("what decides nothing", () => {
  it("a refused wrist takes every measure of it, and nothing else", () => {
    const m = once(seated(), { hidden: [KP.left_wrist] });
    const of = ["left elbow", "left forearm lean", "left wrist height", "hands apart", "elbows, left against right", "forearms, left against right", "wrist heights, left against right"];
    for (const { name } of MEASURE_LIST) {
      const r = read(m, name);
      if (of.includes(name)) expect([name, r.flat, r.world]).toEqual([name, null, null]);
    }
    expect(read(m, "left knee").flat).toBeCloseTo(90, 6);
    expect(read(m, "right elbow").world).toBeCloseTo(90, 6);
  });

  it("with no foot ever seen there is no floor, so no height; the rest is read", () => {
    const feet = [KP.left_heel, KP.right_heel, KP.left_foot_index, KP.right_foot_index];
    const m = once(seated(), { hidden: feet });
    expect(read(m, "hips height")).toEqual({ flat: null, world: null, shown: null });
    expect(read(m, "left knee").flat).toBeCloseTo(90, 6);
    expect(read(m, "hands apart").world).toBeCloseTo(0.4, 6);
  });

  it("without down, no lean and no height; the joints are read", () => {
    const m = once(seated(), { down: null });
    expect(read(m, "trunk lean")).toEqual({ flat: null, world: null, shown: null });
    expect(read(m, "hips height")).toEqual({ flat: null, world: null, shown: null });
    expect(read(m, "left knee").world).toBeCloseTo(90, 6);
  });

  it("a flat reading is never given without its 3D one", () => {
    for (const m of [once(seated()), once(lyingHeadToCamera()), once(seated(), { hidden: [KP.left_wrist, KP.right_knee] })]) {
      for (const r of m.readings.values()) if (r.flat !== null) expect(r.world).not.toBeNull();
    }
  });
});

describe("the floor stays where the feet stood", () => {
  const far = [KP.right_knee, KP.right_ankle, KP.right_heel, KP.right_foot_index];
  /** Standing side on, the far leg hidden; from 1 s the near thigh is raised 45° forward with
   *  the shin hanging from it, so the foot leaves the floor. */
  const knee = 0.42 * Math.SQRT1_2;
  const liftedLeft = (): P[] => {
    const body = standingSide();
    body[KP.left_knee] = [-knee, knee, -0.1];
    body[KP.left_ankle] = [-knee, knee + 0.42, -0.1];
    body[KP.left_heel] = [-knee + 0.06, knee + 0.48, -0.1];
    body[KP.left_foot_index] = [-knee - 0.13, knee + 0.48, -0.1];
    return body;
  };
  const oneLeg = Array.from({ length: 91 }, (_, n) => {
    const t = Math.round((n * 1000) / 30);
    return frame(t, t >= 1000 ? liftedLeft() : standingSide(), { hidden: far });
  });

  it("one foot lifted while the other is hidden: the hips stay at standing height, the lifted ankle rises", () => {
    const run = measure(oneLeg);
    const first = run[0];
    const last = run[run.length - 1];
    if (first === undefined || last === undefined) throw new Error("no frames");
    for (const which of ["flat", "world"] as const) {
      expect([which, read(last, "hips height")[which]]).toEqual([which, expect.closeTo(read(first, "hips height")[which] ?? Number.NaN, 6)]);
      expect([which, read(last, "left ankle height")[which]]).toEqual([which, expect.closeTo((0.9 - knee - 0.42) / 0.84, 6)]);
    }
  });

  /** Standing, both feet seen; the whole body rises 30 cm on the picture from 1 s, for `seconds`. */
  const rise = (seconds: number): SteadyBody[] =>
    Array.from({ length: 121 }, (_, n) => {
      const t = Math.round((n * 1000) / 30);
      const up = t >= 1000 && t < 1000 + seconds * 1000 ? 0.3 : 0;
      return frame(t, standingSide(), { at: [0.6, 0.9 - up] });
    });

  it("a jump: half a second in the air leaves the floor where it was", () => {
    const run = measure(rise(0.5));
    const inAir = run.find((m) => m.t >= 1400);
    if (inAir === undefined) throw new Error("no frame");
    expect(read(inAir, "hips height").flat).toBeCloseTo(0.9 / 0.84 + 0.3 / 0.84, 6);
    expect(read(inAir, "hips height").world).toBeCloseTo(0.9 / 0.84 + 0.3 / 0.84, 6);
  });

  it("both feet seen higher for longer than a jump: the floor moves up to them", () => {
    const run = measure(rise(3));
    const later = run.find((m) => m.t >= 2200);
    if (later === undefined) throw new Error("no frame");
    expect(read(later, "hips height").flat).toBeCloseTo(0.9 / 0.84, 6);
    expect(read(later, "hips height").world).toBeCloseTo(0.9 / 0.84, 6);
  });

  it("a clock that goes back forgets the floor and the lengths", () => {
    const m = new BodyMeasures();
    m.next(frame(5000, standingSide()));
    const back = m.next(frame(1000, standingSide(), { hidden: [KP.left_heel, KP.right_heel, KP.left_foot_index, KP.right_foot_index] }));
    expect(read(back, "hips height").flat).toBeNull();
  });

  it("no height while no foot is in view; no foot seen for longer than 3 s forgets the floor", () => {
    const feet = [KP.left_heel, KP.right_heel, KP.left_foot_index, KP.right_foot_index];
    const after = (gap: number): number | null => {
      const m = new BodyMeasures();
      m.next(frame(0, standingSide(), { hidden: far }));
      expect(read(m.next(frame(gap / 2, standingSide(), { hidden: feet })), "hips height").flat).toBeNull();
      return read(m.next(frame(gap, liftedLeft(), { hidden: far })), "hips height").flat;
    };
    // The near foot comes back lifted: within 3 s the floor is where it stood; after, the lifted
    // foot is all there is to stand on.
    expect(after(2900)).toBeCloseTo(0.9 / 0.84, 6);
    expect(after(3100)).toBeCloseTo((0.9 - (0.9 - knee - 0.48)) / 0.84, 6);
  });
});
