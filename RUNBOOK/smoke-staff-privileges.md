# SMOKE — ticking what one person is allowed to do

**What changed, in one line:** under each person on your Staff screen there are
now tick boxes, so you can say what that one person may do instead of only
picking Manager or Trainer.

## RESULT — UNRUN

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

---

## Step 1 — the boxes exist

As the **owner**, go to **/console → your gym → Settings**. Find the helper's row
and click **What they can do**.

✅ **Expect:** a list of tick boxes appears under their name, each with a short
sentence under it. Some are ticked and some are not.

❌ **Failure:** no button, or the button does nothing, or every box is empty.

---

## Step 2 — "Manage staff" is not on offer

Still looking at the helper's boxes.

✅ **Expect:** there is **no** box called **Manage staff**. The boxes you can see
are about members and join codes only.

❌ **Failure:** a **Manage staff** box is there. Do not tick it — say so and stop.
Handing that out is what lets somebody lock you out of your own gym.

---

## Step 3 — tick something on and save it

Tick **Let people into the gym** (if it is already ticked, tick **Remove
members** instead — pick any box that is currently empty). Press
**Save permissions**.

✅ **Expect:** the boxes close. Now press **F5** to reload the page, open
**What they can do** again, and the box you ticked is **still ticked**.

❌ **Failure:** nothing happens when you press Save · an error appears · or the
box is empty again after the reload.

---

## Step 4 — Save is dead until you change something

Open the helper's boxes again without touching anything.

✅ **Expect:** the **Save permissions** button looks faded and pressing it does
nothing. Tick any box and it becomes bright. Untick it again and it goes back to
faded.

❌ **Failure:** Save is bright before you have changed anything.

---

## Step 5 — Cancel really cancels

Untick a box that is currently ticked. Press **Cancel** instead of Save. Open
**What they can do** again.

✅ **Expect:** the box is back the way it was. Nothing was saved.

❌ **Failure:** the change stuck anyway.

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
are now the standard ones for the new role — including any box you had ticked on
in step 3, which is **gone**. That is correct and it is what the question warned
you about.

❌ **Failure:** it changed on the first press with no question · or the question
says your "changes will be lost" (it should say the permissions *become the
defaults*).

---

## Step 9 — your own row

On **your own** row press **What you can do**.

✅ **Expect:** you can see your ticks, they are all greyed out so nothing can be
tapped, there is **no Save** button, and there is a line saying it can't be
changed here.

❌ **Failure:** you can tick your own boxes, or there is a Save button on your
row.

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
