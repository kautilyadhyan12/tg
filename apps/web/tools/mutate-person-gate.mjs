/**
 * Card 4 step 3 audit — the person check, its ruled numbers, and the sentence
 * it puts on screen.
 * (DECISIONS :7037, :6959. Run from the repo root:
 *  `node apps/web/tools/mutate-person-gate.mjs`)
 *
 * WHY THIS FILE EXISTS: a claim of "N mutants, N RED" that nobody else can
 * re-run is not evidence (:2546). Every figure in this card's DECISIONS entry
 * comes from here.
 *
 * WHAT IT AIMS AT, and why not at everything. :5857 scopes the audit by
 * severity: the expensive treatment goes to numbers a user sees and to flows
 * that can break, never to wording, layout or ported constant tables. Here that
 * is exactly two things — THE RULED CONFIGURATION (a signal and a cut-off Kd
 * chose on measured evidence, where a nudged digit silently reverses a ruling)
 * and THE SCREEN (a count that stops with no explanation is the app lying by
 * omission, :5807). This card changes no server behaviour, so there are no
 * database mutants and the whole sweep runs in minutes.
 *
 * EVERY STEP IS CHECKED, NOT ASSUMED — this repo has been burned repeatedly by
 * harnesses reporting unearned passes (:4855, :5199, :5748):
 *   - a mutation that does not change the file ABORTS (a drifted anchor is a
 *     broken instrument, never a missing test — :4267)
 *   - a run whose suite reported no tally ABORTS (a suite that never ran is not
 *     a RED — :2614)
 *   - the restore must reproduce the original sha256 or the run ABORTS, before
 *     the next mutant can stack on top of it (:5199 left broken source behind by
 *     skipping exactly this)
 *   - a RUNNER failure is NOT a red: only a numeric non-zero exit is a test
 *     result, and anything else ABORTS — after the restore, never instead of it
 *   - ANCHORS ARE EOL-NORMALISED PER FILE. This card touches files of both
 *     kinds: `sessionController.js` is CRLF and `sceneGate.js` is LF, so a
 *     multi-line anchor written with "\n" matches nothing in half of them and
 *     would abort a sweep for a reason that has nothing to do with the code
 *     (:4267's class, arriving from the authoring side instead of `sed`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const TARGETS = {
  scene: {
    file: resolve(ROOT, 'apps/web/src/engine/sceneGate.js'),
    suite: 'src/engine/sceneGate.test.js',
  },
  controller: {
    file: resolve(ROOT, 'apps/web/src/engine/sessionController.js'),
    suite: 'src/engine/sessionController.test.js',
  },
  messages: {
    file: resolve(ROOT, 'apps/web/src/engine/messages.en.js'),
    suite: 'src/engine/messages.test.js',
  },
  hook: {
    file: resolve(ROOT, 'apps/web/src/hooks/usePoseDetection.js'),
    suite: 'src/hooks/usePoseDetection.test.js',
  },
};

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** Anchors are authored with "\n" and matched against the file's own endings. */
const toEol = (s, text) => (text.includes('\r\n') ? s.replace(/\n/g, '\r\n') : s);

const MUTANTS = [
  // ── The ruled configuration ───────────────────────────────────────────────
  {
    id: 'PG1',
    target: 'scene',
    why: 'the cut-off is raised past everything, so the check never fires',
    expect: "blocks a skeleton that is redrawn every frame",
    from: '  cutoff: 0.923,',
    to: '  cutoff: 9.923,',
  },
  {
    id: 'PG2',
    target: 'scene',
    why: 'the cut-off is nudged to a number Kd did not rule — invisible in the fixtures, a reversal in the app',
    // THE POINT OF THIS ONE. 0.5 sits between the two piles as surely as 0.923
    // does, so every behavioural test here stays green while the shipped app
    // silences a different set of a real user's frames. Only an assertion on the
    // number itself can catch it, and that is why one exists.
    expect: 'is bone_stretch above 0.923',
    from: '  cutoff: 0.923,',
    to: '  cutoff: 0.5,',
  },
  {
    id: 'PG3',
    target: 'scene',
    why: 'the signal is swapped for the one the cross-check REJECTED for eating a real rep',
    // `motion_incoherence` scored 0.980 against bone_stretch's 0.983 —
    // indistinguishable on paper, and :6856 named both as the strong pair — and
    // loses a real rep in BOTH recording sessions (:7062). A later chat reading
    // the separation numbers alone would make exactly this edit.
    expect: 'is bone_stretch above 0.923',
    from: '  signal: "bone_stretch",',
    to: '  signal: "motion_incoherence",',
  },
  {
    id: 'PG4',
    target: 'scene',
    why: 'the window shrinks, so "the last second" stops meaning what the measurement meant',
    expect: 'is bone_stretch above 0.923',
    from: '  window: 15,',
    to: '  window: 5,',
  },
  {
    id: 'PG5',
    target: 'scene',
    why: 'the gate answers backwards — it would block real users and pass furniture',
    expect: 'never blocks a body whose bones keep their lengths',
    from: '    const blocked = this._gate.push(frame).blocked;',
    to: '    const blocked = !this._gate.push(frame).blocked;',
  },

  // ── The screen ────────────────────────────────────────────────────────────
  {
    id: 'PG6',
    target: 'scene',
    why: 'the message appears on the first blocked frame — a sentence that flickers',
    expect: 'stays quiet through two blocked frames',
    from: 'export const BLOCKED_RUN_BEFORE_MESSAGE = 3;',
    to: 'export const BLOCKED_RUN_BEFORE_MESSAGE = 1;',
  },
  {
    id: 'PG7',
    target: 'scene',
    why: 'the message vanishes on the first clean frame — too fast to read',
    expect: 'is still up after fourteen clean frames',
    from: 'export const CLEAN_RUN_BEFORE_MESSAGE_CLEARS = 15;',
    to: 'export const CLEAN_RUN_BEFORE_MESSAGE_CLEARS = 1;',
  },
  {
    id: 'PG8',
    target: 'scene',
    why: 'blocked frames accumulate across clean ones, so scattered blocking raises the message',
    // The 6-space indent is the one inside `push`'s else-branch; the constructor
    // and `reset` write the same statement at 4.
    expect: 'counts blocked frames IN A ROW, not blocked frames in total',
    from: '      this._blockedRun = 0;\n',
    to: '',
  },
  {
    id: 'PG9',
    target: 'scene',
    why: 'reset forgets the screen but not the gate, so a resumed set carries the old window',
    expect: 'forgets the gate',
    from: '    this._gate.reset();\n',
    to: '',
  },

  // ── The wiring ────────────────────────────────────────────────────────────
  {
    id: 'PG10',
    target: 'controller',
    why: 'THE CARD ITSELF: the engine is handed the landmarks even on a blocked frame, so the invented reps come straight back',
    expect: 'withholds the reps the engine would otherwise have counted',
    from: '    const fr = this._session.feed(scene.blocked ? [] : landmarks, tMs);',
    to: '    const fr = this._session.feed(landmarks, tMs);',
  },
  {
    id: 'PG11',
    target: 'controller',
    why: 'the app stops counting and says NOTHING — the silent suppression :5807 forbids',
    expect: 'says on screen that it is not counting',
    from: '      display.corrections = [translate("cue.scene.no_person")];\n',
    to: '',
  },
  {
    id: 'PG12',
    target: 'controller',
    why: 'the verdict survives the message, so the screen grades a frame it refused to look at',
    // Anchored across two lines because the identical statement appears in the
    // blocked branch as well; PG13 mutates that one.
    expect: 'gives no form verdict while it is saying it cannot count',
    from: '    if (scene.showMessage) {\n      display.form_correct = null;\n',
    to: '    if (scene.showMessage) {\n',
  },
  {
    id: 'PG13',
    target: 'controller',
    why: 'a short block keeps its verdict — "Good Form" over frames the app blanked, too brief for the message',
    expect: 'gives no form verdict on ANY frame it blanked',
    from: '      display.form_correct = null;\n      // AND THE OCCLUSION STREAK',
    to: '      // AND THE OCCLUSION STREAK',
  },
  {
    id: 'PG14',
    target: 'controller',
    why: 'the occlusion streak is fed by our own blanking, so the engine’s "cannot see your legs" can reach a user in full view',
    // The `else` is what keeps the streak out of the blocked path. Removing the
    // branch lets a blanked frame count as an occluded one — :6150 C/H-2's shape.
    expect: 'never borrows the engine',
    from: '    } else {\n      // Honest degradation',
    to: '    }\n    {\n      // Honest degradation',
    expectAlive: true,
    // MEASURED ALIVE, AND THE REASON IS WRITTEN DOWN RATHER THAN THE ROW DELETED
    // (:5618's M6 precedent). The corner it protects needs the occlusion streak
    // to already stand at 2 from genuinely unusable frames at the moment a block
    // begins, AND the engine's own visibility to still be true — which is the
    // first two frames of that block and no others. No clip in this repo reaches
    // that state, and a fixture built to reach it would be a fixture asserting
    // its own construction. The `else` stays: it is the honest expression of "a
    // frame we blanked is not evidence about the user's legs", and an
    // unprotected branch is reported, never quietly dropped.
  },
  {
    id: 'PG15',
    target: 'messages',
    why: 'the sentence names a cause the app cannot know',
    expect: 'has a sentence for the person check, and it names no cause',
    from: '"Not counting — the camera isn\'t sure it\'s looking at you. Step into full view.",',
    to: '"Not counting — that looks like a chair, not a person. Move the chair out of shot.",',
  },
  {
    id: 'PG16',
    target: 'hook',
    why: 'a resumed set keeps the readings and the message from before the pause',
    expect: 'forgets the scene when a paused set RESUMES',
    from: '    if (enabled && !wasEnabled) controllerRef.current.resetScene();',
    to: '',
  },
  {
    id: 'PG17',
    target: 'hook',
    why: 'the reset fires on the pause as well as the resume, wiping the window while frames still arrive',
    expect: 'forgets the scene when a paused set RESUMES',
    from: '    if (enabled && !wasEnabled) controllerRef.current.resetScene();',
    to: '    controllerRef.current.resetScene();',
  },
];

const abort = (msg) => {
  console.error(`\nABORT — ${msg}`);
  process.exit(2);
};

/** Originals are snapshotted per TARGET, once, before anything is written —
 *  every restore compares against the bytes this run started with. */
const originals = new Map(
  Object.entries(TARGETS).map(([k, t]) => [
    k,
    { sha: sha(t.file), text: readFileSync(t.file, 'utf8') },
  ]),
);

const results = [];
for (const m of MUTANTS) {
  const target = TARGETS[m.target];
  if (target === undefined) abort(`${m.id}: names an unknown target '${m.target}'.`);
  const original = originals.get(m.target);
  const from = toEol(m.from, original.text);
  const to = toEol(m.to, original.text);
  const mutated = original.text.replace(from, to);
  if (mutated === original.text) {
    abort(
      `${m.id}: its anchor matched nothing. The mutation would have been a no-op, which reports as a missing test. Re-anchor it against the current file.`,
    );
  }
  writeFileSync(target.file, mutated);

  let out = '';
  let suiteFailed = false;
  // HELD, NOT THROWN: aborting from inside the catch would leave the file
  // MUTATED on disk (:5199's exact defect). The restore runs first,
  // unconditionally, and the abort happens after it.
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

  writeFileSync(target.file, original.text);
  if (runnerFault !== null) {
    if (sha(target.file) !== original.sha) {
      abort(`${m.id}: the runner failed AND the restore did not reproduce the original bytes — fix the tree by hand.`);
    }
    abort(`${m.id}: the RUNNER itself failed, which is NOT a test result — ${runnerFault}`);
  }
  if (sha(target.file) !== original.sha) {
    abort(`${m.id}: the restore did NOT reproduce the original bytes. The working tree is dirty — fix it before running anything else.`);
  }

  // THE ESCAPE CHARACTER ITSELF IS STRIPPED, not just the bracket sequence.
  // Caught on this harness's first run, in the fail-safe direction (:6532's
  // twin): vitest keeps colour on through a pipe here, so `Tests` and its count
  // are separated by ESC bytes, `\s+` does not match ESC, and the tally guard
  // read a perfectly good run as "the suite never ran" and ABORTED. A stripper
  // that leaves half the sequence behind is worse than none, because everything
  // downstream of it looks like a real finding.
  const clean = out.replace(/\[[0-9;]*m/g, '').replace(//g, '');
  const ran = /Tests\s+(?:\d+ failed \| )?\d+ (?:passed|failed)/.test(clean) && !/No test files found/.test(clean);
  if (!ran) {
    abort(
      `${m.id}: the suite produced no test tally, so this run proves nothing. Its \`expect\` name probably matches no test.\n` +
        `--- last 400 chars of its output ---\n${clean.slice(-400)}`,
    );
  }

  const verdict = suiteFailed ? 'RED' : 'ALIVE';
  const ok = m.expectAlive ? verdict === 'ALIVE' : verdict === 'RED';
  results.push({ ...m, verdict, ok });
  console.log(`${m.id.padEnd(5)} ${verdict.padEnd(5)}  ${ok ? 'as expected' : 'UNEXPECTED'}  ${m.why}`);
}

const bad = results.filter((r) => !r.ok);
console.log('\n--- summary ---');
// Every figure DERIVED — a hardcoded count keeps reading as true after it stops
// being (:6277).
const distinct = new Set(MUTANTS.map((m) => `${m.target}:${m.from}→${m.to}`)).size;
console.log(
  `${results.length} runs over ${distinct} distinct mutations · ` +
    `${results.filter((r) => r.verdict === 'RED').length} RED · ` +
    `${results.filter((r) => r.verdict === 'ALIVE').length} ALIVE ` +
    `(${MUTANTS.filter((m) => m.expectAlive).length} expected, with its reason in this file) · 0 never ran`,
);
console.log('restore verified byte-exact (sha256) after every mutant');
if (bad.length) {
  console.error(`\n${bad.length} mutant(s) did not match expectation: ${bad.map((b) => b.id).join(', ')}`);
  process.exit(1);
}
console.log('every mutant matched its expectation');
