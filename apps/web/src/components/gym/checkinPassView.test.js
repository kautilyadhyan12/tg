// The member's pass, drawn (ROADMAP 16c). The first block reads the drawn code back the
// way a desk's camera does (`jsqr`, the reader the desk page uses), so a pass that is
// drawn but cannot be scanned fails here and not at a gym's front desk.
import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { nextPassDelayMs, passCells, passPath, PASS_CORRECTION, PASS_GOOD_MS, PASS_QUIET_CELLS } from './checkinPassView';

/** The cells as the picture a camera sees: black on white, `scale` pixels a cell. A
 *  `patch` is a square of cells a lamp's glare has turned white. */
function picture(cells, scale = 4, patch = null) {
  const side = (cells.length + PASS_QUIET_CELLS * 2) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  cells.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (!dark) return;
      if (patch !== null && x >= patch.x && x < patch.x + patch.size && y >= patch.y && y < patch.y + patch.size) return;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const at = (((y + PASS_QUIET_CELLS) * scale + dy) * side + (x + PASS_QUIET_CELLS) * scale + dx) * 4;
          pixels[at] = 0;
          pixels[at + 1] = 0;
          pixels[at + 2] = 0;
        }
      }
    });
  });
  return { pixels, side };
}

const read = (cells, patch = null) => {
  const { pixels, side } = picture(cells, 4, patch);
  return jsQR(pixels, side, side)?.data ?? null;
};

// Passes made by the server's own `makePass` (apps/api, 2026-10-03) for random people
// and a throwaway key, not by this file.
const REAL_PASSES = [
  'AHGPLG763ESHTVB2ZAG44DJVO6OZTIBY55AU7C4WIZRMWOB6SNIWULCDANFKYI',
  'AHGPRB32WCZWQNH5DPF72VQT4RBYDABY55AVGD2T7324JFIASG2F7CA45QCLBQ',
  'AHGPLIQVH3B3TFBQRGYIT4QBSLEYBABY55AWLYH5DPJHU5IYRWH74YHME353JM',
];

/** Every letter a pass can hold (base32: A–Z and 2–7), so no character goes undrawn. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const madeUp = (shift) =>
  `AHGP${Array.from({ length: 58 }, (_, i) => ALPHABET[(i * 7 + shift) % ALPHABET.length]).join('')}`;

describe('the pass as a code', () => {
  it.each(REAL_PASSES)('a real pass from the server is read back letter for letter: %s', (pass) => {
    expect(pass).toHaveLength(62);
    const cells = passCells(pass);
    expect(cells).not.toBeNull();
    expect(read(cells)).toBe(pass);
  });

  it.each([0, 1, 5, 13, 31])('a pass using every letter is read back (shift %i)', (shift) => {
    const pass = madeUp(shift);
    expect(read(passCells(pass))).toBe(pass);
  });

  it('two passes one letter apart are two different codes', () => {
    const a = madeUp(0);
    const b = `${a.slice(0, 61)}${a.endsWith('A') ? 'B' : 'A'}`;
    expect(passPath(passCells(a))).not.toBe(passPath(passCells(b)));
    expect(read(passCells(b))).toBe(b);
  });

  it('is square, and small enough for a cheap scanner to read off a phone', () => {
    const cells = passCells(madeUp(3));
    expect(cells.every((row) => row.length === cells.length)).toBe(true);
    // 62 letters fit a version-4 code (33 cells a side) at this error correction.
    expect(cells.length).toBeLessThanOrEqual(37);
  });

  // ROADMAP 16f: a lamp on the phone's glass turns part of the code white. The pass is
  // drawn so a quarter of it may be lost, in the same 33 cells the old one took.
  it('still reads with a patch of glare 11 cells wide on it, which the old pass did not', () => {
    const SIZE = 11;
    const spots = [9, 12, 15, 18].flatMap((x) => [9, 12, 15, 18].map((y) => ({ x, y, size: SIZE })));
    const readsOf = (correction) =>
      REAL_PASSES.flatMap((pass) => spots.map((patch) => read(passCells(pass, correction), patch) === pass)).filter(Boolean).length;
    expect(passCells(REAL_PASSES[0]).length).toBe(passCells(REAL_PASSES[0], 'M').length);
    expect(readsOf('M')).toBeLessThan(5);
    expect(readsOf(PASS_CORRECTION)).toBeGreaterThan(30);
  });

  it('a patch of glare never turns one pass into another: it reads as itself or not at all', () => {
    for (const pass of REAL_PASSES) {
      for (const size of [8, 11, 13, 16]) {
        const got = read(passCells(pass), { x: 10, y: 14, size });
        expect([pass, null]).toContain(got);
      }
    }
  });

  it.each([null, undefined, 42, '', 'ahgplowercase', 'AHGP WITH SPACE', 'AHGP-DASH'])('draws nothing for %j', (value) => {
    expect(passCells(value)).toBeNull();
  });

  it('leaves the white border out of the path’s cells: nothing is drawn in the first four', () => {
    const path = passPath(passCells(madeUp(0)));
    const starts = [...path.matchAll(/M(\d+) (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(starts.length).toBeGreaterThan(100);
    expect(Math.min(...starts.flat())).toBe(PASS_QUIET_CELLS);
  });
});

describe('when the next pass is asked for', () => {
  const NOW = Date.parse('2026-10-03T10:00:00.000Z');
  const inMs = (ms) => new Date(NOW + ms).toISOString();

  it.each([
    ['the window ends in 12 seconds', inMs(12_000), 12_000],
    ['the window ends in 25 seconds', inMs(25_000), 25_000],
    // Never later than 25 s: the next pass has 5 s to arrive before this one comes off.
    ['the window ends in 30 seconds', inMs(30_000), 25_000],
    ['the window ends in 29.5 seconds', inMs(29_500), 25_000],
    // A device clock that is ahead sees the end as already past: never faster than 7 s.
    ['the end looks past by a second', inMs(-1_000), 7_000],
    ['the end looks past by an hour', inMs(-3_600_000), 7_000],
    ['the window ends in 2 seconds', inMs(2_000), 7_000],
    // A device clock that is behind sees the end as far off: never slower than 25 s.
    ['the end looks a minute off', inMs(60_000), 25_000],
    ['the end looks a day off', inMs(86_400_000), 25_000],
    ['the time cannot be read', 'soon', 25_000],
    ['there is no time', undefined, 25_000],
  ])('%s', (_name, refreshAt, expected) => {
    expect(nextPassDelayMs(refreshAt, NOW)).toBe(expected);
  });

  it('waits 25 seconds when this device has no clock to read', () => {
    expect(nextPassDelayMs(inMs(10_000), Number.NaN)).toBe(25_000);
  });

  // The desk takes a pass in its window and the next: one that arrived at the very end
  // of its window is good for 30 seconds more (the api's CHECKIN_PASS_WINDOW_SECONDS).
  it('a pass stays on screen 30 seconds at most, and the next is always asked for before that', () => {
    expect(PASS_GOOD_MS).toBe(30_000);
    for (const refreshAt of [inMs(-3_600_000), inMs(1), inMs(30_000), inMs(86_400_000), 'soon']) {
      expect(nextPassDelayMs(refreshAt, NOW)).toBeLessThanOrEqual(PASS_GOOD_MS - 5_000);
    }
  });
});
