# SMOKE — ticking what one person is allowed to do

**What changed, in one line:** under each person on your Staff screen there are
now tick boxes, so you can say what that one person may do instead of only
picking Manager or Trainer.

## RESULT — PASSED 10/10 (Kd, 2026-08-23, commit `245632d`)

Run in Kd's own browser against his own gym on the shared dev database, both
servers started by the chat. **Step 6 passed in both directions** — the helper
was refused the member list the moment the box came off, and got it back when it
went on — and step 7 repeated that on a second power. Working tree verified
byte-identical to `245632d` immediately before the run and after it.

**FOUR STEPS WERE CORRECTED MID-RUN — 1, 3, 4 and 8 — and all four are ONE
mistake of this sheet's, not the card's.** It was written imagining a helper with
a mixed set of ticks, and a **Manager starts with all five ticked**, so each of
those steps asked for something that does not exist on the very row the sheet
tells you to use.

**Two more were SHARPENED without having been wrong:** step 5 gained a reload,
and step 9 now names the number of boxes to expect.

**A later run gets the fixed sheet; nothing about the app changed.**

**One prerequisite was missing entirely and is now written into "Before you
start": you can only hand keys to somebody who is ALREADY A MEMBER of that gym.**
The Add form looks somebody up on the gym's own roster, so an account that has
never joined is refused — which is a wall a first-time runner hits before step 1.

---

**10 steps, about 20 minutes.**

**Why this matters.** Until now the only choice was Manager or Trainer, and each
came with a fixed bundle. A gym that wants a trainer who can also let new people
in, or a manager who must not remove anybody, had no way to say so.

**The step that matters most is 6.** Everything else checks what the screen
shows; step 6 checks that the change is *real* — that the server actually stops
the other person doing the thing you untick. A screen that greys out a button
while the server still allows it is the exact defect this feature is written
against. If step 6 fails, that is the bug, whatever the rest says.

**Step 3 is the second most important**, for a boring reason: saving uses a
method (`PUT`) the browser has to ask permission for first, and our automated
tests cannot imitate that ask. This project has shipped a dead button behind 250
passing tests once before. If Save does nothing at all, that is why.

**Nobody's workouts are ever affected.** If at any point somebody's training
history disappears, that is a failure — stop and say so.

---

## Before you start

Two terminals, from the repo root.

**Terminal 1 — the API**
```
cd apps/api && node --import tsx --env-file=.env src/index.ts
```
Wait for it to say it is listening on port 3000.

**Terminal 2 — the web app**
```
cd apps/web && npx vite
```

Open **http://localhost:5173/login** and press **F5** once.

**You need the same two accounts as the staff smoke.**

- The **owner** — your account, which runs your gym.
- The **helper** — a different account that is already **on your staff** as a
  **Manager**. If it is a Trainer, use step 8 to make it a Manager first, or just
  read "Manager" as "Trainer" throughout.

Use two different browsers, or one normal window and one private window — not two
tabs of the same window, because they share a login.

### If the helper is not on your staff yet

**You cannot hand keys to somebody who has not joined the gym.** The Add form
looks the person up on your gym's own member list, so an account that has never
joined is refused no matter how you spell the email. Three steps, all ordinary
use of the app:

1. **As the helper**, in their window, open `/org/join?code=YOURCODE` (or
   **Settings → Gym** and type the code) and send the request.
2. **As the owner**, go to **Members** and **confirm** them out of the
   *Waiting to join* list.
3. **As the owner**, go to **Settings → Add someone**, type their email, pick
   **Manager**.

### If any staff screen shows an error before you start

Check the database has every change applied — `pnpm --filter api migrate` with
`DATABASE_URL` pointing at the database your API is using. **The tick boxes need
a column that a card added, and a database one change behind makes every screen
INSIDE a gym fail** (the `/console` list of your gyms still works, which is what
makes it look like a smaller problem than it is).

---

## Step 1 — the boxes exist

As the **owner**, go to **/console → your gym → Settings**. Find the helper's row
and click **What they can do**.

✅ **Expect:** a list of tick boxes appears under their name, each with a short
sentence under it.

**On a MANAGER that is five boxes and all five are ticked** — See the member
list · Share the join code · Let people into the gym · Remove members · Change
join codes. On a **Trainer** it is the same five with only the first two ticked.

❌ **Failure:** no button, or the button does nothing, or a box is missing, or a
box is empty on a Manager you have just created (that would mean the screen is
not showing what the server actually stored).

*(Corrected 2026-08-23: this step used to say "some are ticked and some are not",
which is true of a Trainer and false of the Manager the sheet asks you to use.)*

---

## Step 2 — "Manage staff" is not on offer

Still looking at the helper's boxes.

✅ **Expect:** there is **no** box called **Manage staff**. The boxes you can see
are about members and join codes only.

❌ **Failure:** a **Manage staff** box is there. Do not tick it — say so and stop.
Handing that out is what lets somebody lock you out of your own gym.

---

## Step 3 — tick something on and save it

**A Manager has no empty box to tick, so this runs in two halves — the same
check, once in each direction.** (On a Trainer you can do the ON half alone.)

**Half A — take one off**

1. **Untick "Remove members"**
2. **Save permissions**
3. **F5** to reload the page
4. Reopen **What they can do**

✅ **Expect:** the panel closed on save, and after the reload **"Remove members"
is empty**.

**Half B — put it back**

1. **Tick "Remove members"** back on
2. **Save permissions** → **F5** → reopen

✅ **Expect:** **"Remove members" is ticked** again.

❌ **Failure:** nothing happens when you press Save · an error appears · or the
box snaps back to how it was after the reload.

*(Corrected 2026-08-23: the step used to say "pick any box that is currently
empty", which a Manager does not have.)*

---

## Step 4 — Save is dead until you change something

Open the helper's boxes again without touching anything.

✅ **Expect:** the **Save permissions** button looks faded and pressing it does
nothing. Now **untick** any box and it becomes bright. **Tick that same box back
on** and it goes back to faded — you are where you started, so there is nothing
to save.

❌ **Failure:** Save is bright before you have changed anything, or it stays
bright after you undo your own change.

*(Corrected 2026-08-23: the step said "tick any box"; on a Manager every box is
already ticked, so the change has to start with an untick.)*

---

## Step 5 — Cancel really cancels

Untick a box that is currently ticked. Press **Cancel** instead of Save. Open
**What they can do** again.

✅ **Expect:** the box is back the way it was. Nothing was saved.

Now press **F5** and open it once more.

✅ **Expect:** still back the way it was.

❌ **Failure:** the change stuck anyway, at either check.

*(The reload was added 2026-08-23. Without it, a Cancel that tidied the SCREEN
while quietly saving anyway would still look correct — the panel would be
redrawing the same wrong answer it had just sent.)*

---

## Step 6 — THE IMPORTANT ONE: the change is real, not just on your screen

As the **owner**: open the helper's boxes, **untick "See the member list"**, and
press **Save permissions**.

Now sign in as the **helper** in your other browser window, go to
**/console → the gym → Members**.

✅ **Expect:** they are **refused**. The screen says something like *"Your role
doesn't allow that"* and there is no member list. It does **not** show them the
members anyway.

Then go back to the **owner** window, tick **See the member list** back on, press
Save, and reload the helper's window.

✅ **Expect:** the member list is back for them.

❌ **Failure — and this is the serious one:** the helper can still read the member
list after you untick it. That means the screen is lying and the server is not
enforcing anything.

---

## Step 7 — grant something they did not have

As the **owner**, tick **Change join codes** on for the helper and save. In the
helper's window, reload and go to the gym's main screen.

✅ **Expect:** the helper can now use the join-code controls (pause it, make a new
one) that they could not before.

❌ **Failure:** the controls are still refused after the tick was saved.

*(If the helper is a Manager they may already have had this. Then untick it
instead, save, and expect the controls to be refused.)*

---

## Step 8 — changing their role warns you first

As the **owner**, on the helper's row press **Make trainer** (or **Make manager**,
whichever it offers).

✅ **Expect:** it does **not** change straight away. A question appears saying
their permissions **become the defaults for the new role**.

Press **Cancel**.

✅ **Expect:** nothing changed — they still have the role and the boxes they had.

Now press the button again and confirm it.

✅ **Expect:** the role changes, and when you open **What they can do** the boxes
are now the standard ones for the new role. **Manager → Trainer means five ticks
drop to two** — See the member list and Share the join code stay, the other three
go. That is correct and it is what the question warned you about.

*(Reworded 2026-08-23: it used to point at "any box you had ticked on in step 3",
which step 3 no longer produces on a Manager.)*

❌ **Failure:** it changed on the first press with no question · or the question
says your "changes will be lost" (it should say the permissions *become the
defaults*).

---

## Step 9 — your own row

On **your own** row press **What you can do**.

✅ **Expect:** **six** boxes, not five — your own row is the one place
**Manage staff** appears — all six ticked, all greyed out so nothing can be
tapped, **no Save** button, and a line saying it can't be changed here.

❌ **Failure:** you can tick your own boxes · there is a Save button on your row ·
or fewer than six boxes are shown.

Why it is greyed rather than simply hidden: every owner is the last owner, so a
power taken off your own row has no route on this screen to put it back.

*(Sharpened 2026-08-23 — not a correction. The step was right but did not say how
many boxes to expect, so a missing one was a failure the runner had to NOTICE
rather than one they were asked to check.)*

---

## Step 10 — nothing else broke

Still on **Settings**, as the owner.

✅ **Expect:** the count at the top still reads correctly ("2 people run this
gym"), **Add someone** still opens the form, and the **Remove** button still asks
its three questions before doing anything.

❌ **Failure:** any of the three is missing or broken.

---

## When you are done

Tell me, per step: **passed** or **failed**, and for a failure what you actually
saw on screen. If everything passed, "all passed" is enough — except for
**step 6**, which I will ask about separately even if you say that, because it is
the only step that proves the server and not just the screen.
