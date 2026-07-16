// P2.8 web repoint (Card 3) — DELIBERATELY NOT REPOINTED. Both consumers
// (GamificationStrip.jsx, Achievements.jsx) render XP/levels, the badge
// CATALOG grouped by category, challenges, and the leaderboard. The new API's
// entire gamification surface is GET /v1/gamification/me = {streak,
// achievements[earned codes]} — none of those screens can be served from it:
//   · XP/levels — DEFERRED, Kd-ruled (DECISIONS 2026-07-11 P2.3 GAP-1: Part 4
//     has no xp storage; inventing a column violates R0.2).
//   · badge catalog + challenges — "tables now, screens later"
//     (DECISIONS 2026-07-11 P2.3 approved carve).
//   · leaderboard — P4.x card (CLAUDE.md Part III; Redis ZSET, v1 §14).
// Per the NO-REMOVAL rule (CLAUDE.md MIGRATION STANCE), the UI stays wired to
// the old backend until those cards land; RUNBOOK/cutover.md's prerequisites
// carry the owed-endpoint lines that block P2.8 until then. On this branch
// these calls are Bearer-null-broken (documented interim, DECISIONS Card 1).
import mlApi from './mlApi';

export const gamificationService = {
  getOverview:    () => mlApi.get('/gamification/overview'),
  getBadges:      () => mlApi.get('/gamification/badges'),
  getLeaderboard: (limit = 20) =>
    mlApi.get('/gamification/leaderboard', { params: { limit } }),
};