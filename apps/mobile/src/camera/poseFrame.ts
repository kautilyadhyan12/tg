import { KEYPOINT_COUNT, movementFrameSchema, poseCameraEventSchema, type Down, type MovementFrame } from "@app/shared";

// The camera screen (ROADMAP Stage 5 53a; spec Part 2 §12.2): each answer of the phone's pose model, as the camera module
// sends it (modules/pose-camera), made into the movement engine's frame and checked by its schema before the engine
// trusts it (CLAUDE.md §4, "Parse, don't trust"). Pure. An answer that is broken anywhere is no frame at all: garbage
// decides nothing.

/** One answer, as the module sends it. `t`: the phone's own clock, ms, never back. `gravity`: Android's reading in the
 *  phone's own axes, or none. `turn`: how the screen, and so the picture turned upright for it, is turned from those axes,
 *  in degrees (0 on a phone held upright; 90 or 270 on a tablet held upright). `spin`: how far the phone turned since the
 *  answer before, radians about its own three axes, from its gyroscope, or none (53c). Each person: 33 points of 5
 *  numbers, laid end to end, and 33 3D points of 3, or none. */
export interface PoseEvent {
  readonly t: number;
  readonly width: number;
  readonly height: number;
  readonly gravity: readonly number[];
  readonly turn: number;
  readonly spin?: readonly number[];
  readonly people: readonly { readonly points: readonly number[]; readonly world: readonly number[] }[];
}

/** Earth's pull, and how far a reading may be from it: further, the phone is being moved, and its "down" says nothing. */
const EARTH = 9.81;
const MOVED = 2;

/**
 * Which way is down, in the picture the selfie camera takes, from Android's gravity reading. Android reads it in the
 * phone's own axes, m/s²: x to the right across the screen, y up it, z out of it, and pointing up, as the phone feels
 * Earth hold it (an upright phone reads about [0, 9.81, 0]). The engine's picture has x to its right, y down it and z away
 * from the camera; the selfie camera looks out of the screen at the person, so the picture's right is the phone's left
 * and away from it is the phone's z. Down is therefore (gx, gy, -gz) over its size, once the reading is turned into the
 * screen's own axes: a phone's own axes are its natural way up, which on a tablet is on its side, and the picture is
 * turned upright for the screen (`turn`, the way Android's own sample turns a reading for its screen). Null with no
 * reading, one too far from Earth's pull, or a turn that is not a quarter turn.
 */
export function downOf(gravity: readonly number[], turn: number): Down | null {
  const [gx, gy, gz] = gravity;
  if (gravity.length !== 3 || gx === undefined || gy === undefined || gz === undefined) return null;
  const size = Math.hypot(gx, gy, gz);
  if (!Number.isFinite(size) || Math.abs(size - EARTH) > MOVED) return null;
  const screen = turned(gx, gy, turn);
  if (screen === null) return null;
  return [screen[0] / size, screen[1] / size, (0 - gz) / size];
}

/** A reading's x and y in the screen's axes, the screen turned `turn` degrees from the phone's own. */
function turned(x: number, y: number, turn: number): [number, number] | null {
  switch (turn) {
    case 0:
      return [x, y];
    case 90:
      return [0 - y, x];
    case 180:
      return [0 - x, 0 - y];
    case 270:
      return [y, 0 - x];
    default:
      return null;
  }
}

const share = (v: number): number => Math.min(1, Math.max(0, v));

/** An answer as the camera module sent it, checked whole before anything of it is read (`poseCameraEventSchema`; the
 *  camera's security pass, L1): null when its shape is broken, never a thrown error. */
export function answerOf(answer: unknown): PoseEvent | null {
  const checked = poseCameraEventSchema.safeParse(answer);
  return checked.success ? checked.data : null;
}

/** The engine's frame of one checked answer (`answerOf`), `t` ms after the set's first; null when anything in it is
 *  broken. */
export function frameOf(e: PoseEvent, t: number): MovementFrame | null {
  if (!(e.width > 0) || !(e.height > 0)) return null;
  const people = [];
  for (const p of e.people) {
    if (p.points.length !== KEYPOINT_COUNT * 5) return null;
    if (p.world.length !== 0 && p.world.length !== KEYPOINT_COUNT * 3) return null;
    const points = [];
    const world = [];
    for (let k = 0; k < KEYPOINT_COUNT; k++) {
      const [x, y, z, visible, present] = p.points.slice(k * 5, k * 5 + 5);
      if (x === undefined || y === undefined || z === undefined || visible === undefined || present === undefined) return null;
      // The model's own sureness may stray a hair past its ends; anything else is checked as it came.
      points.push([x, y, z, share(visible), share(present)] as [number, number, number, number, number]);
      if (p.world.length > 0) {
        const [wx, wy, wz] = p.world.slice(k * 3, k * 3 + 3);
        if (wx === undefined || wy === undefined || wz === undefined) return null;
        world.push([wx, wy, wz] as [number, number, number]);
      }
    }
    people.push({ points, world: p.world.length > 0 ? world : null });
  }
  const parsed = movementFrameSchema.safeParse({ t, aspect: e.width / e.height, down: downOf(e.gravity, e.turn), people, spin: spinOf(e.spin ?? []) });
  return parsed.success ? parsed.data : null;
}

/** How far the phone turned since the answer before, as the module read it: three numbers, or null when it could not say
 *  (a phone with no gyroscope, or a gap in its readings). Always given for the live phone, so the engine knows the picture
 *  came from a phone that can say it moved (53c). */
export function spinOf(spin: readonly number[]): [number, number, number] | null {
  const [x, y, z] = spin;
  return spin.length === 3 && x !== undefined && y !== undefined && z !== undefined ? [x, y, z] : null;
}
