// A phone standing on the floor (spec Part 2 §12.5; ROADMAP 52a-ii-b-ii-a): what the floor replay (replays.ts
// `onTheFloor`) is kept on, and what a floor phone sees of each kind of position.
//
// In words Kd can read:
//   - how a man's own floor phone stood: from the pictures in which he stands tall, where his feet lie on the picture
//     and how big he is there say how far the phone leaned back, its lens taken as about 15 cm up (`phoneLean`);
//   - the redraw would be held as proof only if his own squats from a raised phone, redrawn as the floor phone would see
//     them, read as his real floor squats do (`faithful`): every squat counted and none called short; and each of four
//     readings, the feet's two rules ("feet stay down", "feet stay in place") and how far the picture's hips and the 3D
//     hips stand apart below standing and standing (the engine trusts a picture's height only within 0.15 of a leg of the
//     3D one), taken by the redraw at least half way from where his raised sets read it, as filmed, to the middle of his
//     real floor sets, and the middle of his five redrawn sets never past the furthest of his real floor sets. Only the
//     middle of the five is held so; each set past every floor set is listed (`beyond`), never hidden by the middle. As
//     measured it passes at none of his six leans (floor-view prints each): it is shown, not held (replays.ts). The
//     readings of how he moved (depth, knees bent, hips and knees together, chest up) are shown and not checked. A phone
//     does change them, the knees and the trunk being read on the picture first, but part of each gap is how he moved:
//     his raised and floor squats are not the same squats. The check first written judged them too and failed both leans
//     it was tried at: the redraw took "knees bent" 4 of the 10 degrees towards his floor squats, short of half way, and
//     "chest up" away from them. "Stance holds" and "hips alike" are read only where the phone's place shows them and are
//     left out. `wander` (52a-ii-b-ii-b-i) adds the pose model's own foot wander measured on his floor sets (replays.ts
//     `floorWander`): with it the redraw loses squats his real floor counts and still does not read as his floor, from
//     all four sets, from each alone and from each three, so the replay itself never adds it;
//   - what a floor phone sees of sitting, lying, all fours and a chair: his eleven other videos as filmed, how often the
//     body is found, how often each part is used, and how often the main measures are given (`positionsTable`), for the
//     other kinds of counting (52c) and "can a phone on the floor count it" (54).
import type { MovementFrame } from "@app/shared";
import { LIMITS, bodySize, type MeasureName } from "../src/index.js";
import { runOf } from "./measureCheck.js";
import { proofVideos, readMovement, repsOf, runMovement, withLeadIn, type ProofVideo } from "./movementCheck.js";
import { MOVEMENT_VIDEOS } from "./movementVideos.js";
import { FLOOR_LENS, LENS_MM, focalOf, onTheFloor } from "./replays.js";

const SQUAT = readMovement("squat");
/** The man whose own floor and raised videos these are (movementVideos.ts). */
const HIS = "man, his own phone, on the floor and raised";

/** The middle value; of an even number, the mean of the two in the middle. */
const middleOf = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const half = Math.floor(s.length / 2);
  const upper = s[half];
  const lower = s[half - 1];
  if (upper === undefined) return null;
  return s.length % 2 === 1 || lower === undefined ? upper : (upper + lower) / 2;
};
const share = (values: readonly number[], k: number): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(k * (s.length - 1))] ?? null;
};

function angle(a: readonly number[], b: readonly number[], c: readonly number[]): number {
  const u = a.map((v, i) => v - (b[i] ?? 0));
  const w = c.map((v, i) => v - (b[i] ?? 0));
  const d = Math.hypot(...u) * Math.hypot(...w);
  const cos = u.reduce((s, v, i) => s + v * (w[i] ?? 0), 0) / d;
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** How far a phone leaned back as it filmed, degrees, its lens `lens` metres above the floor, from the frames in which
 *  the person stands tall (both knees within 12 degrees of straight in 3D): the middle of where the lowest sure heel or
 *  toes lie on the picture, and the middle of the body's size. Null with fewer than 10 such frames. */
export function phoneLean(frames: readonly MovementFrame[], lens = FLOOR_LENS, millimetres = LENS_MM): { readonly degrees: number; readonly frames: number; readonly distance: number } | null {
  const feet: number[] = [];
  const sizes: number[] = [];
  let aspect = 1;
  for (const f of frames) {
    const p = f.people[0];
    const w = p?.world ?? null;
    if (p === undefined || w === null) continue;
    aspect = f.aspect;
    const at = (i: number): readonly number[] => w[i] ?? [0, 0, 0];
    if (angle(at(23), at(25), at(27)) < 168 || angle(at(24), at(26), at(28)) < 168) continue;
    const sure = p.points.map((q) => q[3] >= LIMITS.sure && q[4] >= LIMITS.sure);
    const size = bodySize(p, f.aspect, sure);
    const ys = [29, 30, 31, 32].flatMap((i) => (sure[i] === true ? [p.points[i]?.[1] ?? 0] : []));
    if (size === null || ys.length === 0) continue;
    feet.push(Math.max(...ys));
    sizes.push(size);
  }
  const y = middleOf(feet);
  const size = middleOf(sizes);
  if (y === null || size === null || feet.length < 10) return null;
  const focal = focalOf(aspect, millimetres);
  const distance = focal / size;
  return { degrees: ((Math.atan((y - 0.5) / focal) - Math.atan(lens / distance)) * 180) / Math.PI, frames: feet.length, distance };
}

/** The squat's readings compared, and how far the picture's hips and the 3D hips stand apart. */
export const COMPARED: readonly string[] = ["depth", "knees bent", "hips and knees together", "knees and hips together", "chest up", "feet stay down", "feet stay in place"];
export const HIPS_APART = "hips, picture against 3D";
export const HIPS_APART_TALL = "hips, picture against 3D, standing";
/** The readings only the phone changes: judged. The others are how he moved: shown. */
export const JUDGED: readonly string[] = ["feet stay down", "feet stay in place", HIPS_APART, HIPS_APART_TALL];

export interface SetReading {
  readonly label: string;
  readonly count: number;
  readonly reps: number;
  readonly short: number;
  /** For each compared reading, the middle over the set's reps; and the hips apart in 95 of 100 pictures below standing. */
  readonly middles: ReadonlyMap<string, number | null>;
}

/** One set's readings, as the frames given show it. */
export function readSet(v: ProofVideo, frames: readonly MovementFrame[] = v.video.frames): SetReading {
  const video = { ...v.video, frames };
  const run = runMovement(SQUAT, video);
  const reps = repsOf(SQUAT, [{ ...v, video }]);
  const middles = new Map<string, number | null>();
  for (const name of COMPARED) middles.set(name, middleOf(reps.flatMap((r) => (r.readings[name] ?? null) === null ? [] : [r.readings[name] ?? 0])));
  const { measured } = runOf(withLeadIn(video));
  const apart = measured.flatMap((m) => {
    const r = m.readings.get("hips height");
    return r?.off === null || r?.off === undefined || r.world === null || r.world >= 0.9 ? [] : [r.off];
  });
  middles.set(HIPS_APART, share(apart, 0.95));
  const tall = measured.flatMap((m) => {
    const r = m.readings.get("hips height");
    return r?.off === null || r?.off === undefined || r.world === null || r.world < 0.9 ? [] : [r.off];
  });
  middles.set(HIPS_APART_TALL, share(tall, 0.95));
  return { label: v.video.label, count: run.count, reps: v.entry.reps ?? 0, short: run.reps.filter((r) => r.verdict === "short").length, middles };
}

export interface Faithful {
  readonly lean: number;
  /** His real floor sets, his raised sets as filmed, and the same raised sets redrawn from the floor. */
  readonly real: readonly SetReading[];
  readonly raised: readonly SetReading[];
  readonly redrawn: readonly SetReading[];
  /** For each reading: the lowest, middle and highest of his real floor sets' middles, the middle of the raised sets'
   *  middles as filmed and redrawn, whether it is judged, and for a judged one whether the redraw took it at least half
   *  way from the raised phone's to the floor's middle and never past the furthest floor set. */
  readonly rows: readonly {
    readonly reading: string;
    readonly low: number;
    readonly floor: number;
    readonly high: number;
    readonly filmed: number;
    readonly redrawn: number;
    readonly judged: boolean;
    readonly within: boolean;
    /** The redrawn sets whose own middle lies past the furthest of his real floor sets, on the far side from the raised
     *  reading: shown, never hidden by the middle of the five. */
    readonly beyond: readonly string[];
  }[];
  /** Every redrawn set counts its squats, and none is called short. */
  readonly counts: boolean;
  readonly passes: boolean;
}

/** Whether the floor replay at `lean` degrees reads his raised squats as his real floor squats read (see the top). */
export function faithful(
  lean: number,
  millimetres = LENS_MM,
  videos: readonly ProofVideo[] = proofVideos(MOVEMENT_VIDEOS.filter((e) => e.person === HIS && e.movement === "squat" && e.reps !== null)),
  wander: readonly string[] | null | false = false,
): Faithful {
  const real = videos.filter((v) => v.entry.floor === true).map((v) => readSet(v));
  const raisedVideos = videos.filter((v) => v.entry.floor !== true);
  const raised = raisedVideos.map((v) => readSet(v));
  const redrawn = raisedVideos.map((v) => readSet(v, onTheFloor(FLOOR_LENS, lean, 3, millimetres, wander)(v.video.frames)));
  const across = (sets: readonly SetReading[], name: string): number[] => sets.flatMap((s) => {
    const m = s.middles.get(name) ?? null;
    return m === null ? [] : [m];
  });
  const rows = [...COMPARED, HIPS_APART, HIPS_APART_TALL].map((reading) => {
    const mine = across(real, reading);
    const low = Math.min(...mine);
    const high = Math.max(...mine);
    const floor = middleOf(mine) ?? Number.NaN;
    const filmed = middleOf(across(raised, reading)) ?? Number.NaN;
    const r = middleOf(across(redrawn, reading)) ?? Number.NaN;
    const half = (filmed + floor) / 2;
    const within = floor >= filmed ? r >= half && r <= high : r <= half && r >= low;
    const beyond = redrawn.flatMap((s) => {
      const m = s.middles.get(reading) ?? null;
      return m !== null && (floor >= filmed ? m > high : m < low) ? [s.label] : [];
    });
    return { reading, low, floor, high, filmed, redrawn: r, judged: JUDGED.includes(reading), within, beyond };
  });
  const counts = redrawn.every((s) => s.count === s.reps && s.short === 0);
  return { lean, real, raised, redrawn, rows, counts, passes: counts && rows.every((r) => !r.judged || r.within) };
}

// ── What a floor phone sees of each kind of position ───────────────────────────────────────────────────────────────
export const PARTS: readonly (readonly [string, readonly number[]])[] = [
  ["shoulders", [11, 12]],
  ["hips", [23, 24]],
  ["knees", [25, 26]],
  ["ankles", [27, 28]],
  ["heels and toes", [29, 30, 31, 32]],
];
export const MEASURES: readonly MeasureName[] = ["trunk lean", "hips height", "left knee", "right knee"];

export interface PositionRow {
  readonly label: string;
  readonly seen: string;
  readonly floor: boolean;
  /** Of every 100 pictures, those the body is found in; of every 100 found, those each part is used in on one side and
   *  on both, and those each measure is given on the picture. */
  readonly found: number;
  readonly parts: readonly { readonly part: string; readonly one: number; readonly both: number }[];
  readonly measures: readonly { readonly measure: string; readonly given: number }[];
}

/** His eleven videos of other positions, as filmed: what the phone saw of each. */
export function positionsTable(): PositionRow[] {
  const videos = proofVideos(MOVEMENT_VIDEOS.filter((e) => e.person === HIS && e.movement === null));
  return videos.map((v) => {
    const { steady, measured } = runOf(v.video);
    const frames = v.video.frames.length;
    const found = v.video.frames.filter((f) => f.people.length > 0).length;
    const pct = (n: number, of: number): number => (of === 0 ? 0 : Math.round((100 * n) / of));
    return {
      label: v.video.label,
      seen: v.entry.seen,
      floor: v.entry.floor === true,
      found: pct(found, frames),
      parts: PARTS.map(([part, idx]) => ({
        part,
        one: pct(steady.filter((b) => idx.some((k) => b.points[k] !== null)).length, found),
        both: pct(steady.filter((b) => [idx.filter((k) => k % 2 === 1), idx.filter((k) => k % 2 === 0)].every((side) => side.some((k) => b.points[k] !== null))).length, found),
      })),
      measures: MEASURES.map((measure) => ({ measure, given: pct(measured.filter((m) => (m.readings.get(measure)?.flat ?? null) !== null).length, found) })),
    };
  });
}
