// How the look fits phones of every size (Kd, 2026-10-28: other phones, foldables, the iPhone Duo).
// Pure, so tested alone.

/** The most of the screen's height a page's own picture takes. On a tall phone it never binds; on a
 *  wide screen (an opened Fold or iPhone Duo, a tablet, a phone on its side) the picture would
 *  otherwise fill the screen. */
export const PICTURE_TOP_MOST = 0.55;

/** How tall a page's own picture is drawn: its shape for the phone's width, but never more than its
 *  share of the screen. */
export function pictureTopHeight(width: number, screenHeight: number, tall: number): number {
  return Math.round(Math.min(width * tall, screenHeight * PICTURE_TOP_MOST));
}

/** How far the phone's own text-size setting may grow the app's words: the boxes are drawn to a size,
 *  and words past this would spill out of them. */
export const MOST_TEXT_GROWTH = 1.3;
