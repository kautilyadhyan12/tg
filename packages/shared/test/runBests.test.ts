// A run's best efforts (ROADMAP 37c-ii): the fastest stretch of 1 km, a mile, 5 km and 10 km anywhere in
// the run, timed on the clock as Strava's Best Efforts are ("elapsed time, not moving time"), never across
// a stretch left out as too fast. Every class of case, then three real runs recorded on phones
// (msimms/TestFilesForFitnessApps, MIT) against a slow search that tries every pair of points.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RECORD_DISTANCES_M, fastestStretch, geodesicMetres, runSums, type RunMark, type RunPoint } from "../src/index.js";

const NORTH_M_PER_DEG = 110_766; // near enough at 26° N for building a track; the maths measures it itself

/** One point a second going north at `speeds[i]` metres a second, from `startMs`, from `startLat`. */
function track(speeds: readonly number[], startMs = 0, startLat = 26.1445): RunPoint[] {
  const points: RunPoint[] = [];
  let north = 0;
  for (let i = 0; i <= speeds.length; i++) {
    if (i > 0) north += speeds[i - 1] ?? 0;
    points.push([startMs + i * 1000, startLat + north / NORTH_M_PER_DEG, 91.7362, 5]);
  }
  return points;
}
const steady = (seconds: number, mps: number): number[] => Array.from({ length: seconds }, () => mps);
const lastLat = (points: readonly RunPoint[]): number => points[points.length - 1]?.[1] ?? 0;

describe("a run's best efforts, every class of case", () => {
  it("a steady 6 km at 5:00 a kilometre: 1 km in 5:00, a mile in 8:03, 5 km in 25:00, no 10 km", () => {
    const sums = runSums(track(steady(1800, 1000 / 300)), [], 1_800_000, 70);
    expect(Math.abs((sums.bests.k1 ?? 0) - 300)).toBeLessThanOrEqual(2);
    expect(Math.abs((sums.bests.mile ?? 0) - 483)).toBeLessThanOrEqual(3);
    expect(Math.abs((sums.bests.k5 ?? 0) - 1500)).toBeLessThanOrEqual(5);
    expect(sums.bests.k10).toBeNull();
  });

  it("the fastest kilometre in the middle of the run is found, not the first or the splits", () => {
    // 600 m slow, 1 km at 4:00, 600 m slow: no whole-kilometre split holds the fast one.
    const sums = runSums(track([...steady(240, 2.5), ...steady(240, 1000 / 240), ...steady(240, 2.5)]), [], 720_000, 70);
    expect(Math.abs((sums.bests.k1 ?? 0) - 240)).toBeLessThanOrEqual(2);
    const fastestSplit = Math.min(...sums.splitsKm.filter((x) => x.m === 1000).map((x) => x.s));
    expect(fastestSplit).toBeGreaterThan((sums.bests.k1 ?? 0) + 20);
  });

  it("a pause inside a 5 km counts on the clock: pausing between sprints never makes a record", () => {
    const first = track(steady(600, 5)); // 3 km in 10 minutes
    const second = track(steady(600, 5), 1_200_000, lastLat(first)); // 10 minutes paused, then 3 km more
    const sums = runSums([...first, ...second], [[600_000, 1_200_000]], 1_800_000, 70);
    expect(Math.abs(sums.movingS - 1200)).toBeLessThanOrEqual(3);
    // The fastest 5 km takes in the pause: 1,000 s running and the 600 s paused.
    expect(Math.abs((sums.bests.k5 ?? 0) - 1600)).toBeLessThanOrEqual(5);
    expect(Math.abs((sums.bests.k1 ?? 0) - 200)).toBeLessThanOrEqual(2);
  });

  it("never across a stretch left out: a car between two 3 km runs gives no 5 km", () => {
    const sums = runSums(track([...steady(600, 5), ...steady(100, 20), ...steady(600, 5)]), [], 1_300_000, 70);
    expect(sums.leftOutM).toBeGreaterThan(1500);
    expect(sums.distanceM).toBeGreaterThan(5000); // counted, but in two pieces
    expect(sums.bests.k5).toBeNull();
    expect(Math.abs((sums.bests.k1 ?? 0) - 200)).toBeLessThanOrEqual(2);
  });

  it("a run just short of a distance has no time for it", () => {
    const sums = runSums(track(steady(330, 3)), [], 330_000, 70); // 990 m
    expect(sums.distanceM).toBeLessThan(1000);
    expect(sums.bests).toEqual({ k1: null, mile: null, k5: null, k10: null });
  });

  it("no points, or one, give nothing", () => {
    expect(runSums([], [], 60_000, 70).bests).toEqual({ k1: null, mile: null, k5: null, k10: null });
    expect(runSums([[0, 26.1, 91.7, 5]], [], 60_000, 70).bests.k1).toBeNull();
  });

  it("standing at a light with no pause pressed counts on the clock too", () => {
    const sums = runSums(track([...steady(150, 4), ...steady(60, 0), ...steady(150, 4)]), [], 360_000, 70);
    // 1,200 m with a minute stood in the middle: the fastest 1 km keeps the minute in it.
    expect(sums.bests.k1).toBeGreaterThan(250 + 50);
  });
});

describe("the fastest stretch, between the marks", () => {
  const marks = (list: [number, number][]): RunMark[] => list.map(([d, t]) => ({ d, t }));

  it("is read between two marks at an even speed, on both ends", () => {
    expect(fastestStretch([marks([[0, 0], [600, 120_000], [1200, 240_000]])], 1000)).toBe(200);
    // Slow first 500 m, then 2 m/s faster: the best 1 km ends at the last mark.
    expect(fastestStretch([marks([[0, 0], [500, 250_000], [1500, 550_000]])], 1000)).toBe(300);
  });

  it("is never one faster than the world record for its time", () => {
    expect(fastestStretch([marks([[0, 0], [1000, 100_000]])], 1000)).toBeNull();
    expect(fastestStretch([marks([[0, 0], [1000, 300_000]])], 1000)).toBe(300);
  });

  it("never joins two stretches", () => {
    expect(fastestStretch([marks([[0, 0], [600, 120_000]]), marks([[600, 130_000], [1200, 250_000]])], 1000)).toBeNull();
  });
});

describe("three real runs recorded on phones", () => {
  const fixture = z
    .object({ runs: z.record(z.string(), z.object({ points: z.array(z.tuple([z.number(), z.number(), z.number()])) })) })
    .parse(JSON.parse(readFileSync(new URL("../../../apps/mobile/test/fixtures/real-runs.json", import.meta.url), "utf8")));

  /** The slow way to the answer: from every point, the stretch that starts there and the one that ends
   *  there, each other end found by walking the whole run and read between two points at an even speed. */
  function slowest(m: RunMark[], metres: number): number | null {
    let best = Infinity;
    const at = (p: RunMark, q: RunMark, d: number) => p.t + ((q.t - p.t) * (d - p.d)) / (q.d - p.d);
    for (let i = 0; i < m.length; i++) {
      const a = m[i];
      if (a === undefined) continue;
      for (let j = 1; j < m.length; j++) {
        const p = m[j - 1];
        const q = m[j];
        if (p === undefined || q === undefined || q.d <= p.d) continue;
        // Starting at i: the end falls in p..q.
        if (j - 1 >= i && p.d < a.d + metres && q.d >= a.d + metres) best = Math.min(best, (at(p, q, a.d + metres) - a.t) / 1000);
        // Ending at i: the start falls in p..q.
        if (j <= i && p.d <= a.d - metres && q.d > a.d - metres) best = Math.min(best, (a.t - at(p, q, a.d - metres)) / 1000);
      }
    }
    return best === Infinity ? null : best;
  }

  for (const [name, run] of Object.entries(fixture.runs)) {
    it(`${name}: the quick search finds what trying every pair finds`, () => {
      const m: RunMark[] = [];
      let d = 0;
      run.points.forEach(([t, lat, lng], i) => {
        const prev = run.points[i - 1];
        if (prev !== undefined) d += geodesicMetres(prev[1], prev[2], lat, lng);
        m.push({ d, t });
      });
      for (const metres of [RECORD_DISTANCES_M.k1, RECORD_DISTANCES_M.mile, RECORD_DISTANCES_M.k5]) {
        const quick = fastestStretch([m], metres);
        const slow = slowest(m, metres);
        expect(quick === null ? null : quick).toBe(slow === null ? null : Math.round(slow));
      }
    });

    it(`${name}: the run's own best efforts are in step with its distance and kilometres`, () => {
      const points: RunPoint[] = run.points.map(([t, lat, lng]) => [t, lat, lng, null]);
      const sums = runSums(points, [], run.points[run.points.length - 1]?.[0] ?? 0, 70);
      const { k1, mile, k5, k10 } = sums.bests;
      expect(k1).not.toBeNull();
      // A longer distance never takes less time, and the fastest kilometre is no slower than any whole one.
      if (k1 !== null && mile !== null) expect(mile).toBeGreaterThan(k1);
      if (mile !== null && k5 !== null) expect(k5).toBeGreaterThan(mile * 3);
      if (k10 !== null && k5 !== null) expect(k10).toBeGreaterThanOrEqual(k5 * 2);
      expect(k5 === null).toBe(sums.distanceM < 5000);
      const wholeKm = sums.splitsKm.filter((x) => x.m === 1000).map((x) => x.s);
      if (k1 !== null && wholeKm.length > 0) expect(k1).toBeLessThanOrEqual(Math.min(...wholeKm) + 1);
    });
  }
});
