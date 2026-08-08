// Pose-input measurement (camera-accuracy card, 2026-08-08).
//   pnpm --filter @app/engine exec tsx scripts/measure-pose.ts <clip.jsonl> [...]
//
// WHAT THIS IS FOR. Kd's own testing found the model draws a skeleton on
// FURNITURE and the app believes it (OWED, "the pose model draws a skeleton on
// furniture"). The OWED line forbids picking a cut-off from judgement: the card
// must MEASURE what the model reports on an empty chair versus on a person, in
// his room, BEFORE any threshold is chosen. This script is that measurement —
// it reports what the recorded clips CONTAIN and what the real engine DOES with
// them. It chooses nothing and asserts nothing.
//
// It deliberately prints raw distributions rather than a verdict. A verdict here
// would be a threshold picked by this file, which is the thing the OWED line
// forbids.
//
// Node shell — outside the engine's pure runtime boundary (same posture as
// validate-trace.ts), so fs/console are fine here and banned in src/.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exerciseDefinitionSchema, type ExerciseDefinition } from "@app/shared";
import { compileDefinition, createSession, lintDefinition, parseTrace, replay } from "../src/index.js";

const DEFS_DIR = join(import.meta.dirname, "../src/definitions");

// BlazePose 33 index map (§2.1). Only the joints squat counting actually reads,
// plus two controls that are visible in every clip of a person.
const JOINTS: ReadonlyArray<readonly [string, number]> = [
  ["nose", 0],
  ["shoulder_L", 11],
  ["shoulder_R", 12],
  ["hip_L", 23],
  ["hip_R", 24],
  ["knee_L", 25],
  ["knee_R", 26],
  ["ankle_L", 27],
  ["ankle_R", 28],
];

// The engine's live gate (§3.2, conditioning.ts). Quoted, not chosen: it is
// printed as a REFERENCE LINE so the distributions can be read against the rule
// already in force. Nothing here proposes changing it.
const VIS_USABLE = 0.3;

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[i] ?? Number.NaN;
}

function fmt(v: number): string {
  return Number.isFinite(v) ? v.toFixed(3) : "—";
}

function pct(n: number, of: number): string {
  return of === 0 ? "—" : `${((100 * n) / of).toFixed(1)}%`;
}

function definitionFor(exercise: string): ExerciseDefinition {
  const raw: unknown = JSON.parse(readFileSync(join(DEFS_DIR, `${exercise}.json`), "utf8"));
  const def = exerciseDefinitionSchema.parse(raw);
  const issues = lintDefinition(def);
  if (issues.length > 0) {
    throw new Error(
      `definition ${exercise}.json failed the linter:\n` +
        issues.map((i) => `  ${i.field}: ${i.message}`).join("\n"),
    );
  }
  return def;
}

/** The `.detect.jsonl` sidecar the recorder writes alongside every clip: one
 *  line per frame the loop OFFERED, `n` = landmarks the model found in it.
 *  Absent for clips recorded before that sidecar existed — say so rather than
 *  reporting a detection rate of 100% that was never measured. */
function readDetections(file: string): { t: number; n: number }[] | null {
  const path = file.replace(/\.jsonl$/, ".detect.jsonl");
  if (!existsSync(path)) return null;
  const out: { t: number; n: number }[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const s = line.trim();
    if (s === "") continue;
    const rec = JSON.parse(s) as { t?: unknown; n?: unknown };
    if (typeof rec.t === "number" && typeof rec.n === "number") out.push({ t: rec.t, n: rec.n });
  }
  return out;
}

function measure(file: string): void {
  const trace = parseTrace(readFileSync(file, "utf8"));
  const h = trace.header;
  const detections = readDetections(file);

  console.log(`\n${"=".repeat(72)}`);
  console.log(`CLIP  ${file}`);
  console.log(
    `      label='${h.label}'  exercise=${h.exercise}  view=${h.view}  ` +
      `device=${h.device}  fps=${String(h.fps)}`,
  );

  // ── 1. Did the model see a pose at all? ─────────────────────────────────────
  console.log(`\n1. DID THE MODEL FIND A POSE?`);
  if (detections === null) {
    console.log(`   no .detect.jsonl sidecar — frames WITHOUT a pose were not`);
    console.log(`   recorded, so a detection rate cannot be computed for this clip.`);
    console.log(`   frames carrying a pose: ${String(trace.frames.length)}`);
  } else {
    const withPose = detections.filter((d) => d.n === 33).length;
    const empty = detections.filter((d) => d.n === 0).length;
    const odd = detections.length - withPose - empty;
    console.log(`   frames offered to the engine : ${String(detections.length)}`);
    console.log(
      `   ...with a full 33-point pose : ${String(withPose)} (${pct(withPose, detections.length)})`,
    );
    console.log(`   ...with nothing found        : ${String(empty)} (${pct(empty, detections.length)})`);
    if (odd > 0) console.log(`   ...with a PARTIAL pose       : ${String(odd)}  <- unexpected, look at it`);
  }

  if (trace.frames.length === 0) {
    console.log(`\n   No pose frames — nothing further to measure. That is a RESULT,`);
    console.log(`   not a failure, if this clip is of an empty room.`);
    return;
  }

  // ── 2. What confidence did it report? ───────────────────────────────────────
  const all: number[] = [];
  const perJoint = new Map<string, number[]>();
  for (const [name] of JOINTS) perJoint.set(name, []);
  for (const frame of trace.frames) {
    for (let i = 0; i < frame.kp.length; i++) {
      const v = frame.kp[i]?.[3];
      if (typeof v === "number") all.push(v);
    }
    for (const [name, idx] of JOINTS) {
      const v = frame.kp[idx]?.[3];
      if (typeof v === "number") perJoint.get(name)?.push(v);
    }
  }
  all.sort((a, b) => a - b);
  const exactlyOne = all.filter((v) => v === 1).length;

  console.log(`\n2. WHAT CONFIDENCE DID IT REPORT? (engine treats >= ${String(VIS_USABLE)} as usable)`);
  console.log(
    `   all points: min ${fmt(quantile(all, 0))}  p05 ${fmt(quantile(all, 0.05))}  ` +
      `median ${fmt(quantile(all, 0.5))}  p95 ${fmt(quantile(all, 0.95))}  max ${fmt(quantile(all, 1))}`,
  );
  console.log(
    `   below ${String(VIS_USABLE)}: ${String(all.filter((v) => v < VIS_USABLE).length)} of ` +
      `${String(all.length)} (${pct(all.filter((v) => v < VIS_USABLE).length, all.length)})`,
  );
  // A provider that reports NO confidence would read as a wall of exact 1.0s,
  // because the bridge substitutes 1.0 for a missing value (poseAdapter.js).
  // That would make the gate above inert, so it is measured rather than assumed.
  console.log(
    `   exactly 1.000: ${String(exactlyOne)} (${pct(exactlyOne, all.length)})` +
      (exactlyOne > 0 ? `  <- bridge substitutes 1.0 when the model reports none` : ""),
  );

  console.log(`\n   per joint:`);
  console.log(`     ${"joint".padEnd(12)} ${"median".padStart(7)}  ${"frames usable".padStart(16)}`);
  for (const [name] of JOINTS) {
    const vs = (perJoint.get(name) ?? []).slice().sort((a, b) => a - b);
    const usable = vs.filter((v) => v >= VIS_USABLE).length;
    console.log(
      `     ${name.padEnd(12)} ${fmt(quantile(vs, 0.5)).padStart(7)}  ` +
        `${`${String(usable)}/${String(vs.length)}`.padStart(9)} ${pct(usable, vs.length).padStart(6)}`,
    );
  }

  // ── 3. What does the REAL engine do with it? ────────────────────────────────
  // The decisive question: on a clip with no person in it, does this count reps?
  const config = compileDefinition(definitionFor(h.exercise), 1);
  const session = createSession(config);
  const result = replay(session, trace);

  const views = new Map<string, number>();
  const cues = new Map<string, number>();
  let metricUsable = 0;
  let visibilityOk = 0;
  for (const fr of result.frameResults) {
    views.set(fr.view, (views.get(fr.view) ?? 0) + 1);
    if (fr.liveCue != null) cues.set(fr.liveCue, (cues.get(fr.liveCue) ?? 0) + 1);
    if (fr.visibilityOk) visibilityOk++;
    const m = fr.signals[config.metric] ?? (config.metricFallback ? fr.signals[config.metricFallback] : undefined);
    if (typeof m === "number") metricUsable++;
  }
  const n = result.frameResults.length;

  console.log(`\n3. WHAT THE REAL ENGINE DID WITH IT (${h.exercise} definition, compiled)`);
  console.log(`   REPS COUNTED                 : ${String(result.repEvents.length)}`);
  console.log(`   frames it called a person    : ${String(visibilityOk)}/${String(n)} (${pct(visibilityOk, n)})`);
  console.log(
    `   frames with a usable knee    : ${String(metricUsable)}/${String(n)} (${pct(metricUsable, n)})`,
  );
  console.log(
    `   view                         : ` +
      [...views.entries()].map(([v, c]) => `${v}=${String(c)}`).join("  "),
  );
  if (cues.size === 0) {
    console.log(`   live cues (what it would SAY): none`);
  } else {
    console.log(`   live cues (what it would SAY):`);
    for (const [key, count] of [...cues.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`     ${key.padEnd(34)} ${String(count)} frames (${pct(count, n)})`);
    }
  }
  if (result.repEvents.length > 0) {
    console.log(`   per rep:`);
    for (const rep of result.repEvents) {
      console.log(
        `     #${String(rep.repIndex)} score ${String(rep.score)}  ${String(rep.durationMs)}ms  ` +
          `lowest knee ${fmt(rep.romExtreme ?? Number.NaN)}  faults [${rep.faults.join(", ")}]`,
      );
    }
  }
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: measure-pose.ts <clip.jsonl> [...]");
  process.exit(2);
}

let failed = false;
for (const file of files) {
  try {
    measure(file);
  } catch (err) {
    failed = true;
    console.error(`\nFAIL ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log("");
process.exit(failed ? 1 : 0);
