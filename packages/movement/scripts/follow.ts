// The stand-in follower of 50c-ii, kept for the phone test's comparison of points (phoneCheck.ts) and to show what the lock
// of 52d-i does better (`OnePerson`, src/body/person.ts, which every run of the engine now goes through): the largest
// body in the first frame with anybody, then in each frame the body whose trunk lies nearest to where the followed one
// last was. It cannot tell a man
// from his reflection, or from the model finding him twice. Since 51c the kept files are asked
// for one person, as the phone asks, so the model itself follows one body and this picks the
// only one; whether that body stays the same is `bodyChanges`'s plain sign, below.
import type { MovementFrame, SeenPerson } from "@app/shared";
import { LIMITS, PERSON_LIMITS, bodyChange, lookAt, trunkMiddle, type Look } from "../src/index.js";

/** A point the model is less sure of than the possible-body check trusts gives the size nothing. */
const SURE = LIMITS.sure;

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
      const c = trunkMiddle(person, frame.aspect);
      const score = last === null ? -extent(person, frame.aspect) : Math.hypot(c[0] - last[0], c[1] - last[1]);
      if (score < bestScore) {
        bestScore = score;
        best = person;
      }
    }
    if (best !== null) last = trunkMiddle(best, frame.aspect);
    return best;
  });
}

// ── The plain sign that the body followed has changed (ROADMAP 51c) ─────────────────────
// Since 52d-i the sign is the engine's own (`bodyChange`, `PERSON_LIMITS` in src/body/person.ts), which the lock uses
// before a set has counted; here it says where a kept video's body changes, so that such a video sets no number.
/** Faster than this, metres a second across the picture, the body's middle has not moved: another body was taken
 *  (`PersonLimits.speed`). */
export const CHANGED_SPEED = PERSON_LIMITS.speed;
/** A trunk moving straight up or down the picture, another body only faster than this, m/s (`PersonLimits.jumpSpeed`). */
export const JUMP_SPEED = PERSON_LIMITS.jumpSpeed;
/** Across "down", m/s: under this the trunk moved straight up or down (`PersonLimits.straight`). */
export const STRAIGHT = PERSON_LIMITS.straight;
/** A body larger or smaller on the picture than this many times from one frame to the next is another body
 *  (`PersonLimits.changedSize`). */
export const CHANGED_SIZE = PERSON_LIMITS.changedSize;

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
  let last: Look | null = null;
  frames.forEach((frame, index) => {
    const person = followed[index] ?? null;
    if (person === null) return;
    const look = lookAt(person, frame.aspect, frame.t, SURE);
    if (look === null) return;
    const change = last === null ? null : bodyChange(last, look, frame.down);
    if (change?.changed === true) changes.push({ index, t: frame.t, speed: change.speed, size: change.size });
    last = look;
  });
  return changes;
}
