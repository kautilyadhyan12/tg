// TEST AUDIT for the duration/kcal-v2 card (Kd's review/fix rule 4, DECISIONS
// :5348, SCOPED BY SEVERITY per :5857): every number here is one a USER SEES —
// stored workout duration and the calorie figure — so every mutant sits in the
// always-mutated rows of the 4a table. DB mutants are the two that change
// SERVER behaviour (the duration store branch, the formula selection); the
// rest run in seconds against unit/web suites.
//
// Usage:
//   node tools/mutate-duration-kcal.mjs            # every mutant
//   node tools/mutate-duration-kcal.mjs M1 M2      # only these
//   node tools/mutate-duration-kcal.mjs --list
//
// DATABASE_URL must be set for the api DB suite; mutants that need it are
// skipped (and REPORTED AS SKIPPED, never as passes) when it is absent — and a
// run that skipped any exits non-zero unless --allow-skipped says so out loud
// (:5748 Low-3).
//
// Safeguards 1–5 are copied VERBATIM in spirit from mutate-workout-summary.mjs,
// each of which exists because this project was burned by its absence — see
// that file's header for the incident record (:5199, :4267, :2614, :4855).
//
// NOT MUTATED, and why:
// - The `s.reps > 0 && s.tempoMsAvg !== null` guard's REMOVAL is arithmetically
//   EQUIVALENT (`0 × t` and `r × null→0` both make repMs 0) — an unkillable
//   mutant is a claimed distinction the code does not have (the M6 lesson,
//   :5618), so it is not in the table.
// - The ActiveWorkout → queueWorkoutSync wiring (the page passing the two
//   fields) is page-level code with no node coverage by standing precedent
//   (the F5-accepted gap) — the SMOKE asserts it by reading the payload in
//   devtools. Recorded here so nobody mistakes its absence for coverage.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/** The ONLY files any mutation may touch. */
const TARGETS = [
  "apps/api/src/modules/workouts/calories.ts",
  "apps/api/src/modules/workouts/service.ts",
  "apps/api/src/modules/workouts/repo.ts",
  "apps/web/src/sync/syncClient.js",
  "apps/web/src/pages/activeWorkoutEngine.js",
];

/** Suites, by the runner that owns them. `db: true` needs DATABASE_URL. */
const SUITES = {
  apiUnit: { pkg: "api", files: ["test/gamification.unit.test.ts"], db: false },
  apiDb: { pkg: "api", files: ["test/workouts.sync.test.ts"], db: true },
  apiSummaryDb: { pkg: "api", files: ["test/workouts.summary.test.ts"], db: true },
  webSync: { pkg: "web", files: ["src/sync/syncClient.test.js"], db: false },
  webEngine: { pkg: "web", files: ["src/pages/activeWorkoutEngine.test.js"], db: false },
};

const MUTATIONS = [
  {
    id: "M1",
    claim: "idle and rest time are billed at REST_MET 1.8, not silently dropped",
    file: "apps/api/src/modules/workouts/calories.ts",
    from: "export const REST_MET = 1.8;",
    to: "export const REST_MET = 0;",
    suites: ["apiUnit"],
  },
  {
    id: "M2",
    claim: "rep time is CAPPED at the set span — never billed beyond what the set lasted",
    file: "apps/api/src/modules/workouts/calories.ts",
    from: "      s.reps > 0 && s.tempoMsAvg !== null ? Math.min(s.durationMs, s.reps * s.tempoMsAvg) : 0;",
    to: "      s.reps > 0 && s.tempoMsAvg !== null ? s.reps * s.tempoMsAvg : 0;",
    suites: ["apiUnit"],
  },
  {
    id: "M3",
    claim: "the timer cap keeps PAUSED time out of the idle bill",
    file: "apps/api/src/modules/workouts/calories.ts",
    from: "      : Math.max(0, session.durationSeconds * 1000 - chargedMetMs);",
    to: "      : Number.POSITIVE_INFINITY;",
    suites: ["apiUnit"],
  },
  {
    id: "M4",
    claim: "a log-only set keeps the v1 treatment (span at MET), never the idle rate",
    file: "apps/api/src/modules/workouts/calories.ts",
    from: "    if (s.logOnly) {",
    to: "    if (false && s.logOnly) {",
    suites: ["apiUnit"],
  },
  {
    id: "M5",
    claim: "restSeconds' PRESENCE selects the v2 formula + stamp; absence keeps v1 byte-for-byte",
    file: "apps/api/src/modules/workouts/service.ts",
    from: "    payload.restSeconds === undefined",
    to: "    true",
    suites: ["apiDb"],
  },
  {
    id: "M6",
    claim: "the client's timer IS the stored duration when sent (not Σ set spans)",
    file: "apps/api/src/modules/workouts/repo.ts",
    from: "    payload.durationSeconds !== undefined",
    to: "    false",
    suites: ["apiDb"],
  },
  {
    id: "M7",
    claim: "the web payload actually carries the timer when the page supplies it",
    file: "apps/web/src/sync/syncClient.js",
    from: "  if (Number.isInteger(durationSeconds) && durationSeconds > 0) {",
    to: "  if (false) {",
    suites: ["webSync"],
  },
  {
    id: "M8",
    claim: "the web payload actually carries restSeconds when the page supplies it",
    file: "apps/web/src/sync/syncClient.js",
    from: "  if (Number.isInteger(restSeconds) && restSeconds >= 0) {",
    to: "  if (false) {",
    suites: ["webSync"],
  },
  {
    id: "M9",
    claim: "restSeconds ZERO is a real value that travels — >= 0, not > 0",
    file: "apps/web/src/sync/syncClient.js",
    from: "  if (Number.isInteger(restSeconds) && restSeconds >= 0) {",
    to: "  if (Number.isInteger(restSeconds) && restSeconds > 0) {",
    suites: ["webSync"],
  },
  // ── Kd's smoke, 2026-08-07: the two fixes for the defects it found ────────
  {
    id: "M10",
    claim: "PAUSED time is subtracted from a set's recorded duration",
    file: "apps/web/src/pages/activeWorkoutEngine.js",
    from: "  return Math.max(0, nowMs - startedAtMs - closed - open);",
    to: "  return Math.max(0, nowMs - startedAtMs);",
    suites: ["webEngine"],
  },
  {
    id: "M11",
    claim: "an OPEN pause (set ended while paused) is subtracted too, not only a closed one",
    file: "apps/web/src/pages/activeWorkoutEngine.js",
    from: "  return Math.max(0, nowMs - startedAtMs - closed - open);",
    to: "  return Math.max(0, nowMs - startedAtMs - closed);",
    suites: ["webEngine"],
  },
  {
    id: "M12",
    claim: "active time is CLAMPED to the session — a part can never print larger than its whole",
    file: "apps/api/src/modules/workouts/service.ts",
    from: "      ? Math.min(measuredActiveSeconds, durationSeconds)",
    to: "      ? measuredActiveSeconds",
    suites: ["apiSummaryDb"],
  },
];

// ── plumbing (mutate-workout-summary.mjs's, unchanged in substance) ─────────

const argv = process.argv.slice(2);
if (argv.includes("--list")) {
  for (const m of MUTATIONS) console.log(`${m.id}  ${m.claim}`);
  process.exit(0);
}
const only = argv.filter((a) => !a.startsWith("--"));
const selected = only.length > 0 ? MUTATIONS.filter((m) => only.includes(m.id)) : MUTATIONS;

if (only.length > 0 && selected.length !== only.length) {
  const known = new Set(MUTATIONS.map((m) => m.id));
  const bad = only.filter((a) => !known.has(a));
  console.error(`FATAL: unknown mutation id(s): ${bad.join(", ")}`);
  process.exit(2);
}
if (selected.length === 0) {
  console.error("FATAL: nothing selected — a sweep over nothing is not a pass.");
  process.exit(2);
}

// Safeguard 1: every mutation must name a file inside TARGETS (whole table).
for (const m of MUTATIONS) {
  if (!TARGETS.includes(m.file)) {
    console.error(`FATAL: ${m.id} names ${m.file}, which is not in TARGETS.`);
    console.error("A mutation outside the snapshot list cannot be restored. Aborting.");
    process.exit(2);
  }
}

// Safeguard 2, HOISTED: every anchor checked up front, for the whole table.
{
  const stale = [];
  for (const m of MUTATIONS) {
    const text = readFileSync(resolve(ROOT, m.file), "utf8");
    const hits = text.split(m.from).length - 1;
    if (hits !== 1) stale.push(`${m.id}  (${hits} matches in ${m.file})`);
  }
  if (stale.length > 0) {
    console.error("FATAL: stale anchors — a drifted anchor reports as a missing test.\n");
    for (const s of stale) console.error(`  ${s}`);
    console.error("\nRe-anchor them against the current source. Do not delete the mutant.");
    process.exit(2);
  }
}

const hasDb = typeof process.env["DATABASE_URL"] === "string" && process.env["DATABASE_URL"] !== "";

/** Snapshot every target as BYTES (CRLF tree — :4267). */
const snapshot = new Map(TARGETS.map((f) => [f, readFileSync(resolve(ROOT, f))]));

function restoreAll() {
  for (const [f, bytes] of snapshot) writeFileSync(resolve(ROOT, f), bytes);
}

let lastFailure = "";

/** GREEN / RED — and a HARNESS failure is neither (aborts). */
function runSuite(name) {
  const s = SUITES[name];
  try {
    execFileSync("corepack", ["pnpm", "--filter", s.pkg, "exec", "vitest", "run", ...s.files], {
      cwd: ROOT,
      stdio: "pipe",
      shell: true,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    });
    return "GREEN";
  } catch (err) {
    if (typeof err.status === "number" && err.status !== 0) {
      lastFailure = `${String(err.stdout ?? "")}\n${String(err.stderr ?? "")}`.trimEnd();
      return "RED";
    }
    console.error(`\nFATAL: the runner itself failed on suite ${name} — this is NOT a test result.`);
    console.error(`  ${err.code ?? ""} ${err.message}`);
    restoreAll();
    process.exit(2);
  }
}

function suitesFor(m) {
  return m.suites.filter((s) => hasDb || !SUITES[s].db);
}

// Safeguard 3: baseline green, per suite actually used by the selection.
const needed = [...new Set(selected.flatMap(suitesFor))];
console.log(`baseline: running ${needed.join(", ")}${hasDb ? "" : "  (no DATABASE_URL — db suites skipped)"}`);
for (const name of needed) {
  const r = runSuite(name);
  if (r !== "GREEN") {
    console.error(`FATAL: baseline ${name} is ${r}. A red baseline makes every "RED" below meaningless.`);
    console.error("\n──── tail of the failing run ────");
    console.error(lastFailure.split("\n").slice(-40).join("\n"));
    process.exit(2);
  }
  console.log(`  baseline ${name}: GREEN`);
}

const results = [];
let attempted = 0;

for (const m of selected) {
  const suites = suitesFor(m);
  if (suites.length === 0) {
    results.push({ id: m.id, verdict: "SKIPPED (needs DATABASE_URL)", claim: m.claim });
    continue;
  }
  const path = resolve(ROOT, m.file);
  const before = readFileSync(path, "utf8");
  const hits = before.split(m.from).length - 1;
  if (hits !== 1) {
    restoreAll();
    console.error(`FATAL: ${m.id}'s anchor matched ${hits} times in ${m.file} (expected exactly 1).`);
    process.exit(2);
  }
  writeFileSync(path, before.replace(m.from, m.to), "utf8");
  if (readFileSync(path, "utf8") === before) {
    restoreAll();
    console.error(`FATAL: ${m.id} did not change ${m.file}.`);
    process.exit(2);
  }
  attempted += 1;

  const verdicts = suites.map((s) => `${s}:${runSuite(s)}`);
  const caught = verdicts.some((v) => v.endsWith("RED"));

  writeFileSync(path, snapshot.get(m.file));
  if (!readFileSync(path).equals(snapshot.get(m.file))) {
    console.error(`FATAL: ${m.id} left ${m.file} modified. Stopping before anything else runs.`);
    process.exit(2);
  }

  results.push({ id: m.id, verdict: caught ? "RED (caught)" : "ALIVE", detail: verdicts.join(" "), claim: m.claim });
  console.log(`${m.id}: ${caught ? "RED (caught)" : "*** ALIVE ***"}  [${verdicts.join(" ")}]  ${m.claim}`);
}

restoreAll();

// Safeguard 4: attempted must equal what should have run.
const shouldHaveRun = selected.filter((m) => suitesFor(m).length > 0).length;
if (attempted !== shouldHaveRun) {
  console.error(`FATAL: ${attempted} mutants applied but ${shouldHaveRun} were selected.`);
  process.exit(2);
}

// Safeguard 5: byte-identical to the pre-run snapshot (never `git diff` — it
// answers a different question on a branch with uncommitted work).
const dirty = TARGETS.filter((f) => !readFileSync(resolve(ROOT, f)).equals(snapshot.get(f)));

console.log("\n──────── summary ────────");
for (const r of results) console.log(`${r.id.padEnd(4)} ${r.verdict.padEnd(14)} ${r.claim}`);
const alive = results.filter((r) => r.verdict === "ALIVE");
const skipped = results.filter((r) => r.verdict.startsWith("SKIPPED"));
console.log(
  `\n${results.length - skipped.length - alive.length} caught · ${alive.length} ALIVE · ${skipped.length} skipped · ${attempted} applied`,
);
console.log(
  dirty.length === 0
    ? "every TARGET is byte-identical to its pre-run snapshot"
    : `*** TARGETS NOT RESTORED: ${dirty.join(", ")} ***`,
);

// A RUN THAT SKIPPED MUTANTS DOES NOT SUCCEED (:5748 Low-3).
const allowSkipped = argv.includes("--allow-skipped");
if (skipped.length > 0 && !allowSkipped) {
  console.error(
    `\n*** ${skipped.length} mutant(s) SKIPPED — this run did not exercise them. ***\n` +
      `    ${skipped.map((r) => r.id).join(", ")}\n` +
      `    Set DATABASE_URL to run them, or pass --allow-skipped to accept a partial run.`,
  );
}
process.exit(alive.length > 0 || dirty.length > 0 || (skipped.length > 0 && !allowSkipped) ? 1 : 0);
