// P1.2 — the harness proven against a scripted fake engine (Part 2 §7.4):
// every assertion type has a passing AND a failing case.
import { describe, expect, it } from "vitest";
import {
  HOLD_TOLERANCE_MS,
  TraceParseError,
  assertTrace,
  formatFailures,
  parseTrace,
  replay,
  serializeTrace,
} from "../src/index.js";
import { makeTrace, scriptedEngine } from "./fixtures.js";

const cleanScript = {
  repAtFrames: [10, 20],
  repScores: [90, 86],
  faultCounts: {},
};

describe("trace format (§7.1)", () => {
  it("round-trips serialize → parse", () => {
    const trace = makeTrace(5);
    const parsed = parseTrace(serializeTrace(trace));
    expect(parsed.header).toEqual(trace.header);
    expect(parsed.frames).toEqual(trace.frames);
  });
  it("rejects malformed header, bad frames, wrong kp count, empty file", () => {
    expect(() => parseTrace("")).toThrow(TraceParseError);
    expect(() => parseTrace('{"traceVersion":2}')).toThrow(/traceVersion/);
    const good = serializeTrace(makeTrace(2));
    expect(() => parseTrace(good + '{"t":1}\n')).toThrow(/frame must be/);
    const trace = makeTrace(1);
    trace.frames[0]?.kp.pop();
    expect(() => parseTrace(serializeTrace(trace))).toThrow(/expected 33/);
  });
});

describe("assertions (§7.4)", () => {
  it("clean trace with matching behavior → zero failures", () => {
    const trace = makeTrace(30);
    const result = replay(scriptedEngine(cleanScript), trace);
    expect(assertTrace(trace, result)).toEqual([]);
  });

  it("rep over-count fails EXACTLY and names the first divergent frame", () => {
    const trace = makeTrace(30); // expected.reps = 2
    const result = replay(
      scriptedEngine({ ...cleanScript, repAtFrames: [5, 10, 15], repScores: [90, 86, 88] }),
      trace,
    );
    const failures = assertTrace(trace, result);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.kind).toBe("reps");
    // 3rd rep credited at frame index 15 → first frame with repCount>2 is #16 (1-based)
    expect(failures[0]?.firstDivergentFrame).toBe(16);
    expect(formatFailures(trace.header.label, failures)).toMatch(/first divergent frame: 16/);
  });

  it("rep under-count fails (divergence = end of trace)", () => {
    const trace = makeTrace(30);
    const result = replay(scriptedEngine({ ...cleanScript, repAtFrames: [10] }), trace);
    const failures = assertTrace(trace, result);
    expect(failures[0]?.kind).toBe("reps");
    expect(failures[0]?.firstDivergentFrame).toBe(30);
  });

  it("fault multiset: exact — extra fault fails a clean trace, scripted fault must match count", () => {
    const trace = makeTrace(30);
    const dirty = replay(
      scriptedEngine({ ...cleanScript, faultCounts: { knee_valgus: 1 } }),
      trace,
    );
    expect(assertTrace(trace, dirty).map((f) => f.kind)).toContain("faults");

    const faultTrace = makeTrace(30, {
      expected: {
        reps: 2,
        faultsExact: { shallow_depth: 2 },
        scoreRange: [40, 80],
        formCorrectAll: false,
      },
    });
    const rightFaults = replay(
      scriptedEngine({ repAtFrames: [10, 20], repScores: [60, 62], faultCounts: { shallow_depth: 2 } }),
      faultTrace,
    );
    expect(assertTrace(faultTrace, rightFaults)).toEqual([]);
    const wrongCount = replay(
      scriptedEngine({ repAtFrames: [10, 20], repScores: [60, 62], faultCounts: { shallow_depth: 1 } }),
      faultTrace,
    );
    expect(assertTrace(faultTrace, wrongCount).map((f) => f.kind)).toContain("faults");
  });

  it("score outside declared scoreRange fails; inside passes", () => {
    const trace = makeTrace(30); // range [80, 95]
    const low = replay(
      scriptedEngine({ ...cleanScript, repScores: [50, 52] }),
      trace,
    );
    expect(assertTrace(trace, low).map((f) => f.kind)).toContain("score");
  });

  it("hold time: within ±700 ms passes, outside fails", () => {
    const holdTrace = makeTrace(30, {
      expected: {
        reps: 0,
        faultsExact: {},
        scoreRange: [0, 100],
        formCorrectAll: true,
        holdMs: 30000,
      },
    });
    const near = replay(
      scriptedEngine({ repAtFrames: [], repScores: [], faultCounts: {}, holdMs: 30000 + HOLD_TOLERANCE_MS }),
      holdTrace,
    );
    expect(assertTrace(holdTrace, near)).toEqual([]);
    const far = replay(
      scriptedEngine({ repAtFrames: [], repScores: [], faultCounts: {}, holdMs: 30000 + HOLD_TOLERANCE_MS + 1 }),
      holdTrace,
    );
    expect(assertTrace(holdTrace, far).map((f) => f.kind)).toContain("hold");
  });

  it("phase sequence: matching order passes, divergence names the frame", () => {
    const seqTrace = makeTrace(9, {
      expected: {
        reps: 0,
        faultsExact: {},
        scoreRange: [0, 100],
        formCorrectAll: true,
        phaseSequence: ["idle", "descent", "ascent"],
      },
    });
    const phases = ["idle", "idle", "idle", "descent", "descent", "descent", "ascent", "ascent", "ascent"];
    const ok = replay(
      scriptedEngine({ repAtFrames: [], repScores: [], faultCounts: {}, phaseByFrame: (i) => phases[i] ?? "ascent" }),
      seqTrace,
    );
    expect(assertTrace(seqTrace, ok)).toEqual([]);
    const badPhases = ["idle", "idle", "ascent", "descent"];
    const bad = replay(
      scriptedEngine({ repAtFrames: [], repScores: [], faultCounts: {}, phaseByFrame: (i) => badPhases[i] ?? "descent" }),
      seqTrace,
    );
    const failures = assertTrace(seqTrace, bad);
    expect(failures[0]?.kind).toBe("phaseSequence");
    expect(failures[0]?.firstDivergentFrame).toBe(3);
  });
});
