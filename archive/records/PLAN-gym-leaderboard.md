# PLAN — the gym leaderboard (replaces the two people-panels)

> ## ⚠️ SUPERSEDED 2026-09-07 BY `CARD-gym-leaderboard.md` — READ THAT FIRST
>
> This file is kept for its reasoning and its rejected-designs table, both of
> which still bind. **Two things in it are now WRONG and are struck in the card:**
>
> 1. **§4's SCORE FORMULA — its goal term is DEAD.** It reads *"every member sets
>    a weekly goal — how many days they intend to attend"*. **Kd ruled that is not
>    what a goal is** (DECISIONS `:37031` R15): a goal is burning a set number of
>    calories, eating healthily, doing exercises the app recommends, or ones the
>    member sets. **§4's three "numbers not yet ruled" are therefore void** —
>    they were the parameters of a narrowing, not open questions. **R16 adds that
>    BOTH a daily and a weekly goal are measured.**
> 2. **§11's three open items are all CLOSED.** The member board shows everyone
>    with an opt-out that GREYS the row rather than removing it, and the gym
>    always sees the full row (`:37031` R17/R18); the email line stands.
>
> **Everything else here survives**, including §3's acceptance test, §4's
> rejected-designs table, §5, §6, §7, §9's build notes and §10.

**STATUS: A PLAN, NOT AN APPROVED CARD. NO CODE EXISTS. The `:26777` gate is
UNPASSED** — Kd has approved the *shape* in conversation but has never seen a
file list, migration SQL, test list or risk list, and that is what the gate
inspects.

Written 2026-09-07 in a planning session with Kd (Opus 5, max effort). Kd's
stated intent: **he plans with this chat and builds with a separate Opus xhigh
chat.** This file is the handover between the two.

---

## 1 · WHY THIS EXISTS

`CARD-gym-overview-people.md` builds two separate console panels — *"On a roll"*
(shipped) and *"Slipping away"* (server half built, `:36907`, T3 unrun). A T3
review found the two panels can name **the same person at the same time**, which
is a `:5807` Critical/High: the owner's home screen says "keeps turning up" and
"has stopped coming" about one member.

Kd's answer was not to patch it. **He replaced the design**: one combined member
list, which makes the contradiction impossible by construction rather than
excluded by a predicate.

---

## 2 · KD'S RULINGS THIS SESSION — all new, none previously recorded

**These supersede parts of `CARD-gym-overview-people.md`. Quote them from here
until they are written into `DECISIONS.md`.**

| # | Ruling | His words |
|---|---|---|
| R1 | **"On a roll" needs 4 visits a week**, not the built "once a week, two weeks running" | *"make it 4 visits a week then on a roll"* |
| R2 | **A 3-day-a-week member belongs on NEITHER list** — she is fine, just not a star | chose *"No — neither list"* |
| R3 | **Combine the panels into ONE list** rather than building separate things repeatedly | *"we can combine everything to a single thing"* |
| R4 | **The list is a ranked leaderboard, for the gym AND for members** | *"no leaderboard will be there for gyms as well but they will have the filter option"* |
| R5 | **Members see it on their `My Gyms` screen** | *"this leaderboard will show on members my gym"* |
| R6 | **This is the GYM leaderboard only.** A separate GLOBAL leaderboard is a different feature with a different design | *"there is another leaderboard for global that will be completely different"* |
| R7 | **Messages have NO cap and NO cooldown.** A new message REPLACES the previous one; they never pile up | *"just dont need to keep any time contraint gym can send message anytime"* |
| R8 | **Only gyms send messages**; the library must grow | *"we need to increase message libary"* |
| R9 | **Exercises count only if done at the gym**, and the gym's opening hours are the mechanism | *"a user who logs their exercises during these times will be used for leaderboard"* |
| R10 | **The board must update instantly, never on a monthly reset** | *"i dont want the leadrboard to update after one month but should be update instantly"* |
| R11 | **Hitting a goal must count toward the score** | *"also achiving goal should also count"* |
| R12 | **7 day-circles per member row**, short day names, bright on days attended | his sketch |
| R13 | **Click a member → detail, filterable 1 week / 1 month / more** | his sketch |
| R14 | **An info symbol explains how the board is decided** | *"small info like symbol when click user can see how leaderboard is decided"* |

**R10 and R11 were given after rejecting a first design — read §4's rejected
column before proposing anything that looks like it.**

---

## 3 · THE THING KD IS AFRAID OF, IN HIS WORDS

> *"there can be professional and noob and if our leaderboard is not perfect it
> will be really bad and gyms will loose trust"*

**This is the design's acceptance test.** Any scheme where a strong member
permanently outranks a beginner — or where a once-a-week member scores like a
daily one — is REJECTED. Both failure directions have already been proposed and
killed in this session.

---

## 4 · THE SCORE — the rule the whole feature stands on

**Window: a ROLLING 30 DAYS, recomputed on every read.** Not a calendar month.
Kd rejected a monthly reset explicitly (R10): a board that zeroes on the 1st is
meaningless for the first week of every month.

Every member sets a **weekly goal** — how many days they intend to attend.

```
score  =  visits_30d
        + Σ (goal) for each of the last 4 whole weeks where visits_that_week >= goal
        + sessions_logged_on_attended_days_30d
```

**The bonus equals the goal, and that is the anti-gaming mechanism.** A member
who sets a 1-day goal earns a 1-point bonus; one who sets and hits a 4-day goal
earns 4. Lowballing pays almost nothing.

Worked, and these figures belong in the tests:

| Member | visits | goal bonus | sessions | **score** |
|---|---|---|---|---|
| daily, goal 6 | 30 | 4 × 6 = 24 | 30 | **84** |
| lifter, 4 days/wk, goal 4 | 17 | 4 × 4 = 16 | 17 | **50** |
| 3 days/wk, goal 2 | 13 | 4 × 2 = 8 | 13 | **34** |
| once a week, goal 1 | 4 | 4 × 1 = 4 | 4 | **12** |

### REJECTED DESIGNS — do not re-propose these

| Rejected | Why it died |
|---|---|
| Rank on volume/strength/reps | The professional wins for ever; the beginner never moves. Kd's §3 fear exactly. |
| "Weeks in a row" as a scored column | **Kd killed it**: a once-a-week member keeps the streak alive as well as a daily one. |
| Calendar-month period with a reset | **Kd killed it** (R10). |
| Attendance ÷ days-gym-was-open | Punishes rest days; a serious lifter training 4 days scores below someone strolling in 7. |
| Goal achievement as the ONLY axis | Everyone who hits any goal ties at 100%, so a 1-day goal ties a 6-day goal. |
| Splitting ranked-for-members / unranked-for-gym | **Kd killed it** (R4) — both see the ranked board. |

### Numbers not yet ruled — put these to Kd at the gate, do not invent them (R0.2)

1. **Minimum weekly goal.** Without a floor, goal=1 is legal. Recommend **2**.
2. **Default goal for a member who never sets one.** Recommend **3**, and the
   board shows it as a default until they change it.
3. **Whether "sessions logged" counts at all** given it is self-reported. It is
   in the formula above; it is the weakest of the three terms.

---

## 5 · WHAT COUNTS AS A GYM SESSION (R9)

**Measured, not recalled: `workouts` has NO `gym_id` and NO location column**
(`apps/api/src/db/schema/training.ts:20-45`). The app cannot know where a workout
happened.

The rule, which is Kd's own mechanism plus the already-ruled same-day join
(`:29961` ruling 2):

> A workout counts for the gym if the member **checked in at that gym that
> gym-day** AND the workout **started inside the gym's opening hours** for that
> day.

- Gym with declared hours → the session windows for that weekday, minus dated
  closures (`:26684` — a closure wins over the pattern).
- `open_24h` or `hours_unset` → the whole gym-day counts. **No narrowing is
  possible and none may be invented.**

**Its honest limit, which Kd was told:** a gym open 06:00–22:00 still leaves a
16-hour window, so a home workout at 8pm on a day the member visited will count.
This is tolerable ONLY because the score counts *whether* they trained, never
*how much*.

---

## 6 · WHAT THE GYM SEES vs WHAT A MEMBER SEES

**One board, two audiences. The split is a privacy boundary, not a convenience.**

| | Gym (owner/staff) | Member, on `My Gyms` |
|---|---|---|
| Rank + score | ✅ | ✅ |
| Display name | ✅ | ✅ |
| 7 day-circles | ✅ | ✅ |
| The three numbers | ✅ | ✅ |
| **Email** | ✅ | ❌ **never** |
| **"Not in for N days" filters** | ✅ | ❌ |
| Click into a member's detail | ✅ | ❌ (own row only) |
| Send a message | ✅ | ❌ (R8) |
| Everyone, paged | ✅ | Top 10 + own neighbourhood |

**THE EMAIL LINE IS NOT NEGOTIABLE WITHOUT A KD RULING.** `:31098` ruled the
email visible **to the gym** and says in terms: *"This is a ruling about EMAIL
and not a licence — the next gym-facing field needs its own."* Member-to-member
is a new disclosure to a new audience and would break the join door's *"What
{org} can see"* promise (Part 3 §2.4). Kd did not object when told; he has not
ruled it either.

**No member is ever shown a "has stopped coming" mark about another member.**
Being low on a ranking is survivable; being publicly labelled as lapsed is not.

### Categories become FILTERS, not labels — and this is what kills the bug

R7 removed every message cooldown, so nothing needs gating on "who may be
nudged". The gym filters the one list by: *regular (4+/week, R1) · not in for 3+
days · not in for a week · new this month · never came.*

**Nobody carries an exclusive label, so no two labels can contradict each
other.** Priya at three days a week is not branded anything (R2) — she simply
appears if the owner asks for 3-day absences. The T3's C/H-1 stops being
reachable rather than being excluded by a predicate.

---

## 7 · THE INFO PANEL (R14)

An ⓘ beside the board title, **same words for gym and member**, and the words
must match the code or they are a `:5807` finding. Draft:

> **How this board works**
> Your score covers the last 30 days and updates the moment you check in.
> · 1 point for every day you came to the gym
> · A bonus each week you hit your goal, equal to your goal — hit a 4-day goal, get 4 points
> · 1 point for each of those days you also logged a workout
> Set your own goal. A small goal earns a small bonus, so there is nothing to gain by aiming low.

**A test must assert this text against the constants that produce it**
(`:19960` — asserting a user-visible string against the constant that produces
it), or the panel and the maths drift apart.

---

## 8 · BUILD ORDER — four cards, not one

Each is its own chat with its own plan gate.

**L0 · Fix what is already built and unreviewed.** The T3 on `:36907` found
three Critical/High. Under this plan two of them dissolve (C/H-1 by §6's filters,
C/H-3 with the panel it belonged to) but **C/H-2 is REAL and survives**: the
`latestNudge` lateral in `apps/api/src/modules/orgs/repo.ts:568-574` has two
tenancy predicates and **no test observes either** — its only fixture uses one
gym and one member (`apps/api/test/orgs.nudges.test.ts:706`). Dropping `user_id`
hands somebody another member's message. **Fix with a two-gym, two-nudged-member
fixture plus mutants O297/O298.** Also the three Lows in `BACKLOG.md`.

**L1 · The score + the gym's board.** The rolling-30-day query, the goal column,
the day-circles, filters, paging, the ⓘ panel.

**L2 · The member's board** on `My Gyms`, with §6's redactions.

**L3 · Message-to-everyone + a bigger library.** Presets only, no free text
(`:18128`, `:29961` ruling 4).

---

## 9 · BUILD NOTES FOR THE IMPLEMENTING CHAT

1. **Reuse, do not re-derive.** `getGymSlippingAway` and `sendGymNudge`
   (`repo.ts`), migration `0022_gym_nudges`, `gym_nudges` in `privacy/tables.ts`
   and the nudge write door all survive. The *panel* dies, not the plumbing.
2. **`nudgeableAt` and the rolling seven-day cap are DELETED by R7** — both the
   guard in `sendGymNudge` and the reader in `getGymSlippingAway`, together with
   their tests and mutants. **Delete the pair or the rule is enforced in one
   place and reported from another** (`:35944` C/H-2's exact shape).
3. **One answer to "which week".** Week buckets are Monday-based
   (`date_trunc('week', …)`) everywhere already. A second convention computed in
   JavaScript is how two panes on one screen disagree.
4. **Every window is a GYM-day** (`(now() AT TIME ZONE g.timezone)::date`), never
   a UTC day and never the server's clock — trap #8, and `users.timezone` is
   still uncaptured (`:618`).
5. **Every count comes from the server** (`:27992` §3): a screen that pages 100
   rows and counts them in the browser is right on six members and wrong on four
   hundred.
6. **Population is the roster's** — live, non-complimentary members — so the
   board can never name somebody the Members screen does not list.
7. **Never read `org_member_stats`, never import from `gamification/`.** The view
   counts workouts ANYWHERE, which `:26469` §1.3 forbids showing a gym. It is the
   single most convenient wrong answer in this schema.
8. **Reads are gated on `attendance.read`; the message button on `members.read`.**
   Different ticks — a staffer may legitimately see the board and be refused the
   button (`:12518` C/H-2's shape).
9. **Scale is unmeasured.** Compute live for now; a 3,000-member gym is 3,000
   rows and `:31098` already flagged that class. **Measure before adding a
   rollup — do not build one on a guess.**
10. **Fixtures: two gyms and two memberships, always** (`:28221` §3b), at least
    one gym in a non-UTC zone (`:26812`), and never all-current-week
    (`:30243`).

---

## 10 · MUST GET AN `OWED.md` LINE WHEN THIS IS COMMITTED

- **R7 removes every message limit, and that is safe ONLY while nothing
  notifies.** Nothing in this product sends anything today — *"send" means
  "write something a screen will show"* (`:29961`). **The day push notifications
  ship, uncapped messaging becomes ten buzzes in a member's pocket and a limit
  must return.** Kd was told this and accepted it.
- **`CARD-gym-overview-people.md` §§S2.4a–S2.7 are superseded in part by this
  plan** and the card must say so, or the next chat builds the dead design.
- **The three T3 Critical/High findings** on `:36907`, until L0 closes them.

---

## 11 · STILL KD'S, NOT A CHAT'S

1. The three unruled numbers in §4.
2. **Is the member board opt-in or does it show everyone?** Asked, not answered.
   Recommendation: show everyone, with a switch to hide yourself.
3. Whether the email line in §6 stands (it does unless he rules otherwise).
