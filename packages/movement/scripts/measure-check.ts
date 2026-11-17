// The body measures on Kd's kept videos (ROADMAP 50c-iii):
//   corepack pnpm --filter @app/movement measure-check [<file.bodypoints> ...] [--videos <folder>] [--no-pictures]
// With no file it reads every one kept in test/body-points. It prints, for each video and
// measure, how often it is read in 3D and on the flat picture, how much of it the picture shows,
// how much each reading shakes and which is the steadier; for each measure, on how many of the
// one-person videos each reading is the steadier; and the same videos at half the frames a second. With the videos on this laptop (Kd's own
// folder by default) it draws frames with their measures into measured/<label>/measure-check/,
// which git ignores.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { MEASURE_LIMITS, MEASURE_LIST, type Unit } from "../src/index.js";
import { decodeBodyPoints } from "./bodyPoints.js";
import { halfRate, runChecks, runSteady, videoOf, type Video } from "./bodyCheck.js";
import {
  agreementOf,
  chooseAngleLimit,
  chooseLengthLimit,
  chooseSizeChange,
  framesToDraw,
  leaveOneOut,
  runMeasures,
  runOf,
  sizeSwings,
  steadierOf,
  summariesOf,
} from "./measureCheck.js";
import { KD_VIDEOS, prepareOutFolder } from "./outFolder.js";

const REPO = resolve(import.meta.dirname, "../../..");
const KEPT = join(import.meta.dirname, "../test/body-points");
const POINTS_PY = join(import.meta.dirname, "points.py");
const typedFrom = process.env["INIT_CWD"] ?? process.cwd();

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values, positionals } = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        videos: { type: "string", default: KD_VIDEOS },
        "no-pictures": { type: "boolean", default: false },
        python: { type: "string", default: "python" },
      },
    });
  } catch (err) {
    fail(`${err instanceof Error ? err.message : String(err)}\nUsage: measure-check [<file.bodypoints> ...] [--videos <folder>] [--no-pictures]`);
  }
})();

const files =
  positionals.length > 0
    ? positionals.map((p) => resolve(typedFrom, p))
    : readdirSync(KEPT)
        .filter((f) => f.endsWith(".bodypoints"))
        .sort()
        .map((f) => join(KEPT, f));
if (files.length === 0) fail("No body-points files to check.");

const started = Date.now();
const loaded = files.map((path) => {
  if (!existsSync(path)) fail(`No file at ${path}.`);
  const kept = decodeBodyPoints(new Uint8Array(readFileSync(path)));
  return { video: videoOf(kept.header.label, kept.frames), fps: kept.header.fps };
});
const videos: Video[] = loaded.map((l) => l.video);

const pad = (s: string, n: number): string => s.padEnd(n);
const pct = (n: number, of: number): string => (of === 0 ? "-" : `${((100 * n) / of).toFixed(0)}%`);
const num = (v: number, unit: Unit): string => (Number.isFinite(v) ? v.toFixed(unit === "degrees" ? 2 : 3) : "-");

// 0. The two fitted numbers.
const angle = chooseAngleLimit(videos);
const length = chooseLengthLimit(videos);
const sizeChange = chooseSizeChange(videos);
console.log(`Angle limit from the one-person videos: ${String(angle)}° (the engine holds ${String(MEASURE_LIMITS.angle)}°).`);
for (const f of leaveOneOut(videos)) {
  console.log(`   without ${pad(f.heldOut, 32)}${String(f.angle)}°; on it, ${pct(f.kept, 1)} of the flat angles the picture shows are given`);
}
console.log(`Length limit from the one-person videos: ${String(length)} of a leg or trunk (the engine holds ${String(MEASURE_LIMITS.length)}).`);
console.log(`Size change that sets the floor afresh: ${String(sizeChange)} (the engine holds ${String(MEASURE_LIMITS.sizeChange)}).`);
for (const s of sizeSwings(videos)) console.log(`   ${pad(s.label, 40)}its size changes by ${pct(s.swing, 1)} while the person stays in place`);
if (angle !== MEASURE_LIMITS.angle || length !== MEASURE_LIMITS.length || sizeChange !== MEASURE_LIMITS.sizeChange) console.log("THE ENGINE'S NUMBERS ARE NOT THE ONES THESE VIDEOS SET.");
console.log("");

// 1. Each video, each measure.
for (const v of videos) {
  const run = runOf(v);
  console.log("");
  console.log(`${v.label} (${String(v.frames.length)} frames${v.onePerson ? "" : ", more than one person found"})`);
  console.log(`   ${pad("measure", 34)}${pad("3D", 6)}${pad("flat", 6)}${pad("shown", 7)}${pad("shake flat", 12)}${pad("shake 3D", 12)}${pad("steadier", 10)}flat against 3D`);
  for (const s of summariesOf(run.measured)) {
    if (s.world === 0) continue;
    console.log(
      `   ${pad(s.name, 34)}${pad(pct(s.world, v.frames.length), 6)}${pad(pct(s.flat, s.world), 6)}${pad(Number.isFinite(s.shown) ? s.shown.toFixed(2) : "-", 7)}${pad(num(s.flatShake, s.unit), 12)}${pad(num(s.worldShake, s.unit), 12)}${pad(steadierOf(s), 10)}${num(s.apart, s.unit)}`,
    );
  }
}
console.log("");
console.log("3D: frames read in 3D, of all. flat: of those, also read flat. shown: the middle share of it the picture shows.");
console.log("Shake: the middle, in degrees, legs or trunks. steadier: '-' when fewer than 10 frames have both readings.");

// 2. For each measure, which reading is the steadier on the one-person videos.
console.log("");
console.log("On the one-person videos where both readings are read (at least 10 frames), the steadier:");
for (const { name } of MEASURE_LIST) {
  const words = videos
    .filter((v) => v.onePerson)
    .flatMap((v) => {
      const s = summariesOf(runOf(v).measured).find((x) => x.name === name);
      const which = s === undefined ? "-" : steadierOf(s);
      return which === "-" ? [] : [`${v.label.replace("_reference", "")} ${which}`];
    });
  if (words.length > 0) console.log(`   ${pad(name, 34)}${words.join(", ")}`);
}

// What it costs: the phone's own number is job 51's; this is the laptop's.
const steadyAll = videos.map((v) => runSteady(runChecks(v.frames)));
const timing = performance.now();
const timedFrames = steadyAll.reduce((sum, s) => sum + runMeasures(s).length, 0);
const took = performance.now() - timing;
console.log(`Measured ${String(timedFrames)} frames in ${took.toFixed(0)} ms: ${((1000 * took) / timedFrames).toFixed(0)} microseconds a frame on this laptop.`);

// 3. Half the frames a second.
console.log("");
console.log("The same videos at half the frames a second, at the frames both have:");
for (const v of videos) {
  const a = agreementOf(runOf(v).measured, runMeasures(runSteady(runChecks(halfRate(v.frames)))));
  console.log(
    `   ${pad(v.label, 40)}read by one and not the other: ${pct(a.differ, a.compared)}; apart (95 in 100): ${num(a.apart.angle, "degrees")}°, ${num(a.apart.length, "legs")} of a length`,
  );
}

// 4. Pictures.
if (!values["no-pictures"]) {
  const folder = values.videos;
  const videoFiles = existsSync(folder)
    ? readdirSync(folder, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
        .flatMap((d) => readdirSync(join(folder, d.name)).map((f) => join(folder, d.name, f)))
    : [];
  console.log("");
  for (const { video, fps } of loaded) {
    const source = videoFiles.find((p) => basename(p) === `${video.label}.mp4`);
    if (source === undefined) {
      console.log(`No video named ${video.label}.mp4 in ${folder}: no pictures for it.`);
      continue;
    }
    const look = framesToDraw(runOf(video));
    const out = join(REPO, "measured", video.label, "measure-check");
    try {
      prepareOutFolder(out, source);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
    const lookPath = join(out, "look.json");
    writeFileSync(lookPath, JSON.stringify({ frames: look }));
    const r = spawnSync(values.python, [POINTS_PY, "draw", "--look", lookPath, "--video", source, "--fps", String(fps), "--out", out], { stdio: "inherit" });
    if (r.status !== 0) fail(`Drawing ${video.label} stopped.`);
    console.log(`${video.label}: ${String(look.length)} pictures in ${out}`);
  }
}
console.log(`Took ${((Date.now() - started) / 1000).toFixed(0)} s.`);
