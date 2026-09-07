# SMOKE — PostWorkout's summary payload gets a reader

Card: the unparsed-summary gap, `OWED.md:730`, branch `web-repoint`.
Gates "done" per CLAUDE.md Part I §2. Run every step; report pass/fail per step.

## RESULT — PASSED (Kd, 2026-07-30), on commit `fb1956c`

Reported as a **blanket pass**, not step by step, and recorded that way rather
than written up as eleven individual ticks — a record must not claim more
resolution than the report it came from. The control (step 1) was included in the
run, which is the step that matters most: it is the only one that can catch the
fix dashing out numbers the backend really sent.

This discharged the SMOKE half of the card's gate; three fresh-chat T3 rounds then
ran and the card closed under THE CAP (DECISIONS :2692).

**THE RIG HAS CHANGED SINCE THAT PASS, and the steps below are updated to match.**
T3 round 2 F4 added a SECOND personal-record shape to the `healthy` state
(`{icon,value,label}`), because until then no rig state could produce it and that
render path had never been exercised in a browser. So step 1 now expects TWO
trophy rows where the passing run saw one. **No shipping code changed in any of
the three rounds** — `git diff --name-only fb1956c..HEAD -- apps/web/src` filtered
of tests is empty, verified by round 3 — so the pass still stands for the app; only
this instrument moved. A re-run is optional and would be a check of the rig, not of
the fix. (Round 3 F6: the note explaining this lived only in HANDOFF.md, which the
person running a smoke does not read.)

**What this card changed, in one sentence.** When the old backend leaves a number
out of the workout summary, the page now prints `—` instead of inventing one. The
headline case: an absent form score used to fall through every grading threshold
and print **grade D, "Keep practicing", in red** — a bad-form verdict on a workout
nobody scored.

**Nothing changes when the backend sends real numbers.** Step 1 is the control
that proves that, and it runs FIRST. If step 1 shows dashes, stop — the fix is
wrong, not the rig.

---

## Setup — three servers

Three terminals, from the repo root:

```
node apps/web/tools/mock-ml-backend.mjs
```
```
cd apps/api && node --import tsx --env-file=.env src/index.ts
```
```
cd apps/web && corepack pnpm exec vite
```

The rig is the OLD backend on `:8000`, the api is the NEW one on `:3000`, web is
on `:5173`. Log in as usual, then open:

**`http://localhost:5173/workout/summary/smoke-1`**

The rig answers that summary id in every state, so you do NOT need to complete a
real workout to run this.

Switch rig state by opening `http://localhost:8000/__state/<name>` in another tab,
then RELOAD the summary page. Read the current state at `http://localhost:8000/__state`.

**Open devtools BEFORE you act** — a panel opened afterwards says "Currently
recording…" and has captured nothing (the timezone card's recorded lesson).

---

## THE CONTROL — run this first

### 1. State `healthy` — every real number renders
Open `__state/healthy`, reload the summary page.

✅ **Workout Time** reads `15m 0s`, with `35 min total` underneath
✅ **Calories** reads `280 kcal` · **Exercises** reads `3` · **Avg Form** reads `88%`
✅ The **Form Score** card reads grade **A** with the caption **Great**, in green,
   and its bar is about 88% full
✅ **Personal Records** lists TWO rows — `Best form accuracy!` and `🔥 12 — reps`
✅ **Post-Workout Nutrition** lists `Paneer bhurji + rice`
✅ Expand **Cool Down Stretches** → two stretches listed
✅ No `—` anywhere among those figures

**If any of the above shows a dash, STOP and report it.** That is the fix
over-reaching, and it is the one outcome this card must not have.

---

## THE DEFECT — the state the card exists for

### 2. State `unscored` — the metrics are absent
Open `__state/unscored`, reload.

✅ **Avg Form** reads `—`, not `undefined%`
✅ The **Form Score** card reads grade `—` with the caption **Not scored**, in
   grey — **NOT** `D` / "Keep practicing" / red
✅ The Form Score bar is **empty**, and the row beneath it reads `0%` `—` `100%`
✅ **Workout Time** reads `—`, not `NaNh NaNm`
✅ **Calories** reads `— kcal`, not `undefined kcal`
✅ **Exercises** reads `—`, and the tile is not blank
✅ The page still renders fully — hero, cards, buttons. **Not a white screen.**
✅ **Post-Workout Nutrition** reads "Suggestions unavailable right now."
✅ Expand **Cool Down Stretches** → "Stretches unavailable right now."
✅ There is no **Personal Records** section (the list could not be read, so
   nothing is claimed about records)
✅ Search the page for the words `undefined` and `NaN` — neither appears
✅ **XP Earned** still reads `+70`, and the level line still reads a real
   `Level N` with a real `X/Y XP` — those come from the NEW api and are
   unaffected by rig state

### 3. State `unscored` — the share card, i.e. the copy that leaves as a file
Still in `unscored`. Click **Preview card**.

✅ The preview's four tiles read `—`, `— kcal`, `—`, `—` — the Form-score tile
   shows `—`, **not** `undefined% (D)`
✅ The `⚡ +70 XP` tile and its `Level N` line are unchanged

### 4. State `unscored` — the downloaded PNG
Click **Download PNG**, then open the file.

✅ The image shows the same dashes as the preview. A real number here that the
   page does not show would be the exact defect this card's predecessor found —
   two surfaces printing two different answers, with the stale one leaving the
   building.

### 5. State `empty200` — the blank white page is gone
Open `__state/empty200`, reload.

✅ A red toast reads **"Failed to load summary"** and you land on `/dashboard`
✅ You do **not** sit on a blank white page with no message

Before this card, this state rendered nothing at all — no toast, no redirect, no
text — and the rig's own comment documented that white screen as expected.

---

## REGRESSION CHECKS

### 6. State `partial` — the previous card's fix still holds
Open `__state/partial`, reload. This summary has real metrics but no `xp_earned`.

✅ **XP Earned** reads `—`, not `+0` and not a blank
✅ The share-card tile reads `— XP`
✅ Every OTHER figure reads its real value (`88%`, `280 kcal`, grade `A`, `Great`)

### 7. Back to `healthy` — nothing was dashed out permanently
Open `__state/healthy`, reload.

✅ Step 1's list holds again, exactly

---

## Reporting

Per step: pass, or what you actually saw. A failure here is fixed with a failing
test first (R9.5) before any source change — that is how every defect in this
card was fixed, including one regression the tests initially let through.
