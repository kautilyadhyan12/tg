# SMOKE — the login door: "I'm a member" or "I run a gym"

**Rewritten 2026-08-19 after Kd's amendment (DECISIONS :10959): a gym owner no
longer gets the fitness questionnaire at sign-in.** Step 4's expectation changed
and step 5 is new; earlier passes were on the old bytes and do not carry over.

**Why this sheet exists.** 797 green tests run with every network call mocked.
They cannot see a real cookie, a real redirect, or a real session surviving a
trip to Google and back — and this card's whole point is what happens BETWEEN
pages. The Card-4 smoke caught a browser-wide bug that 250+ green tests were
structurally incapable of seeing; that is what these steps are for.

**What changed, in one line:** the login page now asks which door you came for.
Same email, same password, same account — the choice only decides whether you
land in the normal app or in your gym console, and the fitness questionnaire
belongs to the member side only.

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
Open the URL it prints (usually http://localhost:5173) and press **F5** once so
the browser has the current code.

**You do NOT need the third server** (`mock-ml-backend.mjs`) for any step here.

**Two accounts make this sheet work, and step 4 needs a brand-new one:**
- **Account A** — any existing account you already use. Steps 1–3, 6–9.
- **Account B** — a **brand-new** account you register during step 4 and have
  never signed in with before. It must not have seen the setup questionnaire.
  Register it at step 4, not now.

**If you are already signed in, sign out first** (sidebar → Sign Out). Several
steps below start from the login page and being signed in skips it.

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

### 5 — crossing into the member app brings the questionnaire, then
Still signed in as **Account B**, press **Back to the app** (bottom of the
console's left rail; on a narrow window it is in the top bar).

✅ **Expect:** NOW the setup questionnaire appears (Basic Info → Fitness Level
→ Goals → Equipment → Preferences). Fill in all five steps and finish.

✅ **Expect after the last screen:** you land on the **Dashboard** — the member
app, which is where you were headed.

**This is Kd's own design:** the questionnaire belongs to the member side, and
it arrives exactly when someone chooses to use it — not before.

### 6 — the choice survives a reload
Sign out. Press **I run a gym**, then press **F5** (reload the page) *without*
signing in.

✅ **Expect:** after the reload, **I run a gym** is still the orange one.

### 7 — Google sign-in honours the door too
Sign out. Press **I run a gym**, then press **Continue with Google** and
complete the Google sign-in.

✅ **Expect:** you come back into **Your gyms**, not the Dashboard.

❌ **If Google sign-in is not configured on your local API:** skip this step and
say you skipped it. Do not guess at the result.

### 8 — the next person on this browser starts fresh
Still signed in from step 7 (or sign in again through the gym door). Now **sign
out**, and look at the login page.

✅ **Expect:** **I'm a member** is highlighted again — the door has been
forgotten.

**Why this matters:** a gym's front-desk laptop is shared. The next person to
use it must not be sent to somebody else's console.

### 9 — the old way across still works
Sign in as **Account A** through the **member** door. Look at the sidebar.

✅ **Expect:** the **My Gym** item is still there and still opens the console.

**This is deliberate.** Nothing was removed. An owner already inside the app
still needs a way across without signing out.

---

## Reporting back

For each step, one line: **pass** or **fail**. On a fail, say what you saw
instead — the screen you landed on, and anything red in the browser console
(F12 → Console).

If a step cannot be run at all (step 7 without Google configured), say
**skipped** and why. A skipped step is a fine answer; a guessed one is not.
