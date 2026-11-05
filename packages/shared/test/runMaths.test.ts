// A run's numbers (ROADMAP 37a). The expected values come from outside the code: the Earth's shape
// worked out another way, World Athletics' records, the 2024 Compendium's rows, Google's own polyline
// example, and tracks whose true length is known because they were laid out to a length.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  GPS_WORST_ACCURACY_M,
  decodePolyline,
  encodePolyline,
  geodesicMetres,
  metAtSpeed,
  recordSpeed,
  runSums,
  type RunPause,
  type RunPoint,
} from "../src/index.js";

const A = 6_378_137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const RAD = Math.PI / 180;

/** The meridian's length between two latitudes, added up in 20,000 small pieces (Simpson's rule
 *  over the meridian's radius of curvature): a second way to the same distance. */
function meridianArc(lat1: number, lat2: number): number {
  const n = 20_000;
  const h = ((lat2 - lat1) * RAD) / n;
  const M = (phi: number): number => (A * (1 - E2)) / Math.pow(1 - E2 * Math.sin(phi) ** 2, 1.5);
  let sum = M(lat1 * RAD) + M(lat2 * RAD);
  for (let i = 1; i < n; i++) sum += (i % 2 === 0 ? 2 : 4) * M(lat1 * RAD + i * h);
  return Math.abs((sum * h) / 3);
}

describe("the distance between two points", () => {
  it("along the equator is the equator's radius times the angle", () => {
    for (const deg of [0.00001, 0.0009, 0.009, 0.09, 1]) {
      expect(geodesicMetres(0, 10, 0, 10 + deg)).toBeCloseTo(A * deg * RAD, 4);
    }
  });

  it("along a meridian is the meridian's own length, worked out another way", () => {
    for (const [a, b] of [[26.1445, 26.1535], [40.7, 40.8], [59.9, 60.1], [-33.9, -33.8], [0, 0.05], [64.1, 64.15]] as const) {
      expect(Math.abs(geodesicMetres(a, 20, b, 20) - meridianArc(a, b))).toBeLessThan(0.001);
    }
  });

  it("is the same both ways, nothing for one point, and right across the date line", () => {
    expect(geodesicMetres(26.1445, 91.7362, 26.1535, 91.7462)).toBeCloseTo(geodesicMetres(26.1535, 91.7462, 26.1445, 91.7362), 6);
    expect(geodesicMetres(43.65, -79.38, 43.65, -79.38)).toBe(0);
    expect(geodesicMetres(0, 179.9995, 0, -179.9995)).toBeCloseTo(A * 0.001 * RAD, 4);
  });
});

describe("the fastest anybody has run (World Athletics' records)", () => {
  it("is each record's own speed at its own time", () => {
    expect(recordSpeed(9.58)).toBeCloseTo(100 / 9.58, 9);
    expect(recordSpeed(100.91)).toBeCloseTo(800 / 100.91, 9);
    expect(recordSpeed(755.36)).toBeCloseTo(5000 / 755.36, 9);
    expect(recordSpeed(7170)).toBeCloseTo(42_195 / 7170, 9);
  });

  it("only falls as the time grows, and stays at the marathon's past it", () => {
    let last = Infinity;
    for (let s = 1; s < 20_000; s *= 1.3) {
      expect(recordSpeed(s)).toBeLessThanOrEqual(last);
      last = recordSpeed(s);
    }
    expect(recordSpeed(50_000)).toBeCloseTo(42_195 / 7170, 9);
  });
});

describe("the MET of a speed (2024 Adult Compendium, walking and running)", () => {
  const mph = (v: number): number => v * 0.44704;
  it("is each row's own MET at its own speed", () => {
    expect(metAtSpeed(mph(2.5))).toBeCloseTo(3.0, 9); // 17170
    expect(metAtSpeed(mph(3.7))).toBeCloseTo(4.8, 9); // 17200, 3.5 to 3.9 mph
    expect(metAtSpeed(mph(5.1))).toBeCloseTo(8.5, 9); // 12030, 5.0 to 5.2 mph (12 min/mile)
    expect(metAtSpeed(mph(6.7))).toBeCloseTo(10.5, 9); // 12060, 9 min/mile
    expect(metAtSpeed(mph(8))).toBeCloseTo(12.0, 9); // 12090
    expect(metAtSpeed(mph(10))).toBeCloseTo(14.8, 9); // 12120, 6 min/mile
    expect(metAtSpeed(mph(14))).toBeCloseTo(23.0, 9); // 12135
  });

  it("never falls as the speed rises", () => {
    let last = 0;
    for (let v = 0; v < 8; v += 0.05) {
      expect(metAtSpeed(v)).toBeGreaterThanOrEqual(last);
      last = metAtSpeed(v);
    }
  });
});

// ── Tracks laid out to a known length ─────────────────────────────────────────────────────────

/** One point a second going north at `speeds[i]` metres a second, from Guwahati, each point moved
 *  by `wobble(i)` metres east and north (a phone's error), with `acc` as its accuracy. */
function track(
  speeds: readonly number[],
  opts: { lat?: number; wobble?: (i: number) => [number, number]; acc?: (i: number) => number | null; startMs?: number } = {},
): { points: RunPoint[]; trueM: number } {
  const lat0 = opts.lat ?? 26.1445;
  const lng0 = 91.7362;
  const s = Math.sin(lat0 * RAD);
  const w = Math.sqrt(1 - E2 * s * s);
  const northPerDeg = ((A * (1 - E2)) / (w * w * w)) * RAD;
  const eastPerDeg = (A / w) * Math.cos(lat0 * RAD) * RAD;
  const points: RunPoint[] = [];
  let north = 0;
  let trueM = 0;
  for (let i = 0; i <= speeds.length; i++) {
    if (i > 0) {
      north += speeds[i - 1] ?? 0;
      trueM += speeds[i - 1] ?? 0;
    }
    const [dx, dy] = opts.wobble?.(i) ?? [0, 0];
    points.push([(opts.startMs ?? 0) + i * 1000, lat0 + (north + dy) / northPerDeg, lng0 + dx / eastPerDeg, opts.acc?.(i) ?? 5]);
  }
  return { points, trueM };
}

const steady = (seconds: number, mps: number): number[] => Array.from({ length: seconds }, () => mps);
/** A repeatable phone error of a few metres: no randomness, the same every run. */
const phoneError = (size: number) => (i: number): [number, number] => [
  size * Math.sin(i * 1.7) * Math.cos(i * 0.31),
  size * Math.cos(i * 2.3) * Math.sin(i * 0.53),
];

describe("a run's distance", () => {
  it("is the true length on a clean track", () => {
    const { points, trueM } = track(steady(1000, 3));
    const sums = runSums(points, [], 1_000_000, 70);
    expect(Math.abs(sums.distanceM - trueM) / trueM).toBeLessThan(0.002);
    expect(sums.movingS).toBe(1000);
    expect(sums.splitsKm.map((x) => x.m)).toEqual([1000, 1000, 1000]);
    for (const split of sums.splitsKm) expect(Math.abs(split.s - 333)).toBeLessThanOrEqual(1);
  });

  it("is within 2 % of the true length when every point is a few metres out", () => {
    for (const size of [2, 4, 6]) {
      const { points, trueM } = track(steady(1200, 3), { wobble: phoneError(size), acc: () => size + 2 });
      const sums = runSums(points, [], 1_200_000, 70);
      expect(Math.abs(sums.distanceM - trueM) / trueM).toBeLessThan(0.02);
    }
  });

  it("adds almost nothing while the phone lies still for ten minutes", () => {
    const { points } = track(steady(600, 0), { wobble: phoneError(5), acc: () => 8 });
    expect(runSums(points, [], 600_000, 70).distanceM).toBeLessThan(25);
  });

  it("leaves out a point the phone was less sure of than the limit", () => {
    const { points, trueM } = track(steady(300, 3));
    const far = points.map((p, i): RunPoint => (i === 150 ? [p[0], p[1] + 0.01, p[2], GPS_WORST_ACCURACY_M + 1] : p));
    expect(Math.abs(runSums(far, [], 300_000, 70).distanceM - trueM)).toBeLessThan(5);
  });

  it("leaves out a point that jumps away and back", () => {
    const { points, trueM } = track(steady(300, 3));
    const jumped = points.map((p, i): RunPoint => (i === 120 ? [p[0], p[1], p[2] + 0.004, 8] : p)); // about 400 m east
    expect(Math.abs(runSums(jumped, [], 300_000, 70).distanceM - trueM)).toBeLessThan(10);
  });

  it("counts nothing while paused, and the pause is not moving time", () => {
    const run = track([...steady(300, 3), ...steady(120, 1.4), ...steady(300, 3)]);
    const pauses: RunPause[] = [[300_000, 420_000]];
    const sums = runSums(run.points, pauses, 720_000, 70);
    expect(Math.abs(sums.distanceM - 1800)).toBeLessThan(10);
    expect(sums.movingS).toBe(600);
    expect(sums.elapsedS).toBe(720);
    // The route starts again after the pause: never a straight line across it.
    expect(sums.trackStarts).toHaveLength(2);
    expect(sums.trackStarts[0]).toBe(0);
    expect(sums.trackStarts[1]).toBeGreaterThan(0);
  });
});

describe("a stretch faster than anybody has run", () => {
  it("is left out, with its distance and time, and the rest counted", () => {
    const run = track([...steady(600, 3), ...steady(300, 15), ...steady(600, 3)]); // 54 km/h for five minutes
    const sums = runSums(run.points, [], 1_500_000, 70);
    expect(Math.abs(sums.leftOutM - 4500)).toBeLessThan(200);
    expect(Math.abs(sums.leftOutS - 300)).toBeLessThan(15);
    expect(Math.abs(sums.distanceM - 3600)).toBeLessThan(80);
    expect(Math.abs(sums.movingS - 1200)).toBeLessThan(15);
  });

  it("leaves out a bus at 30 km/h for twenty minutes", () => {
    const run = track([...steady(300, 2.8), ...steady(1200, 8.33), ...steady(300, 2.8)]);
    const sums = runSums(run.points, [], 1_800_000, 70);
    expect(sums.leftOutM).toBeGreaterThan(9000);
    expect(Math.abs(sums.distanceM - 1680)).toBeLessThan(200);
  });

  it("is never a fast runner: a marathon at the world record's pace counts whole", () => {
    const pace = 42_195 / 7170;
    const run = track(steady(7170, pace));
    const sums = runSums(run.points, [], 7_170_000, 60);
    expect(sums.leftOutM).toBe(0);
    expect(Math.abs(sums.distanceM - 42_195) / 42_195).toBeLessThan(0.002);
  });

  it("is never a sprint: 100 m in 11 seconds, inside a jog, counts whole", () => {
    const run = track([...steady(120, 3), ...steady(11, 100 / 11), ...steady(120, 3)], { wobble: phoneError(3), acc: () => 5 });
    expect(runSums(run.points, [], 251_000, 70).leftOutM).toBe(0);
  });
});

describe("a run's calories (MET × kg × hours, each kilometre at its own speed)", () => {
  it("is 298 for 5.12 km in 28:40 at one pace, at 60 kg", () => {
    const run = track(steady(1720, 5120 / 1720));
    const sums = runSums(run.points, [], 1_720_000, 60);
    expect(sums.distanceM).toBeGreaterThanOrEqual(5110);
    expect(sums.distanceM).toBeLessThanOrEqual(5130);
    expect(sums.kcal).toBe(298);
  });

  it("follows the weight, and counts 70 kg when the weight is not known", () => {
    const run = track(steady(600, 3));
    const at60 = runSums(run.points, [], 600_000, 60).kcal;
    expect(Math.abs(runSums(run.points, [], 600_000, 90).kcal - (at60 * 90) / 60)).toBeLessThanOrEqual(1);
    expect(runSums(run.points, [], 600_000, 0).kcal).toBe(runSums(run.points, [], 600_000, 70).kcal);
  });
});

describe("the route's line (Google's encoded polyline)", () => {
  it("is Google's own example, and comes back the same", () => {
    const path: [number, number][] = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
    expect(encodePolyline(path)).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual(path);
  });
});

// ── Real trips: cars and a bus recorded on Android phones (UCI's GPS Trajectories, CC BY 4.0) ───
const trips = z.object({ trips: z.record(z.object({ points: z.array(z.array(z.number())) })) }).parse(
  JSON.parse(readFileSync(new URL("./fixtures/uci-go-track-trips.json", import.meta.url), "utf8")),
);

describe("real car and bus trips, recorded on Android phones", () => {
  const sumsOf = (id: string) => {
    const trip = trips.trips[id];
    if (trip === undefined) throw new Error(`no trip ${id}`);
    const points: RunPoint[] = trip.points.map((p) => [(p[0] ?? 0) * 1000, p[1] ?? 0, p[2] ?? 0, null]);
    const last = trip.points[trip.points.length - 1]?.[0] ?? 0;
    const sums = runSums(points, [], last * 1000, 70);
    return { sums, share: sums.leftOutM / (sums.leftOutM + sums.distanceM) };
  };

  it("are almost all left out above 30 km/h", () => {
    expect(sumsOf("56").share).toBeGreaterThan(0.95); // car, 83 km/h
    expect(sumsOf("50").share).toBeGreaterThan(0.9); // bus, 37 km/h
    expect(sumsOf("39").share).toBeGreaterThan(0.8); // car, 33 km/h
    expect(sumsOf("2").share).toBeGreaterThan(0.75); // car, 31 km/h
  });
});
