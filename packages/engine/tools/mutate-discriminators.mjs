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
    file: resolve(ROOT, 'packages/engine/src/scene/discriminators.ts'),
    suite: 'test/discriminators.test.ts',
  },
  // Card 4. The file moved out of scripts/ and into src/ because the gate now
  // SHIPS this arithmetic; the gate itself is its own target because a mutant
  // that damages it must run the suite that claims to protect it, not another.
  personGate: {
    file: resolve(ROOT, 'packages/engine/src/scene/personGate.ts'),
    suite: 'test/personGate.test.ts',
  },
};

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/**
 * A test NAME turned into a shell-quoted regex that matches only itself.
 *
 * TWO SEPARATE TRAPS, both measured here rather than reasoned about:
 *  1. vitest `-t` COMPILES its argument, so a test named "reset() forgets ..."
 *     is a regex containing an empty group and matches nothing.
 *  2. `JSON.stringify` then DOUBLES the escaping backslashes, so `0\.5` reaches
 *     vitest as `0\\.5` — which matches nothing either, one trap fixed into
 *     the next. Quote by hand instead; these names contain no double quotes,
 *     and one that did would be escaped below.
 * Both failures aborted the run rather than scoring a false RED, which is the
 * direction the tally guard exists for.
 */
const pattern = (s) => `"${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/"/g, '\\"')}"`;

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
    from: '    return quantile(bucket, 0.5);',
    to: '    return bucket.reduce((a, b) => a + b, 0) / bucket.length;',
  },
  {
    id: 'M6',
    why: 'the window reports a confident number built from one reading',
    expect: 'stays null until the window holds enough real readings',
    from: '    if (bucket.length < this.need) {',
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
  {
    id: 'M12',
    why: 'the rolling window never forgets — one bad stretch blocks the rest of the set',
    expect: 'stops blocking once the body is back, rather than latching for the set',
    target: 'discriminators',
    suite: 'test/personGate.test.ts',
    from: '    if (this.recent.length > this.size) this.recent.shift();',
    to: '    if (this.recent.length > this.size * 1000) this.recent.shift();',
  },

  // ── the gate itself (card 4) ────────────────────────────────────────────────
  {
    id: 'P1',
    why: 'NO READING becomes BLOCK — the app stops counting on no evidence at all',
    expect: 'counts — a gate with no reading yet never blocks',
    target: 'personGate',
    from: '      fired.push(value !== null && value > check.rule.cutoff);',
    to: '      fired.push(value === null || value > check.rule.cutoff);',
  },
  {
    id: 'P2',
    why: 'the comparison runs backwards — every real user is rejected and every chair passes',
    expect: 'blocks the fake skeleton and passes the real body at one shared cut-off',
    target: 'personGate',
    from: '      fired.push(value !== null && value > check.rule.cutoff);',
    to: '      fired.push(value !== null && value < check.rule.cutoff);',
  },
  {
    id: 'P3',
    why: '"block only if BOTH fire" silently behaves as "block if either does"',
    expect: "'all' does not block unless every rule fires",
    target: 'personGate',
    from: '    const blocked = this.mode === "any" ? fired.includes(true) : !fired.includes(false);',
    to: '    const blocked = fired.includes(true);',
  },
  {
    id: 'P4',
    why: 'reset() leaves the previous frame behind — a new set opens measured against the old one',
    expect: 'reset() forgets the previous frame, so a new set is not measured against the old one',
    target: 'personGate',
    from: '    this.previous = null;\n    for (const check of this.checks) check.roll.reset();',
    to: '    for (const check of this.checks) check.roll.reset();',
  },
  {
    id: 'P5',
    why: 'no frame is ever remembered, so nothing is ever measured and the gate is inert',
    expect: 'blocks the fake skeleton and passes the real body at one shared cut-off',
    target: 'personGate',
    from: '    this.previous = frame;',
    to: '    this.previous = null;',
  },
  {
    id: 'P6',
    why: 'a gate with no rules is accepted and answers "never block" while looking like a gate',
    expect: "refuses to be built with no rules rather than answering 'never block'",
    target: 'personGate',
    from: '    if (options.rules.length === 0) {',
    to: '    if (options.rules.length < 0) {',
  },
];

const abort = (msg) => {
  console.error(`\nABORT — ${msg}`);
  process.exit(2);
};

// :5199 — a mutation naming a file outside TARGETS damaged it and was never
// restored, while the harness's own closing check printed PASS. Checked up
// front for the WHOLE table, before a single byte is written.
const SUITES = new Set(Object.values(TARGETS).map((t) => t.suite));
for (const m of MUTANTS) {
  if (!Object.hasOwn(TARGETS, m.target ?? 'discriminators')) {
    abort(`${m.id}: names target '${m.target}', which is not in TARGETS. Nothing has been written yet.`);
  }
  // A mutant may be PROTECTED by a suite other than its own file's — card 4's
  // rolling window lives in one file and is guarded behaviourally from the
  // gate's suite. Without this the harness runs the wrong suite, finds no test
  // of that name, and aborts as "proves nothing" (it did, first run). Same
  // shape as the per-mutant `target` :6277 added to the web harness.
  if (m.suite !== undefined && !SUITES.has(m.suite)) {
    abort(`${m.id}: names suite '${m.suite}', which no target declares. Nothing has been written yet.`);
  }
}

const originals = new Map(
  Object.entries(TARGETS).map(([k, t]) => [k, { sha: sha(t.file), text: readFileSync(t.file, 'utf8') }]),
);

// A GREEN BASELINE FIRST (:2614). Without it "RED" cannot tell a caught mutant
// from a suite that was already failing before this harness touched anything.
// EVERY target's suite, not just the first one. A baseline that skips a suite
// cannot tell that suite's caught mutant from a suite that was already failing —
// which is the same hole :2614 found, re-opened by adding a second target.
console.log('baseline (unmutated) ...');
for (const [key, t] of Object.entries(TARGETS)) {
  try {
    execSync(`corepack pnpm --filter @app/engine exec vitest run ${t.suite}`, {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    abort(`${key}: the suite is RED before any mutation. Every verdict below would be meaningless.`);
  }
  console.log(`  baseline GREEN — ${t.suite}`);
}
console.log('');

const results = [];
for (const m of MUTANTS) {
  const key = m.target ?? 'discriminators';
  const target = TARGETS[key];
  const suite = m.suite ?? target.suite;
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
      // `expect` means the LITERAL test name — see `pattern` for the two ways
      // that went wrong. Fixed as a class rather than by renaming one test,
      // because the next name with a bracket in it would fail the same way.
      `corepack pnpm --filter @app/engine exec vitest run ${suite} -t ${pattern(m.expect)}`,
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
