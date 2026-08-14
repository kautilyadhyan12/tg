# RECORDING SESSION — what your camera sees while you REST between squats

**This is a measurement, not a test.** Nothing here can pass or fail. You record
two short clips; I read the numbers and come back with a table and one decision
for you.

**Why you have to record something new.** I measured all thirteen clips you
already gave me. **None of them contains a real rest.** Your "standing still"
clip has you standing upright — out of 1,268 frames, only **one** had your knees
bent enough to trigger the problem. The gaps between your squats are about a
fifth of a second each, which is not a rest. So there is nothing in the existing
recordings to measure the fix against, and I am not going to hand you a table
built out of stitched-together frames and call it evidence.

**Time:** about 10 minutes, most of it standing around.

---

## Before you start

**Same room, same lighting, same spot** as your earlier recordings, so these
clips can be compared with those.

You will click a small black box in the **bottom-left corner** that says
**● record trace**. It only appears when the app is started the special way
below. Each recording downloads **two files**. Send me all of them.

---

## Setup — three programs, in three windows

*(Say the word and I'll start all three for you instead.)*

**1. The stand-in for the old server.** It starts switched OFF on purpose.

```
node apps/web/tools/mock-ml-backend.mjs
```

Then open this in a browser tab — you must, or no workout will start:

```
http://localhost:8000/__state/healthy
```

**2. The main server:**

```
cd apps/api
node --import tsx --env-file=.env src/index.ts
```

**3. The app — the extra bit at the front is what switches the recorder on:**

```
cd apps/web
$env:VITE_TRACE_RECORD="1"; corepack pnpm exec vite
```

Then open `http://localhost:5173` and log in.

**Check before going further:** start a Squats workout. If you can see the small
black **● record trace** box in the bottom-left, the recorder is on. If you
cannot see it, stop and tell me — the rest is pointless without it.

---

## Three rules that matter more than the clips

These three are the whole point. If one of them is broken, the clip tells me
nothing.

1. **Do NOT press pause during the rest.** Pausing is already fixed. If you
   pause, the problem I am trying to measure disappears and the clip is wasted.
2. **Do NOT walk out of view during the rest.** Walking away is also already
   fixed. Stay where the camera can see your whole body the entire time.
3. **Do NOT press "Complete Set" during the rest.** The rest has to happen
   *inside* one set — that is exactly where the app gets it wrong.

So: start the set, and stay in front of the camera doing nothing until it is
time to squat again.

---

## How to record one clip

1. Click **● record trace**
2. Do the thing (below)
3. Click **■ stop & download**
4. It asks you three questions. Type **exactly** what the clip says to type.
5. Two files download

---

## Clip 1 — resting the way you normally do  ← the important one

Start a Squats workout, then:

| | Do this | For how long |
|---|---|---|
| 1 | 3 squats at your normal pace | — |
| 2 | **Stand and rest.** Just stand there getting your breath back, the way you actually would between sets. **Do not think about your legs** — do not deliberately straighten them, do not deliberately bend them. Normal. | **30 seconds** |
| 3 | 3 more squats | — |
| 4 | Stand and rest again, same as before | **30 seconds** |
| 5 | 3 more squats, then stop the recording | — |

Type: label `rest_natural` · view `side` · device `laptop`

> Step 2 is the entire experiment. The app charges you calories for standing
> there if your knees are even slightly soft, and does not if they are locked
> straight. **Nobody can see the difference, which is the problem.** Whatever
> your legs do naturally is the correct thing to record — do not help me.

---

## Clip 2 — resting bolt upright  (the comparison)

Exactly the same as Clip 1, with one change: during **both** rests, stand up
**completely straight, legs locked, knees pushed back.** Deliberately, this
time.

Type: label `rest_upright` · view `side` · device `laptop`

> This one should cost you nothing. It is the control: if clip 1 and clip 2 come
> out the same, my explanation of the problem is wrong and I need to know that
> before building anything.

---

## If the app does something unexpected

Note it and carry on — it is information, not a failure:

- **The set ends on its own during a rest** → tell me roughly when.
- **A message appears about the camera**, or a **"Count this set myself"**
  button → **do not press it**, but tell me it appeared.
- **The counter moves while you are standing still** → that is worth telling me
  about on its own.

---

## When you're done

Send me every downloaded file. There should be **4** — two per clip:

```
squat-rest_natural.jsonl
squat-rest_natural.detect.jsonl
squat-rest_upright.jsonl
squat-rest_upright.detect.jsonl
```

**Then stop.** I read them, and come back with the table and **one** number for
you to choose.

---

## If something goes wrong

- **No black box in the corner** → the `$env:VITE_TRACE_RECORD="1"` part was
  missed. Close that window and redo step 3.
- **Nothing downloads** → tell me the two numbers the box was showing.
- **Can't get your whole body in view** → say so and stop. Squeezing into a bad
  frame would poison the measurement.
- **Don't** run anything else that changes files while this is open.
