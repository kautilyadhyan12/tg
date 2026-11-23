// Makes the workout's four sounds (ROADMAP Stage 5 64a-vi) as small WAV files in assets/sounds/: the browser's own
// tones (apps/web/src/pages/ActiveWorkout.jsx), sine waves with a soft start and end so none clicks. Made here, so
// they are the app's own and nobody else's recording. Run from apps/mobile: node tools/make-workout-sounds.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RATE = 22050;

/** Tones as [hertz, seconds, loudness 0 to 1, starting at seconds]. */
const SOUNDS = {
  rep: [[880, 0.07, 0.5, 0]],
  "set-end": [
    [660, 0.09, 0.6, 0],
    [660, 0.12, 0.6, 0.15],
  ],
  count: [[440, 0.08, 0.5, 0]],
  go: [
    [523, 0.08, 0.6, 0],
    [659, 0.08, 0.6, 0.12],
    [784, 0.15, 0.8, 0.24],
  ],
};

function samples(tones) {
  const end = Math.max(...tones.map(([, d, , at]) => at + d)) + 0.02;
  const out = new Float64Array(Math.ceil(end * RATE));
  for (const [hz, seconds, loud, at] of tones) {
    const from = Math.round(at * RATE);
    const n = Math.round(seconds * RATE);
    const edge = Math.round(0.006 * RATE);
    for (let i = 0; i < n; i++) {
      // A short rise, then the browser's falling ramp to silence.
      const rise = Math.min(1, i / edge);
      const fall = Math.pow(0.001, i / n);
      out[from + i] += loud * rise * fall * Math.sin((2 * Math.PI * hz * i) / RATE);
    }
  }
  return out;
}

function wav(data) {
  const bytes = Buffer.alloc(44 + data.length * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + data.length * 2, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(RATE, 24);
  bytes.writeUInt32LE(RATE * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  return bytes;
}

const folder = join(import.meta.dirname, "..", "assets", "sounds");
mkdirSync(folder, { recursive: true });
for (const [name, tones] of Object.entries(SOUNDS)) {
  const file = join(folder, `${name}.wav`);
  writeFileSync(file, wav(samples(tones)));
  console.log(file);
}
