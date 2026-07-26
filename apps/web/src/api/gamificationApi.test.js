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
  UNKNOWN, badgesKnown, challengesKnown, formatLevel, formatXpProgress,
  formatXpTotal, gamificationService, oldPayloadState, readXpView,
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


// ── Source guards ───────────────────────────────────────────────────────────
// Precedent: nutritionApi.test.js's usage guard (DECISIONS 2026-07-19).
//
// THREE ROUNDS OF REVIEW HAVE DEFEATED THESE, so read the history before
// trusting them. Round 1's guard sat at the reader, not the render site. Round
// 2's was a blacklist of spellings — 9 of 11 real re-introductions passed it.
// Round 3 then defeated round 2's replacement FOUR ways, each with pasted
// output: a legitimate string containing a block-comment opener made the strip
// eat the file so the negative assertions passed vacuously; a component
// receiving `xp` as a PROP was never scanned; a bare `toMatch(/oldReady/)` was a
// presence check that one surviving use satisfied for a whole file; and round
// 2's own new `oldReady` variable became a fresh way to re-gate XP behind the
// old payload, invisible to a regex that only knew the spelling `data`.
//
// What is different now:
//   · the field-read scan runs over EVERY .js/.jsx under src (0 hits today), so
//     a prop-receiving or newly-extracted component cannot escape;
//   · the per-file list is DERIVED from xpConsumers(), not a second literal —
//     round 3 proved that two lists means editing the wrong one silences it;
//   · every negative block carries a POSITIVE anchor, which is this card's own
//     0x08 lesson: negative assertions alone cannot tell "nothing to catch"
//     from "cannot catch anything";
//   · the strip is asserted not to have eaten the file.
// These are still source text, not behaviour. BEHAVIOUR is covered by the pure
// helper tests at the end (oldPayloadState / badgesKnown / challengesKnown),
// because vitest runs environment:"node" and the jsdom project is still owed.

// `src/`, NOT `apps/web/`. The first cut used '../..', which walked the whole
// package and scanned `dist/` build output (date-fns.js, lib-<hash>.js) and
// vitest.config.js — 16 false offenders. Verified by the failure list, not by
// reading the URL rules.
const SRC_ROOT = '..';

function walkSrc(pred) {
  const root = fileURLToPath(new URL(SRC_ROOT, import.meta.url));
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.jsx?$/.test(e.name)) continue;
      if (/\.test\.jsx?$/.test(e.name)) continue;
      if (pred(full, readFileSync(full, 'utf8'))) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** Every file that consumes useXp — found, never hardcoded. */
function xpConsumers() {
  return walkSrc((_f, src) => /from\s+['"][^'"]*hooks\/useXp['"]/.test(src));
}

/** Round 3 inserted a single string containing a block-comment opener into
 *  Sidebar.jsx; the regex paired it with a later closer, swallowed the rest of
 *  the file, and the negative assertions passed with round 2's headline bug
 *  three lines below.
 *
 *  A size RATIO is the wrong instrument for that — measured, it flags 16 files
 *  in this heavily-commented codebase, where stripping legitimately removes more
 *  than half the bytes. The real defence is elsewhere and already present: an
 *  eaten file loses its HELPER CALLS, so the positive anchor below fails. Round
 *  3's own poison sat at Sidebar.jsx:122, i.e. above every helper call in the
 *  file, so that anchor catches exactly the demonstrated attack. The repo-wide
 *  scan below additionally matches on RAW as well as stripped, so a fabrication
 *  cannot hide behind a strip there either. */
function stripComments(raw) {
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function readCode(abs) {
  const raw = readFileSync(abs, 'utf8');
  return { raw, src: stripComments(raw) };
}

function codeAt(rel) {
  return readCode(fileURLToPath(new URL(rel, import.meta.url)));
}

const FIELD_READ = /(?<![.\w$])xp\s*\??\s*(\.\s*\w+|\[)/;
const HELPER_CALL = /format(Level|XpTotal|XpFraction|NextLevel|XpProgress)\s*\(|xpBarWidth\s*\(/;

describe('no file under src reads a FIELD of xp — only gamificationApi.js may', () => {
  // Repo-wide, so a component receiving `xp` as a PROP (XPBar today) or one
  // extracted to a new file tomorrow is covered by construction. Round 3
  // mutation-proved both escapes against the importer-only version.
  const scanned = walkSrc((f) => !/gamificationApi\.js$/.test(f));

  it('scans a plausible number of files', () => {
    expect(scanned.length).toBeGreaterThan(20);
  });

  it('every scanned file is field-read clean', () => {
    // The RAW check applies only to NON-consumers. A consumer legitimately
    // DISCUSSES these fields in prose — GamificationStrip's comment explains
    // that `xp.nextLevelAt` is a cumulative threshold rather than a level
    // number, and banning that spelling in a comment is the "prose is not a
    // dependency" trap this guard already fell into once (round 2). Consumers
    // are protected instead by the POSITIVE helper-call anchor below, which is
    // what actually catches round 3's strip-eating attack. For a non-consumer
    // there is no reason even to mention a field of `xp`, so raw is checked and
    // a fabrication cannot hide behind an eaten strip. Measured: 0 offenders.
    const consumers = new Set(xpConsumers());
    const offenders = [];
    for (const abs of scanned) {
      const { raw, src } = readCode(abs);
      if (FIELD_READ.test(src)) offenders.push(basename(abs) + ': reads a field of xp');
      else if (!consumers.has(abs) && FIELD_READ.test(raw)) {
        offenders.push(basename(abs) + ': mentions a field of xp — non-consumers should not, check the strip did not eat code');
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the useXp consumers render through helpers', () => {
  it('finds every consumer by import, not by a hardcoded list', () => {
    expect(xpConsumers().map((f) => basename(f)).sort()).toEqual([
      'Achievements.jsx', 'Dashboard.jsx', 'GamificationStrip.jsx', 'Sidebar.jsx',
    ]);
  });

  it('each consumer POSITIVELY calls a helper', () => {
    const consumers = xpConsumers();
    expect(consumers.length).toBeGreaterThan(0);
    for (const abs of consumers) {
      const { src } = readCode(abs);
      // THE anchor that closes round 3's strip-eating attack, and the standing
      // 0x08 lesson: without a positive assertion, deleting every helper call —
      // or having the strip swallow them — passes silently.
      expect(src, basename(abs) + ': no helper call').toMatch(HELPER_CALL);
      expect(src, basename(abs) + ': pre-card shape').not.toMatch(/\buser(Data)?\s*\??\.\s*(xp|level)\b/);
      expect(src, basename(abs) + ': snake_case shape').not.toMatch(/xp_in_level|xp_for_next|progress_pct/);
    }
  });
});

describe('XP renders independently of the old-backend payload', () => {
  const gated = [
    '../components/dashboard/GamificationStrip.jsx',
    '../pages/Achievements.jsx',
  ];

  it.each(gated)('%s has no early return gated on the old payload', (rel) => {
    const { src } = codeAt(rel);
    // Round 3 F7: the DERIVED names count too, not just `data`.
    expect(src).not.toMatch(
      /if\s*\(\s*!\s*\(?\s*(data|oldReady|oldState|statsKnown|badgesKnown|challengesKnown)\b[\s\S]{0,40}?\)\s*\{?\s*return/,
    );
    // A bare `if (loading)` gate is the round-2 ② hole: `loading` is the OLD
    // read's, so it must always be paired with `!xp`.
    expect(src).not.toMatch(/if\s*\(\s*loading\s*\)/);
    expect(src).toMatch(/loading\s*&&\s*!\s*xp/);
  });
});

describe('the old-payload cards claim nothing they do not know', () => {
  // Round 3 F6: presence of `oldReady` ANYWHERE satisfied the previous
  // assertion for a whole file, so reverting one counter passed green. These
  // name the SITES instead.
  it('GamificationStrip gates each count and empty state on per-card knowledge', () => {
    const { src } = codeAt('../components/dashboard/GamificationStrip.jsx');
    expect(src).toMatch(/badgesKnown\(data\)\s*\?\s*earnedBadges\.length/);
    expect(src).toMatch(/challengesKnown\(data\)\s*\?/);
    expect(src).not.toMatch(/total_users\s*(\|\||\?\?)\s*\d/);
    expect(src).not.toMatch(/total_count\s*(\|\||\?\?)\s*\d/);
  });

  it('Achievements gates its header count and BOTH tab counts', () => {
    const { src } = codeAt('../pages/Achievements.jsx');
    expect(src).toMatch(/badgesKnown\(data\)\s*\?\s*earnedBadges\.length\s*:\s*UNKNOWN/);
    expect(src).toMatch(/challengesKnown\(data\)/);
    // Round 3 F5: the tab counts were `{data &&}`-only and `?? 0`.
    expect(src).not.toMatch(/active\?\.length\s*\?\?\s*0/);
  });

  it('Dashboard gates its own old-stats figures (review of 888e750, F1)', () => {
    const { src } = codeAt('../pages/Dashboard.jsx');
    // stats null => s = {} => every `|| 0` fired, so a real Level sat beside
    // fabricated zeros and lent them credibility.
    expect(src).toMatch(/statsKnown/);
    expect(src).not.toMatch(/s\.(total_workouts|total_minutes|total_calories|weekly_workouts|streak)\s*\|\|\s*0/);
  });
});

describe('the old payload is read with every nested field guarded', () => {
  // Round 3 F1: `leaderboard.leaderboard.map` was the twin of the read round 2
  // ③ claimed to have fixed, left unguarded by the same commit.
  it.each([
    '../components/dashboard/GamificationStrip.jsx',
    '../pages/Achievements.jsx',
  ])('%s never dereferences a nested old-payload field bare', (rel) => {
    const { src } = codeAt(rel);
    // Only the reads with NO guard of their own. `challenges.active.slice` and
    // `badges.all.filter` are deliberately NOT banned — they now sit inside a
    // `challengesKnown(data) ? …` / `badgesKnown(data) ? …` ternary, which the
    // per-site assertions above require. Banning the spelling instead would
    // forbid the correct code, which is how a guard starts pushing people toward
    // worse shapes to keep it quiet.
    expect(src).not.toMatch(/\bleaderboard\.leaderboard\s*\./);
    expect(src).not.toMatch(/\{\s*leaderboard\.total_users\s*\}/);
    expect(src).not.toMatch(/\{\s*entry\.xp\.toLocaleString/);
  });
});

describe('old-payload state is a pure function, so all four states are testable', () => {
  it('distinguishes loading from failed — the round 3 F2 defect', () => {
    expect(oldPayloadState({ data: { badges: {} }, loading: false })).toBe('ready');
    expect(oldPayloadState({ data: { badges: {} }, loading: true })).toBe('ready');
    // THE ONE THAT MATTERED: new API answered, old read still IN FLIGHT. This
    // must not be "failed", or the screen claims failure during a healthy load.
    expect(oldPayloadState({ data: null, loading: true })).toBe('loading');
    expect(oldPayloadState({ data: null, loading: false })).toBe('failed');
  });

  it('per-card knowledge asks whether the list can be enumerated', () => {
    expect(badgesKnown({ badges: { all: [] } })).toBe(true);
    expect(challengesKnown({ challenges: { active: [] } })).toBe(true);
    // Round 3 F5: a 200 with `{}` — the shape this file's own adapter returns.
    expect(badgesKnown({})).toBe(false);
    expect(challengesKnown({})).toBe(false);
    expect(badgesKnown({ badges: {} })).toBe(false);
    expect(challengesKnown({ challenges: {} })).toBe(false);
    expect(badgesKnown(null)).toBe(false);
    expect(challengesKnown(null)).toBe(false);
    expect(badgesKnown({ badges: { all: 'nope' } })).toBe(false);
  });
});
