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

const SOONEST_MS = 7_000;
const LATEST_MS = 30_000;

/** How long to wait before asking for the next pass. The server says when this one's
 *  window ends; this device's clock may be wrong, so the wait is held between 7 and 30
 *  seconds whatever it says. A pass is good for its window and the next, so one asked for
 *  at most 30 seconds ago is still good; and 7 seconds keeps a wrong clock under the
 *  server's 10 passes a minute. */
export function nextPassDelayMs(refreshAt, nowMs) {
  const at = typeof refreshAt === 'string' ? Date.parse(refreshAt) : Number.NaN;
  if (Number.isNaN(at) || !Number.isFinite(nowMs)) return LATEST_MS;
  return Math.min(LATEST_MS, Math.max(SOONEST_MS, at - nowMs));
}
