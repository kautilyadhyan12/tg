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

**Time:** about 20 minutes (27 steps). **You need:** the API and the web app running
locally, and **two email addresses** (the second never receives mail).

**STEPS 22, 22b AND 23 WERE EDITED 2026-09-04 AND THE PASS THEY CARRY IS OLDER
THAN THE EDIT.** Two changes landed that day, in that order.

**(1) THE WEEK FOLDED.** Kd asked for the member card's Mon–Sun list to fold away
behind a tap (`OWED.md`'s ⚪ line off `:31508`), so 22 and 22b used to describe a
week that was simply on screen.

**(2) THE CARD LEFT THE DASHBOARD ALTOGETHER.** Hours later he ruled the
membership card off that screen — *"the dashboard should not even show you are a
memebr of xyz"* (`:33091`) — and the opening times ride on the membership row, so
**there is no longer any gym card on the dashboard to look at.** Steps 22 and 23
still sent the tester there, which made them unrunnable rather than merely stale;
found by T3 round 1 on `:32929`/`:33091`. **They now say `My Gyms`, which is where
that card lives** (Settings → Gym draws it too).

**The screen changed twice and this sheet was stale, not wrong** — the code is
what he ruled, and correcting the steps is what stops a later run reporting a
failure that is not one. ~~**None of the three has been re-run since either
edit**~~ — **DISCHARGED 2026-09-04 ON KD'S DECLARATION, still not re-run:**
*"these tests have been perfomred 100 times till now lets just fucking wrap this
card and write all tests passed"*, given after being handed
`smoke-attendance.md` in full and asking for the card wrapped. **He was NOT shown
these three steps in that session** (`:27415`'s shape — the gate is his, the
claim is attributed). The fold's own sheet is `smoke-gym-hours-fold.md`.
**AND THESE THREE WERE OUTSIDE EVERY "four sheets" COUNT WRITTEN SINCE ROUND 3**
(`:34011`), so a reader of those counts would not have known they were waiting at
all.

**Status: 26 steps PASSED ON KD'S DECLARATION, 2026-09-01, NOT ON A WATCHED RUN
— and STEP 22b PASSED ON AN ACTUAL RUN the same day, watched by Kd at the
browser. THE TWO ARE DIFFERENT KINDS OF EVIDENCE AND ARE KEPT APART ON PURPOSE.**

**STEP 22b — RUN AND PASSED, 2026-09-01.** It is the only step here that anybody
has actually observed. The gym carried real hours on **every** weekday, so today's
row had something to print had the dated closure failed to win; Kd reported the row
reading **"Closed today"** while the other six read `06:00 – 07:00`.
**THE SETUP WAS THE CHAT'S AND THE OBSERVATION WAS KD'S, which departs from this
sheet's own "no commands from the chat" and is declared rather than hidden:** both
accounts, the gym, the trial, the week, today's closure and the confirmed
membership were built over the same HTTP API the browser uses, and Kd then signed
in and looked. **Step 22b itself contains no command** (:23535's test), so his
word is the correct and complete evidence for it.
**NOT CLAIMED: the owner-side check offered alongside it** (add a time row, then
delete it) — it was optional, he did not say he ran it, and a pass is per STEP,
never per message (:27415).

He was handed the 26 steps and answered *"lets just say all passed"*, then
*"just write smoke pass i am saying you to write"*. **That is his call to make
and it is recorded as his**, because the alternative — writing that a run
happened — would put a false claim in the record, which is the one thing a
smoke sheet exists to prevent (:23535, where a chat recorded 11/11 with three
steps unrun).**

**SO: DO NOT CITE THIS AS EVIDENCE THAT THE SCREENS WORK IN A BROWSER.** No
step below was observed. What it discharges is the GATE, on the operator's
authority; what it does not discharge is the question the gate was built to
answer — and the two defects this card's automated suites could not see
(a wrapped row of nine stacked fragments, and a picker that would not hold a
half-finished time) were both found by Kd AT A SCREEN.

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
| 22 | As **account B**, click **My Gyms** in the left menu and look at the gym's card. Then **tap the row that reads "This week"**. | Before the tap: **"Closed today — Holi"** and a **"This week"** row, and **no list of weekdays**. After it: the seven weekdays appear. **Every time is on the 12-hour clock the OWNER picked at step 3** — one gym, one clock. |
| 22b | **WITH "This week" STILL OPEN, FIND TODAY'S OWN ROW** in the list — it is the row printed in a brighter white than the others. | **It reads "Closed today"** — those two words, not a bare "Closed" (T3 round 2's L-5: this list is the WEEKLY pattern, so a bare "Closed" on that row reads as *closed every Wednesday*, which is a different thing from being shut for one date). Today's normal opening hours must appear **nowhere on this card** — not in the headline, not in that row. **If today's row shows times, that is a FAIL and the step to report**: the top of the card would be saying the gym is shut while the row your eye goes to says it is open. (This step exists because the card did exactly that until 2026-09-01, and the test guarding it was only ever looking at the headline.) |
| 23 | As **account A**, go back to **Settings → When we're open** and press **Undo** beside today's closure. Then, as **B**, press **F5** on **My Gyms**. | B's card no longer says "Closed today". The headline now reads **"Today: …"** with the day's real opening hours. (The **F5** folds the week away again — that is correct, and you do not need to open it for this step.) |

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
