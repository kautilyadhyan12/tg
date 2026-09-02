# CARD — "I'm here": gym attendance

**Status: §4a (SERVER HALF) BUILT 2026-09-01 — `DECISIONS.md:28221`. Migration
`0019` reviewed as SQL by Kd and approved before anything else was written
(T5/R4.4). §4b (WEB HALF) IS SPLIT IN TWO, with Kd told before he approved,
because one chat cannot hold two screens and two switches: its MEMBER HALF IS
BUILT 2026-09-02 (`DECISIONS.md:28822`) and its OWNER HALF IS UNBUILT.
T3 ROUND 1 RAN ON THE MEMBER HALF (`DECISIONS.md:28976`): THREE Critical/High
and FOUR Low, all seven fixed, so that packet does NOT ship its round and a
DIFF-ONLY ROUND 2 IS OWED. T3 is UNRUN on the server half. NO BROWSER SMOKE HAS
RUN on either.**

**AND KD RULED A SECOND THING ON 2026-09-02, at the plan gate for §4b: the
member's gym features get their OWN SECTION in the member app's left nav,
called `My Gyms`, which appears ONLY once a gym has approved them** — *"it will
appear only after a gym approves a memebr joining"*. **Joining stays where it
is**, on Settings → Gym: *"gym card in settings will be there user will join
thriugh there"*. **It is NOT the `My Gym` he removed on 2026-08-19 (:11616),
which pointed at the gym-owner CONSOLE — that crossing stays shut in both
directions.** Full ruling and the reasoning at `DECISIONS.md:28822`.
Rulings: `DECISIONS.md` :26469 + addenda :26558, :26586 · the hours rulings
:26624, :26684, :26736 (attendance is stamped with the session it fell in) ·
**and Kd's answers at this gate on 2026-09-01, across four passes: five
questions answered (TWO against the recommendation — streaks, and one visit per
day) plus five rulings he added unprompted (the app never checks a member's
dues; the owner's screen must not pile up; the gym sees who attended by name;
attendance is its own console section; staff see it by default and the owner can
change that). Rulings 9 and 12–18 below. NOTHING ON THIS CARD IS OPEN.**
Tracked at `OWED.md`'s
"ATTENDANCE / QR CHECK-IN" line. Branch `web-repoint`, as every gym card has been.

---

## 1 · IN PLAIN WORDS (this part is for Kd)

A member opens their gym card and taps **"I'm here"**. That is it. The gym now
knows who came today.

The gym owner opens the console and sees **the list of who came**, with the time
each person arrived and which of the gym's sessions they arrived in.

Because the gym has already said when it is open, each visit can say something
true about itself: *arrived in the 6–7am session* · *arrived outside opening
hours* · *arrived on a day the gym said it was closed* · *this gym is open 24
hours* · *this gym has not said when it is open*. **Nobody is ever turned away
for arriving at an odd time — the visit is recorded and labelled, never refused.**
That is your ruling, and it is the honest thing for a gym that forgot to update
its hours.

**Coming back later the same day counts again.** A member who trains in the
morning session and returns for the evening one has attended **twice**, and the
owner sees both times against that person's name. Your ruling, and §4a builds it
by making the SESSION the thing that tells two visits apart.

**A member sees their own list of days they came** — your answer at this gate.

**Whether a member has paid the gym is the gym's business, not the app's.** The
app never checks it and never blocks anybody over it; a gym that wants somebody
out removes them from the roster, which it can already do. Your ruling.

**The owner's screen is built so it cannot become a wall of names.** A busy gym
produces hundreds of taps a day, and a flat list of them is unreadable — the
screen leads with the count per session, then lists PEOPLE (not taps), each with
their times beside them. §4b is the whole design and it is a requirement of this
card, not polish added afterwards.

**Coming to the gym now keeps a streak alive** — also your answer. §3.9 says
exactly what that does and does not change, because it is the one part of this
card that touches numbers people already have.

**There is no QR anywhere in this card.** You ruled the whole scanning path
belongs to the phone app. On the web there is one way in: the member taps the
button.

**The owner can switch that button off** in Settings. It ships switched ON,
because switching it off today would leave a gym with no way to record anybody
at all — the scanner that replaces it arrives with the phone app.

---

## 2 · WHAT IT DOES NOT DO, so nobody expects it

| Not in this card | Where it lives |
|---|---|
| A QR code, a poster, a scanner, a scan link | **the phone app** — your ruling (:26558, :26586) |
| The gym's Overview numbers and the 8-week chart | the NEXT card (:26469 §1.2) |
| Front-desk staff marking somebody present | **your answer at this gate: not now.** The record stores WHO marked each visit from day one, so it can be added later without spoiling the history |
| ~~Counting a second visit on the same day~~ | **IN this card — Kd ruled it in at the gate.** A second visit in a DIFFERENT session counts again |
| Counting a second visit at a gym that has declared NO sessions | **ruled out by Kd** — *"only one time attandance"*. The remedy is the gym declaring its sessions |
| Checking whether a member has paid the gym | **never the app's job** — Kd, at this gate. The gym removes them from the roster |
| Booking a place in a session, capacity limits | booking — its own card, the biggest on the gym list |
| Marking somebody present for a PAST day | not asked for; the button means "I am here now" |
| Telling a gym who trained somewhere else | **struck by Kd** (:26469 §1.3) — do not re-propose |

---

## 3 · THE RULINGS THIS IMPLEMENTS, so the build cannot drift from them

1. **Attendance is built BEFORE the gym's numbers** (:26469 §1.4, :26624 §2).
2. **Two ways in, stored as DIFFERENT THINGS from day one** (:26469 §1.4, §4) —
   even though only one of them is reachable on the web today. A single
   "attended" flag throws away the only thing that makes the number trustworthy,
   and no later card recovers it.
3. **The whole scan path is phone-app work** (:26558, :26586). Nothing in
   `apps/web` draws or consumes a QR.
4. **The owner can switch the manual option off, and it ships ON** (:26469 §1.4,
   :26586's stated consequence).
5. **A visit outside opening hours is RECORDED AND MARKED, never refused**
   (:26624 §4.4).
6. **A visit on a closed day is RECORDED AND MARKED, never refused** (:26684).
7. **A visit is stamped with the session it fell in** (:26624 §1).
8. **"Hours not set" is its own state and is never dressed up as something else**
   (:26736) — a visit at a gym that has not said when it is open is labelled as
   exactly that, not as "outside hours".
9. **Coming to the gym keeps a streak alive** — Kd, 2026-09-01, at this gate,
   overruling the recommendation to defer it. §4a §"STREAKS" states the whole
   consequence.
10. **A member sees their own attendance history** — Kd, 2026-09-01, at this gate.
11. **Everything about a day is in the GYM's own time zone** (:26469 §5, trap #8)
    — with one named exception, in §5 risk 2, where it collides with the streak.
12. **A SECOND VISIT IN A DIFFERENT SESSION COUNTS AGAIN, and the owner sees
    that the member attended twice** — Kd, 2026-09-01, at this gate, overruling
    the one-visit-per-day recommendation. §4a makes the SESSION the thing that
    distinguishes two visits, so the ruling lives in a UNIQUE constraint rather
    than in a comment.
13. **THE APP NEVER CHECKS WHETHER A MEMBER HAS PAID THE GYM** — Kd, same gate:
    *"if a memebr is not part of the gym or have not paid then gym memebr can
    remove them thas gym responsibility"*. Attendance asks one question only —
    is this a live member of this gym — and the gym's own remedy is the
    `members.remove` door it already has. **Do not add a dues, arrears or
    payment condition to any attendance path.**
14. **THE OWNER'S SCREEN MUST NOT PILE UP** — Kd, same gate: *"many memebr will
    come attend and give attandance … it might pile up and may be hard to
    analuse and see so the ui should be clean and beautiful"*. This is a build
    requirement with a test, not a styling note; §4b is the design and §5 risk 6
    is what happens if it is treated as polish.
15. **AT A GYM WITH NO SESSIONS IT IS ONE ATTENDANCE PER DAY** — Kd,
    2026-09-01: *"only one time attandance"*, closing the question ruling 12
    left open. **A time window is not to be proposed here; the remedy is the gym
    declaring its sessions.**
16. **THE GYM SEES WHO ATTENDED, BY NAME** — Kd, same message: *"will gyms be
    able see who attended etc ? beacvuse they should"*. It was already the
    card's main owner-facing screen (:26469 §1 — *"the gym … SEES who came"*),
    and his asking is recorded because **a feature nobody can find is a feature
    that is not there**.
17. **ATTENDANCE IS ITS OWN CONSOLE SECTION, NOT A CORNER OF SETTINGS** — Kd,
    2026-09-01: *"it should not be in settings but in a section call attandance
    a new option besides gym memebr settings etc"*. **A fourth item in the
    console's left rail**, beside `Gym`, `Members` and `Settings` — measured,
    those are the three that exist today (`ConsoleLayout.jsx:118-121`).
18. **STAFF SEE IT BY DEFAULT, AND THE OWNER CAN CHANGE THAT** — Kd, same
    message: *"also stafs can see it too default permission owner can change
    it"*. **This mints the ninth privilege, `attendance.read`, ON by default for
    all three roles, WITH A TICK BOX** — and the tick box is not a detail, it is
    the half of the ruling that says *"owner can change it"*. §4a says what that
    costs, including the one thing that silently breaks without a migration.

---

## 4 · SPLIT INTO TWO CHATS, because one card is one chat (Part I §1)

### 4a — SERVER HALF

**Migration `0019_gym_attendance.sql`** — hand-written, for `0016`/`0017`'s
recorded reason (`drizzle/meta/` stops at `0012_snapshot.json`, so the generator
re-emits later migrations and dies on an existing column). **Reviewed as SQL by
Kd before anything else is written (R4.4 / T5).**

- `gyms.manual_attendance_enabled` — `boolean` NOT NULL DEFAULT `true`.
  Ruling 4. **DEFAULT true is the ruling, not a convenience**: false would mean
  every existing gym silently loses the only way it has to record anybody.
- `gym_attendance` — one row per person per gym per day:
  - `gym_id` (CASCADE), `user_id`, `marked_by_user_id`.
    - **`marked_by_user_id` is separate from `user_id` from day one**, and today
      they are always equal. This is Kd's "only the member, for now" answer built
      so that a front-desk button later adds a value rather than rewriting
      history — the same argument his own §4 ruling makes about `method`.
  - `day` — `date`, **the GYM's calendar day**, computed server-side as
    `(now() AT TIME ZONE g.timezone)::date`.
    - **STORED, never derived on read.** A gym may edit its time zone in Settings
      afterwards (:19366, :20075), and re-deriving would silently move every past
      visit to a different day. The day a visit happened is the day the gym and
      the member both saw on screen.
  - `marked_at` — `timestamptz` NOT NULL DEFAULT `now()`, the instant. `day` is
    the bucket; this is the clock time the console prints.
  - `method` — `text` + CHECK `('manual','qr')`, ruling 2. Only `manual` is
    reachable until the phone app ships. **The CHECK carries `qr` from day one on
    purpose**: it is the ruling made physical, and a later ALTER of a CHECK
    constraint is exactly the migration nobody wants to write on live data.
  - `hours_status` — `text` + CHECK
    `('in_session','open_24h','outside_hours','closed_day','hours_unset')`,
    rulings 5–8. Five values because five different true things can be said, and
    collapsing any pair loses one of them:
    | value | what it means |
    |---|---|
    | `in_session` | fell inside one of the gym's sessions; the window is stored beside it |
    | `open_24h` | the gym is open 24 hours, so there is nothing to fall outside of |
    | `outside_hours` | the gym HAS said when it is open, and this was not then |
    | `closed_day` | a dated closure covered this day |
    | `hours_unset` | the gym has never said when it is open, so nothing can be judged — :26736's third state, one level in |
  - `session_opens_minute` / `session_closes_minute` — `smallint`, NULLABLE, set
    only when `hours_status = 'in_session'`.
    - **NOT a foreign key to `gym_hours`, deliberately.** `PUT /hours` REPLACES
      the whole week, so those rows are deleted and re-inserted every time an
      owner edits the timetable — an FK would either dangle or cascade a gym's
      attendance history into nothing. **The window is copied because it is a
      historical fact, not a live reference.**
    - A CHECK ties them together: both NULL, or both set with `closes > opens`,
      **and non-NULL only when `hours_status = 'in_session'`**.
  - `slot_key` — `text` NOT NULL. **This column exists to make ruling 12
    enforceable rather than remembered**, and it is the only genuinely new idea
    in the schema:
    | `hours_status` | `slot_key` |
    |---|---|
    | `in_session` | the session window in minutes, e.g. `360-420` |
    | `open_24h` | `open_24h` |
    | `outside_hours` | `outside_hours` |
    | `closed_day` | `closed_day` |
    | `hours_unset` | `hours_unset` |
    - **NOT NULL and never blank**, so the UNIQUE below always bites — a
      nullable key would let Postgres treat every NULL as distinct and silently
      re-admit the double-taps this is built to stop.
    - The window is copied, not referenced, for the same reason
      `session_opens_minute` is: `PUT /hours` deletes and re-inserts the week.
  - `created_at`.
  - **UNIQUE (gym_id, user_id, day, slot_key)** — **Kd's ruling 12, made
    physical.** A member who attends the 6–7am session and comes back for the
    4–9pm one has two DIFFERENT `slot_key`s, so both rows exist and the owner
    sees two times. A member who taps the same session twice has the same key,
    so the second tap returns the first row: idempotent, and an accidental
    double-tap can never inflate the gym's number (R3.5).
    - **AT A GYM WITH NO SESSIONS IT IS ONE ATTENDANCE PER DAY, AND THAT IS NOW
      A RULING RATHER THAN A LIMIT** — Kd, 2026-09-01: *"only one time
      attandance"*, answering the open question this card raised. At a gym open
      24 hours, or one that has not set its hours, the four non-session keys are
      constant, so the second tap returns the first row. **This was the shape
      already built, and what changed is its status: it was a chat's stated
      consequence and is now his call.** A future chat proposing a time window
      here — "count it again after an hour" — is re-opening a settled question,
      and the number it would have to pick is the R0.2 invention this avoided.
      The remedy for a gym that wants repeat visits counted is to declare its
      sessions, which is the feature shipped last card.

**AND THE SAME MIGRATION MINTS THE NINTH PRIVILEGE — ruling 18, with the trap
that makes it a migration rather than a one-line array edit.** All of this is
measured, not recalled:

- `ORG_PRIVILEGES` in `@app/shared` gains **`attendance.read`** (eight today —
  `orgs.ts:1282-1291`).
- **`gym_staff.privileges` carries a CHECK that lists all eight names in DDL**
  (`tenancy.ts:404-405`, `privileges IS NULL OR privileges <@ ARRAY[…]`). **A
  ninth name added only in TypeScript is refused by Postgres on every save** —
  the owner ticks the box, the save 500s, and nothing in the type system sees it
  coming. **The migration widens that CHECK, in the same commit as the array.**
  - **The guard for this already exists and will go red on its own:**
    `db.migration.test.ts:549` asserts the CHECK's contents equal
    `[...ORG_PRIVILEGES].sort()`. **Do not "fix" it by editing the expectation —
    it is the thing telling you the DDL was not widened.**
- **BACKFILL, on :21157's precedent.** A staff row whose `privileges` is NULL
  falls back to the ROLE template and gains the new tick for free; a row with a
  STORED set does not, and would silently lose the default Kd just ruled. **So
  the migration adds `attendance.read` to existing stored sets** — this is not
  overriding an owner's choice, because no owner has ever made a choice about a
  privilege that did not exist.
- `ROLE_PRIVILEGES` gains it for **owner, manager AND trainer** — *"stafs can
  see it too"*, and the trainer's list is the one that proves it (it holds only
  `members.read` and `codes.invite` today, `orgs.ts:1401`).
- **NOT in `OWNER_ONLY_PRIVILEGES`** (a manager's row must be able to carry it)
  and **NOT in `LAST_OWNER_REQUIRED_PRIVILEGES`** (losing a READ locks nobody
  out of anything — that list guards `staff.manage` and `billing.manage`, both
  of which can strand a gym).
- **A SEVENTH ENTRY IN `PRIVILEGE_COPY`** (`staffView.js:178-209`), which is
  where the tick box actually comes from. **Six of the eight privileges have a
  box; `org.manage` and `billing.manage` do not, and `OWED.md` carries that as a
  known gap (:21157).** Shipping `attendance.read` without a box would make it
  the third — **and it would break ruling 18 outright, because "the owner can
  change it" would be false.**
- **A FIXTURE WILL GO STALE BECAUSE THE FUTURE ARRIVED, and it is the same one
  as last time:** :21157's audit found `schemas.test.ts` using `billing.manage`
  as its stand-in for *"a privilege a newer server knows"*, and fixed it with a
  positive control asserting **the REAL newest privilege parses**. Minting this
  one moves what "newest" means. `db.migration.test.ts:677`'s `legacySeven` is
  the same shape — it filters `billing.manage` by name and its arithmetic still
  passes with nine, so **it goes quiet rather than red**, which is worse.
  **Both are to be looked at deliberately, not waited for.**

**`packages/shared/src/orgs.ts`** — the contract, once, for both sides (R7.2):
`gymAttendanceMethodSchema` · `gymAttendanceHoursStatusSchema` ·
`gymAttendanceEntrySchema` · the mark request and its response · the member's
own-history response · the gym-side day list · and
`manualAttendanceEnabled` added to the existing gym-details shapes.

**Routes** (`/v1`, the module's existing shape — thin route, service owns authz,
repo owns tenancy):

| Route | Who | Notes |
|---|---|---|
| `POST /v1/orgs/:gymId/attendance` | a **live member** of that gym | idempotent on (gym, user, gym-day); refused when the gym has the manual switch OFF |
| `GET /v1/orgs/:gymId/attendance/me` | a **live member** | the member's own days, newest first, cursor-paginated with a bound on BOTH ends (:26947's Low) |
| `GET /v1/orgs/:gymId/attendance?day=YYYY-MM-DD` | staff with **`attendance.read`** | who came — ruling 18's own tick, ON by default for all three roles and switchable off per person by the owner. **Answers PEOPLE, each carrying their visits, plus a per-session count** — see below |
| the manual switch | **`org.manage`**, on the existing `PATCH /v1/orgs/:gymId` | one more field on the gym-details door rather than a sixteenth write door. **Read :19366 and :19560 before touching that route** — it carries the country lock |

**THE GYM-SIDE READ ANSWERS PEOPLE, NOT TAPS — this is ruling 14 built into the
contract rather than left to the screen.** A 300-member gym running three
sessions can produce several hundred rows in a day; a screen handed that list has
already lost. The response is:

- **a per-session summary**: each of the day's sessions with a count, plus counts
  for each non-session status that actually occurred. **The owner reads the shape
  of the day before a single name.**
- **the people**, one entry per member, each carrying their visit times and
  statuses for that day. **A member who came twice is ONE entry with TWO times**
  — which is exactly what Kd asked to be able to see, and is also what stops the
  list growing faster than the gym's membership.
- **cursor pagination, bounded at BOTH ends** (:26947's Low), ordered by first
  visit time.
- **the exceptions are answerable without paging through everybody**: a filter
  for visits that were outside hours or on a closed day, because those are the
  rows an owner actually goes looking for.
- **ONE MEMBER'S OWN HISTORY, on the same route** (`?userId=`, no `day`), so an
  owner asking *"how often does this person actually come?"* is answered by a
  filter rather than by a second endpoint. **My call, and small on purpose:**
  same route, same `attendance.read` privilege, same tenancy predicate, same
  cursor — it adds a WHERE clause, not a surface. It is the direct reading of
  ruling 16's *"who attended etc"*, and building a separate route for it would
  be a second thing to secure (:14401's shape).

**THE LAPSED-GYM QUESTION IS ANSWERED — Kd, at this gate: a member of a gym
whose plan has lapsed CAN still mark attendance.** So the write does **not** go
behind `requireWritablePrivilege`: that guard is built for CONSOLE writes by
STAFF, and using it here would refuse a member on a lapsed gym, contradicting
both this answer and :22215's arm A. **An ARCHIVED gym (:25771) is a different
matter and refuses**, because nobody new joins and nothing new happens there.
**This needs its own test on each arm — live gym, lapsed gym, archived gym —
because the existing gates answer a different question and quoting them here
would be quoting the wrong guarantee.**

**AND NOTHING ON THIS PATH ASKS WHETHER THE MEMBER HAS PAID THE GYM** (ruling
13). The only condition is a live membership row. A gym removes somebody it does
not want through `members.remove`, and a removed member's mark is already refused
by that same condition — **one check, doing both jobs, which is why no dues
concept enters the schema.**
- **`POST` and `PATCH` reach a browser through a CORS preflight
  `fastify.inject` cannot exercise — verify `app.ts`'s method list before
  claiming this works** (Card 4's dead-method bug).
- `CONSOLE_WRITE_COUNT` is **15** today (`orgs.routes.test.ts:6117`). The gym-side
  read adds none; if the switch lands as its own route instead, the count and the
  list move together in one edit, never one ahead of the other (:26812 §3).

**STREAKS — Kd's ruling 9, and this is the part with a consequence**

Measured this session, not recalled:

- `apps/api/src/modules/gamification/repo.ts:136` — `getActivityDays` reads
  `SELECT DISTINCT … FROM workouts`. **Workouts and nothing else.**
- `service.ts:31` `onWorkoutSynced` REPLAYS the whole streak from that list every
  sync, and `recomputeXp` recomputes the lifetime XP total from the same list.

So "a gym visit keeps a streak alive" means that list must become **workout days
UNION attendance days**. Three consequences, each stated so nobody discovers them
in review:

1. **Nobody's existing streak, badge or XP moves on the day this ships**, because
   there are zero attendance rows today. It starts mattering as people tap in.
   This is measured, not hoped: the table does not exist yet.
2. **A gym visit keeps the streak alive but earns NO XP.** The union is used by
   the STREAK replay only; XP keeps reading workout days. **Kd ruled streaks, not
   XP**, and paying XP for a button tap would let somebody level up without
   training — the same objection his own manual-versus-QR ruling is built on.
   Two functions, `getStreakDays` (workouts ∪ attendance) and the existing
   `getActivityDays` (workouts, for XP), and a test that pins the difference.
3. **The 🔥 badges become reachable by attendance**, because `streak_3/7/30/100`
   fire off `current_streak` (`badges.ts:42-45`). That is the direct effect of
   the ruling and is correct, not a leak.

A new `onAttendanceMarked` hook in gamification's service, called from the orgs
service the way `workouts` and `nutrition` already call it (R7.1 — a service
interface, never another module's repo).

**Tests** — `apps/api/test/orgs.attendance.test.ts`, plus additions to
`orgs.routes.test.ts`, `db.migration.test.ts` and the gamification suite:

- happy path: mark, read it back on both the member's list and the gym's day list.
- **the cross-tenant denial case on all three routes** (R9.2) — a member and a
  staffer of gym B get 404 on gym A.
- a non-member gets 404 on the mark and on the member read.
- **ruling 18 from BOTH directions**: a `trainer` — the narrowest role — reads
  the gym-side list **by default**, with no ticks edited, which is the half a
  test usually skips · and a staffer the owner has UNTICKED gets 403. **A test
  that only proves the refusal is satisfied by a door that is simply shut**
  (:19560's O124).
- **the ninth privilege round-trips through the DATABASE, not just the type
  system**: save `attendance.read` onto a staff row and read it back. Without the
  widened CHECK this is the test that fails, and it fails where the defect is
  rather than on a screen.
- **RULING 12, from both sides, because a UNIQUE has two failure directions and a
  test that only checks it FIRES is satisfied by a door that is simply shut**
  (:19560's O124 lesson): a second tap in the SAME session produces ONE row and
  answers 200 twice with an identical body (R3.5) · **a tap in a DIFFERENT
  session the same day produces a SECOND row**, and the gym-side read shows that
  member once with TWO times · a second tap at a gym with no declared sessions
  stays one row, which is the stated limit and is pinned so nobody later thinks
  it is a bug and "fixes" it into an invented time window.
- **the gym-side read's shape**: a member who came twice appears ONCE with two
  times, and the per-session counts add up to the number of visits, not the
  number of people — the two figures differ exactly when somebody came twice, so
  a fixture with a repeat visitor is the only one that can tell them apart.
- **the `?userId=` filter** (ruling 16): returns that member's days and **only
  that member's** — a fixture with two members who both attended, asserting the
  other one is absent, because a filter that silently does nothing passes any
  test that only checks the wanted rows are present. **And its own cross-tenant
  case**: a `userId` belonging to gym B returns nothing on gym A rather than
  leaking that the person exists.
- **the lapsed and archived arms, each on its own fixture**: a member of a LIVE
  gym marks · a member of a LAPSED gym marks (Kd's answer) · a member of an
  ARCHIVED gym is refused. **A test that drives only the live arm proves
  nothing about the other two.**
- **no payment condition exists anywhere on the path** (ruling 13) — a member
  with a live membership row marks successfully regardless of anything the gym
  believes about their dues, because there is no such field to believe.
- **a removed member cannot mark** — and the test drives a real removed
  membership row rather than an absent one.
- the switch: OFF refuses the mark with a sentence a member can act on; ON
  allows it; **the switch is per-gym**, so a second gym is unaffected.
- **all five `hours_status` values, each on a fixture built to produce it** —
  including `hours_unset` on a gym that has never opened the hours section, which
  is :26736's guarantee one level in and the one a reviewer should check first.
- **`in_session` stores the window and survives the timetable being replaced** —
  mark, then `PUT` a completely different week, then read the visit back and see
  the ORIGINAL window. This is the no-FK decision's only observer.
- **the gym's day, not the server's**: the fixture drives a PAIR of gyms at
  opposite extremes (UTC+14 and UTC-12, 26 hours apart) so their calendar dates
  always differ and the server's date can match at most one — :26812 §2a's
  lesson, which a single non-UTC gym would fail to observe for ten hours of
  every day.
- **editing the gym's time zone afterwards does not move a past visit's day.**
- streaks: an attendance-only day extends the streak · **the XP total does NOT
  move for an attendance-only day** (consequence 2, pinned by a test rather than
  a comment) · a day with BOTH a workout and an attendance counts once.
- migration: every CHECK and the UNIQUE read back out of `pg_get_constraintdef`
  after migrating (:20222's lesson).

**Mutation sweep** (`tools/mutate-orgs.mjs`, rule 4/4a — this card changes server
behaviour and touches ownership, a number a user sees, and something that saves,
so it is squarely in the always-mutated columns): the tenancy predicate on each
new repo function · the live-membership check on the mark · the manual switch's
guard · the gym-zone date expression · each arm of the `hours_status` decision ·
**`slot_key`'s session arm, aimed at the ACCEPTING case — two sessions must both
land — because a mutant that only proves the UNIQUE fires is satisfied by a
constant key** (risk 7) · the `ON CONFLICT` arm · **the per-session counts, which
are a number a user sees and therefore rule 4a's first column** · the streak
union, whose mutant must turn an XP test red and not only a streak test. Local
Postgres (`test:local`), per :13659, and the harness prints which database it
used.

### 4b — WEB HALF (SPLIT IN TWO, 2026-09-02)

**4b-1 — THE MEMBER'S HALF: BUILT 2026-09-02, `DECISIONS.md:28822`.** The
`My Gyms` section Kd ruled the same day, the **"I'm here"** button and the
sentence it answers with, and the days they came. **Everything below marked
"(built)" shipped there; everything else is 4b-2, the OWNER's half, and is
UNBUILT** — the console's Attendance section, the manual switch on Settings, and
the tick box. **The split is chat size and nothing else** (Part I §1: one card,
one chat; this section is two screens and two switches), and Kd was told before
he approved.

- **(built)** The member's gym card gets the **"I'm here"** button, and after a tap it says
  what was recorded — including the session, or that the gym said it was closed.
  **It is absent, not greyed, when the gym has the switch off** — a dead button
  with no explanation is the defect :24141 named.
- **(built)** **The member's own history**: a short list of the days they came,
  on the same card, newest first. **It lives inside `My Gyms` rather than on the
  dashboard card — Kd's 2026-09-02 ruling, made at this gate.**
- **(built, and it was NOT in this card when it was written)** **`My Gyms` — a
  new item in the MEMBER app's left nav**, shown only once a gym has approved
  them, holding the gym's opening times and the two bullets above. **Read
  `DECISIONS.md:28822` before touching that nav list: the item Kd REMOVED from
  it on 2026-08-19 pointed at the console, and telling the two apart is what
  keeps :11616 intact.**
- Console → **a section of its own called "Attendance"** — ruling 17, his words:
  *"a new option besides gym memebr settings etc"*. **A fourth item in the left
  rail**, which today holds exactly three: `Gym`, `Members`, and `Settings`
  (conditional) — `ConsoleLayout.jsx:118-121`, measured. It is NOT a panel
  inside Settings: Settings is where a gym CONFIGURES itself, and this is a
  thing an owner opens every morning. **:14570 and :11616 both govern that nav
  list — read them before editing it.**
  - **The item is shown when the person holds `attendance.read`** — and
    **hiding it is not the enforcement** (R3.3, :11429 rule 4). The route 403s
    on its own, and the screen still has to draw the server's sentence if one
    arrives, exactly as `StaffPanel` already does.
  - **The manual-attendance switch stays in SETTINGS**, not here, and that is
    the ruling rather than an inconsistency: the switch CONFIGURES the feature,
    the section USES it. Ruling 17 moved the list out of Settings; it did not
    move the setting.
- **This is ruling 14 and it is the largest design job in the card**, so it is
  specified rather than left to the chat that builds it. Top to bottom:
  1. **The day, and the way to move between days** — a calendar control, the
     same one the closures screen already uses, so the two console screens do
     not offer two different date pickers.
  2. **THE SHAPE OF THE DAY, BEFORE ANY NAMES.** One row per session —
     `6:00 am – 7:00 am · 34 people` — in time order, plus a row for each
     non-session status that actually occurred that day. **A gym with three
     sessions reads its whole day in three lines.** This is the part that stops
     the pile-up, and it is why the server answers a summary rather than letting
     the browser count a list it had to download first.
  3. **THE EXCEPTIONS, NEXT, BECAUSE THEY ARE WHAT AN OWNER LOOKS FOR** — how
     many arrived outside opening hours or on a day the gym said it was closed,
     as a control that filters the list below to exactly those. **Never a red
     badge on a person**: the visit is unusual, the member is not in trouble,
     and :26624 §4.4 exists precisely so nobody is refused for it.
  4. **THE PEOPLE, ONE ROW EACH, NOT ONE ROW PER TAP.** Name, then their times
     as small chips — `6:12 am` `5:40 pm` — so **"this member attended twice" is
     visible at a glance**, which is what Kd asked for, and a day with 400 taps
     across 300 people is 300 rows rather than 400.
  5. **A name search**, because past a couple of hundred people the only
     question an owner has is about one person — **and picking that person opens
     THEIR history**, the `?userId=` read above, answering *"how often do they
     actually come?"* without leaving the screen.
  6. **Paged, never infinite-scrolled**, and the empty state says which of the
     two things is true — nobody has marked attendance today, or this gym has
     the button switched off — because those look identical and only one of them
     is a problem (:8267/:8343's class).
- **What it must NOT do:** no live-updating ticker, no chart (that is the
  Overview-numbers card), no per-tap row, and no colour that implies a member did
  something wrong.
- ⚠️ **THE TWO READS SHARE ONE RATE-LIMIT BUCKET, AND THAT IS THIS SCREEN'S
  CONSTRAINT TO RESPECT** (recorded 2026-09-02, attendance T3 round 2 Low-5).
  `GET …/attendance` and `GET …/attendance/history` are both behind the SAME
  limiter instance in `orgs/routes.ts` — one name, therefore one Redis key — so
  an owner's **600 requests/hour is spent by BOTH**, and picking a member out of
  the list (which is a history read) draws from the same allowance as the day
  list. **Sustained, that is one request every six seconds for everything this
  screen does.** No polling loop, no refresh-on-focus that also re-reads a
  history, and if this screen ever wants live-ish updates the limiter is what
  has to change first — deliberately not changed in advance, because the
  interval that would break it is this card's decision and nobody has made it.
  **The "no live-updating ticker" line above is now also a server constraint.**
- Console → Settings gains the **manual-attendance switch**, obeying `readOnly`
  like every other panel (:24141, :24376).
- Console → Settings → Staff gains the **seventh tick box**, *"See who came in"*,
  in `PRIVILEGE_COPY`. **Ruling 18's second half lives here and nowhere else** —
  without it, "the owner can change it" is a sentence with no control behind it.
  Worded like its six neighbours: plain, second person, no jargon.
- **The times drawn are the GYM's times, in the gym's chosen clock format**
  (`gyms.clock_format`, migration `0018`) — the same reader the hours screens
  already use, so the two screens cannot disagree.
- Tests: the five statuses render distinguishably; `hours_unset` renders no claim
  about opening hours; the button's absence when the switch is off; a double-tap
  does not draw two entries; **a member who came twice draws ONE row with TWO
  times** (ruling 12 at the screen, and the one a reviewer should check first);
  **the session summary is drawn from the server's counts and never recomputed in
  the browser** — a screen that counts its own page would report the page, not
  the day; and **the empty state tells the two cases apart** (nobody came yet vs
  the switch is off).

---

## 5 · RISKS, named before the build rather than found after

1. **The streak union is the highest-risk edit in this card, and it is in a
   module this card is not otherwise touching.** The XP total is recomputed from
   a neighbouring function on every sync; getting the two lists confused pays XP
   for button taps, silently, to everybody. A reviewer should mutate the union
   and watch an XP test go red — if only a streak test moves, the split is a
   comment rather than a guarantee.
2. **A day has two owners here and they can disagree.** A visit's day is the
   GYM's day; a streak's day is the USER's day, and `users.timezone` is captured
   nowhere (:618, still owed), so in practice every user is bucketed as UTC. A
   9pm visit in Assam is the NEXT day in UTC. **The call: the streak takes the
   attendance's stored gym-day as-is rather than re-bucketing it.** "The day you
   went to the gym" is the day both the member and the gym saw on screen, and
   re-bucketing would credit a day the member never saw. This is a deliberate
   inconsistency with the workout path and must be commented where it is written,
   not just here.
3. **`hours_status` is computed once, at the moment of the tap, and then frozen.**
   If the owner edits the timetable an hour later, yesterday's visits keep the
   labels they were given. That is right — it is what was true when the person
   walked in — but it is the kind of thing that reads as a bug to somebody who
   did not expect it, so the console should say the label describes the visit,
   not the current timetable.
4. **The manual switch is a way to make the feature unreachable.** Its OFF state
   must say plainly that scanning arrives with the phone app, or an owner will
   turn it off, see nothing recorded, and conclude attendance is broken.
5. **`0019` is hand-written**, so the snapshot debt grows by one. It already has
   an `OWED.md` line; this card does not fix it and must not claim to.
6. **THE PILE-UP IS A RULING, AND THE WAY IT GETS BROKEN IS BY TREATING IT AS
   POLISH.** Kd raised it unprompted, before a line existed. The specific failure
   is a screen that downloads the day's visits and counts them in the browser: it
   looks right on a fixture of six and reports the first page on a fixture of
   four hundred. **The counts come from the server or they are wrong**, and that
   is the assertion §4b's test makes.
7. **THE NINTH PRIVILEGE HAS A FAILURE MODE THE TYPE SYSTEM CANNOT SEE.**
   `gym_staff.privileges` is guarded by a CHECK that lists the eight names in
   DDL. Add the ninth in TypeScript alone and everything compiles, every unit
   test passes, and the first owner who ticks the box gets a 500 from Postgres.
   **The array and the CHECK move in ONE commit**, and
   `db.migration.test.ts:549` is the guard that says so.
8. **`slot_key` is the ruling's only load-bearing column.** If a future writer
   ever sets it to a constant, or lets it be blank, the UNIQUE stops
   distinguishing sessions and every gym silently reverts to one visit per day —
   with no error anywhere. It is in the mutation sweep for exactly that reason,
   and the mutant should be aimed at the ACCEPTING case (two sessions must both
   land), not only at the refusing one (:26812 §2b).
9. **The api DB-backed suites need Docker Desktop running.** One request to Kd
   per machine restart, then the chat runs them itself.

## 6 · SPEC GAP / DEVIATION

**None.** Attendance has zero spec hits anywhere in `docs/spec/` (grep-verified
at :26469 and again this session) — this is new product. Every shape above traces
to a Kd ruling at :26469, :26558, :26586, :26624, :26684 or :26736, or to his
answers at this gate, or is declared above as a call of mine with its cost
stated.

~~**Two things are explicitly waiting for Kd at the gate rather than assumed:**
the one-visit-per-day rule (§4a, with its cost), and whether a member of a
LAPSED gym can still mark attendance (§4a, recommendation: yes).~~
**BOTH ANSWERED 2026-09-01, and one of them reversed the recommendation:** a
second visit in a DIFFERENT session **counts again** (ruling 12) and a member
of a lapsed gym **can** mark (agreed as recommended). He added two rulings
nobody had asked for — **the app never checks whether a member has paid the
gym** (13) and **the owner's screen must not pile up** (14).
~~**One thing is now left open and it is named rather than defaulted: whether a
gym that is open 24 hours, or has not declared its sessions, should also count
repeat visits.**~~ **CLOSED the same day — *"only one time attandance"*
(ruling 15). NOTHING ON THIS CARD IS NOW OPEN.** He then ruled 16–18
unprompted: the gym sees who attended by name, **Attendance is its own console
section rather than a corner of Settings**, and **staff see it by default with
the owner able to change that** — which mints the ninth privilege and its tick
box. §4a carries the one thing that breaks silently if that is done in
TypeScript alone.
