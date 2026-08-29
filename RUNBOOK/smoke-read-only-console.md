# SMOKE — a gym with no plan can look at everything and change nothing

**What this proves:** when a gym's trial ends, its staff still see everything
they could see before — the roster, the join code, the waiting list — and every
button that would change something is greyed out with a sentence saying why. And
that a gym which IS paying is completely unaffected.

**Step 9 is the one to read first.** It catches a gym lapsing *while somebody is
part-way through something*, which is the case the review round found live and
the only one whose broken version nobody had ever looked at.

The two **Settings** sections are deliberately not in the run — nobody can reach
them on a lapsed gym today. The last section of this sheet says why.

**Time:** about 20 minutes. **You need:** the API and the web app running
locally, one terminal, and **two email addresses** (the second one can be
anything — it never receives mail).

**Status: WRITTEN, NOT YET RUN.**

---

## ⚠️ READ THIS FIRST — why you need a second account

**The gym's OWNER will not see any of this.** An owner of a gym with no plan
meets the pop-up they cannot close, over the whole console. That is deliberate
and it is a different card.

What this smoke is about is what a **manager** sees — somebody the owner has
given the keys to, who cannot pay and so does not get the pop-up. They are the
person who was meeting dead buttons before this card.

So the run below creates a gym with account A, adds account B as a manager, and
then does all the looking as **B**.

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
DAMAGE.** Step 7 jumps time forward, and **whatever database it points at, it
ends EVERY live gym trial in that database at once** — no dry run, no undo.
`apps/api/.env` points at the shared Neon branch where your own gyms live, so
adding `--env-file=.env` is the WRONG repair and it is wrong in a way that looks
right. Start the API against local, from the repo root, as one line:

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
| 1 | Sign up as **account A** and create a gym (country **United States**). Start the free trial when the pop-up appears. | The gym is created and the trial starts. You land on the gym's page showing **"Free trial"** and an end date about a month away. |
| 2 | Copy the join code shown on the gym's page and keep it somewhere. | You have a six-character code. |
| 3 | In a **different browser** (or a private window), sign up as **account B**. On the "I'm a member" side, type the join code from step 2. | B is told they are waiting for the gym to confirm them. |
| 4 | Back as **account A**: go to **Members**. Confirm B. | B appears in the roster. |
| 5 | Still as A: **Settings → Staff → Add someone**. Add B's email address, role **Manager**. | B appears in the staff list as a manager. |
| 6 | As **account B**, open the console. Look at the gym's page and Members. | Everything works normally: **New code**, **Switch off**, **Replace**, **Confirm** and **Remove** are all pressable. **There is no coloured strip at the top and no pop-up.** This is the "before" picture — write down that it looked normal. (**B has no Settings tab, and that is correct** — see *What this sheet does NOT cover*.) |
| 7 | Still as B, on the gym's page: press **Replace** beside the join code to open the question *"Replace <your code>?"*. **Leave it open**, switch to another browser tab, and come back to it in a moment at step 9. | The question is on screen with **Replace it** and **Keep it** underneath, both pressable. |
| 8 | **(The chat runs this, not you.)** Jump time forward past the trial's end. | It prints `trial expiry finished` and `expired: 1`. |
| 9 | Switch back to **B's tab** — just click into it, **do not press F5**. | **This is the step this round was added for.** The red strip appears, the note *"This gym needs a plan before anything here can be changed."* appears above the codes, **Replace it goes grey**, and **Keep it still works** so you can back out. Before the fix, **Replace it stayed live and full-colour under both of those sentences**. |
| 10 | Press **Keep it** to close the question, then press **F5**. | **A red strip across the top of every console screen**: *"This gym has no plan. Nothing here can be changed, and your members get the free app only."* There is **no button** in the strip and **no pop-up** — B is not sealed out. |
| 11 | Still as B, on the gym's page: try **New code**, **Switch off**, **Limits**, **Replace**. | **All greyed out and unpressable**, with the line *"This gym needs a plan before anything here can be changed."* under the "Join codes" heading. |
| 12 | Still on the gym's page: read the join code, and press **Copy**. | **The code is still fully visible and Copy still works.** Nothing has been hidden — this is the difference between read-only and locked out. |
| 13 | Go to **Members**. | The roster still lists everybody. **Remove** beside each person is greyed out, with the same sentence above the list. |
| 14 | Look at the **Waiting to join** section (if anybody is in it — if not, have a third person type the code, or skip and say so). | It still says how many are waiting, and now says **"Nobody can be let in until this gym is on a plan."** **Confirm** and **Not this person** are both greyed out. |
| 15 | As **account A** (the owner), open the same gym's console. | **A pop-up you cannot close**, asking the gym to subscribe. This is the owner's experience and it is unchanged by this card — noted here only so it does not read as a surprise. |

---

## What a failure looks like

- **A button that is still pressable at steps 9, 11, 13 or 14** — that is the
  defect this card exists to remove. Say which one.
- **Step 9 in particular.** A greyed **Replace it** there is the whole of what the
  review round found and fixed; a live one means the fix did not reach the
  browser. It is the only step whose "before" picture nobody had ever seen.
- **A question you cannot get out of.** **Keep it** and **Cancel** must stay
  pressable at every step. Backing out of something is not a change, and a
  console that trapped you inside a confirmation would be a worse screen than the
  one this card replaced.
- **Something that has DISAPPEARED rather than gone grey** — the code, a member's
  row, the staff list, a whole section. Nothing should vanish; the no-removal
  rule is absolute here.
- **The red strip appearing at step 6**, before the trial ended — that would mean
  a paying gym is being told it has no plan, which is the worse direction.

## What this sheet does NOT cover

- **THE TWO SETTINGS SECTIONS — and this sheet used to send you to them, which
  would have wasted your time at step 13.** An earlier draft had you open
  **Settings → Gym details** and **Settings → Staff** as account B. **B has no
  Settings tab at all**, so those steps had no screen to land on.

  It is not a bug in the tab. Settings appears for somebody holding *"change the
  gym's details"* or *"manage staff"*, and a **manager gets neither**: manage
  staff is the owner's alone (the server refuses it on anybody else), and the
  gym-details power **has no tick box on the Staff screen** — nothing in the
  product can hand it to a manager, a gap recorded on 2026-08-27 and still open.

  So on a lapsed gym those two screens are reachable **only by an owner** — who
  meets the un-closable pop-up instead. **Nobody can see them today**, which is
  why they are not steps. Their greyed state is held by tests and by the mutation
  sweep, and this sheet must not be read as evidence a person has seen it. The
  day either of those two powers can be given away, they go back into the run —
  including the **Enter key in the Gym name box**, which is the one door on this
  console that a greyed button does not close.
- **What the waiting person sees.** Somebody who applied to this gym is still
  told they are waiting, and their request still dies after 14 days. Kd ruled on
  2026-08-29 that a lapsed gym should HOLD their place and tell them why — that
  is the next card, and this sheet must not be read as covering it.
- **The 14-day archive.** After two weeks §4.2 says the console is archived
  rather than read-only. Nothing in the product does that yet; it has its own
  outstanding line.
- **A gym that never subscribed at all** (as opposed to one whose trial ended).
  The screens cannot tell the two apart — one server field answers for both, and
  the tests cover both — but this sheet walks the trial-ended path only.
