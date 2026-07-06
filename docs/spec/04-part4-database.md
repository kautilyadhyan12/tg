<!--
Part 4 — Database: full DDL, indexes, lifecycle, Mongo→PG migration
Extracted from aihomegym.pdf (pdftotext). Hard line-wraps and occasional
table/DDL wrapping are extraction artifacts, not content changes. When an
exact value (price, threshold, SQL) looks garbled, verify against the PDF.
This file is spec — BINDING. Do not modify; record deviations in DECISIONS.md.
-->

# Part 4 — Database: Full Schema (DDL), Indexes, Lifecycle & the
Mongo→Postgres Migration

**Prerequisites:** Architecture v1 (§7 data sketch, §8 tenancy) · Part 2
(SetSummary §2.4, definition versioning §9) · Part 2B (`calc_version`,
dishware/corrections §3.4) · Part 3 (org columns §2.1, rollups §3.2,
visibility boundary §2.4).
**What this is:** the system of record, table by table, with the indexes
justified by the exact queries that read them, the canonical SQL for the
four make-or-break operations (entitlement, seat, rollup, at-risk),
retention & DPDP mechanics, and the one-time Mongo→Postgres migration
mapped against your **actual collections** (`users, workout_sessions,
workout_templates, meal_logs, coach_conversations, running_sessions,
running_routes, running_schedules, body_measurements, exercises`).

## 0. Amendments to earlier parts (recorded once, here)

1. **Partition-ready, not partitioned** (supersedes v1 §7.1 "partitioned
by month from day one"). Declarative partitioning forces the partition key
into every PK/FK and pushes Drizzle into hand-written SQL for the two
hottest tables — real, permanent complexity — while the thing it buys
(cheap archival of old months) matters only at Stage 2–3 scale (v1 §20).
Instead: `workouts`/`workout_sets` are designed so partitioning bolts on

later without schema change (time column `NOT NULL`, BRIN-indexed, no
cross-month FK assumptions), and §3.5 includes the exact pg_partman recipe
with its trigger: **table > 50 GB or autovacuum falling behind two weeks
running.** Nothing else in the doc set changes.
2. **Free-tier history is an access gate, not a deletion** (supersedes v1
§7.1's "nightly job prunes free-tier history > 90 days"). Aggregate-only
rows cost ~2 KB/workout; deleting them destroys an upsell ("upgrade and
your full history is *still there*") to save pennies, and contradicts Part
3 §4.2's "data is never deleted" promise to orgs. The 90-day window is
enforced in the workouts repo's read path from
`entitlements.history_days`; hard deletion happens only via account
deletion (§5.2). One less destructive cron to fear.
3. **`workouts` carries no `gym_id`** (supersedes v1 §7.1's `gym_id null`
column). Part 3 §2.1's membership-interval rule makes stored attribution
both redundant and wrong (multi-org members, join/leave/rejoin). Org
attribution is always computed through `gym_members` validity intervals
and materialized once, in `org_daily_stats`.
4. **Money-unit law.** User-facing money = `*_minor` integer + `currency`
(paise/cents). Internal cost telemetry = `cost_micro` bigint + `currency`
(default `USD`, since LLM/vision bill in USD; the v1 §9.3 circuit breaker
converts with one config FX rate). The words *minor* and *micro* in a
column name are load-bearing; nothing stores floats for money.

## 1. Conventions (every table obeys these; deviations are called out
inline)

- **IDs:** `uuid PRIMARY KEY DEFAULT gen_random_uuid()` everywhere
(client-generated for `workouts` — that *is* the sync idempotency). Human
handles (`slug`, `code`) are separate unique columns.
- **Time:** `timestamptz` only, UTC stored; org-local day boundaries
computed in the rollup worker per `gyms.timezone` (Part 3 §3.2);
`created_at timestamptz NOT NULL DEFAULT now()` on every table (not
repeated below).
- **Enums:** `text` + `CHECK (col IN (...))`, never PG enums — adding a
state is a one-line migration, not an `ALTER TYPE` ceremony.
- **JSONB policy:** JSONB is for *documents the app treats as a value* (a
definition, a report payload, entitlements) — never for anything
filtered/joined/aggregated in SQL. If a query needs `WHERE payload->>'x'`,
that field earns a column.

- **Deletion policy:** soft state columns (`removed_at`, `status`) for
anything with history semantics; hard `DELETE` only in the DPDP cascade
(§5.2) and TTL sweeps (§5.1). `ON DELETE` defaults to `RESTRICT`;
`CASCADE` appears only where a child is meaningless without its parent
(sets→workout, messages→thread) — each is flagged.
- **Multi-tenancy:** no Postgres RLS — one app role, tenancy enforced in
module repos per v1 §6.2 (RLS would double every query's planning cost to
defend against a caller that doesn't exist; revisit if the API is ever
multi-role).
- **Extensions:** `pgcrypto` (gen_random_uuid), `citext` (emails),
`vector` (§3.7).
- **Drizzle discipline:** this document is the source of truth; Drizzle
schema files mirror it 1:1; migrations are generated, human-reviewed as
SQL, **expand-then-contract, forward-only** (no down-migrations in prod),
one migration per PR, CI runs them against a Neon branch.

## 2. Domain map

```
identity ── users ─ auth_identities ─ refresh_tokens
tenancy   ── gyms ─ gym_codes ─ gym_members ─ gym_staff
money     ── plans ─ subscriptions ─ invoices ─ webhook_events
catalog   ── exercises ─ exercise_definitions ─ definition_bundles
training ── workouts ─ workout_sets · workout_templates
trust     ── meal_logs ─ user_dishware ─ meal_log_corrections ·
body_measurements
coach     ── coach_threads ─ coach_messages · kb_chunks(pgvector)
game      ── streaks · achievements ─ user_achievements · challenges ─
participants · leaderboard_snapshots
geo       ── runs · saved_routes · run_schedules · geo_cache
metering ── usage_daily · api_cost_events
org-analytics ── org_daily_stats · org_member_stats(view) ·
gym_usage_reports
ops       ── push_tokens · feature_flags · audit_log · trace_samples
```

---

## 3. DDL by domain

### 3.1 Identity & auth

```sql
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email citext UNIQUE,                             -- null allowed:
OAuth-only accounts
 password_hash text, hash_algo text CHECK (hash_algo IN
('bcrypt','argon2id')),
 display_name text NOT NULL,                      -- leaderboard identity;
profanity-filtered at write
 leaderboard_opt_out boolean NOT NULL DEFAULT false,     -- Part 3 §4.4
 locale text NOT NULL DEFAULT 'en', units text NOT NULL DEFAULT 'metric',
 timezone text,                                   -- recaps only; quotas
stay UTC (v1)
 weight_kg numeric(5,2),                          -- calorie lever (2B
§2.3); history in body_measurements
 status text NOT NULL DEFAULT 'active' CHECK (status IN
('active','deleted')),
 deleted_at timestamptz,
 legacy_mongo_id text UNIQUE,                     -- migration traceability
(§7); drop after 6 months
 last_active_at timestamptz
);
CREATE TABLE auth_identities (                    -- Google today; providers
later
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider text NOT NULL, subject text NOT NULL,
 UNIQUE (provider, subject)
);
CREATE TABLE refresh_tokens (                     -- rotation + reuse
detection (v1 §6.1)
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 family_id uuid NOT NULL,                         -- a login session; reuse
of a revoked member kills the family
 token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, replaced_by
uuid,

 ip inet, user_agent text
);
CREATE INDEX ON refresh_tokens (user_id, family_id);
```
*Reads that shape this:* login by email; OAuth by (provider,subject);
refresh by token_hash; "log out everywhere" by user_id. bcrypt→argon2id
upgrade happens on successful login (verify with `hash_algo`, rehash, flip
— §7).

### 3.2 Organizations & membership

```sql
CREATE TABLE gyms (                               -- the org table; name
kept for continuity (v1 §8)
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 slug text UNIQUE NOT NULL, name text NOT NULL, city text,
 org_type text NOT NULL DEFAULT 'gym' CHECK (org_type IN
('gym','studio','clinic')),
 timezone text NOT NULL DEFAULT 'Asia/Kolkata', locale text NOT NULL
DEFAULT 'en',
 currency_display text NOT NULL DEFAULT 'INR',
 logo_key text,                                   -- R2 gym-assets/
 owner_user_id uuid NOT NULL REFERENCES users(id),
 owner_included_as_member boolean NOT NULL DEFAULT true,
 activation jsonb NOT NULL DEFAULT '{}',          -- Part 3 §5.1 checklist
state
 status text NOT NULL DEFAULT 'active' CHECK (status IN
('active','archived')),
 archived_at timestamptz
);
CREATE TABLE gym_codes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
 code text UNIQUE NOT NULL,                       -- 6-char, ambiguity-free
alphabet
 label text NOT NULL DEFAULT 'Front Desk',        -- the group mechanism
(Part 3 §2.1)
 max_uses int, uses int NOT NULL DEFAULT 0,
 expires_at timestamptz, paused boolean NOT NULL DEFAULT false
);

CREATE TABLE gym_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms(id),
  user_id uuid NOT NULL REFERENCES users(id),
  code_id uuid REFERENCES gym_codes(id),           -- group attribution at
join
  joined_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,                          -- membership =
[joined_at, removed_at)
  consent_at timestamptz,                          -- clinic join consent
(Part 3 §2.4); NOT NULL enforced in service for clinics
  hidden_from_boards boolean NOT NULL DEFAULT false,
  complimentary boolean NOT NULL DEFAULT false     -- owner seat (Part 3
§4.0); excluded from seat counts
);
CREATE UNIQUE INDEX gym_members_live_uq ON gym_members (gym_id, user_id)
WHERE removed_at IS NULL;
CREATE INDEX ON gym_members (gym_id, removed_at);          -- roster & seat
count
CREATE INDEX ON gym_members (user_id, removed_at);         -- entitlement
resolver
CREATE INDEX ON gym_members (gym_id, joined_at);           -- interval joins
(rollups)
CREATE TABLE gym_staff (
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner','manager','trainer')),
  PRIMARY KEY (gym_id, user_id)
);
```
The **partial unique index** is the leave/rejoin design: historical
membership rows stack (each a closed interval), exactly what Part 3's
attribution rule needs, while only one *live* membership per (gym,user)
can exist. Rejoin = new row, not resurrection.
### 3.3 Plans, subscriptions, billing

```sql
CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

 code text UNIQUE NOT NULL,                       --
'free','pro_in_m','pro_in_y','pro_us_m','org_micro','org_starter','org_sta
ndard','org_growth','org_scale'
 audience text NOT NULL CHECK (audience IN ('consumer','org')),
 org_types text[],                                -- null = all org types
(org plans only)
 name_key text NOT NULL,
 price_minor int NOT NULL, currency text NOT NULL, "interval" text NOT
NULL CHECK ("interval" IN ('month','year')),
 seat_cap int,                                    -- org plans;
complimentary members excluded from the count
 trial_days smallint NOT NULL DEFAULT 0,          -- 7 for org self-serve
(Part 3 §4.0); pilot codes extend subscriptions.trial_ends_at
 rank smallint NOT NULL,                          -- resolver precedence:
free=0, pro=10, org member_entitlements=10
 entitlements jsonb NOT NULL,                     -- what the SUBSCRIBER
gets
 member_entitlements jsonb,                       -- org plans: what each
MEMBER gets (Pro-level per v1 §9.2)
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_type text NOT NULL CHECK (owner_type IN ('user','gym')),
 owner_id uuid NOT NULL,
 plan_id uuid NOT NULL REFERENCES plans(id),
 status text NOT NULL CHECK (status IN
('trialing','active','past_due','canceled','expired')),
 trial_ends_at timestamptz, current_period_end timestamptz,
 cancel_at_period_end boolean NOT NULL DEFAULT false,
 provider text NOT NULL CHECK (provider IN
('razorpay','stripe','revenuecat','pilot')),
 provider_ref text, cancel_reason text
);
CREATE UNIQUE INDEX subs_one_live_uq ON subscriptions (owner_type,
owner_id)
 WHERE status IN ('trialing','active','past_due');         -- exactly one
live sub per owner — double-charging is now unrepresentable
CREATE INDEX ON subscriptions (status, current_period_end); -- dunning &
expiry sweeps

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  amount_minor int NOT NULL, currency text NOT NULL,
  status text NOT NULL CHECK (status IN
('paid','failed','refunded','void')),
  provider_ref text UNIQUE, issued_at timestamptz NOT NULL, pdf_key text
);
CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL, event_id text NOT NULL,
  payload jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz, status text NOT NULL DEFAULT 'pending' CHECK
(status IN ('pending','done','failed')),
  UNIQUE (provider, event_id)                        -- the dedupe that makes
v1 §10's enqueue-then-ack safe
);
```

**Canonical entitlements JSON** (the only shape the quota middleware and
repos read; every key has a default so old plan rows survive new
features):

```jsonc
{ "exercises": { "mode": "tier", "tier": "T1" },          // or {"mode":"all"} —
free set = the T1 tag (Part 2 App B #6), swappable as data
  "coach":       { "window": "day",     "limit": 30 },
  "meal_scan":   { "window": "day",     "limit": 8   },
  "route_gen":   { "window": "day",     "limit": 5   },
  "history_days": -1,                                     // -1 = unlimited; free
= 90 (read-gate, §0.2)
  "programs": "all",                                      // "starter" | "all"
  "global_leaderboards": true, "share_watermark": false }
```

**Seed rows (v1 §9 numbers; Micro from Part 3 — prices ratified in Part
5):** `free` (rank 0: T1 exercises, coach 5/**month**, meal 3/month,
routes 2/month, history 90, starter program, watermark on) · `pro_in_m`
₹149 / `pro_in_y` ₹999 / `pro_us_m` $3.99 / `pro_us_y` $29.99 (rank 10:
all-58, 30/8/5 per day, history −1) · org: `org_micro` ≤25 ₹999 (org_types

`{studio,gym}`) & clinic Micro ₹1,499 · `org_starter` ≤100 ₹1,499 ·
`org_standard` ≤150 ₹1,999 · `org_growth` ≤400 ₹3,499 · `org_scale` 400+
₹4,999 — each org plan's `member_entitlements` = the Pro block,
`entitlements` = console features.

### 3.4 Exercise catalog & definitions

```sql
CREATE TABLE exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL, name_key text NOT NULL,
  family text NOT NULL CHECK (family ~ '^F([1-9]|1[0-2])$'),      -- F1..F12
(Part 2 §5)
  tier text NOT NULL CHECK (tier IN ('T1','T2','T3')),
  tracking text NOT NULL DEFAULT 'pose' CHECK (tracking IN
('pose','timer')),
  status text NOT NULL DEFAULT 'live' CHECK (status IN
('live','hidden','retired')),
  met numeric(3,1) NOT NULL,                       -- Part 2B Appendix A
lands here, one value per row
  difficulty smallint, equipment text[], muscles text[],
  legacy_mongo_id text UNIQUE
);
CREATE TABLE exercise_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id uuid NOT NULL REFERENCES exercises(id),
  version int NOT NULL,
  status text NOT NULL CHECK (status IN
('draft','beta','live','retired')),
  definition jsonb NOT NULL,                       -- the Part 2 §4 document,
immutable once beta+
  min_engine_version text NOT NULL,
  published_at timestamptz, published_by uuid REFERENCES users(id),
  UNIQUE (exercise_id, version)
);
CREATE INDEX ON exercise_definitions (exercise_id, status);
CREATE TABLE definition_bundles (                  -- what clients actually
download (Part 2 §9.3)
  bundle_version int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel text NOT NULL CHECK (channel IN ('live','beta')),

 sha256 text NOT NULL,                          -- the ETag
 manifest jsonb NOT NULL                        -- {exercise_slug:
definition_version}
);
```
Publishing = insert a new immutable definition version → build a new
bundle row from current pointers. **Rollback = build a bundle from the
previous versions** — no mutation anywhere. The two catalog decisions,
executed in seed (per Part 2 Appendix B): **Mountain Pose → `status
'live'`, tier T3, F12 hold, MET 2.3** (zero cost, serves the
older/rest-day audience the F12 tone targets; the `REMOVED_EXERCISES`
frontend hack dies with the migration) · **Brisk Walking → `tracking
'timer'`** (web logs a timed session; mobile deep-links it into the
Running module; excluded from every form-score surface).
`arnold_shoulder_press` stays unseeded — first expansion candidate, one
authoring session away.

### 3.5 Workouts & sets (the big tables — partition-ready per §0.1)

```sql
CREATE TABLE workouts (
 id uuid PRIMARY KEY,                           -- CLIENT-generated (v1
§5.3): the PK is the idempotency key
 user_id uuid NOT NULL REFERENCES users(id),
 started_at timestamptz NOT NULL, ended_at timestamptz,
 platform text NOT NULL CHECK (platform IN ('web','android','ios')),
 engine_version text NOT NULL, bundle_version int,
 sets_count smallint NOT NULL DEFAULT 0, total_reps int NOT NULL DEFAULT
0,
 avg_form_score smallint,                       -- null until a scored set
exists
 duration_ms int, kcal_point int, kcal_calc_version smallint,    --
computed server-side at sync (2B §2.2)
 quality_flags text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX ON workouts (user_id, started_at DESC);   -- history screens,
member drawer
CREATE INDEX workouts_started_brin ON workouts USING brin (started_at);
-- rollups, future archival
CREATE TABLE workout_sets (

  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id uuid NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,                           -- denormalized on
purpose: per-user set queries skip the join
  exercise_id uuid NOT NULL REFERENCES exercises(id),
  started_at timestamptz NOT NULL,                 -- copied from parent:
partition-ready + BRIN-scannable alone
  set_index smallint NOT NULL, view text, mode text,
  reps smallint NOT NULL DEFAULT 0, hold_ms int,
  duration_ms int NOT NULL,
  avg_form_score smallint, rep_scores smallint[],         -- Part 2 §2.4
verbatim; no rep_events table (v1 §7.1)
  fault_counts jsonb NOT NULL DEFAULT '{}',
  tempo_ms_avg int, rom_stats jsonb, calibration jsonb,
  engine_version text NOT NULL, definition_version int NOT NULL
);
CREATE INDEX ON workout_sets (workout_id);
CREATE INDEX ON workout_sets (user_id, started_at DESC);            --
exercise-mix, form trend per member
CREATE INDEX ON workout_sets (exercise_id, started_at DESC);        -- Part
2 §9.4 per-definition telemetry
CREATE INDEX sets_started_brin ON workout_sets USING brin (started_at);
CREATE TABLE workout_templates (                   -- existing WorkoutBuilder
feature, kept (audit find)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL, items jsonb NOT NULL,        -- [{exercise_slug,
target_sets, target_reps|hold_s}]
  updated_at timestamptz NOT NULL DEFAULT now(),
  legacy_mongo_id text UNIQUE
);
```
**Sync contract:** `POST /v1/workouts/sync` inserts the workout `ON
CONFLICT (id) DO NOTHING`, then sets keyed `(workout_id, set_index)`
upserted — a retried sync is a no-op by construction; no Idempotency-Key
bookkeeping table needed for this path. **The pg_partman recipe (applied
at the §0.1 trigger, ~1 evening):** install pg_partman → `CREATE TABLE
workout_sets_p (LIKE workout_sets INCLUDING ALL) PARTITION BY RANGE
(started_at)` → partman monthly config, premake 3 → backfill via
`partman.partition_data_proc` in batches → swap names in one transaction →

detach-and-archive months older than the retention line to R2 via `pg_dump
--table`. FKs *into* sets don't exist (nothing references a set), which is
precisely why this stays an evening and not a project.
### 3.6 Nutrition & body (Trust Layer tables, Part 2B §3.4)

```sql
CREATE TABLE meal_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  taken_at timestamptz NOT NULL, meal_name text,
  items jsonb NOT NULL,         -- [{name, canonical, grams_point,
grams_range:[lo,hi], portion_source, nutrition_source, kcal, protein_g,
carbs_g, fat_g}]
  kcal_point int NOT NULL, kcal_low int NOT NULL, kcal_high int NOT NULL,
-- range survives confirmation, tightened (2B §3.2 S4)
  protein_g numeric(6,1), carbs_g numeric(6,1), fat_g numeric(6,1),
  confirmed boolean NOT NULL DEFAULT false,
  portion_source text NOT NULL,                 -- worst rung used:
user_dishware|anchor|regional_prior|default|legacy
  nutrition_sources text[] NOT NULL,            -- e.g. {ifct,usda}
  calc_version smallint NOT NULL,
  legacy_mongo_id text UNIQUE
);
CREATE INDEX ON meal_logs (user_id, taken_at DESC);
CREATE TABLE user_dishware (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL, container_class text NOT NULL, volume_ml int NOT
NULL,
  food_hint text
);
CREATE TABLE meal_log_corrections (              -- P4 doctrine: corrections
are ground truth, originals preserved
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_log_id uuid NOT NULL REFERENCES meal_logs(id) ON DELETE CASCADE,
  field text NOT NULL, original jsonb NOT NULL, corrected jsonb NOT NULL,
  portion_source text
);
CREATE TABLE body_measurements (                 -- existing feature (audit
find), kept; org-invisible by §2.4 boundary

 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 measured_at timestamptz NOT NULL, weight_kg numeric(5,2),
 metrics jsonb NOT NULL DEFAULT '{}',           -- waist_cm etc. —
display-only, never computed upon except weight
 source text NOT NULL DEFAULT 'manual',
 legacy_mongo_id text UNIQUE
);
CREATE INDEX ON body_measurements (user_id, measured_at DESC);
```
Calorie computation uses the latest `weight_kg` measurement ≤ workout
time, else `users.weight_kg`, else 70 (2B §2.1) — resolved at sync,
stamped into `workouts.kcal_*`, never recomputed silently (P3 doctrine).

### 3.7 Coach (Chroma → pgvector, v1 §6.1)

```sql
CREATE TABLE coach_threads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id),
 title text, last_message_at timestamptz, legacy_mongo_id text UNIQUE
);
CREATE TABLE coach_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 thread_id uuid NOT NULL REFERENCES coach_threads(id) ON DELETE CASCADE,
 role text NOT NULL CHECK (role IN ('user','assistant','system')),
 content text NOT NULL,
 model text, tokens_in int, tokens_out int, cost_micro bigint, currency
text DEFAULT 'USD'
);
CREATE INDEX ON coach_messages (thread_id, created_at);
CREATE TABLE kb_chunks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 doc text NOT NULL, chunk_index int NOT NULL,
 content text NOT NULL, meta jsonb NOT NULL DEFAULT '{}',
 embedding vector(384),                           -- dimension PINNED to the
embedder chosen at port; 384 = MiniLM-class assumption
 UNIQUE (doc, chunk_index)
);
```

Five knowledge docs ≈ a few hundred chunks: **no ANN index needed** — a
sequential scan with cosine distance is single-digit ms at this size. Add
HNSW only if the KB grows 100×; noting this prevents cargo-cult index
tuning.

### 3.8 Gamification

```sql
CREATE TABLE streaks (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 current int NOT NULL DEFAULT 0, longest int NOT NULL DEFAULT 0,
 last_activity_date date, freezes_available smallint NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE achievements (                       -- seeded from badges.py
port
 code text PRIMARY KEY, name_key text NOT NULL, criteria jsonb NOT NULL,
icon text
);
CREATE TABLE user_achievements (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 code text NOT NULL REFERENCES achievements(code),
 earned_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, code)
);
CREATE TABLE challenges (                         -- v1.1 (Part 3 §2.3);
tables now, screens later
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 scope text NOT NULL CHECK (scope IN ('user','org','global')),
 gym_id uuid REFERENCES gyms(id), template_code text NOT NULL,
 starts_on date NOT NULL, ends_on date NOT NULL, config jsonb NOT NULL
DEFAULT '{}',
 status text NOT NULL DEFAULT 'active' CHECK (status IN
('active','ended','canceled'))
);
CREATE TABLE challenge_participants (
 challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 progress jsonb NOT NULL DEFAULT '{}', joined_at timestamptz NOT NULL
DEFAULT now(),

 PRIMARY KEY (challenge_id, user_id)
);
CREATE TABLE leaderboard_snapshots (               -- weekly persistence of
Redis ZSETs (v1 §7.2); Redis stays rebuildable
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 gym_id uuid REFERENCES gyms(id),                  -- null = global board
 board text NOT NULL, period text NOT NULL,        -- '2026-07'
 entries jsonb NOT NULL,                           -- [{user_id,
display_name, value, rank}] — display_name scrubbed on account deletion
(§5.2)
 UNIQUE (gym_id, board, period)
);
```

### 3.9 Geo & runs (mobile-first; web = browse/plan per v1 §12)

```sql
CREATE TABLE runs (
 id uuid PRIMARY KEY,                              -- client-generated, same
idempotency pattern as workouts
 user_id uuid NOT NULL REFERENCES users(id),
 started_at timestamptz NOT NULL, duration_s int NOT NULL, distance_m int
NOT NULL,
 polyline text, route_name text, splits jsonb,
 kcal_point int, kcal_calc_version smallint,
 source text NOT NULL DEFAULT 'mobile', legacy_mongo_id text UNIQUE
);
CREATE INDEX ON runs (user_id, started_at DESC);
CREATE TABLE saved_routes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL, polyline text NOT NULL, distance_m int NOT NULL,
 legacy_mongo_id text UNIQUE
);
CREATE TABLE run_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 rule jsonb NOT NULL, active boolean NOT NULL DEFAULT true,
legacy_mongo_id text UNIQUE
);

CREATE TABLE geo_cache (                          -- persistent layer under
the Redis geo cache (v1 §6.1)
 lat3 numeric(7,3) NOT NULL, lng3 numeric(7,3) NOT NULL,
 name text NOT NULL, provider text NOT NULL, cached_at timestamptz NOT
NULL DEFAULT now(),
 PRIMARY KEY (lat3, lng3)
);
```
GPS polylines are the most sensitive data the app holds (home addresses
fall out of them). They live only here, are **org-invisible** (Part 3
§2.4), excluded from all exports except the user's own DPDP export, and
deleted in the §5.2 cascade.

### 3.10 Metering & cost telemetry

```sql
CREATE TABLE usage_daily (                        -- nightly Redis rollup
(v1 §7.2); feeds reports & Part 3 analytics
 user_id uuid NOT NULL, feature text NOT NULL, day date NOT NULL,
 count int NOT NULL,
 PRIMARY KEY (user_id, feature, day)
);
CREATE TABLE api_cost_events (                    -- the v1 §9.3 breaker's
ledger
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 at timestamptz NOT NULL DEFAULT now(),
 user_id uuid, gym_id uuid,                       -- gym resolved via live
membership at spend time; null for direct consumers
 feature text NOT NULL, provider text NOT NULL,
 units numeric(12,4) NOT NULL, unit_type text NOT NULL,
 cost_micro bigint NOT NULL, currency text NOT NULL DEFAULT 'USD'
);
CREATE INDEX ON api_cost_events (gym_id, at);
CREATE INDEX cost_at_brin ON api_cost_events USING brin (at);
```

### 3.11 Org analytics & reports (Part 3 §3.2 made physical)

```sql
CREATE TABLE org_daily_stats (

 gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
 day date NOT NULL,                               -- in the ORG's timezone
(worker computes the UTC window)
 active_members int NOT NULL, workouts int NOT NULL, sets int NOT NULL,
 total_reps int NOT NULL, minutes int NOT NULL,
 avg_form_score numeric(4,1), scored_sets int NOT NULL,
 new_members int NOT NULL, removed_members int NOT NULL,
 PRIMARY KEY (gym_id, day)
);
CREATE VIEW org_member_stats AS                   -- Members table & drawer
read ONLY this + workout aggregates
SELECT m.id AS membership_id, m.gym_id, m.user_id, u.display_name,
         c.label AS group_label, m.joined_at, m.hidden_from_boards,
         u.last_active_at,
         (SELECT count(*) FROM workouts w WHERE w.user_id = m.user_id
            AND w.started_at >= now() - interval '30 days'
            AND w.started_at >= m.joined_at) AS workouts_30d,
         (SELECT round(avg(s.avg_form_score),0) FROM workout_sets s
            WHERE s.user_id = m.user_id AND s.avg_form_score IS NOT NULL
            AND s.started_at >= now() - interval '30 days'
            AND s.started_at >= m.joined_at) AS avg_form_30d
FROM gym_members m JOIN users u ON u.id = m.user_id
LEFT JOIN gym_codes c ON c.id = m.code_id
WHERE m.removed_at IS NULL AND u.status = 'active';
CREATE TABLE gym_usage_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
 period text NOT NULL, stats jsonb NOT NULL, pdf_key text,
 emailed_at timestamptz, opened_at timestamptz,
 UNIQUE (gym_id, period)
);
```

### 3.12 Platform / ops

```sql
CREATE TABLE push_tokens (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token text PRIMARY KEY, platform text NOT NULL, last_seen_at timestamptz
);

CREATE TABLE feature_flags ( key text PRIMARY KEY, rules jsonb NOT NULL,
updated_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE audit_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 at timestamptz NOT NULL DEFAULT now(),
 actor_user_id uuid, gym_id uuid, action text NOT NULL,
 target_type text, target_id text, meta jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_at_brin ON audit_log USING brin (at);
CREATE INDEX ON audit_log (gym_id, at DESC);
CREATE TABLE trace_samples (                       -- v1 §14 anti-cheat
audits; R2 90-day lifecycle
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL, exercise_id uuid NOT NULL,
 r2_key text NOT NULL, engine_version text NOT NULL,
 verdict text NOT NULL DEFAULT 'pending' CHECK (verdict IN
('pending','match','mismatch','error'))
);
```
---

## 4. The four canonical operations (exact SQL; these are the correctness
core)

**4.1 Entitlement resolver** (v1 §8 — fetch candidates in one query, merge
in code, cache Redis 60 s, bust on billing/membership events):

```sql
SELECT p.rank, p.entitlements, NULL::jsonb AS member_entitlements
FROM subscriptions s JOIN plans p ON p.id = s.plan_id
WHERE s.owner_type='user' AND s.owner_id=$1 AND s.status IN
('trialing','active','past_due')
UNION ALL
SELECT p.rank, NULL, p.member_entitlements
FROM gym_members m
JOIN subscriptions s ON s.owner_type='gym' AND s.owner_id=m.gym_id
                     AND s.status IN ('trialing','active','past_due')
JOIN plans p ON p.id = s.plan_id
WHERE m.user_id=$1 AND m.removed_at IS NULL;
```

Merge rule in the `entitlements` service: start from the `free` plan
document, overlay the highest-`rank` candidate, key-by-key max for numeric
limits, OR for booleans, `all ⟩ tier` for exercises. `past_due` still
grants (v1 §10's 5-day grace); `expired/canceled` rows simply don't match.

**4.2 Seat-safe join** (v1 §8; lock the *org row*, not a count):

```sql
BEGIN;
SELECT 1 FROM gyms WHERE id=$gym FOR UPDATE;                      --
serialize joins per org
-- validate code: exists, not paused/expired, uses < max_uses (increment)
-- seat check: (count live, non-complimentary members) < plan.seat_cap       →
else raise SEAT_CAP
INSERT INTO gym_members (gym_id,user_id,code_id,consent_at,complimentary)
VALUES (...);
UPDATE gym_codes SET uses = uses + 1 WHERE id=$code;
COMMIT;     -- on unique_violation of gym_members_live_uq → idempotent
success (already a member)
```

**4.3 Nightly rollup upsert** (worker groups orgs by timezone; `$from/$to`
= that org-day's UTC window; the membership-interval rule lives here and
only here):

```sql
INSERT INTO org_daily_stats AS ods (gym_id, day, active_members, workouts,
sets, total_reps,
                                      minutes, avg_form_score, scored_sets,
new_members, removed_members)
SELECT g.id, $day,
         count(DISTINCT w.user_id), count(DISTINCT w.id),
coalesce(sum(w.sets_count),0),
         coalesce(sum(w.total_reps),0),
coalesce(sum(w.duration_ms),0)/60000,
         round(avg(w.avg_form_score) FILTER (WHERE w.avg_form_score IS NOT
NULL),1),
         count(*) FILTER (WHERE w.avg_form_score IS NOT NULL),
         (SELECT count(*) FROM gym_members jm WHERE jm.gym_id=g.id AND
jm.joined_at >= $from AND jm.joined_at < $to),

         (SELECT count(*) FROM gym_members rm WHERE rm.gym_id=g.id AND
rm.removed_at >= $from AND rm.removed_at < $to)
FROM gyms g
LEFT JOIN gym_members m ON m.gym_id = g.id
LEFT JOIN workouts w ON w.user_id = m.user_id
      AND w.started_at >= $from AND w.started_at < $to
      AND w.started_at >= m.joined_at
      AND (m.removed_at IS NULL OR w.started_at < m.removed_at)
WHERE g.id = ANY($org_ids)
GROUP BY g.id
ON CONFLICT (gym_id, day) DO UPDATE SET
 active_members=excluded.active_members, workouts=excluded.workouts,
sets=excluded.sets,
 total_reps=excluded.total_reps, minutes=excluded.minutes,
 avg_form_score=excluded.avg_form_score,
scored_sets=excluded.scored_sets,
 new_members=excluded.new_members,
removed_members=excluded.removed_members;
```

**4.4 At-risk** (Part 3 §3.2 definition, verbatim in SQL):

```sql
SELECT m.user_id, u.display_name, u.last_active_at,
         (SELECT count(*) FROM workouts w WHERE w.user_id=m.user_id AND
w.started_at >= m.joined_at) AS lifetime
FROM gym_members m JOIN users u ON u.id=m.user_id
WHERE m.gym_id=$1 AND m.removed_at IS NULL AND u.status='active'
 AND m.joined_at < now() - interval '14 days'
 AND NOT EXISTS (SELECT 1 FROM workouts w WHERE w.user_id=m.user_id
                    AND w.started_at >= now() - interval '14 days')
 AND EXISTS (SELECT 1 FROM workouts w WHERE w.user_id=m.user_id
                AND (w.started_at BETWEEN m.joined_at AND m.joined_at +
interval '21 days'
                     OR w.started_at >= now() - interval '44 days'))
ORDER BY lifetime DESC LIMIT 20;
```

---

## 5. Data lifecycle, retention & DPDP

### 5.1 Retention table (jobs live in the BullMQ `rollups` queue; each is
idempotent)

| Data | Retention | Mechanism |
|---|---|---|
| workouts / sets / runs / meals / measurements | forever (free tier
read-gated at 90 d, §0.2) | — |
| refresh_tokens | expiry + 30 d | nightly DELETE |
| webhook_events | 90 d after processed | nightly DELETE |
| trace_samples (+ R2 `traces/`) | 90 d | R2 lifecycle + row sweep |
| usage_daily | 24 months | monthly partition-free DELETE by day |
| api_cost_events | 24 months | same |
| audit_log | 24 months (money rows 7 y) | sweep with action-class filter
|
| gym_usage_reports (+ PDFs) | 18 months (Part 3 §4.5) | sweep + R2
lifecycle |
| archived orgs | purge 90 d after archive (Part 3 §7) | weekly job |
| meal photos | **never stored** (2B) | — |

### 5.2 DPDP/GDPR account deletion (member-initiated in-app; 14-day soft
window, then hard cascade)

Day 0: `users.status='deleted'`, `deleted_at=now()`, all refresh tokens
revoked, push tokens deleted, memberships closed (`removed_at`), login
blocked, 14-day undo email. Day 14 job, in one transaction per user:
**delete** meal_logs(+corrections), dishware, coach threads/messages,
runs/saved_routes/schedules, body_measurements, workout_templates,
workouts(+sets CASCADE), user_achievements, streaks,
challenge_participants, auth_identities; **anonymize** `users` row to a
tombstone (email→null, display_name→'Deleted user', weight→null; row kept
so FKs from audit/invoices resolve); **scrub** display_name from
`leaderboard_snapshots.entries`; **keep** org_daily_stats (already
aggregate, no PII), audit_log (actor now tombstoned), and paid invoices
for statutory tax retention (India: ~7–8 y — *confirm exact period with
your CA*; invoices carry the minimum identity the law requires and nothing
more). **Export** (the other DPDP right): a worker builds a JSON zip of
every user-owned table above + profile, delivered via signed URL, 7-day
expiry. Both flows exist at launch, not later (2B §7).

---

## 6. Sizing (why Neon's small tiers hold for a long time)

Per **active** user·month at heavy use (12 workouts × 3 sets, 60 meals, 40
coach msgs): workouts ~3 KB + sets ~15 KB + meals ~60 KB + coach ~30 KB +
misc ~10 KB ≈ **~120 KB/user·month**. 1,000 MAU ≈ 120 MB/month ≈ 1.4
GB/year *before* TOAST compression (jsonb compresses well; realistic
~60%). With §5.1 sweeps, 1k MAU cruises for years under a few GB; 10k MAU
≈ 12 GB/yr — still one Neon Launch-tier database. Indexes ≈ 30–40% on top.
The DB will not be your scaling problem; the v1 §20 triggers stand
unchanged.

---

## 7. The Mongo → Postgres migration (one-time, idempotent, verifiable)

**Strategy:** a single Node script in `apps/api/tools/migrate-mongo/`,
reading Mongo **read-only**, writing with `ON CONFLICT DO NOTHING`. Every
new row's UUID = **UUIDv5(NAMESPACE_AIHG, mongo ObjectId hex)** —
deterministic, so re-runs are no-ops and cross-collection references
survive without a lookup table; the source id is also kept in
`legacy_mongo_id`. Old stack keeps running until cutover (v1 Phase 2);
"rollback" = flip the flag back, Mongo untouched.

**Mapping (your exact collections):**

| Mongo | → Postgres | Transform notes |
|---|---|---|
| `users` (Mongoose **User** + ml `users`, matched on `_id`/email) |
`users` (+`streaks`, `user_achievements`) | keep bcrypt hash
(`hash_algo='bcrypt'`, upgrade-on-login §3.1); merge duplicate email pairs
(auth doc wins credentials, ml doc wins profile); embedded gamification
fields → if present map, **else recompute deterministically from workout
history** (badges/streak logic is pure — recomputing is safer than
trusting drift) |
| `workout_sessions` | `workouts` + `workout_sets` | embedded sets array
unrolled; per-set fields → §3.5 columns; missing new fields → null;
`engine_version='legacy-py'`, `definition_version=0`; `kcal_*` recomputed

with `calc_version=1` + the new MET table (2B) — legacy displayed totals
may shift; ship with the one-line release note "calorie estimates improved
for 49 exercises" (honesty per 2B, not a silent rewrite — this is the
*one* sanctioned history recomputation, done at migration, versioned) |
| `workout_templates` | `workout_templates` | exercise name → slug map
from the seed |
| `meal_logs` | `meal_logs` | `confirmed=true` (user saved them),
`portion_source='legacy'`, `nutrition_sources={legacy_model}`,
`calc_version=0`, range = point ±30% honest retro-band |
| `coach_conversations` | `coach_threads` + `coach_messages` | costs null
for legacy rows |
| `running_sessions` / `running_routes` / `running_schedules` | `runs` /
`saved_routes` / `run_schedules` | polyline passthrough |
| `body_measurements` | `body_measurements` | weight entries also refresh
`users.weight_kg` (latest) |
| `exercises` | **not migrated** — re-seeded canonically (§8);
`legacy_mongo_id` set on seed rows by name-match so old workout references
resolve |
| Chroma vectors, prediction caches, sessions/JWTs, Redis quota counters |
**not migrated** — re-ingest KB into `kb_chunks`; predictions are
deterministic recomputes (2B §5); everyone re-logs-in once |

**Runbook:** (1) staging dry-run against a Mongo dump; row-count +
checksum report per table. (2) Verification gates: counts match ±0; 100
sampled users' workout/sets/meals counts identical; 20 sampled bcrypt
logins verify; UUIDv5 spot-check on cross-references (workout→user). (3)
Prod: announce, freeze writes (maintenance flag), final run (idempotent),
gates again, flip `DATA_BACKEND=pg`, unfreeze. (4) Mongo → read-only for
30 days, then export-to-R2 and decommission. Total downtime target: **< 30
minutes**; the script must process your current volume in single-digit
minutes (assert in the dry-run).

---

## 8. Seeds & fixtures (checked into the repo, applied by migration
`0001_seed`)

`plans` (§3.3 rows) · `exercises` — all 58 from Part 2 §6 with
family/tier/tracking/**MET from 2B Appendix A**, Mountain Pose live, Brisk
Walking `timer` · `exercise_definitions` — squat/jump/chair v1

(`status='live'`, ported constants) + T1 drafts as they land ·
`definition_bundles` — bundle 1 · `achievements` — badges.py port ·
`feature_flags` — `{data_backend, engine_rollout, beta_definitions}` ·
dev-only: one demo org + 20 synthetic members with 8 weeks of plausible
workouts (the console is undevelopable without data — this fixture is how
every Part 3 screen gets built and screenshotted).

## 9. Acceptance criteria — "Part 4 done" means

Schema applies from zero via migrations on a fresh Neon branch · every §4
query EXPLAINs to index scans on the seeded demo data · sync retry
produces zero duplicates (test: fire the same payload 5×) · seat race test
(20 parallel joins, cap 10) admits exactly 10 · entitlement resolver
returns Pro for a gym member, free the second `removed_at` is set
(cache-bust test) · rollup for a UTC+13 org bins a 23:30 local workout
into the correct local day · deletion cascade leaves zero PII rows
(automated scan for the tombstone's uuid across all tables) · migration
dry-run gates green on a real Mongo dump · `pg_dump | restore` drill
documented and executed once (v1 §17's "an untested backup is a rumor").

---

*— End of Part 4. Queue (one at a time): **Part 5 — Billing &
entitlements** (provider flows, webhook state machines, proration,
dunning, Micro-tier price ratification) · Part 6 — Mobile · Part 7 —
Retention playbook · Part 8 — Ops runbook.*
