# SMOKE — the console stops needing F5

**What changed, in one line:** when somebody changes what you are allowed to do,
your gym screens now notice by themselves the moment you click back into the
window — you do not have to press F5 any more.

**4 steps, about 5 minutes.**

## RESULT — NOT YET RUN

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

## When you are done

Tell the chat which steps passed and which failed, by number. If a step failed,
say what you saw instead — the wording matters more than the diagnosis.
