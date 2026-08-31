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

**STATUS: PASSED 8 OF 9, 2026-08-31, run by Kd on `be03891` with every `src` file
byte-identical to HEAD — and STEP 6 IS STRUCK, see the step.** DECISIONS
`:26012`. **`OWED.md`'s line does NOT tick on this: T3 is unrun, and a passing
smoke is not a review** (:14147). **TWO defects in THIS SHEET were found by
running it, both fixed below and neither of them a defect in the card**: step 4's
✅ promised a literal `archived: 1`, and a count over a shared database is never a
constant (:25326 §2, the fourth recurrence); and step 6 could not be run and
would have proved nothing if it had been.

⚠️ **STEPS 3, 4, 7 AND 9 ARE THE CHAT'S TO RUN, NOT KD'S** — they are terminal
commands. **A pass is per step**: a step needing a command cannot have passed
while nobody ran that command (DECISIONS :23257 §12). **So the run alternates, and
with step 6 struck it goes: you 1–2 · chat 3–4 · you 5 · chat 7 · you 8 · chat 9.
Six blocks, so you stop and say so three times** (:24893 §3 — you are entitled to
know the shape before minute one, not to meet the pauses as they arrive). Every command below has
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
| 4 | **(chat)** Now jump four more months: run **command B** with a date about **five months** from today — later than command A's by more than four months. | It prints `gym archive sweep finished` and **one for each gym in this database whose plan ended more than four months before that date — your gym is one of them.** (Never a fixed number: the count is a property of a shared database, and every sheet that has written one has been wrong — :25326 §2. The chat reads the rows first and says what to expect before running it.) **If your gym is NOT among them, the likeliest cause is that step 3 ended the trial without recording WHEN it ended** — that stamp is the whole hinge between the two commands, and step 3's own line cannot show it, because a trial expires with or without it. The other likely cause is a stale date: see the note under the commands. |
| 5 | **Joiner's browser.** Press **F5**, then try the same join code again. | **"That gym is no longer active."** — that sentence, on the join screen. This is the closure, seen by a real person. |
| 6 | ~~**Owner's browser.** Press **F5** and look at the whole console — Overview, Members, and the join code.~~ **STRUCK 2026-08-31 — DO NOT RUN IT. It cannot be done and it would prove nothing if it could; see "Why step 6 is struck" under this table.** | ~~Everything is still there: the roster, the join code, the staff list, under the red "This gym has no plan" line.~~ **That claim is TRUE and is checked another way — the chat reads the rows after step 4 (member, staff, join code, waiting request all still there) and `orgs.archiveSweep.test.ts` holds it.** |
| 7 | **(chat)** Re-open the gym: run **command C** with the name from step 1. | It prints **`gym re-opened`**. |
| 8 | **Joiner's browser.** Press **F5** and try the join code once more. | The refusal is **gone** — the request goes in again, or the card shows the request that is still being held. **Not** "no longer active". |
| 9 | **(chat)** Run **command B** again, unchanged. | **`archived: 0`**. The gym stays open — a re-opening by hand is not undone by the nightly job. (**This one IS a literal on purpose, unlike step 4's**: it is the same command at the same instant, so anything this database could close was closed in step 4, and `0` is the invariant rather than a count of whatever happens to be in there.) |

**Steps 5 and 8 are a pair and neither is worth much alone.** A ✅ reading "the
gym is refused" would be satisfied by a broken join screen that refuses
everything; step 8 shows the same screen, the same code and the same person
working again a minute later, which the broken screen cannot do (:25707's shape).

### Why step 6 is struck

**Two reasons, either one on its own enough, and both were knowable before the
sheet was written.**

1. **The owner cannot get to that screen.** An owner of a gym with no plan meets
   the subscribe pop-up that cannot be closed, over every console page — Kd's own
   ruling (:22215, :22697), and a fact already written down twice in this repo
   (:24893 §5, :25326 §4).
2. **Nothing on that screen changes when a gym is closed.** No part of the web app
   looks at whether a gym is archived (:25771 §6), so a closed gym and a merely
   lapsed one draw exactly the same. **The ✅ would be met whether the code being
   tested had run or not** — which makes it no evidence at all (:25326 §1,
   :21751).

**What step 6 claimed is still true and still checked**: closing a gym deletes
nothing. It is checked by reading the rows after step 4 and by the automated
tests, which is where a claim with no visible subject belongs.

**The rule this leaves behind, for the next sheet:** before writing a step, name
the thing on that screen that would look DIFFERENT if the new code had not run.
If there is nothing, the step goes in *"What this sheet does NOT cover"*, not in
the table.

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

⚠️ **THE TWO DATES ABOVE ARE WRITTEN FOR A RUN ON 2026-08-31 AND GO STALE
SILENTLY — CHECK THEM BEFORE YOU START** (T3 round 1). What each one has to be,
whatever today is: **A is roughly a month ahead of today** (past the trial's own
end date, which is 30 days after step 1), and **B is more than four months after
A, and still inside a year from today.** Run them unchanged in 2027 and A ends no
trial and B has a date in the past — **both print `0` and neither says why**, and
the year guard stays silent because a date in the past is not the mistake it
catches. **So a `0` at step 3 or step 4 usually means a stale date here, not a
broken sweep.**

---

## What this sheet does NOT cover

- **The closed gym's console, looked at by a person** — step 6, struck above. The
  owner cannot reach it, and nothing on it would differ if the gym were not
  closed. Held by the rows read at the run and by `orgs.archiveSweep.test.ts`.
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
