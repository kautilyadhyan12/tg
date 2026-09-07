# SMOKE — the real workout time is saved, and calories stop billing idle time as exercise

Card: duration + kcal v2 (the card grown out of Kd's "camera on, not exercising"
question, 2026-08-07). Branch `web-repoint`.
Gates "done" per CLAUDE.md Part I §2. Run every step; report pass/fail per step.

## RESULT — PASSED (Kd, 2026-08-07), on the THIRD run, and the two failures are the point

Recorded as **Kd's REPORT, not my measurement** (:4829): the browser is his
instrument. Every round is screenshot-evidenced.

**Final run:** 40 seconds worked → `durationSeconds: 40` in the payload → `40s`
on screen, **and no contradicting sub-line**. Parts B and D passed on run 1.

**Run 1 found two defects the 991 green tests could not**, both now fixed:
- **The set stopwatch counted paused time.** Seven sets claiming 188 s inside a
  session that ran 92 s; the screen printed "3m 8s" over "2 min total" — a part
  larger than its whole — and the inflated span was billed at the exercise rate.
- **Nothing stopped that contradiction reaching the screen.** Active time is now
  clamped to the session server-side, which also heals rows already stored.

**Run 2 found a third, and Kd found it with no instrument at all:** "2 min total"
printed for a **1 m 44 s** workout, because the sub-line rounded to whole minutes
while the figure above it is exact to the second. `totalTimeLabel` takes seconds
now.

**RUN 2 ALSO EXPOSED A SETUP FAILURE THAT WAS MINE, and this is the one to carry
forward: `node --import tsx src/index.ts` DOES NOT WATCH.** The API server had
been started before the clamp was written, so Kd spent a whole round testing
yesterday's server against today's app — and reported a real defect that was
already fixed on disk. **Setup below now says to restart it.** A smoke doc's
SETUP is part of its claim (:5034).

---

## What changed, in one sentence

The app now tells the server how long your workout actually ran (the on-screen
timer — pauses excluded), and calories are billed in three tiers: reps at the
exercise rate, standing-around and rest at a low rate, paused time at nothing.

## Read this before you start

Three servers, exactly as the previous smoke (`smoke-workout-summary-repoint.md`
— follow its **Setup** section verbatim, including switching the mock rig to
`healthy` first). Starting a workout still calls the old backend; that is card
4's business, not this card's.

**⚠️ RESTART THE API SERVER AFTER ANY api-SIDE EDIT — IT DOES NOT RELOAD
ITSELF.** `node --import tsx --env-file=.env src/index.ts` has no `--watch`: it
runs the code as it was when you started it. The web app hot-reloads and the API
does not, so the two silently drift apart, and the smoke then measures a server
older than the fix under test. That cost a full round here on 2026-08-07. To
restart: find the listener with `netstat -ano | grep ":3000"`, `taskkill //PID
<pid> //F`, then start it again and confirm `curl http://localhost:3000/health`.

**Do not run any mutation harness while this smoke is open** (:3819) — and, added
2026-08-07, **do not run `git stash`, `git checkout` or anything else that moves
the working tree** while a harness is running either. Both edit the same files
the live dev servers are serving.

**Have the browser devtools Network tab OPEN BEFORE you finish the workout**
(a panel opened afterwards has captured nothing — the timezone card burned a
smoke round on exactly this).

---

## Step 1 — a workout with a pause and a rest in it

1. Start a workout with **two** exercises, hand-counted ("+1 Rep" — no camera
   needed).
2. During the FIRST exercise, hit **Pause**, slowly count to twenty, resume.
   ✅ **Expected:** the on-screen timer FREEZES while paused. Note (roughly)
   the timer's value when you finish the first exercise.
3. Complete the first set and take the rest break — let the rest counter run
   at least ~15 seconds before starting the next set.
4. Do the second exercise, then finish the workout.
5. **Note the timer's final value** (the Duration figure on the workout
   screen) before it navigates away. Write it down — step 2 checks against it.

## Step 2 — the payload says what the screen said

In the Network tab, find the `sync` request (`POST /v1/workouts/sync`, to
localhost:3000) and open its request payload.

✅ **Expected:**
- a `durationSeconds` field, within a few seconds of the timer value you wrote
  down — and **noticeably SMALLER than your wall-clock time**, because the
  ~20 s pause is not in it;
- a `restSeconds` field, roughly the rest you actually took (~15+ s).

❌ **Fail if:** either field is missing, `durationSeconds` includes the pause,
or `restSeconds` is wildly unlike the rest you took.

## Step 3 — the summary screen shows two DIFFERENT times

On the post-workout summary:

✅ **Expected:** the Workout Time tile shows your active time, and beneath it a
**"total" sub-line** with a LARGER figure (the whole timer). This sub-line has
been hidden for every workout until now because the two numbers were secretly
the same — its reappearance with two genuinely different values IS the card.

❌ **Fail if:** the two figures are identical, the sub-line is absent, or the
total is smaller than the active time.

## Step 4 — the stored row (paste-back)

From the repo root, with `apps/api/.env` present:

```
cd apps/api && node --import tsx --env-file=.env -e "import postgres from 'postgres'; const sql = postgres(process.env.DATABASE_URL); const r = await sql\`SELECT duration_ms, kcal_point, kcal_calc_version FROM workouts ORDER BY started_at DESC LIMIT 1\`; console.log(r[0]); await sql.end();"
```

✅ **Expected:** `duration_ms` ≈ your timer × 1000 (NOT the small sum-of-sets
figure), and `kcal_calc_version` is **2**.

## Step 5 — an old queued workout still syncs (the compatibility half)

1. In devtools → Network, set **Offline**.
2. Do a second, tiny workout (one exercise, a few reps) and finish it. The
   summary screen will say the workout is saved and waiting — correct.
3. Set the network back to **Online** and reload the app.

✅ **Expected:** the queued workout syncs (a `sync` POST goes out, 201), the
summary loads with real numbers. This proves the queue path carries the new
fields end-to-end — and if it ever carried an old-shaped payload, the server
accepts that too (the suite pins it; the browser cannot produce one anymore).
