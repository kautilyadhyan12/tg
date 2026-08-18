/**
 * Mutation audit — the org slice: create, join by code, roster.
 * Run from the repo root with DATABASE_URL set:
 *   `node apps/api/tools/mutate-orgs.mjs`
 *
 * WHY THESE GUARANTEES AND NOT OTHERS (:5857 rule 4a — the audit is scoped by
 * severity, and slow database mutants are spent only on Critical/High). This
 * card DOES change server behaviour, so database mutants are in scope, and
 * every row below sits in one of 4a's four columns:
 *   · OWNERSHIP — can another person see this roster (O4, O5, O10)
 *   · MONEY     — can the last seat be sold twice, or sold to the wrong count
 *                 (O1, O2, O3)
 *   · SAVES/SYNCS — is a membership created once, is a code's use counted once,
 *                 is the owner's own seat written, is the whole roster reachable
 *                 (O7, O8, O12, O14)
 *   · WHAT A USER SEES AND COULD BE FALSE — a code typed off a poster that is
 *                 refused, a member upgraded but still shown free limits, a
 *                 clinic joined without consent, an audit trail that lost an
 *                 event (O6, O9, O11, O13)
 *
 * Deliberately NOT mutated, per the same rule: wording of the refusal
 * messages, comments, the ported plan seed, and the slug's cosmetics.
 *
 * The class fixes are inherited, not relearned (:4855, :5199, :5748, :6277,
 * :9509): anchors that match nothing ABORT · a target outside TARGETS ABORTS ·
 * a run with no test tally ABORTS · an unmutated CONTROL must report GREEN
 * through this same path before any verdict is believed · restores are
 * sha256-verified after EVERY mutant · a RUNNER fault is not a RED and is
 * raised AFTER the restore · substrings are replaced through a utf8
 * read/write, never `sed -i` (CRLF, :4267).
 *
 * NO MUTANT IS EXPECTED ALIVE.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SUITE = 'test/orgs.routes.test.ts';

const TARGETS = {
  repo: { file: resolve(ROOT, 'apps/api/src/modules/orgs/repo.ts') },
  service: { file: resolve(ROOT, 'apps/api/src/modules/orgs/service.ts') },
  codes: { file: resolve(ROOT, 'apps/api/src/modules/orgs/codes.ts') },
  // The country→currency map is a CONTRACT, shared with the console's country
  // picker, so it lives in @app/shared and is mutated there. The api suite
  // imports the workspace source directly, so no build step sits in between.
  shared: { file: resolve(ROOT, 'packages/shared/src/orgs.ts') },
};

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const MUTANTS = [
  {
    id: 'O1',
    target: 'repo',
    why: 'MONEY: the org row is no longer locked, so two people scanning the same poster at the same instant both read the pre-insert seat count and both get the last seat',
    expect: 'sells the last seat exactly once',
    from: '      FROM gyms WHERE id = ${found.gym_id} FOR UPDATE`;',
    to: '      FROM gyms WHERE id = ${found.gym_id}`;',
  },
  {
    id: 'O2',
    target: 'repo',
    why: 'MONEY: the cap comparison goes off by one, so a full gym sells one seat more than the plan pays for',
    expect: 'enforces the plan',
    from: '      if (used >= cap) return { kind: "seat_cap", cap };',
    to: '      if (used > cap) return { kind: "seat_cap", cap };',
  },
  {
    id: 'O3',
    target: 'repo',
    why: "MONEY: the owner's complimentary seat starts consuming a paid one, so every gym is one seat short of what it bought",
    expect: 'enforces the plan',
    from: "        WHERE gym_id = ${org.id} AND removed_at IS NULL AND complimentary = false`;",
    to: '        WHERE gym_id = ${org.id} AND removed_at IS NULL`;',
  },
  {
    id: 'O4',
    target: 'service',
    why: 'OWNERSHIP: a caller who is not staff no longer gets the same answer as a stranger, which confirms the gym exists to anyone holding a uuid',
    expect: 'serves the roster to staff and hides it',
    from: '  if (org === null || role === null) {',
    to: '  if (org === null) {',
  },
  {
    id: 'O5',
    target: 'repo',
    why: "OWNERSHIP, the worst case on this card: the roster query stops being scoped to one gym, so a gym owner reads every other gym's members",
    expect: 'serves the roster to staff and hides it',
    from: '    WHERE m.gym_id = ${input.gymId}\n      AND m.removed_at IS NULL',
    to: '    WHERE (m.gym_id = ${input.gymId} OR true)\n      AND m.removed_at IS NULL',
  },
  {
    id: 'O6',
    target: 'service',
    why: 'FALSE ON SCREEN: the entitlement cache is not busted on join, so a member whose gym pays for Pro keeps seeing the free plan limits for up to a minute',
    expect: 'upgrades entitlements immediately',
    from: '      await bustEntitlements(deps.redis, userId);',
    to: '      await Promise.resolve();',
  },
  {
    id: 'O7',
    target: 'repo',
    why: 'SAVES: the idempotent conflict handling goes, so a second tap on Join raises a constraint violation and the member sees a server error',
    expect: 'tolerates poster typing',
    from: '      ON CONFLICT (gym_id, user_id) WHERE removed_at IS NULL DO NOTHING\n      RETURNING id, joined_at`;',
    to: '      RETURNING id, joined_at`;',
  },
  {
    id: 'O8',
    target: 'repo',
    why: "SAVES: a repeat join burns another of the code's uses, so a max_uses code retires early and the gym's poster stops working",
    expect: 'tolerates poster typing',
    from: '      const existing = existingRows[0];',
    to: '      await tx`UPDATE gym_codes SET uses = uses + 1 WHERE id = ${code.id}`;\n      const existing = existingRows[0];',
  },
  {
    id: 'O9',
    target: 'repo',
    why: 'PRIVACY: a clinic membership is created without the consent record Part 3 §2.4 makes it depend on',
    expect: 'a clinic join needs consent',
    from: '    if (org.orgType === "clinic" && !input.consent) return { kind: "consent_required" };',
    to: '    if (false && org.orgType === "clinic" && !input.consent) return { kind: "consent_required" };',
  },
  {
    id: 'O10',
    target: 'service',
    why: 'OWNERSHIP: the clinic/studio trainer hold-back goes, so a trainer reads every caseload in a clinic with no scoping built yet',
    expect: 'holds a clinic trainer back',
    from: '  if (role === "trainer" && org.orgType !== "gym") {',
    to: '  if (role === "trainer" && org.orgType === "zzz_never") {',
  },
  {
    id: 'O11',
    target: 'codes',
    why: 'FALSE ON SCREEN: codes stop being normalised, so a code typed off a poster in lower case is answered "that code does not match any gym"',
    expect: 'tolerates poster typing',
    from: '  return raw.trim().toUpperCase().replace(/[\\s-]/g, "");',
    to: '  return raw;',
  },
  {
    id: 'O12',
    target: 'repo',
    why: "SAVES: the owner's own membership is never written, so the owner cannot demo the app on their own phone and the roster is missing member #1",
    expect: 'creates the org, its first code',
    from: '      if (includeRows[0]?.owner_included_as_member === true) {',
    to: '      if (includeRows[0]?.owner_included_as_member === false) {',
  },
  {
    id: 'O13',
    target: 'repo',
    why: 'AUDIT: the org-created event is written under a different name, so the trail Part 3 §3.3 requires cannot answer who created this gym',
    expect: 'creates the org, its first code',
    from: '        action: "org.created",',
    to: '        action: "org.created.renamed",',
  },
  {
    id: 'O14',
    target: 'repo',
    why: 'SAVES: the roster page stops over-reading by one, so nextCursor is always null and a gym with more than one page shows only its first',
    expect: 'walks the roster by cursor',
    from: '    LIMIT ${input.limit + 1}`;',
    to: '    LIMIT ${input.limit}`;',
  },
  {
    id: 'O15',
    target: 'service',
    why: "MONEY / FALSE ON SCREEN: the currency stops following the gym's country and reverts to a default, so a US gym is set up in rupees — the exact thing Kd's 2026-08-18 ruling removed",
    expect: 'sets the currency from the gym',
    from: '  const currencyDisplay = currencyForCountry(req.country);',
    to: '  const currencyDisplay = "INR";',
  },
  {
    id: 'O16',
    target: 'shared',
    why: 'MONEY: an unsupported country gets a FALLBACK currency instead of an honest refusal, so a gym in Sydney is quoted in US dollars',
    expect: 'sets the currency from the gym',
    from: '    ? COUNTRY_CURRENCY[key as SupportedCountry]\n    : null;',
    to: '    ? COUNTRY_CURRENCY[key as SupportedCountry]\n    : "USD";',
  },
];

const abort = (msg) => {
  console.error(`\nABORT — ${msg}`);
  process.exit(2);
};

if (!process.env.DATABASE_URL) {
  abort('DATABASE_URL is not set. The suite would SKIP and every mutant would report ALIVE for the wrong reason.');
}

// Checked for the WHOLE table before a byte is written (:5199).
for (const m of MUTANTS) {
  if (!Object.hasOwn(TARGETS, m.target)) {
    abort(`${m.id}: names target '${m.target}', which is not in TARGETS. Nothing has been written yet.`);
  }
}

const originals = new Map(
  Object.entries(TARGETS).map(([k, t]) => [k, { sha: sha(t.file), text: readFileSync(t.file, 'utf8') }]),
);

// Every anchor is proven to match BEFORE the first run, so a drifted anchor
// costs seconds rather than being discovered twenty minutes in.
for (const m of MUTANTS) {
  const original = originals.get(m.target);
  if (!original.text.includes(m.from)) {
    abort(`${m.id}: its anchor matched nothing in ${m.target}. A no-op mutation reports as a missing test. Re-anchor it against the current file.`);
  }
}

const STRIP_ANSI = new RegExp(String.fromCharCode(27) + String.raw`\[[0-9;]*m`, 'g');
const tallied = (out) => {
  const clean = out.replace(STRIP_ANSI, '');
  return /Tests\s+(?:\d+ failed \| )?\d+ (?:passed|failed)/.test(clean) && !/No test files found/.test(clean);
};

const run = (nameFilter) => {
  let out = '';
  try {
    out = execSync(
      `corepack pnpm --filter api exec vitest run ${SUITE} -t ${JSON.stringify(nameFilter)}`,
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

// THE CONTROL (:9509): an UNMUTATED run of every filter this sweep will use,
// through the same command, must report GREEN and must produce a tally. A
// filter that matches no test would otherwise make its mutant look ALIVE, and
// a suite that cannot start would make every mutant look RED.
console.log('control (unmutated) — every filter must be GREEN and must tally ...');
for (const filter of [...new Set(MUTANTS.map((m) => m.expect))]) {
  const { out, failed, fault } = run(filter);
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

  const { out, failed, fault } = run(m.expect);

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
