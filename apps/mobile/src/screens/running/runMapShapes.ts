// A run's trail, stones and ends as shapes for the map (ROADMAP Stage 5 37b-i). Drawn on the phone
// from the run it holds: none of this is ever sent anywhere. Pure, so its rules are tested alone.
import { geodesicMetres, type Units } from "@app/shared";
import { unitMarks } from "./routeShape";

type LngLat = [number, number];
type Line = { type: "Feature"; properties: { p: number }; geometry: { type: "LineString"; coordinates: LngLat[] } };
type Spot = { type: "Feature"; properties: { n: string }; geometry: { type: "Point"; coordinates: LngLat } };
export type TrailShapes = { type: "FeatureCollection"; features: Line[] };
export type SpotShapes = { type: "FeatureCollection"; features: Spot[] };

/** How many pieces a trail is cut into: each its own colour, gold where the run began to white at its
 *  front, as one line's colour cannot run across the gaps between stretches. */
export const TRAIL_PIECES = 48;

const lngLat = ([lat, lng]: readonly [number, number]): LngLat => [lng, lat];

/** The trail in pieces, never across the gap between two stretches (a pause, a stretch left out).
 *  `p` is how far along the run the piece lies, 0 at the start and 1 at the front. */
export function trailShapes(track: readonly (readonly [number, number])[], starts: readonly number[], pieces = TRAIL_PIECES): TrailShapes {
  const features: Line[] = [];
  const last = track.length - 1;
  if (last < 1) return { type: "FeatureCollection", features };
  const begins = new Set(starts);
  const size = Math.max(1, Math.ceil(last / pieces));
  let from = 0;
  while (from < last) {
    let to = from;
    while (to < last && to - from < size && !begins.has(to + 1)) to++;
    if (to > from) {
      const coordinates = track.slice(from, to + 1).map(lngLat);
      features.push({ type: "Feature", properties: { p: (from + to) / 2 / last }, geometry: { type: "LineString", coordinates } });
    }
    // The next piece carries on from this one's end, or from the next stretch's first point.
    from = begins.has(to + 1) ? to + 1 : to === from ? to + 1 : to;
  }
  return { type: "FeatureCollection", features };
}

/** A stone at each whole kilometre or mile, at its exact metre, numbered from 1. */
export function stoneShapes(track: readonly (readonly [number, number])[], starts: readonly number[], units: Units): SpotShapes {
  return {
    type: "FeatureCollection",
    features: unitMarks(track, starts, units).map((at, i) => ({ type: "Feature", properties: { n: String(i + 1) }, geometry: { type: "Point", coordinates: lngLat(at) } })),
  };
}

/** Where the run began, and where it ended (`finished`) or is now. */
export function endShapes(track: readonly (readonly [number, number])[], finished: boolean): SpotShapes {
  const first = track[0];
  const end = track[track.length - 1];
  const features: Spot[] = [];
  if (first !== undefined) features.push({ type: "Feature", properties: { n: "start" }, geometry: { type: "Point", coordinates: lngLat(first) } });
  if (finished && end !== undefined && track.length > 1) features.push({ type: "Feature", properties: { n: "finish" }, geometry: { type: "Point", coordinates: lngLat(end) } });
  return { type: "FeatureCollection", features };
}

/** The box the whole run fits in: west, south, east, north. */
export function runBounds(track: readonly (readonly [number, number])[]): [number, number, number, number] | null {
  if (track.length === 0) return null;
  const lats = track.map((q) => q[0]);
  const lngs = track.map((q) => q[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

/** The way the person is heading at the front, in degrees clockwise from north: from a point at least
 *  `least` metres back within the last stretch. null until they have moved that far. */
export function frontBearing(track: readonly (readonly [number, number])[], starts: readonly number[], least = 8): number | null {
  const front = track[track.length - 1];
  if (front === undefined) return null;
  const from = Math.max(0, ...starts.filter((i) => i < track.length));
  for (let i = track.length - 2; i >= from; i--) {
    const back = track[i];
    if (back === undefined) break;
    if (geodesicMetres(back[0], back[1], front[0], front[1]) < least) continue;
    const toRad = Math.PI / 180;
    const y = Math.sin((front[1] - back[1]) * toRad) * Math.cos(front[0] * toRad);
    const x = Math.cos(back[0] * toRad) * Math.sin(front[0] * toRad) - Math.sin(back[0] * toRad) * Math.cos(front[0] * toRad) * Math.cos((front[1] - back[1]) * toRad);
    return ((Math.atan2(y, x) / toRad) + 360) % 360;
  }
  return null;
}
