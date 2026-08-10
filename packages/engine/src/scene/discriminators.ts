// Landmark-only "is a body actually there?" discriminators.
// Camera-accuracy card, phase 2 — THE MEASUREMENT, AND NOW ALSO WHAT SHIPS.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
// Kd's five recorded clips settled that no CONFIDENCE cut-off can separate a
// chair from a person: the chair reports 0.99 minimum visibility on its chest
// and hips, identical to a person (DECISIONS :6386). The one lever that DID
// separate them was MOVEMENT — a hallucinated skeleton crawls over whatever it
// is draped on; a real body does not. **That measurement was produced by a
// throwaway script which no longer exists**, which is the failure class
// recorded at :5199 — "I measured it RED" and "the committed harness measures
// it RED" are different claims, and only the second survives the chat that made
// it. This file is that measurement, committed.
//
// ── WHY IT MOVED OUT OF scripts/ (card 4, 2026-08-09) ───────────────────────
// It used to live in `packages/engine/scripts/`, i.e. tooling. Card 4 builds
// the gate, so this arithmetic now RUNS IN THE APP — and the measurement Kd
// rules a cut-off on must be the same code that then enforces it. Two copies
// would mean the number he approves describes the measurement while the number
// that ships describes something else (:4556 F1, one level up). So: one
// implementation, imported by `scripts/measure-pose.ts` and by the web bridge.
//
// ── WHAT LIVES HERE AND WHAT DOES NOT ───────────────────────────────────────
// This file computes SIGNALS and reports DISTRIBUTIONS. It chooses no cut-off:
// every operating point is returned WITH the error it costs on both sides, and
// the number itself is Kd's ruling on printed evidence (the OWED rule forbids
// picking one from judgement, and is untouched by this file existing).
// The DECISION — which signal, which number, what the screen then says — lives
// in the web bridge, per the 2026-08-07 ruling that a scene check does not
// belong in the engine: the engine is handed 33 numbers and cannot know they
// came from a chair, and R5.6 forbids scene special-cases in engine code.
// **NOTHING UNDER src/pipeline, src/definition, src/harness OR session.ts MAY
// IMPORT THIS FILE**, and `test/personGate.test.ts` fails if one ever does.
// It is reachable from outside only through the `@app/engine/scene` entry
// point, never from the package index — deliberately, so wiring it into the
// pipeline takes a visible decision rather than an autocomplete.
//
// ── WHY THESE ARE MEASURABLE ON CLIPS ALREADY RECORDED ──────────────────────
// They read landmark OUTPUT, which is exactly what a §7.1 trace contains.
// :6386's "none of 1–4 can be evaluated against the five recorded clips" is
// true of CAMERA-STAGE changes — different MediaPipe settings produce different
// landmarks, so those need fresh video. It is NOT true of a bridge-layer gate,
// which consumes precisely the numbers already on disk. A later chat must not
// read that prohibition so broadly that it shelves the one lever testable today.
//
// ── THREE DELIBERATE DIFFERENCES FROM :6386's NUMBERS ───────────────────────
// The figures this file prints will NOT equal the ones in that entry, and the
// difference is not drift:
//   1. Rates are PER SECOND, not per frame. Browser frames arrive irregularly
//      (Kd's clips ran 7.2–12.5 fps against a 15 fps target), and the gate this
//      feeds sees the same irregularity, so per-frame is the wrong unit for the
//      thing being built.
//   2. Frame pairs separated by more than MAX_GAP_MS are SKIPPED. Stitching
//      across a lost pose measures the gap, not the subject — and `empty_room`
//      is mostly gaps, so its high jitter figure may have been that artefact.
//   3. "Body centre" and "torso length" are DEFINED below. The deleted script's
//      definitions are unrecoverable, so nothing here claims to reproduce it.
//
// PURE: no I/O, no clock, no randomness (I1). It sits in src/ now, so the
// engine's own purity grep covers it — which is a gain, not a cost.
import { KP } from "@app/shared";
import type { PoseFrame } from "@app/shared";

/** Torso lengths at or below this are degenerate (every landmark collapsed to
 *  one point) and cannot normalise anything. Quoted, not chosen: it is the
 *  engine's own torso-normaliser guard (`pipeline/signals.ts:167`). */
const MIN_TORSO = 1e-8;

/** A pair of frames further apart than this did not "move" — the model lost the
 *  pose in between. At the 7–12 fps these clips recorded, 500 ms is ~4–6 missing
 *  frames. An analysis parameter, printed with every run and overridable. */
export const MAX_GAP_MS = 500;

const KEYPOINTS = 33;
/** Below this many tracked landmarks a p90−p50 spread is noise, not a shape. */
const MIN_POINTS_FOR_SPREAD = 8;

type Point = readonly [number, number];

/** [x, y] of one landmark, or null when it is missing or non-finite.
 *
 *  DELIBERATELY NOT GATED ON VISIBILITY. The chair reports 0.99 there, so
 *  filtering by it would import the dead lever; and a landmark the model is
 *  guessing wildly is precisely what makes a fake skeleton move. The guessing
 *  IS the signal. */
function point(frame: PoseFrame, i: number): Point | null {
  const row = frame.kp[i];
  if (row === undefined) return null;
  const x = row[0];
  const y = row[1];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

function midpoint(a: Point | null, b: Point | null): Point | null {
  if (a === null || b === null) return null;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function dist(a: Point, b: Point): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/** |shoulder midpoint − hip midpoint|: the scale normaliser for everything
 *  below, so someone standing closer to the camera is not scored as jitterier
 *  than someone standing further away. */
export function torsoLength(frame: PoseFrame): number | null {
  const sh = midpoint(point(frame, KP.left_shoulder), point(frame, KP.right_shoulder));
  const hip = midpoint(point(frame, KP.left_hip), point(frame, KP.right_hip));
  if (sh === null || hip === null) return null;
  const d = dist(sh, hip);
  return d > MIN_TORSO ? d : null;
}

/** Mean of the four torso landmarks (11/12/23/24) — the same four :6386 used
 *  for its visibility measurement, so the two readings describe one region. */
export function bodyCentre(frame: PoseFrame): Point | null {
  const pts = [KP.left_shoulder, KP.right_shoulder, KP.left_hip, KP.right_hip].map((i) =>
    point(frame, i),
  );
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    if (p === null) return null;
    sx += p[0];
    sy += p[1];
  }
  return [sx / pts.length, sy / pts.length];
}

/** Bones whose PROJECTED length a real body holds roughly steady frame to
 *  frame. A skeleton draped on chair edges redraws them between arbitrary
 *  points, so its lengths flicker. Limbs only — no face, no hands (small,
 *  noisy, and absent from side views). */
const BONES: ReadonlyArray<readonly [number, number]> = [
  [KP.left_hip, KP.left_knee],
  [KP.right_hip, KP.right_knee],
  [KP.left_knee, KP.left_ankle],
  [KP.right_knee, KP.right_ankle],
  [KP.left_shoulder, KP.left_elbow],
  [KP.right_shoulder, KP.right_elbow],
  [KP.left_elbow, KP.left_wrist],
  [KP.right_elbow, KP.right_wrist],
  [KP.left_shoulder, KP.left_hip],
  [KP.right_shoulder, KP.right_hip],
];

/** Left/right pairs of the same bone. A real body's two femurs are the same
 *  length; a hallucinated one's are whatever the edges happened to be. */
const BONE_PAIRS: ReadonlyArray<readonly [readonly [number, number], readonly [number, number]]> = [
  [
    [KP.left_hip, KP.left_knee],
    [KP.right_hip, KP.right_knee],
  ],
  [
    [KP.left_knee, KP.left_ankle],
    [KP.right_knee, KP.right_ankle],
  ],
  [
    [KP.left_shoulder, KP.left_elbow],
    [KP.right_shoulder, KP.right_elbow],
  ],
  [
    [KP.left_shoulder, KP.left_hip],
    [KP.right_shoulder, KP.right_hip],
  ],
];

function boneLength(frame: PoseFrame, bone: readonly [number, number]): number | null {
  const a = point(frame, bone[0]);
  const b = point(frame, bone[1]);
  if (a === null || b === null) return null;
  return dist(a, b);
}

/** The four signals, in the order they are reported. HIGHER always means MORE
 *  LIKELY TO BE FURNITURE — a single direction, so one comparison reads them
 *  all and no caller has to remember which way round a given signal runs. */
export const SIGNAL_NAMES = [
  "centre_drift",
  "bone_stretch",
  "limb_asymmetry",
  "motion_incoherence",
] as const;
export type SignalName = (typeof SIGNAL_NAMES)[number];

/** One frame's reading of every signal. `null` = not computable on this frame
 *  (a missing landmark, a degenerate torso, or too long a gap since the
 *  previous frame) — never a substituted zero, which would read as "perfectly
 *  still" and is the exact shape of lie this card exists to remove. */
export type FrameReading = Readonly<Record<SignalName, number | null>>;

const NOTHING: FrameReading = {
  centre_drift: null,
  bone_stretch: null,
  limb_asymmetry: null,
  motion_incoherence: null,
};

/**
 * Every signal for one frame, measured against the frame before it.
 *
 * - `centre_drift`      how fast the body's centre slides (torso-lengths/sec).
 *                       This is :6386's jitter lever, re-expressed as a rate.
 * - `bone_stretch`      how fast the limbs change length (torso-lengths/sec).
 *                       A real bone's projection changes slowly; a drawn one
 *                       jumps.
 * - `limb_asymmetry`    how unequal left and right bones are (dimensionless).
 *                       Needs no previous frame, but is reported here so all
 *                       four read from one place.
 * - `motion_incoherence` how much the landmarks DISAGREE about where the body
 *                       went: the spread (p90 − median) of the 33 individual
 *                       displacements. A real body moves as one piece; a fake
 *                       one's points wander independently. This is the signal
 *                       :6386 did not have — centre drift can be fooled by a
 *                       body genuinely moving, spread cannot.
 */
/**
 * `nominalDtMs` — read this before changing it.
 *
 * Every rate below is `per-frame quantity × 1000/dt`, so a reading depends on
 * how fast the machine happens to be feeding frames. That is correct for the
 * two signals that measure DISPLACEMENT (`centre_drift`, `motion_incoherence`):
 * a body really does travel further in 100 ms than in 67 ms.
 *
 * It is WRONG for `bone_stretch`, and that is the signal the shipped gate runs
 * on. A bone does not change length when its owner moves, so the numerator is
 * almost entirely per-frame estimator noise — which does not grow with dt. The
 * per-second conversion therefore injects the machine's speed into a quantity
 * that has nothing to do with it: the same clip re-stamped from the recording
 * machine's ~82 ms cadence to the app's 67 ms feed floor reads ~1.22× higher
 * and silences roughly twice as many frames, costing a real rep on two of Kd's
 * six clips (measured; DECISIONS entry for this round).
 *
 * Passing a nominal interval makes the reading a function of the FRAMES ALONE
 * and not of their timestamps, so a fast laptop and a slow one behave alike.
 * The value belongs to whoever owns the cut-off — the web bridge — because a
 * cut-off and the cadence it was measured at are one ruling, not two. This file
 * still chooses nothing: `null` keeps the honest per-second rate.
 *
 * The gap test above continues to use the REAL interval. Skipping a pair
 * because the model lost the pose is a fact about the recording, not a unit.
 */
export function readFrame(
  frame: PoseFrame,
  previous: PoseFrame | null,
  maxGapMs: number = MAX_GAP_MS,
  nominalDtMs: number | null = null,
): FrameReading {
  const torso = torsoLength(frame);
  if (torso === null) return NOTHING;

  // Asymmetry needs no history, so it is computed before the gap test — a
  // clip of isolated frames still yields this one signal rather than nothing.
  let asymSum = 0;
  let asymCount = 0;
  for (const [left, right] of BONE_PAIRS) {
    const l = boneLength(frame, left);
    const r = boneLength(frame, right);
    if (l === null || r === null) continue;
    const mean = (l + r) / 2;
    if (mean <= MIN_TORSO) continue;
    asymSum += Math.abs(l - r) / mean;
    asymCount++;
  }
  const limbAsymmetry = asymCount > 0 ? asymSum / asymCount : null;

  if (previous === null) return { ...NOTHING, limb_asymmetry: limbAsymmetry };
  const dtMs = frame.t - previous.t;
  if (!(dtMs > 0) || dtMs > maxGapMs) return { ...NOTHING, limb_asymmetry: limbAsymmetry };
  const perSecond = 1000 / (nominalDtMs !== null && nominalDtMs > 0 ? nominalDtMs : dtMs);

  const here = bodyCentre(frame);
  const there = bodyCentre(previous);
  const centreDrift =
    here !== null && there !== null ? (dist(here, there) / torso) * perSecond : null;

  let stretchSum = 0;
  let stretchCount = 0;
  for (const bone of BONES) {
    const now = boneLength(frame, bone);
    const before = boneLength(previous, bone);
    if (now === null || before === null) continue;
    stretchSum += Math.abs(now - before) / torso;
    stretchCount++;
  }
  const boneStretch = stretchCount > 0 ? (stretchSum / stretchCount) * perSecond : null;

  const displacements: number[] = [];
  for (let i = 0; i < KEYPOINTS; i++) {
    const now = point(frame, i);
    const before = point(previous, i);
    if (now === null || before === null) continue;
    displacements.push(dist(now, before) / torso);
  }
  let motionIncoherence: number | null = null;
  if (displacements.length >= MIN_POINTS_FOR_SPREAD) {
    displacements.sort((a, b) => a - b);
    const spread = quantile(displacements, 0.9) - quantile(displacements, 0.5);
    motionIncoherence = spread * perSecond;
  }

  return {
    centre_drift: centreDrift,
    bone_stretch: boneStretch,
    limb_asymmetry: limbAsymmetry,
    motion_incoherence: motionIncoherence,
  };
}

/** Percentile of an ALREADY-SORTED ascending array. Same implementation the
 *  measurement script has always used, so section 2's printed numbers are
 *  unchanged by this file's arrival. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[i] ?? Number.NaN;
}

/**
 * The rolling median a gate actually reads, as ONE stateful object shared by
 * the live gate and the offline measurement.
 *
 * Why a median and not a mean: one landmark glitch must not be able to switch a
 * real user off mid-rep. Why a window at all: the per-frame value is far too
 * noisy to gate on, and the app's question is "is a person here", which is
 * about the last second, not the last 80 ms.
 *
 * `push` returns null until the window holds at least `ceil(size / 2)` real
 * readings, so a gate is never handed a confident number built from two frames.
 *
 * WHY IT IS A CLASS AND NOT A LOOP. `windowed()` below is a fold over this
 * object rather than a second copy of the rule. A live gate and an offline
 * measurement that implement "the last second" separately will agree on the
 * day they are written and drift afterwards — and the drift would be invisible,
 * because each is self-consistent (:4556 F1: a rule with two declarations is
 * where a correction gets lost). `test/personGate.test.ts` pins the equality on
 * real frame sequences, not just on the shape of this file.
 */
export class RollingWindow {
  private readonly size: number;
  private readonly need: number;
  private readonly recent: (number | null)[] = [];

  constructor(size: number) {
    this.size = Math.max(1, Math.floor(size));
    this.need = Math.ceil(this.size / 2);
  }

  /** Feed one raw reading (null = not computable on this frame); get what a
   *  gate would read NOW, or null while there is not enough to be sure. */
  push(value: number | null): number | null {
    this.recent.push(value);
    if (this.recent.length > this.size) this.recent.shift();
    const bucket: number[] = [];
    for (const v of this.recent) if (typeof v === "number") bucket.push(v);
    if (bucket.length < this.need) {
      return null;
    }
    bucket.sort((a, b) => a - b);
    return quantile(bucket, 0.5);
  }

  /** Forget everything — a new set is not a continuation of the last one. */
  reset(): void {
    this.recent.length = 0;
  }
}

/**
 * Roll a per-frame series into what a GATE would see, offline: the same
 * `RollingWindow` rule applied across a whole recorded clip. Index-aligned with
 * the input. For any positive size this is exactly what the live gate reads
 * frame by frame, because it IS the live gate's own rolling median.
 */
export function windowed(series: readonly (number | null)[], window: number): (number | null)[] {
  const rolling = new RollingWindow(window);
  return series.map((v) => rolling.push(v));
}

/** Every signal's windowed series for a whole clip, plus how many frame pairs
 *  were skipped for being too far apart (reported, never hidden). */
export interface ClipReadings {
  readonly windows: Readonly<Record<SignalName, (number | null)[]>>;
  readonly framesRead: number;
  readonly gapsSkipped: number;
}

export function readClip(
  frames: readonly PoseFrame[],
  window: number,
  maxGapMs: number = MAX_GAP_MS,
): ClipReadings {
  const raw: Record<SignalName, (number | null)[]> = {
    centre_drift: [],
    bone_stretch: [],
    limb_asymmetry: [],
    motion_incoherence: [],
  };
  let gapsSkipped = 0;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (frame === undefined) continue;
    const previous = i > 0 ? (frames[i - 1] ?? null) : null;
    if (previous !== null) {
      const dt = frame.t - previous.t;
      if (!(dt > 0) || dt > maxGapMs) gapsSkipped++;
    }
    const reading = readFrame(frame, previous, maxGapMs);
    for (const name of SIGNAL_NAMES) raw[name].push(reading[name]);
  }
  const windows: Record<SignalName, (number | null)[]> = {
    centre_drift: windowed(raw.centre_drift, window),
    bone_stretch: windowed(raw.bone_stretch, window),
    limb_asymmetry: windowed(raw.limb_asymmetry, window),
    motion_incoherence: windowed(raw.motion_incoherence, window),
  };
  return { windows, framesRead: frames.length, gapsSkipped };
}

// ── Separation: how well does a signal tell the two piles apart? ─────────────

/** A cut-off and exactly what it costs, on both sides. Never a bare number. */
export interface OperatingPoint {
  /** Readings ABOVE this are called "not a person". */
  readonly cutoff: number;
  /** Share of PERSON frames wrongly rejected. The harmful direction: this is a
   *  real user being told the camera cannot see them while they squat. */
  readonly personRejected: number;
  /** Share of NOBODY frames correctly caught. */
  readonly nobodyCaught: number;
}

function sortedNumbers(values: readonly (number | null)[]): number[] {
  const out: number[] = [];
  for (const v of values) if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Share of readings the GATE would block at this cut-off — so the comparison is
 * `>` and must stay `>`, because `PersonGate` blocks on `reading > cutoff`.
 *
 * This is not pedantry about a tie. Every cut-off `cutoffAtPersonCost` returns
 * IS one of the person's own readings, so the boundary is not a rare case here,
 * it is the normal one: with `>=` the printed cost and the shipped behaviour
 * disagree on exactly the frames that sit on the number Kd approved, and both
 * sides would look self-consistent while doing it. `test/personGate.test.ts`
 * holds the two together from the other end.
 */
function shareAbove(sorted: readonly number[], cutoff: number): number {
  if (sorted.length === 0) return Number.NaN;
  let n = 0;
  for (const v of sorted) if (v > cutoff) n++;
  return n / sorted.length;
}

/**
 * Probability that a randomly chosen NOBODY reading scores above a randomly
 * chosen PERSON reading (Mann-Whitney U / AUC, ties counted as half).
 *
 * 1.00 = the two piles never overlap · 0.50 = the signal is worthless ·
 * below 0.50 = it runs backwards. It is the one number that says at a glance
 * whether a signal is worth a threshold conversation at all.
 */
export function separation(
  person: readonly (number | null)[],
  nobody: readonly (number | null)[],
): number {
  const p = sortedNumbers(person);
  const n = sortedNumbers(nobody);
  if (p.length === 0 || n.length === 0) return Number.NaN;
  let wins = 0;
  let i = 0;
  // Walk the person pile once per nobody value: both are sorted, so the count
  // of person values strictly below advances monotonically.
  let below = 0;
  for (const v of n) {
    while (i < p.length && (p[i] ?? Number.POSITIVE_INFINITY) < v) {
      i++;
      below++;
    }
    let equal = 0;
    for (let k = i; k < p.length && p[k] === v; k++) equal++;
    wins += below + equal / 2;
  }
  return wins / (p.length * n.length);
}

/**
 * The cut-off that rejects AT MOST `maxPersonRejected` of person readings, and
 * what share of nobody readings it catches at that price.
 *
 * This direction is deliberate. A gate that wrongly rejects a real user stops
 * them counting reps in their own workout; a gate that wrongly accepts a chair
 * leaves today's behaviour unchanged. Those costs are not symmetric, so the
 * cut-off is pinned by the harmful side and the benefit is reported, never the
 * other way round.
 */
export function cutoffAtPersonCost(
  person: readonly (number | null)[],
  nobody: readonly (number | null)[],
  maxPersonRejected: number,
): OperatingPoint | null {
  const p = sortedNumbers(person);
  const n = sortedNumbers(nobody);
  if (p.length === 0 || n.length === 0) return null;
  const cutoff = quantile(p, 1 - maxPersonRejected);
  return { cutoff, personRejected: shareAbove(p, cutoff), nobodyCaught: shareAbove(n, cutoff) };
}

/** The mirror view: the cut-off needed to catch `minNobodyCaught` of the
 *  furniture, and what it costs in real users. Printed alongside the above so
 *  the trade-off is visible from both ends rather than argued from one. */
export function cutoffAtCatchRate(
  person: readonly (number | null)[],
  nobody: readonly (number | null)[],
  minNobodyCaught: number,
): OperatingPoint | null {
  const p = sortedNumbers(person);
  const n = sortedNumbers(nobody);
  if (p.length === 0 || n.length === 0) return null;
  const cutoff = quantile(n, 1 - minNobodyCaught);
  return { cutoff, personRejected: shareAbove(p, cutoff), nobodyCaught: shareAbove(n, cutoff) };
}

/** p05/p25/median/p75/p95 of a windowed series, for the per-clip table. */
export interface Distribution {
  readonly count: number;
  readonly p05: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly p95: number;
}

export function distribution(values: readonly (number | null)[]): Distribution {
  const s = sortedNumbers(values);
  return {
    count: s.length,
    p05: quantile(s, 0.05),
    p25: quantile(s, 0.25),
    median: quantile(s, 0.5),
    p75: quantile(s, 0.75),
    p95: quantile(s, 0.95),
  };
}
