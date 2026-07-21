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
- [x] **Onboarding storage exists on the new API.** Was a HARD BLOCKER (Part 4
      defined no storage; P2.7 dropped the fields — INVENTORY.md:45).
      DONE: merged 2026-07-16 via PR #30 (`user_fitness_profiles`, migration
      0006, GET/PUT /v1/users/me/fitness-profile, onboardingCompleted on
      /v1/users/me). WEB wizard + onboarding-gate wiring DONE 2026-07-19 (Card 6,
      DECISIONS); Settings' profile forms are STILL old-backend — owed line below.
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
      - [ ] **Groq model migration (HARD DATE: before 2026-08-16)** — Groq is
            decommissioning `llama-3.1-8b-instant` (our COACH_MODEL default,
            config.ts:30) on 2026-08-16; after that the coach goes dark. Own
            small API card: flip the default (Groq recommends GPT OSS 20B),
            re-quote the model-specific price constants (service.ts:23-24)
            from groq.com/pricing per Part 0 rule 4, sanity-check answers.
            This is date-gated, not launch-gated — do it even if cutover
            slips. (DECISIONS 2026-07-16.)
      - [x] **Vision model migration** — **DONE** (during web Card 5a,
            DECISIONS 2026-07-16; checkbox was STALE, corrected 2026-07-19
            after verifying the CODE, not the doc). Groq decommissioned
            `meta-llama/llama-4-scout-17b-16e-instruct` on 2026-07-17;
            `MEAL_VISION_MODEL` now defaults to `qwen/qwen3.6-27b`
            (config.ts:34) and the vision price constants ARE re-quoted to
            600_000n / 3_000_000n micro-USD ($0.60/1M in, $3.00/1M out,
            groq.com/pricing 2026-07-16 — nutrition/service.ts:23-24), so the
            "cost rows priced at the old constants" interim note here no
            longer applied. Live-verified through the real adapter.
      - [ ] Coach chat retry protection (DECISIONS 2026-07-12 P2.5b T3 minor;
            Kd D1(b) 2026-07-16) — /v1/coach/chat accepts a client-generated
            Idempotency-Key + gets a short-window per-route cap. Without it a
            client retry double-charges quota, re-calls Groq, and duplicates
            messages. The ruling ties this to "when the client is wired" —
            Card 4 wired it; the API side is its own small card and MUST land
            before real traffic. Client change is one header line
            (apps/web/src/api/coachApi.js notes where).
      - [ ] **Nutrition targets/remaining** (MacroRings + "Remaining today",
            web Card 5a, D2 Kd-ruled 2026-07-16) — the new API has no targets
            surface (v1 §6.1's nutrition module is photo pipeline + lookup
            only); the page keeps reading the OLD backend's Mifflin-St Jeor
            calculator interim (broken on the branch, the gamification
            pattern). Its new-API card is now BUILDABLE: the formula's inputs
            (age/gender/height/goals/frequency) live in
            `user_fitness_profiles` since PR #30; weight on `users.weight_kg`.
            NB meal TYPE is derived display-only from `takenAt` time-of-day
            (D1(a), Kd-ruled; boundaries revised at the 5a smoke: <11
            breakfast · 11–16 lunch · 16–19 snack · 19–22 dinner · else
            snack). Kd asked for a user override at the 5a smoke → D1(c) is
            now OWED: a `mealType` field on the meals API (small card).
            Interim: Card 5b adds an edit-takenAt control (PATCH exists).
            **API HALF DONE 2026-07-20** (PR #42, merged to master):
            `GET /v1/nutrition/targets` ports the Mifflin-St Jeor
            calculator, reading `user_fitness_profiles` + `users.weight_kg`.
            It returns `{targets, missing[]}` and **never invents a target** —
            Kd ruled an incomplete profile must NAME the missing details, not
            show a generic 2000. **The WEB half is what remains** and this
            checkbox stays UNTICKED until it lands; it must (a) repoint off
            mlApi, (b) rename snake_case→camelCase (`protein_g`→`proteinG` —
            a straight swap yields undefined macros that silently render as
            the fallback), (c) consume `missing[]` for the honest empty state,
            and (d) DELETE the fabricating `|| 2000/150/250/65` defaults, whose
            Card-5b approval is now superseded (see the ⚠ marker in
            DECISIONS.md). A browser SMOKE is owed with it — the API card
            shipped no reachable UI and correctly claimed none.
      - [x] **Dishware IN-FLOW UI + portion API** (Part 2B §3.2 rung 1;
            Kd re-ruled at the 5b smoke: dishware must live inside the
            add-food and photo flows, driving the server's portion math).
            DONE as Card ⑤c2 (2026-07-18): API dishware arm
            {canonical,dishwareId,fillLevel} on every meal write (merged to
            master via the dishware-portion-api PR; shared dishwareGrams
            helper; tenant-scoped; bounds-symmetric); web "measure with my
            dish" in both modals + save-a-bowl (Appendix-B midpoints). Both
            diffs fresh-chat-T3'd, SMOKE PASSED (DECISIONS 2026-07-18). Kd
            ruling recorded: ASK EVERY TIME, never auto-apply.
      - [x] **Food synonym/alias matching** (Card-5b smoke, the roti case:
            vision said "Flatbread Stack", curated knows "Roti" → zero
            matches, 0 kcal). DONE: Card ⑤c API (branch `meal-composition`)
            — FOOD_ALIASES + a noise-word pass so the vision's DESCRIPTIVE
            names resolve, + the MEAL_VISION_PROMPT nudge.
            **RESIDUAL, recorded (DECISIONS 2026-07-17):** descriptive names
            whose head noun we stock but the substring pass misses still
            drop honestly — "Margherita Pizza" → no match; so do plurals
            ("Plate of Rotis"). Closing those needs a fuzzier matcher, which
            trades honest-drops for wrong-guesses — a Kd product call, not a
            silent widening. Watch the real-photo smokes.
      - [x] **Meal composition — add/remove ingredients** (Card ⑤c): photo
            confirm/preview accept items the AI never saw (oats + milk), and
            saved meals take a new ingredient via the existing PATCH. Also
            the change-label control on meal rows (the 5b-owed one) and the
            5b stale-guard advisories.
      - [x] **Previous-days meal view** (Card 5d) — DONE 2026-07-19: the
            Nutrition page gains ‹/›/date-picker day navigation; listMealsForDay
            page-walks the existing cursor list (NO API change, no date filter
            added; cap 10 pages then an honest "couldn't load back this far").
            Past days hide logging (takenAt=now, Kd 2026-07-17), keep per-meal
            edits, show "Eaten on this day"; MacroRings kept (Kd ruled keep).
            Fresh-chat T3 (zero violations) + SMOKE passed (DECISIONS 2026-07-19).
      - [x] ~~Desktop webcam capture for meal photos~~ — **WON'T BUILD**
            (Kd ruled 2026-07-19, DECISIONS). Not a removal: no meal-photo
            webcam was ever built (`useCamera` serves the workout/pose path
            only), and Part 2B §3 mandates no capture mechanism. Nobody is
            blocked — `capture` is ignored on desktop, so the file picker
            already works there. A laptop webcam is a WORSE input to 2B's
            monocular portion problem and would burn paid vision calls on
            poor-quality photos. Does NOT block P2.8.
      - [ ] **Mobile-web camera smoke on a REAL phone** (owed, Kd deferred
            2026-07-19) — the claim "the file input opens the camera on
            phones" (DECISIONS 2026-07-17) is UNVERIFIED: every smoke so far
            ran on desktop. The webcam ruling above makes mobile web the
            PRIMARY meal-capture path, so this needs one real-device run:
            `vite dev --host`, `VITE_API_URL` + API `WEB_ORIGIN` on the LAN
            address (a phone resolves `localhost` to itself; CORS is
            exact-origin + credentials). Also settles the recorded
            `capture`-vs-photo-library trade-off (options A/B/C in DECISIONS).
      - [ ] `limitedToDays` surfaced in the Progress UI (T3 Card 3) — every
            /v1/progress read returns the plan-clamp field (progress.ts:18-21,
            the P2.4 history gate) and the page ignores it, so a free-plan
            user sees "Last year" over 30-day data. Must render an honest
            clamp notice before cutover ships plan-gated UI to real users.
      - [x] **Settings profile forms → new API** — DONE 2026-07-20 (Card 7,
            DECISIONS). Both profile forms + reset-onboarding now run on
            PATCH /v1/users/me + PUT /v1/users/me/fitness-profile via a
            read-modify-write merge (the PUT is a full replace and each form
            owns only part of it); option lists aligned to the new-API enums;
            reset = `PUT {}` full wipe (Kd-ruled). Fresh-chat T3 (7 findings,
            all fixed) + SMOKE passed. The dead `userService` import is gone.
      - [ ] **Avatar / profile-picture storage on the new API** (owed out of
            Card 7, 2026-07-20). Command-verified: NO `profilePicture`/avatar
            field exists in the shared schema or the `users` DDL, so the picture
            upload is the ONE Settings surface still on legacy mlApi
            (`/users/profile`, load + PATCH) — kept per the no-removal rule and
            broken-on-branch like the gamification surfaces.
            **Scope must include the security this path currently lacks (T3):**
            it base64-inlines a 2 MB image into a JSON PATCH; R3.9 requires
            magic-byte content-type validation (not extension), a size cap,
            storage in R2 under SERVER-generated keys, and delivery via signed
            URLs/CDN. Do NOT inherit the current shape at cutover.
      - [ ] Onboarding wizard's native unit dropdowns → the shared
            `components/common/Select` built in Card 7 (small polish). A native
            `<select>` popup is OS-drawn and its hovered row uses the system
            accent (blue) which CSS cannot override — Settings' five dropdowns
            were moved; the wizard's cm/ft + kg/lbs pickers were left untouched
            rather than folded silently into Card 7.
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
