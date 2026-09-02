# SMOKE — the gym's numbers on the console home screen

**What this checks:** the numbers that now sit at the top of your gym's home
screen — how many people came today, how many this week, and the eight-week
chart underneath. Built 2026-09-03 (`DECISIONS.md:30399`), redesigned the same
day after Kd looked at it (`:30399` addendum), on top of the server half from
2026-09-02 (`:30094`).

**Why it matters:** these are the first numbers this product has ever shown a gym
owner about their own gym. Every one of them is counted on the server; the screen
is only allowed to draw them. The tests prove the arithmetic — what nobody had
ever done is look at it, and the first look found a real defect.

---

## Before you start

**The whole sheet is yours to run start to finish. No pauses, no commands.**

- **Both servers are already running.** If you need to restart them:
  ```
  cd apps/api && node --import tsx --env-file=.env src/index.ts
  corepack pnpm --filter web exec vite
  ```
- **Your sign-in:** `owner@example.com` / **`Smoke2026!`**
  The old password was not written down anywhere and nobody knew it, so it was
  reset on 2026-09-03 and the new one is proven to work (a real sign-in returned
  200). **This is written down here so the next run does not lose it again.**
- **Nothing was invented for this sheet.** The numbers below were read out of
  your database, and every visit they mention is one you made yourself.

**TWO of your gyms are used, and they are used for different things** — the sheet
says which at each step, because they are in different time zones and their days
have not rolled over together:

| Gym | Its own date right now | What it is good for |
|---|---|---|
| **owner** (*new yprk*) | 2 September | it has 2 members, so the 30-day tile and its explanation appear |
| **Smoke Test Gym** | 3 September | nobody has come today yet, so you can watch a number move |

---

## The links

| # | Where | Link |
|---|---|---|
| A | Sign in | http://localhost:5173/login |
| B | **The "owner" gym** | http://localhost:5173/console/owner |
| C | **Smoke Test Gym** | http://localhost:5173/console/smoke-test-gym |
| D | **My Gyms** (where you tap "I'm here") | http://localhost:5173/my-gyms |

---

## PART A — the numbers, on the gym that has members

Sign in at **A**, then open **B**.

### 1 · The box is there

✅ Under the plan card there is a box headed **"Who's turning up"**, holding
three panels side by side.

### 2 · Today

✅ **Today** reads **`1 person`** — the visit you made during the attendance
smoke.

### 3 · This week

✅ **This week** reads **`1 person`**, and under it **"Nothing was recorded last
week."**

❌ An up or down arrow with **no words** beside it is a defect. This week is two
days old and last week was seven, so an arrow alone would be comparing two
different lengths and telling you something untrue.

### 4 · Last 30 days — and the sentence under the row

✅ **Last 30 days** reads **`0%`**, with **"0 of 2 members came in the last 30
days"** under it.

✅ **Below all three panels** there is a line beginning **"Free seats —"**.

**This is the fix from your screenshot.** Both numbers were already correct and
together they read like the screen contradicting itself: *somebody came today*,
yet *no members came this month*. The reason is that the person who came was
**you, on the owner's free seat**, and a free seat is deliberately left out of
the members' share — otherwise every gym would look busier than it is. Nothing
was hidden to tidy this up; the screen now says why.

❌ If the two numbers are there but the "Free seats" line is missing, that is the
defect returning.

### 5 · The chart

✅ **Eight columns**, each faintly visible even where nobody came — a quiet week
is a fact, not a blank.
✅ Numbers **on the left** marking the top and bottom of the scale.
✅ A **key** on the right: a small orange square for *visits*, a short line for
*different people*.
✅ Only the **last** column is filled, and it is **lighter** than the rest — that
is the "this week isn't finished" shading.
✅ Under the chart: **"This is your first week of attendance — the chart fills in
as the weeks pass."**

### 6 · Hover the columns

Rest your mouse on the **last** column.

✅ **"This week so far: 1 visit, 1 person"**.

Hover any empty column.

✅ **"Week of «some date»: 0 visits, 0 people"** — a real week with a real zero.

❌ If the last column says "Week of …" instead of **"This week so far"**, tell me:
that column is short because the week is not over, and it has to say so.

---

## PART B — watch a number move

Now switch gyms, because at *Smoke Test Gym* the day has already rolled over and
nobody has come yet.

### 7 · Look first

Open **C**.

✅ **Today** reads **`0 people`**.
✅ **This week** reads **`1 person`**.
✅ There is **no "Last 30 days" panel and no percentage anywhere** — that gym has
no members other than your own free seat, so there is no share to report. Seeing
**`0%`** there would be the bug.

### 8 · Mark yourself in

Open **D** (My Gyms) and tap the button to mark yourself in at **Smoke Test
Gym**.

✅ It confirms you have been marked in.

### 9 · Back to the numbers

Return to **C** and **reload (F5)**.

✅ **Today** now reads **`1 person`**.
✅ **This week** now reads **`1 person · 2 visits`**.

Two visits, one person — you came yesterday and again today. **It only shows the
second number when they differ**, which is how "somebody came twice" is visible
at a glance.

❌ If This week says `2 people`, that is wrong: two visits by you are still one
person.

### 10 · The chart again

✅ Hovering the last column now says **"This week so far: 2 visits, 1 person"**.

---

## PART C — what happens when it cannot load

### 11 · Pull the plug

With a gym's home screen open, turn your **Wi-Fi off** and reload the page.

✅ **One** red failure card with a **Try again** button — not two, not four.
✅ **No numbers box showing zeros.**

❌ Zeros over a failed load is the most repeated defect in this project's
history: it tells an owner nobody came when the truth is we could not ask.

### 12 · Put it back

Turn Wi-Fi on and press **Try again**.

✅ The screen fills in again with the same numbers as step 9.

---

## What this sheet does NOT cover, and why

Written down rather than left for somebody to assume later:

- **The up/down arrow against last week.** Neither gym has visits in two
  different weeks yet, so there is nothing to compare and the screen correctly
  says so. It becomes reachable next week.
- **A full eight-week chart.** Same reason — one week of history exists.
- **The "nobody has come at all" screen**, which needs a gym with members and no
  visits.
- **What a trainer sees when the owner unticks "See who came in".** That needs a
  second person's account.

All four are held by the automated tests and the mutation audit
(`DECISIONS.md:30399`, mutants C155–C168) — which is not the same as somebody
having looked at them, and this line says so on purpose.
