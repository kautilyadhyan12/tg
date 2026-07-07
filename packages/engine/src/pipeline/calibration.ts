// Part 2 §3.5 — calibration modules. Checks are relative to THIS person's
// body and setup, never absolute cutoffs.
import type { PoseFrame, View } from "./types.js";
import type { VisibilityGate } from "./conditioning.js";

// §3.5 C1 constants (also §8.1 rows: _StandingCalibration frames 8 / knee min 160°).
export const STANDING_KNEE_MIN = 160;
export const STANDING_CAPTURE_FRAMES = 8;
export const SUBJECT_LOST_INVALIDATE_MS = 3000; // §3.5: subject-lost > 3 s

// §3.5 C2 (chair-depth port; §8.1: CHAIR fallback 100).
export const ADAPTIVE_TARGET_REPS = 2;

// §3.5 C3: first 1 s of stillness.
export const FLOOR_REF_STILLNESS_MS = 1000;

const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_HIP = 23;
const R_HIP = 24;
const L_ANKLE = 27;
const R_ANKLE = 28;

export interface StandingBaseline {
  valgusL: number | null; // front view only (8-frame mean)
  valgusR: number | null;
  hipY: number; // 8-frame means, matching _StandingCalibration
  ankleY: number;
  shoulderY: number;
  /** |avg_ankle_y − avg_shoulder_y| — the Python capture (pose_ws.py:204-207).
   *  §3.5's prose says |shoulder−hip| but §3.4 row 16 defers to the Python
   *  capture "exactly", and §7.5 parity forces it. SPEC GAP recorded. */
  torsoHeight: number;
}

function midY(kp: PoseFrame["kp"], gate: VisibilityGate, li: number, ri: number): number | null {
  const l = gate.isUsable(li) ? kp[li] : undefined;
  const r = gate.isUsable(ri) ? kp[ri] : undefined;
  if (l && r) return (l[1] + r[1]) / 2;
  if (l) return l[1];
  if (r) return r[1];
  return null;
}

/** C1 standing_baseline — port, unchanged semantics (§3.5): arms when smoothed
 *  knee ≥ 160°, captures after 8 CONSECUTIVE qualifying frames, buffer resets
 *  on any non-qualifying frame. Carried across sets (§2.3); invalidated by a
 *  front↔side view flip or subject-lost > 3 s. */
export class StandingCalibration {
  private streak = 0;
  private captured: StandingBaseline | null = null;
  private lastSettledView: View = "unknown";
  private lostSinceT: number | null = null;
  // Per-frame buffers over the qualifying streak — capture = MEANS, matching
  // _StandingCalibration (pose_ws.py:150-207), not a last-frame snapshot.
  private readonly hipBuf: number[] = [];
  private readonly ankleBuf: number[] = [];
  private readonly shoulderBuf: number[] = [];
  private readonly valgusLBuf: number[] = [];
  private readonly valgusRBuf: number[] = [];

  /** valgusRaw: current-frame raw valgus values (null off-front-view). */
  update(
    frame: PoseFrame,
    gate: VisibilityGate,
    smoothedKneeAvg: number | null,
    reportedView: View,
    subjectVisible: boolean,
    valgusL: number | null,
    valgusR: number | null,
  ): void {
    // Invalidation: front↔side flip (§3.5 — the person may be standing elsewhere).
    if (reportedView !== "unknown") {
      if (
        this.lastSettledView !== "unknown" &&
        reportedView !== this.lastSettledView &&
        this.captured !== null
      ) {
        this.reset();
      }
      this.lastSettledView = reportedView;
    }
    // Invalidation: subject lost > 3 s.
    if (!subjectVisible) {
      this.lostSinceT ??= frame.t;
      if (frame.t - this.lostSinceT > SUBJECT_LOST_INVALIDATE_MS && this.captured !== null) {
        this.reset();
      }
      this.streak = 0;
      return;
    }
    this.lostSinceT = null;
    if (this.captured !== null) return; // already ready

    const qualifying = smoothedKneeAvg !== null && smoothedKneeAvg >= STANDING_KNEE_MIN;
    if (!qualifying) {
      this.clearBuffers(); // buffers reset on any non-qualifying frame (§3.5)
      return;
    }

    const hipY = midY(frame.kp, gate, L_HIP, R_HIP);
    const ankleY = midY(frame.kp, gate, L_ANKLE, R_ANKLE);
    const shoulderY = midY(frame.kp, gate, L_SHOULDER, R_SHOULDER);
    if (hipY === null || ankleY === null || shoulderY === null) {
      this.clearBuffers();
      return;
    }
    this.streak++;
    this.hipBuf.push(hipY);
    this.ankleBuf.push(ankleY);
    this.shoulderBuf.push(shoulderY);
    // Valgus buffers fill only when both sides are present (front view path).
    if (valgusL !== null && valgusR !== null) {
      this.valgusLBuf.push(valgusL);
      this.valgusRBuf.push(valgusR);
    }
    if (this.streak < STANDING_CAPTURE_FRAMES) return;

    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const avgShoulder = mean(this.shoulderBuf);
    const avgAnkle = mean(this.ankleBuf);
    this.captured = {
      valgusL: this.valgusLBuf.length > 0 ? mean(this.valgusLBuf) : null,
      valgusR: this.valgusRBuf.length > 0 ? mean(this.valgusRBuf) : null,
      hipY: mean(this.hipBuf),
      ankleY: avgAnkle,
      shoulderY: avgShoulder,
      torsoHeight: Math.abs(avgAnkle - avgShoulder), // pose_ws.py:204-207
    };
    this.clearBuffers();
  }

  private clearBuffers(): void {
    this.streak = 0;
    this.hipBuf.length = 0;
    this.ankleBuf.length = 0;
    this.shoulderBuf.length = 0;
    this.valgusLBuf.length = 0;
    this.valgusRBuf.length = 0;
  }

  get baseline(): StandingBaseline | null {
    return this.captured;
  }

  get ready(): boolean {
    return this.captured !== null;
  }

  /** Carry-over from a previous set of the same exercise (§2.3). */
  restore(baseline: StandingBaseline): void {
    this.captured = baseline;
  }

  reset(): void {
    this.captured = null;
    this.clearBuffers();
  }
}

/** C2 adaptive_target — chair-depth calibration, declared generically (§3.5):
 *  session_target = mean of the metric extreme over the first 2 completed
 *  reps, clamped to a definition-declared range; fallback until it fires. */
export class AdaptiveTarget {
  private readonly extremes: number[] = [];
  private sessionTarget: number | null = null;

  constructor(
    private readonly clampLo: number, // ⚙ chair squat: 80
    private readonly clampHi: number, // ⚙ chair squat: 120
    private readonly fallback: number, // ⚙ chair squat: 100 (CHAIR_FALLBACK_TARGET)
  ) {}

  onRepComplete(metricExtreme: number): void {
    if (this.sessionTarget !== null) return;
    this.extremes.push(metricExtreme);
    if (this.extremes.length >= ADAPTIVE_TARGET_REPS) {
      const mean = this.extremes.reduce((a, b) => a + b, 0) / this.extremes.length;
      this.sessionTarget = Math.min(this.clampHi, Math.max(this.clampLo, mean));
    }
  }

  /** Scoring target: fallback until the first 2 reps complete (§3.5). */
  get target(): number {
    return this.sessionTarget ?? this.fallback;
  }

  get calibrated(): boolean {
    return this.sessionTarget !== null;
  }
}

/** C3 floor_reference — new, tiny (§3.5): for supine/prone starts, captures
 *  resting hip_y/shoulder_y after the first 1 s of stillness. The stillness
 *  threshold is definition-declared (⚙) — the spec names no engine default. */
export class FloorReference {
  private stillSinceT: number | null = null;
  private captured: { hipY: number; shoulderY: number } | null = null;

  constructor(private readonly stillnessThreshold: number) {}

  update(frame: PoseFrame, gate: VisibilityGate, stillness: number | null): void {
    if (this.captured !== null) return;
    if (stillness === null || stillness >= this.stillnessThreshold) {
      this.stillSinceT = null;
      return;
    }
    this.stillSinceT ??= frame.t;
    if (frame.t - this.stillSinceT < FLOOR_REF_STILLNESS_MS) return;
    const hipY = midY(frame.kp, gate, L_HIP, R_HIP);
    const shoulderY = midY(frame.kp, gate, L_SHOULDER, R_SHOULDER);
    if (hipY === null || shoulderY === null) return;
    this.captured = { hipY, shoulderY };
  }

  get reference(): { hipY: number; shoulderY: number } | null {
    return this.captured;
  }

  get ready(): boolean {
    return this.captured !== null;
  }
}
