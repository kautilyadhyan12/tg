# SMOKE — PostWorkout XP repoint (the last copy of the 100-XP curve)

Card: `PostWorkout.jsx` XP repoint, 2026-07-27, branch `web-repoint`.
Gates "done" per CLAUDE.md Part I §2. Run every step; report pass/fail per step.

**Why this file exists.** The previous XP smoke was INVALIDATED because its
steps lived only in the authoring chat and the rig was handed over untested
(HANDOFF, session close 2026-07-27). The T3 on this card raised the same shape
again. Steps that gate a card belong in the repo.

---

## The test account — build it FIRST, and it is not optional

Added 2026-07-28 after T3 round 2: this file said "use an account at Level 2 or
above" without saying how to get one, and sent the tester to step 5 without
mentioning the gate that intercepts them. Both facts existed only as prose in
DECISIONS. **The file is the artefact; the recipe is the instrument** — which is
the lesson this file's own header was written about.

**Why an ordinary account will not do.** At Level 1 the page correctly reads
`0/100 XP`, because level 2 genuinely costs exactly 100 XP. That is the one
place the right curve and the deleted bug print the SAME string, so a Level-1
account cannot prove anything either way. You need Level 2+ (denominator 248),
and Level 3 is better (denominator 374).

**Why you cannot just register and click.** `/workout/summary/:id` is wrapped in
`<ProtectedRoute>` with the mandatory onboarding gate (App.jsx). A freshly
registered account is redirected to the wizard before it ever reaches step 5, so
the fitness profile below is part of the recipe, not a nicety.

With the API running (Setup step 1 below), paste this. It registers, syncs four
consecutive-day perfect-form workouts and fills the profile so the gate lets you
through.

**Expect Level 3, and expect the total to drift.** 4×(50 base + 50 perfect) +
3×10 streak = 430, plus badges. On the day these dates were written the badges
were `first_workout` 50 + `form_perfect` 150 + `streak_3` 50 = **680**, i.e.
`332/374`. But `streak_3` keys on the CURRENT streak, which zeroes once the gap
from the hardcoded 2026-07-24…27 dates exceeds a day — so later runs land on
**630**, i.e. `282/374`. Either is fine and both are Level 3 with `xpForNext`
374, which is all the smoke needs. Only the level and the denominator are
load-bearing; do not treat the total as a fixed expectation.

```bash
J=/tmp/smoke-cookies.txt; rm -f $J
EMAIL="smoke-xp@example.com"; PASS="SmokeTest2026!"
curl -s -c $J -X POST http://localhost:3000/v1/auth/register -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"displayName\":\"Smoke XP\"}"
curl -s -c $J -X POST http://localhost:3000/v1/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"
for DAY in 24 25 26 27; do
  ID=$(node -e "console.log(crypto.randomUUID())")
  BODY=$(node -e "console.log(JSON.stringify({workoutId:'$ID',startedAt:'2026-07-$DAY'+'T10:00:00.000Z',platform:'web',engineVersion:'1.0.0',defsVersion:1,traceSample:null,sets:[1,2,3].map(i=>({exercise:'squat',setIndex:i,reps:12,durationMs:60000,avgFormScore:100,repScores:Array(12).fill(100),faultCounts:{},tempoMsAvg:2000,romStats:null,view:'side',holdMs:null,calibration:null,engineVersion:'1.0.0',definitionVersion:6}))}))")
  # THE HEADER MUST EQUAL THE BODY'S workoutId, or the route 400s with
  # `idempotency_key_mismatch`. This cost a first attempt.
  curl -s -b $J -X POST http://localhost:3000/v1/workouts/sync \
    -H "Content-Type: application/json" -H "Idempotency-Key: $ID" -d "$BODY"
done
curl -s -b $J -X PUT http://localhost:3000/v1/users/me/fitness-profile -H "Content-Type: application/json" \
  -d '{"age":30,"gender":"male","heightCm":175,"fitnessLevel":"intermediate","fitnessGoals":["general_fitness"],"availableEquipment":["none"],"preferredWorkoutTime":"evening","exerciseFrequency":4,"sessionDurationMin":45,"onboardingCompleted":true}'
curl -s -b $J -X PATCH http://localhost:3000/v1/users/me -H "Content-Type: application/json" -d '{"weightKg":72}'
curl -s -b $J http://localhost:3000/v1/gamification/me
```

The last line must report `"level":3` with `"xpForNext":374`. If it does not,
stop — the fixture is wrong and nothing after this proves anything.

## Three more things that are NOT bugs

1. **A Level-1 or Level-2 account cannot demonstrate this fix** — see above.
2. **In the `empty200` state the page is BLANK.** A 200 with no `summary` key
   makes the page render nothing, with no error message. That is a known,
   pre-existing gap (on OWED, the unparsed-summary line), not a broken rig.
3. **If you finish a REAL workout, the level may lag by one workout.** The sync
   to the new API is fire-and-forget and the page opens ~2s later, so the XP may
   not include the workout just done. Known, on OWED. Steps below avoid it by
   opening the summary page directly.

---

## Setup

**1.** Start the API:

```
cd apps/api; node --import tsx --env-file=.env src/index.ts
```

**2.** New terminal — the web app:

```
cd apps/web; corepack pnpm exec vite
```

**3.** New terminal — the mock old backend:

```
node apps/web/tools/mock-ml-backend.mjs
```

**4. THE CONTROL, AND IT RUNS FIRST.** In a browser tab open
`http://localhost:8000/__state/healthy`.
✅ It prints `{"state":"healthy"}`.

If any later step shows "unavailable" everywhere, the rig is lying, not the app
— check CORS before filing anything (the recorded lesson from the invalidated
run).

---

## The steps

**5.** Log in at `http://localhost:5173` as `smoke-xp@example.com` /
`SmokeTest2026!` — the Level-3 account from the recipe at the top. Any other
account either cannot show the difference (Level 1–2) or is intercepted by the
onboarding gate. Then go straight to:

```
http://localhost:5173/workout/summary/smoke-1
```

✅ The results page loads. (No need to do a real workout — the mock serves any
session id.)

**6.** Look at the **XP Earned** card.

✅ `+70` beside "experience points".
✅ The row under it reads `Level N` · `X/248 XP` (or `/374`) · `Level N+1`.
❌ **FAIL on `/100 XP`** (with an account above Level 1) — that is the deleted
maths.
❌ **FAIL on `Level 7`** or `78/100` — those are the old backend's numbers, which
this page must no longer read.

**7.** Click **"Preview card"**.

✅ The level printed on the share image matches the card above it.
❌ FAIL if they disagree — the PNG is what leaves the building.

**8.** Switch the rig: open `http://localhost:8000/__state/partial`, then reload
step 5's URL.

✅ Where `+70` was, you now see **`—`**.
❌ FAIL on `+0`, or on a lone `+` with nothing after it.

**9.** Back to `http://localhost:8000/__state/healthy`. Then:

- Press **F12** to open devtools → **Network** tab.
- **Clear the filter box** — it keeps text from earlier sessions and makes the
  list look empty. (This cost real time in a previous smoke.)
- Reload the page, find the row for `/v1/gamification/me`, right-click it →
  **Block request URL**.
- Reload again.

✅ The level reads `—` and the fraction reads `—/— XP`.
✅ The rest of the page is intact: form score `88%`, `280 kcal`, `+70`.
❌ FAIL if the page is blank, or if it shows `Level 1`.

> Block only that one URL. Stopping the whole API signs you out before the page
> renders, so you never reach the card — the recorded method correction from the
> nutrition-targets smoke.

**10.** Unblock the URL when finished, and stop the three servers.

---

## Reporting

Per step: pass, or fail with what you actually saw. A step that cannot be
reached is a fail with the reason, never a skip.
