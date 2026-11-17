// The phone test (ROADMAP Stage 5 item 51a): Kd's reference videos through the phone's own pose model, three sizes,
// on the main chip and the graphics chip, each against the laptop's run of the same model on the same video.
//   corepack pnpm --filter @app/movement phone-test [--laptop-only | --compare-only] [--models lite,full,heavy] [--chips cpu,gpu]
//                                                   [--labels a,b] [--people 1 to 6] [--pictures video|laptop]
//                                                   [--videos <folder>] [--python <command>]
// It needs this folder's copy of the app on the phone on the USB cable (corepack pnpm --filter mobile phone), puts the
// videos, the models and a plan in that copy's own files, opens its phone-test screen, waits, takes one file a run
// back, deletes everything it put there, then compares. --laptop-only makes the laptop's side ready and stops before the
// phone is touched; --compare-only compares the files already taken back. --people asks the model for fewer people than
// the laptop's six (the laptop then measures the same way); --pictures laptop hands the phone the laptop's own decoded
// pictures instead of the video, so what still differs is the model's part alone. Each kind of run keeps its own files.
// Everything it writes is in measured/phone-test/, which git ignores; the videos never leave Kd's folder but for the
// phone's copy of the app, and are deleted there when the test ends.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { PHONE_TEST_DELEGATES, phoneProgressSchema, videoFramesSchema, type PhoneProgress, type PhoneTestDelegate, type VideoFrames } from "@app/shared";
import { decodeBodyPoints, type BodyPoints } from "./bodyPoints.js";
import { KD_VIDEOS, assertFolderStaysOutOfGit } from "./outFolder.js";
import {
  FAST_ENOUGH_MS,
  WARM_UP,
  compareFrames,
  comparePhone,
  gapWords,
  pick,
  summaries,
  type PhoneComparison,
} from "./phoneCheck.js";
import { MODELS, SETTINGS, makePlan, modelUrl, readPhoneFailure, readPhoneRun, runName, type PlanRun, type PlanVideo, type PoseModel } from "./phoneRun.js";

const REPO = resolve(import.meta.dirname, "../../..");
const KEPT = join(import.meta.dirname, "../test/body-points");
const POINTS_PY = join(import.meta.dirname, "points.py");
const MEASURE_POINTS = join(import.meta.dirname, "measure-points.ts");
const MOBILE = join(REPO, "apps", "mobile");
const HERE = join(REPO, "measured", "phone-test");
const ON_PHONE = "files/phone-test";
/** Where adb puts a file on its way into the app's own files: the shell's folder, which no app can read. */
const STAGING = "/data/local/tmp/kwazo-phone-test";
const ACTIVITY = "expo.modules.phonetest.PhoneTestActivity";
/** The phone is given this long without a word before the laptop stops waiting. */
const STILL_FOR_MS = 10 * 60 * 1000;
const PHONE_FILE = /^[A-Za-z0-9_-]{1,80}\.pose_landmarker_(lite|full|heavy)\.(cpu|gpu)\.(jsonl|failed\.json)$/;

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
        labels: { type: "string" },
        people: { type: "string", default: String(SETTINGS.people) },
        pictures: { type: "string", default: "video" },
        videos: { type: "string", default: KD_VIDEOS },
        python: { type: "string", default: "python" },
      },
    });
  } catch (err) {
    fail(`${messageOf(err)}\nUsage: phone-test [--laptop-only | --compare-only] [--models lite,full,heavy] [--chips cpu,gpu] [--labels a,b] [--people 1 to 6] [--pictures video|laptop] [--videos <folder>]`);
  }
})();

const listed = (text: string): string[] => text.split(",").map((s) => s.trim()).filter((s) => s !== "");
const models: PoseModel[] = listed(values.models).map((size) => MODELS.find((m) => m.size === size) ?? fail(`--models takes lite, full and heavy, not "${size}".`));
const chips: PhoneTestDelegate[] = listed(values.chips).map((c) => PHONE_TEST_DELEGATES.find((d) => d === c) ?? fail(`--chips takes cpu and gpu, not "${c}".`));
if (models.length === 0 || chips.length === 0) fail("Give at least one model and one chip.");
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

/** The laptop's run of a video with a model, asking for as many people as the phone is asked for: the kept heavy file
 *  for six, otherwise measured here. */
function laptopRun(label: string, m: PoseModel): BodyPoints {
  const kept = join(KEPT, `${label}.bodypoints`);
  const folder = people === SETTINGS.people ? join(HERE, "laptop", m.name, label) : join(HERE, "laptop", m.name, `people-${String(people)}`, label);
  const path = m.size === "heavy" && people === SETTINGS.people ? kept : join(folder, `${label}.bodypoints`);
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
const copies = new Map<string, string>();
if (!values["compare-only"]) {
  for (const label of labels) {
    const list = lists.get(label);
    if (list !== undefined) copies.set(label, pictures === "laptop" ? laptopPicturesOf(label, list) : phoneCopyOf(label, list));
  }
}

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
    const copy = copies.get(label);
    if (copy === undefined) throw new Error(`No phone copy of ${label}.`);
    const frames = lists.get(label);
    if (frames === undefined) throw new Error(`No frame list for ${label}.`);
    return { label, sha256: sha256Of(pictures === "laptop" ? pictureFiles(copy) : [copy]), frames, pictures };
  });
  const runs: PlanRun[] = models.flatMap((model) => chips.map((delegate) => ({ model, delegate })));
  const plan = JSON.stringify(makePlan(videos, runs, people));
  writeFileSync(join(HERE, "plan.json"), plan);

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
    send(join(HERE, "plan.json"), `${ON_PHONE}/plan.json`, "The plan");

    const opened = adb(["shell", "am", "start", "-W", "-n", `${id}/${ACTIVITY}`]);
    if (!opened.ok || /Error|Exception/i.test(opened.text)) throw new Error(`The phone test did not open on the phone:\n${opened.text}`);
    console.log(`The phone test is open on the phone: ${String(videos.length * runs.length)} runs.`);

    const progress = await finished(id);
    if (progress.state === "failed") console.log(`The phone stopped: ${progress.reason ?? "it gave no reason"}`);

    const names = inApp(`ls ${ON_PHONE}/out`).text.split(/\s+/).filter((n) => PHONE_FILE.test(n));
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
const sizeOf = (name: string): string => MODELS.find((m) => m.name === name)?.size ?? name;

const results: PhoneComparison[] = [];
const failed: { label: string; model: string; delegate: PhoneTestDelegate; reason: string }[] = [];
const detectTimes = new Map<string, number[]>();
let phoneName = "";
for (const label of labels) {
  for (const m of models) {
    for (const delegate of chips) {
      const name = runName(label, m.name, delegate);
      const runPath = join(PHONE_OUT, `${name}.jsonl`);
      const failedPath = join(PHONE_OUT, `${name}.failed.json`);
      if (existsSync(failedPath)) {
        const f = readPhoneFailure(readFileSync(failedPath, "utf8"));
        failed.push({ label, model: f.model, delegate: f.delegate, reason: f.reason });
        continue;
      }
      if (!existsSync(runPath)) {
        failed.push({ label, model: m.name, delegate, reason: "the phone gave no file for it" });
        continue;
      }
      const run = readPhoneRun(readFileSync(runPath, "utf8"));
      const ref = laptop.get(`${label}|${m.name}`) ?? fail(`No laptop run of ${label} with ${m.name}.`);
      results.push(comparePhone(ref, run));
      const key = `${m.name}|${delegate}`;
      detectTimes.set(key, [...(detectTimes.get(key) ?? []), ...run.frames.slice(WARM_UP).map((f) => f.detectMs)]);
      phoneName = `${run.header.phone.maker} ${run.header.phone.model}, Android ${run.header.phone.android}, ${run.header.library}`;
    }
  }
}
if (results.length === 0 && failed.length === 0) fail("No phone files to compare. Run the test without --compare-only first.");

say(`The phone: ${phoneName || "no run finished"}. The model asked for up to ${String(people)} ${people === 1 ? "person" : "people"}; ${pictures === "laptop" ? "the laptop's own decoded pictures" : "the phone decoding the videos itself"}.`);
say("");
say("Is each run the laptop's? Each video against the laptop's run of the same model, judged by the laptop at half the frames a second.");
say(`   ${pad("model", 7)}${pad("chip", 10)}${pad("same", 9)}${pad("reading p50", 13)}${pad("p95", 9)}${pad("start", 9)}warmest`);
const rows = summaries(results, failed, detectTimes);
for (const r of rows) {
  say(
    `   ${pad(sizeOf(r.model), 7)}${pad(chipWord(r.delegate), 10)}${pad(`${String(r.same)} of ${String(r.videos)}`, 9)}${pad(ms(r.detect.median), 13)}${pad(ms(r.detect.p95), 9)}${pad(ms(r.create), 9)}${String(r.warmest)}`,
  );
}
say("   reading: the pose model's time for one picture, after its first ten. start: before its first picture. warmest: Android's thermal status, 0 none to 6.");

for (const r of results) {
  const f = r.frames;
  say("");
  say(`${r.label}, ${sizeOf(r.model)} model, ${chipWord(r.delegate)} chip: ${r.refused.length === 0 ? "the same as the laptop" : "NOT the laptop's"}`);
  for (const why of r.refused) say(`   - ${why}`);
  if (f !== null) {
    say(`   points apart (big joints, 95 in 100): ${f.points.flat.p95.toFixed(3)} of a trunk on the picture, ${(100 * f.points.world.p95).toFixed(1)} cm in 3D`);
    say(
      `   measures apart (95 in 100): ${f.measures.apart.angle.toFixed(2)}°, ${f.measures.apart.length.toFixed(3)} of a length; at half the frames a second ${f.yardstick.apart.angle.toFixed(2)}°, ${f.yardstick.apart.length.toFixed(3)}`,
    );
    if (f.fit !== null) {
      say(`   fit where the body moves most (${String(f.fit.frames)} frames, in trunks): as it is ${f.fit.asIs.toFixed(4)}, a picture late ${f.fit.late.toFixed(4)}, early ${f.fit.early.toFixed(4)}, mirrored ${f.fit.mirrored.toFixed(4)}, swapped ${f.fit.swapped.toFixed(4)}`);
    }
    if (f.several > 0) say(`   where the laptop found more than one person (${String(f.several)} frames), the phone found as many in ${String(f.severalSame)}; most people in a frame: laptop ${String(f.mostLaptop)}, phone ${String(f.mostOther)}`);
    const worst = [...f.gaps].sort((a, b) => b.p95 - a.p95).slice(0, 3);
    for (const g of worst) say(`   ${gapWords(g)}`);
  }
  say(`   reading ${ms(r.speed.detect.median)} (p95 ${ms(r.speed.detect.p95)}), one person ${ms(r.speed.one)}, more ${ms(r.speed.several)}; decoding ${ms(r.speed.decode)}; start ${ms(r.speed.create)}; thermal ${String(r.heat.before.thermal)} to ${String(r.heat.after.thermal)}, battery ${String(r.heat.before.batteryC ?? "-")} to ${String(r.heat.after.batteryC ?? "-")} °C`);
}
for (const f of failed) {
  say("");
  say(`${f.label}, ${sizeOf(f.model)} model, ${chipWord(f.delegate)} chip: NO RUN. ${f.reason}`);
}

// The smaller models against the heavy one, both on the laptop: what a smaller model would cost in the numbers.
const heavy = MODELS.find((m) => m.size === "heavy");
if (heavy !== undefined && models.includes(heavy)) {
  say("");
  say("The smaller models against the heavy one, both on the laptop (measures apart in 95 of 100; read by one only):");
  for (const m of models.filter((x) => x !== heavy)) {
    for (const label of labels) {
      const a = laptop.get(`${label}|${heavy.name}`);
      const b = laptop.get(`${label}|${m.name}`);
      if (a === undefined || b === undefined) continue;
      const c = compareFrames(a.frames, b.frames);
      const differ = c.measures.compared === 0 ? 0 : (100 * c.measures.differ) / c.measures.compared;
      say(`   ${pad(m.size, 6)}${pad(label, 42)}${c.measures.apart.angle.toFixed(2)}°, ${c.measures.apart.length.toFixed(3)} of a length; ${differ.toFixed(1)} in 100`);
    }
  }
}

say("");
const chosen = pick(rows);
say(
  chosen === null
    ? `Pick so far: none. No model is the laptop's on every video and reads a picture in ${String(FAST_ENOUGH_MS)} ms or less in 95 of 100.`
    : `Pick so far: the ${sizeOf(chosen.model)} model on the ${chipWord(chosen.delegate)} chip, the biggest that is the laptop's on every video and reads a picture in ${String(FAST_ENOUGH_MS)} ms or less in 95 of 100 (20 a second, spec Part 6 §3.2). Job 51b tries it on the live camera for 20 minutes.`,
);
writeFileSync(join(HERE, `report-${variant}.txt`), `${lines.join("\n")}\n`);
writeFileSync(join(HERE, `report-${variant}.json`), JSON.stringify({ rows, results, failed }, (_, v: unknown) => (typeof v === "number" && !Number.isFinite(v) ? null : v), 1));
console.log(`\nTook ${((Date.now() - started) / 1000).toFixed(0)} s. The report: ${join(HERE, `report-${variant}.txt`)}`);
