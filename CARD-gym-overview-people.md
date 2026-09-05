# CARD — "On a roll", and the gym's one-tap cheer

**STATUS: WRITTEN, UNAPPROVED.** Kd chose this feature over the three other
people-list panels on 2026-09-04. **That choice is a FEATURE-SHAPE approval and
is NOT a code gate** — `:26777` is the recorded cost of treating one as the
other. Nothing is built until he has seen the file list, the migration SQL and
the test list below and said go.

**THIS FILE IS THE PEOPLE-LISTS CARD, TAKEN ONE SLICE AT A TIME.** `OWED.md`'s
people-lists line names this filename for all five panels; building five panels
in one card is the thing `:29961` ruling 3 already refused once. **Slice 1 is
"on a roll" + the cheer** (§3). The other panels keep their place in §3.2 and
their `OWED.md` line is amended, never ticked.

---

## 1 · IN PLAIN WORDS (this part is for Kd)

A gym owner opens their console and sees, under the numbers, **a short list of
the members who keep turning up** — "Priya · 5 weeks running · 3 days in a row ·
11 visits".

Beside each name is one button. Pressing it sends that member **an emoji and a
short ready-made line** — "💪 Great week — keep it going." No typing, no box to
fill in. **One per member per week**, so it stays a compliment rather than spam.

The member sees it on their **My Gyms** screen, on the card for that gym.

**Two honest limits, said now rather than found later:**

1. **Nothing in this app can push a notification.** The cheer is *stored* and
   waits on a screen. When the phone app is built it becomes a real
   notification with nothing rebuilt — but today, a member who never opens
   My Gyms never sees it.
2. **The gym only ever counts visits to that gym.** It cannot see training done
   anywhere else, and this card does not change that.

---

## 2 · THE RULINGS THIS IMPLEMENTS, so the build cannot drift from them

| Ruling | What it binds here |
|---|---|
| `:29961` ruling 4 | An emoji + a ready-made line, **one tap**, capped **one per member per week**, **no free-text box**. His own addition, and he chose it against a "let the owner type" arm whose costs were stated. |
| `:29961` §4 / `:30055` | **In this product "send" means "write something a screen will show."** No mailer, no SMTP, no notifications table. |
| `:29961` ruling 3 | Numbers first, people lists second. This is the lists half, sliced. |
| `:26469` §1.3 | **The gym is NEVER shown what a member did away from it.** "On a roll" is computed from `gym_attendance` at THIS gym only — never from the member's own streak, which unions workouts anywhere. |
| `:27992` §3 | The owner's screen **must not pile up**: counts come from the SERVER, the list is a preview, never infinite. |
| `:27992` §2 | **No dues, arrears or payment concept** enters the schema, the routes or the screen. |
| `:23711` | Every write door in the orgs module goes through `requireWritablePrivilege` — so a **lapsed** gym and an **archived** gym are refused by gates that already exist. No new refusal vocabulary. |
| `:18128` | *"No free text ever, only one-tap compliments"* — the second time Kd has chosen that shape. |
| `:28822`, `:33091` | The member's gym surface is **My Gyms**. The dashboard carries the greeting line and nothing else gym-shaped. |

**AND THE SPEC ALREADY HAD HALF OF THIS, which is worth more than it sounds.**
`03-part3-org-console.md:280` specifies the at-risk list's one-tap nudge with
**`rate-limit 1/member/7d`** — Kd's "one per member per week" is the spec's own
number, arrived at independently, not a figure a chat picked (R0.2). `:207`
names the endpoint shape `POST /members/:uid/nudge`. §2.2's matrix (`:98`) grants
*Send "we miss you" nudge* to **all three roles**.

**So the cheer and the spec's at-risk nudge are ONE MECHANISM pointed opposite
ways** — same store, same cap, same one tap, different sentence and different
list. Building the cheer builds the nudge's engine, and the at-risk panel later
adds a query and a preset, not a subsystem.

---

## 3 · SCOPE

### 3.1 What this slice builds

| # | Thing | Where |
|---|---|---|
| 1 | Migration `0021_gym_cheers` | `apps/api/drizzle` |
| 2 | The "on a roll" query, off `gym_attendance` at this gym only | `modules/orgs/repo.ts` |
| 3 | `onARoll` on the existing `GET /v1/orgs/:gymId/overview` payload | `modules/orgs/{service,repo}.ts` |
| 4 | `POST /v1/orgs/:gymId/members/:userId/cheer` — the **sixteenth** write door | `modules/orgs/{routes,service,repo,schemas}.ts` |
| 5 | `latestCheer` on each gym row of `GET /v1/orgs/mine` | `modules/orgs/repo.ts` |
| 6 | The contracts, once | `packages/shared/src/orgs.ts` |
| 7 | An "On a roll" panel with its cheer button | `components/console/OnARollPanel.jsx` + `pages/console/onARollView.js` |
| 8 | The cheer on the member's gym card | `components/gym/GymMembershipCard.jsx` + `gymMembershipView.js` |

### 3.2 What this slice does NOT build, each with its home

- **When they come · slipping away · this week's roster · the activation
  checklist** — later slices of this same file. `OWED.md`'s people-lists line,
  amended not ticked.
- **The at-risk NUDGE button** — its engine ships here, its LIST does not. It
  keeps its existing `OWED.md` line.
- **Any notification, email or push.** §1 limit 1. No new `OWED.md` line — the
  "no email is ever sent" line already carries it (`:19016` §3.2).
- **A read-state for the cheer** ("seen"/"unseen"). Deliberately not built:
  it is a second table and a second write path for a dot. §4b.3 uses recency
  instead, which needs no schema.
- **A tenth privilege.** §6.2 — a call, with its cost, reversible in one line.

---

## 4 · THE BUILD PLAN

### 4a · SERVER HALF (one chat)

#### 4a.1 Migration `0021_gym_cheers` — T5: Kd reviews this SQL BEFORE anything else is written

Hand-written, like `0017`–`0020`. **`drizzle-kit generate` cannot be used in this
repo** (`OWED.md`), and a hand-written migration needs a hand-written
`drizzle/meta/_journal.json` entry — **without one, `drizzle-kit migrate` prints
"migrations applied successfully" and applies NOTHING** (`:28221` §6). After
applying, the objects are read back out of `pg_catalog` (`:20222`).

```sql
CREATE TABLE gym_cheers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id            uuid NOT NULL REFERENCES gyms(id) ON DELETE RESTRICT,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sent_by_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  preset            text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_cheers_preset_check CHECK (preset IN (
    'keep_going', 'on_a_roll', 'consistency', 'strong_streak'
  ))
);

CREATE INDEX gym_cheers_gym_user_created_idx
  ON gym_cheers (gym_id, user_id, created_at DESC);
CREATE INDEX gym_cheers_user_created_idx
  ON gym_cheers (user_id, created_at DESC);
```

**`preset` is an enum in a CHECK, not free text** — that is `:29961` ruling 4
living in the database rather than in a comment (`:27992` §1's shape). A future
writer that accepts a typed string gets 23514, loudly.

**`ON DELETE RESTRICT` per R4.3**, and the DPDP privacy list gains this table in
the same commit — it is user-linked (`:28452`'s trigger).

**NO UNIQUE ENFORCES THE CAP, AND THAT IS STATED RATHER THAN HIDDEN.** Kd's rule
and the spec's are both **rolling seven days**, which no UNIQUE or CHECK can
express. `:27992`'s "put the ruling in a constraint" applies where a constraint
CAN say it; here it cannot, so the rule is a check inside the transaction under
`lockOrgRow(gymId)` — the repo's existing seat-claim pattern — and its guard is a
test plus a mutant, not a comment. **The alternative considered and rejected: a
calendar-week UNIQUE, which is expressible but lets a Sunday cheer and a Monday
cheer both stand one day apart, breaking the rule it appears to enforce.**

#### 4a.2 The "on a roll" query — `repo.getGymRegulars(sql, gymId, limit)`

**KD RULED BOTH UNITS, 2026-09-04: *"both weeks and days run"*** (§6.1). Each row
carries two figures:

- **`weeksRunning`** — consecutive gym-weeks, counting back from the current
  week, in which the member made at least one visit.
- **`daysRunning`** — consecutive gym-days, counting back, on which they visited.

Both are in the gym's own clock (`gyms.timezone`), which is the unit
`org_daily_stats`, `gym_attendance.day` and the Overview chart already use.

**THE TRAP, AND IT IS THE REASON THIS SECTION IS LONGER THAN IT LOOKS: THE
MEMBER'S OWN STREAK IS NOT THIS NUMBER AND MUST NOT BE REUSED.** `streak.ts`
implements Part 7 §3.2's **freezes** — banked forgiveness that advances
`lastActivityDate` across missed days so a streak survives them (`reconcile`,
read this session). **A gym-facing figure built on that would print "5 days in a
row" for somebody who came three times**, which is `:5807` on a screen an owner
makes decisions from. `daysRunning` counts **real visits at this gym and
nothing else** — no freezes, no workouts, no other gym.

**SO THE TWO NUMBERS WILL DISAGREE, DELIBERATELY**, and the member may see a
longer streak in their own app than their gym shows. That is correct — they are
different questions — and it is **commented where it is written**, not only
here, which is the shape `:27900` §4 used for the same class of divergence.

**WHAT COUNTS AS STILL ALIVE IS BORROWED, NOT INVENTED**: `reconcile`'s rule is
that a gap of ≤ 1 day is not yet a miss (today or yesterday). `daysRunning` uses
the same convention so the two figures differ only by freezes, and not by a
second arbitrary rule. **An unfinished today never breaks either streak.**

- Reads `gym_attendance` **at this gym only** (`:26469` §1.3). It must not touch
  `getStreakDays`, `getActivityDays` or `org_member_stats` — all three count
  activity anywhere, and `org_member_stats` is the trap `:29961` §6.1 names.
- Live members only, non-complimentary — the same population `month.visitors`
  already uses, so the panel cannot list somebody the roster does not.
- The CURRENT week counts only if they have already come; an unfinished week
  with no visit yet must not break a streak on Monday morning. **This is the
  boundary a fixture whose visits all land in the current week cannot see**
  (`:30243`'s trigger).
- Ordered by `weeksRunning` desc, then `daysRunning` desc, then visits desc, then
  name — **weeks first, because that is the question the panel is answering**
  ("who keeps turning up"), and days is the detail beside it. Capped at a
  constant in `@app/shared`, previewed at 5 on screen (`:27992` §3 — a preview,
  never a page-count masquerading as a total).
- **`daysRunning` is drawn only when it is 2 or more.** "5 weeks running · 1 day
  in a row" is two true figures arranged into a sentence that reads as a
  contradiction — `:30624`'s class, which is this exact screen's recorded defect
  from one card ago. One row, one story.

#### 4a.3 `onARoll` on the existing overview payload — NOT a fifth read

`Overview.jsx` already issues **four** reads in one `Promise.allSettled`, and
`:30399`'s trigger names adding a fourth. A fifth is not added: `onARoll` rides
on `GET /v1/orgs/:gymId/overview`, which is already gated on `attendance.read`
and is already the attendance-derived payload.

`orgOverviewSchema` is `.strict()`, so this is a shared-contract change and takes
**`.default([])`** — `:31222` is the recorded cost of shipping a required field
into that contract, where an api older than the bundle drew nothing at all.

#### 4a.4 `POST /v1/orgs/:gymId/members/:userId/cheer` — the sixteenth write door

Measured this session, not recalled: `requireWritablePrivilege(` has **15 call
sites** in `modules/orgs/service.ts` and `orgs.routes.test.ts:6137` pins
`CONSOLE_WRITE_COUNT = 15`. **That constant is raised to 16 WITH its list entry
in the same edit, never ahead of it** (`:26812` §3 — the guard is worth nothing
if the count and the list move apart).

Inside one transaction, in this order:

1. `requireWritablePrivilege(deps, gymId, userId, <§6.2's privilege>)` —
   privilege first, so a stranger keeps the 404 and a staffer without the tick
   keeps the 403; only a caller who would otherwise be allowed reaches the 409
   `gym_not_on_plan` (`:23711` §2, and **O158 is the mutant that reverses it**).
2. `lockOrgRow(gymId)`.
3. **The recipient is a LIVE, non-complimentary member of THIS gym** — the one
   condition, exactly as attendance asks it (`:27992` §2: no dues check, ever).
   Otherwise 404, never a sentence naming whether the person exists.
4. **The rolling-7-day check**, under the lock. Already cheered inside 7 days →
   typed **409 `cheer_already_sent`**, ~~carrying the instant the next one
   becomes available so the screen states it rather than guessing.~~
   **— STRUCK by T3 round 1's Low-3, and round 2 found this copy still
   standing.** The error carries a status, a code and a sentence and nothing
   else: `OrgsError` is shared by seventeen doors, and widening it for one rare
   path is R1.1's drive-by. **The instant reaches the screen on
   `cheerableAt` in the overview payload**, which is also what a stale page
   needs re-read anyway — `service.ts` says so at length where the 409 is
   thrown.
5. Insert, ~~**No `audit_log` row** — `:28221` §7's reasoning: the log records
   what staff did TO a gym's shape, and cheers are high-volume and
   reversible-by-nothing.~~ **— STRUCK by T3 round 1 (C/H-3): that citation says
   the OPPOSITE.** `:28221` §7 exempts a MEMBER tapping "I'm here" — *"the log
   records what STAFF did, and several hundred member taps a day would bury
   it"* — and `markGymAttendance`'s own docblock draws the line explicitly:
   *"every other writer in this module is a console action behind a privilege"*.
   A cheer IS one of those, and Kd's cap of one per member per 7 days disposes
   of "high-volume". **So it writes `org.member_cheered`**, per
   `03-part3-org-console.md:214` — *"every mutating call writes `audit_log`"* —
   which no `DEVIATION PROPOSAL` had ever been raised against.

**Rate limit:** its own `createDualRateLimit` bucket, per-account and per-IP. It
must NOT share the attendance bucket (600/hour), which `:28649` L-5 sized for a
whole gym tapping in at once — a different shape of traffic entirely.

#### 4a.5 `latestCheer` on `GET /v1/orgs/mine`

One field on the gym row: `{ preset, createdAt }` or null. Read off a lateral on
the existing query — **not a second round trip**, and not a second endpoint.

**`.default(null)` in the shared contract, and this is the third time the reason
is being written down**: `orgsApi.js` treats a contract mismatch as a HARD
failure, so a required field destroys the whole gym card during any
web-newer-than-api window (`:12660`, then `:31222`, which added one four hours
after citing `:12660`).

**A plain member is told nothing about staff** (§2.4) — the field carries the
preset and the time, never who pressed the button.

#### 4a.6 Server tests (named before the code — Part I §7a)

- **The cap**: a second cheer inside 7 days is 409; one at 7 days + 1 minute is
  201. Both directions, because a guard whose only tested failure is "it did not
  fire" is satisfied by a door that is simply shut (`:7104`'s PG1).
- **Cross-tenant**: gym B's owner cheering gym A's member is 404 — **and** a
  scoping case, because a 404 test and a scoping test are different tests and a
  route can refuse the stranger while leaking into the owner (`:28221` §3a).
- **Two gyms, two memberships** in the "on a roll" fixture: with one membership
  a missing `gym_id` predicate leaks nothing and the mutant cannot die
  (`:28221` §3b).
- **The regulars query must not see another gym's visits**, and must not see the
  member's own workouts at all (`:26469` §1.3).
- **The unfinished-current-week boundary** (§4a.2), on a fixture whose visits do
  NOT all land in the current week.
- **BOTH figures, and the case that tells them apart**: a member with a long
  week-streak and NO day-streak (came once a week for five weeks) must read
  `weeksRunning: 5, daysRunning: 1` — a fixture where the two numbers move
  together cannot see one being computed from the other.
- **The freeze divergence, asserted rather than assumed** (§4a.2): a member whose
  gamification streak is alive on a banked freeze reads a SHORTER
  `daysRunning` here. This is the test that stops a later chat "simplifying"
  the query into a call to `replayActivityDays`.
- **A lapsed gym is refused; an archived gym is refused; a live gym is not** —
  the third arm is what stops the gate being a door that is simply shut.
- **Write-door count**: `CONSOLE_WRITE_COUNT` 16, list and count moved together.
- **The DDL CHECK guard**: `db.migration.test.ts` reads `gym_cheers_preset_check`
  back out of `pg_get_constraintdef` and asserts it equals the shared preset
  list — the same shape `:28107` uses for `ORG_PRIVILEGES`.

#### 4a.7 Mutants

Numbered from the **true maximum id in use**, computed rather than taken from the
file's last row (`:30094`'s duplicate-id lesson, and both harnesses now carry the
guard). **Measured this session: `mutate-orgs.mjs` max is `O260`;
`mutate-console.mjs` max is `C214`.**

Every row sits in `:5857` rule 4a's always-mutated columns — ownership, numbers a
user sees, anything that writes. Database mutants are in scope because this card
changes server behaviour. Wording and layout are deliberately not mutated.

Aimed at: the gym predicate in the regulars query · the gym predicate in the cap
check · the cap's comparison direction · the live-member condition · the
current-week boundary · the privilege/gate order · the `.default([])` ·
`latestCheer`'s user predicate · **the week/day gap comparisons (one mutant
each, because a single fixture can satisfy both)** · **the `>= 2` rule that
hides a one-day streak.**

### 4b · WEB HALF (a separate chat, after 4a's T3)

1. **`onARollView.js`** — pure, tested without a browser: **both streak
   sentences and the rule that hides a one-day streak** (§4a.2), the visits
   caption, whether the panel draws at all, and whether the button is live.
   `OnARollPanel.jsx` is markup. This is the split `overviewView.js` /
   `OverviewNumbers.jsx` already uses on this screen. **The pure test's fixture
   must carry a row where the two figures DISAGREE** — one where they move
   together cannot see the sentence built from the wrong field
   (`:30399` §6's C155, which passed under exactly that).
2. **Empty states, told apart** (`:8267`/`:8343`): *nobody is on a roll yet* is
   not *this gym has no members* and neither is *the read failed*. A gym with no
   members draws nothing (§4.1's own edge). **No sentence may claim "ever"** —
   the payload sees a bounded window, which is the exact defect `:30399` §4
   declined to ship.
3. **The button's three states**: live · "Cheered this week" with the day it
   frees up · and greyed with a true sentence on a read-only (lapsed) gym
   (`:24141` — every dead button is greyed with a sentence saying why, never
   silently inert).
   **AND IT LIVES ON THIS PANEL ONLY — NEVER ON THE MEMBERS ROSTER** (T3 round
   2). The panel and the write door agree on their population: both exclude
   complimentary members (§4a.4 step 3). **The roster does not** — it draws a
   comped member with an orange *Complimentary* badge (`:15093`), so a Cheer
   control there would answer *"That person isn't a member of this gym"* about
   somebody the owner is looking at, badge and all. That is `:5807` on a screen,
   and it is unreachable today only because no screen exists. **A Cheer control
   anywhere the roster is drawn needs the refusal to be re-ruled FIRST** — the
   one-sentence 404 is step 3's deliberate choice, not an oversight to route
   around.
4. **The presets carry NO NUMBERS.** A stored line saying "4 weeks!" is true the
   minute it is sent and false the week after — `:7298`'s class, a sentence that
   outlives the condition that raised it. The streak figure is drawn live beside
   the name, never baked into the message.
5. **Member side**: the cheer on the My Gyms gym card. **Not on the dashboard** —
   `:33091` is Kd's ruling that gym things live in My Gyms, and the greeting line
   is the dashboard's whole gym presence.
6. **A recency dot on the My Gyms nav item** when the newest cheer is under 7
   days old. **A chat's call with its cost, struck in one line if Kd says so**:
   without something pointing at it, a cheer waits on a screen nobody opens (§1
   limit 1). It uses recency and not read-state, so it needs no second table —
   and its cost is that the dot stays for the week whether or not they looked.
7. **Smoke sheet**: `RUNBOOK/smoke-on-a-roll-cheer.md`. **It needs a member with
   a multi-week visit history at Kd's own gym, which does not exist today** — the
   sheet says so in its setup section rather than carrying a step that cannot
   pass (`:29870`'s stale-setup lesson, `:26012`'s shape).

---

## 5 · RISKS AND TRAPS, named before the build rather than found after

1. **The member's global streak is the wrong number TWICE OVER, and it is RIGHT
   THERE.** `getStreakDays` unions workouts and attendance across every gym —
   showing that to a gym is `:26469` §1.3's one forbidden thing — **and
   `replayActivityDays` spends FREEZES, so even scoped to one gym it would
   report days nobody attended** (§4a.2). It is the obvious function to reach
   for and it is wrong in both directions at once. **The regulars query must
   never import from `gamification/`**, and §4a.6's freeze test is what holds
   that after this card's author has gone.
2. **`org_member_stats` counts workouts ANYWHERE** and has sat unread since
   `0001_init`. `:29961` §6.1 names it as the trap for exactly these panels.
3. **A fixture where every visit lands in the current week** cannot see the
   boundary in §4a.2, and cannot see a missing week-ordering either
   (`:30243`'s trigger).
4. **A one-gym, one-membership fixture** cannot see a missing tenancy predicate
   (`:28221` §3b). Two of each, in both new fixtures.
5. **A test asserting the cheer button ARRIVES enabled** passes under a button
   that can never be pressed. `:31295` is that exact defect shipped twice, and
   the standing rule from it: **for a two-state control, assert the state it is
   NOT in when you find it.**
6. **Two correct numbers can make a false screen.** "5 weeks running" beside
   "11 visits" invites the reading that they are the same population over the
   same window; they are not. `:30624` is this card's screen doing precisely
   that, one card ago, found by Kd and not by 1,659 tests.
7. **A cheer is a write from a console that may be read-only.** If it is not
   behind `requireWritablePrivilege`, a lapsed gym keeps cheering — the
   screen-deep rule wearing a server's clothes that `:23711` §1 refused.

---

## 6 · WHAT GOES TO KD AT THIS GATE

### 6.1 ANSWERED — KD RULED BOTH UNITS, 2026-09-04

Put to him because *"comes to gym reguraly and maintains a continous streak"*
does not settle the unit and a chat must not pick the number (R0.2). Three arms,
weeks recommended. **He took a fourth: *"both weeks and days run"*.**

| Arm | Reads | Cost as put to him |
|---|---|---|
| A — consecutive WEEKS *(recommended)* | "5 weeks running" | Once-a-week and five-times-a-week read the same. |
| B — consecutive DAYS | "5 days running" | Almost nobody trains daily — the list would be empty at most gyms. |
| C — most visits in 30 days | "11 visits" | A leaderboard, not a streak. |
| **KD: A **and** B, both on the row** | "5 weeks running · 3 days in a row" | Two figures to keep honest instead of one. |

**HIS ANSWER IS BETTER THAN THE RECOMMENDATION AND THE REASON IS WORTH KEEPING:
A and B fail in opposite directions.** Weeks alone cannot tell a once-a-week
member from a daily one — the recommendation's own stated cost. Days alone is
empty at most gyms. **Together each covers the other's blind spot**, and the
panel can say "steady for months" and "here right now" in one row.

**WHAT IT COSTS, and it is why §4a.2 grew:** two figures on one row is
`:30624`'s recorded defect class on this exact screen — hence the `>= 2` rule —
and the day figure is the one that collides with the member's own freeze-backed
streak, which is now §5's risk 1 and a named test.

### 6.2 CALLS MADE FOR HIM, each with its cost, each reversible in one line

Written down because this card's own history says so twice: flagging a chat's
call at the gate produced a Kd ruling in one line — **once reversing it
(`:27992` §1) and once ratifying it (`:28055` §1)** — and both would have cost a
rebuild to discover later.

1. **The cheer is gated on `members.read`, not on a new tenth privilege.** Every
   role that may see the roster may cheer, which is §2.2's three ticks exactly.
   **Cost:** an owner cannot stop one staffer cheering without also taking their
   roster away. **Reverse it** and it becomes `members.cheer`, a migration —
   DDL CHECK widen, backfill, role templates, a tick box and two "newest"
   fixtures (`:28107`'s standing rule: adding a privilege is a migration in this
   repo, not a list edit).
2. **Rolling 7 days, checked under the gym lock** — not a calendar-week UNIQUE.
   §4a.1 carries the reasoning and what it costs.
3. **The presets, in the gym's voice, no numbers in any of them** (§4b.4):
   💪 *Great week — keep it going.* · 🔥 *You're on a roll.* ·
   👏 *Nice consistency — we see you.* · 🏆 *Strong streak.*
   **These are copy a gym sends a member, so they are his to change.**
4. **A recency dot on the My Gyms nav item** (§4b.6).
5. **This file is the people-lists card sliced**, rather than a new filename,
   so `OWED.md`'s tracked name stays true.

### 6.3 SPEC GAP / DEVIATION

**None.** The cap is the spec's own `1/member/7d` (`03-part3:280`); the endpoint
follows the spec's `POST /members/:uid/nudge` shape (`:207`); §2.2's matrix
grants all three roles. **The at-risk LIST the spec attaches this button to is
not built here** and keeps its `OWED.md` line — this card builds the same button
on the list Kd asked for instead.

---

## 7 · THE GATE

Not passed. Kd has chosen the feature; he has **not** seen or approved this file
list, the migration SQL (§4a.1), the test list (§4a.6), or §6's one question and
five calls. `:26777` is the recorded cost of building at a gate that was never
passed.
