# SMOKE — the console stops needing F5

**What changed, in one line:** when somebody changes what you are allowed to do,
your gym screens now notice by themselves the moment you click back into the
window — you do not have to press F5 any more.

**5 steps, about 6 minutes.**

## RESULT — PASSED 4/4 (Kd, 2026-08-23, commit `e8a7e5c`)

> **STEP 5 — PASSED (Kd, 2026-08-24, commit `4c40cd2`).** All five of its actions:
> the gym was created, **"Go to your gym" opened the gym's own screen**, and the
> new gym **was listed under "Your gyms"** — the two sentences the T3 review found
> the app printing instead (*"We couldn't find a gym you run at this address"* and
> *"You don't run a gym yet"*) appeared at neither point. Run against the local api
> + web dev servers on the shared dev database.
>
> **The 4/4 above is a SEPARATE run on `e8a7e5c` and was NOT repeated on
> `4c40cd2`.** Stated rather than merged into a "5/5", because the commit in
> between changed the very store steps 1–4 exercise. **Deliberate, and here is the
> reasoning to argue with rather than a bare assurance:** the change touches which
> reads may SHARE one already in flight and what an explicit refresh does with
> one — the focus re-check path itself is untouched, so steps 1–4 have no changed
> behaviour to observe. What carries them on these bytes is mutants C43–C48,
> **re-run on the final commit: 6 RED, controls GREEN**. If a future change touches
> the focus path itself, steps 1–4 need a human again.

Run in Kd's own browser against his own gym on the shared dev database, both
servers started by the chat. **The working tree was verified byte-identical to
`e8a7e5c` before the run and after it** (`git status` empty both times), so this
pass is about the bytes that are committed.

Two windows — his normal window as the owner, an incognito window as the helper
(the trainer `user2` from the tick-boxes smoke). He ran the steps in the order
below: the box was ticked ON first, because a trainer has no Remove button to
take away until one is given.

**WHAT THIS PASS ESTABLISHES**

*(Numbers corrected 2026-08-24, T3 Low-2. The first two bullets named step 1 for
what the sheet calls step 2 and the other way round: Kd ran the ON direction
first — which is what step 1's own preamble tells you to do when the helper has
no Remove button to take away yet — and this block then described the steps in
the order he RAN them while calling them by number. Both directions genuinely
passed, so nothing is claimed here that was not established; only the labels were
crossed, and DECISIONS :16495 copied the crossing.)*

- **Step 2 is the headline and it is the direction nothing had ever observed
  without a reload:** a permission ticked ON reached a control in a SECOND
  window, with no F5. The tick-boxes card needed a reload to see that
  (DECISIONS :16221's re-smoke) and this is what removes the reload.
- **Step 1 is the other direction** — the power taken away, the control gone,
  and the member list underneath it untouched.
- **Step 3 is the discriminator** and it is why 1 and 2 mean anything: what the
  screen showed after the re-check is what a reload shows. Without it, "the
  buttons changed" could have been the screen guessing.
- **Step 4 is the "is it worse?" check Kd asked for before approving the card:**
  clicking in and out repeatedly, and moving between the three console screens,
  produced no spinner, no blank and no error card.

**WHAT IT DOES NOT ESTABLISH, stated rather than glossed**

- **A re-check that FAILS** leaving the screen alone — that needs the request
  blocked in devtools, which this sheet does not ask for. Carried by a test and
  by mutant C45 only.
- **The shared-browser stamp.** An incognito window and a normal window are two
  separate logins in two separate cookie jars, so no account was ever swapped
  inside ONE window. Carried by a test and by mutant C46 only.
- **A gym leaving your list while the tab sits open.** Same — test and mutants.

---

**Why this matters.** Until now every gym screen asked the server *"who is this
person and what may they do?"* once, when the screen opened, and never again. So
if an owner ticked a permission on or off while somebody was sitting on a screen,
that person saw no change at all until they reloaded — and until then the app was
showing them buttons that were no longer theirs.

**Nothing was ever unsafe.** The server has always refused anything the person is
not allowed to do, and that has not changed. What was wrong was what the screen
was *saying*.

**The step that matters most is 2.** Step 1 checks a button going AWAY, which is
the easy direction — a screen that simply stopped drawing things would pass it.
Step 2 checks a button ARRIVING, which is the direction that can only be right if
the screen really re-asked the server. If step 2 fails, that is the bug, whatever
the rest says.

**Nobody's workouts or members are ever affected by this.** If at any point
somebody's training history or your member list disappears, that is a failure —
stop and say so.

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
- The **helper** — a different account already on your staff, as **Manager** or
  **Trainer**, and one that has *Remove members* available to tick.

**Use two windows you can see at the same time** — one normal window and one
private window, or two different browsers. Not two tabs of the same window: they
share a login, and this test is about clicking from one window to the other.

Put them side by side if you can. **Window A** is the owner. **Window B** is the
helper.

**The one rule for the whole test: do not press F5 in window B.** Pressing it
would hide exactly the thing being tested.

### Getting the two windows ready

1. **Window B (helper):** sign in as the helper and open
   **/console → your gym → Members**. You should see the member list.
2. **Window A (owner):** sign in as the owner and open
   **/console → your gym → Settings**, and find the helper's row.

---

## Step 1 — a permission taken away reaches window B on its own

In **window B**, look at the member list and note whether the rows have a
**Remove** button. If they do not, skip to step 2 and do it the other way round
(tick the box ON first).

In **window A**, on the helper's row, click **What they can do**, untick
**Remove members**, and press **Save**.

Now click into **window B**. Do not reload it. Look at the member list.

✅ **Expect:** within a second or two, the **Remove** buttons are gone. The member
list itself is still there — the same people, in the same order.

❌ **Failure:** the Remove buttons are still there after a few seconds. (That is
the old behaviour: it means the screen never re-asked.) Also a failure: the whole
list disappears, or a loading spinner takes over the screen.

---

## Step 2 — a permission GIVEN reaches it too (the important one)

In **window A**, on the same row, tick **Remove members** back ON and press
**Save**.

Click into **window B** again. Again, do not reload.

✅ **Expect:** the **Remove** buttons come back, on their own.

❌ **Failure:** nothing appears until you press F5. This is the direction that
matters: a screen that has only learned to hide things would pass step 1 and fail
here.

---

## Step 3 — what the screen showed was the truth

Still in **window B**, now press **F5** once.

✅ **Expect:** the screen looks exactly as it did before you reloaded — the
Remove buttons are there (because step 2 turned them back on).

❌ **Failure:** the reload shows something different from what you were looking
at. That would mean the screen had told you one thing while the server thought
another.

---

## Step 4 — clicking in and out does not make the console flicker

In **window B**, click into **window A** and back into **window B** three or four
times, watching window B each time. Then move between **Gym**, **Members** and
**Settings** in window B.

✅ **Expect:** nothing blinks. No spinner, no "loading" text, no flash of an
empty screen. The list you were reading stays exactly where it was, and moving
between the three screens feels immediate.

❌ **Failure:** the screen blanks, shows a spinner, or an error card appears each
time you come back to it.

---

## Step 5 — a gym you have just made is yours

**Added 2026-08-24. This is the one console flow that changes your own gym list
from the inside, and it is where the T3 review found the card's worst bug: the
kept answer only re-checks itself when you click back into the window, and making
a gym happens inside the window.**

In **window A**, go to **Your gyms** and press **Create a gym**. Give it any name
(*Smoke Test Gym* is fine), pick a country and leave the timezone as it is, then
press **Create gym**. When the join code appears, press **Go to your gym**.

✅ **Expect:** the gym's own screen opens, with its name at the top and its join
code on the card.

Then press **Your gyms** in the left-hand rail.

✅ **Expect:** the gym you just made is in the list.

❌ **Failure — either of these, and they are the exact bug:** *"We couldn't find
a gym you run at this address."* after pressing Go to your gym, or *"You don't
run a gym yet."* on the list. Both mean the app has forgotten a gym it created
seconds earlier.

*(You can leave the test gym where it is — nobody can join it without its code.)*

---

## When you are done

Tell the chat which steps passed and which failed, by number. If a step failed,
say what you saw instead — the wording matters more than the diagnosis.
