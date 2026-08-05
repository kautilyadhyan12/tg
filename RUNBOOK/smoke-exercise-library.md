# SMOKE — the exercise library on the new API (P2.8 web repoint card)

Kd runs this in a real browser. The unit + render suites go through vitest and
`fastify.inject`, which bypass the browser entirely — the Card-4 CORS bug
(browser DELETE/PATCH/PUT dead app-wide) got through 250+ green tests for
exactly that reason.

**Screen:** the **Exercises** page (`/exercises`).

## RESULT — RUN 2026-08-05 (Kd), on `b96c009`: **ALL 9 STEPS PASS.**

**Recorded as Kd's REPORT, not as my measurement** (the :4829 precedent — the
browser is his instrument and I did not read these values out of it).

**No application code changed during the run.** `git status` across the whole
smoke shows one modified file, THIS one. So the pass certifies `b96c009`'s bytes,
and the two first-run failures were the DOCUMENT's defects, not the card's:

| step | run 1 (2 terminals) | run 2 (3 terminals, reload first) | why run 1 failed |
|------|---------------------|------------------------------------|------------------|
| 1, 2 | pass | pass | — |
| 3 | could not find Chair Squats (detail panel itself correct) | pass | see below |
| 4, 5 | pass | pass | — |
| 6 | **FAIL** — Chair Squats / Bicep Curls not found | pass | stale filters |
| 7 | doubted 58 were present | pass | stale filters |
| 8 | **FAIL** — "Failed to start workout" | pass | missing 3rd server |
| 9 | not run | pass | — |

**Run 1's step 8 was a SETUP defect in this document, now fixed above.** The doc
listed two terminals; starting a workout still calls the OLD backend
(`workoutApi.createSession`), whose stand-in was not running — and that stand-in
boots `dead` by design, so merely starting it is not enough. Verified directly
once running and switched to `healthy`:
`POST :8000/api/workouts → 200 {"session":{"id":"smoke-1785929178432"}}`.

**Run 1's steps 6–7 were step 5's filters left switched on**, also now fixed
above. Evidence gathered before re-running, not after: the live DB holds
`{ total: 58, live: 58 }` including `bicep_curl` and `chair_squat`, and sorted the
way the screen sorts them **Bicep Curls is #3 and Chair Squats is #11 of 58** —
both on the first page of 20, so neither was ever missing. Step 5 ends with a
category pill AND `advanced` selected; only 4 of 58 exercises are advanced and
both of step 6's exercises are `beginner`. **The trap worth keeping:** the
**Clear filters** button renders ONLY in the `filtered.length === 0` arm
(`ExerciseLibrary.jsx:572-587`), so a filter combination that leaves even one
card on screen offers no reset control at all — "clear all filters" was an
instruction with no button behind it.

**Not a defect, and named here so a future run does not report it as one:** the
post-workout summary's numbers are the stand-in rig's canned payload, identical
for every workout (existing OWED line, precedent DECISIONS :4081). And a finished
workout may only reach the calendar after a reload — the sync queue flushes at
next app load, which is the standing lesson at DECISIONS :3819.

## Setup — THREE terminals, one command each

**Step 8 starts a workout, and "start workout" still calls the OLD backend**
(`workoutApi.createSession` → `mlApi` → `VITE_ML_API_URL`, an owed leftover the
PreWorkout/ActiveWorkout repoint card owns). Without terminal 3 below, step 8
fails with "Failed to start workout" and the failure says nothing about this
card. Measured 2026-08-05, mid-smoke: the doc listed only two terminals and Kd's
step 8 failed for exactly this reason.

Terminal 1 — the API:

```
node --import tsx --env-file=.env src/index.ts
```
(run from `apps/api`)

Terminal 2 — the old-backend stand-in:

```
node apps/web/tools/mock-ml-backend.mjs
```
**It boots in the `dead` state on purpose.** Switch it before smoking by opening
<http://localhost:8000/__state/healthy> in a browser tab; confirm with
<http://localhost:8000/__state>.

Terminal 3 — the web app:

```
corepack pnpm --filter web exec vite
```

Then open the printed URL and log in. **Any account works** — the exercise
library is the same for everyone and needs no workout history.

⚠️ **Do not run the mutation harness while doing this.** It rewrites the very
files the dev server is serving, so you would be judging code nobody intends to
ship. (`apps/web/tools/mutate-exercise-library.sh` now refuses to start while
port 5173 or 3000 is listening, but the rule is worth knowing.)

---

## Step 1 — THE CONTROL. Run this first; it is the step that matters most.

Before this card, this screen was **broken**: it asked the old backend, which
has had no login token since the cookie switch, so it failed and bounced you to
the login page. The single most important thing to establish is that it now
loads at all.

Open **Exercises** from the sidebar.

✅ **Expected:** the page loads and shows a grid of exercise cards with photos.
❌ **Fail it if:** you land on the login screen, or you see the message
**"Couldn't load the exercises"**, or the grid stays as grey loading blocks.

---

## Step 2 — the headline count

Look at the big number at the top of the page.

✅ **Expected:** it reads **58 Exercises**.

Two specific wrong answers, both worth catching:
❌ **"56 Exercises"** — the old app hid Mountain Pose and Brisk Walking. They are
supposed to appear now.
❌ **"0 Exercises"** flashing before the real number — the count must never be
stated before it is known.

---

## Step 3 — the words are really there

Scroll the grid and pick any card, e.g. **Chair Squats**.

✅ **Expected on the card:** a proper name (not `chair_squat`), a photo, a
difficulty tag ("beginner"), a category, muscle chips, a calories-per-minute
figure, and either a rep count or a duration.
❌ **Fail it if:** any card shows a name like `chair_squat` or `Chair Squat`,
or shows the word "null", or a blank where a number should be.

Now **click the card** to open the detail panel on the right.

✅ **Expected:** a big photo, moving demo GIFs, an "About" paragraph, a numbered
**"How to do it"** list, a **"Common Mistakes"** list, and Primary/Secondary
muscles.
❌ **Fail it if:** any of those sections is missing or empty. Those words are the
whole point of the card.

---

## Step 4 — search

Type **squat** into the search box.

✅ **Expected:** the list narrows immediately as you type — Squats, Jump Squats,
Chair Squats, Bulgarian Split Squat and so on. It should feel instant, with no
loading flicker at all (the whole library is already in your browser).

Now type **zzzz**.

✅ **Expected:** "No exercises found" and a **Clear filters** button. Click it and
everything comes back.

Now search for a muscle instead of a name — type **hamstrings**.

✅ **Expected:** exercises that work the hamstrings come back. Searching by
muscle is a feature the old screen's placeholder promises.

---

## Step 5 — the category pills and the difficulty filter

Tap the **Yoga** pill.

✅ **Expected:** only yoga exercises, and the line above the grid says something
like "10 exercises in Yoga".

Tap **Upper Body**.

✅ **Expected:** Push-ups appear. This one is deliberate: Push-ups are filed
under Strength Training as their *main* category but are also tagged Upper Body,
and the old server matched both. If Push-ups are missing here, say so.

Now tap **Filters** and choose **advanced**, with a category still selected.

✅ **Expected:** the two filters combine — you get advanced exercises *within*
that category, not one filter quietly cancelling the other.

---

## Step 6 — the AI badge tells the truth

**Reload the page first (F5).** Step 5 leaves a category pill AND difficulty
`advanced` switched on, and only 4 of the 58 exercises are advanced — both
exercises below are `beginner`, so leaving those filters on hides them and this
step fails for a reason that has nothing to do with the badge. The **Clear
filters** button appears ONLY when nothing at all matches, so with one card still
on screen there is no button to press; a reload is the reliable reset. (Measured
2026-08-05: this is the most likely cause of Kd's step-6 fail on the first run.)

Now find **Chair Squats** and **Bicep Curls** — type each name in the search box
rather than hunting the grid.

✅ **Expected:** Chair Squats has a purple **AI** badge. **Bicep Curls does
not.**

This is the pair that matters. The old data claimed AI form-checking on eight
exercises; the camera can actually grade three (Squats, Jump Squats, Chair
Squats). Bicep Curls was one of the five making a promise the app cannot keep.
❌ **Fail it if:** Bicep Curls (or Plank, or Downward Dog) still carries the
badge, or if Chair Squats has lost it.

---

## Step 7 — "Load more"

Clear the search. Count roughly how many cards are on screen, then scroll to the
bottom and click **Load more**.

✅ **Expected:** about 20 more cards appear, instantly, and the button
disappears once all 58 are shown.

---

## Step 8 — THE ONE THAT PROTECTS YOUR WORKOUTS

This is the step that would catch the worst possible bug in this card, so please
do not skip it.

1. Click any exercise — **Push-ups** is a good one — and click **Add to
   Workout**.
2. The orange **My Workout** button appears at the bottom right. Click it.
3. Start the workout and count a set by hand (no camera needed).
4. Finish the workout.
5. Go to **Progress** and open the calendar day you just trained.

✅ **Expected:** the workout is there, and its exercise chip reads **Push-ups**.

❌ **Fail it if:** the workout does not appear at all, or you get a message about
the workout not being saved.

Why this step exists: the library hands the exercise's *name* to the workout
builder, and that exact name is what the app turns back into an identifier when
it saves. If the name were "tidied" anywhere along the way, the workout would
silently refuse to sync. A test pins this, but the test cannot see the browser.

---

## Step 9 — the calendar's exercise names

While you are on **Progress**, open any older day that has a workout.

✅ **Expected:** the exercise chips read real names — **Push-ups**, **Squats** —
not **Push Up** or **Squat**.

This is a second owed item this card closes. If they still read the machine-ish
version, say so.

---

## Report back

Please reply with the step number and pass/fail for each, e.g. "1 pass, 2 pass,
3 fail — no Common Mistakes section". If a step fails, a screenshot helps more
than a description.
