/**
 * Mutation audit — the camera's bundled assets and the delivered-frames meter.
 * Run from the repo root: `node apps/web/tools/mutate-pose-assets.mjs`
 *
 * WHY THESE GUARANTEES AND NOT OTHERS (:5857 rule 4a — the audit is scoped by
 * severity, and this is a web-only card, so no database mutants). What is
 * Critical/High here is one promise and one number:
 *
 *   - **"this workout survives losing the network."** Every row in the `hook`
 *     and `contract` groups guards a way that promise can be false while
 *     everything still looks fine — the app going to the CDN first, going there
 *     anyway, refusing to go there when it must, or REPORTING the wrong source.
 *     The last is the worst of the four: `poseAssets` is what the smoke reads,
 *     so a mutant that always says "bundled" turns the evidence into a lie
 *     (:5807 — the test is on screen AND wrong, and evidence counts).
 *   - **the rate the §3.6 ladder will step down on.** The `meter` rows guard the
 *     two ways it lies: answering a NUMBER with no evidence, and answering a
 *     rate for a stretch in which no frames arrived. Either one steps a healthy
 *     phone down to hand counting.
 *
 * Deliberately NOT mutated (same rule): comments, the log wording, the dev-only
 * throughput line, and the ported model URLs — `poseTuning.test.js` already
 * pins those byte for byte and they are a table, not a decision.
 *
 * The class fixes are inherited, not relearned (:4855, :5199, :5748, :6277):
 * anchors that match nothing ABORT · targets outside TARGETS ABORT · a suite
 * with no tally ABORTS · restores are sha256-verified after EVERY mutant ·
 * a RUNNER fault is not a RED and is thrown AFTER the restore · substrings are
 * replaced through a utf8 read/write, never `sed -i` (CRLF, :4267) · the ANSI
 * strip includes the ESC byte.
 *
 * NO MUTANT IS EXPECTED ALIVE.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const TARGETS = {
  hook: {
    file: resolve(ROOT, 'apps/web/src/hooks/usePoseDetection.js'),
    suite: 'src/hooks/usePoseDetection.test.js',
  },
  meter: {
    file: resolve(ROOT, 'apps/web/src/engine/poseThroughput.js'),
    suite: 'src/engine/poseThroughput.test.js',
  },
  script: {
    file: resolve(ROOT, 'apps/web/tools/fetch-pose-assets.mjs'),
    suite: 'src/hooks/poseAssets.contract.test.js',
  },
};

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const MUTANTS = [
  // ── The promise: a camera workout survives losing the network ──────────────
  {
    id: 'PA1',
    target: 'hook',
    why: 'the CDN is tried FIRST — the bundle becomes a fallback nobody reaches',
    expect: 'asks for the bundled runtime and the bundled model FIRST',
    from: '          landmarker = await attempt(LOCAL_WASM_BASE, LOCAL_MODEL);',
    to: '          landmarker = await attempt(REMOTE_WASM_BASE, REMOTE_MODEL);',
  },
  {
    id: 'PA2',
    target: 'hook',
    why: 'THE ORIGINAL DEFECT: the runtime always comes off the internet, whatever the bundle holds',
    expect: 'NEVER TOUCHES THE NETWORK when the bundle works',
    from: '          landmarker = await attempt(LOCAL_WASM_BASE, LOCAL_MODEL);',
    to: '          landmarker = await attempt(REMOTE_WASM_BASE, LOCAL_MODEL);',
  },
  {
    id: 'PA3',
    target: 'hook',
    why: 'the source is always reported as bundled — the smoke reads "offline-capable" off a workout that is not',
    expect: 'falls back when the bundled RUNTIME is missing, not just the model',
    from: "          source = 'network';",
    to: "          source = 'bundled';",
  },
  {
    id: 'PA4',
    target: 'hook',
    why: 'a missing bundle kills the camera outright instead of degrading to the internet',
    expect: 'falls back to the internet when the bundled MODEL is missing — the real defect',
    from: '          landmarker = await attempt(REMOTE_WASM_BASE, REMOTE_MODEL);',
    to: '          throw bundledErr;',
  },
  {
    id: 'PA5',
    target: 'hook',
    why: 'the evidence is published before MediaPipe is ready — a smoke reads a source off a camera that has not loaded',
    expect: 'reports NOTHING until MediaPipe is actually ready',
    from: "  const [poseAssets, setPoseAssets] = useState(null);",
    to: "  const [poseAssets, setPoseAssets] = useState({ source: 'bundled', ms: 0 });",
  },

  // ── The number the ladder will read ────────────────────────────────────────
  {
    id: 'PA6',
    target: 'hook',
    why: 'the meter is never fed, so the ladder would step down on a rate that is always unknown',
    expect: 'reads back the rate the frames actually arrived at',
    from: '      throughputRef.current.push(now);\n',
    to: '',
  },
  {
    id: 'PA7',
    target: 'meter',
    why: 'an unmeasurable rate reads as ZERO — `Number(null) === 0` all over again (:6749)',
    expect: 'says NULL, never zero, before any frame',
    from: '    if (this._t.length < 2) return null;',
    to: '    if (this._t.length < 2) return 0;',
  },
  {
    id: 'PA8',
    target: 'meter',
    why: 'the span floor goes — the first two frames of every workout report a wild rate',
    expect: 'says NULL for two frames 1 ms apart, rather than 1000 Hz',
    from: '    if (span < this._minSpanMs) return null;',
    to: '',
  },
  {
    id: 'PA9',
    target: 'meter',
    why: 'divides by the WINDOW not the span — a machine keeping up is reported at a third of its rate',
    expect: 'divides by the SPAN OF THE FRAMES, not by the window length',
    from: '    return ((this._t.length - 1) * 1000) / span;',
    to: '    return ((this._t.length - 1) * 1000) / this._windowMs;',
  },
  {
    id: 'PA10',
    target: 'meter',
    why: 'old frames are never evicted, so a collapse in throughput never shows up',
    expect: 'forgets frames older than the window, so a rate follows a SLOWDOWN down',
    from: '    if (drop > 0) this._t.splice(0, drop);',
    to: '',
  },
  {
    id: 'PA11',
    target: 'meter',
    why: 'an out-of-order timestamp reverses the span (:7974 in the meter)',
    expect: 'drops an OUT-OF-ORDER timestamp rather than reversing the span',
    from: '    if (last !== undefined && t <= last) return;',
    to: '',
  },
  {
    id: 'PA12',
    target: 'meter',
    why: 'reset does nothing — a paused set is averaged with the one before and reads as a stall',
    // Metacharacter-free by necessity, not by taste — see the pre-flight check.
    expect: 'empties it, so a resumed set is not averaged with the one before',
    from: '    this._t = [];\n  }\n}',
    to: '  }\n}',
  },

  // ── The build script and the app agreeing about where the files are ────────
  {
    id: 'PA13',
    target: 'script',
    why: 'the model is written somewhere the app never looks — every workout silently goes back to the CDN',
    expect: 'is fetched to the exact path the shipped default resolves to',
    from: "    dest: 'models/pose_landmarker_lite.task',",
    to: "    dest: 'models/pose.task',",
  },
  {
    id: 'PA14',
    target: 'script',
    why: 'a THIRD MediaPipe version is bundled — the camera output changes, which this card promised it would not',
    expect: 'fetches the SAME MediaPipe build the fallback URL names',
    from: "export const MEDIAPIPE_VERSION = '0.10.21';",
    to: "export const MEDIAPIPE_VERSION = '0.10.35';",
  },
  {
    id: 'PA15',
    target: 'script',
    why: 'only the SIMD runtime ships — a browser that picks the other variant is stranded offline',
    expect: 'ships BOTH the SIMD and the non-SIMD variant',
    // Drops the non-SIMD pair while staying VALID JAVASCRIPT. The first draft
    // spliced an `[].concat(` in and produced a syntax error, which the module
    // cannot be imported through — so the suite emitted no tally at all and the
    // harness aborted. A mutant has to be code the file can still run, or it
    // tests the parser rather than the assertion.
    from: '  ...WASM_ASSETS.map((a) => ({',
    to: "  ...WASM_ASSETS.filter((a) => !a.file.includes('nosimd')).map((a) => ({",
  },
  {
    id: 'PA16',
    target: 'script',
    why: 'the digest check goes — a corrupt or truncated model is written and shipped as good',
    expect: 'REJECTS the right length with the wrong content',
    from: '  const got = sha256(buf);\n  if (got !== asset.sha256) {',
    to: '  const got = sha256(buf);\n  if (false) {',
  },
  {
    id: 'PA17',
    target: 'script',
    why: 'the length check goes — a truncated download passes as long as nobody hashes it',
    expect: 'REJECTS a truncated download, and says so in those words',
    from: '  if (buf.byteLength !== asset.bytes) {',
    to: '  if (false) {',
  },
];

const abort = (msg) => {
  console.error(`\nABORT — ${msg}`);
  process.exit(2);
};

// Checked for the WHOLE table before a byte is written (:5199).
for (const m of MUTANTS) {
  if (!Object.hasOwn(TARGETS, m.target)) {
    abort(`${m.id}: names target '${m.target}', which is not in TARGETS. Nothing has been written yet.`);
  }
  // `vitest -t` takes a REGEX, not a substring, so a name containing `()`, `+`,
  // `?` or `.` silently selects NOTHING.
  //
  // MEASURED ON THIS FILE'S FIRST RUN, at PA12: `reset() empties it, …` was read
  // as "reset", an empty group, then " empties it" — which no test is called —
  // so the mutant ran against an empty selection. It surfaced only because a run
  // with no tally ABORTS; without that it would have reported a confident ALIVE
  // against a test never given the chance to fail, which is the shape of every
  // unearned harness pass this project has recorded.
  //
  // Escaping was tried first and is WORSE: `JSON.stringify` re-escapes the
  // backslashes, so the shell receives `\\(` and the filter matches a literal
  // backslash. Refusing the character is the honest fix, and it fails here —
  // before any file is touched — rather than in the middle of a sweep.
  if (/[.*+?^${}()|[\]\\]/.test(m.expect)) {
    abort(`${m.id}: its \`expect\` contains a regex metacharacter (${m.expect}). vitest -t would select no test and the verdict would be meaningless. Use a metacharacter-free substring of the test name.`);
  }
}

const originals = new Map(
  Object.entries(TARGETS).map(([k, t]) => [k, { sha: sha(t.file), text: readFileSync(t.file, 'utf8') }]),
);

const STRIP_ANSI = new RegExp(String.fromCharCode(27) + String.raw`\[[0-9;]*m`, 'g');
const tallied = (out) => {
  const clean = out.replace(STRIP_ANSI, '');
  return /Tests\s+(?:\d+ failed \| )?\d+ (?:passed|failed)/.test(clean) && !/No test files found/.test(clean);
};

console.log('baseline (unmutated) ...');
for (const t of Object.values(TARGETS)) {
  try {
    execSync(`corepack pnpm --filter web exec vitest run ${t.suite}`, {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    abort(`${t.suite} is RED before any mutation. Every verdict below would be meaningless.`);
  }
}
console.log('baseline GREEN\n');

const results = [];
for (const m of MUTANTS) {
  const target = TARGETS[m.target];
  const original = originals.get(m.target);
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
      `corepack pnpm --filter web exec vitest run ${target.suite} -t ${JSON.stringify(m.expect)}`,
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

  // Restore FIRST, always (:5199).
  writeFileSync(target.file, original.text);
  if (runnerFault !== null) {
    if (sha(target.file) !== original.sha) abort(`${m.id}: the runner failed AND the restore did not reproduce the original bytes — fix the tree by hand.`);
    abort(`${m.id}: the RUNNER itself failed, which is NOT a test result — ${runnerFault}`);
  }
  if (sha(target.file) !== original.sha) {
    abort(`${m.id}: the restore did NOT reproduce the original bytes. The working tree is dirty — fix it before running anything else.`);
  }
  if (!tallied(out)) {
    // TWO CAUSES, and the message used to guess only the first — which sent
    // this file's own author looking for a missing test when PA15's mutation
    // was in fact a syntax error the module could not be imported through.
    abort(
      `${m.id}: the suite produced no test tally, so this run proves nothing. Either ` +
      `its \`expect\` matches no test, or the mutation is not valid JavaScript and the ` +
      `file failed to import. The runner output ends:\n${out.slice(-800)}`,
    );
  }

  const verdict = suiteFailed ? 'RED' : 'ALIVE';
  const ok = m.expectAlive ? verdict === 'ALIVE' : verdict === 'RED';
  results.push({ ...m, verdict, ok });
  console.log(`${m.id.padEnd(5)} ${verdict.padEnd(5)} ${ok ? 'as expected' : 'UNEXPECTED'}  ${m.why}`);
}

const bad = results.filter((r) => !r.ok);
console.log('\n--- summary ---');
const distinct = new Set(MUTANTS.map((m) => `${m.target}:${m.from}→${m.to}`)).size;
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
