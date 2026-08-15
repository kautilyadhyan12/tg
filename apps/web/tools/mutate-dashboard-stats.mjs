/**
 * Mutation audit — the Dashboard's figures after the repoint onto the new API.
 * Run from the repo root: `node apps/web/tools/mutate-dashboard-stats.mjs`
 *
 * WHY THESE GUARANTEES AND NOT OTHERS (:5857 rule 4a — the audit is scoped by
 * severity, and slow mutants are spent only on Critical/High). This card
 * changes NO server behaviour, so under 4a there are no database mutants at
 * all and this whole sweep runs in minutes. What is left is the row 4a names
 * first: NUMBERS A USER SEES. Every mutant below puts a false one on the home
 * screen — a fabricated zero where nobody knows, a lifetime total captioned as
 * a window it does not cover, a flame under the wrong day, or "no workouts" to
 * a user who has them.
 *
 * Deliberately NOT mutated, per the same rule: wording, layout, comments, and
 * the ported tint ladder.
 *
 * The class fixes are inherited, not relearned (:4855, :5199, :5748, :6277):
 * anchors that match nothing ABORT · targets outside TARGETS ABORT · a suite
 * with no tally ABORTS · restores are sha256-verified after EVERY mutant ·
 * a RUNNER fault is not a RED and is thrown AFTER the restore · substrings are
 * replaced through a utf8 read/write, never `sed -i` (CRLF, :4267).
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
  stats: {
    file: resolve(ROOT, 'apps/web/src/api/dashboardStats.js'),
    suite: 'src/api/dashboardStats.test.js',
  },
  clamp: {
    file: resolve(ROOT, 'apps/web/src/pages/progressClamp.js'),
    suite: 'src/pages/progressClamp.test.js',
  },
  page: {
    file: resolve(ROOT, 'apps/web/src/pages/Dashboard.jsx'),
    suite: 'src/pages/xpDisplay.render.test.jsx',
  },
};

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const MUTANTS = [
  {
    id: 'D1',
    target: 'stats',
    why: 'ROUND 4 F2 AGAIN: an absent field becomes 0, so a 200 missing three fields prints "0 workouts / 0h / 0 kcal" as fact',
    expect: 'an empty object yields all nulls, never zeros',
    from: 'const finite = (v) => (Number.isFinite(v) ? v : null);',
    to: 'const finite = (v) => (Number.isFinite(v) ? v : 0);',
  },
  {
    id: 'D2',
    target: 'stats',
    why: 'hours is re-derived from the ROUNDED minutes, so the big number and the line beneath it disagree',
    expect: 'hours does NOT come from the rounded minutes — the chaining control',
    from: '    totalHours: ms === null ? null : Math.round(ms / 360_000) / 10,',
    to: '    totalHours: ms === null ? null : Math.round((Math.round(ms / 60_000) / 60) * 10) / 10,',
  },
  {
    id: 'D3',
    target: 'stats',
    why: 'ROUND 4 F3: a response with no day buckets becomes an EMPTY week, so seven unlit dots claim "you trained on none of these days"',
    expect: 'a 200 with NO points array is UNKNOWN — round 4 F3',
    from: '  if (o === null || !Array.isArray(o.points)) return null;',
    to: '  if (o === null) return null;\n  if (!Array.isArray(o.points)) return { byDate: {}, limitedToDays: null };',
  },
  {
    id: 'D4',
    target: 'stats',
    why: 'the seven-day window is dropped from the DAY count, so last week\'s training is captioned as this week\'s',
    expect: 'a day outside the seven is counted by NEITHER',
    from: '  return week.filter((d) => (finite(byDate[d.key]) ?? 0) > 0).length;',
    to: '  return Object.values(byDate).filter((n) => (finite(n) ?? 0) > 0).length;',
  },
  {
    id: 'D5',
    target: 'stats',
    why: 'ROUND 10 F1 INVERTED: the "This week" tile counts DAYS while its own label says workouts',
    expect: 'the tile counts WORKOUTS and the caption counts DAYS',
    from: '  return week.reduce((n, d) => n + (finite(byDate[d.key]) ?? 0), 0);',
    to: '  return week.filter((d) => (finite(byDate[d.key]) ?? 0) > 0).length;',
  },
  {
    id: 'D6',
    target: 'stats',
    why: 'an UNKNOWN week reports 0 workouts — a denial about a week nobody told us about',
    expect: 'a known-but-empty week is 0, and an unknown week is null',
    from: 'export function weekWorkoutCount(byDate, week) {\n  if (byDate === null || byDate === undefined) return null;',
    to: 'export function weekWorkoutCount(byDate, week) {\n  if (byDate === null || byDate === undefined) return 0;',
  },
  {
    id: 'D7',
    target: 'stats',
    why: 'THE REPOINT DEFECT: the day key reverts to UTC while the server buckets in the user\'s own timezone — every flame one cell left for part of each day',
    expect: 'the key is the LOCAL day, not the UTC one — the repoint fix',
    from: "    out.push({ key: localDateKey(d.toISOString()), day: d.getDate() });",
    to: "    out.push({ key: d.toISOString().split('T')[0], day: d.getDate() });",
  },
  {
    id: 'D8',
    target: 'stats',
    why: ':5104 F4: a page whose rows cannot be read reports EMPTY, so a user with workouts is told they have none',
    expect: 'rows that arrived but cannot be read are UNKNOWN',
    from: '  if (rows.length === 0 && page.items.length > 0) return null;\n',
    to: '',
  },
  {
    id: 'C1',
    target: 'clamp',
    why: 'DECISIONS :598 on the home screen: a plan-limited total is captioned "all time" regardless',
    expect: 'names the real window when the plan gate cut it',
    from: '  return days === null ? "all time" : `last ${days} ${days === 1 ? "day" : "days"}`;',
    to: '  return "all time";',
  },
  {
    id: 'C2',
    target: 'clamp',
    why: 'T3 R9 AGAIN: the pluralisation goes, and a one-day window reads "last 1 days"',
    expect: "says 'day' for a one-day window, not '1 days'",
    from: '`last ${days} ${days === 1 ? "day" : "days"}`',
    to: '`last ${days} days`',
  },
  {
    id: 'P1',
    target: 'page',
    why: 'the totals are asked for a 30-DAY window and still captioned "all time" — every mock answers the same, so only the argument assertion sees it',
    expect: 'asks the server for the windows the screen claims',
    from: "    progressService.getOverview('all')",
    to: "    progressService.getOverview('30d')",
  },
  {
    id: 'P2',
    target: 'page',
    why: 'the caption prints the WORKOUT count over a picture of DAYS — round 10 F1\'s "10 of 7 days active"',
    expect: 'the caption counts the SAME days the dots light',
    from: '                      : `${formatCount(activeDays)} of 7 days active`}',
    to: '                      : `${formatCount(weeklyWorkouts)} of 7 days active`}',
  },
  {
    id: 'P3',
    target: 'page',
    why: 'the "This week" tile prints the DAY count under a label that says workouts',
    expect: 'the caption counts the SAME days the dots light',
    from: "                  { label: 'This week', value: formatCount(weeklyWorkouts),        sub: 'workouts' },",
    to: "                  { label: 'This week', value: formatCount(activeDays),        sub: 'workouts' },",
  },
  {
    id: 'P4',
    target: 'page',
    why: 'the window label is hard-coded back to "all time", so a 90-day total claims to be a lifetime one',
    expect: 'a plan-limited total is NOT captioned "all time"',
    from: 'label="Total Workouts" value={orUnknown(totals.totalWorkouts)} sub={windowLabel}',
    to: 'label="Total Workouts" value={orUnknown(totals.totalWorkouts)} sub="all time"',
  },
  {
    id: 'P5',
    target: 'page',
    why: 'the week strip is fed the RAW response instead of the parsed map, so every dot goes dark under a caption that still counts correctly',
    // THIS ROW CAME BACK ALIVE ON THE FIRST SWEEP AND THE MUTANT WAS NEVER THE
    // PROBLEM — the row named the wrong test. It pointed at "the week caption
    // and the dots agree", which reaches the UNKNOWN arm, where the strip is
    // handed null either way and the mutation is inert by construction. The
    // invariant test below counts the LIT DOTS and compares them to the
    // caption, which is the only assertion that can see this; re-aimed, it
    // fails `expected +0 to be 2` — measured, before the row was changed.
    // :4718 F2's class in its other direction: a verdict is only as good as the
    // mapping between the mutant and the assertion it is checked against, and
    // `-t` makes that mapping a one-line thing to get wrong.
    expect: 'the caption counts the SAME days the dots light',
    from: '<WeekStrip activity={week?.byDate ?? null} state={weekState}',
    to: '<WeekStrip activity={weekRaw ?? null} state={weekState}',
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
