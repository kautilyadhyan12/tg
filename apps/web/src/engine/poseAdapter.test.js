// P1.10b-1b — adapter unit tests. Covers the NEW logic this module adds on top
// of the (already trace-tested) engine: the §2.2 landmark mapping, the I4
// version gate, and the per-set session glue. The lifecycle test replays a real
// recorded golden so the wiring is proven against known-good engine output.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseTrace } from "@app/engine";
import squatDef from "@app/engine/definitions/squat.json";
import {
  EngineUnsupportedError,
  engineSupports,
  getDefinition,
  hasCameraAnalysis,
  landmarksToFrame,
  startSet,
} from "./poseAdapter.js";

describe("landmarksToFrame (§2.2 — un-mirrored provider coords)", () => {
  it("maps MediaPipe landmarks to a PoseFrame without flipping x", () => {
    const landmarks = [
      { x: 0.1, y: 0.2, z: -0.3, visibility: 0.9 },
      { x: 0.8, y: 0.5, z: 0.1, visibility: 0.4 },
    ];
    const frame = landmarksToFrame(landmarks, 1234);
    expect(frame.t).toBe(1234);
    // x passes through untouched — NOT mirrored to (1 - x).
    expect(frame.kp[0]).toEqual([0.1, 0.2, -0.3, 0.9]);
    expect(frame.kp[1]).toEqual([0.8, 0.5, 0.1, 0.4]);
  });

  it("defaults missing visibility to 1.0", () => {
    const frame = landmarksToFrame([{ x: 0.1, y: 0.2, z: 0.3 }], 0);
    expect(frame.kp[0]).toEqual([0.1, 0.2, 0.3, 1.0]);
  });

  it("emits an empty kp when no person is detected (engine fail-soft, §3.1)", () => {
    expect(landmarksToFrame([], 5).kp).toEqual([]);
    expect(landmarksToFrame(null, 5).kp).toEqual([]);
  });
});

describe("engineSupports (I4 minEngineVersion client gate)", () => {
  it("runs a definition the engine is new enough for", () => {
    // squat.json declares minEngineVersion "1.0.0"; ENGINE_VERSION is 1.0.0.
    expect(engineSupports(squatDef)).toBe(true);
  });

  it("refuses a definition that needs a newer engine, and startSet throws", () => {
    const future = { ...squatDef, minEngineVersion: "2.0.0" };
    expect(engineSupports(future)).toBe(false);
    expect(() => startSet(future, 1)).toThrow(EngineUnsupportedError);
  });
});

describe("hasCameraAnalysis (the exercise library's AI badge)", () => {
  it("badges an exercise this build holds a runnable definition for", () => {
    expect(hasCameraAnalysis("squat")).toBe(true);
    expect(hasCameraAnalysis("chair_squat")).toBe(true);
  });

  it("does not badge an exercise with no definition at all", () => {
    // 55 of the 58 catalog rows are this case.
    expect(hasCameraAnalysis("bicep_curl")).toBe(false);
  });

  // T3 round 1, F1 — THE ASSERTION THAT DID NOT EXIST. `&& engineSupports(def)`
  // was deleted and all 45 tests stayed green, because every other badge test
  // injects a stub for this whole function and never reaches the I4 gate. A
  // definition can EXIST and still be unrunnable here, and badging it promises
  // camera grading that `startSet` refuses to start (the throw asserted above).
  it("does NOT badge a definition that needs a newer engine (I4)", () => {
    const future = { ...squatDef, minEngineVersion: "2.0.0" };
    expect(hasCameraAnalysis("squat", () => future)).toBe(false);
  });

  it("still badges when the definition's engine requirement is met", () => {
    // The control for the case above: same injection, satisfiable requirement.
    // Without this pair, "always false" would satisfy the assertion above.
    const ok = { ...squatDef, minEngineVersion: "1.0.0" };
    expect(hasCameraAnalysis("squat", () => ok)).toBe(true);
  });
});

describe("getDefinition", () => {
  it("resolves keys and declared aliases, null for unknown", () => {
    expect(getDefinition("squat")).toBe(squatDef);
    expect(getDefinition("squats")).toBe(squatDef); // §4 alias
    expect(getDefinition("bench_press")).toBeNull();
  });
});

describe("startSet lifecycle — replay a recorded golden", () => {
  it("counts the golden's expected reps and emits a §2.4 SetSummary", () => {
    const trace = parseTrace(
      readFileSync(join(import.meta.dirname, "__fixtures__/squat_goodform.jsonl"), "utf8"),
    );
    const set = startSet(getDefinition(trace.header.exercise), 1);

    const reps = [];
    set.onRep((e) => reps.push(e));
    // Feed each golden frame through the FULL adapter path: kp -> provider shape
    // -> landmarksToFrame -> processFrame, using the trace's own timestamps.
    for (const frame of trace.frames) {
      const landmarks = frame.kp.map(([x, y, z, visibility]) => ({ x, y, z, visibility }));
      set.feed(landmarks, frame.t);
    }
    const summary = set.end();

    expect(summary.reps).toBe(trace.header.expected.reps); // exact rep count (I2)
    expect(reps).toHaveLength(trace.header.expected.reps);
    expect(summary.exercise).toBe("squat");
    expect(summary.engineVersion).toBe("1.0.0");
    expect(summary.definitionVersion).toBe(squatDef.version);
    // avgFormScore lands in the trace's declared score range (§7.4).
    const [lo, hi] = trace.header.expected.scoreRange;
    expect(summary.avgFormScore).toBeGreaterThanOrEqual(lo);
    expect(summary.avgFormScore).toBeLessThanOrEqual(hi);
  });

  it("end() is idempotent (§3.9)", () => {
    const def = getDefinition("squat");
    const set = startSet(def, 1);
    set.feed([], 0);
    expect(set.end()).toBe(set.end());
  });
});
