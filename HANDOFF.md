# HANDOFF log (append-only; latest block goes under the next task's T1 prompt)

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
