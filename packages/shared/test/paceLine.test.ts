// The pace chart (ROADMAP 37c-iii): the speed along the run, and the hills behind it. Worst thing first: a
// pace the person never ran shown as theirs (a car ride drawn as their fastest, a stop drawn as a crawl).
// Then every class of case, and three real runs recorded on phones (msimms/TestFilesForFitnessApps, MIT)
// against their own kilometre splits.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PACE_LINE_FROM_M, PACE_LINE_MOST, hillLineOf, paceLineOf, recordSpeed, runSums, type RunPoint } from "../src/index.js";

const NORTH_M_PER_DEG = 110_766;

/** One point a second going north at `speeds[i]` metres a second. */
function track(speeds: readonly number[]): RunPoint[] {
  const points: RunPoint[] = [];
  let north = 0;
  for (let i = 0; i <= speeds.length; i++) {
    if (i > 0) north += speeds[i - 1] ?? 0;
    points.push([i * 1000, 26.1445 + north / NORTH_M_PER_DEG, 91.7362, 5]);
  }
  return points;
}
const steady = (seconds: number, mps: number): number[] => Array.from({ length: seconds }, () => mps);

/** The same track as a real phone gives it, seeded so every run is the same: each point off by a random few
 *  metres from one second to the next (`jitter`, the spread north and east), and by an error that drifts
 *  slowly, over about 20 s (`drift`, its spread), as a phone standing still mostly does; with the accuracy
 *  the phone says. */
function wandering(speeds: readonly number[], jitter: number, accuracy: number, drift = 0, seed = 7): RunPoint[] {
  let s = seed;
  const next = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next());
  const keep = Math.exp(-1 / 20);
  const fresh = drift * Math.sqrt(1 - keep * keep);
  let north = 0;
  let east = 0;
  return track(speeds).map(([at, lat, lng]): RunPoint => {
    north = keep * north + fresh * gauss();
    east = keep * east + fresh * gauss();
    return [at, lat + (north + gauss() * jitter) / NORTH_M_PER_DEG, lng + (east + gauss() * jitter) / 100_000, accuracy];
  });
}
const line = (speeds: readonly number[], pauses: [number, number][] = []) => runSums(track(speeds), pauses, speeds.length * 1000, 70);
const mps = (cms: number): number => cms / 100;

describe("the worst thing: a pace never run, shown as the person's", () => {
  it("a car ride in the middle is never drawn as a sprint: the line stays at the running speed", () => {
    // 1 km at 3 m/s, 2 km at 20 m/s (a car), 1 km at 3 m/s.
    const sums = line([...steady(333, 3), ...steady(100, 20), ...steady(333, 3)]);
    expect(sums.leftOutM).toBeGreaterThan(1500);
    expect(sums.paceLine.length).toBeGreaterThan(10);
    for (const v of sums.paceLine) expect(mps(v)).toBeLessThan(3.6);
    expect(Math.max(...sums.paceLine.map(mps))).toBeGreaterThan(2.6);
  });

  it("a stop of two minutes standing still is never drawn as a crawl", () => {
    const sums = line([...steady(300, 3), ...steady(120, 0), ...steady(300, 3)]);
    for (const v of sums.paceLine) expect(mps(v)).toBeGreaterThan(2.6);
  });

  // A phone standing still says it is a few metres from where it was a second ago (round one, H3).
  it.each([
    [2, 5],
    [4, 10],
  ])("a stop of three minutes on a real phone (%d m of wander, %d m sure) is never drawn as a crawl, nor counted as moving", (jitter, accuracy) => {
    const speeds = [...steady(400, 3), ...steady(180, 0), ...steady(400, 3)];
    const sums = runSums(wandering(speeds, jitter, accuracy), [], speeds.length * 1000, 70);
    for (const v of sums.paceLine) expect(mps(v)).toBeGreaterThan(2.2);
    expect(sums.stillS).toBeGreaterThan(150);
    expect(sums.movingS).toBeLessThan(840);
  });

  // A phone standing still mostly drifts: its error moves slowly over tens of seconds (the re-check of H3). In a
  // run at 3 m/s (5:33 a kilometre), what is left of such a stop is a dip, never a crawl.
  it.each([
    [1, 3, 5, 11],
    [1, 3, 5, 99],
    [1, 5, 8, 11],
    [2, 3, 10, 99],
  ])("a stop of three minutes on a drifting phone (%d m of wander, %d m of drift, %d m sure, seed %d) is found and never drawn as a crawl", (jitter, drift, accuracy, seed) => {
    const speeds = [...steady(400, 3), ...steady(180, 0), ...steady(400, 3)];
    const sums = runSums(wandering(speeds, jitter, accuracy, drift, seed), [], speeds.length * 1000, 70);
    expect(sums.stillS).toBeGreaterThan(110);
    expect(Math.min(...sums.paceLine.map(mps))).toBeGreaterThan(1.7);
  });

  // Less sure than 10 m, standing and small laps cannot be told apart (measured: the third re-check of H3), so
  // the time counts as moving: a stop shows as a dip, and a run is never counted as standing.
  it("with a weak signal a stop is not looked for: its time counts as moving", () => {
    const speeds = [...steady(400, 3), ...steady(180, 0), ...steady(400, 3)];
    const sums = runSums(wandering(speeds, 2, 15, 8, 4242), [], speeds.length * 1000, 70);
    expect(sums.stillS).toBe(0);
    expect(sums.movingS).toBe(980);
  });

  // Laps of a small loop come back to the same place every lap (the second and third re-checks of H3).
  it.each([
    [40, 2.5, 1, 0, 5],
    [80, 2.2, 1, 0, 5],
    [120, 3, 1, 0, 5],
    [40, 2, 2, 3, 10],
    [80, 2.2, 3, 5, 20],
    [100, 2.5, 3, 5, 25],
    [120, 3, 4, 8, 30],
  ])("laps of a %d m loop at %d m/s for half an hour (%d m of wander, %d m of drift, %d m sure) are running, never standing", (lapM, speed, jitter, drift, accuracy) => {
    let s = 3;
    const next = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const gauss = () => Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next());
    const keep = Math.exp(-1 / 20);
    const fresh = drift * Math.sqrt(1 - keep * keep);
    const radius = lapM / (2 * Math.PI);
    let angle = 0;
    let north = 0;
    let east = 0;
    const points: RunPoint[] = [];
    for (let t = 0; t <= 1800; t++) {
      if (t > 0) angle += (speed * (1 + (next() - 0.5) * 0.1)) / radius;
      north = keep * north + fresh * gauss();
      east = keep * east + fresh * gauss();
      points.push([t * 1000, 26.1445 + (radius * Math.sin(angle) + north + gauss() * jitter) / NORTH_M_PER_DEG, 91.7362 + (radius * Math.cos(angle) + east + gauss() * jitter) / 100_000, accuracy]);
    }
    const sums = runSums(points, [], 1_800_000, 70);
    expect(sums.stillS).toBeLessThan(30);
    expect(sums.movingS).toBeGreaterThan(1770);
    for (const v of sums.paceLine) expect(mps(v)).toBeLessThan(speed * 1.5);
  });

  it("a slow walk on a wandering phone is walking, never standing", () => {
    // 0.6 m/s, 2.2 km an hour: a steep climb on foot.
    const sums = runSums(wandering(steady(900, 0.6), 2, 8, 3, 5), [], 900_000, 70);
    expect(sums.stillS).toBeLessThan(30);
    expect(sums.movingS).toBeGreaterThan(870);
  });

  it("a pause is never drawn as a crawl", () => {
    const sums = line([...steady(300, 3), ...steady(180, 0), ...steady(300, 3)], [[300_000, 480_000]]);
    for (const v of sums.paceLine) expect(mps(v)).toBeGreaterThan(2.6);
  });

  it("nothing faster than anybody has ever run, even from a phone's wild points", () => {
    // Every tenth second a jump of 8 m and back: noise, not speed.
    const speeds = Array.from({ length: 900 }, (_, i) => (i % 10 === 0 ? 11 : i % 10 === 1 ? -5 : 3));
    const sums = line(speeds);
    for (const v of sums.paceLine) expect(mps(v)).toBeLessThan(10.5);
  });
});

describe("the line never faster than anybody has run", () => {
  it("steps faster than the world record are held at it, never drawn as the speed they claim", () => {
    // 6 km at 12 m/s: the line's stretch is 300 m in 25 s, and nobody has kept up 12 m/s for 25 s.
    const line = paceLineOf(Array.from({ length: 500 }, () => ({ m: 12, s: 1 })));
    expect(line.length).toBe(PACE_LINE_MOST);
    for (const v of line) expect(v).toBeLessThanOrEqual(Math.round(recordSpeed(25) * 100));
    expect(Math.max(...line)).toBeLessThan(1200);
  });
});

describe("the line, every class of case", () => {
  it("a steady run is a flat line at its own speed", () => {
    const sums = line(steady(1200, 3));
    for (const v of sums.paceLine) expect(Math.abs(mps(v) - 3)).toBeLessThan(0.1);
  });

  it("a walk break of a minute shows where it was", () => {
    // 1.5 km at 3 m/s, a minute at 1.4 m/s, 1.5 km at 3 m/s.
    const sums = line([...steady(500, 3), ...steady(60, 1.4), ...steady(500, 3)]);
    const n = sums.paceLine.length;
    const at = (metres: number) => mps(sums.paceLine[Math.round(((n - 1) * metres) / sums.distanceM)] ?? 0);
    expect(at(1540)).toBeLessThan(2.3);
    expect(at(500)).toBeGreaterThan(2.9);
    expect(at(2800)).toBeGreaterThan(2.9);
  });

  it("a faster second half rises", () => {
    const sums = line([...steady(500, 2.5), ...steady(400, 4)]);
    const first = sums.paceLine[0] ?? 0;
    const last = sums.paceLine[sums.paceLine.length - 1] ?? 0;
    expect(mps(first)).toBeLessThan(2.7);
    expect(mps(last)).toBeGreaterThan(3.8);
  });

  it(`under ${String(PACE_LINE_FROM_M)} m there is no chart; from it there is`, () => {
    expect(line(steady(120, 3)).paceLine).toEqual([]);
    expect(line(steady(140, 3)).paceLine.length).toBeGreaterThan(1);
  });

  it(`a long run has ${String(PACE_LINE_MOST)} places at most; a short one one every 10 m`, () => {
    expect(line(steady(7200, 3)).paceLine).toHaveLength(PACE_LINE_MOST);
    const short = line(steady(200, 3));
    expect(short.paceLine).toHaveLength(Math.floor(short.distanceM / 10) + 1);
  });

  it("no run at all, or standing still the whole time: no chart", () => {
    expect(runSums([], [], 0, 70).paceLine).toEqual([]);
    expect(line(steady(600, 0)).paceLine).toEqual([]);
  });
});

describe("the hills behind it", () => {
  it("the heights at the pace line's places, from the start to the finish", () => {
    const heights = Array.from({ length: 101 }, (_, i) => 10 + i * 0.5);
    const hills = hillLineOf(heights, heights.map(() => false), 11);
    expect(hills).toHaveLength(11);
    expect(hills[0]).toBe(10);
    expect(hills[10]).toBe(60);
  });

  it("a stretch that starts somewhere else keeps the ground's own height there", () => {
    // 20 heights at 0 m, a car ride left out, 20 heights at 500 m.
    const heights = [...Array.from({ length: 20 }, () => 0), ...Array.from({ length: 20 }, () => 500)];
    const apart = heights.map((_, i) => i === 20);
    const hills = hillLineOf(heights, apart, 40);
    expect(hills[0]).toBe(0);
    expect(hills[5]).toBe(0);
    expect(hills[30]).toBe(500);
    expect(hills[39]).toBe(500);
  });

  it("too few heights known: no hills, never a made-up line", () => {
    const heights = Array.from({ length: 20 }, (_, i) => (i < 10 ? 50 : null));
    expect(hillLineOf(heights, heights.map(() => false), 30)).toEqual([]);
  });

  it("no places, or a broken height: nothing outside what the schema takes", () => {
    expect(hillLineOf([10, 20], [false, false], 0)).toEqual([]);
    expect(hillLineOf([50_000, 50_000, 50_000], [false, false, false], 3)).toEqual([9000, 9000, 9000]);
  });
});

const fixtureSchema = z.object({ runs: z.record(z.object({ points: z.array(z.tuple([z.number(), z.number(), z.number()])) })) });

describe("three real runs: the line agrees with each kilometre's own time", () => {
  const raw = fixtureSchema.parse(JSON.parse(readFileSync(new URL("../../../apps/mobile/test/fixtures/real-runs.json", import.meta.url), "utf8")));
  for (const [name, run] of Object.entries(raw.runs)) {
    it(name, () => {
      const points: RunPoint[] = run.points.map(([at, lat, lng]) => [at, lat, lng, null]);
      const sums = runSums(points, [], points[points.length - 1]?.[0] ?? 0, 70);
      const n = sums.paceLine.length;
      expect(n).toBe(PACE_LINE_MOST);
      // The time to cover each whole kilometre, read off the line, against the split's own.
      let km = 0;
      for (const split of sums.splitsKm.filter((s) => s.m === 1000)) {
        let seconds = 0;
        for (let i = 0; i < n - 1; i++) {
          const from = (sums.distanceM * i) / (n - 1);
          const to = (sums.distanceM * (i + 1)) / (n - 1);
          const inside = Math.max(0, Math.min(to, (km + 1) * 1000) - Math.max(from, km * 1000));
          const speed = mps(((sums.paceLine[i] ?? 0) + (sums.paceLine[i + 1] ?? 0)) / 2);
          if (inside > 0 && speed > 0) seconds += inside / speed;
        }
        expect(Math.abs(seconds - split.s) / split.s, `${name} km ${String(km + 1)}`).toBeLessThan(0.12);
        km++;
      }
    });
  }

  it("twelve hours of points take little time to draw at save", () => {
    const speeds = Array.from({ length: 43_199 }, (_, i) => 2.8 + Math.sin(i / 300) * 0.4);
    const points = track(speeds);
    const started = performance.now();
    const sums = runSums(points, [], 43_199_000, 70);
    const ms = performance.now() - started;
    expect(sums.paceLine).toHaveLength(PACE_LINE_MOST);
    expect(ms).toBeLessThan(3000);
  });
});
