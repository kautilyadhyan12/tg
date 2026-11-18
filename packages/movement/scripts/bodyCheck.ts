// What body-check does with the kept videos (ROADMAP 50c-ii): runs the possible-body check and
// the steady points on each, counts what was refused and why, sets each fitted limit by its
// rule from some people and tries it on another, and picks the frames worth a picture.
//
// The two rules, in words Kd can read:
//   - the bone limit is the smallest, in steps of 0.05 of the trunk, at which no video that
//     sets numbers loses more than 1 in 200 of its sure joints to it;
//   - the steady settings are the steadiest that keep a joint moving faster than half a metre
//     a second, on average, no more than 1 cm further from where the model puts it than the
//     model's own shake already does, on every video that sets numbers.
// "Sets numbers": written so in keptVideos.ts after its pictures were looked at, one body in
// every frame, and no sign that the body followed changed (follow.ts). Every other video is
// tried, never used to set a number.
import { createHash } from "node:crypto";
import type { MovementFrame, SeenPerson } from "@app/shared";
import {
  LIMITS,
  MAIN_JOINTS,
  POINT_NAMES,
  PossibleBody,
  STEADY,
  SteadyPoints,
  bodySize,
  type CheckedBody,
  type Limits,
  type Refusal,
  type Smoothing,
  type SteadyBody,
  type SteadySettings,
} from "../src/index.js";
import { decodeBodyPoints, type BodyPoints } from "./bodyPoints.js";
import { bodyChanges, followOne } from "./follow.js";
import { KEPT_MODEL, KEPT_VIDEOS, type KeptVideo } from "./keptVideos.js";

export interface Video {
  readonly label: string;
  readonly frames: readonly MovementFrame[];
  /** It may set a fitted number: see `videoOf`. */
  readonly sets: boolean;
  /** Why it sets numbers, or why not, in a line. */
  readonly why: string;
}

/** A body-points file as read from the disk, with the check number of its bytes. */
export interface KeptFile {
  readonly header: BodyPoints["header"];
  readonly frames: readonly MovementFrame[];
  readonly sha256: string;
}

export function readKept(bytes: Uint8Array): KeptFile {
  const { header, frames } = decodeBodyPoints(bytes);
  return { header, frames, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** A video sets numbers only when ALL hold: keptVideos.ts says its pictures were looked at, and names this very file
 *  by its check number; it is the phone's own model asked for one person at 30 frames a second; every frame holds one
 *  body whose size can be read; and the plain sign finds no change of the body followed. One body in every frame alone
 *  is never enough: asked for one person, the model gives one body whoever it is. */
export function videoOf(file: KeptFile, kept: Readonly<Record<string, KeptVideo>> = KEPT_VIDEOS): Video {
  const { header, frames } = file;
  const label = header.label;
  const no = (why: string): Video => ({ label, frames, sets: false, why });
  const seen = Object.hasOwn(kept, label) ? kept[label] : undefined;
  if (seen === undefined) return no("nobody has looked at its pictures yet");
  if (!seen.sets) return no(seen.seen);
  if (seen.sha256 !== file.sha256) return no("measured again since its pictures were looked at, or another file under its name");
  if (header.model.file !== KEPT_MODEL.file || header.model.people !== KEPT_MODEL.people || header.fps !== KEPT_MODEL.fps) {
    return no(`not the phone's own model asked for ${String(KEPT_MODEL.people)} person at ${String(KEPT_MODEL.fps)} frames a second`);
  }
  const notOne = frames.findIndex((f) => f.people.length !== 1);
  if (notOne >= 0) return no(`frame ${String(notOne + 1)} holds ${String(frames[notOne]?.people.length ?? 0)} people, not one`);
  const unread = frames.findIndex((f) => {
    const p = f.people[0];
    return p === undefined || bodySize(p, f.aspect, p.points.map((q) => q[3] >= LIMITS.sure)) === null;
  });
  if (unread >= 0) return no(`the body's size cannot be read in frame ${String(unread + 1)}`);
  const changed = bodyChanges(frames);
  const first = changed[0];
  if (first !== undefined) return no(`the body followed changes ${String(changed.length)} times, first at ${(first.t / 1000).toFixed(2)} s`);
  return { label, frames, sets: true, why: seen.seen };
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
/** Each kept by the video's own frames, never its name: two files can share a name (round one). */
const runs = new WeakMap<readonly MovementFrame[], Map<string, CheckedBody[]>>();
function runsOf<T>(store: WeakMap<readonly MovementFrame[], Map<string, T>>, frames: readonly MovementFrame[]): Map<string, T> {
  const known = store.get(frames);
  if (known !== undefined) return known;
  const fresh = new Map<string, T>();
  store.set(frames, fresh);
  return fresh;
}
export function checksAt(video: Video, bone: number): CheckedBody[] {
  const key = String(bone);
  const own = runsOf(runs, video.frames);
  const known = own.get(key);
  if (known !== undefined) return known;
  const fresh = runChecks(video.frames, { ...LIMITS, bone });
  own.set(key, fresh);
  return fresh;
}

/** The share of the judged big joints a bone limit refuses for a broken bone. */
export function boneLoss(checked: readonly CheckedBody[]): number {
  const c = countOf(checked);
  return c.judged === 0 ? 0 : c.why.bone / c.judged;
}

export function chooseBone(videos: readonly Video[]): number {
  const own = videos.filter((v) => v.sets);
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
  /** Each setting video's steadiness at that setting, in the order given. */
  readonly each: readonly { readonly label: string; readonly steadiness: Steadiness }[];
}

const steadyRuns = new WeakMap<readonly MovementFrame[], Map<string, Steadiness>>();
function steadinessAt(video: Video, bone: number, which: "flat" | "world", smoothing: Smoothing): Steadiness {
  const key = `${String(bone)}|${which}|${String(smoothing.minCutoff)}|${String(smoothing.beta)}`;
  const own = runsOf(steadyRuns, video.frames);
  const known = own.get(key);
  if (known !== undefined) return known;
  const checked = checksAt(video, bone);
  const fresh = steadinessOf(checked, runSteady(checked, { ...STEADY, [which]: smoothing }), which);
  own.set(key, fresh);
  return fresh;
}

export function chooseSteady(videos: readonly Video[], which: "flat" | "world", bone: number = LIMITS.bone): SteadyChoice {
  const own = videos.filter((v) => v.sets);
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

// ── All the people but one set it, the one left out tries it ─────────────────────────────────────────
export interface Fold {
  readonly heldOut: string;
  readonly bone: number;
  readonly heldOutBoneLoss: number;
  readonly flat: Smoothing;
  readonly world: Smoothing;
  readonly heldOutFlat: Steadiness;
  readonly heldOutWorld: Steadiness;
}

/** One fold for each video that sets numbers (round one, L2: a held-out video that sets nothing cannot disagree). */
export function leaveOneOut(videos: readonly Video[]): Fold[] {
  return videos.filter((v) => v.sets).map((heldOut) => {
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
