// Zooming a photo with two fingers. Pure, so tested alone.

export const ZOOM_MOST = 4;
/** What a double tap zooms to. */
export const ZOOM_DOUBLE_TAP = 2.5;

export const clampScale = (scale: number): number => Math.min(ZOOM_MOST, Math.max(1, scale));

/** The photo may move only as far as keeps its edge at the edge of the screen; at its own size, not at all. */
export function clampShift(shift: number, size: number, scale: number): number {
  const most = (size * (scale - 1)) / 2;
  return Math.min(most, Math.max(-most, shift));
}
