// The photo shrink, with a fake window: the node test environment has no
// Image, canvas or object URLs, and jsdom's canvas draws nothing either, so
// the drawing half is proved by what it asks the browser to do.
import { describe, expect, it } from 'vitest';
import { JPEG_QUALITY, MAX_EDGE_PX, fitWithin, shrinkPhoto } from './shrinkPhoto';

describe('fitWithin', () => {
  it('shrinks the longest side to 768 and keeps the shape', () => {
    expect(fitWithin(3000, 4000)).toEqual({ width: 576, height: 768 });
    expect(fitWithin(4000, 3000)).toEqual({ width: 768, height: 576 });
    expect(fitWithin(4032, 4032)).toEqual({ width: 768, height: 768 });
  });

  it('never enlarges a small picture and never returns a zero side', () => {
    expect(fitWithin(500, 400)).toEqual({ width: 500, height: 400 });
    expect(fitWithin(768, 768)).toEqual({ width: 768, height: 768 });
    expect(fitWithin(769, 1)).toEqual({ width: 768, height: 1 });
    expect(MAX_EDGE_PX).toBe(768);
  });
});

/** A window whose Image decodes to the given size and whose canvas records
 *  what is drawn on it and hands back a JPEG blob. */
function fakeDom({ width, height, decodes = true, blob = new Blob(['jpeg-bytes'], { type: 'image/jpeg' }) }) {
  const calls = { fills: [], draws: [], toBlob: [], revoked: [] };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      set fillStyle(v) { calls.fillStyle = v; },
      fillRect: (...args) => calls.fills.push(args),
      drawImage: (...args) => calls.draws.push(args),
    }),
    toBlob: (cb, type, quality) => { calls.toBlob.push([type, quality]); cb(blob); },
  };
  class Image {
    constructor() { this.naturalWidth = 0; this.naturalHeight = 0; this.src = ''; }
    decode() {
      if (!decodes) return Promise.reject(new Error('EncodingError'));
      this.naturalWidth = width;
      this.naturalHeight = height;
      return Promise.resolve();
    }
  }
  const dom = {
    Image,
    document: { createElement: (tag) => { if (tag !== 'canvas') throw new Error(tag); return canvas; } },
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: (u) => calls.revoked.push(u) },
  };
  return { dom, canvas, calls };
}

describe('shrinkPhoto', () => {
  it('draws a 3000×4000 photo at 576×768 on white, as a JPEG at quality 0.85, and frees the object URL', async () => {
    const { dom, canvas, calls } = fakeDom({ width: 3000, height: 4000 });
    const out = await shrinkPhoto(new Blob(['raw'], { type: 'image/png' }), dom);
    expect(out.type).toBe('image/jpeg');
    expect([canvas.width, canvas.height]).toEqual([576, 768]);
    expect(calls.fillStyle).toBe('#ffffff');
    expect(calls.fills).toEqual([[0, 0, 576, 768]]);
    expect(calls.draws).toHaveLength(1);
    expect(calls.draws[0].slice(1)).toEqual([0, 0, 576, 768]);
    expect(calls.draws[0][0]).toBeInstanceOf(dom.Image);
    expect(calls.toBlob).toEqual([['image/jpeg', JPEG_QUALITY]]);
    expect(calls.revoked).toEqual(['blob:fake']);
  });

  it('keeps a small photo at its own size', async () => {
    const { dom, canvas } = fakeDom({ width: 640, height: 480 });
    await shrinkPhoto(new Blob(['raw'], { type: 'image/jpeg' }), dom);
    expect([canvas.width, canvas.height]).toEqual([640, 480]);
  });

  it('says the picture could not be read when the browser cannot decode it, and still frees the URL', async () => {
    const { dom, calls } = fakeDom({ width: 0, height: 0, decodes: false });
    await expect(shrinkPhoto(new Blob(['raw'], { type: 'image/jpeg' }), dom)).rejects.toThrow('Could not read the image file');
    expect(calls.revoked).toEqual(['blob:fake']);
  });

  it('says the picture could not be read when the canvas gives no JPEG back', async () => {
    const { dom } = fakeDom({ width: 100, height: 100, blob: null });
    await expect(shrinkPhoto(new Blob(['raw'], { type: 'image/jpeg' }), dom)).rejects.toThrow('Could not read the image file');
  });
});
