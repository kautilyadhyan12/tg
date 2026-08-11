// Part 2 §3.6 — rep state machine, Mode A (alternating_threshold).
// Straight port of RepCounter (rep_counter.py:114-260) — every guard kept:
//   · null metric → hold state, count nothing, isActive:false
//   · smoothing INSIDE the counter: plain mean over a 7-sample buffer
//     (angle_buffer; NO time cap — legacy semantics, unlike §3.2's conditioner)
//   · debounce ≥3 frames down / ≥2 frames up; dead-zone resets both counters
//   · min rep interval 450 ms (legacy 0.45 s), measured on frame t (I1)
//   · bilateral gate: other knee's own smoothed buffer < 150° required to
//     ENTER down when both knees visible; occluded other leg = open gate
// Modes B–D land in P1.6b — their configs throw, never fake counts.
//
// ONE DEPARTURE FROM THE PORT, and it is about TIME, never about COUNTING
// (OWED "calories bill a mid-set absence as vigorous exercise"). The legacy
// counter holds an open rep's clock across a stretch the camera could not
// watch, so the absence lands in that rep's duration and `reps × tempoMsAvg`
// bills it at the exercise MET. `loseSight()` re-arms the open CYCLE — state,
// debounce counters, `reachedBottom` and the smoothing buffer are all
// untouched, so the rep still completes and no rep is lost; the only thing
// that moves is which stretch of time the rep is credited with.
import { INVALID_STREAK_FOR_VISIBILITY } from "./ingest.js";

export const MIN_DOWN_FRAMES = 3; // rep_counter.py _min_down_frames
export const MIN_UP_FRAMES = 2; // rep_counter.py _min_up_frames
export const MIN_REP_INTERVAL_MS = 450; // rep_counter.py 0.45 s / §3.6
export const BILATERAL_ENGAGE_ANGLE = 150; // rep_counter.py / §8.1
export const FSM_SMOOTHING_SAMPLES = 7; // rep_counter.py angle_buffer maxlen

export type RepMode = "alternating_threshold" | "hold" | "alternating_sides" | "cadence";
export type Phase = "top" | "descent" | "bottom" | "ascent";
export type FsmState = "up" | "down";

export interface ModeAConfig {
  mode: "alternating_threshold";
  upAt: number;
  downAt: number;
  countOn: "up" | "down"; // legacy down_to_up ⇒ "up"
  /** Effective floor = max(450, minRepMs) (§3.6 "on top"). */
  minRepMs?: number;
  /** Stored for emission/plausibility only — §3.6 defines no counting effect. */
  maxRepMs?: number;
  /** On by default for two-leg knee metrics (§3.6). */
  bilateralGate: boolean;
}

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented (P1.6b)`);
    this.name = "NotImplementedError";
  }
}

/** Plain ≤7-sample mean — the legacy angle_buffer, NOT the §3.2 conditioner. */
class LegacyMeanBuffer {
  private readonly buf = new Float64Array(FSM_SMOOTHING_SAMPLES);
  private head = 0;
  private count = 0;

  push(v: number): number {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % FSM_SMOOTHING_SAMPLES;
    if (this.count < FSM_SMOOTHING_SAMPLES) this.count++;
    let sum = 0;
    for (let i = 0; i < this.count; i++) sum += this.buf[i] ?? 0;
    return sum / this.count;
  }
}

export interface RepCompletion {
  repIndex: number;
  /** Cycle ROM extreme: min smoothed metric since the previous completion. */
  romExtreme: number;
  /** t of completion minus t of cycle start (descent begin). */
  durationMs: number;
  phaseTimings: { descent: number; bottom: number; ascent: number };
  /** The camera lost the user mid-cycle, so `durationMs` is only the WATCHED
   *  remainder of this rep. The rep counts; its duration must not enter the
   *  set's average tempo (see session.end). */
  interrupted: boolean;
}

export interface ModeAFrameResult {
  repCount: number;
  state: FsmState;
  phase: Phase;
  isActive: boolean;
  /** round(smoothed, 1) like the legacy current_angle; null on null metric. */
  currentMetric: number | null;
  completed?: RepCompletion;
}

export class ModeAFsm {
  private readonly metricBuf = new LegacyMeanBuffer();
  private readonly otherBuf = new LegacyMeanBuffer();
  private state: FsmState = "up";
  private repCount = 0;
  private framesInDown = 0;
  private framesInUp = 0;
  private reachedBottom = false;
  private lastRepT = Number.NEGATIVE_INFINITY;
  private readonly minRepMs: number;

  // Cycle tracking for ROM extreme / phases (§3.6 Mode A phase model).
  private cycleMin = Number.POSITIVE_INFINITY;
  private cycleMinT = 0;
  private cycleMinLastT = 0; // rounded-min plateau end (bottom duration)
  private cycleStartT: number | null = null; // descent begin (left `top`)
  private prevSmoothed: number | null = null;

  // Lost-sight tracking (§3.1's own 3-frame count, applied to the METRIC here;
  // the session applies it to unusable FRAMES and calls loseSight directly).
  private nullMetricStreak = 0;
  private cycleInterrupted = false;
  private rearmCycleOnNextUsableFrame = false;

  constructor(private readonly config: ModeAConfig) {
    this.minRepMs = Math.max(MIN_REP_INTERVAL_MS, config.minRepMs ?? 0);
    if (config.countOn !== "up") {
      // Legacy supports only down_to_up; countOn:"down" has no port source.
      throw new NotImplementedError('countOn: "down"');
    }
  }

  /** @param metric raw (rounded) primary metric, already left/right-resolved
   *  @param otherKnee raw other-knee angle when both visible, else null */
  update(t: number, metric: number | null, otherKnee: number | null): ModeAFrameResult {
    if (metric === null) {
      // No usable metric — hold everything (rep_counter.py None branch).
      // §3.1's own 3-frame count applies here exactly as it does to frames that
      // stop arriving: legs that stop being MEASURABLE are the camera losing
      // the user just as surely (the web bridge already reads it that way for
      // its "cannot see your legs" cue, DECISIONS 2026-07-10). Measured on this
      // package's clips: an occlusion bills 127,200 ms of a set the engine
      // watched 8,400 ms of — the same size as walking out of shot.
      this.nullMetricStreak++;
      if (this.nullMetricStreak >= INVALID_STREAK_FOR_VISIBILITY) this.loseSight();
      return {
        repCount: this.repCount,
        state: this.state,
        phase: this.phaseOf(null),
        isActive: false,
        currentMetric: null,
      };
    }
    this.nullMetricStreak = 0;

    if (this.rearmCycleOnNextUsableFrame) {
      // Measurable again: pin the cycle HERE. Not to null, and not to where it
      // began before the absence.
      //   · left null, a rep completing before the metric next dips below
      //     `upAt` reports `durationMs: 0` — a fabricated zero traded for a
      //     fabricated two minutes;
      //   · `cycleMinT`/`cycleMinLastT` predate the absence, so pinning the
      //     start alone makes `phaseTimings.descent` NEGATIVE.
      // `cycleMin` is deliberately NOT reset: the depth reached before the
      // absence was really watched and really happened. It is the CLOCK that
      // was lying, never the ROM — so scores and the chair target are unmoved.
      this.rearmCycleOnNextUsableFrame = false;
      this.cycleStartT = t;
      this.cycleMinT = t;
      this.cycleMinLastT = t;
    }

    const smoothed = this.metricBuf.push(metric);

    let otherEngaged = true;
    if (this.config.bilateralGate && otherKnee !== null) {
      const otherSmoothed = this.otherBuf.push(otherKnee);
      otherEngaged = otherSmoothed < BILATERAL_ENGAGE_ANGLE;
    }

    let completed: RepCompletion | undefined;

    if (smoothed < this.config.downAt && otherEngaged) {
      this.framesInDown++;
      this.framesInUp = 0;
      if (this.state === "up" && this.framesInDown >= MIN_DOWN_FRAMES) {
        this.state = "down";
        this.reachedBottom = true;
      }
    } else if (smoothed > this.config.upAt) {
      this.framesInUp++;
      this.framesInDown = 0;
      if (
        this.state === "down" &&
        this.reachedBottom &&
        this.framesInUp >= MIN_UP_FRAMES &&
        t - this.lastRepT >= this.minRepMs
      ) {
        this.state = "up";
        this.repCount++;
        this.reachedBottom = false;
        this.lastRepT = t;
        completed = {
          repIndex: this.repCount,
          romExtreme: Math.round(this.cycleMin * 10) / 10,
          durationMs: this.cycleStartT !== null ? t - this.cycleStartT : 0,
          phaseTimings: {
            descent: this.cycleStartT !== null ? this.cycleMinT - this.cycleStartT : 0,
            bottom: this.cycleMinLastT - this.cycleMinT,
            ascent: t - this.cycleMinLastT,
          },
          interrupted: this.cycleInterrupted,
        };
        this.resetCycle();
      }
    } else {
      // Dead-zone between thresholds: hold state, reset both counters.
      this.framesInDown = 0;
      this.framesInUp = 0;
    }

    // Cycle bookkeeping (post-transition, mirrors observable motion).
    if (smoothed <= this.config.upAt) {
      this.cycleStartT ??= t; // left the top: descent begins
      const rounded = Math.round(smoothed * 10) / 10;
      const minRounded = Math.round(this.cycleMin * 10) / 10;
      if (rounded < minRounded) {
        this.cycleMin = smoothed;
        this.cycleMinT = t;
        this.cycleMinLastT = t;
      } else if (rounded === minRounded && this.cycleMin !== Number.POSITIVE_INFINITY) {
        this.cycleMinLastT = t; // plateau at the rounded minimum = `bottom`
      }
    }

    const result: ModeAFrameResult = {
      repCount: this.repCount,
      state: this.state,
      phase: this.phaseOf(smoothed),
      isActive: smoothed < this.config.upAt, // legacy is_active rule
      currentMetric: Math.round(smoothed * 10) / 10,
      ...(completed ? { completed } : {}),
    };
    this.prevSmoothed = smoothed;
    return result;
  }

  private phaseOf(smoothed: number | null): Phase {
    if (smoothed === null) return this.state === "down" ? "bottom" : "top";
    if (smoothed >= this.config.upAt) return "top";
    if (this.prevSmoothed === null) return "descent";
    if (smoothed < this.prevSmoothed) return "descent";
    if (smoothed > this.prevSmoothed) return "ascent";
    return this.state === "down" ? "bottom" : "descent";
  }

  /** The camera stopped being able to WATCH the user: no usable frame (the
   *  session calls this once §3.1's visibility streak trips) or no usable
   *  metric (counted above). Idempotent — production calls it on every frame of
   *  an absence, and the first call is the one that matters. */
  loseSight(): void {
    if (this.cycleStartT === null) return; // no rep in progress — nothing to re-arm
    this.cycleStartT = null;
    this.cycleInterrupted = true;
    this.rearmCycleOnNextUsableFrame = true;
  }

  private resetCycle(): void {
    this.cycleMin = Number.POSITIVE_INFINITY;
    this.cycleMinT = 0;
    this.cycleMinLastT = 0;
    this.cycleStartT = null;
    this.cycleInterrupted = false;
    this.rearmCycleOnNextUsableFrame = false;
  }

  get reps(): number {
    return this.repCount;
  }
}
