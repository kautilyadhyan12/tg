# SMOKE — a gym that stops paying is closed four months later, and can be re-opened

**What this proves:** a gym whose plan ended keeps its console for four months,
is then closed so nobody new can join it, loses nothing while closed, and comes
back with one command.

**Time:** about 15 minutes. **You need:** the API and the web app running
locally, one terminal, and **two browsers** (or one normal window and one
private/incognito window) — one is the gym's owner, the other is somebody trying
to join.

**Kd's ruling of 2026-08-31 set the four months**, replacing the spec's fourteen
days: *"i think after 4 months of inactivity shut down the gym"*. The four months
run from the day the gym's plan ENDED.

**STATUS: NOT YET RUN.** Nothing here has been ticked.

⚠️ **STEPS 3, 4, 7 AND 9 ARE THE CHAT'S TO RUN, NOT KD'S** — they are terminal
commands. **A pass is per step**: a step needing a command cannot have passed
while nobody ran that command (DECISIONS :23257 §12). Every command below has
been run once already against the local database while this sheet was written,
so none of them is a first attempt in front of you (:22782's L-7 — a command in
a smoke sheet is code you will run, and takes the same evidence as code).

---

## Setup

**S1.** Start the local database.

```
docker compose -f infra/docker-compose.dev.yml up -d postgres redis
```

**S2.** **Restart the API and the web app** rather than leaving yesterday's
running. A server started before a change serves the old code from memory, and
that has cost this project three smoke rounds (:15927, :20222, :22782).

**S3 — THIS WHOLE SMOKE RUNS ON THE LOCAL DATABASE, AND IT IS THE ONE
INSTRUCTION HERE THAT PREVENTS REAL DAMAGE.**

Steps 3 and 4 jump time forward, and **whatever database they point at, they act
on EVERY gym in it** — no dry run, and step 4 CLOSES gyms.

`apps/api/.env` points at the **shared Neon branch where your own gyms live**,
and its `NODE_ENV` is `development`, so **the tools' production refusal will not
save you there.** Adding `--env-file=.env` to fix a "Missing env" error is
therefore the WRONG repair, and it is wrong in a way that looks right. Pointing
only the TOOLS at local is also wrong: the browser talks to the API, so the gym
you create would live on Neon while the tools looked at an empty local table, and
the steps would report `0` for no visible reason.

**So start the API against the local database for this smoke.** Stop the API you
already have running first, or the new one exits with `EADDRINUSE` and you are
left talking to the old server. From the repo root, as one line:

```
cd apps/api && DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg' WEB_ORIGIN='http://localhost:5173' JWT_SECRET='dev-smoke-secret-not-a-real-one-32chars' node --import tsx src/index.ts
```

Then start the web app as usual (`corepack pnpm --filter web exec vite`).

Two expected consequences: **your existing gyms will not be there** (a different,
local database), and you will need the brand-new accounts step 1 asks for anyway.
Restart the API without those settings to get your usual data back.

---

## The run

| # | Do this | ✅ Expect |
|---|---|---|
| 1 | **Owner's browser.** Sign up a brand-new account, create a gym (country **United States**), and press **"Start your 30-day free trial"** on the pop-up. Then open the gym and **write down the last part of the address bar** — `/console/`**`something-like-this`**. You need that name in step 7. | The gym's page shows **"Free trial"** and an **"Ends …"** date about a month away. |
| 2 | **Joiner's browser (private window).** Sign up a second account, go to **Join a gym**, and type the gym's join code. | The request goes in, and the card says somebody at the gym confirms new members — **"one tap at the front desk"**. |
| 3 | **(chat)** End the trial: run **command A** below with a date about **35 days from today**. | It prints `trial expiry finished` and **`expired:` 1** (or however many live trials this local database has). |
| 4 | **(chat)** Now jump four more months: run **command B** with a date about **five months** from today — later than command A's by more than four months. | It prints `gym archive sweep finished` and **`archived: 1`**. |
| 5 | **Joiner's browser.** Press **F5**, then try the same join code again. | **"That gym is no longer active."** — that sentence, on the join screen. This is the closure, seen by a real person. |
| 6 | **Owner's browser.** Press **F5** and look at the whole console — Overview, Members, and the join code. | **Everything is still there**: the roster, the join code, the staff list. Above it, the red line **"This gym has no plan. Nothing here can be changed, and your members get the free app only."** Nothing is hidden or deleted — closing a gym takes nothing away. |
| 7 | **(chat)** Re-open the gym: run **command C** with the name from step 1. | It prints **`gym re-opened`**. |
| 8 | **Joiner's browser.** Press **F5** and try the join code once more. | The refusal is **gone** — the request goes in again, or the card shows the request that is still being held. **Not** "no longer active". |
| 9 | **(chat)** Run **command B** again, unchanged. | **`archived: 0`**. The gym stays open — a re-opening by hand is not undone by the nightly job. |

**Steps 5 and 8 are a pair and neither is worth much alone.** A ✅ reading "the
gym is refused" would be satisfied by a broken join screen that refuses
everything; step 8 shows the same screen, the same code and the same person
working again a minute later, which the broken screen cannot do (:25707's shape).

### The commands

**A — end the trial** (date ≈ 35 days from today):

```
cd apps/api && DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg' node --import tsx tools/trial-sweep.ts --now=2026-10-05T10:00:00Z
```

**B — close the long-lapsed gyms** (date ≈ 5 months from today, and more than
four months after command A's date):

```
cd apps/api && DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg' node --import tsx tools/archive-sweep.ts --now=2027-02-10T10:00:00Z
```

**C — re-open one gym** (the name from the console's address bar in step 1):

```
cd apps/api && DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg' node --import tsx tools/gym-restore.ts --gym=your-gym-name-here
```

**Why the database is named on every line.** `corepack pnpm --filter api exec
tsx …` prints `Missing env: DATABASE_URL. (secrets never printed)` and exits 1,
because nothing loads `.env` for a tool. Naming it here is both the fix and the
safety rail: it is the one place where the database this run will change is
written where you can read it before pressing enter.

**Both dates must be inside a year from today** — the tools refuse a date further
out than that, because a mistyped year is the mistake they cannot otherwise
catch.

---

## What this sheet does NOT cover

- **A gym that is PAYING never being closed.** The most damaging thing this card
  could do, and no browser can show it: there is no way to pay yet, so a paying
  gym cannot be made in front of you. It is held by tests and by mutant O168,
  which deletes that condition and turns the suite red.
- **The four months being four and not three.** A browser cannot wait four
  months, and the tools' `--now` makes any window look right if you pick the
  matching date. Held by a test on fixed dates (15 January → 15 May, asserted one
  minute either side) and by mutant O171.
- **A gym closed while it is still on a plan.** That combination cannot be
  produced by anything in the product today — it arrives with the admin panel's
  "suspend this gym" button — so it is held by a test and mutant O174 instead.
- **What a MEMBER of the closed gym sees.** Nothing changes for them at closure:
  they were moved to the free app four months earlier, when the plan ended. There
  is no screen that would differ, so a ✅ here would be satisfied by any app at
  all (:21751's lesson).
