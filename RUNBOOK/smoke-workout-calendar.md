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

- Date:
- Commit:
- Result:
