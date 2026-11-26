import { KP, type SeenPerson } from "@app/shared";

// The camera screen's drawing of the person it follows (ROADMAP Stage 5 53a, Kd's drawing of 2026-11-26): the body's
// lines and joints, and the corners round the person, laid on the camera's picture as the screen shows it. Pure.
//
// The screen shows the picture filling it (cut at its sides or top, never stretched, as the camera module's
// PreviewView FILL_CENTER does) and mirrored, as every selfie camera shows a person; the model read the picture as the
// camera took it, unmirrored. So a point at x across the picture lies at the mirror of x on the screen.

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

export interface Drawn {
  readonly lines: readonly (readonly [number, number, number, number])[];
  readonly joints: readonly (readonly [number, number])[];
  /** The corners' box round the body; null with too little of it seen. */
  readonly box: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } | null;
}

export const NOTHING_DRAWN: Drawn = { lines: [], joints: [], box: null };

/** The person on a screen `width` by `height`, from a picture `aspect` (width / height) wide. */
export function drawn(person: SeenPerson | null, aspect: number, width: number, height: number): Drawn {
  if (person === null || !(aspect > 0) || !(width > 0) || !(height > 0)) return NOTHING_DRAWN;
  // The picture fills the screen: as tall as the screen, or as wide, whichever covers it; centred.
  const scale = Math.max(width / aspect, height);
  const shownWidth = scale * aspect;
  const left = (width - shownWidth) / 2;
  const top = (height - scale) / 2;
  const at = (k: number): [number, number] | null => {
    const p = person.points[k];
    if (p === undefined) return null;
    const [x, y, , visible, present] = p;
    if (visible < SURE || present < SURE) return null;
    return [width - (left + x * shownWidth), top + y * scale];
  };
  const lines: [number, number, number, number][] = [];
  for (const [a, b] of BODY_LINES) {
    const from = at(a);
    const to = at(b);
    if (from !== null && to !== null) lines.push([from[0], from[1], to[0], to[1]]);
  }
  const joints = BODY_JOINTS.map(at).filter((p): p is [number, number] => p !== null);
  if (joints.length < 4) return { lines, joints, box: null };
  const xs = joints.map((j) => j[0]);
  const ys = joints.map((j) => j[1]);
  const head = at(KP.nose);
  if (head !== null) ys.push(head[1]);
  const room = (Math.max(...ys) - Math.min(...ys)) * ROOM;
  return {
    lines,
    joints,
    box: { left: Math.min(...xs) - room, top: Math.min(...ys) - room * 2, right: Math.max(...xs) + room, bottom: Math.max(...ys) + room },
  };
}
