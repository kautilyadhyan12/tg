// Which way the body faces the phone (ROADMAP 52d-ii): the line from the right hip to the left hip in 3D, turned about
// "down", against the line across the phone's view. About 0 facing the phone, about 90 or -90 side on (one way or the
// other), about 180 with the back to it. A person who turns to face another way in the middle of a set stands at another
// height on the picture and with their feet in other places, so what was remembered of their standing belongs to the way
// they faced when it was taken (matcher.ts). Pure: the 3D points the model gives, and "down" (the phone's own sensor; a
// reference video's is straight down the picture).
import { KP, type Down } from "@app/shared";
import type { SteadyBody } from "./steady.js";

type Vec = readonly [number, number, number];

const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const along = (v: Vec, d: Vec): Vec => {
  const k = dot(v, d);
  return [v[0] - k * d[0], v[1] - k * d[1], v[2] - k * d[2]];
};
const unit = (v: Vec): Vec | null => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n > 0 ? [v[0] / n, v[1] / n, v[2] / n] : null;
};
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Degrees, in (-180, 180]: which way the body faces, from both hips' 3D points; null when either hip is not used, "down"
 *  is not known, or the hips' line stands along "down" (a body lying on its side). */
export function facingOf(body: SteadyBody): number | null {
  const left = body.points[KP.left_hip]?.world ?? null;
  const right = body.points[KP.right_hip]?.world ?? null;
  return left === null || right === null || body.down === null ? null : lineFacing(left, right, body.down);
}

/** The line from `right` to `left`, about `down`, against the line across the view (both in the 3D points' own axes: the
 *  phone looks along the third). */
export function lineFacing(left: readonly [number, number, number], right: readonly [number, number, number], down: Down): number | null {
  const d = unit(down);
  if (d === null) return null;
  // The phone looks along its own third axis; across its view, level, is that turned about "down".
  const forward = unit(along([0, 0, 1], d));
  if (forward === null) return null;
  const across = cross(d, forward);
  const line = along([left[0] - right[0], left[1] - right[1], left[2] - right[2]], d);
  // A hips' line standing along "down" has no way it faces.
  if (Math.hypot(line[0], line[1], line[2]) < 0.05 * Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])) return null;
  return (Math.atan2(dot(line, forward), dot(line, across)) * 180) / Math.PI;
}

/** How far apart two facings are, degrees, 0 to 180. */
export function turnBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** The middle way of several facings (each a direction, so 179 and -179 are 2 apart): their mean direction; null with none,
 *  or when they point every way. */
export function facingMiddle(facings: readonly number[]): number | null {
  let x = 0;
  let y = 0;
  for (const f of facings) {
    x += Math.cos((f * Math.PI) / 180);
    y += Math.sin((f * Math.PI) / 180);
  }
  return facings.length === 0 || Math.hypot(x, y) < 1e-9 * facings.length ? null : (Math.atan2(y, x) * 180) / Math.PI;
}
