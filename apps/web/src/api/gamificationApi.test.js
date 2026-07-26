// P2.8 web repoint (XP display card) — these tests pin the REPOINT and the
// honest-unknown rule, the two things a future edit could quietly undo:
//   · getMe rides the Card-1 cookie client on /v1/gamification/me;
//   · the badge-catalog / challenges / leaderboard reads STILL ride mlApi — a
//     regression here means someone "finished" the repoint by deleting a
//     feature, which the NO-REMOVAL rule forbids (the progressApi.test.js
//     guard for getPredictions, same shape);
//   · readXpView returns NULL for anything it cannot trust, and never a
//     zero-filled object — the `|| 2000` / `|| 1` fabrication class.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import authApi from './authApi';
import mlApi from './mlApi';
import {
  UNKNOWN, formatLevel, formatXpProgress, formatXpTotal,
  gamificationService, readXpView,
} from './gamificationApi';

function recordRequests(api) {
  const seen = [];
  api.defaults.adapter = async (config) => {
    seen.push({ url: config.url, method: config.method, params: config.params, data: config.data });
    return { data: {}, status: 200, statusText: '', headers: {}, config, request: {} };
  };
  return seen;
}

const validXp = {
  total: 330,
  level: 3,
  xpInLevel: 52,
  xpForNext: 374,
  progressPct: 13.9,
  nextLevelAt: 722,
};

afterEach(() => {
  authApi.defaults.adapter = undefined;
  mlApi.defaults.adapter = undefined;
  vi.unstubAllGlobals();
});

describe('gamificationService repoint (XP display card)', () => {
  it('getMe hits the NEW /v1/gamification/me on the cookie client', async () => {
    const newSeen = recordRequests(authApi);
    const oldSeen = recordRequests(mlApi);
    await gamificationService.getMe();
    expect(newSeen).toEqual([
      { url: '/v1/gamification/me', method: 'get', params: undefined, data: undefined },
    ]);
    expect(oldSeen).toEqual([]);
  });

  it('badge catalog, challenges and leaderboard STILL ride the OLD client', async () => {
    // mlApi's request interceptor reads localStorage (browser-only client;
    // it dies at P2.8) — stub it for the node test env.
    vi.stubGlobal('localStorage', { getItem: () => null });
    const oldSeen = recordRequests(mlApi);
    const newSeen = recordRequests(authApi);
    await gamificationService.getOverview();
    await gamificationService.getBadges();
    await gamificationService.getLeaderboard(5);
    expect(oldSeen.map((s) => s.url)).toEqual([
      '/gamification/overview',
      '/gamification/badges',
      '/gamification/leaderboard',
    ]);
    expect(oldSeen[2].params).toEqual({ limit: 5 });
    expect(newSeen).toEqual([]);
  });
});

describe('readXpView — null means unknown, never a fabricated number', () => {
  it('returns the block when every field is a finite number', () => {
    expect(readXpView({ xp: validXp })).toEqual(validXp);
  });

  it('returns null when the response carries no xp block', () => {
    // The endpoint predating PR #50 is exactly this case.
    expect(readXpView({ streak: { current: 3 } })).toBeNull();
    expect(readXpView({})).toBeNull();
    expect(readXpView(null)).toBeNull();
    expect(readXpView(undefined)).toBeNull();
  });

  it('returns null when ANY single field is missing', () => {
    // Server-side every field is a pure function of `total` (badges.py
    // xp_progress:240-253), so a partial block is a contract change, not a
    // degraded-but-usable value.
    for (const f of Object.keys(validXp)) {
      const partial = { ...validXp };
      delete partial[f];
      expect(readXpView({ xp: partial }), `missing ${f}`).toBeNull();
    }
  });

  it('returns null for non-numeric, NaN or Infinite fields', () => {
    expect(readXpView({ xp: { ...validXp, level: '3' } })).toBeNull();
    expect(readXpView({ xp: { ...validXp, total: null } })).toBeNull();
    expect(readXpView({ xp: { ...validXp, progressPct: NaN } })).toBeNull();
    expect(readXpView({ xp: { ...validXp, xpInLevel: Infinity } })).toBeNull();
    expect(readXpView({ xp: 'nope' })).toBeNull();
  });

  it('rejects Infinity on progressPct, which the shared schema alone allows', () => {
    // The five .int() fields reject it; progressPct is a bare z.number(), so
    // readXpView carries one extra finite check (verified, not assumed).
    expect(readXpView({ xp: { ...validXp, progressPct: Infinity } })).toBeNull();
  });

  it('NEVER substitutes zeros or a level 1 for an unusable block', () => {
    // The mutation guard: reintroducing a `?? 0` / `|| 1` default anywhere in
    // readXpView must turn this red. A caller renders null as "—"; a
    // zero-filled object would render as a real, wrong number instead.
    for (const bad of [null, {}, { xp: {} }, { xp: { total: 0 } }]) {
      expect(readXpView(bad)).toBeNull();
    }
    // A genuine all-zero user (brand new account) is NOT unknown and must pass.
    const zeroUser = { total: 0, level: 1, xpInLevel: 0, xpForNext: 100, progressPct: 0, nextLevelAt: 100 };
    expect(readXpView({ xp: zeroUser })).toEqual(zeroUser);
  });
});

// The formatters exist because T3 proved the guard was tested at the READER
// while the original bug (`user?.level || 1`) lived at a RENDER SITE: reverting
// all three call sites to `xp?.level || 1` left the whole suite green. Every
// site now goes through these, so a fabricated fallback fails HERE.
describe('render formatters — the render-site half of the fabrication guard', () => {
  it('formats a real block', () => {
    expect(formatLevel(validXp)).toBe('3');
    expect(formatXpTotal(validXp)).toBe((330).toLocaleString());
    expect(formatXpProgress(validXp)).toBe('52/374 to Lv 4');
  });

  it('renders UNKNOWN — never 0, never Level 1 — when xp is null', () => {
    expect(formatLevel(null)).toBe(UNKNOWN);
    expect(formatXpTotal(null)).toBe(UNKNOWN);
    expect(formatXpProgress(null)).toBe(`${UNKNOWN}/${UNKNOWN} to Lv ${UNKNOWN}`);
    // The exact regression this card was opened for: a null block must never
    // read as a plausible beginner account.
    expect(formatLevel(null)).not.toBe('1');
    expect(formatXpTotal(null)).not.toBe('0');
  });

  it('a genuine level-1 account still renders 1, not UNKNOWN', () => {
    const zeroUser = { total: 0, level: 1, xpInLevel: 0, xpForNext: 100, progressPct: 0, nextLevelAt: 100 };
    expect(formatLevel(zeroUser)).toBe('1');
    expect(formatXpTotal(zeroUser)).toBe('0');
  });
});

// Usage guard (the nutritionApi.test.js precedent, DECISIONS 2026-07-19).
//
// ROUND 2 ④/⑤ MEASURED THE FIRST VERSION AND IT WAS A SIEVE: 9 of 11 realistic
// re-introductions passed it, including `{xp ? xp.level : 1}` — this codebase's
// own idiom — plus `const lvl = xp?.level`, destructuring defaults, bracket
// access, and a default substituted inside useXp.js, which defeated BOTH layers.
// A blacklist of spellings can only ever catch the spelling it was written
// against, which is the "fix the class, not the case" failure this project has
// recorded five rounds running on xp.ts.
//
// So the rule is now POSITIVE and much narrower: **a component may not read a
// FIELD of `xp` at all.** It passes the whole object to a helper in
// gamificationApi.js, or truth-tests it to pick a layout. Every bypass above
// requires reading a field, so all of them now fail. useXp.js is scanned too,
// since substituting a default there defeats everything downstream — and the
// list is DERIVED from the files that import the hook, so the next card's
// Dashboard site is covered on the day it is written rather than being outside
// the guard by construction (④'s last point).
const HOOK_CONSUMERS_DIR = '../..';

/** Every file that consumes useXp, found rather than hardcoded. */
function xpConsumers() {
  const root = fileURLToPath(new URL(HOOK_CONSUMERS_DIR, import.meta.url));
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.jsx?$/.test(e.name)) continue;
      const src = readFileSync(full, 'utf8');
      if (/from\s+['"][^'"]*hooks\/useXp['"]/.test(src)) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** Source with comments removed. The first cut of this guard flagged its own
 *  explanatory comment in Sidebar.jsx ("the previous `user?.level || 1` ...") —
 *  the trap nutritionApi.test.js already names: "prose is not a dependency".
 *  A comment must be free to describe the bug that was fixed. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
function code(rel) {
  return stripComments(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
}

describe('render sites never fabricate an XP value', () => {
  it('finds every useXp consumer by import, not by a hardcoded list', () => {
    const found = xpConsumers().map((f) => basename(f)).sort();
    // Fails loudly if a site is renamed/moved (④'s ENOENT note) or if a NEW
    // consumer appears without this guard being considered.
    expect(found).toEqual([
      'Achievements.jsx', 'Dashboard.jsx', 'GamificationStrip.jsx', 'Sidebar.jsx',
    ]);
  });

  it.each([
    '../components/common/Sidebar.jsx',
    '../components/dashboard/GamificationStrip.jsx',
    '../pages/Achievements.jsx',
    '../pages/Dashboard.jsx',
  ])('%s reads no FIELD of xp — only helpers may', (rel) => {
    const src = code(rel);
    // `xp.level`, `xp?.total`, `xp["level"]`, and any fallback built on them.
    // Lookbehind excludes `entry.xp` — the OLD leaderboard row's own XP, a
    // different value that stays on the old backend under no-removal. Without
    // it this guard false-positives on Achievements.jsx and would push someone
    // toward "fixing" a surface another card owns.
    expect(src).not.toMatch(/(?<![.\w$])xp\s*\??\s*(\.\s*\w+|\[)/);
    // Destructuring a field out of the hook's return is the same read.
    expect(src).not.toMatch(/\{[^}]*\b(level|total|xpInLevel|xpForNext|progressPct|nextLevelAt)\b[^}]*\}\s*=\s*(useXp|xp)\b/);
    // The pre-card shape stays gone.
    expect(src).not.toMatch(/\buser(Data)?\s*\??\.\s*(xp|level)\b/);
    expect(src).not.toMatch(/xp_in_level|xp_for_next|progress_pct/);
  });

  it('useXp.js substitutes no default for a missing block', () => {
    const src = code('../hooks/useXp.js');
    // `xp ?? { level: 1 }` / `|| {}` inside the hook defeats every downstream
    // guard at once, so it is checked at the source too (④).
    expect(src).not.toMatch(/(\?\?|\|\|)\s*\{/);
    expect(src).toMatch(/readXpView\s*\(/);
  });
});

// ROUND 1 ① / ROUND 2 ②: the XP block must not be gated behind the OLD
// backend's payload. Round 2 measured the first version of THIS guard too:
// `if (!data) { return null; }` (braces), `if (!(data))`, returning a spinner
// instead of null, and gating the JSX subtree all passed it — and the
// Achievements assertion compared two string indices, so it could not see the
// `if (loading) return <spinner>` that was sitting above the header in the
// shipped code. Both are now checked by SHAPE rather than by one spelling.
describe('XP renders independently of the old-backend payload', () => {
  it.each([
    '../components/dashboard/GamificationStrip.jsx',
    '../pages/Achievements.jsx',
  ])('%s has no early return gated on the old payload alone', (rel) => {
    const src = code(rel);
    // Any `if (!data …) return …` in any bracing/spelling.
    expect(src).not.toMatch(/if\s*\(\s*!\s*\(?\s*data\b[\s\S]{0,40}?\)\s*\{?\s*return/);
    // A bare `if (loading)` gate is the round-2 ② hole: `loading` belongs to the
    // OLD read, so it must always be paired with `!xp`.
    expect(src).not.toMatch(/if\s*\(\s*loading\s*\)/);
    // And the pairing must actually be present where a loading gate exists.
    if (/\bloading\b/.test(src)) expect(src).toMatch(/loading\s*&&\s*!\s*xp/);
  });

  it('Achievements renders the XP header BEFORE the old-payload failure notice', () => {
    const src = code('../pages/Achievements.jsx');
    const header = src.indexOf('formatLevel(xp)');
    const notice = src.indexOf('Failed to load achievements');
    expect(header, 'XP header render site not found').toBeGreaterThan(-1);
    expect(notice, 'failure notice not found').toBeGreaterThan(-1);
    expect(header).toBeLessThan(notice);
  });
});

// ROUND 2 ①: hoisting XP out of the old payload made the OTHER cards render on
// a failed old read for the first time, and they fabricated — "of 0", "(0/-)",
// "0 of - badges", "Complete workouts to earn your first badge". Unreachable
// before this card; the PERMANENT state on this branch.
describe('the old-payload cards claim nothing when the payload is absent', () => {
  it.each([
    '../components/dashboard/GamificationStrip.jsx',
    '../pages/Achievements.jsx',
  ])('%s applies no numeric fallback to an old-payload count', (rel) => {
    const src = code(rel);
    expect(src).not.toMatch(/total_users\s*(\|\||\?\?)\s*\d/);
    expect(src).not.toMatch(/total_count\s*(\|\||\?\?)\s*\d/);
    // A raw `earnedBadges.length` printed with no oldReady gate would claim
    // zero earned badges when nothing is known.
    expect(src).toMatch(/\boldReady\b/);
  });
});
