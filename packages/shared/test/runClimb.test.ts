// A run's elevation gain (ROADMAP 37b-ii). The rule is Strava's, in its own words (runClimb.ts); the
// real cases come from outside the code: the heights the app's own height map read along five New York
// streets and seven real runs, against the US Geological Survey's own bare ground at the same places
// (fixtures/real-climbs.json, its method and credits inside).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CLIMB_STEP_M, climbFromHeights, climbOver, climbSamples, geodesicMetres, heightTileName } from "../src/index.js";

const fixtureSchema = z.object({
  source: z.string(),
  cases: z.array(z.object({ name: z.string(), where: z.string(), note: z.string(), truthM: z.number().int(), heights: z.array(z.number().nullable()) })),
});
const real = fixtureSchema.parse(JSON.parse(readFileSync(new URL("./fixtures/real-climbs.json", import.meta.url), "utf8")));
const flat = (n: number, h = 0): number[] => Array.from({ length: n }, () => h);
/** Heights every CLIMB_STEP_M up a steady slope from `from` to `to` over `metres`. */
const slope = (from: number, to: number, metres: number): number[] => {
  const n = Math.round(metres / CLIMB_STEP_M);
  return Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
};
const none = (n: number): boolean[] => Array.from({ length: n }, () => false);

describe("the real cases: the app's height map against the US survey's ground", () => {
  it.each(real.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const got = climbFromHeights(c.heights, none(c.heights.length));
    // Within 2 m, or a tenth of the climb on a big one: a GPS line is a few metres off its street.
    expect(got).not.toBeNull();
    expect(Math.abs((got ?? 0) - c.truthM)).toBeLessThanOrEqual(Math.max(2, c.truthM * 0.1));
  });

  it("holds the hard cases: towers, trees, a beach the free bare-ground map reads as a hill, and real hills", () => {
    const byName = new Map(real.cases.map((c) => [c.name, c]));
    for (const name of ["fifth-ave", "park-ave", "eastern-pkwy", "20180831_beach_run_runkeeper", "run_01_iphone", "20230417_heartbreak_hill_ascent", "hike_01_iphone"]) {
      expect(byName.has(name), name).toBe(true);
    }
    expect(byName.get("20230417_heartbreak_hill_ascent")?.truthM).toBeGreaterThan(20);
    expect(byName.get("hike_01_iphone")?.truthM).toBeGreaterThan(60);
    expect(byName.get("20180831_beach_run_runkeeper")?.truthM).toBe(0);
  });
});

describe("a climb counts once it rises more than 10 m (Strava's rule for a phone)", () => {
  const cases: [string, number[], number][] = [
    ["flat", flat(100, 12), 0],
    ["a 9 m rise and back", [...slope(0, 9, 200), ...slope(9, 0, 200)], 0],
    ["exactly 10 m: not more than 10", slope(0, 10, 300), 0],
    ["an 11 m rise counts all 11 m", slope(0, 11, 300), 11],
    ["a 40 m hill, up and down", [...slope(0, 40, 400), ...slope(40, 0, 400)], 40],
    ["two 20 m hills", [...slope(0, 20, 200), ...slope(20, 0, 200), ...slope(0, 20, 200)], 40],
    ["a dip of 8 m inside a climb does not end it", [...slope(0, 30, 300), ...slope(30, 22, 80), ...slope(22, 50, 280)], 50],
    ["a fall of 12 m does end it, and the next rise is counted from the bottom", [...slope(0, 30, 300), ...slope(30, 18, 120), ...slope(18, 40, 220)], 52],
    // 0, 6, 4, 10, 8 … up to 82 at the 40th, then 80: one climb of 82 m.
    ["steps of 6 m up and 2 m down climb all the way", Array.from({ length: 41 }, (_, i) => Math.floor(i / 2) * 4 + (i % 2) * 6), 82],
    ["downhill only", slope(100, 0, 1000), 0],
    ["a hill climbed at the very end", [...flat(30, 5), ...slope(5, 25, 200)], 20],
  ];
  it.each(cases)("%s", (_name, heights, want) => {
    expect(climbOver(heights)).toBeCloseTo(want, 6);
  });

  it("is the whole rise, not the part past 10 m", () => {
    expect(climbOver(slope(0, 12, 200))).toBeCloseTo(12, 6);
  });
});

describe("garbage in gives no number, never a wrong one", () => {
  it("a run with no heights at all has none", () => {
    expect(climbFromHeights([null, null, null], none(3))).toBeNull();
    expect(climbFromHeights([], [])).toBeNull();
  });
  it("a run with fewer than three in four of its heights known has none", () => {
    const h = [...slope(0, 30, 290), ...Array.from<null>({ length: 11 }).fill(null)];
    expect(h.filter((x) => x === null).length / h.length).toBeGreaterThan(0.25);
    expect(climbFromHeights(h, none(h.length))).toBeNull();
  });
  it("a short gap is filled by a straight line between its two sides", () => {
    const h: (number | null)[] = slope(0, 30, 600);
    for (let i = 10; i < 18; i++) h[i] = null;
    expect(climbFromHeights(h, none(h.length))).toBe(30);
  });
  it("a gap at the start or end takes the nearest height", () => {
    const h: (number | null)[] = [null, null, ...slope(0, 30, 300), null];
    expect(climbFromHeights(h, none(h.length))).toBe(30);
  });
  it("one place reading a roof or a mast (an outlier) climbs nothing", () => {
    const h = flat(200, 3);
    h[100] = 80;
    h[101] = 80;
    expect(climbFromHeights(h, none(h.length))).toBe(0);
  });
  it("a stretch left out (a car up a mountain) climbs nothing across its gap", () => {
    const h = [...flat(50, 100), ...flat(50, 900)];
    const apart = none(100);
    apart[50] = true;
    expect(climbFromHeights(h, apart)).toBe(0);
    // ...while each stretch keeps its own climbs.
    const climbs = [...slope(100, 130, 300), ...slope(900, 930, 300)];
    const apart2 = none(climbs.length);
    apart2[31] = true;
    expect(climbFromHeights(climbs, apart2)).toBe(60);
  });
});

describe("where heights are read along the line", () => {
  const north = (metres: number, from = 26.1445): [number, number][] => {
    const line: [number, number][] = [];
    for (let m = 0; m <= metres; m += 3) line.push([from + m / 110_760, 91.7362]);
    return line;
  };
  it("every 10 m along a stretch, its first and last points included", () => {
    const line = north(1000);
    const s = climbSamples(line, [0]);
    const total = geodesicMetres(line[0]?.[0] ?? 0, line[0]?.[1] ?? 0, line.at(-1)?.[0] ?? 0, line.at(-1)?.[1] ?? 0);
    expect(s.at.length).toBe(Math.floor(total / CLIMB_STEP_M) + 2);
    expect(s.at[0]).toEqual(line[0]);
    expect(s.at.at(-1)).toEqual(line.at(-1));
    for (let i = 1; i < s.at.length - 1; i++) {
      const a = s.at[i - 1] ?? [0, 0];
      const b = s.at[i] ?? [0, 0];
      expect(geodesicMetres(a[0], a[1], b[0], b[1])).toBeCloseTo(CLIMB_STEP_M, 0);
    }
    expect(s.apart.every((x) => !x)).toBe(true);
  });
  it("a stretch after a pause where the person stood is one line with the last; one far away is apart", () => {
    const first = north(300);
    const near = north(300, 26.1445 + 310 / 110_760);
    const far = north(300, 26.1445 + 2000 / 110_760);
    const s1 = climbSamples([...first, ...near], [0, first.length]);
    expect(s1.apart.filter(Boolean).length).toBe(0);
    const s2 = climbSamples([...first, ...far], [0, first.length]);
    expect(s2.apart.filter(Boolean).length).toBe(1);
  });
  it("a line of one point, or none, has nothing or one place to read", () => {
    expect(climbSamples([], [0]).at).toEqual([]);
    expect(climbSamples([[26.1, 91.7]], [0]).at).toEqual([[26.1, 91.7]]);
  });
});

describe("the degree square a place is in, as Copernicus names its files", () => {
  it.each([
    [28.13, -80.57, "Copernicus_DSM_COG_10_N28_00_W081_00_DEM"],
    [26.14, 91.74, "Copernicus_DSM_COG_10_N26_00_E091_00_DEM"],
    [-33.86, 151.21, "Copernicus_DSM_COG_10_S34_00_E151_00_DEM"],
    [0.5, -0.5, "Copernicus_DSM_COG_10_N00_00_W001_00_DEM"],
    [-0.5, 0.5, "Copernicus_DSM_COG_10_S01_00_E000_00_DEM"],
  ])("%f, %f is %s", (lat, lng, name) => {
    expect(heightTileName(lat, lng)).toBe(name);
  });
});
