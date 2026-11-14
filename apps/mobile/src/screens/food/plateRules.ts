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

/** A day of the week as a glass (32c-i): its outline, open at the top, from `room` down `height`; and the
 *  liquid in it `level` points deep (null: an empty glass), never past the brim, a thin film in its foot
 *  where there is little, with a few bubbles, and where a drip down its right side would run. */
export function glassShape(width: number, height: number, room: number, level: number | null) {
  const top = room;
  const foot = room + height;
  const turn = foot - 8;
  const left = (y: number) => 1 + (3 * (y - top)) / (turn - top);
  const right = (y: number) => width - 1 - (3 * (y - top)) / (turn - top);
  const r = (n: number) => Math.round(n * 100) / 100;
  const w = (n: number) => String(r(n));
  const glass = `M${w(left(top))},${w(top)} L${w(left(turn))},${w(turn)} Q${w(left(turn) + 1)},${w(foot)} ${w(left(turn) + 7)},${w(foot)} L${w(right(turn) - 7)},${w(foot)} Q${w(right(turn) - 1)},${w(foot)} ${w(right(turn))},${w(turn)} L${w(right(top))},${w(top)}`;
  const shine = `M${w(left(top) + 5)},${w(top + 8)} L${w(left(turn) + 5)},${w(turn - 8)}`;
  if (level === null || !(level > 0)) return { glass, shine, liquid: null };
  const surface = Math.max(foot - level, top + 2);
  // Above the curved foot, the liquid fills the glass's sides; within it, a thin film narrowing to the foot,
  // so a little is drawn as a little.
  const film = surface > turn;
  const inset = film ? 1 + (6 * (surface - turn)) / (foot - turn) : 0;
  const leftAt = film ? left(turn) + inset : left(surface);
  const rightAt = film ? right(turn) - inset : right(surface);
  const liquid = film
    ? `M${w(leftAt)},${w(surface)} L${w(rightAt)},${w(surface)} Q${w(right(turn) - 1)},${w(foot)} ${w(right(turn) - 7)},${w(foot)} L${w(left(turn) + 7)},${w(foot)} Q${w(left(turn) + 1)},${w(foot)} ${w(leftAt)},${w(surface)} Z`
    : `M${w(left(surface))},${w(surface)} L${w(right(surface))},${w(surface)} L${w(right(turn))},${w(turn)} Q${w(right(turn) - 1)},${w(foot)} ${w(right(turn) - 7)},${w(foot)} L${w(left(turn) + 7)},${w(foot)} Q${w(left(turn) + 1)},${w(foot)} ${w(left(turn))},${w(turn)} Z`;
  const deep = foot - surface;
  const bubbles = deep > 16 ? [[0.3, 0.35, 1.6], [0.62, 0.6, 1.2], [0.45, 0.82, 1.4]].map(([x = 0, y = 0, size = 0]) => ({ x: r(width * x), y: r(surface + deep * y), r: size })) : [];
  const edge = rightAt + 1;
  return {
    glass,
    shine,
    liquid: {
      path: liquid,
      top: r(surface),
      middle: r(width / 2),
      half: r((rightAt - leftAt) / 2),
      bubbles,
      drip: `M${w(edge)},${w(surface + 1)} q3,9 1,18 q-1,5 1,8`,
      dripEnd: { x: r(edge + 1), y: r(surface + 32) },
    },
  };
}
