# SMOKE — starting your gym's free trial

**What changed, in one line:** a gym owner can now start their own 30-day free
trial from the console, see how many days are left on every console screen, and
see how many of their gym's places are taken.

## RESULT — UNRUN

---

**9 steps, about 15 minutes. You need TWO accounts** (your owner account, and any
second account that is a member of your gym — the same pair you used for the
staff and join-code sheets).

## BEFORE YOU START — please read, this one bites

**Your test database is out of date, and if you skip this the very first step
fails for a reason that has nothing to do with what we built.** The price list on
it is the old one, and the newest database change has never been applied there. A
gym in the United States would be told *"We're not open for business in your
country yet"*, which reads like the app is broken when it is really just a stale
copy.

This has now happened three times on this project, so it is written here rather
than left to be rediscovered.

Run these two, in this order, from the project folder. Tell me if either one
prints an error and stop there:

```
pnpm --filter api exec drizzle-kit migrate
pnpm --filter api exec tsx src/db/seed.ts
```

Then start the two servers (same as always — ask me and I will start them for
you):

* the API
* the web app

**If the API was already running, stop it and start it again after the two
commands above.** It remembers the old shape of the database otherwise.

---

## Step 1 — the offer is on your gym's screen

Sign in as the OWNER, go to **Gym console → your gym**.

✅ Near the top you see a card headed **"Start your 30-day free trial"**, with the
line *"Your members get the gym's features for 30 days. No card needed."* and
underneath it *"One free trial per person."*

✅ There is **no coloured strip** across the top of the screen yet.

❌ If you see *"We're not open for business in your country yet"*, the two
commands above did not run or the API was not restarted. Stop and tell me.

## Step 2 — start it

Press **Start your 30-day free trial**.

✅ The card changes to **"Plan — Free trial"**, with **"Ends"** and a date about a
month from today.

✅ Under that: **"0 of 300 places used"** (or however many members you already
have, out of 300).

✅ A strip appears across the top of the screen saying **"Free trial — 30 days
left."** (29 is also correct depending on the hour.)

## Step 3 — the number is real, not a guess

Look at the date in step 2 and count roughly 30 days from today.

✅ It matches. If it says something wildly different — today's date, or next year
— that is a failure, write down exactly what it says.

## Step 4 — the strip follows you around

Click **Members** in the sidebar (or the bottom bar on a phone).

✅ The same **"Free trial — 30 days left."** strip is still across the top.

✅ Under the "Members" heading you also see **"X of 300 places used"**.

This is the point of the strip living where it does — it has to reach you wherever
you are, not only on the gym's own page.

## Step 5 — put the strip away for today

Go back to your gym's screen. On the right-hand end of the strip there is a small
**✕**. Press it.

✅ The strip disappears.

Now click **Members**, then click back to your gym.

✅ The strip is **still gone**. It is meant to stay away until tomorrow.

Now press **F5** to reload the page.

✅ Still gone.

## Step 6 — pressing the button twice is not a problem

(You cannot reach the button any more, which is itself correct — so this step is
about the SECOND account.)

Sign out. Sign in as your **second account**, the one that is a member of your gym
but does not run it. Open the app normally (the member side, not the console).

✅ Nothing anywhere tells this person your gym is on a trial, or when it ends.
That is deliberate — your gym's billing is not your members' business.

## Step 7 — one trial per person, not one per gym

Sign back in as the OWNER. Go to **Gym console → Your gyms → New gym** and create
a second gym (any name, country **United States**).

Open that new gym and look for the trial card.

✅ It is there — a brand-new gym is on no plan.

Press **Start your 30-day free trial**.

✅ You are refused, in these words: **"You've already used your free trial. It's
one per person, not one per gym."**

✅ There is **no "Try again" button** under that message. Pressing again would
only say the same thing.

✅ The card still offers the button (that is fine — the button is the retry), and
the gym is still on no plan.

**This is the thing that replaced me approving every gym by hand.** If this step
lets you start a second trial, that is a real failure — write it down.

## Step 8 — a helper cannot touch the money

Still as the owner, on your FIRST gym (the one on trial), go to **Settings →
Staff** and make your second account a **Manager** if it is not one already.

Sign out, sign in as the second account, and open **Gym console → the gym**.

✅ They see the gym, the join code and the members.

✅ They see the **"Free trial — 30 days left"** strip and the **"Plan — Free
trial"** card (staff may know what the gym is on).

✅ There is **no button** anywhere offering to start, change or end a plan.

## Step 9 — tidy up

Sign back in as the owner and delete or ignore the second gym from step 7 — it is
only a test gym. Nothing to check here.

---

## What this sheet does NOT settle, said plainly

* **What happens when a trial actually runs out.** Nothing in the app ends a trial
  yet — that is built later — so no step here can test it. The strip is written so
  that it never claims a trial has ended.
* **The amber "your trial ends soon" warning.** It only appears in the last three
  days, and your trial has thirty. Testing it would mean editing the database by
  hand; a test does that instead.
* **The "your gym is full" message.** It needs 300 members.
* **Anything about paying.** There is no payment screen yet, by design, which is
  why no message here offers one.
