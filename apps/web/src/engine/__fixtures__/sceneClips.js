// Clips for the person check — shared by the two suites that need them.
//
// THE ORACLE PROBLEM. There is no recorded furniture clip in this repo and
// there never will be: Kd's thirteen clips live on his own machine and hold raw
// pose of a real person and a real room (DECISIONS :6386, :6856). So two of
// these are SYNTHETIC and deliberately extreme — a rigid body that moves as one
// piece, and a skeleton whose points are re-guessed every frame. The third is
// neither: it is this package's own golden recording of a real squat, shaken.
//
// They live in one file because two suites need them, and a fixture copied into
// a second suite is a fixture that drifts (:4855 — a test is a claim, and the
// FIXTURE is part of the claim).
//
// WHAT TESTS BUILT ON THESE DO NOT CLAIM: that the ruled cut-off does anything
// in particular on real furniture. That was measured on Kd's own clips with
// `packages/engine/scripts/measure-pose.ts`, and no test in this repo can
// re-measure it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTrace } from "@app/engine";

/** The app's own ~15 fps engine feed (usePoseDetection.js FEED_INTERVAL_MS). */
export const FRAME_MS = 67;

/** Deterministic PRNG — a failure must be reproducible from its seed and never
 *  from the wall clock. The same mulberry32 the engine's fuzz suite uses. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// MediaPipe landmark indices this fixture places by hand; everything else sits
// at the body centre, which is what a landmarker does with points it cannot see.
const L = {
  nose: 0,
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  left_wrist: 15,
  right_wrist: 16,
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28,
};

/** A skeleton with FIXED bone lengths at a given centre. `crouch` in [0,1]
 *  bends the knees: the whole thing moves, but it moves as one piece, which is
 *  what a real body does and what the ruled signal measures. */
export function bodyFrame(t, cx, cy, crouch) {
  const kp = Array.from({ length: 33 }, () => [cx, cy, 0, 0.99]);
  const put = (i, x, y) => {
    kp[i] = [x, y, 0, 0.99];
  };
  const shoulderY = cy - 0.12;
  const hipY = cy + 0.12;
  // Knees rise toward the hips as the crouch deepens; ankles stay planted, so
  // the projected shin shortens exactly as it does in a real side-view squat.
  const kneeY = hipY + 0.18 - 0.09 * crouch;
  const ankleY = hipY + 0.36;
  put(L.nose, cx, shoulderY - 0.08);
  put(L.left_shoulder, cx - 0.06, shoulderY);
  put(L.right_shoulder, cx + 0.06, shoulderY);
  put(L.left_elbow, cx - 0.08, shoulderY + 0.1);
  put(L.right_elbow, cx + 0.08, shoulderY + 0.1);
  put(L.left_wrist, cx - 0.09, shoulderY + 0.2);
  put(L.right_wrist, cx + 0.09, shoulderY + 0.2);
  put(L.left_hip, cx - 0.05, hipY);
  put(L.right_hip, cx + 0.05, hipY);
  put(L.left_knee, cx - 0.05, kneeY);
  put(L.right_knee, cx + 0.05, kneeY);
  put(L.left_ankle, cx - 0.05, ankleY);
  put(L.right_ankle, cx + 0.05, ankleY);
  return { t, kp };
}

/** Someone squatting in one spot: bones keep their lengths and every landmark
 *  moves together. A 24-frame cycle is ~1.6 s per rep at this feed rate. */
export function personClip(frames, seed = 7) {
  const rnd = mulberry32(seed);
  return Array.from({ length: frames }, (_, i) => {
    const crouch = (1 - Math.cos((i / 24) * Math.PI * 2)) / 2;
    return bodyFrame(
      i * FRAME_MS,
      0.5 + (rnd() - 0.5) * 0.002, // ±0.001 of tracking noise
      0.5 + (rnd() - 0.5) * 0.002 + crouch * 0.02,
      crouch,
    );
  });
}

/** A skeleton hallucinated onto furniture: every point re-guessed each frame
 *  inside the region the object occupies, so the bones are whatever the edges
 *  happened to be. This is the shape of the thing that invented ten reps in an
 *  empty room. */
export function furnitureClip(frames, seed = 11) {
  const rnd = mulberry32(seed);
  return Array.from({ length: frames }, (_, i) => ({
    t: i * FRAME_MS,
    kp: Array.from({ length: 33 }, () => [0.45 + rnd() * 0.1, 0.4 + rnd() * 0.25, 0, 0.99]),
  }));
}

/** This package's golden recording of a real squat — 109 frames, 2 reps. */
export function goldenSquat() {
  return parseTrace(
    readFileSync(join(import.meta.dirname, "squat_goodform.jsonl"), "utf8"),
  );
}

/**
 * The golden squat with every landmark shaken by up to ±`amount` each frame.
 *
 * WHY THIS EXISTS, and why it is worth more than a synthetic clip: it is the
 * SAME MOVEMENT either way. The engine counts its 2 reps at every shake
 * amount tried, measured — so when the gated path counts 0, the reps were not
 * lost to a broken pose, they were withheld because the check blanked the
 * frames. That counterfactual is the only way to prove the blanking from
 * outside, and it needs no way to switch the check off.
 *
 * 0.03 and below leaves the check silent (measured); 0.05 blocks. Real tracking
 * noise lives far below both.
 */
export function shakenSquat(amount, seed = 3) {
  const rnd = mulberry32(seed);
  return goldenSquat().frames.map((f) => ({
    t: f.t,
    kp: f.kp.map(([x, y, z, v]) => [x + (rnd() - 0.5) * amount, y + (rnd() - 0.5) * amount, z, v]),
  }));
}

/**
 * The golden squat with a BURST of shaking in the middle: frames 50–61.
 *
 * This is the clip the screen's honesty depends on, and neither of the others
 * can express it. `shakenSquat` blocks for its whole length, so the message is
 * never up while the app is counting; `goldenSquat` never blocks at all. Here
 * the check blocks, falls silent, and the engine goes on to count a REAL rep
 * while the sentence explaining the pause is still on screen — the window in
 * which a present-tense "Not counting" was a lie.
 *
 * THE NUMBERS ARE MEASURED, NOT CHOSEN FOR TIDINESS, and both matter:
 *   - the clean golden counts its two reps at frames 34 and 71;
 *   - with this burst it still counts TWO (34 and 73) — the shaking costs no
 *     rep, so the fixture is not proving something about a broken clip;
 *   - the message's tail runs frames 67–80, so rep 73 lands inside it.
 * A burst that starts earlier eats the first rep; one 20 frames later leaves
 * the tail empty and every assertion below passes vacuously. That combination
 * was found by sweeping, and the tests assert the overlap exists rather than
 * trusting these comments — a fixture is part of the claim (:4855).
 */
export function burstShakenSquat(amount = 0.05, from = 50, to = 62, seed = 3) {
  const rnd = mulberry32(seed);
  return goldenSquat().frames.map((f, i) =>
    i >= from && i < to
      ? {
          t: f.t,
          kp: f.kp.map(([x, y, z, v]) => [
            x + (rnd() - 0.5) * amount,
            y + (rnd() - 0.5) * amount,
            z,
            v,
          ]),
        }
      : { t: f.t, kp: f.kp },
  );
}

/** Trace rows → the shape the pose provider hands the bridge. */
export function toLandmarks(kp) {
  return kp.map(([x, y, z, visibility]) => ({ x, y, z, visibility }));
}
