// The body on Find by muscle (63b): where the figure sits in its stage, how a pinch or a double tap zooms about the
// fingers, and which point of the drawing a tap lands on. Pure, and tested alone. The stage scales its content about
// its own middle, as React Native's transform does: a point p of the content shows at c + shift + scale × (p − c).
import { FIGURE_BOX } from "./figure";

export const MOST_ZOOM = 4;
export const DOUBLE_TAP_ZOOM = 2.5;

export interface View {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}
export const WHOLE: View = { scale: 1, x: 0, y: 0 };

/** The figure at its own size: as tall as the stage allows, never wider than it, in its middle. */
export function fitFigure(width: number, height: number, margin = 12): { left: number; top: number; width: number; height: number } {
  const tall = Math.max(0, height - margin * 2);
  const wide = Math.max(0, width - margin * 2);
  const h = Math.min(tall, (wide * FIGURE_BOX.height) / FIGURE_BOX.width);
  const w = (h * FIGURE_BOX.width) / FIGURE_BOX.height;
  return { left: (width - w) / 2, top: (height - h) / 2, width: w, height: h };
}

/** Moved only as far as keeps the content's edge at the stage's edge; at its own size, not at all. */
export function settle(view: View, width: number, height: number): View {
  const scale = Math.min(MOST_ZOOM, Math.max(1, view.scale));
  const mostX = (width * (scale - 1)) / 2;
  const mostY = (height * (scale - 1)) / 2;
  return { scale, x: Math.min(mostX, Math.max(-mostX, view.x)), y: Math.min(mostY, Math.max(-mostY, view.y)) };
}

/** Zoomed to `scale` with the point under (fx, fy) of the stage staying under it, as two fingers expect. */
export function zoomAbout(from: View, scale: number, fx: number, fy: number, width: number, height: number): View {
  const cx = width / 2;
  const cy = height / 2;
  // The content's point under the fingers before, then the shift that keeps it there.
  const px = cx + (fx - cx - from.x) / from.scale;
  const py = cy + (fy - cy - from.y) / from.scale;
  const s = Math.min(MOST_ZOOM, Math.max(1, scale));
  return settle({ scale: s, x: fx - cx - s * (px - cx), y: fy - cy - s * (py - cy) }, width, height);
}

/** The point of the drawing (its own pixels) under a point of the stage. */
export function toDrawing(view: View, sx: number, sy: number, width: number, height: number): { x: number; y: number } {
  const cx = width / 2;
  const cy = height / 2;
  const px = cx + (sx - cx - view.x) / view.scale;
  const py = cy + (sy - cy - view.y) / view.scale;
  const fig = fitFigure(width, height);
  const k = FIGURE_BOX.width / fig.width;
  return { x: FIGURE_BOX.x + (px - fig.left) * k, y: FIGURE_BOX.y + (py - fig.top) * k };
}

/** The point of the stage that shows a point of the drawing: the other way round, for tests and labels. */
export function toStage(view: View, dx: number, dy: number, width: number, height: number): { x: number; y: number } {
  const fig = fitFigure(width, height);
  const k = fig.width / FIGURE_BOX.width;
  const px = fig.left + (dx - FIGURE_BOX.x) * k;
  const py = fig.top + (dy - FIGURE_BOX.y) * k;
  const cx = width / 2;
  const cy = height / 2;
  return { x: cx + view.x + view.scale * (px - cx), y: cy + view.y + view.scale * (py - cy) };
}
