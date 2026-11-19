// The pose model's 33 points (the same order as `KP` in @app/shared), and the pairs of them
// that a real body keeps at one length whatever it does: the bones the possible-body check
// measures (spec Part 2 §12.2, stage 2). Nothing here names an exercise.
import { KP, KEYPOINT_COUNT } from "@app/shared";

export const POINTS = KEYPOINT_COUNT;

/** The twelve big joints: what most exercises are measured from. */
export const MAIN_JOINTS: readonly number[] = [
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
];

/** Plain names, for the pictures and the table. */
export const POINT_NAMES: readonly string[] = [
  "nose",
  "left eye (inner)",
  "left eye",
  "left eye (outer)",
  "right eye (inner)",
  "right eye",
  "right eye (outer)",
  "left ear",
  "right ear",
  "mouth (left)",
  "mouth (right)",
  "left shoulder",
  "right shoulder",
  "left elbow",
  "right elbow",
  "left wrist",
  "right wrist",
  "left little finger",
  "right little finger",
  "left index finger",
  "right index finger",
  "left thumb",
  "right thumb",
  "left hip",
  "right hip",
  "left knee",
  "right knee",
  "left ankle",
  "right ankle",
  "left heel",
  "right heel",
  "left toes",
  "right toes",
];

/** The trunk's two sides, shoulder to hip: the body's own measure of size. */
export const TRUNK_SIDES: readonly (readonly [number, number])[] = [
  [KP.left_shoulder, KP.left_hip],
  [KP.right_shoulder, KP.right_hip],
];

/** Every bone. Each point belongs to at least one, so every point can be checked. */
export const BONES: readonly (readonly [number, number])[] = [
  // arms
  [KP.left_shoulder, KP.left_elbow],
  [KP.right_shoulder, KP.right_elbow],
  [KP.left_elbow, KP.left_wrist],
  [KP.right_elbow, KP.right_wrist],
  // legs
  [KP.left_hip, KP.left_knee],
  [KP.right_hip, KP.right_knee],
  [KP.left_knee, KP.left_ankle],
  [KP.right_knee, KP.right_ankle],
  // trunk
  ...TRUNK_SIDES,
  [KP.left_shoulder, KP.right_shoulder],
  [KP.left_hip, KP.right_hip],
  // hands: the wrist to each finger, and across the hand
  [KP.left_wrist, KP.left_pinky],
  [KP.left_wrist, KP.left_index],
  [KP.left_wrist, KP.left_thumb],
  [KP.left_pinky, KP.left_index],
  [KP.right_wrist, KP.right_pinky],
  [KP.right_wrist, KP.right_index],
  [KP.right_wrist, KP.right_thumb],
  [KP.right_pinky, KP.right_index],
  // feet
  [KP.left_ankle, KP.left_heel],
  [KP.left_heel, KP.left_foot_index],
  [KP.left_ankle, KP.left_foot_index],
  [KP.right_ankle, KP.right_heel],
  [KP.right_heel, KP.right_foot_index],
  [KP.right_ankle, KP.right_foot_index],
  // head: the nose to each eye point, ear and corner of the mouth; across the head
  [KP.nose, KP.left_eye_inner],
  [KP.nose, KP.left_eye],
  [KP.nose, KP.left_eye_outer],
  [KP.nose, KP.right_eye_inner],
  [KP.nose, KP.right_eye],
  [KP.nose, KP.right_eye_outer],
  [KP.nose, KP.left_ear],
  [KP.nose, KP.right_ear],
  [KP.left_ear, KP.right_ear],
  [KP.nose, KP.mouth_left],
  [KP.nose, KP.mouth_right],
  [KP.mouth_left, KP.mouth_right],
  // the head to the trunk: a head moved as one piece keeps its face's bones, never these
  [KP.nose, KP.left_shoulder],
  [KP.nose, KP.right_shoulder],
];

/** A left limb and its right twin, point for point: what a swap of left and right exchanges. */
export const LIMB_PAIRS: readonly { readonly left: readonly number[]; readonly right: readonly number[] }[] = [
  {
    left: [KP.left_elbow, KP.left_wrist, KP.left_pinky, KP.left_index, KP.left_thumb],
    right: [KP.right_elbow, KP.right_wrist, KP.right_pinky, KP.right_index, KP.right_thumb],
  },
  {
    left: [KP.left_knee, KP.left_ankle, KP.left_heel, KP.left_foot_index],
    right: [KP.right_knee, KP.right_ankle, KP.right_heel, KP.right_foot_index],
  },
];

/** The trunk's four corners: shoulders and hips. */
export const TRUNK: readonly number[] = [KP.left_shoulder, KP.right_shoulder, KP.left_hip, KP.right_hip];

/** Each point's parent: the point next to it on the way to the trunk. A point is checked
 *  through the bone to its parent, and used only while its parent is, so a wrong elbow cannot
 *  vouch for a wrong wrist, nor a hand moved in one piece for itself. The trunk's four corners
 *  and the nose have none (-1): the corners are checked by the trunk's bones, the nose by its
 *  bones to the shoulders. */
export const PARENT: readonly number[] = (() => {
  const parent = new Array<number>(POINTS).fill(-1);
  const set = (child: number, of: number): void => {
    parent[child] = of;
  };
  set(KP.left_elbow, KP.left_shoulder);
  set(KP.right_elbow, KP.right_shoulder);
  set(KP.left_wrist, KP.left_elbow);
  set(KP.right_wrist, KP.right_elbow);
  for (const finger of [KP.left_pinky, KP.left_index, KP.left_thumb]) set(finger, KP.left_wrist);
  for (const finger of [KP.right_pinky, KP.right_index, KP.right_thumb]) set(finger, KP.right_wrist);
  set(KP.left_knee, KP.left_hip);
  set(KP.right_knee, KP.right_hip);
  set(KP.left_ankle, KP.left_knee);
  set(KP.right_ankle, KP.right_knee);
  set(KP.left_heel, KP.left_ankle);
  set(KP.left_foot_index, KP.left_ankle);
  set(KP.right_heel, KP.right_ankle);
  set(KP.right_foot_index, KP.right_ankle);
  const face = [KP.left_eye_inner, KP.left_eye, KP.left_eye_outer, KP.right_eye_inner, KP.right_eye, KP.right_eye_outer];
  for (const point of [...face, KP.left_ear, KP.right_ear, KP.mouth_left, KP.mouth_right]) set(point, KP.nose);
  return parent;
})();
