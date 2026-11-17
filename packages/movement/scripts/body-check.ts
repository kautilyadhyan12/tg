// The possible-body check and the steady points on Kd's kept videos (ROADMAP 50c-ii):
//   corepack pnpm --filter @app/movement body-check [<file.bodypoints> ...] [--videos <folder>] [--no-pictures]
// With no file it reads every one kept in test/body-points. It prints, for each video, what
// share of the big joints was used and why the rest was refused; each fitted limit as its
// rule sets it from all the videos, against what the engine holds; the limits set from five
// people and tried on the sixth; and the same videos at half the frames a second. With the
// videos on this laptop (Kd's own folder by default) it draws the refused frames into
// measured/<label>/body-check/, which git ignores.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { LIMITS, STEADY, type Smoothing } from "../src/index.js";
import { decodeBodyPoints } from "./bodyPoints.js";
import {
  REASONS,
  agreementOf,
  chooseBone,
  chooseSteady,
  countOf,
  framesToDraw,
  halfRate,
  leaveOneOut,
  runChecks,
  runSteady,
  videoOf,
  type Steadiness,
  type Video,
} from "./bodyCheck.js";
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
    fail(`${err instanceof Error ? err.message : String(err)}\nUsage: body-check [<file.bodypoints> ...] [--videos <folder>] [--no-pictures]`);
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

const pct = (n: number, of: number): string => (of === 0 ? "  -  " : `${((100 * n) / of).toFixed(1)}%`);
const cm = (m: number): string => `${(m * 100).toFixed(2)} cm`;
const pad = (s: string, n: number): string => s.padEnd(n);
const smoothingWords = (s: Smoothing): string => `${String(s.minCutoff)} Hz at rest, +${String(s.beta)} Hz a metre a second`;
const steadyWords = (s: Steadiness): string => `shake ${cm(s.shakeRaw)} -> ${cm(s.shake)}; a moving joint ${cm(s.behindRaw)} -> ${cm(s.behind)} off`;

// 1. Each video, with the engine's own limits.
console.log("The twelve big joints in every frame: how many were used, and why the rest were not.");
console.log(`${pad("video", 40)}${pad("one person", 11)}${pad("used", 8)}${REASONS.map((r) => pad(r, 10)).join("")}`);
for (const v of videos) {
  const c = countOf(runChecks(v.frames));
  console.log(
    `${pad(v.label, 40)}${pad(v.onePerson ? "yes" : "no", 11)}${pad(pct(c.used, c.pointFrames), 8)}${REASONS.map((r) => pad(pct(c.why[r], c.pointFrames), 10)).join("")}`,
  );
}

// What it costs: the phone's own number is job 51's; this is the laptop's.
const timing = performance.now();
const timedFrames = videos.reduce((sum, v) => sum + runSteady(runChecks(v.frames)).length, 0);
const took = performance.now() - timing;
console.log(`Checked and steadied ${String(timedFrames)} frames in ${took.toFixed(0)} ms: ${((1000 * took) / timedFrames).toFixed(0)} microseconds a frame on this laptop.`);

// 2. The fitted limits as their rules set them from every video.
const bone = chooseBone(videos);
const flat = chooseSteady(videos, "flat", bone);
const world = chooseSteady(videos, "world", bone);
console.log("");
console.log(`Bone limit from all the videos: ${String(bone)} of the trunk (the engine holds ${String(LIMITS.bone)}).`);
console.log(`Steady on the picture: ${smoothingWords(flat.smoothing)} (the engine holds ${smoothingWords(STEADY.flat)}).`);
for (const e of flat.each) console.log(`   ${pad(e.label, 40)}${steadyWords(e.steadiness)}`);
console.log(`Steady in 3D: ${smoothingWords(world.smoothing)} (the engine holds ${smoothingWords(STEADY.world)}).`);
for (const e of world.each) console.log(`   ${pad(e.label, 40)}${steadyWords(e.steadiness)}`);
const same =
  bone === LIMITS.bone &&
  flat.smoothing.minCutoff === STEADY.flat.minCutoff &&
  flat.smoothing.beta === STEADY.flat.beta &&
  world.smoothing.minCutoff === STEADY.world.minCutoff &&
  world.smoothing.beta === STEADY.world.beta;
if (!same) console.log("THE ENGINE'S LIMITS ARE NOT THE ONES THESE VIDEOS SET.");

// 3. Set from five, tried on the sixth.
console.log("");
console.log("Each limit set from five people and tried on the sixth:");
for (const f of leaveOneOut(videos)) {
  console.log(`   without ${f.heldOut}: bone ${String(f.bone)}, refuses ${pct(f.heldOutBoneLoss, 1)} of its judged joints for a bone`);
  console.log(`      picture: ${smoothingWords(f.flat)}: ${steadyWords(f.heldOutFlat)}`);
  console.log(`      3D: ${smoothingWords(f.world)}: ${steadyWords(f.heldOutWorld)}`);
}

// 4. Half the frames a second.
console.log("");
console.log("The same videos at half the frames a second, against the full rate, at the frames both have:");
for (const v of videos) {
  const a = agreementOf(runSteady(runChecks(v.frames)), runSteady(runChecks(halfRate(v.frames))));
  console.log(`   ${pad(v.label, 40)}used by one and not the other: ${pct(a.differ, a.compared)}; a steady joint moved ${cm(a.apart)} (95 in 100)`);
}

// 5. Pictures of the refused frames.
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
    const look = framesToDraw(runChecks(video.frames));
    const out = join(REPO, "measured", video.label, "body-check");
    try {
      prepareOutFolder(out, source);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
    const lookPath = join(out, "look.json");
    writeFileSync(lookPath, JSON.stringify({ frames: look }));
    const r = spawnSync(values.python, [POINTS_PY, "draw", "--look", lookPath, "--video", source, "--fps", String(fps), "--out", out], {
      stdio: "inherit",
    });
    if (r.status !== 0) fail(`Drawing ${video.label} stopped.`);
    console.log(`${video.label}: ${String(look.length)} pictures in ${out}`);
  }
}
console.log(`Took ${((Date.now() - started) / 1000).toFixed(0)} s.`);
