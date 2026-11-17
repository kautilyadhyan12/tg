// Auto-pause (ROADMAP Stage 5 item 37a): the clock stops when the person stops and starts again
// when they move, as Strava's and Nike Run Club's do. Pure: each new point, and what it changes.
//
// Judged from where the person is, not from one speed reading: Android reports a speed of 0 when it
// does not know one (expo-location passes Location.getSpeed() on as it is), so a 0 is never taken as
// standing still. Kd's walk of 2026-11-05 paused again and again for that reason.
//
// Stopped: every point of the last STILL_MS lies within STILL_M of the first of them, and the
// phone does not report a speed of GO_MPS or more. The run pauses from that first point, so the
// stop is never counted. The place the person stopped is the middle of those points.
//
// Moving again: GO_POINTS points in a row farther from that place than the phone can wander while
// standing (GO_M, or twice how sure the point is, whichever is more). A phone lying still wanders a few
// metres and its speed reading jumps about, so neither alone starts the clock: the first rule, 5 m twice
// or a speed over 1 m/s, said "Run resumed" and "Auto-paused" again and again to a person standing
// (testers on Google Play, 2026-11-17). The clock starts again from the last point within STILL_M of that
// place, so the steps that took the person away are counted: on a real 51-minute hike with stops this kept
// 42 m more than the first rule (5 m from the stop). A point less sure of where it is than WORST_ACCURACY_M is not
// judged at all: under trees the signal wanders as far as a walk.
import { STILL_M, STILL_MS } from "@app/shared";

// Standing is the shared maths' own test, so the clock and the saved moving time agree.
export { STILL_M, STILL_MS };
export const GO_M = 10;
export const GO_MPS = 1.0;
export const GO_POINTS = 3;
export const WORST_ACCURACY_M = 20;

export interface Fix {
  /** Milliseconds since the run started. */
  at: number;
  lat: number;
  lng: number;
  accuracyM: number | null;
  /** The phone's own speed, metres a second; 0 or null when it does not know one. */
  speed: number | null;
}

export interface AutoPauseState {
  paused: boolean;
  /** The sure points of the last STILL_MS and a little more, oldest first, while running. */
  recent: Fix[];
  /** Where the person stopped (the middle of the still points), while paused. */
  anchor: Fix | null;
  /** While paused: when the last point within STILL_M of where the person stopped came. */
  nearAt: number | null;
  /** While paused: the points in a row that lay far from where the person stopped. */
  goCount: number;
}

export const AUTO_START: AutoPauseState = { paused: false, recent: [], anchor: null, nearAt: null, goCount: 0 };

export type AutoPauseChange = { kind: "pause"; at: number } | { kind: "resume"; at: number } | null;

const RAD = Math.PI / 180;
export function metresApart(a: Fix, b: Fix): number {
  const north = (b.lat - a.lat) * 111_132;
  const east = (b.lng - a.lng) * 111_320 * Math.cos(a.lat * RAD);
  return Math.hypot(north, east);
}

const sure = (fix: Fix): boolean => fix.accuracyM === null || fix.accuracyM <= WORST_ACCURACY_M;
const fast = (fix: Fix): boolean => fix.speed !== null && fix.speed >= GO_MPS;

/** How far from where the person stopped this point must lie to count as moving: past what a phone
 *  this sure of itself wanders while it lies still. */
export const goMetres = (fix: Fix): number => Math.max(GO_M, 2 * (fix.accuracyM ?? 0));

/** The middle of the still points: one point's wander moves it least. */
function middle(points: readonly Fix[], first: Fix): Fix {
  const n = points.length;
  const lat = points.reduce((t, p) => t + p.lat, 0) / n;
  const lng = points.reduce((t, p) => t + p.lng, 0) / n;
  return { at: first.at, lat, lng, accuracyM: first.accuracyM, speed: null };
}

export function nextAutoPause(state: AutoPauseState, fix: Fix): { state: AutoPauseState; change: AutoPauseChange } {
  if (!sure(fix)) return { state, change: null };
  if (!state.paused) {
    if (fast(fix)) return { state: { ...state, recent: [fix] }, change: null };
    // Keep the points of the last STILL_MS, and the one just before them, so the window is full.
    const recent = [...state.recent, fix];
    while (recent.length > 2 && fix.at - (recent[1]?.at ?? fix.at) >= STILL_MS) recent.shift();
    const first = recent[0];
    if (first === undefined || fix.at - first.at < STILL_MS) return { state: { ...state, recent }, change: null };
    const still = recent.every((p) => metresApart(first, p) <= STILL_M);
    if (!still) return { state: { ...state, recent }, change: null };
    return {
      state: { paused: true, recent: [], anchor: middle(recent, first), nearAt: fix.at, goCount: 0 },
      change: { kind: "pause", at: first.at },
    };
  }
  const anchor = state.anchor ?? { ...fix, speed: null };
  const apart = metresApart(anchor, fix);
  const go = goMetres(fix);
  if (apart <= STILL_M) return { state: { ...state, anchor, nearAt: fix.at, goCount: 0 }, change: null };
  if (apart <= go) return { state: { ...state, anchor, goCount: 0 }, change: null };
  const goCount = state.goCount + 1;
  if (goCount >= GO_POINTS) {
    return { state: { paused: false, recent: [fix], anchor: null, nearAt: null, goCount: 0 }, change: { kind: "resume", at: state.nearAt ?? fix.at } };
  }
  return { state: { ...state, anchor, goCount }, change: null };
}
