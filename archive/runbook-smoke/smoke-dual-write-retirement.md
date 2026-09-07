# SMOKE — the old backend is out of the workout loop

**What changed, in one line:** a finished workout is now saved ONCE, to the new
API, and starting a workout no longer asks any server for permission.

**Why this sheet exists.** The tests run in a fake browser with every network
call mocked, so they cannot see a real server, a real cookie, or a real
redirect. Every user-visible defect this project has recorded on the workout
screens was found by a browser or by a mutant, never by reading code. These
steps change what happens at the end of EVERY workout, so they get a human.

---

## Before you start

Two servers, two terminals, from the repo root.

**Terminal 1 — the API**
```
cd apps/api && node --import tsx --env-file=.env src/index.ts
```
Wait for it to say it is listening on port 3000.

**Terminal 2 — the web app**
```
cd apps/web && npx vite
```
Open the URL it prints — it must be **http://localhost:5173** exactly. If a
leftover `vite` already holds 5173 this one takes 5174, where sign-in silently
fails because the API allows one exact origin. Close the old one first.

**DO NOT START THE THIRD SERVER.** `mock-ml-backend.mjs` on port 8000 stands in
for the old backend. Every previous workout smoke needed it, because you could
not start a workout without it. **Its absence is what this sheet is testing.**

---

## The steps

### 1 — a workout starts with no old backend at all
Build a workout (any exercise), go to the setup screen, choose **"I'll count my
own reps"**, and press Start.

✅ **Expect:** the workout screen opens.

❌ **If you see the red toast "Failed to start workout":** stop here and say so.
That is the exact defect this card removes, and its presence means the change
did not take.

### 2 — finish it
Tap out a few reps and finish the workout (complete the last set, or use Skip
Exercise on the last exercise).

✅ **Expect:** the "workout complete" screen, then the summary screen after a
couple of seconds.

### 3 — THE IMPORTANT ONE: the numbers on the summary are real
Look at the four tiles on the summary screen.

✅ **Expect:** Workout Time shows a real duration (not `0m`, not `—`), Calories
shows a number, Exercises shows the count you did, and Avg Form shows either a
percentage or **"Not scored"** if you counted the reps yourself.

❌ **If you see zeros across the board**, that is the failure this card was most
at risk of — say so and stop.

### 4 — THE SHARPEST ONE: the XP is real
On the same screen, find the XP figure.

✅ **Expect:** a number, and it is **at least 50**. The parts that make it up:
50 for finishing · +10 if this was your first workout of the day and it
continued a streak · +20 or +50 for a good form score, which only a
camera-graded workout can earn. So 50, 60, 70, 80, 100 and 110 are all correct
answers depending on what you did — the check is that it is 50 or more.

❌ **If it says +0, or a dash, or nothing at all:** stop and say so.

> **Why this step exists.** Until today the old backend was what worked that
> number out. Dropping the second save before this screen had a new source
> would have printed a believable "+50 XP" that nobody was actually awarded —
> a screen that looks true and is false. This step is the check that it did not.

### 5 — the workout reached the Dashboard
Go to the Dashboard.

✅ **Expect:** Total Workouts has gone up by one, and This week has gone up by
one. The workout you just did is in Recent Workouts.

### 6 — and the calendar
Go to Progress → the calendar.

✅ **Expect:** today is marked as active, and clicking it shows the workout with
its exercises.

### 7 — the builder is empty afterwards
Go to the workout builder (Exercises → build a workout).

✅ **Expect:** it is EMPTY — it does not still contain the workout you just
finished.

> This one is a genuine change, not a check of something that already worked.
> The tidy-up used to run only if the old save succeeded, and on this branch that
> save has not succeeded in weeks — so the builder kept your last workout.

### 8 — nothing in the workout itself spoke to port 8000
Build one more short workout and get as far as the setup screen — the one with
the checklist and the Start button. **Now** open the browser tools (F12) →
**Network** tab → type `8000` in the filter box → press the 🚫 "clear" button so
the list is empty. Then press Start, do the workout, and stop when the summary
screen appears.

✅ **Expect:** **zero rows.** Not failed rows — no rows at all.

❌ **If you see rows against `:8000`:** something still calls the old backend on
the workout path. Copy the row names into the chat.

> **Clear the list first, and only watch Start → summary.** Three screens
> OUTSIDE the workout — the Dashboard's badges strip, Achievements, and the
> predictions box on Progress — do still talk to port 8000, and they are
> supposed to for now (each has its own line in `OWED.md`). If you leave the
> filter running while you visit those, you will see rows that have nothing to
> do with this change. Same if you open the **Templates** button in the builder.

### 9 — a workout starts while OFFLINE
Build a workout and get to the setup screen **first, while you are still
online** — the exercise list itself comes from the server, so building offline
is a different missing feature and not what this step is about. Choose **"I'll
count my own reps"**.

Now, on that setup screen, open the Network tab and set the throttling dropdown
to **Offline**. Press Start.

✅ **Expect:** it starts.

Do a few reps, then set the dropdown back to **No throttling** before you
finish, and give it a few seconds after the summary appears.

✅ **Expect:** the summary screen fills in with real numbers. (If it briefly
says it is saving your workout, that is correct — it is waiting for the workout
to reach the server.)

> **What this step is for.** The product promises "your workout still counts"
> when you have no signal. The saving half of that has worked for a while; the
> STARTING half has never worked, because starting needed the old server. This
> is the first time the whole promise is true.

---

## When you are done

Tell me the step number and pass/fail for each. If anything failed, the exact
words on the screen matter more than a description of them — the wording is
usually what identifies which branch the code took.

---

## RESULT — PASSED 9/9, 2026-08-16

Kd ran every step in his own browser against a locally-started API (:3000) and
web (:5173), **with no old backend on :8000 at any point**. Reported "all
passed" in two batches (steps 1–7, then 8–9).

**This is a REPORT, not a measurement** (:4829) — the browser is Kd's
instrument and I did not read the values out of it. What follows is the part
that IS measured, and it is the stored row, per :7929's lesson that for
anything a screen only claims, the row has to carry it:

```
workout   duration_ms 48000   kcal_calc_version 2   avg_form_score NULL
set 1     reps 6   duration_ms 44615   mode log_only   watched_ms NULL
set 2     reps 6   duration_ms  4200   mode log_only   watched_ms NULL
```

**What the row proves independently of the report:** the workout reached the NEW
API and nothing else — one workout, two sets, both `log_only` (he chose to count
his own reps), `avg_form_score` NULL rather than a fabricated score, and a real
duration. `kcal_calc_version 2` is correct for this payload, not a regression:
v3 is selected by `watchedMs`, which a hand-counted set pins NULL by design
(:7730).

**WHAT THE SMOKE DID NOT AND COULD NOT CHECK**, said rather than glossed:
step 8 proves nothing reached :8000 *during the workout loop*; the Dashboard,
Achievements and Progress screens still call it by design and were excluded from
the filter window on purpose. And step 9's offline arm exercises the
hand-counted path only — the pose model's CDN download is the other half of Part
6 §3.6 and is still open.

**A DEFECT FOUND BY KD'S QUESTION, NOT BY THE SHEET** (:7222's shape, again):
he accepted every step and then asked why 12 squats burned 65 kcal. Traced to
his stored `users.weight_kg = 787.00` — the formula is correct and its INPUT is
not, since `kcal = MET × weight × hours` (6.0 × 787 × 0.01356 h = 64.0, +rest =
65). At a plausible weight the same workout prices at ~6 kcal. Not caused by
this card and not in its diff; the validation gap it exposes has its own
`OWED.md` line.
