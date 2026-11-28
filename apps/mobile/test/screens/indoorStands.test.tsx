import { HEIGHT_UNKNOWN_CM } from "@app/shared";
import { phoneRunFiles, resetRecorder, runNow, runStepsOf, startRun, takeSteps, movingMsOf, type LiveRun } from "../../src/screens/running/recorder";
import { indoorSumsAt } from "../../src/screens/running/runLive";

// Stands in an indoor run, as a class (the third re-check, H5: a stand in the middle of what the app could not see read
// as moving time). Every shape of walking and standing, looked at as it came (the screen on) or all at once afterwards
// (the screen off), running from Start or after an Auto-pause: the run's Steps on its screen are the saved run's, every
// step walked is the run's, the moving time is the walking plus at most ten seconds for each stand (Auto-pause's wait),
// and the clock reads what the summary will. Driven through the recorder alone, with the phone's counter's stand-in.

interface Motion {
  stepTo: (at: number, total: number) => void;
  reset: () => void;
}
const motion = jest.requireMock<{ motion: Motion }>("../../src/screens/running/runMotionNative").motion;

const ME = "5f0c8a52-6f0e-4d59-9a3c-1f2e3d4c5b6b";
const RUN_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const FILES = ["run-now.json", "run-now-steps-0.json", "run-now-steps-1.json", "run-now-steps-2.json", "run-settings.json"];

beforeEach(() => {
  for (const name of FILES) phoneRunFiles.remove(name);
  motion.reset();
  resetRecorder();
});
afterEach(() => {
  resetRecorder();
});

type Part = readonly ["walk" | "stand", number];

/** Walking two steps a second, the counter handing a reading over each second; standing, none. Looked at each second
 *  (`late` false) or only once all of it is over (`late` true); `before` always as it came. The run's clock at the end. */
async function goThrough(t0: number, before: readonly Part[], parts: readonly Part[], late: boolean): Promise<{ run: LiveRun; endMs: number }> {
  let s = 0;
  let total = 8016;
  const feed = async (list: readonly Part[], looking: boolean) => {
    for (const [kind, seconds] of list) {
      for (let i = 0; i < seconds; i++) {
        s += 1;
        if (kind === "walk") {
          total += 2;
          motion.stepTo(t0 + s * 1000, total);
        }
        if (looking) await takeSteps(t0 + s * 1000);
      }
    }
  };
  await feed(before, true);
  await feed(parts, !late);
  s += 1;
  await takeSteps(t0 + s * 1000);
  const run = runNow();
  if (run === null) throw new Error("no run");
  return { run, endMs: s * 1000 };
}

const SHAPES: readonly (readonly [string, readonly Part[]])[] = [
  ["a stand at the end", [["walk", 60], ["stand", 600]]],
  ["a stand in the middle", [["walk", 60], ["stand", 600], ["walk", 60]]],
  ["two stands in the middle", [["walk", 60], ["stand", 300], ["walk", 30], ["stand", 300], ["walk", 60]]],
  ["a gap of exactly ten seconds", [["walk", 60], ["stand", 10], ["walk", 60]]],
  ["a gap of eleven seconds", [["walk", 60], ["stand", 11], ["walk", 60]]],
];
const STATES: readonly (readonly [string, readonly Part[]])[] = [
  ["running from Start", []],
  ["after an Auto-pause", [["walk", 30], ["stand", 20]]],
];

const rows = STATES.flatMap(([state, before]) =>
  SHAPES.flatMap(([shape, parts]) => [false, true].map((late) => [`${state}, ${shape}, ${late ? "looked at late (the screen off)" : "looked at as it came"}`, before, parts, late] as const)),
);

describe("every stand is a pause, wherever it falls and however late it is seen (the third re-check, H5)", () => {
  it.each(rows)("%s", async (_name, before, parts, late) => {
    const t0 = Date.now();
    await startRun(ME, RUN_ID, true, t0, null, { basis: { heightCm: HEIGHT_UNKNOWN_CM, factor: 1 }, stepsOff: false });
    motion.stepTo(t0, 8016);
    await takeSteps(t0);
    const { run, endMs } = await goThrough(t0, before, parts, late);
    const all = [...before, ...parts];
    const walked = all.filter(([k]) => k === "walk").reduce((sum, [, n]) => sum + n, 0);
    const stands = all.filter(([k, n]) => k === "stand" && n >= 10).length;
    const sums = indoorSumsAt(run, endMs, 0, null);
    const indoor = run.indoor;
    if (indoor == null) throw new Error("not indoors");
    // Every step walked is the run's, on its screen as in its sums.
    expect(sums.steps).toBe(walked * 2);
    expect(runStepsOf(indoor)).toBe(sums.steps);
    // The walking, and at most ten seconds (and the look's one) for each stand; never a stand's minutes.
    expect(sums.movingS).toBeLessThanOrEqual(walked + 11 * stands + 2);
    expect(sums.movingS).toBeGreaterThanOrEqual(walked - stands - 2);
    // The clock reads what the summary will.
    expect(Math.abs(movingMsOf(run, t0 + endMs) / 1000 - sums.movingS)).toBeLessThanOrEqual(1);
  });
});
