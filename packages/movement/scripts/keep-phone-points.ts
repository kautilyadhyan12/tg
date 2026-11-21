// The phone's own readings of the proof videos, kept small (ROADMAP 52a-ii-a and 52a-iii; spec Part 2 §12.5):
//   corepack pnpm --filter @app/movement keep-phone-points
// The phone test ran the phone's pose model on the laptop's own pictures of the videos, asked for one person; its files are
// on the laptop (measured/phone-test/phone/people-1-laptop-pictures*, ignored by git), each folder beside the plan it was
// made for (measured/phone-test/plan-<folder>.json). This turns them into body-points files in test/phone-points:
//   - for the replays (52a-ii-a), the squat and the chair squat from three set-ups: the full model on the main chip on 4
//     cores (the chosen set-up), on the graphics chip, and the small model on the main chip on 4 cores (replays.ts
//     `chipsGap`);
//   - for the phone's own runs judged (52a-iii), every proof video the chosen set-up has read (phoneCounts.ts);
// and writes test/phone-points/manifest.json: for each file, the kept file it was read against and the laptop's pictures
// the phone was given. phoneKeep.ts says what a run must pass. Only body points are kept: never a picture.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { phonePointsManifestSchema, phoneTestPlanSchema, type PhonePointsManifest } from "@app/shared";
import { encodeBodyPoints, decodeBodyPoints } from "./bodyPoints.js";
import { MOVEMENT_VIDEOS } from "./movementVideos.js";
import { phoneBodyPoints, type KeptPlan } from "./phoneKeep.js";
import { readPhoneRun } from "./phoneRun.js";
import { PHONE_GAPS } from "./replays.js";

const HERE = join(import.meta.dirname, "../../../measured/phone-test");
const PHONE = join(HERE, "phone");
const TEST = join(import.meta.dirname, "../test");
const CHOSEN = PHONE_GAPS[0].run;

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** The run folders of the phone's own model asked for one person on the laptop's pictures: 51b-i's and 52a-iii's. */
const runFolders = existsSync(PHONE) ? readdirSync(PHONE).filter((d) => d.startsWith("people-1-laptop-pictures")) : [];

const plans = new Map<string, KeptPlan>();
/** The plan a run folder was made for, read through its schema. */
function planOf(folder: string): KeptPlan {
  const known = plans.get(folder);
  if (known !== undefined) return known;
  const bytes = new Uint8Array(readFileSync(join(HERE, `plan-${folder}.json`)));
  const parsed = phoneTestPlanSchema.safeParse(JSON.parse(Buffer.from(bytes).toString("utf8")));
  if (!parsed.success) throw new Error(`plan-${folder}.json is not a phone test plan: ${parsed.error.message}`);
  const plan = { sum: sha256(bytes), videos: parsed.data.videos };
  plans.set(folder, plan);
  return plan;
}

/** The one run of a video, in whichever run folder holds it; two different ones are refused. */
function runFile(label: string, run: string): { folder: string; path: string } | null {
  const found = runFolders.map((folder) => ({ folder, path: join(PHONE, folder, `${label}.${run}.jsonl`) })).filter((f) => existsSync(f.path));
  if (new Set(found.map((f) => readFileSync(f.path, "utf8"))).size > 1) throw new Error(`${label}.${run}: ${String(found.length)} different runs in ${found.map((f) => f.folder).join(", ")}`);
  return found[0] ?? null;
}

const manifest: PhonePointsManifest = { files: {} };
function keep(keptPath: string, label: string, run: string): void {
  const keptBytes = new Uint8Array(readFileSync(keptPath));
  const found = runFile(label, run);
  if (found === null) throw new Error(`${label}.${run}: no phone run`);
  const phone = readPhoneRun(readFileSync(found.path, "utf8"));
  const { header, frames } = phoneBodyPoints(decodeBodyPoints(keptBytes), phone, label, run, planOf(found.folder));
  const name = `${label}.${run}.bodypoints`;
  const bytes = encodeBodyPoints(header, frames);
  writeFileSync(join(TEST, "phone-points", name), bytes);
  manifest.files[name] = { kept: sha256(keptBytes), pictures: phone.header.video.sha256 };
  console.log(`${name}: ${String(frames.length)} frames, ${String(bytes.length)} bytes`);
}

mkdirSync(join(TEST, "phone-points"), { recursive: true });
for (const gap of PHONE_GAPS) for (const label of gap.videos) keep(join(TEST, "body-points", `${label}.bodypoints`), label, gap.run);
const missing: string[] = [];
// A video of several sets (`cut`) is one file and one phone run.
for (const entry of MOVEMENT_VIDEOS.filter((e, k, all) => all.findIndex((x) => x.file === e.file) === k)) {
  const label = basename(entry.file);
  if (runFile(label, CHOSEN) === null) missing.push(label);
  else keep(join(TEST, `${entry.file}.bodypoints`), label, CHOSEN);
}
const sorted = { files: Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b))) };
writeFileSync(join(TEST, "phone-points", "manifest.json"), `${JSON.stringify(phonePointsManifestSchema.parse(sorted), null, 1)}\n`);
console.log(missing.length === 0 ? "Every proof video has the phone's run." : `No phone run yet of ${String(missing.length)} proof videos: ${missing.join(", ")}`);
