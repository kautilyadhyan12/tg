# RECORDING SESSION — what the camera actually sees in Kd's room

**This is a measurement, not a test.** Nothing here can pass or fail. You are
recording what your camera reports; I read the numbers afterwards and only then
decide what to fix.

**Why it has to be you, in your room.** The rule on this work says no cut-off
may be picked from judgement — the app's "is that a person?" line has to come
from what YOUR camera reports on YOUR chair, not from a number I like the look
of. Nobody else's room can produce that.

**Time:** about 20 minutes, most of it standing around.

---

## Before you start

**Same room, same chair, same fan, same lighting** as when you saw the problem.
If it happened in the evening with the lamp on, do this in the evening with the
lamp on.

You will click a small black box in the **bottom-left corner** of the screen
that says **● record trace**. It only appears when the app is started the
special way below. Each recording downloads **two files**. Send me all of them.

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

**3. The app — note the extra bit at the front, it switches the recorder on:**

```
cd apps/web
$env:VITE_TRACE_RECORD="1"; corepack pnpm exec vite
```

Then open `http://localhost:5173` and log in.

**Check before going further:** start a Squats workout. If you can see a small
black **● record trace** box in the bottom-left corner, the recorder is on. If
you cannot see it, stop and tell me — the rest is pointless without it.

---

## How to record one clip

The same five actions every time:

1. Click **● record trace**
2. Do the thing (below)
3. Click **■ stop & download**
4. It asks you three questions. Type **exactly** what the clip says to type.
5. Two files download

**While recording, the box shows two numbers** — frames, and how many had a
person in them. On the empty-room clips the second number **should be 0 or
close to it. That is the point.** It is not broken.

---

## The five clips

### Clip 1 — nobody there

Start a Squats workout, then **walk out of the camera's view completely.**
Record for **1 minute**. Stand out of shot the whole time.

> The app may show a message about the camera or a button saying **"Count this
> set myself"**. **Do not press it.** It changes nothing about the recording.

Type: label `empty_room` · view `side` · device `laptop`

---

### Clip 2 — the furniture

Point the laptop at **the chair and the fan** — the things it drew a person on.
Stay out of shot yourself. Record for **1 minute**.

If you can, move the laptop around slowly so it sees them from a few angles.

Type: label `furniture_only` · view `side` · device `laptop`

---

### Clip 3 — you, standing still

Stand where you'd normally squat, full body in view. **Don't move.** Record for
**30 seconds**.

Type: label `me_standing` · view `side` · device `laptop`

---

### Clip 4 — proper squats

Do squats at your normal pace and depth for about **1 minute**.

**Say out loud, or write down, roughly when a squat you thought was good did not
get counted.** ("The 3rd one and the 6th one" is enough — I don't need exact
timings.)

If the set finishes on its own, just start the next set and carry on.

Type: label `me_squatting` · view `side` · device `laptop`

---

### Clip 5 — the chair, WITH you there

Both in frame at once: you squatting, and the chair or fan visible behind or
beside you. **1 minute.** This is the one that shows whether the furniture
steals attention away from you.

Type: label `me_and_furniture` · view `side` · device `laptop`

---

## The question that isn't a recording

**What is the voice actually saying when it babbles?** Roughly is fine.

I've worked out that during squats the app can only ever say one coaching
line — a "keep your chest up" sort of sentence — plus generic praise when it
thinks you did a rep.

- **If that's what you heard**, the voice is just repeating what it thinks the
  chair is doing, and fixing the camera fixes the voice too.
- **If you heard something else entirely**, my theory is wrong and I need to
  know before I build anything.

---

## When you're done

Send me every downloaded file. There should be **10** — two per clip. They look
like:

```
squat-empty_room.jsonl
squat-empty_room.detect.jsonl
squat-furniture_only.jsonl
squat-furniture_only.detect.jsonl
...
```

Plus your notes: which squats weren't counted, and what the voice was saying.

**Then stop.** I'll read them and come back with what they show and **one**
decision for you about the voice.

---

## If something goes wrong

- **No black box in the corner** → the `$env:VITE_TRACE_RECORD="1"` part was
  missed. Close that window and redo step 3.
- **Nothing downloads** → tell me the two numbers the box was showing.
- **Can't get your whole body in view** → say so and stop. That's a setup
  problem, not a result, and squeezing into a bad frame would poison the
  measurement.
- **Don't** run anything else that changes files while this is open.
