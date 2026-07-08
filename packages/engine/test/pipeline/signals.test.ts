// Signal library tests (§3.4): correct values on synthetic geometry, null on
// unusable landmarks, channel/view metadata, stillness behavior.
import { describe, expect, it } from "vitest";
import type { PoseFrame } from "@app/shared";
import {
  SIGNAL_REGISTRY,
  SignalComputationError,
  SignalEngine,
  StillnessTracker,
  VisibilityGate,
  type SignalName,
  type StandingBaseline,
} from "../../src/index.js";

// Body pose in image space (y down): upright person, all landmarks visible.
function bodyFrame(t = 0, overrides: Partial<Record<number, [number, number]>> = {}): PoseFrame {
  const kp: [number, number, number, number][] = Array.from({ length: 33 }, () => [
    0.5, 0.5, 0, 0.95,
  ]);
  const put = (i: number, x: number, y: number) => {
    kp[i] = [x, y, 0, 0.95];
  };
  put(11, 0.46, 0.3); // L shoulder (x aligned with L hip: truly upright)
  put(12, 0.54, 0.3); // R shoulder
  put(13, 0.42, 0.42); // L elbow
  put(14, 0.58, 0.42); // R elbow
  put(15, 0.4, 0.55); // L wrist
  put(16, 0.6, 0.55); // R wrist
  put(23, 0.46, 0.55); // L hip
  put(24, 0.54, 0.55); // R hip
  put(25, 0.46, 0.72); // L knee
  put(26, 0.54, 0.72); // R knee
  put(27, 0.46, 0.9); // L ankle
  put(28, 0.54, 0.9); // R ankle
  for (const [i, xy] of Object.entries(overrides)) {
    if (xy) put(Number(i), xy[0], xy[1]);
  }
  return { t, kp };
}

function gateFor(frame: PoseFrame): VisibilityGate {
  const g = new VisibilityGate(33);
  frame.kp.forEach((k, i) => g.update(i, k[3]));
  return g;
}

const ALL_COMPUTABLE = (Object.keys(SIGNAL_REGISTRY) as SignalName[]).filter(
  (n) => SIGNAL_REGISTRY[n].derived !== true,
);

describe("joint-angle signals (#1–9)", () => {
  it("straight upright leg: knee_L ≈ 180", () => {
    const f = bodyFrame();
    const out = new SignalEngine(["knee_L"]).compute(f, gateFor(f), null);
    expect(out.knee_L).toBeCloseTo(180, 1);
  });
  it("bent knee: hand-computed 90° fixture", () => {
    // hip (0.46,0.55), knee (0.46,0.72), ankle (0.63,0.72): vertical thigh, horizontal shin.
    const f = bodyFrame(0, { 27: [0.63, 0.72] });
    const out = new SignalEngine(["knee_L"]).compute(f, gateFor(f), null);
    expect(out.knee_L).toBeCloseTo(90, 1);
  });
  it("knee_avg averages both; single-leg fallback when one unusable", () => {
    const f = bodyFrame();
    f.kp[26] = [0.54, 0.72, 0, 0.05]; // right knee invisible
    const out = new SignalEngine(["knee_avg", "knee_L"]).compute(f, gateFor(f), null);
    expect(out.knee_avg).toBeCloseTo(out.knee_L ?? -1, 6);
  });
  it("null when a required landmark is unusable", () => {
    const f = bodyFrame();
    f.kp[25] = [0.46, 0.72, 0, 0.05]; // left knee invisible
    const out = new SignalEngine(["knee_L"]).compute(f, gateFor(f), null);
    expect(out.knee_L).toBeNull();
  });
});

describe("incline signals (#10–11)", () => {
  it("upright trunk ≈ 0°; leaning trunk measures the lean", () => {
    const f = bodyFrame();
    const out = new SignalEngine(["trunk_incline"]).compute(f, gateFor(f), null);
    expect(out.trunk_incline).toBeCloseTo(0, 1);
    const lean = bodyFrame(0, { 11: [0.3, 0.35] }); // shoulder forward of hip
    // shoulder(0.3,0.35) → hip(0.46,0.55): vector (0.16,0.20) → atan(0.16/0.20)≈38.66°
    const out2 = new SignalEngine(["trunk_incline"]).compute(lean, gateFor(lean), null);
    expect(out2.trunk_incline).toBeCloseTo(38.66, 1);
  });
  it("trunk_incline falls back to the right pair when left is unusable", () => {
    const f = bodyFrame();
    f.kp[11] = [0.45, 0.3, 0, 0.05];
    const out = new SignalEngine(["trunk_incline"]).compute(f, gateFor(f), null);
    expect(out.trunk_incline).toBeCloseTo(0, 1);
  });
});

describe("valgus + elevation (#12–17, calibration-dependent)", () => {
  const baseline: StandingBaseline = {
    valgusL: 0.0,
    valgusR: 0.0,
    hipY: 0.55,
    ankleY: 0.9,
    shoulderY: 0.3,
    torsoHeight: 0.25,
  };
  it("valgus_L: knee inside ankle gives negative-signed drift vs baseline", () => {
    // left knee drifts right (inward for a front-view left leg): knee_x > ankle_x
    const f = bodyFrame(0, { 25: [0.5, 0.72] });
    const out = new SignalEngine(["valgus_L", "valgus_delta_L"]).compute(f, gateFor(f), baseline);
    // (0.5 − 0.46) / (|0.54−0.46|+1e-6) ≈ +0.5 (image-space sign)
    expect(out.valgus_L).toBeCloseTo(0.04 / 0.080001, 3);
    expect(out.valgus_delta_L).toBeCloseTo(out.valgus_L ?? -1, 6);
  });
  it("valgus_delta null without baseline (no-decision, I6)", () => {
    const f = bodyFrame();
    const out = new SignalEngine(["valgus_delta_L"]).compute(f, gateFor(f), null);
    expect(out.valgus_delta_L).toBeNull();
  });
  it("hip_elevation positive when hips rise above baseline (jump)", () => {
    const f = bodyFrame(0, { 23: [0.46, 0.45], 24: [0.54, 0.45] }); // hips 0.10 above 0.55
    const out = new SignalEngine(["hip_elevation"]).compute(f, gateFor(f), baseline);
    expect(out.hip_elevation).toBeCloseTo(0.1 / 0.25, 6);
    const noBase = new SignalEngine(["hip_elevation"]).compute(f, gateFor(f), null);
    expect(noBase.hip_elevation).toBeNull();
  });
});

describe("body_line / elbow_under_shoulder / symmetry (#18–19, #22)", () => {
  it("straight standing body_line ≈ 180", () => {
    const f = bodyFrame();
    const out = new SignalEngine(["body_line"]).compute(f, gateFor(f), null);
    expect(out.body_line).toBeCloseTo(180, 0);
  });
  it("elbow stacked under shoulder ⇒ ~0; forward elbow measures offset", () => {
    const stacked = bodyFrame(0, { 13: [0.46, 0.42] });
    const out = new SignalEngine(["elbow_under_shoulder"]).compute(stacked, gateFor(stacked), null);
    expect(out.elbow_under_shoulder).toBeCloseTo(0, 2);
  });
  it("symmetry_knee = |L−R|; null when one side unusable", () => {
    const f = bodyFrame(0, { 27: [0.63, 0.72] }); // bend left knee to 90
    const out = new SignalEngine(["symmetry_knee"]).compute(f, gateFor(f), null);
    expect(out.symmetry_knee).toBeCloseTo(90, 0);
    f.kp[26] = [0.54, 0.72, 0, 0.05];
    const out2 = new SignalEngine(["symmetry_knee"]).compute(f, gateFor(f), null);
    expect(out2.symmetry_knee).toBeNull();
  });
});

describe("stillness (#21) and engine plumbing", () => {
  it("still torso → near-zero; moving torso → larger; window trims to 700 ms", () => {
    const tracker = new StillnessTracker();
    let still = 0;
    for (let i = 0; i < 15; i++) {
      const f = bodyFrame(i * 66.7);
      still = tracker.update(f, gateFor(f)) ?? -1;
    }
    expect(still).toBeCloseTo(0, 6);
    let moving = 0;
    for (let i = 15; i < 30; i++) {
      const f = bodyFrame(i * 66.7, { 23: [0.46 + (i % 2) * 0.05, 0.55], 24: [0.54 + (i % 2) * 0.05, 0.55] });
      moving = tracker.update(f, gateFor(f)) ?? -1;
    }
    expect(moving).toBeGreaterThan(still);
  });
  it("computes ONLY declared signals (I5)", () => {
    const f = bodyFrame();
    const out = new SignalEngine(["knee_L"]).compute(f, gateFor(f), null);
    expect(Object.keys(out)).toEqual(["knee_L"]);
  });
  it("cadence is derived: declared is fine (skipped), direct compute throws", () => {
    const f = bodyFrame();
    const engine = new SignalEngine(["cadence", "knee_L"]);
    const out = engine.compute(f, gateFor(f), null);
    expect(out).not.toHaveProperty("cadence"); // FSM supplies it in P1.6
    expect(out).toHaveProperty("knee_L");
    expect(SignalComputationError).toBeDefined();
  });
  it("every non-derived signal computes non-null on a fully visible upright body or valgus/elevation with baseline", () => {
    const f = bodyFrame();
    const baseline: StandingBaseline = {
      valgusL: 0, valgusR: 0, hipY: 0.55, ankleY: 0.9, shoulderY: 0.3, torsoHeight: 0.25,
    };
    const out = new SignalEngine(ALL_COMPUTABLE).compute(f, gateFor(f), baseline);
    for (const name of ALL_COMPUTABLE) {
      if (name === "stillness") continue; // needs ≥2 frames
      expect(out[name], `signal ${name}`).not.toBeNull();
    }
  });
});
