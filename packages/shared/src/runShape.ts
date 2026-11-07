// A run's route made small, for the picture beside it in a list (ROADMAP Stage 5 37c-i): the saved line
// cut to its RUN_SHAPE_MOST_POINTS most telling points, each stretch apart, so the list never reads a
// whole route. Worked out once, when the run is saved, and kept with it.
//
// Douglas–Peucker, greedy: from each stretch's two ends, the point furthest from the line between the
// points kept so far is kept next, over every stretch at once, until the most points are kept or what is
// left lies within half a metre of the line. Each point is measured a few times at most, so a 12-hour run
// costs the server a few milliseconds.
import { decodePolyline, encodePolyline } from "./runMaths.js";

/** The most points a route's small picture keeps, its stretches together. */
export const RUN_SHAPE_MOST_POINTS = 80;
/** The longest a shape may be as text: well over what RUN_SHAPE_MOST_POINTS points take. */
export const RUN_SHAPE_MOST_CHARS = 4000;

type LatLng = readonly [number, number];

/** Metres a degree is near the equator; the east–west one is scaled by the route's own latitude. */
const M_PER_DEG = 111_320;
/** Closer than this to the line kept, a point adds nothing a picture can show. */
const LEAST_OFF_M = 0.5;

/** A span of one stretch between two points kept, with the point between them furthest off their line. */
interface Span {
  part: number;
  from: number;
  to: number;
  farAt: number;
  far: number;
}

/** The point of `xy` between `from` and `to` furthest from the line between them, and how far. */
function furthest(xy: readonly (readonly [number, number])[], from: number, to: number): { farAt: number; far: number } {
  const a = xy[from];
  const b = xy[to];
  if (a === undefined || b === undefined || to - from < 2) return { farAt: -1, far: -1 };
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const long = Math.hypot(dx, dy);
  let far = -1;
  let farAt = -1;
  for (let i = from + 1; i < to; i++) {
    const p = xy[i];
    if (p === undefined) continue;
    // How far the point lies from the line a–b (from a itself where a and b are one place).
    const d = long === 0 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / long;
    if (d > far) {
      far = d;
      farAt = i;
    }
  }
  return { farAt, far };
}

/** A heap of spans, the one whose furthest point lies furthest on top. */
class Spans {
  private readonly items: Span[] = [];

  get size(): number {
    return this.items.length;
  }

  push(span: Span): void {
    const items = this.items;
    items.push(span);
    let at = items.length - 1;
    while (at > 0) {
      const up = (at - 1) >> 1;
      const parent = items[up];
      const here = items[at];
      if (parent === undefined || here === undefined || parent.far >= here.far) break;
      items[up] = here;
      items[at] = parent;
      at = up;
    }
  }

  pop(): Span | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (top === undefined || last === undefined || items.length === 0) return top;
    items[0] = last;
    let at = 0;
    for (;;) {
      const l = at * 2 + 1;
      const r = l + 1;
      let big = at;
      if ((items[l]?.far ?? -Infinity) > (items[big]?.far ?? -Infinity)) big = l;
      if ((items[r]?.far ?? -Infinity) > (items[big]?.far ?? -Infinity)) big = r;
      if (big === at) break;
      const a = items[at];
      const b = items[big];
      if (a === undefined || b === undefined) break;
      items[at] = b;
      items[big] = a;
      at = big;
    }
    return top;
  }
}

/** The route as its small picture keeps it: each stretch's points as an encoded polyline, the stretches
 *  apart by a space; null for a route with no stretch of two points. `trackStarts` are where each
 *  stretch begins in `track` (RunSums'). */
export function routeShape(track: readonly LatLng[], trackStarts: readonly number[]): string | null {
  const begins = [...new Set([0, ...trackStarts])].filter((at) => at < track.length).sort((x, y) => x - y);
  const every = begins.map((at, i) => track.slice(at, begins[i + 1] ?? track.length)).filter((part) => part.length >= 2);
  if (every.length === 0) return null;
  // A run of many pauses has many stretches: its picture keeps the longest, in their order, each with at
  // least its two ends, so it never passes RUN_SHAPE_MOST_POINTS.
  const longest = new Set([...every].sort((x, y) => y.length - x.length).slice(0, RUN_SHAPE_MOST_POINTS / 2));
  const parts = every.filter((part) => longest.has(part));

  const lats = parts.flat().map((p) => p[0]);
  const mid = ((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180);
  const xys = parts.map((part) => part.map((p): [number, number] => [p[1] * M_PER_DEG * Math.cos(mid), p[0] * M_PER_DEG]));
  const keep = parts.map((part) => part.map((_, at) => at === 0 || at === part.length - 1));
  let count = parts.length * 2;
  const spans = new Spans();
  xys.forEach((xy, part) => {
    spans.push({ part, from: 0, to: xy.length - 1, ...furthest(xy, 0, xy.length - 1) });
  });
  while (count < RUN_SHAPE_MOST_POINTS && spans.size > 0) {
    const span = spans.pop();
    if (span === undefined || span.far <= LEAST_OFF_M || span.farAt < 0) break;
    const xy = xys[span.part];
    const kept = keep[span.part];
    if (xy === undefined || kept === undefined) break;
    kept[span.farAt] = true;
    count += 1;
    spans.push({ part: span.part, from: span.from, to: span.farAt, ...furthest(xy, span.from, span.farAt) });
    spans.push({ part: span.part, from: span.farAt, to: span.to, ...furthest(xy, span.farAt, span.to) });
  }
  return parts.map((part, i) => encodePolyline(part.filter((_, at) => keep[i]?.[at] === true))).join(" ");
}

/** A shape back to its points, and where each stretch begins, as a route's line is drawn. */
export function decodeShape(shape: string): { track: [number, number][]; starts: number[] } {
  const track: [number, number][] = [];
  const starts: number[] = [];
  for (const part of shape.split(" ")) {
    if (part === "") continue;
    const points = decodePolyline(part);
    if (points.length === 0) continue;
    starts.push(track.length);
    track.push(...points);
  }
  return { track, starts };
}
