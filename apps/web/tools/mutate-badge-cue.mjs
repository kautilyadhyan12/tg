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
 * ONE MUTANT IS EXPECTED ALIVE and says so in its own row. That is not a
 * tolerated failure — it is a measured property of the code, explained inline.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const AW = resolve(ROOT, 'apps/web/src/pages/ActiveWorkout.jsx');
const SUITE = 'src/pages/activeWorkout.render.test.jsx';

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
    why: 'the same reversion, reached by the camera-error route instead',
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
    // EXPECTED ALIVE, and this is the honest reason rather than a widened gate.
    // Since :6008 a fresh frame CLEARS the stall, so a camera that is delivering
    // frames cannot sustain the offer whatever the threshold says — the stamp
    // and the next frame's clear land in the same commit. The guarantee is real
    // and IS protected, just not here: deleting the clearing line reddens the KD
    // RULING test and MX1's badge test, and deleting the heartbeat refresh
    // reddens 'a redo AFTER the camera recovers'. Both measured 2026-08-07.
    // Do NOT "fix" this by weakening the test — that would be :5104's F5 again.
    expectAlive: true,
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
];

const original = { sha: sha(AW), text: readFileSync(AW, 'utf8') };
const abort = (msg) => {
  console.error(`\nABORT — ${msg}`);
  process.exit(2);
};

const results = [];
for (const m of MUTANTS) {
  const mutated = original.text.replace(m.from, m.to);
  if (mutated === original.text) {
    abort(`${m.id}: its anchor matched nothing. The mutation would have been a no-op, which reports as a missing test. Re-anchor it against the current file.`);
  }
  writeFileSync(AW, mutated);

  let out = '';
  let suiteFailed = false;
  try {
    out = execSync(
      `corepack pnpm --filter web exec vitest run ${SUITE} -t ${JSON.stringify(m.expect)}`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    suiteFailed = true;
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }

  writeFileSync(AW, original.text);
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
console.log(`${results.length} mutants · ${results.filter((r) => r.verdict === 'RED').length} RED · ${results.filter((r) => r.verdict === 'ALIVE').length} ALIVE (1 expected) · 0 never ran`);
console.log('restore verified byte-exact (sha256) after every mutant');
if (bad.length) {
  console.error(`\n${bad.length} mutant(s) did not match expectation: ${bad.map((b) => b.id).join(', ')}`);
  process.exit(1);
}
console.log('every mutant matched its expectation');
