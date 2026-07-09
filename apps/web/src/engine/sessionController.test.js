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
