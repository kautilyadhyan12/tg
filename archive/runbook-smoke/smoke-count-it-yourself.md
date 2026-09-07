# SMOKE — counting your own reps is a choice

Card: the rep-counting choice + the camera-graded set that landed nowhere
(`OWED.md` F-3 line), branch `web-repoint`.
Gates "done" per CLAUDE.md Part I §2. Run every step; report pass/fail per step.

## RESULT — RUN 2026-08-04 (Kd), on the final post-round-4 code: **1–5 AND 7
## PASS, all verified in the database. 6 and 8 SKIPPED by Kd's ruling**
## (DECISIONS 2026-08-04): he judged the mid-set camera-failure drills
## unnecessary to run by hand; the behaviour stays in the code and its unit
## tests. THE CARD'S SMOKE GATE IS DISCHARGED.

| started (UTC)  | exercise | sets | reps | avg_form_score | mode       | step |
|----------------|----------|------|------|----------------|------------|------|
| 08-04 03:49:55 | push_up  | 2    | 3+3  | NULL           | `log_only` | 1–3  |
| 08-04 03:51:01 | squat    | 2    | 3+3  | NULL           | `log_only` | 4    |
| 08-04 03:55:20 | squat    | 2    | 3+3  | 83 / 83        | `engine`   | 5    |
| 08-04 04:09:07 | push_up  | 2    | 3+3  | NULL           | `log_only` | 7    |
| 08-04 04:09:07 | squat    | 2    | 3+3  | 77 / 91        | `engine`   | 7    |

Step 5's closure condition (OWED: two-or-more camera sets, BOTH `engine` with
real scores — round 2's F1 filed set 1 as hand-counted) is met by the 03:55 row.
Step 7's rows are ONE workout: the ungraded-then-graded score-loss bug that
three review rounds kept refinding did not occur. The 03:55 and 04:09 workouts
each arrived only after a hard reload — the queue-flush lag below, observed
again, working as designed.

Also observed and traced during the run: the post-workout summary screen showed
"15m 0s / 35 min / 280 kcal / 88%" for a seconds-long workout. NOT a defect in
the app — those are this rig's canned `SUMMARY_FULL` numbers
(`mock-ml-backend.mjs` `active_seconds: 900`, `duration_minutes: 35`), identical
for every workout by construction. The summary reads the OLD backend until its
new-API home lands (existing OWED line).

## PREVIOUS RESULT (2026-08-03) — **VOID. Superseded by the run above.**

The run recorded here happened on 2026-08-03 against code that four review rounds
have since changed, and **the reviews found defects that this run would have
had.** Its "pass" for the camera control (step 5) is exactly the kind of stale
green the whole card has been fighting: on the code Kd actually ran, round 2's F1
means the FIRST set of that workout should have stored `log_only` with no score.
Either the run or the record is wrong, and there is no way to tell which now.

**So: steps 1–8 are all UNRUN as far as this card's tick is concerned.** Steps 7
and 8 have never executed at all — they were added after round 3.

The table below is kept only as evidence that the write path reached the database
at least once. Do not read it as a pass.

| started (UTC) | exercise | sets | reps | avg_form_score | mode       | step |
|---------------|----------|------|------|----------------|------------|------|
| 05:12:53      | push_up  | 1    | 3    | NULL           | `log_only` | 1–3  |
| 05:20:47      | squat    | 2    | 6    | NULL           | `log_only` | 4    |
| 07:45:37      | squat    | 1    | 3    | 100            | `engine`   | 5    |
| 07:58:05      | squat    | 1    | 3    | 67             | `engine`   | 5    |

The 05:20 squat row is the point of the card: before it, that set was stored
nowhere. The two `engine` rows are the CONTROL — the camera still grades and
still stores, unchanged by this card.

## ⚠️ READ THIS BEFORE YOU DECIDE A WORKOUT WAS LOST

**The app does not send a workout the moment you finish it. It holds it and
sends it the next time the app loads.** So a workout you just finished can be
missing from the database for a long time and still be perfectly safe. The
07:45 workout above did not arrive until **07:57** — twelve minutes later, the
instant the page was reloaded. That is how it is meant to work: it is what
keeps a workout safe when the internet drops.

**So: an empty result right after a workout means nothing at all.** Reload the
page (`Ctrl+Shift+R`), give it a moment, and look again. Only then is an empty
result worth thinking about.

On 2026-08-03 skipping that step cost 35 minutes and produced a confident,
completely wrong "this is a real bug".

Two more traps from the same session:

  · **Never run the tamper-check tool while a smoke test is in progress.**
    (`node apps/web/tools/mutate-write-path.mjs`.) It deliberately breaks the
    workout screen dozens of times in a row to check the tests notice, and the
    browser picks up each broken version straight away. Any workout done while
    it runs is testing broken-on-purpose code, and tells you nothing.
  · **A workout where nothing was counted is thrown away with no message.** No
    error on screen, nothing in the browser console — it simply never arrives.
    So "there was no error" is not evidence that anything was sent.

---

**What this card changed, in one sentence.** You can now choose to count your own
reps instead of using the camera — on every exercise — and a set you counted is
saved even when the camera was supposed to be watching and never actually did.

**The defect it removes, in one sentence.** Before this, no camera meant no
workout at all: the Start button stayed dead until a live camera feed arrived,
even for press-ups, which never use the camera for anything.

**The quieter defect it removes.** On the three exercises the camera can grade —
squat, jump squat, chair squat — the app hid the "+1 Rep" button because the
camera was meant to count for you. If the camera never started, nothing counted
and there was no button to fall back on: the set was saved nowhere, on a workout
that otherwise saved fine. A day that showed less training than you actually did.

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
on `:5173`.

**The rig boots in `dead`.** Before anything else, open
`http://localhost:8000/__state/healthy` in a tab, or nothing will start.

**A workout cannot be started on this branch without the rig** — the pre-workout
screen creates its session through the old backend, and the real one rejects the
request because this branch stopped writing the old token. That is not a bug in
this card; it is why the rig has the three workout answers in it.

**Open devtools BEFORE you act** — a panel opened afterwards says "Currently
recording…" and has captured nothing.

---

## THE DEFECT — the reason this card exists

### 1. A workout with no camera at all
Unplug or disable your webcam (Windows: Settings → Privacy → Camera → turn off
camera access for apps). Then build a workout of **Push-ups** and go to the
pre-workout screen.

✅ The heading area offers **two choices**: "Use the camera" and
   "I'll count my own reps"
✅ With "Use the camera" selected, the bottom button is **greyed out** and reads
   `Complete checklist (0/4)` — this is the OLD behaviour, and it is correct for
   the camera path
✅ Click **"I'll count my own reps"** → the camera preview, the positioning tips
   and the four-item checklist all **disappear**, and the button turns orange and
   reads **Start Workout**

**If the button is still dead after choosing to count yourself, STOP** — that is
the defect, unfixed.

### 2. The workout itself
Press **Start Workout**.

✅ No camera permission prompt appears, and your laptop's camera light stays OFF
✅ Where the video would be, a panel reads **"Camera off"** with
   "You chose to count your own reps"
✅ The badge top-left reads **Counting yourself** (not "Log-only", not "AI form check")
✅ A **+1 Rep** button is there, with "You're counting your own reps — tap once per rep"
✅ Tap it 3 times → the big number reads **3** and it beeps each tap
✅ The set ends on the third tap (target is 3) and the rest screen appears

Let the workout finish. ✅ You land on the summary screen.

### 3. THE CHECK THAT MATTERS — is it really saved?
Do not trust the screen. In a terminal:

Save this as `apps/api/__check.mts`, run it, then delete it. (It must live inside
`apps/api` or `drizzle-orm` will not resolve, and it must end `.mts` or Node
rejects the top-level `await`. There is no `db` singleton to import — the db is
built by `createDb`, and `src/db/client.ts` does not exist.)

```ts
import { createDb } from "./src/db/index.ts";
import { sql } from "drizzle-orm";
const db = createDb(process.env.DATABASE_URL!);
const r = await db.execute(sql`
  select to_char(w.started_at,'MM-DD HH24:MI:SS') as started, e.slug,
         s.set_index, s.mode, s.reps, s.duration_ms, s.avg_form_score
  from workout_sets s
  join workouts w on w.id = s.workout_id
  left join exercises e on e.id = s.exercise_id
  order by w.started_at desc, s.set_index asc limit 10`);
console.table(r.rows ?? r);
process.exit(0);
```

```
cd apps/api && node --import tsx --env-file=.env __check.mts && rm __check.mts
```

Note `quality_flags` lives on `workouts`, not `workout_sets`.

✅ The newest row is your set: **reps 3**, `mode` = **log_only**,
   `avg_form_score` = **NULL**, and a sensible `duration_ms`
✅ `exercise_id` is not null — that is the proof the server RECOGNISED the
   exercise rather than throwing the set away

---

## THE QUIET DEFECT — a camera-graded exercise with no camera

### 4. Squats with the camera refused
Keep the camera disabled. Build a workout of **Squats** (3 reps), go to
pre-workout, and choose **"Use the camera"** this time. The checklist will not
complete, so instead switch to **"I'll count my own reps"** and start.

✅ The **+1 Rep** button is present **on squats** — before this card it was
   hidden on this exercise, and there was no way to record a rep
✅ Tap 3 times, finish the workout
✅ Re-run the query from step 3: the newest row is `squat` / `log_only` /
   **reps 3** / `avg_form_score` NULL

**Before this card this set was saved nowhere at all.** That is the whole point
of the step.

### 5. The camera path still works (THE CONTROL)
Re-enable your camera. Build a workout of **Squats**, choose **"Use the camera"**,
tick the three manual checklist items, and start.

✅ The checklist's "Camera is working" ticks itself and the button goes orange
✅ On the workout screen the badge reads **AI form check**, the video is live,
   and there is **NO +1 Rep button**
✅ The camera counts your squats by itself and gives form feedback
✅ Finish, then re-run the query: the row for that set has `mode` **NULL or
   engine**, a real `avg_form_score`, and reps counted by the camera

**If step 5 fails, the fix has over-reached** — it must not take the camera away
from someone who wanted it. This is the control and it matters most.

### 6. The camera dies mid-workout
Start a **Squats** workout with the camera on (as in step 5). After the first
rep, physically unplug the webcam (or disable it in Settings).

✅ Within about five seconds a **+1 Rep** button appears, with
   "The camera isn't counting right now — tap once per rep and your set still counts."
✅ The badge changes to **Camera not counting**
✅ Tap out the rest of the set by hand and finish
✅ The query shows the set saved, with the reps you tapped

---

### 7. TWO EXERCISES IN ONE WORKOUT — press-ups first, then squats
Camera ON. Build a workout with **Push-ups (1 set, 2 reps)** and then
**Squats (1 set, 2 reps)**, in that order. Choose "Use the camera" and start.

Count the press-ups by hand (the camera cannot grade them). Then let the camera
count your squats.

✅ On the squats the badge reads **AI form check** and there is **no +1 Rep button**
✅ The query shows TWO rows: `push_up` with no score, and **`squat` WITH a real
   `avg_form_score`**

**If the squat row has no score, the bug is back.** For three review rounds the
app lost the form score whenever a graded exercise followed an ungraded one —
and no single-exercise test could see it.

### 8. THE CAMERA CUTS OUT AND COMES BACK
Camera ON, **Squats**, 6 reps. Start, and let the camera count 1–2 reps.

Now interrupt the camera and restore it. Easiest reliable way: open your laptop's
Camera app (which takes the device), wait 3 seconds, close it again.

✅ While it is taken: a **+1 Rep** button appears and the badge reads
   **Camera not counting**
✅ **After you close the Camera app, the +1 Rep button is STILL THERE** — it must
   not vanish while you are using it
✅ Tap out the rest of the set by hand and finish
✅ The query shows the set with **the reps you tapped**

**If the button disappears when the camera comes back, stop.** That is the
camera taking the set back mid-set, which the ruling forbids — and on a phone it
happens every time you switch apps.

---

## What to report

Step number, pass or fail, and for step 3 / 4 / 6 the actual row from the query.
A screenshot of the table is fine. If any step fails, stop there and say which.
