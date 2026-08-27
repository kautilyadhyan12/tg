# SMOKE — starting your gym's free trial

**What changed, in one line:** a gym owner can now start their own 30-day free
trial from the console, see how many days are left on every console screen, and
see how many of their gym's places are taken.

## RESULT — UNRUN

---

**9 steps, about 15 minutes. You need TWO accounts** (your owner account, and any
second account that is a member of your gym — the same pair you used for the
staff and join-code sheets).

## BEFORE YOU START — done for you on 2026-08-27, kept here for the next run

**The test database was out of date and it has been fixed.** If you are reading
this on a later day, check it again — this has now bitten three times.

Measured before: **14 of 15 database changes applied**, and the price list was the
old all-India one with **no United States prices at all**, so a US gym would have
been told *"We're not open for business in your country yet"* — which reads like a
broken app when it is really a stale copy.

Measured after: **15 of 15 applied · 10 live plans (5 US, 5 India), 300/500/1000/
1500/2100 places, 30-day trial · the 6 old rows retired · every gym owner carries
the new billing permission.**

The two commands, if this is ever needed again (in this order, then RESTART the
API — it remembers the old shape of the database otherwise):

```
pnpm --filter api exec drizzle-kit migrate
pnpm --filter api exec tsx src/db/seed.ts
```

## WHICH ACCOUNTS TO USE — measured 2026-08-27, not guessed

A sheet written imagining accounts that do not exist is how four steps went wrong
last time, so here is what is actually in the database:

| Account | What it is | Where |
|---|---|---|
| `owner@example.com` | **owner** | of BOTH **owner** (`/owner`) and **Smoke Test Gym** (`/smoke-test-gym`) |
| `user2@example.com` | **trainer** (staff) | on the **owner** gym |
| `user@example.com` | **plain member** (not staff) | on the **owner** gym |
| `kd@example.com` | owner | of **iron man** (`/iron-man`) — not used by this sheet |

**Every step below needs NO setup.** All three accounts and both gyms already
exist, in exactly the shape the steps want:

* **Start the trial on the `owner` gym**, not on Smoke Test Gym. It is the one
  that already has a trainer AND a plain member on it, which steps 6 and 8 need.
* **Smoke Test Gym is for step 7** — the same person owns it, so it is where the
  one-trial-per-person refusal shows up.
* **Nobody has used a trial and no gym is on a plan.**

**The gym has ONE person taking a place**, measured: the owner's own seat is
complimentary and staff seats are free, so of the three people on the `owner`
gym only `user@example.com` occupies one. That is why step 2 expects **1**.

---

## Step 1 — the offer is on your gym's screen

Sign in as `owner@example.com`, go to **Gym console → owner** (`/console/owner`).

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

✅ Under that: **"1 of 300 places used"** — one, not three. The owner's own seat
is complimentary and staff seats are free, so only `user@example.com` occupies a
place. If it says 3, the meter is counting people the gym is not charged for and
that is a failure worth writing down.

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

Sign out. Sign in as **`user@example.com`** — a plain member of the *owner* gym
who does not run it. Open the app normally (the member side, not the console).

✅ Nothing anywhere tells this person your gym is on a trial, or when it ends.
That is deliberate — your gym's billing is not your members' business.

## Step 7 — one trial per person, not one per gym

Sign back in as `owner@example.com`. Go to **Gym console → Your gyms** and open
**Smoke Test Gym** — the other gym the same person owns.

Look for the trial card.

✅ It is there — a gym on no plan still offers the button.

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

**No setup needed** — `user2@example.com` is already a trainer on the *owner*
gym, and a trainer is the smallest amount of authority there is, which makes it
the strongest version of this check.

Sign out, sign in as **`user2@example.com`**, and open **Gym console → owner**.

✅ They see the gym, the join code and the members.

✅ They see the **"Free trial — 30 days left"** strip and the **"Plan — Free
trial"** card (staff may know what the gym is on).

✅ There is **no button** anywhere offering to start, change or end a plan.

## Step 9 — the gym you did not touch is still untouched

Still on the second gym from step 7:

✅ Its card still says **"Start your 30-day free trial"** — the refusal did not
half-start anything.

✅ There is **no strip** across the top on this gym.

Nothing to tidy up: both gyms already existed.

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
