# SMOKE — the gym's numbers on the console home screen

> ## ⚠️ STALE — DO NOT RUN AS WRITTEN (marked 2026-09-03)
>
> **It passed, and then the screen changed underneath it the same day.** Kd's
> rulings at `DECISIONS.md:30867` and `:31008` removed two things this sheet
> tells you to look for, so a run today would report failures that are not
> failures. **Named rather than left to be discovered:**
>
> - **Step 3's amber box is GONE.** *"2 of today's 3 visits were outside your
>   opening hours"* came off the dashboard at his instruction — *"remove these
>   what are these even doing"* — and `exceptionsNote` was deleted with it.
>   Grep-verified: no such string anywhere in the panel or its view file.
>   **It is coherent rather than a loss, because the button now REFUSES outside
>   opening hours, so no new odd arrival can be created.** Where an existing one
>   still shows is the Attendance screen, on the visit's own chip.
> - **Step 4's initials circles are GONE** — *"OW / owner what the fuck is ow
>   shit"*. Grep-verified: nothing renders them.
> - **Step 6's chart gained a sentence.** On a gym in its first week it now also
>   reads **"Your first week — the earlier columns fill in as the weeks pass."**
>   under the columns.
>
> **AND ITS NUMBERS WERE NEVER SAFE TO ASSERT.** Every ✅ in Part A names a
> literal — `2 people`, `3 visits`, `33%`, `03:32` — against a database that is
> shared, seeded and added to. They were true on 2026-09-03 and are not a
> property of the screen. A rewrite must express them as relationships (*"the
> big number is people, the caption is visits, and they differ"*) the way
> `smoke-attendance.md` now does.
>
> **Its `OWED.md` line carries the rewrite.** Parts B and C are unaffected by
> either ruling. **The recorded PASS below stands for the bytes it was run on
> and is not carried forward** (:29870).

**What this checks:** the panel at the top of a gym's home screen — how many
people came, who they were, whether the gym was even open when they arrived, and
the eight-week chart. Built 2026-09-03 (`DECISIONS.md:30399`) and rebuilt twice
the same day after Kd looked at it (`:30624`, `:30733`).

**Why it matters:** both rebuilds came from him opening the screen, not from a
test. The suite was green and the screen was still wrong — first two correct
numbers reading as a contradiction, then a visit made when the gym was shut
counted as an ordinary visit.

---

## Before you start

**The whole sheet is yours to run start to finish. No pauses, no commands.**

- **Both servers are already running.** If you need to restart them:
  ```
  cd apps/api && node --import tsx --env-file=.env src/index.ts
  corepack pnpm --filter web exec vite
  ```
- **Your sign-in:** `owner@example.com` / **`Smoke2026!`**
- **Nothing was set up for this sheet.** Every number below was read out of your
  database just now, and every visit in it is one you made yourself.

**Two of your gyms are used, and for different things** — they are in different
time zones, so their days have not rolled over together:

| Gym | Its own date | Why this sheet uses it |
|---|---|---|
| **owner** (*new yprk*) | 2 September | three visits, two of them outside opening hours, two different people, and it has members — every part of the panel is switched on |
| **Smoke Test Gym** | 3 September | quiet, so you can watch a number move |

---

## The links

| # | Where | Link |
|---|---|---|
| A | Sign in | http://localhost:5173/login |
| B | **The "owner" gym** | http://localhost:5173/console/owner |
| C | **Smoke Test Gym** | http://localhost:5173/console/smoke-test-gym |
| D | **My Gyms** (where you tap "I'm here") | http://localhost:5173/my-gyms |

---

## PART A — the panel, on the gym with real activity

Sign in at **A**, then open **B**.

### 1 · Three panels, each a number

✅ A box headed **"Who's turning up"**, with three panels under it. Each shows a
**big number** with a small word beside it — not a sentence.

| Panel | Big number | Small word | Line under it |
|---|---|---|---|
| Today | **2** | people | `3 visits` |
| This week | **2** | people | `3 visits`, then "Nothing was recorded last week." |
| Last 30 days | **33%** | — | "1 of 3 members came in the last 30 days" |

❌ If a panel reads `2 people · 3 visits` as one line of text, you are looking at
the old version — hard-reload with **Ctrl+Shift+R**.

### 2 · The "Free seats" line

✅ Under the three panels: a line starting **"Free seats —"**.

This is the fix from your first screenshot: 2 people came today, yet only 1 of 3
members came this month. Both true — one of the visitors is on the owner's free
seat, which is left out of the members' share.

### 3 · ⚠️ The gym was not open — the thing you spotted

✅ An **amber box** saying: **"2 of today's 3 visits were outside your opening
hours."**

**This is the defect you found.** You marked yourself in outside opening hours,
your member screen said so, and this screen just said "3 visits" as if the gym
had been busy.

❌ If it says **3** instead of 2, that is wrong: your earliest visit today
(03:32) was made *before* the gym had any opening hours set at all, and "we never
said when we're open" is not the same as "you came when we were shut". A gym that
has never filled in its hours must never be told its members arrived oddly.

### 4 · Who came today — names and times

✅ A section headed **"Who came today"** with two rows:

| | |
|---|---|
| **owner** | `03:32`  ·  `17:01 — outside hours` |
| **test** | `17:07 — outside hours` |

✅ Each name has a small orange circle with their initials.
✅ **owner has TWO time chips** — that is "came twice", visible without reading a
sentence.
✅ The chips for the outside-hours visits are amber and say so; the 03:32 one is
plain grey.

### 5 · The way through to everything

✅ Top-right of the panel: an **Attendance →** link.
✅ Under the names: **"See times, days and everyone else →"**.

Click either one. ✅ You land on the full Attendance screen, with the whole day,
a filter for the unusual arrivals, and a search by name. Click a person there and
you get their own history.

**This is what was missing when you asked "how can a gym get correct information
from it" — the number was a dead end.**

### 6 · The chart

✅ **Eight columns you can see**, including the empty ones. A scale on the left
(top number and `0`). A key on the right: orange square = *visits*, line =
*different people*. The **last column is lighter** — that is "this week isn't
finished".
✅ Hover the last column → **"This week so far: 3 visits, 2 people"**.
✅ Hover an empty one → **"Week of «date»: 0 visits, 0 people"**.

---

## PART B — watch it move

Open **C** (Smoke Test Gym).

### 7 · Before

✅ **Today** reads **1** / person. **This week** reads **1** / person with
`2 visits` under it.
✅ **No percentage anywhere** — that gym has no paying members, so there is no
share to report. `0%` there would be the bug.
✅ **No amber box** — that gym has never set opening hours, so nothing about its
visits is unusual.
✅ **"Who came today"** shows **owner** with one chip, `01:30`, plain grey.

### 8 · Mark yourself in again

Open **D** and tap the button for **Smoke Test Gym**.

### 9 · After

Back to **C**, reload (**F5**).

✅ **Today** now reads **1** / person with **`2 visits`** underneath — you came
twice today.
✅ **"Who came today"** shows **owner** with **two chips** now.

❌ If Today's big number becomes **2**, that is wrong — two visits by you is
still one person, and that distinction is what the whole feature rests on.

---

## PART C — when it cannot load

### 10 · Wi-Fi off, reload

✅ **One** red card with **Try again** — not two, not four.
✅ **No panel showing zeros.**

### 11 · Wi-Fi on, press Try again

✅ Everything comes back as in step 9.

---

## What this sheet does NOT cover, and why

- **The up/down arrow against last week** — neither gym has visits in two
  different weeks yet, so the screen correctly says "Nothing was recorded last
  week" instead. Reachable next week.
- **A full eight-week chart** — one week of history exists.
- **A gym with lots of people** — the names list previews five and links to the
  rest. Your busiest day has two.
- **What a trainer sees when the owner unticks "See who came in"** — needs a
  second person's account.
- **A member's email address** — deliberately not shown. Part 3 §2.4 is a promise
  made to members at the join door listing what a gym can see, and email is not
  on it. **This is an open question for you** (`DECISIONS-INDEX.md` §2), not an
  oversight.

These are held by tests and by the mutation audit
(`DECISIONS.md:30733`, mutants C155–C176) — which is not the same as somebody
having looked at them, and this line says so on purpose.
