// What measure-check does with the kept videos (ROADMAP 50c-iii): takes the body measures of
// each, flat and in 3D, says how often each is read, how much each reading shakes and which is
// the steadier, sets the engine's two fitted numbers by their rules, compares the same video at
// half the frames a second, and picks frames worth a picture. Which reading a movement uses, and
// how sure it needs it, is the movement's (job 52a).
//
// The two rules, in words Kd can read, both over the one-person videos (the others' stand-in
// follower can pick a reflection, job 52d):
//   - the angle and length limits: where the picture shows the parts lie across it (turned out of
//     it by 10° at most, added up; a height or width shown at cos 10° of itself or more), the flat
//     and the 3D readings still differ, by the 3D points' own error; each limit is the difference
//     not passed in 95 frames of 100, to the nearest 5° or 0.05 of a length. A flat reading
//     further from the 3D one than that, whose showing allows that much flattening, is not given;
//   - the size change: the most the body's size on the picture changes on a video where the person
//     stays in place (its 1st to its 99th hundredth), raised to the next 5 in 100. A bigger change
//     is the body moving nearer or further, and the floor is set afresh.
import {
  BodyMeasures,
  MEASURE_LIMITS,
  MEASURE_LIST,
  type CheckedBody,
  type MeasureLimits,
  type MeasureName,
  type MeasuredBody,
  type SteadyBody,
  type Unit,
} from "../src/index.js";
import { runChecks, runSteady, type PictureFrame, type Video } from "./bodyCheck.js";

export type Kind = "angle" | "length";
export const kindOf = (unit: Unit): Kind => (unit === "degrees" ? "angle" : "length");

export function runMeasures(steady: readonly SteadyBody[], limits: MeasureLimits = MEASURE_LIMITS): MeasuredBody[] {
  const measures = new BodyMeasures(limits);
  return steady.map((s) => measures.next(s));
}

export interface Run {
  readonly checked: readonly CheckedBody[];
  readonly steady: readonly SteadyBody[];
  readonly measured: readonly MeasuredBody[];
}

/** Runs are cached: the tests ask for the same ones again. */
const runs = new Map<string, Run>();
export function runOf(video: Video): Run {
  const key = `${video.label}|${String(video.frames.length)}`;
  const known = runs.get(key);
  if (known !== undefined) return known;
  const checked = runChecks(video.frames);
  const steady = runSteady(checked);
  const fresh = { checked, steady, measured: runMeasures(steady) };
  runs.set(key, fresh);
  return fresh;
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;
}

// ── The two fitted numbers ─────────────────────────────────────────────────────────
/** Parts turned out of the picture by at most this, added up, lie across it. */
export const ACROSS = 10;
export const ANGLE_STEP = 5;
export const LENGTH_STEP = 0.05;
export const SIZE_STEP = 0.05;

/** Every flat reading the picture shows, whatever its distance from the 3D one. */
const NO_ANGLE_LIMIT: MeasureLimits = { ...MEASURE_LIMITS, angle: Number.POSITIVE_INFINITY, length: Number.POSITIVE_INFINITY };
const unlimited = new Map<string, MeasuredBody[]>();
function measuredUnlimited(video: Video): MeasuredBody[] {
  const key = `${video.label}|${String(video.frames.length)}`;
  const known = unlimited.get(key);
  if (known !== undefined) return known;
  const fresh = runMeasures(runOf(video).steady, NO_ANGLE_LIMIT);
  unlimited.set(key, fresh);
  return fresh;
}

/** A height or width shown at this share of itself or more lies across the picture. */
const LENGTH_ACROSS = 1 / Math.cos((ACROSS * Math.PI) / 180) - 1;

/** |flat − 3D| of every reading of one kind whose parts lie across the picture, on the one-person
 *  videos. */
export function acrossDifferences(videos: readonly Video[], kind: Kind): number[] {
  return videos
    .filter((v) => v.onePerson)
    .flatMap((v) =>
      measuredUnlimited(v).flatMap((body) =>
        MEASURE_LIST.flatMap(({ name, unit }) => {
          const r = body.readings.get(name);
          if (kindOf(unit) !== kind || r === undefined || r.flat === null || r.world === null || r.turn === null) return [];
          const across = kind === "angle" ? r.turn <= ACROSS : r.turn <= Math.abs(r.flat) * LENGTH_ACROSS + 1e-12;
          return across ? [Math.abs(r.flat - r.world)] : [];
        }),
      ),
    );
}

const toStep = (v: number, step: number): number => Math.round(Math.max(step, Math.round(v / step) * step) * 1e6) / 1e6;

export function chooseAngleLimit(videos: readonly Video[]): number {
  return toStep(quantile(acrossDifferences(videos, "angle"), 0.95), ANGLE_STEP);
}

export function chooseLengthLimit(videos: readonly Video[]): number {
  return toStep(quantile(acrossDifferences(videos, "length"), 0.95), LENGTH_STEP);
}

/** The most the body's size on the picture changes on each one-person video, 1st to 99th hundredth. */
export function sizeSwings(videos: readonly Video[]): { readonly label: string; readonly swing: number }[] {
  return videos
    .filter((v) => v.onePerson)
    .map((v) => {
      const sizes = runOf(v).steady.flatMap((s) => (s.size === null ? [] : [s.size]));
      return { label: v.label, swing: quantile(sizes, 0.99) / quantile(sizes, 0.01) - 1 };
    });
}

export function chooseSizeChange(videos: readonly Video[]): number {
  const most = Math.max(...sizeSwings(videos).map((s) => s.swing));
  return Math.round((Math.floor(most / SIZE_STEP + 1e-9) + 1) * SIZE_STEP * 1e6) / 1e6;
}

export interface AngleFold {
  readonly heldOut: string;
  readonly angle: number;
  /** Of the held-out video's flat angles the picture shows, the share given at that limit. */
  readonly kept: number;
}

export function leaveOneOut(videos: readonly Video[]): AngleFold[] {
  return videos
    .filter((v) => v.onePerson)
    .map((heldOut) => {
      const angle = chooseAngleLimit(videos.filter((v) => v !== heldOut));
      let shown = 0;
      let kept = 0;
      for (const body of measuredUnlimited(heldOut)) {
        for (const { name, unit } of MEASURE_LIST) {
          const r = body.readings.get(name);
          if (unit !== "degrees" || r === undefined || r.flat === null || r.off === null) continue;
          shown++;
          if (r.off <= angle) kept++;
        }
      }
      return { heldOut: heldOut.label, angle, kept: shown === 0 ? 0 : kept / shown };
    });
}

// ── How steady each reading is ─────────────────────────────────────────────────────
export interface MeasureSummary {
  readonly name: MeasureName;
  readonly unit: Unit;
  /** Frames read in 3D, and of those, read on the flat picture too. */
  readonly world: number;
  readonly flat: number;
  /** The middle shake of each reading, in its unit: how far a frame lies off the line between
   *  the frames either side of it, where both readings are read in all three. */
  readonly flatShake: number;
  readonly worldShake: number;
  readonly shakeFrames: number;
  /** The middle |flat − 3D|, where both are read. */
  readonly apart: number;
  /** The middle share of it the flat picture shows, where it is read in 3D. */
  readonly shown: number;
}

export function summaryOf(measured: readonly MeasuredBody[], name: MeasureName, unit: Unit): MeasureSummary {
  const get = (i: number): { flat: number | null; world: number | null; t: number } | null => {
    const body = measured[i];
    const r = body?.readings.get(name);
    return body === undefined || r === undefined ? null : { flat: r.flat, world: r.world, t: body.t };
  };
  let world = 0;
  let flat = 0;
  const apart: number[] = [];
  const shown: number[] = [];
  measured.forEach((body) => {
    const r = body.readings.get(name);
    if (r === undefined || r.world === null) return;
    world++;
    if (r.shown !== null) shown.push(r.shown);
    if (r.flat === null) return;
    flat++;
    apart.push(Math.abs(r.flat - r.world));
  });
  const flatShake: number[] = [];
  const worldShake: number[] = [];
  for (let i = 1; i + 1 < measured.length; i++) {
    const [a, b, c] = [get(i - 1), get(i), get(i + 1)];
    if (a === null || b === null || c === null) continue;
    if (a.flat === null || b.flat === null || c.flat === null || a.world === null || b.world === null || c.world === null) continue;
    const along = (b.t - a.t) / (c.t - a.t);
    flatShake.push(Math.abs(b.flat - (a.flat + (c.flat - a.flat) * along)));
    worldShake.push(Math.abs(b.world - (a.world + (c.world - a.world) * along)));
  }
  return {
    name,
    unit,
    world,
    flat,
    flatShake: quantile(flatShake, 0.5),
    worldShake: quantile(worldShake, 0.5),
    shakeFrames: flatShake.length,
    apart: quantile(apart, 0.5),
    shown: quantile(shown, 0.5),
  };
}

/** "flat" or "3D", the reading that shakes less; "-" when fewer than 10 frames have both. */
export function steadierOf(s: MeasureSummary): "flat" | "3D" | "same" | "-" {
  if (s.shakeFrames < 10) return "-";
  return s.flatShake < s.worldShake ? "flat" : s.worldShake < s.flatShake ? "3D" : "same";
}

export function summariesOf(measured: readonly MeasuredBody[]): MeasureSummary[] {
  return MEASURE_LIST.map(({ name, unit }) => summaryOf(measured, name, unit));
}

// ── The same video at half the frames a second ─────────────────────────────────────
export interface Agreement {
  /** Readings compared (flat and 3D each), at the frames both runs have. */
  readonly compared: number;
  /** Of those, read by one run and not by the other. */
  readonly differ: number;
  /** In 95 of 100, how far apart the two runs read the same measure, by kind. */
  readonly apart: Readonly<Record<Kind, number>>;
}

/** `half` must be the run of every second frame of the frames `full` ran on. */
export function agreementOf(full: readonly MeasuredBody[], half: readonly MeasuredBody[]): Agreement {
  let compared = 0;
  let differ = 0;
  const apart: Record<Kind, number[]> = { angle: [], length: [] };
  half.forEach((h, n) => {
    const f = full[n * 2];
    if (f === undefined) return;
    for (const { name, unit } of MEASURE_LIST) {
      const a = f.readings.get(name);
      const b = h.readings.get(name);
      if (a === undefined || b === undefined) continue;
      for (const [x, y] of [
        [a.flat, b.flat],
        [a.world, b.world],
      ] as const) {
        compared++;
        if ((x === null) !== (y === null)) differ++;
        else if (x !== null && y !== null) apart[kindOf(unit)].push(Math.abs(x - y));
      }
    }
  });
  return { compared, differ, apart: { angle: quantile(apart.angle, 0.95), length: quantile(apart.length, 0.95) } };
}

// ── The frames worth a picture ─────────────────────────────────────────────────────
/** The measures written on a picture: the big joints, the trunk, the hips' height and the widths. */
export const DRAWN: readonly MeasureName[] = [
  "trunk lean",
  "left knee",
  "right knee",
  "left hip",
  "right hip",
  "left elbow",
  "right elbow",
  "left shoulder",
  "right shoulder",
  "hips height",
  "left ankle height",
  "right ankle height",
  "hands apart",
  "feet apart",
];

const UNIT_WORD: Readonly<Record<Unit, string>> = { degrees: "°", legs: " legs", trunks: " trunks" };

export function readingWords(unit: Unit, flat: number | null, world: number | null): string {
  const say = (v: number | null): string => (v === null ? "-" : `${v.toFixed(unit === "degrees" ? 0 : 2)}${UNIT_WORD[unit]}`);
  return `flat ${say(flat)} | 3D ${say(world)}`;
}

/** `most` frames spread evenly over those where something is measured, each with its measures. */
export function framesToDraw(run: Run, most = 8): PictureFrame[] {
  const read = (i: number): boolean => [...(run.measured[i]?.readings.values() ?? [])].some((r) => r.world !== null);
  const found = run.checked.flatMap((c, i) => (c.person === null || !read(i) ? [] : [i]));
  const chosen = found.length <= most ? found : Array.from({ length: most }, (_, n) => found[Math.round((n * (found.length - 1)) / (most - 1))] ?? 0);
  return [...new Set(chosen)].flatMap((i) => {
    const c = run.checked[i];
    const m = run.measured[i];
    if (c === undefined || c.person === null || m === undefined) return [];
    const lines = DRAWN.flatMap((name) => {
      const r = m.readings.get(name);
      const unit = MEASURE_LIST.find((x) => x.name === name)?.unit ?? "degrees";
      return r === undefined || (r.flat === null && r.world === null) ? [] : [`${name}: ${readingWords(unit, r.flat, r.world)}`];
    });
    return [
      {
        index: i,
        t: c.t,
        why: "measures",
        lines: [`${(c.t / 1000).toFixed(2)} s  frame ${String(i + 1)}`, ...lines],
        people: [{ points: c.person.points, refused: c.refused }],
      },
    ];
  });
}
