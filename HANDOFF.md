# HANDOFF log (append-only; latest block goes under the next task's T1 prompt)

```
TASK: P2.4 — entitlement resolver + quota middleware 🟡
              [branch p2.4-entitlements-quotas; PROVE green 124/124 on Neon branch
               p22-test (reused), ZERO skips — full P2.1–P2.3 regression (incl. auth
               rate-limit suite on the NEW Redis store) + 19 new tests; awaiting Kd
               review + T3 (required for ALL tasks)]
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
