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
