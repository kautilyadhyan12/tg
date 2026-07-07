// Part 2 §3.4 — signal library v1. A signal is a named, typed, per-frame
// scalar with a declared formula, view validity, smoothing channel, and
// calibration dependency. The engine computes ONLY the signals a definition
// declares (I5). Unusable landmarks ⇒ null; consumers of null follow §3.6's
// no-decision rule (I6). Formulas exact where ported (signals 1–17).
// z is used by NO v1 signal (§3.4 reliability note).
import { calculateAngle, inclineFromVertical, round4 } from "./geometry.js";
import type { StandingBaseline } from "./calibration.js";
import type { PoseFrame, View } from "./types.js";
import type { VisibilityGate } from "./conditioning.js";

export const STILLNESS_WINDOW_MS = 700; // §3.4 signal 21

// BlazePose indices (frozen §2.1 map).
const NOSE_TO_FOOT = {
  l_shoulder: 11,
  r_shoulder: 12,
  l_elbow: 13,
  r_elbow: 14,
  l_wrist: 15,
  r_wrist: 16,
  l_hip: 23,
  r_hip: 24,
  l_knee: 25,
  r_knee: 26,
  l_ankle: 27,
  r_ankle: 28,
} as const;
const I = NOSE_TO_FOOT;

export type SignalChannel = "smoothed" | "raw";

export interface SignalMeta {
  name: SignalName;
  validViews: readonly View[] | "any";
  channel: SignalChannel;
  needsCalibration: "standing_baseline" | null;
  /** Derived signals (cadence) come from the FSM (P1.6), not geometry. */
  derived?: boolean;
}

export type SignalName =
  | "knee_L" | "knee_R" | "hip_L" | "hip_R" | "elbow_L" | "elbow_R"
  | "shoulder_L" | "shoulder_R"
  | "knee_avg"
  | "trunk_incline" | "shin_incline"
  | "valgus_L" | "valgus_R" | "valgus_delta_L" | "valgus_delta_R"
  | "hip_elevation" | "ankle_elevation"
  | "body_line" | "elbow_under_shoulder"
  | "cadence" | "stillness"
  | "symmetry_knee" | "symmetry_elbow";

interface Ctx {
  kp: PoseFrame["kp"];
  gate: VisibilityGate;
  baseline: StandingBaseline | null;
}

function pt(ctx: Ctx, idx: number): readonly number[] | null {
  return ctx.gate.isUsable(idx) ? (ctx.kp[idx] ?? null) : null;
}

function jointAngle(ctx: Ctx, a: number, b: number, c: number): number | null {
  const pa = pt(ctx, a);
  const pb = pt(ctx, b);
  const pc = pt(ctx, c);
  if (!pa || !pb || !pc) return null;
  return calculateAngle(pa, pb, pc);
}

// #1–6 knee/hip/elbow, #7–8 shoulder — interior angles (§3.4 rows 1–8).
const kneeL = (c: Ctx) => jointAngle(c, I.l_hip, I.l_knee, I.l_ankle);
const kneeR = (c: Ctx) => jointAngle(c, I.r_hip, I.r_knee, I.r_ankle);
const hipL = (c: Ctx) => jointAngle(c, I.l_shoulder, I.l_hip, I.l_knee);
const hipR = (c: Ctx) => jointAngle(c, I.r_shoulder, I.r_hip, I.r_knee);
const elbowL = (c: Ctx) => jointAngle(c, I.l_shoulder, I.l_elbow, I.l_wrist);
const elbowR = (c: Ctx) => jointAngle(c, I.r_shoulder, I.r_elbow, I.r_wrist);
const shoulderL = (c: Ctx) => jointAngle(c, I.l_elbow, I.l_shoulder, I.l_hip);
const shoulderR = (c: Ctx) => jointAngle(c, I.r_elbow, I.r_shoulder, I.r_hip);

// #9 knee_avg — mean of visible knee angles, 1 or 2 (§3.4; legacy _analyze_squat).
function kneeAvg(c: Ctx): number | null {
  const l = kneeL(c);
  const r = kneeR(c);
  if (l !== null && r !== null) return (l + r) / 2;
  return l ?? r;
}

// #10 trunk_incline — shoulder→hip from vertical; prefers left pair, falls back right.
function trunkIncline(c: Ctx): number | null {
  const ls = pt(c, I.l_shoulder);
  const lh = pt(c, I.l_hip);
  if (ls && lh) return inclineFromVertical(ls, lh);
  const rs = pt(c, I.r_shoulder);
  const rh = pt(c, I.r_hip);
  if (rs && rh) return inclineFromVertical(rs, rh);
  return null;
}

// #11 shin_incline — knee→ankle from vertical (side view); left-preferred like #10.
function shinIncline(c: Ctx): number | null {
  const lk = pt(c, I.l_knee);
  const la = pt(c, I.l_ankle);
  if (lk && la) return inclineFromVertical(lk, la);
  const rk = pt(c, I.r_knee);
  const ra = pt(c, I.r_ankle);
  if (rk && ra) return inclineFromVertical(rk, ra);
  return null;
}

// #12–13 valgus_L/R — (knee_x − ankle_x) / hip_width, image-space sign (front).
function hipWidth(c: Ctx): number | null {
  const lh = pt(c, I.l_hip);
  const rh = pt(c, I.r_hip);
  if (!lh || !rh) return null;
  return Math.abs((rh[0] ?? 0) - (lh[0] ?? 0)) + 1e-6; // legacy epsilon (validated notebook)
}
function valgus(c: Ctx, knee: number, ankle: number): number | null {
  const w = hipWidth(c);
  const k = pt(c, knee);
  const a = pt(c, ankle);
  if (w === null || !k || !a) return null;
  return round4(((k[0] ?? 0) - (a[0] ?? 0)) / w); // angles.py:275 rounds to 4 dp
}
const valgusL = (c: Ctx) => valgus(c, I.l_knee, I.l_ankle);
const valgusR = (c: Ctx) => valgus(c, I.r_knee, I.r_ankle);

// #14–15 valgus_delta_L/R — raw minus standing baseline; the ONLY valgus
// numbers fault rules may reference (§3.4).
function valgusDelta(c: Ctx, side: "L" | "R"): number | null {
  const raw = side === "L" ? valgusL(c) : valgusR(c);
  const base = side === "L" ? c.baseline?.valgusL : c.baseline?.valgusR;
  if (raw === null || base === null || base === undefined) return null;
  return round4(raw - base); // angles.py:281
}

// #16–17 hip/ankle elevation — (baseline_y − y) / torso_height, RAW channel.
// Positive = rising above standing (§3.4; y increases downward per §2.1).
function elevation(c: Ctx, li: number, ri: number, baseY: number | undefined): number | null {
  if (c.baseline === null || baseY === undefined) return null;
  const l = pt(c, li);
  const r = pt(c, ri);
  let y: number | null = null;
  if (l && r) y = ((l[1] ?? 0) + (r[1] ?? 0)) / 2;
  else if (l) y = l[1] ?? null;
  else if (r) y = r[1] ?? null;
  if (y === null || c.baseline.torsoHeight <= 0) return null;
  return round4((baseY - y) / c.baseline.torsoHeight); // angles.py:299/305
}
const hipElevation = (c: Ctx) => elevation(c, I.l_hip, I.r_hip, c.baseline?.hipY);
const ankleElevation = (c: Ctx) => elevation(c, I.l_ankle, I.r_ankle, c.baseline?.ankleY);

// #18 body_line — angle at hip between shoulder→hip and hip→ankle; 180 = straight.
function bodyLine(c: Ctx): number | null {
  const l = jointAngle(c, I.l_shoulder, I.l_hip, I.l_ankle);
  if (l !== null) return l;
  return jointAngle(c, I.r_shoulder, I.r_hip, I.r_ankle);
}

// #19 elbow_under_shoulder — |elbow_x − shoulder_x| / torso_height (current frame).
function elbowUnderShoulder(c: Ctx): number | null {
  const useL = pt(c, I.l_elbow) && pt(c, I.l_shoulder) && pt(c, I.l_hip);
  const e = useL ? pt(c, I.l_elbow) : pt(c, I.r_elbow);
  const s = useL ? pt(c, I.l_shoulder) : pt(c, I.r_shoulder);
  const h = useL ? pt(c, I.l_hip) : pt(c, I.r_hip);
  if (!e || !s || !h) return null;
  const torso = Math.abs((s[1] ?? 0) - (h[1] ?? 0));
  if (torso <= 1e-8) return null;
  return Math.abs((e[0] ?? 0) - (s[0] ?? 0)) / torso;
}

// #22 symmetry — |L − R| of the smoothed pair; only when both sides usable.
function symmetry(l: number | null, r: number | null): number | null {
  if (l === null || r === null) return null;
  return Math.abs(l - r);
}

/** #21 stillness — windowed (700 ms) mean displacement of hip+shoulder
 *  midpoints, torso-normalized. Stateful: owns its 700 ms sample history. */
export class StillnessTracker {
  private readonly samples: { t: number; x: number; y: number; torso: number }[] = [];

  update(frame: PoseFrame, gate: VisibilityGate): number | null {
    const pts = [I.l_shoulder, I.r_shoulder, I.l_hip, I.r_hip];
    if (!gate.allUsable(pts)) return null;
    const ls = frame.kp[I.l_shoulder];
    const rs = frame.kp[I.r_shoulder];
    const lh = frame.kp[I.l_hip];
    const rh = frame.kp[I.r_hip];
    if (!ls || !rs || !lh || !rh) return null;
    const x = (ls[0] + rs[0] + lh[0] + rh[0]) / 4;
    const y = (ls[1] + rs[1] + lh[1] + rh[1]) / 4;
    const torso = Math.abs((ls[1] + rs[1]) / 2 - (lh[1] + rh[1]) / 2);
    this.samples.push({ t: frame.t, x, y, torso });
    while (this.samples.length > 0 && frame.t - (this.samples[0]?.t ?? 0) > STILLNESS_WINDOW_MS) {
      this.samples.shift();
    }
    if (this.samples.length < 2 || torso <= 1e-8) return null;
    let sum = 0;
    for (let i = 1; i < this.samples.length; i++) {
      const a = this.samples[i - 1];
      const b = this.samples[i];
      if (!a || !b) continue;
      sum += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return sum / (this.samples.length - 1) / torso;
  }

  reset(): void {
    this.samples.length = 0;
  }
}

export const SIGNAL_REGISTRY: Record<SignalName, SignalMeta> = {
  knee_L: { name: "knee_L", validViews: "any", channel: "smoothed", needsCalibration: null },
  knee_R: { name: "knee_R", validViews: "any", channel: "smoothed", needsCalibration: null },
  hip_L: { name: "hip_L", validViews: "any", channel: "smoothed", needsCalibration: null },
  hip_R: { name: "hip_R", validViews: "any", channel: "smoothed", needsCalibration: null },
  elbow_L: { name: "elbow_L", validViews: "any", channel: "smoothed", needsCalibration: null },
  elbow_R: { name: "elbow_R", validViews: "any", channel: "smoothed", needsCalibration: null },
  shoulder_L: { name: "shoulder_L", validViews: "any", channel: "smoothed", needsCalibration: null },
  shoulder_R: { name: "shoulder_R", validViews: "any", channel: "smoothed", needsCalibration: null },
  knee_avg: { name: "knee_avg", validViews: "any", channel: "smoothed", needsCalibration: null },
  trunk_incline: { name: "trunk_incline", validViews: "any", channel: "smoothed", needsCalibration: null },
  shin_incline: { name: "shin_incline", validViews: ["side"], channel: "smoothed", needsCalibration: null },
  valgus_L: { name: "valgus_L", validViews: ["front"], channel: "smoothed", needsCalibration: null },
  valgus_R: { name: "valgus_R", validViews: ["front"], channel: "smoothed", needsCalibration: null },
  valgus_delta_L: { name: "valgus_delta_L", validViews: ["front"], channel: "smoothed", needsCalibration: "standing_baseline" },
  valgus_delta_R: { name: "valgus_delta_R", validViews: ["front"], channel: "smoothed", needsCalibration: "standing_baseline" },
  hip_elevation: { name: "hip_elevation", validViews: "any", channel: "raw", needsCalibration: "standing_baseline" },
  ankle_elevation: { name: "ankle_elevation", validViews: "any", channel: "raw", needsCalibration: "standing_baseline" },
  body_line: { name: "body_line", validViews: ["side"], channel: "smoothed", needsCalibration: null },
  elbow_under_shoulder: { name: "elbow_under_shoulder", validViews: ["side"], channel: "smoothed", needsCalibration: null },
  cadence: { name: "cadence", validViews: "any", channel: "smoothed", needsCalibration: null, derived: true },
  stillness: { name: "stillness", validViews: "any", channel: "raw", needsCalibration: null },
  symmetry_knee: { name: "symmetry_knee", validViews: ["front"], channel: "smoothed", needsCalibration: null },
  symmetry_elbow: { name: "symmetry_elbow", validViews: ["front"], channel: "smoothed", needsCalibration: null },
};

export class SignalComputationError extends Error {
  constructor(name: string) {
    super(`signal '${name}' is FSM-derived and lands in P1.6 — not computable from geometry`);
    this.name = "SignalComputationError";
  }
}

/** Computes the declared signals for one frame. Stateless except for the
 *  stillness window (owned here). Only declared signals are computed (I5). */
export class SignalEngine {
  private readonly stillnessTracker = new StillnessTracker();

  constructor(private readonly declared: readonly SignalName[]) {
    for (const name of declared) {
      if (SIGNAL_REGISTRY[name].derived === true) {
        // Declared derived signals are fine — the FSM supplies them in P1.6;
        // this engine simply never computes them.
        continue;
      }
    }
  }

  compute(
    frame: PoseFrame,
    gate: VisibilityGate,
    baseline: StandingBaseline | null,
  ): Partial<Record<SignalName, number | null>> {
    const ctx: Ctx = { kp: frame.kp, gate, baseline };
    const out: Partial<Record<SignalName, number | null>> = {};
    for (const name of this.declared) {
      if (SIGNAL_REGISTRY[name].derived === true) continue; // FSM-supplied (P1.6)
      out[name] = this.computeOne(name, ctx, frame, gate);
    }
    return out;
  }

  private computeOne(
    name: SignalName,
    ctx: Ctx,
    frame: PoseFrame,
    gate: VisibilityGate,
  ): number | null {
    switch (name) {
      case "knee_L": return kneeL(ctx);
      case "knee_R": return kneeR(ctx);
      case "hip_L": return hipL(ctx);
      case "hip_R": return hipR(ctx);
      case "elbow_L": return elbowL(ctx);
      case "elbow_R": return elbowR(ctx);
      case "shoulder_L": return shoulderL(ctx);
      case "shoulder_R": return shoulderR(ctx);
      case "knee_avg": return kneeAvg(ctx);
      case "trunk_incline": return trunkIncline(ctx);
      case "shin_incline": return shinIncline(ctx);
      case "valgus_L": return valgusL(ctx);
      case "valgus_R": return valgusR(ctx);
      case "valgus_delta_L": return valgusDelta(ctx, "L");
      case "valgus_delta_R": return valgusDelta(ctx, "R");
      case "hip_elevation": return hipElevation(ctx);
      case "ankle_elevation": return ankleElevation(ctx);
      case "body_line": return bodyLine(ctx);
      case "elbow_under_shoulder": return elbowUnderShoulder(ctx);
      case "stillness": return this.stillnessTracker.update(frame, gate);
      case "symmetry_knee": return symmetry(kneeL(ctx), kneeR(ctx));
      case "symmetry_elbow": return symmetry(elbowL(ctx), elbowR(ctx));
      case "cadence": throw new SignalComputationError(name);
      default: {
        const exhaustive: never = name;
        throw new SignalComputationError(String(exhaustive));
      }
    }
  }

  reset(): void {
    this.stillnessTracker.reset();
  }
}
