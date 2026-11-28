// Kd's phone's own gyroscope, as the camera module read it (ROADMAP 53c): each answer's turning since the one before, kept in
// test/phone-motion as the phone gave them while its camera screen was open (no picture, no body point: the phone's turning
// alone). Laid onto a video's frames, the turning between two frames is the phone's turning between those two moments of the
// reading, so a video filmed at another rate than the phone answered gets the very same motion.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Movement, MovementFrame, Spin } from "@app/shared";
import { CameraSet, type PhoneFrame, type RepResult } from "../../src/index.js";
import type { Run } from "../../scripts/movementCheck.js";

const FOLDER = join(dirname(fileURLToPath(import.meta.url)), "..", "phone-motion");

/** Each reading, by what the phone was doing (2026-11-28, Kd's moto g35; each file's `what` says it in full). */
export const TRACES = {
  /** Lying still on a desk, nobody touching it, 2 minutes: once a blip nobody knows the cause of. */
  still: "still",
  /** Picked up off the desk and held in a hand as if filming, about 45 s. */
  hand: "hand",
  /** Turned about in the hand, laid back on the desk, the desk tapped hard beside it 5 times, and left. */
  down: "down",
} as const;

export interface Reading {
  /** ms from the reading's first answer. */
  readonly t: number;
  /** The phone's turning since the answer before, radians; null where it could not say. */
  readonly spin: Spin | null;
}

interface TraceFile {
  readonly phone: string;
  readonly what: string;
  /** [t, x, y, z]: the phone's clock in ms and its turning in radians; [t] where it could not say. */
  readonly answers: readonly (readonly number[])[];
}

/** A reading's answers, from `from` ms of it on (its own time then starting at 0). */
export function readingsOf(name: keyof typeof TRACES, from = 0): Reading[] {
  const file = JSON.parse(readFileSync(join(FOLDER, `${TRACES[name]}.json`), "utf8")) as TraceFile;
  const t0 = file.answers[0]?.[0] ?? 0;
  const all = file.answers.map(([t = 0, x, y, z]) => ({ t: t - t0, spin: x === undefined || y === undefined || z === undefined ? null : ([x, y, z] as Spin) }));
  const start = all.find((r) => r.t >= from)?.t ?? 0;
  return all.filter((r) => r.t >= start).map((r) => ({ ...r, t: r.t - start }));
}

/** In the "hand" reading, the first answer at which the phone had turned past 1.5 degrees in half a second, picked up; in
 *  the "down" reading, the last at which it turned 0.5 degrees in all in half a second, laid on the desk (ms of each, read
 *  off the readings). */
export const PICKED_UP = 900;
export const LAID_DOWN = 14_040;

type Vec = [number, number, number];

/** The phone's turning between each two of `times` (ms; the first gets the reading's own first answer's turning), laid from
 *  the reading's own start and cycled when the times run past its end (each cycle carrying on from where the last ended). */
export function spinsAt(readings: readonly Reading[], times: readonly number[]): Spin[] {
  // How far the phone had turned in all by each answer.
  const total: { t: number; v: Vec }[] = [];
  let v: Vec = [0, 0, 0];
  for (const r of readings) {
    if (r.spin !== null) v = [v[0] + r.spin[0], v[1] + r.spin[1], v[2] + r.spin[2]];
    total.push({ t: r.t, v });
  }
  const span = total[total.length - 1]?.t ?? 0;
  const end = total[total.length - 1]?.v ?? [0, 0, 0];
  const turnedBy = (t: number): Vec => {
    if (!(span > 0)) return [0, 0, 0];
    const cycles = Math.floor(t / span);
    const r = t - cycles * span;
    let k = 0;
    while (k + 1 < total.length && (total[k + 1]?.t ?? 0) <= r) k++;
    const a = total[k];
    const b = total[k + 1];
    const base: Vec = a?.v ?? [0, 0, 0];
    // Between two answers the turning is spread evenly over the time between them.
    const share = a === undefined || b === undefined || b.t === a.t ? 0 : (r - a.t) / (b.t - a.t);
    const at: Vec = b === undefined ? base : [base[0] + (b.v[0] - base[0]) * share, base[1] + (b.v[1] - base[1]) * share, base[2] + (b.v[2] - base[2]) * share];
    return [at[0] + cycles * end[0], at[1] + cycles * end[1], at[2] + cycles * end[2]];
  };
  const t0 = times[0] ?? 0;
  return times.map((t, k): Spin => {
    if (k === 0) return readings[0]?.spin ?? [0, 0, 0];
    const now = turnedBy(t - t0);
    const before = turnedBy((times[k - 1] ?? t0) - t0);
    return [now[0] - before[0], now[1] - before[1], now[2] - before[2]];
  });
}

/** The frames given the phone's own turning between them, from one of its readings. */
export const live = (frames: readonly MovementFrame[], readings: readonly Reading[]): MovementFrame[] => {
  const spins = spinsAt(readings, frames.map((f) => f.t));
  return frames.map((f, k) => ({ ...f, spin: spins[k] ?? null }));
};

/** The set played as the camera runs it, picture by picture (`CameraSet`, as the proof's `cameraRun`): its count and reps,
 *  and each picture's phone and whether a body was read. */
export function played(movement: Movement, frames: readonly MovementFrame[]): { run: Run; seen: { frame: MovementFrame; phone: PhoneFrame; given: boolean }[] } {
  const set = new CameraSet({ movement, exercise: null });
  const reps: RepResult[] = [];
  let count = 0;
  const seen = frames.map((frame) => {
    const out = set.next(frame);
    if (out.match !== null) {
      count = out.match.count;
      if (out.match.rep !== null) reps.push(out.match.rep);
    }
    return { frame, phone: out.phone, given: out.person.person !== null };
  });
  const last = set.finish().match;
  if (last !== null) {
    count = last.count;
    if (last.rep !== null) reps.push(last.rep);
  }
  return { run: { count, reps }, seen };
}
