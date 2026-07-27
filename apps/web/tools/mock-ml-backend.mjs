// Stand-in for the OLD ML backend, for running the XP-display SMOKE.
//
//   node apps/web/tools/mock-ml-backend.mjs      (listens on :8000)
//
// WHY THIS EXISTS. `apps/web/.env` points VITE_ML_API_URL at
// http://localhost:8000/api. The real old backend is being decommissioned and,
// on the `web-repoint` branch, is Bearer-null-broken by design. Seven T3 rounds
// found defects that appear ONLY in specific old-backend RESPONSES — a 200 with
// an empty body, a badge catalog with no `earned` field, a connection that
// hangs, a `recommendations` field that is a string. NONE of those states can be
// produced by "the old server is switched off", which is the only state a smoke
// could previously reach. That is why several rounds of defects survived a human
// click-through. This serves each state on demand.
//
//   switch:  open http://localhost:8000/__state/<name> in a browser tab
//   read:    open http://localhost:8000/__state
//
// THE TRAP THAT COST A WHOLE SMOKE RUN (2026-07-27, recorded in DECISIONS):
// `mlApi` is created with `withCredentials: true` (apps/web/src/api/mlApi.js:5),
// and a browser REFUSES a wildcard `Access-Control-Allow-Origin` on a
// credentialed request. The first version of this file sent `*`, so Chrome
// blocked every call before it left the page and the app reported "unavailable"
// in EVERY state — including `healthy`. Kd clicked through nine tests against a
// wall. If you change the CORS block, verify with the `healthy` state FIRST:
// real numbers must appear, or the rig is lying to you and not the app.
import { createServer } from 'node:http';

const STATES = [
  'dead',        // every old endpoint 500s — the branch's normal state
  'hang',        // accepts the connection, never answers (mlApi sets no timeout)
  'empty200',    // 200 with {} — envelope arrives, no fields
  'statsEmpty',  // 200 with {"stats":{}} — round 4 F2
  'noEarned',    // badge catalog with no `earned` field — round 5 F2 / round 6 F1
  'partial',     // elements missing metrics/difficulty — rounds 5 F3, 6 F7, 7 F2;
                 //   also a workout summary with no `xp_earned` (PostWorkout)
  'badRecs',     // recommendations is a STRING, not a list — round 6 F2
  'lbOnly',      // overview fails, leaderboard 200s — round 4 F4
  'emptyLists',  // everything 200s with empty lists — round 6 F6
  'healthy',     // full, well-formed payloads — THE CONTROL. Run it first.
];
let state = 'dead';

const cors = (req) => ({
  'access-control-allow-origin': req.headers.origin ?? 'http://localhost:5173',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': req.headers['access-control-request-headers'] ?? 'content-type,authorization',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'vary': 'Origin',
});

const json = (req, res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', ...cors(req) });
  res.end(JSON.stringify(body));
};

const BADGES_FULL = [
  { id: 'b1', name: 'First Rep',  description: 'Complete one workout', icon: '🏅', tier: 'bronze', category: 'milestones', xp_reward: 10, earned: true },
  { id: 'b2', name: 'Week One',   description: 'Seven days running',   icon: '🔥', tier: 'silver', category: 'streaks',    xp_reward: 25, earned: false },
  { id: 'b3', name: 'Form Master',description: 'Score 95+ on form',    icon: '🎯', tier: 'gold',   category: 'quality',    xp_reward: 50, earned: false },
];
const CHALLENGES_FULL = [
  { id: 'c1', name: 'Three Sessions', description: 'Train three times', icon: '💪', difficulty: 'easy',   current: 2,  target: 3,  progress: 66,  xp_reward: 30, completed: false },
  { id: 'c2', name: 'Long Haul',      description: 'Train 90 minutes',  icon: '⏱️', difficulty: 'medium', current: 90, target: 90, progress: 100, xp_reward: 60, completed: true },
];
const LEADERBOARD_FULL = {
  leaderboard: [
    { user_id: 'u1', rank: 1, name: 'Asha', level: 7, badge_count: 9, xp: 4100, streak: 12, is_current_user: false },
    { user_id: 'u2', rank: 2, name: 'Kd',   level: 3, badge_count: 2, xp: 578,  streak: 3,  is_current_user: true  },
  ],
  total_users: 2,
  current_user_rank: 2,
};

/** The post-workout summary (`GET /workouts/:id/summary`).
 *
 *  `current_level` and `current_xp` are DELIBERATELY the old store's values and
 *  deliberately unlike the new API's: the page stopped reading both on
 *  2026-07-27 (it takes the level and the position within it from
 *  `/v1/gamification/me`), so if "Level 7" appears anywhere on that screen the
 *  repoint has regressed. `current_xp: 578` is the total that the deleted
 *  `% 100` maths would have rendered as "78/100 XP". */
const SUMMARY_FULL = {
  session_id:       'smoke-1',
  duration_minutes: 35,
  active_seconds:   900,
  calories_burned:  280,
  form_accuracy:    88,
  exercises_count:  3,
  completed_at:     new Date().toISOString(),
  personal_records: ['Best form accuracy!'],
  xp_earned:        70,
  current_level:    7,
  current_xp:       578,
  current_streak:   3,
  meal_suggestions: [{ meal: 'Paneer bhurji + rice', timing: 'within 45 min' }],
  stretches:        ['Hamstring stretch, 30s each side', 'Quad stretch, 30s each side'],
  exercises:        [],
};
/** Same workout, but the old backend sent no `xp_earned`. The delta must read
 *  "—", never "+0" (which would claim the workout earned nothing) and never a
 *  bare "+" (React renders undefined as nothing — the mutation that got past the
 *  first version of this card's own test). */
const SUMMARY_NO_XP_EARNED = (({ xp_earned, ...rest }) => rest)(SUMMARY_FULL);

function payloadFor(path) {
  // The summary gets its own branch BEFORE the per-state switch, because every
  // 200-serving state needs an answer here: PostWorkout's own catch toasts and
  // redirects to /dashboard when this read fails, so a state that 500s it
  // cannot exercise the page at all. `dead`, `hang` and `lbOnly` are handled in
  // the request handler above and still fail — which is itself the honest
  // behaviour to observe, just not the one the XP card is about.
  // Anchored to the WORKOUT summary specifically. `includes('/summary')` also
  // swallowed `/running/sessions/:id/summary` (runningApi.js), answering the
  // running screen with a workout payload in every 200-serving state — in the
  // one instrument whose own header warns that a lying rig gets blamed on the
  // app. Found by T3 round 2.
  if (/\/workouts\/[^/]+\/summary$/.test(path)) {
    // ⚠ `empty200` returns a 200 with NO `summary` key, and PostWorkout renders
    // a BLANK WHITE PAGE for it: `setSummary(res.data.summary)` stores undefined
    // without throwing, so the catch never runs — no toast, no redirect, no
    // text. That is PRE-EXISTING (it belongs to the unparsed-summary gap on
    // OWED, not to the XP repoint), but this branch is what makes it reachable
    // in a smoke, so it is named here: a white screen in `empty200` is the
    // KNOWN state, not a broken rig. Every other state renders the page.
    if (state === 'empty200') return {};
    if (state === 'partial')  return { summary: SUMMARY_NO_XP_EARNED };
    return { summary: SUMMARY_FULL };
  }

  switch (state) {
    case 'empty200':
      return {};
    case 'statsEmpty':
      return path.includes('/workouts/stats') ? { stats: {} } : {};
    case 'noEarned':
      // Round 5 F2: catalog present, `earned` absent on every element, so the
      // COUNT is unknowable. Round 6 F1: the badges must still RENDER and
      // nothing may say "Badges are unavailable right now".
      if (path.includes('/gamification/overview')) {
        return {
          badges: { all: BADGES_FULL.map(({ earned, ...rest }) => rest), total_count: 40 },
          challenges: { active: CHALLENGES_FULL },
        };
      }
      return path.includes('/workouts/stats')
        ? { stats: { total_workouts: 12, weekly_workouts: 2 }, activity: {}, recent_workouts: [] }
        : {};
    case 'partial':
      if (path.includes('/gamification/overview')) {
        return {
          badges: { all: [{ id: 'b9', name: 'Mystery Badge' }], total_count: 40 },
          challenges: { active: [{ id: 'c9', name: 'Mystery Challenge' }] },
        };
      }
      if (path.includes('/workouts/stats')) {
        return {
          stats: { total_workouts: 12, weekly_workouts: 2 },
          activity: {},
          recent_workouts: [{ id: 'w1', completed_at: 'not-a-date' }],   // round 6 F7
        };
      }
      if (path.includes('/recommendations')) return { recommendations: [{ id: 'r1', name: 'Mystery Move' }] };
      if (path.includes('/gamification/leaderboard')) return { leaderboard: [{ name: 'Partial' }], total_users: 1 };
      return {};
    case 'badRecs':
      if (path.includes('/recommendations')) return { recommendations: 'oops' };
      return path.includes('/workouts/stats')
        ? { stats: { total_workouts: 12 }, activity: {}, recent_workouts: [] }
        : {};
    case 'emptyLists':
      if (path.includes('/gamification/overview')) return { badges: { all: [], total_count: 40 }, challenges: { active: [] } };
      if (path.includes('/gamification/leaderboard')) return { leaderboard: [], total_users: 0 };
      if (path.includes('/recommendations')) return { recommendations: [] };
      if (path.includes('/workouts/stats')) return { stats: { total_workouts: 0, total_minutes: 0, total_calories: 0, weekly_workouts: 0, streak: 0 }, activity: {}, recent_workouts: [] };
      return {};
    case 'healthy':
      if (path.includes('/gamification/overview')) return { badges: { all: BADGES_FULL, total_count: 40 }, challenges: { active: CHALLENGES_FULL } };
      if (path.includes('/gamification/leaderboard')) return LEADERBOARD_FULL;
      if (path.includes('/recommendations')) {
        return { recommendations: [
          { id: 'squat',  name: 'Bodyweight Squat', difficulty: 'beginner', primary_category: 'legs', calories_per_min: 8,  ai_supported: true  },
          { id: 'burpee', name: 'Burpee',           difficulty: 'advanced', primary_category: 'full', calories_per_min: 14, ai_supported: false },
        ] };
      }
      if (path.includes('/workouts/stats')) {
        const today = new Date().toISOString().slice(0, 10);
        return {
          stats: { total_workouts: 42, total_minutes: 930, total_calories: 7400, weekly_workouts: 3, streak: 5 },
          activity: { [today]: true },
          recent_workouts: [{ id: 'w1', completed_at: new Date().toISOString(), duration_minutes: 35, calories_burned: 280, form_accuracy: 88 }],
        };
      }
      return {};
    default:
      return {};
  }
}

createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost:8000').pathname;

  // The PREFLIGHT must always succeed, even in `hang` — otherwise the browser
  // rejects the request outright and the app sees a FAILURE instead of a
  // pending read, which is a different state and not the one under test.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors(req));
    return res.end();
  }

  if (path === '/__state') return json(req, res, 200, { state, available: STATES });
  if (path.startsWith('/__state/')) {
    const next = path.slice('/__state/'.length);
    if (!STATES.includes(next)) return json(req, res, 400, { error: 'unknown state', available: STATES });
    state = next;
    console.log('[mock-ml] state =', state);
    return json(req, res, 200, { state });
  }
  if (path === '/favicon.ico') return json(req, res, 404, {});

  // Every APP request is logged. If this log shows nothing but favicons while
  // you click through, the browser is blocking the calls — check CORS, do not
  // start filing bugs against the app.
  console.log('[mock-ml] >>>', state, req.method, path);

  if (state === 'hang') return;                       // never answers, never closes
  if (state === 'dead') return json(req, res, 500, { error: 'old backend down' });
  if (state === 'lbOnly') {
    if (path.includes('/gamification/leaderboard')) return json(req, res, 200, LEADERBOARD_FULL);
    return json(req, res, 500, { error: 'overview down' });
  }
  return json(req, res, 200, payloadFor(path));
// Bound to LOOPBACK, not every interface (T3 round 3 security note — reported as
// pre-existing, taken because this file was already open). `/__state/<name>` is
// a STATE-CHANGING GET with no auth, and the CORS block above reflects the
// caller's Origin with credentials:true — so on 0.0.0.0 any page anyone on the
// same wifi loads could flip the rig mid-smoke, and the symptom would look like
// an app bug. Nothing here is secret; the risk is a LYING INSTRUMENT, which is
// this file's own stated hazard. NB if a future card needs the rig reachable
// from a PHONE (the owed mobile smoke), change this line deliberately.
}).listen(8000, '127.0.0.1', () => console.log('[mock-ml] listening on 127.0.0.1:8000, state =', state));
