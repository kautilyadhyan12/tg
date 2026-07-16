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

- [x] **argon2id rehash-on-login** shipped — MERGED 2026-07-14 (PR #28, merge
      `67b0ba7`); bcrypt users upgrade transparently on next login.
- [ ] **Onboarding storage exists on the new API.** HARD BLOCKER for
      decommissioning the old backend: `apps/web`'s Onboarding wizard still POSTs
      `/users/onboarding` to `backend-ml`, and Part 4 defines NO storage for that
      data (P2.7 dropped it — INVENTORY.md:45 "the queued onboarding-storage
      gap"). It also gates recommendations (Part 2B §4.1: the scorer IS goal /
      difficulty / equipment / duration). Turning the old backend off before this
      lands silently breaks onboarding + recommendations. (DECISIONS 2026-07-15.)
- [ ] **Drain the offline sync queues BEFORE cutover** (legacy-bucket orphaning,
      DECISIONS 2026-07-15). Per-user localStorage buckets — including the
      offline workout queue — are keyed `user_<id>_*`. Pre-cutover that `<id>` is
      the **old Mongo ObjectId** (decoded from the old JWT); after it is the
      **new UUID** (§7 uuidv5 mapping), so any unflushed workouts and
      WorkoutBuilder drafts orphan under an address the app no longer reads.
      Mitigation is only needed for a **data-carrying** cutover (dev/test): have
      clients flush/sync while the OLD stack is still up, or accept the loss
      explicitly. **On greenfield prod (the note above) this is a non-issue** —
      no users, no buckets.
- [ ] **Web app repointed to the new API.** Today `apps/web` is split:
      `syncClient.js` → `VITE_API_URL` (new), but `authApi/coachApi/mlApi/
      nutritionApi` still → `VITE_AUTH_API_URL` / `VITE_ML_API_URL` (old). All
      must move to the new API and its endpoints must exist for each feature.
      **OWED ENDPOINTS (web-repoint Card 3 inventory, 2026-07-16) — each of
      these UI surfaces still calls the OLD backend because its new-API home
      does not exist; per the NO-REMOVAL rule (CLAUDE.md MIGRATION STANCE),
      P2.8 is blocked until every line has a new-API surface and its consumer
      is repointed:**
      - [ ] XP/levels display (GamificationStrip, Achievements) — XP storage
            deferred by DECISIONS 2026-07-11 P2.3 GAP-1; needs its ruled card.
      - [ ] Badge catalog + challenges screens — "tables now, screens later"
            (DECISIONS 2026-07-11 P2.3 carve); needs catalog/challenges reads.
      - [ ] Leaderboard (GamificationStrip, Achievements) — P4.x card
            (Redis ZSET, v1 §14). NB the playbook sequences P4 AFTER P2.8 —
            either a minimal read lands early or Kd explicitly accepts a dark
            window; DECIDE AT THIS CHECKBOX, do not silently flip it.
      - [ ] Predictions (PredictionsSection) — 2B §5 card (P2.3 carve).
      - [ ] Exercise library content: display names, instructions, media,
            server-side search (ExerciseLibrary) — the Part 4 §3.4 catalog is
            data-only (nameKey/family/tier/met…); exercise copy/media surface
            is owed (P4 production line / Part 2 Appendix A localization).
      - [ ] Workout history calendar (WorkoutCalendar → workoutApi.getHistory)
            — /v1/workouts EXISTS; the client repoint is owed to a web card
            (found out-of-scope during Card 3, R1.1).
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
