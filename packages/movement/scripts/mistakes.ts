// Each mistake the camera checks, drawn onto a real good-form squat (spec Part 2 §12.5: "each mistake video fires its
// own mistake and plays its own line, and no other"; ROADMAP 52b-ii-a). Kd's folder holds no video of a squat done
// wrong, so the mistake is drawn on the body the model saw, the way the jumps of 52a-ii-a were: the 3D points are moved
// as the mistake moves the body, and each picture point by how far its 3D place moves on the picture through a phone's
// usual lens (replays.ts `fromCamera`, `project`), so the picture and the 3D points tell the same story and the body
// check sees a body it can believe. The mistake grows with the knees' bend: none standing tall, all of it at the bottom.
// Its size may differ from rep to rep (`Size`, by the frame's time), so each rep can be drawn just past its own line.
//
// What each drawing does, in words Kd can read:
//   - leaning further forward: everything above the hips (the trunk, the head and the arms) turned forward about the
//     hips by the angle given, the way the person faces;
//   - knees caving in: each knee carried towards the other by the distance given, the feet where they were.
import type { ExerciseCamera, Movement, MovementFrame, SeenPerson } from "@app/shared";
import type { Video } from "./bodyCheck.js";
import { LEAD_IN, runMovement } from "./movementCheck.js";
import { focalOf, fromCamera, project, type V3 } from "./replays.js";

type Frames = readonly MovementFrame[];
type World = NonNullable<SeenPerson["world"]>;
/** How big the mistake is drawn in the frame at this time (the video's own clock, ms): degrees or metres. */
export type Size = (t: number) => number;

/** A size for each rep, from 0.3 s before it begins to 0.3 s after it is back up (the video's own clock), and none
 *  elsewhere. */
export function perRep(reps: readonly { readonly start: number; readonly end: number; readonly size: number }[], margin = 300): Size {
  return (t) => reps.find((r) => t >= r.start - margin && t <= r.end + margin)?.size ?? 0;
}

const HIP = [23, 24] as const;
const KNEE = [25, 26] as const;
const ANKLE = [27, 28] as const;
/** Every point above the hips: the face, the shoulders, the arms and hands. */
const ABOVE_HIPS = Array.from({ length: 23 }, (_, i) => i);

/** The knees straight at this (the less bent of the two in 3D, degrees) or more, the drawing adds nothing; bent to
 *  `FULL` or more, all of it. */
const STRAIGHT = 170;
const FULL = 100;

const minus = (a: readonly number[], b: readonly number[]): V3 => [(a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0)];
const plus = (a: readonly number[], b: readonly number[]): V3 => [(a[0] ?? 0) + (b[0] ?? 0), (a[1] ?? 0) + (b[1] ?? 0), (a[2] ?? 0) + (b[2] ?? 0)];
const times = (a: readonly number[], k: number): V3 => [(a[0] ?? 0) * k, (a[1] ?? 0) * k, (a[2] ?? 0) * k];
const dot = (a: readonly number[], b: readonly number[]): number => (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
const cross = (a: readonly number[], b: readonly number[]): V3 => [
  (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
  (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
  (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
];
const unit = (a: readonly number[]): V3 | null => {
  const n = Math.sqrt(dot(a, a));
  return n > 0 ? times(a, 1 / n) : null;
};
const middle = (a: readonly number[], b: readonly number[]): V3 => times(plus(a, b), 0.5);

function angle(a: readonly number[], b: readonly number[], c: readonly number[]): number {
  const u = minus(a, b);
  const v = minus(c, b);
  const d = Math.sqrt(dot(u, u) * dot(v, v));
  return d > 0 ? (Math.acos(Math.max(-1, Math.min(1, dot(u, v) / d))) * 180) / Math.PI : 180;
}

/** How far through its bend the body is, 0 to 1, from the less bent knee in 3D. */
function bendOf(world: World): number {
  const knees = [0, 1].map((s) => {
    const h = world[HIP[s as 0 | 1]];
    const k = world[KNEE[s as 0 | 1]];
    const a = world[ANKLE[s as 0 | 1]];
    return h === undefined || k === undefined || a === undefined ? 180 : angle(h, k, a);
  });
  return Math.min(1, Math.max(0, (STRAIGHT - Math.max(...knees)) / (STRAIGHT - FULL)));
}

/** A point turned about `axis` (a unit vector) through `about` by `radians`. */
function turnedAbout(p: readonly number[], about: readonly number[], axis: readonly number[], radians: number): V3 {
  const v = minus(p, about);
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const turned = plus(plus(times(v, c), times(cross(axis, v), s)), times(axis, dot(axis, v) * (1 - c)));
  return plus(about, turned);
}

/** The frames with each body moved by `move` in 3D (its world points and how far through its bend it is; "down" in
 *  the same axes) and on the picture by how far each moved point's 3D place moves there. A frame with no 3D points, or
 *  not placed, is left as it was. Only the person the model follows is moved. */
export function drawn(frames: Frames, move: (world: World, bend: number, down: V3, t: number) => World): MovementFrame[] {
  const first = frames[0];
  if (first === undefined) return [];
  const focal = focalOf(first.aspect);
  const placed = fromCamera(frames, focal);
  return frames.map((f, k) => {
    const p = f.people[0];
    const q = placed[k] ?? null;
    if (p === undefined || p.world === null || q === null) return f;
    const bend = bendOf(p.world);
    if (bend === 0) return f;
    const down: V3 = f.down === null ? [0, 1, 0] : [f.down[0], f.down[1], f.down[2]];
    const world = move(p.world, bend, down, f.t);
    const points = p.points.map(([x, y, z, v, pr], i): SeenPerson["points"][number] => {
      const at = q[i];
      const was = p.world?.[i];
      const now = world[i];
      if (at === undefined || was === undefined || now === undefined) return [x, y, z, v, pr];
      const from = project(at, f.aspect, focal);
      const to = project(plus(at, minus(now, was)), f.aspect, focal);
      return [x + to[0] - from[0], y + to[1] - from[1], z, v, pr];
    });
    return { ...f, people: [{ points, world }, ...f.people.slice(1)] };
  });
}

/** Leaning further forward by `degrees` at the bottom. */
export function leanForward(degrees: Size) {
  return (frames: Frames): MovementFrame[] =>
    drawn(frames, (world, bend, down, t) => {
      const l = world[HIP[0]];
      const r = world[HIP[1]];
      const ls = world[11];
      const rs = world[12];
      if (l === undefined || r === undefined || ls === undefined || rs === undefined) return world;
      const hips = middle(l, r);
      const axis = unit(minus(r, l));
      if (axis === null) return world;
      const trunk = minus(middle(ls, rs), hips);
      const up = times(down, -1);
      const radians = (degrees(t) * bend * Math.PI) / 180;
      // The way that leans the trunk further from upright.
      const leanOf = (a: number): number => angle(plus(up, hips), hips, turnedAbout(plus(hips, trunk), hips, axis, a));
      const way = leanOf(radians) >= leanOf(-radians) ? 1 : -1;
      return world.map((w, i): V3 => (ABOVE_HIPS.includes(i) ? turnedAbout(w, hips, axis, way * radians) : [w[0], w[1], w[2]]));
    });
}

/** Each knee carried towards the other by `metres` at the bottom. */
export function kneesIn(metres: Size) {
  return (frames: Frames): MovementFrame[] =>
    drawn(frames, (world, bend, _down, t) => {
      const l = world[KNEE[0]];
      const r = world[KNEE[1]];
      if (l === undefined || r === undefined) return world;
      const inward = unit(minus(r, l));
      if (inward === null) return world;
      return world.map((w, i): V3 => {
        if (i === KNEE[0]) return plus(w, times(inward, metres(t) * bend));
        if (i === KNEE[1]) return plus(w, times(inward, -metres(t) * bend));
        return [w[0], w[1], w[2]];
      });
    });
}

/** One rep of a good-form video with a mistake drawn on it, as the judge then read it. */
export interface DrawnRep {
  /** When the rep was, in the video's own clock, ms, as filmed. */
  readonly start: number;
  readonly end: number;
  /** The mistake's reading as filmed, the reading it was drawn to, the size that drew it, and the reading drawn. */
  readonly filmed: number;
  readonly target: number;
  readonly size: number;
  readonly reading: number | null;
  /** The drawn rep's verdict and the mistakes marked made in it; null verdict when no drawn rep overlaps it. */
  readonly verdict: string | null;
  readonly made: readonly string[];
}

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }): number => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/**
 * Every counted rep of a good-form video whose reading of `id` the judge saw, drawn to read `target`: `draw` makes the
 * frames for a size per rep (`perRep`). Each rep's size is searched between 0 and `most`, in up to eight tries, each the
 * size the last two tries point to, kept inside what is known to fall short and what is known to pass (halved when it
 * would leave it), until the reading lies within `near` of the target. A rep the judge no longer sees, or no longer
 * counts, is taken as drawn too far. The drawn reps are paired with the filmed ones by when they were.
 */
export function drawnTo(
  movement: Movement,
  exercise: ExerciseCamera,
  video: Video,
  id: string,
  draw: (size: Size) => (frames: Frames) => MovementFrame[],
  target: number,
  most: number,
  near: number,
): DrawnRep[] {
  const readOf = (r: { form: readonly { mistake: string; reading: number | null }[] }): number | null => r.form.find((f) => f.mistake === id)?.reading ?? null;
  const mistake = exercise.mistakes.find((m) => m.id === id);
  const up = mistake?.camera === "checked" && mistake.atMost !== undefined;
  const filmed = runMovement(movement, video, exercise).reps.flatMap((r) => {
    const v = readOf(r);
    return r.verdict !== "counted" || v === null ? [] : [{ start: r.start - LEAD_IN, end: r.end - LEAD_IN, filmed: v }];
  });
  // How far past the target a reading is, the way the mistake's line points: below 0 short of it.
  const past = (v: number): number => (up ? v - target : target - v);
  const low = filmed.map((r) => ({ size: 0, f: past(r.filmed) }));
  const high = filmed.map(() => ({ size: most, f: Number.POSITIVE_INFINITY }));
  let sizes = filmed.map(() => most / 4);
  let out: DrawnRep[] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const frames = draw(perRep(filmed.map((r, k) => ({ ...r, size: sizes[k] ?? 0 }))))(video.frames);
    const run = runMovement(movement, { ...video, frames }, exercise).reps.map((r) => ({ ...r, start: r.start - LEAD_IN, end: r.end - LEAD_IN }));
    out = filmed.map((r, k) => {
      const own = run.reduce<(typeof run)[number] | undefined>((top, x) => (overlap(r, x) > (top === undefined ? 0 : overlap(r, top)) ? x : top), undefined);
      return {
        ...r,
        target,
        size: sizes[k] ?? 0,
        reading: own === undefined ? null : readOf(own),
        verdict: own?.verdict ?? null,
        made: own === undefined ? [] : own.form.filter((f) => f.status === "made").map((f) => f.mistake),
      };
    });
    if (out.every((r) => r.verdict === "counted" && r.reading !== null && Math.abs(r.reading - target) <= near)) break;
    sizes = out.map((r, k) => {
      const size = sizes[k] ?? 0;
      const lo = low[k];
      const hi = high[k];
      if (lo === undefined || hi === undefined) return size;
      if (r.verdict === "counted" && r.reading !== null && Math.abs(r.reading - target) <= near) return size;
      const f = r.verdict === "counted" && r.reading !== null ? past(r.reading) : Number.POSITIVE_INFINITY;
      if (f < 0) low[k] = { size, f };
      else high[k] = { size, f };
      const a = low[k] ?? lo;
      const b = high[k] ?? hi;
      const guess = Number.isFinite(b.f) && b.f !== a.f ? a.size - (a.f * (b.size - a.size)) / (b.f - a.f) : (a.size + b.size) / 2;
      return guess > a.size && guess < b.size ? guess : (a.size + b.size) / 2;
    });
  }
  return out;
}
