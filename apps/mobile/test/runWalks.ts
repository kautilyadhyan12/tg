// Walks and stands for the run's rules (ROADMAP Stage 5 items 37j and 37k): a person's points, one a second,
// and the changes Auto-pause makes from them. The standing phone's wander is the bug hunt's model (2026-11-20,
// A1): a first-order Gauss-Markov error, the usual model of GPS error, `sigma` metres typical error, forgetting
// itself over `tau` seconds, with a little jitter each second.
import type { RunPause, RunPoint } from "@app/shared";
import { AUTO_START, nextAutoPause, type AutoPauseChange, type AutoPauseState, type Feel, type Fix } from "../src/screens/running/autoPause";

export const LAT = 26.1445;
export const LNG = 91.7362;
export const NORTH = 111_132;
export const EAST = 111_320 * Math.cos((LAT * Math.PI) / 180);

/** A seeded generator, so every number below is the same on every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const gauss = (r: () => number): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/** Where a phone lying still says it is, metres east and north of the truth, one a second. */
export function wander(seconds: number, sigma: number, tau: number, seed: number): [number, number][] {
  const r = rng(seed);
  const keep = Math.exp(-1 / tau);
  const push = sigma * Math.sqrt(1 - keep * keep);
  let x = sigma * gauss(r);
  let y = sigma * gauss(r);
  const out: [number, number][] = [];
  for (let i = 0; i < seconds; i++) {
    out.push([x + 0.3 * gauss(r), y + 0.3 * gauss(r)]);
    x = keep * x + push * gauss(r);
    y = keep * y + push * gauss(r);
  }
  return out;
}

/** One stretch of a walk: `seconds` points, one a second, going north at `speed`, the phone sure to
 *  `accuracyM` and feeling `feel`; its place off the truth by `off` (a wander) or by 0.3 m of jitter. */
export interface Stretch {
  seconds: number;
  speed: number;
  accuracyM: number;
  feel: Feel | null;
  off?: [number, number][];
}

/** The points of the stretches, one after another from 1 s into the run, and the true metres walked. */
export function walk(stretches: readonly Stretch[], seed = 1): { fixes: Fix[]; metres: number } {
  const r = rng(seed);
  const fixes: Fix[] = [];
  let north = 0;
  let s = 1;
  for (const part of stretches) {
    for (let i = 0; i < part.seconds; i++, s++) {
      north += part.speed;
      const [dx, dy] = part.off?.[i] ?? [0.3 * gauss(r), 0.3 * gauss(r)];
      fixes.push({ at: s * 1000, lat: LAT + (north + dy) / NORTH, lng: LNG + dx / EAST, accuracyM: part.accuracyM, speed: 0, feel: part.feel });
    }
  }
  return { fixes, metres: north };
}

export function changesOf(fixes: readonly Fix[], start: AutoPauseState = AUTO_START): AutoPauseChange[] {
  let state = start;
  const out: AutoPauseChange[] = [];
  for (const fix of fixes) {
    const next = nextAutoPause(state, fix);
    state = next.state;
    if (next.change !== null) out.push(next.change);
  }
  return out;
}

/** The rule's state after the last point. */
export function stateAfter(fixes: readonly Fix[], start: AutoPauseState = AUTO_START): AutoPauseState {
  let state = start;
  for (const fix of fixes) state = nextAutoPause(state, fix).state;
  return state;
}

/** The pauses the recorder keeps from those changes: a resume dated to its pause's start leaves none. */
export function pausesOf(changes: readonly AutoPauseChange[], end: number): RunPause[] {
  const out: RunPause[] = [];
  let from: number | null = null;
  for (const c of changes) {
    if (c?.kind === "pause") from = c.at;
    else if (c?.kind === "resume" && from !== null) {
      if (c.at > from) out.push([from, c.at]);
      from = null;
    }
  }
  if (from !== null) out.push([from, end]);
  return out;
}

export const pointsOf = (fixes: readonly Fix[]): RunPoint[] => fixes.map((f): RunPoint => [f.at, f.lat, f.lng, f.accuracyM]);
export const endOf = (fixes: readonly Fix[]): number => fixes[fixes.length - 1]?.at ?? 0;
