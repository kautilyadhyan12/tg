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
- [ ] **DPDP Day-14 HARD-DELETE — CODE COMPLETE 2026-07-22, BUT IT RUNS
      NOWHERE, so this gate stays OPEN.** (branch `dpdp-day14-purge`.)
      This box was ticked when the code landed and is UNTICKED again after its
      T3 (finding D1) — a correct sweep that is scheduled nowhere deletes
      nothing, and the one thing this checkbox exists to promise is that a
      deleted user's data actually goes. Command-verified 2026-07-22: there is
      **no Dockerfile anywhere in the repo**, `docker-compose.yml` defines only
      `mongo`/`redis`/`mongo-express` (no `api`, no `worker`), `ci.yml` has no
      deploy job, and nothing in `RUNBOOK/` says where `pnpm worker` runs. The
      v1 §6 "two modes, one image" citation describes an image that does not
      exist yet. **To close this box:** the deploy path must actually run the
      worker (or a cron must run `tools/dpdp-purge.ts --apply`), and this entry
      must name where. Until then the code below is real and proven, and the
      obligation is not discharged.
      §5.2 tombstones the `users` row rather than
      deleting it, so NO FK cascade collects user-owned PII; §5.2's explicit
      Day-14 DELETE list is the only mechanism, and it now exists:
      `modules/privacy` (**18 tables — 16 deleted directly**,
      `meal_log_corrections` and `coach_messages` collected by CASCADE from
      their parents), the `users` tombstone, and the
      `leaderboard_snapshots.entries` scrub, all in ONE transaction per user.
      `user_fitness_profiles` IS included — the condition on which
      onboarding-storage was merged (DECISIONS 2026-07-16) is discharged for
      the delete half. Runs on BullMQ from a new `worker` entrypoint (v1 §6),
      plus `tools/dpdp-purge.ts` for a hand-run, which is DRY BY DEFAULT.
      Retention lives in ONE constant (`src/retention.ts`) that also drives
      the undo window, the restore-token TTL and the user-facing copy, so Kd's
      open privacy-scope ruling is a one-line change. api 324/324 on Neon.
      ⚠ **But CI enforces none of that** (T3 D2, measured): the gate job runs
      `pnpm test` with NO `DATABASE_URL`, so 173 of the 324 tests SKIP —
      including this entire purge suite. The Neon-branch job only runs
      migrations. Pre-existing repo infrastructure, but this card is what
      makes it load-bearing: the only code that irreversibly destroys user
      data has zero enforced coverage on merge. Its own OWED line.
- [ ] **DPDP JSON-export worker — STILL OWED, and it still blocks P2.8**
      (Part 4 §5.2's other half: "a worker builds a JSON zip of every
      user-owned table above + profile, delivered via signed URL, 7-day
      expiry"). Split from the delete half by Kd ruling 2026-07-22 because
      NONE of its infrastructure exists — verified: no R2/S3 client in any
      package.json, no bucket/signing env vars in config.ts, no zip library,
      and no Part 4 table to track an export job. It therefore needs new
      credentials and ≥2 new dependencies, which would have blown the 🔴
      one-thing-per-chat ceiling and delayed the legally load-bearing half.
      A DEVIATION PROPOSAL is on file for that card: deliver the export as an
      authenticated `GET /v1/users/me/export` returning JSON directly — no
      zip, no R2, no signed URL — which satisfies §5.2's "both flows exist at
      launch" with zero new infrastructure and keeps the export a table LIST,
      so swapping in signed-URL delivery later changes delivery only, never
      content. Kd rules on that at the card, not here.
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
