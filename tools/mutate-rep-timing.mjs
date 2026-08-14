// TEST AUDIT for the rep-timing-absence card (Kd's review/fix rule 4, DECISIONS
// :5348, SCOPED BY SEVERITY per :5857).
//
// WHY THIS FILE EXISTS AT ALL: the card's engine half was reported as "6 mutants,
// 6 RED" and the harness that produced that was never committed — :5199's class,
// the very thing DECISIONS :6532 was written about. An evidence claim whose
// instrument cannot be re-run is not evidence. Found by T3 round 1 (Low-2,
// 2026-08-14); this is that instrument.
//
// SEVERITY SCOPE (rule 4a): every mutant below sits in the always-mutated rows —
// they all guard NUMBERS A USER SEES, because `reps × tempoMsAvg` is exactly what
// `kcalPointForSetsV2` bills at the exercise MET. None needs a database: this is
// an engine-only card, so per 4a no DB mutant runs and the whole sweep is
// seconds, not minutes.
//
// Usage:
//   node tools/mutate-rep-timing.mjs              # every mutant
//   node tools/mutate-rep-timing.mjs M1 M7        # only these
//   node tools/mutate-rep-timing.mjs --list
//
// Safeguards 1–5 are mutate-duration-kcal.mjs's, unchanged in substance; each
// exists because this project was burned by its absence (:5199 uncommitted
// instrument · :4267 CRLF anchors · :2614 unrestored tree · :4855 fixture shape ·
// :5748 a skipping run exiting 0).
//
// NOT MUTATED, and why — an unkillable mutant is a claimed distinction the code
// does not have (the M6 lesson, :5618):
// - `cycleMin` is deliberately NOT re-armed on lost sight (a draft that reset it
//   emitted `romExtreme: Infinity`, :7404). Mutating it to re-arm changes ROM,
//   not timing, and the romStats assertions already own that surface.
// - THE `cycleStartT = t` HALF OF THE RE-PIN, retired here with its reason after
//   being measured ALIVE in two forms (`= t` → `??= t`, and the line deleted
//   outright) on 2026-08-14. It is REDUNDANT, not untested: the cycle
//   bookkeeping thirty lines below runs `this.cycleStartT ??= t` on every frame
//   at or below `upAt`, so it re-pins the clock on the same frame the rearm
//   block would. The only case the explicit line changes is a user returning
//   ABOVE the top threshold, where it buys one frame (67 ms) of duration on a
//   rep that is unmeasured either way. Writing an assertion for that distinction
//   would pin an accident, not a guarantee. The `cycleMinT`/`cycleMinLastT` half
//   of the same block IS load-bearing and IS mutated — that is M4, which is RED.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/** The ONLY files any mutation may touch. */
const TARGETS = ["packages/engine/src/pipeline/fsm.ts", "packages/engine/src/session.ts"];

/** Suites, by the runner that owns them. No `db` flag: none of these need one. */
const SUITES = {
  engineTiming: { pkg: "@app/engine", files: ["test/repTimingAbsence.test.ts"] },
  engineAll: { pkg: "@app/engine", files: [] }, // golden traces + parity + fuzz
};

const MUTATIONS = [
  // ── the fix's own guarantees (the six the uncommitted harness claimed) ─────
  {
    id: "M1",
    claim: "a frame the engine cannot USE re-arms the open rep's clock (session side)",
    file: "packages/engine/src/session.ts",
    from: "      if (!accepted.visibilityOk) fsm.loseSight();",
    to: "      if (false) fsm.loseSight();",
    suites: ["engineTiming"],
  },
  {
    id: "M2",
    claim: "legs that stop being MEASURABLE count as lost sight too (the occluded path)",
    file: "packages/engine/src/pipeline/fsm.ts",
    from: "      if (this.nullMetricStreak >= INVALID_STREAK_FOR_VISIBILITY) this.loseSight();",
    to: "      if (false) this.loseSight();",
    suites: ["engineTiming"],
  },
  {
    id: "M3",
    claim: "a half-watched rep is EXCLUDED from the set's average tempo (Kd's part 2)",
    file: "packages/engine/src/session.ts",
    from: "      .filter((_, i) => repInterrupted[i] !== true)",
    to: "      .filter(() => true)",
    suites: ["engineTiming"],
  },
  {
    id: "M4",
    claim: "the bottom-of-rep timestamps re-arm too — else `descent` goes NEGATIVE",
    file: "packages/engine/src/pipeline/fsm.ts",
    from: "      this.cycleStartT = t;\n      this.cycleMinT = t;\n      this.cycleMinLastT = t;",
    to: "      this.cycleStartT = t;",
    suites: ["engineTiming"],
  },
  // M5 was the `cycleStartT` re-pin. RETIRED WITH ITS REASON, not deleted
  // silently — see the header. Ids are not renumbered: a stable id is what makes
  // a past run's summary readable against this table.
  {
    id: "M6",
    claim: "an interrupted rep is FLAGGED as interrupted, so the average can exclude it",
    file: "packages/engine/src/pipeline/fsm.ts",
    from: "    this.cycleInterrupted = true;",
    to: "    this.cycleInterrupted = false;",
    suites: ["engineTiming"],
  },
  // ── T3 round 1, 2026-08-14 ────────────────────────────────────────────────
  {
    id: "M7",
    claim: "a rep watched for ZERO time never sets the set's rate (the round-1 Critical)",
    file: "packages/engine/src/session.ts",
    from: "    const partMeasured = repEvents.map((r) => r.durationMs).filter((d) => d > 0);",
    to: "    const partMeasured = repEvents.map((r) => r.durationMs);",
    suites: ["engineTiming"],
  },
  {
    id: "M8",
    claim:
      "the OCCLUDED path honours §3.1's count of THREE — the threshold Low-1 found unpinned",
    file: "packages/engine/src/pipeline/fsm.ts",
    from: "      if (this.nullMetricStreak >= INVALID_STREAK_FOR_VISIBILITY) this.loseSight();",
    to: "      if (this.nullMetricStreak >= 30) this.loseSight();",
    suites: ["engineTiming"],
  },
  {
    id: "M9",
    claim:
      "the part-measured reps still set the rate — NOT the `null` the review proposed (bills less)",
    file: "packages/engine/src/session.ts",
    from: "    const tempos = wholeTempos.length > 0 ? wholeTempos : partMeasured;",
    to: "    const tempos = wholeTempos;",
    suites: ["engineTiming"],
  },
  {
    id: "M10",
    claim: "COUNTING is untouched by every one of the above — the whole engine suite says so",
    file: "packages/engine/src/pipeline/fsm.ts",
    from: "  loseSight(): void {\n    if (this.cycleStartT === null) return;",
    to: "  loseSight(): void {\n    this.repCount = 0;\n    if (this.cycleStartT === null) return;",
    suites: ["engineAll"],
  },
];

// ── plumbing (mutate-duration-kcal.mjs's, unchanged in substance) ───────────

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

/** EOL-normalise an anchor to the FILE'S ending, never the file to the anchor's
 *  (:4267 + :5199 together — the first run of this card's uncommitted harness
 *  aborted on exactly this, `\n` anchors against a CRLF tree). */
function anchorFor(text, literal) {
  return text.includes("\r\n") ? literal.replaceAll("\n", "\r\n") : literal;
}

// Safeguard 2, HOISTED: every anchor checked up front, for the whole table.
{
  const stale = [];
  for (const m of MUTATIONS) {
    const text = readFileSync(resolve(ROOT, m.file), "utf8");
    const hits = text.split(anchorFor(text, m.from)).length - 1;
    if (hits !== 1) stale.push(`${m.id}  (${hits} matches in ${m.file})`);
  }
  if (stale.length > 0) {
    console.error("FATAL: stale anchors — a drifted anchor reports as a missing test.\n");
    for (const s of stale) console.error(`  ${s}`);
    console.error("\nRe-anchor them against the current source. Do not delete the mutant.");
    process.exit(2);
  }
}

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

// Safeguard 3: baseline green, per suite actually used by the selection.
const needed = [...new Set(selected.flatMap((m) => m.suites))];
console.log(`baseline: running ${needed.join(", ")}`);
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
  const path = resolve(ROOT, m.file);
  const before = readFileSync(path, "utf8");
  const from = anchorFor(before, m.from);
  const hits = before.split(from).length - 1;
  if (hits !== 1) {
    restoreAll();
    console.error(`FATAL: ${m.id}'s anchor matched ${hits} times in ${m.file} (expected exactly 1).`);
    process.exit(2);
  }
  writeFileSync(path, before.replace(from, anchorFor(before, m.to)), "utf8");
  if (readFileSync(path, "utf8") === before) {
    restoreAll();
    console.error(`FATAL: ${m.id} did not change ${m.file}.`);
    process.exit(2);
  }
  attempted += 1;

  const verdicts = m.suites.map((s) => `${s}:${runSuite(s)}`);
  const caught = verdicts.some((v) => v.endsWith("RED"));

  writeFileSync(path, snapshot.get(m.file));
  if (!readFileSync(path).equals(snapshot.get(m.file))) {
    console.error(`FATAL: ${m.id} left ${m.file} modified. Stopping before anything else runs.`);
    process.exit(2);
  }

  results.push({ id: m.id, verdict: caught ? "RED (caught)" : "ALIVE", claim: m.claim });
  console.log(`${m.id}: ${caught ? "RED (caught)" : "*** ALIVE ***"}  [${verdicts.join(" ")}]  ${m.claim}`);
}

restoreAll();

// Safeguard 4: attempted must equal what should have run.
if (attempted !== selected.length) {
  console.error(`FATAL: ${attempted} mutants applied but ${selected.length} were selected.`);
  process.exit(2);
}

// Safeguard 5: byte-identical to the pre-run snapshot (never `git diff` — it
// answers a different question on a branch with uncommitted work).
const dirty = TARGETS.filter((f) => !readFileSync(resolve(ROOT, f)).equals(snapshot.get(f)));

console.log("\n──────── summary ────────");
for (const r of results) console.log(`${r.id.padEnd(4)} ${r.verdict.padEnd(14)} ${r.claim}`);
const alive = results.filter((r) => r.verdict === "ALIVE");
console.log(`\n${results.length - alive.length} caught · ${alive.length} ALIVE · ${attempted} applied`);
console.log(
  dirty.length === 0
    ? "every TARGET is byte-identical to its pre-run snapshot"
    : `*** TARGETS NOT RESTORED: ${dirty.join(", ")} ***`,
);

process.exit(alive.length > 0 || dirty.length > 0 ? 1 : 0);
