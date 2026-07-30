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
