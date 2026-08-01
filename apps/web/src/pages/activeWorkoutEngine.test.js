import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { CATALOG_58, setSummarySchema, slugForLegacyName } from "@app/shared";
import {
  accumulateSummary,
  averageFormScore,
  buildLogOnlySet,
  createSummaryLog,
  recordLogOnlySet,
} from "./activeWorkoutEngine.js";

const summary = (over = {}) => ({
  exercise: "squat",
  setIndex: 1,
  reps: 2,
  repScores: [90, 80],
  ...over,
});

describe("accumulateSummary", () => {
  it("collects summaries in order and flattens rep scores across sets", () => {
    const log = createSummaryLog();
    accumulateSummary(log, summary({ setIndex: 1 }));
    accumulateSummary(log, summary({ setIndex: 2, repScores: [70] }));
    expect(log.summaries.map((s) => s.setIndex)).toEqual([1, 2]);
    expect(log.repScores).toEqual([90, 80, 70]);
  });

  it("skips log-only sets (null summary, Part 6 §3.6)", () => {
    const log = createSummaryLog();
    accumulateSummary(log, null);
    expect(log.summaries).toEqual([]);
    expect(log.repScores).toEqual([]);
  });

  it("a zero-rep engine summary is recorded but contributes no scores", () => {
    const log = createSummaryLog();
    accumulateSummary(log, summary({ reps: 0, repScores: [] }));
    expect(log.summaries).toHaveLength(1);
    expect(log.repScores).toEqual([]);
  });

  it("clamps rep scores to 0–100", () => {
    const log = createSummaryLog();
    accumulateSummary(log, summary({ repScores: [104, -3, 88.6] }));
    expect(log.repScores).toEqual([100, 0, 89]);
  });
});

describe("averageFormScore", () => {
  it("averages every scored rep across sets, rounded", () => {
    // Distinct set ordinals, because that is what "across sets" means. This
    // fixture used to leave both at the default setIndex 1 — harmless while
    // accumulate blindly pushed, but two entries under one ordinal is the
    // duplicate the wire contract rejects, so the log now treats the second as
    // a replacement. The test was describing a workout that cannot exist.
    const log = createSummaryLog();
    accumulateSummary(log, summary({ setIndex: 1, repScores: [90, 80] }));
    accumulateSummary(log, summary({ setIndex: 2, repScores: [70] }));
    expect(averageFormScore(log)).toBe(80);
  });

  it("a replaced set takes its rep scores with it", () => {
    // The other half of that change (T3 round 1, F4): splicing the summary but
    // leaving its scores behind would let a discarded set go on skewing the
    // workout average.
    const log = createSummaryLog();
    accumulateSummary(log, summary({ setIndex: 1, repScores: [0, 0] }));
    accumulateSummary(log, summary({ setIndex: 1, repScores: [100] }));
    expect(log.summaries).toHaveLength(1);
    expect(log.repScores).toEqual([100]);
    expect(averageFormScore(log)).toBe(100);
  });

  it("is null when nothing was scored (UI shows —)", () => {
    expect(averageFormScore(createSummaryLog())).toBeNull();
  });

  it("stays null for a workout of hand-counted sets — reps are not a score", () => {
    const log = createSummaryLog();
    recordLogOnlySet(log, handLogged());
    expect(log.summaries).toHaveLength(1);
    expect(averageFormScore(log)).toBeNull();
  });
});

const handLogged = (over = {}) => ({
  exerciseName: "Push-ups",
  setIndex: 1,
  reps: 12,
  durationMs: 44_000,
  ...over,
});

describe("buildLogOnlySet", () => {
  it("builds a set the shared wire contract accepts", () => {
    const result = buildLogOnlySet(handLogged());
    expect(result.kind).toBe("set");
    // Parsed against the REAL contract, not a copy of it: a set this function
    // builds but the server would reject is the failure worth catching.
    const parsed = setSummarySchema.parse(result.set);
    expect(parsed).toEqual(result.set);
    expect(result.set.exercise).toBe("push_up");
    expect(result.set.reps).toBe(12);
    expect(result.set.durationMs).toBe(44_000);
    expect(result.set.mode).toBe("log_only");
  });

  it("claims nothing about form — every scoring field is empty", () => {
    const { set } = buildLogOnlySet(handLogged());
    expect(set.avgFormScore).toBeNull();
    expect(set.repScores).toBeNull();
    expect(set.faultCounts).toEqual({});
    expect(set.engineVersion).toBeNull();
    expect(set.definitionVersion).toBeNull();
    expect(set.view).toBe("unknown");
  });

  it("drops a set nobody performed rather than sending 0 reps", () => {
    expect(buildLogOnlySet(handLogged({ reps: 0 })).kind).toBe("empty");
  });

  it("reports an exercise with no catalog row instead of inventing a slug", () => {
    const result = buildLogOnlySet(handLogged({ exerciseName: "Arnold Shoulder Press" }));
    expect(result).toEqual({
      kind: "unresolved-exercise",
      exerciseName: "Arnold Shoulder Press",
    });
  });

  it("never lowercases its way to a slug — the names are plural, the slugs singular", () => {
    // "Squats" → "squat". A mechanical rule gives "squats", which is not a row,
    // and a caller that shipped it would have its sets discarded server-side.
    expect(buildLogOnlySet(handLogged({ exerciseName: "Squats" })).set.exercise).toBe("squat");
    expect(slugForLegacyName("squats")).toBeNull();
  });

  it("treats a missing name as unresolved, not as a crash", () => {
    expect(buildLogOnlySet(handLogged({ exerciseName: undefined })).kind)
      .toBe("unresolved-exercise");
  });

  it("an EMPTY set of an uncatalogued exercise is just empty, not a veto", () => {
    // Reps are checked BEFORE the name, deliberately: a set nobody performed
    // must not stop the rest of a real workout from syncing just because the
    // exercise it was never done for has no catalog row. The ordering was
    // untested — reversing it left every test green. T3 round 2, F-4/N15.
    expect(buildLogOnlySet(handLogged({ exerciseName: "Arnold Shoulder Press", reps: 0 })))
      .toEqual({ kind: "empty" });
  });

  it("keeps a stray rep count inside the column's range", () => {
    // A value the smallint column rejects would fail the contract and park the
    // whole workout. Unreachable by tapping, pinned anyway. T3 round 2, F-4/N17.
    expect(buildLogOnlySet(handLogged({ reps: 40_000 })).set.reps).toBe(32_767);
    expect(buildLogOnlySet(handLogged({ reps: 2.6 })).set.reps).toBe(3);
  });

  it("keeps a stray clock reading inside the column's range", () => {
    // A clock that jumps backwards must not produce a negative duration, which
    // the contract rejects — that would park a real workout.
    expect(buildLogOnlySet(handLogged({ durationMs: -5000 })).set.durationMs).toBe(0);
    expect(buildLogOnlySet(handLogged({ durationMs: 1.6 })).set.durationMs).toBe(2);
    expect(buildLogOnlySet(handLogged({ durationMs: Number.NaN })).set.durationMs).toBe(0);
  });

  it("EVERY exercise in the REAL library builds a valid set — all 58", () => {
    // Read from `scripts/seed_exercises.py`, the library that actually feeds the
    // exercise picker — NOT from CATALOG_58.
    //
    // The first version of this test fed CATALOG_58's own names into
    // slugForLegacyName, whose lookup map is BUILT FROM CATALOG_58. It could not
    // fail for any table content, while its comment called it "the card's
    // central premise, asserted rather than believed" and syncClient.js cited it
    // as proof. A list checked against itself. T3 round 2, F-2.
    //
    // Reading the real file means a rename on either side fails here, loudly,
    // instead of silently stopping that exercise's workouts from ever syncing.
    const py = readFileSync(
      new URL("../../../../scripts/seed_exercises.py", import.meta.url),
      "utf8",
    );
    const libraryNames = [...py.matchAll(/"name":\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(libraryNames).toHaveLength(58); // the file is the source of the count too

    const failures = libraryNames.filter((name) => {
      const result = buildLogOnlySet(handLogged({ exerciseName: name }));
      return result.kind !== "set" || !setSummarySchema.safeParse(result.set).success;
    });
    expect(failures).toEqual([]);

    // And nothing in the table is unreachable from the library, which would mean
    // a catalog row no user can ever produce.
    const orphans = CATALOG_58.map((r) => r.legacyName).filter(
      (n) => !libraryNames.includes(n),
    );
    expect(orphans).toEqual([]);
  });
});

describe("recordLogOnlySet", () => {
  it("files the set on the log", () => {
    const log = createSummaryLog();
    expect(recordLogOnlySet(log, handLogged()).kind).toBe("set");
    expect(log.summaries.map((s) => s.setIndex)).toEqual([1]);
  });

  it("is idempotent per set ordinal — the four set-end paths overlap by design", () => {
    const log = createSummaryLog();
    recordLogOnlySet(log, handLogged({ reps: 12 }));
    const second = recordLogOnlySet(log, handLogged({ reps: 99 }));
    expect(second.kind).toBe("duplicate");
    expect(log.summaries).toHaveLength(1);
    expect(log.summaries[0].reps).toBe(12);
  });

  it("records an unresolved name so the caller can refuse the whole workout", () => {
    const log = createSummaryLog();
    recordLogOnlySet(log, handLogged({ exerciseName: "1 Leg Box Squat" }));
    expect(log.summaries).toEqual([]);
    expect(log.unresolved).toEqual(["1 Leg Box Squat"]);
  });

  it("records an unresolved name ONCE even when the set is captured twice", () => {
    // The duplicate guard reads `summaries`, which an unresolved set never
    // reaches — so the overlapping set-end paths recorded the name once each
    // and the console line repeated it. T3 round 1, F3.
    const log = createSummaryLog();
    recordLogOnlySet(log, handLogged({ exerciseName: "Arnold Shoulder Press" }));
    recordLogOnlySet(log, handLogged({ exerciseName: "Arnold Shoulder Press" }));
    expect(log.unresolved).toEqual(["Arnold Shoulder Press"]);
  });

  it("an empty set leaves the workout syncable — it is not a failure", () => {
    const log = createSummaryLog();
    recordLogOnlySet(log, handLogged({ reps: 0 }));
    expect(log.summaries).toEqual([]);
    expect(log.unresolved).toEqual([]);
  });

  it("an engine summary WINS a set ordinal a hand-counted set already holds", () => {
    // Two entries under one setIndex fail the contract's duplicate check and
    // park the whole workout. The engine's entry carries real measurement.
    const log = createSummaryLog();
    recordLogOnlySet(log, handLogged({ setIndex: 3 }));
    accumulateSummary(log, summary({ setIndex: 3, reps: 7 }));
    expect(log.summaries).toHaveLength(1);
    expect(log.summaries[0].reps).toBe(7);
  });
});
