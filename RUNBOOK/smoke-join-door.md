# SMOKE — the join door: a member types the code, the gym says yes or no

**What changed, in one line:** there is now a place in the app to type your
gym's code, a place in the gym console to see who has asked, and a **Remove**
button so saying yes is no longer permanent.

**Why this sheet exists.** 857 green web tests run with every network call
faked, and 512 green server tests run without a browser. Between them sits the
thing this card is actually about: a real click, on a real screen, reaching a
real server. The Card-4 smoke found a browser-wide bug that 250+ green tests
were structurally incapable of seeing — **and one of this packet's own mutation
tests exists because DELETE and POST look identical to every server test.**

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

**You do NOT need the third server** (`mock-ml-backend.mjs`) for anything here.

**You need TWO accounts and TWO windows**, because this card is two people
talking to each other:

- **The OWNER** — an account that already runs a gym, or make one: sign in, pick
  **I run a gym**, and create one. Keep this in your normal window.
- **The MEMBER** — a different account, in a **private / incognito window**
  (Ctrl+Shift+N). It must not be staff of the gym. If you register a new one it
  will walk you through the questionnaire first; finish it.

Have the gym's **join code** to hand — the owner's console shows it on the gym
screen.

---

## The steps

### 1 — the gym has nobody waiting yet
In the OWNER window, open the console and click into your gym.

✅ **Expect:** the gym's name, its join code, and a members line. **No mention
of anybody waiting.**

---

### 2 — the member finds the code box
In the MEMBER window: **Settings** → the **Gym** tab.

✅ **Expect:** a box asking for your gym's code, and underneath it a panel
headed **"What a gym can see"** listing what a gym can see (your workouts, your
form scores, your streak) and five things it never sees — **meals, weight,
coach conversations, your running routes, and anything from before you joined
or after you leave.**

*(This list is a promise the product makes in writing. If it is missing, stop —
that is a failure on its own.)*

---

### 3 — a wrong code is refused in plain words
Type **ZZZZZZ** and press **Ask to join**.

✅ **Expect:** *"That code doesn't match any gym."* — and the code you typed is
still in the box.

---

### 4 — the real code puts you in the queue
Clear it, type the gym's real code, press **Ask to join**.

✅ **Expect:** *"You've asked to join {your gym's name}."*, a line saying
someone at the gym confirms new members, and the same list again — now headed
**"What {your gym} can see"**.

❌ **Fail if** it mentions an email, or says the request expires. Neither of
those exists yet, so either would be the app promising something it cannot do.

---

### 5 — the app says so on the dashboard too
In the MEMBER window, go to the **Dashboard**.

✅ **Expect:** a card near the top: **"Waiting for {your gym} to confirm you"**.
Everything else on the dashboard works exactly as before — you are not parked
anywhere.

---

### 6 — asking twice is harmless
Back to **Settings → Gym**, press **Enter a different code**, type the same real
code again and press **Ask to join**.

✅ **Expect:** the same waiting answer, no error. Reload the Dashboard: still
**one** card, not two.

---

### 7 — the gym sees them
In the OWNER window, reload the gym screen.

✅ **Expect:** **"1 person waiting — confirm them here"** on the members line.
Click through to **Members**.

✅ **Expect:** a **Waiting to join** section above the member list, with the
member's name, the day they asked, and — on the small grey line under the name —
**the code's LABEL, not the six characters they typed.** With one code that
label is **Front Desk**, so the line reads `Asked 20 August · Front Desk`. (The
label is there so a gym running several codes — "Front Desk", "Morning Batch" —
can see which door each person came through. A gym with one code always sees
"Front Desk".) The list below still shows only you.

---

### 8 — refusing works
Press **Not this person**.

✅ **Expect:** the row disappears and the waiting section goes with it. Reload —
still gone.

---

### 9 — the member is told
In the MEMBER window, reload the **Dashboard**.

✅ **Expect:** **"{your gym} didn't confirm your request"** with a **Try again**
link.

---

### 10 — asking again is free
Press **Try again**, type the code, press **Ask to join**.

✅ **Expect:** the waiting answer again.

---

### 11 — confirming works, and the person lands in the list
In the OWNER window, reload **Members** and press **Confirm**.

✅ **Expect:** the waiting row disappears **and the member's name appears in the
list below within a second** — without you reloading anything.

---

### 12 — the member is told they are in
In the MEMBER window, reload the **Dashboard**.

✅ **Expect:** **"You're a member of {your gym}"**. The waiting card is gone.

---

### 13 — Remove asks first
In the OWNER window, on **Members**, press **Remove** beside the member.

✅ **Expect:** a question — *"Remove {name}? They keep their own workouts and
lose your gym's features."* — with **Remove** and **Keep**. Press **Keep**.

✅ **Expect:** nothing happens; they are still on the list.

---

### 14 — Remove removes
Press **Remove** again, then **Remove** in the question.

✅ **Expect:** the member disappears from the list. Reload — still gone.

**This is the step the whole card turns on**, because deleting a member goes
over the wire in a way no server test can check. If nothing happens, or you see
an error about the connection, say so.

---

### 14b — the removed person is TOLD
In the MEMBER window, reload the **Dashboard**.

✅ **Expect:** a card saying **"You're no longer a member of {your gym}"**, and
underneath it that everything they did there is still theirs — workouts, form
scores and streak unchanged — and that they keep the free app.

❌ **Fail if** it says the gym **didn't confirm** them, or **refused** them, or
offers a **Try again** link. They were let in and then taken out; saying they
were refused would be a different untruth. (This is the bug the review found
after the first run of this sheet — it used to say exactly that.)

❌ **Fail if** the card is **missing entirely**. Saying nothing at all was the
second half of the same bug.

---

### 15 — you cannot remove yourself by accident
Look at your own row in the list (marked **Complimentary**).

✅ **Expect:** **no Remove button beside it.**

---

### 16 — a poster link carries the code
In the MEMBER window, go to
**http://localhost:5173/org/join?code=YOURCODE** (put the real code in).

✅ **Expect:** the same screen as step 2, with the code **already filled in**
and NOT submitted. Press **Ask to join**.

✅ **Expect:** the waiting answer.

---

### 17 — it works at phone size
In the OWNER window, narrow the browser until the console's left rail turns into
a bar of tabs at the bottom.

✅ **Expect:** on **Members**, the waiting section and its **Confirm** / **Not
this person** buttons are all reachable and readable, and nothing runs off the
edge of the screen.

---

## What this sheet cannot check

- **A trainer.** No screen creates one yet, so "a trainer sees no waiting list"
  is proven by tests and by the server refusing them, not here.
- **A full gym.** No gym has a paid plan yet, so the "your plan covers N
  members" refusal cannot be reached.
- **Anything expiring.** ~~Nothing expires yet — that is the next card.~~
  **BUILT 2026-08-20** (the waiting room's clock): requests now expire, the gym
  gets chased, and the waiting member can send a reminder. That has its own
  sheet — `RUNBOOK/smoke-clock.md` — because every threshold in it is measured
  in days and it needs a command that stands the clock in the future. **This
  sheet is unchanged and still valid**; it simply stops before the clock starts.

---

## Reporting

For each step: the number, and **pass** or what you saw instead. If a step
fails, stop there and say which one — the ones after it usually depend on it.
