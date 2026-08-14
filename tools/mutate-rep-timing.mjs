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
// NUMBERS A USER SEES (`reps × tempoMsAvg` and now `watchedMs` are exactly what
// the kcal formulas bill at the exercise MET) and, since the API half landed on
// 2026-08-14, ANYTHING THAT SAVES (the sync write path).
//
// THE API HALF CHANGES SERVER BEHAVIOUR, so 4a's database mutants are in scope
// here where they were out of scope for the engine half — but they stay FEW and
// they stay on the Critical/High rows: three of them, on the stored number and
// the formula version, not one on wording or a ported constant. Everything else
// runs against unit suites in seconds.
//
// Usage:
//   node tools/mutate-rep-timing.mjs              # every mutant
//   node tools/mutate-rep-timing.mjs M1 A2        # only these
//   node tools/mutate-rep-timing.mjs --list
//
// DB mutants need DATABASE_URL exported. If one is SELECTED and it is not set,
// this ABORTS — a suite that skips is not a suite that passed (:5748).
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
const TARGETS = [
  "packages/engine/src/pipeline/fsm.ts",
  "packages/engine/src/session.ts",
  "apps/api/src/modules/workouts/calories.ts",
  "apps/api/src/modules/workouts/service.ts",
  "apps/api/src/modules/workouts/repo.ts",
  "apps/web/src/engine/sessionController.js",
  "apps/web/src/hooks/usePoseDetection.js",
];

/** Suites, by the runner that owns them. `db: true` needs a real Postgres. */
const SUITES = {
  engineTiming: { pkg: "@app/engine", files: ["test/repTimingAbsence.test.ts"] },
  engineAll: { pkg: "@app/engine", files: [] }, // golden traces + parity + fuzz
  apiCalories: { pkg: "api", files: ["test/gamification.unit.test.ts"] },
  apiSync: { pkg: "api", files: ["test/workouts.sync.test.ts"], db: true },
  webBridge: {
    pkg: "web",
    files: ["src/engine/sessionController.test.js", "src/hooks/usePoseDetection.test.js"],
  },
};

const MUTATIONS = [
  // ── the fix's own guarantees (the six the uncommitted harness claimed) ─────
  {
    id: "M1",
    claim: "a frame the engine cannot USE re-arms the open rep's clock (session side)",
    file: "packages/engine/src/session.ts",
    // RE-ANCHORED 2026-08-14: the API half turned this into a block, because
    // losing sight now moves TWO things (the rep clock and watched time). The
    // mutant deliberately removes only the clock re-arm, leaving the watched
    // bookkeeping intact — so a RED here is still this claim and not M12's.
    from: "        fsm.loseSight();\n        blindSinceLastUsable = true;",
    to: "        blindSinceLastUsable = true;",
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
    // RE-ANCHORED 2026-08-14: the fallback's removal collapsed three lines into
    // one. The claim is unchanged and this is still the line that carries it.
    from:
      "    const tempos = repEvents.filter((_, i) => repInterrupted[i] !== true).map((r) => r.durationMs);",
    to: "    const tempos = repEvents.map((r) => r.durationMs);",
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
  // M7 was "a rep watched for ZERO time never sets the set's rate". RETIRED
  // WITH ITS REASON on 2026-08-14 by the API half, not deleted quietly: the
  // line it mutated (`partMeasured`) no longer exists, because Kd ruled the
  // part-measured fallback out entirely. The guarantee did not weaken — it
  // became STRUCTURAL. A rep watched for zero time is interrupted by
  // construction, so M3's filter is now the only thing standing between it and
  // the average, and M3 is RED. M15 covers the direction M7 could not: putting
  // the fallback BACK.
  {
    id: "M8",
    claim:
      "the OCCLUDED path honours §3.1's count of THREE — the threshold Low-1 found unpinned",
    file: "packages/engine/src/pipeline/fsm.ts",
    from: "      if (this.nullMetricStreak >= INVALID_STREAK_FOR_VISIBILITY) this.loseSight();",
    to: "      if (this.nullMetricStreak >= 30) this.loseSight();",
    suites: ["engineTiming"],
  },
  // M9 was "the part-measured reps still set the rate". RETIRED AND REVERSED by
  // Kd's ruling of 2026-08-14, and the reversal is the point: that fallback was
  // never a measurement, it was a workaround for the server not knowing how long
  // the camera watched. It billed an all-interrupted set ~20% low (:7487) — the
  // one place Kd's own part 2 was inverted. Its successor M15 asserts the
  // opposite direction, which is the honest test now that `watchedMs` exists.
  {
    id: "M10",
    claim: "COUNTING is untouched by every one of the above — the whole engine suite says so",
    file: "packages/engine/src/pipeline/fsm.ts",
    from: "    this.sightLostNow = true;\n    if (this.cycleStartT === null) return;",
    to: "    this.sightLostNow = true;\n    this.repCount = 0;\n    if (this.cycleStartT === null) return;",
    suites: ["engineAll"],
  },

  // ── THE API HALF, 2026-08-14: watched time ────────────────────────────────
  {
    id: "M11",
    claim:
      "sight is lost even with NO rep in progress — an absence taken BETWEEN reps is not watched",
    file: "packages/engine/src/pipeline/fsm.ts",
    // The whole point of `sightLostNow` being a separate field: move it after
    // the early return and it stops firing for a user standing at the top, so
    // the absence they take between reps is billed as time the camera watched.
    from: "    this.sightLostNow = true;\n    if (this.cycleStartT === null) return;",
    to: "    if (this.cycleStartT === null) return;\n    this.sightLostNow = true;",
    suites: ["engineTiming"],
  },
  {
    id: "M12",
    claim: "watched time EXCLUDES the stretch sight was lost in",
    file: "packages/engine/src/session.ts",
    from: "      if (lastUsableT !== null && !blindSinceLastUsable) watchedMs += frame.t - lastUsableT;",
    to: "      if (lastUsableT !== null) watchedMs += frame.t - lastUsableT;",
    suites: ["engineTiming"],
  },
  {
    id: "M13",
    claim: "the OCCLUDED path counts as unwatched too, not just frames that never arrive",
    file: "packages/engine/src/session.ts",
    from: "    if (metric === null && fsm.sightLost) blindSinceLastUsable = true;",
    to: "    if (false) blindSinceLastUsable = true;",
    suites: ["engineTiming"],
  },
  {
    id: "M14",
    claim: "the set reports WATCHED time, not its whole span",
    file: "packages/engine/src/session.ts",
    from: "      watchedMs: Math.round(watchedMs),",
    to: "      watchedMs: Math.round(lastT - (firstT ?? lastT)),",
    suites: ["engineTiming"],
  },
  {
    id: "M15",
    claim:
      "the part-measured fallback stays GONE — restoring it re-inverts Kd's part 2 (M9's successor)",
    file: "packages/engine/src/session.ts",
    from:
      "    const tempos = repEvents.filter((_, i) => repInterrupted[i] !== true).map((r) => r.durationMs);",
    to:
      "    const whole = repEvents.filter((_, i) => repInterrupted[i] !== true).map((r) => r.durationMs);\n    const tempos = whole.length > 0 ? whole : repEvents.map((r) => r.durationMs).filter((d) => d > 0);",
    suites: ["engineTiming"],
  },

  // ── the server's half of the same guarantee (no database needed) ──────────
  {
    id: "A1",
    claim: "the UNWATCHED stretch of a set is charged NOTHING, not REST_MET",
    file: "apps/api/src/modules/workouts/calories.ts",
    from: "    idleSpanMs += watched - repMs;",
    to: "    idleSpanMs += s.durationMs - repMs;",
    suites: ["apiCalories"],
  },
  {
    id: "A2",
    claim: "a set with no measurable rate is billed at its WATCHED time, not at nothing",
    file: "apps/api/src/modules/workouts/calories.ts",
    from:
      "      s.reps > 0 ? (s.tempoMsAvg !== null ? Math.min(watched, s.reps * s.tempoMsAvg) : watched) : 0;",
    to: "      s.reps > 0 ? (s.tempoMsAvg !== null ? Math.min(watched, s.reps * s.tempoMsAvg) : 0) : 0;",
    suites: ["apiCalories"],
  },
  {
    id: "A3",
    claim: "the on-screen timer is a BUDGET — a pause inside watched time cannot be billed",
    file: "apps/api/src/modules/workouts/calories.ts",
    from: "    const repMs = Math.min(repMsRaw, remaining);",
    to: "    const repMs = repMsRaw;",
    suites: ["apiCalories"],
  },
  {
    id: "A4",
    claim: "a watched time longer than its own set is clamped in the formula too",
    file: "apps/api/src/modules/workouts/calories.ts",
    from: "    const watched = Math.min(s.watchedMs ?? s.durationMs, s.durationMs);",
    to: "    const watched = s.watchedMs ?? s.durationMs;",
    suites: ["apiCalories"],
  },
  {
    id: "A5",
    claim: "a ZERO-rep set still charges nothing at the exercise MET (Kd's 2026-08-10 defect)",
    file: "apps/api/src/modules/workouts/calories.ts",
    from:
      "      s.reps > 0 ? (s.tempoMsAvg !== null ? Math.min(watched, s.reps * s.tempoMsAvg) : watched) : 0;",
    to:
      "      s.tempoMsAvg !== null ? Math.min(watched, s.reps * s.tempoMsAvg) : watched;",
    suites: ["apiCalories"],
  },

  // ── THE PAUSE FIX, 2026-08-14 (same evening, Kd: "just solve the problem") ─
  {
    id: "P1",
    claim: "telling the engine the feed stopped actually re-arms the clock",
    file: "packages/engine/src/session.ts",
    from: "      fsm.loseSight();\n      blindSinceLastUsable = true;\n    },\n    end,",
    to: "    },\n    end,",
    suites: ["engineTiming"],
  },
  {
    id: "P2",
    claim: "the web bridge TELLS the engine on a resume — not only the scene check",
    file: "apps/web/src/engine/sessionController.js",
    from: "    if (this._session != null) this._session.loseSight();",
    to: "    if (false) this._session.loseSight();",
    suites: ["webBridge"],
  },
  {
    id: "P3",
    claim: "an un-pause reaches the bridge at all (the `enabled` resume site)",
    file: "apps/web/src/hooks/usePoseDetection.js",
    from: "    if (enabled && !wasEnabled) controllerRef.current.framesResumed();",
    to: "    if (false) controllerRef.current.framesResumed();",
    suites: ["webBridge"],
  },
  {
    id: "P4",
    claim: "a tab the user switched away from and back is a resume too",
    file: "apps/web/src/hooks/usePoseDetection.js",
    from: "        controllerRef.current.framesResumed();\n        startStreaming(videoRef.current);",
    to: "        startStreaming(videoRef.current);",
    suites: ["webBridge"],
  },

  // ── DATABASE mutants: the stored number and the stamp (4a Critical/High) ──
  {
    id: "D1",
    claim: "the watched time a client sends is STORED, not dropped",
    file: "apps/api/src/modules/workouts/repo.ts",
    from: "${s.holdMs}, ${s.durationMs}, ${watchedMs}, ${s.avgFormScore},",
    to: "${s.holdMs}, ${s.durationMs}, ${null}, ${s.avgFormScore},",
    suites: ["apiSync"],
  },
  {
    id: "D2",
    claim: "a client cannot claim it watched longer than the set lasted — the write path clamps",
    file: "apps/api/src/modules/workouts/repo.ts",
    from: "          : Math.min(s.watchedMs, s.durationMs);",
    to: "          : s.watchedMs;",
    suites: ["apiSync"],
  },
  {
    id: "D3",
    claim: "a payload reporting watched time is priced AND STAMPED v3, not silently v2",
    file: "apps/api/src/modules/workouts/service.ts",
    from: "  const watchedReported = kcalInputs.some((s) => s.watchedMs !== null);",
    to: "  const watchedReported = false;",
    suites: ["apiSync"],
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

// Safeguard 1b: a DB suite with no database ABORTS. The api suites are
// `describe.skipIf(DATABASE_URL === undefined)`, so without this a D-mutant
// would run zero tests, exit 0, and be scored GREEN — i.e. reported ALIVE for a
// reason that has nothing to do with the code. That is :5748's "6 skipped and
// succeeded" in a new costume, and the rule is the same: a suite that skips is
// not a suite that passed.
if (selected.some((m) => m.suites.some((s) => SUITES[s].db === true))) {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    console.error("FATAL: a database mutant is selected but DATABASE_URL is not set.");
    console.error("Export it, or select only the engine/unit mutants by id.");
    process.exit(2);
  }
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

// Safeguard 5: the LOOP must leave every TARGET clean BY ITSELF — and that is
// measurable only BEFORE the final restore. Measured AFTER it, this compares the
// snapshot against a copy of itself and can never fail: it printed
// "byte-identical" unconditionally, and that line was quoted as evidence in a
// commit message. Found by the diff-only re-review, BACKLOG L15 — the same class
// as :5199 and :5748.
//
// This is NOT the per-mutant check in the loop, which has always been real. That
// one only ever looks at the file THAT mutant named; this one covers every
// target, so a mutation that writes somewhere it did not declare is caught here
// and nowhere else. Never `git diff` — it answers a different question on a
// branch with uncommitted work.
const dirty = TARGETS.filter((f) => !readFileSync(resolve(ROOT, f)).equals(snapshot.get(f)));

// The tree goes back to clean regardless of the verdict above, and before any
// exit below — a failed sweep must not leave mutated source on disk.
restoreAll();

// Safeguard 4: attempted must equal what should have run.
if (attempted !== selected.length) {
  console.error(`FATAL: ${attempted} mutants applied but ${selected.length} were selected.`);
  process.exit(2);
}

console.log("\n──────── summary ────────");
for (const r of results) console.log(`${r.id.padEnd(4)} ${r.verdict.padEnd(14)} ${r.claim}`);
const alive = results.filter((r) => r.verdict === "ALIVE");
console.log(`\n${results.length - alive.length} caught · ${alive.length} ALIVE · ${attempted} applied`);
console.log(
  dirty.length === 0
    ? "the mutation loop left every TARGET byte-identical to its pre-run snapshot"
    : `*** THE LOOP LEFT THESE MODIFIED (restored before exit): ${dirty.join(", ")} ***`,
);

process.exit(alive.length > 0 || dirty.length > 0 ? 1 : 0);
