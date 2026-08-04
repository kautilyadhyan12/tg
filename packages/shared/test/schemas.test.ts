// P1.1 — schema contract tests (Part 2 §2, v1 §5.3).
import { describe, expect, it } from "vitest";
import {
  KEYPOINT_COUNT,
  KP,
  VISIBILITY_THRESHOLD,
  frameResultSchema,
  holdEventSchema,
  instantSchema,
  poseFrameSchema,
  repEventSchema,
  sessionInputSchema,
  setSummarySchema,
  workoutListQuerySchema,
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

describe("instantSchema — a shape that parses is not an instant", () => {
  // Measured 2026-08-04: zod's `datetime({ offset: true })` admits an offset
  // whose HOUR component is above 23, and `Date` rejects exactly those. Every
  // schema carrying a caller-supplied offset instant goes through this, so the
  // hole is closed once rather than per field (the T3 on b80bd3c, F1).
  const syncPayload = {
    workoutId: "7d9f8e1c-3b2a-4c5d-9e8f-1a2b3c4d5e6f",
    startedAt: "2026-07-07T10:00:00+05:30",
    platform: "web",
    engineVersion: "1.0.0",
    defsVersion: 1,
    sets: [validSetSummary],
    traceSample: null,
  };

  it("rejects an offset no clock has, on the two sites that take one", () => {
    for (const bad of ["2026-07-01T00:00:00+25:30", "2026-07-01T00:00:00+99:00"]) {
      expect(instantSchema.safeParse(bad).success).toBe(false);
      // The two live users of it, asserted through the SCHEMAS rather than
      // trusted to share an import: an edit that inlines `datetime()` back into
      // either one fails here.
      expect(workoutListQuerySchema.safeParse({ from: bad }).success).toBe(false);
      expect(workoutSyncPayloadSchema.safeParse({ ...syncPayload, startedAt: bad }).success).toBe(false);
    }
  });

  it("still accepts the real ones — Z and a genuine offset", () => {
    // THE CONTROL. Without it the assertion above is satisfied by a schema that
    // rejects every date, which would break every client instead of one input.
    for (const good of ["2026-07-01T00:00:00Z", "2026-07-01T00:00:00.123Z", "2026-07-01T00:00:00+05:30"]) {
      expect(instantSchema.safeParse(good).success).toBe(true);
      expect(workoutListQuerySchema.safeParse({ from: good }).success).toBe(true);
    }
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
  // Part 4 §3.5 column-type bounds + upsert-key integrity (P1.10d T3): values
  // that would overflow PG smallint/int4, duplicate the (workout_id, set_index)
  // key, or create an empty engine workout must fail at the schema, not as a
  // server 500 (which the client's retry policy would treat as transient).
  it("rejects DDL overflows: setIndex/reps > smallint, durationMs > int4", () => {
    const withSet = (over: Record<string, number>) => ({
      ...payload,
      sets: [{ ...validSetSummary, ...over }],
    });
    expect(workoutSyncPayloadSchema.safeParse(withSet({ setIndex: 32768 })).success).toBe(false);
    expect(workoutSyncPayloadSchema.safeParse(withSet({ reps: 32768 })).success).toBe(false);
    expect(
      workoutSyncPayloadSchema.safeParse(withSet({ durationMs: 2_147_483_648 })).success,
    ).toBe(false);
  });
  it("rejects duplicate setIndex (would silently drop rows in the §3.5 upsert)", () => {
    const dup = { ...payload, sets: [validSetSummary, { ...validSetSummary }] };
    expect(workoutSyncPayloadSchema.safeParse(dup).success).toBe(false);
  });
  // R2-F4: the old title said "all-log-only workouts are never synced", citing
  // DECISIONS 2026-07-10. That bar was REINTERPRETED on 2026-08-01 — log-only
  // sets are expressible now, so an all-log-only workout satisfies this with
  // real sets. What it still forbids is a workout with no sets at all. The
  // source comment was rewritten in the same commit "so the next reader does
  // not restore the old meaning", while the assertion enforcing it kept that
  // meaning — the sweep stopped at the file being edited.
  it("rejects a workout with NO sets at all (DECISIONS 2026-08-01 reinterprets the 07-10 bar)", () => {
    expect(workoutSyncPayloadSchema.safeParse({ ...payload, sets: [] }).success).toBe(false);
  });

  // R2-F5: `packages/shared` OWNS this union and had zero cases for the
  // log-only branch — every assertion lived in api suites gated behind
  // `describe.skipIf(DATABASE_URL)`. Deleting `logOnlySetSummarySchema` left
  // this package's suite green. These run with no database.
  describe("the log-only branch (Part 6 §3.6; Kd-ruled 2026-08-01)", () => {
    const logOnlySet = {
      exercise: "squat",
      setIndex: 1,
      reps: 10,
      durationMs: 30_000,
      mode: "log_only",
      avgFormScore: null,
      repScores: null,
      faultCounts: {},
      tempoMsAvg: null,
      romStats: null,
      view: "unknown",
      holdMs: null,
      calibration: null,
      engineVersion: null,
      definitionVersion: null,
    };
    const withLogOnly = (extra: Record<string, unknown> = {}) => ({
      ...payload,
      sets: [{ ...logOnlySet, ...extra }],
    });

    it("accepts a hand-logged set", () => {
      expect(workoutSyncPayloadSchema.safeParse(withLogOnly()).success).toBe(true);
    });

    it("rejects repScores [] — the contract says NULL, exactly as the column does", () => {
      expect(workoutSyncPayloadSchema.safeParse(withLogOnly({ repScores: [] })).success).toBe(false);
    });

    it("rejects every form claim on a set nothing analysed", () => {
      for (const claim of [
        { avgFormScore: 90 },
        { repScores: [90, 91] },
        { faultCounts: { shallow_depth: 1 } },
        { engineVersion: "1.0.0" },
        { definitionVersion: 1 },
      ]) {
        expect(
          workoutSyncPayloadSchema.safeParse(withLogOnly(claim)).success,
          `${JSON.stringify(claim)} must not be storable on a log-only set`,
        ).toBe(false);
      }
    });

    it("still requires an ENGINE set to carry its provenance", () => {
      for (const missing of [{ engineVersion: null }, { definitionVersion: null }]) {
        const sets = [{ ...validSetSummary, ...missing }];
        expect(workoutSyncPayloadSchema.safeParse({ ...payload, sets }).success).toBe(false);
      }
    });

    it("accepts defsVersion null — a client with no bundle loaded has none to report", () => {
      expect(
        workoutSyncPayloadSchema.safeParse({ ...withLogOnly(), defsVersion: null }).success,
      ).toBe(true);
    });

    it("rejects an empty engineVersion at BOTH levels (an empty string is not a version)", () => {
      expect(
        workoutSyncPayloadSchema.safeParse({ ...payload, engineVersion: "" }).success,
      ).toBe(false);
      const sets = [{ ...validSetSummary, engineVersion: "" }];
      expect(workoutSyncPayloadSchema.safeParse({ ...payload, sets }).success).toBe(false);
    });
  });
});
