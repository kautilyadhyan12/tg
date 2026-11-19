// Find by muscle (63b): the muscle under a finger, the zoom, and the name a person reads for the one tapped. Every
// test reads Kd's real four figures.
import { EXERCISE_MUSCLES } from "@app/shared";
import { describe, expect, it } from "vitest";
import { DRAWN_MUSCLES, FIGURE_BOX, muscleAt } from "../src/library/figure";
import { FIGURES, type FigureName } from "../src/library/figures";
import { DOUBLE_TAP_ZOOM, fitFigure, MOST_ZOOM, settle, toDrawing, toStage, WHOLE, zoomAbout } from "../src/library/stage";
import { muscleFamily, muscleTitle } from "../src/library/words";

const NAMES: readonly FigureName[] = ["male-front", "male-back", "female-front", "female-back"];
const points = (d: string): number[] => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

/** A point inside a shape: the middle of the longest run across it on the row through its middle. */
function insidePoint(d: string): { x: number; y: number } {
  const p = points(d);
  const ys = p.filter((_, i) => i % 2 === 1);
  const y = (Math.min(...ys) + Math.max(...ys)) / 2 + 0.5;
  const crossings: number[] = [];
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi, xj, yj] = [p[i * 2] ?? 0, p[i * 2 + 1] ?? 0, p[j * 2] ?? 0, p[j * 2 + 1] ?? 0];
    if (yi > y !== yj > y) crossings.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
  }
  crossings.sort((a, b) => a - b);
  let best = { x: 0, y, w: -1 };
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const a = crossings[i] ?? 0;
    const b = crossings[i + 1] ?? 0;
    if (b - a > best.w) best = { x: (a + b) / 2, y, w: b - a };
  }
  return best;
}

describe("the muscle under a finger", () => {
  it.each(NAMES)("%s: a tap inside every muscle's shape finds that muscle", (name) => {
    const wrong: string[] = [];
    for (const part of FIGURES[name]) {
      const at = insidePoint(part.d);
      const found = muscleAt(name, at.x, at.y);
      if (found !== (part.m === "" ? null : part.m)) wrong.push(`${part.m || "(not a muscle)"} found ${String(found)}`);
    }
    expect(wrong).toEqual([]);
  });

  it.each(NAMES)("%s: beside the body, and on the head, there is no muscle", (name) => {
    expect(muscleAt(name, FIGURE_BOX.x + 5, FIGURE_BOX.y + 5)).toBeNull();
    expect(muscleAt(name, 512, 130)).toBeNull();
  });

  it("every muscle a figure can show is found on it somewhere: none is drawn that cannot be tapped", () => {
    const found = new Set<string>();
    for (const name of NAMES) for (const part of FIGURES[name]) {
      const at = insidePoint(part.d);
      const m = muscleAt(name, at.x, at.y);
      if (m !== null) found.add(m);
    }
    expect([...DRAWN_MUSCLES].filter((m) => !found.has(m))).toEqual([]);
  });
});

describe("the zoom", () => {
  const W = 360;
  const H = 560;
  it("at its own size the figure is as tall as the stage allows, in its middle, never wider than it", () => {
    const fig = fitFigure(W, H);
    expect(fig.height).toBeCloseTo(H - 24);
    expect(fig.left).toBeCloseTo((W - fig.width) / 2);
    const narrow = fitFigure(200, 900);
    expect(narrow.width).toBeCloseTo(200 - 24);
  });

  it("a pinch keeps the point under the fingers where it was", () => {
    const before = toDrawing(WHOLE, 120, 200, W, H);
    const zoomed = zoomAbout(WHOLE, 3, 120, 200, W, H);
    const after = toDrawing(zoomed, 120, 200, W, H);
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });

  it("zoom stays between the body's own size and four times it, and never moves the body off the stage", () => {
    expect(zoomAbout(WHOLE, 10, 0, 0, W, H).scale).toBe(MOST_ZOOM);
    expect(zoomAbout(WHOLE, 0.2, 0, 0, W, H)).toEqual({ scale: 1, x: 0, y: 0 });
    const far = settle({ scale: 2, x: 5000, y: -5000 }, W, H);
    expect(far).toEqual({ scale: 2, x: W / 2, y: -H / 2 });
    expect(DOUBLE_TAP_ZOOM).toBeLessThanOrEqual(MOST_ZOOM);
  });

  it("a tap is read at the right point of the drawing, zoomed or not", () => {
    for (const view of [WHOLE, zoomAbout(WHOLE, 2.5, 90, 300, W, H), { scale: 3.2, x: -100, y: 140 }]) {
      const stage = toStage(view, 430, 600, W, H);
      const back = toDrawing(view, stage.x, stage.y, W, H);
      expect(back.x).toBeCloseTo(430, 4);
      expect(back.y).toBeCloseTo(600, 4);
    }
  });
});

describe("the name of the muscle tapped", () => {
  it.each<[string, string, string | null]>([
    ["vastus_lateralis", "Vastus lateralis", "Quadriceps"],
    ["front_delts", "Front deltoid", "Shoulders"],
    ["triceps_long", "Triceps long head", "Triceps"],
    ["biceps", "Biceps", null],
    ["brachialis", "Brachialis", null],
    ["inner_hamstrings", "Semitendinosus and semimembranosus", "Hamstrings"],
    ["quadratus_lumborum", "Quadratus lumborum", null],
  ])("%s reads %s, under %s", (muscle, title, family) => {
    expect(muscleTitle(muscle)).toBe(title);
    expect(muscleFamily(muscle)).toBe(family);
  });

  it("no two drawn muscles share a name, so the one tapped is always told apart", () => {
    const titles = [...DRAWN_MUSCLES].map(muscleTitle);
    expect(new Set(titles).size).toBe(titles.length);
    for (const m of EXERCISE_MUSCLES) expect(muscleTitle(m)).toMatch(/^[A-Z]/);
  });
});
