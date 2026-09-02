# SMOKE — the gym's numbers on the console home screen

**What this checks:** the numbers that now sit at the top of your gym's home
screen — how many people came today, how many this week, and the eight-week
chart underneath. Built 2026-09-03 (`DECISIONS.md:30399`), on top of the server
half from 2026-09-02 (`:30094`).

**Why it matters:** these are the first numbers this product has ever shown a gym
owner about their own gym. Every one of them is counted on the server; the screen
is only allowed to draw them. The tests prove the arithmetic — what nobody has
ever done is look at it.

---

## Before you start

**The whole sheet is yours to run start to finish. No pauses, no commands.**

I have already done the setup, and it is written down here rather than left for
you to discover:

- **Both servers are already running.** If you need to restart them:
  ```
  cd apps/api && node --import tsx --env-file=.env src/index.ts
  corepack pnpm --filter web exec vite
  ```
- **Nothing was added to your database for this sheet.** I looked at what is
  already there and wrote the expected numbers from it. The one visit it talks
  about is the real one you made yourself during the attendance smoke yesterday.
- **Your account:** `owner@example.com` — you know the password. It is both the
  **owner** of *Smoke Test Gym* and a **member** of it, which is what lets one
  run cover both ends.

**What your gym looks like right now, so you can tell a right answer from a
wrong one:**

| | |
|---|---|
| Today at your gym | Thursday 3 September |
| Visits ever recorded | **one**, on Wednesday 2 September |
| The week that visit is in | this one (weeks start on Monday) |
| The week before | nothing at all |
| Members who pay | **none** — your own seat is a free owner's seat |

---

## The links

| # | Where | Link |
|---|---|---|
| A | Sign in | http://localhost:5173/login |
| B | **Your gym's home screen** (the numbers) | http://localhost:5173/console/smoke-test-gym |
| C | **My Gyms** (where you tap "I'm here") | http://localhost:5173/my-gyms |

---

## PART A — what the numbers say before you touch anything

### 1 · Sign in and open your gym

Go to **A**, sign in, then open **B**.

✅ Under your gym's name there is a box headed **"Who's turning up"**.

❌ If there is no such box at all, stop here and tell me — everything below
depends on it.

### 2 · Today

Look at the **Today** figure inside that box.

✅ It reads **`0 people`**.

That is the right answer, not a broken one: your one visit was yesterday, and
nobody has marked themselves in today yet. You are about to change it in Part B.

### 3 · This week

Look at **This week**.

✅ It reads **`1 person`**, and underneath it says **"Nothing was recorded last
week."**

❌ If there is an up or down arrow with no words next to it, that is a defect —
tell me. The two weeks are not the same length (this week is three days old, last
week was seven), so an arrow on its own would be telling you something untrue.

### 4 · The tile that is deliberately NOT there

✅ There is **no "Last 30 days" tile and no percentage anywhere.**

Your gym has no paying members — your own seat is a free owner's seat — so there
is no share of members to report. The app is meant to say **nothing** here rather
than print **0%**, which would read as "your members are ignoring you" on a gym
that simply has none yet.

❌ If you see **`0%`**, that is the defect this step exists to catch.

### 5 · The chart

Below the tiles there is a row of bars with a line over it, and a row of dates
underneath.

✅ There are **eight** date labels, ending with a date at the right-hand end.
✅ Only the **last** bar has any height. The other seven are flat.
✅ Under the chart it says **"This is your first week of attendance — the chart
fills in as the weeks pass."**

### 6 · Hover the bars

Rest your mouse on the **last** bar (the one with height) and wait a second for
the little tooltip.

✅ It says **"This week so far: 1 visit, 1 person"**.

Now hover any of the flat bars.

✅ It says **"Week of «some date»: 0 visits, 0 people"** — a real week with a
real zero, not a blank.

❌ If the last bar says "Week of …" instead of **"This week so far"**, tell me.
That bar is short because the week is not finished, and it has to say so — or
every Monday your gym will look like it has collapsed.

---

## PART B — mark yourself in, and watch the numbers move

### 7 · Say "I'm here"

Open **C** (My Gyms) and tap the button that marks you in at *Smoke Test Gym*.

✅ The screen confirms you have been marked in, the way it did in the attendance
smoke.

### 8 · Back to the numbers

Go back to **B** and **reload the page** (F5).

✅ **Today** now reads **`1 person`**.
✅ **This week** now reads **`1 person · 2 visits`**.

That second line is the interesting one. Two visits, one person — because you
came yesterday and again today. **It only shows the second number when they
differ**, which is how "somebody came twice" is visible at a glance.

❌ If This week reads `2 people`, that is wrong — two visits by you are still one
person, and that distinction is the one your whole attendance feature rests on.

### 9 · The chart again

Hover the last bar once more.

✅ It now says **"This week so far: 2 visits, 1 person"**.

---

## PART C — what happens when it cannot load

### 10 · Pull the plug

With your gym's home screen open, turn your **Wi-Fi off** (or put the browser's
dev-tools network into Offline), then reload the page.

✅ You get **one** red failure card with a **Try again** button — not two, not
four.
✅ You do **not** see the numbers box showing zeros.

❌ Zeros over a failed load is the single most repeated defect in this project's
history: it tells an owner nobody came when in truth we could not ask.

### 11 · Put it back

Turn Wi-Fi back on and press **Try again**.

✅ The screen fills in again, with the same numbers as step 8.

---

## What this sheet does NOT cover, and why

Written down rather than left for somebody to assume later:

- **The up/down arrow against last week.** Your gym has no history before this
  week, so there is nothing to compare against and the screen correctly says so.
  Reaching it needs a gym with two weeks of visits, which yours will have next
  week.
- **A full eight-week chart.** Same reason — one week of history exists.
- **The "nobody has come" and "no members yet" screens.** Your gym has both a
  visit and a member, so neither state can be reached from your account without
  making a throwaway gym.
- **What a trainer sees when the owner unticks "See who came in".** That needs a
  second person's account.

All four are held by the automated tests and by the mutation audit
(`DECISIONS.md:30399`, mutants C155–C166) — which is not the same as somebody
having looked at them, and this line says so on purpose.
