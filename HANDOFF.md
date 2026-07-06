# HANDOFF log (append-only; latest block goes under the next task's T1 prompt)

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
