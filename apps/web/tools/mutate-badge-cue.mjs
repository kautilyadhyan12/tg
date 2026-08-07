/**
 * T3 round 1 fix-round audit — the badge, the cue, and the four stall guards.
 * (DECISIONS :6150. Run from the repo root: `node apps/web/tools/mutate-badge-cue.mjs`)
 *
 * WHY THIS FILE EXISTS: a claim of "N mutants, N RED" that nobody else can
 * re-run is not evidence (:2546). Every figure in :6150 comes from here.
 *
 * EVERY STEP IS CHECKED, NOT ASSUMED — this repo has been burned five times by
 * harnesses reporting unearned passes (:4855, :5199, :5748 among them):
 *   - a mutation that does not change the file ABORTS the run (a drifted anchor
 *     is a broken instrument, never a missing test — :4267)
 *   - a run whose suite reported no tally ABORTS (a suite that never ran is not
 *     a RED — :2614)
 *   - the restore must reproduce the original sha256 or the run ABORTS
 *     immediately, before the next mutant can stack on top of it (:5199 left
 *     broken source in the tree by skipping exactly this)
 *   - line endings survive: substrings are replaced in a utf8 read/write, never
 *     by `sed -i`, which rewrites this repo's CRLF files wholesale (:4267)
 *
 *   - a RUNNER failure (buffer overflow, signal, timeout, corepack missing) is
 *     NOT a red: only a numeric non-zero exit is a test result, and anything
 *     else ABORTS — after the restore, never instead of it (T3 round 2, the
 *     class fix from `tools/mutate-workout-summary.mjs`)
 *
 * SEVEN RUNS OVER SIX DISTINCT MUTATIONS — MX1 and MX2 apply the identical edit
 * and differ only in which test is asked to catch it. Counted honestly here
 * because "7 mutants" reads as seven independent defects and is not what this
 * file measures.
 *
 * NO MUTANT IS EXPECTED ALIVE. MX4 was, for exactly one round, on a claim about
 * the code that turned out to be a claim about one test's shape; it was
 * re-measured and reddened in T3 round 2. An `expectAlive` row is a factual
 * claim like any other and gets re-measured, never inherited.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** The badge and the cue live on the workout page; the calorie EXPLANATION
 *  lives on the summary page, and T3 round 2 found a Critical there — so a
 *  mutant now names its own file and its own suite instead of the whole harness
 *  assuming one of each. Two pages, one instrument: a fix nobody else can
 *  re-run is not evidence (:2546), and that applies to the second page too. */
const TARGETS = {
  activeWorkout: {
    file: resolve(ROOT, 'apps/web/src/pages/ActiveWorkout.jsx'),
    suite: 'src/pages/activeWorkout.render.test.jsx',
  },
  postWorkout: {
    file: resolve(ROOT, 'apps/web/src/pages/PostWorkout.jsx'),
    suite: 'src/pages/xpDisplay.render.test.jsx',
  },
};

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const MUTANTS = [
  {
    id: 'MX1',
    why: 'graded reverts to !countItYourself — C/H-1, the shipped defect',
    expect: 'T3 ROUND 1 C/H-1: a STALLED camera never wears',
    from: 'const graded = !countItYourself && !engineStalled && !cameraDown;',
    to: 'const graded = !countItYourself;',
  },
  {
    id: 'MX2',
    // NOT A SEVENTH MUTATION — T3 round 2. MX1 and MX2 apply the IDENTICAL edit
    // and differ only in which test is asked to catch it, so this file runs
    // SEVEN TIMES over SIX DISTINCT mutations. Both rows are kept, because the
    // two routes to the badge (stall, camera error) are separately worth
    // pinning, but the summary must not read as seven independent defects.
    why: 'the same reversion as MX1, reached by the camera-error route instead',
    expect: 'T3 ROUND 1 C/H-1: a camera ERROR never wears',
    from: 'const graded = !countItYourself && !engineStalled && !cameraDown;',
    to: 'const graded = !countItYourself;',
  },
  {
    id: 'MX3',
    why: 'the cue goes back to asserting a cause the app cannot know — C/H-2',
    expect: 'T3 ROUND 1 C/H-2: the stall cue does not name a cause',
    from: "The camera isn't counting right now. If you're out of shot, step back in — or count this set yourself.",
    to: "The camera can't see you well enough to count. Step back into frame and it carries on.",
  },
  {
    id: 'MX4',
    why: 'stall threshold 0 — every healthy camera would stall at once',
    expect: 'A CAMERA THAT IS WORKING is never interrupted',
    from: 'const ENGINE_STALL_MS = 5000;',
    to: 'const ENGINE_STALL_MS = 0;',
    // WAS `expectAlive: true` FOR ONE ROUND, AND THAT WAS WRONG — T3 round 2,
    // measured both ways before this line was changed.
    //
    // Round 1's reasoning: a fresh frame CLEARS the stall since :6008, so a
    // camera that is delivering frames cannot sustain the offer whatever the
    // threshold says. True of the test AS IT WAS THEN WRITTEN — its loop put the
    // frame and the poll inside one `act`, so the stamp and the clear flushed
    // together — and false of the page. The real page polls once a second while
    // frames arrive about fifteen times a second, so the poll lands BETWEEN
    // frames nearly every time; at a threshold of 0 that gap stalls, and a
    // healthy camera offers to hand every set over once a second all workout.
    // The control now takes one poll between two frames and this mutant is RED.
    //
    // The lesson is worth more than the mutant: an ALIVE mutant explained by a
    // property of the CODE was really a property of the TEST'S SHAPE, and the
    // explanation was written into three places before anyone re-measured it.
    // An expected-alive row is a claim about the world, so it gets re-measured
    // like any other number (V1), not inherited.
  },
  {
    id: 'MX5',
    why: 'the hidden-tab guard is removed from the stall poll',
    expect: 'SWITCHING TABS is not mistaken for a dead camera',
    from: '      if (document.hidden) return;  // the handler above re-stamps on return\r\n',
    to: '',
  },
  {
    id: 'MX6',
    why: 'the pause guard is removed from the stall poll',
    expect: 'a PAUSED workout is not mistaken for a dead camera',
    from: "if (manualMode || paused || phase !== 'workout') return undefined;",
    to: "if (manualMode || phase !== 'workout') return undefined;",
  },
  {
    id: 'MX7',
    why: 'the hidden guard is removed from cameraDown',
    expect: 'BACKGROUNDING THE TAB does not cost the set its grading',
    from: 'const cameraDown = cameraError != null && !pageHidden;',
    to: 'const cameraDown = cameraError != null;',
  },
  {
    id: 'MX8',
    target: 'postWorkout',
    why: 'the Calories tooltip goes back to explaining only the camera-graded half — T3 round 2 C/H-1',
    expect: 'the Calories tooltip covers hand-counted sets',
    // The round-1 wording, verbatim. It is TRUE of a squat/jump-squat/chair-squat
    // set and FALSE of the other 55 exercises, whose whole set span is billed at
    // the exercise MET — so it told nearly every user their standing-around was
    // charged at a resting rate when it was not. Nothing asserted this string
    // before the fix, which is how a rewrite made it false in silence.
    from: 'Calculated from your body weight using standard MET values. Rest breaks between sets count at a low resting rate, and time while you were paused is not counted at all. On a set the camera grades, only your rep time counts at the exercise’s own rate and the rest of that set counts as resting. On a set you count yourself nothing measures when you were moving, so the whole set counts at the exercise’s own rate.',
    to: 'Calculated from your body weight using standard MET values: the time you spent actually working at the exercise’s own rate, and your standing-around and rest-break time at a low resting rate. Time while you were paused is not counted at all.',
  },
];

const abort = (msg) => {
  console.error(`\nABORT — ${msg}`);
  process.exit(2);
};

/** Originals are snapshotted per TARGET, once, before anything is written —
 *  every restore compares against the bytes this run started with. */
const originals = new Map(
  Object.entries(TARGETS).map(([k, t]) => [k, { sha: sha(t.file), text: readFileSync(t.file, 'utf8') }]),
);

const results = [];
for (const m of MUTANTS) {
  const target = TARGETS[m.target ?? 'activeWorkout'];
  const original = originals.get(m.target ?? 'activeWorkout');
  const AW = target.file;
  const SUITE = target.suite;
  const mutated = original.text.replace(m.from, m.to);
  if (mutated === original.text) {
    abort(`${m.id}: its anchor matched nothing. The mutation would have been a no-op, which reports as a missing test. Re-anchor it against the current file.`);
  }
  writeFileSync(AW, mutated);

  let out = '';
  let suiteFailed = false;
  // A RUNNER FAILURE IS NOT A RED — the class fix from
  // `tools/mutate-workout-summary.mjs`, brought here by T3 round 2 rather than
  // left as one file's lesson. A real test failure exits with a NUMERIC status;
  // a buffer overflow, a signal, a timeout or a missing `corepack` does not, and
  // scoring any of those as "caught" is a harness reporting an unearned pass —
  // the failure this file's own header lists five times over. The tally guard
  // below would catch most of it by accident; this catches it by design, and
  // `maxBuffer` removes the one cause already observed in this repo (ENOBUFS on
  // a suite that PASSED).
  //
  // HELD, NOT THROWN. Aborting from inside the catch would leave the file
  // MUTATED on disk — :5199's exact defect, re-created by the fix for a
  // different one. The restore below runs first, unconditionally, and the abort
  // happens after it.
  let runnerFault = null;
  try {
    out = execSync(
      `corepack pnpm --filter web exec vitest run ${SUITE} -t ${JSON.stringify(m.expect)}`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    if (typeof e.status === 'number' && e.status !== 0) {
      suiteFailed = true;
      out = `${e.stdout || ''}${e.stderr || ''}`;
    } else {
      runnerFault = `${e.code || ''} ${e.message}`;
    }
  }

  writeFileSync(AW, original.text);
  if (runnerFault !== null) {
    if (sha(AW) !== original.sha) abort(`${m.id}: the runner failed AND the restore did not reproduce the original bytes — fix the tree by hand.`);
    abort(`${m.id}: the RUNNER itself failed, which is NOT a test result — ${runnerFault}`);
  }
  if (sha(AW) !== original.sha) {
    abort(`${m.id}: the restore did NOT reproduce the original bytes. The working tree is dirty — fix it before running anything else.`);
  }

  const clean = out.replace(/\[[0-9;]*m/g, '');
  const ran = /Tests\s+(?:\d+ failed \| )?\d+ (?:passed|failed)/.test(clean) && !/No test files found/.test(clean);
  if (!ran) abort(`${m.id}: the suite produced no test tally, so this run proves nothing. Its \`expect\` name probably matches no test.`);

  const verdict = suiteFailed ? 'RED' : 'ALIVE';
  const ok = m.expectAlive ? verdict === 'ALIVE' : verdict === 'RED';
  results.push({ ...m, verdict, ok });
  console.log(`${m.id}  ${verdict.padEnd(5)}  ${ok ? 'as expected' : 'UNEXPECTED'}  ${m.why}`);
}

const bad = results.filter((r) => !r.ok);
console.log('\n--- summary ---');
// Every figure DERIVED, including the expected-alive count — a hardcoded "(1
// expected)" kept reading as true for a round after it stopped being (T3 r2).
const distinct = new Set(MUTANTS.map((m) => `${m.from}→${m.to}`)).size;
console.log(`${results.length} runs over ${distinct} distinct mutations · ${results.filter((r) => r.verdict === 'RED').length} RED · ${results.filter((r) => r.verdict === 'ALIVE').length} ALIVE (${MUTANTS.filter((m) => m.expectAlive).length} expected) · 0 never ran`);
console.log('restore verified byte-exact (sha256) after every mutant');
if (bad.length) {
  console.error(`\n${bad.length} mutant(s) did not match expectation: ${bad.map((b) => b.id).join(', ')}`);
  process.exit(1);
}
console.log('every mutant matched its expectation');
