// Zooming a photo with two fingers. Pure, so tested alone.

export const ZOOM_MOST = 4;
/** What a double tap zooms to. */
export const ZOOM_DOUBLE_TAP = 2.5;
/** Two taps this close in time, each moving this little, are a double tap. */
export const DOUBLE_TAP_MS = 300;
export const TAP_MOVES_LESS_THAN = 10;

export const clampScale = (scale: number): number => Math.min(ZOOM_MOST, Math.max(1, scale));

/** The photo may move only as far as keeps its edge at the edge of the screen; at its own size, not at all. */
export function clampShift(shift: number, size: number, scale: number): number {
  const most = (size * (scale - 1)) / 2;
  return Math.min(most, Math.max(-most, shift));
}

export const fingersApart = (a: { pageX: number; pageY: number }, b: { pageX: number; pageY: number }): number => Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);

/** A drag past the first or last photo moves only a little: there is nothing there. */
export const slideDrag = (dx: number, index: number, count: number): number => ((index === 0 && dx > 0) || (index === count - 1 && dx < 0) ? dx / 3 : dx);

/** Which photo a slide lands on: the next one if it went a quarter of the way, or was flicked. */
export function slideTo(index: number, dx: number, vx: number, count: number, width: number): number {
  const far = Math.abs(dx) > width / 4 || Math.abs(vx) > 0.5;
  if (!far || dx === 0) return index;
  return Math.min(count - 1, Math.max(0, index + (dx < 0 ? 1 : -1)));
}
