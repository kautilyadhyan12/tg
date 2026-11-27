import { KP } from "@app/shared";

// The camera screen's drawing of the person it follows (ROADMAP Stage 5 53a, Kd's drawing of 2026-11-26): the body's
// lines and joints, and the corners round the person. Drawn by the phone itself, over the very picture the model read and
// in the same moment (modules/pose-camera's BodyOverlay): drawn here, by the app's script, the lines reached the screen
// after the picture and fell further behind (Kd at 53a's run, "the lines lagging a lot again"). These are its rules,
// handed to the phone once. Pure.

/** The lines drawn, as the drawing has them: the arms, the shoulders and hips, the trunk's sides, the legs. */
export const BODY_LINES: readonly (readonly [number, number])[] = [
  [KP.left_wrist, KP.left_elbow],
  [KP.left_elbow, KP.left_shoulder],
  [KP.left_shoulder, KP.right_shoulder],
  [KP.right_shoulder, KP.right_elbow],
  [KP.right_elbow, KP.right_wrist],
  [KP.left_shoulder, KP.left_hip],
  [KP.right_shoulder, KP.right_hip],
  [KP.left_hip, KP.right_hip],
  [KP.left_hip, KP.left_knee],
  [KP.left_knee, KP.left_ankle],
  [KP.right_hip, KP.right_knee],
  [KP.right_knee, KP.right_ankle],
];

/** The joints drawn as rings: the big joints, the ankles included. */
export const BODY_JOINTS: readonly number[] = [
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

/** A point the model gives less than an even chance of being seen, or of being in the picture, is not drawn: the engine
 *  uses it for nothing either (its "hidden"). */
const SURE = 0.5;
/** The corners stand this far out from the body, a share of its height. */
const ROOM = 0.06;

/** The drawing's rules as the phone takes them (modules/pose-camera's `BodyDrawing`): the lines as pairs of points one
 *  after the other, the ringed joints, the head (the corners reach up to it), how sure, and the corners' room. */
export interface BodyRules {
  readonly lines: readonly number[];
  readonly joints: readonly number[];
  readonly nose: number;
  readonly sure: number;
  readonly room: number;
}

export const BODY_RULES: BodyRules = { lines: BODY_LINES.flat(), joints: BODY_JOINTS, nose: KP.nose, sure: SURE, room: ROOM };
