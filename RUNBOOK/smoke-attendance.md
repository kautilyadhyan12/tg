# SMOKE — attendance, both halves

**What this checks:** a member telling their gym *"I'm here"*, the gym refusing
that when it is shut, and the gym seeing who came. It covers the member's
**My Gyms** screen and the owner's console **Attendance** section.

**Why it was rewritten (2026-09-03):** the previous version was eleven commits
old and several of its ✅ named things that are no longer on screen — the day's
shape section and the odd-arrival line were both **removed at Kd's instruction**
that day, and the button now REFUSES outside opening hours instead of recording
a marked visit. **Every ✅ below was checked against the code as it stands, not
remembered.**

**CORRECTED 2026-09-04, and the sentence above is why it needed correcting.** It
was true when written and stopped being true the next day: `:32929` folded the
week away behind a **This week** tap and the **Days you came** calendar was
already folded, so **four ✅ on this sheet named things no tester could see** —
step 6's weekday list and steps 10–12's calendar. Found by T3 round 2 on
`:32929`/`:33091`. **A sheet that states when it was checked is making a claim
with a date on it, and this is the fourth time in three days that a step has
named a screen the app had moved** (`:32498`, `:33265` §1, `:33334` C/H-1).
Steps 10 and 12 now tell you to open the calendar; nothing else about the run
changed. **This sheet has NOT been re-run in its corrected form.**

---

## Before you start

**The whole sheet is yours to run start to finish. There is nothing for you to
type into a terminal.** If a page will not load, say so and the servers get
restarted — that is my job, not a step.

**Your account:** `owner@example.com`. It is the **owner** of the gym called
**owner**, and a **member of both gyms**, which is what lets one run cover both
halves.

**THE TWO GYMS ARE DIFFERENT ON PURPOSE, and this is the part to read before
you start** — the state below was read out of the database while writing this,
not assumed:

| | **owner** | **Smoke Test Gym** |
|---|---|---|
| Its clock | Argentina, shown as **4:00 PM** | India, shown as **16:00** |
| Opening hours | **Set**, a timetable for all seven days | **Never set** — nobody has answered |
| Plan | On the free trial | **None, and it cannot start one** |
| You are | Owner **and** member | Member only |

**So all console work happens on the gym called `owner`.** Do not open Smoke
Test Gym's console: your one free trial is already spent on the other gym, so it
will only show you a subscribe prompt with nowhere to go. That is correct
behaviour, not a fault, and it is not what this sheet is for.

**Nothing below depends on what time it is.** You will switch the gym between
open and shut yourself, so every ✅ is true whenever you run it.

---

## The links

| # | Where | Link |
|---|---|---|
| A | Sign in | http://localhost:5173/login |
| B | **My Gyms** (the member screen) | http://localhost:5173/my-gyms |
| C | **Attendance** (the owner's section) | http://localhost:5173/console/owner/attendance |
| D | Console settings | http://localhost:5173/console/owner/settings |

---

## PART A — what the member's card says

**1 · Sign in.** Open **link A**, choose the **member** door, sign in.
✅ You land in the app, not the console.

**2 · The nav item.** Look at the left menu.
✅ There is an item called **My Gyms**.

**3 · Open it** (**link B**).
✅ **Two** gym cards: one headed **owner**, one headed **Smoke Test Gym**.

**4 · The gym that has never set hours.** Find the **Smoke Test Gym** card.
✅ It says **nothing at all about opening times** — no times, no weekday list,
and above all **not the word "Closed"**.
❌ If it says the gym is closed, stop and tell me. Nobody has ever set hours for
that gym, and *"nobody has answered"* is not *"we are shut"*.

**5 · What the button is for.** On that same card, look just above the button.
✅ A small heading **ATTENDANCE**, and under it
**"Pressing this marks your attendance at the gym."**
✅ The **I'm here** button is bright and clickable.

**6 · The gym that has set hours.** Find the **owner** card.
✅ A line beginning **Today:** followed by that gym's hours for today, on a
**12-hour clock** — so **7:40 AM – 9:40 AM**, not `07:40`.
✅ Under it, a row reading **This week** with a small arrow — and **no list of
weekdays until you tap that row.** The week is folded away by design. If seven
weekdays are already showing without a tap, that is a fault — stop and say so.

---

## PART B — the button refuses when the gym is shut

*This is Kd's ruling of 2026-09-03: "if a gym has set certain times not 24 hour
then if a memeber comes outside of time should not be able to press i am here".*

**7 · Shut the gym for today.** Owner door → **link D** → the section **When
we're open** → under **Closed on a date**, pick **today** and save.
✅ It appears in the list of closures.

**8 · Look at the member's card.** Member door → **link B** → the **owner** card.
✅ At the top of that card it now says **Closed today**.
✅ The **I'm here** button is **faded, and clicking it does nothing.**
✅ Under the button: **"Your gym is closed today, so attendance isn't open."**
❌ If it says *"isn't open right now"* instead, tell me — that is the wrong one
of two sentences, and telling them apart is the whole point of this step.

**9 · Open the gym around the clock.** Owner door → **link D** → **When we're
open** → **remove today's closure**, then choose **Open 24 hours** and save.
✅ The section's summary reads **"Your gym is open 24 hours."**

**10 · The button comes back.** Member door → **link B** → the **owner** card.
✅ It says **Open 24 hours** and lists no weekdays.
✅ **I'm here** is bright again.
✅ Press it. A line appears saying you are marked in, and it mentions the gym
being open 24 hours.
✅ Now **tap the row that reads "Days you came"** — like the week, it is folded
away until you do. The month opens and **today's date carries a time beside
it**, on the **12-hour** clock.

**11 · Press it a second time.** Leave the calendar open from the last step.
✅ The line changes to say you are **already** marked in.
✅ **Still only ONE time** on that day — you came once.

**12 · Reload the page.** Then **tap "Days you came" open again** — a reload
folds it back, and that is correct, not a fault.
✅ The day and its time are still there. It was really saved.

**13 · Your timetable survived.** Owner door → **link D** → **When we're open**
→ choose **Set opening times**.
✅ **Your whole week is still there**, every day, exactly as it was before step 9
— nothing to retype.
✅ Save it, so the gym is back on its timetable.
❌ If the days are empty, stop and tell me. That is the defect you found on
2026-09-03 coming back.

---

## PART C — the gym sees who came

**14 · Open Attendance.** Owner door → **link C**.
✅ A heading **Attendance**, and under it
**"Who came in, by day. Times are your gym's own."**
✅ A date, with **‹** and **›** arrows either side of it.

**15 · One section, and it folds.** Below the date.
✅ **One** section headed **Who came**, already open, with a count beside the
heading.
✅ Click the heading. **It closes.** Click again. **It opens.**
❌ If clicking does nothing, tell me — that is the dropdown fault from
2026-09-03 returning.

**16 · Your own row.** In that section.
✅ **One row with your name**, and **your email address underneath it**.
✅ **No circle with initials** beside the name — those were removed.
✅ One or more time chips on the row, showing when you came.

**17 · Somebody who came twice.** If your row has more than one time chip:
✅ Beside the name it says **visited 2 times** in words.
✅ If a row has only ONE chip, it says **nothing** of the kind — no
*"visited 1 times"*.

**18 · Open one person's history.** Click your name.
✅ A panel opens underneath showing the days that person came.
✅ Click the ✕ to close it.

**19 · Move a day back.** Click **‹**.
✅ The date changes to yesterday.
✅ If nobody came that day it says so plainly — **not** an error, and **not**
your name carried over from today.
✅ Click **›** to return to today; your row is back.

**20 · Search.** Type part of your name into **Search by name**.
✅ Your row stays. Type something nobody is called.
✅ A sentence saying nobody by that name came in — again, not an error.

---

## PART D — the switch and the permission

**21 · Turn marking off.** Owner door → **link D** → the section **Marking
attendance**.
✅ Its closed heading already tells you the state.
✅ Open it and untick **"Let members mark themselves in"**.
✅ The heading changes to say it is switched off.

**22 · Check the member's side went with it.** Member door → **link B** → the
**owner** card.
✅ The **I'm here** button is **GONE** — not faded, gone.
✅ **The "Pressing this marks your attendance" line is gone with it** — an
explanation of a button that is not there would be a sentence about nothing.
✅ **Your visits are still listed.** They really happened; switching the gym's
button off must not erase your history.

**23 · Turn it back on.** Owner door → **link D** → tick it again.
✅ The button returns on the member screen.

**24 · The permission box.** Still on **link D**, open the **Staff** section.
✅ Somewhere in the list of what a staff member may do, there is a box reading
**"See who came in"**.

---

## Reporting back

Tell me the step numbers that passed and any that did not, **with what you saw
instead**. A failure here is worth more than a pass.

**If you stop part-way, say where you stopped** rather than "all passed" — on
2026-09-03 a step was abandoned mid-way and the sentence it covered went
unobserved for two more commits before anybody noticed.

---

## RESULT

**NOT YET RUN.** This sheet was rewritten 2026-09-03 against the screens as they
stand after `a1c5005`, `dba7cbe`, `00c2699` and the rulings at `DECISIONS.md`
`:30867`, `:31008`, `:31098`, `:31295`, `:31352` and `:31508`.

**WHAT THE PREVIOUS VERSION'S PASS COVERED, kept because it is real and must not
be re-claimed by this sheet** (`:29410`, `:29870`): parts A and B passed 8/8 on
2026-09-02 and parts C and D passed the same day at Kd's browser, on the bytes of
`8eacc54`. **Those screens have since changed** — the day's shape section and the
odd-arrival line were removed, the button learned to refuse, the email arrived
beside the name and the initials went — **so that pass says nothing about the
steps above and is not carried forward.**

**ALREADY OBSERVED SINCE, and deliberately NOT re-numbered into this sheet**
(`:31633`, `:31856`): the refusal outside opening hours, the *"closed today"*
sentence, the *"Pressing this marks your attendance"* line, and the timetable
surviving a switch to 24 hours. **They are steps 8, 10, 5 and 13 here.** Running
them again costs a minute and is worth it — they were observed one at a time, on
three different commits, never as one run.

**STILL NOT COVERED BY ANY BROWSER RUN, and none of it is this sheet's:** the QR
path (phone app) · staff marking somebody present · a second gym's owner ·
anything on a phone.
