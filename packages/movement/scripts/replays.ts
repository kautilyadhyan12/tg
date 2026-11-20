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
// A phone lower, higher or turned, redrawn from the 3D points, is 52a-ii-b's: drawn back from the phone's own place the
// 3D points land 5 to 11 cm from the picture's own joints, so a redraw is not yet faithful (spec §12.5).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Down, MovementFrame, SeenPerson } from "@app/shared";
import { LIMITS, bodySize } from "../src/index.js";
import { decodeBodyPoints } from "./bodyPoints.js";

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
   *  already fills the picture). */
  readonly tried?: (frames: Frames) => boolean;
  /** It changes only how the camera reads a body, the same body doing the same reps: the movement's numbers are set from
   *  the videos as filmed and as each such replay (movementCheck.ts `fit`), so a rule leaves room for what a phone
   *  adds. A passer-by hides the person and sets nothing. */
  readonly fits: boolean;
  /** Tried only on the movement's own videos: the same reps at another pace. Another movement stretched in time is no
   *  movement a body makes: a squat jack's jumps would float, in the air longer than gravity allows. */
  readonly ownOnly?: boolean;
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
  { name: "faster", words: "the same reps done in three quarters of the time", hold: true, edit: tempo(0.75), fits: false, ownOnly: true },
  { name: "slower", words: "the same reps done 1.5 times as slowly", hold: true, edit: tempo(1.5), fits: false, ownOnly: true },
  { name: "twice as slow", words: "the same reps done twice as slowly", hold: true, edit: tempo(2), fits: false, ownOnly: true },
  { name: "graphics chip's gap", words: "every point moved by the graphics chip's gap (the app does not use it)", hold: false, edit: chipsGap("pose_landmarker_full.gpu"), fits: false },
  { name: "small model's gap", words: "every point moved by the small model's gap on the main chip (the app does not use it)", hold: false, edit: chipsGap("pose_landmarker_lite.cpu.t4"), fits: false },
  { name: "3 in 10 dropped", words: "3 pictures in 10 dropped at random, not how the phone drops them", hold: false, edit: dropped(0.3), fits: false },
];
