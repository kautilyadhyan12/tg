/**
 * Mutation audit — the login door (two doors, one account).
 * Run from the repo root: `node apps/web/tools/mutate-login-door.mjs`
 *
 * WHY THESE GUARANTEES AND NOT OTHERS (:5857 rule 4a — the audit is scoped by
 * severity). This card changes NO server behaviour, so under 4a there are no
 * database mutants here at all and the whole sweep runs in minutes. What is left
 * is the one column this card can land in:
 *
 *   · ON SCREEN AND FALSE (:5807) — a button that says "I run a gym" and then
 *     delivers the member app is a promise that is not true, and it fails
 *     SILENTLY: the person sees a working app and simply never finds their
 *     console. Every mutant below is a different route to exactly that.
 *
 * The door is honoured in FOUR places and a door honoured in three of them is
 * worse than no door, because the failure depends on which way you came in:
 *   D1/D2/D3/D5  the decision itself        (landingRoute — D5 is Kd's
 *                2026-08-19 amendment: the gym door is NOT gated on the
 *                questionnaire, and this mutant re-gates it)
 *   D4/D8/D9  the login page's wiring       (Login.jsx)
 *   D6        landing back on /login        (PublicRoute)
 *   D7        sign-out                      (AuthContext — the shared browser)
 *   D11       the console's route table     (App.jsx — one route losing its
 *                onboarding opt-out puts the questionnaire back in front of a
 *                gym owner on that route alone)
 *
 * Deliberately NOT mutated, per the same rule: the button colours, the heading
 * copy, the order of the two doors, comments. The onboarding wizard's exit is
 * no longer a target at all: under the amendment its hard-coded '/dashboard'
 * is correct for both doors, because the only way into the wizard is heading
 * for the member app.
 *
 * D7 and D11 are caught by SOURCE assertions and that is stated rather than
 * glossed: `AuthContext` has had zero coverage since :618's T3 F5 and `App.jsx`
 * is the route table no unit renders, so a source guard is what exists rather
 * than what is best. Both behaviours are checked in a real browser by this
 * card's smoke; these stop a later edit quietly undoing them between smokes.
 *
 * The class fixes are inherited, not relearned (:4855, :5199, :5748, :6277,
 * :9509): anchors that match nothing ABORT, for the WHOLE table, before a byte
 * is written · a target outside TARGETS ABORTS · a run with no test tally ABORTS
 * · an unmutated CONTROL must report GREEN through this same path before any
 * verdict is believed · restores are sha256-verified after EVERY mutant · a
 * RUNNER fault is not a RED and is raised AFTER the restore · substrings are
 * replaced through a utf8 read/write, never `sed -i` (CRLF, :4267) · every `-t`
 * filter is ASCII, so a curly apostrophe in a test name cannot make a filter
 * match nothing.
 *
 * NO MUTANT IS EXPECTED ALIVE.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const UNIT_SUITE = 'src/pages/landingRoute.test.js';
const RENDER_SUITE = 'src/pages/login.render.test.jsx';
const GOOGLE_SUITE = 'src/pages/googleAuth.test.js';

const TARGETS = {
  route: { file: resolve(ROOT, 'apps/web/src/pages/landingRoute.js') },
  login: { file: resolve(ROOT, 'apps/web/src/pages/Login.jsx') },
  app: { file: resolve(ROOT, 'apps/web/src/App.jsx') },
  guard: { file: resolve(ROOT, 'apps/web/src/components/common/ProtectedRoute.jsx') },
  auth: { file: resolve(ROOT, 'apps/web/src/context/AuthContext.jsx') },
  google: { file: resolve(ROOT, 'apps/web/src/pages/googleSuccessRoute.js') },
};

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** ANCHORS ARE WRITTEN WITH LF AND MATCHED AGAINST THE FILE'S OWN LINE ENDINGS.
 *
 *  Measured, not anticipated: this harness ABORTED on its first run because
 *  `Login.jsx` is CRLF on disk while D9's anchor spans two lines, so it matched
 *  nothing. That is :4267's class — the one this project has now hit in three
 *  separate harnesses (:9111 fixed it in two more) — and the reason it matters
 *  is not the wasted run: an anchor that matches nothing reports its mutant
 *  ALIVE, whose honest reading is "this guarantee has no test".
 *
 *  Converting the ANCHOR rather than the FILE is deliberate. Normalising the
 *  file would rewrite every line ending in it, so the mutated tree would differ
 *  from the original everywhere instead of only at the mutation — and a mutant
 *  is only evidence about the one line it changed.
 */
const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');
const withEolOf = (snippet, text) =>
  snippet.replace(/\r\n/g, '\n').replace(/\n/g, eolOf(text));

const MUTANTS = [
  {
    id: 'D1',
    target: 'route',
    suite: UNIT_SUITE,
    why: 'ON SCREEN AND FALSE: the gym-door arm is deleted, so "I run a gym" delivers the member app — the whole feature, silently absent',
    expect: 'sends the gym door to the console and the member door to the app',
    from: "  if (door === GYM_DOOR) return '/console';\n",
    to: '',
  },
  {
    id: 'D2',
    target: 'route',
    suite: UNIT_SUITE,
    why: 'BLOCKED FROM FINISHING: the member door stops being gated on the questionnaire, so a brand-new member is dropped on a Dashboard their profile has not been set up for',
    expect: 'gates the MEMBER door on the questionnaire',
    from: '  if (user?.onboardingCompleted === false) return \'/onboarding\';',
    to: '  if (user?.onboardingCompleted === false && false) return \'/onboarding\';',
  },
  {
    id: 'D3',
    target: 'route',
    suite: UNIT_SUITE,
    why: 'ROUTED SOMEWHERE NOBODY CHOSE: any stored string is honoured as a door, so a stale value from an older build decides where a person lands',
    expect: 'reads a stored value that is not a door as NO door',
    from: '  return raw === MEMBER_DOOR || raw === GYM_DOOR ? raw : null;',
    to: '  return raw;',
  },
  {
    id: 'D4',
    target: 'route',
    suite: RENDER_SUITE,
    why: 'ON SCREEN AND FALSE, the reload path: the choice is never written down, so Continue with Google and the onboarding wizard both come back to the member app after the person pressed "I run a gym"',
    expect: 'is remembered across a reload',
    from: '    store.setItem(DOOR_KEY, door);',
    to: '    void door;',
  },
  {
    id: 'D5',
    target: 'route',
    suite: RENDER_SUITE,
    why: "KD'S AMENDMENT RESTORED TO ITS FIRST DRAFT: the gym door is gated on the questionnaire again, so a new owner is handed five screens of fitness questions before their business tool — the exact moment Kd hit in his own smoke",
    expect: 'straight to the console',
    from: "  if (door === GYM_DOOR) return '/console';",
    to: "  if (door === GYM_DOOR && user?.onboardingCompleted !== false) return '/console';",
  },
  {
    id: 'D6',
    target: 'guard',
    suite: RENDER_SUITE,
    why: 'A DOOR THAT WORKS SOMETIMES: coming back to /login already signed in always lands on the dashboard, so the same account reaches two different screens depending on how it arrived',
    expect: 'follows the door rather than always the dashboard',
    from: '  return <Navigate to={landingRoute(user, readDoor())} replace />;',
    to: '  return <Navigate to="/dashboard" replace />;',
  },
  {
    id: 'D7',
    target: 'auth',
    suite: UNIT_SUITE,
    why: "SHARED BROWSER: sign-out stops clearing the door, so the next person at a gym's front desk is sent to whichever screen the last person picked (:618 T3 F1's shape, one session field over)",
    expect: 'clears the door on sign-out',
    from: '      forgetDoor();',
    to: '      void 0;',
  },
  {
    id: 'D8',
    target: 'login',
    suite: RENDER_SUITE,
    why: 'THE BUTTON IS NOT WIRED: the decision is right and the page stops passing what was pressed, which is the defect a pure-function test alone cannot see',
    expect: 'takes the gym door to the console',
    from: '      const dest = landingRoute(res.user, door);',
    to: '      const dest = landingRoute(res.user, null);',
  },
  {
    id: 'D9',
    target: 'login',
    suite: RENDER_SUITE,
    why: 'THE DOOR IS NOT OFFERED AT ALL: the gym door disappears from the page, which is what a later "tidy-up" of an unfamiliar block looks like',
    expect: 'offers both doors',
    from: "  { value: GYM_DOOR,    label: 'I run a gym' },\n",
    to: '',
  },
  {
    id: 'D10',
    target: 'google',
    suite: GOOGLE_SUITE,
    why: 'ON SCREEN AND FALSE, the path that needed the memory most: the Google landing drops the door and sends every returning gym owner to the member app',
    expect: 'honours the gym door on the way back from Google',
    from: '  return landingRoute(user, door);',
    to: "  return '/dashboard';",
  },
  {
    id: 'D11',
    target: 'app',
    suite: UNIT_SUITE,
    why: "ONE ROUTE UNDOES THE AMENDMENT: a console route loses its onboarding opt-out, so ProtectedRoute's default bounces an un-onboarded owner into the questionnaire on that route alone — the kind of drift an added or edited route ships silently",
    expect: 'opts every console route out of the onboarding requirement',
    from: '            <Route path="/console" element={\n              <ProtectedRoute requireOnboarding={false}>',
    to: '            <Route path="/console" element={\n              <ProtectedRoute>',
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
  if (/[^\x20-\x7e]/.test(m.expect)) {
    abort(`${m.id}: its -t filter is not ASCII. A curly apostrophe here matches no test and the mutant would look ALIVE.`);
  }
}

const originals = new Map(
  Object.entries(TARGETS).map(([k, t]) => [k, { sha: sha(t.file), text: readFileSync(t.file, 'utf8') }]),
);

// EVERY ANCHOR CHECKED FOR THE WHOLE TABLE BEFORE A BYTE IS WRITTEN.
//
// Not to save the run's minutes: a no-op mutation reports as ALIVE, and the
// honest reading of ALIVE is "this guarantee has no test" — so an anchor that
// silently stopped matching sends the next chat hunting a hole that was never
// there. Three of this project's own fixes have drifted a mutant's anchor
// (:10726), which is why the guard is here rather than the care.
for (const m of MUTANTS) {
  const original = originals.get(m.target);
  if (!original.text.includes(withEolOf(m.from, original.text))) {
    abort(
      `${m.id}: its anchor matches nothing in '${m.target}'. Nothing has been written yet. ` +
      `Re-anchor it against the current file — a no-op mutation reports as ALIVE, which reads as "this guarantee has no test".`,
    );
  }
}

const STRIP_ANSI = new RegExp(String.fromCharCode(27) + String.raw`\[[0-9;]*m`, 'g');
const tallied = (out) => {
  const clean = out.replace(STRIP_ANSI, '');
  return /Tests\s+(?:\d+ failed \| )?\d+ (?:passed|failed)/.test(clean) && !/No test files found/.test(clean);
};

const run = (suite, filter) => {
  try {
    const out = execSync(
      `corepack pnpm --filter web exec vitest run ${suite} -t ${JSON.stringify(filter)}`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
    );
    return { out, failed: false, fault: null };
  } catch (e) {
    if (typeof e.status === 'number' && e.status !== 0) {
      return { out: `${e.stdout || ''}${e.stderr || ''}`, failed: true, fault: null };
    }
    return { out: '', failed: false, fault: `${e.code || ''} ${e.message}` };
  }
};

// THE CONTROL (:9509): every (suite, filter) pair this sweep will use must
// report GREEN and must produce a tally BEFORE anything is mutated. A filter
// matching no test would otherwise make its mutant look ALIVE.
console.log('control (unmutated) — every filter must be GREEN and must tally ...');
// Deduped as OBJECTS, never by splitting a joined string: every filter here
// contains spaces, so a naive split would run the control on the first WORD of
// each — a broader filter than the mutants use, i.e. the control quietly
// checking something else (:10402).
const pairs = [];
const seenPairs = new Set();
for (const m of MUTANTS) {
  const key = `${m.suite} :: ${m.expect}`;
  if (seenPairs.has(key)) continue;
  seenPairs.add(key);
  pairs.push({ suite: m.suite, filter: m.expect });
}
for (const { suite, filter } of pairs) {
  const { out, failed, fault } = run(suite, filter);
  if (fault !== null) abort(`control for ${JSON.stringify(filter)}: the RUNNER failed — ${fault}`);
  if (!tallied(out)) abort(`control for ${JSON.stringify(filter)}: no test tally. That filter matches no test, so its mutants would prove nothing.`);
  if (failed) abort(`control for ${JSON.stringify(filter)}: RED before any mutation. Every verdict below would be meaningless.`);
  console.log(`  control GREEN  ${filter}`);
}
console.log('control complete\n');

const results = [];
for (const m of MUTANTS) {
  const target = TARGETS[m.target];
  const original = originals.get(m.target);
  const mutated = original.text.replace(
    withEolOf(m.from, original.text),
    withEolOf(m.to, original.text),
  );
  if (mutated === original.text) {
    abort(`${m.id}: its anchor matched nothing at apply time. Re-anchor it against the current file.`);
  }
  writeFileSync(target.file, mutated);

  const { out, failed, fault } = run(m.suite, m.expect);

  // Restore FIRST, always (:5199).
  writeFileSync(target.file, original.text);
  if (fault !== null) {
    if (sha(target.file) !== original.sha) abort(`${m.id}: the runner failed AND the restore did not reproduce the original bytes — fix the tree by hand.`);
    abort(`${m.id}: the RUNNER itself failed, which is NOT a test result — ${fault}`);
  }
  if (sha(target.file) !== original.sha) {
    abort(`${m.id}: the restore did NOT reproduce the original bytes. The working tree is dirty — fix it before running anything else.`);
  }
  if (!tallied(out)) abort(`${m.id}: the run produced no test tally, so it proves nothing.`);

  const verdict = failed ? 'RED' : 'ALIVE';
  results.push({ ...m, verdict, ok: verdict === 'RED' });
  console.log(`${m.id.padEnd(4)} ${verdict.padEnd(5)} ${verdict === 'RED' ? 'as expected' : 'UNEXPECTED'}  ${m.why}`);
}

const bad = results.filter((r) => !r.ok);
console.log('\n--- summary ---');
console.log(
  `${results.length} mutants · ${results.filter((r) => r.verdict === 'RED').length} RED · ` +
  `${results.filter((r) => r.verdict === 'ALIVE').length} ALIVE (0 expected) · 0 never ran`,
);
console.log('restore verified byte-exact (sha256) after every mutant');
if (bad.length) {
  console.error(`\n${bad.length} mutant(s) survived: ${bad.map((b) => b.id).join(', ')}`);
  process.exit(1);
}
console.log('every mutant matched its expectation');
