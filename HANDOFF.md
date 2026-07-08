# HANDOFF log (append-only; latest block goes under the next task's T1 prompt)

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
