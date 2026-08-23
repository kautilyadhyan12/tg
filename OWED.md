# OWED — the single list of everything outstanding

**Why this file exists.** DECISIONS.md is a diary: it records *what was decided
and why*, in the order it happened. It is excellent for "why is this like this?"
and useless for "what is still to do?" — 580 lines of prose where a deferral
recorded on day 3 is indistinguishable from one recorded yesterday.
RUNBOOK/cutover.md tracks only what BLOCKS the P2.8 cutover, so anything that
does not block it had no home at all. An audit on 2026-07-21 found two real
items owed and tracked NOWHERE (Google login; timezone capture) — one of them a
user-facing feature that had been switched off, which the CLAUDE.md
MIGRATION-STANCE no-removal rule exists specifically to prevent.

**How to use it.** Every entry says what it is, why it was deferred, who ruled
it, what unblocks it, and what it blocks. Nothing leaves this file except by
being DONE (tick it, date it, name the commit) or by an explicit Kd ruling that
it will never be built (strike it, cite the ruling — the desktop-webcam
precedent, DECISIONS 2026-07-19).

**How to keep it true.** Any card that defers something adds its line HERE in
the same commit that records the deferral in DECISIONS. A deferral recorded in
prose only is the exact failure this file was built to stop.

**THIS FILE IS UNCHANGED by the 2026-08-06 review/fix ruling (DECISIONS :5348) —
Kd said so in as many words: "owed will be there as usual, no change."** Every
deferral still gets its line here, in the same commit that defers it. `BACKLOG.md`
is a LOG of Low review findings and the commits that fixed them, not a second
deferral list — a Low finding that genuinely cannot be fixed in its round has
become a deferral and belongs HERE like anything else.

Legend: 🔴 blocks the P2.8 cutover · 🟡 needed before real users · ⚪ improvement
· ⏰ has a real-world deadline

---

## ⏰ Deadline-driven — do these on the clock, not on the queue

- [x] ⏰🔴 **Groq COACH_MODEL migration — DONE 2026-07-22, merged as PR #44**
      (merge `ad3b1ee`), ahead of the 2026-08-16 decommission of
      `llama-3.1-8b-instant`. Default flipped to `openai/gpt-oss-20b` and the
      model-specific price constants re-quoted from groq.com/pricing per Part 0
      rule 4 ($0.075/1M in, $0.30/1M out → 75_000/300_000 micro-USD); the
      discounted cached-input rate is deliberately unused (never under-count).
      `COACH_MAX_TOKENS` 800→1200 folded in by Kd ruling — the more verbose
      model truncated mid-sentence at the old cap. Fresh-chat T3, live-driven
      against real Groq. A follow-up web commit (`ca4b2cc`) added `remark-gfm`
      because the new model answers with markdown TABLES, which react-markdown
      alone rendered as pipe soup. **The key rotation it was expected to carry
      did NOT happen — its own line below.**

- [ ] 🟡 **Rotate GROQ_API_KEY.** The old key was reused for local dev with
      rotation explicitly DEFERRED, not waived — Kd's reasoning was that the zip
      carrying the old `.env` went only to Claude sessions, and he stated "I will
      rotate it later" (DECISIONS 2026-07-16). The Groq model-migration card was
      named as the natural moment (new key + new model in one visit to the Groq
      console); that card shipped on 2026-07-22 WITHOUT rotating, so the item
      would have vanished with its ticked line. Given its own line here on
      2026-07-22 rather than being lost. The P0 rule treats every secret in the
      old repo's `.env` as burned, so this is a real deferral, not hygiene.
- [x] 🟡 **Rotate the Neon database password (`DATABASE_URL`) — DONE
      2026-07-27 (Kd rotated in the Neon console; verified by query).** Exposed
      2026-07-26: a `grep` for the connection string during the XP-card smoke
      setup matched a neighbouring comment line, and the mangled value — password
      included — was printed into a Claude chat transcript in an error message.
      Same class as the two rotations above, and treated the same way rather than
      waved off because it was accidental. This one is heavier than a provider
      key: it is direct read/write access to the dev database.
      **HOW IT WAS DONE:** Neon console → Roles → `neondb_owner` → Reset
      password. Kd pasted the new value straight into `apps/api/.env` line 5 in
      the editor — deliberately NOT through the chat, since a chat transcript is
      exactly how the old one burned. Verified by connecting with the new URL and
      running `select current_user, current_database()` plus a table count:
      `neondb_owner` / `neondb` / 46 public tables. The API was restarted and
      re-listens on :3000. Grep confirmed `apps/api/.env` was the ONLY file
      holding the real secret — `.github/workflows/ci.yml` takes its URL from the
      `neon-branch` step output, and `infra/docker-compose.dev.yml` carries local
      container credentials (`aihg`/`postgres`), neither of which is this one.
      The dev branch holds only test fixtures, which is why this was 🟡 not 🔴.
- [ ] 🟡 **Rotate the GOOGLE_CLIENT_SECRET.** The secret created for the
      google-login local smoke (2026-07-24) was pasted into a Claude chat to wire
      `apps/api/.env`, so treat it as exposed (same class as GROQ above). Fine for
      local dev; before any real deployment, regenerate it in the Google Cloud
      console (Clients → "AI Home Gym Local" → + Add secret), put the new value in
      the deploy platform's secrets, and delete the old. The client ID is public
      by design; only the secret needs rotating.

## 🔴 Blocks the cutover — the old backend cannot be switched off until these exist

### Camera counting — found by Kd's smoke 2026-08-07, tracked nowhere before

Both lines are 🔴 for one reason and it is stated so a later chat can downgrade
them with a ruling rather than by opinion: **they BLOCK the camera smoke, and that
smoke gates BOTH committed cards on `web-repoint`** (the workout time + kcal v2
card and the camera-ownership ruling), which merges at P2.8. They are product
defects, not missing API surfaces. Full record: DECISIONS :6062.

- [x] 🔴 **DONE 2026-08-11** (`6fd7725` · `cd6c6a7`; T3 round 2 clean, both smoke
      runs recorded in `RUNBOOK/smoke-person-check.md`). **The pose model draws a
      skeleton on FURNITURE, and the app believes it.** Kd, in his own room: *"the camera instead of detecting my body
      sometimes detects other objects nearby like a chair, fan etc and takes its
      shape ... sometimes in taking those shape a correct angle happens then rep
      count happens"*. **Measured cause:** frame validity is 33 landmarks of
      finite numbers (`ingest.ts:44-46`) — **nothing checks the pose is a
      person**; per-landmark gate is `VIS_USABLE = 0.3`; MediaPipe runs at
      `minPoseDetectionConfidence/Presence/Tracking = 0.5` with `person_detected`
      = `landmarks.length > 0` (`usePoseDetection.js:118-120`). **This invents
      reps the user did not do — Critical/High under the :5807 amendment (a
      number on screen that is FALSE).** **UNVERIFIED and the first thing to
      test:** a knee landmark stuck on a chair leg never bends, so the bilateral
      gate (below) would block every REAL rep — the fake dots may be EATING reps,
      not only adding them, which would make this one defect the cause of both of
      Kd's complaints. **No threshold may be picked from judgement**: the card
      must MEASURE what the confidence actually reads on an empty chair versus on
      a person, in Kd's own room, before choosing a cut-off (V1).
      **STATUS 2026-08-08 — MEASURED. Kd recorded all five clips; full numbers
      at DECISIONS :6386. The blocking action is no longer his.** What the
      measurement settled, so no chat re-derives it:
      (a) **THE CHEAP FIX IS DEAD.** A chair reports **0.99** per-frame minimum
      visibility on its four torso landmarks — the same as a person. Legs shift
      but overlap hard (`me_squatting` p25 0.27 sits ON `furniture_only` median
      0.26), so any leg gate that rejects the chair also eats real squat frames.
      **No confidence cut-off separates them, and none was picked.**
      (b) **THE "EATING REPS" HYPOTHESIS ABOVE IS CONFIRMED.** Kd squatted
      steadily for 2 min with furniture in shot: his knee crossed `downAt` (100°)
      **4 times**, against **19** in the clip without furniture where he squatted
      LESS. Furniture in frame does not merely add fake reps — it destroys real
      counting, which makes this line the cause of the shallow-squat line below.
      (c) **An empty room is FINE** — 6.2% detection over the genuinely-empty
      window, vs **95.9% over 82 s** pointed at a chair and fan. The detector is
      not blind; it false-positives on chair-shaped objects and then TRACKS them.
      (d) **The lever is JITTER**, not confidence: the fake skeleton's body
      centre moves ~3× a squatting person and ~7× a standing one. **Its threshold
      is deliberately NOT picked — one chair, one room.** More furniture must be
      recorded, or the distributions go to Kd. This line's "no threshold from
      judgement" rule is UNCHANGED and still binds.
      **STATUS 2026-08-09 — the jitter finding was UNREPRODUCIBLE and now is
      not.** Those figures came from a throwaway script that no longer exists
      (`grep -rniE "jitter|bodyCentre|centroidShift" packages apps tools` →
      only unrelated hits), so the card's headline lever rested on numbers
      nobody could re-derive — :5199's class exactly. `packages/engine/scripts/
      discriminators.ts` is that measurement, committed, unit-tested and
      mutation-audited (11/11 RED), and `measure-pose.ts` grew section 4 (per-
      clip distributions) and section 5 (separation + operating points with the
      error each costs on BOTH sides). **Three deliberate departures from
      :6386's numbers, so they will NOT match and that is not drift:** rates are
      per SECOND not per frame (browser frames arrive irregularly, and the gate
      will too); pairs more than 500 ms apart are SKIPPED (measuring across a
      lost pose measures the gap — `empty_room`'s high figure may be that
      artefact); and body-centre/torso-length are defined in the file because
      the deleted script's definitions are unrecoverable.
      Three signals join jitter, all landmark-only and all free: bone-length
      stretch, left/right limb asymmetry, and motion incoherence (the spread of
      the 33 individual displacements — a real body moves as one piece, and
      centre drift alone can be fooled by someone genuinely moving).
      **NOTHING IS MEASURED YET on real furniture.** Kd runs
      `RUNBOOK/measure-camera-discriminators.md` — one command over the ten
      files already on his Desktop, no recording. **No cut-off may be picked
      from that run either**: it is still one chair in one room. What it can
      settle is whether any signal is worth recording more furniture for.
      **THIS IS NOT A CAMERA-STAGE FIX and the "needs fresh recordings"
      limitation above does not bite it.** That limit is true of anything that
      changes what MediaPipe OUTPUTS (settings, model); a bridge-layer gate
      consumes the landmark output the clips already contain. A later chat must
      not read the limitation so broadly that it shelves the one lever testable
      on data in hand.
      **STATUS 2026-08-10 (b) — THE CUT-OFF IS RULED: `bone_stretch > 0.923`,
      that signal alone (Kd, DECISIONS :7037).** Measured on all 13 clips and
      replayed through the real engine: **11 invented reps → 3, all 66 reps on
      the six clips containing Kd still counted.** `motion_incoherence` is OUT —
      equal separation on paper, loses a real rep in both sessions.
      **"No threshold from judgement" is now SATISFIED for this line, not
      waived.** It does not reach zero and never claimed to; the settings sweep
      stays in reserve. **The line still does NOT tick: nothing is wired.**
      **STATUS 2026-08-10 (d) — THE SMOKE PASSED: ZERO reps from the chair, over
      two minutes, in Kd's own room** (DECISIONS :7222). His own squats still
      counted; both sets stayed camera-graded with real form scores. **The line
      STILL does not tick — T3 is unrun** (:4718 F4). The smoke also surfaced a
      SEPARATE Critical/High that is not this line's: calories bill a mid-set
      absence as vigorous exercise — its own line above.
      **STATUS 2026-08-10 (e) — T3 ROUND 1 RAN AND FOUND TWO CRITICAL/HIGH,
      BOTH FIXED. The line STILL does not tick: the diff-only re-review is
      unrun** (:5348 rule 2). Both were the screen or the number being wrong,
      neither touched Kd's cut-off, and the ruled table came out BETTER on both
      sides. (1) **The panel said "Not counting" while it was counting** — the
      sentence is held for up to fourteen frames after blocking stops so it can
      be read, but counting resumes on the FIRST clean frame, so the count rose
      and the rep beep sounded underneath it; measured on FOUR of the six clips
      containing Kd. There are now two sentences, present tense while blocking
      and past tense after. (2) **The cut-off meant something different on every
      machine.** `bone_stretch` is a rate per second and `FEED_INTERVAL_MS` is
      only a FLOOR — Kd's laptop achieved a pooled median 82.1 ms over 12,075
      pairs, a quicker machine reaches 67 — so the shipped gate read ~1.22×
      higher on faster hardware and, replayed at that cadence, **lost a real rep
      on two of the six clips of Kd**: the exact harm `motion_incoherence` was
      rejected for (:7062), arriving on hardware nobody owns yet. The ruled
      cadence is now part of the ruled configuration (`nominalDtMs: 82`), so the
      verdict is a function of the FRAMES and not the machine.
      **THE RULED TABLE MOVED, IN KD'S FAVOUR ON BOTH SIDES, and he was told:**
      invented reps 11 → **2** (the ruling's table said 3), all **66** of his own
      reps still counted, and person frames silenced **4.5% → 1.8%**. Re-measured
      through the committed instrument at the shipped setting
      (`measure-pose.ts --gate "bone_stretch>0.923" --window 15 --nominal-dt 82`,
      which gained that flag in the same commit — without it the script could no
      longer reproduce what ships). web 585/585 · engine 190/190 · 23 mutants,
      22 RED, 1 ALIVE (PG14, pre-existing, reason recorded), 0 never ran,
      restores sha256-verified. Eight Low findings fixed, logged in `BACKLOG.md`;
      the one deferral has its own line below.
      **STATUS 2026-08-11 (f) — THE LAST BLOCKER IS DISCHARGED AND THIS LINE
      TICKS.** The diff-only re-review named in (e) ran and found **ZERO
      Critical/High**, so the packet ships (:5348 rule 1). Two Low findings, both
      fixed in `6fd7725` and logged as L9/L10 in `BACKLOG.md`, both comment-only:
      the burst fixture's comment mis-stated how the fixture fails, and
      `nominalDtMs` is applied to all three rate signals while being physically
      right for one — signposted at both sites rather than split per signal,
      because splitting it moves readings the ruled table was measured against.
      **The round also audited its own instruments**, which is where its value
      was: every control on both new regression fixtures was proven to go RED
      when the fixture drifts off the boundary (measured — shake 0.02 blocks
      nothing, 0.08 leaves only the 8 warm-up frames, a burst 20 frames later
      puts no rep inside the message, a burst 26 frames earlier costs a rep), and
      a mutant deleting one line of the tab-resume fix turns its test red. **At
      shake 0.02 the cadence test's headline assertion passes vacuously** — its
      boundary controls are the only thing holding that test up, which is exactly
      the trap round 1 fell into twice.
      **WHAT THIS LINE DOES NOT CARRY WITH IT**, so nothing is quietly closed by
      this tick: the escape hatch for a user the check is wrong about (its own ⚪
      line below) and the calorie defect the 2026-08-10 smoke surfaced (its own 🔴
      line below) are SEPARATE and both still open.
      **STATUS 2026-08-10 (c) — IT IS WIRED, AND THE SCREEN SAYS SO. The line
      still does NOT tick: the SMOKE WAS UNRUN at the time of writing.** (DECISIONS :7104.) Every frame
      the app feeds the engine goes through the check first at the ruled setting;
      a blocked frame reaches the engine with no landmarks, and after three
      blocked frames in a row the camera panel says *"Not counting — the camera
      isn't sure it's looking at you. Step into full view."*, clearing after
      fifteen clean ones. **This is the first change in the whole camera card a
      user can see.** web 578/578 · `vite build` ✓ · 17 mutants, 16 RED, 1 ALIVE
      with its reason. **What this line still needs before it ticks:**
      `RUNBOOK/smoke-person-check.md` run by Kd (chair alone in shot must stop
      counting AND Kd squatting must still count — either half alone proves
      nothing), and the T3 review. **Three invented reps on `chair_A` survive by
      design and are not a smoke failure** — the settings sweep stays in reserve.
      **STATUS 2026-08-10 (a) — THE GATE EXISTS BUT IS WIRED TO NOTHING, so this
      line does NOT tick.** `packages/engine/src/scene/personGate.ts` is the
      arithmetic that asks "does this move like a body?", committed with 190/190
      engine tests and an 18/18-RED mutation sweep (DECISIONS :6959). It chooses
      nothing: signal, cut-off and mode are arguments. **`apps/web` is untouched,
      so a user still sees the invented chair reps** — the fix is not delivered
      until step 3 wires it in AND the screen says so when it blocks (:5807).
      **The "Kd must run the measurement" blocker in the paragraphs above is NOT
      REAL and a later chat must not repeat it**: both clip sets sit on the dev
      machine (`C:\Users\kautilya\Desktop\traces` and `...\traces2`), so the gate
      simulation (`measure-pose.ts --gate`) is a command a chat runs unattended.
      **The no-threshold-from-judgement rule is UNCHANGED and still binds** — the
      run produces a table of what each candidate costs on BOTH sides, and Kd
      rules the number on it.
      (e) **KD RULING 2026-08-08 — his object-detector proposal is DROPPED on
      cost** (a second model against Part 6 §3.4/§3.5 budgets). Deferred, not
      struck: it returns if the free levers fail, at ~1 Hz, never per frame.
      **NOT measurable from the recorded clips:** they hold landmark OUTPUT, not
      video, so every candidate camera-stage fix needs FRESH recordings that
      capture video too. That is the instrument's main limit as built.
- [x] 🔴 **DONE 2026-08-15 — CALORIES BILL A MID-SET ABSENCE AS VIGOROUS
      EXERCISE.** Closed on all three gates: the engine half (`cd6c6a7`,
      DECISIONS :7404) and the API half (`faa7f06`, :7730) built it, the browser
      SMOKE passed on Kd's own three workouts with the claim carried by the
      STORED ROWS (:7929), and the fresh-chat **T3 round 1 found ZERO
      Critical/High** (:7974) — so under :5348 rule 1 the packet ships and no
      further round is owed. Its four Low findings are fixed in the closing
      commit and logged as L19–L22 in `BACKLOG.md`; the one that needed no code
      became its own OWED line below (the v1/v3 selection asymmetry).
      **Full history kept below rather than summarised — this line took five
      weeks and four measured design reversals, and the reasoning is the part a
      later chat will need.**

      **WAS: CALORIES BILL A MID-SET ABSENCE AS VIGOROUS EXERCISE — one rep's
      clock swallows the whole gap.** Found by **Kd's instinct** on the
      person-check smoke, 2026-08-10: 14 reps over a 2m41s workout reported
      **22 kcal**, and he asked whether that could be right. It is not.
      **MEASURED, not reasoned** (`kcalPointForSetsV2`, `calories.ts:93-97`):
      rep time is `reps × tempoMsAvg` capped at the SET SPAN, and his set 1
      reported `tempoMsAvg` of **21,267 ms — 21 seconds per squat**. So
      **171.7 s were billed at the squat MET inside a workout whose timer ran
      161.0 s**: more vigorous exercise than the workout lasted. Honest figure is
      roughly half.
      **THE CAUSE IS IN THE ENGINE, and it is reproducible** (`fsm.ts:167`,
      `cycleStartT ??= t`): a rep's clock starts when the metric LEAVES THE TOP
      and is cleared only by a completed rep, while a null metric HOLDS
      everything (`fsm.ts:106-115`). So a user who leaves the dead zone and then
      stops being measurable — walks out of shot, rests without pausing, is
      occluded, or **is silenced by the person check** — has that entire absence
      charged to the next rep. Swept over the golden squat with a 120 s absence
      inserted at each frame: **60 of 108 start points produce a single rep of
      123,100 ms and a `tempoMsAvg` of 63,000 ms.**
      **NOT CAUSED BY THE PERSON CHECK, and the check makes it far more likely.**
      The mechanism predates it and fires on any long mid-set gap; what the check
      changes is that long in-set silences are now the DESIGNED behaviour rather
      than an accident. Before it, invented chair reps kept resetting the clock,
      which masked the inflation.
      **A HINT FOR WHOEVER FIXES IT, not a design:** the arithmetic already had
      the evidence that it had gone wrong — `chargedMetMs` (171.7 s) exceeded
      `session.durationSeconds` (161 s), which the code notices only to floor
      idle at zero. Rep time that exceeds the on-screen timer is not a number to
      clamp quietly; it is a contradiction. **Its own card, with Kd's approval
      before any code (Part I §2.5), and R9.5 — a failing test first.**
      **Deferred out of the person-check card deliberately** (R1.1): the defect
      lives in `calories.ts` and the engine's rep timing, neither of which that
      card touches. DECISIONS :7104 records the smoke that found it.
      **STATUS 2026-08-11 — THE FAILING TEST EXISTS AND IS COMMITTED RED. THE FIX
      IS NOT WRITTEN.** `packages/engine/test/repTimingAbsence.test.ts` reproduces
      it from this package's OWN trace (`traces/parity/squat_sideview2goodform
      .jsonl`, 85 frames), splicing a 120 s absence in as frames with no
      keypoints — production, not a convenience: `sessionController.js` hands a
      blocked frame to the engine as `feed([], tMs)`. **Measured, swept over every
      frame boundary: 70 of 84 positions bill unwatched time as exercise; the
      worst charges 127,000 ms at the squat MET when the engine watched 8,400 ms;
      one single rep is credited 123,600 ms.** The clean-control test passes, so
      the suite is not simply broken. **DO NOT MERGE while this test is red.**
      **THE PARITY RISK IS MEASURED AND IT IS ZERO.** All ten traces under
      `test/traces/{parity,regression}` scanned: **every one has ZERO frames the
      engine cannot use, and the largest gap between consecutive frames is
      112 ms.** So a fix keyed to the engine's existing lost-sight rule
      (`INVALID_STREAK_FOR_VISIBILITY = 3`, §3.1) cannot alter any existing trace —
      the golden/parity gates stay green by construction, not by luck.
      **THE DESIGN IS AGREED WITH KD AND HAS TWO PARTS, because he found the flaw
      in the one-part version.** (1) On losing sight, the open cycle's clock and
      ROM bookkeeping re-arm, so the interrupted rep is timed only from when the
      user was visible again — never the absence. It STILL COUNTS; no rep is lost,
      which was his first question. (2) **That partial duration is EXCLUDED from
      `tempoMsAvg`.** He asked what happens to reps completed before the absence,
      and the answer exposed part 2: calories bill `reps × tempoMsAvg`, so a
      half-measured rep in the average drags it down and UNDER-charges every rep in
      the set — trading an over-count for a quieter under-count. Excluding it bills
      the interrupted rep at the rate of the reps actually watched. **Neither part
      changes a payload shape**, so §2.4's byte-match gate and stored history are
      untouched.
      **TWO TRAPS FOUND BY READING, NEITHER COVERED BY A TEST YET:** clearing
      `cycleStartT` alone makes `durationMs` fall to 0 (`fsm.ts`: `cycleStartT
      !== null ? t - cycleStartT : 0`) — a fabricated zero replacing a fabricated
      123 s; and `cycleMinT`/`cycleMinLastT` predate the absence, so re-arming the
      start without them yields a NEGATIVE `phaseTimings.descent`.
      **STATUS 2026-08-11 (evening) — THE ENGINE HALF IS DONE AND THE TEST IS
      GREEN; THE LINE DOES NOT TICK.** Both parts of the agreed design shipped in
      `fsm.ts` + `session.ts`, and BOTH traps above are now covered by a test and
      by a mutant each (6 mutants, 6 RED, restores sha256-verified). Counting is
      provably unmoved: 2 reps at all 84 absence positions, before and after.
      **The occlusion path was added on Kd's approval after being measured** —
      every frame valid, legs unmeasurable, **127,200 ms billed against 8,400 ms
      watched**, the same size as the absence and invisible to the committed
      sweep. Full record: DECISIONS :7404.
      **STATUS 2026-08-14 — T3 ROUND 1 HAS RUN: ONE Critical/High, FIXED. The
      line does NOT tick.** (DECISIONS :7487.) A rep can be watched for
      literally NO time — the clock re-pins on the first usable frame and the
      user returns already standing, so the rep closes on that same frame — and
      the all-interrupted fallback averaged that zero in: measured on the one-rep
      clip, **reps 1, `tempoMsAvg` 0** against 3,400 ms clean, on both paths. The
      server reads `reps × tempoMsAvg` as exercise time, so a set containing a
      real squat was billed as if nobody moved. **Fixed as Kd approved it in
      plain words: a rep watched for no time is not a measurement, so it is
      dropped from the average; the reps that WERE part-measured still set the
      rate.** **The review's own proposed fix (`null`) was MEASURED AND
      REJECTED** — on a set shaped like Kd's smoke, honest 10 kcal · today 8 ·
      null 6. engine 203/203 · 9 mutants 9 RED 0 ALIVE (1 retired with its
      reason) · Low ×3 as L12–L14 in `BACKLOG.md`.
      **STATUS 2026-08-14 (evening) — THE API HALF IS BUILT AND ALL THREE ITEMS
      BELOW ARE DISCHARGED IN CODE. THE LINE STILL DOES NOT TICK: the browser
      SMOKE and the fresh-chat T3 are both unrun.** (DECISIONS :7730.) **Kd ruled
      the design in plain words** — stop guessing a rate from half-seen reps,
      charge the time the camera actually watched, and charge nothing for the time
      it did not. `SetSummary` gains an OPTIONAL `watchedMs` (§2.4's document
      still parses and round-trips, so Part 2 §10's byte-match gate holds by
      construction), migration `0010_set_watched_ms` stores it NULLABLE (null =
      nobody told us, which is not zero), and `kcalPointForSetsV3` reads it.
      **This SUPERSEDES the 2026-08-11 clause "the part-measured reps still set
      the rate"**, which was never a measurement — it was a workaround for the
      missing number, and it was the inversion item (3) names.
      **AND IT FOUND THE NEXT ONE, MEASURED: a mid-set PAUSE is billed as
      exercise, and `watchedMs` cannot see it** — own 🔴 line below, because a
      pause feeds NO frames at all, so the engine cannot tell it from a slow
      camera. Pre-existing: v2 bills the identical 127,000 ms.
      engine 208/208 · shared 48/48 · api 443 of 444 · web 585/585. (The one red is
      the pre-existing `db.migration.test.ts` timeout flake, whose own line below
      is widened today; it is not in this diff.)

      **WHAT IS STILL OWED ON THIS LINE, and it is now THREE things:**
      (1) **the API half** — `kcalPointForSetsV2` still bills an unwatched
      stretch as IDLE at `REST_MET` rather than as nothing, because the on-screen
      timer does not stop when the camera stops seeing (a 2-minute absence is
      ~4 kcal at 70 kg instead of ~14, better but not right); its own step, its
      own tests. (2) **the DIFF-ONLY re-review** (:5348 rule 2) — round 1's
      findings are fixed and unreviewed. (3) **NEW, found by round 1 and not
      closed by it: an all-interrupted set still bills ~20% low**, because
      half-measured reps set the rate at all — **the one place Kd's ruled part 2
      is inverted**, since that ruling exists precisely so a half-measured rep
      cannot set the rate. Closing it honestly needs the engine to report **how
      much of the set it actually WATCHED**, which is a new payload field (§2.4
      byte-match gate + migration), so it belongs WITH the API half in (1) and
      not in a fix round (:5348 rule 6). **The floor is `> 0` because that is
      what Kd ruled in words** ("watched for no time at all"); a 100 ms remainder
      of a 3,400 ms rep is barely more of a measurement, and any higher floor is
      a NUMBER that R0.2 forbids a chat from picking — it goes to Kd on a table,
      the shape of :7037.
- [x] 🔴 **DONE 2026-08-15 — A MID-SET PAUSE IS BILLED AS SQUATTING.** Built
      exactly as the entry below describes (`8c2d204`, DECISIONS :7863): the
      client tells the engine the feed stopped, which routes into the same
      `loseSight()` path both blindness kinds already take. **SMOKE PASSED**
      (:7929) — and the stored rows, not Kd's word, are what carry it: the
      paused workout's sets LASTED 96 s and 94 s with the camera credited 30 s
      and 31 s, so ~64 s per set was correctly thrown away. **T3 round 1 found
      ZERO Critical/High** (:7974). Ticked together with the line above, which
      is the same packet.

      **WAS: A MID-SET PAUSE IS BILLED AS SQUATTING — and the watched-time field
      cannot see it.** **Found and MEASURED 2026-08-14 while building the API
      half above** (DECISIONS :7730), on the promise made to Kd in that card's
      plan that the pause question would be checked rather than assumed.
      **THE CAUSE, and it is why `watchedMs` does not close it:** pressing pause
      tears the pose feed down (`ActiveWorkout.jsx:267`, `enabled: !paused`), so
      **no frames arrive at all** — not blank ones, not unusable ones — while the
      timestamps inside the frames that resume have advanced by the pause length.
      Every mechanism this card and the two before it built keys on FRAMES THE
      ENGINE RECEIVED AND COULD NOT USE (§3.1's count of three). A pause produces
      one long inter-frame gap, which is indistinguishable here from a slow
      camera, so it lands INSIDE watched time.
      **MEASURED on this package's own squat clip, a 120 s pause swept across
      every frame boundary: 70 of 84 positions report `watchedMs` 128,400 ms
      against 8,400 ms really watched, `tempoMsAvg` 63,500, and bill 127,000 ms
      at the squat MET — 14.82 kcal where the truth is 0.98.**
      **PRE-EXISTING, NOT INTRODUCED: `kcalPointForSetsV2` bills the identical
      127,000 ms on the same input** — asserted by a test, so the claim is not
      just prose. What the API half adds is the CLAMP: the on-screen timer is the
      one measurement that stops on pause, and v3 spends exercise time against it
      as a budget, which brings the measured case to 1 kcal. **A clamp is not a
      fix** (:7222's own warning — rep time exceeding the timer is a
      contradiction, not a number to quietly trim), and it does nothing at all for
      a client that sends no timer.
      **THE REAL FIX NEEDS NO NEW NUMBER: the client knows why the frames
      stopped, and the engine does not.** The web bridge should tell the session
      it has stopped feeding, which routes into the SAME `loseSight()` path both
      blindness kinds already use. That is a web + engine card with its own
      measurement, not a fix round (:5348 rule 6). **Its own smoke matters more
      than usual**: pausing is a thing a user does deliberately, so the wrong
      number here is one they can reproduce.
      **STATUS 2026-08-14 (same evening) — BUILT EXACTLY AS DESCRIBED ABOVE, and
      the line does NOT tick.** (DECISIONS :7863.) Kd read the measurement and
      ruled: *"i understand the pause problem no need to see the problem with my
      own eyes just solve the problem."* `EngineSession` gained `loseSight()`,
      `sessionController.resetScene()` became `framesResumed()` and now moves the
      CLOCK as well as the scene check, and both resume sites in
      `usePoseDetection` call it. engine 212/212 · web 586/586 · 4 mutants 4 RED
      0 ALIVE. **WHY IT STILL DOES NOT TICK: he declined the DEMONSTRATION of the
      defect, which is not the same as waiving the browser smoke** — that rule is
      his (2026-07-16) and only he can lift it. A chat may not widen a ruling on
      his behalf; the precedent for ticking on a chat's own reading is :5034 and
      :4718 F4, both reverted.
      **SMOKE RUN AND PASSED 2026-08-14 (DECISIONS :7929) — the line still does
      not tick, because T3 is unrun.** Kd's three browser workouts, verified in
      the stored rows rather than on his word: **the paused workout's sets lasted
      96 s and 94 s with the camera credited 30 s and 31 s**, so ~64 s per set was
      correctly thrown away; the clean workout shows watched ≈ set length. All
      three stamped `kcal_calc_version` 3.
- [ ] 🟡 **THE GOLDEN-TRACE GATE CANNOT SEE REP TIMING AT ALL.** `assertTrace`
      (`packages/engine/src/harness/assert.ts`) asserts rep count, fault
      multiset, scores, hold time and phase sequence — and **nothing about
      `durationMs` or `tempoMsAvg`**. So §7.4, the mechanism that is supposed to
      make this engine safe to change, is structurally blind to the entire
      subject of the two rep-timing cards above: every timing guarantee rests on
      one hand-written test file, and a future change that silently doubles every
      rep's reported duration replays all ten traces GREEN. **Pre-existing — not
      introduced by either card**, and Low rather than 🔴 because nothing on
      screen is wrong today. **Deferred out of the T3 fix round deliberately**
      (:5348 rule 6): adding timing to the assertion layer means every golden
      trace must declare its expected timings, which is a card with a recording
      pass, not a fix. Found by T3 round 1 of the rep-timing card as its Low-3;
      logged as L14 in `BACKLOG.md`; DECISIONS :7487.

- [ ] 🟡 **WHEN GYMS CAN PAY, THE REMOVAL CARD MUST NAME WHAT ACTUALLY CHANGED —
      "You keep the free app" will be TRUE and INCOMPLETE.** Created 2026-08-20,
      **Kd's observation**: *"they keep the free app means there will be
      constraints on meal scan and running men."* He is right, and the gap is
      measured rather than estimated (`db/seed.ts`, the two canonical
      entitlements blocks):

      | | Free | Pro (what a paying gym grants) |
      |---|---|---|
      | Meal scans | **2 / day** | 8 / day |
      | Running routes | **2 / month** | 5 / day |
      | Coach questions | **5 / month** | 30 / day |
      | Exercises | Tier 1 only | all |
      | History | 90 days | unlimited |
      | Global leaderboards | no | yes |
      | Share images | watermarked | clean |

      Running is the brutal one: **2 a month against 5 a day is a 75× drop**, and
      a person who never hit a limit would meet one on their third route.
      **Why the card does NOT say this TODAY, and why saying it would be a
      defect:** no gym has ever paid (nothing inserts into `subscriptions`), so a
      removed member was already on free and **nothing changes for them**.
      Printing "your scans drop to 2 a day" would be the same class of untruth as
      the clause T3 round 2 just deleted (:12731 L2-1) — a screen describing a
      loss that did not happen. **The fix belongs with billing**: the card should
      name the drop only when the server can see there WAS one, comparing the
      person's entitlements before and after. **Do not hard-code the numbers into
      the client** (:1110's shape — the server sends, the client renders).
      Ties to the same card as the removal-reason column below.
- [ ] ⚪ **`gym_members` CANNOT SAY WHY A MEMBERSHIP ENDED, so a person who
      deleted their own account is told a GYM removed them.** Created 2026-08-20
      (DECISIONS :12731, T3 round 2 L2-2). The DPDP Day-0 cascade closes
      memberships when somebody deletes their own account, and `restoreUser`
      brings the account back while **deliberately leaving those memberships
      closed** (P2.2 T3 finding 4 — auto-reopen could exceed seat caps). Both
      windows are 14 days (`DPDP_RETENTION_DAYS`, `DECIDED_VISIBLE_DAYS`), so
      they coincide exactly. **Nothing user-visible is FALSE today** — "You're no
      longer a member of X" is true however it ended — which is why round 2 fixed
      the misleading COMMENT and not the code. **The sharp edge, recorded rather
      than fixed:** an owner who deletes and restores their account reads "You're
      no longer a member of {their own gym}" while the console still lists them
      as its owner. **The durable fix is a `reason` column on `gym_members`** so
      the two endings can be worded differently; **not invented in a fix round**
      (R0.2), and it needs a migration. Belongs with whatever card revisits
      account restore at P3.10.
- [ ] ⚪ **THE `/orgs/mine` SNAPSHOT HAS NO TEST.** Created 2026-08-20 (DECISIONS
      :12731, T3 round 2 L2-4). The two reads now run inside one `sql.begin`, so
      a removal committing between them can no longer produce a response where
      the gym is in neither list (the exact silence :12660 exists to end) or in
      both. **The fix is in; the guarantee is unproven.** Reproducing it needs a
      commit interleaved between two statements inside a transaction, and a fake
      would assert nothing — so no test was written rather than a green one that
      proves nothing (the class :12731's own standing lesson is about). Worth
      closing if this repo ever grows a two-connection interleaving harness; the
      seat-race tests drive two separate clients and are the nearest precedent.
- [ ] ⚪ **CONFIRM STRIPE IS ACTUALLY AVAILABLE TO THE ENTITY THAT WILL HOLD THE
      ACCOUNT, BEFORE P3.5 STARTS.** Created 2026-08-20 (DECISIONS :12600).
      **Kd RULED Stripe in** — *"stripe need to be used for payment men"* — which
      confirms `05-part5-billing.md` §4 and `CLAUDE.md` P3.5 rather than changing
      them. What is owed is not a decision but a FACT CHECK. An outside chat
      claimed new Stripe signups are effectively closed to India-based founders
      without a US entity; **that claim is UNVERIFIED — it came from a chat with
      no source read and this repo has never checked it.** If it is true it is
      discovered at P3.5, when the international book is being built, which is
      the worst moment to find it. **The check is cheap and the failure is
      expensive**, so it happens BEFORE that card opens. **If Stripe turns out to
      be closed, that is a SPEC GAP for Kd** (Part 5 §4 names the provider) —
      **never a chat's silent substitution of another provider or a
      Merchant-of-Record.** Razorpay already covers the India consumer and org
      books (P3.4) and is unaffected either way. Ticks when the answer is
      recorded, whichever way it goes.

- [ ] ⚪ **A PAYLOAD THAT REPORTS WATCHED TIME BUT NO REST TIME IS PRICED BY v1,
      WHICH IGNORES WATCHED TIME.** Created 2026-08-15 by T3 round 1 of the
      rep-timing packet (its Low-3; logged as L21 in `BACKLOG.md`).
      `service.ts:85` selects the formula on `restSeconds` FIRST and only then
      asks whether any set reported `watchedMs`, so a payload carrying the second
      field without the first falls to `kcalPointForSets` — the v1 formula, which
      has no parameter for watched time at all. **This is a missed upgrade, never
      a wrong number**: the row is still stamped `kcal_calc_version` 1, so it
      remains explicable from its own fields, which is the property the
      payload-shape rule exists to hold (:5906).
      **NOT REACHABLE TODAY, verified rather than assumed:** `ActiveWorkout.jsx`
      sends `durationSeconds` and `restSeconds` unconditionally alongside the
      sets (`:1074-1075`, read 2026-08-15), so no shipped client can produce the
      shape. **The plausible producer is the P5 mobile client**, which will build
      its own payload from the SQLite mirror and has no reason to inherit the
      web's field ordering.
      **NOT FIXED THIS ROUND deliberately** (:5348 rule 6 keeps a fix round to
      the findings Kd approved, and the fix is a ruling about selection order,
      not a typo): the honest options are to make v3 selectable on `watchedMs`
      alone, or to reject the shape at the parse boundary, and choosing between
      them is a decision about what a payload is allowed to omit. ⚪ because
      nothing today can reach it. **Whoever writes the mobile sync path must
      resolve this BEFORE the first payload ships**, or the field will be sent
      and silently ignored.

- [ ] 🔴 **A REST TAKEN IN FULL VIEW IS BILLED AS SQUATTING — if the knees are
      slightly bent.** **Found by Kd's question on 2026-08-11**, one day after his
      instinct found the absence defect above: he asked what happens when a user
      does a rep, rests a few seconds without leaving the camera, then does the
      next one. **MEASURED, not reasoned** (this package's own squat clip, a rest
      spliced in after rep 1):

      | resting posture | knee | 10 s rest | 60 s rest |
      |---|---|---|---|
      | upright | 178.8° | costs nothing | costs nothing |
      | knees slightly bent | 159.3° | all 10 s billed at the squat MET | all 60 s billed; rep 2 reported as **63,931 ms** |

      **Both are "standing still" to the person doing it** — nobody can see 20°
      of knee bend, and the app's number turns on which side of an invisible line
      a resting knee sits. **THE CAUSE IS THE SAME ONE LINE as the absence defect
      above** (`fsm.ts`: `cycleStartT ??= t` arms on the first frame at or below
      `upAt` and is cleared only by a completed rep) — one window with two entry
      points, which is why the 2026-08-11 fix cannot reach it: nobody is ever
      lost, every frame is usable. **IT FITS KD'S ORIGINAL 21,267 ms PER SQUAT
      BETTER THAN THE ABSENCE DOES** — a 15–20 s rest between reps produces
      exactly that — but **the stored row cannot say which occurred** (it holds
      the final count, not the count over time), so this is recorded as a FIT and
      never as a cause.
      **WHY IT IS ITS OWN CARD AND NOT A PATCH: it needs a NUMBER that does not
      exist.** Separating "resting still" from "descending" is a stillness
      judgement; R0.2 forbids inventing the threshold, and §3.5's C3 precedent
      (DECISIONS 2026-07-07) already rules that a stillness threshold is
      definition-declared with NO engine default. So the card is: measure
      candidates on Kd's real clips, put a table showing the cost on BOTH sides
      to him, he rules — the shape of the camera cut-off ruling (:7037).
      **Two cheap wrong answers, both rejected before this line was written:**
      re-arming on a return to the top never fires (a soft-knee rest never goes
      back above 160), and re-arming while the metric is not descending would cut
      the real descent out of every rep's duration, which §3.6 defines as part of
      it. **Kd ruled the split on 2026-08-11** (land the absence half, take this
      as its own card). DECISIONS :7404 records the measurement and the ruling.
      **STATUS 2026-08-15 — THE CARD IS STARTED AND BLOCKED ON A RECORDING, NOT
      ON A RULING. Do NOT re-run the measurement; it has been done.** The
      instrument exists and is committed (`packages/engine/scripts/measure-rest.ts`,
      typecheck+lint clean, and it ABORTS if declaring `stillness` moves the rep
      count, so it cannot quietly measure a different engine from the shipped
      one). Measured across the seven clips containing Kd: **none of them
      contains a rest.** `me_standing` is UPRIGHT standing — 1 frame of 1,268 sits
      at or below `upAt` — and the armed-not-repping stretches in every clean clip
      are the ~0.2 s gaps BETWEEN reps, 8.5 s in total across six clips.
      **THE TRAP, AND IT IS THE REASON THIS LINE SAYS "DO NOT RE-RUN":** priced
      over all seven clips the table looks convincing — a cut-off costing 1% of
      real-rep frames removes 9.0 s of 20.8 s. **12.4 s of that 20.8 s is
      `me_and_furniture` ALONE**, the clip where the model draws the skeleton on
      the chair (:6386), so those are not Kd's knees. Re-priced on the six clean
      clips the same cut-off removes **0.0 s of 8.5 s**. A chat that runs the
      instrument on everything and reads row 3 will hand Kd a confident table
      built on furniture — :7037's "separation is not the outcome", one card over.
      **WHAT UNBLOCKS IT:** `RUNBOOK/record-rest-clips.md` (written, committed,
      unrun) — two ~2-minute clips, `rest_natural` and `rest_upright`, whose three
      load-bearing instructions are that Kd must NOT pause, NOT leave the frame and
      NOT end the set during the rest, since all three are already fixed and each
      would hide the defect. **Kd deferred the recording on 2026-08-15** ("i think
      it will be done later lets go to the next thing") — deferred, not declined.
- [ ] ⚪ **A user the person check is WRONG about cannot take over the set.**
      "Count this set myself" is offered only on a frame GAP or a camera error
      (`ActiveWorkout.jsx`), and a blocked frame is not a gap — frames keep
      arriving, the check keeps refusing them, and the button never appears. So
      the one person the check has misjudged has no way out of it.
      **Deferred, not dismissed, and the severity is honest:** measured on Kd's
      own clips the worst run on a person clip is 18 frames (~1.5 s), which is
      an annoyance rather than a lost workout, and the frame-rate fix in the
      same commit cuts the silencing of a real user from 4.5% to 1.8%. It is
      recorded because it is the ESCALATION PATH for that defect — if the
      check is ever wrong for longer, this is what turns it from a pause into a
      dead set. Found by the T3 review of the person-check card (its Low-8);
      out of scope for a fix round under :5348 rule 6, which keeps a round to
      the findings Kd approved.
      **The no-removal rule is NOT engaged** — nothing is being hidden; this
      is a button that needs one more reason to appear.

- [ ] 🔴 **A squat too shallow to count says NOTHING — silence by
      construction.** Kd: *"when i do proper squat even then it does not count ...
      what would a user be thinking doing multiple correct squat but not being
      counted"*. **Measured cause:** `evaluateFrame` skips rep-scoped rules
      (`faults.ts:252-258`) and `shallow_depth` is `perRep: true`, so the only
      message that would say "go deeper" is evaluated **at rep completion** — a
      squat that never completes a rep can never trigger it. **KD RULING
      2026-08-07: the depth number STAYS** (100° down / 160° up, `squat.json`);
      he was offered a loosening proposal and chose the message instead. So the
      fix is a live cue, and the 2026-07-10 precedent is the shape to follow —
      the "cannot see your legs" cue was added in the WEB BRIDGE, not the engine,
      because the engine was already right to refuse to count and only the
      presentation lied. **Do not re-derive or widen any ported constant (R5.4).**
      **Second-order and NOT in this line's scope:** the bilateral gate means one
      knee that never bends blocks every rep (`fsm.ts:119-126`); whether the cue
      must also explain THAT depends on what the furniture line above measures.
      **STATUS 2026-08-08 — MEASURED, and this line is now DOWNSTREAM of the
      furniture line** (DECISIONS :6386). Kd's *"i do proper squat and it does not
      count"* was reproduced and its cause is NOT depth: with furniture in shot
      his knee crossed 100° only 4 times in 2 minutes of steady squatting, vs 19
      times in the clip without it. **The squats were deep enough; the app was
      watching a chair.** So the cue this line owes is still owed — a genuinely
      shallow squat must still say something — but **fixing the pose input comes
      first, and building the cue before it would attach a message to a number
      that is currently fiction.** Kd's ruling that the depth number STAYS is
      untouched by this and still binds.

- [ ] 🔴 **THE SPOKEN COACHING IS CONSTANT AND IRRELEVANT.** Reported by Kd
      2026-08-08, from his own camera testing the day before, and **recorded
      NOWHERE until now** — no OWED line, no BACKLOG line, no DECISIONS entry
      (grepped this session; the only prior hits for voice/speech in the whole
      record are an unrelated `voiceOn` dependency note and a camelCase line).
      A user-facing complaint that survived a testing session untracked is the
      exact failure this file exists to prevent.
      Kd: *"the voice commands also does not seem relevent at all it keeps
      bubling anything and very annoyning, in this way user will abondoned my
      product"*.
      **What exists:** `apps/web/src/utils/voice.js` (250 lines), six live
      triggers imported by `ActiveWorkout` — `speakExercise`, `speakCorrection`,
      `speakProgress`, `speakRest`, `speakSetStart`, `speakComplete`.
      **UNVERIFIED, AND THE FIRST THING THE CARD MUST TEST: this may be a
      SYMPTOM of the furniture line above rather than a separate defect.**
      `speakCorrection` reads out form faults. If the skeleton is sitting on a
      chair, the faults are computed from the chair — so the app would be
      reading nonsense corrections aloud, continuously, which is what "keeps
      babbling anything" describes. **Measure the two together before treating
      them as two problems**; repairing the pose input may quiet most of this on
      its own, and a throttle added first would only hide it.
      **The product decision is KD'S and is not assumed here:** how much the app
      should say, and whether it speaks by default. No behaviour changes until he
      rules.
      **Do not "fix" this by deleting the feature** (the no-removal rule): a
      coach that talks while your eyes are on your own form is the point of it.
      **STATUS 2026-08-08 — the SYMPTOM hypothesis is CONFIRMED; this is not a
      fourth defect** (DECISIONS :6386). Measured share of frames on which the
      engine would speak: **85.6%** pointed at furniture and **89.4%** on an
      empty room, against **1.1%** with Kd squatting in shot and **0.8%** with
      him and the furniture both in frame. **The babble is the app reading a
      chair's posture aloud.** Kd 2026-08-08: *"as for voice its working fine"* —
      he stayed in frame, which is exactly the condition under which it is quiet.
      **So: fix the pose input FIRST and re-listen before touching `voice.js`.**
      A throttle now would hide the furniture defect, which is why this line said
      so before the numbers existed. **Kd's product decision is still owed and
      still his** — how much the app says, and whether it speaks by default — but
      it must be put to him AFTER the pose fix, on what the app then actually
      says, not on today's chair-driven noise.

- [x] 🔴 **DONE 2026-08-09** (card 1 `6d255c4` = the abort half, card 2 = the
      recorder half). **THE GOLDEN-TRACE BAN IS LIFTED**: the recorder stamps the
      definition id, so a newly recorded trace can find its own definition.
      `--exercise` remains for clips recorded BEFORE this date and for nothing
      else. **THE MEASURING INSTRUMENT SILENTLY SKIPPED ITS OWN MAIN SECTION.**
      Found 2026-08-08 while reading Kd's five clips (DECISIONS :6386). The trace
      recorder stamps the workout's DISPLAY name into the trace header
      (`ActiveWorkout.jsx:1159`, `currentExercise.name.toLowerCase()` ⇒ `squats`)
      but definitions are keyed singular (`packages/engine/src/definitions/
      squat.json`), so `measure-pose.ts`'s `definitionFor(h.exercise)` throws
      ENOENT. **Section 3 — the engine replay, the whole point of the script —
      did not run on ANY of the five clips on the first pass**, while sections 1
      and 2 printed normally above a one-line `FAIL`. It reads as a partial
      success, which is how it nearly went unnoticed.
      **This is the SECOND time this same instrument degraded quietly instead of
      failing loudly** — the first was the empty-room clip that recorded nothing
      (commit 44f4ad2). **Fix the class:** a clip whose definition cannot be
      loaded must ABORT with the mismatch named, not print two sections and a
      FAIL; and the header slug must be the definition id, not a display name.
      Worked around on 2026-08-08 by rewriting the header in scratchpad copies
      (Kd's files untouched) — **the workaround is not the fix and no golden
      trace may be recorded until the slug is right**, or every future golden
      carries a header that cannot find its own definition.
      **BOTH HALVES ARE NOW DONE — see the tick above.** The record of how:
      **CARD 1 — the CLASS fix.** `measure-pose.ts` now resolves EVERY clip's definition BEFORE it
      prints a single line of per-clip output, and one unresolvable definition
      aborts the whole run naming the mismatch, the available ids and the
      `--exercise` flag to re-run with. **There is no longer a path on which
      some sections print and the main one silently does not** — the shape that
      made this defect nearly invisible twice. Proved by running it: the abort
      fires on a `squats` header with nothing printed above it.
      **CARD 2 — the RECORDER half.** `traceRecorder.definitionIdFor` resolves
      the slug through `getDefinition` — **the same lookup the engine uses**, so
      the header and the engine can never disagree about which definition a clip
      belongs to. `squats` → `squat`; an exercise with no definition (55 of 58)
      keeps its raw slug rather than having one guessed for it (:3538's
      exact-match-or-null shape). The expression that produced the bug existed
      TWICE in `ActiveWorkout.jsx` (:258 and :1159) and is now one `const` —
      a shared value with two declarations is where a correction gets lost
      (:4556 F1), which is exactly what happened here.
      Mutation-audited: T1 restores the original defect and the test goes RED.
- [ ] 🔴 **§3.6'S TRIGGER IS UNREACHABLE: THE APP CAPS ITSELF AT 12 FRAMES A
      SECOND AND THE SPEC WANTS 15.** Found and MEASURED 2026-08-17 while
      building the ladder half of the card below, which is why that half is not
      built. Nobody had noticed because the console line rounded it away.
      `usePoseDetection.js`'s `FEED_INTERVAL_MS = 67` is a THROTTLE — a frame is
      fed when `now - lastFeed >= 67` — so **14.93 a second is the arithmetic
      ceiling before any hardware is involved**, and `Math.round(1000 / 67)`
      printed that as "target 15" in every reading ever taken. In a real browser
      it is worse: the loop is `requestAnimationFrame`, which fires every
      16.67 ms on a 60 Hz screen, and 66.67 is not >= 67, so the feed slips a
      whole tick to 83.3 ms — **12.0 a second, on a machine doing nothing
      wrong.** Both figures are asserted by tests driving the real frame loop
      (`usePoseDetection.test.js`, "the ceiling is ~12" and "the throttle is the
      cap"), not reasoned.
      **WHAT IT COSTS US TODAY:** Part 6 §3.6 degrades a device when *"delivered
      Hz < 15"* — a condition **TRUE ON EVERY DEVICE BY ARITHMETIC**, so a ladder
      or a warning built on it fires for every user in their first ten seconds.
      It also **retires an explanation this project has been carrying since
      2026-08-08**: Kd's 9.2–12.2 fps (:8879) and his earlier 7.2–12.5 (:6386)
      were read as his laptop being under-powered. **12.0 is the ceiling and he
      was sitting on it.** Nothing has ever shown counting fails at these rates.
      **WHY IT IS NOT FIXED HERE (R1.1, R5.4):** raising the feed rate changes how
      often the engine is fed, and the person check's Kd-ruled
      `bone_stretch > 0.923` is normalised to `nominalDtMs: 82` — 12.2 a second,
      i.e. this exact ceiling (`sceneGate.js`, DECISIONS :7037/:7298, where the
      cut-off and the cadence are ONE ruling). Changing the throttle without
      re-measuring silently changes the shipped gate. **Needs Kd's decision plus a
      re-measurement, and it is plausibly the largest single win available for
      camera accuracy — more frames per rep is more evidence per rep.**
      **BLOCKS:** the §3.6 ladder in every form, and any use of "15 fps" as a
      device signal anywhere in this app.
- [ ] 🟡 **§3.6's degradation telemetry is not sent anywhere.** Deferred
      2026-08-17 with the card above. The spec asks for *"Degradation events →
      PostHog with device model, so the support floor is data, not guesswork"*
      (`06-part6-mobile.md:190-192`). **`apps/web` has no PostHog client at all
      — grep-verified across `src/` and `package.json`, zero hits** (P0.5 wired
      PostHog server-side only). The delivered rate is now readable by a user in
      the camera screen's `debug` panel, which is the local half; nothing is
      reported centrally, so the support floor stays guesswork until a real
      device fleet exists. **Unblocked by:** a web analytics client, which is its
      own decision (consent, DPDP scope — the open question at :592).
- [ ] 🔴 **THE PERSON CHECK'S RULED CUT-OFF WAS DERIVED UNDER A DIFFERENT MODEL
      FROM THE ONE WE NOW SHIP.** Opened 2026-08-17 by the model swap, and it is
      the swap's one real hazard. Kd ruled `bone_stretch > 0.923` on thirteen
      clips (DECISIONS :7037) — **every one of them recorded through
      `pose_landmarker_lite`**, because that is all the app had. `full` is a
      different estimator, so it produces different landmark jitter, and jitter
      is precisely what `bone_stretch` measures. **The number is NOT touched and
      must NOT be retuned to fit the new model** (R5.4, R5.7 — a threshold is
      never re-derived, and this one is a Kd ruling on top). What is unknown is
      whether it still does what he approved: it could silence a real person
      more often, or let the chair back in. **Neither has been observed — this is
      a hazard, not a symptom.** **Unblocked by:** a fresh recording under `full`,
      replayed through `measure-pose.ts --gate "bone_stretch>0.923" --window 15
      --nominal-dt 82`, printing the same table Kd ruled on. **Blocks:** nothing
      today; it is the first thing to check the moment anyone reports the chair
      counting again or reps going missing.
      **STATUS 2026-08-17 — SOMEONE LOOKED, AND SAW NOTHING WRONG; THE LINE DOES
      NOT TICK (DECISIONS :9328).** Step 3 of
      `RUNBOOK/smoke-strong-model-and-rate.md` ran under `full` for the first
      time: an empty room and a chair for one minute **invented ZERO reps**,
      while Kd's own reps counted normally in the same session. **That is one
      room, one chair, one minute, reported by the operator (:4829) — it is not
      the table he ruled on**, and a stored row cannot separate "reps before he
      stepped away" from "reps invented by the chair" (:7222). What moved is the
      hazard's TEMPERATURE, not its status: the failure this line was opened for
      has now been looked for once, under the shipped model, and was not there.
      The recording above is still the only thing that closes it.
- [ ] 🟡 **NOTHING IN THE APP DECIDES WHICH PERSON IS THE USER — in a gym, the
      camera counts whoever the model happens to crown.** **KD'S QUESTION,
      2026-08-17**, asked unprompted while the strong-model card's review was
      running: *"if a user uses it in gym there will be multiple people beside
      them then how would the camera detect only that target person?"* **Tracked
      NOWHERE before today — grep-verified across `OWED.md` and `BACKLOG.md`,
      zero hits** for multi-person/bystander/`numPoses`; the furniture half of
      the same question is well recorded (DECISIONS :6386, :7037), the PEOPLE
      half was not.
      **WHAT THE CODE DOES, read this session, not recalled:**
      `poseTuning.js:82` ships `numPoses: 1`, and `usePoseDetection.js:388-389`
      takes `results.landmarks[0]` — **MediaPipe crowns one winner and the app
      takes it.** There is no selection rule of our own: not the nearest body,
      not the largest, not the one in the middle, not the one that was there on
      the previous frame. **The person gate cannot help here and was never meant
      to**: `bone_stretch > 0.923` (`sceneGate.js`) asks *"is this a physically
      plausible human skeleton?"*, and a real bystander is one.
      **THE FAILURE, and it is UNVERIFIED — never tested with two people in
      shot:** the winner can change mid-set to somebody walking behind the user,
      after which their reps stop counting or another body's movement is counted
      as theirs, **and the app says nothing**, because as far as it knows it
      found a person. Same shape as :6386's chair — the model crowns a winner
      and nothing checks it is the RIGHT one — but with a subject that passes
      every plausibility test we have.
      **WHY IT MATTERS MORE THAN IT LOOKS:** the gym IS the pilot environment
      (P6: 2–3 Jorhat gyms on pilot codes), so the first room full of real users
      is also the first room where this can happen. A home user is unaffected.
      **Unblocked by:** a decision on how the user is chosen. The lever already
      on the record is DECISIONS :6810 — **`numPoses: 2+` returns CANDIDATES
      instead of a winner, and a rule then picks between them** (that entry pairs
      it with `motion_incoherence`); each extra pose costs another landmark pass
      against Part 6 §3.4's inference budget, so it is a measurement, not a
      default. **No rule is chosen here and none may be invented** (R0.2) — and
      note the recording gap above applies in full: clips of one person can never
      answer a two-person question, so this needs its own session in a room with
      two people in it. **Blocks:** nothing today; it blocks the GYM PILOT, not
      the cutover.
- [ ] 🟡 **KD RULED IT, 2026-08-17 — BUILD A FOLLOW-THE-DEMO MODE THE USER
      CHOOSES, AND TELL THE USER IT EXISTS (DECISIONS :9390).** His words:
      *"if a user is using in a environment where there are more people then it
      should switch to a mode where instead of the camera there will be a big
      reference of the exercise they want to do and follow the reference"*.
      Raised immediately after the multi-person line above, as a way AROUND that
      problem rather than through it.
      **WHY IT IS CHEAPER THAN IT SOUNDS — both halves already exist, verified
      this session, not recalled.** The moving demonstrations are already
      shipped: **112 GIFs in `apps/web/public/exercise-gifs/`, covering 63
      distinct exercise names** (`ls | wc -l`), so no media has to be produced.
      And the not-camera-graded path is the existing log-only set — the user
      counts, the workout still SAVES and still earns XP (DECISIONS :3085, Kd
      ruled), it simply carries no form score. So this is mostly screen work over
      two things already built.
      **RULING 1 — THE USER FLIPS THE SWITCH, NEVER THE APP.** Offered the
      choice, Kd said *"i will follow your recommendation"*, and the
      recommendation was that way round because of his own **:6008**: if the user
      chose the CAMERA, the app NEVER switches them off it — the approved hatch
      is a BUTTON *"the user presses, the app has no path to it"*. An app that
      DETECTS a crowd and switches is that forbidden handover wearing a new coat.
      **A later chat may NOT build the automatic version on the strength of this
      line — that needs Kd to amend :6008 expressly.**
      **RULING 2, in the same breath and larger — THE APP MUST TELL THE USER
      THE MODE EXISTS.** His words: *"this thing need to be explicitly told to
      the user that if there are multiple person then you need to switch
      otherwise they will think the app does not work"*. **A mode nobody is told
      about is a mode nobody uses, and the failure it prevents looks exactly like
      a broken app** — a user in a gym whose reps stop counting cannot guess the
      camera locked onto somebody else. :6662's "say it out loud" shape and
      :6856's "asking a person to notice a MISSING thing is not a check", applied
      BEFORE the defect rather than after it.
      **THE DESIGN CONSEQUENCE OF RULING 1 ON RULING 2, which must not be lost:
      the message CANNOT be conditional on a crowd**, because the app cannot
      detect one — that is the whole point of ruling 1. So it is unconditional
      and always present, which forces the wording: an **INSTRUCTION beside the
      switch** (*"training in a busy room? use Follow along"*), never a warning
      about the camera — otherwise every solo user at home is told the app may
      not work, the exact impression Kd is trying to prevent. **Copy is NOT
      written here (R0.2); it is written in the card and shown to him.**
      **AND THE TRAP WORTH THE WHOLE ENTRY: the AUTOMATIC version needs exactly
      the thing this idea was meant to avoid.** The app cannot know a room is
      crowded without asking the model for more than one body — the multi-person
      work in the line above. **User-chosen costs nothing extra; automatic costs
      the hard thing first.**
      **RULING 3, same day (DECISIONS :9452) — THE SET RUNS ON A TIMER, NOT ON
      REPS COUNTED FROM THE VIDEO.** Kd specified the video driving the count,
      then asked for the time-based version himself and ruled for it. **The
      reason is honesty: the app can only know how many reps the VIDEO did,
      never how many the USER did**, and writing the video's count into a
      person's history, calories and personal bests is a number the app invented.
      Secondary but real — **it removes the dependency on a perfect one-rep clip**,
      which is where the artwork was stuck. **Not a one-way door: rep counting can
      be added later.** **CALORIES NEED NO NEW WORK — verified, not recalled:**
      `calories.ts` is `MET × weight_kg × hours` and a log-only set is billed as
      its whole span at the exercise MET, so a timed set is the cleanest input
      that formula has had (:9452, :7730).
      **THE CARD IS WRITTEN: `NEXT-CARD-follow-along-PROMPT.md`.** It carries the
      three rulings, the traps, and what is deliberately out of scope.
      **Unblocked by:** nothing — it is ruled and buildable. **Sequenced after**
      the strong-model / camera-rate card closes. **Still owed inside the card and
      Kd's to give (R0.2):** the default set length, the on-screen wording, and
      where the reference footage comes from — the artwork is its own track and
      must not block the build (one placeholder reference proves the mode).
      **Blocks:** nothing today; it is what makes the GYM PILOT honest, alongside
      the multi-person line above.
- [ ] 🟡 **A model that changes the frames cannot be checked against any clip we
      hold, because the recorder saves landmarks and not video.** Restated
      2026-08-17 as its own line, having been a sentence inside two other
      entries. **Landmarks are the OUTPUT of the model, so a recording made under
      `lite` can never be replayed under `full`** — the thirteen clips behind
      `0.923`, the throughput sessions and the golden traces are all unusable for
      any question about a different model, a different MediaPipe build, or a
      different feed rate. **One fix serves all three:** something that can play a
      VIDEO through the camera pipeline. Nothing in the repo can — grep-verified
      2026-08-17, zero hits for `MediaRecorder`, `mp4`, `ffmpeg` or `VideoDecoder`
      across `apps/web/src`, `apps/web/tools` and `packages/engine`. Until then
      every camera experiment costs Kd a separate session in his own room, and
      the results cannot be re-derived by anyone else afterwards.
- [ ] 🔴 **WE SHIP THE FALLBACK POSE MODEL AS THE DEFAULT, AND THE DEGRADATION
      LADDER DOES NOT EXIST.** Found 2026-08-08 (DECISIONS :6386).
      **2026-08-17 — KD RULED THE SPLIT AND CHOSE THE ORDER. The LADDER half is
      now BLOCKED on the throttle line above, not merely unbuilt:** its trigger
      is unreachable, so there is nothing honest to build a step-down on. What
      that half's card delivered instead is the delivered rate shown beside the
      real ceiling in the camera screen's `debug` panel — *"a readout, never a
      warning"*, because under 15 is the normal case on every machine and
      counting works there. **Nobody ever chose `lite`** — it was inherited from
      the old code and never revisited; §3.3 makes `full` the default.
      ~~The MODEL half is blocked on a RECORDING.~~ **STRUCK the same day, by
      me, and the correction matters more than the claim.** Kd was told the swap
      was blocked on him recording video. It was not: the swap is a default, two
      digests and a fetch, and it is DONE below. What needs the recording is
      **CHECKING THE PERSON GATE AFTERWARDS** (its own 🔴 line above) — a
      verification, not a prerequisite. Saying "blocked" made a five-minute
      change look like a session of his time, and he over-ruled it with "just do
      the things of making the strong model default". **A verification you cannot
      run yet is not a blocker on the work; it is a blocker on the confidence.**
      **THE MODEL HALF IS BUILT, 2026-08-17 — NOT TICKED, because smoke and T3
      are unrun (the :5034 / :4718 F4 precedent: a line ticked in the same
      commit whose own notes say the gate has not run gets reverted).**
      **SMOKE UPDATE, same day (DECISIONS :9328): the sheet now PASSES 5 of 5.**
      `full` loads off disk (console: THE APP BUNDLE) for **+37 ms**, delivers
      **10–12 of the 14.9 ceiling** where `lite` delivers 11–12 on the same
      machine in the same session, and the empty chair invented ZERO reps. **Still
      NOT TICKED, and the reason is now a single one: the diff-only re-review of
      the rate-expiry fix (`t3-camera-rate-expiry-r2-PROMPT.md`) has not run, and
      a packet ships on a review round finding zero Critical/High (:5348 rule 1).**
      The LADDER half below is untouched by any of this and stays blocked.
      `POSE_DEFAULTS.model` is `'full'`; `fetch-pose-assets.mjs` bundles **both**
      `full` (9,398,198 bytes, sha256 `5134a3aa…`, both MEASURED by downloading
      it) and `lite`, so §3.3's step-down stays offline-capable and every past
      measurement stays reproducible. A contract test asserts **the shipped
      default is one of the models the build writes** — point it at an unfetched
      variant and nothing else complains, because Vite answers a missing
      `public/` file with index.html at 200. **The LADDER half stays open and
      stays BLOCKED on the throttle line above.**
      ~~`usePoseDetection.js` hard-wires `pose_landmarker_lite` on every
      device.~~ **No longer true as of the swap above** — kept struck rather than
      deleted, because it is what the line was opened for. The original finding,
      for the record:
      Part 6 §3.3 says the opposite — *"BlazePose **full** as default, **lite**
      as the automatic step-down (§3.6)"* — and §3.6's ladder (full → lite below
      15 Hz for 10 s → 640p → **log-only mode with honest copy**) is not
      implemented at all. A weaker model is a more credulous one, so this is
      plausibly UPSTREAM of the furniture defect; **UNTESTED, and it must not be
      switched blind.** Counter-evidence from Kd's own machine, measured:
      `FEED_INTERVAL_MS = 67` targets ~15 fps and his five clips landed at
      **11.6–12.5** (7.2 on one) — he is already UNDER target on the LIGHT model,
      so `full` may make his laptop worse. **Inference time has never been
      measured on any device.** Measure first, then choose; and the ladder is
      owed regardless of which model wins, because the whole point of §3.6 is
      that the choice is made per-device at runtime rather than by us guessing.

### Session handling — found by Kd's smoke 2026-08-18, tracked nowhere before

- [ ] 🟡 **A NETWORK BLIP ON PAGE LOAD LOGS YOU OUT OF THE WHOLE APP.** Found in
      the console smoke, on a step that was aimed at something else entirely:
      with the API stopped, a browser RELOAD of any protected screen bounced Kd
      to the login page instead of showing an error. **This is app-wide and
      PRE-EXISTING — not the console's, and not in that card's diff** (R1.1:
      reported, deliberately not fixed there).
      **THE CAUSE, read rather than guessed:** `AuthContext`'s mount effect does
      `authService.getMe().catch(() => { adoptSession(null); setUser(null); })`,
      and `ProtectedRoute` redirects on a null user. A network failure carries
      **no response at all**, so it lands in the same `catch` as a genuine 401 —
      the app cannot tell *"you have no session"* from *"I could not ask"*.
      **The identical lesson is already written down THREE LINES AWAY**:
      `fetchProfileFacts` returns `undefined` rather than `null` on a failed read
      precisely because "the read failed" and "the server has none" are different
      facts (:618's T3 F3). `getMe`'s catch never got the same treatment.
      **What a user sees:** a valid session, a moment of bad wifi, and a login
      screen asking them to sign in again — which is false, and on a phone in a
      gym basement it will not be rare. The cookies are still valid, so logging
      in again works, which is exactly why nobody has noticed.
      **What the fix has to be careful about:** failing OPEN here means a
      genuinely logged-out user could render a protected screen before the first
      request 401s. The honest shape is a THIRD state — unknown — that shows a
      retry rather than either the app or the login form, which is the same shape
      the console's own screens use for their reads.
      **Its own card. Not a blocker for the console card, whose eleven smoke
      steps passed** — but this is the sort of thing that is invisible to every
      test suite in the repo, because every one of them mocks the network.

### Screens still reading the OLD backend (no new-API home yet)
Each needs an API surface built BEFORE its screen can be repointed. Per the
no-removal rule these UIs stay untouched and working on the old backend until
then; none may be hidden or reduced to close the gap.

- [x] 🔴 **XP / levels display — DONE 2026-07-30.** Closed by T3 round 11
      under THE CAP (DECISIONS 2026-07-29): round 11 returned ONE visible
      finding, it was fixed, and the card closes on that fix. Eleven review
      rounds; commits `7b91c68` (Round A) · `0869f01` (Round B) · `df0ea05`
      (round 9) · `690cdfb` (round 10) · this one (round 11). Smoke passed
      11/11 on 2026-07-28 and no fix since has changed user-visible
      behaviour beyond a defect. Was: UNTICKED 2026-07-26 by round 3, still
      off after rounds 4, 5, 6 AND 7.
      **SMOKE HALF DISCHARGED 2026-07-28: the re-smoke PASSED, all 11 steps**
      (Kd, steps at `RUNBOOK/smoke-xp-dashboard.md`, result recorded there). It
      replaces the 2026-07-27 attempt voided by the rig's CORS wildcard. Level 3
      / `332/374` / `680 XP` held on all five XP surfaces in all ten rig states,
      including `dead` and `hang`; no fabricated zero and no false "unavailable"
      over visible content anywhere. **THE TICK STAYS OFF: this line needs the
      smoke AND T3 round 8.**
      **ROUND 8 HAS NOW RUN (2026-07-28) AND THE CARD FAILED IT: 6 BLOCKING
      FINDINGS, 15 of 31 MUTANTS SURVIVED.** Findings verbatim at
      `t3-xp-web-r8-FINDINGS.md`; all six independently re-verified against the
      current files before any fix was planned. The eighth consecutive round in
      which the previous round's fix opened the next finding.
      THREE ARE LIVE DEFECTS: F4 an unguarded `in` lookup on external input
      blanks the WHOLE Achievements page (a badge category of `toString` →
      `.push` on `Object.prototype.toString`); F3 the week strip claims
      "Weekly activity unavailable" during an in-flight read, permanently when
      the old backend hangs; F5 an unknown badge tier is painted BRONZE in
      GamificationStrip while Achievements renders it neutral — round 6 F5 fixed
      at one of two sites, the eighth instance of the one-of-N shape.
      THREE ARE THE PROTECTION: F1 `Sidebar` — the component the ORIGINAL bug
      lived in — is mounted by no render test at all, and the source guard's
      `FIELD_READ` misses `xp ?? { level: 1 }`, so the card's own defect is
      reintroducible with all 75 tests green; F2 no Achievements test ever runs
      with the XP read failing; F6 four numeric fabrications (`?? 0` at Total
      Workouts, Calories, This-week, Your Rank) survive because
      `getAllByText('—').length >= 3` is a floor with two dashes of slack.
      **Also falsified: the claim in `gamificationApi.test.js` (the guard
      section's header — round 8 cited it as :454-457, which Round A's edits had
      already shifted to :515-518; corrected here per V4) and DECISIONS
      (2026-07-26, line 1173) that "all ten bypasses fail there".** Two of them
      pass. Fifth false claim carried by that guard section.
      FIX ORDER, Kd-approved 2026-07-28: **Round A** = the live defects
      (F3, F4, F5), failing test first per R9.5; **Round B** = the protection
      layer (F1, F2, F6), every new assertion mutation-tested before it counts.
      The smoke does NOT need re-running for Round A/B unless a fix changes
      user-visible behaviour beyond the defect — and note the smoke could not
      have caught F4: the rig never sends a prototype-name category.
      **ROUND A IS DONE (2026-07-29). F3, F4 and F5 are FIXED.** Each began as a
      failing test written and shown RED before any source was touched (R9.5 —
      the gate round 7 failed): 6 new tests, and the F4 red run reproduced the
      reviewer's Probe C exactly (`TypeError: badgesByCategory[key].push is not
      a function`, `<body><div /></body>`). Suite 81/81 green. **11 mutations
      were run against the new assertions: 10 RED, 1 GREEN** — and the green one
      was declared green in the PLAN before it ran. It is `Object.create(null)`
      at `Achievements.jsx`, which is behaviourally inert once the
      `Object.hasOwn` check stands, so no assertion can distinguish it; that is
      written in the source comment instead of being credited to a test (rounds
      6 F11 / 7 F3's lesson). F5 was fixed as a CLASS: every site in the card's
      ten files resolving a colour from a nullable field was enumerated, the two
      defective ones fixed, the six already-correct ones re-read and left, and
      the one excluded (`podiumColors[entry.rank]`) is the OWED line below.
      Lint parity checked rather than "lint clean" ticked: the six touched files
      produce 1 error at HEAD and the same 1 error after (pre-existing
      `ChevronRight`), package-wide 67 both times.
      **ROUND B IS DONE (2026-07-29). F1, F2 and F6 are FIXED, and NO component
      file changed — all three were defects of the TEST layer, so Round B alters
      no shipping behaviour and owes no re-smoke.** F1: `Sidebar` is mounted by
      two new tests (XP dead → no level at either of its two sites; XP ready →
      the TRUE level at both, the positive control without which an empty
      sidebar would pass). F2: one Achievements test with `getMe` DEAD, the
      whole-document sweep matching the Dashboard's. F6: the three
      `getAllByText('—').length >= 3` floors at :144/:161/:182 are REPLACED by
      per-site identity assertions (`statValue`/`tileValue`, which throw when
      their anchor is absent or ambiguous so they cannot pass vacuously) plus a
      whole-document `\b0\b` sweep on the dead fixtures; `Your Rank` got its own
      identity assertion in GamificationStrip, since the pre-existing `of 0`
      check reads the TOTAL and never touched the rank.
      **9 mutations, 9 RED — every new assertion mutation-tested before it was
      claimed to protect anything**, restored from `cp` backups. B1/B3 are
      MUT-28/MUT-34 verbatim (the destructure that defeats `FIELD_READ`);
      B5/B6/B7/B8 are MUT-21/24/26/20, the four numeric fabrications, of which
      MUT-21 is round 4 F2 verbatim; B2 and B9 are the vanishing-site controls.
      Suite 84/84 (81 + 3). `vite build` green. Lint parity: the two touched
      files produce 0 problems, package-wide 67 errors — the same 67 Round A
      measured and round 8's reviewer counted independently.
      The two false "all ten bypasses" claims are CORRECTED IN THE SAME COMMIT,
      in the guard header and at DECISIONS line 1173, and neither is replaced by
      a new sweeping claim: what is written is what was measured (Kd chose this
      over re-running all ten to earn the strong sentence back).
      **ROUND 9 HAS RUN (2026-07-29) ON ROUNDS A+B: 4 findings, 2 VISIBLE, ALL
      FIXED.** The stopping rule worked in both directions — two findings held
      the ticks, two were fixed without holding anything. F1 (VISIBLE): Round A's
      own `${color}NN` hazard was applied to ONE of EIGHT sites, so seven more
      dropped their colour entirely in the unknown state — measured, a progress
      bar with no fill beside a card printing "2 / 5" and "40%", on two
      components. `difficultyStyle()` now joins `tierStyle()` and no call site
      concatenates (grep: zero remain). F4 (VISIBLE, pre-existing): round 5 F8's
      other direction — seven definite dots, 4 flames, under "Weekly activity
      unavailable". F2/F3 (NOT-VISIBLE) are both **Round B's own work**: its tile
      helper covered two tiles of three, leaving the LEVEL tile unasserted and a
      fabricated Level 1 green past all three protections; and one of its four
      new Achievements assertions could not fail, because the regex was copied
      from a site where digits sit next to "XP" to one spelled "N total XP".
      **12 new mutations, 12 RED**, including a positive control; Round B's nine
      re-run and all still RED with identical counts. Suite 87/87.
      Also corrected: this card's round-9 prompt claimed "touched files 0
      problems", which was Round B's two test files, not the combined six-file
      diff — that is 1 pre-existing `ChevronRight` error, as Round A recorded.
      **ROUND 10 HAS RUN (2026-07-29): 4 findings, 1 VISIBLE, ALL FIXED.**
      F1 (VISIBLE): the week caption printed `weekly_workouts` — a count of
      SESSIONS since Monday — labelled "days active", above a strip whose flames
      come from `activity`, keyed by DAY over a ROLLING seven days. Two
      mismatches, not one (verified at `backend-ml/app/routers/workouts.py`
      :72-74 and :86-89). Measured: "5 of 7 days active" over three flames, and
      "10 of 7 days active" — a sentence that cannot be true. Round 9 F4 fixed
      the readiness axis of round 5 F8 and left the counting axis. Caption and
      dots now derive from ONE `weekDates()`. F2/F3/F4 (NOT-VISIBLE): neutral
      style slots asserted for presence but not neutrality (4 mutants survived);
      the completeness loop listing 5 of 7 fields **and** covering only the
      NEUTRAL tier, so the four known tiers had no check at all (found while
      fixing, not by the review); and the recommendation pill's background
      knowing one vocabulary while its label knew two.
      **13 mutations, 12 RED, 1 GREEN** — the green one declared: a
      date-dependent equivalent (a 24h shift changes nothing except across a
      Sunday). Round 9's protections re-run as regression: all still RED.
      Suite 90/90.
      **ROUND 11 HAS RUN (2026-07-30): 6 findings, 1 VISIBLE, ALL FIXED — AND
      THE CARD CLOSES ON IT, per THE CAP.** F1 (VISIBLE) was a REGRESSION ROUND
      10 INTRODUCED: `weekDates` does local calendar arithmetic and serialises
      in UTC, and round 10 routed the printed day number through the UTC string,
      so in IST between 00:00 and 05:29 every day number was one behind and the
      orange "today" cell showed yesterday — measured, 26 27 28 29 30 31 1
      against a calendar reading 27 28 29 30 31 1 2. In DST zones the same
      mixing duplicated a key in the spring-forward week and skipped one in the
      fall-back week. Fixed by returning `{ key, day }`: the key stays UTC
      because the backend buckets UTC, the day is local because that is what the
      user's calendar says. F2/F5/F6 fixed too (two assertions that could not
      fail — one dominated, one whose producer the round 10 fix had made
      structurally bounded; an orphaned JSDoc; two `new Date()` calls where one
      was claimed). **10 mutations, 9 RED**; the survivor is declared (P9: the
      strip reading its own instant can only diverge across UTC midnight).
      A gap the mutations found in round 11's OWN fixture is closed in the same
      commit: every activity key sat inside the displayed week, so "count this
      week" and "count every key" were the same number and the caption could
      abandon the Mon-Sun window unnoticed.
- [ ] 🔴 **Week strip date axis — render-side coverage.** Round 11 F3 measured
      TEN surviving mutants on this axis and round 11's fix closed the helper
      half with pinned-clock, pinned-TZ unit tests (`weekDates` now has three).
      What is still UNCOVERED is the RENDER side: no assertion in
      `xpDisplay.render.test.jsx` reads a day NUMBER, a label↔date relationship,
      or which seven days the strip covers, so "labels rotated", "Monday
      permanently highlighted" and "dates reversed" are caught only at the unit
      layer. Needs `vi.setSystemTime` plus a pinned TZ in the render file, which
      is why it is a line rather than a same-commit fix: fake timers interact
      with framer-motion's animation waits, and this card has twice recorded
      that a timing instrument chosen carelessly produces a vacuous assertion.
- [ ] 🟡 **`xpDisplay.render.test.jsx`'s week fixture re-implements
      `weekDates`.** Round 11 F4: the fixture computes its own keys with the
      same algorithm, `toISOString` included, so a helper wrong in the SAME way
      is invisible to it — which is exactly how round 10's UTC/local mixing
      survived there. The overclaiming comment ("a wrong helper cannot make this
      test agree with itself") is CORRECTED in place; the structural fix is to
      derive the fixture from a pinned clock and literal dates.
- [x] 🟡 **`ExerciseLibrary.jsx:63` — `DIFF_COLORS[exercise.difficulty] ||
      DIFF_COLORS.beginner` — DONE 2026-08-05** by the exercise-library repoint,
      the card this line was explicitly waiting for. `difficultyStyle()` now
      lives in `apps/web/src/pages/exerciseLibraryView.js` and returns a NEUTRAL
      style for an unrecognised value and **null** for a missing one, so the
      caller draws no pill at all rather than being handed a default that reads
      as a fact. Mutation-checked both ways (M20 restores the `|| beginner`
      fallback, M21 makes a missing difficulty draw a pill; both RED).
      **CORRECTED 2026-08-05 — this tick was the INSTANCE, not the class, and was
      briefly false.** The card's own T3 round 1 (F3) found a FIFTH site still
      live: `components/exercise/ExerciseDetail.jsx` carried its own private copy
      of `DIFF_COLORS` and its own `|| DIFF_COLORS.beginner`, on the panel that
      opens on EVERY card click — so this line said DONE while an ungraded
      exercise was still asserted to be `beginner` in green, one component over
      from the fix. Now fixed: that file imports `difficultyStyle` and draws no
      pill when there is nothing to say. **This is "fix the class, not the case"
      (:1239) recurring for at least the fifth time — the check that would have
      caught it is a grep for the OPTION (`DIFF_COLORS`), not for the symptom, at
      the moment of ticking.**
      **CORRECTED AGAIN 2026-08-05 by T3 round 2 (F2): the re-tick above cited
      M20/M21, which live in a DIFFERENT FILE and pin the GRID's pill.** Nothing
      rendered the detail panel, so round 2 put the defect straight back and all
      494 tests stayed GREEN — measured. A tick citing mutants that cannot fail
      for the code being ticked is the same defect as the tick it replaced, one
      level up. Now real: two render assertions open the panel and check the pill
      (absent for a row with no difficulty, present and correct for `beginner` —
      a PAIR, because the negative alone is satisfied by never drawing a pill),
      and **M28** restores the `|| beginner` in that file. M28 measured RED.
      **WAS:** Raised by round 11 under R1.1 as out of scope: a
      FOURTH site of the one-of-N shape round 7 F2 declared fixed as a class, on
      a screen this card does not own — an unknown difficulty painted as a
      definite `beginner`. Belongs to whichever card repoints the exercise
      library.
      **ROUND 7 (2026-07-27, fresh chat): 8 findings, 3 blocking, all fixed.**
      Seventh consecutive round in which the previous round's fix opened the
      next one. F1: `recsState` derived from the STATS read's loading flag —
      the recommendations request had no settled flag at all — so BOTH failure
      modes this card exists to delete fired at once, a false "unavailable"
      during a healthy load and a permanent "Loading…" against a hung backend.
      F2: round 6's difficulty "class fix" covered one site of three; the
      hard-red `else` was still live in ChallengeCard and ChallengeRow. There
      is one exported `difficultyColor()` now. F3: round 6's F11 ruling
      (an assertion whose stated failure mode the code cannot produce is
      vacuous) was violated by the F11 commit itself — a `/advanced/i` check
      that could never fail, whose false premise then propagated into two
      source comments, DECISIONS, OWED and the commit message. All corrected.
      Also: a stale comment naming deleted functions (F4), seven bare nullable
      fields rendering blank where siblings print "—" (F5), six bare
      `isCurrentUser` reads the record claimed were fixed (F6),
      `earnedBadgeCount([null])` throwing one layer inside F12's own fix (F7),
      a section that vanished when both lists were empty (F8), and an
      unencoded id in a route query.
      **ROUND 6 (2026-07-27, fresh chat): 12 findings, 3 blocking, all fixed.**
      Sixth consecutive round in which the previous round's fix opened the next
      one. F1 is the headline and it is the INVERSE of this card's defect:
      round 5's F2 fix made the earned-count null whenever any badge's `earned`
      is unknown, and the list's STATE borrowed that test — so a catalog that
      arrived and was rendered on screen got "Badges are unavailable right now."
      printed directly above two visible badge cards. Not a fabricated number;
      a false denial of content the user can see. Same rule, opposite sign.
      F2/F3: `recommendations` was a SECOND unparsed list in Dashboard — round
      5's claim that `recent_workouts` was "the ONE" was false. A non-array
      value reached `.slice().map()` and blanked the entire page (no
      ErrorBoundary), and six bare reads painted an unknown difficulty red and
      "advanced". Also fixed: blank loading arms in the strip (F4), a fabricated
      bronze tier ring (F5), three more empty-list states (F6), a literal
      "Invalid Date" (F7), nullable booleans read as definite-false (F8), a
      failed recent-workouts read looking like a zero-workout account (F9), a
      fourth false claim in the guard (F10), two assertions that could not fail
      for the class they named (F11), and a throw on `earnedBadgeCount(undefined)`
      (F12). `badgesKnown`/`challengesKnown` DELETED — dead surface that still
      carried five assertions, which reads as protection and is not.
      **ROUND 5 (2026-07-26, fresh chat): 8 more findings, 3 blocking, all
      fixed.** The pattern held a fifth time — round 4's own F4 fix created
      round 5's F1, and round 4's new readers created F2 and F3.
      F1: the per-tab captions branched on the ENVELOPE's state, so "200 with no
      list" matched neither arm and three tabs said "Loading…" forever after
      both reads had settled. F2: the new readers defaulted every BOOLEAN to
      `false` (only the 15 numeric/string fields were nulled), so a catalog with
      no `earned` field printed "0 of 40 badges" and "earn your first badge" —
      the round-2 fabrication restored through a default instead of an envelope
      gate. F3: `recent_workouts` was the one list left unparsed, so three
      Dashboard sites rendered "0 min · 0 kcal · 0% form" with the unknown
      accuracy painted RED. Plus a dead current-user highlight (F4), a badges
      tab that rendered nothing when the catalog was empty (F7), a caption and
      its dots gated on different fields (F8), a false consumer count in
      `useXp`'s comment (F6), and two `.catch(console.error)` leaking the axios
      config in Dashboard (R3.10).
      **F5 is the one to remember: round 4's 132-line "class fix" shipped with
      NO tests on the class** — every render fixture used empty lists, so
      `readBadge`/`readChallenge` never produced output any test looked at,
      which is exactly why F2 and F3 survived a round. Now 19 unit tests over
      all ten readers/formatters + 6 render tests that render a real badge,
      challenge and recent workout. The render tests also caught TWO more
      page-blanking ReferenceErrors in the round-4/5 edits themselves.
      It was ticked on the round-2 smoke; round 3 then found
      three behaviour defects that a click-through cannot see, so the tick was
      premature and comes off (the google-login / DPDP precedent). Re-ticks when
      the fixes have their own smoke AND a round comes back clean.
      **ROUND 4 (2026-07-26, fresh chat): 8 findings, all real, all fixed — the
      fourth consecutive round to find that the previous round's fix opened
      something new.** Headline: the source guard was defeated FOUR more ways
      (ten total across four rounds), including a destructure that FIELD_READ
      structurally cannot see, and a contradiction appended to FIELD_READ that
      disarmed the whole scan silently because it had no positive control.
      **Kd approved two new dev deps (jsdom + @testing-library/react) on
      2026-07-26 and the protection of record is now RENDER tests**
      (`apps/web/src/pages/xpDisplay.render.test.jsx`, 13 tests): the regex
      battery cannot win because source text has unbounded spellings for the
      same rendered output. All four of the reviewer's paste-in mutations were
      re-run against the fix and each goes RED — verified, not asserted. Round
      4's other findings: `statsKnown` was `Boolean(data)` under a new name so a
      `{stats:{}}` 200 still printed six zeros (F2); the week strip rendered
      seven inactive dots — seven claims — beside a caption reading
      "unavailable" (F3); `allSettled` decoupled the FETCH but every render was
      still gated on the overview payload, so a healthy leaderboard was thrown
      away and disclaimed (F4); seven element-level fields were still read bare
      (F5); the old payloads never crossed a parser at all, which is the CLASS
      behind rounds 2-4 and is now fixed with `readOverviewView` /
      `readLeaderboardView` / `readStatsView` (F6); `useXp` exposed one state
      where three exist, so a hung old backend + failed XP read hid the surface
      forever (F7); and three claims in the guard's own header were false (F8).
      Round 3's findings:
      an unguarded `leaderboard.leaderboard.map` — the twin of the read round 2
      claimed to have fixed — which blanks the whole page including the XP
      header on a partial 200; "Failed to load achievements" asserted while the
      old read was still IN FLIGHT (a failure claim during a healthy load, and
      permanent against a hanging backend, since mlApi sets no timeout); and
      `oldReady = Boolean(data)` testing the envelope rather than the field, so
      a 200 with `{}` still printed "(0/—)" and "earn your first badge".
      Commits `7750478` (build) +
      `f918cc4` (T3 round 2). RE-SMOKE PASSED (Kd) on the round-2 bytes: the
      strip read "330 XP · Level 2" / "230/248 to Lv 3" with the old backend
      OFF, the counters read "(—/—)" and "of —" rather than zeros, Achievements
      read "Level 2 / 330 total XP · — of — badges", and the sidebar read
      "Level 2 / L2".** Two fresh-chat T3 rounds (6 + 8 findings, all resolved);
      round 2's own headline was that round 1's fix had re-created this card's
      defect elsewhere, which is why the re-smoke was required rather than
      assumed. A third round was offered and not run — if one is ever run and
      finds something blocking, this tick comes off (the google-login / DPDP
      precedent). The Dashboard XP surfaces are a SEPARATE line below, Kd-ruled
      out of this card on 2026-07-26 and confirmed wrong by the same smoke.
      (GamificationStrip, Achievements). XP storage
      does not exist anywhere in Part 4 — inventing a column would violate R0.2,
      so the badges.py XP/level curve stays unported until a ruled migration
      card. (DECISIONS 2026-07-11 P2.3 GAP-1.)
      **RULED 2026-07-24 (Kd): KEEP the feature — add XP storage.** XP/levels is
      a live feature on the old backend and the no-removal rule keeps it; the
      GAP-1 deferral is now discharged by an explicit ruling to build its home.
      Next: a 🔴 migration card adds XP storage (column or small table, SQL
      reviewed by Kd — the onboarding-storage / user_fitness_profiles precedent
      for Kd-authorised schema beyond the spec) and ports the badges.py
      XP/level curve verbatim (R5.4). THEN the web XP display repoints.
      Dropping it was never on the table — no-removal.
      **API HALF ✅ MERGED TO MASTER 2026-07-26 as PR #50 (merge `47cc001`) —
      this line stays OPEN because its actual subject, the web display, is
      still on the old backend.**
      Migration `0008_user_xp` (1:1 `user_xp`, SQL reviewed by Kd) + the
      verbatim badges.py curve/constants in `gamification/xp.ts`; XP is
      RECOMPUTED from full history at every sync (never `$inc` — a retried sync
      would double-count), and `user_xp` is on BOTH DPDP lists (delete +
      export). `/v1/gamification/me` now returns an `xp` block
      `{total, level, xpInLevel, xpForNext, progressPct, nextLevelAt}`.
      ~~NB **`web-repoint` does not carry it yet**~~ — DONE: master merged into
      this branch at `1164a86` (2026-07-26), which is what put the `xp` block
      here before the web half was built.
      T3 ran FIVE fresh-chat rounds (25 findings, all resolved). The code has
      been stable since round 1's lock fix; rounds 2-5 were about evidence and
      records. Three behavioural guarantees each carry a mutation-verified test:
      the advisory-lock body, its CALL SITE (probed via `pg_blocking_pids`), and
      that `/me` reads stored XP rather than recomputing. api 366/366 on Neon.
      **READ BEFORE TOUCHING XP NUMBERS:** `xp.ts` carries a governing rule —
      *every recomputed input to every component diverges from the old backend*
      (day bucketing, activity-vs-sync time, retroactive backfill, the
      server-derived form score, and all four badge-stat inputs). The constants
      are verbatim; the TOTALS deliberately are not. Do not "fix" a difference
      against the old app without reading it.
      **STILL OWED (the web half, this line's actual subject):** repoint
      GamificationStrip + Achievements off `gamificationApi`'s old-backend
      `getOverview` onto the new `xp` block. TRAP, same class as the
      nutrition-targets card: the API speaks camelCase (`xpInLevel`) while the
      components read the old shape (`user.progress.xp_in_level`,
      `user.xp`, `user.level`) — a straight swap yields `undefined`, which
      renders as a plausible-looking blank rather than an error. The browser
      SMOKE is owed WITH that card (the API half ships no reachable UI and
      correctly claims none).
      **WEB HALF BUILT + SMOKE PASSED (Kd) 2026-07-26 — commit `7750478` on
      `web-repoint`. Box stays UNTICKED pending the T3 round below.**
      Sidebar + GamificationStrip ("Your Rank" only) + Achievements (header
      only) now read the new `xp` block via a `useXp()` hook on the Card-1
      cookie client; `readXpView` returns NULL rather than a default so no
      fabricated number can reach the UI, mutation-verified. Kd's SCOPE RULING
      (2026-07-26) put **Sidebar IN** — its `user?.level || 1` read a field the
      auth user shape does not have, so it rendered "Level 1" for everyone —
      and **Dashboard OUT** (different old endpoint; its own line below).
      SMOKE evidence, on a seeded account at total_xp 330 → Level 2 (a value
      chosen BECAUSE a fresh account is genuinely Level 1, which is what the old
      bug faked and so could not discriminate): sidebar read "Level 2 / L2";
      "Your Rank" read "330 XP · Level 2" with "230/248 to Lv 3"; the
      Achievements header read "Level 2 / 330 total XP" with "Failed to load
      achievements" BELOW it. The last two both prove the T3 ① fix — they
      rendered with the old backend switched off, which the first cut of this
      card could not have done. `/v1/gamification/me` matched all three.
      **T3 ROUND 2 DONE — 8 findings, all fixed, and it proved the round-1 fix
      had created a NEW instance of this card's own defect** (hoisting XP out of
      the old payload made the badge/challenge counters render "of 0" and "0 of
      — badges" on a failed read, asserting zeros where nothing is known — the
      state Kd's smoke ran in, and which I wrongly reported as correct). Also:
      the Achievements spinner still gated the header on the old backend; two
      unguarded payload reads could blank the page; and BOTH source guards were
      bypassable nine ways until redesigned as a positive rule. **RE-SMOKE OWED
      on these bytes** — the previous pass does not carry over, because what the
      two screens display with the old backend off has changed ("—", not "0").
      NB the SMOKE also exposed a Docker trap worth knowing: `aihg-dev-api-1`
      publishes port 3000 and points at its OWN Postgres, so with that container
      up the browser talks to a different database than a locally-run api and a
      login can fail for no code reason at all.
      SCOPE BOUNDARY (verified by grep, so the web card does not over-reach):
      those two screens ALSO render `badge.xp_reward` (Achievements.jsx) and
      leaderboard `entry.xp`/`entry.level` — those belong to the **badge
      catalog** and **leaderboard** lines below, NOT to this one. The per-badge
      tier XP those need IS already ported (`ACHIEVEMENTS[].tier` +
      `badgeXpForCodes`, in `gamification/badges.ts`), but it is not yet served
      by any endpoint and is NOT stored on the `achievements` table — the badge
      catalog card decides whether it needs a column.
- [ ] 🔴 **Round 8 F6's other EIGHT surviving mutants — NOT addressed by Round B,
      NOT re-measured.** F6's table listed twelve; Round B's prescription
      ("per-site identity assertions plus a whole-document numeric sweep on the
      DEAD fixture") covers the four NUMERIC render-site fabrications only —
      MUT-20/21/24/26, all four now mutation-verified caught. The other eight
      stand exactly as the reviewer measured them on 2026-07-28 and have NOT been
      re-run since, so this line records a round-8 measurement and not a current
      one: MUT-3, 4, 15, 16, 17 (`orUnknown(...)` → bare read at badge
      name/icon/xpReward and `ex.primaryCategory` — round 7 F5's own fix, which
      shipped with no test at any layer), MUT-29 (`entry.isCurrentUser === true`
      → truthy, round 7 F6's fix), MUT-2 (the recommendation pill's BACKGROUND —
      round 7 F2's own site, asserted on colour but not background), and MUT-10
      (`useXp` reporting a malformed 200 as ready). Recorded rather than folded
      in because Kd approved a plan naming exactly nine mutations (R1.1/S4) —
      and recorded AT ALL because "fix the class, not the case" plus an untracked
      known gap is the precise combination this card has lost rounds to. Close it
      in whichever round next touches these assertions.
- [ ] 🔴 **Badge catalog + challenges screens.** "Tables now, screens later"
      carve; needs catalog/challenges read endpoints. Challenges also need a
      scheduler for weekly rotation. (DECISIONS 2026-07-11 P2.3.)
- [ ] 🔴 **Leaderboard** (GamificationStrip, Achievements). P4.x work: Redis
      ZSET + snapshots, verified-entries-only for global boards (v1 §14).
      ⚠ SEQUENCING CONFLICT, recorded and NOT yet ruled: the playbook puts P4
      AFTER P2.8, but cutover requires every feature's endpoint to exist first.
      Kd must either land a minimal read early or explicitly accept a dark
      window. DECIDE AT THIS LINE — do not silently flip it.
      (DECISIONS 2026-07-16, Card 3.)
      **RULED 2026-07-24 (Kd): the feature STAYS and is built PROPERLY in P4;
      accept a temporary "coming soon" state at the cutover moment** (the
      framework's sanctioned dark-window option — NOT a removal; the leaderboard
      screen stays working on the old backend until cutover, and shows a
      "coming soon" placeholder only if P4 has not yet landed when the old
      backend is switched off). Rationale: at launch the DB is empty
      (DECISIONS 2026-07-13), so a global board has no entries to show, and it
      needs the full verified-entries-only anti-cheat (v1 §14) that is real P4
      work — a rushed empty board before cutover buys nothing. No feature is
      deleted or reduced; this only sequences WHEN its new-backend home is
      built. Revisit if Kd later wants it visible at cutover → then a minimal
      read lands early instead.
      **INHERITED THREAT MODEL — read before ranking anyone by XP** (from the
      XP card's round-5 review, full text in master's DECISIONS): XP is safe
      today ONLY because it grants nothing. Every one of its four components is
      client-determined. PRIMARY vector: fabricated workout VOLUME — each
      accepted sync of a fresh client-generated `workoutId` mints 50 (base) +
      up to 50 (perfect-form bonus, since `avgFormScore` is client-sent per set
      and the server merely averages it), and **`POST /v1/workouts/sync` has NO
      per-route rate limit** (verified: `app.authenticate` is its only
      preHandler). SECOND: backdated `startedAt` (no past/future clamp) mints
      +10 per fabricated distinct day. The moment a leaderboard ranks on XP,
      both become value-granting inputs — a per-route limit plus v1 §14.1
      plausibility checks (P4.y) are the home for closing them, and v1 §14's
      "verified entries only" for global boards is the other half.
- [ ] 🔴 **Predictions** (PredictionsSection) — the 2B §5 card (P2.3 carve).
- [x] 🔴 **Exercise library content — DONE 2026-08-05, ALL THREE GATES PASSED.**
      Code `b96c009` · browser SMOKE 9/9 (:5034) · T3 round 1, 7 findings, zero
      visible, all fixed (:5104) · T3 round 2 THE CAP, 3 findings, zero visible,
      all fixed (:5199). **28/28 mutants RED, 0 survived, 0 invalid, and every
      target verified restored byte-exact against HEAD rather than on the
      harness's own say-so** — which is the point, since round 2's F1 was that
      harness printing PASS over live damage. 496/496.
      **This line was UN-TICKED once and re-ticked here.** `b96c009` ticked it
      `[x]` while its own HANDOFF block said "smoke and the fresh-chat T3 are
      both UNRUN" — :4718's F4 exactly, reverted there and at :4119 before that,
      third occurrence on this branch. A ticked line is the answer to "is this
      still to do?", and review rounds were still to do.
      (the exercise-library
      repoint; DECISIONS 2026-08-05). The screen is off the old backend: the LIST
      comes from `/v1/exercises`, and the WORDS come from `EXERCISE_CONTENT` in
      `packages/shared/src/exerciseContent.ts` — a verbatim port of
      `scripts/seed_exercises.py`, joined by slug. **Kd ruled the file, not
      columns**, shown both options: the Part 4 §3.4 DDL declares no column for
      name text / description / instructions, adding them would be inventing
      schema (R0.2), and `name_key` exists precisely because v1 §14's "message
      keys, not strings" model puts human text in locale tables. So there is NO
      migration in this card.
      **The port was PROVEN, not asserted**: 58 rows × 14 fields = 812 values
      compared against the JSON that Python's own `ast.literal_eval` produced
      from the seeder — 0 differences.
      **Each of the five old behaviours is answered, none dropped:**
      display names ✓ · instructions / common mistakes / muscles / equipment /
      difficulty / category / cal-per-min / default reps+sets ✓ · media ✓ (it was
      always local files in `utils/exerciseMedia.js`, matched by name — the old
      metered RapidAPI endpoint had NO caller) · search + category + difficulty
      filters ✓ **client-side** · the "58 Exercises" headline ✓ (exact, since the
      whole catalog is read).
      **`ai_supported` was deliberately NOT ported** — the seed marks EIGHT true
      and the engine ships THREE definitions, so copying it would badge five
      exercises with camera form-checking that does not happen. Kd ruled the
      badge is derived from the definitions the client holds, so it is true today
      and lights up by itself as the P4 line publishes each one.
      **Two behaviour changes a smoke will see:** the library now lists **58,
      not 56** (Part 4 §3.4:366-369 — "the `REMOVED_EXERCISES` frontend hack dies
      with the migration"), and a FAILED read now says so instead of drawing
      "No exercises found" over an empty grid.
      **WAS:** display names, instructions, media/GIFs, server-side search. The
      Part 4 §3.4 catalog is data-only
      (slug/nameKey/family/tier/met/equipment/muscles) and stores none of it.
      Owed to the P4 production line / Part 2 Appendix A localization.
      (DECISIONS 2026-07-16, Card 3.)
- [ ] 🟡 **Mountain Pose and Brisk Walking have no artwork — the only two of the
      58, and they are exactly the two this card un-hid.** Raised by the exercise
      library's T3 round 1 (2026-08-05) as a record note rather than a violation,
      and given a line here because **it is the one thing on this card a USER CAN
      SEE** and it was written down nowhere — neither DECISIONS :5002-5007 nor the
      smoke doc named it, so the next smoke run would report it as a defect (and
      the run on 2026-08-05 nearly did).
      **Measured, not inferred:** driving all 58 content names through the real
      `getExerciseMedia` lookup returns null for exactly these two; 56 of 58
      resolve. So both draw the 🏋️ placeholder card and open a detail panel with
      no photo and no GIFs.
      **Not a regression and not dishonest** — no artwork exists for them, and
      the alternative (hiding them) is the `REMOVED_EXERCISES` hack that Part 4
      §3.4:366-369 rules "dies with the migration". Closing this means SOURCING
      two images and two GIF pairs, which is an asset task, not a code one.
      Blocks nothing.
- [ ] 🟡 **Hindi and Assamese exercise copy.** `EXERCISE_CONTENT` is ENGLISH
      ONLY. This is not a regression — the old backend was English-only too — but
      it is the half of the 2026-08-05 ruling that is not yet built, and the
      ruling is what makes it buildable: the words are now a file keyed by slug,
      so translating them is a translation task and not an engineering one (Part
      2 Appendix A's own words about the fault-message table). Blocks nothing
      until a pilot gym wants it; belongs with the Appendix A locale work.
- [ ] ⚪ **Server-side exercise search, if the catalog ever outgrows one page.**
      Answered for now rather than deferred: 58 rows over a 100-row page limit is
      ONE request, so search and filters run in memory and respond with no round
      trip. **Re-entry trigger, stated so it is not a judgement call later:** if
      the catalog passes ~100 rows the client starts making two or more requests
      before it can draw anything, and `catalogListQuerySchema` (`.strict()`,
      `{limit, cursor}`) would need a search parameter. `CATALOG_MAX_PAGES` = 20
      is the guard until then, and a truncated read tells the user rather than
      drawing a short library.
- [ ] 🟡 **The Dashboard's "open this exercise" link still sends an OLD-backend
      id.** `Dashboard.jsx` links `/exercises?exercise=<ex.id>` where `ex` comes
      from `recommendationApi` — still on the old backend, so the id is a Mongo
      ObjectId. The library now resolves that parameter as a SLUG against the
      rows it has already read, so an old id matches nothing and simply opens no
      panel — which is exactly what a stale id already did, and the link is
      dead today anyway (the old backend gets no token since Card 1). NOT
      half-fixed from the library side: inventing a Mongo-id→slug map would be
      the fabrication class this project keeps deleting. **Closes with the
      recommendations repoint**, which owns the id.
- [x] 🔴 **THE EXERCISE CATALOG — DONE 2026-08-01** (DECISIONS :3538, commit on
      `web-repoint` the same day). 3 → **58** rows, verified against the live DB
      (`SELECT count(*) FROM exercises` = 58; pose 57 / timer 1). The reviewed
      table is `CATALOG_58` in `packages/shared/src/exerciseCatalog.ts` — Kd
      signed it off before any code was written (artifact `docs/catalog-58.md`),
      and the two SPEC GAPs in it were ruled by Kd (both F11: `brisk_walking`
      had no family, `arm_circles` had two). The seed imports that one table, so
      the API and the web cannot drift on what an exercise is called;
      `slugForLegacyName` is exact-match and returns null rather than guessing.
      api 381/381 · shared 41/41 · 9 shared mutants + 1 DB mutant, all RED
      against a verified green baseline. **The write-path line below is
      unblocked by this.** The original entry follows.
      **WAS: the exercise catalog holds 3 rows — every other exercise a user can
      pick is UNKNOWN to the new API, and its sets are SILENTLY DISCARDED.**
      Created 2026-08-01 (DECISIONS :3424), found while planning the web write
      path. **It had NO line anywhere in this file** — the gap was visible only
      as prose inside the write-path entry below ("nearly every exercise is
      log-only TODAY"), which is about DEFINITIONS, a different thing: an
      exercise can be hand-logged without a definition, but it cannot be STORED
      without a catalog row. Same shape of miss as the write-path line itself.
      **The chain, command-verified 2026-08-01:**
      1. `db/seed.ts:201-203` seeds exactly **3** exercises (squat, jump_squat,
         chair_squat) and `db/seed.ts:254` is the **only** insert site in
         `apps/api` (grep: one hit). The Mongo→PG tool adds none and says so
         (`tools/migrate-mongo/exerciseNames.ts:4-6`).
      2. `modules/workouts/repo.ts:58` filters sets whose slug has no row;
         `:71` flags the workout `unknown_exercise`; the parent workout is
         inserted REGARDLESS, so an all-unknown payload lands as a workout with
         `sets_count = 0`, `total_reps = 0`.
      3. `db/schema/training.ts:55-57` — `workout_sets.exercise_id` is NOT NULL
         with an FK, so "store it anyway" needs a migration AND an R0.3
         deviation against Part 4 §3.5. Kd did NOT choose that.
      4. There is **no name→slug resolver for a log-only set**. The engine path
         is unaffected only because definitions carry the plural legacy name as
         an alias (`definitions/squat.json:3`) and the compiled config takes the
         definition KEY (`definition/compile.ts:89`).
      **⇒ Until this line is closed, a hand-logged workout of anything but those
      three exercises would be ACCEPTED and then emptied — worse than today's
      missing data, because it writes a 0-rep workout into history.**
      **THIS BLOCKS THE WEB WRITE PATH BELOW** (Kd's ruling, DECISIONS :3424:
      catalog first). Scope when it runs: catalog rows for every exercise a user
      can pick, plus a REVIEWED name→slug table (the P1.8a-precedent instrument
      already exists in miniature at `tools/migrate-mongo/exerciseNames.ts`,
      covering **14** legacy names — not the library).
      **CORRECTED 2026-08-01, same day (DECISIONS :3501) — this line first
      claimed an OPEN RULING here and there is none.** The three unmapped legacy
      names (`exerciseNames.ts` rows 12–14: Arnold Shoulder Press, 1-Arm
      Half-Kneeling Lat Pulldown, 1 Leg Box Squat) are **not in the library**
      (`grep -in "arnold\|lat pulldown\|box squat" scripts/seed_exercises.py` →
      no match), so no user can pick or hand-log one; they exist only in historic
      legacy workout rows, which the migration already skips + flags. The spec
      rules the case directly: Part 4 §3.4:373 — "`arnold_shoulder_press` stays
      unseeded — first expansion candidate". **Nothing is owed for the write
      path, and Kd must NOT be asked to rule on it.**
      **The catalog decisions this card DOES need are likewise already ruled**
      (Part 4 §3.4:366-372): Mountain Pose → `status 'live'`, T3, F12, MET 2.3
      (the frontend's `REMOVED_EXERCISES` hack dies with the migration) · Brisk
      Walking → `tracking 'timer'`, excluded from every form-score surface.
      Catalog size is **58** (Part 2 §6:721, "verified, v1.1"); the visible
      library is 56 because of that same frontend hack.
      NOT this line: display names, instructions, media/GIFs and server-side
      search, which are the separate "Exercise library content" line above.
- [x] 🔴 **THE WORKOUT WRITE PATH — DONE 2026-08-02** (DECISIONS, web-repoint).
      Both halves shipped: the API half on 2026-08-01, the WEB half now. A
      hand-counted workout of any of the 58 catalog exercises reaches the new
      API with its real rep count, its own set ordinals and a per-set duration.
      **Kd's browser SMOKE PASSED and was verified in the database**, not merely
      in tests: a 3-rep hand-logged Push-ups set stored as `mode 'log_only'`,
      duration 19.2 s, `avg_form_score` NULL, `bundle_version` NULL, and
      `quality_flags []` — i.e. the server recognised the exercise rather than
      discarding the set. XP updated at the sync second.
      web 310/310 · 13 mutants across 2 files, all RED against a verified green
      baseline, all targets restored byte-for-byte · lint identical to HEAD ·
      TWO fresh-chat T3 rounds (5 findings each, ZERO VISIBLE in both), closed
      under the two-round cap.
      **THE TWO THINGS THIS LINE WAS HOLDING NOW HAVE THEIR OWN LINES BELOW** —
      the legacy dual-write removal, and a hole the web half creates. Neither is
      allowed to travel inside a ticked entry. The original follows.
      **WAS: and the ruling under it: where does a
      HAND-LOGGED workout live after the old backend is off?**
      Created 2026-08-01 (DECISIONS :2912). This was visible only as prose inside
      the calendar line below (:514) and had no line of its own; the audit rule
      exists for exactly this shape of miss.
      **The chain, every link command-verified this session:**
      1. `engine/sessionController.js:67` — `if (def == null) return; // no
         definition yet → log-only`.
      2. `ls packages/engine/src/definitions/` = **3** (squat, jump_squat,
         chair_squat) against the **58**-exercise catalog (CLAUDE.md:106). So
         nearly every exercise is log-only TODAY.
      3. `sync/syncClient.js:72` — an all-log-only workout is never queued.
      4. DECISIONS :75 — the server ENFORCES `sets[]` non-empty, so it would
         reject one even if sent.
      5. `pages/ActiveWorkout.jsx:536` — every workout is still written to the
         OLD backend via `completeSession`.
      **⇒ Today the new API holds only workouts containing one of three
      exercises. ⇒ After P2.8 switches the old backend off, a workout of any
      other exercise would be saved NOWHERE AT ALL.** That is data loss on the
      product's core action, and it blocks the cutover on its own terms.
      **What is owed FIRST is a Kd RULING, not code.** "All-log-only workouts are
      NOT synced" is Kd-approved (DECISIONS :67, P1.10c 2026-07-10) and was right
      for the sync contract — with no SetSummaries there is nothing
      engine-verified to send. It becomes a different question once the old
      backend is the only place those workouts live. Options exist (a log-only
      workout shape the server accepts; a separate manual-log surface; gating on
      P4 shipping definitions) and each has a different blast radius — R0.2, so
      none may be picked by a chat.
      **What it unblocks:** the calendar below, PostWorkout's summary, the
      Dashboard's stats — every workout-history surface reads whatever this
      ruling decides.
      **RULED AND API HALF DONE 2026-08-01 (DECISIONS :3085).** Kd ruled option
      A: the new API accepts hand-logged workouts. Part 6 §3.6 already promised
      it in its own user-facing copy ("your workout still counts"), so this was
      honouring the spec, not a new product call. Migration `0009_log_only_sets`
      (expand-only, SQL reviewed by Kd first) + the `setSummarySchema` union +
      the sync/read paths landed with 9 new real-Postgres tests, api 373/373.
      **[RULED 2026-08-01 — option A, DECISIONS :3298. No longer blocking.]**
      **WAS: blocking sub-item, open for Kd (T3 round 1 F3, DECISIONS :3199):** an
      all-log-only workout must still send a WORKOUT-level `engineVersion`
      (required string) and `defsVersion` (required positive int), both stored
      and served back by `GET /v1/workouts/:id`. The API card's own test hides
      this by hardcoding `"1.0.0"`/1 — the fabrication deleted at set level,
      performed at workout level by the fixture. It is invisible today and
      becomes real the moment the web half lands: `syncClient.js:40` builds that
      value as `summaries[0].engineVersion`, which does not exist when there are
      no summaries, so the next card must either invent a number or change this
      contract. Options: (a) make `defsVersion` nullable — matches Part 4
      §3.5:384, which declares `bundle_version int` NULLABLE while the payload
      forbids null; shared-schema only, no migration — and record that
      workout-level `engineVersion` means "the engine build the client was
      running", honest and non-null even when nothing was scored; or (b) a
      DEVIATION PROPOSAL to make `workouts.engine_version` nullable, which the
      spec declares NOT NULL (R0.3).
      **RESOLVED: Kd chose (a).** `engineVersion` at workout level now means
      "the engine build the CLIENT was running" — true whether or not anything
      was scored — and `defsVersion` is nullable, matching the spec DDL. No
      migration, no deviation. The web card can now build an all-log-only
      payload without inventing a number.
      **THE WEB HALF IS WHAT REMAINS AND THIS LINE STAYS OPEN FOR IT:**
      `ActiveWorkout.jsx:536` still posts every workout to the legacy backend and
      `syncClient.js:72` still refuses to queue an all-log-only one, so NOTHING
      has changed for a user yet and the cutover is still blocked. That is the
      next card. Also owed with it: `queueWorkoutSync` must build the log-only
      set shape, and the client must stop calling `completeSession`.
      **PLANNED 2026-08-01 AND BLOCKED, BOTH HALVES RULED BY Kd (DECISIONS
      :3424) — do NOT start this card until the CATALOG line above is closed:**
      1. ~~**BLOCKED ON THE CATALOG.**~~ **DISCHARGED 2026-08-01** (DECISIONS
         :3538): all 58 are seeded, so a hand-logged set of any pickable
         exercise now resolves to a real row. **This card is READY TO START.**
         It must resolve the exercise NAME through `slugForLegacyName`
         (`@app/shared`) — never by lowercasing the name itself, which resolves
         nothing (the slugs are singular, the names plural), and never by
         inventing a slug on a null, which the server would discard.
      2. **`completeSession` STAYS — the removal above is DEFERRED, not done,
         and this line is what holds it.** The web card DUAL-WRITES (new API in
         addition to the legacy save), exactly as engine workouts already do.
         Removal is discharged only when the post-workout summary, the Dashboard
         stats and the calendar have new-API homes; dropping it today makes the
         summary screen print duration/calories/form as 0 **and a plausible
         "+50 XP" that was never awarded** (the old handler recomputes that
         number: `backend-ml/app/routers/workouts.py:591`) — a screen that looks
         true and is false. No-removal rule: replacement before removal.
      3. **When it runs, hook `handleSetComplete` (`ActiveWorkout.jsx:386`) — the
         single funnel — plus the three `engineSetKey` bump sites (:426, :483,
         :508) and the discard at :359-366. NOT the rep-counter trigger:** a
         "Complete Set" BUTTON at :1004 ends a set before the rep target, and
         hooking the counter would lose every early-ended set.
      4. Also owed with it (recorded at DECISIONS :3332): the local
         `syncClient.test.js` "window is not defined" failure is fixed by THIS
         card, not by the catalog card (R1.1).
      5. **THE TRAP THAT WOULD RECORD EVERY HAND-LOGGED SET AS 0 REPS.**
         Command-verified 2026-08-01: the manual rep count lives ONLY in the
         `setReps` STATE (`ActiveWorkout.jsx:156`) and **nothing mirrors it into
         a ref** (grep: no `setRepsRef` exists). `handleSetComplete` is a
         `useCallback` whose deps (`[targetSets, restDuration, exercises,
         voiceOn]`, :412) rarely change after mount, so it stays pinned to an
         early render — reading `setReps` inside it yields that render's stale
         value. This is the SAME hazard the file already documents at :120-129
         for `elapsedSecs`/`repFormScores`, which is why `elapsedSecsRef` exists.
         A ref is required, or every hand-logged set syncs 0 reps while the
         screen shows the right number.
      6. Per-set DURATION has no source either: the page tracks whole-session
         elapsed time, movement-gated active seconds and total rest, but nothing
         per set — and `durationMs` is REQUIRED and non-null on every set in the
         wire contract. A per-set start timestamp is part of this card (wall
         clock is fine here — R5.1 binds `packages/engine`, not `apps/web`).
      7. Decided but not yet built (state it in the card's PLAN so it is
         reviewable): a set with 0 reps is not sent (nothing happened), and if
         an exercise name cannot be resolved to a slug the workout is NOT synced
         at all rather than synced partially — the legacy save still holds it,
         so nothing is lost while `completeSession` stays.
- [x] 🔴 **REMOVE THE LEGACY DUAL-WRITE (`completeSession`) from ActiveWorkout.**
      **DONE 2026-08-16.** Browser smoke **PASSED 9/9** with no old backend
      running at all (`RUNBOOK/smoke-dual-write-retirement.md` §RESULT); the
      mutation sweep — killed part-way on the first attempt, hence the earlier
      wording here — completed at **64 mutants · 55 RED · 4 alive · 5 not
      applied**, the nine bad rows being the pre-existing camera ones with their
      own line; and the fresh-chat T3 ran **two rounds**, round 1 finding one
      Critical/High (the Start button's error path deleted, DECISIONS :8610) and
      round 2 finding **ZERO Critical/High**, which is the severity gate's own
      ship condition (:5348). Ticking on code alone would have been :4718 F4 /
      :5034 — this ticks on code, a browser, a completed sweep and two reviews.
      The rest of this block describes what landed.
      `createSession` and `completeSession` both retired,
      in one card, as this line required. Every finished workout is now written
      ONCE, to `POST /v1/workouts/sync`, and starting a workout asks nothing of
      any server.
      **The condition was DISCHARGED, not waived** — each of the three surfaces
      named below was re-checked in the code before a line was deleted: the
      post-workout summary reads `GET /v1/workouts/:id/summary`
      (`PostWorkout.jsx:361`), the calendar reads `/v1/workouts`
      (`WorkoutCalendar.jsx:231`), the Dashboard reads `api/dashboardStats.js`
      (`Dashboard.jsx:14-16`). **The "+50 XP" this entry warns about is now
      computed by the NEW server** (`modules/workouts/service.ts:322`,
      `xpEarnedForWorkout`) and rendered from `summary.xpEarned`
      (`PostWorkout.jsx:223`), so the failure it describes is unreachable.
      **A FINDING WORTH KEEPING: the legacy write had not been landing anyway.**
      `mlApi` sends a Bearer token read from `localStorage.accessToken`, and
      nothing has written that key since Card 1 moved auth to cookies
      (grep-verified: three hits, all reads). The old backend accepts nothing
      else (`backend-ml/app/core/security.py:16`, `HTTPBearer`). So the four
      OTHER old-backend surfaces fed by this write — badges, challenges, the
      leaderboard, predictions — were already frozen and cannot have been
      degraded by removing it. Each has its own line above, under Kd's
      dark-window ruling (:1020).
      **Also discharged by this card: the offline-start line below**, which
      named it in advance.
      Tests: 15 assertions measured RED against the pre-card source before the
      change was restored byte-exact. Smoke:
      `RUNBOOK/smoke-dual-write-retirement.md`.
      The original follows.
      Created 2026-08-02, lifted OUT of the write-path entry above as that entry
      was ticked — it was item 2 there and the entry said in terms "this line is
      what holds it", so ticking without re-homing it is precisely the silent
      loss the deferral rule exists to stop.
      **NOT A CLEANUP. Replacement before removal (Kd's ruling, DECISIONS
      :3424):** every finished workout is still written to BOTH backends, and
      the old one is what the post-workout summary, the Dashboard stats and the
      workout calendar read. Dropping the call today makes the summary screen
      print duration, calories and form as 0 **and a plausible "+50 XP" that was
      never awarded** — the old handler recomputes that number
      (`backend-ml/app/routers/workouts.py:591`). A screen that looks true and
      is false.
      **Discharged only when all three of those surfaces have new-API homes.**
      **PROGRESS 2026-08-06: one of the three is DONE** — the post-workout
      summary now reads `GET /v1/workouts/:id/summary` on the new API
      (DECISIONS, this date). The calendar was already repointed (:4622). **What
      remains is the Dashboard's stats**, its own line below.
      **AND A COUPLING THAT WAS NOT WRITTEN DOWN UNTIL NOW:** `createSession`
      cannot be dropped BEFORE `completeSession`, because the legacy save needs
      the session id the legacy start hands out. They retire together, in one
      card, after the Dashboard line below is ticked. A chat that proposes
      deleting either one alone has not read this paragraph.
- [ ] 🟡 **NINE MUTANTS GUARDING THE CAMERA-HANDOVER FIXES NO LONGER PROTECT
      ANYTHING — measured 2026-08-16 by the dual-write retirement's own sweep,
      and PRE-EXISTING, which was measured too rather than assumed.**
      `apps/web/tools/mutate-write-path.mjs` ran to completion for the first time
      since the camera cards landed: **60 mutants · 47 RED · 4 ALIVE · 5 NOT
      APPLIED**. All nine bad rows sit in the camera-stall / rep-ownership
      subsystem, which the dual-write card did not touch.
      **ALIVE (the anchored line still exists; no test notices it changing):**
      M44 a redo silently un-stalls a camera that is still dead · M50 a camera
      error is not sticky, so the camera takes the set back on recovery · M52
      backgrounding the tab kills the set's grading · M53 a redo carries the
      stall even when the camera is alive.
      **NOT APPLIED (anchor text no longer exists — silent disarmament, :5199's
      class):** M5 the set clock never restarts · M21 a camera error no longer
      offers hand counting · M28 the frame heartbeat is never updated · M40 the
      round-2 F1 bug put back · M43 the heartbeat is not re-stamped when the tab
      returns. Four one-line arrow functions were reformatted into blocks by a
      later card and every anchor through them stopped matching.
      **THE MEASUREMENT THAT MAKES "PRE-EXISTING" A FACT:** the entire pre-card
      tree — three sources AND three test files — was restored to `HEAD`, the
      baseline confirmed green at 157, and the four ALIVE mutants re-applied
      there. **All four are ALIVE at HEAD too**, so the dual-write card's seven
      re-anchored waiting points did not cause this. Restores sha256-verified.
      **WHY IT MATTERS: every one of these guards a defect Kd hit in his own
      browser** — :3917, :3987 and :4023 are three consecutive T3 rounds of the
      same user action (backgrounding the tab, redoing a set) losing a set's form
      score by a different route each time. The CODE still carries those fixes;
      what is gone is anything that would notice them being undone.
      **This is exactly :5348 rule 4's "tests that stay green are liars", found
      by the instrument rather than by a review.**
      **NOT FIXED HERE (R1.1):** re-anchoring five mutants and writing four
      assertions is a different card's diff, and the fix must not be
      re-anchoring alone — a mutant re-aimed until it goes red proves nothing
      (:4718 F2). Its card re-anchors, then measures each of the nine RED, then
      writes the missing assertion where it is not.
      **Its card should also add the guard this cannot have: the harness must
      fail LOUDER than exit 1** — the previous sweep was killed part-way and the
      table prints only on completion, so nobody could see which rows were bad.
- [ ] 🟡 **A USER CAN SAVE A BODY WEIGHT THE APP HAS NO BUSINESS ACCEPTING, AND
      EVERY CALORIE AND NUTRITION NUMBER IS COMPUTED FROM IT.** Found 2026-08-16
      during the dual-write smoke — **by Kd's question, not by the sheet**, which
      passed 9/9 with the defect on screen the whole time (:7222's shape).
      His account holds `users.weight_kg = 787.00`. **The formula is right and
      its INPUT is wrong**: `kcal = MET × weight × hours` (`calories.ts`), so his
      12 squats priced at 6.0 × 787 × 0.01356 h ≈ 64 kcal + rest = **65 kcal
      where a plausible weight gives ~6**.
      **The app never objected.** `weightKg` is bounded only by
      `numeric(5,2)`'s own range — `z.number().positive().lt(1000)`
      (`packages/shared/src/users.ts:41`, and the same bound again in
      `nutrition.ts:133`), and `Onboarding.jsx:291` mirrors it with "enter
      1–999 kg". **1–999 kg is a COLUMN's range being used as a HUMAN's range.**
      **What it reaches:** every workout's `kcal_point`, the Part 2B nutrition
      targets (Mifflin-St Jeor takes weight directly), and anything downstream
      that bands or totals calories.
      **What it does NOT do — stated so the severity is not overstated:** the
      figure shown is arithmetically TRUE for the weight stored, so this is not
      :5807's "on screen AND wrong" in the app's own terms. It is a missing
      plausibility bound on a value the whole calorie model rests on.
      **NOT FIXED HERE (R1.1)** — out of the dual-write card's diff entirely.
      Its card needs a NUMBER, which R0.2 forbids inventing: the spec names no
      bound, so the range is Kd's ruling, and the two schema sites plus the
      onboarding copy must move together or they will disagree (:1239, the class
      not the case). Kd was told about the 787 the moment it was traced.
- [ ] 🟡 **THE UNCATALOGUED-EXERCISE GUARD NOW MEANS THE OPPOSITE OF WHAT IT
      WAS BUILT TO MEAN, AND ONLY ITS COMMENT SAID SO.** Found by the
      dual-write T3, round 1, L-4. `queueWorkoutSync` refuses to sync a WHOLE
      workout if any one of its exercises has no catalog row
      (`apps/web/src/sync/syncClient.js`). **That was the safe choice while a
      legacy save existed to hold the workout intact; since 2026-08-16 there is
      no second save, so refusing now stores the workout NOWHERE.** The comment
      justifying it named the deleted function by name and has been corrected in
      place; the BEHAVIOUR is unchanged, deliberately.
      **Unreachable today and that is the only reason it is 🟡 rather than
      blocking**: all 58 library names resolve (asserted in
      `activeWorkoutEngine.test.js`), so no user can reach it. **It arms itself
      the moment a 59th exercise is added** — which P4 does routinely, on the way
      to 58→more definitions, and the person adding it will not naturally look
      here.
      **The ruling it needs is a choice between two losses** and is Kd's, not a
      chat's: sync the workout WITHOUT the unknown sets (a record that
      under-reports what the user did), or keep refusing (no record at all).
      A third option exists and may be better than both — resolve the name at
      sync time and reject at the CATALOG level instead, per DECISIONS
      2026-07-10's "unknown slug does NOT 4xx the sync" ruling, which already
      settled the same question on the server side and points at accepting the
      workout while flagging it.
- [x] 🔴 **THE DASHBOARD'S STATS HAVE NO NEW-API HOME (`workoutService.getStats`).**
      Created 2026-08-06 by the post-workout-summary card, which deliberately did
      NOT touch it (one backend surface per card — :2158's recorded lesson that
      eleven review rounds was a fault of the CARD's scope).
      `Dashboard.jsx:305` calls the old backend's `/workouts/stats` for total
      workouts, total calories, total minutes, this week's count, the 7-day
      activity strip and the last 5 workouts.
      **Most of it already exists on the new API and needs composing, not
      building:** `/v1/progress/overview` carries totals and streak,
      `/v1/gamification/me` carries level and XP, `/v1/workouts` carries the
      recent list, `/v1/progress/heatmap` carries daily activity. What has no
      home is the WEEKLY count and the exact shape.
      **This line is what the legacy dual-write above is waiting on.** Until it
      is ticked, `completeSession` stays and the app needs three servers to run.
      **DONE 2026-08-16 — smoke 10/10 and THREE fresh-chat T3 rounds, the last
      finding ZERO Critical/High in the code** (DECISIONS :8267, :8340, :8405).
      The two rounds in between each shipped a Critical in the SAME empty state —
      first denying a real history, then telling brand-new users their plan hid
      one — which fired Part I §2.5's escape hatch. **Kd ruled for the redesign
      over a third patch**, and `workoutPageSchema` gained `hasAnyWorkouts`
      because the plan gate alone cannot tell a new account from a gated one.
      That made this card touch `apps/api` after all — the "web-only" scope below
      was true when written and stopped being true at round 2.
      **This unblocks the legacy dual-write line above.** Web-only; no migration, no new endpoint, `apps/api` untouched.
      **THE "WEEKLY COUNT HAS NO HOME" CLAIM ABOVE IS FALSE and was corrected by
      measurement, not by opinion:** `/v1/progress/trend?period=7d` reports
      `workouts` per DAY (`repo.ts:354-359`, `GROUP BY day` in the user's own
      timezone), so the week's count is the sum over this week's days and the lit
      dots are the same days with a non-zero count. **ONE read now answers both**,
      which makes round 10 F1's defect — a session count printed over a picture
      of days, "10 of 7 days active" — unreachable by construction rather than by
      two fields agreeing. `/v1/progress/heatmap` was NOT used: it is a fixed
      365-day read where seven days are wanted.
      **FIVE THINGS A USER CAN SEE CHANGED** (three listed below when this was
      written; the empty-state rewrite and the form-score colour ladder are the
      fourth and fifth — see `BACKLOG.md` L24 and DECISIONS :8340), **all of them
      corrections:**
      (1) **The seven dots move to the user's OWN timezone.** The retired
      `weekDates` keyed by `toISOString()` — the UTC day of a locally-computed
      date — deliberately, because the old backend bucketed by
      `datetime.utcnow()`. Its own JSDoc called the residual "the existing OWED
      timezone-capture item, not this card's to fix"; this is the card that fixes
      it, and the key had to follow the server. Pinned by unit tests in BOTH
      directions (Asia/Kolkata and America/New_York) with the TZ-switch positive
      control, because under UTC the two spellings are identical and the
      assertion would be inert (:4267 F2's trap).
      (2) **"All time" becomes "last 90 days" on a gated plan.** `period=all` is
      unbounded so the plan floor cuts it EVERY time; the page printed "all time"
      over the clamped total, which is :598's f.4 on the first screen a user
      sees. `totalsWindowLabel` joins `heatmapCaption`/`recordsNote` in
      `progressClamp.js` — one ladder, three period-less captions.
      (3) **A recent workout's duration is a real duration.** The old payload
      carried whole MINUTES; the new one carries milliseconds, and rounding to
      match is :4182 verbatim (8,491 ms printed as "0m"). The rows reuse the
      CALENDAR's `readCalendarSession` + `formatDuration`/`formatKcal`/
      `formColor`, so the two screens cannot describe one workout two ways.
      **THE TOTALS WILL DROP for anyone with pre-August history, and this is not
      a defect:** the new database holds only what has been synced since the web
      write path shipped. The migration at P2.8 is what closes it. Kd was told
      before the card ran.
      **FOUND BY THE MUTATION AUDIT, not by review or by writing the code:**
      nothing pinned WHICH windows the page requests. Every fixture mocks the
      network functions, so they answer identically whatever they are asked — a
      page asking `period=30d` and captioning the answer "all time" passed every
      other test in the file. An argument assertion now pins all three calls
      (P1 RED).
      **AND THE AUDIT'S OWN ROW WAS WRONG FIRST:** P5 came back ALIVE, and the
      mutant was never the problem — the row named a test that reaches the
      UNKNOWN arm, where the mutation is inert by construction. Re-aimed at the
      lit-dots invariant it fails `expected +0 to be 2`, measured. :4718 F2's
      class from the other side: a `-t` filter makes the mutant→assertion mapping
      a one-line thing to get wrong, and a wrong mapping reports as a missing
      test.
      web **615/615** (was 586; +29) · `vite build` ✓ · eleven touched files
      lint clean · **15 mutants, 15 RED, 0 ALIVE, 0 never ran**, restores
      sha256-verified (`apps/web/tools/mutate-dashboard-stats.mjs`).
      **WHAT THIS UNBLOCKS AND DOES NOT DO:** :3424's condition for retiring
      `completeSession` + `createSession` — "until the Dashboard's stats have a
      new-API home too" — is now MET, so that pair is unblocked and retires in
      its OWN card. Nothing about how a workout is SAVED changed here, and a chat
      that reads this paragraph as licence to delete either call has not read the
      coupling paragraph above it.
      **UNRUN, and the tick waits on both:** `RUNBOOK/smoke-dashboard-stats.md`
      (8 steps; step 5 — are the flames on the right days — is the one worth
      doing in the evening or early morning, since that is the window the old
      UTC key was wrong in) and the fresh-chat T3.
- [ ] 🟡 **THE POST-WORKOUT SCREEN PRINTS THE INDIAN DATE FORMAT TO EVERY USER
      ON EARTH.** Created 2026-08-15 by the Dashboard-stats card. **Found by KD'S
      QUESTION, not by a review**: he asked whether the app was becoming
      India-specific, since it is meant for users everywhere. It was checked
      rather than reassured, and this is what the check found.
      `PostWorkout.jsx:133` hard-codes `toLocaleDateString('en-IN', …)`, so a
      user in Berlin or Chicago reads the day-month ordering of a country they
      are not in. **Cosmetic-but-WRONG-for-the-reader**, which is why it is 🟡
      and not ⚪: nothing is false, but the app is speaking one country's
      convention to everyone.
      **The Dashboard's own copy of this WAS fixed in the same card**, because
      that line was already being rewritten for the repoint — `[]` (the visitor's
      own locale) is what `Nutrition.jsx` and `Running.jsx` already pass, so the
      correct spelling was already in the codebase three times over. PostWorkout
      is out of that card's files (R1.1) and gets its own line rather than a
      drive-by edit.
      **Two SIBLINGS found in the same grep and NOT fixed either**, so the next
      card does the class and not the case (:1239, recorded violated at least
      five times): `MeasurementsTracker.jsx:245,:386` and `WorkoutCalendar.jsx:58`
      and `Settings.jsx:501` hard-code `'en-US'`. Same defect, different country.
      **NOT a defect and deliberately left alone:** `gyms.timezone` defaults to
      `Asia/Kolkata` and `currencyDisplay` to `INR` (`db/schema/tenancy.ts:27-29`).
      That is the SPEC's own DDL — `04-part4-database.md:172`, quoted — not an
      invented default, and no gym exists yet. Whether a gym owner picks their
      country during onboarding is a P3.10 product decision for Kd, and changing
      the DDL default would need a DEVIATION PROPOSAL (R0.3). Recorded here so
      the question is not lost, not as work owed.
      **Kd's wider point is ALREADY OPEN and is not closed by this line:**
      DECISIONS :592 — privacy-law scope beyond India (GDPR/CCPA/LGPD) — is his
      ruling to make and nothing has been built on it either way.

- [ ] ⚪ **A FRACTIONAL "HOURS TRAINED" IS FLOORED TO A WHOLE NUMBER ON SCREEN.**
      Created 2026-08-15 by the Dashboard-stats card, which measured it while
      writing an assertion and then could not write the assertion.
      `AnimatedNumber` (`Dashboard.jsx`) renders `Math.floor(ease * value)`, so
      the tile's 1.1 arrives in the DOM as **1**, and a user with 24 minutes of
      training reads **"0h"** above a sub-line correctly saying "24 minutes".
      **PRE-EXISTING and NOT introduced by the repoint** — the old payload's
      hours figure went through the same component — and out of that card's scope
      (R1.1), which is why the render test asserts the minutes sub-line instead
      and says so in a comment.
      ⚪ rather than 🟡 because the honest number is printed directly beneath it,
      so nothing on screen is unrecoverable; but it is the same family as :4182
      (a real duration displayed as a rounder, smaller one) and the fix is a
      one-line decision about whether that component should animate decimals at
      all — which also touches the three other tiles that use it.

- [ ] 🟡 **WORKOUT TEMPLATES HAVE NO ENDPOINTS (`WorkoutBuilder`).** Created
      2026-08-06 by the same card, same reason. Four old-backend calls —
      `saveTemplate` / `getTemplates` / `deleteTemplate` / `useTemplate`.
      **The TABLE already exists** (`workout_templates`, Part 4 §3.5 DDL,
      `db/schema/training.ts`, and in migration `0001_init` — verified). Only the
      endpoints are missing, so this is a smaller card than it looks and needs NO
      migration. Independent of everything above: it blocks nothing and nothing
      blocks it.
- [x] 🟡 **A WORKOUT CANNOT BE STARTED OFFLINE AT ALL.**
      **DONE 2026-08-16. SMOKE STEP 9 PASSED — Kd started a workout with the
      browser's Offline toggle on, then finished it online and watched the
      summary fill in.** The fresh-chat T3 closed at ZERO Critical/High in round
      2, so this ticks with its parent line above. **Half of Part 6 §3.6 is now
      true: the hand-counted path (55 of 58 exercises) works with no network at
      all. The other half — the pose model's CDN download for the 3 camera
      exercises — is still open and keeps its own line.**
      This one is a browser claim above all others: only Kd's own Offline toggle
      can settle it, and no jsdom test can. Built by the card this line named in
      advance — the legacy
      start went with the legacy save, so `handleStart` now writes the session
      locally and navigates, with no request of any kind. Three tests pin it,
      all measured RED against the pre-card source; smoke step 9 in
      `RUNBOOK/smoke-dual-write-retirement.md` is Kd's own check with the browser
      set to Offline.
      **HALF THE PROMISE, NOT ALL OF IT — read the last paragraph of this entry
      before quoting it as closed.** Its named sibling (the pose model
      downloading from a CDN) is still open, so a CAMERA workout still needs the
      internet to start. What is fixed is the hand-counted path, which is 55 of
      the 58 exercises.
      The original follows.
      Found in Kd's smoke,
      2026-08-07, step 8 — with the network set to Offline the pre-workout screen
      says **"Failed to start workout"** and nothing begins. Screenshot evidence:
      three failed `POST /workouts` XHRs from `workoutApi.js` (`createSession`)
      against the OLD backend, each preceded by a CORS preflight.
      **Pre-existing, NOT caused by the summary card, and out of its scope
      (R1.1) — recorded because it was tracked nowhere.**
      **Why it matters more than it looks:** the offline story is a headline
      promise of this product — Part 6 §3.6's copy says "your workout still
      counts", and the P1.10 Done gate is "a full workout completes with the API
      server off, then syncs". Today the sync half works and the START half does
      not, so the promise is half-true in the direction a user notices first.
      **Discharged by card 4** (retire the legacy start+save): once the workout id
      is minted client-side and nothing is asked of a server to begin, starting
      offline costs nothing. Until then it cannot be fixed without deleting the
      legacy save, which :3424 forbids.
      **Its second victim is the SMOKE DOC**, which told Kd to go offline and
      *then* start a workout — an instruction with nothing behind it, the same
      shape as :5034's "clear all filters". `RUNBOOK/smoke-workout-summary-
      repoint.md` step 8 now says start ONLINE, go offline mid-workout, finish.
      **NB the sibling line above** (the local pose model silently falling back to
      a CDN) means camera workouts need the internet too — two independent reasons
      the offline promise is not yet true, and they must both close.
- [ ] ⚪ **TWO ACTIVE-TIME ACCUMULATORS ARE NOW WRITTEN AND NEVER READ.** Created
      2026-08-16 by the legacy dual-write retirement, which removed their ONLY
      reader. `ActiveWorkout.jsx`'s per-second timer still fills
      `activeSecondsByExerciseRef` (per-exercise movement-gated seconds) and
      `activeEffortSecsRef` (their sum); both existed to feed the old backend's
      calorie estimate through `completeSession`, and nothing consumes either
      one now. A third, `activeEffortSecs` state, was ALREADY write-only before
      this card — its setter is called, its value is rendered nowhere.
      **NOT deleted here, deliberately (R1.1):** the accumulators sit inside the
      workout timer effect alongside `elapsedSecs`, which IS still read and IS
      part of the sync payload, so unpicking them is a change to the timer rather
      than a deletion of dead lines — a different blast radius from the one this
      card was approved for.
      **Why it is not free to leave:** dead surface reads as protection without
      being any (:5104 F1's recorded shape). A later reader will reasonably
      assume something depends on these numbers.
      **The one thing to check before deleting them:** the new API prices
      calories from what the ENGINE watched (`watchedMs`, kcal v3), not from a
      client movement-gate, so these are not a fallback for anything — confirm
      that against `kcalPointForSetsV3` and then remove all three together.
- [ ] ⚪ **THE MUTATION HARNESS DOES NOT YET DO WHAT RULE 4a SAYS.** Created
      2026-08-07 with Kd's audit-scoping ruling (DECISIONS :5857), because the
      RULE now says something the TOOL does not do — and a gap between what is
      written and what runs is exactly what this file exists to stop.
      Two things missing from `tools/mutate-workout-summary.mjs`:
      1. **No severity class per mutant.** 4a says slow DB mutants are spent only
         on Critical/High surfaces (ownership · numbers a user sees · anything
         that saves or syncs · money). Today every mutant is equal, so the rule
         can only be followed by hand — which is how a rule quietly becomes
         whatever chats have been doing with it (:5307's recorded lesson).
         Wanted: a `class` field, and a default run that skips the cosmetic ones.
      2. ~~**No local-Postgres switch.** Every DB mutant round-trips to Neon in
         ap-southeast-1.~~ **DONE 2026-08-21 (DECISIONS :13659).**
         `pnpm --filter api test:local` runs the suite against the
         `docker-compose.dev.yml` Postgres on host port 5433, and
         `mutate-orgs.mjs` now PRINTS which database it is about to use — host
         only, never the url — so a slow sweep explains itself instead of being
         wondered about. The runner's 4-worker cap also lifts itself when the
         database is local, since that cap exists solely for the remote pooler.
      **THE MEASUREMENT THIS LINE DEMANDED IS NOW MADE (V1), 2026-08-21:**
      | measured on this machine, same day | Singapore (Neon) | local docker |
      |---|---|---|
      | round-trip `select 1`, median | **202.9 ms** | **2.7 ms** |
      | `orgs.sweep.test.ts` (18 tests) | **158.2 s** | **10.8 s** — 14.7× |
      | `orgs.routes` + `orgs.sweep` (67) | **did not finish in 10 min** | 77 s |
      | whole api suite (536 tests, 44 files) | not measured | **51 s** |
      **Read the third row as a LOWER BOUND, not a ratio** — that run was killed
      at a ten-minute cap, and no full-suite Neon figure has been taken, so none
      may be quoted. The row that matters for the audit is the second: the
      harness runs a suite once PER MUTANT, so 14.7× is the per-mutant saving,
      and the clock card's six DB mutants would have cost ~16 minutes of
      Singapore against ~1 minute local. It also removes the cause of the two
      control aborts at :13336 — contention on a database in another country.
      **STILL OPEN: item 1, the severity class per mutant.** The rule still
      cannot be followed by the tool, only by hand.
- [ ] 🟡 **THE FULL api SUITE FLAKES: NINE TEST FILES RUN `seed()` AGAINST ONE
      SHARED DATABASE WHILE TWO ASSERT EXACT GLOBAL COUNTS.** Found 2026-08-21
      (DECISIONS :13746) by the local-Postgres switch — **PRE-EXISTING, and
      Neon's latency was HIDING it**: slow queries spread the suites out so the
      collision window rarely opened, and a database answering in 2.7 ms opens
      it often. **Measured over five full local runs: 536/536, 535/536,
      532/536, 535/536, 536/536**, with failures always in
      `catalog.seed.test.ts` ("seeds all 58 and nothing else") and
      `db.migration.test.ts` ("seed is idempotent"). **Pinned rather than
      guessed: those two pass TOGETHER 3/3 and ALONE 2/2 each, and fail only
      inside the full run** — so the mutation comes from a third file, not from
      either of them.
      **WHAT IT DOES AND DOES NOT COST.** A SCOPED run — one file, or a `-t`
      filter — is unaffected, **which is exactly what a mutation sweep runs**,
      so the audit instrument is untouched. What IS affected is any claim that
      the whole api suite is green: **there is no clean-run claim available
      until this closes**, and a single green run must not be quoted as one
      (:13247's Low-3, which recurred here in the session that fixed it).
      **THE FIX IS ISOLATION, NEVER A WORKER COUNT.** Raising the cap from 4 to
      8 was tried on 2026-08-21 and disproven — it flakes at 4 as well. Wanted:
      a schema or database per worker, or the two seed-asserting files run
      alone. **Not blocking anything** — a test-infrastructure defect, not a
      product one, and invisible until this week.
      **WORSE AS OF 2026-08-22 (DECISIONS :14401), and said rather than
      shrugged off.** The staff card's T3 round added twelve tests to
      `orgs.routes.test.ts`, which lengthens that file and changes the
      interleaving: **three full runs earlier that day were 100% green, and the
      two full runs after the fix round both failed the SAME three global-count
      assertions in `catalog.seed.test.ts`** (which passes **1/1 alone**). Nobody
      caused the race and nobody fixed it; what changed is how often it fires,
      and it will keep drifting that way as suites grow. **The practical cost is
      now real rather than theoretical: a card can no longer end on a clean
      full-suite figure**, so cards are quoting scoped runs, which is exactly the
      erosion this line predicted.
      **ALSO MEASURED 2026-08-22, because the HANDOFF instruction is subtly
      wrong: through corepack, `pnpm --filter api test:local -- <file>` does NOT
      scope** — pnpm consumes the `--` and all 44 files run, so several "scoped"
      figures quoted before this was noticed were whole-suite runs wearing a
      scoped label. **The form that works is `test:local <file>`** (no `--`).
      `-t` filters are unaffected, which is why the mutation sweep never hit it.
- [x] ~~🟡 **THE NEW API DOES NOT STORE A WORKOUT'S WALL-CLOCK DURATION.**~~
      **DONE 2026-08-07** (DECISIONS :5906) — Kd RULED the contract change this
      line said was needed. `durationSeconds` (the on-screen workout timer) and
      `restSeconds` are now OPTIONAL fields on the sync payload, stored in
      `duration_ms`; the §2.4 SetSummary is untouched, so the byte-match gate is
      unaffected, and there is no migration. **The prediction below held exactly:
      the sub-line returned by itself** the first time a real total was stored —
      and then printed "2 min total" under "1m 27s", because it rounded to
      minutes while the figure above it was exact. That is fixed too.
      **What this line did NOT anticipate:** the stored total made the SET spans
      falsifiable for the first time, and they were wrong — the set stopwatch
      counted paused time. Both were found by Kd's browser, not by the suites.
      Original text kept below, because the reasoning is what dated well.
- [ ] 🟡 ~~**THE NEW API DOES NOT STORE A WORKOUT'S WALL-CLOCK DURATION.**~~ Found
      2026-08-07 by the summary card's own mutation sweep (M6 survived), then
      measured against the live DB: **12 of 12 workouts had `duration_ms` exactly
      equal to the sum of their sets' durations**, because
      `repo.syncWorkout` derives it that way (`repo.ts:65`).
      **So "active time" and "total time" are ONE number, and the app had been
      drawing them as two.** The summary printed e.g. "31s" for Workout Time with
      "1 min total" beneath it and a tooltip explaining that the total includes
      "standing between reps and camera setup" — a rest gap that does not exist.
      The minute rounding is what made one number look like two.
      **Already done, so this line is only about the missing DATA:** the sub-line
      now renders only when the two genuinely differ (M21 pins it), and the
      contract's comment no longer claims a wall clock it does not have.
      **What is owed:** the old backend carried a real session duration
      (`duration_minutes`, the whole time on the workout screen). `ActiveWorkout`
      still measures it — `finalElapsedSecs` — and the v1 §5.3 sync payload has no
      field to put it in, so adding one is a CONTRACT change and needs a ruling,
      not a patch. Until then the summary honestly reports one duration.
      **The sub-line returns by itself the day a real total is stored** — no
      client change needed, which is why the field was kept rather than deleted.
- [ ] 🟡 **A HAND-COUNTED SET STILL BILLS IDLE TIME AS EXERCISE.** Created
      2026-08-07 by the kcal-v2 card (DECISIONS :5906), and **disclosed to Kd
      before he approved it** — not discovered afterwards.
      **This is Kd's own founding scenario, still unclosed for one branch:**
      "someone was doing something and camera was going but not doing exercise".
      For an ENGINE set that is now handled — rep time (reps × tempoMsAvg) is
      billed at the exercise MET and the rest of the span at `REST_MET` 1.8, so a
      zero-rep set costs the idle rate. **A LOG-ONLY set has no rep timings at
      all** — nothing measured it — so its whole span is billed at the exercise
      MET, exactly as v1 did.
      **Why it is not simply fixed:** there is no measurement to fix it WITH. The
      honest options are a per-set "how long were you actually working" input, or
      a definition-derived expected rep duration, or accepting it. All three are
      product decisions, not patches — **this line is a RULING request, not a bug
      report.**
      **Scope, so nobody over-reads it:** 55 of 58 exercises have no engine
      definition today, so this is the common path until P4 publishes more.
- [ ] ⚪ **THE CALORIE TOOLTIP IS TRUE FOR A v2 WORKOUT AND FALSE FOR A v1 ONE.**
      Created 2026-08-08 by T3 round 3 (Low-1) on the badge/calorie-cue card.
      The sentence under Calories describes the THREE-TIER v2 estimate: rest
      breaks at a low resting rate, paused time not counted, a camera-graded set
      billed for its rep time and a hand-counted set for its whole span. **A
      v1-priced workout (`kcalPointForSets`) does none of that** — the whole span
      goes at the exercise MET and rest is not counted at all — so three of the
      four clauses are wrong for one and only the hand-counted clause survives.
      **Why it is not fixed here: the screen cannot tell which formula priced the
      workout.** `workoutSummarySchema` carries no `kcalCalcVersion` and the
      service serves the stored figure, so branching the wording is a CONTRACT
      change — the same shape as the wall-clock-duration line above — not a
      client patch.
      **Why ⚪ and not a defect today, measured rather than assumed:** every
      workout a user can reach is v2. `ActiveWorkout` always sends an integer
      `restSeconds`, the sync client always admits it, and the service selects v2
      whenever it is present. The only route to this screen is completing a
      workout — nothing links to it from history — and legacy Mongo rows land at
      `kcal_calc_version = 0` under NEW uuids, so an old bookmark cannot resolve
      to one. **No reachable path exists today or at first cutover.**
      **What is owed:** the day `kcalCalcVersion` reaches the summary payload,
      the tooltip branches on it. Until then it describes the only formula any
      user can actually be shown, which is why it was left alone rather than made
      vaguer — a sentence true of everything says nothing about anything.
- [ ] ⚪ **`secondsLabel` prints "35m 0s" for a whole number of minutes.**
      Created 2026-08-07 by the kcal-v2 card. Now visible in TWO places rather
      than one: the Workout Time headline has always spelled an exact 15 minutes
      "15m 0s", and the total sub-line now matches it (deliberately — the
      mismatch was the defect Kd found). True, never wrong, and slightly clunky.
      **Deliberately NOT fixed here**: the helper is shared by the calendar, the
      share card and both summary figures, so dropping a zero seconds component
      is a display change to a real value across four surfaces (R1.1) and wants
      its own card. Sits with the existing fractional-input line for the same
      helper.
- [x] ~~🟡 **RULING NEEDED: reading a workout by DIRECT ID ignores the plan's
      history window.**~~ **RULED BY KD 2026-08-07: LEAVE IT. Struck, not
      deferred** (the desktop-webcam precedent, :456 — an item leaves this file by
      being done or by a ruling that it will never be built).
      **The ruling:** your own old workout stays readable by direct link; the
      records section stays scoped to the plan window. Kd was shown both
      alternatives and why each is worse — blocking the read hides a user's own
      data from them, and ungating the records would make the summary and the
      Progress screen disagree about who holds a record, which is the exact thing
      the summary card unified. What remains is a mild oddity, not a falsehood: a
      very old workout's records section is simply empty, because it cannot be a
      record inside the visible window.
      **KD ATTACHED A CONDITION, and it is already met — recorded so nobody
      "relaxes" the read gate and takes the tenancy with it:** *"if someone else
      puts that link they should not get access."* They do not, and it is proven
      three ways — Kd's own smoke step 7 (a second account got "Failed to load
      summary" and no figures), the cross-tenant test asserting a stranger's 404
      is byte-identical to an unknown id's, and mutation M8, which deletes
      `AND user_id = ${userId}` from the shared detail read and is caught.
      **This ruling is about the PLAN WINDOW only. It grants nothing about
      ownership, and the two must never be conflated.**
      Original text below.
- [ ] 🟡 ~~**RULING NEEDED: reading a workout by DIRECT ID ignores the plan's
      history window.**~~ (superseded by the ruling above; kept for its evidence)
      Raised by the summary card's T3 (round 1, L-7),
      2026-08-07, reported not fixed — it is a RULING, not a defect, and it is
      pre-existing.
      `GET /v1/workouts/:id` and `/v1/workouts/:id/summary` apply no
      `historyGate`, while `listWorkouts` and every `/v1/progress/*` read do. So
      a free user whose plan shows 90 days can still open a two-year-old workout
      by its id and read its calories, form score and duration — and, on the
      summary, the personal-records section beside those numbers IS gated, so one
      screen answers the same question two ways.
      **Not a regression and not a leak**: it is the caller's own data, and the
      detail route has behaved this way since P2.3. The summary is new SURFACE on
      the old behaviour, which is why the reviewer raised it here.
      **The question for Kd:** is the history window a LIST gate (you cannot
      browse past it) or a READ gate (you cannot see past it at all)? Part 4 §0.2
      says "read-gate, not deletion" and DECISIONS 2026-07-21 says older workouts
      are "still saved" — both consistent with either answer. Do NOT guess: a
      chat that clamps this silently makes a paying-feature decision (R3.1), and
      one that leaves it silently makes the summary's own two halves disagree.
- [ ] ⚪ **The post-workout summary's WORDS ship as English strings.** Created
      2026-08-06. Meal ideas, stretch suggestions and the three personal-record
      labels are a verbatim port of the old backend's hardcoded English
      (`apps/api/src/modules/workouts/summaryContent.ts`), not v1 §14 message
      keys. Same debt, same shape, as the exercise library's copy (:4945) — hi/as
      is a translation task, and these strings should move with those when it
      runs. Kd approved porting them as-is rather than inventing a scheme
      (2026-08-06 plan gate); recorded so "why is there English in the API?" has
      an answer that is not "nobody noticed".
- [x] 🔴 **A camera-graded set can still land NOWHERE — and now it can leave a
      workout with sets MISSING.** **CODE COMPLETE 2026-08-03 (DECISIONS :3720);
      TICKED 2026-08-04 on the smoke**: step 4 passed and is DB-verified
      (camera refused on squats → hand-counted → `squat`/`log_only`/reps 3,
      `exercise_id` resolved; runbook table). Step 6, this line's other route,
      was **SKIPPED BY KD'S RULING** (DECISIONS :4081); the reconcile code it
      would have exercised stays covered by the unit suite + mutation harness.
      Original text below. Fixed as part of Kd's ruling that
      hand counting is a user CHOICE: the page no longer decides who files a set
      by asking whether a definition exists — it records the user's count for
      every set and settles ownership once at workout end, when the engine's
      answer actually exists. **The proposed fix in this entry could not have
      worked**: it assumed hand-counted reps were available to fall back on, and
      on a camera-graded exercise the `+1 Rep` button was not rendered at all,
      so the count was always 0. **This entry's own suite asserted the defect as
      correct** — a test called "files nothing itself when the engine is
      analysing the set" expected an empty queue and described it as "nothing to
      send"; it is replaced by four that assert the opposite.
      **The mutant that reinstated the old gate (M8) was RETIRED in T3 round 3 —
      it could not be made to bite.** Corrected here rather than left standing:
      at capture time the engine has not filed yet, so a "has the engine filed
      this?" guard never fires, and an `analysisAvailable` guard reads the first
      render's value through a pinned callback. That impossibility IS this
      card's central design claim. The behaviour is covered instead by M4, M7
      (both capture call sites) and M47 (the recording itself, 12 tests red).
      Created 2026-08-02 (write-path T3 round 2,
      F-3, NOT-VISIBLE, deliberately not fixed inside that card — R1.1).
      `analysisAvailable` is true whenever a DEFINITION exists
      (`sessionController.js:59-71`), independent of the camera. But `endSet()`
      returns null when zero frames were fed (`:123`) — reachable when camera
      permission is denied (the page carries on; the error is an inline banner,
      not a block), while MediaPipe is still loading, or when the set ends
      inside that window. The engine then files nothing, and the web half's
      capture correctly stands aside because the engine "owns" that set. Neither
      side files it.
      **Before the web half this was invisible** — an all-squat workout simply
      synced nothing and the legacy save held it whole. Now: **squats mixed with
      any hand-logged exercise sync a workout with the squat sets missing**,
      which is the partial-workout outcome the unresolved-exercise guard exists
      to prevent, with no equivalent guard. The zero-frame guard itself is
      P1.10b's and deliberate (it suppresses phantom StrictMode summaries); what
      changed is the consequence.
      Scope when it runs: reconcile at workout end — any ordinal with reps but
      no summary from either side gets filed — or refuse the sync the way an
      unresolved exercise does. Both are more than a one-line fix, which is why
      this is a line and not a patch.
- [x] 🔴 **RE-RUN SMOKE STEPS 5 AND 6 — DISCHARGED 2026-08-04.** Step 5
      re-ran on the final code and met this line's exact closure condition: a
      TWO-set camera squat workout, BOTH sets `mode` `engine`, real scores
      83/83 (started 03:55 UTC 08-04; table in the runbook). Step 6 was
      **SKIPPED BY KD'S RULING** (DECISIONS :4081) — not run, not owed; the
      handover code and its unit/mutation coverage stay. Original text below.
      Reopened 2026-08-03 by T3 round 2. Step 5 (the camera control) DID pass and
      is recorded below, but **it passed on ROUND 1 CODE**, and round 2's F1
      showed that code filed the FIRST set of every camera workout as the user's
      own count with the form score discarded. Re-run against the current code it
      would have failed. **A passed control cannot be carried across a change to
      the thing it controls.** Step 6 (camera dies mid-set) is owed for the
      separate reason that its round-1 expectation was unreachable, so its
      "pass" proved nothing either.
      **To close:** one camera-on squat workout of TWO OR MORE sets — set 1 is
      the whole point — then the step-3 query showing BOTH sets `mode` `engine`
      with real `avg_form_score`. Then step 6.
- [x] 🔴 **The camera control step (smoke 5) — passed 2026-08-03 on ROUND 1
      code; see the reopened line above, which supersedes this for the tick.**
      Two real camera workouts stored the same day:
      `squat`/`engine`/3 reps/`avg_form_score` 100/`view` `side` (started
      07:45:37) and `squat`/`engine`/3 reps/score 67 (started 07:58:05). The
      camera path grades and stores exactly as before this card.
      **KEPT UNSTRUCK BECAUSE THE ROUTE TO IT IS THE LESSON.** For 35 minutes
      this looked like a card-breaking regression, and the chat said so. Three
      queries (07:19, 07:47, 07:50 UTC) found no engine row, and the chat used
      that absence to conclude, in order: that steps 5–6 wrote nothing; that the
      workout was NOT sitting in the browser queue ("ruled out"); and finally,
      after tracing `buildLogOnlySet` dropping 0-rep sets into `queueWorkoutSync`
      returning `no-sets` SILENTLY, that a camera workout measuring nothing
      vanishes without trace — "a real bug, and it's mine".
      **Every one of those was wrong, and the mechanism is worth knowing.** The
      07:45 workout was queued correctly and simply had not flushed: it reached
      the DB at 07:57:21, TWELVE MINUTES after it started, the instant Kd
      hard-reloaded and `AuthContext` kicked the app-load flush. That is the
      documented, accepted behaviour (DECISIONS 2026-07-15 — "a liveness delay,
      never data loss"), and it means **a DB query moments after a workout is not
      a valid test of whether it was saved.** The runbook told the reader to
      trust the DB over the screen and never said the DB can lag the screen by
      minutes; that is a real gap in the runbook, now fixed there.
      Two further self-inflicted confounds, both avoidable: the chat ran the
      mutation harness — which rewrites `ActiveWorkout.jsx` 26 times, live, under
      Kd's running dev server — WHILE Kd was mid-smoke, so an unknown part of his
      session exercised deliberately sabotaged code; and it read `no-sets`, a
      real silent path, as the explanation for an absence that had a duller
      cause. **Do not run the mutation harness while a smoke is in progress.**
      Smoke 6 (camera dies mid-set) remains screen-only — see its own line.
- ~~🟡 **Switching between the camera and hand counting MID-WORKOUT, by
      choice.**~~ **STRUCK 2026-08-03 — Kd RULED IT WILL NOT BE BUILT**, in
      response to the T3 F2 finding: "if some chooses by hand then they can not
      change to camera in the middle of exercise same for the other part." The
      choice is made before the workout and is fixed for its length, both ways.
      **This is a design rule now, not an absent feature**, and the code enforces
      it in two places: `engineStalled` is sticky for the set it fired on, and
      `reconcileSets` rule 1 gives a hand-owned set to the user even when the
      engine also filed one. The ruling is what CLOSED F2 — the alternative on
      the table was comparing rep counts, which is a worse rule for the same
      reason it was tempting: it makes the stored number depend on arithmetic the
      user cannot see.
      **NOT struck, and deliberately: the AUTOMATIC handover when the camera
      DIES.** That is not a switch the user chooses, it is the only alternative
      to a set they cannot finish, and removing it would restore the exact defect
      this card exists to kill. Camera → hand on failure: yes. Hand → camera
      ever: no.
- [x] 🟡 **DONE 2026-08-17 — the camera's downloads are bundled; a workout now
      survives losing the network.** Smoke PASS on Kd's desktop, fresh-chat T3
      round 1 (4 Critical/High, all fixed here), `RUNBOOK/smoke-pose-assets.md`
      carries the run. Originally raised 2026-08-03 from Kd's smoke console.
      **TWO THINGS THIS LINE SAID WERE MEASURED FALSE — corrected in place
      rather than quietly ticked, because the next chat plans against them:**
      (1) *"Likely a corrupt or LFS-pointer model file — check the file's real
      size first"* — **there was no file at all.** `public/models/` held one
      unrelated `.onnx` and no `.task`, so MediaPipe was handed Vite's SPA
      fallback (index.html at 200) where it expected a zip; `Unable to open zip
      archive` was the symptom of ABSENCE, not corruption.
      (2) *"~1.4 s later than it should"* — **the real saving is ~240 ms**
      (643 ms bundled vs 884 ms from the internet, both measured 2026-08-17;
      the 1.4 s came off a months-old console). The 2738 ms first-load figure in
      the same session is Vite cold start and is not comparable.
      **AND THE HALF THIS LINE NEVER NAMED:** the model was only half the
      download. ~9.6 MB of MediaPipe WebAssembly came from jsdelivr on every
      workout too, so bundling the model alone would have left camera workouts
      online-only WHILE LOOKING FIXED. Both halves ship now, fetched at build
      time and sha256-pinned, and the app REPORTS which source it used.
      Scope honestly stated: this is offline ONCE THE PAGE IS OPEN. There is no
      service worker, so a cold start with no internet still does not work — the
      🟡 line for that is separate.
- [ ] 🔴 **NOBODY HAS PROVED THE PRODUCTION BUILD RUNS THE ASSET FETCH.**
      **KD RULING 2026-08-17: not deploying now, so this is DEFERRED, not
      unanswered.** He was asked for the Vercel Build Command and answered that
      he does not want to deploy yet — which is a complete answer: with nothing
      live, nothing is currently broken for a user. **This line is the gate that
      must close BEFORE the first deploy, and it must not be re-asked as an open
      question in the meantime.** Raised by the fresh-chat T3 of the bundling
      card, 2026-08-17 (C/H-3), and it is the one finding that can make that
      whole card worthless to users. MEASURED:
      `.github/workflows/ci.yml` has no build job for `apps/web` at all (jobs are
      gate · engine-purity · gitleaks · migrations · db-tests), so
      `tools/fetch-pose-assets.mjs` never executes in CI; and there is no
      `vercel.json`, no deploy workflow, and no recorded build command anywhere
      in the repo. The deployable build is Vercel's, configured in a dashboard
      this repo cannot see. If that project overrides its Build Command — routine
      in a monorepo — `dist/` ships without the five files and every user's
      camera still needs the internet, with the smoke and the ticked line above
      both saying otherwise. The smoke proved the fix under `pnpm --filter web
      run dev` on localhost, which is NOT the path users get. Fix: read the
      Vercel Build Command, confirm it reaches `apps/web`'s `build` script, and
      RECORD it in the repo the way `infra/Caddyfile` records TLS termination as
      load-bearing. A contract test now pins the script's CONTENTS
      (`poseAssets.contract.test.js`), which closes the "someone edits
      package.json" half; this line is the "something else runs instead" half.
- [ ] 🟡 **The camera runs 0.10.35's JavaScript against 0.10.21's WebAssembly,
      deliberately, and it must be fixed WITH the model swap and not before.**
      Recorded 2026-08-17 with the bundling card, which pinned the bundled WASM
      to **0.10.21** while `package.json` says **^0.10.35**. This is not an
      oversight to tidy: the WASM is where inference happens, so 21 produced
      every landmark this project has ever measured, including the 13 clips
      behind Kd's `bone_stretch > 0.923` person-gate ruling. Copying
      node_modules' 35 would have been tidier and would have quietly changed
      what the camera sees.
      **2026-08-17, SAME DAY — THE MODEL SWAP HAPPENED AND THIS DID NOT MOVE
      WITH IT, deliberately.** The line above said "both land together"; the
      reason for that clause was *never* simultaneity, it was "do not change the
      frames for a tidy-up". Doing both in one edit would have made the outcome
      unattributable — if counting gets worse nobody could say whether it was
      the model or the runtime — so they are SEQUENCED instead, each measured.
      That is the intent honoured, not waived. **This is now the second of two
      frame-changing edits and it lands after the model swap has been smoked**,
      re-measured against a fresh recording, never blind.
- [ ] 🟡 **`Maximum update depth exceeded`, repeatedly, throughout every camera
      workout.** Found 2026-08-17 in Kd's smoke console. React is warning that
      `setKeypointsData` — the ~30 fps overlay publish in `usePoseDetection` —
      is driven from a `requestAnimationFrame` chain it counts as nested
      updates. NOT caused by the bundling card and not fixed by it (R1.1):
      MEASURED, that card changed **zero** lines touching that setter or the
      frame loop (`git diff` count = 0) and adds no per-frame state update.
      Recorded nowhere in the repo before today, which is why it gets a line
      rather than a shrug. No user-visible symptom was observed — reps counted
      and the summary was normal — but it is per-frame React work on the exact
      path whose delivered rate is already 9–12 fps against a target of 15, so
      it belongs with the throughput ladder rather than on its own.
- [ ] 🟡 **Finishing a workout asks for its summary before the save has
      finished, gets a 404, and is rescued only by a retry.** Found 2026-08-17
      in the bundling card's smoke, in the API log rather than on screen. MEASURED
      on Kd's machine: `POST /v1/workouts/sync` took **34.7 s**; `GET
      /v1/workouts/{id}/summary` was issued **1.8 s** after it started, returned
      **404** at 10.1 s, and a retry returned **200**. Self-healing there, and
      Kd saw a normal summary — but the ordering is a race, not a slow path, so
      on a slow link a user can be shown the broken state first. NOT the bundling
      card's (R1.1 — it touched no save path). Two things to weigh together when
      this is picked up: the read should be sequenced after the write rather
      than raced against it, and a 34-second save is its own question.
- [ ] 🟡 **Every web build ships a 17 MB model file from the retired Python
      backend.** `dist/models/ctr_gcn_clean_ensemble_quant.onnx`, flagged by the
      T3 of the bundling card 2026-08-17 (L4) and left untouched under R1.1. It
      is the only other thing in `public/models/`, it belongs to the ML service
      the migration decommissioned, and nothing in the web app references it.
      Deleting it is almost certainly right and is deliberately NOT being done on
      a card about a different file — confirm nothing reads it, then remove.
- [ ] 🟡 **Replace the "who is counting this set?" if-ladder with one explicit
      state machine.** Raised 2026-08-04 after FOUR T3 rounds found ELEVEN
      blocking defects, and the same one kept returning in a new disguise: the
      hidden-tab/backgrounded-camera failure was found and "fixed" in rounds 2,
      3 AND 4, by three different routes (the stall poll, the mute latch, the
      error stamp). Each fix guarded one path; the next round found the next.
      **The cause is the shape of the code, and CLAUDE.md R2.4 already forbids
      it**: `countItYourself` is a four-term boolean OR, fed by a sticky key
      written from two separate effects, with `document.hidden` guards in two
      places and a special case for redo — the "ad-hoc if-ladder" the rule names.
      Nobody can enumerate its states, which is why every round found a new
      combination rather than a new mistake.
      **Shape of the replacement:** one pure reducer over three states —
      `deciding` (the hook has not answered for this exercise) · `camera` · `you`
      — with an explicit transition table: the hook answers → camera or you; a
      camera failure or stall → you, locked for the set; hidden/paused/resting →
      NO transition; a new set → deciding. Then a table test walks every row, and
      a new situation must be ADDED as a row or the test fails.
      **DELIBERATELY NOT DONE INSIDE THIS CARD (Kd, 2026-08-04).** The chat
      proposed doing it immediately; Kd's judgement was that a rewrite at the end
      of an exhausted four-round card is how you get rounds five, six and seven,
      and that the exit is his smoke run, not more new code. Correct call —
      recorded here so the idea is not lost, to be taken as its own small card in
      a fresh chat, on committed and smoke-passed code.
- [ ] 🟡 **`captureHandCountedSet` silently ignores render state — any future
      guard added inside it will not work.** Found 2026-08-03 by T3 round 2's
      mutation run, indirectly. It is a `useCallback` pinned to `[exercises]`, so
      anything it reads that is not a ref comes from the FIRST render of the
      workout. Today it reads only refs, deliberately and correctly. The hazard
      is the next edit: a reviewer or a chat adding an ordinary-looking condition
      like `if (analysisAvailable) return;` gets a guard that never fires — on
      every camera workout that value is `false` at first render, because the
      pose hook answers one commit later. **This was not theoretical: mutant M8
      injected exactly that guard and went ALIVE for precisely this reason.**
      Re-anchoring it onto a ref read did not help either — the second form asked
      "has the engine filed this ordinal?", which at capture time is always no —
      so M8 was RETIRED in round 3, with its reasoning kept where it stood in
      `mutate-write-path.mjs`. Nothing is broken now;
      what is owed is making it hard to get wrong — either widen the deps, or
      pass the values the function needs as arguments from its call sites.
- [ ] 🟡 **The Coach's message id still assumes a secure context — the assumption
      THIS card deleted.** T3 F8, 2026-08-03. Reported not fixed (R1.1): not this
      card's file. `coachApi.js` calls `crypto.randomUUID()` bare, under a comment
      justifying it as "the same requirement the sync path already relies on,
      ActiveWorkout.jsx". The sync path stopped relying on it the moment a workout
      could start without ever asking for a camera — `newWorkoutId` now falls back
      to `getRandomValues`. So on a plain-http origin (a phone opening the dev
      server by LAN address) sending a coach message throws where a workout now
      survives. The comment is the dangerous part: it cites a guarantee that no
      longer exists, so a reader checking it would conclude the call is safe.
      Fix is the same three-line fallback, or lift `newWorkoutId` into a shared
      helper both call.
- [ ] 🟡 **The camera is switched on before the user can say they don't want it.**
      T3 F9, 2026-08-03. Reported not fixed (R1.1): pre-existing mount behaviour,
      not something this card introduced. `PreWorkout` calls `getAvailableCameras()`
      on mount, which calls `getUserMedia` unconditionally, then starts the camera.
      So a user who always counts their own reps still gets a permission prompt and
      a lit recording light on every visit, and the new copy that says no camera is
      used is only true AFTER they have already been asked. The device list needs
      permission to carry labels, which is why it was written this way — but the
      list is only needed once the camera path is actually chosen.
- [ ] ⚪ **The rep-counting choice is not remembered between workouts.** Created
      2026-08-03. Every workout starts on "Use the camera" and a user who always
      counts by hand re-picks every time. Deliberately out of scope: per-user
      preference storage on this branch is `packages/shared` + the profile API,
      not a localStorage flag, and that is a card not a line of code.
- [ ] ⚪ **The 5-second camera-stall threshold has never been watched by a
      human.** Created 2026-08-03. `ENGINE_STALL_MS` in `ActiveWorkout.jsx` is
      how long a camera-graded set may produce no analysed frame before the
      screen offers hand counting. **It is not a spec value — there is none**
      (Part 0 rule 4 applies to spec numbers; this is a UI patience threshold).
      Chosen so a slow MediaPipe start does not flash the button and a dead
      camera does not cost a whole set. Never measured on a real slow phone,
      where model load is exactly the case it is trading against — the mobile
      camera smoke below is where it would be observed.
- [x] 🔴 **Workout history calendar — DONE 2026-08-04** (WorkoutCalendar →
      workoutApi.getHistory). **CLOSED under the two-round T3 cap after round 2
      (DECISIONS :4355): 6 findings, 1 user-visible, all fixed.** The visible one
      was a bold "0 active days this month" printed for a month the walk never
      finished reading — beneath the very caption admitting so; five others were
      states no render test had ever exercised (the truncation caption, the plan
      clamp's straddling arm, the "+N more" chip), each measured to survive with
      all 62 tests green. Round 1's two fixes were independently audited and both
      hold. Final: web 426/426, 29/29 mutants RED, `vite build` green. No
      re-smoke owed — both changed sentences need 1,000 workouts to reach, so no
      step of the 8-step smoke touches them.
      **HISTORY BELOW, kept because its lessons outlive the card.**
      **UNBLOCKED AND UNPARKED 2026-08-04 (DECISIONS :4119) — the code is now on
      `web-repoint`.** Two-round T3 cap, set before round 1.
      **SMOKE ROUND 1 RAN 2026-08-04 AND FAILED — one defect, VISIBLE, now
      FIXED (DECISIONS :4182).** Every duration on Kd's screen was false: real
      `duration_ms` of 8491/4767/36290/37681 displayed as `0m`/`0m`/`1m`/`1m`,
      i.e. two workouts shown as taking no time and two rounded UP past a minute
      they never reached. Cause: the OLD backend sent whole MINUTES, so rounding
      was right for the field this replaced and wrong for milliseconds — and
      every fixture in the suite used 1,800,000 ms, so no test could see it.
      Fixed to whole seconds through the shared `secondsLabel`; reads
      `8s`/`5s`/`36s`/`38s`. Failing tests shown RED first (R9.5); M23 guards the
      regression. 417/417, 23/23 mutants RED.
      **STEPS 1-4 OTHERWISE PASSED** — camera workouts 83%/84% in green,
      hand-counted ones `—` in the neutral tint, chips correct, and the mixed
      camera+hand workout rendered as ONE session with both chips.
      **SMOKE FULLY DISCHARGED 2026-08-04 — ALL 8 STEPS PASS on `5133114`**
      (result table in `RUNBOOK/smoke-workout-calendar.md`). The re-smoke of
      steps 1-4 was run on the FIXED bytes rather than carried over, because the
      numbers Kd had judged were the ones that changed (the XP-card precedent):
      the four sessions now read `8s`/`5s`/`36s`/`38s`, confirmed by Kd.
      Steps 5-8 had never run before today and all pass — including step 8, the
      hand-counted case written for this card's own new coverage.
      **T3 ROUND 1 (2026-08-04, DECISIONS :4267): 6 findings, 1 VISIBLE, ALL
      FIXED.**
      F1 (VISIBLE) was the duration defect's twin: the walk pages BACKWARDS from
      today, so an unreadable row from a NEWER month was counted and printed as
      "1 workout couldn't be read" over a month that had read perfectly — and
      every fixture put its unreadable rows INSIDE the viewed month, so none
      could see it. F2 (blocking, not visible) was measured both ways: the
      day-bucketing guard was **inert in CI** — with the UTC-day defect live the
      suites went 57/57 GREEN under TZ=UTC and RED only under Asia/Kolkata, and
      runners are UTC. Zone now pinned in `apps/web/vitest.config.js`, with a
      test asserting the pin survives and `turbo.json`'s input glob widened so
      deleting it cannot be masked by a cache hit.
      **The harness's OWN bite-check was blind** and that is the finding to
      remember: it claimed "every sed is proven to have bitten (md5 must
      change)", but the files are CRLF and `sed -i` rewrites them to LF, so the
      md5 moved on a sed matching nothing. A mutation whose anchor had DRIFTED
      was therefore reported as a missing TEST. Fixed to compare content; the
      false header claim corrected in place. Same class as DECISIONS :3720.
      Two untracked deferrals it surfaced now have their own lines below (the
      calorie BANDING rule, and the unit-drift gap in the reader's stand-in for
      `safeParse`).
      Measured after the round: web **422/422**, **25 mutants 25 RED, 0 alive,
      0 invalid**, `vite build` green, lint 1 pre-existing error (own line).
      **WHAT DISCHARGED THE BLOCK** was other cards, not a ruling here: blocker 1
      below said the new API held only squat / jump-squat / chair-squat
      workouts, and the 58-exercise catalog (:3538) plus the web write path
      (:3610) closed that; the rep-choice smoke (:4081) confirmed a hand-counted
      workout reaches the API from a real browser.
      **THE ONE GAP THE PARKED CODE HAD, and it is a date.** The screen was
      built 2026-08-01; hand-counted workouts first reached the new API on
      2026-08-02. So no parked fixture carried their shape — real duration, real
      kcal, and NO form score (migration 0009's CHECK forbids a log-only set
      from carrying one). The code was already correct; the COVERAGE was absent,
      which is the gap this repo has lost eight rounds to. Five render tests and
      mutations M19–M22 added. Measured: web 413/413, 22/22 mutants RED with a
      green baseline before AND after, `vite build` green.
      **ALSO CORRECTED IN THAT COMMIT:** `RUNBOOK/smoke-workout-calendar.md`
      claimed an unknown Form score was "not browser-reachable". True when
      written, false since 2026-08-02. Step 8 walks it now, and the smoke's setup
      warns that pre-2026-08-02 months look emptier here than in the old app —
      those workouts exist in the old backend alone, so that is not a defect to
      report.
      **The blockers below are kept as the record of why it waited. Blocker 1 is
      DISCHARGED; 2 and 3 were solved in the parked work itself.**
      **THE ORIGINAL ENTRY FOLLOWS AND ITS PRESENT TENSE IS 2026-08-01's** — in
      particular "code is on branch `workout-calendar-parked`, deliberately NOT
      on `web-repoint`" was true then and is superseded above. The branch is
      left in place unmerged as the provenance of these files.
      A chat
      recommended this card to Kd as the cheapest one left — the THIRD time,
      on the reasoning the next line pre-refutes — built it to PROVE (320/321,
      18/18 mutants), and only then read this entry. Code is on branch
      `workout-calendar-parked`, deliberately NOT on `web-repoint`, which merges
      wholesale at cutover and would have ARMED the broken repoint. Blockers 2
      and 3 below were solved in that work (detail endpoint for names; the Card-5d
      page-walk) and the dead `getHistory` duplicate is fixed there too, so the
      card resumes at the smoke + T3 once the WRITE-PATH item above is ruled.
      `/v1/workouts` exists, which is why this was twice (wrongly) recommended
      as the cheapest card left; existence is not usability, and three separate
      blockers were found only on the third check (2026-07-21):
      1. **THE BLOCKER — the new API holds only a SUBSET of workouts.**
         `syncClient.js:72` — `if (!summaries || summaries.length === 0) return
         { queued:false, reason:'log-only' }` — so an all-log-only workout
         (no engine-scored sets) is deliberately never synced (the ruling at
         DECISIONS 2026-07-10 P1.10c: with no SetSummaries there is nothing
         engine-verified to send, and `sets: []` would record an empty engine
         workout). Meanwhile `ActiveWorkout.jsx:536` still writes EVERY workout
         to the old backend via `completeSession`. Repointing the calendar
         today would therefore BLANK every hand-logged day — history showing
         less training than actually happened. **Unblocks only when the workout
         WRITE path moves to the new API, which is cutover work itself.**
      2. The list item carries no exercise breakdown (`workoutListItemSchema`:
         setsCount/totalReps only). Exercise identity lives on the per-workout
         DETAIL endpoint (N+1 for a month view) and as SLUGS — display names
         are the separate owed "exercise library content" card.
      3. `/v1/workouts` is a keyset cursor list with no month filter, so a
         month view needs the page-walk pattern from Card 5d.
      Also fix while here: `workoutApi.js` declares **`getHistory` TWICE** in
      one object literal (lines 5 and 9) — the second silently wins, so the
      `(limit)` variant is dead code and a footgun.
- [x] 🔴 **Dashboard XP — DONE 2026-07-30**, ticked with the XP display line above under THE CAP after T3 round 11. (Was: UNTICKED 2026-07-26 by its own T3, STILL OFF after round 4.)
      **SMOKE HALF DISCHARGED 2026-07-28 — the re-smoke PASSED, all 11 steps**
      (`RUNBOOK/smoke-xp-dashboard.md`). Step 6 is this line's own defect and it
      is CLOSED at the browser: in the `statsEmpty` state — a 200 carrying
      `{"stats":{}}`, the exact payload round 4 F2 was about — the three stat
      cards read `—`, not "0 workouts / 0h / 0 kcal". Step 17 (`emptyLists`)
      confirms the opposite sign still works: a zero the server actually sent
      still renders as `0`. **DONE 2026-07-30 — ticked with the XP display line
      above, under THE CAP after T3 round 11.** (Was: tick stays off
      pending T3 round 8; rounds 8, 9, 10 and 11 all ran.) The
      original entry follows. The
      card repointed XP but left the page's OTHER six figures fabricating
      (`s.total_workouts || 0` and friends), and `stats` is null whenever the old
      read fails — so a real "Level 2" sat beside three fabricated zeros and lent
      them credibility, while the strip below it correctly showed "—/—".
      Round 3 "fixed" this with `statsKnown`; **round 4 F2 found that fix was the
      SAME DEFECT under a new name** — `Boolean(stats?.stats)` asserted the
      envelope, then six sites read fields off it with `?? 0`, so a 200 carrying
      `{stats:{}}` (or any subset missing `total_minutes`) still printed
      "0 workouts / 0h / 0 kcal" as fact. That is verbatim the shape round 3 had
      just deleted from two OTHER files and shipped here in the same commit. The
      guard could not catch it because it banned `|| 0` and PERMITTED `?? 0`,
      which is the spelling the code was actually written in.
      Round 4 also found the week strip claiming seven untrained days it knew
      nothing about (F3), beside its own correct "unavailable" caption.
      Now fixed per-field through `readStatsView`, with the envelope gate gone
      entirely and render tests covering `{stats:{}}`, a partial 200, and the
      unknown week strip. Re-ticks on a fresh smoke AND a clean round 5.
      The DECISIONS entry calling that mix "honest" was false and is struck there.
      Kd chose
      option (a) on 2026-07-26 (ship the XP card, then this immediately) and
      confirmed the defect from his own re-smoke screenshot: the same page read
      "Level 1 / 0 XP earned" in a stat card and "0/100 XP → Level 2" in the
      Experience Points panel while the strip below it read "330 XP · Level 2".
      All four Dashboard sites now read the new API through the same `useXp()`
      hook and the shared formatters: the stat card's level + total, the XPBar,
      and the small "Level" figure. **The `xp % 100` maths is deleted FROM THIS
      PAGE** — the original wording said "DELETED" full stop, which its own T3
      showed was false of the app: `PostWorkout.jsx` still carries it, and has
      its own line below — it
      assumed every level costs 100 XP, but the curve is
      `floor(100*(level-1)^1.8)` (badges.py:215-227), so it was wrong for every
      user above level 2; the server's own `xpInLevel`/`xpForNext` are rendered
      instead. No fabricated defaults remain (`s.xp || 0`, `s.level || 1`, and
      XPBar's `xp = 0, level = 1` parameter defaults are all gone).
      The XP-guard's consumer list is DERIVED from the hook's importers, so it
      FAILED on this card until Dashboard was added — the guard working as
      designed rather than needing a human to remember. Both regressions
      mutation-verified caught: reinstating `xp?.level || 1`, and reinstating
      `xp.total % 100`. web 177 passed / 1 failed (178, the pre-existing
      syncClient quirk); lint clean on both touched files; `vite build` green.
      **SMOKE PASSED (Kd, 2026-07-26):** the stat card read "Level 2 / 330 XP
      earned", the Experience Points panel read "Level 2 / 230/248 XP → Level 3"
      with the bar nearly full, and all three XP surfaces on the page agreed
      with the sidebar and with `/v1/gamification/me`. The contradiction that
      the XP card's own smoke exposed — a real level beside a fabricated one on
      one page — is closed.
      **Still owed with it:** a T3 — no independent review has seen this card,
      and on the XP card each of two rounds found the previous round's fix had
      opened something new.
      ORIGINAL ENTRY, kept because it is the evidence the deferral was recorded
      rather than remembered: "Dashboard's XP surfaces still fabricate — XPBar +
      Current Level StatCard." Kd-ruled OUT of the 2026-07-26 XP-display card and
      given this line in the same commit, per the deferral rule. `Dashboard.jsx` renders
      `s.xp || 0` / `s.level || 1` (StatCard, XPBar, and a "Level" stat row) off
      `workoutService.getStats()` — a **different** old endpoint from the two
      the XP card repointed, so folding it in would have meant a second repoint
      in one card. Per the no-removal rule it STAYS working on the old backend,
      untouched, until its card. Two things that card must not inherit:
      (a) the `|| 0` / `|| 1` fallbacks are the fabrication class the XP card
      exists to remove — Dashboard shows a real-looking "Level 1" and "0 XP" for
      everyone whose stats read fails; (b) `XPBar` renders
      `{progress}/100 XP → Level {level + 1}`, i.e. a **hardcoded 100-XP
      level**, but the real curve is not linear (L2=100, L3=348, L4=722 —
      `xp_for_level`, badges.py:215-227). Render the API's precomputed
      `xpInLevel`/`xpForNext`/`progressPct` via the existing `useXp()` hook;
      never client-side XP math. Unblocked today — the endpoint exists.
- [ ] 🟡 **`/dashboard` and `/achievements` redirect to `/login` when the OLD ML
      API is RUNNING and rejecting.** Found by the XP card's T3 (2026-07-26)
      while it was busy getting the same question wrong in the other direction.
      `mlApi` sources a Bearer from `localStorage.accessToken`, which Card 1 no
      longer writes, so every old-backend read 401s and `mlApi.js`'s response
      interceptor navigates to `/login` before the page paints. The planned
      Card-1 interim (DECISIONS 2026-07-15: "the planned multi-card
      consequence"), closing when `workoutApi` / `recommendationApi` /
      `gamificationApi.getOverview` get their own repoint cards (③/⑦).
      **THE NUANCE THAT MATTERS FOR EVERY SMOKE FROM NOW ON, and that the XP
      card originally got wrong:** this only happens when the old API is UP and
      answering 401. When it is simply NOT RUNNING — the ordinary local-dev
      state — the axios error carries no `response`, `error.response?.status`
      is undefined, no redirect fires, and the page renders its own failure
      state. So "old backend down" is MORE smokeable than "old backend up", and
      a card that assumes unreachability without checking which case it is in
      will under-claim what it can prove.
- [ ] 🟡 **Achievements can now show two contradictory XP totals for the same
      user.** Raised by the XP card's T3 (2026-07-26); correct under no-removal,
      but it was not recorded and it is visible. The page HEADER now reads the
      new API (`xp.level` / `xp.total`) while the leaderboard tab's rows —
      including the current user's own highlighted row — still read the OLD
      backend's `entry.level` / `entry.xp`. Before this card both came from one
      payload and agreed by construction; they are now two stores whose totals
      accrued independently (the new one recomputes from history and diverges
      by design — see `xp.ts`'s governing rule). Closes with the leaderboard
      card (P4.x), which is where `entry.*` gets its new-API home. Until then,
      "header level vs. my own leaderboard row may disagree" is an EXPECTED
      smoke observation, not a bug to chase.
- [ ] 🟡 **`.catch(console.error)` on axios errors logs the whole error object,
      including any Authorization header.** Pre-existing, R3.10. **CORRECTED
      2026-07-26 twice over by the T3s.** (a) The original line said the leaked
      value is the string "Bearer null" — FALSE: `mlApi.js` sets the header only
      `if (token)`, so on this branch NO Authorization header is attached at all.
      The item is real but LESS urgent than recorded, not more; it becomes real
      the day any client attaches a live token. (b) The line named only
      `GamificationStrip.jsx` and `Achievements.jsx` while its own criterion was
      "files the XP card edited" — `Dashboard.jsx` qualified too and was missing.
      Round 3 has since converted the two gamification call sites to the
      `err?.message` form as part of the `allSettled` change, so what remains is
      the wider sweep: every other `catch(console.error)` on an axios call in
      `apps/web`, `Dashboard.jsx` included.
- [x] 🔴 **`PostWorkout.jsx` has the same 100-XP-per-level bug the Dashboard
      card deleted — and it is shown after EVERY workout. DONE 2026-07-28,
      commits `c681b23` + the round-4 fixes.** Smoke passed 2026-07-27 on a
      Level-3 account; FOUR T3 rounds (7+8+8+9 findings, 7 blocking, all fixed),
      round 4 clean of user-visible defects and recommending the tick.
      **THE TICK'S HISTORY, kept because it is the point:** it went on early
      after round 1, and round 2 took it off — correctly, on two counts. (a) It
      named no commit while nothing was committed, against OWED's own "tick it,
      date it, NAME THE COMMIT". (b) The argument for ticking without a clean
      round — "round 1 found no behaviour defect, only gaps in the protection" —
      is what the re-tick precedent forecloses. It goes back on now under a
      stopping rule Kd set explicitly: a finding blocks the tick only if it is a
      defect a user could see. Round 4 found none, said so, and recommended
      this. (Round 2's finding was a VACUOUS ASSERTION over a screen-visible
      defect class — corrected at round 4 F4, which verified ShareCard already
      read `formatLevel(xp)` before round 1: the mutant would have been visible,
      the shipped code never was.)
      Found by the T3 on
      888e750 (its F4) and given this line because the MIGRATION STANCE requires
      the deferral to be recorded in the deferring commit; grep confirmed
      "PostWorkout" appeared in neither OWED.md nor DECISIONS.md before now.
      `const xpProgress = summary.current_xp % 100`, rendered by a three-span
      row as `Level {summary.current_level}` · `{xpProgress}/100 XP` ·
      `Level {summary.current_level + 1}` — the identical assumption, on a live
      route (App.jsx). The real curve is `floor(100*(level-1)^1.8)`, so it is
      wrong for every user above level 2.
      **QUOTE CORRECTED 2026-07-27:** this line used to render the second half
      as `{xpProgress}/100 XP → Level {summary.current_level + 1}`, which is the
      DASHBOARD's wording — PostWorkout has no arrow and splits the caption
      across three spans. Small, but it is a paraphrase of a file the writer had
      not opened, which is exactly what CITATION DISCIPLINE (DECISIONS
      2026-07-20) exists to stop: quote the text, do not reconstruct it.
      OUT of the Dashboard card's scope because it reads a different payload
      (`summary.*` from the workout-complete response, not `/v1/gamification/me`),
      so it needs its own repoint rather than a formatter swap. **OWED.md said
      "The `xp % 100` maths is DELETED" — true of the Dashboard, false of the
      app**, which is the "fix the class, not the case" failure this project
      keeps recording; that wording is corrected on the Dashboard line above.
      **STATUS 2026-07-28: the user-facing bug IS fixed and browser-verified**
      (smoke passed on a Level-3 account, where the right answer `332/374 XP`
      and the deleted maths `80/100 XP` are visibly different) — but the line
      stays open until a clean round and a commit. Two T3 rounds have now found
      the same shape: the fix is right, the protection around it is not. Three
      vacuous assertions across the two rounds, each satisfied by a DIFFERENT
      site than the one it named. What landed: the page takes the level and the
      position within it from `useXp()` through the shared formatters exactly as
      the Dashboard does, `xpProgress` is deleted, and no XP arithmetic remains
      on the page. The SHARE CARD moved to the same source in the same commit —
      it read `summary.current_level`, so the page and the downloadable PNG
      would otherwise have printed two different levels. Web-only: no API
      change, no migration, no new dependency.

- [ ] 🟡 **The post-workout XP bar no longer animates from where you were to
      where you are.** Raised by T3 round 4 (F6) as a deferral-rule gap: the
      PostWorkout repoint changed the bar's `initial` from
      `max(0, xpProgress − xp_earned)` to `0`, so it now fills from empty rather
      than sweeping the gain. The reasoning was sound and declared in DECISIONS
      — the old "before" was computed on the broken `% 100` curve, and
      reconstructing it today means arithmetic across two stores that diverge by
      design — but CLAUDE.md's rule is that a UI reduction forced by a missing
      backend surface gets an OWED LINE, and that commit added three and missed
      this one. What the user lost is the ANIMATION, not a number (the number it
      used to sweep from was wrong), which is why round 4 did not call it
      blocking. Closes when the new API carries a per-workout delta: the bar can
      then start at `progressPct − thatDelta` honestly, from one store.

- [ ] 🟡 **The post-workout XP can be one workout stale — on the one screen that
      exists to be about that workout.** Raised by the PostWorkout repoint
      (2026-07-27); recorded rather than fixed, because closing it is sync-card
      work and this card was scoped to the curve. `ActiveWorkout.jsx` calls
      `queueWorkoutSync(...)` FIRE-AND-FORGET and navigates to the summary route
      about two seconds later, while the new API recomputes XP server-side at
      `POST /v1/workouts/sync`. So `useXp()` here can read a total that does not
      yet include the workout just finished — and offline it certainly does,
      since the queue flushes later BY DESIGN (R10.3). Nothing is fabricated:
      every number shown is a real server value, and the `+N XP` delta beside it
      is the old store's own figure. But the screen can truthfully report a
      level that looks like the workout did not count, which is a poor thing for
      a congratulations page to do. Real fixes are a refetch on the
      sync-settled event, or a shared XP store with invalidation — the SAME
      mechanism the `useXp` staleness line needs, so they should be built
      together rather than twice.

- [x] 🟡 **`PostWorkout.jsx`'s `summary` payload — DONE 2026-07-30.** Was: UNPARSED,
      the class rounds 4-7 closed for the other three old-backend payloads.
      **CLOSED under THE CAP (DECISIONS :2692, ruled BEFORE round 3 ran): round 3
      returned nine findings and ZERO VISIBLE ones, so the card closes and this
      box ticks.** Commits `fb1956c` (the card) · `271bbc8` (smoke) · `677ba90`
      (round 1) · `b2fa37a` (round 2) · `1334236` (the cap) · this one (round 3).
      **WHAT THE TICK RESTS ON, stated so it cannot be misread later:** Kd's
      passed browser smoke, THREE independent fresh-chat reviews, 21 findings
      across them all fixed or given lines, and a mutation harness whose own three
      false-success modes were each found and closed. **Not "nobody found
      anything"** — every round found six to nine things, and not one of them was
      a defect a user could see. No component file changed in ANY of the three
      rounds (reviewer-verified, not merely claimed), so the bytes Kd smoked are
      the bytes that ship.
      **T3 ROUNDS 1, 2 AND 3: 6 + 6 + 9 findings, ZERO VISIBLE in any of them.**
      **T3 round 2 (2026-07-30, fresh chat; full entry DECISIONS :2614).** It
      reproduced both PROVE claims before writing a word and re-verified round 1's
      five claims, then found six more — all mutants over correct code.
      **F3 is the one to know: the mutation harness had NO GREEN BASELINE, so
      "RED" could not distinguish "an assertion caught it" from "the tests never
      ran"** — proven with a broken runner producing a full table of REDs and exit
      0. Fixed, and the fix verified with the reviewer's own probe (exit 1, table
      never reached). F1: the Workout Time SUB-LINE had no failing assertion and
      printed "NaNh NaNm total" under mutation — root cause, no fixture had
      `active_seconds` absent with `duration_minutes` present. F2: round 1's own
      `/null/` sweep was added at ONE of its two sites. F4: a comment's evidence
      was false, and the rig now carries both record shapes so that path is
      browser-reachable at last. F6: harness restoration was silent on an
      uncatchable kill.
      Now a green baseline plus **21 mutations, 21 RED**. web 272/273.
      **No component file changed in either round**, so nothing a user sees has
      moved since the smoked bytes.
      **THE PATTERN, recorded because it is the card's real finding:** "fixed the
      instance, left the class" has happened FOUR times here — `xp_earned` →
      `current_streak` → `durationMinutes` → the sweep's own second site — each
      found in the fix written for the previous one.
      **T3 round 1 (2026-07-30, fresh chat; full entry DECISIONS :2546).** Every
      finding was a MUTANT a user could have seen, over shipped code that is
      correct; none was deferred, so none created an OWED line. F1: the
      anti-fabrication sweep checked `undefined`/`NaN` — what the PRE-fix code
      produced — but not `null`, the one spelling the NEW code can produce.
      **F2 is the one to remember: `current_streak` rendered at both surfaces and
      was asserted at neither — the same rename regression this card already
      recorded, ONE FIELD OVER, in the same commit.** F3: all four list-element
      render bodies were unreachable from every fixture. F4: the empty-200 test
      proved the toast and not the redirect. F5: "13 mutations, 13 RED" was
      unreproducible from the repo — the harness now lives at
      `apps/web/tools/mutate-postworkout-summary.sh` and exits non-zero if a
      mutant survives. F6: a helper's doc claimed protection it could not give.
      Now **18 mutations, 18 RED**, five of which were GREEN before this round.
      web 270/271. **No component file changed, so no re-smoke is owed** (the
      Round B precedent, DECISIONS :1950).
      **SMOKE HALF DISCHARGED 2026-07-30: PASSED (Kd), on commit `fb1956c`**,
      reported as a blanket pass rather than step-by-step and recorded that way
      (result at `RUNBOOK/smoke-postworkout-summary.md`). The `healthy` CONTROL was
      part of the run, which is the step that matters most — it is the only one
      that can catch the fix dashing out numbers the backend really sent.
      **THE TICK IS KD'S CALL, and the honest case against ticking is recorded
      first.** This card's own predecessor writes, on the line above: "the
      argument for ticking without a clean round — *round 1 found no behaviour
      defect, only gaps in the protection* — is what the re-tick precedent
      forecloses." That describes rounds 1 AND 2 exactly, and round 2's reviewer
      declined to recommend closure for that reason in its own words: the
      instance-not-class pattern "is now the card's most reliable output, and each
      round has found it in the fix written for the previous one."
      **RESOLVED 2026-07-30 — THE CAP (Kd ruling, DECISIONS :2692), set BEFORE
      round 3 runs so it binds whatever comes back: ROUND 3 IS THE LAST ROUND.**
      Nothing VISIBLE ⇒ this line TICKS. Something VISIBLE ⇒ it is fixed and the
      line ticks on that fix. NOT-VISIBLE findings are fixed if cheap, else take
      their own lines here, and block nothing.
      Round 3 exists for ONE named reason rather than as another cycle: **round 2
      fixed the mutation harness itself and that fix is unaudited**, so every
      "21 RED" figure this card quotes rests on a baseline gate written by the same
      chat, in the same session it was told the instrument was untrustworthy.
      The evidence the cap rests on: rounds 1 and 2 each returned six findings and
      ZERO VISIBLE ones, from two independent fresh chats; neither changed a
      component file, so the bytes Kd smoked at `fb1956c` are still the shipping
      bytes. The card will tick on a passed smoke + three fresh-chat reviews + a
      baselined harness — not on "nobody found anything": twelve findings were
      found and all twelve were fixed.
      What landed: `readSummaryView` + `formGrade` + the time/percent formatters in
      `gamificationApi.js`, beside `readStatsView` — which parses a
      `workoutService` payload too, so the location is precedent and not a new
      pattern. All 34 bare reads across 9 fields go through it; ONE grade ladder
      serves the page AND the share card, so the PNG can no longer print
      "undefined% (D)"; a 200 with no `summary` key takes the page's EXISTING
      toast+redirect instead of rendering a blank white screen; a list arriving as
      a string can no longer reach `.map` and blank the page. web **269/270** (the
      1 is the `syncClient` env quirk on its own line below), **+21 tests**,
      **13 mutations / 13 RED**, lint parity measured at HEAD and after. Smoke
      steps at `RUNBOOK/smoke-postworkout-summary.md`; new `unscored` rig state.
      Full entry at DECISIONS :2444.
      **THE LESSON, recorded because it nearly shipped:** `xp_earned` survived the
      snake→camel rename at ONE of two sites, so the page's XP card read "—" for
      every workout while the PNG read "+70" — and all 7 render tests stayed
      GREEN, because a whole-document `/\+70/` sweep is satisfied by the SHARE
      CARD (round 1 F1 verbatim). Found by grep, not by the tests. The missing
      identity assertion now exists and its mutation is RED.
      ORIGINAL ENTRY FOLLOWS. Reported not fixed
      by the PostWorkout XP repoint (2026-07-27) under R1.1, and Kd ruled
      "record as OWED, fix XP only" at that card's plan gate: the named task was
      the XP curve, and adding a fourth reader would have doubled a card on the
      page carrying the app's last live XP defect. CONCRETE, not theoretical —
      `getFormGrade(summary.form_accuracy)` has no unknown arm, so an absent
      score falls through every threshold to the final `return`: grade **D**,
      "Keep practicing", in red, with the bar animating to `undefined%`. That is
      a definite bad-form verdict on a workout whose form we were never told,
      i.e. verbatim round 5 F3's defect ("an unknown accuracy painted RED by the
      <60 branch") one page along. **A SECOND CONCRETE CASE, found by the T3:**
      a 200 with no `summary` key sets `summary = undefined` WITHOUT throwing,
      so the catch never runs and the page renders BLANK — no toast, no
      redirect, no text. The smoke rig's `empty200` state serves exactly that,
      and its comment says so, meaning a white screen there is the known state
      rather than a broken rig.
      **COUNT CORRECTED 2026-07-27 (T3 F5) — the line said "roughly fourteen",
      which was a guess.** Measured: 40 `summary.*` occurrences, minus 3
      comment-only and 3 `xp_earned` (which IS guarded), = **34 bare reads
      across NINE distinct fields** — `active_seconds` (8), `form_accuracy` (6),
      `duration_minutes` (6), `personal_records` (4), `current_streak` (4),
      `exercises_count` (2), `calories_burned` (2), `stretches` (1),
      `meal_suggestions` (1). (The review that raised this said eight fields; it
      is nine. A finding is a claim and inherits V1 too.) The fix is the
      established shape — a `readSummaryView` alongside `readStatsView` — and
      its natural home is the `workoutApi` repoint card, since that is the
      client this payload arrives on.

- [x] ~~🟡 **The XP bar's width has no protection a render test can give it —
      framer-motion is invisible to jsdom.**~~ **STRUCK 2026-07-28: THE PREMISE
      WAS FALSE, and this card should never have existed.** Raised by the
      PostWorkout T3 round 1 on the claim that `animate` "never executes under
      jsdom — the node reads `width: 0px` in every state". Round 2 MEASURED it
      on framer-motion 12.42.2: `0px` is the `initial`, and after the element's
      own `delay: 0.8 + duration: 1` the node settles at the real width. Round 1
      read the DOM about 1.8s too early — the existing `waitFor` resolves long
      before the animation ends — and generalised one instant into "every
      state". Measuring the case and calling it the class, in the fix written
      for exactly that mistake.
      **Consequences, all now undone:** the bar is asserted in the DOM where it
      always could have been (`expect(…style.width).toBe('61.5%')`, which
      catches the destructure bypass the regex cannot see); round 4's standing
      "add a render assertion instead" was never actually overridden; and no
      framer-motion mock is needed, so the 28 tests in that file stay untouched.
      Kept struck rather than deleted, per the rule that items leave this file
      by being done or by a ruling — and because "a card raised on a premise
      nobody measured" is the failure worth being able to find again.

- [ ] 🟡 **`gamificationApi.test.js`'s `validXp` fixture is impossible.**
      Found by T3 round 2 while checking a claim in the PostWorkout card — the
      corrected render fixture's comment cited this one as corroboration, and it
      does not corroborate. It reads `total: 330, level: 3, xpInLevel: 52`, but
      330 is LEVEL 2 on this curve (`xpForLevel(3)` = 348).
      **COUNT CORRECTED 2026-07-28 (T3 round 3 F3) — this line said "four of its
      six fields are unreachable together", and no reading of the block yields
      four.** Measured against `xp.ts`'s own `xpProgress`: hold `total: 330` and
      FIVE are wrong (the truth for 330 is level 2 / 230 / 248 / 92.7 / 348);
      hold the other five and exactly ONE is — `{level:3, xpInLevel:52,
      xpForNext:374, progressPct:13.9, nextLevelAt:722}` is `xpProgress(400)` to
      the digit. **So the fix is one character class: `total: 400`.** The same
      sentence also named `nextLevelAt` 348 and then left it out of its own
      tally. Recompute from `xpProgress`, never by hand — which is the whole
      lesson of the fixture this one was cited to corroborate.
      Same class as the render fixture corrected on 2026-07-27, one file along,
      and the tests using it are passthrough/shape tests that would pass with any
      six numbers, which is why nothing caught it. NOT fixed by the PostWorkout
      card (R1.1 — it is the XP card's file and its assertions would need
      re-checking against real values).

- [ ] 🟡 **`Running.jsx` fabricates a level: `stats?.running_level ?? 1`.**
      Found by the PostWorkout T3 (2026-07-27) while checking whether the
      100-XP class was really closed. It is verbatim the `user?.level || 1`
      class deleted from the Sidebar and the `s.level || 1` class deleted from
      the Dashboard — a confident "Level 1" for a user whose level nobody knows
      — on a live screen, differing only in which payload it reads (running has
      its OWN progression, `running.py`'s `running_xp`, which is a separate
      system from `user_xp` and was explicitly out of that card's scope,
      DECISIONS 2026-07-25 D4). Not fixed here (R1.1: different payload,
      different card). Closes with the running/geo repoint.
- [ ] 🟡 **The sidebar level is STALE until a full page reload.** Raised by the
      XP card's T3 round 2 (2026-07-26), which correctly demolished the reason
      the code gave for its own design. `useXp` reads once with `[]` deps and
      `Sidebar` mounts in `AppLayout` and never unmounts across navigation, so
      after a workout sync the sidebar keeps showing the pre-sync level until
      the user reloads. The comment had claimed the hook AVOIDED the staleness
      that an AuthContext value would have; it does not — the two differ only in
      WHEN the single read happens, and the honest reason to prefer the hook is
      that it is contained, not that it is fresher. Kd's smoke did not catch it
      because step 6 said "complete a workout, then reload", and the reload is
      exactly what hides it. Real fixes: refetch on the sync event, or a shared
      store with invalidation (which pairs with the dedupe line below). Not
      built with the card because either one is the Card-2/6 widening Kd ruled
      out — but the card must not claim freshness it does not have.
- [x] 🟡 **The XP source guards catch spellings, not the whole class — DONE
      2026-07-26 (round 4), by making the DOM test the protection of record.**
      Kd approved `jsdom` + `@testing-library/react` (R1.4) and
      `apps/web/src/pages/xpDisplay.render.test.jsx` now carries 13 render
      assertions; `vitest.config.js` gives `*.render.test.jsx` a jsdom
      environment. This also closes the JSX-coverage gap recorded from Cards
      2/3/4 for these three screens.
      **THE ORIGINAL TEXT OF THIS LINE WAS ITSELF FALSE, and the correction is
      the point:** it claimed "eight real bypasses were mutation-tested and are
      caught, including … destructuring defaults". Round 4 F1(a) then defeated
      the guard with exactly a destructure — `const { level = 1 } = xp ?? {}` —
      which `FIELD_READ` structurally cannot match, because it requires a `.` or
      `[` after `xp` and a destructure has neither. The earlier mutation must
      have tested a different spelling than the one the sentence names. Recorded
      here rather than quietly overwritten: a guard's own coverage claim is
      exactly the kind of assertion that needs re-testing, not re-reading.
      Ten bypasses across four rounds is the evidence that source-text matching
      cannot close this class; the guard stays as a cheap tripwire and its header
      now says so in those words.
- [ ] ⚪ **Render-test coverage is three screens, not all XP consumers.**
      Recorded 2026-07-26 (round 4). `xpDisplay.render.test.jsx` covers
      Dashboard, GamificationStrip and Achievements. **`Sidebar.jsx` is a
      `useXp` consumer with NO render assertion** — during round 4's mutation
      (b) the fabrication was re-introduced there and only the source guard's new
      positive control caught it, not a DOM assertion. Add a Sidebar render case
      when its layout dependencies (AppLayout, router) are cheap to mount.
- [ ] ⚪ **The guard's per-file lists are still four hardcoded literals.**
      Recorded 2026-07-26 (round 4 F8), which found the header's claim that they
      were "DERIVED from xpConsumers()" false — only the field-read scan is
      derived. `gamificationApi.test.js` hardcodes paths in the `gated` list and
      in three per-site blocks, so a FIFTH consumer added tomorrow gets zero
      gating coverage and nothing turns red. Not fixed in round 4 because the
      render tests now carry the real protection and growing this file further is
      explicitly the wrong direction (see its header); revisit only if a fifth
      consumer actually appears.
- [ ] ⚪ **`useXp()` makes one request per mounting component.** Sidebar always
      mounts it; GamificationStrip and Achievements add a second on their pages.
      A shared cache / in-flight dedupe (or a context value with a
      post-sync refresh) is the eventual home — deliberately NOT built with the
      XP card, because an unproven cache is worse than a cheap authenticated
      GET, and a value read once at session adoption goes stale on every
      workout sync. (2026-07-26.)
- [ ] ⚪ **XP display in the workout calendar — CURRENTLY DEAD, do not "restore"
      it.** WorkoutCalendar renders XP behind `session.xp_earned > 0`, but the
      old backend NEVER WRITES `xp_earned` onto a workout: the completion
      handler computes it, `$inc`s the USER's total and returns it in that one
      response (workouts.py:221-259, :311), while the session `$set`
      (:192-203) stores only completed/calories/duration/active_seconds/
      form_accuracy/exercises/completed_at. `/history` then projects a field
      that was never written (:373) and reads `s.get("xp_earned", 0)` → 0 for
      every workout, so the block has never rendered for anyone. **The
      no-removal rule is therefore NOT engaged** — there is no live feature to
      preserve when the calendar eventually moves. Any real XP display is
      gated on the XP-storage card above (P2.3 GAP-1), not on this.
      (Found 2026-07-21 while planning the calendar card.)
      **AMENDED 2026-08-01 when the calendar actually moved (DECISIONS :2912).**
      The block is gone from `WorkoutCalendar.jsx` with the old payload, and
      nothing a user has seen was lost — this line's own finding is why. What
      this card ADDS to it, command-verified: per-workout XP has no home in the
      NEW schema either. `grep -rn "xp" apps/api/src/db/schema/workouts.ts`
      returns nothing, and `user_xp` (db/schema/game.ts:39) stores ONE running
      total per user with `level` derived on read. So a real per-workout XP
      display is a MIGRATION plus a sync-time write, not a client change — and
      it is the SAME gap PostWorkout carries (`PostWorkout.jsx:40`: "`xp_earned`
      STAYS on the old summary payload, because the new API has no [per-workout
      XP]"). One backend card would close both surfaces; neither can be closed
      from the web side.
      **AMENDED 2026-08-07 — HALF OF THIS IS NOW WRONG, and the correction is the
      useful part.** The summary card (DECISIONS :5438) closed the PostWorkout
      surface **without** a migration and **without** a sync-time write:
      `xpEarnedForWorkout` DERIVES the figure from the ported `XP_REWARDS`
      constants and facts already stored (the workout's `avg_form_score`, and
      whether its day continued a streak). So "a MIGRATION plus a sync-time
      write" was true of STORING a per-workout total and false of DISPLAYING one.
      The quoted `PostWorkout.jsx:40` comment is gone with it.
      **What is still open is the CALENDAR's per-workout XP**, which would need
      the same derivation applied to a list — cheap now that the function exists.
      **And a real trap this card met, worth carrying:** the derivation must
      credit `streak_day` the way the TOTAL does — once per DAY, not once per
      workout — or two workouts in a day each claim it and the screen out-runs
      the total (:5618 C/H-1, fixed by `hasEarlierWorkoutOnDay`). Any list
      version inherits that hazard.
- [x] 🔴 **Google login — DONE, SMOKE PASSED (Kd, 2026-07-24).** End-to-end
      browser click-through on the local stack succeeded: `/login` → "Continue
      with Google" → Google account chooser → callback → logged in. All three
      closing conditions met (master merged into `web-repoint` @ 57526aa; Google
      OAuth credentials created + redirect URI `http://localhost:3000/v1/auth/
      google/callback`; smoke passed). The un-tick (web-half T3, 2026-07-24) held
      exactly until the feature actually worked — the DPDP Day-14 precedent.
      API half merged to master 2026-07-24 (PR #48): `GET /v1/auth/google` +
      `/callback` set httpOnly-cookie sessions (no token in URL/localStorage),
      3-way upsert, email-verified via consumed token, CSRF state, per-IP limit;
      fresh-chat T3 (2 blocking + 2 low, all fixed + mutation-verified). Web half
      done on `web-repoint` (this branch): Login/Register buttons un-gated and
      pointing at `${VITE_API_URL}/v1/auth/google`; `/auth/google/success` route
      restored (bare route); Login toasts the callback's `?error=`;
      `GoogleAuthSuccess.jsx` REWRITTEN — the `#token`/localStorage/raw-`setUser`
      flow is GONE, it reads the cookie session AuthProvider restored (getMe →
      adoptSession) and routes via the pure `googleSuccessRoute` (unit-tested);
      `setUser` no longer exported from AuthContext.
      **CLOSES WHEN:** (1) master merged into `web-repoint` so the endpoint the
      buttons target exists ON THIS BRANCH (web-repoint trails master by 11 — the
      API is real, just not integrated here yet; without the merge the buttons
      404 in local dev/smoke), AND (2) Kd creates the Google OAuth credentials +
      sets the API's `WEB_ORIGIN` to the web origin, AND (3) the browser
      click-through passes. (v1 §6.1:438; DECISIONS 2026-07-15 Cards 1–2,
      2026-07-24 google-login.)
- [ ] 🔴 **Avatar / profile-picture storage.** No `profilePicture` field exists
      in the shared schema or the users DDL (command-verified), so this is the
      one Settings surface still on legacy mlApi. **Scope MUST include the R3.9
      security the current path lacks** — it base64-inlines a 2 MB image into a
      JSON PATCH; R3.9 requires magic-byte content-type validation (not
      extension), a size cap, R2 storage under SERVER-generated keys, and
      signed-URL/CDN delivery. Do NOT inherit the current shape at cutover.
      (DECISIONS 2026-07-20, Card 7.)
- [x] 🔴 **Coach chat retry protection — API half DONE, merged 2026-07-22 as
      PR #43** (merge commit `facc804`; five fresh-chat T3 rounds).
      `/v1/coach/chat` had no per-route rate limit and accepted no
      Idempotency-Key, so a client retry opened a second thread, spent a second
      quota slot, and duplicated the messages. The API half now takes an
      optional `Idempotency-Key` and carries a 10-message/minute per-user cap,
      both placed BEFORE `requireQuota` (which increments the counter itself).
      (DECISIONS 2026-07-12 P2.5b T3; Kd D1(b)
      2026-07-16; design + Kd-approved numbers, DECISIONS 2026-07-21 on that
      branch.) **The two open lines below are what it does NOT close.**
- [x] 🔴 **Coach "Try again" control — the client half — DONE 2026-07-22.**
      Built as described below: the key is minted ONCE per composed message and
      stored with it, so "Try again" resends an IDENTICAL body under the SAME
      key; the input box is deliberately not restored (the button is the retry
      path). The 429 fold-in below is delivered too — the catch now branches on
      `err.response?.data?.error`, so the burst cap says "you're sending
      messages too quickly" and only a real `quota_exceeded` mentions upgrading.
      An unrecognised 429 also falls back to the "too quickly" copy: the global
      @fastify/rate-limit throws an untyped error, so its 429 reaches the client
      as `{error:"request_error"}` (verified) and must never produce the upgrade
      copy. `quota_exceeded`, `not_found` and `validation_error` offer NO retry
      button (it could not help); the two key-errors retry with a FRESH key
      (the same one would 400 for the full window). Fresh-chat T3: its BLOCKING
      finding was that the button was addressed per-message while the send
      writes to the TAIL, so a stale button resent the right key into the wrong
      bubble and overwrote a newer reply — closed at BOTH layers (offers
      withdrawn on compose; the button cannot render off-tail) and pinned by
      unit tests. Live-driven before handover: replay returned a byte-identical
      body with `idempotent-replay: true`, a same-key/different-message request
      returned 400 `idempotency_key_mismatch`, and one thread existed after
      three requests.
      **What was owed, kept for the record:** `Coach.jsx` cleared the message
      box on send and never restored it, and there was NO retry affordance — so
      a key minted inside `sendMessage` would have differed on every attempt and
      deduped nothing, and the user's only route back was retyping, which the
      server sees as a new message. (An earlier version of this line called the
      client half "one header line"; that was wrong and was corrected on
      2026-07-21.) The FOLD-IN was that every 429 mapped to the quota copy, so a
      free user with four questions left who sent quickly was told to UPGRADE.
      **SMOKE — PASSED (Kd, 2026-07-22), all three steps**, which also closes
      the API half's owed smoke (per CLAUDE.md Part I §2 none of its three new
      client-visible responses was browser-reachable until this landed):
      (1) request blocked in devtools → error with a **Try again** button →
      unblocked → click → real answer, ONE conversation in the sidebar;
      (2) the T3 V1 case — fail one message, then send a different one that
      succeeds → the stale button is gone and the newer answer is NOT
      overwritten; (3) ~11 rapid sends → the burst-cap message says "sending
      too quickly", not the upgrade copy.
- [ ] 🟡 **Empty conversation left behind by a failed coach message.**
      PRE-EXISTING, found 2026-07-21 while verifying the card above, not
      introduced by it. `repo.createThread` commits on its own BEFORE the
      provider is called and messages are appended only on success, so a
      message that fails after that point leaves an empty thread in the sidebar
      **even if the user never retries**. Scope, verified: only for the FIRST
      message of a new conversation, and never when the coach is unconfigured
      (that 503 precedes creation). The retry path now RESUMES such a thread, so
      only the never-retried case remains. Proper fix = create the thread in the
      same transaction as the exchange, which touches the `api_cost_events`
      ledger transaction (DECISIONS 2026-07-12 T3 finding 3) — its own card, not
      a drive-by.
- [ ] 🟡❓ **A coach question is spent even when the provider never answers —
      needs a Kd ruling.** `requireQuota` increments BEFORE the handler runs
      (the ported quotas.py doctrine, "a request that fails later still
      consumed a slot"), so a Groq failure costs a free user one of their five
      monthly questions and returns nothing; a retry spends another, because it
      does real work. **Newly REACHABLE rather than theoretical:** Groq's free
      tier allows 6,000 tokens/minute and a real coach call measures ~2,573
      tokens (from this project's own `api_cost_events` rows), i.e. about two
      questions a minute before Groq refuses. Refunding the slot when no answer
      was produced is a small, contained change to the coach route's failure
      path — but it changes ported behaviour, so it is Kd's call, not a chat's.
      (DECISIONS 2026-07-21.)

### Legal / operational gates
- [ ] 🔴 **DPDP Day-14 HARD-DELETE — CODE COMPLETE 2026-07-22, BUT NOT YET
      RUNNING ANYWHERE, so it is NOT done** (branch `dpdp-day14-purge`).
      This line was first written ticked; its T3 (finding D1) proved that
      wrong and it is UNTICKED. A correct sweep that is scheduled nowhere
      deletes nothing, and "a deleted user's data actually goes" is the whole
      obligation. Command-verified 2026-07-22: **no Dockerfile exists in the
      repo**, `docker-compose.yml` defines only mongo/redis/mongo-express (no
      api, no worker), `ci.yml` has no deploy job, and nothing in RUNBOOK says
      where `pnpm worker` runs. **What closes it:** the deploy path runs the
      worker (or a cron runs `tools/dpdp-purge.ts --apply`), and the entry
      names where. The code below is real, T3'd and proven — the deployment
      is what is missing. §5.2 ANONYMIZES the users row rather than deleting
      it, so NO FK cascade collects user-owned PII; §5.2's explicit Day-14
      DELETE list is the only mechanism, and it now exists as
      `apps/api/src/modules/privacy`. 17 tables end empty per purged user — 15
      deleted directly, `meal_log_corrections` and `coach_messages` collected by
      CASCADE from their parents (they carry NO `user_id`, which the approved
      plan had assumed they did — caught by verification before any code).
      `user_fitness_profiles` IS included, so the condition on which
      onboarding-storage was merged (2026-07-16) is discharged for this half.
      Runs on BullMQ (**now installed**, 5.80.10) from a new `worker`
      entrypoint per v1 §6, plus `tools/dpdp-purge.ts` which is **dry by
      default** and needs `--apply` to destroy anything.
      **The build note is honoured and was bigger than it looked:** the
      retention window is ONE constant (`apps/api/src/retention.ts`), and there
      turned out to be FOUR hard-coded 14s, not one — two of them the
      user-facing strings on `DELETE /v1/users/me`. Had only the code read the
      constant, widening to GDPR's 30 would have left the API telling users
      "you have 14 days" while purging at 30.
      **PARTIAL PROGRESS 2026-07-24 (deploy-infra card) — STILL UNTICKED, and
      deliberately so.** Three of the four command-verified absences above are
      now closed: `infra/Dockerfile` exists (one image, two modes, v1 §6),
      `infra/docker-compose.yml` defines a `worker` service running
      `src/worker.ts`, and `infra/README.md` NAMES where the purge runs — the
      worker service on the Hetzner VPS, `dpdp.purge` on the `rollups` queue at
      03:00 UTC. What remains is the part that actually deletes data: **no host
      is provisioned and nothing is running**, and `ci.yml` still has no deploy
      job. An image proven on a laptop is not a scheduled sweep. This line ticks
      when the compose runs on a real host — the same standard that unticked it
      after T3 finding D1, applied to the card that built the image rather than
      relaxed for it.
- [x] 🔴 **CI runs none of the database tests — including the purge suite.**
      Found by the DPDP T3 (finding D2) and MEASURED both ways: the gate job
      runs `pnpm test` with NO `DATABASE_URL`, giving **151 passed / 173
      skipped**, while the same suite with a `DATABASE_URL` gives **324
      passed**. The Neon-branch job only runs `drizzle-kit migrate`. So every
      DB-gated suite this project has built — auth, workouts, nutrition,
      coach, the Mongo migration, and now the Day-14 purge — is green on merge
      without ever executing. **Pre-existing infrastructure, not broken by any
      one card**, but the purge is what makes it serious: the only code in the
      repo that irreversibly destroys user data has zero enforced coverage.
      Fix is to give the test job a Neon branch (the migrations job already
      creates one, so the mechanism exists). Its own card — R1.1.
      **DONE 2026-07-23 — PR #47, branch `ci-db-tests`.** The proposed fix
      ("give the test job a Neon branch") was TRIED (commit 34aa7c0) and MEASURED
      too slow: every test PASSED but the full suite took ~38 min against remote
      Neon from a GH runner (uniform latency, not a hang), overrunning a 30-min
      cap. Kd ruled to SPLIT instead: `migrations` keeps proving DDL on a real
      Neon branch; a NEW `db-tests` job runs migrate + seed + `pnpm --filter api
      test` against a pgvector/pgvector:pg16 SERVICE CONTAINER on the runner
      (~2 min, no paid Neon compute per PR, DB clean by construction). PROVE both
      ways: `api tests on local Postgres` green 341/341, 0 skipped; a
      deliberately-broken purge assertion turned that check RED while the DB-free
      gate stayed green, then reverted. See DECISIONS 2026-07-23 "CI runs the
      database-backed api suites".
- [ ] ⚪ **Assert the DB suites POSITIVELY executed (count floor / fail-if-skipped).**
      T3 defense-in-depth on the CI db-tests card (2026-07-23). No silent-skip
      path exists TODAY — `DATABASE_URL` is one job-level value shared by
      migrate/seed/test, and a bad URL fails `drizzle-kit migrate` loudly before
      the test step, so a green-with-0-DB-tests run is unreachable. But nothing
      POSITIVELY asserts a non-zero executed count, so a future refactor that
      split the env or changed the `skipIf` var could skip the suites while
      migrate/seed still pass → false green. Add a guard that fails the db-tests
      job if skipped>0 / passed<floor (a verified vitest-JSON read, not a brittle
      grep). NOT built with the card: an unverified CI guard risks a false-red,
      worse than the low residual. R1.1 — its own small card.
- [ ] 🟡 **The DPDP purge's single-marker guarantee rests on ONE call site.**
      Raised by the round-5 T3 (2026-07-23) as latent, not a live bug —
      recorded so it is not lost. `lockDueUserForPurge` was widened from
      `TransactionSql` to `SqlOrTx` purely so the concurrency test could drive
      it on two explicitly-ordered reserved connections. That removed the
      COMPILE-TIME guard: a pooled `Sql` now satisfies the parameter, and on a
      pooled handle `FOR UPDATE` autocommits and drops the row lock instantly —
      silently reverting to the double-marker race this card fixed across four
      rounds. There is no DB backstop either: `audit_log` has only
      `(gym_id, at)` btree + a BRIN on `at`, **no unique index on
      `(action, target_id)`**, so a duplicate marker raises no 23505. Verified
      today: the sole production caller (`purgeUser` → `deps.sql.begin`) does
      pass a real transaction, so nothing is broken now. Two real closures,
      either of which ends the reliance: (a) revert the signature to
      `TransactionSql` and rework the test, or (b) add a partial unique index —
      **but NOT a naive one on `(action, target_id)`**, which would break the
      legitimate re-deletion case the `at >= deleted_at` bound exists to allow
      (a user deletes, restores, and deletes again). Pairs naturally with the
      CI line above, since neither is enforced on merge today.
- [x] 🔴 **DPDP JSON export — DONE 2026-07-23, merged as PR #46** (merge
      `5c76d6c`). `GET /v1/users/me/export` returns the user's data as JSON:
      17 tables + profile, DERIVED from the Day-14 delete list so the two §5.2
      rights cannot drift apart. Kd-ruled DEVIATION on delivery only — §5.2
      describes a zip behind a signed URL; none of that infrastructure exists
      and v1 §18 itself says "data-export endpoint", so the content is
      identical and adding signed-URL delivery later changes only how it is
      sent. Three fresh-chat T3 rounds (10+6+4). Notable: the rate limit
      shipped with an IP dimension that refused a second gym member's FIRST
      export (and cited a precedent saying the opposite); internal columns
      rode along on SELECT * (our per-request AI cost on every coach message,
      and the anti-cheat flags the spec calls silent); and an untyped lookup
      let a typo ship them, found three times one level down each round —
      now guarded against the real drizzle schema by a test needing NO
      database, so CI actually runs it. **STILL OPEN, its own line below:**
      whether `gym_members` and `leaderboard_snapshots` belong in the export.
      ~~the OTHER half of §5.2, still owed and still blocks P2.8~~ Split from the delete half by Kd ruling 2026-07-22
      because NONE of its infrastructure exists — command-verified: no R2/S3
      client in any `package.json`, no bucket or signing keys among
      `config.ts`'s 17 env vars, no zip library, and no Part 4 table to track an
      export job. It therefore needs new credentials plus ≥2 new dependencies,
      which would have blown the 🔴 one-thing-per-chat ceiling and delayed the
      legally load-bearing half. §5.2 wants "a JSON zip of every user-owned
      table above + profile, delivered via signed URL, 7-day expiry".
      **A DEVIATION PROPOSAL is on file for that card:** serve it as an
      authenticated `GET /v1/users/me/export` returning JSON directly — no zip,
      no R2, no signed URL — which satisfies §5.2's "both flows exist at launch"
      with zero new infrastructure and keeps the export a table LIST, so adding
      signed-URL delivery later changes delivery only, never content. Kd rules
      on that at the card.
- [ ] 🔴 **Drain offline sync queues before cutover.** Per-user localStorage
      buckets are keyed `user_<id>_*`; pre-cutover that id is the old Mongo
      ObjectId, after it the new UUID, so unflushed workouts orphan. Non-issue
      on greenfield prod (empty DB) — matters only for a data-carrying cutover.
      (DECISIONS 2026-07-15.)
- [ ] 🔴 New API deployed and healthy (`/health`), `data_backend` flag seeded.
      The IMAGE and compose now exist (`infra/`, 2026-07-24) and are proven on a
      local Docker stack; no host is provisioned, so nothing is deployed and this
      stays open. Provisioning starts the ~₹700–1,200/mo spend Kd already accepted
      at the P0.4b ruling (DECISIONS 2026-07-07) — it is a decision to execute,
      not a decision still to make.
- [ ] 🔴 Secrets in the deploy platform (escrow doc, Part 8 §1) — never in repo.
      `infra/README.md` lists the four hard-required variables (`DATABASE_URL`,
      `WEB_ORIGIN`, `JWT_SECRET`, plus `REDIS_URL` in production) and the file
      they belong in on the host (`infra/api.env`, gitignored + dockerignored).
      The escrow doc itself is still owed, as are the two rotations above.
- [ ] 🔴 Backup/restore drill actually performed and logged (Part 8).
- [ ] ⚪ **CI does not build or push the API image, and nothing auto-deploys.**
      Deferred by the 2026-07-24 deploy-infra card rather than half-built: v1 §19's
      pipeline ends "build images → migrate → deploy staging → manual promote",
      but there is no registry and no host to push to yet, so a build-and-push job
      would be ceremony that proves nothing. Its own card once a host exists.
- [ ] ⚪ **The image runs TypeScript through `tsx` rather than a compiled `dist/`.**
      Kd-approved at the deploy-infra plan gate as option A. No package the image
      needs has a build script (`apps/api`, `@app/shared` and `@app/engine` all
      run from source; only `apps/web` has one, `vite build`), so compiling means
      adding build scripts to three packages and repointing their `main`/`exports`
      — which changes module resolution for typecheck and test everywhere, past
      the Part I §7b one-thing-per-chat ceiling. Cost today: a boot-time transpile
      and a larger image. Worth revisiting if boot time or image size ever bites.

## 🟡 Needed before real users, not before cutover

- [x] 🟡 **Timezone capture** — DONE 2026-07-21 (the second audit miss, owed
      since 2026-07-11). The web now reports the browser's IANA zone on session
      adoption, so `users.timezone` is real and day-bucketing stops falling back
      to UTC — streaks had been rolling over at the wrong local hour for every
      user outside UTC (05:30 IST, in a Jorhat pilot). Pure web card: the PATCH
      has accepted `timezone` since P2.2. Writes only on a real change;
      best-effort; the client reports its zone and never computes a day
      boundary. Kd's smoke caught a duplicate write on first login (login and
      session-restore both firing) — guarded. SMOKE passed, and the stored
      value was verified written BY THE BROWSER on an untouched account.
- [ ] 🟡 **Timezone TRAVEL rule (§3.5) — still owed, deliberately NOT absorbed
      by the capture card.** "A day is kept if it qualifies in either the
      stored-at-the-time TZ or the new one" is not implemented: streak replay
      uses only the CURRENT `users.timezone`, so a user who moves between zones
      can lose a day that legitimately qualified under their old one. This was
      shielded while every user was UTC; capturing real zones makes it
      reachable, which is why it is now its own line rather than a footnote.
      (DECISIONS 2026-07-11 P2.3 T3 note.)
- [x] 🟡 **`limitedToDays` surfaced in the Progress UI** — DONE 2026-07-21.
      Every `/v1/progress` read returns the plan-clamp field and the page
      ignored it entirely, so a free-plan user saw "1 Year" over 90 days of
      data. Now: a notice under the period buttons, and the caption corrected
      to the window actually shown. **The clamp is compared against the
      REQUESTED window, never rendered on `limitedToDays !== null`** — the
      server reports it unconditionally (7d also returns 90), so the naive
      check would warn about a limit that is not limiting.
      Its fresh-chat T3 caught that the notice closed only HALF of f.4: the
      heatmap and personal-records endpoints take NO period and are gated
      anyway, so their own headings still lied at the three periods where the
      notice correctly stays quiet. Both now caption from their own window
      (`heatmapCaption` / `recordsNote`), with `longestStreak` carved out
      because it is deliberately ungated. Copy states the history is SAVED —
      it is a read gate, not deletion. SMOKE passed.
      (T3 Card 3 f.4, owed 2026-07-16 → closed by the Progress-clamp card.)
- [ ] 🟡 **Real-phone mobile-web camera smoke.** The claim "the file input opens
      the camera on phones" is UNVERIFIED (V1) — every smoke to date ran on
      Kd's desktop. The desktop-webcam ruling makes mobile web the PRIMARY
      meal-capture path, so this needs one real-device run: `vite dev --host`,
      `VITE_API_URL` + API `WEB_ORIGIN` on the LAN address (a phone resolves
      `localhost` to itself; CORS is exact-origin + credentials — the Card-4
      lesson). Also settles the recorded `capture`-vs-photo-library trade-off
      (options A/B/C, DECISIONS 2026-07-19; recommendation was "A now, C later
      only if the phone smoke shows the gallery limitation bites").
      (DECISIONS 2026-07-19.)

## ⚪ Improvements and residuals

- [ ] ⚪ **`db.migration.test.ts`'s "0009 workout_sets CHECKs bite at the DB" is
      79 ms inside vitest's default timeout — it will keep flaking.** Recorded
      2026-08-01 (DECISIONS :3538) by the catalog card, which is NOT its cause:
      that test never calls the seed and does its own inserts. **Measured, not
      guessed:** it FAILED one full-suite run ("Test timed out in 5000ms"),
      PASSED the very next with nothing changed, and passes at
      `--testTimeout=45000` taking **5079 ms** — 1.6% over the 5000 ms default.
      It is ~15 sequential round-trips to a Neon branch, so any latency bump
      tips it. Fix is one argument (the file already uses `120_000` and
      `30_000` elsewhere), left untouched under R1.1 because it belongs to the
      log-only card. Whoever next edits that file should give this test its
      budget — a test that fails on network weather teaches the suite to be
      ignored.
      **WIDENED 2026-08-14 (DECISIONS :7730), measured across four runs on one
      evening: it is no longer ONE test.** Full-suite runs went 442/442 green,
      443/443 green, then **"0009 workout_sets CHECKs" timed out** — and a
      re-run of that file ALONE failed a DIFFERENT test in it, **"created every
      Part 4 §2 table" at 5006 ms**, while the 0009 one passed at 4165 ms.
      So the whole file is riding the 5000 ms default against a Neon branch in
      another country, and WHICH test trips is network weather. **Still not this
      card's**: `db.migration.test.ts` is not in its diff (command-verified), and
      no assertion failed in any of the four runs — every failure was the
      timeout. **The fix is now the FILE's budget, not one test's.** Note the
      second-order cost, which is the real reason to fix it: an evening of
      genuine green runs now ends in a red line that has to be re-diagnosed by
      hand before anything can be claimed, and the next chat may not bother.
- [ ] 🟡 **T3 round 8's four non-blocking findings (2026-07-28).** Given lines
      here in the same commit that deferred them, per the deferral rule — they
      were reported by a review that named them explicitly, which is exactly how
      items get lost when only prose records them. Full text at
      `t3-xp-web-r8-FINDINGS.md` §(3).
      1. `Achievements.jsx:737` `key={entry.name ?? i}` — `readLeaderboardEntry`
         DISCARDS the payload's `user_id` (which the file's own fixture carries
         at line 411), forcing name-as-key. Two athletes with the same display
         name collide and React reuses the wrong row. Fix is to keep `user_id`
         in the reader and key on it; the reason it is not in Round A/B is that
         it changes a reader's shape, which is its own small card.
      2. `Achievements.jsx:268` `podiumColors[entry.rank]` — `rank` is
         `finite()`, so 0 or a negative passes `isPodium` and yields a Crown
         with `color: undefined`. Cosmetic.
      3. `Dashboard.jsx:733` `{!loading && (CTA)}` — the STATIC "Ready to
         start?" call-to-action borrows the stats read's knowability, so a hung
         `getStats` hides it forever. Round 7 F8's shape, one site over. Note
         this is the same three-states-never-two family as F3 and is worth
         folding into whichever round touches `Dashboard.jsx` last.
         **RAISED at Round A's plan gate (2026-07-29) as a labelled
         RECOMMENDATION, since Round A WAS the last round touching that file —
         Round B touches only `Sidebar.jsx` and the two test files. Kd approved
         the plan as written, so it was not folded in and there is now no
         scheduled round that will pass this file.** It needs a card of its own.
- [x] 🔴 **A long-time user's OLD MONTHS GO BLANK on the calendar, and the page-
      walk is why. `/v1/workouts` needs a date filter.** Raised by Kd on
      2026-08-04, in response to this chat calling the truncated state
      "unreachable" — **which was wrong, and the correction is the point of this
      line.** 1,000 workouts is four sessions a week for five years. Real users
      reach it; the app is being built for a lot of them.
      **WHAT THEY SEE.** `/v1/workouts` is a keyset cursor list with NO date
      filter, so `fetchMonth` assembles a month by paging BACKWARDS from today,
      capped at `HISTORY_MAX_PAGES` × `HISTORY_PAGE_LIMIT` = 10 × 100 = 1,000
      rows (`apps/web/src/api/workoutHistory.js`). Browse to a month with 1,000
      workouts logged since, and the walk never reaches it: `truncated` comes
      back true and the grid is EMPTY. The T3 round-2 fixes make that state stop
      LYING (it no longer prints a bold "0 active days this month", and the
      caption is now true) — **they do not make the month readable, and this line
      exists so that is not mistaken for done.**
      **THE FIX IS ON THE API, not the client.** A month filter on
      `/v1/workouts` (or a dedicated month/range read) returns the month in one
      request at any history size: no cap, no walk, no truncation caption, and
      the ten requests per month view collapse to one. The client's page-walk was
      always a stand-in for a filter the endpoint does not have — the Card-5d
      precedent it cites (`listMealsForDay`, DECISIONS 2026-07-19) made the same
      trade under the same constraint, so **the same question should be asked of
      that reader when this is built.**
      **✅ CARD 1 (API) IS DONE 2026-08-04 — DECISIONS :4434.** `/v1/workouts`
      now takes `from`/`to`: half-open, absolute instants, narrowing only (the
      Part 4 §0.2 plan gate still out-ranks a wider `from`), inverted window =
      400. 19/19 against real Postgres, both new guarantees mutation-checked.
      **✅ CARD 2 (WEB) IS DONE 2026-08-05 — DECISIONS :4855. THE LINE IS
      CLOSED, AND THIS TICK IS THE SECOND ONE.** The first was spent in
      `d28ace5`, in the same commit whose own message said "Smoke and T3 unrun";
      **T3 round 1's F4 struck it**, citing :4119 four commits back on this very
      screen ("NOT ticked — smoke and T3 are both unrun"). It ticks now because
      the gate is actually met: Kd's browser smoke passed steps A–D (:4829), and
      BOTH review rounds are done with ZERO user-visible findings across them
      (:4718, :4855) under the two-round cap. This file's header rule is that
      nothing leaves except by being DONE; a tick is the only signal it carries,
      and spending it early is how the list stops being trustworthy.
      What landed: `fetchMonth` now sends the month's own boundaries (local
      midnight to local midnight, converted client-side so no timezone decision
      moves to the server) and reads back one page instead of walking up to ten
      from today. An older month is readable at any depth of history, and a
      month view costs ONE request rather than up to ten. The truncation state
      SURVIVES with an honest new caption — the 10-page cap now bounds an
      in-month walk, so it means "more than a thousand workouts IN THIS MONTH",
      which is a far rarer claim than the one it used to make and is NOT deleted
      for being rare.
      **Not a regression and not this card's defect** — the cap predates it and
      the old backend answered `?month=&year=` server-side, which is exactly the
      surface the repoint lost. Needs its own card (API half, then the client
      simplification); size it against the P2.8 order at DECISIONS :2866.
- [ ] ⚪ **A server whose cursor never ADVANCES makes the calendar draw every
      workout ten times.** Raised by T3 round 2 (2026-08-05, DECISIONS :4718's
      round-2 entry) while fixing F2, and given its own line because F2 fixed
      only the half that was this card's: the CAPTION no longer claims a volume
      it did not see (`inWindow` counts distinct workout ids), but `byDate` still
      pushes the same session once per row, so a day with one workout renders
      "×10" and its detail panel lists the same session ten times.
      **Pre-existing and not this card's defect** — the page-walk has pushed
      rows without deduplicating since the calendar was built (2026-08-01), and
      the date window neither caused it nor made it worse. It is ⚪ because it
      needs a SERVER that accepts `from`/`to` and then returns a non-advancing
      cursor; against a correct API it cannot happen, and nothing on screen is
      wrong today.
      The fix is the same shape as F2's and about three lines: track the placed
      ids and skip a repeat before pushing into `byDate`. Worth doing with any
      future work on that reader rather than on its own.
      **Deliberately NOT folded into the round-2 fixes** (R1.1): the caption was
      in scope because its claim was this card's own, and the grid was not.
- [ ] 🟡 **The MEAL history has the same blank-page defect as the calendar had,
      from the same cause.** Raised 2026-08-04 while building the workouts date
      window (DECISIONS :4434), and given a line immediately because the workouts
      version of this went untracked until a user-visible bug forced it.
      `listMealsForDay` (`apps/web/src/api/nutritionApi.js`) page-walks
      `GET /v1/nutrition/meals` backwards from today at 100 rows × 10 pages,
      because that endpoint has no date filter either. Card 5d chose that
      deliberately AND named the exit: **"option (c) server-side date filter
      stays the documented upgrade path if history runs deeper"** (DECISIONS
      2026-07-19). At ~5 meals a day the cap is about six months — **sooner than
      the workouts one, not later**, because meals are logged more often than
      workouts. Past it, an older day shows "couldn't load back this far", which
      is at least honest, so this is 🟡 rather than 🔴.
      The fix is the same shape and now has a worked precedent to copy:
      `from`/`to` on the meals list query, half-open, absolute instants, clamped
      by the plan gate exactly as the workouts one is.
- [ ] ⚪ **Two more captions would print "Last 1 Days".** `progressClamp.js:63`
      (`heatmapCaption`) and `:76` (`recordsNote`), plus `WorkoutCalendar.jsx:341`
      ("Your plan shows the last 1 days"), interpolate the plan window with a
      hard-coded plural — the same defect as `BACKLOG.md` L26, in the three
      siblings that card did not touch. **Latent, not live:** no seeded plan uses
      `history_days: 1` (`seed.ts` has only -1 and 90), so nothing prints it
      today. Named by T3 round 3 (2026-08-15) as out of scope for the
      dashboard-stats card, and deferred here rather than swept up in a fix
      round (rule 6 — minimal diffs).
      **Fix the CLASS, not the three cases** (:1239): `totalsWindowLabel` already
      owns the singular and the Dashboard now calls it rather than spelling it —
      the other captions should reach the same owner, not each grow their own
      ternary. That is what L28 was found for, one file over.
- [ ] ⚪ **On the FIRST load of an account with no stored timezone, the week
      strip can draw one flame a day out — for that one render only.**
      Found by the dashboard-stats T3 round 1 (2026-08-15, its Low-3), tagged Low
      with its argument shown, and **deferred rather than patched — so it is here
      rather than only in `BACKLOG.md`** (Part I §2.5: a Low that cannot be fixed
      in its round has become a deferral).
      `syncTimezone` is called fire-and-forget from `AuthContext.jsx:95,120`, by a
      DOCUMENTED decision recorded at both call sites: *"a best-effort write must
      never delay rendering or hold the loading spinner open."* So on the very
      first load of an account whose `users.timezone` is still null, the server
      buckets that render's trend by UTC while the client keys the seven cells
      LOCALLY — and east of Greenwich the two disagree for the early hours of a
      day. It self-corrects on the next load, and it needs a stored-null
      timezone, which the capture card makes rare.
      **Why it was not fixed in the round:** the only two fixes are to await the
      write before first paint — reversing the decision above, and delaying every
      login for a best-effort call — or to hide the strip until the timezone is
      known, which the no-removal rule forbids. Neither is a fix round's business
      (rule 6: minimal diffs, only the fix). **It needs a card and a Kd ruling on
      the trade-off, not a patch.**
      **Strictly better than before the repoint**, which is why it is ⚪: the old
      key was UTC permanently for the same user, so this is a one-render residual
      of a defect that used to be constant.
- [ ] ⚪ **The timezone-pin guard asserts only that the offset is NOT ZERO, so a
      DST zone would satisfy it.** Raised by the calendar's T3 round 2
      (2026-08-04, DECISIONS :4355) while auditing round 1's own fix, and
      reported rather than patched — the fix is not free, since naming the zone
      in the assertion duplicates the value the config already owns, and a
      duplicated constant is its own drift risk.
      `apps/web/vitest.config.js` pins `TZ=Asia/Kolkata` because under UTC the
      local day and the UTC day are identical by definition, so no fixture can
      tell a correct day-bucketing from the UTC-day defect (round 1's F2, which
      was inert on the CI runner). The config's stated reason for THAT zone is
      that it is the product's own market AND has no DST — a date fixture cannot
      drift twice a year. The guard at `workoutHistory.test.js:112` checks
      `getTimezoneOffset() !== 0`, which a DST zone passes. So the pin can be
      edited to, say, `Europe/London` and every date test keeps passing while the
      no-DST half of the rationale silently stops holding, and two fixtures a year
      start landing on the wrong day. **Not visible and not urgent: nothing on
      screen is wrong today, and the pin is not something a card routinely
      touches.** Closing it means asserting the property the rationale actually
      depends on — that January and July offsets agree — which is one line and
      names no zone.
- [ ] 🟡 **The calendar's stand-in for `safeParse` catches renamed fields but NOT
      changed UNITS — and a changed unit is what actually bit.** Raised inside
      the calendar T3 round 1's security pass (2026-08-04) as an observation
      rather than a numbered finding, and given a line because an observation
      with no tracker is how this exact thing gets lost.
      `readCalendarSession` deliberately reads per field instead of running
      `workoutListItemSchema.safeParse`, and the documented reason is sound: a
      strict parse would DROP a row the calendar could draw perfectly, over a
      field the screen never shows. The substitute is a contract-drift test that
      feeds a schema-valid row through the reader and fails if a field NAME
      moves. **That substitute is narrower than the R2.3 rule it replaces**: a
      field whose unit, scale or range changes keeps its name and sails through.
      **Not hypothetical — it is this card's own duration defect exactly.**
      `durationMs` kept its name while the payload changed from the old
      backend's whole minutes; the drift test was green throughout, and the
      screen printed a 9-second workout as "0m" until Kd's browser caught it.
      Closing it means asserting the SHAPE of values, not just the presence of
      keys — a unit fixture per numeric field (1000 ms ⇒ 1 s; a 0-100 form
      score; integer kcal), or a narrowed parse that validates only the fields
      this screen reads and keeps the drop-nothing property. Belongs with
      whichever card next revisits the reader, and the same question should be
      asked of every other per-field reader on the repoint (`readSummaryView`,
      `readOverviewView`, `readStatsView`, `readLeaderboardView`, and
      **`readCatalogPage`** — added 2026-08-05 by the exercise library's T3 round
      1, F6: that card shipped a SIXTH per-field reader without adding it here,
      and its F4 is what the omission cost, a renamed `slug` field turning an
      unreadable page into "0 Exercises" + "No exercises found". F4 is fixed; the
      wider UNIT question — a reader that catches renamed fields but not changed
      units — is still open for all six).
- [ ] 🟡 **Calories are shown as a flat number where the spec requires a RANGE.**
      Raised by the calendar's T3 round 1 (F3, NOT-VISIBLE) on 2026-08-04 and
      given a line the same day — it was tracked NOWHERE, which is the exact
      shape the deferral rule exists to stop, and it had survived every card
      that ever rendered a kcal figure.
      **Verified this session, not taken on the reviewer's word:**
      `docs/spec/02-part2b-trust-layer.md:148-152` — "**Range = point estimate
      ± 20%**, both ends rounded to the nearest 5 kcal; e.g. computed 212.4 →
      **'≈ 170–255 kcal.'** … constant, `CALORIE_BAND = 0.20`, versioned under
      `calc_version`" — and the §2.3 display table at :475 marks the session
      calories row "range ±20% / nearest 5 kcal / **always**".
      `grep -in "banding|CALORIE_BAND|calorie range" OWED.md` returned nothing
      before this line.
      **Why it is a trust requirement and not polish:** the number is an
      estimate derived from MET × body weight × time, and the spec's whole
      Trust-Layer argument is that a point value presented as fact overstates
      what the app knows. Same family as this project's em-dash rule, one step
      further on: `210` claims a precision the calculation does not have.
      **Not the calendar's to fix (R1.1)** — it is the display rule for EVERY
      surface reading a kcal point value from the new API. Both shared contracts
      already say so and are the pointer to the work:
      `packages/shared/src/workouts.ts:23` ("2B §2.3: display banding is the
      client's job") and `packages/shared/src/progress.ts:15`. One shared
      formatter, `CALORIE_BAND = 0.20` quoted from the spec and never
      re-derived, plus the "estimated" label — then every consumer switched to
      it, the one-ladder rule (a second spelling is how two screens come to
      disagree about one number).
- [x] 🟡 **Exercise names in the workout calendar are TITLE-CASED SLUGS — DONE
      2026-08-05** by the exercise-library content card, which is the card this
      line named in writing as the one that closes it. `exerciseLabel` now looks
      the slug up in `EXERCISE_CONTENT` — the same table the library screen draws
      from, so the two cannot call one exercise two things — and falls back to
      the derived `Slug Case` label for a slug the table does not stock (e.g.
      `barbell_squat`, which is not one of the 58). Both arms are pinned by test
      and mutation-checked (M22). The chips read `Push-ups`, not `Push Up`.
      **WAS:**
      Created 2026-08-01 by the calendar repoint (DECISIONS :2912) in the same
      commit that deferred it. The old `/workouts/history` projected up to five
      exercise NAMES per session (`workouts.py:388-393`) — a live feature, so the
      no-removal rule was engaged and the chips stayed. But the new API carries
      only `sets[].exerciseSlug` (`workoutDetailSchema`), so `exerciseLabel`
      renders `barbell_squat` as `Barbell Squat`. That is a label DERIVED from
      the value, not a name invented for it — the identifier is unchanged, only
      its punctuation — which is why it shipped rather than a guessed name.
      **Closes with the exercise-library content card** (already 🔴 above: display
      names, instructions, media, server-side search), which is the thing that
      gives a slug a real name and its hi/as translations. Until then the chips
      read machine-ish, and the smoke doc says so at step 2 rather than letting
      Kd report it as a defect.
- [ ] 🟡 **`WorkoutCalendar.jsx` keeps the pre-existing
      `react-hooks/set-state-in-effect` error.** Measured both ways 2026-08-01,
      not ticked: the file at HEAD produces **2** eslint errors (an unused
      `Dumbbell` import + this one); after the repoint it produces **1** — the
      unused import is gone, and this one was PRESERVED rather than restructured,
      under R1.1 (it predates the card and fixing it changes the loading
      semantics the new tests pin). Parity improved, so it blocked nothing; it is
      listed because "same as baseline" is a claim that decays into "clean" if
      nobody writes the number down. Whoever next restructures that effect should
      close it.
- [ ] 🟡 **`Running.jsx:97-100` carries BOTH of Round A's defect classes, in a
      SAFETY signal.** Found 2026-07-29 while enumerating F5's class across the
      XP card's ten files; outside those files, so reported under R1.1 and
      deferred rather than fixed — and given a line here so it is not lost the
      way Google login and timezone capture were.
      Verified by reading the file this session:
      1. `colors[weather.risk] || '#FFD66B'` — `#FFD66B` is the **low**-risk
         colour, so an unrecognised risk is painted as a definite LOW risk.
         That is round 8 F5's fabrication (unknown rendered as a definite
         value), except the claim here understates a weather hazard to a runner
         rather than mis-colouring a badge. Line 96 already special-cases
         `risk === 'unknown'` and `'none'`, so the backend HAS a declared
         unknown — the gap is every other unrecognised string.
      2. It is also round 8 F4's shape: an object indexed by external text with
         no own-property guard, so `risk: 'toString'` resolves to
         `Object.prototype.toString` — truthy, so the `||` fallback never fires
         and the colour is invalid. Not a crash here (unlike Achievements),
         because nothing is called on the result.
      **`apps/web/src/api/runningApi.js` declares ZERO readers** (grep-verified,
      `^export function read` → 0) and never mentions `weather` or `risk`, so
      this payload reaches the render completely unparsed — the same
      external-input-rendered-raw condition that produced rounds 1-7's entire
      finding sequence on the XP card. The running feature has not had that
      pass yet.
- [ ] 🟡 **R3.6's pre-commit gitleaks HAS NEVER EXISTED, and a feature-branch
      push is scanned by nothing.** CLAUDE.md R3.6 states "Gitleaks runs in CI
      and pre-commit". Verified 2026-07-28: there is no `.husky`, no
      `.git/hooks/pre-commit`, and `gitleaks` is not on PATH — so the pre-commit
      half is a rule the repo asserts and does not implement. The CI half is real
      but narrower than it reads: `.github/workflows/ci.yml` triggers on
      `pull_request` and `push: branches: [master]` ONLY. Found while pushing
      `web-repoint` (31 commits) as a backup — the push went out with a
      hand-written pattern scan standing in for gitleaks, which is weaker and was
      stated as such rather than ticked.
      **CORRECTED 2026-07-31: "so pushing a feature branch runs NO scan at all"
      was FALSE as written, and the correction narrows this item.** A push to a
      branch with an OPEN PR fires the `pull_request` event (`synchronize`), and
      `ci.yml` has no draft filter (grep-verified) — so `web-repoint` has been
      scanned on every push since PR #29 was opened, and its checks read "All
      checks have passed — 5 successful checks" on `a9a9d17`, gitleaks included.
      The claim holds ONLY for a branch with NO open PR. It was written on
      2026-07-28 about the very branch that did have one. Corrected in the same
      session a chat repeated the error one level worse — asserting that 112
      commits "have never been through CI" while an open PR had been gating them
      the whole time. Both errors share a cause: reading the trigger list and not
      checking what was actually running.
      **This matters here more than in most repos: three secrets have already
      burned** (Groq key, Neon password, Google client secret — all three above
      on this list), and two of those reached a chat transcript rather than git,
      which is the failure mode a pre-commit hook does NOT catch either. Fix is
      either (a) install gitleaks + a pre-commit hook so the rule becomes true,
      or (b) amend R3.6 to describe what actually runs. Do NOT leave the sentence
      standing as-is: a protection everyone believes in and nobody installed is
      worse than a known gap.
- [ ] 🟡 **`apps/web/src/sync/syncClient.test.js` fails locally, passes in CI.**
      `ReferenceError: window is not defined`. Cause VERIFIED by T3 round 8:
      `apps/web/.env` sets `VITE_API_URL`, vitest loads it, so the test's premise
      ("in this node test env `VITE_API_URL` is unset") is false on a dev machine
      with a populated `.env`. Not a product defect — but it makes EVERY local
      PROVE run report "1 failed", which is how a real regression gets waved
      through as "that's just the known one". It has been described as "the
      pre-existing syncClient env quirk" in five handoff blocks without anyone
      naming the cause until now.
- [ ] 🟡 **`apps/web` is excluded from the lint gate and the DoD box says
      "lint clean" anyway.** Root lint is `turbo run lint --filter=!web`, and
      `pnpm --filter web lint` fails with 67 errors package-wide. So every web
      card has ticked "lint clean" truthfully-by-exclusion while the package it
      changed was never linted. Found by T3 round 8, which also confirmed the 2
      errors in this card's own files (`Sidebar.jsx:8` unused `Zap`,
      `Achievements.jsx:5` unused `ChevronRight`) are pre-existing on master and
      correctly untouched per R1.1. Either lint web and fix the 67, or change the
      DoD wording so the box stops asserting something nobody checked.
- [ ] ⚪ **Two PostWorkout behaviours are render-test-proven but BROWSER-unreachable.**
      T3 round 3 F7 (2026-07-30). No rig state has `duration_minutes` present with
      `active_seconds` absent (the minutes-fallback arm, where "NaNh NaNm total"
      lived), and none has unreadable list ELEMENTS — so two behaviours rounds 2
      and 3 wrote fixtures for cannot be seen in a browser. Round 2 F4 established
      that a jsdom-only path should be made rig-reachable and then did it for one
      of the three paths it created. Fix is a `minutesOnly` and a `badElements`
      state in `apps/web/tools/mock-ml-backend.mjs` plus smoke steps — deferred
      because it only pays off with a RE-RUN smoke, which is Kd's call, not a
      chat's.
- [ ] ⚪ **The mutation harness is not run by CI, so its table decays.**
      `apps/web/tools/mutate-postworkout-summary.sh` is a point-in-time
      measurement: it was green at `HEAD` on 2026-07-30 and nothing re-checks it
      when the files it mutates change. Raised by T3 round 3 as the general form of
      its own F1 — the same reasoning that says "prove a test RAN" says "prove the
      table is still true". Recorded rather than wired into CI, because the sed
      anchors are literal source strings and a CI job that goes red on an innocent
      refactor teaches people to ignore it. Its header says so; revisit if a second
      harness ever appears.
- [ ] ⚪❓ **Should `readSummaryView` DROP unreadable list elements rather than
      preserve them as null? — needs a Kd ruling.** Raised by T3 round 2 (F5),
      2026-07-30. Today an all-unreadable `personal_records` renders N trophy rows
      of "—" at both surfaces: not a fabricated VALUE, but a fabricated COUNT.
      Preserving is strictly better than the pre-card code (which threw), and
      dropping would silently remove rows the payload did claim exist — which is
      why a chat must not choose. A render fixture pins today's behaviour, so
      whichever way it is ruled the change is one assertion.
- [ ] ⚪ **`secondsLabel` carries to "1m 60s" on fractional input.**
      `Math.round(totalSeconds % 60)` rounds 59.6 to 60 instead of carrying into
      the minute. Found by T3 round 2 and verified a FAITHFUL port of the
      `formatSeconds` deleted at `dd07856`, so it predates this card (R1.1,
      reported not fixed). Reachable only if the old backend sends fractional
      seconds.
- [ ] ⚪ **`ShareCard` stamps today's date, not the workout's.** It renders
      `new Date()`, so a PNG exported the day after a workout dates it wrong.
      Pre-existing; `completed_at` is deliberately outside the reader's nine
      rendered fields, so closing this adds a field as well as a line. Found by T3
      round 2 (R1.1, reported not fixed).
- [ ] ⚪ **PostWorkout prints calories unrounded while its share card rounds
      them.** One workout can read `280.4 kcal` on screen and `280 kcal` in the
      downloadable PNG — two surfaces, one number. Pre-existing (the page never
      rounded, the card always did); found while writing the summary reader
      2026-07-30 and Kd chose **report only** at that card's gate, since rounding
      the page would be an unrequested display change to a real value. Both sites
      ARE now honest about an ABSENT value ("— kcal"). Close it by picking one
      rounding rule for both, in whichever card next touches that screen's copy.
- [ ] ⚪ **An EMPTY meal-suggestion or stretch list renders a heading with nothing
      under it.** Pre-existing, and distinct from the defect the summary reader
      closed: a list that ARRIVED empty is a truthful "none", so it is not a
      fabrication — but "Post-Workout Nutrition" over blank space reads as broken.
      The UNKNOWN case now says "unavailable right now" (2026-07-30); the empty
      case was left alone because writing empty-state copy is a product decision,
      not a defect fix. Same family as round 6 F6 / round 7 F8's empty-list states
      on the other three payloads.
- [ ] 🟡 **`RUNBOOK/cutover.md` is STALE — its checkboxes must not be quoted as
      fact.** Flagged by `DECISIONS-INDEX.md` when it was written (2026-07-30) and
      command-verified the same day: `cutover.md:107` still reads
      `- [ ] XP/levels display (GamificationStrip, Achievements)` although that
      card CLOSED on 2026-07-30 and both 🔴 lines for it above are ticked. The file
      states no verification date; the newest past date anywhere in it is
      2026-07-26 (`cutover.md:108`, the XP API-half merge — `2026-08-16` also
      appears but is the future Groq decommission deadline). So it predates THREE
      card closures, and `grep -ci postworkout` over it returns **0** although that
      card closed 2026-07-28.
      It matters because CLAUDE.md's grounding rule sends every
      migration-affecting card to cutover.md's prerequisites, and the P2.8 gate is
      "every owed endpoint exists" — a checklist that under-reports what is DONE
      reads as work still outstanding, and one that over-reported would be worse.
      Given a line here rather than fixed in passing because re-verifying the whole
      file against OWED.md is its own pass, not a one-checkbox edit. Closes by
      re-verifying every box against OWED.md and re-dating the file.

- [ ] ⚪ **Onboarding wizard's native unit dropdowns → the shared `Select`.** A
      native `<select>` popup is OS-drawn and its hovered row uses the system
      accent (blue) which CSS cannot override; Settings' five dropdowns moved to
      `components/common/Select` in Card 7, the wizard's cm/ft + kg/lbs pickers
      were left rather than folded in silently. (DECISIONS 2026-07-20.)
- [ ] ⚪ **Food matching residuals** (Card 5c T3, DECISIONS 2026-07-17/18):
      (a) `bySubstring`'s cross-word `includes` is a latent master-era hazard
      ("tea" ⊂ steak, "ham" ⊂ hamburger) reachable by any short manual query —
      fixing it trades honest-drops for wrong-guesses and needs a Kd product
      ruling, not a silent widening; (b) REMOVALS of drafted items produce no
      Stage-5 correction row, though 2B §3.2 counts "item swapped" as a
      correction; (c) the API does not dedupe canonicals within one request
      (double-counts the item and the correction pair; the web excludes
      duplicates client-side only).
      Also recorded: descriptive names whose head noun we stock but the
      substring pass misses still drop honestly ("Margherita Pizza", plurals
      like "Plate of Rotis") — same product call.
- [ ] ⚪❓ **Raw HTML in coach answers renders as visible text — needs a Kd
      ruling, not a drive-by.** Seen in the 2026-07-22 smoke: the model emitted
      `<br>` inside a markdown table cell and it displayed literally
      ("→ 90-120 g `<br>` Carbs:"). `react-markdown` ignores raw HTML BY DESIGN
      and prints it as text; rendering it needs the `rehype-raw` plugin — a NEW
      DEPENDENCY (R1.4) **and** a decision to let model-authored HTML into the
      DOM, which is a security-shaped choice (rehype-raw does not sanitise on
      its own). The honest alternatives are (a) add rehype-raw + a sanitiser,
      (b) strip/convert a small set of known tags client-side, or (c) nudge the
      system prompt away from HTML (relies on the model obeying, the same
      weakness Kd rejected when choosing remark-gfm over prompt instructions).
      Cosmetic today and harms no data. (2026-07-22.)
- [ ] ⚪ **An over-long coach message is hard to recover.** The composer sets no
      `maxLength`, but the contract caps a message at 2000 chars
      (`COACH_MAX_MESSAGE_CHARS`, packages/shared/src/coach.ts), so a longer one
      is rejected with `validation_error` AFTER the box has been cleared — and
      that error correctly offers no "Try again" (resending the same too-long
      text fails identically), so the only route back is selecting the text out
      of the user bubble. The copy hedges ("may be too long"), asserting nothing
      false. Pre-existing; surfaced by the Try-again card's T3 (V5) and reported
      rather than fixed (R1.1) since it needs a client-side length affordance,
      not a change to the error mapping. (2026-07-22.)
- [ ] ⚪ **Coach streaming.** Non-streaming was chosen for v1 (exact token/cost
      accounting + exact-match cacheability, nothing consumed the endpoint until
      P2.8). A streaming card can follow post-cutover.
      (DECISIONS 2026-07-11 P2.5 GAP-3.)
- [ ] ⚪ **Outbox for external-call ledger writes.** `api_cost_events` is written
      immediately after a provider response but outside a transaction with the
      application rows (coach: same tx; vision: two statements). The residual
      "provider spent + total DB failure" window is inherent to a
      non-transactional external call; an OUTBOX is the eventual answer, owed
      with the billing/worker phase. (DECISIONS 2026-07-12.)
- [ ] ⚪ **Coach read-path ordering tiebreaker.** `getRecentMessages` has no id
      tiebreaker on equal `created_at`, so live same-millisecond user/assistant
      pairs could invert. Pre-existing; the migration sidesteps it by making
      `created_at` monotonic per thread. (DECISIONS 2026-07-13 P2.7e T3.)
- [ ] ⚪ **Sync POST timeout.** `syncApi` has no timeout, so a hung POST holds a
      flush run open indefinitely. Made harmless by Card 2's owner check
      (correctness no longer depends on run length), so it was reported not
      fixed (R1.1). (DECISIONS 2026-07-15.)

## Phase-1 engine debt (does NOT block cutover; blocks the P4 exercise line)

- [ ] ⚪ **§7.5 trace-count shortfall — the phase's own hard gate is NOT met.**
      §7.5 / Part 0 #4 require ≥6 squat + 4 jump + 4 chair recorded parity
      sessions; the repo has 3 + 3 + 3. "9/9 green" means all PRESENT clips
      pass, NOT certification. Kd records the remaining ~3 squat + 1 jump + 1
      chair (front views included) to unblock. Accepted as tracked debt under
      the Option-B scope Kd set; traces.replay warns loudly.
- [ ] ⚪ **Fault multisets have zero trace coverage** (`faultsPending` stays),
      blocked on the same jump-airborne / chair-target template work below.
- [ ] ⚪ **Phase timings asserted only structurally** — a tolerance must be
      declared before any trace asserts them (§7.4 names none).
- [ ] ⚪ **Kd spot-check owed:** 2–3 re-recorded goldens' `expected.reps` against
      the raw videos (gate and fixtures changed in the same PR).
- [ ] ⚪ **Jump-squat airborne-state scoring/faults** (SPEC GAP → P4). Stiff
      landing, loading-depth window, just-landed score and the `(trunk−shin)`
      relative lean all need per-frame airborne gating the current template
      cannot express. Jump ships counting + an interim depth curve only.
- [ ] ⚪ **Chair adaptive depth scoring** (SPEC GAP → P4). The legacy curve is
      anchored to the C2 `target`; scoring-curve x-values are fixed numbers.
      Chair ships an interim fixed-fallback-target curve.
- [ ] ⚪ **±3 per-rep score parity has no defined extraction rule** (SPEC GAP,
      needs a Kd decision). Python emits per-FRAME scores, the engine per-REP.
      Recommendation on file: "Python rep score = min form_score within that
      rep's descent→completion window", asserted for squat only.

### Adding exercises 4–58: what is genuinely shared, and can therefore interfere

Raised by **Kd's question on 2026-08-14** — *"i will add all the 58 exercises and
one exercise['s] rules should not interfere with other exercises"*. Recorded
because he is right that this is the risk, and because **the answer is mostly
reassuring and partly not**, which is exactly the shape that gets lost.
**MEASURED that day, not reasoned** (commands in DECISIONS :7575):
**what is genuinely isolated** — the engine declares **zero** module-level
mutable state (`grep` for top-level `let`/`var` under `packages/engine/src`
returns nothing), so one set's session cannot leak into another's; the engine
names **no exercise** in any logic (R5.6 holds — the only hits are comments); and
each definition carries its own `upAt`, `downAt`, `countOn`, `minRepMs`,
`maxRepMs` and `bilateralGate`. Adding an exercise is adding a data file.

- [ ] ⚪ **~20 ENGINE CONSTANTS ARE SHARED BY EVERY EXERCISE, AND THEY WERE PORTED
      FROM THE SQUAT ANALYSER.** `MIN_DOWN_FRAMES` 3 · `MIN_UP_FRAMES` 2 ·
      `MIN_REP_INTERVAL_MS` 450 · `BILATERAL_ENGAGE_ANGLE` 150 ·
      `FSM_SMOOTHING_SAMPLES`/`SMOOTHING_WINDOW_FRAMES` 7 · `VIS_USABLE` 0.3 ·
      `STANDING_KNEE_MIN` 160 · `NEUTRAL_SCORE` 80 · `CORRECT_AT` 70 and the rest
      (`grep -rnE "^export const [A-Z_]+ =" packages/engine/src/pipeline/*.ts`).
      Their own comments name `rep_counter.py` as the source, so **they are
      squat-shaped numbers that all 58 exercises will inherit.** The concrete
      case, verified: `fsm.ts` computes `Math.max(MIN_REP_INTERVAL_MS,
      config.minRepMs ?? 0)`, so a definition can only make the gap between reps
      LONGER — **a genuinely fast exercise cannot go below 450 ms without editing
      the constant every other exercise reads.** That edit is the interference Kd
      is asking about, and it is the one real path to it.
      **THE PROTECTION EXISTS BUT IS PARTIAL, and the distinction matters: the
      golden traces CATCH such a change, they do not PREVENT it** — squat's traces
      assert rep counts exactly, so a counting constant that moves goes loudly red.
      **They assert nothing about timing** (the L14 line above), so a shared
      constant that shifts durations only would pass. **The fix, when the first
      exercise actually needs it, is to promote that constant into the definition
      schema with the engine value as the default** — never to retune the shared
      one. Not owed before exercise 4; owed before the first exercise that needs a
      different value, and R5.4 forbids re-deriving any of them meanwhile.
- [ ] ⚪ **THREE OF THE FOUR REP MODES DO NOT EXIST, AND EACH WILL NEED ITS OWN
      LOST-SIGHT HANDLING — today's rep-timing fix will NOT carry over to them.**
      `RepMode` declares `alternating_threshold | hold | alternating_sides |
      cadence` (`fsm.ts:28`), and `session.ts:88` constructs `ModeAFsm`
      unconditionally: **only `alternating_threshold` is built.** So holds
      (plank), left-right alternating (lunges) and cadence exercises each need a
      counter written, and **each must re-implement the rule that a rep's clock
      re-arms when the camera stops being able to watch** — the whole subject of
      DECISIONS :7404 and :7487, which lives inside `ModeAFsm` and is not
      inherited by a sibling class. Written down BEFORE those cards exist
      precisely because whoever writes the plank counter will not otherwise know
      this fix happened: a plank whose hold clock swallows a two-minute absence is
      the same defect Kd found, in the mode where it is arguably worse. Part 2
      §3.6 sequences the modes; §7.3's fixture matrix must cover an absence for
      each new one.
      **EXTENDED 2026-08-14 by the API half (DECISIONS :7730): `watchedMs` is
      accumulated in `session.ts` and so is mode-agnostic, but one of its two
      blindness signals is NOT** — the occluded path reads `fsm.sightLost`, which
      is `ModeAFsm`'s. A sibling counter that does not set it will report a hold
      or a lunge set as fully watched through an occlusion, **and the server now
      BILLS from that number**, so the consequence is larger than it was when this
      line was written. Whoever writes the second counter owes the flag as well as
      the clock.
- [ ] ⚪ **WEARABLES — the app neither sends a workout to a user's watch nor
      reads one from it.** Created 2026-08-16 from Kd's question (DECISIONS
      :8808). **It was tracked NOWHERE before that day** — grep-verified across
      this file and `RUNBOOK/cutover.md` — though `02-part2b-trust-layer.md:169`
      has scheduled it since the spec was written (§2.4 Roadmap: wearable heart
      rate upgrades the calorie method at Part 6, with MET as the universal
      fallback). **A roadmap paragraph is not a to-do list**, which is the whole
      reason this file exists.
      **Not a decision and not a commitment** — Kd asked whether it is possible
      and costly and said expressly he was not asking to build it now.
      **BLOCKED ON P5 BY CONSTRUCTION, not by priority:** the phone health stores
      are reachable only from a NATIVE app, and live heart rate during a set
      additionally needs a companion app on the watch. Nothing here is buildable
      from the web, so this cannot start before the mobile phase whatever the
      appetite.
      **When it does run, three things are already decided by argument and should
      not be re-derived:** (1) **write OUT before reading IN** — pushing our
      finished workout into the user's health app closes their rings, is far less
      work than ingestion, and is what users actually notice; (2) **direct
      integrations, not a paid aggregator** — the platforms charge nothing per
      user while an aggregator bills monthly per user for a convenience that only
      matters for the long tail; (3) **dedupe is part of the card, not an
      afterthought** — the app already records runs by GPS, so an imported watch
      run can land the SAME run twice and double a user's distance and calories.
      ~~**Audience caveat, recorded because it decides SEQUENCE:** the pilot is
      Jorhat gyms, where Apple Watch and Garmin are rare and the dominant cheap
      bands expose no open API at all. A wearable card may serve very few of the
      first hundred users.~~ **STRUCK BY KD THE SAME DAY: "my target is all over
      world including assam that is jorhat".** Jorhat is the PILOT, not the
      market, and Part 3 §6.3 (*Worldwide*) already says so — localised console
      currency, org-timezone boundaries, message keys from day one. **On a
      worldwide target the value of this is HIGHER than the struck sentence
      claimed**, since Apple Watch and Garmin are common in the markets a
      worldwide launch reaches. It still varies by market, so it is not a
      uniform win — but it is no longer an argument for deferring.
      **Health data is sensitive personal data** and lands inside the open
      privacy-scope question below (:592), still unruled.
      **Platform specifics in the DECISIONS entry are marked UNVERIFIED** —
      model knowledge, not a source read, and these companies change their terms.
      Re-check every one at planning time (V5).

## Gym platform — Kd's 2026-08-18 product rulings (DECISIONS :9604)

**Read the ruling before working any line here.** On 2026-08-18 Kd moved the
project from *a consumer camera-coach app with a gym console bolted on* to *a gym
platform sold to US gyms, whose consumer app is one surface*. Fifteen rulings in
one session. Everything below is new work created by that shift, or existing work
whose priority it changed.

**HOW TO READ THE MARKERS IN THIS SECTION.** The file legend is anchored to the
P2.8 cutover, and **nothing here blocks the cutover** — switching off the old
backend does not need any of it. So there are no 🔴 lines below. 🟡 here means
*"needed before a US gym signs"*, which is a different bar from the rest of the
file and is stated so nobody reads these as lower priority than they are.

**NOT A PLAN.** No card is written, no sequence approved, no estimate ratified.

### Direction changes that re-price existing work

- [ ] 🟡 **WEB MEMBER SCREENS ARE NOW OWED-ONLY — building more of them buys the
      product nothing.** Kd ruled the mobile app is the product and web is "just
      side" (:9604 §1). Measured that session: `packages/engine` (20 files,
      `dependencies: {}`), `packages/shared` (20 files), all of `apps/api` and
      every exercise definition transfer to mobile UNCHANGED — but all **24**
      files under `apps/web/src/pages` do not, because React and React Native
      share no screen code. **Web keeps ONE job and it is worth keeping: the TEST
      RIG** — filming fixtures and checking a new exercise counts correctly
      without waiting for a phone build. A chat proposing "finish web first, it
      will speed up mobile" is wrong on measured grounds and this line is the
      refutation.
- [ ] 🟡 **PART 5 §1'S PRICE BOOKS ARE INDIA-ONLY AND ARE NOW UNRESOLVED.** The
      market is US gyms (:9604 §2). US gyms pay multiples of the Indian tiers.
      This is not "un-ratified pricing" any more — the numbers in the spec are for
      the wrong country. Blocks any billing card and any gym pitch.
      **UPDATE 2026-08-18 (DECISIONS :9944): a Kd proposal now EXISTS and the
      math is done** — gym tiers $20/$30/$40/$50 by member count, consumers
      $5/mo, 8 meal scans + 2 route plans per day in both channels. Measured
      against the live cost ledger: covered in the normal case (~3-5× headroom),
      underwater only under full-roster daily use; three boundary/cap fixes put
      with the math. **AWAITING KD'S RATIFICATION — do not seed or quote these
      numbers until he confirms.**
- [ ] 🟡 **IN-APP CONSENT SCREEN FOR HEALTH DATA AND THE CAMERA — needed before
      a US gym signs (DECISIONS :9944).** Whatever the gym's contract says
      about the roster upload, health-type data (meals, weight, workouts) and
      the camera sit under US state laws that reach the app directly — so the
      app asks the MEMBER at first use, not the gym. Small build; its wording
      is part of the pre-signing lawyer review (:592).
- [ ] 🟡 **THE PRIVACY-LAW QUESTION (:592) IS NO LONGER THEORETICAL.** US workout
      and body data is health data and several states legislate it specifically.
      Still unruled; now on the critical path to a signed gym rather than behind
      it. Its own ❓ line remains below in the open-questions section — this line
      exists so the priority change is visible from here.

### The AI chat coach — switched OFF by Kd ruling

- [ ] 🟡 **UNWIRE THE AI CHAT COACH FROM WEB (and never wire it on mobile).**
      Kd: *"i have decided to drop the chat bot from both web and mobile"*
      (:9604 §5). **THIS IS THE NO-REMOVAL RULE'S AUTHORISED PATH — an explicit Kd
      ruling made against a cited cost — not a breach of it.**
      **OFF, NOT DELETED, and the distinction is the point.** Measured:
      `apps/api/src/modules/coach` is 1,617 lines over 13 files including a full
      retrieval pipeline and an ingested knowledge base; `Coach.jsx` is 772 lines;
      `grep -rln coach` outside the module returns 15 files, five of them privacy
      (export and account-delete must still account for stored conversations).
      Deleting is a day across six subsystems with real risk to export/delete.
      Unwiring the route is an hour and is reversible.
      **EXECUTION DETAIL THAT DECIDES WHETHER IT WORKS: remove the ROUTE/import,
      not the nav button.** Hiding the button leaves the 772-line screen in the
      download; removing the route drops it and its exclusive dependencies
      automatically. The 1,617 server lines are never downloaded by anyone and
      cost app size nothing — this was Kd's own question and it has a precise
      answer.
- [ ] ⚪ **~SEVEN COACH ITEMS IN THIS FILE ARE PARKED, NOT DONE — DO NOT TICK
      THEM.** Empty conversation on a failed message · a question spent when the
      provider never answers · raw HTML in answers · over-long message recovery ·
      streaming · read-path ordering tiebreaker · the secure-context message id.
      They park with the feature and return if it does. Ticking them would record
      work that never happened.

### Gym platform — the console and the gym's own money

- [ ] 🟡 **THE GYM CONSOLE DOES NOT EXIST: gyms, join codes, seats.** Measured
      2026-08-18 — `apps/api/src/modules/` has no `org`, `billing`, `webhook` or
      `console` directory; the DB tables (`tenancy.ts`, `orgAnalytics.ts`,
      `money.ts`) exist and nothing reads or writes them through a route.
      **Nothing else on this list works until a gym can exist and people can join
      it**, so this is the first slice whenever a slice is cut.
      **THE HALF THAT IS ALREADY BUILT AND TESTED, so nobody rebuilds it:** the
      entitlement resolver already treats `gym_membership` as a grant source
      alongside `own_subscription` and `free`, and merges them so a member with
      both gets the better one (`modules/entitlements/service.ts`,
      `mergeEntitlements`). Its own comment names the gap — *"P3/gyms add the
      rest"*. What is missing is the gym side that FEEDS it.
      **UPDATE 2026-08-18 — THE API HALF IS BUILT (DECISIONS :10010). THIS LINE
      DOES NOT TICK: it names the CONSOLE, and no console screen exists.** What
      now exists: `apps/api/src/modules/orgs` with `POST /v1/orgs` (org + first
      "Front Desk" code + owner staff row + the owner's complimentary seat, one
      transaction), `GET /v1/orgs/mine`, `POST /v1/orgs/join` (Part 4 §4.2's
      seat-safe join, `FOR UPDATE` on the org row, idempotent repeat) and
      `GET /v1/orgs/:gymId/members`. **The resolver's gap above is CLOSED** —
      joining busts the §4.1 cache and a member of a subscribed gym is upgraded
      on the next read, proven end-to-end by test rather than by reading the
      code. No migration: the §3.2 tables were already there. What is still
      owed sits in the lines added below plus the console screens themselves.
      **UPDATE 2026-08-18 — THE CONSOLE SCREENS NOW EXIST, so this line's own
      headline ("does not exist") is no longer true and is corrected here rather
      than left standing.** `/console` (the gyms you staff) · `/console/new`
      (Part 3 §4.0 step 1 + step 4's code reveal) · `/console/:orgSlug` (the
      gym, its live join code, its member count) · `/console/:orgSlug/members`
      (§2.4's roster, cursor-walked), all under a responsive shell with a left
      rail at `md`+ and bottom tabs below it (§3.1, and Kd's phone ruling at
      :9604 §4). Reached from a **My Gym** entry in the app's own sidebar. One
      API route was added with them — `GET /v1/orgs/:gymId/codes`, Part 3
      §3.3's read half — because **a join code left the server exactly once,
      in the create response, so the console could not show an owner their own
      code after a reload.** Kd ruled the endpoint in rather than let the screen
      print a code from its own memory of one.
      **STILL DOES NOT TICK, and the remaining third is named rather than
      implied:** "seats" in this line's own title is unbuilt — there is no seat
      meter, because a meter needs a cap and no gym has a subscription (the
      line below). §4.1's Overview tiles, §4.3's real Members contents and the
      other four console sections have their own lines. **And smoke and T3 are
      both UNRUN as this is written.**
- [ ] 🟡 **A GYM WITH NO SUBSCRIPTION HAS NO SEAT LIMIT — deferred with the org
      slice, 2026-08-18 (DECISIONS :10010).** The seat check itself is BUILT and
      correct: it reads the cap off the gym's live subscription's plan
      (`trialing|active|past_due`, §4.1's own status set), counts live
      non-complimentary members, and refuses the join at the cap — proven by a
      one-seat test plan and by a two-connection concurrency test. **What is
      deferred is the case where there is NO subscription at all, which today is
      EVERY gym**, because billing does not exist: the cap resolves to null and
      nothing limits the roster. Harmless while nobody is paying and nothing is
      live; a revenue hole the moment a gym is on a tier. Do NOT paper over it
      with a hard-coded default cap: the tier sizes are part of the unratified
      US pricing (:9944).
      ~~**Closes by itself when the billing card writes a subscription row — no
      change to this code is expected.**~~ **STRUCK 2026-08-18 BY T3 ROUND 1
      C/H-1 — that sentence was FALSE, and it was the kind of false that hides
      a defect behind a reassurance.** The seat check refused a member who
      ALREADY held a seat: they sit inside the count the cap is compared
      against, so at the cap their second tap on Join answered "this gym has no
      free places" to somebody standing in the gym. A change to this code WAS
      needed and has been made (the check is skipped for a caller with a live
      membership, read under the org lock). **The lesson is the shape: a
      deferral that also predicts its own future is making two claims, and the
      prediction gets no evidence while the deferral gets all the attention.**
- [x] 🟡 **~~`gyms.currency_display` STILL DEFAULTS TO `INR`~~ — DONE 2026-08-18
      BY KD RULING, in the same session that raised it (DECISIONS :10010).**
      Raised as a deferral; Kd overruled the deferral within the hour: *"no inr
      defalut wil update according to location for now usa india candan and
      europe later"*. **The currency now follows the gym's COUNTRY and the
      SERVER derives it** — `country` is a required field on org create,
      `currencyForCountry` maps it, and a client-sent `currencyDisplay` is
      rejected by the strict body schema (tested). Supported today: **US → USD ·
      IN → INR · CA → CAD · GB → GBP · the 20 euro-area countries → EUR**.
      **The UK is on the pound, not the euro** — a K4 call put to Kd in one line
      and not overruled; "Europe" is not one currency and a UK gym quoted in
      euros is a false number in front of a paying customer.
- [ ] 🟡 **WE ARE NOT OPEN IN MOST OF THE WORLD, AND SAY SO — Kd's "later"
      (DECISIONS :10010).** A country outside the supported map is refused at
      org create with `country_unsupported` and a plain sentence, **never given
      a fallback currency** — a fallback is how a gym in Sydney gets quoted in
      rupees. Concretely refused today and each a real market: **Australia,
      Poland, Switzerland, Sweden, Norway, Denmark, Czechia, Hungary, Romania,
      Brazil** and everywhere else. **Adding a country is one row in
      `COUNTRY_CURRENCY`, but a new currency also needs PRICES that exist**, so
      it belongs with the pricing ratification (:9944) and not with a chat's
      guess. The console's country picker must be built from
      `SUPPORTED_COUNTRIES` — a picker sourced from anywhere else offers a
      country the server then refuses.
- [ ] ⚪ **THE `gyms.currency_display` COLUMN DEFAULT IS STILL `INR` IN THE DDL.**
      Harmless today and measured so: every insert writes the derived value
      explicitly, and a test asserts the value that LANDS IN THE DATABASE rather
      than only the one in the reply. Left alone because changing it is a
      migration (R4.4, reviewed as SQL) for no behavioural gain. **It is a trap
      for a future insert path that forgets the column** — whoever adds one owes
      the check, and the migration that touches `gyms` next should drop the
      default while it is there.
- [ ] 🟡 **TRAINERS CANNOT BE SCOPED TO A GROUP, SO STUDIO AND CLINIC TRAINERS
      ARE HELD OUT OF THE ROSTER ENTIRELY (DECISIONS :10010).** Part 3 §2.2
      grants a trainer the member list "assigned/group only (gym: all)" and
      §2.3 makes group scoping CORE for studios and clinics — but nothing
      assigns a trainer to a group: `gym_staff` has `gym_id`, `user_id`, `role`
      and no group column at all. An unscoped list is the only thing buildable,
      and handing a clinic trainer every caseload is the wrong direction to
      guess in, so a trainer gets the full list on a `gym` (which the matrix
      already grants) and a 403 on a `studio`/`clinic`. **Closed by the card
      that adds trainer→code/group assignment**, which is also what Part 3's
      Groups filter needs.
- [ ] 🟡 **THE REST OF THE §2.2 MATRIX HAS NO ROUTES: ~~remove~~/RESTORE a
      member, ~~create/rotate/expire codes~~, staff management, CSV export,
      nudges.** The org slice built create/join/roster only. Part 3 §4.3's
      remove flow (soft `removed_at`, seat freed instantly, 30-day restore) and
      §2.1's multiple named codes are both specced and both unbuilt.
      **UPDATE 2026-08-21 — CODE MANAGEMENT IS BUILT ON THE SERVER, and the
      line does NOT tick.** `POST /v1/orgs/:gymId/codes` (make one) ·
      `PATCH /v1/orgs/:gymId/codes/:code` (pause/wake, set or clear an end date,
      set or clear a join limit) · `POST /v1/orgs/:gymId/codes/:code/rotate`
      (new code on and old code off in ONE transaction, Part 3 §7's leaked-code
      answer). **The refusal machinery was ALREADY built and already enforced** —
      `applyByCode` has turned away paused, expired and exhausted codes since the
      door was built — so what this adds is the only thing missing: a way for a
      gym to REACH those states. No migration; all four columns have existed
      since `0001_init`. **`codes.manage` is a NEW privilege, deliberately not
      merged with `codes.invite`**: §2.2 grants Invite to all three roles and
      "Create / rotate / expire codes" to owner and manager only, so a trainer
      reads 200 and writes 403.
      **UPDATE, SAME DAY — THE SCREEN IS BUILT and the line STILL does not
      tick.** A **Join codes** section now sits on the gym's Overview, under the
      code being handed out: every code with its live state in words, plus
      switch-off/switch-on, an end date, a people-limit, and Replace behind a
      confirmation. It is a SECTION and not a seventh tab — §3.1 fixes the nav at
      six and surfaces Groups as a filter rather than a screen, which is the same
      call :12343 made for the confirm queue. **A trainer sees the code and none
      of the controls** (§2.2's two rows), and the 403 stays the enforcement.
      **BOTH GATES ARE NOW MET, AND THIS LINE STILL DOES NOT TICK — read the
      next sentence before quoting either fact.** The browser SMOKE **PASSED
      2026-08-21** (Kd, all 13 steps, commit `2273fc4`, "all passed"; run record
      in the sheet, the fixes it produced at DECISIONS :14013), and **T3 round 1
      came back ZERO Critical/High** across all three join-code commits, ten Lows,
      all fixed in the round (DECISIONS :14174, `BACKLOG.md` for the table).
      **So the JOIN-CODE half of this line is DONE and its gates are behind it.**
      What holds the line open is the rest of its own title, which was never about
      codes: ~~RESTORE a member, staff management, CSV export, nudges~~ — **and
      STAFF MANAGEMENT's SERVER half is now built too (2026-08-22, DECISIONS
      :14262): list · add by email · change role · remove**, all four owner-only
      through the new `staff.manage` tick, no migration, and Kd's
      *"yes staff seats free"* written into the appointment.
      **AND ITS SCREEN LANDED 2026-08-22 (DECISIONS :14570): a Settings tab in the
      console with the Staff list on it** — every row with its role and when they
      got the keys, Add someone by email, one tap to switch between manager and
      trainer, and a Remove that asks whether they also stop being a member (Kd's
      ruling that day, on his own question *"suppose owner fires a staff should he
      be still a member after that?"*). **THE LINE STILL DOES NOT TICK, and reason
      (1) has CHANGED SHAPE rather than closed — do not tick it on either reason
      alone.** (1) The staff packet's gates are **NOT behind it: the SMOKE
      (`RUNBOOK/smoke-staff.md`, written) and the web half's T3 are both UNRUN**,
      and a screen with no smoke is what :11846/:13803 refused to tick on.
      (2) **RESTORE a member, CSV export and nudges are still routeless**, and
      staff management itself ships only its ROLE half — the per-staff privilege
      TICKS keep their own line below. A chat that ticks this line because the
      staff work finished will lose three items and half of a fourth.
      ~~**AND A DEFERRAL THIS CARD MAKES, recorded here rather than in prose: a
      code can be turned OFF but never DELETED.** `ORG_CODES_MAX` is 100, derived
      from the `listCodes` ceiling so the list is provably whole rather than
      provably truncated, and retired codes count toward it. A gym rotating
      monthly reaches the cap in eight years; the refusal names the number and
      says to delete one, which is a thing nothing can do yet. Deliberate — a
      delete has to decide what happens to `gym_members.code_id`, which is the
      group attribution every membership carries, and that is a ruling (R0.2),
      not a chat's guess.~~
      **CLOSED 2026-08-21 BY KD'S OWN SMOKE (DECISIONS :14061, commit named
      there): *"codes will pile up should have a option to delete"*.** Built as
      REMOVE, not DELETE, and the ruling the line was waiting for is the one it
      predicted: `gym_members.code_id` (and `gym_join_applications.code_id`)
      reference the row under `ON DELETE RESTRICT`, so a real delete is either
      refused by Postgres for exactly the codes a gym most wants gone — the ones
      people used — or erases how today's members got in. `gym_codes.removed_at`
      (migration `0012`) is the same soft-state shape `gym_members.removed_at`
      already uses. **Only a code that cannot admit anybody may go (paused or
      past its end date), and the UPDATE pauses it in the same statement**, so
      "off the list" and "still opens the door" can never disagree; a merely FULL
      code stays, because a member leaving revives it. The cap now counts VISIBLE
      codes, which makes the refusal's "remove one from the list" a thing an owner
      can actually do — it was pointing at a button that did not exist.
      ~~**Consequence worth knowing: `removed_at` is written by nothing
      today**, so the roster's `removed_at IS NULL` filter is correct but
      untested against a real removal — the card that builds removal owes that
      test.~~
      **UPDATE 2026-08-20 — REMOVE IS BUILT, AND KD IS THE REASON (DECISIONS
      :12343).** Shown a plan whose buttons asked "sure?" because a confirmed
      member could not be removed, he answered *"do you even have some common
      sense if someone joins once can not be rempved what is this"*. Measured
      before building: the ONLY statement in the product that had ever written
      `removed_at` was the DPDP Day-0 cascade, i.e. a person deleting their own
      account. `DELETE /v1/orgs/:gymId/members/:userId` now exists (owner and
      manager, §2.2's remove/restore row), the row is CLOSED not deleted, the
      seat is freed by the same statement, the removed person's entitlement
      cache is busted immediately (Kd's own second ruling), and STAFF are
      refused — an owner is member #1 of their own gym and there is no restore
      to undo it with. Tests cover the roster drop, the freed seat, the retained
      history, the cross-gym scoping, the idempotent second tap, the 404 for a
      non-member and the re-join. **This line does NOT tick: RESTORE (§4.3's 30
      days) is still unbuilt, and so is everything else named above.**
      **What restore costs, so the next card starts informed:** the partial
      unique index is on LIVE rows only, so a restore is not an UPDATE of the
      closed row — it is a decision between reopening that row and inserting a
      new membership, and the two disagree about `joined_at`, which is what
      every membership-interval reader is scoped by (§2.1).
- [ ] 🟡 **THE MEMBERS SCREEN'S REAL CONTENTS ARE NOT SERVED: seat meter, last
      active, workouts 30d, avg form 30d, streak, search, group filter.** Part 3
      §4.3 specifies all of them and §3.2 says they come from `org_member_stats`
      — a view that does not exist. The roster route serves identity, join date,
      group label and the complimentary flag, which is what Part 3 §2.4's
      boundary allows without touching workout tables. **A field added to that
      response without re-reading §2.4 is how the org-visibility promise gets
      broken**, so the next card on it starts there.
- [x] 🟡 **NO SCREEN ANYWHERE LETS A MEMBER TYPE A GYM'S JOIN CODE.**
      **DONE 2026-08-20, commit `c9435d7`** (built across `25e013d` → `c9435d7`).
      Every gate is met: the two screens exist, **smoke PASSED — all 17 steps
      plus 14b, run by Kd on real servers with two accounts** — and **T3 round 2
      found ZERO Critical/High, so the packet shipped** (DECISIONS :12343 built
      it, :12518 round 1, :12660 Kd's removal-message ruling, :12731 round 2).
      **What ticks is STEP 2 of the approved three-step split only** — the
      waiting room's CLOCK (expiry sweep, gym reminder, member nudge) is step 3
      and keeps its own separate line below; nothing about it is done.
      Original text kept in full below, because the reasoning in it still binds
      the step-3 card. Found
      2026-08-19 while building the login door (DECISIONS :10866); **tracked
      nowhere before, grep-verified.** `POST /v1/orgs/join` has existed since
      :10010 — seat-safe, `FOR UPDATE` on the org row, idempotent on a repeat —
      and **no client calls it**: a grep for `orgs/join` over `apps/web/src`
      returns only the console's own `joinCode` display, which is the OWNER
      seeing the code, not a member redeeming it.
      **What this means in plain words:** a gym owner can create a gym, print the
      code and hand it out, and there is no place in the app for the person
      holding it to enter it. The console prints an invitation nobody can accept.
      **It is the member half of the door built today** — "I'm a member" now
      leads somewhere honest, and what is missing is the one screen that connects
      a member to the gym that invited them.
      **Not fixed in the door card (R1.1):** it is a new screen and a new API
      call, not a routing change. **Part 6 §2's QR poster and the
      `aihg://org/join?code=` deep link are the mobile half of the same thing**,
      so whoever builds this should read that first rather than inventing a
      second entry path. The attach-on-join rule from the member-migration ruling
      (:9870) lands on this same screen and must not be designed twice.
      **UPDATE 2026-08-19 — KD RULED THE DOOR'S SHAPE (DECISIONS :11072) and it
      is bigger than a screen: typing a code creates an APPLICATION.** An
      unknown person is PENDING — no seat, no member features — until the front
      desk confirms; a roster match auto-confirms by :9870's rule verbatim
      (verified email, exactly one candidate). This card therefore also needs:
      a pending state (`gym_members` has none — VERIFIED, so a migration), the
      entitlement resolver and §4.2 seat check both excluding pending, the
      console's confirm queue (ONE mechanism shared with the import card), and
      the join route reworked from instant to apply. Read :11072 before
      planning it.
      **TWO BINDING CLARIFICATIONS + ONE OPTION (DECISIONS :11132, Kd's
      convenience challenge):** a pending person keeps the WHOLE FREE APP — a
      build that parks them on a locked or waiting screen is wrong ("no member
      features" = the gym-paid perks only); the import stays OPTIONAL, so this
      door must work with zero files uploaded; and **auto-confirm via the
      imported gym MEMBER NUMBER is an OPTION to evaluate at this card, not
      ruled** — sequential numbers are guessable, so pair with name/phone if
      adopted, under :9870's wrong-match-is-not-fixable rule.
      **THE WAITING ROOM IS RULED TOO (DECISIONS :11385, same day) — three more
      mechanics this card owes:** a pending application **EXPIRES** if nobody
      acts on it and **re-applying is free**, so a leaked code's pile clears
      itself while a missed real member loses seconds (**this RETIRES the
      "stranger waits forever" line above — the stranger still never gets in,
      but the ROW dies**); the **GYM IS REMINDED** — a count in the console from
      day one plus a nudge if applications sit, and **nothing may expire before
      the gym has been told at least once**, or the feature quietly throws
      members away; and the **WAITING MEMBER CAN NUDGE** the gym, rate-limited,
      from a card that sits ON TOP of the whole free app (never a locked or
      waiting screen). **Defaults put to Kd and not objected to, but RATIFIED AT
      THIS CARD, not already decided: 14-day expiry · gym reminded at 2 days
      then weekly · member nudge once a day.** **Ship the IN-APP half first —
      email does not exist (its own line below).**
      **UPDATE 2026-08-19 — THE SERVER HALF IS BUILT (step 1 of 3; DECISIONS
      :11891). THIS LINE DOES NOT TICK: it names a SCREEN, and there is still
      no screen.** Kd approved a three-step split (server → the two screens →
      the waiting room's clock) after being shown that one card would be four
      times the diff that has caused review spirals here before. What exists
      now: `gym_join_applications` (migration `0011`), `POST /v1/orgs/join`
      REWORKED from instant join to APPLY, the confirm queue, confirm/reject,
      and the applicant's own list. **The 14-day expiry is STAMPED on every row
      but nothing acts on it yet** — that is step 3, its own line below.
      Step 2 (the member's code screen carrying §2.4's "what the gym can see"
      sheet, the waiting card, and the console's queue screen) is what ticks
      this line, after its smoke and a review round with zero Critical/High.
      **UPDATE 2026-08-20 — STEP 2 IS BUILT (DECISIONS :12343), ITS SMOKE HAS
      PASSED (all 17 steps including Remove), AND T3 ROUND 1 HAS RUN AND DID NOT
      SHIP IT (DECISIONS :12518). STILL DOES NOT TICK.** Two Critical/High were
      found and are FIXED — a removed member being told the gym never confirmed
      them, and a trainer being drawn a Remove button the server refuses — plus
      six Lows, all fixed in the same round. **Then Kd caught the OTHER half of
      the first one: the fix left the app saying NOTHING to a removed member,
      and he ruled it must TELL them (DECISIONS :12660).** Built:
      `/v1/orgs/mine` now carries a `formerOrgs` list and the card says "You're
      no longer a member of {gym}"; `RUNBOOK/smoke-join-door.md` gains **step
      14b** for it. **T3 ROUND 2 (diff-only) THEN RAN AND FOUND ZERO
      CRITICAL/HIGH — THE PACKET SHIPS (DECISIONS :12731).** Four Lows and three
      lying tests, all fixed in that round; escape hatch NOT armed.
      **UPDATE 2026-08-20 (final) — KD RAN STEP 14b AND IT PASSED. THIS LINE IS
      TICKED.** The last gate was step 14b — the removed member's dashboard
      saying "You're no longer a member of {gym}" — held open because that copy
      was written AFTER the 17-step smoke and no human had yet seen it on a
      screen. Kd ran it and reported **passed**. What exists now: the code
      box at **Settings → Gym** and at
      `/org/join?code=` (Part 6 §2's deep link mirrored, so the mobile QR and
      the web link are one path), §2.4's visibility sheet on the form and again
      named in the answer, a waiting/refused/member card on the dashboard, the
      console's **Waiting to join** section above the roster with the server's
      exact count on the gym's home screen, and — Kd's addition mid-card —
      **Remove**. `RUNBOOK/smoke-join-door.md` is the 17-step sheet.
- [ ] 🟡 **NO TEST ANYWHERE RENDERS `Dashboard.jsx` OR `Settings.jsx`, so their
      wiring is guarded by SOURCE TEXT rather than by behaviour** (deferred
      2026-08-20, DECISIONS :12518, T3 round 1 L-1). The finding was that
      deleting the `/org/join` route, the dashboard's gym card, or either half
      of Settings → Gym left **all 857 web tests green** while the feature
      disappeared from the product. It is FIXED for this card — five source
      assertions in `joinGym.render.test.jsx`, mutation-proved by deleting two
      of the four wiring points — and the limit is stated in the test file:
      **they prove a page still NAMES a component, not that it renders.** A page
      whose own render throws would satisfy them. Closing this properly means a
      render harness for the two big pages (`Dashboard` needs AuthContext,
      TransitionContext, three api services, `useXp` and framer-motion;
      `Settings` is comparable), which is a card of its own and was NOT built
      inside a fix round (`CLAUDE.md` Part I §2.5 rule 6 — minimal diffs).
      **Why it matters beyond this card:** these are the two screens every
      feature lands on, so the same blind spot applies to every future card that
      wires something into either of them, and the source assertions only cover
      what somebody thought to write a regex for. **Not tracked anywhere before
      today** (grep-verified).
- [ ] 🟡 **A POSTER LINK ONLY WORKS IF YOU ARE ALREADY SIGNED IN — the code is
      lost on the way through the login page** (deferred 2026-08-20, DECISIONS
      :12343). `/org/join?code=ABC123` is the address a gym's QR poster points
      at, and it is behind `ProtectedRoute`, which redirects a signed-out
      visitor to `/login` **carrying nothing** — no `state`, no `from`, no
      query. So the person who scanned the poster signs in and lands on their
      dashboard with the code gone, and has to find Settings → Gym and type it
      by hand. **Measured, not assumed:** `ProtectedRoute` is
      `<Navigate to="/login" replace />` with no location, and `landingRoute`
      decides the destination from the DOOR they chose, by Kd's two-doors
      ruling (:10824/:11616).
      **Why it was not fixed in the card that created it (R1.1):** carrying a
      destination through sign-in means touching the login door itself, and that
      is the surface Kd has ruled on twice — a card that quietly adds a third
      thing deciding where you land after signing in is exactly what :10866's
      "four places decided the destination" finding was about.
      **Part 6 §2 says deep links "never dead-end on a login wall"**, so the
      mobile app owes the same fix and should not invent a second mechanism.
      **Cost today:** the poster works for anyone already signed in, which at
      pilot scale is most people standing at a front desk with the app open.
- [ ] 🟡 **NOBODY IS TOLD WHEN A GYM CONFIRMS OR REMOVES THEM — the app waits
      to be asked** (deferred 2026-08-20, DECISIONS :12343). A confirmed member
      finds out by opening the app (their dashboard card changes to "You're a
      member of {gym}"); a removed member finds out because the card is simply
      gone. **Both are silent by construction: there are no notifications and no
      email** — `EmailSender` logs an event name and sends nothing (:11385's own
      line), and no push exists on web. **Nothing false is on screen** — the
      card states the truth whenever it is read — but the person who is standing
      at a front desk waiting to be let in has to keep reloading, and somebody
      removed gets no explanation at all. Part 3 §4.3 specifies the removal
      message in as many words ("You've left {org} — your workouts are yours
      forever" + Pro win-back), so this is a spec item, not an invention.
      **Closes with the notifications module, which no `OWED.md` line had ever
      named until :11385 and which password reset and email verification are
      also waiting on.**
      **WIDENED 2026-08-20 (DECISIONS :12878) — THERE IS NOW A THIRD SILENT
      EVENT, and this one is the machine's:** a join request that runs out is
      changed by a background job at 03:30, and **the person who was waiting
      finds out only by opening the app.** The card is honest about it — the
      dashboard says "Your request to {gym} expired before anyone confirmed it"
      whenever it is read, and the copy promises no message — so nothing false
      is on screen. But somebody who applied and then waited is exactly the
      person least likely to open the app again, and they get no prompt to.
      **It is the strongest case of the three for the notifications module**,
      because the other two follow a human's tap while this one follows nothing
      at all. Same fix, same module, no separate line.
- [x] ~~🔴 **NOTHING EXPIRES, REMINDS OR NUDGES YET — the waiting room has no
      clock (step 3 of the join door; deferred 2026-08-19, DECISIONS :11891).**~~
      **DONE 2026-08-21 — built (DECISIONS :12878), smoked 10/10 (:13174), and
      FIVE T3 rounds closed with round 5 finding ZERO Critical/High (:13552), on
      commit `12383b4`.** The full gate is met: a round with no
      Critical/High (:5348 rule 1) plus the browser smoke. All four owed
      behaviours are live — the expiry sweep, the gym reminder at 2 days then
      weekly, the member's once-a-day nudge, and the countdown on both screens.
      **What the five rounds cost is the record worth keeping: every Critical on
      this card was a calendar word computed from elapsed arithmetic, or a
      document calling a dead condition load-bearing** — the same two shapes in
      the same two files, four rounds running, closed only when round 4 stopped
      patching functions and wrote ONE rule the whole file obeys.
      **BUILT 2026-08-20 (DECISIONS :12878). T3 ROUND 1 HAS RUN AND DID NOT SHIP
      IT (DECISIONS :13075). STILL DOES NOT TICK.** Two Critical/High, both
      FIXED: **the ordering rule was a YES/NO where the promise is a DURATION**
      (a gym measured at 31 minutes' notice against a promise of two days — the
      second time on this card that :11385's own wording produced the outcome it
      forbids), and **the expiry's audit rows lived outside its transaction**, so
      one dead worker made the trail unrecoverable. Seven Lows, all fixed the
      same round (`BACKLOG.md`), including a hazard the card itself introduced:
      an unscoped test sweep could expire the applications the sibling suite was
      confirming.
      **UPDATE 2026-08-21 — THE SMOKE PASSED 10/10 (DECISIONS :13174). The
      DIFF-ONLY RE-REVIEW IS THE ONLY GATE LEFT.** The `expired` arm was seen by
      a human for the first time, and the final run caught the C/H-1 fix
      refusing to delete a real request in a browser. Two sheet defects were
      found and fixed mid-run, both the sheet's.
- [x] ⚪ **DONE 2026-08-21 — KD RULED IT OFF, and the ruling that settled it was
      a different one.** He asked about this during the clock smoke and did not
      rule; what closed it was his no-names ruling on join codes the next day
      (*"this kind of names not needed men"*). **Once no code can be given a
      name, EVERY code carries the same default label** — so the field can no
      longer distinguish anything, and "hide it while a gym has one code" (the
      fix this line proposed) became "hide it always". The label is off the
      waiting row; `groupLabelText` and the roster's own column are UNTOUCHED
      (R1.1 — he named the waiting list). The §2.4 test that asserted the label
      was INVERTED rather than deleted, because "four facts and nothing else" is
      still its subject and the allowed set got smaller by one. Ticked against
      the code-management web half; the no-removal rule's authorised path is the
      explicit ruling. **Original text below.**

      **WAS: THE CONSOLE'S WAITING QUEUE PRINTS THE JOIN CODE'S LABEL ("Front
      Desk") AND IT IS NOISE WHILE A GYM HAS ONE CODE** (raised by Kd during the
      clock smoke, 2026-08-21, DECISIONS :13174). It is Part 3 §2.1's group
      mechanism — the thing that tells a big gym which desk, class or campaign a
      person came through — and it is genuinely useful the moment a gym runs
      several codes. **Today no gym can have a second code**: nothing in the
      product creates, rotates or expires one (the pause/rotate line above is
      the gap), so the label is the same six words on every row.
      **Kd asked whether it is needed and was told the above; he did not rule.**
      Not a defect and not acted on (R1.1). The fix, if he wants it, is to hide
      the label while a gym has exactly one live code — one line, and it
      un-hides itself when the code-management card lands. **His call.** All four owed items
      are in: the expiry sweep · the gym reminder at 2 days then weekly · the
      member's once-a-day nudge · and **:11385's ordering rule, enforced TWICE**
      — in the sweep's sequence and in the expiry statement's own WHERE, so if
      the worker never runs, nothing expires. **The three numbers are now
      RATIFIED rather than defaults**: Kd was asked at this card, as :11385
      required, and chose to keep all three. **No migration was needed** — the
      step-1 card wrote all three columns for this one. The daily job is on the
      existing `rollups` queue at 03:30 UTC, and `tools/orgs-sweep.ts --now`
      stands the clock in the future so the smoke takes minutes rather than a
      fortnight. Original text kept below.
      Every application is stamped with a 14-day `expires_at` when it is
      written, and **no code reads that column.** So today a pending row waits
      for ever, which **contradicts :11385 as written** ("a build that keeps
      pending rows indefinitely now contradicts a ruling") — it is a deferral,
      not a disagreement, and the gap is named here rather than left to be
      discovered. What step 3 owes: the expiry sweep · the gym reminder at 2
      days then weekly · the member's once-a-day nudge · and **:11385's
      ordering rule, which is the load-bearing one — nothing may expire before
      the gym has been told at least once**, or the feature quietly throws
      members away. The three numbers are Kd's ratified defaults and each is one
      word from him to change. BullMQ's `rollups` queue and the DPDP purge
      scheduler are the worked pattern (deterministic jobId, idempotent handler,
      an unknown job THROWS); an injectable clock is required so the timeline is
      testable without waiting a fortnight. **IN-APP ONLY — email does not
      exist (next line), so no copy may promise one.**
- [ ] ⚪ **THE JOIN-APPLICATION SWEEP HAS NO BATCH LIMIT — every overdue row in
      the whole database moves in one statement** (deferred 2026-08-20,
      DECISIONS :12878). `purgeDueUsers` next door takes a `limit` and this does
      not, deliberately: the DPDP purge walks each user through a transaction
      doing real work, while this is three set-based UPDATEs against a PARTIAL
      INDEX (`gym_join_applications_expiry_idx`, on `expires_at` where status is
      pending), and batching a set-based statement adds a cursor and a
      resume-point for no gain at the size the product is.
      **The honest cost, stated rather than discovered later:** at a scale where
      tens of thousands of applications go overdue on one night, that UPDATE
      holds a lot of row locks at once — and the rows it locks are exactly the
      ones a front desk might be confirming at that moment, so a confirm could
      block behind the sweep. **03:30 UTC is not the middle of the night
      everywhere** (it is 09:00 in Jorhat), which is what makes that reachable
      rather than theoretical.
      **Not fixed now (R1.1) and no number invented:** the fix is a `LIMIT` plus
      a loop, or moving the schedule per-region, and choosing between them needs
      a real roster size nobody has yet. **The trigger to revisit is the first
      gym with thousands of members**, i.e. the same trigger the roster-import
      work has. Tracked nowhere before today.
- [ ] 🟡 **AUTO-CONFIRM CANNOT BE BUILT YET: there is no imported roster to
      match against** (deferred 2026-08-19, DECISIONS :11891). :11072 rules that
      "a person matching the gym's imported roster is confirmed AUTOMATICALLY"
      by :9870's key verbatim — verified email, exactly ONE candidate row in
      that gym. **Measured: no roster/import table exists at all**, so the
      candidate set is empty by construction and the branch has no input. It was
      NOT stubbed (R1.3 — a stub that returns success is a security bug wearing
      a disguise); the join response's outcome union deliberately has **no
      `joined` arm**, so the import card adds the arm together with the code
      that produces it. **What this costs TODAY, and Kd was told: every single
      applicant waits for a front-desk tap, including a gym's own existing
      members.** Acceptable only because :11132 keeps them on the whole free app
      meanwhile. Closes with the import card, not before.
- [ ] 🟡 **PER-STAFF PRIVILEGE TICKS HAVE NO STORAGE — the seam is in, the
      table is not** (deferred 2026-08-19, DECISIONS :11891). Kd ruled the model
      at :11429 and reaffirmed the widening half on 2026-08-19: *"ok only owner
      and manager but if owner gives permission others can also add"*. Built
      now: `requirePrivilege`, a named finite privilege set, and role DEFAULTS —
      **no route checks a role NAME any more**, which is the hole :11429 says a
      new route re-opens. **Not built: the ticks themselves.** `gym_staff` holds
      gym/user/role and nothing else, so an owner cannot yet widen one person's
      access and a gym whose front desk is a TRAINER cannot confirm joins. The
      staff card owes: the migration (:11429's K4 call — store the EFFECTIVE set
      as a SNAPSHOT, table-vs-JSONB decided there against R4.2), an owner-only
      route, **the last-owner lockout guard (rule 2 — §4.7 blocks last-owner
      REMOVAL and ticking away billing/staff-management is the same lockout by
      another door)**, audit logging, and the Staff screen. When it lands it
      replaces the body of one function and no caller changes.
      **UPDATE 2026-08-22 (DECISIONS :14262) — THE ROLE HALF IS BUILT AND THIS
      LINE DOES NOT TICK.** A gym can now appoint managers and trainers (server
      only, no screen), so *"a gym whose front desk is a TRAINER cannot confirm
      joins"* is a REACHABLE state rather than a hypothetical one — which makes
      the ticks more wanted, not less. **Discharged by that card and no longer
      owed here: the last-owner lockout guard** (a COUNT inside the org lock,
      written so it stays correct on the day a second owner can exist) **and the
      audit logging** (add · role change · remove; a no-op role tap deliberately
      writes nothing). **Still owed here: the migration, the owner-only ticks
      route, and the Staff screen.** The permission model is no longer the
      missing part — `staff.manage` is the owner-only privilege that card added —
      what is missing is STORAGE.
      **UPDATE 2026-08-22 (DECISIONS :15381) — THE STORAGE AND THE ROUTE ARE
      BUILT AND THIS LINE STILL DOES NOT TICK.** Migration `0013` gives
      `gym_staff` its `privileges` column; `requirePrivilege` decides on the
      STORED set; `PUT /v1/orgs/:gymId/staff/:userId/privileges` is the
      owner-only way to change it, audit-logged at both ends; a role change
      RESETS the ticks, so a demotion demotes. **What remains is the SCREEN — an
      owner cannot reach any of this today**, which is also why there was no
      smoke to run (:10010's no-screen precedent). The last-owner lockout guard
      on the TICK door landed with it (a count inside the org lock, the sibling
      of the REMOVE door's guard built at :14262).
      **UPDATE 2026-08-23 (DECISIONS :15773) — THE SCREEN IS BUILT AND THE LINE
      STILL DOES NOT TICK, because its two gates are unrun.** An owner opens
      **What they can do** on any staff row and gets the boxes: the effective set
      the server holds, `staff.manage` absent for anybody but the owner, Save
      sending the WHOLE set, and the role button asking first because a role
      change resets the ticks. **NOTHING IS OWED IN CODE ON THIS LINE ANY MORE**
      — what holds it open is `RUNBOOK/smoke-staff-privileges.md` (10 steps,
      written, UNRUN) and T3 (UNRUN). It ticks on a passed smoke plus a review
      round finding zero Critical/High, and on nothing less (:4718 F4, :5034 —
      ticking on code alone is this branch's most repeated bookkeeping defect).
      **Step 6 of that sheet is the one the tick really rests on:** it is the
      only step that proves the SERVER enforces an untick rather than the screen
      merely drawing it (R3.3, :11429 rule 4).
      **UPDATE 2026-08-23 (DECISIONS :15927) — THE SMOKE PASSED 10/10 AND THIS
      LINE STILL DOES NOT TICK: T3 IS THE ONE REMAINING GATE.** Kd's run on
      `245632d`, tree verified byte-identical before and after. **Step 6 passed in
      BOTH directions** — the helper was refused the member list the moment the
      box came off and got it back when it went on — and **step 7 repeated the
      enforcement on a SECOND power** (`codes.manage`: the controls went, the code
      itself stayed, because `codes.invite` is a different tick). A passing smoke
      is not a review (:14147); one round finding zero Critical/High is what is
      left.
      **T3 ROUND 1 HAS SINCE RUN — ONE Critical/High, THREE Low; THE PACKET DOES
      NOT SHIP and this line stays open.** **A power ticked ON for a TRAINER
      reaches no control**: the console gates the join-code panel and the Remove
      button on the ROLE NAME (`canManageCodes`, `canRemoveMembers`) while the
      server gates on the TICK (`codes.manage`, `members.remove`) — :11429's seam
      never reached the client, and **`myOrgSchema` carries `staffRole` and no
      `privileges`, so the console has no source for the caller's own set.** That
      is the root and the fix crosses `@app/shared` + `apps/api` + `apps/web`.
      **The smoke could not have caught it** — step 7's widening ✅ is
      unachievable for a trainer and the run used a Manager. Findings listed and
      **approved by Kd before any code** (:5348). Escape hatch NOT armed (:15673
      found zero, and this is the web console rather than `modules/orgs`). **The run needed a MIGRATION APPLIED FIRST — see the ⚪ line below;
      the dev database was one change behind and every screen inside a gym was
      failing.**
      **UPDATE 2026-08-23 (DECISIONS :16095) — ALL FOUR FINDINGS ARE FIXED AND
      THIS LINE STILL DOES NOT TICK: the DIFF-ONLY RE-REVIEW is the one gate
      left** (:5348 rule 2). `/v1/orgs/mine` now serves the caller's effective set
      through the SAME `privilegesFor` the door uses, so screen and server come
      out of one function; both gates ask for the POWER; `privileges` is parsed
      leniently on READS and strictly on the WRITE. **Rule 3 measured for all
      four** — each watched RED under its own defect and GREEN restored, sources
      sha256-verified. web 1127/1127 · orgs.routes 104/104 · db.migration 8/8 ·
      shared 51/51 · WEB SWEEP whole table 64 · 64 RED · 0 ALIVE · API SWEEP a
      stated subset 2 of 105 · 2 RED. **A passing smoke plus a closed round is
      still not a review** (:14147).
- [ ] 🟡 **THE TICK-BOXES SMOKE HAS NO STEP THAT TICKS A POWER *ON* FOR A
      TRAINER — which is the only shape that can catch the defect T3 round 1
      found** (2026-08-23, DECISIONS :16095). **Read before running or editing
      `RUNBOOK/smoke-staff-privileges.md`.** Step 7's ✅ says "the helper can now
      use the join-code controls that they could not before", which **a MANAGER
      cannot demonstrate** — they already hold every non-owner power, so the sheet
      itself sends the runner down the parenthetical UNTICK path. The 10/10 pass
      at :15927 is TRUE and is **not evidence about widening**, and the Critical
      it missed is precisely widening. Fix is one step: appoint a TRAINER, tick
      *Change join codes* on, and confirm the controls APPEAR in their window
      **after a reload** — the reload matters, see the line below. Not written
      into the sheet in the fix round (:5348 rule 6); it is a sheet change and
      belongs with the re-smoke.
- [ ] ⚪ **THE CONSOLE LEARNS WHAT YOU MAY DO WHEN A SCREEN OPENS AND NEVER
      AGAIN — so an idle tab keeps drawing controls for a role you no longer
      hold** (found 2026-08-23, DECISIONS :15927; **Kd pushed back on "leave it"
      and was right**). **Read before touching `useConsoleOrg`, and before
      answering "does a real user have to refresh?".**
      **Not a security defect and that half is verified:** OWASP's rule is that
      the server decides every request and that hiding is never the lock, and
      `requirePrivilege` does exactly that on every gym-scoped route — a stale tab
      can draw a button, never get one past the server.
      **What it costs is a lie on screen and a confused person.** `useConsoleOrg`'s
      effect is keyed `[orgSlug, attempt]` and each console page mounts its own,
      so moving BETWEEN screens re-reads and **sitting still on one does not**.
      The realistic case is the one that actually happened here: two people side
      by side, one ticks a box, the other says "nothing happened".
      **It is PRE-EXISTING — the ticks card did not cause it — but the ticks make
      it bite far more often**, because before this a person's powers changed only
      when their ROLE changed, which is rare, and now an owner can change one at
      any time.
      **THE INDUSTRY ANSWER IS RE-CHECK ON WINDOW FOCUS, and the evidence is that
      it is a DEFAULT rather than a feature: TanStack Query ships
      `refetchOnWindowFocus: true` out of the box.** We hand-rolled the hook, so we
      inherited no such default. **Recommended: option 2 of three** — re-read when
      the window regains focus (small, fixes the case that annoys somebody);
      option 1 was "leave it" and option 3 was polling every few seconds, which
      buys little and chatters. **Its own card, straight after the ticks fix
      round — NOT inside it** (:5348 rule 6: a fix round carries only the fix).
      **It also nearly cost a real Critical/High:** told about the T3 finding, Kd
      tested on a tab open since that account was a Manager, it worked, and that
      read as an acquittal until he reloaded. **A browser check on a stale tab is
      not a measurement** (:11846 — the unnamed cause pointed the flattering way).
- [ ] 🟡 **NOTHING NOTICES WHEN THE DEV DATABASE FALLS A MIGRATION BEHIND, AND IT
      HAD — for a day, with every screen inside a gym failing** (found
      2026-08-23, DECISIONS :15927). **Read before running any browser smoke, and
      before quoting a card's PROVE as evidence that the app works.**
      **Measured, not inferred:** the Neon dev branch `apps/api/.env` points at
      held **12 of the 13** migrations; `gym_staff.privileges` did not exist, and
      `getStaffAuthority` — which gates **every** gym-scoped route through
      `requirePrivilege` — selects it, so Members, Overview, join codes and
      Settings all failed. Applied by hand and verified in the database
      (13 applied, both owner rows backfilled, 0 left NULL, 107 gyms untouched).
      **HOW IT GOT THERE, and it is nobody's carelessness — it is a GAP BETWEEN
      TWO CORRECT THINGS:** :13659 moved the api suite onto a LOCAL Postgres, and
      :15381's PROVE says "all on LOCAL Postgres" quite properly; CI applies
      migrations to its own ephemeral Neon *branch*. **So the one database a
      browser actually reads is applied to by hand and by nothing else**, and the
      day the server half shipped, nobody did. **The card was not wrong; the
      pipeline has no step that owns this.**
      **Why it is worth a line rather than a shrug:** the failure is SILENT until
      a person opens a screen, and it points the flattering way — `/console`
      still lists your gyms, so it reads as one broken screen rather than a
      database a change behind. **It also rehearses the deploy**: the same gap on
      the day P2.8 cuts over is every gym's console dark.
      **Candidate fixes, none chosen (Kd's call, R0.2):** a boot-time check in
      `apps/api` that refuses to start against a database with pending
      migrations, naming the command — the loudest and the cheapest; or a line in
      every smoke sheet's setup (done for the staff-privileges sheet already, as
      a case fix not a class fix — :1239); or making "apply to the dev database"
      an explicit step of any card that ships a migration. **The boot-time check
      is the recommendation**: it is the only one that cannot be forgotten, and
      it converts a silent wrong answer into a refusal to start (:11846's
      precedent — an instrument that refuses a verdict it cannot back is the
      instrument working).
- [ ] 🟡 **A GYM CANNOT APPOINT SOMEBODY WHO IS NOT ALREADY A MEMBER — because
      the invite email cannot be sent** (deferred 2026-08-22, DECISIONS :14262).
      Part 3 §4.7 says "invite by email/phone with role"; what ships is the
      by-email half narrowed to **people already on this gym's live roster**.
      Two reasons, and only the first is a dependency: **`EmailSender` logs an
      event name and delivers nothing** (:11385's own line), so an invite to
      somebody with no account would be a promise the product cannot keep; and a
      lookup across the whole `users` table would turn the route into an
      **account-existence oracle** for any address an owner types. **The second
      reason does not expire** — whenever the invite lands it must go through a
      token the invitee redeems, never a "does this email exist" answer.
      Cost today, stated to Kd before he approved: a manager who is not a member
      joins with the gym's own code first, which takes seconds. **Closes with the
      notifications module**, alongside the three silent join events and password
      reset. Phone is separate and is NOT owed — :12600 struck phone OTP.
- [ ] 🟡 **A GYM CANNOT BE HANDED TO SOMEBODY ELSE: there is no second owner and
      no transfer** (deferred 2026-08-22, DECISIONS :14262). The staff card ships
      `manager|trainer` as the assignable roles and refuses the owner's own role
      at the row as well as at the boundary, so **every owner is the LAST owner**
      and `last_owner` is the only answer removal can give about one. That is the
      safe half; the unsafe half is what nobody has ruled: **when an owner hands
      the gym over, what happens to them** — do they stay staff, keep §4.0 step
      6's complimentary seat, keep billing (§2.2 gives billing to the owner
      alone), and may there be TWO owners at once or only a swap? Shipping the
      widening half alone would let a gym acquire a second owner with no ruling on
      what that means, which is how §4.7's last-owner rule quietly stops meaning
      anything. **The removal guard is already written as a COUNT, not as "is this
      the owner", so the day a second owner exists it keeps working** — that was
      deliberate and is the only part of this that is done. Needs a Kd ruling
      (R0.2) before a card, and it is a real gym's real question: owners sell
      gyms.
- [ ] 🟡 **THE ROSTER'S CURSOR CAN SILENTLY SKIP A MEMBER — a millisecond
      cursor against a microsecond column** (found 2026-08-19 by the join
      door's own new test finding the mirror-image bug in ITS pager; DECISIONS
      :11846). **Measured, not reasoned:** Postgres stores `timestamptz` to the
      microsecond (`now()` came back `…467902`) while a JS `Date` — and so
      `toISOString()` — carries milliseconds (`…467`). `GET /v1/orgs/:gymId/
      members` serialises `joined_at` into its cursor, so the cursor names an
      instant slightly EARLIER than the row it came from. Ordered DESC with
      `<`, that **excludes** rather than repeats: any member whose `joined_at`
      falls between the truncated millisecond and the true value is **dropped
      from the roster and never appears on any page.** The confirm queue had the
      same defect pointing the other way (ASC + `>` REPEATED the boundary row),
      which is how it was found — a duplicate is visible on page two, a gap is
      invisible for ever. **Not fixed here (R1.1):** the roster is a shipped,
      reviewed surface and its cursor is a wire format, so changing it is its
      own card. **The fix is known and already worked:** carry the row's ID and
      let SQL read the true value back (`(joined_at, id) < (SELECT …)`), exactly
      as `listApplications` now does. **Needs two rows inside the same
      millisecond to bite**, which is why four fixtures created seconds apart
      have never shown it — and why the roster IMPORT, which writes many rows in
      one transaction, is the thing most likely to trip it.
- [ ] ⚪ **THE JOIN SCREEN'S LEADERBOARD OPT-OUT IS NOT BUILT** (deferred
      2026-08-19, DECISIONS :11891). Part 6 §2 lists the org-membership surface
      as "join-by-code + **'What {org} can see' sheet** + leaderboard opt-out".
      The sheet is step 2's and is binding (§2.4 requires it at join time); the
      opt-out is not built and is ⚪ rather than 🟡 because **`hidden_from_boards`
      already exists as a column and there are no leaderboards to be on** — the
      board work is P4.x and its dark window is a SCHEDULED state (:1020), not a
      bug. Build it with the boards, on the same screen.
- [ ] 🟡 **NO EMAIL IS EVER ACTUALLY SENT — `EmailSender` LOGS AND RETURNS.**
      Found 2026-08-19 while ruling the join-application reminders (DECISIONS
      :11385); **tracked nowhere in this file before, grep-verified** (`grep -ni
      "notification"` returned two hits, neither of them this). The default
      implementation logs event names only — deliberately, at P2.1 GAP-5 on
      2026-07-11, with real delivery deferred to "the notifications module"
      **that no line has ever owed.** **What is silently affected TODAY, not
      later:** password reset and email verification both mint a one-time token
      and then send nothing, so the only way anybody has ever completed either
      flow is a developer reading it out of the database. **What is blocked
      tomorrow:** every reminder, nudge and D-5 trial email in the gym plan.
      **Not urgent-in-itself and genuinely load-bearing — it is the difference
      between "we told the gym" and "we believe we told the gym".** Whoever
      builds it owes the provider choice (an R1.4 approval) and the rule that a
      send failure is logged and retried, never swallowed.
- [ ] 🟡 **NEITHER `POST /v1/orgs/join` NOR `POST /v1/orgs` HAS A PER-ROUTE RATE
      LIMIT — only the global one.** **JOIN:** codes are 6 characters over a
      32-symbol alphabet (~1.07 billion), so guessing one is not a practical
      attack and this is not urgent; it is recorded because the join route is
      the one place a guess turns into membership of somebody else's gym.
      **CREATE (added 2026-08-18 by T3 round 1 L-5, tracked nowhere before):**
      one account can mint gyms at the global 300/min, which costs us rows and
      lets somebody squat every readable slug — `iron-house` is first-come, and
      a real gym arriving later gets `iron-house-24kq`. The per-route limiter
      pattern already exists in the auth module (dual-keyed per-IP and
      per-identifier). Owed before a real gym is live; deliberately NOT built
      inside the fix round that found it (:5348 rule 6, minimal diffs).
      **WIDENED 2026-08-18 to `GET /v1/orgs/:gymId/codes`**, added with the
      console screen: it is staff-only and takes a uuid, so it is not a guessing
      surface, but it is now the endpoint that hands out the key to a gym's
      roster and it has no per-route limit either.
      **HALF DONE 2026-08-19 (DECISIONS :11891): `POST /v1/orgs/join` NOW HAS
      ONE** — closed inside the waiting-room card because that card rewrote the
      route anyway and it is now the door a stranger with a leaked code knocks
      on. **10/hour per ACCOUNT and 120/hour per IP, and the asymmetry is the
      point:** a real person applies to their gym once, but the normal case for
      the IP dimension is thirty members on the same gym wi-fi on induction day,
      so a tight per-IP number would lock out the exact scenario the feature
      exists for. Neither figure has a governing § — both are recorded as chosen
      (R0.2). Required a small additive `ipMax` option on the shared dual-bucket
      limiter; every auth route is unchanged and its suite proves it.
      **STILL OPEN: `POST /v1/orgs` and `GET /v1/orgs/:gymId/codes`**, which is
      why this line does not tick — the create surface is the one that lets a
      single account squat every readable slug.
- [ ] 🟡 **THE RUNNING FEATURE HAS A HARD CEILING AT A FEW HUNDRED ACTIVE USERS,
      AND IT FAILS AS A DEAD FEATURE RATHER THAN A BILL** (found 2026-08-19
      answering Kd's pricing question; DECISIONS :12111. **Tracked nowhere
      before — `grep -ni openrouteservice OWED.md` returns 0**; :9944 carried it
      as one UNVERIFIED clause inside a pricing entry).
      **Measured in the code:** `generateRoutes` loops `routeSeeds(input.count)`
      and makes ONE provider call per seed with one `api_cost_events` row each,
      and `count` is 1-5 **default 3** (`packages/shared/src/geo.ts:14`). So a
      member's **3 route plans a day is 9 external calls a day, up to 15** — not
      3. ORS bills a request COUNT against a daily allowance, not per call
      (`geo/cost.ts`, `ORS_ROUTE_COST_MICRO = 0n`), **and that allowance is
      shared across the WHOLE APP, not per gym.**
      **THE SIZE IS STILL UNVERIFIED AND THAT IS THE FIRST THING OWED:**
      openrouteservice.org's restrictions page lists functional limits only and
      no rate limits; secondary sources say ~2,000/day (40/min), one says 2,500.
      **The account dashboard is the only authority and nobody has looked.**
      **At ~2,000/day, roughly 130-220 members app-wide using their full
      allowance exhausts routing for EVERY user of EVERY gym that day** — and
      the path is deliberately fail-closed with no mock fallback
      (`geo/service.ts` logs `geo.ors_failed` and throws a typed 503), so what
      they all see is "route generation is temporarily unavailable".
      **Why this is not a pricing problem:** it arrives regardless of what a gym
      pays, at hundreds of users rather than thousands, and Kd's proposed
      2/day → 3/day move brought it 33% closer with nothing recorded.
      **The options, cheapest first, and the first two are free:** cache and
      reuse candidates for the same start point and distance · **drop the
      default `count` from 3 to 1** and generate more only on "show me another"
      — each cuts the call rate ~3× · a paid ORS plan · self-host.
      **Not urgent today** (5 route_gen calls have ever been recorded) and it
      must not be discovered by a gym's members losing the feature at once.
- [ ] 🟡 **GYM PLAN/TRIAL ACTIVATION SITS BEHIND KD'S APPROVAL — ruled
      2026-08-19 (DECISIONS :11072), binds the BILLING card.** The hazard pair
      this answers was raised by Kd the same day (:11023, tracked nowhere
      before): friends pooling a cheap gym tier undercut the $5 consumer
      price, and card-less gym trials (P3.6) invite a fresh-gym-per-month free
      ride — the resolver already honours `trialing`. **THE RULING: no
      self-serve path mints a live gym subscription or trial; activation
      requires Kd approving the gym (real business name and address).** One
      gate closes both holes — the pool needs a plan that is never approved,
      the chain needs a trial that never activates. The part of the instinct
      that does NOT work stays settled at :10959 (an unpaid gym grants its
      members nothing). **The approval gate is an addition with no governing §
      — the billing card's plan presents it as such (R0.2).**
- [ ] ⚪ **`GET /v1/orgs/:gymId/codes` IS CAPPED AT 100 AND HAS NO CURSOR**
      (T3 round 1 L-1, 2026-08-18). Added as a BOUND, not as pagination — it was
      the only list in the orgs module without one while `/mine` is capped and
      the roster is keyset-paged. Unreachable today, since a gym has exactly one
      code and it is minted with the gym; **`POST /codes` is already owed and a
      gym running one code per class could pass 100.** Whoever builds that owes
      the cursor, and the roster reader next door is the worked pattern.
- [ ] 🟡 **THE `manager` ROLE IS ENFORCED BY CODE NO TEST HAS EVER RUN AS A
      MANAGER** (T3 round 1, reviewer's Done-gate note, 2026-08-18).
      Grep-verified: `manager` appears in ZERO api tests. Part 3 §8's slice-A
      gate asks that every §2.2 permission be enforced by an API test rather
      than by hidden UI, and owner and trainer both have one — manager has
      none, on the shared `requireStaff` path both of the others exercise.
      **No route creates a manager row**, so the fixture cannot be built without
      the staff routes, which is why this rides the §2.2-matrix line above — but
      the TEST gap itself had no line anywhere and now has one, so the card that
      builds staff management cannot close without noticing it.
- [ ] 🟡 **PER-STAFF PRIVILEGE TICKS ON TOP OF THE THREE ROLES — Kd ruling
      2026-08-19 (DECISIONS :11429), an ADDITION to §2.2's fixed matrix.** His
      words: *"Owner · Manager · Trainer staff , and the privileges ticked per
      staff member also needed"*. The role picks the STARTING ticks; **the ticks
      are what the server enforces.** Roles and their CHECK constraint are
      untouched.
      **THE SEAM IS CHEAP NOW AND EXPENSIVE LATER, measured: ONE function and
      TWO call sites** — `orgs/service.ts:219 requireStaff(..., allowedRoles[])`
      at `:244` and `:296`. **Any new route that checks a role NAME re-opens
      this**; the check to write is "holds privilege X".
      **Catalogue** = §2.2's rows (with **privacy as its own tick** — a manager
      gets settings but not privacy) + **confirm a join application**
      (:11072/:11385) + **roster import** (:9809/:9870).
      **RULE THAT CLOSES A HOLE THIS RULING OPENS: the last owner cannot be
      ticked out of billing or staff management.** §4.7 blocks last-owner
      REMOVAL and says nothing about ticks, which achieve the same lockout by
      another door — without this a gym locks itself out and only we can let it
      back in. Also binding: only an OWNER changes ticks · ticks may widen as
      well as narrow · **UI hides, the SERVER enforces** (a greyed control over
      a live route is the defect, R3.3) · every change audit-logged ·
      **a tick is not a SCOPE** — trainer *assigned/group only* is the group
      axis and is still blocked on the missing group column (line above);
      conflating them hands a trainer the whole roster.
      **Needs a MIGRATION** (`gym_staff` stores no privileges) and the plan must
      flag it (R0.2). **K4 calls to ratify, not re-derive:** store the EFFECTIVE
      set as a snapshot rather than a diff against the role template (a template
      edit must never silently widen ten people's access; the cost is that
      default changes do not retro-apply), and decide table-vs-JSONB against
      R4.2 at the card. ~~**A fourth FRONT-DESK role was recommended against and
      not taken** — it guards a till we do not have, and ticks make it
      unnecessary; revisit only if attendance and product sales make a standard
      receptionist bundle worth naming.~~
      **KD AMENDED THIS 2026-08-22 AT THE STAFF SCREEN'S SMOKE (DECISIONS
      :14745): CUSTOM ROLE NAMES *AND* THE TICKS — *"now want custom role names
      instead of ticks. want both"*.** The struck sentence above is his own
      rejection of a fourth role, overruled by him in the additive direction.
      **IT IS ONE FEATURE AND A LABEL, NOT TWO, and the build order follows from
      that: no route in the product checks a role NAME** (:11891 converted the
      seam; :14262's four staff routes enforce the `staff.manage` TICK), **so a
      custom role is a NAMED PRESET OF TICKS** — ticks are the substance,
      `owner|manager|trainer` become three presets rather than three special
      cases, and a card that builds names before ticks has to invent an
      enforcement model that already exists. **Second migration cost, measured:**
      `gym_staff.role` is `text` NOT NULL under
      `check("gym_staff_role_check", role IN ('owner','manager','trainer'))`
      (`db/schema/tenancy.ts:213,218`), so custom names cannot live in that
      column as it stands. §2.2 is a FIXED three-role matrix, so this is an
      ADDITION with no governing § (:9809's class) and must be presented as one.
      **All six safety rules above still bind** — and rule 2 (the last owner
      cannot be ticked out of billing or staff management) matters MORE now, a
      custom role being a new way to hand somebody an incomplete set.
      **UPDATE 2026-08-22 (DECISIONS :15381) — THE TICKS HALF IS BUILT ON THE
      SERVER. THIS LINE DOES NOT TICK: the SCREEN and the NAMES are both
      unbuilt.** Kd approved a three-step split — ticks · the Staff screen's tick
      boxes · custom role names — and step 1 shipped: storage (migration `0013`),
      the owner-only route, the seam reading the stored set, the last-owner
      guard, audit rows both ends, and a role change resetting the ticks.
      **KD SETTLED THE SNAPSHOT-vs-NAMED-ROLE QUESTION the same day and the
      NAMES card inherits the consequence:** editing what a named role may do
      changes **nobody** on its own — the owner is offered *"Change everyone on
      Front Desk too?"* and taps it. **That button is the names card's to build**
      (a batch write over one gym's staff rows, no further migration), and it is
      recorded here because the ruling that produced it lives on a line that has
      now ticked.
- [x] 🟡 **DONE 2026-08-22 — THE ROSTER DOES NOT SAY WHICH MEMBERS ARE FREE — a staff member takes
      no seat and looks exactly like somebody who pays for one (Kd's finding at
      the staff re-smoke, 2026-08-22, DECISIONS :14953).** His words: *"when a
      member is added as a staff there badge should also show complimentary and
      like owner should not occupy gyms member space"*.
      **THE SECOND HALF IS ALREADY TRUE AND WAS VERIFIED, NOT ASSUMED**: `claimSeat`
      counts live members `AND m.complimentary = false AND NOT EXISTS (SELECT 1
      FROM gym_staff …)`, so staff have consumed no seat since :14401's C/H-1.
      **The first half is the gap**: `Members.jsx` draws its "Complimentary" badge
      off `gym_members.complimentary`, which is deliberately NOT written for staff,
      so the screen and the door disagree about who costs money and an owner
      cannot see which seats are free.
      **THE FIX MUST NOT BE TO WRITE `complimentary` FOR STAFF — that is exactly
      the defect :14401 C/H-1 removed** (the column means "did not JOIN", and
      three readers act on it: `joinedCount`, the join door's `max_uses` gate, and
      `orgCodeSchema.joined`). The roster response needs a SEPARATE derived field
      meaning "this person takes no seat", computed the same way the door computes
      it, and **anchored by a test that drives both** so the screen and the cap
      cannot drift (:14013's six-site precedent).
      **It widens `/v1/orgs/:gymId/members`, whose key set is asserted EXACTLY by
      a §2.4 test on purpose** (:10010), so the addition is argued at the card, not
      waved through — and a staff flag on a roster row is a §2.4 question in its
      own right, since it tells the gym something about a person.
      Server half plus web half; not built at the staff card (R1.1, and the packet
      was mid-review-round).
      **BUILT 2026-08-22 (DECISIONS :15093) — THIS LINE DOES NOT TICK YET.** The
      roster carries a derived `takesSeat` computed by `claimSeat`'s own count
      rule, anchored by a test driving the badge and the cap together, and the
      badge is drawn for anybody whose place is free. `complimentary` was NOT
      written for staff.
      **SMOKE PASSED 2026-08-22, "all passed", on his own gym against live data
      (DECISIONS :15187)** — including the control that an ordinary member is NOT
      badged, and that the join-code count does not move on a promotion. He ran a
      **7-step compressed version typed in chat**, not the 8-step sheet; sheet
      step 2 was swallowed by the compression and is named as unrun rather than
      counted (T3 L-4).
      **T3 ROUND 1 RAN: ZERO Critical/High — THE PACKET SHIPS (DECISIONS :15259).**
      Six Low, all fixed in the round. **This line ticks on the commit.**
- [ ] 🟡 **`gym_staff.privileges` IS NULLABLE AND SHOULD NOT STAY THAT WAY — the
      CONTRACT half of expand-then-contract (deferred 2026-08-22, DECISIONS
      :15381).** Migration `0013` adds the column nullable and backfills every
      existing row, and both writers fill it in, so **no row is NULL today**
      (measured: the backfill's own `WHERE` found 2 rows on the dev database, and
      a fresh database creates none). The nullability exists for ONE window: the
      minutes between the migration landing and the new code deploying, where
      OLD code still inserts staff rows without the column — a NOT NULL there
      would break CREATING A GYM, not merely appointing somebody.
      **Why it matters that this closes:** while the null branch exists,
      `privilegesFor` falls back to the ROLE's template, so a later edit to
      `ROLE_PRIVILEGES` would reach any row that slipped through — **the silent
      widening Kd ruled against on 2026-08-22**, bounded to a deploy window
      rather than shut. Closing it is one migration (`SET NOT NULL` after a
      re-run of the same idempotent backfill) plus deleting the fallback branch
      and its test. **Do it AFTER the deploy that carries this code, never in the
      same one** — that ordering is the whole point of the rule.
- [ ] 🟡 **THE LAST-OWNER LOCKOUT GUARD COVERS ONE PRIVILEGE AND :11429 NAMES TWO
      — BILLING IS MISSING BECAUSE IT DOES NOT EXIST YET (deferred 2026-08-22,
      DECISIONS :15381).** Rule 2 says the last owner cannot be ticked out of
      **billing or staff management**; `LAST_OWNER_REQUIRED_PRIVILEGES` in
      `modules/orgs/service.ts` holds `staff.manage` alone, because there is no
      billing tick in `ORG_PRIVILEGES` and inventing one would be R0.2's
      forbidden shape (a tick nobody enforces).
      **The trap this line exists to stop:** the day a billing privilege is
      added, adding it to `ORG_PRIVILEGES` and the database CHECK is the obvious
      work and adding it to the lockout list is the part that gets forgotten —
      after which an owner can tick away their own billing access and no one
      inside the gym can restore it. It is a ONE-LINE change and it belongs in
      the SAME commit that creates the privilege. The guard is already written as
      a LIST for exactly this reason.
      **WIDENED 2026-08-22 by T3 round 1 (DECISIONS :15534): there are now TWO
      lists and billing belongs on BOTH.** `OWNER_ONLY_PRIVILEGES` is what stops
      an owner-only power being handed to a manager at all — the round's
      Critical/High — and `LAST_OWNER_REQUIRED_PRIVILEGES` is what stops the last
      owner losing it. §2.2 puts money and staff in the same owner-alone row, so
      a billing tick that lands on neither list is the escalation and the lockout
      at once.
- [ ] ⚪ **THREE MUTATION ANCHORS MATCH TWICE AND LAND RIGHT ONLY BY POSITION
      (O17, O29, O89 in `mutate-orgs.mjs`; found by the census T3 L-1 prompted,
      2026-08-22, DECISIONS :15259).** The pre-check now REFUSES an ambiguous
      anchor — the improvement :14493 named and never built — but these three
      pre-date it and sit in an explicit `AMBIGUOUS_ALLOWED` allow-list so the
      guard could be turned on at all. **Each still mutates its intended line,
      because `String.replace` takes the first occurrence and that happens to be
      the right one; what is missing is any PROOF that it does.** O29 and O89 are
      the `getStaffRole`/`listStaff` pair that deliberately hold identical SQL
      text (:14493 Low-2), so re-anchoring means finding a line unique to each
      function — the same job O88 took in that round. **The list may only ever
      shrink**; closing this empties it and deletes the allow-list.
- [ ] ⚪ **A TRAINER AND A MANAGER CAN NOW WORK OUT WHO HOLDS THE GYM'S KEYS, AND
      KD HAS NOT BEEN ASKED (T3 L-1 on the badge card, 2026-08-22, DECISIONS
      :15259).** The roster serves `complimentary` and `takesSeat` together, and
      `complimentary === false && takesSeat === false` means exactly "this person
      is staff here" — an exact inference, not a guess. Both roles hold
      `members.read`; only the owner holds `staff.manage`, which is what gates the
      staff LIST, so the two roles the server answers 403 can derive it from the
      roster instead. **Accepted at the card and recorded rather than reversed**:
      §2.4's never-see list is member health and personal data, none of which
      moves, and what a colleague learns is a role inside their own gym.
      **Do NOT close this by withholding `takesSeat` from trainers** — that hands
      them back the defect the card removed (a staff colleague drawn as occupying
      a paid place), i.e. trades a disclosure for something FALSE on screen, and
      :5807 outranks a tidier boundary. If Kd wants it hidden it is his ruling and
      needs its own card, with the trade named to him first.
- [x] 🟡 **DONE 2026-08-22 — KD RULED IT: NOTHING CHANGES ON ITS OWN, THE OWNER
      TAPS A BUTTON.** Asked in plain words at the per-staff ticks card with a
      recommendation, as this line required, and he chose the recommended
      answer: editing what a named role may do changes **nobody** by itself;
      the owner is offered *"Change everyone on Front Desk too?"* and decides.
      **So :11429's SNAPSHOT stands and the propagation is an explicit ACT** —
      the third option this line named, and the only one that is neither a
      silent widening nor a rename that visibly does nothing.
      **WHAT THE RULING NOW OWES, and it is tracked on the ticks line above
      rather than here:** the button itself, which belongs to the custom-role-
      names card (there are no named roles to edit until it lands). The storage
      built on 2026-08-22 makes it a batch write over one gym's staff rows and
      needs no further migration. Ruling recorded at DECISIONS :15381.
      **The question as originally raised follows, kept whole rather than
      rewritten — the reasoning is what makes the ruling legible later.**
      **A NAMED ROLE AND A SNAPSHOT CONTRADICT EACH OTHER, AND KD HAS NOT BEEN
      ASKED (raised 2026-08-22 by his own "want both" amendment, DECISIONS
      :14745).** :11429 ruled the effective privilege set is stored as a
      **SNAPSHOT**, so editing a template never silently widens ten people's
      access. **A NAMED role invites the opposite expectation**: an owner who
      edits "Front Desk" will expect everybody on Front Desk to change, and
      snapshot-plus-a-visible-name is a contradiction *a user can see* — they
      rename or re-tick a role, nothing moves, and nothing on screen explains
      why. **Neither answer is obviously right** (retro-apply is the intuitive
      one and is exactly what the snapshot rule exists to prevent; a third option
      is to apply forward and offer "update everyone on this role" explicitly).
      **The per-staff privilege card must PUT THIS TO KD rather than pick one**,
      and it cannot be settled by a chat (R0.2). Closes with that card.
- [ ] ⚪ **THE CONSOLE'S ANALYTICS EVENTS ARE NOT EMITTED.** Part 3 §4.0 names
      `org_created{type}`, `org_trial_started`, `org_logo_added`,
      `org_poster_downloaded` and the TTFMJ timer; `gym_code_redeemed` is
      already in the `analytics.ts` taxonomy and unused. **Consistent with the
      rest of the API — no module emits a single event today** (grep-verified),
      which is itself the thing to fix, one card, rather than one module
      quietly starting. TTFMJ is the metric Part 3 says predicts everything
      downstream, so this is worth more than it looks.
- [ ] 🟡 **THE OVERVIEW HAS NO NUMBERS: Part 3 §4.1's KPI tiles, the 8-week
      trend chart and the at-risk list are all UNBUILT (deferred with the console
      screen, 2026-08-18).** §4.1 specifies active members (30d) with a 7d
      sub-stat, workouts this week, adoption %, average form score, a
      bars-plus-line eight-week chart, and the top-5 at-risk list with a one-tap
      nudge. **§3.2 says every one of them reads `org_daily_stats`,
      `org_live_counters` or `org_member_stats` — and not one of those three
      exists**: no table, no Redis key, no view, no worker building them, no
      route serving them. A tile drawn over that would print a number nobody
      computed, which is :5807 on its face, so the screen shows what is true
      instead (the gym's identity, its live join code, its member count) and
      says nothing about activity. **Closed by the rollup card**, which owes the
      nightly worker keyed on `gyms.timezone` (§3.2) before any of these tiles
      can be honest. The at-risk nudge also needs push, which does not exist.
- [ ] 🟡 **THE §4.0 WIZARD IS ONE STEP OF SIX: size/plan/trial, logo upload,
      team invites and the QR poster PDF are all UNBUILT (deferred with the
      console screen, 2026-08-18).** Built: step 1 (name · city · org type ·
      country · timezone) and step 4's code reveal, which the server does in the
      same transaction. **Not built, each because it has no endpoint at all:**
      step 2's member-count slider → seat tier → 7-day trial (billing does not
      exist, and the tier sizes are unratified US pricing, :9944) · step 3's
      logo upload (no R2 bucket configured, and R3.9's five upload guarantees
      would have to be built) · step 5's invite-your-team (no staff route —
      see the §2.2 matrix line above) · step 4's QR poster PDF and WhatsApp
      share (a worker job with no worker). **§4.0's own metric, TTFMJ, is
      instrumented nowhere** — see the analytics line below.
- [ ] ⚪ **THE ORG'S `locale` IS NOT COLLECTED BY THE WIZARD (deferred with the
      console screen, 2026-08-18).** Part 3 §4.0 step 1 lists it; the create
      schema accepts it and defaults it to `"en"`. It is omitted from the form
      because **nothing reads the column**: §2.2's vocabulary overrides and the
      bilingual poster are the two consumers and neither is built, and the
      market is now US gyms (:9604 §2), so a picker offering en/hi/as today
      would be a control with no effect. **Closed by whichever card first makes
      the org's language change something a user sees.**
- [ ] 🟡 **~~FOUR~~ THREE OF THE CONSOLE'S SIX SECTIONS HAVE NO SCREEN:
      Leaderboard, Reports, Billing ~~, Settings (+ Staff)~~ (deferred with the
      console screen, 2026-08-18).** §3.1's nav lists six; the shell renders the
      ones that exist and the rest are ABSENT rather than greyed out — a disabled
      tab that answers nothing is still a promise on screen. Their server sides
      are owed elsewhere: leaderboards at P4.x, `org_daily_stats` for reports (the
      line above), billing at P3.
      **✅ SETTINGS IS DONE — ALL THREE GATES BEHIND IT (2026-08-22).** Built at
      :14570; **SMOKE complete** — 12/12 plus steps 9 and 11 re-run on the shipping
      bytes after the removal control was rewritten (:14953); **T3 round 1 found
      two Critical/High, both fixed (:14840), and round 2 (diff-only) found ZERO
      Critical/High, which is the severity gate's own shipping condition**
      (:15007). Commits `971836d` · `ba7bd13` · `2e5500e` · `a5ef49c` and the
      round-2 fixes. **THIS TICKS THE SETTINGS/STAFF CLAUSE OF THIS LINE AND
      NOTHING ELSE** — Leaderboard, Reports and Billing keep the line open, and
      the §2.2-matrix line below is UNTOUCHED by this (RESTORE a member, CSV
      export and nudges are still routeless, and staff management ships only its
      ROLE half).
      **SETTINGS SHIPPED 2026-08-22 (DECISIONS :14570) AND CARRIES §4.7's STAFF
      LIST — but it is drawn for the OWNER ONLY**, because the one thing on it is
      §2.2's owner-only row and the server gates even the READ with it, so for a
      manager or a trainer the tab would open onto a refusal. The condition is
      `canManageStaff`, so the tab widens by itself the day Settings grows a
      section a manager can use — a different question rather than a forgotten
      one. **§4.7 lists FIVE things under Settings and this ships ONE**: Profile,
      Notifications and Privacy have no server side at all (Profile's gap has its
      own new line below); Codes are deliberately NOT moved here — Kd's join-code
      card put them on Overview under the code an owner hands out, and moving them
      would be a removal from the screen a ruling put them on, so Settings points
      at them instead.
      **§4.2's banner slot is unbuilt for the same reason** — every one of its
      states (trial, trial-urgent, grace, past-due, seat pressure) is read off
      `subscriptions`, so today the banner would have nothing to say and no way
      to know it.
- [ ] 🟡 **A GYM CANNOT CHANGE ITS OWN NAME, CITY, TIMEZONE OR CURRENCY AFTER IT
      IS CREATED — everything the wizard asks is written once and can never be
      corrected (raised 2026-08-18 at DECISIONS :10606, tracked NOWHERE until
      2026-08-22; grep-verified across `OWED.md` before adding).** Measured, not
      recalled: the orgs module exposes nineteen routes and **not one of them is a
      `PATCH /v1/orgs/:gymId`** — a gym's own row is insert-only after
      `createOrgAttempt`. :10596's C/H-1 named the currency half of this while
      fixing the wizard's preselected United States, in prose, and prose is how
      work gets silently lost — which is what the deferral rule exists to stop.
      **The cost is not cosmetic.** `gyms.timezone` is what the rollup worker uses
      to decide when a gym's day ends (trap #8), so a gym set up in the wrong zone
      has its day boundaries wrong for ever; `currency_display` is what a gym is
      billed in and Kd ruled it follows the gym's LOCATION (:10099), which a gym
      that moves cannot act on; and a typo in the name is on every screen the
      owner shows a member. **The slug is deliberately NOT part of this** — it is
      minted once against `RESERVED_SLUGS` and a gym named "New" already collides
      with the console's own create form (:10596 L-2), so renaming the address is
      a separate and harder question. **Settings is the screen this belongs on and
      it now exists** (2026-08-22, DECISIONS :14570) — the screen is no longer the
      blocker, the route is.
- [ ] 🟡 **THE CONSOLE IS BUILT ONCE — responsive, opened from inside the phone
      app.** Kd demanded phone management (*"main idea is convenience"*); Part 3
      §3.1 already chose responsive web for the same reason (*"owners live on
      phones; no native console app"*). Mechanism called under K4 and not
      overruled (:9604 §4). **A later chat wanting native console screens is
      proposing to build the console TWICE and owes that cost explicitly.**
      **UPDATE 2026-08-18: the first three screens are built this way** — one
      responsive shell, left rail at `md`+ and bottom tabs below, `ConsoleLayout`
      rather than `AppLayout` (which pins a 256px left margin with no breakpoint
      anywhere in it, so on a phone its content starts off the left edge). The
      line stays open because it governs every console screen still to come.
- [ ] 🟡 **STRIPE CONNECT — GYMS COLLECT THEIR OWN MEMBER FEES, GYM AS MERCHANT.**
      Kd's diagram: `Payment interface → Stripe Connect → Gym's Stripe account →
      Gym bank`, and *"as for money gym customer and user its between them"*
      (:9604 §3). **A BUSINESS-MODEL ADDITION, NOT A FEATURE** — the spec has one
      money direction only (members and gyms pay us); `grep -ci` for
      `connect|payout|marketplace|on behalf|platform fee|split` over
      `05-part5-billing.md` returns **ZERO**.
      **RULED:** the gym is the merchant; disputes, refunds and the member payment
      relationship are theirs. **NOT RULED, and must not be guessed:** which
      Connect account type actually delivers that (they differ materially in who
      carries liability), onboarding and identity-check flow, what a gym sees
      before verification completes, how a half-onboarded gym behaves.
      **UNVERIFIED (V5): every Stripe Connect specific stated in that session came
      from model memory, not a source read. Pull current Stripe documentation at
      planning time and build against nothing asserted there.**
      **The India regulatory objection raised against this is WITHDRAWN** — it was
      anchored on RBI rules that do not apply to a US platform onboarding US gyms.
      Do not resurrect it.
- [ ] 🟡 **GYM SETS ITS OWN PRICING, OFFERS AND FREE PROMOTIONS.** Zero spec hits.
      Rides along with the Connect work — same build, same card family.
- [ ] 🟡 **ATTENDANCE / QR CHECK-IN.** Kd: a QR printed and stuck on the door;
      registered members scan it to mark attendance. **Zero spec hits for
      `attendance` or `check-in`** — but the mechanism is half-designed already:
      Part 6 §2 has QR posters and an `aihg://org/join?code=` deep link for
      JOINING. Attendance is the same scan with a different action.
- [ ] 🟡 **CLASSES, SCHEDULES AND COACH INSTRUCTION SLOTS (booking).** Zero spec
      hits for `booking`, `schedule` or `check-in`. **The largest single new piece
      on this list**, and the thing gyms actually pay competitors for.
- [x] 🟡 **SEPARATE GYM LOGIN AND USER LOGIN on the entry screen. — DONE
      2026-08-19, commits `80ee871` (the crossing) on top of `a18a15b` (the
      doors), gates closed at DECISIONS :11757.** Full gate met and not waived:
      smoke **11/11** in Kd's browser (:11706) AND a T3 round finding **ZERO
      Critical/High** (:5348 rule 1), its eight Low all fixed and logged in
      `BACKLOG.md`. What ships: two doors on the login page, one `landingRoute`
      consulted by all four places that decide where a person lands, the choice
      remembered for the tab and cleared on sign-out, the gym door skipping the
      questionnaire (:10959), and — :11616 — **the doors as the ONLY way across
      in either direction**, with a Sign out on the console and the wizard so the
      removals strand nobody. **The real-handset check is NOT part of this tick**
      and has its own line below. Small — Part 3
      already puts the console in its own route group (`/console/:orgSlug/...`).
      **RULED BY KD 2026-08-18, raised by him mid-smoke: *"why the hell there is
      my gym … why would a gym owner enter a users profile to create their gym …
      there should be like this in the register or login page you either logged
      in as user or a gym administrator"*.** He answered **yes** to the shape put
      to him: **two DOORS, ONE ACCOUNT** — the login page offers "I'm a member"
      or "I run a gym", the email and password are the SAME either way, and the
      choice decides only which screen you land on.
      **THE FACT THAT DECIDED IT, and it must not be lost by a later chat: the
      same person is deliberately BOTH.** Part 3 §4.0 step 6 makes the owner
      member #1 of their own gym, complimentary and not seat-counted, precisely
      so they can demo the app on their own phone. **Separate ACCOUNTS would mean
      a gym owner cannot use their own app without logging out** — which is the
      opposite of the convenience ruling at :9604 §4.
      **What this replaces:** the **My Gym** sidebar entry added with the console
      screens, which was a TEMPORARY door built so the screen was reachable at
      all and should have been labelled temporary when it shipped. Whether it
      SURVIVES beside the new door is part of that card, not decided here — an
      owner already inside the member app still needs a way across.
      **UPDATE 2026-08-19 — BUILT (DECISIONS :10866), then AMENDED BY KD the
      same day mid-smoke (:10959): the gym door skips the fitness questionnaire
      entirely — a gym owner lands straight on the console and meets the wizard
      only when crossing into the member app ("Back to the app"), where every
      member screen still requires it. THIS LINE DOES NOT TICK: the smoke
      restarts on the amended bytes and the T3 is UNRUN** (:4718 F4 — a line
      ticked in the same commit whose message said otherwise had to be
      reverted). What now exists: two doors on the login page, one
      `landingRoute` consulted by all FOUR places that decide where a person
      lands, the choice remembered for the tab and cleared on sign-out, console
      routes opted out of the onboarding requirement, and
      `RUNBOOK/smoke-login-door.md` (rewritten for the amendment).
      ~~**THE `My Gym` SIDEBAR ENTRY STAYS — the open question above is CLOSED and
      the answer is "it survives"**: an owner already inside the app still needs
      a way across without signing out, and the no-removal rule keeps it absent a
      ruling to drop it. It is no longer a temporary door; the door it stood in
      for now exists.~~
      **STRUCK 2026-08-19 THE SAME DAY — KD RULED THE OPPOSITE (DECISIONS
      :11616): `My Gym` is REMOVED, and the console's "Back to the app" with it.
      The two doors are the ONLY way across, in both directions.** His words:
      *"no back to the app in gym dashboard sign out instead"* and *"why my gym
      in the user side profile if they want to create gym they will sing in as
      gym"*. The no-removal rule's AUTHORISED path — an explicit ruling against a
      cited cost; the recommendation put to him was the OPPOSITE (keep the
      cross-link, add a sign-out) and he reaffirmed. **The cost he was given
      first, and it changed the fix: `ConsoleLayout` had NO sign-out at all, so
      removing the cross-link alone would have locked an owner inside the
      console.** **Sign out** now replaces it on BOTH the desktop rail and the
      phone bar.
      **AND THE SCREEN NOBODY WAS LOOKING FOR: the onboarding questionnaire had
      no sign-out either** — no sidebar, no skip (removed at Card 6), so anyone
      who signed up or picked the wrong door was stuck on a five-step form with
      no exit but finishing it. **Kd hit it on his FIRST step of this very
      smoke**, which is how it was found at all. Fixed in the same packet; it is
      NOT a skip (the onboarding gate is untouched, pinned by a test).
      **UPDATE — THE REWRITTEN SMOKE PASSED 11/11 on `9aae571` (DECISIONS
      :11706), Kd's own browser.** Both removed shortcuts confirmed gone, both
      new Sign outs confirmed to really end the session (browser BACK button),
      Google still landing in the console. **THIS LINE STILL DOES NOT TICK — the
      T3 on this diff is UNRUN** (:4718 F4: a line ticked in the same commit
      whose message said otherwise had to be reverted, on this branch). The
      packet needs a review round finding ZERO Critical/High (:5348 rule 1).
      **THE FOURTH LANDING SITE IS WHAT THIS CARD ALMOST MISSED, and it is worth
      carrying:** `Onboarding.jsx` ended `navigate('/dashboard')`, hard-coded,
      and every brand-new account is sent through that wizard — so a NEW gym
      owner would have finished five setup screens in the member app and never
      found their console. The door would have worked for everybody except the
      account it was built for.
- [ ] 🟡 **THE CONSOLE HAS NEVER BEEN OPENED ON A REAL PHONE — every "phone"
      check so far has been a NARROWED DESKTOP WINDOW.** Raised by the T3 on the
      crossing packet (L7, 2026-08-19) against the deferral rule itself: the fact
      was stated plainly in DECISIONS prose (:11706 — *"the phone was a NARROWED
      DESKTOP WINDOW, not a phone"*) and tracked NOWHERE, which is the exact
      shape CLAUDE.md names as how work gets silently lost.
      **Why it matters and is not pedantry:** :9604 §4 is Kd's ruling that the
      console is REACHED FROM THE PHONE, and `ConsoleLayout` exists as its own
      shell precisely because `AppLayout` pins `marginLeft: 256` with no
      breakpoint (:10402). A desktop window dragged narrow proves the CSS
      breakpoint fires; it does not exercise a real viewport, touch targets, the
      on-screen keyboard over the create-gym form, or Safari/Chrome mobile.
      **What is already covered, so this is narrower than it sounds:** the
      breakpoint swap and the phone bar's Sign out are pinned by tests and by
      mutant D14, and the console smoke passed 11/11 at both widths on a desktop.
      **What is owed is one sitting on an actual handset**, against the existing
      `RUNBOOK/smoke-login-door.md` steps 5–6 plus the console sheet.
      **Not a blocker for the crossing packet** — it is a pre-existing gap the
      packet made visible rather than one it created.

- [ ] 🟡 **MEMBER MIGRATION FROM A COMPETITOR APP — Kd ruling 2026-08-18
      (DECISIONS :9809): a SYSTEM, built now, not a favour to the first
      customer.** The spec has member EXPORT only (`03-part3-org-console.md:105`,
      `:212`) and its only inbound path is self-join by code — this is an
      addition with no governing §. Three parts, in the Stage-1 card family by
      construction (it writes the gym/roster tables):
      **(a) roster rows WITHOUT a user account** — an "imported, not yet joined"
      member state, so a 1000-member gym sees its whole roster on day one;
      **(b) ONE upload screen with column mapping** — the owner points at their
      own spreadsheet's columns, preview shows duplicates/missing/unparseable
      BEFORE anything saves; mapping-at-upload is what makes one system fit
      every competitor with no format known in advance;
      **(c) ATTACH-ON-JOIN — the load-bearing part:** a member who installs and
      enters the gym code matches by exact phone/email to their EXISTING row.
      Without it import+join makes two records per person and the owner's count
      is wrong forever. **A match rule looser than exact needs a Kd ruling — a
      wrong attach hands one person's history to another (ownership,
      Critical/High by :5807).**
      **DESIGN SETTLED SAME DAY (DECISIONS :9870) — the card builds THIS:**
      auto-attach on verified email only, exactly one candidate row (phone is
      not an auto key — no verified phone exists); everyone else joins
      immediately and lands in a front-desk "who is this?" confirm queue; names
      never auto-match; a member never self-claims a row. **Kd's amendments:
      CSV AND XLSX (reader lib = R1.4 new-dep approval); the preview is the
      owner's correction surface (nothing saves until CONFIRM; fix in place,
      re-map, skip, or cancel-and-reupload; rows editable forever after;
      re-upload updates, never duplicates); works on phone and laptop via the
      one responsive console, preview built PHONE-FIRST.**
      **FORMATS RULED 2026-08-19 (DECISIONS :11309): `.csv`, `.xlsx` and legacy
      `.xls` — nothing else**, and an unsupported file gets a refusal NAMING the
      two rather than a silent failure. Kd: *"gym submits csv xl or other most
      used files fprmat and the backedn handles the things onward"*. The reader
      library must cover the legacy `.xls` case, and is still an R1.4 approval.
      **The pipeline is now a stated commitment:** gate by looking INSIDE the
      file never at its extension (R3.9/R2.3) → parse both formats into one row
      shape → infer columns → preview saving NOTHING → CONFIRM is the ONLY human
      step → write rows (name-only required, whole original line kept) →
      in-file dedupe and re-upload-updates → attach-on-join.
      **THE SENTENCE THAT CHANGES HOW THIS IS PITCHED: the human step is
      per-COLUMN, not per-ROW** — ~8 decisions whether the file holds 50 rows or
      5,000, with row-level attention spent only on rows the machine flags. It
      is the answer to Kd's *"3000 5000 members ... manully check all those
      numbers that a lot of work"*, and it needs to be true in the BUILD: a
      preview that asks the owner to scroll 5,000 rows has failed this line.
      **AND THE PART NO CODE DELIVERS: for a big gym, WE run the migration.**
      Verified by web search 2026-08-19 — GymMaster staffs a data-transfer team
      (*"particularly helpful"* above 150+ memberships), Gym Insight sells the
      same service, and even incumbents exclude financial history and bookings.
      **Kd already approves every gym by hand (:11072), so "email me your export"
      rides a call he is making anyway.** Operating answer only — **the app must
      promise no done-for-you migration.**
- [ ] ⚪ **PDF ROSTER IMPORT — NOT BUILT, and the condition to revisit is
      written down.** Kd 2026-08-19: *"ok pdf not needed"* (DECISIONS :11309),
      after being given the reasoning: nearly every gym PDF was printed BY
      software that also exports a spreadsheet, so the fix is one export click
      in THEIR system during onboarding; a scanned paper register needs text
      recognition whose misreads write wrong facts about other people (:5807's
      class, where the person harmed cannot see the error to correct it); and
      demand is unproven. **NOT struck — the trigger is a real PDF-only gym.**
      If one appears it re-enters BEHIND the same preview screen and changes
      nothing else in the design. Recorded so the ruling is not mistaken for
      "nobody thought of it".
- [ ] ❓ **MIGRATION SEAT POLICY — RESERVED FOR KD, blocks the import card's
      plan gate:** do 1000 imported-but-not-yet-joined members consume 1000 paid
      seats? Pricing policy; decides what an owner is told at upload time.
- [ ] ❓ **MIGRATION CONSENT — RESERVED FOR KD:** an owner uploads 1000 people's
      names and phone numbers before any of them has agreed to anything. Sits
      inside the open privacy-law question (:592), already on the critical path
      to a signed gym per :9604 §2.

- [ ] ⚪ **CLINICS ARE OUT OF THE PRODUCT — Kd ruling 2026-08-18 (DECISIONS
      :10248; the parent card is :10010). What PARKS with them, so nobody
      builds it and nobody ticks it.** His words: *"no click will be there only gyms and fitness
      centers"*, ruled when he was asked whether a clinic owner should be
      auto-enrolled in their own clinic and stamped with a consent record
      nobody collected. **This is the no-removal rule's AUTHORISED path** — an
      explicit ruling against a cited option — and it is recorded here because
      a ruling that deletes work still has to say WHICH work.
      **NARROWED AT THE DOOR, NOT DELETED:** `createOrgTypeSchema` accepts
      `gym|studio`; the §3.2 CHECK, the `clinic` value and the join-path
      consent gate are all untouched, so an existing row still reads and is
      still protected (pinned by a test that inserts one directly). No
      migration. Reopening is one value.
      **PARKED, NOT DONE:** Part 3 §2.3's clinic feature matrix (leaderboard
      off by default, "Inactive clients", caseloads), §2.2's clinic vocabulary
      overrides and the clinic copy LINTER that makes "rehab"/"treatment"/
      "therapy"/"diagnosis" build failures, and Part 2B §7's clinic
      positioning. **`studio` STAYS** — a boutique or PT studio is a fitness
      business, not a medical one; that call was stated to Kd in one line and
      not overruled, and it is why the trainer-scoping hold-back still has a
      live org type to apply to.
- [ ] ⚪ **`GET /v1/orgs/mine` IS CAPPED AT 100 AND HAS NO CURSOR** (T3 round 1
      L-4). A person belongs to one or two gyms and a multi-site owner to a
      dozen, so the cap exists to give the response a ceiling at all rather
      than because anyone is near it. Whoever first has a caller that could
      approach 100 owes the cursor — the roster reader next door is the
      worked pattern.
      **RAISED FROM ⚪ IN CONSEQUENCE, 2026-08-18: the console now DEPENDS on
      this list being complete.** `/console/:orgSlug` is resolved by matching
      the slug against `mine`, because the API is keyed by uuid and there is no
      by-slug route. So for anyone past the cap, a gym they really do staff
      reads back as "we couldn't find a gym you run at this address" — the
      truncation stops being a shape issue and becomes a door that will not
      open. Still nobody near it; still ⚪. **The fix is the cursor, or a
      `GET /v1/orgs/by-slug/:slug`, and whoever picks one owes this line.**

### Member-side gym surface

- [ ] 🟡 **GYM BRANDING ON THE MEMBER'S HOME — "Welcome to {gym}" plus their
      logo.** Nearly free: the gym logo is already part of console settings
      (9 spec hits in Part 3). High perceived value for the cost.
- [ ] 🟡 **GYM ANNOUNCEMENTS / UPDATES FEED TO MEMBERS.** Zero spec hits. Part 3
      §5.3's staff notifications are a different thing and must not be mistaken
      for it.
- [ ] 🟡 **MEMBER-TO-COACH / GYM-STAFF MESSAGING.** Zero spec hits.
      **Must not become a back door through Part 3 §2.4's visibility promise** —
      see the sharing line below.
- [ ] ⚪ **MEMBERSHIP CARD — plan, renewal date, gym contact.** Small, and it is
      the first thing members look for.
- [ ] ⚪ **CHECK-IN STREAK ("you have come 12 days this month").** Nearly free once
      QR attendance exists, and it is the strongest retention hook a gym has.
      Proposed by me and not contradicted; not a Kd ruling.
- [ ] 🟡 **THE MEMBER DASHBOARD IS THE NORMAL DASHBOARD PLUS A GYM HEADER — ONE
      SCREEN, NOT A MEMBERS' APP (Kd 2026-08-19, DECISIONS :11181).** He
      described it directly: same dashboard as a solo user, plus a welcome
      message with the gym's name, its logo if uploaded, the gym's updates,
      notifications, coach instructions, booking, products and messaging.
      **This is a CONSTRAINT, not a feature — it is recorded so nobody builds a
      second dashboard for gym members**, which is the expensive mistake
      available here. The pieces above are the pieces; this line is how they sit.
- [ ] 🟡 **CLASS AND SEAT BOOKING FOR MEMBERS — named by Kd twice and tracked
      NOWHERE until 2026-08-19** (grep-verified; :9604 §7 recorded it as an
      addition with ZERO spec hits, and no `OWED.md` line was ever written).
      Members *"book clasess"* / seats; the gym runs the schedule from the
      console. **Zero spec hits means every rule is invented at the card** —
      capacity, waitlists, cancellation windows and no-shows are each a decision
      nobody has made. Depends on nothing built today; it is a real subsystem,
      not a screen, and must not be sized as one.
- [ ] ⚪ **GYMS SELL THEIR PRODUCTS TO MEMBERS — named by Kd 2026-08-19, tracked
      nowhere before** (grep-verified). *"sell thier products"*. **This is money
      moving between a gym and its member, so it lands on the Stripe Connect
      path (:9604 §3) and cannot precede it** — a catalogue with no payment rail
      is a picture of a shop. ⚪ because nothing else waits on it.

### Plans, food and content

- [ ] 🟡 **PERSONALISED WORKOUT AND DIET PLANS FROM THE USER'S OWN INFORMATION.**
      Part 7 covers workout **programs** in depth (27 hits) so this is not
      greenfield; diet-plan generation is.
- [ ] 🟡 **A GYM COACH CAN AUTHOR A WORKOUT AND DIET PLAN FOR A NAMED MEMBER.**
      Zero spec hits. **Collides with Part 3 §2.4 unless routed through the
      member's own sharing consent** — a coach writing a diet will want to see
      what the member eats, and nutrition is on the never-see list. Kd's opt-in
      sharing ruling is the resolution; the implementation must actually use it
      rather than widening the boundary.
- [ ] 🟡 **THE USER CAN HAND-EDIT ANY PLAN THE APP GIVES THEM AND FOLLOW THEIRS.**
      Small, and it is what makes a generated plan tolerable when it is wrong.
- [ ] ⚪ **HEALTHY RECIPE SUGGESTIONS AND A GROCERY LIST FOR THEM.** `recipe`
      appears twice in Part 4 (a table only); `grocery`/`shopping list` return
      **zero** across the whole spec set.

### Photos and sharing

- [ ] 🟡 **IMAGE STORAGE DOES NOT EXIST AND MUST BE BUILT FROM SCRATCH.** Measured:
      `modules/nutrition/routes.ts:3` states photos are *"request-only"* — a meal
      image goes to the vision provider and is discarded — and `apps/api/src/
      config.ts` has no bucket or storage configuration at all. Kd wants meal,
      running and workout-completion pictures shared. R3.9 already specifies the
      five guarantees this needs: magic-byte content-type validation, size cap,
      server-generated keys, signed URLs, and no user-supplied filename ever
      reflected into a path or header. Add the DPDP/account-delete cascade.
- [ ] 🟡 **MEAL PHOTOS SELF-DELETE AFTER SEVEN DAYS — Kd ruling.** A timed sweep,
      not a manual cleanup. The repo already has TTL-sweep patterns to follow.
- [ ] 🟡 **GYM-GLOBAL SHARING NEEDS REPORT-AND-REMOVE.** Kd ruled sharing is the
      member's choice, scoped gym-global or private (:9604 §6). **The moment a
      picture is visible to other members, a way to report and remove one stops
      being optional** — people post pictures of their bodies. Not a Kd ruling;
      raised here because shipping the feed without it is the defect.
- [ ] 🟡 **PART 3 §2.4'S PROMISE STANDS AND EVERY NEW SURFACE MUST RESPECT IT.**
      Gyms still never see meal logs, body weight, coach conversations, run routes
      or anything outside the membership interval — **except what the member
      deliberately shares.** The boundary is enforced in the repo layer (those
      queries physically cannot join those tables for org callers), not in the UI,
      and it must stay that way as messaging, coach plans and photo feeds land.

### Dropped and parked

- [ ] ⚪ **~~COACH-UPLOADED INSTRUCTION VIDEOS.~~ DROPPED BY KD 2026-08-18** —
      *"ok will not upload video"*, after being offered it as part of the coach
      surface. Video storage and streaming leave the plan with it. Struck rather
      than deleted, per this file's rules, so the decision is visible.
- [ ] ⚪ **~~IMPORT A GYM'S DATA FROM A COMPETITOR MANAGEMENT APP — PARKED.~~
      SUPERSEDED IN PART by Kd's ruling 2026-08-18 (DECISIONS :9809):** *"i
      obvisoulsy can not wait untill someone joins i need to make the system"*.
      The UNIVERSAL spreadsheet import moved into the plan — its 🟡 lines live in
      the console section above. **What STAYS parked, and only this:**
      per-competitor one-click importers ("connect your Glofox account"-style),
      which genuinely are written against a real customer's real export file.
      Not ticked — rewritten.
- [ ] ⚪ **GYM PAYMENT FEATURES BEYOND THE CONNECT INTERFACE — PARKED** until a
      real gym asks for them.

## Open questions awaiting a Kd ruling (nothing built on these)

- [ ] ❓ **NEARBY GYMS AND PAID DAY PASSES — WANTED, NEVER SIZED OR SEQUENCED.**
      Kd 2026-08-18: a user with no gym, or away from their own, searches gyms
      near their location and *"tempriraily join the nearest gym by paying fees"*,
      with joined gyms able to offer the service. **Zero spec hits for `nearby` or
      `day pass`.** Recorded as WANTED, not APPROVED (DECISIONS :9604 §8).
      **Two things make this last in any sequence, not first:** it needs the
      Stripe Connect money path live, and it is **worthless until many gyms have
      already signed up** — a day-pass search across three gyms finds nothing.
      Nothing is blocked on the ruling today.
- [ ] ❓ **PAID FRIEND/FAMILY INVITES AND TRAINING TOGETHER — WANTED, NEVER
      SIZED.** Kd 2026-08-18: users invite friends and family *"(not free of cost
      obviously)"* and *"do exercise together"*. `together` returns 1 spec hit;
      effectively new. **The paid-invite half is ordinary work. The "together"
      half is not** — two people in one live session is a different class of
      problem from anything built so far, and it needs its own ruling on what
      "together" means (same room · same time remotely · same plan, compared
      afterwards). Each of those three is a different product.
- [ ] ❓ **NEARBY-RUNNER CONNECTION — AND A SAFETY QUESTION THAT CONSENT SETTINGS
      DO NOT ANSWER.** Kd 2026-08-18: runners connect with nearby runners, *"but
      user privacy will be very imoortant and if user does nit want there will be
      no sharing"*. **His privacy instinct is right and is not the whole
      problem.** Privacy is *"do not share my data"* and an opt-in switch answers
      it. Safety is *"do not help a stranger learn where someone runs alone, on a
      schedule, every week"* — and a user who opts in has answered the first
      question without being asked the second. Put to Kd on 2026-08-18 and not yet
      answered. **Nothing may be built here until it is** — this is the one item
      on the 2026-08-18 list where shipping the obvious implementation is worse
      than shipping nothing. Zero spec hits.
- [ ] ❓ **THE 5-DAY CONSUMER FREE TRIAL — KD'S PLAN WANTS ONE, THE SPEC FORBIDS
      ONE BY NAME, AND HE HAS NOT RULED (2026-08-19, DECISIONS :11181).**
      His plan: exercises free always, but personalised plans, recommendations,
      8 meal scans/day, progress tracking and badges free for FIVE DAYS only.
      **`05-part5-billing.md:292-293` says: "Consumer trials: none — permanent
      free tier is the funnel (v1 §9.1; unchanged, restated so nobody
      'helpfully' adds one later)"**, and v1 §9.1:626-629 gives the reason (a
      permanent free tier converts better than a time trial for an unknown solo
      app).
      **HE ASKED THE RIGHT QUESTION ABOUT HIS OWN IDEA:** what stops someone
      registering a second email for another five days? **The answer put to him:
      nothing cheap does — the attack exists only because the trial does.**
      Recommendation on record is to DROP the trial; if it stays, **only a CARD
      before the trial starts holds**, which costs real signups on a $3.99–$5
      product. Priced rather than argued: $0.00212/scan (:9944) ⇒ **$0.085** per
      farmed five days, against a farmer losing their history, streak and badges
      every time. **He moved to the next topic; nothing is built either way.**
      **RULED WITH IT, IF HE RULES FOR THE TRIAL: do badges and progress move
      behind it?** They are free forever today — `00-architecture-v1.md:611`
      (logging, streaks, badges ✅ unlimited on Free) and ungated in code (only
      coach, geo and nutrition consult entitlements) — **so moving them is a
      REMOVAL of a live free feature and needs an explicit ruling against the
      cited option, not a plan sentence.**
      **Blocks nothing today. Blocks the billing card and any seed change.**
- [ ] ❓ **WHERE THE FOLLOW-ALONG REFERENCE FOOTAGE COMES FROM — ANSWERED FOR
      HIM 2026-08-19 (DECISIONS :11534), STILL NOT CHOSEN.** Elaborates the
      clause the follow-along line above already carries ("still owed inside
      the card and Kd's to give"); it is repeated here because that line sits
      far from this section and the answer is now long enough to lose.
      **Three options, all live:** film a real person (cheapest per exercise,
      unambiguously correct form, no pipeline, no legal question — what the big
      fitness apps ship) · **motion-capture an expert clip onto a rigged 3D
      model** (his own proposal — free extraction tools, Mixamo rig, Blender
      retarget; **the Blender half is scriptable and headless, the clip and the
      judging are his**) · buy a ready-made exercise mocap pack (**UNVERIFIED
      whether one covers these 58**).
      **THE DISTINCTION HE DREW AND A LATER CHAT MUST NOT FLATTEN: AI video
      GENERATION invents motion and is a NO for demonstrations** (:5807 — a
      demo subtly wrong teaches wrong form, in the one area this app claims
      expertise), **but MOTION CAPTURE copies a real body, so that objection
      largely dissolves.** AI generation is a YES for MARKETING.
      **The argument for the 3D route: ONE capture renders the same rep from
      the FRONT and the SIDE at any resolution** — which also permanently fixes
      the shipped GIFs' measured size problem (600×600 at best, 220×119 for
      jump squat), needs no model release and never needs re-shooting.
      **RECOMMENDED: prove it on ONE exercise (squat — his clips already exist
      at `Desktop\traces`) before committing to 58.** Measured, not assumed:
      **Blender is not installed on the dev machine.**
      **THIS BLOCKS NOTHING.** :9452's rule stands: artwork is its own track and
      must not hold up the follow-along card — one placeholder proves the mode.
- [x] ❓ **ANSWERED BY KD 2026-08-18 — IT MEANS RUNNING THE BUSINESS
      (DECISIONS :9604).** He answered the third bullet of "THE RULING NEEDED"
      below by simply listing what the console must do: *"Gym management ├──
      Members ├── Attendance ├── Classes ├── Workouts └── Payment interface"*,
      with fees flowing `Stripe Connect → Gym's Stripe account → Gym bank`. That
      is **gym OPERATIONS**, the reading this entry itself called *"a different,
      much larger product with established competitors in every market"*.
      **THE ENTRY'S WARNING WAS CORRECT AND IS NOT WITHDRAWN — it was overruled
      with the cost stated.** Kd was shown, before ruling, that attendance,
      classes, coach messaging, gym-set pricing, coach-authored plans, grocery
      lists, day passes and the competitor importer return **ZERO hits across the
      entire spec set**, and that gym-collected payments are a business-model
      addition rather than a feature. He proceeded. The "integrate rather than
      build" third option was NOT taken.
      **CONSEQUENTLY the retention framing in §1 is no longer the whole product,
      and no chat may cite it to refuse operations work.** The new surface has its
      own section above (*Gym platform — Kd's 2026-08-18 product rulings*).
      **Kept, not deleted:** everything below is the analysis that sized the
      decision correctly, and it is the reference for what Part 3 already
      automates versus what is now owed.

      **THE ORIGINAL QUESTION, KEPT VERBATIM AS THE ANALYSIS (no longer an open
      item — it is answered above):**
      **DOES "GYM MANAGEMENT" MEAN RETENTION, OR RUNNING THE BUSINESS?**
      Raised by Kd 2026-08-16, in his words: *"is this gym management section
      really good will it allow owners to automate things? i want that so less
      work and more efficient for gym owners and easy way to manage their
      business"*. **Write the answer down before promising anything to a gym**,
      because the two readings sell differently and build differently.
      **WHAT PART 3 ACTUALLY SPECIFIES — verified by reading it, not assumed.**
      It automates real work, and the valuable part is what happens with the
      owner doing nothing: a monthly PDF report **generated and emailed** on the
      1st at 06:00 org time (§4.5) · a **weekly digest** Monday 09:00 org time
      with the at-risk count and a deep link (§5.3) · **at-risk members detected
      automatically** with one-tap Nudge (§4.3, §4.5) · **seat-pressure, trial
      D-5/D-1 and payment alerts** firing on their own (§5.3) · a **30-second
      walk-in join** by code/QR/WhatsApp/poster with no staff data entry (§4.3).
      Its design law is explicit and good: *"the console is a retention
      instrument the org uses on its members, not an analytics toy. Every screen
      ends in an action … data that doesn't lead to an action is decoration and
      gets cut"* (§1).
      **WHAT IT DOES NOT DO, AND THIS IS THE QUESTION.** Nothing in Part 3
      collects the gym's OWN membership fees, tracks attendance or door access,
      schedules classes, runs a point of sale, or handles staff pay. Those are
      gym-OPERATIONS software — a different, much larger product with
      established competitors in every market, and it would change what a sales
      conversation promises.
      **THE RULING NEEDED:** does v1's console stay a retention instrument
      (recommended — it is what the spec is built for, what the engine makes
      uniquely defensible, and what one person can ship), or does the roadmap
      commit to gym operations as a later phase? **A third answer exists and may
      be the best one: integrate rather than build** — let the gym keep whatever
      it already uses for fees and attendance, and be the thing that makes
      members actually train. Nothing is blocked on this today; it blocks the
      moment a pitch deck or a pricing page describes the console.
      **Related and already corrected: the market is WORLDWIDE, not Jorhat**
      (Kd, same day; Part 3 §6.3 *Worldwide* already localises currency, drives
      boundaries from each org's timezone, and makes every console string a
      message key). Jorhat is the pilot. Any argument that reasons from Indian
      market conditions alone is suspect — see the struck clause on the wearables
      line above for one that was.

- [ ] ❓ **Privacy-law scope beyond DPDP** (raised by Kd 2026-07-21). Should the
      product satisfy EU/UK GDPR, US state laws (CCPA/CPRA), Brazil's LGPD —
      not DPDP alone? The spec is partly with him: Part 4 §5.2:829 heads the
      flow "DPDP/GDPR", 2B:538 says "under India's DPDP Act 2023 and GDPR for EU
      users" — but it never enumerates the GDPR deltas and never mentions
      CCPA/LGPD. **Engineering assessment:** the worker's MECHANISM is common to
      all of them (hard-delete pass + JSON export); the deltas are mostly TIMERS
      (DPDP 14 days · GDPR "without undue delay", conventionally ≤30 · CCPA 45)
      and metadata, so building it now boxes nothing in PROVIDED the window is
      one named constant. **Not code, and Kd's alone:** lawful basis, consent
      records, privacy notice, breach notification, DPAs, an EU representative,
      and whether the product is even offered in those jurisdictions at launch.
      "India-only at launch, widen before an EU/US launch" is a legitimate
      answer that leaves the worker card unchanged.
- [ ] ❓ **Leaderboard sequencing** — see the 🔴 leaderboard line above. Kd must
      choose: land a minimal read before cutover, or accept a dark window.
- [ ] ❓ **`capture="environment"` trade-off** — keep as-is (A), drop `capture`
      so phones offer a Take-Photo/Library chooser (B), or two explicit buttons
      (C). Recommendation: A now, C later only if the owed phone smoke shows the
      gallery limitation actually bites.

---

## Done (kept, not deleted — the record of what closed and when)

- [x] argon2id rehash-on-login — merged 2026-07-15, PR #28.
- [x] Onboarding/fitness-profile storage — merged 2026-07-16, PR #30.
- [x] Vision model migration (Scout → qwen/qwen3.6-27b, prices re-quoted) —
      2026-07-16, during web Card 5a.
- [x] Dishware in-flow UI + portion API — Card 5c2, 2026-07-18.
- [x] Food synonym/alias matching — Card 5c, 2026-07-17 (residuals above).
- [x] Meal composition (add/remove ingredients) + change-label — Card 5c.
- [x] Previous-days meal view — Card 5d, 2026-07-19.
- [x] Settings profile forms → new API — Card 7, 2026-07-20.
- [x] Nutrition targets, API + web halves — PR #42 + commit aa362ce, 2026-07-21.
- [x] ~~Desktop webcam capture~~ — **WON'T BUILD**, Kd ruled 2026-07-19. Not a
      removal: no meal-photo webcam was ever built, Part 2B §3 mandates no
      capture mechanism, and nobody is blocked (the file picker already works on
      desktop). A laptop webcam is a worse input to 2B's portion problem and
      would burn paid vision calls on poor photos.
