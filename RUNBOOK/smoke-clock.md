# SMOKE — the waiting room's clock: requests that run out, and a nudge

**What changed, in one line:** a join request now has a deadline, the gym gets
chased about it, and the person waiting can tap **Remind them**.

**10 steps, about 15 minutes.**

**Why this sheet exists.** Every number in this feature is measured in DAYS. So
the only way to see it work in a browser would be to wait a fortnight — which is
why you get a command that lets you **stand at a date in the future** and watch
the app catch up in about ten seconds.

**Nothing sends an email.** There is no email anywhere in this product yet. The
reminder shows up as a mark on the gym's own waiting list, and every word on
both screens is written to say exactly that. If you see anything promising a
message, an email or a notification, that is a failure.

---

## Before you start

Three terminals this time, from the repo root.

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

**Terminal 3 — leave it open and empty.** This is where you will run the clock
command in steps 4 and 6.

> ⚠️ **Read this once before step 4.** The clock command works on **every**
> waiting join request in whatever database `apps/api/.env` points at — not just
> yours. On your development database that is fine and expected. **Do not run it
> against a database with real gyms on it**, because with a future date it would
> expire all of their waiting requests too. If you have ever pointed that file at
> anything but the dev database, check it before step 4.

**You need TWO accounts and TWO windows**, same as the join-door sheet:

- **The OWNER** — an account that runs a gym. Normal window.
- **The MEMBER** — a different account in a **private / incognito window**
  (Ctrl+Shift+N), not staff of that gym.

Have the gym's **join code** to hand.

**Start clean:** the MEMBER must NOT already be a member of this gym and must
NOT have a request waiting. If they do, remove them from the console first.

---

## The steps

### 1 — ask to join, and see the deadline
In the MEMBER window: **Settings** → the **Gym** tab. Type the code and press
**Ask to join**. Then open the **Dashboard**.

✅ **Expect:** a card saying **"Waiting for {your gym} to confirm you"**, and
under it a line saying **"Expires in 13 days"** or **"in 14 days"** — plus that
if that happens you can just enter the code again.

❌ **Fail if** there is no countdown line, or it says a number of days that is
not 13 or 14.

---

### 2 — the reminder button is there, and it works
Still on the MEMBER dashboard, press **Remind them**.

✅ **Expect:** the button is replaced by a line saying **the gym can see you're
still waiting**, and when you can do it again — "tomorrow" or "later today".

❌ **Fail if** anything on screen says an **email**, a **message** or a
**notification** was sent. Nothing was — no email exists.

---

### 3 — the gym can see they asked
In the OWNER window, open the console → your gym → **Members**.

✅ **Expect:** in **Waiting to join**, the person's row now shows a line in
orange saying **"They asked again in the last hour"** (or "2 hours ago" etc. —
it is elapsed time, never a calendar word like "today").

✅ **Expect too:** the row says how long they have waited and when the request
runs out — something like **"Asked today · Expires in 13 days · Front Desk"**.
If you started this sheet last night and are finishing it this morning, the
first part reads **"Asked yesterday"** instead, and that is correct — it follows
the calendar on your wall, not the hours on a stopwatch (T3 round 5, Low-1).

❌ **Fail if** the row says **"Needs a decision"** already. Nothing has been
chased yet — that is step 4.

---

### 4 — stand two days in the future: the gym gets chased
In **Terminal 3**, run this. Put a real date in — **two days from today**, in
this exact format:

```
cd apps/api && node --import tsx --env-file=.env tools/orgs-sweep.ts --now=2026-08-22T12:00:00Z
```

It prints one line and finishes. Look for **`"remindedFirst"`** in it, with a
number of **at least 1**. (It may be higher — the command works on the whole
database, so it also counts any other waiting requests left over from earlier
testing. Yours is one of them.)

Now reload the OWNER's **Members** page.

✅ **Expect:** the waiting row now carries an orange **"Needs a decision"** tag
beside the person's name.

❌ **Fail if** the tag does not appear, or if the person has **vanished from the
list** — two days is nowhere near the deadline and nothing should have expired.

---

### 5 — the request is still there and still confirmable
Look at the same row.

✅ **Expect:** **Confirm** and **Not this person** are both still there and the
person is still listed. Being flagged is a nudge to the gym, not a deletion.

---

### 6 — stand sixteen days in the future: the request runs out
In **Terminal 3**, run the same command with a date **16 days from today**:

```
cd apps/api && node --import tsx --env-file=.env tools/orgs-sweep.ts --now=2026-09-05T12:00:00Z
```

Look for **`"expired"`** in the line it prints, with a number of **at least 1**
— same reason as step 4.

Reload the OWNER's **Members** page.

✅ **Expect:** the waiting section is **gone** (or no longer lists that person).
Nobody is waiting any more.

---

### 6b — the member is TOLD their request ran out
In the MEMBER window, reload the **Dashboard**.

✅ **Expect:** a card saying **"Your request to {your gym} expired before anyone
confirmed it"**, with **Try again**.

❌ **Fail if** it says the gym **didn't confirm** them or **refused** them.
Nobody turned this person away — the request simply ran out, and saying
otherwise would blame a gym that never decided anything.

❌ **Fail if** the card is **missing entirely**. Silence is what the whole
previous card was fixed for.

---

### 7 — asking again is free
In the MEMBER window: **Settings** → **Gym** → type the same code → **Ask to
join**.

✅ **Expect:** it works, straight away — the waiting answer again, and the
dashboard card back to "Waiting for {gym} to confirm you" with a fresh
countdown.

**This is the point of the whole expiry.** An expired request costs a real
member ten seconds, while a pile of stale ones clears itself.

---

### 8 — the reminder really is once a day
Press **Remind them** on the dashboard card. Then reload the page and look
again.

✅ **Expect:** the **Remind them** button is still there but **faded, and
clicking it does nothing** — and beside it a line saying **"You've reminded them
in the last day"** and when you can do it again.

**The button STAYS on purpose.** A control that disappears leaves you wondering
where it went; a faded one with a reason beside it tells you both that it exists
and why you cannot use it yet.

❌ **Fail if** the button is still **clickable**, or if it is faded with **no
explanation at all** beside it.

*(Corrected during the first run of this sheet, 2026-08-21: it used to say
"instead of the button", which describes a screen this card never built.)*

---

### 9 — the deadline moved when you asked again
Look at the countdown on the MEMBER's dashboard card.

✅ **Expect:** it is back to **13 or 14 days**, not the old one. The new request
is a new request.

---

### 10 — running the clock twice changes nothing
In **Terminal 3**, run the step-6 command **again**, same date.

✅ **Expect:** it prints **`"expired":0`** this time — exactly zero, because
everything that could expire already has — and the OWNER's Members page looks
exactly as it did.

**Why this step is here:** background jobs get retried, so running one twice
must be harmless.

---

## What this sheet cannot check

- **The real nightly job.** You are running the sweep by hand. That it runs at
  03:30 every night is wiring proven by reading `worker.ts`, not by this sheet —
  and the worker is not deployed anywhere yet.
- **An email or a push.** Neither exists. That is the point of every "fail if it
  promises a message" above.
- **A gym that was never chased.** The app refuses to expire one, and that
  guarantee is proven by tests — you cannot produce that state from a browser,
  because the sweep always chases before it deletes.

---

## Reporting

For each step: the number, and **pass** or what you saw instead. If a step
fails, stop there and say which one — the later ones depend on the earlier ones.
