// The phone's own readings of two kept videos, kept small for the replays (ROADMAP 52a-ii-a; spec Part 2 §12.5):
//   corepack pnpm --filter @app/movement keep-phone-points
// 51b-i ran the phone's pose model on the laptop's own pictures of the squat and the chair squat, asked for one person;
// its files are on the laptop (measured/phone-test/phone/people-1-laptop-pictures, ignored by git). This turns the runs
// the replays need into body-points files in test/phone-points: the full model on the main chip on 4 cores (the chosen
// set-up), on the graphics chip, and the small model on the main chip on 4 cores. Each is the phone's reading of the very
// pictures the kept file was read from, so a frame's gap from the kept file is what that chip reads apart from the
// laptop (replays.ts `chipsGap`). Only body points are kept: never a picture.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeBodyPoints, decodeBodyPoints } from "./bodyPoints.js";
import { phoneFrames, readPhoneRun } from "./phoneRun.js";
import { PHONE_GAPS } from "./replays.js";

const ROOT = join(import.meta.dirname, "../../..");
const RUNS = join(ROOT, "measured/phone-test/phone/people-1-laptop-pictures");
const TEST = join(import.meta.dirname, "../test");

mkdirSync(join(TEST, "phone-points"), { recursive: true });
for (const gap of PHONE_GAPS) {
  for (const label of gap.videos) {
    const kept = decodeBodyPoints(new Uint8Array(readFileSync(join(TEST, "body-points", `${label}.bodypoints`))));
    const run = readPhoneRun(readFileSync(join(RUNS, `${label}.${gap.run}.jsonl`), "utf8"));
    if (run.header.label !== label || run.header.pictures !== "laptop" || run.header.model.people !== 1) {
      throw new Error(`${label}.${gap.run}: not the phone's model asked for one person on the laptop's pictures`);
    }
    const frames = phoneFrames(run);
    if (frames.length !== kept.frames.length || frames.some((f, k) => Math.abs(f.t - (kept.frames[k]?.t ?? Number.NaN)) > 0.5)) {
      throw new Error(`${label}.${gap.run}: its frames are not the kept file's`);
    }
    const header = { ...kept.header, source: "phone" as const, model: { ...kept.header.model, file: run.header.model.file }, madeWith: { tool: "keep-phone-points" as const, version: 1 } };
    const out = join(TEST, "phone-points", `${label}.${gap.run}.bodypoints`);
    const bytes = encodeBodyPoints(header, frames);
    writeFileSync(out, bytes);
    console.log(`${out}: ${String(frames.length)} frames, ${String(bytes.length)} bytes`);
  }
}
