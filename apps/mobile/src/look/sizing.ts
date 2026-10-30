// How the look fits phones of every size (Kd, 2026-10-28: other phones, foldables, the iPhone Duo).
// Pure, so tested alone.
import { sizes } from "./colours";

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

/** How far a middle box's insides stand from the screen's sides: the page's edge, then its own padding. */
export const MIDDLE_INSET = sizes.edge * 2;

/** The most of the screen's height the pass's code takes, so its words and Close stay on screen. */
export const PASS_MOST = 0.5;

/** How wide the pass's code is drawn: the sheet's whole width, but never more than its share of the
 *  screen's height (an opened Fold, a phone on its side). */
export function passSide(width: number, screenHeight: number, edge: number): number {
  return Math.round(Math.max(0, Math.min(width - edge * 2, screenHeight * PASS_MOST)));
}

/** The most of the screen's height a receipt in the middle box takes before it scrolls, so its title and Done stay
 *  on screen. */
export const RECEIPT_MOST = 0.6;

/** The most of the screen's height a question in the middle box takes before it scrolls (Report's reasons and its
 *  note), so its title and buttons stay on screen. */
export const ASK_MOST = 0.6;
