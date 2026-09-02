# CARD — the gym's numbers: the nightly rollup and the Overview's tiles

**Status: APPROVED 2026-09-02 (*"approve"*) · §4a SERVER HALF BUILT 2026-09-02,
`DECISIONS.md:30094`.** Migration `0020` was reviewed as SQL by Kd before
anything else was written (T5/R4.4) — both statements were put in front of him
and he approved them. **§4b (the web half) is NOT built, no smoke has run and T3
is UNRUN, so the `OWED.md` line does not tick.** This document is the BUILD plan
the gate inspected (:26777 — *"he had approved a FEATURE SHAPE and had never seen
a file list, migration, test list or risk list"*). Branch `web-repoint`, as every
gym card has been.

**It is CHAINED, not chosen.** :26469 and :26624 both sequence it directly after
attendance — *"sessions → attendance → the numbers"* — and :26385 §5 lists it
first among what is measurably left in the gym stage. The attendance card closed
2026-09-02 (`bcf0586`, `DECISIONS.md:29870`), which is the condition :26469 §1.2
put on this one.

**Rulings that bind it:** `DECISIONS.md` **:26469** (the gym's numbers are
attendance numbers · three tiles, no average form score · *"trained anywhere"* is
never shown · every figure counts only people who were PRESENT) · **:26624** and
addenda :26684, :26736 (sessions, closures, the *"hours not set"* state) ·
**:27900** + :27992, :28055, :28107 (the attendance rulings this reads) ·
**:22341** (adding a job to the `rollups` queue) · **:8267/:8343** (empty
states) · **:29250**, **:27992 §3** (a count on a paging console screen comes
from the SERVER) · **Part 3 §3.2, §3.3, §4.1**.

**AND KD'S FOUR ANSWERS AT THIS CARD'S GATE, 2026-09-02** — full ruling at
`DECISIONS.md` (this session's entry). Summarised in §2 below; the entry is the
citation.

Tracked at `OWED.md`'s *"THE OVERVIEW HAS NO NUMBERS"* line.

---

## 1 · IN PLAIN WORDS (this part is for Kd)

Today the gym owner's home screen shows who the gym is, its join code and how
many members it has. It says nothing about whether anybody is actually turning
up.

This card puts the numbers there:

- **Today** — how many people have come in so far.
- **This week** — visits, and whether that is up or down on last week.
- **Last 30 days** — how many of your members came at all, and what share of your
  members that is.
- **The last 8 weeks** — a chart: bars for visits, a line for how many different
  people came.

Behind it, a job runs every night and writes down each gym's day, in that gym's
own clock, so the history exists even for days nobody looked at the screen.

**The lists that go beside these numbers — who came today, when they come,
who is on a roll, who is slipping away — are the NEXT card**, which Kd chose at
this gate: numbers first, lists second.

---

## 2 · WHAT KD RULED AT THIS GATE (2026-09-02), AND WHAT IT CHANGES

### 2.1 The tiles count VISITS, not workouts — a knowing deviation from Part 3 §4.1

Part 3 §4.1's KPI row is *"Active members (30d) with 7d sub-stat · Workouts this
week · Adoption % · Avg form score"*. The fourth was struck by Kd at :26469 §1.1.
**The second is now replaced: the tile counts VISITS.**

**This is a DEVIATION PROPOSAL that was put to him and accepted** (R0.3), not a
chat's silent re-write of the spec. The argument he was shown, in his words'
terms: every member who walks in and taps *"I'm here"* makes a visit, while a
workout exists only if that member ALSO logged their training — so a
workout-shaped tile can read zero on a day forty people came through the door.
His own ruling heading is *"THE GYM'S NUMBERS ARE ATTENDANCE NUMBERS"* (:26469);
this is that ruling reaching the screen.

**Nothing is removed and nothing stops being recorded.** The workout-side columns
(`workouts`, `sets`, `total_reps`, `minutes`, `avg_form_score`, `scored_sets`)
are still WRITTEN nightly, on exactly :26469 §1.1's reasoning about
`avg_form_score`: the column exists, it costs one expression, and a history
nobody recorded cannot be recovered later. The Reports card is their reader.

### 2.2 A workout counts for the gym on the SAME GYM-DAY as the visit

The fifth :26469 §6 question, deliberately held for this gate (:27900 — *"it
needs no column [in the attendance card] … and it goes to the Overview-numbers
card's gate"*).

**RULED: a workout counts for a gym when the person was a live member that day
AND has an attendance row at that gym on the same day, in the gym's own clock.**
Two options were put to him with their costs; he took the first.

**It is his own sentence made physical** — *"A workout counts for a gym only if
the person was a member that day and was present in the gym"* (:26469 §1.2).
The rejected alternative (*"only within N hours of the visit"*) required picking
a number nobody has ruled, which is the R0.2 invention this gate exists to
prevent.

**THE COST IS ON THE RECORD BECAUSE HE WAS SHOWN IT: a member who taps "I'm
here" in the morning and then trains at home at night has that home workout
counted for the gym.** The alternative buys accuracy for an invented constant,
and the day-grain matches the column attendance actually stores (`day`, a date in
the gym's zone).

### 2.3 The card is SPLIT: numbers first, lists second

Put to him with the cost of not splitting; he agreed. **This card is the numbers
and the job under them.** The people lists — who came today · when they come
(visits per session) · on a roll · slipping away · this week's roster — are
`CARD-gym-overview-people.md`, unwritten, and have their own `OWED.md` line.

### 2.4 The gym can cheer a member on — ONE TAP, no typing

Kd's own addition at this gate, unprompted: *"if some mebers comes to gym
reguraly and maintains a continous streak the gym can send inpiring things like
emojy short message etc"*.

**RULED: an emoji plus a ready-made line, one tap, capped at one per member per
week. No free-text box.** He chose it against a "let the owner type" option whose
costs were stated (length cap · rate limit · a report path · an operator view of
what was sent — a card of its own), and it agrees with his own PACT design, where
*"no free text ever, only one-tap compliments"* (:18128).

**IT IS THE NEXT CARD'S, not this one's**, and it is written down here so it is
not lost: it hangs off the same attendance data and the same screen as the "on a
roll" list. **`OWED.md` line added in this commit** (the deferral rule).

**WHAT HE WAS TOLD BEFORE RULING, and it must not be forgotten by whoever builds
it: nothing in this product sends anything.** There is no email sender and no
push (grep-verified this session: no `sendEmail`, no mailer, no notifications
table). The existing "nudge" (`nudgeApplication`) is a TIMESTAMP the other side's
screen reads — that is this repo's honest pattern, and the cheer takes the same
shape: it is STORED, the member sees it on `My Gyms` (:28822), and it becomes a
real notification for free when the phone app lands at stage 6.

---

## 3 · SCOPE

### 3.1 What this card builds

| # | Thing | Where |
|---|---|---|
| 1 | Migration `0020` — two columns on `org_daily_stats` | `apps/api/drizzle` |
| 2 | The nightly rollup, in the gym's own clock | `modules/orgs/rollup.ts` |
| 3 | A fifth scheduler on the `rollups` queue + its by-hand tool | `worker.ts`, `tools/orgs-rollup.ts` |
| 4 | `GET /v1/orgs/:gymId/overview` | `modules/orgs/{routes,service,repo,schemas}.ts` |
| 5 | The response contract | `packages/shared/src/orgs.ts` |
| 6 | Three tiles + the 8-week chart on the Overview | `apps/web/src/pages/console/Overview.jsx` + a view module |

### 3.2 What it does NOT build, each with its home

- **The people lists and the cheer** — the next card (§2.3, §2.4). `OWED.md`.
- **The at-risk NUDGE button** — needs push, which does not exist. The next
  card's list still names who to call. Existing `OWED.md` line.
- **`org_live_counters` (Redis, §3.2)** — chat's call with its cost: today's
  count is read live from Postgres against `gym_attendance_gym_day_idx`, which is
  EXACT rather than up-to-five-minutes stale, at one indexed count per page load.
  A cache is a performance answer to a load nobody has measured, and a stale
  "today" tile is a number that is wrong on screen (:5807). Revisit when a real
  gym's load exists.
- **Reports (§4.5) and the leaderboard** — placed later by :19016's order.
- **The activation checklist (§5.1)** — the next card's, with the other panels.

---

## 4 · THE BUILD PLAN

### 4a · SERVER HALF

#### 4a.1 Migration `0020_org_daily_stats_visits` (T5 — Kd reviews the SQL BEFORE anything else is written)

`org_daily_stats` exists since `0001_init` (its DDL is at `0001_init.sql:498-512`)
and **has had no writer and no reader ever** — 6 grep hits in `apps/api/src`,
measured this session, being its own schema file, `archiveSweep`'s comment and
three privacy-list lines. **Its columns are the spec's and carry no `visits`
column**, because it was designed before attendance existed.

```sql
ALTER TABLE org_daily_stats ADD COLUMN visits integer NOT NULL DEFAULT 0;
ALTER TABLE org_daily_stats ADD COLUMN visitors integer NOT NULL DEFAULT 0;
```

Expand-only, forward-only, no backfill inside the DDL (R4.4). **The defaults are
honest here and would not be on a table with history**: every existing row count
is zero, verified before and after by the migration test.

- `visits` — attendance ROWS that day (a second session is a second visit — Kd's
  ruling in the constraint, :27992 §1).
- `visitors` — DISTINCT members who came that day.

**Why both:** visits sum across days, visitors do not. The 8-week chart's bars
sum `visits`; anything asking *"how many different people in 30 days"* is
computed live from `gym_attendance`, because summing a per-day distinct count
double-counts everybody who came twice. **Written down because it is the exact
mistake the shape invites.**

#### 4a.2 `modules/orgs/rollup.ts` — `rollUpGymDays({ sql, log, days })`

One set-based statement per gym-day window, upserting `ON CONFLICT (gym_id, day)
DO UPDATE`. **Idempotent by construction (R3.5): it recomputes rather than
increments**, so a BullMQ retry, a by-hand run and the nightly run all land on
the same numbers.

**IT RECOMPUTES A TRAILING WINDOW, NOT JUST YESTERDAY, AND THAT IS A CORRECTNESS
REQUIREMENT RATHER THAN A LUXURY.** Workouts arrive from an OFFLINE QUEUE
(R10.3): a Monday workout can be synced on Wednesday. A job that only ever
computes yesterday would leave that Monday permanently under-counted, with
nothing anywhere to say so. Default window: **3 gym-local days**, with the tool
able to widen it.

**The gym's day is `(now() AT TIME ZONE g.timezone)::date`** — the identical
expression `readAttendanceContext` already uses for attendance
(`modules/orgs/repo.ts`), so a visit's stored `day` and the rollup's day are the
same thing by construction rather than by two agreeing derivations. Trap #8.

Per gym-day the statement writes:

| Column | From |
|---|---|
| `visits` | `count(*)` over `gym_attendance` for that gym-day |
| `visitors` | `count(DISTINCT user_id)` over the same |
| `new_members` / `removed_members` | `gym_members.joined_at` / `removed_at` bucketed in the gym's zone |
| `workouts`, `sets`, `total_reps`, `minutes` | workouts **counted for the gym** — §2.2's rule |
| `active_members` | distinct members with ≥1 such workout |
| `avg_form_score`, `scored_sets` | over the sets of those workouts (:26469 §1.1 — written, not shown) |

**"Counted for the gym" is ONE predicate, written ONCE**, and every workout-side
column is scoped by it: the workout's owner had a live membership covering that
day (§2.1's interval: `joined_at <= day_end AND (removed_at IS NULL OR removed_at
> day_start)`) **AND** has a `gym_attendance` row at that gym on that same
`day`. Two conditions, both Kd's, neither invented.

#### 4a.3 The schedule — a fifth `upsertJobScheduler` on `rollups`

The queue has four today (`0 3`, `30 3`, `0 4`, `30 4` UTC — measured). This adds
**`orgs.daily_rollup`, HOURLY at `15 * * * *`**, and each run rolls only the gyms
whose LOCAL clock is in the 02:00 hour:

```sql
WHERE EXTRACT(HOUR FROM (now() AT TIME ZONE g.timezone))::int = 2
```

**Why hourly rather than one daily run: Part 3 §3.2 says "nightly at 02:00 org
TZ", and no single UTC time is 02:00 everywhere.** One schedule, twenty-four
cheap runs, every gym closed in its own zone — which is the property :26469 §5
says makes a US gym and an Assam gym both correct in one job. The fifteenth
minute keeps it off the four existing schedules' minutes, for the reason those
four blocks already give: one worker runs them all, and stacking makes a slow job
look like a late one in the logs.

`tools/orgs-rollup.ts` runs it by hand — `--now` (ignore the hour filter) and
`--days=N` (widen the window) — on `tools/trial-sweep.ts`'s precedent. **Its
first job is the backfill**: `--now --days=70` once, so a gym with attendance
history recorded before this card gets an 8-week chart rather than eight empty
bars.

#### 4a.4 `GET /v1/orgs/:gymId/overview`

Named by Part 3 §3.3 verbatim. Gated on **`attendance.read`** — the ninth
privilege, minted at :28107, default ON for all three roles. **The reason it is
not `members.read`:** these numbers ARE the attendance numbers, so an owner who
unticks a trainer's attendance box and still sees the trainer reading visit
totals on the Overview has a tick box that does not do what it says (:13803's
precedent, restated at :21157 and again at :28107).

Response (every figure computed by the SERVER — R3.1, and :27992 §3's *"the
counts come from the server or they are wrong"*):

```
{
  timezone, todayIso,
  today:  { visits, visitors },
  week:   { visits, visitors, prevVisits, prevVisitors },
  month:  { visitors, members, adoptionPct | null },
  weeks:  [ { weekStartIso, visits, visitors } × 8 ]
}
```

- **EVERY FIGURE IS READ LIVE FROM `gym_attendance`. THE ROUTE READS NOTHING
  FROM `org_daily_stats`, AND THAT CHANGED DURING THE BUILD — it is recorded
  here rather than left for a reader to notice.** This section first said
  *"`visits` summed out of `org_daily_stats`; `visitors` distinct-counted live"*.
  Writing it produced the reason it cannot work: **the chart's LINE is "how many
  different people came that week", and a distinct count cannot be summed** —
  seven daily `visitors` counts a Monday-and-Thursday member twice. Once the line
  has to read raw rows, the bars reading them too is one query instead of two
  sources that can disagree at their seam. The second reason is the same one the
  cache was refused for: **a nightly table is PARTIAL for part of every day**, and
  rendering a not-yet-written day as zero is a false number (:5807).
  **The rollup is still built and still written**, for the three reasons in
  `rollup.ts`'s header — the workout-side join is too expensive per page load and
  is what Reports needs; `gym_attendance` sits on the UNRULED half of the DPDP
  list, so the day it becomes deletable a live-reading chart silently rewrites a
  gym's history and this aggregate is what survives; and §3.2 specifies it.
  **When that ruling lands the chart's source moves onto the table**, which is
  what it is being written for.
- `adoptionPct` — §3.2's definition: 30-day visitors ÷ current members.
  **NULL when the gym has no members**, never 0 and never a divide — a zero here
  is a false statement about a gym nobody has joined yet.
- **`.max()` on every array, imported from a single declared constant** in
  `@app/shared` — :28452's C/H and :28649's "the three now live in `@app/shared`"
  are the same lesson twice; the 8 is `OVERVIEW_WEEKS`.

#### 4a.5 Server tests

- **Rollup, against real Postgres** (R9.2): a gym in a non-UTC zone whose
  midnight is not UTC midnight, with visits either side of it, lands each on the
  correct local day · a second session the same day is TWO visits and ONE visitor
  · a workout with a same-day visit counts, one without does NOT, and one by a
  member removed before that day does NOT · a re-run changes nothing (the
  idempotency test literally asserts equality across two runs) · a late-synced
  workout inside the trailing window is picked up on the next run.
- **The hour filter**: a gym at local 02:xx is rolled, a gym at local 09:xx is
  not, in one run — the fixture holds BOTH, because a filter that is silently
  inert passes any test whose fixture can only produce one answer (:28649).
- **Route**: happy path · a foreign gym gets 404 (R3.2's cross-tenant denial) ·
  a staff row with `attendance.read` UNTICKED gets 403 · validation failure ·
  a gym with no members returns `adoptionPct: null` and the screen says so.
- **Migration test**: the two columns exist, are NOT NULL, and every pre-existing
  row reads 0.
- **Mutation sweep** (:5348 rule 4, scoped by :5857 rule 4a — these are *numbers
  a user sees*, the row that always gets mutated), pointed at LOCAL Postgres
  (:13659), at minimum: delete the attendance join from the workout predicate ·
  delete the membership-interval condition · swap `count(DISTINCT user_id)` for
  `count(*)` · delete the hour filter · delete the `AT TIME ZONE` · make the
  upsert an INSERT.

### 4b · WEB HALF

`apps/web/src/pages/console/Overview.jsx` gains a numbers zone above the join
code, plus `overviewView.js` (pure) + `overviewView.test.js` for every string and
every "should this be drawn at all" predicate — the shape every console panel in
this repo already uses (`consoleView`, `billingView`, `attendanceView`).

**The pane reports its OWN outcome.** The screen already runs three
independently-authorised reads through `Promise.allSettled` after :10596's C/H-1;
this is a fourth, and a trainer without `attendance.read` must lose the NUMBERS,
not the screen.

**Empty states, and this is where the class lives (:8267, :8343, :26736):**

| State | What it says |
|---|---|
| Read failed | the failure card with Try again — never zeros |
| No members ever | the tiles are not drawn at all; the join-code CTA is the screen (§4.1's own edge) |
| Members but nobody has ever come | *"Nobody has marked attendance yet"* — NOT "0 visits" |
| Fewer than 7 days of history | the chart says it is still collecting, per §4.1 |

**"We have no data" and "the answer is zero" are DIFFERENT SENTENCES**, and
printing the second for the first is the defect :8267 was raised on and :26736
caught one card ago before it shipped.

**Web tests:** each state above renders its own sentence · the tiles draw the
server's figures and compute NOTHING (a mutant that changes a served number must
move the screen; a mutant that adds arithmetic must be impossible because there
is none) · a 403 on the overview read leaves the rest of the screen intact.

---

## 5 · RISKS AND TRAPS, NAMED BEFORE THEY BITE

1. **`org_member_stats` IS A TRAP ON THIS SCREEN.** The view exists since
   `0001_init` (`0001_init.sql:612-625`) and its `workouts_30d` counts workouts
   **anywhere** — which is the one thing :26469 §1.3 says is NEVER shown to a
   gym. Nothing in this card may read it. Its legitimate reader is the Members
   screen's own card, and even there the column needs the presence rule.
2. **Summing a distinct count.** §4a.1. It looks right, it is wrong by exactly
   the number of people who come twice, and no test with a one-visit fixture can
   see it.
3. **Counting a page in the browser** — :27992 §3's *"THE SPECIFIC BREAKAGE"*.
   Every figure here is served.
4. **`users.timezone` is still not captured** (:618, owed since 2026-07-11). It
   is not needed here and must not be reached for: every day on this card is the
   GYM's day, from `gyms.timezone`, which is exactly what makes it correct.
5. **A gym that changes its timezone** re-buckets its future days and leaves its
   past ones as recorded. Correct, and stated so nobody "fixes" it later by
   rewriting history.
6. **The first run on a database with attendance history** writes only the
   trailing window unless `--days` is widened. The backfill is a step, not an
   assumption (§4a.3).

---

## 6 · WHAT THIS CARD DEFERS, AND WHERE EACH LINE LIVES

Every one of these gets its `OWED.md` line **in the commit that records this
plan**, not later (CLAUDE.md's deferral rule):

- The people lists (who came today · when they come · on a roll · slipping away ·
  this week's roster) — the next card.
- **The gym's one-tap cheer** (§2.4) — Kd's ruling, built in that card,
  delivered on `My Gyms` until push exists.
- `org_live_counters` — §3.2's Redis cache, not built, with its reason.
- The at-risk NUDGE — still blocked on push, as its existing line says.

---

## 7 · THE GATE

**Nothing is built until Kd approves this document** (:26777). What he is being
asked to approve is §3 (the scope), §4a.1 (the migration, as SQL, per T5/R4.4)
and the split at §2.3 — the four rulings in §2 are already his.
