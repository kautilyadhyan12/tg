// An indoor run's numbers, from the steps the phone counted (ROADMAP Stage 5 item 37q): a treadmill, or inside the
// house, with no GPS and no route. One copy of the maths, as `runMaths.ts` is for a run outdoors: the phone shows it
// live and the server works the saved numbers out again with it, so the two never differ. Pure: no clock, no
// randomness; the same counts always give the same numbers.
//
// The distance is the steps counted times a step length from the person's height, longer at a running cadence than at
// a walking one. Once they have typed what a treadmill showed, their step length is put right by how far their steps
// were from it, as Garmin calibrates from the distance a treadmill shows after a run (support.garmin.com, FAQ
// bpO2rljrqH2yUG1wSG73s9). A treadmill's distance typed after Finish is the run's own, when somebody could have run that
// far in that time and it is near what the steps said. Such a run never sets a running record and is never on any
// board: what it says is the phone's guess or the person's own word.
import { RUN_MAX_ELAPSED_MS, cleanPauses, kcalOfRun, paceLineOf, placeSpansOf, recordSpeed, splitsOf, type RunMark, type RunPause, type RunSums } from "./runMaths.js";

/** Raised whenever a rule below changes, and kept with each saved indoor run (in `run_calc_version`, beside its kind). */
export const INDOOR_CALC_VERSION = 1;

/** One count of the phone's: milliseconds since the run started, and the steps it has counted since Start. */
export type IndoorCount = readonly [atMs: number, steps: number];

/** Faster than anybody steps: middle-distance athletes on a treadmill at 24 km/h step 3.3 times a second (Leeds Beckett
 *  University, eprint 11031: 2.70 Hz at 12 km/h to 3.32 Hz at 24 km/h). Steps past this are not counted. */
export const MOST_STEPS_PER_S = 5;
/** The most steps a phone may say since Start: MOST_STEPS_PER_S for a whole day. */
export const INDOOR_MOST_STEPS = MOST_STEPS_PER_S * (RUN_MAX_ELAPSED_MS / 1000);
/** The most a treadmill's distance may be typed as, in metres: more than anybody has run in a day. */
export const TREADMILL_MOST_M = 500_000;

// ── A step's length ─────────────────────────────────────────────────────────────────────────────
/** A walking step is about 0.41 to 0.45 of the walker's height (Scientific American, "Stepping Science: Estimating
 *  Someone's Height from Their Walk"); men walking to work, 0.458 on average (Frontiers in Public Health, 2022,
 *  PMC9635924). The middle of the first range. */
export const WALK_STEP_OF_HEIGHT = 0.43;
/** A running step on a treadmill, 46 % to 52 % of the runner's height over 30 minutes (16 runners: "Changes in step
 *  length and width during treadmill running", ISBS Proceedings, ojs.ub.uni-konstanz.de/cpa/article/view/4473). Its
 *  middle. A step's length grows with speed, which a step count alone cannot tell: the treadmill's own distance puts it
 *  right (`stepFactor`). */
export const RUN_STEP_OF_HEIGHT = 0.49;
/** Steps a minute: at WALK_CADENCE_MOST or fewer a walking step, at RUN_CADENCE_LEAST or more a running one, and
 *  between them a share of each, so no step's length jumps where a brisk walk turns into a jog. The terminal's own
 *  (unverified); the distance on Kd's own phone is measured in 37q-ii. */
export const WALK_CADENCE_MOST = 130;
export const RUN_CADENCE_LEAST = 150;
/** For somebody who has not given their height: the terminal's own, and the phone asks for it (37q-ii). */
export const HEIGHT_UNKNOWN_CM = 170;
/** The steps a minute at a moment are counted over this long around it, so a phone that hands its steps over a few at
 *  a time reads as the steady stepping it was. */
const CADENCE_WINDOW_MS = 30_000;

// ── Learning the person's own step from a treadmill ─────────────────────────────────────────────
/** A treadmill run teaches the step length only from this far: Garmin's own least for its older watches (its newer
 *  ones 2.4 km, the same FAQ), where a treadmill's rounding to a hundredth of a kilometre is under 1 %. */
export const LEARN_FROM_M = 1500;
/** A treadmill's distance teaches nothing when it is under half, or over twice, what the steps and height said: the
 *  phone lay on the treadmill and counted next to no steps, or a number was mistyped. */
export const STEP_FACTOR_LEAST = 0.5;
export const STEP_FACTOR_MOST = 2;
/** The middle of the newest this many is taken, so one mistyped treadmill does not move the next run. */
export const LEARN_RUNS = 5;

/** A saved indoor run with a treadmill's distance: the distance typed, and the guess from steps and height alone. */
export interface StepLesson {
  treadmillM: number;
  plainM: number;
}

/** Whether a treadmill run teaches the person's step length. */
export const learnsFrom = (lesson: StepLesson): boolean => {
  if (!(lesson.treadmillM >= LEARN_FROM_M) || !(lesson.plainM > 0)) return false;
  const ratio = lesson.treadmillM / lesson.plainM;
  return ratio >= STEP_FACTOR_LEAST && ratio <= STEP_FACTOR_MOST;
};

/** How far the person's steps are from their height's: the middle of the newest LEARN_RUNS treadmill runs that teach
 *  it (`lessons` newest first), 1 with none; and how many it is from. */
export function stepFactor(lessons: readonly StepLesson[]): { factor: number; from: number } {
  const ratios = lessons
    .filter(learnsFrom)
    .slice(0, LEARN_RUNS)
    .map((l) => l.treadmillM / l.plainM)
    .sort((a, b) => a - b);
  const n = ratios.length;
  if (n === 0) return { factor: 1, from: 0 };
  const mid = n >> 1;
  const factor = n % 2 === 1 ? (ratios[mid] ?? 1) : ((ratios[mid - 1] ?? 1) + (ratios[mid] ?? 1)) / 2;
  return { factor, from: n };
}

/** What an indoor run's steps are measured with: the height in centimetres and the person's own factor. */
export interface StepBasis {
  heightCm: number;
  factor: number;
}

/** The basis for a person: their height (HEIGHT_UNKNOWN_CM where they gave none, or one no person has) and what their
 *  treadmill runs taught. */
export function stepBasisOf(heightCm: number | null, lessons: readonly StepLesson[]): StepBasis & { heightKnown: boolean; learnedFrom: number } {
  const known = heightCm !== null && heightCm >= 50 && heightCm <= 300;
  const { factor, from } = stepFactor(lessons);
  return { heightCm: known ? heightCm : HEIGHT_UNKNOWN_CM, heightKnown: known, factor, learnedFrom: from };
}

/** A step's length in metres at this many steps a minute. */
export function stepLengthAt(stepsPerMinute: number, basis: StepBasis): number {
  const height = basis.heightCm / 100;
  const walk = WALK_STEP_OF_HEIGHT * height;
  const run = RUN_STEP_OF_HEIGHT * height;
  const share = Math.min(1, Math.max(0, (stepsPerMinute - WALK_CADENCE_MOST) / (RUN_CADENCE_LEAST - WALK_CADENCE_MOST)));
  return (walk + share * (run - walk)) * basis.factor;
}

/** From this far, the steps say how far the person went: a treadmill's distance is held to them. Under it the phone
 *  counted next to nothing (it lay on the treadmill), and only the time can judge. The line from which a run counts at
 *  all (the streak's and XP's, `RUN_COUNTS_FROM_M`): a walk of 600 m left going an hour and typed ten times over was
 *  taken from 500 m. The terminal's own. */
export const STEPS_JUDGE_FROM_M = 200;
/** A treadmill's distance is taken from a third to three times what the steps said: wider than what teaches the step
 *  (`STEP_FACTOR_LEAST` to `STEP_FACTOR_MOST`), as athletes at 24 km/h step 2.01 m (Leeds Beckett, eprint 11031), 2.3
 *  times the 0.49 of a 1.80 m height. Ten times the true distance is past it whenever the steps were near the truth,
 *  however long the run was left going. The terminal's own. */
export const TREADMILL_OF_STEPS_LEAST = 1 / 3;
export const TREADMILL_OF_STEPS_MOST = 3;

/** Whether a treadmill's distance typed after Finish is the run's: somebody could have run that far in that moving time
 *  (never faster than the world record for that long, as a stretch outdoors is held to), and, where the steps measured
 *  a real distance (`stepsM`, STEPS_JUDGE_FROM_M or more), it is within a third to three times theirs. A slip of the
 *  finger by ten times is never taken: the steps say so, or, with a phone that counted next to nothing, the record does
 *  for anybody who went faster than a metre a second over the moving time. */
export function treadmillTaken(treadmillM: number | null, movingS: number, stepsM = 0): boolean {
  if (treadmillM === null || !(treadmillM >= 1) || treadmillM > TREADMILL_MOST_M || !(movingS > 0)) return false;
  if (treadmillM / movingS > recordSpeed(movingS)) return false;
  if (!(stepsM >= STEPS_JUDGE_FROM_M)) return true;
  const ratio = treadmillM / stepsM;
  return ratio >= TREADMILL_OF_STEPS_LEAST && ratio <= TREADMILL_OF_STEPS_MOST;
}

// ── The run ───────────────────────────────────────────────────────────────────────────────────

export interface IndoorSums extends RunSums {
  /** The steps counted in the moving time. */
  steps: number;
  /** The distance from the steps, the person's own factor in it. */
  stepsM: number;
  /** The distance from the steps and the height alone: what a treadmill's distance teaches from (`StepLesson`). */
  plainM: number;
  /** Where the distance is from: the steps, or the treadmill's own, typed after Finish. */
  distanceFrom: "steps" | "treadmill";
}

/** A stretch between two counts: the steps counted in its moving part, its moving seconds, and when it ended. */
interface Stretch {
  from: number;
  to: number;
  steps: number;
  s: number;
  m: number;
}

/** Everything an indoor run's summary shows, from the phone's counts and its pauses. `kg` is the person's weight;
 *  `treadmillM` the treadmill's distance typed after Finish, null with none. */
export function indoorSums(
  counts: readonly IndoorCount[],
  pauses: readonly RunPause[],
  elapsedMs: number,
  kg: number,
  basis: StepBasis,
  treadmillM: number | null,
): IndoorSums {
  const elapsed = Math.max(0, Math.min(elapsedMs, RUN_MAX_ELAPSED_MS));
  const paused = cleanPauses(pauses, elapsed);
  const movingMs = elapsed - paused.reduce((sum, [from, to]) => sum + (to - from), 0);
  const movingS = movingMs / 1000;

  // The pauses inside `from`..`to`; asked in order of time, so each pause is passed once.
  let k = 0;
  const pausedWithin = (from: number, to: number): number => {
    while (k < paused.length && (paused[k]?.[1] ?? Infinity) <= from) k++;
    let total = 0;
    for (let i = k; i < paused.length; i++) {
      const p = paused[i];
      if (p === undefined || p[0] >= to) break;
      total += Math.max(0, Math.min(p[1], to) - Math.max(p[0], from));
    }
    return total;
  };

  // The counts in order of time (two at one moment in the order sent). A count after Finish is none of the run's: the
  // walk to the changing room is not run (round one, H2).
  const sorted = counts
    .map(([at, steps], i) => ({ at: Math.max(0, at), steps, i }))
    .filter((count) => count.at <= elapsed)
    .sort((a, b) => a.at - b.at || a.i - b.i);
  const stretches: Stretch[] = [];
  let lastAt = 0;
  let lastSteps = 0;
  for (const count of sorted) {
    // The steps since Start only rise: a count lower than one before it adds nothing, and the higher stays (round one,
    // H1: one count a step lower re-added the whole run). The phone keeps them rising across a restart of its own
    // counter (37q-ii).
    const gained = Math.max(0, count.steps - lastSteps);
    lastSteps = Math.max(lastSteps, count.steps);
    if (count.at > lastAt) {
      const span = count.at - lastAt;
      const moving = span - pausedWithin(lastAt, count.at);
      // Steps taken during a pause are not the run's.
      stretches.push({ from: lastAt, to: count.at, steps: (gained * moving) / span, s: moving / 1000, m: 0 });
      lastAt = count.at;
    } else {
      // Counted at the same moment as the count before: the steps belong to the stretch before it; at Start, to none.
      const prev = stretches[stretches.length - 1];
      if (prev !== undefined) prev.steps += (gained * prev.s * 1000) / (prev.to - prev.from);
    }
  }
  // The moving time after the last count, to Finish, with no step counted in it.
  if (elapsed > lastAt) stretches.push({ from: lastAt, to: elapsed, steps: 0, s: (elapsed - lastAt - pausedWithin(lastAt, elapsed)) / 1000, m: 0 });

  // Never more steps than anybody takes in the moving time.
  let counted = stretches.reduce((sum, st) => sum + st.steps, 0);
  const mostSteps = MOST_STEPS_PER_S * movingS;
  if (counted > mostSteps) {
    const scale = counted > 0 ? mostSteps / counted : 0;
    for (const st of stretches) st.steps *= scale;
    counted = mostSteps;
  }

  // Each stretch's steps a minute, over the window around its middle.
  const mids = stretches.map((st) => (st.from + st.to) / 2);
  const stepsBefore: number[] = [0];
  const secondsBefore: number[] = [0];
  for (const st of stretches) {
    stepsBefore.push((stepsBefore[stepsBefore.length - 1] ?? 0) + st.steps);
    secondsBefore.push((secondsBefore[secondsBefore.length - 1] ?? 0) + st.s);
  }
  let a = 0;
  let b = 0;
  for (let i = 0; i < stretches.length; i++) {
    const st = stretches[i];
    const mid = mids[i] ?? 0;
    if (st === undefined) continue;
    while (a < i && (mids[a] ?? 0) < mid - CADENCE_WINDOW_MS / 2) a++;
    while (b + 1 < stretches.length && (mids[b + 1] ?? 0) <= mid + CADENCE_WINDOW_MS / 2) b++;
    const steps = (stepsBefore[b + 1] ?? 0) - (stepsBefore[a] ?? 0);
    const seconds = (secondsBefore[b + 1] ?? 0) - (secondsBefore[a] ?? 0);
    st.m = st.steps * stepLengthAt(seconds > 0 ? (steps / seconds) * 60 : 0, basis);
  }

  // Never faster than anybody has kept up for that long.
  let stepsM = stretches.reduce((sum, st) => sum + st.m, 0);
  const mostM = movingS > 0 ? recordSpeed(movingS) * movingS : 0;
  if (stepsM > mostM) {
    const scale = stepsM > 0 ? mostM / stepsM : 0;
    for (const st of stretches) st.m *= scale;
    stepsM = mostM;
  }
  const plainM = basis.factor > 0 ? stepsM / basis.factor : 0;

  const taken = treadmillTaken(treadmillM, movingS, stepsM);
  const distanceM = taken && treadmillM !== null ? treadmillM : stepsM;
  // The treadmill's distance laid along the steps, as they went. A phone that counted no step has no line: its
  // kilometres and pace are not made up.
  const line = stepsM > 0;
  const scale = line ? distanceM / stepsM : 0;
  const steps = stretches.map((st) => ({ m: st.m * scale, s: st.s }));
  const splitsKm = line ? splitsOf(steps, 1000) : [];
  const splitsMi = line ? splitsOf(steps, 1609.344) : [];
  const paceLine = line ? paceLineOf(steps) : [];
  const marks: RunMark[] = [{ d: 0, t: 0 }];
  let walked = 0;
  for (const [i, st] of stretches.entries()) {
    walked += steps[i]?.m ?? 0;
    marks.push({ d: walked, t: st.to });
  }
  const kcal = kcalOfRun(splitsKm, movingS, distanceM, line ? movingS : 0, kg);
  return {
    distanceM: Math.round(distanceM),
    elapsedS: Math.round(elapsed / 1000),
    movingS: Math.round(movingS),
    stillS: 0,
    leftOutM: 0,
    leftOutS: 0,
    kcal: Math.round(kcal),
    splitsKm: splitsKm.map((x) => ({ m: Math.round(x.m), s: Math.round(x.s) })),
    splitsMi: splitsMi.map((x) => ({ m: Math.round(x.m), s: Math.round(x.s) })),
    track: [],
    trackStarts: [],
    bests: { k1: null, mile: null, k5: null, k10: null },
    paceLine,
    paceSpans: placeSpansOf(marks, paceLine.length),
    steps: Math.round(counted),
    stepsM: Math.round(stepsM),
    plainM: Math.round(plainM),
    distanceFrom: taken ? "treadmill" : "steps",
  };
}
