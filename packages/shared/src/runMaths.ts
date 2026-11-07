// A run's numbers from its GPS points (ROADMAP Stage 5 item 37a). One copy of the maths: the phone
// shows it live and the server works the saved numbers out again with it, so the two never differ.
// Pure: no clock, no randomness; the same points always give the same numbers.

/** Raised whenever a rule below changes, and kept with each saved run. */
export const RUN_CALC_VERSION = 1;

/** A point: milliseconds since the run started, latitude, longitude, and how sure the phone was of
 *  it in metres (Android's horizontal accuracy; null when the phone did not say). */
export type RunPoint = readonly [atMs: number, lat: number, lng: number, accuracyM: number | null];
/** A pause, by the person or by Auto-pause: from and to, in milliseconds since the run started. */
export type RunPause = readonly [fromMs: number, toMs: number];

/** Twelve hours of one point a second; and a day at most. */
export const RUN_MAX_POINTS = 43_200;
export const RUN_MAX_PAUSES = 2_000;
export const RUN_MAX_ELAPSED_MS = 24 * 3_600_000;

/** A point the phone itself was less sure of than this is left out. */
export const GPS_WORST_ACCURACY_M = 30;
/** Used for a point that came without its accuracy. */
const GPS_UNKNOWN_ACCURACY_M = 10;
/** Distance is added only once the smoothed position has moved this far, so the wander of a
 *  standing phone adds nothing. On a straight or gently curving path it loses nothing. */
const MIN_STEP_M = 3;
/** How fast a runner may change speed, in metres a second: how far the smoothing lets a position
 *  move between points before it trusts the new one. */
const SMOOTHING_M_PER_S = 4;
/** Standing: every point of at least STILL_MS within STILL_M of the first of them. Moving time leaves
 *  such a stretch out, as Strava's server does for a run with no pauses; the phone's Auto-pause
 *  pauses on the same test (`apps/mobile/src/screens/running/autoPause.ts`). */
export const STILL_MS = 8000;
export const STILL_M = 3;

// ── The Earth's shape: WGS84, the ellipsoid GPS itself uses ───────────────────────────────────
const WGS84_A = 6_378_137;
const WGS84_F = 1 / 298.257223563;
const WGS84_B = WGS84_A * (1 - WGS84_F);
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const RAD = Math.PI / 180;

/** The distance in metres between two points on the WGS84 ellipsoid (Vincenty's inverse formula,
 *  1975), true to well under a millimetre at a run's distances. */
export function geodesicMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (lat1 === lat2 && lng1 === lng2) return 0;
  const L = (lng2 - lng1) * RAD;
  const U1 = Math.atan((1 - WGS84_F) * Math.tan(lat1 * RAD));
  const U2 = Math.atan((1 - WGS84_F) * Math.tan(lat2 * RAD));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);
  let lambda = L;
  let sinSigma = 0;
  let cosSigma = 0;
  let sigma = 0;
  let cos2Alpha = 0;
  let cos2SigmaM = 0;
  for (let i = 0; i < 200; i++) {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.hypot(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cos2Alpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cos2Alpha;
    const C = (WGS84_F / 16) * cos2Alpha * (4 + WGS84_F * (4 - 3 * cos2Alpha));
    const previous = lambda;
    lambda =
      L +
      (1 - C) *
        WGS84_F *
        sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(lambda - previous) < 1e-12) {
      const u2 = (cos2Alpha * (WGS84_A * WGS84_A - WGS84_B * WGS84_B)) / (WGS84_B * WGS84_B);
      const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
      const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
      const deltaSigma =
        B *
        sinSigma *
        (cos2SigmaM +
          (B / 4) *
            (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
              (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
      return WGS84_B * A * (sigma - deltaSigma);
    }
  }
  // Only two points on nearly opposite sides of the Earth fail to settle: never one run's two points.
  return WGS84_A * sigma;
}

// ── How fast a person can go: the world records (World Athletics, men's outdoor) ───────────────
// Seconds and metres a second: 100 m 9.58 (Bolt 2009), 400 m 43.03 (van Niekerk 2016), 800 m
// 1:40.91 (Rudisha 2012), 1500 m 3:26.00 (El Guerrouj 1998), 5000 m 12:35.36 (Cheptegei 2020),
// 10,000 m 26:11.00 (Cheptegei 2020), marathon 1:59:30 (Sawe 2026).
const RECORDS: readonly (readonly [seconds: number, metresPerSecond: number])[] = [
  [9.58, 100 / 9.58],
  [43.03, 400 / 43.03],
  [100.91, 800 / 100.91],
  [206.0, 1500 / 206.0],
  [755.36, 5000 / 755.36],
  [1571.0, 10_000 / 1571.0],
  [7170, 42_195 / 7170],
];

/** The fastest anybody has ever kept up for this many seconds, in metres a second: between two
 *  records, read along the logarithm of the time; before the first and past the last, theirs. */
export function recordSpeed(seconds: number): number {
  const first = RECORDS[0];
  const last = RECORDS[RECORDS.length - 1];
  if (first === undefined || last === undefined) return 0;
  if (seconds <= first[0]) return first[1];
  if (seconds >= last[0]) return last[1];
  for (let i = 1; i < RECORDS.length; i++) {
    const a = RECORDS[i - 1];
    const b = RECORDS[i];
    if (a === undefined || b === undefined) continue;
    if (seconds <= b[0]) {
      const share = (Math.log(seconds) - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0]));
      return a[1] + share * (b[1] - a[1]);
    }
  }
  return last[1];
}

/** `recordSpeed` read off a table by the whole second (rounded down, so never stricter), made once:
 *  the check below asks it hundreds of thousands of times on a long run. */
let RECORD_TABLE: Float64Array | null = null;
function recordSpeedAt(seconds: number): number {
  const whole = Math.max(0, Math.min(Math.floor(seconds), RUN_MAX_ELAPSED_MS / 1000));
  if (RECORD_TABLE === null) {
    const table = new Float64Array(RUN_MAX_ELAPSED_MS / 1000 + 1);
    for (let i = 0; i < table.length; i++) table[i] = recordSpeed(i);
    RECORD_TABLE = table;
  }
  return RECORD_TABLE[whole] ?? recordSpeed(whole);
}

/** The windows a stretch is tried over, in seconds. */
const STRETCH_WINDOWS_S = [10, 20, 40, 60, 120, 300, 600, 1200, 1800, 3600, 7200];

// ── Calories: the 2024 Adult Compendium of Physical Activities ────────────────────────────────
// Herrmann SD and colleagues, Journal of Sport and Health Science 2024;13(1):6-12; pacompendium.com,
// Walking and Running. Each row's speed in miles an hour (a range at its middle) and its MET:
// walking on a level, firm surface 17151 (under 2.0 mph, read at 1.5), 17152, 17170, 17190, 17200;
// running 12028, 12029, 12030, 12045, 12050, 12060, 12070, 12080, 12090, 12100, 12110, 12115, 12120,
// 12130, 12132, 12134, 12135. Row 12026 ("Jogging 2.6 to 3.7 mph", 3.3) is left out: it is below the
// walking rows at the same speeds. Between rows the MET is read on the straight line between them.
const MET_BY_MPH: readonly (readonly [mph: number, met: number])[] = [
  [1.5, 2.3],
  [2.2, 2.8],
  [2.5, 3.0],
  [3.1, 3.8],
  [3.7, 4.8],
  [4.1, 6.5],
  [4.55, 7.8],
  [5.1, 8.5],
  [5.65, 9.0],
  [6.15, 9.3],
  [6.7, 10.5],
  [7.0, 11.0],
  [7.5, 11.8],
  [8.0, 12.0],
  [8.6, 12.5],
  [9.0, 13.0],
  [9.45, 14.8],
  [10.0, 14.8],
  [11.0, 16.8],
  [12.0, 18.5],
  [13.0, 19.8],
  [14.0, 23.0],
];
const MPS_PER_MPH = 0.44704;

/** The MET of going at this speed (metres a second), on the Compendium's walking and running rows. */
export function metAtSpeed(metresPerSecond: number): number {
  const mph = metresPerSecond / MPS_PER_MPH;
  const first = MET_BY_MPH[0];
  const last = MET_BY_MPH[MET_BY_MPH.length - 1];
  if (first === undefined || last === undefined) return 0;
  if (mph <= first[0]) return first[1];
  if (mph >= last[0]) return last[1];
  for (let i = 1; i < MET_BY_MPH.length; i++) {
    const a = MET_BY_MPH[i - 1];
    const b = MET_BY_MPH[i];
    if (a === undefined || b === undefined) continue;
    if (mph <= b[0]) return a[1] + ((mph - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  }
  return last[1];
}

/** kcal = MET × kg × hours, as the app's workouts already count (`workouts/calories.ts`). */
const kcalFor = (metresPerSecond: number, kg: number, seconds: number): number =>
  (metAtSpeed(metresPerSecond) * kg * seconds) / 3600;

// ── The run ───────────────────────────────────────────────────────────────────────────────────

export interface RunSplit {
  /** Metres in this split: a whole kilometre or mile, or what is left at the end. */
  m: number;
  /** Seconds it took. */
  s: number;
}

export interface RunSums {
  /** Metres counted. */
  distanceM: number;
  /** From Start to Finish, pauses and all. */
  elapsedS: number;
  /** Elapsed time less the pauses, any stretch left out, and any time standing. */
  movingS: number;
  /** Time standing with no pause pressed: within STILL_M for STILL_MS or more. */
  stillS: number;
  /** A stretch faster than anybody has ever run (a car, a bus, a train): not counted. */
  leftOutM: number;
  leftOutS: number;
  kcal: number;
  splitsKm: RunSplit[];
  splitsMi: RunSplit[];
  /** The path counted, for the route's line: latitude, longitude. */
  track: [number, number][];
  /** Where in `track` each stretch begins: after a pause, or a stretch left out, the line starts
   *  again there and is never drawn across the gap. The first is 0. */
  trackStarts: number[];
  /** The run's best efforts (37c-ii): the fastest stretch of each distance, whole seconds. */
  bests: RunBests;
}

/** A run's fastest 1 km, mile, 5 km and 10 km in whole seconds; null where it did not cover it. */
export interface RunBests {
  k1: number | null;
  mile: number | null;
  k5: number | null;
  k10: number | null;
}

/** The distances a record is kept for, in metres (ROADMAP 37c-ii). */
export const RECORD_DISTANCES_M: Readonly<Record<keyof RunBests, number>> = { k1: 1000, mile: 1609.344, k5: 5000, k10: 10_000 };

/** A place along the counted track: metres from the start, and the clock in milliseconds. */
export interface RunMark {
  d: number;
  t: number;
}

/** The fastest stretch of `metres` inside the stretches given, in seconds, as Strava's Best Efforts:
 *  anywhere in the run, timed on the clock like a race (pauses and stops count, so a record is never
 *  made by pausing between sprints), never across a stretch left out as too fast (each list in
 *  `segments` ends there). Between two marks the runner is taken at an even speed, so the fastest
 *  stretch starts or ends on a mark: both are tried. A stretch faster than the world record for its
 *  time is never one. null when no stretch is that long. */
export function fastestStretch(segments: readonly (readonly RunMark[])[], metres: number): number | null {
  let best = Infinity;
  const keep = (ms: number) => {
    const seconds = ms / 1000;
    // The record check only for a stretch that would be the best so far: it is the costly part.
    if (seconds > 0 && seconds < best && metres / seconds <= recordSpeed(seconds)) best = seconds;
  };
  for (const seg of segments) {
    const n = seg.length;
    const first = seg[0];
    const last = seg[n - 1];
    if (first === undefined || last === undefined || last.d - first.d < metres) continue;
    // Ending on each mark: the latest moment the stretch could start.
    let k = 0;
    for (let j = 1; j < n; j++) {
      const end = seg[j];
      if (end === undefined) continue;
      const target = end.d - metres;
      if (target < first.d) continue;
      while (k + 1 < j && (seg[k + 1]?.d ?? Infinity) <= target) k++;
      const a = seg[k];
      const b = seg[k + 1];
      if (a === undefined || b === undefined) continue;
      const startT = b.d > a.d ? a.t + ((b.t - a.t) * (target - a.d)) / (b.d - a.d) : b.t;
      keep(end.t - startT);
    }
    // Starting on each mark: the earliest moment it could end.
    let e = 1;
    for (let i = 0; i < n - 1; i++) {
      const start = seg[i];
      if (start === undefined) continue;
      const target = start.d + metres;
      if (target > last.d) break;
      if (e <= i) e = i + 1;
      while (e < n && (seg[e]?.d ?? Infinity) < target) e++;
      const a = seg[e - 1];
      const b = seg[e];
      if (a === undefined || b === undefined) continue;
      const endT = b.d > a.d ? a.t + ((b.t - a.t) * (target - a.d)) / (b.d - a.d) : a.t;
      keep(endT - start.t);
    }
  }
  return best === Infinity ? null : Math.round(best);
}

interface Fix {
  at: number;
  lat: number;
  lng: number;
  acc: number;
}

/** A quick distance for the speed checks: flat over the ellipsoid's own radii at the first point,
 *  within a few parts in ten thousand of `geodesicMetres` over a few kilometres, which a speed
 *  compared with a world record does not notice. The distance counted is always `geodesicMetres`. */
function quickMetres(a: Fix, b: Fix): number {
  const s = Math.sin(a.lat * RAD);
  const w = Math.sqrt(1 - WGS84_E2 * s * s);
  const north = (b.lat - a.lat) * RAD * ((WGS84_A * (1 - WGS84_E2)) / (w * w * w));
  let dLng = b.lng - a.lng;
  if (dLng > 180) dLng -= 360;
  else if (dLng < -180) dLng += 360;
  const east = dLng * RAD * (WGS84_A / w) * Math.cos(a.lat * RAD);
  return Math.hypot(north, east);
}

const speed = (a: Fix, b: Fix): number => {
  const seconds = (b.at - a.at) / 1000;
  return seconds <= 0 ? Infinity : quickMetres(a, b) / seconds;
};

/** The pauses inside the run, in order, with any overlap joined. */
function cleanPauses(pauses: readonly RunPause[], elapsedMs: number): [number, number][] {
  const inside = pauses
    .map(([from, to]): [number, number] => [Math.max(0, from), Math.min(elapsedMs, to)])
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  const joined: [number, number][] = [];
  for (const p of inside) {
    const prev = joined[joined.length - 1];
    if (prev !== undefined && p[0] <= prev[1]) prev[1] = Math.max(prev[1], p[1]);
    else joined.push([p[0], p[1]]);
  }
  return joined;
}

/** The points of each stretch between pauses, good ones only, in time order. */
function piecesBetweenPauses(points: readonly RunPoint[], pauses: [number, number][], elapsedMs: number): Fix[][] {
  const sorted = points
    .filter(([at, lat, lng, acc]) =>
      Number.isFinite(at) && at >= 0 && at <= elapsedMs &&
      Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180 &&
      (acc === null || (Number.isFinite(acc) && acc >= 0 && acc <= GPS_WORST_ACCURACY_M)))
    .map(([at, lat, lng, acc]): Fix => ({ at, lat, lng, acc: acc === null || acc === 0 ? GPS_UNKNOWN_ACCURACY_M : acc }))
    .sort((a, b) => a.at - b.at);
  const pieces: Fix[][] = [];
  let piece: Fix[] = [];
  let pauseIndex = 0; // the pauses over before this point
  let pieceIndex = 0;
  let lastAt = -1;
  for (const fix of sorted) {
    if (fix.at <= lastAt) continue; // two points at one moment: the first is kept
    while ((pauses[pauseIndex]?.[1] ?? Infinity) <= fix.at) pauseIndex++;
    if (fix.at >= (pauses[pauseIndex]?.[0] ?? Infinity)) continue; // inside a pause
    if (pauseIndex !== pieceIndex) {
      if (piece.length > 0) pieces.push(piece);
      piece = [];
      pieceIndex = pauseIndex;
    }
    piece.push(fix);
    lastAt = fix.at;
  }
  if (piece.length > 0) pieces.push(piece);
  return pieces;
}

/** A point that jumps away and back, faster than anybody runs, is the phone's mistake: left out. */
function withoutSpikes(piece: Fix[]): Fix[] {
  const ceiling = recordSpeed(0);
  const kept: Fix[] = [];
  for (let i = 0; i < piece.length; i++) {
    const fix = piece[i];
    if (fix === undefined) continue;
    const prev = kept[kept.length - 1];
    const next = piece[i + 1];
    if (prev !== undefined && next !== undefined && speed(prev, fix) > ceiling && speed(fix, next) > ceiling && speed(prev, next) <= ceiling) {
      continue;
    }
    kept.push(fix);
  }
  return kept;
}

/** Seconds either side of a step over which its own speed is measured, start to end, so the
 *  signal's wander does not make a jog look like a car. */
const LOCAL_SPEED_HALF_S = 5;

/** Which steps of a piece are left out: those inside a stretch faster than the world record for
 *  its length of time (measured from where it started to where it ended), and themselves going
 *  faster than that record. Step i is from point i to point i + 1. */
function tooFastSteps(piece: Fix[]): boolean[] {
  const n = piece.length;
  const first = piece[0];
  if (first === undefined) return [];
  // Each point once in metres east and north of the first, on the ellipsoid's radii there: over a
  // run's few kilometres between two points of a window, near enough for a speed check.
  const s = Math.sin(first.lat * RAD);
  const w = Math.sqrt(1 - WGS84_E2 * s * s);
  const northPerDeg = ((WGS84_A * (1 - WGS84_E2)) / (w * w * w)) * RAD;
  const eastPerDeg = (WGS84_A / w) * Math.cos(first.lat * RAD) * RAD;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const ts = new Float64Array(n);
  piece.forEach((fix, i) => {
    let dLng = fix.lng - first.lng;
    if (dLng > 180) dLng -= 360;
    else if (dLng < -180) dLng += 360;
    xs[i] = dLng * eastPerDeg;
    ys[i] = (fix.lat - first.lat) * northPerDeg;
    ts[i] = fix.at;
  });
  const apart = (a: number, b: number): number => Math.hypot((xs[b] ?? 0) - (xs[a] ?? 0), (ys[b] ?? 0) - (ys[a] ?? 0));
  // The lowest record speed of any too-fast stretch each step lies in.
  const ceiling = new Float64Array(n).fill(Infinity);
  const cover = new Int32Array(n + 1);
  for (const window of STRETCH_WINDOWS_S) {
    const limit = recordSpeed(window);
    cover.fill(0);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const at = ts[i] ?? 0;
      if (j < i) j = i;
      while (j < n && (ts[j] ?? Infinity) - at < window * 1000) j++;
      if (j >= n) break;
      const seconds = ((ts[j] ?? 0) - at) / 1000;
      if (apart(i, j) > recordSpeedAt(seconds) * seconds) {
        cover[i] = (cover[i] ?? 0) + 1;
        cover[j] = (cover[j] ?? 0) - 1;
      }
    }
    let running = 0;
    for (let k = 0; k < n; k++) {
      running += cover[k] ?? 0;
      if (running > 0 && limit < (ceiling[k] ?? Infinity)) ceiling[k] = limit;
    }
  }
  const flagged = piece.map(() => false);
  let lo = 0;
  let hi = 0;
  for (let k = 0; k + 1 < n; k++) {
    if ((ceiling[k] ?? Infinity) === Infinity) continue;
    const fromAt = ts[k] ?? 0;
    const toAt = ts[k + 1] ?? 0;
    while ((ts[lo] ?? Infinity) < fromAt - LOCAL_SPEED_HALF_S * 1000) lo++;
    if (hi < k + 1) hi = k + 1;
    while (hi + 1 < n && (ts[hi + 1] ?? Infinity) <= toAt + LOCAL_SPEED_HALF_S * 1000) hi++;
    const seconds = ((ts[hi] ?? 0) - (ts[lo] ?? 0)) / 1000;
    if (seconds <= 0) continue;
    flagged[k] = apart(lo, hi) / seconds > (ceiling[k] ?? Infinity);
  }
  return flagged;
}

/** Each fix moved toward where the phone was sure it was, so the wander of the signal is smoothed
 *  out: a Kalman filter forward, taking each point as far as its own accuracy deserves, then the
 *  Rauch–Tung–Striebel pass back, so no point lags behind where the person really was. */
function smoothed(piece: Fix[]): Fix[] {
  const first = piece[0];
  if (first === undefined) return [];
  // Metres east and north of the piece's first point, on the ellipsoid's radii there.
  const s = Math.sin(first.lat * RAD);
  const w = Math.sqrt(1 - WGS84_E2 * s * s);
  const northPerDeg = ((WGS84_A * (1 - WGS84_E2)) / (w * w * w)) * RAD;
  const eastPerDeg = (WGS84_A / w) * Math.cos(first.lat * RAD) * RAD;
  const n = piece.length;
  const xs = new Array<number>(n).fill(0);
  const ys = new Array<number>(n).fill(0);
  const after = new Array<number>(n).fill(0); // the variance once point i is taken in
  const before = new Array<number>(n).fill(0); // the variance just before point i
  after[0] = first.acc * first.acc;
  before[0] = after[0];
  for (let i = 1; i < n; i++) {
    const fix = piece[i];
    const prev = piece[i - 1];
    if (fix === undefined || prev === undefined) continue;
    const prior = (after[i - 1] ?? 0) + ((fix.at - prev.at) / 1000) * SMOOTHING_M_PER_S * SMOOTHING_M_PER_S;
    const gain = prior / (prior + fix.acc * fix.acc);
    const px = xs[i - 1] ?? 0;
    const py = ys[i - 1] ?? 0;
    xs[i] = px + gain * ((fix.lng - first.lng) * eastPerDeg - px);
    ys[i] = py + gain * ((fix.lat - first.lat) * northPerDeg - py);
    before[i] = prior;
    after[i] = prior * (1 - gain);
  }
  for (let i = n - 2; i >= 0; i--) {
    const share = (after[i] ?? 0) / (before[i + 1] ?? 1);
    xs[i] = (xs[i] ?? 0) + share * ((xs[i + 1] ?? 0) - (xs[i] ?? 0));
    ys[i] = (ys[i] ?? 0) + share * ((ys[i + 1] ?? 0) - (ys[i] ?? 0));
  }
  // The ends have nothing beyond them to be weighed against, so smoothing would pull each a few
  // metres in toward the middle and the stretch would come out short: they are kept as the phone
  // gave them.
  return piece.map((fix, i) => i === 0 || i === n - 1 ? fix : ({
    at: fix.at,
    lat: first.lat + (ys[i] ?? 0) / northPerDeg,
    lng: first.lng + (eastPerDeg === 0 ? 0 : (xs[i] ?? 0) / eastPerDeg),
    acc: fix.acc,
  }));
}

interface Step {
  m: number;
  s: number;
}

function splitsOf(steps: readonly Step[], every: number): RunSplit[] {
  const out: RunSplit[] = [];
  let m = 0;
  let s = 0;
  for (const step of steps) {
    let left = step.m;
    let leftS = step.s;
    while (m + left >= every && left > 0) {
      const share = (every - m) / left;
      out.push({ m: every, s: s + leftS * share });
      left -= every - m;
      leftS -= leftS * share;
      m = 0;
      s = 0;
    }
    m += left;
    s += leftS;
  }
  if (m > 0.5) out.push({ m, s });
  return out;
}

/** Where each whole `every` metres falls along a run's track (RunSums' `track` and `trackStarts`), as
 *  [lat, lng] (ROADMAP 37b-i, Kd: "need to be accurate"): over the same steps as the run's distance and
 *  its splits, never across the gap between two stretches, at the exact metre between the two points
 *  either side of it rather than at the next point the phone kept. */
export function unitMarkPoints(track: readonly (readonly [number, number])[], trackStarts: readonly number[], every: number): [number, number][] {
  const out: [number, number][] = [];
  if (!(every > 0)) return out;
  const begins = new Set(trackStarts);
  let walked = 0;
  for (let i = 1; i < track.length; i++) {
    if (begins.has(i)) continue;
    const a = track[i - 1];
    const b = track[i];
    if (a === undefined || b === undefined) continue;
    const m = geodesicMetres(a[0], a[1], b[0], b[1]);
    while (m > 0 && walked + m >= every * (out.length + 1)) {
      // A step is metres long: along it, a straight share of the degrees is the share of the metres.
      const share = (every * (out.length + 1) - walked) / m;
      out.push([a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share]);
    }
    walked += m;
  }
  return out;
}

/** The spans of a piece spent standing: each longest stretch whose points all lie within STILL_M of
 *  its first, when it lasts STILL_MS or more. */
function standingSpans(piece: Fix[]): [number, number][] {
  const spans: [number, number][] = [];
  let i = 0;
  while (i < piece.length) {
    const first = piece[i];
    if (first === undefined) break;
    let j = i;
    while (j + 1 < piece.length) {
      const next = piece[j + 1];
      if (next === undefined || quickMetres(first, next) > STILL_M) break;
      j++;
    }
    const last = piece[j];
    if (last !== undefined && j > i && last.at - first.at >= STILL_MS) {
      spans.push([first.at, last.at]);
      i = j;
    } else {
      i++;
    }
  }
  return spans;
}

/** How much of `from`..`to` lies inside the standing spans (in time order). */
function standingWithin(spans: readonly [number, number][], from: number, to: number): number {
  let total = 0;
  for (const [a, b] of spans) {
    if (a >= to) break;
    total += Math.max(0, Math.min(b, to) - Math.max(a, from));
  }
  return total;
}

/** Everything a run's summary shows, from its points and pauses. `kg` is the person's weight. */
export function runSums(points: readonly RunPoint[], pauses: readonly RunPause[], elapsedMs: number, kg: number): RunSums {
  const elapsed = Math.max(0, Math.min(elapsedMs, RUN_MAX_ELAPSED_MS));
  const cleaned = cleanPauses(pauses, elapsed);
  const pausedMs = cleaned.reduce((sum, [from, to]) => sum + (to - from), 0);
  const steps: Step[] = [];
  const track: [number, number][] = [];
  const trackStarts: number[] = [];
  let leftOutM = 0;
  let leftOutMs = 0;
  let stillMs = 0;
  const still: [number, number][] = [];
  // The marks for the best efforts: a pause does not cut a stretch (the clock runs on), a stretch
  // left out does.
  const segments: RunMark[][] = [];
  let segment: RunMark[] = [];
  let walked = 0;
  for (const raw of piecesBetweenPauses(points, cleaned, elapsed)) {
    const piece = withoutSpikes(raw);
    const spans = standingSpans(piece);
    for (const span of spans) {
      stillMs += span[1] - span[0];
      still.push(span);
    }
    const flagged = tooFastSteps(piece);
    // The piece is cut where a too-fast stretch is left out; each part is smoothed on its own.
    let part: Fix[] = [];
    const parts: Fix[][] = [];
    for (let i = 0; i < piece.length; i++) {
      const fix = piece[i];
      if (fix === undefined) continue;
      part.push(fix);
      const next = piece[i + 1];
      if (flagged[i] === true && next !== undefined) {
        leftOutM += geodesicMetres(fix.lat, fix.lng, next.lat, next.lng);
        leftOutMs += next.at - fix.at;
        parts.push(part);
        part = [];
      }
    }
    parts.push(part);
    for (const [index, p] of parts.entries()) {
      if (index > 0 && segment.length > 0) {
        segments.push(segment);
        segment = [];
      }
      if (p.length < 2) continue; // a lone point between two left-out steps covers no ground
      const path = smoothed(p);
      let last = path[0];
      if (last === undefined) continue;
      trackStarts.push(track.length);
      track.push([last.lat, last.lng]);
      segment.push({ d: walked, t: last.at });
      for (let i = 1; i < path.length; i++) {
        const fix = path[i];
        if (fix === undefined) continue;
        const m = geodesicMetres(last.lat, last.lng, fix.lat, fix.lng);
        if (m < MIN_STEP_M && i < path.length - 1) continue;
        steps.push({ m, s: (fix.at - last.at - standingWithin(still, last.at, fix.at)) / 1000 });
        track.push([fix.lat, fix.lng]);
        walked += m;
        segment.push({ d: walked, t: fix.at });
        last = fix;
      }
    }
  }
  if (segment.length > 0) segments.push(segment);
  const distanceM = steps.reduce((sum, step) => sum + step.m, 0);
  const movingS = Math.max(0, (elapsed - pausedMs - leftOutMs - stillMs) / 1000);
  const splitsKm = splitsOf(steps, 1000);
  // Calories: each kilometre at its own speed, and any moving time no step covers (before the first
  // point, a gap in the signal) at the run's average speed.
  const stepS = steps.reduce((sum, step) => sum + step.s, 0);
  const average = movingS > 0 ? distanceM / movingS : 0;
  const weight = kg > 0 ? kg : 70;
  const kcal =
    splitsKm.reduce((sum, split) => sum + (split.s > 0 ? kcalFor(split.m / split.s, weight, split.s) : 0), 0) +
    (movingS > stepS ? kcalFor(average, weight, movingS - stepS) : 0);
  return {
    distanceM: Math.round(distanceM),
    elapsedS: Math.round(elapsed / 1000),
    movingS: Math.round(movingS),
    stillS: Math.round(stillMs / 1000),
    leftOutM: Math.round(leftOutM),
    leftOutS: Math.round(leftOutMs / 1000),
    kcal: Math.round(kcal),
    splitsKm: splitsKm.map((x) => ({ m: Math.round(x.m), s: Math.round(x.s) })),
    splitsMi: splitsOf(steps, 1609.344).map((x) => ({ m: Math.round(x.m), s: Math.round(x.s) })),
    track,
    trackStarts,
    bests: {
      k1: fastestStretch(segments, RECORD_DISTANCES_M.k1),
      mile: fastestStretch(segments, RECORD_DISTANCES_M.mile),
      k5: fastestStretch(segments, RECORD_DISTANCES_M.k5),
      k10: fastestStretch(segments, RECORD_DISTANCES_M.k10),
    },
  };
}

/** A path as Google's encoded polyline, at five decimal places (about a metre). */
export function encodePolyline(path: readonly (readonly [number, number])[]): string {
  let out = "";
  let prevLat = 0;
  let prevLng = 0;
  const put = (value: number): void => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lat, lng] of path) {
    const la = Math.round(lat * 1e5);
    const ln = Math.round(lng * 1e5);
    put(la - prevLat);
    put(ln - prevLng);
    prevLat = la;
    prevLng = ln;
  }
  return out;
}

/** The other way: an encoded polyline back to its points. */
export function decodePolyline(text: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const take = (): number | null => {
    let shift = 0;
    let result = 0;
    for (;;) {
      if (i >= text.length) return null;
      const b = text.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
      if (b < 0x20) break;
    }
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  for (;;) {
    const dLat = take();
    const dLng = take();
    if (dLat === null || dLng === null) break;
    lat += dLat;
    lng += dLng;
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
