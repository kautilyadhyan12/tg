// What body-check does with the kept videos (ROADMAP 50c-ii): runs the possible-body check and
// the steady points on each, counts what was refused and why, sets each fitted limit by its
// rule from some people and tries it on another, and picks the frames worth a picture.
//
// The two rules, in words Kd can read:
//   - the bone limit is the smallest, in steps of 0.05 of the trunk, at which no one-person
//     video loses more than 1 in 200 of its sure joints to it;
//   - the steady settings are the steadiest that keep a joint moving faster than half a metre
//     a second, on average, no more than 1 cm further from where the model puts it than the
//     model's own shake already does, on every one-person video.
// "One-person video": the model found nobody else in any frame. On the others the stand-in
// follower (follow.ts) cannot yet keep the man apart from his reflection (job 52d), so they
// are tried, never used to set a number.
import type { MovementFrame, SeenPerson } from "@app/shared";
import {
  LIMITS,
  MAIN_JOINTS,
  POINT_NAMES,
  PossibleBody,
  STEADY,
  SteadyPoints,
  type CheckedBody,
  type Limits,
  type Refusal,
  type Smoothing,
  type SteadyBody,
  type SteadySettings,
} from "../src/index.js";
import { followOne } from "./follow.js";

export interface Video {
  readonly label: string;
  readonly frames: readonly MovementFrame[];
  /** Nobody but the one person in any frame. */
  readonly onePerson: boolean;
}

export function videoOf(label: string, frames: readonly MovementFrame[]): Video {
  return { label, frames, onePerson: frames.every((f) => f.people.length <= 1) };
}

export function runChecks(frames: readonly MovementFrame[], limits: Limits = LIMITS): CheckedBody[] {
  const followed: (SeenPerson | null)[] = followOne(frames);
  const check = new PossibleBody(limits);
  return frames.map((f, i) => check.check(f.t, f.aspect, f.down, followed[i] ?? null));
}

export function runSteady(checked: readonly CheckedBody[], settings: SteadySettings = STEADY): SteadyBody[] {
  const steady = new SteadyPoints(settings);
  return checked.map((c) => steady.next(c));
}

export const REASONS: readonly Refusal[] = ["time", "not-found", "no-3d", "hidden", "outside", "settling", "unchecked", "bone", "jump", "swap"];
/** Refused before any check of a possible body could run. */
const BEFORE_CHECKS: ReadonlySet<Refusal | null> = new Set<Refusal | null>(["time", "not-found", "no-3d", "hidden", "outside", "settling", "unchecked"]);

export interface Count {
  /** The twelve big joints in every frame. */
  readonly pointFrames: number;
  /** Those the model was sure of and the checks judged. */
  readonly judged: number;
  readonly used: number;
  readonly why: Readonly<Record<Refusal, number>>;
}

export function countOf(checked: readonly CheckedBody[]): Count {
  const why: Record<Refusal, number> = { time: 0, "not-found": 0, "no-3d": 0, hidden: 0, outside: 0, settling: 0, unchecked: 0, bone: 0, jump: 0, swap: 0 };
  let judged = 0;
  let used = 0;
  for (const c of checked) {
    for (const j of MAIN_JOINTS) {
      const r = c.refused[j] ?? null;
      if (r === null) used++;
      else why[r]++;
      if (!BEFORE_CHECKS.has(r)) judged++;
    }
  }
  return { pointFrames: checked.length * MAIN_JOINTS.length, judged, used, why };
}

// ── The bone limit ─────────────────────────────────────────────────────────────────
export const BONE_STEPS: readonly number[] = Array.from({ length: 10 }, (_, i) => Math.round((i + 1) * 5) / 100);
export const BONE_LOSS = 1 / 200;

/** Runs are cached: the leave-one-out folds ask for the same ones again. */
const runs = new Map<string, CheckedBody[]>();
export function checksAt(video: Video, bone: number): CheckedBody[] {
  const key = `${video.label}|${String(bone)}`;
  const known = runs.get(key);
  if (known !== undefined) return known;
  const fresh = runChecks(video.frames, { ...LIMITS, bone });
  runs.set(key, fresh);
  return fresh;
}

/** The share of the judged big joints a bone limit refuses for a broken bone. */
export function boneLoss(checked: readonly CheckedBody[]): number {
  const c = countOf(checked);
  return c.judged === 0 ? 0 : c.why.bone / c.judged;
}

export function chooseBone(videos: readonly Video[]): number {
  const own = videos.filter((v) => v.onePerson);
  const last = BONE_STEPS[BONE_STEPS.length - 1] ?? LIMITS.bone;
  return BONE_STEPS.find((step) => own.every((v) => boneLoss(checksAt(v, step)) <= BONE_LOSS)) ?? last;
}

// ── The steady settings ────────────────────────────────────────────────────────────
export const CUTOFFS: readonly number[] = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5];
export const BETAS: readonly number[] = [0, 0.5, 1, 2, 5, 10, 20, 50];
/** How much further a steady point may lie from a moving joint than its raw point does, on
 *  average, metres. */
export const BEHIND_ALLOWED = 0.01;
/** A joint moving slower than this, metres a second, is not counted as moving: below it the
 *  model's own shake (about 1 cm a frame at 30 a second, 0.3 m/s) is half of what is seen. */
export const MOVING = 0.5;

export interface Steadiness {
  /** The middle shake of a used big joint, metres: how far it lies off the line between the
   *  frames either side of it. As the model gave it, and steady. */
  readonly shakeRaw: number;
  readonly shake: number;
  /** On average, how far a moving joint lies from where the model's own three frames around it
   *  put it, metres: as the model gave it (its shake alone), and steady (shake and trailing). */
  readonly behindRaw: number;
  readonly behind: number;
  /** How many frames of a big joint were moving. */
  readonly moving: number;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;
}

type Vec = readonly number[];
const gap = (a: Vec, b: Vec): number => Math.hypot(...a.map((v, k) => v - (b[k] ?? v)));

export function steadinessOf(checked: readonly CheckedBody[], steady: readonly SteadyBody[], which: "flat" | "world"): Steadiness {
  const raw = (c: CheckedBody, j: number): Vec | null => {
    const p = c.person?.points[j];
    const w = c.person?.world?.[j];
    if (c.refused[j] !== null || p === undefined || w === undefined || c.size === null) return null;
    return which === "flat" ? [(p[0] * c.aspect) / c.size, p[1] / c.size] : w;
  };
  const kept = (s: SteadyBody, j: number): Vec | null => {
    const p = s.points[j];
    if (p === null || p === undefined || s.size === null) return null;
    return which === "flat" ? [(p.x * s.aspect) / s.size, p.y / s.size] : p.world;
  };
  const shakeRaw: number[] = [];
  const shake: number[] = [];
  let behindRaw = 0;
  let behind = 0;
  let moving = 0;
  for (let i = 1; i + 1 < checked.length; i++) {
    const [a, b, c] = [checked[i - 1], checked[i], checked[i + 1]];
    const [sa, sb, sc] = [steady[i - 1], steady[i], steady[i + 1]];
    if (a === undefined || b === undefined || c === undefined || sa === undefined || sb === undefined || sc === undefined) continue;
    const seconds = (c.t - a.t) / 1000;
    const along = (b.t - a.t) / (c.t - a.t);
    const between = (p: Vec, q: Vec): Vec => p.map((v, k) => v + ((q[k] ?? v) - v) * along);
    for (const j of MAIN_JOINTS) {
      const [ra, rb, rc] = [raw(a, j), raw(b, j), raw(c, j)];
      const [ka, kb, kc] = [kept(sa, j), kept(sb, j), kept(sc, j)];
      if (ra === null || rb === null || rc === null || ka === null || kb === null || kc === null) continue;
      shakeRaw.push(gap(rb, between(ra, rc)));
      shake.push(gap(kb, between(ka, kc)));
      if (gap(rc, ra) / seconds < MOVING) continue;
      const middle = rb.map((v, k) => (v + (ra[k] ?? v) + (rc[k] ?? v)) / 3);
      behindRaw += gap(rb, middle);
      behind += gap(kb, middle);
      moving++;
    }
  }
  const mean = (sum: number): number => (moving === 0 ? 0 : sum / moving);
  return { shakeRaw: quantile(shakeRaw, 0.5), shake: quantile(shake, 0.5), behindRaw: mean(behindRaw), behind: mean(behind), moving };
}

export interface SteadyChoice {
  readonly smoothing: Smoothing;
  /** Each one-person video's steadiness at that setting, in the order given. */
  readonly each: readonly { readonly label: string; readonly steadiness: Steadiness }[];
}

const steadyRuns = new Map<string, Steadiness>();
function steadinessAt(video: Video, bone: number, which: "flat" | "world", smoothing: Smoothing): Steadiness {
  const key = `${video.label}|${String(bone)}|${which}|${String(smoothing.minCutoff)}|${String(smoothing.beta)}`;
  const known = steadyRuns.get(key);
  if (known !== undefined) return known;
  const checked = checksAt(video, bone);
  const fresh = steadinessOf(checked, runSteady(checked, { ...STEADY, [which]: smoothing }), which);
  steadyRuns.set(key, fresh);
  return fresh;
}

export function chooseSteady(videos: readonly Video[], which: "flat" | "world", bone: number = LIMITS.bone): SteadyChoice {
  const own = videos.filter((v) => v.onePerson);
  let best: SteadyChoice | null = null;
  let bestShake = Number.POSITIVE_INFINITY;
  for (const minCutoff of CUTOFFS) {
    for (const beta of BETAS) {
      const smoothing = { minCutoff, beta };
      const each = own.map((v) => ({ label: v.label, steadiness: steadinessAt(v, bone, which, smoothing) }));
      if (!each.every((e) => e.steadiness.behind - e.steadiness.behindRaw <= BEHIND_ALLOWED)) continue;
      // Each video counts alike: the shake left, as a share of the shake it had.
      const shake = each.reduce((sum, e) => sum + e.steadiness.shake / e.steadiness.shakeRaw, 0) / Math.max(1, each.length);
      if (shake < bestShake) {
        bestShake = shake;
        best = { smoothing, each };
      }
    }
  }
  // Nothing steadies without trailing: the least smoothing of the grid.
  return best ?? { smoothing: { minCutoff: CUTOFFS[CUTOFFS.length - 1] ?? 5, beta: BETAS[BETAS.length - 1] ?? 50 }, each: [] };
}

// ── Five people set it, the sixth tries it ─────────────────────────────────────────
export interface Fold {
  readonly heldOut: string;
  readonly bone: number;
  readonly heldOutBoneLoss: number;
  readonly flat: Smoothing;
  readonly world: Smoothing;
  readonly heldOutFlat: Steadiness;
  readonly heldOutWorld: Steadiness;
}

export function leaveOneOut(videos: readonly Video[]): Fold[] {
  return videos.map((heldOut) => {
    const rest = videos.filter((v) => v !== heldOut);
    const bone = chooseBone(rest);
    const flat = chooseSteady(rest, "flat", bone).smoothing;
    const world = chooseSteady(rest, "world", bone).smoothing;
    const checked = checksAt(heldOut, bone);
    const steady = runSteady(checked, { ...STEADY, flat, world });
    return {
      heldOut: heldOut.label,
      bone,
      heldOutBoneLoss: boneLoss(checked),
      flat,
      world,
      heldOutFlat: steadinessOf(checked, steady, "flat"),
      heldOutWorld: steadinessOf(checked, steady, "world"),
    };
  });
}

// ── The same video at half the frames a second ─────────────────────────────────────
export function halfRate(frames: readonly MovementFrame[]): MovementFrame[] {
  return frames.filter((_, i) => i % 2 === 0);
}

export interface Agreement {
  /** Big joints compared, at the frames both runs have. */
  readonly compared: number;
  /** Of those, how many were used by one run and refused by the other. */
  readonly differ: number;
  /** In 95 of 100 frames, how far apart the two runs put a steady big joint both used, metres. */
  readonly apart: number;
}

/** `half` must be the run of `halfRate` of the frames `full` ran on. */
export function agreementOf(full: readonly SteadyBody[], half: readonly SteadyBody[]): Agreement {
  let compared = 0;
  let differ = 0;
  const distances: number[] = [];
  half.forEach((h, n) => {
    const f = full[n * 2];
    if (f === undefined) return;
    for (const j of MAIN_JOINTS) {
      compared++;
      const a = f.points[j] ?? null;
      const b = h.points[j] ?? null;
      if ((a === null) !== (b === null)) differ++;
      else if (a !== null && b !== null && f.size !== null) {
        distances.push(Math.hypot((a.x - b.x) * f.aspect, a.y - b.y) / f.size);
      }
    }
  });
  return { compared, differ, apart: quantile(distances, 0.95) };
}

// ── The frames worth a picture ─────────────────────────────────────────────────────
const SHOWN: ReadonlySet<Refusal> = new Set<Refusal>(["bone", "jump", "swap"]);

export interface PictureFrame {
  readonly index: number;
  readonly t: number;
  readonly why: string;
  readonly lines: readonly string[];
  readonly people: readonly { readonly points: SeenPerson["points"]; readonly refused: readonly (Refusal | null)[] }[];
}

/** Each frame where a big joint starts to be refused for a broken bone, a jump or a swap, at
 *  most `most` of them spread over the video; each says which points and why. */
export function framesToDraw(checked: readonly CheckedBody[], most = 12): PictureFrame[] {
  const starts: number[] = [];
  checked.forEach((c, i) => {
    const before = checked[i - 1];
    const starting = MAIN_JOINTS.some((j) => {
      const r = c.refused[j] ?? null;
      return r !== null && SHOWN.has(r) && (before?.refused[j] ?? null) !== r;
    });
    if (starting && c.person !== null) starts.push(i);
  });
  const chosen = starts.length <= most ? starts : Array.from({ length: most }, (_, n) => starts[Math.round((n * (starts.length - 1)) / (most - 1))] ?? 0);
  return [...new Set(chosen)].flatMap((i) => {
    const c = checked[i];
    if (c === undefined || c.person === null) return [];
    const byWhy = new Map<Refusal, string[]>();
    c.refused.forEach((r, j) => {
      if (r !== null && SHOWN.has(r)) byWhy.set(r, [...(byWhy.get(r) ?? []), POINT_NAMES[j] ?? String(j)]);
    });
    const reasons = [...byWhy.entries()].map(([r, names]) => `${r}: ${names.join(", ")}`);
    return [
      {
        index: i,
        t: c.t,
        why: [...byWhy.keys()].join("_"),
        lines: [`${(c.t / 1000).toFixed(2)} s  frame ${String(i + 1)}`, ...reasons],
        people: [{ points: c.person.points, refused: c.refused }],
      },
    ];
  });
}
