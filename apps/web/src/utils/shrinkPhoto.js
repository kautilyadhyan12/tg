// A meal photo goes up as the scanner reads it: no longer than 768 px on its
// longest side, as a JPEG (RULINGS 2026-08-24: photos are resized). A phone's
// photo is several megabytes; this one is about a hundred kilobytes, so the
// scan starts sooner on mobile data, and re-drawing the picture leaves the
// camera's own tags (where and when it was taken) behind on the phone. The
// browser turns the picture the way the phone's orientation tag says before
// drawing it, so a portrait plate stays upright. The pure half, fitWithin,
// is tested directly; the drawing half takes its window so a test can hand
// it a fake one.

export const MAX_EDGE_PX = 768;
export const JPEG_QUALITY = 0.85;
const UNREADABLE = 'Could not read the image file';

/** The size a width × height picture shrinks to so its longest side is at most
 *  maxEdge, never enlarged, never below one pixel. */
export function fitWithin(width, height, maxEdge = MAX_EDGE_PX) {
  const longest = Math.max(width, height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** file (a File or Blob the browser can show) → a JPEG Blob no longer than
 *  MAX_EDGE_PX on its longest side. Rejects with one plain message when the
 *  picture cannot be read or drawn. */
export async function shrinkPhoto(file, dom = globalThis) {
  const url = dom.URL.createObjectURL(file);
  try {
    const img = new dom.Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error(UNREADABLE);
    }
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight);
    const canvas = dom.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(UNREADABLE);
    // A JPEG has no transparency: a see-through PNG lands on white, not black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error(UNREADABLE);
    return blob;
  } finally {
    dom.URL.revokeObjectURL(url);
  }
}
