// Pose-input measurement (camera-accuracy card, 2026-08-08).
//   pnpm --filter @app/engine exec tsx scripts/measure-pose.ts <clip.jsonl> [...]
//
// OPTIONS
//   --exercise <id>     definition id for clips whose header slug is a DISPLAY
//                       name (`squats`) rather than a definition id (`squat`).
//                       Every clip recorded before that recorder bug was fixed
//                       needs this; the run ABORTS and says so if it is missing.
//   --person <labels>   comma-separated clip labels that DO contain a person
//   --nobody <labels>   comma-separated clip labels that do NOT
//                       Supply both and section 5 prints the separation between
//                       the two piles. Supply neither and it prints nothing —
//                       the classification is the operator's, never guessed
//                       from a label that happens to start with "me_".
//   --window <n>        frames in the rolling median (default 15, ~1s @15fps)
//   --max-gap <ms>      frame pairs further apart than this are skipped (500)
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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { exerciseDefinitionSchema, type ExerciseDefinition } from "@app/shared";
import { compileDefinition, createSession, lintDefinition, parseTrace, replay } from "../src/index.js";
import {
  cutoffAtCatchRate,
  cutoffAtPersonCost,
  distribution,
  MAX_GAP_MS,
  quantile,
  readClip,
  separation,
  SIGNAL_NAMES,
  type ClipReadings,
  type OperatingPoint,
} from "./discriminators.js";

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

function fmt(v: number): string {
  return Number.isFinite(v) ? v.toFixed(3) : "—";
}

function pct(n: number, of: number): string {
  return of === 0 ? "—" : `${((100 * n) / of).toFixed(1)}%`;
}

function availableDefinitions(): string[] {
  return readdirSync(DEFS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

/**
 * THE CLASS FIX (OWED, "the measuring instrument silently skipped its own main
 * section"). On 2026-08-08 this threw ENOENT — the recorder stamps the workout's
 * DISPLAY name (`squats`) while definitions are keyed singular (`squat.json`) —
 * and the caller's catch printed a one-line FAIL *underneath* sections 1 and 2,
 * which had already rendered normally. **Section 3, the engine replay, did not
 * run on any of the five clips and the output read as a partial success.** That
 * was the SECOND time this instrument degraded quietly rather than failing
 * loudly.
 *
 * So: `resolveDefinitions` runs over EVERY clip BEFORE a single line of
 * per-clip output is printed, and one unresolvable definition aborts the whole
 * run with the mismatch named and the fix spelled out. There is no longer a
 * path on which some sections print and one silently does not.
 *
 * The recorder half — stamping the definition id instead of the display name —
 * is the next card. Until it lands, clips already on disk carry `squats` and
 * need `--exercise squat`. That flag is a documented way PAST a named
 * mismatch, never a silent guess: it deliberately does not try to singularise
 * a plural, for the same reason `slugForLegacyName` is exact-match and returns
 * null rather than guessing (DECISIONS :3538).
 */
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

/** Resolve the definition every clip will need, before any clip is reported.
 *  Throws with the whole picture — which clips, which slug, what to run
 *  instead — rather than failing per-clip halfway down a page of output. */
function resolveDefinitions(
  clips: readonly { file: string; exercise: string }[],
  override: string | null,
): Map<string, ExerciseDefinition> {
  const wanted = new Map<string, string[]>();
  for (const c of clips) {
    const id = override ?? c.exercise;
    const files = wanted.get(id) ?? [];
    files.push(c.file);
    wanted.set(id, files);
  }
  const resolved = new Map<string, ExerciseDefinition>();
  const missing: string[] = [];
  for (const [id, files] of wanted) {
    if (!existsSync(join(DEFS_DIR, `${id}.json`))) {
      missing.push(`  '${id}' — wanted by ${files.length === 1 ? files[0] ?? "" : `${String(files.length)} clips`}`);
      continue;
    }
    resolved.set(id, definitionFor(id));
  }
  if (missing.length > 0) {
    throw new Error(
      `no definition file for:\n${missing.join("\n")}\n` +
        `available: ${availableDefinitions().join(", ")}\n\n` +
        `The trace header carries the workout's DISPLAY name, not the definition id\n` +
        `(the recorder bug on OWED). Re-run with --exercise <id>, e.g. --exercise squat.\n` +
        `ABORTING before any clip is measured: a run that skipped the engine replay\n` +
        `while printing everything else is what this check exists to prevent.`,
    );
  }
  return resolved;
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

interface Options {
  readonly exercise: string | null;
  readonly person: ReadonlySet<string>;
  readonly nobody: ReadonlySet<string>;
  readonly window: number;
  readonly maxGapMs: number;
}

/** What one clip contributes to the cross-clip comparison in section 5. */
interface ClipResult {
  readonly label: string;
  readonly readings: ClipReadings;
}

function measure(
  file: string,
  definition: ExerciseDefinition,
  opts: Options,
): ClipResult | null {
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
    return null;
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
  const config = compileDefinition(definition, 1);
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
          `lowest knee ${fmt(rep.romExtreme)}  faults [${rep.faults.join(", ")}]`,
      );
    }
  }

  // ── 4. Does it MOVE like a body? ────────────────────────────────────────────
  // The lever :6386 identified, made reproducible. Every number is what a
  // rolling window would have read at some frame of this clip, so these are the
  // distributions a GATE would see — not clip-level averages, which say nothing
  // about how often a gate would be wrong.
  const readings = readClip(trace.frames, opts.window, opts.maxGapMs);
  console.log(
    `\n4. DOES IT MOVE LIKE A BODY? (rolling median of ${String(opts.window)} frames; ` +
      `rates per second, normalised by torso length)`,
  );
  if (readings.gapsSkipped > 0) {
    console.log(
      `   ${String(readings.gapsSkipped)} frame pairs skipped for a gap > ${String(opts.maxGapMs)}ms ` +
        `(the model had lost the pose; measuring across it would measure the gap)`,
    );
  }
  console.log(`   HIGHER = more like furniture, for every row.`);
  console.log(
    `     ${"signal".padEnd(20)} ${"n".padStart(5)} ${"p05".padStart(8)} ${"p25".padStart(8)} ` +
      `${"median".padStart(8)} ${"p75".padStart(8)} ${"p95".padStart(8)}`,
  );
  for (const name of SIGNAL_NAMES) {
    const d = distribution(readings.windows[name]);
    console.log(
      `     ${name.padEnd(20)} ${String(d.count).padStart(5)} ${fmt(d.p05).padStart(8)} ` +
        `${fmt(d.p25).padStart(8)} ${fmt(d.median).padStart(8)} ${fmt(d.p75).padStart(8)} ` +
        fmt(d.p95).padStart(8),
    );
  }

  return { label: h.label, readings };
}

// ── 5. The cross-clip comparison — the only section that answers the card ─────

function describe(point: OperatingPoint | null): string {
  if (point === null) return "not computable";
  return (
    `cut-off ${fmt(point.cutoff)} → catches ${pct(point.nobodyCaught, 1)} of furniture, ` +
    `wrongly rejects ${pct(point.personRejected, 1)} of real frames`
  );
}

function compare(results: readonly ClipResult[], opts: Options): void {
  const person: ClipResult[] = [];
  const nobody: ClipResult[] = [];
  for (const r of results) {
    if (opts.person.has(r.label)) person.push(r);
    else if (opts.nobody.has(r.label)) nobody.push(r);
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log(`5. CAN ANY SIGNAL TELL THE TWO PILES APART?`);
  if (person.length === 0 || nobody.length === 0) {
    console.log(
      `\n   Not computed. Section 5 needs BOTH --person and --nobody, naming clip\n` +
        `   labels present in this run. Labels seen: ${results.map((r) => r.label).join(", ") || "(none)"}\n` +
        `   The classification is the operator's. Guessing it from a label that\n` +
        `   happens to start with "me_" would be this script deciding the answer.`,
    );
    return;
  }

  console.log(`   person clips : ${person.map((r) => r.label).join(", ")}`);
  console.log(`   nobody clips : ${nobody.map((r) => r.label).join(", ")}`);
  console.log(
    `\n   'separation' = chance a random furniture reading scores above a random\n` +
      `   person reading. 1.00 = the two never overlap · 0.50 = the signal is\n` +
      `   worthless. Anything near 0.50 is not worth a threshold conversation.`,
  );

  for (const name of SIGNAL_NAMES) {
    const p = person.flatMap((r) => r.readings.windows[name]);
    const n = nobody.flatMap((r) => r.readings.windows[name]);
    const auc = separation(p, n);
    console.log(`\n   ${name}`);
    console.log(`     separation                 : ${fmt(auc)}`);
    // Pinned by the HARMFUL side first. A gate that wrongly rejects a real user
    // stops them counting reps in their own workout; one that wrongly accepts a
    // chair leaves today's behaviour exactly as it already is. Those costs are
    // not symmetric, so the person cost is the constraint and the furniture
    // catch is the reported benefit — never the other way round.
    console.log(`     at most 1% of users hurt   : ${describe(cutoffAtPersonCost(p, n, 0.01))}`);
    console.log(`     at most 5% of users hurt   : ${describe(cutoffAtPersonCost(p, n, 0.05))}`);
    console.log(`     to catch 95% of furniture  : ${describe(cutoffAtCatchRate(p, n, 0.95))}`);
  }

  console.log(
    `\n   NO CUT-OFF IS CHOSEN HERE, and none may be chosen from this table alone:\n` +
      `   it is one room and one chair (OWED, "no threshold may be picked from\n` +
      `   judgement"). What it can settle is whether a signal is worth recording\n` +
      `   more furniture for.`,
  );
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv: readonly string[]): { files: string[]; opts: Options } {
  const files: string[] = [];
  let exercise: string | null = null;
  let person = new Set<string>();
  let nobody = new Set<string>();
  let window = 15;
  let maxGapMs: number = MAX_GAP_MS;

  const labels = (v: string): Set<string> =>
    new Set(
      v
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== ""),
    );
  const number = (flag: string, v: string | undefined): number => {
    const parsed = Number(v);
    if (v === undefined || !Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`${flag} needs a positive number, got '${v ?? ""}'`);
    }
    return parsed;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    switch (arg) {
      case "--exercise":
        exercise = argv[++i] ?? null;
        if (exercise === null) throw new Error("--exercise needs a definition id");
        break;
      case "--person":
        person = labels(argv[++i] ?? "");
        break;
      case "--nobody":
        nobody = labels(argv[++i] ?? "");
        break;
      case "--window":
        window = Math.round(number("--window", argv[++i]));
        break;
      case "--max-gap":
        maxGapMs = number("--max-gap", argv[++i]);
        break;
      default:
        if (arg.startsWith("--")) throw new Error(`unknown option '${arg}'`);
        files.push(arg);
    }
  }
  return { files, opts: { exercise, person, nobody, window, maxGapMs } };
}

/**
 * Expand a FOLDER into the clips inside it, and drop `.detect.jsonl` sidecars.
 *
 * Both exist for the operator, not for us. PowerShell does not expand `*.jsonl`
 * before handing it over, so a glob is not something Kd can type; and a glob
 * that DID expand would sweep in every sidecar, which has no header and would
 * abort the run. One folder path works in every shell and needs nothing
 * explained. (:5034 — a smoke doc's SETUP is part of its claim; an instruction
 * with no working command behind it is a defect in the instruction.)
 */
function expand(paths: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    if (existsSync(p) && statSync(p).isDirectory()) {
      for (const name of readdirSync(p).sort()) {
        if (name.endsWith(".jsonl") && !name.endsWith(".detect.jsonl")) out.push(join(p, name));
      }
      continue;
    }
    if (p.endsWith(".detect.jsonl")) continue;
    out.push(p);
  }
  return out;
}

function main(): number {
  let files: string[];
  let opts: Options;
  try {
    const parsed = parseArgs(process.argv.slice(2));
    files = expand(parsed.files);
    opts = parsed.opts;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  if (files.length === 0) {
    console.error(
      "usage: measure-pose.ts [options] <clip.jsonl | folder> [...]  (see header for options)",
    );
    return 2;
  }
  console.log(`reading ${String(files.length)} clip(s)`);

  // EVERY header is read and EVERY definition resolved before one line of
  // per-clip output. See resolveDefinitions: this is the fix for a run that
  // printed two sections per clip while its main section had not run at all.
  let definitions: Map<string, ExerciseDefinition>;
  const headers: { file: string; exercise: string }[] = [];
  try {
    for (const file of files) {
      headers.push({ file, exercise: parseTrace(readFileSync(file, "utf8")).header.exercise });
    }
    definitions = resolveDefinitions(headers, opts.exercise);
  } catch (err) {
    console.error(`\nABORTED: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const results: ClipResult[] = [];
  let failed = false;
  for (const { file, exercise } of headers) {
    const definition = definitions.get(opts.exercise ?? exercise);
    if (definition === undefined) {
      // Unreachable: resolveDefinitions threw above if any were missing. Loud
      // rather than a `!` — a silent skip here is the defect this file is fixing.
      console.error(`\nFAIL ${file}: definition vanished between resolve and use`);
      failed = true;
      continue;
    }
    try {
      const result = measure(file, definition, opts);
      if (result !== null) results.push(result);
    } catch (err) {
      failed = true;
      console.error(`\nFAIL ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  compare(results, opts);
  return failed ? 1 : 0;
}

const exitCode = main();
console.log("");
process.exit(exitCode);
