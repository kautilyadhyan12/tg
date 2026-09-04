# SMOKE — the calendar on "Days you came" (Kd's ruling `:31508`)

**Card:** DECISIONS `:32197` (web) on top of `:31921` (server), as corrected at
Kd's browser the same day (`:32395`).
**Status: 3 OBSERVED · 9 DECLARED · 1 STRUCK — AND THE PACKET'S GATE IS NOW
DISCHARGED ON KD'S DECLARATION (2026-09-04).** *"these tests have been perfomred
100 times till now lets just fucking wrap this card and write all tests
passed"*, given after being handed `smoke-attendance.md` in full and asking for
the card wrapped. He was NOT shown this sheet in that session.
**THE CORRECTED STEP 5 HAS STILL NEVER BEEN RUN BY ANYBODY** — T3 round 3 found
that step 4 folds the month away and step 5 then read the month name out of it,
so every step from 5 down inherited a shut fold; the fix re-opens it and the
📣 declarations below predate that wording. **T3 is no longer a gate — round 4
found zero Critical/High (`:33799`) — so nothing mechanical is outstanding here;
what is outstanding is that a human has looked at steps 4–13 exactly once, in
their pre-correction form.**

**⚠️ THIS SHEET DESCRIBES THE CALENDAR AS IT IS AFTER KD'S CORRECTION — folded
away behind a calendar icon, opened by a click.** Its first version described a
month grid that was open by default, which he looked at and rejected
(*"disgusting covering alsmot the whole page"*). A sheet that describes a screen
as it WAS is the defect commit `25554f3` exists to fix.

**CORRECTED 2026-09-04 — STEP 5 ASKED FOR SOMETHING STEP 4 HAD JUST HIDDEN.**
Step 4 folds the month away; step 5 then said *"Look at the month name"*, which
is drawn only while the fold is open, and nothing between them re-opened it.
Every step from 5 down inherited the shut fold. Step 5 now re-opens it. **The
📣 declarations below were given against the old wording**, so they stand as
declarations and are not upgraded by this correction.

**Why this exists even though 1,734 tests are green:** those run in jsdom through
`fastify.inject` and a mocked network. Card 4's dead-method bug sat behind 250
green tests because a browser was never opened. **What is being checked here is a
month grid drawn from real rows on a real clock — the one thing a fixture cannot
be wrong about in the same direction as the code.**

---

## Setup (once)

1. Docker Desktop running, then:
   `docker compose -f infra/docker-compose.dev.yml up -d postgres redis`
2. Start the api and the web dev server the usual way.
3. **Sign in as a member of a gym you can also administer**, so you can add
   visits on past dates from the console side if you want more than today's.

**A NOTE ON WHAT YOU WILL SEE FIRST:** a brand-new member has visits only in the
current month, so **steps 8 and 11 need at least one visit in a PREVIOUS month**.
If you have none, say so and skip them rather than inventing rows — an untestable
step is recorded as untestable, never as a pass.

**⏳ THE FIRST TIME YOU OPEN THE MONTH ON ANY PAGE LOAD, IT ARRIVES DIMMED AND
UNCLICKABLE FOR A MOMENT** while the app fetches your days — and until that
lands there are **no flames on it at all**. Wait for it to brighten before
judging any step, and before clicking a day. **That is loading, not a missing
visit and not a dead control.** Folding it shut and opening it again costs no
second wait; only a fresh page load does. Added by T3 round 4 (2026-09-04) after
the same window was found un-flagged in `smoke-attendance.md` steps 10 and 12 —
**it applies to every step below, which is why it is here and not in one of
them**, and no step's wording or ✅ was touched to add it.

---

## Steps

**Steps 1–3 were RUN AND PASSED at Kd's own browser on 2026-09-03** — his words,
*"excellent everything good"*, after he had rejected the first shape on the same
screen.

**THE REST ARE PASSED ON HIS DECLARATION, NOT ON A WATCHED RUN** (:27415's
precedent, and its exact wording). Handed the remaining steps he said *"the smoke
passed"*, and after step 12 was shown to be unrunnable, *"lets just say pass not
undersatning what you saying"*. **The gate is his to open and it is open. What is
NOT claimed is that these steps were observed** — writing *"the smoke ran and
passed"* would be a false statement about an event, which is :23535, this repo's
recorded instance of exactly that.

**STEP 12 IS STRUCK RATHER THAN PASSED, AND KD'S OWN OBSERVATION IS WHY** — see
the note under the table. It is the one step here that was actually attempted.

| # | Do this | ✅ Expect | Ran |
|---|---|---|---|
| 1 | Open **My Gyms**. | Under the gym's opening times there is a **single row**: an orange **calendar icon**, the words **Days you came**, and a **⌄** on the right. **No month grid is on screen** — it is folded away. | ✅ 2026-09-03 |
| 2 | Click that row. | A **compact** month opens — a small block of squares, not a full-width sheet. Above it, the month name and year with **‹** and **›** arrows. | ✅ 2026-09-03 |
| 3 | Look at a day you came. | It is a **bright orange flame filling the square**, with **the date inside it in white**, readable without leaning in. Days you did not come are a plain grey number. Days later this month are dimmed. | ✅ 2026-09-03 |
| 4 | Click the **Days you came** row again. | The month **folds away** and the row is back on its own. | 📣 declared |
| 5 | **Tap the Days you came row open again** — step 4 folded it shut — then look at the month name. | It is **the month your gym is in right now**. | 📣 declared |
| 6 | Press **I'm here** (if your gym is open), with the calendar open. | The confirmation sentence appears as before, **and today's square turns into a flame straight away** — no reload. | 📣 declared |
| 7 | Click the flame for a day you came. | A panel opens over the screen headed with **that day's date**, listing **the time or times you arrived**. Click outside it, or the ✕, and it closes. | 📣 declared |
| 8 | Press the **left arrow** once. | The heading moves to the **previous month** and the grid redraws for it. If you came that month, those days carry flames. | 📣 declared |
| 9 | Press the **right arrow** to come back. | You are back on the current month, and **no day panel opens by itself**. | 📣 declared |
| 10 | On the current month, look at the **right arrow**. | It is **greyed out** — there is no next month to look at. | 📣 declared |
| 11 | If you have a month with no visits, step to it. | It says **"No visits in <that month>."** — it does **not** say you have never marked in at this gym. | 📣 declared |
| ~~12~~ | ~~Stop the API server, reload My Gyms, and open the calendar.~~ | **STRUCK — this step cannot reach the state it names. See below.** | ❌ struck |
| 13 | Open the same screen on a **phone** (or a narrow window). | The calendar row is easy to hit, the opened month fits without sideways scrolling, the flames are big enough to tap, and the day panel arrives **from the bottom**. | 📣 declared |

---

## STEP 12 IS STRUCK, AND KD'S OBSERVATION IS THE FINDING

**He ran it and was sent to the LOGIN PAGE.** *"well when api was off i reloaded
and was directed to login page did not show the word"*.

**He is right and the step was wrong.** With the api down, `AuthContext`'s
`getMe()` fails, `setUser(null)` runs and `ProtectedRoute` redirects — so My Gyms
never draws and the calendar's failed state is unreachable by that route. **A
smoke step that cannot reach the state it claims to check is worse than no step:
it invites a ✅ for something nobody saw**, which is :23535's whole shape.

**THE STATE IS REAL AND IS HELD ELSEWHERE.** It needs the ATTENDANCE read alone
to fail while auth still works — mutant **C200** turns the failed month into an
empty one and goes RED, and a render case drives it. Nothing about this striking
says the behaviour is unbuilt or unwatched.

**THE REUSABLE LESSON, and it cost Kd's patience to learn: a smoke step must be
reachable with the controls the APP gives him.** The repair offered was DevTools
request-blocking, and his answer was *"not undersatning what you saying"* — fair,
and the fault is the step's. **If a state needs a developer tool to reach, it is
not a smoke step; say so in the sheet and let a test hold it.**

---

## What this sheet does NOT cover, so nobody quotes it as more

- **A gym in a different time zone from you.** Step 5 is the one assertion about
  whose month it is, and reading it in your own gym's zone cannot tell a correct
  implementation from one using your phone's clock. That case is held by a test
  (`C191`) and by nothing you can see here.
- **ONLY THREE STEPS WERE OBSERVED, AND THEY COVER HOW IT LOOKS.** Kd's
  *"excellent everything good"* was given to a folded row, an opened month and a
  flame with a date in it. **Steps 4–11 and 13 are 📣 DECLARED**: the gate is open
  on his authority (:27415) and nobody watched them. Stepping months, opening a
  day, the empty-month wording and the phone width are therefore **unobserved**,
  and each is held by a test and a mutant instead — C195, C197, C194, and nothing
  for the phone width.
- **NOTHING HERE HOLDS THE PHONE WIDTH.** jsdom has no layout, so step 13 has no
  test behind it either. It is the one row where a declaration leaves a real gap,
  and it is the shape Kd found by eye twice on this card (:32395).
- **A month with more than a hundred visits.** The "some days may be missing"
  line needs more than three visits a day for a whole month; no account is near
  it, and that is a fact about this sheet rather than about users (:4355).
- **Keyboard use of the day panel.** It has no focus trap — neither does any
  other overlay in this app — and that is an `OWED.md` line, not a defect of this
  card.
