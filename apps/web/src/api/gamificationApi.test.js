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
import { readFileSync } from 'node:fs';
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
// Formatters make the CORRECT path tested and single; they do not stop a future
// edit from writing `xp?.level || 1` straight into a component — which is the
// exact line this card was opened to delete, so "less likely" is not closed.
// This scans the three repointed render sites for the fabrication pattern. It
// needs no DOM and no new dependency, so CI runs it.
const RENDER_SITES = [
  '../components/common/Sidebar.jsx',
  '../components/dashboard/GamificationStrip.jsx',
  '../pages/Achievements.jsx',
];

/** Source with comments removed. The first cut of this guard flagged its own
 *  explanatory comment in Sidebar.jsx ("the previous `user?.level || 1` …") —
 *  the trap nutritionApi.test.js already names: "prose is not a dependency".
 *  A comment must be free to describe the bug that was fixed. */
function code(rel) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('render sites never fabricate an XP value', () => {
  it.each(RENDER_SITES)('%s applies no numeric fallback to an xp read', (rel) => {
    const src = code(rel);
    // `xp.level || 1`, `xp?.total ?? 0`, `xp.xpForNext || 100`, …
    expect(src).not.toMatch(/\bxp\s*\??\.\s*\w+\s*(\|\||\?\?)\s*-?\d/);
    // …and the old shape is gone for good: `user.level`, `user.xp`,
    // `userData.progress.xp_in_level` were the pre-card reads.
    expect(src).not.toMatch(/\buser(Data)?\s*\??\.\s*(xp|level)\b/);
    expect(src).not.toMatch(/xp_in_level|xp_for_next|progress_pct/);
  });

  it('every render site imports the formatters rather than reaching into xp', () => {
    for (const rel of RENDER_SITES) {
      expect(code(rel), rel).toMatch(/from\s+['"][^'"]*gamificationApi['"]/);
    }
  });
});

// T3 finding ①: the XP block must not be gated behind the OLD backend's
// payload. A separate fetch is not independence if the render is still inside
// `if (!data) return …` — and that state is PERMANENT on this branch, not an
// edge case. Both assertions are decidable source facts, so they need no DOM.
describe('XP renders independently of the old-backend payload', () => {
  it('GamificationStrip does not gate its early return on the old payload', () => {
    const src = code('../components/dashboard/GamificationStrip.jsx');
    expect(src).not.toMatch(/if\s*\([^)]*\bdata\b[^)]*\)\s*return\s+null/);
  });

  it('Achievements renders the XP header BEFORE the old-payload failure notice', () => {
    const src = code('../pages/Achievements.jsx');
    const header = src.indexOf('formatLevel(xp)');
    const notice = src.indexOf('Failed to load achievements');
    expect(header, 'XP header render site not found').toBeGreaterThan(-1);
    expect(notice, 'failure notice not found').toBeGreaterThan(-1);
    // If the notice comes first it is an early return that takes XP down too.
    expect(header).toBeLessThan(notice);
  });
});
