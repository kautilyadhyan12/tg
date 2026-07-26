// P2.8 web repoint (XP display card) — XP/levels on the NEW /v1 API via the
// Card-1 cookie client. `GET /v1/gamification/me` returns {streak, xp,
// achievements}; this file's consumers use the `xp` block.
//
// The XP half of the DECISIONS 2026-07-11 P2.3 GAP-1 deferral is DISCHARGED:
// Kd ruled 2026-07-24 to KEEP the feature and build its storage, and the API
// half merged as PR #50 (migration 0008_user_xp + the verbatim badges.py
// curve). Consumers repointed here: Sidebar.jsx, GamificationStrip.jsx
// ("Your Rank" card only) and Achievements.jsx (header block only).
//
// STILL ON THE OLD BACKEND (interim; Bearer-null-broken on this branch —
// DECISIONS 2026-07-15 web Card 1: "the planned multi-card consequence, not a
// defect"). Owed per the NO-REMOVAL rule (CLAUDE.md MIGRATION STANCE) and
// RUNBOOK/cutover.md; do NOT repoint without a new-API surface, and do NOT
// delete one to "finish" the repoint:
//   getOverview     — badge CATALOG + challenges (+ the old XP block, now
//                     superseded by getMe for XP only).
//   getBadges       — badge catalog ("tables now, screens later", P2.3 carve).
//   getLeaderboard  — P4.x card (Redis ZSET, verified-entries-only, v1 §14);
//                     Kd ruled 2026-07-24 it is built properly in P4, with a
//                     "coming soon" dark window accepted at cutover.
import { xpViewSchema } from '@app/shared';
import authApi from './authApi';
import mlApi from './mlApi';

/** The `xp` block from GET /v1/gamification/me, or NULL when the response does
 *  not carry a usable one (request failed, endpoint predates PR #50, or a field
 *  is missing / malformed).
 *
 *  NULL MEANS "UNKNOWN" AND CALLERS MUST RENDER IT AS UNKNOWN. There is
 *  deliberately no default object and no `?? 0` anywhere downstream: this
 *  function exists so a fabricated number cannot enter the UI. Two precedents,
 *  both real bugs — the nutrition-targets card, where `safeTargets.kcal || 2000`
 *  rendered a made-up goal indistinguishable from a real one (DECISIONS
 *  2026-07-20), and the live Sidebar defect this card fixes, `user?.level || 1`,
 *  which showed EVERY user "Level 1" because the auth user shape carries no
 *  `level` field at all.
 *
 *  R2.3/R7.2: the shape is validated by the SHARED contract, never a local copy
 *  of the field list — a hand-rolled list drifts silently the day the schema
 *  changes (T3 finding ③). `xpViewSchema` requires all six fields, which is why
 *  `nextLevelAt` is enforced despite having no render site today (finding ⑤):
 *  that is the contract's call, not this file's, and the server always sends it.
 *
 *  The one extra check: `progressPct` is `z.number()`, which ACCEPTS Infinity
 *  (verified — the five `.int()` fields reject it, NaN is rejected everywhere).
 *  JSON cannot carry Infinity so the wire case is unreachable, but rendering
 *  `Infinity%` as a bar width is the failure mode if it ever arrives. Pure. */
export function readXpView(data) {
  const parsed = xpViewSchema.safeParse(data?.xp);
  if (!parsed.success) return null;
  return Number.isFinite(parsed.data.progressPct) ? parsed.data : null;
}

/** The OLD payload's three states, as a pure function — round 3's Done-gate
 *  recommendation, and the fix for its F2.
 *
 *  Both components used `!xp` as a stand-in for "the old read is finished",
 *  which it is not: with `if (loading && !xp)` the state "new API answered, old
 *  read still IN FLIGHT" rendered "Failed to load achievements" and "Badges are
 *  unavailable right now" — a failure CLAIM during a healthy load. That is
 *  verbatim the defect round 1 ④ deleted from the XP wording, re-created for the
 *  old payload by round 2's own fix. And because `mlApi` sets no timeout, an old
 *  backend that accepts the connection and never answers made that false claim
 *  PERMANENT — the same hang round 2 ② was written about, inverted.
 *
 *  Three states, never two. Pure and unit-tested, so the four combinations are
 *  covered without a DOM (vitest runs `environment: "node"`; the jsdom project
 *  is still owed). */
export function oldPayloadState({ data, loading }) {
  if (data) return 'ready';
  return loading ? 'loading' : 'failed';
}

/** Per-CARD readiness — round 3 F5. `Boolean(data)` asserts the ENVELOPE
 *  arrived, not that the field inside it did, so a 200 with `{}` (the shape this
 *  file's own test adapter returns) still produced "(0/—)", "0 of — badges" and
 *  "Badges (0)". Array-shape is the honest question: can we enumerate them? */
export function badgesKnown(data) {
  return Array.isArray(data?.badges?.all);
}
export function challengesKnown(data) {
  return Array.isArray(data?.challenges?.active);
}

/** Render helpers — the ONLY way a component may turn `xp` into anything.
 *
 *  They exist because round 1's mutation proved the guard was at the READER
 *  while the original bug lived at a RENDER SITE. Round 2 then proved the first
 *  version of that fix was still bypassable nine ways (`{xp ? xp.level : 1}` —
 *  this codebase's own idiom — among them), because components were still
 *  allowed to touch `xp`'s FIELDS. So the rule is now stricter and mechanically
 *  checkable: **a component never reads a field of `xp`.** It passes the whole
 *  object to a helper here, or tests it for truthiness to choose a layout. The
 *  test guard enforces exactly that, which is why a bar width and a next-level
 *  label are helpers too rather than one-line expressions at the call site.
 *
 *  Every helper is FIELD-SAFE, not object-truthy (round 2 ⑧): `formatXpTotal({})`
 *  used to throw on `.toLocaleString()` and `formatLevel({})` rendered the
 *  string "undefined". Only `readXpView` output should ever reach them, but
 *  nothing enforces that, and a throw inside render blanks the whole page —
 *  there is no ErrorBoundary anywhere in apps/web (grep-verified).
 *
 *  Unknown renders as an em dash — never a zero, never a Level 1. */
export const UNKNOWN = '—';

const num = (xp, field) => (Number.isFinite(xp?.[field]) ? xp[field] : null);

export function formatLevel(xp) {
  const v = num(xp, 'level');
  return v === null ? UNKNOWN : String(v);
}
export function formatXpTotal(xp) {
  const v = num(xp, 'total');
  return v === null ? UNKNOWN : v.toLocaleString();
}
/** The next level's LABEL. `level + 1` is a label, not arithmetic on XP — every
 *  XP quantity is server-computed (xp.ts:131-143). */
export function formatNextLevel(xp) {
  const v = num(xp, 'level');
  return v === null ? UNKNOWN : String(v + 1);
}
/** "230/248" */
export function formatXpFraction(xp) {
  const a = num(xp, 'xpInLevel');
  const b = num(xp, 'xpForNext');
  return a === null || b === null ? `${UNKNOWN}/${UNKNOWN}` : `${a}/${b}`;
}
/** "230/248 to Lv 3" */
export function formatXpProgress(xp) {
  return `${formatXpFraction(xp)} to Lv ${formatNextLevel(xp)}`;
}
/** A CSS width for the level bar, CLAMPED to [0,100] (round 2 ⑥).
 *  `progressPct` is the one field the shared schema leaves unbounded — it is a
 *  bare `z.number()`, so -50 and 9999 parse — and every other bar in this app
 *  clamps (MacroRings, PredictionsSection, ActiveRun). Unknown is 0% with the
 *  numbers beside it reading "—/—", which is what says unknown; a bar cannot. */
export function xpBarWidth(xp) {
  const v = num(xp, 'progressPct');
  if (v === null) return '0%';
  return `${Math.min(100, Math.max(0, v))}%`;
}

// ── Old-backend payload readers (round 4 F6) ─────────────────────────────────
//
// THE CLASS FIX, and the reason this section exists rather than a seventh round
// of per-read guards. Rounds 1-4 each closed the reads they could see and each
// missed one: round 2 ③ chained `challenges.active` and left `leaderboard.
// leaderboard`; round 3 F1 fixed that twin and left `leaderboard.leaderboard.
// map`, two bare `total_users` and `entry.xp`; round 4 F5 then found seven more
// at ELEMENT level (`entry.rank`, `challenge.current`, `badge.xp_reward`, …).
// Four rounds, same shape, because `getOverview`/`getLeaderboard`/`getStats`
// responses are EXTERNAL INPUT (R2.3) rendered raw — the only payload that ever
// crossed a parser was the new API's, through readXpView.
//
// So these do for the three old payloads what readXpView does for the new one:
// every field arrives as a usable value or as NULL, and null is rendered as the
// em dash by orUnknown/formatCount. A render site added tomorrow fabricates only
// by deliberately writing `?? 0` — not by forgetting a guard, which is how all
// four rounds' worth got in.
//
// Deliberately NOT Zod: these three shapes are the OLD backend's, they die at
// P2.8 (RUNBOOK/cutover.md), and a shared contract for a payload we are deleting
// would outlive its subject. `xpViewSchema` stays the shared contract because
// the NEW API's shape is permanent.
const finite = (v) => (Number.isFinite(v) ? v : null);
const text   = (v) => (typeof v === 'string' && v.trim() !== '' ? v : null);
const list   = (v) => (Array.isArray(v) ? v : null);

/** The value, or the em dash when unknown. Keeps NUMBERS numeric, so callers
 *  that animate or suffix them still can — the reason this is not formatCount. */
export function orUnknown(v) {
  return v === null || v === undefined ? UNKNOWN : v;
}
/** Unknown-safe count for string contexts (`{formatCount(x)} of 7`). */
export function formatCount(v) {
  return v === null || v === undefined ? UNKNOWN : v.toLocaleString();
}
/** "3 / 5", with either side unknown. */
export function formatFraction(a, b) {
  return `${orUnknown(a)} / ${orUnknown(b)}`;
}
/** A CSS width from a percentage that may be unknown or out of range. Unknown
 *  is an EMPTY track, never a full one — same rule as xpBarWidth. */
export function progressWidth(v) {
  return v === null || v === undefined ? '0%' : `${Math.min(100, Math.max(0, v))}%`;
}

export function readChallenge(c) {
  return {
    id:          text(c?.id),
    name:        text(c?.name),
    icon:        text(c?.icon),
    difficulty:  text(c?.difficulty),
    description: text(c?.description),
    current:     finite(c?.current),
    target:      finite(c?.target),
    progress:    finite(c?.progress),
    xpReward:    finite(c?.xp_reward),
    completed:   c?.completed === true,
  };
}

export function readBadge(b) {
  return {
    id:          text(b?.id),
    name:        text(b?.name),
    icon:        text(b?.icon),
    tier:        text(b?.tier),
    category:    text(b?.category),
    description: text(b?.description),
    xpReward:    finite(b?.xp_reward),
    earned:      b?.earned === true,
  };
}

export function readLeaderboardEntry(e) {
  return {
    rank:          finite(e?.rank),
    name:          text(e?.name),
    level:         finite(e?.level),
    badgeCount:    finite(e?.badge_count),
    xp:            finite(e?.xp),
    streak:        finite(e?.streak),
    isCurrentUser: e?.is_current_user === true,
  };
}

/** `{badges:{all,total_count}, challenges:{active}}` — lists are NULL when the
 *  payload cannot be enumerated, which is what badgesKnown/challengesKnown ask. */
export function readOverviewView(data) {
  const all    = list(data?.badges?.all);
  const active = list(data?.challenges?.active);
  return {
    badges: {
      all:        all === null ? null : all.map(readBadge),
      totalCount: finite(data?.badges?.total_count),
    },
    challenges: {
      active: active === null ? null : active.map(readChallenge),
    },
  };
}

export function readLeaderboardView(data) {
  const entries = list(data?.leaderboard);
  return {
    entries:         entries === null ? null : entries.map(readLeaderboardEntry),
    totalUsers:      finite(data?.total_users),
    currentUserRank: finite(data?.current_user_rank),
  };
}

/** `workoutService.getStats()` — the Dashboard's own payload, and the one round
 *  4 F2 caught still fabricating: `Boolean(stats?.stats)` asserted the ENVELOPE
 *  and six sites then read fields off it with `?? 0`, so a 200 carrying
 *  `{stats:{}}` printed "0 workouts / 0h / 0 kcal" as fact. Per-field now, so
 *  there is nothing left for an envelope gate to get wrong. */
export function readStatsView(data) {
  const s = data?.stats;
  const a = data?.activity;
  return {
    totalWorkouts:  finite(s?.total_workouts),
    totalMinutes:   finite(s?.total_minutes),
    totalCalories:  finite(s?.total_calories),
    weeklyWorkouts: finite(s?.weekly_workouts),
    streak:         finite(s?.streak),
    // A plain object keyed by date, or NULL. Round 4 F3: `|| {}` let the week
    // strip render seven inactive dots — a visual "you trained on none of these
    // days" — beside a caption that correctly read "unavailable".
    activity: a && typeof a === 'object' && !Array.isArray(a) ? a : null,
    recent:   list(data?.recent_workouts),
  };
}

export const gamificationService = {
  /** {streak, xp, achievements} — @app/shared gamificationMeSchema. */
  getMe: () => authApi.get('/v1/gamification/me'),

  // OLD BACKEND (see header note) — do not repoint without a new-API surface.
  getOverview:    () => mlApi.get('/gamification/overview'),
  getBadges:      () => mlApi.get('/gamification/badges'),
  getLeaderboard: (limit = 20) =>
    mlApi.get('/gamification/leaderboard', { params: { limit } }),
};
