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
  'unscored',    // workout summary with the METRICS absent and every list a
                 //   STRING — the state OWED.md:730 was about. Before the
                 //   2026-07-30 reader this printed grade D / "Keep practicing"
                 //   in red for a workout nobody scored, "NaNh NaNm" for the
                 //   time, "undefined kcal", and the string-shaped lists blanked
                 //   the whole page at `.map`. Everything else 200s, so this
                 //   state isolates the summary payload.
  'lbOnly',      // overview fails, leaderboard 200s — round 4 F4
  'emptyLists',  // everything 200s with empty lists — round 6 F6
  'legacyCompleteFails',
                 // everything 200s EXCEPT the legacy save (PATCH …/complete),
                 //   which 500s. The write-path card's central claim is that
                 //   the new sync and the legacy save are independent — neither
                 //   one's failure drops or duplicates the other — and no state
                 //   could show it: `dead` and `hang` kill the CREATE too, so a
                 //   workout could not be started to begin with. Expected here:
                 //   the workout still syncs to the new API, and the page still
                 //   navigates. (write-path T3 round 2, F-5)
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
  // BOTH record shapes the old backend sends. The `{icon,value,label}` one was
  // added 2026-07-30 (T3 round 2 F4): until then no rig state could produce it, so
  // that render path had never been exercised in a BROWSER at any point in this
  // card — only in render tests. A smoke delta, not a code one.
  personal_records: ['Best form accuracy!', { icon: '🔥', value: 12, label: 'reps' }],
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

/** The `unscored` state's payload: every METRIC absent, and every LIST arriving
 *  as a bare string instead of an array. Both halves of OWED.md:730 in one state,
 *  because both are properties of this one payload and a smoke that had to switch
 *  states between them would be two click-throughs for one card.
 *
 *  A string rather than `{}` for the lists on purpose: `personal_records?.length
 *  > 0` is TRUE for a non-empty string and then `.map` is not a function, which
 *  is what actually blanked the page. `{}` has no `length`, so it merely hid the
 *  section and would make this state look milder than the real defect. */
const SUMMARY_UNSCORED = {
  session_id:       'smoke-1',
  completed_at:     new Date().toISOString(),
  xp_earned:        70,
  current_streak:   3,
  personal_records: 'Best form accuracy!',
  meal_suggestions: 'Paneer bhurji + rice',
  stretches:        'Hamstring stretch, 30s each side',
};

/** A slice of the old library, named EXACTLY as `scripts/seed_exercises.py`
 *  names them — the strings the web resolves through the reviewed 58-row
 *  catalog table. A near-miss here ("Push Ups") would make the app look broken
 *  when it is the rig that is lying, which is this file's stated hazard.
 *
 *  Two of these have an engine definition (Squats, Chair Squats) and three do
 *  not, so one smoke can cover both paths and a workout that mixes them. */
const LIBRARY = [
  { id: 'x1', name: 'Push-ups',      primary_category: 'chest', difficulty: 'beginner',
    sets_default: 2, reps_default: 3, calories_per_min: 8,  ai_supported: false },
  { id: 'x2', name: 'Squats',        primary_category: 'legs',  difficulty: 'beginner',
    sets_default: 2, reps_default: 3, calories_per_min: 8,  ai_supported: true  },
  { id: 'x3', name: 'Plank',         primary_category: 'core',  difficulty: 'beginner',
    sets_default: 1, reps_default: 2, calories_per_min: 5,  ai_supported: false },
  { id: 'x4', name: 'Bicep Curls',   primary_category: 'arms',  difficulty: 'beginner',
    sets_default: 2, reps_default: 3, calories_per_min: 5,  ai_supported: false },
  { id: 'x5', name: 'Chair Squats',  primary_category: 'legs',  difficulty: 'beginner',
    sets_default: 1, reps_default: 3, calories_per_min: 6,  ai_supported: true  },
];

function payloadFor(path, method = 'GET') {
  // ── The workout WRITE path (2026-08-02) ────────────────────────────────────
  // Without these three answers a workout cannot be STARTED on this branch at
  // all, so the hand-logged write path could not be smoked. The cause is not a
  // bug in this rig: `mlApi` attaches a bearer token only if localStorage holds
  // one, and Card 1 moved sessions to httpOnly cookies — so every old-backend
  // call on `web-repoint` now goes out unauthenticated. The REAL old backend
  // would reject them for exactly the same reason; this rig is the only way to
  // exercise a screen that still depends on that backend.
  // Matched by SUFFIX, like the summary branch below and for the same reason:
  // the web calls this backend under an `/api` prefix (VITE_ML_API_URL is
  // `http://localhost:8000/api`), so `path === '/workouts'` matches nothing a
  // browser ever sends. Caught while writing the smoke steps, before Kd ran it.
  // The two WRITE branches below do not branch on state THEMSELVES, but they
  // are NOT state-independent: `dead`, `hang` and `lbOnly` are short-circuited
  // in the request handler before this function is ever called, so in those
  // three states the create 500s or never answers. The first version of this
  // comment claimed independence and was wrong — verified live: POST in `dead`
  // returns 500, in `hang` it never responds. T3 round 2, F-5.
  //
  // `legacyCompleteFails` exists because of that finding: it was impossible to
  // observe the card's central independence claim — that the new sync and the
  // legacy save cannot drop each other — since no state could 200 the create
  // and then fail the completion. Now one can.
  if (method === 'POST' && /\/workouts$/.test(path)) {
    // PreWorkout reads `res.data.session.id` and stores it as the session the
    // legacy save later completes. A missing `session` key throws there and the
    // user never leaves the checklist screen.
    return { session: { id: `smoke-${Date.now()}` } };
  }
  if (method === 'PATCH' && /\/workouts\/[^/]+\/complete$/.test(path)) {
    // The legacy save. ActiveWorkout ignores the body and navigates to the
    // summary; what matters in a smoke is that this 200s, because a failure
    // here is caught and logged and would look like "nothing happened".
    return { message: 'workout completed' };
  }
  if (/\/exercises\/categories$/.test(path)) return { categories: ['chest', 'legs', 'core', 'arms'] };
  if (/\/exercises\/muscles$/.test(path))    return { muscles: [] };
  if (/\/exercises$/.test(path)) {
    // STATE-AWARE, like the summary branch below. The first cut of this branch
    // sat above the per-state switch and answered identically in every state,
    // so `empty200` and `emptyLists` — states whose whole purpose is to show
    // what the app does with nothing — served a full library. That is the same
    // class as this file's recorded round-2 finding (the summary branch
    // swallowing the running screen's payload): a rig that lies gets the app
    // blamed for it. T3 round 1, F5.
    if (state === 'empty200') return {};
    if (state === 'emptyLists') return { exercises: [], total: 0 };
    return { exercises: LIBRARY, total: LIBRARY.length };
  }

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
    if (state === 'unscored') return { summary: SUMMARY_UNSCORED };
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
    // `unscored` differs from `healthy` ONLY in the workout summary, which is
    // branched on above — so it falls through to healthy's payloads here on
    // purpose. That isolation is the point: anything wrong on the PostWorkout
    // screen in this state belongs to the summary payload and nothing else.
    case 'unscored':
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
  if (state === 'legacyCompleteFails' && req.method === 'PATCH'
      && /\/workouts\/[^/]+\/complete$/.test(path)) {
    return json(req, res, 500, { error: 'legacy save failed' });
  }
  if (state === 'lbOnly') {
    if (path.includes('/gamification/leaderboard')) return json(req, res, 200, LEADERBOARD_FULL);
    return json(req, res, 500, { error: 'overview down' });
  }
  return json(req, res, 200, payloadFor(path, req.method));
// Bound to LOOPBACK, not every interface (T3 round 3 security note — reported as
// pre-existing, taken because this file was already open). `/__state/<name>` is
// a STATE-CHANGING GET with no auth, and the CORS block above reflects the
// caller's Origin with credentials:true — so on 0.0.0.0 any page anyone on the
// same wifi loads could flip the rig mid-smoke, and the symptom would look like
// an app bug. Nothing here is secret; the risk is a LYING INSTRUMENT, which is
// this file's own stated hazard. NB if a future card needs the rig reachable
// from a PHONE (the owed mobile smoke), change this line deliberately.
//
// IPv4 LOOPBACK ONLY, and that is a deliberate keep. T3 round 4 (F8) correctly
// observed that a client which resolves `localhost` to `::1` sees the rig as
// down — and the symptom, "everything unavailable", is the exact signature of
// the CORS bug that invalidated a previous smoke run. **Its proposed fix,
// `listen(8000, '::')`, is WRONG and was not taken: `::` is the IPv6 WILDCARD,
// not loopback — on a dual-stack host it accepts every interface and would
// re-open the LAN exposure the previous round closed.** The safe options are
// `::1` (which breaks IPv4 clients instead) or two servers, neither worth it
// for a fixture rig. Kept on 127.0.0.1; the runbook's control step tells the
// tester what to try if the browser cannot reach it.
}).listen(8000, '127.0.0.1', () => console.log('[mock-ml] listening on 127.0.0.1:8000, state =', state));
