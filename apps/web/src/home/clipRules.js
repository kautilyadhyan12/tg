// THE CLIPS NEVER HOLD THE PAGE UP (Kd, 2026-11-14: "the site should not slow down or stop loading because of heavy
// videos"). Every room is a still picture first; its clip is extra. The rule, kept apart from the page so it is tested
// case by case (`clipRules.test.js`):
//  - no clip starts downloading until the page itself has loaded;
//  - only the room on screen downloads its clip, and only once it has been there a moment, so racing past costs nothing;
//  - a data saver, a 2G connection, Reduce motion, or a connection slower than 1.5 Mbit/s gets the still pictures only.
//    The speed is measured from how fast this page's own pictures arrived (the browser's own guess read "3g" on a fast
//    line); when they came from the browser's cache and cannot be measured, the browser's own estimate decides.

/** Under this many megabits a second, a visit gets the still pictures only. */
export const SLOW_MBITS = 1.5;
/** How long a room is on screen before its clip may start downloading, in seconds. */
export const SETTLE_SECONDS = 0.35;
/** Pictures smaller than this are too quick to time. */
const MEASURABLE_BYTES = 15000;

/**
 * Megabits a second, from the page's own pictures as the browser timed them (`performance.getEntriesByType('resource')`),
 * or null when fewer than two of them came over the network. Only the time something was arriving counts: a pause
 * between two downloads is not slowness.
 */
export function measuredMbits(entries) {
  const got = (entries || []).filter((e) => /\.webp(\?|$)/.test(e.name) && e.transferSize > MEASURABLE_BYTES && e.responseEnd > e.responseStart);
  if (got.length < 2) return null;
  const spans = got.map((e) => [e.responseStart, e.responseEnd]).sort((x, y) => x[0] - y[0]);
  let ms = 0, end = -Infinity;
  for (const [start, finish] of spans) {
    if (finish <= end) continue;
    ms += finish - Math.max(start, end);
    end = finish;
  }
  const bytes = got.reduce((sum, e) => sum + e.transferSize, 0);
  return ms > 0 ? (bytes * 8) / ms / 1000 : null;
}

/** Whether this visit gets the still pictures only. `connection`: `navigator.connection`, where the browser has one. */
export function picturesOnly({ reduceMotion = false, connection = null, entries = [] } = {}) {
  if (reduceMotion) return true;
  const c = connection || {};
  if (c.saveData) return true;
  if (/2g$/.test(c.effectiveType || '')) return true;
  const mbits = measuredMbits(entries);
  if (mbits !== null) return mbits < SLOW_MBITS;
  return typeof c.downlink === 'number' && c.downlink > 0 && c.downlink < SLOW_MBITS;
}

/** Whether a room's clip may start downloading now. */
export function mayLoadClip({ pageLoaded = false, hidden = false, onScreenFor = 0 } = {}) {
  return pageLoaded && !hidden && onScreenFor >= SETTLE_SECONDS;
}
