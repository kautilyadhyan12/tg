# Recording session 2 — the same scene, four camera settings

**Goal: make the camera lock onto YOU instead of the chair.** The first test we
built only spots when the camera is confused. This session is about un-confusing
it.

**Time: about 25 minutes.** Eight clips, roughly 45 seconds each, plus setup.

**It cannot pass or fail.** You are recording. I read the numbers afterwards.

---

## Why eight clips and not one

The camera has four settings nobody ever chose — they are sitting at the factory
defaults. I want to try three changes against the current behaviour. To compare
them fairly, each has to see **the same two scenes**:

- **the chair alone** (the thing it wrongly draws a body on)
- **you and the chair together** (your actual problem)

Four settings × two scenes = eight clips.

**Same room, same chair, same lighting, same spot** for all eight. If the light
changes halfway the comparison is worthless — so do them in one sitting.

---

## Setup

Same three programs as last time (`RUNBOOK/measure-camera-accuracy.md` has the
detail if you need it). The short version:

```
node apps/web/tools/mock-ml-backend.mjs
```
then open `http://localhost:8000/__state/healthy` in a tab.

```
cd apps/api
node --import tsx --env-file=.env src/index.ts
```

```
cd apps/web
$env:VITE_TRACE_RECORD="1"; corepack pnpm exec vite
```

---

## The four settings

**Each one is a different web address.** Open the address, log in, start a
Squats workout, record your two clips, then move to the next address.

> ### ⚠️ THE FIRST ATTEMPT AT THIS SESSION FAILED, and it was our bug
>
> On 2026-08-09 Kd recorded all eight clips and **every one of them came out at
> the default settings.** The app's router throws the settings away when it
> sends you to the login page, so the camera never saw them. Fixed the same day.
>
> **The instruction was also at fault, and that half matters more.** It said
> "a yellow line appears — if you do NOT see it, stop". Asking someone to notice
> something MISSING is not a check, and he did not notice. **The recorder box
> now always shows the settings**, so you compare two lines instead of hunting
> for an absence.

**Your check, before recording anything on each run:** look at the bottom-left
black box. It shows a line beginning `⚙`.

- On run **A** it should say `lite n=1 det=0.5 pres=0.5 track=0.5  (default)` in **grey**.
- On runs **B, C, D** it must be **yellow**, with no `(default)`, and must show
  the value you asked for.

**If run B does not say `det=0.9` in yellow, stop and tell me.** Do not record.

| Run | Open this address | What it changes |
|---|---|---|
| **A** | `http://localhost:5173` | nothing — today's behaviour, the control |
| **B** | `http://localhost:5173/?detectConf=0.9&trackConf=0.9` | makes the camera much fussier about calling something a person, and makes it re-check constantly instead of clinging to whatever it locked onto |
| **C** | `http://localhost:5173/?model=full` | the bigger, more accurate model (we currently ship the small one) |
| **D** | `http://localhost:5173/?numPoses=2` | lets it find two bodies instead of always picking one winner |

**Run C may be slower or jerkier.** That is information, not a fault — note it
if you see it.

---

## The two clips, for each of the four runs

### Clip 1 — the chair alone

Point the laptop at the chair and fan. **Stay out of shot.** Record **45
seconds**.

Type: label `chair_A` · view `side` · device `laptop`
*(use `chair_B`, `chair_C`, `chair_D` on the other runs)*

### Clip 2 — you and the chair

Both in frame: you squatting at your normal pace, chair or fan visible beside or
behind you. Record **45 seconds**.

Type: label `both_A` · view `side` · device `laptop`
*(then `both_B`, `both_C`, `both_D`)*

---

## When you're done

**Sixteen files** — two per clip, eight clips. Put them in a **new folder** on
your Desktop, separate from last time's, and tell me where.

**Also tell me**, roughly:

- Did any run feel noticeably slower or more stuttery?
- On run D, did you see two skeletons drawn at once?
- Did the counting feel better on any run?

Your impressions are not the measurement, but they will tell me where to look.

---

## If something goes wrong

- **No yellow line on B, C or D** → the address was mistyped. Check it, reload.
- **Camera never starts on run C** → the bigger model failed to download. Say
  so and skip C; the other three still work.
- **You cannot finish all eight** → do **A and B first**, they are the pair most
  likely to answer the question. Partial is fine, just tell me which you got.

---

## What happens after

I read the sixteen files and tell you which setting, if any, keeps the chair out
while still counting your squats. **If one wins, that plus the first test is the
fix.** If none does, we go back to your object-detector idea, which was dropped
on cost and not on merit.

**No setting gets chosen because it sounds better.** It gets chosen because the
numbers from your room say so.
