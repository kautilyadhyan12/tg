// The phone's own readings of the proof videos, kept small (ROADMAP 52a-ii-a and 52a-iii; spec Part 2 §12.5):
//   corepack pnpm --filter @app/movement keep-phone-points
// The phone test ran the phone's pose model on the laptop's own pictures of the videos, asked for one person; its files are
// on the laptop (measured/phone-test/phone/people-1-laptop-pictures*, ignored by git). This turns them into body-points
// files in test/phone-points:
//   - for the replays (52a-ii-a), the squat and the chair squat from three set-ups: the full model on the main chip on 4
//     cores (the chosen set-up), on the graphics chip, and the small model on the main chip on 4 cores (replays.ts
//     `chipsGap`);
//   - for the phone's own runs judged (52a-iii), every proof video the chosen set-up has read (phoneCounts.ts).
// Each is the phone's reading of the very pictures the kept file was read from. Only body points are kept: never a picture.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { encodeBodyPoints, decodeBodyPoints } from "./bodyPoints.js";
import { MOVEMENT_VIDEOS } from "./movementVideos.js";
import { MODELS, phoneFrames, readPhoneRun } from "./phoneRun.js";
import { PHONE_GAPS, phoneLabel } from "./replays.js";

const ROOT = join(import.meta.dirname, "../../..");
const PHONE = join(ROOT, "measured/phone-test/phone");
const TEST = join(import.meta.dirname, "../test");
const CHOSEN = PHONE_GAPS[0].run;

/** The run folders of the phone's own model asked for one person on the laptop's pictures: 51b-i's and 52a-iii's. */
const runFolders = existsSync(PHONE) ? readdirSync(PHONE).filter((d) => d.startsWith("people-1-laptop-pictures")).map((d) => join(PHONE, d)) : [];

/** The one file of a run of a video, in whichever run folder holds it; two different ones are refused. */
function runFile(label: string, run: string): string | null {
  const found = runFolders.map((d) => join(d, `${label}.${run}.jsonl`)).filter((p) => existsSync(p));
  const texts = new Set(found.map((p) => readFileSync(p, "utf8")));
  if (texts.size > 1) throw new Error(`${label}.${run}: ${String(found.length)} different runs in ${found.join(", ")}`);
  return found[0] ?? null;
}

function keep(keptPath: string, label: string, run: string): void {
  const kept = decodeBodyPoints(new Uint8Array(readFileSync(keptPath)));
  const path = runFile(label, run);
  if (path === null) throw new Error(`${label}.${run}: no phone run`);
  const phone = readPhoneRun(readFileSync(path, "utf8"));
  const h = phone.header;
  const model = MODELS.find((m) => m.name === h.model.file);
  const [, chip, cores] = /^[a-z_]+\.(cpu|gpu)(?:\.t(\d))?$/.exec(run) ?? [];
  if (h.label !== label || h.pictures !== "laptop" || h.model.people !== 1 || model === undefined || model.sha256 !== h.model.sha256) {
    throw new Error(`${label}.${run}: not the phone's model asked for one person on the laptop's pictures`);
  }
  if (`${h.model.file}.${h.delegate}${h.threads === null ? "" : `.t${String(h.threads)}`}` !== run || chip !== h.delegate || (cores === undefined ? null : Number(cores)) !== h.threads) {
    throw new Error(`${label}.${run}: the file says another set-up`);
  }
  const frames = phoneFrames(phone);
  if (frames.length !== kept.frames.length || frames.some((f, k) => Math.abs(f.t - (kept.frames[k]?.t ?? Number.NaN)) > 0.5)) {
    throw new Error(`${label}.${run}: its frames are not the kept file's`);
  }
  // A name of its own, never the laptop file's: only the check number would tell them apart.
  const header = {
    ...kept.header,
    label: phoneLabel(label, run),
    source: "phone" as const,
    model: { ...kept.header.model, file: h.model.file },
    madeWith: { tool: "keep-phone-points" as const, version: 1 },
  };
  const out = join(TEST, "phone-points", `${label}.${run}.bodypoints`);
  const bytes = encodeBodyPoints(header, frames);
  writeFileSync(out, bytes);
  console.log(`${out}: ${String(frames.length)} frames, ${String(bytes.length)} bytes`);
}

mkdirSync(join(TEST, "phone-points"), { recursive: true });
for (const gap of PHONE_GAPS) for (const label of gap.videos) keep(join(TEST, "body-points", `${label}.bodypoints`), label, gap.run);
const missing: string[] = [];
for (const entry of MOVEMENT_VIDEOS) {
  const label = basename(entry.file);
  if (runFile(label, CHOSEN) === null) missing.push(label);
  else keep(join(TEST, `${entry.file}.bodypoints`), label, CHOSEN);
}
console.log(missing.length === 0 ? "Every proof video has the phone's run." : `No phone run yet of ${String(missing.length)} proof videos: ${missing.join(", ")}`);
