# CARD — the gym's PEOPLE LISTS, taken one slice at a time

~~# CARD — "On a roll", and the gym's one-tap cheer~~ **— the old title named
slice 1 only, and this file holds more than one slice by design. The FILENAME is
unchanged, because `OWED.md`'s people-lists line tracks it by name.**

| Slice | What | State |
|---|---|---|
| **1** | "On a roll" + the one-tap cheer (§§1–7) | **CLOSED** — built, T3 zero Critical/High, CI green, smoked (`:36144`, `:36363`, `:36392`) |
| **2** | **"Slipping away" + the "we miss you" nudge** (§§S2.1–S2.7) | **APPROVED 2026-09-07 (`:36816`) — server half BUILDING** |
| 3–5 | When they come · this week's roster · §5.1's activation checklist | not written |

**STATUS OF SLICE 1: BOTH HALVES BUILT — server 2026-09-04 (`DECISIONS.md:34240`), web
2026-09-05 (`:34809`).** ~~The web half's SMOKE and T3 are both UNRUN, so the
`OWED.md` line does not tick.~~ **— BOTH DISCHARGED: T3 rounds ran (`:34992`,
`:35153`), the confirm step and the gym-day cap followed, and the 🟡 line TICKED
on 2026-09-06 (`:36392`).** See §7.

~~**WRITTEN, UNAPPROVED.** Kd chose this feature over the three other
people-list panels on 2026-09-04. **That choice is a FEATURE-SHAPE approval and
is NOT a code gate** — `:26777` is the recorded cost of treating one as the
other. Nothing is built until he has seen the file list, the migration SQL and
the test list below and said go.~~ **— both gates passed; the sentence is kept
because the rule it states did not stop being true.**

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
fill in. ~~**One per member per week**~~ **ONE PER MEMBER PER DAY — Kd reversed
his own cap on 2026-09-05 at his browser (`:35762`), and "a day" means the GYM's
day.** Still one tap and still no typing, so it stays a compliment rather than
spam; what changed is that a gym can now say something each time somebody turns
up. **Every "7 days" left in this document below is the OLD rule and is struck
where it appears** (`:20587` — a figure moves in all of its copies or none).

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
| `:29961` ruling 4 | An emoji + a ready-made line, **one tap**, ~~capped **one per member per week**~~, **no free-text box**. His own addition, and he chose it against a "let the owner type" arm whose costs were stated. |
| **`:35762`** | **SUPERSEDES the cap above — ONE PER MEMBER PER GYM-DAY**, his own reversal of his own ruling, taken at the screen. The one tap, the four presets and the no-free-text half of `:29961` ruling 4 are UNTOUCHED and a later chat must not fold them in. |
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
**`rate-limit 1/member/7d`** — ~~Kd's "one per member per week" is the spec's own
number, arrived at independently, not a figure a chat picked (R0.2).~~ **STRUCK
2026-09-06: `:35762` §1 rules that this spec line describes the AT-RISK NUDGE, a
DIFFERENT feature, and is "not loosened by" the cheer's cap. The two numbers
agreeing was a coincidence and it is over — the cheer is one per member per
gym-day and the nudge's `1/member/7d` is untouched.** `:207`
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
| 8 | The cheer on the member's gym card | ~~`components/gym/GymMembershipCard.jsx`~~ **`pages/MyGyms.jsx`** + `gymMembershipView.js` |

**CORRECTED 2026-09-05, WHEN §4b WAS BUILT.** §4b.5 says *"the My Gyms gym
card"* and this row named a different component — and §4b is right. `:33091`
took the membership row off the dashboard, so `GymMembershipCard` now draws on
Settings → Gym only, while `My Gyms` renders its own gym rows straight from
`useMyGyms` → `memberOrgs`, which returns the WHOLE `/v1/orgs/mine` row and
therefore already carries `latestCheer`. Putting the cheer through
`gymStatusRows` would have been a second path to a field one screen already
holds. `gymMembershipView.js` is still correct: the pure helpers live there.

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

**NO UNIQUE ENFORCES THE CAP, AND THAT IS STATED RATHER THAN HIDDEN.** ~~Kd's
rule and the spec's are both **rolling seven days**, which no UNIQUE or CHECK can
express.~~ **THE REASON CHANGED AND THE OUTCOME DID NOT, which is why this is
struck rather than rewritten: since `:35762` the cap IS a calendar gym-day, and a
calendar day CAN be expressed as a UNIQUE — so the check-then-act below is now a
deliberate choice rather than the only option. `:35822` kept it and wrote the
reason into `sendGymCheer`'s own docblock: a rule change does not authorise a
migration.** `:27992`'s "put the ruling in a constraint" applies where a constraint
CAN say it; ~~here it cannot~~ **here it CAN since the cap became a calendar
gym-day, and the check-then-act stays anyway**, so the rule is a check inside the
transaction under
`lockOrgRow(gymId)` — the repo's existing seat-claim pattern — and its guard is a
test plus a mutant, not a comment. ~~**The alternative considered and rejected: a
calendar-week UNIQUE, which is expressible but lets a Sunday cheer and a Monday
cheer both stand one day apart, breaking the rule it appears to enforce.**~~
**— that alternative died with the rolling window it was weighed against. The
live question is now a `UNIQUE (gym_id, user_id, gym_day)`, which WOULD say the
rule exactly; it is not built because a migration needs its own gate and Kd
approved a cap change, not a schema change (`:26777`, `:35822`).**

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
4. ~~**The rolling-7-day check**, under the lock. Already cheered inside 7 days~~
   **THE GYM-DAY CHECK, under the lock (`:35762`, built at `:35822`): both sides
   of the comparison go through `AT TIME ZONE`, and a member already cheered on
   the gym's calendar TODAY** →
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
   A cheer IS one of those, and Kd's cap — ~~one per member per 7 days~~ **one
   per member per gym-day since `:35762`** — disposes of "high-volume" at either
   number: the ceiling is one row per member per day, not per tap. **So it writes `org.member_cheered`**, per
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

- **The cap**: ~~a second cheer inside 7 days is 409; one at 7 days + 1 minute is
  201.~~ **A second cheer on the same GYM-DAY is 409; one the next gym-day is 201**
  (`:35762`; the suite moves the stored cheer with `moveCheerToGymDay` rather than
  waiting). Both directions, because a guard whose only tested failure is "it did
  not fire" is satisfied by a door that is simply shut (`:7104`'s PG1) — **and the
  READER needs the same pair, which is what T3 round 1 C/H-2 found missing
  (`:35944` §3: a rule enforced in one place and reported from another takes
  mutants in pairs).**
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

### 4b · WEB HALF (a separate chat, after 4a's T3) — **BUILT 2026-09-05, `DECISIONS.md:34809`. Smoke and T3 both UNRUN.**

**FOUR THINGS CHANGED BETWEEN THIS PLAN AND WHAT SHIPPED, each declared rather
than made quietly (R0.3):**

1. **FOUR BUTTONS, NOT ONE.** §1's *"one button"* and §6.2.3's four approved
   lines cannot both be built — one button sends one preset and leaves three of
   Kd's four lines unreachable. Four emoji on the row is still ONE TAP (nothing
   opens first, nothing is typed), and Kd approved the four messages at this
   card's gate. Detail at `:34809` §6.
2. **A FOURTH BUTTON STATE**, which §4b.3 did not name: the overview read is
   gated on `attendance.read` and the cheer on `members.read`, so a staffer can
   legitimately SEE this list and be refused every button on it. Drawing a live
   control there is `:12518` C/H-2 exactly. `:34809` §3.
3. **THE MEMBER'S HALF IS `MyGyms.jsx`**, not `GymMembershipCard` — see the
   correction under §3.1.
4. **A 409 TAKES ITS OWN OUTCOME VALUE**, separate from "you just sent one",
   because the cap is per GYM and the cheer may have been a colleague's days
   ago. `:34809` §4, and `:34443` §4 is what one wrong pronoun already cost on
   this feature.

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
3. **The button's three states**: live · ~~"Cheered this week" with the day it
   frees up~~ **"Cheered today." — or "Cheered — you can again tomorrow." when
   the server has said when (`:35762`, `:35822`)** · and greyed with a true
   sentence on a read-only (lapsed) gym
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
2. ~~**Rolling 7 days, checked under the gym lock** — not a calendar-week
   UNIQUE.~~ **THE GYM'S CALENDAR DAY, checked under the gym lock** (`:35762`
   ruled the cap, `:35822` built it). §4a.1 carries the reasoning and what it
   costs — including that a calendar day COULD now be a UNIQUE and deliberately
   is not.
3. **The presets, in the gym's voice, no numbers in any of them** (§4b.4):
   💪 *Great week — keep it going.* · 🔥 *You're on a roll.* ·
   👏 *Nice consistency — we see you.* · 🏆 *Strong streak.*
   **These are copy a gym sends a member, so they are his to change.**
4. **A recency dot on the My Gyms nav item** (§4b.6).
5. **This file is the people-lists card sliced**, rather than a new filename,
   so `OWED.md`'s tracked name stays true.

### 6.3 SPEC GAP / DEVIATION

**None.** ~~The cap is the spec's own `1/member/7d` (`03-part3:280`);~~ **STRUCK
2026-09-06 — the cap is KD'S OWN RULING at `:35762`, one per member per gym-day,
and `:35762` §1 rules that the spec's `1/member/7d` governs the AT-RISK NUDGE
rather than this button. That is not a deviation: the spec line was never this
feature's authority, and the sentence above claiming it was is what made the old
number look spec-backed** (`:35944` C/H-1 — a stale figure wearing a spec
citation). The endpoint
follows the spec's `POST /members/:uid/nudge` shape (`:207`); §2.2's matrix
grants all three roles. **The at-risk LIST the spec attaches this button to is
not built here** and keeps its `OWED.md` line — this card builds the same button
on the list Kd asked for instead.

---

## 7 · THE GATE

~~Not passed. Kd has chosen the feature; he has **not** seen or approved this file
list, the migration SQL (§4a.1), the test list (§4a.6), or §6's one question and
five calls.~~ **— PASSED IN TWO PARTS, AND BOTH HALVES ARE NOW BUILT.**

- **§4a, the server half** — Kd approved migration `0021` as SQL (T5/R4.4) and
  the build; shipped 2026-09-04 (`:34240`), then T3 rounds 1 (`:34443`) and 2
  (`:34666`), which the packet passed with zero Critical/High.
- **§4b, the web half** — Kd approved the plan, the four preset lines and the
  nav dot on 2026-09-05; shipped the same day (`:34809`).

~~**WHAT IS STILL OPEN: the smoke and T3 on the web half.**~~ **— NOTHING IS.
Both ran, the cap changed under Kd's own reversal (`:35762`), that packet was
reviewed and smoked too, and the 🟡 line ticks (`:36392`).** The reason the smoke
was only partly runnable is worth carrying into slice 2 unchanged — the list
needed a visit history no screen in this product can create, and **Kd ruled that
such history may be written straight into the database** (`:35240`,
`tools/seed-on-a-roll-visits.ts`). `:26777` remains the recorded cost of building
at a gate that was never passed.

---
---

# SLICE 2 — "SLIPPING AWAY": the members who have stopped coming, and the one tap that says so

**WRITTEN 2026-09-07. UNAPPROVED. NOTHING IS BUILT.** Kd chose this panel from
the same four on 2026-09-06 (`DECISIONS.md:36503`) — *"ok your recommendation"*.
**That choice is a FEATURE-SHAPE approval and is NOT a code gate** (`:26777`: an
approval covers what was on screen when it was given, and what was on screen was
a panel, not a file list, a migration or a test list).

## S2.1 · IN PLAIN WORDS (this part is for Kd)

A gym owner opens their console and sees, under the numbers and beside **On a
roll**, a second short list: **the members who used to come and have stopped** —
"Rahul · last came 3 weeks ago · 18 visits".

Beside each name is one button. Pressing it sends that member **an emoji and a
short ready-made line** — "👋 We miss you at Iron House." No typing, no box to
fill in, exactly like the cheer. **One per member per week** — a different limit
from the cheer's one-per-day, and deliberately so: this one is a "come back",
and a weekly "come back" is a nudge while a daily one is nagging.

The member sees it on their **My Gyms** screen, on the card for that gym — the
same place the cheer already lands.

**Four honest limits, said now rather than found later:**

1. **The person who stopped coming is the person least likely to open the app.**
   The message is stored and waits on a screen; nothing in this product can push
   a notification yet. So this feature does its best work at stage 6 when the
   phone app can actually tap somebody on the shoulder. **It is still worth
   building now** — the LIST is the half that works today: it tells an owner who
   to ring, which is what a gym actually does about a member going quiet.
2. ~~**The list will be EMPTY at every gym for about six more weeks**~~
   **— WRONG, AND CORRECTED 2026-09-07 BEFORE ANYTHING WAS BUILT (`:36694` §1).
   The first name can appear within DAYS of this shipping.** The claim confused
   *how far the window reaches back* with *how much history it needs to contain
   something* — a window reaching back a month is satisfied by ONE visit somewhere
   inside it, and visits have been recorded since **2026-09-02**. Under Kd's
   three-day silence rule (`:36816`), somebody who came on 2 September and has
   not returned already qualifies.
   **What the limit really is, and it survives the correction:** while a gym has
   less than about five weeks of recorded visits, an empty list still cannot be
   read as *"nobody is slipping"* — anybody who drifted away BEFORE we started
   recording is invisible to us. So the screen says **"still collecting"** with
   the date recording began, and only says *"Nobody's slipping — nice."* once
   there is enough history behind it to mean anything.
3. **The member is never told they were flagged.** They see a warm line; they
   never see a list called "slipping away". The words on screen are the gym's,
   and they are yours to change (S2.6).
4. **Only visits to that gym count.** Somebody training every day at home, and
   never at the gym, is on this list — and that is correct, because the gym is
   never shown what a member did away from it (`:26469`).

---

## S2.2 · THE RULINGS THIS IMPLEMENTS, so the build cannot drift from them

| Ruling | What it binds here |
|---|---|
| `:36503` | **Kd chose this panel**, on the argument that the cheer already built the engine. §3 of that entry names the three things this card must not assume — all three are S2.5 risks below. |
| ~~`:36694` ruling 1 — SEVEN DAYS~~ | **SUPERSEDED THE SAME DAY by `:36816`.** |
| **`:36816`** | **THE QUIET WINDOW IS THREE DAYS** — *"if a user does not come to gym for say 3 continous day then gym can send not 7"*. **It does NOT move the "joined > 14 days ago" clause, the nudge's `1/member/7d` CAP, or the message expiry** — see the three-sevens table in `S2.4a.2`. |
| **`:36816`** | **THE MESSAGE EXPIRY IS APPROVED** — *"yes i agree"*. A message stops drawing after seven days, which FIXES slice 1's cheer drawing for ever (`S2.4b.8`). |
| **`:36816`** | **THE BUILD IS AUTHORISED** — *"now start building"*, the `:26777` gate PASSED. Server half first, per this card's own split. |
| **`:36694` §2** | **NOTHING PILES UP ON THE MEMBER'S CARD: exactly ONE message draws, the newest, and a nudge and a cheer never stack.** Kd ASKED this; the answer was measured in the shipped code, and this card turns it from an accident of how slice 1 happened to work into a written build rule (S2.4b.7). **Not a ruling — a fact plus a call.** |
| `:26469` §1.3 | **"At risk" is measured in VISITS, never in workouts.** The gym is never shown what a member did away from it. |
| `:29961` ruling 3 | Numbers first, people lists second. This is the second slice of the lists half. |
| `:29961` §4 | **In this product "send" means "write something a screen will show."** No mailer, no SMTP, no push. S2.1 limit 1. |
| **`:35762` §1** | **The nudge's cap is Part 3 §4.1's `1/member/7d` and is NOT the cheer's gym-day cap** — that line *"describes the AT-RISK NUDGE, a different feature"* and is **"not loosened by"** the cheer's. The two numbers agreeing until 2026-09-05 was a coincidence. |
| `:27992` §3 | The owner's screen **must not pile up**: counts come from the SERVER, the list is a preview, never infinite. |
| `:27992` §2 | **No dues, arrears or payment concept.** "Slipping away" asks one question — has this live member stopped coming — and never whether they have paid. |
| `:23711` | The nudge is a write door, so `requireWritablePrivilege` refuses a lapsed gym and an archived gym through gates that already exist. No new refusal vocabulary. |
| `:18128`, `:29961` ruling 4 | **No free text ever, only one-tap lines.** Third time Kd has chosen that shape. |
| `:28822`, `:33091` | The member's gym surface is **My Gyms**. Not the dashboard. |
| `:8267` / `:8343` / `:30867` | An empty list is not the same sentence as "nobody is slipping", and a screen without enough history says *"still collecting"* rather than drawing a conclusion. |
| `:35240` | The smoke's visit history **may be written straight into the database** — Kd's own ruling, and `tools/seed-on-a-roll-visits.ts` is the precedent. |

**THE SPEC ALREADY SPECIFIES THIS SCREEN, WHICH IS WHY ALMOST NO NUMBER HERE IS
A CHAT'S.** `03-part3-org-console.md:278-281` gives the row, the button, the
copy, the cap and the empty state; `:195-197` gives the definition; `:207` gives
the endpoint shape `POST /members/:uid/nudge`; `:98`'s matrix grants *Send "we
miss you" nudge* to **all three roles**; `:123` renames the list *"Inactive
clients"* for a clinic. **What is NOT the spec's is the substitution of VISITS
for WORKOUTS, and that is `:26469` §1.3 — a Kd ruling, not a chat's edit.**

---

## S2.3 · SCOPE

### S2.3.1 What this slice builds

| # | Thing | Where |
|---|---|---|
| 1 | Migration `0022_gym_nudges` | `apps/api/drizzle` (+ its `_journal.json` entry, in the same commit) |
| 2 | The "slipping away" query, off `gym_attendance` at this gym only | `modules/orgs/repo.ts` |
| 3 | `slippingAway` on the existing `GET /v1/orgs/:gymId/overview` payload | `modules/orgs/{service,repo}.ts` |
| 4 | `POST /v1/orgs/:gymId/members/:userId/nudge` — the **seventeenth** write door | `modules/orgs/{routes,service,repo,schemas}.ts` |
| 5 | `latestNudge` on each gym row of `GET /v1/orgs/mine` | `modules/orgs/repo.ts` |
| 6 | The contracts, once | `packages/shared/src/orgs.ts` |
| 7 | A "Slipping away" panel with its nudge button | `components/console/SlippingAwayPanel.jsx` + `pages/console/slippingAwayView.js` |
| 8 | The nudge on the member's My Gyms gym card | `pages/MyGyms.jsx` + `gymMembershipView.js` |
| 9 | Smoke sheet + its fixture tool | `RUNBOOK/smoke-slipping-away.md` + `apps/api/tools/seed-slipping-away-visits.ts` |

### S2.3.2 What this slice does NOT build, each with its home

- **When they come · this week's roster · the activation checklist** — slices
  3–5 of this file. `OWED.md`'s people-lists line, amended not ticked.
- **Any push, email or notification.** S2.1 limit 1. No new `OWED.md` line — the
  "no email is ever sent" line already carries it (`:19016` §3.2).
- **The fifth-cheer-preset fix.** `OWED.md` carries it; this card does not touch
  `gym_cheers`, `GYM_CHEER_PRESETS` or `gymCheerSchema` (R1.1). S2.4a.1 is why
  that matters more than it looks.
- **A read-state** ("seen"/"unseen"). Same call as slice 1: recency, no second
  table.
- **A tenth privilege.** S2.6.2 — a call, with its cost, reversible in one line.
- **The member's email on this payload.** `:31098` ruled email visible to the
  gym, and the Members roster already draws it; a second copy on a second
  payload is R1.1's drive-by and `:31098` is *"a ruling about EMAIL and not a
  licence"*.
- **Clinic vocabulary** (*"Inactive clients"*, §2.3). The vocabulary system is
  unbuilt across the whole console; this panel does not start it alone.

---

## S2.4 · THE BUILD PLAN

### S2.4a · SERVER HALF (one chat)

#### S2.4a.1 Migration `0022_gym_nudges` — T5: Kd reviews this SQL BEFORE anything else is written

**THE CALL THAT SHAPES THE WHOLE CARD: A SEPARATE TABLE, NOT A FIFTH PRESET ON
`gym_cheers`.** `:36503` §2 and §2 above both say the two features are *"one
mechanism … same store, same cap"* — **and the "same cap" half of that sentence
was already struck by `:35762`.** The "same store" half was written under the
same dead premise, so it is re-examined here rather than inherited (`:7298`'s
class: a sentence that outlives the condition that raised it). **What survives is
the part that was always true — same SHAPE: store-and-show, one tap, a preset
CHECK, a cap under `lockOrgRow`, an audit row.**

**MEASURED THIS SESSION, AND IT IS THREE BREAKAGES AND NOT AN OPINION.** Every
one of the three readers of `gym_cheers` filters on `gym_id` and `user_id` and
**nothing else** — `repo.ts:513-519` (the `latestCheer` lateral), `:4907-4911`
(`cheerable_at`), `:5019-5026` (the cap's own check). So a nudge row stored in
that table would:

1. **block that day's cheer**, because the cap check counts rows and not kinds;
2. **draw the cheer button dead**, because `cheerableAt` is set by any row;
3. **arrive on the member's My Gyms card AS THE LATEST CHEER**, through a preset
   code the bundle may not know — and `orgsApi.js` treats a contract mismatch as
   a **HARD failure**, so the member's whole gym list would draw nothing. That is
   `OWED.md`'s open *"a fifth cheer preset would blank every member's gym list"*
   line, walked into deliberately.

Adding a `kind` column instead would mean teaching all three of those readers a
filter, where forgetting one is silent. **Cost of the separate table, stated:
one more table and one more field on `/v1/orgs/mine`.** Reversible in one line
if Kd prefers the shared store, at the price of that filter in three places.

Hand-written, like `0017`–`0021`. **`drizzle-kit generate` cannot be used in
this repo** (`OWED.md`'s snapshot-debt line), and a hand-written migration needs
a hand-written `drizzle/meta/_journal.json` entry — **without one,
`drizzle-kit migrate` prints "migrations applied successfully" and applies
NOTHING** (`:28221` §6). After applying, the objects are read back out of
`pg_catalog` (`:20222`), never trusted from drizzle's green line.

```sql
CREATE TABLE gym_nudges (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id            uuid NOT NULL REFERENCES gyms(id) ON DELETE RESTRICT,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sent_by_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  preset            text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_nudges_preset_check CHECK (preset IN (
    'miss_you', 'door_open', 'start_again', 'checking_in'
  ))
);

CREATE INDEX gym_nudges_gym_user_created_idx
  ON gym_nudges (gym_id, user_id, created_at DESC);
CREATE INDEX gym_nudges_user_created_idx
  ON gym_nudges (user_id, created_at DESC);
```

**`preset` is an enum in a CHECK, not free text** — `:29961` ruling 4 and
`:18128` living in the database rather than in a comment (`:27992` §1's shape).
**The column stores the KEY and never the sentence**: the words live in the web
bundle, so changing the copy is a deploy and not a data migration, and a stored
English string would freeze the wording of every nudge ever sent.

**AND NO PRESET MAY EVER CONTAIN A NUMBER OR A DATE** — "3 weeks away!" is true
the minute it is sent and false the week after (`:7298`).

**`ON DELETE RESTRICT` per R4.3**, and `privacy/tables.ts` gains this table **in
the same commit** — it is user-linked (`:34443`'s trigger, and `:28452`'s).

**NO UNIQUE ENFORCES THE CAP, AND HERE THAT IS FORCED RATHER THAN CHOSEN.** The
nudge's cap is Part 3 §4.1's **`rate-limit 1/member/7d`**, which is a ROLLING
seven days, and **no UNIQUE or CHECK in Postgres can express a rolling window** —
which is exactly the reasoning migration `0021` wrote and which `:35762` then
made obsolete *for the cheer only*, by turning that cap into a calendar day. **So
the reasoning `0021` carries is dead there and alive here, and a chat must not
copy `0021`'s current comment across.** The rule is a check inside the
transaction under `lockOrgRow(gymId)`, and its guard is a test plus a mutant,
never a comment.

#### S2.4a.2 The "slipping away" query — `repo.getGymSlippingAway(sql, gymId, limit)`

**THE DEFINITION IS THE SPEC'S, WITH TWO SUBSTITUTIONS — AND BOTH ARE KD'S OWN
RULINGS RATHER THAN THIS CARD'S.**
`03-part3-org-console.md:195-197` reads: *"current member · joined > 14 days ago
· had ≥ 1 workout in their first 21 days or in the prior 30-day window · **0
workouts in the last 14 days**. Sorted by lifetime workouts desc (save the most
invested first), capped at 20."* **Every `workout` becomes a `visit at this
gym`** (`:26469` §1.3), and every window is counted in **gym-days**
(`gyms.timezone`), the unit `gym_attendance.day`, the Overview chart and the
regulars query already share.

**AND THE QUIET WINDOW IS ~~FOURTEEN~~ ~~SEVEN~~ THREE DAYS — KD RULED IT TWICE
ON 2026-09-07, EACH TIME AGAINST THIS CARD'S STANDING NUMBER**: first *"i think
if a user does not come for 1 week gyms can send the messages"* (`:36694` ruling
1, seven), then *"if a user does not come to gym for say 3 continous day then gym
can send not 7"* (`:36816`, three — *"a little change of plan"*).
**`SLIPPING_AWAY_QUIET_DAYS = 3`.**

⚠️ **THERE ARE THREE SEVENS IN THIS FEATURE AND ONLY ONE OF THEM MOVED. THIS IS
THE `:35762` TRAP EXACTLY, ARRIVING FOR THE SECOND TIME ON THE SAME CARD.**

| The number | What it governs | Where it comes from | Moved? |
|---|---|---|---|
| ~~7~~ → **3 days** | **the QUIET WINDOW** — how long silence lasts before a member is listed | **Kd, `:36816`** | **YES** |
| **7 days, rolling** | **the NUDGE'S CAP** — how often a gym may message one member | Part 3 §4.1 `rate-limit 1/member/7d` | **NO** |
| **7 days** | **the MESSAGE EXPIRY** — how long a message stays on the member's card | derived from the CAP (`S2.4b.8`), approved `:36816` | **NO** |

**The expiry survives the ruling because it was never tied to the quiet window —
it is tied to the CAP**, being the longest a message can still be the latest
thing a gym has said. **A chat that "tidies" these three into one constant
reverses a Kd ruling and breaks a spec limit in one edit.**

So a row is listed when all four hold:

- a **live, non-complimentary** member of this gym — the same population
  `getGymRegulars` and `month.visitors` use, so no panel on this screen can name
  somebody the others do not;
- **joined more than 14 gym-days ago** (`gym_members.joined_at`, bucketed in the
  gym's zone). **This 14 is NOT the one Kd moved and stays the spec's** — it does
  a different job (do not judge anybody inside their first fortnight) and he
  ruled the SILENCE window, not the membership one. **A chat that changes both
  because they used to be the same number is inventing a ruling** (R0.2), which
  is `:35762`'s recorded shape one feature over;
- **at least one visit at this gym** either in their first 21 days of membership
  **or** in the 30 gym-days before the quiet window — the "was engaged" arm,
  which is what keeps somebody who joined and never once turned up off a list
  headed *"slipping away"*;
- **zero visits at this gym in the last 3 gym-days** (`:36816`).

**THE COST OF THREE, MEASURED AGAINST REAL TRAINING PATTERNS AND WRITTEN DOWN
BECAUSE KD WAS NOT SHOWN IT BEFORE HE RULED:** a member who trains **twice a
week** — Tuesday and Saturday, say — has a three-day gap (Wed·Thu·Fri) every
single week, **so a perfectly normal member lands on a list headed "slipping
away" permanently.** A three-times-a-week member (Mon·Wed·Fri) never does. **What
bounds it:** nothing sends itself, the list is a prompt to an owner, and the
nudge's own cap is one message a week. **It is ONE CONSTANT to change** and the
tests are written as a PAIR around it, so moving it is one line and two fixture
numbers. **Raised to him in one line at the build, not made a second gate** — he
ruled twice on this number already and re-asking is the protocol failure `:16702`
and `:19256` both paid for.

Ordered by **lifetime visits at this gym desc** (the spec's *"save the most
invested first"*), then `last_visit_day` desc, then display name, then user id —
four keys because the first three can tie and an unstable order makes a list
that reshuffles on every reload. Capped at **`SLIPPING_AWAY_LIMIT = 20`** (the
spec's own number, `:280`), previewed at **5** on screen (`:278`'s *"top 5"*).

Each row carries: `userId` · `displayName` · `lastVisitDay` (a gym-date string,
**never a rendered phrase** — see S2.4b.3) · `visits` (lifetime, at this gym) ·
`nudgeableAt` (the instant this gym may nudge them again, or `null`).

**FOUR THINGS THIS QUERY MUST NOT DO, and each of them is the obvious shortcut:**

- **It must never read `org_member_stats`.** That view counts workouts ANYWHERE,
  has sat unread since `0001_init`, and `:29961` §6.1 names it as the trap for
  exactly these panels. It is `:26469` §1.3's one forbidden thing with a
  convenient name.
- **It must never import from `gamification/`.** `getStreakDays` and
  `getActivityDays` union workouts across every gym, and `replayActivityDays`
  spends Part 7 §3.2 **freezes** — wrong twice over, in two directions, exactly
  as slice 1 recorded (§5 risk 1).
- **It must not count workouts at all**, including `workouts` rows stamped with
  this gym. `:26469` ruling 3 rejected showing both counts.
- **`nudgeableAt` is the SERVER's answer**, on `now() - interval '7 days'`, and a
  screen never computes it. Two consoles open at one desk must agree.

**THE COMMENT THAT TRAVELS WITH IT:** `lastVisitDay` is *the last visit at THIS
gym*, and a member's own app may legitimately show more recent training
elsewhere. The two figures are answers to different questions, and the
divergence is written where the query is, not only here (`:27900` §4's shape,
which slice 1 used for the same class).

#### S2.4a.3 `slippingAway` on the existing overview payload — NOT a sixth read

`Overview.jsx` issues **five** reads in one `Promise.allSettled` (measured
this session: `getCodes`, `getMembers`, `getApplications`, `getOverview`,
`getAttendanceDay` — `Overview.jsx:164-176`). `:30399`'s trigger warns before
adding a fourth; a sixth is not added. `slippingAway` rides on
`GET /v1/orgs/:gymId/overview`, which is already gated on `attendance.read` and
is already the attendance-derived payload — the same argument `onARoll` made and
the same one the service file already carries in prose.

**`orgOverviewSchema` is `.strict()`, so this is a shared-contract change and
takes `.default([])`** — `:31222` is the recorded cost of a required field on a
response `orgsApi.js` treats as a hard failure.

**Part 3 §3.2 says the at-risk query is *"computed on page load, cached 1 h"*.
No cache is built** — a chat's call, stated: `org_live_counters` is already
unbuilt for the same reason on the tiles beside it (`OWED.md`), the query is one
indexed pass over `gym_attendance`, and **a cache is a performance answer to a
load nobody has measured** while a stale list is a number that is wrong on screen
(`:5807`). Revisit when a real gym's load exists.

#### S2.4a.4 `POST /v1/orgs/:gymId/members/:userId/nudge` — the seventeenth write door

Measured this session, not recalled: `orgs.routes.test.ts:6153` pins
`CONSOLE_WRITE_COUNT = 16`. **That constant is raised to 17 WITH its list entry
in the same edit, never ahead of it** (`:26812` §3).

Inside one transaction, in this order:

1. `requireWritablePrivilege(deps, gymId, userId, "members.read")` — privilege
   first, so a stranger keeps the 404 and a staffer without the tick keeps the
   403; only a caller who would otherwise be allowed reaches the 409
   `gym_not_on_plan` (`:23711` §2).
2. `lockOrgRow(gymId)`.
3. **The recipient is a LIVE, non-complimentary member of THIS gym** — the one
   condition, exactly as the cheer asks it (`:27992` §2: no dues check, ever).
   Otherwise 404, never a sentence distinguishing "no such person" from "not your
   member" (R3.2).
4. **The rolling-seven-day check, under the lock**: a `gym_nudges` row for this
   gym and member with `created_at > now() - interval '7 days'` → typed **409
   `nudge_already_sent`**. **The error carries a status, a code and a sentence
   and nothing else** — `OrgsError` is shared across this whole module and
   widening it for one path is R1.1's drive-by, the shape T3 round 1 already struck
   off the cheer (`:34443` L-3). **The instant reaches the screen on
   `nudgeableAt` in the overview payload**, which a stale page needs re-read
   anyway.
5. **Insert, and write `org.member_nudged` to `audit_log`** — Part 3 §3.3's
   *"every mutating call writes `audit_log`"*. **Do not cite `:28221` §7 as an
   exemption**: that exempts a MEMBER tapping "I'm here" hundreds of times a day,
   and reading it the other way was a Critical/High on slice 1 (`:34443` C/H-3).
   A nudge is a console action behind a privilege, capped at one per member per
   week, and the log is the only record of WHICH staffer sent it — the member is
   deliberately never told (§2.4).

**Rate limit:** its own `createDualRateLimit` bucket, per-account and per-IP. It
must NOT share the attendance bucket (600/hour), which `:28649` L-5 sized for a
whole gym tapping in at once.

**NAMING, AND IT IS A REAL COLLISION RATHER THAN A STYLE NOTE.** This module
already has a "nudge": `nudgeApplication` / `gym_join_applications.member_nudged_at`,
where an **applicant** nudges a **gym** about a pending request (`repo.ts:1113`,
`:1974`, and `packages/shared/src/orgs.ts:1261`). **The two point in opposite
directions and share one word.** Every new symbol in this card is therefore
`…GymNudge` / `gym_nudges` / `org.member_nudged`, and none of them is named
`nudge` alone. A test that greps for "nudge" will match both features; a test
that asserts one must name it.

#### S2.4a.5 `latestNudge` on `GET /v1/orgs/mine`

One field on the gym row: `{ preset, sentAt }` or null, read off a lateral on the
existing query — **not a second round trip and not a second endpoint**, exactly
as `latestCheer` is.

**`.default(null)` in the shared contract, and this is the fourth time the
reason is written down**: `orgsApi.js` treats a contract mismatch as a HARD
failure, so a required field destroys the whole gym card during any
web-newer-than-api window (`:12660`, then `:31222`, which added one four hours
after citing `:12660`, then slice 1).

**AND ITS `preset` IS NOT A `z.enum`, WHICH IS THIS CARD DECLINING TO INHERIT AN
OPEN DEFECT.** `gymCheerSchema.preset` is an enum, and `OWED.md` carries the
consequence: an api that adds a fifth preset blanks the member's whole My Gyms
screen and the console's gym list. **This contract ships loose from day one** —
the field parses as a string, and the client renders only codes it has words for
and draws nothing for one it does not, which is what `cheerLine` already does
correctly. That is `:16101`'s standing rule applied at birth: **a response bound
is loosened toward what a NEWER server might say, never tightened to today's
behaviour.** **The cheer's own line is NOT fixed here** (R1.1) and keeps its
`OWED.md` entry.

**A plain member is told nothing about staff** (§2.4) — the field carries the
preset and the time, never who pressed the button.

#### S2.4a.6 Server tests (named before the code — Part I §7a)

- **Each of the four definition clauses, in BOTH directions**, because a guard
  whose only tested failure is "it did not fire" is satisfied by a door that is
  simply shut (`:7104`'s PG1):
  - a member quiet 4 gym-days IS listed; quiet 2 is NOT (`:36816`'s three, and
    **the pair is what proves the constant is read at all** — a single-sided
    test passes on a door that is simply shut). **Both fixtures are written in
    terms of `SLIPPING_AWAY_QUIET_DAYS ± 1` and never as literal 4 and 2**, so
    the next time Kd moves this number the tests move with it — he has moved it
    twice in one day;
  - a member who joined 10 days ago is NOT listed, however quiet;
  - a member who has **never** visited is NOT listed (the "was engaged" arm) —
    and a member whose only visits were in their first 21 days IS;
  - a member who visited **yesterday** is NOT listed.
- **The boundary fixture must not be all-current-week** (`:30243`'s trigger) and
  must not be all-UTC: at least one gym in a non-UTC zone, because every window
  here is a gym-day (`:26812`'s trigger).
- **The ordering**, on a fixture where "most lifetime visits" and "quiet
  longest" give DIFFERENT orders — one where they agree cannot see the sort key
  being read from the wrong column.
- **Cross-tenant**: gym B's owner nudging gym A's member is 404 — **and** a
  scoping case, because a 404 test and a scoping test are different tests
  (`:28221` §3a). **Two gyms and two memberships in every fixture**, or a missing
  `gym_id` predicate leaks nothing and the mutant cannot die (`:28221` §3b).
- **Gym B's visits must not rescue a member from gym A's list**, which is the
  tenancy failure in its most plausible direction.
- **The query reads no workouts**: a member with daily `workouts` rows and no
  visits still appears. This is the test that stops a later chat
  "simplifying" the query onto `org_member_stats`.
- **The rolling cap, in a PAIR** — the write door's refusal AND the reader's
  `nudgeableAt` — because a rule enforced in one place and reported from another
  takes mutants in pairs (`:35944` §3, the C/H that slice 1 shipped without).
  A second nudge at 6 days is 409; at 7 days + 1 minute it is 201. The suite
  MOVES the stored row rather than waiting.
- **The cheer and the nudge do not interfere**: a nudge sent today leaves the
  same member cheerable today, and vice versa. This is S2.4a.1's whole argument,
  asserted rather than reasoned.
- **A lapsed gym is refused; an archived gym is refused; a live gym is not** —
  the third arm is what stops the gate being a door that is simply shut.
- **Write-door count**: `CONSOLE_WRITE_COUNT` 16 → 17, list and count moved
  together.
- **The DDL CHECK guard**: `db.migration.test.ts` reads `gym_nudges_preset_check`
  back out of `pg_get_constraintdef` and asserts it equals the shared preset
  list — the shape `:28107` uses for `ORG_PRIVILEGES`.
- **`privacy/tables.ts` covers `gym_nudges`**, asserted by the existing guard.

#### S2.4a.7 Mutants

Numbered from the **true maximum id in use**, computed rather than taken from the
file's last row (`:30094`'s duplicate-id trap). **Measured this session:
`mutate-orgs.mjs` max is `O283`; `mutate-console.mjs` max is `C230`.**

Every row sits in `:5857` rule 4a's always-mutated columns — ownership, numbers a
user sees, anything that writes. Database mutants are in scope because this card
changes server behaviour, and the sweep points at the LOCAL Postgres
(`:13659`). Wording and layout are deliberately not mutated.

Aimed at: the gym predicate in the slipping-away query · the gym predicate in
the cap check · **the cap's reader (`nudgeableAt`) as a sibling of the cap's
guard** · the quiet-window comparison direction · the joined-more-than-14-days
clause · the "was engaged" arm · the live/non-complimentary condition · the
privilege-then-lock order · the `.default([])` · `latestNudge`'s user predicate ·
the ordering's first key.

### S2.4b · WEB HALF (a separate chat, after S2.4a's T3)

1. **`slippingAwayView.js`** — pure, tested without a browser: which state the
   panel is in, the preview cut, the "last came" sentence, whether the button is
   live. `SlippingAwayPanel.jsx` is markup. This is the split
   `overviewView.js` / `onARollView.js` already use on this screen.
2. **THE BUTTON'S FOUR STATES, which slice 1 had to discover mid-build**
   (`:34809` §3): live · **"Nudged — you can again in N days"** when the server
   has said when · greyed with a true sentence on a read-only (lapsed) gym
   (`:24141` — every dead button is greyed with a sentence saying why) · **and
   greyed for a role that can SEE the list but not nudge**, because the overview
   read is gated on `attendance.read` while the write is gated on `members.read`,
   so a staffer can legitimately see this panel and be refused every button on
   it (`:12518` C/H-2's class).
3. **`lastVisitDay` IS RENDERED, NEVER STORED AS A PHRASE, AND THE PHRASE IS THE
   TRAP.** *"Last came 3 weeks ago"* is computed at draw time from the gym's own
   date, and **a sentence containing "today" or "yesterday" is `:13432`'s
   recorded Critical/High** — it printed the wrong word for anybody whose clock
   was not the server's. On this panel the shortest true phrase is *"2 weeks
   ago"*; nothing here may say "today".
4. **Empty states, told apart** (`:8267`/`:8343`), and the first is the one the
   screen will actually be in at first:
   - **not enough history** — this gym has fewer than
     `SLIPPING_AWAY_QUIET_DAYS + 30` gym-days of recorded visits, so an empty
     list cannot mean what it appears to: *"Still collecting — we've only been
     recording visits here since {date}."* **The reason is NOT that the query
     cannot return a row** — it can, about a week in (`:36694` §1 corrects this
     card's own first draft) — **it is that anybody who drifted away BEFORE
     recording began is invisible to us**, so "nobody is slipping" would be a
     claim about a period we have no data for. `:30867`'s ruling in its own
     shape (a chart is not drawn until there is a week to compare against);
   - **enough history, nobody quiet** — the spec's *"Nobody's slipping — nice."*;
   - **the gym has no members** — draws nothing at all;
   - **the read failed** — a retry chip, never an empty list.
   **The first two must not share a sentence** (`:5807`). **And the boundary
   between them is the server's, sent as a field** — the screen must not derive
   "has this gym enough history" from the rows it was handed, which is
   `:27992` §3 in its own shape: a client reasoning about what it did not
   receive.
5. **The confirm step, exactly as the cheer has it** (`:35422`): the button opens
   a small panel holding the words and a **Send**; the nudge goes only when Send
   is pressed. **This is not optional polish** — Kd ruled it for the cheer after
   seeing an irreversible one-tap control on screen, and the same shape here
   means one component's behaviour rather than two.
6. **The presets carry NO NUMBERS and NO DATES** (S2.4a.1). The "last came"
   figure is drawn live beside the name, never baked into the message.
7. **Member side — and this is the answer to Kd's own question, written as a
   build rule rather than left as an accident** (`:36694` §2). *"suppose gym send
   a message and if next day another message is send what will happen to the
   previous messages will messages piled up and cover the whole screen?"*
   **EXACTLY ONE MESSAGE EVER DRAWS ON A GYM'S CARD: the newest.**
   - **Nothing piles up today and nothing may start to.** Measured in the
     shipped code: the server sends ONE cheer per gym row — the lateral is
     `ORDER BY c.created_at DESC LIMIT 1` (`repo.ts:513-519`) — the contract
     holds a single nullable object (`latestCheer`), and `cheerNote` renders one
     line. **Tomorrow's message REPLACES today's on screen.**
   - **The old ones are not lost, they are just not a feed.** Every row stays in
     the table, and `audit_log` records who sent each — so the history exists for
     an operator and for the gym's own record, and no screen turns it into a
     scroll a member has to clear.
   - **A cheer and a nudge never stack**: one field is read per gym card, the
     newer of the two, so slice 2 cannot turn one line into two. **This is the
     rule a later chat is most likely to break**, by adding `latestNudge` beside
     `latestCheer` on screen instead of choosing between them.
8. **A MESSAGE STOPS DRAWING AFTER SEVEN DAYS — ~~a call for Kd~~ APPROVED BY KD
   2026-09-07 (`:36816`, *"yes i agree"*), and it FIXES something slice 1
   shipped.** **The seven here is the CAP's seven and NOT the quiet window's**,
   which he moved to three in the same message — see the three-sevens table in
   `S2.4a.2`. Today `cheerNote` draws the newest cheer
   **for ever**, ageing (`cheerAge` counts up with no ceiling, `:188-198`), so a
   gym that cheered once in January still shows that line in July saying *"212
   days ago"*. That is TRUE, so it is not `:5807` and it did not block slice 1 —
   it is simply an old compliment nobody cleared. **Seven days because it is the
   longest gap a gym can leave between two messages** (the nudge's cap), so a
   message is on screen exactly as long as it could still be the latest thing
   that gym said. **Cost:** a member who opens the app fortnightly may never see
   a message that was sent for them. **Reverse it** by changing one constant, or
   drop it and the line stays for ever as it does now.
9. **The recency dot on the My Gyms nav item already exists** (slice 1,
   `:34809`) — a rolling 24 hours, mirroring the cheer's cap. It gains the nudge
   as a second source and **does not gain a second dot**. **Its window is NOT
   re-opened here**: the nudge's cap is a week and the cheer's is a day, and a
   dot that lit for a week would be lit almost permanently at a gym using both.
10. **Smoke sheet**: `RUNBOOK/smoke-slipping-away.md`, with
   `apps/api/tools/seed-slipping-away-visits.ts` writing the history the
   definition needs — **Kd has already ruled that this is allowed** (`:35240`),
   and `seed-on-a-roll-visits.ts` is the pattern: insert only,
   `ON CONFLICT DO NOTHING`, every value one the app itself could have written
   so `gym_attendance_slot_key_agrees_check` holds. **The sheet states in its
   setup section that the list cannot be populated by clicking**, rather than
   carrying a step that cannot pass (`:29870`, `:26012`).

---

## S2.5 · RISKS AND TRAPS, named before the build rather than found after

1. **`org_member_stats` counts workouts ANYWHERE** and has sat unread since
   `0001_init`. `:29961` §6.1 and `:36503` §3(b) both name it as the trap for
   exactly this screen — it is the one forbidden thing (`:26469` §1.3) wearing
   the most convenient name in the schema.
2. **THE CHEER'S CAP IS NOT THIS CAP.** One per member per **gym-day** (calendar,
   `:35762`) against one per member per **7 days** (rolling, Part 3 §4.1). **They
   differ in NUMBER and in SHAPE**, and a chat "unifying" them breaks both.
   `:35762`'s own trigger — *"reading a rolling window in this repo as a calendar
   one"* — is this defect in the other direction, and it cost a Critical/High.
3. **Migration `0021`'s comment about why a UNIQUE cannot express the cap is DEAD
   THERE AND ALIVE HERE.** Copying its current text across imports a paragraph
   explaining why the *cheer's* calendar day is not a constraint. Read
   `sendGymCheer`'s docblock, not the migration's.
4. **A screen that counts what it downloaded is right on six rows and wrong on
   four hundred** (`:27992` §3, `:29250`). This payload carries no total by
   design; the preview cut is a client concern and must never be presented as a
   count.
5. **A one-gym, one-membership fixture cannot see a missing tenancy predicate**
   (`:28221` §3b), and a fixture whose visits all land in the current week cannot
   see the window boundary (`:30243`).
6. **A test asserting the nudge button ARRIVES enabled passes under a button
   that can never be pressed.** `:31295` is that defect shipped twice, and
   `:35511` is the confirm step's own version of it — the guard that let **Send**
   be pressed at all was held by nothing while twenty-five tests stayed green.
   **For a two-state control, assert the state it is NOT in when you find it.**
7. **"Slipping away" and "On a roll" can list the same person only if one of
   them is wrong.** Their populations are disjoint by construction (a live
   two-week streak against fourteen quiet days), so a fixture proving that is
   cheap and a screen showing it is a defect anybody can see (`:5807`).
8. **The word "nudge" already means something else in this module** (S2.4a.4).
9. **A nudge is a write from a console that may be read-only.** Without
   `requireWritablePrivilege` a lapsed gym keeps nudging — the screen-deep rule
   wearing a server's clothes that `:23711` §1 refused.

---

## S2.6 · WHAT GOES TO KD AT THIS GATE

### S2.6.1 THE ONE QUESTION — the four lines the nudge sends

**These are words a gym sends a member, so they are his** — the same reason
slice 1's four cheer lines went to him rather than being a chat's call (§6.2.3,
approved 2026-09-05). Recommended, no numbers and no dates in any of them:

| Code | Line |
|---|---|
| `miss_you` | 👋 *We miss you — hope to see you soon.* |
| `door_open` | 🚪 *The door's always open when you're ready.* |
| `start_again` | 🌱 *Starting again is easier than you think.* |
| `checking_in` | 💬 *Just checking in — how's it going?* |

The spec's own suggestion is *"Your gym misses you 💪— {org}"*
(`03-part3-org-console.md:280`), which the first line follows without the
duplicated gym name (the card it lands on already says which gym it is).

### S2.6.2 CALLS MADE FOR HIM, each with its cost, each reversible in one line

Written down because this card's own history says so twice: flagging a chat's
call at the gate produced a Kd ruling in one line — **once reversing it
(`:27992` §1) and once ratifying it (`:28055` §1)**.

1. **A separate `gym_nudges` table, not a fifth preset on `gym_cheers`.**
   **Cost:** one more table, one more field on `/v1/orgs/mine`. **Reverse it**
   and every one of the three `gym_cheers` readers learns a `kind` filter, where
   forgetting one silently blocks a cheer. S2.4a.1 has the measurements.
2. ~~**The quiet window is the spec's 14 days, counted in visits.**~~
   ~~**— OVERRULED: SEVEN DAYS** (`:36694` ruling 1).~~ **— OVERRULED AGAIN THE
   SAME DAY: THREE DAYS** (`:36816`) — *"if a user does not come to gym for say 3
   continous day then gym can send not 7"*. **`SLIPPING_AWAY_QUIET_DAYS = 3`.**
   **BOTH STRIKES ARE KEPT BECAUSE THE PATTERN IS THE POINT: this card
   recommended a number, was overruled, re-recommended nothing, and was overruled
   again within hours — so the constant is treated as VOLATILE in the code and in
   the tests** (`S2.4a.2`, `S2.4a.6`: fixtures are written as
   `SLIPPING_AWAY_QUIET_DAYS ± 1`, never as literals). **The cost grew each time
   and he has not been shown the latest one before ruling** — at three days a
   TWICE-A-WEEK member is on the list permanently (`S2.4a.2` works the days out).
   **Raised in one line at the build; not a second gate** (`:16702`, `:19256` —
   re-asking a question he has answered twice is the protocol failure, not
   diligence).
3. **The nudge is gated on `members.read`, not a tenth privilege** — the same
   call slice 1 made for the cheer, and Part 3 §2.2 grants the nudge to exactly
   the three roles that hold it. **Cost:** an owner cannot stop one staffer
   nudging without also taking their roster away. **Reverse it** and it is a
   migration, not a list edit (`:28107`).
4. **No 1-hour cache** (S2.4a.3), against Part 3 §3.2's letter. **Cost:** one
   indexed query per console load. **Reverse it** when a real gym's load exists.
5. **The panel draws on the console Overview, beside "On a roll"** —
   `03-part3-org-console.md:278`'s own placement.
6. **Where a member has both a cheer and a nudge, the newer one draws, and only
   one line ever draws** (S2.4b.7) — Kd asked the question, this is the rule.
7. **A message stops drawing after seven days** (S2.4b.8). **This one changes
   slice 1's shipped behaviour**, where a cheer draws for ever, so it is the one
   call in this list that is not confined to new code. **Reverse it** and the
   line stays for ever as it does today.
8. **The "not enough history" boundary is a SERVER field**, not something the
   screen infers from an empty list (S2.4b.4).

### S2.6.3 SPEC GAP / DEVIATION

**Two knowing deviations, and BOTH are Kd's own rulings rather than this card's:**

1. the at-risk definition counts **visits at this gym** where
   `03-part3-org-console.md:195-197` counts **workouts anywhere** (`:26469`
   §1.3, R0.3);
2. ~~**the quiet window is SEVEN days where `:197` says fourteen**~~ **— THREE
   days** (`:36816`, superseding `:36694` ruling 1 the same day). **This card
   recommended the spec's number and was overruled TWICE** — which is why it is a
   deviation with a name on it rather than a drift.

Every other number on this screen — joined > 14 days, 21 days, 30 days, top 5,
capped at 20, `1/member/7d` — **is quoted from the spec, not chosen here** (V2).

**No SPEC GAP.**

---

## S2.7 · THE GATE

**PASSED 2026-09-07** (`:36816`) — *"yes i agree and do the things planned … now
start building"*.

**GIVEN:** the panel (`:36503`) · the four lines (`S2.6.1`) · **the quiet window
at THREE days**, his own ruling, twice against this card's number · **the
message expiry** (`S2.4b.8`), the one call outstanding when he answered · and
*"do the things planned"*, which covers the file list, the migration and the test
list as this document states them.

**WHAT THE APPROVAL DOES NOT STRETCH TO, because `:26777` is about exactly this:
it covers THIS DOCUMENT'S plan.** A build that departs from `S2.3.1`'s file list,
`S2.4a.1`'s SQL or `S2.4a.6`'s tests is not covered by it and goes back to him.
**The migration SQL is put in front of him before it is applied to any
database** — R4.4's "reviewed as SQL by Kd", the sequencing slice 1 followed for
`0021`.

**BUILD ORDER, and it is this card's own split rather than a chat's preference:**
**`S2.4a` the server half in one chat, then its T3, then `S2.4b` the web half in
a separate chat** (Part I §7b's ceiling: one migration per chat; §7c: the
reviewer must not be the author).

**Nothing is built. No `src` file, no migration, no test, no `packages/shared`
change exists for this slice**, and `:26777` is the recorded cost of treating a
feature-shape approval as a code gate.
