/**
 * Mutation audit — the recorder's slug, and the dev pose settings (card 2).
 * Run from the repo root: `node apps/web/tools/mutate-pose-tuning.mjs`
 *
 * WHY THESE GUARANTEES AND NOT OTHERS (:5857 rule 4a — the audit is scoped by
 * severity, and slow mutants are spent only on Critical/High). Nothing here is
 * a database, but two of these rows are user-facing in the strongest sense:
 *   - `POSE_DEFAULTS` and the "absent is not zero" guard decide what EVERY
 *     user's camera is configured with. The bug this file's own tests caught —
 *     `Number(null) === 0`, so an unmentioned dial read as 0.0 — silently set
 *     the model to its most credulous setting and recorded that as deliberate.
 *   - the slug decides whether the measuring instrument works at all. It has
 *     already failed once, silently, on all five of Kd's clips.
 * The rest guard card 3's comparison: a clip that misreports which settings
 * produced it is worse than one with none, because it will be believed.
 *
 * The class fixes are inherited, not relearned (:4855, :5199, :5748, :6277):
 * anchors that match nothing ABORT · targets outside TARGETS ABORT · a suite
 * with no tally ABORTS · restores are sha256-verified after EVERY mutant ·
 * a RUNNER fault is not a RED and is thrown AFTER the restore · substrings are
 * replaced through a utf8 read/write, never `sed -i` (CRLF, :4267) · the ANSI
 * strip includes the ESC byte, which the engine harness got wrong first time
 * and reported as "proves nothing" rather than a false RED.
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
  tuning: {
    file: resolve(ROOT, 'apps/web/src/dev/poseTuning.js'),
    suite: 'src/dev/poseTuning.test.js',
  },
  recorder: {
    file: resolve(ROOT, 'apps/web/src/dev/traceRecorder.js'),
    suite: 'src/dev/traceRecorder.test.js',
  },
};

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const MUTANTS = [
  {
    id: 'P1',
    target: 'tuning',
    why: 'ABSENT IS ZERO again — every unmentioned dial reads 0.0 and the model is set to trust anything',
    expect: 'returns exactly the shipped defaults when the URL says nothing',
    from: `  return raw !== null && raw !== undefined && raw !== '';`,
    to: '  return true;',
  },
  {
    id: 'P2',
    target: 'tuning',
    why: 'an out-of-range value clamps to an edge instead of falling back — a typo becomes a real setting',
    expect: 'falls back to the default for a value out of range, never clamps silently to an edge',
    from: '  if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;\n  return n;',
    to: '  if (!Number.isFinite(n)) return fallback;\n  return Math.min(1, Math.max(0, n));',
  },
  {
    id: 'P3',
    target: 'tuning',
    why: 'numPoses loses its ceiling — an absurd value costs a landmark pass per pose against the §3.4 budget',
    expect: 'refuses a non-integer or absurd numPoses',
    from: '  if (!Number.isInteger(n) || n < 1 || n > 4) return fallback;',
    to: '  if (!Number.isInteger(n) || n < 1) return fallback;',
  },
  {
    id: 'P4',
    target: 'tuning',
    why: 'any string is accepted as a model name — a typo fetches nothing and the camera silently dies',
    expect: 'accepts ONLY the three published model names',
    from: "    model: model !== null && Object.hasOwn(MODEL_FILES, model) ? model : POSE_DEFAULTS.model,",
    to: '    model: model ?? POSE_DEFAULTS.model,',
  },
  {
    id: 'P5',
    target: 'tuning',
    why: 'the shipped default model changes — every user downloads a different model with no ruling',
    expect: 'returns exactly the shipped defaults when the URL says nothing',
    // Reversed on 2026-08-17 when Kd ruled `full` the default (Part 6 §3.3).
    // The mutant is unchanged in MEANING — it silently swaps the model every
    // user downloads — only in direction.
    from: "  model: 'full',",
    to: "  model: 'lite',",
  },
  {
    id: 'P6',
    target: 'tuning',
    why: 'the model URL is built from the raw request rather than the frozen map',
    expect: 'falls back to the SHIPPED DEFAULT for an unknown variant, never to a bad path',
    from: '  const file = MODEL_FILES[model] ?? MODEL_FILES[POSE_DEFAULTS.model];',
    to: '  const file = MODEL_FILES[model] ?? `pose_landmarker_${model}`;',
  },
  {
    id: 'P7',
    target: 'tuning',
    why: 'the widget stops warning that a run is tuned — a clip gets recorded believed to be default',
    expect: 'is true when ANY single dial has moved',
    from: '  return Object.keys(POSE_DEFAULTS).some((k) => tuning[k] !== POSE_DEFAULTS[k]);',
    to: '  return false;',
  },
  {
    id: 'T1',
    target: 'recorder',
    why: 'THE ORIGINAL DEFECT: the display name goes back into the header and measure-pose cannot load the definition',
    expect: 'stamps the DEFINITION ID in the header, not the display name',
    from: '  return getDefinition(exercise)?.key ?? exercise;',
    to: '  return exercise;',
  },
  {
    id: 'T2',
    target: 'recorder',
    why: 'an exercise with no definition stamps undefined instead of its own slug',
    expect: 'leaves an exercise with no definition alone rather than inventing a key',
    from: '  return getDefinition(exercise)?.key ?? exercise;',
    to: '  return getDefinition(exercise)?.key;',
  },
  {
    id: 'T3',
    target: 'recorder',
    why: 'settings are read at STOP — a URL edited mid-clip relabels a recording that already happened',
    expect: 'captures the settings at START, so a mid-clip change cannot relabel it',
    from: '    provider: state.tuning === null ? undefined : { ...state.tuning },',
    to: '    provider: readPoseTuning(),',
  },
  {
    id: 'T4',
    target: 'recorder',
    why: 'the header carries no settings at all — card 3 rests on filenames',
    expect: 'records WHICH camera settings produced the clip',
    from: '    provider: state.tuning === null ? undefined : { ...state.tuning },',
    to: '    provider: undefined,',
  },
  {
    id: 'P8',
    target: 'tuning',
    why: 'a page load naming NOTHING overwrites the capture — every navigation after the first wipes the settings',
    expect: 'a later page load naming NOTHING does not wipe what was captured',
    from: '  if (store === null || !hasTuningParams(search)) return;',
    to: '  if (store === null) return;',
  },
  {
    id: 'P9',
    target: 'tuning',
    why: 'stored settings are trusted unvalidated — hand-edited storage reconfigures the model',
    expect: 're-validates on the way OUT',
    from: '    model: Object.hasOwn(MODEL_FILES, parsed.model) ? parsed.model : POSE_DEFAULTS.model,',
    to: '    model: parsed.model,',
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
  // -- ANCHORS ARE MATCHED IN LF, WHATEVER THE FILE ON DISK USES ------------
  //
  // MEASURED 2026-08-17, and it had already cost this harness a completed run:
  // `poseTuning.js` is checked out CRLF on Windows, every anchor here is
  // authored with a bare newline, and a multi-line anchor therefore matched
  // NOTHING. P2's did exactly that, and only the `matched nothing` guard turned
  // it into an ABORT rather than a confident missing-test verdict -- so this
  // harness had never run end to end on this machine. `mutate-pose-assets.mjs`
  // escaped it only because its targets happen to have been written LF-only,
  // which is luck rather than a property, so both files carry this.
  //
  // :4267's class (`read before trusting any N-mutants-0-alive table produced
  // on Windows`) from the AUTHORING side rather than the `sed -i` side.
  //
  // Characters are built with String.fromCharCode for the same reason the ANSI
  // strip below is: a backslash escape in this file has to survive being
  // written by a tool, and the first attempt at these four lines did not.
  //
  // The mutant is written back in the file's own convention so nothing else
  // shifts, and the RESTORE is unaffected either way -- it replays
  // `original.text` byte for byte, which is what the sha256 check proves.
  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);
  const toLf = (s) => s.split(CR + LF).join(LF);
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
  if (!tallied(out)) abort(`${m.id}: the suite produced no test tally, so this run proves nothing. Its \`expect\` name probably matches no test.`);

  const verdict = suiteFailed ? 'RED' : 'ALIVE';
  const ok = m.expectAlive ? verdict === 'ALIVE' : verdict === 'RED';
  results.push({ ...m, verdict, ok });
  console.log(`${m.id.padEnd(4)} ${verdict.padEnd(5)} ${ok ? 'as expected' : 'UNEXPECTED'}  ${m.why}`);
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
