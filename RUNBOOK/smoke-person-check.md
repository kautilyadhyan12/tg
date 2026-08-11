# SMOKE — the person check (camera-accuracy card 4, step 3)

Branch `web-repoint`. **This card does not tick until this passes.**

## RESULT — not yet run

## What you are testing, in plain words

Your four clips of an empty room with a chair made the app count **10 reps that
never happened**. The check that spots this is now wired in: when the camera
isn't sure it's looking at a person, the app **stops counting** and **says so on
screen**.

So this smoke has three halves, and all of them matter:

- **The chair must stop counting.** That is the fix.
- **You must still count.** That is the thing the fix could break, and it is the
  worse failure of the two — a rep counter that ignores you is worse than one
  that counts a chair.
- **The screen must not say anything untrue while you watch it.** There are two
  sentences now, one for while it is stopped and one for the moment it starts
  again, because a single sentence was caught claiming nothing was being counted
  over a count that was climbing. Step 4 is where you check that.

**Only 3 of 58 exercises are camera-graded**: Squats, Jump Squats, Chair Squats.
Use **Squats**.

---

## Setup — three servers

Three terminals, from the repo root. (Say the word and I'll start all three.)

**1. The old-backend stand-in.** It boots `dead` **by design**, so starting it is
not enough:

```
node apps/web/tools/mock-ml-backend.mjs
```

Then in a browser tab, **before anything else**, open
`http://localhost:8000/__state/healthy` and confirm at
`http://localhost:8000/__state` that it now says `healthy`. If it says `dead`,
no workout can be started at all.

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

- **Set the room up like your recordings**: the chair in shot, the camera far
  enough back to see a whole person standing.
- **Steps 2 and 3 need you OUT of the picture.** Not standing at the side — out
  of the camera's view entirely.
- No devtools. Everything here is readable on the screen.
- Don't run any mutation harness or `git stash` while this is open.
- **If a step fails because of the setup** (too dark, can't get far enough back),
  say so and stop — that is a setup problem, not a card result.

---

## Step 1 — start a Squats workout

1. **Exercises** → **Squats** → start the workout.
2. Allow the camera.
3. Step back until your whole body is in the preview.

✅ **Expected:** the skeleton draws on you, and the screen does **not** say it
can't see your legs.

## Step 2 — 🔴 THE FIX: leave the chair alone in shot

4. Without ending the set, **walk out of the camera's view completely**, leaving
   the chair (and anything else) in the picture.
5. **Wait two full minutes.** Time it. This is the same length as your
   recordings, and two minutes of an empty room is what produced the invented
   reps before.
6. Come back and **write down the rep count**.

✅ **Expected — both:**
- The rep count is **still 0**, or very close to it.
- The screen says **"Not counting — the camera isn't sure it's looking at you.
  Check that your whole body is in the picture."**

❌ **Fail if:** the counter has climbed on its own, or nothing on screen explains
why it is not counting.

⚠️ **Honest expectation:** this is a large cut, **not a cure**. On one of your
four clips three invented reps survived even with the check on. So 1, 2 or 3
reps here is a PASS with a note — write down the number either way. Six is a
fail.

## Step 3 — 🔴 THE FIX: does the message stay long enough to read?

7. Still out of shot, **look at the screen from wherever you are** (or step in,
   read it, step out).

✅ **Expected:** the message sits there steadily. It does **not** flash on and
off several times a second.

❌ **Fail if:** it flickers, or you cannot read it before it disappears.

## Step 4 — 🔴 THE CONTROL: step back in and squat

**This is the most important step in the whole smoke.** If the check has broken
your own workout, it is worse than the bug it fixes.

8. **Step back into full view**, and **watch the screen as you do it.** Wait two
   or three seconds.
9. Do **10 squats** at a normal pace, deep enough to count.
10. **Write down the rep count.**

✅ **Expected — all four:**
- **Your squats are counted.**
- 🔴 **While the count is climbing, the screen must NOT say "Not counting".**
  This is the exact thing round one fixed. The explanation is held on screen for
  about a second so it can be read — but counting restarts the instant you are
  back, so the old wording sat there in the present tense, saying nothing was
  being counted, over a number that was visibly going up.
- If you catch the sentence in that first second, it should now read **"Counting
  again — the camera lost sight of you for a moment."** It is only up for about a
  second, so **missing it is not a failure — seeing the wrong one is.**
- The message then goes away by itself, and the counter carries on from whatever
  step 2 left it at — it does not reset.

❌ **Fail if:** your reps are not counted; the words **"Not counting"** are on
screen while the counter is climbing; or the message keeps coming back while you
are plainly standing in front of the camera.

⚠️ It needn't be exactly 10 — the app has always counted a bit under. What
matters is that it climbs roughly as it did before this change.

## Step 5 — does the message interrupt you mid-squat?

11. Do **10 more squats**, and this time **watch the screen while you do them.**

✅ **Expected:** you may see the message flicker up **once or twice** and go
again. That is expected — about 1 frame in 22 of a real person is silenced, and
the message is deliberately slow to appear and slow to leave.

❌ **Fail if:** it is up more than it is down, or it appears every single rep.
That would mean the number is wrong for your room and I need to know.

12. **Write down the rep count again**, and say roughly how many times you saw
    the message.

## Step 6 — pause and resume

13. Press **Pause**, count slowly to 10, press **Resume**.
14. Do **3 more squats**.

✅ **Expected:** no message left over from before the pause, and your 3 squats
are counted.

## Step 7 — finish

15. Finish the workout.
16. On the results screen: ✅ **Avg Form shows a percentage, not "—"** — the
    proof the camera really did grade the workout, check and all.

---

## Step 8 — report

Send me:

- the rep count after **step 2** (the empty room) — the headline number,
- pass/fail on the **message appearing** in step 2,
- the rep counts from **steps 4, 5 and 6**,
- 🔴 **step 4: were the words "Not counting" ever on screen while the counter was
  climbing?** Yes/no is enough. If you caught the sentence as you stepped back
  in, tell me which one it was.
- roughly how often the message appeared while you were actually squatting
  (step 5),
- whether Avg Form was a percentage or a dash.

**The pair of numbers I care about most is step 2 versus step 4.** Chair near
zero, you counting normally. Either one alone proves nothing. **The one WORD I
care about most is "Not counting" in step 4** — on screen over a climbing
counter, that is a failure however good the numbers are.
