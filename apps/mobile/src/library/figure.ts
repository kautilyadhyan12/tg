// Which shapes of a body figure light for an exercise (job 63a). Pure.
import { FIGURES, type FigureName } from "./figures";

export type Sex = "male" | "female";
export type Side = "front" | "back";
export type Lit = "main" | "also" | "steady";

/** A deep muscle cannot be drawn on the body's surface: it lights the drawn muscle over it, as muscle-map
 *  apps do. Only the deep words of the list are here. */
export const DEEP_UNDER: Readonly<Record<string, string>> = {
  transverse_abdominis: "abs",
  rotator_cuff: "infraspinatus",
};

const drawnOn = (side: Side): Set<string> => {
  const words = new Set<string>();
  for (const name of ["male", "female"] as const) for (const p of FIGURES[`${name}-${side}`]) if (p.m !== "") words.add(p.m);
  return words;
};
const FRONT = drawnOn("front");
const BACK = drawnOn("back");

/** Each drawn muscle's light for an exercise's three rows. A muscle is lit by its strongest row; a deep one
 *  lights the drawn one over it, never more brightly than that one's own row. */
export function litMuscles(muscles: { main: readonly string[]; also: readonly string[]; steady: readonly string[] }): Map<string, Lit> {
  const lit = new Map<string, Lit>();
  const rank: Record<Lit, number> = { main: 3, also: 2, steady: 1 };
  for (const row of ["main", "also", "steady"] as const) {
    for (const m of muscles[row]) {
      const shown = DEEP_UNDER[m] ?? m;
      const before = lit.get(shown);
      if (before === undefined || rank[row] > rank[before]) lit.set(shown, row);
    }
  }
  return lit;
}

/** The side whose figure shows more of the main muscles: a squat's front, a deadlift's back. Front on a tie. */
export function sideFor(main: readonly string[]): Side {
  const shown = main.map((m) => DEEP_UNDER[m] ?? m);
  const front = shown.filter((m) => FRONT.has(m)).length;
  const back = shown.filter((m) => BACK.has(m)).length;
  return back > front ? "back" : "front";
}

export const figureName = (sex: Sex, side: Side): FigureName => `${sex}-${side}`;

/** Every muscle word drawn on some figure, for the tests that hold the figures to the word list. */
export const DRAWN_MUSCLES: ReadonlySet<string> = new Set([...FRONT, ...BACK]);

/** The figure box the screens draw (the drawing's margin cut off), in the drawing's own pixels. */
export const FIGURE_BOX = { x: 150, y: 50, width: 724, height: 1440 } as const;

/** The middle of a muscle's shape on the viewer's left, in the drawing's pixels; null if the figure lacks it.
 *  Where a label's line points. */
export function centreOf(name: FigureName, muscle: string): { x: number; y: number } | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const part of FIGURES[name]) {
    if (part.m !== muscle) continue;
    const nums = part.d.match(/-?\d+/g)?.map(Number) ?? [];
    let px = 0;
    let py = 0;
    let pn = 0;
    for (let i = 0; i + 1 < nums.length; i += 2) {
      px += nums[i] ?? 0;
      py += nums[i + 1] ?? 0;
      pn += 1;
    }
    if (pn === 0 || px / pn > 511) continue;
    sx += px;
    sy += py;
    n += pn;
  }
  return n === 0 ? null : { x: sx / n, y: sy / n };
}

/** Each shape's outline as points, once per figure: every shape is a run of straight lines ("M x y x y … Z"). */
const OUTLINES = new Map<FigureName, { m: string; points: number[] }[]>();
function outlines(name: FigureName): { m: string; points: number[] }[] {
  const known = OUTLINES.get(name);
  if (known !== undefined) return known;
  const made = FIGURES[name].map((p) => ({ m: p.m, points: (p.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number) }));
  OUTLINES.set(name, made);
  return made;
}

/** Whether a point lies inside an outline (the even-odd rule: a line from it crosses the outline an odd number of
 *  times). */
function inside(points: readonly number[], x: number, y: number): boolean {
  let hit = false;
  const n = Math.floor(points.length / 2);
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[i * 2] ?? 0;
    const yi = points[i * 2 + 1] ?? 0;
    const xj = points[j * 2] ?? 0;
    const yj = points[j * 2 + 1] ?? 0;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The muscle drawn at a point of the figure, in the drawing's own pixels; null for no muscle there (the head, a
 *  hand, a knee, or beside the body). The shape drawn last is the one on top. */
export function muscleAt(name: FigureName, x: number, y: number): string | null {
  const shapes = outlines(name);
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s !== undefined && inside(s.points, x, y)) return s.m === "" ? null : s.m;
  }
  return null;
}
