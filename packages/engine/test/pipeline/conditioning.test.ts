// Stage 2 tests (Part 2 §3.2).
import { describe, expect, it } from "vitest";
import {
  SmoothingBuffer,
  SpikeFilter,
  VisibilityGate,
  VIS_UNUSABLE,
  VIS_USABLE,
} from "../../src/index.js";

const FRAME_MS = 66.7; // 15 fps

describe("SmoothingBuffer (7-frame rolling mean, §3.2)", () => {
  it("matches a hand-computed 7-frame mean at 15 fps", () => {
    const buf = new SmoothingBuffer();
    const values = [100, 110, 120, 130, 140, 150, 160, 170];
    let out = 0;
    values.forEach((v, i) => {
      out = buf.push(i * FRAME_MS, v);
    });
    // last 7 of the 8 pushed: 110..170 → mean 140
    expect(out).toBeCloseTo(140, 6);
  });

  it("uses fewer samples before the window fills (no warm-up lie)", () => {
    const buf = new SmoothingBuffer();
    expect(buf.push(0, 80)).toBe(80);
    expect(buf.push(FRAME_MS, 100)).toBeCloseTo(90, 6);
  });

  it("low fps: caps history at ~470 ms instead of stretching latency", () => {
    const buf = new SmoothingBuffer();
    // 5 fps → 200 ms between frames; only ceil(470/200)+1 ≈ 3 samples fit.
    const values = [100, 120, 140, 160];
    let out = 0;
    values.forEach((v, i) => {
      out = buf.push(i * 200, v);
    });
    // samples within 470 ms of t=600: t=200(120),400(140),600(160) → mean 140
    expect(out).toBeCloseTo(140, 6);
  });
});

describe("SpikeFilter (3-frame median, raw channel §3.2)", () => {
  it("kills a single-frame glitch", () => {
    const f = new SpikeFilter();
    f.push(0.0);
    f.push(0.0);
    expect(f.push(0.9)).toBe(0.0); // lone spike suppressed
    expect(f.push(0.0)).toBe(0.0);
  });

  it("passes a genuine sustained elevation (jump flight ~400 ms @15fps ≈ 6 frames)", () => {
    const f = new SpikeFilter();
    const flight = [0, 0, 0.18, 0.2, 0.22, 0.2, 0.18, 0];
    const out = flight.map((v) => f.push(v));
    // by the second airborne frame the median reflects the elevation
    expect(Math.max(...out)).toBeGreaterThanOrEqual(0.2);
    // and a 7-frame MEAN would have lagged: prove the raw channel is faster
    // than smoothing by construction (median settles within 2 frames).
    expect(out[3]).toBeGreaterThanOrEqual(0.18);
  });
});

describe("VisibilityGate hysteresis (§3.2)", () => {
  it("becomes usable at ≥0.30, stays usable down to 0.15", () => {
    const g = new VisibilityGate(33);
    expect(g.update(25, 0.2)).toBe(false); // below 0.30 while unusable
    expect(g.update(25, VIS_USABLE)).toBe(true);
    expect(g.update(25, 0.2)).toBe(true); // in the hysteresis band: stays usable
    expect(g.update(25, VIS_UNUSABLE)).toBe(true); // 0.15 is still ≥ floor
    expect(g.update(25, 0.14)).toBe(false); // below floor: unusable
    expect(g.update(25, 0.2)).toBe(false); // needs ≥0.30 again
  });

  it("oscillation across 0.20↔0.35 does not flap once usable", () => {
    const g = new VisibilityGate(33);
    g.update(11, 0.35);
    const states = [0.2, 0.35, 0.2, 0.35, 0.2].map((v) => g.update(11, v));
    expect(states.every(Boolean)).toBe(true);
  });

  it("allUsable requires every listed landmark", () => {
    const g = new VisibilityGate(33);
    g.update(11, 0.9);
    g.update(12, 0.9);
    expect(g.allUsable([11, 12])).toBe(true);
    expect(g.allUsable([11, 12, 23])).toBe(false);
  });
});
