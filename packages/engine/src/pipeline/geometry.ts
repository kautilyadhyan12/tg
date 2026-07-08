// Geometry primitives (Part 2 §3.4) — ports of the legacy helpers every
// signal builds on. Formulas are exact: arccos of normalized dot product,
// degrees; inputs are [x, y] image-space points (y increases downward, §2.1).
// Inputs arrive from schema-validated PoseFrames via the visibility gate —
// the `?? 0` component fallbacks are unreachable in practice and exist only
// to satisfy indexed-access typing; malformed frames never get here (§3.1).

/** Legacy rounding, part of the ported formulas: angles/inclines to 0.1°
 *  (angles.py:62,168), valgus/elevation to 1e-4 (angles.py:275–306). Kept so
 *  downstream FSM/fault parity sees bit-identical inputs to the Python path. */
export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
export function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Interior angle at point b formed by a–b–c, in degrees (legacy calculate_angle). */
export function calculateAngle(
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
): number {
  const bax = (a[0] ?? 0) - (b[0] ?? 0);
  const bay = (a[1] ?? 0) - (b[1] ?? 0);
  const bcx = (c[0] ?? 0) - (b[0] ?? 0);
  const bcy = (c[1] ?? 0) - (b[1] ?? 0);
  const denom = Math.sqrt(bax * bax + bay * bay) * Math.sqrt(bcx * bcx + bcy * bcy) + 1e-8;
  const cos = Math.min(1, Math.max(-1, (bax * bcx + bay * bcy) / denom));
  // round1 = Python's `round(angle, 1)` (half-even vs half-up divergence is
  // measure-zero on acos outputs; P1.8a audits).
  return round1((Math.acos(cos) * 180) / Math.PI);
}

/** Angle of the vector top→bottom from the vertical (image +y) axis, degrees.
 *  0 = perfectly vertical/upright, 90 = horizontal (legacy incline_from_vertical). */
export function inclineFromVertical(top: readonly number[], bottom: readonly number[]): number {
  const vx = (bottom[0] ?? 0) - (top[0] ?? 0);
  const vy = (bottom[1] ?? 0) - (top[1] ?? 0);
  const denom = Math.sqrt(vx * vx + vy * vy) + 1e-8;
  const cos = Math.min(1, Math.max(-1, vy / denom)); // dot with (0,1)
  return round1((Math.acos(cos) * 180) / Math.PI); // angles.py:168
}
