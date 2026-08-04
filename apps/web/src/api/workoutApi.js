// P2.8 web repoint (workout calendar card) — the HISTORY reads now ride the
// NEW /v1 API via the Card-1 cookie client. Shapes are @app/shared workouts.ts
// (`workoutPageSchema`, `workoutDetailSchema`); `api/workoutHistory.js` is the
// reader that turns them into what the calendar draws.
//
// A DEAD DUPLICATE WAS DELETED HERE, not refactored away: this object declared
// `getHistory` TWICE — `(limit) => mlApi.get('/workouts')` and then
// `(month, year) => mlApi.get('/workouts/history')`. In an object literal the
// LATER key wins, so the first was unreachable code that no caller could ever
// have run (grep: `WorkoutCalendar.jsx:182` was the only call site, and it
// passed month+year). One `getHistory` now, on the new API.
//
// STILL ON THE OLD BACKEND (interim; Bearer-null-broken on this branch —
// DECISIONS 2026-07-15 web Card 1: "the planned multi-card consequence, not a
// defect"). Owed per the NO-REMOVAL rule (CLAUDE.md MIGRATION STANCE) and
// RUNBOOK/cutover.md; do NOT repoint without a new-API surface, and do NOT
// delete one to "finish" the repoint:
//   getStats        — the Dashboard's payload; `/workouts/stats` has no new-API
//                     home (its `xp`/`level` are superseded by
//                     /v1/gamification/me, but the rest of it is not).
//   createSession   — PreWorkout opens a session server-side; the new model is
//   completeSession   client-side capture + `POST /v1/workouts/sync`, which the
//                     ActiveWorkout/PreWorkout repoint card owns.
//   getSummary      — the rich PostWorkout summary (personal records, meal
//                     suggestions, stretches) has no new-API surface;
//                     `workoutDetailSchema` carries sets, not those three.
//   templates ×4    — WorkoutBuilder. CORRECTED 2026-08-01: an earlier version
//                     of this comment said "no templates table or endpoint
//                     exists on the new API at all". The TABLE exists —
//                     `workout_templates`, in the Part 4 §3.5 DDL and in
//                     `db/schema/training.ts`, kept by the spec as an "existing
//                     WorkoutBuilder feature (audit find)". Only the ENDPOINTS
//                     are missing, which makes this a smaller card than the
//                     wrong claim implied.
import authApi from './authApi';
import mlApi from './mlApi';

export const workoutService = {
  /** NEW API. Keyset page, newest first — `@app/shared workoutListQuerySchema`
   *  (`{ limit ≤ 100, cursor, from, to }`).
   *
   *  `from`/`to` are a HALF-OPEN date window of absolute INSTANTS — `from`
   *  inclusive, `to` exclusive — added 2026-08-04 (DECISIONS :4434) and first
   *  used by the calendar the same day (:4622). Pass them.
   *
   *  **This comment said the opposite until :4622 and was WRONG on both
   *  clauses**: "there is no month filter by design; callers that need one walk
   *  the pages". The page-walk existed because the endpoint had no filter, not
   *  by design, and that walk is what :4622 deleted — it drew a long-time
   *  user's older months BLANK. A comment telling the next author the API
   *  cannot filter by date is an invitation to rebuild exactly that defect,
   *  which is why this is spelled out rather than quietly replaced. Same shape
   *  as :4556's F1, one file over: one contract, two comment sites, and the
   *  correction landed on only one of them. */
  getHistory: (params) => authApi.get('/v1/workouts', { params }),

  /** NEW API. One workout with its sets — `@app/shared workoutDetailSchema`.
   *  The calendar's detail panel reads exercise names out of `sets`. */
  getWorkout: (id) => authApi.get(`/v1/workouts/${id}`),

  // OLD BACKEND (see header note) — do not repoint without a new-API surface.
  getStats: () => mlApi.get('/workouts/stats'),
  createSession: (data) => mlApi.post('/workouts', data),
  completeSession: (id, data) => mlApi.patch(`/workouts/${id}/complete`, data),
  getSummary: (id) => mlApi.get(`/workouts/${id}/summary`),
  saveTemplate: (name, exercises) => mlApi.post('/workouts/templates', { name, exercises }),
  getTemplates: () => mlApi.get('/workouts/templates'),
  deleteTemplate: (id) => mlApi.delete(`/workouts/templates/${id}`),
  useTemplate: (id) => mlApi.post(`/workouts/templates/${id}/use`),
};
