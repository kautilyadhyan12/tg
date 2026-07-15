# Runbook — Mongo → Postgres cutover (P2.8)

The one-time production cutover from the legacy Mongo stack (`backend-auth`,
`backend-ml`) to the new `apps/api` on Postgres. Implements Part 4 §7 steps 3–4.

**This document is written at P2.7f but EXECUTED at P2.8.** Do not run it until
every prerequisite below is met. The migration tool itself
(`apps/api/tools/migrate-mongo/`) is built + verified (P2.7a–e); this runbook is
the operational wrapper around it.

> Note (DECISIONS 2026-07-13): production launches with an EMPTY database — the
> dev/test data is NOT imported to prod. So on a greenfield prod there is nothing
> to migrate and steps 3–5 collapse to "point web at new API + decommission".
> The full procedure below is the general/data-carrying form (used for the
> verified dev cutover and kept for reference).

## Prerequisites (all must be true before starting)

- [x] **argon2id rehash-on-login** shipped (DECISIONS 2026-07-11, owed before
      P2.8) — else migrated users stay bcrypt with no upgrade path.
      DONE: merged 2026-07-15 via PR #28 (merge 67b0ba7).
- [ ] **DPDP Day-14 hard-delete + JSON-export worker** shipped (Part 4 §5.2).
      **HARD GATE — do not cut over without it.** §5.2 tombstones the `users`
      row rather than deleting it, so NO FK cascade collects user-owned PII;
      §5.2's explicit Day-14 DELETE list is the only mechanism, and the worker
      that runs it does not exist yet (DECISIONS 2026-07-11: queued, needs
      BullMQ — which is NOT installed, and there is no worker mode yet).
      Until it ships, a deleted user's data persists indefinitely — including
      `user_fitness_profiles.medical_conditions` (**health data**, sensitive
      under DPDP), which the onboarding-storage card added on 2026-07-16.
      That card was merged ONLY on the accepted condition that this worker is
      promoted and lands before real users exist — cutover IS that moment
      (DECISIONS 2026-07-16). The worker must cover BOTH §5.2 lists:
      the hard DELETE list and the JSON-export list. It must include
      `user_fitness_profiles` in both.
- [ ] **Web app repointed to the new API.** Today `apps/web` is split:
      `syncClient.js` → `VITE_API_URL` (new), but `authApi/coachApi/mlApi/
      nutritionApi` still → `VITE_AUTH_API_URL` / `VITE_ML_API_URL` (old). All
      must move to the new API and its endpoints must exist for each feature.
- [ ] New API deployed and healthy (`/health` green); `data_backend` feature
      flag present (seeded, `seed.ts`).
- [ ] Secrets in the deploy platform (escrow: `DATABASE_URL`, `MONGO_URI`,
      `JWT_SECRET`, …) — never in the repo.
- [ ] Backup/restore drill for the target Postgres performed (Part 8).

## Procedure (target downtime < 30 min, Part 4 §7)

1. **Announce** the maintenance window.
2. **Freeze writes** — put the legacy stack in maintenance mode (reject writes;
    reads still allowed). Mongo receives no new data from here on.
3. **Final migration run** (idempotent; safe to have run before):
    ```
    corepack pnpm --filter api exec drizzle-kit migrate      # schema (no-op if applied)
    corepack pnpm --filter api exec tsx src/db/seed.ts        # reference data (idempotent)
    corepack pnpm --filter api exec tsx tools/migrate-mongo/run.ts --apply
    ```
    Requires `MONGO_URI` + `DATABASE_URL` in the environment. Assert the run
    completes in single-digit minutes (the tool prints `elapsed: …s`).
4. **Gates** — re-verify with NO writes; every line must read `ok=true` and
    `per_user_mismatches=0`:
    ```
    corepack pnpm --filter api exec tsx tools/migrate-mongo/run.ts --verify-only
    ```
5. **Flip the backend** — set the `data_backend` feature flag to `pg` (Part 4 §7
    "flip `DATA_BACKEND=pg`"; here it is the seeded `feature_flags` row, not an
    env var).
6. **Unfreeze** — lift maintenance mode. The web app now serves 100% from the
    new API on Postgres.

## Verify recovered

- `--verify-only` all `ok=true`, `per_user_mismatches=0`, `crossref_ok=true`.
- `/health` green; a real login, a workout sync, a meal log, and a coach message
  all succeed against the new API.
- Cost dashboard shows real numbers (Done gate, v1 §22).

## Post-cutover

- **Mongo → read-only for 30 days** (rollback safety net), then export-to-R2 and
  **decommission** `backend-auth` / `backend-ml` / `ml-training`.
- Keep the old code in-repo until Phases 3–6 stop needing it as a salvage source.

## Rollback

- Flip the `data_backend` feature flag back to the legacy value and lift the
  freeze — Mongo was untouched by the migration (read-only tool), so the legacy
  stack resumes immediately. No data loss: the PG rows are additive and keyed by
  deterministic UUIDv5, so a later re-cutover is a clean no-op re-run.
