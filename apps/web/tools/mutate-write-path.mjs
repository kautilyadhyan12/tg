// Mutation harness for the hand-logged write path.
//
// Every lesson this repo has recorded about mutation harnesses is applied here:
//   · absolute paths only (a `cd` once broke a restore and left a mutant live)
//   · the restore is verified by byte comparison, not assumed
//   · a GREEN BASELINE is required first, or "RED" cannot distinguish a caught
//     mutant from a suite that never ran
//   · the mutation is verified to have actually CHANGED the file
//   · RED is only accepted when it is an assertion failure, not a crash/parse
//     error — a suite that dies is not a suite that caught anything
//
// Run it:  node apps/web/tools/mutate-write-path.mjs
//
// It lives in the repo rather than in a scratch directory on purpose: a claim
// of "8 mutations, 8 RED" that nobody else can reproduce is a claim, and this
// project has a recorded finding about exactly that (the PostWorkout summary
// card, whose harness was added for the same reason).
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// …/apps/web/tools → the repo root. Derived, never hardcoded: an absolute path
// baked into this file is what broke a previous harness's restore step.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// Two target files, because the first version of this harness only mutated the
// page and therefore only ever proved the page's tests could fail. A round-2
// reviewer wrote its own 20 mutants across three files and found ten alive —
// the gap was in what this harness declined to aim at, not in what it reported.
const PAGE = `${REPO}/apps/web/src/pages/ActiveWorkout.jsx`;
const ENGINE = `${REPO}/apps/web/src/pages/activeWorkoutEngine.js`;
const ORIGINALS = new Map([
  [PAGE, readFileSync(PAGE, "utf8")],
  [ENGINE, readFileSync(ENGINE, "utf8")],
]);

// The working tree is CRLF (autocrlf). The first run of this harness wrote its
// anchors with \n, matched nothing, and reported six "NOT APPLIED" rows — which
// is the harness telling the truth instead of printing a table of REDs it had
// not earned. Anchors are now line-ending agnostic.
const eol = (s) => s.replace(/\r?\n/g, "\r\n");

// Both suites, so an engine-file mutant is judged by the tests that cover it.
const TESTS =
  "src/pages/activeWorkout.render.test.jsx src/pages/activeWorkoutEngine.test.js";

const MUTANTS = [
  {
    name: "M1 rep ref not updated on a manual rep (the recorded 0-rep trap)",
    from: "    setRepsRef.current = n;\n",
    to: "",
  },
  {
    name: "M2 rep ref mirrored in an EFFECT instead (the one-rep-short trap)",
    from: "    setRepsRef.current = n;\n    playRepBeep();",
    to: "    useEffectLikeLag(() => { setRepsRef.current = n; });\n    playRepBeep();",
    prelude: "const useEffectLikeLag = (fn) => setTimeout(fn, 0);\n",
  },
  {
    name: "M3 set ordinal not advanced between sets",
    from: "      engineSetKeyRef.current += 1;\n      setSetReps(0);",
    to: "      setSetReps(0);",
  },
  {
    name: "M4 capture removed from the set-end funnel",
    from: "    captureLogOnlySet();\n\n    const duration = restDuration;",
    to: "    const duration = restDuration;",
  },
  {
    name: "M5 set clock never restarts (duration measures the wrong set)",
    from: "  const startSetClock = () => { setStartedAtMsRef.current = Date.now(); };",
    to: "  const startSetClock = () => {};",
  },
  {
    name: "M6 unresolved exercise not reported to the sync client",
    from: "      unresolved: setSummariesRef.current.unresolved,\n",
    to: "",
  },
  // The two the T3 reviewer deleted and watched the whole suite stay green.
  {
    name: "M7 Skip Exercise no longer captures the part-set (T3 F1)",
    from: "    captureLogOnlySet();\n    const idxNow = currentIndexRef.current;",
    to: "    const idxNow = currentIndexRef.current;",
  },
  {
    name: "M8 engine gate removed — page files a set the engine owns (T3 F2)",
    from: "      if (analysisAvailableRef.current) return; // the engine files this one itself\n",
    to: "",
  },
  // Round 2 (F-4) wrote its own mutants and found ten alive. These are the ones
  // whose survival meant a WRONG ROW could be written; each now has a test.
  {
    name: "M9 set clock not restarted on a redo (T3 r2 N4)",
    from: "    startSetClock();\n    if (analysisAvailable) {",
    to: "    if (analysisAvailable) {",
  },
  {
    name: "M10 set clock not restarted on the next exercise (T3 r2 N5)",
    from: "    setRepsRef.current = 0;\n    startSetClock();\n    lastRepCountRef.current = 0;\n    setPhase('workout');\n    if (voiceOn) speakExercise",
    to: "    setRepsRef.current = 0;\n    lastRepCountRef.current = 0;\n    setPhase('workout');\n    if (voiceOn) speakExercise",
  },
  {
    name: "M11 rep count not reset between sets — set 2 inherits set 1 (T3 r2 N8)",
    from: "      setSetReps(0);\n      setRepsRef.current = 0;\n      startSetClock();",
    to: "      setSetReps(0);\n      startSetClock();",
  },
  {
    name: "M12 reps clamp removed — an out-of-range count parks the workout (T3 r2 N17)",
    file: ENGINE,
    from: "  const countedReps = Math.max(0, Math.min(REPS_MAX, Math.round(Number(reps) || 0)));",
    to: "  const countedReps = Math.round(Number(reps) || 0);",
  },
  {
    name: "M13 name checked before reps — an empty set vetoes the workout (T3 r2 N15)",
    file: ENGINE,
    from: "  const countedReps = Math.max(0, Math.min(REPS_MAX, Math.round(Number(reps) || 0)));\n  if (countedReps === 0) return { kind: \"empty\" };\n\n  const slug = typeof exerciseName === \"string\" ? slugForLegacyName(exerciseName) : null;\n  if (slug == null) return { kind: \"unresolved-exercise\", exerciseName };",
    to: "  const slug = typeof exerciseName === \"string\" ? slugForLegacyName(exerciseName) : null;\n  if (slug == null) return { kind: \"unresolved-exercise\", exerciseName };\n\n  const countedReps = Math.max(0, Math.min(REPS_MAX, Math.round(Number(reps) || 0)));\n  if (countedReps === 0) return { kind: \"empty\" };",
  },
];

function run() {
  try {
    const out = execSync(
      `corepack pnpm exec vitest run ${TESTS} --reporter=basic 2>&1`,
      { cwd: `${REPO}/apps/web`, encoding: "utf8", stdio: "pipe" },
    );
    return { green: true, out };
  } catch (e) {
    return { green: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const baseline = run();
if (!baseline.green) {
  console.log("BASELINE IS NOT GREEN — every result below would be meaningless.");
  console.log(baseline.out.slice(-3000));
  process.exit(1);
}
console.log("GREEN BASELINE:", /Tests\s+(.*)/.exec(baseline.out)?.[1]?.trim());

const rows = [];
for (const m of MUTANTS) {
  const target = m.file ?? PAGE;
  const orig = ORIGINALS.get(target);
  const from = eol(m.from);
  const to = eol(m.to);
  if (!orig.includes(from)) {
    rows.push([m.name, "NOT APPLIED — anchor text not found (harness bug)"]);
    continue;
  }
  let mutated = orig.replace(from, to);
  if (m.prelude) mutated = eol(m.prelude) + mutated;
  if (mutated === orig) {
    rows.push([m.name, "NOT APPLIED — file unchanged (harness bug)"]);
    continue;
  }
  writeFileSync(target, mutated);

  const res = run();
  // A RED must be a FAILING ASSERTION, not a file that no longer parses.
  const assertionFailure = /Tests\s+\d+ failed/.test(res.out) || /AssertionError|expected /.test(res.out);
  rows.push([
    m.name,
    res.green ? "*** ALIVE — the tests do not see this ***"
      : assertionFailure ? "RED (assertion)" : "RED but NOT an assertion — check",
  ]);

  writeFileSync(target, orig);
  if (readFileSync(target, "utf8") !== orig) {
    console.log("RESTORE FAILED — STOPPING WITH A MUTANT LIVE:", m.name, target);
    process.exit(1);
  }
}

console.log("\n| mutation | result |\n|---|---|");
for (const [n, r] of rows) console.log(`| ${n} | ${r} |`);

const finalOk = [...ORIGINALS].every(([f, o]) => readFileSync(f, "utf8") === o);
console.log(`\nall targets restored byte-for-byte: ${finalOk}`);
const after = run();
console.log("post-run baseline re-check:", after.green ? "GREEN" : "NOT GREEN");
