// How the desk's camera reads a picture (ROADMAP 16f). The reads themselves are measured
// on made pictures by `tools/measure-desk-reads.mjs`; these hold the rules it relies on.
import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { passCells, PASS_QUIET_CELLS } from '../../components/gym/checkinPassView';
import { CAMERA_ASK, MIDDLE_SHARE, READ_WAYS, REST_TIMES, WHOLE_WIDTH, applyLevels, nextWay, readPlan } from './deskRead';

const PASS = 'AHGPLG763ESHTVB2ZAG44DJVO6OZTIBY55AU7C4WIZRMWOB6SNIWULCDANFKYI';

describe('what the camera is asked for', () => {
  it('a sharper picture than the 640 × 480 a browser gives by itself, from the front camera, with no sound', () => {
    expect(CAMERA_ASK.video.width.ideal).toBeGreaterThanOrEqual(1280);
    expect(CAMERA_ASK.video.height.ideal).toBeGreaterThanOrEqual(720);
    expect(CAMERA_ASK.video.facingMode).toEqual({ ideal: 'user' });
    expect(CAMERA_ASK.audio).toBe(false);
  });
});

describe('the part of the picture one way reads', () => {
  const whole = { part: 'whole', levels: 0 };
  const middle = { part: 'middle', levels: 0 };

  it.each([
    [1280, 720],
    [1920, 1080],
    [640, 480],
    [720, 1280],
    [320, 240],
  ])('%i × %i: the whole picture, never bigger than it is; the middle at the camera’s own sharpness', (width, height) => {
    const all = readPlan(width, height, whole);
    expect([all.sx, all.sy, all.sw, all.sh]).toEqual([0, 0, width, height]);
    expect(all.width).toBe(Math.min(width, WHOLE_WIDTH));
    expect(all.width / all.height).toBeCloseTo(width / height, 1);

    const mid = readPlan(width, height, middle);
    expect(mid.sw).toBe(Math.round(Math.min(width, height) * MIDDLE_SHARE));
    expect([mid.width, mid.height]).toEqual([mid.sw, mid.sh]);
    // In the middle, and inside the picture.
    expect(mid.sx + mid.sw / 2).toBeCloseTo(width / 2, 0);
    expect(mid.sy + mid.sh / 2).toBeCloseTo(height / 2, 0);
    expect(mid.sx).toBeGreaterThanOrEqual(0);
    expect(mid.sy).toBeGreaterThanOrEqual(0);
  });

  it('every way is the whole picture or its middle, and both are read as they are too', () => {
    expect(new Set(READ_WAYS.map((way) => way.part))).toEqual(new Set(['whole', 'middle']));
    expect(READ_WAYS.filter((way) => way.levels === 0).map((way) => way.part).sort()).toEqual(['middle', 'whole']);
  });
});

/** A pass as a washed-out phone screen: white squares at 255 and dark ones at `dark`. */
function washedPicture(dark) {
  const cells = passCells(PASS);
  const scale = 6;
  const side = (cells.length + PASS_QUIET_CELLS * 2) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  cells.forEach((row, y) => {
    row.forEach((isDark, x) => {
      if (!isDark) return;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const at = (((y + PASS_QUIET_CELLS) * scale + dy) * side + (x + PASS_QUIET_CELLS) * scale + dx) * 4;
          pixels[at] = dark;
          pixels[at + 1] = dark;
          pixels[at + 2] = dark;
        }
      }
    });
  });
  return { pixels, side };
}

describe('pulling the grey apart from the white', () => {
  it('everything darker than the share of the brightest goes black, the brightest stays white', () => {
    // 100 pixels: 96 grey (4 levels), 4 white.
    const greys = [40, 120, 160, 200];
    const pixels = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 100; i += 1) {
      const level = i < 96 ? greys[i % 4] : 255;
      pixels.set([level, level, level, 255], i * 4);
    }
    applyLevels(pixels, 0.5);
    const out = (i) => pixels[i * 4];
    expect(out(0)).toBe(0);
    expect(out(1)).toBe(0);
    expect(out(2)).toBeGreaterThan(0);
    expect(out(2)).toBeLessThan(out(3));
    expect(out(3)).toBeLessThan(255);
    expect(out(99)).toBe(255);
    // Grey in every channel, and the fourth left alone.
    expect([pixels[8], pixels[9], pixels[10], pixels[11]]).toEqual([out(2), out(2), out(2), 255]);
  });

  it('a colour picture comes out grey', () => {
    const pixels = new Uint8ClampedArray([200, 40, 40, 255, 255, 255, 255, 255]);
    applyLevels(pixels, 0.1);
    expect(pixels[0]).toBe(pixels[1]);
    expect(pixels[1]).toBe(pixels[2]);
  });

  it('a pass whose dark squares are washed to light grey still reads after it', () => {
    const { pixels, side } = washedPicture(215);
    applyLevels(pixels, 0.85);
    expect(jsQR(pixels, side, side, { inversionAttempts: 'dontInvert' })?.data).toBe(PASS);
    // Black squares on white, as a pass in good light: nothing in between is left.
    expect(new Set(pixels.filter((_, at) => at % 4 === 0))).toEqual(new Set([0, 255]));
  });

  it('a picture of one flat colour does not break it', () => {
    const pixels = new Uint8ClampedArray(64 * 4).fill(0);
    expect(() => applyLevels(pixels, 0.85)).not.toThrow();
    expect(() => applyLevels(new Uint8ClampedArray(0), 0.85)).not.toThrow();
  });
});

describe('whose turn it is', () => {
  const ways = READ_WAYS.length;
  const rested = READ_WAYS.map(() => 0);

  it('each way in turn while none is resting', () => {
    const order = [];
    let last = -1;
    for (let n = 0; n < ways * 2; n += 1) {
      last = nextWay(last, rested, 1000);
      order.push(last);
    }
    expect(order).toEqual([...READ_WAYS.keys(), ...READ_WAYS.keys()]);
  });

  it('a way that is resting is passed over, and comes back when its rest is over', () => {
    const restUntil = [...rested];
    restUntil[1] = 5000;
    expect(nextWay(0, restUntil, 1000)).toBe(2);
    expect(nextWay(0, restUntil, 5000)).toBe(1);
  });

  it('nothing reads while every way is resting', () => {
    expect(nextWay(0, READ_WAYS.map(() => 5000), 1000)).toBe(-1);
  });

  it('the way that just read goes again when the rest are resting', () => {
    const restUntil = READ_WAYS.map(() => 5000);
    restUntil[3] = 0;
    expect(nextWay(3, restUntil, 1000)).toBe(3);
  });

  it('a slow read that finds nothing leaves the page most of its time', () => {
    // Every way slow at once uses 1 part in REST_TIMES each.
    expect(ways / REST_TIMES).toBeLessThan(0.5);
  });
});
