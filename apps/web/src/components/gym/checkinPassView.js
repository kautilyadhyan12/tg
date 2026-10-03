// Pure rules for the member's check-in pass (spec Part 3 §12.2; ROADMAP 16c) — no React,
// no network, tested directly.
import qrcode from 'qrcode-generator';

/** White cells left round the code: the QR standard asks for four, and a desk scanner
 *  reading a phone needs them. */
export const PASS_QUIET_CELLS = 4;

/** The pass as a QR code's cells, `true` where a cell is dark, or null when it cannot be
 *  drawn. A pass is uppercase letters and digits, which a QR packs most tightly. */
export function passCells(pass) {
  if (typeof pass !== 'string' || !/^[A-Z0-9]+$/.test(pass)) return null;
  try {
    const code = qrcode(0, 'M');
    code.addData(pass, 'Alphanumeric');
    code.make();
    const size = code.getModuleCount();
    return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => code.isDark(row, col)));
  } catch {
    return null;
  }
}

/** The dark cells as one SVG path, in cell units, inside the quiet border. */
export function passPath(cells) {
  const parts = [];
  cells.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${String(x + PASS_QUIET_CELLS)} ${String(y + PASS_QUIET_CELLS)}h1v1h-1z`);
    });
  });
  return parts.join('');
}

/** How long a pass may stay on screen. The desk takes a pass in its own 30-second window
 *  and the next, so one that arrived at the very end of its window is good for 30 more
 *  seconds and no longer; this device's clock is not trusted to say more. */
export const PASS_GOOD_MS = 30_000;

const SOONEST_MS = 7_000;
const LATEST_MS = 25_000;

/** How long to wait before asking for the next pass. The server says when this one's
 *  window ends; this device's clock may be wrong, so the wait is held between 7 and 25
 *  seconds whatever it says: 25 leaves the next pass 5 seconds to arrive before this one
 *  is taken off the screen (`PASS_GOOD_MS`), and 7 keeps a wrong clock under the
 *  server's 10 passes a minute. */
export function nextPassDelayMs(refreshAt, nowMs) {
  const at = typeof refreshAt === 'string' ? Date.parse(refreshAt) : Number.NaN;
  if (Number.isNaN(at) || !Number.isFinite(nowMs)) return LATEST_MS;
  return Math.min(LATEST_MS, Math.max(SOONEST_MS, at - nowMs));
}
