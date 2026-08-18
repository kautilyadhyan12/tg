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
  page: {
    file: resolve(ROOT, 'apps/web/src/pages/ActiveWorkout.jsx'),
    suite: 'src/pages/activeWorkout.render.test.jsx',
  },
  // The file that CHOOSES the model, audited against the contract suite rather
  // than its own — because the thing that can go wrong is not poseTuning being
  // internally wrong, it is poseTuning and the BUILD SCRIPT disagreeing about
  // which model exists. `poseTuning.test.js` cannot see that; only the contract
  // suite reads both sides.
  tuning: {
    file: resolve(ROOT, 'apps/web/src/dev/poseTuning.js'),
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
    // RE-ANCHORED 2026-08-18 (T3 round 3, L-1). Round 1's expiry fix hoisted
    // `this._t` into a local `t`, so this anchor matched nothing and ABORTED the
    // sweep here — taking PA7-PA12, the whole meter group, with it. Every "22
    // RED 0 ALIVE" figure quoted since has come from a scratchpad script rather
    // than from this file (:5199: "I measured it RED" and "the committed harness
    // measures it RED" are different claims).
    from: '    if (t.length < 2) return null;',
    to: '    if (t.length < 2) return 0;',
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
    // RE-ANCHORED 2026-08-18 with PA7, same cause: the count is now taken from
    // the frames SURVIVING the read-time cutoff, not from the whole array.
    from: '    return ((count - 1) * 1000) / span;',
    to: '    return ((count - 1) * 1000) / this._windowMs;',
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
    why: 'LITE stops being bundled — the model every past measurement used can no longer be replayed offline',
    expect: 'keeps LITE bundled as well, so the old measurements stay reproducible offline',
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

  // -- ADDED 2026-08-17 WITH THE MODEL SWAP -----------------------------------
  //
  // `full` became the default (Part 6 §3.3, Kd's ruling). The Critical/High
  // failure is not that the wrong model loads -- it is that the DEFAULT and the
  // BUILD SCRIPT can disagree in total silence: the app asks for a `.task` the
  // build never wrote, Vite answers a missing `public/` file with index.html at
  // 200, MediaPipe fails on a web page where it expected a zip, and every camera
  // workout quietly downloads 9.4 MB from Google. That is the original defect,
  // and the swap is exactly the kind of edit that reintroduces it.
  {
    id: 'PA23',
    target: 'tuning',
    why: 'the shipped default names a model nobody bundles -- every camera workout silently needs the internet again',
    expect: 'THE SHIPPED DEFAULT IS ONE OF THE MODELS THE BUILD WRITES',
    from: "  model: 'full',",
    to: "  model: 'heavy',",
  },
  {
    id: 'PA24',
    target: 'script',
    why: 'the DEFAULT model is written where the app never looks -- the same silence, from the build side',
    expect: 'THE SHIPPED DEFAULT IS ONE OF THE MODELS THE BUILD WRITES',
    from: "    dest: 'models/pose_landmarker_full.task',",
    to: "    dest: 'models/pose_full.task',",
  },
  {
    id: 'PA25',
    target: 'script',
    why: 'a bundled model is fetched from a DIFFERENT url than the app falls back to -- bundle and fallback become two different models',
    expect: 'fetches EVERY bundled model from the same URL the app would fall back to',
    from: "      'pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',",
    to: "      'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',",
  },

  // ── ADDED 2026-08-17: THE CEILING, AND THE ROW THAT SHOWS IT ───────────────
  //
  // What is Critical/High in this batch is one number a user can read
  // (:5807 — on screen AND wrong). The camera-rate row exists because the first
  // reading of the delivered rate in this project's life, 9.2–12.2 on Kd's own
  // desktop, was taken off a dev-only console line and read as his machine
  // falling short — when 12.0 is the ceiling this app imposes on ALL hardware.
  // Every row below guards a way that row can put a true-looking number in
  // front of him and mean the wrong thing.
  {
    id: 'PA18',
    target: 'hook',
    why: 'the ceiling is no longer the throttle\'s own arithmetic — the row prints a limit the app does not have',
    expect: 'throttle CANNOT reach 15',
    from: 'const FEED_INTERVAL_MS = 67;',
    to: 'const FEED_INTERVAL_MS = 40;',
  },
  {
    id: 'PA19',
    target: 'hook',
    why: 'MAX_FEED_HZ becomes the spec\'s 15 — the exact fiction this card was written to remove',
    expect: 'even an infinitely fast loop cannot reach 15',
    from: 'export const MAX_FEED_HZ = 1000 / FEED_INTERVAL_MS;',
    to: 'export const MAX_FEED_HZ = 15;',
  },
  {
    id: 'PA20',
    target: 'page',
    why: 'the rate is shown ALONE — "12.0/s" beside a spec that says 15 is how the wrong conclusion was reached the first time',
    expect: 'shows the delivered rate against the ceiling the app imposes',
    from: "                  value={hz == null ? '—' : `${hz.toFixed(1)} of ${MAX_FEED_HZ.toFixed(1)}/s`}",
    to: "                  value={hz == null ? '—' : `${hz.toFixed(1)}/s`}",
  },
  {
    id: 'PA21',
    target: 'page',
    why: 'no reading is drawn as 0.0 — a camera delivering nothing, on a workout that has not started (:6749)',
    expect: 'draws a dash, not a zero, before there is a rate to show',
    from: "                  value={hz == null ? '—' : `${hz.toFixed(1)} of ${MAX_FEED_HZ.toFixed(1)}/s`}",
    to: '                  value={`${(hz ?? 0).toFixed(1)} of ${MAX_FEED_HZ.toFixed(1)}/s`}',
  },
  {
    id: 'PA22',
    target: 'page',
    why: 'the readout escapes onto the workout screen — a figure below the spec\'s 15 in front of every user, on every workout, explaining a fault that is not occurring',
    expect: 'lives behind the debug toggle, never on the workout screen itself',
    from: '          {showDebug && (() => {',
    to: '          {true && (() => {',
  },

  // ── ADDED 2026-08-18: THE TWO ENDS OF THE MEASUREMENT ─────────────────────
  //
  // Rounds 1 and 2 found the SAME defect in `hz()` twice — the reading
  // describing a stretch of time it had no evidence about. Round 1 fixed WHICH
  // frames count; round 2 fixed WHAT THEY ARE DIVIDED BY. Round 1's half has
  // been guarded since (PA10 and the expiry tests); round 2's had no committed
  // mutant at all, which is how a one-line fix to the most-defective function in
  // this file shipped with its protection living in a scratchpad.
  {
    id: 'PA26',
    target: 'meter',
    why: 'round 2\'s defect returns — the span ends at the last FRAME, so a gap at the END is invisible and a dying feed still reads 14.9',
    expect: 'DECAYS as the silence grows, instead of holding the last rate until it blanks',
    from: '    const span = now - t[first];',
    to: '    const span = t[t.length - 1] - t[first];',
  },
  {
    id: 'PA27',
    target: 'meter',
    why: 'a backwards clock reads as MORE frames than the span can hold — a rate above the ceiling printed beside it',
    expect: 'says NULL when the clock runs backwards, rather than a rate above the ceiling',
    from: '    if (now < t[t.length - 1]) return null;\n',
    to: '',
  },
];

const abort = (msg) => {
  console.error(`\nABORT — ${msg}`);
  process.exit(2);
};

const originals = new Map(
  Object.entries(TARGETS).map(([k, t]) => [k, { sha: sha(t.file), text: readFileSync(t.file, 'utf8') }]),
);

// -- ANCHORS ARE MATCHED IN LF, WHATEVER THE FILE ON DISK USES ---------------
//
// MEASURED 2026-08-17, and it had already cost this harness a completed run:
// `poseTuning.js` is checked out CRLF on Windows, every anchor here is authored
// with a bare newline, and a multi-line anchor therefore matched NOTHING.
//
// Characters are built with String.fromCharCode for the same reason the ANSI
// strip below is: a backslash escape in this file has to survive being written
// by a tool, and the first attempt at these lines did not.
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const toLf = (s) => s.split(CR + LF).join(LF);

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
  // EVERY ANCHOR IS CHECKED FOR THE WHOLE TABLE, HERE, BEFORE A BYTE IS
  // WRITTEN — :5348 rule 5, a permanent guard for a class this project has now
  // recorded FIVE times (:5618 two anchors on a deleted line · :6959 M9 ·
  // :7298 PG12 · :8610 a fix moved a line M60's anchor spanned · this file's
  // own PA7/PA9, broken by round 1's fix and unnoticed for two rounds).
  //
  // THE PER-MUTANT CHECK BELOW IS NOT ENOUGH AND THAT IS THE WHOLE POINT: it
  // fires in the MIDDLE of a sweep, so the run dies after the mutants before it
  // have passed and before the ones after it have run — which reads as progress.
  // PA7 drifting took PA7-PA12 with it, the six rows guarding the number the
  // ladder will step down on, and the abort looked like a tidy failure rather
  // than the loss of a whole group. :5618's class fix, which this harness never
  // received; the sibling `mutate-pose-tuning.mjs` still has not.
  const lfText = toLf(originals.get(m.target).text);
  if (!lfText.includes(toLf(m.from))) {
    abort(`${m.id}: its anchor matches nothing in ${m.target}. Nothing has been written yet, and NO mutant has run — re-anchor it against the current file before trusting any figure from this harness.`);
  }
}

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
  // LF normalisation is hoisted above the pre-flight (see `toLf`), because the
  // anchor check up there needs the same treatment this line does -- `P2`'s
  // CRLF drift is exactly what a whole-table check has to be able to see.
  // :4267's class (`read before trusting any N-mutants-0-alive table produced
  // on Windows`) from the AUTHORING side rather than the `sed -i` side.
  //
  // The mutant is written back in the file's own convention so nothing else
  // shifts, and the RESTORE is unaffected either way -- it replays
  // `original.text` byte for byte, which is what the sha256 check proves.
  const isCrlf = original.text.includes(CR + LF);
  const lfText = toLf(original.text);
  const lfMutated = lfText.replace(toLf(m.from), toLf(m.to));
  const mutated = isCrlf ? lfMutated.split(LF).join(CR + LF) : lfMutated;
  if (lfMutated === lfText) {
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
