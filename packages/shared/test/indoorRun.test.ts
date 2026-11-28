// An indoor run's numbers from the phone's step counts (ROADMAP Stage 5 job 37q-i). The first block is the job's worst
// thing: a treadmill's distance typed ten times too big (54 for 5.4 km) taken as somebody's run. Then the step's length
// against what was measured on real people, what a treadmill teaches, and the run's numbers from counts as a phone
// hands them over: steadily, in bursts, out of order, starting again, during a pause, or not at all.
import { describe, expect, it } from "vitest";
import {
  HEIGHT_UNKNOWN_CM,
  INDOOR_MOST_STEPS,
  LEARN_FROM_M,
  MOST_STEPS_PER_S,
  RUN_MAX_POINTS,
  RUN_STEP_OF_HEIGHT,
  STEP_FACTOR_MOST,
  STEPS_JUDGE_FROM_M,
  TREADMILL_MOST_M,
  WALK_STEP_OF_HEIGHT,
  indoorSums,
  learnsFrom,
  recordSpeed,
  saveRunRequestSchema,
  stepBasisOf,
  stepFactor,
  stepLengthAt,
  treadmillTaken,
  type IndoorCount,
  type StepBasis,
} from "../src/index.js";

/** A phone's counts once a second for `seconds`, stepping `perMinute` times a minute, from `fromS` and `fromSteps`. */
function steady(seconds: number, perMinute: number, fromS = 0, fromSteps = 0): IndoorCount[] {
  const out: IndoorCount[] = [];
  for (let i = 1; i <= seconds; i++) out.push([(fromS + i) * 1000, Math.round(fromSteps + (i * perMinute) / 60)]);
  return out;
}

const PERSON: StepBasis = { heightCm: 175, factor: 1 };

describe("the worst thing: a treadmill's distance typed ten times too big, taken as the run's", () => {
  // Walks to fast running, for ten minutes to three hours: whatever was really run, the same typed ten times over is
  // faster than anybody has ever kept up for that long, and is never taken. What was really run always is.
  const speeds = [1.05, 1.2, 1.4, 2.0, 2.5, 3.0, 3.3, 4.0, 5.0];
  const minutes = [10, 20, 30, 45, 60, 90, 120, 180];
  const cases = speeds.flatMap((mps) => minutes.map((min) => ({ mps, min })));
  it.each(cases)("$mps m/s for $min minutes: the true distance is taken, ten times it is not", ({ mps, min }) => {
    const movingS = min * 60;
    const trueM = Math.round(mps * movingS);
    expect(treadmillTaken(trueM, movingS)).toBe(true);
    expect(treadmillTaken(trueM * 10, movingS)).toBe(false);
    expect(treadmillTaken(trueM * 100, movingS)).toBe(false);
  });

  // The same with the steps the phone counted near the truth (seven tenths to 1.4 times it), and the run left going on
  // the treadmill six times as long before Finish was pressed: ten times the true distance is never taken (round one, H3).
  const left = cases.flatMap((c) => [0.7, 1, 1.4].map((near) => ({ ...c, near })));
  it.each(left)("$mps m/s for $min minutes, steps at $near of it, left going six times as long: ten times is refused", ({ mps, min, near }) => {
    const trueM = mps * min * 60;
    expect(treadmillTaken(Math.round(trueM * 10), min * 60 * 6, trueM * near)).toBe(false);
    expect(treadmillTaken(Math.round(trueM), min * 60, trueM * near)).toBe(true);
  });

  it("Finish forgotten on a treadmill for two and a half hours, 5.4 typed as 54: the run keeps its steps' distance", () => {
    const counts = steady(1800, 165);
    const sums = indoorSums(counts, [], 1_800_000 + 9_000_000, 60, PERSON, 54_000);
    expect(sums.distanceFrom).toBe("steps");
    expect(sums.distanceM).toBe(indoorSums(counts, [], 1_800_000, 60, PERSON, null).distanceM);
  });

  it("Maya's 5.4 km in 30 minutes typed as 54: the run keeps the distance her steps made", () => {
    const sums = indoorSums(steady(1800, 165), [], 1_800_000, 60, PERSON, 54_000);
    expect(sums.distanceFrom).toBe("steps");
    expect(sums.distanceM).toBe(sums.stepsM);
    expect(sums.distanceM).toBeLessThan(6000);
    // And typed as she meant it, it is hers.
    const right = indoorSums(steady(1800, 165), [], 1_800_000, 60, PERSON, 5400);
    expect(right.distanceFrom).toBe("treadmill");
    expect(right.distanceM).toBe(5400);
  });

  it("where only the time can judge: a phone that counted next to nothing, at under 0.6 m/s on average, typed ten times", () => {
    // Three hours at 0.5 m/s: ten times it is 5 m/s, under the record for three hours. With the steps of it, refused.
    expect(treadmillTaken(5400 * 10, 10_800)).toBe(true);
    expect(treadmillTaken(5400 * 10, 10_800, 5400)).toBe(false);
    expect(recordSpeed(10_800)).toBeGreaterThan(5);
  });

  it("the steps judge from STEPS_JUDGE_FROM_M (200 m), from a third to three times theirs", () => {
    expect(treadmillTaken(5000, 1800, STEPS_JUDGE_FROM_M - 1)).toBe(true);
    expect(treadmillTaken(5000, 1800, STEPS_JUDGE_FROM_M)).toBe(false);
    expect(treadmillTaken(3000, 1800, 1000)).toBe(true);
    expect(treadmillTaken(3001, 1800, 1000)).toBe(false);
    expect(treadmillTaken(1000, 1800, 3000)).toBe(true);
    expect(treadmillTaken(999, 1800, 3000)).toBe(false);
  });

  it("no distance, nothing, a negative, past the most, or no moving time: never taken", () => {
    expect(treadmillTaken(null, 1800)).toBe(false);
    expect(treadmillTaken(0, 1800)).toBe(false);
    expect(treadmillTaken(-5000, 1800)).toBe(false);
    expect(treadmillTaken(Number.NaN, 1800)).toBe(false);
    expect(treadmillTaken(TREADMILL_MOST_M + 1, 86_400)).toBe(false);
    expect(treadmillTaken(5000, 0)).toBe(false);
    expect(treadmillTaken(5000, Number.NaN)).toBe(false);
  });

  it("at the record for that long, taken; a metre over it, not", () => {
    const movingS = 1571;
    const atRecord = Math.floor(recordSpeed(movingS) * movingS);
    expect(treadmillTaken(atRecord, movingS)).toBe(true);
    expect(treadmillTaken(atRecord + 2, movingS)).toBe(false);
  });
});

describe("a step's length, against what was measured on people", () => {
  it("walking, a step is 0.41 to 0.45 of the walker's height (Scientific American)", () => {
    for (const cm of [150, 165, 175, 190]) {
      for (const perMinute of [90, 105, 120, 130]) {
        const share = stepLengthAt(perMinute, { heightCm: cm, factor: 1 }) / (cm / 100);
        expect(share).toBeGreaterThanOrEqual(0.41);
        expect(share).toBeLessThanOrEqual(0.45);
      }
    }
  });

  it("running on a treadmill, 46 % to 52 % of the runner's height (ISBS, 16 runners over 30 minutes)", () => {
    for (const cm of [150, 165, 175, 190]) {
      for (const perMinute of [150, 160, 170, 185]) {
        const share = stepLengthAt(perMinute, { heightCm: cm, factor: 1 }) / (cm / 100);
        expect(share).toBeGreaterThanOrEqual(0.46);
        expect(share).toBeLessThanOrEqual(0.52);
      }
    }
  });

  it("between a brisk walk and a jog the step grows a little at a time, never in one jump", () => {
    let before = stepLengthAt(125, PERSON);
    for (let perMinute = 126; perMinute <= 155; perMinute++) {
      const now = stepLengthAt(perMinute, PERSON);
      expect(now).toBeGreaterThanOrEqual(before);
      expect(now - before).toBeLessThan(0.006);
      before = now;
    }
    expect(stepLengthAt(130, PERSON)).toBeCloseTo(WALK_STEP_OF_HEIGHT * 1.75, 10);
    expect(stepLengthAt(150, PERSON)).toBeCloseTo(RUN_STEP_OF_HEIGHT * 1.75, 10);
  });

  it("a fast runner's step is longer than the height says, and their treadmill puts it right", () => {
    // Middle-distance athletes at 12 km/h stepped 2.70 times a second, 1.24 m a step (Leeds Beckett, eprint 11031); at
    // 1.80 m tall (the terminal's guess: the study's heights are not in its summary) the height alone says 0.88 m.
    const athlete: StepBasis = { heightCm: 180, factor: 1 };
    const plain = stepLengthAt(2.7 * 60, athlete);
    expect(plain).toBeLessThan(1.24 * 0.75);
    // Twenty minutes on the treadmill at 12 km/h: 4,000 m, and the steps of it.
    const sums = indoorSums(steady(1200, 162), [], 1_200_000, 70, athlete, 4000);
    expect(sums.distanceFrom).toBe("treadmill");
    const lesson = { treadmillM: 4000, plainM: sums.plainM };
    expect(learnsFrom(lesson)).toBe(true);
    const taught = stepFactor([lesson]).factor;
    expect(stepLengthAt(162, { ...athlete, factor: taught })).toBeCloseTo(4000 / sums.steps, 2);
  });
});

describe("what a treadmill teaches", () => {
  const lesson = (treadmillM: number, plainM: number) => ({ treadmillM, plainM });

  it("nothing yet: the height's own step", () => {
    expect(stepFactor([])).toEqual({ factor: 1, from: 0 });
  });

  it("one treadmill run teaches by how far it was from the steps", () => {
    expect(stepFactor([lesson(5400, 4500)])).toEqual({ factor: 1.2, from: 1 });
  });

  it("the middle of the newest five: one mistyped run does not move it, older ones are left", () => {
    const lessons = [lesson(5500, 5000), lesson(9000, 5000), lesson(5400, 5000), lesson(5600, 5000), lesson(5450, 5000), lesson(3000, 5000)];
    // The newest five are 1.1, 1.8, 1.08, 1.12, 1.09: their middle is 1.1. The sixth (0.6) is older and left.
    expect(stepFactor(lessons)).toEqual({ factor: 1.1, from: 5 });
    expect(stepFactor(lessons.slice(0, 2))).toEqual({ factor: (1.1 + 1.8) / 2, from: 2 });
  });

  it("a phone left on the treadmill, a short run, or a slip of the finger teaches nothing", () => {
    // The phone lay on the treadmill and counted 300 steps: 5 km is twenty times what they made.
    expect(learnsFrom(lesson(5000, 250))).toBe(false);
    // Under 1.5 km.
    expect(learnsFrom(lesson(LEARN_FROM_M - 1, LEARN_FROM_M - 1))).toBe(false);
    expect(learnsFrom(lesson(LEARN_FROM_M, LEARN_FROM_M))).toBe(true);
    // Half and twice are the edges; a hair past them is not.
    expect(learnsFrom(lesson(5000, 10_000))).toBe(true);
    expect(learnsFrom(lesson(5000, 10_001))).toBe(false);
    expect(learnsFrom(lesson(10_000, 5000))).toBe(true);
    expect(learnsFrom(lesson(10_001, 5000))).toBe(false);
    expect(learnsFrom(lesson(5000, 0))).toBe(false);
    // Whatever is learned stays inside the edges the server checks.
    expect(stepFactor([lesson(10_000, 5000)]).factor).toBeLessThanOrEqual(STEP_FACTOR_MOST);
    expect(stepFactor([lesson(5000, 250), lesson(1000, 1000)])).toEqual({ factor: 1, from: 0 });
  });

  it("a person with no height given, or one nobody has, is measured at 170 cm", () => {
    expect(stepBasisOf(null, [])).toEqual({ heightCm: HEIGHT_UNKNOWN_CM, heightKnown: false, factor: 1, learnedFrom: 0 });
    expect(stepBasisOf(17, []).heightCm).toBe(HEIGHT_UNKNOWN_CM);
    expect(stepBasisOf(400, []).heightKnown).toBe(false);
    expect(stepBasisOf(182.5, [lesson(5400, 4500)])).toEqual({ heightCm: 182.5, heightKnown: true, factor: 1.2, learnedFrom: 1 });
  });
});

describe("the run's numbers from its counts", () => {
  it("thirty minutes at 165 steps a minute: the steps, their distance, its kilometres and pace", () => {
    const sums = indoorSums(steady(1800, 165), [], 1_800_000, 70, PERSON, null);
    expect(sums.steps).toBe(4950);
    expect(sums.stepsM).toBe(Math.round(4950 * RUN_STEP_OF_HEIGHT * 1.75));
    expect(sums.distanceM).toBe(sums.stepsM);
    expect(sums.plainM).toBe(sums.stepsM);
    expect(sums.movingS).toBe(1800);
    expect(sums.elapsedS).toBe(1800);
    expect(sums.splitsKm.map((s) => s.m)).toEqual([1000, 1000, 1000, 1000, sums.distanceM - 4000]);
    expect(sums.splitsKm.reduce((t, s) => t + s.s, 0)).toBeCloseTo(1800, -1);
    expect(sums.paceLine.length).toBeGreaterThan(100);
    expect(sums.paceSpans).toHaveLength(sums.paceLine.length);
    expect(sums.kcal).toBeGreaterThan(200);
    // No route, no climb, no best efforts: never a record.
    expect(sums.track).toEqual([]);
    expect(sums.trackStarts).toEqual([]);
    expect(sums.bests).toEqual({ k1: null, mile: null, k5: null, k10: null });
  });

  it("the treadmill's distance is laid along the steps: kilometres add up to it, the plain guess is kept", () => {
    const plain = indoorSums(steady(1800, 165), [], 1_800_000, 70, PERSON, null);
    const sums = indoorSums(steady(1800, 165), [], 1_800_000, 70, PERSON, 5400);
    expect(sums.distanceM).toBe(5400);
    expect(sums.plainM).toBe(plain.plainM);
    expect(sums.splitsKm.reduce((t, s) => t + s.m, 0)).toBeCloseTo(5400, -1);
    expect(sums.splitsKm).toHaveLength(6);
  });

  it("a person's own factor makes their steps longer, but the plain guess stays the height's", () => {
    const sums = indoorSums(steady(1800, 165), [], 1_800_000, 70, { heightCm: 175, factor: 1.2 }, null);
    const plain = indoorSums(steady(1800, 165), [], 1_800_000, 70, PERSON, null);
    expect(sums.stepsM).toBe(Math.round(plain.stepsM * 1.2));
    expect(Math.abs(sums.plainM - plain.plainM)).toBeLessThanOrEqual(1);
  });

  it("walking round the house at 110 steps a minute takes a walking step", () => {
    const sums = indoorSums(steady(600, 110), [], 600_000, 70, PERSON, null);
    expect(sums.steps).toBe(1100);
    expect(sums.distanceM).toBe(Math.round(1100 * WALK_STEP_OF_HEIGHT * 1.75));
  });

  it("five minutes' walk then ten minutes' run: each part at its own step", () => {
    const walk = steady(300, 110);
    const run = steady(600, 165, 300, 550);
    const sums = indoorSums([...walk, ...run], [], 900_000, 70, PERSON, null);
    const apart = 550 * WALK_STEP_OF_HEIGHT * 1.75 + 1650 * RUN_STEP_OF_HEIGHT * 1.75;
    expect(Math.abs(sums.distanceM - apart) / apart).toBeLessThan(0.01);
  });

  it("counts handed over every ten seconds, or late in a burst, read as the steady stepping they were", () => {
    const every = steady(1800, 165);
    const tens = every.filter(([at]) => at % 10_000 === 0);
    const late: IndoorCount[] = [...every.slice(0, 2), ...every.slice(12)];
    const base = indoorSums(every, [], 1_800_000, 70, PERSON, null).distanceM;
    expect(Math.abs(indoorSums(tens, [], 1_800_000, 70, PERSON, null).distanceM - base)).toBeLessThanOrEqual(2);
    expect(Math.abs(indoorSums(late, [], 1_800_000, 70, PERSON, null).distanceM - base)).toBeLessThanOrEqual(2);
  });

  it("out of order or twice at one moment: the same run", () => {
    const counts = steady(600, 165);
    const base = indoorSums(counts, [], 600_000, 70, PERSON, null);
    const shuffled = [...counts].reverse();
    expect(indoorSums(shuffled, [], 600_000, 70, PERSON, null)).toEqual(base);
    const twice = counts.flatMap((c, i) => (i % 50 === 0 ? [c, c] : [c]));
    expect(indoorSums(twice, [], 600_000, 70, PERSON, null)).toEqual(base);
  });

  it("a count lower than one before adds nothing: a step lower at once, half a second on, or none at all", () => {
    // Round one, H1: a walk of 3,300 steps with one count a step lower at 15 minutes was saved as 4,952 steps.
    const walk = steady(1800, 110);
    const base = indoorSums(walk, [], 1_800_000, 70, PERSON, null);
    const at = (i: number): IndoorCount => walk[i] ?? [0, 0];
    const lower = (c: IndoorCount, laterMs: number, steps: number): IndoorCount => [c[0] + laterMs, steps];
    const glitches: IndoorCount[][] = [
      [...walk.slice(0, 900), lower(at(899), 0, at(899)[1] - 1), ...walk.slice(900)],
      [...walk.slice(0, 900), lower(at(899), 500, at(899)[1] - 1), ...walk.slice(900)],
      [...walk.slice(0, 900), lower(at(899), 500, 0), ...walk.slice(900)],
    ];
    for (const counts of glitches) {
      const sums = indoorSums(counts, [], 1_800_000, 70, PERSON, null);
      expect(sums.steps).toBe(3300);
      expect(Math.abs(sums.distanceM - base.distanceM)).toBeLessThanOrEqual(1);
    }
  });

  it("steps during a pause are not the run's, nor its time", () => {
    const counts = steady(900, 165);
    const sums = indoorSums(counts, [[300_000, 600_000]], 900_000, 70, PERSON, null);
    expect(sums.movingS).toBe(600);
    expect(sums.steps).toBe(1650);
  });

  it("a count at Start, past Finish, or more steps than anybody takes: none of it is made up", () => {
    const atStart: IndoorCount[] = [[0, 40], ...steady(60, 165, 0, 40)];
    expect(indoorSums(atStart, [], 60_000, 70, PERSON, null).steps).toBe(165);
    // Round one, H2: the steps counted after Finish (the walk to the changing room) are none of the run's.
    const past: IndoorCount[] = [...steady(60, 165), [60_001, 166], [240_000, 495], [3_600_000, 99_999]];
    expect(indoorSums(past, [], 60_000, 70, PERSON, null).steps).toBe(165);
    const shaken: IndoorCount[] = [[60_000, INDOOR_MOST_STEPS]];
    const sums = indoorSums(shaken, [], 60_000, 70, PERSON, null);
    expect(sums.steps).toBe(MOST_STEPS_PER_S * 60);
    expect(sums.distanceM / 60).toBeLessThanOrEqual(recordSpeed(60));
  });

  it("a phone that counted nothing: the treadmill's distance, with no made-up kilometres or pace", () => {
    const sums = indoorSums([], [], 1_800_000, 70, PERSON, 5000);
    expect(sums.distanceM).toBe(5000);
    expect(sums.distanceFrom).toBe("treadmill");
    expect(sums.steps).toBe(0);
    expect(sums.plainM).toBe(0);
    expect(sums.splitsKm).toEqual([]);
    expect(sums.paceLine).toEqual([]);
    expect(sums.kcal).toBeGreaterThan(0);
    // With no treadmill either: no distance.
    expect(indoorSums([], [], 1_800_000, 70, PERSON, null).distanceM).toBe(0);
  });

  it("the phone and the server work it out the same: the same counts give the same numbers", () => {
    const counts = steady(1200, 158);
    expect(indoorSums(counts, [[100_000, 160_000]], 1_200_000, 64, PERSON, 3300)).toEqual(indoorSums(counts, [[100_000, 160_000]], 1_200_000, 64, PERSON, 3300));
  });
});

describe("what an indoor run may send", () => {
  const base = {
    runId: "6f1c2a7e-8b8d-4b8e-9d0e-0b1c2d3e4f50",
    startedAt: "2026-11-28T06:00:00.000Z",
    elapsedMs: 600_000,
    name: "Treadmill",
    effort: null,
    note: null,
    points: [],
    pauses: [],
  };

  it("its counts and the treadmill's distance, with no route", () => {
    expect(saveRunRequestSchema.safeParse({ ...base, indoor: { counts: steady(600, 165), treadmillM: 1800 } }).success).toBe(true);
    expect(saveRunRequestSchema.safeParse({ ...base, indoor: { counts: [], treadmillM: null } }).success).toBe(true);
    // A number too big to be anybody's is read, and not taken: the run is never refused for it.
    expect(saveRunRequestSchema.safeParse({ ...base, indoor: { counts: [], treadmillM: 900_000 } }).success).toBe(true);
  });

  it("never with points or still stretches, too many counts, or impossible ones", () => {
    const counts = steady(10, 165);
    expect(saveRunRequestSchema.safeParse({ ...base, points: [[0, 26.1, 91.7, 5]], indoor: { counts, treadmillM: null } }).success).toBe(false);
    expect(saveRunRequestSchema.safeParse({ ...base, still: [[0, 1000]], indoor: { counts, treadmillM: null } }).success).toBe(false);
    const many = Array.from({ length: RUN_MAX_POINTS + 1 }, (_, i): IndoorCount => [i, i]);
    expect(saveRunRequestSchema.safeParse({ ...base, elapsedMs: 86_400_000, indoor: { counts: many, treadmillM: null } }).success).toBe(false);
    expect(saveRunRequestSchema.safeParse({ ...base, indoor: { counts: [[1000, INDOOR_MOST_STEPS + 1]], treadmillM: null } }).success).toBe(false);
    expect(saveRunRequestSchema.safeParse({ ...base, indoor: { counts: [[1000, -1]], treadmillM: null } }).success).toBe(false);
    expect(saveRunRequestSchema.safeParse({ ...base, indoor: { counts: [[1000, 1.5]], treadmillM: null } }).success).toBe(false);
    expect(saveRunRequestSchema.safeParse({ ...base, indoor: { counts, treadmillM: -1 } }).success).toBe(false);
    expect(saveRunRequestSchema.safeParse({ ...base, indoor: { counts, treadmillM: 1.5 } }).success).toBe(false);
    expect(saveRunRequestSchema.safeParse({ ...base, indoor: { counts, treadmillM: null, extra: 1 } }).success).toBe(false);
  });
});
