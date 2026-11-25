// The numbers the run's screen shows while it goes on: its clock and its current pace. Pure, so the
// rules are tested second by second (the running faults of 2026-11-20, A3 and A5: the clock that went
// back and forth while the person stood, and a pace nobody runs from one point the phone was unsure of).
import { GPS_WORST_ACCURACY_M, RUN_MAX_ELAPSED_MS, RUN_MAX_PAUSES, geodesicMetres, recordSpeed, runSums, type RunPause, type RunPoint, type RunSums, type Units } from "@app/shared";
import type { LiveRun } from "./recorder";
import { pace } from "./runWords";

/** The run's pauses as the maths takes them: one still open ends now. */
export function closedPauses(run: LiveRun, nowMs: number): RunPause[] {
  return run.pauses.map(([from, to]): RunPause => [from, to ?? Math.max(from, nowMs)]);
}

/** The stretches the phone felt still (37k), as the maths takes them, in time order: those Auto-pause off opened
 *  (one still open ends now) and the seconds each Auto-pause was dated back over. */
export function closedStill(run: LiveRun, nowMs: number): RunPause[] {
  const off = run.still.map(([from, to]): RunPause => [from, to ?? Math.max(from, nowMs)]);
  return [...off, ...run.datedBack].sort((a, b) => a[0] - b[0]);
}

/** The run's numbers at `at` ms into it, from its points, pauses and still stretches: the screen, the voice and
 *  the guide read them so, and the server works the saved run out from the same three. */
export const sumsAt = (run: LiveRun, at: number, kg: number): RunSums => runSums(run.points, closedPauses(run, at), at, kg, closedStill(run, at));

/** The guide's clock at `at` ms into the run (37d-ii): the pauses left out, and the seconds each Auto-pause was
 *  dated back over, so a step begun while the person already stood begins again after the pause. */
export function guideMsAt(run: LiveRun, at: number): number {
  const off = (spans: readonly (readonly [number, number | null])[]): number =>
    spans.reduce((t, [from, to]) => t + Math.max(0, Math.min(to ?? at, at) - from), 0);
  return Math.max(0, at - off(run.pauses) - off(run.datedBack));
}
export const guideMsOf = (run: LiveRun, now: number): number => guideMsAt(run, elapsedMs(run, now));

/** Where a new still stretch may begin: never inside a pause or a stretch already kept. */
const stillFloor = (run: LiveRun): number =>
  Math.max(run.pauses[run.pauses.length - 1]?.[1] ?? 0, run.still[run.still.length - 1]?.[1] ?? 0, run.datedBack[run.datedBack.length - 1]?.[1] ?? 0);
const keptStill = (run: LiveRun): number => run.still.length + run.datedBack.length;

/** A stop the phone felt with Auto-pause off (37k): a still stretch opens from where it began, unless one is open
 *  or the run holds as many as the server takes. */
export function openStill(run: LiveRun, at: number): void {
  const last = run.still[run.still.length - 1];
  if ((last !== undefined && last[1] === null) || keptStill(run) >= RUN_MAX_PAUSES) return;
  run.still.push([Math.max(at, stillFloor(run)), null]);
}

/** The open still stretch ends at `at`. One ended where it began, or before (a phone on wheels, the stop undone),
 *  was no stop: it is not kept. */
export function closeStill(run: LiveRun, at: number): void {
  const open = run.still[run.still.length - 1];
  if (open === undefined || open[1] !== null) return;
  if (at <= open[0]) run.still.pop();
  else open[1] = at;
}

/** An Auto-pause decided at `to` for a stop that began at `from` (37k): the clock stops at `to`, and the seconds
 *  between are kept as standing. */
export function keepDatedBack(run: LiveRun, from: number, to: number): void {
  const start = Math.max(from, stillFloor(run));
  if (to <= start || keptStill(run) >= RUN_MAX_PAUSES) return;
  run.datedBack.push([start, to]);
}

/** An Auto-pause undone back to `at` (a resume dated to or before the pause's start, 37j): the seconds it was
 *  dated back over end there too, or go. */
export function undoDatedBack(run: LiveRun, at: number): void {
  const last = run.datedBack[run.datedBack.length - 1];
  if (last === undefined || last[1] <= at) return;
  if (at <= last[0]) run.datedBack.pop();
  else run.datedBack[run.datedBack.length - 1] = [last[0], at];
}

/** Milliseconds from Go to now, or to Finish. A point's time is the GPS's own, which can be a second
 *  ahead of the phone's clock: the run is never shorter than its last point. */
export const elapsedMs = (run: LiveRun, now: number): number =>
  run.finishedMs ?? Math.min(RUN_MAX_ELAPSED_MS, Math.max(0, now - run.startedAt, run.points[run.points.length - 1]?.[0] ?? 0));

/** The run's clock: ms from Go to `now`, the pauses left out. It is the screen's Time and the guide's
 *  clock, and never goes back: standing with no pause is taken off only on the summary, as Moving time. */
export function movingMsOf(run: LiveRun, now: number): number {
  const elapsed = elapsedMs(run, now);
  return Math.max(0, elapsed - closedPauses(run, elapsed).reduce((t, [a, b]) => t + (b - a), 0));
}

/** Current pace is measured over about this long. */
export const PACE_SPAN_MS = 10_000;
/** Under this much of it, no pace yet. */
export const PACE_LEAST_MS = 5_000;
/** A newest sure point older than this, against the run's last point or against now, is no fresh signal:
 *  no pace. The GPS light says Finding GPS after the same 8 s. */
export const PACE_FRESH_MS = 8_000;

const NO_PACE = "--:--";

/** A point sure enough to count, as the distance takes them. */
const sure = ([, , , acc]: RunPoint): boolean => acc === null || (Number.isFinite(acc) && acc >= 0 && acc <= GPS_WORST_ACCURACY_M);

/** The pace over the last ten seconds, from where the person was then to where they are, from the
 *  points the phone was sure of. No pace while paused, without fresh sure points, or faster than
 *  anybody has ever run. `nowMs`: now, in ms into the run, so a signal lost altogether shows no pace. */
export function currentPace(points: readonly RunPoint[], running: boolean, units: Units, nowMs: number): string {
  if (!running) return NO_PACE;
  const newest = points[points.length - 1];
  if (newest === undefined || nowMs - newest[0] > PACE_FRESH_MS) return NO_PACE;
  let last: RunPoint | null = null;
  let from: RunPoint | null = null;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p === undefined || !sure(p)) continue;
    if (last === null) {
      if (newest[0] - p[0] > PACE_FRESH_MS) return NO_PACE;
      last = p;
    }
    from = p;
    if (last[0] - p[0] >= PACE_SPAN_MS) break;
  }
  if (last === null || from === null) return NO_PACE;
  const seconds = (last[0] - from[0]) / 1000;
  if (seconds < PACE_LEAST_MS / 1000) return NO_PACE;
  const metres = geodesicMetres(from[1], from[2], last[1], last[2]);
  if (metres / seconds > recordSpeed(seconds)) return NO_PACE;
  return pace(seconds, metres, units);
}
