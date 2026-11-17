// How large this body is on the picture: picture heights for each metre of it. It is how a
// move on the picture becomes metres, so a speed means the same near the phone and far
// from it, for a child and for a tall man. The pose model gives each point twice, on the
// picture and in metres; the 3D points, seen from the camera's side, are laid on the
// picture's by one size and one shift, using the joints the model is sure of.
import type { SeenPerson } from "@app/shared";
import { MAIN_JOINTS } from "./points.js";

/** Fewer sure joints than this give no size: four points fix a size and a shift with room to spare. */
const FEWEST_JOINTS = 4;
/** The 3D joints must spread at least this much (metres squared, summed about their middle): a body
 *  folded into one spot has no size to read. Five joints 5 cm from their middle is 0.0125. */
const LEAST_SPREAD = 0.01;
/** A joint further from its laid place than this many times the middle joint's distance is left
 *  out and the size laid again: one wrong joint must not change the size of the rest. */
const OUTLIER = 2;

function lay(person: SeenPerson, aspect: number, joints: readonly number[]): { size: number; misses: number[] } | null {
  const world = person.world;
  if (world === null || joints.length < FEWEST_JOINTS) return null;
  let px = 0;
  let py = 0;
  let wx = 0;
  let wy = 0;
  for (const j of joints) {
    px += (person.points[j]?.[0] ?? 0) * aspect;
    py += person.points[j]?.[1] ?? 0;
    wx += world[j]?.[0] ?? 0;
    wy += world[j]?.[1] ?? 0;
  }
  const n = joints.length;
  px /= n;
  py /= n;
  wx /= n;
  wy /= n;
  let across = 0;
  let spread = 0;
  for (const j of joints) {
    const x = (person.points[j]?.[0] ?? 0) * aspect - px;
    const y = (person.points[j]?.[1] ?? 0) - py;
    const X = (world[j]?.[0] ?? 0) - wx;
    const Y = (world[j]?.[1] ?? 0) - wy;
    across += x * X + y * Y;
    spread += X * X + Y * Y;
  }
  if (!(spread >= LEAST_SPREAD)) return null;
  const size = across / spread;
  if (!(size > 0) || !Number.isFinite(size)) return null;
  const misses = joints.map((j) => {
    const x = (person.points[j]?.[0] ?? 0) * aspect - px;
    const y = (person.points[j]?.[1] ?? 0) - py;
    const X = (world[j]?.[0] ?? 0) - wx;
    const Y = (world[j]?.[1] ?? 0) - wy;
    return Math.hypot(x - size * X, y - size * Y);
  });
  return { size, misses };
}

/** Picture heights per metre, or null when it cannot be read. `sure` says which points the
 *  model is sure of; only those are used. */
export function bodySize(person: SeenPerson, aspect: number, sure: readonly boolean[]): number | null {
  const joints = MAIN_JOINTS.filter((j) => sure[j] === true);
  const first = lay(person, aspect, joints);
  if (first === null) return null;
  const sorted = [...first.misses].sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const kept = joints.filter((_, i) => (first.misses[i] ?? 0) <= OUTLIER * middle);
  if (kept.length === joints.length || kept.length < FEWEST_JOINTS) return first.size;
  return lay(person, aspect, kept)?.size ?? first.size;
}
