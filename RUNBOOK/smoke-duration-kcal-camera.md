# SMOKE — the CAMERA path: standing still must not count as exercise

Card: real workout time + kcal v2 (DECISIONS :5906). Branch `web-repoint`.
**This is the half the first smoke did not cover, and it is the more important
half.** Written 2026-08-07 after Kd asked "there was no checking for camera, we
only tested the hand counted one?" — he was right, and the omission was mine.

## RESULT — not yet run

## Why this smoke exists, in one paragraph

The three-tier calorie rule this card was built for — **reps at the full
exercise rate, standing around at a low rate, paused time at nothing** — works
**ONLY on camera-graded sets**. A hand-counted set has no rep timings, so it
cannot use the rule at all and bills its whole span at the full rate. The first
smoke used "+1 Rep" throughout, so it tested the one path the headline feature
does not apply to.

**Only 3 of 58 exercises are camera-graded**: **Squats**, **Jump Squats**,
**Chair Squats**. Use **Squats**.

## Read this before you start

- **The camera must see your whole body**, legs included, or the app will say it
  cannot see your legs and will refuse to count. Step well back from the laptop.
- Follow the **Setup** section of `smoke-duration-kcal.md` (three servers, mock
  rig switched to `healthy`).
- **RESTART THE API SERVER if any api-side file changed since it started** — it
  does not reload itself. That cost a whole round on 2026-08-07.
- Devtools **Network** tab open, filter `sync`, **before** you finish.
- Do not run any mutation harness, `git stash`, or anything else that moves the
  working tree while this is open.

---

## Step 1 — start a Squats workout with the camera

1. Go to **Exercises**, pick **Squats**, start the workout.
2. Allow the camera when the browser asks.
3. Step back until you can see your whole body in the preview.

✅ **Expected:** the pose overlay draws on you, and the screen does NOT say it
cannot see your legs.
❌ **Fail if:** you cannot get a clean full-body view — say so and stop; that is
a setup problem, not a card result.

## Step 2 — THE SCENARIO THIS CARD WAS BUILT FOR: stand still, do nothing

4. With the camera running and the set live, **just stand there for about 30
   seconds.** Do not squat. Shift about, look at your phone, whatever.
5. **Write down roughly how long you stood still.**

✅ **Expected:** the rep counter stays at **0**. The workout timer keeps running.

## Step 3 — now actually do the reps

6. Do **10 squats**, at a normal pace, deep enough to be counted.
7. **Write down the rep count the screen shows.**

✅ **Expected:** the counter climbs as you squat. It does not need to be exactly
10 — write down what it actually says, that is the number we check against.

## Step 4 — end the set and pause

8. End the set (reach the target, or press **Complete Set**).
9. On the next set, press **Pause**, count slowly to **20**, then **Resume**.

✅ **Expected:** the timer **freezes** while paused.
❌ **Fail if:** it keeps counting.

## Step 5 — finish, and write down the timer

10. Do a few more reps, then finish the workout.
11. **Before it navigates away, write down the final timer value.**

## Step 6 — the results screen

12. ✅ **Avg Form shows a percentage, not "—".** This is the proof the CAMERA
    graded the workout — a hand-counted one reads "Not scored".
13. ✅ **Workout Time is less than or equal to the "total" line** (or the total
    line is absent, which means they are equal).
14. **Write down both numbers.**

## Step 7 — the payload

15. Network tab → click **sync** → **Payload**.
16. ✅ `durationSeconds` is close to your timer from step 11, and does **NOT**
    include your 20-second pause.
17. Open **sets** and check the first one:
    - ✅ `tempoMsAvg` is a number, **not null** — this is the rep timing the
      calorie rule needs, and only the camera produces it.
    - ✅ `mode` is `"engine"`, not `"log_only"`.

## Step 8 — report

Send me:
- how long you stood still doing nothing (step 5),
- the rep count (step 7),
- the final timer (step 11),
- the two numbers from the results screen (step 14),
- a screenshot of the payload if easy.

**I will then check the stored row and show you the arithmetic**: that your
standing-still time was billed at the low rate and only your actual reps at the
full exercise rate. That is the claim this card makes, and it has never been
checked against a real camera workout.
