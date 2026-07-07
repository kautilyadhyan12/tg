// Stage 3 tests (Part 2 §3.3).
import { describe, expect, it } from "vitest";
import type { PoseFrame } from "@app/shared";
import { VIEW_HYSTERESIS_FRAMES, ViewTracker, VisibilityGate, classifyView } from "../../src/index.js";

// Build a frame with controlled shoulder/hip x-spans against a fixed
// shoulder→ankle height of 0.5 image units.
function geomFrame(shoulderSpan: number, hipSpan: number): PoseFrame {
  const kp: [number, number, number, number][] = Array.from({ length: 33 }, () => [
    0.5, 0.5, 0, 0.95,
  ]);
  const shoulderY = 0.25;
  const ankleY = 0.75; // refHeight = 0.5
  kp[11] = [0.5 - shoulderSpan / 2, shoulderY, 0, 0.95]; // L shoulder
  kp[12] = [0.5 + shoulderSpan / 2, shoulderY, 0, 0.95]; // R shoulder
  kp[23] = [0.5 - hipSpan / 2, 0.5, 0, 0.95]; // L hip
  kp[24] = [0.5 + hipSpan / 2, 0.5, 0, 0.95]; // R hip
  kp[27] = [0.5, ankleY, 0, 0.95]; // L ankle
  kp[28] = [0.5, ankleY, 0, 0.95]; // R ankle
  return { t: 0, kp };
}

function readyGate(frame: PoseFrame): VisibilityGate {
  const g = new VisibilityGate(33);
  frame.kp.forEach((k, i) => g.update(i, k[3]));
  return g;
}

describe("classifyView thresholds (§3.3)", () => {
  // spans are relative to refHeight 0.5: norm = span / 0.5
  it("side when both norms < 0.15", () => {
    const f = geomFrame(0.05, 0.05); // norms 0.10 / 0.10
    expect(classifyView(f, readyGate(f))).toBe("side");
  });
  it("front when shoulder norm > 0.20", () => {
    const f = geomFrame(0.15, 0.05); // shoulder norm 0.30
    expect(classifyView(f, readyGate(f))).toBe("front");
  });
  it("front when hip norm > 0.15 even with narrow shoulders", () => {
    const f = geomFrame(0.05, 0.1); // hip norm 0.20
    expect(classifyView(f, readyGate(f))).toBe("front");
  });
  it("unknown in the gap between clusters", () => {
    const f = geomFrame(0.09, 0.05); // shoulder norm 0.18: not side (<0.15 fails), not front (>0.20 fails)
    expect(classifyView(f, readyGate(f))).toBe("unknown");
  });
  it("unknown when the LEFT ankle is unusable — even with a usable right ankle (legacy port)", () => {
    const f = geomFrame(0.05, 0.05);
    f.kp[27] = [0.5, 0.75, 0, 0.05]; // left ankle invisible
    f.kp[28] = [0.5, 0.75, 0, 0.95]; // right ankle fine — Python ignores it
    expect(classifyView(f, readyGate(f))).toBe("unknown");
  });

  it("unknown when reference height is degenerate (< 1e-4, angles.py:201)", () => {
    const f = geomFrame(0.05, 0.05);
    // collapse left shoulder onto left ankle vertically
    f.kp[11] = [0.5 - 0.025, 0.75, 0, 0.95];
    expect(classifyView(f, readyGate(f))).toBe("unknown");
  });
});

describe("ViewTracker hysteresis (§3.3: 10 consecutive frames)", () => {
  it("9 consecutive frames do not flip; the 10th does", () => {
    const tr = new ViewTracker();
    for (let i = 0; i < VIEW_HYSTERESIS_FRAMES - 1; i++) {
      expect(tr.update("side")).toBe("unknown");
    }
    expect(tr.update("side")).toBe("side"); // 10th
  });

  it("an interruption resets the streak", () => {
    const tr = new ViewTracker();
    for (let i = 0; i < 5; i++) tr.update("side");
    tr.update("front"); // breaks the side streak
    for (let i = 0; i < VIEW_HYSTERESIS_FRAMES - 1; i++) {
      expect(tr.update("side")).toBe("unknown");
    }
    expect(tr.update("side")).toBe("side");
  });

  it("brief flicker after settling does not change the reported view", () => {
    const tr = new ViewTracker();
    for (let i = 0; i < VIEW_HYSTERESIS_FRAMES; i++) tr.update("front");
    expect(tr.view).toBe("front");
    for (let i = 0; i < VIEW_HYSTERESIS_FRAMES - 1; i++) {
      expect(tr.update("unknown")).toBe("front"); // rotating slightly mid-rep
    }
    expect(tr.update("front")).toBe("front");
    expect(tr.view).toBe("front");
  });
});
