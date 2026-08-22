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
- **:8808** — 2026-08-16 — **WEARABLES: both directions are possible, they are
  ONE integration rather than two, and the cost is a MOBILE APP rather than
  money.** **NO DECISION WAS MADE — Kd asked whether it is possible and costly
  and said expressly he is not asking to build it now.** The spec already
  schedules it (`02-part2b-trust-layer.md:169`, §2.4 Roadmap — wearable HR
  upgrades the calorie method at Part 6, MET staying the universal fallback).
  **Read before proposing wearable work, before quoting any platform's API terms
  FROM THIS ENTRY (they are marked UNVERIFIED — model knowledge, not a source
  read), and before building a second running-import path.** Writing our workout
  out and reading their run in share one permission and one channel; platforms
  charge nothing per user and the payload is trivial, but the phone health stores
  are reachable only from a NATIVE app (live HR needs a watch app too), so it
  cannot precede P5. Recommended AGAINST the paid per-user aggregators.
  **Two things worth more than the technical answer: write OUT before reading IN**
  (closing the user's rings is cheaper and more loved than ingesting their data),
  and ~~the pilot audience is Jorhat…~~ **STRUCK by Kd the same day — "my target
  is all over world including assam that is jorhat". JORHAT IS THE PILOT, NOT THE
  MARKET**, and Part 3 §6.3 (*Worldwide*) already said so; on a worldwide target
  the value is HIGHER than the struck claim, not lower. **Standing lesson: a fact
  about the PILOT is not a fact about the USERS** (:4355's shape). **Hazard
  recorded early:
  we already have GPS running, so an imported watch run can DOUBLE the same run
  unless dedupe is in that card's definition.** Health data lands inside the open
  privacy question at :592. Tracked NOWHERE before today (grep-verified); now has
  a ⚪ `OWED.md` line.
- **:13920** — 2026-08-21 — **THE JOIN-CODE SCREEN — and Kd's no-names ruling
  CLOSES a line he opened two days earlier.** Web half of :13803. **Read before
  touching `JoinCodesPanel`, `codesView.js`, the Overview's code panes, or the
  waiting queue's row — and before putting a code's LABEL back on any screen.**
  **A SECTION on Overview, not a seventh tab** (§3.1 fixes the nav at six and
  surfaces Groups as a filter; :12343's identical call for the confirm queue).
  **THE CODE APPEARS TWICE ON PURPOSE** — hero card to hand out (§4.0 step 4's
  "show code big"), row below to manage — **and the TESTS are what made that a
  decision rather than an accident**: four assertions broke on `Found multiple
  elements` and were SCOPED to a new `data-testid` rather than relaxed to
  `getAllByText`, which would have silently dropped L-4's claim that the hero
  shows the first LIVE code (what a rotated gym depends on); **one assertion's
  claim genuinely MOVED and was rewritten, not deleted** — "OLDPAU is nowhere" is
  now false, because the panel lists retired codes an owner must still see.
  **THE "FRONT DESK" ⚪ LINE TICKS, and the mechanism is the point: it was closed
  by a ruling about something else.** Kd raised it at the clock smoke (:13174)
  without ruling; the line proposed hiding the label "while a gym has one code",
  and his no-names ruling made every code carry the same default — so the
  conditional fix collapsed into an unconditional one. `groupLabelText` and the
  roster's column UNTOUCHED (R1.1); **the §2.4 test was INVERTED rather than
  deleted.** Decisions not to re-derive: **a trainer sees the code and none of
  the controls** (§2.2's two rows; hiding is not the enforcement, the 403 is);
  **the pause switch sends ONLY `paused`** while the limits editor sends both
  fields, because each must not clear what it never displayed (C26); **an end
  date is the END of the chosen day in the VIEWER's zone** — `${value}T00:00:00Z`
  is a day early AND somebody else's midnight (trap #8) — and an impossible date
  is refused rather than rolled forward (C23); **`atCodeLimit` is NULL when the
  list could not be read**, never "full" (C24); **the panel re-reads from the
  server** and re-reads CODES ONLY, so one change does not flash the whole screen
  (C27); **no controls over a list that failed to read**; **Replace asks first
  and pause does not** — only Replace is irreversible, and the question names the
  half an owner fears (people who already joined stay members). **PROVE: web
  963/963 across 41 files (+35) · build ✓ · eslint clean on eight files · the
  console sweep run to COMPLETION, 27 mutants · 27 RED · 0 ALIVE · 0 never ran.**
  **Instrument note, mine: three of six new mutant rows had broken anchors** (two
  real newlines, one nested quote) and `node --check` caught all three before a
  sweep ran — :13336's permanent guard working on the file it was added for.
  **NOTHING ELSE TICKS: the SMOKE (`RUNBOOK/smoke-join-codes.md`, written) and
  T3 are both UNRUN.**
- **:14174** — 2026-08-21 — **T3 ROUND 1 ON THE JOIN-CODE PACKET: ZERO
  CRITICAL/HIGH — IT SHIPS — and ten Lows, all fixed in the round.** **Read
  before writing a mutant row, before trusting a cap enforced by "one
  transaction", and before adding a control beside a guarded one.** **L-1: the
  Limits editor was reached by NO test, and the reviewer PROVED it by mutation —
  deleted `expiresAt` from its save, 101 tests stayed green.** C26 guards that
  exact class on the PAUSE switch one component away, and :13920 claimed the
  editor was guarded; **a mutant row is a claim about ONE call site, and writing
  one for a sibling makes a control LOOK covered.** **L-3: `createCode`'s cap was
  a check-then-act and its comment denied it** — under READ COMMITTED two staff
  both read 99 and both insert, and the 101st code is invisible to `listCodes`'
  LIMIT while the door honours it. Fixed by making the claim TRUE: `lockOrgRow`
  (§4.2's instrument, org row → child rows, matching `claimSeat`) in `createCode`
  and `rotateCode`; race test + mutant **O71**; **its fixture was wrong first
  (`MAX-1` filled the gym TO the cap, so both were refused and the test would
  have passed with the lock deleted — :5104 F5).** **L-4 is the same shape,
  answered the OTHER way on purpose: comment corrected, code left alone, because
  that race is self-healing and a lock there would serialise an owner's typing
  against every confirm in the gym. A LOCK IS WARRANTED BY THE CONSEQUENCE, NOT
  BY THE RACE.** Also: removal now answers a shared schema (L-8), the editor no
  longer closes on a refusal (L-7), an untouched past expiry is not resent
  (L-10), and the exhausted sentence names people who are IN (L-6, weighed
  against :5807 1a and landed Low WITH reasoning). **PROVE: api 555/555 (a
  CLEAN full run — a claim about a RUN, not the suite; the `catalog.seed` flake is
  unfixed) · web 980/980 · web sweep 35/35 RED · orgs 108/108 · O58/O67/O69/O71
  RED.** Instrument: a mutant
  that is a SyntaxError reads as "no test tally", a `-t` filter with a curly
  apostrophe is REFUSED, and **the web harness has no scoping flag; the api's is
  `MUTATE_ONLY`.** **BOTH GATES ARE MET AND THE `OWED.md` LINE STILL DOES NOT TICK** — its title
  is the §2.2 MATRIX, and RESTORE / staff management / CSV export / nudges are
  still routeless. A draft of this entry claimed the tick; ticking it would have
  lost four items.
- **:14147** — 2026-08-21 — **THE JOIN-CODE SMOKE PASSES (13 steps, Kd, commit
  `2273fc4`, "all passed").** **Read before asking Kd to run that sheet again —
  he has.** Settles: the count reads 1 not 2, neither box accepts typing (`19 07
  2026` verbatim), a removed code keeps its member, a WORKING code offers no
  Remove — **and the CORS preflight on `DELETE …/codes/:code`, which
  `fastify.inject` cannot see** (Card-4's 250-green-tests-over-a-dead-method
  precedent). Does NOT settle wording, or steps 1–5/7/10/11 beyond "still works".
  **THE ONLY REMAINING GATE IS T3, now owed on THREE commits — :13803, :13920,
  :14013 — none reviewed by anybody. A passing smoke is not a review.**
- **:14013** — 2026-08-21 — **KD'S SMOKE FINDS A NUMBER THAT LIES, AND THE
  PILE-UP HE PREDICTED.** Fixes on top of :13803/:13920. **Read before touching a
  code's count, `gym_codes.uses`, the limits editor, or anything that deletes a
  code.** **A code's `uses` COLUMN IS DISPLAYED NOWHERE AND ENFORCES NOTHING** —
  it counts seat CLAIMS, and the screen printed it under a sentence about PEOPLE,
  so a member who left and rejoined read as "2 people". What a screen shows and
  the door enforces is now `joined`: **live memberships that code created,
  complimentary EXCLUDED**, computed from `gym_members` at six written-out sites
  (`toCodeRow` holds the definition and the list; drift between the door's copy
  and the screen's is the defect, so they are anchored by a test that drives
  both). **MEASURED IN HIS DATABASE FIRST: his diagnosis ("the owner is counted")
  was WRONG and his instinct was RIGHT** — do not close a user's finding by
  correcting their theory. **A limit now frees when a member leaves.** **NO HAND
  TYPING on the date or the limit** (a native date input eats keystrokes segment
  by segment in the browser's own order, which is how `19 07 2026` became
  `19 09 2026` — a VALID date nobody chose, invisible to everything downstream);
  `parseLimit` is KEPT anyway. **REMOVE ≠ DELETE**: migration `0012` adds
  `gym_codes.removed_at`; the FKs are `ON DELETE RESTRICT`, so a real delete
  fails for exactly the codes a gym most wants gone. **Only a code that cannot
  admit anybody may go, and removal pauses it in the same statement**; a merely
  FULL code stays; the cap counts VISIBLE codes. **HIS SUBSCRIPTION WORRY NEEDED
  NO CODE: the seat cap has excluded complimentary members since :10010 and
  per-seat pricing is STRUCK at :12600** — answered, not re-ruled. **PROVE: api
  554 tests (orgs 67/67) local · web 976/976 · build ✓; the 3 reds in a full api
  run are `catalog.seed`'s global-count flake, green scoped. SWEEPS: web 32/32
  RED; api 70 mutants, 69 RED and ONE ALIVE — O69, a hole in MY TESTS (every
  removal test removed an already-paused code, so nothing could see removal
  ceasing to pause), fixed by asserting the row back on the EXPIRED path and
  re-measured RED. `--only=` is NOT the flag: the harness reads `MUTATE_ONLY`.** **The OWED
  delete/pile-up line TICKS; SMOKE (13 steps) and T3 are UNRUN.**
- **:13803** — 2026-08-21 — **A GYM CAN FINALLY CHANGE ITS OWN JOIN CODE (server
  half): make one · pause/wake · set an end date or a join limit · rotate. NO
  MIGRATION, and the refusals it reaches were built long ago.** **Read before
  touching code management, before adding a route that checks a code, before
  adding a second reader of `gym_codes`, and before putting a NAME BOX on a join
  code.** **KD RULING — no names**: *"this kind of names not needed men"*, given
  the cost (a label is §2.1's GROUP mechanism, so §2.3's trainer scoping has
  nothing to scope to); the COLUMN keeps its `'Front Desk'` default, narrowed at
  the door not deleted, re-opened by one optional field. **THE FINDING IS HOW
  NARROW THE GAP WAS: `applyByCode` has refused paused/expired/exhausted codes
  since the join door was built and all four columns date from `0001_init`** — no
  enforcement is new; what did not exist was any way for a gym to REACH those
  states (:11023 named it: "minted unlimited and eternal with no route to change
  it"). Decisions not to re-derive: **`codes.manage` is a NEW privilege and
  deliberately NOT `codes.invite`** (§2.2's two rows one line apart mean opposite
  things — a trainer reads 200 and writes 403, asserted); **tenancy is the pair
  (gym, code) never the code alone** — codes are globally unique, so `WHERE code
  = $1` would let one gym pause another's poster, the IDOR hiding behind a unique
  column (mutant O58 is that deletion); **rotate is ONE transaction** because the
  halves fail independently and a half-rotate leaves a gym NOBODY can join; **the
  new code carries the LABEL and none of the restrictions** (copying an expiry
  forward hands back a code already dead); **a limit below live `uses` is refused
  and the refusal names the count**; **a PAST end date is refused** (storing it
  produces a code never joinable under a screen saying it was created) while
  **`expiresAt: null` means "never" and is NOT run past that check**; **an empty
  PATCH is a 400**; **the collision retry reuses `OrgNameTakenError`** rather
  than an outcome arm that needed an `as T` cast (R2.2 — the existing precedent
  beat the thing written to avoid it). **THE AUDIT'S SURVIVOR IS THE PART TO
  READ: O61 survived a test that LOOKED like it covered it** — the fixture
  rotated the gym's ORIGINAL code, which has no expiry, so the mutant copied
  `null` to `null`; **the FIXTURE was the hole, not the assertion** (:5104 F5).
  **And the whole-table pre-check ABORTED on my own drift before a byte was
  written** — folding `listCodes`' mapper into a shared `toCodeRow` moved O23's
  anchor; re-anchored, re-measured RED, and **its reach WIDENED** (one line now
  carries the guarantee for the read and all three writers). Two test defects of
  mine, both found by running them: three fixture users collided by name with the
  SEAT-cap test's, and the audit test ordered by `created_at`, a column
  `audit_log` does not have. **PROVE: api 549/549 across 44 files on local
  Postgres · tsc + eslint clean · 6 new mutants O58–O63 all RED, O23 re-anchored
  RED, restores sha256-verified.** **NOTHING TICKS — THERE IS NO SCREEN**
  (:11846's shape: an endpoint with no caller); the web half is the next card and
  carries the SMOKE, T3 UNRUN. **OWED: a code can be turned off but never
  DELETED** — the 100 cap counts retired codes, and a delete has to rule on
  `gym_members.code_id`, the group attribution every membership carries.
- **:13746** — 2026-08-21 — **ADDENDUM to :13659: I raised the worker cap on a
  guess, the measurement killed it, and what it uncovered is worth more than what
  it was aiming at.** **Read WITH :13659 — it CORRECTS two of that entry's
  claims.** (1) **The conditional worker cap is REVERTED**: the full suite flakes
  on a local database at 4 workers TOO, so the cap was never what stood between
  this suite and green. (2) **"api 536/536 in 51 s" was true of a RUN, not the
  SUITE** — five full local runs went 536, 535, 532, 535, 536, and the gate
  figure is withdrawn. **:13247's own Low-3 recurring, in the session that fixed
  it, quoted by the chat that wrote the fix.** **What the failed attempt FOUND is
  the point: NINE test files call `seed()` against one shared database while two
  assert exact GLOBAL counts** — pinned, not guessed (those two pass together 3/3
  and alone 2/2, failing only inside the full run). **PRE-EXISTING; Neon's latency
  was HIDING it** by spreading the suites out, so the fast database made it
  visible rather than causing it. **A SCOPED run — one file or a `-t` filter,
  i.e. what a mutation sweep runs — is unaffected**, so the audit instrument is
  untouched. Caught only because Kd asked whether local testing could harm
  quality, which meant running the suite more than once: **a number quoted from
  one run is a coin toss with a citation.** OWED line added; the fix is isolating
  the seed-asserting suites, never a worker count.
- **:13659** — 2026-08-21 — **THE TESTS STOP TRAVELLING TO SINGAPORE: a local
  Postgres for the suite and the mutation sweep, and :5857's UNVERIFIED saving is
  now MEASURED.** **Read before running a mutation sweep, before quoting a
  suite's duration, before touching `vitest.config.ts`'s worker cap, and before
  assuming the Neon branch is the only database available.** Kd asked for it
  directly after five review rounds whose audit cost was dominated by a database
  in `ap-southeast-1`. **Measured, same machine same day: round-trip `select 1`
  202.9 ms → 2.7 ms · `orgs.sweep` (18 tests) 158.2 s → 10.8 s (14.7×) · two org
  suites DID NOT FINISH in 10 min on Neon vs 77 s local · whole api suite 536
  tests in 51 s local.** **The did-not-finish row is a LOWER BOUND, written as
  one, and NO full-suite Neon figure exists so none may be quoted.** The governing
  row is the second — **a sweep runs a suite once PER MUTANT**, so the clock
  card's six DB mutants were ~16 min of Singapore against ~1 min local, matching
  :5857's own ~18 min. **It was WIRING, not building**: `docker-compose.dev.yml`
  has run `pgvector/pgvector:pg16` on port 5433 since the deploy-infra card —
  migrate, seed, 536/536, 47 tables, all three extensions verified. **The native
  PostgreSQL 18 already on the dev machine was REJECTED on evidence** (the schema
  needs `vector`, a third-party build on Windows; the compose image bundles it,
  and port 5433 means they never collide). Three small pieces: a `test:local`
  script that **refuses** a missing/empty/unseeded database with the fixing
  command — **both refusals proven by causing them** · ~~the 4-worker cap is now conditional~~ **— TRIED AT 8 AND
  DISPROVEN THE SAME DAY: the full suite flakes at 4 TOO, so the cap was never
  the thing standing between this suite and green. Reverted; do not re-try.
  What the attempt uncovered is better than what it was aiming at — NINE test
  files call `seed()` against one shared database while two assert exact GLOBAL
  counts, a PRE-EXISTING race Neon's latency was HIDING (five full local runs:
  536, 535, 532, 535, 536). A scoped run — one file or a `-t` filter, i.e. what
  a sweep does — is unaffected. Own OWED line** · the sweep harness now **prints its database, host
  only never the url** (R3.10). **The guard built that same morning paid for
  itself**: the new script landed in `apps/api/scripts`, the directory round 5's
  Low-5 added to the walk, so it was parse-checked with no edit to the guard —
  which is the only thing covering that directory, eslint and tsc both being blind
  to it. **STILL OPEN and not smuggled into "done": the severity class per mutant**
  (:5857 rule 4a item 1) is untouched.
- **:13552** — 2026-08-21 — **THE CLOCK, T3 ROUND 5: ZERO Critical/High — THE
  PACKET SHIPS, five rounds closed, and `OWED.md`'s clock line TICKS.** **Read
  before adding a day word to `joinClock.js`, before deleting the floor under its
  duration, before quoting a count of this repo's mutation harnesses, and before
  putting a repo-wide guard inside one package's lint task.** Escape hatch NOT
  armed. Round 4's structural fix HELD under a proper attack — 11 zones from
  UTC+14 to UTC−12, both DST transitions, 45-minute and half-hour offsets,
  **19,008 day-word checks, 0 disagreements**. **THE SEVERITY CALL WENT TO KD
  RATHER THAN BEING MADE QUIETLY:** Low-1 — "Waiting 1 day" about a request TWO
  MINUTES old — is a wrong NUMBER on screen, which :5807 names Critical/High; the
  reviewer tagged it Low on :13281's own line (the identical judgement round 4
  made about the identical function), **disclosed that he had, and Kd chose Low
  after being shown that a C/H tag arms the escape hatch and demands a redesign of
  the file round 4 had just redesigned.** **AND THE REVIEW'S PROPOSED ONE-LINE FIX
  WAS MEASURED AND REJECTED — the most useful thing in the round.** "Drop
  `Math.max`" rests on "two calendar days apart implies a day elapsed", which is
  **false across a spring-forward day: `America/New_York`, 7 Mar 2026 23:59 → 9
  Mar 00:01 is 23h02m and floors to ZERO**, so it would have shipped "Waiting 0
  days" into every DST zone twice a year — from the round convened to remove false
  numbers, and invisible in the pinned zone because `Asia/Kolkata` has no DST.
  **Standing lesson: a reviewer's proposed fix is a claim and takes the same
  evidence as the code it replaces (V1).** **Four of the nine Lows are prose that
  round 4's own fix falsified** — the rule's DURATION example, the "two screens
  cannot differ" claim (measured across three zones on one deadline), a comment
  reasoning in UTC in a Kolkata-pinned suite, and a half-stale pinning note —
  **which is the predictable aftermath of a structural fix: the code moves and the
  sentences about it do not.** **Low-4: "18 mutation harnesses" was NEVER true in
  any of the five documents quoting it** (18 is the `.mjs` count, four of them
  tools; real figure 14 `.mjs` + 3 `.sh` = **17**), and three `.sh` harnesses were
  parsed by nothing. **Low-6: round 4's cache fix was half a fix** — `api#lint`'s
  172 cache inputs reach nothing outside `apps/api` (turbo `--dry=json`), so
  breaking any of the 16 harnesses elsewhere replayed a cached pass; the guard now
  runs from the ROOT lint script. **Low-6a is mine and is the sharpest: the
  narrowing check I wrote to prevent exactly that COULD NOT FAIL** — it looped the
  checker table, so deleting the `.sh` checker deleted the expectation with it
  (:5104 F5's shape, inside the fix written for that class). **Recursion added
  with NO observable subject and said so** — its mutant is ALIVE (:12343). web
  **928/928 exit 0** · 6 mutants, 5 RED each killed by the test naming its
  guarantee, 1 ALIVE with its reason.
- **:13432** — 2026-08-21 — **THE CLOCK, T3 ROUND 4: ONE Critical/High — the
  screen said "Expires today" the day BEFORE a request expired — and the fix is
  the REVIEWER'S STRUCTURAL ONE rather than a fourth patch.** **Read before
  adding any function to `joinClock.js`, before writing a sentence containing
  "today" or "tomorrow", and before claiming a SQL condition is load-bearing.**
  Escape hatch NOT armed (round 3 was the harness, this is `joinClock.js`).
  **C/H-1 measured: 21 hours out across a local midnight printed "Expires
  today", and it is reachable EVERY DAY** — `expires_at` is `applied_at + 14
  days`, so every evening applicant hit it on every day they waited, on both
  screens. **THE SAME DEFECT CLASS HAS NOW APPEARED IN FOUR FUNCTIONS ACROSS
  FOUR ROUNDS**, which is why the fix is one RULE for the whole file — day words
  compare local calendar days, durations count elapsed time, and
  `calendarDaysBetween` is the only place a day comparison happens, so the rule
  is enforced by there being nowhere else to do it. **Two old tests were
  ASSERTING the defect** (one demanded "Asked today" at +23h) — how a wrong rule
  survives four reviews. **Low-3 is the THIRD round running that `sweep.ts`'s
  prose named a dead condition as the guard** (:5748 again, always in the file
  not being edited); the reviewer measured it — delete it, 18/18 still pass.
  **Low-4: I overclaimed twice in round 3 and he checked both** — the in-body
  timer calls were never moved, and my "1 failed | 52 passed" proof reproduces
  IDENTICALLY with the fix removed (V1: real measurement, proved nothing).
  **Low-5: the permanent guard was a case fix** — one named file against ~~18~~
  **17** harnesses (**count struck by :13552 — 18 was the `.mjs` total, four of
  them not harnesses, and it missed three `.sh` ones**), and `turbo.json` did not
  list `tools/**`, so a harness-only edit skipped the check on a warm cache. Now
  a WALK, with an empty walk a failure, proven by breaking a web harness the old
  guard could not see. **The cache half was only half-fixed and :13552 finished
  it.**
- **:13336** — 2026-08-21 — **THE CLOCK, T3 ROUND 3: ONE Critical/High, and it
  is NOT in the app — the card BROKE THE INSTRUMENT THAT PROVES THE APP, and no
  gate in this repo could see it.** **Read before editing
  `apps/api/tools/mutate-orgs.mjs`, before trusting that a mutation harness ran
  because a card says it did, and before re-aiming any mutant after a fix moves
  the code it points at.** **Escape hatch NOT armed, and the reviewer said so
  unprompted**: round 1 in `sweep.ts`, round 2 in `joinClock.js`, round 3 in the
  harness — three subsystems, no two rounds running, and **zero Critical/High in
  the file round 2 had just fixed**. Both round-2 date fixes re-derived from
  scratch and held; his argument on the dead arm is better than mine — **the
  guard was `A OR B` and `A` was removed, so the expiring set can only SHRINK.**
  **C/H-1: a raw newline inside a mutant string made the harness a SyntaxError,
  so NONE of its 57 mutants could run** — including O56/O57, which exist solely
  as the permanent guards on round 1's two Criticals. **Nothing in the standard
  gate could see it**: eslint ignores `tools/**/*.mjs` and tsc never reads it.
  **C/H-2: four anchors stale**, and because the preflight loops the FULL table,
  even a one-mutant run would abort. **Both were mine, from the round-2 re-aim
  whose edit silently matched nothing.** Permanent guard (:5348 rule 5): `lint`
  now ends with `node --check tools/mutate-orgs.mjs`, **proven both ways**.
  **The reviewer again refused to downgrade his own finding to buy a ship** —
  second round running. Both findings are user-INVISIBLE and were tagged
  Critical/High anyway, because rule 4/4a make the audit mandatory and this
  card's guarantee IS data loss. **Five Lows fixed. Low-1 is round 2's own
  correction landing in three files and missing the fourth** — `sweep.ts` still
  described a two-arm guard and named the wrong arm as deleted (:5748 again: the
  place a correction is missed is the file you were not editing). **Low-3 left
  the tomorrow/couple-of-days boundary unpinned — the same shape as the gap that
  hid round 2's Critical, in the file written to close it.** **Two slips of mine,
  both the same one: the first re-anchor broke the syntax a SECOND time, and my
  first Low-3 test was written in UTC while the suite pins `Asia/Kolkata` —
  round 2's Critical restated, by me, in the test written to pin it.**
  **PROVEN AFTER THE REPAIR: 10 mutants, 10 RED, 0 ALIVE — and O56/O57, the
  permanent guards on round 1's two Criticals, went RED for the first time in
  their existence.** Two control aborts on tests that pass alone, both against
  the Singapore database under contention: **the harness refusing to report a
  verdict it cannot back is it WORKING** (:11846), and :5857 rule 4a's
  local-Postgres switch is the standing fix, still owed.
- **:13247** — 2026-08-21 — **THE CLOCK, T3 ROUND 2 (diff-only): ONE
  Critical/High — and it is the round's OWN FIX reintroducing the defect the
  round was fixing.** **The escape hatch is NOT armed: round 1's two Criticals
  were both in `sweep.ts` and this round found NONE there**, so no redesign
  question for Kd. Both sweep fixes re-derived from scratch and held.
  **Read before writing any sentence containing "today" or "tomorrow", before
  trusting a comment that calls a guard load-bearing, and before quoting a
  suite's pass count without its exit code.**
  **C/H-1: the fix for L2 reintroduced L1 and L3** — the new helper bucketed by
  elapsed HOURS and printed a CALENDAR word, in a file whose header says ELAPSED
  TIME NEVER CALENDAR DAYS. Measured: nudged 08:00, read 21:00, next slot 08:00
  tomorrow, screen said "later today". Fixed by comparing LOCAL DAYS.
  **The reviewer tagged it Critical/High where round 1 had tagged the same class
  Low, and refused to soften it to buy a ship** — Kd's "fix all" takes the fix
  and leaves the tag; the difference is real (a wrong WORD about the past vs a
  wrong PROMISE about the future).
  **Low-1 is the most instructive finding in either round: round 1's fix left
  DEAD CODE and four documents called it load-bearing.** Given `expires_at <=
  now`, arm 1 implies arm 2 and decides nothing — proven by deleting it (18/18
  still green) and by exhaustive check. The "must not be deleted" claim was true
  of the OLD arm and false of the one the fix wrote, **carried into four
  documents inside the commit that made it false**; struck everywhere, arm
  deleted, mutant O56 re-aimed at the notice subtraction.
  **Low-3: "906/906, exit 0" was true of a RUN, not of the SUITE** — a clock
  pinned exactly on a day boundary with `shouldAdvanceTime` flipped 11 days to 10
  one millisecond later; the reviewer saw 905/906 on one run of three. Second
  instrument finding on this card about believing a number.
  **Low-2 + Low-4 are one hole**: `joinClock.js` had no unit test, so every
  bucket boundary was unpinned — the exact window C/H-1 lived in. **My first
  draft of that test file FAILED for the finding's own reason: I wrote the case
  in UTC and the suite pins `Asia/Kolkata`.** Security pass clean; `gymIds`
  verified unreachable from HTTP by grep, not inference.
- **:13174** — 2026-08-21 — **THE CLOCK'S SMOKE PASSED 10/10 — and the last run
  accidentally became the best evidence in the card: the C/H-1 fix REFUSING to
  delete a real request, in Kd's own browser.** **Read before citing the clock as
  verified, before quoting these steps as covering the nightly worker, and before
  writing "instead of the button" into any smoke sheet.** Kd's REPORT (:4829),
  except the three sweep runs where the TOOL's own output is the evidence.
  **The `expired` arm was seen by a human for the first time** — it has existed
  since :12343 with no path in the product able to reach it. **Step 10 is the one
  to keep and nobody designed it:** a re-apply between the two runs meant the
  repeat met a NEW application already past its deadline at the pretend date, and
  the sweep **flagged the gym and refused to delete it in the same run**
  (`remindedFirst:1, expired:0, heldForNotice:1`) — **T3 C/H-1 exactly, on a real
  row, where the pre-fix code would have deleted it with zero notice.** Recorded
  as LUCK not method (:10402's precedent). **Two sheet defects, both the SHEET's,
  both fixed mid-run** (:12343's lesson again): step 3 expected wording the same
  round's Low-3 fix had already replaced, and **step 8 described a screen this
  card never built** — the button is FADED with the reason beside it, deliberately,
  because a control that vanishes leaves a person hunting for it. **Kd asked
  whether the queue's "Front Desk" label is needed** — §2.1's group mechanism,
  noise while a gym has one code, useful at several; not acted on (R1.1), his
  call, own ⚪ line. **NOT established: the nightly worker never ran** — 03:30 is
  proven by reading `worker.ts` and by nothing here. **The diff-only re-review is
  the remaining gate.**
- **:13075** — 2026-08-20 — **THE WAITING ROOM'S CLOCK, T3 ROUND 1: TWO
  Critical/High. THE PACKET DID NOT SHIP THIS ROUND.** Reviews :12878. Escape
  hatch NOT armed (round 1). **Read before writing any guard that asks whether a
  warning HAPPENED, before letting a background mutation and its audit row live
  in different transactions, and before adding a test that sweeps a table the
  rest of the suite is using.**
  **C/H-1: the ordering rule was a YES/NO where the promise is a DURATION.**
  `gym_notified_at <= expires_at` is satisfied by a flag raised one minute before
  the deadline, so the next run deleted the request — **measured on real Postgres
  at 31 minutes' notice against a promise of two days**, on a fixture the product
  produces, with a BullMQ retry (`attempts: 3, backoff: 60_000`, this job's own
  config) as the second run. **The second time on this card that :11385's own
  wording produced the outcome :11385 forbids** — :12878 closed the "flag lands
  AFTER the deadline" half and left "just BEFORE it" open. Fixed by measuring the
  SAME `EXPIRY_NOTICE_DAYS` from both ends. **Cost accepted and stated: a
  late-chased row dies up to two days AFTER its 14-day mark.** ~~Arm 1 must NOT
  simply be deleted — mutated out, two tests go red correctly.~~ **STRUCK by
  round 2's Low-1 (:13247): true of the arm BEFORE the fix, false of the arm the
  fix produced — given `expires_at <= now` it implies arm 2 and decides nothing.
  Deleted; the guard is one condition.**
  **C/H-2: the expiry and its audit rows were two transactions**, the lone
  exception among six mutations in the module; a timeout, deadlock or dead worker
  left rows `expired` that the retry can never match (`status = 'pending'` gone)
  and **no audit row ever written**. One `sql.begin` now; its test injects a
  writer that throws on the second row (`purge.ts`'s `purgeOne` precedent).
  **THE UNSCORED FINDING THAT MATTERS MOST: the reviewer wrote his own mutant
  (:12227) — deleting arm 1 went RED, proving it covered IN THE DIRECTION THE
  SUITE TESTED, while the uncovered direction was C/H-1 sitting in shipped code
  under a green suite. A guard can be well-covered and still be the wrong
  question.** Seven Lows all fixed (`BACKLOG.md`); three are one class — **the
  screen claiming CALENDAR facts off ELAPSED arithmetic** — and **L2 is the
  sharpest: `nextNudgeAt` was added so the client would never invent a time, and
  both sentences then hardcoded "tomorrow" while the field went unread.** **L4 is
  a hazard the card introduced**: fixtures namespaced, SWEEP table-wide, four
  suites at once on one database — closed with a `gymIds` scope that also made
  every count EXACT. **The instrument finding is mine: a fixture's
  `mockReturnValue(Promise.reject(…))` failed the whole web suite while reporting
  `906/906 passed` — caught by reading the EXIT CODE, :5906's shape.** Security
  pass clean on every axis; the reviewer independently agreed with the §2.4
  widening. `tools/orgs-sweep.ts --now` gained a production refusal.
- **:12878** — 2026-08-20 — **THE WAITING ROOM GETS ITS CLOCK (step 3 of 3):
  requests EXPIRE, the gym is CHASED, the waiting member can NUDGE — and KD
  RATIFIED THE THREE NUMBERS** (14-day expiry · chased at 2 days then weekly ·
  one nudge a day; he was asked, recommended "keep all three", and chose it, so
  they are RATIFIED and a later card moving one needs a fresh ruling).
  **Read before touching `modules/orgs/sweep.ts`, before adding a writer of
  `gym_join_applications.status`, before putting any countdown on a screen, and
  before assuming "the gym was told" is ONE condition.** Implements :11385.
  **NO MIGRATION and that is not luck** — all three columns were written into
  `0011` by the step-1 card *for this card*, stamped and unread since (grep
  returns the migration, the table, and nothing else). **THE ORDERING RULE IS
  ENFORCED TWICE**, in the sequence and in the expiry's own WHERE, and the WHERE
  is the one that matters: **if the worker never runs, nothing expires** — the
  only safe direction. **THE HOLE THE RULE'S OWN LETTER LEAVES, found by three
  tests going red rather than by reading: "was it ever chased" is satisfied by a
  chase in the SAME RUN**, so a worker down for the fortnight would flag every
  overdue row and delete it in the same breath — the gym told and given zero
  seconds. The expiry therefore asks whether the flag went up **IN TIME** (two
  arms, both needed). **The two chases are ASYMMETRIC on purpose**: the first
  fires on overdue rows (or they could never die), the weekly repeat skips them
  (or a reminder extends the wait it is reminding about). **Four K4 calls to
  ratify not re-derive: the once-a-day limit is a DATABASE COLUMN compared inside
  the writing statement, not a Redis counter** (a dropped counter there is a
  retry; here it is a second reminder nobody gets); **`decided_at` stays NULL on
  an expiry** (nobody decided, and `coalesce(decided_at, expires_at)` already
  reads this row); **the audit row has `actor_user_id = NULL`** — the first
  mutation in the product with no human, so `insertAudit` widened to
  `string | null` rather than inventing a stand-in; **the nudge route carries NO
  gym id**, the tenancy pair being (application, caller). **The `expired` arm on
  the member's card, written at :12343, was UNREACHABLE until today** — the
  column was stamped and never read. **The §2.4 key-set guard FIRED and that is
  it working**: the two new queue fields were argued into the list rather than
  waved through, and the list stays exact. Both contract fields are
  `.default(null)` for :12660's expand-then-contract reason, each with a test
  through the REAL parser (:12731 rule 4). `tools/orgs-sweep.ts --now` is a SMOKE
  instrument as much as an ops one — every threshold is in DAYS — and has **no
  dry run deliberately** (:12227's guard-testing-a-copy shape). Job at 03:30 on
  the existing `rollups` queue. **THE AUDIT'S SURVIVOR IS THE SHARPEST THING IN
  THE CARD AND IT WAS MINE: 8 mutants · 7 RED · 1 ALIVE.** O51 — the expiry
  dropping its `status = 'pending'` filter — changed nothing observable, because
  the test naming that guarantee rejected a FRESH application and **a
  never-chased row is excluded by `gym_notified_at IS NOT NULL` whatever its
  status**; the protection was carried by a DIFFERENT guard and the filter could
  have been deleted with the suite green (:5104 F5, in a test rather than a fix).
  Closed with TWO tests that chase the gym FIRST, and the second matters: **a
  CONFIRMED application keeps its own `expires_at`**, so without the filter a
  training member's row is rewritten `expired` — which **re-opens :12518 C/H-1**,
  since `listApplicationsForUser` withholds a stale refusal only while a later
  application reached `confirmed`. The mutant's FILTER moved with its fix
  (:11846). Re-run RED. **Two instrument findings, both caught by not trusting a
  number:** the first sweep ABORTED on a control filter matching a real green
  test (transient DB blip — identical filter GREEN on re-run, :11846's
  precedent), and **the O51 re-run reported an exit code having never executed**
  (a `cd` in a shell already there; the log held nothing but the code), caught by
  reading the OUTPUT — :5906/:5199's shape again. **NOTHING TICKS: smoke
  (`RUNBOOK/smoke-clock.md`) and T3 both UNRUN.**
- **:12832** — 2026-08-20 — **THE JOIN DOOR STEP 2 IS DONE — smoke step 14b
  passed and `OWED.md`'s "no screen anywhere lets a member type a gym's join
  code" is TICKED against commit `c9435d7`.** **What ticks is STEP 2 OF THREE:
  the waiting room's CLOCK (expiry sweep, gym reminder, member nudge — :11385)
  is step 3 and keeps its own OPEN line; the 14-day expiry is stamped on every
  row and NOTHING acts on it.** **Read before claiming any part of the join door
  is finished, and before starting step 3.** Carries the card's own record of
  **four instruments each blind to what the next one caught**: the mutation
  sweep found what the card CHANGED and got wrong; T3 round 1 found what the card
  ASSUMED and never wrote (a missing role check no mutant can delete) plus a
  false sentence; **Kd, looking at a screen, found the smoke sheet's misleading
  wording and then that round 1's fix had left the app SAYING NOTHING** — which
  no reviewer, test or mutant reports; T3 round 2 found that three tests written
  to close round 1's findings were liars. **Twice on this card the only thing
  that found the defect was a person looking at the product** — the argument for
  the SMOKE gate. Lists what stays open with `OWED.md` lines.
- **:12731** — 2026-08-20 — **THE JOIN DOOR STEP 2, T3 ROUND 2 (diff-only):
  ZERO Critical/High — THE PACKET SHIPS. Escape hatch NOT armed.** Reviews
  :12518 and :12660. **Read before writing copy about what a gym pays for,
  before trusting a source-regex test to prove a page renders, and before
  assuming a partial unique index means one row.** Security pass clean on every
  axis. **The severity call the reviewer refused to make alone:** the removal
  card said "the features your gym was paying for have ended" and **no gym has
  ever paid** — nothing inserts into `subscriptions` (grep-verified twice,
  independently). Arguably Critical/High under :5807, **and tagging it so would
  have ARMED the escape hatch** and put a redesign of the orgs module to Kd over
  a marketing clause. Kept **Low** (nobody was ever in the state, no number or
  action changes, wording predates the card) and **fixed immediately because the
  fix is identical either way** — clause deleted, returns with billing.
  **L2-3 is the shape to remember: a guarantee that held only because of what
  ONE caller happens to do** — `formerOrgs` could name a gym twice because
  `gym_members_live_uq` is PARTIAL on `removed_at IS NULL`, invisible only
  because the client dedupes by id; fixed with `DISTINCT ON` and **given the
  test it never had**. **L2-2 is a COMMENT fix on purpose**: the code claimed a
  self-deleted account "cannot be in flight here" and `restoreUser` makes that
  false, but nothing user-visible is wrong — the durable fix is a reason column
  on `gym_members`, NOT invented (R0.2). **L2-4**: the two `/orgs/mine` reads are
  now one `sql.begin` snapshot; untested and said so. **THE STANDING LESSON, and
  the sharpest of the three this card produced: A TEST WRITTEN TO CLOSE A REVIEW
  FINDING IS NOT AUDITED BY THE REVIEW THAT ASKED FOR IT** — L-1's fix shipped
  with L-1's own defect inside it and the `.default([])` guard was argued at
  length while its test proved nothing. **Mutate the test you just wrote, in the
  round you write it.** Also corrects a reporting claim of mine: round 1 said
  eslint was "clean on every changed file" and it was not.
- **:12660** — 2026-08-20 — **KD RULING: A REMOVED MEMBER MUST BE TOLD —
  silence was the other half of the bug.** **Read before touching
  `/v1/orgs/mine`, `gymStatusRows`, or any copy about a membership ending.**
  **CORRECTS a choice Kd made four hours earlier** and that should never have
  been offered to him: when :12518 C/H-1 found the app calling a removed member a
  stranger, "say nothing" was put to him as an equal option and he took it —
  **fixing a false sentence by removing the sentence is a quieter defect, not a
  fix.** His wording ("should say they were rejected") was CORRECTED before
  building and he was told why: they were let IN and then taken OUT, so refusal
  copy would be a second untruth. Built sentence: **"You're no longer a member of
  {gym}"**, plus the two true things people fear losing (all training data is
  still theirs; the free app remains). **No Try again link.** The fact lives in a
  SEPARATE `formerOrgs` list on `/v1/orgs/mine`, never a row in `orgs`, because
  **the console reads the same response** and a removed gym in `orgs` would enter
  a console list whose every read the server 404s. 14-day window
  (`DECIDED_VISIBLE_DAYS`); withheld once the person REJOINS. **`.default([])` in
  the shared contract is deliberate** — `orgsApi.js` treats a contract mismatch
  as a hard failure and the card treats a failed read as silence, so a REQUIRED
  field would destroy the whole gym card during any web-newer-than-API window to
  add one sentence (R4.4's expand-then-contract, applied to a response). **Rank:
  `removed` is BOTTOM (0), below `refused`** — recency, not importance, and it
  holds ONLY while :12518's server fix keeps withholding a superseded refusal.
  Both server tests watched RED against mutants, restored and verified.
  **The lesson is mine: round 1 caught the app saying something FALSE and could
  not catch it saying NOTHING, because no reviewer, test or mutant flags an
  ABSENT sentence — the USER did.** Second finding on this card that only a human
  at a screen produced, and the argument for the SMOKE gate existing.
- **:12600** — 2026-08-20 — **KD RULINGS on an outside architecture review:
  PER-SEAT PRICING = NO, PHONE OTP = NO, STRIPE = YES.** All three struck or
  confirmed in one message. **Read before proposing any seat-based price, any
  phone/SMS verification, or any payment provider substitution.** Per-seat and
  phone OTP are STRUCK items (:456's precedent) — **no `OWED.md` line, nothing to
  build, do not re-propose.** The consequence of striking per-seat that a later
  chat must ACCEPT rather than re-argue: **roster hygiene is ours to enforce
  technically, not the gym's to enforce commercially.** Stripe merely CONFIRMS
  Part 5 §4, **but the ruling does not dispose of the factual risk** — the claim
  that new Stripe signups are closed to India-based founders is **UNVERIFIED**
  and obliges a CHECK before P3.5, never a chat's silent substitution of another
  provider; own ⚪ `OWED.md` line. **Standing lesson: an outside answer is
  GROUNDED before it is relayed** — this one was ~60% already built or already
  ruled here (computed entitlements, the pending-then-confirm join door, seat
  accounting, server-side gating, history surviving removal), and relaying it
  unchecked would have reopened three built things and one Kd ruling as if they
  were open questions.
- **:8771** — 2026-08-16 — **KD RULING: users NEVER add their own exercises —
  the catalog is CLOSED, deliberately.** A struck item, not a deferral (:456's
  precedent); no `OWED.md` line, nothing to build. **Read before proposing a
  custom-exercise feature, before adding any WRITE route under `/v1/exercises`,
  and before letting a user type a free-text exercise name anywhere it can reach
  a saved workout.** Already true in code and verified rather than assumed —
  the exercises module exposes exactly two routes, both `GET`. **The reason is
  that counting and scoring are not free**: every row carries family, tier, MET
  and tracking mode, and a camera-graded one carries hand-ported thresholds
  (R5.4), so a user-typed row is either uncountable or scored against numbers
  nobody chose — R0.2/R5.6. **Consequence: no USER path can produce an
  unresolvable exercise name**, which bounds (but does not close) the same day's
  `syncClient` guard hazard. **Does NOT restrict growing the catalog** — that is
  P4's production line, one reviewed row plus a re-seed, and Kd asked expressly.
- **:5857** — 2026-08-07 — **KD RULING: the TEST AUDIT is SCOPED BY SEVERITY, not
  applied uniformly.** Calibrates :5348's rule 4; **does NOT weaken it — the audit
  stays mandatory.** Slow database-backed mutants are spent ONLY on what rules
  1/1a call Critical/High (ownership · numbers a user sees · anything that
  saves/syncs/queues · money), **never** on wording, ported constant tables,
  comments, naming or layout; **database mutants run only on cards that change
  SERVER behaviour**; and the sweep should point at a LOCAL Postgres when the card
  allows. **Measured cause:** the summary card's audit took ~40 min, ~18 of it six
  DB mutants each re-running the whole suite against a Neon instance in another
  country — giving the same ~3 minutes to a meal-threshold boundary as to "can a
  stranger read your workout", while everything it actually caught sat in the
  Critical/High rows. **The real argument is alignment:** the audit's cost now
  follows the same axis as the severity gate, where before the gate and the
  instrument graded risk differently. **UNVERIFIED and owed a measurement:** the
  local-Postgres saving is untimed — quote no number until it is. The tool has no
  severity classes and no local-DB switch yet; own `OWED.md` line.
  `CLAUDE.md` Part I §2.5 rule 4a.
- **:5807** — 2026-08-07 — **KD AMENDMENT to the severity gate: WHAT A USER CAN
  SEE AND IS FALSE IS CRITICAL/HIGH.** ADDS to :5348's rule 1, replaces nothing
  ("add it but don't delete previous rules"). A finding is Critical/High if a user
  could see something **FALSE** — a wrong number, a wrong state, a promise that is
  not true — **or** is blocked from finishing something. **Cosmetic-but-TRUE stays
  Low** (spelling, wording, naming, layout). **The test is not "is it on screen",
  it is "is it on screen AND wrong".** Prompted by the two defects at :5618 that
  fell through the original list — "+60 XP" when 50 was awarded, and "31s" above
  "1 min total" with a tooltip explaining rest that never happened. **NOT the old
  VISIBLE/NOT-VISIBLE stopping rule returning**: that decided TICKING, this decides
  CLASSIFICATION. Carries the standing point Kd's question produced: **reviews were
  never the protection** — both of that card's visible defects were found by his
  BROWSER and by a SURVIVING MUTANT, and what is most likely to bite after deploy
  is on `OWED.md` and invisible to any review. `CLAUDE.md` Part I §2.5 rule 1a.
- **:5348** — 2026-08-06 — **KD RULING: THE FIXED REVIEW/FIX PROCESS. Read this
  BEFORE running or closing any review round — it changes when a packet ships.**
  Six standing rules: a **SEVERITY GATE** (Critical/High = security, data loss,
  privacy, money, broken core flows; everything else is Low) where a packet ships
  on **ZERO Critical/High in a round** and a Low finding **never buys another
  round** · **diff-only re-reviews** · a **regression test with every
  Critical/High fix** · a **test audit** (break what each test claims to check;
  tests that stay green are liars) · **permanent guards** for recurring bug
  classes · **minimal fix diffs**. **Escape hatch: two consecutive rounds with
  Criticals in the same subsystem ⇒ stop patching, flag to Kd, that subsystem gets
  a REDESIGN.** Findings are listed and approved BEFORE any code changes, fix
  rounds included. **Supersedes the two-round cap (:2866) as the stopping
  condition** — rounds now end on an outcome, not a count — and **supersedes the
  VISIBLE/NOT-VISIBLE axis of :5307/:2365**, replacing it with Critical/High vs
  Low. **NOTHING IS RELAXED: every finding is still FIXED before the packet
  closes, whatever its severity** — Kd corrected a draft of the entry that said
  otherwise, and the correction is recorded inside it. **`OWED.md` is UNCHANGED**
  and stays the authority for every deferral; `BACKLOG.md` is a LOG of Low
  findings and their fixes, never a second deferral list.
- **:2365** — 2026-07-29 — **THE STOPPING RULE** (per-card, XP display): a
  finding blocks a 🔴 tick only if a user could see it on screen. Everything
  else is fixed but holds nothing. Precedent: PostWorkout, :1678.
  **⚠️ SUPERSEDED ON SCOPE by :5307 and ON AXIS by :5348 — read both first.** Its closing paragraph
  ("does NOT apply to any OTHER card … never a general licence to stop
  reviewing") no longer holds: **Kd ruled the stopping rule STANDING on
  2026-08-06.** Everything else in :2365 stands, including the VISIBLE /
  NOT-VISIBLE tagging requirement. Its security/data-loss exception is a KD
  RULING at :5258 and binds.
- **:5307** — 2026-08-06 — **KD RULING: THE STOPPING RULE IS STANDING, not
  per-card.** **⚠️ SUPERSEDED ON AXIS THE SAME DAY by :5348 — read that first.**
  Its VISIBLE/NOT-VISIBLE test is replaced by Critical/High vs Low. **Its
  "everything found is still FIXED" half STANDS, word for word** — Kd said so
  explicitly when correcting a draft that had it reversed. Settles the question
  :5258 opened. Applies to EVERY card
  automatically; a finding blocks completion only if a user could see it, EXCEPT
  security and data-loss findings (:5258), which block regardless.
  **EVERYTHING FOUND IS STILL FIXED before the card closes, whatever its
  severity — the rule governs TICKING, never fixing.** Supersedes :2365 ON SCOPE
  ONLY. The case AGAINST is recorded in the entry and Kd was shown it before
  ruling: :2365 was per-card because it answered ONE card's measured
  fact-pattern (eleven rounds of diminishing returns), and generalising hands
  that leniency to cards that have not earned it — bounded by the fact that a
  non-visible finding is still fixed, so what generalising costs is the right to
  hold a card OPEN over one. **What limits review effort is the two-round cap
  (:2866), not this.** **The lesson: four cards applied a per-card ruling as
  standing, and the chat that noticed had written it into two review prompts
  itself — it surfaced only because Kd asked an operator question about the
  PROCESS. A rule nobody re-reads becomes whatever chats have been doing
  with it.**
- **:5258** — 2026-08-06 — **KD RULING amending the stopping rule, and the drift
  it exposed. This BINDS.** Kd first declined authorship, then reversed it
  deliberately — "if other chats give more importance to my rule then write as my
  rule" — having been told that a Kd ruling overrides a chat's fresh judgment and
  may not be re-litigated on a chat's opinion. The wording is a chat's draft; the
  RULING is his. **The ruling:
  security and data-loss findings block a 🔴 tick REGARDLESS of visibility** — a
  cross-account leak or a silently dropped write is invisible to its victim by
  construction, so visibility is the wrong test for those two classes; the cap
  does not close a card over one. Written BEFORE the workout-loop card because
  that is the first card since the rule existed to touch other people's data.
  **The drift is the larger finding and is NOT settled**: the per-card rule has
  been used as standing for four cards, written into both exercise-library
  review prompts by the chat that then closed the card. **Cost so far, measured:
  nothing** — every finding was fixed or given an OWED line; the rule only ever
  decided TICKING. Record-integrity failure, not a quality hole.
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
  fact-pattern — **the CAP is SUPERSEDED by :5348 (2026-08-06): a packet now ships
  on ZERO Critical/High findings in a round, not on a round count. Everything else
  in this entry stands.** **The DPDP Day-14 worker must be live before the first
  real SIGNUP, not merely before the first deploy.**
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
- ~~**:5258** — OPEN: is the STOPPING RULE standing or per-card?~~ **CLOSED
  2026-08-06 by Kd's ruling at :5307 — STANDING.** Left struck rather than
  deleted: it was open for less than a day, and the useful part is that it
  existed at all. Cards no longer record an apology for citing :2365.
- **:11181** — 2026-08-19 — **OPEN: THE 5-DAY CONSUMER FREE TRIAL Kd's product
  plan describes — which `05-part5-billing.md:292-293` forbids by name
  ("Consumer trials: none — permanent free tier is the funnel") and v1
  §9.1:626-629 argues against on conversion grounds.** He asked how to stop
  someone farming it with a second email and then moved on without ruling.
  **Recommendation on record: DROP the trial — the attack exists only because
  the trial does; if kept, only a CARD before the trial starts holds** (email
  and device checks are free to defeat). **Open WITH it: whether badges and
  progress move behind that trial** — they are free forever today (v1 §9.1:611,
  and ungated in code), so moving them is a REMOVAL needing an explicit ruling.
  Check before proposing any paywall, trial, entitlements or seed change.
- **:11534** — 2026-08-19 — **OPEN: WHERE THE FOLLOW-ALONG REFERENCE FOOTAGE
  COMES FROM.** Three options priced and put to Kd — film a real person ·
  motion-capture an expert clip onto a rigged 3D model (**possible; his
  proposal, and the correction that generation ≠ mocap is his**) · buy a
  ready-made mocap pack. **Recommended: prove the mocap route on ONE exercise
  (squat) before committing to 58.** He asked and did not choose.
  **AI-generated video is answered NO for demonstrations, YES for marketing.**
  Detail at the §4 line. **The card must NOT be blocked on this** (:9452 — one
  placeholder proves the mode, 112 GIFs ship today).

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

- **:14840** — 2026-08-22 — **T3 ROUND 1 ON THE STAFF SCREEN: TWO Critical/High,
  and the packet did NOT ship this round.** Reviews :14570 and :14745. **Read
  before writing any role hint, before shipping a control whose Cancel is not
  tested, before pointing a mutant's FILTER at a test, and before calling a card
  done because its smoke passed.** Escape hatch **NOT armed** and the reviewer
  reasoned it out unprompted: :14493's Critical/High was in `orgs/repo.ts`, both of
  these are in `apps/web`, and :13336 judges the subsystem at file granularity.
  **C/H-1: the trainer hint is TRUE FOR A GYM AND FALSE FOR A STUDIO** — "can see
  your member list" to everybody, while `listOrgMembers` 403s any trainer whose org
  is not a `gym` (§2.3 group scoping, unbuilt), and Studio is offered in the create
  wizard; **the file's own rule "THE HINTS NAME ONLY WHAT IS BUILT" is what it
  broke**, and `Members.jsx` already branched on that error code one component
  away. Now `staffRoleChoices(orgType)`, an unknown type taking the REFUSING side,
  and the studio sentence NAMES the limit rather than omitting it. **C/H-2: the
  middle Cancel was covered by nothing, in the control :14745 had just written** —
  pointed at `onRemove(true)` it ends a membership, and all 195 console tests
  stayed green; **that commit's "Cancel is honoured at every stage" was true of the
  code and false of the coverage.** **THE FIX ROUND'S OWN FINDING IS THE ONE TO
  READ: my guard for C/H-1 SURVIVED because of its FILTER** — dropping `orgType`
  makes every org read the STUDIO sentence, so the studio test still passes and the
  GYM test is the one that fails; **:11846's two-halves lesson (anchor says what
  breaks, filter says what should notice), second recorded occurrence of the filter
  half, incurred by the chat quoting it.** Five Low, all fixed: the four staff
  endpoints were the only unparsed reads on the client (delete `readThrough`, 223
  tests green) · **`if (!allowed) return null` is S11's SIBLING**, left
  unfalsifiable beside the guard the previous round made observable ·
  `staffCountLabel([])` said "0 people run this gym" · `Try again` offered over a
  permanent 403 and over the half-done removal it cannot finish · a 1–2 character
  email printed `email: too_small` verbatim. **Two instrument failures of mine,
  both caught before anything ran: a real line break inside a mutant string made
  the harness a SyntaxError TWICE** (:13336's `node --check` guard working;
  :9111's `String.fromCharCode` fix applied on the third try), **and the anchor
  needed two lines at all because `onClick={() => setStage(null)}` appears TWICE
  in the file** — :14493's double-match hazard, still undetectable by the
  pre-check. **A test of mine asserted the WORDS rather than the PROMISE** (it
  banned a substring the honest copy contains in order to deny it) — a ban would
  have forced vaguer wording to satisfy a test. **THE GATE FINDING, correcting
  three documents of mine: THE SMOKE DOES NOT CARRY THE SHIPPING BYTES** — Kd
  passed 12/12 on `971836d`'s two-tap removal and `ba7bd13` rewrote that control
  and its sheet steps afterwards, so :14745, `HANDOFF.md` and that commit are all
  wrong to say T3 is the only gate (:10959, :11616, :3917). **PROVE: web 1044/1044
  exit 0 (+15) · build ✓ · eslint clean on six files · 50 mutants · 50 RED · 0
  ALIVE · 0 never ran, exit 0**, with the S15-survived run NOT summed into it
  (:5199). New guards S13/S14/S15. **NOTHING TICKS — TWO gates outstanding: the
  re-smoke of steps 9 and 11, and a diff-only re-review.**

- **:14745** — 2026-08-22 — **KD'S SMOKE ON THE STAFF SCREEN: PASSED 12/12 — and
  it produced a FIX and an AMENDMENT to his own permission ruling.** **Read before
  touching `RemoveControl` in `StaffPanel.jsx`, before designing the per-staff
  privilege card, and before quoting :11429 as the settled permission model.**
  Kd's REPORT (:4829) on `971836d`, his own gym and his own second account.
  **What only a browser could settle: the two CORS-preflight methods work** —
  `PATCH` and `DELETE` on `…/staff/:userId`, which `fastify.inject` cannot
  exercise and which Card 4 proved can be dead app-wide behind a green suite — and
  the join code's count read **1** before and after an appointment on live data,
  :14401's C/H-1 holding outside a fixture. **STEP 8 TOOK A SECOND ASK AND THE
  METHOD IS THE POINT: a global "all passed" does not cover a step whose
  prerequisite is in doubt** (it needed the helper account's password); written
  down as UNESTABLISHED, and naming the doubt is what produced the evidence.
  **FINDING 1 — THE CONFIRMATION, AND MY PUSH-BACK WAS WRONG.** Choosing an
  outcome used to DO it. The control did ask — but **a menu of two long
  descriptive options reads as CHOOSING, not as a last chance, while the Members
  screen one tab away asks the same act as "Remove? / Keep"**, so the defect was
  one act asking two different ways on two screens, not a missing tap. My first
  answer leaned on :13920 ("only irreversible things ask first"); he reaffirmed
  and is right, because **the destructive arm of this control IS the act Members
  already guards.** Now three stages, the last naming the OUTCOME rather than the
  button pressed (a confirmation that does not repeat the choice back is a rubber
  stamp), and Cancel at the last tap changes nothing. **THE TEST THAT WOULD HAVE
  CAUGHT IT DID NOT EXIST — every removal test CLICKED THROUGH the question**, so
  "picking an outcome acts immediately" was asserted neither way; **a mutation
  harness can only delete a guard that EXISTS**, which is why a person at a screen
  found it (third time on this branch: :12832, :12660). Permanent guard **S12**.
  **FINDING 2 — KD AMENDS :11429: CUSTOM ROLE NAMES *AND* PER-STAFF TICKS, BOTH**
  (*"now want custom role names instead of ticks. want both"*), overruling his own
  rejection of a fourth role in the additive direction. **It is ONE feature and a
  label: no route checks a role NAME** (:11891's seam, :14262's `staff.manage`
  tick), **so a custom role is a NAMED PRESET OF TICKS** — ticks are the
  substance, the three built-ins become presets, and a card building names before
  ticks reinvents an enforcement model that exists. **Measured cost:**
  `gym_staff.role` is `text` under `CHECK role IN ('owner','manager','trainer')`
  (`tenancy.ts:213,218`), so a SECOND migration on top of the ticks' own; §2.2 is
  a fixed three-role matrix, so an ADDITION with no governing § (:9809's class).
  :11429's six safety rules all still bind, **rule 2 more than before** (a custom
  role is a new way to hand somebody an incomplete set). **THE QUESTION IT MAKES
  LIVE, RECORDED NOT DECIDED: :11429 stores the effective set as a SNAPSHOT, but a
  NAMED role invites the opposite expectation** — edit "Front Desk" and an owner
  expects everyone on it to change; snapshot-plus-a-visible-name is a
  contradiction a user can SEE. Own `OWED.md` line; the per-staff card must put it
  to Kd (R0.2). **PROVE (the fix only): settings 30/30 · web 1029/1029 exit 0 ·
  sweep 47 mutants · 47 RED · 0 ALIVE · 0 never ran, exit 0.** **The card's
  remaining gate is T3 — a passing smoke is not a review.**

- **:14570** — 2026-08-22 — **THE STAFF SCREEN: a gym owner can hand over the
  keys, and the console gets its SETTINGS tab.** Web half of :14262/:14401/:14493;
  no API change, no migration. **Read before touching the console's Settings
  screen, `staffView.js`, `StaffPanel.jsx`, `ConsoleLayout`'s nav list or
  `useConsoleOrg` — before moving the join codes onto Settings — and before
  quoting a mutation verdict on a component the screen above it may never mount.**
  **THE CARD WAS RECOVERED, NOT WRITTEN**: an interrupted session left it
  uncommitted and this one treated the tree as unverified (S5) — **which is what
  caught a REGRESSION inside it on the first command.** `Overview.jsx` had been
  gated so the join-code pane failed whenever the MEMBERS read did, printing
  *"Couldn't reach the server"* over a code that loaded perfectly (a fulfilled
  outcome has no `reason`, so `errorText` takes the OFFLINE branch) while L-4's
  duplicate-suppression hid the one true card; **two tests went red naming the two
  guarantees it broke**, and it is reverted. **Standing shape: an interrupted
  session's working tree is a CLAIM about finished work, not a state of it.**
  **KD RULING — removing staff ASKS about the membership too** (*"suppose owner
  fires a staff should he be still a member after that?"*): both outcomes offered,
  **neither preselected**, keys always first because `removeMember` refuses anybody
  still staff; the half-done state is REPORTED (not a clean failure, not silence)
  and names the Members screen, with the instruction unconditional and the server's
  reason appended, since a dropped connection has no sentence of its own.
  **THE SENTENCE :14262 SAID THIS HALF OWED IS NOT THE ONE THAT SHIPPED** — the
  join-code count no longer moves when somebody is promoted, because :14401's C/H-1
  removed the `complimentary` write, so printing the promised sentence would be
  :5807's class **arriving through a stale note in the record rather than through
  code**; struck in place, mutant S4, and the smoke checks the number holds.
  Decisions not to re-derive: **the Settings TAB is owner-only and widens by
  itself** (`canManageStaff`, so the day Settings grows a manager-usable section it
  is a different question rather than a forgotten one) · **hiding is not the
  enforcement** — typing the address is TOLD, never shown an empty list that reads
  as a gym nobody runs · **knowing the role costs the shell a second
  `/v1/orgs/mine`**, stated not hidden · **the owner's row carries the reason, not
  two dead buttons** · **trainer is the default** (smaller grant) · **`owner` is
  absent from the picker and the hints name only what is BUILT** · **codes are NOT
  moved** — §4.7 lists them here but :13920 put them on Overview, so Settings
  points at them. **THE AUDIT'S SURVIVOR IS THE PART TO READ: S11 was ALIVE
  because the guarantee had no OBSERVABLE SUBJECT** — `Settings.jsx` checks the
  role BEFORE mounting the panel, so the panel's own guard could never be caught
  failing and the protection sat entirely in a different file. Closed :14401's way,
  by mounting the component DIRECTLY **with a positive control in the same test**;
  **the anchor never moved, only what could notice it did** (:11846's usually
  unrecorded half). **And the first sweep's exit code was 1 while the background
  wrapper reported 0** — :5906/:9509's shape in a new disguise; the verdict came
  from the harness's log, never the notification. **PROVE: web 1028/1028 across 43
  files exit 0 · build ✓ · eslint clean on eleven files · sweep RE-RUN on the final
  bytes, 46 mutants · 46 RED · 0 ALIVE · 0 never ran, exit 0** (the first sweep's
  figures are not summed with it, :5199). **A NEW OWED LINE, found not fixed: a gym
  cannot change its own name, city, timezone or currency after creation** —
  nineteen routes in the module and no `PATCH /v1/orgs/:gymId`; raised at :10606 in
  PROSE and tracked nowhere since, and timezone is what decides a gym's day
  boundary. **NOTHING TICKS — SMOKE (`RUNBOOK/smoke-staff.md`, 12 steps) and T3
  both UNRUN**; its steps 7 and 9 are the PATCH/DELETE preflights `fastify.inject`
  cannot see.

- **:14493** — 2026-08-22 — **T3 ROUND 2 ON THE STAFF CARD: the three fixes HOLD
  (zero behavioural defects), the escape hatch ARMED, and KD RULED PATCH.**
  Diff-only re-review of `445f406`. **Read before deleting a `gym_id` from any
  predicate in the orgs repo, before adding a THIRD reader of `gym_staff`, and
  before quoting the escape hatch as a rule that fires by itself.** **KD RULING:
  *"keep patching, don't redesign"*** — :5348's hatch armed mechanically (two
  consecutive rounds with a Critical/High in orgs) and Kd was given the
  distinction that decides it: **round 1 found three things the app DID WRONG;
  round 2 found none, its Critical/High being missing COVERAGE on correct code.**
  Third use of the hatch, third PATCH ruling (:6277, :9509) — **the hatch counts
  ROUNDS and Kd rules on what the rounds FOUND.** **C/H-1: round 1's own fixes
  added THREE `gym_id` predicates and not one had a test** — delete any and 88
  tests stayed green; **verified independently by hand-mutating `claimSeat` and
  running the suite** (88/88 green, restored sha256-verified) rather than taken on
  the reviewer's word. Costs if they regress: staff anywhere frees a seat
  everywhere (money) · an ex-member of A keeps A's roster via a membership at B
  (**C/H-3 reopened sideways**) · §4.7's invited manager is DENIED at the gym that
  invited them. Closed with two cross-gym tests + **O88/O89/O90**. **Low-2 is the
  lesson: round 1's fix made a SECOND reader false** — `getStaffRole` learned to
  refuse an ex-member and `listStaff` did not, so the list returned
  `"role":"manager"` for a deleted account with null authority; **the row was TRUE
  before the fix.** Latent only because no Staff screen exists (grep-verified).
  Both readers now spell the test out — **duplicated deliberately, a shared `sql`
  fragment being R3.8's forbidden shape** — anchored by a test driving BOTH
  (:14013's precedent). **O91.** **Low-1: two titles promised "puts their seat
  back" and no body checked it** (round 1 deleted the assertions that stood in);
  one trimmed, one now tested against the cap itself. **INSTRUMENT, fourth time on
  this card and my fix moved the anchor every time:** the pre-check ABORTED on
  O72's drift — **and exposed one it CANNOT catch, since `listStaff` now holds the
  same SQL text as `getStaffRole`, so O85/O86's one-line anchors matched in BOTH
  places and hit the right one only BY POSITION** (:11846's O14). Re-anchored on
  the parameter line the sibling lacks. **A pre-check that asks "does this match?"
  cannot ask "does this match ONCE" — worth fixing in the harness.** PROVE:
  **91/91 alone, exit 0** (+3) · tsc + eslint clean · **21 mutants · 21 RED · 0
  ALIVE**, controls green first, exit read into a variable. Full api suite still
  not quoted green (`catalog.seed`'s race, own line). **The remaining gate is not
  a review: there is STILL NO SCREEN, so no smoke. The web half carries it.**

- **:14401** — 2026-08-22 — **T3 ROUND 1 ON THE STAFF CARD: THREE Critical/High,
  all fixed — and the reviewer's own one-liner was WRONG, measured.** Reviews
  :14262; **the packet did NOT ship this round.** Escape hatch NOT armed (:14174
  found zero, so this is the first in the subsystem). **Read before writing
  `gym_members.complimentary`, before adding a reader of `gym_staff`, before
  requiring a membership anywhere AUTHORITY is decided, and before trusting that
  a staff row means what it says.** **C/H-1: I overloaded a flag and checked ONE
  of its THREE readers** — `complimentary` means "did not JOIN", not "unpaid
  seat", so an appointment made the console print "Nobody has joined yet" over a
  gym with 2 members, gave a `max_uses:1` code another place, and moved
  `orgCodeSchema.joined`; :14262 anticipated the third and called it "TRUE before
  and after", which was true of the reader it looked at. Fixed by excluding staff
  in `claimSeat`'s COUNT and writing the flag nowhere — **a departure from §4.2's
  prose recorded rather than slipped past (R0.1); the RULING is Kd's, only the
  mechanism moved.** **C/H-2: appointing raced remove-from-members 12/12** —
  `addStaff` read membership, `removeMember` read `gym_staff`, neither locked, and
  the pair commits a staff row over a CLOSED membership (`members.read` over a gym
  you are not in); both now take `lockOrgRow` first. :14174's rule was cited
  correctly in the original and **the ENUMERATION was short** — it considered only
  two concurrent appointments. **C/H-3: delete your account, restore it, keep the
  keys** (Day-0 closes `gym_members`, leaves `gym_staff`, and restore does not
  reopen a membership — 2026-07-11 P2.2 T3 F4); :14262 filed it as a "tombstone"
  under R1.1 and **that under-called live authority as cosmetic.** **THE
  REVIEWER'S FIX FOR IT — "require a live membership in `getStaffRole`" — TURNED
  FIVE EXISTING TESTS RED, and reading them is the finding: STAFF WHO ARE NOT
  MEMBERS IS THE SPEC'S OWN MODEL** (§4.7 invites by email), so that rule would
  break the day this card's own deferral closes. **The rule shipped is "not an
  EX-member", not "must be a member"** — denied only on a CLOSED membership with
  no live one, plus `users.status`, plus an owner exemption for
  `owner_included_as_member`. :13552 earned again: **a reviewer's fix is a claim.**
  **The audit found two more, both mine: O86 SURVIVED** (every arm of my ghost
  test denied on the closed membership, so the status check had no subject —
  :5104 F5 inside the fix's own test), closed with a staff row that never had a
  membership; **and O3 SURVIVED as a FACT about the fix** — the owner is now
  excluded twice, so both halves of that mutant moved (:11846) and it is pinned by
  a comped member who is not staff. **Rule 4, his finding against me:** the
  last-owner test had ONE staff row and could not tell "count owners" from "count
  staff" — now two rows, and **O87** keeps it. **PROVE: `orgs.routes.test.ts`
  88/88 alone, exit 0** (+12) · tsc + eslint clean · **17 mutants · 17 RED · 0
  ALIVE**, controls green first, `node --check` first, **the whole-table pre-check
  ABORTED attempt 1** on O3's drifted anchor. **The full api suite is NOT quoted
  green:** two consecutive full runs failed `catalog.seed.test.ts`'s global-count
  assertions (1/1 alone) — the pre-existing shared-`seed()` race, **and this round
  plausibly makes it fire MORE often by lengthening the orgs file, which is said
  rather than shrugged off.** **Also measured: through corepack,
  `test:local -- <file>` does NOT scope — pnpm eats the `--`. Use
  `test:local <file>`.**

- **:14262** — 2026-08-22 — **A GYM CAN FINALLY HAVE MORE THAN ONE PERSON
  RUNNING IT (server half), and KD RULED STAFF SEATS FREE.** **Read before
  touching the staff surface, before adding a role to
  `staffAssignableRoleSchema`, before letting ANY route look a user up by EMAIL,
  and before writing `complimentary`.** Part 3 §4.7's Staff list/add/change-role/
  remove behind §2.2's owner-only row. **NO MIGRATION** — :11429's seam, built at
  :11891, is what makes it one privilege plus one defaults row, and the per-staff
  TICKS are still unbuilt with their `OWED.md` line unchanged. **THE HOLE,
  MEASURED: the only `INSERT INTO gym_staff` in the product was the owner's own,
  hard-coded inside `createOrgAttempt`** — so two of the CHECK's three roles had
  been unreachable since `0001_init`, and the join door was built around a front
  desk no gym could have. **KD RULING: *"yes staff seats free"*** — appointing
  sets `gym_members.complimentary`, removing clears it, the mechanism being the
  owner's own §4.0-step-6 seat reused rather than a new concept. **AND IT CHANGES
  NO ENTITLEMENT, VERIFIED NOT ASSUMED: `getCandidates` reads neither
  `complimentary` nor `gym_staff`** — perks come from MEMBERSHIP of a paying gym,
  so Kd's "off staff ⇒ no perks" reading was CORRECTED to him before he approved
  and letting somebody go is deliberately TWO taps (keys, then membership).
  Decisions not to re-derive: **the email lookup is scoped to this gym's live
  roster** because a global `users` lookup is an account-existence ORACLE — pinned
  by a test giving the route a REAL account from ANOTHER gym and asserting the
  error and message are IDENTICAL to a fictional one, both-404 being insufficient;
  **inviting somebody with no account is DEFERRED because `EmailSender` sends
  nothing** (:11385), own OWED line; **no second owners** — `manager|trainer` at
  the boundary and the owner's role refused at the row, so every owner is the LAST
  owner and `last_owner` is the only answer removal can give about one, own OWED
  line. **The lock is on REMOVAL alone (:14174's rule): counting owners then
  deleting one is check-then-act whose loser is a gym with ZERO owners nobody
  inside can repair, while `addStaff`'s race is settled by `ON CONFLICT DO
  NOTHING`; the guard is a COUNT, not "is this the owner", so it survives the day
  a second owner exists.** A second appointment REPORTS the role and never
  overwrites it (no silent demotion from a stale screen); a no-op role tap writes
  NO audit row. **Said rather than discovered later: promoting a member makes the
  number beside a join code FALL BY ONE** — it is live non-complimentary
  memberships (:14013), true both sides, and the web half owes that sentence.
  **Found and NOT fixed (R1.1): the DPDP Day-0 cascade leaves `gym_staff`
  untouched**, so a self-deleted staff member stays on this list as a tombstone —
  already on `privacy/tables.ts`'s recorded-not-ruled list. **My own oracle test
  was the first red and could NEVER have passed** (it compared whole bodies, which
  carry a per-request id) — the mirror of :5104 F5, caught only by running it.
  **NOTHING TICKS — THERE IS NO SCREEN** (:11846/:13803's shape); the web half is
  the next card and carries the SMOKE, T3 UNRUN.

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
- **:10010** — 2026-08-18 — **A GYM CAN EXIST AND PEOPLE CAN JOIN IT: the first
  org slice is built (API half only), and the entitlement resolver's
  "P3/gyms add the rest" gap is CLOSED.** **Read before touching
  `apps/api/src/modules/orgs`, before adding a field to the roster response,
  before quoting a seat cap, and before building the console's screens.** First
  card after Kd's product re-aim (:9604); he was offered the three missing rep
  counters or this and chose this, on `OWED.md`'s own ground that nothing else
  on the gym list works until a gym exists. Four routes — create · mine · join ·
  members. **NO MIGRATION** (Part 4 §3.2's four tables have existed since
  `0001_init` and no route had ever touched one) and **NO CONSOLE SCREEN**, so
  there is no smoke sheet and nothing for Kd to click; the screen is its own
  card and carries the SMOKE gate. **Create is ONE transaction doing §4.0 steps
  1/4/6 together** — org, owner staff row, first `Front Desk` code, owner's
  complimentary seat — all four or none. **The resolver gap is closed and
  PROVEN END TO END: the test reads `/v1/entitlements/me` BEFORE joining so the
  cache is genuinely populated with the free answer; without that first read the
  assertion passes on a cold cache and proves nothing** (:5543's fixture lesson,
  applied before the defect). **THE SEAT CHECK IS BUILT** — §4.2's `FOR UPDATE`
  on the ORG ROW not on a count, cap read off the gym's live subscription's plan
  over live NON-complimentary members — **and the deferral is narrower than
  "seats": a gym with NO subscription, which today is every gym, is uncapped.
  Own `OWED.md` line; do NOT close it with a default cap, the tier sizes are
  part of the unratified US pricing (:9944).** Five decisions not to re-derive:
  **a non-staff caller gets 404 not 403** (403 turns a uuid into an enumeration
  oracle — and a MEMBER asking for the roster gets 404 too, because membership
  is not staffing); **§4.2's "on unique_violation → idempotent success" is done
  with `ON CONFLICT` on the same partial index**, since a raised 23505 aborts
  the transaction, **and a repeat join deliberately does not increment `uses`**;
  **a trainer gets the full roster on a `gym` and 403 on a `studio`/`clinic`**
  because `gym_staff` has no group column and handing a clinic trainer every
  caseload is the wrong way to guess; **`currency_display` is not collected**
  (§4.0's wizard never asks, so the field would be invented — the `INR` default
  stands and is owed against the US market); **codes are normalised but
  look-alikes are NOT substituted**, since `0`/`O`/`1`/`I` are outside the
  alphabet and a wrong guess joins somebody to the wrong gym. **KD OVERRULED
  ONE OF THIS CARD'S OWN DEFERRALS WITHIN THE HOUR (:10099, same entry): the
  currency follows the gym's LOCATION and there is no default** — *"no inr
  defalut wil update according to location for now usa india candan and europe
  later"*. `country` is now REQUIRED on create, the SERVER derives the currency
  (a client-sent `currencyDisplay` is refused by the strict schema, tested),
  supported set is **US/IN/CA/GB + the 20 euro-area countries**, and an
  unsupported country is REFUSED rather than given a fallback — a fallback is
  how a gym in Sydney gets quoted in rupees. **The UK is on the POUND**: Europe
  is not one currency, and Poland/Sweden/Denmark/Switzerland/Norway are
  unsupported today for the same reason. Location is an explicit COUNTRY field,
  NOT derived from the timezone — that would be a guess, and the failure mode is
  a wrong currency in front of a paying customer. **The lesson worth carrying:
  the deferral this card wrote was defensible and still left every US gym set up
  in rupees; "tracked" is not the same as "harmless".** **The roster's
  shape IS §2.4** — identity, join date, group label, complimentary flag, and a
  test asserts the KEY SET exactly so a later field fails the suite instead of
  quietly widening what a gym can see. **Both concurrency tests drive TWO
  SEPARATE postgres clients on purpose: `buildApp` opens its pool at `max: 1`,
  so two `app.inject` calls are serialised by the CLIENT and would pass with the
  lock deleted** — a test that cannot fail. Seven `OWED.md` lines added; the
  console line is UPDATED, not ticked.
- **:12343** — 2026-08-20 — **THE JOIN DOOR GETS ITS TWO SCREENS — and KD'S OWN
  QUESTION ADDED A THIRD THING: a member can now be REMOVED, which NOTHING in
  the product could do.** **Read before touching
  `apps/web/src/components/gym`, the console's Members screen, `orgsApi.js`, or
  anything that ends a membership — and before writing any copy about a gym
  request expiring or being emailed.** Step 2 of the approved three-step split
  (:11846 is step 1, :12227 its review). A member types their code at
  **Settings → Gym** or at `/org/join?code=` (Part 6 §2's deep link, mirrored
  segment for segment so the QR and the web link are ONE path); the console
  grows a **Waiting to join** section above its roster with the count on the
  screen an owner lands on. **The endpoint had existed since :10010 with NO
  CALLER** — a gym could print a poster nobody could act on. **KD'S QUESTION IS
  WHY THE CARD GREW A SERVER HALF:** told that both buttons would ask "sure?"
  because a confirmed member could not be removed, he answered *"do you even
  have some common sense if someone joins once can not be rempved"* — and the
  measurement backed him: **the ONLY statement that had ever written
  `removed_at` was the DPDP Day-0 cascade** (a person deleting their own
  account). `DELETE /v1/orgs/:gymId/members/:userId` is in this card, the
  two-step confirmations went with it (both taps are reversible now), and §4.3's
  confirm sheet stays on REMOVE alone. **His second ruling — a removed member
  loses the gym's perks — was already true in the resolver; what this adds is the
  CACHE BUST, measured against a WARM cache because that is the only way the
  assertion can fail.** Four decisions not to re-derive: **Settings is where v1
  §8 puts the code box and NOTHING was added to the sidebar** (:11616's crossing
  stays shut); **the queue is a SECTION on Members, not a seventh tab** (§3.1
  fixes the nav at six, §4.3 gives Members the walk-in join); **the dashboard
  card reads TWO endpoints and the second is the point** — confirmed
  applications are absent from `/applications/mine` by design, so without
  `/orgs/mine` the waiting card would VANISH on success and the app would never
  say they got in, and one gym gets one row with member beating waiting beating
  refused; **STAFF cannot be removed through this door** (an owner is member #1
  of their own gym, no restore is built, §4.7's last-owner reasoning). **Part 3
  §2.4's "What {org} can see" sheet is a HARD requirement and is pinned as one** —
  generic before the server answers (a guessed gym name would be false), NAMED
  after; deleting it would break a written promise and nothing else in the repo
  would notice. **Copy may promise NO email, NO expiry and NO auto-confirm**, and
  a test asserts the words are absent. **THE AUDIT'S FINDING IS MINE TWICE IN AN
  HOUR: J11 survived, was re-aimed, and SURVIVED AGAIN — two guards each
  unfalsifiable because the other held** (:5104 F5's shape, in code written by a
  chat that had read :5104 that morning); fixed in the SOURCE so one line does
  the work. **Standing lesson: when a mutant survives, ask whether the guarantee
  is OBSERVABLE before assuming the test is missing.** PROVE: api **512/512**
  across 43 files on real Postgres · shared **48/48** · web **857/857** · build ✓
  · tsc clean · **lint = HEAD baseline, MEASURED** on the three big files ·
  **24 mutants · 24 RED · 0 ALIVE · 0 never ran** (`mutate-join-door.mjs`, no DB
  mutants per 4a) **and the server half's whole table re-run to completion, 47 ·
  47 RED · 0 ALIVE**, including O42–O47 for removal.
  **SMOKE PASSED 2026-08-20, all 17 steps** — step 14 (Remove) landed and is
  attested by `gym_members.removed_at` in the database, not only by the screen.
  **STEP 7's reported failure was the SHEET's fault**: it promised "the name of
  the code" and Kd hunted for the six typed characters instead of the code's
  LABEL (`Front Desk`); the whole chain was verified before answering and the
  wording is fixed. **Standing lesson: a smoke sheet describes what a BEGINNER
  SEES, never what a field is for** — Part 0.5's K1–K8 applied to RUNBOOKs, which
  had never been held to that bar. **T3 ran — see :12518, which did NOT ship the
  packet.**
- **:12518** — 2026-08-20 — **THE JOIN DOOR STEP 2, T3 ROUND 1: TWO
  Critical/High, one of them LIVE on Kd's own account. THE PACKET DID NOT SHIP
  THIS ROUND.** Reviews :12343. **Read before touching
  `listApplicationsForUser`, before adding a reader to the dashboard's gym card,
  before drawing ANY console control a role might be refused, and before
  assuming a component with tests is one anybody can reach.**
  **C/H-1: a REMOVED member was told the gym never confirmed them** — after
  reject → ask again → confirm → remove, the dashboard read "{gym} didn't
  confirm your request" with a Try again link while the database held a
  confirmation two minutes before the removal. It is the smoke sheet's own steps
  8 → 10 → 11 → 14, the documented happy path, and it was measured against the
  live database before being fixed. **The cause is two CORRECT decisions
  meeting**: `/applications/mine` excludes confirmed rows by design and
  `/orgs/mine` drops the gym on `removed_at`, so a stale refusal was the only
  surviving fact. **Fixed server-side because the client cannot see the
  confirmation** — a rejected/expired row is withheld when a LATER application
  for the same gym reached confirmed, **compared by TIMESTAMP and not by
  existence** (confirmed → removed → re-applied → refused must still show, or a
  genuinely turned-away person gets a blank screen; both directions carry a
  test). **C/H-2: a TRAINER was drawn a Remove button the server refuses** —
  §4.3 says "Trainer role: … Remove hidden" and `Members.jsx` consulted no role
  at all; **J11's shape, same screen, one component away, an hour after J11 was
  fixed**. `canRemoveMembers` is an ALLOW-list so a later role is refused by
  default; the 403 stays the enforcement. **LATENT IS NOT LOW** (:10182's
  precedent). **The standing lesson is about the CARD, not the code: a mutation
  sweep cannot find a MISSING guard, only delete an existing one** — the audit
  was scoped to what the card CHANGED while the defect lived in what it ASSUMED,
  which is what a fresh reader with the spec open is for. Six Lows, all fixed
  same round (`BACKLOG.md`); **L-1 is worth knowing — nothing asserted any of
  this card's components was REACHABLE**, so deleting the route or the dashboard
  card left 857 tests green while the feature vanished. Gates after the fixes:
  orgs **46/46**, web **867/867**, build ✓, tsc clean, lint measured at the HEAD
  baseline. **Escape hatch NOT armed** (:12227 found zero). **Diff-only
  re-review is the remaining gate.**
- **:12227** — 2026-08-19 — **THE JOIN DOOR STEP 1, T3 ROUND 1: ZERO
  Critical/High — THE PACKET SHIPS, and the finding with the longest reach is a
  guard that was testing a COPY of the thing it guards.** **Read before adding a
  route to the orgs module, before writing a cursor that compares against a
  subquery, before assuming a "requires authentication" test covers routes added
  after it, and before putting an explanation inside a `sql` template literal.**
  Reviews :11846. **Escape hatch NOT armed** (:10329 also found zero, so no
  two-round streak). Four Low, **ALL FIXED this round** (:5348 rule 1), plus one
  unnumbered security-pass item fixed with them; **rule 3 owes nothing — no
  Critical/High, so no fix owes a failing-first test.** **L-1: "every route
  requires authentication" named FIVE of NINE routes and none of the four this
  card added** — proven by deleting `app.authenticate` from confirm and watching
  it stay GREEN; **Low only because every handler calls `requireUserId`, so a
  missing guard is a 500 and not an open door.** **L-2: a well-formed cursor
  naming an unknown row BLANKED the queue while `pendingCount` reported the true
  total** — the scalar subquery yields no row, so the comparison is NULL not
  false; fixed with `NOT EXISTS`, semantics verified against the live database by
  both parties. **L-3: reject was not idempotent while confirm was** — TRUE
  message so not :5807's class, but an asymmetry nobody designed; fixed, and
  **every other terminal state keeps its 409** (`confirmed` must not be silently
  reversible). **L-4: the DPDP cascade is a THIRD writer and took the locks
  BACKWARDS** — `softDeleteUser` closed `gym_members` before cancelling
  applications while confirm goes application→gym, so the two could cycle into a
  40P01; **the cycle stays UNREPRODUCED and the PREMISE is what was verified**,
  fixed by swapping two statements. **THE UNNUMBERED ONE WITH THE LONGEST REACH:
  the permanent guard's check 5 asserted a HAND-WRITTEN COPY of the
  spend-attribution query instead of the real `getLiveGymId` in
  coach/geo/nutrition** — a guard that cannot see what it guards, **third
  occurrence of that class in two cards** (O14, :5104 F5); now calls all three
  REAL functions, **named individually** because R7.1 keeps them module-local,
  **with a positive control** so three null-returning functions cannot satisfy
  it. **THE REVIEWER WROTE THREE MUTANTS OF HIS OWN** rather than only re-running
  mine, which is what surfaced L-1 — **a reviewer who only re-runs the author's
  harness inherits the author's blind spots.** My own slip: a backtick inside a
  `sql` template literal ENDS it, turning a documented query into six parse
  errors. PROVE: orgs **59/59** · tsc + eslint clean · **O39/O40/O41 added to pin
  each fix, 8 mutants 8 RED** (subset, and the harness prints that it is one; the
  last COMPLETE run stands at :11846). **NOTHING TICKS — the owed line names a
  SCREEN; step 2 carries it with its smoke.**
- **:12111** — 2026-08-19 — **KD'S REVISED US TIERS RE-MEASURED: the money is
  comfortable and the ROUTING ALLOWANCE is the real ceiling.** **Read before
  ratifying any price, before quoting an API cost, before raising the route-plan
  allowance, and before promising running to a gym.** Continues :9944 with his
  amended numbers — **<500 $20 · 500-1000 $30 · 1000-1500 $35 · 1500-2000 $50**,
  **8 scans/day + 3 route plans/day**; tier 3 dropped $40→$35, the top tier is
  now BOUNDED (half of :9944's fix 2) **and that opened a NEW hole — nothing
  above 2000 has a price**, while exactly 1000/1500/2000 still fall in no tier.
  **MEASURED by re-querying `api_cost_events`, not quoted: identical to :9944 —
  18 scans, avg 1,763 max 2,120 µUSD; route_gen 0.** Worst scan × 8/day × 30 =
  **$0.51/member/month**; tiers absorb ~39/58/68/98 full-use members, i.e.
  **break-even is ~8% of a roster flat out every day**, remarkably flat across
  tiers. Realistic adoption on a 500-member gym: **~$6 against $30.**
  **AFFORDABILITY ANSWERED WITH SOURCES (V5): US gym software is $79-$229/mo**
  (Gymdesk ~$79, PushPress $159/$229, Wodify $179), so he is **3-8× under the
  category floor** — with the caveat that those products RUN the gym while this
  is a member perk, so their price is a ceiling to aim at rather than one he has
  earned. **THE FINDING IS NOT ABOUT MONEY: ONE ROUTE PLAN IS THREE CALLS** —
  `generateRoutes` loops `routeSeeds(input.count)`, one provider call and one
  ledger row each, `count` 1-5 **default 3**, so 3 plans/day is **9-15 external
  calls/day per member**. ORS bills a request COUNT against a daily allowance
  **shared APP-WIDE** whose size is **still UNVERIFIED** (the official
  restrictions page lists functional limits only; secondary sources say
  ~2,000/day, 40/min). **At ~2,000/day, roughly 130-220 active route users
  app-wide exhaust the whole product's routing — and it fails as a DEAD FEATURE,
  not a bill** (fail-closed 503, no mock fallback). **A scale ceiling that
  arrives regardless of price, reached at hundreds not thousands, moved 33%
  closer by the 2→3/day change, and tracked NOWHERE — `openrouteservice` appears
  0 times in `OWED.md`, grep-verified. It has a line now.** Recommended, not
  ruled: leave the prices · fix the bands to `1-499/500-999/1000-1499/1500-2499/
  2500+ contact us` · treat routing as CAPACITY (cache candidates · drop default
  `count` 3→1 — **the two free options, each ~3× the call rate** · paid plan ·
  self-host). **NOT RATIFIED**; :9944's consent split and one-US-lawyer step
  untouched and still owed; **the seeded PAID quota is `route_gen` 5/day, LOOSER
  than the 3/day he just proposed.**
- **:11846** — 2026-08-19 — **THE JOIN DOOR OPENS ON THE SERVER (step 1 of 3):
  typing a code now APPLIES, the front desk CONFIRMS, and a pending person is
  invisible to every reader of live membership.** **Read before touching
  `apps/api/src/modules/orgs`, before adding ANY route that checks a staff ROLE
  NAME, before adding a reader of `gym_members`, and before building the join
  screen or the console's confirm queue.** Implements :11072 ruling 2. **Kd
  approved a THREE-STEP split** (server → the two screens → the waiting room's
  clock) after being shown one card would be ~4× the diff that caused review
  spirals here before (:2158 applied in advance), then approved step 1. **NO
  SCREEN ⇒ NO SMOKE** (:10010/:10402's precedent) and `OWED.md`'s door line names
  a SCREEN, so it does NOT tick. **THE DECISION THAT SHAPED EVERYTHING: a
  SEPARATE TABLE, not a `status` column** — eleven places across six server files
  read `removed_at IS NULL` as "live member" (measured), so a column makes every
  one OPT-OUT and the missed one hands a stranger the gym's paid entitlements
  invisibly; the separate table leaves §4.1's and §4.2's canonical SQL **VERBATIM**
  (R4.5). :1239's class-not-case from the side where the class is CREATED.
  Migration `0011`, expand-only, `text`+CHECK not an enum, and its partial unique
  index deliberately mirrors `gym_members_live_uq`. **§4.2's seat-safe join MOVED
  INTACT into `claimSeat`, now reached by CONFIRM; apply takes NO org lock** (the
  lock serialises SEAT consumption and applying consumes nothing) and **lock order
  is decided once: application → gym.** Six decisions not to re-derive: **`uses`
  is not burned at apply** (else a leaked code shuts a gym's poster down) ·
  **confirm does NOT re-apply the code's paused/expired/exhausted refusals** (a
  human said yes; but the SEAT cap IS enforced — that one is money) · **a full gym
  leaves the application PENDING and names the number** (this reader is the gym) ·
  **consent is stamped on the application and COPIED to the membership** ·
  **the response is a discriminated union with NO `joined` arm** · **a rejected
  person is TOLD and may re-apply.** **THE PERMISSION SEAM IS IN (:11429): no
  route checks a role NAME any more**; `members.confirm` = owner+manager per
  §2.2's remove/restore row, and **Kd widened it in the same breath** — *"ok only
  owner and manager but if owner gives permission others can also add"* — the
  ticks having no storage yet (staff card, own line). **THREE THINGS IT DOES NOT
  DO: auto-confirm is unbuildable** (no roster table exists — measured; NOT
  stubbed per R1.3, which is why there is no `joined` arm), **so every applicant
  waits for a tap today**; **nothing expires** (14-day `expires_at` written, no
  reader — contradicts :11385 as written, deferred with a 🔴 line); the
  leaderboard opt-out is ⚪. **TWO RECORD CORRECTIONS, both mine:** the orgs
  repo's "ONLY file that touches" header **was already false** (DPDP closes
  `gym_members` inline in `users/repo.ts`; R7.1 forbids the cascade calling the
  repo) — corrected rather than breached twice; and the new table joins the
  **already-open Kd gap** in `privacy/tables.ts` beside `gym_members`, **Day-0
  handled, Day-14 open, to be ruled TOGETHER**. Join's rate-limit half of the owed
  line CLOSES at **10/hr per account, 120/hr per IP — the asymmetry is the point**
  (thirty members on one gym wi-fi on induction day). **FOUR INSTRUMENT FINDINGS,
  three mine: CRLF vs LF is :4267's class for the FIFTH time** and the first in an
  api harness (class fix PORTED from :10866 — convert the ANCHOR, never normalise
  the FILE) · my anchor checker **lied toward a false alarm** on `\n` · **ten of
  twenty-six mutants had drifted** and the whole-table pre-check caught every one
  before a byte was written · and **I masked the harness exit code with a `| tail`
  pipe**, :5906's recorded shape recurring in the session that cites it. One
  control abort was **transient** (a DB blip) and is recorded as such.
  **THE AUDIT IS THE PART WORTH READING — first sweep 35 mutants · 31 RED ·
  4 ALIVE · 0 never ran, and ALL FOUR survivors were coverage this card's own
  MOVE of the door had quietly stranded.** **O8+O17 are one finding:**
  `claimSeat`'s already-holds branch carries the T3 C/H-1 fix AND "a repeat does
  not burn a code use", and both lost coverage the moment the idempotent path
  began short-circuiting at APPLY — a fix whose protection cannot fail is the
  same defect with a comment on it (:5104 F5). **O14 had DRIFTED ONTO THE WRONG
  QUERY** (`LIMIT ${input.limit + 1}` now appears twice; a string replace takes
  the first) so a mutant named for the roster reported on the queue — **:11757
  L2's shape, one card later, written by the chat that recorded it.** **O6 was
  still aimed at the pre-ruling join** and is now split from O36. **AND THE TEST
  WRITTEN FOR O14 FOUND A LIVE BUG IN THE NEW PAGER: the confirm queue REPEATED
  the last row of every page.** Measured cause — Postgres stores `timestamptz` to
  the MICROSECOND (`now()` = `…467902`) and `toISOString()` carries MILLISECONDS
  (`…467`), so an ASC `>` cursor lets the boundary row back in; **fixed by
  carrying the row's ID and letting SQL read the true value back.** **The mirror
  image is LATENT IN THE ROSTER and NOT fixed here (R1.1, own 🟡 line): DESC + `<`
  EXCLUDES instead of repeating, so it can silently SKIP a member for ever — a
  duplicate is visible on page two, a gap never is**, which is the only reason
  this was found from the queue's side. Harness gained **`MUTATE_ONLY`** (:4855
  F6's flag, absent here until now): unknown label is FATAL and a subset run
  PRINTS that it is one. **THE FIX ROUND THEN REPRODUCED THE DEFECT IT WAS
  CLOSING: O8 and O17 came back ALIVE a SECOND time because the new test existed
  and passed while both rows still named the OLD test in their `expect` filter.**
  Standing lesson: **a mutant has TWO halves and a fix must move both** — the
  anchor says what breaks, the FILTER says what should notice — and this repo has
  recorded the anchor half four times (:5199, :8610, :10402, :10726) without ever
  naming the filter half. **AND THE SECOND FULL SWEEP FOUND A FIFTH SURVIVOR THE
  FIRST HAD PASSED — O7, anchor/mutation/named test ALL UNCHANGED between the two
  runs.** Its named test cannot reach the `ON CONFLICT` it guards, so the first
  RED cannot have come from the guarantee; the remaining explanation is a
  leftover membership in the SHARED test database — **:10182's C/H-3 one card
  later, in a MUTANT instead of a test.** **THE LESSON THIS CARD IS REALLY ABOUT:
  a verdict nobody can name a cause for is not evidence — four survivors were
  aimed at the wrong place and the fifth had been passing for a reason that was
  never true; a green sweep is a claim about the TESTS and is worth exactly what
  the aiming is worth.** Interim figures are deliberately NOT summed into a
  composite; only a completed sweep is quotable (:5199). PROVE: api **506/506**
  across all 43 files on real Postgres · shared **48/48** · web **806/806** ·
  tsc + eslint clean · migration applied and reviewed as SQL · **38 mutants ·
  38 RED · 0 ALIVE · 0 never ran**, 24 controls GREEN first, restores
  sha256-verified, tree clean after. **NOTHING TICKS — no screen, so no smoke;
  T3 UNRUN.**
- **:11757** — 2026-08-19 — **THE CROSSING PACKET, T3 ROUND 1: ZERO
  Critical/High — THE PACKET SHIPS, and the two findings with teeth are BOTH the
  author's own tests.** **Read before writing a render test whose subject is a
  CLICK, before selecting one of several identical controls by INDEX, and before
  quoting a "lint = HEAD baseline" line as if it discharged the DoD.** Escape
  hatch NOT armed. Eight Low, **all fixed** and in `BACKLOG.md` (:5348 rule 1 —
  the gate changes the SCHEDULE, never the quality bar). **L1: a test whose
  subject was a click, that never clicked** — it asserted two things true of a
  page nobody had touched, and the reviewer PROVED it by turning the wizard's
  sign-out into a real skip and watching it stay GREEN while only its sibling
  went red, on a claim the sibling does not make; **its own comment claimed it
  caught exactly that.** :5104 F5's shape, in a file written the same day by a
  chat that had just read :5104. **D17 — the reviewer's own mutant — is KEPT**,
  because a mutation-found hole closed without a mutant is the same hole with a
  comment on it. **L2: an `it.each` case that did not drive what its name said**
  (index selection meant D12 made "from the desktop rail" silently drive the
  PHONE BAR and pass) — no defect escaped, but a future red run would have named
  the wrong surface. **L8 is the only live failure mode and came from reading
  PAST the diff: `authApi` sets no global timeout** (verified;
  `nutritionApi`'s `TARGETS_TIMEOUT_MS` exists for this gap), so a server that
  ACCEPTS the logout and never answers leaves `await logout()` pending, its
  `finally` unreached — **on two screens where Sign out is the only control**.
  Fixed with a pending state AND `LOGOUT_TIMEOUT_MS`, following the per-request
  precedent rather than changing global config (R1.1). **L7 is the deferral rule
  catching the author in the act** — the "phone was a narrowed desktop window"
  fact lived in DECISIONS prose alone; own 🟡 `OWED.md` line. **L3/L4/L5 are
  three comments describing the deleted link**, corrected in place with the
  supersession dated. **L6: a true "HEAD baseline" is not a clean gate** — `Zap`
  and `Ruler` deleted, eslint now exits 0 with no output. **The useful half of
  his security pass: he ENUMERATED that all four console routes wrap in
  `ConsoleLayout` and that the phone bar renders with no `orgSlug`**, so nothing
  is stranded — proven by counting sites (:1239's only satisfying form). PROVE:
  web **806/806** · build ✓ · eslint clean on all six touched files ·
  **17 mutants · 17 RED · 0 ALIVE · 0 never ran**, control GREEN first, restores
  sha256-verified, exit read directly. **D12/D13/D14/D16 RE-ANCHORED** because
  the L8 fix inserted a line inside two functions their anchors span —
  :5199/:8610's class, caught by the whole-table pre-check ABORTING rather than
  by care. **THE OWED DOOR LINE TICKS HERE: smoke 11/11 (:11706) + a round with
  zero Critical/High is the full gate.**
- **:11706** — 2026-08-19 — **THE LOGIN-DOOR SMOKE PASSED 11/11 on `9aae571` —
  both removed shortcuts confirmed GONE in a real browser, and neither removal
  stranded anybody. NOTHING TICKS: T3 UNRUN.** **Read before citing the login
  door as verified, before quoting this pass as covering a PHONE, and before
  designing a smoke step around a browser control.** Kd's **REPORT**, not a
  measurement (:4829). Evidence for exactly one thing: **:11616's ruling holds in
  a browser** — the console offers Sign out at both widths and no way into the
  member app, the sidebar has no `My Gym` and is otherwise intact, and the
  questionnaire's new Sign out works; the "did it really end the session" half of
  steps 6 and 7 is checked with the browser BACK button, because landing on
  `/login` is satisfied by a plain link that leaves the session alive.
  **Steps 1–4 were CARRIED from `174fd71`, not re-typed** — their judgement is
  untouched, the screens they land ON are what changed, and steps 5–11 re-observe
  every one of those surfaces (the sheet carries the mapping table). Only
  REGISTERING an account is genuinely un-re-run, because account B survived
  un-onboarded, which is what step 7 needed. **An earlier draft of the sheet
  claimed a re-run it was never going to get and was corrected BEFORE he ran it
  (`9aae571`)**, rather than left to read as more coverage than it was.
  **THREE THINGS THIS SITTING DID NOT ESTABLISH, stated rather than glossed: the
  "phone" was a NARROWED DESKTOP WINDOW** (D14 is what actually guards the phone
  bar, and :9604 §4's surface is a real handset); **the BACK-button checks rest
  entirely on his report**, since nothing is stored and there are no rows to
  corroborate them as at :9328/:7929; and **no step observed a SECOND person on
  the shared browser** — step 11 proves the door is forgotten, not that the
  previous account's data is unreachable (older ground: :10866, :618 T3 F1).
- **:11616** — 2026-08-19 — **KD RULES THE CROSSING SHUT IN BOTH DIRECTIONS: the
  login page's two doors are the ONLY way between the member app and the gym
  console — and the ruling exposed TWO screens with no way out at all.**
  **Read before adding ANY link between the member app and the console, before
  touching `ConsoleLayout`, the member `Sidebar`'s nav list, or the onboarding
  wizard's header, and before restoring a shortcut a later chat finds missing.**
  The console's **"Back to the app"** and the sidebar's **`My Gym`** are both
  REMOVED; **Sign out** replaces the first. **SUPERSEDES :10866's "the `My Gym`
  sidebar entry STAYS and this is the citation"**; everything else in :10866 and
  :10959 stands. The no-removal rule's AUTHORISED path — explicit Kd ruling
  against a cited cost (:10182's clinics precedent, second use). **The record
  already agreed with him: :10824 called that item "a TEMPORARY door" whose
  defect was "that it shipped without being labelled temporary"**, and :10866's
  contrary reasoning (an owner inside the app needs a way across without signing
  out) is what he overruled. **THE COST HE WAS GIVEN BEFORE RULING CHANGED THE
  SHAPE OF THE FIX: `ConsoleLayout` had NO sign-out at all** — its own comment
  said the removed link was "the only way back out of the console on a phone" —
  so the removal alone would have LOCKED an owner in; the recommendation put to
  him was the OPPOSITE of his ruling and he reaffirmed. **THE THIRD SCREEN IS THE
  FINDING AND KD FOUND IT BY USING THE PRODUCT, on his FIRST smoke step: the
  onboarding questionnaire has no sidebar, no skip and had no sign-out**, so
  anyone who signs up or picks the wrong door was stuck on a five-step form with
  no exit but finishing it — untracked until a beginner hit it in a browser
  (:5543/:6062's shape). Sign out added there too, and it matters MORE now that
  `My Gym` is gone; **it is NOT a skip** — the onboarding gate is untouched,
  pinned by a test. Three decisions not to re-derive: **restoring EITHER shortcut
  alone is worse than restoring neither** (a one-way crossing is the "works
  sometimes" door `landingRoute` exists to prevent — hence one test file for both
  halves); **the console draws TWO exits and the COUNT is the assertion** (rail +
  phone bar, one CSS-hidden at any width, and the phone is the surface :9604 §4
  asked for); **`logout()` already clears the door choice**, so the console's
  Sign out inherits the shared-browser guarantee rather than re-implementing it.
  **D15 restores `My Gym` with a still-imported icon on purpose** — naming the
  removed `Building2` would go RED on a `ReferenceError` rather than on the
  guarantee (:4718 F2 designed around, not incurred). PROVE: web **806/806**
  (+9) · build ✓ · **lint = HEAD baseline, MEASURED** (`Zap`/`Ruler` already
  unused at HEAD; the newly-unused `Building2` import removed rather than left) ·
  **16 mutants · 16 RED · 0 ALIVE · 0 never ran** (D12–D16, three new targets),
  control GREEN on all sixteen filters first, restores sha256-verified, exit code
  read directly (:9509), tree clean after. **NOTHING TICKS — the smoke sheet is
  REWRITTEN A SECOND TIME** (old steps 5 and 9 tested the removed links; new
  steps 5–8 assert their ABSENCE plus both new Sign outs and a browser-BACK check
  that the session really ended), **steps 1–4 re-run rather than carried** because
  the screens they land on are exactly what changed; **T3 unrun.**
- **:11534** — 2026-08-19 — **THE FOLLOW-ALONG FOOTAGE QUESTION ANSWERED:
  MOCAP ONTO A RIGGED MODEL IS POSSIBLE — and Kd's own correction is the line
  to carry.** **Read before sourcing exercise footage, before proposing
  AI-generated demonstrations, and before letting artwork block the
  follow-along card.** Answers what :9452 left open and `OWED.md` names as
  **Kd's to give (R0.2) — an ANSWER, not a ruling; nothing is chosen.**
  **THE CORRECTION: generation INVENTS motion, mocap COPIES a real body's**, so
  ":5807 — a demo that is subtly wrong teaches wrong form" kills AI video and
  **largely dissolves for mocap**; a chat reading only the AI-video paragraph
  inherits the wrong conclusion. **Pipeline:** clip → extraction (Rokoko Vision
  · DeepMotion · BlendCap add-on) → rigged humanoid (Mixamo, terms UNVERIFIED)
  → Blender retarget → smoothing/foot-lock → render. **The Blender half is
  scriptable and headless; the first half is KD'S — browser uploads, and a chat
  can neither watch a video nor judge the result.** **Cost that survives:**
  single-camera depth is inferred (**side-on squats favourable, twisting
  movements bad**), feet slide and joints jitter, 58 exercises is 58 clips, and
  motion taken from someone else's video is unsettled ground — **his own clips
  already exist** (`Desktop\traces`, :6959). **THE ARGUMENT FOR THE 3D ROUTE,
  under-sold at first: ONE capture renders the same rep FRONT and SIDE at any
  resolution**, permanently fixing the GIFs' measured size problem (600×600 at
  best, 220×119 jump squat), with no model release and no re-shoot.
  **AI video generation is a NO for demos** (plausible-not-real motion, ~5–10 s,
  no character consistency, no clean loop, free tiers watermark or bar
  commercial use) **and a YES for MARKETING** — recorded so the tool is not
  banned outright. **Recommended not ruled: prove it on ONE exercise (squat)
  before committing to 58.** Measured: **Blender is NOT installed here.** Film-a-
  real-person and buy-a-mocap-pack stay on the table. **:9452's rule stands —
  artwork must not block the card; one placeholder proves the mode.**
- **:11429** — 2026-08-19 — **KD RULES THE STAFF PERMISSION MODEL: the three
  roles STAY and per-staff PRIVILEGE TICKS go on top — "AND", not "OR".**
  **Read before building staff management, before adding ANY route that checks
  a role NAME, before touching `requireStaff`, and before designing the Staff
  screen.** `owner|manager|trainer` and the CHECK constraint are untouched; the
  ROLE picks the starting ticks and **the TICKS are what the server enforces**.
  **Timing measured: the whole permission seam is ONE function and TWO call
  sites today** (`orgs/service.ts:219`, called at `:244` and `:296`), so the
  conversion is cheap now and a dozen-route migration later — **a new route
  checking a role NAME re-opens it.** Catalogue = §2.2's rows (privacy its own
  tick) + **confirm a join application** (:11072/:11385) + **roster import**
  (:9809/:9870). **Six safety rules, and rule 2 CLOSES A HOLE THIS RULING
  OPENS: §4.7 blocks last-owner REMOVAL, and ticking away the last owner's
  billing/staff-management is the same lockout by another door** — also: only
  an owner may change ticks · ticks may widen, not just narrow · UI hides but
  the SERVER enforces (a greyed control over a live route is the named defect)
  · every change audit-logged · **a tick is not a SCOPE** (trainer
  assigned/group-only is the group axis, still blocked on `gym_staff` having no
  group column — conflating them hands a trainer the whole roster). **K4 calls
  to ratify not re-derive: store the EFFECTIVE set as a SNAPSHOT** (a template
  edit must not silently widen ten people's access; cost — default changes do
  not retro-apply), table-vs-JSONB decided at the card against R4.2, and a
  migration is required (`gym_staff` stores no privileges). **An ADDITION with
  no governing § — §2.2 is a FIXED three-role matrix** (:9809's class).
  **Industry checked by web search (V5): both patterns ship — fixed roles
  (PushPress) and per-person/group permissions (Mindbody groups, Zen Planner
  privileges); Kd took both halves.** The rejected FOURTH front-desk role is
  recorded with its reason (it guards a till we do not have; ticks make it
  unnecessary). Nothing built.
- **:11385** — 2026-08-19 — **KD RULES THE WAITING ROOM: a pending application
  EXPIRES, the gym gets REMINDED, and the waiting member can NUDGE.** **Read
  before building the join/apply door, the confirm queue, or any notification on
  either side.** **AMENDS :11132 — its "leaked-code stranger waits forever, by
  design" row is RETIRED**: the stranger still never gets in, but the ROW dies,
  and re-applying is free so a missed real member loses seconds. **Ordering is
  load-bearing: nothing may expire before the gym has been told at least once**
  (otherwise the feature quietly throws members away — :5807 from the gym's
  side). The member's nudge is rate-limited and sits on a card ON TOP of the
  whole free app — :11132's no-locked-screen clarification stands. **Defaults
  put to Kd and not objected to, RATIFIED AT THE CARD not here (R0.2): 14-day
  expiry · gym reminded at 2 days then weekly · member nudge once a day.**
  **THE DEPENDENCY, tracked nowhere until today: EMAIL DOES NOT EXIST** —
  `EmailSender` logs event names only, real delivery deferred to a
  "notifications module" no `OWED.md` line has ever named (grep-verified); the
  card ships the IN-APP half and promises no email. Nothing built.
- **:11309** — 2026-08-19 — **THE IMPORT DOOR ANSWERED END TO END: CSV +
  EXCEL only, PDF RULED OUT, and the big-gym answer is the INDUSTRY's own.**
  **Read before planning the import card, before promising a format, before
  "we could just add PDF", and before assuming a 3,000-member gym does its own
  import.** **Ruling 1 — formats are `.csv`/`.xlsx`/legacy `.xls`** (K4 call on
  what "most used" means; confirms :9870's XLSX amendment, adds `.xls` for the
  reader library's R1.4 approval), anything else politely refused BY NAME.
  **Ruling 2 — PDF is OUT** (*"ok pdf not needed"*): the real fix is one export
  click in the gym's OWN system at onboarding, and a scanned register needs text
  recognition whose misreads write wrong facts about other people (:5807 where
  the victim cannot see the error). **Not struck forever — the trigger is a real
  PDF-only gym**, re-entering behind the SAME preview screen; own ⚪ line.
  **The upload pipeline is written out as a commitment** (gate by looking inside
  the file · parse both formats to one row shape · infer columns · preview
  saving NOTHING · CONFIRM is the only human step · name-only required · whole
  original line kept · dedupe and re-upload-updates) — all of it already ruled
  at :9809/:9870; **what is new is the format set and that the human step is
  per-COLUMN, not per-ROW** (~8 decisions whether the file is 50 rows or 5,000).
  **INDUSTRY CHECK BY WEB SEARCH, sourced, because model memory is not evidence
  (V5): self-serve import with column mapping IS the standard (Gymdesk's docs
  describe our design), and for big gyms THE VENDOR RUNS THE MIGRATION**
  (GymMaster's transfer team, "particularly helpful" above 150+ memberships;
  Gym Insight sells the same) — **and since Kd approves every gym by hand
  (:11072), that conversation is one he is having anyway.** Recorded as the
  OPERATING answer; the app promises no done-for-you migration.
- **:11283** — 2026-08-19 — **KD REAFFIRMS THAT THE CHATBOT WILL NOT SHIP — and
  the app STILL CONTAINS IT, which is the part worth knowing.** **Read before
  touching the coach module, `Coach.jsx`, the sidebar, or any privacy
  export/delete path.** **NOT a new ruling** — :9604 §5 already carries *"i have
  decided to drop the chat bot from both web and mobile"* and its `OWED.md` line
  is unchanged; what the restatement buys is that no later "AI features" card
  can be read as reopening it. **THE FINDING IS THE STATUS, measured: the chat
  is still WIRED** (`App.jsx:23` imports `Coach`, `:120` routes it,
  `Sidebar.jsx` links it), so "no chatbot" is an INTENTION until the owed line
  ticks — do not quote the ruling as a description of the shipped app.
  **Off is not deleted** (1,617 api + 772 web lines, 15 outside files, five of
  them privacy); the ~7 parked coach items stay parked.
- **:11181** — 2026-08-19 — **KD RESTATES THE WHOLE PRODUCT IN THREE AUDIENCES
  — and the one thing in it the spec forbids BY NAME is OPEN (see §2): a 5-DAY
  CONSUMER FREE TRIAL.** **Read before planning any entitlements, paywall,
  free-tier or trial work, and before gating badges or progress behind a plan.**
  His shape: normal user (exercises always free, five days of the paid
  surfaces), gym owner (Kd approves, owner is also a member, staff and coaches
  sign in too), member (**the member dashboard IS the normal dashboard** plus a
  gym header, logo, updates, notifications, coach instructions, bookings,
  products and messaging — one screen, NOT a separate members' app). **Most of
  the surface list is :9604 §7 restated; genuinely new are that dashboard
  constraint, staff sign-in, and class booking + product sales, which had NO
  `OWED.md` line at all until this commit.** **Staff/coach sign-in is my K4 call
  and was not overruled: the owner invites by email, ONE account model
  (:10824), `gym_staff` decides what they see, no user-type column.**
  **The trial question and its answer are in §2 — do not re-derive them here.**
  Also carries the two clashes flagged and unruled: **badges/progress are free
  forever today** (v1 §9.1:611; only coach/geo/nutrition consult entitlements,
  grep-verified) so moving them is a REMOVAL, and **free meal scans are already
  2/day** (`seed.ts:42`, his own 2026-07-16 ruling), which his 3/day widens.
  Farming was PRICED rather than argued: $0.00212/scan (:9944) ⇒ $0.085 per
  farmed 5 days. Nothing built.
- **:11132** — 2026-08-19 — **KD PRESSURE-TESTS HIS OWN RULINGS ON CONVENIENCE:
  they STAND — and the fact that answered him is LOAD-BEARING: pending people
  still have the WHOLE FREE APP.** **Read before building the join/apply door
  or the gym-approval gate** — two clarifications bind the builds: (1) :11072's
  "no member features" means the GYM-PAID perks ONLY; the free tier is instant
  for everyone, and **a build that parks a pending person on a locked or
  waiting screen is wrong**; (2) Kd's approval gates ONLY paid plan/trial
  activation — create/code/join/console all un-gated, and at current scale the
  approval IS the sales call (:9604). Who waits: on-list member — nothing;
  unknown member — perks only, one front-desk tap; leaked-code stranger —
  forever, by design. **Import-trust point recorded for the import card's
  pitch: the import is OPTIONAL** (the door works with zero files; join
  predates import, :10010), name-only minimum (:9870), no health data (§2.4).
  **Member-number auto-confirm recorded as an OPTION, not ruled** (Kd's own
  "not final decision"): sequential numbers are guessable — evaluate paired
  with name/phone at the join card, under :9870's wrong-match-is-not-fixable
  rule. Per-gym toggle stays the recorded fallback; reversing is one Kd line.
  UNVERIFIED for later automation: Stripe Connect onboarding's business checks
  (V5 stands). Nothing built.
- **:11072** — 2026-08-19 — **KD RULES BOTH ABUSE DOORS SHUT: no gym plan
  without his approval, and a join code is an APPLICATION, not an entry.**
  **Read before building the billing card, the member-join screen, the seat
  check, or anything that grants a member features.** Closes :11023's two open
  hazards the same day. **Ruling 1: a gym's paid plan or TRIAL activates only
  after Kd approves the gym** (real name/address; no self-serve path mints a
  live gym subscription) — one gate kills friend-pooling AND trial chaining;
  the approval gate is an addition with no governing §, present it as such at
  the billing card. **Ruling 2: typing a code creates an APPLICATION — an
  unknown person is PENDING, holds NO seat, gets NO features, until front desk
  confirms; a roster match auto-confirms by :9870's rule VERBATIM** (verified
  email, exactly one candidate; phone never auto-matches). AMENDS :9870's
  "joins immediately" half — the confirm queue is ONE mechanism for import and
  join both, never built twice. **`gym_members` has no pending state (VERIFIED
  — membership is `[joined_at, removed_at)`), so the build needs a migration
  and must flag the schema addition (R0.2).** Resolver and §4.2 seat check
  must both EXCLUDE pending. Owner's §4.0-step-6 seat untouched. Code hygiene
  (pause/rotate · expiry/max-uses · remove-member :4161 · rate limits :4177)
  stays owed on top. **Carries the operational lesson Kd stated in anger: a
  hazard put in front of him comes WITH its solution options and a
  recommendation, never as a filed acknowledgement.** Nothing built — the
  login-door card is still mid-smoke; ruling 2 becomes the member-join card's
  design, ruling 1 binds the billing card.
- **:11023** — 2026-08-19 — **KD'S SECOND PASS ON CODE ABUSE: the free bypass
  stays impossible — and the version of his instinct that IS real is now
  tracked for the billing card.** **⚠️ both hazards RULED the same day at
  :11072 — read that first.** **Read before answering "can someone ride
  free on a gym code" a third time, and before ratifying any price.** Restates
  once: an unpaid gym grants NOTHING (:10959's verified INNER join), so
  create-a-gym dodges no fee, alone or with friends. **NEW and untracked until
  today (grep-verified), one `OWED.md` line the billing card cannot close
  without:** (1) **friends POOLING a paid gym tier** — under the proposed
  UNRATIFIED prices (:9944), 5+ people splitting the $20 tier each pay under
  the $5 consumer price for the same member features; the REVENUE side, where
  :9944 recorded only the COST side; (2) **trial chaining** — `getCandidates`
  already honours `trialing`, so P3.6's card-less gym trials make a
  fresh-gym-per-month a free ride unless that card bounds it (Part 5 §6).
  Both are pricing-structure decisions; nothing was put to Kd because pricing
  is not ratified. **Leaked codes answered as design fact: a code is
  DISPOSABLE, not a secret** — expiry/max-uses/pause are enforced by the join
  path today, the seat cap bounds the money, the roster shows every joiner;
  what a leak costs is seats-full-of-strangers until cleanup, and the cleanup
  buttons are exactly the already-owed items (pause/rotate · remove-member
  :4161 · rate limits :4177), which now carry his scenario as their reason.
  **Today's first code is minted unlimited and eternal with no route to change
  it** — the pause/rotate line's gap, not a new one. No code changed; nothing
  ticks.
- **:10959** — 2026-08-19 — **KD AMENDMENT MID-SMOKE: the questionnaire is the
  MEMBER app's gate — a gym owner goes straight to the console. And his
  security question answered from the code.** **Read before touching
  `landingRoute`, the console's route table, or the wizard's exit — and before
  answering "can someone ride free on a gym code".** He hit it at smoke step 4:
  *"a gym owner needs gym management, later if want to login as member then
  onboarding should come"* — right, and it was the CARD's call, not the spec's.
  **SUPERSEDES the "onboarding gate wins over both doors" half of :10866;
  everything else there stands.** The gym door skips the questionnaire; the
  four console routes opt out of `ProtectedRoute`'s onboarding requirement;
  every member screen keeps the default, so an un-onboarded owner meets the
  wizard the moment they press "Back to the app" — the gate moved to where the
  data it collects is used, and the wizard's MEDICAL question is no longer put
  to someone running a business. **The wizard's exit reverted to a plain
  `/dashboard` and that is now CORRECT — do not "fix" it back:** :10866's D5
  defect existed only while the wizard stood in front of the console; now the
  only way in is heading INTO the member app. The guarantee moved — D5 restores
  the gym-door gating (render-level RED), new D11 strips one console route's
  opt-out (source-level RED). **THE SECURITY ANSWER, verified not recalled: the
  "make a gym, generate a code, ride free" trick earns NOTHING** —
  `getCandidates` INNER-joins gym membership through a LIVE gym subscription,
  so an unsubscribed gym's members merge to `free`, the tier they already had;
  no checkout exists yet so nothing is stealable today; a leaked code at a
  future paying gym is bounded by the built §4.2 seat cap, the join path's
  paused/expired/max-used refusals, the visible roster and a ~1.07-billion code
  space; **the remaining gaps were already on OWED before he asked** (pause/
  rotate codes · remove a member :4161 · per-route rate limits :4177) — nothing
  new to add, do not re-raise it to him. PROVE: web **797/797** · build ✓ ·
  lint = HEAD baseline · **11 mutants · 11 RED · 0 ALIVE**, control GREEN
  first, restores sha256-verified. **NOTHING TICKS — smoke restarts on the
  amended bytes, T3 unrun.**
- **:10866** — 2026-08-19 — **THE LOGIN DOOR IS BUILT — and the ONBOARDING
  WIZARD was the site that would have made it a lie.** **⚠️ its "the onboarding
  gate still wins over both doors" half is SUPERSEDED the same day by :10959
  (Kd amendment) — read that first.** **Read before touching
  `Login.jsx`, `ProtectedRoute`, `Onboarding.jsx`'s exit, `googleSuccessRoute`,
  or anything that decides where a person lands after signing in.** Implements
  :10824. Web only — **no API change, no migration, no `@app/shared` change**;
  `gym_staff` already answers "does this person run a gym", which is what makes
  this ROUTING and not identity. **FOUR places decided the destination** — the
  login submit, the Google landing, `PublicRoute`'s already-signed-in redirect,
  and the wizard's last line — each spelling it itself, so a door honoured by
  one is worse than no door because whether it works depends on how you came in;
  all four now ask one `landingRoute` (:1239 discharged by COUNTING sites).
  **THE FOURTH SITE IS THE FINDING: `Onboarding.jsx` ended `navigate('/dashboard')`,
  hard-coded, and EVERY new account goes through that wizard** — so the person
  who pressed "I run a gym" and filled in five screens would have finished in the
  member app and never found their console, i.e. the door working for everybody
  except the account it was built for. **The gate is untouched and the door is
  not a way past it** (an owner is member #1 of their own gym, §4.0 step 6);
  what moved is where the wizard SETS YOU DOWN. Four decisions not to re-derive:
  **the door does NOT check whether you run a gym** (`/console` is the create-a-gym
  front door and gating on `gym_staff` would strand the brand-new owner pressing
  it); **the choice is `sessionStorage` for the tab and is CLEARED ON SIGN-OUT**
  beside `resetTimezoneSync()` for :618 T3 F1's exact reason — a front-desk
  browser is shared; **the password path never reads storage** (Login passes its
  own state, so a browser refusing storage still honours the button just pressed
  — only the Google/wizard HOP depends on it), every helper reporting rather than
  throwing and taking its store as an argument, which keeps the unit tests in
  node instead of dragging the module into jsdom (:6856 went the other way);
  **a stored value that is not exactly one of the two doors is NO door.**
  ~~**THE `My Gym` SIDEBAR ENTRY STAYS AND THIS IS THE CITATION** — :10824 left it
  open and assigned it here; an owner inside the app still needs a way across
  without signing out, and nothing about it is temporary any more.~~
  **⚠️ SUPERSEDED THE SAME DAY by :11616 (Kd ruling): `My Gym` is REMOVED, the
  console's "Back to the app" with it, and the two doors are the only way across.
  The reasoning struck above — "needs a way across without signing out" — is
  exactly what he overruled. Everything else in :10866 stands.**
  **INSTRUMENT FINDING, caught BEFORE a byte was written: the new sweep ABORTED
  on run 1 because `Login.jsx` is CRLF and a two-line anchor matched nothing** —
  :4267's class in a FOURTH harness. Class-fixed by converting the ANCHOR to the
  file's line endings rather than normalising the FILE, because normalising
  rewrites every line and a mutant is only evidence about the one it changed;
  the whole-table pre-check ported at :10726 is what made it an abort rather
  than a false ALIVE. **SAID RATHER THAN GLOSSED: two of the ten mutants are
  caught by SOURCE assertions, the weaker kind** — the wizard is a five-step form
  with no render harness and `AuthContext` has had zero coverage since :618 T3
  F5; they exist because the alternative is no guard, and the smoke checks both
  destinations in a browser. PROVE: web **796/796** (+25) · build ✓ · **web lint
  67, all pre-existing and MEASURED by linting `git show HEAD:` copies**, not
  reasoned. **10 mutants · 10 RED · 0 ALIVE**, control GREEN on all ten filters
  first, restores sha256-verified, exit code read directly not through a pipe
  (:9509). **FOUND OUTSIDE THE CARD, NOT FIXED (R1.1): no screen anywhere lets a
  member type a gym's join code** — `POST /v1/orgs/join` has existed since :10010
  and no client calls it (grep-verified), so the member door leads to an app that
  cannot join the gym that invited it; tracked nowhere before, own `OWED.md` line.
  **NOTHING TICKS — smoke and T3 both UNRUN** (:4718 F4).
- **:10824** — 2026-08-18 — **KD RULING: the login page asks which door you came
  for — TWO DOORS, ONE ACCOUNT.** **Read before touching `Login.jsx`,
  `Register.jsx`, `ProtectedRoute`, the console's entry point, or anything that
  decides where a user lands after signing in.** Raised by Kd unprompted mid-smoke
  on seeing a **My Gym** item in the member app's sidebar — *"why would a gym
  owner enter a users profile to create their gym … you either loggen in as user
  or a gym administrator"*. **He is right and the OWED line already existed**; the
  sidebar item was a TEMPORARY door and **the defect is that it shipped without
  being labelled temporary**, found by him using the product. **THE RULING: the
  login page offers "I'm a member" or "I run a gym", the email and password are
  IDENTICAL either way, and the choice decides only which screen you land on.**
  **THE FACT THAT DECIDED IT, which a later chat must not undo by tidying: the
  same person is deliberately BOTH** — §4.0 step 6 makes the owner member #1 of
  their own gym, complimentary and not seat-counted, so the demo works on their
  own phone. **Separate ACCOUNTS would mean a gym owner cannot use their own app
  without logging out**, contradicting :9604 §4. So this is a ROUTING decision,
  not an identity one: no "user type" enters the schema, and `gym_staff` already
  answers "does this person run a gym". **NOT DECIDED: whether the My Gym sidebar
  entry survives beside the new door** — an owner already inside the app still
  needs a way across, and the no-removal rule keeps it until a ruling says
  otherwise. **Nothing built on it in that session**, deliberately: the console
  packet's own T3 was still unrun and stacking a second card under an unreviewed
  first is what the loop prevents.
- **:10402** — 2026-08-18 — **THE CONSOLE SCREEN: a gym owner can see their gym,
  their join code and their members, from a phone — and THE CARD'S OWN PREMISE
  ABOUT THE API WAS FALSE.** **Read before touching
  `apps/web/src/pages/console`, before adding a widget to the console's
  Overview, before adding a field to a member row, and before assuming a join
  code can be read back from `GET /v1/orgs/mine`.** Web half of :10010. Four
  screens in Part 3 §3.1's own route group — `/console` · `/console/new` ·
  `/console/:orgSlug` · `/console/:orgSlug/members` — reached from a **My Gym**
  sidebar entry, under `ConsoleLayout` and **NOT `AppLayout`, which pins
  `marginLeft: 256` with NO breakpoint anywhere in it**, so on a phone its
  content starts off the left edge. **THE PREMISE CORRECTION IS THE MOST USEFUL
  PART: the card said the API was unchanged, and a join code left the server
  exactly ONCE, in the create response** (`listOrgsForUser` selects no code
  column; `grep gym_codes` finds no other read outside the join transaction) —
  so an owner saw their code the day they made the gym and never again.
  **KD RULED THE READ ENDPOINT IN**: `GET /v1/orgs/:gymId/codes`, Part 3 §3.3's
  own read half, staff-only through the SAME `requireStaff` the roster uses.
  **The rejected alternative, which a later chat will reach for: caching the
  code client-side at creation** — it works until a code is rotated, paused or
  expired, and then the console prints a dead code under "share this with your
  members" (:5807). Hence the response carries `paused`/`expiresAt`/`maxUses`/
  `uses` and the screen WITHHOLDS the invitation rather than rewording it, with
  a test proving the join path agrees with what the screen is about to draw.
  **§2.2 grants Invite to ALL THREE roles, so codes allow all three** — the
  studio/clinic trainer hold-back is about the MEMBER LIST, and a test has one
  trainer getting 403 on the roster and 200 on the codes. **THE OVERVIEW HAS NO
  NUMBERS ON IT, DELIBERATELY: §4.1's tiles, 8-week chart and at-risk list all
  read `org_daily_stats` / `org_live_counters` / `org_member_stats` and not one
  of the three EXISTS** — no table, no view, no worker, no route — so a tile
  there would print a number nobody computed. Five decisions not to re-derive:
  **the slug resolves against `mine`** (no by-slug route; and `mine` truncates
  at 100, so past the cap a gym you DO staff reads back as "we could not find
  a gym you run" — its ⚪ line raised in consequence); **`/console` lists only
  `staffRole !== null`**; **no auto-redirect on a single gym**; **a member count
  is EXACT or a BOUND, never one page's length**, and `joinedCount` excludes the
  owner's §4.0-step-6 complimentary seat; **`locale` is not collected** because
  nothing reads the column. **THE TIMEZONE ALIAS PROBLEM WAS MEASURED, NOT
  ANTICIPATED: `Intl.supportedValuesOf('timeZone')` here returns 418 zones
  containing `Asia/Calcutta` and NOT `Asia/Kolkata`**, while Chrome reports
  `Asia/Calcutta` from `resolvedOptions()` on this machine (:618) — a picker
  missing the user's own zone silently sets the gym up in somebody else's day
  boundaries, permanently, so the detected zone is always injected and the test
  derives the missing alias from the runtime instead of hard-coding it.
  PROVE: api **490/490** real Postgres · web **747/747** · shared **48/48** ·
  tsc + api lint clean · `vite build` ok · **web lint 67 errors, every one
  PRE-EXISTING** (the four this card introduced were fixed, not added to the
  pile). **MUTATION AUDIT 35 mutants · 35 RED · 0 ALIVE**, split by cost per
  :5857 rule 4a — O21–O24 added to `mutate-orgs.mjs` (24 against real Postgres)
  and a new `apps/web/tools/mutate-console.mjs` (11, no DB mutants at all).
  **THE WEB HARNESS CAUGHT A DEFECT IN ITSELF BEFORE IT RAN, and it is the
  control again: its pair-dedupe joined `(suite, filter)` into a string and
  split it, and EVERY filter contains spaces — so the control would have run on
  the first WORD of each and passed while checking something else.** It also
  ABORTS on a non-ASCII `-t` filter, since two of these test names carry a curly
  apostrophe. **SMOKE PASSED 11/11** in Kd's browser on `73c733f` — the code
  survived a full page reload (the reason the endpoint was ruled in), the roster
  held to §2.4, a second account joined by code appeared as a second row, the
  rail became bottom tabs at phone width, and a failure showed a retry rather
  than an empty state. **THE SMOKE'S ONE FINDING IS APP-WIDE AND PRE-EXISTING: a
  network blip on page load LOGS YOU OUT of the entire app** — `AuthContext`
  catches `getMe()` and nulls the user, and a network failure carries NO response
  at all, so it lands in the same branch as a genuine 401 and the app cannot tell
  "you have no session" from "I could not ask". **The identical lesson sits three
  lines away** in `fetchProfileFacts` (:618 T3 F3). Own OWED line, own card, NOT
  fixed here (R1.1); tracked nowhere before, grep-verified. **The sheet's own
  step 10 was badly designed and is the instrument lesson**: stopping the API
  also stops the session check, so the reload could not reach the console at all
  — a smoke step that cannot observe its own subject is a test that cannot fail
  (:5034, :7104). Rewritten to navigate between tabs with the API already down;
  **the broken version is what found the login bounce, recorded as LUCK rather
  than method.** **KD RAISED THE GYM-LOGIN DOOR MID-SMOKE and it is NOT RULED**:
  the sidebar entry is a temporary door and should have been labelled so; the
  OWED line for a separate gym login predates this card; **the fact he was given
  before ruling is that the same person is deliberately BOTH (§4.0 step 6), so
  the split is two DOORS into one account, not two account types.**
  **T3 ROUND 1 (:10596) — ONE Critical/High, seven Low, all fixed; the packet
  does NOT ship this round.** **C/H-1: the wizard PRESELECTED the United States**,
  and `currency_display` is written once at creation with **no settings route to
  change it** (grep: no PATCH in the module) — so an owner in Jorhat who typed a
  name and pressed Create got a gym billed in USD and was told so. **It is a
  guess with a WORSE hit rate than deriving the country from the timezone, which
  the currency ruling had already rejected as a guess.** Fixed to empty; **its own
  evidence is that it BROKE TWO EXISTING TESTS that had been leaning on the
  default.** Seven Low all fixed (rule 1) and in `BACKLOG.md`, the two with reach
  being **L-2 — a gym named "New" slugs to `new`, which the console's router
  already spends on the create form**, unrepairable because a slug is minted once
  (`RESERVED_SLUGS`) — and **L-7 — no console response was parsed against the
  `@app/shared` schemas that define it**, so a 200 missing `orgs` became "we
  couldn't find a gym you run" and a 200 missing `items` became "nobody has
  joined yet": **the empty-vs-failed defect arriving through the PARSER instead
  of the network**, fixed as a class across all four reads. **THE TWO INSTRUMENT
  FINDINGS ARE BOTH MINE: my own L-1 fix added `LIMIT` and DRIFTED O21's anchor**
  — the mutant proving one gym cannot read another's join codes — so it matched
  nothing, whose honest reading is "this ownership guarantee has no test"; the
  whole-table anchor check ABORTED the sweep before a byte was written (:5199's
  class fix, :8610's shape). **And I masked the harness's own exit code with a
  `| tail` pipe**, so the aborting run reported exit 0 — :5906's exact recorded
  shape, recurring. Re-run with `$?` printed. **The fix round's OWN fixture defect
  is worth the line: the L-2 test would have passed EXACTLY ONCE**, because its
  gym slugs to `new-gym`, which `cleanup` matched with nothing — verified fixed by
  running the suite TWICE back to back and querying the database empty after.
  PROVE: api **493/493** real Postgres · web **767/767** · shared **48/48** · tsc
  + api lint clean · build ok · web lint 67 unchanged, all pre-existing.
  **MUTATION AUDIT 43 mutants · 43 RED · 0 ALIVE** (26 api + 17 web), with rule 3
  MEASURED: C12 restores the `'US'` default and the new test goes RED.
  **RE-SMOKE PASSED 4/4** (Kd, on `5f924b4`, API restarted for it since `tsx` has
  no `--watch`): the country box reads "Choose a country", Create stays disabled
  on a name alone, and **a gym created with India comes back in INR** — the C/H
  inverted. His question there, answered not deferred: **yes, one account can run
  several gyms, deliberately** (`/mine` is a list; a chain with two branches is a
  real customer), **and the gap was named to him unprompted — nothing limits how
  many and create has no per-route rate limit**, so one account can squat every
  readable slug. Its own OWED line; left alone because a cap depends on unratified
  pricing (:9944).
  **T3 ROUND 2 (:10726, diff-only) — ZERO Critical/High. THE PACKET SHIPS**
  (:5348 rule 1). Escape hatch NOT armed. All eight round-1 fixes re-measured RED
  under a restored defect rather than read. Four Low, all fixed. **Low-1: a line
  citation in THIS index went stale inside the commit that moved it** — the
  fix-round insert pushed the two-doors ruling off `:10596`, which is now round
  1's own sub-heading, so the pointer **failed silently by landing on a real
  heading**; it then moved TWICE MORE the same day (:10695 → :10715 → :10824),
  which is why this file's header says to re-derive line numbers with `grep -n
  "^## "` rather than trust them. **Low-2: round 1's recorded CAUSE of its
  fixture defect was wrong** — the shipped assertion tolerates a slug suffix, so
  the real breakage is `gyms.owner_user_id` having no `onDelete`, making cleanup's
  user DELETE raise 23503 and fail all 46 tests; struck in place, because a later
  chat would otherwise have deleted the OWNER half of cleanup, the half that
  works. **Low-3: "(you)" was INFERRED from the seat being complimentary**, true
  only while the sole `INSERT INTO gym_staff` writes `owner` — a manager would
  have been told the owner's seat was theirs; the viewer is now passed and
  compared. **Low-4: the L-3 fix closed half its own finding**, leaving a Try
  again over a permanent 403, and stacking two identical error cards when both
  reads fail. **THE ROUND'S OWN ENTRY: the Low-3 rewrite DROPPED A TRUNCATION
  GUARD and would have printed "1 member (you)" on a page-of-one out of hundreds
  — a wrong number — caught by a round-1 test, :6277's class for the second time
  in this card.** **And a fix of mine drifted a mutant's anchor for the THIRD
  time**, so it stopped being patched: `mutate-console.mjs` gains
  `mutate-orgs.mjs`'s whole-table pre-check (:5348 rule 5) — the cost was never
  the wasted run, it is that **a no-op mutation reports ALIVE, whose honest
  reading is "this guarantee has no test".** web **771/771** · **21 web mutants,
  21 RED, 0 ALIVE, harness exit code read from `$?` not through a pipe**; the api
  sweep was NOT re-run because this round changed no api source, stated rather
  than implied.
  **STILL DOES NOT TICK: the console `OWED.md` line's own title names "seats",
  which needs a cap no gym has** — its headline ("does not exist") was false and
  was corrected in place instead.
- **:10329** — 2026-08-18 — **ORG SLICE, T3 ROUND 2 (diff-only): ZERO
  Critical/High — THE PACKET SHIPS.** **Read before citing this card, before
  moving the clinic consent gate, and before assuming a `FOR UPDATE`
  transaction's later reads are stale.** Escape hatch NOT armed. All three
  round-1 fixes CLOSE rather than move: **C/H-1's `alreadyHolds` is read inside
  the transaction already holding the org lock and no path sets a non-default
  isolation level (grep: none), so under READ COMMITTED it sees a join that
  committed while this one waited** — seat maths for a new joiner byte-identical.
  **C/H-2 verified by ENUMERATING the writers** — exactly two production writers
  of `gym_members`, everything else a fixture, column nullable with no CHECK;
  "fix the class not the case" (:1239) discharged by counting sites, which is
  the only way that instruction is ever satisfied. **C/H-3 confirmed to fail on
  its OWN rows** (`to not include 'd292e8b2-…'`, a user the test created in the
  second gym), so it holds on a clean database. **NO FIX CREATED A NEW DEFECT** —
  asked specifically because round 1's C/H-2 was created by an earlier fix
  (:6277). Two edge cases correctly NOT scored: a complimentary owner re-tapping
  now gets idempotent success (an improvement nobody designed), and an existing
  member re-tapping a dead code still gets the code refusal — **TRUE, therefore
  not :5807's class.** **Hazard recorded, not scored: `alreadyHolds` + a
  concurrent account SELF-DELETION could skip the cap** — needs a user to delete
  their own account between two statements of their own join; in `BACKLOG.md` so
  it is not rediscovered as new. **Two Low, both mine, both "a record is a
  claim": the clinic-parking OWED line cited :10010 where the ruling is :10248
  — the commit message and index line had it RIGHT, so the OWED copy was the one
  that drifted** — and two comments placed the clinic consent gate "in the
  service layer" when it lives in the repo, **one of them in `tenancy.ts` since
  `0001_init`**; corrected in BOTH places (:5748). **NOTHING TICKS BEYOND THE
  CURRENCY LINE: the console OWED line names the CONSOLE and no screen exists,
  which is also why there is no SMOKE** — stated at the card rather than
  skipped. Full 487-test suite deliberately NOT re-run (diff-only), stated
  rather than implied.
- **:10182** — 2026-08-18 — **ORG SLICE, T3 ROUND 1: three Critical/High, six
  Low — the packet does NOT ship this round, and one finding is a claim the card
  made in its own entry.** **Read before quoting a seat cap, before writing
  `consent_at`, before trusting a cross-tenant test that builds ONE tenant, and
  before writing a deferral that predicts its own future.** Escape hatch NOT
  armed. **C/H-1: a full gym refused somebody already in it** — the seat check
  ran before the `ON CONFLICT` and an existing member is inside `used`, so §4.2's
  idempotent success became "this gym has no free places" to a person standing in
  it; latent (no gym has a subscription). **It also FALSIFIED the card's own
  `OWED.md` line**, which promised the seat deferral "closes by itself … no
  change to this code is expected" — struck in place, with the shape named: **a
  deferral that also predicts its own future makes two claims, and the prediction
  gets no evidence while the deferral gets all the attention.** **C/H-2: the app
  stamped a consent record nobody collected** — the owner's silent §4.0-step-6
  membership wrote `consent_at = now()`, which for a clinic IS §2.4's DPDP/GDPR
  record; **the card's own test asserted `.not.toBeNull()`, pinning the
  fabrication as correct** (:5906's class). **C/H-3 IS THE ONE TO REMEMBER: the
  cross-tenant test was passing by ACCIDENT.** The roster-scoping mutant was RED
  only because of **48 unrelated rows in the shared test database** (193
  memberships / 98 gyms); on a clean local Postgres — *which :5857 rule 4a
  recommends moving to* — the same mutant SURVIVES. **The shipped code was
  correct throughout and the protection was an accident of history, which the
  audit doctrine's own recommendation would have silently removed.** Fixed with a
  SECOND gym in the fixture, **and the assertion ORDER is part of the fix** so the
  failure names a person the test itself placed elsewhere rather than reporting
  "expected 50 to equal 2". **Four tests measured GREEN against their own broken
  subject** (rule 4). **L-6 is the author's own over-claim**: the header and
  commit message credited BOTH concurrency tests with catching a deleted
  `FOR UPDATE`; only the seat-cap race does — the same-person race is carried by
  the partial unique index and `ON CONFLICT`. Corrected in place (:8405).
  **KD RULING IN THE SAME ROUND — CLINICS ARE OUT** (*"no click will be there
  only gyms and fitness centers"*): asked how a clinic owner's consent should be
  handled, he removed clinics instead. **The no-removal rule's AUTHORISED path,
  and this is the citation.** **Narrowed at the DOOR, not deleted** —
  `createOrgTypeSchema` is `gym|studio` while the CHECK, the `clinic` value and
  the consent gate are untouched, pinned by a test that inserts a legacy clinic
  directly and proves the gate did not disarm when the door narrowed; no
  migration, reopening is one enum value. **`studio` STAYS** (a PT/boutique
  studio is a fitness business, not a medical one) and is why the trainer
  hold-back still has a live type to apply to. Part 3 §2.3's clinic matrix,
  §2.2's clinic linter and Part 2B §7 PARK with the feature and must not be
  ticked.
- **:9944** — 2026-08-18 — **KD'S US PRICE TIERS, MEASURED AGAINST API COST —
  covered in the normal case (~3-5× headroom), underwater only in the
  runaway-success case; PRICING NOT YET RATIFIED.** **Read before any billing
  or entitlements card, and before quoting a price to anyone.** His proposal:
  gym tiers $20/$30/$40/$50 by member count, direct consumers $5/mo, both
  channels get 8 meal scans/day + 2 route plans/day. MEASURED from
  `api_cost_events` this session: live vision model max **$0.00212/scan** (18
  real scans) → a max-use member costs $0.51/mo; each tier absorbs ~39/59/78/98
  full-use members; routes cost $0 (ORS free allowance, shared, size
  UNVERIFIED). **The structural exposure: flat fee + per-member variable cost —
  the daily cap bounds a member, nothing bounds a roster; the already-live
  ledger is the tripwire and repricing happens on evidence.** Three fixes put
  with the math: tier boundary gaps (exactly 500/1000 fall nowhere → 1-499 /
  500-999 / 1000-1499 / 1500+), "1500+" unbounded (above ~2,500 = contact-us),
  consumer margin net of card fees (~$4.55 of $5, UNVERIFIED rate). Current
  quota seeds are re-seeded per the ruling at the billing card. **CONSENT SPLIT
  (his question, US-only): roster upload = the gym's responsibility by
  contract; health data and the CAMERA = the app asks the member directly at
  first use (in-app consent screen, now owed); one US lawyer reviews before
  the first gym signs — :592 given concrete content, not closed.**
- **:9870** — 2026-08-18 — **MEMBER MIGRATION DESIGN SETTLED (same-day
  continuation of :9809): verified-email-only auto-attach, front-desk confirm
  queue for everything else, and Kd's three amendments.** **Read WITH :9809
  before planning the import card.** Governing principle: **a duplicate is
  fixable, a wrong match is not** — the machine attaches only when certain
  (verified email, exactly ONE candidate row in that gym; phone is NOT an auto
  key, users carry no verified phone), everything else joins immediately and
  lands in a console "who is this?" queue the front desk confirms; names never
  auto-match; a member never self-claims a row (a row is a paid membership).
  Merge = plan/renewal onto the account, imported row soft-kept as `merged`.
  Roster fields chosen because screens read them; name is the only required
  field; the entire original uploaded line is kept as a document. **Kd's
  amendments: (1) XLSX alongside CSV — the reader library is an R1.4 new-dep
  approval at the card; my CSV-only call is OVERRULED; (2) the preview is the
  owner's correction surface — auto-read in seconds, nothing saved until
  CONFIRM, fix-in-place/re-map/skip/cancel, rows editable forever after,
  re-upload updates not duplicates; (3) phone AND laptop — satisfied by the
  one responsive console (:9604 §4), preview owed PHONE-FIRST.** Seat and
  consent questions still reserved.
  FAVOUR TO THE FIRST CUSTOMER.** *"i obvisoulsy can not wait untill someone
  joins i need to make the system."* **Read before planning the Stage-1 gym
  slice or anything touching the roster.** SUPERSEDES half of :9604 §8's parked
  importer: the UNIVERSAL spreadsheet import is IN-PLAN NOW (per-competitor
  one-click importers stay parked). Spec has member EXPORT only
  (`03-part3-org-console.md:105`, `:212`); this is an ADDITION with no governing
  §. Shape (K4 call, not overruled): (1) roster rows that exist WITHOUT a user
  account — the owner sees all 1000 members on day one; (2) ONE upload screen
  with COLUMN MAPPING at upload time, preview-before-save, which is what makes
  one system fit every competitor format; (3) **ATTACH-ON-JOIN — a member who
  installs later matches (phone/email exact) to their EXISTING row; without this
  every person becomes two records and the owner's count is wrong forever.**
  Joins the Stage-1 card family by construction (writes gym/roster tables).
  **RESERVED FOR KD at plan time: do imported-not-yet-joined members consume
  paid seats, and the consent question (inside :592).** A looser-than-exact
  match rule without a ruling is an ownership defect (:5807).
- **:9604** — 2026-08-18 — **KD PRODUCT RULINGS: THE TARGET IS US GYMS, THE
  MOBILE APP IS THE PRODUCT, AND THE PROJECT IS NOW A GYM PLATFORM RATHER THAN A
  CONSUMER APP WITH A CONSOLE BOLTED ON.** **Read this BEFORE planning,
  sequencing or estimating ANY card — it changes who the product is for, which
  surfaces get built, and what "done" means.** Fifteen rulings from one session,
  recorded as ONE entry because they are one shift; a chat reading any of them
  alone will mis-size its work. **(1) MOBILE IS THE PRODUCT, WEB IS THE TEST
  RIG** — web member screens are built TWICE (RN shares no screen code), so
  finishing web buys mobile almost nothing; measured, `packages/engine` (20 files,
  `dependencies: {}`), `packages/shared` (20), all of `apps/api` and every
  definition transfer unchanged, while all **24** files in `apps/web/src/pages`,
  the camera path, offline storage and payments do not. **(2) MARKET IS US GYMS,
  NOT INDIA** — Part 5 §1's price books are now UNRESOLVED, and **my India-anchored
  RBI objection to gym-collected payments is WITHDRAWN** (do not resurrect it);
  :592's privacy-law question moves onto the critical path because US workout/body
  data is health data. **(3) GYMS COLLECT THEIR OWN MONEY via Stripe Connect, gym
  as merchant** — a BUSINESS-MODEL addition, not a feature: `grep -ci
  'connect|payout|marketplace|platform fee|split'` over Part 5 returns **ZERO**.
  **Every Stripe specific in that session is UNVERIFIED model memory (V5) — pull
  current docs before building.** **(4) CONSOLE REACHED FROM THE PHONE BUT BUILT
  ONCE** (responsive, opened from the app) — Kd and Part 3 §3.1 agree on the goal;
  I made the mechanism call under K4 and he did not overrule; wanting it native
  means building it TWICE and owing that cost. **(5) THE AI CHAT IS SWITCHED OFF,
  NOT DELETED — this IS the no-removal rule's authorised path** (explicit Kd
  ruling against a cited cost), and the citation lives here: coach is **1,617**
  API lines + **772** web lines with **15** files referencing it outside the
  module (privacy export/delete among them), so unwiring the ROUTE is an hour and
  reversible while deleting is a day across six subsystems. **Kd's deploy-size
  question answered: server lines never download; removing the ROUTE shrinks the
  bundle, hiding only the BUTTON ships it anyway.** ~7 coach `OWED.md` items park
  with it and are NOT ticked. **(6) SHARING IS OPT-IN AND SCOPED (gym-global or
  private) AND MEAL PHOTOS SELF-DELETE AT 7 DAYS — this is also his answer to the
  §2.4 privacy question**, so §2.4's promise STANDS: gyms still never see meal
  logs, weight, coach chats or routes except what a member deliberately shares.
  **Photo storage does not exist at all today** (nutrition photos are
  "request-only", no bucket config) — sharing means building R3.9's five upload
  guarantees plus a 7-day sweep plus report-and-remove for the gym feed.
  **(7) NEW SURFACE, spec-checked: attendance, classes/booking, member↔coach
  messaging, gym announcements, gym-set pricing/offers, coach-authored plans,
  grocery lists, competitor import, nearby gyms/day passes and nearby runners ALL
  return ZERO spec hits** — additions, with no § governing them; programs (Part 7)
  and gym branding (Part 3) DO exist. **(8) DROPPED: coach video upload. PARKED:
  gym payments beyond the interface, the importer. NOT DECIDED — do not treat as
  approved: day passes, paid friend invites, training together, nearby runners**,
  the last carrying an unanswered SAFETY question that consent settings do not
  answer. **(9) This entry is NOT a licence to delete, NOT a plan, NOT a spec
  amendment**, and the honest size stated to Kd — 120 open items, 3/58 exercises,
  no mobile app, no billing/org routes, 51 cards in 42 days at a *declining* rate
  — must not be softened later. **He asked if 10 days would finish it; he was told
  no.**
- **:9509** — 2026-08-17 — **T3 ROUND 2 ON THE STRONG-MODEL/RATE CARD: the same
  instrument lied again — two seconds instead of five minutes — and KD RULED
  PATCH on the escape hatch.** **Read before putting any live measurement on
  screen, before dividing a count by a span, and before believing a mutation
  sweep that reports no summary line.** 1 Critical/High, 1 Low; the reviewer
  reproduced round 1's three mutants and correctly STOPPED rather than proposing
  a patch, because two rounds had found Criticals in the same function (:5348's
  hatch). **Kd ruled PATCH** (:6277 precedent). **C/H-1: round 1 fixed WHICH
  frames count, not WHAT THEY ARE DIVIDED BY** — the span still ran to the last
  FRAME, so a gap at the END was invisible and the frames that knew better were
  discarded by the formula; **re-derived by arithmetic here before accepting it,
  and the new test's own failure printed it: 14.9 shown at 500 ms of silence when
  12.67 arrived, still 14.9 at 1,990 ms against 5.3.** :5807 on its face, bounded
  only by the panel's ~1/s repaint. **FIX IS ONE LINE (`span = now - t[first]`)
  AND IS THE SHAPE CORRECTION, NOT A THIRD PATCH: `now` now governs BOTH ends of
  the measurement.** **VISIBLE CHANGE: a perfect machine reads ~14.6 against a
  ceiling that says 14.9, and the row decays to near zero before blanking — the
  lower figure is the honest one** (BACKLOG, beside L47, whose 12.0-on-60 Hz
  finding is unchanged). **FIVE ASSERTIONS MOVED AND NONE WAS WIDENED TO PASS
  (Part 0 r3)** — each was replaced by the property it really claimed, and the
  mid-gap pair now go RED under the defect because under it the two numbers were
  IDENTICAL. **Low-1 has the longest reach: the reviewer wrote round 1's defect
  ONE LAYER UP (a page-level cache) and all 690 tests stayed GREEN**, because
  every rate test renders once against a CONSTANT stub — closed by a render test
  that changes the meter's answer and advances the page's own repaint. **5 mutants
  all RED** (including the reviewer's ALIVE one), backup by file copy + sha256.
  **THE SIXTH UNEARNED HARNESS PASS, caught by its own control: the sweep's first
  run reported all five ALIVE on an EMPTY summary — it grepped before stripping
  ANSI. Class-fixed twice over: a missing summary is a FATAL, and an unmutated
  CONTROL must report green through the same path first.** web 693/693 · build ✓.
  **CARD DOES NOT CLOSE — a third, diff-only re-review is owed on the fix alone
  (:5348 r1); smoke stays passed 5/5 (:9328); nothing ticks.**
- **:9452** — 2026-08-17 — **KD RULING: FOLLOW-ALONG SETS RUN ON A TIMER, not on
  reps counted from the video — the app may only save numbers it actually
  knows.** **Read before adding any rep count the camera did not produce, before
  designing a timed set, and before worrying that a timer breaks the calorie
  method.** Continues :9390. Kd first specified the VIDEO driving the count, then
  asked *"how about making it time based"* and ruled for the timer after being
  given both cases. **THE REASON IS HONESTY, not the simplicity he asked about:
  the app can only know how many reps the VIDEO did, never how many the USER
  did** — three of the demo's twelve still writes twelve into history, calories
  and personal bests, which is :5807's class arriving BEFORE the defect. A timer
  only records something true. Secondary but real: no loop-detection, no
  per-exercise rep lengths, and **no dependency on a perfect one-rep clip** —
  exactly where he was stuck (generators emitted double squats and all wanted
  subscriptions). **NOT a one-way door; he was told so before ruling.**
  **HIS QUESTION VERIFIED IT — "how will calorie burn calculation happen then?"
  CALORIES NEVER USED REPS**: `calories.ts` is `MET × weight_kg × hours`, and
  reps entered v2/v3 only to ESTIMATE working time, which v3 already replaced
  with the measured `watchedMs` (:7730). **A log-only set is billed as its whole
  span at the exercise MET, so a timed set is the cleanest input that formula has
  ever had and needs no new code** — residual unchanged from hand-counted sets
  today: stop early and you are credited generously (:6277's branch; the new copy
  must not claim otherwise). **Open and NOT chosen: where the footage comes from**
  (free stock / filmed / rendered from the traces on his Desktop) — **the app's
  112 shipped GIFs cannot serve, measured at 600×600 at best and 220×119 for jump
  squat**; the artwork is its own track and must not block the card. Card written
  as `NEXT-CARD-follow-along-PROMPT.md`; nothing built.
- **:9390** — 2026-08-17 — **KD RULING: the crowded-room answer is a
  FOLLOW-THE-DEMO mode the USER chooses, and the app must SAY SO UNPROMPTED —
  silence reads as a broken app.** **Read before building anything that decides
  WHICH person the camera follows, before adding any automatic switch away from
  camera grading, and before writing the copy that offers this mode.** Kd asked,
  unprompted, how the camera picks the right person in a gym. **Measured answer:
  NOTHING does** — `numPoses: 1` (`poseTuning.js:82`) and
  `results.landmarks[0]` (`usePoseDetection.js:388-389`), so MediaPipe crowns a
  winner and the app takes it; no nearest/largest/central/same-as-last-frame rule
  exists, and `bone_stretch > 0.923` cannot help because **a real bystander IS a
  plausible skeleton**. Own 🟡 OWED line, tracked nowhere before (grep-verified).
  **His proposal — a big moving reference instead of the camera — is the cheap
  way out because BOTH halves already exist: 112 GIFs over 63 exercise names in
  `public/exercise-gifs/`, and the log-only set that still SAVES and still earns
  XP (:3085) without a form score.** **RULING 1: the USER flips the switch**
  ("i will follow your recommendation") — **:6008 is what decides it** (the app
  never switches a camera user off the camera; the hatch is a button the user
  presses), so **an automatic crowd-switch may NOT be built without Kd amending
  :6008 expressly.** **THE ARGUMENT TO CARRY FORWARD: the automatic version needs
  exactly the thing the idea was invented to avoid** — you cannot know a room is
  crowded without asking for more than one body. **RULING 2, added in the same
  breath and larger: the app must TELL the user to switch** — *"otherwise they
  will think the app does not work"*; a user whose reps stop counting cannot
  guess the camera locked onto somebody else (:6662's "say it" shape, :6856's
  "noticing a MISSING thing is not a check", applied BEFORE the defect).
  **DESIGN CONSEQUENCE that follows from ruling 1 and must not be lost: the
  message cannot be conditional on a crowd** (the app cannot detect one), so it
  is unconditional — which forces it to read as an INSTRUCTION beside the switch,
  never a warning about the camera, or every solo user at home is told the app
  may not work. Copy NOT written (R0.2). **Nothing built, nothing ticked.**
- **:9328** — 2026-08-17 — **THE SMOKE PASSED 5/5: the strong pose model costs
  37 ms and no frames, and the empty chair still invents nothing. NOTHING
  TICKS.** **Read before quoting any fps figure measured under `full`, before
  calling the person gate "unverified under the strong model", and before
  designing a smoke around a number only the operator can see.** Second sitting
  of the sheet that answered 1 of 5; servers started BY THE CHAT again (:9243's
  process note). **`full` delivers 10–12 /s against the 14.9 ceiling; `lite` on
  the same machine in the same session, 11–12; `lite` on 2026-08-09, 9.2–12.2
  (:8879) — so the strong model has NOT eaten the throttle's headroom**, which
  is the objection the whole readout was built to test (:9003, :9111).
  Corroborated by the DEV console printing 10.0 / 11.4 / 7.6 fps during his set,
  and 12.0 is the 60 Hz cap (:9003), so 10–12 is the TOP of the range. Start-up
  **680 ms vs 643 = +37 ms**, console said **THE APP BUNDLE**. **Step 3 — empty
  room, one minute, ZERO invented reps under `full` — and he was asked TWICE
  whether he ran it in THIS session on `full`, because a pass from the `lite`
  era (:7222) is not evidence about a different estimator; the second ask is why
  the line can be written.** `bone_stretch > 0.923` untouched, its 🔴 line does
  NOT tick (a smoke is one room and one chair; that line needs a RECORDING
  replayed through `measure-pose.ts`) — the hazard's temperature changed, not its
  status. **THE STORED ROWS THE FIRST SITTING LACKED: sync count 8 (was 0), five
  sets, EVERY ONE `mode='engine'`**, scores 100/100/75/50/100, 4 reps counted in
  each of two sets against 5 done; **three sets show `duration_ms` far above
  `watched_ms` (150,075/30,572 · 134,626/25,157 · 93,308/18,139), which is what
  stepping out of shot looks like from the database.** **SAID RATHER THAN
  GLOSSED (:7222): a row holds the FINAL count, not the count over time, so
  step 3's headline rests on Kd's REPORT (:4829); and no payload field records
  WHICH pose model produced a set, so steps 2 and 4 are separated by his reading
  alone — the same instrument gap that makes :9111's clips unreplayable under a
  new model.** **NOTHING TICKS: the packet still needs a round finding zero
  Critical/High (:5348 r1) and the diff-only re-review of the expiry fix is
  UNRUN.**
- **:9243** — 2026-08-17 — **T3 ROUND 1 ON THE STRONG-MODEL/RATE CARD: 1
  Critical/High — the camera-rate row reported a live feed over a DEAD CAMERA.**
  **Read before putting any live measurement on screen, before reading
  `PoseThroughput.hz()`, and before believing a green suite says anything about a
  value's FRESHNESS.** The window was trimmed **only by `push`**, so with no
  frames nothing ever left it and the reading froze — **measured at 5½ minutes
  after the last frame, still `14.9 of 14.9/s`**. Two everyday states show it: a
  camera that dies never announces it, and **pause is on every workout**
  (`restartRateMeasurement` fires on the resume that ENDS the gap, so it cannot
  cover the gap), while the 1-second workout timer actively redraws the frozen
  figure. Severity is :5807 (on screen AND false), same class as :6150's green
  badge over a dead camera. **Fix: `hz(now)` applies `push`'s cutoff at READ
  time; blanks to `—` ~2 s after frames stop; a missing clock is `null`, never a
  fallback to the newest frame's own time** (that fallback IS the old bug).
  Page and display format unchanged (:9003 is Kd's). **WHY 685 GREEN TESTS
  MISSED IT — every one read the meter at the instant the last frame arrived,
  and the render suite stubs `readPoseHz` as a CONSTANT (:7487's fixture-shape
  lesson); nothing asserted the value's LIFETIME.** 3 mutants **RED**
  (expiry deleted · clock-fallback restored · hook stops passing the clock),
  restores sha256-verified, **backup-by-copy — `git checkout` cost the reviewer
  an uncommitted edit this round**. Low-1 → BACKLOG L47 (14.9 ceiling is
  unreachable on a 60 Hz display, where 12.0 is the real cap — TRUE so Low, and
  the format is Kd's). web **690/690** · build ✓. **CARD STILL OPEN: smoke is 1
  of 5, and step 3 — the empty chair under `full` — is the only check on
  `bone_stretch > 0.923` against a model it was never measured on.**
- **:9111** — 2026-08-17 — **THE STRONG POSE MODEL IS THE DEFAULT — Kd ruled it,
  and nobody had ever chosen the weak one.** **Read before touching
  `POSE_DEFAULTS`, before adding a model variant, before trusting
  `bone_stretch > 0.923` again, and before telling Kd a camera change is "blocked
  on a recording".** Part 6 §3.3 (`06-part6-mobile.md:164`) always made `full`
  the default and `lite` the step-down; the app shipped `lite` **by inheritance
  from the previous version, never by decision** — and a weaker model is a more
  credulous one (`lite` is what read a chair's chest at 0.99, :6386, and invented
  ten reps from an empty room, :6856). **The nine-day objection fell to the same
  morning's measurement** (:9003): "he is already under budget at 7.2–12.5 fps"
  was never about his machine — 12.0 is the app's own ceiling — so there IS
  headroom, and the new `MAX_FEED_HZ` row is what measures whether `full` eats
  it. **BOTH models are bundled** (`full` 9,398,198 B / sha256 `5134a3aa…`, both
  MEASURED): `lite` is §3.3's step-down, is what EVERY past measurement used, and
  a comparison with one side on a CDN is not a comparison. **The contract test's
  centre of gravity moved to "THE SHIPPED DEFAULT IS ONE OF THE MODELS THE BUILD
  WRITES"** — point it at an unfetched variant and nothing else complains,
  because Vite answers a missing `public/` file with index.html at 200.
  **`0.923` is NOT touched (R5.4/R5.7) and its thirteen clips were all recorded
  under `lite`** — whether it still holds is UNKNOWN, nothing observed wrong, own
  🔴 line, fixed by a recording and never by a retune. **WASM stays at 0.10.21**:
  its line said "moves WITH the model swap", but that clause meant "not for a
  tidy-up", not simultaneity — two frame-changing edits at once are
  unattributable, so they are SEQUENCED. **MY CORRECTION, and the standing lesson:
  I told Kd this was blocked on him recording video. It was not** — the recording
  verifies the person gate AFTERWARDS. **A verification you cannot run yet blocks
  the CONFIDENCE, not the WORK; calling it a blocker hands the operator a cost he
  does not owe.** He also corrected me on provenance — **the squat rules WERE
  extracted from expert video** — and ruled that form/rep rules come from expert
  video while the person check, not being a form rule, may come from his own
  clips. **THE AUDIT FOUND THE HARNESS: `mutate-pose-tuning.mjs` had NEVER
  completed a run here** — CRLF file, `\n` anchors, multi-line anchor matched
  nothing; measured PRE-EXISTING against HEAD. Class-fixed in BOTH harnesses (LF
  normalisation, chars via `String.fromCharCode` after the first attempt wrote
  real CR/LF into the source). web 685/685 · assets sweep **25 RED 0 ALIVE** ·
  tuning sweep **13 RED 0 ALIVE, first complete run ever**. **Smoke and T3 UNRUN;
  nothing ticks, including the built model half.**
- **:9003** — 2026-08-17 — **THE §3.6 LADDER CANNOT BE BUILT: the app caps
  itself at 12 frames a second and the spec's trigger is 15.** **Read before
  quoting ANY frames-per-second figure from this project, before building
  anything on `delivered Hz < 15`, and before touching `FEED_INTERVAL_MS`.**
  **KD'S QUESTION FOUND IT** — handed a plan premised on "9.2–12.2 against a
  target of 15" he asked *"wait but it was working with thise 9 12 pictures"*,
  and he was right. `FEED_INTERVAL_MS = 67` is a THROTTLE, so **14.93/s is the
  arithmetic ceiling before any hardware is involved**, and on a 60 Hz display
  `rAF` ticks at 16.67 ms — **66.67 is not >= 67**, so the feed slips a whole
  tick to **12.0/s on a machine doing nothing wrong**. `Math.round(1000/67)`
  printed all of that as "target 15" for months. Both figures are now ASSERTED
  by tests driving the real frame loop, not reasoned. **Consequence: §3.6's
  condition is TRUE ON EVERY DEVICE BY ARITHMETIC**, so a ladder keyed to it
  degrades every user in ten seconds — **and 9.2–12.2 (:8879) / 7.2–12.5
  (:6386) were never evidence about Kd's laptop; 12.0 is the ceiling and he was
  sitting on it.** **KD RULED A over B: report, change nothing** — the rate is
  printed in the camera screen's `debug` panel **BESIDE the ceiling**
  (`12.0 of 14.9/s`, never bare), dash not `0.0` while unmeasurable, no colour
  (that number is unmeasured — R0.2), nothing on the main screen. The bottom
  rung would have hit **:6008** regardless (no automatic switch to hand
  counting, ever). **A module was written, green at 16 tests, and DELETED**:
  §3.6's condition implemented exactly is true on every device forever, i.e. an
  instrument that cannot answer "no". Two OWED lines — **the throttle is NOT
  changed (R1.1/R5.4: the person gate's cut-off and its `nominalDtMs: 82` are
  ONE ruling, :7037/:7298, and 82 ms IS this ceiling), and it is plausibly the
  largest single win available for camera accuracy** — plus §3.6's PostHog
  telemetry (no web client at all, grep-verified). web 682/682 · sweep gains a
  fourth target and five mutants, **22 RED 0 ALIVE**, PA22 pinning the readout
  behind the debug toggle so a later edit cannot put it on screen. **Smoke and
  T3 UNRUN, nothing ticks. Kd's declared NEXT CARD is the strong model**, still
  blocked on a recording WITH VIDEO.
- **:8879** — 2026-08-17 — **THE CAMERA'S TWO DOWNLOADS SHIP INSIDE THE APP —
  smoke PASS, T3 round 1's four Critical/High all fixed.** **Read before running
  any smoke that "cuts off" a source, before quoting the camera's start-up
  saving, and before trusting a `startsWith` assertion.** The sheet's own
  instrument — DevTools request blocking — **did nothing**, and the control
  printed the pass string; replaced by moving files off disk and switching the
  **Wi-Fi adapter** off (loopback is unaffected, which the Offline throttle is
  not). **The saving is ~240 ms (643 vs 884), NOT the ~1.4 s `OWED.md` carried
  since 2026-08-03, and the old "corrupt or LFS-pointer model" cause was false —
  there was no file at all.** **First-ever delivered-throughput reading: 9.2–12.2
  fps against a target of 15.** C/H-1 and C/H-2 are one lesson twice: an
  assertion that cannot fail (`startsWith`) and an invocation nothing reads
  (`package.json` scripts) each left 36 / 674 tests green against a broken app.
  **C/H-3 stays OPEN as 🔴 — no path reaching a real user has ever run the fetch
  script; the Vercel build command is unrecorded.** Bundled WASM is **0.10.21**
  against `package.json`'s 0.10.35 DELIBERATELY — do not tidy it; it moves with
  the model swap.
- **:8707** — 2026-08-16 — **DUAL-WRITE, T3 ROUND 2 (diff-only): ZERO
  Critical/High — THE CARD CLOSES and BOTH `OWED.md` lines TICK.** **Read before
  writing a CORRECTION, before quoting a retry count, and before carrying a
  measured number into a second file.** Four Low, none user-visible. **Low-1 is
  the one that outlives the card: round 1's correction of the summary-id symptom
  was ITSELF false.** "Waits for ever" became "after five retries (~4 s)", and the
  retry is gated on the same `isAwaitingSync` a legacy id fails — it is the FIRST
  failed read, and `xpDisplay.render.test.jsx` asserted "one attempt, no retry",
  green, throughout. Both versions came from reading the retry CONSTANTS instead
  of the BRANCH reaching them, the second shipped into FIVE places inside the fix
  round created to correct the first. **STANDING LESSON: a correction is a claim
  and takes the same evidence as the thing it corrects — V1 does not relax
  because you are fixing something.** Low-2 a fifth copy in M58's own NAME (what
  a future chat reads to judge a red row) · **Low-3 V1 on my own work in the
  session that cited V1 — 631/631 recorded where the suite is 634/634**, carried
  into three files unre-measured · Low-4 `OWED.md` still saying smoke UNRUN /
  sweep KILLED, while L37 had updated the SIBLING line in the same round.
  **Rule 3 measured, not asserted: M63 RED (2), M64 RED (1) — caught by the
  clear-first test ALONE — M65 RED, M66 RED, M60 RED (8).** Reviewer settled the
  open question too: **the smoke pass STANDS, no re-run.** web 634/634 · sweep 64
  · 55 RED · 4 alive · 5 not applied (the pre-existing camera rows).
  `BACKLOG.md` L38–L41.
- **:8610** — 2026-08-16 — **DUAL-WRITE, T3 ROUND 1: one Critical/High — the
  Start button's only error message was DELETED and a comment left behind saying
  it still worked.** **Read before deleting a call that can REJECT, before
  trusting a `catch` to report a storage failure, and before editing inside a
  function a mutation anchor spans.** Removing `createSession` removed the only
  thing in `handleStart`'s `try` that could reject — `setItem` SWALLOWS — so the
  catch went dead in the same commit that documented it as "reachable solely if
  `setItem` throws", naming the one helper that cannot. **Fixed by READING THE
  WRITE BACK, and by CLEARING THE KEY FIRST** — without that half a stale
  `active_session` answers the check and drops the user into the PREVIOUS
  workout, which the reviewer's own proposed one-liner would have done. **L-2 is
  the same class twice in one card: I invented a symptom ("the screen waits for
  ever") and copied it into FOUR places** — `PostWorkout` gates that wording on
  `isAwaitingSync`, keyed by the SYNC id, so a legacy id complains and redirects.
  Corrected at all four sites, struck in place. **L-4's second half outgrew the
  finding: `syncClient`'s refuse-the-whole-workout guard INVERTED** — it kept the
  workout safe in the legacy save, which no longer exists, so refusing now saves
  it NOWHERE; behaviour untouched (R1.1), own 🟡 line, Kd's ruling.
  **THE INSTRUMENT FINDING IS ABOUT THE FIX ROUND ITSELF: the C/H-1 fix inserted
  one line inside a `try` that M60's anchor spanned, so the mutant guarding this
  card's HEADLINE fix silently stopped applying** — :5199's class, one round
  after the entry naming it, caught ONLY because the sweep treats NOT APPLIED as
  a failure. Re-anchored on the signature, re-MEASURED red by a probe that reads
  the mutant out of the committed harness (:4718 F2, :6959). Harness gains a
  seventh target (`utils/storage.js`) and M63–M66. web 634/634; `BACKLOG.md`
  L33–L37. **Card does NOT close — the diff-only re-review is the last gate.**
- **:8452** — 2026-08-16 — **THE LEGACY DUAL-WRITE IS RETIRED — a finished
  workout is written ONCE, and starting one asks no server at all.** **Read
  before deleting anything the no-removal rule has protected, before touching
  `handleStart`/`handleWorkoutComplete`, and before using a network call as a
  test's waiting point.** `createSession` + `completeSession` went TOGETHER (the
  save's only argument was the id the start returned); web only, no migration, no
  endpoint. **:3424's replacement-before-removal ruling DISCHARGED, not waived** —
  all three surfaces re-verified in code first, and the "+50 XP that was never
  awarded" it warns of is unreachable because the NEW server computes `xpEarned`
  (`service.ts:322`). **THE FINDING THAT OUTLIVES IT: the write had not been
  LANDING** — nothing has written `localStorage.accessToken` since Card 1, and the
  old backend takes nothing else (`security.py:16`), so badges, challenges, the
  leaderboard and predictions were ALREADY frozen and cannot have been degraded.
  **THREE THINGS A USER SEES, all improvements:** a workout starts with the old
  backend absent (it did not), it starts OFFLINE (half of Part 6 §3.6's promise —
  the pose model's CDN download is the other half and is still open), and the
  builder is empty afterwards (both `removeItem`s sat inside the legacy save's
  `try`). **THE TEST LESSON: seven tests used the deleted call as their WAITING
  POINT**, four then asserting an EMPTY queue — deleting it would have left them
  passing for the wrong reason in the same commit. :6150's shape from the deletion
  side: **a removal can void an assertion without touching a line of the test.**
  Re-anchored on the now-unconditional `active_session` clear. Also closed a gap
  the card found: **nothing asserted WHICH id opens the summary** (the wrong one
  404s; T3 round 1 L-2 struck this line's original "waits for ever" — it
  complains and redirects). 15 assertions
  measured RED against the pre-card source, sources restored sha256-verified;
  harness gains a sixth target (`api/workoutApi.js`). Two write-only accumulators
  deferred with their own ⚪ line. **WILL tick TWO `OWED.md` lines — the
  dual-write and the offline-start — but NEITHER TICKS YET: smoke and T3 are
  both UNRUN** (an earlier draft of this index line said "Ticks TWO", which the
  entry itself contradicts in its own last sentence; the ORIGINAL wins and the
  index is what gets fixed — CLAUDE.md's 2026-07-30 amendment).
  **THE SWEEP RE-RAN TO COMPLETION 2026-08-16 after being killed part-way: 60
  mutants · 47 RED · 4 ALIVE · 5 NOT APPLIED**, this card's own seven (M56–M62)
  all RED. **The nine bad rows are camera-stall guards this card never touched,
  and "pre-existing" was MEASURED** — the whole pre-card tree restored to HEAD,
  green at 157, all four ALIVE there too. Own 🟡 `OWED.md` line.
- **:8405** — 2026-08-15 — **DASHBOARD STATS, T3 ROUND 3: ZERO Critical/High in
  the code; the redesign holds and the escape hatch did not fire a third time.**
  The only Critical/High is a GATE item — the three new sentences had never been
  seen in a browser, because the recorded 8/8 smoke ran on an account with four
  workouts and the empty pane was never on screen. **Smoke steps 9 and 10
  added.** Two standing lessons: **a fix that duplicates a rule in order to
  correct the duplicate is not a fix** (L26's singular was a fifth inline copy of
  a phrase `totalsWindowLabel` already owned; the redesign added a third copy of
  "≤ 0 is no gate" under a comment forbidding exactly that), and **a correction
  belongs where the false claim is, not only where it was discovered** — a
  disproved sentence was about to be committed into DECISIONS alongside its own
  refutation. Five Lows fixed (BACKLOG L28–L32); the singular's siblings deferred
  as a CLASS with an `OWED.md` line.
- **:8340** — 2026-08-15 — **DASHBOARD STATS, T3 ROUND 2: the STOP trigger fired
  (two rounds, two Criticals, same three lines), Kd ruled for the REDESIGN, and
  the server now answers what the screen had been guessing.** **Read before
  writing any empty state.** Round 1's own fix told every BRAND-NEW account their
  plan was hiding a history they did not have — everyone is gated (no
  subscription → the free plan's 90 days), so a ten-second-old account and a
  lapsed veteran send byte-identical empty pages and the totals endpoint clamps
  by the same floor, reading 0 for both. **`workoutPageSchema` gains
  `hasAnyWorkouts`**; the pane has three arms and the UNKNOWN one is
  load-bearing (`?? false` there re-opens round 1). Not a leak — Part 4 §0.2
  makes the gate access, not deletion. **Round 2 also corrected round 1's stated
  rationale** ("under a tile counting it" — that tile reads 0) and killed a
  fixture the server cannot emit. **Two mutants survived the first sweep and
  both were real gaps**; re-run 7/7 RED, two against real Postgres.
- **:8267** — 2026-08-15 — **DASHBOARD STATS, T3 ROUND 1: ONE Critical/High — an
  empty page under the plan's 90-day read-gate told users with a real history
  that they had none.** **Read before writing any "nothing here yet" empty state,
  and before a reader returns a bare list.** `:5104` F4 from the gate's side
  instead of the parser's; `monthClamp` had solved it by name one screen over.
  **The fix is the SHAPE — `readRecentWorkouts` returns `{ rows, limitedToDays }`
  so rows and the reason they are empty travel together** — a branch fixes the
  case, the shape stops the next caller re-opening it. Also: a caption about an
  unknown number is a claim ("all time" under an em dash), and an existing test
  was pinning that defect. **Fifth instrument finding in six cards** — the
  mutation sweep called six genuine REDs `ALIVE` on a substring sniff against
  ANSI-coloured output; parse the count line, never sniff it. Re-run 6/6 RED.
  Timezone first-render offset DEFERRED with an `OWED.md` line (rule 6).
- **:8156** — 2026-08-15 — **THE DASHBOARD'S NUMBERS COME OFF THE NEW API — and
  the OWED line's own premise ("the weekly count has no home") was FALSE.**
  **Read before touching the Dashboard's figures, before adding a second read to
  a screen that had one, before writing any `toLocaleDateString`, and before
  believing a mutation verdict produced under a `-t` filter.** Web only; no
  migration, no new endpoint, `apps/api` untouched. Composes three P2.3
  endpoints: `overview?period=all`, `trend?period=7d`, `/v1/workouts?limit=6`.
  **The trend endpoint reports workouts per DAY in the user's own timezone, so
  ONE read answers both the "This week" count and the seven dots** — round 10
  F1's "10 of 7 days active" is now unreachable by construction rather than by
  two fields agreeing. **THREE THINGS A USER SEES CHANGE, all corrections:** the
  dots move to the viewer's OWN timezone (the retired `weekDates` keyed by
  `toISOString()` deliberately, to match the old backend's `utcnow()`; round 11
  F1's JSDoc parked the residual as "not this card's to fix" — **this is that
  card**, pinned in BOTH tz directions with the switch positive control, since
  under UTC the assertion is inert, :4267 F2); **"all time" becomes "last 90
  days"** on a gated plan (`period=all` is unbounded so the floor cuts EVERY
  time — :598's f.4 on the first screen a user sees; `totalsWindowLabel` joins
  `heatmapCaption`/`recordsNote`, one ladder); and a recent workout's duration
  stops being rounded to minutes (:4182, closed by reusing the CALENDAR's row
  reader and formatters). **KD'S QUESTION — "is this becoming India-specific?" —
  was CHECKED, not answered:** `PostWorkout.jsx:133` forces `'en-IN'` on every
  user on earth and four sites force `'en-US'`; the Dashboard's own copy is fixed
  here because that line was already being rewritten, the rest get an OWED line
  naming every sibling (:1239, the class not the case). **`gyms.timezone`'s
  `Asia/Kolkata` is the SPEC's own DDL** (`04-part4-database.md:172`), not a
  defect; his wider privacy-scope point stays open at :592.
  **THE AUDIT FOUND WHAT REVIEW AND WRITING THE CODE DID NOT: nothing pinned
  WHICH windows the page requests** — every fixture mocks the network functions,
  so `period=30d` captioned "all time" passed every other test. **And the audit's
  own row was wrong first: P5 came back ALIVE because it named a test reaching
  the UNKNOWN arm, where the mutant is inert** — re-aimed it fails `expected +0
  to be 2`. :4718 F2 from the other side (that was RED for the wrong reason; this
  ALIVE for the wrong reason), and the FOURTH instrument finding in five cards.
  **The totals will DROP for pre-August history** — the new DB holds only what
  has synced; P2.8 migrates the rest, and Kd was told before the card ran.
  web 615/615 (+29) · `vite build` ✓ · 15 mutants 15 RED 0 ALIVE, restores
  sha256-verified. **:3424's condition for retiring `completeSession` +
  `createSession` is now MET so that pair is UNBLOCKED — it retires in its OWN
  card and nothing about how a workout is SAVED changed here.** **OWED does NOT
  tick: smoke and T3 both unrun.**
- **:8072** — 2026-08-15 — **REST-IN-FULL-VIEW: the instrument is built and KD'S
  CLIPS DO NOT CONTAIN THE DEFECT — measured, and the all-clips table is a TRAP.**
  **Read before running `measure-rest.ts`, before quoting any row of its table, and
  before asking Kd to rule on a stillness cut-off.** The card is blocked on a
  RECORDING, not on a ruling; **do NOT re-run the measurement and do NOT splice a
  rest instead.** `measure-rest.ts` replays through the real definition with
  `stillness` (§3.4 #21) declared, rebuilds rep windows from public outputs only,
  and **ABORTS if the extra signal moves the rep count** (it did not). Direction is
  INVERTED from the person gate — stillness fires on `<=`, so `cutoffAtPersonCost`
  and siblings are deliberately not reused (:6959's M9 class). **Measured:
  `me_standing` is UPRIGHT — 1 frame of 1,268 at or below `upAt` — and the
  `both_*` armed-not-repping stretches are 0.2 s gaps BETWEEN reps.** **THE TRAP:
  over all seven person clips a 1%-cost cut-off removes 9.0 s of 20.8 s, but
  12.4 s of that 20.8 s is `me_and_furniture` ALONE — the chair-skeleton clip
  (:6386) — and re-priced on the six clean clips the same cut-off removes 0.0 s of
  8.5 s.** :7037's "separation is not the outcome" recurring from the other end: a
  pile that separates beautifully may not be made of what you think. Unblocked by
  `RUNBOOK/record-rest-clips.md` (written, unrun), whose three load-bearing
  instructions are that Kd must NOT pause, NOT leave frame and NOT end the set
  during the rest, since each is already fixed and would hide the defect. **Kd
  deferred the recording the same day; the 🔴 OWED line stays open.** No cut-off
  chosen, no app code changed.
- **:7974** — 2026-08-15 — **REP TIMING + PAUSE, T3 ROUND 1: ZERO Critical/High,
  the packet SHIPS, and BOTH 🔴 `OWED.md` lines TICK.** **Read before writing a
  comment that asserts an invariant, before trusting a sweep that compares a field
  to a number the TEST computed, and before adding a formula-selection branch
  keyed on one payload field.** Covers both commits (`faa7f06` API half,
  `8c2d204` pause fix); Kd approved the fix round before any file was touched.
  Escape hatch NOT armed. **L19 is the one with teeth and it is MINE, twice over:**
  the `watchedMs` comment claimed the number "can never exceed the span … Asserted
  rather than assumed" and **both halves were false** — `lastT` is stamped before
  the ingest check so an out-of-order frame moves the span BACKWARDS (probe:
  watched 8400 / duration 1), and **every sweep compared `watchedMs` to a span the
  TEST computed from the fixture, never to the summary's own `durationMs`**, which
  is the claim the server relies on. Second occurrence on this card, three lines
  from where L17 corrected the first. Fixed BOTH ways (true comment + a test
  comparing the two FIELDS); **mutant M16 is caught by the NEW test ALONE — 1
  failed, 22 passed**, and those 22 are the sweeps that looked like coverage.
  **L20: the v3 budget cap on a HAND-COUNTED set had no mutant and no test —
  measured `*** ALIVE ***` before the fix**, on the branch that prices the 55
  exercises with no engine definition; A6 now RED. **L21** (v1/v3 selection
  asymmetry, unreachable today, own ⚪ OWED line) · **L22** a 126-char line.
  **THE PATTERN, RESTATED AT FIVE: seven of this card's findings across four
  rounds were in the APPARATUS, not the shipped behaviour** — the code kept being
  right and the instruments kept not knowing it (:7634 named it at three).
  **And the fix round hit R5.1's own trap: the CI purity grep READS COMMENTS**, so
  naming the browser clock inside `packages/engine/src` would have failed the gate
  that enforces engine purity — caught by running the Appendix grep, not by review.
  engine 213/213 · shared 48/48 · web 586/586 · api 444 of 445 (the one red is the
  pre-existing `db.migration.test.ts` flake, own OWED line, not in this diff) ·
  tsc 0 · eslint 0 · purity grep silent.
- **:7929** — 2026-08-14 (same evening) — **THE SMOKE PASSED, and the STORED ROWS
  carry the claim rather than the screen.** **Read before designing a smoke for
  anything a user cannot see, and before reading a "close enough" comparison as
  evidence.** Kd ran three workouts in his own browser: **A normal 3 kcal · B
  paused 60 s 5 kcal · C walked away 60 s 4 kcal**, "all passed". His report is a
  REPORT (:4829); the measurement is the rows, and they are unambiguous — **B's
  sets LASTED 96 s and 94 s and the camera was credited with 30 s and 31 s**, so
  ~64 s per set was thrown away, while A's clean sets show watched ≈ length. All
  stamped `kcal_calc_version` 3 with `watched_ms` populated, proving engine →
  payload → column → formula end to end in a real browser. **THE SHEET'S WEAK
  POINT, named: B came back at the EDGE of the tolerance I wrote (3→5), and the
  rows are what showed the gap is not the pause but his own slower reps** (2.0 s
  and 3.1 s each vs 1.5 s and 1.4 s — 30.6 s of rep time against 17.4 s); every
  number he saw re-computes from its own row through the shipped formula.
  **Standing lesson: for an invisible quantity, design the sheet to produce the
  ROWS and let them carry the claim — a "within 1 or 2" expectation is a coin toss
  dressed as a criterion.** T3 still unrun; nothing ticks.
- **:7863** — 2026-08-14 (same evening) — **THE PAUSE IS FIXED AT THE ONLY PLACE
  THAT KNOWS: the client tells the engine it stopped feeding.** **Read before
  adding any new way for the frame feed to stop, before splitting
  `framesResumed()` back into two methods, and before writing a second rep mode.**
  Kd: *"i understand the pause problem no need to see the problem with my own eyes
  just solve the problem"* — taken immediately after :7730 committed. Pause tears
  the feed down so NO frames arrive, and the timestamps in the frames that resume
  have moved on, so the pause sat inside the open rep and inside watched time:
  **127,000 ms billed against 8,400 ms watched, 14.82 kcal against a truth of
  0.98.** Fix: `EngineSession` gains **`loseSight()`**, the bridge calls it on
  every resume, and it routes into the SAME path both blindness kinds already
  take — no new threshold, no second mechanism. **Three decisions worth not
  re-deriving:** it is ON THE INTERFACE so every future rep mode must answer the
  question rather than inherit nothing (:7575's warning — it bit at once, the
  scripted test engine would not compile until it answered); **`resetScene()`
  became `framesResumed()` and the rename IS the design** (two consequences of one
  event, discovered a card apart — a caller cannot remember half of one method,
  and the old name would have become a comment/behaviour mismatch); and it is
  declared on RESUME, which is identical in effect because no frames arrive in
  between. **The server's timer budget STAYS** — now belt-and-braces, still the
  only defence for clients that declare nothing. engine 212/212 · web 586/586 ·
  4 mutants 4 RED 0 ALIVE, covering BOTH resume sites because the hidden-tab one
  is what a rename drops quietly. **NOT TICKED: Kd declined the DEMONSTRATION,
  which is not the same as waiving the smoke, and no chat widens a ruling for
  him.**
- **:7730** — 2026-08-14 — **THE API HALF: the server stops GUESSING how long you
  exercised — the camera reports what it WATCHED and the bill follows it. And a
  PAUSE is billed as squatting, which the new field CANNOT see.** **Read before
  touching `kcalPointForSets*`, before adding a field to a §2.4 document, before
  writing anything that reasons about a pause, and before assuming `watchedMs`
  means what its name suggests.** **KD RULING, approved before any code and
  partly REVERSING his own 2026-08-11 wording** ("the part-measured reps still set
  the rate"): that clause was never a measurement, it was a workaround for the
  missing number, and it was the one place his part 2 was inverted — it billed an
  all-interrupted set ~20% low (:7487). Now: `SetSummary.watchedMs` (**OPTIONAL,
  which is what holds Part 2 §10's byte-match gate BY CONSTRUCTION** — the §2.4
  document still round-trips; pinned `null` for log-only), migration
  `0010_set_watched_ms` (**nullable; NULL = nobody told us, not zero; NO CHECK
  against `duration_ms` on purpose — a violation is a 500 and R10.3 jams the queue
  on one**), and `kcalPointForSetsV3` selected by the payload's shape. The
  2026-08-07 three tiers are unchanged; only where the numbers come from moved —
  unwatched time now costs NOTHING (v2 billed it at `REST_MET`) and a rate-less
  set is billed at its watched time. A ZERO-rep set still charges nothing at the
  exercise MET. **THE FINDING TO CARRY FORWARD: a mid-set PAUSE feeds NO frames at
  all, so it lands inside `watchedMs`** — measured, 70 of 84 positions bill
  127,000 ms against 8,400 ms watched, **14.82 kcal where the truth is 0.98** —
  and it is **PRE-EXISTING, asserted by a test: v2 bills the identical figure**.
  The timer is now a BUDGET, which brings that case to 1 kcal, but **a clamp is
  not a fix** (:7222's warning) and does nothing without a timer; own 🔴
  `OWED.md` line. **Two defects of mine, both found by instruments not by
  reading**: my own comment claimed a guarantee the code lacks (L17, the class
  this repo records most), and **M11 came back ALIVE because the blank path never
  consults the FSM** so a blank-only sweep could not see it (L18 — the fixture's
  shape, third time on this card). `apps/web` untouched. engine 208/208 · shared
  48/48 · api 443 of 444 (the one red is the PRE-EXISTING `db.migration.test.ts`
  timeout flake, not in this diff — its OWED line is widened from one test to the
  file) · web 585/585. **The OWED line does NOT tick — smoke and T3
  are both unrun.**
- **:7634** — 2026-08-14 — **REP TIMING, THE DIFF-ONLY RE-REVIEW: ZERO
  Critical/High, the packet SHIPS — and BOTH Lows were about the EVIDENCE, not the
  fix.** **Read before trusting any "byte-identical / all restored" line from a
  mutation harness, before writing a rep-timing fixture, and before re-adding the
  retired M5 mutant.** Escape hatch NOT armed (needs Criticals in the same
  subsystem two rounds running; this round found none). **L15** — safeguard 5
  restored every target then compared them to the snapshot it had just restored
  from, so it printed "byte-identical" unconditionally, **and that sentence had
  been quoted as evidence in the previous commit**; `dirty` is now computed BEFORE
  `restoreAll()`, proven both ways with an injected dirty file (old order exit 0,
  new order exit 1, tree clean after). **L16** — the headline promise ("never bill
  more than the camera watched") was asserted nowhere on the all-interrupted
  fallback :7487 added, because every billing sweep uses a ONE-absence clip which
  always leaves a rep watched end to end; a two-absence sweep now pins it,
  non-vacuity proven two ways. **THE PATTERN, NAMED: three rounds, three defects
  in the apparatus rather than the code** (L13 a harness that did not exist, L15
  one that could not fail, L16 a promise never asserted). **M5's retirement was
  re-derived and CONFIRMED** — deleting `cycleStartT = null` leaves all 14 timing
  tests green because `fsm.ts:158` re-pins anyway; do not re-add it. A NARROWER
  mutant (`rearmCycleOnNextUsableFrame = false`) fails only the negative-timing
  guard — it ZEROES durations, so it is not a billing mutant. 9 RED 0 ALIVE; no
  app code changed; the `OWED.md` line does NOT tick (API half still owed).
- **:7575** — 2026-08-14 — **KD'S QUESTION: can one exercise's rules interfere
  with another's? MEASURED — mostly no, and the "mostly" is ~20 squat-shaped
  constants.** **Read before adding an exercise definition, before editing any
  `export const` in `packages/engine/src/pipeline/`, and before building a second
  rep mode.** ISOLATED, verified by command: the engine holds **zero**
  module-level mutable state, names **no exercise** in any logic (R5.6 holding in
  fact), and each definition carries its own `upAt`/`downAt`/`countOn`/
  `minRepMs`/`maxRepMs`/`bilateralGate` — adding an exercise is adding a data
  file. **THE ONE REAL PATH TO INTERFERENCE:** ~20 constants are shared by all 58
  and their comments name `rep_counter.py` — squat-shaped numbers everything
  inherits. Verified case: `Math.max(MIN_REP_INTERVAL_MS, config.minRepMs ?? 0)`
  lets a definition make the rep gap only LONGER, so a fast exercise cannot go
  below 450 ms without editing the constant every exercise reads. **The golden
  traces CATCH that edit, they do not PREVENT it — and they assert NO timing**
  (L14), so a duration-only shift passes green. **Remedy when first needed:
  promote the constant into the definition schema with the engine value as
  default; never retune the shared one** (R5.4, R5.7). **AND THE ONE A LATER CHAT
  WOULD MISS: three of four rep modes do not exist and today's rep-timing fix does
  NOT carry to them** — `session.ts:88` builds `ModeAFsm` unconditionally, so
  hold/alternating-sides/cadence each need the lost-sight re-arm rule written
  again. **A plank whose hold clock swallows an absence is Kd's defect again, in
  the mode where it is worse** — a hold IS a duration, so no rep count exposes it.
  Two `OWED.md` lines; no code changed.
- **:7487** — 2026-08-14 — **REP TIMING, T3 ROUND 1: one Critical/High — a set
  could report ZERO seconds per rep, and the review's OWN proposed fix bills
  LESS.** **Read before changing what goes into `tempoMsAvg`, before quoting
  "null and 0 bill the same", and before writing a rep-timing fixture on the
  two-rep clip.** A rep can be watched for literally no time (`fsm.ts` re-pins the
  clock, the user returns already standing, the rep closes on that same frame —
  `t - t`) and the all-interrupted fallback averaged that zero in: measured on the
  one-rep clip, **reps 1, `tempoMsAvg` 0** against 3,400 ms clean, on BOTH paths.
  **STANDING LESSON — the FIXTURE's shape was the hole, not the assertions:**
  every sweep ran on the TWO-rep clip, where one absence interrupts at most one
  rep, so a whole-watched rep always survived to set the rate and the fallback
  branch was never evaluated. **THE REVIEW'S FIX WAS MEASURED AND REJECTED:**
  `null` is identical to 0 only in the degenerate case; on a set shaped like Kd's
  own smoke, **honest 10 kcal · today 8 · the review's null 6** through the real
  `kcalPointForSetsV2`. Its "a null tempo is a shape no reader has seen" premise
  is false too — `buildLogOnlySet` already ships `reps > 0` with a null tempo —
  **so the defending comment was wrong twice, in opposite directions, and only one
  error favoured the code it defended.** M9 pins the rejection. **Kd approved the
  fix in plain words: a rep watched for NO time is not a measurement, so it is
  dropped; the part-measured reps still set the rate.** **The audit retired its own
  dead mutant** (M5, the `cycleStartT` re-pin, REDUNDANT with the bookkeeping's
  `??=` — 67 ms on an unmeasured rep). Low ×3: **§3.1's count of three is enforced
  TWICE and only the ingest half was pinned** (loosening the FSM's to 30 left all
  199 green); the "6 mutants 6 RED" harness was never committed (:5199's class);
  `assertTrace` covers no timing at all — own OWED line. engine 203/203 · 9
  mutants 9 RED 0 ALIVE. **Does NOT close the ~20% under-bill on an
  all-interrupted set — that needs a WATCHED-TIME payload field and is OWED.**
- **:7404** — 2026-08-11 — **AN ABSENCE STOPS BEING BILLED AS EXERCISE (engine
  half) — and KD'S QUESTION FOUND THE SECOND WAY IN, which this does NOT close.**
  **Read before touching rep timing, before keying anything to "the camera lost
  the user", and before assuming the absence sweep covers this defect.** The R9.5
  test committed red at `84ff14d` is green on BOTH paths a user can take.
  **The fix in one sentence: a rep's clock re-arms when the camera stops being
  able to watch, and the part-measured rep is left OUT of the set's average
  tempo** — part 2 is Kd's, because `reps × tempoMsAvg` is what the server
  charges, so averaging a half-measured rep in trades an over-count for a quieter
  UNDER-count. No payload shape changes. **COUNTING IS PROVABLY UNMOVED** (state,
  `reachedBottom`, both debounce counters and the smoothing buffer all hold):
  2 reps at all 84 positions before and after, now pinned by a test.
  **KD'S FINDING, NOT FIXED HERE: a rest taken IN FULL VIEW is billed as
  squatting if the knees are slightly bent.** Measured — upright (178.8°) costs
  nothing at any length; 159.3° bills the WHOLE rest, a 60 s rest reporting rep 2
  as 63,931 ms. Both are "standing still" to the user; the clock arms on the first
  frame at or below `upAt` and clears only on a completed rep, so an invisible
  160° line decides the number. **Same line of logic as the absence — one window,
  two entry points** — and it fits Kd's original 21,267 ms better than the absence
  does, though **the stored row cannot say which occurred** (recorded as a fit,
  never a cause). Own OWED line, own card; it needs a NUMBER (still vs descending)
  that R0.2 forbids inventing and §3.5's stillness precedent says must be
  definition-declared. Kd ruled the split.
  **The occlusion path was added ON EVIDENCE and pre-approved**: every frame
  valid, legs unmeasurable, bills **127,200 ms against 8,400 ms watched** — the
  same size as the absence and invisible to the committed sweep. Both key to
  §3.1's count of 3. Parity risk re-measured for BOTH kinds: nine clips carry
  zero unusable frames either way; the tenth is 600/600 unmeasurable and expects
  zero reps. **`cycleMin` is deliberately NOT re-armed** — a first draft that
  reset it emitted `romExtreme: Infinity` into `romStats` and the chair target;
  the depth was really watched, only the CLOCK lied.
  **THE RED-TEST COMMIT DID NOT TYPECHECK OR LINT and only `tsc` said so** —
  `RepEvent` imported from the engine, which re-exports it nowhere, while vitest
  ran green because esbuild strips types without checking them; the fix then
  exposed a dead `summary?.reps ?? 0` that would have reported **0 reps**.
  **A green vitest run is not evidence that a test file compiles.** Low, in
  `BACKLOG.md`. engine 199/199 · web 585/585 · 6 mutants 6 RED 0 alive, restores
  sha256-verified; **the harness ABORTED on run 1** (\n anchors vs CRLF files) —
  :4267 and :5199 working together. **OWED does NOT tick: the API half is
  unwritten and T3 is unrun.**
- **:7298** — 2026-08-10 — **PERSON CHECK, T3 ROUND 1: two Critical/High — the
  screen saying "Not counting" while it counted, and the ruled cut-off meaning a
  different strictness on every machine.** **Read before touching
  `sceneGate.js`, before writing a sentence that outlives the condition that
  raised it, and before treating a per-second rate in `discriminators.ts` as a
  property of the frames.** Neither finding touched Kd's number. **C/H-1:** the
  message is held ~14 frames so it can be READ, but counting resumes on the
  FIRST clean frame — measured, a rep was counted under that sentence on FOUR of
  the six clips of Kd. Two sentences now, and in the tail a live engine cue
  outranks it. **C/H-2:** `bone_stretch` is a rate per second and
  `FEED_INTERVAL_MS` is a FLOOR — his laptop achieved a pooled median 82.1 ms
  over 12,075 pairs, a faster machine reaches 67, so the gate read ~1.22x higher
  there and **lost a real rep on two of six clips**, the exact harm
  `motion_incoherence` was rejected for (:7062). **The fix is a UNIT, not a
  threshold**: a bone does not change length when its owner moves, so the
  conversion was injecting the machine's speed — `nominalDtMs: 82` joins the
  cut-off because **a cut-off and the cadence it was measured at are ONE
  ruling**. **THE RULED TABLE MOVED, BETTER ON BOTH SIDES: invented 11 -> 2 (the
  ruling said 3), all 66 real reps kept, person frames silenced 4.5% -> 1.8%.**
  82 is measured, not tuned — 75 scores better and picking it for that reason is
  a threshold from judgement. **THREE INSTRUMENT FINDINGS, and two are my own
  tests: BOTH first-draft regression tests were VACUOUS and only mutation found
  it** — one asserted a property over a fixture whose reps never reached the
  state (true of an empty list), the other compared two cadences on clips an
  order of magnitude either side of the cut-off, where doubling moves nothing.
  **A gate lives in the tails and so must its test.** Third: `measure-pose.ts`
  built its own gate without the new field, so the committed instrument would
  have measured a DIFFERENT gate from the app (:5199's class) — `--nominal-dt`
  added here. PG12 aborted the sweep on a drifted anchor (:4267 working);
  PG15b was ALIVE because its `expect` named a suite that never ran. web
  585/585 · engine 190/190 · 23 mutants, 22 RED, 1 ALIVE (PG14), 0 never ran.
  **OWED does NOT tick — the diff-only re-review is unrun.**
- **:7222** — 2026-08-10 — **THE PERSON-CHECK SMOKE PASSED — ZERO reps from the
  chair — and KD'S INSTINCT FOUND A CRITICAL/HIGH THE PASS WAS SITTING ON TOP
  OF.** **Read before writing a smoke doc, and before touching `calories.ts` or
  the engine's rep timing.** Two minutes of a room with a chair and nobody: the
  counter did not move (measured starting point was 10 invented reps across four
  clips, :6856). Stored row corroborates independently — both sets `mode
  ='engine'`, real scores 93/100, set 2 an uninterrupted 7 reps in 34.3 s. **What
  the row CANNOT show is said rather than glossed**: it holds the final count,
  not the count over time, so the headline number exists only in Kd's report.
  **THE FINDING: he accepted every step, then asked why 14 reps burned 22 kcal.**
  Reproduced from the stored fields — rep time is `reps × tempoMsAvg` capped at
  the set span, his set carried **21,267 ms per squat**, so **171.7 s were billed
  at the squat MET inside a 161.0 s workout.** Cause measured in the engine
  (`fsm.ts:167`, `cycleStartT ??= t` cleared only by a completed rep while a null
  metric holds): sweeping a 120 s absence across the golden squat, **60 of 108
  start points give one rep of 123,100 ms.** **NOT the person check's defect —
  and the check makes it far more likely**, because long in-set silences are now
  designed behaviour where invented chair reps used to keep resetting the clock.
  Own OWED line, own card, R1.1. **STANDING LESSON: a smoke doc bounds what gets
  CHECKED, not what is WRONG.** Eight numbered questions all passed; the defect
  was in the one figure nothing asked about. **:5906's "found by Kd's instinct
  alone", recurring on the screen next door.** **T3 UNRUN — the OWED line does
  NOT tick.**
- **:7104** — 2026-08-10 — **CARD 4 STEP 3: THE PERSON CHECK IS WIRED AND THE
  SCREEN SAYS SO — the first change in the whole camera card a user can see.**
  **Read before touching `apps/web/src/engine/sceneGate.js`, before writing an
  assertion about a threshold as a SHARE, and before adding any sentence to the
  camera panel.** Every frame the app feeds the engine goes through `PersonGate`
  first at the ruled setting; a blocked frame reaches the engine with **no
  landmarks**, byte-identical to what `measure-pose.ts` replayed. The ruled
  numbers sit in ONE frozen object and a test asserts it **whole** — **the
  assertion with the most teeth here, because mutant PG2 nudges the cut-off to
  0.5, which sits between the two piles exactly as 0.923 does, so every
  behavioural test stays green while the app silences a different set of a real
  user's frames.** THE SCREEN: no verdict on a blanked frame, and after **3
  blocked frames in a row** (§3.1's own count — the frame where the engine would
  otherwise show its OWN "cannot see your legs" at a user in full view, :6150
  C/H-2) the panel says *"Not counting — the camera isn't sure it's looking at
  you"*, clearing after **15 clean frames** (a UI patience threshold in the
  `ENGINE_STALL_MS` tradition; without an off-delay the sentence flickers). **The
  cue key is NOT from Appendix A** and names no cause, by test. **THE AUDIT
  CAUGHT MY OWN TEST: PG1 survived** — a tenfold-loosened cut-off, and the
  "blocks furniture" assertion stayed GREEN because it asserted a SHARE; **a
  share is satisfied by a threshold loosened until it barely works.** Restated as
  an absolute. The harness also caught its own ANSI-strip defect on run 1, in the
  fail-safe direction (:6532's twin), and EOL-normalises anchors per file
  (:4267's class from the authoring side). **PG14 is ALIVE with its reason
  recorded** (:5618's M6 precedent). web 578/578 · engine 190/190 · `vite build`
  ✓ · 17 mutants, 16 RED, 1 ALIVE, 0 never ran. **SMOKE UNRUN, T3 UNRUN, the
  OWED line does NOT tick.**
- **:7037** — 2026-08-10 — **KD RULES THE CUT-OFF: `bone_stretch > 0.923`, that
  signal ALONE — and the cross-check is what killed the signal that scored just
  as well.** **Read before quoting a separation number as if it settled
  anything, before adding a second signal to the gate, and before ruling from
  one recording session.** The OWED rule is satisfied as written: measured
  first, ruled by Kd on a table showing the cost on BOTH sides, in plain words.
  **11 invented reps → 3 across both sessions, with all 66 reps on the six clips
  containing Kd still counted.** **`motion_incoherence` (0.980 separation vs
  `bone_stretch`'s 0.983 — indistinguishable on paper, and :6856 named both)
  LOSES A REAL REP IN BOTH SESSIONS** at every cut-off tried, and every
  combination containing it inherits that. **STANDING LESSON: SEPARATION IS NOT
  THE OUTCOME** — a gate does not fire on a distribution, it fires on the
  frames of a particular rep, which is what section 6 replays. **Had only
  session 2 been run, Kd would have been handed the rep-eating combination.**
  Does NOT reach zero (3 survive on `chair_A`); still one room, one chair;
  silences 4.5% of a squatting person's frames, longest 18f (~1.5 s) — **so
  step 3 must make the screen SAY it (:5807).** `apps/web` untouched: **the
  ruling changes nothing on screen by itself.** Wrinkle: `Desktop\traces`
  contains a stray `.detect (2).jsonl` that correctly ABORTS the script.
- **:6959** — 2026-08-10 — **PHASE 2 CARD 4, ENGINE HALF: the person gate is
  built, tested and committed — and was found holding its own mutant.**
  **Read before touching `src/scene/`, before quoting an operating-point table,
  before writing a mutant by hand, and before telling Kd he must record or run
  anything for this card.** `PersonGate` answers block / do-not-block per frame
  and chooses NOTHING (signal, cut-off and mode are arguments; the screen belongs
  to the web bridge, 2026-08-07). Two pinned properties: **no reading means
  PASS**, and every signal runs one way so the test is always `reading > cutoff`.
  `discriminators.ts` moved `scripts/` → `src/scene/` so **the code Kd rules a
  cut-off on IS the code that enforces it**, sharing one `RollingWindow`.
  **THE DEFECT INHERITED: `shareAbove` compared `>=` while the gate blocks on
  `>`** — and every cut-off `cutoffAtPersonCost` returns is one of the person's
  own readings, so the boundary is the NORMAL case, not a tie. **M9 mutates that
  exact line: the source was left holding a hand-typed mutant.** New corner of
  :5199 — **the harness's byte-exact restore protects only mutations run THROUGH
  it.** Caught because M9's anchor then matches nothing and the sweep aborts,
  which proves **no full sweep had run against the inherited tree.** Permanent
  guard added from the other side (:5348 rule 5). **THE BLOCKER THAT WASN'T:
  both clip sets are on the dev machine (`Desktop\traces`, `traces2`), so the
  gate simulation is a command a chat runs — Kd rules the number, he does not
  produce the evidence.** engine 190/190 · 18 mutants 18 RED 0 ALIVE ·
  **NO CUT-OFF CHOSEN and the gate is wired to NOTHING — `apps/web` untouched,
  so the invented chair reps are still there.**
- **:6856** — 2026-08-09 — **THE SWEEP SESSION FAILED AND THE STAMP CAUGHT IT:
  eight clips, four addresses, ONE set of settings — and the fresh data says the
  gate may be the whole fix.** **Read before writing any operator instruction,
  before putting settings in a URL in this app, and before citing :6386 on
  whether furniture destroys counting.** All eight of Kd's clips came out at the
  DEFAULTS: `App.jsx:150` routes `/` to a bare-path react-router `Navigate`,
  which carries **no search string**, so the settings died before login. **Only
  card 2's `provider` stamp revealed it** — without it the comparison would have
  "shown" that no setting changes anything, the most confident wrong conclusion
  available. Fixed by capturing the URL once at first import into
  `sessionStorage`, with `main.jsx` importing `poseTuning` first and explicitly
  so lazy-loading a page cannot break it later.
  **THE STANDING LESSON IS THE INSTRUCTION, NOT THE ROUTER: the operator's check
  was "a yellow line appears — if you do NOT see it, stop", and Kd did not notice
  the absence and recorded all eight clips. Asking a person to spot a MISSING
  thing is not a check.** The widget now shows the settings ALWAYS, grey
  `(default)` or yellow with values, so the check compares two visible lines.
  Same family as :5034 and :6062.
  **WHAT THE CLIPS DID PROVE, at defaults: the four empty-chair clips counted
  6, 2, 0 and 2 reps — ten reps invented from an empty room — while Kd reports
  counting was CORRECT with him in frame** (engine counted 13/11/12/14).
  **That is a material change from :6386's "furniture EATS reps"**: conditions
  differ between sessions (chair detection 59–76% here vs 95.9% there), neither
  session is wrong, and the defect is situational — its worst measured form is
  now INVENTED reps, not lost ones.
  **Two independent sessions now agree on the discriminators**: `bone_stretch`
  0.985 and `motion_incoherence` 0.976 are strong in both, and **`centre_drift`
  — :6386's own lever — is the weakest in both (0.765).**
  **RECOMMENDED TO KD: build the gate, keep the now-working sweep in reserve** —
  it saves him 25 minutes and the gate addresses the measured harm. His call.
  Also verifies **:6008 is NOT regressed** (`countItYourself` carries no
  `engineStalled`; the button was offered and he took it).
  web 552/552 · 13 mutants 13 RED · `poseTuning.test.js` moved to jsdom because
  the node default has no `sessionStorage` and would have proved nothing.
- **:6749** — 2026-08-09 — **PHASE 2 CARD 2: the recorder stamps a definition id,
  the camera's four settings become testable, and a dial nobody chose was reading
  ZERO.** **Read before touching `usePoseDetection`'s MediaPipe options, before
  recording any trace, and before writing a fallback for a value that might be
  absent.** **THE DEFECT IS THE ONE TO KNOW: `Number(null) === 0`, so every dial
  the URL did not mention read as 0.0 rather than the 0.5 default** — merely
  opening the app would have set the pose model to *trust anything* and the trace
  header would have recorded that as deliberate. Caught by the test written with
  the file, not by review; :5543's shape for the fourth time — **a condition
  identified by what it LACKS rather than what it IS.** Guard is now an explicit
  `present()`; mutant P1 restores it.
  **THE INSTRUMENT OWED LINE IS TICKED, BOTH HALVES, AND THE GOLDEN-TRACE BAN IS
  LIFTED** — `definitionIdFor` resolves through `getDefinition`, the SAME lookup
  the engine uses, so header and engine cannot disagree; `--exercise` now applies
  only to clips recorded before 2026-08-09. The expression that caused the bug
  existed TWICE in `ActiveWorkout.jsx` and is now one `const` (:4556 F1).
  **Dev-only dials** (`apps/web/src/dev/poseTuning.js`): `model`, `numPoses`,
  `detectConf`, `presenceConf`, `trackConf`, gated on `import.meta.env.DEV`
  **alone and deliberately** (an env var can be set in a prod build; `DEV` cannot),
  model URLs from a frozen map never interpolated from the query string.
  **§7.1's header gains an OPTIONAL `provider` block** recording which settings
  produced a clip — captured at START not stop (mutant T3), printed as **"NOT
  RECORDED"** rather than defaulted when absent, because "no settings recorded"
  and "recorded at the defaults" are different claims. R0.2 reasoning stated in
  the entry rather than slipped past. **Records a synergy for card 3 to test, not
  to assume: `numPoses: 2` returns candidates instead of a winner, and card 1's
  `motion_incoherence` is exactly the rule for choosing between them.**
  web 545/545 (+16) · 11 mutants 11 RED · **`ActiveWorkout.jsx` lint identical to
  HEAD, measured by checkout-and-compare with a sha256-verified restore.**
  **Nothing recorded, no setting chosen — Kd runs
  `RUNBOOK/record-camera-settings-sweep.md`, 8 clips, ~25 min.**
- **:6662** — 2026-08-09 — **THE WOBBLE TEST RAN ON THE REAL CLIPS: it works,
  and the signal :6386 built phase 2 on is the WEAKEST of the four.** **Read
  before citing :6386's jitter figures, before designing the camera gate, and
  before telling Kd to run a command on his own machine.** Clean piles (person =
  `me_squatting`+`me_standing`, nobody = `furniture_only`): **`motion_incoherence`
  0.967 separation, catching 80% of furniture at a 5% cost to real frames** ·
  `bone_stretch` 0.949 · **`centre_drift` — :6386's lever — 0.865, catching just
  7.6% at that cost** · `limb_asymmetry` 0.790. **:6386's ratio of medians was
  real and is not a separation**: the distributions overlap in the tails and a
  gate lives in the tails. The signal that works is the one :6386 did not have.
  **THE PRODUCT NUMBER: on `me_and_furniture` the gate fires on 44.8% of frames
  — so it detects the bad read, and that is ALL it does.** It converts "silently
  counts wrong" into "says it cannot see you", and it stops the voice babbling
  (:6386's 85.6%), **but it does NOT make the model track Kd instead of the
  chair, so his "i do proper squat and it does not count" is not fixed by a gate
  alone.** Both halves are needed; Kd was told so when it was measured.
  **Carries a methodological error of mine, corrected in-session**: `empty_room`
  was first put in the nobody pile though :6386 already showed its 58% detection
  is Kd walking in and out, which inflated every score. **And a third doc defect:
  the runbook shipped a command that cannot run** (`--filter` already sets cwd,
  so the full path doubles) — in a doc that cited :5034's "instruction with no
  working command behind it". **KD'S CORRECTION IS THE STANDING ONE: CLAUDE.md's
  PROVE rule ("a chat cannot run your repo") describes the upload-a-zip chat
  workflow, NOT Claude Code with a terminal** — when the files and the repo are
  local, run it. **No cut-off chosen; one chair, one room; the OWED rule binds.**
- **:6532** — 2026-08-09 — **PHASE 2 CARD 1: the jitter lever becomes a
  COMMITTED instrument, and the measurement script can no longer half-run.**
  **Read before proposing any phase-2 camera work, before quoting :6386's jitter
  numbers, and before writing a mutation harness that strips ANSI colour.**
  **The finding that justified the card: :6386's headline lever was
  UNREPRODUCIBLE** — the whole basis for phase 2 came from a throwaway script
  that no longer exists (grep-verified), which is :5199's class applied to the
  one number the card rests on. Now `packages/engine/scripts/discriminators.ts`:
  pure, unit-tested, mutation-audited, portable into the web bridge.
  **:6386's figures will NOT reproduce and that is not drift** — rates are per
  SECOND (browser frames arrive irregularly and the gate will too), pairs over
  500 ms apart are SKIPPED (so `empty_room`'s high jitter may have been that
  artefact), and body-centre/torso-length are defined here because the deleted
  script's are unrecoverable. **Three new landmark-only signals**, the important
  one being `motion_incoherence`: centre drift can be fooled by a person
  genuinely moving, "do the 33 landmarks agree where the body went" cannot.
  **THE ORDER WAS FLIPPED from :6386's dials-first, and the reason is a standing
  reading a later chat will need: ":6386 says none of 1–4 can be evaluated
  against the five clips" is TRUE OF CAMERA-STAGE CHANGES and FALSE of a
  bridge-layer gate**, which consumes exactly the landmark output those files
  contain — read broadly it shelves the only lever testable today. Kd approved
  the four-card plan and the flip. :6386's object-detector ruling untouched.
  **Operating points are pinned by the HARMFUL side first** (at most 1% of real
  users wrongly rejected → what share of furniture that catches), because the two
  errors are not symmetric. **NO CUT-OFF CHOSEN — still one chair, one room; the
  OWED rule binds.** Also: the CLASS half of the instrument line (every
  definition resolved before any per-clip output; one failure aborts the run) —
  **the recorder half is still owed and the line does NOT tick**, so the golden-
  trace ban stands. `scripts/` joins typecheck+lint. **The harness caught its own
  ANSI-strip defect on run 1, in the fail-safe direction** (PROVES NOTHING, never
  a false RED); the same strip lives in `mutate-badge-cue.mjs`, equally fail-safe.
  engine 168/168 · 11 mutants 11 RED 0 alive · **nothing measured on real
  furniture yet — Kd runs `RUNBOOK/measure-camera-discriminators.md`.**
- **:6386** — 2026-08-08 — **THE CAMERA MEASUREMENT RAN: the four camera defects
  are ONE defect, and NO confidence cut-off can separate a chair from a person.**
  **Read before touching the pose provider, rep counting, the voice, or any
  "is a person there" check.** Kd recorded five clips in his own room; measured:
  a chair reports **0.99** on its chest and hips (identical to a person), so the
  one-line confidence fix is DEAD; furniture **EATS** reps (knee crossed the
  counting line 4× in 2 min with furniture in shot vs 19× without), confirming
  :6062's unverified prediction; an empty room is fine (6.2%); the voice babble
  is the app reading a chair's posture aloud (85.6% of frames vs 1.1% with Kd in
  shot) and is NOT a fourth defect. **KD RULING: his object-detector proposal is
  DROPPED on cost** (a second model vs Part 6 §3.4/§3.5 budgets) — deferred, not
  struck; do not re-propose it as new, and do not treat it as forbidden either.
  The measured lever is **jitter** (fake skeleton moves ~3–7× more) and **its
  threshold was deliberately NOT picked** — one chair, one room. Also records two
  defects in our own work: the recorder's `exercise` slug (`squats`) does not
  match the definitions (`squat.json`) so the engine-replay half of
  `measure-pose.ts` silently did not run, and `pose_landmarker_lite` is
  hard-wired though Part 6 §3.3 makes **full** the default with a step-down
  ladder that does not exist. **No fix designed; no threshold chosen.**
- **:6277** — 2026-08-07 — **T3 ROUND 2: round 1's own Low fix shipped a
  Critical, and the mutant round 1 retired was catchable all along.** **Read
  before writing or rewording ANY on-screen sentence that explains a
  server-side calculation, and before trusting an `expectAlive` row in any
  mutation harness.** **C/H: the Calories tooltip, rewritten by round 1, is true
  for the 3 exercises with an engine definition and FALSE for the other 55** —
  `kcalPointForSetsV2`'s `logOnly` branch bills the WHOLE set span at the
  exercise MET, so a hand-counted workout's standing-around is charged at the
  full rate while the tooltip promised a resting one (:5807's "on screen AND
  wrong"). **A fix aimed at a Low created a Critical.** **THE INSTRUMENT FINDING:
  :6225 declared `ENGINE_STALL_MS = 0` unfixable-by-assertion; that was true of
  the TEST'S SHAPE (frame and poll in one `act()`), not of the page, which polls
  between frames ~15×/s. The control now takes one such poll and the mutant is
  RED.** **An `expectAlive` row is a factual claim and V1 binds it like a count —
  it was copied into three places and never re-measured.** Guard: the harness took
  a per-mutant `target` so MX8 pins the tooltip on a second page. **KD RULED
  PATCH, NOT REDESIGN** on :5348's escape hatch (different screens; one-sentence
  fix) — but **the defect CLASS was identical both rounds: on-screen text drifted
  from the computation it describes.** Read a third occurrence against that
  ruling, not fresh. Low ×3: the `'+1 Rep'` line does not pin the ruling; harness
  counted 7 runs as 7 mutations and scored runner faults as RED; `graded`'s
  comment called a user-reachable debug row "dev-only". web 524/524 · 8 mutants,
  8 RED, 0 ALIVE, restores sha256-verified · lint identical to HEAD, measured.
  **SMOKE STILL UNRUN — nothing ticked; round 3 is diff-only.**
- **:6150** — 2026-08-07 — **T3 ROUND 1 on the camera ruling + duration/kcal
  packet: TWO Critical/High, both the screen saying something FALSE.** **Read
  before deriving any badge, cue or label from `countItYourself`, and before
  writing a sentence that names WHY the camera is not counting.** **C/H-1: a
  green "AI form check" badge over a dead camera** — `graded` was
  `!countItYourself`, and the moment :6008 took `engineStalled || cameraDown` out
  of that expression it stopped asking the right question, so the top bar claimed
  a form check directly above its own panel saying "The camera stopped"; it also
  left `'Camera not counting'` — the one badge state the ruling explicitly KEPT —
  with **no path to it at all**. **The file's own comment three lines up already
  specified the correct behaviour, and :6008 says it too: the rule was written
  down in the right place and the code drifted out from under it in the same
  commit. A comment is not a test** — and no test asserted the badge text at all.
  **C/H-2: a cue naming a cause the app cannot know** ("can't see you well
  enough" on a branch reached by any absence of frames, when :6008 exists
  precisely because out-of-shot and dead-camera are indistinguishable).
  **THE INSTRUMENT FINDING HAS THE TEETH: four tests — every guard on "a working
  camera is never taken away" — had gone vacuous**, because they assert `'+1
  Rep'` is absent and since :6008 nothing but the user's own press can produce
  it; three now go RED under their own mutation, and **the shape to remember is
  that a ruling narrowing a variable's meaning can void a whole family of
  assertions without touching one line of test code, all of them staying green.**
  ~~**One mutant RETIRED WITH ITS REASON rather than faked green**
  (`ENGINE_STALL_MS = 0`: the fresh-frame clearing masks the threshold — measured
  both ways)~~ **— WRONG, and overturned by :6277: it was catchable, and the
  control test now catches it.** That test's false comment is corrected IN PLACE
  per :5748 — twice, in successive rounds. Low: the Calories
  tooltip described the pre-v2 sum; :6048's "every other assertion untouched" was
  true of six of ten tests, corrected in place; **the review's Low-1 was checked
  and does not reproduce.** web 523/523 · 7 mutants, 6 RED, 0 never ran, restores
  sha256-verified. **SMOKE STILL UNRUN — nothing ticked; round 2 is diff-only.**
- **:6062** — 2026-08-07 — **THE CAMERA SMOKE STOPPED PART-WAY: real squats were
  not counted, and the pose model counted FURNITURE.** **Read before touching rep
  counting, the pose provider, or anything that decides why a rep did not
  happen.** No code changed; Kd stopped the smoke and sent the work to its own
  card in a new chat. **Pause-stops-the-timer PASSED** and is the only part of
  either card's camera smoke that did — **both cards stay UNTICKED**. Measured,
  not recalled: a rep needs the knee under **100°** and back over **160°**
  (`squat.json`); **the left→right fallback is AUTOMATIC** (`compile.ts:84-86`
  compiles `knee_L` → `metricFallback: knee_R`), so a hidden left leg is NOT the
  failure; **the BILATERAL GATE is the rule that bites** — with both knees visible
  the OTHER knee must also pass 150° or the descent never registers
  (`fsm.ts:119-126`); **`evaluateFrame` SKIPS rep-scoped rules**, so
  `shallow_depth` (`perRep`) is evaluated only at rep COMPLETION and a squat too
  shallow to complete a rep produces **silence by construction** (`faults.ts:252`);
  and **frame validity never checks that the pose is a PERSON** — 33 finite
  landmarks pass, per-landmark gate 0.3, MediaPipe confidences 0.5
  (`ingest.ts:44`, `usePoseDetection.js:118`). **UNVERIFIED hypothesis that ties
  both symptoms to ONE cause:** a knee landmark stuck on a chair leg never bends,
  so the bilateral gate blocks every real rep — the fake dots would EAT reps, not
  just add them. **Kd RULING: the depth number STAYS** (he chose it over a
  loosening proposal); the app must SAY when a squat was too shallow — consistent
  with 2026-07-10's R5.4 "not hand-edited". **Carries a protocol failure of mine
  he caught:** I claimed left-knee-only from the DEFINITION file without reading
  the code that consumes it — **V1 binds a claim about BEHAVIOUR exactly as it
  binds a count.** Two OWED lines. The T3 for the two committed cards is
  UNAFFECTED and can run now.
- **:6008** — 2026-08-07 — **KD RULING: if the user chose the CAMERA, the app
  NEVER switches them to hand counting.** **Read before touching anything that
  decides who counts a set.** **Supersedes the automatic handover :3819 expressly
  excluded from his earlier "the mode does not flip mid-set" ruling.** The app
  could not tell a camera that had DIED from a user standing out of frame — both
  are five seconds without a usable frame — so **stepping out of shot converted
  the set permanently and silently discarded its form score**; the handover built
  to stop a dead camera stranding a user (:3720) reached far wider than the
  disease. Now `countItYourself` reads only `manualMode`, no-definition, and the
  user's OWN takeover; the stall still drives the badge and the cue but decides
  nothing, so **stepping back into frame just resumes counting**. Escape hatch
  approved in the same breath and shown to him first: a **"Count this set myself"**
  button for a genuinely dead camera — **the user presses it, the app has no path
  to it**. **The test written FOR the ruling caught a defect in the fix**: the
  button stayed on screen after the camera recovered, a trap costing a form score
  if pressed — a fresh frame now clears the stall, **which could not have been
  done while the stall decided ownership**. **Ten tests changed** and the account
  is in the entry: each now has the USER pressing the button where the app used to
  decide, every other assertion untouched, and Kd was warned BEFORE the work that
  tests would change. web 520/520. **CAMERA SMOKE UNRUN — not ticked.**
- **:5906** — 2026-08-07 — **THE REAL WORKOUT TIME IS SAVED, and calories stop
  billing idle time as exercise (kcal v2).** **Read before touching anything that
  measures time in a workout, before writing a comment that reasons its way to a
  rounding, and before running ANY tool that owns the working tree.** Two OPTIONAL
  payload fields (`durationSeconds` — the on-screen timer, which STOPS on pause —
  and `restSeconds`); this IS the "ruled payload change" P2.3 GAP-2 deferred.
  **§2.4 SetSummary untouched, so the byte-match gate is unaffected**; no
  migration. Three-tier kcal v2: reps at the exercise MET · idle + rest at the
  ported `REST_MET` 1.8 · **paused time at NOTHING**. **Version selected by the
  PAYLOAD's shape, not the deploy date**, so a pre-card queued workout is priced
  and stamped v1 byte-for-byte. **Kd's smoke found THREE Critical/High the 991
  green tests could not**: the set stopwatch counted paused time (seven sets
  claiming 188 s inside a 92 s session, printed as "3m 8s" over "2 min total" and
  billed at the exercise rate); nothing stopped a part exceeding its whole on
  screen (now clamped server-side, and the clamp STAYS because stored rows carry
  the old spans); and — **found by Kd's instinct alone** — "2 min total" for a
  1 m 44 s workout, :4182's minute-rounding at the one site never before
  reachable. **The comment defending that rounding is STRUCK IN PLACE and the
  render test that asserted `'35 min total'` was ASSERTING THE DEFECT.**
  **Carries a protocol failure of mine: I cancelled a card Kd had already
  approved, on my own judgement** — a chat may not reverse a Kd ruling, it
  proposes and stops. **And three instrument failures**: `git stash` run while a
  sweep was live (verdicts unusable — a mutant reddens just as well when git
  reverted the source); **a sweep that never ran reporting exit 0 through a
  `| tail` pipe**, the first unearned pass here from a PIPE rather than a
  harness; and Kd smoking a **stale API server** because `tsx` has no `--watch`.
  12/12 mutants RED · api 429/429 · web 519/519 · shared 45/45.
- **:5748** — 2026-08-07 — **summary card, T3 ROUND 2 (diff-only): ZERO
  Critical/High — CARD CLOSED. The first packet ever closed by the SEVERITY GATE
  rather than by a round count.** 5 Low, all fixed. **The two that would have
  bitten later are both INSTRUMENTS quietly ceasing to protect:** the permanent
  guard hard-coded `GET`, so a later `POST /v1/workouts/:id/share` would be swept
  in and **fail for the wrong reason**; and **the sweep exited 0 while SKIPPING
  the six apiDb mutants** — including the two guarding round 1's Critical/High —
  printing "6 skipped" and succeeding, which is the shape this project has been
  burned by five times, every one of them "technically reported". Now non-zero
  unless `--allow-skipped`. **Round 1's over-claim was still standing in the test
  file's own header** after being corrected in DECISIONS: **a correction applied
  to the record and not to the artifact is half a correction** (:4556 F1's shape).
  **21/21 mutants RED, 0 alive, 0 skipped, one completed run** · api 419/419 ·
  web 507/507. **No tick was invented for a line that did not exist** — this card
  had no standalone OWED line; the tracking lives in the legacy-dual-write entry,
  now 2 of 3 surfaces done, the Dashboard's stats being the last.
- **:5618** — 2026-08-07 — **summary card, T3 ROUND 1: one Critical/High, seven
  Low — and a defect the SWEEP found that the review did not.** **Read before
  crediting to a WORKOUT a number the system credits to a DAY, and before
  believing two fields that "obviously" mean different things.** **C/H-1: the
  screen could claim MORE XP than was awarded** — `streak_day` is credited once
  per DISTINCT activity day but was added to every workout on that day, so two
  workouts in a day printed +60 each while the total moved 110; the card's own
  departure-from-the-port existed to fix the UNDER-report and reintroduced it as
  an OVER-report. Fixed by giving the bonus to the day's FIRST workout
  (`hasEarlierWorkoutOnDay`). **THE ONE WITH TEETH IS NOT IN THE REVIEW: M6
  SURVIVED, and the survival WAS the finding** — `activeSeconds` and
  `durationSeconds` are the SAME number (`duration_ms` is derived as the sum of
  set durations; 12/12 workouts in the live DB, Kd's own smoke among them), so the
  summary printed "31s" over "1 min total" with a tooltip explaining a rest gap
  that does not exist, and **no test could ever have caught it** because no input
  distinguishes equivalent expressions. M6 is RETIRED WITH ITS REASON, not
  deleted. Also: **the audit harness could not complete a run** (two anchors
  pointed at a deleted line, so the retry had no live mutant at all) — anchors are
  now checked up front for the whole table; **the permanent guard's "covered by
  construction" claim was FALSE** and is corrected in place at :5438; and the
  offline branch stopped identifying itself by what it LACKS. **20/20 mutants RED
  on one completed run** · api 419/419 · web 506/506. **Carries Kd's L-7 ruling
  (LEAVE the plan window as a browse gate) and the condition he attached — which
  grants NOTHING about ownership.**
- **:5543** — 2026-08-07 — **the summary SMOKE PASSED 8/8 — and the browser found
  TWO defects that 505 green tests could not.** **Read before writing a fixture
  for a NETWORK failure, and before trusting "the tests cover the offline path".**
  (1) Pasting another account's summary link said **"Your workout is saved and
  will sync"** — nothing leaked, the tenancy held, but every clause was false for
  the reader; the 404 is deliberately ambiguous (not-synced / no-such / not-yours,
  so it is no oracle), and only the CLIENT'S OWN per-user outbox can disambiguate
  → `isAwaitingSync`. (2) **Offline there is NO status code**, so a retry keyed on
  `404` failed the very case it was built for — **and a GREEN test said otherwise
  because its fixture used `{response:{status:404}}`, a shape offline never
  produces** (:4855's fixture lesson, one card later). Fixing it exposed a third:
  our own bad-body throw also lacks `response`, so a garbled 200 was read as a
  dropped network. **One shape three times: a condition identified by what it
  LACKS rather than what it IS.** Also: **a workout cannot be STARTED offline at
  all** (own 🟡 OWED line, card 4 discharges it), and the smoke doc told Kd to do
  exactly that — :5034's "instruction with no button behind it". 505/505,
  M15-M18 RED. **🔴 line NOT ticked — T3 unrun.**
- **:5438** — 2026-08-06 — **THE POST-WORKOUT SUMMARY IS OFF THE OLD BACKEND**
  (workout core loop, card 1 of 4). **Read before touching the post-workout
  screen, before repointing any field whose UNITS differ between backends, and
  before writing a mutation harness's restore check.** New endpoint
  `GET /v1/workouts/:id/summary`, **no migration** — every field already existed;
  composed from `getWorkoutDetail` (so tenancy is INHERITED, not re-implemented)
  and the same `personalRecords` the records screen reads, so the two cannot
  disagree. **Three SPEC GAPS — meal ideas, stretches, record labels are named
  NOWHERE in the spec; Kd ruled PORT VERBATIM** (`summaryContent.ts`, line-for-line
  from `workouts.py:562-639`). **One deliberate departure FIXES a recorded defect:**
  the old endpoint's XP figure omitted `streak_day` and so understated the award on
  the same screen as the total it disagreed with (T3 round 4 F5). **The sync race
  gets its first answer:** the queue flushes fire-and-forget, so a 404 here means
  "not synced yet" — the page retries and says the workout is SAVED rather than
  "failed to load". **Corrects the card prompt: the third server goes LAST, not
  first** — `completeSession` needs `createSession`'s session id and both wait on
  the Dashboard's stats. **14/14 mutants RED, 0 alive**; first card under the fixed
  review/fix process (:5348), and the first permanent guard (rule 5). **Its harness
  failed twice at its own job — reading a PASSING suite as RED, and asking `git
  diff` a question git cannot answer — both toward a false ALARM.**
- **:5199** — 2026-08-05 — **exercise library, T3 ROUND 2 (THE CAP) — CARD
  CLOSED, 🔴 LINE TICKED.** 3 findings, ZERO visible. **Read before trusting any
  harness that reports its own restore, and before ticking an OWED line on a
  mutant that lives in another file.** **F1 is the FIFTH unearned harness pass
  here and the first to leave broken source in the working tree**: round 1 added
  a mutation target to neither `TARGETS` (snapshot-and-restore) nor `SUITES`
  (what runs), so the harness damaged `poseAdapter.js` and never put it back —
  twice — while its closing "proves every restore landed" check printed PASS,
  because that check re-runs the SUITES and the damaged file's tests were not in
  them. M23 read "survived", M24 "never ran"; both assertions were sound and
  unreachable. **Class fix: a mutation naming a file outside `TARGETS` now ABORTS
  the run** (verified by deliberately breaking it). **F2 is round 1's own F5
  lesson inside round 1's own fixes** — its detail-panel fix was rendered by no
  test, the defect went straight back with 494/494 GREEN, and the OWED tick cited
  M20/M21 from a different file; now a render PAIR plus M28. **F3: :5104's
  "M23–M27 all RED and restored byte-exact" was true of a hand-rolled loop and
  FALSE of the committed harness** — corrected in place. **The lesson is the
  INSTRUMENT: "I measured it RED" and "the committed harness measures it RED" are
  different claims, and only the second is reproducible by the next chat.**
  **28/28 RED, 0 survived, 0 invalid — the full sweep run to completion for the
  first time — with all six targets then verified restored via `git diff HEAD`
  rather than on the harness's word.** 496/496, lint unchanged, build green.
- **:5104** — 2026-08-05 — **exercise library, T3 ROUND 1: 7 findings, ZERO
  visible, all fixed — and the FIX FOR F5 SHIPPED UNPROTECTED.** **Read before
  ticking an OWED line, and before believing a fix is pinned by the test written
  with it.** **F1 has the teeth: the AI badge's I4 half was protected by
  nothing** — deleting `&& engineSupports(def)` left 45/45 green, because every
  badge test injects a STUB for the whole function and M10/M11 mutate the
  reader's injected `ai` one layer below the gate. Moved to `poseAdapter.js` with
  an injected resolver, because all three bundled definitions declare
  minEngineVersion 1.0.0 against ENGINE_VERSION 1.0.0 — **with the real map the
  gate's FALSE arm is unreachable and no test could tell a live gate from a
  deleted one.** **F2 is :4855's F2 one screen over, same day**: no dedupe on the
  cursor walk, and the card's own test ASSERTED the defect (one slug served on
  every page, 20 rows called correct). **F3 is "fix the class not the case"
  (:1239) for at least the fifth time** — a private `DIFF_COLORS` + `|| beginner`
  still live in `ExerciseDetail.jsx` while OWED:247 was ticked DONE for that
  shape; second false tick on this card in two days. **F4:** an all-unreadable
  page read as EMPTY, composing two green assertions into the exact lie the
  `failed` state exists to remove. **F5 IS THIS ROUND'S LESSON: the fix's own
  mutant came back ALIVE** — widening `categoryNames` to primary ∪ tags changed
  nothing observable because both sets are the same 11 today; **a fix whose
  protection cannot fail is the same defect with a comment on it**, closed only
  by a synthetic TAG-ONLY row. F6/F7 correct the record. **The artwork item was
  promoted from a reviewer's record-note to an OWED line — it is the one thing
  here a USER CAN SEE** (Mountain Pose and Brisk Walking draw the placeholder;
  56 of 58 resolve, measured through the real lookup). 494/494. **The "M23–M27
  all RED and restored byte-exact" claim in that entry is CORRECTED IN PLACE by
  round 2's F3 — true of my hand-rolled loop, false of the committed harness,
  which could not reach them at all.** 🔴 line does not tick here; round 2 is
  the cap.
- **:5034** — 2026-08-05 — **exercise library: browser SMOKE PASSED 9/9 on
  `b96c009` — and BOTH first-run failures were the SMOKE DOCUMENT's, not the
  card's.** **Read before writing the setup section of any smoke doc, and before
  reading a smoke failure as a card failure.** Recorded as Kd's REPORT, not a
  measurement (:4829). **The pass is on the card's own bytes**: `git status`
  across the whole smoke shows ONE modified file — the doc itself. **Failure 1:**
  step 8 ("start a workout") needs a THIRD server — starting a workout still
  calls the OLD backend, whose stand-in is `mock-ml-backend.mjs` on :8000 — and
  **starting it is not enough, it boots `dead` by design**, so a half-informed
  run fails identically. **Failure 2:** step 5 leaves a category pill AND
  `advanced` switched on; only 4 of 58 rows are advanced and both of step 6's
  exercises are `beginner`. Nothing was missing — measured BEFORE re-running:
  DB `{total: 58, live: 58}`, and in the screen's own sort **Bicep Curls is #3,
  Chair Squats #11 of 58**, both inside the first page of 20. Step 6 said "clear
  all filters" — **an instruction with no button behind it**: the Clear-filters
  control renders ONLY in the `filtered.length === 0` arm. **The shape: a smoke
  doc is a TEST and its SETUP is part of the claim** (:4855's fixture lesson, one
  level out); a step must not depend on state an earlier step leaves behind, and
  a doc must name every server its steps reach — including other cards'.
  **The 🔴 OWED line is UN-TICKED**: `b96c009` ticked it while its own HANDOFF
  said smoke and T3 were unrun — :4718's F4, third occurrence on this branch.
- **:4945** — 2026-08-05 — **THE EXERCISE LIBRARY IS OFF THE OLD BACKEND, and
  the WORDS SHIP AS A FILE.** **Read before adding any column for exercise copy,
  before writing a "port" of anything, and before badging a feature the engine
  cannot do.** **Kd RULING: a file, not columns** — the Part 4 §3.4 DDL declares
  no column for name text/description/instructions, adding them is R0.2 schema
  invention, and `name_key` is the DDL saying where text belongs (v1 §14 message
  keys; hi/as becomes a translation task). **NO MIGRATION in this card.** The gap
  was measured against the LIVE DB before any code: 58 rows, and
  `count(difficulty)=count(equipment)=count(muscles)=0`. `EXERCISE_CONTENT` is a
  verbatim port of `scripts/seed_exercises.py` — extracted by Python's own
  `ast.literal_eval`, never retyped, kept in the source's row order — then
  **diffed back: 812 values, 0 differences**. **Kd RULING 2: the AI badge is a
  CAPABILITY** (`getDefinition` + the I4 engine gate), not the seed's
  `ai_supported` — the seed says EIGHT, the engine ships THREE, so porting the
  flag would promise camera form-checking on five exercises that get none; it
  now lights up by itself as P4 publishes each definition. Search/filters run in
  memory because the endpoint is `.strict()` `{limit,cursor}` and 58 rows is one
  request. **Four old client calls deleted with the no-removal rule NOT engaged —
  three had no caller at all** (the metered RapidAPI media endpoint among them;
  photos were always local files). **The screen was ALREADY BROKEN**: Card 1
  stopped writing the token `mlApi` needs and every old exercise route is behind
  `HTTPBearer`, so the front door to starting a workout (PreWorkout redirects
  here) was shut. Lists **58 not 56** (§3.4:366-369 kills `REMOVED_EXERCISES`); a
  failed read now says so instead of drawing "No exercises found". **Closes two
  OWED lines that named this card**: the `|| DIFF_COLORS.beginner` one-of-N site,
  and the calendar's title-cased slugs. Lint went DOWN (2 errors → 1, measured
  against HEAD).
- **:4855** — 2026-08-05 — **date-window card 2, T3 ROUND 2 (THE CAP) — CARD
  CLOSED, 🔴 line TICKED.** 9 findings, ZERO user-visible. **Read before writing
  a test fixture, and before trusting any harness in this repo.**
  **THE ONE WITH TEETH IS NOT IN THE REVIEW: the harness printed "ALL MUTANTS
  CAUGHT", exit 0, on a run where NOT ONE MUTANT EXECUTED** — a block moved above
  the `MUTATIONS` array iterated an array that did not exist yet, and bash 5
  expands an unset `${arr[@]}` to nothing without tripping `set -u`. Fourth time
  in this project a harness claimed an unearned pass (:2614 F3, :2736 F1, the
  `cp` failure), first time written by the author of the guards. Now: the array
  is checked non-empty, and **a run where mutants ATTEMPTED ≠ SELECTED cannot
  pass** — every safeguard must check a step HAPPENED, not that nothing
  complained. **F2, the only code defect, is round 1's fix one bug over**: a
  stuck cursor made `inWindow` count 1,000 off 100 workouts, so the volume
  caption lied again — now a Set of ids. **F1/F3: the tests written to close
  round 1's F3 did not test it** (the volume control served the same 100 rows ten
  times; the absence pin sat on the wrong branch) — **and the replacement fixture
  had a SECOND bug: `padStart(8,'1')` is not injective when the number contains
  1s, so page 10 collided with page 0.** Three levels in one day — caption,
  mutant, fixture — one shape: **a test is a claim and the FIXTURE is part of the
  claim.** F4/F5: two numbers asserted and never measured, including the "~1.5 h"
  that talked Kd out of a full run (real: 12m06s and 23m25s, recorded as a
  range). F6/F7/F9 made the harness's own promises real — `MUTATE_ONLY` FATALs on
  unknown labels, a SENTINEL replaces a `ps` grep that was a measured false
  negative on Git Bash, and :3819's smoke rule is enforced by refusing to start
  while 5173/3000 listen. 438/438, **41/41 mutants RED**, all guards verified by
  deliberately breaking them. New ⚪ OWED line: a stuck cursor still draws each
  workout ten times (pre-existing, out of scope, R1.1).
- **:4829** — 2026-08-05 — **date-window card 2: browser SMOKE PASSED, steps
  A–D, on the round-1 bytes (`6bdd4aa`).** One request per month view carrying
  `from`/`to`; stepping a month sends the new one; the instants are the viewer's
  midnight (`…T18:30:00.000Z` at +05:30) and not `…T00:00:00.000Z`. **Recorded as
  a REPORT, not a measurement** — the browser is Kd's instrument and the values
  were not read out of it by me; the step-C fail condition named the exact wrong
  string, which is what makes a blanket pass meaningful. Structurally out of
  reach and said so: the headline fix and both truncation captions. **The 🔴 line
  still does not tick — round 2 is the cap and is unrun.**
- **:4718** — 2026-08-04 — **date-window card 2, T3 round 1: 5 findings, none
  visible, 4 fixed + 1 recorded. Read before writing a mutation table, and
  before ticking anything in OWED.md.** **F2 is the one with teeth: a mutant RED
  FOR THE WRONG REASON certifies the wrong assertion.** M35 claimed to restore
  the removed early break; `break` inside the item loop exits one PAGE, not the
  walk, so it was red for M34's reason while the test written to pin the break's
  removal passed underneath it — measured both ways, rewritten faithfully (flag +
  set + OUTER break), and :4622's "each was measured RED" struck in place. A
  table's value is the mapping between label and cause; "it went red" does not
  verify that mapping. **F3, the only code defect and the caption's THIRD wrong
  direction:** `truncated` does not mean "this month is huge" — a server that
  accepts the window and mis-applies it fills every page with another month's
  rows, all discarded, and the screen captioned an EMPTY grid "more than a
  thousand workouts", fabricating a volume; now gated on `inWindow`, counted
  conservatively, and **the render suite's own truncation fixture turned out to BE
  that case all along**. F1: `workoutApi.js` still told the next author in
  writing that the API has no date filter — :4556's F1 shape, one file over. **F4:
  the 🔴 line was ticked in the same commit whose message said "smoke and T3
  unrun"** — reverted, precedent at :4119 four commits back on this same screen.
  F5 reported not fixed: two assertions encode "local midnight always exists",
  false only in a midnight-DST zone the pinned zone can never see.
- **:4622** — 2026-08-04 — **the CALENDAR ASKS for the month — CARD 2, the WEB
  half. (Its 🔴 tick was PREMATURE — struck by :4718's F4.)** **Read before touching the calendar's read
  path or the meal reader's.** `fetchMonth` sends the month's own boundaries as a
  half-open window instead of paging backwards from today, so an older month is
  readable at ANY depth of history and a month view costs one request, not ten.
  The boundaries are converted CLIENT-side (local midnight to local midnight)
  because :4434 built the API to take absolute instants precisely so no timezone
  decision moved to the server; a test asserts the offset directly, since the
  wrong implementation an author reaches for first — a `…T00:00:00Z` string built
  from year and month — is off by the zone at both ends. December's `to` must
  equal January's `from`, pinned. **The truncation caption has now been wrong in
  TWO directions**: round 2's F4 struck the original as false of the walk, its
  replacement is false of the window, and the new wording returns to this
  month's own volume — the superseded clause is pinned as an ABSENCE, because a
  caption that outlives the read it described is this card's most repeated
  defect. The early break went (under the window it could only fire on a server
  disagreement, and a guard that ends a read early there draws a SHORT MONTH
  SILENTLY); the per-row window filter STAYED (trusting the server would paint a
  workout onto a month it did not happen in). `listMealsForDay` keeps its own 🟡
  line and this is now the worked precedent for it.
- **:4556** — 2026-08-04 — **date-window T3 round 2 (THE CAP) — CARD CLOSED.**
  5 findings, none visible, **three of them in the RECORD rather than the
  code.** **Read before writing "the suite proves X" about any green suite.**
  F2: round 1 credited the api sync suite with a `+05:30` fixture it does not
  contain (the offset control is in the SHARED suite) — a real, green suite
  credited with an assertion it does not make, which is V1's most persuasive
  failure mode; F5 mis-counted the sound plain-`datetime()` sites as five when
  there are six; and a third slip (17/17 for a suite that is 16) was caught
  pre-commit by running it. All corrected IN PLACE. F1 is the one with teeth:
  `limitedToDays` is declared TWICE and round 1's rewording landed on one —
  **a shared field with two declarations has two comments, and the second is
  where a correction gets lost.** F3 corrected a comment that reasoned instead
  of measured. F4 was optional and paid for itself: the route-level assertion,
  mutation-checked, turns the sync path's 500 from reasoned into MEASURED.
  Round 1's three claims were re-run by the reviewer and all held.
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
  test. Same class as :3720. Now compares content (`tr -d '
'`); restore
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
