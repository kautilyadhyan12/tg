/**
 * Mutation audit — sign-in by 6-digit email code (Kd 2026-09-07).
 * Run from the repo root with DATABASE_URL pointing at the LOCAL database:
 *   `DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg node apps/api/tools/mutate-auth.mjs`
 *
 * WHY: CLAUDE.md §4 — mutation harnesses run when sign-in code changes. Every
 * row below is a rule Kd set or a security property the door depends on, and
 * each names the test that must go RED when the rule is deleted:
 *   · the day cap, the resend gap, the replace-on-resend, the five guesses
 *   · single use, expiry, the address as tenant, the purpose as key
 *   · a failed send not spending the day, a deleted account staying shut,
 *     a proved code verifying the address, deletion needing its own code
 *
 * Deliberately NOT mutated: wording, the email templates, the rate-limit
 * numbers (the database rules are the real limits), and the belt-and-braces
 * checks that a stricter sibling already covers (the pre-compare attempts
 * guard in codes.ts; the address inside the HMAC — the row is keyed by address
 * before the hash is ever compared, so no test can see it and it is recorded
 * here as defence in depth rather than as a guarantee).
 *
 * Class fixes inherited from mutate-orgs.mjs: an anchor that matches anything
 * but exactly once ABORTS · a non-local DATABASE_URL ABORTS before a byte is
 * written · an unmutated CONTROL must be GREEN and must tally · restores are
 * sha256-verified after EVERY mutant · a RUNNER fault is not a RED · utf8
 * read/write, never `sed -i`.
 *
 * NO MUTANT IS EXPECTED ALIVE.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SUITE = 'test/auth.code.test.ts';
/** The Day-14 purge has its own suite; the one row aimed at it says so. */
const PURGE_SUITE = 'test/privacy.purge.test.ts';

const TARGETS = {
  codes: { file: resolve(ROOT, 'apps/api/src/modules/auth/codes.ts') },
  repo: { file: resolve(ROOT, 'apps/api/src/modules/auth/repo.ts') },
  service: { file: resolve(ROOT, 'apps/api/src/modules/auth/service.ts') },
  users: { file: resolve(ROOT, 'apps/api/src/modules/users/service.ts') },
  routes: { file: resolve(ROOT, 'apps/api/src/modules/auth/routes.ts') },
  privacy: { file: resolve(ROOT, 'apps/api/src/modules/privacy/repo.ts') },
};

const MUTANTS = [
  {
    id: 'A1',
    target: 'codes',
    why: "Kd's cap: the day allows THREE codes instead of two",
    expect: 'two codes a day',
    from: '  if (unproved.length >= SIGN_IN_CODE_RULES.maxCodesPerDay) {',
    to: '  if (unproved.length > SIGN_IN_CODE_RULES.maxCodesPerDay) {',
  },
  {
    id: 'A15',
    target: 'repo',
    why: 'the per-address lock is gone, so two requests arriving together both read "none so far" and both issue',
    expect: 'arriving together',
    from: '    await tx`SELECT pg_advisory_xact_lock(hashtext(${`${input.email}|${input.purpose}`}))`;\n',
    to: '',
  },
  {
    id: 'A16',
    target: 'routes',
    why: 'the ceiling across everyone is gone — a client varying the address sends an unbounded number of emails on Kd\'s bill',
    expect: 'ceiling across ALL addresses',
    from: '    if (sentToday >= deps.config.CODE_EMAILS_PER_DAY) {',
    to: '    if (false) {',
  },
  {
    id: 'A17',
    target: 'privacy',
    why: "PRIVACY: the Day-14 erasure no longer removes the address from sign_in_codes, so a purged person's email outlives §5.2's tombstone",
    expect: 'address-keyed table',
    suite: PURGE_SUITE,
    from: "  await tx`\n    DELETE FROM sign_in_codes\n    WHERE email = (SELECT email FROM users WHERE id = ${userId})`;",
    to: '  await Promise.resolve();',
  },
  {
    id: 'A18',
    target: 'codes',
    why: 'asking for a code no longer says the same thing for every address — a refusal carries a different body when the account exists',
    expect: 'never reveals',
    from: '    if (sinceLast < gapMs) throw tooSoon(gapMs - sinceLast);',
    to: '    if (sinceLast < gapMs) throw new AuthError(429, "code_too_soon", "Please wait.", 1);',
    // NOTE: this mutant is expected ALIVE-by-design and is kept for the record:
    // the never-reveals test compares a known and an unknown address through
    // the SAME code path, so a change that affects both equally cannot be seen
    // by it. What the test guards against is a branch on findUserByEmail in
    // the send path, which this harness cannot express as a text mutant
    // without inventing one. Recorded, not hidden (:27659).
    aliveByDesign: true,
  },
  {
    id: 'A2',
    target: 'codes',
    why: "Kd's gap: a resend is allowed at once, so a flood of emails to one address is one click",
    expect: 'resend inside sixty seconds',
    from: '    if (sinceLast < gapMs) throw tooSoon(gapMs - sinceLast);',
    to: '    if (false) throw tooSoon(gapMs - sinceLast);',
  },
  {
    id: 'A3',
    target: 'repo',
    why: 'five wrong guesses no longer kill the code — a million guesses are allowed',
    expect: 'five wrong guesses',
    from: 'CASE WHEN attempts + 1 >= ${maxAttempts} THEN now() ELSE expires_at END',
    to: 'CASE WHEN attempts + 1 >= ${maxAttempts} + 1000000 THEN now() ELSE expires_at END',
  },
  {
    id: 'A4',
    target: 'codes',
    why: 'THE DOOR IS OPEN: any six digits are accepted for any address',
    expect: 'five wrong guesses',
    from: '  const matches = expected.length === presented.length && timingSafeEqual(expected, presented);',
    to: '  const matches = true;',
  },
  {
    id: 'A5',
    target: 'repo',
    why: 'a code is no longer single use — two presentations at once BOTH sign in (a plain replay is also caught by the live-code read, so the race is the observation)',
    expect: 'exactly one wins',
    from: '    WHERE id = ${id} AND used_at IS NULL AND expires_at > now()\n    RETURNING id`;',
    to: '    WHERE id = ${id}\n    RETURNING id`;',
  },
  {
    id: 'A6',
    target: 'repo',
    why: 'an expired code is still live — ten minutes becomes for ever',
    expect: 'an expired code is refused',
    from: '    WHERE email = ${email} AND purpose = ${purpose}\n      AND used_at IS NULL AND expires_at > now()',
    to: '    WHERE email = ${email} AND purpose = ${purpose}\n      AND used_at IS NULL',
  },
  {
    id: 'A7',
    target: 'repo',
    why: "OWNERSHIP, the worst case: the live-code read is no longer scoped to the address, so one person's code opens another's account",
    expect: 'opens NO other account',
    from: '    WHERE email = ${email} AND purpose = ${purpose}\n      AND used_at IS NULL AND expires_at > now()',
    to: '    WHERE purpose = ${purpose}\n      AND used_at IS NULL AND expires_at > now()',
  },
  {
    id: 'A8',
    target: 'repo',
    why: 'the purpose is no longer part of the key, so a SIGN-IN code deletes the account',
    expect: 'delete-account',
    from: '    WHERE email = ${email} AND purpose = ${purpose}\n      AND used_at IS NULL AND expires_at > now()',
    to: '    WHERE email = ${email}\n      AND used_at IS NULL AND expires_at > now()',
  },
  {
    id: 'A9',
    target: 'codes',
    why: 'a failed send still spends one of the two: an email outage locks people out for the day',
    expect: 'email cannot be sent',
    from: '    await repo.deleteCode(deps.sql, id);',
    to: '    await Promise.resolve();',
  },
  {
    id: 'A10',
    target: 'service',
    why: 'an account mid-deletion can be entered by code — the deleted state is not a lock',
    expect: 'mid-deletion',
    from: '  if (user.status !== "active") {\n    // The person has just PROVED',
    to: '  if (false) {\n    // The person has just PROVED',
  },
  {
    id: 'A11',
    target: 'service',
    why: 'a proved code no longer marks the address verified — the screen would say "unverified" of an address the person just proved',
    expect: 'the right code signs in',
    from: '  await ensureEmailVerified(deps, user.id);\n  return {\n    user: await toAuthUser(deps.sql, user),\n    tokens: await issueSession(deps, user.id, meta),\n    isNewAccount,',
    to: '  await Promise.resolve();\n  return {\n    user: await toAuthUser(deps.sql, user),\n    tokens: await issueSession(deps, user.id, meta),\n    isNewAccount,',
  },
  {
    id: 'A12',
    target: 'repo',
    why: "Kd's rule that a resend REPLACES the code: the old code stays live beside the new one",
    expect: 'REPLACES',
    from: '    await tx`\n      UPDATE sign_in_codes SET expires_at = now()\n      WHERE email = ${input.email} AND purpose = ${input.purpose}\n        AND used_at IS NULL AND expires_at > now()`;\n',
    to: '',
  },
  {
    id: 'A13',
    target: 'users',
    why: 'deleting an account no longer checks the code — any six digits, or a stale one, deletes',
    expect: 'delete-account',
    from: '  await redeemEmailCode(\n    { sql: deps.sql, config: deps.config, log: deps.log },\n    { email: row.email, purpose: "delete_account", code },\n  );',
    to: '  await Promise.resolve();',
  },
  {
    id: 'A14',
    target: 'repo',
    why: "the day's count never forgets: yesterday's codes count for ever, so an address is locked out after its second code of all time",
    expect: 'two codes a day',
    from: '      WHERE email = ${input.email} AND purpose = ${input.purpose} AND created_at >= ${input.since}',
    to: '      WHERE email = ${input.email} AND purpose = ${input.purpose}',
  },
  {
    id: 'A19',
    target: 'codes',
    why: "a code that signed the person in counts against the day again, so two sign-ins and a resend lock an address out (Kd's 2026-09-08 amendment gone)",
    expect: 'signed you in does not count',
    from: '  const unproved = recent.filter((r) => r.usedAt === null);',
    to: '  const unproved = recent;',
  },
  {
    id: 'A20',
    target: 'codes',
    why: 'the sixty-second gap forgets a code once it has signed the person in — someone who can read the inbox signs in and asks again in a loop, past the day cap',
    expect: 'immediately after signing in',
    from: '  const latest = recent[0];',
    to: '  const latest = unproved[0];',
  },
];

const STRIP_ANSI = /\x1b\[[0-9;]*m/g;
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const abort = (msg) => {
  console.error(`\nABORT: ${msg}`);
  process.exit(2);
};

// ── preflight ─────────────────────────────────────────────────────────────
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) abort('DATABASE_URL is not set. Point it at the LOCAL docker database.');
let host = '';
try {
  host = new URL(dbUrl).hostname;
} catch {
  abort('DATABASE_URL is not a URL.');
}
if (host !== 'localhost' && host !== '127.0.0.1') {
  abort(`DATABASE_URL host is "${host}" — this harness runs ONLY against localhost. Never against Kd's data.`);
}

const selected = process.argv.slice(2);
const SELECTED = selected.length === 0 ? MUTANTS : MUTANTS.filter((m) => selected.includes(m.id));
if (SELECTED.length === 0) abort(`no mutant matches ${selected.join(', ')}`);

/** Anchors are written with `\n`; files checked out on Windows carry `\r\n`.
 *  Matched in the file's OWN line ending, so a CRLF checkout does not turn
 *  every multi-line anchor into a zero-match abort (caught on the first run). */
const inFileEol = (src, text) => (src.includes('\r\n') ? text.replaceAll('\n', '\r\n') : text);

for (const m of SELECTED) {
  const t = TARGETS[m.target];
  if (t === undefined) abort(`${m.id}: target "${m.target}" is not in TARGETS`);
  const src = readFileSync(t.file, 'utf8');
  const n = src.split(inFileEol(src, m.from)).length - 1;
  if (n !== 1) abort(`${m.id}: anchor matches ${n} time(s) in ${m.target}; it must match exactly once`);
}

const tallied = (out) => {
  const clean = out.replace(STRIP_ANSI, '');
  return /Tests\s+(?:\d+ failed \| )?\d+ (?:passed|failed)/.test(clean) && !/No test files found/.test(clean);
};

const run = (nameFilter, suite = SUITE) => {
  try {
    const out = execSync(
      `corepack pnpm --filter api exec vitest run ${suite} -t ${JSON.stringify(nameFilter)}`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, env: process.env },
    );
    return { out, failed: false, fault: null };
  } catch (e) {
    if (typeof e.status === 'number' && e.status !== 0) {
      return { out: `${e.stdout || ''}${e.stderr || ''}`, failed: true, fault: null };
    }
    return { out: '', failed: false, fault: `${e.code || ''} ${e.message}` };
  }
};

// ── control: every filter GREEN and tallied before a byte is mutated ───────
console.log('control (unmutated) — every filter must be GREEN and must tally ...');
const controls = new Map();
for (const m of SELECTED) controls.set(`${m.suite ?? SUITE} :: ${m.expect}`, { suite: m.suite ?? SUITE, filter: m.expect });
for (const { suite, filter } of controls.values()) {
  const { out, failed, fault } = run(filter, suite);
  if (fault !== null) abort(`control for ${JSON.stringify(filter)}: the RUNNER failed — ${fault}`);
  if (!tallied(out)) abort(`control for ${JSON.stringify(filter)}: no test tally — the filter matches no test.`);
  if (failed) abort(`control for ${JSON.stringify(filter)}: RED before any mutation.`);
  console.log(`  control GREEN  ${filter}`);
}
console.log('control complete\n');

// ── the sweep ─────────────────────────────────────────────────────────────
const results = [];
for (const m of SELECTED) {
  const { file } = TARGETS[m.target];
  const original = readFileSync(file, 'utf8');
  const before = sha(file);
  writeFileSync(file, original.replace(inFileEol(original, m.from), inFileEol(original, m.to)), 'utf8');
  let verdict;
  let fault = null;
  try {
    const r = run(m.expect, m.suite ?? SUITE);
    fault = r.fault;
    verdict = r.fault !== null ? 'FAULT' : !tallied(r.out) ? 'NO-TALLY' : r.failed ? 'RED' : 'ALIVE';
  } finally {
    writeFileSync(file, original, 'utf8');
    if (sha(file) !== before) abort(`${m.id}: restore of ${file} is NOT byte-exact. Fix the tree by hand before anything else.`);
  }
  if (fault !== null) abort(`${m.id}: the RUNNER failed — ${fault}. (File restored.)`);
  const label = verdict === 'ALIVE' && m.aliveByDesign === true ? 'ALIVE (by design, see the row)' : verdict;
  results.push({ id: m.id, verdict: label, counted: !(m.aliveByDesign === true), why: m.why, expect: m.expect });
  console.log(`${label.padEnd(8)} ${m.id}  ${m.why}`);
}

console.log('\n| id | verdict | expected to notice |');
console.log('|---|---|---|');
for (const r of results) console.log(`| ${r.id} | ${r.verdict} | ${r.expect} |`);
const alive = results.filter((r) => r.counted && r.verdict !== 'RED');
console.log(`\n${results.length} mutants, ${results.filter((r) => r.verdict === 'RED').length} RED, ${alive.length} not RED and not by design. Every file restored (sha256-verified).`);
process.exit(alive.length === 0 ? 0 : 1);
