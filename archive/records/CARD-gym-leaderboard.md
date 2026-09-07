# CARD — the gym leaderboard (replaces the two people-panels)

**STATUS: WRITTEN, AND ONLY `L0` IS AT A GATE.** `§L0` below is a complete build
plan and is what Kd is being asked to approve. `§§L1–L3` are SCOPE carried from
`PLAN-gym-leaderboard.md`, corrected by Kd's rulings of 2026-09-07; each still
needs its own card gate before a line of it is written (`:26777`).

**NO CODE EXISTS FOR ANY SLICE.** Written 2026-09-07.

**Supersedes in part:** `CARD-gym-overview-people.md` §§`S2.4a`–`S2.7`. That
card's *"Slipping away"* PANEL is replaced by this leaderboard's filters; its
`gym_nudges` table, its write door and its migration `0022` all survive
untouched. Do not build that card's §S2.4b web half — it is the dead design.

---

## 0 · WHY THIS CARD EXISTS

`CARD-gym-overview-people.md` builds two separate console panels — *"On a roll"*
(shipped) and *"Slipping away"* (server half shipped, `DECISIONS :36907`). A T3
review found the two panels can name **the same person at the same time**: the
owner's home screen would say *"keeps turning up"* and *"has stopped coming"*
about one member, which is `:5807` Critical/High.

Kd did not patch it. **He replaced the design** — one combined, ranked member
list, where the contradiction is impossible by construction rather than excluded
by a predicate.

---

## 1 · KD'S RULINGS — the two sessions, in one place

### 1.1 · 2026-09-06/07 planning session (`PLAN-gym-leaderboard.md` §2)

| # | Ruling | His words |
|---|---|---|
| R1 | **"On a roll" needs 4 visits a week**, not the built "once a week, two weeks running" | *"make it 4 visits a week then on a roll"* |
| R2 | **A 3-day-a-week member belongs on NEITHER list** — she is fine, just not a star | chose *"No — neither list"* |
| R3 | **Combine the panels into ONE list** | *"we can combine everything to a single thing"* |
| R4 | **The list is a ranked leaderboard, for the gym AND for members** | *"no leaderboard will be there for gyms as well but they will have the filter option"* |
| R5 | **Members see it on their `My Gyms` screen** | *"this leaderboard will show on members my gym"* |
| R6 | **This is the GYM leaderboard only**; a GLOBAL leaderboard is a different feature | *"there is another leaderboard for global that will be completely different"* |
| R7 | **Messages have NO cap and NO cooldown**; a new message REPLACES the previous one | *"just dont need to keep any time contraint gym can send message anytime"* |
| R8 | **Only gyms send messages**; the library must grow | *"we need to increase message libary"* |
| R9 | **Exercises count only if done at the gym**, and opening hours are the mechanism | *"a user who logs their exercises during these times will be used for leaderboard"* |
| R10 | **The board updates instantly, never on a monthly reset** | *"i dont want the leadrboard to update after one month but should be update instantly"* |
| R11 | **Hitting a goal must count toward the score** | *"also achiving goal should also count"* |
| R12 | **7 day-circles per member row**, short day names, bright on days attended | his sketch |
| R13 | **Click a member → detail, filterable 1 week / 1 month / more** | his sketch |
| R14 | **An info symbol explains how the board is decided** | *"small info like symbol when click user can see how leaderboard is decided"* |

### 1.2 · 2026-09-07, at this card's gate — FOUR MORE, and one CORRECTS the plan

| # | Ruling | His words |
|---|---|---|
| **R15** | **A GOAL IS NOT "HOW MANY DAYS I WILL COME."** It is a real goal: burning a set number of calories, eating healthily, doing the exercises the app recommends, or exercises the member sets themselves. **This corrects `PLAN-gym-leaderboard.md` §4, which a chat had written as an attendance goal.** | *"weekly goal is like burning this much calories , eating healthy food , achiving to do exercises recommended by the app or set by myself , etc"* |
| **R16** | **BOTH A DAILY GOAL AND A WEEKLY GOAL ARE MEASURED**, not one or the other. | *"ok will measure each day goal and weekly goal as well"* |
| **R17** | **HIDING YOURSELF IS OPT-OUT, NEVER OPT-IN, AND IT GREYS THE ROW RATHER THAN REMOVING IT.** The row keeps its place; the profile draws grey; nothing anywhere announces that the member chose to hide. | *"hide me should not be default but should have the option ( will only show the profile as gray not that user has decided to hide themself from leaderboard)"* |
| **R18** | **A GYM ALWAYS SEES THE FULL ROW.** Hiding is member-to-member only and never blinds the gym. | *"but gyms should still see details"* |

**R17 IS A KNOWING DEVIATION FROM Part 3 §4.4** (`03-part3-org-console.md:358-359`),
which says *"opted-out members simply don't appear"*. Kd's design keeps them on
the board, greyed. **His version is stronger than the spec's and than the
industry's**: a removed row leaves a visible gap that can be read as *"that
person hid"*, and a greyed row cannot. Recorded as a deviation (R0.3), not an
oversight.

**R17/R18 also settle the plan's §11 item 2**, which had never been answered.

### 1.3 · What Kd was told before ruling, and did not dispute

- **The member's email stays invisible to other members.** `:31098` ruled the
  email visible **to the gym** and says in terms that it is *"a ruling about
  EMAIL and not a licence"*. Member-to-member is a new disclosure to a new
  audience and is NOT built. This closes `PLAN-gym-leaderboard.md` §11 item 3.
- **"Hide me" is a real feature, not an invention.** Measured this session
  against Strava's own documentation: it ships a *Show on leaderboards* switch in
  privacy settings, plus per-activity privacy that removes an effort from public
  segment leaderboards.

---

## 2 · WHAT KD IS AFRAID OF, IN HIS WORDS — the design's acceptance test

> *"there can be professional and noob and if our leaderboard is not perfect it
> will be really bad and gyms will loose trust"*

**Any scheme where a strong member permanently outranks a beginner — or where a
once-a-week member scores like a daily one — is REJECTED.** Both failure
directions have already been proposed and killed.

### REJECTED DESIGNS — do not re-propose

| Rejected | Why it died |
|---|---|
| Rank on volume / strength / reps | The professional wins for ever; the beginner never moves. §2's fear exactly. |
| "Weeks in a row" as a scored column | **Kd killed it**: a once-a-week member keeps a streak alive as well as a daily one. |
| Calendar-month period with a reset | **Kd killed it** (R10). |
| Attendance ÷ days-the-gym-was-open | Punishes rest days; a serious lifter training 4 days scores below someone strolling in 7. |
| Goal achievement as the ONLY axis | Everyone who hits any goal ties at 100%. |
| Ranked for members / unranked for the gym | **Kd killed it** (R4) — both see the ranked board. |
| **Goal = "days I intend to attend"** | **Kd killed it 2026-09-07 (R15).** It was a chat's narrowing of R11, never his. |

---

## 3 · WHAT THE APP CAN ACTUALLY CHECK — measured 2026-09-07, not assumed

R15 names four kinds of goal. Two are computable on today's schema and two do
not exist anywhere in the product.

| R15 goal type | Buildable today? | Evidence |
|---|---|---|
| Burn this many calories | **YES** | `workouts.kcal_point` — every synced workout carries a server-computed figure (`db/schema/training.ts:36-37`) |
| Eating healthily | **YES** | `GET /v1/nutrition/targets` computes daily calorie + macro targets (`modules/nutrition/routes.ts:182`), and `meal_logs` records `kcal_point`, `protein_g`, `carbs_g`, `fat_g` per meal (`db/schema/trust.ts:33-38`) |
| Exercises the app RECOMMENDS | **NO — does not exist** | Nothing under `modules/exercises` or `modules/workouts` recommends anything (grep for `recommend`, zero hits) |
| Exercises the member SETS | **NO — does not exist** | No self-set plan or programme table anywhere in the schema |

**AND THERE IS NO "GOAL" OBJECT IN THIS PRODUCT AT ALL.** The only stored
number of that shape is `user_fitness_profiles.exercise_frequency` — *days per
week*, captured once in the onboarding wizard where it defaults to `3`
(`identity.ts:132`, `Onboarding.jsx:183`) — **which is exactly the reading R15
struck, so it must NOT be repurposed as the goal.**

**CONSEQUENCE, and it belongs to whoever writes `L1`'s card:** the goal half of
the score needs a place for a member to set daily and weekly goals (R16), and
that place does not exist. It is a MEMBER-app feature, not a console one. The
two unbuildable goal types get `OWED.md` lines and plug into the same points
later without the board being redesigned — nothing is dropped, it is sequenced.

---

## 4 · THE SCORE — the rule the whole feature stands on

**UNAPPROVED AND NOT AT A GATE IN THIS CARD.** Carried here so `L1`'s card
starts from the corrected shape rather than the plan's struck one.

**Window: a ROLLING 30 DAYS, recomputed on every read** (R10). Not a calendar
month; a board that zeroes on the 1st is meaningless for the first week of every
month.

```
score  =  visits_30d
        + goal points        (R11/R15/R16 — daily AND weekly, shape UNRULED)
        + sessions_logged_on_attended_days_30d
```

**THE GOAL TERM IS DELIBERATELY NOT SPECIFIED HERE.** R15 changed what a goal
is, R16 added a second cadence, and the numbers underneath — how many points a
daily goal is worth against a weekly one, and whether a goal hit away from the
gym counts at all — are Kd's (R0.2). **`L1`'s gate is where they are asked**,
with their costs, never invented.

**The one thing already known about the goal term:** goals mostly happen away
from the gym, and `:26469` §1.3 forbids showing a gym what a member did
elsewhere. The recommendation put to Kd was **goal points only for a goal hit on
a day the member came in** — which keeps both rulings and matches `:29961`
ruling 2's existing precedent that a workout counts for a gym on the same
gym-day as the visit. He answered *"ok"* and added R16; **treat the anchoring as
RECOMMENDED-AND-NOT-YET-EXPLICITLY-RULED, and put it to him again in one line at
`L1`'s gate rather than building on a one-word approval** (`:26777`).

---

## 5 · WHAT COUNTS AS A GYM SESSION (R9)

**Measured: `workouts` has NO `gym_id` and NO location column**
(`db/schema/training.ts`). The app cannot know where a workout happened.

The rule is Kd's own mechanism plus the already-ruled same-gym-day join
(`:29961` ruling 2):

> A workout counts for the gym if the member **checked in at that gym that
> gym-day** AND the workout **started inside the gym's opening hours** for that
> day.

- Gym with declared hours → that weekday's session windows, minus dated closures
  (`:26684` — a closure wins over the pattern).
- `open_24h` or `hours_unset` → the whole gym-day counts. **No narrowing is
  possible and none may be invented** (`:26736`).

**Its honest limit, which Kd was told:** a gym open 06:00–22:00 still leaves a
16-hour window, so a home workout at 8pm on a day the member visited will count.
Tolerable ONLY because the score counts *whether* they trained, never *how much*.

---

## 6 · WHAT THE GYM SEES vs WHAT A MEMBER SEES

**One board, two audiences. The split is a privacy boundary, not a convenience.**

| | Gym (owner/staff) | Member, on `My Gyms` |
|---|---|---|
| Rank + score | ✅ | ✅ |
| Display name | ✅ **always, even when hidden (R18)** | ✅ unless that member is hidden (R17) |
| 7 day-circles | ✅ | ✅ |
| The score's parts | ✅ | ✅ |
| **Email** | ✅ (`:31098`) | ❌ **never** |
| **"Not in for N days" filters** | ✅ | ❌ |
| Click into a member's detail | ✅ | ❌ (own row only) |
| Send a message | ✅ | ❌ (R8) |
| Everyone, paged | ✅ | Top 10 + own neighbourhood |

**No member is ever shown a "has stopped coming" mark about another member.**
Being low on a ranking is survivable; being publicly labelled as lapsed is not.

### 6.1 · Hiding, exactly as R17/R18 rule it

- **Default is VISIBLE.** `users.leaderboard_opt_out` already exists, `NOT NULL
  DEFAULT false` (`identity.ts:26`), is carried in the shared user schema
  (`packages/shared/src/users.ts:18,42`) and is already writable through the
  users PATCH (`modules/users/repo.ts:95`). **There is no screen for it** —
  nothing under `apps/web/src` reads or writes it. That screen is owed.
- **A hidden member keeps their row, their rank and their score.** Only the
  identity greys: the name is replaced on the member-facing board.
- **Nothing states that a member chose to hide.** A label saying so would defeat
  the whole point of greying rather than removing.
- **The gym's copy of the board is unaffected** (R18) — full name, full detail.

### 6.2 · Categories become FILTERS, not labels — and this is what kills the bug

R7 removed every message cooldown, so nothing needs gating on *"who may be
nudged"*. The gym filters the one list by: *regular (4+/week, R1) · not in for 3+
days · not in for a week · new this month · never came.*

**Nobody carries an exclusive label, so no two labels can contradict each
other.** A three-day-a-week member is not branded anything (R2) — she simply
appears if the owner asks for 3-day absences. **The T3's C/H-1 stops being
REACHABLE rather than being excluded by a predicate.**

---

## 7 · THE INFO PANEL (R14)

An ⓘ beside the board title, **the same words for gym and member**. The words
must match the code or they are a `:5807` finding, and **a test must assert the
text against the constants that produce it** (`:19960`) or the panel and the
maths drift apart.

Draft copy waits on §4's goal term being ruled — **do not write the sentence
about goals until the rule exists.**

---

## 8 · BUILD ORDER — four cards, each with its own gate

**`L0` · Protect what is already built and unreviewed.** ← **THIS CARD'S GATE.**
Detail in §9.

**`L1` · The score + the gym's board.** The rolling-30-day query, the goal
feature (§3's consequence), the day-circles, filters, paging, the ⓘ panel.
**Its gate must ask Kd for §4's unruled goal numbers.**

**`L2` · The member's board** on `My Gyms`, with §6's redactions and §6.1's
hiding — **including the switch's screen, which does not exist.**

**`L3` · Message-to-everyone + a bigger library.** Presets only, no free text
(`:18128`, `:29961` ruling 4). **R7 deletes the rolling seven-day cap and its
`nudgeableAt` reader together** — both, or the rule is enforced in one place and
reported from another (`:35944`'s exact shape).

---

## 9 · `L0` — THE SLICE AT THE GATE

### 9.1 · What it is, in one sentence

**A tenancy guarantee in shipped code has nothing holding it there. `L0` adds
the test and the two mutants that hold it. No source file changes.**

### 9.2 · The finding

The T3 on `:36907` tagged this **Critical/High**. Restated from the code, read
this session:

`listOrgsForUser` joins the member's newest gym message with a lateral carrying
two tenancy predicates (`modules/orgs/repo.ts:568-574`):

```sql
LEFT JOIN LATERAL (
  SELECT n.preset, n.created_at
  FROM gym_nudges n
  WHERE n.gym_id = g.id AND n.user_id = ${userId}
  ORDER BY n.created_at DESC
  LIMIT 1
) nd ON true
```

**Both predicates are correct today. NOTHING OBSERVES EITHER.** The only test
that reads `latestNudge` (`test/orgs.nudges.test.ts:706`) builds **one gym and
one member**, so:

- deleting `n.user_id = ${userId}` → that gym's newest message is handed to
  **every member of the gym**, and the test still passes;
- deleting `n.gym_id = g.id` → one gym's message draws on **another gym's card**,
  and the test still passes.

`O295` already mutates that lateral's TABLE (`gym_nudges` → `gym_cheers`).
**Neither predicate has a mutant.** That is `:35944`'s lesson in a new
direction — a mutant for the read without its siblings for the read's scope.

### 9.3 · The class check — done, and it is one case

**The cheer's identical lateral IS protected.**
`test/orgs.cheers.test.ts:934-978` (*"puts one gym's cheer on that gym's card and
nobody else's"*) builds **two gyms and two members** and asserts both
predicates by name. Comparing every test title in both suites, that is the only
guarantee the cheer holds and the nudge does not; the nudge's own extra cases
(windows, panel disjointness, ordering, empty state) have no cheer equivalent.

**So the lesson is narrow and exact: the nudge slice copied the cheer's SQL and
did not copy the cheer's TEST.** The handoff already recorded that *a copied line
inherits the original's MUTANTS*; this is the other half — **a copied line does
not inherit the original's TESTS**, and nothing in the build objects.

### 9.4 · Files this card touches — the complete list

| File | Change |
|---|---|
| `apps/api/test/orgs.nudges.test.ts` | **+1 test**, modelled on `orgs.cheers.test.ts:934`: two gyms, two members, both predicates asserted |
| `apps/api/tools/mutate-orgs.mjs` | **+2 mutants**, `O297` and `O298` (last existing id is `O296` — counted, not assumed) |
| `BACKLOG.md` | the round's Low block, once the three Lows are recovered (§9.8) |
| `DECISIONS.md` · `DECISIONS-INDEX.md` · `DECISIONS-TRIGGERS.md` · `OWED.md` | the record |

**NO source file changes. NO migration. NO schema change. NO route change. NO
`packages/shared` change. NO web change.**

### 9.5 · The test, precisely

Placed in `orgs.nudges.test.ts`, beside the existing §7 case.

**Fixture** — `:28221` §3b's rule, two gyms and two memberships:

- one owner, two gyms `A` and `B`;
- member `M` joins **both**, backdated past the membership floor;
- member `N` joins **`A` only**, likewise backdated;
- `A` nudges `M` with preset *p1*; `B` nudges `M` with preset *p2*; **`A` also
  nudges `N`** with preset *p3*.

**Assertions:**

1. `M`'s `/v1/orgs/mine` shows *p1* on `A`'s card and *p2* on `B`'s.
   → dropping `gym_id` puts one gym's message on the other's card and fails here.
2. `N`'s `/v1/orgs/mine` shows *p3* on `A`'s card, **not *p1***.
   → dropping `user_id` hands `N` the message meant for `M` and fails here.

**THE PRESETS MUST BE THREE DIFFERENT VALUES AND THE ASSERTIONS MUST NAME THE
VALUE, never merely non-null** — `:36907` recorded that this suite's earlier
case asserted non-null and the mutant SURVIVED, because a member with two
messages has something to return either way. **`N` having a message of their own
is the point**: if `N` had none, `expect(...).toBeNull()` would pass under a
dropped `user_id` only until somebody gave `N` a message.

### 9.6 · The mutants

| Id | Anchor | What it does | Expected |
|---|---|---|---|
| `O297` | the nudge lateral's `WHERE` | deletes `AND n.user_id = ${userId}` | **RED** on assertion 2 |
| `O298` | the nudge lateral's `WHERE` | deletes `AND n.gym_id = g.id` | **RED** on assertion 1 |

**Both anchors sit inside the block `O295` already anchors on**, so the anchor
strings must be distinct enough that all three match exactly once. `:15770` is
the recorded cost of an anchor that matches twice, and the harness aborts rather
than lying — **the abort is the guard, not a failure.**

**Run the control GREEN and tally it FIRST**, then each mutant unpiped, with the
restore sha256-verified after each (`:35822` — a crashed harness does not
restore what it edited).

### 9.7 · Risks

1. **The sweep must run against the LOCAL database**, `127.0.0.1:5433`, never
   the Neon branch — `:13659` measured 14.7× and `:35822` is the cost of a
   `DATABASE_URL` typed from memory. Docker Desktop must be running first.
2. **The full `apps/api` suite flakes on a fast database** and it is
   PRE-EXISTING (`:13746`): nine files call `seed()` against one shared database
   while two assert exact global counts. **A scoped run is unaffected**, which is
   all this card does — do not quote a single full-suite run as the suite's state.
3. **Three mutants on one SQL block** is the anchor-collision hazard above.
4. **`L3` will delete the nudge's rolling cap and its `nudgeableAt` reader**
   (R7). This card must add nothing that pins the cap, or `L3` inherits a test
   that asserts a rule Kd removed. **The lateral itself survives** — R7 keeps one
   message drawing, it just stops rationing them.

### 9.8 · WHAT I DO NOT HAVE, AND IT NEEDS KD

**The T3's findings were never written to the repo.** `PLAN-gym-leaderboard.md`
§8 describes `C/H-2` in full — that is §9.2 above, and I re-derived every word of
it from the code this session — but:

- **`C/H-1` and `C/H-3` exist only as one-line descriptions** ("the two panels
  can name the same person"; "the panel it belonged to"). The plan says both
  **dissolve** under the new design. §6.2 shows why `C/H-1` does. **I cannot
  verify `C/H-3` against anything, because nothing records what it said.**
- **The "three Lows in `BACKLOG.md`" are not in `BACKLOG.md`.** Its newest block
  is the My Gyms round of 2026-09-02; there is no block for this round at all.

**So `L0` as written closes the one finding that is legible. If Kd still has the
review's output, pasting it lets the other findings be closed properly;
otherwise the two dissolved ones close on the design change and the three Lows
are lost.** Either way this takes an `OWED.md` line rather than being carried in
prose (`CLAUDE.md`'s deferral rule).

### 9.9 · Definition of done

- [ ] `apps/api` typecheck clean · eslint clean on the two touched files
- [ ] `orgs.nudges` suite green, LOCAL, output pasted in full
- [ ] `orgs.cheers` suite green (it shares the harness's anchors)
- [ ] control GREEN and tallied first; `O295`, `O297`, `O298` each **RED**;
      restore sha256-verified after every mutant
- [ ] **the new test proven to fail without the guarantee** — `:5348` rule 3
- [ ] `BACKLOG.md` block, or its absence explained under §9.8
- [ ] `DECISIONS.md` entry with its `Read before …` sentence, its
      `DECISIONS-INDEX.md` line in the SAME commit, and the triggers rebuilt
- [ ] **NO SMOKE — `L0` changes nothing a person can see.** Stated, not skipped
- [ ] **T3 is a DIFF-ONLY re-review** (`:5348` rule 2) covering only this fix,
      not a fresh full pass — this card IS the fix round for the `:36907` T3
