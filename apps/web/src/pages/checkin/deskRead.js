// HOW THE DESK'S CAMERA IS READ (spec Part 3 §12.3; ROADMAP 16f). Pure: DeskCamera draws
// the part of the picture `readPlan` names, and `tools/measure-desk-reads.mjs` reads made
// pictures the same way, so the numbers in HANDOFF are of this file's own settings.

/** What the camera is asked for. A browser asked for no size gives 640 × 480, where a pass
 *  held at arm's length is two or three pixels a square. A tablet at the desk faces the
 *  member, so its front camera is the one that sees the pass; a computer has one camera,
 *  and `ideal` takes whatever it has. */
export const CAMERA_ASK = {
  video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  audio: false,
};

/** Reads a second at most. */
export const READS_PER_SECOND = 10;

/** The whole picture is read at this width at most. */
export const WHOLE_WIDTH = 640;
/** The middle of the picture, this share of its shorter side, is read at the camera's own
 *  sharpness: a pass held further away is small in the whole picture and big enough here. */
export const MIDDLE_SHARE = 0.6;

/** The ways one picture is read, in turn. `levels` is `applyLevels`' share, 0 for the
 *  picture as it is. A phone's screen in a dim room comes out washed and grainy, which the
 *  reader cannot make out until the grey is pulled apart from the white (0.85); a small
 *  pass in good light wants less (0.5); a lamp's glare reads best as it is. */
export const READ_WAYS = [
  { part: 'whole', levels: 0.85 },
  { part: 'middle', levels: 0.85 },
  { part: 'whole', levels: 0 },
  { part: 'middle', levels: 0 },
  { part: 'whole', levels: 0.5 },
  { part: 'middle', levels: 0.5 },
];

/** The part of a `videoWidth` × `videoHeight` picture one way reads, and the size to read
 *  it at. */
export function readPlan(videoWidth, videoHeight, way) {
  if (way.part === 'middle') {
    const side = Math.round(Math.min(videoWidth, videoHeight) * MIDDLE_SHARE);
    return {
      sx: Math.round((videoWidth - side) / 2),
      sy: Math.round((videoHeight - side) / 2),
      sw: side,
      sh: side,
      width: side,
      height: side,
    };
  }
  const scale = Math.min(1, WHOLE_WIDTH / videoWidth);
  return { sx: 0, sy: 0, sw: videoWidth, sh: videoHeight, width: Math.round(videoWidth * scale), height: Math.round(videoHeight * scale) };
}

/** Turns a picture's pixels (RGBA, changed in place) to grey with everything darker than
 *  `share` of its brightest hundredth made black, and the rest spread from black to white. */
export function applyLevels(pixels, share) {
  const counts = new Uint32Array(256);
  for (let at = 0; at < pixels.length; at += 4) {
    const grey = (pixels[at] * 2 + pixels[at + 1] * 5 + pixels[at + 2]) >> 3;
    pixels[at] = grey;
    counts[grey] += 1;
  }
  const brightest = pixels.length / 4 / 100;
  let top = 255;
  for (let seen = counts[top]; top > 0 && seen < brightest; seen += counts[top]) top -= 1;
  const floor = top * share;
  const span = Math.max(1, top - floor);
  const table = new Uint8ClampedArray(256);
  for (let grey = 0; grey < 256; grey += 1) table[grey] = ((grey - floor) / span) * 255;
  for (let at = 0; at < pixels.length; at += 4) {
    const level = table[pixels[at]];
    pixels[at] = level;
    pixels[at + 1] = level;
    pixels[at + 2] = level;
  }
}

/** A read that found nothing rests this many times as long as it took. In a dark, grainy
 *  picture some ways take half a second and find nothing; resting them keeps the page
 *  answering and leaves the turns to the ways that are quick there. */
export const REST_TIMES = 15;

/** Which way reads next: the first after `last`, in order, that has rested (`restUntil[i]`
 *  is when way `i` may read again), or -1 when every way is resting. */
export function nextWay(last, restUntil, now) {
  for (let step = 1; step <= READ_WAYS.length; step += 1) {
    const way = (last + step) % READ_WAYS.length;
    if ((restUntil[way] ?? 0) <= now) return way;
  }
  return -1;
}
