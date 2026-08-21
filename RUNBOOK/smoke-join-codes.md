# SMOKE — managing your gym's join codes

**What changed, in one line:** a gym can now make a new join code, switch one off
and back on, put an end date or a people-limit on one, and swap a leaked code for
a fresh one.

**13 steps, about 20 minutes.**

**Updated 2026-08-21 after Kd's first run.** Three things he found are fixed and
are now checked here: the count under a code says how many people are IN (steps
6), neither the date nor the people-limit can be typed into by hand (steps 8–9),
and a finished code can be taken off the list (steps 12–13).

**Why this matters.** Until now a gym got one code when it was created and could
never change it. If it leaked, there was nothing anybody could do.

**The one thing to keep an eye on.** Every step where you switch a code off ends
with you actually trying to join with it from a second account. That is the whole
point of the sheet — a screen saying "switched off" is worth nothing if the door
still opens.

**Nobody who already joined is ever affected.** If at any point in this sheet a
person disappears from the members list, that is a failure — say so.

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

**You need two accounts.** One that runs a gym (call it the **owner**) and one
that does not (call it the **joiner**). Use two different browsers, or one normal
window and one private window — not two tabs of the same window, because they
share a login.

If the owner account does not have a gym yet: sign in, choose **I run a gym**,
and make one. Any name is fine.

---

## Step 1 — find the controls

As the **owner**, go to your gym's page (**/console**, then click your gym).

✅ **Expect:** your join code in big orange letters near the top, and underneath
it a section headed **Join codes** with the same code listed again and three
buttons beside it: **Switch off**, **Limits**, **Replace**.

The code appearing twice is deliberate — the big one is the one you hand out, the
list below is where you manage them.

❌ **Failure:** no **Join codes** section at all, or the section is there but has
no buttons.

---

## Step 2 — switch the code off

Click **Switch off**.

✅ **Expect:** within a second or two, the row's green **Working** tag becomes a
grey one, the button becomes **Switch on**, and a line appears saying *"Switched
off. Nobody can join with it until you switch it back on."*

❌ **Failure:** nothing changes, the tag still says Working, or you have to
reload the page to see the change.

---

## Step 3 — prove the door is actually shut

As the **joiner**, go to **Settings → Gym** and type the code you just switched
off.

✅ **Expect:** you are turned away, with a message about the code being paused.
You do **not** end up on any gym's waiting list.

❌ **Failure:** you get in, or you land on a "waiting to be confirmed" screen.
This is the most important step on the sheet — if the screen and the door
disagree, stop and report it.

---

## Step 4 — switch it back on

Back as the **owner**, click **Switch on**.

✅ **Expect:** the grey tag turns green and says **Working** again, and the
"switched off" sentence disappears.

Now, as the **joiner**, type the same code again.

✅ **Expect:** it works this time — you land on the waiting screen.

❌ **Failure:** still refused after switching it back on.

---

## Step 5 — confirm the joiner, so there is somebody to protect

As the **owner**, go to **Members**. The joiner should be in a **Waiting to
join** section at the top. Click **Confirm**.

✅ **Expect:** they move down into the members list.

✅ **Also check, and this is the bit Kd asked for:** the waiting row does **not**
say *"Front Desk"* anywhere. That label used to appear on every row and told you
nothing.

❌ **Failure:** "Front Desk" is still printed on the waiting row.

---

## Step 6 — the code now says somebody is using it

Go back to your gym's page (**/console**, then your gym).

✅ **Expect:** under the code in the **Join codes** list, it now says *"1 person
is in through it"*.

✅ **And the number is ONE, not two.** You are a member of your own gym and you
came in through this same code — but you are the owner, so you are never counted
against your own gym. Two here is a failure.

❌ **Failure:** it still says nobody is using it, or it says 2.

---

## Step 7 — make a second code

Click **New code**, then click **Make the code** without filling anything in.

✅ **Expect:** a second code appears in the list, six characters, different from
the first. Both show the green **Working** tag.

❌ **Failure:** an error, or the new code is the same as the old one.

---

## Step 8 — put a limit on the new code (no typing)

On the **new** code's row, click **Limits**.

Beside **Maximum people** there is a **−**, a box, and a **+**. The box says
*No limit*.

**Try to type in the box first.** Click it and press some digits.

✅ **Expect:** nothing happens. The box cannot be typed into at all.

Now click **+** once, then click **Save**.

✅ **Expect:** the row says something like *"Nobody is using this code yet · 1 of
1 left"*.

Click **Limits** again and click **−** once.

✅ **Expect:** the box goes back to saying *No limit* — that is how you take a
limit off. Click **Save**.

❌ **Failure:** you can type a number in by hand, or **−** produces a 0, or an
error mentions a server or a number like 400.

---

## Step 9 — give a code an end date (no typing either)

On the **new** code's row, click **Limits**.

**Try to type the date first.** Click the **Stop working after** box and type
`19 07 2026` — the exact thing that went wrong before.

✅ **Expect:** nothing is entered. The box ignores the keys completely, and does
**not** end up holding some other date like 19 09 2026.

Now click the box and pick **tomorrow** from the calendar that opens. Click
**Save**.

✅ **Expect:** the row now says *"Ends"* followed by tomorrow's date.

Click **Limits** once more and try to pick a date in the **past**.

✅ **Expect:** the calendar will not let you — dates before today are greyed out.

❌ **Failure:** typing changes the date, or you can pick and save a date that has
already gone.

---

## Step 10 — replace a leaked code

On the **first** code's row (the one the joiner used), click **Replace**.

✅ **Expect:** it asks you first, saying you get a new code and this one stops
working, **and** that people who already joined stay members.

Click **Replace it**.

✅ **Expect:** a brand-new code appears at the top of the list with the green
**Working** tag, and the old code is now grey and switched off.

✅ **Now the part that matters:** click **Members**.

✅ **Expect:** the joiner you confirmed in step 5 is **still there**.

❌ **Failure:** the joiner has disappeared from the members list. Stop and report
this immediately.

---

## Step 11 — the replaced code really is dead

As the **joiner**, sign out and sign in as a **third** account if you have one —
or just use the joiner account, which is already a member.

Type the **old** code (the one that was replaced in step 10).

✅ **Expect (third account):** refused, with a message about the code being
paused.

✅ **Expect (joiner account, already a member):** either refused for the same
reason, or told you are already a member. Both are correct — neither should let
somebody new in.

❌ **Failure:** a brand-new person gets onto the waiting list using the replaced
code.

---

## Step 12 — take the dead code off the list

You now have a switched-off code sitting in the list: the one you replaced in
step 10. This is the pile-up problem — a gym that changes its code every month
would collect twelve of these a year.

On that switched-off code's row, click **Remove**.

✅ **Expect:** it asks first, and the question says that everyone who joined with
it **stays a member**.

Click **Remove it**.

✅ **Expect:** the row disappears from the list.

✅ **Now the part that matters:** click **Members**. The person you confirmed in
step 5 is **still there**.

❌ **Failure:** the member is gone, or the row is still on the list after the
page settles.

---

## Step 13 — a working code cannot be removed

Look at your **working** code — the green one.

✅ **Expect:** it has **no Remove button at all**. Only **Switch off**, **Limits**
and **Replace**.

That is deliberate: a code that still lets people in should never vanish from the
only screen where you can see it. Switch it off first, and then Remove appears.

❌ **Failure:** a working code offers Remove.

---

## When you are done

Tell me **pass** or **fail per step number**. If a step failed, the most useful
thing you can send is what the screen actually said, word for word.
