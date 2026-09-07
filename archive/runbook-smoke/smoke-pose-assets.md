# SMOKE — the camera's two downloads now ship inside the app

Branch `web-repoint`. **This card does not tick until this passes.**

## RESULT — PASS, run by Kd 2026-08-17

**THE METHOD IN STEPS 1–2 BELOW DID NOT WORK AND WAS REPLACED MID-RUN. Read
this before following them.** DevTools "Network request blocking" with the
patterns `localhost:5173/mediapipe/` and `localhost:5173/models/` had NO EFFECT:
the control round printed `THE APP BUNDLE`, i.e. the app served its own files
straight through the block. The blocking was replaced by two stronger, simpler
instruments, both of which worked first time and neither of which needs DevTools:

| | Step 1 (control) | Step 2 (real) |
|---|---|---|
| **Instrument used** | the five bundled files MOVED OFF DISK by the chat | the machine's **Wi-Fi switched off** |
| **Console said** | `THE INTERNET` + the orange warning | `THE APP BUNDLE`, no warning |
| **Time to ready** | **884 ms** | **643 ms** |

Why Wi-Fi-off is legitimate where the sheet's own text rejects the DevTools
Offline throttle: the throttle intercepts localhost too and would cut the Vite
dev server that SERVES the bundled files; switching off the adapter does not
touch loopback, so localhost keeps working and only the internet is gone. It is
what the sheet was reaching for and could not express.

Why file-removal is a legitimate control: with the files gone, Vite's SPA
fallback answers `/models/pose_landmarker_lite.task` with **index.html at 200** —
MediaPipe gets a web page where it expects a model, which is the SAME shape as
the original defect. Verified 404/HTML by curl before Kd ran it. All five files
restored afterwards and **sha256-verified byte-identical**.

- **Step 3** (reps with the network cut) — PASS. Kd: "everything was normal".
- **Step 4** (zero CDN rows) — NOT RUN AS WRITTEN, and superseded: with the
  adapter off the two hosts are unreachable at the OS level, which is a stronger
  claim than an empty filter box.
- **Step 5** — **9.2 to 12.2 fps delivered, against a target of 15**, on a
  desktop. First reading of this number in the project's life.
- **Step 6** — PASS, summary with a form score.

**THE START-UP SAVING IS 643 vs 884 ms — ~240 ms, NOT the "about 1.4 s" that was
circulating.** Do not quote the old figure; it came off a months-old console.
Even 240 ms flatters the internet path, whose files almost certainly came from
the browser's own disk cache rather than the network. A third reading, 2738 ms,
was the session's FIRST bundle load and is not comparable — it paid Vite's
cold-start cost. Measured on Kd's desktop only.

**THREE DEFECTS SURFACED BY THIS RUN. ONE IS THIS CARD'S.**
1. **This card's.** The new loud warning prints `Cause: undefined` — it names the
   consequence correctly but not the reason, which was half its purpose.
   `bundledErr.message` is undefined because MediaPipe rejects with a non-Error.
   The pre-existing `gpuErr.message` line has the same flaw. Low, still fixed.
2. **Not this card's.** `Maximum update depth exceeded`, repeatedly, from the
   per-frame `setKeypointsData`. MEASURED not argued: this card changed **zero**
   lines touching that setter or the frame loop (`git diff` count = 0), and adds
   no per-frame state update. Recorded nowhere in the repo before today.
3. **Not this card's.** Finishing a workout asks for its summary **1.8 s after**
   the save starts, while the save is still in flight — a **404**, then a retry
   that succeeds. Measured in the API log: save took **34.7 s**, first summary
   read 404'd at 10.1 s, the retry returned 200. Self-healing here, but a user on
   a slow link can see the broken state first.

---

## What changed, in plain words

Every camera workout used to download about **25 MB from two websites** before it
could count a single rep. Those files now ship with the app, on your own disk.

## What you are proving

That a camera workout counts your reps **with both of those websites cut off**.

And the other way round, which matters just as much: when the app's *own* copies
are cut off, it must **say so out loud** rather than quietly going back to the
internet. That silent fallback is how this defect hid for months.

## What this does NOT claim — please don't read more into a pass

You still cannot open the app with **no internet at all**. Nothing about the page
itself is saved for offline use. This is about a **workout, once the page is
already open**. That is the honest boundary and the card does not cross it.

**Only 3 of 58 exercises are camera-graded**: Squats, Jump Squats, Chair Squats.
Use **Squats**.

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
✅ Before Vite starts, it should print:
`[pose-assets] all 5 camera assets already present and verified`

If instead it downloads five files, that is fine too — it just means they were
not on disk yet. If it **fails**, stop and paste the error; a build without
those files is the thing this card exists to prevent.

Open **http://localhost:5173** exactly. (A leftover Vite on 5173 pushes this one
to 5174, where sign-in fails silently.)

**DO NOT start `mock-ml-backend.mjs` on port 8000.** The workout loop no longer
needs it.

---

## Open the browser tools once

Press **F12**, then click the **Console** tab. That is the only tab this smoke
needs. Leave it open throughout.

> **DevTools "Network request blocking" is NOT used and must NOT be re-introduced.**
> It was this sheet's original instrument for steps 1 and 2 and it silently did
> nothing: with `localhost:5173/mediapipe/` and `localhost:5173/models/` both
> listed and enabled, the app served its own files straight through and printed
> `THE APP BUNDLE` in what was supposed to be the control. A control that cannot
> fail is not a control. The two instruments below are cruder, work at a level
> the browser cannot bypass, and both worked first time.

---

## Step 1 — the CONTROL: take the app's own copies off the disk

This step exists so that step 2's message means something. If the app printed
"came from the bundle" no matter what, step 2 would prove nothing.

**Whoever is driving the chat runs this** (the paths are gitignored, so this
leaves `git status` clean):

```
sha256sum apps/web/public/models/pose_landmarker_lite.task apps/web/public/mediapipe/wasm/*
mv apps/web/public/mediapipe/wasm apps/web/public/mediapipe/wasm__OFF
mv apps/web/public/models/pose_landmarker_lite.task apps/web/public/mediapipe/__off_pose_landmarker_lite.task
```

Keep that first hash list — it is how the restore gets proved.

**Do NOT expect a 404 in the browser.** Vite answers a missing file under
`public/` with **index.html at 200**, so MediaPipe is handed a web page where it
expects a model. That is the ORIGINAL DEFECT'S EXACT SHAPE, which makes it the
right control rather than a lucky one.

**Leave the internet ON for this step** — the app is being forced onto it.

Hard reload (**Ctrl + Shift + R**). Build a **Squats** workout, choose **Use the
camera**, press **Start**.

✅ **Expect an orange warning** containing:
> bundled pose assets unusable — this workout will need an internet connection

✅ **then a line ending:**
> MediaPipe ready in **NNNN** ms — runtime and model from **THE INTERNET (this
> workout needs a connection)**

📋 **Write down that NNNN number.** (2026-08-17 on Kd's desktop: **884 ms**.)

⚠️ **If it says THE APP BUNDLE here instead**, the files are still reachable —
stop, do not continue to step 2, and check the `mv` actually ran.

Leave the workout (back arrow is fine).

---

## Step 2 — the REAL one: put the files back and cut the internet off

**Whoever is driving the chat restores them, and PROVES the restore:**

```
mv apps/web/public/mediapipe/wasm__OFF apps/web/public/mediapipe/wasm
mv apps/web/public/mediapipe/__off_pose_landmarker_lite.task apps/web/public/models/pose_landmarker_lite.task
sha256sum -c <the list from step 1>
```

All five must report `OK`. The model is the one every landmark in this project
was measured with; a restore that is not byte-identical invalidates the card's
"nothing about how the camera judges you changed" claim.

Now, in this order — **the order matters**:

1. Hard reload (**Ctrl + Shift + R**) with the internet still **on**.
2. Build the **Squats** workout and go as far as the **Workout Setup** screen,
   where the camera preview appears. **Stop there.** Building the workout reads
   the exercise list from the server, so it has to happen while connected.
3. **Now switch the machine's Wi-Fi off** at the taskbar.
4. Tick the checklist, choose **Use the camera**, press **Start Workout**.

> **Why the Wi-Fi switch and not DevTools' "Offline" throttle.** The throttle
> intercepts localhost too, so it would also cut the Vite dev server that SERVES
> the bundled files — the test could not then tell the two sources apart. The
> adapter does not carry loopback traffic, so switching it off leaves localhost
> working and removes only the internet. That distinction is the whole reason
> this sheet originally reached for request blocking instead.

✅ **Expect NO orange warning**, and this line:
> MediaPipe ready in **NNNN** ms — runtime and model from **THE APP BUNDLE (this
> workout survives losing the network)**

📋 **Write down this number too.** (2026-08-17 on Kd's desktop: **643 ms**,
against 884 ms from the internet — about **240 ms**. The old "about 1.4 seconds"
is WRONG and must not be quoted. Do not compare against the session's very first
camera load either; that one pays Vite's cold-start cost and measured 2738 ms.)

❌ **If you see the orange warning here**, the app could not find its own files
and the card has not worked. Copy the whole line into the chat.

**Turn the Wi-Fi back on before finishing the workout**, so it can save.

---

## Step 3 — do a real set, with those websites still blocked

Stay in that workout. Do **8–10 real squats** in front of the camera.

✅ **Expect:** the rep counter climbs as it always has, and the screen does not
say the camera stopped.

❌ **If the counter does not move**, or you get handed the "count this set
yourself" button — say so. A rep counter that ignores you is a worse failure
than the one this card fixes.

> Nothing about how the camera *judges* you was changed. The model file is
> byte-for-byte the one that has been in use since July, so your squats should
> count exactly as they did last time.

---

## Step 4 — SUPERSEDED by step 2, keep for the reasoning only

This step used to be: filter the Network tab for `jsdelivr` and `googleapis` and
expect zero rows. With the adapter switched off in step 2 **the two hosts are
unreachable at the operating-system level**, which is a stronger claim than an
empty filter box — a workout that completed at all cannot have needed them.

Skip it. The reasoning it recorded still stands and is why step 2 is worded the
way it is: a *blocked* row would mean the app still tried, and would still fail
on a phone with no signal. No request at all is the bar.

---

## Step 5 — a measurement, not a pass or fail

While you are squatting, the Console prints a line roughly every 10 seconds:

```
[pose] delivered 12.4 fps to the engine (target 15, 38 frames in window)
```

📋 **Copy two or three of those lines into the chat.**

> There is nothing to pass here. This is a number nobody in this project has ever
> had: how many frames a second your machine actually delivers. The next card has
> to decide whether to switch to the heavier, more accurate pose model, and right
> now that decision would be a guess. This ends the guessing.

---

## Step 6 — finish the workout

Finish it normally. The two blocked websites have nothing to do with saving.

✅ **Expect:** the summary screen with real numbers, and **a form score** (a
percentage, not "Not scored") — because the camera counted this one.

---

## When you are done

**Switch the Wi-Fi back on** if it is still off, and confirm the five asset files
are restored and `sha256sum -c` reported `OK` for all of them. Nothing else was
changed in the browser, so there is nothing to put back there.

Tell me the step number and pass/fail for each, plus:
- the two millisecond numbers from steps 1 and 2,
- the `[pose] delivered …` lines from step 5.

If anything failed, the **exact words on the screen or in the console** matter
more than a description — the wording is what identifies which path the code took.
