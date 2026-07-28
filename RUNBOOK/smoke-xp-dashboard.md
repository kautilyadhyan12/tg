# SMOKE — XP / levels display + Dashboard XP (the re-smoke, rounds 1–8)

Card: XP display / Dashboard XP repoint, branch `web-repoint`.
OWED.md lines 86 and 346 — both 🔴, both UNTICKED after seven T3 rounds.
Gates "done" per CLAUDE.md Part I §2. Run every step; report pass/fail per step.

**Why this file exists, and why the last run does not count.** The 2026-07-27
attempt was INVALIDATED: the rig replied `Access-Control-Allow-Origin: *`, and a
browser refuses a wildcard on a credentialed request (`mlApi` sets
`withCredentials: true`, `mlApi.js:5`). Chrome blocked every call, so the app
said "unavailable" in all nine states **including `healthy`** — the tester
clicked through nine tests against a wall. The CORS bug is fixed and
curl-verified. The other half of the lesson: those steps lived only in a chat.
Steps that gate a card belong in the repo, which is what this file is.

---

## THE ONE THING TO UNDERSTAND BEFORE YOU START

**The XP numbers and the old-backend numbers come from two different servers.**

| Surface | Server | Rig state changes it? |
|---|---|---|
| Level, XP total, `X/Y XP`, the XP bar | **NEW API** `:3000` `/v1/gamification/me` | **NO — never** |
| Badges, challenges, leaderboard, stats, recommendations, recent workouts, week strip | **OLD backend** `:8000` (the mock rig) | Yes — that is what the rig is for |

So the card's central invariant, and the thing you are really checking in all
ten states:

> **In EVERY state, every XP surface reads the SAME correct numbers — Level 3,
> `332/374` (or `282/374`), and a matching total. The old backend can be dead,
> hanging, or sending garbage, and the XP figures must not move, not blank, and
> above all must never read "Level 1" or "0".**

Everything else in the old-backend column must degrade **honestly**: a dash
(`—`) or a plain "unavailable" sentence — **never a fabricated zero**, and never
a claim of failure about content that is visibly on screen.

### The five XP surfaces (all four screens)

| # | Where | Renders |
|---|---|---|
| 1 | **Sidebar** (every screen) | `Level 3` expanded · `L3` collapsed |
| 2 | **Dashboard** → "Current Level" stat card | `Level 3` / `680 XP earned` |
| 3 | **Dashboard** → "Experience Points" panel | `Level 3`, `332/374 XP → Level 4`, bar, + a `Level` figure in the 3-up row |
| 4 | **Dashboard** → "Your Rank" card (strip) | `680 XP · Level 3`, bar, `332/374 to Lv 4` |
| 5 | **Achievements** → header block | `Level 3`, `680 total XP`, `332/374`, `XP to Lv 4`, bar |

**They must all agree with each other and with `/v1/gamification/me`, in every
state.** Two surfaces printing different levels on one screen is the exact
defect this card exists to close (Kd's 2026-07-26 screenshot: "Level 1 / 0 XP"
beside "0/100 XP" beside "330 XP · Level 2").

---

## The test account — build it FIRST, and it is not optional

**Why an ordinary account will not do.** At Level 1 a fabricated "Level 1" and a
real one are the same string, so a Level-1 account cannot prove anything either
way. You need Level 2+; Level 3 is better (denominator 374).

**Why you cannot just register and click.** `/dashboard` and `/achievements` sit
behind `<ProtectedRoute>` with the mandatory onboarding gate (`App.jsx`), so a
fresh account is redirected to the wizard before it ever reaches the screens.
The fitness profile below is part of the recipe, not a nicety.

**The email is generated per run.** `smoke-xp@example.com` already exists in the
shared dev database from the PostWorkout smoke, with a password that was
deliberately never committed — so re-using it would block you at step one. Each
run makes its own account. The password is generated, never committed (the
security note from that card's T3 round 4).

With the API running (Setup step 1 below), paste this whole block:

```bash
J=/tmp/smoke-xpdash-cookies.txt; rm -f $J
EMAIL="smoke-xpdash-$(node -e 'console.log(Date.now())')@example.com"
PASS="Smoke-$(node -e 'console.log(crypto.randomUUID().slice(0,12))')!"
echo "SMOKE LOGIN -> $EMAIL / $PASS"          # copy this line; you need it at step 5
curl -s -c $J -X POST http://localhost:3000/v1/auth/register -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"displayName\":\"Smoke XP\"}"
curl -s -c $J -X POST http://localhost:3000/v1/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"
for DAY in 24 25 26 27; do
  ID=$(node -e "console.log(crypto.randomUUID())")
  BODY=$(node -e "console.log(JSON.stringify({workoutId:'$ID',startedAt:'2026-07-$DAY'+'T10:00:00.000Z',platform:'web',engineVersion:'1.0.0',defsVersion:1,traceSample:null,sets:[1,2,3].map(i=>({exercise:'squat',setIndex:i,reps:12,durationMs:60000,avgFormScore:100,repScores:Array(12).fill(100),faultCounts:{},tempoMsAvg:2000,romStats:null,view:'side',holdMs:null,calibration:null,engineVersion:'1.0.0',definitionVersion:6}))}))")
  # THE HEADER MUST EQUAL THE BODY'S workoutId, or the route 400s with
  # `idempotency_key_mismatch`. This cost a previous attempt.
  curl -s -b $J -X POST http://localhost:3000/v1/workouts/sync \
    -H "Content-Type: application/json" -H "Idempotency-Key: $ID" -d "$BODY"
done
curl -s -b $J -X PUT http://localhost:3000/v1/users/me/fitness-profile -H "Content-Type: application/json" \
  -d '{"age":30,"gender":"male","heightCm":175,"fitnessLevel":"intermediate","fitnessGoals":["general_fitness"],"availableEquipment":["none"],"preferredWorkoutTime":"evening","exerciseFrequency":4,"sessionDurationMin":45,"onboardingCompleted":true}'
curl -s -b $J -X PATCH http://localhost:3000/v1/users/me -H "Content-Type: application/json" -d '{"weightKg":72}'
echo; echo "=== THE NUMBERS EVERY SCREEN MUST SHOW ==="
curl -s -b $J http://localhost:3000/v1/gamification/me
```

**The last line is your expected-value sheet — keep it on screen.** It must
report `"level":3` with `"xpForNext":374`. If it does not, STOP: the fixture is
wrong and nothing after this proves anything.

**Expect the total to drift, and that is fine.** 4×(50 base + 50 perfect) + 3×10
streak = 430, plus badges. On a day close to the hardcoded 2026-07-24…27 dates
the badges are `first_workout` 50 + `form_perfect` 150 + `streak_3` 50 = **680**
(`332/374`); once the gap from those dates exceeds a day `streak_3` drops and it
lands on **630** (`282/374`). Both are Level 3 with `xpForNext` 374. **Only the
level and the denominator are load-bearing** — read your real numbers off the
curl above and use those throughout; the examples in this file say `680` /
`332/374`.

---

## Setup

**1.** Terminal 1 — the new API:

```
cd apps/api; node --import tsx --env-file=.env src/index.ts
```

**2.** Terminal 2 — the web app:

```
cd apps/web; corepack pnpm exec vite
```

**3.** Terminal 3 — the mock old backend:

```
node apps/web/tools/mock-ml-backend.mjs
```

> Do NOT pipe any of these into `Select-Object` — a closing pipe kills the
> process (it happened twice in a previous session).

**4.** Run the account recipe above, in a fourth terminal.

---

## THE CONTROL — it runs FIRST and it is the whole reason the last run was void

**5.** In a browser tab open `http://localhost:8000/__state/healthy`.

✅ It prints `{"state":"healthy"}`.

**If that page will not load,** try `http://127.0.0.1:8000/__state/healthy`. The
rig binds IPv4 loopback deliberately, and a browser resolving `localhost` to
`::1` reports it as down — which looks identical to the app being broken.

**6.** Log in at `http://localhost:5173` with the email and password the recipe
printed, and go to `/dashboard`.

✅ **Real old-backend numbers appear:** `42` Total Workouts · `15.5h` Hours
Trained (sub-caption `930 minutes`) · `7,400` Calories Burned.
✅ **Real XP appears:** `Level 3` / `680 XP earned` on the Current Level card.

> ❌ **If ANY of that reads "—" or "unavailable", STOP THE WHOLE SMOKE.** The rig
> is lying, not the app. Check Terminal 3's log: if it shows nothing but
> favicons while you click, the browser is blocking the calls — it is CORS
> again, and the run does not count. This is the step whose absence voided
> 2026-07-27.

**7.** Still in `healthy`, check all five XP surfaces agree (the list at the top
of this file): Sidebar, the Current Level card, the Experience Points panel, the
Your Rank card, and `/achievements`'s header.

✅ Every one reads `Level 3`; every fraction reads `332/374`; both totals read
`680`.
❌ FAIL if any two disagree. ❌ FAIL on `/100 XP` anywhere — that is the deleted
flat-curve maths.

**8.** Still in `healthy`, glance at `/achievements`:

✅ Badges tab shows 3 badges with **1** earned (First Rep). Challenges tab shows
2. Leaderboard tab shows Asha #1 and Kd #2, with Kd highlighted as you.
✅ Recommendations on the Dashboard show **Bodyweight Squat** (green/beginner)
and **Burpee** (red/advanced).

---

## The nine failure states

**SWITCH STATES FROM A TERMINAL, NOT A BROWSER TAB:**

```bash
curl -s http://127.0.0.1:8000/__state/<name>
```

Then **reload** `/dashboard` (and `/achievements` where named). Report pass/fail
per step.

**⚠ RUN `hang` LAST — step 10 is deliberately out of order.** It saturates the
browser's connection pool and cannot be escaped from inside the browser; the
full explanation is in that step. Do steps 9, 11–17 first, then 10, then stop.
(Found on 2026-07-28 during the run this file was written for: the tester was
trapped mid-smoke and the rig had to be killed from outside.)

**In every single one of these, before anything else, check the XP invariant:**

✅ Sidebar still reads `Level 3`. The Current Level card still reads `Level 3` /
`680 XP earned`. ❌ **FAIL on `Level 1`, `0`, or a blank, anywhere.**

---

**9. `dead`** — every old endpoint 500s. This is the branch's normal state.

✅ The three stat cards read `—` (not `0`).
✅ Week strip caption: `Weekly activity unavailable`, **and the seven dots are
not drawn as untrained** (round 4 F3 — an unknown week must not look like a week
you skipped).
✅ `Recommendations are unavailable right now.`
✅ `Recent workouts are unavailable right now.`
✅ Strip: `Badges are unavailable right now` and `Challenges are unavailable
right now`.
✅ `/achievements`: `Failed to load achievements` + `Badges, challenges and the
leaderboard are unavailable right now.`
❌ FAIL on any `0` presented as a fact, and on `0 of 40 badges`.

---

**10. `hang` — RUN THIS ONE LAST.** The rig accepts the connection and never
answers. `mlApi` sets no timeout, so these reads never settle. *(Rounds 4 F7 and
7 F1 — the state that produced a permanent lie.)*

> **⚠ THIS STATE IS A ONE-WAY DOOR IN A BROWSER, AND IT TRAPPED THE 2026-07-28
> RUN.** Loading `/dashboard` in `hang` leaves ~6 requests open that the rig will
> never answer — and **6 is Chrome's per-host connection limit**. The pool is
> then fully saturated with dead sockets, so *every* later request to
> `localhost:8000` waits forever, **including `/__state/<name>`**. The tester
> pasted the next state's URL and watched it spin; it was never going to load.
> Measured at the time: `netstat` showed exactly 6 ESTABLISHED Chrome→:8000
> connections and zero capacity left.
>
> **The escape is from OUTSIDE the browser** — kill and restart the rig:
> ```bash
> netstat -ano | grep ":8000.*LISTENING"     # get the PID
> taskkill //PID <pid> //F
> node apps/web/tools/mock-ml-backend.mjs
> ```
> Switching state with `curl` alone is NOT proven sufficient: the browser's dead
> sockets outlive the state change. Restart the rig.
>
> Hence: run this state LAST, and end the smoke here.

✅ The XP surfaces render **immediately and fully** — they are on the other
server. `/achievements`'s header shows `Level 3`, it does not spin.
✅ The Your Rank card **renders** (it must not return null and vanish).
✅ Old-backend areas show `Loading…` / loading arms — **still coming is the
truth here.**
❌ **FAIL on "unavailable" anywhere in this state** — nothing has failed; a
pending read must never be reported as a failed one.
❌ FAIL if the strip or the Achievements header is missing entirely.

---

**11. `empty200`** — a `200` with `{}`. The envelope arrives; no fields do.

✅ Every old-backend figure reads `—`.
✅ Empty/unavailable captions where a list cannot be enumerated.
❌ FAIL on `(0/—)`, `0 of — badges`, or `Badges (0)` (round 3 F5).

---

**12. `statsEmpty`** — a `200` carrying `{"stats":{}}`. *(Round 4 F2 — the
headline defect of OWED:346.)*

✅ Total Workouts `—` · Hours Trained `—` · Calories Burned `—`.
❌ **FAIL on `0 workouts / 0h / 0 kcal`.** That is the fabrication this card
exists to delete: an envelope arrived, the fields did not, and zeros were
printed as fact.

---

**13. `noEarned`** — the badge catalog arrives with **no `earned` field** on any
badge. *(Round 5 F2 and round 6 F1 — the same rule, opposite signs.)*

✅ The three badges **RENDER on screen** (`First Rep`, `Week One`, `Form
Master`).
✅ The earned COUNT reads `—`, not `0` — it genuinely cannot be known.
❌ **FAIL if "Badges are unavailable right now" appears above badges you can
see.** A false denial of visible content is as wrong as a fabricated number.
❌ FAIL on `0 of 40 badges` or "Complete workouts to earn your first badge".
✅ Stats: Total Workouts `12` and This-week `2` are real; Hours and Calories read
`—` (that payload omits them).

---

**14. `partial`** — elements arrive missing their fields. *(Rounds 5 F3, 6 F7,
7 F2, 7 F5.)*

✅ `Mystery Badge` and `Mystery Challenge` render, with their unknown fields as
`—`.
✅ **An unknown difficulty is GREY**, and is not labelled `advanced` or `hard`.
❌ **FAIL on a red difficulty pill** for `Mystery Challenge` / `Mystery Move` —
painting an unknown as a definite hard one is round 7 F2, which survived a fix
that claimed to be a class fix.
✅ The recent workout with `completed_at: 'not-a-date'` renders `—`.
❌ **FAIL on the literal text `Invalid Date`** (round 6 F7).

---

**15. `badRecs`** — `recommendations` arrives as the STRING `"oops"`.
*(Round 6 F2.)*

✅ **The Dashboard still renders.** Stats, XP, strip, week strip all present.
❌ **FAIL on a blank/white page.** There is no ErrorBoundary in `apps/web`
(grep-verified), so a throw in render blanks everything — that is the defect.
✅ The recommendations section says it is unavailable, honestly, rather than
disappearing silently.

---

**16. `lbOnly`** — the overview 500s but the **leaderboard 200s**.
*(Round 4 F4 — a coupling bug.)*

✅ `/achievements` says `Badges and challenges are unavailable right now.`
❌ **FAIL on the wording `Badges, challenges and the leaderboard are unavailable
right now.`** — the leaderboard is right there and it worked.
✅ The Leaderboard tab is **present and clickable**, showing Asha and Kd.
✅ The Your Rank card shows `#2` `of 2`.

---

**17. `emptyLists`** — everything `200`s with genuinely empty lists and real
zeros. *(Round 6 F6.)*

✅ Sections **stay on screen**; none vanishes because its list is empty.
✅ `No badges in the catalog yet.` · `No one on the leaderboard yet.` · `No
workouts logged yet.`
✅ **Here `0` is CORRECT** — the server really said `total_workouts: 0`. A zero
that was sent is a fact; only a zero that was *assumed* is the bug. This state
is the control for the previous ones.
❌ FAIL if a whole section disappears, leaving no explanation.

---

**18.** Set the rig back to `healthy`, confirm the Dashboard is whole again, and
stop the three servers.

---

## Reporting

Per step: **pass**, or **fail with what you actually saw** (a screenshot beats a
paraphrase). A step you could not reach is a **fail with the reason**, never a
skip.

If the run is clean, the two OWED lines (86 and 346) may be ticked **only
together with a clean T3 round 8** — both gates, not either.

---

## RUN RESULT — 2026-07-28 (Kd) — ALL 11 STEPS PASSED

Every state behaved as specified. Level 3 / `332/374` / `680 XP` held on all
five XP surfaces in all ten rig states, including `dead` and `hang`. No
fabricated zero appeared in any state, and no false "unavailable" appeared over
visible content.

The fixture was `smoke-xpdash-1785229803361@example.com`, built by the recipe
above; `/v1/gamification/me` returned `level 3`, `total 680`, `xpInLevel 332`,
`xpForNext 374`, `progressPct 88.8` before the run started, so the expected
values were measured, not assumed.

**Three honest deviations from this file as written, none of which affect the
result:**

1. **States were switched by `curl` from a terminal, by the assistant, not by
   the tester in a browser tab.** The file has been corrected to prescribe this;
   it is now the documented method.
2. **`hang` was run 4th, not last** — this file's own ordering advice did not
   exist yet. It trapped the run exactly as now described in step 10, and the
   rig had to be killed and restarted. Steps 1–4 were already complete and
   unaffected; the run continued from step 5 after the restart.
3. **Docker was not running** and was not needed: `DATABASE_URL` points at Neon,
   and `apps/api/.env` declares no `REDIS_URL`. The previous session's note that
   the Docker containers must be up is not true for this smoke.

**This closes the SMOKE half only.** The OWED ticks still wait on T3 round 8
(`t3-xp-web-r8.diff`, prompt at `t3-xp-web-r8-PROMPT.md`).
