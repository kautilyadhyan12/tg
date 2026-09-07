# SMOKE — the free trial is forced, it actually ends, and then the gym is asked to subscribe

**What this proves:** a brand-new gym cannot be used until its owner starts the
free trial, the 30 days pass, the product notices (the members go back to the
free app), and the owner is then asked to subscribe — without ever being offered
a second free trial they cannot have.

**Time:** about 15 minutes. **You need:** the API and the web app running
locally, and one terminal.

**RUN AND PASSED 11/11**, on the bytes this card ships — after a fix Kd found at
step 1, now written into that step. **Kd ran every browser step; the chat ran
step 7, the one terminal command.** Splitting it that way is the point of the
next paragraph.

⚠️ **STEP 7 IS THE CHAT'S TO RUN, NOT KD'S, AND THE PASS IS PER STEP.** The first
attempt at this sheet was recorded as 11/11 when steps 7–9 had never run: Kd said
"all passed" about the steps he had done, and the chat read it as all eleven. **A
step that needs the chat to run a command cannot have passed while the chat has
not run it** (DECISIONS :23257 §12).

**Everything here is now expected to PASS.** The previous version of this sheet
had a step that was expected to look WRONG — the app offered a second free trial
to a gym whose trial had ended, and refused it when you pressed the button. That
is the defect this card fixed, so the step is now written the way it should
behave. Three steps describe screens that did not exist when this sheet was last
run; they are new, not renumbered versions of the old ones.

---

## Setup

**S1.** Start the local database.

```
docker compose -f infra/docker-compose.dev.yml up -d postgres redis
```

**S2.** **Restart the API and the web app** rather than leaving yesterday's
running. A server started before a change serves the old code from memory, and
this has now cost two smoke rounds (:15927, :20222, and again on 2026-08-28 when
a currency change looked like a failure). If gym screens say "something went
wrong", the migrations have not been applied — migrate, then restart the API.

**S3 — THIS WHOLE SMOKE RUNS ON THE LOCAL DATABASE, AND THAT IS THE ONE
INSTRUCTION HERE THAT PREVENTS REAL DAMAGE.**

Step 6 jumps time forward, and **whatever database it points at, it ends EVERY
live gym trial in that database at once** — no dry run (by design), no undo.

`apps/api/.env` points at the **shared Neon branch where your own gyms live**,
and its `NODE_ENV` is `development`, so **the tool's production refusal will not
save you there.** The obvious repair for a "Missing env: DATABASE_URL" error —
adding `--env-file=.env` — is therefore the WRONG one, and it is wrong in a way
that looks right.

**Pointing only the SWEEP at local is also wrong**, and more confusingly so: the
browser talks to the API, so the gym you create would live on Neon while the
sweep looked at an empty local table. Step 6 would report `expired: 0` and step 7
would show nothing, for no visible reason.

**So start the API against the local database for this smoke.**

⚠️ **Stop the API you already have running first.** If one is up on port 3000 the
new one exits immediately with `EADDRINUSE: address already in use 0.0.0.0:3000`
and you are left talking to the OLD server, pointed at the old database —
verified 2026-08-28 by running exactly this command with one already up.

Run this from the repo root, as one line:

```
cd apps/api && DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg' WEB_ORIGIN='http://localhost:5173' JWT_SECRET='dev-smoke-secret-not-a-real-one-32chars' node --import tsx src/index.ts
```

**The two extra settings are not optional and the command fails without them.**
Verified 2026-08-28, both ways: the previous version of this line exits 1 with
`Invalid environment: WEB_ORIGIN: Required; JWT_SECRET: Required`, and the line
above was RUN and answered `{"status":"ok"}` on `/health`. The API parses its
whole environment at boot (R2.3) and nothing loads `.env` for it, so every
required setting has to be on the line. `WEB_ORIGIN` must match the address the
web app is served on, or the browser's requests are refused by CORS before they
arrive.

Then start the web app as you always do (`corepack pnpm --filter web exec vite`).

Two consequences, both expected: **your existing gyms will not be there** (this
is a different, local database — already migrated and seeded, with the same USD
and INR price books), and you will need the brand-new account step 1 asks for
anyway. Restart the API without those settings to get your usual data back.

---

## The run

| # | Do this | ✅ Expect |
|---|---|---|
| 1 | Sign up a brand-new account and create a gym. Use country **United States**. | The gym is created — and **the pop-up offering the 30-day free trial is ALREADY THERE, over the "your gym is ready" screen. You should not be able to read the join code behind it.** |
| 2 | Try to get rid of the pop-up **without** starting the trial: press **Escape**, then click the dark area outside it, then look for an X or a "Not now". | **Nothing closes it.** There is no X and no "Not now". The only things you can press are the trial button, "Your gyms" and "Sign out". |
| 3 | Press **"Start your 30-day free trial"**. | The pop-up goes **and the join code screen is revealed underneath it** — which is the order that matters: start the trial, then hand out the code. |
| 4 | Press **"Go to your gym"**. | The gym's page shows **"Free trial"**, an **"Ends …"** date about a month away, a line saying how many places are used, and **no pop-up**. |
| 5 | Press **F5** to reload. | Still "Free trial" with the same date, and no pop-up. (This is what proves it was actually saved, not just shown.) |
| 6 | Click **Members** in the menu. | The members screen, with no pop-up over it. |
| 7 | Now jump forward in time. In a terminal, run the command below, putting a date about **35 days from today**. | It prints `trial expiry finished` and **`expired:` the number of gyms you have on a live trial** — one if this is your only one. **Read the database first if you want a number to check it against**; a trial with no end date is deliberately NOT swept, so it does not count. |
| 8 | Go back to the browser and press **F5**. | **A pop-up appears again — and it is the SUBSCRIBE one, not the trial one.** It says you have already used your one free trial, lists real plans with real prices (for example "Up to 300 members · $35 a month"), and says there is no way to pay online yet and we will be in touch. **There is no button offering another free trial.** |
| 9 | Try to get rid of this one too: **Escape**, click outside, look for an X. | **Nothing closes it.** "Your gyms" and "Sign out" are still there. |
| 10 | Press **"Your gyms"**. | You reach your list of gyms with no pop-up over it. Opening the same gym again brings the subscribe pop-up straight back. |
| 11 | Run the same command from step 7 a second time. | `expired: 0`. Nothing happens twice — which is what makes it safe for the machine to retry. |

**Step 1 is written the way it is because of a defect Kd found running this sheet
on 2026-08-28**, and it is the reason the step names the "is ready" screen
explicitly: the prompt used to appear only after clicking through to the gym, so
the first thing a new owner saw was their join code, for a gym on no plan. If you
ever see the code screen with no pop-up over it, that defect is back.

```
cd apps/api && DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg' node --import tsx tools/trial-sweep.ts --now=2026-10-02T10:00:00Z
```

*(Change the date to about 35 days from whenever you run this. This command needs
no `WEB_ORIGIN` or `JWT_SECRET` — it is a tool, not the server, and it parses
only what it uses.)*

**Why the database is named on the line.** `corepack pnpm --filter api exec tsx …`
prints `Missing env: DATABASE_URL. (secrets never printed)` and exits 1, because
nothing loads `.env` for it. Naming the database here is both the fix and the
safety rail: it is the one place where the database this run will change is
written down where you can read it before pressing enter.

---

## What this sheet does NOT cover

- **What a MEMBER of the gym sees.** No member screen mentions billing in either
  direction, so a browser cannot tell you whether their allowance changed. That
  guarantee is held by a test that reads the same gym as owner and as member
  (`orgs.trialSweep.test.ts`) — a ✅ here would be satisfied by any app at all,
  which is the exact defect Kd found in the trial's own smoke (:21751).
- **A TRAINER not being stopped by the pop-up.** Kd ruled that it stops only
  whoever can pay, and the console has no way to appoint a trainer and sign in as
  them in the same sitting; that guarantee is held by tests instead
  (`planPrompt.render.test.jsx`, and mutant C96).
- **The nightly job firing on its own at 04:00.** That is proven by reading
  `worker.ts` and by watching the job run through a real worker once by hand; the
  clock at 04:00 is not something this sheet waits for.
- **A gym that has actually PAID.** Nothing can pay yet — which is why step 7's
  pop-up says we will be in touch rather than offering a checkout.
