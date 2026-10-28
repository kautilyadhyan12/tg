// The member's pass as a QR code (spec Part 3 §12.2), and when to ask for the next. Pure, so tested
// alone; the browser's rules are the same (apps/web/src/components/gym/checkinPassView.js).
import qrcode from "qrcode-generator";

/** White cells left round the code: the QR standard asks for four, and a desk scanner needs them. */
export const PASS_QUIET_CELLS = 4;

/** A quarter of the code may be lost and it still reads, so a patch of glare does not stop it. */
export const PASS_CORRECTION = "Q";

/** The pass as the code's cells, `true` where a cell is dark, or null when it cannot be drawn. A pass
 *  is capital letters and digits, which a QR code packs most tightly. */
export function passCells(pass: string): boolean[][] | null {
  if (!/^[A-Z0-9]+$/.test(pass)) return null;
  try {
    const code = qrcode(0, PASS_CORRECTION);
    code.addData(pass, "Alphanumeric");
    code.make();
    const size = code.getModuleCount();
    return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => code.isDark(row, col)));
  } catch {
    return null;
  }
}

/** The dark cells as one SVG path, in cell units, inside the quiet border. */
export function passPath(cells: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  cells.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${String(x + PASS_QUIET_CELLS)} ${String(y + PASS_QUIET_CELLS)}h1v1h-1z`);
    });
  });
  return parts.join("");
}

/** How long a pass may stay on screen. The desk takes a pass in its own 30-second window and the
 *  next, so one that arrived at the very end of its window is good for 30 seconds more; this phone's
 *  clock is not trusted to say more. */
export const PASS_GOOD_MS = 30_000;

const SOONEST_MS = 7_000;
const LATEST_MS = 25_000;

/** How long to wait before asking for the next pass. The server says when this one's window ends;
 *  the phone's clock may be wrong, so the wait is held between 7 and 25 seconds: 25 leaves the next
 *  pass 5 seconds to arrive before this one comes off, and 7 keeps a wrong clock under the server's
 *  10 passes a minute. */
export function nextPassDelayMs(refreshAt: string, nowMs: number): number {
  const at = Date.parse(refreshAt);
  if (Number.isNaN(at) || !Number.isFinite(nowMs)) return LATEST_MS;
  return Math.min(LATEST_MS, Math.max(SOONEST_MS, at - nowMs));
}
