// The photo sheet's unsaved scan, kept for the person who took it (RULINGS
// 2026-09-16): a scan counts the moment the photo is read, so neither closing the
// sheet nor leaving the Nutrition page throws it away — Photo Log brings it back
// while the server can still save it. It lives in this module's memory, above the
// pages and never in browser storage: it holds the scan's token and the person's
// meal photo, and is gone with the tab. It is keyed by the signed-in person
// (utils/storage's id) and forgotten at sign-out, so the next person on a shared
// browser never sees it.
import { MEAL_SCAN_TTL_SECONDS } from '@app/shared';

/** How long after the scan its sheet can be brought back: the scan's lifetime on
 *  the server, less half a minute, so a sheet brought back can still be saved. */
export const UNSAVED_SCAN_KEPT_MS = (MEAL_SCAN_TTL_SECONDS - 30) * 1000;

let kept = null;

/** Keep this person's unsaved sheet, as it stands, with when it was scanned. */
export function keepUnsavedScan(userId, scannedAt, sheet) {
  kept = { userId, scannedAt, sheet };
}

/** The unsaved sheet this person can still pick up at `now`, or null. */
export function unsavedScanFor(userId, now) {
  if (kept === null || kept.userId !== userId || now - kept.scannedAt >= UNSAVED_SCAN_KEPT_MS) return null;
  return kept;
}

/** Forget it: saved, started over, expired, or signed out. */
export function forgetUnsavedScan() {
  kept = null;
}

/** What is left, in ms, of a scan taken at `scannedAt`, at `now`. */
export const unsavedScanMsLeft = (scannedAt, now) => Math.max(0, UNSAVED_SCAN_KEPT_MS - (now - scannedAt));

/** How the close question says what is left: whole minutes, never rounded up, so
 *  it never promises more time than there is; under a minute; or nothing left. */
export function timeLeftText(msLeft) {
  if (msLeft <= 0) return null;
  const minutes = Math.floor(msLeft / 60000);
  if (minutes < 1) return 'Less than a minute is left to open Photo Log again and pick up where you left off.';
  return `Open Photo Log again within ${minutes} minute${minutes === 1 ? '' : 's'} to pick up where you left off.`;
}
