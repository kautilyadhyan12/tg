# HANDOFF log (append-only; latest block goes under the next task's T1 prompt)

```
TASK: THE 58-EXERCISE CATALOG — **DONE** (a791c53), plus the two rulings that
      produced it (b9a2b0e) and a same-day correction of one of them (6f83f55).
      All 12 previously-local commits are now PUSHED (e49d909..a791c53); CI has
      seen this branch for the first time since Card 1's era.
      **THE WEB WRITE PATH IS NOW UNBLOCKED AND IS THE NEXT CARD.**

WHAT LANDED
  · exercises 3 → **58** rows, verified against the live DB (count = 58,
    pose 57 / timer 1), not inferred.
  · `CATALOG_58` in `packages/shared/src/exerciseCatalog.ts` is THE reviewed
    table (Kd signed it off BEFORE any code — P1.8a precedent; artifact
    `docs/catalog-58.md`). The seed imports it; the web resolves legacy library
    names through `slugForLegacyName` next card. One table, two consumers.
  · Slug rule = the Part 2 §6 name normalised. It reproduces all 11 slugs
    `tools/migrate-mongo/exerciseNames.ts` expects (asserted), so that frozen
    table needed no edit.
  · TWO SPEC GAPs ruled by Kd, both F11: `brisk_walking` had NO family and the
    column is NOT NULL; `arm_circles` had TWO ("F11/F8 hybrid").
  · Seed insert batched: one statement, not 58 round-trips (api 327s → 261s).

READ THIS IF YOU TOUCH THIS AREA AGAIN
  **`slugForLegacyName` returns NULL rather than guessing, and the caller must
  respect that.** A fabricated slug is discarded server-side and leaves a 0-rep
  workout in history — the exact failure the catalog card existed to prevent.
  Never lowercase the display name instead: the slugs are singular and the
  names plural, so it resolves nothing (`exerciseNames.ts:13-16`).

  **A mutation harness that touches a SEED mutates the shared DATABASE, not
  just source.** A renamed-slug mutant was INSERTED by the test's own seed call;
  the DB sat at 59 rows after the source was restored. Cleaned and re-proved at
  58. Also: a `cd` mid-script broke the `cp` restore path and left a mutant
  live — restore must be verified by `cmp` from an ABSOLUTE path. Both are this
  repo's own recorded harness failures (:2736, :2614), incurred again in one run.

  **The spec answers more than it looks like it does.** I recorded an "OPEN
  RULING" for Kd about exercises with no catalog home; Part 2 §6:720-733 and
  Part 4 §3.4:373 had already answered it, and a grep proved none of those names
  is even in the library. Corrected in 6f83f55. Draft a ruling request AFTER the
  spec read, never before.

NEXT: the WEB WRITE PATH (its own card, per OWED's entry read IN FULL). Its
  blocker 1 is discharged; blocker 2 stands — `completeSession` STAYS (Kd ruled;
  dropping it makes the post-workout screen show 0s AND a "+50 XP" never
  awarded). Hook `handleSetComplete` (ActiveWorkout.jsx:386) plus the three
  engineSetKey bump sites (:426, :483, :508) and the discard at :359-366 — NOT
  the rep counter, because a "Complete Set" button (:1004) ends sets early. That
  card also owes the `syncClient.test.js` local VITE_API_URL failure.

VERIFY (needs DATABASE_URL from the gitignored apps/api/.env):
        corepack pnpm --filter @app/shared exec vitest run
        cd apps/api
        DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-)" \
          corepack pnpm exec vitest run
PROVE: api **381/381** real Postgres (374+7) · shared **41/41** (25+16) ·
      web 272/273 (the 1 = the known local env quirk, :3332, unchanged) ·
      typecheck + lint clean on api and shared. MUTATION: 9 shared + 1 DB, all
      RED against a re-established green baseline (41/41), one shown failing at
      assertion level to prove RED ≠ "suite never ran".
SMOKE: none owed — nothing user-visible changed. The write-path card owes one.
SPEC GAPs: two, both RULED by Kd this session (above). None open.
KNOWN, NOT MINE: `db.migration.test.ts`'s 0009 test needs 5079 ms against a
      5000 ms default — fails on network weather, has its own OWED line.
```

```
TASK: log-only sets — T3 ROUND 1 FIXES + the F3 RULING. 6 findings, ZERO VISIBLE,
      all now resolved (63b45e0, c6a3a5d on web-repoint). api 374/374.
      **ROUND 2 IS THE CAP** — set before round 1 ran. Diff for it:
      `t3-log-only-sets-r2.diff`.

WHAT THIS SESSION DID
  · **Both halves of the card's central claim were FALSE**, and the DB said so:
    `NULL IS DISTINCT FROM 'engine'` → TRUE, so ANY row omitting `mode`
    satisfied the provenance guard with both provenance columns NULL. Before
    0009 the NOT NULL made that impossible for EVERY writer; my version made it
    impossible only for writers that DECLARE `mode='engine'`. A regression
    dressed as a guard, and the commit message claimed the opposite. The
    log-only CHECK likewise ignored the provenance columns entirely.
  · **Why it shipped (F4): the belt had NO test.** All nine "covering"
    assertions were Zod's, returning 400 before the DB was reached — they would
    all have passed with the constraints DELETED. Fixed with direct-INSERT
    `23514` cases, then mutation-checked: broken constraints restored → test
    RED; correct ones restored → green.
  · Re-adding the fixed constraint then FAILED on a real row — the fully-scored,
    provenance-less set the OLD constraint had just accepted during the red run.
    The bug, having actually happened, blocking its own fix. Best evidence there
    was; debris cleared.
  · F5 the wire demanded `[]` for log-only repScores while the column demands
    NULL, with repo.ts translating under a comment calling `[]` a fabrication.
    Contract now says NULL; translation gone.
  · F6 `engineVersion` accepted `""` alongside `avgFormScore: 100`. Now
    `.min(1)`, and **`mode='engine'` is recorded as a CLIENT CLAIM, not a
    verification** — nothing checks the version is real or that the exercise even
    HAS a definition. v1 §14 must not read the column as proof.
  · F3 RULED by Kd (option A): workout-level `engineVersion` means "the engine
    build the CLIENT was running", and `defsVersion` is now NULLABLE — matching
    Part 4 §3.5:384, which declares `bundle_version int` with no NOT NULL while
    our payload was stricter than the spec. No migration, no deviation.

READ THIS IF YOU TOUCH THIS AREA AGAIN
  **A test that has never been seen to fail is a claim, not protection.** Nine
  of them here could not have failed. Before trusting any constraint test, break
  the constraint and watch it go red.

  **Check what a NULLABLE discriminator does to a CHECK.** `x IS DISTINCT FROM
  'v'` is TRUE when x is NULL, so a guard written that way is satisfied by every
  row that simply omits it. Prefer rules about the DATA over rules about the
  label.

  **`mode='engine'` is a claim.** The OWED:484-496 threat model is unchanged by
  this card; the column just makes it queryable, which invites misreading.

NEXT: the WEB write path (its own card, fresh chat). `ActiveWorkout.jsx:536`
  still posts every workout to the OLD backend and `syncClient.js:72` still
  refuses to queue an all-log-only one. F3's ruling is what unblocks it.

VERIFY (needs DATABASE_URL from the gitignored apps/api/.env):
        cd apps/api
        DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-)" \
          corepack pnpm exec vitest run
PROVE: api 374/374 · shared 19/19 · typecheck + lint clean.
SMOKE: still none owed — no user-visible behaviour changed.
SPEC GAPs: none open.
```

```
TASK: Hand-logged workouts can reach the new API — **API HALF DONE** (267f443 on
      web-repoint). Kd-ruled and approved same day; migration SQL reviewed first.
      NOTHING USER-VISIBLE CHANGED YET — that is the next card.

WHAT LANDED
  · migration `0009_log_only_sets` — expand-only: 2 × DROP NOT NULL, 3 × ADD
    CHECK. (Drizzle emitted it as `0008_*` while `0008_user_xp` already existed;
    renamed to 0009 + journal tag fixed. Watch for this again.)
  · `workout_sets.mode` = 'engine' | 'log_only'. Part 4 §3.5 declared the column
    and NEVER its vocabulary — a SPEC GAP put to Kd, not invented.
  · provenance columns go NULL for a log-only set, never a sentinel.
  · the relaxation is NARROW, enforced in BOTH the CHECK and the Zod union: an
    engine set still MUST carry provenance; a log-only set CANNOT carry a form
    score, per-rep scores or faults, whatever a client sends.
  · `setSummarySchema` is now a UNION (engine | log_only). `mode` is OPTIONAL on
    the engine branch, so every pre-existing client validates unchanged.
  · `?? []` removed from the detail read — it became a fabrication once null was
    meaningful (an empty array claims a scoring pass that found no reps).

NEXT CARD (the one that actually changes behaviour): the WEB write path.
  `ActiveWorkout.jsx:536` still posts every workout to the legacy backend, and
  `syncClient.js:72` still refuses to queue an all-log-only one. Both must move:
  `queueWorkoutSync` builds the log-only set shape, and `completeSession` goes.
  Until then the cutover is still blocked and the OWED line stays open.

READ THIS IF YOU TOUCH THIS AREA AGAIN
  **The spec had already decided it.** Part 6 §3.6's degradation ladder ends in
  log-only mode with the user-facing copy "your workout still counts". Two chats
  (me included) treated this as an open product question. Read the spec § before
  asking Kd to rule on something it already answers.

  **Rows written before 0009 have `mode` NULL = UNKNOWN.** No backfill was done
  and none should be: nobody recorded how those sets were produced, and stamping
  them 'engine' would invent provenance retroactively.

  **XP:** a hand-logged workout earns base + streak XP, not the form bonus. Kd
  ruled this knowingly after seeing OWED:484-496 — XP is already entirely
  client-determined and sync has NO per-route rate limit. That fix stays with the
  P4.y plausibility card; `mode` is what makes "verified entries only" queryable.

VERIFY (needs DATABASE_URL — it is in the gitignored apps/api/.env):
        cd apps/api
        DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-)" \
          corepack pnpm exec drizzle-kit migrate
        DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-)" \
          corepack pnpm exec vitest run
PROVE: api 373/373 (real Postgres, 9 new log-only cases incl. the cross-tenant
      denial re-proof) · shared 19/19 · web 272/273 (the 1 = known env quirk) ·
      typecheck + lint clean on all six touched files.
SMOKE: none owed — no user-visible behaviour changed. The next card owes one.
SPEC GAPs: `workout_sets.mode` vocabulary — RESOLVED by Kd's ruling, recorded.
```

```
TASK: Kd's deploy-later RULING recorded + the workout calendar repoint BUILT AND
      PARKED AS BLOCKED. Branch web-repoint carries RECORDS ONLY (7aab8a0); the
      code is on `workout-calendar-parked` (7eaba8d) and MUST NOT BE MERGED.

READ THIS FIRST IF YOU ARE PICKING THE NEXT CARD
  **A workout reaches the new API only if it contains squat, jump squat or chair
  squat.** Chain, all command-verified: sessionController.js:67 (no definition →
  log-only) · 3 definitions exist of a 58-exercise catalog · syncClient.js:72
  (all-log-only never synced) · DECISIONS :75 (server enforces sets[] non-empty)
  · ActiveWorkout.jsx:536 (every workout still writes to the OLD backend).
  **After cutover, a workout of any other exercise would be saved NOWHERE.**
  That is now a 🔴 OWED item of its own; it was previously prose inside another
  line. It blocks the calendar, PostWorkout's summary and the Dashboard's stats
  alike, and what is owed FIRST is a Kd RULING (R0.2): where does a hand-logged
  workout live once the old backend is off?

WHAT THIS SESSION DID
  · Kd ruled: finish the CODE, buy the server later. P2.8 splits into a code half
    (now) and a deploy half (VPS, secrets, backup drill, DPDP worker running).
    The DPDP worker must be live before the first real SIGNUP, not just before
    the first deploy. Standing two-round review cap, set BEFORE each card runs.
  · Road-mapped the rest of P2.8 by command: 4 web api files still fully on the
    old backend (running 13 calls, workouts 10, exercises 5, recommendations 1),
    gamification mixed. Order: free repoints → missing backend homes → deploy.
  · Built the calendar repoint to PROVE (320/321, +48 tests, 18/18 mutants,
    build OK), THEN read OWED:503 and parked it.

READ THIS IF YOU TOUCH THIS AREA AGAIN
  **An index entry you skipped is not evidence of absence** (:2825, incurred
  again). OWED:503 opens with "BLOCKED — NOT a client repoint. Do not pick this
  up as a quick win" and lists three blockers; I read the ONE-LINE version in
  cutover.md and became the THIRD chat to recommend this card as the cheap one.
  The full entry would have supplied the whole card in advance.

  **A repoint that nothing asserts is a repoint the next edit silently undoes.**
  Mutation M18 reverted getHistory to the old backend and all 46 tests stayed
  GREEN — the render suite must mock the api client, so nothing checked WHICH
  backend was called. Closed with a recordRequests guard in BOTH directions.
  Any future repoint card needs this guard from the start.

  **A harness must verify the thing it asserts.** This one shipped two of the
  PostWorkout harness's own recorded bugs before its first run: `git checkout --`
  restore (cannot restore untracked files; destructive on a dirty tree) and a
  parser blind to vitest's ANSI, which made the FIRST run report BASELINE
  INVALID rather than silently grading 18 mutants on an unreadable instrument.

NEXT: Kd rules on the log-only/write-path question (the 🔴 OWED item above). It
  is the gate for every workout-history surface. The other genuinely-free
  repoint left is `/v1/exercises` (exerciseApi list read) — smaller, and NOT
  blocked by this, but check its OWED entry IN FULL first.

VERIFY (on `workout-calendar-parked`, not web-repoint):
        corepack pnpm --filter web exec vitest run
        bash apps/web/tools/mutate-workout-calendar.sh
LINT: 1 error on WorkoutCalendar.jsx (pre-existing set-state-in-effect; the file
      produced 2 at HEAD, so parity improved). Its own OWED line.
SMOKE: NOT RUN — smoking a screen that must not ship would waste Kd's time.
SPEC GAPs: none. The log-only question is a RULING request, not a spec gap.
```

```
TASK: PostWorkout summary reader — T3 ROUND 3 FIXES. **CARD CLOSED, OWED TICKED.**
      9 findings, ZERO VISIBLE. Branch web-repoint. 1 test file + harness + rig +
      smoke doc + records. web 272/273. 27 mutations, 27 RED, baseline green
      before AND after.

WHAT THIS SESSION DID
  · F1 — round 2's harness baseline was an INSTANCE fix: it proved the runner
    exited 0, not that a test RAN. `vitest -t "NoSuchDescribeName"` exits 0 with
    everything skipped, so renaming the describe block turned the gate into a
    no-op that PASSED it. Now every run's output is parsed for a real
    `Tests N passed` / `Tests N failed`, baseline runs before AND after, and a
    crashed runner reports INVALID instead of RED.
  · THEN THE SAME CLASS AGAIN, found by me after the round: a run printed "ALL
    MUTANTS CAUGHT" while its output carried `cp: ... Permission denied` between
    M7 and M8 — the restore had failed, so M8 ran with M7 still applied. Restores
    are checksum-verified and fatal now.
  · F2/F3 — five list-element guards unprotected; a `>= 4` floor over a 6-dash
    fixture; the third list never got unreadable elements.
  · F4 — the restore check compared to HEAD, so on a dirty tree it prescribed
    `git checkout --` on files that were fine. The only destructive instruction
    this card ever shipped.
  · F5 — the sweep vocabulary was at 5 of 9 states while the record said "every
    state". Two false NUMBERS corrected, and BOTH the record's and the reviewer's
    were wrong: grep -c returns 29 LINES, grep -o returns 40 OCCURRENCES, 4 lines
    are prose. Line counts and read counts are different quantities.
  · F6 — the smoke doc's control step was stale after round 2 changed the rig.
  · F8/F9 — a /g mutation could not tell a class fix from a combined one; another
    was anchored by indentation alone.
  · F7 → OWED (rig states for two browser-unreachable paths).

READ THIS IF YOU TOUCH THIS AREA AGAIN
  **A harness must verify the thing it asserts, at every point.** This one claimed
  success it had not earned THREE times: a dead runner (round 2 F3), a suite that
  never ran (round 3 F1), and a failed restore leaving two mutations live (found
  after round 3). Each time the previous fix had closed the demonstrated case and
  left the class. If you write a checking tool here, ask what it would print if
  the thing it checks with were broken.

  **"Fixed the instance, left the class" is this card's signature failure** — six
  instances now, each found in the fix written for the previous one. After any
  rename or guard change, enumerate EVERY site and mutate each one.

NEXT: pick a new card. Scope it to ONE screen's payload (THE CAP, :2158). The
  natural candidates on OWED are the badge-catalog/challenges screens, predictions,
  the exercise-library content, and the running/geo repoint — the last of which has
  ZERO readers today and fabricates a weather-risk colour on a safety signal.

VERIFY: corepack pnpm --filter web exec vitest run
        bash apps/web/tools/mutate-postworkout-summary.sh
LINT: touched files clean. No component file changed in ANY of the three rounds,
      so no re-smoke is owed.
SPEC GAPs: none.
```

```
TASK: PostWorkout summary reader — T3 ROUND 2 FIXES. 6 findings, ZERO VISIBLE,
      ALL FIXED. Branch web-repoint. 1 test file + harness + rig + records.
      web 272/273. Green baseline + 21 mutations, 21 RED. TICK STILL OFF.

WHAT THIS SESSION DID
  · F3 is the important one: the mutation harness had NO GREEN BASELINE, so "RED"
    could not distinguish "an assertion caught it" from "the tests never ran" —
    proven with a broken runner that produced a full table of REDs and exit 0.
    The suite must now pass unmutated first; verified with the reviewer's own
    probe (exit 1, mutation table never reached).
  · F1 — the Workout Time SUB-LINE had no assertion that could fail; mutating its
    field printed "NaNh NaNm total" in the HEALTHY state. Root cause: no fixture
    had active_seconds absent with duration_minutes present, so the whole
    minutes-fallback arm never ran at either surface.
  · F2 — round 1's own /null/ sweep was added at ONE of its two sites.
  · F4 — a comment's evidence was false (the rig's healthy PRs are an array, not
    a bare string); corrected, and the rig now carries BOTH record shapes so that
    path is browser-reachable for the first time.
  · F5 — unreadable list elements render as N dashes, a fabricated COUNT; fixture
    added, and drop-vs-preserve is a Kd question on OWED.
  · F6 — harness restoration was silent on an uncatchable kill.

READ THIS IF YOU TOUCH THIS AREA AGAIN
  **"Fixed the instance, left the class" is this card's most reliable output —
  FOUR times now**: xp_earned → current_streak → durationMinutes → the /null/
  sweep's own second site. Each was found in the fix written for the previous one.
  After a rename, the unit of work is EVERY field that rename touched at EVERY
  surface, enumerated and mutated — not spot-checked.

  **A mutation table without a green baseline is a rubber stamp.** This is the
  general form and it applies to any harness anyone writes here next.

  **The rig's healthy state now has two personal-record shapes.** If a smoke is
  re-run, one extra trophy row in `healthy` is expected, not a defect.

NEXT: Kd rules — (a) a T3 round 3, or (b) an explicit per-card stopping ruling.
  A chat may NOT choose (b) for itself (DECISIONS :2546 records that slip).

VERIFY: corepack pnpm --filter web exec vitest run
        bash apps/web/tools/mutate-postworkout-summary.sh
LINT: xpDisplay.render.test.jsx + mock-ml-backend.mjs clean. No component file
      changed in round 1 OR round 2, so no re-smoke is owed on that ground.
SPEC GAPs: none.
```

```
TASK: PostWorkout summary reader — T3 ROUND 1 FIXES. 6 findings, ZERO VISIBLE,
      ALL FIXED. Branch web-repoint. 1 test file + 1 new harness + records.
      web 270/271. 18 mutations, 18 RED. TICK STILL OFF — Kd's call, two
      options written at the OWED line.

WHAT THIS SESSION DID
  · F1 — the sweep checked `undefined`/`NaN`, the spellings the PRE-fix code
    produced, and not `null`, the one the NEW code produces (`${null}` → "null%").
    Confirmed by re-mutation before fixing.
  · F2 — `current_streak` renders at BOTH surfaces, asserted at NEITHER. Renaming
    it left 44/44 green while the pill and the tile both vanished. **This is the
    xp_earned regression from the same commit, one field over.**
  · F3 — all four list-element render bodies were unreachable (every fixture had
    [] or a string the reader nulls). New SUMMARY_LISTS fixture, both PR shapes.
  · F4 — the empty-200 test proved the toast, not the redirect.
  · F5 — "13 mutations, 13 RED" was unreproducible from the repo. The harness is
    now committed and runnable.
  · F6 — a helper's doc claimed a protection it cannot give; claim narrowed.

READ THIS IF YOU TOUCH THIS AREA AGAIN
  **Fixing the instance is not fixing the class, and this card proves it twice.**
  The xp_earned rename regression was found by grep and fixed with an identity
  assertion — and `current_streak`, four sites away in the same file and the same
  commit, was left exactly as exposed. When a rename breaks one field, enumerate
  EVERY field that rename touched, at every surface.

  **A sweep is not an assertion.** `not.toMatch(/undefined/)` says a string is
  absent from the document; it never says a particular site rendered honestly, and
  it silently misses whatever spelling the new code produces.

  **The harness is at apps/web/tools/mutate-postworkout-summary.sh.** Run it before
  claiming any assertion protects anything. It exits non-zero if a mutant survives
  OR if a sed fails to apply — the second guard exists because an unmatched sed
  leaves the source pristine and reads as a surviving mutant that never existed.

NEXT: Kd rules on the tick — (a) a T3 round 2 on the fix commit, or (b) an
  explicit per-card stopping ruling. A chat may NOT choose (b) for itself; one
  already overstepped that on this card (DECISIONS :2546, the process slip).

VERIFY: corepack pnpm --filter web exec vitest run
        bash apps/web/tools/mutate-postworkout-summary.sh
LINT: xpDisplay.render.test.jsx clean. No component file changed this round, so
      no re-smoke is owed (the Round B precedent, DECISIONS :1950).
SPEC GAPs: none.
```

```
TASK: PostWorkout's summary payload gets a reader (OWED.md:730). Branch
      web-repoint. 5 files + RUNBOOK smoke doc + DECISIONS/INDEX/OWED/HANDOFF.
      web 269/270 (the 1 = the known syncClient env quirk). +21 tests.
      OWED TICK WITHHELD: needs Kd's smoke AND a fresh-chat T3.

WHAT THIS SESSION DID
  · `readSummaryView` + `formGrade` + workoutTimeLabel/Short + totalTimeLabel +
    formatPercent + readPersonalRecord/readMealSuggestion, all in
    gamificationApi.js beside readStatsView (which parses a workoutService
    payload too — the location is precedent, not a new pattern).
  · Fixed, each proven by a test written RED first: an absent form score printing
    grade D / "Keep practicing" / red; "NaNh NaNm" for the time on page AND PNG;
    "undefined kcal"; a blank Exercises tile; a string-shaped list reaching .map
    and blanking the whole page; and a 200 with no `summary` rendering a blank
    white screen with no toast.
  · ONE grade ladder now serves the page and the share card. ShareCard's twin
    (`getGrade`) is deleted.
  · Kd's rulings at the gate: "Not scored" copy · empty-200 = the page's existing
    toast+redirect · fold in the zero-active-seconds fix · calories rounding is
    report-only.
  · 13 mutations, 13 RED. New `unscored` rig state + RUNBOOK/smoke-postworkout-
    summary.md, with the `healthy` CONTROL as step 1.

READ THIS IF YOU TOUCH THIS AREA AGAIN
  **A whole-document sweep is satisfied by the SHARE CARD.** This commit shipped a
  real regression and 7 render tests stayed green: `xp_earned` survived the
  snake→camel rename at one of two sites, the page's XP card read "—" for every
  workout, and test 1's `/\+70/` matched the PNG's copy instead. Round 1 F1
  verbatim, in the card that quotes round 1 F1. Found by GREP, not by the tests.
  Anything that renders at two surfaces needs an identity assertion at BOTH.

  **The control is not optional.** Step 1 of the smoke is `healthy`, because the
  one outcome this card must not have is dashing out numbers the backend really
  sent, and no amount of unknown-state testing can see that.

  **The md5 guard in the mutation harness earns its place.** A sed that fails to
  match leaves the source pristine, the tests pass, and the run would record a
  surviving mutant that never existed.

STILL OPEN (all have OWED lines — nothing left in prose):
  · 🟡 this card's own line, until the smoke and the T3
  · ⚪ calories rounded in the PNG but not on the page
  · ⚪ an empty meal/stretch list renders a heading over blank space
  · 🟡 RUNBOOK/cutover.md is stale (added earlier this session)

NEXT: Kd runs RUNBOOK/smoke-postworkout-summary.md, then a fresh-chat T3 on the
  commit. Do NOT tick the OWED line before both.

VERIFY: corepack pnpm --filter web exec vitest run
        corepack pnpm --filter web exec vite build
LINT: parity, measured both ways — the two source files at HEAD produce 5
      problems (4 errors, 1 warning), the five touched files produce the same 5
      after; all in Confetti's untouched Math.random + the pre-existing
      exhaustive-deps warning. Package-wide 67 errors / 9 warnings.
SPEC GAPs: none.
```

```
TASK: XP display / Dashboard XP — T3 ROUND 11 FIXES. **CARD CLOSED.**
      Branch web-repoint. 4 files + OWED/DECISIONS/HANDOFF.
      Suite 93/93 green (90 + 3). BOTH 🔴 OWED TICKS ARE NOW ON.

WHAT THIS SESSION DID
  · F1 (VISIBLE) — and it was a REGRESSION ROUND 10 INTRODUCED. `weekDates`
    does LOCAL calendar arithmetic and serialises in UTC; round 10 routed the
    PRINTED day number through the UTC string. Re-measured before touching
    anything: at 02:00 IST on Wed 29 Jul the strip printed 26 27 28 29 30 31 1
    against a calendar reading 27 28 29 30 31 1 2, with the orange "today" cell
    showing yesterday — 5.5 hours of every day in the home market. In UTC the
    two agree, which is exactly why 90 tests passed. Fixed: weekDates returns
    { key, day } — key stays UTC (the backend buckets UTC), day is local.
  · F2 — two assertions that could not fail: one dominated by a stricter check
    that throws first, one whose producer the round 10 fix had made bounded.
    Reordered and deleted respectively.
  · F5 — the round 7 F2 doc block was orphaned above weekDates. Reattached.
  · F6 — WeekStrip and the caption each called new Date(). The parent reads the
    clock ONCE now and passes the week down.
  · 10 mutations, 9 RED.

READ THIS IF YOU TOUCH THIS AREA AGAIN
  **Agreement is not correctness.** Round 10's invariant (caption == dots) held
  the whole time F1 was live: both read the same broken array, so they agreed
  and were both wrong. An invariant between two consumers of one source says
  nothing about whether the source is right.

  **The date-axis tests MUST pin the timezone AND carry a positive control that
  the pin took effect.** `globalThis.process.env.TZ` is set per test with
  `expect(instant.getDate()).toBe(29)` beside it. Without that control a runtime
  ignoring the switch makes local == UTC and every assertion passes vacuously —
  the exact mechanism by which F1 survived 90 tests. Use `globalThis.process`,
  not `process`: this package lints as a browser env (5 no-undef errors
  otherwise, measured).

  **P9 is a DECLARED survivor, not a gap.** The strip reading its own instant
  can only diverge from the parent's across UTC midnight, so no assertion can
  see it. Do not add one.

  **The round 10 F1 render fixture re-implements weekDates** (own OWED line).
  Its comment used to claim independence; that claim is corrected. It proves the
  caption and dots agree — NOT that either is right. The unit tests are what
  prove correctness.

STILL OPEN (all have OWED lines — nothing left in prose):
  · 🔴 week strip date axis, RENDER side: no assertion reads a day number, a
    label↔date relationship, or which seven days are covered. Needs
    vi.setSystemTime + a pinned TZ in the render file; fake timers interact with
    framer-motion's waits, which is why it is a line and not a same-commit fix.
  · 🔴 round 8 F6's other EIGHT mutants (MUT-3/4/15/16/17/29/2/10) — never
    addressed by Round B or rounds 9, 10, 11.
  · 🟡 the render fixture's re-implementation of weekDates.
  · 🟡 ExerciseLibrary.jsx:63 — a FOURTH one-of-N site, different card.

NEXT: this card is DONE — no round 12 (THE CAP, DECISIONS 2026-07-29). Pick up
  the next repoint card. **Scope it to ONE screen's payload**: eleven rounds on
  this one is recorded in DECISIONS as a finding about the CARD, not the code —
  it bundled nine screens into one unit of work, which Part I §1 exists to stop.

VERIFY: corepack pnpm --filter web exec vitest run src/api/gamificationApi.test.js src/pages/xpDisplay.render.test.jsx
        corepack pnpm --filter web exec vite build
LINT: parity. Four touched files 0 problems; package-wide 67 errors / 9 warnings.
SPEC GAPs: none.
```

```
TASK: XP display / Dashboard XP — T3 ROUND 10 FIXES. 4 findings, ALL FIXED.
      Branch web-repoint. 4 files + OWED/DECISIONS/HANDOFF.
      Suite 90/90 green (87 + 3). OWED ticks STILL OFF.

WHAT THIS SESSION DID
  · F1 (VISIBLE) — the week caption counted SESSIONS (`weekly_workouts`, since
    Monday) and was labelled "days active", above dots drawn from `activity`
    (keyed by DAY, over a ROLLING seven days). TWO mismatches, verified at
    backend-ml/app/routers/workouts.py:72-74 and :86-89 — the review named one.
    "5 of 7 days active" over 3 flames; "10 of 7 days active" past 7 sessions.
    New `weekDates()` in gamificationApi.js; the caption and WeekStrip both use
    it, so a count and a picture of one week cannot be two answers.
  · F2 — round 9 asserted PRESENCE on six neutral style slots and NEUTRALITY on
    two. A neutral slot set to bronze is still valid CSS, so 4 mutants lived.
  · F3 — the completeness loop listed 5 of 7 fields AND only ever ran over the
    NEUTRAL tier. Extending it (the prescribed fix) still left the four KNOWN
    tiers unchecked: deleting `tint` from bronze survived at 89/89. Second test
    added for the known half + both difficulty vocabularies.
  · F4 — the recommendation pill's BACKGROUND knew one vocabulary while its
    label knew two, so difficulty 'easy' was a green label on a red pill.
  · 13 mutations, 12 RED. Round 9's re-run as regression: all still RED.

READ THIS BEFORE ROUND 11
  **The one GREEN mutant is declared and is NOT a gap to close.** M3 (WeekStrip's
  date +24h) is a DATE-DEPENDENT equivalent: `weekDates(t)` subtracts t's own
  Monday offset, so t and t+1d are identical except across a Sunday boundary —
  on a Sunday it IS caught. Do not add an assertion for it. The decoupling it
  probes (caption and dots on different windows) IS caught: M13 is RED.

  **The caption's zero is now a FACT, not a fabrication.** `activity` arrived and
  empty ⇒ "0 of 7 days active" is true. Unknown lives only in the
  "Weekly activity unavailable" arm. Two old tests pinned the old source and
  went red on the fix — that is the R9.5 evidence, not an accident.

  **Round 8 F6's other EIGHT mutants are STILL open** (own 🔴 OWED line):
  MUT-3/4/15/16/17/29/2/10. Not addressed by Round B, round 9 or round 10.

  **Do NOT re-report:** Object.create(null); A1 (equivalent, round 9 verified);
  the apps/web lint exclusion; syncClient.test.js.

NEXT: T3 ROUND 11, fresh chat, on this commit. Round 10's own verdict was that
  round 11 "should be able to close this, and I would hold it to that".

VERIFY: corepack pnpm --filter web exec vitest run src/api/gamificationApi.test.js src/pages/xpDisplay.render.test.jsx
        corepack pnpm --filter web exec vite build
LINT: parity. Six touched files = 1 error (ChevronRight, pre-existing);
      package-wide 67 errors / 9 warnings.
MUTATION HARNESS RULE (round 9's failure, now enforced in code): re-snapshot
      UNCONDITIONALLY at the start of every run, or delete the snapshot between
      runs. Two harnesses with overlapping file sets is how three source files
      got silently reverted mid-run.
SPEC GAPs: none.
```

```
TASK: XP display / Dashboard XP — T3 ROUND 9 FIXES. 4 findings, ALL FIXED.
      Branch web-repoint. 6 files + OWED/DECISIONS/HANDOFF.
      Suite 87/87 green (84 + 3). OWED ticks STILL OFF.

WHAT THIS SESSION DID
  · F1 (VISIBLE) — Round A's own `${color}NN` hazard, applied to 1 of 8 sites.
    The other 7 dropped their colour entirely when the value is the neutral
    rgba: a progress bar with NO FILL beside "2 / 5" and "40%", on two
    components. `difficultyStyle()` now sits beside `tierStyle()` with
    tint/edge/bar/barSoft fields; known values byte-identical; NO call site
    concatenates any more (grep-verified zero).
  · F4 (VISIBLE, pre-existing) — round 5 F8's other direction. Caption needed
    state AND a known count; dots need only the state. So `activity` with no
    `weekly_workouts` lit 7 definite dots (4 flames) under "Weekly activity
    unavailable". Caption answers the STRIP's question now, via formatCount.
  · F2 (NOT-VISIBLE) — Round B's tile helper covered 2 tiles of 3. The LEVEL
    tile was unasserted, and `xp ? formatLevel(xp) : '1'` beat FIELD_READ,
    HELPER_CALL and the render suite at once.
  · F3 (NOT-VISIBLE) — one of Round B's four new assertions COULD NOT FAIL:
    the regex wants digits next to "XP", Achievements spells it "N total XP".
    Replaced by identity on the whole line.
  · 12 new mutations, 12 RED (incl. a positive control). Round B's 9 re-run,
    all still RED, identical counts.

READ THIS BEFORE ROUND 10
  **A mutation harness must re-snapshot at the start of every run, or be
  deleted between runs.** Two harnesses were live this session with overlapping
  file sets; the older one held snapshots from BEFORE round 9's fixes, so its
  `restore` silently reverted three source files mid-run. The tell was the
  failure COUNTS climbing run over run, not any error. Third process failure of
  this family (rounds 3 and 5 were `git checkout --` and a PowerShell
  round-trip); first with a stale snapshot as the cause. Round 9's own 12
  mutations were unaffected — own snapshot, correct tree.

  **Round 8 F6's other EIGHT mutants are STILL open** (own 🔴 OWED line):
  MUT-3/4/15/16/17/29/2/10. Round 9 did not re-measure them either.

  **Do NOT add a test for `Object.create(null)`** (Round A's declared survivor)
  and do not re-report A1, which round 9 verified is an equivalent mutant:
  `weekState === 'ready'` and `activity !== null` cannot diverge.

NEXT: T3 ROUND 10, fresh chat, on this commit. Both 🔴 ticks stay OFF until it
  is clean. Round 9's verdict was "worth one more round; not worth a tenth" —
  that was about round 9 itself, so round 10 is the one that should close this.

VERIFY: corepack pnpm --filter web exec vitest run src/api/gamificationApi.test.js src/pages/xpDisplay.render.test.jsx
        corepack pnpm --filter web exec vite build
LINT: parity, not clean. SIX touched files = 1 error (ChevronRight,
      pre-existing, R1.1); package-wide 67 errors / 9 warnings, unchanged.
      (Round B's "0 problems" was true of its TWO test files only.)
SPEC GAPs: none.
```

```
TASK: XP display / Dashboard XP — T3 ROUND 8, ROUND B. F1, F2, F6 FIXED.
      Branch web-repoint. 2 test files + OWED/DECISIONS/HANDOFF.
      NO COMPONENT FILE CHANGED — all three were TEST-layer defects.
      Suite 84/84 green (81 + 3 new). OWED tick STILL OFF.

WHAT THIS SESSION DID
  · F1 — Sidebar is MOUNTED now. It was in no render test at all, and the
    source guard's FIELD_READ needs a `.` or `[` after `xp`, which
    `(xp ?? { level: 1 }).level` does not have (the `.level` follows a paren).
    Two protections, one blind spot. Asserted at BOTH its level sites:
    `Level {…}` in the flame row and the `L{…}` badge beside it.
  · F2 — one Achievements test with getMe DEAD. All 13 of its tests used
    XP_LEVEL_3 (counted; the kickoff said 12), so that page's formatters had
    never once run on an unknown block.
  · F6 — the three `getAllByText('—').length >= 3` floors are GONE. Five sites
    render the dash in the dead fixture, so the floor had two dashes of slack.
    Replaced with per-site identity (`statValue`/`tileValue`) + a whole-document
    `\b0\b` sweep. `Your Rank` got its own assertion — the old `of 0` check
    reads the TOTAL, not the rank.
  · 9 mutations, 9 RED. Restored from `cp` backups, never `git checkout --`.
  · Both "all ten bypasses fail there" claims CORRECTED, in the same commit.

READ THIS BEFORE ROUND 9 / ANY FURTHER WORK
  **The corrected claim was NOT replaced with a new strong one.** The guard
  header and DECISIONS:1173 now say only what was measured: the two bypasses
  round 8 caught passing are caught (B1/B3, today); the other eight are a
  ROUND 4 measurement not re-run since. Kd was offered the alternative — re-run
  all ten — and chose the measured wording. Do not "tidy" it back.

  **Round 8 F6's other EIGHT mutants have their own 🔴 OWED line.** F6's table
  listed twelve; the prescription covered the four numeric ones. MUT-3/4/15/16/
  17/29/2/10 were NOT addressed and NOT re-measured. That line is the record —
  do not treat F6 as fully closed.

  **`getByText` is doing load-bearing work.** It throws when its anchor is
  absent or ambiguous, which is why the new identity assertions cannot pass
  vacuously and why B9 (deleting a whole stat card) turns three tests red. Do
  not "simplify" statValue/tileValue into querySelector lookups.

  **Do NOT add a test for `Object.create(null)` in Achievements** — Round A's
  one surviving mutant, inert while `Object.hasOwn` stands (DECISIONS
  2026-07-29). Adding one is the vacuous assertion this round is about.

NEXT: T3 ROUND 9, fresh chat, on Rounds A + B together (7b91c68 + this commit).
  Both OWED 🔴 ticks stay OFF until it is clean.

VERIFY: corepack pnpm --filter web exec vitest run src/api/gamificationApi.test.js src/pages/xpDisplay.render.test.jsx
        corepack pnpm --filter web exec vite build
LINT: parity, not clean — apps/web is excluded from the root gate. Touched
      files 0 problems; package-wide 67 errors (same as Round A and as round
      8's reviewer measured).
NOTE: syncClient.test.js still fails locally (apps/web/.env sets VITE_API_URL).
      Known, on OWED, NOT ours — not in the two files above.
SPEC GAPs: none.
```

```
TASK: XP display / Dashboard XP — T3 ROUND 8, ROUND A. F3, F4, F5 FIXED.
      Branch web-repoint. 6 source/test files + OWED/DECISIONS/HANDOFF.
      Suite 81/81 green (75 pre-existing + 6 new). OWED tick STILL OFF.

WHAT THIS SESSION DID
  · Wrote 6 tests FIRST and showed all 6 RED before touching any source (R9.5 —
    the gate round 7 failed). The F4 red run reproduced the reviewer's Probe C
    exactly: `TypeError: badgesByCategory[key].push is not a function` with the
    body rendering `<div />`. The blank page was real.
  · F4 — `Object.hasOwn(CATEGORY_LABELS, b.category)` + `Object.create(null)` in
    Achievements; the same prototype hazard at the tier lookup died with F5.
  · F3 — `weekState = oldPayloadState({data: stats.activity, loading})`; the
    strip takes the STATE, so caption and all seven tooltips answer together.
  · F5 — `tierStyle()` exported from gamificationApi.js beside difficultyColor;
    Achievements' local TIER_CONFIG/NEUTRAL_TIER deleted; BOTH sites call it.
  · 11 mutations: 10 RED, 1 GREEN (declared green in the plan BEFORE it ran).
  · Lint measured as PARITY (1 error at HEAD, same 1 after; 67 package-wide
    both times) because apps/web is excluded from the root lint gate.

READ THIS BEFORE ROUND B
  **The one surviving mutant is not a gap to close.** `Object.create(null)` in
  Achievements is behaviourally inert while the `Object.hasOwn` check stands —
  no assertion can distinguish it, and the source comment says so. Do NOT add a
  test for it in Round B; adding one would be the vacuous assertion rounds 6 F11
  and 7 F3 are about. The reverse (hasOwn removed, null prototype kept) IS
  caught.

  **F5's enumeration is recorded in DECISIONS 2026-07-29** — every
  colour-from-a-nullable-field site in the card's ten files, with the two fixed,
  the six already correct, and the one excluded by an OWED citation. Round B
  does not need to redo it.

  **A trap for anyone touching the tier colours:** `${tierStyle(t).color}40` is
  invalid CSS for the neutral rgba value, so the border silently disappears in
  exactly the unknown state. Use the `edge` field. Mutation F5-e pins it.

NEXT: ROUND B — F1, F2, F6 (the PROTECTION layer), fresh chat.
  F1 Sidebar is mounted by NO render test and FIELD_READ misses `xp ??`; the
  "all ten bypasses fail there" claim at gamificationApi.test.js:454-457 and in
  DECISIONS 2026-07-26 (line 1173) must be CORRECTED in that same commit.
  F2 no Achievements test runs with getMe DEAD. F6 the three `>= 3` dash floors
  at the render test's :144/:161/:182 let four numeric fabrications through.
  Mutation-test every new assertion before it counts.

VERIFY: corepack pnpm --filter web exec vitest run src/api/gamificationApi.test.js src/pages/xpDisplay.render.test.jsx
        corepack pnpm --filter web exec vite build
NOTE: syncClient.test.js still fails locally (apps/web/.env sets VITE_API_URL).
      Known, on OWED, NOT ours — it is not in the two files above.
SPEC GAPs: none.
```

```
TASK: XP display / Dashboard XP — T3 ROUND 8 RECEIVED AND RECORDED. The card
      FAILED it: 6 blocking findings, 15 of 31 mutants survived.
      [NO CODE FIXED THIS SESSION. Records only. The fix is Round A, below.]
      Branch web-repoint. Working tree: records + the findings file, committed.

WHAT THIS SESSION DID
  · Regenerated `t3-xp-web-r8.diff` (it was stale — cut one minute after round
    7's commit, with 4 of its 12 files changed since).
  · Wrote RUNBOOK/smoke-xp-dashboard.md; RAN the re-smoke with Kd: 11/11 PASSED.
  · Received T3 round 8, VERIFIED all six findings against the current files
    before planning anything, and recorded them verbatim at
    `t3-xp-web-r8-FINDINGS.md`.
  · OWED, DECISIONS and this file updated. Ticks REMAIN OFF.

READ THIS BEFORE FIXING ANYTHING
  **The smoke passing and the T3 failing are not in tension.** The smoke reaches
  the ten states the mock rig can produce; F4 needs a badge whose `category` is
  a prototype name, which the rig never sends, and F1/F2/F6 are properties of the
  TEST SUITE and not of the running app. Do not let "but the smoke passed" soften
  any of these.

  **F1 is the card's own defect, alive.** `Level {(xp ?? { level: 1 }).level}` in
  Sidebar survives BOTH protections: the source guard's FIELD_READ demands a `.`
  or `[` after `xp`, and Sidebar is mounted by NO render test — the one consumer
  where the original `user?.level || 1` bug lived is the one with zero DOM
  coverage. The guard's comment claiming "all ten bypasses fail there" is FALSE
  and must be corrected in the same commit that fixes it (it is the fifth false
  claim that section has carried).

THE FIX IS SPLIT — Kd ruling 2026-07-28
  · **ROUND A (next): F3, F4, F5 — the LIVE defects.** Failing test first, R9.5.
    F4 blanks the whole Achievements page via a prototype-chain `in` lookup on
    external input. F3 claims "Weekly activity unavailable" during an in-flight
    read, permanently against a hung backend. F5 paints an unknown badge tier
    BRONZE in GamificationStrip while Achievements renders it neutral.
  · **ROUND B (after A): F1, F2, F6 — the PROTECTION.** Sidebar + Achievements
    render coverage, the FIELD_READ bypass, and the three `>= 3` dash floors that
    let four numeric fabrications through. Mutation-test EVERY new assertion
    before it counts — rounds 6 F11 and 7 F3 are both about assertions that
    could not fail.
  · Four non-blocking findings are on OWED with lines, not in A or B.

STATE OF THE MACHINE (still running at handover; kill if not wanted)
  · new API :3000 · web :5173 · mock old :8000 (state = healthy)
  Docker is NOT running and is NOT needed — DATABASE_URL is Neon, no REDIS_URL.
  The API prints nothing for >30s on first boot; curl /health, don't assume dead.
SMOKE FIXTURE: smoke-xpdash-1785229803361@example.com (Level 3 / 332/374 / 680).
SPEC GAPs: none.
```

```
TASK: XP display / Dashboard XP — THE RE-SMOKE. [PASSED, all 11 steps, 2026-07-28.
      OWED ticks still OFF: round 8 has not run.]
      Branch web-repoint, HEAD fb4a65d + this commit. No app code changed this
      session — the only source edit is the rig-trap fix in the runbook.

WHAT WAS DONE
  · `t3-xp-web-r8.diff` REGENERATED. The copy at the repo root was cut 07-27
    14:14, one minute after round 7's commit 9644fa5, and c681b23 + 7f9f4cb have
    since touched 4 of its 12 files (gamificationApi.js, gamificationApi.test.js,
    useXp.js, xpDisplay.render.test.jsx). Round 8 would have audited code that no
    longer exists. Scoped `1164a86..HEAD -- <the card's 10 files>`: 10 files,
    2825 insertions. NOT `master..HEAD`, which is 54 files / 12229 insertions —
    the whole branch including the PostWorkout card. DECISIONS already records
    that mistake once ("would have buried this card's 358 lines").
  · `RUNBOOK/smoke-xp-dashboard.md` WRITTEN, then corrected by its own run.
  · `t3-xp-web-r8-PROMPT.md` written, ready to paste.
  · SMOKE RUN: all 11 steps PASSED. Result block is in the runbook.

THE SMOKE'S ONE STRUCTURAL FINDING, and it is about the INSTRUMENT
  **`hang` is a one-way door in a browser.** Loading /dashboard in that state
  leaves ~6 requests open that the rig never answers — and 6 is Chrome's
  per-host connection limit. The pool saturates with dead sockets, so every
  later request to localhost:8000 waits forever INCLUDING `/__state/<name>`.
  Kd pasted the next state's URL and watched it spin; it was never going to
  load. Measured at the time: netstat showed exactly 6 ESTABLISHED Chrome→:8000
  connections, zero capacity left. Escape is from OUTSIDE the browser — kill and
  restart the rig. The runbook now runs `hang` LAST, switches states by curl
  from a terminal, and carries the whole explanation in step 10.
  This is the third time this rig has trapped a run (CORS wildcard 07-27, the
  `/running/.../summary` over-match, now this). **The rig is a lying instrument
  by default and every new state must be driven end-to-end before a human uses
  it.**

WHAT THE SMOKE PROVED
  Level 3 / 332/374 / 680 XP held on all FIVE XP surfaces (Sidebar ×2, Dashboard
  stat card, Experience Points panel, Your Rank card, Achievements header) in ALL
  TEN rig states. The card's own defect is closed at the browser: `statsEmpty`
  (a 200 carrying `{"stats":{}}`, round 4 F2's exact payload) shows `—`, not
  "0 workouts / 0h / 0 kcal"; and `emptyLists` still shows a real `0`, so the fix
  did not overshoot into calling a sent zero unknown.

THREE DEVIATIONS, RECORDED BECAUSE THEY ARE NOT WHAT THE FILE SAID
  1. States switched by curl by the assistant, not by Kd in a browser tab. Now
     the documented method.
  2. `hang` ran 4th, not last — the ordering advice did not exist yet. Steps 1-4
     were complete and unaffected; the run resumed at step 5 after a rig restart.
  3. **Docker was NOT running and was NOT needed.** DATABASE_URL is Neon and
     apps/api/.env declares no REDIS_URL. The previous session-close block says
     the Docker containers must be up; that is not true for this smoke.

STATE OF THE MACHINE (all three still running as of handover)
  · new API   :3000  — cd apps/api; node --import tsx --env-file=.env src/index.ts
  · web       :5173  — cd apps/web; corepack pnpm exec vite
  · mock old  :8000  — node apps/web/tools/mock-ml-backend.mjs   (state = healthy)
  NB the API took >30s to bind on first boot and printed nothing until it did;
  a second attempt failed with EADDRINUSE, which is how we learned the first
  had succeeded. Don't conclude it is dead from silence — curl /health.

NEXT, and it is the ONLY thing between this card and its two ticks:
  **T3 ROUND 8.** Fresh chat, NOT a subagent. Diff: `t3-xp-web-r8.diff`
  (regenerated). Prompt: `t3-xp-web-r8-PROMPT.md`, ready to paste, names
  PostWorkout.jsx as out of scope and the 359 never-reviewed lines that arrived
  after round 7's diff was cut. Seven rounds have run; in every one, the previous
  round's fix opened the next finding. Assume the eighth does too.
LEFT IN THE DEV DB: smoke-xpdash-1785229803361@example.com + 4 backdated squats.
SPEC GAPs: none.
```

```
TASK: PostWorkout XP repoint — the LAST copy of the 100-XP curve
      [DONE. 4 T3 ROUNDS (7+8+8+9 findings, 7 blocking, all fixed). SMOKE
      PASSED. COMMITTED c681b23 + the round-4 fixes. OWED 🔴 TICKED.]
      branch web-repoint, based on HEAD 3516331. Web-only: no API change, no
      migration, no new dependency. COMMITTED: c681b23 (the fix) + 7f9f4cb
      (round-4 fixes + the tick). Working tree clean.
      (⚠ This sentence read "NOT COMMITTED — commit after the smoke" until
      2026-07-28. The header above it was corrected and this clause was not —
      round 4 F1's exact finding, one paragraph down, in the block round 4 F1
      was about. Fixed rather than left as a third instance.)

T3 ROUND 1 (fresh chat, run by Kd) — the reviewer MUTATED rather than read,
and found the SECOND vacuous assertion in a card that had just recorded
finding the first. Both blocking findings were "the fix is right, the
protection is not":
  · F1 `not.toMatch(/Level [78]\b/)` could not fire at the site this card is
    about — the row renders as one run of text ("Level 7230/374"), where no
    word boundary exists between "7" and "2". It matched for the share card
    only because the next character there is an emoji. Mutation m2b left
    test 1 GREEN. Fixed by dropping `\b`; now caught by three tests.
  · F2 THE BAR had no protection at all. ⚠ **THE REASON GIVEN HERE WAS FALSE —
    see round 2 below; framer-motion DOES land `animate` widths in jsdom, it
    just settles ~1.8s in.** Left in place with this marker rather than
    rewritten, because it is the claim round 2 overturned. A `% 100` mutation
    in the bar passed all three render tests
    AND the source guard. Now held by a per-consumer ban on
    `summary.current_(xp|level)`, labelled in the code as a tripwire, not
    proof. ⚠ STRUCK (round 4 F3): "mocking framer-motion is the real fix and is
    on OWED" is dead twice over — a render assertion DOES exist, and that OWED
    card is struck. It was one of the last two surviving statements of the
    falsified premise.
  · F6 the render fixture claimed to be "a real xp block" and could not be:
    xpForNext 248 is LEVEL 2's span. Recomputed from xp.ts — 374 / 61.5 / 722.
  · F3/F4/F5 three of my own counts were reconstructions, now measured. NB
    the review's own numbers were checked, not laundered: it said the summary
    has 8 unparsed fields; it is 9.
  · F7 a 200 with no `summary` key renders a BLANK page (no toast, no
    redirect). Pre-existing; named in the rig + on OWED so the smoke reads it
    as the known state.
  · Done gate: the smoke steps existed only in a chat — the shape that
    invalidated the last run. Now at RUNBOOK/smoke-postworkout-xp.md.
  · R3.10: the summary catch logged the whole axios error; message-only now.
    The review said it leaks a Bearer token — on this branch it does not
    (mlApi attaches the header only `if (token)`), the same overstatement
    OWED corrected once already on 2026-07-26.

WHAT CHANGED (4 files + 3 records)
  · apps/web/src/pages/PostWorkout.jsx — `summary.current_xp % 100` and its
    `{xpProgress}/100 XP` caption DELETED. Level, position-in-level and the bar
    now come from `useXp()` through the shared formatters (the 888e750
    Dashboard shape). ShareCard moved to the SAME source — it read
    `summary.current_level`, so the page and the downloadable PNG would
    otherwise print two different levels. `xp_earned` stays (this workout's
    delta; the new API has no such field) but is guarded → "—", never "+0".
  · gamificationApi.test.js — consumer list +PostWorkout.jsx (it went red on
    its own first, as it did for Dashboard).
  · xpDisplay.render.test.jsx — +3 render tests, all mutation-verified.
  · tools/mock-ml-backend.mjs — serves /workouts/:id/summary; `partial` omits
    xp_earned. Without this the page is unreachable in a browser on this branch
    in every state. Driven by curl.
  · OWED.md (quote corrected, tick WITHHELD, +2 lines) · DECISIONS.md · here.

PROVE (post-round-1)
  web 226 passed / 1 failed (227) — the 1 is the pre-existing syncClient
  VITE_API_URL env quirk, unchanged; up from 223/224, so +3 and nothing else
  disturbed. vite build ✓. Lint on PostWorkout.jsx = EXACT baseline parity
  (4 errors + 1 warning, same rules), verified by linting the committed version
  rather than assumed; both test files clean. The two mutations that previously
  slipped through are now caught — m2b by three tests, m5 by the new guard —
  and every restore was from a `cp` backup verified by md5sum, never
  `git checkout --`.

THE FINDING WORTH CARRYING FORWARD
  THREE vacuous assertions in one card: one I found by mutating my own work
  before handover, one the reviewer found in the assertion I had written to fix
  the first, and one whole render site (the bar) that no test could see at all.
  Reading an assertion tells you nothing about whether it can fail.
  ⚠ **THE "LESSON" THIS BLOCK ORIGINALLY CARRIED WAS FALSE, and it was the
  worst place in the repo to put a false claim** — S1 makes this block mandatory
  reading, and it was headed "carry forward", i.e. the exact text the next chat
  lifts. It said "a render test cannot see a framer-motion `animate` prop under
  jsdom". IT CAN: `0px` is the `initial` and the node settles at the real width
  after the element's own delay+duration (round 2 measured it; round 3
  reproduced it at 1841 ms). Corrected in place per T3 round 3 F1, which found
  it still standing here after every other site had been fixed.
  THE REAL LESSON, which survives: an assertion that has not been mutated is not
  protection, and **a premise measured at one instant is not a premise about
  every state**. Round 3 then found the same shape again one layer down — a
  `waitFor` for the unknown bar could pass on a transient frame at the start of
  the sweep, so it was replaced by a settle-then-assert.

SMOKE — PASSED (Kd, 2026-07-27), every step. ⚠ "OWED's 🔴 line is TICKED" was
  FALSE when written and stayed false for three rounds, with its correction 33
  lines below — round 3 F1's own shape, in the file round 3 F1 was about,
  committed by the commit that fixed it (round 4 F1). The line IS ticked now,
  naming c681b23 + the round-4 fix commit.
  Steps live at RUNBOOK/smoke-postworkout-xp.md (they were chat-only until the
  T3 caught it — the shape that invalidated the previous run).
  THE FIXTURE MATTERS: a Level-1/2 account CANNOT prove this fix, because level
  2 costs exactly 100 XP so the right curve and the deleted maths print the same
  string. Built to Level 3 through the real API (register → 4 consecutive-day
  perfect-form syncs → fitness profile so the mandatory onboarding gate does not
  intercept), giving `332/374` correct vs `80/100` buggy. NB
  POST /v1/workouts/sync requires Idempotency-Key == body workoutId.
  Left in the DEV db: smoke-xp@example.com + 4 backdated squat workouts.

T3 ROUND 2 (2026-07-28, fresh chat) — 8 findings, 3 blocking, ALL FIXED.
  · F1 THE THIRD vacuous assertion, and round 1's F1 inverted: the share-card
    level was never examined, because `getAllByText(/Level 3/).length >= 2` is
    satisfied by the PAGE's own two sites. The PNG could print Level 4 beside a
    page printing Level 3 with everything green. Now asserted by identity.
  · F2 **ROUND 1's CENTRAL PREMISE WAS FALSE.** "framer-motion never runs
    `animate` under jsdom" — measured: `0px` is the `initial`, and it settles at
    the real width after delay+duration. Round 1 read the DOM ~1.8s early and
    called one instant "every state". The bar is now asserted in the DOM
    (`style.width === '61.5%'`), which catches a destructure bypass the regex
    cannot; round 4's "add a render assertion" was never really overridden; and
    the OWED framer-motion-mock card is STRUCK as raised on a false premise.
  · F3 the round-1 regex had no positive control, so disarming it was silent —
    round 4 F1(b) verbatim, ~75 lines under the comment recording it.
  · Also: the rig swallowed `/running/sessions/:id/summary`; `useXp`'s "FOUR
    components" went stale again (five now); the F6 correction cited a fixture
    that is ITSELF impossible (on OWED); the runbook omitted the account recipe
    and the onboarding gate that intercepts a fresh account.
  · A scratch probe file survived a relative `rm -f` run from the wrong
    directory and joined the suite as an 18th test file. Caught by the file
    COUNT moving, not by a test.

THE OWED TICK WENT BACK OFF AT ROUND 2, and is back ON after round 4. It had
  named no commit while nothing was committed, and the "no behaviour defect,
  only protection gaps" argument is what the re-tick precedent forecloses.
  ⚠ CORRECTED (round 4 F4): this said round 2 "found a screen-visible defect
  passing green". It did not — ShareCard already read `formatLevel(xp)` before
  round 1; round 2 found a VACUOUS ASSERTION over a screen-visible defect
  CLASS, i.e. the mutant would have been visible, the shipped code never was.
  The precedent survives the correction intact.

PROVE (post-round-2): web 228 passed / 1 failed (229) — the 1 is the syncClient
  env quirk — up from 226/227. Build ✓. Lint = exact baseline parity. All three
  blocking fixes mutation-verified red→green.

T3 ROUND 3 (2026-07-28, fresh chat) — 8 findings, 2 blocking, ALL FIXED.
  Round 3 re-measured round 2's three fixes and all three HOLD (framer-motion
  settle probed at 1841 ms; the bar assertion proven not to be timing-luck; the
  regex controls firing; the rig regex curl-driven). Then:
  · F1 the falsified framer-motion premise was STILL stated as fact in this
    file's top block — twice, one under "THE FINDING WORTH CARRYING FORWARD",
    the text a new chat lifts — with its corrections 74 and 21 lines below.
    Corrected in place. Round 2 said the premise sat in FOUR places; it was SIX.
  · F2 BLOCKING, and the real one: `xpBarWidth` had ZERO assertions — not even
    imported into the test file. A mutant returning '100%' for unknown (a full
    bar beside "—/— XP" on four screens) left all 229 tests green. Its SIBLING
    `progressWidth` has exactly the missing test.
  · MY FIRST FIX FOR F2 WAS TIMING-LUCK and my own mutation caught it: a
    `waitFor(…toBe('0%'))` PASSES under that mutant, because the bar sweeps
    0 → 100% and waitFor needs one matching poll, which the start supplies.
    **waitFor is the wrong instrument when the asserted value is also the
    starting value.** Now settle-then-assert-once.
  · Also: an opaque TypeError when the Tailwind anchor is renamed (now a helper
    that asserts cardinality first); "both sites by identity" was false (claim
    corrected, not the test contorted); my `validXp` miscount (it is ONE field,
    `total: 400`); the runbook's "two things" listing three and its date-
    dependent 680 total; and the rig now binds 127.0.0.1 rather than every
    interface, since `/__state/<name>` is an unauthenticated state-changing GET.

PROVE (post-round-3): web 229 passed / 1 failed (230) — the 1 is the syncClient
  env quirk — up from 228/229. Build ✓. Lint = exact baseline parity. F2
  mutation-verified red→green at BOTH layers.

THIS CARD IS FINISHED. Nothing about PostWorkout is outstanding.

NEXT, and it is the top of the queue — the XP DISPLAY / DASHBOARD XP card from
the previous session (OWED.md:86 and OWED.md:346, both 🔴 and both UNTICKED
after SEVEN T3 rounds). Its code is committed and its findings are all fixed;
what it still owes is exactly two things:
  1. **THE RE-SMOKE.** It is blocked on nothing — the rig it needs is now in the
     repo and WORKING (this session extended it with the workout-summary route,
     anchored its path matching, bound it to loopback and drove every state with
     curl). The scope has grown across rounds 4-7 and the state names to walk
     are the rig's own: `healthy` FIRST as the control, then `dead`, `hang`,
     `empty200`, `statsEmpty`, `noEarned`, `partial`, `badRecs`, `lbOnly`,
     `emptyLists`. Read `apps/web/tools/mock-ml-backend.mjs`'s header — each
     state names the round whose defect it reproduces.
     ⚠ The 2026-07-27 attempt at this run was INVALIDATED (CORS wildcard, fixed
     since). Run `healthy` first: if real numbers do not appear, the rig is
     lying, not the app.
     ⚠ Write the steps INTO the repo before running them, as
     `RUNBOOK/smoke-postworkout-xp.md` now does — chat-only steps are what
     invalidated the last run, and a T3 raised it again on 2026-07-27.
  2. **T3 round 8** on that card (`t3-xp-web-r8.diff` at the repo root).
Both ticks come off until those are done; the lines say so themselves.

WORTH KNOWING BEFORE STARTING (learned the hard way this session)
  · A Level-1 or Level-2 account cannot demonstrate an XP curve bug — level 2
    costs exactly 100 XP, so right and wrong print the same string. The account
    recipe is in RUNBOOK/smoke-postworkout-xp.md and takes about a minute.
  · `POST /v1/workouts/sync` requires `Idempotency-Key` to EQUAL the body's
    `workoutId`.
  · Mutation-test every new assertion before claiming it protects anything.
    Four rounds on the last card produced 7 blocking findings and ZERO
    user-visible defects — every one was an assertion that could not fail, or a
    claim nobody measured.
  · `waitFor` is the wrong instrument when the value you assert is also the
    value the animation starts at.
  · Restore mutations from `cp` backups, never `git checkout --`.

LEFT IN THE DEV DB: `smoke-xp@example.com` + 4 backdated squat workouts
  (harmless — production starts empty).
SPEC GAPs: none.
```

```
TASK: SESSION CLOSE 2026-07-27 — read this FIRST, it supersedes the round-7
      block below on smoke status. Branch web-repoint, HEAD 0404087.

DONE THIS SESSION
  · T3 rounds 4, 5, 6, 7 — 36 findings, 12 of them blocking, all fixed and
    committed (1dd31cb, 59b1a1b, 85bbc6f, 9644fa5). Details in each round's
    block below and in DECISIONS.
  · The regex source-guard was RETIRED as the protection of record; jsdom +
    @testing-library/react are now dev deps (Kd approved, R1.4) and
    `apps/web/src/pages/xpDisplay.render.test.jsx` carries the real protection.
    web 223 passed / 1 failed (224) — the 1 is the pre-existing syncClient
    `window` quirk. Scoped lint 2 (Zap, ChevronRight) = baseline. Build green.
  · **Neon DATABASE_URL rotated and VERIFIED** (0404087). OWED line ticked.
    Kd reset it in the console and pasted the new value straight into
    apps/api/.env in the editor — NOT through chat, which is how the old one
    burned. Verified by query: neondb_owner / neondb / 46 public tables.

THE SMOKE IS STILL OWED, AND THE FIRST ATTEMPT WAS INVALID — READ THIS
  A mock old-backend now exists at `apps/web/tools/mock-ml-backend.mjs`. It
  serves the nine response states the T3 rounds care about, switchable by
  visiting http://localhost:8000/__state/<name> in a browser tab. It exists
  because the states that hid rounds 4-7's defects (200-with-empty-body, a
  catalog with no `earned` field, a hanging connection, a non-array
  `recommendations`) CANNOT be produced by "the old server is off" — which is
  the only state any previous smoke could reach. That is why those defects
  survived human click-throughs.
  **Kd ran the nine steps on 2026-07-27 and the run does not count.** The mock's
  first version replied `Access-Control-Allow-Origin: *`, and a browser refuses
  a wildcard on a credentialed request (`mlApi` sets `withCredentials: true`,
  mlApi.js:5). Chrome blocked every call, so the app said "unavailable" in all
  nine states including `healthy`. ONLY Test 1 (old backend genuinely
  unreachable → dashes + a real Level 2) is a valid result. The CORS bug is
  fixed and verified by curl; the whole run needs repeating.
  LESSON, and it is the session's own lesson turned on its author: the rig was
  handed over without being tested end-to-end. Run the `healthy` state FIRST as
  a control — if real numbers do not appear, the rig is lying, not the app.

STATE OF THE MACHINE AT SESSION END (all three may need restarting)
  · new API   :3000  — cd apps/api; node --import tsx --env-file=.env src/index.ts
  · web       :5173  — cd apps/web; corepack pnpm exec vite
  · mock old  :8000  — node apps/web/tools/mock-ml-backend.mjs
  · Docker: aihg-dev-postgres/redis/worker + aihg-mongo/-express were UP.
  NOTE: do not pipe these into Select-Object — a closing pipe kills the process
  (happened twice this session).

OPEN, IN KD'S PREFERRED ORDER
  1. **PostWorkout.jsx 100-XP bug** — the ONLY item on this list that is live
     for real users; it renders after every workout and is wrong for everyone
     above level 2. OWED has the line. Kd approved doing this next.
  2. Re-run the smoke with the fixed rig (steps are reconstructable from the
     nine state names; `healthy` first as the control).
  3. T3 round 8 — seven rounds, seven times the previous fix opened the next
     defect. `t3-xp-web-r8.diff` is written at the repo root, and the round-8
     prompt is in this session's transcript.
  4. Shut the three servers down / restore Docker if not already done.
SPEC GAPs: none.
```

```
TASK: WEB XP display + Dashboard XP — T3 ROUND 7  [FIXED, SMOKE + ROUND 8 OWED]
      branch web-repoint. 8 findings, 3 BLOCKING, all fixed. SEVENTH consecutive
      round to find the previous round's fix opened the next defect. 61 findings
      total across seven rounds.
F1 (blocking) — ONE omission, BOTH failure modes. `recsState` derived from
  `loading`, which only the getStats chain sets; the recommendations request had
  .then/.catch and NO settled flag, so that read could never move its own state.
  Stats settling first + recs in flight → "Recommendations are unavailable right
  now." (false denial during a healthy load — what oldPayloadState exists to
  delete). Stats hanging + recs failed → "Loading recommendations…" forever
  (round 5 F1 — what listState exists to delete). Round 6's OWN F1 rule (never
  borrow another read's knowability), broken by round 6's own three-state work.
  FIX: a dedicated `recsLoading`, and both derivations now go through the tested
  `oldPayloadState`. MUTATION-VERIFIED: reverting turns both new tests red.
F2 (blocking) — round 6's difficulty "class fix" covered ONE SITE OF THREE. The
  same hard-red `else` was live in ChallengeCard and ChallengeRow, plus a bare
  `{challenge.difficulty}` pill. This is the standing memory note — fix the
  CLASS, not the case — failed in the very round that named the class. One
  exported `difficultyColor()` now, both vocabularies, neutral for null.
F3 (blocking) — ROUND 6's F11 RULING VIOLATED BY THE F11 COMMIT. A
  `not.toMatch(/advanced/i)` assertion that CANNOT FAIL: the pre-fix pill was a
  bare `{ex.difficulty}`, React renders undefined as nothing, and "advanced"
  appears nowhere in Dashboard.jsx. The defect was RED AND UNLABELLED. The false
  premise propagated into 2 source comments + DECISIONS + OWED + the commit
  message; all corrected per V2/V4, not just the assertion.
ALSO: F4 stale comment naming the functions F10 deleted, 230 lines away · F5
  seven bare nullable fields render BLANK where siblings print "—" · F6 the
  record said "every read is === true now" — six bare isCurrentUser reads said
  otherwise (benign render, real record defect) · F7 earnedBadgeCount([null])
  threw — F12 guarded the argument, not the element · F8 the section vanished
  when both lists were ready-and-empty · encodeURIComponent on a route query.
CLEARED BY THE REVIEWER, do not re-litigate: R2.3's boundary is otherwise
  intact — every network-fed useState crosses a reader, enumerated exhaustively,
  NO fourth unparsed list · R3.10 clean at all five log sites · round 6 added no
  new unguarded read or throw path · badgesKnown/challengesKnown deletion lost
  no live coverage · NEUTRAL_TIER is visually distinct from bronze · the
  listState matrix is correct at all five call sites.
PROVE: web 223 passed / 1 failed (224), the 1 being the pre-existing syncClient
  `window` quirk. Scoped lint 2 (Zap, ChevronRight) = baseline. Build green.
  +4 tests; the two F1 render tests mutation-verified red, restored from a `cp`
  backup (never `git checkout --`, per this card's own recorded incident).
OPEN / NEXT:
  1. **T3 ROUND 8** — seven rounds, seven times the fix opened the next thing.
  2. **RE-SMOKE**, scope grew again: + a slow/hanging recommendations endpoint
     beside a fast-FAILING stats endpoint (F1), + a challenge with no
     difficulty (F2). On top of rounds 4-6's hung-backend, `{"stats":{}}`,
     leaderboard-fails, missing-workout-metrics, no-`earned`-field, non-array
     recommendations, and ready-but-empty states.
  3. Both OWED ticks STAY OFF until 1 and 2 are done.
  4. Then: PostWorkout.jsx 100-XP bug (OWED, live route) · rotate the Neon
     password (OWED) · shut down the dev servers + restore Docker.
SPEC GAPs: none.
```

```
TASK: WEB XP display + Dashboard XP — T3 ROUND 6  [FIXED, SMOKE + ROUND 7 OWED]
      branch web-repoint. 12 findings, 3 BLOCKING, all fixed. SIXTH consecutive
      round to find the previous round's fix opened the next defect.
THE HEADLINE — F1 is this card's defect INVERTED. Round 5's F2 fix made
  earnedBadgeCount return null when any badge's `earned` is unknown; the list's
  STATE then borrowed that test (`listState(oldState, earnedCount !== null)`),
  so a catalog that ARRIVED and was RENDERED got "Badges are unavailable right
  now." printed directly above two visible badge cards. Not a fabricated
  number — a false denial of content the user can see. Same rule, opposite
  sign, same gate. Round 5's own F2 render test sat in that exact state and
  asserted nothing about the notice, so it shipped green.
  FIX: ask the list's own question — `overview.badges.all !== null`.
F2/F3 (blocking) — `recommendations` was a SECOND unparsed list in Dashboard.
  Round 5's claim that `recent_workouts` was "the ONE list left unparsed" was
  FALSE, and both were in the same file, fixed in the same commit. A non-array
  value reached `.slice().map()` → threw → blanked the ENTIRE Dashboard, XP
  header included (no ErrorBoundary). Six bare reads; the difficulty ternary's
  `else` painted an unknown difficulty red-and-"advanced" — verbatim round 5
  F3's own defect, one list along. Now readRecommendation/readRecommendations.
ALSO: F4 strip's loading arms rendered nothing forever · F5 TIER_CONFIG
  fallback fabricated a bronze ring/glow · F6 three more heading-then-nothing
  empty states · F7 literal "Invalid Date" · F8 nullable booleans read as
  definite-false · F9 failed recent-workouts read looked like a zero-workout
  account · F10 fourth false claim in the guard + badgesKnown/challengesKnown
  DELETED (dead surface carrying 5 assertions) · F11 two assertions vacuous by
  construction (`/undefined/` cannot fail for a bare JSX child — React renders
  undefined as nothing; the real pre-fix output was "Lv  ·  badges") · F12
  earnedBadgeCount(undefined) threw.
CLEARED BY THE REVIEWER, do not re-litigate: useXp's consumer count is correct
  this round (4 importers, 3 concurrent GETs on /dashboard, independently
  verified) · the 2 lint errors are genuinely pre-existing on master · the
  whole-document sweep would PASS in the states it is missing from, so its
  absence is a missing tripwire, not a live fabrication.
PROVE: web 219 passed / 1 failed (220), the 1 being the pre-existing syncClient
  `window` quirk. Scoped lint 2 (Zap, ChevronRight) = current baseline. Build
  green. +4 tests, including two unit tests for the new recommendation readers
  — added rather than dropping an unused import, which is round 5's own F5
  lesson applied to my own work in the same session.
OPEN / NEXT:
  1. **T3 ROUND 7** — six rounds, six times the fix opened the next thing.
  2. **RE-SMOKE**, scope grew again: + a badge catalog with no `earned` field
     (F1 shows in ONE click), + a non-array `recommendations`, + a ready-but-
     empty challenges list. On top of rounds 4/5's hung-backend, `{"stats":{}}`,
     leaderboard-fails, and missing-workout-metrics states.
  3. Both OWED ticks STAY OFF until 1 and 2 are done.
  4. Then: PostWorkout.jsx 100-XP bug (OWED, live route) · rotate the Neon
     password (OWED) · shut down the dev servers + restore Docker.
SPEC GAPs: none.
```

```
TASK: WEB XP display + Dashboard XP — T3 ROUND 5  [FIXED, SMOKE + ROUND 6 OWED]
      branch web-repoint. 8 findings, 3 BLOCKING, all fixed. FIFTH consecutive
      round to find the previous round's fix opened the next defect.
WHAT ROUND 4 BROKE, THAT ROUND 5 FOUND:
  F1 (blocking) — round 4's F4 fix branched the per-tab captions on `oldFailed`,
    the ENVELOPE's state. "200 with no list" matched neither arm, so THREE tabs
    said "Loading…" permanently after both promises settled, no failure notice.
    That is round 4's OWN F7 state-collapse, re-created in three new sites.
    Fixed with `listState(envelopeState, known)` — pure, unit-tested, per list.
  F2 (blocking) — round 4's new readers nulled the 15 numeric/string fields and
    DEFAULTED the 3 booleans to false. `earned:false` fed the count, so a
    catalog with no `earned` field printed "0 of 40 badges" + "earn your first
    badge" — the round-2 fabrication, back via a default. `bool()` now nulls;
    `earnedBadgeCount` returns null if ANY element is unknown; a padlock is a
    claim, so unknown badges render as neither earned nor locked.
  F3 (blocking) — `recent_workouts` was the ONE list round 4 left unparsed, so
    three Dashboard sites rendered "0 min · 0 kcal · 0% form", with the unknown
    accuracy painted RED by the <60 branch. `readRecentWorkout` added.
  F4 dead current-user highlight (raw `entry.is_current_user` on a reader view;
    fixing it killed the last `useAuth()` use, removing a baseline lint error).
  F6 `useXp`'s comment claimed 3 consumers / 2 requests — it is 4 consumers and
    /dashboard fires THREE concurrent GETs. F7 empty-catalog tab rendered
    nothing + uncategorised badges counted-but-invisible ("Other" bucket now).
    F8 week caption and dots gated on different fields.
  SECURITY (R3.10) two `.catch(console.error)` in Dashboard handed the whole
    axios error (with `.config.headers` Bearer) to the console.
F5 — THE ONE TO REMEMBER: round 4's 132-line "class fix" shipped with NO tests
  on the class. Every render fixture used `all: []` / `active: []`, so
  readBadge/readChallenge never produced output any test read — which is
  precisely why F2 and F3 lived a whole round. A class fix with no tests on the
  class is a claim, not a fix. Now 19 unit tests (all ten readers/formatters)
  + 6 render tests using non-empty fixtures.
THE RENDER TESTS SAVED IT TWICE MORE: two page-blanking ReferenceErrors in MY
  OWN edits — a surviving `badges` (r4) and a surviving `UNKNOWN` (r5), each of
  which blanks the page (no ErrorBoundary). Three saves in two rounds.
PROVE: web 215 passed / 1 failed (216), the 1 being the pre-existing syncClient
  `window` quirk. Scoped lint 2 errors (Zap, ChevronRight) — DOWN from the
  3-error baseline, because F4's fix removed the dead `user`. Build green.
PROCESS FAILURE #2 (see DECISIONS): bulk-editing a source file with
  `(Get-Content -Raw) -replace … | Set-Content` CORRUPTED its encoding —
  UTF-8 read as CP1252, every separator mojibake, BOM prepended. The BUILD
  STILL PASSED (mojibake in comments is valid JS); caught by inspecting bytes.
  Repaired and verified. RULE: never edit source with a PowerShell round-trip.
OPEN / NEXT:
  1. **T3 ROUND 6** — five rounds, five times the fix opened the next thing.
  2. **RE-SMOKE**, scope grew again: + a 200 whose badge catalog has no
     `earned` field, + a recent-workouts entry missing its metrics (on top of
     round 4's hung-backend, `{"stats":{}}`, and leaderboard-fails states).
  3. Both OWED ticks STAY OFF until 1 and 2 are done.
  4. Then: PostWorkout.jsx 100-XP bug (OWED, live route) · rotate the Neon
     password (OWED) · shut down the dev servers + restore Docker.
SPEC GAPs: none.
```

```
TASK: WEB XP display + Dashboard XP — T3 ROUND 4  [FIXED, SMOKE + ROUND 5 OWED]
      branch web-repoint. 8 findings, all real, all fixed. FOURTH consecutive
      round to find the previous round's fix had opened something new.
THE HEADLINE — the source guard is RETIRED as the protection of record.
  It was defeated 4 more ways (10 total across 4 rounds): a DESTRUCTURE
  (`const { level = 1 } = xp ?? {}`) that FIELD_READ structurally cannot see;
  a contradiction appended to FIELD_READ that disarmed the whole scan silently
  because it had no positive control; `if (oldFailed) return null`, a name
  invented after the six-name early-return list was written; and the
  strip-eating attack with the poison moved BELOW the last helper call.
  KD APPROVED jsdom + @testing-library/react (R1.4, 2026-07-26, option A).
  NEW: `src/pages/xpDisplay.render.test.jsx` (13 render tests) + vitest.config
  gives `*.render.test.jsx` a jsdom env. The guard STAYS as a tripwire; its
  header now says in those words that it is not proof, plus a standing
  instruction: do not grow it for a new bypass — add a render assertion.
SHIPPED (8 files): gamificationApi.js (+readOverviewView/readLeaderboardView/
  readStatsView/readChallenge/readBadge/readLeaderboardEntry + orUnknown/
  formatCount/formatFraction/progressWidth) · useXp.js (returns `status`) ·
  Dashboard.jsx · Achievements.jsx · GamificationStrip.jsx ·
  gamificationApi.test.js (positive+negative controls, `??` spelling, false
  claims deleted) · NEW xpDisplay.render.test.jsx · vitest.config.js.
FINDINGS: F2 `statsKnown` was `Boolean(data)` renamed — a `{stats:{}}` 200 still
  printed six zeros, the SAME shape round 3 deleted in two files and shipped in
  a third. F3 week strip claimed 7 untrained days beside its own "unavailable"
  caption. F4 allSettled decoupled the FETCH, not the RENDER — a healthy
  leaderboard was thrown away and disclaimed; the P4 dark window gave a blank
  tab. F5 seven element-level fields still bare. F6 THE CLASS: the old payloads
  never crossed a parser — now they do. F7 useXp had 1 state where 3 exist, so
  a hung old backend + failed XP read hid the surface forever. F8 three false
  claims in the guard header (+ one on OWED) deleted.
MUTATION PROOF (the reviewer's own bar — all four go RED):
  (a) destructure → render assertion caught it; SOURCE GUARD STILL PASSED 24/24,
      which is the whole argument. (b) disarmed FIELD_READ → new positive
  control. (c) `if (oldFailed) return null` → render assertion. (d) strip-eating
  → caught, but at first only INCIDENTALLY (it broke up text other assertions
  matched on), so a whole-document sweep was added; it now fails on the
  fabrication itself. Restores from `cp` backups, NEVER `git checkout --`.
THE NEW TESTS EARNED THEIR KEEP IMMEDIATELY: they caught `ReferenceError:
  badges is not defined` at Achievements.jsx:431 in MY OWN fix — a leftover
  reference that blanks the whole page (no ErrorBoundary in apps/web). The
  source guard could not have seen it.
PROVE: web 194 passed / 1 failed (195) — the 1 is the pre-existing syncClient
  `window` quirk, unchanged. +15 tests. Scoped lint 3 errors = exact baseline
  parity, each VERIFIED still present at merge-base 1164a86, not assumed.
  `vite build` GREEN — this also closes the gap the previous block flagged
  ("Build: NOT re-captured after the T3 fixes").
OPEN / NEXT:
  1. **T3 ROUND 5** — round 4's fixes are new, unreviewed code, and four rounds
     running have each found the previous round's fix opened something.
  2. **RE-SMOKE**, scope GREW again: needs the old backend UP AND HANGING (not
     off), a 200 with body `{"stats":{}}`, and the leaderboard-fails-while-
     overview-succeeds state. Both OWED ticks stay OFF until 1 and 2 are done.
  3. OWED lines added: Sidebar has no render coverage; the guard's four
     hardcoded path lists remain literals. One ticked: the source-guard/DOM-test
     line is DONE.
  4. Then: PostWorkout.jsx 100-XP bug (OWED, live route) · rotate the Neon
     password (OWED).
SPEC GAPs: none.
```

```
TASK: WEB XP display repoint 🟡  [CODE + T3 ROUND 1 DONE, SMOKE OWED]
      branch web-repoint (master merged in first at 1164a86, which is what put
      the `xp` block on this branch). Discharges the WEB half of OWED's "XP /
      levels display" 🔴 line; the API half was PR #50.
SHIPPED (7 files): gamificationApi.js (+getMe on authApi; +readXpView via the
  SHARED xpViewSchema; +formatLevel/formatXpTotal/formatXpProgress) · NEW
  hooks/useXp.js · NEW gamificationApi.test.js (17 tests) · Sidebar.jsx (the
  live `user?.level || 1` fabrication, gone) · GamificationStrip.jsx ("Your
  Rank" only) · Achievements.jsx (header only) · OWED.md (+4 lines).
KD SCOPE RULING (2026-07-26): Sidebar IN (already broken, not merely unnamed);
  Dashboard OUT (rides workoutService.getStats — a second repoint) with its own
  OWED line naming its `s.xp || 0` / `s.level || 1` and its hardcoded-100 XPBar.
DECISIONS: full entry appended this branch ("Web XP display repoint").
T3 ROUND 1 (fresh chat): 6 findings, all real, all fixed.
  ① BLOCKING — XP was rendered INSIDE the old payload's early returns, so the
    state that is permanent on this branch showed no XP, while the comment
    claimed the sources were independent. A separate fetch is not independence
    if the render is gated. Hoisted in both components.
  ② BLOCKING — the fabrication guard sat at the READER; the original bug lived
    at a RENDER SITE (proven: reverting all three call sites left the suite
    green). Closed at both layers — tested formatters + a comment-stripped
    source guard. Both mutation-verified red→green.
  ③ readXpView hand-rolled the six-field list → now the shared xpViewSchema
    (R7.2), plus one finite check because progressPct is a bare z.number().
  ④ `loading` was returned and ignored → "XP unavailable" flashed during a
    healthy load. Wording is neutral now and the flag is gone.
  ⑤ nextLevelAt required-but-unrendered → resolved by ③ (the contract decides).
  ⑥ Achievements can now show two contradictory XP totals (new-API header vs
    old-backend leaderboard row) → OWED + an expected smoke observation.
PROVE: web 172 passed / 1 failed (173). The 1 is the recorded pre-existing
  syncClient VITE_API_URL/`window` quirk — PROVEN pre-existing by stashing and
  re-running at HEAD, not assumed. Lint 3 errors = exact baseline parity
  (Zap, ChevronRight, `user`), measured the same way; zero introduced.
  Build: green before the T3 fixes; NOT re-captured after them — run it.
SMOKE: OWED, and its scope GREW at the T3. The card first claimed the two
  screens were unreachable; that holds only when the old ML API is UP and
  401ing. With it simply NOT RUNNING there is no `response`, so no redirect,
  and — with ① fixed — both screens render their XP. All three surfaces are
  smokeable today.
T3 ROUND 2 (fresh chat): 8 findings, all real, all fixed. Headline: round 1's
  fix for ① created a NEW instance of the defect this card exists to delete.
  ① BLOCKING — hoisting XP out of the old payload made the badge/challenge
    cards render for the first time on a failed read, and they FABRICATED
    ("of 0", "(0/—)", "0 of — badges", "earn your first badge"). Kd's smoke
    ran in exactly that state and I reported it as correct. Now one
    `oldReady` gate: absent payload reads "—" and says "unavailable".
  ② BLOCKING — Achievements still had `if (loading) return <spinner>` above
    the header, and `loading` is the OLD read's. No timeout on mlApi, so a
    hung old backend hid the header forever. Two-arm form now.
  ③ `challenges.active.map` and `leaderboard.leaderboard.find` unguarded
    while the comment claimed "optional-chained throughout"; no ErrorBoundary
    exists, so a partial payload blanks the page — ① by a third route.
  ④⑤ BOTH source guards were sieves — 9 of 11 bypasses passed, incl.
    `{xp ? xp.level : 1}`. Redesigned as a POSITIVE rule (a component may
    read no FIELD of xp) with the scanned set derived from hook importers, so
    the Dashboard card is covered on the day it is written. 8 bypasses
    mutation-verified caught.
  ⑥ bar widths now clamped (progressPct is unbounded in the schema).
  ⑦ the hook's justification was false — it is no fresher than AuthContext;
    the sidebar is stale until reload. Own OWED line; comment corrected.
  ⑧ formatters were object-truthy, so formatXpTotal({}) threw. Field-safe now.
  A DEFECT I INTRODUCED AND NEARLY SHIPPED: generating the guard via a Python
  heredoc wrote literal 0x08 bytes where `\b` was meant, so several regexes
  could never match and the negative assertions were passing VACUOUSLY. Only
  the one POSITIVE assertion failed loudly. Lesson recorded in DECISIONS.
PROVE (post-round-2): web 176 passed / 1 failed (177), same pre-existing
  syncClient quirk; lint 3 = baseline parity. Both independently reproduced
  by the reviewer.
OPEN / NEXT:
  1. **RE-SMOKE required** — ①②③ changed what Kd already looked at. Dashboard
     and Achievements with the old backend OFF must read "—", not "0", and the
     Challenges tab needs clicking on a partial payload.
  2. T3 round 3 — round 2's fixes are again new, unreviewed code, and rounds
     1 and 2 each found the previous round's fix had opened something.
  3. Then the Dashboard XP card (Kd chose option (a), 2026-07-26).
  4. OWED lines now added by this card: Dashboard XP · the
     redirect-vs-not-running nuance · the two contradictory totals ·
     `.catch(console.error)` leaking the old Bearer · sidebar staleness ·
     the guards catch spellings not the class · useXp request dedupe.
SPEC GAPs: none.
```

```
POINTER (2026-07-26, REWRITTEN at the master merge that made its first version
  false — "when an action makes a record obsolete, updating the record IS part
  of the action", DECISIONS coach R2 F2.)
  XP / levels storage (🔴, API half) shipped off master and merged as PR #50
  (`47cc001`). **master is now merged INTO this branch** (merge commit below),
  so the two claims the earlier pointer made — "its HANDOFF block lives on
  MASTER only" and "THIS BRANCH DOES NOT YET CARRY THE ENDPOINT" — are both
  superseded: the card's full block is the NEXT one down, and
  /v1/gamification/me on this branch now answers WITH the `xp` block.
  If you are picking up the WEB XP display, still read `OWED.md`'s "XP /
  levels display" line first — it names the camelCase trap and the "totals
  deliberately diverge" governing rule, neither of which the merge changes.
  Kd's SCOPE RULING for that card (2026-07-26): GamificationStrip +
  Achievements + Sidebar.jsx are IN; Dashboard.jsx (XPBar + "Current Level"
  StatCard, fed by workoutService.getStats) is OUT and gets its own OWED line.
```

```
TASK: XP / levels storage + badges.py curve port 🔴  [DONE — MERGED PR #50 (47cc001)]
      branch t3-user-xp (off master, now deleted locally). API half only.
      Implements the Kd ruling of 2026-07-24 ("XP/LEVELS — KEEP, add storage"),
      discharging the P2.3 GAP-1 deferral. Part 7 is SILENT on user XP, so
      badges.py is the source and this is Kd-authorised schema beyond the spec
      (the user_fitness_profiles precedent).
SHIPPED (17 files): migration `0008_user_xp` — 1:1 `user_xp(user_id PK,
  total_xp, timestamps)`, SQL reviewed by Kd; `level` DERIVED on read, never
  stored. NEW `modules/gamification/xp.ts` — badges.py port, VERBATIM: TIER_XP
  (:11-16), XP_REWARDS (:202-211), xp_for_level (:215-227), level_for_xp incl.
  the 200 cap (:230-237), xp_progress (:240-253). `badges.ts` regains each
  badge's `tier` + `badgeXpForCodes`. `service.recomputeXp` (module-private)
  runs AFTER awardAchievements in BOTH sync hooks; `getMe` READS stored XP.
  `@app/shared` gamificationMeSchema gains an `xp` block (camelCase).
  `privacy/tables.ts` + an explicit DELETE + an EXPORT_READERS entry.
DECISIONS (full entry in DECISIONS.md, this branch):
  · D1 DEVIATION — accrual is a RECOMPUTE from full history, never the old
    backend's live `$inc`: the sync hook runs on every retry, so `$inc` would
    double-count. Constants verbatim; ACCRUAL deliberately differs.
  · D2 a 1:1 table (mirrors `streaks`), not a `users` column.
  · D3 badge XP = Σ TIER_XP over earned codes (tier ported into the seed).
  · D4 meal/coach/photo/challenge XP constants ported but UNWIRED — grep proves
    the old backend never awarded them (R0.2: not a new feature here).
  · D5 streak_day = adjacent one-day-apart pairs over DISTINCT activity days.
  · GOVERNING RULE (read xp.ts before "fixing" any number): EVERY recomputed
    input to EVERY component diverges from the old backend — day bucketing,
    activity-vs-sync time, retroactive backfill, the server-derived form score,
    and all four badge-stat inputs. Constants verbatim, TOTALS deliberately not.
    This replaced a counted list that was wrong at 1, 3 and 4 axes in
    successive rounds; a list was the wrong shape because it is itself a claim.
PROVE: api 366/366 on Neon; typecheck + lint clean. THREE behavioural
  guarantees each mutation-verified red→green: the advisory-lock BODY, its
  CALL SITE (probed via pg_blocking_pids, not a stopwatch), and that `/me`
  reads stored XP rather than recomputing.
T3: FIVE fresh-chat rounds, 25 findings, all resolved. The CODE was stable
  after round 1's lock fix — every later finding was about evidence, scoping or
  the record (a guarantee no test carried; a type widened for a test; a test
  that could pass vacuously; a false test premise; an incomplete enumeration
  ×3; a mis-scoped threat model ×2). Rounds 3-5 each found a defect created by
  the previous round's fix; round 5's two halves shipped in ONE commit.
SMOKE: NONE, correctly — no browser-reachable surface until the web display.
OPEN / NEXT:
  1. WEB XP display (GamificationStrip, Achievements) — on `web-repoint`, see
     that branch's OWED.md line. MERGE MASTER IN FIRST or /v1/gamification/me
     answers with no `xp` block. TRAP: API is camelCase (`xpInLevel`), the
     components read `user.progress.xp_in_level` — a straight swap yields
     `undefined`, which renders as a plausible blank, not an error. Browser
     smoke owed with it.
  2. SECURITY, inherited by the leaderboard / Form Score™ cards (on OWED):
     XP is safe ONLY while it grants nothing. Primary vector is fabricated
     workout VOLUME (50 + up to 50 per forged sync; `avgFormScore` is
     client-sent per set and merely averaged; POST /v1/workouts/sync has NO
     per-route rate limit). Backdated `startedAt` (unclamped) is second.
  3. REPORTED not fixed (R1.1): `getStreakForUpdate` has the same first-insert
     gap this card fixed for XP (FOR UPDATE locks nothing when no row exists)
     and an overstated comment. Pre-existing; its own small card.
SPEC GAPs: none opened. Part 7's silence on XP is the pre-existing one, and
  Kd's 2026-07-24 ruling is what authorises the storage.
```

```
TASK: web-repoint (Google login half) 🟡  [CODE DONE, T3 OWED]  branch web-repoint
  The web side of the google-login API card (merged master PR #48). Wires the
  buttons to the new endpoints so Google sign-in works end-to-end. Ticks the 🔴
  OWED "Google login" line.
SHIPPED (6 files + 1 test): Login.jsx / Register.jsx — removed the
  GOOGLE_LOGIN_ENABLED=false gate (buttons restored) + the stale deferral
  comment; buttons now navigate to `${VITE_API_URL}/v1/auth/google` (was
  hard-coded localhost:3001). Login.jsx also reads the callback's `?error=`
  (google_failed / google_not_configured) via useSearchParams and toasts once
  (clears the param so a refresh won't re-toast). GoogleAuthSuccess.jsx —
  REWRITTEN: deleted the `#token` fragment / localStorage / raw-setUser flow
  (R3.7/R3.10). AuthProvider's mount effect (getMe → adoptSession) already
  restores the cookie session on the full-page redirect, so the page only reads
  useAuth() and routes by onboardingCompleted (mirrors Login.jsx:33-36); no
  session → /login?error=google_failed. AuthContext.jsx — setUser NO LONGER
  EXPORTED (nothing else used it raw; grep-verified), permanently closing the
  Card-2 shared-browser hazard the OWED line named. App.jsx — /auth/google/
  success route restored as a BARE route (not PublicRoute, so it controls its
  own onboarding-vs-dashboard routing). NEW src/pages/googleAuth.test.js —
  source assertions (web has no jsdom; coachApi.test.js precedent).
DECISIONS: no new spec judgment — all determined by existing rulings (Cards 1-2
  adoptSession; the google-login API decisions on master). OWED.md ticked.
PROVE: googleAuth.test.js 4/4; full web suite = 151 passed / 1 failed, the 1
  being the PRE-EXISTING syncClient.test.js `window is not defined` (no jsdom) —
  PROVEN pre-existing by stashing this card and re-running on the clean branch
  (identical failure). eslint on the 5 touched files: my files CLEAN; the only
  errors are pre-existing react-refresh warnings on AuthContext's other named
  exports (lines I didn't touch; web is out of the lint gate per 2026-07-08).
SMOKE: OWED — cannot run without (a) real Google OAuth credentials (Kd creates
  in the Google Cloud console) and (b) the running API carrying the Google
  routes. web-repoint is 11 commits behind master (no Google API here) → before
  smoke, MERGE master into web-repoint (also brings the API) or run the API from
  a master checkout, and set the API's WEB_ORIGIN to the web dev origin so the
  callback redirect lands on the web app.
T3 ROUND 1 (fresh chat) — security pass CLEAN; no R0–R11 violations. Actioned:
  · Behavioral test added — routing extracted to a pure `googleSuccessRoute`
    (googleSuccessRoute.js), 5 unit tests covering every branch; MUTATION-VERIFIED
    (swapping the onboarding branch turns 3 red). Replaces the weak routing
    source-grep the reviewer flagged. Suite now 8/8.
  · OWED.md UN-TICKED — the reviewer ruled the DONE tick premature (a feature
    isn't closed until smoke); reframed to "both code halves done, CLOSES on
    smoke" (DPDP Day-14 un-tick precedent).
  · Reviewer's BLOCKER ("endpoint doesn't exist") was a BRANCH-LOCAL grep: the
    endpoint EXISTS on master (routes.ts:259/267, google.ts, PR #48) — web-repoint
    just trails master by 11. Corrected with evidence; the real residual is
    integration + smoke, already flagged.
  · Reviewer note (out of scope, R1.1): Settings.jsx still raw-fetches the OLD
    backend for the DPDP account-delete path — owed its own OWED line/card.
OPEN: (1) RECOMMENDED NEXT: merge master → web-repoint so the endpoint exists on
  this branch (resolves the on-branch gap + unblocks smoke; 11 commits, expect
  HANDOFF/DECISIONS/OWED conflicts). (2) re-review the round-1 fixes if desired.
  (3) commit + PR into web-repoint (this branch's own history; NOT master).
```

TASK: Coach "Try again" control — the client half 🟡  [DONE 2026-07-22]
  WEB (web-repoint, commits a62586b + 304a089 + ee28e2a): the CLIENT half of the
  coach retry protection whose API half merged as PR #43. Coach.jsx cleared the
  message box on send and never restored it, with NO retry affordance — so a
  failed question could only be RETYPED, which the server correctly reads as a
  brand-new one (second thread, second question spent), and a key minted inside
  sendMessage would have differed every attempt and deduped nothing. Now the key
  is minted ONCE PER COMPOSED MESSAGE and stored with it, so "Try again" resends
  an IDENTICAL body (message AND threadId, captured at compose time) under the
  SAME key — which is what the server's whole-body fingerprint recognises. Input
  is deliberately NOT restored: the button is the retry path.
  FOLD-IN DELIVERED: every 429 used to map to the quota copy, so a free user with
  four questions left who typed fast was told to UPGRADE. The catch now branches
  on the error NAME via pure exported coachErrorInfo — the two 429s and the two
  409s mean opposite things. quota_exceeded / not_found / validation_error offer
  NO button (a retry cannot help); the two key-errors retry with a FRESH key.
  DELIBERATE EXCEPTION, verified: an UNRECOGNISED 429 falls back to "too
  quickly" — @fastify/rate-limit throws an untyped error so the global limiter's
  429 arrives as {error:"request_error"}; it must never produce the upgrade copy.
  T3 (FRESH CHAT, Kd): 1 BLOCKING + 4 more. V1 — the button was addressed PER
  MESSAGE while the send writes to the TAIL, so a stale button resent the right
  key into the WRONG bubble and overwrote a newer reply. Closed at BOTH layers
  (offers withdrawn on compose; button cannot render off-tail) and
  MUTATION-VERIFIED. V2 stale OWED/cutover lines ticked. V3 the sequencer is now
  exported + tested like the mapper. V4/V5 recorded, not fixed.
  web 147/148 (the 1 = the known syncClient env quirk) from a 130/131 baseline;
  build ✓; lint 1 on Coach.jsx = exact baseline. LIVE-DRIVEN first: replay
  returned a byte-identical body with idempotent-replay: true, same-key/different
  message → 400 mismatch, ONE thread after three requests. CORS preflight
  re-checked before any code (a custom header forces one; refusal would kill the
  coach in-browser — the Card-4 class).
  SMOKE PASSED (Kd, all three steps). Kd smoke ask folded in: the answer bubble
  was too narrow (column capped at 768px, bubble 75% of it = ~576px) so tables
  were chopped — column now 1024px and ANSWER bubbles 92% (questions stay 75%),
  ~942px of table width; the table's own scroll is KEPT by Kd's framing.
  RECORDS: PR #43 and the Groq PR #44 lines were both still open (neither file
  is editable from a master-bound card — OWED.md is not on master at all); both
  ticked, and the GROQ_API_KEY ROTATION that card was expected to carry but did
  NOT perform now has its OWN open line rather than sitting inside a ticked one.
  cutover.md's limitedToDays checkbox was likewise stale; ticked.
  NB the card brief's T3 command (`git diff origin/master -- apps/web`) is WRONG
  on this branch — 4,537 insertions across 36 files, every previous card. Use
  `git diff HEAD -- apps/web` (this card: 3 files).
NEXT CARDS: 🔴 DPDP Day-14 hard-delete + JSON-export worker (THE recommendation —
  promoted 2026-07-16 as the explicit PRICE of merging onboarding-storage and
  deferred past 8 cards since; needs BullMQ, NOT installed, so R1.4 approval
  first; carry the retention window as ONE named constant and make the export a
  table LIST, so Kd's open privacy-scope question does not box it in) ·
  🔴 Google login (off since 2026-07-15) · 🔴 avatar storage (incl. the unmet
  R3.9 upload security) · 🔴 XP/badges/leaderboard/predictions/exercise-library
  (each needs an API surface first) · 🔴 workout history calendar (BLOCKED —
  read its OWED entry, the new API holds only a SUBSET of workouts) ·
  🟡 timezone TRAVEL rule · 🟡 real-phone camera smoke · 🟡 ROTATE GROQ_API_KEY
  (Kd's own action) · ⚪❓ raw <br> in coach answers renders as text — needs a Kd
  ruling (rehype-raw = new dep + letting model HTML into the DOM).
```

```
TASK: Nutrition targets — API half + WEB half 🔴  [DONE 2026-07-21]
  API (branch nutrition-targets-api → PR #42 merged to master): GET
  /v1/nutrition/targets ports backend-ml's Mifflin-St Jeor calculator
  (nutrition.py:98-179) VERBATIM — every constant carries its source line.
  Reads user_fitness_profiles + users.weight_kg via a new sql-only
  getUserTargetContext (getProfile takes UsersDeps, which NutritionDeps cannot
  supply). NO migration. Kd rulings: NO fabricated defaults — an incomplete
  profile returns {targets:null, missing[]} instead of the salvage's
  70kg/170cm/25y/male guesses; all five inputs required, goals may be empty.
  The salvage's opposite goal precedence (kcal tests weight_loss first, protein
  tests muscle_gain first) is ported as-is and pinned. api 293/293 on Neon.
  SIX rounds of fresh-chat T3 — the endpoint was correct from round 2; rounds
  3-6 found one unreachable type hole and a string of citation defects in my
  own records. Recurring lesson, now in DECISIONS: each guard was verified
  against the mutation the PREVIOUS round named, leaving the next-nearest open
  ("mutate the class, not the case"), and a CORRECTION is a new claim that
  inherits V1 in full (one comment was wrong twice in opposite directions).
  WEB (web-repoint, commit aa362ce): MacroRings + "Remaining today" repointed;
  nutritionApi.js is now 100% new-API (getTargets was its last mlApi call).
  The || 2000/150/250/65 defaults DELETED — supersession marked on BOTH
  branches. Re-verifying the approved plan caught a flash-the-honest-prompt
  defect before any code: the left column's spinner is owned by the MEALS
  fetch, and || 2000 had made the not-yet-loaded state look correct — a
  fabricated default hiding a loading bug from its own author. T3: 6 findings,
  all fixed; the serious one was `targets == null` (loose) collapsing three
  states into two, so a FAILED request told a complete-profile user to fix a
  profile that was never broken — `== null` ported from the API half, where it
  is right, into the one place the two values differ. web 105/106 (1 = known
  syncClient env quirk); lint 7 = baseline parity. SMOKE PASSED twice.
  SMOKE METHOD (both learned the hard way, recorded): a fresh account cannot
  show the empty state (onboarding is mandatory and collects all five) — clear
  a field in Settings; and killing the API cannot show the failure state
  (/v1/auth/me fails first and signs you out) — block only the targets URL.
NEXT CARDS: ⏰ Groq COACH_MODEL migration (HARD DATE before 2026-08-16 —
  llama-3.1-8b-instant is decommissioned and the coach goes DARK; flip the
  default + re-quote the model-specific price constants per Part 0 rule 4) ·
  DPDP Day-14 delete/export worker (HARD GATE for cutover, doc-promoted;
  needs BullMQ) · avatar storage incl. the unmet R3.9 upload security ·
  workout history calendar repoint · limitedToDays in the Progress UI ·
  onboarding wizard's native unit dropdowns → the shared Select ·
  real-phone mobile-web camera smoke · T3 residuals (bySubstring cross-word
  matching; item-removal telemetry; API request-level canonical dedupe).
  STILL ON THE OLD BACKEND (owed, each its own cutover line): exerciseApi,
  gamificationApi, progressApi(predictions), recommendationApi, runningApi,
  workoutApi, Settings' avatar.
```

```
TASK: Card ⑦ — Settings profile forms → new API 🟡  [DONE 2026-07-20]
  WEB (web-repoint): Settings' two profile forms + reset-onboarding repointed
  off backend-ml. Load = GET /v1/users/me + /fitness-profile (flat-merged);
  name/weight → PATCH /v1/users/me; the rest → PUT fitness-profile through a
  read-modify-write `mergeFitnessProfile` — the PUT is a FULL replace and each
  form owns only PART of it, so a naive save would WIPE the other form's data,
  and an omitted onboardingCompleted sets it FALSE (service.ts:142) and bounces
  the user to the wizard. Both traps unit-tested AND proven live.
  Option lists ALIGNED to the new-API enums (Kd ruled): dropped core_strength /
  barbell / machine / night, renamed bands→resistance_bands, pullup_bar→
  pull_up_bar. Reset-onboarding = PUT {} full wipe (Kd ruled); weight NOT
  cleared (separate column). AVATAR cannot move — no profilePicture field
  exists anywhere on the new API (command-verified) — stays on old backend,
  OWED card in cutover.md incl. its unmet R3.9 upload security.
  T3 (FRESH CHAT): 7 findings, ALL fixed — reset-undone-by-next-save (F1),
  fabricated defaults the schema forbids (F2), age bounds (F3), partial write
  (F4), empty catch (F5), uncapped medical notes (F6), missing gender option
  (F7) — plus a done-gate test gap (merge tests fed a clean object, not the
  flat merge) now pinned by a key-set assertion.
  Kd smoke ask: native <select> popups are OS-drawn (un-stylable blue hover) →
  new shared components/common/Select.jsx; all 5 Settings dropdowns use it.
  web 99/100 (1 = known env quirk); build ✓; lint 4 on Settings (DOWN from its
  5 baseline). SMOKE PASSED (Kd, every step ✅).
NEXT CARDS: avatar storage (owed, incl. R3.9) · Onboarding wizard's native unit
  dropdowns → the new Select (small) · Groq COACH_MODEL migration (HARD DATE
  before 2026-08-16) · nutrition targets (UNBLOCKED — profile now written from
  both wizard AND Settings) · workout history calendar repoint · limitedToDays
  in Progress UI · DPDP Day-14 worker (HARD GATE, doc-promoted) · real-phone
  mobile-web camera smoke.
```

```
TASK: Card ⑥ — onboarding wizard → new API + gate restore 🟡  [DONE 2026-07-19]
  WEB (web-repoint): the getting-started wizard (Onboarding.jsx) repointed from
  backend-ml to the new /v1 API — PUT /v1/users/me/fitness-profile (full-doc
  replace) + PATCH /v1/users/me for weight. AuthContext enriches the session
  user with onboardingCompleted (GET /v1/users/me) so the gate (ProtectedRoute/
  Login) enforces onboarding again — a Card-1 regression (it was enforced for
  NOBODY). Pure mapper (unit convert + 2dp round) unit-tested. SMOKE caught two
  real bugs: the ft/cm 400 (switching units left a stale value → 175 ft = 5334
  cm, rejected only after all 5 steps) → fixed with unit-CONVERTING selects +
  LIVE inline range validation (red message + disabled Continue as you type);
  and the "Skip for now" dead-end (gate bounced it back) → button removed,
  onboarding now required. T3 (FRESH CHAT): zero violations; fixed a health-data
  console leak (medicalConditions was logged). web 93/94 (1 = known syncClient
  env quirk); build ✓; lint 6/0 parity. SMOKE PASSED (Kd, every step ✅). No API
  change, no migration.
NEXT CARDS: Settings profile repoint (STILL on old mlApi — owed line in
  cutover.md; dead userService import to clean up there) · Groq COACH_MODEL
  migration (HARD DATE before 2026-08-16) · nutrition targets card (now
  UNBLOCKED — the wizard populates user_fitness_profiles) · workout history
  calendar repoint · limitedToDays in Progress UI · owed T3 residuals
  (bySubstring cross-word; removals-telemetry; API canonical dedupe) ·
  real-phone mobile-web camera smoke (owed, DECISIONS 2026-07-19).
```

```
TASK: Card ⑤d — previous-days meal view 🟡  [DONE 2026-07-19, all gates]
  WEB (web-repoint): the Nutrition page gains day navigation (‹ / › / date
  picker) to look back at earlier days. NO API change — listMealsForDay
  page-walks the existing newest-first GET /v1/nutrition/meals (cursor opaque,
  no date filter) until it passes the local day; cap 10 pages then an honest
  "couldn't load back this far". Past days: logging affordances HIDDEN (takenAt
  is always now, Kd 2026-07-17); per-meal edits STAY; left card becomes "Eaten
  on this day"; MacroRings KEPT (Kd ruled keep 2026-07-19).
  T3 (FRESH CHAT, Kd): zero violations; independently verified taken_at DESC
  ordering is the correctness linchpin. F1 stale-response race + F2 truncated-
  vs-empty honesty + a date-bar-in-loading-gate finding all fixed. SMOKE-folded
  meal-row fixes (Kd asks): rename-on-blur BUG fixed (onBlur discarded the edit,
  NO PATCH ever fired — proven by the api log), always-visible ✏️ pencil + row
  action buttons (were hover-only). web 84/85 (1 = known syncClient env quirk);
  build ✓; lint 7/0 baseline parity. SMOKE PASSED (Kd, every step ✅). Cost:
  ZERO paid calls (paginated GETs only).
NEXT CARDS: nutrition targets card (buildable since PR #30, user_fitness_
  profiles) · desktop webcam capture · owed T3 residuals (bySubstring cross-word;
  removals-telemetry; API canonical dedupe) · limitedToDays in Progress UI ·
  HARD DATE Groq COACH_MODEL + vision model migration before 2026-08-16
  (cutover.md) — coach/vision go dark after.
```

```
TASK: Card ⑤c2 — dishware in-flow + portion API 🟡  [DONE 2026-07-18, all gates]
  API (branch dishware-portion-api → PR merged to master, CI green): each meal
  item is now a strict UNION — grams arm {canonical,grams} OR dishware arm
  {canonical,dishwareId,fillLevel}. Server prices the dishware arm via the
  SHARED dishwareGrams(volume×fill×density) helper the scan resolver already
  uses (can't-disagree), rung user_dishware, tenant-scoped lookup, bounds
  symmetric with the grams arm. NO migration, NO scan-response change (Kd
  ruling: ASK EVERY TIME, never auto-apply — deviation from 2B §3.2 Stage 5).
  api 278/278 on Neon.
  WEB (web-repoint): shared DishMeasure (saved-bowl chips + save-new-bowl with
  Appendix-B midpoints 125/175/275 ml or type-ml + ¼/½/¾/full). AddMealModal
  grams↔dish toggle; PhotoModal per-item "🍲 my dish" pill. Helpers pass the
  dishware arm through. Plus Kd smoke asks: tap-to-rename a logged meal, and
  the discoverable labeled pill. web 79/80 (1 = known syncClient quirk).
  T3: BOTH diffs reviewed in FRESH CHATS by Kd (never subagents). API T3 → 2
  fixed (0g/>10000g bound; PATCH dishware test). Web T3 → 2 fixed (dish rows
  never show the AI estimate on the degraded path; AddMealModal preview
  key-stamped). SMOKE PASSED (Kd, every step ✅). Cost: ZERO paid calls added.
NEXT CARDS: ⑤d previous-days meal view · nutrition targets card (buildable
  since PR #30) · desktop webcam capture · owed T3 residuals (bySubstring
  cross-word; removals-telemetry; API canonical dedupe) · HARD DATE Groq
  COACH_MODEL migration before 2026-08-16 (cutover.md) — coach goes dark after.
```

```
TASK: web repoint — Card 5c: meal composition + synonyms + change-label 🟡
      [DONE 2026-07-18 — ALL GATES PASSED. PR #40 merged to master (CI green
       on final commit 437f042 incl. the Curd/Dahi row); master merged back
       into web-repoint (append-append DECISIONS kept both); valid fresh-chat
       T3s on BOTH diffs resolved; AUDIT delivered; SMOKE PASSED (Kd, every
       step ✅ — see DECISIONS). Branch still merges only at P2.8.]
NEXT: Card ⑤c2 (dishware IN-FLOW + portion API — the split-out half) ·
      ⑤d previous-days view · nutrition targets card · owed T3 residuals
      (bySubstring cross-word includes; removals-telemetry; API canonical
      dedupe — DECISIONS 2026-07-18) · Groq COACH_MODEL migration
      (HARD DATE 2026-08-16, cutover.md).
>>> PROTOCOL FAILURE (Kd-caught 2026-07-17; corrected in the follow-up
    commit): the authoring chat ran all three "T3" reviews via SUBAGENTS
    inside its own session. CLAUDE.md:129/:429 requires a SEPARATE, FRESH
    CHAT, and every prior T3 in DECISIONS (4/4) was a fresh-chat review —
    the kickoff prompt's claim that "the previous chat ran T3 via a fresh
    subagent" has NO repo record and was hearsay the chat failed to verify
    (the same S1 rule it correctly applied to the ⑤c-split claim). The
    subagent reviews DID surface 8 real, fixed, test-pinned findings, so the
    fixes stand — but they do NOT satisfy the T3 gate. The chat also skipped
    AUDIT (no R0–R10 self-audit table was produced) and committed BEFORE the
    SMOKE gate. Consequences, in order (STATUS as of 2026-07-18):
    1. ✅ Kd ran the REAL T3 (fresh chat) on the API diff → 3 findings + 1
       advisory, ALL REAL (the biggest: findCurated("Hot Tea")→steak — a
       wrong-food path the card itself shipped, which the subagent runs
       missed). All fixed failing-test-first; DECISIONS records each.
    2. ✅ Kd ran the REAL T3 (fresh chat) on the web diff → 3 actionable
       findings, all fixed (MAX_ITEMS gate on saved-meal add; real
       composeAddIngredient unit test; stale-live withheld via payload-key
       match). DECISIONS records each.
    3. ✅ Fixed + committed: API d5843ad/8653996 (pushed), web a09ae0f.
    4. ✅ AUDIT table delivered in-chat at resolution (2026-07-18).
    5. ⏳ REMAINING, in order: PR CI green (V7's closing gate — the full
       272-suite could not complete locally, Kd's DNS flapped mid-run; every
       failure ENOTFOUND, zero assertion failures; nutrition 36/36 + unit
       13/13 + typecheck + lint green locally) → Kd merges PR → merge master
       into web-repoint (DECISIONS conflicts are append-append: keep both) →
       ONE combined SMOKE click-through (incl. re-smoke of the rewritten 5b
       manual flow — see the web T3 resolution note) → card done.
SCOPE RE-CUT (Kd-approved at the plan gate, recorded in DECISIONS): 5c =
  meal COMPOSITION + food synonyms + change-label + 5b stale-guards.
  DISHWARE IN-FLOW split out to its OWN card ⑤c2 (needs a portion-math API
  contract, not a UI tweak) — owed in cutover.md, nothing dropped.
  NB the kickoff prompt claimed this split was already ruled; the repo had
  no record (S1 — the prompt is hearsay), so it was re-confirmed with Kd.
SHIPPED (API, branch `meal-composition`, 3 commits, api 271/271 on Neon):
  confirm+preview accept EXTRA items beyond the scan draft (rung 'default',
  unknown → 400; ONE shared resolveDraftItem so preview == save) · food
  synonym aliases + noise-word pass + prompt nudge · NO schema change, no
  migration.
SHIPPED (web, web-repoint): shared FoodPicker (3 search surfaces, + the 5b
  stale-guard) · PhotoModal "+ Add an ingredient" (extras ride the same
  confirm/preview payload; zero-match analyses are now confirmable) ·
  AddMealModal DUAL MODE (adds an ingredient to a SAVED meal via existing
  PATCH) · MealRow change-label control (null clears) + ingredient summary
  line · contract bounds (10000g / 30 items) quoted, gated, explained.
SUBAGENT PRE-REVIEWS (NOT valid T3s — see the protocol failure above) found
  EIGHT real findings, all fixed + test-pinned. The two that matter: (1) the
  alias table did NOT fix its own bug — it keyed on the whole query, so
  findCurated("Flatbread Stack") (the REPORTED input) was still NULL while
  the test asserted "flatbread", a straw man. Fixed with a noise-word pass;
  deliberately NOT token probing ("Aloo Paratha" would become potato — a
  wrong food is worse than an honest drop). (2) additions were being
  recorded as ESTIMATE errors, charging the added item's mass to the rung
  that estimated the drafted items, and an all-additions confirm hit
  worst([]) → fabricated 'user_dishware'. Fixed via correctedItems.
  Also: a rejected confirm burned the scan (forcing a re-photo + quota) —
  now read → resolve → take. The REAL T3s still need to run on the final
  diffs; these pre-reviews replace nothing.
PROVE (real output): api 271/271 on Neon ×2 · web 76/77 (the 1 = the known
  pre-existing syncClient env quirk) · vite build ✓ · web lint 6 vs the
  7-error baseline (net −1).
SMOKE PRECONDITION (unchanged): extras are 400 `invalid_item` against
  web-repoint's server until the API PR merges and master is merged back —
  "+ Add an ingredient" is inert until then. The nutritionApi extras test
  pins the client SHAPE only (its comment says so — the Card-4 CORS class
  of gap). Smoke order lives in the protocol-failure block above.
NEXT CARDS: ⑤c2 dishware in-flow + portion API · ⑤d previous-days view ·
  desktop webcam capture · nutrition targets card · then 6 running/geo · 7
  recommendation-or-drop · owed: workoutApi calendar, limitedToDays UI,
  coach idempotency card, DPDP Day-14 worker (promoted), Settings/
  Onboarding wiring, Groq COACH_MODEL migration (HARD DATE 2026-08-16).
```

```
TASK: web repoint — Card 5b: manual entry + meal-type wiring 🟡
      [branch web-repoint, COMMITTED + SMOKE PASSED ×3 rounds (gates done).
       NOT MERGED — branch merges at P2.8. Same-chat continuation, Kd.]
SHIPPED (web): AddMealModal on the new API (searchFoods per-100g · grams +
  ×N stepper with typed-grams rebase · LIVE server preview · one
  logManualMeal; legacy mlApi searchFood/logMeal DELETED — only getTargets
  remains on mlApi, D2 interim) · meal sections = stored mealType label
  (chips + section-+ set it; exact takenAt always; unlabeled → time-bucket
  display fallback; time-edit never moves labeled meals) · standalone
  dishware card REMOVED (Kd ruling — returns IN-FLOW in 5c) · Remaining
  falls back to MacroRings' defaults · zero-matched-analysis honest empty
  state (the roti case) · nutritionApi: dishware CRUD fns (for 5c),
  mealType threading; tests updated (10).
THREE MASTER PRs SHIPPED MID-CARD (each PROVEd + T3'd fresh-chat, merged +
  merged back): manual-off-foods (search results canonical-cached; T3:
  off_* no curated-hijack, barcode-unique canonicals, physical per-100g
  bounds) · meal-type-field (migration 0007 meal_logs.meal_type, Kd SQL
  review; contracts + repo/service; 265/265) · (5a era: vision swap, 2/day
  quota, preview endpoint, exact kcal — see the 5a block).
PROVE: web 73/74 (the 1 = pre-existing syncClient env quirk) · lint parity
  (same 7 pre-existing) · build ✓ · api 265/265 on Neon after each PR.
NEXT: Card 5c (dishware IN-FLOW + portion API + change-label control +
  stale-guards) · food synonym/alias API card (roti case) · Card 5d
  (previous-days view) · then 6 running/geo · 7 recommendation-or-drop ·
  owed: workoutApi calendar, limitedToDays UI, coach idempotency card,
  nutrition targets card, DPDP Day-14 worker (promoted), Settings/
  Onboarding wiring, Groq COACH_MODEL migration (HARD DATE 2026-08-16).
```

```
TASK: web repoint — Card 5a: nutrition photo→confirm + client rewrite 🟡
      [branch web-repoint, COMMITTED + SMOKE PASSED (gates done). NOT MERGED —
       branch merges at P2.8. Same-chat continuation by Kd instruction.]
SHIPPED (web): api/nutritionApi.js REWRITTEN on the Card-1 cookie client
  (analyzePhoto base64 JSON — last raw fetch+Bearer deleted; confirmMeal /
  logManualMeal / previewMeal / searchFoods / meals CRUD; getTargets +
  legacy searchFood/logMeal stay mlApi, documented) · pages/Nutrition.jsx
  (photo→confirm flow: editable grams + ×N stepper + LIVE server preview +
  spelled-out macro labels + retake/429 states; today list = client-filtered
  /v1/nutrition/meals page bucketed by D1(a) times <11/16/19/22; totals =
  summed server numbers; targets/remaining = D2 old-backend interim) · NEW
  api/nutritionApi.test.js (9) · RUNBOOK/cutover.md owed lines (nutrition
  targets card · mealType override field D1(c) · dishware UI → 5b · vision
  model hard-date entry).
FOUR MASTER PRs SHIPPED MID-CARD (each PROVEd + T3'd in fresh chats, all
  merged + merged back into web-repoint): #34 vision swap qwen/qwen3.6-27b +
  format-tolerant evidence parsing (smoke caught: BOTH real models 422'd every
  scan; fixtures verbatim) · free meal_scan quota 3/month→2/day (Kd ruling) ·
  /v1/nutrition/meals/preview live-preview endpoint (T3 caught + fixed the
  OFF-draft divergence; preview==save proven by test) · exact-kcal display
  (Kd DEVIATION ruling superseding §3.3 round-to-10).
PROVE (real output): web suite 72/73 passed (the 1 = pre-existing syncClient
  env quirk, HANDOFF Card 2); vite build ✓; lint parity vs branch baseline
  (same 7 pre-existing Nutrition.jsx errors, line-shifted). api suite 262/262
  on Neon ×2 after each API PR.
SMOKE (Kd, full pass 2026-07-16): scan→analysis→stepper ×3 live update→
  confirm→Snack section→F5 persists→delete→F5 gone; exact kcal re-verified.
NEXT: Card 5b (manual entry UI on searchFoods/logManualMeal + dishware
  management UI + edit-takenAt control + weekly summary client-sum). Then
  6 running/geo · 7 recommendation-or-drop · owed: workoutApi calendar,
  limitedToDays UI, coach idempotency API card, mealType field card,
  nutrition targets card, DPDP Day-14 worker (promoted), Settings/Onboarding
  wiring, Groq COACH_MODEL migration (hard date 2026-08-16).
```

```
TASK: web repoint — Card 4: coach 🟡
      [branch web-repoint. PROVE green (below). T3 in a fresh chat OWED before
       done. NOT MERGED — branch merges at P2.8. Same-chat continuation by Kd
       instruction (Part I §1 deviation, recorded).]
SHIPPED (4 files + 1 test): api/coachApi.js (REWRITTEN on the Card-1 cookie
  client: listThreads/getThread/deleteThread/sendMessage → /v1/coach/*;
  .strict() chat body with threadId OMITTED for new threads; old raw-fetch
  streaming path + localStorage Bearer DELETED) · pages/Coach.jsx (stream loop
  → one awaited request, typing indicator preserved via the empty-assistant
  placeholder; threadId from response replaces __CONV_ID__; 429 renders a
  quota message not a fake error; sidebar preview line → formatDistanceToNow
  (lastMessageAt) per D2(a)) · RUNBOOK/cutover.md (+1 BLOCKING checkbox: coach
  chat Idempotency-Key + per-route cap, D1(b) — the DECISIONS 2026-07-12
  follow-up that came due when this card wired the client; API side is its own
  small card, client change is one documented header line) · NEW
  api/coachApi.test.js (3: paths/methods, strict-safe body both shapes,
  usage-pattern guard: no fetch(/localStorage./mlApi import).
KD RULINGS THIS CARD: D1(b) checkbox-not-inline-API-change · D2(a) last-active
  time replaces the preview snippet. NON-STREAMING send cites the existing
  P2.5 GAP-3 ruling — not a removal.
PROVE (real output): full web suite 63 passed / 1 failed of 64 — the 1 is the
  PRE-EXISTING syncClient .env quirk (identical on master, passes in CI).
  vite build ✓. Lint: Coach.jsx 4 baseline errors → 1 (3 died with the deleted
  stream loop; the 1 is untouched pre-existing); coachApi.js + test clean.
UNTESTED (honest): Coach.jsx handlers have no unit coverage (node-env vitest,
  no jsdom — the recorded gap). Manual browser smoke owed: send a question
  (new thread minted), reply renders complete, sidebar shows relative time,
  6th free question shows the quota message, delete works.
OPEN SPEC GAPS: none new.
NEXT: T3 (fresh chat) on this diff (base 27e9255) → resolve → Card 5
  (nutrition). Remaining after that: 6 running/geo · 7 recommendation-or-drop
  · owed: workoutApi calendar, limitedToDays UI, coach idempotency API card,
  DPDP Day-14/export worker (promoted), Settings/Onboarding wizard wiring
  (onboarding-storage endpoint EXISTS on master since PR #30 — the web side
  is still old-backend).
```

```
TASK: web repoint — Card 3: progress + measurements 🟡
      [branch web-repoint. PROVE green (below). T3 in a fresh chat still OWED
       before this card counts as done. NOT MERGED — branch merges at P2.8.]
PROCESS: ran in the onboarding-storage chat by explicit Kd instruction (Part I
  §1 deviation, recorded in DECISIONS). Grounded on-branch per S1 first.
SCOPE AS IMPLEMENTED (amendment declared, DECISIONS 2026-07-16): repointed the
  Progress page (6 chart reads → /v1/progress/*, @app/shared shapes) and
  MeasurementsTracker (→ /v1/nutrition/body-measurements, Part 4 §3.6; flat
  rows rebuilt from {items[].metrics}, `latest` derived client-side, POST =
  .strict() {measuredAt, weightKg?, metrics{}}). NOT repointed — NO-REMOVAL
  rule, no new-API surface exists (client headers + cutover.md owed lines):
  gamificationApi (XP/badges-catalog/challenges/leaderboard — P2.3 rulings) ·
  exerciseApi (names/instructions/media/search absent from Part 4 §3.4
  catalog) · getPredictions (2B §5 card) · workoutApi/WorkoutCalendar
  (endpoint EXISTS, client repoint owed — found out-of-scope, R1.1).
SHIPPED (7 files): api/progressApi.js (authApi client; predictions stays
  mlApi) · api/gamificationApi.js + api/exerciseApi.js (header docs only, no
  behavior change) · pages/Progress.jsx (contract field names; records list
  built client-side; heatmap array→map; weekly Wnn label; hours from
  totalDurationMs) · components/progress/MeasurementsTracker.jsx ·
  NEW api/progressApi.test.js (3: paths+params exact incl. .strict()-safe
  no-param reads; measurements CRUD; predictions-stays-old guard) ·
  RUNBOOK/cutover.md (owed-endpoints block under the web-repoint
  prerequisite; NB master's copy diverged via PR #31 — expect a trivial
  merge conflict at cutover, both edits are list inserts).
PROVE (real output): full web suite `corepack pnpm --filter web exec vitest
  run` → 60 passed / 1 failed of 61 — the 1 is the PRE-EXISTING syncClient
  .env quirk (HANDOFF Card 2: identical on master, passes in CI). vite build
  ✓ 42s. Lint: touched files vs branch baseline IDENTICAL (same 3 pre-existing
  MeasurementsTracker errors, line-shifted; api files + Progress.jsx clean).
UNTESTED (honest): the JSX adaptations (Progress.jsx, MeasurementsTracker) have
  no unit coverage — node-env vitest, no jsdom (adding it = new deps, R1.4;
  same gap Card 2 recorded). Needs the manual browser smoke vs the local API.
T3 (fresh chat, 2026-07-16): 4 findings, 0 R0/R3 violations; NO-REMOVAL
  inventory mechanically verified. f.1 weightKg-rounding/metrics-clamp FIXED ·
  f.3 weekly year-label FIXED · f.4 limitedToDays → owed line in cutover.md ·
  f.2 latest-tiles-over-60-rows ACCEPTED+recorded (DECISIONS). measuredAt
  client-clock note recorded. Post-fix PROVE: suite 60/61 (same pre-existing
  1), build green, lint parity held.
OPEN SPEC GAPS: none new. Sequencing flag recorded (DECISIONS): P4 leaderboard
  vs cutover.md:41 — decide at the cutover checkbox.
NEXT: T3 (fresh chat) on this diff → resolve → then Card ④ (coach). Also
  owed from Card 3 findings: workoutApi/WorkoutCalendar repoint (trivial,
  endpoint exists) — fold into a web card, do NOT absorb silently.
```

```
TASK: web repoint — Card 2: per-user storage keying + displayName migration 🔴
      [branch web-repoint. PROVE green (automated). T3 (fresh chat) DONE — found
       1 REAL correctness bug (flush identity race) + doc/accuracy fixes; ALL
       RESOLVED, see T3 RESOLUTION below. NOT MERGED — same branch strategy as
       Card 1: merges only at the P2.8 cutover.]
WHY THIS CARD IS MOSTLY A BUG FIX: Card 2 was planned as "users/profile
  repoint", but grounding proved that surface is BLOCKED by the onboarding-
  storage gap (below), and that Card 1 had introduced a real regression. So the
  card = that fix + the promised shim removal. Kd-ruled scope; nothing deleted.
*** CARD-1 REGRESSION FIXED (the important part) ***
  utils/storage.js getUserId() decoded the JWT from localStorage.accessToken to
  key EVERY per-user bucket. Card 1's httpOnly cookies made the token unreadable
  → getUserId() returned 'guest' for everyone. syncQueue.js:13 keys the OFFLINE
  QUEUE on userKey, so on a shared browser user A's unflushed workouts sat in the
  bucket B flushes under B's cookie → mis-attributed workouts (vs R10.3).
  FIX: storage.setCurrentUserId(id), pushed by AuthContext on getMe/login/logout.
  Card 1's T3 saw storage.js:28 but mis-classified it as Bearer-null breakage.
SHIPPED (7 files + 1 test): utils/storage.js (setCurrentUserId/getUserId, JWT
  decode deleted) · context/AuthContext.jsx (adoptSession = set id + kick flush;
  normalizeUser shim DELETED) · sync/syncClient.js (module-scope app-load flush
  REMOVED — declared plan amendment: it ran at import, pre-auth, so it read the
  'guest' bucket; AuthContext kicks it post-auth now; 'online' listener stays) ·
  Sidebar.jsx:149,153,188 + Coach.jsx:519 + Dashboard.jsx:262 + Running.jsx:136
  (user?.fullName → user?.displayName). NEW: utils/storage.test.js (4 tests).
PROVE (FULL suite — `corepack pnpm --filter web exec vitest run`):
  57 passed / 1 failed (58 tests, 9 files). The 1 is PRE-EXISTING ON MASTER
  (verified by stashing: identical failure): syncClient.test.js's "no-op when
  VITE_API_URL is not configured" fails locally because vitest loads
  apps/web/.env which SETS VITE_API_URL; passes in CI (no .env committed). Not
  touched (R1.1). vite build ok. Lint: every file I touched → 0; the files I
  only renamed a token in match the master baseline EXACTLY (AuthContext 6→6,
  Sidebar 2→2, Coach 5→5, Dashboard 0→0, Running 2→2) — zero new problems; the
  web is lint-dirty on master independently.
  V1 NOTE: this block first said "30 passed / 1 failed" — that was a FILTERED
  run (`vitest run storage sync authApi`) reported as if it were the suite. T3
  caught it. Numbers here are now the full suite; quote the command with them.
  UNTESTED (honest): the adoptSession→flushSyncQueue coupling needs jsdom/RTL,
  which the web lacks (node-only vitest) — manual smoke only.
T3 RESOLUTION (all findings closed):
  · FIXED (real bug, R10.3): flushRun bound the queue KEY at run start but
    identity binds at SEND time (postSync carries the ambient cookie), so a
    logout+login mid-run kept draining A's bucket while the server attributed
    the workouts to B — the residual half of this card's own hazard. flushRun
    now captures `owner = getUserId()` and returns before any post() if identity
    moved; abandoned entries stay queued (not dropped, not sent). Regression
    test added AND proven to fail without the guard (sent ['a1','a2'] vs ['a1']).
  · FIXED (docs): the "AuthContext kicks the flush" comment implied equivalence
    with the removed import-time flush. It is NOT equivalent — if /v1/auth/me
    fails at app load, no flush runs that page-session. Accepted + recorded as a
    liveness delay (never data loss); comment + DECISIONS corrected.
  · FIXED (docs): the orphaning entry read as a PRODUCTION hazard. It is
    dev/test-only — prod launches with an EMPTY db (cutover.md:11-13). Corrected,
    and it is now a real CHECKBOX in RUNBOOK/cutover.md (that file already
    existed; "owed by a future card" is how such items get lost — T3's point).
  · REPORTED not fixed (R1.1): syncApi has NO timeout (syncClient.js:21-25) — a
    hung POST holds a run open; the owner check makes that harmless, so it is
    left for the sync card. AND: AuthContext exports `setUser` raw (:123) and
    GoogleAuthSuccess.jsx:37 calls it, bypassing adoptSession → would key a
    Google user to 'guest'. UNREACHABLE today (route deleted) — but the Google
    OAuth card MUST adopt via adoptSession or stop exporting setUser.
*** OWED / KNOWN, DO NOT TREAT AS BUGS ***
  (a) ONBOARDING-STORAGE GAP is the real blocker and is the NEXT CARD. v1
      §6.1:442 gives the users module "onboarding data" but Part 4 defines NO
      storage for it, and P2.7 dropped those Mongo fields ("no target; the queued
      onboarding-storage gap", INVENTORY.md:45). It also blocks RECOMMENDATIONS:
      Part 2B §4.1:358's scorer is goal 40 · difficulty 20 · equipment 20 ·
      duration 10 — exactly the dropped fields. So the Onboarding wizard, both
      Settings profile forms, the avatar, and the 3 onboarding gate sites stay on
      the OLD backend, untouched. NOTHING IS DELETED. Build the storage (T5: SQL
      to Kd first; shape derivable from INVENTORY.md:45 + Part 2B §4).
      HARD BLOCKER before the old backend is decommissioned at P2.8.
  (b) LEGACY BUCKET ORPHANING → owed by the P2.8 RUNBOOK (Kd-ruled defer):
      existing buckets are keyed by the old Mongo ObjectId, the app now uses the
      new UUID → drafts + unflushed queued workouts orphan at cutover. Runbook
      must drain queues pre-cutover or accept the loss explicitly.
  (c) Still-old clients (mlApi/coachApi/nutritionApi + Settings delete-account)
      still send `Bearer null` — their own cards. DELETE /v1/users/me exists but
      takes NO body while the web sends {password}; left out of Card 2 (that
      would weaken re-auth) — needs a ruling in its card.
NEXT: onboarding-storage API card (T5) → then remaining web cards ③–⑦ → P2.8.
OPEN SPEC GAPS: the onboarding-storage gap (a) — recorded, ruled, queued.
```

```
TASK: web repoint — Card 1: auth → httpOnly-cookie on the new /v1 API 🔴
      [branch web-repoint, commit 44f847c. PROVE green (automated). T3 (fresh
       chat) found NO code/security violations; its findings were R11
       documentation only — CLOSED by this block + the DECISIONS 2026-07-15
       section. NOT MERGED and must not be: see BRANCH STRATEGY below.]
SPEC: v1 §6.1:439 (auth = "rotating refresh tokens (httpOnly cookie on web)"),
  §13:763 (SPA changes — does NOT itemize this repoint), §18:856. Prerequisite
  for P2.8 ("web runs 100% on the new API", §22/line 991).
WHY THIS IS NOT A CONFIG FLIP: the web ran the OLD model (localStorage
  access/refresh + Bearer on every client); the new API is cookie-only with no
  tokens in any body (shared/src/auth.ts:52). So it's an auth-model rewrite,
  decomposed into cards ①auth ②users/profile ③progress/gamification/exercises
  ④coach ⑤nutrition ⑥running/geo ⑦recommendation-or-drop. This is ①.
BRANCH STRATEGY (Kd-ruled, DECISIONS 2026-07-15): auth is all-or-nothing, so the
  moment it flips, every not-yet-repointed client loses its localStorage token.
  ALL web-repoint cards are commits on ONE branch `web-repoint` (each with its
  own T3); it merges to master ONLY when the web fully runs on the new API =
  the P2.8 cutover. master stays deployable (old-backend web) until then.
SHIPPED (6 files + 1 test): authApi.js (baseURL→VITE_API_URL, /v1/auth/* paths,
  Bearer request-interceptor REMOVED, reactive 401→POST /v1/auth/refresh→retry-
  once interceptor [single shared refresh on concurrent 401s; login/refresh
  excluded; loop- + window-guarded redirect], +changePassword) · AuthContext.jsx
  (mount→/v1/auth/me, login sets {user} only, register maps fullName→displayName,
  logout stops touching tokens, normalizeUser fullName compat shim) · Login.jsx +
  Register.jsx (Google behind GOOGLE_LOGIN_ENABLED=false) · App.jsx (Google route
  + import removed) · Settings.jsx (change-password → cookie authService).
  NEW: api/authApi.test.js (5 interceptor tests, node env + mock adapter).
PROVE: authApi tests 5/5; `vite build` ok (3415 modules); the 6 changed files
  lint-clean. NOTE web lint is RED overall — 73 PRE-EXISTING errors on master in
  untouched salvage files (10 in Settings.jsx: Date.now purity, setState-in-
  effect); this card adds none. MANUAL BROWSER SMOKE NOT YET RUN (a chat can't
  drive a browser) — owed by Kd: API WEB_ORIGIN=http://localhost:5173 + API on
  :3000, web VITE_API_URL=http://localhost:3000 → register/login → cookies set
  (DevTools→Application→Cookies) → reload keeps session → logout clears.
*** KNOWN-BROKEN INTERIM ON THIS BRANCH (by design; do NOT treat as bugs) ***
  (a) ONBOARDING IS NEVER ENFORCED: authUserSchema has no onboardingCompleted
      (it's a users-module field, v1 §6.1:442), so ProtectedRoute.jsx:44,:54 and
      Login.jsx:33 all compare undefined === false → false. Fails OPEN. RESTORING
      IT IS OWED BY CARD ② when /v1/users/me supplies the field.
  (b) STILL-OLD CLIENTS SEND `Bearer null` and break: mlApi.js:10, coachApi.js:17,
      nutritionApi.js:31, utils/storage.js:28, Settings.jsx:401 (delete-account).
      Each is repointed by its own card. Card 1 PROVE must NOT be expected to
      exercise coach / ML-profile / nutrition / delete-account.
  (c) pages/GoogleAuthSuccess.jsx is ORPHANED dead code (no route/import) that
      still writes localStorage.setItem('accessToken') (:31) and calls the wrong
      /auth/me path (:35). Unreachable → inert. The Google-OAuth card must
      rewrite or delete it.
NEXT: Card ② users/profile (repoint userApi/profile reads+writes to /v1/users/me;
  restore onboarding gating; migrate the 6 user?.fullName sites and DROP the
  normalizeUser shim). Then ③–⑦, then P2.8 cutover per RUNBOOK/cutover.md.
OPEN SPEC GAPS: none. v1 §13 doesn't itemize the repoint; §6.1/§18 fix the auth
  model and the card ordering is an implementation choice (Kd-ruled auth-first).
```

```
TASK: google-login — Google OAuth on the new API 🔴  [API HALF, T3 R1 DONE, RE-REVIEW OWED]
      branch google-login (off master). Restores the switched-off Google sign-in
      buttons — a 🔴 cutover blocker on web-repoint:OWED.md. v1 §6.1 lists Google
      OAuth; P2.1 shipped email/password only. API-only + additive → merges to
      master normally; the WEB repoint (buttons + rewrite GoogleAuthSuccess.jsx)
      is a SEPARATE follow-up card on web-repoint.
SHIPPED (10 files): NEW modules/auth/google.ts (GoogleVerifier interface + real
  google-auth-library impl + createGoogleVerifier(config)→null-when-unconfigured)
  · routes.ts (+GET /v1/auth/google redirect w/ CSRF state cookie; +GET
  /v1/auth/google/callback → verify state, exchange, googleSignIn, set the SAME
  httpOnly cookies as password login, redirect to WEB_ORIGIN/auth/google/success
  — NOTHING in the URL) · service.ts (+googleSignIn: 3-way upsert login/link/
  create) · repo.ts (+findUserIdByAuthIdentity, createOAuthUser [NULL password],
  linkAuthIdentity [ON CONFLICT DO NOTHING], recordVerifiedOAuthEmail) ·
  tokens.ts (+OAUTH_STATE_COOKIE) · config.ts (+3 OPTIONAL Google vars) · app.ts
  (wire verifier + BuildAppOverrides.googleVerifier test seam) · package.json
  (+google-auth-library ^9.15.1) · NEW test/auth.google.test.ts (7 tests).
  NO MIGRATION — auth_identities has existed since 0001_init.
KEY DECISIONS (all in DECISIONS.md 2026-07-24): the old #token=fragment +
  localStorage flow is DELIBERATELY NOT ported (R3.7/R3.10 — cookies only) ·
  Google users marked email-verified via a CONSUMED verify_email token (the
  existing derivation; NO new column, R0.2) · same-email account → link, password
  untouched (passport.js:41-43) · soft-deleted account refused (active-only, like
  login) · state cookie sameSite 'lax' (top-level callback nav) · Google unset =
  clean disabled (GROQ precedent). NEW DEP google-auth-library ^9.15.1 approved
  (R1.4; weekly-downloads sanity check still owed at merge).
PROVE (real Neon, ep-wispy-rain): typecheck (shared+api) clean · eslint (8 touched
  files) clean · red-flag greps clean · auth.google 7/7 · auth.routes+unit 37/37
  (no regression). Full api suite NOT run locally (Neon ~38min); CI db-tests job
  (local PG container) runs it on the PR.
SMOKE: OWED, cannot run yet — needs BOTH (a) real Google OAuth credentials Kd
  creates in the Google Cloud console, and (b) the web buttons repointed off the
  old backend (localhost:3001) to /v1/auth/google. Stated per Part I §2, not
  skipped. The routes ARE browser-reachable, but no browser path reaches them
  until the web card + credentials land.
T3 ROUND 1 (fresh chat) — 2 blocking + 2 low, ALL FIXED (DECISIONS 2026-07-24):
  A secret-in-logs (gaxios err.config carries client_secret) → log errorSummary()
  only · B email_verified===false let an ABSENT claim through (account-takeover
  into a password account via same-email linking) → !==true, mutation-verified ·
  C id_token now Zod-parsed (identityFromClaims) · D per-IP googleLimit added.
  NEW file test/auth.google.unit.test.ts (8 DB-free tests: the B strictness + A
  log-safety, run in CI's gate job). PROVE post-fix: typecheck+lint clean,
  unit 8/8, auth.google 8/8 on Neon. CLASS NOTE owed: pino redact-path hardening
  for err.config across coach/nutrition/geo/auth is its own repo-wide card.
OPEN: (1) RE-REVIEW the round-1 fixes in the SAME fresh T3 chat (diff refreshed:
  t3-google-login.diff). (2) After merge, the OWED.md tick for
  "Google login" API-half lands as a SEPARATE web-repoint commit (OWED.md does
  not exist on master — branch-topology ruling 2026-07-21). (3) web-repoint card:
  buttons → new API, rewrite GoogleAuthSuccess.jsx to use cookies + adoptSession
  (never setUser raw — the shared-browser hazard Card 2 closed), delete the
  localStorage/#token path.
NEXT CARDS (unchanged from the Day-14 block): 🔴 avatar storage (incl R3.9) ·
  🔴 XP/badges/leaderboard/predictions/exercise-library (some need Kd rulings:
  XP-storage column, leaderboard P4-before-P2.8 sequencing) · 🔴 workout history
  calendar (BLOCKED, read its OWED entry) · deploy infra + DPDP worker (Day-14
  gate) · 🟡 timezone TRAVEL rule · 🟡 ROTATE GROQ_API_KEY (Kd action).
```

TASK: DPDP Day-14 hard-delete worker 🔴  [CODE DONE, T3 OWED]  branch dpdp-day14-purge
  The blocking P2.8 legal gate, half of it. Part 4 §5.2 ANONYMIZES the users row
  instead of deleting it, so NO FK cascade collects user-owned PII — §5.2's
  explicit Day-14 DELETE list is the only mechanism and it did not exist.
  Now: modules/privacy (tables.ts = the compliance artifact, repo.ts = 15
  literal DELETEs, purge.ts = the job), a BullMQ worker.ts entrypoint (v1 §6
  "two modes, same image"), and tools/dpdp-purge.ts which is DRY BY DEFAULT.
  17 tables end empty per user: 15 deleted directly, meal_log_corrections and
  coach_messages collected by CASCADE (they carry NO user_id — the approved
  plan's uniform "WHERE user_id" loop was WRONG and verification caught it
  before any code). user_fitness_profiles IS included, discharging the
  condition onboarding-storage was merged on (DECISIONS 2026-07-16).
  RETENTION IS ONE CONSTANT (src/retention.ts) per the privacy-scope build
  note — and the plan UNDERCOUNTED: there were FOUR hard-coded 14s, not one,
  two of them USER-FACING COPY. Had only the code read the constant, widening
  to GDPR's 30 would leave the API saying "you have 14 days" while purging at
  30. All four now derive from it; no existing test asserted any (grepped).
  THE BUG THIS CARD CAUGHT IN ITSELF, and it was SILENT: the leaderboard scrub
  used JSON.stringify(x)::jsonb. postgres-js sends that as a TEXT param, so
  the cast makes a jsonb STRING SCALAR, and `array @> string` is FALSE with no
  error — the UPDATE matched nothing, committed happily, and a purged user's
  name would have stayed on every leaderboard forever. sql.json() fixes it.
  Found only because the test asserts the scrubbed VALUE, and only after a 5s
  default timeout (the one test I forgot to give 60s) stopped masking it as a
  network flake. A timeout is not a result.
  MARKER = an audit_log 'user.purged' row (Kd ruling): no migration, and it
  makes the purge narratable (Part 8). NOT EXISTS bounded by at >= deleted_at
  because audit_log has no index on action/target_id. PROVEN ON REAL DATA:
  dev holds 9 due accounts, 8 marked, dry run scanned exactly the 1 unmarked.
  NEW DEP bullmq@5.80.10 (7,384,354 wk downloads, verified from npm — my plan
  said "~2M" from memory, wrong by 3.7x). worker.ts imports ioredis DIRECTLY,
  a declared exception: createIoRedis sets maxRetriesPerRequest:1 and BullMQ
  requires null. The job body is a plain function, so all 10 tests run against
  real Postgres with no queue/Redis/worker involved.
  api 324/324 on Neon (314 baseline + 10); typecheck + lint + red-flag greps
  clean. Tests were RED first, three times, each for a different real reason.
  ⚠ RUNNING THE SUITE PURGES DUE ACCOUNTS IN THE TARGET DB — the sweep is
  global by design. The first green run purged 8 pre-existing soft-deleted
  example.com fixtures on dev. Warned loudly in the test header.
  NO SMOKE — no browser-reachable surface (a scheduled job, no route); the two
  DELETE /v1/users/me strings interpolate the same 14 they hard-coded. Stated
  per Part I §2 rather than skipped.
  OPEN: T3 in a FRESH chat (diff: t3-dpdp-day14.diff), then the OWED.md line
  must land as a SEPARATE web-repoint commit — OWED.md does not exist on
  master (the 2026-07-21 branch-topology ruling, commit c488dda precedent).
  SPEC GAPs for Kd: (1) 8 user_id-bearing tables §5.2 does not name
  (one_time_tokens, refresh_tokens, gym_members, gym_staff, api_cost_events,
  usage_daily, trace_samples, gyms.owner_user_id) — implemented §5.2 verbatim,
  NOT widened (R0.2); (2) the tombstone is silent on password_hash/hash_algo,
  timezone, legacy_mongo_id — cleared only the three §5.2 names.
  DEVIATION (R7.1): one privacy repo issues cross-module deletes so the §5.2
  list stays reviewable in one place. Declared; Kd may veto.
NEXT CARDS: 🔴 DPDP JSON EXPORT — the other half of §5.2 and STILL BLOCKS P2.8.
  Split by Kd ruling because NONE of its infra exists (no R2/S3 client, no
  bucket env vars, no zip lib, no export-job table — all command-verified). A
  DEVIATION PROPOSAL is on file for it: serve GET /v1/users/me/export as plain
  JSON, no zip/R2/signed URL, which meets §5.2's "both flows exist at launch"
  with zero new infrastructure and keeps the export a table LIST · 🔴 Google
  login · 🔴 avatar storage (incl. unmet R3.9) · 🔴 XP/badges/leaderboard/
  predictions/exercise-library · 🔴 workout history calendar (BLOCKED, read its
  OWED entry) · 🟡 timezone TRAVEL rule · 🟡 real-phone camera smoke ·
  🟡 ROTATE GROQ_API_KEY (Kd's own action).
```

```
TASK: onboarding-storage — fitness-profile storage on the new API 🔴 (schema+migration)
      [branch onboarding-storage off master@1857be7 → PR #30. T3 DONE (fresh
       chat, Part I §7c): no blocking violations; 1 advisory FIXED (PUT {} test
       → suite 251→252). CI GREEN (all 4 checks, run #95). PROVE re-run against
       REAL Neon: 33 files / 252 passed. DPDP escalation RULED: accept + promote
       the Day-14/export worker card. READY TO MERGE — awaiting Kd's merge click.]
WHY: v1 §6.1:442 assigns onboarding data to `users` but Part 4 defines no storage;
  P2.7 DROPped the 13 Mongo fields (INVENTORY.md:45) and Part 2B §4.1:358's scorer
  has nothing to read; the web wizard still POSTs to old backend-ml. Hard P2.8
  blocker. API-only + additive → merges to master NORMALLY (unlike web-repoint).
SHIPPED (11 files): drizzle/0006_user_fitness_profiles.sql (+ meta/0005_snapshot,
  _journal tag) — NEW 1:1 table user_fitness_profiles (user_id PK, FK CASCADE
  flagged; Kd chose Option B over users-columns) · db/schema/identity.ts (table +
  the DPDP warning comment) · shared/src/users.ts (ported enums verbatim from
  backend-auth User.js:44-98; Kd-approved bounds; onboardingCompleted added to
  userProfileSchema; FitnessProfile/put schemas; updatedAt nullable = never-saved)
  · users/{schemas,repo,service,routes}.ts — GET/PUT /v1/users/me/fitness-profile
  (PUT = full-doc replace, absent→NULL, idempotent, active-only atomic upsert via
  INSERT…SELECT…ON CONFLICT; GET returns EMPTY profile not 404; /v1/users/me now
  LEFT JOINs onboarding_completed, COALESCE false) · test/users.fitness.routes
  .test.ts (9) · db.migration.test.ts (+1: 0006 DDL — PK, CHECKs, NULL-passes,
  cascade).
DECISIONS.md: 11 entries — placement, ported value sets, invented-not-spec bounds,
  fitness_level NULL not 'beginner', PUT semantics ({} clears profile — accepted),
  empty-profile GET, onboardingCompleted scope addition, DPDP CORRECTION (below),
  active-only upsert, no-duplicate arrays, the drizzle numbering trap.
*** DPDP CORRECTION (plan premise falsified mid-card) *** The FK CASCADE never
  fires on account deletion: Part 4 §5.2:829 ANONYMIZES users to a tombstone,
  never deletes. user_fitness_profiles holds medical_conditions (HEALTH DATA) —
  it MUST be added to the §5.2 Day-14 explicit DELETE list AND the JSON-export
  list, both owned by the QUEUED Day-14/export worker card (DECISIONS 2026-07-11).
  Recorded in DECISIONS + schema comment so that card inherits it.
TRAP (repo-wide, recorded in DECISIONS): drizzle-kit numbers from journal idx
  (0-based) but this repo's files are idx+1 → EVERY generated migration collides
  and must be renamed (file + journal tag; snapshot keeps drizzle's idx).
  Precedent verified: commit 34438bf.
PROVE ENV (Neon was DEAD mid-card — 28P01, free-tier branch reset AGAIN, 3rd
  time, cf. HANDOFF:123): PROVEd first on LOCAL docker pgvector/pgvector:pg16
  (`aihg-pg-prove`, :54329) while blocked. Neon LATER REPAIRED (see DECISIONS
  tail): new string in apps/api/.env (ep-wispy-rain), 6/6 migrations + seed
  applied to PRIMARY, 44 tables — final PROVE ran against REAL Neon.
*** ROOT CAUSE of PR #30's red CI (NOT this card's SQL) *** Neon's PRIMARY
  branch was EMPTY (0 tables) after the reset; CI branches FROM primary, so the
  migrations job cloned an empty DB and died in <1s. The GitHub NEON_API_KEY was
  always FINE. Prior PRs stayed green only because they added no migration.
  LESSON: green CI on a no-migration PR proves nothing about Neon's schema —
  after any Neon reset, repair primary (migrate + seed) FIRST.
PROVE (real output, full suite, POST-T3, against REAL NEON): `DATABASE_URL=...
  corepack pnpm --filter api exec vitest run` → 33 files / 252 passed / 0 failed
  / 0 skipped (251→252: the added PUT {} test). Scoped (local): users.fitness
  10/10, db.migration 6/6, users.routes 8/8. typecheck (shared+api) clean;
  eslint (touched files, both pkgs) clean; red-flag greps clean.
CI: run #95 all 4 green — typecheck/lint/test · engine grep · gitleaks ·
  drizzle migrations on Neon branch (58s = actually executing, vs 1s death).
T3 (fresh chat, 2026-07-15): NO blocking violations. Advisory 1 (R9.2, PUT {}
  test) FIXED. Advisory 2 (R11.4, container-lifetime caveat) informational.
  Security pass clean. DPDP ESCALATION → see the two Kd-decision entries in
  DECISIONS.md tail.
OPEN SPEC GAPS: none.
NEXT: **Day-14 hard-delete + JSON-export worker (Part 4 §5.2)** — PROMOTED to
  next-priority as the accepted price of merging this card (DECISIONS tail). It
  must add user_fitness_profiles to BOTH the Day-14 explicit DELETE list and the
  export list, and must land before real users exist (i.e. before/with P2.8).
  Then: P2.8 cutover still needs the web repoint (branch web-repoint, cards ②-⑦
  unbuilt) — the wizard/Settings/gate sites that consume THIS card's endpoint are
  owed there. NB the onboarding gate on web-repoint stays inert until a web card
  reads the now-available userProfile.onboardingCompleted.
PROVE CONTAINER: aihg-pg-prove (docker pgvector/pgvector:pg16, :54329) left
  running; `docker rm -f aihg-pg-prove` to clean up. Neon is repaired, so local
  PROVE can use apps/api/.env directly again.
```

```
TASK: argon2id rehash-on-login 🔴 (the P2.1 GAP-1 deferral; owed before P2.8 cutover)
      [MERGED via PR #28 (commit 2f178bb; merge 67b0ba7, final master 67b0ba7,
       2026-07-14). PROVE green (typecheck/lint, unit 17/17, DB-gated routes
       20/20 incl. rehash-flip). T3 (fresh chat) CLEAN — no violations, no
       blocking findings; the mixed-population timing residual + the
       algorithm:2 const-enum workaround confirmed as deliberate documented
       decisions, not findings.]
      *** P2.8 cutover PREREQUISITE (1 of 2) now SATISFIED. ***
SPEC: v1 §6.1 ("upgrade to argon2id on next login"), R3.7. Kd approved the plan.
DEP: +@node-rs/argon2 (prebuilt binaries, no node-gyp; win32-x64 + linux-x64
  prebuilts resolved at install). bcryptjs KEPT (verifies legacy hashes).
SHIPPED (5 source + 2 test files, no migration — hash_algo CHECK already allows
  'argon2id', identity.ts:37):
  · service.ts: PasswordHasher now { algo, hash, verify(pw,hash,algo),
    needsRehash(algo) }; bcryptHasher→argon2idHasher (verify dispatches
    bcrypt.compare vs argon2.verify — NB argon2.verify(hash,password) hash-first);
    DUMMY_HASH→argon2id (exported for test); login → verify-by-algo + BEST-EFFORT
    rehash-on-login (swallow+log, awaited, never fails a valid login);
    changePassword + resetPassword verify-by-algo & write hasher.algo.
  · repo.ts: type HashAlgo; hashAlgo added to UserAuthRow/UserAuthDbRow/mapper +
    BOTH SELECTs (findUserByEmail:50, findUserById:57); toHashAlgo guard;
    createUser + setPasswordHash take an algo param (were hardcoded 'bcrypt').
  · routes.ts: wire argon2idHasher.
  · auth.unit.test.ts: fake→new interface; +5 tests (verify-by-algo, needsRehash,
    DUMMY_HASH is argon2id, OWASP params). auth.routes.test.ts: register asserts
    argon2id; legacy-hash test EXTENDED to prove the bcrypt→argon2id flip +
    2nd-login no-op.
PROVE (all green this session): typecheck 0, lint 0, unit 17/17, DB-gated routes
  20/20 (Neon; incl. the rehash-flip test: legacy bcrypt verified → upgraded to
  argon2id → re-login byte-identical no-op). Red-flag greps clean.
DECISIONS (2026-07-14): argon2id params (OWASP), const-enum→literal 2, best-effort
  awaited-swallow rehash, DUMMY_HASH mixed-population timing limitation (accepted,
  self-healing), null-algo fail-closed, no migration. See DECISIONS.md tail.
NEXT: (1) T3 in a FRESH chat on `git diff master...argon2id-rehash`; resolve every
  finding + push. (2) then READY TO MERGE → PR → CI green → merge. (3) THEN P2.8
  cutover is unblocked on this prerequisite (still also needs apps/web repointed:
  authApi/coachApi/mlApi/nutritionApi → new API; only syncClient does today).
OPEN SPEC GAPS: none.
```

```
TASK: P2.7f — Mongo→PG migration: verify gates + prod runbook 🟡 (migration CAPSTONE)
      [MERGED via PR #27 (commits 5dc736d + 3e0bcd8; merge e43119b, final master
       e43119b, 2026-07-13). PROVE green (--verify-only on rebuilt Neon); T3
       (fresh chat) 1 finding FIXED + 1 advisory recorded. 4 pure tests green.]
      *** P2.7 Mongo→PG MIGRATION COMPLETE — all six stages (a–f) merged. ***
SCOPE (Kd-confirmed, DECISIONS 2026-07-13): P2.7f = strengthened §7 verify gates
  + a P2.8 cutover RUNBOOK document — NOT the live cutover. It repoints/freezes/
  decommissions NOTHING. (DECISIONS:194 defines the split as "verify gates + prod
  runbook"; live cutover is P2.8, premature — see PREREQUISITES below.)
SHIPPED: verify.ts +comparePerUser (pure) +verifyParity — PER-USER count parity
  across workouts/sets/meals/coach_messages/runs + UUIDv5 cross-ref spot-check
  (workout→user, samples only transform-accepted workouts after T3-A). run.ts
  +--verify-only mode (gates, NO writes) + elapsed-time log (§7 timing). RUNBOOK/
  cutover.md (the P2.8 procedure + prereq checklist; "flip data_backend" = the
  seeded feature_flags row, not an env var). Test: migrate.parity (4 pure,
  comparePerUser incl. swapped-but-equal-total case).
PROVE (--verify-only, live Mongo → Neon holding ALL six stages): every gate ok,
  per_user_mismatches=0, crossref_sampled=20 crossref_ok=true, elapsed ~12s.
  typecheck+lint clean.
T3 (DECISIONS 2026-07-13): finding A FIXED (cross-ref sampled all sessions
  regardless of migratability → a skipped session's absence-from-PG was a
  fail-closed FALSE failure; now samples transform-accepted only). Advisory
  recorded: workouts/sets per-user scoping is by migrated-user (no legacy_mongo_id
  column) so a MIXED db (migrated + native workouts for one user) could false-
  mismatch — harmless on greenfield/verified-dev, no fix.
FULL RUN CHEATSHEET (all stages, idempotent; env in apps/api/.env):
  corepack pnpm --filter api exec drizzle-kit migrate         # schema
  corepack pnpm --filter api exec tsx src/db/seed.ts          # reference data
  corepack pnpm --filter api exec tsx tools/migrate-mongo/run.ts [--apply|--verify-only]
NEXT — P2.8 CUTOVER (the actual go-live; SEPARATE task, BLOCKED on prerequisites):
  (1) argon2id rehash-on-login card (DECISIONS 2026-07-11, owed before P2.8).
  (2) apps/web repointed to the new API — today only syncClient.js → new API;
      authApi/coachApi/mlApi/nutritionApi still → OLD backend-auth/backend-ml.
  Then execute RUNBOOK/cutover.md (freeze → final --apply → --verify-only gates →
  flip data_backend flag → unfreeze → Mongo read-only 30d → decommission old).
  backend-auth/backend-ml/ml-training stay in-repo as the salvage source for the
  UNBUILT Phases 3–6 (money, exercise line, mobile, pilots) — do NOT delete yet.
OPEN SPEC GAPS: none. Old Mongo container (aihg-mongo) still running; Neon
  p26b-test rebuilt this session holds a complete verified migration.
```

```
TASK: P2.7e — Mongo→PG migration: coach + running (schedules deferred) 🔴
      [MERGED via PR #26 (commits f535f72 + 150b86f; merge e848147, final master
       e848147, 2026-07-13). PROVE green on live Mongo → Neon; T3 (fresh chat)
       CLEAN — no violations, 3 advisories (1 fixed, 2 recorded). 10 pure + 3
       DB-gated tests green.]
DECISIONS (2026-07-13, Kd-ruled): GAP-F (G-poly) polyline is opaque text
  (shared/geo.ts:38 "opaque text passthrough" z.string()) → legacy path/coords
  [lat,lng] arrays JSON.stringify'd, no encoder invented. GAP-G defer
  running_schedules (rule jsonb shape unspecified, n=1, 'cancelled'). GAP-H NOT
  NULL defaults: runs.duration_s=round(min*60) or 0, distance_m=round(km*1000),
  kcal_point=round(cal) or null, kcal_calc_version=0, source='mobile', splits
  jsonb or null; saved_routes.name=label or 'Legacy route', skip route on empty
  coords. GAP-I (ORDERING BUG, caught at plan review) all 11 convs have tied
  per-message timestamps + read path sorts (created_at DESC, id DESC) with a
  HASH UUIDv5 id → coach_messages.created_at = anchor + arrayIndex ms (anchor =
  first msg ts / updated_at / epoch) so created_at is strictly monotonic per
  thread. No gamification step (coach/runs don't feed getStats).
GROUND TRUTH (live Mongo, scanned this session): coach_conversations 11 (32
  messages; roles only user/assistant ∈ CHECK; 0 empty content; 2 distinct
  users). running_sessions 8 (duration_min/calories/splits missing in 2 each —
  guarded). running_routes 17 (0 missing coords/label). running_schedules 1
  (deferred). All user_ids among the 18 migrated. BSON types verified (no
  string-as-number). coach_messages has NO legacy_mongo_id (verify via thread
  membership); threads/runs/saved_routes DO.
SHIPPED (apps/api/tools/migrate-mongo/): collections/coach.ts (transformCoach +
  insertCoach, thread+messages in one tx, GAP-I anchor+index created_at) ·
  collections/running.ts (transformRun/transformRoute + inserts; asJsonValue for
  splits jsonb, workouts precedent) · verify.ts +verifyCoachRunning (threads/
  messages/runs/routes) · run.ts (coach → runs → saved_routes; run_schedules
  deferred log). Tests: migrate.coach (5 pure incl. ordering + role/content
  guards), migrate.running (5 pure), migrate.coach-running.idempotency (3
  DB-gated: ordering read-back via REAL getRecentMessages, polyline round-trip,
  idempotency).
PROVE (live Mongo → Neon): full --apply VERIFY all ok — coach_threads 11=11,
  coach_messages 32=32, runs 8=8, saved_routes 17=17 (+ all prior stages).
  typecheck+lint clean.
⚠ NEON BRANCH WAS RESET this session (free-tier): symptom = "password
  authentication failed" + new endpoint host (ep-summer-union → ep-plain-thunder),
  and the schema was WIPED. Recovered idempotently: drizzle-kit migrate → seed →
  full --apply (repopulated ALL stages). apps/api/.env now holds the new
  connection string. So the Neon test DB currently holds a COMPLETE verified
  migration of every P2.7 stage — a good state for P2.7f's end-to-end verify.
T3 ADVISORIES (DECISIONS 2026-07-13; NOT blockers): (1) migrated saved_routes
  store JSON coord-array polyline vs native client-encoded — a future map decoder
  must handle both (spec-ruled GAP-F, prod empty; accepted). (2) FIXED — ordering
  test now uses the real getRecentMessages path. (3) pre-existing: live coach read
  path has no id tiebreaker on equal created_at (out of scope, future coach task).
REMAINING P2.7 STAGES: P2.7f — full verify gates + cutover (P2.8): web .env →
  new API only, freeze Mongo read-only, decommission old backend-auth/backend-ml.
  LAST stage. Old Mongo container (aihg-mongo) still running.
OPEN SPEC GAPS: none.
NEXT: P2.7f (final verify gates + cutover). Neon test DB holds all stages;
  apps/api/.env has the current (post-reset) connection string.
```

```
TASK: P2.7d — Mongo→PG migration: meal_logs + body_measurements 🔴
      [MERGED via PR #25 (commits d8c5b73 + b39b0c0; merge 8627a23, final master
       8627a23, 2026-07-13). PROVE green on live Mongo → Neon p26b-test; T3 (fresh
       chat) CLEAN — no violations, 2 advisories recorded. 10 pure + 3 DB-gated
       tests green.]
DECISIONS (2026-07-13, Kd-ruled): GAP-A (the meal item) meal_logs.items is NOT
  NULL jsonb re-validated by @app/shared mealItemSchema on EVERY read → build ONE
  synthetic item: gramsPoint=100/gramsRange=[70,130] (placeholder), portionSource=
  'legacy' (honest flag; IS in the enum), nutritionSource='curated' (enum lacks a
  legacy value); row nutrition_sources=['legacy_model']. GAP-B drop meal_type/
  fiber_g/notes/quantity. GAP-C origin='manual' (no structured photo field). GAP-D
  body → users.weight_kg refresh to latest measurement (overwrites P2.7b weight).
  GAP-E re-run onMealLogged per meal-user (idempotent badge award; lazily
  reconciles streak to today). Meal row fixed: confirmed=true, kcal ±30% band,
  portion_source='legacy', calc_version=0, legacy_mongo_id=_id, ON CONFLICT (id).
GROUND TRUTH (live Mongo, scanned this session): meal_logs 16 (ONE user
  6a0d468a…, also a P2.7c workout user; keys meal_type/food_name/quantity/kcal/
  protein_g/carbs_g/fat_g/fiber_g/notes/consumed_at). body_measurements 1 (same
  user; weight_kg=75 + 7 *_cm + body_fat_pct). Both targets HAVE legacy_mongo_id.
SHIPPED (apps/api/tools/migrate-mongo/): collections/meals.ts (transformMeal pure
  + insertMeal idempotent; ONE mealItemSchema-valid item) · collections/body.ts
  (transformBody + insertBody + refreshUserWeight, mirrors nutrition/repo.ts
  refreshWeight verbatim) · verify.ts +verifyNutrition (meals/body via
  legacy_mongo_id, re-derived through the tested transform) · run.ts (meals →
  body(+weight refresh) → meal gamification onMealLogged). Tests: migrate.meals
  (6 pure incl. mealItemSchema.parse guard), migrate.body (4 pure),
  migrate.nutrition.idempotency (3 DB-gated: schema-valid read-back + idempotency
  + weight refresh + first_meal once).
PROVE (live Mongo → Neon p26b-test): dry-run meals 16/body 1/0 skipped; --apply
  meals inserted 16, body 1, weight_refreshed_users=1, meal gamification users=1,
  VERIFY meals 16=16 + body 1=1 ok (all prior gates still ok). typecheck+lint
  clean. Local secrets in apps/api/.env (gitignored).
T3 ADVISORIES (recorded, DECISIONS 2026-07-13; NOT blockers): (1) editing a
  MIGRATED meal later erodes provenance — nutrition/repo.ts updateMeal worst()/
  sources() don't recognize 'legacy'/'legacy_model' → a PATCH rewrites them to
  'user_dishware'/['curated']. Pre-existing P2.6a code, out of scope, accepted
  (prod starts empty). (2) verifyNutrition is count-only (per the ruled count-gate
  doctrine), lighter than §7:911-914's checksums.
REMAINING P2.7 STAGES: P2.7e coach_conversations→coach_threads+coach_messages +
  running_* (running_schedules deferred, G-rule); P2.7f full verify gates +
  cutover (P2.8). Old Mongo container (aihg-mongo) still running.
OPEN SPEC GAPS: none.
NEXT: P2.7e (coach + running). Old Mongo live; Neon p26b-test seeded.
```

```
TASK: P2.7c — Mongo→PG migration: workouts + workout_sets + gamification recompute 🔴
      [MERGED via PR #24 (commits 53e94a9 + 73d37f8; merge f2cf0a7, final master
       f2cf0a7, 2026-07-13). PROVE green on live Mongo → Neon p26b-test; T3 (fresh
       chat) 2 findings, BOTH resolved + pushed. 7 pure + 2 DB-gated tests green.]
DECISIONS (2026-07-13, Kd-ruled): GAP1=(a) explicit 14-name→slug map
  (exerciseNames.ts, reviewed constants table — seeded slugs are singular vs
  legacy plurals); unseeded names skipped + 'unknown_exercise' flagged. GAP2
  workout_sets.duration_ms=0. GAP3 workouts UUIDv5-only traceability (NO schema
  change). G-kcal (T3-A): DEVIATION from §7 — kcal recompute IMPOSSIBLE
  (active_seconds_by_exercise never persisted, per-set duration_ms=0 → recompute
  zeroes kcal), so keep stored calories_burned at calc_version=0; ratifies the
  P2.7a "pending" note. Re-run correction (T3-B): an INCREMENTAL re-run does NOT
  self-heal skipped names (global set_index shifts+collides; parent aggregates
  ON CONFLICT DO NOTHING) — to pick up P4-seeded names, do a CLEAN re-migrate
  (clear workout tables, re-run). Same-seed re-run IS a true no-op (tested).
GROUND TRUTH (live Mongo, scanned this session): 230 workout_sessions (0 missing
  started_at), 14 distinct exercise names (3 seeded: squat/jump_squat/chair_squat),
  262 items, 625 total prescribed sets, 356 RESOLVABLE (269 skipped), 3 distinct
  users with workouts (all present in the 18 migrated users). exercises[] are
  prescriptions {id,name,sets,reps} — 0/230 carry per-set perf.
SHIPPED (apps/api/tools/migrate-mongo/): exerciseNames.ts (NAME_TO_SLUG reviewed
  table) · collections/workouts.ts (transformWorkout pure + insertWorkout
  idempotent [workout ON CONFLICT (id), sets ON CONFLICT (workout_id,set_index)]
  + loadExerciseIds) · verify.ts +verifyWorkouts (workouts/sets/streaks gates,
  re-derive expected via the tested transform) · run.ts (users→workouts→recompute
  →verify; recompute REUSES gamification/service onWorkoutSynced, not reimpl) ·
  mongo.ts (reader now normalizes ALL top-level ObjectId→hex, was _id only).
  Tests: migrate.workouts (7 pure: unroll/mapping/guards/determinism),
  migrate.workouts.idempotency (2 DB-gated: unroll+idempotency+recompute; hook
  timeout raised to 120s for remote-Neon seed).
PROVE (live Mongo → Neon p26b-test): dry-run users 18/230 workouts/269 sets
  skipped; --apply VERIFY all ok (users 18=18, bcrypt 17/17, workouts 230=230,
  sets 356=356, streaks 3=3); re-apply inserted=0 (idempotent). typecheck+lint
  clean. Local secrets in apps/api/.env (gitignored) for future stages.
REMAINING P2.7 STAGES: P2.7d meal_logs+body_measurements; P2.7e coach+running
  (schedules deferred, G-rule); P2.7f full verify gates + cutover (P2.8). Old
  Mongo container (aihg-mongo) still running for these.
OPEN SPEC GAPS: none.
NEXT: P2.7d (meals + body_measurements). Old Mongo live; Neon p26b-test seeded.
```

```
TASK: P2.7a + P2.7b — Mongo→PG migration (inventory + harness + users) 🔴
      [MERGED via PR #23 (commit 0808d2d; final master 346528b, 2026-07-13).
       PROVE green on Neon p26b-test; T3 clean (6 findings resolved). Full
       suite 197/197.]
DECISIONS (all 2026-07-13, Kd-ruled): full migration BUILT per §7 (approach B —
  a DEVIATION to skip it was raised and REJECTED); PRODUCTION starts CLEAN (dev
  data NOT imported — the migration is a verified correctness artifact); UUIDv5
  in-house (NAMESPACE_AIHG=4fc832e8-4827-4475-bf8a-e72cc4b611c7); mongodb devDep
  approved (A); running_schedules deferred (rule shape unspecified, n=1).
GROUND TRUTH (live dev Mongo `aihg-mongo`, db ai_home_gym, scanned this session):
  users:18 (ONE merged auth+ml+onboarding collection; 17 pw, 1 google) ·
  workout_sessions:230 (exercises[] are PRESCRIPTIONS {id,name,category,sets,
  reps,rest}; 0/230 have per-set perf → workout_sets unroll = expand sets count,
  all engine cols NULL) · workout_templates:0 · meal_logs:16 · coach_conv:11 ·
  body_measurements:1 · running 8/17/1 · exercises:58 (not migrated, re-seeded).
  active_seconds_by_exercise NOT stored → §7 kcal recompute impossible (keep
  stored value). Full data-verified map: apps/api/tools/migrate-mongo/INVENTORY.md.
SHIPPED (apps/api/tools/migrate-mongo/): uuid5.ts (RFC-4122 v5, no dep) · weight.ts
  (KG_PER_LB port, NULL not 70) · mongo.ts (read-only, _id→hex) · pg.ts · verify.ts
  (§7 count + bcrypt gates) · run.ts (tsx CLI: dry-run/--apply) · collections/
  users.ts (transform + idempotent insert; gamification recompute DEFERRED to a
  post-workouts stage). Tests: migrate.uuid5 (RFC vector), migrate.users (pure),
  migrate.idempotency (DB-gated). Config: tsconfig+lint include tools/; mongodb devDep.
PROVE (live Mongo → Neon p26b-test): dry-run read=18/transformed=18/skip=0;
  --apply inserted=18, VERIFY count 18=18 (countDocuments, exact) ok, bcrypt
  17/17 intact; re-apply inserted=0 (idempotent). T3: 6 findings fixed
  (gate uses exact count; ON CONFLICT (id) + per-row fail-soft; Invalid-Date/
  bad-email/weight-overflow hardened). typecheck+lint clean. Full suite 197/197.
REMAINING P2.7 STAGES (owed, all rulings pre-approved with defaults in INVENTORY.md
  "Rulings still owed"): P2.7c workouts→workouts+sets (prescription unroll, kcal
  keep-stored) + gamification recompute (streaks/user_achievements); P2.7d meals
  + body_measurements; P2.7e coach + running (schedules deferred); P2.7f full
  verify gates + cutover (P2.8). Old Mongo container is running for these.
OPEN SPEC GAPS: none (G-rule = running_schedules deferred).
NEXT: T3 on this diff (fresh chat) → commit+PR → merge → P2.7c.
```

```
TASK: P2.6b — geo/running READ-plan side 🟡 [MERGED to master via PR #22
              (commit 31698a3; final master 20d530c, 2026-07-13). PROVE green
              184/184 on Neon branch p26b-test, T3 clean (1 R9 finding resolved).]
SCOPE SHIPPED (new module apps/api/src/modules/geo/, R7.1):
  ors.adapter.ts — OpenRouteService round_trip provider, plain fetch + Zod
    (NO SDK, vision.adapter precedent); ports routing_provider.py
    _call_ors/_parse_ors_feature/_normalize_route/_ors_extras_fraction
    ([lng,lat]→[lat,lng], native metres, waytype/surface fractions, loop).
    MOCK generator NOT ported (G2 — fabricated geodata; fail-closed).
  geocode.ts — two-layer geocode cache seam: Redis `geo:{lat3}:{lng3}` over the
    geo_cache Postgres floor, 3-dp rounding (v1 §6.1/§7.2). RESOLVER-LESS by
    design (G1); live provider + endpoint defer to P5 (geocode-on-save = mobile,
    v1 §12). Exercised by the fake-resolver integration test.
  repo.ts — sole DB toucher: runs read (list summary w/o polyline, detail w/
    polyline), saved_routes CRUD, geo_cache get/upsert, insertRouteGenCostEvent
    + module-local getLiveGymId (dup'd from nutrition, R7.1 disclosed).
  service.ts — generateRoutes (fail-closed: no-key/ORS-blip → GeoError 503, no
    mock; seeds 11+i*37; one cost row per successful ORS call), saved_routes +
    runs read seams.
  routes.ts — thin. Generate order: authn → validateGenerate (400 never meters)
    → requireQuota("route_gen") → handler. Endpoints: POST /v1/geo/routes/
    generate; POST/GET/GET/DELETE /v1/geo/saved-routes[/:id]; GET /v1/geo/runs;
    GET /v1/geo/runs/:id. cost.ts = ORS_ROUTE_COST_MICRO=0n (cited).
  errors.ts — GeoError (added to app.ts error-mapper allowlist).
  packages/shared/src/geo.ts — request/response Zod (R7.2); config.ts +ORS_API_KEY
    optional (GROQ precedent); app.ts registers geo + overrides.geo seam.
NO MIGRATION: all four geo tables (runs/saved_routes/run_schedules/geo_cache)
  already exist in 0001_init.sql (verified this session). Read-side card.
RULINGS (all in DECISIONS 2026-07-13): CORRECTION 1 targetKm gt=0/le=42.2/def 5.0
  ported verbatim (no floor); CORRECTION 2/G3 count 1–5 def 3, 1 quota slot/req +
  1 cost row/ORS call; G1 cache seam resolver-less by design; G2 mock dropped,
  503 fail-closed; G3 scoring+weather deferred (engine/P5); G4 run_schedules
  deferred, runs read-only (record/sync = P5); ORS cost=0 call-count row; splits
  omitted from runs read (unspecified jsonb, P5 owns writer).
PROVE (GREEN, Neon branch p26b-test, migrations 0001–0005 applied via
  drizzle-kit migrate): FULL suite 20 files / 184 tests PASSED, 0 failed, 0
  skipped = the 170 P2.1–P2.6a regression INTACT + 14 new geo tests (geo.unit 5
  + geo.routes 9). Explicitly verified: count=3 → 1 quota slot + 3 cost rows +
  seeds [11,48,85]; no-key & Redis-down both 503 with provider never called;
  free monthly limit 2 → 3rd req 429; saved_routes + runs cross-tenant 404;
  polyline detail-only; two-layer geocode cache miss→backfill / Redis-hit /
  PG-floor-hit; saved_routes pagination page-2 cursor round-trip. typecheck +
  lint clean, red-flag greps clean.
T3 (independent fresh chat, CLEAN): ZERO R0–R11 violations, ZERO security
  defects. One R9 coverage finding — geo pagination boundary untested — RESOLVED
  this session (added the page-2 nextCursor round-trip test; green above).
  Reviewer confirmed all deferrals (G1–G4) sound.
OPEN SPEC GAPS: none (G1–G4 all ruled by Kd at the gate).
DEFERRED TO P5: run recording/sync (runs write), route SCORING (scoring.py →
  @app/engine), WEATHER (check_weather), live reverse-geocode provider +
  endpoint, run_schedules CRUD, running XP/streak/badges (running.py record path).
NEXT: commit the P2.6b diff on a feature branch → browser PR (no gh CLI) → Kd
  merges → P3 (money & orgs) or remaining P2 cutover per Kd.
```

```
TASK: P2.6a — nutrition (Part 2B §3 pipeline) + body_measurements CRUD 🟡
              [MERGED to master via PR #20 (module, 34438bf) + PR #21 (T3 fixes,
               2bd5fbc — #20 was merged early by mistake before the T3 push; the
               follow-up PR carried exactly the fix commit; final master state is
               COMPLETE @ 47d3fe9, 2026-07-12). PROVE green 170/170 on FRESH Neon branch
               p26a-test (migrations 0001–0005 applied), ZERO skips — full
               P2.1–P2.5 regression + 13 new nutrition tests. Built across two
               sessions: the ruled implementation chat hit its rate limit
               mid-task; this session VERIFIED every ruling against the code and
               COMPLETED 3 gaps it left. Awaiting Kd review + T3 (required all).]
MIGRATION 0005 (SQL approved via ruling before code): meal_logs.origin text
  NOT NULL DEFAULT 'manual' CHECK (origin IN ('photo','manual')) — the
  photo-vs-manual discriminator Part 4 §3.6 lacked (R4.2: SQL-filtered ⇒ real
  column; one_time_tokens precedent). Journal idx 4 = 0005_meal_logs_origin.
WHAT SHIPPED (module apps/api/src/modules/nutrition/, R7.1):
  vision.adapter.ts — §3.2 Stage-1 identify-only contract (temp 0, JSON mode,
    .strict() schema with NO kcal/grams/macro fields — a reply smuggling them
    FAILS parse and keeps usage for the ledger); MEAL_VISION_MODEL default
    scout-17b (deprecation 2026-07-17 recorded — swap lever, not scope change);
  portion-priors.ts — Appendix B verbatim (containers/countables/densities);
    resolvePortion rungs: reliable count → 1 user_dishware → 3 regional prior →
    4 default (single-value collapse, no invented ±); rung 2 anchor DEFERRED;
  foods.ts — 130-row curated table ported 1:1 from food_database.py with
    source lines (count VERIFIED against the Python file);
  openfoodfacts.adapter.ts — usda.py port (misnamed salvage: it IS OFF);
    Search-a-licious → legacy CGI fallback, Zod-parsed, degrade-to-empty;
    EXEMPT from cost ledger (ruled: zero-cost, 24h Redis-cached);
  service.ts — five-stage orchestration; §3.5 RETAKE: parse-fail/poor-quality
    → single-use user-bound hashed Redis token (10 min TTL) that bypasses ONE
    quota increment, can't chain, fails closed; scan draft in Redis (scanToken,
    10 min); vision cost = BigInt 110k/340k micro-USD/1M (Groq Scout list);
    ledger row standalone at scan time (no companion rows exist — ruled);
    photo NEVER persisted/logged anywhere (2B §3.4 guarantee, ruled precedence
    over v1 §6.1's R2 path);
  routes.ts — analyze-photo (authn → validateScan[magic bytes jpeg/png/webp,
    10MB decoded, base64 strict, retake consume] → meter[skipped on retake] —
    400 never meters); meals POST = UNION photo-confirm{scanToken}|manual
    {mealName} (GAP-2 — manual path COMPLETED this session); meals list/get/
    patch/delete; dishware CRUD; body-measurements CRUD (nutrition owns them
    per Part 4 §3.6 — moved OUT of users); foods search;
  repo.ts — sole DB toucher; corrections written at confirm AND PATCH
    (meal_name/taken_at/items diffs, originals preserved — P4 doctrine);
    users.weight_kg synced to latest measurement (SUPERSEDES P2.2 GAP-2 —
    profile PATCH no longer appends history; DECISIONS);
  gamification repo/service — total_meals + photo_meals_logged (origin='photo')
    now real SQL; onMealLogged awards first_meal/photo_meal (badge hook
    failure degrades with a warn, never breaks the meal save).
COMPLETED THIS SESSION (gaps the rate-limited chat left): manual meal path
  (GAP-2) · takenAt ≤24h-future bound (GAP-3) on confirm/manual/patch ·
  .strict() query schemas · +3 tests (manual meal + badge separation,
  future-takenAt 400, Redis-down fail-closed 503 with provider never called).
T3 DONE (fresh chat, 6 findings + R9 gaps — ALL RESOLVED): (1) kcalPoint now
  CLAMPED inside its own rounded range (§3.3; was strandable outside a
  collapsed range); (2) gamification cross-table reads RULED as the read-only
  stats-aggregator exception (DECISIONS); (3) PATCH grams edits preserve each
  item's rung + correction rows stamped with the ORIGINAL's rung (Stage-5
  telemetry integrity); (4) dishware/measurement handlers now call real
  service seams, not repo re-exports; (5) the compressed one-liner style was
  REFORMATTED to house style (repo/service/routes — the tenancy WHEREs must
  be reviewable at a glance); (6) measuredAt got the same ≤24h-future bound
  (far-future rows would pin users.weight_kg forever). Sentry VERIFIED: no
  request-data integration, sendDefaultPii pinned false — imageBase64 cannot
  leak on 5xx (DECISIONS). Ledger residuals ruled (no-completion = no row;
  two-statement gym+insert; retake eaten by transient 500 — all DECISIONS).
  +9 tests: OFF adapter matrix (kJ→kcal, array names, CGI fallback,
  malformed→[]), thali/density resolver branches, §3.3 point-in-range pin
  (unit + end-to-end), cross-user meal DELETE + foreign scanToken + foreign
  retake token, corrections for items/taken_at edits + confirm-time diff.
DECISIONS: 10 P2.6a rulings + P2.2 GAP-2 supersession + manual-path note.
OPEN SPEC GAPS: none. IFCT pack, rung-2 anchor scaling, bias adaptation,
  onboarding-fields storage = queued follow-ups (ruled).
NEXT: T3 on this diff (fresh chat) → merge → P2.6b (geo read-side: two-layer
  geocode cache, ORS route_gen fail-closed + cost events, runs/saved_routes
  browse; run RECORDING is mobile P5).
```

```
TASK: P2.5b — coach gateway + metered chat 🟡 (P2.5 split, part b — completes P2.5)
              [MERGED to master @ ed53f8d via PR #19, 2026-07-12; commits 80c322e
               (module) + e825ef9 (T3 fixes). PROVE green 152/152 on Neon branch
               p22-test (reused), ZERO skips — full P2.1–P2.5a regression + 18 new
               (6 pure adapter/cost/prompt + 12 DB-gated chat/threads); shared
               19/19 + engine 147/147 re-proven. T3 DONE (fresh chat): 3 real
               findings ALL FIXED — (1) validate-before-meter (a 400 no longer
               burns a free quota slot); (2) global answer-cache PRIVACY LEAK
               closed (GAP-3 premise was false — prompt carried displayName +
               weightKg; displayName dropped from prompt, units+weightKg folded
               into the cache key, PROMPT_VERSION 1→2); (3) api_cost_events written
               in the SAME tx as the message rows (a spent call can't escape the
               ledger); + BigInt cost math (no float near money); +2 regression
               tests. Idempotency-key/per-route-rate-limit = recorded FOLLOW-UP for
               P2.8 client-wiring.]
FILES CHANGED (NO migration, NO new deps — fetch not SDKs):
  packages/shared/src/coach.ts (chat/thread contracts; 2000-char cap =
    routers/coach.py:32) + index export;
  apps/api/src/config.ts (+GROQ_API_KEY? OPENROUTER_API_KEY? COACH_MODEL
    default llama-3.1-8b-instant — key unset ⇒ coach 503s, app unaffected);
  coach/llm.adapter.ts (R2.2 adapter: OpenAI-compatible fetch, Zod-parsed
    R2.12; ProviderError{retriable}: 429/5xx/network/malformed retriable,
    4xx-our-fault surfaces; withFallback = v1 §6.1 Groq→OpenRouter; ported
    budget temperature 0.7 / max_tokens 800 = coach.py:96-97);
  coach/prompt.ts (coach.py:25-59 port, PROMPT_VERSION=1 tagged on every
    assistant row as model#pN; GAP-1: only stored fields, missing lines
    OMITTED); coach/service.ts (chat orchestration: cache→RAG→provider→
    persist→ledger; costMicro integer micro-USD single-round; CoachError;
    GLOBAL answer cache key sha256(version|model|normalized q), 24h, hits
    skip provider+ledger, quota already counted); coach/repo.ts additions
    (threads/messages keyed (id,user_id) R3.2; appendExchange one tx with
    clock_timestamp() ordering + 200-cap delete-oldest = coach.py $slice;
    getLiveGymId = §3.10 spend-time membership; insertCostEvent);
  coach/routes.ts (POST /v1/coach/chat = FIRST real requireQuota wiring,
    R3.3 authn→quota→parse→handler; thread list/get/delete, cursor, 404s);
  coach/schemas.ts; app.ts (coach wiring + BuildAppOverrides.coach{chatProvider,
  embedder} + ERROR-MAPPER CHANGE: typed client-safe errors now keep their
    OWN status incl. 5xx — CoachError 503 was being collapsed to generic 500;
    operational 5xx = warn-log, NO Sentry; unhandled errors unchanged);
  users/repo.ts getSyncContext +displayName/units (prompt profile via the
    R7.1 service export — no dummy-deps hack);
  test/coach.llm.unit.test.ts + test/coach.chat.test.ts (fake provider/
    embedder via overrides; covers fallback matrix, free-5/mo→429 w/ resetsAt,
    cache hit = no provider call + no cost event, gym_id attribution +
    costs:gym bump, provider-down 503 nothing stored, no-key 503 app healthy,
    cross-tenant 404s, >2000 chars 400).
DECISIONS (5, ruled at gate): GAP-1 prompt omits unstored onboarding fields
  (storage = queued ruled card, also feeds P2.6) · GAP-2 model default ·
  GAP-3 global cache · GAP-4 200-msg cap all tiers · GAP-5 Groq public price
  constants (50k/80k micro-USD per 1M in/out), fallback priced same until an
  OpenRouter line lands.
PROVE FIX (disclosed): central error mapper collapsed ALL ≥500 to generic
  internal_error — misreported CoachError's intentional 503; fixed as above,
  caught by 2 tests.
OPS NOTE: production needs GROQ_API_KEY (+optional OPENROUTER_API_KEY) in the
  deploy env + escrow doc; coach:ingest must run once per environment before
  chat retrieval has context.
QUEUE: argon2id before P2.8 · DPDP Day-14+export workers (BullMQ) · tz-capture
  card (+§3.5 tz-travel) · onboarding-fields card (GAP-1) · challenges/
  leaderboards/XP cards. usage_daily nightly rollup (v1 §7.2) still unowned —
  lands with the BullMQ/workers card.
OPEN SPEC GAPS: none.
NEXT: T3 on this diff (fresh chat) → merge → P2.6 (nutrition per Part 2B §3
  pipeline: one vision call, portion resolver, display standard; geo/running
  read side + geocode cache).
```

```
TASK: P2.5a — coach KB ingestion + pgvector retrieval 🟡 (P2.5 split, part a)
              [MERGED to master @ ba753d4 via PR #18, 2026-07-12; commits 94eb8ae
               (module) + b0d7532 (T3 fixes) + 42f9ff9 (test-infra housekeeping).
               PROVE green 134/134 on Neon branch p22-test (reused), ZERO skips —
               full P2.1–P2.4 regression + 9 new KB tests; PLUS real deliverable
               ran: `pnpm --filter api coach:ingest` embedded 14 chunks from 5
               guides at 384-dim into pgvector; real-MiniLM semantic spot-check
               confirmed (squat→form_guides, protein→nutrition, sore→recovery
               top-1). T3 DONE (fresh chat): R2.2 double-cast resolved by
               splitting the wrapper into embedder.adapter.ts — then the cast
               proved UNNECESSARY (library overload structurally assignable,
               zero casts remain); chunker "VERBATIM" claim corrected (the
               /\n\s*\n/ CRLF relaxation is now documented + DECISIONS +
               CRLF==LF boundary test); distance-metric rationale corrected in
               DECISIONS (cosine-on-normalized is the conventional MiniLM
               choice, NOT sentence-transformers' encode() default, and NOT
               bit-identical to old Chroma L2-on-raw — rankings can differ in
               principle, spot-check validated); rejected-pipeline-load now
               retries. HOUSEKEEPING (Kd-approved, own commit): vitest DB-run
               parallelism capped at 4 workers + seed test 120s budget —
               measured unbounded ~90s flaky / serial ~547s / capped 79s green.]
FILES CHANGED:
  NEW DEP: @huggingface/transformers (approved, R1.4) — local all-MiniLM-L6-v2
    (Transformers.js/ONNX), pulls onnxruntime-node + sharp;
  apps/api/src/modules/coach/knowledge/*.md (5 guides copied VERBATIM from
    backend-ml/app/ai/rag/knowledge — v1 §7.4 "re-ingest the 5 docs", not Chroma);
  coach/chunk.ts (knowledge_base.py:45-85 port: 500-word target / 50 overlap /
    big-para word-split, constants cited);
  coach/embedder.ts (Embedder seam: createMiniLmEmbedder — lazy pipeline, mean-
    pool+L2-normalize = sentence-transformers defaults, dim guard=384;
    createFakeEmbedder — deterministic FNV bag-of-words so CI proves ranking
    without ONNX);
  coach/repo.ts (ONLY kb_chunks toucher: upsertChunk ON CONFLICT (doc,
    chunk_index), deleteStaleChunks for shrunken docs, searchChunks cosine `<=>`
    SEQ SCAN per §3.7 "no ANN index", embedding as parameterized ::vector cast
    R3.8, meta shape-checked R2.3);
  coach/retrieve.ts (retriever.py port: top_k=3 coach.py:70, formatContext
    verbatim retriever.py:42-53);
  coach/ingest.ts (v1 §7.4 port; idempotent upsert+prune; CLI
    `pnpm --filter api coach:ingest`, DATABASE_URL-gated; downloads+caches ~90MB
    weights first run — DECISIONS GAP-2);
  apps/api/package.json (+coach:ingest script);
  test/coach.kb.test.ts (5 pure chunker/embedder + 3 Neon ingest/retrieval
    incl. idempotency ×2 and stale-tail prune).
DECISIONS (4): GAP-1 local MiniLM embedder (same model as salvage, honors 384
  pin, zero per-embed cost, no 2nd hot-path call) · GAP-2 weights cached at
  ingest not vendored · GAP-3 non-streaming coach v1 · GAP-5 Groq price = config
  constant citing public list (lands in P2.5b) · split ruling (P2.5b = Groq
  gateway + metered chat + api_cost_events + threads; OpenRouter FALLBACK is
  in-spec per v1 §6.1 and ships in P2.5b — corrected the plan's deferral).
NO migration (kb_chunks + vector(384) already in 0001).
CI NOTE: coach.kb.test.ts DB portion uses the FAKE embedder (no ONNX in CI); real
  MiniLM proven by the ops ingest run + spot-check, logged above. If CI lacks the
  transformers native deps, only the ingest CLI (an ops step) is affected, not
  the suite.
OPEN SPEC GAPS: none.
NEXT: T3 on this diff → merge → P2.5b (Groq gateway: fetch to OpenAI-compatible
  endpoint, Zod-parsed R2.12; Groq→OpenRouter fallback v1 §6.1; system-prompt
  port coach.py:25-59 + prompt version; requireQuota("coach") FIRST real wiring;
  api_cost_events per call w/ gym resolved at spend time; exact-match answer
  cache; coach_threads/messages + thread CRUD; non-streaming).
```

```
TASK: P2.4 — entitlement resolver + quota middleware 🟡
              [MERGED to master @ 6b131db via PR #17, 2026-07-11; commits 39336eb
               (module) + 07835b2 (T3 fixes). PROVE green 125/125 on Neon branch
               p22-test (reused), ZERO skips — full P2.1–P2.3 regression (incl. auth
               rate-limit suite on the NEW Redis store) + 20 new tests. T3 DONE
               (fresh chat): 1 robustness fix (unguarded JSON.parse out of the
               resolver → now self-heals to DB, never 500s /me+gate+coach-open;
               +corrupt-cache regression test) + 1 observability nit (rate-limit
               fail-open now warns); free period='all' consistency-over-90d-floor
               confirmed intended (DECISIONS), not drift.]
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

```
TASK: DPDP Day-14 hard-delete worker 🔴  [CODE COMPLETE 2026-07-23; the CUTOVER GATE STAYS OPEN]
  API (branch dpdp-day14-purge off origin/master): Part 4 §5.2's Day-14 hard
  delete. §5.2 ANONYMIZES the users row rather than deleting it, so NO FK
  cascade collects user-owned PII — the enumerated DELETE list is the only
  mechanism, and it now exists as apps/api/src/modules/privacy/.
  18 PII tables end empty per purged user: 15 direct DELETEs + 3 collected by
  CASCADE (meal_log_corrections, coach_messages, workout_sets). Tombstone per
  §5.2 (email NULL, 'Deleted user', weight NULL, row KEPT). Leaderboard
  display_name scrubbed element-wise. user_fitness_profiles IS included, so
  the condition onboarding-storage was merged on (DECISIONS 2026-07-16) is
  discharged for the delete half. Runs on BullMQ (NEW DEP, Kd-approved,
  5.80.10) from a new `worker` entrypoint (v1 §6), plus tools/dpdp-purge.ts
  which is DRY BY DEFAULT (--apply to destroy). Retention is ONE constant
  (src/retention.ts) that also drives the undo window, the restore-token TTL
  and the user-facing copy — there were FOUR hard-coded 14s, two of them the
  strings users read, so widening to GDPR's 30 would have had the API lying.
  NO migration. api 331/331 on Neon; typecheck/lint/greps clean.
  FIVE fresh-chat T3 rounds, 9+9+9+4+0 findings. The card's whole lesson is
  one fault repeating: FOUR times a fix closed the case it was shown and left
  the class open, and my "mutation-verified" claim for the round-3 concurrency
  fix was hollow because the test was SEQUENTIAL. What finally worked:
  reproduce the bug yourself first, make the question DECIDABLE rather than a
  heuristic, and mutation-test for the RIGHT reason. Round 5 clean: an
  independent reviewer re-probed the race (B-first, N=5 production path,
  restore-vs-lock) and the mutation, and reported the records match the code
  for the first time.
  BIGGEST CATCHES: a cross-tenant DELETE (my own "defence in depth" destroyed
  an ACTIVE user's workout_sets via a denormalised user_id — probed);
  a double-marker race that survived two "fixes" (READ COMMITTED evaluates a
  correlated NOT EXISTS folded into the FOR UPDATE statement against the
  PRE-LOCK snapshot — it must be TWO statements); and three text heuristics
  for "did a name survive?" that were each defeated by the next shape, now
  replaced by a structural conformance gate.
  ⚠ THE GATE IS STILL OPEN AND MUST NOT BE TICKED: the sweep is SCHEDULED
  NOWHERE. No Dockerfile exists, docker-compose.yml has no api/worker service,
  ci.yml has no deploy job. Code that runs nowhere deletes nothing.
  ⚠ CI ENFORCES NONE OF IT: `pnpm test` runs with no DATABASE_URL, so all 17
  purge tests skip on merge. Its own OWED line.
NEXT CARDS: 🔴 DPDP JSON-EXPORT (the other §5.2 half; needs R2+zip or the
  recorded no-infra DEVIATION: GET /v1/users/me/export returning JSON) ·
  🔴 deploy the worker (Dockerfile + compose service) — what closes the gate ·
  🔴 CI must run the DB suites (a Neon branch for the test job) ·
  ❓ Kd rulings owed: privacy-law scope (GDPR/CCPA timers), SPEC GAP 1 (the
  user-bearing tables §5.2 does not name — refresh_tokens keeps ip+user_agent
  for a purged person), SPEC GAP 2 (password_hash on the tombstone) ·
  🔴 Google login · 🔴 avatar storage · 🟡 ROTATE GROQ_API_KEY.
```

```
TASK: DPDP data export 🔴  [DONE 2026-07-23, merged PR #46 (5c76d6c)]
  API, branch dpdp-export off master. GET /v1/users/me/export returns the
  user's data as JSON: 17 tables + profile, DERIVED from the Day-14 delete
  list (EXPORTED_TABLES = PII_TABLES − EXPORT_EXCLUDED_TABLES) so §5.2's two
  rights cannot drift apart; a DB-FREE test fails if a table lands on neither.
  Kd-ruled DEVIATION on delivery ONLY: §5.2 says "JSON zip via signed URL,
  7-day expiry" and this returns JSON from an authed endpoint, because that
  infra does not exist (no R2 client, no bucket keys, no zip lib) and v1 §18
  itself says "data-export endpoint". Content identical either way.
  Kd rulings: push_tokens EXCLUDED (device credentials, spoofing vector),
  auth_identities INCLUDED, users columns ENUMERATED not SELECT * (fail-closed
  — a new column is missed, never leaked), rate limit 3/hour PER USER.
  api 341/341 on Neon. No migration, no new dependency.
  THREE fresh-chat T3 rounds (10 + 6 + 4 findings). The lesson, and it is the
  same one three times: I fixed the artifact that was NAMED and left the
  identical weakness one level down — reader map key → strip map key → strip
  map VALUES. Each time tsc was silent and the CI-visible suite was green.
  BIGGEST CATCHES: the rate limit shipped with an IP dimension that refused a
  second gym member's FIRST export (Jorhat gyms = shared connections, P6) and
  cited a precedent that says the opposite in as many words — inverted, not
  quoted (V2); SELECT * shipped our per-request AI cost on every coach message
  and the anti-cheat flags v1 §14.1 calls SILENT; and my own tests were blind
  TWICE (the rate-limit test used a different IP per request by design; the
  credentials test could not see internal columns until I mutation-tested it).
  What finally worked: break the fix on purpose and watch the test go red.
  OPEN, recorded not ruled: whether gym_members + leaderboard_snapshots belong
  in the export (same gap as the delete side — rule them TOGETHER so the two
  rights stay symmetrical); the strip is COLUMN-level and cannot see inside
  jsonb (matters when P4.y lands); workout_sets exports its denormalised
  user_id; users.deleted_at omitted with no stated reason.
NEXT CARD (Kd-picked): CI must run the DB test suites. MEASURED 2026-07-23:
  `pnpm test` with no DATABASE_URL = 153 passed / 188 SKIPPED, and 16 of 36
  test FILES never run — including every Day-14 purge and export test. The
  mechanism already exists: ci.yml's `migrations` job creates a Neon branch,
  applies migrations, deletes it. It just never runs a test. Approved shape:
  extend THAT job (zero extra Neon branches) with seed + `pnpm --filter api
  test`; keep `gate`'s DB-free `pnpm test` for fast feedback. Only apps/api
  needs a DB (verified). No seed npm script exists — call
  `tsx src/db/seed.ts`. NB CI branches FROM primary with init_source:
  parent-data, so it clones DEV DATA — a real flakiness vector, and the open
  question is whether to start the CI branch EMPTY instead.
THEN: 🔴 deploy the worker (closes the DPDP gate; needs a Dockerfile +
  compose service — NONE exist, and it is ~₹400-1,200/mo, so it is a Kd money
  call) · 🔴 web-repoint owed endpoints · ❓ Kd rulings owed (privacy-law
  scope; refresh_tokens keeps ip+user_agent for a purged person; password_hash
  on the tombstone) · 🟡 ROTATE GROQ_API_KEY (Kd's own action, deferred 5×).
```

```
TASK: CI runs the database-backed api suites  [DONE 2026-07-23, PR #47, branch ci-db-tests]
  THE GAP (measured): `gate` runs `pnpm test` with NO DATABASE_URL → 153 passed
  / 188 SKIPPED, 16 of 36 files never run, incl. all 17 purge + 8/10 export
  tests. The only irreversible-delete code had zero enforced coverage on merge.
  FIX = SPLIT the CI database work into two jobs:
  - `migrations` (Neon): create branch → migrate → delete(if:always). Proves DDL
    on a real primary-cloned branch (R9.4 cloned-staging half; DECISIONS
    2026-07-16). No seed, no tests, no timeout — fast again.
  - `db-tests` (NEW): migrate → seed → `pnpm --filter api test` against a
    pgvector/pgvector:pg16 SERVICE CONTAINER on the runner.
  WHY NOT tests-on-Neon (the first cut, commit 34aa7c0): PROVE measured it GREEN
  but ~38 min (uniform Neon latency from a GH runner, NOT a hang) — overran a
  30-min cap. Kd ruled (AskUserQuestion): move tests to local PG. ~2 min on CI,
  46 s local; no paid Neon compute per PR; test DB clean-by-construction, which
  also CLOSES the kickoff's "CI branch clones dev data" flakiness question.
  FILES: .github/workflows/ci.yml + apps/api/package.json (`seed` script). No
  source, no migration, no dependency (the pgvector image is a CI SERVICE, not a
  package dep).
  PROVE: (a) `api tests on local Postgres` GREEN 341/341, 0 skipped. (b) flipped
  a purge assertion (0→999) → that check RED (ONLY it; `gate` stayed green — the
  gap shown live), reverted by --force-with-lease (break commit 131417f NOT in
  merged history). Fresh-chat T3: no blocking defect ("the change is sound").
  RECORDS: DECISIONS.md entry (this branch → master) + this block. web-repoint
  OWED: ticked "CI runs none of the database tests" DONE + added a residual line
  — assert the DB suites POSITIVELY executed (count floor / fail-if-skipped),
  defense-in-depth vs a future skipIf/env refactor. NO silent-skip path exists
  TODAY (shared job-level DATABASE_URL + the migrate/seed canary fail loudly on
  a bad URL before tests run).
  required-checks have no teeth on merge here — DECISIONS 2026-07-06: GitHub Free,
  green-before-merge is procedural. Not this card's to fix.
NEXT (unchanged): 🔴 deploy the worker (closes the DPDP gate) · 🔴 web-repoint
  owed endpoints · ❓ Kd privacy-scope rulings · 🟡 ROTATE GROQ_API_KEY.
```
