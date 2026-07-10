import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseTrace } from "@app/engine";
import { SessionController } from "./sessionController.js";

function replay(controller, trace) {
  const displays = [];
  for (const frame of trace.frames) {
    const landmarks = frame.kp.map(([x, y, z, visibility]) => ({ x, y, z, visibility }));
    displays.push(controller.feed(landmarks, frame.t, landmarks.length > 0));
  }
  return displays;
}

describe("SessionController — engine mode (def exists)", () => {
  it("replays a golden to the expected per-set reps + SetSummary", () => {
    const trace = parseTrace(
      readFileSync(join(import.meta.dirname, "__fixtures__/squat_goodform.jsonl"), "utf8"),
    );
    const c = new SessionController();
    c.startSet(trace.header.exercise, 1);
    expect(c.analysisAvailable).toBe(true);

    const displays = replay(c, trace);
    const summary = c.endSet();

    expect(summary.reps).toBe(trace.header.expected.reps); // 2
    expect(c.repScores).toHaveLength(trace.header.expected.reps);
    // The live display carries the engine rep count and the latest rep score.
    const last = displays[displays.length - 1];
    expect(last.rep_count).toBe(summary.reps);
    expect(last.logOnly).toBeUndefined();
    expect(last.form_score).toBe(c.repScores[c.repScores.length - 1]);
  });
});

describe("SessionController — occluded legs (sitting-at-desk bug)", () => {
  // 33 valid keypoints, but every leg joint (hips/knees/ankles/feet, 23–32)
  // has near-zero visibility — MediaPipe's output when only a face is in frame.
  const legsHiddenLandmarks = () =>
    Array.from({ length: 33 }, (_, i) => ({
      x: 0.5,
      y: 0.3,
      z: 0,
      visibility: i >= 23 ? 0.01 : 1.0,
    }));

  it("shows the step-back cue and withdraws the form verdict instead of 'Good Form'", () => {
    const c = new SessionController();
    c.startSet("squat", 1);
    let d;
    for (let i = 0; i < 5; i++) d = c.feed(legsHiddenLandmarks(), i * 67, true);
    expect(d.form_correct).toBeNull(); // no verdict — nothing is measured
    expect(d.corrections[0]).toMatch(/step back/i);
    expect(d.rep_count).toBe(0); // and nothing ever counts
    // A set that never measured anything reports no score.
    expect(c.endSet().avgFormScore).toBeNull();
  });
});

describe("SessionController — no phantom summaries (T3 P1.10b-2a)", () => {
  it("endSet returns null when the set was never fed a frame", () => {
    const c = new SessionController();
    c.startSet("squat", 1); // engine session, but no feed() — e.g. StrictMode remount / setup-screen switch
    expect(c.analysisAvailable).toBe(true);
    expect(c.endSet()).toBeNull(); // no reps:0 junk reaches onSetComplete
  });
});

describe("SessionController — log-only mode (Part 6 §3.6, no def)", () => {
  it("does not analyze, does not throw, and reports analysisAvailable=false", () => {
    const c = new SessionController();
    c.startSet("bench_press", 1); // no definition bundled
    expect(c.analysisAvailable).toBe(false);

    const d = c.feed([{ x: 0.1, y: 0.2, z: 0, visibility: 0.9 }], 0, true);
    expect(d.logOnly).toBe(true);
    expect(d.rep_count).toBeNull(); // manual counting owns it
    expect(d.form_correct).toBeNull(); // no grading
    expect(c.endSet()).toBeNull();
  });
});
