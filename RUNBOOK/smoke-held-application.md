# SMOKE — somebody waiting to join a gym that has stopped paying

**What this proves:** a person waiting at the door of a gym with no plan is told
the truth — that the gym cannot take new members right now and their request is
being held — instead of being counted down to a deadline and then quietly
deleted. And that the same person waiting on a gym that IS paying sees exactly
what they saw before.

**Step 6 is the one to read first.** It is the same person, the same request, one
minute apart — the only difference being that the gym's trial ended in between.
That is the whole card.

**Time:** about 20 minutes. **You need:** the API and the web app running
locally, one terminal, and **three email addresses** (they never receive mail).

⚠️ **THERE ARE TWO PAUSES WHERE THE CHAT RUNS A COMMAND AND YOU WAIT — steps 5
and 9.** Both are commands only the chat can run, so this sheet cannot be handed
over in one block. **The run is three blocks: steps 1–4, stop and say so · steps
6–8b, stop and say so · steps 10–12.** This is written here because a sheet that
did not say it once read as a refusal when the runner asked for everything at
once (:24893 §5).

**Status: NOT YET RUN.**

---

## ⚠️ READ THIS FIRST — why there are three accounts

The **owner** of a gym with no plan never sees any of this: they meet a pop-up
they cannot close, over the whole console. That is a different card.

So the run uses three people:

- **A** — the owner. Creates the gym and then mostly disappears.
- **B** — a **manager**. Does the console looking, because a manager gets the
  read-only console instead of the pop-up.
- **C** — the **person waiting**. This card is about C's screen, and **C's window
  stays open the whole way through.**

---

## Setup

**S1.** Start the local database.

```
docker compose -f infra/docker-compose.dev.yml up -d postgres redis
```

**S2. Stop any API you already have running, then start a fresh one.** A server
started before a change serves the old code from memory, and that has cost this
project three smoke rounds (:15927, :20222, :22921 §7). If one is already up on
port 3000 the new one exits at once with `EADDRINUSE` and you are left talking to
the old server.

**S3 — THIS SMOKE RUNS ON THE LOCAL DATABASE, AND THAT IS WHAT PREVENTS REAL
DAMAGE.** Steps 5 and 9 jump time forward, and **whatever database they point
at, they end every live gym trial and sweep every waiting request in it** — no
dry run, no undo. `apps/api/.env` points at the shared Neon branch where your own
gyms live, so adding `--env-file=.env` is the WRONG repair and it is wrong in a
way that looks right. Start the API against local, from the repo root, as one
line:

```
cd apps/api && DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg' WEB_ORIGIN='http://localhost:5173' JWT_SECRET='dev-smoke-secret-not-a-real-one-32chars' node --import tsx src/index.ts
```

Then start the web app as usual (`corepack pnpm --filter web exec vite`).

Your existing gyms will not be there — this is a different, local database, and
you need brand-new accounts anyway.

---

## The run

| # | Do this | ✅ Expect |
|---|---|---|
| 1 | Sign up as **account A** and create a gym (country **United States**). Press **"Start your 30-day free trial"** on the pop-up, then copy the join code and press **Go to your gym**. | You have a six-character code, and the gym's page says **"Free trial"** with an **"Ends …"** date about a month away. |
| 2 | In a **different browser** (or a private window), sign up as **account B** and type the join code. Then, back as **A**: **Members** → confirm **B**, and **Settings → Staff → Add someone** → B's email, role **Manager**. | B is in the roster and appears in the staff list as a manager. |
| 3 | In a **third** window, sign up as **account C** and type the same join code. **Leave this window open — it is the one this card is about.** | C is told they are waiting for the gym to confirm them. |
| 4 | Still as **C**, go to the **dashboard**. Read the waiting card carefully and write down what it says. | **This is the "before" picture and it is the positive control.** The card says **"Waiting for &lt;gym&gt; to confirm you"**, then **"Someone at the gym confirms new members from their side — one tap at the front desk."**, then a countdown reading **"Expires in 13 days"** or **"in 14 days"** — either is right, it depends on the time of day you applied — followed by **"— if that happens, just enter the code again."**, and it offers **Remind them**. **What matters is that a countdown is there at all**; step 6 is about it disappearing. |
| 5 | **(The chat runs this, not you.)** End the gym's trial — the command is under this table. | It prints `trial expiry finished` and **`expired:` however many gyms this local database has on a live trial**. |
| 6 | Back in **C's window**, press **F5**. | **THIS IS THE STEP THE CARD EXISTS FOR.** The headline is unchanged — **"Waiting for &lt;gym&gt; to confirm you"**, because that is still true. Underneath, the front-desk sentence is **gone** and in its place: **"&lt;gym&gt; can't take new members right now. Your request is being held — it won't run out while that's the case."** **The "Expires in 13 days" line has gone completely.** |
| 7 | Still as C, read the whole card once more. | **Nothing on it mentions a plan, a subscription, money, or the gym having lapsed** — C is not staff of that gym and must not learn its billing state. And nothing promises C will be let in later. |
| 8 | Still as C: press **Remind them**. | It still works. The confirmation reads **"The gym can see you're still waiting. You can do this again …"**. This is deliberate — it is the one thing C can still do. |
| 8b | Still as C, type **`localhost:5173/org/join`** straight into the address bar — **not** Settings → Gym. Type the same join code again and press **Ask to join**. | **This is the OTHER screen, and it is the one most people actually arrive on:** the QR code and the poster both land on this address, and it draws the code box **and nothing else** — the card from step 6 is not on this page, so anything wrong here is wrong with nothing to correct it. It says **"You've asked to join &lt;gym&gt;."** and then the same held sentence: **"&lt;gym&gt; can't take new members right now. Your request is being held — it won't run out while that's the case."** It must **NOT** say *"ask them now — it takes one tap"*, and must **NOT** say *"Nothing is on hold"*. |
| 9 | **(The chat runs this, not you.)** Jump twenty days past C's deadline and sweep the waiting room — the command is under this table. | It prints `sweep finished` with **`expired: 0`** and **`heldNoPlan: 1`**. Before this card that line would have read `expired: 1` and C's request would be gone. |
| 10 | Back in **C's window**, press **F5**. | **C is still waiting.** The same held card from step 6 — not "your request to &lt;gym&gt; expired before anyone confirmed it". This is the card's whole point: twenty days past the deadline and the request is still alive. |
| 11 | As **account B** (the manager), open the console → **Members**, and look at the **Waiting to join** section. | It says how many are waiting, then **"Nobody can be let in until this gym is on a plan. The people waiting keep their place."** — the second sentence is new in this card. **Confirm** and **Not this person** are both greyed out. |
| 12 | Still as B, read that section once more. | It does **not** say the gym will confirm these people once it is back, or anything like it. Nothing in the product can put a gym back on a plan yet, so that would be a promise with no code behind it. |

**The command for step 5**, run from the repo root, with a date about **35 days
from whenever you run it**:

```
cd apps/api && DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg' node --import tsx tools/trial-sweep.ts --now=2026-10-05T10:00:00Z
```

**The command for step 9**, same idea, with a date about **35 days from whenever
you run it** — it must be past C's 14-day deadline:

```
cd apps/api && DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg' node --import tsx tools/orgs-sweep.ts --now=2026-10-05T10:00:00Z
```

*(The database is named on both lines on purpose: it is the one place where the
database the run will change is written down where it can be read before pressing
enter. Neither needs `WEB_ORIGIN` or `JWT_SECRET` — they are tools, not the
server.)*

---

## What this sheet does NOT cover

- **Bringing C's request back to life when the gym pays.** Nothing in this
  product can put a lapsed gym back on a plan, so there is no moment to attach it
  to and no way to smoke it. It belongs to the payment card and has its own
  `OWED.md` line. **C's request being held past its deadline is exactly why that
  line matters**: the first sweep after the gym subscribes would otherwise kill
  it, which is the outcome Kd's ruling exists to prevent.
- **The hold letting go.** Same reason — it needs a gym to come back onto a plan.
  It is pinned by a test (`orgs.sweep.test.ts`, "lets it go the moment the gym is
  back on a plan") and not by a browser.
- **A gym that never subscribed at all.** Every gym in this run trials first,
  because that is what the product forces. The other way a gym reaches "no plan"
  is covered by tests on both halves.
- **The owner's own view.** A owns a lapsed gym and meets the unskippable
  pop-up — Card A's sheet, step 16.
