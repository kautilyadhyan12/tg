// Whether the phone's own pose model gives the laptop's numbers (ROADMAP Stage 5 item 51a; spec Part 2 §12.5). Every
// rule an exercise gets is set from numbers the laptop measured; if the phone reads the same video differently, every
// count on a member's phone is off by that much. So a phone run is called the same as the laptop's only when:
//   - it read the laptop's very pictures: the same shape, the same frames at the same times;
//   - the phone's person fits the laptop's best as it is, not one picture late or early, not mirrored, not with
//     left and right swapped (judged where the body moves most, where each of those shows);
//   - it gives 3D points;
//   - its body measures, worked out by this engine, lie no further from the laptop's than the laptop's own lie from
//     the same video at half the frames a second: a change every exercise's proof must already survive (§12.5,
//     "fewer frames a second"). Measured on the very video, so the bar is the video's own, never a number typed here.
import { KP, type MovementFrame, type PhoneHeat, type PhoneTestDelegate, type SeenPerson } from "@app/shared";
import { MAIN_JOINTS, MEASURE_LIST, type MeasureName, type MeasuredBody, type Unit } from "../src/index.js";
import { halfRate, runChecks, runSteady } from "./bodyCheck.js";
import type { BodyPoints } from "./bodyPoints.js";
import { followOne } from "./follow.js";
import { agreementOf, kindOf, runMeasures, type Agreement } from "./measureCheck.js";
import { MODELS, phoneFrames, type PhoneRun } from "./phoneRun.js";

/** Each point's twin on the other side of the body: a mirror, or a swap of left and right, exchanges them. */
export const MIRROR: readonly number[] = [0, 4, 5, 6, 1, 2, 3, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17, 20, 19, 22, 21, 24, 23, 26, 25, 28, 27, 30, 29, 32, 31];
/** A point is compared only where both models give it an even chance of being seen, as the engine uses it. */
const SURE = 0.5;
/** A way of reading the phone's person must fit at least this much better than as it is before it is named: a
 *  phone truly one picture late fits its shifted self many times better, and a near tie is the models' own shake. */
export const FIT_MARGIN = 0.8;
/** The first pictures a model reads are slower while it warms up; they are left out of its speed. */
export const WARM_UP = 10;
/** Fewer moving frames than this, and how the phone's person fits cannot be told. */
const LEAST_MOVING = 10;

type Pair = readonly [number, number];

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;
}
const median = (values: readonly number[]): number => quantile(values, 0.5);

export interface Spread {
  readonly median: number;
  readonly p95: number;
  readonly count: number;
}
const spreadOf = (values: readonly number[]): Spread => ({ median: median(values), p95: quantile(values, 0.95), count: values.length });

// ── The picture's geometry ─────────────────────────────────────────────────────────
function at(person: SeenPerson, j: number, aspect: number): Pair | null {
  const p = person.points[j];
  return p === undefined ? null : [p[0] * aspect, p[1]];
}

function middle(person: SeenPerson, a: number, b: number, aspect: number): Pair | null {
  const pa = at(person, a, aspect);
  const pb = at(person, b, aspect);
  return pa === null || pb === null ? null : [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
}

/** The trunk's length on the picture, shoulders' middle to hips' middle, in picture heights. */
export function trunkOf(person: SeenPerson, aspect: number): number {
  const s = middle(person, KP.left_shoulder, KP.right_shoulder, aspect);
  const h = middle(person, KP.left_hip, KP.right_hip, aspect);
  return s === null || h === null ? Number.NaN : Math.hypot(s[0] - h[0], s[1] - h[1]);
}

function centreOf(person: SeenPerson, aspect: number): Pair {
  let x = 0;
  let y = 0;
  for (const j of [KP.left_shoulder, KP.right_shoulder, KP.left_hip, KP.right_hip]) {
    x += (person.points[j]?.[0] ?? 0) * aspect;
    y += person.points[j]?.[1] ?? 0;
  }
  return [x / 4, y / 4];
}

const sure = (person: SeenPerson, j: number): boolean => (person.points[j]?.[3] ?? 0) >= SURE;

/** A person as a phone that mirrored the picture would see them: the picture flipped, and each side named the other's. */
export function mirrored(person: SeenPerson): SeenPerson {
  return {
    points: MIRROR.map((twin, j) => {
      const p = person.points[twin] ?? person.points[j];
      return p === undefined ? [0, 0, 0, 0, 0] : [1 - p[0], p[1], p[2], p[3], p[4]];
    }),
    world:
      person.world === null
        ? null
        : MIRROR.map((twin, j) => {
            const w = person.world?.[twin] ?? person.world?.[j];
            return w === undefined ? [0, 0, 0] : [-w[0], w[1], w[2]];
          }),
  };
}

/** A person with each side named the other's, the picture as it is. */
export function swapped(person: SeenPerson): SeenPerson {
  return {
    points: MIRROR.map((twin, j) => {
      const p = person.points[twin] ?? person.points[j];
      return p === undefined ? [0, 0, 0, 0, 0] : [p[0], p[1], p[2], p[3], p[4]];
    }),
    world:
      person.world === null
        ? null
        : MIRROR.map((twin, j) => {
            const w = person.world?.[twin] ?? person.world?.[j];
            return w === undefined ? [0, 0, 0] : [w[0], w[1], w[2]];
          }),
  };
}

/** The middle gap between two people's big joints on the picture, in the laptop person's trunks; null when fewer than
 *  four joints are sure in both. */
function gapOf(phone: SeenPerson, laptop: SeenPerson, aspect: number): number | null {
  const trunk = trunkOf(laptop, aspect);
  if (!(trunk > 0)) return null;
  const gaps = MAIN_JOINTS.flatMap((j) => {
    const a = at(phone, j, aspect);
    const b = at(laptop, j, aspect);
    if (a === null || b === null || !sure(phone, j) || !sure(laptop, j)) return [];
    return [Math.hypot(a[0] - b[0], a[1] - b[1]) / trunk];
  });
  return gaps.length < 4 ? null : median(gaps);
}

// ── Who is who ─────────────────────────────────────────────────────────────────────
/** In each frame, the phone's person nearest the laptop's followed one, by the trunk's middle, the picture as it is
 *  or mirrored: so a mirrored phone is still matched, and named for it below. Null where either has nobody. */
export function matchPeople(laptop: readonly (SeenPerson | null)[], phone: readonly MovementFrame[]): (SeenPerson | null)[] {
  return laptop.map((l, i) => {
    const frame = phone[i];
    if (l === null || frame === undefined) return null;
    const c = centreOf(l, frame.aspect);
    const flipped: Pair = [frame.aspect - c[0], c[1]];
    let best: SeenPerson | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const p of frame.people) {
      const pc = centreOf(p, frame.aspect);
      const gap = Math.min(Math.hypot(pc[0] - c[0], pc[1] - c[1]), Math.hypot(pc[0] - flipped[0], pc[1] - flipped[1]));
      if (gap < bestGap) {
        bestGap = gap;
        best = p;
      }
    }
    return best;
  });
}

// ── How the phone's person fits ────────────────────────────────────────────────────
export interface Fit {
  /** The middle gap, in trunks, over the frames where the body moves most. */
  readonly asIs: number;
  readonly late: number;
  readonly early: number;
  readonly mirrored: number;
  readonly swapped: number;
  readonly frames: number;
}

/** How far the laptop's big joints move in a frame, in trunks: half the way from the frame before to the one after. */
function motionAt(laptop: readonly (SeenPerson | null)[], i: number, aspect: number): number | null {
  const [a, b, c] = [laptop[i - 1], laptop[i], laptop[i + 1]];
  if (a == null || b == null || c == null) return null;
  const trunk = trunkOf(b, aspect);
  if (!(trunk > 0)) return null;
  const moves = MAIN_JOINTS.flatMap((j) => {
    const pa = at(a, j, aspect);
    const pc = at(c, j, aspect);
    if (pa === null || pc === null || !sure(a, j) || !sure(c, j)) return [];
    return [Math.hypot(pc[0] - pa[0], pc[1] - pa[1]) / 2 / trunk];
  });
  return moves.length < 4 ? null : median(moves);
}

export function fitOf(laptop: readonly (SeenPerson | null)[], phone: readonly (SeenPerson | null)[], aspect: number): Fit | null {
  const moving = laptop.flatMap((_, i) => {
    const m = motionAt(laptop, i, aspect);
    return m === null ? [] : [{ i, m }];
  });
  const most = median(moving.map((x) => x.m));
  const rows = moving
    .filter((x) => x.m >= most)
    .flatMap(({ i }) => {
      const p = phone[i];
      const [before, now, after] = [laptop[i - 1], laptop[i], laptop[i + 1]];
      if (p == null || before == null || now == null || after == null) return [];
      const gaps = [gapOf(p, now, aspect), gapOf(p, before, aspect), gapOf(p, after, aspect), gapOf(p, mirrored(now), aspect), gapOf(p, swapped(now), aspect)];
      return gaps.every((g) => g !== null) ? [gaps] : [];
    });
  if (rows.length < LEAST_MOVING) return null;
  const column = (k: number): number => median(rows.map((r) => r[k] ?? 0));
  return { asIs: column(0), late: column(1), early: column(2), mirrored: column(3), swapped: column(4), frames: rows.length };
}

const FIT_WORDS: Readonly<Record<Exclude<keyof Fit, "asIs" | "frames">, string>> = {
  late: "the phone's points fit the picture before: the phone is one picture late",
  early: "the phone's points fit the picture after: the phone is one picture early",
  mirrored: "the phone's points fit the picture mirrored",
  swapped: "the phone's points fit with left and right swapped",
};

export function fitRefusals(fit: Fit): string[] {
  return (["late", "early", "mirrored", "swapped"] as const).flatMap((k) => (fit[k] < FIT_MARGIN * fit.asIs ? [FIT_WORDS[k]] : []));
}

// ── The points and the measures ────────────────────────────────────────────────────
/** Every big joint sure in both, how far apart: on the picture in the laptop person's trunks, and in 3D in metres. */
export function pointGaps(laptop: readonly (SeenPerson | null)[], phone: readonly (SeenPerson | null)[], aspect: number): { flat: Spread; world: Spread } {
  const flat: number[] = [];
  const world: number[] = [];
  laptop.forEach((l, i) => {
    const p = phone[i];
    if (l == null || p == null) return;
    const trunk = trunkOf(l, aspect);
    for (const j of MAIN_JOINTS) {
      if (!sure(l, j) || !sure(p, j)) continue;
      const a = at(l, j, aspect);
      const b = at(p, j, aspect);
      if (a !== null && b !== null && trunk > 0) flat.push(Math.hypot(a[0] - b[0], a[1] - b[1]) / trunk);
      const wa = l.world?.[j];
      const wb = p.world?.[j];
      if (wa !== undefined && wb !== undefined) world.push(Math.hypot(wa[0] - wb[0], wa[1] - wb[1], wa[2] - wb[2]));
    }
  });
  return { flat: spreadOf(flat), world: spreadOf(world) };
}

/** The frames with one person in each, the one followed: what the engine is given. */
function only(frames: readonly MovementFrame[], people: readonly (SeenPerson | null)[]): MovementFrame[] {
  return frames.map((f, i) => {
    const p = people[i];
    return { ...f, people: p == null ? [] : [p] };
  });
}

const measuredOf = (frames: readonly MovementFrame[]): MeasuredBody[] => runMeasures(runSteady(runChecks(frames)));

export interface MeasureGap {
  readonly name: MeasureName;
  readonly unit: Unit;
  readonly reading: "flat" | "3D";
  /** The phone's reading less the laptop's: the middle, and how far apart in 95 of 100. */
  readonly bias: number;
  readonly p95: number;
  readonly count: number;
}

/** For each measure and reading, how the phone's lies from the laptop's at the frames both read it. */
export function measureGaps(laptop: readonly MeasuredBody[], phone: readonly MeasuredBody[]): MeasureGap[] {
  return MEASURE_LIST.flatMap(({ name, unit }) =>
    (["flat", "3D"] as const).flatMap((reading) => {
      const signed: number[] = [];
      laptop.forEach((l, i) => {
        const a = l.readings.get(name);
        const b = phone[i]?.readings.get(name);
        const x = reading === "flat" ? a?.flat : a?.world;
        const y = reading === "flat" ? b?.flat : b?.world;
        if (x != null && y != null) signed.push(y - x);
      });
      if (signed.length === 0) return [];
      return [{ name, unit, reading, bias: median(signed), p95: quantile(signed.map(Math.abs), 0.95), count: signed.length }];
    }),
  );
}

// ── Two runs of one video, compared ────────────────────────────────────────────────
export interface FrameComparison {
  readonly frames: number;
  /** Frames where the laptop follows somebody, and of those, where the phone has nobody. */
  readonly laptopFound: number;
  readonly missed: number;
  /** Frames where the laptop found more than one person, and of those, where the other found as many. */
  readonly several: number;
  readonly severalSame: number;
  readonly mostLaptop: number;
  readonly mostOther: number;
  /** Frames where the laptop's person has 3D points, and of those, where the other's has none. */
  readonly world: number;
  readonly worldMissing: number;
  readonly fit: Fit | null;
  readonly points: { readonly flat: Spread; readonly world: Spread };
  readonly measures: Agreement;
  /** The laptop against itself at half the frames a second: the bar. */
  readonly yardstick: Agreement;
  readonly gaps: readonly MeasureGap[];
}

/** The frames of one video as two runs gave them: the laptop's, and the phone's (or a smaller model's). */
export function compareFrames(laptop: readonly MovementFrame[], other: readonly MovementFrame[]): FrameComparison {
  const followed = followOne(laptop);
  const matched = matchPeople(followed, other);
  const aspect = laptop[0]?.aspect ?? 1;
  const mine = only(laptop, followed);
  const theirs = only(other, matched);
  const laptopMeasured = measuredOf(mine);
  const otherMeasured = measuredOf(theirs);
  const half = measuredOf(halfRate(mine));
  const several = laptop.flatMap((f, i) => (f.people.length > 1 ? [i] : []));
  return {
    frames: laptop.length,
    laptopFound: followed.filter((p) => p !== null).length,
    missed: followed.filter((p, i) => p !== null && matched[i] === null).length,
    several: several.length,
    severalSame: several.filter((i) => other[i]?.people.length === laptop[i]?.people.length).length,
    mostLaptop: Math.max(0, ...laptop.map((f) => f.people.length)),
    mostOther: Math.max(0, ...other.map((f) => f.people.length)),
    world: followed.filter((p) => p?.world != null).length,
    worldMissing: followed.filter((p, i) => {
      const m = matched[i];
      return p?.world != null && m != null && m.world === null;
    }).length,
    fit: fitOf(followed, matched, aspect),
    points: pointGaps(followed, matched, aspect),
    measures: agreementOf(laptopMeasured, otherMeasured, 1),
    yardstick: agreementOf(laptopMeasured, half, 2),
    gaps: measureGaps(laptopMeasured, otherMeasured),
  };
}

const share = (a: Agreement): number => (a.compared === 0 ? 0 : a.differ / a.compared);
const pct = (v: number): string => `${(100 * v).toFixed(1)} in 100`;

/** Why the other run's measures are not the laptop's, against the video's own bar; empty when they are. */
export function measureRefusals(c: FrameComparison): string[] {
  const out: string[] = [];
  const { measures: m, yardstick: y } = c;
  if (m.compared === 0) return ["no body measure could be compared"];
  if (share(m) > share(y)) out.push(`${pct(share(m))} of its readings are given by one and not the other (half the frames a second: ${pct(share(y))})`);
  for (const kind of ["angle", "length"] as const) {
    const a = m.apart[kind];
    const b = y.apart[kind];
    const words = kind === "angle" ? (v: number) => `${v.toFixed(2)}°` : (v: number) => `${v.toFixed(3)} of a length`;
    if (Number.isFinite(a) && Number.isFinite(b) && a > b) out.push(`its ${kind}s lie ${words(a)} from the laptop's in 95 of 100 (half the frames a second: ${words(b)})`);
  }
  return out;
}

/** Everything that keeps the other run from being the laptop's, in the frames alone. */
export function frameRefusals(c: FrameComparison): string[] {
  const out: string[] = [];
  if (c.laptopFound > 0 && c.missed === c.laptopFound) out.push("it found nobody where the laptop found the person");
  if (c.world > 0 && c.worldMissing === c.world) out.push("it gives no 3D points");
  else if (c.worldMissing > 0) out.push(`it gives no 3D points in ${String(c.worldMissing)} of ${String(c.world)} frames`);
  if (c.fit !== null) out.push(...fitRefusals(c.fit));
  out.push(...measureRefusals(c));
  return out;
}

// ── A phone run against the laptop's ───────────────────────────────────────────────
export interface PhoneComparison {
  readonly label: string;
  readonly model: string;
  readonly delegate: PhoneTestDelegate;
  readonly refused: readonly string[];
  readonly frames: FrameComparison | null;
  readonly speed: {
    readonly detect: Spread;
    /** The middle reading time of frames with one person, and with more than one. */
    readonly one: number;
    readonly several: number;
    readonly decode: number;
    readonly create: number;
  };
  readonly heat: { readonly before: PhoneHeat; readonly after: PhoneHeat };
}

/** Whether a phone run is the laptop's, and why not. `laptop` is the laptop's run of the same model on the same video. */
export function comparePhone(laptop: BodyPoints, run: PhoneRun): PhoneComparison {
  const refused: string[] = [];
  const { header } = run;
  const lp = laptop.header.picture;
  const pp = header.picture;
  if (lp.width !== pp.width || lp.height !== pp.height) {
    refused.push(`the phone's pictures are ${String(pp.width)} by ${String(pp.height)}, the laptop's ${String(lp.width)} by ${String(lp.height)}: turned or cut`);
  }
  const lm = laptop.header.model;
  const pm = header.model;
  if (lm.file !== pm.file) refused.push(`the laptop's file is the ${lm.file} model's, the phone's the ${pm.file}'s`);
  if (lm.people !== pm.people || lm.minDetection !== pm.minDetection || lm.minPresence !== pm.minPresence || lm.minTracking !== pm.minTracking) {
    refused.push("the phone's model ran with other settings than the laptop's");
  }
  const sameFrames = run.frames.length === laptop.frames.length && run.frames.every((f, i) => Math.abs(f.t - (laptop.frames[i]?.t ?? Number.NaN)) < 0.05);
  if (!sameFrames) refused.push(`the phone read ${String(run.frames.length)} frames at other times than the laptop's ${String(laptop.frames.length)}`);
  // The phone's own clock for each picture: a decoder that numbers the video's frames differently plays them at other times.
  const halfFrame = 500 / laptop.header.videoFps;
  const late = run.frames.findIndex((f) => Math.abs(f.at - f.t) > halfFrame);
  const off = run.frames[late];
  if (off !== undefined) refused.push(`the phone plays frame ${String(off.i + 1)} at ${off.at.toFixed(1)} ms, the laptop at ${off.t.toFixed(1)} ms`);
  const frames = sameFrames && refused.length === 0 ? compareFrames(laptop.frames, phoneFrames(run)) : null;
  if (frames !== null) refused.push(...frameRefusals(frames));
  const timed = run.frames.slice(WARM_UP);
  return {
    label: header.label,
    model: header.model.file,
    delegate: header.delegate,
    refused,
    frames,
    speed: {
      detect: spreadOf(timed.map((f) => f.detectMs)),
      one: median(timed.filter((f) => f.people.length === 1).map((f) => f.detectMs)),
      several: median(timed.filter((f) => f.people.length > 1).map((f) => f.detectMs)),
      decode: median(run.frames.map((f) => f.decodeMs)),
      create: header.createMs,
    },
    heat: { before: header.heat, after: run.end.heat },
  };
}

// ── All the runs: the table, and the pick ──────────────────────────────────────────
export interface RunSummary {
  readonly model: string;
  readonly delegate: PhoneTestDelegate;
  readonly videos: number;
  readonly same: number;
  readonly failed: number;
  readonly detect: Spread;
  readonly create: number;
  readonly warmest: number;
}

export function summaries(runs: readonly PhoneComparison[], failed: readonly { model: string; delegate: PhoneTestDelegate }[], detectTimes: ReadonlyMap<string, readonly number[]>): RunSummary[] {
  const keys = [...new Set([...runs, ...failed].map((r) => `${r.model}|${r.delegate}`))];
  return keys.map((key) => {
    const mine = runs.filter((r) => `${r.model}|${r.delegate}` === key);
    const lost = failed.filter((r) => `${r.model}|${r.delegate}` === key).length;
    const [model = "", delegate = "cpu"] = key.split("|");
    return {
      model,
      delegate: delegate === "gpu" ? "gpu" : "cpu",
      videos: mine.length + lost,
      same: mine.filter((r) => r.refused.length === 0).length,
      failed: lost,
      detect: spreadOf(detectTimes.get(key) ?? []),
      create: median(mine.map((r) => r.speed.create)),
      warmest: Math.max(-1, ...mine.map((r) => r.heat.after.thermal)),
    };
  });
}

/** 20 pictures a second (spec Part 6 §3.2's throughput bar): a reading in 50 ms or less, in 95 of 100. */
export const FAST_ENOUGH_MS = 50;

/** The pick so far: the biggest model that is the laptop's on every video and fast enough; between its two chips,
 *  the faster. Null when none is both. Job 51b tries it on the live camera for 20 minutes. */
export function pick(rows: readonly RunSummary[]): RunSummary | null {
  const order = [...MODELS].reverse().map((m) => m.name);
  for (const name of order) {
    const fit = rows
      .filter((r) => r.model === name && r.failed === 0 && r.videos > 0 && r.same === r.videos && r.detect.p95 <= FAST_ENOUGH_MS)
      .sort((a, b) => a.detect.p95 - b.detect.p95);
    if (fit[0] !== undefined) return fit[0];
  }
  return null;
}

/** The words for a measure gap, for the table. */
export function gapWords(g: MeasureGap): string {
  const unit = kindOf(g.unit) === "angle" ? "°" : "";
  const n = (v: number): string => (kindOf(g.unit) === "angle" ? v.toFixed(2) : v.toFixed(3));
  return `${g.name} (${g.reading}): ${n(g.bias)}${unit} in the middle, ${n(g.p95)}${unit} apart in 95 of 100`;
}
