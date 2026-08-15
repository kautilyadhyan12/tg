# SMOKE — the Dashboard's numbers, on the new API

**Why this sheet exists.** 615 green tests run through jsdom with every network
call mocked. They cannot see a CORS preflight, a cookie that does not travel, or
a real server answering a shape nobody predicted — the Card-4 smoke caught a
browser-wide CORS bug that 250+ green tests were structurally incapable of
seeing. That is what these steps are for.

**What changed, in one line:** the home screen's totals, streak, this-week
count, seven dots and Recent Workouts list now come from the NEW API instead of
the old one. Nothing about how a workout is SAVED changed.

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
Open the URL it prints (usually http://localhost:5173) and sign in.

**You do NOT need the third server** (`mock-ml-backend.mjs`) for these steps.
That is the point of the card: nothing on this page asks the old backend any
more. If the Dashboard's numbers appear with only these two servers running,
that on its own is most of what this sheet is checking.

---

## The steps

### 1 — the numbers appear at all
Go to the Dashboard (the home screen after sign-in).

✅ **Expect:** Total Workouts, Hours Trained and Calories Burned show numbers,
not dashes ("—"). The three tiles under Experience Points show This week,
Streak and Level.

❌ **If you see dashes everywhere:** the reads failed. Open the browser console
(F12 → Console) and copy anything red into the chat.

### 2 — the numbers are YOUR numbers
Open a second tab on the Progress page and compare.

✅ **Expect:** the Dashboard's Total Workouts matches Progress's total workouts
for "All Time". They are now the same server and the same query, so they should
agree exactly.

> **This is where a change is expected and is not a fault.** If your totals are
> LOWER than you remember, that is the card working: the new database only holds
> workouts saved since early August. The older ones are still in the old
> database and get copied across at the switch-over. Say what you see and we
> will check it against the stored rows.

### 3 — the window under Total Workouts is honest
Look at the small grey line under Total Workouts.

✅ **Expect:** it says **"all time"** if your plan has no history limit, or
**"last 90 days"** if it does. Whichever it says, the same words appear under
Calories Burned and after the minutes on Hours Trained — all three name the
same window.

❌ **Fail if:** one tile says "all time" and another says "last 90 days".

### 4 — this week's dots and count agree
Look at the "This Week" card (seven circles, Mon → Sun) and the "This week"
tile beside it.

✅ **Expect:** the number of ORANGE (filled, flame) circles equals the number in
the caption underneath — "N of 7 days active". The "This week" tile counts
WORKOUTS, so it can legitimately be HIGHER than the caption if you trained twice
in a day. It must never be lower.

### 5 — the dots are on the right days
✅ **Expect:** if you trained today, TODAY's circle is lit. Today's circle is
the one outlined in orange.

> **This is the step worth doing carefully, and best done in the evening or
> early morning.** The old screen worked out your days in London time, so for
> part of every day the flames sat one square to the left. If today's workout
> lights yesterday's square, that is a real failure — say so.

### 6 — do a workout, watch it appear
Start any workout, finish one set, and complete it. Come back to the Dashboard
and refresh.

✅ **Expect:** it appears at the top of Recent Workouts, showing the date, a
duration like "3m 7s", a calorie number and a form percentage. Total Workouts
goes up by one.

❌ **Fail if:** the duration reads "0 min" or a whole number of minutes for a
workout that took seconds.

### 7 — the date reads the way YOUR device writes dates
Look at the date on a Recent Workouts row.

✅ **Expect:** it matches your computer's own date format. In India that is
"15 Aug"; in the US, "Aug 15". Previously this screen forced the American
spelling on everyone.

### 8 — a broken read says so, and does not invent a zero
With the Dashboard open, press F12 → Network tab → find a request to
`/v1/progress/overview` → right-click → **Block request URL**. Then refresh.

✅ **Expect:** Total Workouts, Hours Trained and Calories Burned show **"—"**,
NOT "0". The seven dots and Recent Workouts keep working — they are separate
requests and must not be dragged down with it.

❌ **Fail if:** you see "0 workouts", "0h" or "0 kcal". A zero is a claim; we do
not know the number, so we must not make one.

Right-click → Unblock when you are done.

---

## Steps 9 and 10 — the empty pane (ADDED 2026-08-15 after T3 round 3)

**Why these exist.** The 8 steps above all ran on an account with 4 workouts, so
the Recent Workouts pane was never once EMPTY during a smoke. That pane is where
two Criticals shipped in a row — first denying a real history, then telling brand
new users their plan was hiding one — and every arm of the rewrite is so far
proven only by mocked tests, which cannot see a browser. These two steps are the
first time a human looks at the sentences.

### 9 — a brand-new account says it has nothing, and claims nothing else
Register a NEW account (any email; the password must have an uppercase letter, a
lowercase letter and a digit — see the known issue at the bottom). Do NOT do a
workout. Land on the Dashboard.

✅ **Expect:** the Recent Workouts card reads exactly **"No workouts logged
yet."**

❌ **Fail if:** you see **"No workouts in the last 90 days."**, or the line
**"Your plan shows that far back. Older workouts are still saved."** appears.
This account has no older workouts. That sentence was round 2's Critical and this
step is the reason it cannot ship again unseen.

❌ **Also fail if:** you see "No workouts to show." — that is the arm for a
server too old to answer, and yours is not.

### 10 — an account whose history is older than its window explains itself
On a fresh account, sync ONE workout backdated more than 90 days. Ask me to seed
it — it is one command against the local database and it is not something to do
by hand. Then open the Dashboard.

✅ **Expect:** the Recent Workouts card reads **"No workouts in the last 90
days."** with **"Your plan shows that far back. Older workouts are still
saved."** underneath.

✅ **Also expect:** Total Workouts reads **0**, not the backdated one. That is
correct and is not a bug — the same 90-day window applies to the tile. If it
showed a number here, the tile and the pane would be describing different
histories.

❌ **Fail if:** it says "No workouts logged yet." — the workout exists and the
screen is denying it. That was round 1's Critical.

### The third arm cannot be produced here, and that is recorded rather than left blank
There is a third sentence — "No workouts to show." — for a server that has not
been updated to answer the question. Your server always answers it, so this arm
is unreachable in this environment and is covered by tests only. Nothing to click;
noted so a later reader does not think the step was skipped.

---

## What this sheet does NOT cover, stated rather than implied

- **Nothing about SAVING a workout changed**, so a save failure here is not this
  card's. It still writes to both backends exactly as before.
- **The "Recommended For You" pane still uses the old backend.** If it says
  "Recommendations are unavailable right now", that is expected with the third
  server off and is not a failure of this card.
- **Step 2's comparison is only as good as your account's data.** On an account
  with no workouts every number is legitimately 0, and steps 4–6 prove nothing.
  Do step 6 first in that case.

## Result

| Step | Pass / Fail | What you saw |
|---|---|---|
| 1 numbers appear | | |
| 2 match Progress | | |
| 3 window label | | |
| 4 dots = caption | | |
| 5 right days | | |
| 6 new workout appears | | |
| 7 date format | | |
| 8 blocked read → dashes | | |
| 9 new account → "logged yet" | | |
| 10 old history → "last 90 days" | | |

---

## RESULT — RUN 2026-08-15, PASSED

**Reported by Kd: all 8 steps passed.** Recorded as he gave it — as a set, not
step by step. He was asked once for the step-4 numbers and for confirmation on
steps 6 and 8 (the two that take real effort), reaffirmed "all passed", and that
is his call to make: the smoke is the step where the operator is the instrument.
**Per-step detail was not captured, and this line says so rather than inventing
it** — a later chat reading "8/8" should not believe more than was measured.

**The account was NOT Kd's own.** His three accounts' passwords are unknown and
uncommitted, and the password could not be reset from the agent session (the
write was refused by a safety classifier, twice — correctly). So the fixture was
built the way `smoke-xp-dashboard.md` builds its own: **public API only** —
register → login → PATCH timezone/weight → PUT fitness-profile → 4 × sync.
Scripts: `scratchpad/make-fixture.sh` + `sync-workouts.sh` (session scratch, not
committed). Account `dash-smoke-1786792254906@example.com` / `smoke1234`.

**THE FIXTURE WAS SHAPED TO MAKE STEPS 4 AND 5 REAL, and this is the part worth
re-using.** Today was Sat 2026-08-15 IST; the week is Mon 10th → Sun 16th.
Workouts were placed at:

| Sent (UTC) | India calls it | Why |
|---|---|---|
| 2026-08-10T04:30Z | Mon 10th, 10:00 | an ordinary earlier day |
| 2026-08-12T04:30Z | Wed 12th, 10:00 | a gap, so the dots are not contiguous |
| **2026-08-14T19:00Z** | **Sat 15th, 00:30** | **THE TIMEZONE PROBE** |
| 2026-08-15T04:30Z | Sat 15th, 10:00 | a second workout on one day |

So India sees **3 active days (Mon/Wed/Sat) and 4 workouts** — which also makes
step 4's "the tile may exceed the caption, never fall below it" a live test
rather than a tautology. **A UTC bucket would read 4 active days (Mon/Wed/Fri/
Sat) and light Friday.** That is the old defect's exact signature.

**STEP 5 WAS ALSO PROVEN BELOW THE BROWSER, and this is stronger than the visual
check the sheet asks for.** `GET /v1/progress/trend?period=7d` returned:

```
{"points":[{"date":"2026-08-10","kcal":14,"workouts":1},
           {"date":"2026-08-12","kcal":14,"workouts":1},
           {"date":"2026-08-15","kcal":28,"workouts":2}],"limitedToDays":90}
```

The 19:00Z workout is bucketed to **2026-08-15**, not the 14th. The server
buckets in the user's timezone. **This removes the sheet's "best done in the
evening or early morning" constraint** — the probe manufactures the window
instead of waiting for it, and any later re-run should do the same rather than
schedule itself around midnight.

Server-side expected values for that run: `totalWorkouts` 4 · `totalKcal` 56 ·
`totalDurationMs` 748000 · `avgFormScore` 92 · `currentStreak` 1 ·
`limitedToDays` 90 (so step 3's window label is "last 90 days", not "all time").

### Two things this run found that are NOT this card's

1. **Sign-up demands a capital letter; the server does not.** `Register.jsx:47`
   enforces uppercase + lowercase + digit client-side, while `authPasswordSchema`
   (`packages/shared/src/auth.ts`) accepts any 8–128 characters. A password the
   API would take is refused by the browser. Found by Kd, who hit it head-on.
   Logged in `BACKLOG.md`; NOT fixed here (R1.1).
2. **First boot of `apps/api` after a cold tsx cache takes MINUTES and prints
   nothing** — no "listening" line, no error, nothing on port 3000. It is
   compiling. A warm boot is ~9 s. This session killed the first boot believing
   it hung. The Setup section says "wait for it to say it is listening"; on a
   cold cache that wait is long and silent.

---

## RESULT — STEPS 9 AND 10, RUN 2026-08-16, PASSED

Run by Kd against local api (:3000) + web (:5173), on the code at T3 round 3.
**These are the two steps the previous run could not do**: its account had four
workouts, so the empty pane — where both Criticals shipped — was never on screen.

| Step | Result | What Kd saw |
|---|---|---|
| 9 new account → "logged yet" | PASS | "No workouts logged yet." and nothing about plan limits |
| 10 old history → "last 90 days" | PASS | "No workouts in the last 90 days." + "Your plan shows that far back. Older workouts are still saved." · Total Workouts **0** |

Step 10's fixture was seeded with `tools/seed-backdated-workout.mjs`
(NEW this round), which inserts one workout 120 days back for a named account —
a state the UI cannot produce, because the client stamps `startedAt` from the
device clock. **Total Workouts reading 0 is the step's second assertion, not an
incidental observation**: the tile is clamped by the same floor, so a number
there would mean the tile and the pane were describing different windows.

**The third arm ("No workouts to show.") remains unreachable here** — it is for a
server too old to answer `hasAnyWorkouts`, and this one always answers. Covered
by tests only, and recorded as such rather than left blank.

### Two environment traps this run hit, both worth knowing before the next one

1. **A leftover `vite` from an earlier session already held port 5173**, so a
   freshly started one took **5174** — where login silently fails, because
   `WEB_ORIGIN` in `apps/api/.env` names 5173 exactly and CORS rejects the other
   origin. The stale server was serving current code (vite reads from disk), so
   it was kept and the duplicate stopped. **Check what is on 5173 before
   starting a second one**; the failure looks like a broken app, not a
   misconfiguration.
2. **The seed script's first version guessed two column types wrong.**
   `workouts.bundle_version` and `workout_sets.definition_version` are INTEGER,
   not the dotted string the sync payload carries. It failed inside a
   transaction, so nothing was written — but the types were then read from
   `information_schema` rather than inferred from the payload shape, which is
   what the script now ships with.

