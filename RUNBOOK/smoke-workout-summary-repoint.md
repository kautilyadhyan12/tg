# SMOKE — the post-workout summary comes off the old backend

Card: the workout core loop, card 1 of 4. Branch `web-repoint`.
Gates "done" per CLAUDE.md Part I §2. Run every step; report pass/fail per step.

## RESULT — PASSED, all 8 steps (Kd, 2026-08-07)

Recorded as **Kd's REPORT, not my measurement** (:4829): the browser is his
instrument. Steps 7 and 8 are evidenced by screenshots he took.

**IT PASSED ON ITS SECOND AND THIRD RUNS, and the failures are the point.**
The card's own suites were green throughout; the browser found two defects they
could not:

- **Step 7 (first run) — a false reassurance to a stranger.** Pasting another
  account's summary link showed "Saving your workout…" and then "Your workout is
  saved and will sync when you're back online." **Nothing leaked** — the tenancy
  held and no figure of the other account's ever rendered — but every clause of
  that sentence was false for the reader. The route answers 404 for "not synced
  yet" / "no such workout" / "not yours" deliberately, so only the client's own
  OUTBOX can tell them apart. Fixed with `isAwaitingSync`.
- **Step 8 (second run) — the case the waiting state was BUILT for did not
  work.** Offline, the request never reaches the server, so there is **no status
  code**; the retry keyed on `404` and the page said "Failed to load summary"
  about a workout sitting safely in the queue. **A test existed and passed: its
  fixture rejected with `{response:{status:404}}`, a shape offline never
  produces.** A test is a claim and the FIXTURE is part of the claim (:4855).
  Fixing it immediately exposed a second bug — our own "this body is not a
  summary" throw also has no `response`, so a garbled 200 was mistaken for a
  dropped network and retried; the suite's empty-200 test caught that one.

**Also found, and NOT this card's:** a workout cannot be STARTED offline at all
(the old backend is still in the start path) — its own `OWED.md` line now. **And
step 8 as first written told Kd to do exactly that**, an instruction with nothing
behind it — :5034's shape, one document along. Step 8 below is corrected.

## What changed, in one sentence

After you finish a workout, that screen used to show the same canned numbers
every time. It now shows **your** workout — real time, real calories, real form
grade, your streak, the XP you earned, and whether you just set a personal best —
read from the new backend.

## Read this before you start — WHY THE OLD SERVER IS STILL NEEDED

You still need three servers, and that is expected. **Starting** a workout still
calls the old backend; only the **summary** moved. Retiring the start-and-save
pair is card 4 and cannot happen until the Dashboard's numbers move too (they
share a session id). If a step fails because the old rig is off, that is a setup
problem, not a card failure — :5034's lesson, where both first-run failures were
the smoke document's.

---

## Setup — three servers, and the rig must be switched ON

Three terminals, from the repo root.

**1. The old-backend stand-in.** It boots in the `dead` state **by design**, so
starting it is not enough:

```
node apps/web/tools/mock-ml-backend.mjs
```

Then, in a browser tab, switch it to healthy — **do this before anything else**:

```
http://localhost:8000/__state/healthy
```

Confirm it took by opening `http://localhost:8000/__state`. It must say
`healthy`. If it says `dead`, no workout can be started at all.

**2. The new API:**

```
cd apps/api && node --import tsx --env-file=.env src/index.ts
```

**3. The web app:**

```
cd apps/web && corepack pnpm exec vite
```

Log in at `http://localhost:5173` as usual.

---

## Step 1 — do a real workout (this is the whole point)

There is **no shortcut URL for this card**. The old smoke could open
`/workout/summary/smoke-1` because the rig answered any id; the summary now comes
from the new API, which only knows workouts you actually did. That is the change.

1. Go to **Exercises**, add **two different** exercises to a workout (e.g. Squats
   and Push-ups) and start it.
2. Count a few reps of each — the "+1 Rep" button is fine, no camera needed.
3. Finish the workout and let it take you to the summary screen.

✅ **Expected:** the summary screen appears within a few seconds. You may briefly
see **"Saving your workout…"** — that is correct and means the workout is still
being sent. You must **not** see zeros, "grade D", "NaN", or "undefined"
anywhere, at any moment.

❌ **Fail if:** the page is blank, or shows numbers before it shows your workout.

## Step 2 — the numbers are YOURS

Look at the four tiles at the top.

✅ **Expected:**
- **Workout Time** — roughly the time you actually spent on the sets, not zero.
- **Calories** — a plausible number, not zero and not the same as last time.
- **Exercises** — **the number of DIFFERENT exercises you picked** (2 if you
  followed step 1), *not* the number of sets you did.
- **Form score** — if you hand-counted everything, it must read **"Not scored"**,
  never a letter grade. Grading a workout nobody watched is the exact defect this
  screen's history is about.

## Step 3 — do a SECOND, different workout

Do another workout, this time **one** exercise and clearly **shorter** than the
first.

✅ **Expected:** the summary shows **different** numbers from step 1 — fewer
exercises, less time, fewer calories. This is the step no smoke has ever been
able to run: the old rig served one canned payload for every workout, so this
screen could not be judged at all.

❌ **Fail if:** the two summaries show the same figures.

## Step 4 — personal records appear only when earned

On the **first** workout of a brand-new account, records should appear
("Longest workout session!" and so on). On the **shorter** second workout, the
"longest workout" record should **not** appear.

✅ **Expected:** the records list reflects which workout actually holds the
record. An empty list is a correct answer, not a broken one.

## Step 5 — XP, and it agrees with itself

✅ **Expected:** the "XP Earned" figure is **50** for an ordinary hand-counted
workout, or **70** if your form score was 80+, or **60** if this workout
continued a day streak (and **80** if both). The level and total XP shown beside
it come from the server and must not contradict it.

❌ **Fail if:** XP Earned reads `+0`, `—`, `NaN`, or `undefined`.

## Step 6 — meal ideas and stretches are there

Scroll down.

✅ **Expected:** a short list of meal ideas with timings, and a list of stretches.
These are the same words the old screen showed — nothing here should look new.

## Step 7 — another account cannot see your workout

This is the security step; please do run it.

1. Copy the workout id out of the address bar (the long code after
   `/workout/summary/`).
2. Sign out, register a **second** account, and paste that URL back in.

✅ **Expected:** you are bounced to the Dashboard with a message. You must **not**
see the first account's numbers.

❌ **Fail if:** any of the first account's figures appear. **Report this
immediately and stop** — under the standing rules a cross-account leak blocks the
card regardless of anything else.

## Step 8 — the offline case tells the truth

**START THE WORKOUT WHILE STILL ONLINE, then go offline.** You cannot begin a
workout offline at all: starting one still calls the OLD backend, which needs the
network, and the pre-workout screen answers "Failed to start workout". That is a
real, tracked gap (`OWED.md`) discharged by card 4, **not** a fault of this card —
and the first version of this step told you to do the impossible, which is
:5034's "an instruction with no button behind it" one document along.

1. **Still online**, start a short workout and do a couple of reps.
2. **Now** open devtools (F12) → **Network** tab → set throttling to **Offline**.
3. Finish the workout.

✅ **Expected:** the screen says **"Saving your workout…"** for a few seconds,
then a message saying **your workout is saved and will sync when you're back
online**, and you land on the Dashboard.

❌ **Fail if:** it says "Failed to load summary" — your workout is safe in the
browser's queue and telling you it failed would be the more alarming lie. Also
fail if any zeros are shown.

4. Set throttling back to **No throttling**, reload, and open the workout
   calendar.

✅ **Expected:** the workout you did offline is there.

---

## Reporting

Please report **pass/fail per step**, and paste anything unexpected. If a step
fails, say what you saw on screen rather than what you think went wrong — the
figures themselves are the evidence.
