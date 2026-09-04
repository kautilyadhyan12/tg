# SMOKE — the week folds away on your gym card

**What this proves:** your gym card shows the one line you actually want —
*"Today: 7:40 AM – 9:40 AM"* — and keeps the rest of the week behind a row you
tap. Tap it again and the week goes away. The card is two lines tall instead of
nine, and nothing you could see before has been taken away.

**Why it exists.** Kd, 2026-09-03, looking at his own card: *"should have a drop
down type of effect whenver click or hover in them"*. It is **tap and not
hover**, because hover does not exist on a phone and the phone is where members
read this.

**Time:** about 4 minutes (5 steps). **You need:** the API and the web app
running locally, an account that is a **member** of a gym, and that gym's
opening times already set for several weekdays (any account that passed
`smoke-opening-hours.md` steps 1–13 has this).

**Status: UNRUN.**

---

| # | Do this | ✅ Expect |
|---|---------|-----------|
| 1 | Sign in as the **member** and look at the main dashboard, at the card that says **"You're a member of …"**. | Under the gym's name: **one line starting "Today:"**, and under that a row reading **"This week"** with a small arrow at its right. **There is NO Monday-to-Sunday list.** If you can see seven weekdays without tapping anything, that is the failure this card was built to fix — stop and say so. |
| 2 | **Tap the "This week" row.** | The seven weekdays appear underneath it, each with its times or the word **Closed**, and the arrow turns over. |
| 3 | **Tap the "This week" row again.** | The seven weekdays **disappear**. The **"Today:" line is still there** — that line must never go away, in either state. (This is the step that matters most: a drop-down that opens and then refuses to close is a real thing that shipped on this app once.) |
| 4 | Go to **My gyms** in the left menu and do steps 1–3 again on the card there. | Exactly the same, and the **Days you came** calendar below it is unaffected — opening the week must not open or close the calendar, and the other way round. |
| 5 | Make the browser window **narrow** (drag its edge in until it looks like a phone), or open the app on your phone. Tap the **"This week"** row. | It is **easy to hit** — the whole row responds, not just the little arrow — and the week opens under it without the card going crooked. |

---

## What this sheet does NOT cover, stated so nothing is over-claimed

- **A gym that is open 24 hours.** There is no week to fold, so no "This week"
  row is drawn at all. That is held by a test (`C214`) rather than by a step,
  because reaching it means switching a real gym's mode back and forth — which
  is the operation that destroyed Kd's own timetable on 2026-09-03 (`:31508`),
  and there is no reason to ask him to do it again.
- **A gym that has never set its hours.** The card draws nothing whatsoever, so
  there is nothing to fold. `smoke-opening-hours.md` step 1 is where that is
  looked at.
- **A dated closure.** The interaction between a closure and the folded week is
  `smoke-opening-hours.md` steps 22 and 22b, which were rewritten for the fold
  in the same commit as this sheet and have **not** been re-run since.
- **How it behaves for somebody who is only WAITING to join a gym.** They are
  not a member yet, so the hours are not drawn for them at all — a deliberate
  choice recorded on `GymMembershipCard`, and not something this sheet touches.
