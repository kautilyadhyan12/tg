// Auto-pause (ROADMAP Stage 5 item 37a): the clock stops when the person stops and starts again
// when they move, as Strava's and Nike Run Club's do. Pure: each new point, and what it changes.
//
// A point's speed is the phone's own (Android measures it from the signal's Doppler shift, far
// steadier than the distance between two points); where the phone gives none, the distance from the
// point before over the time between. Below STOP for HOLD, the run pauses from the moment it slowed,
// so the stop is never counted; GO points in a row above GO start it again from the first of them.
// A slow walk (about 1 m a second) never pauses; a person standing at a light always does.

export const STOP_MPS = 0.6;
export const HOLD_MS = 4000;
export const GO_MPS = 1.2;
export const GO_POINTS = 3;
/** A point less sure of where it is than this never starts the clock again by itself: under trees
 *  or between buildings the signal wanders as fast as a walk. */
export const GO_WORST_ACCURACY_M = 20;

export interface Fix {
  /** Milliseconds since the run started. */
  at: number;
  lat: number;
  lng: number;
  accuracyM: number | null;
  /** The phone's own speed, metres a second; null when it gave none. */
  speed: number | null;
}

export interface AutoPauseState {
  paused: boolean;
  /** When the person slowed below STOP, while still running. */
  slowSince: number | null;
  /** When the points above GO began, while paused, and how many in a row. */
  goSince: number | null;
  goCount: number;
  last: Fix | null;
}

export const AUTO_START: AutoPauseState = { paused: false, slowSince: null, goSince: null, goCount: 0, last: null };

export type AutoPauseChange = { kind: "pause"; at: number } | { kind: "resume"; at: number } | null;

const RAD = Math.PI / 180;
function metres(a: Fix, b: Fix): number {
  const north = (b.lat - a.lat) * 111_132;
  const east = (b.lng - a.lng) * 111_320 * Math.cos(a.lat * RAD);
  return Math.hypot(north, east);
}

function speedOf(fix: Fix, last: Fix | null): number | null {
  if (fix.speed !== null && fix.speed >= 0) return fix.speed;
  if (last === null || fix.at <= last.at) return null;
  return metres(last, fix) / ((fix.at - last.at) / 1000);
}

export function nextAutoPause(state: AutoPauseState, fix: Fix): { state: AutoPauseState; change: AutoPauseChange } {
  const speed = speedOf(fix, state.last);
  const base = { ...state, last: fix };
  if (speed === null) return { state: base, change: null };
  if (!state.paused) {
    if (speed >= STOP_MPS) return { state: { ...base, slowSince: null }, change: null };
    const since = state.slowSince ?? fix.at;
    if (fix.at - since >= HOLD_MS) {
      return { state: { ...base, paused: true, slowSince: null, goSince: null, goCount: 0 }, change: { kind: "pause", at: since } };
    }
    return { state: { ...base, slowSince: since }, change: null };
  }
  const sure = fix.accuracyM === null || fix.accuracyM <= GO_WORST_ACCURACY_M;
  if (speed < GO_MPS || !sure) return { state: { ...base, goSince: null, goCount: 0 }, change: null };
  const goSince = state.goSince ?? fix.at;
  const goCount = state.goCount + 1;
  if (goCount >= GO_POINTS) {
    return { state: { ...base, paused: false, goSince: null, goCount: 0, slowSince: null }, change: { kind: "resume", at: goSince } };
  }
  return { state: { ...base, goSince, goCount }, change: null };
}
