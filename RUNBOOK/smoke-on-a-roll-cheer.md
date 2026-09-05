# SMOKE — "On a roll", and the one tap that cheers a member

**What this checks:** the short list of members who keep turning up, on your
gym's home screen, and the button beside each name that sends them a line of
encouragement. Built 2026-09-05; the server half shipped 2026-09-04.

**Why it matters:** the whole point of the feature is a message that reaches a
real person. Nothing here can be proved by a test — a test can prove the button
calls the server, it cannot prove you can find the button, understand what it is
about to send, or that the member sees anything afterwards.

---

## ⚠️ READ THIS FIRST — most of this sheet CANNOT BE RUN YET, and that is not a
## defect

**The list only draws a member who has visited in two or more consecutive weeks
at your gym, and nobody in your database has done that.** The rule is
deliberate — a "streak" of one week is not a streak — so the list is correctly
empty today.

**And that history cannot be created by using the app.** When you tap *"I'm
here"* the server decides which day it is, in the gym's own clock. It has to,
or anybody could mark themselves present for last Tuesday. So there is no way,
through any screen, to give somebody a visit two weeks ago.

**What that leaves:**

| Part | Can you run it today? |
|---|---|
| **A — the empty list** | **Yes**, and it is the only part with a real ✅ below. |
| **B — the list and the cheer** | **No.** Needs the history above. |
| **C — what the member sees** | **No.** Needs B to have happened. |

**Parts B and C are written out in full anyway**, so that the day the history
exists they can be run without anybody re-deriving what to look for. Until then
this sheet does NOT tick the feature's line — nobody has seen these screens.

---

## Before you start

**Part A is yours to run start to finish. No pauses, no commands.**

- **Both servers are already running.** If you need to restart them:
  ```
  cd apps/api && node --import tsx --env-file=.env src/index.ts
  corepack pnpm --filter web exec vite
  ```
- **Your sign-in:** `owner@example.com` / **`Smoke2026!`**

## The links

| # | Where | Link |
|---|---|---|
| A | Sign in | http://localhost:5173/login |
| B | **Your gym's home screen** | http://localhost:5173/console/owner |
| C | **My Gyms** (the member's side) | http://localhost:5173/my-gyms |

---

## PART A — the empty list (runnable today)

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

## PART B — the list and the cheer (BLOCKED — needs a member with a two-week
## history)

*Do not attempt these steps today. They are written for the day that history
exists.*

### 5 · A member on the list

✅ Under **"On a roll"**, one row per member, showing their name and a line like
**"5 weeks running · 3 days in a row · 11 visits"**.

❌ **"1 day in a row"** must never appear. One day is not a run, and printing it
beside a five-week streak reads as though the run had just broken.

### 6 · Four things you can send

✅ On the right of each row, four emoji: **💪 🔥 👏 🏆**.
✅ Hover over one. A tooltip shows the exact sentence it will send — for 💪,
*"Great week — keep it going."*

**You are meant to be able to read what you are about to send before you send
it.** If hovering shows nothing, that is a failure.

### 7 · One tap sends it

✅ Click **💪** on one row. The four emoji on **that row only** are replaced by a
grey line — **either** *"Cheered just now."* **or** *"Cheered — you can again in
7 days."* **Both are a pass.** The first is the moment before the server answers;
the second means it has already answered. Step 8 is where the date is checked.
✅ The other rows still have their four emoji.

❌ If every row goes quiet, the wrong thing was sent to the wrong person.

### 8 · The date appears on its own, and survives a reload

✅ **Without touching anything**, within a second or two that same row reads
**"Cheered — you can again in 7 days."** Seven, because the cheer you have just
sent reopens a week from the moment you sent it. You did not reload to see it.
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

### 9 · A second cheer is refused

✅ Try to cheer the **same person** again — the emoji should not be there to
click.

---

## PART C — what the member sees (BLOCKED — needs Part B)

*Sign in as the member who was cheered.*

### 10 · The line is on their gym card

Open **C**.

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

✅ It stays for a week and then goes, whether or not they looked. That is a
known limitation and not a fault.

---

## What a pass on Part A does and does not cover

**Does:** that the section exists, is honestly worded when empty, folds, and is
absent from the members list.

**Does NOT:** anything about a real cheer. **No cheer has been sent by anybody,
and no member has seen one.** Until Parts B and C run, the feature's `OWED.md`
line does not tick.
