# DECISIONS-INDEX.md — the map of DECISIONS.md

**Read this file in full. Then open only the DECISIONS.md entries your task
touches.** That is the grounding requirement now (CLAUDE.md, amended
2026-07-30). Reading all of DECISIONS.md is no longer possible in one session:
it is 2,396 lines / ~135k tokens, so a chat that read it would have no room left
to work. This index exists for the same reason `OWED.md` does — DECISIONS.md
could not answer "what is still to do?", so OWED.md was created; it can no
longer answer "what has already been decided?", so this was.

**Nothing in DECISIONS.md is deleted, moved or rewritten.** It stays the
append-only record and remains the authority. This file only points at it. If
the two ever disagree, **DECISIONS.md wins** and this index is the thing to fix.

**How the lines below were written.** Each is derived from the entry's own
heading plus, for the entries a chat has read in full, its content. An index
line is a POINTER, not a substitute — never cite this file as the source of a
ruling. Quote the DECISIONS.md line (V2).

**Maintenance.** Every commit that adds a `##` heading to DECISIONS.md adds its
line here, in the same commit. Line numbers drift when entries are inserted
mid-file: re-derive them with
`grep -n "^## " DECISIONS.md` rather than trusting stale numbers.

---

## 1 · STANDING RULES — these constrain future work. Always relevant.

- **DECISIONS.md:270** — 2026-07-14 — argon2id rehash-on-login: the P2.1 GAP-1
  deferral, **owed before P2.8**.
- **:344** — 2026-07-16 — Vision model swap + format-tolerant parsing (Kd chose
  option 1).
- **:414** — 2026-07-18 — Card 5c API curd/dahi row: **Kd chose the veto
  option**.
- **:456** — 2026-07-19 — Desktop webcam capture for meal photos: **WON'T
  BUILD**. A struck item, not a deferral — do not propose it again.
- **:618** — 2026-07-21 — timezone capture. Every user has been bucketed as UTC
  since 2026-07-11; day boundaries and streaks are wrong outside London. Still
  owed; any date/day work must read this first.
- **:1020** — 2026-07-24 — Gamification: **XP storage KEEP**, and the
  **leaderboard dark window** is a SCHEDULED state until P4.x, not a bug.
- **:1110** — 2026-07-26 — the hardcoded 100-XP-per-level curve must NEVER be
  copied into a client. The server sends `xpInLevel`/`xpForNext`/`progressPct`;
  clients render, never compute. (`xp.level + 1` survives as a label only.)
- **:2365** — 2026-07-29 — **THE STOPPING RULE** (per-card, XP display): a
  finding blocks a 🔴 tick only if a user could see it on screen. Everything
  else is fixed but holds nothing. Precedent: PostWorkout, :1678.
- **:2692** — 2026-07-30 — **THE CAP** (per-card, PostWorkout summary reader):
  round 3 is the last review round, ruled BEFORE it ran. Zero VISIBLE ⇒ the card
  closes and ticks; a VISIBLE finding is fixed and the card closes ON that fix.
  Round 3 exists for ONE reason — round 2 fixed the mutation harness and that fix
  is unaudited, so every "21 RED" figure rests on it.
- **:2158** — 2026-07-29 — **THE CAP** (per-card, XP display): round 11 was the
  last review round; no round 12. Includes the recorded lesson that **eleven
  rounds was a fault of the CARD's scope, not the code** — a repoint touching
  more than one screen's payload is more than one card.
- **:2398** — 2026-07-30 — **this file's READ PATH is split** and this index is
  the instrument: grounding = this index IN FULL + §1/§2 read in the DECISIONS.md
  ORIGINAL + the entries the task touches (CLAUDE.md:51-89). Coverage
  command-verified the same day: 97 headings, 72 cited by exact line, 25 inside
  declared ranges, **none unmapped**. The index is a POINTER — cite DECISIONS.md,
  never this file.

Standing rules that live in CLAUDE.md, not here — the no-removal rule, the
deferral rule (every deferral gets an OWED.md line in the same commit), the
grounding rule, Part I.5 verification doctrine, Part I.6 session start.

- **:2866** — 2026-08-01 — **Kd RULING: finish the CODE first, buy the server
  later.** P2.8 splits into a CODE half (every screen off the old backend,
  verifiable locally — proceeds now) and a DEPLOY half (VPS, secrets, backup
  drill, the DPDP worker actually running — deferred to the deployment moment).
  Carries the agreed card ORDER for the rest of the repoint, and a **standing
  two-round review cap set BEFORE each card runs** rather than after a bad
  fact-pattern. **The DPDP Day-14 worker must be live before the first real
  SIGNUP, not merely before the first deploy.**
- **:2825** — 2026-07-31 — two false claims about CI and the branch strategy,
  corrected. **`web-repoint` is a Kd-RULED long-lived branch (:280) that merges at
  the P2.8 cutover — it is not an oversight, do not propose merging it early.** PR
  #29 has been open on it since Card 1, so CI has gated every push all along.
  **Standing lesson: an index entry you skipped is not evidence of absence** — the
  ruling was at an entry the index named and the chat chose not to open.

## 2 · OPEN — awaiting Kd. Check before proposing anything nearby.

- **:78** — Pending SPEC GAPs raised and not yet ruled on. **Read this section
  every session**; it is the only forward-looking part of the file.
- **:592** — 2026-07-21 — OPEN QUESTION: privacy-law scope is wider than DPDP.

## 3 · PHASE 2 — migration and backend (P2.x)

- **:158** — P2.6a Nutrition and body rulings (07-12)
- **:181** — P2.6b Geo/running READ-plan side rulings (07-13)
- **:192, :201** — P2.7 Mongo→PG migration rulings; clean-start + full migration
- **:207, :214** — P2.7b harness + users stage (approach B); its T3 fixes
- **:223** — P2.7c workouts + sets + gamification recompute
- **:233, :242** — P2.7d meals + body_measurements; T3 clean
- **:246, :254** — P2.7e coach + running; T3 clean
- **:259, :265** — P2.7f verify gates + prod runbook; T3
- **:918** — CI runs the database-backed api suites (branch `ci-db-tests`, PR #47)
- **:1026** — Deploy infrastructure: Dockerfile + compose + where the worker runs

## 4 · WEB REPOINT CARDS — all on branch `web-repoint`

- **:278** — Card 1 auth → httpOnly-cookie on the new /v1 API (07-15)
- **:287** — Card 2 per-user storage keying + displayName migration (07-15)
- **:299** — Card 3 progress + measurements (07-16)
- **:308** — Card 4 coach (07-16)
- **:323** — onboarding-storage: fitness-profile on the new API (07-15)
- **:356** — Card 5a nutrition photo→confirm + client rewrite (07-16)
- **:372** — Card 5b manual entry + meal-type wiring (07-17)
- **:384, :399, :406, :414** — Card 5c meal composition + synonyms; web + API T3s
- **:418, :429** — Card 5c2 dishware portions ("measure with my dish"), API + web
- **:443** — Card 5d previous-days meal view (07-19)
- **:464** — Card 6 onboarding wizard → new API + gate restore (07-19)
- **:479** — Card 7 Settings profile forms → new API (07-20)
- **:493–:538** — Nutrition targets API: Mifflin-St Jeor port + T3 rounds 1–6
- **:545, :572** — Nutrition targets WEB half (the ":545 read this first" block)
- **:598** — Progress plan-limit notice (07-21)
- **:640–:730** — Coach chat retry protection: Idempotency-Key + short-window
  cap, T3 rounds 1–5. **Standing lesson at :724 — five rounds all found the
  same-shaped defect; enumerate every path carrying a guarantee.**
- **:731, :741** — Groq COACH_MODEL migration → `openai/gpt-oss-20b`
- **:747, :754** — Coach markdown tables; "Try again" + honest 429 copy
- **:4483** — 2026-08-04 — **date-window T3 round 1: 4 findings, none visible,
  all resolved. READ BEFORE USING `z.string().datetime({ offset: true })`
  ANYWHERE.** It accepts a UTC offset with an hour component above 23
  (`+25:30`), and `Date` rejects exactly those — so the schema proved a SHAPE
  while the code assumed an INSTANT, and the request 500'd at the SQL layer
  where it had promised a 400. Fixed at the parse boundary as
  `instantSchema` (`packages/shared/src/time.ts`). **A grep for the OPTION
  rather than the symptom found the second site — `workoutSyncPayloadSchema.
  startedAt` had carried the same hole all along** — and proved the plain
  `.datetime()` form is sound (zod rejects Feb 30; `Date.parse` would not).
  The test gap is the lesson: the both-bounds case was already a 400 for an
  UNRELATED reason, so the hole looked covered. F4 ruled the other way from the
  reviewer's first option: `limitedToDays` keeps its meaning because
  2026-07-11 fixes `null = unlimited`; the COMMENT was what was false.
  21/21 + 16/16 + 43/43, fix mutation-checked. **Round 2 is the cap.**
- **:4434** — 2026-08-04 — **`/v1/workouts` gains a DATE WINDOW (`from`/`to`) —
  the API half of the blank-old-months fix.** **Read before adding any date
  filter, and before touching `listMealsForDay`.** Half-open (`from` inclusive,
  `to` exclusive) so adjacent months TILE, and ABSOLUTE INSTANTS not calendar
  dates — a month is local to the VIEWER, so the caller converts its own
  boundaries and no timezone decision moves to the server. The window NARROWS
  only: `since = clamp(from, gate.floor)` reuses the Part 4 §0.2 helper, so a
  query parameter can never out-rank a plan (R3.1). An inverted window is a 400,
  because zero rows on a history screen reads as "you never trained". **Not a
  reversal of Card 5d — it is the "documented upgrade path if history runs
  deeper" that ruling named, and the same question is now owed of the meal
  reader.** No migration; the index already serves it. 19/19 + 41/41, both new
  guarantees mutation-checked. **The WEB half is card 2 and still owed.**
- **:4355** — 2026-08-04 — **calendar T3 ROUND 2 (THE CAP) — CARD CLOSED.** 6
  findings, 1 user-visible, all fixed. **Read before writing a render test for a
  screen with more than two states.** F2 (visible): the bold day count was
  printed on any successful read, so a TRUNCATED month showed "0 active days
  this month" directly beneath its own caption saying the month may be
  incomplete — the defect this card was built to remove, one degree quieter.
  F4: that caption was false by construction ("this month has more workouts than
  this view reads back through" — the rows it gave up on are NEWER months'),
  round 1's F1 one caption over. **F1/F3/F5 were three states with NO render
  assertion at all** — truncation, the clamp's straddling arm, the "+N more"
  chip — each measured to survive with all 62 tests green; F5 is the
  fixture-uniformity blind spot for the THIRD time on this card. F6 corrected a
  wrong REASON attached to right behaviour. **Round 1's two fixes were audited
  and both hold** (the bite-check repair reproduces; the TZ pin reaches the
  worker under a forced `TZ=UTC`), with one residual reported not fixed: the pin
  test asserts only a non-zero offset, so a DST zone would pass. 426/426, 29/29
  mutants RED, M16 re-anchored. **Carries a same-day CORRECTION by Kd that
  outlives the card:** this chat called the truncated state "unreachable"; 1,000
  workouts is five years at four sessions a week, and underneath it an old month
  comes back EMPTY, which these fixes stop lying about but do not repair. New 🔴
  OWED line — `/v1/workouts` needs a date filter. **"The operator's account
  cannot reach it" is a fact about a smoke test, never about users.**
- **:4267** — 2026-08-04 — **calendar T3 ROUND 1: 6 findings, 1 VISIBLE, all
  fixed — and the mutation harness's own bite-check was BLIND.**
  **Read before trusting any "N mutants, 0 alive" table produced on Windows.**
  The harness claims in its header that every sed is proven to have bitten
  (md5 must change). FALSE: files are CRLF, `sed -i` rewrites them to LF, so
  the md5 moves on a sed matching NOTHING — measured directly. INVALID could
  never fire, so a mutation whose anchor had DRIFTED was reported as a missing
  test. Same class as :3720. Now compares content (`tr -d ''`); restore
  verification stays byte-exact.
  **F1 (VISIBLE) is the duration defect's twin**: the walk pages backwards from
  today, so an unreadable row from a NEWER month was counted and printed as
  "1 workout couldn't be read" over a month that read perfectly — and every
  fixture put its unreadable rows INSIDE the viewed month.
  **F2 (blocking) — measured both ways: the day-bucketing guard was INERT IN
  CI.** With the UTC-day defect live, 57/57 GREEN under TZ=UTC and 1 RED under
  Asia/Kolkata; runners are UTC. Unfixable in test data (under UTC the two
  implementations are identical by definition), so the zone is pinned in
  `apps/web/vitest.config.js` and a test asserts the pin survives. `turbo.json`
  listed `vitest.config.ts` for a `.js` file, so the pin would not have busted
  the cache — widened, out-of-diff but load-bearing for F2.
  Two untracked deferrals got OWED lines: calorie BANDING (spec §2.3 requires a
  ±20% range, verified in the spec here, tracked nowhere before) and the
  reader's stand-in for `safeParse` catching renamed fields but NOT changed
  UNITS — which is precisely what the duration bug was.
  422/422, 25/25 mutants RED. **Round 2 is the cap.**
- **:4239** — 2026-08-04 — **calendar SMOKE PASSED, all 8 steps, on `5133114`.**
  Steps 1-4 were RE-RUN on the fixed bytes rather than carried over — the numbers
  Kd had judged were the ones that changed (XP-card precedent). Steps 5-8 had
  never run before and all pass, step 8 being the hand-counted case written the
  same morning. **Records the RESOLUTION of the report rather than inflating it**:
  three "all passed" replies against numbered expectations, plus an explicitly
  re-sought duration confirmation, plus screenshot + database cross-checks.
  **Only the fresh-chat T3 remains before the OWED line ticks.**
- **:4182** — 2026-08-04 — **calendar SMOKE ROUND 1 FAILED: every duration on
  screen was false.** Real `duration_ms` 8491/4767/36290/37681 displayed as
  `0m`/`0m`/`1m`/`1m` — two workouts shown as taking no time, two rounded UP
  past a minute they never reached. **Read before repointing any field whose
  UNIT changes between backends**: the old payload carried whole MINUTES, so
  `Math.round(ms/60000)` was the honest translation of the field it replaced,
  and its own comment defended it as "a display transform on a REAL value" —
  which made a wrong transform look considered. **Every fixture in the suite
  used 1_800_000 ms, including the five hand-counted tests added the same
  morning, so no test could be wrong in a different direction from its
  fixture.** Fixed by carrying whole SECONDS and exporting `secondsLabel`
  rather than re-spelling it (the `UNKNOWN` precedent); whole seconds is
  load-bearing because that helper carries to "1m 60s" on fractional input.
  R9.5 observed — the four assertions were shown RED first. M23 restores the
  rounding. 417/417, 23/23 mutants RED. Steps 1-4 otherwise PASSED, including
  the mixed camera+hand workout as one session.
- **:4119** — 2026-08-04 — **the workout calendar is UNPARKED and on
  `web-repoint`.** :2912's single blocking reason (the new API held only 3
  exercises' workouts) was discharged by the catalog (:3538) and the write path
  (:3610), not by anything re-decided here. Files copied BY PATH, never by
  merging the parked branch, whose commit subject says "do not merge"; 0
  conflicts and disjoint file sets verified first. **Read before touching any
  workout-history fixture: the whole parked suite predates hand-counted
  workouts by one day**, so its shape — real duration, real kcal, NO form score
  — had no coverage at all; five render tests and mutations M19–M22 were added,
  M20/M21 deliberately as a PAIR because either alone is satisfiable by a
  constant. A "not browser-reachable" claim in the smoke doc is corrected in the
  same commit: it went stale the day the write path shipped. 413/413, 22/22
  mutants RED. **NOT ticked — smoke and T3 are both unrun**, two-round cap set
  up front.
- **:4081** — 2026-08-04 — **rep-choice card SMOKE PASSED (steps 1–5, 7, all
  DB-verified) — the card's gate is discharged. Kd RULING: steps 6 and 8
  (mid-set camera-failure drills) SKIPPED; the handover code and its tests
  stay.** Also: the identical summary-screen numbers are the mock rig's canned
  payload, not app breakage.
- **:4023** — 2026-08-03 — **rep-choice card, T3 ROUND 4: three 🔴 findings, and
  a claim the chat made that was FALSE.** **Read before offering Kd any
  substitute for a smoke test, and before trusting a mutation figure.**
  (1) Backgrounding the tab mutes the camera track → an error → the sticky
  handover stamped it permanently → set filed unscored on a camera that was fine.
  **That is the same user action failing in three consecutive rounds by three
  different routes** (stall poll, mute-latch, error-stamp); each fix guarded one
  path and the next round found the next. (2) The redo carry-forward never
  checked whether the camera had actually recovered — its own comment claimed the
  justification. (3) `reconcileSets` splices a summary out of the payload but left
  its rep scores in the list the form average is built from, so the summary
  screen showed a score for a workout stored as ungraded — while
  `accumulateSummary` already rebuilt that list for the identical hazard.
  **THE FALSE CLAIM:** the chat offered to drive a real browser in place of the
  smoke Kd could not run, and said it was starting. `playwright` is not installed
  and is not a dependency; `npx playwright --version` printed a version from a
  global cache and that was taken as proof. A command that prints something is
  not the same as the command that answers the question.
  Also fixed here: `.codex-chrome-profile/` (live session cookies) was untracked
  and un-gitignored; and rounds 3 AND 4 were recorded nowhere while OWED already
  cited "round 3".
- **:3987** — 2026-08-03 — **rep-choice card, T3 ROUND 3: two 🔴 findings, both
  round 2's bug at a new trigger.** **Read before touching anything that decides
  who counted a set.** (1) A graded exercise FOLLOWING an ungraded one lost its
  form score: `analysisSettled` was a bare "has it ever answered", which never
  goes back to false, while `analysisAvailable` is per-exercise state — so every
  exercise CHANGE re-presented the round-2 state. The hook now reports which
  exercise its answer is about. **Every test used ONE exercise**, so the class was
  structurally invisible. (2) Round 2's own F3 fix created a defect: a clearable
  camera error meant the live term and the write-once ownership disagreed on
  recovery, so the rep button vanished mid-set and the set was filed as the
  user's anyway. Three fixtures returned module globals where production returns
  state written from an effect; two of them were where these findings hid.
- **:3917** — 2026-08-03 — **rep-choice card, T3 ROUND 2 (THE CAP): four 🔴
  findings, and a CORRECTION to :3819.** **Read before trusting any "N mutants,
  0 alive" figure in this repo.** (1) **The first set of EVERY camera workout was
  filed as the user's own count, form score discarded** — `analysisAvailable` is
  false for one render on every camera workout ("not known yet"), the page read
  it as "no definition", and ownership is never taken back. Sets 2..N were fine,
  which is why it read as working. **The mutant written to catch exactly this
  outcome was RED**: its test used a mock that returned the value synchronously,
  so the fixture could not reach the state the bug lives in. Round 1's F4 in a
  new shape. The hook now reports `analysisSettled` — "has this hook answered?" —
  which is a different question from "is anything available". (2) A hidden tab
  was treated as a dead camera (the poll reads the wall clock; `hidden` was
  missing from the pause/rest guards). (3) A temporary camera `mute` latched for
  the whole workout — nothing listened for `unmute` and `error` is cleared only
  inside `startCamera`. (4) Redoing a stalled set re-keyed and silently cleared
  the handover. **:3819's claim that stored ownership keeps ordinary camera sets'
  form scores was written before it was true** — corrected there.
  **Smoke step 5, the CONTROL, cannot be carried forward from round 1**: on that
  code it would have stored a `log_only` first set. Re-run 5 and 6 together.
- **:3819** — 2026-08-03 — **rep-choice card, T3 ROUND 1: two 🔴 findings, plus a
  Kd RULING that replaced the chat's own proposed fix.** **Read before touching
  anything that decides who counted a set.** (1) A camera that DIED mid-set never
  offered hand counting: the stall test asked `poseData == null`, true only before
  a set's FIRST frame, and `useCamera` had no `ended`/`mute` listener — so smoke
  step 6 was unreachable by the route it described. Now a GAP between frames,
  plus real track listeners. (2) The engine could overwrite a hand count with a
  smaller one or ZERO (`endSet()` returns a summary after one fed frame): screen
  said 7, history said 2. **Kd RULED the mode does not flip mid-set in either
  direction**; the chat's "bigger count wins" was dropped as worse, because it
  makes the stored number depend on arithmetic the user cannot see. The automatic
  handover when the camera DIES is expressly excluded from the ruling. The
  mid-workout-switching OWED line is STRUCK, not deferred.
  **Three standing lessons: a database query taken moments after a workout is NOT
  a test of whether it saved** — the queue flushes at next app load, and 35
  minutes went into a confident wrong "this is a real bug" built on three empty
  queries; **never run the mutation harness while a smoke is in progress** — it
  sabotages the live dev server the operator is testing against; and **the first
  fix drafted for F2 would have stripped the form score off every camera set**,
  because a hand record's `reps` is what the SCREEN showed, which in camera mode
  is the engine's own count. Ownership is stored, never inferred.
- **:3720** — 2026-08-03 — **Kd RULING: counting your own reps is a CHOICE, not
  only a fallback** — and it EXTENDS the spec rather than implementing it
  (`06-part6-mobile.md:188` describes log-only as automatic weak-device
  degradation only; Kd was told so before approving). **Read before touching the
  pre-workout screen or the set-capture path.** It fixes two defects: the Start
  button was gated on a camera checklist item that ticks ITSELF, so **no camera
  meant no workout at all, on all 58 exercises**; and F-3, a camera-graded set
  saved NOWHERE, which the suite had asserted as CORRECT behaviour. **The
  ownership of a set cannot be decided at set end** — the engine's summary is
  emitted from an effect CLEANUP, after the page's synchronous capture — so
  every set's hand count is recorded unconditionally and `reconcileSets` settles
  it once at workout end (engine wins, else the user's count, never both).
  **Three standing lessons: a comment recording WHY an assumption holds is what
  makes it visible when it stops holding** (`crypto.randomUUID` relied on the
  camera's secure context); **an adversarial mock finds what review does not**
  (the page read the pose stream in manual mode); **and a mutation harness that
  an editing accident can disarm reports a shorter table, not a failure** — a
  `sed -i` flipped one file's line endings and nine mutants stopped applying at
  once. 26 mutants / 3 files, all RED. **SMOKE NOT YET RUN — not "done".**
- **:3610** — 2026-08-02 — **THE WEB WRITE PATH — DONE, card closed under the
  two-round cap.** A hand-counted workout now reaches the new API; the OWED entry
  is ticked and the two things it was holding were lifted into their OWN lines
  (the legacy dual-write removal, and F-3 below). `completeSession` STAYS —
  both backends are written. Kd's SMOKE passed and was verified IN THE DATABASE.
  **Read before touching this area: the recorded 0-rep trap has a WORSE variant
  underneath it** — an effect-mirrored ref lags one tick and records every set
  ONE REP SHORT, which looks right on screen. **Two standing lessons: a test
  whose inputs and its subject share a source proves only that the source is
  self-consistent** (the "all 58" test was a list checked against itself, and was
  cited as proof in shipped code); **and a wrong comment can re-arm a fixed bug**
  (a comment named the wrong capture call as load-bearing, inviting deletion of
  the one round 1 had just protected). **F-3, still open: a camera-graded set can
  land NOWHERE when zero frames were fed, and this card turns that from "no row"
  into a MIXED workout synced with sets missing.** 13 mutants / 2 files all RED;
  harness at `apps/web/tools/mutate-write-path.mjs`.
- **:3538** — 2026-08-01 — **THE 58-EXERCISE CATALOG IS SEEDED** (3 → 58 rows,
  verified against the live DB). The reviewed table is `CATALOG_58` in
  `packages/shared/src/exerciseCatalog.ts` (artifact: `docs/catalog-58.md`, Kd
  signed off before any code). Slug rule = the Part 2 §6 name normalised, which
  reproduces all 11 slugs the migration's frozen table expects. **Two SPEC GAPS
  ruled by Kd, both F11** (`brisk_walking` had no family; `arm_circles` had two).
  `slugForLegacyName` is exact-match and returns null rather than guessing.
  **Read before writing any mutation harness here: this entry records BOTH
  recorded harness failures incurred in one run** — a `cd` broke the restore path
  so a mutant stayed live, and a seed-touching mutant WROTE itself into the
  shared DB (59 rows, cleaned and re-proved at 58). Also: `db.migration.test.ts`'s
  0009 test is marginal at 5079 ms vs the 5000 ms default — measured, not this
  card's, has its own OWED line.
- **:3501** — 2026-08-01 — **CORRECTION to :3424: its "open ruling" was never
  open.** Part 2 §6:720-733 makes `scripts/seed_exercises.py` the canonical
  58-exercise catalog and Part 4 §3.4:373 rules `arnold_shoulder_press` stays
  unseeded; none of the three unmapped legacy names is IN the library, so no user
  can hand-log one and nothing is owed. Also re-verifies the count as **58**
  (visible 56 — `REMOVED_EXERCISES` hides Mountain Pose + Brisk Walking), so
  :3424's own "UNVERIFIED" self-correction was itself the error. Names the two
  RULED catalog decisions this work needs (Mountain Pose live/T3/F12/2.3; Brisk
  Walking `tracking 'timer'`). **Standing lesson: draft a ruling request AFTER
  the spec read, never before** — the file already carried that lesson.
- **:3424** — 2026-08-01 — **THE WEB WRITE PATH: Kd ruled BOTH halves.** (1) The
  exercise CATALOG must hold every pickable exercise BEFORE the web write path
  ships — it has **3** rows, `db/seed.ts:254` is the only insert site, and an
  all-unknown payload still creates a workout with `sets_count 0`, so shipping
  the web half first would write EMPTY workouts into history. Its own OWED line
  was created in the same commit; it had none. (2) `completeSession` **STAYS** —
  dropping it makes the post-workout screen print a plausible **"+50 XP" that was
  never awarded** (the old handler recomputes it), i.e. a screen that looks true
  and is false. **Read before any hand-logged-exercise work: a log-only set has
  NO name→slug resolver** — the engine path only works because definitions carry
  the plural legacy name as an alias. Carries a V1 self-audit of its own plan
  (an unverified "58", and a missed "Complete Set" button).
- **:3332** — 2026-08-01 — log-only sets, **T3 round 2 — CARD CLOSED** under the
  cap: 5 findings, ZERO visible, all fixed. **Read R2-F1 before regenerating any
  applied migration: it desynchronises `drizzle.__drizzle_migrations`, so the
  next `drizzle-kit migrate` RE-RUNS the migration and dies on 42710 — CI
  included, since its migrations job clones primary WITH data.** Either
  reconcile the row in the same step or use a NEW migration. **Standing lesson:
  R2-F2 found a test that could not fail INSIDE the fix written to close exactly
  that class** — a log-only row carrying a score is rejected by the PROVENANCE
  constraint first, so the log-only constraint's three score clauses were
  unasserted. Fixed by evaluating the DEPLOYED predicate from
  `pg_get_constraintdef` rather than a copy of it.
- **:3298** — 2026-08-01 — **F3 RULED (Kd, option A)**: the workout-level
  `engineVersion` means "the engine build the CLIENT was running", not "the
  engine that scored this", and `defsVersion` becomes NULLABLE — matching Part 4
  §3.5:384, which declares `bundle_version int` with no NOT NULL while the
  payload had been stricter than the spec. No migration, no deviation. Also
  `.min(1)` at workout level. **This discharges the last blocker on the web write
  path**: an all-log-only payload can now be built without inventing anything.
- **:3199** — 2026-08-01 — log-only sets, **T3 round 1**: 6 findings, ZERO
  visible, 5 fixed, **F3 open for Kd**. **Both halves of :3085's central claim
  were FALSE** — "enforced twice" and "an engine set still MUST carry
  provenance" — because `NULL IS DISTINCT FROM 'engine'` is TRUE, so any row
  omitting `mode` satisfied the guard with no provenance at all. **Standing
  lesson: the nine assertions "covering" those constraints were all Zod's,
  returning 400 before the DB was reached — they could not have failed if the
  constraints were deleted outright.** The replacement was proven by restoring
  the broken constraints and watching the new test go RED. **F3 (open): an
  all-log-only workout still has to send a workout-level engine version it does
  not have; the next card cannot be written honestly until Kd rules.**
- **:3085** — 2026-08-01 — **hand-logged workouts can reach the new API (API
  half)**. Closes the data-loss hole above: `workout_sets.mode` is filled in as
  `'engine' | 'log_only'` (Part 4 §3.5 declared the column and never its
  vocabulary — a SPEC GAP put to Kd, not invented), provenance columns go NULL
  rather than to a sentinel, and TWO CHECK constraints keep the relaxation
  narrow: an engine set still MUST carry provenance, and a log-only set CANNOT
  carry a form score, per-rep scores or faults. Migration `0009_log_only_sets`,
  expand-only. Backward compatible — `mode` is optional on the engine branch, so
  older clients validate unchanged. Kd ruled hand-logged workouts DO earn XP,
  shown the OWED:484 threat model first. **The web write path is NOT in this
  card**, so nothing user-visible changed yet.
- **:2912** — 2026-08-01 — workout history calendar → `/v1/workouts`: **BUILT,
  then PARKED AS BLOCKED** on branch `workout-calendar-parked` (NOT on
  `web-repoint`, which merges wholesale at cutover and would have armed it).
  **Read this before touching any workout-history surface.** Only 3 engine
  definitions exist of 58, no definition means log-only, and a log-only workout
  is never synced — so the new API holds only workouts containing squat / jump
  squat / chair squat, and after cutover every other workout would be saved
  NOWHERE. That consequence was untracked and now has its own 🔴 OWED line; the
  ruling under it ("where does a hand-logged workout live?") gates the calendar,
  PostWorkout's summary and the Dashboard's stats alike.
  **Standing lesson 1: an index entry you skipped is not evidence of absence**
  (:2825, incurred again) — `OWED:503` opens with "BLOCKED — do not pick this up
  as a quick win" and supplied the entire card in advance; the chat read the
  one-line cutover.md version instead and became the third to recommend it.
  **Standing lesson 2: M18 undid the whole repoint and all 46 tests stayed
  GREEN** — the render suite must mock the api client, so nothing asserted WHICH
  backend was called. A repoint nothing asserts is one the next edit undoes.
- **:2736** — 2026-07-30 — PostWorkout summary reader, **T3 round 3 — CARD
  CLOSED** under the cap: 9 findings, zero visible. Its F1 caught the round-2
  harness fix as an INSTANCE fix (a renamed describe block passed the gate); a
  fourth instance of the same class was then found by me after the round, when a
  silent `cp` failure left two mutations live at once and the table still said
  "ALL MUTANTS CAUGHT". **Standing lesson: a harness must verify the thing it
  asserts at every point — that a test RAN, that the RED was a test failure, and
  that the restore actually happened.**
- **:2614** — 2026-07-30 — PostWorkout summary reader, **T3 round 2**: 6 findings,
  ZERO visible, all FIXED. Its F3 is the one to know — the mutation harness had no
  GREEN BASELINE, so "RED" could not distinguish a caught mutant from a suite that
  never ran (proven: a broken runner produced a full table of REDs and exit 0).
  **Standing lesson, and the reviewer's own words: "fixed the instance, left the
  class" is now this card's most reliable output — four instances, each found in
  the fix written for the previous one.**
- **:2546** — 2026-07-30 — PostWorkout summary reader, **T3 round 1**: 6 findings,
  ZERO visible, all FIXED (none deferred). Its F5 put the mutation harness in the
  repo at `apps/web/tools/mutate-postworkout-summary.sh` — a claim of "13 mutations,
  13 RED" was unreproducible without it. **Standing lesson: F2 was the same rename
  regression as F1's, one field over, in the same commit** — fixing the instance is
  not fixing the class.
- **:2444** — 2026-07-30 — PostWorkout's summary payload gets a reader
  (`readSummaryView`, `formGrade`). Kd's rulings in it: "Not scored" copy, the
  empty-200 toast+redirect, the zero-active-seconds fold-in, calories rounding
  report-only. **Standing lesson: a whole-document sweep is satisfied by the SHARE
  CARD** — a rename regression stayed green through 7 render tests because of it.

## 5 · DPDP / privacy

- **:774–:866** — Day-14 hard-delete worker + T3 rounds 1–5 (branch
  `dpdp-day14-purge`)
- **:868–:916** — Data export, the other §5.2 right, + T3 rounds 1–3

## 6 · AUTH / GAMIFICATION BACKEND

- **:930, :978** — google-login: Google OAuth on the new API + T3 round 1
- **:1043–:1105** — XP/levels storage + curve port (branch `t3-user-xp`), T3
  rounds 2–5. The verbatim `badges.py` curve; migration `0008_user_xp`.

## 7 · THE XP DISPLAY CARD — **CLOSED 2026-07-30**, eleven review rounds

Closed by THE CAP (§1). Commits `7b91c68` · `0869f01` · `df0ea05` · `690cdfb` ·
`380b38c`. Both 🔴 OWED lines ticked. **This is history — a new card does not
need it** unless it touches the same screens (Sidebar, Dashboard,
GamificationStrip, Achievements, PostWorkout) or `gamificationApi.js`.

- **:1107, :1119** — Web XP display repoint + T3 round 2. Scope ruling: Sidebar
  IN, Dashboard OUT.
- **:1138, :1148** — Dashboard XP repoint + T3 round 3 (two fresh chats)
- **:1167, :1187** — T3 rounds 4 and 5. **:1173 is where the regex source guard
  was RETIRED as the protection of record** in favour of render tests, and where
  jsdom + @testing-library/react were approved as dev deps.
- **:1208, :1231** — T3 rounds 6 and 7
- **:1755** — the browser re-smoke: PASSED 11/11, and the mock rig trapped the
  run (`hang` saturates Chrome's per-host connection limit)
- **:1808, :1873, :1950** — T3 round 8 (card FAILED: 6 blocking, 15/31 mutants
  alive), then Round A (live defects) and Round B (the protection layer)
- **:2194, :2272** — T3 rounds 9 and 10
- **:2055** — T3 round 11, CARD CLOSED. **Standing lesson: AGREEMENT IS NOT
  CORRECTNESS** — round 10's caption-vs-dots invariant held while both read the
  same broken array.

### Lessons from this card that outlive it

- **Mutation-test every assertion before claiming it protects anything** (:1950).
  Four rounds' blocking findings were assertions that could not fail.
- **Fix the class, not the case** — recorded at :1239 and violated repeatedly
  after; "fixed as a class" was true of one site in N at least four times.
- **A record is a claim.** Five false claims were carried by one comment block
  (:1173, corrected at :1950). Re-measure, do not re-read.
- **PostWorkout XP repoint** (:1252–:1753, 4 rounds, closed): 32 findings, 7
  blocking, **zero user-visible defects at any point** — the origin of the
  stopping rule.

---

## Standing deferrals — see OWED.md, not this file

`OWED.md` is the list of what is still to do and is the authority for it. As of
2026-07-30 it carries 13 unticked 🔴 items. Notable ones a new card is likely to
collide with: the week-strip date axis (render side), round 8 F6's eight
un-remeasured mutants, `apps/web`'s exclusion from the root lint gate, the
timezone capture item above, and `ExerciseLibrary.jsx:63` as a fourth one-of-N
colour site.

**`RUNBOOK/cutover.md` was last verified 2026-07-26 and is STALE** — its XP
display checkbox is unticked though that card closed 2026-07-30. Do not quote its
checkbox counts as fact until it has been re-verified.
