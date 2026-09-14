# HANDOFF — the last thing each chat did (newest first, ten lines each)

Format: date · what was built or decided · what is verified (commands run) · what is open. Older
entries move to `archive/records/` when this file passes forty entries. The record before
2026-09-07 is `archive/records/HANDOFF-2026-07-06-to-2026-09-07.md`.

## 2026-09-14 · 7a-i built: the food list from named tables, every food's diet, branch `bigger-food-list`

- Next was 7a-i, not 5a as the entry below says: RULINGS 2026-09-12 puts the food list before goals. Kd said *"go"* to the plan (RULINGS 2026-09-14).
- 317 foods, 131 kept under their canonicals and 186 new (44 meat, fish and eggs); each cites USDA SR Legacy (238), USDA FNDDS (72) or UK CoFID (7);
  55 old foods' kcal per 100 g changed to their table's. Every food has `diet`; `DIET_LADDER`/`dietAllows` moved to `@app/shared`. Fibre may be null.
- Matching is by whole words. On master a search pick of peanut butter, almond butter, orange juice, apple juice, pineapple, sweet potato or butter
  chicken was priced as butter, orange, apple or potato (the new route test, red on master's list); the scan took "tea" for steak, "water" for tuna.
- 637 hints before and after: 536 the same, 56 now found, 34 now the right food, 2 now none ("hot", and "mango lassi", which was mango).
- `tools/check-food-sources.ts` (its own zip, CSV and XLSX readers): 317 foods, every number matches; a 1-kcal change and a wrong entry each reported, exit 1.
- Verified: api tsc 0 · eslint 0; shared tsc 0 · eslint 0 · 106/106; foods + nutrition + summary unit 57/57; nutrition routes 32/32; full local api
  1023/1026 (the 3 red are catalog.seed, 7/7 alone: ROADMAP 10's shared-database flake); 13 deliberate breaks each red (a 14th survived: a redundant lookup, removed), files restored byte for byte.
- The summary harness's M4 anchor had gone stale at 4b-ii (0 matches); re-anchored to the band ternary, and its mutant turns the band test red.
- Next: CI; Kd's click-through (local `kd.lowtarget@example.com`, Nutrition → Add food); the fresh-chat review; merge.

## 2026-09-14 · 4d merged (PR #70): the review's findings fixed (no Critical/High), no re-check on Kd's word

- Three Lows fixed: SignUpNote's header no longer says the console draws the note; the 4d entry below is ten lines; setup's test has its
  space back (`onboardingCompleted: false`).
- One weak test fixed: with the note's purpose check taken out of the profile read, every note test stayed green (no other note has v3
  words for the route to take). The test now puts the other two notes' rows at v3 straight into the log; that break, and "any note but the
  health step's", now fail it at the new line, the server file restored byte for byte after each.
- The review's phone-app note: the phone's sign-in must read the same `signUpDisclaimerAgreed` or it skips the note (added to Stage 5 item 2).
- Verified: api tsc 0 · eslint 0 · health + users routes 31/31; web eslint 0 on both files · setup and sign-up note tests 86/86; CI green on c9d131f.
- Kd ended the round without the re-check (RULINGS 2026-09-08): *"no re-check needed, merge when ci is green"*. Next: 5a, goals on the server.

## 2026-09-14 · 4d built: "Before you start", the sign-up note, branch `sign-up-note`, PR #70

- Kd picked a screen of its own straight after signing in (*"Own screen after sign-in (Recommended)"*), once per account. His click-through passed
  with one change: the note is the training side's, never the console's, and staff meet it when they come to train (RULINGS 2026-09-14, amended).
- Kd found v2's words read as "this app should not be followed" and wrote his own; with his go to three changes they are the sign-up wording's v3.
- Built: the profile's `signUpDisclaimerAgreed` (this person's tap, on the sign-up note, in today's words, read from the consent log);
  `ProtectedRoute` draws the note in place until then and fails closed on a profile it cannot read; the six console routes pass
  `requireSignUpNote={false}`. Setup's tick and its hook are shared (`DisclaimerTick`, `useDisclaimerTap`).
- Verified: CI green on 2226f3d; locally api 999/1013 (the 14 red all workouts.sync, ROADMAP 10), 22 breaks each red, headless Edge at 400 and 1000 px.
- Kd's click-through of the console change passed (*"all passed"*): `kd.staff@example.com` reached the console with no note, then met it
  through Train and ticked v3.

## 2026-09-14 · 4c-ii merged (PR #69): Kd's click-through passed; the review's findings fixed (no Critical/High)

- Kd's click-through passed on the local database (*"all test passed"*).
- Review, four Lows fixed: no healthy weight is named for an age or height the plan cannot take (Settings lets 13 be typed); the
  target is read on the row its wheel shows (one row under a weight it would read the same as) on screen 3, in the box and in the
  plan's answers; under 18 the words say "for your height and age"; `versionFor` is `formulaFor`, and ROADMAP 4c-ii is plain words.
- Three weak tests fixed: a weight exactly at the floor (no cut, no finish date of today), Settings in pounds, Settings' gender box.
- Verified: shared tsc 0 · eslint 0 · 104/104; api tsc 0 · eslint 0 · test:local plan + nutrition + onboarding routes 157/157; web
  eslint 0 on the touched files but Settings.jsx (its four, as on master) · the eleven files drawing setup or Settings 390/390;
  nine deliberate breaks, the review's three among them, each red, every file restored byte for byte.
- CI green on cd77a61, all five jobs. Kd waived the re-check (no Critical/High, RULINGS 2026-09-08): *"merge"*. Next: 4d, the sign-up tap.

## 2026-09-14 · 4c-ii built: a too-low target is said on "Your target" as it is picked, branch `too-low-target`

- Kd said *"go"* to the plan's three recommendations (RULINGS 2026-09-14): the number box keeps its line; the target stays pickable;
  16 and 17 are held to the teen healthy weight (Cole and colleagues, 2007, BMJ, Table 4), not the adult BMI 18.5.
- Built: the line under the target wheel, and in Settings' target box, from one shared rule the plan maths runs to and the contract
  checks the flag against; said only where the plan's kilograms are under it AND it reads under it as the screen shows it. ROADMAP 4c-ii.
- Found and fixed: in pounds the number box said "below 111.1 lb" of a 111.1 lb target (stored as 50.39 kg). Seen in headless Edge:
  the line was lost on the page's picture (now on a panel of its own), and Settings said nothing of a typed 50.35 (it read rows).
- Verified: shared tsc 0 · eslint 0 · 104/104; api tsc 0 · eslint 0 · test:local plan + nutrition + onboarding + health 176/176; web
  eslint 0 on the touched files but Settings.jsx (its four errors are on master too) · the eleven files drawing setup or Settings
  385/385 · full run before the last fix 2117/2117 in 75/76 (poseAssets.contract, the known local red); sixteen breaks each red.
- Next: CI; Kd's click-through (local: `kd.lowtarget@example.com`); the fresh-chat review; merge; then ask Kd if 4d is next.

## 2026-09-14 · 4c merged (PR #66); GitHub: cheaper checks (PR #67), the lock on master, Pro

- Kd's click-through of 4c passed on the local database (*"all test passed"*); the re-check of 11d99e1 was skipped on his word (no
  Critical/High); merged as faa41f7, branch deleted.
- Kd: "Your target is below the lowest healthy weight…" must be said on "Your target" as the weight is picked, not first at the end
  (RULINGS 2026-09-14): ROADMAP 4c-ii, next, before 4d; its plan asks him two lines (the number box keeps its line; the target stays pickable).
- Kd: a click-through tests only what its card changed, all steps in one list (RULINGS 2026-09-14); set the test account up beforehand on
  the local database, so his first step is the card's own screen.
- GitHub's 90 % minutes warning: 1,816 billed minutes 2026-09-01 to 14, 842 (46 %) on record-only pushes. Kd: stay private, no name scrub,
  GitHub Pro (3,000 minutes a month); the Actions budget stays at $0, so the checks pause if the minutes run out; $8 only when told.
- PR #67 (merged, 5969053): the `what changed` job skips the four code jobs for a records-only push, and the Neon migration job unless
  `apps/api/drizzle` changed; anything uncertain runs everything. Proven: the code push ran six jobs (16 min), the records push two (2 min).
- `master` is locked: pull requests only (a direct push is refused, admins included), six required checks, a skipped job counts as passed.
  CLAUDE.md §2 now says records ride on the feature's pull request.
- Next: plan 4c-ii with Kd (ten lines or fewer), then build it; after it, ask Kd if 4d is next.

## 2026-09-14 · 4c finished after its review, branch `plan-screen`, PR #66

- The plan's list is headed "Your answers" · "You told us a professional has cleared you. Follow their advice." · "Go to …" under Finish opens
  its screen as Adjust does, so it offers "Back to your plan" · posterCode's kept-code checks wait for the join page's effect.
- Screen 3's "Best if you also build muscle" shows only where another pace would cut more. The plan carries `dailyChangeKcalByPace` (the plan's
  own maths at each pace), so the calorie floor, a weight under the healthy floor and a target out of reach leave the mark off, as under 18 and a
  health yes do; before there is a plan, those two answers decide. The contract refuses a picked pace's figure that is not the plan's, or one under the floor.
- Verified on 11d99e1: shared tsc 0 · eslint 0 · 104/104; api tsc 0 · eslint 0 · test:local plan + onboarding + nutrition 153/153; web eslint 0
  on touched files · model + onboarding render + posterCode 153/153; six deliberate breaks each red; gitleaks clean; CI green, all five jobs.
- Next: Kd's click-through (local, `kd.pace@example.com`: 165 cm, 50 kg, target 45, then 60 kg); merge; ask Kd if 4d is next.

## 2026-09-13 · 4c: "Your plan", the last setup screen; Kd: tell them about building muscle, branch `plan-screen`, PR #66

- Built: after "Your code", the plan: the number, "Your workouts" (the week as asked; Safe mode's "not yet" words in its place; "Follow their
  advice" for a cleared yes), every answer with an Adjust, the plan's note and its tap. Finish is there and waits for both taps.
- Adjust's screen offers "Back to your plan" (the first open question, else the plan); Adjust is held during a finish. Seen in headless Edge
  at 1000/700/400 px: eleven step names ran together, so the step bar is wider, in even columns.
- Kd picked "Tell them" (RULINGS 2026-09-13): Build muscle and a cut eaten over 500 kcal a day raise `cut_limits_muscle_gain`, naming the
  gentle pace, which screen 3 marks. Calories unchanged. Murphy & Koehler's words were read on Europe PMC (PMID 34623696) before asking.
- Verified: shared tsc 0 · eslint 0 · 104/104; api tsc 0 · eslint 0 · test:local plan + onboarding + nutrition 132/132; web eslint 0 · three
  setup files 148/148 · full run on 4367dfe: 2101/2101 tests in 75/76 files (poseAssets.contract fails to load, the known local red); 14 breaks red; login-door anchors match.
- Found, on ROADMAP: 4d the sign-up disclaimer tap was never built; 5b the Nutrition rings never say why there is no cut. posterCode's "someone
  already set up lands on the join page" failed once under load, then passed twice. Next: CI, click-through, review, merge; ask Kd if 4d is next.

## 2026-09-13 · 4b-ii-b re-check fixed and merged (PR #65); Kd: setup asks nothing about running

- Re-check: no Critical/High. O11 re-aimed at `@app/shared`; a census found 13 more orgs-harness rows dead since 8c28c02
  and 0eff79a (it had not started on master either): all 14 re-aimed, its start-up check passes for 286, the 14 run 14/14 red.
- The shared and api tests read the source: the link's schema and the join lookup must call `normaliseJoinCode`; an exact
  inline copy turns only the new test red. shared tsc 0 · eslint 0 · 104/104; api tsc 0 · eslint 0 · orgs.unit 23/23.
- Kd's Finish click-through passed (*"all passed"*); CI green on 4631f35, all five jobs; merged 2026-09-13 (PR #65).
- Kd asked if typing the join link lets a hacker skip a step: no. Sign-in, a live code, rate limits and the gym's confirm
  are all on the server.
- Kd: setup must not be "never ending". It asks nothing about running now (RULINGS 2026-09-13): 4b-iii moved to 7b. His
  run-advice idea and "the chat part will be completely deleted" wait on 7b's and item 9's plans. Next: 4c.

## 2026-09-13 · 4b-ii-b review fixed (1 High, 5 Low, 3 weak tests), branch `poster-code`, PR #65

- High: Finish dropped a poster code never sent. Kd picked "Join page, code ready" (RULINGS 2026-09-13): Finish lands on
  the join page with the code in its box, still unsent; a code already sent finishes to the app as before.
- Lows: a link with no code now drops an older kept one · `normaliseJoinCode` in `@app/shared` is the one rule for the
  server's lookup and the web's link · two HANDOFF entries cut to ten lines · ROADMAP Stage 5 item 7 says a QR each.
- Harnesses: login-door D13 re-aimed at `useConsoleSignOut`, P1–P11 added: 28/28 red. join-door aborted at J1 because six
  multi-line anchors missed CRLF checkouts; it now follows line endings: 36/36 red. Restores byte-exact.
- Weak tests: posterCode checks its four copied routes against App.jsx; the Finish test flipped; the shared rule broken on purpose turns shared and api red.
- Verified: shared tsc 0 · eslint 0 · 103/103; api tsc 0 · eslint 0 · unit 22/22 · the typed-code join test on local
  Postgres; web eslint 0 · full 2089/2089 (poseAssets.contract fails to load, the known local red); gitleaks clean.
- Next: the fresh-chat re-check of these fixes; Kd's click-through of the Finish step; CI; merge; then 4b-iii.

## 2026-09-13 · The invite card, planned (Fable, plan only — no code); PR #65 still awaits its review

- Kd's click-through of 4b-ii-b passed (*"all passed"*). He asked what "Sign in to use your code EMH283" is and where the QR
  went: the line names a join link's kept code; no QR exists, and nothing in the app makes the join link today.
- He ruled the invite card (RULINGS 2026-09-13): downloaded and put up, never social media; a join QR and a QR each for the
  Android and iPhone app; the organisation's logo big (its name when it has none), the app's small.
- Then: built WITH the phone app (Stage 5 item 7). He REFUSED the chat's one-QR simplification: the app's QR stays, as big as
  the join QR, with the app's name. Stage 2 starts with the email invite (items 3 and 5): Kd agreed (*"i agree with you"*).
- CI run 34759344217 failed once in "drizzle migrations on Neon branch" with no migration changed on the branch; the next
  run passed all five jobs. If it recurs, look at Neon's `ci-<run_id>` branches first.
- Next: the review of PR #65 in a fresh chat; fixes; merge; then 4b-iii. The card waits for Stage 5.

## 2026-09-13 · 4b-ii-b: a poster's code survives sign-in and setup, "Your code" first (Kd), branch `poster-code`, PR #65

- Kd picked option 1 (RULINGS 2026-09-13): not set up → "Your code" moved to the front of setup, filled in, sent only by
  "Ask to join"; set up → the join page with it; the sign-in page says "Sign in to use your code …" (Train door only).
- Built, no server change: the code is kept in the tab like the door (`CarryJoinCode`; `rememberJoinCode` / `readJoinCode` /
  `forgetJoinCode`), and only a code the server could have made (`linkedJoinCodeSchema`, `@app/shared`).
- Verified: shared tsc 0 · eslint 0 · 102/102; api tsc 0; web eslint 0 on touched files · full 2080/2080 (poseAssets.contract
  fails to load, the known local red); 20 deliberate breaks, all red; gitleaks clean.
- The gym QR Kd asked about was never built; it became the invite card (the entry above).
- Local: API 3000 on the LOCAL Postgres, web 5173; live code EMH283 (Step 22b Gym 987027, trialing).
- CI green on PR #65; Kd's click-through passed (*"all passed"*). Next: a fresh-chat review, fixes, merge.

## 2026-09-13 · 4b-ii's last fixes: "In 3–4 hours", a reset cannot slip past a finish, tidier records, PR #64

- Kd picked "In 3–4 hours" for the yogurt idea's timing ("Later today" did not count from the workout; RULINGS
  2026-08-06, amended again). Changed in `summaryContent.ts`, both summary tests and ROADMAP 4b-ii.
- New test: a profile PUT that finishes setup while a reset holds the account is refused (409, health named),
  never finished with no health answer. Moving the "already finished" read outside the lock turns it red (200).
- HANDOFF's 2144cda entry cut to ten lines; the no-diet rule labelled the chat's choice; schema comment rewritten.
- Verified: api tsc 0 · eslint 0 · the four touched test files 93/93 · full local suite 999/999 · gitleaks clean.
- Kd's click-through passed (*"all passed merge"*); CI green on 04eab8e, all five jobs; merged 2026-09-13 (PR #64).
- Next: 4b-ii-b (a poster's code survives sign-in and setup). API 3000 on the LOCAL Postgres and web 5173 running.

## 2026-09-13 · The post-workout meal ideas in the market's words (4b-ii), branch `food-and-gym-code`, PR #64

- Commit ce4420e: the seven meal-idea lines on ROADMAP 4b-ii, in `summaryContent.ts` and its two tests — potatoes for
  rice, "Later today" for "1 hour before bed", chickpeas in the vegetarian and vegan salad. Bands, thresholds and
  diet swaps unchanged.
- Verified locally: shared tsc 0 · eslint 0; api tsc 0 · eslint 0; `test:local` on the two summary files 39/39;
  gitleaks on the staged files, no leaks.
- Open: CI on PR #64, Kd's fresh-chat re-check of 2144cda + ce4420e, merge; then 4b-ii-b.

## 2026-09-13 · The click-through of the fixes passed; the plan for Kd's next asks (Fable, planning only — no code)

- Kd's click-through of 2144cda passed (*"as for the tests all passed"*). CI is green on attempt 2 of run
  34738247155: attempt 1 sat queued for 2 h 25 min with no runner assigned (GitHub Actions "operational" on its
  status page); `gh run cancel` then `gh run rerun` fixed it — no code change.
- Kd plans with Fable 5.1 (max) and builds with Opus — *"don't start coding, you just need to make the plan so
  that Opus can follow"*. This chat wrote the plan into RULINGS, ROADMAP and here, and changed no code.
- He ruled the post-workout meal ideas' words (RULINGS 2026-08-06, amended again): no "1 hour before bed" on a
  post-workout card, and no rice-first food for a Western market. The seven lines, with their diet swaps, are on
  ROADMAP 4b-ii; Opus changes them on this branch before the re-check.
- He asked for options on the dashboard's Recommended box — Exercise · Food · Running — each showing its kind
  (RULINGS 2026-09-13): ROADMAP 7a-ii, built with 7a's engine; Exercise joins at 6b, Running at 7b. Two questions
  for him sit on that line (the design as read; whether the web shows the week's runs). Asked in chat, unanswered.
- Kd then asked whether the post-workout ideas repeat every day (today: yes — seven fixed lines; from 7a they vary,
  drawn from the food list) and said a non-vegetarian can eat veg too (RULINGS 2026-09-13: the diet is a ceiling,
  never a demand; 7a includes veg dishes for non-vegetarians). Variety waits for 7a — *"wait for 7a is fine"*.
- Local: API 3000 on the LOCAL Postgres and web 5173 running from this chat. Accounts: `kd.meals.0913@example.com`
  (finished, vegan, one 560 kcal workout, id `f45b13f5-2316-4fe9-a77c-26112c01bd3e`) and `kd.code.0913@example.com`
  (setup unfinished, a refused request to join `2LY3BZ`); the sign-in code prints in the API log.
- Next: an Opus chat on this branch — the wording change, checks, push, then it hands Kd the re-check prompt;
  a fresh chat re-checks 2144cda + that commit; merge; then 4b-ii-b, 4b-iii, 4c, 7a-i, 7a, 7a-ii, 7c.

## 2026-09-13 · 4b-ii: the finish gate on the profile PUT, meal ideas that follow the diet (2144cda), PR #64

- Meal ideas after a workout follow the diet (Kd, RULINGS 2026-08-06 amended): a vegan gets tofu and soy yogurt.
  No diet answer gets the ideas every diet can eat — the chat's choice, from RULINGS 2026-07-15, not Kd's ruling.
  The card carries the food-allergy caution, its words now `FOOD_ALLERGY_CAUTION` in `@app/shared`.
- The profile PUT no longer finishes setup with answers open: the PATCH's 409 and list, the users row locked
  first; a finish already stored is kept, so Settings saves still work.
- Screen 9's meals hint promises nothing; Settings offers "Not set" for meals only while none is stored; screen
  11's "Try again" goes to the code box. A poster link's code is split out as ROADMAP 4b-ii-b.
- Verified: api tsc/eslint 0, full local 981/998 (17 = item 10's `workouts.sync` flake, 23/23 alone); web full
  2046/2047 (poseAssets.contract, the known local red); 19 deliberate breaks, each red for its own reason.
- Open: CI, merge.

## 2026-09-12 · Screen 9 (food) and screen 11 (the gym code), item 4b-ii, branch `food-and-gym-code`

- Kd asked for two NEW things and ruled the order (RULINGS 2026-09-12): the food list grows to about 300 and is
  not vegetarian-first (the market is Western), and a person may build their own diet plan beside the app's —
  both before launch, after the setup screens. New roadmap lines 7a-i and 7c; nothing else re-ordered.
- He also asked what a meal scan does when the food is not in our list. Answered from the code: our table, then
  foods a search already pulled in, then Open Food Facts; no match means the item is dropped from the totals and
  named ("Couldn't identify: …"), or, if nothing matched, "we couldn't match it to our nutrition data" plus
  "Add an ingredient". It never invents a number (RULINGS 2026-08-24) — which is what 7a-i is for.
- Built: screen 9 asks the diet (four choices, Kd's order) and meals a day (2–6), saved as you go; screen 11 is
  the join door's own two components, the ones Settings' Gym tab draws. Migration `0030` adds both columns with
  their CHECKs and no backfill. Both food answers gate the finish beside `health`; the code never can.
- Finish moved to the LAST screen with them, so the disclaimer tap (screen 8) is named and reachable from there,
  and Back is now held while a finish is out — the step bar already was, and that gap was found by its own test.
- Verified: shared tsc/eslint 0, 94 · api tsc/eslint 0, CI-shaped 299, FULL local suite 989/989 (the
  `workouts.sync` flake passed this run too) · web 2041 (poseAssets.contract is the known local encoding red,
  confirmed untouched by this branch) · web lint's 4 in Settings.jsx are master's 4, checked line by line
  against HEAD's own file · gitleaks clean · six deliberate breaks, each turning a different new test red.
- Kd's click-through PASSED on 2026-09-13 (*"the testes passed"*), with copy changes he asked for on the way —
  the "What {gym} can see" sheet, now RULINGS 2026-09-13 and ROADMAP 8a, NOT built on this branch.
- Open: the fresh-chat review of PR #64 (CI is green on 9687895, all five jobs), then merge. 8a's plan must raise
  two things with Kd, both on its ROADMAP line.
- Local: API 3000 on the LOCAL Postgres and web 5173, both started this session (two stale servers from the
  2026-09-12 chat were killed first — the one on 3000 was answering with master's code). The click-through
  account is `kd.food.0912@example.com`, seeded through screens 1–8 so it lands on Food; the sign-in code
  prints in the API log. Live join code on the local database: `2LY3BZ` (Step 22b Gym 075154).
- Next: 4b-iii (running), then 4c, then 7a-i (the bigger food list), then 7c (your own diet plan). Worth Kd's
  word at some point: the diets are listed vegetarian-first, as his ruling names them; a Western audience may
  want Non-vegetarian first.

## 2026-09-12 · 4b-i's last round: three Lows and two weak tests, merged as PR #63

- No Critical/High in the last review, so this is the end of the round (RULINGS 2026-09-08). Kd: *"fix and merge"*.
- The health question takes no answer while a finish is out. A finish the server refuses over it forgets what the
  screen holds; an answer tapped in that window could be stored and then forgotten, leaving nothing chosen over an
  answer the server has. The buttons now wait for the finish, as they already waited for a health save.
- The note under the question promises no detail AT ALL, not "we never ask what the condition is" — the question
  also asks about medicine, an injury and pregnancy, so naming one of the four was narrower than the truth.
- The unanswered screening is ONE shared constant (`UNANSWERED_HEALTH_SCREENING`), parsed through the contract where
  it is defined and read by the server and both screens; the two hand-written copies are gone.
- Two tests that could not fail now can: the build's own `VITE_APP_VERSION` goes through the clip (the rule was
  tested, the wiring was not — a blank or over-long one 400s every disclaimer tap), and "above the fitness form"
  pins the whole form, not just its Save button (a card inside the form passed before).
- Verified: shared tsc/eslint 0, 91 · api tsc/eslint 0, CI-shaped 299, local db health + onboarding routes 58 ·
  web 2026 (poseAssets.contract the known local encoding red, red on master too) · eslint 0 on the five touched
  web files · gitleaks clean · five deliberate breaks red, one per fix, each restored.
- Kd's click-through of screen 8 passed on 2026-09-12 (*"smoke passed"*), so the roadmap line is ticked.
- Next: 4b-ii (screen 9, food, and screen 11, the gym code, applied first).

## 2026-09-12 · 4b-i's review fixed (two rounds), PR #63

- A finish the SERVER refuses over the health question now forgets the answer this screen was holding, so the
  question comes back with nothing chosen and the next tap really saves, and answering it clears the sentence.
  Before, a reset on another device left "answer the health question" standing over an answer shown as given.
- The note under it names BOTH stored facts and says what is never asked — "what the condition is", since the
  "it" three clauses back could be read as the clearance. Finish also waits for the health save to land.
- A blank `VITE_APP_VERSION` now falls back like an unset one, so a build that set it empty cannot 400 the tap.
- Verified: shared tsc/eslint 0, 90 · onboarding 53 · health + settings 14 · full web 2024 (poseAssets.contract the
  known local red) · lint 0 on the touched files · all six fixes red first · four tests strengthened — but two of
  those four still could not fail for what they claimed, which the next round found and fixed (entry above).

## 2026-09-12 · The health question (item 4b-i), branch `health-question`

- Kd ruled cuisine out entirely — not at sign-up, not in meal suggestions (RULINGS 2026-09-12). 4b split into 4b-i
  (health), 4b-ii (food + the gym code) and 4b-iii (running) in `ROADMAP.md`; this card is 4b-i.
- Built: screen 8 asks the ONE question with the medicine clause, "Check first" and the disclaimer tap (recorded on
  the 3b consent route); Settings' Fitness tab asks it with the SAME component and saves on the tap. Finishing is
  refused while it is unanswered (`missing: ["health"]`, its own shared enum — the PLAN's list never carries it).
- `0029` DROPS `user_fitness_profiles.medical_conditions` with everything typed in it; the notes box and its untrue
  "Helps the AI give safer advice" hint go with it; the profile PUT now refuses the field. Reset clears the health
  answer with the rest, in one transaction; the consent log is never touched. Disclaimers gain v2 (the comparison
  with the app goes, "follow their advice" stays). A yes saves nothing until "Check first" is answered.
- Verified: shared tsc/eslint 0, 89 · api tsc/eslint 0 · CI-shaped (no DATABASE_URL) 299 · local db.migration 27,
  users.onboarding + users.fitness 49, privacy/health/users 67, full local 979 + the 8 `workouts.sync` are item 10's
  shared-database flake (23/23 alone) · web 2011 (poseAssets.contract the known local red) · web lint's 4 in
  Settings.jsx are master's 4 · seven deliberate breaks each turned a new test red.
- Open: Kd's click-through, the fresh-chat review, CI, merge. Worth his word at the click-through: the disclaimer tap
  is asked once per visit to the wizard, so someone the rings send back to answer one question ticks it again.

## 2026-09-12 · 4a-iv merged (PR #62)

- The last re-check found no Critical/High and two Lows, both fixed: Reset's box now keeps "any yes or no you gave to
  the health question", so it cannot be read as keeping the medical notes it clears; a test comment rewrapped.
- Verified: api tsc 0 · api eslint on the migration test 0 · web reset test 4 of 4 · gitleaks clean · web lint's 4 in
  Settings.jsx are master's 4 at the same lines · PR #62 CI green on 1e89c47; merged, branch deleted.
- Open: 4b is next. The hint under Settings' notes box, "Helps the AI give safer advice", is untrue while the coach is
  off (RULINGS 2026-08-18); it goes with the box at 4b (noted on its line).

## 2026-09-12 · 4a-iv re-check fixed (one High in a fix, two weak tests), PR #62

- High: Reset's box promised "any health answer you gave" is kept, but the reset deletes Settings' Medical Conditions /
  Notes text with the row, and the web has never asked the yes/no health question. The box now says the notes are
  cleared and any answer to the health question is kept.
- Tests: the reset test saves notes as Settings does and checks the box is empty after; `0028`'s test adds a Flexibility
  person with an old Weight Loss tick (stays on "maintain", no cut).
- Verified: api tsc/eslint 0 · api touched files 64 · web reset file 4 · web lint's 4 are master's 4, same rules · two
  deliberate breaks (0028 reading the tick first; a reset keeping the notes) green on the old tests, red on the new.
- Open: CI, one re-check of these fixes (a High was open, CLAUDE.md §2.6), merge.

## 2026-09-12 · 4a-iv review fixed (no Critical/High; six Lows, three weak tests), PR #62

- Lows: screen 1's ruling says what Kd passed (the one line under the heading stays); Reset's confirm box names the
  health answer it keeps; `0028` keeps an old-form Weight Loss tick as "Lose weight" (a main goal still outranks it);
  Gain weight's protein note cites Iraki 2019 (1.6–2.2 g/kg in a surplus), Build muscle keeps Morton; two stale labels.
- Tests: screen 1 is one heading over its twelve tiles and nothing else; a health yes survives a reset and still holds
  the cut; a Fitness-tab save after a reset starts from the cleared answers.
- Verified: shared + api tsc/eslint 0 · api touched files 64 · web touched files 107 · web lint's 4 are master's 4 ·
  five deliberate breaks red (the three tests, the migration's old-form row, the gain note).
- Kd: a reset keeps the health answer until 4b (RULINGS 2026-07-20, amended). Open: CI, the re-check or its waiver, merge.

## 2026-09-11 · Many goals, and a gym (item 4a-iv), branch `many-goals-and-a-gym`

- Kd ruled: people who already chose Build muscle are asked their weight choice, never given one (RULINGS 2026-09-11).
  His click-through: screen 1 as one grid three to a row under "Your goal"; a ninth goal, Stay healthy; "A gym".
- Built: screen 1 asks the weight choice (lose · keep · gain) and any of nine goals; Build muscle sets protein to 2.2 g/kg
  (Morton 2018). `0028`: `weight_goal` replaces `main_goal`, goals and equipment CHECKed, "none" alone. Settings asks the
  same questions; Reset = `DELETE /v1/users/me/onboarding` (the name, weigh-ins and health answer stay).
- Verified: shared + api tsc/eslint 0 · api touched files and CI-shaped green, full local 963 + the shared-database flake ·
  web full 1998 (poseAssets.contract the known local red) · four deliberate breaks red.
- Local: API 3000 (local Postgres), web 5173; `kd.muscle.0911@example.com` is a Build-muscle person as 0028 left them.
  Kd's click-through passed (2026-09-11); PR #62. 4c carries a pace note for Kd; 6a defines Stay healthy (WHO).

## 2026-09-11 · 4a-iii merged (PR #61); Kd: building muscle is not gaining weight

- Kd's click-through passed (the test account ended on Weight Loss, target 68 kg, renamed; no server errors). Merged as
  de6814b, a merge commit like #60's; CI green on 55ceb9f; branch deleted.
- Kd: Muscle Gain is not weight gain, so choosing it must never ask a target weight (RULINGS 2026-09-11). That is what
  4a-iv's goal split builds (RULINGS 2026-09-10). Its roadmap line no longer assumes "build muscle → gain" for people who
  already chose it: the 4a-iv plan asks Kd keep or gain, with the science.
- The first sheet's steps 5–6 never showed: Kd fixed the target at step 4 (80 kg, above 73). Right behaviour; a step
  that is only for looking must say "don't change it yet".
- Local: API 3000 on local Postgres and web 5173 still running from this chat.
- Open: 4a-iv, plan first (ten lines to Kd), starting with where Build muscle's people land.

## 2026-09-11 · 4a-iii last re-check: no Critical/High; its three Lows and three weak tests fixed, PR #61

- Settings reads the goal the calories follow: the fitness-profile reply carries `mainGoal`; the Profile tab judges a
  target by it, not by the list's first weight goal, and the Fitness tab ticks it when an old list holds both.
- The rings' wrong-side card: "Time to set a new target weight. Pick one to see your daily calories and macros." (true
  for a reached target too); the link still says "Pick a new target". The entry below is cut to ten lines.
- Tests: the Settings rename takes the server's spelling, a refused rename changes nothing; a Settings save of both
  weight goals, from Flexibility and from the old form, keeps only the first.
- Verified: shared + api tsc/eslint clean · shared 83 · api route files 49 · web changed files 51; web lint's 4 are
  master's 4. Red on the old code: web 6. Deliberate breaks red: rename 2; server 4 (a save keeping both weight goals,
  the contract without `mainGoal`). Full suites left to CI.
- Open: CI, Kd's click-through (API 3000 local, web 5173, `kd.wheels.test`), merge; no review round left (§2.6).

## 2026-09-11 · 4a-iii re-check fixed (one High, four Lows), branch `rings-read-the-plan`, PR #61

- High: a name changed on "About you" reaches the sidebar and the greeting at once. The onboarding page passes on the
  name the server holds after every save that lands, not only at Finish; a Settings rename does the same, and Settings'
  header and Account tab show the name again (they read `fullName`, which the profile never had).
- Lows: the rings name a wrong-side target as its own case (`targetWrongSide`: "Your target weight no longer fits your
  goal" + "Pick a new target"); a Settings save keeps only the weight goal the calories follow; Settings' target box
  refuses a typed wrong-side target in screen 3's sentence (a stored one is named, the rest still saves); two comments.
- Verified: shared + api tsc/eslint clean · api unit 19, route files 68, full local 961 + two sign-in files red under load
  (alone 40/40), no-database 298 · web 1984 (poseAssets.contract the known local red; the onboarding page tests now wait
  3 s/15 s, the full run pushed two past the defaults) · lint adds nothing · new tests red on old code (api 9, web 11).
- Open: fresh-chat re-check of these fixes, Kd's click-through (API 3000 local, web 5173, `kd.wheels.test`), CI, merge.

## 2026-09-11 · 4a-iii review round 1 fixed, and Kd's goal ruling, branch `rings-read-the-plan`, PR #61

- Kd rejected my first H1 fix (the rings asked "your goal" again): a change takes effect at once (RULINGS 2026-09-11).
  A Settings save now moves the calories: a ticked weight goal sets them, else the main goal while ticked, else the
  first ticked; Weight Loss and Muscle Gain untick each other. Screen 1's goal goes first; only a goal that fights it leaves.
- A target on the wrong side of the weight makes the rings ask for the target, not show the held weight as the goal's number.
- L1–L3 fixed (name saved before "Back to the app"; Sign out beside it; "for a weight-loss goal"). Tests mount the page
  through ProtectedRoute; every new test red on the old code; deliberate breaks red (guard 5, failed save 1, chip 2).
- Verified: api tsc/eslint 0 · changed 86 · full local 978 + catalog.seed's known race (alone 7/7) · no-database 298 ·
  web 1970 (poseAssets.contract the known local red); Settings.jsx's 4 lint errors predate this.
- Open: fresh-chat re-check, Kd's click-through (API 3000 local, web 5173, `kd.oldform.0911`), CI, merge. Reset keeping
  the v2 answers is on 4a-iv.

## 2026-09-11 · One daily-calories number: the rings read the plan (item 4a-iii), branch `rings-read-the-plan`

- Kd rejected the protein question as first framed (cap at 35 % or keep) and asked for the science. Researched
  (ISSN 2017, ACSM/AND/DC 2016, Longland 2016, Devries 2018, Weijs 2025): grams per kilo, never a share of the calories;
  a body over BMI 30 is counted at its BMI-30 weight (120 kg at 175 cm: 184 g, not 240). RULINGS 2026-09-11.
- Built: `/v1/nutrition/targets` reshapes the plan from `users/service getUserPlan`, the function the onboarding routes
  use (old −400/+300 calculator retired). Empty rings name the open questions; "Answer now" → onboarding's first open
  screen → back to Nutrition; a finished person there gets "Back to the app", not "Sign out". The protein working
  carries `referenceBmi`; "How is this worked out?" names each goal's source. The `fitness_goals` mirror stays (Settings).
- Verified: shared tsc/eslint 0, 83 · api tsc/eslint 0, unit 74, local routes 84, CI-shaped 297, full local 951 + the two
  known flakes (pass alone, 30) · web 1963 (poseAssets.contract the known local red). New tests red on the old src; 13 of
  13 deliberate breaks red. Local: API 3000 on local Postgres, web 5173; `kd.oldform.0911@example.com` is the old-form
  person (120 kg, 175 cm, missing goal + "your day"); the sign-in code prints in the API log.
- Open: Kd's click-through, the fresh-chat review, CI, merge. Then 4a-iv (its line now carries the Settings-goal gap).

## 2026-09-11 · Screens 1–7: the re-check's four Lows (item 4a-ii), branch `onboarding-screens-1-7`, PR #60

- The fresh-chat re-check of round 1 found no Critical/High and four Lows; all four are fixed here. No third review (§2.6).
- Wheels: a slow drag that rests and goes on saves where the finger lifts, not where it rested (a gesture never settles
  while a finger is down; a touch that is cancelled ends it too).
- Plan check: besides each line's own sum, every figure the plan panel prints twice must agree — the weight, the formula's
  constant, the pace's kg a week, kcal per kilo, kg to move, and the two floors the flags name. The Mifflin-St Jeor
  constants and the kg-between sum moved to `@app/shared`, so the calculator and the check share them.
- Tests: the gesture test is split (a press let go, a mouse wheel, a finger lifting, a touch or a press the browser
  cancels), plus Tab away and the slow drag; two contract tests. Each of the 8 wheel handlers and 9 new checks, removed
  in turn by hand, turns a test red (17 of 17); files restored.
- Verified: shared tsc/eslint 0, 83 · api tsc/eslint 0, plan.unit 53, CI-shaped 306, local onboarding routes 34 · web
  eslint 0 (touched files), onboarding 68, full 1954 (poseAssets.contract is the known local encoding red).
- Kd's click-through of the wheels passed, the scroll fix's cost included (on a phone a wheel is tapped before it is
  flicked; kept, RULINGS 2026-09-11). All five CI jobs green on 697995f; merged 2026-09-11 as PR #60, branch deleted.
- Next: 4a-iii, which opens by asking Kd the protein question in its ROADMAP line. Then 4a-iv → 4b.

## 2026-09-11 · Screens 1–7: Kd's second look and review round 1 (item 4a-ii), branch `onboarding-screens-1-7`, PR #60

- Built Kd's second look (RULINGS 2026-09-10/11): flick wheels with − and +, the name first, plain push-up and plank
  questions, "How is this worked out?", two drawn icons, a target wheel that offers only the goal's side.
- Review round 1: 3 High, 6 Low, all fixed. Re-picking the rows on show saves nothing (rows, not kg: 70 kg reads 154.3 lb
  = 69.99 kg); a wheel turns only once tapped or focused, so scrolling the page never sets an answer; the target shows on a
  row it offers in either unit; the contract checks the working's products as well as its sums.
- CORRECTED: Kd was told the macros sit inside the IOM ranges. They don't: the golden loss plan is 44.2 % protein and
  30.9 % carbs (IOM 10–35 % and 45–65 %). He has been told; the choice is the first question of 4a-iii (ROADMAP).
- Verified: shared 83 · api plan.unit 52, CI-shaped 305, local onboarding routes 34 · web 1948 · tsc/eslint 0 · burn within
  2 kcal of 3a's. Headless Edge, mouse and touch: the old wheel saved age 35 under a page scroll; the new one scrolls the page.
- Open: the fresh-chat re-check of the fixes, Kd's click-through of the wheels, CI, merge. Then 4a-iii → 4a-iv → 4b.

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
