<!--
Architecture v1.0 — master blueprint
Extracted from aihomegym.pdf (pdftotext). Hard line-wraps and occasional
table/DDL wrapping are extraction artifacts, not content changes. When an
exact value (price, threshold, SQL) looks garbled, verify against the PDF.
This file is spec — BINDING. Do not modify; record deviations in DECISIONS.md.
-->

# AI Home Gym — Production System Architecture v1.0

**Audience:** Kd (solo developer, owner)
**Scope:** Web app (now) + Mobile app (next) + Gym B2B platform + Consumer
subscriptions
**Status:** This is the master blueprint. Deep-dive specs (exercise
engine, gym dashboard, DB schema, billing, mobile, retention) follow as
separate parts — see §23.

---

## 0. How to use this document

Read §1–§2 first — they explain *why* the redesign looks the way it does.
§3–§20 are the target system. §21 is the retention/growth feature set. §22
is the build order with acceptance criteria — follow it top to bottom.
Nothing in here requires throwing away your domain logic: your squat
rules, calibration logic, quota philosophy, RAG knowledge base, and most
frontend pages survive. What gets replaced is the *skeleton* they hang on.

---

## 1. Audit of the current codebase

What exists today: three services — `backend-auth` (Node/Express +
Mongoose), `backend-ml` (FastAPI + Motor/Mongo + Redis: exercises,
workouts, progress, coach RAG, nutrition, running, gamification, pose
WebSocket), and `frontend` (React 18 + Vite SPA running MediaPipe
in-browser, streaming 15fps keypoints to the server over WebSocket).

### 1.1 What is genuinely good (keep the logic, port the code)

| Asset | Why it's valuable |
|---|---|
| Squat / jump-squat / chair-squat rule logic (`form_analyzer.py`) |
View-aware, self-calibrating (standing baseline, per-user valgus delta),
research-grounded thresholds with documented rationale. This is your real
IP. It gets *translated*, not rewritten. |

| `RepCounter` config dict (up/down angle + hysteresis + direction) |
Already half-way to the declarative system we need — proof the
config-driven approach works. |
| Quota module (`core/quotas.py`) | Correct fail-open (cheap) /
fail-closed (expensive) philosophy, atomic Redis increment. Survives as-is
conceptually; gets generalized to per-plan limits. |
| Browser-side MediaPipe (`usePoseDetection.js`) | Right call. Throttled
inference, visibility pause, exponential backoff — good engineering. |
| RAG knowledge base content (5 markdown guides) | Content is portable
regardless of vector store. |
| Prod-config boot validation (both backends) | Good habit; carries into
the new API. |
| Frontend pages/UX (Dashboard, ActiveWorkout, Nutrition, Coach, Progress,
WorkoutBuilder...) | The product surface is built. It gets re-pointed at a
new API and a local engine — not rebuilt. |

### 1.2 The five architectural blockers

**Blocker 1 — Form analysis lives on the server.** Every workout streams
15fps keypoints over a WebSocket to a Python process holding per-user
`RepCounter` + calibration state **in process memory** (`active_sessions`
dict). Consequences: (a) you can never run two API instances behind a load
balancer without sticky sessions — horizontal scaling is blocked by
design; (b) every rep costs server CPU and mobile data — cost scales with
usage; (c) feedback latency = network round-trip; (d) zero offline
capability — fatal for gyms with bad signal and for mobile; (e) the mobile
app cannot reuse any of this logic without also streaming to the server.

**Blocker 2 — Exercises are hand-written Python functions.**
`_analyze_squat`, `_analyze_jump_squat`, `_analyze_chair_squat` = ~38 KB
for 3 variants. At this rate, 59 exercises ≈ 700 KB of bespoke
per-exercise code, each new exercise requires a server deploy, and none of
it runs on-device. This is the single biggest threat to ever shipping the
other 56 exercises.

**Blocker 3 — Two backends, two languages, one shared JWT secret.** Node
auth + Python everything-else means duplicated middleware, duplicated
deploys, duplicated config, and an HS256 secret shared across services —
all overhead a solo dev pays forever. The split earns nothing: once pose
analysis leaves the server (Blocker 1), there is no Python-only workload

left in the hot path (coach = Groq API call, meal photos = vision API
call, routing = ORS API call).

**Blocker 4 — The business layer doesn't exist.** No gyms, no tenancy, no
seats, no plans, no subscriptions, no payments, no entitlements, no admin,
no dashboard. Quotas are hardcoded constants identical for every user. The
entire revenue model from our previous discussion is unbuilt, and bolting
multi-tenancy onto a single-tenant Mongo schema later is far more painful
than designing for it now.

**Blocker 5 — MongoDB under relational, money-touching data.**
Users↔gyms↔seats↔subscriptions↔invoices↔quotas↔leaderboards are joins,
constraints, and transactions. You want a database that makes
double-charging and orphaned seats *impossible*, not merely unlikely.

### 1.3 Additional findings

-   🔴 **Committed secrets:** real values for `GROQ_API_KEY`,
`GOOGLE_CLIENT_SECRET`, `ORS_API_KEY`, `JWT_SECRET`/`ML_JWT_SECRET`,
`MONGO_URI` exist in `.env`, `backend-auth/.env`, `backend-ml/.env` inside
the shared archive. **Rotate every one of these before doing anything
else**, and purge `.env` from git history (`git filter-repo`). Add secret
scanning (Gitleaks) to CI so this can't recur.
-   🟠 **Effectively zero tests** (one `test_stgcn.py`). "No bugs like big
tech" is achieved by big tech through automated regression tests, not
carefulness. The new architecture makes the critical path (the engine)
trivially testable — see §5.4.
-   🟠 **Server-side ML experiments in prod tree** (YOLOv8s-pose, ST-GCN
checkpoints, 17 MB CTR-GCN ONNX in `frontend/public`,
`FormClassifier.js`). Park all of it in `ml-training/`. The rule engine is
the product; ML classifiers are a research track, not a dependency.
-   🟡 **Monolithic page components** (`ActiveWorkout.jsx` 51 KB,
`Settings.jsx` 37 KB) — refactor opportunistically as pages are touched,
not as a project.
-   🟡 **No migrations, no CI/CD, no error tracking, no analytics events.**
All addressed in §16–§19.

**Verdict:** the *domain logic* is worth keeping; the *skeleton* is a
university-project skeleton (it says so in `PROJECT_PLAN.md`) and must be

replaced before gyms pay you. That is exactly what the rest of this
document does.

---

## 2. The five architecture decisions

Everything downstream follows from these. Each reverses one blocker.

**D1 — All pose analysis runs on-device, on every platform.** The camera →
MediaPipe → Form Engine loop executes entirely in the browser (web) and on
the phone (mobile). The server never sees a keypoint during a workout.
Clients send compact **rep/set summaries** to a REST sync endpoint when a
set ends (batched, retried, idempotent). Result: form checking has ~zero
marginal server cost at any scale, feedback is instant (<50 ms loop vs.
network RTT), workouts work offline, and the WebSocket + in-memory session
store are deleted from the hot path entirely. Anti-cheat moves server-side
onto the summaries (§14).

**D2 — Exercises become data, not code.** One generic TypeScript **Form
Engine** interprets declarative **Exercise Definitions** (JSON): signals
to compute, calibration needs, a rep state machine, fault rules with
severities, scoring weights, localized message keys. ~10–12
movement-family *templates* parameterize into all 59 exercises.
Definitions are served by the API as a **versioned bundle** — you ship a
new exercise by publishing a config row, with **no app-store release and
no deploy**. Your existing squat/jump/chair logic becomes the first three
definitions, verified for parity against recorded sessions (§5).

**D3 — One backend: a TypeScript modular monolith.** Fastify + TypeScript
+ Zod + Drizzle ORM, with BullMQ (Redis) for background jobs.
`backend-auth` and `backend-ml` merge into one deployable with strict
internal module boundaries (§6). One language across API, web, mobile, and
the shared engine package means one skill set, shared types end-to-end,
and half the operational surface. (This is not "monolith because small" —
it's the same shape Shopify, GitHub, and Stripe scaled on. Microservices
are an org-chart solution; you are one person.)

**D4 — PostgreSQL is the system of record; Redis and R2 are specialists.**
Postgres (managed, with point-in-time recovery) holds all relational/money

data with real constraints and transactions. Redis: quota counters, rate
limits, leaderboard ZSETs, geocode cache, job queue. Cloudflare R2: meal
photos (transient), gym logos, avatars, generated share cards and report
PDFs. Mongo is retired after a one-time migration (§7.4).

**D5 — Tenancy, plans, and quotas are first-class and config-driven.**
Gyms, seats, roles, and an **entitlement resolver** (personal subscription
OR active gym membership → effective plan) sit at the core of the schema.
Every limit in the product reads from a plan's entitlement JSON — changing
a quota or price is a data change, never a deploy (§8–§9).

---

## 3. Target system diagram

```
                     ┌─────────────────────────────           CLIENTS
─────────────────────────────┐
                     │
│
    ┌─────────────┴──────────────┐
┌────────────────────────┴─┐
    │   WEB (React+Vite SPA, PWA) │                                       │ MOBILE (Expo
RN, dev-client)│
    │   camera → MediaPipe WASM              │                            │ VisionCamera
→ BlazePose      │
    │         ↓ 33 landmarks                 │                            │         ↓ 33
landmarks         │
    │   ┌──────────────────────┐             │      shared package        │
┌──────────────────────┐             │
    │   │ @app/engine (TS)               │◄─┼────   @app/engine   ─────────┼─►│
@app/engine (TS)             │   │
    │   │ defs → reps+faults+            │   │      @app/shared (types,   │   │ + SQLite
offline queue│       │
    │   │ score, all LOCAL               │   │       zod, api-client)     │   │ + GPS
running (only)       │   │
    │   └──────────┬───────────┘             │                            │
└──────────┬───────────┘             │
    └─────────────┼──────────────┘
└─────────────┼──────────────┘

                         │   HTTPS REST /v1 (set summaries, everything else)
│
                         ▼
▼

┌──────────────────────────────────────────────────────────────────────┐
             │                         API — Fastify TS modular monolith
│
             │   auth │ users │ gyms │ entitlements │ quotas │ workouts │
exercises        │
             │   gamification │ coach │ nutrition │ geo │ billing │ reports │
admin    │
             │   notifications │ webhooks │ analytics
│

└───────┬───────────────┬───────────────┬───────────────┬─────────────┘
                         │                   │            │                │
             ┌───────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
┌──────▼───────────────┐
             │ PostgreSQL        │ │ Redis       │ │ Cloudflare   │ │ Worker (BullMQ)
│
             │ (Neon, PITR) │ │ quotas/rate │ │ R2 objects        │ │ emails, report
PDFs, │
             │ system of         │ │ leaderboards│ │ photos/logos│ │ monthly
rollups,             │
             │ record            │ │ geo cache   │ │ share cards │ │ webhook
processing,          │
             └──────────────┘ │ job queue        │ └─────────────┘ │ trace audits
│
                                  └─────────────┘
└──────────────────────┘
                         │ outbound only, via provider adapters with cost logging
                         ▼
      Groq/OpenRouter (coach + meal vision) · ORS (routes, cached) · Razorpay
· Stripe ·
      RevenueCat (mobile IAP) · Resend/SES (email) · Expo Push · Sentry ·
PostHog
```

Key property: **the expensive, latency-sensitive loop (camera→feedback)
never crosses the network.** The server's job shrinks to identity, money,
persistence, social features, and metered third-party calls — all cheap,
all stateless, all horizontally scalable from day one.

---

## 4. Monorepo layout

pnpm workspaces + Turborepo. One repo, one CI, shared types everywhere.

```
ai-home-gym/
├── apps/
│     ├── api/                   # Fastify TS modular monolith (§6)
│     ├── web/                   # Existing Vite SPA, migrated in place (§13)
│     ├── mobile/                # Expo React Native app (§12)
│     └── dashboard/             # Gym owner dashboard (Vite SPA or /gym
routes in web) (§11)
├── packages/
│     ├── engine/                # THE Form Engine: pure TS, zero deps on
DOM/RN (§5)
│     │   ├── src/core/          # signals, FSM, fault evaluator, scorer,
calibration
│     │   ├── src/definitions/   # exercise definition JSONs + family
templates
│     │   └── test/traces/       # recorded keypoint sessions (golden files)
│     ├── shared/                # zod schemas, API types, api-client,
constants
│     └── config/                # eslint, tsconfig, prettier presets
├── ml-training/                 # research track (YOLO, ST-GCN, CTR-GCN) —
not deployed
├── infra/                       # docker-compose, Dockerfiles, Caddy config,
deploy scripts
└── .github/workflows/           # CI: typecheck, unit + golden-trace tests,
gitleaks, deploy
```

Rules: `packages/engine` imports nothing platform-specific (it must run in
browser, Hermes/RN, and Node test runner identically). `apps/*` never

import each other — only packages. All request/response shapes are Zod
schemas in `packages/shared`, consumed by both API (validation) and
clients (types) — one source of truth, no drift.

---

## 5. The Form Engine & Exercise Definition System (EDS)

This is the heart of the product and the answer to "58 exercises to go."
Full spec is **Part 2**; here is the architecture.

### 5.1 Pipeline (runs on-device, every frame)

```
PoseProvider (platform-specific)            @app/engine (shared, pure TS)
┌──────────────────────────┐   PoseFrame
┌───────────────────────────────────────┐
│ web: MediaPipe Tasks WASM│ ───────────► │ 1 normalize    (torso-scale,
visibility │
│ mobile: BlazePose native │   {t, 33 ×     │    gating, EMA smoothing)
│
└──────────────────────────┘   [x,y,z,vis]}│ 2 view classifier
(front/side/quarter)│
                                            │ 3 signal extractors (only the
signals │
                                            │    this definition declares)
│
                                            │ 4 calibration (standing
baseline etc.)│
                                            │ 5 rep FSM (phases +
hysteresis)       │
                                            │ 6 fault rules (phase-scoped
predicates│
                                            │    → severity, message key)
│
                                            │ 7 scorer (100 − Σ weighted
faults)     │

└───────────────┬───────────────────────┘
                                                            ▼

                                  UI events (rep++, live cue, voice) + SetSummary
→ sync (§5.3)
```

The canonical `PoseFrame` is BlazePose's 33-landmark layout on **both**
platforms — the engine never knows which platform produced it.

### 5.2 Exercise Definitions — exercises as data

A definition declares (sketch; full schema in Part 2):

```jsonc
{
    "key": "squat", "version": 4, "family": "squat_pattern",
    "views": ["front", "side"], "calibration": ["standing_baseline"],
    "signals": ["knee_angle_L", "knee_angle_R", "trunk_incline",
"valgus_delta", "hip_elevation"],
    "rep": { "metric": "knee_angle_min", "upAt": 160, "downAt": 100,
                 "countOn": "up", "minRepMs": 900, "maxRepMs": 12000 },
    "phases": ["standing", "descent", "bottom", "ascent"],
    "faults": [
         { "id": "shallow_depth",     "phase": "bottom",   "when": "knee_angle_min
> 120",
          "severity": 25, "msg": "fault.squat.depth" },
         { "id": "knee_valgus",       "phase": "descent|ascent", "view": "front",
          "when": "valgus_delta > 0.30", "severity": 30, "msg":
"fault.squat.valgus" },
         { "id": "trunk_lean",        "phase": "bottom",   "view": "side",
          "when": "trunk_incline > 50", "severity": 20, "msg":
"fault.squat.lean" }
    ],
    "scoring": { "base": 100, "floor": 20 }
}
```

- **Family templates**: `squat_pattern`, `hinge`, `lunge`,
`push_horizontal`, `push_vertical`, `pull`, `core_isometric`
(plank/wall-sit family — time-based FSM, not rep-based), `core_dynamic`,
`jump_plyo`, `mobility_stretch` (hold + ROM), `carry_gait`. Each template
supplies the FSM shape and default fault set; a concrete exercise is a

template + parameter overrides. 59 exercises ≈ 11 templates × parameter
files — a per-exercise effort of **hours, not weeks**, once the template
exists.
- **Delivered as a remote bundle**: `GET
/v1/exercise-definitions?since=<version>` (ETag-cached, signed). Clients
cache the bundle locally; new/updated exercises appear in installed mobile
apps **without a release**. Definitions carry `minEngineVersion` so an old
client simply doesn't show an exercise it can't run yet.
- **Message keys, not strings** (`fault.squat.depth`) → localization
(English/Hindi/Assamese) and voice cues come free (§21).
- Your existing `_analyze_squat` / jump / chair logic and the researched
thresholds translate 1:1 into the first three definitions + the
`standing_baseline` calibration module. **Nothing you validated is lost.**

### 5.3 What the server receives (the entire workout data contract)

At set end (or on app close), the client POSTs `POST /v1/workouts/sync`
with an `Idempotency-Key`:

```jsonc
{ "workoutId": "uuid-client-generated", "startedAt": "...", "platform":
"web",
    "engineVersion": "1.3.0", "defsVersion": 41,
    "sets": [{
      "exercise": "squat", "setIndex": 1, "reps": 12, "durationMs": 48000,
      "avgFormScore": 84, "repScores": [90,88,...],
      "faultCounts": { "shallow_depth": 2, "knee_valgus": 1 },
      "tempoMsAvg": 3900, "romStats": { "kneeMinAvgDeg": 96 }, "view":
"side"
    }],
    "traceSample": null   // occasionally a compressed keypoint clip — see
§14
}
```

~1–3 KB per workout instead of ~5–10 MB of streamed keypoints. Offline
clients queue summaries in local storage/SQLite and sync later;
idempotency keys make retries safe. **This endpoint replaces `pose_ws.py`
entirely.**

### 5.4 The golden-trace test harness — how "no bugs" actually happens

Add a dev-mode "record session" toggle that writes raw `PoseFrame` streams
to JSONL. Every exercise ships with 3–6 recorded real traces (good form,
each major fault, edge cases like partial visibility). CI replays every
trace through the engine and asserts exact rep counts, fault sets, and
score ranges. Any threshold tweak that would break squat counting fails
the build *before* a gym member ever sees it. This harness is also your
**parity gate** for the Python→TS port: record sessions against the
current server analyzer, then require the TS engine to match. Budget ~2
days to build the harness; it pays for itself the first week.

---

## 6. Backend — the modular monolith

**Stack:** Node 22 · Fastify · TypeScript · Zod (validation + OpenAPI
generation) · Drizzle ORM (SQL-first, typed migrations) · BullMQ · Pino
structured logs. One Docker image runs in two modes: `api` (HTTP) and
`worker` (queues) — same code, different entrypoint.

### 6.1 Module map

| Module | Responsibility | Notes |
|---|---|---|
| `auth` | email/password (argon2id), Google OAuth, JWT access (15 min) +
rotating refresh tokens (httpOnly cookie on web, SecureStore on mobile),
password reset, session revocation | Port of `backend-auth`, minus
Mongoose |
| `users` | profile, preferences, units, locale, onboarding data, account
deletion (DPDP) | |
| `gyms` | gym CRUD, join codes (rotate/expire), **seat enforcement**,
staff roles, branding | New |
| `entitlements` | resolves user → effective plan (own sub > gym
membership > free); one function the whole codebase calls | New; the
keystone |
| `quotas` | generalizes your `quotas.py`: limits read from plan
entitlements; Redis atomic counters; fail-open/closed per feature (keep
your philosophy verbatim) | Port + generalize |

| `billing` | plans, subscriptions, Razorpay + Stripe + RevenueCat webhook
normalization, invoices, dunning, trials | New (§10) |
| `exercises` | catalog + **definition bundle publishing/versioning** |
Replaces `exercises.py` + `seed_exercises.py` |
| `workouts` | `/sync` endpoint, workout/set/rep-aggregate storage,
history, PRs | Replaces `workouts.py` + `pose_ws.py` |
| `gamification` | streaks (+freeze tokens), XP, badges, challenges,
leaderboards (Redis ZSET + weekly snapshot) | Port
`badges.py`/`challenges.py` logic |
| `coach` | LLM gateway: Groq primary → OpenRouter fallback, prompt
versioning, per-call token budget, exact-match answer cache, **cost logged
per call** | Port; Chroma → `pgvector` in Postgres (one less service; your
KB is 5 docs — pgvector is more than enough) |
| `nutrition` | meal photo pipeline: client-compressed upload → R2
presigned → worker → vision model → macros; USDA lookup; photo auto-delete
after 30 days | Port `photo_analyzer.py`/`usda.py` |
| `geo` | route generation via ORS, **two-layer geocode cache** (Redis LRU
+ Postgres persistent, keyed on coords rounded to 3 decimals ≈ 110 m),
weather | Port `routing_provider.py`; cache is mandatory |
| `reports` | monthly gym usage PDF + email, at-risk member computation |
New (§11) |
| `notifications` | Expo push tokens, email (Resend/SES), template
registry, per-user daily caps | New |
| `webhooks` | signature verification, `webhook_events` dedupe table,
enqueue-then-ack pattern | New |
| `analytics` | server-side PostHog event emission for money/entitlement
events | New |
| `admin` | your internal panel: gyms, cost dashboard, circuit-breaker
status, definition publishing, user support | New; can be a simple
protected SPA |

### 6.2 Conventions that keep the monolith modular

- Each module = `routes.ts` (thin), `service.ts` (logic), `repo.ts` (only
file allowed to touch DB), `schemas.ts` (Zod), `events.ts`. Modules call
each other **only** via service interfaces or domain events on an
in-process emitter (bridged to BullMQ for async) — never reach into
another module's tables. This discipline is what lets you extract a module
into its own service in 2030 without archaeology.

- Every route: Zod-validated input, entitlement check, quota check where
metered, rate limit (per-user + per-IP, Redis). OpenAPI spec is generated
from the Zod schemas; `packages/shared` exports the typed client from it.
- API versioned at `/v1`; cursor pagination; `Idempotency-Key` honored on
`/workouts/sync` and all payment-adjacent POSTs.

---

## 7. Data architecture

### 7.1 PostgreSQL — system of record (core tables; full DDL in Part 4)

**Identity & tenancy:** `users`, `refresh_tokens`, `gyms`, `gym_codes`
(code, seat-aware, expiry, rotation), `gym_members` (unique gym+user,
status, joined_at — **a row = a seat**), `gym_staff`
(owner/manager/trainer).

**Money:** `plans` (code, audience consumer|gym, price_minor, currency,
interval, `seat_cap`, `entitlements JSONB`, active), `subscriptions`
(owner_type user|gym, owner_id, plan_id, status
trialing|active|past_due|canceled, trial_ends_at, period_end, provider,
provider_ref), `invoices`, `webhook_events` (provider+event_id **unique**
— dedupe), `api_cost_events` (user_id, gym_id, feature, provider, units,
cost_micro, at) — powers the circuit breaker (§9.3) and your margin
dashboard.

**Product:** `exercises` (catalog: slug, family, difficulty, equipment,
muscles, status live|beta|dev), `exercise_definitions` (exercise_id,
version, `definition JSONB`, min_engine_version, published_at),
`workouts`, `workout_sets` (per-set aggregates incl. `fault_counts JSONB`,
`rep_scores smallint[]`), `runs` (mobile: distance, duration, polyline,
splits), `meal_logs`, `coach_threads`/`coach_messages` (with token+cost
columns), `streaks`, `user_achievements`,
`challenges`/`challenge_participants`, `leaderboard_snapshots` (weekly
persistence of Redis boards), `usage_daily` (nightly rollup of Redis quota
counters — feeds gym reports & analytics), `gym_usage_reports`,
`push_tokens`, `audit_log`, `feature_flags`, `trace_samples` (R2 key +
verdict, §14).

Design notes: per-rep detail lives as arrays/JSONB *inside* `workout_sets`
(aggregates are what every screen reads) — no billion-row `rep_events`
table until a real need appears. `workouts` is partitioned by month from
day one (cheap now, painful later). Nightly job prunes free-tier history
>90 days per plan entitlement.

### 7.2 Redis map

`quota:{feature}:{user}:{yyyymmdd}` counters (your existing pattern) ·
`rl:*` rate limits · `lb:gym:{id}:{month}:formscore` ZSETs (+ global
boards) · `geo:{lat3}:{lng3}` geocode cache · `costs:gym:{id}:{month}`
running counter for the circuit breaker · BullMQ queues (`emails`,
`reports`, `webhooks`, `rollups`, `traces`). Redis is **rebuildable** —
nothing lives only in Redis except in-flight counters that also roll up
nightly to `usage_daily`.

### 7.3 R2 buckets & lifecycle

`meal-photos/` (client-compressed ≤ 300 KB, EXIF-stripped, presigned PUT,
**auto-delete 30 days**) · `gym-assets/` (logos) · `share-cards/`
(generated, 7-day lifecycle) · `reports/` (gym PDFs, 18 months) ·
`traces/` (sampled keypoint clips, 90 days). Presigned URLs only; bucket
never public-listed.

### 7.4 Mongo → Postgres migration (one-time)

You have no paying users yet — migrate now while it's a script, not a
project: (1) freeze writes, (2) export `users` (keep bcrypt hashes;
verify-then-upgrade to argon2id on next login), workouts, gamification
state via a Node script mapping ObjectId→UUID with a lookup table, (3)
re-seed exercises from the new catalog, (4) run both reads for one week
behind a flag if paranoid, (5) decommission Mongo. Chroma is not migrated
— re-ingest the 5 knowledge docs into pgvector (minutes).

---

## 8. Tenancy, roles & entitlements

**Roles:** `user` · `gym_owner` · `gym_staff` (trainer/manager) · `admin`
(you). A person can hold several (an owner is also a user with workouts).

**Join flow:** gym owner signs up → creates gym → gets a join code + QR
poster (auto-generated PDF). Member enters code at registration or in
Settings → a `gym_members` row is created **iff seats remain** (`SELECT
count(*) ... FOR UPDATE` inside a transaction — the seat cap is enforced
by the database, not by hope). Seat full → member sees "ask your gym to
upgrade", owner sees an upgrade prompt: your cost ceiling doubles as your
upsell mechanism, exactly as designed in our earlier discussion.

**Entitlement resolver — the one function everything calls:**

```
effectivePlan(userId):
  own = active|trialing consumer subscription    → its plan
  gym = active gym_members row whose gym has active|trialing subscription
→ gym member plan
  return highest of (own, gym, FREE)            # cached in Redis 60s,
busted on billing/membership events
```

Every feature gate, quota limit, exercise-library filter, and history
window reads `effectivePlan`. Nothing else in the codebase is allowed to
reason about billing. When a member leaves a gym (or the gym churns), they
silently degrade to `free` and get a win-back prompt for Pro — the B2B→B2C
conversion funnel from our earlier discussion, implemented in one code
path.

---

## 9. Plans, pricing & quotas (config, not code)

### 9.1 Consumer plans

| | **Free** (permanent) | **Pro** ₹149/mo · ₹999/yr (IN) / $3.99/mo ·
$29.99/yr (intl) |
|---|---|---|
| Form-checked exercises | **12 foundational** (one per family: squat,
chair squat, lunge, push-up, plank, glute bridge, ...) — **unlimited
sessions & reps** | All 59 |
| Workout logging, streaks, badges |   ✅ unlimited | ✅ |

| History | 90 days | Forever + advanced analytics, PR timeline |
| AI Coach | 5 questions/mo | 30/day |
| Meal photo analysis | 3/mo | 8/day |
| Route generation | 2/mo | 5/day |
| Programs (multi-week plans) | 1 starter program | All |
| Share cards |   ✅ (small watermark → free marketing) | ✅ no watermark |
| Leaderboards | view + gym boards | + global boards |

Rationale, per your instruction: everything with ~zero marginal cost
(on-device form checking, logging, streaks) is free and **feels
unlimited** — a free user doing 12 exercises every single day never hits a
wall, so no "limit reached too soon" resentment. The three features that
cost you real money per use are exactly the three that are metered, with a
monthly *taste* so free users experience them before paying. No consumer
time-trial — the free tier IS the funnel and your live gym demo (this
converts better for unknown solo apps than 7-day trials, per our earlier
discussion).

### 9.2 Gym plans (tiered flat fee, seat-capped in code)

| Plan | Seats | Price | Notes |
|---|---|---|---|
| Starter | ≤ 100 | ₹1,499/mo | The Jorhat-gym "yes" — most Assam gyms fit
here |
| Standard | ≤ 150 | ₹1,999/mo | |
| Growth | ≤ 400 | ₹3,499/mo | |
| Scale | 400+ | ₹4,999/mo → custom | |

Every gym member gets **Pro-level entitlements** (daily quotas above)
through the gym's subscription. **Gym trial: 7 days, full features,
self-serve** (your spec) — trial length is a column on `plans`, and you
(admin) can issue extended **pilot codes** (30–60 days) for the first
hand-sold gyms, reconciling the "free for 2 months for gyms #1–3" strategy
without special-casing code. Day-5 trial email + dashboard countdown
banner drive conversion. Fair-use policy text (30 coach / 8 photo / 5
route per member per day) ships in the gym agreement — the gym points
members at the policy, not at you.

### 9.3 Quota engine & cost guardrails

- Limits come from `plans.entitlements` JSON — change a number in the DB,
it's live. Your Redis `INCR`+TTL pattern and fail-open (coach) /
fail-closed (vision, ORS) split are kept exactly.
- Friendly 429s with reset time; clients show "resets tomorrow" not an
error.
- **Every** external API call writes an `api_cost_events` row and bumps
`costs:gym:{id}:{month}`. Alert to you (email/Telegram) at ₹800/gym/month;
soft-degrade (queue meal photos, keep coach on smallest model) only past
3× the gym's fee — you will likely never see it fire, but
bankruptcy-by-API-bill is now mathematically impossible.
- Admin cost dashboard: spend by feature/provider/gym vs. revenue — your
unit economics live on one screen.

---

## 10. Payments architecture

| Surface | Provider | Mechanics |
|---|---|---|
| Consumer, web, India | **Razorpay Subscriptions** (UPI Autopay / cards)
| You already know Razorpay from the travels app |
| Consumer, web, international | **Stripe Billing** ($ prices) | |
| Consumer, mobile | **RevenueCat** over Apple/Google IAP | Store rules
require IAP for consumer digital subs; RevenueCat normalizes receipts +
entitlements and posts webhooks like the others |
| Gyms (B2B) | **Razorpay Subscriptions** (web dashboard only — never in
the mobile app, keeping B2B outside store commission entirely) |
e-mandate/UPI Autopay; invoice PDFs auto-emailed |

Principles: **entitlements are only ever read from our `subscriptions`
table** — all three providers converge through the `webhooks` module
(verify signature → dedupe on `webhook_events` → enqueue → worker updates
subscription state → busts entitlement cache → emits analytics event).
Payment webhooks are the most bug-prone surface in this entire system; the
dedupe-and-queue pattern plus idempotent handlers is non-negotiable.
Dunning: `past_due` grace of 5 days with email/push nudges, then downgrade
to free (never delete data). Full flows, plan-change proration, and refund
policy: **Part 5**.

---

## 11. Gym Dashboard v1 (owner-facing web)

Responsive web app (owners will open it on phones — do not build a native
dashboard). Screen map — full spec with every widget's data contract is
**Part 3**:

1. **Overview** — KPI cards: active members 7d/30d · workouts this week ·
**adoption % (active/seats)** · avg form score; 8-week trend chart;
trial/renewal banner; **at-risk list** (members inactive 14+ days, with a
one-tap "we miss you" push) — this list is the owner's churn weapon and
your renewal argument in one widget.
2. **Members** — table (name, joined, last active, workouts 30d, avg form
score), seat meter (e.g. 87/150), invite via code + QR-poster PDF
download, remove member (frees seat).
3. **Leaderboard** — monthly form-score & volume boards; **TV mode**
(fullscreen rotating URL for the gym's lobby screen); printable monthly
poster PDF for the notice board. Costs you ~nothing; owners love it; it
markets the app inside the gym for you.
4. **Reports** — auto-generated monthly PDF (actives, workouts, top
members, trend) archived + emailed; this is the "X of your members used
it, Y workouts logged" renewal ammunition from our earlier discussion.
5. **Billing** — plan & seat tier, trial countdown, invoices, upgrade
(self-serve seat-tier bump), payment method.
6. **Settings** — gym profile/logo (appears on members' dashboards + share
cards), join-code rotation, staff management, notification prefs.

Owner onboarding is a 5-minute wizard: gym name/city → logo → seats tier →
payment (or trial) → print poster. **Time-to-first-member-joined is the
metric that predicts gym retention** — instrument it.

---

## 12. Mobile app architecture (Expo React Native)

- **Build system:** Expo + **EAS dev-client / development builds — not
Expo Go.**   ⚠️ This changes your current workflow: camera frame processors
and pose models are native modules that Expo Go cannot load. You'll
install a custom dev build APK on your Android device once, then iterate
with the same fast-refresh you have today. EAS Build handles native

compilation in the cloud (no local Android Studio pain); EAS Update gives
OTA JS updates post-launch.
- **Pose pipeline:** `react-native-vision-camera` frame processors →
BlazePose (via a MediaPipe RN wrapper or `react-native-fast-tflite` with
the BlazePose model — run a 2-day spike, pick whichever hits the bar) → 33
landmarks → **the same `@app/engine`**. Acceptance bar: ≥20 fps sustained
and thermally stable for a 20-minute session on a mid-range Android (test
on your device + one ₹12k-class phone). Landmarks stay in worklet-land;
only rep/fault events cross the JS bridge.
- **Offline-first:** `expo-sqlite` mirrors workouts/definitions; a sync
queue flushes `SetSummary`s (idempotent, so retries are safe) and pulls
the latest definition bundle on connectivity. A member in a basement gym
with zero signal gets a **full** workout experience — a genuine
differentiator in Tier-2/3 India.
- **Running (mobile-only):** `expo-location` background tracking +
TaskManager, polyline recorded locally, route-name geocoding on save
(cached, quota'd), splits/score computed on device (port `scoring.py` into
`@app/engine`). Web keeps route *browsing* of past runs but hides live
tracking behind a platform capability flag, replaced by an "available in
the app" install prompt (this drives app installs — don't delete the web
pages, flag them).
- **Everything else** (auth, coach, nutrition, gamification, dashboard)
reuses `packages/shared` API client + React Query — the screens you
already built in React translate to RN screen-by-screen.
- Payments: RevenueCat SDK; entitlements still resolved server-side. Push:
`expo-notifications`. Crash/error: Sentry RN. Store note: on-device
processing is also your App Store privacy story — "video never leaves your
device."

## 13. Web app — what changes in the existing SPA

Keep React 18 + Vite (no Next.js migration — churn without payoff; add a
small static marketing/SEO site later, separately). Changes: (1)
`usePoseDetection` stops opening a WebSocket and instead feeds frames to
the local `@app/engine` — the hook's public API barely changes,
`ActiveWorkout.jsx` mostly doesn't notice; (2) new sync call on set end;
(3) new pages: Paywall/Plans, Join-gym-code, Account/Billing; (4) gym
dashboard app; (5) PWA manifest + service worker (installable, definition
bundle cached offline); (6) delete `FormClassifier.js`/ONNX from the
bundle (research track); (7) split the two giant pages when next touched.

---

## 14. Anti-cheat & leaderboard integrity (the price of D1)

Moving analysis client-side means a hostile client *could* POST fake
summaries. Mitigations, layered:

1. **Server plausibility validation** on every sync: rep cadence within
human bounds (from the definition's `minRepMs`/`maxRepMs`), session
duration vs. rep math, score distributions not impossibly perfect, daily
volume sanity. Violations → accepted but flagged `unverified` (never a
user-facing error — false positives must not punish real users).
2. **Sampled trace audits:** clients occasionally attach a compressed
10-second keypoint clip (~50 KB) with a set; a worker replays it through
the *server's copy of the same engine* and compares. Mismatch → flag
account. Sampling ~1 set per user-week costs pennies and makes systematic
cheating detectable.
3. **Scope integrity where it matters:** gym leaderboards are socially
self-policing (people know each other); **global** boards and any future
prize challenges show verified users only. Personal history is never
blocked — someone determined to lie to their own progress chart is welcome
to.

This is the same trust model every client-side fitness app (step counters
included) lives with; the summaries + sampled audits give you *more*
verification than most.

---

## 15. Notifications & messaging

- **Push (Expo)** and **email (Resend or SES)** behind one `notifications`
module with a template registry and per-user **daily cap + quiet hours** —
engagement notifications capped at 1/day; nothing erodes retention like
notification spam.
- Core sends: workout-streak nudge (only if streak ≥3 and about to break),
weekly recap (stats + form-score delta), PR celebration, trial-day-5
(gyms), payment failed, monthly gym report to owners.

- **WhatsApp** (Business API via a BSP — Gupshup/Interakt) is Phase-2 but
architected now: gym owners in Assam live on WhatsApp; monthly report +
at-risk alerts via WhatsApp will outperform email dramatically. The
`notifications` module treats it as one more channel adapter.
---

## 16. Analytics & product metrics

PostHog (cloud free tier) on all three surfaces + server-side for money
events. Starter event taxonomy (name → key properties): `signup` (source,
gym_code?), `workout_started`/`workout_completed` (exercise count,
platform), `exercise_completed` (slug, reps, avg_score), `paywall_viewed`
(trigger), `subscribe_activated` (plan, provider), `coach_msg_sent`,
`meal_logged`, `gym_code_redeemed`, `gym_trial_started`/`gym_converted`,
`share_card_created`, `app_installed_from_web_prompt`. North-star:
**weekly active workout users**; guardrails: D7/D30 retention, free→Pro
conversion, gym adoption %, gym 3-month logo retention. Ship the taxonomy
with the first release — you cannot retrofit the funnel data you'll need
for gym pitches.

## 17. Observability & reliability

- **Sentry** on api, worker, web, mobile (release-tagged; engine version
attached to every event).
- **Pino structured logs** with request IDs → Better Stack/Axiom free
tier; log every quota denial, circuit-breaker event, webhook, and sync
rejection with reasons.
- **Uptime checks** (Better Stack) on `/health` (checks DB+Redis) and the
definition-bundle endpoint.
- **Backups:** Neon PITR (continuous) + nightly `pg_dump` to R2; **monthly
restore drill into staging** — an untested backup is a rumor. Redis is
rebuildable by design (§7.2); R2 is versioned.
- Targets to hold yourself to: API p95 < 250 ms; sync success ≥ 99.9%;
crash-free mobile sessions ≥ 99.5%. When a target is breached two weeks
running, that — not vibes — is your signal to spend on infra.

## 18. Security & privacy

**Immediate (before any other work):** rotate every credential in the
committed `.env` files (Groq, Google OAuth secret, ORS, JWT secrets, SMTP,
Mongo); purge them from git history; add Gitleaks to CI.

Ongoing: argon2id passwords · short-lived JWT + rotating refresh with
reuse detection · Zod on every input · per-user and per-IP rate limits
(keep your `trust proxy` lesson) · helmet/CORS strict · presigned uploads
with size/content-type limits · webhook signature verification everywhere
· RBAC middleware from `gym_staff` roles · audit_log on money/admin
actions · secrets via platform env (Doppler if it grows).

**Privacy is a selling point, not a chore:** video frames never leave the
device — only stick-figure landmarks (sampled, consented) and numeric
summaries. Put this sentence on the landing page, in the gym agreement,
and in the app-store listing. India's **DPDP Act** compliance: consent
screen at camera first-use, purpose limitation, in-app account deletion
(already in `users` module), meal-photo auto-deletion (§7.3), data-export
endpoint.

## 19. Deployment, environments & cost

| Piece | Choice | Monthly (early) |
|---|---|---|
| API + worker | 1× Hetzner VPS (CX32-class), Docker Compose: `caddy`
(TLS) + `api` + `worker` | ~₹700–1,200 |
| Postgres | Neon (managed, PITR, branching for staging) | ₹0 → ~₹1,700 |
| Redis | Upstash (pay-per-request) | ~₹0–400 |
| Web + dashboard | Vercel | ₹0 |
| Objects/CDN | Cloudflare R2 + CDN | ~₹0–200 |
| Email / Push / Sentry / PostHog | free tiers | ₹0 |
| **Total** | | **≈ ₹1,000–3,500/mo** — profitable from gym #1–2, exactly
as the earlier unit-economics discussion concluded |

**Environments:** `dev` (docker-compose: pg+redis local) → `staging` (Neon
branch + tiny VPS or same VPS second compose project) → `prod`. **CI
(GitHub Actions):** typecheck → unit tests → **golden-trace engine tests**
→ Gitleaks → build images → migrate (Drizzle, expand-then-contract only) →
deploy staging → manual promote to prod. Mobile: EAS Build + EAS Update
channels (staging/prod).

## 20. Scale path — what changes, and the trigger for each

| Stage | Users | Change | Trigger |
|---|---|---|---|
| 0 | 0–2k | Ship as §19. Nothing else. | — |
| 1 | ~10k | Bigger VPS **or** 2× API containers behind Hetzner LB
(stateless already — flip a switch); Neon autoscale; move worker to own
container | p95 > 250 ms sustained or CPU > 70% |
| 2 | ~50k | Postgres read replica for dashboards/reports; CDN-cache
definition bundle at edge; dedicated worker node | DB CPU > 60%; report
queries visible in p95 |
| 3 | 100k+ | Partition-prune old workout partitions to cold storage;
consider extracting `billing` + `coach` modules to services (boundaries
already clean); multi-region CDN | Sustained growth + revenue to fund it |

The honest big-tech secret: because the hot loop is on-device, **your
server load grows with sign-ups, not with reps**. A 100k-user fitness app
here is a mid-size CRUD app anywhere else. Do not build Stage 3 at Stage
0.

---

## 21. Retention & growth features (ranked — impact ÷ effort)

Existing features all survive; these compound them.   ✅ = partially exists
today (port it), ★ = new.

| # | Feature | Why it retains/attracts | Effort |
|---|---|---|---|
| 1 | ★ **Form Score™ + weekly delta** | Your proprietary metric — "84 →
88 this week" makes invisible progress visible; no competitor without pose
tech can copy it. Anchor of dashboard, recaps, share cards. | S (data
already computed) |
| 2 |   ✅ **Streaks + freeze tokens** | Streaks retain; freezes (earn
1/week of activity, auto-spend on a miss) prevent the rage-quit when life
happens. | S |
| 3 | ★ **Gym leaderboard + lobby TV mode + monthly poster** | Retention
theater inside the gym; markets the app to non-users on the gym floor; the
owner's favorite feature. | S–M |

| 4 | ★ **Challenges** — personal (30-day squat), gym-wide, and
**gym-vs-gym city leagues** | Social pressure = retention; gym-vs-gym
gives owners bragging rights and gives you a B2B sales hook ("join the
Jorhat league"). | M |
| 5 | ★ **WhatsApp-ready share cards + referral**
(give-a-month/get-a-month) | Auto-generated workout/PR image sized for
WhatsApp status — your zero-budget growth channel in India; watermark on
free tier. | S–M |
| 6 | ★ **Programs** (4-week structured plans built from your 59) |
People don't retain on exercises; they retain on *plans* with a visible
finish line. Reuses WorkoutBuilder. | M |
| 7 |   ✅ **PR celebrations + badges** (port `badges.py`) | Cheap dopamine,
real effect. Confetti on PR, milestone shares. | S |
| 8 | ★ **Weekly recap** (email/push; later WhatsApp) | Re-engagement
rhythm; contains Form Score delta + streak status. | S |
| 9 | ★ **At-risk member alerts for gym owners** | Retention *for the
gym* = renewals *for you*; unique B2B value no consumer app offers. | S
(query + notification) |
| 10 | ★ **Assamese + Hindi localization** | Fault messages are already
keys (§5.2) → cheap; a real differentiator and demo-day wow in Tier-2/3
India. | M |
| 11 |   ✅ **Voice coach** (port `voice.js`; cues from message keys) |
Hands-free correction mid-set is the "it's actually watching me" moment. |
S |
| 12 | ★ **Trainer mode (Phase 2):** trainers assign programs, view
members' form trends; later, live-view a member's session (this is where a
WebSocket *earns* its way back) | Converts trainers from threat to
champion — answers the #1 gym objection head-on. | L |
| 13 | ★ **Offline mode (mobile)** (§12) | "Works in any basement gym" —
say it in every pitch. | M (in mobile plan) |
| 14 | ★ **Rest timer + plate calculator + workout notes** | Small QoL
that makes it the *only* app open during a session. | S |

Sequencing: 1, 2, 5, 7, 8 ship with v1 (all Small); 3, 9 ship with the gym
dashboard; 4, 6, 10, 11 in the following cycle; 12 after 5+ paying gyms
ask for it.

---

## 22. Build sequence (solo-dev realistic; each phase ends demoable)

**Phase 0 — Foundation (Week 1).** Rotate secrets; purge history. Monorepo
scaffold, CI (typecheck/tests/Gitleaks), Postgres schema v1 migrations,
envs, Sentry, PostHog. ✔ *Done when: CI green, staging deploys on merge,
`/health` is up.*

**Phase 1 — The Engine (Weeks 2–4). The keystone phase.** Build
`@app/engine` (normalize → view → signals → FSM → faults → score) +
definition schema + **golden-trace harness**. Record real traces against
the current Python analyzer; port squat/jump-squat/chair-squat as
definitions; require parity. Swap `usePoseDetection` to the local engine;
implement `/v1/workouts/sync`; delete the WS path. ✔ *Done when: all
traces pass in CI; a full workout works with the API server switched off,
then syncs.*

**Phase 2 — One backend (Weeks 4–6).** Auth module (port),
users/workouts/progress/gamification modules, entitlement resolver,
generalized quotas, Mongo→PG migration script, coach/nutrition/geo ports
behind quota gateway with cost logging + geocode cache. Decommission both
old backends. ✔ *Done when: web app runs 100% on the new API; old
services are off; cost dashboard shows real numbers.*

**Phase 3 — Money & gyms (Weeks 6–8).** Plans/subscriptions/webhooks
(Razorpay + Stripe), consumer paywall + billing pages; gym onboarding
wizard, codes + DB-enforced seats, staff roles; **Dashboard v1**
(Overview, Members, Billing) + monthly report job + at-risk list; pilot
codes. ✔ *Done when: a stranger can pay you for Pro, and a gym can
self-serve trial→pay with members joining by code.*

**Phase 4 — Exercise production line (Weeks 8–10, then ongoing).** Build
the remaining family templates; then it's an authoring pipeline: pick
exercise → parameterize template → record 3–6 traces → CI green → publish
to bundle. Target **2–3 validated exercises/week**; reach **10–12 solid**
(the gym-demo bar from our earlier discussion) before pitching.
Leaderboards + TV mode + share cards ship here. ✔ *Done when: 12
exercises live via remote bundle, none hand-coded.*

**Phase 5 — Mobile (Weeks 10–14).** EAS dev-client, pose-pipeline spike (2
days, pick winner), screens ported on shared packages, offline sync,
running feature, RevenueCat, closed Android test with your first gym's

members. ✔ *Done when: a member does a full offline workout on a
mid-range Android at ≥20 fps and it syncs later; running records a real
route.*

**Phase 6 — Pilots & polish (ongoing).** 2–3 Jorhat gyms on pilot codes;
watch adoption %, weekly recaps on, iterate on Dashboard from owner
feedback; keep the exercise line running toward 59.

Order rationale: the engine (P1) de-risks everything — every later phase,
the mobile app, and all 56 remaining exercises depend on it; money (P3)
comes before exercise volume because our earlier analysis stands: gyms buy
on 10 solid exercises, not 59, and you want billing battle-tested before
the first renewal.

---

## 23. What we spec next (one at a time, as you asked)

| Part | Deliverable |
|---|---|
| **2** | **Form Engine & EDS — full spec:** definition JSON-schema,
signal library, FSM semantics, fault-DSL grammar, all 11 family templates,
the complete 59-exercise mapping (template + parameters each), trace
harness design, authoring workflow |
| 3 | Gym Dashboard — every screen, widget, query, and empty/edge state |
| 4 | Database — full DDL, indexes, partitioning, Mongo→PG migration
scripts |
| 5 | Billing & entitlements — provider flows, webhook state machines,
proration, dunning, edge cases |
| 6 | Mobile — pose-pipeline spike plan, offline sync protocol,
store-listing/privacy checklist |
| 7 | Retention playbook — exact mechanics, copy, and triggers for §21
features |
| 8 | Ops runbook — deploy, incident basics, backup drills, launch
checklist |

Recommended next: **Part 2** — it's the keystone and the longest lead
time.

*— End of Architecture v1.0 —*

# AI Home Gym — Part 2: The Form Engine & Exercise Definition System (EDS)

**Full engineering specification · v2.1 · follows Architecture v1 (§5, §22
Phase 1, §23 Part 2)**
**Audience:** Kd (solo developer, owner)
**Status:** This is the keystone spec. Every later deliverable — the
mobile app, all remaining exercises, offline mode, anti-cheat, and the gym
demo — depends on what is defined here. It is written to be followed
without needing the v1 doc open, but it never contradicts v1.

**Changelog v2.1** (evidence-verified reconciliation): catalog corrected
to the definitive **58 exercises** from `scripts/seed_exercises.py` —
media-alias ghosts removed (`soldierpress`, `hamstring` were Shoulder
Press / Hamstring Stretch media, confirmed by decoding GIF frames), five
genuinely missing entries added (Warrior II, Bridge Pose, Arm Circles,
Mountain Pose, Brisk Walking), `tracking: "pose"|"timer"` field added to
the schema, Appendix B converted to a resolved evidence log, §9.1 gains
the formal video-derived threshold protocol, §8.2 gains the dead-ONNX
cleanup item. Companion document: **Part 2B — The Trust Layer** (calories,
meal-photo portions, recommendations, predictions).

---
