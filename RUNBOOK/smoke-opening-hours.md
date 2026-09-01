# SMOKE — a gym says when it's open, and its members can see it

**What this proves:** an owner can pick the clock their gym reads on, say it is
open 24 hours or set as many time slots per day as it runs, copy one day across
the whole week, and mark a single date closed with a reason — and a member of
that gym sees all of it on their own screen.

**Step 1 is the one that matters most, and it asserts that NOTHING appears.** A
gym that has never filled this in must not tell its members it is "Closed" — it
has simply not answered yet. Those two states look identical in the database, and
confusing them would have told every existing gym's members that their gym never
opens. If step 1 shows the word "Closed" anywhere, stop and say so.

**Time:** about 20 minutes (26 steps). **You need:** the API and the web app running
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

Then start the web app — `corepack pnpm --filter web dev` — and open
**http://localhost:5173**.

Your existing gyms will not be there — this is a different, local database, and
you need new accounts anyway.

**No pauses and no commands from the chat.** The whole sheet is yours to run
start to finish.

---

## The run

| # | Do this | Expect |
|---|---|---|
| 1 | Sign up as **account A**, create a gym (country **United States**), press **"Start your 30-day free trial"** on the pop-up. Copy the join code. Go to **Settings** and find **"When we're open"**. | Under the heading: **"You haven't said when your gym is open. Members aren't shown anything about opening times until you do."** **The word "Closed" must not appear anywhere on this screen.** This is the whole point of step 1 — an unanswered gym says nothing, it does not claim to be shut. |
| 2 | Click the **"When we're open"** heading to open it. | At the top, **"Which clock do you use?"** offering **12-hour** and **24-hour** — the names only, no sample times beside them — with **24-hour** already picked. Below it, **Open 24 hours** and **Set opening times** — neither ticked. No days listed. **Save is grey.** |
| 3 | Pick **12-hour**. | It ticks immediately. **There is no Save for this — it saves itself.** Everything on this screen, and on your members' screens, now reads on a 12-hour clock. |
| 4 | Choose **Open 24 hours**, then press **Save opening times**. | **"Saved."** Close and re-open the section (or press F5): the heading now reads **"Your gym is open 24 hours."** |
| 5 | Choose **Set opening times**. **Click the word "Monday"** to unfold that day. Press **"Add a time"**. | Each time is **three little boxes — `_ _ : _ _` and AM/PM** — all starting on `--`, **all on ONE line, all the same size**. **Nothing is typed.** |
| 5b | Set the first row to **6 : 00 AM** to **7 : 00 AM**, one box at a time. | **Each box keeps what you picked** — set the hour, and it stays while you go to the minute. The minute list steps in fives, so **:30 is there**. |
| 5c | Press **"Add a time"** on Monday again and set **4 : 00 PM** to **9 : 00 PM**. | Monday shows two rows. **This is "many sessions in a day".** Save is now pressable. |
| 5d | Go back to the top and pick **24-hour**, then look at Monday's rows again. | **The AM/PM boxes go** — they mean nothing on a 24-hour clock — **and the hour and minute boxes do not move or resize.** The times now read 06:00 and 16:00. Switch back to **12-hour** before carrying on. |
| 6 | Click **Sunday** to unfold it, press **"Add a time"**, set **8 : 00 AM** to **12 : 00 PM**. Press **Save opening times**. | **"Saved."** The summary reads **"Your opening times are set for 2 days a week."** **Sunday is open because you said so** — no weekday is special. |
| 7 | **THE FOLDING — watch this one.** Monday and Sunday are both unfolded. Now click **Wednesday**. | **Wednesday opens AND Monday and Sunday stay open.** Opening one day must never close another. |
| 8 | Now click **Monday** again. | **Only Monday folds.** Wednesday and Sunday are still open. Each folded row still shows that day's times, so the whole week is readable without opening anything. |
| 9 | Press **F5** and open the section again. | Every day is **folded**, and the rows read **Monday: 6:00 AM – 7:00 AM, 4:00 PM – 9:00 PM**, **Sunday: 8:00 AM – 12:00 PM**, and the other five **"No times set"** — **not "Closed"**, because on this form a day you have not filled in is not a day you have declared shut. One line above the list says a day with no times means you are closed. **Every time is on the 12-hour clock; 16:00 appears nowhere.** |
| 10 | Unfold **Monday** and change the **first** row's closing hour to **5** and AM/PM to **PM**. | A red line: **"Monday has two sessions that overlap: 6:00 AM – 5:00 PM and 4:00 PM – 9:00 PM."** **The refusal is on your clock too.** **Save goes grey.** Nothing was sent. |
| 11 | Put Monday's first closing back to **7 AM**. | The red line goes and **Save comes back**. |
| 12 | Unfold **Sunday**, press the **X** beside its row, then **Save opening times**. | **"Saved."** Sunday reads **"No times set"** and the summary says **1 day a week**. **This is how "we're closed every Sunday" is said** — there is no separate switch for it, on purpose. |
| 13 | **"SAME EVERY DAY".** Unfold **Monday** and press **"Use these times every day"**. Then press **Save opening times**. | **All seven rows now read Monday's two times** and nothing says "No times set". **"Saved."** |
| 14 | Unfold **Thursday**, change its opening hour to **7**, and press Save. | **Only Thursday changed.** That is "copy once, then fix one day by hand". |
| 15 | Unfold **Tuesday** and look at the buttons under its rows. | **"Add a time"** and **"Use these times every day"**. On a day with NO times that second button is deliberately absent — on an empty day it would wipe the whole week in one click. |
| 16 | Scroll to **"Closed on a date"** and **click the date box**. | **A calendar opens** — you do not type the date. |
| 17 | Pick a day about a week away, type **Holi** as the reason, press **Mark closed**. | The date appears in a list underneath with **Holi** after it, and an **Undo** beside it. |
| 18 | Press **Mark closed** again with the **same date** but the reason changed to **Staff training**. | The list still shows **ONE** row for that date, now reading **Staff training**. It did not stack a second row. |
| 19 | Now pick a date **in the past** (say last week), leave the reason empty, and press **Mark closed**. | **A sentence appears: "That date has already passed at your gym, so it's saved but not shown below."** The list does **not** grow. **This is correct, not a failure** — the save worked, and the list only shows dates still to come. Say if you see an error message instead. |
| 20 | Press **Undo** beside the Staff-training date, then **Mark closed** on **today's date**, reason **Holi**. | The first disappears; today appears in the list. |
| 21 | In a **different browser** (or a private window), sign up as **account B** and type the join code from step 1. Back as **A**, go to **Members** and confirm B. | B is a member of the gym. |
| 22 | As **account B**, look at the main dashboard, at the card that says **"You're a member of ..."**. | Under it: **"Closed today — Holi"**, then the week — **Mon 6:00 AM – 7:00 AM, 4:00 PM – 9:00 PM**, and so on. **Every time is on the 12-hour clock the OWNER picked at step 3** — one gym, one clock. And **the dated closure wins over Monday's normal hours**, which is the point of this step. |
| 23 | As **account A**, go back to **Settings → When we're open** and press **Undo** beside today's closure. Then, as **B**, press **F5** on the dashboard. | B's card no longer says "Closed today". It now shows today's normal line from the week. |

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
