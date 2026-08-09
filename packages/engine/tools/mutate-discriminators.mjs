/**
 * Mutation audit for the pose discriminators (camera-accuracy card, phase 2).
 * Run from the repo root: `node packages/engine/tools/mutate-discriminators.mjs`
 *
 * WHY THIS FILE EXISTS, and why it matters more here than usual. This card's
 * whole purpose is that a measurement nobody can re-run is not evidence — the
 * jitter finding at DECISIONS :6386 came from a script that no longer exists,
 * which is how the project's headline lever ended up resting on numbers nobody
 * can reproduce. Shipping its replacement with unaudited tests would repeat the
 * mistake one level up: the numbers would be reproducible and the guarantees
 * that they are CORRECT would not be. A test that stays green when the thing it
 * checks is broken is a liar (:5348 rule 4).
 *
 * SCOPE, per Kd's ruling at :5857 (rule 4a). This card changes no server
 * behaviour, so no database mutants. What it does produce is the numbers a
 * RULING will be made on, which sits squarely in that ruling's "numbers a user
 * sees" row — arguably above it, since a wrong number here becomes a threshold
 * baked into the app.
 *
 * EVERY STEP IS CHECKED, NOT ASSUMED — the class fixes from the web harnesses
 * are inherited wholesale rather than relearned (:4855, :5199, :5748, :6277):
 *   - a mutation whose anchor matches nothing ABORTS (a drifted anchor is a
 *     broken instrument, never a missing test)
 *   - a mutation naming a file outside TARGETS ABORTS (:5199 — the run that
 *     damaged a file it never restored)
 *   - a suite that produced no test tally ABORTS (a suite that never ran is not
 *     a RED — :2614)
 *   - the restore must reproduce the original sha256, checked after EVERY
 *     mutant, before the next one can stack on top of it
 *   - a RUNNER fault (ENOBUFS, signal, timeout, missing corepack) is NOT a red:
 *     only a numeric non-zero exit is a test result. Held and thrown AFTER the
 *     restore, never instead of it (:5199's defect, re-created once by the fix
 *     for a different one)
 *   - substrings are replaced through a utf8 read/write, never `sed -i`, which
 *     rewrites this repo's CRLF files wholesale (:4267)
 *
 * NO MUTANT IS EXPECTED ALIVE. An `expectAlive` row is a factual claim and V1
 * binds it exactly like a count (:6277) — if one survives, the answer is a test,
 * not an explanation written into this file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const TARGETS = {
  discriminators: {
    file: resolve(ROOT, 'packages/engine/scripts/discriminators.ts'),
    suite: 'test/discriminators.test.ts',
  },
};

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const MUTANTS = [
  {
    id: 'M1',
    why: 'drift stops being a RATE — a slow camera would read as a still body',
    expect: 'expresses drift as a RATE: half the time step, double the reading',
    from: '    here !== null && there !== null ? (dist(here, there) / torso) * perSecond : null;',
    to: '    here !== null && there !== null ? dist(here, there) / torso : null;',
  },
  {
    id: 'M2',
    why: 'drift stops being scale-normalised — someone further away reads as calmer',
    expect: 'is scale-invariant: the same motion twice as far from the camera reads the same',
    from: '    here !== null && there !== null ? (dist(here, there) / torso) * perSecond : null;',
    to: '    here !== null && there !== null ? dist(here, there) * perSecond : null;',
  },
  {
    id: 'M3',
    why: 'a degenerate torso returns 1 instead of null — a collapsed skeleton scores as measurable',
    expect: 'returns null when every landmark has collapsed to one point',
    from: '  return d > MIN_TORSO ? d : null;',
    to: '  return d > MIN_TORSO ? d : 1;',
  },
  {
    id: 'M4',
    why: 'the gap rule goes — motion is measured ACROSS a lost pose, inflating it',
    expect: 'skips a pair whose frames are further apart than the gap allowance',
    from: '  if (!(dtMs > 0) || dtMs > maxGapMs) return { ...NOTHING, limb_asymmetry: limbAsymmetry };',
    to: '  if (!(dtMs > 0)) return { ...NOTHING, limb_asymmetry: limbAsymmetry };',
  },
  {
    id: 'M5',
    why: 'the window averages instead of taking the median — one glitch trips the gate',
    expect: 'takes the median, so one spiking frame cannot trip a gate',
    from: '    out.push(quantile(bucket, 0.5));',
    to: '    out.push(bucket.reduce((a, b) => a + b, 0) / bucket.length);',
  },
  {
    id: 'M6',
    why: 'the window reports a confident number built from one reading',
    expect: 'stays null until the window holds enough real readings',
    from: '    if (bucket.length < need) {',
    to: '    if (bucket.length < 1) {',
  },
  {
    id: 'M7',
    why: 'ties score as full wins — a constant, worthless signal would report 1.00 separation',
    expect: 'counts ties as half, so a constant signal scores 0.5 and not 1',
    from: '    wins += below + equal / 2;',
    to: '    wins += below + equal;',
  },
  {
    id: 'M8',
    why: 'the cut-off is taken from the FURNITURE pile while claiming to bound the user cost',
    expect: 'pins the cut-off by the PERSON cost and reports the furniture caught',
    from: '  const cutoff = quantile(p, 1 - maxPersonRejected);',
    to: '  const cutoff = quantile(n, 1 - maxPersonRejected);',
  },
  {
    id: 'M9',
    why: 'the reported cost is off by the boundary — an understated harm to real users',
    expect: 'pins the cut-off by the PERSON cost and reports the furniture caught',
    from: '  for (const v of sorted) if (v > cutoff) n++;',
    to: '  for (const v of sorted) if (v >= cutoff) n++;',
  },
  {
    id: 'M10',
    why: 'an unmeasurable frame reports 0 instead of null — "no reading" becomes "perfectly still"',
    expect: 'reports nothing measurable on the first frame of a clip',
    from: '  centre_drift: null,\n  bone_stretch: null,',
    to: '  centre_drift: 0,\n  bone_stretch: null,',
  },
  {
    id: 'M11',
    why: 'bone stretch keeps its sign — a limb growing and shrinking cancels to nothing',
    expect: 'separates a rigid moving body from a re-guessed skeleton, on every signal',
    from: '    stretchSum += Math.abs(now - before) / torso;',
    to: '    stretchSum += (now - before) / torso;',
  },
];

const abort = (msg) => {
  console.error(`\nABORT — ${msg}`);
  process.exit(2);
};

// :5199 — a mutation naming a file outside TARGETS damaged it and was never
// restored, while the harness's own closing check printed PASS. Checked up
// front for the WHOLE table, before a single byte is written.
for (const m of MUTANTS) {
  if (!Object.hasOwn(TARGETS, m.target ?? 'discriminators')) {
    abort(`${m.id}: names target '${m.target}', which is not in TARGETS. Nothing has been written yet.`);
  }
}

const originals = new Map(
  Object.entries(TARGETS).map(([k, t]) => [k, { sha: sha(t.file), text: readFileSync(t.file, 'utf8') }]),
);

// A GREEN BASELINE FIRST (:2614). Without it "RED" cannot tell a caught mutant
// from a suite that was already failing before this harness touched anything.
console.log('baseline (unmutated) ...');
try {
  execSync(`corepack pnpm --filter @app/engine exec vitest run ${TARGETS.discriminators.suite}`, {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });
} catch {
  abort('the suite is RED before any mutation. Every verdict below would be meaningless.');
}
console.log('baseline GREEN\n');

const results = [];
for (const m of MUTANTS) {
  const key = m.target ?? 'discriminators';
  const target = TARGETS[key];
  const original = originals.get(key);
  const mutated = original.text.replace(m.from, m.to);
  if (mutated === original.text) {
    abort(`${m.id}: its anchor matched nothing. The mutation would have been a no-op, which reports as a missing test. Re-anchor it against the current file.`);
  }
  writeFileSync(target.file, mutated);

  let out = '';
  let suiteFailed = false;
  let runnerFault = null;
  try {
    out = execSync(
      `corepack pnpm --filter @app/engine exec vitest run ${target.suite} -t ${JSON.stringify(m.expect)}`,
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

  // RESTORE FIRST, ALWAYS — an abort from inside the catch would leave the file
  // mutated on disk, which is :5199's exact defect.
  writeFileSync(target.file, original.text);
  if (runnerFault !== null) {
    if (sha(target.file) !== original.sha) abort(`${m.id}: the runner failed AND the restore did not reproduce the original bytes — fix the tree by hand.`);
    abort(`${m.id}: the RUNNER itself failed, which is NOT a test result — ${runnerFault}`);
  }
  if (sha(target.file) !== original.sha) {
    abort(`${m.id}: the restore did NOT reproduce the original bytes. The working tree is dirty — fix it before running anything else.`);
  }

  // Strip the WHOLE escape sequence, ESC included. Dropping only the `[NNm`
  // tail leaves a bare  sitting between "Tests" and its count, so the
  // tally regex below never matches and every run aborts as "proves nothing".
  // Caught by this harness aborting rather than scoring a false RED — which is
  // the fail-safe direction, and the reason the tally guard exists at all.
  const clean = out.replace(new RegExp(String.fromCharCode(27) + String.raw`[[0-9;]*m`, "g"), "");
  const ran = /Tests\s+(?:\d+ failed \| )?\d+ (?:passed|failed)/.test(clean) && !/No test files found/.test(clean);
  if (!ran) abort(`${m.id}: the suite produced no test tally, so this run proves nothing. Its \`expect\` name probably matches no test.`);

  const verdict = suiteFailed ? 'RED' : 'ALIVE';
  const ok = m.expectAlive ? verdict === 'ALIVE' : verdict === 'RED';
  results.push({ ...m, verdict, ok });
  console.log(`${m.id.padEnd(4)} ${verdict.padEnd(5)} ${ok ? 'as expected' : 'UNEXPECTED'}  ${m.why}`);
}

const bad = results.filter((r) => !r.ok);
console.log('\n--- summary ---');
// Every figure DERIVED — a hardcoded count keeps reading as true for a round
// after it stops being (:6277).
const distinct = new Set(MUTANTS.map((m) => `${m.from}→${m.to}`)).size;
console.log(
  `${results.length} runs over ${distinct} distinct mutations · ` +
  `${results.filter((r) => r.verdict === 'RED').length} RED · ` +
  `${results.filter((r) => r.verdict === 'ALIVE').length} ALIVE (${MUTANTS.filter((m) => m.expectAlive).length} expected) · 0 never ran`,
);
console.log('restore verified byte-exact (sha256) after every mutant');
if (bad.length) {
  console.error(`\n${bad.length} mutant(s) did not match expectation: ${bad.map((b) => b.id).join(', ')}`);
  process.exit(1);
}
console.log('every mutant matched its expectation');
