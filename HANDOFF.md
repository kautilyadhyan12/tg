# HANDOFF — the last thing each chat did (newest first, ten lines each)

Format: date · what was built or decided · what is verified (commands run) · what is open. Older
entries move to `archive/records/` when this file passes forty entries. The record before
2026-09-07 is `archive/records/HANDOFF-2026-07-06-to-2026-09-07.md`.

## 2026-09-10 · Onboarding screens 1–7 (item 4a-ii), branch `onboarding-screens-1-7`

- Built: seven screens replace the old five-step form (`pages/Onboarding.jsx` + `pages/onboarding/`): one goal · about you
  (typed, kg·cm or lb·ft) · target (lose/gain only) · your day · your training (checks skippable, plank timer) · your week ·
  equipment ("No equipment" exclusive; an old "none"+equipment answer loads without "none"). Taps save through one queue;
  the server's number and its flags in words on every screen once it exists; a returning person lands on the first gap.
- Server: PATCH refuses `onboardingCompleted: true` while the plan lacks an answer (409 with the list, inside the save's
  transaction, so a refused body writes nothing). The pace table moved to `@app/shared`. Rings' move split out as 4a-iii.
- Verified: shared tsc + 81; api tsc + eslint 0; local Postgres plan.unit + users.onboarding 79; web eslint 0 (touched
  files); web 1921 passed (poseAssets.contract is the known local encoding red). Run red first: finish rule off (409→200),
  date formatter without UTC (Los Angeles showed Nov 18), and the wizard's sign-out mutants D16/D17 by hand.
- Found: `mutate-login-door.mjs` aborts at D9 (anchor is the "I run a gym" label renamed 2026-09-07); not re-anchored.
  CI's first run failed `xpDisplay` "non-array recommendations" (reads the message without waiting; 3/3 locally): item 10.
- Kd clicked through: passed. His look changes, built the same day (RULINGS 2026-09-10): line icons for emoji, a big units
  switch first, a clickable step bar, no number box before the number, the disclaimer's first sentence only under it.
  Pushed as 7508a3d; all five CI jobs green.
- FIVE FIXES REMAIN on this branch before the review, from his second look (build them first, plan first, tests alongside):
  (1) Flexibility and Pull-up bar icons drawn by hand in lucide's line style — the library's wheelchair and arrow are
  wrong; (2) age, height, weight and target become flick wheels with + and − buttons — nothing typed, nothing pre-filled
  (RULINGS: tap-only screens; "Not set" until touched, as Settings' slider does); (3) "About you" opens with "What should
  we call you?", the one typed box that stays, saved as `displayName` (a code sign-in names the account after the email's
  local part today; Settings can change it); (4) screen 5 asks "How many push-ups can you do in a row?" and "How long can
  you hold a plank?" as plain questions with a "Not sure" tap — no timer, no test wording; nothing reads the two numbers
  until 6a; (5) "How is this worked out?" under the number: the SERVER sends the steps (it alone knows the day factor,
  the MET and the protein table), the screen prints each with Kd's own numbers and the source named in maths.ts's header.
- Then: tests, Kd's click-through again, the fresh-chat review, merge. After merge: 4a-iii (rings, small) → 4a-iv (goals
  and gym) → 4b (health). Kd builds the rest with a different model; his goals ruling is in RULINGS and its design in 4a-iv/6a.
- OPEN DECISIONS, to ask in the next plan: B "A gym" on screen 7 (recommended yes) · C the health question gains "or take
  any medicine, including for weight loss" (recommended yes) · D "follow their advice over the app's" stays on sign-up,
  the health step and the plan screen for the lawyer to reword (recommended yes). Kd has not answered these.
- Local servers (memory `run-api-locally-env-file`): API on local Postgres, web on 5173; the sign-in code prints in the
  API log. `kd.onboarding.test@example.com` has finished onboarding on the local database — use a fresh address, or
  Settings → Reset onboarding. Until 4a-iii the Nutrition rings can show a different daily number.
- Two more asks from Kd, both for 4b, NOT this branch (each needs a column): veg / non-veg on the food screen, and a
  running question for everyone on screen 5 plus the runner's own on screen 10 — ruled and specified in RULINGS
  2026-09-10 and ROADMAP 4b / 7b.

## 2026-09-10 · Weight has one source and no copy (item 4a-i-b), branch `weight-one-source`, PR #59

- Built (Kd's redesign, RULINGS 2026-09-10): `0027` re-runs 0026's backfill, drops `users.weight_kg`, adds the
  `source` CHECK, clears ages under 16; every screen reads the newest weigh-in (`currentWeightKg`); re-sending the
  weight already showing writes nothing; the web profile form sends only what changed (the old onboarding form does not).
- Also fixed: the Mongo import skips the profile weight of a person it could not import (it stopped the run);
  the spec's workout-calorie rule keeps "≤ workout time"; stale "weight is on the user row" comments corrected.
- Verified: api tsc + eslint 0; shared tsc 0; web 34 (userApi, the new Settings form render test, measurements);
  local Postgres migrate.nutrition + db.migration + users.onboarding 62. The new import test failed first; Settings
  forced to send the weight, and the reader made to ignore a clear, each turned a new test red.
- Kd waived the re-check (no Critical/High); merged 2026-09-10 (PR #59, five CI jobs green, branch deleted). Item 10
  gains a defect: workout calories use the weight on the day it syncs, not the day it was done. Next: 4a-ii.

## 2026-09-10 · Onboarding v2 server half (item 4a-i), branch `onboarding-plan-server`, PR #58

- Built: `GET`/`PATCH /v1/users/me/onboarding` — answers saved as you go, the live plan or the list
  of what is missing (contracts in `packages/shared/src/onboarding.ts`); migration `0026` adds five
  answer columns, then a typed row under every existing weight. One main goal (RULINGS 2026-09-09).
- Weight (RULINGS 2026-09-10): the history is the one source, `users.weight_kg` its cache. A typed
  weight is a `self_reported` row dated after everything else; a same-day retype edits it; a clear is
  a typed row with no weight. Every history write takes the users row first and refuses a deleted account.
- Verified after the last review round (no Critical/High left): api tsc + eslint 0; shared tsc + eslint
  0, 81 tests; local Postgres users.onboarding 34, nutrition.routes 30, db.migration 23, migrate.nutrition
  4, users.routes 8; web 2; a fresh database takes all 26 migrations; six deliberate breaks each failed a test.
- Kd waived the re-check of the last fixes (no Critical/High). Merged 2026-09-10 (PR #58, all five CI
  jobs green, branch deleted). Next: 4a-ii, the seven screens (the `fitness_goals` mirror ends there).

## 2026-09-09 · Item 3c struck (allergen tags); next is 4a

- Kd was offered the 3c plan (tag the 131 curated foods, a "contains …" line on search and meals, no
  allergy question) and ruled it not needed: every meal suggestion gets a food-allergy caution line
  instead, built with 7a; nothing ever asks about allergies. RULINGS and ROADMAP updated; no code touched.
- Worth knowing for 7a: the food list is code (`apps/api/src/modules/nutrition/foods.ts`), not a
  table, so there is no allergen data to reach for — the caution line is the whole answer.
- Open: Stage 1 item 4a (onboarding screens 1–7) starts in a fresh chat on a branch off `master`.

## 2026-09-09 · Health screening, Safe mode and the consent log (Stage 1 item 3b), branch `health-screening`

- Kd ruled mid-plan (RULINGS 2026-09-09): ONE general health question, no named condition ever
  asked or stored (a fitness app, not a medical one); any yes = no calorie cut, cleared or not;
  changeable after sign-in. The plan contract's health block is now `{ hasCondition, safeMode }`
  and the no-deficit reasons `under_18 · health_answer · safe_mode`.
- Built: `packages/shared/src/health.ts` (screening + consent contracts, `deriveHealthFlags`, the
  three disclaimer wordings v1 with a test that bans "safe for you" / "treats" / "cures");
  migration `0025` (`user_health_screenings` 1:1 with two CHECKs incl. the contradiction guard;
  `consent_log` append-only, wording copied verbatim, FK with NO cascade); routes GET/PUT
  `/v1/users/me/health-screening`, GET/POST `/v1/users/me/consents`; `getPlanHealth(sql, userId)`
  in users/service is the flag every plan route reads (4a uses it); the API's macro-rings number
  (`/v1/nutrition/targets`) now holds the −400 cut for a yes AND under 18, and the response says so
  (`noCalorieCut`); nothing on the web screen shows it yet — 4c owns that.
- Privacy: `user_health_screenings` on the Day-14 delete list and in the export; `consent_log`
  KEPT after a purge (proof of the tap, like audit_log) and exported — Kd was asked to confirm the
  keep, not yet answered.
- Review round 1 (2026-09-09): three High, six Low, five test gaps. Fixed: the under-18 rule was
  missing from the targets route (H1, now tested at 16/17/18 in unit + route); consent POST gets a
  30/hour per-person limit, the list returns `total` beside the capped 100, the export read is
  bounded at 1000; a repo-level test for the active-only inserts; the PK column asserted by name;
  the re-run 429 was the address's 60-second code gap (sign_in_codes now cleared in setup, proved
  both ways). Two are Kd's decisions, asked: the old free-text "medical conditions" box still
  stored on the fitness profile (H2 — comments corrected meanwhile) and consent_log after a purge (H3).
- Verified after the fixes: shared tsc + 66 tests; api tsc + eslint exit 0; `plan.unit` +
  `nutrition.unit` 76; local Postgres per file: `users.health.routes` 19 (twice, back to back) ·
  `db.migration` 21 · `privacy.purge` 21 · `privacy.export` 10 · `users.fitness.routes` 10 ·
  `nutrition.routes` 29. Mutations: under-18 line and the active-only guards removed → 3 tests red.
- Kd ruled the same day (RULINGS 2026-09-09): consent log kept six years past deletion, then
  removed — built as a run-level step of the Day-14 purge (`CONSENT_PROOF_RETENTION_DAYS`,
  `repo.deleteExpiredConsentProof`, fake-clock test); the old conditions box goes at 4b.
- Re-check (fresh chat): one High, five Low, four test gaps — all fixed in this commit. The consent
  limiter's IP dimension capped a whole gym at thirty an hour, so the eleventh person onboarding from
  the gym's wi-fi could not record their tap (`ipMax: 600`, the trial door's pattern); the export's
  1000-row consent cap was silent (the envelope gained `truncated`, schemaVersion 2); the proof now
  outlives six CALENDAR years (`6*365+2` — the old number deleted it two days early); a failed
  consent-expiry step no longer reads as a member's failed purge (its own field, both entrypoints
  still fail the run); the two comments that contradicted RULINGS 2026-09-09 corrected.
- Every new test was run RED against the old code first: 11 people × 3 taps from ONE address all 201 ·
  the export cap AND its count · an ACTIVE user with a stale `deleted_at` keeps their proof (pins the
  `status = 'deleted'` clause) · a failed expiry reports `errors: 0` with its own flag · and an
  UNGATED (so CI runs it) check that the window is never shorter than six calendar years.
- Verified after the re-check fixes: shared tsc + 66 tests; api tsc + eslint exit 0; `plan.unit` +
  `nutrition.unit` 76; local Postgres `privacy.purge` 24 · `privacy.export` 12 · `users.health.routes`
  20 (56 in one run) · `db.migration` 21; the CI-shaped run with no DATABASE_URL 296 passed.
- Re-check round 2 (fresh chat): NO Critical/High — four Lows and three test gaps, all fixed in
  this commit. The export's consent read is ONE statement now (`count(*) OVER ()`, so a tap landing
  between two round trips can no longer make the file announce a cut that never happened) and reads
  NEWEST-first like the list route, so a capped export keeps the taps the person agreed to LAST;
  the consent limiter's address ceiling is the gym-floor 3000 (600 was still under a 300-member
  induction's 900 taps); `noCalorieCut`'s doc no longer points a screen at a flag that cannot
  answer "does the under-18 rule apply to this person" — nothing does, so 4b/4c read the age.
- The shortfall rule lives once now (`purgeShortfall`), called by both entrypoints. Neither
  `src/worker.ts` nor `tools/dpdp-purge.ts` is imported by any test, so deleting
  `|| consentProofExpiryFailed` from both copies left the whole suite green — and a run whose
  six-year expiry failed would have been acked COMPLETED (no failed set, no Sentry, exit 0).
- Every new test was run RED first: the dropped shortfall term · an inline copy put back in
  worker.ts · the export read flipped to oldest-first (the file then led with `older-1000`, the
  fixture's newest row gone) · `truncated`'s `.strict()` and its refine, removed one at a time.
- Verified: api tsc + eslint exit 0; shared tsc + eslint exit 0; shared 69; the CI-shaped run with
  no DATABASE_URL 299 passed; local Postgres `privacy.export` 12 · `privacy.purge` 27 ·
  `users.health.routes` 20 (59 in one run); the FULL local suite 931/939 — the 8 are
  `workouts.sync`, which passes alone (23), ROADMAP item 10's shared-database flake. That full run
  earned its keep: it caught the new cap test stamping its rows from `now()`, which on a loaded
  database put a seeded row ahead of the fixture's own. Stamped from the fixture's row instead.
- Kd ruled the same day (RULINGS 2026-09-09): a card with no screen gets no click-through, so 3b
  is proved by its tests and checks alone. Merged to `master` 2026-09-09 on his word (PR #57, all
  five CI jobs green, branch deleted, roadmap ticked). Only `master` and the stale local
  `workout-calendar-parked` remain.
- Open: Stage 1 item 3c (allergen tags on every food), then 4a. 4b builds the health screen these
  routes are waiting for, and switches off the old free-text conditions box.

## 2026-09-08 · The plan maths and its sanity rules (Stage 1 item 3a), branch `plan-maths`

- Built: the contract `packages/shared/src/plan.ts` (answers so far in, `plan` or `missing` out,
  never both) and the pure calculator `apps/api/src/modules/plan/maths.ts`: resting burn
  (Mifflin-St Jeor, as the nutrition targets), daily burn from the day's factor plus the week's
  training, pace → cut or surplus, macros (the targets' protein table, 25 % fat, 50 g carb floor),
  finish date from a "today" the caller passes (no clock). Flags: target wrong direction ·
  target below the healthy weight (BMI 18.5; the plan runs to the floor) · over a year (with the
  gentlest pace that fits, or null) · calorie floor 1200 applied · no deficit (under 18,
  pregnancy, heart, blood pressure, diabetes). Health unanswered = no condition rule yet.
- Engineering choices: day factors are the no-exercise ones (1.2 / 1.3 / 1.45 / 1.6) because
  training is added on top at 5 MET; paces 0.25 / 0.5 / 0.75 kg a week, the same table for a gain.
- Verified: shared + api tsc and eslint exit 0; `test/plan.unit.test.ts` 36 passed; shared 59 passed.
  `tools/plan-preview.ts` prints the numbers for one person (the click-through). No screen, no
  route, no migration — 4a builds the route and screens on this contract.
- Review round 1 (fresh chat): 4 High + 7 Low + 5 test gaps, all fixed in the second commit. A target
  the calories cannot reach (the floor left no cut, or more than ten years away) is now the flag
  `target_out_of_reach` with no date, instead of a crash or a finish date in the year 4417; the
  screen's numbers subtract and add up exactly (change = eat − burn on whole kcal; the macro grams
  make the calories, protein giving way to the 50 g carb floor for a heavy body); one rounded
  healthy-weight floor; two-decimal rails and a bounded start day in the contract; the profile's
  age rail is 16 (RULINGS 2026-09-07) on the server and the old web form; the nutrition targets
  now read resting burn, the floor and the macro split from the plan calculator (the activity factor
  and the cut still differ — moved to 4a in ROADMAP); the preview tool's health screen is unanswered
  unless all four answers are given. Safe mode's `safe_mode` reason noted on 3b.
- Verified after the fixes: shared + api tsc and eslint exit 0; `plan.unit` 44 + `nutrition.unit` 28
  passed; shared 59 passed; `users.fitness.routes` 10 passed on local Postgres.
- A live screen moved: the macro rings' protein gram now gives way to the 50 g carb floor, so a
  very short, very heavy or very old profile (the reviewer measured about 0.5 % of a 912 912-profile
  grid; largest change 242 g → 182 g) shows a smaller protein number than before. It was a bug — the
  old number did not fit in the day's calories — not a ruling change.
- Re-check (fresh chat): no Critical/High; three Lows and three test gaps, fixed in the third commit:
  the flag docstring says when the plan holds the weight instead of running to the floor; resting
  burn takes the `Gender` enum again (the nutrition targets narrow their string once, failing loud);
  the no-clock test compares every field under two clocks; the gain-floor test asserts the flag; and
  a grid sweep over the schema's corners (every goal, both formulas, the age/height/weight rails,
  targets on both sides and past the horizon) checks every plan adds up and the contract accepts it.
- Merged as PR #56 on 2026-09-09 (CI green; branch deleted). On the way, the attendance boundary
  test was fixed to never sit on the gym's midnight (CI had run at 00:00 Kolkata and the test's
  own premise failed before the code ran). Kd merged on the re-check's verdict: no Critical/High.
- Open: 3b (health screening, Safe mode, consent log).

## 2026-09-08 · Words by type everywhere else (Stage 1 item 2b), branch `words-by-type`

- Built: one word table in `@app/shared` (`orgWords.ts`) read by the API and by every screen —
  a gym has members and a Trainer, a studio and a personal trainer have clients and a Coach.
  A personal trainer's org has TWO nouns: their console says "business", their clients read
  "trainer". About sixty sentences now follow it: the console shell (Studio console · Clients),
  Overview, roster, Settings, staff, codes, hours, attendance, the plan prompt, and the member's
  join door, My Gyms and attendance card.
- Server: the join refusals name the place in its own word ("Ask the studio for a current one");
  a code matching nothing says "any gym, studio or trainer"; the not-on-plan, archived, staff,
  cheer and nudge messages follow the type. "Gym not found." became "Organisation not found." —
  that 404 cannot know a type, and telling a stranger one would answer a question they were refused.
- Verified: shared + api tsc and eslint exit 0; engine 213 passed; shared 59 passed; web 1857
  passed (the pre-existing `poseAssets.contract.test.js` encoding failure is red on clean master
  too — checked by stashing); api `orgs.routes` + `orgs.hours` + `orgs.attendance` 227 passed and
  `orgs.cheers` + `orgs.nudges` green. The full api run showed 3 failures in `catalog.seed`, which
  pass alone: the shared-database flake ROADMAP item 10 already carries (`zz_p22_hidden` is
  `exercises.routes`'s fixture).
- New tests: `packages/shared/test/orgWords.test.ts`, `apps/web/src/pages/console/orgWords.render.test.jsx`
  (a studio and a trainer console, each with the gym asserted beside it as the control), plus
  cases in the My Gyms, join-door, consoleView and staffView suites and two api route tests.
- Judgement calls for Kd: the console has no "Workouts" label to swap for "Sessions" — its tiles
  count VISITS by his own ruling, and the only "workout" words mean the member's own history, so
  that third of §2.2's vocabulary row has no site today. A member in a gym AND a studio sees the
  neutral "My organisations", because no type's word is true of that list.
- Kd clicked through on 2026-09-08 and passed it, skipping the steps whose ground was
  already covered by item 2a's smoke. PR #55, CI green on all five jobs.
- Review round 1 (fresh chat): six Lows, zero High, security pass clean. All six fixed — the
  console front door now says Coach; the member's archived refusal uses the member's word;
  the seat-cap and trainer-scope refusals follow the type; the attendance switch names what
  the member's app calls the place; `privilegeCopy` re-indented. The reviewer's seven test
  gaps are closed: every new `orgType` parameter now has a literal-string observer at a
  studio (unit suites), plus My Gyms rendered at a studio with scheduled hours and the
  membership card's three rows at a studio. Web 1876 passed; api orgs suites 267 passed.
- Kd waived the re-check (zero Critical/High, six Lows all fixed, CI green): *"no extra review
  needed"*. Merged to `master` 2026-09-08 (PR #55), branch deleted. Next: roadmap Stage 1 item 3a.

## 2026-09-08 · Organisation types (Stage 1 item 2a), merged as PR #53

- Built: `personal_trainer` joins `gym` and `studio` as a creatable type; migration `0024` widens
  `gyms_org_type_check` (clinic stays readable). The create screen is "Create your organisation"
  with three type cards and words that follow the type (a gym has members; a studio and a trainer
  have clients); `/console` sends a person who runs nothing straight to `/console/new`; a personal
  trainer's assistant (staff role `trainer`) gets the client list; a studio's trainer is told so in
  the studio's word; the migration test asserts the deployed CHECK equals `orgTypeSchema`.
- Verified: shared + api tsc, api eslint exit 0; `orgs.routes` + `db.migration` on local Postgres
  169 passed; web 1836 passed (pre-existing `poseAssets.contract.test.js` encoding failure remains).
- Kd clicked through all nine steps: passed. He ruled on trial abuse (RULINGS 2026-09-08); Stage 3
  item 2 split into 2a–2e. Review re-check found four Lows, fixed; CI green; merged, branch deleted.
  Next: roadmap Stage 1 item 2b (words by type on every other screen).

## 2026-09-07 · Sign-in by email code (Stage 1 item 1), branch `sign-in-by-email-code`

- Built: `POST /v1/auth/code/send` and `/verify` (codes HMAC-stored in new table `sign_in_codes`,
  migration 0023; ten-minute life, one resend after 60 s, two a day per address, five guesses,
  single use, address is the tenant); Resend transport with no SDK (`src/email/`); the dev sender
  prints the code in the API log when `RESEND_API_KEY` is unset; production refuses to boot without it.
- Web: one "Get started" screen at `/login` (doors "Train" / "Manage my gym, studio or clients",
  email → code → landing); `/register` and `/forgot-password` fold into it; Settings loses the
  password card and deletes the account with an emailed code (`POST /v1/users/me/delete-code`,
  then `DELETE /v1/users/me {code}`). Password routes stay on the server, switched off on screen.
- Kd amended his ruling mid-plan (RULINGS 2026-09-07): no password at all; one resend; two codes a day.
- Verified per package (the root `turbo` scripts cannot run on Kd's machine: turbo calls a global
  pnpm 11 that refuses the 9.15.4 pin — CI uses the pinned one): api/shared/config/engine tsc +
  eslint green; `auth.code.test.ts` 18 + unit 16 green on local Postgres; touched suites (users,
  orgs delete, auth, google, migration 0023) green; web 1824 green (`poseAssets.contract.test.js`
  fails on clean master too — pre-existing, local encoding); `tools/mutate-auth.mjs` 18 mutants, 17 RED + 1 alive by design
  (four survived the first sweep because a sibling check covered them; the tests were
  strengthened until each fell) — the table is in the PR.
- Review round 1 (Opus, fresh chat) found 4 High + 6 Low; all fixed in the second commit on the
  branch: too-soon keeps the live code on screen · per-IP send ceiling cut to 20/h and ONE
  ceiling across everyone (`CODE_EMAILS_PER_DAY`, default 5000) · the Day-14 purge deletes the
  address from `sign_in_codes` · the undo email is sent and its page `/restore-account` exists ·
  a per-address lock closes the day-cap race · `EMAIL_FROM` shape-checked at boot. Mutants now 18.
- Re-check closed all ten and found two the fixes had introduced, both fixed in the third commit:
  the daily ceiling now counts emails sent, not requests (checked in the preHandler, stepped
  after the send resolves) · Resend says "New code sent." only when one was. Each fix has a test
  that was run red on the old code first; A16 re-run RED against its new anchor.
- Re-checks on 2026-09-08 (three more commits, zero High at any point): a used code still holds the
  sixty-second gap; a too-soon refusal claims only the wait, never that a code was sent or is still
  valid; the too-soon header gives way to a timeless line when the countdown ends, and its words are
  built once with the gap read from `SIGN_IN_CODE_RULES` in `@app/shared`. Each header claim is
  pinned by a test that was run red against the old behaviour. CI green on a2881e6.
- Kd delegated work sizing to the chat; Stage 1 items 3–7 split into lettered one-chat lines in
  `ROADMAP.md` (RULINGS 2026-09-08). The next chat starts at item 2, then 3a.
- Merged to `master` 2026-09-08 on Kd's word (PR #51, CI green, branch deleted). Next: Stage 1 item 2.

## 2026-09-07 · The reset (Fable 5.1, this session)

- Kd ruled the project too slow and the record files "a novel"; gave the chat authority to
  restructure; features are never deleted. Decisions from the session are in `RULINGS.md`
  (bottom of each section, dated 2026-09-07) and the plan is `ROADMAP.md` Stage 1.
- Moved to `archive/`: the six record files, the card and plan files, review prompts, the 35
  smoke sheets, the three record-checking scripts, the old backends and the old root compose
  and env files. Git history is intact (renames). Nothing deleted.
- Rewrote `CLAUDE.md` (the rules), created `RULINGS.md`, `ROADMAP.md`, this file; root `lint`
  no longer runs the record-file guards.
- `master` now holds everything (fast-forwarded from `web-repoint`, CI green on the PR run);
  49 remote and 37 local merged branches deleted; `web-repoint` retired. Only `master` and
  the stale local `workout-calendar-parked` remain (its work was redone on the main line).
- Open: Stage 1 item 1 (sign-in by email code) starts in a fresh chat, on a new branch off
  `master`, with a ten-line plan to Kd first. Kd wants Fable at high effort for it.
- Not touched this session: any `src` file, any test, any migration, the database, the dev servers.
