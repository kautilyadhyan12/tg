# SMOKE — attendance, both halves

**What this checks:** a member telling their gym *"I'm here"*, and the gym seeing
who came. It covers **both halves in one run** — the member's `My Gyms` screen
(built 2026-09-02, `DECISIONS.md:28822`, reviewed at `:28976` and `:29117`) and
the owner's console **Attendance** section (`DECISIONS.md:29250`).

**Why it matters more than usual:** every attendance surface has shipped without
a single browser click. The member half's review found two defects a
click-through would have caught — a history that showed one day instead of
months, and a visit that vanished — and both were found by reading code, not by
looking at a screen.

---

## Before you start

**The whole sheet is yours to run start to finish. No pauses, no commands.**

I have already done the setup, and it is written down here rather than left for
you to discover:

- **Your database was four migrations behind and I brought it up to date**
  (2026-09-02, with your yes). Nothing was deleted — it added the *who came in*
  table, the on/off switch column, and the opening-hours tables. Both your gyms
  automatically gained the new *"See who came in"* permission.
- **I created three throwaway gyms and about six `probe-…@example.com` accounts**
  while checking the server end to end. They are not yours and appear on none of
  your screens. Ignore them.
- **Neither of your gyms has ever been on a plan**, so the console will ask you
  to start the free trial before it lets you do anything. **That is step 2 and it
  is expected** — it is not a bug, and both your accounts still have their one
  trial available.

**Your account:** `owner@example.com` — you know the password. This one account
is both the **owner** of *Smoke Test Gym* and a **member** of it, which is what
lets one run cover both halves.

**Both servers are already running.** If you need to restart them:

```
cd apps/api && node --import tsx --env-file=.env src/index.ts
corepack pnpm --filter web exec vite
```

---

## The links

| # | Where | Link |
|---|---|---|
| A | Sign in | http://localhost:5173/login |
| B | Your gym's console | http://localhost:5173/console/smoke-test-gym |
| C | **Attendance** (the new section) | http://localhost:5173/console/smoke-test-gym/attendance |
| D | Console settings | http://localhost:5173/console/smoke-test-gym/settings |
| E | **My Gyms** (the member screen) | http://localhost:5173/my-gyms |

---

## PART A — the member says "I'm here"

**1 · Sign in.** Open **link A**, choose the **member** door, sign in as
`owner@example.com`.
✅ You land in the app (dashboard), not the console.

**2 · The nav item exists.** Look at the left-hand menu.
✅ There is an item called **My Gyms**, below the others.
❌ If it is missing, stop and tell me — that is the whole feature failing to
appear.

**3 · Open it.** Click **My Gyms** (or open **link E**).
✅ You see a card headed **Smoke Test Gym**.
✅ On it: a button reading **I'm here**.
✅ Under the heading *"Days you came"* it says **you haven't marked yourself in
here yet** — because nobody ever has.

**4 · Tap the button.** Click **I'm here**.
✅ A line appears saying **"You're marked in."** and nothing more.
✅ **It must NOT mention opening hours** — not "outside hours", not "closed",
nothing about times. This gym has never set opening hours, and *"nobody has
answered"* is not *"you came at a strange time"*. **A sentence about hours here
is a real defect — tell me.**
✅ A date appears under *"Days you came"* with a time beside it, e.g. `11:42`.
✅ **The time should be the time it is now where your gym is** (this gym's zone
is Kolkata) on a 24-hour clock.

**5 · Tap it a second time.**
✅ The line changes to **"You're already marked in."**
✅ **Still only ONE time chip on that day** — not two. You came once; the second
tap was the same visit.

**6 · Reload the page** (F5).
✅ The day and its time are **still there** — it was really saved, not just drawn.

---

## PART B — the gym sees who came

**7 · Cross to the console.** Sign out, open **link A** again, and this time
choose the **gym owner** door. Sign in as the same `owner@example.com`.
*(The two doors are the only way across — that is deliberate.)*

**8 · Start the trial.** You will be shown a prompt you cannot dismiss, asking
you to start the free trial.
✅ Start it. The console becomes usable.
*(Expected, not a fault: this gym has never been on a plan.)*

**9 · The new section exists.** Look at the left rail.
✅ There are now **four** items: Gym · Members · **Attendance** · Settings.

**10 · Open Attendance** (**link C**).
✅ A heading **Attendance** and today's date.
✅ **The day's shape first**: a line reading **"Before opening times were set"**
with **1 person** beside it.
✅ Below it, under **Who came**, **one row** with **your own name** and **one
time chip** — the same time you saw in step 4.
✅ **No red marks, no warnings.** Nobody did anything wrong.

**11 · The number is the gym's, not the page's.** Look at the count in the top
right of the day card.
✅ It reads **1 person** — and *not* two, even though you tapped twice.

**12 · Open your own history.** Click your name in the list.
✅ A panel opens under it headed **"— when they came"** showing the day you came.
✅ Click the ✕ to close it.

**13 · Move a day back.** Click the **‹** arrow beside the date.
✅ The date changes to yesterday.
✅ It says **nobody has marked themselves in on this day yet** — *not* an error,
and *not* your name carried over from today.
✅ Click **›** to come back to today; your row is there again.

---

## PART C — the switch and the permission

**14 · Turn marking off.** Open **link D** (Settings). Find the section headed
**Marking attendance**.
✅ The shut heading already tells you the state: **"Members can mark themselves
in"**.
✅ Open it and untick **"Let members mark themselves in"**.
✅ The heading now reads **"Switched off"**.

**15 · Check the member's side went with it.** Sign out, sign in through the
**member** door, open **link E**.
✅ The **I'm here** button is **GONE** — not greyed out, gone.
✅ **Your visit from step 4 is still listed.** It really happened; switching the
gym's button off must not erase your history.

**16 · Turn it back on.** Owner door → **link D** → tick it again.
✅ Back to *"Members can mark themselves in"*, and the button returns on the
member screen.

**17 · The permission box.** Still on **link D**, open the **Staff** section.
✅ In the list of what a staff member can do there is a box reading **"See who
came in"**.
*(Your gym has only you on staff, so there may be nothing to tick it against —
if so, just confirm the wording exists somewhere on that screen and move on.)*

---

## PART D — optional, and the one step I could NOT test myself

**Skip this if you are short of time.** Everything above I ran end to end against
the real server before writing it. **This part I could not** — I hit a login
limit while probing and could not observe it. So if it misbehaves, that is
genuine new information rather than a step I got wrong.

**What it checks:** Kd's own ruling that *"if a member comes in a different slot
that counts again and the owner can see they attended two times"* — one row, two
times.

**18 · Give the gym opening hours.** Owner door → **link D** → **When we're
open** → set today's hours to a window that **includes right now** (say an hour
either side of the current time), and save.

**19 · Mark in again.** Member door → **link E** → **I'm here**.
✅ This time it should say **"You're marked in — the … session."** naming the
window.

**20 · Look at the gym's view.** Owner door → **link C**.
✅ **ONE row with your name, carrying TWO time chips** — not two rows.
✅ The day's count now reads **1 person · 2 visits** — the two numbers differ,
which is the whole point of the ruling.
✅ **Two lines** in the day's shape: one *"Before opening times were set"*, one
for the session.

---

## Reporting back

Just tell me the step numbers that passed and any that did not, with what you saw
instead. **A failure here is worth more than a pass** — it is the first time any
of this has been in front of a person.

---

## RESULT

**PARTS A AND B — PASSED 8/8, 2026-09-02**, run by the chat against the real
server and reported at `DECISIONS.md:29410`.

**PARTS C AND D — PASSED, 2026-09-02, run by KD at the browser** on the shipping
bytes of `8eacc54`, reported as *"all passed"*. **THE SHEET IS THEREFORE COMPLETE
AND THE `OWED.md` ATTENDANCE LINE TICKS.**

**WHAT THAT PASS COVERS AND WHAT IT DOES NOT, so nobody reads it as wider than it
is** (:23535's rule — the record says what happened):

- **Steps 14–20 were run by Kd and reported by him; the chat observed none of
  them.** That is the ordinary shape of this gate, not a weakness — no step
  needed a terminal command, so :23535's failure mode (a step requiring the
  chat's action reported as passed while the chat had not acted) cannot apply
  here. Every step was a browser click he could make alone.
- **Part D was optional and he ran it anyway**, which is the part worth having:
  it is the only observation this project has of Kd's ruling 12 at a screen — one
  member, two sessions, **one row with two time chips and a count reading
  `1 person · 2 visits`**. `dayTotalsLine` prints the second number ONLY when it
  differs from the first, so that ✅ could not have been satisfied by a day with
  one visit.
- **It was run on the bytes of `8eacc54`** — verified with
  `git diff HEAD --name-only -- apps/web/src packages/shared/src apps/api/src`
  returning empty, not asserted (:14956, :15198: nothing ticks that the browser
  has not seen on the shipping bytes).
- **The API server was DOWN when the steps were handed over** and this sheet's
  *"both servers are already running"* was stale. Started before he began, both
  answering 200. **A sheet's setup section ages** (:5041) — check it rather than
  quoting it.

**STILL NOT COVERED BY ANY BROWSER RUN, and none of it is this card's:** the QR
path (phone app, :26558/:26586) · staff marking somebody present (:27900, "not
now") · a second gym's owner · anything on a phone.
