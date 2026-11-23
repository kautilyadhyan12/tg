// The numbers the run's screen shows while it goes on: its clock and its current pace. Pure, so the
// rules are tested second by second (the running faults of 2026-11-20, A3 and A5: the clock that went
// back and forth while the person stood, and a pace nobody runs from one point the phone was unsure of).
import { GPS_WORST_ACCURACY_M, RUN_MAX_ELAPSED_MS, geodesicMetres, recordSpeed, type RunPause, type RunPoint, type Units } from "@app/shared";
import type { LiveRun } from "./recorder";
import { pace } from "./runWords";

/** The run's pauses as the maths takes them: one still open ends now. */
export function closedPauses(run: LiveRun, nowMs: number): RunPause[] {
  return run.pauses.map(([from, to]): RunPause => [from, to ?? Math.max(from, nowMs)]);
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
/** A newest sure point older than this, against the run's last point, is no fresh signal: no pace. */
export const PACE_FRESH_MS = 8_000;

const NO_PACE = "--:--";

/** A point sure enough to count, as the distance takes them. */
const sure = ([, , , acc]: RunPoint): boolean => acc === null || (Number.isFinite(acc) && acc >= 0 && acc <= GPS_WORST_ACCURACY_M);

/** The pace over the last ten seconds, from where the person was then to where they are, from the
 *  points the phone was sure of. No pace while paused, without fresh sure points, or faster than
 *  anybody has ever run. */
export function currentPace(points: readonly RunPoint[], running: boolean, units: Units): string {
  if (!running) return NO_PACE;
  const newest = points[points.length - 1];
  if (newest === undefined) return NO_PACE;
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
