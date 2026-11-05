// A run's route laid flat for drawing (ROADMAP Stage 5 37a): true to its shape and its size, each
// stretch apart, a stone at each whole kilometre or mile. Pure, so its rules are tested alone.
import { geodesicMetres, type Units } from "@app/shared";
import { METRES_PER_MILE } from "./runWords";

/** The least ground a route's box stands for, in metres: a walk round a room is drawn as the few
 *  metres it is, small in the middle, never stretched to fill the box as if it were a 5 km loop. */
export const ROUTE_LEAST_SPAN_M = 200;

/** The path laid flat in a box `w` by `h`, `pad` from its edges: north up, true to its shape and to
 *  its size (metres east and north of its first point), never smaller than ROUTE_LEAST_SPAN_M across. */
export function fitPath(track: readonly (readonly [number, number])[], w: number, h: number, pad: number): [number, number][] {
  const first = track[0];
  if (first === undefined || w <= 0 || h <= 0) return [];
  const cos = Math.cos((first[0] * Math.PI) / 180);
  const xy = track.map(([lat, lng]): [number, number] => [(lng - first[1]) * 111_320 * cos, -(lat - first[0]) * 111_132]);
  const xs = xy.map((q) => q[0]);
  const ys = xy.map((q) => q[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  const inner = Math.min(w, h) - 2 * pad;
  const scale = Math.min((w - 2 * pad) / Math.max(spanX, 1e-9), (h - 2 * pad) / Math.max(spanY, 1e-9), inner / ROUTE_LEAST_SPAN_M);
  const offX = (w - spanX * scale) / 2;
  const offY = (h - spanY * scale) / 2;
  return xy.map(([x, y]) => [offX + (x - minX) * scale, offY + (y - minY) * scale]);
}

/** Where along the path each whole kilometre or mile falls, as indexes into it: only ground covered,
 *  never the gap between two stretches (a pause, a stretch left out). */
export function unitMarks(track: readonly (readonly [number, number])[], starts: readonly number[], units: Units): number[] {
  const every = units === "imperial" ? METRES_PER_MILE : 1000;
  const begins = new Set(starts);
  const marks: number[] = [];
  let walked = 0;
  for (let i = 1; i < track.length; i++) {
    if (begins.has(i)) continue;
    const a = track[i - 1];
    const b = track[i];
    if (a === undefined || b === undefined) continue;
    walked += geodesicMetres(a[0], a[1], b[0], b[1]);
    if (walked >= every * (marks.length + 1)) marks.push(i);
  }
  return marks;
}

/** Each stretch its own line: a pause is a gap, never a straight line across it. */
export const pathOf = (points: readonly (readonly [number, number])[], starts: readonly number[]): string => {
  const begins = new Set(starts);
  return points.map(([x, y], i) => `${i === 0 || begins.has(i) ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
};


/** The way the person is heading at the front of the path, as an angle on the screen (radians, 0
 *  east, clockwise as the screen's y runs down): from a point at least `least` pixels back, within
 *  the last stretch. null while the front has not moved that far. */
export function heading(points: readonly (readonly [number, number])[], starts: readonly number[], least = 6): number | null {
  const last = points[points.length - 1];
  if (last === undefined) return null;
  const from = Math.max(0, ...starts.filter((i) => i < points.length));
  for (let i = points.length - 2; i >= from; i--) {
    const p = points[i];
    if (p === undefined) break;
    if (Math.hypot(last[0] - p[0], last[1] - p[1]) >= least) return Math.atan2(last[1] - p[1], last[0] - p[0]);
  }
  return null;
}
