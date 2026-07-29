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
  UNKNOWN, difficultyColor, earnedBadgeCount, formatCount, formatFraction, formatLevel, formatXpEarned,
  formatXpProgress, formatXpTotal, gamificationService, listState,
  oldPayloadState, orUnknown, progressWidth, readBadge, readChallenge, tierStyle, xpBarWidth,
  readLeaderboardEntry, readLeaderboardView, readOverviewView,
  readRecentWorkout, readRecommendation, readRecommendations, readStatsView,
  readXpView,
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


// ── The old-payload readers ─────────────────────────────────────────────────
// ROUND 5 F5: these 132 lines shipped in round 4 as "the class fix" with NO
// direct coverage — the only mentions of them anywhere in the suite were a
// regex string in a source guard and a comment in the render file. That is why
// round 5's F2 and F3 survived a round: the render fixtures all used
// `all: []` / `active: []`, so `readBadge` and `readChallenge` never once
// produced output that a test looked at. A class fix with no tests on the class
// is a claim, not a fix.
describe('old-payload readers: every field is a usable value or NULL', () => {
  it('readChallenge maps names and nulls the rest', () => {
    expect(readChallenge({
      id: 'c1', name: 'Run 5k', icon: '🏃', difficulty: 'easy',
      description: 'go', current: 2, target: 5, progress: 40,
      xp_reward: 50, completed: false,
    })).toEqual({
      id: 'c1', name: 'Run 5k', icon: '🏃', difficulty: 'easy',
      description: 'go', current: 2, target: 5, progress: 40,
      xpReward: 50, completed: false,
    });
    // Everything unknown — and `completed` is NULL, not false (F2).
    expect(readChallenge({})).toEqual({
      id: null, name: null, icon: null, difficulty: null, description: null,
      current: null, target: null, progress: null, xpReward: null, completed: null,
    });
    expect(readChallenge(null).current).toBeNull();
    expect(readChallenge(undefined).completed).toBeNull();
  });

  it('readBadge nulls a missing `earned` rather than defaulting it to false', () => {
    // THE ROUND 5 F2 REGRESSION. `earned: b?.earned === true` turned "unknown"
    // into "not earned", which fed the count and printed "0 of 40 badges" and
    // "earn your first badge" to a user who has badges — verbatim the round-2
    // fabrication the round-4 commit message claimed was deleted.
    expect(readBadge({ id: 'b', tier: 'gold' }).earned).toBeNull();
    expect(readBadge({ earned: false }).earned).toBe(false);
    expect(readBadge({ earned: true }).earned).toBe(true);
    // Truthy non-booleans are NOT a yes.
    expect(readBadge({ earned: 'yes' }).earned).toBeNull();
    expect(readBadge({ earned: 1 }).earned).toBeNull();
    expect(readBadge({ xp_reward: 0 }).xpReward).toBe(0);   // a real zero survives
    expect(readBadge({ xp_reward: '25' }).xpReward).toBeNull();
    expect(readBadge({ name: '   ' }).name).toBeNull();     // whitespace is not a name
  });

  it('earnedBadgeCount refuses to count what it cannot answer', () => {
    expect(earnedBadgeCount(null)).toBeNull();
    expect(earnedBadgeCount([])).toBe(0);
    expect(earnedBadgeCount([{ earned: true }, { earned: false }])).toBe(1);
    // ONE unknown element makes the whole count unknown — the alternative is a
    // number that silently under-reports.
    expect(earnedBadgeCount([{ earned: true }, { earned: null }])).toBeNull();
    // Round 6 F12 guarded the ARGUMENT; round 7 F7 found the ELEMENT still
    // unguarded, so `[null]` threw one layer in — same shape, same surface.
    expect(earnedBadgeCount(undefined)).toBeNull();
    expect(earnedBadgeCount([null])).toBeNull();
    expect(earnedBadgeCount([undefined, { earned: true }])).toBeNull();
  });

  it('difficultyColor never paints an unknown as the hard branch — round 7 F2', () => {
    // Three components each carried their own ternary whose final `else` was
    // the hard/advanced RED, so an unknown difficulty rendered as a definite
    // hard one. Round 6 F3 fixed one of the three and called it a class fix.
    expect(difficultyColor('easy')).toBe('#4ade80');
    expect(difficultyColor('beginner')).toBe('#4ade80');
    expect(difficultyColor('medium')).toBe('#FF8A1F');
    expect(difficultyColor('intermediate')).toBe('#FF8A1F');
    expect(difficultyColor('hard')).toBe('#f87171');
    expect(difficultyColor('advanced')).toBe('#f87171');
    // THE ONES THAT MATTER: unknown is neutral, never red.
    expect(difficultyColor(null)).toBe('rgba(255,255,255,0.45)');
    expect(difficultyColor(undefined)).toBe('rgba(255,255,255,0.45)');
  });

  it('tierStyle never paints an unknown tier as bronze — round 8 F5', () => {
    // GamificationStrip's "Latest Badges" ternary ended `: '#cd7f32'`, so a
    // badge whose tier we do NOT know got a definite bronze pill and a bronze
    // card border while the pill's own text read "—": the words said unknown
    // and the colour made a claim. Achievements had already fixed this in its
    // own component (round 6 F5, NEUTRAL_TIER) and the treatment was never
    // shared — the EIGHTH instance of the one-of-N shape on this card, after
    // round 7 F2's difficulty ternary (one of three) and round 6 F3 before it.
    // The resolver lives here, beside difficultyColor, for the same reason: a
    // later edit cannot fix half of a function.
    expect(tierStyle('bronze').color).toBe('#cd7f32');
    expect(tierStyle('silver').color).toBe('#c0c0c0');
    expect(tierStyle('gold').color).toBe('#FFD66B');
    expect(tierStyle('platinum').color).toBe('#a78bfa');
    // The four known tiers must stay DISTINGUISHABLE. A resolver returning one
    // colour for all of them would satisfy every "unknown is neutral" assertion
    // below and quietly delete the feature.
    const known = ['bronze', 'silver', 'gold', 'platinum'].map((t) => tierStyle(t).color);
    expect(new Set(known).size).toBe(4);

    // THE ONES THAT MATTER: unknown is neutral, never a real tier. `''` and
    // `'BRONZE'` are here because readBadge's text() passes any non-empty
    // string through unchanged — it does not lowercase or spell-check.
    for (const unknown of [null, undefined, 'mythic', 'BRONZE']) {
      expect(tierStyle(unknown).color).toBe('rgba(255,255,255,0.45)');
      expect(tierStyle(unknown).glow).toBe('none');
      expect(tierStyle(unknown).ring).toBe('rgba(255,255,255,0.18)');
    }

    // `edge` is the 25%-alpha BORDER variant, and it is a field rather than a
    // `${color}40` concatenation at the call site for one reason: `#cd7f32` +
    // `40` is a valid 8-digit hex, but `rgba(255,255,255,0.45)` + `40` is
    // invalid CSS — the border would silently VANISH for exactly the unknown
    // case this fix exists for. The naive spelling fails only in the state
    // nobody looks at.
    expect(tierStyle('bronze').edge).toBe('#cd7f3240');
    expect(tierStyle('gold').edge).toBe('#FFD66B40');
    expect(tierStyle(null).edge).not.toMatch(/40$/);
    expect(tierStyle(null).edge).toMatch(/^rgba\(/);
  });

  it('tierStyle answers own properties only — round 8 F4, second site', () => {
    // `badge.tier in TIER_CONFIG` walked the PROTOTYPE CHAIN, so a tier of
    // `toString` answered "known" and `TIER_CONFIG[badge.tier]` then resolved
    // to Object.prototype.toString — a FUNCTION. Every style read off it was
    // `undefined`, so the badge took the known-tier path with no styling at
    // all. `tier` is text(b?.tier): any non-empty string the old backend cares
    // to send, i.e. external input used as an object key (R2.3).
    for (const key of ['toString', 'constructor', 'valueOf', '__proto__',
                       'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable']) {
      const s = tierStyle(key);
      expect(s.color).toBe('rgba(255,255,255,0.45)');
      // The defect was UNDEFINED styles, not a wrong colour — asserting the
      // colour alone would have missed it. Every field must be a real string.
      for (const field of ['color', 'bg', 'ring', 'glow', 'edge']) {
        expect(typeof s[field]).toBe('string');
        expect(s[field].length).toBeGreaterThan(0);
      }
    }
  });

  it('readLeaderboardEntry maps snake_case and nulls the rest', () => {
    const e = readLeaderboardEntry({
      rank: 2, name: 'Kd', level: 3, badge_count: 9, xp: 578,
      streak: 4, is_current_user: true,
    });
    expect(e).toEqual({
      rank: 2, name: 'Kd', level: 3, badgeCount: 9, xp: 578,
      streak: 4, isCurrentUser: true,
    });
    const bare = readLeaderboardEntry({ name: 'Partial' });
    expect(bare.rank).toBeNull();
    expect(bare.level).toBeNull();
    expect(bare.badgeCount).toBeNull();
    expect(bare.isCurrentUser).toBeNull();   // F2: not `false`
  });

  it('readRecentWorkout parses the list round 4 left unparsed (F3)', () => {
    expect(readRecentWorkout({ id: 'w1', completed_at: '2026-07-25T10:00:00Z' })).toEqual({
      id: 'w1', completedAt: '2026-07-25T10:00:00Z', exerciseName: null,
      durationMinutes: null, caloriesBurned: null, formAccuracy: null,
    });
    expect(readRecentWorkout({ form_accuracy: 0 }).formAccuracy).toBe(0);
    expect(readRecentWorkout({ duration_minutes: NaN }).durationMinutes).toBeNull();
  });

  it('readRecommendation nulls every field it cannot trust — round 6 F3', () => {
    expect(readRecommendation({
      id: 'r1', name: 'Squat', difficulty: 'beginner',
      primary_category: 'legs', calories_per_min: 8, ai_supported: true,
    })).toEqual({
      id: 'r1', name: 'Squat', difficulty: 'beginner',
      primaryCategory: 'legs', caloriesPerMin: 8, aiSupported: true,
    });
    const bare = readRecommendation({ id: 'r1', name: 'Mystery Move' });
    expect(bare.difficulty).toBeNull();       // must NOT fall into the red branch
    expect(bare.caloriesPerMin).toBeNull();   // must NOT render " kcal/min"
    expect(bare.aiSupported).toBeNull();      // F2's boolean rule
    expect(readRecommendation(null).id).toBeNull();
  });

  it('readRecommendations refuses a non-array — round 6 F2', () => {
    // `res.data.recommendations || []` accepted a STRING, which reached
    // `.slice(0,6).map()` and threw, blanking the whole Dashboard.
    expect(readRecommendations({ recommendations: 'oops' })).toBeNull();
    expect(readRecommendations({ recommendations: { 0: 'x' } })).toBeNull();
    expect(readRecommendations({})).toBeNull();
    expect(readRecommendations(null)).toBeNull();
    expect(readRecommendations({ recommendations: [] })).toEqual([]);
    expect(readRecommendations({ recommendations: [{ id: 'r' }] })).toHaveLength(1);
  });

  it('readOverviewView nulls a list it cannot enumerate', () => {
    const v = readOverviewView({
      badges: { all: [{ id: 'b', earned: true }], total_count: 40 },
      challenges: { active: [{ id: 'c' }] },
    });
    expect(v.badges.all).toHaveLength(1);
    expect(v.badges.all[0].earned).toBe(true);
    expect(v.badges.totalCount).toBe(40);
    expect(v.challenges.active[0].id).toBe('c');

    const empty = readOverviewView({});
    expect(empty.badges.all).toBeNull();
    expect(empty.badges.totalCount).toBeNull();
    expect(empty.challenges.active).toBeNull();
    expect(readOverviewView(null).badges.all).toBeNull();
    // A non-array is not an enumerable list.
    expect(readOverviewView({ badges: { all: {} } }).badges.all).toBeNull();
  });

  it('readLeaderboardView nulls entries and totals independently', () => {
    const v = readLeaderboardView({
      leaderboard: [{ rank: 1, name: 'A' }], total_users: 7, current_user_rank: 3,
    });
    expect(v.entries).toHaveLength(1);
    expect(v.totalUsers).toBe(7);
    expect(v.currentUserRank).toBe(3);

    const empty = readLeaderboardView({});
    expect(empty.entries).toBeNull();
    expect(empty.totalUsers).toBeNull();
    expect(empty.currentUserRank).toBeNull();
    expect(readLeaderboardView(null).entries).toBeNull();
  });

  it('readStatsView is per-field, so a partial 200 fabricates nothing', () => {
    // The exact payload round 4 F2 was about: envelope present, fields absent.
    const partial = readStatsView({ stats: {} });
    expect(partial.totalWorkouts).toBeNull();
    expect(partial.totalMinutes).toBeNull();
    expect(partial.totalCalories).toBeNull();
    expect(partial.weeklyWorkouts).toBeNull();
    expect(partial.streak).toBeNull();
    expect(partial.activity).toBeNull();
    expect(partial.recent).toBeNull();

    const some = readStatsView({
      stats: { total_workouts: 12, streak: 0 },
      activity: { '2026-07-25': true },
      recent_workouts: [{ id: 'w', calories_burned: 300 }],
    });
    expect(some.totalWorkouts).toBe(12);
    expect(some.streak).toBe(0);            // a real zero is not an unknown
    expect(some.totalMinutes).toBeNull();
    expect(some.activity).toEqual({ '2026-07-25': true });
    expect(some.recent[0].caloriesBurned).toBe(300);
    expect(some.recent[0].durationMinutes).toBeNull();
    // An array is not an activity map.
    expect(readStatsView({ activity: [] }).activity).toBeNull();
  });
});

describe('listState — three states per LIST, not per envelope (round 5 F1)', () => {
  it('a usable list is ready whatever the envelope did', () => {
    expect(listState('ready', true)).toBe('ready');
    expect(listState('failed', true)).toBe('ready');
  });
  it('THE F1 DEFECT: envelope ready + list unusable is FAILED, never loading', () => {
    // Branching on the envelope left this combination in neither arm, so three
    // tabs said "Loading…" permanently after both promises had settled.
    expect(listState('ready', false)).toBe('failed');
    expect(listState('failed', false)).toBe('failed');
  });
  it('only a genuinely in-flight envelope reads as loading', () => {
    expect(listState('loading', false)).toBe('loading');
  });
});

describe('unknown-safe formatters', () => {
  it('orUnknown keeps numbers numeric so callers can animate them', () => {
    expect(orUnknown(0)).toBe(0);
    expect(orUnknown(12)).toBe(12);
    expect(orUnknown(null)).toBe(UNKNOWN);
    expect(orUnknown(undefined)).toBe(UNKNOWN);
  });
  it('formatCount renders a real zero but never invents one', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1234)).toBe((1234).toLocaleString());
    expect(formatCount(null)).toBe(UNKNOWN);
    expect(formatCount(undefined)).toBe(UNKNOWN);
  });
  it('formatFraction dashes either side independently', () => {
    expect(formatFraction(2, 5)).toBe('2 / 5');
    expect(formatFraction(null, 5)).toBe(`${UNKNOWN} / 5`);
    expect(formatFraction(2, null)).toBe(`2 / ${UNKNOWN}`);
  });
  // T3 round 3, BLOCKING: `xpBarWidth` had ZERO assertions — it was not even
  // imported here, appearing only inside two regex STRINGS. Its own doc claims
  // a [0,100] clamp and "unknown is 0% … a bar cannot say unknown", and nothing
  // tested either: a mutant returning '100%' for unknown — a full yellow bar
  // beside "—/— XP" on all FOUR of its render sites — left the whole suite
  // green. The clamp test below was written for the SIBLING function, which is
  // the tell: two functions with the same contract, one tested, and the tested
  // one is not the one on the congratulations screen.
  it('xpBarWidth clamps, and unknown is an EMPTY track not a full one', () => {
    expect(xpBarWidth({ progressPct: 61.5 })).toBe('61.5%');
    expect(xpBarWidth({ progressPct: -10 })).toBe('0%');
    expect(xpBarWidth({ progressPct: 9999 })).toBe('100%');
    // THE ONE THAT MATTERS: a bar cannot render "unknown", so it renders empty.
    // A full bar would be a claim of progress nobody knows.
    expect(xpBarWidth(null)).toBe('0%');
    expect(xpBarWidth(undefined)).toBe('0%');
    expect(xpBarWidth({})).toBe('0%');
    expect(xpBarWidth({ progressPct: 'nope' })).toBe('0%');
  });

  // T3 round 4 F9: this lived in PostWorkout.jsx, so it was the one old-payload
  // formatter this block could not reach — `+0`, negative and non-finite were
  // unasserted, covered only incidentally by one render test's absent-field case.
  it('formatXpEarned: a real delta gets a plus, anything unusable gets a dash', () => {
    expect(formatXpEarned(70)).toBe('+70');
    expect(formatXpEarned(1500)).toBe(`+${(1500).toLocaleString()}`);
    // 0 IS a real number the server can send: "+0" is then a fact, not a
    // fabrication. Unknown is what must never render as zero.
    expect(formatXpEarned(0)).toBe('+0');
    expect(formatXpEarned(undefined)).toBe(UNKNOWN);
    expect(formatXpEarned(null)).toBe(UNKNOWN);
    expect(formatXpEarned('70')).toBe(UNKNOWN);
    expect(formatXpEarned(NaN)).toBe(UNKNOWN);
    expect(formatXpEarned(Infinity)).toBe(UNKNOWN);
  });

  it('progressWidth clamps, and unknown is an EMPTY track not a full one', () => {
    expect(progressWidth(40)).toBe('40%');
    expect(progressWidth(-10)).toBe('0%');
    expect(progressWidth(9999)).toBe('100%');
    expect(progressWidth(null)).toBe('0%');
    expect(progressWidth(undefined)).toBe('0%');
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
// ROUND 4 THEN DEFEATED ROUND 3's REPLACEMENT FOUR MORE WAYS — ten in total:
// a DESTRUCTURE (`const { level = 1 } = xp ?? {}`) has neither `.` nor `[` so
// FIELD_READ cannot see it; FIELD_READ had no positive control, so appending a
// contradiction to it disarmed the whole scan silently; the early-return regex
// listed six variable names and required a `!`, which `if (oldFailed) return`
// satisfies neither of; and the strip-eating attack still worked with the poison
// moved BELOW the last helper call, where the positive anchor cannot fire.
//
// WHAT THIS SECTION IS AND IS NOT, stated plainly because three previous
// versions of this comment claimed protection they did not deliver (round 4 F8
// found three false claims here, all now deleted):
//   · IT IS a cheap early-warning net for re-introductions at the SPELLING
//     level. That is genuinely useful and it stays.
//   · IT IS NOT the protection of record, and it cannot be. Source text has
//     unbounded spellings for the same rendered output, so any regex battery can
//     only enumerate the attacks someone already thought of — which is exactly
//     what ten bypasses across four rounds demonstrate empirically.
//   · THE PROTECTION OF RECORD is `src/pages/xpDisplay.render.test.jsx`, which
//     renders the components in jsdom and asserts on the DOM. Every one of the
//     ten bypasses fails there, because it does not matter how a fabrication was
//     spelled — only that a number nobody knows reached the screen.
// Do not grow this section in response to a new bypass. Add a render assertion.
//
// Claims made below are limited to what is mechanically true: FIELD_READ now
// carries a positive AND a negative control (so a disarmed regex fails loudly),
// and every negative block has at least one positive assertion beside it.

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
const OLD_XP_PAYLOAD = /summary\s*\??\.\s*current_(xp|level)/;

describe('no file under src reads a FIELD of xp — only gamificationApi.js may', () => {
  // Repo-wide, so a component receiving `xp` as a PROP (XPBar today) or one
  // extracted to a new file tomorrow is covered by construction. Round 3
  // mutation-proved both escapes against the importer-only version.
  const scanned = walkSrc((f) => !/gamificationApi\.js$/.test(f));

  it('scans a plausible number of files', () => {
    expect(scanned.length).toBeGreaterThan(20);
  });

  // ROUND 4 F1(b): FIELD_READ's only assertion was `expect(offenders).toEqual([])`,
  // which a DEAD regex satisfies just as well as a clean codebase. Appending a
  // contradiction to the pattern and re-introducing `Level {xp.level || 1}` in
  // Sidebar.jsx passed 24/24. HELPER_CALL was positively exercised by every
  // consumer; this one never was. A control on both sides now, so the scan
  // cannot be silently disarmed — the standing 0x08 lesson, third occurrence.
  it('FIELD_READ actually matches a field read (positive control)', () => {
    expect(FIELD_READ.test('xp.level')).toBe(true);
    expect(FIELD_READ.test('xp?.level')).toBe(true);
    expect(FIELD_READ.test('xp["level"]')).toBe(true);
    expect(FIELD_READ.test('{xp ? xp.level : 1}')).toBe(true);
  });

  it('FIELD_READ does not match innocent text (negative control)', () => {
    expect(FIELD_READ.test('const { xp } = useXp();')).toBe(false);
    expect(FIELD_READ.test('formatLevel(xp)')).toBe(false);
    expect(FIELD_READ.test('xpBarWidth(xp)')).toBe(false);
  });

  // T3 round 2, BLOCKING #3: OLD_XP_PAYLOAD shipped with NO control, so
  // rewriting it as `/summaryZZZ…/` and putting `% 100` back in the bar left the
  // suite 71/71 GREEN. That is round 4's F1(b) verbatim — "appending a
  // contradiction to FIELD_READ disarmed the whole scan silently because it had
  // no positive control" — committed about seventy lines BELOW the comment that
  // records it, and it falsified this section's own standing claim that a
  // disarmed regex "fails loudly". It did not; it failed silently, and at the
  // time it was the only protection the bar had.
  it('OLD_XP_PAYLOAD actually matches the old reads (positive control)', () => {
    expect(OLD_XP_PAYLOAD.test('summary.current_xp % 100')).toBe(true);
    expect(OLD_XP_PAYLOAD.test('Level {summary.current_level}')).toBe(true);
    expect(OLD_XP_PAYLOAD.test('summary?.current_xp')).toBe(true);
  });

  it('OLD_XP_PAYLOAD does not match innocent text (negative control)', () => {
    expect(OLD_XP_PAYLOAD.test('summary.xp_earned')).toBe(false);
    expect(OLD_XP_PAYLOAD.test('formatXpFraction(xp)')).toBe(false);
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
    // PostWorkout.jsx joined on 2026-07-27 (the OWED 🔴 line: the last copy of
    // the hardcoded-100 curve). As with Dashboard before it, this assertion went
    // RED before a line of the new render code was reviewed — which is the whole
    // point of deriving the list from the imports instead of hardcoding it.
    expect(xpConsumers().map((f) => basename(f)).sort()).toEqual([
      'Achievements.jsx', 'Dashboard.jsx', 'GamificationStrip.jsx',
      'PostWorkout.jsx', 'Sidebar.jsx',
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
      // A cheap tripwire on the OLD XP payload — nothing more, and the history
      // of this line is why it says so.
      //
      // Round 1 added it as THE protection for the XP bar, on the stated premise
      // that "framer-motion never runs `animate` under jsdom — the node is
      // width: 0px in every state", so no render assertion was possible.
      // **THAT PREMISE IS FALSE** (T3 round 2, measured): 0px is the `initial`,
      // and after the bar's own `delay: 0.8 + duration: 1` it settles at the
      // real width. Round 1 read the DOM ~1.8s too early and generalised one
      // instant into "every state" — measuring the case and calling it the
      // class. The bar is now asserted in the DOM where it always could have
      // been (xpDisplay.render.test.jsx), so round 4's standing "add a render
      // assertion instead" is satisfied rather than overridden, and this line is
      // back to being what the rest of this section is: an early warning at the
      // SPELLING level, not proof. A destructure defeats it in one line.
      expect(src, basename(abs) + ': reads the OLD XP payload')
        .not.toMatch(OLD_XP_PAYLOAD);
    }
  });
});

describe('XP renders independently of the old-backend payload', () => {
  const gated = [
    '../components/dashboard/GamificationStrip.jsx',
    '../pages/Achievements.jsx',
  ];

  it.each(gated)('%s hides only while EVERY read is still in flight', (rel) => {
    const { src } = codeAt(rel);
    // Round 3 F7: the DERIVED names count too, not just `data`. Round 4 F1(c)
    // then showed this list can never be complete — `if (oldFailed) return null`
    // uses a name invented after the list was written, and passes. The render
    // tests are what actually close that; this stays as an early warning.
    expect(src).not.toMatch(
      /if\s*\(\s*!\s*\(?\s*(data|oldReady|oldState|statsKnown|badgesKnown|challengesKnown)\b[\s\S]{0,40}?\)\s*\{?\s*return/,
    );
    // A bare `if (loading)` gate is the round-2 ② hole: `loading` is the OLD
    // read's. And `loading && !xp` — round 1's replacement — is the round-4 F7
    // hole, because `!xp` cannot tell "XP loading" from "XP failed", so a
    // hanging old backend plus a failed XP read hid the surface forever.
    expect(src).not.toMatch(/if\s*\(\s*loading\s*\)/);
    expect(src).not.toMatch(/loading\s*&&\s*!\s*xp\b/);
    // POSITIVE anchor: the gate must consult the XP read's OWN state.
    expect(src).toMatch(/xpStatus\s*===\s*'loading'/);
  });
});

describe('the old-payload cards claim nothing they do not know', () => {
  // Round 3 F6: presence of `oldReady` ANYWHERE satisfied the previous
  // assertion for a whole file, so reverting one counter passed green. These
  // name the SITES instead.
  it('GamificationStrip gates each count and empty state on per-card knowledge', () => {
    const { src } = codeAt('../components/dashboard/GamificationStrip.jsx');
    // ROUND 5 F2: the count comes from `earnedBadgeCount`, which returns null
    // when any element's `earned` is unknown — `earnedBadges.length` counted a
    // defaulted `false` as "not earned" and printed a confident zero.
    expect(src).toMatch(/earnedBadgeCount\s*\(/);
    expect(src).toMatch(/orUnknown\(earnedCount\)/);
    expect(src).not.toMatch(/\{\s*earnedBadges\.length\s*\}/);
    // ROUND 5 F1: per-LIST state, not the envelope's.
    expect(src).toMatch(/badgesState\s*=\s*listState\(/);
    expect(src).toMatch(/challengesState\s*=\s*listState\(/);
    expect(src).not.toMatch(/total_users\s*(\|\||\?\?)\s*\d/);
    expect(src).not.toMatch(/total_count\s*(\|\||\?\?)\s*\d/);
  });

  it('Achievements gates its header count and BOTH tab counts', () => {
    const { src } = codeAt('../pages/Achievements.jsx');
    expect(src).toMatch(/orUnknown\(earnedCount\)/);
    // ROUND 5 F1: three lists, three states, each derived per list.
    expect(src).toMatch(/badgesState\s*=\s*listState\(/);
    expect(src).toMatch(/challengesState\s*=\s*listState\(/);
    expect(src).toMatch(/boardState\s*=\s*listState\(/);
    // A caption may not branch on the ENVELOPE's failure — that is the F1 hole.
    expect(src).not.toMatch(/oldFailed\s*\?\s*'(Badges|Challenges)/);
    // Round 3 F5: the tab counts were `{data &&}`-only and `?? 0`.
    expect(src).not.toMatch(/active\?\.length\s*\?\?\s*0/);
    // Round 5 F4: no raw snake_case read on a reader-produced view.
    expect(src).not.toMatch(/entry\.is_current_user/);
  });

  it('Dashboard reads its own old-stats payload through the reader', () => {
    const { src } = codeAt('../pages/Dashboard.jsx');
    // POSITIVE anchor.
    expect(src).toMatch(/readStatsView\s*\(/);
    // stats null => s = {} => every `|| 0` fired, so a real Level sat beside
    // fabricated zeros and lent them credibility (review of 888e750, F1).
    //
    // ROUND 4 F2: the previous version of this line banned `|| 0` and PERMITTED
    // `?? 0` — which is the spelling the code had actually been written in, so
    // the assertion was green against the live defect. Both operators now.
    expect(src).not.toMatch(
      /\b(total_workouts|total_minutes|total_calories|weekly_workouts|streak)\s*(\|\||\?\?)\s*0/,
    );
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
    // `badges.all.filter` are deliberately NOT banned — they sit behind a
    // `listState(...)` gate or a `?? []`, and the per-site assertions above
    // require the gate. Banning the spelling instead would forbid the correct
    // code, which is how a guard starts pushing people toward worse shapes to
    // keep it quiet.
    //
    // ROUND 6 F10: the previous wording said these sit inside a
    // `badgesKnown(data) ? …` ternary "which the per-site assertions above
    // require". Both halves were false — no component calls `badgesKnown`, and
    // the per-site assertions require `listState(`. Round 5's refactor made the
    // sentence stale and nothing caught it, which is the fourth false claim
    // this section has carried. Corrected rather than deleted, so the pattern
    // stays visible: a comment describing code is a claim, and it rots.
    // ROUND 4 F8: this block was three `not.toMatch` and nothing else, so on an
    // eaten or emptied file it passed vacuously — the exact failure mode the
    // section header claimed had been closed everywhere. Positive anchor first.
    expect(src).toMatch(/read(Overview|Leaderboard)View\s*\(/);
    expect(src).not.toMatch(/\bleaderboard\.leaderboard\s*\./);
    expect(src).not.toMatch(/\{\s*leaderboard\.total_users\s*\}/);
    expect(src).not.toMatch(/\{\s*entry\.xp\.toLocaleString/);
    // Round 4 F5: the ELEMENT-level siblings round 3 left bare beside `entry.xp`.
    expect(src).not.toMatch(/\{\s*entry\.(rank|level|badge_count)\s*\}/);
    expect(src).not.toMatch(/\bchallenge\.(current|target|progress)\s*\}/);
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

  // ROUND 6 F10: the five `badgesKnown`/`challengesKnown` assertions that stood
  // here are deleted with the functions. Round 5's listState refactor left them
  // testing a path no component takes — coverage on dead code, which reads as
  // protection and is not. The same question is asked directly of the reader's
  // output above (`readOverviewView nulls a list it cannot enumerate`).
});
