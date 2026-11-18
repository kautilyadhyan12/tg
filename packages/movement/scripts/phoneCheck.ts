// How a phone run stands against the laptop's run of the same video and model (ROADMAP Stage 5 items 51a and 51b; spec Part 2
// §12.5). Every rule an exercise gets is set from numbers the laptop measured, so the worst thing this could do is call
// a phone that reads the body differently "the laptop's numbers". A run is, in order:
//   - not comparable, and nothing in it used, when it did not read the laptop's very pictures with the laptop's
//     settings (the shape, the frames and their times, the model, how many people), or reads its person a wrong way:
//     one picture late or early, mirrored, the sides swapped (judged where the body moves most), or with no 3D;
//   - compared only, when the phone decoded the video itself: then its numbers judge its video decoder as well as its
//     chip, and are reported reading by reading, never judged (measured 2026-11-17: the decoder alone moves the main
//     chip 1 to 6.5 cm);
//   - the same, when it read the laptop's own decoded pictures and lies within a tenth of the model's own shake from
//     the laptop's in 99 of 100 big joints, and no joint in any frame further than the bars for one lone point
//     (SAME_SHARE_OF_SHAKE, SAME_LARGEST_*); otherwise it differs, with the numbers.
// A file is refused whole unless its plan, its video, its model and its cores are this run's (`Sums`): a folder's old
// file is never read as a new one, and a run on other cores is never judged as the one asked for (51b).
// Whether a chip that differs counts the same is not this file's to say: from job 52a, the proof table's.
import { KP, type MovementFrame, type PhoneHeat, type PhoneTestDelegate, type SeenPerson } from "@app/shared";
import { MAIN_JOINTS, MEASURE_LIST, type CheckedBody, type MeasureName, type MeasuredBody, type SteadyBody, type Unit } from "../src/index.js";
import { runChecks, runSteady, steadinessOf } from "./bodyCheck.js";
import type { BodyPoints } from "./bodyPoints.js";
import { followOne } from "./follow.js";
import { agreementOf, kindOf, runMeasures, type Agreement } from "./measureCheck.js";
import { coresBusy, phoneFrames, type PhoneRun } from "./phoneRun.js";

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
/** The readings a squat-like movement rests on, written out one by one in the report, lean and spread apart: one number
 *  over all 76 readings is ruled by those no rule should use (the far side, 3D ankles and elbows). */
export const KEY_READINGS: readonly MeasureName[] = ["left knee", "right knee", "left hip", "right hip", "trunk lean", "left elbow", "right elbow"];

/** A run gives the laptop's numbers when, among the big joints the model is sure of in both:
 *  - in 99 of 100 it lies less than a tenth of the model's own frame-to-frame shake from the laptop's, on the picture
 *    and in 3D (the shake of the laptop's own run of that video): a tenth of the shake is lost in the shake;
 *  - no joint in any frame lies further than the model's own shake in 3D, or than four times it on the picture, so a
 *    point thrown far off once in a while is never hidden in the 1 of 100 (round one, H1: a knee 20 cm off in every
 *    80th frame passed the 99th alone);
 *  - it gives a reading the laptop does not, or the other way round, in at most 1 of 1,000.
 *  Two processors round their last digits apart, so 0.0 is not the bar. Measured 2026-11-17 and 18 on the laptop's own
 *  pictures of the chair squat: the phone's main chip lay 0.15 to 0.18 mm off in 99 of 100 in 3D (0.02 mm in the
 *  middle), its largest 3D gap 0.03 to 0.05 of the shake; on the picture lone joints in single frames reached 1.9 times
 *  the shake (one hip in 2,121; the 3D of that joint stayed put), the graphics chip's largest 7.7 to 12.9 times; it
 *  differed in 0 to 1 of 17,024 readings. The picture's bar is twice the main chip's largest, set from this one video:
 *  job 51b's clean runs on four videos check it. */
export const SAME_SHARE_OF_SHAKE = 0.1;
export const SAME_LARGEST_WORLD = 1;
export const SAME_LARGEST_FLAT = 4;
export const SAME_DIFFER = 1 / 1000;

export interface Closeness {
  /** In 99 of 100 big joints sure in both, how far apart: on the picture in the body's size, in 3D in metres. */
  readonly flat99: number;
  readonly world99: number;
  /** The largest gap of any of those joints in any frame, in the same units. */
  readonly flatMost: number;
  readonly worldMost: number;
  /** The laptop run's own frame-to-frame shake of a used big joint, the middle, in the same units. */
  readonly flatShake: number;
  readonly worldShake: number;
  /** Readings given by one run and not the other, a share of all compared. */
  readonly differ: number;
}

export interface FrameComparison {
  readonly frames: number;
  /** Frames where the laptop follows somebody, and of those, where the other has nobody. */
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
  readonly closeness: Closeness;
  readonly measures: Agreement;
  readonly gaps: readonly MeasureGap[];
}

/** The steady points of the frames' one person, with the possible-body checks before them. */
function steadyRun(frames: readonly MovementFrame[]): { checked: CheckedBody[]; steady: SteadyBody[] } {
  const checked = runChecks(frames);
  return { checked, steady: runSteady(checked) };
}

/** A video's own shake, as the model gave it: the middle frame-to-frame shake of a used big joint, on the picture in
 *  the body's size and in 3D in metres (body-check's measure). */
export function shakeOf(frames: readonly MovementFrame[]): { readonly flat: number; readonly world: number } {
  const { checked, steady } = steadyRun(only(frames, followOne(frames)));
  return { flat: steadinessOf(checked, steady, "flat").shakeRaw, world: steadinessOf(checked, steady, "world").shakeRaw };
}

function closenessOf(checked: readonly CheckedBody[], other: readonly (SeenPerson | null)[], differ: number, shake: { flat: number; world: number }): Closeness {
  const flat: number[] = [];
  const world: number[] = [];
  checked.forEach((c, i) => {
    const l = c.person;
    const p = other[i];
    if (l === null || p == null || c.size === null) return;
    for (const j of MAIN_JOINTS) {
      if (!sure(l, j) || !sure(p, j)) continue;
      const a = at(l, j, c.aspect);
      const b = at(p, j, c.aspect);
      if (a !== null && b !== null) flat.push(Math.hypot(a[0] - b[0], a[1] - b[1]) / c.size);
      const wa = l.world?.[j];
      const wb = p.world?.[j];
      if (wa !== undefined && wb !== undefined) world.push(Math.hypot(wa[0] - wb[0], wa[1] - wb[1], wa[2] - wb[2]));
    }
  });
  const most = (values: readonly number[]): number => (values.length === 0 ? Number.NaN : Math.max(...values));
  return {
    flat99: quantile(flat, 0.99),
    world99: quantile(world, 0.99),
    flatMost: most(flat),
    worldMost: most(world),
    flatShake: shake.flat,
    worldShake: shake.world,
    differ,
  };
}

/** The frames of one video as two runs gave them: the laptop's, and the phone's (or another model's, or one chip's
 *  against the other's). */
export function compareFrames(laptop: readonly MovementFrame[], other: readonly MovementFrame[]): FrameComparison {
  const followed = followOne(laptop);
  const matched = matchPeople(followed, other);
  const aspect = laptop[0]?.aspect ?? 1;
  const mine = steadyRun(only(laptop, followed));
  const laptopMeasured = runMeasures(mine.steady);
  const otherMeasured = measuredOf(only(other, matched));
  const measures = agreementOf(laptopMeasured, otherMeasured, 1);
  const shake = { flat: steadinessOf(mine.checked, mine.steady, "flat").shakeRaw, world: steadinessOf(mine.checked, mine.steady, "world").shakeRaw };
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
    closeness: closenessOf(mine.checked, matched, measures.compared === 0 ? 1 : measures.differ / measures.compared, shake),
    measures,
    gaps: measureGaps(laptopMeasured, otherMeasured),
  };
}

/** Why the two runs cannot be compared at all: the other found nobody, gave no 3D, or fits the laptop's person
 *  better read some wrong way. Empty when they can. */
export function comparableRefusals(c: FrameComparison): string[] {
  const out: string[] = [];
  if (c.laptopFound > 0 && c.missed === c.laptopFound) out.push("it found nobody where the laptop found the person");
  if (c.world > 0 && c.worldMissing === c.world) out.push("it gives no 3D points");
  else if (c.worldMissing > 0) out.push(`it gives no 3D points in ${String(c.worldMissing)} of ${String(c.world)} frames`);
  if (c.fit !== null) out.push(...fitRefusals(c.fit));
  return out;
}

/** Why the other run's numbers are not the laptop's; empty when they are. */
export function sameRefusals(c: Closeness): string[] {
  const out: string[] = [];
  const bar = SAME_SHARE_OF_SHAKE;
  if (!(c.flat99 <= bar * c.flatShake)) {
    out.push(`on the picture its big joints lie ${c.flat99.toFixed(4)} of the body's size from the laptop's in 99 of 100, more than a tenth of the model's own shake (${c.flatShake.toFixed(4)})`);
  }
  if (!(c.world99 <= bar * c.worldShake)) {
    out.push(`in 3D its big joints lie ${(1000 * c.world99).toFixed(2)} mm from the laptop's in 99 of 100, more than a tenth of the model's own shake (${(1000 * c.worldShake).toFixed(2)} mm)`);
  }
  if (!(c.worldMost <= SAME_LARGEST_WORLD * c.worldShake)) {
    out.push(`in 3D a big joint lies ${(1000 * c.worldMost).toFixed(2)} mm from the laptop's, further than the model's own shake (${(1000 * c.worldShake).toFixed(2)} mm)`);
  }
  if (!(c.flatMost <= SAME_LARGEST_FLAT * c.flatShake)) {
    out.push(`on the picture a big joint lies ${c.flatMost.toFixed(4)} of the body's size from the laptop's, further than four times the model's own shake (${c.flatShake.toFixed(4)})`);
  }
  if (!(c.differ <= SAME_DIFFER)) out.push(`${(1000 * c.differ).toFixed(1)} in 1,000 of its readings are given by one and not the other`);
  return out;
}

// ── A phone run against the laptop's ───────────────────────────────────────────────
/** same: the laptop's numbers. differs: comparable, and not the laptop's numbers. compared only: the phone decoded the
 *  video itself, so its numbers judge its video decoder as well as its chip, and are reported, never judged.
 *  not comparable: the run read other pictures, or reads its person some wrong way: nothing in it may be used. */
export type Verdict = "same" | "differs" | "compared only" | "not comparable";

export interface PhoneComparison {
  readonly label: string;
  readonly model: string;
  /** The chip and cores the run ASKED for (null, the library's own), whatever the file says: a refused file is
   *  counted in the row of the run it was handed in as, never in a row of its own. */
  readonly delegate: PhoneTestDelegate;
  readonly threads: number | null;
  readonly pictures: "video" | "laptop";
  readonly verdict: Verdict;
  readonly reasons: readonly string[];
  readonly frames: FrameComparison | null;
  readonly speed: {
    readonly detect: Spread;
    /** The middle reading time of frames with one person, and with more than one. */
    readonly one: number;
    readonly several: number;
    readonly decode: number;
    readonly create: number;
    /** How many cores the reading kept busy, or null when the file does not say. */
    readonly busy: number | null;
    /** Each reading's time after the first ten, for the table's row. */
    readonly readings: readonly number[];
  };
  readonly heat: { readonly before: PhoneHeat; readonly after: PhoneHeat };
}

/** What this run of the test sent the phone, by check sum: the plan, the video (or the laptop's pictures of it) and
 *  the model. A file naming other ones was made by another run of the test, or for another video or model. */
export interface Sums {
  readonly plan: string;
  readonly video: string;
  readonly model: string;
  /** The chip and the main chip's cores this run asked for; null, the library's own number. */
  readonly delegate: PhoneTestDelegate;
  readonly threads: number | null;
}

/** A run asked for 2 or more cores took them only if it kept more than this many busy. Measured 2026-11-18 on Kd's
 *  phone (51b-i, 40 runs): 1.03 to 1.05 on the library's own and on 1 core, 1.54 to 1.66 on 2, 2.25 to 2.68 on 4. The
 *  file says back the plan's number of cores, so only this shows the phone took them. */
export const CORES_TAKEN = 1.3;

const coresWords = (n: number | null): string => (n === null ? "the library's own number of cores" : `${String(n)} ${n === 1 ? "core" : "cores"}`);

/** Why the phone run is not this run's, or did not read the laptop's pictures with the laptop's settings: empty when
 *  it is and did. */
function sourceRefusals(laptop: BodyPoints, run: PhoneRun, sums: Sums): string[] {
  const refused: string[] = [];
  const { header } = run;
  // A file of 51a's first runs names no plan: they were the only runs of their kind, kept no plan ("none"), and every
  // later run deletes a kind's files before it sends anything. Where this kind kept a plan, a file naming none was
  // made by a copy of the app built before files named their plan, which may lack what this run tests (the re-check).
  if (header.plan === null && sums.plan !== "none") {
    refused.push("the file names no plan, and this run kept one: a copy of the app built before files named their plan");
  } else if (header.plan !== null && header.plan !== sums.plan) {
    refused.push("the file was made for another plan than this run's: an older run of the test");
  }
  if (header.video.sha256 !== sums.video) refused.push("the file was made from another video, or other pictures of it, than this run's");
  if (header.model.sha256 !== sums.model) refused.push("the file was made with another model file than this run's");
  if (header.delegate !== sums.delegate) refused.push(`the file was read on the ${header.delegate === "gpu" ? "graphics" : "main"} chip, this run asked for the ${sums.delegate === "gpu" ? "graphics" : "main"} chip`);
  if (header.threads !== sums.threads) refused.push(`the file was read on ${coresWords(header.threads)}, this run asked for ${coresWords(sums.threads)}`);
  if (sums.threads !== null && sums.threads >= 2) {
    const busy = coresBusy(run, WARM_UP);
    if (busy === null) refused.push(`this run asked for ${coresWords(sums.threads)} and the file does not say how many it kept busy`);
    else if (busy <= CORES_TAKEN) refused.push(`this run asked for ${coresWords(sums.threads)} and the phone kept ${busy.toFixed(2)} busy: the setting was not taken`);
  }
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
  // The phone's own clock for each picture: a decoder that numbers the video's frames differently plays them at other
  // times. The laptop's own pictures carry no clock of their own: the phone writes the laptop's time back, so this
  // check holds by itself for them.
  const halfFrame = 500 / laptop.header.videoFps;
  const off = run.frames.find((f) => Math.abs(f.at - f.t) > halfFrame);
  if (off !== undefined) refused.push(`the phone plays frame ${String(off.i + 1)} at ${off.at.toFixed(1)} ms, the laptop at ${off.t.toFixed(1)} ms`);
  return refused;
}

/** How a phone run stands against the laptop's run of the same model on the same video. */
export function comparePhone(laptop: BodyPoints, run: PhoneRun, sums: Sums): PhoneComparison {
  const { header } = run;
  const source = sourceRefusals(laptop, run, sums);
  const frames = source.length === 0 ? compareFrames(laptop.frames, phoneFrames(run)) : null;
  const wrong = frames === null ? source : comparableRefusals(frames);
  const differences = frames === null ? [] : sameRefusals(frames.closeness);
  let verdict: Verdict;
  let reasons: string[];
  if (wrong.length > 0) {
    verdict = "not comparable";
    reasons = wrong;
  } else if (header.pictures === "video") {
    verdict = "compared only";
    reasons = ["the phone decoded the video itself: its numbers judge its video decoder as well as its chip"];
  } else {
    verdict = differences.length === 0 ? "same" : "differs";
    reasons = differences;
  }
  const timed = run.frames.slice(WARM_UP);
  return {
    label: header.label,
    model: header.model.file,
    delegate: sums.delegate,
    threads: sums.threads,
    pictures: header.pictures,
    verdict,
    reasons,
    frames,
    speed: {
      detect: spreadOf(timed.map((f) => f.detectMs)),
      one: median(timed.filter((f) => f.people.length === 1).map((f) => f.detectMs)),
      several: median(timed.filter((f) => f.people.length > 1).map((f) => f.detectMs)),
      decode: median(run.frames.map((f) => f.decodeMs)),
      create: header.createMs,
      busy: coresBusy(run, WARM_UP),
      readings: timed.map((f) => f.detectMs),
    },
    heat: { before: header.heat, after: run.end.heat },
  };
}

// ── All the runs: the table ────────────────────────────────────────────────────────
export interface RunSummary {
  readonly model: string;
  readonly delegate: PhoneTestDelegate;
  readonly threads: number | null;
  readonly videos: number;
  readonly same: number;
  readonly differs: number;
  readonly comparedOnly: number;
  readonly notComparable: number;
  readonly failed: number;
  readonly detect: Spread;
  readonly create: number;
  readonly warmest: number;
  /** The middle of its runs' cores busy, or null when no file says. */
  readonly busy: number | null;
}

/** One kind of run in the table: a model on a chip, and on the main chip its cores. */
export const runKey = (r: { model: string; delegate: PhoneTestDelegate; threads: number | null }): string => `${r.model}|${r.delegate}|${r.threads === null ? "own" : String(r.threads)}`;

/** One row a kind of run asked for. Its speed, cores busy and warmth come from its comparable runs only: a refused
 *  file's numbers were not measured on what the row names. */
export function summaries(runs: readonly PhoneComparison[], failed: readonly { model: string; delegate: PhoneTestDelegate; threads: number | null }[]): RunSummary[] {
  const kinds = new Map([...runs, ...failed].map((r) => [runKey(r), { model: r.model, delegate: r.delegate, threads: r.threads }] as const));
  return [...kinds].map(([key, kind]) => {
    const mine = runs.filter((r) => runKey(r) === key);
    const usable = mine.filter((r) => r.verdict !== "not comparable");
    const lost = failed.filter((r) => runKey(r) === key).length;
    const count = (v: Verdict): number => mine.filter((r) => r.verdict === v).length;
    const busy = usable.flatMap((r) => (r.speed.busy === null ? [] : [r.speed.busy]));
    return {
      ...kind,
      videos: mine.length + lost,
      same: count("same"),
      differs: count("differs"),
      comparedOnly: count("compared only"),
      notComparable: count("not comparable"),
      failed: lost,
      detect: spreadOf(usable.flatMap((r) => r.speed.readings)),
      create: median(usable.map((r) => r.speed.create)),
      warmest: Math.max(-1, ...usable.map((r) => r.heat.after.thermal)),
      busy: busy.length === 0 ? null : median(busy),
    };
  });
}

/** The words for a measure gap: its lean (the middle of the one less the other) and its spread (how far apart in 95 of
 *  100). A lean moves a limit; a spread is mostly taken out by the steady points. */
export function gapWords(g: MeasureGap): string {
  const unit = kindOf(g.unit) === "angle" ? "°" : "";
  const n = (v: number): string => (kindOf(g.unit) === "angle" ? v.toFixed(2) : v.toFixed(3));
  return `${g.name} (${g.reading}): lean ${n(g.bias)}${unit}, spread ${n(g.p95)}${unit}`;
}

/** The key readings' gaps, both readings of each, in the list's order. */
export function keyGaps(gaps: readonly MeasureGap[]): MeasureGap[] {
  return KEY_READINGS.flatMap((name) => gaps.filter((g) => g.name === name));
}
