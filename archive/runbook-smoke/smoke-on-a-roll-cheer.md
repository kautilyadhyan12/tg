# SMOKE — "On a roll", and the cheer you confirm before it goes

**What this checks:** the short list of members who keep turning up, on your
gym's home screen, and the button beside each name that sends them a line of
encouragement. Built 2026-09-05; the server half shipped 2026-09-04.

**Why it matters:** the whole point of the feature is a message that reaches a
real person. Nothing here can be proved by a test — a test can prove the button
calls the server, it cannot prove you can find the button, understand what it is
about to send, or that the member sees anything afterwards.

---

## ⚠️ READ THIS FIRST — the whole sheet is now runnable, and how that happened
## matters

**The list only draws a member who has visited in two or more consecutive weeks
at your gym.** The rule is deliberate — a "streak" of one week is not a streak.

**That history cannot be created by using the app.** When you tap *"I'm here"*
the server decides which day it is, in the gym's own clock. It has to, or anybody
could mark themselves present for last Tuesday. So there is no screen, anywhere,
that can give somebody a visit two weeks ago.

**KD RULED ON 2026-09-05 THAT THE ROWS COULD BE WRITTEN STRAIGHT INTO THE
DATABASE, AND THEY WERE** — ten attendance rows for two members of the *owner*
gym, by `apps/api/tools/seed-on-a-roll-visits.ts`, which says exactly what it
writes and why. **Part A was NOT touched by this**: the empty state below now
belongs to *Smoke Test Gym*, which still has nobody on a run.

| Part | Where | Runnable |
|---|---|---|
| **A — the empty list** | **Smoke Test Gym** (`/console/smoke-test-gym`) | Yes |
| **B — the list and the cheer** | **owner** (`/console/owner`) | Yes |
| **C — what the member sees** | sign in as the cheered member | Yes, after B |

**THE DEPARTURE IS DECLARED** (`:27810` §3): the chat built the state and you do
the looking. That is legitimate here for that entry's own reason — **no step
below contains a command.** Every one is a person at a screen reading something,
so your word is the complete evidence for it.

---

## Before you start

**The whole sheet is yours to run start to finish. No pauses, no commands.**

- **Both servers are already running.** If you need to restart them:
  ```
  cd apps/api && node --import tsx --env-file=.env src/index.ts
  corepack pnpm --filter web exec vite
  ```
- **Your sign-in:** `owner@example.com` / **`Smoke2026!`**
- **Part C needs the sign-in of whichever member you cheer in step 6** —
  `tm@example.com` if you follow step 6's rule. If you do not have that
  password, say so and it can be reset; nothing else in the sheet needs it.

## The links

| # | Where | Link |
|---|---|---|
| A | Sign in | http://localhost:5173/login |
| B | **Smoke Test Gym's home screen** (nobody on a run) | http://localhost:5173/console/smoke-test-gym |
| C | **The owner gym's home screen** (two people on a run) | http://localhost:5173/console/owner |
| D | **My Gyms** (the member's side) | http://localhost:5173/my-gyms |

**Two gyms, on purpose.** Part A checks what an empty list says, and *Smoke Test
Gym* is the one that is genuinely empty. Part B needs people on it, and the
*owner* gym is where the ten visit rows were written.

---

## PART A — the empty list

Sign in at **A**, then open **B**.

### 1 · The section is there, under the numbers

✅ Below the numbers and the names of who came today, a heading reading
**"On a roll"**. It has an arrow beside it and starts **open**.

❌ If there is no such heading at all, stop — nothing below will work.

### 2 · It says why it is empty rather than saying nothing

✅ Under the heading, one line: **"Nobody is on a run of 2 weeks or more right
now."**

**This is the part worth looking at closely.** It must NOT say "yet" and must
NOT say "nobody has ever". The screen is only looking at who is on a run *now* —
somebody whose run ended in March is correctly not on the list, and a sentence
implying the gym has never had a regular would be false.

❌ Any sentence containing the words **"yet"** or **"ever"** is a failure.
❌ A blank space under the heading, with no sentence at all, is a failure.

### 3 · It folds away

✅ Click the **"On a roll"** heading. The sentence disappears.
✅ Click it again. The sentence comes back.

❌ If it opens and will not close, that is the exact defect you found on the
attendance dropdown in September. Report it.

### 4 · There is no way to cheer from your members list

Open your gym's **Members** page from the left-hand menu.

✅ There is **no cheer button anywhere on that list**, and no emoji beside
anybody's name.

**This is deliberate and it is not an oversight.** Your members list shows
people the gym is not charged for — you, and anyone on a free place — and those
are exactly the people the cheer refuses. A button there would tell you *"that
person isn't a member of this gym"* about somebody whose name you are looking
at.

---

## PART B — the list and the cheer

Open **C** — the *owner* gym. This is a different gym from Part A.

### 5 · Two members on the list, with different numbers

✅ Under **"On a roll"**, exactly two rows, in this order:

| Name | The line beside it |
|---|---|
| **user** | **3 weeks in a row · 2 days in a row · 7 visits** |
| **tm** | **2 weeks in a row · 3 visits** |

**The second row has no "days in a row" and that is the check.** `tm` last came
on Wednesday, so there is no run of days to report — and the screen says nothing
rather than saying "0" or "1".

❌ **"1 day in a row"** must never appear. One day is not a run, and printing it
beside a three-week streak reads as though the run had just broken.
❌ Only one row, or the two rows the other way round, is a failure.

### 6 · Four things you can send, and nothing sends yet

> **⚠️ USE THE SECOND ROW — `tm` — AND NEVER THE FIRST. THIS IS NOT A
> PREFERENCE.** A defect that sends every cheer to `onARoll[0]` instead of the
> member whose button was pressed **passes this sheet perfectly if you press the
> top row**, because there the two are the same person. That is `C220`, which was
> ALIVE on its first run, and the 2026-09-05 smoke is the first time a HUMAN
> observed the guarantee — by accident, because a leftover cheer had blocked the
> top row and Kd moved down one. **The accident is now the instruction.**
>
> If `tm` has already been cheered TODAY the emoji will not be there (the cap is
> one per member per day since `:35762`). Cheer any row that is **not the
> first**, and read `tm` below as that row's name.

✅ On the right of each row, four emoji: **💪 🔥 👏 🏆**.
✅ Click **💪** on the **tm** row — **the second one, for the reason above**.
**Nothing is sent.** A small panel opens just beside the emoji, holding three
things: **💪**, the words *"Great week — keep it going."*, and an orange button
reading **Send**.
✅ The panel sits over the row below it. The list does not jump or move down.

**This is the whole point of the step.** Until **Send** is pressed, nothing has
happened and nothing can be undone.

❌ A cheer going out on the emoji alone is a failure.
❌ A big box in the middle of the screen is a failure — it is meant to be a small
panel beside the emoji.

### 6b · Getting out of it — three ways, plus the swap

Do these one at a time, on the **tm** row (step 6's rule). **After the first three the four
emoji must be back and no cheer sent. The fourth is not a way out** — it leaves
a panel open, on the other emoji, and that is the pass.

**Send is the fourth way out and is step 7**, so it is not repeated here. This
heading said *"four ways"* until T3 round 2, which counted the swap into a total
it does not belong in — the same miscount corrected in the code and in `OWED.md`
that day.

✅ Open the panel with **💪**, then press **Escape**. It closes.
✅ Open it again, then click on an empty part of the page. It closes.
✅ Open it again, then click **💪** a second time. It closes.
✅ Open it with **💪**, then click **🏆**. It does **not** close — it swaps, and
now reads *"Strong streak."* beside 🏆.

**The last one is the one that matters if your finger slips**: correcting a
mis-tap costs one more tap and never a sent cheer.

❌ If any of the first three leaves the panel open, or if the fourth closes it
instead of swapping, that is a failure.

### 7 · Send sends it

✅ With the panel open on **💪** on the **tm** row, press **Send**. The panel
closes and the four emoji on **that row only** are replaced by a
grey line — **either** *"Cheered just now."* **or** *"Cheered — you can again
tomorrow."* **Both are a pass.** The first is the moment before the server
answers; the second means it has already answered. Step 8 is where the day is
checked.
✅ The other rows still have their four emoji.

❌ If every row goes quiet, the wrong thing was sent to the wrong person.

### 8 · The date appears on its own, and survives a reload

✅ **Without touching anything**, within a second or two that same row reads
**"Cheered — you can again tomorrow."** TOMORROW, because Kd reversed his own
seven-day wait on 2026-09-05 (DECISIONS `:35762`) — the button now comes back at
your gym's own midnight, so a gym can say something each time somebody turns up.
You did not reload to see it.

**Between midnight and about 8:30 in the morning your time it reads "later
today" instead, and that is also a pass.** This gym keeps its clock in Argentina
— 8½ hours behind you, measured 2026-09-05 — and the screen asks whether the
gym's midnight lands on today's date **where you are sitting**. In those hours it
does. At every other hour of the day it says **tomorrow**.

**Nothing on this screen changes by itself when that midnight passes** — it has
no clock of its own and never refreshes on a timer. Whatever it says when you get
there is what it will say until you reload. So do not wait for the emoji to come
back; if you are still on the page hours later, treat only the sentence in front
of you as the result.

**Do not read that as "late at night".** A gym keeping the same clock as you
would say **tomorrow** at every hour, 11pm included — the sentence turns on the
two clocks being different, not on the hour being late.

Anything naming a NUMBER of days is a failure: that is the old rule still on the
screen.
✅ Now reload the page (**Ctrl+R**). It still says the same thing.

**This is the check that matters most in Part B**, and it is TWO checks. The
second proves the screen is reading the server's answer rather than remembering
its own click — the button must look the same to your colleague at the front
desk as it does to you. The first proves you did not have to reload to see it.

❌ Four live emoji again after a reload is a failure.
❌ **Still reading "Cheered just now." after a few seconds is a failure**, even
though a reload would fix it. That was the defect T3 round 1 found (DECISIONS
`:34992`): the row kept its own word for the whole life of the tab and the date
the screen had already fetched never reached the screen. **This step used to
tell you to press Ctrl+R here — it was written around the bug.**

### 9 · A second cheer is refused today, and only today

✅ Try to cheer the **same person** again — the emoji should not be there to
click.

**That refusal lasts until your gym’s midnight and no longer.** The cap is one
cheer per member per day (`:35762`), so tomorrow the four emoji are back for
that member — which is the whole point of the change and is the half no browser
step here can show you without waiting a day. It is proven instead by the
server's own tests, which move the clock rather than wait for it.

---

## PART C — what the member sees

*Sign out, and sign in as **the member you just cheered** — `tm@example.com` if you
followed step 6's rule, not `user`.*

### 10 · The line is on their gym card

Open **D**.

✅ On the card for that gym, under its name: **💪 Great week — keep it going.**
followed by a faint **"just now"** or **"2 hours ago"**.

❌ The message must **never** name who sent it. No staff name, no "sent by".
The member is told their gym cheered them and nothing about which person pressed
the button.

### 11 · The dot on the menu

✅ In the left-hand menu, the **My Gyms** item has a small orange dot beside it.

**That dot is the whole of how they find out.** Nothing in this app sends
emails or phone notifications yet, so a cheer waits on a screen — and without
the dot a member who does not open My Gyms never learns it happened.

✅ It stays for **a day** and then goes, whether or not they looked — it is
recency, not read-state. **You cannot check the "and then goes" half today**: it
needs a cheer a day old, and nothing on any screen can age one. The server's own
tests move the clock instead.

**It said "a week" until 2026-09-06.** That was the cap before Kd cut it to one
per member per day, and it is the FIFTH copy of that dead figure found on this
packet — after three in the code and ten in the card document. Nothing on screen
was wrong; this sheet was, and it would have told you to accept a dot that
outlasted the rule it mirrors.

---

## What a pass here does and does not cover

**Does:** the section exists and is honestly worded when empty · it folds · it is
absent from the members list · the list draws real streaks · a cheer reaches the
member it was aimed at · the reopening date comes from the server and survives a
reload · the member sees the line and the dot.

**Does NOT:** anything about a member's history being built the ordinary way.
**The ten visits behind Part B were written into the database, not walked in
through the door** — so this sheet says nothing about `markAttendance`, which
`smoke-attendance.md` covers.

**A pass is per STEP, never per message** (`:27415`, `:23535`). Report each
number; a single word covers only what it names.
