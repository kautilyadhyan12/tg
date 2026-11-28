// The numbers the run's screen shows while it goes on: its clock and its current pace. Pure, so the
// rules are tested second by second (the running faults of 2026-11-20, A3 and A5: the clock that went
// back and forth while the person stood, and a pace nobody runs from one point the phone was unsure of).
import { GPS_WORST_ACCURACY_M, RUN_MAX_ELAPSED_MS, RUN_MAX_PAUSES, RUN_MAX_POINTS, geodesicMetres, recordSpeed, runSums, runSumsInSlices, travelMetresAt, type RunClimbRequest, type RunPause, type RunPoint, type RunSums, type SaveRunRequest, type Units } from "@app/shared";
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

/** Where a new still stretch may begin: never inside a pause or a stretch already kept. */
const stillFloor = (run: LiveRun): number =>
  Math.max(run.pauses[run.pauses.length - 1]?.[1] ?? 0, run.still[run.still.length - 1]?.[1] ?? 0, run.datedBack[run.datedBack.length - 1]?.[1] ?? 0);

/** The stretches the maths takes while the run is on screen (37r): `closedStill`, and while running the seconds since
 *  the phone began to feel still, before Auto-pause has decided the stop (`LiveRun.feltStillFrom`), so a phone put
 *  down shows no metres and no line from its first still second. Never sent: the saved run reads `closedStill`. */
export function liveStill(run: LiveRun, nowMs: number): RunPause[] {
  const kept = closedStill(run, nowMs);
  const felt = run.phase === "running" ? (run.feltStillFrom ?? null) : null;
  if (felt === null) return kept;
  const from = Math.max(felt, stillFloor(run));
  return nowMs > from ? [...kept, [from, nowMs]] : kept;
}

/** The run's numbers at `at` ms into it, from its points, pauses and still stretches: the screen, the voice and
 *  the guide read them so, and the server works the saved run out from the same three. */
export const sumsAt = (run: LiveRun, at: number, kg: number): RunSums => runSums(run.points, closedPauses(run, at), at, kg, liveStill(run, at));

/** What the server is sent of a finished run: asked for the climb (37b-ii), and saved with the same points. */
export function sentOf(run: LiveRun): RunClimbRequest {
  const finished = run.finishedMs ?? 0;
  const end = Math.round(finished);
  // The stretches the phone felt still (37k), sent only by a run that has one: a server from before them
  // refuses the field.
  const still = closedStill(run, finished)
    .map(([a, b]): [number, number] => [Math.round(a), Math.min(end, Math.round(b))])
    .filter(([a, b]) => b > a);
  return {
    elapsedMs: end,
    points: run.points.slice(0, RUN_MAX_POINTS).map(([at, lat, lng, acc]) => [Math.round(at), lat, lng, acc]),
    pauses: closedPauses(run, finished).map(([a, b]) => [Math.round(a), Math.round(b)]),
    ...(still.length > 0 ? { still } : {}),
  };
}

/** When Go was pressed by the GPS's clock: the phone's own, less a gap the run found in it (A6). */
export const trueStart = (run: LiveRun): Date => new Date(run.startedAt + (run.clockGapMs ?? 0));

/** A finished run as Save sends it, with the name, feel and note the person gave. */
export function saveRequestOf(run: LiveRun, sent: RunClimbRequest, name: string, effort: number | null, note: string | null): SaveRunRequest {
  return {
    runId: run.runId,
    startedAt: trueStart(run).toISOString(),
    ...sent,
    ...(run.heart.length > 0 ? { heart: run.heart.slice(0, RUN_MAX_POINTS) } : {}),
    name,
    effort,
    note,
  };
}

/** How long one slice of the live numbers' work may hold the phone before it lets the screen draw and be pressed. */
export const SLICE_MS = 12;

/** `sumsAt`, worked out a slice at a time between the screen's own work (37o, A11: a day's run took the phone 1.4 s
 *  in one go, and the clock and every button stood still for it). The run as it is now is copied first: points keep
 *  coming while the work goes on. `done` is told the sums, the same as `sumsAt`'s; the answer is the stop. */
export function sumsInSlices(run: LiveRun, at: number, kg: number, done: (sums: RunSums) => void, now: () => number = Date.now): () => void {
  const points = run.points.slice();
  const still = liveStill(run, at).map(([a, b]): RunPause => [a, b]);
  const work = runSumsInSlices(points, closedPauses(run, at), at, kg, still);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const go = (): void => {
    timer = null;
    if (stopped) return;
    const until = now() + SLICE_MS;
    for (;;) {
      const step = work.next();
      if (step.done === true) {
        done(step.value);
        return;
      }
      if (now() >= until) break;
    }
    timer = setTimeout(go, 0);
  };
  timer = setTimeout(go, 0);
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
  };
}

/** The run's clock at `at` ms into it: the pauses before it left out. */
export const clockAt = (run: LiveRun, at: number): number =>
  Math.max(0, at - run.pauses.reduce((t, [from, to]) => t + Math.max(0, Math.min(to ?? at, at) - from), 0));

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

/** Whether the phone, felt still since `from`, is still where it was then: its newest sure point within
 *  `travelMetresAt` of its first sure point since, as the maths holds a stand. The points come in time order. */
function stillThere(points: readonly RunPoint[], from: number): boolean {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((points[mid]?.[0] ?? Infinity) < from) low = mid + 1;
    else high = mid;
  }
  let first: RunPoint | undefined;
  for (let i = low; i < points.length && first === undefined; i++) {
    const p = points[i];
    if (p !== undefined && sure(p)) first = p;
  }
  let newest: RunPoint | undefined;
  for (let i = points.length - 1; i >= low && newest === undefined; i--) {
    const p = points[i];
    if (p !== undefined && sure(p)) newest = p;
  }
  if (first === undefined || newest === undefined) return true;
  return geodesicMetres(first[1], first[2], newest[1], newest[2]) <= travelMetresAt(Math.max(first[3] ?? 0, newest[3] ?? 0));
}

/** Whether Current pace is shown (37r): running, and the phone not feeling the person stand where they stood. A still
 *  stretch open, or the seconds before Auto-pause decides one, show no pace, as a pause does (on a phone lying still, a
 *  GPS just found read as 2:17 a kilometre), while the phone is still within the distance the maths holds as a stand.
 *  Wheels too fast for Auto-pause to find (over 5 m/s) go past it, and their pace shows. */
export function pacing(run: LiveRun): boolean {
  if (run.phase !== "running") return false;
  const open = run.still[run.still.length - 1];
  const from = open !== undefined && open[1] === null ? open[0] : (run.feltStillFrom ?? null);
  return from === null || !stillThere(run.points, from);
}
