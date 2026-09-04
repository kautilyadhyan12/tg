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

**Status: PASSED — ON KD'S DECLARATION, NOT ON A WATCHED RUN (2026-09-04).**
*"these tests have been perfomred 100 times till now lets just fucking wrap this
card and write all tests passed"*, given after being handed
`smoke-attendance.md` in full and asking for the card wrapped. **He is the
operator and the gate is his** (`:27415`, `:32498`, `:33265`). **He was NOT shown
this sheet's five steps in that session**, which is recorded so nobody reads the
discharge as coverage.
~~**WHAT IS THEREFORE STILL HELD BY TESTS AND NOT BY A BROWSER: step 3, the
CLOSING tap.**~~ **— CORRECTED THE SAME DAY BY KD: HE HAS TAPPED IT SHUT.**
Told that the closing tap had no human eyes on it, he answered *"these were
tested and passed"* (2026-09-04, DECISIONS `:34147`). **So step 3 is passed on
his declaration like the rest of this sheet**, and the sentence above was wrong
about what he had done, not about what the record held.
Step 3 is the whole subject of `:31295` — a dropdown that arrived open, could
not be closed, and whose two comments both said it worked — and its other
observers are mutant `C212` and the `gymHours.render.test.jsx` case asserting the
second tap.

~~**UNRUN AS A SHEET, and only the fold's *presence* has been looked at.**~~
Kd declared the dashboard-greeting sheet passed on 2026-09-04, and its step 3
names the **This week** fold as being on the `My Gyms` card — so the fold has
been SEEN. ~~**Nobody has tapped it shut.**~~ **— NO LONGER TRUE: he says he
has** (`:34147`), and this sentence is struck rather than deleted because it was
true for a day and its replacement is a declaration, not an observation anybody
watched. Tapping it shut is step 3 below, it is the whole
point of `:31295` (a dropdown he found dead at his own browser because it opened
and would not close), and it is held today by mutant `C212` and by the
`gymHours.render.test.jsx` case that asserts the SECOND tap.

**EVERY STEP MOVED TO `My Gyms` ON 2026-09-04, AND THE SHEET COULD NOT HAVE BEEN
RUN AS WRITTEN.** Steps 1–3 used to say *"the main dashboard, at the card that
says **You're a member of …**"*. Hours after this sheet was written Kd ruled that
card off the dashboard — *"the dashboard should not even show you are a memebr of
xyz"* (`:33091`) — and the opening times ride on that row, so **the screen those
steps named stopped existing.** Found by T3 round 1 on `:32929`/`:33091`; the
sheet was wrong and the code was what he ruled (`:32583` §2). The old step 4
(*"now do steps 1–3 again on `My Gyms`"*) is folded in, and what it uniquely
tested — that the week and the **Days you came** calendar do not move each other
— is step 4 in its own right.

---

| # | Do this | ✅ Expect |
|---|---------|-----------|
| 1 | Sign in as the **member**, click **My Gyms** in the left menu, and look at your gym's card. | Under the gym's name: **one line starting "Today:"**, and under that a row reading **"This week"** with a small arrow at its right. **There is NO Monday-to-Sunday list until you tap that "This week" row.** If you can see seven weekdays before tapping it, that is the failure this card was built to fix — stop and say so. |
| 2 | **Tap the "This week" row.** | The seven weekdays appear underneath it, each with its times or the word **Closed**, and the arrow turns over. |
| 3 | **Tap the "This week" row again.** | The seven weekdays **disappear**. The **"Today:" line is still there** — that line must never go away, in either state. (This is the step that matters most: a drop-down that opens and then refuses to close is a real thing that shipped on this app once.) |
| 4 | Tap **"This week"** open once more. Now open the **"Days you came"** calendar below it, and close it again. | The two are **independent**. Opening or closing the calendar leaves the week exactly as you left it, and opening or closing the week leaves the calendar exactly as you left it. Neither may move the other. |
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
  in the same commit as this sheet, re-pointed at `My Gyms` on 2026-09-04 with
  these steps, and have **not** been re-run since either edit.
- **The dashboard.** There is nothing to fold there any more — the whole
  membership card came off that screen on 2026-09-04 (`:33091`), and what
  replaced it is one line in the greeting with no opening times in it at all.
  That the times are ABSENT from the dashboard is
  `smoke-dashboard-gym-greeting.md` step 1, not a step here.
- **How it behaves for somebody who is only WAITING to join a gym.** They are
  not a member yet, so the hours are not drawn for them at all — a deliberate
  choice recorded on `GymMembershipCard`, and not something this sheet touches.
