# CARD — "I'm here": gym attendance

**Status: WRITTEN, NOT BUILT. Awaiting Kd's approval at the plan gate.**
Rulings: `DECISIONS.md` :26469 + addenda :26558, :26586 · the hours rulings
:26624, :26684, :26736 (attendance is stamped with the session it fell in) ·
**and four answers Kd gave at this gate on 2026-09-01, one of which overruled the
recommendation** (streaks — §3.9 below). Tracked at `OWED.md`'s
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

**A member sees their own list of days they came** — your answer at this gate.

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
| Counting a second visit on the same day | §4a stores one visit per person per day — see the cost stated there |
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
  - `created_at`.
  - **UNIQUE (gym_id, user_id, day)** — one visit per member per gym per day.
    This is what makes the write idempotent when somebody double-taps (R3.5) and
    what stops one person inflating "how many came today".
    - **THE COST, STATED RATHER THAN BURIED (Kd may veto this at the gate):** a
      member who trains in the morning AND comes back in the evening is counted
      once, in the morning session. The alternative — one row per session — makes
      the headline number "people who came today" require a DISTINCT, and gives
      no answer at all for the three statuses that have no session. **The
      recommendation is one-per-day; the reversal is a migration, not a rewrite.**

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
| `GET /v1/orgs/:gymId/attendance?day=YYYY-MM-DD` | staff with **`members.read`** | who came — the same privilege that already gates the roster; no new privilege is minted |
| the manual switch | **`org.manage`**, on the existing `PATCH /v1/orgs/:gymId` | one more field on the gym-details door rather than a sixteenth write door. **Read :19366 and :19560 before touching that route** — it carries the country lock |

- The write goes through `requireWritablePrivilege`… **and that is the one thing
  in this table to check rather than assume.** That guard is built for CONSOLE
  writes by STAFF; this is a write by a MEMBER, and a lapsed gym's members were
  ruled to keep the free app rather than be locked out (:22215). **OPEN QUESTION
  FOR THE BUILD, not for Kd: can a member mark attendance at a gym whose plan has
  lapsed?** The recommendation is **yes** — the gym still exists, the member still
  turns up, and refusing would show a member something false about their own gym
  (:5807). An archived gym (:25771) is a different matter and should refuse.
  Whichever way it lands, it needs its own test, because the existing gates
  answer a different question.
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
- a non-member gets 404 on the mark and on the member read; a `trainer` without
  `members.read` gets 403 on the gym-side list.
- **double-tap produces ONE row** and answers 200 both times, with the second
  answer identical to the first (R3.5).
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
the `ON CONFLICT` arm · the streak union. Local Postgres (`test:local`), per
:13659, and the harness prints which database it used.

### 4b — WEB HALF (a separate chat, after 4a's T3)

- The member's gym card gets the **"I'm here"** button, and after a tap it says
  what was recorded — including the session, or that the gym said it was closed.
  **It is absent, not greyed, when the gym has the switch off** — a dead button
  with no explanation is the defect :24141 named.
- **The member's own history**: a short list of the days they came, on the same
  card, newest first.
- Console → a **"Who came"** view: today by default, with a date picker, showing
  time in, how they marked it, and which session.
- Console → Settings gains the **manual-attendance switch**, obeying `readOnly`
  like every other panel (:24141, :24376).
- **The times drawn are the GYM's times, in the gym's chosen clock format**
  (`gyms.clock_format`, migration `0018`) — the same reader the hours screens
  already use, so the two screens cannot disagree.
- Tests: the five statuses render distinguishably; `hours_unset` renders no claim
  about opening hours; the button's absence when the switch is off; a
  double-tap does not draw two entries.

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
6. **The api DB-backed suites need Docker Desktop running.** One request to Kd
   per machine restart, then the chat runs them itself.

## 6 · SPEC GAP / DEVIATION

**None.** Attendance has zero spec hits anywhere in `docs/spec/` (grep-verified
at :26469 and again this session) — this is new product. Every shape above traces
to a Kd ruling at :26469, :26558, :26586, :26624, :26684 or :26736, or to his
four answers at this gate, or is declared above as a call of mine with its cost
stated.

**Two things are explicitly waiting for Kd at the gate rather than assumed:**
the one-visit-per-day rule (§4a, with its cost), and whether a member of a
LAPSED gym can still mark attendance (§4a, recommendation: yes).
