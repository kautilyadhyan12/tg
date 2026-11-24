// Which person of a reference video is followed, until job 52d locks on to one (spec Part 2
// §11.8, §12.2 stage 1): the largest body in the first frame with anybody, then in each frame
// the body whose trunk lies nearest to where the followed one last was. It cannot tell a man
// from his reflection, or from the model finding him twice. Since 51c the kept files are asked
// for one person, as the phone asks, so the model itself follows one body and this picks the
// only one; whether that body stays the same is `bodyChanges`'s plain sign, below.
import { KP, type MovementFrame, type SeenPerson } from "@app/shared";
import { LIMITS, bodySize } from "../src/index.js";

/** A point the model is less sure of than the possible-body check trusts gives the size nothing. */
const SURE = LIMITS.sure;

const TRUNK = [KP.left_shoulder, KP.right_shoulder, KP.left_hip, KP.right_hip];

function trunkCentre(person: SeenPerson, aspect: number): [number, number] {
  let x = 0;
  let y = 0;
  for (const i of TRUNK) {
    x += (person.points[i]?.[0] ?? 0) * aspect;
    y += person.points[i]?.[1] ?? 0;
  }
  return [x / TRUNK.length, y / TRUNK.length];
}

/** The longer side of the box round the body's points, in picture heights. */
function extent(person: SeenPerson, aspect: number): number {
  const xs = person.points.map((p) => p[0] * aspect);
  const ys = person.points.map((p) => p[1]);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

export function followOne(frames: readonly MovementFrame[]): (SeenPerson | null)[] {
  let last: [number, number] | null = null;
  return frames.map((frame) => {
    let best: SeenPerson | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const person of frame.people) {
      const c = trunkCentre(person, frame.aspect);
      const score = last === null ? -extent(person, frame.aspect) : Math.hypot(c[0] - last[0], c[1] - last[1]);
      if (score < bestScore) {
        bestScore = score;
        best = person;
      }
    }
    if (best !== null) last = trunkCentre(best, frame.aspect);
    return best;
  });
}

// ── The plain sign that the body followed has changed (ROADMAP 51c) ─────────────────────
/** Faster than this, metres a second across the picture, the body's middle has not moved: another body was taken.
 *  The fastest a person exercising in front of a phone moves their trunk is a jump's take-off: for a jump of 1.1 m,
 *  the highest the engine allows for (spec §12.2's floor), √(2 · 9.81 · 1.1) = 4.6 m/s. Measured on Kd's six videos,
 *  the full model asked for one person: at most 1.5 m/s. A woman put in the squatting woman's place, 0.38 m off, moves
 *  it 11.3 m/s; another body of the same size at the same place cannot be told by this sign (job 52d). A trunk moving
 *  straight up or down is a jump, and has its own limit (`JUMP_SPEED`). */
export const CHANGED_SPEED = 5;
/** A trunk moving straight up or down the picture, under `STRAIGHT` across "down", is another body only faster than this,
 *  m/s: a jump's take-off or landing, where the trunk also rises from its lean or folds into it. Measured on Kd's four
 *  squat-jump videos (52c-i), each frame drawn and the one person followed: 5.1 to 7.1 m/s along "down" from one frame to
 *  the next, at most 0.6 across it. Every real change of body on the files here moves across: the twelve swaps of the
 *  videos that set numbers 2.2 to 9.1 m/s across, the old six-person bench file's follower 2.7 to 3.4. */
export const JUMP_SPEED = 8;
/** Across "down", m/s: under this the trunk moved straight up or down (`JUMP_SPEED`). */
export const STRAIGHT = 1;
/** A body larger or smaller on the picture than this many times from one frame to the next is another body (a
 *  reflection further off, a passer-by nearer). Measured on the same six videos: at most 1.12 times; the stand-in
 *  follower changing bodies on the old six-person files: 2.8 to 4.5 times. */
export const CHANGED_SIZE = 1.25;

export interface BodyChange {
  /** The frame where the body followed is another, and its time. */
  readonly index: number;
  readonly t: number;
  /** Metres a second its middle moved, and how many times larger or smaller it became. */
  readonly speed: number;
  readonly size: number;
}

/** Each frame where the body followed is not the body last seen, by the plain sign: its middle moving faster than a
 *  jump's take-off (straight up or down, faster than a jump's), or its size jumping. A frame with nobody followed, or whose body's size cannot be read, is a gap:
 *  the body after it is judged against the body before it, its speed over the whole time between (round one, H1:
 *  losing the body and finding another is how the model, asked for one person, changes bodies). After a long gap a
 *  body that came nearer or went further is told as a change: the sign never vouches for what it did not see. */
export function bodyChanges(frames: readonly MovementFrame[], followed: readonly (SeenPerson | null)[] = followOne(frames)): BodyChange[] {
  const changes: BodyChange[] = [];
  let last: { t: number; middle: [number, number]; size: number } | null = null;
  frames.forEach((frame, index) => {
    const person = followed[index] ?? null;
    if (person === null) return;
    const size = bodySize(person, frame.aspect, person.points.map((p) => p[3] >= SURE));
    if (size === null) return;
    const middle = trunkCentre(person, frame.aspect);
    if (last !== null && frame.t > last.t) {
      const scale = Math.max(size, last.size) * ((frame.t - last.t) / 1000);
      const dx = (middle[0] - last.middle[0]) / scale;
      const dy = (middle[1] - last.middle[1]) / scale;
      const speed = Math.hypot(dx, dy);
      // Along "down" as the picture shows it (a reference video's is straight down the picture), and across it.
      const down = frame.down === null || !(Math.hypot(frame.down[0], frame.down[1]) > 0) ? [0, 1] : [frame.down[0], frame.down[1]];
      const n = Math.hypot(down[0] ?? 0, down[1] ?? 1);
      const along = (dx * (down[0] ?? 0) + dy * (down[1] ?? 1)) / n;
      const across = Math.sqrt(Math.max(0, speed * speed - along * along));
      const limit = across < STRAIGHT ? JUMP_SPEED : CHANGED_SPEED;
      const grew = Math.max(size, last.size) / Math.min(size, last.size);
      if (speed > limit || grew > CHANGED_SIZE) changes.push({ index, t: frame.t, speed, size: grew });
    }
    last = { t: frame.t, middle, size };
  });
  return changes;
}
