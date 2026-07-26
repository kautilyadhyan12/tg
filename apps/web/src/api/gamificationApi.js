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

/** Render helpers — the ONLY way a component turns `xp` into text.
 *
 *  They exist because the T3 mutation proved the gap: reverting the three call
 *  sites to `xp?.level || 1` left the whole suite green, since the guard was
 *  tested at the READER and the original bug lived at a RENDER SITE. Routing
 *  every site through one tested function closes the class rather than the
 *  case. Unknown renders as an em dash — never a zero, never a Level 1. */
export const UNKNOWN = '—';
export function formatLevel(xp) {
  return xp ? String(xp.level) : UNKNOWN;
}
export function formatXpTotal(xp) {
  return xp ? xp.total.toLocaleString() : UNKNOWN;
}
/** "52/374 to Lv 4" — `level + 1` is the next level's LABEL, not arithmetic on
 *  XP (every XP quantity is server-computed; xp.ts:131-143). */
export function formatXpProgress(xp) {
  return xp
    ? `${xp.xpInLevel}/${xp.xpForNext} to Lv ${xp.level + 1}`
    : `${UNKNOWN}/${UNKNOWN} to Lv ${UNKNOWN}`;
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
