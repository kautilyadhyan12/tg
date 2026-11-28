// An indoor run's steps on the phone (ROADMAP Stage 5 item 37q-ii-a): the phone's own step counter turned into the steps
// since Start, Auto-pause from the steps, and the steps a minute and pace the run's screen shows. Pure, so every case is
// tested; the run's distance is the shared maths' (`indoorSums`), the same the server saves.
import { INDOOR_MOST_STEPS, stepLengthAt, type StepBasis, type Units } from "@app/shared";
import { pace } from "./runWords";

/** What the run has made of the phone's step counter so far: its last reading, and the steps since Start. */
export interface StepTally {
  /** The counter as last read; null before its first reading in this run. */
  raw: number | null;
  steps: number;
}

/** One reading of the phone's counter taken into the run. The counter counts from when the phone was last switched on,
 *  never from Start: its first reading in a run is where the run's steps begin, so the day's earlier steps are never
 *  the run's (the plan's worst thing: 8,000 steps before Start made into a 6 km run). Kept across the app being closed:
 *  the first reading after it adds the steps taken meanwhile. A counter that started again (the phone switched off and
 *  on during the run) reads lower: every step it has counted since is the run's. `fresh`: the first reading since this
 *  app last started listening, where a lower one can only be that; afterwards a reading a little lower is a slip of the
 *  counter's and adds nothing (one that fell to under half of the last is a counter that started again). The steps since
 *  Start only rise, and never past what anybody takes in a day. */
export function tallyStep(tally: StepTally, raw: number, fresh: boolean): StepTally {
  if (!Number.isFinite(raw) || raw < 0) return tally;
  const now = Math.floor(raw);
  if (tally.raw === null) return { raw: now, steps: tally.steps };
  if (now >= tally.raw) return { raw: now, steps: Math.min(INDOOR_MOST_STEPS, tally.steps + (now - tally.raw)) };
  if (fresh || now < tally.raw / 2) return { raw: now, steps: Math.min(INDOOR_MOST_STEPS, tally.steps + now) };
  return tally;
}

/** A count kept with the run: [ms into the run, steps since Start]. */
export type StepCount = readonly [number, number];

/** Auto-pause pauses an indoor run once no step has been counted for this long. The phone's counter hands each step
 *  over within a second or two (no batching is asked for); ten seconds leaves room for one that is slower, so a run is
 *  never paused while the person steps. The terminal's own, measured on Kd's phone in his walk. */
export const STEP_PAUSE_MS = 10_000;
/** A step at a brisk walk takes about half a second: an Auto-pause ends this long before the count that ended it for
 *  each step that count holds, so the steps that started the person moving again are the run's. */
export const RESUME_STEP_MS = 500;

/** When the steps last rose (ms into the run): the last count higher than the one before it; null with none. */
export function lastRiseAt(counts: readonly StepCount[]): number | null {
  for (let i = counts.length - 1; i >= 0; i--) {
    const c = counts[i];
    if (c === undefined) continue;
    const before = i > 0 ? (counts[i - 1]?.[1] ?? 0) : 0;
    if (c[1] > before) return c[0];
  }
  return null;
}

/** The steps since Start at `at` ms into the run: those of the last count at or before it. */
export function stepsAt(counts: readonly StepCount[], at: number): number {
  let steps = 0;
  for (const [ms, n] of counts) {
    if (ms > at) break;
    steps = n;
  }
  return steps;
}

export type StepPause = { kind: "pause"; at: number } | { kind: "resume"; at: number } | null;

/** What Auto-pause does indoors, looked at once a second. Running, it pauses where the clock stands (`nowMs`) once no
 *  step has been counted for STEP_PAUSE_MS, but only once a step has been counted since Start or since Resume was last
 *  pressed (`armed`): a phone lying on a treadmill counts none, and its run is never stopped for that; one put down on
 *  the treadmill mid-run pauses once, and after Resume waits for steps again. Paused by Auto-pause, the first step
 *  counted starts the clock again, from just before the steps that count holds (never before the pause began). Paused
 *  by the person, only they start it again. */
export function nextStepPause(look: {
  phase: "running" | "paused";
  byPerson: boolean;
  autoPause: boolean;
  armed: boolean;
  counts: readonly StepCount[];
  /** When the open pause began; null when none is open. */
  pauseFrom: number | null;
  nowMs: number;
}): StepPause {
  if (!look.autoPause) return null;
  if (look.phase === "running") {
    if (!look.armed) return null;
    const rise = lastRiseAt(look.counts);
    return rise !== null && look.nowMs - rise >= STEP_PAUSE_MS ? { kind: "pause", at: look.nowMs } : null;
  }
  if (look.byPerson || look.pauseFrom === null) return null;
  const from = look.pauseFrom;
  const before = stepsAt(look.counts, from);
  const next = look.counts.find(([ms, n]) => ms > from && n > before);
  if (next === undefined) return null;
  const back = Math.min((next[1] - before) * RESUME_STEP_MS, STEP_PAUSE_MS);
  return { kind: "resume", at: Math.max(from, next[0] - back) };
}

/** Steps a minute on the screen are counted over this long: ten seconds follows a change of pace as it happens (Kd,
 *  37q-ii-a's walk: the steps lagged); the maths keeps thirty for a step's length. */
export const CADENCE_SPAN_MS = 10_000;
/** Under this much of it, none yet. */
const CADENCE_LEAST_MS = 5_000;

/** The steps a minute now, for the run's screen: over the last CADENCE_SPAN_MS of counts; 0 once no step has been counted
 *  for STEP_PAUSE_MS (standing, or paused); null before there is enough to tell. */
export function stepsAMinute(counts: readonly StepCount[], nowMs: number): number | null {
  const newest = counts[counts.length - 1];
  if (newest === undefined) return null;
  const rise = lastRiseAt(counts);
  if (rise === null || nowMs - rise >= STEP_PAUSE_MS) return 0;
  let from: StepCount = counts[0] ?? newest;
  for (const c of counts) {
    if (c[0] > newest[0] - CADENCE_SPAN_MS) break;
    from = c;
  }
  const span = newest[0] - from[0];
  if (span < CADENCE_LEAST_MS) return null;
  return Math.round(((newest[1] - from[1]) / span) * 60_000);
}

const NO_PACE = "--:--";

/** Current pace indoors: the steps a minute now at the person's own step length for that cadence. None while paused,
 *  standing, or before there is enough to tell. */
export function indoorPace(perMinute: number | null, running: boolean, basis: StepBasis, units: Units): string {
  if (!running || perMinute === null || perMinute <= 0) return NO_PACE;
  return pace(60, perMinute * stepLengthAt(perMinute, basis), units);
}
