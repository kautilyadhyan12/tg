// P1.1 — schema contract tests (Part 2 §2, v1 §5.3).
import { describe, expect, it } from "vitest";
import {
  KEYPOINT_COUNT,
  KP,
  VISIBILITY_THRESHOLD,
  frameResultSchema,
  holdEventSchema,
  poseFrameSchema,
  repEventSchema,
  sessionInputSchema,
  setSummarySchema,
  workoutSyncPayloadSchema,
} from "../src/index.js";

const kp33 = Array.from({ length: 33 }, () => [0.5, 0.5, 0, 0.9]);

const validSetSummary = {
  exercise: "squat",
  setIndex: 1,
  reps: 12,
  durationMs: 48000,
  avgFormScore: 84,
  repScores: [90, 88, 76],
  faultCounts: { shallow_depth: 2, knee_valgus: 1 },
  tempoMsAvg: 3900,
  romStats: { metricMinAvg: 96 },
  view: "side",
  holdMs: null,
  calibration: { usedStandingBaseline: true, chairDepthTarget: null },
  engineVersion: "1.0.0",
  definitionVersion: 5,
};

describe("PoseFrame (§2.1)", () => {
  it("accepts a valid 33-keypoint frame", () => {
    expect(poseFrameSchema.parse({ t: 123456.7, kp: kp33 })).toBeDefined();
  });
  it("rejects wrong keypoint count", () => {
    expect(poseFrameSchema.safeParse({ t: 0, kp: kp33.slice(0, 32) }).success).toBe(false);
  });
  it("rejects vis outside [0,1] and negative t", () => {
    const bad = [...kp33.slice(0, 32), [0.5, 0.5, 0, 1.5]];
    expect(poseFrameSchema.safeParse({ t: 0, kp: bad }).success).toBe(false);
    expect(poseFrameSchema.safeParse({ t: -1, kp: kp33 }).success).toBe(false);
  });
  it("rejects unknown keys (strict)", () => {
    expect(poseFrameSchema.safeParse({ t: 0, kp: kp33, extra: 1 }).success).toBe(false);
  });
  it("index map matches the §2.1 table and vis threshold is 0.3", () => {
    expect(KP.nose).toBe(0);
    expect(KP.left_shoulder).toBe(11);
    expect(KP.right_shoulder).toBe(12);
    expect(KP.left_hip).toBe(23);
    expect(KP.right_knee).toBe(26);
    expect(KP.right_foot_index).toBe(32);
    expect(Object.keys(KP)).toHaveLength(KEYPOINT_COUNT);
    expect(VISIBILITY_THRESHOLD).toBe(0.3);
  });
});

describe("engine events (§2.4)", () => {
  it("FrameResult round-trips with nullable liveCue", () => {
    const fr = {
      phase: "descent",
      repCount: 3,
      isActive: true,
      view: "side",
      visibilityOk: true,
      liveCue: null,
      signals: { knee_angle: 92.4 },
      calibrationState: "ready",
    };
    expect(frameResultSchema.parse(fr)).toEqual(fr);
  });
  it("RepEvent rejects out-of-range score", () => {
    const re = {
      repIndex: 1,
      score: 101,
      faults: [],
      durationMs: 4000,
      phaseTimings: { descent: 1500, bottom: 500, ascent: 2000 },
      romExtreme: 96,
      view: "side",
    };
    expect(repEventSchema.safeParse(re).success).toBe(false);
    expect(repEventSchema.safeParse({ ...re, score: 100 }).success).toBe(true);
  });
  it("HoldEvent accepts an ended-hold summary", () => {
    expect(
      holdEventSchema.parse({ totalQualifyingMs: 30000, longestContiguousMs: 21000, endedAtMs: 61000 }),
    ).toBeDefined();
  });
  it("SetSummary parses the §2.4 document verbatim", () => {
    expect(setSummarySchema.parse(validSetSummary)).toEqual(validSetSummary);
  });
  it("SetSummary rejects fractional reps and unknown keys", () => {
    expect(setSummarySchema.safeParse({ ...validSetSummary, reps: 1.5 }).success).toBe(false);
    expect(setSummarySchema.safeParse({ ...validSetSummary, bonus: 1 }).success).toBe(false);
  });
});

describe("session input (§2.3)", () => {
  it("accepts a schema-valid definition + optional calibration carry-over", () => {
    expect(
      sessionInputSchema.parse({
        definition: {
          key: "brisk_walking",
          version: 1,
          minEngineVersion: "1.0.0",
          family: "cardio",
          tracking: "timer",
          status: "beta",
        },
        carryOverCalibration: { standingBaseline: 0.42 },
      }),
    ).toBeDefined();
  });
  it("rejects a malformed definition (P1.7 tightening of the P1.1 unknown)", () => {
    expect(
      sessionInputSchema.safeParse({ definition: { anything: "no longer accepted" } }).success,
    ).toBe(false);
  });
});

describe("workout sync payload (v1 §5.3)", () => {
  const payload = {
    workoutId: "7d9f8e1c-3b2a-4c5d-9e8f-1a2b3c4d5e6f",
    startedAt: "2026-07-07T10:00:00+05:30",
    platform: "web",
    engineVersion: "1.0.0",
    defsVersion: 1,
    sets: [validSetSummary],
    traceSample: null,
  };
  it("accepts a full payload with §2.4 sets", () => {
    expect(workoutSyncPayloadSchema.parse(payload)).toBeDefined();
  });
  it("rejects a non-uuid workoutId (idempotency key integrity)", () => {
    expect(workoutSyncPayloadSchema.safeParse({ ...payload, workoutId: "wk-1" }).success).toBe(false);
  });
  it("rejects unknown platform and unknown keys", () => {
    expect(workoutSyncPayloadSchema.safeParse({ ...payload, platform: "tv" }).success).toBe(false);
    expect(workoutSyncPayloadSchema.safeParse({ ...payload, extra: true }).success).toBe(false);
  });
});
