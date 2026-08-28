# SMOKE — a gym's free trial actually ends

**What this proves:** a gym starts its 30-day free trial, the 30 days pass, and
the product notices — the gym's members go back to the free app, and the trial is
recorded as over. Until this card, that never happened.

**Time:** about 10 minutes. **You need:** the API and the web app running
locally, and one terminal.

**A note before you start, so nothing surprises you.** Step 6 is expected to look
WRONG, and it is the finding this card reported rather than fixed. It is written
into the sheet as a step so you see it with your own eyes and can decide what to
do about it. Everything else should pass.

---

## Setup

**S1.** Start the local database and the servers.

```
docker compose -f infra/docker-compose.dev.yml up -d postgres redis
```

Then the API and the web app in their own terminals, the way you always run them.

**S2.** Make sure the database the browser reads is up to date. If gym screens
show "something went wrong", the migrations have not been applied — that has
caught us twice (:15927, :20222) and the fix is to migrate and **restart the API
process**, because a running server caches the old failure.

**S3 — THIS WHOLE SMOKE RUNS ON THE LOCAL DATABASE, AND THAT IS THE ONE
INSTRUCTION HERE THAT PREVENTS REAL DAMAGE.**

Step 5 jumps time forward, and **whatever database it points at, it ends EVERY
live gym trial in that database at once** — no dry run (by design), no undo.

`apps/api/.env` points at the **shared Neon branch where Kd's own gyms live**,
and its `NODE_ENV` is `development`, so **the tool's production refusal will not
save you there.** The obvious repair for the "Missing env: DATABASE_URL" error —
adding `--env-file=.env` — is therefore the WRONG one, and it is wrong in a way
that looks right.

**Pointing only the SWEEP at local is also wrong**, and more confusingly so: the
browser talks to the API, so the gym you create would live on Neon while the
sweep looked at an empty local table. Step 5 would report `expired: 0` and step 7
would show nothing, for no visible reason.

**So start the API against the local database for this smoke**, which makes every
part of the run agree:

```
cd apps/api
DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg' node --import tsx src/index.ts
```

Two consequences, both expected: **your existing gyms will not be there** (this is
a different, local database — it is already migrated and seeded, with the same
USD and INR price books), and you will need the brand-new account step 1 asks for
anyway. Restart the API without that prefix to get your usual data back.

*(Found by T3 round 1 on this card, L-7: the sheet's first version failed with
"Missing env" so steps 5–7 could not run at all — and the natural repair was the
dangerous one.)*

---

## The run

| # | Do this | ✅ Expect |
|---|---|---|
| 1 | Sign up a brand-new account and create a gym. Use country **United States**. | The gym is created and you land on its console. |
| 2 | On the Overview, find the plan card. | It offers **"Start your 30-day free trial"** with a button. |
| 3 | Press the button. | The card changes to **"Free trial"**, shows an **"Ends …"** date about a month away, and a line saying how many places are used. |
| 4 | Press **F5** to reload. | Still "Free trial" with the same date. (This is what proves it was actually saved, not just shown.) |
| 5 | Now jump forward in time. In a terminal, run the command below, putting a date about **35 days from today**. | It prints `trial expiry finished` and **`expired: 1`**. |
| 6 | Go back to the browser and press **F5**. | ⚠️ **EXPECTED TO LOOK WRONG.** You will be offered **"Start your 30-day free trial"** again — as if you had never had one. **Press the button.** It will refuse with *"You've already used your free trial."* **This is the reported finding.** Write down exactly what you saw. |
| 7 | Run the same command from step 5 a second time. | `expired: 0`. Nothing happens twice — which is what makes it safe for the machine to retry. |

```
cd apps/api
DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg' node --import tsx tools/trial-sweep.ts --now=2026-10-02T10:00:00Z
```

*(Change the date to about 35 days from whenever you run this.)*

**Why it is written this way, and why the shorter version in the first draft of
this sheet does not work.** `corepack pnpm --filter api exec tsx …` prints
`Missing env: DATABASE_URL. (secrets never printed)` and exits 1 — the tool parses
only the environment it needs (R2.3) and nothing loads `.env` for it. Naming the
database on the line is both the fix and the safety rail: it is the one place
where the database this run will change is written down where you can read it
before pressing enter.

---

## What step 6 is really telling you

The screen has no way to tell the difference between **"this gym never had a
trial"** and **"this gym's trial is over"**, because the server only reports plans
that are still running. So it guesses "never had one" and offers the trial again.

The fix is the next card, and it is small: teach the server to also report a
finished plan, then have the screen say the trial has ended and point at how to
pay. **It has not been done here because that is a screen, and the words on it are
yours to choose.**

Nobody can hit this today — the first real gym's trial does not run out until
about **26 September 2026**.

## What this sheet does NOT cover

- **What a MEMBER of the gym sees.** No member screen mentions billing in either
  direction, so a browser cannot tell you whether their allowance changed. That
  guarantee is held by a test that reads the same gym as owner and as member
  (`orgs.trialSweep.test.ts`) — a ✅ here would be satisfied by any app at all,
  which is the exact defect Kd found in the trial's own smoke (:21751).
- **The nightly job firing on its own at 04:00.** That is proven by reading
  `worker.ts` and by watching the job run through a real worker once by hand; the
  clock at 04:00 is not something this sheet waits for.
- **A gym that has actually PAID.** Nothing can pay yet.
