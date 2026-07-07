// Stage 3 — View classifier (Part 2 §3.3). Direct port of the legacy
// detect_view (measured against labeled clips; clusters don't overlap):
//   reference height = |ankle_y − shoulder_y|
//   shoulder_width_norm / hip_width_norm = x-spans / reference height
//   side  if both < 0.15 · front if shoulder > 0.20 or hip > 0.15 · else unknown
//   requires shoulders, hips, one ankle visible; otherwise unknown.
// Engine addition per §3.3: the REPORTED view changes only after the new
// classification persists 10 consecutive frames (~0.7 s @ 15 fps) — prevents
// mid-rep view flapping toggling view-scoped faults within one rep.
import type { PoseFrame, View } from "./types.js";
import type { VisibilityGate } from "./conditioning.js";

export const VIEW_SIDE_MAX = 0.15; // §3.3: side if both norms below
export const VIEW_FRONT_SHOULDER_MIN = 0.2; // §3.3: front if shoulder norm above
export const VIEW_FRONT_HIP_MIN = 0.15; // §3.3: ... or hip norm above
export const VIEW_HYSTERESIS_FRAMES = 10; // §3.3 engine addition

// BlazePose indices (frozen §2.1 map; mirrors @app/shared KP).
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_HIP = 23;
const R_HIP = 24;
const L_ANKLE = 27;
const R_ANKLE = 28;

/** Raw single-frame classification (no hysteresis). */
export function classifyView(frame: PoseFrame, gate: VisibilityGate): View {
  const kp = frame.kp;
  const shouldersOk = gate.isUsable(L_SHOULDER) && gate.isUsable(R_SHOULDER);
  const hipsOk = gate.isUsable(L_HIP) && gate.isUsable(R_HIP);
  const ankleL = gate.isUsable(L_ANKLE);
  const ankleR = gate.isUsable(R_ANKLE);
  if (!shouldersOk || !hipsOk || (!ankleL && !ankleR)) return "unknown";

  const ls = kp[L_SHOULDER];
  const rs = kp[R_SHOULDER];
  const lh = kp[L_HIP];
  const rh = kp[R_HIP];
  const ankle = ankleL ? kp[L_ANKLE] : kp[R_ANKLE];
  const shoulder = ankleL || !ankleR ? ls : rs; // pair the reference vertically on the usable side
  if (!ls || !rs || !lh || !rh || !ankle || !shoulder) return "unknown";

  const refHeight = Math.abs(ankle[1] - shoulder[1]);
  if (refHeight <= 1e-6) return "unknown";
  const shoulderWidthNorm = Math.abs(rs[0] - ls[0]) / refHeight;
  const hipWidthNorm = Math.abs(rh[0] - lh[0]) / refHeight;

  if (shoulderWidthNorm > VIEW_FRONT_SHOULDER_MIN || hipWidthNorm > VIEW_FRONT_HIP_MIN) {
    return "front";
  }
  if (shoulderWidthNorm < VIEW_SIDE_MAX && hipWidthNorm < VIEW_SIDE_MAX) {
    return "side";
  }
  return "unknown";
}

/** Reported-view tracker with the 10-consecutive-frame hysteresis. */
export class ViewTracker {
  private reported: View = "unknown";
  private candidate: View = "unknown";
  private streak = 0;

  update(rawView: View): View {
    if (rawView === this.reported) {
      this.candidate = rawView;
      this.streak = 0;
      return this.reported;
    }
    if (rawView === this.candidate) {
      this.streak++;
    } else {
      this.candidate = rawView;
      this.streak = 1;
    }
    if (this.streak >= VIEW_HYSTERESIS_FRAMES) {
      this.reported = this.candidate;
      this.streak = 0;
    }
    return this.reported;
  }

  get view(): View {
    return this.reported;
  }
}
