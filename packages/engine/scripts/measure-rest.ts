// Rest-in-full-view measurement (rest-billing card, 2026-08-15).
//   pnpm --filter @app/engine exec tsx scripts/measure-rest.ts <clip.jsonl | folder> [...]
//
// OPTIONS
//   --exercise <id>   definition id for clips whose header slug is a DISPLAY
//                     name (`squats`) rather than a definition id (`squat`).
//                     Same flag, same reason, as measure-pose.ts.
//   --cutoff <n>      ALSO report this absolute stillness cut-off. Repeatable.
//                     Nothing is chosen without it and nothing is chosen with
//                     it either — it exists so a candidate Kd names can be
//                     priced on the same clips as the derived ones.
//
// WHAT THIS IS FOR. A rest taken IN FULL VIEW is billed as squatting when the
// knees stay slightly bent (OWED, "a rest taken in full view is billed as
// squatting"). The rep clock arms on the first frame at or below `upAt` and is
// cleared only by a COMPLETED rep, so a rest at 159.3° keeps it running while a
// rest at 178.8° costs nothing — an invisible 160° line decides the bill.
//
// Separating "resting still" from "starting to descend" needs a stillness
// cut-off, and R0.2 forbids this file (or any chat) inventing one. DECISIONS
// 2026-07-07 already rules that a stillness threshold is definition-declared
// with NO engine default. So this script MEASURES the two sides on Kd's own
// recordings and prints them; he rules, exactly as he ruled the camera cut-off
// (DECISIONS :7037).
//
// THE DIRECTION IS THE OPPOSITE OF THE PERSON GATE, and that is the one thing
// to get right when reading this file. The gate's signals read HIGHER for
// furniture and block on `>`. Stillness reads LOWER the stiller you are, so a
// rest re-arm fires on `<=`. `cutoffAtPersonCost` and friends encode the other
// direction and are deliberately NOT reused here — quietly borrowing them
// would be the `>=`-vs-`>` defect (:6959 M9) in a new place.
//
// It prints distributions and prices candidates. It chooses nothing.
//
// Node shell — outside the engine's pure runtime boundary (same posture as
// measure-pose.ts / validate-trace.ts), so fs/console are fine here and banned
// in src/.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { exerciseDefinitionSchema, type ExerciseDefinition } from "@app/shared";
import { compileDefinition, createSession, lintDefinition, parseTrace, replay } from "../src/index.js";
import { distribution, quantile } from "../src/scene/discriminators.js";

const DEFS_DIR = join(import.meta.dirname, "../src/definitions");

/** Frame pairs further apart than this are not credited as continuous time.
 *  Same value and same reason as the measurement script's `--max-gap`: a long
 *  hole between two frames is not a stretch the camera watched. */
const MAX_GAP_MS = 500;

/** The cost levels the derived candidates are pinned at, expressed on the
 *  HARMFUL side. Read "0.01" as: the cut-off that would call 1% of the frames
 *  inside a genuine rep 'still'. The harmful side pins the number and the
 *  benefit is reported, never the other way round (:6532's operating-point
 *  convention, kept so two cards' tables can be read the same way). */
const COST_LEVELS = [0, 0.005, 0.01, 0.02, 0.05] as const;

function fmt(v: number): string {
  return Number.isFinite(v) ? v.toFixed(4) : "—";
}

function pct(n: number, of: number): string {
  return of === 0 ? "—" : `${((100 * n) / of).toFixed(1)}%`;
}

function ms(v: number): string {
  return `${(v / 1000).toFixed(1)}s`;
}

function availableDefinitions(): string[] {
  return readdirSync(DEFS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
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

function expandClips(paths: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) throw new Error(`no such file or folder: ${p}`);
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) {
        // The `.detect.jsonl` sidecars are not traces. A stray copy such as
        // `.detect (2).jsonl` correctly aborts the run (:7037's wrinkle) —
        // parseTrace will reject it rather than this filter hiding it.
        if (f.endsWith(".jsonl") && !f.endsWith(".detect.jsonl")) out.push(join(p, f));
      }
    } else {
      out.push(p);
    }
  }
  if (out.length === 0) throw new Error("no .jsonl clips found in the given paths");
  return out;
}

interface Options {
  readonly clips: readonly string[];
  readonly exercise: string | null;
  readonly cutoffs: readonly number[];
}

function parseArgs(argv: readonly string[]): Options {
  const paths: string[] = [];
  const cutoffs: number[] = [];
  let exercise: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--exercise") {
      const v = argv[++i];
      if (v === undefined) throw new Error("--exercise needs a definition id");
      exercise = v;
    } else if (a === "--cutoff") {
      const v = argv[++i];
      const n = Number(v);
      if (v === undefined || !Number.isFinite(n)) throw new Error("--cutoff needs a number");
      cutoffs.push(n);
    } else if (a !== undefined && a.startsWith("--")) {
      throw new Error(`unknown option ${a} (see the header for options)`);
    } else if (a !== undefined) {
      paths.push(a);
    }
  }
  return { clips: expandClips(paths), exercise, cutoffs };
}

/** One frame, reduced to the four facts this measurement turns on. */
interface Sample {
  readonly t: number;
  /** The rep metric the FSM itself received — undefined when unusable. */
  readonly knee: number | undefined;
  /** §3.4 #21 stillness. undefined when hips/shoulders were not all usable, or
   *  inside the tracker's first 700 ms window. NOT the same as "moving". */
  readonly still: number | undefined;
  /** The rep clock would be armed: metric at or below `upAt`. */
  readonly armed: boolean;
  /** This frame lies inside a rep the engine actually credited. */
  readonly inRep: boolean;
}

interface ClipMeasurement {
  readonly file: string;
  readonly label: string;
  readonly frames: number;
  readonly reps: number;
  readonly upAt: number;
  readonly samples: readonly Sample[];
  /** Armed-and-not-in-a-rep time, credited between consecutive such frames. */
  readonly idleMs: number;
  readonly longestIdleMs: number;
}

function measureClip(file: string, override: string | null): ClipMeasurement {
  const trace = parseTrace(readFileSync(file, "utf8"));
  const id = override ?? trace.header.exercise;
  if (!existsSync(join(DEFS_DIR, `${id}.json`))) {
    throw new Error(
      `no definition '${id}' for ${file}\navailable: ${availableDefinitions().join(", ")}\n` +
        `The trace header carries the workout's DISPLAY name, not the definition id.\n` +
        `Re-run with --exercise <id>, e.g. --exercise squat. ABORTING before any\n` +
        `clip is measured, so no page of output can hide a section that did not run.`,
    );
  }
  const definition = definitionFor(id);
  const base = compileDefinition(definition, 1);

  // The engine computes only the signals a definition DECLARES (I5), and no
  // shipped definition declares stillness yet — so ask for it here. This is a
  // measurement-only widening: nothing in src/ or in any .json changes.
  const config = {
    ...base,
    declaredSignals: [...base.declaredSignals, "stillness" as const],
  };

  const measured = replay(createSession(config), trace);

  // THE INSTRUMENT MUST NOT MOVE THE THING IT MEASURES. Computing an extra
  // signal should not change counting; asserting it costs one more replay and
  // removes the whole question. (:7404 pinned exactly this property for the
  // absence fix, by measurement rather than by argument.)
  const control = replay(createSession(base), trace);
  if (measured.repEvents.length !== control.repEvents.length) {
    throw new Error(
      `ABORT: declaring stillness changed the rep count on ${file} ` +
        `(${String(control.repEvents.length)} → ${String(measured.repEvents.length)}). ` +
        `The measurement is not measuring the shipped engine.`,
    );
  }

  // Rep windows, from public outputs only. RepEvent carries no timestamp, so
  // the crediting frame is found where repCount steps up, and the window is
  // that instant minus the rep's own durationMs — which IS descent-begin →
  // completion, i.e. exactly the stretch the clock was armed for.
  const windows: { start: number; end: number }[] = [];
  let prevCount = 0;
  let repIdx = 0;
  for (let i = 0; i < measured.frameResults.length; i++) {
    const fr = measured.frameResults[i];
    const frame = trace.frames[i];
    if (fr === undefined || frame === undefined) continue;
    if (fr.repCount > prevCount) {
      const ev = measured.repEvents[repIdx];
      if (ev !== undefined) windows.push({ start: frame.t - ev.durationMs, end: frame.t });
      repIdx++;
      prevCount = fr.repCount;
    }
  }

  const metric = base.metric;
  const fallback = base.metricFallback;
  const upAt = base.rep.upAt;
  const samples: Sample[] = [];
  for (let i = 0; i < measured.frameResults.length; i++) {
    const fr = measured.frameResults[i];
    const frame = trace.frames[i];
    if (fr === undefined || frame === undefined) continue;
    const raw = fr.signals[metric] ?? (fallback !== undefined ? fr.signals[fallback] : undefined);
    const knee = typeof raw === "number" ? raw : undefined;
    const stillRaw = fr.signals["stillness"];
    const still = typeof stillRaw === "number" ? stillRaw : undefined;
    const armed = knee !== undefined && knee <= upAt;
    const inRep = windows.some((w) => frame.t >= w.start && frame.t <= w.end);
    samples.push({ t: frame.t, knee, still, armed, inRep });
  }

  // Idle time: credited between two consecutive frames that are BOTH armed and
  // outside every counted rep — the same frame-to-frame accrual the session
  // uses for watched time, so the two numbers are comparable.
  let idleMs = 0;
  let longestIdleMs = 0;
  let runMs = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a === undefined || b === undefined) continue;
    const idle = a.armed && !a.inRep && b.armed && !b.inRep;
    const dt = b.t - a.t;
    if (idle && dt > 0 && dt <= MAX_GAP_MS) {
      idleMs += dt;
      runMs += dt;
      if (runMs > longestIdleMs) longestIdleMs = runMs;
    } else {
      runMs = 0;
    }
  }

  return {
    file,
    label: trace.header.label,
    frames: samples.length,
    reps: measured.repEvents.length,
    upAt,
    samples,
    idleMs,
    longestIdleMs,
  };
}

/** Time carried by the frames a cut-off would fire on, over one clip's idle
 *  stretch. Credited the same way `idleMs` is, so the two are the same units
 *  and one is always a share of the other. */
function idleMsBelow(samples: readonly Sample[], cutoff: number): number {
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a === undefined || b === undefined) continue;
    const qualifies = (s: Sample): boolean =>
      s.armed && !s.inRep && s.still !== undefined && s.still <= cutoff;
    const dt = b.t - a.t;
    if (qualifies(a) && qualifies(b) && dt > 0 && dt <= MAX_GAP_MS) total += dt;
  }
  return total;
}

function shareAtOrBelow(sorted: readonly number[], cutoff: number): number {
  if (sorted.length === 0) return Number.NaN;
  let n = 0;
  for (const v of sorted) {
    if (v <= cutoff) n++;
    else break;
  }
  return n / sorted.length;
}

function sortedStill(samples: readonly Sample[], pick: (s: Sample) => boolean): number[] {
  const out: number[] = [];
  for (const s of samples) {
    if (pick(s) && s.still !== undefined) out.push(s.still);
  }
  return out.sort((a, b) => a - b);
}

function printClip(m: ClipMeasurement): void {
  console.log("\n" + "=".repeat(74));
  console.log(`CLIP  ${m.file}`);
  console.log(`      label='${m.label}'  frames=${String(m.frames)}  reps counted=${String(m.reps)}`);

  const usable = m.samples.filter((s) => s.knee !== undefined).length;
  const armed = m.samples.filter((s) => s.armed).length;
  const armedInRep = m.samples.filter((s) => s.armed && s.inRep).length;
  const armedIdle = m.samples.filter((s) => s.armed && !s.inRep).length;

  console.log(`\n1. WHEN WOULD THE REP CLOCK BE RUNNING? (metric at or below upAt ${String(m.upAt)})`);
  console.log(`   frames with a usable knee        : ${String(usable)} (${pct(usable, m.frames)})`);
  console.log(`   clock armed                      : ${String(armed)} (${pct(armed, m.frames)})`);
  console.log(`     ...inside a counted rep        : ${String(armedInRep)}`);
  console.log(`     ...NOT inside any counted rep  : ${String(armedIdle)}   <- the wrongly-billed candidate`);
  console.log(`   armed-but-not-repping TIME       : ${ms(m.idleMs)}`);
  console.log(`   longest unbroken such stretch    : ${ms(m.longestIdleMs)}`);

  const kneesIdle = m.samples
    .filter((s) => s.armed && !s.inRep && s.knee !== undefined)
    .map((s) => s.knee ?? Number.NaN);
  if (kneesIdle.length > 0) {
    const d = distribution(kneesIdle);
    console.log(
      `   knee angle while armed-not-repping: p05 ${d.p05.toFixed(1)}  median ${d.median.toFixed(1)}  p95 ${d.p95.toFixed(1)}`,
    );
  }

  const inRep = sortedStill(m.samples, (s) => s.armed && s.inRep);
  const idle = sortedStill(m.samples, (s) => s.armed && !s.inRep);
  console.log(`\n2. HOW STILL WAS HE? (stillness — LOWER means stiller)`);
  console.log(`     pile                    n      p05      p25   median      p75      p95`);
  for (const [name, pile] of [
    ["inside a rep", inRep],
    ["armed, not repping", idle],
  ] as const) {
    if (pile.length === 0) {
      console.log(`     ${name.padEnd(18)}      0        —        —        —        —        —`);
      continue;
    }
    const d = distribution(pile);
    console.log(
      `     ${name.padEnd(18)} ${String(d.count).padStart(6)} ` +
        `${fmt(d.p05).padStart(8)} ${fmt(d.p25).padStart(8)} ${fmt(d.median).padStart(8)} ` +
        `${fmt(d.p75).padStart(8)} ${fmt(d.p95).padStart(8)}`,
    );
  }
  if (inRep.length === 0) {
    console.log(`     (no counted reps here, so this clip prices no HARM side)`);
  }
  if (idle.length === 0) {
    console.log(`     (nothing armed outside a rep — this clip contains none of the defect)`);
  }
}

function printCandidates(all: readonly ClipMeasurement[], extra: readonly number[]): void {
  const inRepAll = all.flatMap((m) => sortedStill(m.samples, (s) => s.armed && s.inRep)).sort((a, b) => a - b);
  const idleAll = all.flatMap((m) => sortedStill(m.samples, (s) => s.armed && !s.inRep)).sort((a, b) => a - b);
  const idleMsAll = all.reduce((n, m) => n + m.idleMs, 0);

  console.log("\n" + "=".repeat(74));
  console.log("3. WHAT WOULD A CUT-OFF COST, ACROSS EVERY CLIP?");
  console.log(`   frames inside a real rep      : ${String(inRepAll.length)}`);
  console.log(`   frames armed but not repping  : ${String(idleAll.length)}  (${ms(idleMsAll)})`);

  if (inRepAll.length === 0 || idleAll.length === 0) {
    console.log("\n   NOT PRICED. Both piles must be non-empty: without real-rep frames");
    console.log("   there is no harm side, and without armed-not-repping frames these");
    console.log("   clips do not contain the thing being fixed. What that means for the");
    console.log("   card is a finding, not a failure — say so rather than printing a table.");
    return;
  }

  console.log("\n   Derived candidates — each pinned by the HARMFUL side first.");
  console.log("   'fires on' = share of real-rep frames it would wrongly call still.");
  console.log("\n     pinned at   cut-off   fires on real reps   rest frames caught   rest time removed");
  const rows: { cutoff: number; label: string }[] = COST_LEVELS.map((c) => ({
    cutoff: c === 0 ? (inRepAll[0] ?? Number.NaN) / 2 : quantile(inRepAll, c),
    label: c === 0 ? "below all" : `${(c * 100).toFixed(1)}%`,
  }));
  for (const c of extra) rows.push({ cutoff: c, label: "yours" });

  for (const row of rows) {
    if (!Number.isFinite(row.cutoff)) continue;
    const harm = shareAtOrBelow(inRepAll, row.cutoff);
    const caught = shareAtOrBelow(idleAll, row.cutoff);
    const removed = all.reduce((n, m) => n + idleMsBelow(m.samples, row.cutoff), 0);
    console.log(
      `     ${row.label.padEnd(11)} ${fmt(row.cutoff).padStart(7)}   ` +
        `${(harm * 100).toFixed(2).padStart(17)}%   ` +
        `${(caught * 100).toFixed(1).padStart(17)}%   ` +
        `${ms(removed).padStart(15)} of ${ms(idleMsAll)}`,
    );
  }

  console.log("\n   READ THIS BEFORE QUOTING ANY ROW. These are frame counts and clip");
  console.log("   time, NOT what a user is billed — a real fix re-arms the clock, and");
  console.log("   what that saves depends on where the rest sits inside the set. The");
  console.log("   separation between two piles is also not the outcome (:7037): a");
  console.log("   number that looks clean here still has to be replayed for reps kept.");
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`reading ${String(opts.clips.length)} clip(s)`);
  const all: ClipMeasurement[] = [];
  for (const file of opts.clips) {
    const m = measureClip(file, opts.exercise);
    all.push(m);
    printClip(m);
  }
  printCandidates(all, opts.cutoffs);
}

main();
