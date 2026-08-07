# SMOKE — the CAMERA path

Covers **two** cards at once, because both are unsmoked on camera and both live
on the same screen:

1. **Real workout time + calories v2** (DECISIONS :5906) — standing still must
   not be billed as exercise, and a pause must not be billed at all.
2. **Kd's ruling: the app never switches a camera set to hand counting**
   (DECISIONS :6008) — stepping out of frame must not take the set away.

Branch `web-repoint`. **Neither card ticks until this passes.**

Written 2026-08-07 after Kd asked "there was no checking for camera, we only
tested the hand counted one?" — he was right, and the omission was mine.
Extended the same day to cover the ruling, which the first version could not
have tested because it predates it.

## RESULT — not yet run

## Why this smoke exists, in plain words

**The calorie rule only applies to camera sets.** Reps at the full exercise
rate, standing around at a low rate, paused time at nothing — a hand-counted set
has no rep timings, so it can't use the rule at all. The first smoke pressed
"+1 Rep" the whole way through, so it tested the one path the headline feature
does not apply to.

**And the ruling has never been near a browser.** Until today, five seconds
without a clear view of you looked exactly like a dead camera to the app, so
**stepping out of shot handed the set to hand counting permanently and threw
away its form score.** Now it just stops counting until you step back. Step 4
and step 5 are the whole ruling, and they are the most important steps here.

**Only 3 of 58 exercises are camera-graded**: **Squats**, **Jump Squats**,
**Chair Squats**. Use **Squats**.

---

## Setup — three servers, and the rig must be switched on

Three terminals, from the repo root. (Say the word and I'll start all three for
you.)

**1. The old-backend stand-in.** It boots `dead` **by design**, so starting it
is not enough:

```
node apps/web/tools/mock-ml-backend.mjs
```

Then in a browser tab, **before anything else**, open:

```
http://localhost:8000/__state/healthy
```

Confirm at `http://localhost:8000/__state` that it says `healthy`. If it says
`dead`, no workout can be started at all.

**2. The new API:**

```
cd apps/api && node --import tsx --env-file=.env src/index.ts
```

**3. The web app:**

```
cd apps/web && corepack pnpm exec vite
```

Log in at `http://localhost:5173`.

### Read this before you start

- **The camera must see your whole body, legs included**, or the app says it
  can't see your legs and refuses to count. Step well back from the laptop.
- **⚠️ Restart the API server after any api-side edit — it does not reload
  itself.** That cost a whole round on 2026-08-07.
- **Kd opens no devtools on this run.** Step 9 used to ask him to read the sync
  payload out of the Network panel; the same facts are all readable in the
  stored row, so the chat checks them afterwards instead. A step a beginner
  cannot run reliably is a step that produces an unreliable result.
- Don't run any mutation harness, `git stash`, or anything else that moves the
  working tree while this is open.
- **If a step fails because of setup** (bad light, can't get a full-body view),
  say so and stop — that's a setup problem, not a card result.

---

## Step 1 — start a Squats workout on camera

1. **Exercises** → **Squats** → start the workout.
2. Allow the camera when the browser asks.
3. Step back until your whole body is in the preview.

✅ **Expected:** the pose overlay draws on you, and the screen does **not** say
it can't see your legs.

## Step 2 — stand still and do nothing (the calorie case)

4. With the set live, **just stand there for about 30 seconds.** Don't squat.
5. **Write down roughly how long you stood still.**

✅ **Expected:** the rep counter stays at **0**. The workout timer keeps running.

## Step 3 — now do the reps

6. Do **10 squats** at a normal pace, deep enough to be counted.
7. **Write down the rep count on screen.**

✅ **Expected:** the counter climbs. It needn't be exactly 10 — write down what
it actually says.

## Step 4 — 🔴 THE RULING: walk out of frame

**This is the step the whole ruling exists for.**

8. Without ending the set, **walk out of the camera's view** (or right up close
   to the laptop so it can't see your legs). **Wait about 10 seconds.**

✅ **Expected — all four:**
- The rep count **stays where it was**. It does not reset, and it does not jump.
- The screen tells you **why** — words to the effect that the camera can't see
  you well enough to count.
- A button appears: **"Count this set myself"**.
- **The app does NOT switch you to hand counting on its own.** There is no
  "+1 Rep" tap-counter taking over the screen.

❌ **Fail if:** the set flips to hand counting by itself, or the rep counter
resets, or nothing on screen explains why counting stopped.

## Step 5 — 🔴 THE RULING: step back into frame

9. **Step back into full view.** Wait a couple of seconds.
10. Do **3 more squats**.

✅ **Expected — all three:**
- The **"Count this set myself" button disappears** on its own.
- The message about not being able to see you goes away.
- **Your 3 squats are counted** — the counter carries on from where it was.

❌ **Fail if:** the button is still sitting there next to a working camera, or
the reps don't count after you're back in frame.

11. **Write down the rep count now.**

## Step 6 — end the set, then pause

12. End the set (reach the target, or press **Complete Set**).
13. On the next set, press **Pause**, count slowly to **20**, then **Resume**.

✅ **Expected:** the timer **freezes** while paused.
❌ **Fail if:** it keeps counting.

## Step 7 — finish

14. Do a few more reps, then finish the workout.
15. **Before it navigates away, write down the final timer value.**

## Step 8 — the results screen

16. ✅ **Avg Form shows a percentage, not "—".** This is the proof the camera
    graded the workout, **including the set you walked out of** — before the
    ruling, that set's form score would have been thrown away.
17. ✅ **Workout Time is less than or equal to the "total" line** (or the total
    line is absent, which means they're equal).
18. **Write down both numbers.**

## Step 9 — what the CHAT checks, after Kd reports

Kd opens nothing. Against the stored row for that workout:

- ✅ `duration_ms` is close to the timer from step 15 and does **not** include
  the 20-second pause.
- ✅ the set Kd walked out of has `tempo_ms_avg` **not null** — the rep timing
  the calorie rule needs, which only the camera produces.
- ✅ that set's `mode` is `'engine'`, **not** `'log_only'`. This is the ruling in
  the stored data: the camera kept the set.
- ✅ `kcal_point` / `kcal_calc_version` reflect v2, and the arithmetic is shown
  back to Kd in plain words.

## Step 10 — optional, and do it LAST: press the button on purpose

Only if steps 1–9 passed. This one deliberately gives a set away.

22. Start one more set, get the camera to lose you again (step out of frame),
    and this time **press "Count this set myself"**.

✅ **Expected:** a tap-counter appears, you tap your own reps, and that set is
filed as yours. Stepping back into frame does **not** take it back from you —
the choice was yours and it sticks.

---

## Step 11 — report

Send me:
- how long you stood still (step 5),
- the rep counts from steps 7 and 11,
- **pass/fail on steps 4 and 5 specifically** — those are the ruling,
- the final timer (step 15),
- the two numbers from the results screen (step 18).

**I'll then check the stored row and show you the arithmetic**: that your
standing-still time was billed at the low rate, only your actual reps at the
full rate, and your pause at nothing. That's the claim these cards make, and it
has never been checked against a real camera workout.
