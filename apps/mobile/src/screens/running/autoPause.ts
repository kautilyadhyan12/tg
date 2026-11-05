// Auto-pause (ROADMAP Stage 5 item 37a): the clock stops when the person stops and starts again
// when they move, as Strava's and Nike Run Club's do. Pure: each new point, and what it changes.
//
// Judged from where the person is, not from one speed reading: Android reports a speed of 0 when it
// does not know one (expo-location passes Location.getSpeed() on as it is), so a 0 is never taken as
// standing still. Kd's walk of 2026-11-05 paused again and again for that reason.
//
// Stopped: every point of the last STILL_MS lies within STILL_M of the first of them, and the
// phone does not report a speed of GO_MPS or more. The run pauses from that first point, so the
// stop is never counted. Moving again: GO_POINTS points in a row more than GO_M from where the
// person stopped, or the phone's speed over GO_MPS that many times; the clock starts again from
// the first of them. A point less sure of where it is than WORST_ACCURACY_M is not judged at all:
// under trees the signal wanders as far as a walk.

export const STILL_MS = 8000;
export const STILL_M = 3;
export const GO_M = 5;
export const GO_MPS = 1.0;
export const GO_POINTS = 2;
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
  /** Where the person stopped, while paused. */
  anchor: Fix | null;
  /** The points in a row that showed movement, while paused, and when the first of them came. */
  goSince: number | null;
  goCount: number;
}

export const AUTO_START: AutoPauseState = { paused: false, recent: [], anchor: null, goSince: null, goCount: 0 };

export type AutoPauseChange = { kind: "pause"; at: number } | { kind: "resume"; at: number } | null;

const RAD = Math.PI / 180;
export function metresApart(a: Fix, b: Fix): number {
  const north = (b.lat - a.lat) * 111_132;
  const east = (b.lng - a.lng) * 111_320 * Math.cos(a.lat * RAD);
  return Math.hypot(north, east);
}

const sure = (fix: Fix): boolean => fix.accuracyM === null || fix.accuracyM <= WORST_ACCURACY_M;
const fast = (fix: Fix): boolean => fix.speed !== null && fix.speed >= GO_MPS;

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
    return { state: { paused: true, recent: [], anchor: first, goSince: null, goCount: 0 }, change: { kind: "pause", at: first.at } };
  }
  const anchor = state.anchor ?? fix;
  const moved = fast(fix) || metresApart(anchor, fix) > GO_M;
  if (!moved) return { state: { ...state, anchor, goSince: null, goCount: 0 }, change: null };
  const goSince = state.goSince ?? fix.at;
  const goCount = state.goCount + 1;
  if (goCount >= GO_POINTS) {
    return { state: { paused: false, recent: [fix], anchor: null, goSince: null, goCount: 0 }, change: { kind: "resume", at: goSince } };
  }
  return { state: { ...state, anchor, goSince, goCount }, change: null };
}
