import { describe, expect, it } from "vitest";
import { pointAt, stepHeights, stepsLit, trailPath, trailPoints } from "../src/look/progressShapes";

describe("a goal's trail up the hill", () => {
  const points = trailPoints(200, 20);

  it("climbs from the bottom left to the top right, up and back, never off its band", () => {
    expect(points[0]).toEqual({ x: 0, y: 17 });
    expect(points.at(-1)).toEqual({ x: 200, y: 3 });
    for (const p of points) expect(p.y >= 3 && p.y <= 17).toBe(true);
    // Not a straight line: some leg goes down the hill.
    expect(points.some((p, i) => i > 0 && p.y > (points[i - 1]?.y ?? 0))).toBe(true);
  });

  it("the tip sits where the share has reached, on the trail", () => {
    expect(pointAt(points, 0)).toEqual(points[0]);
    expect(pointAt(points, 1).x).toBe(200);
    expect(pointAt(points, 0.5).x).toBe(100);
    expect(pointAt(points, 7)).toEqual(pointAt(points, 1));
    expect(trailPath(points, 0.5).split(" L").length).toBe(5);
  });
});

describe("a challenge's steps", () => {
  it("rise from short to the full height", () => {
    const h = stepHeights(10, 16);
    expect(h[0]).toBeCloseTo(5.2);
    expect(h.at(-1)).toBe(16);
  });

  it.each([
    [0, 0],
    [0.01, 1],
    [0.5, 5],
    [0.99, 9],
    [1, 10],
    [3, 10],
  ])("%d of the way lights %d", (share, lit) => {
    expect(stepsLit(10, share)).toBe(lit);
  });
});
