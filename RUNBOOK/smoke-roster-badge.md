# SMOKE — the roster says who has a free place

**What changed, in one line:** on your Members list, someone who helps run the gym
now shows the same **Complimentary** badge you do — because the gym is not charged
for their place.

## RESULT — PASSED 2026-08-22 (Kd): "all passed"

**Recorded as a GLOBAL pass — Kd's REPORT, not a measurement** (:4829). Run in his
own browser against the **Neon dev database**, i.e. his real gym and his real
accounts, with both servers started by the chat (:9328's process note).

**RUN ON UNCOMMITTED BYTES, AND THAT IS SAID RATHER THAN GLOSSED.** The card was
not committed when he ran it, so this sheet cites no commit hash.

**AND THE T3 FIX ROUND THEN EDITED TWO OF THE SEVEN SOURCE FILES, WHICH THE RULE
ABOVE SAYS VOIDS A SMOKE. It does not here, and the reason is stated so a later
chat can disagree with it.** The two edits — `Members.jsx`'s header and
`orgMemberSchema`'s doc block, both from T3 L-5 — **replaced comment text with
comment text and changed no executable line.** That is reasoned from the edits
themselves, and it is **NOT a byte-level proof**: no build hash was taken before
the smoke, so none exists to compare. What backs it instead is that the suite,
the build and the mutation sweep were all re-run afterwards and the screen's
behaviour is pinned by C36/C37/C38.

**If a later chat wants the stronger citation, the honest way to get it is to
re-run sheet step 6 — ten seconds — not to argue from this paragraph.**

**What IS verified: no source file was touched between his run and the T3 round**
(mtimes, measured). **What is NOT: a post-commit `git status` check**, which the
committing chat must do and write here. A further edit to any of the seven source
files voids this pass under :10959.

**What only a browser could settle:** the badge appearing on a trainer's row is
the whole card, and it was drawn from **live data** rather than a fixture — the
mutation audit can only delete a rule that exists, and the join-code number at
step 6 held on a real gym, which is :14401's C/H-1 continuing to hold outside a
test. **Step 5 is the card's subject and it passed.**

**NOT settled by this sheet:** the expand-then-contract fallback (an API older
than the web build — no such API is running anywhere to test against; it is
carried by mutant C38 and its own test), and the §2.4 argument for widening the
response, which is a review question and not a browser one.

**T3 IS THE REMAINING GATE.** A passing smoke is not a review.

---

**Why this sheet exists.** You found this yourself at the staff re-smoke: *"when a
member is added as a staff there badge should also show complimentary."* You were
right, and only about the screen — the gym stopped being charged for staff on
2026-08-22, but the list had no way to say so, so a trainer looked exactly like
somebody occupying a place you pay for.

**8 steps, about 10 minutes.**

**The step that matters most is 6.** That is the one thing that was broken. Steps
3, 4 and 8 are there so a pass means something: if the app simply badged
*everybody*, step 4 would fail.

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

**You need one account and one helper.**

- The **owner** — your account, which already runs a gym.
- The **helper** — a different account that has **already joined that gym** and is
  **not** staff yet.

You only sign in as the owner for this sheet. The helper just needs to be sitting
on your Members list as an ordinary member.

If the helper is currently staff, take their keys back first: **Settings → Staff →
Remove → just take the keys**. Then start at step 1.

**Write down one number before you start.** Open your gym's main screen and look
at the join codes section. Note the number of people it says have joined with your
code. You will check it again at step 7.

---

## Step 1 — open your Members list

As the **owner**, go to **/console**, click your gym, then click **Members**.

✅ **Expect:** the list of everyone in your gym, your own name among them.

❌ **Failure:** an error card, or the page says it couldn't find a gym you run.

---

## Step 2 — the list still loads normally

Look down the whole list.

✅ **Expect:** every row shows a name, and under it the day they joined and the
name of the code they came in through. Nothing is missing or blank.

❌ **Failure:** rows with missing names or dates, or the page reporting a problem
loading the members. **This one matters** — the server is sending one new piece of
information per person, and if the app didn't understand it, this is where you
would see it.

---

## Step 3 — your own row (control)

Find **your own name**.

✅ **Expect:** an orange **Complimentary** badge on the right, and **no Remove
button** on your row.

❌ **Failure:** no badge on your row, or a Remove button appearing beside your own
name.

---

## Step 4 — the helper's row, before anything changes (control)

Find the **helper's name**.

✅ **Expect:** **no badge**, and a **Remove** button on the right.

❌ **Failure:** a Complimentary badge here. They are an ordinary member and their
place is one you pay for.

---

## Step 5 — give them the keys

Click **Settings**, then in the **Staff** card add the helper by their email
address as a **Trainer**.

✅ **Expect:** they appear in the staff list as a Trainer.

❌ **Failure:** an error, or nothing happens.

---

## Step 6 — THE ONE THAT MATTERS: back to Members

Click **Members** again.

✅ **Expect:** the helper's row now shows the orange **Complimentary** badge, and
the **Remove button beside their name is gone**.

❌ **Failure:** their row looks exactly as it did at step 4. **That is the bug this
whole card exists to fix.**

*(The Remove button disappearing is correct, not a second bug: the server refuses
to remove someone who still holds the keys. Ending their membership is done from
the Staff screen, keys first.)*

---

## Step 7 — the join-code number has not moved

Go back to your gym's main screen and look at the join codes section again.

✅ **Expect:** the number of people who joined with your code is **exactly the same
number you wrote down before you started**.

❌ **Failure:** the number went down by one. That means the app took a shortcut it
was specifically told not to take — the same shortcut that once made your console
say "nobody has joined yet" over a gym with two people in it.

---

## Step 8 — take the keys back, and the badge goes away

Go to **Settings → Staff**, remove the helper, and choose **just take the keys**
(leave them a member). Then click **Members**.

✅ **Expect:** the helper is still on the Members list, their **Complimentary badge
is gone**, and their **Remove button is back**.

❌ **Failure:** the badge stays, or the person vanishes from the Members list
entirely.

---

## When you're done

Reply with either **"all passed"** or the number of any step that failed and what
you saw instead. A step-by-step report is more useful than a single word, but a
global pass is fine if every step genuinely matched.
