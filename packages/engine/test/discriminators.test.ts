// Tests for the landmark-only "is a body actually there?" discriminators
// (camera-accuracy card, phase 2).
//
// THE ORACLE PROBLEM, and how it is solved here. There is no recorded clip in
// this repo to test against — Kd's five live on his Desktop only (raw pose of a
// real person, DECISIONS :6386), and no golden trace of furniture exists or ever
// will. So the fixtures are SYNTHETIC and deliberately extreme: a rigid body
// that moves smoothly, and a skeleton whose points are redrawn from scratch
// every frame. If a signal cannot separate those two, it cannot separate a
// person from a chair either, and the test earns its place by failing in that
// direction.
//
// What these tests DO NOT claim: that any signal works on real furniture. That
// is Kd's measurement to run on his own clips, and no cut-off is asserted here.
import { describe, expect, it } from "vitest";
import type { PoseFrame } from "@app/shared";
import { KP } from "@app/shared";
import {
  bodyCentre,
  cutoffAtCatchRate,
  cutoffAtPersonCost,
  distribution,
  readClip,
  readFrame,
  separation,
  SIGNAL_NAMES,
  torsoLength,
  windowed,
} from "../scripts/discriminators.js";

/** Deterministic PRNG — the same mulberry32 the fuzz suite uses, so a failure
 *  is reproducible from its seed and never from the wall clock (I1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FRAME_MS = 67; // the app's own ~15 fps engine feed (usePoseDetection.js)

/** A skeleton with anatomically consistent, FIXED bone lengths, placed at a
 *  given centre. `crouch` in [0,1] bends the knees — the whole body moves, but
 *  it moves as one rigid piece, which is the thing a real body does. */
function bodyFrame(t: number, cx: number, cy: number, crouch: number): PoseFrame {
  const kp: [number, number, number, number][] = Array.from(
    { length: 33 },
    () => [cx, cy, 0, 0.99] as [number, number, number, number],
  );
  const put = (i: number, x: number, y: number): void => {
    kp[i] = [x, y, 0, 0.99];
  };
  const shoulderY = cy - 0.12;
  const hipY = cy + 0.12;
  // Knees rise toward the hips as the crouch deepens; ankles stay planted, so
  // the projected tibia shortens exactly as it does in a real side-view squat.
  const kneeY = hipY + 0.18 - 0.09 * crouch;
  const ankleY = hipY + 0.36;
  put(KP.nose, cx, shoulderY - 0.08);
  put(KP.left_shoulder, cx - 0.06, shoulderY);
  put(KP.right_shoulder, cx + 0.06, shoulderY);
  put(KP.left_elbow, cx - 0.08, shoulderY + 0.1);
  put(KP.right_elbow, cx + 0.08, shoulderY + 0.1);
  put(KP.left_wrist, cx - 0.09, shoulderY + 0.2);
  put(KP.right_wrist, cx + 0.09, shoulderY + 0.2);
  put(KP.left_hip, cx - 0.05, hipY);
  put(KP.right_hip, cx + 0.05, hipY);
  put(KP.left_knee, cx - 0.05, kneeY);
  put(KP.right_knee, cx + 0.05, kneeY);
  put(KP.left_ankle, cx - 0.05, ankleY);
  put(KP.right_ankle, cx + 0.05, ankleY);
  return { t, kp };
}

/** A person doing slow squats in one spot: the centre drifts a little, the
 *  bones keep their lengths, and every landmark moves together. */
function personClip(frames: number, seed = 7): PoseFrame[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: frames }, (_, i) => {
    const crouch = (1 - Math.cos((i / 12) * Math.PI * 2)) / 2;
    // ±0.001 of tracking noise — a real landmarker is not perfectly steady.
    return bodyFrame(
      i * FRAME_MS,
      0.5 + (rnd() - 0.5) * 0.002,
      0.5 + (rnd() - 0.5) * 0.002 + crouch * 0.02,
      crouch,
    );
  });
}

/** A skeleton hallucinated onto furniture: every point re-guessed each frame
 *  inside the region the object occupies. Bone lengths are whatever the edges
 *  happened to be, and no two points agree about where "the body" went. */
function furnitureClip(frames: number, seed = 11): PoseFrame[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: frames }, (_, i) => ({
    t: i * FRAME_MS,
    kp: Array.from(
      { length: 33 },
      () => [0.45 + rnd() * 0.1, 0.4 + rnd() * 0.25, 0, 0.99] as [number, number, number, number],
    ),
  }));
}

describe("torsoLength / bodyCentre", () => {
  it("measures the shoulder-to-hip span and the centre of the four torso points", () => {
    const f = bodyFrame(0, 0.5, 0.5, 0);
    // shoulders at y=0.38, hips at y=0.62 → span 0.24, centre y = 0.5.
    expect(torsoLength(f)).toBeCloseTo(0.24, 6);
    const centre = bodyCentre(f);
    expect(centre?.[0]).toBeCloseTo(0.5, 6);
    expect(centre?.[1]).toBeCloseTo(0.5, 6);
  });

  it("returns null rather than a number when a torso landmark is missing", () => {
    const f = bodyFrame(0, 0.5, 0.5, 0);
    const broken: PoseFrame = {
      t: f.t,
      kp: f.kp.map((row, i) =>
        i === KP.left_hip ? [Number.NaN, Number.NaN, 0, 0.99] : row,
      ),
    };
    // A substituted zero here would read downstream as "perfectly still" —
    // the exact shape of lie this card exists to remove.
    expect(torsoLength(broken)).toBeNull();
    expect(bodyCentre(broken)).toBeNull();
  });

  it("returns null when every landmark has collapsed to one point", () => {
    const collapsed: PoseFrame = {
      t: 0,
      kp: Array.from({ length: 33 }, () => [0.5, 0.5, 0, 0.99] as [number, number, number, number]),
    };
    expect(torsoLength(collapsed)).toBeNull();
  });
});

describe("readFrame", () => {
  it("reports nothing measurable on the first frame of a clip", () => {
    const r = readFrame(bodyFrame(0, 0.5, 0.5, 0), null);
    expect(r.centre_drift).toBeNull();
    expect(r.bone_stretch).toBeNull();
    expect(r.motion_incoherence).toBeNull();
    // ...except asymmetry, which needs no history.
    expect(r.limb_asymmetry).not.toBeNull();
  });

  it("skips a pair whose frames are further apart than the gap allowance", () => {
    const a = bodyFrame(0, 0.5, 0.5, 0);
    const far = bodyFrame(2000, 0.6, 0.5, 0);
    expect(readFrame(far, a, 500).centre_drift).toBeNull();
    // The identical pair inside the allowance IS measured — proving the null
    // above comes from the gap rule and not from the frames being unreadable.
    const near = bodyFrame(400, 0.6, 0.5, 0);
    expect(readFrame(near, a, 500).centre_drift).not.toBeNull();
  });

  it("expresses drift as a RATE: half the time step, double the reading", () => {
    const a = bodyFrame(0, 0.5, 0.5, 0);
    const slow = readFrame(bodyFrame(100, 0.51, 0.5, 0), a).centre_drift;
    const fast = readFrame(bodyFrame(50, 0.51, 0.5, 0), a).centre_drift;
    expect(slow).not.toBeNull();
    expect(fast).toBeCloseTo((slow ?? 0) * 2, 6);
  });

  it("is scale-invariant: the same motion twice as far from the camera reads the same", () => {
    // Everything (including the step) halved — a smaller person moving
    // proportionally must not score as jitterier than a nearer one.
    const near = readFrame(bodyFrame(FRAME_MS, 0.52, 0.5, 0), bodyFrame(0, 0.5, 0.5, 0));
    const shrink = (f: PoseFrame): PoseFrame => ({
      t: f.t,
      kp: f.kp.map((row) => [
        0.5 + (row[0] - 0.5) / 2,
        0.5 + (row[1] - 0.5) / 2,
        row[2],
        row[3],
      ]),
    });
    const far = readFrame(
      shrink(bodyFrame(FRAME_MS, 0.52, 0.5, 0)),
      shrink(bodyFrame(0, 0.5, 0.5, 0)),
    );
    expect(far.centre_drift).toBeCloseTo(near.centre_drift ?? 0, 6);
  });

  it("reads zero stretch on a rigid body that is moving", () => {
    // A body translating bodily across the frame changes no bone length.
    const r = readFrame(bodyFrame(FRAME_MS, 0.6, 0.5, 0), bodyFrame(0, 0.5, 0.5, 0));
    expect(r.bone_stretch).toBeCloseTo(0, 9);
    expect(r.centre_drift).toBeGreaterThan(0);
  });
});

describe("windowed", () => {
  it("takes the median, so one spiking frame cannot trip a gate", () => {
    const flat = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const spiked = [...flat];
    spiked[5] = 1000;
    const out = windowed(spiked, 5);
    expect(out[9]).toBe(1);
    expect(Math.max(...out.filter((v): v is number => v !== null))).toBe(1);
  });

  it("stays null until the window holds enough real readings", () => {
    const out = windowed([null, null, 1, 1, 1, 1], 6);
    expect(out[0]).toBeNull();
    expect(out[2]).toBeNull(); // 1 reading, needs 3
    expect(out[5]).toBe(1); // 4 readings
  });
});

describe("separation (AUC)", () => {
  it("is 1 when the piles never overlap and 0.5 when they are identical", () => {
    expect(separation([1, 2, 3], [4, 5, 6])).toBe(1);
    expect(separation([4, 5, 6], [1, 2, 3])).toBe(0);
    expect(separation([1, 2, 3], [1, 2, 3])).toBe(0.5);
  });

  it("counts ties as half, so a constant signal scores 0.5 and not 1", () => {
    expect(separation([1, 1], [1, 1])).toBe(0.5);
  });

  it("ignores nulls rather than treating them as zero", () => {
    expect(separation([1, null, 2, 3], [4, null, 5, 6])).toBe(1);
  });
});

describe("operating points", () => {
  const person = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const nobody = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

  it("pins the cut-off by the PERSON cost and reports the furniture caught", () => {
    const p = cutoffAtPersonCost(person, nobody, 0.1);
    expect(p?.cutoff).toBe(10);
    expect(p?.personRejected).toBe(0);
    expect(p?.nobodyCaught).toBe(1);
  });

  it("reports a real cost when the piles overlap — it never hides one", () => {
    const overlapping = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
    const p = cutoffAtPersonCost(overlapping, nobody, 0.5);
    // Half the person readings sit above the cut-off, and the table says so.
    expect(p?.personRejected).toBeGreaterThan(0.3);
  });

  it("gives the mirror view: catch 95% of furniture, and what it costs", () => {
    const p = cutoffAtCatchRate(person, nobody, 0.95);
    expect(p?.nobodyCaught).toBeGreaterThanOrEqual(0.9);
    expect(p?.personRejected).toBe(0);
  });

  it("returns null instead of a fabricated cut-off when a pile is empty", () => {
    expect(cutoffAtPersonCost([], nobody, 0.01)).toBeNull();
    expect(cutoffAtCatchRate(person, [], 0.95)).toBeNull();
  });
});

describe("the whole pipeline on synthetic clips", () => {
  const window = 15;
  const person = readClip(personClip(180), window);
  const furniture = readClip(furnitureClip(180), window);

  it("separates a rigid moving body from a re-guessed skeleton, on every signal", () => {
    for (const name of SIGNAL_NAMES) {
      const auc = separation(person.windows[name], furniture.windows[name]);
      // 0.5 is a worthless signal. Anything that cannot clear this on fixtures
      // this extreme has no chance on a real chair, and should be deleted
      // rather than carried into the threshold conversation.
      expect(auc, `${name} separation`).toBeGreaterThan(0.9);
    }
  });

  it("reads the person clip as the QUIETER one — the direction the gate depends on", () => {
    // Every signal runs one way (higher = more like furniture). A signal that
    // silently ran backwards would invert the gate and reject real users.
    for (const name of SIGNAL_NAMES) {
      const p = distribution(person.windows[name]);
      const f = distribution(furniture.windows[name]);
      expect(f.median, `${name} median`).toBeGreaterThan(p.median);
    }
  });

  it("produces readings for most frames rather than a mostly-null series", () => {
    for (const name of SIGNAL_NAMES) {
      const d = distribution(person.windows[name]);
      expect(d.count, `${name} count`).toBeGreaterThan(150);
    }
  });

  it("counts the skipped gaps instead of quietly measuring across them", () => {
    const frames = personClip(20);
    const gapped = frames.map((f, i) => (i >= 10 ? { ...f, t: f.t + 5000 } : f));
    expect(readClip(gapped, window).gapsSkipped).toBe(1);
    expect(readClip(frames, window).gapsSkipped).toBe(0);
  });
});
