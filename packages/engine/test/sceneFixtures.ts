// Synthetic clips for the scene checks (the four discriminators and the gate
// built on them).
//
// THE ORACLE PROBLEM, and how it is solved here. There is no recorded clip in
// this repo to test against — Kd's live on his own machine (raw pose of a real
// person, DECISIONS :6386, :6856), and no golden trace of furniture exists or
// ever will. So the fixtures are SYNTHETIC and deliberately extreme: a rigid
// body that moves smoothly, and a skeleton whose points are redrawn from
// scratch every frame. If a signal cannot separate those two, it cannot
// separate a person from a chair either, and a test earns its place by failing
// in that direction.
//
// What tests built on these DO NOT claim: that any signal works on real
// furniture. That is measured on Kd's own clips with `scripts/measure-pose.ts`,
// and no cut-off is asserted anywhere in this package.
//
// They live in their own file because two suites need them, and a fixture
// copied into a second suite is a fixture that drifts (:4855 — a test is a
// claim and the FIXTURE is part of the claim).
import type { PoseFrame } from "@app/shared";
import { KP } from "@app/shared";

/** Deterministic PRNG — the same mulberry32 the fuzz suite uses, so a failure
 *  is reproducible from its seed and never from the wall clock (I1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FRAME_MS = 67; // the app's own ~15 fps engine feed (usePoseDetection.js)

/** A skeleton with anatomically consistent, FIXED bone lengths, placed at a
 *  given centre. `crouch` in [0,1] bends the knees — the whole body moves, but
 *  it moves as one rigid piece, which is the thing a real body does. */
export function bodyFrame(t: number, cx: number, cy: number, crouch: number): PoseFrame {
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
export function personClip(frames: number, seed = 7): PoseFrame[] {
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
export function furnitureClip(frames: number, seed = 11): PoseFrame[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: frames }, (_, i) => ({
    t: i * FRAME_MS,
    kp: Array.from(
      { length: 33 },
      () => [0.45 + rnd() * 0.1, 0.4 + rnd() * 0.25, 0, 0.99] as [number, number, number, number],
    ),
  }));
}
