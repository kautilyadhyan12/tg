# SMOKE — workout calendar on the new API (P2.8 web repoint card)

Kd runs this in a real browser. The unit + render suites go through vitest and
`fastify.inject`, which bypass the browser entirely — the Card-4 CORS bug
(browser DELETE/PATCH/PUT dead app-wide) got through 250+ green tests for
exactly that reason.

**Screen:** `/progress` → scroll to the **Workout History** calendar
(`Progress.jsx:373`).

## Setup — two terminals, one command each

Terminal 1 — the API:

```
node --import tsx --env-file=.env src/index.ts
```
(run from `apps/api`)

Terminal 2 — the web app:

```
corepack pnpm --filter web exec vite
```

Then open the printed URL and log in with an account that **has at least one
completed workout**. The calendar reads `GET /v1/workouts`, so a brand-new
account shows an honest empty month and step 1 cannot be judged on it.

⚠️ **EXPECT OLDER MONTHS TO LOOK EMPTIER THAN THE OLD APP, AND DO NOT REPORT IT
AS A FAILURE.** Workouts only began reaching the new API on **2026-08-02**, when
the web write path shipped (OWED, ticked that day). Anything trained before then
exists in the old backend alone, so it cannot appear here. Judge every step
below on workouts done on or after that date.

---

## Step 1 — THE CONTROL. Run this first; it is the step that matters most.

This card replaces confident zeros with an em dash (`—`). The one outcome it
must NOT have is dashing out numbers the backend really sent. No later step can
see that — only this one.

Open `/progress` and look at the calendar for a month you trained in.

Pick a day you trained **with the camera** for this step — a camera-graded
workout is the one that has all three numbers. (Hand-counted days are step 8.)

✅ **Expect:** the days you trained are highlighted orange, with a dot. The line
underneath reads *"N active days this month"* with a real N. Click a highlighted
day: the panel shows **Duration**, **Calories** and **Form** as real numbers
(e.g. `35m`, `210`, `88%`) — **no em dashes on a workout that has these values**.

❌ **Fail if:** a day you know you trained is not highlighted, or a stat that
should have a value shows `—`.

## Step 2 — the day panel names your exercises

With the day panel still open from step 1.

✅ **Expect:** an **Exercises · N total** line with chips naming the exercises
(e.g. `Barbell Squat`). Up to five chips, then a `+N more` chip if there were
more.

⚠️ **Known and recorded:** the names come from the workout's exercise *slug*
title-cased, because the new API carries no display names yet (that is the
exercise-content card on `OWED.md`). `barbell_squat` reads as `Barbell Squat`.
If a name looks machine-ish rather than wrong, that is this limitation, not a
defect.

## Step 3 — the time is the START time

✅ **Expect:** each session line reads **"Started HH:MM"**.

⚠️ **Declared change:** the old backend sent the *finish* time; the new schema
stores only `startedAt`, so the displayed time moves earlier by the length of
the workout. It is labelled "Started" so the reading is unambiguous rather than
silently shifted. Not a defect — confirm the label is there.

## Step 4 — a failed read must not look like an empty month

This is the defect the card exists to remove: the old code caught the error,
left the data empty, and drew a blank grid captioned *"0 active days this
month"* — a confident claim about days you may well have trained.

1. Open devtools → **Network** tab **before** doing anything (a panel opened
   afterwards shows "Currently recording…" and has captured nothing — the
   method note from the timezone card).
2. Right-click the `workouts` request → **Block request URL**.
3. Reload `/progress`.

✅ **Expect:** the grid area shows **"Couldn't load your workout history."** and
a **Try again** button. The summary line reads **"Active days this month
unavailable"** — **not** "0 active days this month".

❌ **Fail if:** you see a blank calendar with a zero count, or no message at all.

## Step 5 — Try again recovers

With the block still on, click **Try again** → it should fail again the same
way. Now remove the block (Network → Blocked URLs) and click **Try again**.

✅ **Expect:** the calendar loads normally, exactly as in step 1.

## Step 6 — a failed detail read does not imply "no exercises"

1. Re-block, this time the `workouts/<id>` request (the detail call).
2. Click a highlighted day.

✅ **Expect:** the stats still show, and under them
**"Couldn't load this workout's exercises."**

❌ **Fail if:** the exercises section is simply absent — that would read as
"this workout had no exercises", which is a different claim.

## Step 7 — the plan window (free accounts only)

On a **free** account, page back with `‹` to a month more than 90 days ago.

✅ **Expect:** a line reading *"Your plan shows the last 90 days, so this month
isn't shown. **Older workouts are still saved.**"*

❌ **Fail if:** you get a silent blank month — that is the lie this notice
exists to remove. The window is a read gate, never deletion (`seed.ts:44`);
copy that implied data loss would be its own falsehood.

⚠️ On a paid/unlimited account this notice must **never** appear. If it does,
that is a defect.

## Step 8 — a HAND-COUNTED workout: the dash is CORRECT here, the numbers are not

Added 2026-08-04. This screen was built on 2026-08-01, one day **before**
hand-counted workouts could reach the new API at all, so no earlier version of
this smoke could describe what one looks like.

If you have no hand-counted day on or after 2026-08-02, make one first: start a
workout, choose to count your own reps, tap out a few, and finish it. Then
reload `/progress`.

Click that day.

✅ **Expect: exactly one dash.** **Duration** and **Calories** show real numbers.
**Form** shows `—`, and the small target icon above it is **grey**.

That is the honest reading: nothing measured your form, because you counted the
reps yourself. There is no score to show and the app does not invent one.

❌ **Fail if any of these:**

| What you see | Why it's wrong |
|---|---|
| **Form shows `0%`** | Claims you scored zero. You weren't scored at all. |
| The Form icon is **red** | Red means "you did badly". "Not measured" must not look like that. |
| **Duration or Calories also show `—`** | Those two are real and the server sent them. This is the defect the card exists to remove, pointing the other way. |
| The exercises you tapped out aren't listed | The exercise names should appear whoever counted the reps. |

---

## NOT browser-reachable, and stated rather than skipped

**A workout with unknown Duration or Calories.** These render `—` instead of
`0m` / `0`, covered by `workoutCalendar.render.test.jsx` ("renders the em dash
for every unknown stat") plus mutation M1–M3. It needs a synced workout with
null `durationMs` / `kcalPoint`, which the normal sync path does not produce on
demand. Not claimed as smoked.

**CORRECTED 2026-08-04:** this paragraph previously bracketed **Form** with those
two as un-reachable. That has been false since the web write path shipped on
2026-08-02 — a hand-counted workout produces a null form score through the
ordinary path, on demand, which is exactly what **step 8** now walks. The claim
was true when written and was not re-checked; recorded rather than quietly
edited, per the verification doctrine.

**The 10-page walk cap** (`truncated`) needs 1,000+ workouts on one account.
Covered by unit test + mutation M10 only.

---

## RESULT

_Kd records the outcome here — per step, or as an explicit blanket pass. A
record must not claim more resolution than the report it came from._

- Date: **2026-08-04**
- Commit: **`5133114`** (steps 1–4 re-run on these bytes; the first attempt was
  on `1b025ed` and FAILED — see below)
- Result: **PASS, all 8 steps — after one round-1 failure that was fixed.**

**ROUND 1 FAILED on the durations, and that is the record that matters.**
On `1b025ed` the four sessions on screen read `0m` / `0m` / `1m` / `1m`. The
stored `duration_ms` values were 8491 / 4767 / 36290 / 37681 — read out of the
workouts table, not off the screen — so two workouts were displayed as taking
no time at all and two were rounded UP past a minute they never reached. Cause
and fix at DECISIONS :4182: the old backend sent whole MINUTES, so rounding was
right for the field being replaced and wrong for milliseconds, and every fixture
in the suite used 1,800,000 ms so no test could see it.

**ROUND 2 (on `5133114`) PASSED.** Kd confirmed the same four sessions now read
`8s` / `5s` / `36s` / `38s`.

Resolution of the report, stated rather than inflated: steps **5**, **6** and
**7+8** were each reported as "all passed" against the numbered expectations
above, and the durations were confirmed explicitly when asked a third time.
Steps 1–4's other content — 83%/84% in green on camera workouts, `—` in the
NEUTRAL tint on hand-counted ones, the Push Up / Squat chips, and the MIXED
camera+hand workout rendering as ONE session — was additionally verified from
Kd's three screenshots and cross-checked against the database.

**What this does NOT discharge:** the fresh-chat T3. The OWED line stays
unticked until that comes back clean.

---

# ADDENDUM — the DATE WINDOW (card 2, the web half), 2026-08-04

The calendar now **asks the API for the month**. It used to ask for your latest
100 workouts, then the next 100, up to ten times, hoping to bump into the month
on the way — which is why a long-time user's older months came back blank.

**Read this before running it:** the headline fix is **not smoke-reachable on
Kd's account**. Seeing an old month go from blank to populated needs 1,000+
workouts logged since that month; no fixture account is near that. What these
steps CAN prove is that the app really sends the month, sends the right one, and
that nothing on the screen regressed. Steps 1–8 above still stand and are worth
a quick re-run on the same account.

## Step A — ONE request, carrying THIS month

Open devtools → **Network** tab **before** loading the page (a panel opened
afterwards shows "Currently recording…" and has captured nothing — recorded on
the timezone card). Then open `/progress`.

Filter the network list for `workouts`.

✅ **Expect:** exactly **ONE** `/v1/workouts?...` request for the calendar, and
its query string carries **`from`** and **`to`**. Click the request → Headers →
Query String Parameters. `from` is the **1st of the month on screen**, `to` is
the **1st of the NEXT month**.

❌ **Fail if:** there is no `from`/`to` at all (the window never reached the
wire), or there are several `/v1/workouts` requests in a row with cursors (the
old page-walk).

⚠️ Ignore `/v1/workouts/<id>` requests — those are the exercise chips for a day
panel and are a different, expected thing.

## Step B — stepping months moves the window

Click the **‹** arrow to go back a month.

✅ **Expect:** one new request, whose `from`/`to` are the **previous** month's
1st and this month's 1st. The grid redraws for that month.

❌ **Fail if:** the request repeats the old month's dates, or no request is made
at all.

## Step C — the times are YOUR midnight, not UTC

Still on the request from step A or B.

✅ **Expect:** because India is +05:30, `from` reads as the **previous day at
18:30 UTC** — e.g. for August it is `2026-07-31T18:30:00.000Z`, not
`2026-08-01T00:00:00.000Z`. That is correct and is the whole point: the month
sent is *your* calendar month, not Greenwich's.

❌ **Fail if:** it reads exactly `…-01T00:00:00.000Z`. That is the UTC month, and
it silently drops a workout from each end of every month.

## Step D — nothing else moved

✅ **Expect:** the day squares, the day-detail panel (duration, calories, form,
exercise chips), the plan-limit sentence and the "couldn't load" state all
behave exactly as they did in steps 1–8 above.

## NOT REACHABLE, and stated rather than implied

- **The blank-old-month fix itself** — needs 1,000+ workouts logged after the
  month being viewed.
- **The truncation caption** ("this month has more than a thousand workouts") —
  needs 1,000+ workouts in a single month. Unit test + mutation only.
- **Its sibling** ("this month couldn't be read all the way through") — added by
  the T3's F3. It appears when the read stops short WITHOUT having seen a
  thousand of this month's workouts, which needs a server that accepts the date
  window and then answers with the wrong month. Not producible against a correct
  API. Unit test + mutation only.

Neither is a gap in this card; both are facts about the fixture account. "The
operator's account cannot reach it" is a fact about a smoke test, never a fact
about users (Kd's correction, DECISIONS :4355).

## RESULT — addendum

- Date: **2026-08-05**
- Commit: **`6bdd4aa`** (the T3 round-1 fixes, i.e. the current bytes — not the
  card's first cut, so no step needed re-running on changed code)
- Result: **PASS — Kd reported "all passed" against steps A–D.**

**What that report resolves, stated rather than inflated** (the :4239
precedent): steps A–D were numbered with an explicit ✅-expectation and an
explicit ❌-fail condition each, including step C naming the exact wrong string
(`2026-08-01T00:00:00.000Z`) that a UTC conversion would produce. The reply was
a single blanket pass against those four. **I did not independently read the
`from`/`to` values out of Kd's browser** — the browser is his instrument here,
and this is a report, not a measurement I took. What IS measured on my side is
that the same window is asserted by unit and render tests and that deleting it,
or building it from `Date.UTC`, or dropping it between the screen and the
client, each turns those tests red (M30/M31/M36).

**Still not discharged by this:** T3 round 2, the cap. The 🔴 OWED line stays
open until that comes back clean.
