// The shapes progress is drawn in, worked out once and drawn by `Progress.tsx`. Pure, so tested alone.

export interface Point {
  x: number;
  y: number;
}

/** A trail up a hill: zig-zag, climbing from the bottom left to the top right, `turns` legs long. */
export function trailPoints(width: number, height: number, turns = 8, edge = 3): Point[] {
  const amp = Math.min(3, (height - 2 * edge) / 4);
  return Array.from({ length: turns + 1 }, (_, i) => {
    const t = i / turns;
    const climb = height - edge - t * (height - 2 * edge);
    // Every other point sits a little down the hill, so the line rises in steps up and back.
    const jog = i === 0 || i === turns ? 0 : i % 2 === 0 ? -amp : amp;
    return { x: t * width, y: Math.max(edge, Math.min(height - edge, climb + jog)) };
  });
}

/** Where on the trail a share of the way (0 to 1) has reached. */
export function pointAt(points: readonly Point[], share: number): Point {
  const first = points[0] ?? { x: 0, y: 0 };
  const last = points.at(-1) ?? first;
  const x = first.x + Math.max(0, Math.min(1, share)) * (last.x - first.x);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] ?? first;
    const b = points[i] ?? last;
    if (x <= b.x) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return { x, y: a.y + t * (b.y - a.y) };
    }
  }
  return last;
}

/** The trail as an SVG path, from its foot to a share of the way up. */
export function trailPath(points: readonly Point[], share = 1): string {
  const end = pointAt(points, share);
  const along = points.filter((p) => p.x < end.x);
  return [...along, end].map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

/** Rising steps: each bar's height, shortest first, and how many are lit for a share. */
export function stepHeights(count: number, height: number, lowest = 4): number[] {
  return Array.from({ length: count }, (_, i) => lowest + ((height - lowest) * (i + 1)) / count);
}

export function stepsLit(count: number, share: number): number {
  const s = Math.max(0, Math.min(1, share));
  // Any start lights the first step; only all of it lights the last.
  return s >= 1 ? count : s <= 0 ? 0 : Math.min(count - 1, Math.max(1, Math.round(s * count)));
}
