// An indoor run's steps on the phone (37q-ii-a): the phone's own counter into the steps since Start, Auto-pause from the
// steps, and the steps a minute. The counter's readings are what Android's TYPE_STEP_COUNTER hands over: a total since the
// phone was last switched on, as a float (8016.0), whatever the person did before Start.
import { describe, expect, it } from "vitest";
import { HEIGHT_UNKNOWN_CM, INDOOR_MOST_STEPS, indoorSums } from "@app/shared";
import {
  STEP_PAUSE_MS,
  indoorPace,
  lastRiseAt,
  nextStepPause,
  stepsAMinute,
  stepsAt,
  tallyStep,
  type StepCount,
  type StepTally,
} from "../src/screens/running/indoorSteps";

const START: StepTally = { raw: null, steps: 0 };
const BASIS = { heightCm: 175, factor: 1 };

/** The counter's readings, one after another, the first of them `fresh` (the app had just begun listening). */
const tallyAll = (readings: readonly number[], from: StepTally = START, firstFresh = true): StepTally =>
  readings.reduce((t, raw, i) => tallyStep(t, raw, firstFresh && i === 0), from);

describe("the worst thing: the day's steps before Start are never the run's", () => {
  // The counter counts from when the phone was switched on: after a day it holds thousands, after weeks without a
  // restart hundreds of thousands, and none of them were walked in this run.
  it.each([
    ["a day's 8,016 steps", 8016],
    ["weeks without a restart", 412_377],
    ["a phone just switched on", 0],
    ["the most a day may hold", INDOOR_MOST_STEPS],
  ])("%s at Start: the run begins at 0 steps", (_name, atStart) => {
    expect(tallyAll([atStart]).steps).toBe(0);
    expect(tallyAll([atStart, atStart + 12]).steps).toBe(12);
  });

  it("a 10-minute walk after 8,016 steps that day is 1,100 steps and about 830 m, never 9,116 steps", () => {
    let tally = tallyStep(START, 8016, true);
    const counts: [number, number][] = [];
    // One reading a second for ten minutes, 110 steps a minute.
    for (let s = 1; s <= 600; s++) {
      tally = tallyStep(tally, 8016 + Math.floor((s * 110) / 60), false);
      counts.push([s * 1000, tally.steps]);
    }
    expect(tally.steps).toBe(1100);
    const sums = indoorSums(counts, [], 600_000, 70, BASIS, null);
    expect(sums.steps).toBe(1100);
    // 0.43 of 1.75 m a step at a walk: 828 m.
    expect(sums.distanceM).toBeGreaterThan(800);
    expect(sums.distanceM).toBeLessThan(860);
  });

  it("the first reading taken at Start adds nothing, however late it comes", () => {
    // A phone that hands its total over only at the first step: that step's reading is where the run begins.
    expect(tallyAll([8017, 8018, 8030]).steps).toBe(13);
  });
});

describe("the counter across the app being closed and the phone switched off and on", () => {
  it("the app closed for a while: the first reading after it adds the steps taken meanwhile", () => {
    const before = tallyAll([8016, 8416]);
    expect(before.steps).toBe(400);
    // Listening again (fresh), the counter has gone on to 9,016.
    expect(tallyAll([9016, 9020], before).steps).toBe(1004);
  });

  it("the phone switched off and on during the run: the counter starts again and every step since is the run's", () => {
    const before = tallyAll([8016, 12_966]);
    expect(before.steps).toBe(4950);
    // After the restart the counter reads 40, then goes on: nothing is lost (the re-check's Low B: 2,475 of 4,950 kept).
    const after = tallyAll([40, 2515], before);
    expect(after.steps).toBe(4950 + 2515);
  });

  it("a reading a little lower while listening is a slip of the counter's: it adds nothing, nor does the return to where it was", () => {
    const tally = tallyAll([8016, 8500, 8499, 8500, 8510]);
    expect(tally.steps).toBe(494);
  });

  it("a counter that fell to under half while listening started again (a phone that resets it): the steps since are the run's", () => {
    const tally = tallyAll([8016, 8500, 3, 30]);
    expect(tally.steps).toBe(484 + 30);
  });

  it("a reading that is no number, or below zero, is not taken", () => {
    expect(tallyAll([8016, Number.NaN, -1, Number.POSITIVE_INFINITY, 8020])).toEqual({ raw: 8020, steps: 4 });
  });

  it("the steps since Start never pass the most a day may hold", () => {
    expect(tallyAll([0, INDOOR_MOST_STEPS * 3]).steps).toBe(INDOOR_MOST_STEPS);
  });
});

/** A run's counts: steps rising by `perSecond` each second from `from` to `to` (ms), starting at `steps`. */
function walk(from: number, to: number, perSecond: number, steps = 0): StepCount[] {
  const out: StepCount[] = [];
  for (let at = from + 1000; at <= to; at += 1000) out.push([at, steps + Math.round(((at - from) / 1000) * perSecond)]);
  return out;
}

describe("Auto-pause indoors, from the steps", () => {
  const running = { phase: "running" as const, byPerson: false, autoPause: true, armed: true, pauseFrom: null, rose: false };

  it("pauses where the clock stands once no step has been counted for ten seconds", () => {
    const counts = walk(0, 60_000, 2);
    expect(nextStepPause({ ...running, counts, nowMs: 60_000 + STEP_PAUSE_MS - 1 })).toBeNull();
    expect(nextStepPause({ ...running, counts, nowMs: 60_000 + STEP_PAUSE_MS })).toEqual({ kind: "pause", at: 70_000 });
  });

  it("never pauses a run whose phone has counted no step since Start (lying on a treadmill)", () => {
    expect(nextStepPause({ ...running, armed: false, counts: [], nowMs: 30 * 60_000 })).toBeNull();
  });

  it("after Resume pressed with the phone put down, waits for steps again", () => {
    const counts = walk(0, 60_000, 2);
    expect(nextStepPause({ ...running, armed: false, counts, nowMs: 10 * 60_000 })).toBeNull();
  });

  it("never pauses with Auto-pause off, nor while steps keep coming", () => {
    const counts = walk(0, 600_000, 2.5);
    expect(nextStepPause({ ...running, autoPause: false, counts: walk(0, 60_000, 2), nowMs: 600_000 })).toBeNull();
    for (let now = 1000; now <= 600_000; now += 1000) {
      const seen = counts.filter(([at]) => at <= now);
      expect(nextStepPause({ ...running, counts: seen, nowMs: now })).toBeNull();
    }
  });

  it("a step after an Auto-pause starts the clock again where it stood, now: never from before, which made it jump ahead", () => {
    // Stopped at 60 s, paused at 70 s; at 95 s the counter hands over 4 steps, at 200 s a burst of 280.
    const counts: StepCount[] = [...walk(0, 60_000, 2), [70_000, 120]];
    const look = { phase: "paused" as const, byPerson: false, autoPause: true, armed: true, counts, pauseFrom: 70_000, rose: true, nowMs: 95_000 };
    expect(nextStepPause(look)).toEqual({ kind: "resume", at: 95_000 });
    expect(nextStepPause({ ...look, nowMs: 200_000 })).toEqual({ kind: "resume", at: 200_000 });
    // Never before the pause began.
    expect(nextStepPause({ ...look, nowMs: 60_000 })).toEqual({ kind: "resume", at: 70_000 });
  });

  it("paused by the person, steps never start it again; no step since the pause, it stays paused", () => {
    const counts: StepCount[] = [...walk(0, 60_000, 2), [70_000, 120]];
    expect(nextStepPause({ phase: "paused", byPerson: true, autoPause: true, armed: true, counts, pauseFrom: 70_000, rose: true, nowMs: 95_000 })).toBeNull();
    expect(nextStepPause({ phase: "paused", byPerson: false, autoPause: true, armed: true, counts, pauseFrom: 70_000, rose: false, nowMs: 95_000 })).toBeNull();
  });
});

describe("the counts' own reading", () => {
  it("the last rise is the last count higher than the one before; a count at a pause's edge is none", () => {
    expect(lastRiseAt([])).toBeNull();
    expect(lastRiseAt([[1000, 0]])).toBeNull();
    expect(lastRiseAt([[1000, 3], [2000, 3], [3000, 3]])).toBe(1000);
    expect(lastRiseAt([[1000, 3], [2000, 5], [9000, 5]])).toBe(2000);
  });

  it("the steps at a moment are those of the last count at or before it", () => {
    const counts: StepCount[] = [[1000, 3], [2000, 5], [9000, 8]];
    expect(stepsAt(counts, 0)).toBe(0);
    expect(stepsAt(counts, 2000)).toBe(5);
    expect(stepsAt(counts, 8999)).toBe(5);
    expect(stepsAt(counts, 20_000)).toBe(8);
  });
});

describe("steps a minute and current pace on the run's screen", () => {
  it("a steady 162 a minute reads 162, from the last ten seconds", () => {
    const counts = walk(0, 120_000, 2.7);
    expect(stepsAMinute(counts, 120_000)).toBe(162);
  });

  it("none before five seconds of counts; 0 once no step has come for ten seconds", () => {
    expect(stepsAMinute([], 5000)).toBeNull();
    expect(stepsAMinute(walk(0, 3000, 2), 3000)).toBeNull();
    expect(stepsAMinute(walk(0, 60_000, 2), 60_000 + STEP_PAUSE_MS)).toBe(0);
  });

  it("current pace from the cadence at the person's own step length; none while paused or standing", () => {
    // 162 a minute is past a run's cadence: 0.49 of 1.75 m, 0.8575 m a step, 138.9 m a minute: 7:12 a km.
    expect(indoorPace(162, true, BASIS, "metric")).toBe("7:12");
    expect(indoorPace(162, false, BASIS, "metric")).toBe("--:--");
    expect(indoorPace(0, true, BASIS, "metric")).toBe("--:--");
    expect(indoorPace(null, true, BASIS, "metric")).toBe("--:--");
    // With no height given, the shared guess, the same the server measures with.
    expect(indoorPace(110, true, { heightCm: HEIGHT_UNKNOWN_CM, factor: 1 }, "metric")).toBe("12:26");
  });
});
