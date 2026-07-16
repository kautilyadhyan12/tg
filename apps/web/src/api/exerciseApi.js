// P2.8 web repoint (Card 3) — DELIBERATELY NOT REPOINTED. ExerciseLibrary.jsx
// renders display names, instructions, and media GIFs, and filters/searches
// SERVER-SIDE with page-number pagination. The new catalog (Part 4 §3.4
// exercises table, verified in db/schema/catalog.ts) stores NONE of that
// content: {slug, nameKey, family, tier, tracking, met, difficulty, equipment,
// muscles} with cursor pagination and a .strict() query of {limit, cursor}
// only — no name text, no instructions, no media, no search. Per the
// NO-REMOVAL rule (CLAUDE.md MIGRATION STANCE) the page stays wired to the
// old backend until the exercise content surface exists (the P4 production
// line owns exercise copy/media; localization keys are Part 2 Appendix A).
// Owed-endpoint line lives in RUNBOOK/cutover.md's prerequisites — P2.8 is
// blocked until then. On this branch these calls are Bearer-null-broken
// (documented interim, DECISIONS Card 1).
import mlApi from './mlApi';

export const exerciseService = {
  // Get exercises with filters
  getExercises: (params) => mlApi.get('/exercises', { params }),

  // Get single exercise
  getExercise: (id) => mlApi.get(`/exercises/${id}`),

  // Get all categories
  getCategories: () => mlApi.get('/exercises/categories'),

  // Get all muscles
  getMuscles: () => mlApi.get('/exercises/muscles'),

  getMedia: (name) => mlApi.get(`/exercises/media/${encodeURIComponent(name)}`),
};