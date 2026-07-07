// Part 2 §2.1 — PoseFrame: the engine's only input during a set.
// x,y normalized [0,1], origin top-left, y increases DOWNWARD; z = BlazePose
// relative depth (noisiest channel, used sparingly per §3.4); vis in [0,1].
// t is monotonic ms since session start — NOT wall-clock (invariant I1).
import { z } from "zod";

// §2.1: visibility gate threshold (used by §3.2 conditioning).
export const VISIBILITY_THRESHOLD = 0.3;

// §2.1: frame-rate contract — engine accepts 8–40 fps; temporal logic is
// specified in ms and converted using measured inter-frame deltas.
export const MIN_FPS = 8;
export const MAX_FPS = 40;

// §2.1: frozen BlazePose-33 index map (same table as the legacy angles.py KP dict).
export const KP = Object.freeze({
  nose: 0,
  left_eye_inner: 1,
  left_eye: 2,
  left_eye_outer: 3,
  right_eye_inner: 4,
  right_eye: 5,
  right_eye_outer: 6,
  left_ear: 7,
  right_ear: 8,
  mouth_left: 9,
  mouth_right: 10,
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  left_wrist: 15,
  right_wrist: 16,
  left_pinky: 17,
  right_pinky: 18,
  left_index: 19,
  right_index: 20,
  left_thumb: 21,
  right_thumb: 22,
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28,
  left_heel: 29,
  right_heel: 30,
  left_foot_index: 31,
  right_foot_index: 32,
} as const);

export const KEYPOINT_COUNT = 33;

// One keypoint: [x, y, z, vis]. x/y/vis bounded; z unbounded (hip-relative scale).
export const keypointSchema = z.tuple([
  z.number(), // x — nominally [0,1] but off-screen landmarks may exceed; engine gates on vis
  z.number(), // y — same convention, increases downward
  z.number(), // z — relative depth
  z.number().min(0).max(1), // vis
]);

export const poseFrameSchema = z
  .object({
    t: z.number().nonnegative().finite(), // monotonic ms since session start
    kp: z.array(keypointSchema).length(KEYPOINT_COUNT),
  })
  .strict();

export type Keypoint = z.infer<typeof keypointSchema>;
export type PoseFrame = z.infer<typeof poseFrameSchema>;
