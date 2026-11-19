// One command for every video: a video in; its body points, kept small, and pictures a
// terminal can look at out (spec Part 2 §12.7).
//   corepack pnpm --filter @app/movement measure-points "<video>" [--label name] [--keep]
// Options: --fps <8 to 40, default 30> --people <1 to 6, default 1> --out <folder>
//          --model <.task file, default the phone's own: Google's full model> --python <command>
// --keep also puts the small file in test/body-points/, where the tests read it; a file
// already kept there under the same name is replaced only with --replace. Only a run of the
// phone's own model asked for one person at 30 frames a second is kept (ROADMAP 51c, keptVideos.ts).
// Runs on the laptop only: it needs Python with mediapipe and cv2.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { MAX_FPS, MAX_PEOPLE, MIN_FPS } from "@app/shared";
import { beyondHalfStep, decodeBodyPoints, encodeBodyPoints, largestChanges } from "./bodyPoints.js";
import { TOOL_VERSION, framesToLook, labelFor, readMeasurement, summaryLines } from "./measurePoints.js";
import { KEPT_MODEL } from "./keptVideos.js";
import { checkOutFolder, prepareOutFolder } from "./outFolder.js";
import { MODELS } from "./phoneRun.js";

const REPO = resolve(import.meta.dirname, "../../..");
const POINTS_PY = join(import.meta.dirname, "points.py");
const KEPT = join(import.meta.dirname, "../test/body-points");
// The phone's own model (51b-ii), as the phone test fetched and checked it.
const PHONE_MODEL = MODELS.find((m) => m.name === KEPT_MODEL.file);
if (PHONE_MODEL === undefined) throw new Error(`${KEPT_MODEL.file} is not one of the pinned models.`);
const DEFAULT_MODEL = join(REPO, "measured", "phone-test", "models", `${PHONE_MODEL.name}.task`);

// pnpm runs this from the package's folder; a path means what it meant where it was typed.
const typedFrom = process.env["INIT_CWD"] ?? process.cwd();
const fromTyped = (path: string): string => resolve(typedFrom, path);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function runPython(python: string, args: string[]): void {
  const r = spawnSync(python, [POINTS_PY, ...args], { stdio: "inherit" });
  if (r.error) fail(`Python did not start: ${r.error.message}`);
  if (r.status !== 0) fail(`The Python step stopped with code ${String(r.status)}.`);
}

const USAGE = 'Usage: measure-points "<video>" [--label name] [--fps 8 to 40] [--people 1 to 6] [--keep [--replace]] [--out folder]';

function parse() {
  return parseArgs({
    allowPositionals: true,
    options: {
      label: { type: "string" },
      fps: { type: "string", default: "30" },
      people: { type: "string", default: String(KEPT_MODEL.people) },
      keep: { type: "boolean", default: false },
      replace: { type: "boolean", default: false },
      out: { type: "string" },
      model: { type: "string", default: DEFAULT_MODEL },
      python: { type: "string", default: "python" },
    },
  });
}
function readOptions(): ReturnType<typeof parse> {
  try {
    return parse();
  } catch (err) {
    fail(`${messageOf(err)}\n${USAGE}`);
  }
}

const { values, positionals } = readOptions();
const typedInput = positionals[0];
if (typedInput === undefined || positionals.length > 1) fail(USAGE);
const input = fromTyped(typedInput);
if (!existsSync(input)) fail(`No file at ${input}.`);
if ([".jsonl", ".bodypoints"].includes(extname(input).toLowerCase())) fail("Give a video: this tool measures one.");
const fps = Number(values.fps);
if (values.fps.trim() === "" || !(fps >= MIN_FPS && fps <= MAX_FPS)) fail(`--fps is a number from ${String(MIN_FPS)} to ${String(MAX_FPS)}, what the engine accepts.`);
const people = Number(values.people);
if (!Number.isInteger(people) || people < 1 || people > MAX_PEOPLE) fail(`--people is a whole number from 1 to ${String(MAX_PEOPLE)}.`);
const model = fromTyped(values.model);

// The name reaches the kept file, which may go to git: never a path.
const label = labelFor(values.label, input);
if (label === "") fail("--label needs at least one letter or number.");
const out = values.out === undefined ? join(REPO, "measured", label) : fromTyped(values.out);
if (values.replace && !values.keep) fail("--replace only goes with --keep.");
// The kept files are all the phone's own: one model, one person asked, 30 frames a second (keptVideos.ts).
if (values.keep && (people !== KEPT_MODEL.people || fps !== KEPT_MODEL.fps)) {
  fail(`Only a run asked for ${String(KEPT_MODEL.people)} person at ${String(KEPT_MODEL.fps)} frames a second is kept for the tests, as the phone runs. Measure without --keep.`);
}
const keptForTests = join(KEPT, `${label}.bodypoints`);
if (values.keep && !values.replace && existsSync(keptForTests)) {
  fail(`A file named ${label} is already kept for the tests. Give this video its own --label, or add --replace to measure that video again.`);
}
// Every refusal comes before the folder is made: the folder's own, then the model's.
try {
  checkOutFolder(out, input);
} catch (err) {
  fail(messageOf(err));
}
if (!existsSync(model)) {
  fail(`No pose model at ${model}. Give one with --model${values.model === DEFAULT_MODEL ? ", or let the phone test fetch the phone's own (phone-test --laptop-only)" : ""}.`);
}
// The model is read only now, after every other refusal: GitHub has no model file.
if (values.keep) {
  const sum = createHash("sha256").update(new Uint8Array(readFileSync(model))).digest("hex");
  if (sum !== PHONE_MODEL.sha256) {
    fail(`Only the phone's own model (Google's ${PHONE_MODEL.size} model, as pinned) is kept for the tests. Measure without --keep.`);
  }
}
try {
  prepareOutFolder(out, input);
} catch (err) {
  fail(messageOf(err));
}

const started = Date.now();
const measuredPath = join(out, "measured.jsonl");
runPython(values.python, [
  "measure",
  "--video", input,
  "--out", measuredPath,
  "--label", label,
  "--fps", String(fps),
  "--people", String(people),
  "--model", model,
  "--tool-version", String(TOOL_VERSION),
]);

const keptPath = join(out, `${label}.bodypoints`);
// Written under another name first: a file that fails its check never takes the kept name.
const unchecked = `${keptPath}.unchecked`;
const refuse = (message: string): never => {
  rmSync(unchecked, { force: true });
  fail(`${label} cannot be kept: ${message} Nothing from this run is kept.`);
};
let lines: string[] = [];
try {
  const measured = readMeasurement(readFileSync(measuredPath, "utf8"));
  writeFileSync(unchecked, encodeBodyPoints(measured.header, measured.frames));
  // Read back from the disk, as every later reader will: the file must hold what was measured.
  const kept = decodeBodyPoints(readFileSync(unchecked));
  if (JSON.stringify(kept.header) !== JSON.stringify(measured.header)) refuse("its header is not the one measured.");
  const changes = largestChanges(measured.frames, kept.frames);
  const beyond = beyondHalfStep(changes);
  if (beyond.length > 0) refuse(`it moved ${beyond.join(", ")} numbers by more than half a step.`);
  renameSync(unchecked, keptPath);
  const { look, changesLeftOut } = framesToLook(kept.frames);
  writeFileSync(join(out, "look.json"), JSON.stringify({ frames: look }));
  lines = summaryLines(kept, { measured: statSync(measuredPath).size, kept: statSync(keptPath).size }, changes, changesLeftOut);
  runPython(values.python, ["draw", "--look", join(out, "look.json"), "--video", input, "--fps", String(kept.header.fps), "--out", out]);
} catch (err) {
  if (existsSync(unchecked)) refuse(messageOf(err));
  fail(`${label}: ${messageOf(err)}`);
}

if (values.keep) {
  mkdirSync(KEPT, { recursive: true });
  copyFileSync(keptPath, keptForTests);
  lines.push(`Kept for the tests: packages/movement/test/body-points/${label}.bodypoints`);
}
for (const line of lines) console.log(line);
console.log(`Took ${((Date.now() - started) / 1000).toFixed(0)} s. Pictures: ${out}`);
