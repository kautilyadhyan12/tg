// A run's route made small for Your runs (ROADMAP Stage 5 37c-i). Its cases are real runs recorded on
// phones (the phone's own fixture, from msimms/TestFilesForFitnessApps, MIT) as `runSums` saves their
// line, and runs made to test the edges: a pause, a thousand pauses, nothing at all.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RUN_SHAPE_MOST_CHARS, RUN_SHAPE_MOST_POINTS, decodeShape, geodesicMetres, routeShape, runSums, type RunPoint } from "../src/index.js";

const realRuns = z
  .object({ runs: z.record(z.string(), z.object({ points: z.array(z.tuple([z.number(), z.number(), z.number()])) })) })
  .parse(JSON.parse(readFileSync(new URL("../../../apps/mobile/test/fixtures/real-runs.json", import.meta.url), "utf8")));

/** How far a place lies from the line a–b, in metres, over a flat piece of the Earth this small. */
function offLine(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const k = Math.cos(p[0] * (Math.PI / 180));
  const [px, py, ax, ay, bx, by] = [p[1] * k, p[0], a[1] * k, a[0], b[1] * k, b[0]];
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return geodesicMetres(p[0], p[1], ay + t * dy, (ax + t * dx) / k);
}

const sizeOf = (track: readonly (readonly [number, number])[]): number => {
  const lats = track.map((p) => p[0]);
  const lngs = track.map((p) => p[1]);
  const mid = (Math.min(...lats) + Math.max(...lats)) / 2;
  return Math.max(geodesicMetres(Math.min(...lats), lngs[0] ?? 0, Math.max(...lats), lngs[0] ?? 0), geodesicMetres(mid, Math.min(...lngs), mid, Math.max(...lngs)));
};

describe("a run's route made small", () => {
  for (const [name, run] of Object.entries(realRuns.runs)) {
    it(`${name}: no more than the picture's points, its ends where the run's are, never further off the route than a pixel of a list's picture`, () => {
      const points: RunPoint[] = run.points.map(([at, lat, lng]) => [at, lat, lng, 5]);
      const sums = runSums(points, [], points[points.length - 1]?.[0] ?? 0, 70);
      const shape = routeShape(sums.track, sums.trackStarts);
      expect(shape).not.toBeNull();
      expect(shape?.length ?? 0).toBeLessThanOrEqual(RUN_SHAPE_MOST_CHARS);
      const small = decodeShape(shape ?? "");
      expect(small.track.length).toBeGreaterThan(2);
      expect(small.track.length).toBeLessThanOrEqual(RUN_SHAPE_MOST_POINTS);
      expect(small.starts).toEqual([0]);
      // The polyline keeps five places: a first and last point within about a metre of the run's.
      const [first, last] = [sums.track[0], sums.track[sums.track.length - 1]];
      const [sFirst, sLast] = [small.track[0], small.track[small.track.length - 1]];
      if (first === undefined || last === undefined || sFirst === undefined || sLast === undefined) throw new Error("no ends");
      expect(geodesicMetres(first[0], first[1], sFirst[0], sFirst[1])).toBeLessThan(1.5);
      expect(geodesicMetres(last[0], last[1], sLast[0], sLast[1])).toBeLessThan(1.5);
      // Every place the runner was lies within 2 % of the route's size of the small line: a 56-point
      // picture draws 2 % as about one point.
      const worst = Math.max(...sums.track.map((p) => Math.min(...small.track.slice(1).map((b, i) => offLine(p, small.track[i] ?? b, b)))));
      expect(worst).toBeLessThanOrEqual(sizeOf(sums.track) * 0.02 + 1.5);
    });
  }

  it("keeps each stretch apart: the line is never drawn across a pause or a stretch left out", () => {
    const points: RunPoint[] = [];
    for (let i = 0; i <= 900; i++) points.push([i * 1000, 26.1445 + (i * 3) / 110_760, 91.7362 + (i % 120 < 60 ? 0 : 0.0003), 5]);
    const sums = runSums(points, [[300_000, 600_000]], 900_000, 70);
    expect(sums.trackStarts).toHaveLength(2);
    const small = decodeShape(routeShape(sums.track, sums.trackStarts) ?? "");
    expect(small.starts).toHaveLength(2);
    expect(small.starts[0]).toBe(0);
  });

  it("a run of a thousand pauses keeps its longest stretches and stays within the picture's points and the column's length", () => {
    const points: RunPoint[] = [];
    const pauses: [number, number][] = [];
    for (let i = 0; i <= 6000; i++) points.push([i * 1000, 26.1445 + (i * 3) / 110_760, 91.7362 + Math.sin(i / 7) * 0.0002, 5]);
    for (let k = 1; k < 1000; k++) pauses.push([k * 6000, k * 6000 + 1000]);
    const sums = runSums(points, pauses, 6_000_000, 70);
    expect(sums.trackStarts.length).toBeGreaterThan(500);
    const shape = routeShape(sums.track, sums.trackStarts) ?? "";
    expect(shape.length).toBeLessThanOrEqual(RUN_SHAPE_MOST_CHARS);
    expect(decodeShape(shape).track.length).toBeLessThanOrEqual(RUN_SHAPE_MOST_POINTS);
  });

  it("no route, a single place, or stretches of one point each: no shape", () => {
    expect(routeShape([], [])).toBeNull();
    expect(routeShape([[26.1, 91.7]], [0])).toBeNull();
    expect(routeShape([[26.1, 91.7], [26.2, 91.8]], [0, 1])).toBeNull();
    expect(decodeShape("")).toEqual({ track: [], starts: [] });
  });
});
