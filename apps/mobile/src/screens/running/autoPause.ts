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
// standing (GO_M, or twice how sure the point is, whichever is more, and never more than GO_MOST_M). A
// phone lying still wanders a few metres and its speed reading jumps about, so neither alone starts the
// clock: the first rule, 5 m twice or a speed over 1 m/s, said "Run resumed" and "Auto-paused" again and
// again to a person standing (testers on Google Play, 2026-11-17). Once as far as how sure the point is
// brought that back for a phone sure to 8 to 10 m (round one's re-check, H2: about 40 times as often at
// 8 m); twice, with no limit, held a walker paused for up to 40 m (Kd's click-through, 2026-11-17), while
// the map's dot follows the person all the same (recorder.ts, `here`). The clock starts again from the
// last point within STILL_M of that place, so the steps that took the person away are counted, but never
// from more than BACK_MOST_MS
// before the first far point: a phone drifting off while the person stood would otherwise date it back
// minutes and count them as running (round one, H1). A point less sure of where it is than
// WORST_ACCURACY_M is not judged by its place: under trees the signal wanders as far as a walk.
//
// With the phone's motion (37j): position alone cannot tell standing from a slow walk once the phone is
// unsure of itself, so the motion sensor says whether the person moves and the GPS says where. Points in a
// row that feel still pause the run, on any phone, at any accuracy. While paused, a phone that feels still
// starts the clock only by travelling far beyond its own wander, and a phone that feels moving starts it
// once it is leaving the stop, under a weak signal too. A phone that feels still yet travels (a pram, a
// wheelchair, a bike) is "on wheels" for the rest of the run: its feel is ignored and the rule is the one
// above. With no motion at all (an iPhone, a phone with no sensor) every feel is unknown and the rule is
// the one above, answer for answer.
import { GPS_WORST_ACCURACY_M, STILL_M, STILL_MS } from "@app/shared";

// Standing is the shared maths' own test, so the clock and the saved moving time agree.
export { STILL_M, STILL_MS };
export const GO_M = 10;
export const GO_MOST_M = 20;
export const GO_MPS = 1.0;
export const GO_POINTS = 3;
export const WORST_ACCURACY_M = 20;
export const BACK_MOST_MS = 30_000;

/** How much the phone is shaken in a second (the standard deviation of its acceleration's size, m/s²):
 *  under the first it feels still, over the second it feels moving; between them, not known. Measured on
 *  75 people, each left out in turn (37i, `handoff/2026-11-23-37i.md`). */
export const FEEL_STILL_BELOW = 0.71;
export const FEEL_MOVING_ABOVE = 2.27;
/** A point's feel is the newest motion second at or before it, never one older than this. */
export const FEEL_OLDEST_MS = 3000;
/** Points in a row that feel still, over at least STOP_LEAST_MS, pause the run. */
export const STOP_POINTS = 4;
export const STOP_LEAST_MS = 3000;
/** Points that feel still or moving belong to one run of them only while each comes within this of the one
 *  before: seconds the phone cannot read bridge a gap of a second or two, never a walk (round one, H2). */
export const RUN_GAP_MS = FEEL_OLDEST_MS;
/** Between two points that feel the same, no point at all for up to this (Kd's table: 4 s) keeps the run. */
export const RUN_MISSING_MS = STILL_MS;
/** Paused, a phone that feels still is on wheels once its distance from the stop has grown by `travelMetres`
 *  steadily, judged every RISE_STEP_MS: never back by more than half how sure the point is (RISE_BACK_M at
 *  least), never on by more than RISE_FASTEST_MPS and that much again (a jump of the signal). So neither a jump that stays nor a drift
 *  that stops is a pram (round one, H1), and a pram's own wander does not hide it (the re-check, H5: judged each
 *  second with 2 m, a pram sure to 25 m was never found). */
export const RISE_STEP_MS = 5000;
export const RISE_BACK_M = 2;
export const RISE_FASTEST_MPS = 5;
/** Paused: points in a row that feel moving, no sooner than LEAVE_AFTER_MS after the pause began, start the
 *  clock once the phone is `leaveMetres` farther from the stop than it was LEAVE_WINDOW_MS before, never from a
 *  point older than that (round one, H3); with fewer than two usable places among them, LEAVE_BLIND_POINTS. */
export const LEAVE_POINTS = 3;
export const LEAVE_BLIND_POINTS = 8;
export const LEAVE_AFTER_MS = 10_000;
export const LEAVE_WINDOW_MS = 10_000;

export type Feel = "still" | "moving";

export interface Fix {
  /** Milliseconds since the run started. */
  at: number;
  lat: number;
  lng: number;
  accuracyM: number | null;
  /** The phone's own speed, metres a second; 0 or null when it does not know one. */
  speed: number | null;
  /** How the phone felt at this point (37j); null or missing when not known. */
  feel?: Feel | null;
}

/** While running: the points in a row that felt still. */
interface StillRun {
  /** When the first and the newest came: a pause is dated to the first. */
  firstAt: number;
  lastAt: number;
  count: number;
  /** Their usable places, oldest first: the stop is the middle of them. */
  places: Fix[];
}

/** While paused: the points in a row that felt moving. */
interface LeaveRun {
  firstAt: number;
  lastAt: number;
  count: number;
  /** How many of them had a usable place; those of the last LEAVE_WINDOW_MS, with their distance from the stop. */
  placed: number;
  recent: { at: number; m: number }[];
  /** The newest of them within `leaveMetres` of the stop. */
  nearAt: number;
}

/** While paused: a phone that feels still, moving steadily away from the stop; `lastAt` and `lastM` are the
 *  point it was last judged at. */
interface Rise {
  fromAt: number;
  fromM: number;
  lastAt: number;
  lastM: number;
}

export interface AutoPauseState {
  paused: boolean;
  /** The sure points of the last STILL_MS and a little more, oldest first, while running. */
  recent: Fix[];
  /** Where the person stopped (the middle of the still points), while paused, and how many points it is the
   *  middle of: a phone that feels still near it adds to it, so one moment's wander moves it less. */
  anchor: Fix | null;
  anchorN: number;
  /** While paused: when the last point within STILL_M of where the person stopped came. */
  nearAt: number | null;
  /** While paused: the points in a row that lay far from where the person stopped, and when the first came. */
  goCount: number;
  farAt: number | null;
  /** The phone felt still yet travelled: its feel is ignored until the run ends (never kept in its file). */
  wheels: boolean;
  /** While paused: when the pause began, ms into the run; null when not known. */
  pausedAt: number | null;
  stillRun: StillRun | null;
  leaveRun: LeaveRun | null;
  rise: Rise | null;
  /** While paused and the phone feels still: when it was last near the stop (a quarter of how sure the point
   *  is, STILL_M at least). A pram is dated from then, so standing before it set off is not counted. */
  stillNearAt: number | null;
}

export const AUTO_START: AutoPauseState = {
  paused: false,
  recent: [],
  anchor: null,
  anchorN: 0,
  nearAt: null,
  goCount: 0,
  farAt: null,
  wheels: false,
  pausedAt: null,
  stillRun: null,
  leaveRun: null,
  rise: null,
  stillNearAt: null,
};

/** Paused from `at` (by the person, or read back after the app was closed), the stop's place not yet known;
 *  a phone known to be on wheels stays so (round one, H4). */
export const autoPausedFrom = (at: number | null, wheels = false): AutoPauseState => ({ ...AUTO_START, paused: true, pausedAt: at, wheels });
/** Running again by the person's own Resume, or Auto-pause switched: a phone known to be on wheels stays so. */
export const autoRunning = (wheels: boolean): AutoPauseState => ({ ...AUTO_START, wheels });

/** A resume dated to the pause's own start undoes it: the recorder then keeps no pause at all. */
export type AutoPauseChange = { kind: "pause"; at: number } | { kind: "resume"; at: number } | null;

const RAD = Math.PI / 180;
export function metresApart(a: Fix, b: Fix): number {
  const north = (b.lat - a.lat) * 111_132;
  const east = (b.lng - a.lng) * 111_320 * Math.cos(a.lat * RAD);
  return Math.hypot(north, east);
}

const sure = (fix: Fix): boolean => fix.accuracyM === null || fix.accuracyM <= WORST_ACCURACY_M;
/** A point less sure than the run's maths keeps has no usable place: its feel counts, its place does not. */
const usable = (fix: Fix): boolean => fix.accuracyM === null || fix.accuracyM <= GPS_WORST_ACCURACY_M;
const fast = (fix: Fix): boolean => fix.speed !== null && fix.speed >= GO_MPS;

/** How far from where the person stopped this point must lie to count as moving: past what a phone
 *  this sure of itself wanders while it lies still. */
export const goMetres = (fix: Fix): number => Math.max(GO_M, Math.min(2 * (fix.accuracyM ?? 0), GO_MOST_M));
/** How far a phone that FEELS still must have gone from a place before it is believed to have travelled: four
 *  times how sure the point is, and never under TRAVEL_LEAST_M. The brief's 10 m was passed by Kd's phone lying
 *  on a table (2026-11-25, sure to 3 m): its place slid 11.5 m in 20 s, in a straight line, then stopped. Three
 *  times was passed by one standing phone in 1,000 sure to 30 m, whose place rose steadily 94 m in 130 s (the
 *  re-check). A pram keeps going; a phone's drift does not. */
export const TRAVEL_LEAST_M = 40;
export const TRAVEL_TIMES = 4;
export const travelMetres = (fix: Fix): number => Math.max(TRAVEL_LEAST_M, TRAVEL_TIMES * (fix.accuracyM ?? 0));
/** How much farther from the stop a phone that feels moving must have gone in LEAVE_WINDOW_MS to be leaving it:
 *  half how sure the point is, and never under LEAVE_LEAST_M. Standing and shaken, sure to 5 m, a phone's place
 *  wandered the brief's 3 m from where it was 133 times in 400 within 30 s; over 10 s, 8 m, never in 400 over
 *  2 minutes (6 m: 10 times). A walker at 1.4 m/s leaves 8 m in 6 s. */
export const LEAVE_LEAST_M = 8;
export const leaveMetres = (fix: Fix): number => Math.max(LEAVE_LEAST_M, (fix.accuracyM ?? 0) / 2);

/** How the phone felt at `atMs`: the newest motion second ([ms into the run at its end, sd in hundredths
 *  of a m/s²], oldest first) at or before it, and no more than FEEL_OLDEST_MS older. */
export function feelAt(motion: readonly (readonly [number, number])[], atMs: number): Feel | null {
  let lo = 0;
  let hi = motion.length - 1;
  let found: readonly [number, number] | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const second = motion[mid];
    if (second === undefined) break;
    if (second[0] <= atMs) {
      found = second;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found === undefined || atMs - found[0] > FEEL_OLDEST_MS) return null;
  const sd = found[1] / 100;
  return sd < FEEL_STILL_BELOW ? "still" : sd > FEEL_MOVING_ABOVE ? "moving" : null;
}

/** The middle of the still points: one point's wander moves it least. */
function middle(points: readonly Fix[], first: Fix): Fix {
  const n = points.length;
  const lat = points.reduce((t, p) => t + p.lat, 0) / n;
  const lng = points.reduce((t, p) => t + p.lng, 0) / n;
  return { at: first.at, lat, lng, accuracyM: first.accuracyM, speed: null };
}

interface Step {
  state: AutoPauseState;
  change: AutoPauseChange;
}

/** Paused from `at`, the person having stopped at `anchor`, the middle of `n` points. */
function pausedAtPlace(state: AutoPauseState, at: number, anchor: Fix | null, nearAt: number, n: number): Step {
  return {
    state: { ...AUTO_START, paused: true, anchor, anchorN: anchor === null ? 0 : n, nearAt, stillNearAt: nearAt, wheels: state.wheels, pausedAt: at },
    change: { kind: "pause", at },
  };
}

/** Running again from `at`, never before the pause began. */
function resumedAt(state: AutoPauseState, fix: Fix, at: number, wheels: boolean): Step {
  return { state: { ...AUTO_START, recent: [fix], wheels }, change: { kind: "resume", at: Math.max(at, state.pausedAt ?? at) } };
}

/** A run of points is over at a point the phone cannot read more than RUN_GAP_MS after its newest, or at one
 *  that feels the same after more than RUN_MISSING_MS with no point at all. */
const stale = (run: { lastAt: number } | null, at: number): boolean => run !== null && at - run.lastAt > RUN_GAP_MS;
const lost = (run: { lastAt: number } | null, at: number): boolean => run !== null && at - run.lastAt > RUN_MISSING_MS;

/** Running, step 1: points in a row that feel still pause the run, dated to the first of them. A pram is found
 *  only while paused (goByTravel): in a few seconds no pram is 40 m away (round one, L4). */
function stopByFeel(state: AutoPauseState, fix: Fix, feel: Feel | null): Step {
  if (feel === "moving") return { state: { ...state, stillRun: null }, change: null };
  if (feel === null) return { state: stale(state.stillRun, fix.at) ? { ...state, stillRun: null } : state, change: null };
  const run: StillRun = state.stillRun !== null && !lost(state.stillRun, fix.at) ? state.stillRun : { firstAt: fix.at, lastAt: fix.at, count: 0, places: [] };
  const places = usable(fix) ? [...run.places, fix] : run.places;
  const count = run.count + 1;
  if (count >= STOP_POINTS && fix.at - run.firstAt >= STOP_LEAST_MS) {
    const first = places[0];
    const anchor = first === undefined ? null : { ...middle(places, first), at: run.firstAt };
    // Near the stop from its own start: a phone that travels on and never comes back near it was never
    // stopped, and the clock starts again from the pause's own start (goByTravel).
    return pausedAtPlace(state, run.firstAt, anchor, run.firstAt, places.length);
  }
  return { state: { ...state, stillRun: { firstAt: run.firstAt, lastAt: fix.at, count, places } }, change: null };
}

/** Running, step 2: the position says stopped (every point of STILL_MS within STILL_M of the first). */
function stopByPlace(state: AutoPauseState, fix: Fix): Step {
  if (fast(fix)) return { state: { ...state, recent: [fix] }, change: null };
  // Keep the points of the last STILL_MS, and the one just before them, so the window is full.
  const recent = [...state.recent, fix];
  while (recent.length > 2 && fix.at - (recent[1]?.at ?? fix.at) >= STILL_MS) recent.shift();
  const first = recent[0];
  if (first === undefined || fix.at - first.at < STILL_MS) return { state: { ...state, recent }, change: null };
  const still = recent.every((p) => metresApart(first, p) <= STILL_M);
  if (!still) return { state: { ...state, recent }, change: null };
  return pausedAtPlace(state, first.at, middle(recent, first), fix.at, recent.length);
}

/** Paused, a phone that feels still: only moving steadily away from the stop by `travelMetres` starts the clock
 *  (the wander of a standing phone reaches goMetres; a jump of the signal, or a drift that stops, is no pram).
 *  From the last point near the stop, which is the pause's own start for a phone that went straight on; it is
 *  on wheels from then. */
function goByTravel(state: AutoPauseState, fix: Fix): Step {
  const base: AutoPauseState = { ...state, leaveRun: null };
  if (!usable(fix)) return { state: base, change: null };
  const anchor = state.anchor ?? { ...fix, speed: null };
  const m = metresApart(anchor, fix);
  const nearAt = m <= STILL_M ? fix.at : state.nearAt;
  const stillNearAt = m <= Math.max(STILL_M, (fix.accuracyM ?? 0) / 4) ? fix.at : state.stillNearAt;
  const was = state.rise;
  const step = was === null ? 0 : fix.at - was.lastAt;
  const back = Math.max(RISE_BACK_M, (fix.accuracyM ?? 0) / 2);
  const steady = was !== null && (step < RISE_STEP_MS || (m >= was.lastM - back && m - was.lastM <= (RISE_FASTEST_MPS * step) / 1000 + back));
  const rise: Rise =
    was === null || !steady ? { fromAt: fix.at, fromM: m, lastAt: fix.at, lastM: m } : step < RISE_STEP_MS ? was : { ...was, lastAt: fix.at, lastM: m };
  // Judged only where the rise is judged, so a jump inside a step is seen as one before it counts.
  const judged = was !== null && steady && step >= RISE_STEP_MS;
  // From the last point near the stop. Under a weak signal that is seldom met, so a pram that stood first may be
  // dated back into its standing (as before 37j); dating it from its rise instead lost a pushed pram's metres
  // when its own wander restarted the rise (the second re-check: up to 72 m), which is the worse fault.
  if (judged && m - rise.fromM >= travelMetres(fix)) return resumedAt(state, fix, stillNearAt ?? state.pausedAt ?? fix.at, true);
  // As near the stop as the phone's wander, the point is one more of the person standing there.
  const n = state.anchor === null ? 0 : state.anchorN;
  const near = state.anchor === null || m <= Math.max(STILL_M, (fix.accuracyM ?? 0) / 2);
  const place = near ? { ...anchor, lat: (anchor.lat * n + fix.lat) / (n + 1), lng: (anchor.lng * n + fix.lng) / (n + 1) } : anchor;
  return { state: { ...base, anchor: place, anchorN: near ? n + 1 : n, nearAt, stillNearAt, rise }, change: null };
}

/** Paused, step 2: the position says moving (GO_POINTS in a row beyond `goMetres`), for a sure point. */
function goByPlace(state: AutoPauseState, fix: Fix): Step {
  if (!sure(fix)) return { state, change: null };
  const anchor = state.anchor ?? { ...fix, speed: null };
  const apart = metresApart(anchor, fix);
  const go = goMetres(fix);
  if (apart <= STILL_M) return { state: { ...state, anchor, nearAt: fix.at, goCount: 0, farAt: null }, change: null };
  if (apart <= go) return { state: { ...state, anchor, goCount: 0, farAt: null }, change: null };
  const goCount = state.goCount + 1;
  const farAt = state.goCount === 0 || state.farAt === null ? fix.at : state.farAt;
  if (goCount >= GO_POINTS) return resumedAt(state, fix, Math.max(state.nearAt ?? fix.at, farAt - BACK_MOST_MS), state.wheels);
  return { state: { ...state, anchor, goCount, farAt }, change: null };
}

/** Paused, step 3: points in a row that feel moving, LEAVE_AFTER_MS or more after the pause began, and
 *  `leaveMetres` farther from the stop than LEAVE_WINDOW_MS before (LEAVE_BLIND_POINTS of them with fewer than
 *  two usable places): dated to the first of them, never more than LEAVE_WINDOW_MS before the leaving point. */
function goByFeel(state: AutoPauseState, fix: Fix): Step {
  const run: LeaveRun = state.leaveRun !== null && !lost(state.leaveRun, fix.at) ? state.leaveRun : { firstAt: fix.at, lastAt: fix.at, count: 0, placed: 0, recent: [], nearAt: fix.at };
  let anchor = state.anchor;
  let { placed, recent, nearAt } = run;
  if (usable(fix)) {
    anchor ??= { ...fix, speed: null };
    const m = metresApart(anchor, fix);
    placed += 1;
    recent = [...recent, { at: fix.at, m }].filter((r) => fix.at - r.at <= LEAVE_WINDOW_MS);
    if (m <= leaveMetres(fix)) nearAt = fix.at;
  }
  const count = run.count + 1;
  const late = state.pausedAt === null || fix.at - state.pausedAt >= LEAVE_AFTER_MS;
  const oldest = recent[0];
  const newest = recent[recent.length - 1];
  const fresh = newest !== undefined && newest.at === fix.at;
  const blind = placed < 2;
  // Leaving now: `leaveMetres` farther than LEAVE_WINDOW_MS before. A slow walker under a weak signal never gains
  // that in the window, so a phone that feels moving and is as far from the stop as a pram must be has left,
  // from the last of these points near the stop.
  const now = count >= LEAVE_POINTS && fresh && oldest !== undefined && newest.m - oldest.m >= leaveMetres(fix);
  const far = count >= LEAVE_POINTS && fresh && newest.m >= travelMetres(fix);
  if (late && (blind ? count >= LEAVE_BLIND_POINTS : now || far)) {
    const from = blind || oldest === undefined ? run.firstAt : now ? Math.max(run.firstAt, oldest.at) : nearAt;
    return resumedAt(state, fix, from, state.wheels);
  }
  const leaveRun: LeaveRun = { firstAt: run.firstAt, lastAt: fix.at, count, placed, recent, nearAt };
  return { state: { ...state, anchor, rise: null, leaveRun }, change: null };
}

export function nextAutoPause(state: AutoPauseState, fix: Fix): Step {
  const feel = state.wheels ? null : (fix.feel ?? null);
  // Not known and not sure: nothing to judge, as before the motion.
  if (feel === null && !sure(fix)) return { state, change: null };
  if (!state.paused) {
    const byFeel = stopByFeel(state, fix, feel);
    if (byFeel.change !== null) return byFeel;
    return sure(fix) ? stopByPlace(byFeel.state, fix) : byFeel;
  }
  if (feel === "still") return goByTravel(state, fix);
  const byPlace = goByPlace(state, fix);
  if (byPlace.change !== null) return byPlace;
  if (feel === null) return { state: stale(byPlace.state.leaveRun, fix.at) ? { ...byPlace.state, leaveRun: null } : byPlace.state, change: null };
  return goByFeel(byPlace.state, fix);
}
