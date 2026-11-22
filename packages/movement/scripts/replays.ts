// Each video played again the ways the world changes it (spec Part 2 §12.5; ROADMAP 52a-ii-a). A replay changes only
// what the phone would see: the body points of each frame, the frames that arrive, and which way is down. Every replay
// is the same for the same video every time: its only randomness is a seeded stream of numbers.
//
// What each replay stands for, in words Kd can read, and why its size:
//   - nearer: the person stands nearer the phone, the whole body still in the picture (the reference picture asks for
//     it): the body made up to 1.3 times bigger about its own middle, as far as every point the model saw stays in;
//   - farther: 0.6 times as big, about 4 m away where the videos were filmed at about 2.5;
//   - tilted: the phone leaning to one side by 15 degrees, which the phone's own sensor reports as "down";
//   - fewer pictures a second: 15 and 8, the slowest the phone gave in its warm minutes and its slowest second (51b-ii);
//   - uneven pictures: the phone's live mode drops a picture while it is busy, so each answer comes 1 to 4 camera
//     pictures after the one before, about 12 a second;
//   - shaky points: every point moved afresh in every picture, 1 cm in 95 of 100, several times the model's own shake
//     (0.9 to 4.4 mm a frame on the standing videos, 51a);
//   - the chip's gap: every point moved, picture by picture, by the very gap the phone's chosen set-up (full model, main
//     chip, 4 cores; 51b-ii's pick) read apart from the laptop on the same pictures of the squat and the chair squat
//     (51b-i; test/phone-points), carried onto each video in the body's own size. Measured: the foot points 0.7 to 1.1 cm
//     up or down in 95 of 100, the heel and toes of a foot mostly together. A drift drawn by hand, each point on its
//     own, was harsher than the phone (heel against toes 1.4 cm against 0.75 to 1.1) and would have widened the feet's
//     rule for nothing. The graphics chip's gap and the small model's are shown, never held: the app uses neither;
//   - a passer-by: somebody walks across between the phone and the person, about 1 m from the phone, in 0.8 s,
//     hiding every point under their body (nearly half the picture's width) as they pass, the person wholly hidden for
//     a moment: once while the person stands between reps (or in a video's middle), and once at the bottom of a rep
//     (or where the hips are lowest), where that rep is not seen and must decide nothing. The model following the
//     passer-by instead of the person is 52d's.
//   - on the floor (52a-ii-b-ii-a): the phone standing upright on the floor, as most members will stand it, its lens
//     about 15 cm up and leaning back 14 degrees, the middle of a man's own six upright floor videos (12.6 to 14.5 in
//     five, 6.4 in one), stepped back where the whole body would not be in the picture. Redrawn from the 3D points as a
//     change added to the picture's own points, so that drawn from the phone's own place the picture comes back exactly.
//     Shown, not held: it would be held once his own squats from a raised phone, redrawn so, read as his real floor
//     squats do (floorView.ts `faithful`), and at none of his six leans do they yet; adding the foot wander measured on
//     his own floor sets lost squats his real floor counts and still did not read as it (52a-ii-b-ii-b-i, below). Not tried on a video
//     filmed from the floor. It sets no number: the squat's numbers stay as 52a-ii-b-i set them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Down, MovementFrame, SeenPerson } from "@app/shared";
import { LIMITS, MAIN_JOINTS, bodySize } from "../src/index.js";
import { decodeBodyPoints } from "./bodyPoints.js";
import { countedTimes, proofVideos, readMovement } from "./movementCheck.js";
import { FLOOR_PERSON, MOVEMENT_VIDEOS, labelOf, type MovementVideo } from "./movementVideos.js";

type Frames = readonly MovementFrame[];

/** One way the world changes a video. `hold`: the count must stay what it was; otherwise the row is shown only. */
export interface Replay {
  readonly name: string;
  readonly words: string;
  readonly hold: boolean;
  /** The frames as the phone would get them. `reps`: the times of the reps the movement counted on the video as it is,
   *  in the video's own clock, for a replay that must happen at a rep's top or bottom. */
  readonly edit: (frames: Frames, seed: number, reps: readonly { readonly start: number; readonly end: number }[]) => MovementFrame[];
  /** For a replay that hides a rep: how many reps it may take away (each one hidden, never counted). */
  readonly hides?: number;
  /** Whether the replay changed this video at all; a row it did not change proves nothing (nearer, for a body that
   *  already fills the picture; on the floor, for a video filmed from the floor). */
  readonly tried?: (frames: Frames, entry: MovementVideo) => boolean;
  /** It changes only how the camera reads a body, the same body doing the same reps: the movement's numbers are set from
   *  the videos as filmed and as each such replay (movementCheck.ts `fit`), so a rule leaves room for what a phone
   *  adds. A passer-by hides the person and sets nothing. */
  readonly fits: boolean;
}

/** A small deterministic stream of numbers in 0..1 (mulberry32). */
export function numbers(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A normal number, from two of the stream's. */
function normal(next: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, next()))) * Math.cos(2 * Math.PI * next());
}

/** 95 in 100 of the lengths of a three-way normal step lie within this many of its one-way spreads. */
const NORMAL_3D_95 = 2.8;

const outside = (x: number, y: number): boolean => x < 0 || x > 1 || y < 0 || y > 1;
const seenPoint = (p: SeenPerson["points"][number]): boolean => p[3] >= LIMITS.sure && p[4] >= LIMITS.sure;

function everyPerson(frames: Frames, edit: (p: SeenPerson, f: MovementFrame, i: number) => SeenPerson, down?: Down): MovementFrame[] {
  return frames.map((f, i) => ({ ...f, ...(down === undefined ? {} : { down }), people: f.people.map((p) => edit(p, f, i)) }));
}

/** Every point moved about (cx, cy) on the picture by `k`; a point carried off the picture is off it. */
function scaledAbout(frames: Frames, k: number, cx: number, cy: number): MovementFrame[] {
  return everyPerson(frames, (p) => ({
    points: p.points.map(([x, y, z, v, pr]) => {
      const nx = cx + (x - cx) * k;
      const ny = cy + (y - cy) * k;
      return [nx, ny, z * k, v, outside(nx, ny) ? 0 : pr];
    }),
    world: p.world,
  }));
}

/** The middle of every point the model saw, over the whole video, and how far the body may grow about it and stay on
 *  the picture, keeping a margin of 2 in 100. */
function room(frames: Frames): { cx: number; cy: number; most: number } {
  let x0 = 1;
  let x1 = 0;
  let y0 = 1;
  let y1 = 0;
  for (const f of frames) {
    for (const p of f.people) {
      for (const q of p.points) {
        if (!seenPoint(q) || outside(q[0], q[1])) continue;
        x0 = Math.min(x0, q[0]);
        x1 = Math.max(x1, q[0]);
        y0 = Math.min(y0, q[1]);
        y1 = Math.max(y1, q[1]);
      }
    }
  }
  if (x1 < x0 || y1 < y0) return { cx: 0.5, cy: 0.5, most: 1 };
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  // Grown by k about the middle, each edge must stay within the margin.
  const limit = (towards: number, edge: number, middle: number): number => (middle === edge ? Number.POSITIVE_INFINITY : (towards - middle) / (edge - middle));
  const most = Math.min(limit(0.02, x0, cx), limit(0.98, x1, cx), limit(0.02, y0, cy), limit(0.98, y1, cy));
  return { cx, cy, most: Math.max(1, most) };
}

export function nearer(k: number) {
  return (frames: Frames): MovementFrame[] => {
    const { cx, cy, most } = room(frames);
    return scaledAbout(frames, Math.min(k, most), cx, cy);
  };
}

/** How far a video's body may be drawn nearer and stay whole on the picture: the factor `nearer` uses. */
export function nearestFactor(frames: Frames, k: number): number {
  return Math.min(k, room(frames).most);
}

export function farther(k: number) {
  return (frames: Frames): MovementFrame[] => scaledAbout(frames, k, 0.5, 0.5);
}

/** The phone leaning sideways by `degrees`: the picture turned about its middle, the 3D points with it, and "down" as
 *  the phone's own sensor would give it. */
export function tilted(degrees: number) {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (frames: Frames): MovementFrame[] => {
    const first = frames[0];
    if (first === undefined) return [];
    return everyPerson(
      frames,
      (p, f) => ({
        points: p.points.map(([x, y, z, v, pr]) => {
          const X = (x - 0.5) * f.aspect;
          const Y = y - 0.5;
          const nx = 0.5 + (X * c - Y * s) / f.aspect;
          const ny = 0.5 + (X * s + Y * c);
          return [nx, ny, z, v, outside(nx, ny) ? 0 : pr];
        }),
        world: p.world?.map(([x, y, z]) => [x * c - y * s, x * s + y * c, z]) ?? null,
      }),
      [-s, c, 0],
    );
  };
}

/** About `rate` pictures a second: the picture nearest each step. */
export function everyNth(rate: number) {
  return (frames: Frames): MovementFrame[] => {
    const step = 1000 / rate;
    const out: MovementFrame[] = [];
    let next = frames[0]?.t ?? 0;
    for (const f of frames) {
      if (f.t + 1e-6 >= next) {
        out.push(f);
        next += step;
      }
    }
    return out;
  };
}

/** Each answer 1 to `most` camera pictures after the one before, each as likely. */
export function uneven(most: number) {
  return (frames: Frames, seed: number): MovementFrame[] => {
    const next = numbers(seed);
    const out: MovementFrame[] = [];
    for (let i = 0; i < frames.length; i += 1 + Math.floor(next() * most)) {
      const f = frames[i];
      if (f !== undefined) out.push(f);
    }
    return out;
  };
}

/** Each frame's picture points kept or dropped at random, `share` dropped: not how the phone drops them (shown only). */
export function dropped(share: number) {
  return (frames: Frames, seed: number): MovementFrame[] => {
    const next = numbers(seed);
    return frames.filter((_, i) => i === 0 || next() >= share);
  };
}

/** Every point moved by its own offset, `metres` in 95 of 100, in 3D and on the picture alike (laid by the body's own
 *  size). `memory`: how much of last frame's offset each frame keeps (0, a shake afresh every frame). */
function moved(metres: number, memory: number) {
  return (frames: Frames, seed: number): MovementFrame[] => {
    const next = numbers(seed);
    const spread = metres / NORMAL_3D_95;
    const push = spread * Math.sqrt(1 - memory * memory);
    let offsets: number[][] | null = null;
    return everyPerson(frames, (p, f) => {
      const size = bodySize(p, f.aspect, p.points.map(seenPoint));
      const start: number[][] = offsets ?? p.points.map(() => [normal(next) * spread, normal(next) * spread, normal(next) * spread]);
      const now = start.map((o) => o.map((v) => v * memory + normal(next) * push));
      offsets = now;
      if (size === null) return p;
      return {
        points: p.points.map(([x, y, z, v, pr], i) => {
          const o = now[i] ?? [0, 0, 0];
          const nx = x + ((o[0] ?? 0) * size) / f.aspect;
          const ny = y + (o[1] ?? 0) * size;
          return [nx, ny, z, v, outside(nx, ny) ? 0 : pr];
        }),
        world:
          p.world?.map(([x, y, z], i) => {
            const o = now[i] ?? [0, 0, 0];
            return [x + (o[0] ?? 0), y + (o[1] ?? 0), z + (o[2] ?? 0)];
          }) ?? null,
      };
    });
  };
}

export const shaken = (metres: number) => moved(metres, 0);

// ── The chip's own gap, measured ───────────────────────────────────────────────────────────────────────────────────
/** The phone's runs the replays carry, by the run's name in measured/phone-test (keep-phone-points.ts keeps them). */
export const PHONE_GAPS = [
  { name: "chip's gap", run: "pose_landmarker_full.cpu.t4", videos: ["squat_reference", "chair_squat_reference"] },
  { name: "graphics chip's gap", run: "pose_landmarker_full.gpu", videos: ["squat_reference", "chair_squat_reference"] },
  { name: "small model's gap", run: "pose_landmarker_lite.cpu.t4", videos: ["squat_reference", "chair_squat_reference"] },
] as const;

/** The phone file's own label: the video's, then the phone and the run, letters, digits and underscores. */
export function phoneLabel(video: string, run: string): string {
  return `${video}_phone_${run.replace(/[^A-Za-z0-9]/g, "_")}`;
}

type Offset = { readonly picture: readonly [number, number]; readonly world: readonly [number, number, number] } | null;

const TEST = join(import.meta.dirname, "../test");
const gapsRead = new Map<string, readonly (readonly Offset[])[]>();
/** For each frame of the run's videos, one after the other, each point's gap from the laptop in metres: on the picture
 *  (by the laptop's body size that frame) and in 3D; null where either did not give the point. */
export function phoneGap(run: string): readonly (readonly Offset[])[] {
  const known = gapsRead.get(run);
  if (known !== undefined) return known;
  const gap = PHONE_GAPS.find((g) => g.run === run);
  if (gap === undefined) throw new Error(`no phone gap ${run}`);
  const read = (dir: string, name: string): readonly MovementFrame[] => decodeBodyPoints(new Uint8Array(readFileSync(join(TEST, dir, name)))).frames;
  const frames = gap.videos.flatMap((label) => {
    const laptop = read("body-points", `${label}.bodypoints`);
    const phone = read("phone-points", `${label}.${run}.bodypoints`);
    return laptop.map((f, k): Offset[] => {
      const a = f.people[0];
      const b = phone[k]?.people[0];
      const size = a === undefined ? null : bodySize(a, f.aspect, a.points.map(seenPoint));
      if (a === undefined || b === undefined || size === null) return [];
      return a.points.map((p, i): Offset => {
        const q = b.points[i];
        const w = a.world?.[i];
        const v = b.world?.[i];
        if (q === undefined || w === undefined || v === undefined) return null;
        return { picture: [((q[0] - p[0]) * f.aspect) / size, (q[1] - p[1]) / size], world: [v[0] - w[0], v[1] - w[1], v[2] - w[2]] };
      });
    });
  });
  gapsRead.set(run, frames);
  return frames;
}

/** Every point moved, frame by frame, by the gap the phone's `run` read apart from the laptop, from a place in its
 *  frames set by the seed, carried on and round again, laid on the picture by this body's own size. */
export function chipsGap(run: string) {
  return (frames: Frames, seed: number): MovementFrame[] => {
    const gaps = phoneGap(run);
    const start = Math.floor(numbers(seed)() * gaps.length);
    return everyPerson(frames, (p, f, i) => {
      const size = bodySize(p, f.aspect, p.points.map(seenPoint));
      const gap = gaps[(start + i) % gaps.length] ?? [];
      if (size === null) return p;
      return {
        points: p.points.map(([x, y, z, v, pr], k) => {
          const o = gap[k] ?? null;
          if (o === null) return [x, y, z, v, pr];
          const nx = x + (o.picture[0] * size) / f.aspect;
          const ny = y + o.picture[1] * size;
          return [nx, ny, z, v, outside(nx, ny) ? 0 : pr];
        }),
        world:
          p.world?.map(([x, y, z], k) => {
            const o = gap[k] ?? null;
            return o === null ? [x, y, z] : [x + o.world[0], y + o.world[1], z + o.world[2]];
          }) ?? null,
      };
    });
  };
}

/** Somebody walking across between the phone and the person in `ms`, hiding every point within `width` (a share of the
 *  picture's width) of them, centred on `at`. */
export function passerBy(at: (reps: readonly { readonly start: number; readonly end: number }[], frames: Frames) => number | null, ms = 800, width = 0.45) {
  return (frames: Frames, _seed: number, reps: readonly { readonly start: number; readonly end: number }[]): MovementFrame[] => {
    const middle = at(reps, frames);
    if (middle === null) return [...frames];
    const from = middle - ms / 2;
    return everyPerson(frames, (p, f) => {
      const share = (f.t - from) / ms;
      if (share < 0 || share > 1) return p;
      const x = -width / 2 + share * (1 + width);
      return { ...p, points: p.points.map(([px, py, z, v, pr]) => [px, py, z, Math.abs(px - x) <= width / 2 ? 0.1 : v, pr]) };
    });
  };
}

/** The middle of the longest stand between two counted reps, or before the first; with no rep counted (another
 *  movement), the video's middle. */
function betweenReps(reps: readonly { readonly start: number; readonly end: number }[], frames: Frames): number | null {
  const first = frames[0]?.t ?? 0;
  if (reps.length === 0) return (first + (frames[frames.length - 1]?.t ?? first)) / 2;
  const spans = reps.map((r, k) => [k === 0 ? first : (reps[k - 1]?.end ?? first), r.start] as const);
  const best = spans.reduce<readonly [number, number] | null>((a, s) => (a === null || s[1] - s[0] > a[1] - a[0] ? s : a), null);
  return best === null ? null : (best[0] + best[1]) / 2;
}

/** The middle of the first counted rep, its bottom; with no rep counted (another movement), where the hips are lowest
 *  on the picture. */
function atBottom(reps: readonly { readonly start: number; readonly end: number }[], frames: Frames): number | null {
  const r = reps[0];
  if (r !== undefined) return (r.start + r.end) / 2;
  let lowest: { t: number; y: number } | null = null;
  for (const f of frames) {
    const p = f.people[0];
    if (p === undefined) continue;
    const y = ((p.points[23]?.[1] ?? 0) + (p.points[24]?.[1] ?? 0)) / 2;
    if (lowest === null || y > lowest.y) lowest = { t: f.t, y };
  }
  return lowest?.t ?? null;
}

/** The same person squatting `k` times as slowly (under 1, faster): every picture's time stretched about the first, the
 *  pictures themselves as they were, so they come `k` times as far apart (at 1.5, 20 a second; at 2, 15). The model's
 *  wander of the points is stretched with them: an estimate (52a-ii-b-i, round one). */
export function tempo(k: number) {
  return (frames: Frames): MovementFrame[] => {
    const t0 = frames[0]?.t ?? 0;
    return frames.map((f) => ({ ...f, t: Math.round((t0 + (f.t - t0) * k) * 10) / 10 }));
  };
}

// ── A phone standing on the floor, redrawn from the 3D points (52a-ii-b-ii-a) ───────────────────────────────────────
export type V3 = [number, number, number];
const dot3 = (a: readonly number[], b: readonly number[]): number => (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);

/** A phone's main lens, 26 mm in 35 mm terms (the usual main camera): its focal length is 26/36 of the picture's long
 *  side. Fitted to each video from its own points instead, the best focal length lay between 1 and 8 picture heights
 *  with almost the same fit across them (the model's depths are too unsteady to fix it): on a man's own floor video,
 *  1.8 m from his phone by this lens, it put the phone 6 to 12 m away. */
export const LENS_MM = 26;
/** The focal length in picture heights, for a picture of this width / height. */
export const focalOf = (aspect: number, millimetres = LENS_MM): number => (millimetres / 36) * Math.max(1, aspect);
/** A phone standing upright on the floor: its lens about 15 cm up (a phone 16 to 17 cm tall on its short end, the lens
 *  near its top; not measured), and how far it leans back, degrees, measured on a man's own six upright floor videos
 *  from where his feet and his size lie on the picture while he stands tall (floorView.ts `phoneLean`): 12.6 to 14.5 in
 *  five, 6.4 in one; 14 is their middle. `FLOOR_LEANS`: the leans first tried, his first video's as first measured
 *  and the middle; `FLOOR_LEANS_MEASURED`, each of his six. At none do his raised squats, redrawn, yet read as his floor
 *  squats do (floorView.ts `faithful`). */
export const FLOOR_LENS = 0.15;
export const FLOOR_LEAN = 14;
export const FLOOR_LEANS: readonly number[] = [6.5, 14];
/** Each of his six upright floor videos' lean, rounded to a tenth (floorView.ts `phoneLean`): the floor view is checked at each. */
export const FLOOR_LEANS_MEASURED: readonly number[] = [6.4, 12.6, 13.7, 14.3, 14.4, 14.5];
const FOOT_POINTS = [29, 30, 31, 32];

const q01 = (values: readonly number[], k: number): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.round(k * (s.length - 1))] ?? null;
};

/** The ankles, heels and toes: where a standing body meets the floor. */
const FEET_3D = [27, 28, ...FOOT_POINTS];
/** Each foot's ankle, heel and toes. */
const FEET_SIDES = [
  [27, 29, 31],
  [28, 30, 32],
];
/** How far a foot may lie on the picture from where it usually stands, metres, and still keep one depth (52a-ii-b-i: a
 *  standing foot's points wander up to 4 to 5 cm on the picture); and from how far it takes the model's depth whole. */
const FOOT_STILL = 0.05;
const FOOT_MOVING = 0.1;
/** Knees at least this straight in 3D (the less bent of the two, degrees) stand tall; bent this much more, the hips
 *  take the model's place for them whole. */
const STRAIGHT = 165;
const BENT = 25;

/** Each knee's bend in 3D, degrees: left, right; null where unseen. */
function kneeAngles(world: SeenPerson["world"]): readonly [number | null, number | null] {
  if (world === null) return [null, null];
  const angle = (a: number, b: number, c: number): number | null => {
    const p = world[a];
    const q = world[b];
    const r = world[c];
    if (p === undefined || q === undefined || r === undefined) return null;
    const u = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const v = [r[0] - q[0], r[1] - q[1], r[2] - q[2]];
    const d = Math.hypot(...u) * Math.hypot(...v);
    return d > 0 ? (Math.acos(Math.max(-1, Math.min(1, dot3(u, v) / d))) * 180) / Math.PI : null;
  };
  return [angle(23, 25, 27), angle(24, 26, 28)];
}

/** The less bent of the two knees in 3D, degrees, or null. */
function kneesOf(world: SeenPerson["world"]): number | null {
  const both = kneeAngles(world).flatMap((a) => (a === null ? [] : [a]));
  return both.length === 0 ? null : Math.max(...both);
}

/** Where the picture has the 3D points' middle between the hips (the mean of the sure big joints less their 3D place,
 *  laid by the body's size), picture heights across and down, and how far in front of that middle the feet are in 3D,
 *  metres along the camera's axis. Null when the frame has no 3D points or no size. */
function laid(p: SeenPerson, aspect: number): { readonly x: number; readonly y: number; readonly size: number; readonly feet: number } | null {
  const world = p.world;
  if (world === null) return null;
  const sure = p.points.map(seenPoint);
  const size = bodySize(p, aspect, sure);
  if (size === null) return null;
  let px = 0;
  let py = 0;
  let wx = 0;
  let wy = 0;
  let n = 0;
  for (const j of MAIN_JOINTS) {
    const q = p.points[j];
    const w = world[j];
    if (sure[j] !== true || q === undefined || w === undefined) continue;
    px += q[0] * aspect;
    py += q[1];
    wx += w[0];
    wy += w[1];
    n++;
  }
  if (n === 0) return null;
  const feet = FEET_3D.reduce((sum, i) => sum + (world[i]?.[2] ?? 0), 0) / FEET_3D.length;
  return { x: px / n - size * (wx / n), y: py / n - size * (wy / n), size, feet };
}

/** Where each point of each frame lies from the camera, metres, its axes the picture's (x right, y down, z away). The
 *  3D points are centred between the hips, so they never say how far the hips themselves moved: in a squat filmed from
 *  the front the hips go back 15 to 25 cm and the 3D feet come forward as much. So the feet keep one distance from the
 *  camera all through the video (a phone stands still and so do the feet of most exercises), the distance that puts
 *  the body, the middle of the video over, as far away as its size on the picture says through `focal`; the hips move
 *  about them, and across and down the picture as the picture has them. A frame with no 3D points or no size: null. */
export function fromCamera(frames: Frames, focal: number): (V3[] | null)[] {
  const lays = frames.map((f) => {
    const p = f.people[0];
    return p === undefined ? null : laid(p, f.aspect);
  });
  const feet = q01(
    lays.flatMap((l) => (l === null ? [] : [focal / l.size + l.feet])),
    0.5,
  );
  // Standing tall, the hips are over the feet: how far in front of them the model puts the feet is its middle over the
  // frames with both knees straight, and only bending knees move the hips back from it. Turning between two sets of a
  // man's own, the model put his feet 18 cm in front of his hips for half a second; the hips then came 13 cm nearer the
  // phone and his standing read 8 cm taller on the floor's picture than once he stood still.
  const knees = frames.map((f) => kneesOf(f.people[0]?.world ?? null));
  const standing = q01(
    lays.flatMap((l, k) => (l === null || (knees[k] ?? 0) < STRAIGHT ? [] : [l.feet])),
    0.5,
  );
  const placed = frames.map((f, k): V3[] | null => {
    const l = lays[k] ?? null;
    const world = f.people[0]?.world ?? null;
    if (l === null || world === null || feet === null) return null;
    const bent = Math.min(1, Math.max(0, (STRAIGHT - (knees[k] ?? STRAIGHT)) / BENT));
    const ahead = standing === null ? l.feet : standing + bent * (l.feet - standing);
    const z = feet - ahead;
    const x = ((l.x - f.aspect / 2) * z) / focal;
    const y = ((l.y - 0.5) * z) / focal;
    return world.map(([a, b, c]): V3 => [a + x, b + y, c + z]);
  });
  // A foot that stays where it stands on the picture keeps one depth. The model's 3D feet are not steady in depth: on a
  // sumo squat from the front it puts one foot 30 cm forward and the other back on every rep, as if she twisted, while
  // on the picture her feet never move; lowered 0.7 m, the phone would have seen that as each foot sliding 7 to 10 cm up
  // and down the picture. So each foot point's depth is the middle of its depths over the video while the foot is within
  // `FOOT_STILL` of where it usually stands on the picture, the model's own beyond `FOOT_MOVING` (a step, a lunge, a
  // jump), and between the two in proportion, so it never jumps.
  const size = q01(
    lays.flatMap((l) => (l === null ? [] : [l.size])),
    0.5,
  );
  if (size === null) return placed;
  for (const foot of FEET_SIDES) {
    const at = frames.map((f): readonly [number, number] | null => {
      const p = f.people[0];
      if (p === undefined) return null;
      const seen = foot.flatMap((i): (readonly [number, number])[] => {
        const q = p.points[i];
        return q === undefined ? [] : [[(q[0] * f.aspect) / size, q[1] / size]];
      });
      return seen.length === 0 ? null : [seen.reduce((s, q) => s + q[0], 0) / seen.length, seen.reduce((s, q) => s + q[1], 0) / seen.length];
    });
    const mx = q01(at.flatMap((a) => (a === null ? [] : [a[0]])), 0.5);
    const my = q01(at.flatMap((a) => (a === null ? [] : [a[1]])), 0.5);
    if (mx === null || my === null) continue;
    for (const i of foot) {
      const middle = [0, 1, 2].map((c) => q01(placed.flatMap((q) => (q?.[i] === undefined ? [] : [q[i][c] ?? 0])), 0.5));
      placed.forEach((q, k) => {
        const a = at[k] ?? null;
        const point = q?.[i];
        if (a === null || point === undefined) return;
        const away = Math.hypot(a[0] - mx, a[1] - my);
        const own = Math.min(1, Math.max(0, (away - FOOT_STILL) / (FOOT_MOVING - FOOT_STILL)));
        const blend = (c: 0 | 1 | 2): void => {
          const m = middle[c] ?? null;
          if (m !== null) point[c] = m + own * (point[c] - m);
        };
        blend(0);
        blend(1);
        blend(2);
      });
    }
  }
  return placed;
}

export const project = (q: readonly number[], aspect: number, focal: number): readonly [number, number] => [
  (focal * (q[0] ?? 0)) / (q[2] ?? 1) / aspect + 0.5,
  (focal * (q[1] ?? 0)) / (q[2] ?? 1) + 0.5,
];

/** The phone moved and turned: where it stands, in the old camera's axes, and how far it leans back (radians). */
export interface FloorCamera {
  /** How high above the floor the phone stood, metres, along "down", as the picture and the lens say. */
  readonly height: number;
  readonly from: V3;
  readonly lean: number;
  /** How far the phone stepped back for the whole body to stay in the picture, metres. */
  readonly back: number;
}

/** A point of the old camera's axes as the phone at `camera` sees it. */
function seenFrom(q: readonly number[], camera: FloorCamera): V3 {
  return turned([(q[0] ?? 0) - camera.from[0], (q[1] ?? 0) - camera.from[1], (q[2] ?? 0) - camera.from[2]], camera.lean);
}

function turned(v: readonly [number, number, number], lean: number): V3 {
  const c = Math.cos(lean);
  const s = Math.sin(lean);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

/** Where the phone goes: `lens` metres above the floor, straight under where it was, leaning back `lean` radians, and
 *  stepped back by quarter metres, at most `mostBack`, while the body seen over the whole video would not fit in the
 *  picture with a margin of 4 in 100 (a person steps back until the phone sees all of them). The floor is the middle,
 *  over the video, of the lowest sure heel or toes along "down", the camera taken as level: a phone that leaned as it
 *  filmed puts the floor too low (Kd's own floor phone, about 15 cm up, reads 33 to 65 cm). Null when the video gives
 *  no floor or no "down". */
export function floorCamera(frames: Frames, lens: number, lean: number, placed: readonly (V3[] | null)[] = fromCamera(frames, focalOf(frames[0]?.aspect ?? 1)), mostBack = 3, focal = focalOf(frames[0]?.aspect ?? 1)): FloorCamera | null {
  const first = frames[0];
  const down = first?.down ?? null;
  if (first === undefined || down === null) return null;
  const seen = frames.flatMap((f, k) => {
    const q = placed[k] ?? null;
    const p = f.people[0];
    return q === null || p === undefined ? [] : [{ q, sure: p.points.map(seenPoint) }];
  });
  const floors = seen.flatMap(({ q, sure }) => {
    const along = FOOT_POINTS.flatMap((i) => (sure[i] === true && q[i] !== undefined ? [dot3(q[i], down)] : []));
    return along.length === 0 ? [] : [Math.max(...along)];
  });
  const height = q01(floors, 0.5);
  if (height === null) return null;
  const half = Math.atan(0.5 / focal) - 0.04;
  // The way the phone looks, along the floor: its own axis less what of it is "down".
  const ahead: V3 = [-down[0] * down[2], -down[1] * down[2], 1 - down[2] * down[2]];
  const aheadLength = Math.hypot(...ahead);
  for (let back = 0; back <= mostBack; back += 0.25) {
    const step = (i: 0 | 1 | 2): number => (height - lens) * down[i] - (back * ahead[i]) / aheadLength;
    const from: V3 = [step(0), step(1), step(2)];
    const tops: number[] = [];
    const bottoms: number[] = [];
    for (const { q, sure } of seen) {
      const angles = q.flatMap((v, i) => (sure[i] === true ? [Math.atan2(v[1] - from[1], v[2] - from[2])] : []));
      if (angles.length === 0) continue;
      tops.push(Math.min(...angles));
      bottoms.push(Math.max(...angles));
    }
    const top = q01(tops, 0.05);
    const bottom = q01(bottoms, 0.95);
    if (top === null || bottom === null) return null;
    if ((top + lean >= -half && bottom + lean <= half) || back >= mostBack) return { height, from, lean: -lean, back };
  }
  return null;
}

// ── The pose model's own wander near the floor, measured on a man's own floor videos (52a-ii-b-ii-b-i) ─────────────
// Tried, never used by the replay "on the floor": with it fewer of his raised squats, redrawn, count than without it,
// where his real floor counts them all, and they still do not read as his real floor squats, at every lean and from
// every choice of his floor sets (floorView.ts `faithful`, its `wander`).
// Kept so that the trial can be made again when more floor videos come (job 53's live tries).
/** One frame of a set's foot wander: each knee's bend in 3D (left, right; degrees, null unseen), and for each of the
 *  four foot points (left heel, right heel, left toes, right toes) how far the model put it on the picture from where
 *  that point lay while he stood tall just before that squat, metres by his body's size then (across, down); null
 *  where the model was not sure of it. */
export interface WanderFrame {
  readonly knees: readonly [number | null, number | null];
  readonly points: readonly (readonly [number, number] | null)[];
}

/** Each squat the movement counts is read on its own, from half a second before it to half a second after, against
 *  where the feet stood in that half second before it: a person may step or turn between squats (on his dull floor he
 *  turned round between his second and third, his heel 35 cm across; a set of its own since 52a-ii-b-ii-b-ii), never during one. */
const AROUND_SQUAT = 500;

/** His squat sets, by label: those filmed from the floor and those from his raised phone (movementVideos.ts). */
export function floorSquatSets(): { readonly floor: readonly string[]; readonly raised: readonly string[] } {
  const sets = MOVEMENT_VIDEOS.filter((e) => e.person === FLOOR_PERSON && e.movement === "squat" && e.reps !== null);
  const label = (e: MovementVideo): string => labelOf(e, e.file.slice(e.file.lastIndexOf("/") + 1));
  return { floor: sets.filter((e) => e.floor === true).map(label), raised: sets.filter((e) => e.floor !== true).map(label) };
}

const wanders = new Map<string, readonly WanderFrame[]>();
/** A set's foot wander, frame by frame, over each of its squats (`AROUND_SQUAT`). A planted foot does not move in a
 *  properly done squat, so every move of its points on the picture is the model's own. */
export function wanderOf(label: string): readonly WanderFrame[] {
  const known = wanders.get(label);
  if (known !== undefined) return known;
  const entry = MOVEMENT_VIDEOS.find((e) => e.person === FLOOR_PERSON && labelOf(e, e.file.slice(e.file.lastIndexOf("/") + 1)) === label);
  if (entry === undefined) throw new Error(`no set ${label}`);
  const video = proofVideos([entry])[0]?.video;
  const frames = video?.frames ?? [];
  const reps = video === undefined ? [] : countedTimes(readMovement("squat"), video);
  const out: WanderFrame[] = [];
  for (const rep of reps) {
    const inSet = frames.filter((f) => f.t >= rep.start - AROUND_SQUAT && f.t <= rep.end + AROUND_SQUAT);
    const tall = inSet.filter((f) => f.t <= rep.start && (kneesOf(f.people[0]?.world ?? null) ?? 0) >= STRAIGHT);
    const size = q01(
      tall.flatMap((f) => {
        const p = f.people[0];
        const s = p === undefined ? null : bodySize(p, f.aspect, p.points.map(seenPoint));
        return s === null ? [] : [s];
      }),
      0.5,
    );
    const stand = FOOT_POINTS.map((i) =>
      [0, 1].map((c) =>
        q01(
          tall.flatMap((f) => {
            const q = f.people[0]?.points[i];
            return q === undefined || !seenPoint(q) ? [] : [c === 0 ? q[0] * f.aspect : q[1]];
          }),
          0.5,
        ),
      ),
    );
    if (size !== null)
      for (const f of inSet) {
        const p = f.people[0];
        out.push({
          knees: kneeAngles(p?.world ?? null),
          points: FOOT_POINTS.map((i, j) => {
            const q = p?.points[i];
            const sx = stand[j]?.[0] ?? null;
            const sy = stand[j]?.[1] ?? null;
            return q === undefined || !seenPoint(q) || sx === null || sy === null ? null : [(q[0] * f.aspect - sx) / size, (q[1] - sy) / size];
          }),
        });
      }
  }
  wanders.set(label, out);
  return out;
}

/** How far the sets' foot points lie from where they stood, metres, across and down: the root mean square of every
 *  point seen in every frame. */
export function wanderSpread(labels: readonly string[]): readonly [number, number] {
  const all = labels.flatMap((l) => wanderOf(l));
  const of = (c: 0 | 1): number => {
    const v = all.flatMap((w) => w.points.flatMap((q) => (q === null ? [] : [q[c]])));
    return v.length === 0 ? 0 : Math.sqrt(v.reduce((s, x) => s + x * x, 0) / v.length);
  };
  return [of(0), of(1)];
}

/** The knee's bend in steps of 5 degrees, from straight: the wander is read in step with it. */
const BEND_STEP = 5;
/** A step needs this many frames to give a middle. */
const BEND_FRAMES = 3;
/** For each foot point, for each step of its own knee's bend, the middle of its wander (across, down); null where too
 *  few frames had that bend. */
type Profile = readonly (readonly ((readonly [number, number]) | null)[])[];

const stepOf = (knee: number): number => Math.max(0, Math.floor((180 - knee) / BEND_STEP));

function profileOf(frames: readonly WanderFrame[]): Profile {
  return FOOT_POINTS.map((_, j) => {
    const byStep: [number, number][][] = [];
    for (const f of frames) {
      const knee = f.knees[j % 2] ?? f.knees[1 - (j % 2)] ?? null;
      const w = f.points[j] ?? null;
      if (knee === null || w === null) continue;
      const s = stepOf(knee);
      (byStep[s] ??= []).push([w[0], w[1]]);
    }
    return Array.from({ length: byStep.length }, (_, s) => {
      const here = byStep[s] ?? [];
      if (here.length < BEND_FRAMES) return null;
      const x = q01(here.map((w) => w[0]), 0.5);
      const y = q01(here.map((w) => w[1]), 0.5);
      return x === null || y === null ? null : ([x, y] as const);
    });
  });
}

/** A profile's wander for foot point `j` at a knee's bend: its nearest step that has one (none: no wander). */
function profileAt(profile: Profile, j: number, knee: number): readonly [number, number] {
  const steps = profile[j] ?? [];
  const s = stepOf(knee);
  for (let d = 0; d < steps.length + s; d++) {
    const near = steps[s - d] ?? steps[s + d] ?? null;
    if (near !== null) return near;
  }
  return [0, 0];
}

/** The wander a floor phone's model adds, in step with the knees: over the floor sets it is taken from, the middle of
 *  each foot point's wander at each step of its own knee's bend, less the middle of his raised sets' at the same bend,
 *  which the redraw already carries. Carried on in time instead, as the chip's gap is (tried once, on code not kept),
 *  it put wander from the bottom of a squat on his standing feet. */
export interface FloorWander {
  readonly from: readonly string[];
  readonly floor: Profile;
  readonly raised: Profile;
}

const floorWanders = new Map<string, FloorWander>();
/** The floor's wander from the floor sets named (null: all of his). */
export function floorWander(only: readonly string[] | null = null): FloorWander {
  const key = only === null ? "" : only.join("|");
  const known = floorWanders.get(key);
  if (known !== undefined) return known;
  const sets = floorSquatSets();
  const unknown = (only ?? []).filter((l) => !sets.floor.includes(l));
  if (unknown.length > 0) throw new Error(`not one of his floor sets: ${unknown.join(", ")}`);
  const from = only === null ? sets.floor : sets.floor.filter((l) => only.includes(l));
  const made = { from, floor: profileOf(from.flatMap((l) => wanderOf(l))), raised: profileOf(sets.raised.flatMap((l) => wanderOf(l))) };
  floorWanders.set(key, made);
  return made;
}

/** Each foot point of the followed body moved, frame by frame, by the floor's wander at its own knee's bend, less his
 *  raised sets', laid on the picture by this body's own size. */
function wandered(frames: Frames, wander: FloorWander): MovementFrame[] {
  return frames.map((f) => ({
    ...f,
    people: f.people.map((p, n): SeenPerson => {
      const size = n > 0 ? null : bodySize(p, f.aspect, p.points.map(seenPoint));
      if (size === null) return p;
      const knees = kneeAngles(p.world);
      return {
        ...p,
        points: p.points.map(([x, y, z, v, pr], i): SeenPerson["points"][number] => {
          const j = FOOT_POINTS.indexOf(i);
          const knee = j < 0 ? null : (knees[j % 2] ?? knees[1 - (j % 2)] ?? null);
          if (knee === null) return [x, y, z, v, pr];
          const a = profileAt(wander.floor, j, knee);
          const b = profileAt(wander.raised, j, knee);
          const nx = x + ((a[0] - b[0]) * size) / f.aspect;
          const ny = y + (a[1] - b[1]) * size;
          return [nx, ny, z, v, outside(nx, ny) ? 0 : pr];
        }),
      };
    }),
  }));
}

/** As a phone standing on the floor would see the same body: the phone `lens` metres above the floor, leaning back
 *  `degrees` (floorCamera), each point moved as `redraw` says, and then the foot points by the floor's own wander
 *  (`floorWander`, from the floor sets named, null all of his; `false`, none: the replay itself). A video that gives no floor is left as it was. */
export function onTheFloor(lens: number, degrees: number, mostBack = 3, millimetres = LENS_MM, wander: readonly string[] | null | false = false) {
  return (frames: Frames): MovementFrame[] => {
    const first = frames[0];
    if (first === undefined) return [];
    const focal = focalOf(first.aspect, millimetres);
    const placed = fromCamera(frames, focal);
    const camera = floorCamera(frames, lens, (degrees * Math.PI) / 180, placed, mostBack, focal);
    if (camera === null) return [...frames];
    const drawn = redraw(frames, camera, placed, focal);
    return wander === false ? drawn : wandered(drawn, floorWander(wander));
  };
}

/** The video as the phone at `camera` would see it: each point moved on the picture by how far its 3D place moves on the
 *  picture between the phone's own place and `camera`, so that drawn from the phone's own place the picture comes back
 *  exactly, the pose model's own errors and all. The 3D points and "down" turn with the phone, as the model and the
 *  phone's sensor would give them. A frame with no 3D points or no size is left as it was: it decides nothing. Only the
 *  first person is moved: the one the model follows. */
export function redraw(frames: Frames, camera: FloorCamera, placed: readonly (V3[] | null)[] = fromCamera(frames, focalOf(frames[0]?.aspect ?? 1)), focal = focalOf(frames[0]?.aspect ?? 1)): MovementFrame[] {
  // How far each point lies on the picture from its 3D place drawn there (the pose model's own wobble and error) is a
  // share of the body's size on the picture, so it grows or shrinks as the body does: by how much nearer or further the
  // hips are from the new phone, the middle over the video, one number for the video. Kept at its old size, a foot's
  // wobble read 1.3 to 1.5 cm more travel on a body the floor phone, further away, sees smaller. Taken point by point and
  // frame by frame instead, it added travel of its own wherever a foot passed between held and moving.
  const grow =
    q01(
      placed.flatMap((q) => {
        const hips = q === null ? undefined : [q[23], q[24]];
        if (hips?.[0] === undefined || hips[1] === undefined) return [];
        const middle: V3 = [(hips[0][0] + hips[1][0]) / 2, (hips[0][1] + hips[1][1]) / 2, (hips[0][2] + hips[1][2]) / 2];
        const seen = seenFrom(middle, camera);
        return middle[2] > 0 && seen[2] > 0 ? [middle[2] / seen[2]] : [];
      }),
      0.5,
    ) ?? 1;
  return frames.map((f, k) => {
    const q = placed[k] ?? null;
    return {
      ...f,
      down: f.down === null ? null : turned(f.down, camera.lean),
      people: f.people.map((p, n): SeenPerson => {
        if (q === null || p.world === null || n > 0) return p;
        return {
          points: p.points.map(([x, y, z, v, pr], i): SeenPerson["points"][number] => {
            const at = q[i];
            if (at === undefined) return [x, y, z, v, pr];
            const was = project(at, f.aspect, focal);
            const now = project(seenFrom(at, camera), f.aspect, focal);
            const nx = x + (now[0] - was[0]) + (x - was[0]) * (grow - 1);
            const ny = y + (now[1] - was[1]) + (y - was[1]) * (grow - 1);
            return [nx, ny, z, v, outside(nx, ny) ? 0 : pr];
          }),
          world: p.world.map((w) => turned(w, camera.lean)),
        };
      }),
    };
  });
}

/** Nearer changes a video only where its body has room to grow: at least 1.05 times. */
const NEARER_TRIED = 1.05;

export const REPLAYS: readonly Replay[] = [
  { name: "nearer", words: "nearer the phone, up to 1.3 times bigger, the whole body in the picture", hold: true, edit: nearer(1.3), fits: true, tried: (f) => nearestFactor(f, 1.3) >= NEARER_TRIED },
  { name: "farther", words: "farther from the phone, 0.6 times as big", hold: true, edit: farther(0.6), fits: true },
  { name: "tilted left", words: "the phone leaning 15 degrees one way", hold: true, edit: tilted(15), fits: true },
  { name: "tilted right", words: "the phone leaning 15 degrees the other way", hold: true, edit: tilted(-15), fits: true },
  { name: "15 a second", words: "15 pictures a second", hold: true, edit: everyNth(15), fits: true },
  { name: "8 a second", words: "8 pictures a second, the phone's slowest second", hold: true, edit: everyNth(8), fits: true },
  { name: "uneven", words: "each picture 1 to 4 camera pictures after the last, as the phone's live mode drops them", hold: true, edit: uneven(4), fits: true },
  { name: "shaky", words: "every point shaken 1 cm afresh in every picture", hold: true, edit: shaken(0.01), fits: true },
  { name: "chip's gap", words: "every point moved by the gap the phone's chosen set-up reads from the laptop", hold: true, edit: chipsGap("pose_landmarker_full.cpu.t4"), fits: true },
  { name: "passer-by", words: "somebody walks past in front between reps (with no pause between them, the rep they cover is not seen)", hold: true, edit: passerBy(betweenReps), hides: 1, fits: false },
  { name: "passer-by at the bottom", words: "somebody walks past in front at the bottom of a rep: that rep is not seen", hold: true, edit: passerBy(atBottom), hides: 1, fits: false },
  { name: "faster", words: "the same reps done in three quarters of the time", hold: true, edit: tempo(0.75), fits: false },
  { name: "slower", words: "the same reps done 1.5 times as slowly", hold: true, edit: tempo(1.5), fits: false },
  { name: "twice as slow", words: "the same reps done twice as slowly", hold: true, edit: tempo(2), fits: false },
  {
    name: "on the floor",
    words: "the phone standing on the floor, its lens about 15 cm up and leaning back 14 degrees, as a man's own floor phone stood (shown, not held: it does not yet read as his floor squats do)",
    hold: false,
    edit: onTheFloor(FLOOR_LENS, FLOOR_LEAN),
    fits: false,
    tried: (_frames, entry) => entry.floor !== true,
  },
  { name: "graphics chip's gap", words: "every point moved by the graphics chip's gap (the app does not use it)", hold: false, edit: chipsGap("pose_landmarker_full.gpu"), fits: false },
  { name: "small model's gap", words: "every point moved by the small model's gap on the main chip (the app does not use it)", hold: false, edit: chipsGap("pose_landmarker_lite.cpu.t4"), fits: false },
  { name: "3 in 10 dropped", words: "3 pictures in 10 dropped at random, not how the phone drops them", hold: false, edit: dropped(0.3), fits: false },
];
