# SMOKE — the calendar on "Days you came" (Kd's ruling `:31508`)

**Card:** DECISIONS `:32197` (web) on top of `:31921` (server), as corrected at
Kd's browser the same day (`:32395`).
**Status: 3 of 13 RUN.** The `OWED.md` calendar line does not tick until the rest
pass and T3 has run.

**⚠️ THIS SHEET DESCRIBES THE CALENDAR AS IT IS AFTER KD'S CORRECTION — folded
away behind a calendar icon, opened by a click.** Its first version described a
month grid that was open by default, which he looked at and rejected
(*"disgusting covering alsmot the whole page"*). A sheet that describes a screen
as it WAS is the defect commit `25554f3` exists to fix.

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

---

## Steps

**Steps 1–3 were RUN AND PASSED at Kd's own browser on 2026-09-03** — his words,
*"excellent everything good"*, after he had rejected the first shape on the same
screen. **They are ticked below and 4 and 6–13 are NOT**: one look at a folded calendar
and a flame is not a run of this sheet (:27810, :31633 — an operator's approval
covers what was on screen when it was given).

| # | Do this | ✅ Expect | Ran |
|---|---|---|---|
| 1 | Open **My Gyms**. | Under the gym's opening times there is a **single row**: an orange **calendar icon**, the words **Days you came**, and a **⌄** on the right. **No month grid is on screen** — it is folded away. | ✅ 2026-09-03 |
| 2 | Click that row. | A **compact** month opens — a small block of squares, not a full-width sheet. Above it, the month name and year with **‹** and **›** arrows. | ✅ 2026-09-03 |
| 3 | Look at a day you came. | It is a **bright orange flame filling the square**, with **the date inside it in white**, readable without leaning in. Days you did not come are a plain grey number. Days later this month are dimmed. | ✅ 2026-09-03 |
| 4 | Click the **Days you came** row again. | The month **folds away** and the row is back on its own. | |
| 5 | Look at the month name. | It is **the month your gym is in right now**. | |
| 6 | Press **I'm here** (if your gym is open), with the calendar open. | The confirmation sentence appears as before, **and today's square turns into a flame straight away** — no reload. | |
| 7 | Click the flame for a day you came. | A panel opens over the screen headed with **that day's date**, listing **the time or times you arrived**. Click outside it, or the ✕, and it closes. | |
| 8 | Press the **left arrow** once. | The heading moves to the **previous month** and the grid redraws for it. If you came that month, those days carry flames. | |
| 9 | Press the **right arrow** to come back. | You are back on the current month, and **no day panel opens by itself**. | |
| 10 | On the current month, look at the **right arrow**. | It is **greyed out** — there is no next month to look at. | |
| 11 | If you have a month with no visits, step to it. | It says **"No visits in <that month>."** — it does **not** say you have never marked in at this gym. | |
| 12 | Stop the API server, reload My Gyms, and open the calendar. | You see the month name and arrows plus **"Couldn't load the days you came."** — **not** an empty grid, and **not** a claim that you have no visits. Start the API again and reload: the grid comes back. | |
| 13 | Open the same screen on a **phone** (or a narrow window). | The calendar row is easy to hit, the opened month fits without sideways scrolling, the flames are big enough to tap, and the day panel arrives **from the bottom**. | |

---

## What this sheet does NOT cover, so nobody quotes it as more

- **A gym in a different time zone from you.** Step 5 is the one assertion about
  whose month it is, and reading it in your own gym's zone cannot tell a correct
  implementation from one using your phone's clock. That case is held by a test
  (`C191`) and by nothing you can see here.
- **THE THREE STEPS THAT HAVE RUN COVER HOW IT LOOKS, AND NOTHING ELSE.** Kd's
  *"excellent everything good"* was given to a folded row, an opened month and a
  flame with a date in it. It says nothing about stepping months, opening a day,
  an empty month's wording, or a failed read — steps 4 and 6–13, all unrun.
- **A month with more than a hundred visits.** The "some days may be missing"
  line needs more than three visits a day for a whole month; no account is near
  it, and that is a fact about this sheet rather than about users (:4355).
- **Keyboard use of the day panel.** It has no focus trap — neither does any
  other overlay in this app — and that is an `OWED.md` line, not a defect of this
  card.
