# SMOKE — a gym says when it's open, and its members can see it

**What this proves:** an owner can say their gym is open 24 hours, or set as many
time slots per day as they like, or mark a single date closed with a reason —
and a member of that gym sees all of it on their own screen.

**Step 1 is the one that matters most, and it asserts that NOTHING appears.** A
gym that has never filled this in must not tell its members it is "Closed" — it
has simply not answered yet. Those two states look identical in the database, and
getting them confused would have told every existing gym's members that their gym
never opens. If step 1 shows the word "Closed" anywhere, stop and say so.

**Time:** about 15 minutes. **You need:** the API and the web app running
locally, and **two email addresses** (the second never receives mail).

**Status: NOT YET RUN.**

---

## Setup

**S1.** Start the local database.

```
docker compose -f infra/docker-compose.dev.yml up -d postgres redis
```

**S2. Stop any API you already have running, then start a fresh one.** A server
started before a change serves the old code from memory, and that has cost this
project three smoke rounds. If one is already up on port 3000 the new one exits
at once with `EADDRINUSE` and you are left talking to the old server.

**S3 — RUN THIS AGAINST THE LOCAL DATABASE.** `apps/api/.env` points at the
shared Neon branch where your own gyms live, so `--env-file=.env` is the WRONG
repair here. From the repo root, as one line:

```
cd apps/api && DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg' WEB_ORIGIN='http://localhost:5173' JWT_SECRET='dev-smoke-secret-not-a-real-one-32chars' node --import tsx src/index.ts
```

Then start the web app as usual (`corepack pnpm --filter web exec vite`).

Your existing gyms will not be there — this is a different, local database, and
you need new accounts anyway.

**No pauses and no commands from me.** The whole sheet is yours to run start to
finish; hand it back in one go.

---

## The run

| # | Do this | ✅ Expect |
|---|---|---|
| 1 | Sign up as **account A**, create a gym (country **United States**), and press **"Start your 30-day free trial"** on the pop-up. Copy the join code. Then go to **Settings** and find the **"When we're open"** heading. | Under the heading: **"You haven't said when your gym is open. Members aren't shown anything about opening times until you do."** **The word "Closed" must not appear anywhere on this screen.** This is the whole point of step 1 — an unanswered gym says nothing, it does not claim to be shut. |
| 2 | Click the **"When we're open"** heading to open the section. | It opens. There are two choices — **Open 24 hours** and **Set opening times** — and neither is ticked. No days are listed yet. **Save opening times is grey.** |
| 3 | Choose **Open 24 hours**, then press **Save opening times**. | **"Saved."** appears. Close and re-open the section (or press F5): the heading now reads **"Your gym is open 24 hours."** |
| 4 | Now choose **Set opening times**. Under **Monday**, press **"Add a time"** and put in **06:00** to **07:00**. Press **"Add a time"** on Monday again and put in **16:00** to **21:00**. | Monday shows two rows. **This is the "many sessions in a day" you asked for.** Save is now pressable. |
| 5 | Under **Sunday**, press **"Add a time"** and put in **08:00** to **12:00**. Press **Save opening times**. | **"Saved."** The heading summary reads **"Your opening times are set for 2 days a week."** **Sunday is a day like any other** — it is open here because you said so. |
| 6 | Press **F5** and open the section again. | Monday still shows **06:00–07:00** and **16:00–21:00**; Sunday shows **08:00–12:00**; the other five days each say **"Closed"**. That word is now TRUE — this gym has answered. |
| 7 | On Monday, change the **first** row's closing time from **07:00** to **17:00** (so it runs over the 16:00 row). | A red line appears: **"Monday has two sessions that overlap: 06:00–17:00 and 16:00–21:00."** **Save goes grey.** Nothing was sent. |
| 8 | Put Monday's first closing time back to **07:00**. | The red line goes and **Save comes back**. |
| 9 | Press the **✕** beside Sunday's row, then **Save opening times**. | **"Saved."** Sunday now reads **"Closed"** and the summary says **1 day a week**. **This is how "we're closed every Sunday" is said** — there is no separate switch for it, on purpose. |
| 10 | Scroll to **"Closed on a date"**. Pick a date about a week from today, type **Holi** as the reason, and press **Mark closed**. | The date appears in a list underneath with **— Holi** after it, and an **Undo** beside it. |
| 11 | Press **Mark closed** again with the **same date** but the reason changed to **Staff training**. | The list still shows **ONE** row for that date, now reading **Staff training**. It did not stack a second row. |
| 12 | Now pick a date **in the past** (say last week), leave the reason empty, and press **Mark closed**. | **A sentence appears: "That date has already passed at your gym, so it's saved but not shown below."** The list does **not** grow. **This is correct, not a failure** — the save worked, and the list only shows dates still to come. Say if you see an error message instead. |
| 13 | Press **Undo** beside the Holi/Staff-training date. | It disappears from the list. |
| 14 | Put it back: **Mark closed** on **today's date**, reason **Holi**. | Today appears in the list. |
| 15 | In a **different browser** (or a private window), sign up as **account B** and type the join code from step 1. Back as **A**, go to **Members** and confirm B. | B is a member of the gym. |
| 16 | As **account B**, look at the main dashboard, at the card that says **"You're a member of <your gym>"**. | Under it: **"Closed today — Holi"**, then the week — **Mon 06:00–07:00, 16:00–21:00** and the other six days **Closed**. **The dated closure wins over Monday's normal hours** — that is the point of this step. |
| 17 | As **account A**, go back to **Settings → When we're open** and press **Undo** beside today's closure. Then, as **B**, press **F5** on the dashboard. | B's card no longer says "Closed today". It now shows today's normal line from the week. |

---

## What this sheet does NOT cover, stated so nothing is over-claimed

- **A gym with no plan.** Every control in this section greys out for a lapsed
  gym with the usual "This gym needs a plan…" sentence, exactly like the rest of
  Settings. That is covered by `smoke-read-only-console.md` and is not re-run
  here.
- **A manager rather than an owner.** The section is shown to whoever holds the
  gym-settings permission. An owner has it by default; giving it to a manager is
  the Staff screen's own smoke.
- **A member of a DIFFERENT gym.** The server refuses them, and that is proven by
  the automated tests rather than by a browser — it needs a third account to show
  nothing at all, which is not a useful thing to look at.
- **A gym in another time zone.** Every date on these screens is the gym's own,
  not your computer's. Proving that in a browser would mean changing your
  machine's clock; it is pinned by tests that run one gym at UTC+14 and another
  at UTC-12 at the same instant.
