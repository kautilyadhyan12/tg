// P2.8 web repoint (Card 3) — progress + measurements on the NEW /v1 API via
// the Card-1 cookie client (httpOnly session, 401→refresh→retry-once). Shapes
// are @app/shared's progress.ts / nutrition.ts contracts; the consumers
// (Progress.jsx, MeasurementsTracker.jsx) were migrated to those field names
// in the same card. Responses are the schema objects directly — no wrapper.
//
// STILL ON THE OLD BACKEND (interim; Bearer-null-broken on this branch, owed
// per the NO-REMOVAL rule in CLAUDE.md and RUNBOOK/cutover.md prerequisites):
//   getPredictions — the new API has no predictions surface; DECISIONS
//   2026-07-11 (P2.3 approved carve) sequences it to the 2B §5 card.
import authApi from './authApi';
import mlApi from './mlApi';

export const progressService = {
  // Six chart reads (P2.3 ports of progress.py). period ∈ 7d|30d|90d|1y|all
  // (@app/shared progressPeriodSchema — identical to the page's PERIODS).
  getOverview:             (period = '30d') => authApi.get('/v1/progress/overview',     { params: { period } }),
  getCaloriesTrend:        (period = '30d') => authApi.get('/v1/progress/trend',        { params: { period } }),
  getWeeklyWorkouts:       (period = '90d') => authApi.get('/v1/progress/weekly',       { params: { period } }),
  getActivityHeatmap:      ()               => authApi.get('/v1/progress/heatmap'),
  getCategoryDistribution: (period = '30d') => authApi.get('/v1/progress/distribution', { params: { period } }),
  getPersonalRecords:      ()               => authApi.get('/v1/progress/records'),

  // Body measurements moved to the nutrition module (Part 4 §3.6, built P2.6).
  // POST body is @app/shared bodyMeasurementInputSchema (.strict()):
  // {measuredAt, weightKg?, metrics:{<name>: number}} — the flat old payload
  // is the COMPONENT's concern to assemble; this layer stays a thin client.
  getMeasurements:  (limit = 30) => authApi.get('/v1/nutrition/body-measurements', { params: { limit } }),
  logMeasurement:   (data)       => authApi.post('/v1/nutrition/body-measurements', data),
  deleteMeasurement:(id)         => authApi.delete(`/v1/nutrition/body-measurements/${id}`),

  // OLD BACKEND (see header note) — do not repoint without a new-API surface.
  getPredictions: () => mlApi.get('/progress/predictions'),
};
