# The wobble test — one command, on the files you already have

**ALREADY RUN, 2026-08-09, by me on Kd's own machine** — the files were on his
Desktop and the terminal was right here, so asking him to type it was wasted
effort. Results at `DECISIONS.md`. This doc stays because the command is worth
re-running whenever new clips arrive.

**Nothing to record.** This reads the ten files from the 2026-08-08 session and
answers one question: **can we tell the chair apart from a person, using only
the dots the camera already reports?**

**It cannot pass or fail.** It prints numbers.

**TWO CORRECTIONS FROM THE FIRST REAL RUN, both mine, both in this document:**
1. The command below originally carried the full path
   `packages/engine/scripts/measure-pose.ts`. **`--filter` already runs from the
   package folder, so that path resolves to `packages/engine/packages/engine/…`
   and the run dies.** It is `scripts/measure-pose.ts`. This doc cited :5034's
   "an instruction with no working command behind it" **and then shipped one** —
   the command was edited after the last time it was executed.
2. `empty_room` was originally listed under `--nobody`. **It is not nobody:**
   its 58% detection rate is Kd walking out of shot and back in (:6386), so the
   pile was polluted with real-person frames. `furniture_only` is the only clean
   no-person clip.

---

## What you type

One line. Put your ten files in one folder first (they probably already are —
the folder you saved them to). Then:

```
corepack pnpm --filter @app/engine exec tsx scripts/measure-pose.ts --exercise squat --person me_squatting,me_standing --nobody furniture_only "C:\Users\kautilya\Desktop\traces"
```

**Change the path at the end** to wherever your ten files actually are. Keep the
quote marks around it.

Run it from the `D:\Projects\ai-home-gym` folder.

**Then paste me everything it prints.** All of it, even the boring parts.

---

## What the bits of that line mean

You do not need this to run it, but in case it errors:

- `--exercise squat` — your files say `squats` inside them, and the app's rules
  file is called `squat`. That mismatch is a bug on our side that I am fixing in
  the next piece of work; until then this flag steps over it. **If you leave it
  out the command stops immediately and tells you so** — that is deliberate.
- `--person me_squatting,me_standing` — the clips with you in them.
- `--nobody furniture_only,empty_room` — the clips with no one in them.
- The fifth clip, `me_and_furniture`, is in neither list on purpose: it has both
  you *and* the chair, so it cannot be an example of either. It still gets
  measured on its own.

---

## What you'll see

Five numbered sections per clip. **Section 5 at the very bottom is the answer** —
it is the only part I need, but paste the rest anyway so I can check nothing odd
happened.

Section 5 gives each of the four tests a **separation** score:

| Score | Meaning |
|---|---|
| **1.00** | your chair and you never overlap — the test works perfectly |
| **0.90+** | good enough to build on |
| **around 0.50** | the test is useless, bin it |

Under each score are lines like *"cut-off 0.28 → catches 96% of furniture,
wrongly rejects 1% of real frames"*. **The second number is the one that
matters** — it is how often the app would wrongly stop counting for a real
person. I have set it up so that number is what gets protected first, because
being wrongly ignored mid-squat is worse than a chair sneaking through.

---

## If something goes wrong

- **"no definition file for 'squats'"** → you left off `--exercise squat`.
- **"reading 0 clip(s)"** → the path at the end is wrong, or the files are in a
  sub-folder.
- **Anything else** → paste it to me exactly as it appears. Do not retype it.

---

## What happens after

I read the numbers and tell you one of two things:

1. **A test works** → we are close. The next step is a short recording session
   with more furniture, so a cut-off is not chosen from one chair in one room.
2. **Nothing works** → the free route is dead, and we go to changing the
   camera's own settings, which needs you to record again.

**No number gets chosen from this run alone.** One chair in one room is not
enough to decide what every user's app does, and the project's own rules forbid
it.
