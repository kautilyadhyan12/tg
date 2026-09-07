# SMOKE — the strong camera model, and the new camera-rate readout

Branch `web-repoint`. **Two cards are uncommitted in the same working tree and
this one sheet covers both.** Neither ticks until this passes.

## RESULT — PASSED 5/5, 2026-08-17 (second sitting). The card still does not tick.

**The headline: the strong model costs nothing measurable on Kd's machine, and
it did not let the chair back in.**

| step | what came back |
|---|---|
| setup | `[pose-assets] all 6 camera assets already present and verified` — **six** |
| 1 | widget `⚙ full n=1 det=0.5 pres=0.5 track=0.5 (default)` · console **THE APP BUNDLE** · **680 ms** |
| 2 | `mode engine` · **`camera rate` 10–12 of 14.9/s** · counting works |
| 3 | **empty chair, one minute, ZERO invented reps** |
| 4 | `?model=lite` — widget yellow and says `lite` · **11–12 of 14.9/s** |
| 5 | workout finished, summary normal |

- **Step 1 — the strong model came off disk, not the internet.** Startup
  **680 ms** against the weak model's 643 ms (:8879), i.e. **+37 ms**. The
  console line is the one that carries the claim; the six-asset line at boot
  only proves availability.
- **Step 2 — THE MEASUREMENT THIS CARD EXISTS FOR: 10–12 against the 14.9
  ceiling.** The weak model measured 9.2–12.2 (:8879). **The strong model has
  NOT eaten the throttle's headroom.** Corroborated independently of Kd's
  reading by the DEV console line, which printed **10.0, 11.4 and 7.6 fps**
  while he squatted. (12.0 is the practical cap on a 60 Hz display — :9003 —
  so 10–12 IS the top of the range, not a shortfall.)
- **Step 3 — the empty chair invented ZERO reps under `full`.** He confirmed,
  asked twice and answered plainly, that he ran it **in this session with the
  widget reading `full`** — the question was put twice precisely because a pass
  from the `lite` era (:7222) says nothing about this model.
- **Step 4 — the weak model reads 11–12 on the same machine.** Within a
  hand-read range the two models are indistinguishable at the feed, which is
  the whole point of bundling both: the comparison is now on the record.
- **Step 5 — the summary screen is unchanged.**

**INDEPENDENTLY MEASURED FROM THIS SIDE — the stored rows, which the previous
sitting did not have.** `grep -c 'workouts/sync'` = **8** (it was 0), and
**five sets across three workouts are stored, EVERY ONE `mode = 'engine'`**
with real form scores (100, 100, 75, 50, 100), `engine_version 1.0.0`, and
`kcal_calc_version 3`. The first camera workout counted **4 reps in each of two
sets**. Three sets carry a `duration_ms` far above their `watched_ms`
(150,075 / 30,572 · 134,626 / 25,157 · 93,308 / 18,139) — **a camera that could
not see a person for two minutes of a two-and-a-half minute set**, which is
what stepping out of shot looks like from the database, and corroborates that
he really did leave the frame.

**WHAT THE ROWS CANNOT SAY, said rather than glossed (:7222's rule).** A stored
row holds the FINAL count, not the count over time, so it cannot distinguish
"2 reps before he stepped away" from "2 reps invented by the chair". **Step 3's
headline rests on Kd's report** (:4829), with the watched-time collapse above as
the only corroboration. Nothing in the payload records which pose model produced
a set either, so steps 2 and 4 are told apart by his reading and the console
line, not by the database.

**Consequence: the SMOKE gate is discharged, and the card still does NOT tick.**
The T3 fix round's **diff-only re-review is unrun** (`t3-camera-rate-expiry-r2-PROMPT.md`),
and under :5348 a packet ships on a review round finding zero Critical/High.
`bone_stretch > 0.923`'s own 🔴 line does not tick either — step 3 is one room,
one chair, one minute, and that line is unblocked by a fresh RECORDING replayed
through `measure-pose.ts`, never by a smoke.

---

## What changed, in plain words

**Two things.**

1. **The camera now uses the strong pose model.** It used to use the weak one.
   Nobody ever chose the weak one — it was carried over from the old version of
   the app and never questioned. A weaker model is a more gullible one: the weak
   one is what once reported a chair's chest and hips as a person's, and what
   counted six reps off a photo of an empty room.

2. **A new line in the `debug` box shows how fast the camera is really feeding
   the rep counter.** It reads something like `12.0 of 14.9/s`. The second number
   is the fastest this app can ever go — not a target you are missing. That
   distinction is the whole reason the line exists.

## What you are proving

- The strong model loads **from your own disk**, not from the internet.
- It **still counts your reps**.
- It **still ignores an empty chair**.
- It has **not made the camera slower** — the rate line is how you tell.

## What this does NOT claim

You still cannot open the app with no internet at all. This is about a workout
once the page is already open.

**Only 3 of 58 exercises are camera-graded: Squats, Jump Squats, Chair Squats.
Use Squats.**

---

## Setup — two servers, and NOT a third

**Terminal 1 — the API**

```
cd apps/api && node --import tsx --env-file=.env src/index.ts
```

Wait for it to say it is listening on port 3000.

**Terminal 2 — the web app** (from the repo root)

```
corepack pnpm --filter web run dev
```

✅ Before Vite starts it should print:

```
[pose-assets] all 6 camera assets already present and verified
```

**Six, not five.** Five means the strong model is missing — stop and say so.
If instead it *downloads* one file (9.4 MB), that is fine — it just was not on
disk yet. If it **fails**, stop and paste the error.

Open **http://localhost:5173** exactly. (A leftover Vite on 5173 pushes this one
to 5174, where sign-in fails silently.)

**DO NOT start `mock-ml-backend.mjs` on port 8000.** The workout loop no longer
needs it.

## Open the browser tools once

Press **F12**, click the **Console** tab, leave it open throughout.

---

## Step 1 — is the strong model the one that loaded?

Start a **Squats** workout with the camera.

Look at the small black box in the **bottom-left** of the screen (the trace
recorder widget). It always shows the camera settings.

✅ **Expected — it says `full`:**

```
⚙ full n=1 det=0.5 pres=0.5 track=0.5  (default)
```

❌ If it says `lite`, stop. The swap did not take effect.

Now look at the **Console**.

✅ **Expected — one line like:**

```
[usePoseDetection] MediaPipe ready in NNN ms — runtime and model from THE APP BUNDLE (this workout survives losing the network)
```

❌ If it says **THE INTERNET**, stop and paste the orange warning above it. That
means the strong model was not on disk and the app went to Google for it.

**Write down the NNN number.** Last time, with the weak model, it was 643 ms. The
strong model is larger, so a bigger number here is expected and fine — we just
want to know by how much.

---

## Step 2 — does it still count you?

Press **debug** (top-right of the camera picture) to open the readout.

Do **5 slow, deep squats** in full view of the camera.

✅ **Expected:**
- The rep number climbs to 5. It may be 4 or 6 — say which; it does not have to
  be perfect, we are comparing against how it behaved before.
- `mode` says `engine` in green.
- `camera rate` shows two numbers, e.g. `12.0 of 14.9/s`.

**Write down the `camera rate` line.** This is the important measurement of the
whole smoke. The number before "of" was **9.2 to 12.2** with the weak model.

❌ **If the first number has dropped a lot** — say to 6 or 7 — the strong model
is costing more than the app has spare, and that is a real finding. Say so; it
is not a failure of the smoke.

---

## Step 3 — does it still ignore an empty chair?

Finish or end the set. Start another **Squats** set with the camera.

**Step completely out of the picture** so the camera sees only your room and a
chair. Leave it for **one minute**. Do not walk back through the shot.

✅ **Expected:** the rep counter does **not** move. Zero reps.

You may see this sentence appear, which is correct and expected:

> Not counting — the camera isn't sure it's looking at you. Check that your whole
> body is in the picture.

❌ **If the counter climbs while you are out of the room, that is the one result
that matters most.** The chair-detection number was measured with the *weak*
model, and this step is the only check we have that it still works with the
strong one. Say exactly how many reps it invented.

---

## Step 4 — the comparison: put the weak model back for one set

This is why both models are bundled. It works with the internet off.

Open a new tab at:

**http://localhost:5173/?model=lite**

Sign in if asked, and start a **Squats** camera workout.

✅ **Expected — the widget turns YELLOW and drops the word `(default)`:**

```
⚙ lite n=1 det=0.5 pres=0.5 track=0.5
```

❌ If it still says `full`, or stays grey, stop — the setting did not survive.

Now do the **same 5 squats** and read the same two things:

- the `camera rate` line
- the rep count

**This is the comparison the whole swap is for.** Two numbers from step 2, two
from here.

When you are done, close that tab and open plain **http://localhost:5173** again
to go back to the strong model.

---

## Step 5 — finish a workout normally

Finish the workout through to the summary screen.

✅ **Expected:** the summary appears with a form score and calories, as usual.
Nothing about it should look different from before.

---

## What to report back

Copy this and fill it in:

```
Setup:      6 assets verified?          yes / no
Step 1:     widget says                 full / lite
            console says                THE APP BUNDLE / THE INTERNET
            MediaPipe ready in          ____ ms
Step 2:     reps counted (did 5)        ____
            camera rate                 ____ of ____ /s
            mode                        engine / other
Step 3:     reps invented by the chair  ____   (expected 0)
Step 4:     with ?model=lite —
            widget yellow + says lite?  yes / no
            reps counted (did 5)        ____
            camera rate                 ____ of ____ /s
Step 5:     summary screen normal?      yes / no

Anything odd in the console:
```

---

## Notes for whoever reads the result

- **A slower rate in step 2 than step 4 is a real result, not a smoke failure.**
  It would mean the strong model costs more per frame than the app has spare, and
  the honest response is to record it, not to bury it.
- **Step 3 is the highest-stakes step.** `bone_stretch > 0.923` was ruled by Kd on
  thirteen clips recorded through the **weak** model (DECISIONS :7037). It is
  untouched by this card (R5.4, R5.7). If step 3 fails, **do not retune it** — it
  needs a fresh recording and a table put back in front of Kd.
- The `debug` box is not developer-only; any user can open it (:6277).
