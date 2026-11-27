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

/** The least height a whole picture is drawn at, however little room is left: a wide screen still shows the person. */
export const WHOLE_PICTURE_LEAST = 160;

/** How tall a whole picture is drawn under a page's top buttons (an exercise's own picture, 62a): its own shape for the
 *  phone's width, but the picture and the space above it never more than a page picture's share of the screen, and
 *  never under the least. The picture is fitted whole inside it, never cut. */
export function wholePictureHeight(width: number, screenHeight: number, picture: { width: number; height: number }, above: number): number {
  const own = (width * picture.height) / picture.width;
  const room = screenHeight * PICTURE_TOP_MOST - above;
  return Math.round(Math.max(WHOLE_PICTURE_LEAST, Math.min(own, room)));
}

/** The most of the screen's height an exercise's own picture or clip takes at the top of a workout (62b): measured on
 *  Kd's phone (432 × 960), the count, its target and weight, Next up and Set done all stay in view under it. */
export const WORKOUT_PICTURE_SHARE = 0.29;

/** How tall an exercise's own picture or clip is drawn at the top of a workout: its own shape for the phone's width, but
 *  never more than its share of the screen, and never under the least unless its own shape is smaller. Fitted whole. */
export function workoutPictureHeight(width: number, screenHeight: number, picture: { width: number; height: number }): number {
  const own = (width * picture.height) / picture.width;
  return Math.round(Math.min(own, Math.max(WHOLE_PICTURE_LEAST, screenHeight * WORKOUT_PICTURE_SHARE)));
}

/** The tallest an event's poster is drawn, before the share of the screen it may take. */
export const POSTER_TALLEST = 420;

/** How tall an event's poster box is in a card this wide: its own shape, but never past the tallest or a page
 *  picture's share of the screen. With the width not known yet, the most it could be. */
export function posterHeight(cardWidth: number | null, poster: { width: number; height: number }, screenHeight: number): number {
  const most = Math.min(POSTER_TALLEST, screenHeight * PICTURE_TOP_MOST);
  return Math.round(cardWidth === null ? most : Math.min(most, (cardWidth * poster.height) / poster.width));
}

/** How tall a page or box over the app is. It is drawn behind the phone's bars, so where the window leaves only them out
 *  (older Android) it takes the screen's height; where the app has a share of the screen (split screen), the window's. */
export function modalHeight(screen: number, window: number, bars: number): number {
  return screen - window <= bars ? screen : window;
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

/** The camera screen (53a, Kd's drawing of 2026-11-26), read from 2 to 3 metres: the count's digits and the reference clip's
 *  tile in the top corners, as drawn on Kd's phone (432 × 960), never taking more of a short or opened phone's height than
 *  they took there, so the person below them stays in view. */
export const CAMERA_DIGITS = 112;
export const CAMERA_TILE = { width: 132, height: 235 } as const;
export function cameraSizes(screenHeight: number): { digits: number; tile: { width: number; height: number } } {
  const digits = Math.round(Math.min(CAMERA_DIGITS, screenHeight * (CAMERA_DIGITS / 960)));
  const tall = Math.round(Math.min(CAMERA_TILE.height, screenHeight * (CAMERA_TILE.height / 960)));
  return { digits, tile: { width: Math.round((tall * CAMERA_TILE.width) / CAMERA_TILE.height), height: tall } };
}
