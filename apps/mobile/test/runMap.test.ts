// The map under a run (ROADMAP Stage 5 37b-i). The worst thing: a map company learning who runs where.
// So the map asks the map's own addresses for squares of map and letters, nothing else, and the run
// itself is shapes held on the phone, never an address to fetch. Then the stones (Kd: "need to be
// accurate"): on three real runs recorded on phones, each at its exact kilometre or mile.
import { describe, expect, it } from "vitest";
import { OPENFREEMAP, geodesicMetres, runSums, type MapSource, type RunPoint } from "@app/shared";
import { baseMapStyle, MAP_TILES } from "../src/screens/running/mapStyle";
import { unitMarks } from "../src/screens/running/routeShape";
import { endShapes, frontBearing, runBounds, stoneShapes, trailShapes } from "../src/screens/running/runMapShapes";
import { METRES_PER_MILE } from "../src/screens/running/runWords";
import { realRuns } from "./realRuns";

const OWN_COPY: MapSource = {
  maker: "protomaps",
  tiles: "pmtiles://https://maps.example.org/world.pmtiles",
  glyphs: "https://maps.example.org/fonts/{fontstack}/{range}.pbf",
  sprite: null,
  credit: "Protomaps © OpenStreetMap",
};

/** Every address written anywhere in a style. */
const addressesIn = (value: unknown): string[] => JSON.stringify(value).match(/[a-z]+:\/\/[^"\s]+/gi) ?? [];

describe("the worst thing: a map company learning who runs where", () => {
  for (const source of [OPENFREEMAP, OWN_COPY]) {
    for (const scheme of ["light", "dark"] as const) {
      it(`${source.maker}, ${scheme}: the map asks only the map's own addresses, for map squares, letters and pictures`, () => {
        const style = baseMapStyle(source, scheme);
        expect(Object.keys(style.sources)).toEqual([MAP_TILES]);
        expect(style.sources[MAP_TILES]).toEqual({ type: "vector", url: source.tiles });
        expect(style.glyphs).toBe(source.glyphs);
        expect(style.sprite ?? null).toBe(source.sprite);
        const allowed = [source.tiles, source.glyphs, ...(source.sprite === null ? [] : [source.sprite])];
        expect(addressesIn(style).every((at) => allowed.includes(at))).toBe(true);
        // Every layer reads the map squares or is the land under them; none fetches anything of its own.
        expect(style.layers.every((layer) => layer.type === "background" || ("source" in layer && layer.source === MAP_TILES))).toBe(true);
      });
    }
  }

  it("the run is shapes held on the phone: its trail, stones and ends are never an address", () => {
    const points = [...(realRuns().get("iphone") ?? [])].map(([at, lat, lng]): RunPoint => [at, lat, lng, null]);
    const sums = runSums(points, [], points.at(-1)?.[0] ?? 0, 70);
    for (const shapes of [trailShapes(sums.track, sums.trackStarts), stoneShapes(sums.track, sums.trackStarts, "metric"), endShapes(sums.track, true)]) {
      expect(shapes.type).toBe("FeatureCollection");
      expect(addressesIn(shapes)).toEqual([]);
    }
  });
});

/** How far along the track a point lies, walking its steps as the run's distance does. */
function along(track: readonly (readonly [number, number])[], starts: readonly number[], at: readonly [number, number]): number {
  const begins = new Set(starts);
  let walked = 0;
  let best = { off: Number.POSITIVE_INFINITY, metres: 0 };
  for (let i = 1; i < track.length; i++) {
    if (begins.has(i)) continue;
    const a = track[i - 1];
    const b = track[i];
    if (a === undefined || b === undefined) continue;
    const step = geodesicMetres(a[0], a[1], b[0], b[1]);
    const fromA = geodesicMetres(a[0], a[1], at[0], at[1]);
    const toB = geodesicMetres(at[0], at[1], b[0], b[1]);
    // On this step when going via the point adds nothing to the step's length.
    const off = fromA + toB - step;
    if (off < best.off) best = { off, metres: walked + fromA };
    walked += step;
  }
  return best.metres;
}

describe("a stone at each exact kilometre or mile, on three real runs", () => {
  for (const [name, run] of realRuns()) {
    const points = run.map(([at, lat, lng]): RunPoint => [at, lat, lng, null]);
    const sums = runSums(points, [], points.at(-1)?.[0] ?? 0, 70);
    for (const units of ["metric", "imperial"] as const) {
      const every = units === "imperial" ? METRES_PER_MILE : 1000;
      const splits = units === "imperial" ? sums.splitsMi : sums.splitsKm;
      it(`${name}, ${units}: one stone for each whole ${units === "imperial" ? "mile" : "kilometre"} of its splits, each within half a metre of its mark`, () => {
        const marks = unitMarks(sums.track, sums.trackStarts, units);
        expect(marks).toHaveLength(splits.filter((split) => split.m === Math.round(every)).length);
        expect(marks.length).toBeGreaterThan(0);
        marks.forEach((mark, i) => {
          expect(Math.abs(along(sums.track, sums.trackStarts, mark) - every * (i + 1))).toBeLessThan(0.5);
        });
      });
    }
  }

  it("never counts the gap across a pause, and stands between two kept points", () => {
    const north = (m: number): [number, number] => [m / 110_574, 0];
    // 700 m, a gap of 2 km while paused, then 1.1 km more in one long step (a weak signal).
    const track = [north(0), north(700), north(2700), north(3800)];
    const marks = unitMarks(track, [0, 2], "metric");
    expect(marks).toHaveLength(1);
    // 300 m into the stretch after the pause: 2,700 + 300, where no point was kept.
    expect((marks[0]?.[0] ?? 0) * 110_574).toBeCloseTo(3000, 0);
  });
});

describe("the trail on the map", () => {
  const north = (m: number): [number, number] => [m / 110_574, 0];
  const first = Array.from({ length: 101 }, (_, i) => north(i * 5));
  const second = Array.from({ length: 51 }, (_, i) => north(2000 + i * 5));
  const track = [...first, ...second];
  const starts = [0, first.length];

  it("is cut in pieces that never cross the gap between two stretches, and cover every step once", () => {
    const shapes = trailShapes(track, starts, 10);
    let steps = 0;
    for (const piece of shapes.features) {
      const line = piece.geometry.coordinates;
      steps += line.length - 1;
      // No piece holds the end of the first stretch and the start of the second.
      const crosses = line.some(([, lat]) => lat * 110_574 < 501) && line.some(([, lat]) => lat * 110_574 > 1999);
      expect(crosses).toBe(false);
    }
    expect(steps).toBe(first.length - 1 + (second.length - 1));
  });

  it("runs from gold where it began to white at its front", () => {
    const p = trailShapes(track, starts, 10).features.map((f) => f.properties.p);
    expect(p).toEqual([...p].sort((a, b) => a - b));
    expect(p[0]).toBeLessThan(0.1);
    expect(p.at(-1)).toBeGreaterThan(0.9);
  });

  it("is drawn as [longitude, latitude], the map's own order, and fits its box", () => {
    const shapes = trailShapes([[26.1445, 91.7362], [26.145, 91.737]], [0]);
    expect(shapes.features[0]?.geometry.coordinates[0]).toEqual([91.7362, 26.1445]);
    expect(runBounds([[26.1445, 91.7362], [26.145, 91.737]])).toEqual([91.7362, 26.1445, 91.737, 26.145]);
    expect(endShapes([[26.1445, 91.7362], [26.145, 91.737]], false).features.map((f) => f.properties.n)).toEqual(["start"]);
  });

  it("beams the way the person heads, once they have moved", () => {
    const east = (m: number): [number, number] => [26.1445, 91.7362 + m / 99_960];
    expect(frontBearing([north(0), north(20)], [0])).toBeCloseTo(0, 0);
    expect(frontBearing([east(0), east(20)], [0])).toBeCloseTo(90, 0);
    expect(frontBearing([north(0), north(3)], [0])).toBeNull();
    // After a pause the beam reads the new stretch alone.
    expect(frontBearing([north(0), north(50), east(0), east(30)], [0, 2])).toBeCloseTo(90, 0);
  });
});

describe("the map's two looks", () => {
  it("are light by day and dark at night, for either map maker", () => {
    for (const source of [OPENFREEMAP, OWN_COPY]) {
      const light = baseMapStyle(source, "light");
      const dark = baseMapStyle(source, "dark");
      expect(light.layers[0]).not.toEqual(dark.layers[0]);
      expect(light.layers.map((l) => l.id)).toEqual(dark.layers.map((l) => l.id));
    }
    // Each maker's own layers: OpenMapTiles' "transportation", Protomaps' "roads".
    expect(JSON.stringify(baseMapStyle(OPENFREEMAP, "light"))).toContain('"source-layer":"transportation"');
    expect(JSON.stringify(baseMapStyle(OWN_COPY, "light"))).toContain('"source-layer":"roads"');
  });
});
