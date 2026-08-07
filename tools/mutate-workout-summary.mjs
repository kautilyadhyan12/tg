// TEST AUDIT for the post-workout summary card (Kd's review/fix rule 4,
// DECISIONS :5348): "for each existing test, deliberately break the thing it
// claims to check and confirm the test goes red. Tests that stay green are
// liars."
//
// Usage:
//   node tools/mutate-workout-summary.mjs            # every mutant
//   node tools/mutate-workout-summary.mjs M4 M7      # only these
//   node tools/mutate-workout-summary.mjs --list
//
// DATABASE_URL must be set for the api DB suite; mutants that need it are
// skipped (and REPORTED AS SKIPPED, never as passes) when it is absent.
//
// ── the safeguards, and why each one exists ─────────────────────────────────
// Every one of these is here because this project has already been burned by
// its absence. Read them before adding a mutant.
//
//  1. A mutation naming a file outside TARGETS ABORTS THE RUN (:5199 F1 — a
//     harness damaged a source file and never restored it, TWICE, while
//     printing "proves every restore landed").
//  2. A mutation whose search string is not found ABORTS (:4267 — CRLF files
//     meant `sed -i` rewrote line endings, so an md5 "bite check" moved on a
//     match of NOTHING and a drifted anchor reported as a missing test).
//  3. The BASELINE must be GREEN before any mutant runs (:2614 F3 — without it
//     "RED" cannot distinguish a caught mutant from a suite that never ran; a
//     broken runner produced a full table of REDs and exit 0).
//  4. Mutants ATTEMPTED must equal mutants SELECTED (:4855 — a run where NOT
//     ONE mutant executed printed "ALL MUTANTS CAUGHT", exit 0, because bash
//     expanded an unset array to nothing).
//  5. Restores are verified BYTE-EXACT from the snapshot, and the run ends by
//     asserting `git diff` is clean for every target — on git's word, not the
//     harness's own (:5199).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/** The ONLY files any mutation may touch. */
const TARGETS = [
  "apps/api/src/modules/workouts/summaryContent.ts",
  "apps/api/src/modules/workouts/service.ts",
  "apps/api/src/modules/workouts/repo.ts",
  "apps/api/src/modules/gamification/xp.ts",
  "apps/web/src/api/gamificationApi.js",
  "apps/web/src/pages/PostWorkout.jsx",
];

/** Suites, by the runner that owns them. `db: true` needs DATABASE_URL. */
const SUITES = {
  apiUnit: { pkg: "api", files: ["test/workouts.summary.unit.test.ts"], db: false },
  apiDb: { pkg: "api", files: ["test/workouts.summary.test.ts"], db: true },
  webReader: { pkg: "web", files: ["src/api/gamificationApi.test.js"], db: false },
  webRender: { pkg: "web", files: ["src/pages/xpDisplay.render.test.jsx"], db: false },
};

const MUTATIONS = [
  {
    id: "M1",
    claim: "the streak-day bonus is actually added to a workout's XP",
    file: "apps/api/src/modules/gamification/xp.ts",
    from: "  if (inp.isStreakContinuation) xp += XP_REWARDS.streak_day;",
    to: "  if (false && inp.isStreakContinuation) xp += XP_REWARDS.streak_day;",
    suites: ["apiUnit", "apiDb"],
  },
  {
    id: "M2",
    claim: "a record with a ZERO value is not congratulated",
    file: "apps/api/src/modules/workouts/summaryContent.ts",
    from: "    id === workoutId && value !== null && value > 0;",
    to: "    id === workoutId && value !== null;",
    suites: ["apiUnit"],
  },
  {
    id: "M3",
    claim: "a record another workout holds is not claimed by this one",
    file: "apps/api/src/modules/workouts/summaryContent.ts",
    from: "    id === workoutId && value !== null && value > 0;",
    to: "    id !== null && value !== null && value > 0;",
    suites: ["apiUnit", "apiDb"],
  },
  {
    id: "M4",
    claim: "the meal bands' >400 boundary is EXCLUSIVE, as Python's is",
    file: "apps/api/src/modules/workouts/summaryContent.ts",
    from: "  if (kcal > 400) {",
    to: "  if (kcal >= 400) {",
    suites: ["apiUnit"],
  },
  {
    id: "M5",
    claim: "an unmatched muscle set falls back to the generic stretches",
    file: "apps/api/src/modules/workouts/summaryContent.ts",
    from: "  if (stretches.length === 0) {",
    to: "  if (false) {",
    suites: ["apiUnit"],
  },
  // ── M6 IS RETIRED, and this is the record of why ──────────────────────────
  // It read: "activeSeconds is the SUM OF SET durations, not the workout's
  // total", mutating the sum to `workout.durationMs`. It came back ALIVE on the
  // first COMPLETE sweep — and it is EQUIVALENT, not uncaught: `repo.syncWorkout`
  // derives `duration_ms` as `sets.reduce((a, s) => a + s.durationMs, 0)`, so the
  // two expressions compute the same number for every input. Measured against
  // the live DB rather than reasoned: 12 of 12 workouts had them exactly equal.
  //
  // **Deleting it silently would have been the wrong move**, because the survival
  // was the finding: the summary was printing "31s" over "1 min total" with a
  // tooltip explaining a rest gap that does not exist. A mutant nothing can kill
  // is not noise — it is the shape of a distinction the code claims and does not
  // have (:5104 F5: "a fix whose protection cannot fail is the same defect with a
  // comment on it"). M21 below pins what actually needed pinning.
  {
    // RE-ANCHORED 2026-08-07: `totalTimeLabel` now takes SECONDS, so the old
    // anchor (…durationMinutes) matched zero times. The claim is unchanged.
    id: "M21",
    claim: "no 'total' sub-line is drawn when the total IS the active time",
    file: "apps/web/src/pages/PostWorkout.jsx",
    from: "sublabel: summary.activeSeconds !== null && summary.durationSeconds !== null && summary.durationSeconds !== summary.activeSeconds ? totalTimeLabel(summary.durationSeconds) : null",
    to: "sublabel: summary.activeSeconds !== null ? totalTimeLabel(summary.durationSeconds) : null",
    suites: ["webRender"],
  },
  {
    // Kd's smoke, 2026-08-07: "2 min total" printed under "1m 27s" for a
    // 1 m 44 s workout. Reverting to the minutes spelling must go RED.
    id: "M23",
    claim: "the 'total' sub-line speaks SECONDS, not rounded minutes",
    file: "apps/web/src/api/gamificationApi.js",
    from: "  return totalSeconds === null ? null : `${secondsLabel(totalSeconds)} total`;",
    to: "  return totalSeconds === null ? null : `${workoutTimeLabel(null, Math.round(totalSeconds / 60))} total`;",
    suites: ["webReader", "webRender"],
  },
  {
    id: "M7",
    claim: "exercisesCount counts DISTINCT exercises, not sets",
    file: "apps/api/src/modules/workouts/service.ts",
    from: "    exercisesCount: new Set(sets.map((s) => s.exerciseSlug)).size,",
    to: "    exercisesCount: sets.length,",
    suites: ["apiDb"],
  },
  {
    id: "M8",
    claim: "TENANCY: the summary is keyed by user, so a stranger cannot read it",
    file: "apps/api/src/modules/workouts/repo.ts",
    from: "    FROM workouts WHERE id = ${workoutId} AND user_id = ${userId}`;",
    to: "    FROM workouts WHERE id = ${workoutId}`;",
    suites: ["apiDb"],
  },
  {
    id: "M9",
    claim: "a 200 that is not a summary reads as a FAILED read, not empty data",
    file: "apps/web/src/api/gamificationApi.js",
    from: "  if (typeof data.workoutId !== 'string' || data.workoutId === '') return null;",
    to: "  if (false) return null;",
    suites: ["webReader", "webRender"],
  },
  {
    id: "M10",
    claim: "the total is converted to minutes ONCE, and rounded",
    file: "apps/web/src/api/gamificationApi.js",
    from: "    durationMinutes: durationSeconds === null ? null : Math.round(durationSeconds / 60),",
    to: "    durationMinutes: durationSeconds,",
    suites: ["webReader", "webRender"],
  },
  {
    // RE-ANCHORED (T3 round 1, L-1). Both M11 and M12 pointed at
    // `if (err?.response?.status === 404 && triesLeft > 0) {`, which the step-8
    // fix replaced — so each matched ZERO times and the sweep died at M11 after
    // ten minutes of green suites. **The retry itself therefore had no live
    // mutant**: M15/M17/M18 mutate the CONDITIONS, and nothing asserted that the
    // retry HAPPENS. This is the one that restores that.
    id: "M11",
    claim: "the retry actually happens — without it a first failure is fatal",
    file: "apps/web/src/pages/PostWorkout.jsx",
    from: "          if (awaitingSync && triesLeft > 0) {",
    to: "          if (false && triesLeft > 0) {",
    suites: ["webRender"],
  },
  {
    // REPOINTED, and its CLAIM corrected. It used to read "ONLY a 404 is
    // retried", which the step-8 fix made false — a no-response error is retried
    // too. What is still true, and what this now mutates, is that a response
    // WITH a status other than 404 (a 500) is not.
    id: "M12",
    claim: "a 5xx is NOT retried — only 'not here yet' shapes are",
    file: "apps/web/src/pages/PostWorkout.jsx",
    from: "          const notHereYet = noResponse || err?.response?.status === 404;",
    to: "          const notHereYet = true;",
    suites: ["webRender"],
  },
  {
    // Kd's smoke, step 7. Both halves of the fix get a mutant, because the gate
    // and the message are two separate reads of the same fact and a fix that
    // only moved one of them would still show the false sentence.
    id: "M15",
    claim: "the WAITING state needs the workout in this browser's own outbox",
    file: "apps/web/src/pages/PostWorkout.jsx",
    // RE-ANCHORED after the step-8 fix split this into two lines. The old anchor
    // matched 0 times and safeguard 2 aborted rather than reporting a missing
    // test — which is the whole reason that safeguard exists (:4267).
    from: "          const awaitingSync = notHereYet && isAwaitingSync(workoutId);",
    to: "          const awaitingSync = notHereYet;",
    suites: ["webRender"],
  },
  {
    id: "M16",
    claim: "the 'saved, will sync' message needs the outbox too, not just a 404",
    file: "apps/web/src/pages/PostWorkout.jsx",
    // SINGLE LINE, no `\n`. The first version spanned two lines and matched
    // ZERO times: this working tree is CRLF, so a `\n` in an anchor never finds
    // its `\r\n`. Safeguard 2 aborted rather than reporting a missing test —
    // which is :4267's failure mode caught by the guard written for it.
    from: "            awaitingSync",
    to: "            err?.response?.status === 404",
    suites: ["webRender"],
  },
  {
    // Kd's smoke, step 8 — the case the waiting state was BUILT for, and the one
    // the first implementation missed because offline produces no status code.
    id: "M17",
    claim: "OFFLINE (no response at all) counts as 'not sent yet', not a failure",
    file: "apps/web/src/pages/PostWorkout.jsx",
    from: "          const notHereYet = noResponse || err?.response?.status === 404;",
    to: "          const notHereYet = err?.response?.status === 404;",
    suites: ["webRender"],
  },
  {
    // The other half of that fix: our OWN "this body is not a summary" throw has
    // no `err.response` either, so without the tag it is mistaken for a dropped
    // network and retried. The empty-200 test is what caught this.
    // RE-ANCHORED (T3 round 1, L-3 rewrote this line). The property is the same
    // — an unreadable 200 body must not be read as a dropped connection — but it
    // is now enforced by requiring the POSITIVE signal `err.request` rather than
    // by tagging our own throw. Dropping that half is exactly the old defect.
    id: "M18",
    claim: "an unreadable 200 body is NOT mistaken for a dropped connection",
    file: "apps/web/src/pages/PostWorkout.jsx",
    from: "          const noResponse = err?.request !== undefined && err?.response === undefined;",
    to: "          const noResponse = err?.response === undefined;",
    suites: ["webRender"],
  },
  {
    // T3 round 1, C/H-1 — the blocking finding. Without the day gate, two
    // workouts on one continuation day each claim the +10 the total awarded once.
    id: "M19",
    claim: "ONE streak bonus per DAY — not one per workout on that day",
    file: "apps/api/src/modules/workouts/service.ts",
    from: "  const isStreakContinuation = isContinuation && !hasEarlierToday;",
    to: "  const isStreakContinuation = isContinuation;",
    suites: ["apiDb"],
  },
  {
    // …and the tie-break, so the bonus lands on exactly one of a same-instant
    // pair rather than on both or neither.
    id: "M20",
    claim: "the day's FIRST workout owns the bonus (earlier started_at wins)",
    file: "apps/api/src/modules/workouts/repo.ts",
    from: "        AND (started_at < ${startedAt}",
    to: "        AND (started_at > ${startedAt}",
    suites: ["apiDb"],
  },
  {
    // T3 round 2, Low-4 — the one-kick fix was unprotected.
    id: "M22",
    claim: "the sync queue is kicked ONCE across the retries, not once per retry",
    file: "apps/web/src/pages/PostWorkout.jsx",
    from: "            if (triesLeft === SYNC_RETRY_ATTEMPTS) {",
    to: "            if (triesLeft > 0) {",
    suites: ["webRender"],
  },
  {
    id: "M13",
    claim: "the waiting state shows SAVING copy, not the ordinary loading copy",
    file: "apps/web/src/pages/PostWorkout.jsx",
    from: "            {syncing ? 'Saving your workout…' : 'Loading your results...'}",
    to: "            {'Loading your results...'}",
    suites: ["webRender"],
  },
  {
    id: "M14",
    claim: "an outlasted 404 says the workout is SAVED, not that loading failed",
    file: "apps/web/src/pages/PostWorkout.jsx",
    from: "              ? \"Your workout is saved and will sync when you're back online.\"",
    to: "              ? 'Failed to load summary'",
    suites: ["webRender"],
  },
];

// ── plumbing ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (argv.includes("--list")) {
  for (const m of MUTATIONS) console.log(`${m.id}  ${m.claim}`);
  process.exit(0);
}
const only = argv.filter((a) => !a.startsWith("--"));
const selected = only.length > 0 ? MUTATIONS.filter((m) => only.includes(m.id)) : MUTATIONS;

if (only.length > 0 && selected.length !== only.length) {
  // Safeguard 2's sibling: an unknown label must be FATAL, never a silently
  // shorter table (:4855 F6).
  const known = new Set(MUTATIONS.map((m) => m.id));
  const bad = only.filter((a) => !known.has(a));
  console.error(`FATAL: unknown mutation id(s): ${bad.join(", ")}`);
  process.exit(2);
}
if (selected.length === 0) {
  console.error("FATAL: nothing selected — a sweep over nothing is not a pass.");
  process.exit(2);
}

// Safeguard 1: every mutation must name a file inside TARGETS. Checked for the
// WHOLE table, not just the selection, so a bad entry cannot hide behind a
// filtered run.
for (const m of MUTATIONS) {
  if (!TARGETS.includes(m.file)) {
    console.error(`FATAL: ${m.id} names ${m.file}, which is not in TARGETS.`);
    console.error("A mutation outside the snapshot list cannot be restored. Aborting.");
    process.exit(2);
  }
}

// Safeguard 2, HOISTED — every anchor is checked UP FRONT, for the whole table,
// before a single suite runs (T3 round 1, L-1).
//
// It used to be checked inside the mutant loop, which is technically sufficient
// and practically useless: two anchors had gone stale (the step-8 fix rewrote
// the line they pointed at), and the run spent TEN MINUTES executing M1–M10
// before dying at M11. A harness that can only tell you it is broken after ten
// minutes is one nobody runs. Now it costs one second, and — the part that
// matters — it reports EVERY stale anchor at once instead of the first.
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

/** Snapshot every target as BYTES, so restore is byte-exact regardless of line
 *  endings (this repo's working tree is CRLF — :4267). */
const snapshot = new Map(TARGETS.map((f) => [f, readFileSync(resolve(ROOT, f))]));

function restoreAll() {
  for (const [f, bytes] of snapshot) writeFileSync(resolve(ROOT, f), bytes);
}

/** Run one suite. GREEN / RED — and a HARNESS failure is neither.
 *
 *  THE BARE `catch { return "RED" }` THIS REPLACES WAS A LIE DETECTOR POINTING
 *  THE WRONG WAY, and it fired on its first run: the api DB suite takes ~3
 *  minutes and prints more than the default 1 MB `maxBuffer`, so `execFileSync`
 *  threw ENOBUFS on a suite that PASSED, and the harness reported a red
 *  baseline. Had that happened one line later — during a mutant instead of the
 *  baseline — every mutant would have been scored "caught" while nothing was
 *  ever asserted. That is :2614 F3's failure mode arriving by a new route, and
 *  it is why a runner error must ABORT rather than resolve to a verdict.
 *
 *  A genuine test failure sets a numeric exit `status`. Anything else — a
 *  signal, a buffer overflow, a timeout, corepack not found — has no business
 *  being read as evidence about the code under test. */
/** Output of the most recent RED run, so a verdict can show its working. */
let lastFailure = "";

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
      // KEEP THE EVIDENCE. A bare "RED" is a verdict with nothing behind it, and
      // a baseline that goes red for a reason nobody can see is indistinguishable
      // from a harness fault — this run had exactly that, on a suite that passed
      // standalone seconds later. The tail is printed by the baseline gate.
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
  // Safeguard 2: the anchor must exist, exactly once.
  const hits = before.split(m.from).length - 1;
  if (hits !== 1) {
    restoreAll();
    console.error(`FATAL: ${m.id}'s anchor matched ${hits} times in ${m.file} (expected exactly 1).`);
    console.error("A drifted anchor reports as a missing test. Fix the mutation, do not ignore it.");
    process.exit(2);
  }
  writeFileSync(path, before.replace(m.from, m.to), "utf8");
  // …and the write must have CHANGED the file.
  if (readFileSync(path, "utf8") === before) {
    restoreAll();
    console.error(`FATAL: ${m.id} did not change ${m.file}.`);
    process.exit(2);
  }
  attempted += 1;

  const verdicts = suites.map((s) => `${s}:${runSuite(s)}`);
  const caught = verdicts.some((v) => v.endsWith("RED"));

  // Restore and verify BYTE-EXACT before moving on.
  writeFileSync(path, snapshot.get(m.file));
  if (!readFileSync(path).equals(snapshot.get(m.file))) {
    console.error(`FATAL: ${m.id} left ${m.file} modified. Stopping before anything else runs.`);
    process.exit(2);
  }

  results.push({ id: m.id, verdict: caught ? "RED (caught)" : "ALIVE", detail: verdicts.join(" "), claim: m.claim });
  console.log(`${m.id}: ${caught ? "RED (caught)" : "*** ALIVE ***"}  [${verdicts.join(" ")}]  ${m.claim}`);
}

restoreAll();

// Safeguard 4: attempted must equal the number that should have run.
const shouldHaveRun = selected.filter((m) => suitesFor(m).length > 0).length;
if (attempted !== shouldHaveRun) {
  console.error(`FATAL: ${attempted} mutants applied but ${shouldHaveRun} were selected.`);
  process.exit(2);
}

// Safeguard 5: every target is byte-identical to the snapshot taken before the
// first mutant ran.
//
// THE FIRST VERSION OF THIS CHECK ASKED GIT, AND GIT CANNOT ANSWER THIS
// QUESTION. `git diff --name-only` compares the tree against HEAD, so on any
// branch with uncommitted work — which is every branch a mutation run happens
// on — it reports the CARD'S OWN CHANGES as damage. It duly did: a clean sweep
// of 14/14 caught ended `*** TARGETS STILL MODIFIED ***` and exit 1, naming four
// files whose mutated lines were all verified back to their originals.
//
// It failed toward a FALSE ALARM, which is the safe direction, and that is the
// only reason this is a footnote rather than an incident. But the shape is the
// one this project keeps recording (:5199, :4855, :2614): a safeguard that reads
// authoritative while asserting something adjacent to what it claims. The
// question is "did the harness put every byte back", and the snapshot is the only
// thing that knows.
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

// A RUN THAT SKIPPED MUTANTS DOES NOT SUCCEED (T3 round 2, Low-3).
//
// Without DATABASE_URL the six apiDb mutants are skipped — and those include
// M19 and M20, the two that guard the Critical/High fix this card's round 1 was
// about. The run printed "6 skipped" and exited 0. The count was visible, so it
// was not a lie; but a GREEN EXIT on a run that never exercised the C/H guard is
// the shape this project has been burned by five times (:2614 F3, :2736 F1, the
// `cp` failure, :4855's zero-mutant run, :5199 F1), and every one of those was
// also "technically reported". Exit codes are what CI and a hurried human read.
//
// `--allow-skipped` exists for the deliberate case (a quick web-only pass while
// iterating) and says so out loud, which "0" never did.
const allowSkipped = argv.includes("--allow-skipped");
if (skipped.length > 0 && !allowSkipped) {
  console.error(
    `\n*** ${skipped.length} mutant(s) SKIPPED — this run did not exercise them. ***\n` +
      `    ${skipped.map((r) => r.id).join(", ")}\n` +
      `    Set DATABASE_URL to run them, or pass --allow-skipped to accept a partial run.`,
  );
}
process.exit(alive.length > 0 || dirty.length > 0 || (skipped.length > 0 && !allowSkipped) ? 1 : 0);
