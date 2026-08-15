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
