import { describe, it, expect } from "vitest";
import {
  accumulateSummary,
  averageFormScore,
  createSummaryLog,
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
    const log = createSummaryLog();
    accumulateSummary(log, summary({ repScores: [90, 80] }));
    accumulateSummary(log, summary({ repScores: [70] }));
    expect(averageFormScore(log)).toBe(80);
  });

  it("is null when nothing was scored (UI shows —)", () => {
    expect(averageFormScore(createSummaryLog())).toBeNull();
  });
});
