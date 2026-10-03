// How often the desk's camera reads a pass (ROADMAP 16f): made pictures of a real pass on a
// phone, in poor light, read the way DeskCamera reads them (`jsqr`, `deskRead.js`).
//
//   node apps/web/tools/measure-desk-reads.mjs            100 pictures a row
//   node apps/web/tools/measure-desk-reads.mjs 30         30 pictures a row
//   node apps/web/tools/measure-desk-reads.mjs --video dim.y4m "dim room, held close"
//       one row as a video that Chrome or Edge plays as its camera, to try the real desk
//       page: --use-fake-ui-for-media-stream --use-fake-device-for-media-stream
//       --use-file-for-fake-video-capture=dim.y4m
//
// Three columns: BEFORE (a 640 × 480 picture read whole, the pass as 16c drew it) · CAMERA
// (this job's camera settings, the old pass) · BOTH (and this job's pass). A picture counts
// as read when one of the camera's ways of reading it gives the pass letter for letter.
// Under each row, how long `jsqr` worked on one picture, in milliseconds on this machine.
//
// These are MADE pictures, not a camera's: the light is a model (a bright screen in a dark
// room washes out and the picture is grainy, a lamp leaves a white patch on the glass, a
// moving hand blurs). They rank settings against each other; the real test is a phone at a
// desk.
import { writeFileSync } from 'node:fs';
import jsQR from 'jsqr';
import { PASS_CORRECTION, PASS_QUIET_CELLS, passCells } from '../src/components/gym/checkinPassView.js';
import { READ_WAYS, readPixels, readPlan } from '../src/pages/checkin/deskRead.js';

const PICTURES = Number(process.argv[2] ?? 100);

// A pass made by the server's own `makePass` (the first of checkinPassView.test.js's).
const PASS = 'AHGPLG763ESHTVB2ZAG44DJVO6OZTIBY55AU7C4WIZRMWOB6SNIWULCDANFKYI';

/** How much bigger this job draws the pass on a 360-wide phone than 16c did (320 / 280). */
const BIGGER = 320 / 280;

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boxBlur(src, width, height, radius) {
  const r = Math.round(radius);
  if (r < 1) return src;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = r * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = -r; x <= r; x += 1) sum += src[y * width + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x += 1) {
      tmp[y * width + x] = sum / span;
      sum += src[y * width + Math.min(width - 1, x + r + 1)] - src[y * width + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -r; y <= r; y += 1) sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / span;
      sum += tmp[Math.min(height - 1, y + r + 1) * width + x] - tmp[Math.max(0, y - r) * width + x];
    }
  }
  return out;
}

/** One camera picture, as grey levels 0–255. `scene` holds everything random, so each
 *  column sees the same hand in the same place. */
function picture(width, height, cells, scene, light) {
  const side = cells.length + PASS_QUIET_CELLS * 2;
  const sidePx = scene.share * scene.grow * height;
  const cx = width / 2 + scene.dx * height;
  const cy = height / 2 + scene.dy * height;
  const cos = Math.cos(scene.turn);
  const sin = Math.sin(scene.turn);
  const reach = sidePx * 0.75;
  let lum = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const room = light.room * (1 + 0.3 * Math.sin(x / (width / 5) + scene.dx * 9));
      if (Math.abs(x - cx) > reach || Math.abs(y - cy) > reach) {
        lum[y * width + x] = room;
        continue;
      }
      let sum = 0;
      for (let s = 0; s < 4; s += 1) {
        const px = x + 0.25 + (s % 2) * 0.5 - cx;
        const py = y + 0.25 + (s >> 1) * 0.5 - cy;
        const u = ((px * cos + py * sin) / sidePx + 0.5) * side;
        const v = ((-px * sin + py * cos) / sidePx + 0.5) * side;
        if (u < 0 || v < 0 || u >= side || v >= side) {
          sum += room;
          continue;
        }
        const col = Math.floor(u) - PASS_QUIET_CELLS;
        const row = Math.floor(v) - PASS_QUIET_CELLS;
        const dark = row >= 0 && col >= 0 && row < cells.length && col < cells.length && cells[row][col];
        let level = dark ? 0.04 : 1;
        if (light.glare > 0) {
          // A lamp on the glass: a white patch with a soft edge, somewhere on the pass.
          const gu = (u / side - scene.gx) / light.glare;
          const gv = (v / side - scene.gy) / light.glare;
          level += 3 * Math.exp(-(gu * gu + gv * gv) * 2);
        }
        sum += level;
      }
      lum[y * width + x] = sum / 4;
    }
  }
  if (light.wash > 0) {
    // A bright screen in a dark room spreads into the dark squares beside it.
    const spread = boxBlur(lum, width, height, height * 0.04);
    for (let i = 0; i < lum.length; i += 1) lum[i] += light.wash * spread[i];
  }
  lum = boxBlur(lum, width, height, light.blur * height);
  // The camera sets its own exposure from the whole picture, as a webcam does.
  let mean = 0;
  for (let i = 0; i < lum.length; i += 1) mean += lum[i];
  mean /= lum.length;
  const gain = Math.min(8, Math.max(0.5, 0.4 / mean));
  const noise = seeded(scene.noiseSeed);
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0; i < lum.length; i += 1) {
    const grain = Math.sqrt(-2 * Math.log(noise() + 1e-9)) * Math.cos(2 * Math.PI * noise()) * light.noise;
    const seen = Math.min(1, Math.max(0, lum[i] * gain + grain));
    out[i] = 255 * seen ** (1 / 2.2);
  }
  return out;
}

let jsqrMs = 0;

/** One part of the picture at the size `plan` asks, as the canvas hands it to `jsqr`. */
function readPart(grey, width, plan, levels) {
  const rgba = new Uint8ClampedArray(plan.width * plan.height * 4);
  const stepX = plan.sw / plan.width;
  const stepY = plan.sh / plan.height;
  for (let y = 0; y < plan.height; y += 1) {
    const y0 = Math.floor(plan.sy + y * stepY);
    const y1 = Math.max(y0 + 1, Math.floor(plan.sy + (y + 1) * stepY));
    for (let x = 0; x < plan.width; x += 1) {
      const x0 = Math.floor(plan.sx + x * stepX);
      const x1 = Math.max(x0 + 1, Math.floor(plan.sx + (x + 1) * stepX));
      let sum = 0;
      for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) sum += grey[yy * width + xx];
      const level = sum / ((y1 - y0) * (x1 - x0));
      const at = (y * plan.width + x) * 4;
      rgba[at] = level;
      rgba[at + 1] = level;
      rgba[at + 2] = level;
      rgba[at + 3] = 255;
    }
  }
  const from = performance.now();
  const text = readPixels(jsQR, rgba, plan.width, plan.height, levels);
  jsqrMs += performance.now() - from;
  return text;
}

const cameras = {
  // 16c's desk: the 640 × 480 a browser gives when asked for no size, read whole.
  before: { width: 640, height: 480, ways: [{ part: 'whole', levels: 0 }] },
  after: { width: 1280, height: 720, ways: READ_WAYS },
};

function reads(camera, cells, scene, light) {
  const grey = picture(camera.width, camera.height, cells, scene, light);
  return camera.ways.some((way) => readPart(grey, camera.width, readPlan(camera.width, camera.height, way), way.levels) === PASS);
}

// `share` is how much of the picture's height the pass takes: a phone held close, at arm's
// length from a laptop, or further.
const ROWS = [
  { name: 'good light, held close', share: [0.45, 0.6], light: { room: 0.35, wash: 0, noise: 0.01, blur: 0.002, glare: 0 } },
  { name: 'good light, arm’s length', share: [0.2, 0.3], light: { room: 0.35, wash: 0, noise: 0.01, blur: 0.002, glare: 0 } },
  { name: 'good light, far', share: [0.12, 0.2], light: { room: 0.35, wash: 0, noise: 0.01, blur: 0.002, glare: 0 } },
  { name: 'dim room, held close', share: [0.45, 0.6], light: { room: 0.03, wash: 0.05, noise: 0.06, blur: 0.002, glare: 0 } },
  { name: 'dim room, arm’s length', share: [0.2, 0.3], light: { room: 0.03, wash: 0.05, noise: 0.06, blur: 0.002, glare: 0 } },
  { name: 'dark room, held close', share: [0.45, 0.6], light: { room: 0.015, wash: 0.08, noise: 0.1, blur: 0.003, glare: 0 } },
  { name: 'dark room, arm’s length', share: [0.2, 0.3], light: { room: 0.015, wash: 0.08, noise: 0.1, blur: 0.003, glare: 0 } },
  { name: 'a lamp’s glare, small', share: [0.3, 0.6], light: { room: 0.5, wash: 0, noise: 0.02, blur: 0.002, glare: 0.1 } },
  { name: 'a lamp’s glare, large', share: [0.3, 0.6], light: { room: 0.5, wash: 0, noise: 0.02, blur: 0.002, glare: 0.16 } },
  { name: 'a moving hand', share: [0.3, 0.6], light: { room: 0.2, wash: 0, noise: 0.03, blur: 0.004, glare: 0 } },
];

const oldPass = passCells(PASS, 'M');
const newPass = passCells(PASS);
const COLUMNS = [
  { name: 'BEFORE', camera: cameras.before, cells: oldPass, grow: 1 },
  { name: 'CAMERA', camera: cameras.after, cells: oldPass, grow: 1 },
  { name: 'BOTH', camera: cameras.after, cells: newPass, grow: BIGGER },
];

if (process.argv[2] === '--video') {
  // Ten made pictures of one row as a video the browser plays as its camera.
  const [, , , file, rowName] = process.argv;
  const index = ROWS.findIndex((row) => row.name === rowName);
  if (file === undefined || index === -1) {
    console.error(`usage: --video <file.y4m> <row>, a row being one of: ${ROWS.map((row) => row.name).join(' · ')}`);
    process.exit(1);
  }
  const { width, height } = cameras.after;
  const random = seeded(1000 + index);
  const row = ROWS[index];
  const scene = {
    share: (row.share[0] + row.share[1]) / 2,
    grow: BIGGER,
    dx: 0.05,
    dy: -0.03,
    turn: 0.1,
    gx: 0.4,
    gy: 0.4,
  };
  const colour = Buffer.alloc((width * height) / 2, 128);
  const parts = [Buffer.from(`YUV4MPEG2 W${String(width)} H${String(height)} F10:1 Ip A1:1 C420jpeg\n`)];
  for (let n = 0; n < 10; n += 1) {
    const grey = picture(width, height, newPass, { ...scene, noiseSeed: Math.floor(random() * 2 ** 31) }, row.light);
    parts.push(Buffer.from('FRAME\n'), Buffer.from(grey.buffer), colour);
  }
  writeFileSync(file, Buffer.concat(parts));
  console.log(`${file}: 10 pictures of "${row.name}", ${String(width)} × ${String(height)}`);
  process.exit(0);
}

console.log(`pictures a row: ${String(PICTURES)} · old pass ${String(oldPass.length)} cells (M) · new pass ${String(newPass.length)} cells (${PASS_CORRECTION})`);
console.log('row'.padEnd(28), COLUMNS.map((column) => column.name.padStart(8)).join(''));
ROWS.forEach((row, index) => {
  const random = seeded(1000 + index);
  const count = COLUMNS.map(() => 0);
  const ms = COLUMNS.map(() => 0);
  for (let n = 0; n < PICTURES; n += 1) {
    const scene = {
      share: row.share[0] + random() * (row.share[1] - row.share[0]),
      dx: (random() - 0.5) * 0.2,
      dy: (random() - 0.5) * 0.2,
      turn: (random() - 0.5) * 0.4,
      gx: 0.2 + random() * 0.6,
      gy: 0.2 + random() * 0.6,
      noiseSeed: Math.floor(random() * 2 ** 31),
    };
    COLUMNS.forEach((column, at) => {
      const before = jsqrMs;
      if (reads(column.camera, column.cells, { ...scene, grow: column.grow }, row.light)) count[at] += 1;
      ms[at] += jsqrMs - before;
    });
  }
  console.log(row.name.padEnd(28), count.map((n) => String(n).padStart(8)).join(''));
  console.log('  ms a picture'.padEnd(28), ms.map((n) => (n / PICTURES).toFixed(0).padStart(8)).join(''));
});
