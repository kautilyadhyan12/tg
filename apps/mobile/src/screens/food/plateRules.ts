// The Food tab's plates (32c-i, Kd's drawing of 2026-11-14): how full each part of a plate is drawn, and
// the shapes it is drawn with. A plate never shows more than was eaten: past the target it is full,
// and a number not known yet leaves it empty.

/** How much of a part is filled: what was eaten of the target, from 0 to 1. Unknown, no target or a
 *  number that is not a number: empty. */
export function plateShare(had: number | null, of: number): number {
  if (had === null || !Number.isFinite(had) || !Number.isFinite(of) || of <= 0 || had <= 0) return 0;
  return Math.min(1, had / of);
}

/** The radius a part is filled to: from the hub outward, by its share. */
export function fillReach(share: number, inner: number, outer: number): number {
  return inner + (outer - inner) * Math.max(0, Math.min(1, share));
}

const point = (cx: number, cy: number, angle: number, r: number) => {
  const t = (angle * Math.PI) / 180;
  return `${(cx + r * Math.cos(t)).toFixed(2)},${(cy + r * Math.sin(t)).toFixed(2)}`;
};

/** One part of a plate: the ring between two radii, from one angle to another (0 is to the right,
 *  angles run clockwise). */
export function partPath(cx: number, cy: number, from: number, to: number, inner: number, outer: number): string {
  const big = to - from > 180 ? 1 : 0;
  return `M${point(cx, cy, from, outer)} A${String(outer)},${String(outer)} 0 ${String(big)} 1 ${point(cx, cy, to, outer)} L${point(cx, cy, to, inner)} A${String(inner)},${String(inner)} 0 ${String(big)} 0 ${point(cx, cy, from, inner)} Z`;
}

/** The edge of a part, where its food reaches. */
export function edgePath(cx: number, cy: number, from: number, to: number, r: number): string {
  return `M${point(cx, cy, from, r)} A${String(r)},${String(r)} 0 0 1 ${point(cx, cy, to, r)}`;
}

/** A day's plate filled as a slice from the top, clockwise; null where nothing is filled, and the whole
 *  plate as a circle (an arc cannot run all the way round). */
export function slicePath(cx: number, cy: number, r: number, share: number): { kind: "none" } | { kind: "whole" } | { kind: "slice"; d: string } {
  if (!(share > 0)) return { kind: "none" };
  if (share >= 0.999) return { kind: "whole" };
  const to = -90 + 360 * share;
  return { kind: "slice", d: `M${String(cx)},${String(cy)} L${point(cx, cy, -90, r)} A${String(r)},${String(r)} 0 ${share > 0.5 ? "1" : "0"} 1 ${point(cx, cy, to, r)} Z` };
}

/** The three parts of today's plate, each a third less a gap, protein from the top. */
export const PLATE_PARTS = [
  { key: "proteinG", name: "Protein", from: -87, colour: "blue", picture: "texprotein" },
  { key: "carbsG", name: "Carbs", from: 33, colour: "gold", picture: "texcarbs" },
  { key: "fatG", name: "Fat", from: 153, colour: "purple", picture: "texfat" },
] as const;
export const PART_SWEEP = 114;
