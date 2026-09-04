# SMOKE — the gym greets you instead of filling the dashboard

**What this proves:** the dashboard no longer carries a big *"You're a member of
…"* box. Your gym's name is in the greeting at the top — *"Welcome to Iron
House"* — and everything about the gym itself lives on **My gyms**. What has NOT
gone away: if you are still waiting to join a gym, or were removed, or were
turned down, the dashboard still tells you.

**Why it exists.** Kd, 2026-09-04, at his own browser: *"the dashboard should not
even show you are a memebr of xyz it is the part of gym and good afternoon owner
welcome to xyz gym can be there"*.

**Time:** about 6 minutes (7 steps). **You need:** the API and the web app
running locally, and an account that is a **member** of at least one gym.

**Status: PASSED ON KD'S DECLARATION, 2026-09-04 — *"all passed"*, then *"all
working"* when the contradiction below was put to him. NOT A WATCHED RUN, and
the distinction is :27415's and :32498's.** A chat may not write *"the smoke
ran and passed"* about an event it did not see; attributing the claim is how
both things stay true at once.

**⚠️ STEPS 1 AND 3 CONTRADICTED EACH OTHER ON HIS OWN ACCOUNT, AND THAT IS THIS
SHEET'S DEFECT RATHER THAN HIS.** He is a member of TWO gyms (his 2026-09-04
screenshots show both), so `welcomeGym` is null and the *"Welcome to …"* line is
correctly ABSENT for him — while step 1 asked him to confirm it was THERE and
step 3 asked him to confirm it was NOT. **Both cannot pass, so "all passed"
could not be literally true and was not recorded as though it were.** Put to him
in plain words; he answered *"all working"*.
**What is therefore held by TESTS and not by a browser: the line itself**, which
only a one-gym member ever sees (mutant `P6`, and the one-gym case in
`xpDisplay.render.test.jsx`). **What IS declared: the two boxes are gone, the
top of the page is short again, and `My Gyms` and Settings still carry
everything** — which is the whole of what he objected to.
**THE LESSON IS `:32498`'s, one card later: a step whose ✅ cannot be reached on
the account running it invites a tick for something nobody saw.** Step 3 is
struck below rather than deleted, because the wrong step is the lesson.

**THE FOLD WAS SEEN BUT NOT OPERATED.** Step 3 names the *This week* fold as
PRESENT; nothing in this sheet asked him to tap it shut, which is
`smoke-gym-hours-fold.md` step 3 and the guarantee `:31295` exists over. That
sheet is still UNRUN and its own status block says so.

---

| # | Do this | ✅ Expect |
|---|---------|-----------|
| 1 | Sign in as the **member** and look at the top of the **dashboard**. | The greeting, your name, and under it **"Welcome to <your gym>"**. **There is NO bordered box saying "You're a member of …"**, and no opening times anywhere on this screen. If you can see either, that is the failure this card exists to fix — stop and say so. |
| 2 | Look at the space between your name and the big **Start Workout** picture. | It is **short**. The picture should be close to the top of the page — this is the thing you said was destroying the screen, so judge it by eye and say if it still looks wrong. |
| 3 | Go to **My gyms** in the left menu. | Your gym is here in full: its name, **"Today: …"**, the **This week** fold, and the **I'm here** button with **Days you came** under it. **Nothing has been lost — it has moved.** |
| 4 | Go to **Settings → Gym**. | The **"You're a member of …"** card is still here, with the opening times, exactly as before. This is the other place it was always drawn. |
| 5 | ~~**If you are a member of TWO gyms:** go back to the dashboard.~~ **STRUCK 2026-09-04 — it contradicts step 1 for anybody it applies to.** | ~~**No "Welcome to …" line at all.**~~ The RULE is right and unchanged — with two gyms the app will not pick one to greet you at — but a sheet cannot ask one account to confirm the line is present in step 1 and absent here. **To see the line at all, run step 1 on an account that is a member of exactly ONE gym**; on a two-gym account, step 1's ✅ is "no Welcome line, and no membership box either". |
| 6 | In a **different browser** (or a private window), sign up as a new **account B**, go to **Settings → Gym**, and type the gym's join code. Then look at **B's dashboard**. | **"Waiting for <gym> to confirm you"** with a **Remind them** button. **This must still be on the dashboard** — someone waiting has no My Gyms menu item yet, so this is the only place they can see their request. |
| 7 | As the owner, go to **Members** and **confirm B**. Then, as **B**, reload the dashboard. | The waiting box is gone, and B's greeting now reads **"Welcome to <gym>"**. **My gyms** has appeared in B's left menu. |

---

## What this sheet does NOT cover, stated so nothing is over-claimed

- **A member who was REMOVED from a gym**, and one whose request was **refused or
  expired**. Both still draw on the dashboard, and both are held by tests
  (`J36` goes red if either is dropped). Reaching them by hand means removing a
  real member or waiting out an expiry, which is not a useful thing to ask for
  here.
- **How it looks on a phone.** Step 2 is the desktop version of that question.
  The narrow-window check for the hours fold is `smoke-gym-hours-fold.md` step 5.
- **The opening-hours fold itself.** That is its own sheet, and this one only
  asserts the hours are ABSENT from the dashboard.
