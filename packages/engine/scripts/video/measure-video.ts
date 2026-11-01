// One command for every exercise: a video in; a trace, the engine's report and pictures
// a terminal can look at out (Part 2 §11.2, tools 1 to 3).
//   corepack pnpm --filter @app/engine measure-video "<video or .jsonl>" --exercise squat
// Options: --reps <counted by eye> --view <side|front> --label <name> --fps <n>
//          --out <folder> --model <.task file> --python <command>
// A .jsonl is an existing trace: no model runs and the skeleton is drawn on a plain picture.
// Runs on the laptop only: it needs Python with mediapipe, cv2 and matplotlib.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { exerciseDefinitionSchema, type ExerciseDefinition } from "@app/shared";
import { ENGINE_VERSION, UNCOUNTED_REPS } from "../../src/index.js";
import { labelFor, reportFromTraceText, summaryLines } from "./measure.js";
import { prepareOutFolder } from "./outFolder.js";

const REPO = resolve(import.meta.dirname, "../../../..");
const LINE_PY = join(import.meta.dirname, "video_line.py");
const DEFINITIONS = join(import.meta.dirname, "../../src/definitions");
// Item 51 picks the model the phone runs; until then, Kd's strong one.
const DEFAULT_MODEL = "D:\\vidoe referene\\tools\\pose_landmarker_heavy.task";

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
  const r = spawnSync(python, [LINE_PY, ...args], { stdio: "inherit" });
  if (r.error) fail(`Python did not start: ${r.error.message}`);
  if (r.status !== 0) fail(`The Python step stopped with code ${String(r.status)}.`);
}

function loadDefinition(exercise: string): ExerciseDefinition | null {
  const file = join(DEFINITIONS, `${exercise}.json`);
  if (!existsSync(file)) return null;
  return exerciseDefinitionSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

const USAGE =
  'Usage: measure-video "<video or .jsonl>" --exercise <name> [--reps n] [--view side|front|unknown] [--label name] [--fps 8 to 40] [--out folder]';

function readOptions(): ReturnType<typeof parse> {
  try {
    return parse();
  } catch (err) {
    fail(`${messageOf(err)}\n${USAGE}`);
  }
}
function parse() {
  return parseArgs({
    allowPositionals: true,
    options: {
      exercise: { type: "string" },
      reps: { type: "string" },
      view: { type: "string" },
      label: { type: "string" },
      fps: { type: "string", default: "15" },
      out: { type: "string" },
      model: { type: "string", default: DEFAULT_MODEL },
      python: { type: "string", default: "python" },
    },
  });
}

const { values, positionals } = readOptions();
const typedInput = positionals[0];
const exercise = values.exercise;
if (typedInput === undefined || exercise === undefined) fail(USAGE);
const input = fromTyped(typedInput);
const model = fromTyped(values.model);
if (!/^[a-z0-9_]+$/.test(exercise)) fail(`"${exercise}" is not an exercise key: use small letters, numbers and _.`);
if (!existsSync(input)) fail(`No file at ${input}.`);

if (values.reps !== undefined && !/^\d+$/.test(values.reps)) fail("--reps is the whole number a person counted.");
const reps = values.reps === undefined ? null : Number(values.reps);

const isTrace = extname(input).toLowerCase() === ".jsonl";
if (isTrace && values.view !== undefined) fail("--view does nothing on a trace: its header already says.");
const view = values.view ?? "unknown";
if (!["side", "front", "unknown"].includes(view)) fail("--view is side, front or unknown.");
const fps = Number(values.fps);
if (values.fps.trim() === "" || !(fps >= 8 && fps <= 40)) fail("--fps is a number from 8 to 40, what the engine accepts.");

// The name reaches the trace, which may go to git: never a path.
const label = labelFor(values.label, input);
if (label === "") fail("--label needs at least one letter or number.");
const out = values.out === undefined ? join(REPO, "measured", label) : fromTyped(values.out);
try {
  prepareOutFolder(out, input);
} catch (err) {
  fail(messageOf(err));
}

const definition = loadDefinition(exercise);
const tracePath = isTrace ? input : join(out, `${label}.jsonl`);
if (!isTrace) {
  if (!existsSync(model)) fail(`No pose model at ${model}. Give one with --model.`);
  runPython(values.python, [
    "trace",
    "--video", input,
    "--out", tracePath,
    "--exercise", exercise,
    "--label", label,
    "--fps", values.fps,
    "--reps", String(reps ?? UNCOUNTED_REPS),
    "--view", view,
    "--model", model,
    "--engine", ENGINE_VERSION,
    "--defs", String(definition?.version ?? 0),
  ]);
}

let lines: string[] = [];
try {
  const report = reportFromTraceText(readFileSync(tracePath, "utf8"), definition, reps, exercise);
  lines = summaryLines(report);
  writeFileSync(join(out, "report.json"), JSON.stringify(report));
} catch (err) {
  fail(`${basename(tracePath)} cannot be measured: ${messageOf(err)}`);
}
runPython(values.python, [
  "draw",
  "--report", join(out, "report.json"),
  "--trace", tracePath,
  "--out", out,
  ...(isTrace ? [] : ["--video", input, "--fps", values.fps]),
]);

for (const line of lines) console.log(line);
if (!definition) {
  const known = readdirSync(DEFINITIONS).map((f) => basename(f, ".json")).join(", ");
  console.log(`Rules exist for: ${known}.`);
}
console.log(`Pictures: ${out}`);
