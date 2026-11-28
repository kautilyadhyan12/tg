// The way the phone points, for the beam on a run's map (ROADMAP Stage 5 item 37p), worked out from what Android's
// rotation vector says (modules/run-motion hands it over as it reads it). Pure, so every way of holding a phone is
// tested here, not only on a phone.
//
// The way a phone points is square to its left-right edge, on the ground: the same whether it lies flat, is raised to
// be read, is held upright, or is tipped sideways in the hand. (Adding the top's way to the back's, as first built,
// put the beam about a degree off for each degree a flat phone was tipped sideways: round one's H1.) Only when that
// edge stands upright, the phone held sideways and on end, does it say nothing; then the back of the phone points.
// Face down, that square turns the other way, so it is turned back to the top's way wherever the top lies flatter
// than the back (not a phone held past upright, whose top leans back while its back still points ahead).
// The screen's own turn is allowed for (a tablet whose natural way up is landscape runs this portrait app turned a
// quarter), and magnetic north is turned to true north, the map's.
import type { PhoneCompass } from "@app/shared";

export interface Heading {
  /** Degrees clockwise from true north, 0 to 360. */
  deg: number;
  /** How sure: 3 high, 2 medium, 1 low, 0 unreliable (the beam spreads wider the less sure). */
  sure: number;
}

type Axis = readonly [number, number, number];

/** Below this much of a level part, an axis has no way on the ground to give. */
const LEAST_LEVEL = 0.2;

/** Android's estimate of the heading's error, in degrees, against how sure the beam says it is: as Apple's buckets. */
const SURE_WITHIN_DEG = [20, 35, 50] as const;

/** The screen's left-to-right and bottom-to-top axes in east, north and up, for the screen's turn from the phone's
 *  natural way up (as Android's own `remapCoordinateSystem` for a compass: a quarter turn maps x to -y and y to x). */
export function screenAxes(r: readonly number[], rotation: number): { x: Axis; y: Axis; z: Axis } {
  const col = (i: number): Axis => [r[i] ?? 0, r[i + 3] ?? 0, r[i + 6] ?? 0];
  const neg = (a: Axis): Axis => [-a[0], -a[1], -a[2]];
  const dx = col(0);
  const dy = col(1);
  const z = col(2);
  switch (rotation) {
    case 1:
      return { x: neg(dy), y: dx, z };
    case 2:
      return { x: neg(dx), y: neg(dy), z };
    case 3:
      return { x: dy, y: neg(dx), z };
    default:
      return { x: dx, y: dy, z };
  }
}

/** How sure the reading is: from Android's own estimate of the error where it gives one, its status where not. */
export function sureOf(accuracyRad: number, status: number): number {
  if (Number.isFinite(accuracyRad) && accuracyRad > 0) {
    const within = (accuracyRad * 180) / Math.PI;
    const level = SURE_WITHIN_DEG.findIndex((most) => within <= most);
    return level === -1 ? 0 : 3 - level;
  }
  return Math.max(0, Math.min(3, Math.round(status)));
}

/** The way the phone points, or null when it is held so that it points nowhere on the ground. */
export function headingOf(reading: PhoneCompass): Heading | null {
  const { x, y, z } = screenAxes(reading.r, reading.rotation);
  let east: number;
  let north: number;
  if (Math.hypot(x[0], x[1]) >= LEAST_LEVEL) {
    // Square to the left-right edge, turned a quarter to the left of it on the ground.
    east = -x[1];
    north = x[0];
    const top = Math.hypot(y[0], y[1]);
    if (top > Math.hypot(z[0], z[1]) && east * y[0] + north * y[1] < 0) {
      east = -east;
      north = -north;
    }
  } else if (Math.hypot(z[0], z[1]) >= LEAST_LEVEL) {
    // The edge stands upright: the back of the phone points.
    east = -z[0];
    north = -z[1];
  } else return null;
  const magnetic = (Math.atan2(east, north) * 180) / Math.PI;
  const deg = (((magnetic + reading.declination) % 360) + 360) % 360;
  if (!Number.isFinite(deg)) return null;
  return { deg, sure: sureOf(reading.accuracy, reading.status) };
}

/** Turned less than this, the beam is not drawn again: Android's readings tremble by a fraction of a degree. */
export const TURN_LEAST_DEG = 1;

/** Whether a new heading is worth drawing: turned TURN_LEAST_DEG or more either way round, or a change in sureness. */
export function turnedEnough(was: Heading | null, now: Heading): boolean {
  if (was === null || was.sure !== now.sure) return true;
  return Math.abs(((now.deg - was.deg + 540) % 360) - 180) >= TURN_LEAST_DEG;
}
