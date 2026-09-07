# SMOKE — giving someone else the keys to your gym

**What changed, in one line:** a gym owner can now hand another person the keys —
see everyone who helps run the gym, add someone, change what they can do, and take
the keys back.

## RESULT — PASSED 2026-08-22 (Kd), on commit `971836d`: "apart from that all passed"

**Recorded as a GLOBAL pass with two observations, not per-step evidence.** Run in
his own browser against the Neon dev database, on his real gym `iron man` with the
`Smoke Test Member` account that was already on its roster.

**What it settles, and only a browser could:** the two CORS-preflight methods work
— `PATCH …/staff/:userId` (step 7) and `DELETE …/staff/:userId` (step 9) — which
`fastify.inject` cannot exercise and which Card 4 proved can be dead app-wide
behind a green suite. Also, against live data: the number beside join code
`WE6RGX` read **1** before and after an appointment (step 6), which is :14401's
C/H-1 correction holding on a real gym rather than in a fixture.

**STEP 8 IS ATTESTED — confirmed on a second ask** (*"yes is did all step and
passed"*). It was written down as unestablished first, because his initial report
did not say whether he had the helper account's password and the step needs a
sign-in as that account; asking again is what turned it into evidence. So a
manager signing in really does get no Settings tab, and typing the address really
does land on the refusal — carried by a person, not only by mutant S9.
**Worth keeping as method, not as an apology: the global "all passed" did not
cover the one step whose prerequisite was in doubt, and only naming the doubt got
it covered.**

**IT PRODUCED ONE FIX AND ONE RULING** (DECISIONS :14745): the removal question
gained a THIRD stage — picking an outcome used to do it — and Kd amended :11429 to
want custom role names as well as per-staff ticks. **Steps 9 and 11 below are
rewritten for the three-tap flow; the version he ran had two.**

## RE-SMOKE — STEPS 9 AND 11 PASSED 2026-08-22 (Kd), on commit `2e5500e`: "all passed"

The three-tap removal was exercised in a browser on the shipping bytes: the middle
question, the last check, **Cancel at the last check leaving everything alone**,
and the destructive arm naming the bigger outcome in red. Both arms end with the
list and the count correct, and "just take the keys" leaves the person on Members.
**The gap the note below describes is now closed** — everything on this sheet has
been run by a person on the code that ships.

**HIS RE-SMOKE ALSO PRODUCED A FINDING, and it is not about these steps:** a staff
member takes no seat but the roster does not say so. Recorded at DECISIONS
:14953 with its own `OWED.md` line; not built here.

**⚠️ THE NOTE BELOW IS WHY THIS RE-RUN HAPPENED — kept, not deleted.**
He ran the sheet on `971836d`, which had the TWO-tap removal. `ba7bd13` rewrote
that exact control into three taps and rewrote steps 9 and 11 *after* he had run
them, and T3 round 1's fixes (`the next commit`) touched the same panel again.
:14745, `HANDOFF.md` and `ba7bd13`'s own message all said "T3 is the only
remaining gate" and **all three were wrong** — this repo's precedent is that a
smoke restarts on the amended bytes (:10959), that steps are re-run when the
screen they land on changed (:11616), and that a control step cannot be carried
forward across a rewrite of the thing it controls (:3917). **Everything else on
this sheet stands and is not re-run**; only 9 and 11 are.

**T3 ROUND 1 IS RUN — two Critical/High, both fixed (:14840); a diff-only
re-review is owed.** A passing smoke was never a review, and this review was
never a substitute for re-running what it changed.

---

**12 steps, about 20 minutes.**

**Why this matters.** Until now a gym had exactly one person who could do
anything. The "front desk confirms new members" idea the app is built around was
impossible, because no gym could have a front desk. This is the screen that fixes
that.

**The two steps that matter most are 7 and 9.** Changing someone's role and taking
their keys back are the only two actions in this whole feature that the automated
tests are structurally unable to check — the browser asks the server for
permission before those two, in a way our tests can't imitate. This has bitten the
project once before, where 250 passing tests sat on top of a button that was dead
in a real browser. If either of those steps does nothing, that is the bug.

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

**You need two accounts.**

- The **owner** — an account that already runs a gym.
- The **helper** — a different account that has **already joined that gym** with
  its join code.

Use two different browsers, or one normal window and one private window — not two
tabs of the same window, because they share a login.

If the helper has not joined yet: sign in as the helper, go to **Settings → Gym**,
type the owner's join code, and then confirm them from the owner's **Members**
screen. You need them showing up as a member before step 4.

**Write down one number before you start.** As the owner, open your gym's page and
look at the join codes section. Note the number of people it says have joined with
your code. You will check it again at step 6.

---

## Step 1 — the Settings tab exists

As the **owner**, go to **/console** and click your gym.

✅ **Expect:** along the left (or across the bottom on a narrow window) there are
now **three** tabs: **Gym**, **Members**, and a new **Settings**.

❌ **Failure:** only Gym and Members. No Settings tab.

---

## Step 2 — open it

Click **Settings**.

✅ **Expect:** a page headed **Settings** with your gym's name under it, a card
headed **Staff**, and at the bottom a line saying your join codes are on your
gym's main screen (with a link).

❌ **Failure:** a blank page, an error card, or the page says it couldn't find a
gym you run.

---

## Step 3 — your own row

Look at the Staff card.

✅ **Expect:** all four of these.

- The sentence *"Who can help you run this gym. Staff don't use up one of your
  paid member seats."*
- **1 person runs this gym** on the right of the word Staff.
- One row: your own name with **(you)** after it, and under it your email,
  **Owner**, and the date you started.
- On your own row, **no buttons** — instead the sentence *"A gym can't be left
  with nobody in charge."*

❌ **Failure:** buttons on your own row. Those would be guaranteed to fail if
pressed, which is why they should not be there.

---

## Step 4 — add your helper

Click **Add someone**.

✅ **Expect:** a small form with a box for their email, and two choices —
**Manager** and **Trainer** — each with a line explaining what it means.
**Trainer** should already be selected.

Trainer being preselected is deliberate: it is the smaller of the two grants.

Type the **helper's** email address, leave **Trainer** selected, and click **Add**.

✅ **Expect:** the form closes and a second row appears with the helper's name,
their email, **Trainer**, and today's date. The count on the right becomes
**2 people run this gym**.

❌ **Failure:** nothing happens, or the page has to be reloaded before the new
person shows up.

---

## Step 5 — an email that isn't in your gym

Click **Add someone** again and type an email address that has never joined your
gym — make one up, for example `nobody-here@example.com`. Click **Add**.

✅ **Expect:** you are refused, with a message along the lines of *nobody in this
gym has that email address*, and the form **stays open with what you typed still
in it**.

❌ **Failure:** the form closes and loses your typing, or the message tells you
whether that address has an account somewhere. It must not — that would let anyone
with a gym test whether an email address is registered.

Click **Cancel**.

---

## Step 6 — the join-code number has NOT moved

Go back to your gym's main page (the **Gym** tab) and look at the join codes
section again.

✅ **Expect:** the number of people who joined with your code is **exactly the
same as the one you wrote down at the start**. Making your helper staff must not
change it.

❌ **Failure:** the number went down by one. An earlier version of the server did
exactly that, and it was fixed — if it has come back, say so.

---

## Step 7 — change what they can do ⚠️ ONE OF THE TWO IMPORTANT ONES

Back on **Settings**. On the helper's row, click **Make manager**.

✅ **Expect:** within a second or two the row's label changes from **Trainer** to
**Manager**, and the button now reads **Make trainer**.

❌ **Failure:** nothing at all happens, or you see an error mentioning the
connection. If nothing happens, open the browser's developer tools (**F12**) →
**Console**, and tell me what it says there. This is the step that catches the
dead-button-in-a-real-browser bug.

---

## Step 8 — the helper does NOT get a Settings tab

Sign in as the **helper** in your second browser, and go to **/console**, then
their gym.

✅ **Expect:** they see **Gym** and **Members** — and **no Settings tab**.

Now, in the helper's address bar, add `/settings` to the end of the address and
press Enter.

✅ **Expect:** a card saying *"Only the gym's owner can change these settings."*
They must **not** see the staff list.

❌ **Failure:** they see the staff list, or a Settings tab appeared for them.

---

## Step 9 — take the keys back ⚠️ THE OTHER IMPORTANT ONE

Back as the **owner**, on Settings. On the helper's row, click **Remove**.

✅ **Expect:** the button is replaced by a question — *"Take [name]'s keys back?"*
— with **two** answers, neither of them preselected:

- **Just take the keys** — *they stay a member of your gym.*
- **Remove from the gym too** — *they lose your gym's features. They keep every
  workout they have done.*

…and a **Cancel**.

Click **Just take the keys**.

✅ **Expect:** **still nothing has happened.** You now get a last check —
*"Take [name]'s keys back? They stay a member of your gym."* — with **Take the
keys** and **Cancel**.

❌ **Failure:** they were removed as soon as you picked. That is the defect Kd
found on 2026-08-22 and it has mutant **S12** on it now.

Click **Cancel** once and check the row goes back to a plain **Remove** button
with nothing changed. Then do it again and click **Take the keys**.

✅ **Expect:** their row disappears from Staff and the count goes back to
**1 person runs this gym**.

❌ **Failure:** nothing happens (again, check **F12 → Console** and tell me), or
only one answer was offered at the first question.

---

## Step 10 — they are still a member

Click the **Members** tab.

✅ **Expect:** the helper is **still there** in the members list. Taking someone's
keys must not throw them out of the gym.

❌ **Failure:** they are gone from Members too.

---

## Step 11 — the other answer

Go back to **Settings**, add the helper again (**Add someone** → their email →
**Add**). Then click **Remove** on their row, choose **Remove from the gym too**,
and confirm at the last check with **Remove them**.

✅ **Expect at the last check:** the sentence names the bigger outcome — *"Remove
[name] from your gym as well? They lose your gym's features. They keep every
workout they have done."* — and the button is red. If it repeats the SMALLER
outcome back at you, that is a failure: the confirmation is meant to say what you
actually chose.

✅ **Expect:** their row disappears from Staff, the count goes back to **1 person
runs this gym**, and when you click **Members** they are **gone from there too**.

❌ **Failure:** they vanish from Staff but are still on the members list with no
message explaining it. (If you *do* get a message saying they no longer run the
gym but are still a member, that is not a failure — that is the app telling you
the truth about a half-finished change. Say so and I'll look at why the second
half failed.)

---

## Step 12 — it survives a reload

Press **F5** on the Settings page.

✅ **Expect:** the Staff card comes back with just you in it, **1 person runs this
gym**, and no leftover error messages.

❌ **Failure:** the card is empty, or says the gym has nobody running it. That
sentence should be impossible — a gym always has its owner.

---

## When you're done

Tell me **pass or fail for each numbered step**. If a step fails, tell me what you
saw instead of the ✅ line, and for steps 7 and 9 include whatever **F12 →
Console** shows.
