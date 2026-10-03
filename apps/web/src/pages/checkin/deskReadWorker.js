import jsQR from 'jsqr';
import { readPixels } from './deskRead';

// The desk camera's reader, off the page's own thread: in a dark, grainy picture one read
// can take most of a second, and on the page it would hold up every tap for that long.
// In: one part of a picture. Out: the text of the QR in it, or null.
self.onmessage = (event) => {
  const { id, pixels, width, height, levels } = event.data;
  self.postMessage({ id, text: readPixels(jsQR, new Uint8ClampedArray(pixels), width, height, levels) });
};
