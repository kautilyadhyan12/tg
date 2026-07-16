# HANDOFF log (append-only; latest block goes under the next task's T1 prompt)

```
TASK: web repoint — Card 3: progress + measurements 🟡
      [branch web-repoint. PROVE green (below). T3 in a fresh chat still OWED
       before this card counts as done. NOT MERGED — branch merges at P2.8.]
PROCESS: ran in the onboarding-storage chat by explicit Kd instruction (Part I
  §1 deviation, recorded in DECISIONS). Grounded on-branch per S1 first.
SCOPE AS IMPLEMENTED (amendment declared, DECISIONS 2026-07-16): repointed the
  Progress page (6 chart reads → /v1/progress/*, @app/shared shapes) and
  MeasurementsTracker (→ /v1/nutrition/body-measurements, Part 4 §3.6; flat
  rows rebuilt from {items[].metrics}, `latest` derived client-side, POST =
  .strict() {measuredAt, weightKg?, metrics{}}). NOT repointed — NO-REMOVAL
  rule, no new-API surface exists (client headers + cutover.md owed lines):
  gamificationApi (XP/badges-catalog/challenges/leaderboard — P2.3 rulings) ·
  exerciseApi (names/instructions/media/search absent from Part 4 §3.4
  catalog) · getPredictions (2B §5 card) · workoutApi/WorkoutCalendar
  (endpoint EXISTS, client repoint owed — found out-of-scope, R1.1).
SHIPPED (7 files): api/progressApi.js (authApi client; predictions stays
  mlApi) · api/gamificationApi.js + api/exerciseApi.js (header docs only, no
  behavior change) · pages/Progress.jsx (contract field names; records list
  built client-side; heatmap array→map; weekly Wnn label; hours from
  totalDurationMs) · components/progress/MeasurementsTracker.jsx ·
  NEW api/progressApi.test.js (3: paths+params exact incl. .strict()-safe
  no-param reads; measurements CRUD; predictions-stays-old guard) ·
  RUNBOOK/cutover.md (owed-endpoints block under the web-repoint
  prerequisite; NB master's copy diverged via PR #31 — expect a trivial
  merge conflict at cutover, both edits are list inserts).
PROVE (real output): full web suite `corepack pnpm --filter web exec vitest
  run` → 60 passed / 1 failed of 61 — the 1 is the PRE-EXISTING syncClient
  .env quirk (HANDOFF Card 2: identical on master, passes in CI). vite build
  ✓ 42s. Lint: touched files vs branch baseline IDENTICAL (same 3 pre-existing
  MeasurementsTracker errors, line-shifted; api files + Progress.jsx clean).
UNTESTED (honest): the JSX adaptations (Progress.jsx, MeasurementsTracker) have
  no unit coverage — node-env vitest, no jsdom (adding it = new deps, R1.4;
  same gap Card 2 recorded). Needs the manual browser smoke vs the local API.
OPEN SPEC GAPS: none new. Sequencing flag recorded (DECISIONS): P4 leaderboard
  vs cutover.md:41 — decide at the cutover checkbox.
NEXT: T3 (fresh chat) on this diff → resolve → then Card ④ (coach). Also
  owed from Card 3 findings: workoutApi/WorkoutCalendar repoint (trivial,
  endpoint exists) — fold into a web card, do NOT absorb silently.
```

```
TASK: web repoint — Card 2: per-user storage keying + displayName migration 🔴
      [branch web-repoint. PROVE green (automated). T3 (fresh chat) DONE — found
       1 REAL correctness bug (flush identity race) + doc/accuracy fixes; ALL
       RESOLVED, see T3 RESOLUTION below. NOT MERGED — same branch strategy as
       Card 1: merges only at the P2.8 cutover.]
WHY THIS CARD IS MOSTLY A BUG FIX: Card 2 was planned as "users/profile
  repoint", but grounding proved that surface is BLOCKED by the onboarding-
  storage gap (below), and that Card 1 had introduced a real regression. So the
  card = that fix + the promised shim removal. Kd-ruled scope; nothing deleted.
*** CARD-1 REGRESSION FIXED (the important part) ***
  utils/storage.js getUserId() decoded the JWT from localStorage.accessToken to
  key EVERY per-user bucket. Card 1's httpOnly cookies made the token unreadable
  → getUserId() returned 'guest' for everyone. syncQueue.js:13 keys the OFFLINE
  QUEUE on userKey, so on a shared browser user A's unflushed workouts sat in the
  bucket B flushes under B's cookie → mis-attributed workouts (vs R10.3).
  FIX: storage.setCurrentUserId(id), pushed by AuthContext on getMe/login/logout.
  Card 1's T3 saw storage.js:28 but mis-classified it as Bearer-null breakage.
SHIPPED (7 files + 1 test): utils/storage.js (setCurrentUserId/getUserId, JWT
  decode deleted) · context/AuthContext.jsx (adoptSession = set id + kick flush;
  normalizeUser shim DELETED) · sync/syncClient.js (module-scope app-load flush
  REMOVED — declared plan amendment: it ran at import, pre-auth, so it read the
  'guest' bucket; AuthContext kicks it post-auth now; 'online' listener stays) ·
  Sidebar.jsx:149,153,188 + Coach.jsx:519 + Dashboard.jsx:262 + Running.jsx:136
  (user?.fullName → user?.displayName). NEW: utils/storage.test.js (4 tests).
PROVE (FULL suite — `corepack pnpm --filter web exec vitest run`):
  57 passed / 1 failed (58 tests, 9 files). The 1 is PRE-EXISTING ON MASTER
  (verified by stashing: identical failure): syncClient.test.js's "no-op when
  VITE_API_URL is not configured" fails locally because vitest loads
  apps/web/.env which SETS VITE_API_URL; passes in CI (no .env committed). Not
  touched (R1.1). vite build ok. Lint: every file I touched → 0; the files I
  only renamed a token in match the master baseline EXACTLY (AuthContext 6→6,
  Sidebar 2→2, Coach 5→5, Dashboard 0→0, Running 2→2) — zero new problems; the
  web is lint-dirty on master independently.
  V1 NOTE: this block first said "30 passed / 1 failed" — that was a FILTERED
  run (`vitest run storage sync authApi`) reported as if it were the suite. T3
  caught it. Numbers here are now the full suite; quote the command with them.
  UNTESTED (honest): the adoptSession→flushSyncQueue coupling needs jsdom/RTL,
  which the web lacks (node-only vitest) — manual smoke only.
T3 RESOLUTION (all findings closed):
  · FIXED (real bug, R10.3): flushRun bound the queue KEY at run start but
    identity binds at SEND time (postSync carries the ambient cookie), so a
    logout+login mid-run kept draining A's bucket while the server attributed
    the workouts to B — the residual half of this card's own hazard. flushRun
    now captures `owner = getUserId()` and returns before any post() if identity
    moved; abandoned entries stay queued (not dropped, not sent). Regression
    test added AND proven to fail without the guard (sent ['a1','a2'] vs ['a1']).
  · FIXED (docs): the "AuthContext kicks the flush" comment implied equivalence
    with the removed import-time flush. It is NOT equivalent — if /v1/auth/me
    fails at app load, no flush runs that page-session. Accepted + recorded as a
    liveness delay (never data loss); comment + DECISIONS corrected.
  · FIXED (docs): the orphaning entry read as a PRODUCTION hazard. It is
    dev/test-only — prod launches with an EMPTY db (cutover.md:11-13). Corrected,
    and it is now a real CHECKBOX in RUNBOOK/cutover.md (that file already
    existed; "owed by a future card" is how such items get lost — T3's point).
  · REPORTED not fixed (R1.1): syncApi has NO timeout (syncClient.js:21-25) — a
    hung POST holds a run open; the owner check makes that harmless, so it is
    left for the sync card. AND: AuthContext exports `setUser` raw (:123) and
    GoogleAuthSuccess.jsx:37 calls it, bypassing adoptSession → would key a
    Google user to 'guest'. UNREACHABLE today (route deleted) — but the Google
    OAuth card MUST adopt via adoptSession or stop exporting setUser.
*** OWED / KNOWN, DO NOT TREAT AS BUGS ***
  (a) ONBOARDING-STORAGE GAP is the real blocker and is the NEXT CARD. v1
      §6.1:442 gives the users module "onboarding data" but Part 4 defines NO
      storage for it, and P2.7 dropped those Mongo fields ("no target; the queued
      onboarding-storage gap", INVENTORY.md:45). It also blocks RECOMMENDATIONS:
      Part 2B §4.1:358's scorer is goal 40 · difficulty 20 · equipment 20 ·
      duration 10 — exactly the dropped fields. So the Onboarding wizard, both
      Settings profile forms, the avatar, and the 3 onboarding gate sites stay on
      the OLD backend, untouched. NOTHING IS DELETED. Build the storage (T5: SQL
      to Kd first; shape derivable from INVENTORY.md:45 + Part 2B §4).
      HARD BLOCKER before the old backend is decommissioned at P2.8.
  (b) LEGACY BUCKET ORPHANING → owed by the P2.8 RUNBOOK (Kd-ruled defer):
      existing buckets are keyed by the old Mongo ObjectId, the app now uses the
      new UUID → drafts + unflushed queued workouts orphan at cutover. Runbook
      must drain queues pre-cutover or accept the loss explicitly.
  (c) Still-old clients (mlApi/coachApi/nutritionApi + Settings delete-account)
      still send `Bearer null` — their own cards. DELETE /v1/users/me exists but
      takes NO body while the web sends {password}; left out of Card 2 (that
      would weaken re-auth) — needs a ruling in its card.
NEXT: onboarding-storage API card (T5) → then remaining web cards ③–⑦ → P2.8.
OPEN SPEC GAPS: the onboarding-storage gap (a) — recorded, ruled, queued.
```

```
TASK: web repoint — Card 1: auth → httpOnly-cookie on the new /v1 API 🔴
      [branch web-repoint, commit 44f847c. PROVE green (automated). T3 (fresh
       chat) found NO code/security violations; its findings were R11
       documentation only — CLOSED by this block + the DECISIONS 2026-07-15
       section. NOT MERGED and must not be: see BRANCH STRATEGY below.]
SPEC: v1 §6.1:439 (auth = "rotating refresh tokens (httpOnly cookie on web)"),
  §13:763 (SPA changes — does NOT itemize this repoint), §18:856. Prerequisite
  for P2.8 ("web runs 100% on the new API", §22/line 991).
WHY THIS IS NOT A CONFIG FLIP: the web ran the OLD model (localStorage
  access/refresh + Bearer on every client); the new API is cookie-only with no
  tokens in any body (shared/src/auth.ts:52). So it's an auth-model rewrite,
  decomposed into cards ①auth ②users/profile ③progress/gamification/exercises
  ④coach ⑤nutrition ⑥running/geo ⑦recommendation-or-drop. This is ①.
BRANCH STRATEGY (Kd-ruled, DECISIONS 2026-07-15): auth is all-or-nothing, so the
  moment it flips, every not-yet-repointed client loses its localStorage token.
  ALL web-repoint cards are commits on ONE branch `web-repoint` (each with its
  own T3); it merges to master ONLY when the web fully runs on the new API =
  the P2.8 cutover. master stays deployable (old-backend web) until then.
SHIPPED (6 files + 1 test): authApi.js (baseURL→VITE_API_URL, /v1/auth/* paths,
  Bearer request-interceptor REMOVED, reactive 401→POST /v1/auth/refresh→retry-
  once interceptor [single shared refresh on concurrent 401s; login/refresh
  excluded; loop- + window-guarded redirect], +changePassword) · AuthContext.jsx
  (mount→/v1/auth/me, login sets {user} only, register maps fullName→displayName,
  logout stops touching tokens, normalizeUser fullName compat shim) · Login.jsx +
  Register.jsx (Google behind GOOGLE_LOGIN_ENABLED=false) · App.jsx (Google route
  + import removed) · Settings.jsx (change-password → cookie authService).
  NEW: api/authApi.test.js (5 interceptor tests, node env + mock adapter).
PROVE: authApi tests 5/5; `vite build` ok (3415 modules); the 6 changed files
  lint-clean. NOTE web lint is RED overall — 73 PRE-EXISTING errors on master in
  untouched salvage files (10 in Settings.jsx: Date.now purity, setState-in-
  effect); this card adds none. MANUAL BROWSER SMOKE NOT YET RUN (a chat can't
  drive a browser) — owed by Kd: API WEB_ORIGIN=http://localhost:5173 + API on
  :3000, web VITE_API_URL=http://localhost:3000 → register/login → cookies set
  (DevTools→Application→Cookies) → reload keeps session → logout clears.
*** KNOWN-BROKEN INTERIM ON THIS BRANCH (by design; do NOT treat as bugs) ***
  (a) ONBOARDING IS NEVER ENFORCED: authUserSchema has no onboardingCompleted
      (it's a users-module field, v1 §6.1:442), so ProtectedRoute.jsx:44,:54 and
      Login.jsx:33 all compare undefined === false → false. Fails OPEN. RESTORING
      IT IS OWED BY CARD ② when /v1/users/me supplies the field.
  (b) STILL-OLD CLIENTS SEND `Bearer null` and break: mlApi.js:10, coachApi.js:17,
      nutritionApi.js:31, utils/storage.js:28, Settings.jsx:401 (delete-account).
      Each is repointed by its own card. Card 1 PROVE must NOT be expected to
      exercise coach / ML-profile / nutrition / delete-account.
  (c) pages/GoogleAuthSuccess.jsx is ORPHANED dead code (no route/import) that
      still writes localStorage.setItem('accessToken') (:31) and calls the wrong
      /auth/me path (:35). Unreachable → inert. The Google-OAuth card must
      rewrite or delete it.
NEXT: Card ② users/profile (repoint userApi/profile reads+writes to /v1/users/me;
  restore onboarding gating; migrate the 6 user?.fullName sites and DROP the
  normalizeUser shim). Then ③–⑦, then P2.8 cutover per RUNBOOK/cutover.md.
OPEN SPEC GAPS: none. v1 §13 doesn't itemize the repoint; §6.1/§18 fix the auth
  model and the card ordering is an implementation choice (Kd-ruled auth-first).
```

```
TASK: argon2id rehash-on-login 🔴 (the P2.1 GAP-1 deferral; owed before P2.8 cutover)
      [MERGED via PR #28 (commit 2f178bb; merge 67b0ba7, final master 67b0ba7,
       2026-07-14). PROVE green (typecheck/lint, unit 17/17, DB-gated routes
       20/20 incl. rehash-flip). T3 (fresh chat) CLEAN — no violations, no
       blocking findings; the mixed-population timing residual + the
       algorithm:2 const-enum workaround confirmed as deliberate documented
       decisions, not findings.]
      *** P2.8 cutover PREREQUISITE (1 of 2) now SATISFIED. ***
SPEC: v1 §6.1 ("upgrade to argon2id on next login"), R3.7. Kd approved the plan.
DEP: +@node-rs/argon2 (prebuilt binaries, no node-gyp; win32-x64 + linux-x64
  prebuilts resolved at install). bcryptjs KEPT (verifies legacy hashes).
SHIPPED (5 source + 2 test files, no migration — hash_algo CHECK already allows
  'argon2id', identity.ts:37):
  · service.ts: PasswordHasher now { algo, hash, verify(pw,hash,algo),
    needsRehash(algo) }; bcryptHasher→argon2idHasher (verify dispatches
    bcrypt.compare vs argon2.verify — NB argon2.verify(hash,password) hash-first);
    DUMMY_HASH→argon2id (exported for test); login → verify-by-algo + BEST-EFFORT
    rehash-on-login (swallow+log, awaited, never fails a valid login);
    changePassword + resetPassword verify-by-algo & write hasher.algo.
  · repo.ts: type HashAlgo; hashAlgo added to UserAuthRow/UserAuthDbRow/mapper +
    BOTH SELECTs (findUserByEmail:50, findUserById:57); toHashAlgo guard;
    createUser + setPasswordHash take an algo param (were hardcoded 'bcrypt').
  · routes.ts: wire argon2idHasher.
  · auth.unit.test.ts: fake→new interface; +5 tests (verify-by-algo, needsRehash,
    DUMMY_HASH is argon2id, OWASP params). auth.routes.test.ts: register asserts
    argon2id; legacy-hash test EXTENDED to prove the bcrypt→argon2id flip +
    2nd-login no-op.
PROVE (all green this session): typecheck 0, lint 0, unit 17/17, DB-gated routes
  20/20 (Neon; incl. the rehash-flip test: legacy bcrypt verified → upgraded to
  argon2id → re-login byte-identical no-op). Red-flag greps clean.
DECISIONS (2026-07-14): argon2id params (OWASP), const-enum→literal 2, best-effort
  awaited-swallow rehash, DUMMY_HASH mixed-population timing limitation (accepted,
  self-healing), null-algo fail-closed, no migration. See DECISIONS.md tail.
NEXT: (1) T3 in a FRESH chat on `git diff master...argon2id-rehash`; resolve every
  finding + push. (2) then READY TO MERGE → PR → CI green → merge. (3) THEN P2.8
  cutover is unblocked on this prerequisite (still also needs apps/web repointed:
  authApi/coachApi/mlApi/nutritionApi → new API; only syncClient does today).
OPEN SPEC GAPS: none.
```

```
TASK: P2.7f — Mongo→PG migration: verify gates + prod runbook 🟡 (migration CAPSTONE)
      [MERGED via PR #27 (commits 5dc736d + 3e0bcd8; merge e43119b, final master
       e43119b, 2026-07-13). PROVE green (--verify-only on rebuilt Neon); T3
       (fresh chat) 1 finding FIXED + 1 advisory recorded. 4 pure tests green.]
      *** P2.7 Mongo→PG MIGRATION COMPLETE — all six stages (a–f) merged. ***
SCOPE (Kd-confirmed, DECISIONS 2026-07-13): P2.7f = strengthened §7 verify gates
  + a P2.8 cutover RUNBOOK document — NOT the live cutover. It repoints/freezes/
  decommissions NOTHING. (DECISIONS:194 defines the split as "verify gates + prod
  runbook"; live cutover is P2.8, premature — see PREREQUISITES below.)
SHIPPED: verify.ts +comparePerUser (pure) +verifyParity — PER-USER count parity
  across workouts/sets/meals/coach_messages/runs + UUIDv5 cross-ref spot-check
  (workout→user, samples only transform-accepted workouts after T3-A). run.ts
  +--verify-only mode (gates, NO writes) + elapsed-time log (§7 timing). RUNBOOK/
  cutover.md (the P2.8 procedure + prereq checklist; "flip data_backend" = the
  seeded feature_flags row, not an env var). Test: migrate.parity (4 pure,
  comparePerUser incl. swapped-but-equal-total case).
PROVE (--verify-only, live Mongo → Neon holding ALL six stages): every gate ok,
  per_user_mismatches=0, crossref_sampled=20 crossref_ok=true, elapsed ~12s.
  typecheck+lint clean.
T3 (DECISIONS 2026-07-13): finding A FIXED (cross-ref sampled all sessions
  regardless of migratability → a skipped session's absence-from-PG was a
  fail-closed FALSE failure; now samples transform-accepted only). Advisory
  recorded: workouts/sets per-user scoping is by migrated-user (no legacy_mongo_id
  column) so a MIXED db (migrated + native workouts for one user) could false-
  mismatch — harmless on greenfield/verified-dev, no fix.
FULL RUN CHEATSHEET (all stages, idempotent; env in apps/api/.env):
  corepack pnpm --filter api exec drizzle-kit migrate         # schema
  corepack pnpm --filter api exec tsx src/db/seed.ts          # reference data
  corepack pnpm --filter api exec tsx tools/migrate-mongo/run.ts [--apply|--verify-only]
NEXT — P2.8 CUTOVER (the actual go-live; SEPARATE task, BLOCKED on prerequisites):
  (1) argon2id rehash-on-login card (DECISIONS 2026-07-11, owed before P2.8).
  (2) apps/web repointed to the new API — today only syncClient.js → new API;
      authApi/coachApi/mlApi/nutritionApi still → OLD backend-auth/backend-ml.
  Then execute RUNBOOK/cutover.md (freeze → final --apply → --verify-only gates →
  flip data_backend flag → unfreeze → Mongo read-only 30d → decommission old).
  backend-auth/backend-ml/ml-training stay in-repo as the salvage source for the
  UNBUILT Phases 3–6 (money, exercise line, mobile, pilots) — do NOT delete yet.
OPEN SPEC GAPS: none. Old Mongo container (aihg-mongo) still running; Neon
  p26b-test rebuilt this session holds a complete verified migration.
```

```
TASK: P2.7e — Mongo→PG migration: coach + running (schedules deferred) 🔴
      [MERGED via PR #26 (commits f535f72 + 150b86f; merge e848147, final master
       e848147, 2026-07-13). PROVE green on live Mongo → Neon; T3 (fresh chat)
       CLEAN — no violations, 3 advisories (1 fixed, 2 recorded). 10 pure + 3
       DB-gated tests green.]
DECISIONS (2026-07-13, Kd-ruled): GAP-F (G-poly) polyline is opaque text
  (shared/geo.ts:38 "opaque text passthrough" z.string()) → legacy path/coords
  [lat,lng] arrays JSON.stringify'd, no encoder invented. GAP-G defer
  running_schedules (rule jsonb shape unspecified, n=1, 'cancelled'). GAP-H NOT
  NULL defaults: runs.duration_s=round(min*60) or 0, distance_m=round(km*1000),
  kcal_point=round(cal) or null, kcal_calc_version=0, source='mobile', splits
  jsonb or null; saved_routes.name=label or 'Legacy route', skip route on empty
  coords. GAP-I (ORDERING BUG, caught at plan review) all 11 convs have tied
  per-message timestamps + read path sorts (created_at DESC, id DESC) with a
  HASH UUIDv5 id → coach_messages.created_at = anchor + arrayIndex ms (anchor =
  first msg ts / updated_at / epoch) so created_at is strictly monotonic per
  thread. No gamification step (coach/runs don't feed getStats).
GROUND TRUTH (live Mongo, scanned this session): coach_conversations 11 (32
  messages; roles only user/assistant ∈ CHECK; 0 empty content; 2 distinct
  users). running_sessions 8 (duration_min/calories/splits missing in 2 each —
  guarded). running_routes 17 (0 missing coords/label). running_schedules 1
  (deferred). All user_ids among the 18 migrated. BSON types verified (no
  string-as-number). coach_messages has NO legacy_mongo_id (verify via thread
  membership); threads/runs/saved_routes DO.
SHIPPED (apps/api/tools/migrate-mongo/): collections/coach.ts (transformCoach +
  insertCoach, thread+messages in one tx, GAP-I anchor+index created_at) ·
  collections/running.ts (transformRun/transformRoute + inserts; asJsonValue for
  splits jsonb, workouts precedent) · verify.ts +verifyCoachRunning (threads/
  messages/runs/routes) · run.ts (coach → runs → saved_routes; run_schedules
  deferred log). Tests: migrate.coach (5 pure incl. ordering + role/content
  guards), migrate.running (5 pure), migrate.coach-running.idempotency (3
  DB-gated: ordering read-back via REAL getRecentMessages, polyline round-trip,
  idempotency).
PROVE (live Mongo → Neon): full --apply VERIFY all ok — coach_threads 11=11,
  coach_messages 32=32, runs 8=8, saved_routes 17=17 (+ all prior stages).
  typecheck+lint clean.
⚠ NEON BRANCH WAS RESET this session (free-tier): symptom = "password
  authentication failed" + new endpoint host (ep-summer-union → ep-plain-thunder),
  and the schema was WIPED. Recovered idempotently: drizzle-kit migrate → seed →
  full --apply (repopulated ALL stages). apps/api/.env now holds the new
  connection string. So the Neon test DB currently holds a COMPLETE verified
  migration of every P2.7 stage — a good state for P2.7f's end-to-end verify.
T3 ADVISORIES (DECISIONS 2026-07-13; NOT blockers): (1) migrated saved_routes
  store JSON coord-array polyline vs native client-encoded — a future map decoder
  must handle both (spec-ruled GAP-F, prod empty; accepted). (2) FIXED — ordering
  test now uses the real getRecentMessages path. (3) pre-existing: live coach read
  path has no id tiebreaker on equal created_at (out of scope, future coach task).
REMAINING P2.7 STAGES: P2.7f — full verify gates + cutover (P2.8): web .env →
  new API only, freeze Mongo read-only, decommission old backend-auth/backend-ml.
  LAST stage. Old Mongo container (aihg-mongo) still running.
OPEN SPEC GAPS: none.
NEXT: P2.7f (final verify gates + cutover). Neon test DB holds all stages;
  apps/api/.env has the current (post-reset) connection string.
```

```
TASK: P2.7d — Mongo→PG migration: meal_logs + body_measurements 🔴
      [MERGED via PR #25 (commits d8c5b73 + b39b0c0; merge 8627a23, final master
       8627a23, 2026-07-13). PROVE green on live Mongo → Neon p26b-test; T3 (fresh
       chat) CLEAN — no violations, 2 advisories recorded. 10 pure + 3 DB-gated
       tests green.]
DECISIONS (2026-07-13, Kd-ruled): GAP-A (the meal item) meal_logs.items is NOT
  NULL jsonb re-validated by @app/shared mealItemSchema on EVERY read → build ONE
  synthetic item: gramsPoint=100/gramsRange=[70,130] (placeholder), portionSource=
  'legacy' (honest flag; IS in the enum), nutritionSource='curated' (enum lacks a
  legacy value); row nutrition_sources=['legacy_model']. GAP-B drop meal_type/
  fiber_g/notes/quantity. GAP-C origin='manual' (no structured photo field). GAP-D
  body → users.weight_kg refresh to latest measurement (overwrites P2.7b weight).
  GAP-E re-run onMealLogged per meal-user (idempotent badge award; lazily
  reconciles streak to today). Meal row fixed: confirmed=true, kcal ±30% band,
  portion_source='legacy', calc_version=0, legacy_mongo_id=_id, ON CONFLICT (id).
GROUND TRUTH (live Mongo, scanned this session): meal_logs 16 (ONE user
  6a0d468a…, also a P2.7c workout user; keys meal_type/food_name/quantity/kcal/
  protein_g/carbs_g/fat_g/fiber_g/notes/consumed_at). body_measurements 1 (same
  user; weight_kg=75 + 7 *_cm + body_fat_pct). Both targets HAVE legacy_mongo_id.
SHIPPED (apps/api/tools/migrate-mongo/): collections/meals.ts (transformMeal pure
  + insertMeal idempotent; ONE mealItemSchema-valid item) · collections/body.ts
  (transformBody + insertBody + refreshUserWeight, mirrors nutrition/repo.ts
  refreshWeight verbatim) · verify.ts +verifyNutrition (meals/body via
  legacy_mongo_id, re-derived through the tested transform) · run.ts (meals →
  body(+weight refresh) → meal gamification onMealLogged). Tests: migrate.meals
  (6 pure incl. mealItemSchema.parse guard), migrate.body (4 pure),
  migrate.nutrition.idempotency (3 DB-gated: schema-valid read-back + idempotency
  + weight refresh + first_meal once).
PROVE (live Mongo → Neon p26b-test): dry-run meals 16/body 1/0 skipped; --apply
  meals inserted 16, body 1, weight_refreshed_users=1, meal gamification users=1,
  VERIFY meals 16=16 + body 1=1 ok (all prior gates still ok). typecheck+lint
  clean. Local secrets in apps/api/.env (gitignored).
T3 ADVISORIES (recorded, DECISIONS 2026-07-13; NOT blockers): (1) editing a
  MIGRATED meal later erodes provenance — nutrition/repo.ts updateMeal worst()/
  sources() don't recognize 'legacy'/'legacy_model' → a PATCH rewrites them to
  'user_dishware'/['curated']. Pre-existing P2.6a code, out of scope, accepted
  (prod starts empty). (2) verifyNutrition is count-only (per the ruled count-gate
  doctrine), lighter than §7:911-914's checksums.
REMAINING P2.7 STAGES: P2.7e coach_conversations→coach_threads+coach_messages +
  running_* (running_schedules deferred, G-rule); P2.7f full verify gates +
  cutover (P2.8). Old Mongo container (aihg-mongo) still running.
OPEN SPEC GAPS: none.
NEXT: P2.7e (coach + running). Old Mongo live; Neon p26b-test seeded.
```

```
TASK: P2.7c — Mongo→PG migration: workouts + workout_sets + gamification recompute 🔴
      [MERGED via PR #24 (commits 53e94a9 + 73d37f8; merge f2cf0a7, final master
       f2cf0a7, 2026-07-13). PROVE green on live Mongo → Neon p26b-test; T3 (fresh
       chat) 2 findings, BOTH resolved + pushed. 7 pure + 2 DB-gated tests green.]
DECISIONS (2026-07-13, Kd-ruled): GAP1=(a) explicit 14-name→slug map
  (exerciseNames.ts, reviewed constants table — seeded slugs are singular vs
  legacy plurals); unseeded names skipped + 'unknown_exercise' flagged. GAP2
  workout_sets.duration_ms=0. GAP3 workouts UUIDv5-only traceability (NO schema
  change). G-kcal (T3-A): DEVIATION from §7 — kcal recompute IMPOSSIBLE
  (active_seconds_by_exercise never persisted, per-set duration_ms=0 → recompute
  zeroes kcal), so keep stored calories_burned at calc_version=0; ratifies the
  P2.7a "pending" note. Re-run correction (T3-B): an INCREMENTAL re-run does NOT
  self-heal skipped names (global set_index shifts+collides; parent aggregates
  ON CONFLICT DO NOTHING) — to pick up P4-seeded names, do a CLEAN re-migrate
  (clear workout tables, re-run). Same-seed re-run IS a true no-op (tested).
GROUND TRUTH (live Mongo, scanned this session): 230 workout_sessions (0 missing
  started_at), 14 distinct exercise names (3 seeded: squat/jump_squat/chair_squat),
  262 items, 625 total prescribed sets, 356 RESOLVABLE (269 skipped), 3 distinct
  users with workouts (all present in the 18 migrated users). exercises[] are
  prescriptions {id,name,sets,reps} — 0/230 carry per-set perf.
SHIPPED (apps/api/tools/migrate-mongo/): exerciseNames.ts (NAME_TO_SLUG reviewed
  table) · collections/workouts.ts (transformWorkout pure + insertWorkout
  idempotent [workout ON CONFLICT (id), sets ON CONFLICT (workout_id,set_index)]
  + loadExerciseIds) · verify.ts +verifyWorkouts (workouts/sets/streaks gates,
  re-derive expected via the tested transform) · run.ts (users→workouts→recompute
  →verify; recompute REUSES gamification/service onWorkoutSynced, not reimpl) ·
  mongo.ts (reader now normalizes ALL top-level ObjectId→hex, was _id only).
  Tests: migrate.workouts (7 pure: unroll/mapping/guards/determinism),
  migrate.workouts.idempotency (2 DB-gated: unroll+idempotency+recompute; hook
  timeout raised to 120s for remote-Neon seed).
PROVE (live Mongo → Neon p26b-test): dry-run users 18/230 workouts/269 sets
  skipped; --apply VERIFY all ok (users 18=18, bcrypt 17/17, workouts 230=230,
  sets 356=356, streaks 3=3); re-apply inserted=0 (idempotent). typecheck+lint
  clean. Local secrets in apps/api/.env (gitignored) for future stages.
REMAINING P2.7 STAGES: P2.7d meal_logs+body_measurements; P2.7e coach+running
  (schedules deferred, G-rule); P2.7f full verify gates + cutover (P2.8). Old
  Mongo container (aihg-mongo) still running for these.
OPEN SPEC GAPS: none.
NEXT: P2.7d (meals + body_measurements). Old Mongo live; Neon p26b-test seeded.
```

```
TASK: P2.7a + P2.7b — Mongo→PG migration (inventory + harness + users) 🔴
      [MERGED via PR #23 (commit 0808d2d; final master 346528b, 2026-07-13).
       PROVE green on Neon p26b-test; T3 clean (6 findings resolved). Full
       suite 197/197.]
DECISIONS (all 2026-07-13, Kd-ruled): full migration BUILT per §7 (approach B —
  a DEVIATION to skip it was raised and REJECTED); PRODUCTION starts CLEAN (dev
  data NOT imported — the migration is a verified correctness artifact); UUIDv5
  in-house (NAMESPACE_AIHG=4fc832e8-4827-4475-bf8a-e72cc4b611c7); mongodb devDep
  approved (A); running_schedules deferred (rule shape unspecified, n=1).
GROUND TRUTH (live dev Mongo `aihg-mongo`, db ai_home_gym, scanned this session):
  users:18 (ONE merged auth+ml+onboarding collection; 17 pw, 1 google) ·
  workout_sessions:230 (exercises[] are PRESCRIPTIONS {id,name,category,sets,
  reps,rest}; 0/230 have per-set perf → workout_sets unroll = expand sets count,
  all engine cols NULL) · workout_templates:0 · meal_logs:16 · coach_conv:11 ·
  body_measurements:1 · running 8/17/1 · exercises:58 (not migrated, re-seeded).
  active_seconds_by_exercise NOT stored → §7 kcal recompute impossible (keep
  stored value). Full data-verified map: apps/api/tools/migrate-mongo/INVENTORY.md.
SHIPPED (apps/api/tools/migrate-mongo/): uuid5.ts (RFC-4122 v5, no dep) · weight.ts
  (KG_PER_LB port, NULL not 70) · mongo.ts (read-only, _id→hex) · pg.ts · verify.ts
  (§7 count + bcrypt gates) · run.ts (tsx CLI: dry-run/--apply) · collections/
  users.ts (transform + idempotent insert; gamification recompute DEFERRED to a
  post-workouts stage). Tests: migrate.uuid5 (RFC vector), migrate.users (pure),
  migrate.idempotency (DB-gated). Config: tsconfig+lint include tools/; mongodb devDep.
PROVE (live Mongo → Neon p26b-test): dry-run read=18/transformed=18/skip=0;
  --apply inserted=18, VERIFY count 18=18 (countDocuments, exact) ok, bcrypt
  17/17 intact; re-apply inserted=0 (idempotent). T3: 6 findings fixed
  (gate uses exact count; ON CONFLICT (id) + per-row fail-soft; Invalid-Date/
  bad-email/weight-overflow hardened). typecheck+lint clean. Full suite 197/197.
REMAINING P2.7 STAGES (owed, all rulings pre-approved with defaults in INVENTORY.md
  "Rulings still owed"): P2.7c workouts→workouts+sets (prescription unroll, kcal
  keep-stored) + gamification recompute (streaks/user_achievements); P2.7d meals
  + body_measurements; P2.7e coach + running (schedules deferred); P2.7f full
  verify gates + cutover (P2.8). Old Mongo container is running for these.
OPEN SPEC GAPS: none (G-rule = running_schedules deferred).
NEXT: T3 on this diff (fresh chat) → commit+PR → merge → P2.7c.
```

```
TASK: P2.6b — geo/running READ-plan side 🟡 [MERGED to master via PR #22
              (commit 31698a3; final master 20d530c, 2026-07-13). PROVE green
              184/184 on Neon branch p26b-test, T3 clean (1 R9 finding resolved).]
SCOPE SHIPPED (new module apps/api/src/modules/geo/, R7.1):
  ors.adapter.ts — OpenRouteService round_trip provider, plain fetch + Zod
    (NO SDK, vision.adapter precedent); ports routing_provider.py
    _call_ors/_parse_ors_feature/_normalize_route/_ors_extras_fraction
    ([lng,lat]→[lat,lng], native metres, waytype/surface fractions, loop).
    MOCK generator NOT ported (G2 — fabricated geodata; fail-closed).
  geocode.ts — two-layer geocode cache seam: Redis `geo:{lat3}:{lng3}` over the
    geo_cache Postgres floor, 3-dp rounding (v1 §6.1/§7.2). RESOLVER-LESS by
    design (G1); live provider + endpoint defer to P5 (geocode-on-save = mobile,
    v1 §12). Exercised by the fake-resolver integration test.
  repo.ts — sole DB toucher: runs read (list summary w/o polyline, detail w/
    polyline), saved_routes CRUD, geo_cache get/upsert, insertRouteGenCostEvent
    + module-local getLiveGymId (dup'd from nutrition, R7.1 disclosed).
  service.ts — generateRoutes (fail-closed: no-key/ORS-blip → GeoError 503, no
    mock; seeds 11+i*37; one cost row per successful ORS call), saved_routes +
    runs read seams.
  routes.ts — thin. Generate order: authn → validateGenerate (400 never meters)
    → requireQuota("route_gen") → handler. Endpoints: POST /v1/geo/routes/
    generate; POST/GET/GET/DELETE /v1/geo/saved-routes[/:id]; GET /v1/geo/runs;
    GET /v1/geo/runs/:id. cost.ts = ORS_ROUTE_COST_MICRO=0n (cited).
  errors.ts — GeoError (added to app.ts error-mapper allowlist).
  packages/shared/src/geo.ts — request/response Zod (R7.2); config.ts +ORS_API_KEY
    optional (GROQ precedent); app.ts registers geo + overrides.geo seam.
NO MIGRATION: all four geo tables (runs/saved_routes/run_schedules/geo_cache)
  already exist in 0001_init.sql (verified this session). Read-side card.
RULINGS (all in DECISIONS 2026-07-13): CORRECTION 1 targetKm gt=0/le=42.2/def 5.0
  ported verbatim (no floor); CORRECTION 2/G3 count 1–5 def 3, 1 quota slot/req +
  1 cost row/ORS call; G1 cache seam resolver-less by design; G2 mock dropped,
  503 fail-closed; G3 scoring+weather deferred (engine/P5); G4 run_schedules
  deferred, runs read-only (record/sync = P5); ORS cost=0 call-count row; splits
  omitted from runs read (unspecified jsonb, P5 owns writer).
PROVE (GREEN, Neon branch p26b-test, migrations 0001–0005 applied via
  drizzle-kit migrate): FULL suite 20 files / 184 tests PASSED, 0 failed, 0
  skipped = the 170 P2.1–P2.6a regression INTACT + 14 new geo tests (geo.unit 5
  + geo.routes 9). Explicitly verified: count=3 → 1 quota slot + 3 cost rows +
  seeds [11,48,85]; no-key & Redis-down both 503 with provider never called;
  free monthly limit 2 → 3rd req 429; saved_routes + runs cross-tenant 404;
  polyline detail-only; two-layer geocode cache miss→backfill / Redis-hit /
  PG-floor-hit; saved_routes pagination page-2 cursor round-trip. typecheck +
  lint clean, red-flag greps clean.
T3 (independent fresh chat, CLEAN): ZERO R0–R11 violations, ZERO security
  defects. One R9 coverage finding — geo pagination boundary untested — RESOLVED
  this session (added the page-2 nextCursor round-trip test; green above).
  Reviewer confirmed all deferrals (G1–G4) sound.
OPEN SPEC GAPS: none (G1–G4 all ruled by Kd at the gate).
DEFERRED TO P5: run recording/sync (runs write), route SCORING (scoring.py →
  @app/engine), WEATHER (check_weather), live reverse-geocode provider +
  endpoint, run_schedules CRUD, running XP/streak/badges (running.py record path).
NEXT: commit the P2.6b diff on a feature branch → browser PR (no gh CLI) → Kd
  merges → P3 (money & orgs) or remaining P2 cutover per Kd.
```

```
TASK: P2.6a — nutrition (Part 2B §3 pipeline) + body_measurements CRUD 🟡
              [MERGED to master via PR #20 (module, 34438bf) + PR #21 (T3 fixes,
               2bd5fbc — #20 was merged early by mistake before the T3 push; the
               follow-up PR carried exactly the fix commit; final master state is
               COMPLETE @ 47d3fe9, 2026-07-12). PROVE green 170/170 on FRESH Neon branch
               p26a-test (migrations 0001–0005 applied), ZERO skips — full
               P2.1–P2.5 regression + 13 new nutrition tests. Built across two
               sessions: the ruled implementation chat hit its rate limit
               mid-task; this session VERIFIED every ruling against the code and
               COMPLETED 3 gaps it left. Awaiting Kd review + T3 (required all).]
MIGRATION 0005 (SQL approved via ruling before code): meal_logs.origin text
  NOT NULL DEFAULT 'manual' CHECK (origin IN ('photo','manual')) — the
  photo-vs-manual discriminator Part 4 §3.6 lacked (R4.2: SQL-filtered ⇒ real
  column; one_time_tokens precedent). Journal idx 4 = 0005_meal_logs_origin.
WHAT SHIPPED (module apps/api/src/modules/nutrition/, R7.1):
  vision.adapter.ts — §3.2 Stage-1 identify-only contract (temp 0, JSON mode,
    .strict() schema with NO kcal/grams/macro fields — a reply smuggling them
    FAILS parse and keeps usage for the ledger); MEAL_VISION_MODEL default
    scout-17b (deprecation 2026-07-17 recorded — swap lever, not scope change);
  portion-priors.ts — Appendix B verbatim (containers/countables/densities);
    resolvePortion rungs: reliable count → 1 user_dishware → 3 regional prior →
    4 default (single-value collapse, no invented ±); rung 2 anchor DEFERRED;
  foods.ts — 130-row curated table ported 1:1 from food_database.py with
    source lines (count VERIFIED against the Python file);
  openfoodfacts.adapter.ts — usda.py port (misnamed salvage: it IS OFF);
    Search-a-licious → legacy CGI fallback, Zod-parsed, degrade-to-empty;
    EXEMPT from cost ledger (ruled: zero-cost, 24h Redis-cached);
  service.ts — five-stage orchestration; §3.5 RETAKE: parse-fail/poor-quality
    → single-use user-bound hashed Redis token (10 min TTL) that bypasses ONE
    quota increment, can't chain, fails closed; scan draft in Redis (scanToken,
    10 min); vision cost = BigInt 110k/340k micro-USD/1M (Groq Scout list);
    ledger row standalone at scan time (no companion rows exist — ruled);
    photo NEVER persisted/logged anywhere (2B §3.4 guarantee, ruled precedence
    over v1 §6.1's R2 path);
  routes.ts — analyze-photo (authn → validateScan[magic bytes jpeg/png/webp,
    10MB decoded, base64 strict, retake consume] → meter[skipped on retake] —
    400 never meters); meals POST = UNION photo-confirm{scanToken}|manual
    {mealName} (GAP-2 — manual path COMPLETED this session); meals list/get/
    patch/delete; dishware CRUD; body-measurements CRUD (nutrition owns them
    per Part 4 §3.6 — moved OUT of users); foods search;
  repo.ts — sole DB toucher; corrections written at confirm AND PATCH
    (meal_name/taken_at/items diffs, originals preserved — P4 doctrine);
    users.weight_kg synced to latest measurement (SUPERSEDES P2.2 GAP-2 —
    profile PATCH no longer appends history; DECISIONS);
  gamification repo/service — total_meals + photo_meals_logged (origin='photo')
    now real SQL; onMealLogged awards first_meal/photo_meal (badge hook
    failure degrades with a warn, never breaks the meal save).
COMPLETED THIS SESSION (gaps the rate-limited chat left): manual meal path
  (GAP-2) · takenAt ≤24h-future bound (GAP-3) on confirm/manual/patch ·
  .strict() query schemas · +3 tests (manual meal + badge separation,
  future-takenAt 400, Redis-down fail-closed 503 with provider never called).
T3 DONE (fresh chat, 6 findings + R9 gaps — ALL RESOLVED): (1) kcalPoint now
  CLAMPED inside its own rounded range (§3.3; was strandable outside a
  collapsed range); (2) gamification cross-table reads RULED as the read-only
  stats-aggregator exception (DECISIONS); (3) PATCH grams edits preserve each
  item's rung + correction rows stamped with the ORIGINAL's rung (Stage-5
  telemetry integrity); (4) dishware/measurement handlers now call real
  service seams, not repo re-exports; (5) the compressed one-liner style was
  REFORMATTED to house style (repo/service/routes — the tenancy WHEREs must
  be reviewable at a glance); (6) measuredAt got the same ≤24h-future bound
  (far-future rows would pin users.weight_kg forever). Sentry VERIFIED: no
  request-data integration, sendDefaultPii pinned false — imageBase64 cannot
  leak on 5xx (DECISIONS). Ledger residuals ruled (no-completion = no row;
  two-statement gym+insert; retake eaten by transient 500 — all DECISIONS).
  +9 tests: OFF adapter matrix (kJ→kcal, array names, CGI fallback,
  malformed→[]), thali/density resolver branches, §3.3 point-in-range pin
  (unit + end-to-end), cross-user meal DELETE + foreign scanToken + foreign
  retake token, corrections for items/taken_at edits + confirm-time diff.
DECISIONS: 10 P2.6a rulings + P2.2 GAP-2 supersession + manual-path note.
OPEN SPEC GAPS: none. IFCT pack, rung-2 anchor scaling, bias adaptation,
  onboarding-fields storage = queued follow-ups (ruled).
NEXT: T3 on this diff (fresh chat) → merge → P2.6b (geo read-side: two-layer
  geocode cache, ORS route_gen fail-closed + cost events, runs/saved_routes
  browse; run RECORDING is mobile P5).
```

```
TASK: P2.5b — coach gateway + metered chat 🟡 (P2.5 split, part b — completes P2.5)
              [MERGED to master @ ed53f8d via PR #19, 2026-07-12; commits 80c322e
               (module) + e825ef9 (T3 fixes). PROVE green 152/152 on Neon branch
               p22-test (reused), ZERO skips — full P2.1–P2.5a regression + 18 new
               (6 pure adapter/cost/prompt + 12 DB-gated chat/threads); shared
               19/19 + engine 147/147 re-proven. T3 DONE (fresh chat): 3 real
               findings ALL FIXED — (1) validate-before-meter (a 400 no longer
               burns a free quota slot); (2) global answer-cache PRIVACY LEAK
               closed (GAP-3 premise was false — prompt carried displayName +
               weightKg; displayName dropped from prompt, units+weightKg folded
               into the cache key, PROMPT_VERSION 1→2); (3) api_cost_events written
               in the SAME tx as the message rows (a spent call can't escape the
               ledger); + BigInt cost math (no float near money); +2 regression
               tests. Idempotency-key/per-route-rate-limit = recorded FOLLOW-UP for
               P2.8 client-wiring.]
FILES CHANGED (NO migration, NO new deps — fetch not SDKs):
  packages/shared/src/coach.ts (chat/thread contracts; 2000-char cap =
    routers/coach.py:32) + index export;
  apps/api/src/config.ts (+GROQ_API_KEY? OPENROUTER_API_KEY? COACH_MODEL
    default llama-3.1-8b-instant — key unset ⇒ coach 503s, app unaffected);
  coach/llm.adapter.ts (R2.2 adapter: OpenAI-compatible fetch, Zod-parsed
    R2.12; ProviderError{retriable}: 429/5xx/network/malformed retriable,
    4xx-our-fault surfaces; withFallback = v1 §6.1 Groq→OpenRouter; ported
    budget temperature 0.7 / max_tokens 800 = coach.py:96-97);
  coach/prompt.ts (coach.py:25-59 port, PROMPT_VERSION=1 tagged on every
    assistant row as model#pN; GAP-1: only stored fields, missing lines
    OMITTED); coach/service.ts (chat orchestration: cache→RAG→provider→
    persist→ledger; costMicro integer micro-USD single-round; CoachError;
    GLOBAL answer cache key sha256(version|model|normalized q), 24h, hits
    skip provider+ledger, quota already counted); coach/repo.ts additions
    (threads/messages keyed (id,user_id) R3.2; appendExchange one tx with
    clock_timestamp() ordering + 200-cap delete-oldest = coach.py $slice;
    getLiveGymId = §3.10 spend-time membership; insertCostEvent);
  coach/routes.ts (POST /v1/coach/chat = FIRST real requireQuota wiring,
    R3.3 authn→quota→parse→handler; thread list/get/delete, cursor, 404s);
  coach/schemas.ts; app.ts (coach wiring + BuildAppOverrides.coach{chatProvider,
  embedder} + ERROR-MAPPER CHANGE: typed client-safe errors now keep their
    OWN status incl. 5xx — CoachError 503 was being collapsed to generic 500;
    operational 5xx = warn-log, NO Sentry; unhandled errors unchanged);
  users/repo.ts getSyncContext +displayName/units (prompt profile via the
    R7.1 service export — no dummy-deps hack);
  test/coach.llm.unit.test.ts + test/coach.chat.test.ts (fake provider/
    embedder via overrides; covers fallback matrix, free-5/mo→429 w/ resetsAt,
    cache hit = no provider call + no cost event, gym_id attribution +
    costs:gym bump, provider-down 503 nothing stored, no-key 503 app healthy,
    cross-tenant 404s, >2000 chars 400).
DECISIONS (5, ruled at gate): GAP-1 prompt omits unstored onboarding fields
  (storage = queued ruled card, also feeds P2.6) · GAP-2 model default ·
  GAP-3 global cache · GAP-4 200-msg cap all tiers · GAP-5 Groq public price
  constants (50k/80k micro-USD per 1M in/out), fallback priced same until an
  OpenRouter line lands.
PROVE FIX (disclosed): central error mapper collapsed ALL ≥500 to generic
  internal_error — misreported CoachError's intentional 503; fixed as above,
  caught by 2 tests.
OPS NOTE: production needs GROQ_API_KEY (+optional OPENROUTER_API_KEY) in the
  deploy env + escrow doc; coach:ingest must run once per environment before
  chat retrieval has context.
QUEUE: argon2id before P2.8 · DPDP Day-14+export workers (BullMQ) · tz-capture
  card (+§3.5 tz-travel) · onboarding-fields card (GAP-1) · challenges/
  leaderboards/XP cards. usage_daily nightly rollup (v1 §7.2) still unowned —
  lands with the BullMQ/workers card.
OPEN SPEC GAPS: none.
NEXT: T3 on this diff (fresh chat) → merge → P2.6 (nutrition per Part 2B §3
  pipeline: one vision call, portion resolver, display standard; geo/running
  read side + geocode cache).
```

```
TASK: P2.5a — coach KB ingestion + pgvector retrieval 🟡 (P2.5 split, part a)
              [MERGED to master @ ba753d4 via PR #18, 2026-07-12; commits 94eb8ae
               (module) + b0d7532 (T3 fixes) + 42f9ff9 (test-infra housekeeping).
               PROVE green 134/134 on Neon branch p22-test (reused), ZERO skips —
               full P2.1–P2.4 regression + 9 new KB tests; PLUS real deliverable
               ran: `pnpm --filter api coach:ingest` embedded 14 chunks from 5
               guides at 384-dim into pgvector; real-MiniLM semantic spot-check
               confirmed (squat→form_guides, protein→nutrition, sore→recovery
               top-1). T3 DONE (fresh chat): R2.2 double-cast resolved by
               splitting the wrapper into embedder.adapter.ts — then the cast
               proved UNNECESSARY (library overload structurally assignable,
               zero casts remain); chunker "VERBATIM" claim corrected (the
               /\n\s*\n/ CRLF relaxation is now documented + DECISIONS +
               CRLF==LF boundary test); distance-metric rationale corrected in
               DECISIONS (cosine-on-normalized is the conventional MiniLM
               choice, NOT sentence-transformers' encode() default, and NOT
               bit-identical to old Chroma L2-on-raw — rankings can differ in
               principle, spot-check validated); rejected-pipeline-load now
               retries. HOUSEKEEPING (Kd-approved, own commit): vitest DB-run
               parallelism capped at 4 workers + seed test 120s budget —
               measured unbounded ~90s flaky / serial ~547s / capped 79s green.]
FILES CHANGED:
  NEW DEP: @huggingface/transformers (approved, R1.4) — local all-MiniLM-L6-v2
    (Transformers.js/ONNX), pulls onnxruntime-node + sharp;
  apps/api/src/modules/coach/knowledge/*.md (5 guides copied VERBATIM from
    backend-ml/app/ai/rag/knowledge — v1 §7.4 "re-ingest the 5 docs", not Chroma);
  coach/chunk.ts (knowledge_base.py:45-85 port: 500-word target / 50 overlap /
    big-para word-split, constants cited);
  coach/embedder.ts (Embedder seam: createMiniLmEmbedder — lazy pipeline, mean-
    pool+L2-normalize = sentence-transformers defaults, dim guard=384;
    createFakeEmbedder — deterministic FNV bag-of-words so CI proves ranking
    without ONNX);
  coach/repo.ts (ONLY kb_chunks toucher: upsertChunk ON CONFLICT (doc,
    chunk_index), deleteStaleChunks for shrunken docs, searchChunks cosine `<=>`
    SEQ SCAN per §3.7 "no ANN index", embedding as parameterized ::vector cast
    R3.8, meta shape-checked R2.3);
  coach/retrieve.ts (retriever.py port: top_k=3 coach.py:70, formatContext
    verbatim retriever.py:42-53);
  coach/ingest.ts (v1 §7.4 port; idempotent upsert+prune; CLI
    `pnpm --filter api coach:ingest`, DATABASE_URL-gated; downloads+caches ~90MB
    weights first run — DECISIONS GAP-2);
  apps/api/package.json (+coach:ingest script);
  test/coach.kb.test.ts (5 pure chunker/embedder + 3 Neon ingest/retrieval
    incl. idempotency ×2 and stale-tail prune).
DECISIONS (4): GAP-1 local MiniLM embedder (same model as salvage, honors 384
  pin, zero per-embed cost, no 2nd hot-path call) · GAP-2 weights cached at
  ingest not vendored · GAP-3 non-streaming coach v1 · GAP-5 Groq price = config
  constant citing public list (lands in P2.5b) · split ruling (P2.5b = Groq
  gateway + metered chat + api_cost_events + threads; OpenRouter FALLBACK is
  in-spec per v1 §6.1 and ships in P2.5b — corrected the plan's deferral).
NO migration (kb_chunks + vector(384) already in 0001).
CI NOTE: coach.kb.test.ts DB portion uses the FAKE embedder (no ONNX in CI); real
  MiniLM proven by the ops ingest run + spot-check, logged above. If CI lacks the
  transformers native deps, only the ingest CLI (an ops step) is affected, not
  the suite.
OPEN SPEC GAPS: none.
NEXT: T3 on this diff → merge → P2.5b (Groq gateway: fetch to OpenAI-compatible
  endpoint, Zod-parsed R2.12; Groq→OpenRouter fallback v1 §6.1; system-prompt
  port coach.py:25-59 + prompt version; requireQuota("coach") FIRST real wiring;
  api_cost_events per call w/ gym resolved at spend time; exact-match answer
  cache; coach_threads/messages + thread CRUD; non-streaming).
```

```
TASK: P2.4 — entitlement resolver + quota middleware 🟡
              [MERGED to master @ 6b131db via PR #17, 2026-07-11; commits 39336eb
               (module) + 07835b2 (T3 fixes). PROVE green 125/125 on Neon branch
               p22-test (reused), ZERO skips — full P2.1–P2.3 regression (incl. auth
               rate-limit suite on the NEW Redis store) + 20 new tests. T3 DONE
               (fresh chat): 1 robustness fix (unguarded JSON.parse out of the
               resolver → now self-heals to DB, never 500s /me+gate+coach-open;
               +corrupt-cache regression test) + 1 observability nit (rate-limit
               fail-open now warns); free period='all' consistency-over-90d-floor
               confirmed intended (DECISIONS), not drift.]
FILES CHANGED:
  NEW DEP: ioredis ^5 (approved at gate, R1.4) — BullMQ needs it later anyway;
  apps/api/src/redis.ts (NEW): RedisLike seam (v1 §7.2 keys) — createIoRedis
    (real; INCR+EXPIRE-NX Lua, fail-soft returns null) + createMemoryRedis
    (deterministic, injectable clock, `down` outage switch for tests); modules
    depend on RedisLike, never ioredis;
  apps/api/src/config.ts: +REDIS_URL (optional dev/test, REQUIRED in prod via
    .refine fail-fast);
  packages/shared/src/entitlements.ts (NEW): canonical §3.3 entitlements Zod —
    EVERY key .default()ed to the FREE value (R6.5 survive old rows); metered
    feature {window,limit}; EntitlementsMe {entitlements, source};
  apps/api/src/modules/entitlements/ (NEW, R7.1): repo (Part 4 §4.1 candidate
    SQL VERBATIM + free-plan base), service (mergeEntitlements pure fn: free
    base → highest-rank overlay, equal-rank per-key max/OR/all>tier, GAP-1
    whole-block replacement across windows; getEntitlements cached 60s
    ent:{userId}; bustEntitlements = §4.1/§10 seam), routes (GET
    /v1/entitlements/me), schemas;
  apps/api/src/modules/quotas/ (NEW): service — requireQuota(feature)
    preHandler porting quotas.py VERBATIM (atomic INCR+TTL quota:{feature}:
    {user}:{yyyymmdd|yyyymm}, +60s slack, increment-before-run, coach
    fail-OPEN / meal_scan+route_gen fail-CLOSED 503, 429 with resetsAt);
    wired to real routes in P2.5/P2.6;
  auth/rateLimit.ts: store moved behind RedisLike (rl:{name}:{ip|id} keys) —
    pays the P2.1 "Redis swap owed at P2.4" debt; fail-open on Redis-down;
    per-route limiters now pass name+redis (auth/routes.ts, users/routes.ts);
  users/service.ts: account deletion busts entitlements (memberships closed);
  workouts service/repo: history read-gate (Part 4 §0.2; GAP-6 debt) — free
    plans clamp reads to history_days back, responses carry explicit
    limitedToDays (GAP-4); reads the keystone resolver, never its own idea;
    all read fns take ReadDeps {sql,redis};
  packages/shared/{workouts,progress}.ts: +limitedToDays on page/all progress
    shapes; app.ts: redis adapter created (or overrides.redis for tests),
    passed to every module, closed onClose;
  test/entitlements.unit.test.ts (11: merge matrix incl. cross-window + sparse
    defaults, quota key/reset, in-memory adapter incl. down-switch),
    test/entitlements.routes.test.ts (8, DB-gated: free resolve, coach 5/mo→429,
    Redis-down coach-open/meal-closed-503, cache-hold+bust-flips, cross-user
    no-leak, gym member_entitlements grant, history gate free-90 vs pro-unlimited).
DECISIONS (6): GAP-1 whole-block merge across windows · GAP-2 no server exercise
  block (clients gate; P4.y flags) · GAP-3 /v1/entitlements/me added · GAP-4
  limitedToDays explicit field · GAP-5 pilot-provider sub fixtures pre-P3 ·
  ioredis approved + Redis prod-required/dev-optional.
NO migration. Compose already had redis:7-alpine.
QUEUE (remaining P2 obligations): argon2id before P2.8 · DPDP Day-14 cascade +
  export workers (BullMQ) · timezone-capture card (+ §3.5 tz-travel rule) ·
  challenges/leaderboards/XP cards. requireQuota + api_cost_events wiring lands
  with coach/nutrition/geo (P2.5/P2.6).
OPEN SPEC GAPS: none.
NEXT: T3 on this diff (fresh chat) → merge → P2.5 (coach: Groq behind the quota
  gateway + api_cost_events; Chroma→pgvector; re-ingest 5 KB guides).
```

```
TASK: P2.3 — workouts (history/PRs/kcal) + progress + gamification ports 🟡
              [MERGED to master @ b8c90b4 via PR #16, 2026-07-11; commits 6f0c38c
               (module) + b1ea1a2 (gitleaks false-positive fix) + ff48e6c (T3 fixes).
               PROVE green 105/105 on Neon branch p22-test (reused), ZERO skips —
               full P2.1+P2.2 regression + 29 new tests; engine 147/147 + shared
               19/19 re-proven. T3 DONE (fresh chat):
               2 gate-blockers FIXED — (1) §3.5 retroactive restore was silently
               violated: streak now RECOMPUTED each sync by replaying the full
               distinct-activity-day history (pure replayActivityDays fold; longest
               floored at stored value); (2) gamification hook now runs
               UNCONDITIONALLY (was gated on 'created' — a hook crash after the
               workout commit lost the streak forever; replay+upsert = idempotent).
               Finding 3 fixed (platform cast → Zod parse). Nits fixed: strict uuid
               cursor regex, safeTimeZone re-exported via gamification service,
               badges.py hour citations. §3.5 timezone-travel rule NOT implemented —
               owed on the tz-capture card (DECISIONS). Regression tests: unit
               replay-restore + replay-freeze-spend; route late-offline-restore +
               erased-streak-heals-on-retry.]
FILES CHANGED:
  packages/shared/src/{workouts,progress,gamification}.ts (new contracts) + index;
  apps/api/src/modules/gamification/ (new — R7.1): streak.ts (PURE Part 7 §3 machine:
    TZ calendar days via dayInTz/safeTimeZone, freeze earn 1-per-7 cap 3, lazy
    auto-spend = advance last_activity_date per covered day, reset keeps the bank +
    longest), badges.ts (18 achievements from badges.py, criteria jsonb {stat,gte,
    minWorkouts?}, evaluator reads missing stats as 0), repo (FOR UPDATE streak row,
    ON CONFLICT awards, SQL stats), service (onWorkoutSynced / reconciledStreak /
    getMe), routes (GET /v1/gamification/me);
  apps/api/src/modules/workouts/: calories.ts (2B §2.2 port: kcal=MET×kg×h,
    KCAL_CALC_VERSION=1, DEFAULT_WEIGHT_KG=70, ACTIVE-only per GAP-2), repo
    (getExerciseIdsBySlug now returns {id,met}; sync stores kcal; history keyset
    (started_at,id) DESC; detail; progress aggregates — AT TIME ZONE param), service
    (kcal at sync + gamification hook on status==='created' only; history cursor
    `<iso>|<uuid>`, malformed→first page; progress.py ports incl. consistency
    min(100,round(n/days*100)), 'all'→0), routes (GET /v1/workouts[/:id],
    /v1/progress/{overview,trend,weekly,heatmap,distribution,records});
  users repo/service: getUserSyncContext (weight+timezone service export);
  seed: achievements upsert-on-code; app.ts: gamification routes registered;
  test/gamification.unit.test.ts (15 pure: streak edges incl. IST boundary, badges,
    kcal), test/workouts.history.test.ts (10, RELATIVE fixture dates so streak
    reconciliation can't rot the suite), workouts.sync.test.ts kcal assertion
    updated (null→7: this task IS the deferred kcal port).
DECISIONS (7, ruled at gate): XP deferred (Part 4 has no storage — GAP-1) · kcal
  active-only v1 (payload carries no rest — GAP-2) · TZ fallback UTC until capture
  card (GAP-3) · variety badges = F1–F12 families (GAP-4) · freeze auto-spend lazy,
  sweep+push → notifications/BullMQ card (GAP-5) · history ungated until P2.4
  entitlements (GAP-6) · deferrals: measurements→P2.6, predictions→2B §5 card,
  challenges ("tables now, screens later"), leaderboards→P4.x, streak nudges→P5.
NO migration; NO new deps.
QUEUE (unchanged obligations): argon2id before P2.8 · DPDP Day-14 cascade + export
  workers (BullMQ) · Redis rate-limit swap at P2.4 · challenges/leaderboards/XP cards.
OPEN SPEC GAPS: none.
NEXT: T3 on this diff (fresh chat) → merge → P2.4 (entitlement resolver + quota
  middleware — brings Redis).
```

```
TASK: P2.2 — users/profile module + exercises/catalog read APIs 🟡
              [MERGED to master @ e6631a1 via PR #15, 2026-07-11; commits 2029226
               (module) + dd5b4ed (T3 fixes). PROVE green 76/76 on Neon branch
               p22-test, ZERO skips (full P2.1 auth regression included); T3 DONE (fresh chat,
               7 findings): 1 real bug FIXED (since>= 304'd across channels — global
               version sequence; now exact-match only + channel-flip regression test),
               catalog now schema-parsed not cast, email-error logs class-only, DELETE
               message no longer promises an unsent email, whole-bundle-swap-superset
               + memberships-stay-closed-on-restore RULED in DECISIONS (Kd may veto),
               pinned-non-live-version serving test added; parseBody/parseQuery
               duplication noted for next module. T3 required for ALL tasks from now
               on (Kd ruling 2026-07-11, in DECISIONS)]
FILES CHANGED:
  apps/api/drizzle/0004_restore_account_purpose.sql (+meta 0003_snapshot, journal) —
    one_time_tokens purpose CHECK widened to +'restore_account'; SQL reviewed by Kd
    BEFORE other code (T5); same idx-vs-name prefix skew as 0001/0003;
  apps/api/src/db/schema/identity.ts (CHECK widened to match);
  packages/shared/src/{users,catalog}.ts (new contracts) + index.ts exports;
  apps/api/src/modules/users/{schemas,repo,service,routes,email}.ts (new — R7.1):
    GET/PATCH/DELETE /v1/users/me + POST /v1/users/me/restore (unauthed by nature,
    5/hr dual limiter, uniform 400s); DPDP Day-0 (Part 4 §5.2): soft delete + close
    gym_members + drop push_tokens (one tx) + revoke sessions + undo email with
    hashed 14-day restore_account token; window enforced in DB AND by token TTL;
    GAP-2: changed non-null weightKg appends body_measurements (source manual);
  apps/api/src/modules/exercises/{schemas,repo,service,routes,bundle}.ts (new):
    GET /v1/exercises (live-only, keyset cursor on slug) + GET
    /v1/exercise-definitions?since= (Part 2 §9.3 / v1 §5.2): stored sha256 = ETag
    (GAP-1: sha256-only, canonical key-sorted serialization in bundle.ts),
    If-None-Match + since → 304; beta_definitions flag rules {"userIds":[...]}
    (GAP-3) safeParse default-to-live, beta falls back to live if no beta bundle;
    read-only — publishing is P4; bundles immutable, rollback = new row;
  apps/api/src/modules/auth/repo.ts (OneTimePurpose +'restore_account') and
    service.ts (+4 narrow exports for users: isUserEmailVerified, issueRestoreToken,
    consumeRestoreToken, revokeAllSessions — R7.1 service-interface crossing);
  apps/api/src/db/seed.ts — seeds the 3 engine definition JSONs (Zod-parsed,
    DOCUMENT's own version: squat v6, jump/chair v1, DB status 'live', docs
    verbatim) + one live bundle row; idempotent (same sha → no new row); seed()
    now owns/closes its client so tests can call it;
  apps/api/{package.json,tsconfig.json} — @app/engine workspace dep +
    resolveJsonModule (JSON single-source from engine);
  apps/api/src/app.ts — register users/exercises routes, UsersError in the 4xx
    allowlist, usersEmailSender test override;
  apps/api/test/{users,exercises}.routes.test.ts (new, DATABASE_URL-gated,
    p22u-/p22e- prefixes; covers CORRECTION-2 deleted-user 401 on authenticate AND
    refresh, cross-user denial, weight history, restore window, live-only catalog,
    pagination walk, ETag/304s, beta allowlist + malformed-rules fail-closed,
    seed idempotency ×2); DECISIONS.md +8 entries.
DECISIONS: 0004 widening · A1 split (Day-14 cascade + export workers = QUEUED
  BullMQ card before launch, alongside argon2id pre-P2.8 card) · GAP-1 sha256-only ·
  GAP-2 weight history · GAP-3 flag shape · locale{en,hi,as}/units{metric,imperial} ·
  doc-version seeding · T3-for-ALL-tasks ruling.
GOTCHA (test-only, PROVE run): fastify 400s a body-less request that carries
  content-type application/json (FST_ERR_CTP_EMPTY_JSON_BODY) — inject helpers must
  set the header only WITH a payload.
OPEN SPEC GAPS: none. Redis rate-limit swap still owed at P2.4.
NEXT: T3 on this diff (fresh chat) → merge → P2.3 workouts history/progress/
  gamification ports.
```

```
TASK: P2.1 — auth module port into apps/api (R3.7 = the porting spec) 🟡
              [MERGED to master @ dad2f2a via PR #14, all 4 CI checks green, 2026-07-11;
               commits 8e0b320 (module) + d902248 (gitleaks false-positive fix: inline
               gitleaks:allow on dummy test fixtures + .gitleaksignore fingerprints)]
FILES CHANGED:
  apps/api/drizzle/0003_one_time_tokens.sql (+meta 0002_snapshot, journal) — SQL reviewed
    by Kd BEFORE other code (T5); drizzle-kit emitted "0002_" prefix (idx-numbered),
    renamed to 0003 + journal tag fixed (same convention skew as 0001);
  apps/api/src/db/schema/identity.ts (+one_time_tokens);
  packages/shared/src/auth.ts (new — request/response contracts) + index.ts export;
  apps/api/src/modules/auth/{schemas,tokens,repo,service,routes,plugin,email,rateLimit}.ts
    (new — R7.1 layout; plugin = the `authenticate` preHandler decorator; rateLimit =
    PROVE-run fix, see below);
  apps/api/src/config.ts (+JWT_SECRET min32, ACCESS_TTL_MIN=15 [v1 §6.1], REFRESH_TTL_DAYS=30
    [jwtHelper.js:26]; SYNC_DEV_USER_ID seam DELETED with its prod-refusal gate);
  apps/api/src/app.ts (@fastify/cookie; authenticate + auth routes registered;
    buildApp gains a test-only overrides param {emailSender} — GAP-5 seam);
  apps/api/src/modules/workouts/routes.ts (seam block → authenticate preHandler;
    config dep dropped);
  apps/api/package.json (+bcryptjs@3, jsonwebtoken@9, @fastify/cookie@11;
    dev +@types/jsonwebtoken — all approved at plan gate); pnpm-lock.yaml;
  apps/api/test/auth.unit.test.ts (new, 12 tests — no DB: HS256 pinning incl. HS512/none/
    foreign-secret/expired, refresh-type rejection incl. the OLD {id,type:'refresh'} shape,
    timing-equalizer via hasher spy, config fail-fast, seam-gone proof);
  apps/api/test/auth.routes.test.ts (new, 18 tests — DATABASE_URL-gated);
  apps/api/test/workouts.sync.test.ts (rewritten: real register+login cookies replace the
    seam; cross-tenant 404 re-proven END-TO-END with user B's real cookie; 9 tests);
  apps/api/test/{smoke,app,analytics}.test.ts (+JWT_SECRET in env fixtures);
  DECISIONS.md (9 entries 2026-07-11); HANDOFF.md.
STATE / DECISIONS (all ruled at plan gate; full text in DECISIONS.md):
  GAP-1 bcrypt-only (argon2id = explicit deferred follow-up card) · GAP-2 sameSite
  none+secure prod / lax dev-test · GAP-3 one_time_tokens migration (CASCADE deviation
  recorded) · GAP-4 dual-keyed in-memory rate limits (Redis owed at P2.4) · GAP-5
  log-only EmailSender, tokens captured via injected sender in tests · GAP-6 lockout
  dropped (rate limiter covers; removes lockout-DoS) · tokens cookie-only, none in bodies ·
  emailVerified derived from consumed verify_email token (no users column in §3.1).
  LEGACY FIXTURE: hash generated with backend-auth/node_modules/bcryptjs@2.4.3 hashSync
  cost 10 — pinned as a literal in auth.routes.test.ts (Part IV #11).
CONSEQUENCE (approved, NOT a bug): deleting SYNC_DEV_USER_ID means the live browser→sync
  demo goes dark until P2.8 (web still logs into the OLD backend, so it can never carry a
  new-API cookie; every sync POST will 401 and the client queue will retain — nothing lost
  per R10.3, it flushes at cutover). That is the correct production posture. Do NOT
  misread 401s-with-a-growing-queue as a bug in a later chat.
VERIFIED (PROVE run, Neon branch p21-test, auto-delete 1 day, 2026-07-11): migrations
  incl. 0003 applied clean · typecheck 0 · lint 0 · FULL api suite 56/56 GREEN, zero
  DB-skips (18 auth routes incl. legacy-hash fixture + reuse-kills-family + all 3 rate
  limits; 9 sync incl. END-TO-END cross-tenant 404 with user B's real cookie; 4 migration;
  25 unit) · shared typecheck + 19/19 · engine-purity and red-flag greps print nothing ·
  Neon credentials confirmed absent from all files (env-only) · gitleaks not installed on
  the dev box — runs in CI (P0.2) on push.
PROVE-RUN FIXES (2 findings, both fixed then 56/56):
  (1) REAL BUG: @fastify/rate-limit's internal rateLimitRan symbol makes every per-route
      limiter silently NO-OP after the global limiter runs (and two stacked limiters can
      never both count) → all three auth rate limits were dead. Replaced with a
      dependency-free dual-bucket fixed-window preHandler (modules/auth/rateLimit.ts);
      ported numbers and GAP-4 semantics unchanged; DECISIONS correction recorded.
  (2) Test-only: fixture cleanup deleted users before their workouts (RESTRICT FK) and
      the auth suite's p21-% pattern also matched the sync suite's users → workouts
      deleted first in both suites.
T3 PASSED (fresh chat, 2026-07-11) with 5 findings — ALL FIXED, suite re-proven 58/58
  GREEN on the Neon branch (2 new regression tests):
  (1) GATE-BLOCKING: refresh rotation was find-then-rotate — two concurrent presentations
      of one token could both mint live successors, defeating §3.1 "reuse kills the
      family" → rotation now atomic (revoke WHERE revoked_at IS NULL RETURNING inside the
      insert transaction); losing the race = reuse → family revoked incl. the winner's
      fresh token. Regression test: concurrent duplicate refresh.
  (2) Superseded one-time tokens were marked used_at (= "consumed") — a future
      resend-verification would fake-verify every requester → supersession now sets
      expires_at=now(); used_at means consumed ONLY. Regression test added.
  (3) R4.6: inline locale/units SELECT in service → folded into repo findUserBy* (also
      kills a redundant round-trip).
  (4) Cookie-name literals duplicated → hoisted to tokens.ts. Refresh cookie path scoped
      to /v1/auth (T3 suggestion, DECISIONS) — the 30-day token no longer travels on
      every API request.
  (5) R8.1: 4xx error mapper echoed any err.message → allowlist (AuthError + FST_*);
      everything else gets a generic body.
OPEN SPEC GAPS: none (all six ruled at the plan gate).
NEXT: Kd 5-min review (Part VI) → commit → P2.2 (users/profile + catalog read APIs).
  ⚠ QUEUE ITEM (T3 gate note, DECISIONS): the argon2id-with-rehash-on-login card (GAP-1
  deferral) MUST be scheduled as its own P2 card BEFORE P2.8 cutover.
```

```
TASK: P1.10d — minimal POST /v1/workouts/sync in apps/api (Part 4 §3.5; closes Part 2 §10 "then syncs") 🟡
              [on branch p1.10a-web-into-monorepo; UNCOMMITTED — awaiting Kd's DB-gated PROVE + T3]
FILES CHANGED:
  apps/api/drizzle/0002_workout_sets_uq.sql (+meta 0001_snapshot, journal entry) — ONE line:
    CREATE UNIQUE INDEX workout_sets_workout_set_uq ON workout_sets (workout_id, set_index);
  apps/api/src/db/schema/training.ts (uniqueIndex mirror);
  apps/api/src/modules/workouts/{schemas,repo,service,routes}.ts (new — R7.1 module layout;
    contract re-exported from @app/shared, R7.2);
  apps/api/src/app.ts (route registration); src/config.ts (+SYNC_DEV_USER_ID, refused in prod);
  apps/api/src/db/seed.ts (3-exercise minimal seed); apps/api/package.json (+@app/shared);
  apps/api/test/workouts.sync.test.ts (new — 9 tests, DATABASE_URL-gated); pnpm-lock.yaml;
  DECISIONS.md (5 entries 2026-07-10); HANDOFF.md.
STATE / DECISIONS (all approved at plan gate; full text in DECISIONS.md):
  - AUTH SEAM: SYNC_DEV_USER_ID (dev/test only; config boot throws if set in production).
    NOTE: the previously-cited "2A DECISIONS entry" never existed — now actually recorded.
  - §3.5 upsert implemented from §3.5 prose (R4.5's §4 pointer is dangling — recorded);
    ownership checked AFTER the workout upsert (read-back beats check-then-insert TOCTOU);
    foreign workoutId → 404 (R3.2), tested with rows-untouched assertion.
  - Unknown slug: skip set + quality_flags 'unknown_exercise', NEVER a parking 4xx (client
    R10.3 interplay). kcal null until P2.6. Aggregates server-derived from persisted sets.
  - Idempotency-Key required and must equal body workoutId (mismatch/missing → 400).
    Concurrent duplicate POSTs tested (cross-tab case from P1.10c T3): one workout, no 500.
VERIFIED: api typecheck 0 · lint 0 · PROVE run BY KD against a Neon branch (p110d-test):
  migration 0002 applied cleanly · full api suite 26/26 GREEN including all 9 sync tests
  (happy path, validation 400, idem-key mismatch, retry no-op, concurrent duplicates → one
  workout, cross-tenant 404 rows-untouched, unknown-slug skip+flag, 401 dark, prod-seam
  refusal) + the 4 migration tests re-proving seed idempotency with the new exercises rows.
  PROVE-run fixes applied along the way (slow WAN to ap-southeast-1): sync-test beforeAll
  timeout 60s (matches the migration test's 30s seed budget); afterAll guards app-undefined
  so a dead hook doesn't mask its own failure.
T3 PASSED (fresh chat) with 4 findings — ALL FIXED, all local gates re-proven green
  (shared 19/19 with 3 new schema tests · api typecheck/lint/unit clean · web 47/47):
  (1) missing DDL bounds → shared schema now enforces smallint/int4 maxima (a PG overflow
      was a 500, which the client retries forever — poison-pill queue halt);
  (2) duplicate setIndex desynced server aggregates via ON CONFLICT DO NOTHING → rejected
      at the schema (superRefine uniqueness);
  (3) seam honored when NODE_ENV merely omitted (defaults to development) → gate inverted:
      raw-env explicit development/test required, omitted case tested;
  (4) sets:[] created an empty engine workout the P1.10c decision forbids → .min(1).
  T3 NOTES: 404-vs-201 is a weak existence oracle for guessed ids — accepted (uuid v4,
  R3.2's own prescription); changed-retry-same-id is silently discarded as duplicate —
  §3.5's no-op contract, by design.
OPEN SPEC GAPS: none new (the R4.5 dangling pointer is recorded as a correction, not a gap).
COMMITTED: 2fad025 (after DB-gated PROVE 9/9 green on the Neon branch).
== PART 2 §10 END-TO-END GATE: CLOSED (Kd, live browser, 2026-07-10 21:00) ==
  Real squat workout on localhost:5173 (old rig up for auth only, new api on :3000 with the
  SYNC_DEV_USER_ID seam) → engine counted 5 reps on-device → sync POST fired from
  syncClient.js with Idempotency-Key → Status 201 → Neon row verified in SQL editor:
  workout 7c51a51f-7a8c-428d-8c06-6bf6d186d64f · 1 set · 5 reps · form 100 · flags {}.
  PHASE 1 (P1.1–P1.10d) IS COMPLETE.
NEXT: Phase 2 (P2.1 — auth module port into apps/api; R3.7 is the porting spec; the sync
  route's seam block gets replaced by real cookie authn and the cross-tenant test re-proven).
  Cleanup for Kd (non-blocking): delete the p110d-test Neon branch when done poking at it;
  the seam env vars live only in that one terminal session (nothing persisted).
```

```
TASK: P1.10c — offline summary queue + sync client in apps/web (R10.2/R10.3; the "then syncs" half) 🟡
              [on branch p1.10a-web-into-monorepo; UNCOMMITTED — awaiting T3]
FILES CHANGED:
  apps/web/package.json (− zod@^4.4.1 [vestigial, zero imports in src — proven by grep];
    + @app/shared workspace:*); pnpm-lock.yaml;
  apps/web/src/sync/syncQueue.js (new — localStorage queue, keyed by workoutId, injectable
    storage/keys; per-user key via utils/storage userKey);
  apps/web/src/sync/syncClient.js (new — buildSyncPayload + postSync + queueWorkoutSync +
    flush triggers);
  apps/web/src/sync/{syncQueue,syncClient}.test.js (new — 17 tests);
  apps/web/src/pages/ActiveWorkout.jsx (syncIdentity = {workoutId: crypto.randomUUID(),
    startedAt} fixed once per mount; queueWorkoutSync call in handleWorkoutComplete AFTER the
    existing 200ms last-set finalize wait; legacy completeSession untouched, independent);
  DECISIONS.md (4 entries, 2026-07-10).
STATE / DECISIONS (all approved at plan gate):
  - ZOD: option A — workspace stays zod@3; web's zod@4 removed (unused). shared/api/engine untouched.
  - Payload = workoutSyncPayloadSchema (@app/shared) verbatim: platform 'web', engineVersion from
    summaries[0], defsVersion = STATIC_DEFS_BUNDLE_VERSION = 1 (no bundle until P2.2 — DECISIONS),
    sets = SetSummaries VERBATIM (setIndex non-contiguous ordinal preserved), traceSample null.
    Validated (safeParse) BEFORE enqueue; invalid → parked, never sent/dropped.
  - Queue: enqueue replaces same-workoutId IN PLACE (no dup, no reorder); flush removes an entry
    ONLY after 2xx; transient (network/5xx/401/408/429) → retain + HALT; other 4xx → parked list
    (workout_sync_parked.v1) + continue; single in-flight flush guard; corrupt JSON → treated
    empty, never throws. Keys: userKey('workout_sync_queue.v1') — per-user, same convention as
    the rest of the app (guest-bucket caveat inherited from utils/storage until P2 auth).
  - Sync POST: dedicated axios instance (baseURL VITE_API_URL — NEW env var, unset in dev until
    P1.10d; a failed POST just stays queued), withCredentials only (R10.1 httpOnly-cookie style) —
    deliberately NOT mlApi (its interceptor injects localStorage bearer + redirects to /login on
    401). Idempotency-Key = workoutId on every attempt (R10.2); retries ONLY via the queue.
  - Flush triggers: after enqueue, window 'online' event, module load (module-scope in syncClient,
    window-guarded; note: runs when the workout bundle loads, not at app boot — revisit if an
    App-level init ever exists).
  - All-log-only workouts skipped (no summaries → nothing engine-verified; DECISIONS).
VERIFIED (post-T3-fixes): web 47/47 tests (22 new: FIFO, in-place dedupe, retain+halt,
  park-and-continue, 401/408/429 transient, retry→exactly-one-POST, concurrent-flush single-run,
  enqueue-mid-flush rerun, replace-mid-POST survival, quota-write failure reported,
  requeueParked, corrupt-storage, contract byte-match [.strict parse deep-equals payload + JSON
  round-trip], non-contiguous setIndex verbatim, Idempotency-Key header, no-VITE_API_URL no-op,
  offline→online round trip) · build green (3406 modules; @app/shared TS bundles fine under
  Vite) · sync files eslint clean · ActiveWorkout pre-existing lint errors unchanged at 9
  (zero new).
T3 PASSED (fresh chat) with findings — ALL FIXED, re-proven 47/47 + build green:
  (1) enqueue-during-in-flight-flush liveness: flush() now loops while a rerun was requested
      (a mid-run joiner or a replaced-entry survivor sets the flag) — a workout enqueued during
      the online-event flush is sent by that same flush, not stranded until the next trigger;
  (2) VITE_API_URL unset would POST to the web origin and its 404 would PERMANENTLY PARK every
      workout: flushSyncQueue() now no-ops (treat-as-offline, queue kept) when the env var is
      falsy — this was the finding that would have failed the P1.10d PROVE;
  (3) parked entries were write-only: requeueParked() added (recovery/console path, tested);
  (4) writeList quota failure was swallowed: enqueue/park return false, queueWorkoutSync
      reports { queued:false, reason:'storage' } instead of claiming success;
  (5) TOCTOU: success-removal now removes only the exact bytes sent; a same-id replacement that
      landed mid-POST survives and triggers a rerun pass (tested);
  (6) park() now replaces same-id in place like enqueue; ZodError log trimmed to path/code;
      engineVersion-homogeneity + crypto.randomUUID-secure-context comments added.
T3 NOTES CARRIED FORWARD:
  - P1.10d: cross-tab duplicate POSTs are possible (in-flight guard is per-tab) — Part 4 §3.5's
    ON CONFLICT (id) upsert is LOAD-BEARING for dedupe, not just retry hygiene.
  - P2.1: guest-bucket attribution — queue key derives from the LEGACY localStorage accessToken
    (userKey) while the POST authenticates by cookie; a guest-queued workout would flush under
    whichever account's cookie is present. Resolve when real auth lands (per-user key must come
    from the cookie session, or queue flushes only when authenticated).
OPEN SPEC GAPS: none new.
NEXT: commit (T3 done). Then P1.10d — minimal POST /v1/workouts/sync in apps/api
  (Part 4 §3.5 verbatim upsert: workout ON CONFLICT (id) DO NOTHING, sets keyed
  (workout_id, set_index); 2A auth seam per DECISIONS — endpoint built+tested, live authn P2.1).
  P1.10d PROVE closes the Part 2 §10 "full workout with the API server off, THEN SYNCS" gate:
  set VITE_API_URL, run api locally, do an offline workout, watch the queue flush on reconnect.
```

```
TASK: P1.10b-2c — PROVE-run fix: occluded-legs honesty + regression-trace class 🟡
              [on branch p1.10a-web-into-monorepo; UNCOMMITTED — awaiting T3]
CONTEXT: Kd's real-browser PROVE run "failed"; diagnosis via live recordings (P1.3 recorder) showed:
  (1) sitting at desk = engine correctly counts 0 (fail-soft works) but UI showed "Good Form 100%" — REAL BUG;
  (2) real squats: only 4 of ~10 cycles crossed the ported 100° depth threshold — counting is CORRECT per the
      validated legacy constants (shallow-rep UX = P4 §9.1 tuning, not touched, R5.4);
  (3) chair/jump counting non-jumps/no-chair = legacy parity, already-logged P4 SPEC GAPs;
  (4) the live "3 reps sitting" was chair_squat counting real sit-down/stand-up motions (correct).
FILES CHANGED:
  packages/engine/test/traces/regression/squat_sitting_idle_desk_nocount.jsonl (new golden — Kd's live
    sitting recording, 600 frames, expected reps 0; header exercise corrected squats->squat);
  packages/engine/test/traces.replay.test.ts (parity vs regression split: sidecar-less traces get full §7.4
    assertions but are excluded from §7.5 cert counts + stage-parity checks);
  apps/web/src/engine/poseAdapter.js (startSet now also returns metricSignals = compiled metric + fallback);
  apps/web/src/engine/sessionController.js (metric-unusable streak >= 3 frames + visibilityOk -> corrections=
    ["cannot see your legs clearly — step back..."], form_correct=null; engine untouched — it was already
    correct, only the presentation lied);
  apps/web/src/engine/sessionController.test.js (+1 test: occluded legs -> cue, no verdict, 0 reps);
  DECISIONS.md (two entries, 2026-07-10).
VERIFIED: engine 147 tests green incl. the new regression golden (20 trace tests; cert counts unchanged 3/6+3/4+3/4
  — regression traces correctly not parity evidence) · web 25/25 · build green · engine+web lint clean · typecheck 0.
OPEN SPEC GAPS: none new. NOTE for P5: consider moving the legs-cue into engine §3.2 when mobile lands.
NEXT: Kd re-runs the browser PROVE (expect: sitting -> "step back" warning + no Good Form; deep squats count,
  shallow don't). Then P1.10c (offline queue + sync client; zod 3-vs-4 decision).
```

```
TASK: P1.10b-2b — ActiveWorkout rewired to the engine hook; swap complete (v1 §13/D1) 🟡
              [fifth/final P1.10b slice; on branch p1.10a-web-into-monorepo; UNCOMMITTED — awaiting T3]
FILES CHANGED:
  apps/web/src/pages/ActiveWorkout.jsx (rewired — analysis-coupled regions only, no page split per v1 §1.3);
  apps/web/src/pages/activeWorkoutEngine.js (new — pure summary-log accumulation + form average);
  apps/web/src/pages/activeWorkoutEngine.test.js (new — 6 tests).
STATE / DECISIONS:
  - Server-baseline rep machinery DELETED (repBaselineRef/pendingBaselineRef/lastServerCountRef/setRepsRef/
    repFormBufRef + the backwards-reset re-anchor logic): engine sessions are per-set, rep_count IS the set count.
  - engineSetKey (monotonic, workout-global): bumped on next-set, next-exercise, manual reset (with
    discardNextSummaryRef so a redone set never double-counts), and ONCE in handleWorkoutComplete to finalize
    the LAST set (stop() deliberately doesn't end a set) — then a 200ms wait lets the effect cleanup emit the
    summary before refs are read (T3-2a carry-forward honored). summary.setIndex = workout-global ordinal.
  - Per-rep form now from SetSummary.repScores via accumulateSummary (per-frame state==='down' sampling
    deleted — form_score semantics changed in 2a). form_accuracy = averageFormScore(log) ?? 0.
  - Log-only mode (Part 6 §3.6) rendered: amber "Log-only" pill (Eye/EyeOff replaces the WS Wifi pill),
    "+1 Rep" manual counter + honest "your workout still counts" copy; form badge hidden when form_correct
    is null; debug rows: reps(engine) + mode. person_detected pick: badge uses poseData.person_detected
    (engine visibilityOk); overlay keeps keypointsData (raw landmarks) — per the T3-2a note.
  - completeSession (old backend) KEPT verbatim until P2.8; SetSummaries held in setSummariesRef for P1.10c.
  - Verified: 24/24 web tests · build green · new files eslint clean · ActiveWorkout pre-existing lint errors
    12 -> 9 (salvage patterns remain per P1.10a gate decision; my additions introduce zero new errors).
  - PROVE (Kd, real browser): corepack pnpm --filter web dev with backends OFF -> squat workout -> reps/cues
    from the engine, log-only for an unported exercise, completeSession fails gracefully offline. This is the
    Part 2 §10 "full workout with the API server off" half; "then syncs" lands with P1.10c.
  - T3 PASSED (fresh chat) with ONE confirmed bug, FIXED: the manual-reset discard is now keyed
    (discardSetKeyRef = the reset set's engineSetKey; drop iff summary.setIndex matches) — the old one-shot
    boolean could stick when a reset happened before any frame reached the engine (zero-frame guard emits no
    summary) and would then swallow the NEXT genuine set. Keys are never reused, so a stale entry is inert.
  - T3 notes carried: (a) the 200ms wait in handleWorkoutComplete is sound (scheduler-based, fires in hidden
    tabs) but heuristic — flushSync(() => setEngineSetKey(...)) is the deterministic alternative if it ever
    flakes; (b) summary.setIndex SKIPS a number on every manual reset — an opaque, NON-CONTIGUOUS ordinal;
    P1.10c must not assume contiguity.
OPEN SPEC GAPS: none.
NEXT TASK: P1.10c — offline summary queue (localStorage, keyed by workoutId, flush-order preserved, R10.3)
  + sync client (Idempotency-Key = workoutId, R10.2) consuming setSummariesRef's log via the
  workoutSyncPayloadSchema (@app/shared) — THE ZOD 3-vs-4 DECISION LANDS HERE. Then P1.10d minimal
  POST /v1/workouts/sync (Part 4 §3.5 upsert, 2A auth seam per DECISIONS).
```

```
TASK: P1.10b-2a — usePoseDetection driven by the engine; WS path deleted (v1 §13/D1) 🟡
              [fourth slice of P1.10; on branch p1.10a-web-into-monorepo; UNCOMMITTED — awaiting T3]
FILES CHANGED:
  apps/web/src/engine/messages.en.js (new — Appendix A EN catalog + translate());
  apps/web/src/engine/frameMapping.js (new — FrameResult -> old poseData display shape, v1 §13);
  apps/web/src/engine/sessionController.js (new — per-set engine lifecycle, factored out of React,
    + log-only fallback);
  apps/web/src/hooks/usePoseDetection.js (REWRITTEN — WS path DELETED; drives SessionController);
  apps/web/src/engine/{messages,frameMapping,sessionController}.test.js (new — 9 tests).
STATE / DECISIONS:
  - WS path GONE from the hook: WS_URL, connect/disconnect/reconnect/onmessage, resetReps,
    recordResponse all removed (v1 §5.3 "replaces pose_ws.py entirely"; Part 2 §10 "delete the WS path").
    Kept dev recordFrame (raw PoseFrame tee, VITE_TRACE_RECORD only).
  - HOOK API CHANGED: was {poseData,keypointsData,connected,connect,disconnect,startStreaming,resetReps};
    NOW {poseData,keypointsData,analysisAvailable,error,startStreaming,stop} + props {exercise,setIndex,
    enabled,onSetComplete}. poseData keeps the OLD display shape (rep_count/state/corrections/form_correct/
    is_active/person_detected/view/form_score) so ActiveWorkout "mostly doesn't notice" (v1 §13).
  - >>> ActiveWorkout is STRANDED until P1.10b-2b <<< it still calls connect()/disconnect()/connected.
    Build passes (JS), unit tests pass, but the app does NOT run end-to-end until 2b rewires ActiveWorkout.
    Deliberate a/b split; the Part 2 §10 offline-workout Done-gate is proven in 2b, not here.
  - One engine session PER SET (§3.9): effect keyed on (exercise,setIndex) — NOT enabled, so pause stops
    FEEDING, not the set. Cleanup emits the previous SetSummary via onSetComplete.
  - Log-only mode (Part 6 §3.6) for exercises with no def (getDefinition null) AND for I4-incompatible defs
    (EngineUnsupportedError caught -> log-only): manual counting, no grading, honest "still counts". A real
    compile/authoring error is NOT swallowed (rethrown).
  - Message keys -> EN from Appendix A (verbatim where given; chair/jump valgus reuse squat's copy;
    cue.visibility.step_back = Appendix A fault.body.visibility string). setup.*.camera use the §4 pattern copy.
  - Time (performance.now) lives in the hook, passed INTO the controller/engine (R5.1). Adapter/engine wall-clock-free.
  - Verified: web 17/17 tests (adapter 8 + messages 3 + frameMapping 4 + sessionController 2, incl. golden
    replay reps=2 + log-only) · web build green (engine now bundled via the hook) · eslint clean on new/changed files.
  - NO jsdom/testing-library added: the real logic is in the pure controller/mappers (tested); the hook is thin
    React glue, integration-proven by the app in 2b.
  - T3 PASSED (fresh chat): no rule violations. One in-slice fix applied — SessionController.endSet() returns
    null when the set was never fed a frame (guards phantom reps:0 summaries from StrictMode dev remounts /
    setup-screen exercise switches, so P1.10c's onSetComplete-based sync queue never sees junk). 18/18 tests.
OPEN SPEC GAPS: none (log-only fallback resolved by Part 6 §3.6, not a decision).
NEXT TASK: P1.10b-2b — rewire ActiveWorkout to the new hook: pass setIndex + onSetComplete; REMOVE the
  server-baseline rep machinery (repBaselineRef/pendingBaselineRef/lastServerCountRef — engine count is
  per-set); reps from poseData.rep_count, per-rep form from RepEvent via poseData.form_score; render log-only
  UI when !analysisAvailable (manual controls already exist); collect SetSummary[] (onSetComplete) for P1.10c;
  keep workoutService.completeSession (old backend) until P2.8. Then the Part 2 §10 offline-workout Done-gate.
  T3 (2a) CARRY-FORWARDS for 2b: ActiveWorkout still destructures/calls connected/connect()/disconnect()
  (runtime TypeError until rewired); "End workout" MUST bump setIndex or unmount to finalize the LAST set —
  stop() tears down the camera WITHOUT ending the set (by design); form_score is now the last rep's score held
  across frames (not per-frame) — drop the state==='down' && form_score>0 buffer, read RepEvent scores;
  person_detected has TWO sources (poseData.person_detected=visibilityOk vs keypointsData.person_detected=
  landmarks>0) — pick deliberately per UI element.
```

```
TASK: P1.10b-1b — web poseAdapter (on-device engine bridge, v1 §13/D1) 🟡
              [third slice of P1.10; on branch p1.10a-web-into-monorepo; UNCOMMITTED — awaiting T3]
FILES CHANGED:
  apps/web/package.json (+dep @app/engine workspace:*; +devDep vitest ^2.1.8; +"test": "vitest run");
  apps/web/vitest.config.js (new; node env, src/**/*.test.js);
  apps/web/src/engine/poseAdapter.js (new — the module);
  apps/web/src/engine/poseAdapter.test.js (new — 8 tests);
  apps/web/src/engine/__fixtures__/squat_goodform.jsonl (new — copy of the sqauta_sideview1goodform
    parity golden; 2 reps, scoreRange [45,100]);
  pnpm-lock.yaml (vitest for web).
STATE / DECISIONS:
  - Adapter API (framework-agnostic, so P1.10b-2's hook is thin glue): getDefinition(key|alias),
    engineSupports(def) [I4 gate], landmarksToFrame(landmarks,tMs) [§2.2 UN-MIRRORED], startSet(def,setIndex)
    -> { feed(landmarks,tMs)->FrameResult, onRep, end()->SetSummary, snapshot() }, EngineUnsupportedError.
  - §2.2 mirroring decided ONCE here: feed provider coords as-is; never flip the landmark array (overlay
    mirrors, engine does not). Empty/no landmarks -> kp:[] -> engine ingest fail-soft (§3.1).
  - Time: caller passes tMs into feed(); engine stays wall-clock-free (R5.1). Deterministic + testable.
  - I4 gate is a local numeric major.minor.patch compare (no semver dep, R1.4); works now that engine + all
    3 defs agree at 1.0.0 (P1.10b-1a). def needing >engine -> EngineUnsupportedError (never silently runs, R1.3).
  - Defs imported via @app/engine/definitions/*.json (subpath export from 1a); NO @app/shared / zod import
    (engine ingest validates plain objects) -> zod@3/4 stays a P1.10c concern, as established.
  - Verified: web adapter 8/8 tests (incl. golden replay: reps=2, engineVersion 1.0.0, avgFormScore in range,
    end() idempotent, I4 gate) · web build green (no regression) · new files eslint clean. The engine+JSON
    resolve/run in web's Vite toolchain is proven by the vitest run (Vite transform).
  - DEFERRED (flagged, not hacked): set->set carry-over calibration (§2.3) — createSession accepts it but a
    finished session exposes no baseline export (snapshot has calibrationReady only). Each set recalibrates
    fresh for now; carry-over needs a small engine method — tracked follow-up.
  - Golden fixture is a COPY into apps/web (minor drift risk; shared-fixture access not worth a package change now).
OPEN SPEC GAPS: none new.
NEXT TASK: P1.10b-2 — rewrite usePoseDetection to drive poseAdapter (delete the WS path, WS_URL, resetReps,
  recordResponse); wire ActiveWorkout (remove server-baseline rep machinery — engine session is per-set;
  map FrameResult/RepEvent -> UI; EN message-key map from Appendix A; collect SetSummary[] for P1.10c);
  exercises with no def (getDefinition null) need a UI fallback decision. jsdom vitest project for hook tests.
  T3 (P1.10b-1b) CARRY-FORWARDS: (a) caller MUST null-check getDefinition BEFORE startSet — startSet(null,..)
  throws a raw TypeError; (b) onRep is single-listener (engine SETS, not appends) — register exactly once;
  (c) CI Node >=22 (root engines) satisfies import.meta.dirname used in the adapter test.
```

```
TASK: P1.10b-1a — engine defs to v1 §4 home + engine v1 (prep for the web engine-swap) 🟡
              [second slice of P1.10; on branch p1.10a-web-into-monorepo; T3-reviewed clean]
FILES CHANGED:
  git mv packages/engine/test/definitions/{squat,jump_squat,chair_squat}.json ->
    packages/engine/src/definitions/  (CANONICAL def home is now src/definitions per v1 §4;
    squat.v5.json STAYS in test/definitions — P1.7 worked-example fixture, DECISIONS 2026-07-09);
  packages/engine/package.json (exports += "./definitions/*": "./src/definitions/*"; version 1.0.0);
  packages/engine/src/session.ts (ENGINE_VERSION "0.1.0" -> "1.0.0");
  repointed consumers: test/{traces.replay,fuzz,perf}.test.ts, scripts/{bench,fsm-parity-debug}.ts;
  test/fixtures.ts (scriptedEngine mock now imports ENGINE_VERSION instead of stale "0.0.1" — T3 finding).
STATE / DECISIONS:
  - engineVersion, package version, and all 3 defs' minEngineVersion now AGREE at 1.0.0 (I4: engineVersion =
    "semver of the package"; every spec example uses 1.0.0; Part 2 §10 = "engine v1"). Closes a prior
    incoherence (defs required 1.0.0 while the engine stamped 0.1.0) — this is what P1.10b-1b's I4 gate needs.
  - Defs exposed to the web build via the package subpath export (data-only; Vite bundles JSON). The eventual
    runtime path is the P2.2 catalog bundle API (Part 2 §9.3); the static export is the P1.10b bridge.
  - Verified: engine typecheck 0 · 146/146 tests (traces §7.4 + fuzz + perf) · lint:defs 4 ok · eslint 0 ·
    R5.1 purity grep clean · git mv changed zero def bytes (P1.8b parity byte-intact, T3-confirmed).
  - Historical DECISIONS.md:50 / HANDOFF.md older blocks still cite the old test/definitions path — left as
    append-only history; THIS block records the new canonical src/definitions home going forward.
OPEN SPEC GAPS: none new. Pre-existing (NOT this task): §7.5 trace-count cert still 3/6+3/4+3/4 (Option-B debt,
  DECISIONS 2026-07-09) — traces pass as a report, but Part 2 §10 "parity green" is not fully certified.
NEXT TASK: P1.10b-1b — web poseAdapter (MediaPipe->PoseFrame, un-mirrored §2.2; per-set createSession; I4
  minEngineVersion gate; endSet->SetSummary) + add vitest to apps/web + adapter test replaying a golden.
  Imports @app/engine (createSession/compileDefinition) + @app/engine/definitions/*.json. zod stays deferred
  (P1.10c, when @app/shared VALUE schemas are imported by the sync client).
```

```
TASK: P1.10a — migrate web SPA into the monorepo (v1 §4/§13 "migrated in place") 🟡
              [first slice of P1.10; UNCOMMITTED — T3-reviewed clean]
FILES CHANGED:
  frontend/ -> apps/web/ (git mv, 306 renames); apps/web/package.json (name
  "frontend" -> "web"); removed frontend/package-lock.json + stale node_modules/dist;
  package.json (root lint -> "turbo run lint --filter=!web"); DECISIONS.md (lint-gate
  entry + re-entry trigger); scripts/dev-recording-rig.ps1 (path frontend -> apps\web,
  npm run dev -> corepack pnpm dev); pnpm-lock.yaml (regen: web is now a workspace member).
STATE / DECISIONS:
  - Scope = the MOVE only. Did NOT wire @app/engine/@app/shared into web, and did NOT
    touch engine/api/shared logic — that's P1.10b.
  - Web held OUT of the workspace lint gate (strangler-fig): salvage SPA has 90 pre-
    existing eslint errors; mass-fixing forbidden (R1.1 + migration stance), a red CI
    destroys the gate's signal. web has no typecheck/test scripts, so it's fully ungated
    for now. Re-entry trigger recorded: drop --filter=!web once web adopts the strict
    packages/config presets in P1.10b→P2. (DECISIONS.md 2026-07-09.)
  - Verified: pnpm --filter web build green (Vite 8, 3362 modules); in-scope lint +
    typecheck green; pnpm install --frozen-lockfile clean; apps/web/.env untracked &
    ignored (root .gitignore:27); no other broken frontend/ refs in CI/infra/docker/scripts.
  - T3 (independent, fresh chat) PASSED: no rule violations; one finding = this HANDOFF
    block was missing (now added).
OPEN SPEC GAPS: none for P1.10a.
NEXT TASK: P1.10b — engine adapter (MediaPipe -> PoseFrame, un-mirrored coords §2.2) +
  usePoseDetection swap to @app/engine + ActiveWorkout wiring + delete WS path. FIRST
  DECISION at its plan gate: align the workspace on ONE zod (web zod@4 vs @app/shared
  zod@3) — a cross-package bump touching api/engine, needs Kd approval (R1.4). Adopting
  web onto the strict tsconfig/eslint presets here also trips the lint re-entry trigger.
```

```
TASK: P1.9 — fuzz pass + performance gate (§7.6 / I5, I6) 🔴  [MERGED 2e8aab3]
FILES CHANGED:
  packages/engine/test/{fuzz.test.ts, perf.test.ts} (new), vitest.config.ts (new:
  forks + --expose-gc), scripts/bench.ts (real engine now), package.json
  (+test:fuzz/test:perf), DECISIONS.md.
STATE / DECISIONS:
  - PERF: real squat engine, 9000-frame (10min@15fps) replay. p95 ≈ 0.03 ms
    (~100× under 3 ms). The 3 ms CI assertion is a REGRESSION TRIPWIRE; the true
    ≤3 ms mid-Android (₹12k) budget (I5) is verified at the P5 §3.2 device spike.
  - HEAP: strict <5 MB with FORCED GC (≈ −25.8 MB, reproducible) is what CI runs
    (vitest.config.ts exposes gc). The loose <40 MB fallback is NOISY (−5..+25 MB)
    — not a stable number. R5.5 ring-buffer refactor MEASURED UNNECESSARY (garbage
    fully reclaimed); that deferral is closed.
  - FUZZ: seeded (mulberry32) NaN / dropout / 8–40 fps jitter on squat/chair/jump
    goldens (40 seeds × 4 variants) + a recovery case. Invariants hold: no throw
    (I6), reps never exceed the clean baseline, counting recovers after dropout.
    Confirms the 2026-07-08 debounce decision (raw frame counts don't let jitter
    inflate counts).
  - NO src/ changes. T3-reviewed in a SEPARATE chat: found the strict heap gate
    wasn't wired to CI (fixed via vitest.config --expose-gc) + DECISIONS heap
    figures were cherry-picked (corrected). Re-proven green.
PROOF: 146/146 engine tests (perf line shows gc=forced strict path), tsc 0,
  lint 0, purity grep clean.
NEXT TASK: P1.10 🟡 — web swap. LAST engine-phase task; after it, Phase 1 is done.
```

```
TASK: P1.8b — squat/jump/chair as §4 definitions (§4–8) 🔴  [MERGED 0228c06]
FILES CHANGED:
  packages/engine/test/definitions/{squat.json (v6), jump_squat.json,
  chair_squat.json} (new), test/traces.replay.test.ts (compiled defs + §7.5
  count-shortfall warn), test/parity-configs.ts (DELETED),
  scripts/fsm-parity-debug.ts (repointed to compiled defs), DECISIONS.md.
STATE / DECISIONS:
  - FOOTNOTE 2 RESOLVED by measurement: metric = knee_L (+knee_R fallback) for
    ALL three. knee_avg matches the 3 squat goldens but UNDERCOUNTS chair (2→1)
    and jump (2→0). squat.json v6 supersedes squat.v5.json's illustrative
    knee_avg AND drops the unported minRepMs:900 / maxRepMs:12000.
  - Only SQUAT is scored faithfully. jump (airborne-gated) + chair (target-
    relative depth) scoring is NOT expressible in the current template → interim
    scorers, filed as 2 SPEC GAPs → P4. Chair C2 = option (b): reps+scoreRange.
    The ±3-vs-Python assertion has no defined extraction rule → deferred.
  - OPTION B (Kd's call): land the current 9 clips green (reps + view +
    scoreRange). Faults / ±3 / full 6+4+4 session count deferred as tracked P4
    debt; G3 signed off. §7.5 shortfall (have 3+3+3) now WARNS loudly in
    traces.replay (was a tautology).
  - T3-reviewed in a SEPARATE chat: caught unported minRepMs (V1) + DECISIONS
    accuracy holes — all fixed before merge.
PROOF: 141/141 engine tests, tsc 0, lint 0, purity grep clean.
NEXT TASK: P1.9 — fuzz pass + perf gate (§7.6).
```

```
TASK: P1.8a — constants inventory (§8.1 table ONLY; NO code) 🔴
DELIVERABLE: docs/port/P1.8a-constants-inventory.md — the complete §8.1
  constant-preservation table from form_analyzer.py + rep_counter.py, APPROVED
  by Kd 2026-07-09 (reviewed against the Python). Every numeric threshold with
  name · value · units · Python source line · target definition field.
FILES CHANGED: docs/port/P1.8a-constants-inventory.md (new), HANDOFF.md.
  (No engine/shared/api code touched — P1.8a is a review artifact by design,
  CLAUDE.md Part I §7(d). PR #11 / P1.7 already MERGED — nothing to merge.)
KEY OUTPUTS FOR P1.8b (all in the doc):
  - FOOTNOTE 1: bilateral gate value 150° but STRICT `<` (not `≤`); keep
    bilateralGate:150, engine applies `<` (parity; DECISIONS 2026-07-08).
  - FOOTNOTE 2 (the crux): legacy COUNTING joint = left_knee (+right fallback);
    legacy FORM metric = knee_avg. squat.v5.json ships rep.metric:knee_avg for
    counting — P1.8b MUST prove knee_avg counts bit-identically to left_knee on
    the 9 goldens (DECISIONS Pending SPEC GAP), or switch metric.
  - FLAG: SQUAT_LOCKOUT_KNEE_MAX=178 is DEAD (no check uses it) — P1.8b does NOT
    invent a lockout fault (R0.2).
  - FLAG: jump valgus DIVERGES — severe −0.25 (not −0.30) + inline
    `100+worst*200` (not _score_valgus). Author jump valgus from jump-local values.
  - Chair C2 target formula still a SPEC GAP (median+5° legacy vs §3.5
    mean-of-2 clamp[80,120]); needed before chair score-±3 parity (DECISIONS).
NOT COMMITTED yet — p1.7-definition-schema branch is stale (PR #11 merged);
  Kd to decide branch/commit (docs-only; suggest fresh p1.8b branch carries it).
NEXT TASK: P1.8b 🔴 — express squat, jump-squat, chair-squat as §4 definitions
  using ONLY this approved table → §7.5 parity gate green. Fresh chat, T4 port
  template + T3 review before merge. P1.8b also owes the DECISIONS Pending
  "P1.8b gate debt": per-rep score ±3-vs-Python assert, fault-multiset trace
  coverage, phase-timing tolerance, Kd rep spot-check.
```

```
TASK: P1.7 — definition schema + linter (§4, §9.2) + bundle load 🔴
FILES CHANGED:
  packages/shared/src/{definition.ts (new), session.ts (definition now typed),
  index.ts}, packages/shared/test/schemas.test.ts (P1.1 placeholder updated),
  packages/engine/src/definition/{lint.ts, compile.ts}, src/index.ts,
  src/pipeline/scoring.ts (+inactiveWhenPositiveDrift), test/definition.test.ts,
  test/definitions/squat.v5.json, scripts/lint-defs.ts, package.json
  (+lint:defs), .github/workflows/ci.yml (+lint:defs step)
DECISIONS/RECONSTRUCTIONS (worked example is "abbreviated" per §4):
  - Spec's `valgus_delta_min` refs → `valgus_delta_L_min` (§3.4 library has
    only L/R variants; unqualified name doesn't exist). P1.8b may switch to a
    worst-of-both-sides composite if the constants inventory demands it.
  - Fixture status "beta" not "live" (live requires ≥6 fixtures in the linter).
  - bilateralGate in definitions is a NUMBER (§4 example) but only the
    engine-global 150 is accepted in v1 — compile throws on anything else.
  - "gps" tracking rejected (reserved, §4 v1.1).
  - Compile equivalence test uses minRepMs-stripped variant (900 vs legacy 450
    floor — booked P1.8b debt).
PROOF: worked example lints clean, compiles, and counts IDENTICALLY to the
hand-built legacy config on all 3 squat goldens. 140/140 engine tests,
15/15 shared. lint:defs in CI.
NEXT TASK: P1.8a — constants inventory (SEPARATE CHAT, deliverable = the §8.1
table ONLY, from form_analyzer.py + RepCounter configs, for Kd review).
Remaining before P1 exit: P1.8b (definitions to parity green), P1.6b (modes
B–D), P1.9 (fuzz+perf), P1.10 (web swap). Kd still owes ~7 §7.5 clips + the
golden spot-check (DECISIONS Pending).
```

```
TASK: P1.6a — Mode-A FSM + fault DSL + scorer + emission (§3.6–3.9) 🔴
FILES CHANGED:
  packages/engine/src/pipeline/{fsm,faults,scoring}.ts, src/session.ts,
  src/index.ts, test/pipeline/{fsm,faults-scoring}.test.ts,
  test/parity-configs.ts, test/traces.replay.test.ts (§7.4 ARMED),
  scripts/fsm-parity-debug.ts, backend-ml/feed_video.py (unique session/clip),
  all 9 parity traces RE-RECORDED (see DECISIONS: session contamination).
STATE:
  - FULL PARITY: 119/119 engine tests — §7.4 rep counts EXACT on all 9 traces,
    scores in declared ranges, plus view/angle parity. MILESTONE.
  - ModeAFsm = faithful RepCounter port (smoothing INSIDE the FSM, 7-sample
    plain mean — distinct from §3.2 conditioner; guards: 3/2 debounce, 450ms,
    bilateral 150° w/ occlusion fallback, null→hold).
  - DSL parser/evaluator (§3.7 grammar, parse-once), coaching policy (≤2
    corrections, worst-voice + cooldown); scoring curves numerically identical
    to legacy (§3.8), neutral 80 / correct ≥70; session Form Score.
  - createSession() assembles full EngineSession (harness-compatible),
    snapshot(), C2 fed on rep completions. Faults still faultsPending (P1.8).
  - NOT DONE (P1.6b): FSM modes B (hold), C (alternating_sides), D (cadence);
    hold scoring; HoldTick/HoldEvent emission; cadence signal (#20).
  - parity-configs.ts = hand-built EngineConfigs citing §8.1 rows; P1.7
    compiles §4 definitions into EngineConfig and replaces them.
NEXT TASK: P1.6b (modes B–D) or P1.7 (definition schema + linter) — either
order works; P1.7 unblocks P1.8a/b (constants inventory + parity defs).
```

```
TASK: P1.5 — signal library v1 (§3.4) + calibration modules (§3.5) 🔴
FILES CHANGED:
  packages/engine/src/pipeline/{geometry,signals,calibration}.ts, src/index.ts,
  test/pipeline/{geometry,signals,calibration,signals.parity}.test.ts
STATE:
  - Signals #1–19, #21, #22 implemented; #20 cadence declared derived (FSM
    supplies it in P1.6; SignalEngine skips it, direct compute throws).
  - Legacy ROUNDING ported (angles 0.1°, valgus/elevation 4dp) — part of the
    formula; parity asserts EXACT match with sidecar angles on all 9 traces.
  - C1 standing_baseline (160°/8 frames, view-flip + >3s-lost invalidation,
    restore() for §2.3 carry-over), C2 adaptive_target (2 reps, clamp,
    fallback; fed via onRepComplete — P1.6 FSM calls it), C3 floor_reference
    (1s stillness; threshold ⚙ definition-declared, no engine default).
  - Flood-echo skip in parity comparisons (see DECISIONS).
  - 89/89 engine tests; purity grep clean (beware comment words matching
    banned tokens: "document.", "window." both bit us).
NEXT TASK: P1.6 — rep/hold FSMs + fault-rule DSL evaluator + scorer + emission
(§3.6–3.9) 🔴 — assembles EngineSession; wires cadence, C2 feed, §7.4 asserts
(reps/scores; faults stay faultsPending until P1.8).
```

```
TASK: P1.4 — pipeline stages 1–3 (Part 2 §3.1–3.3) 🔴 (branch p1.4-pipeline-1-3,
stacked on p1.3-recording-mode)
FILES CHANGED:
  packages/engine/src/pipeline/{types,ingest,conditioning,view}.ts, src/index.ts,
  test/pipeline/{ingest,conditioning,view}.test.ts, test/traces.replay.test.ts
  (now runs stages 1–3 on all traces), test/fixtures.ts (+must helper),
  scripts/view-parity.ts (diagnostic), backend-ml/feed_video.py (header view =
  Python-dominant), 4 parity trace headers corrected (view field).
DECISIONS:
  - FINDING: 4 of 9 clips' filename view labels were WRONG (angled cameras read
    as front/unknown). Python's own view outputs are the truth (§7.5);
    headers now carry the Python-dominant view; feeder derives it automatically.
  - View-classifier port verified at 100% per-frame agreement with Python
    across all 9 traces (895 frames) — trace test asserts EXACT per-frame
    parity (I2, enum output). Never weaken to a percentage.
  - Smoothing: ≤7 samples AND ≤470ms (§3.2 lag ceiling) — low fps uses fewer
    samples. Spike filter = median-of-3. Vis hysteresis 0.30/0.15.
  - Ingest: out-of-order drops do NOT count toward the 3-invalid visibility
    streak (person may be fully visible).
  - Rep/fault/score §7.4 asserts still DEFERRED (loud notice) until P1.6.
OPEN SPEC GAPS: P0.3's three (unchanged).
NEXT TASK: P1.5 — signal library v1 (22 signals, §3.4) + calibration modules
(§3.5). 🔴 — needs §3.5 read carefully; signals 1–17 before C2/C3 per §8.2.
```

```
TASK: P1.3 — recording mode + parity goldens (IN PROGRESS, branch p1.3-recording-mode)
STATE:
  - Old stack revived for recording: scripts/dev-recording-rig.ps1 starts
    mongo+redis (docker), backend-auth (:3001), backend-ml pose-only (:8000,
    run_pose_only.py — exercises/users/workouts/gamification/recommendations
    mounted under /api; progress/coach/nutrition NOT mounted, heavy deps),
    frontend (:5173). backend-ml venv = Python 3.11 (.venv), deps incl.
    fastapi/numpy/jose/motor/redis/mediapipe/opencv/websockets.
  - Mongo seeded with scripts/seed_exercises.py (58 exercises).
  - Old-code dev fixes (disclosed): gamification.py missing Query import;
    run_pose_only.py is new dev-only entrypoint.
  - VIDEO FEEDER (chosen path over live webcam): backend-ml/feed_video.py —
    lite model @15fps of VIDEO time, streams to pose WS with REAL-TIME pacing
    (server flood guard is wall-clock; unpaced sends get silently skipped —
    already fixed once, don't regress), writes §7.1 trace + .responses.jsonl
    sidecar to packages/engine/test/traces/parity/.
  - 9 parity traces recorded (3 squat, 3 jump, 3 chair, side view; user
    provided downloaded clips in backend-ml/recordings/, gitignored).
    Python outputs ARE the expected values (§7.5), including warts:
    jump reps often undercounted at 15fps (3-frame debounce vs fast jumps),
    Jump_Squats_goodform_sideview1 legitimately expects reps=0.
  - faultsExact left {} in parity traces = "not yet mapped"; P1.8 maps legacy
    response fields (corrections/form_correct) from the sidecars.
STILL OPEN FOR P1.3 DONE:
  - §7.5 wants ≥6 squat + 4 jump + 4 chair sessions and front views for the
    matrix; have 3+3+3 side-only. Kd to add ≥7 clips before the P1.8 parity
    gate (not blocking P1.4–P1.7): squat front-view · squat occlusion walk-out ·
    squat speed-extremes · jump-squat with NO jump (locks lenient behavior) ·
    chair-squat front-view · (nice-to-have) jump front-view. Drop in
    backend-ml/recordings/<exercise>/ and run feed_video.py per HANDOFF above.
    More clips can be fed anytime
    (rig + feeder are one command each). Bulgarian split squat clips exist in
    recordings/ but are NOT parity material (no legacy rules) — future authoring data.
  - Traces intentionally NOT merged to master yet: test:traces goes red when a
    trace exists without an engine (by design). Keep them on this branch until
    P1.4–P1.6 wire an engine into test/traces.replay.test.ts.
NEXT TASK: P1.4 — pipeline stages 1–3 (ingest/validation, smoothing+visibility
gating, view classifier) per Part 2 §3.1–3.3. 🔴
```

```
TASK: P1.2 — golden-trace harness (Part 2 §7) 🔴
FILES CHANGED:
  packages/engine/src/harness/{types.ts, trace.ts, replay.ts, assert.ts},
  src/index.ts (exports), test/{fixtures.ts, harness.test.ts,
  traces.replay.test.ts, traces/README.md}, scripts/bench.ts,
  eslint.config.js (purity scoped to src/**), package.json (+scripts, tsx dev,
  @app/shared as type-only devDep), .github/workflows/ci.yml (+test:traces step)
DECISIONS:
  - Pure core in src/harness (no fs/zod — I1 zero-runtime-deps held by making
    @app/shared a TYPE-ONLY devDependency); file I/O + deep zod validation live
    in test/ and scripts/ (the Node shell). ESLint purity rules scoped to src/**.
  - EngineSession interface = §2.4's three event levels + SetSummary, minimal;
    pipeline cards amend it visibly if needed.
  - test:traces passes with a LOUD 0-trace notice until P1.3; a committed trace
    with no engine wired is a deliberate build failure.
  - Bench scaffold prints p95/heap now; the ≤3ms CI assertion arms in P1.9 (§7.6).
  - HOLD_TOLERANCE_MS=700 (§7.4) is a named constant in assert.ts.
  - Purity-grep false positive fixed: comments in src must avoid "document."
OPEN SPEC GAPS: P0.3's three (unchanged).
NEXT TASK: P1.3 — recording mode in the CURRENT web app (dev toggle teeing
PoseFrames to JSONL while the old Python analyzer runs) → record the §7.3/§7.5
parity fixture matrix. NOTE: touches the OLD frontend as salvage-source; needs
those files in context.
```

```
TASK: P1.1 — packages/shared Zod schemas (Part 2 §2 + v1 §5.3)
FILES CHANGED:
  packages/shared/src/{pose.ts, events.ts, session.ts, sync.ts, index.ts},
  packages/shared/test/schemas.test.ts, DECISIONS.md (+1 precedence entry)
DECISIONS:
  - sync sets[] = full §2.4 SetSummary (precedence entry in DECISIONS.md).
  - sessionInput.definition typed unknown until P1.7 lands the §4 schema.
  - Constants shipped: KP (frozen BlazePose-33 map), VISIBILITY_THRESHOLD=0.3,
    MIN_FPS=8/MAX_FPS=40 — each cited to §2.1.
  - x/y NOT range-clamped in schema (off-screen landmarks exceed [0,1]; engine
    gates on vis) — vis IS clamped [0,1].
OPEN SPEC GAPS: P0.3's three (unchanged).
NEXT TASK: P1.2 — golden-trace harness BEFORE engine (Part 2 §7): JSONL trace
format, replay runner, §7.4 assertion/tolerance layer, CI wiring, perf scaffold. 🔴
```

```
TASK: P0.5 — PostHog server-side init + DECISIONS.md / RUNBOOK / INCIDENTS.md
FILES CHANGED:
  apps/api/src/analytics.ts (new), src/config.ts (+POSTHOG_API_KEY/HOST),
  src/app.ts (analytics decorator + shutdown), test/analytics.test.ts,
  DECISIONS.md, RUNBOOK/README.md, INCIDENTS.md, apps/api/package.json (+posthog-node)
DECISIONS:
  - Analytics dormant no-op without POSTHOG_API_KEY (same posture as Sentry).
  - Event names = closed union of the v1 §16 starter taxonomy (13 events).
  - DECISIONS.md backfilled with all judgment calls since P0.1, incl. the
    Hetzner-stays / spend-starts-at-P0.4b decision and P0.3's 3 pending gaps.
OPEN SPEC GAPS: P0.3's three (see DECISIONS.md Pending).
PHASE 0 STATUS: complete except P0.4b (staging deploy — blocked on Hetzner VPS+domain).
NEXT TASK: P1.1 — packages/shared Zod schemas verbatim from Part 2 §2 (+ v1 §5.3).
```

```
TASK: P0.4a — apps/api Fastify skeleton (deploy half split to P0.4b, needs Hetzner box)
FILES CHANGED:
  apps/api/src/{config.ts, app.ts, index.ts}, apps/api/test/{smoke.test.ts → config
  tests, app.test.ts}, apps/api/package.json (+fastify stack, tsx, dev script)
DECISIONS:
  - Deps approved at gate: fastify, @fastify/{cors,rate-limit,sensible}, pino,
    @sentry/node (+pino-pretty dev). Added during PROVE: tsx (dev-only TS runner).
  - CORS origin as [WEB_ORIGIN] array — header only on exact match.
  - 404s go through a typed not-found handler wrapped in app.rateLimit() so
    scanning traffic can't bypass the limiter.
  - Global rate limit 300/min; strict per-route limits arrive with auth (P2.1).
  - Sentry dormant unless SENTRY_DSN set. env: NODE_ENV/PORT/LOG_LEVEL/
    DATABASE_URL/WEB_ORIGIN/SENTRY_DSN, parsed once in src/config.ts.
  - Proof: 14/14 tests green vs Neon branch; real boot via tsx: /health 200 with
    DB ping, 404 typed shape over HTTP.
OPEN SPEC GAPS: none new (P0.3's three still open).
NEXT TASK: P0.4b — Docker/Caddy compose + staging deploy (blocked on Hetzner VPS
+ domain), or P0.5 (PostHog init + DECISIONS.md/RUNBOOK/INCIDENTS files), or P1.1.
```

```
TASK: P0.3 — Drizzle setup + migration 0001_init (Part 4 §3 DDL) + seeds
FILES CHANGED:
  apps/api/drizzle.config.ts, apps/api/drizzle/0001_init.sql (+meta/),
  apps/api/src/db/{index.ts, seed.ts, schema/*.ts (12 domain files + common)},
  apps/api/test/db.migration.test.ts, apps/api/package.json (scripts+deps)
DECISIONS:
  - Deps approved at gate: drizzle-orm, postgres (driver), zod (api runtime); drizzle-kit (dev).
  - Migration file named 0001_init (drizzle generated 0000; journal tag updated).
  - Extensions/BRIN/view as raw SQL in the same migration (drizzle-kit can't emit them).
  - Bare REFERENCES kept as generated (ON DELETE no action) — matches Part 4 §3 DDL
    literally; §1's "default RESTRICT" is NO ACTION in PG terms (identical unless
    deferred constraints are used).
  - Seeded: plans (5 consumer + 6 org INR-monthly rows incl. org_micro_clinic per
    Part 5 §1.2) + feature_flags {data_backend, engine_rollout, beta_definitions}.
  - Exercises/definitions/achievements seeds deferred to their owning tasks (need
    Part 2 §6 catalog + 2B App A METs + badges.py port + P1.8 constants).
  - Proof: Neon branch (created/deleted via API) — migrate clean, 5/5 tests green.
OPEN SPEC GAPS (Kd to decide):
  1. Org intl (USD) + annual (×10) price-book rows: plans has one currency/interval
     per row, so Part 5 §1.2's USD and annual books need their own codes (e.g.
     org_micro_us_m / org_micro_in_y?). Part 4's code list doesn't name them.
  2. Org plans' subscriber `entitlements` = "console features" — shape unspecified;
     seeded {} for now.
  3. name_key convention unspecified — used "plan.<code>".
NEXT TASK: P0.4 — apps/api Fastify skeleton (boot, env config, pino, Sentry,
/health, trustProxy, CORS, global rate limit) + staging deploy.
```

```
TASK: P0.2 — CI pipeline (typecheck · lint · test · gitleaks · Drizzle-on-Neon)
FILES CHANGED:
  .github/workflows/ci.yml (new)
  packages/config/package.json (echo scripts quoted — unquoted parens broke Linux sh)
DECISIONS:
  - CI jobs: gate (typecheck/lint/test), engine purity grep (R5.1), gitleaks full
    history, drizzle-migrations-on-Neon-branch (visible skip until P0.3 lands a
    drizzle/ folder; then auto-enforcing via `pnpm --filter api migrate`).
  - Workflow token perms: contents+pull-requests read (gitleaks-action needs PR API).
  - Branch protection UNAVAILABLE: GitHub Free + private repo (403). Green-before-
    merge is procedural until GitHub Pro or repo goes public. Revisit.
  - Red/green proof: run 28808343021 red (only the deliberate test), run 28808448318
    green — both on PR #1.
OPEN SPEC GAPS: none.
NEXT TASK: P0.3 — Drizzle setup + migration 0001_init (Part 4 §3 DDL) — 🔴 tier.
```

```
TASK: P0.1 — Scaffold monorepo per v1 §4 (pnpm workspaces + Turborepo)
FILES CHANGED:
  package.json, pnpm-workspace.yaml, turbo.json, .npmrc, tsconfig.json, .gitignore (+.turbo/)
  packages/config/{package.json, tsconfig.base.json, eslint-base.js, eslint-engine.js, test/eslint-engine.test.js}
  packages/shared/{package.json, tsconfig.json, eslint.config.js, src/index.ts, test/smoke.test.ts}
  packages/engine/{package.json, tsconfig.json, eslint.config.js, src/index.ts, test/smoke.test.ts}
  apps/api/{package.json, tsconfig.json, eslint.config.js, src/index.ts, test/smoke.test.ts}
DECISIONS:
  - Test runner: vitest ^2 (approved in P0.1 gate; spec silent).
  - Node >=22 engines pin; pnpm 9.15.4 via packageManager field (dev box runs it through `corepack pnpm`).
  - Only the four card-named workspaces created; apps/web, apps/dashboard, infra/, .github/ come with their own tasks.
  - Engine tsconfig: `types: []` (no node/dom ambient types) on top of the ESLint R5.1 restriction preset.
  - Package tsconfigs include test/ so tests are typechecked and lintable by the project service.
  - apps/api src/index.ts throws NotImplementedError (R1.3) until P0.4.
OPEN SPEC GAPS: none.
NEXT TASK: P0.2 — CI pipeline (typecheck · lint · test · gitleaks · Drizzle migrations on a Neon branch).
```
