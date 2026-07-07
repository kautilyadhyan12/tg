// Calibration module tests (§3.5).
import { describe, expect, it } from "vitest";
import type { PoseFrame } from "@app/shared";
import {
  AdaptiveTarget,
  FloorReference,
  STANDING_CAPTURE_FRAMES,
  StandingCalibration,
  VisibilityGate,
} from "../../src/index.js";

function frameAt(t: number): PoseFrame {
  const kp: [number, number, number, number][] = Array.from({ length: 33 }, () => [
    0.5, 0.5, 0, 0.95,
  ]);
  kp[11] = [0.45, 0.3, 0, 0.95];
  kp[12] = [0.55, 0.3, 0, 0.95];
  kp[23] = [0.46, 0.55, 0, 0.95];
  kp[24] = [0.54, 0.55, 0, 0.95];
  kp[27] = [0.46, 0.9, 0, 0.95];
  kp[28] = [0.54, 0.9, 0, 0.95];
  return { t, kp };
}

function gateFor(f: PoseFrame): VisibilityGate {
  const g = new VisibilityGate(33);
  f.kp.forEach((k, i) => g.update(i, k[3]));
  return g;
}

const FRAME_MS = 66.7;

function feed(
  cal: StandingCalibration,
  n: number,
  knee: number | null,
  startT = 0,
  view: "front" | "side" | "unknown" = "front",
  visible = true,
): number {
  let t = startT;
  for (let i = 0; i < n; i++) {
    const f = frameAt(t);
    cal.update(f, gateFor(f), knee, view, visible, 0.02, -0.02);
    t += FRAME_MS;
  }
  return t;
}

describe("C1 standing_baseline (§3.5 port)", () => {
  it("captures after exactly 8 consecutive qualifying frames", () => {
    const cal = new StandingCalibration();
    feed(cal, STANDING_CAPTURE_FRAMES - 1, 165);
    expect(cal.ready).toBe(false);
    feed(cal, 1, 165, (STANDING_CAPTURE_FRAMES - 1) * FRAME_MS);
    expect(cal.ready).toBe(true);
    const b = cal.baseline;
    expect(b?.torsoHeight).toBeCloseTo(0.25, 6); // |0.3 − 0.55|
    expect(b?.hipY).toBeCloseTo(0.55, 6);
    expect(b?.ankleY).toBeCloseTo(0.9, 6);
    expect(b?.valgusL).toBeCloseTo(0.02, 6);
  });

  it("non-qualifying frame resets the streak (7 + reset + 8 pattern)", () => {
    const cal = new StandingCalibration();
    let t = feed(cal, 7, 165);
    t = feed(cal, 1, 120, t); // squatting: reset
    expect(cal.ready).toBe(false);
    t = feed(cal, 7, 165, t);
    expect(cal.ready).toBe(false); // only 7 since reset
    feed(cal, 1, 165, t);
    expect(cal.ready).toBe(true);
  });

  it("null knee (unusable) is non-qualifying", () => {
    const cal = new StandingCalibration();
    let t = feed(cal, 7, 165);
    t = feed(cal, 1, null, t);
    feed(cal, 8, 165, t);
    expect(cal.ready).toBe(true); // needed a full fresh 8
  });

  it("front↔side view flip invalidates a captured baseline", () => {
    const cal = new StandingCalibration();
    feed(cal, 8, 165, 0, "front");
    expect(cal.ready).toBe(true);
    feed(cal, 1, 165, 8 * FRAME_MS, "side");
    expect(cal.ready).toBe(false);
  });

  it("subject lost > 3 s invalidates; brief loss does not", () => {
    const cal = new StandingCalibration();
    let t = feed(cal, 8, 165);
    expect(cal.ready).toBe(true);
    t = feed(cal, 20, 165, t, "front", false); // ~1.3 s lost
    expect(cal.ready).toBe(true);
    feed(cal, 50, 165, t, "front", false); // > 3 s total lost
    expect(cal.ready).toBe(false);
  });

  it("restore() carries a baseline across sets (§2.3)", () => {
    const cal = new StandingCalibration();
    feed(cal, 8, 165);
    const b = cal.baseline;
    const set2 = new StandingCalibration();
    if (b) set2.restore(b);
    expect(set2.ready).toBe(true);
    expect(set2.baseline).toEqual(b);
  });
});

describe("C2 adaptive_target (§3.5 chair-depth port)", () => {
  it("uses the fallback until 2 reps complete, then the clamped mean", () => {
    const c2 = new AdaptiveTarget(80, 120, 100);
    expect(c2.target).toBe(100); // CHAIR_FALLBACK_TARGET
    c2.onRepComplete(95);
    expect(c2.target).toBe(100); // still fallback after 1 rep
    c2.onRepComplete(105);
    expect(c2.calibrated).toBe(true);
    expect(c2.target).toBe(100); // mean(95,105)
  });
  it("clamps both ends of the declared range", () => {
    const low = new AdaptiveTarget(80, 120, 100);
    low.onRepComplete(60);
    low.onRepComplete(62);
    expect(low.target).toBe(80);
    const high = new AdaptiveTarget(80, 120, 100);
    high.onRepComplete(130);
    high.onRepComplete(140);
    expect(high.target).toBe(120);
  });
  it("later reps do not move a locked target", () => {
    const c2 = new AdaptiveTarget(80, 120, 100);
    c2.onRepComplete(90);
    c2.onRepComplete(90);
    c2.onRepComplete(150);
    expect(c2.target).toBe(90);
  });
});

describe("C3 floor_reference (§3.5)", () => {
  it("captures only after a FULL 1 s of stillness under the declared threshold", () => {
    const c3 = new FloorReference(0.01);
    let t = 0;
    for (let i = 0; i < 14; i++) {
      // 14 frames ≈ 933 ms < 1000 ms
      const f = frameAt(t);
      c3.update(f, gateFor(f), 0.001);
      t += FRAME_MS;
    }
    expect(c3.ready).toBe(false);
    for (let i = 0; i < 3; i++) {
      const f = frameAt(t);
      c3.update(f, gateFor(f), 0.001);
      t += FRAME_MS;
    }
    expect(c3.ready).toBe(true);
    expect(c3.reference?.hipY).toBeCloseTo(0.55, 6);
  });
  it("movement resets the stillness clock; null stillness never counts", () => {
    const c3 = new FloorReference(0.01);
    let t = 0;
    for (let i = 0; i < 10; i++) {
      const f = frameAt(t);
      c3.update(f, gateFor(f), 0.001);
      t += FRAME_MS;
    }
    const f = frameAt(t);
    c3.update(f, gateFor(f), 0.5); // moved
    t += FRAME_MS;
    for (let i = 0; i < 10; i++) {
      const g = frameAt(t);
      c3.update(g, gateFor(g), null); // stillness unknown: no decision
      t += FRAME_MS;
    }
    expect(c3.ready).toBe(false);
  });
});
