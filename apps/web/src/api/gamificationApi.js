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

export const gamificationService = {
  /** {streak, xp, achievements} — @app/shared gamificationMeSchema. */
  getMe: () => authApi.get('/v1/gamification/me'),

  // OLD BACKEND (see header note) — do not repoint without a new-API surface.
  getOverview:    () => mlApi.get('/gamification/overview'),
  getBadges:      () => mlApi.get('/gamification/badges'),
  getLeaderboard: (limit = 20) =>
    mlApi.get('/gamification/leaderboard', { params: { limit } }),
};
