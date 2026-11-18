// The phone test (ROADMAP Stage 5 items 51a and 51b): Kd's reference videos through the phone's own pose model, three
// sizes, on the main chip and the graphics chip, each against the laptop's run of the same model on the same video.
//   corepack pnpm --filter @app/movement phone-test [--laptop-only | --compare-only] [--models lite,full,heavy] [--chips cpu,gpu]
//                                                   [--threads own,1 to 8] [--labels a,b] [--people 1 to 6]
//                                                   [--pictures video|laptop] [--videos <folder>] [--python <command>]
// It needs this folder's copy of the app on the phone on the USB cable (corepack pnpm --filter mobile phone), puts the
// videos, the models and a plan in that copy's own files, opens its phone-test screen, waits, takes one file a run
// back, deletes everything it put there, then compares. --laptop-only makes the laptop's side ready and stops before the
// phone is touched; --compare-only compares the files already taken back. --people asks the model for fewer people than
// the laptop's six (the laptop then measures the same way); --pictures laptop hands the phone the laptop's own decoded
// pictures instead of the video, so what still differs is the model's part alone. --threads runs the main chip once for
// each number of cores it names ("own", the library's own number, as every 51a run was; 51b): the graphics chip runs
// once whatever it says. Each kind of run keeps its own files,
// and a run on the phone first clears all of its kind's earlier files, every video's, not only those it sends.
// Everything it writes is in measured/phone-test/, which git ignores; the videos never leave Kd's folder but for the
// phone's copy of the app, and are deleted there when the test ends.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { PHONE_TEST_DELEGATES, PHONE_TEST_MAX_THREADS, phoneProgressSchema, videoFramesSchema, type MovementFrame, type PhoneProgress, type PhoneTestDelegate, type VideoFrames } from "@app/shared";
import { decodeBodyPoints, type BodyPoints } from "./bodyPoints.js";
import { KD_VIDEOS, assertFolderStaysOutOfGit } from "./outFolder.js";
import { WARM_UP, compareFrames, comparePhone, gapWords, keyGaps, runKey, shakeOf, summaries, type FrameComparison, type PhoneComparison } from "./phoneCheck.js";
import {
  MODELS,
  SETTINGS,
  makePlan,
  modelUrl,
  planRuns,
  phoneFrames,
  readPhoneFailure,
  readPhoneRun,
  runFiles,
  runName,
  type PhoneRun,
  type PlanRun,
  type PlanVideo,
  type PoseModel,
} from "./phoneRun.js";

const REPO = resolve(import.meta.dirname, "../../..");
const KEPT = join(import.meta.dirname, "../test/body-points");
const POINTS_PY = join(import.meta.dirname, "points.py");
const MEASURE_POINTS = join(import.meta.dirname, "measure-points.ts");
const MOBILE = join(REPO, "apps", "mobile");
const HERE = join(REPO, "measured", "phone-test");
const ON_PHONE = "files/phone-test";
/** Where adb puts a file on its way into the app's own files: the shell's folder. An app that knows the path can read
 *  a file there (the app's own run-as user reads it so, which is how the copy works), so only what may be read goes
 *  this way: Kd's public reference videos, their pictures and Google's models, each removed as soon as it is copied;
 *  never a member's anything. */
const STAGING = "/data/local/tmp/kwazo-phone-test";
const ACTIVITY = "expo.modules.phonetest.PhoneTestActivity";
/** The phone is given this long without a word before the laptop stops waiting. */
const STILL_FOR_MS = 10 * 60 * 1000;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const { values } = (() => {
  try {
    return parseArgs({
      options: {
        "laptop-only": { type: "boolean", default: false },
        "compare-only": { type: "boolean", default: false },
        models: { type: "string", default: MODELS.map((m) => m.size).join(",") },
        chips: { type: "string", default: PHONE_TEST_DELEGATES.join(",") },
        threads: { type: "string", default: "own" },
        labels: { type: "string" },
        people: { type: "string", default: String(SETTINGS.people) },
        pictures: { type: "string", default: "video" },
        videos: { type: "string", default: KD_VIDEOS },
        python: { type: "string", default: "python" },
      },
    });
  } catch (err) {
    fail(`${messageOf(err)}\nUsage: phone-test [--laptop-only | --compare-only] [--models lite,full,heavy] [--chips cpu,gpu] [--threads own,1 to 8] [--labels a,b] [--people 1 to 6] [--pictures video|laptop] [--videos <folder>]`);
  }
})();

const listed = (text: string): string[] => text.split(",").map((s) => s.trim()).filter((s) => s !== "");
const models: PoseModel[] = listed(values.models).map((size) => MODELS.find((m) => m.size === size) ?? fail(`--models takes lite, full and heavy, not "${size}".`));
const chips: PhoneTestDelegate[] = listed(values.chips).map((c) => PHONE_TEST_DELEGATES.find((d) => d === c) ?? fail(`--chips takes cpu and gpu, not "${c}".`));
const threads: (number | null)[] = [
  ...new Set(
    listed(values.threads).map((t) => {
      if (t === "own") return null;
      const n = Number(t);
      return Number.isInteger(n) && n >= 1 && n <= PHONE_TEST_MAX_THREADS ? n : fail(`--threads takes own and 1 to ${String(PHONE_TEST_MAX_THREADS)}, not "${t}".`);
    }),
  ),
];
if (models.length === 0 || chips.length === 0 || threads.length === 0) fail("Give at least one model, one chip and one number of cores.");
const runs: PlanRun[] = planRuns(models, chips, threads);
if (values["laptop-only"] && values["compare-only"]) fail("--laptop-only and --compare-only do not go together.");
const keptLabels = readdirSync(KEPT)
  .filter((f) => f.endsWith(".bodypoints"))
  .map((f) => basename(f, ".bodypoints"))
  .sort();
const labels = values.labels === undefined ? keptLabels : listed(values.labels);
for (const l of labels) if (!keptLabels.includes(l)) fail(`${l} is not a kept video: ${keptLabels.join(", ")}.`);
const people = Number(values.people);
if (!Number.isInteger(people) || people < 1 || people > SETTINGS.people) fail(`--people is a whole number from 1 to ${String(SETTINGS.people)}.`);
const pictures = values.pictures === "laptop" ? "laptop" : values.pictures === "video" ? "video" : fail("--pictures is video or laptop.");
/** The kind of run: its files and its report are its own. */
const variant = `people-${String(people)}${pictures === "laptop" ? "-laptop-pictures" : ""}`;
const PHONE_OUT = join(HERE, "phone", variant);

try {
  assertFolderStaysOutOfGit(HERE);
} catch (err) {
  fail(messageOf(err));
}
for (const folder of ["models", "laptop", "frames", "videos", "pictures"]) mkdirSync(join(HERE, folder), { recursive: true });
mkdirSync(PHONE_OUT, { recursive: true });
const started = Date.now();
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

// ── 1. The models, each checked against its pinned file check ───────────────────
async function modelFile(m: PoseModel): Promise<string> {
  const path = join(HERE, "models", `${m.name}.task`);
  if (!existsSync(path)) {
    console.log(`Fetching Google's ${m.size} pose model.`);
    const reply = await fetch(modelUrl(m));
    if (!reply.ok) fail(`Google's ${m.size} pose model did not come: ${String(reply.status)}.`);
    writeFileSync(path, new Uint8Array(await reply.arrayBuffer()));
  }
  const bytes = new Uint8Array(readFileSync(path));
  if (bytes.length !== m.bytes || sha256(bytes) !== m.sha256) fail(`${path} is not Google's ${m.size} pose model as pinned. Delete it to fetch it again.`);
  return path;
}
const modelPaths = new Map<string, string>();
for (const m of models) modelPaths.set(m.name, await modelFile(m));

// ── 2. The laptop's runs: the kept heavy files, and the smaller models measured here ─
function videoOf(label: string): string {
  const folder = values.videos;
  const found = existsSync(folder)
    ? readdirSync(folder, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
        .map((d) => join(folder, d.name, `${label}.mp4`))
        .find((p) => existsSync(p))
    : undefined;
  return found ?? fail(`No video named ${label}.mp4 in ${folder}.`);
}

/** Where the laptop's run of a video with a model, asking for `n` people, is kept: the kept heavy file for six,
 *  otherwise in measured/phone-test/laptop/. */
function laptopFolder(label: string, m: PoseModel, n: number): string {
  return n === SETTINGS.people ? join(HERE, "laptop", m.name, label) : join(HERE, "laptop", m.name, `people-${String(n)}`, label);
}
function laptopPath(label: string, m: PoseModel, n: number): string {
  return m.size === "heavy" && n === SETTINGS.people ? join(KEPT, `${label}.bodypoints`) : join(laptopFolder(label, m, n), `${label}.bodypoints`);
}

/** The laptop's run of a video with a model, asking for as many people as the phone is asked for; made here when
 *  missing. */
function laptopRun(label: string, m: PoseModel): BodyPoints {
  const folder = laptopFolder(label, m, people);
  const path = laptopPath(label, m, people);
  if (!existsSync(path)) {
    if (values["compare-only"]) fail(`No laptop run of ${label} with the ${m.size} model at ${path}.`);
    console.log(`Measuring ${label} with the ${m.size} model on the laptop.`);
    const args = [MEASURE_POINTS, videoOf(label), "--model", modelPaths.get(m.name) ?? "", "--label", label, "--people", String(people), "--out", folder];
    const r = spawnSync(process.execPath, ["--import", "tsx", ...args], {
      cwd: join(import.meta.dirname, ".."),
      stdio: "inherit",
    });
    if (r.status !== 0) fail(`The laptop could not measure ${label} with the ${m.size} model.`);
  }
  const run = decodeBodyPoints(new Uint8Array(readFileSync(path)));
  if (run.header.model.file !== m.name) fail(`${path} was made with the ${run.header.model.file} model, not the ${m.name}.`);
  if (run.header.model.people !== people) fail(`${path} asked the model for ${String(run.header.model.people)} people, not ${String(people)}.`);
  return run;
}

/** points.py's list of the frames the laptop read, which must be every laptop run's frames. */
function framesOf(label: string, runs: readonly BodyPoints[]): VideoFrames {
  const path = join(HERE, "frames", `${label}.json`);
  const fps = runs[0]?.header.fps ?? 30;
  if (!existsSync(path)) {
    if (values["compare-only"]) fail(`No frame list for ${label} at ${path}.`);
    const r = spawnSync(values.python, [POINTS_PY, "frames", "--video", videoOf(label), "--fps", String(fps), "--out", path], { stdio: "inherit" });
    if (r.status !== 0) fail(`The laptop could not list the frames of ${label}.`);
  }
  const list = videoFramesSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!list.success) fail(`${path} is not a frame list: ${list.error.message}`);
  for (const run of runs) {
    const same = run.frames.length === list.data.frames.length && run.frames.every((f, i) => Math.abs(f.t - (list.data.frames[i]?.[1] ?? Number.NaN)) < 0.05);
    if (!same) fail(`The laptop's ${run.header.model.file} run of ${label} is not at the frames points.py lists now: is it the same video?`);
  }
  return list.data;
}

/** Each picture of a video as ffmpeg decodes it, by its check sum, in the order it plays. */
function pictureSums(video: string): string[] {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", video, "-map", "0:v:0", "-f", "framemd5", "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) fail(`ffmpeg could not read ${basename(video)}: ${r.stderr.trim()}`);
  return r.stdout.split("\n").flatMap((line) => (line.startsWith("#") || line.trim() === "" ? [] : [line.split(",").at(-1)?.trim() ?? ""]));
}

/** The video as the phone gets it: its pictures packed again in one piece (`-c copy`: nothing decoded or made again),
 *  since Android cannot number the frames of a video stored in pieces, as the two bench videos are (YouTube's "dash").
 *  Sent only when every picture, decoded, is the original's, in the same order, and points.py lists the same frames. */
function phoneCopyOf(label: string, list: VideoFrames): string {
  const original = videoOf(label);
  const copyPath = join(HERE, "videos", `${label}.mp4`);
  if (!existsSync(copyPath)) {
    mkdirSync(join(HERE, "videos"), { recursive: true });
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", original, "-map", "0:v:0", "-c", "copy", "-movflags", "+faststart", copyPath], { encoding: "utf8" });
    if (r.status !== 0) fail(`ffmpeg could not pack ${label} for the phone: ${r.stderr.trim()}`);
  }
  const a = pictureSums(original);
  const b = pictureSums(copyPath);
  if (a.length === 0 || a.length !== b.length || a.some((sum, i) => sum !== b[i])) fail(`The phone's copy of ${label} does not hold the original's pictures. Delete ${copyPath}.`);
  const listPath = join(HERE, "frames", `${label}.copy.json`);
  const r = spawnSync(values.python, [POINTS_PY, "frames", "--video", copyPath, "--fps", String(list.fps), "--out", listPath], { stdio: "inherit" });
  if (r.status !== 0) fail(`The laptop could not list the frames of the phone's copy of ${label}.`);
  const copyList = videoFramesSchema.safeParse(JSON.parse(readFileSync(listPath, "utf8")));
  if (!copyList.success || JSON.stringify(copyList.data) !== JSON.stringify(list)) fail(`The phone's copy of ${label} is not read at the original's frames. Delete ${copyPath}.`);
  return copyPath;
}

/** The laptop's own decoded pictures of a video, one PNG a kept frame (points.py frames --pictures), in a folder of
 *  their own; made once, and used only while points.py lists the same frames for them. */
function laptopPicturesOf(label: string, list: VideoFrames): string {
  const folder = join(HERE, "pictures", label);
  const listPath = join(HERE, "frames", `${label}.pictures.json`);
  if (!existsSync(folder) || readdirSync(folder).length !== list.frames.length) {
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
    const r = spawnSync(values.python, [POINTS_PY, "frames", "--video", videoOf(label), "--fps", String(list.fps), "--out", listPath, "--pictures", folder], { stdio: "inherit" });
    if (r.status !== 0) fail(`The laptop could not write the pictures of ${label}.`);
    const written = videoFramesSchema.safeParse(JSON.parse(readFileSync(listPath, "utf8")));
    if (!written.success || JSON.stringify(written.data) !== JSON.stringify(list)) fail(`The laptop's pictures of ${label} are not at the frames it measured.`);
  }
  return folder;
}

/** The laptop's pictures in the order the phone reads them, by their names. */
const pictureFiles = (folder: string): string[] =>
  readdirSync(folder)
    .filter((f) => /^\d{5}\.png$/.test(f))
    .sort()
    .map((f) => join(folder, f));

/** One check sum over files one after another, as the phone makes it. */
function sha256Of(files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const f of files) hash.update(new Uint8Array(readFileSync(f)));
  return hash.digest("hex");
}

const laptop = new Map<string, BodyPoints>();
const lists = new Map<string, VideoFrames>();
for (const label of labels) {
  const runs = models.map((m) => {
    const run = laptopRun(label, m);
    laptop.set(`${label}|${m.name}`, run);
    return run;
  });
  lists.set(label, framesOf(label, runs));
}
/** What the phone gets for each video, made and checked here; compared alone, the ones already made. */
const copies = new Map<string, string>();
for (const label of labels) {
  const list = lists.get(label);
  if (list === undefined) continue;
  if (values["compare-only"]) copies.set(label, pictures === "laptop" ? join(HERE, "pictures", label) : join(HERE, "videos", `${label}.mp4`));
  else copies.set(label, pictures === "laptop" ? laptopPicturesOf(label, list) : phoneCopyOf(label, list));
}
/** The sum the phone checks for a video, and writes back into each of its files. */
function videoSum(label: string): string {
  const copy = copies.get(label);
  if (copy === undefined || !existsSync(copy)) fail(`No phone copy of ${label} at ${copy ?? "its place"}: run the test without --compare-only.`);
  return sha256Of(pictures === "laptop" ? pictureFiles(copy) : [copy]);
}
/** This kind of run's plan, kept beside its files: what every file it gives back must name. */
const PLAN = join(HERE, `plan-${variant}.json`);

// ── 3. The phone ─────────────────────────────────────────────────────────────────
/** One adb command. It throws, never exits, so the test's own clean-up always runs. */
function adb(args: string[]): { ok: boolean; out: Buffer; text: string } {
  const r = spawnSync("adb", args, { maxBuffer: 1 << 30 });
  if (r.error) throw new Error(`adb did not run: ${r.error.message}`);
  const out = r.stdout;
  return { ok: r.status === 0, out, text: `${out.toString("utf8")}${r.stderr.toString("utf8")}`.trim() };
}

/** This folder's copy of the app, as app.config.ts names it (`apps/mobile/.copy`). */
function appId(): string {
  const r = spawnSync("corepack pnpm exec expo config --json --type public", { cwd: MOBILE, shell: true, encoding: "utf8", maxBuffer: 1 << 26 });
  const text = r.stdout;
  const id = /"package"\s*:\s*"(com\.aihomegym\.dev\.[a-z0-9]+)"/.exec(text)?.[1];
  return r.status === 0 && id !== undefined ? id : fail(`The app's settings did not name a folder's copy:\n${r.stderr.trim()}`);
}

/** The phone's own word on where the test is, or null before it has written one. */
function progressOn(id: string): PhoneProgress | null {
  const read = adb(["exec-out", "run-as", id, "cat", `${ON_PHONE}/progress.json`]);
  if (!read.ok) return null;
  try {
    const parsed = phoneProgressSchema.safeParse(JSON.parse(read.out.toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Waits for the phone to finish, saying each step; stops if it says nothing new for ten minutes. */
async function finished(id: string): Promise<PhoneProgress> {
  let last = "";
  let movedAt = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const progress = progressOn(id);
    if (progress !== null) {
      if (progress.state !== "running") return progress;
      const now = `run ${String(progress.run)} of ${String(progress.runs)}, picture ${String(progress.frame)} of ${String(progress.frames)}`;
      if (now !== last) {
        console.log(`   ${now}`);
        last = now;
        movedAt = Date.now();
      }
    }
    if (Date.now() - movedAt > STILL_FOR_MS) throw new Error("The phone has said nothing new for 10 minutes. Look at its screen.");
  }
}

async function onThePhone(): Promise<void> {
  if (adb(["get-state"]).text !== "device") fail("No phone on the USB cable. Plug it in with USB debugging on, and allow this computer on the phone.");
  const id = appId();
  if (!adb(["shell", "pm", "list", "packages", id]).text.split(/\s+/).includes(`package:${id}`)) {
    fail(`This folder's copy (${id}) is not on the phone. Run: corepack pnpm --filter mobile phone`);
  }
  const inApp = (command: string) => adb(["shell", `run-as ${id} ${command}`]);
  if (!inApp("true").ok) fail(`The phone will not let the laptop into ${id}: it must be a folder's copy, built for testing.`);

  const videos: PlanVideo[] = labels.map((label) => {
    const frames = lists.get(label);
    if (frames === undefined) throw new Error(`No frame list for ${label}.`);
    return { label, sha256: videoSum(label), frames, pictures };
  });
  // This kind's old files go before anything is sent: a run the phone gives no file for this time must never be
  // reported from the last time (round one, H2).
  const cleared = runFiles(readdirSync(PHONE_OUT));
  for (const name of cleared) rmSync(join(PHONE_OUT, name));
  if (cleared.length > 0) console.log(`Cleared ${String(cleared.length)} files of earlier ${variant} runs, every video's, from ${PHONE_OUT}.`);
  writeFileSync(PLAN, JSON.stringify(makePlan(videos, runs, people)));

  adb(["shell", "am", "force-stop", id]);
  try {
    inApp(`rm -rf ${ON_PHONE}`);
    if (!inApp(`mkdir -p ${ON_PHONE}/videos ${ON_PHONE}/models`).ok) throw new Error("The phone would not make the test's folder.");
    // Into the shell's own folder first, then copied into the app's by the app's own user: Windows' adb changes the
    // bytes of a file piped through the phone's shell (measured 2026-11-17: a 495 KB video came out another file).
    // A folder (the laptop's pictures) goes whole and is checked as one sum over its pictures in order.
    const send = (local: string, path: string, what: string, folder = false): void => {
      const name = basename(path);
      if (!adb(["push", local, `${STAGING}/${name}`]).ok) throw new Error(`${what} did not reach the phone.`);
      if (!inApp(`cp ${folder ? "-r " : ""}${STAGING}/${name} ${path}`).ok) throw new Error(`${what} could not go into the app's own files.`);
      adb(["shell", `rm -rf ${STAGING}/${name}`]);
      const sum = (folder ? inApp(`sh -c 'cat ${path}/*.png | sha256sum'`) : inApp(`sha256sum ${path}`)).text.split(/\s+/)[0];
      if (sum !== sha256Of(folder ? pictureFiles(local) : [local])) throw new Error(`${what} did not arrive whole.`);
    };
    adb(["shell", `rm -rf ${STAGING}`]);
    if (!adb(["shell", `mkdir -p ${STAGING}`]).ok) throw new Error("The phone would not make the laptop's folder.");
    for (const v of videos) {
      console.log(`Sending ${v.label} to the phone.`);
      if (pictures === "laptop") send(copies.get(v.label) ?? "", `${ON_PHONE}/videos/${v.label}`, `The laptop's pictures of ${v.label}`, true);
      else send(copies.get(v.label) ?? "", `${ON_PHONE}/videos/${v.label}.mp4`, `The video ${v.label}`);
    }
    for (const m of models) {
      console.log(`Sending the ${m.size} model to the phone.`);
      send(modelPaths.get(m.name) ?? "", `${ON_PHONE}/models/${m.name}.task`, `The ${m.size} model`);
    }
    send(PLAN, `${ON_PHONE}/plan.json`, "The plan");

    const opened = adb(["shell", "am", "start", "-W", "-n", `${id}/${ACTIVITY}`]);
    if (!opened.ok || /Error|Exception/i.test(opened.text)) throw new Error(`The phone test did not open on the phone:\n${opened.text}`);
    console.log(`The phone test is open on the phone: ${String(videos.length * runs.length)} runs.`);

    const progress = await finished(id);
    if (progress.state === "failed") console.log(`The phone stopped: ${progress.reason ?? "it gave no reason"}`);

    const names = runFiles(inApp(`ls ${ON_PHONE}/out`).text.split(/\s+/));
    for (const name of names) {
      const file = adb(["exec-out", "run-as", id, "cat", `${ON_PHONE}/out/${name}`]);
      if (!file.ok) throw new Error(`${name} could not be taken from the phone.`);
      writeFileSync(join(PHONE_OUT, name), file.out);
    }
    console.log(`Took ${String(names.length)} files back from the phone.`);
  } finally {
    inApp(`rm -rf ${ON_PHONE}`);
    adb(["shell", `rm -rf ${STAGING}`]);
    adb(["shell", "am", "force-stop", id]);
    const left = inApp("ls files").text.split(/\s+/).includes("phone-test") || adb(["shell", `ls -d ${STAGING}`]).ok;
    console.log(left ? "THE TEST'S FILES ARE STILL ON THE PHONE." : "The phone holds none of the test's files now.");
  }
}

// Every refusal on the phone is thrown, never an exit: the finally above must delete what was sent.
if (values["laptop-only"]) {
  console.log(`The laptop's side is ready in ${HERE}: the models, the laptop's runs and the frame lists. The phone was not touched.`);
  process.exit(0);
}
if (!values["compare-only"]) {
  try {
    await onThePhone();
  } catch (err) {
    fail(messageOf(err));
  }
}

// ── 4. The comparison ────────────────────────────────────────────────────────────
const lines: string[] = [];
const say = (line = ""): void => {
  console.log(line);
  lines.push(line);
};
const pad = (s: string, n: number): string => s.padEnd(n);
const ms = (v: number): string => (Number.isFinite(v) ? `${v.toFixed(0)} ms` : "-");
const chipWord = (d: PhoneTestDelegate): string => (d === "gpu" ? "graphics" : "main");
const coresWord = (d: PhoneTestDelegate, n: number | null): string => (d === "gpu" ? "-" : n === null ? "own" : String(n));
const busyWord = (v: number | null): string => (v === null ? "-" : v.toFixed(2));
const runWords = (r: { model: string; delegate: PhoneTestDelegate; threads: number | null }): string =>
  `${sizeOf(r.model)} model, ${chipWord(r.delegate)} chip${r.delegate === "cpu" ? (r.threads === null ? ", the library's own cores" : `, ${String(r.threads)} ${r.threads === 1 ? "core" : "cores"}`) : ""}`;
const sizeOf = (name: string): string => MODELS.find((m) => m.name === name)?.size ?? name;

/** The plan this kind of run was made from; a kind whose plan was never kept (51a's first runs) has none, and only
 *  its files that name no plan are read. */
const planSum = existsSync(PLAN) ? sha256Of([PLAN]) : "none";
const results: PhoneComparison[] = [];
const failed: { label: string; model: string; delegate: PhoneTestDelegate; threads: number | null; reason: string }[] = [];
const detectTimes = new Map<string, number[]>();
const phoneRuns = new Map<string, PhoneRun>();
let phoneName = "";
for (const label of labels) {
  for (const m of models) {
    for (const { delegate, threads: cores } of runs.filter((r) => r.model === m)) {
      const name = runName(label, m.name, delegate, cores);
      const runPath = join(PHONE_OUT, `${name}.jsonl`);
      const failedPath = join(PHONE_OUT, `${name}.failed.json`);
      if (existsSync(failedPath)) {
        const f = readPhoneFailure(readFileSync(failedPath, "utf8"));
        const older = f.plan !== null && f.plan !== planSum;
        failed.push({ label, model: f.model, delegate: f.delegate, threads: f.threads, reason: older ? "an older run's note: the file was made for another plan" : f.reason });
        continue;
      }
      if (!existsSync(runPath)) {
        failed.push({ label, model: m.name, delegate, threads: cores, reason: "the phone gave no file for it" });
        continue;
      }
      const run = readPhoneRun(readFileSync(runPath, "utf8"));
      phoneRuns.set(name, run);
      const ref = laptop.get(`${label}|${m.name}`) ?? fail(`No laptop run of ${label} with ${m.name}.`);
      results.push(comparePhone(ref, run, { plan: planSum, video: videoSum(label), model: m.sha256, threads: cores }));
      const key = runKey({ model: m.name, delegate, threads: cores });
      detectTimes.set(key, [...(detectTimes.get(key) ?? []), ...run.frames.slice(WARM_UP).map((f) => f.detectMs)]);
      phoneName = `${run.header.phone.maker} ${run.header.phone.model}, Android ${run.header.phone.android}, ${run.header.library}`;
    }
  }
}
if (results.length === 0 && failed.length === 0) fail("No phone files to compare. Run the test without --compare-only first.");

say(`The phone: ${phoneName || "no run finished"}. The model asked for up to ${String(people)} ${people === 1 ? "person" : "people"}; ${pictures === "laptop" ? "the laptop's own decoded pictures" : "the phone decoding the videos itself"}.`);
say("");
say(
  pictures === "laptop"
    ? "Is each run the laptop's numbers? The same: within a tenth of the model's own shake in 99 of 100 big joints, and readings given by one only in at most 1 of 1,000."
    : "The phone decoded the videos itself, so no run is judged here: its numbers hold its video decoder as well as its chip. Only --pictures laptop tests a chip.",
);
// Measured 2026-11-18 (51b-i): asked for one person, the library looks for the body where its last points were, so
// two processors' last-digit rounding is carried from picture to picture and grows (the squat's hip 0.01 mm apart in
// the first picture, up to 7 mm later); asked for six it looks afresh in every picture and stays the laptop's (51a).
if (pictures === "laptop" && people === 1) {
  say("Asked for one person, the model looks for the body where its last points were, so the last digits two processors round apart");
  say("are carried from picture to picture and grow: no chip can be the laptop's numbers here. Ask for six to test that; here, read the gaps.");
}
say(`   ${pad("model", 7)}${pad("chip", 10)}${pad("cores", 7)}${pad("busy", 7)}${pad("same", 7)}${pad("differs", 9)}${pad("compared", 10)}${pad("refused", 9)}${pad("reading p50", 13)}${pad("p95", 9)}${pad("start", 9)}warmest`);
const rows = summaries(results, failed, detectTimes);
for (const r of rows) {
  say(
    `   ${pad(sizeOf(r.model), 7)}${pad(chipWord(r.delegate), 10)}${pad(coresWord(r.delegate, r.threads), 7)}${pad(busyWord(r.busy), 7)}${pad(String(r.same), 7)}${pad(String(r.differs), 9)}${pad(String(r.comparedOnly), 10)}${pad(String(r.notComparable + r.failed), 9)}${pad(ms(r.detect.median), 13)}${pad(ms(r.detect.p95), 9)}${pad(ms(r.create), 9)}${String(r.warmest)}`,
  );
}
say("   cores: the main chip's, as asked (own: the library's own number). busy: how many cores the app kept busy while the model read, the");
say("   middle of the runs (Android's count of the app's time on the cores, over the reading's time). refused: not comparable (other");
say("   pictures, a wrong way of reading the person, no 3D, other cores) or no run. reading: the pose model's time for one picture, after");
say("   its first ten. start: before its first picture. warmest: Android's thermal status, 0 none to 6.");

const cm = (v: number): string => `${(100 * v).toFixed(1)} cm`;
const keyLines = (f: FrameComparison): string[] => keyGaps(f.gaps).map((g) => gapWords(g));
for (const r of results) {
  const f = r.frames;
  say("");
  say(`${r.label}, ${runWords(r)}: ${r.verdict.toUpperCase()}`);
  for (const why of r.reasons) say(`   - ${why}`);
  if (f !== null) {
    const c = f.closeness;
    say(`   big joints apart: on the picture ${f.points.flat.p95.toFixed(3)} of a trunk in 95 of 100; in 3D ${cm(f.points.world.p95)} in 95 of 100, ${(1000 * c.world99).toFixed(2)} mm in 99 (the model's own shake ${(1000 * c.worldShake).toFixed(2)} mm)`);
    if (f.fit !== null) {
      say(`   fit where the body moves most (${String(f.fit.frames)} frames, in trunks): as it is ${f.fit.asIs.toFixed(4)}, a picture late ${f.fit.late.toFixed(4)}, early ${f.fit.early.toFixed(4)}, mirrored ${f.fit.mirrored.toFixed(4)}, swapped ${f.fit.swapped.toFixed(4)}`);
    }
    if (f.several > 0) say(`   where the laptop found more than one person (${String(f.several)} frames), the phone found as many in ${String(f.severalSame)}; most people in a frame: laptop ${String(f.mostLaptop)}, phone ${String(f.mostOther)}`);
    for (const line of keyLines(f)) say(`   ${line}`);
  }
  say(`   reading ${ms(r.speed.detect.median)} (p95 ${ms(r.speed.detect.p95)}), one person ${ms(r.speed.one)}, more ${ms(r.speed.several)}; cores busy ${busyWord(r.speed.busy)}; decoding ${ms(r.speed.decode)}; start ${ms(r.speed.create)}; thermal ${String(r.heat.before.thermal)} to ${String(r.heat.after.thermal)}, battery ${String(r.heat.before.batteryC ?? "-")} to ${String(r.heat.after.batteryC ?? "-")} °C`);
}
for (const f of failed) {
  say("");
  say(`${f.label}, ${runWords(f)}: NO RUN. ${f.reason}`);
}

/** One block of a comparison of two runs that are not the laptop against the phone, reading by reading. */
function sayAgainst(title: string, pairs: readonly { what: string; a: readonly MovementFrame[]; b: readonly MovementFrame[] }[]): void {
  if (pairs.length === 0) return;
  say("");
  say(title);
  for (const { what, a, b } of pairs) {
    const c = compareFrames(a, b);
    say(`   ${what}: big joints in 3D ${cm(c.points.world.p95)} apart in 95 of 100`);
    for (const line of keyLines(c)) say(`      ${line}`);
  }
}

// Each run against the main chip on the library's own cores, the same model and the same pictures, on the phone: what
// differs is the chip, or the cores, alone.
sayAgainst(
  "Each run against the main chip on the library's own cores, the same model and the same pictures (lean: the middle of the run less the main chip's own; spread: 95 in 100):",
  labels.flatMap((label) =>
    runs.flatMap(({ model: m, delegate, threads: cores }) => {
      if (delegate === "cpu" && cores === null) return [];
      const own = phoneRuns.get(runName(label, m.name, "cpu"));
      const other = phoneRuns.get(runName(label, m.name, delegate, cores));
      return own === undefined || other === undefined ? [] : [{ what: `${label}, ${runWords({ model: m.name, delegate, threads: cores })}`, a: phoneFrames(own), b: phoneFrames(other) }];
    }),
  ),
);

// The smaller models against the heavy one, both on the laptop: what a smaller model would move, reading by reading.
const heavy = MODELS.find((m) => m.size === "heavy");
if (heavy !== undefined && models.includes(heavy)) {
  sayAgainst(
    "The smaller models against the heavy one, both on the laptop (lean: the smaller less heavy):",
    models
      .filter((m) => m !== heavy)
      .flatMap((m) =>
        labels.flatMap((label) => {
          const a = laptop.get(`${label}|${heavy.name}`);
          const b = laptop.get(`${label}|${m.name}`);
          return a === undefined || b === undefined ? [] : [{ what: `${label}, ${m.size}`, a: a.frames, b: b.frames }];
        }),
      ),
  );
}

// Asked for fewer people than six against six, both on the laptop: the setting's own part, and each run's shake.
if (people !== SETTINGS.people) {
  const pairs = labels.flatMap((label) =>
    models.flatMap((m) => {
      const six = existsSync(laptopPath(label, m, SETTINGS.people)) ? decodeBodyPoints(new Uint8Array(readFileSync(laptopPath(label, m, SETTINGS.people)))) : undefined;
      const fewer = laptop.get(`${label}|${m.name}`);
      return six === undefined || fewer === undefined ? [] : [{ what: `${label}, ${m.size}`, a: six.frames, b: fewer.frames }];
    }),
  );
  sayAgainst(`Asked for ${String(people)} against ${String(SETTINGS.people)}, the same model on the laptop (lean: ${String(people)} less ${String(SETTINGS.people)}):`, pairs);
  if (pairs.length > 0) {
    say("");
    say("The model's own shake in 3D, the middle frame-to-frame of a used big joint, on the laptop:");
    for (const { what, a, b } of pairs) say(`   ${pad(what, 50)}asked for ${String(SETTINGS.people)}: ${(1000 * shakeOf(a).world).toFixed(1)} mm; for ${String(people)}: ${(1000 * shakeOf(b).world).toFixed(1)} mm`);
  }
}

say("");
say("This test picks nothing: nothing here ran on the live camera. Job 51b-ii picks, on the selfie camera (ROADMAP).");
writeFileSync(join(HERE, `report-${variant}.txt`), `${lines.join("\n")}\n`);
writeFileSync(join(HERE, `report-${variant}.json`), JSON.stringify({ rows, results, failed }, (_, v: unknown) => (typeof v === "number" && !Number.isFinite(v) ? null : v), 1));
console.log(`\nTook ${((Date.now() - started) / 1000).toFixed(0)} s. The report: ${join(HERE, `report-${variant}.txt`)}`);
