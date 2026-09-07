# SMOKE — the login door: "I'm a member" or "I run a gym"

**Rewritten 2026-08-19, second time, after Kd's ruling that the two doors are
the ONLY way across.** The gym console's "Back to the app" link and the member
sidebar's **My Gym** link are both gone; the console and the setup questionnaire
each gained a **Sign out**. Old steps 5 and 9 tested the two removed links and
have been replaced. Earlier passes on those two steps do not carry over.

**Why this sheet exists.** 806 green tests run with every network call mocked.
They cannot see a real cookie, a real redirect, or a real session surviving a
trip to Google and back — and this card's whole point is what happens BETWEEN
pages. The Card-4 smoke caught a browser-wide bug that 250+ green tests were
structurally incapable of seeing; that is what these steps are for.

**What changed, in one line:** the login page asks which door you came for, and
that choice is now the *only* way between the member app and the gym console —
no shortcut links in either direction, and a **Sign out** on every screen that
previously had none.

---

## Before you start

Two servers, two terminals, from the repo root.

**Terminal 1 — the API**
```
cd apps/api && node --import tsx --env-file=.env src/index.ts
```
Wait for it to say it is listening on port 3000.

**Terminal 2 — the web app**
```
cd apps/web && npx vite
```
Open **http://localhost:5173/login** and press **F5** once so the browser has
the current code.

**You do NOT need the third server** (`mock-ml-backend.mjs`) for any step here.

**Use a PRIVATE / INCOGNITO window** (Ctrl+Shift+N; Firefox Ctrl+Shift+P). A
private window has no session, so the login page actually appears. This is not
fussiness — it is how the 2026-08-19 sitting started, because an already
signed-in account with an unfinished questionnaire never reaches the login page
at all.

**Two accounts make this sheet work:**
- **Account A** — any existing account you already use, questionnaire finished.
- **Account B** — a **brand-new** account you register during step 4 and have
  never signed in with before. It must not have seen the questionnaire.

---

## The steps

### 1 — the door is on the page
Go to the login page.

✅ **Expect:** two buttons above the email box — **I'm a member** and **I run a
gym**. "I'm a member" is highlighted in orange; the other is grey.

❌ **If there is only one button, or none:** stop and say so.

### 2 — the member door goes to the normal app
Leave **I'm a member** selected. Sign in as **Account A**.

✅ **Expect:** you land on the Dashboard — the normal app, exactly as before.

### 3 — the gym door goes to the console, on the SAME account
Sign out. Back at the login page, press **I run a gym**.

✅ **Expect before you type anything:** the button turns orange, and the line
under "Welcome back." changes to *"Sign in to manage your gym"*. There is still
only ONE email box and ONE password box.

Now sign in as **Account A** — the same email and password as step 2.

✅ **Expect:** you land on **Your gyms** (the console), not the Dashboard.

✅ **If Account A does not run a gym yet, expect:** *"You don't run a gym yet.
Create one and you'll get a join code to hand to your members."* — that is
correct, not an error. This screen is how you make a gym.

**This is the step that proves the ruling:** one account, one password, two
different destinations, chosen by the button.

### 4 — a BRAND-NEW gym owner goes STRAIGHT to the console — no questionnaire
Sign out. Press **Create an account** and register **Account B**. When it sends
you back to the login page, press **I run a gym**, then sign in as Account B.

✅ **Expect:** you land on **Your gyms** IMMEDIATELY. **No fitness
questionnaire** — no Basic Info, no goals, no equipment screens.

❌ **If the questionnaire appears before the console:** that is the defect this
step exists for — say so.

### 5 — the console's way out is SIGN OUT, and there is no way into the app
Still on the console as **Account B**. Look at the bottom of the left rail (on a
narrow window, the top bar).

✅ **Expect:** it says **Sign out**.

✅ **Expect:** there is **no "Back to the app"** anywhere on the console, and
nothing else that leads into the normal app.

**Then make the window narrow** (drag its edge in until the left rail turns into
tabs along the bottom).

✅ **Expect:** the top bar still says **Sign out** — not "Back to the app".

**Why both widths:** a gym owner runs the console from a phone. A change that
holds on a laptop and not on a phone would be undone on the surface that matters.

### 6 — pressing Sign out really ends the session
Press **Sign out** in the console.

✅ **Expect:** you land on the login page.

✅ **Now press the browser's BACK button.**

✅ **Expect:** you do **not** get back into the console. You stay on, or bounce
back to, the login page.

**Why the back button:** landing on the login page proves nothing on its own — a
plain link would do that while leaving you signed in. This is the check that the
session actually ended.

### 7 — the questionnaire can be escaped
At the login page, press **I'm a member**, then sign in as **Account B** (the
new account, which has never done the questionnaire).

✅ **Expect:** the setup questionnaire appears — Basic Info first.

✅ **Expect:** a small **Sign out** in the top-right of that screen.

Press it.

✅ **Expect:** you land on the login page, signed out.

✅ **Press the browser's BACK button.** You should **not** land inside the app —
you stay on the login page.

**This is the dead end you found on your first attempt at this sheet:** someone
who signs up, or picks the wrong door, used to be stuck on that questionnaire
with no way out at all.

### 8 — the member sidebar has no shortcut into the console
Sign in as **Account A** through the **member** door. Look at the sidebar.

✅ **Expect:** there is **no My Gym** item.

✅ **Expect:** everything else is still there — Dashboard, Workouts, Nutrition,
Achievements, Settings, Sign out.

❌ **If the whole sidebar is missing or broken:** that is a fail, not a pass —
say so.

**Why:** the gym door on the login page is now the only way to the console.
Wanting the console means signing out and coming back through **I run a gym**.

### 9 — the choice survives a reload
Sign out. Press **I run a gym**, then press **F5** (reload the page) *without*
signing in.

✅ **Expect:** after the reload, **I run a gym** is still the orange one.

### 10 — Google sign-in honours the door too
Sign out. Press **I run a gym**, then press **Continue with Google** and
complete the Google sign-in.

✅ **Expect:** you come back into **Your gyms**, not the Dashboard.

❌ **If Google sign-in is not configured on your local API:** skip this step and
say you skipped it. Do not guess at the result. *(As of 2026-08-19 it IS
configured locally — this step should run.)*

### 11 — the next person on this browser starts fresh
Still signed in from step 10 (or sign in again through the gym door). Now **sign
out**, and look at the login page.

✅ **Expect:** **I'm a member** is highlighted again — the door has been
forgotten.

**Why this matters:** a gym's front-desk laptop is shared. The next person to
use it must not be sent to somebody else's console.

---

## Reporting back

For each step, one line: **pass** or **fail**. On a fail, say what you saw
instead — the screen you landed on, and anything red in the browser console
(F12 → Console).

If a step cannot be run at all, say **skipped** and why. A skipped step is a
fine answer; a guessed one is not.

---

## What carries over from the 2026-08-19 sitting, and what does not

Steps **1–4 PASSED** in Kd's browser on `174fd71`, before this change.

**They are not re-typed, and here is the exact reason — it is a coverage
argument, not a convenience one.** The *judgement* each of steps 1–4 makes is
which screen you land on, and this change touches none of that. What it does
touch is the screens they land ON — the Dashboard's sidebar and the console's
shell — so a pass taken against older bytes must not be the last word on them.
**Steps 5–11 re-observe every one of those surfaces on the new bytes:**

| carried from | re-observed by |
|---|---|
| 2 — member door lands in the app | **8** — member door as A, sidebar inspected |
| 3 — gym door lands in the console | **5** and **10** — the console's shell, and the gym door via Google |
| 4 — new owner skips the questionnaire | **7** — the same account B meeting the questionnaire through the *member* door |
| 1 — both doors on the page | **9** and **11** — the doors, their memory, and its reset |

The one thing genuinely not re-run is **registering** a new account (step 4's
first half), because account B already exists from the earlier sitting and is
still un-onboarded, which is exactly what step 7 needs. **A fresh sitting with no
account B runs the sheet from step 1.**

Old step 5 (crossing into the member app via "Back to the app") and old step 9
(the **My Gym** sidebar entry) tested the two links this ruling removed. They are
gone, replaced by steps 5–8, which assert their **absence** instead.
