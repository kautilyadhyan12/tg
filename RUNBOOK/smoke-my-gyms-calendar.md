# SMOKE — the calendar on "Days you came" (Kd's ruling `:31508`)

**Card:** DECISIONS `:32197` (web) on top of `:31921` (server).
**Status: NOT RUN.** The `OWED.md` calendar line does not tick until this passes
and T3 has run.

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
current month, so steps 5–7 need at least one visit in a PREVIOUS month. If you
have none, say so and skip 6–7 rather than inventing rows — an untestable step is
recorded as untestable, never as a pass.

---

## Steps

| # | Do this | ✅ Expect |
|---|---|---|
| 1 | Open **My Gyms**. | Under **Days you came** there is a **month grid**, not a list. The month name and year are on the right of that heading, between two arrows. |
| 2 | Look at the month name. | It is **the month your gym is in right now**. |
| 3 | Look at the days you have already come. | Each one is **tinted and has a small flame**. Days you did not come are plain. Days later this month are dimmed. |
| 4 | Press **I'm here** (if your gym is open). | The confirmation sentence appears as before, **and today's square lights up with a flame straight away** — no reload. |
| 5 | Tap the square for a day you came. | A panel opens over the screen headed with **that day's date**, listing **the time or times you arrived**. Tap outside it, or the ✕, and it closes. |
| 6 | Press the **left arrow** once. | The heading moves to the **previous month** and the grid redraws for it. If you came that month, those days carry flames. |
| 7 | Press the **right arrow** to come back. | You are back on the current month, and **no day panel opens by itself**. |
| 8 | On the current month, look at the **right arrow**. | It is **greyed out** — there is no next month to look at. |
| 9 | If you have a month with no visits, step to it. | It says **"No visits in <that month>."** — it does **not** say you have never marked in at this gym. |
| 10 | Stop the API server, then reload My Gyms. | Under **Days you came** you see the month name and arrows plus **"Couldn't load the days you came."** — **not** an empty grid, and **not** a claim that you have no visits. |
| 11 | Start the API again and reload. | The grid comes back with your days. |
| 12 | Open the same screen on a **phone** (or a narrow window). | The grid fits without sideways scrolling, the squares are big enough to tap, and the day panel arrives **from the bottom**. |

---

## What this sheet does NOT cover, so nobody quotes it as more

- **A gym in a different time zone from you.** Step 2 is the one assertion about
  whose month it is, and reading it in your own gym's zone cannot tell a correct
  implementation from one using your phone's clock. That case is held by a test
  (`C191`) and by nothing you can see here.
- **A month with more than a hundred visits.** The "some days may be missing"
  line needs more than three visits a day for a whole month; no account is near
  it, and that is a fact about this sheet rather than about users (:4355).
- **Keyboard use of the day panel.** It has no focus trap — neither does any
  other overlay in this app — and that is an `OWED.md` line, not a defect of this
  card.
