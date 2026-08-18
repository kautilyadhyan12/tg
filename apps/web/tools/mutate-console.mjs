/**
 * Mutation audit — the gym console's screens.
 * Run from the repo root: `node apps/web/tools/mutate-console.mjs`
 *
 * WHY THESE GUARANTEES AND NOT OTHERS (:5857 rule 4a — the audit is scoped by
 * severity). This is the WEB half of the console card: it changes no server
 * behaviour, so under 4a there are no database mutants here at all and the
 * whole sweep runs in minutes. What is left is exactly 4a's own columns:
 *   · OWNERSHIP — is a gym you merely BELONG to listed as one you run, and can
 *     a member's row carry something Part 3 §2.4 forbids a gym from seeing
 *     (C1, C2)
 *   · NUMBERS A USER SEES — a member count taken off one page of a cursor
 *     walk, and the owner's own complimentary seat counted as somebody who
 *     joined (C3, C4)
 *   · ON SCREEN AND FALSE — a dead join code printed under "share this with
 *     your members", a country offered that the server will refuse, an offline
 *     failure reported as something the server said, and — twice, because it is
 *     the shape this project has shipped before — a FAILED read drawn as an
 *     EMPTY one (C5, C6, C7, C8, C9)
 *   · DATA A USER IS LOOKING AT — the roster rows already on screen being wiped
 *     by a failure to fetch the NEXT page (C10)
 *   · SAVES — the gym's timezone silently becoming somebody else's, which is
 *     written into the org row once and decides its day boundaries forever
 *     (C11)
 *
 * Deliberately NOT mutated, per the same rule: wording, layout, the rail-vs-tabs
 * breakpoint, icon choices, comments, and the org-type hint text.
 *
 * The class fixes are inherited, not relearned (:4855, :5199, :5748, :6277,
 * :9509): anchors that match nothing ABORT · a target outside TARGETS ABORTS ·
 * a run with no test tally ABORTS · an unmutated CONTROL must report GREEN
 * through this same path before any verdict is believed · restores are
 * sha256-verified after EVERY mutant · a RUNNER fault is not a RED and is
 * raised AFTER the restore · substrings are replaced through a utf8
 * read/write, never `sed -i` (CRLF, :4267) · every `-t` filter is ASCII, so a
 * curly apostrophe in a test name cannot make a filter match nothing.
 *
 * NO MUTANT IS EXPECTED ALIVE.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const VIEW_SUITE = 'src/pages/console/consoleView.test.js';
const RENDER_SUITE = 'src/pages/console/console.render.test.jsx';
const API_SUITE = 'src/api/orgsApi.test.js';

const TARGETS = {
  view: { file: resolve(ROOT, 'apps/web/src/pages/console/consoleView.js') },
  api: { file: resolve(ROOT, 'apps/web/src/api/orgsApi.js') },
  home: { file: resolve(ROOT, 'apps/web/src/pages/console/ConsoleHome.jsx') },
  members: { file: resolve(ROOT, 'apps/web/src/pages/console/Members.jsx') },
  newgym: { file: resolve(ROOT, 'apps/web/src/pages/console/NewGym.jsx') },
  overview: { file: resolve(ROOT, 'apps/web/src/pages/console/Overview.jsx') },
};

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const MUTANTS = [
  {
    id: 'C1',
    target: 'view',
    suite: RENDER_SUITE,
    why: 'OWNERSHIP: a gym the caller merely BELONGS to is listed as one they run, and every screen behind it answers 404 — a door onto an error',
    expect: 'lists the gyms the caller staffs',
    from: "  return (orgs ?? []).filter((o) => o?.staffRole != null);",
    to: "  return orgs ?? [];",
  },
  {
    id: 'C2',
    target: 'members',
    suite: RENDER_SUITE,
    why: "PRIVACY, Part 3 §2.4: a field the endpoint does not send reaches the roster row — the exact edit that breaks the org-visibility promise",
    expect: 'four facts AND NOTHING ELSE',
    from: '          {member.displayName}',
    to: '          {member.displayName} {member.email}',
  },
  {
    id: 'C3',
    target: 'view',
    suite: VIEW_SUITE,
    why: 'NUMBER ON SCREEN: one page of a cursor walk is printed as the member count, so a gym with hundreds of members reads "50 members"',
    expect: 'prints a bound when there are more pages',
    from: "  if (page.nextCursor != null) return `${n}+ members`;",
    to: "  if (page.nextCursor != null && false) return `${n}+ members`;",
  },
  {
    id: 'C4',
    target: 'view',
    suite: VIEW_SUITE,
    why: "NUMBER ON SCREEN: the owner's own complimentary seat counts as somebody who joined, so a brand-new gym stops saying nobody has",
    expect: 'complimentary seat as somebody who joined',
    from: "  return page.items.filter((m) => m?.complimentary !== true).length;",
    to: "  return page.items.length;",
  },
  {
    id: 'C5',
    target: 'view',
    suite: RENDER_SUITE,
    why: 'ON SCREEN AND FALSE: a paused code reads as live, so the console tells an owner to share a code the join path will refuse',
    expect: 'refuses to invite anyone with a code the server will turn away',
    from: "  if (code.paused) return { live: false, reason: 'paused', label: 'Paused' };",
    to: "  if (code.paused && false) return { live: false, reason: 'paused', label: 'Paused' };",
  },
  {
    id: 'C6',
    target: 'view',
    suite: RENDER_SUITE,
    why: "BLOCKED FROM FINISHING: the country picker stops being the server's own list, so an owner picks a country and org-create then refuses them",
    expect: 'offers only countries the server is open in',
    from: "  return SUPPORTED_COUNTRIES.map((value) => ({ value, label: name(value) })).sort((a, b) =>",
    to: "  return [...SUPPORTED_COUNTRIES, 'AU'].map((value) => ({ value, label: name(value) })).sort((a, b) =>",
  },
  {
    id: 'C7',
    target: 'api',
    suite: API_SUITE,
    why: 'ON SCREEN AND FALSE: an offline request is reported as something the server said, when nothing reached the server at all',
    expect: 'never reports an offline request as something the server said',
    from: "  if (err?.response === undefined) {",
    to: "  if (err?.response === undefined && err === null) {",
  },
  {
    id: 'C8',
    target: 'home',
    suite: RENDER_SUITE,
    why: 'ON SCREEN AND FALSE: a FAILED read draws the EMPTY state, so an owner of three gyms whose connection blipped is told they run none',
    expect: 'with a way out',
    from: '        setState({ loading: false, error: errorText(err, "We couldn\'t load your gyms."), orgs: [] });',
    to: "        setState({ loading: false, error: null, orgs: [] });",
  },
  {
    id: 'C9',
    target: 'members',
    suite: RENDER_SUITE,
    why: 'ON SCREEN AND FALSE, same shape one screen over: a failed roster read draws "nobody has joined yet" at a gym that is full',
    expect: 'roster is empty when the read failed',
    from: "        setState({ loading: false, error: message, items: [], nextCursor: null });",
    to: "        setState({ loading: false, error: null, items: [], nextCursor: null });",
  },
  {
    id: 'C10',
    target: 'members',
    suite: RENDER_SUITE,
    why: 'DATA IN FRONT OF THE USER: a failure to fetch the NEXT page wipes the rows already on screen',
    expect: 'keeps the rows already on screen when the NEXT page fails',
    from: '      setState((prev) => ({ ...prev, error: errorText(err, "We couldn\'t load any more.") }));',
    to: '      setState({ loading: false, error: errorText(err, "We couldn\'t load any more."), items: [], nextCursor: null });',
  },
  {
    id: 'C11',
    target: 'view',
    suite: VIEW_SUITE,
    why: "SAVES: the detected zone stops being injected, so a runtime that calls the user's zone by its other alias silently sets the gym up in somebody else's day boundaries — written once, permanent",
    expect: 'injects a detected zone the runtime does not list',
    from: "  if (typeof detected === 'string' && detected !== '' && !zones.includes(detected)) {",
    to: "  if (typeof detected === 'string' && detected !== '' && zones.includes(detected)) {",
  },

  // ── T3 round 1's fixes, each restored so its regression test is MEASURED red
  //    rather than asserted to be (:5348 rule 3) ───────────────────────────
  {
    id: 'C12',
    target: 'newgym',
    suite: RENDER_SUITE,
    why: 'C/H-1 RESTORED: the wizard preselects the United States again, so an owner in India who types a name and presses Create gets a gym billed in USD — permanently, since no settings route exists',
    expect: 'does NOT preselect a country',
    from: "  const [country, setCountry] = useState('');",
    to: "  const [country, setCountry] = useState('US');",
  },
  {
    id: 'C13',
    target: 'view',
    suite: VIEW_SUITE,
    why: 'L-4 RESTORED: the console shows the OLDEST code rather than the first live one, so a rotated gym keeps handing out the retired code',
    expect: 'picks the first LIVE one',
    from: "  return list.find((c) => codeState(c, now).live) ?? list[0] ?? null;",
    to: "  return list[0] ?? null;",
  },
  {
    id: 'C14',
    target: 'view',
    suite: VIEW_SUITE,
    why: 'L-5 RESTORED: a brand-new gym reads "1 member" directly above "nobody has joined yet" — two true sentences that contradict each other on screen',
    expect: 'names the one membership as yours',
    // RE-ANCHORED after round 2's Low-3 rewrote this function. The old anchor
    // named a line that no longer exists, and the harness aborted at APPLY time
    // — 13 mutants into a run. Second anchor drift caused by my own fix in two
    // rounds (O21 was the first), which is what moved the whole-table pre-check
    // below from the api harness into this one.
    from: "  return isViewersOwnSeat ? '1 member (you)' : label;",
    to: "  return label;",
  },
  {
    id: 'C15',
    target: 'view',
    suite: VIEW_SUITE,
    why: "L-6 RESTORED: the database's own vocabulary is printed on a page a gym owner reads (`owner`, `gym`)",
    expect: 'labels org types and roles',
    from: "  return Object.hasOwn(ROLE_WORDS, role ?? '') ? ROLE_WORDS[role] : (role ?? '');",
    to: "  return role ?? '';",
  },
  {
    id: 'C16',
    target: 'api',
    suite: API_SUITE,
    why: 'L-7 RESTORED: a 200 whose body does not match the contract is accepted, so a malformed success becomes an empty list and then a confident false sentence on screen',
    expect: 'rejects a mine response with no orgs',
    from: "  if (!parsed.success) throw contractError(what);",
    to: "  if (!parsed.success && false) throw contractError(what);",
  },
  {
    id: 'C17',
    target: 'overview',
    suite: RENDER_SUITE,
    why: "L-3 RESTORED: the two independently-authorised reads share one fate again, so a trainer the API deliberately grants the code to loses the whole screen to the roster's 403",
    expect: 'keeps the half that works when only ONE of the two reads is refused',
    from: "        codesOutcome.status === 'fulfilled'",
    to: "        codesOutcome.status === 'fulfilled' && membersOutcome.status === 'fulfilled'",
  },

  // ── T3 round 2's fixes ─────────────────────────────────────────────────
  {
    id: 'C18',
    target: 'view',
    suite: VIEW_SUITE,
    why: 'ROUND 2 Low-3 RESTORED: "(you)" is INFERRED from the seat being complimentary rather than checked against the viewer, so the day a manager can open this screen it tells them the owner\'s seat is theirs',
    expect: 'only about the person actually reading it',
    from: "    typeof viewerUserId === 'string' &&\n    only.userId === viewerUserId;",
    to: "    true;",
  },
  {
    id: 'C19',
    target: 'view',
    suite: VIEW_SUITE,
    why: "ROUND 2's OWN NEAR-MISS RESTORED: the truncation guard goes, so a page-of-one out of a roster of hundreds reads \"1 member (you)\" — a wrong number, and the defect this round's rewrite actually shipped before an existing test caught it",
    expect: 'leaves every other case exactly as it was',
    from: "  const whole = page?.nextCursor == null;",
    to: "  const whole = true;",
  },
  {
    id: 'C20',
    target: 'overview',
    suite: RENDER_SUITE,
    why: 'ROUND 2 Low-4 RESTORED: a permanent 403 is offered a Try again that can never succeed',
    expect: 'no retry on a refusal that retrying can never fix',
    from: "  return errorStatus(err) !== 403;",
    to: "  return true;",
  },
  {
    id: 'C21',
    target: 'overview',
    suite: RENDER_SUITE,
    why: 'ROUND 2 Low-4 RESTORED, second half: both reads failing the same way stack two identical error cards with two Try again buttons',
    expect: 'shows ONE error, not two, when both reads fail the same way',
    from: "      {!members.loading && members.error !== null && members.error !== codes.error ? (",
    to: "      {!members.loading && members.error !== null ? (",
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

// EVERY ANCHOR IS CHECKED FOR THE WHOLE TABLE BEFORE A BYTE IS WRITTEN, ported
// here from `mutate-orgs.mjs` after this harness aborted at APPLY time, 13
// mutants into a run, on an anchor a fix in the SAME round had drifted.
//
// It is not about saving the 13 minutes. A no-op mutation reports as ALIVE, and
// the honest reading of ALIVE is "this guarantee has no test" — so an anchor
// that silently stops matching sends the next chat hunting a hole that was never
// there. This is the second time in two rounds that one of my own fixes moved a
// line an existing mutant named (O21 was the first), which is exactly the
// recurring CLASS that :5348 rule 5 says gets a permanent guard rather than
// another careful fix.
for (const m of MUTANTS) {
  const original = originals.get(m.target);
  if (!original.text.includes(m.from)) {
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
// matching no test would otherwise make its mutant look ALIVE — which reads as
// "this guarantee has no test" and sends the next chat hunting a hole that was
// never there.
console.log('control (unmutated) — every filter must be GREEN and must tally ...');
// Deduped as OBJECTS rather than by splitting a joined string: every filter
// here contains spaces, so a naive split would run the control on the first
// WORD of each -- a broader filter than the mutants use, i.e. the control
// quietly checking something else.
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
  const mutated = original.text.replace(m.from, m.to);
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
