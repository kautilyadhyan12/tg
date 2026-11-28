// The live numbers worked out a slice at a time (37o, the hunt's A11): on Kd's phone a twelve-hour run took 1.4 s in
// one go, every few seconds, and the clock and every button stood still for it. The answer must be the summary's own,
// number for number; the work must really stop for the screen; a run that changes meanwhile must not change it.
import { describe, expect, it } from "vitest";
import { runSums, runSumsInSlices, type RunPoint, type RunSums } from "@app/shared";
import type { LiveRun } from "../src/screens/running/recorder";
import { sumsAt, sumsInSlices } from "../src/screens/running/runLive";

function hours(h: number): RunPoint[] {
  const out: RunPoint[] = [];
  let lat = 26.1445, lng = 91.7362, head = 1;
  for (let i = 0; i < h * 3600; i++) {
    head += Math.sin(i / 97) * 0.05;
    lat += (3 * Math.cos(head)) / 111_132;
    lng += (3 * Math.sin(head)) / 100_000;
    out.push([i * 1000, lat, lng, 5]);
  }
  return out;
}
const live = (points: RunPoint[]): LiveRun => ({
  runId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", userId: "7b0c8a52-6f0e-4d59-9a3c-1f2e3d4c5b6a", startedAt: 0, phase: "running", pausedByPerson: false, autoPause: false,
  pauses: [[600_000, 660_000]], points, finishedMs: null, lastFix: null, here: null, guide: null, heart: [], motion: [], still: [[1_200_000, 1_260_000]], datedBack: [[2_000_000, 2_030_000]],
});

describe("the live numbers a slice at a time", () => {
  it("give the summary's own sums, number for number, for a run of three hours with a pause and stands", async () => {
    const run = live(hours(3));
    const at = 3 * 3_600_000;
    const sums = await new Promise((resolve) => sumsInSlices(run, at, 72, resolve));
    expect(JSON.stringify(sums)).toBe(JSON.stringify(sumsAt(run, at, 72)));
  });

  it("give the summary's own sums with the seconds the phone feels still before Auto-pause decides (37r)", async () => {
    const run: LiveRun = { ...live(hours(1)), feltStillFrom: 3_590_000 };
    const at = 3_600_000;
    const sums = await new Promise<RunSums>((resolve) => sumsInSlices(run, at, 72, resolve));
    expect(JSON.stringify(sums)).toBe(JSON.stringify(sumsAt(run, at, 72)));
    expect(sums.distanceM).toBeLessThan(sumsAt(live(hours(1)), at, 72).distanceM - 20);
  });

  it("stop for the screen many times on a day's run, never doing a day at once", () => {
    const points = hours(12);
    const work = runSumsInSlices(points, [], 12 * 3_600_000, 70);
    let slices = 0;
    let step = work.next();
    while (step.done !== true) {
      slices += 1;
      step = work.next();
    }
    expect(slices).toBeGreaterThan(40);
    expect(JSON.stringify(step.value)).toBe(JSON.stringify(runSums(points, [], 12 * 3_600_000, 70)));
  });

  it("points the phone hands over while the work goes on change nothing of it", async () => {
    const run = live(hours(1));
    const before = sumsAt(run, 3_600_000, 0);
    const sums = new Promise((resolve) => sumsInSlices(run, 3_600_000, 0, resolve));
    run.points.push([3_600_500, 27, 92, 5]);
    expect(JSON.stringify(await sums)).toBe(JSON.stringify(before));
  });

  it("once stopped, never tells anybody", async () => {
    let told = 0;
    const stop = sumsInSlices(live(hours(2)), 7_200_000, 0, () => {
      told += 1;
    });
    stop();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(told).toBe(0);
  });
});
