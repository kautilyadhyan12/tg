# BACKLOG.md — the LOG of LOW-severity review findings

Created 2026-08-06 by Kd's ruling on the fixed review/fix process
(`DECISIONS.md:5348`, restated at `CLAUDE.md` Part I §2.5).

## What this file is — and what it is NOT

**It is a LOG.** A Low finding — spelling, comments, naming, style — is written
here with the round that found it and the commit that fixed it. Its purpose is
that a Low finding is **visibly accounted for without buying another review
round**. That is the whole of what rule 1 changed.

**LOW FINDINGS ARE STILL FIXED before the packet closes.** Kd ruled this
explicitly when correcting a draft that said otherwise: *"no, they will be
fixed."* Nothing is left undone because it was Low. This file records the fixing;
it does not excuse skipping it.

**IT IS NOT A SECOND DEFERRAL LIST.** `OWED.md` is unchanged and remains the
single authority for everything outstanding. If a Low finding genuinely cannot be
fixed in its round, it has stopped being a log entry and become a **deferral** —
so it takes an `OWED.md` line, in the same commit, like anything else.

**Nothing Critical/High ever appears here.** Security, data loss, privacy, money
and broken core flows are fixed, or they hold the packet. If you are unsure which
side a finding falls on, it is Critical/High.

## Format

```
- [x] <what was wrong, where> — found <date>, <card / round> — fixed <commit>
- [ ] <same, still open — and if it will not be fixed this round, it also needs
      an OWED.md line, so say which>
```

---

## Log

### Post-workout summary repoint (card 1 of the workout core loop), 2026-08-06

The first card run under the fixed review/fix process. Its own test audit
(rule 4) produced these; all three are Low, all three are FIXED, none bought a
review round.

- [x] **The mutation harness's final restore check asked GIT, which cannot answer
      it.** `git diff --name-only` compares the tree against HEAD, so on a branch
      with uncommitted work — i.e. every branch a sweep runs on — it reports the
      CARD'S OWN changes as harness damage. A clean 14/14 sweep ended
      `*** TARGETS STILL MODIFIED ***` and exit 1, naming four files whose
      mutated lines were each verified back to their originals. Failed toward a
      FALSE ALARM, which is the safe direction and the only reason this is Low
      rather than an incident — the shape is :5199's. Now compares each target
      against its pre-run byte snapshot; re-verified on a 2-mutant subset, exit 0.
      — found by the audit itself, fixed same commit
      (`tools/mutate-workout-summary.mjs`).
- [x] **The harness read a PASSING suite as RED.** `execFileSync` with the default
      1 MB `maxBuffer` threw ENOBUFS on the ~3-minute api DB suite, and a bare
      `catch { return "RED" }` turned that into a verdict. It surfaced on the
      baseline gate, where it merely aborted; one step later it would have scored
      every mutant "caught" while nothing was asserted. A runner error now ABORTS
      instead of resolving to a verdict. — fixed same commit.
### T3 round 2 — the Low findings (2026-08-07). ZERO Critical/High; the card closed.

Five Low, all fixed in the round. The first two are the ones that mattered: both
are INSTRUMENTS quietly ceasing to protect, which is the failure that does not
announce itself.

- [x] **The permanent guard hard-coded `GET`.** A workout-scoped route added later
      with a different verb — `POST /v1/workouts/:id/share` — would be swept in
      and fail for the WRONG REASON, reading as a broken test rather than a catch.
      Now captures the verb, and accepts any 2xx for the owner so a future 201 or
      204 does not fail spuriously.
- [x] **The sweep exited 0 while SKIPPING the checks that guard the Critical/High
      fix.** Without `DATABASE_URL` the six apiDb mutants — M19/M20 among them —
      were skipped, "6 skipped" was printed, and the run SUCCEEDED. Visible, so
      not a lie; but a green exit on a run that never exercised the C/H guard is
      the shape this repo has been burned by five times, and every one of those
      was also technically reported. **Exit codes are what CI and a tired human
      read.** Now non-zero unless `--allow-skipped` is passed.
- [x] **Round 1's over-claim was still standing one file away.** The "covers the
      route someone adds next year" sentence was corrected in DECISIONS and left
      in the test file's own header. The header now states the real bound: it
      covers the next route added in this file, in this style.
- [x] **The one-kick fix had no test and no mutant** — changing it back to five
      kicks, or to none, left every suite green. Now asserted as a NUMBER so both
      directions fail, pinned by M22.
- [x] **A backwards tooltip**: it called the session total "the smaller 'total'
      figure" when a whole-session total is by definition the larger one.

### T3 round 1 — the Low findings (2026-08-07)

Seven Low findings from the fresh-chat review. All FIXED in the round; none
bought another round (Kd's rule 1). The Critical/High one is not here — it was
fixed and is recorded in DECISIONS.

- [x] **The audit harness could not complete a run.** M11 and M12 both anchored
      to a line the step-8 fix had deleted, so they matched ZERO times and the
      sweep died at M11 — after ten minutes of green suites. **Worse than the
      inconvenience: the retry itself had no live mutant**, so "a 404 RETRIES and
      then renders" had never been proven to fail with the retry removed. M11
      re-anchored, M12 repointed (its old claim, "ONLY a 404 is retried", became
      false at step 8), and **the anchor check is hoisted to run for the whole
      table BEFORE any suite** — it now reports every stale anchor in one second
      instead of the first one after ten minutes. It fired immediately on M18.
- [x] **The permanent guard was a hand-written list claiming to be a sweep.** It
      read `[/v1/workouts/:id, /v1/workouts/:id/summary]` under a comment saying
      "a route added later is covered by construction". It was not. Now derived
      from `routes.ts` itself, with an assertion that both known routes are
      found so a silently-narrowed regex cannot pass.
- [x] **The offline branch identified itself by what it LACKED.** `err.response
      === undefined` swept in every throw that has no response — which is how our
      own bad-body error was read as offline. Now `err.request !== undefined`,
      the positive signal axios actually sets, and the `unreadableBody` tag added
      an hour earlier is deleted as the dead surface it became.
- [x] **A stale comment**: "the retry is scoped to one status on purpose" was
      false after step 8. The test under it was correct throughout.
- [x] **The retry kicked the sync queue five times and swallowed every error.**
      Each kick sets `rerunRequested`, so a failing flush asked for up to five
      extra full passes in four seconds, silently. One kick, on the first retry,
      and the failure is logged.
- [x] **Three redundant transactions per summary read.** `reconciledStreak`
      (`SELECT … FOR UPDATE` plus a conditional write) ran twice per request, on
      a single-connection pool, for a value that was discarded. Records now come
      from the repo under the same gate — same query, same guarantee, half the
      round trips.
- [x] **Two comments in `PostWorkout.jsx` asserted the opposite of the code**
      after the repoint (that the new API has no per-workout XP field, and why the
      XP bar starts empty). Rewritten rather than deleted, per :3610's lesson that
      a wrong comment can re-arm a fixed bug. — fixed same commit.
- [x] **The Workout Time tooltip described a total the app no longer reports.**
      It said the total is "the whole time on the workout screen, including
      standing between reps and camera setup". True of the old backend's figure;
      false of the timer now stored, which stops on pause and does not run during
      a rest break. Rewritten to say exactly that. — fixed same commit
      (kcal-v2 card, DECISIONS :5906).

## T3 round 1 — camera ruling + duration/kcal packet (2026-08-07)

- [x] **The Calories tooltip still described the OLD calculation.** It said the
      figure comes "from your body weight and active movement time" — true before
      kcal v2, incomplete after it, because the estimate now also bills idle and
      rest-break time at a resting rate and bills paused time at nothing. The
      number on screen was right; the explanation under it was a version behind.
      Rewritten to the three tiers actually implemented (verified against
      `calories.ts:61-106`, not recalled). — fixed same commit.
- [x] **The ruling entry's "TEN TESTS CHANGED" bullet overstated its own
      account.** "Every other assertion in them is untouched" was true of six of
      the ten; in four, five `+1 Rep` expectations were REPLACED by the
      equivalent assertion on the offer. Faithful substitutions, but the record
      claimed more than it did. Corrected in place at `DECISIONS.md:6048` rather
      than restated elsewhere — :5748's lesson that a correction applied to the
      record and not to the artifact is half a correction, applied to the record
      itself. — fixed same commit.
- [ ] **REPORTED AND NOT ACTED ON — the review's Low-1 does not reproduce.** It
      called the `camera-not-counting` arm of the sentence under "+1 Rep" dead
      code. Read at `ActiveWorkout.jsx:1465-1467`: that ternary has two arms —
      'chosen' and the no-definition copy — and inside `countItYourself` the
      reason can only be one of those two, so **both arms are live and correct**.
      There is nothing to delete. Logged rather than silently dropped, because a
      finding a chat declines to act on is exactly the kind that gets re-found.

## T3 round 2 — the fix round's own fixes (2026-08-07)

*(Record at `DECISIONS.md:6277`. The round's one Critical/High is not here — a
Critical is fixed or it holds the packet; it never becomes a logged item.)*

- [x] **The `'+1 Rep'` line kept in the four re-anchored stall guards was
      justified with a claim that is false.** Round 1's comment said the line
      "still pins the ruling itself (nothing hands over automatically)". It does
      not: in all four of those tests **no stall or camera error ever registers**,
      so `countItYourself` cannot become true however the ruling is mutated, and
      the assertion is true by construction — the exact vacuity round 1 was
      opened to fix, re-created in the sentence explaining the fix. The line is
      KEPT (it is a cheap cross-check) and the claim is corrected. The ruling is
      pinned by the tests that assert **while a stall is live** — 'KD RULING
      2026-08-07' and the two round-1 badge tests. — fixed same commit.
- [x] **Three record/instrument inaccuracies in `mutate-badge-cue.mjs`.**
      (a) MX1 and MX2 apply the **identical** source mutation against two
      different tests, so "7 mutants" read as seven independent defects; the
      summary now DERIVES and prints "N runs over M distinct mutations", and the
      expected-alive count is derived too — it had been a hardcoded `(1 expected)`
      that went on reading as true for a round after MX4 stopped being alive.
      (b) A **runner** failure (ENOBUFS, signal, timeout, missing corepack) was
      caught and scored RED, indistinguishable from a test failure. Only a
      numeric non-zero exit is a test result now; anything else ABORTS — the class
      fix that already existed in `tools/mutate-workout-summary.mjs`, brought
      across rather than left as one file's lesson, **and it aborts AFTER the
      restore**, because aborting from inside the catch would have left mutated
      source on disk (:5199's defect, re-created by the fix for another one).
      `maxBuffer` raised to 64 MB, which removes the one cause ever observed here.
      — fixed same commit.
- [x] **`graded`'s comment called the diagnostic readout "dev-only".** It is
      behind a `debug` button rendered on the camera panel
      (`ActiveWorkout.jsx:1322-1331`) that **any user can press**. Corrected.
      Plus a dropped word in the C/H-1 test's comment ("It told the it was
      grading" → "the user"). — fixed same commit.
- [ ] **REPORTED, NOT A DEFECT, WORTH A MUTANT LATER — nothing asserts the
      badge's `'Counting yourself'` or `'Log-only'` strings** (grep: zero hits
      outside comments). Two of the three arms of the expression round 1 rewrote
      are pinned by nothing. Not acted on this round: :5348 rule 6 keeps a fix
      round to the fix, and the review itself called it "not a defect today".
      Logged so it is not re-found from scratch.

## T3 round 3 — ZERO Critical/High, the packet ships (2026-08-08)

*(Round 3 found no Critical/High, so under :5348 rule 1 the packet ships and no
further round is owed. These three Lows are fixed anyway — rule 1's schedule
changes, never the bar. Kd approved the fix round before any file was touched.)*

- [x] **The mutation harness stated a count its own output contradicted.**
      Two prose copies — the header and the MX2 comment — both read "SEVEN RUNS
      OVER SIX DISTINCT MUTATIONS" while the file carried eight mutants over
      seven distinct edits and PRINTED exactly that. Both copies were written in
      the same commit that added MX8, so they were false on arrival. **Fixed as
      the class, not the case:** neither figure is typed anywhere now — the prose
      points at the derived summary line and says why, which is the same fix
      round 2 applied to the hardcoded `(1 expected)` one round earlier. A count
      that is typed is a count that lies later. — fixed same commit.
- [x] **The new tooltip test pinned vocabulary, not claims.** Its own comment
      promised the sentence was "pinned as CLAIMS, not as a frozen sentence", and
      it was not: three loose `toMatch`es over the whole string all still passed
      when the camera and hand-counted halves were SWAPPED — camera billed for
      the whole set, hand-counting billed for rep time only, both false, every
      word still present. **Measured, not argued** (`1 passed`, mutant ALIVE)
      before the line was touched. Each clause is now located first and then
      asked what it says, so an inversion fails. MX8 already pinned round 1's
      exact wording, so the gap was a NEW false rewrite, not a regression. —
      fixed same commit.
- [ ] **The Calories tooltip is true for a v2-priced workout and false for a v1
      one.** Round 2 judged the wording "vaguer but true for v1"; checked against
      `calories.ts`, three of its four clauses are false there, not vague.
      **NOT fixed in code this round and it needs no code:** the summary payload
      carries no `kcalCalcVersion`, so the screen cannot branch, and no user can
      reach a v1 workout today (measured — see the OWED line). **Deferred, so it
      has an `OWED.md` line in this same commit**, per the deferral rule.

## T3 round 3 — reported, not acted on

- [ ] **MX8's explanatory comment sits above `from` but describes `to`.** "The
      round-1 wording, verbatim" reads as though it labels the anchor, which is
      the CURRENT correct sentence; the round-1 wording is the replacement below
      it. Same family as the count above — a true statement filed against the
      wrong line. Not touched: :5348 rule 6 keeps a fix round to the findings Kd
      approved, and this was found while fixing them. Logged so it is not
      re-found from scratch.

## Person check (camera card 4 step 3) — T3 round 1, Low findings

All eight were found in the same review that raised the two Critical/High above
them, and all eight are FIXED in the same commit (:5348 rule 1 — a Low buys no
round, it is still fixed). Recorded here so the next chat knows they were
accounted for rather than absorbed silently.

- [x] **L1 · A hidden tab never forgot the scene.** `enabled` does not change
      when a tab is switched away, so the resume path that calls `resetScene`
      was never reached — the check kept a window of readings from minutes
      earlier and a stale sentence. **The fix went in deeper than the finding
      described**: browsers do not run frame callbacks in a hidden tab, so the
      loop's own `document.hidden` check usually never runs and the guard would
      have stayed a no-op. The hide is now cancelled explicitly. Mutant PG21.
- [x] **L2 · `resetScene` cleared the check but not `_metricUnusableStreak`,**
      so two unusable frames before a pause plus one after could raise "cannot
      see your legs clearly" on the first frame back. Mutant PG20.
- [x] **L3 · The scene sentence outranked a live engine cue for up to fourteen
      frames after counting resumed.** Fixed with C/H-1: while blocking it still
      wins (the frame was blanked, so any engine cue is about a frame the app
      refused to look at); in the tail a real cue wins. Mutant PG12b.
- [x] **L4 · Four `toBeGreaterThan(50)` assertions.** A floor is satisfied by a
      cut-off loosened until it barely works — PG1's shape. Restated as set
      equality against the shipped gate, frame by frame.
- [x] **L5 · `slice(0, 7)` was one frame short of the real warm-up boundary**
      (`ceil(15/2)` = 8 readings, first frame has no predecessor ⇒ frame 9 is
      the earliest that can block). Now asserts the exact boundary.
- [x] **L6 · `resetCalls: 0` on the `scripted()` fake was never read.** Deleted.
- [x] **L7 · "Step into full view" instructed an action the app cannot know is
      needed** — measured, 0.7–10.5% of frames of a user fully in frame were
      blocked. Now "Check that your whole body is in the picture": a suggestion
      to verify, not a claim about what is wrong. Mutant PG15.
- [ ] **L8 · No escape hatch while the check is blocking.** "Count this set
      myself" is gated on a frame gap or a camera error, and blocked frames
      still arrive, so a user the check is wrong about cannot take over.
      **NOT fixed — deferred, and it has an `OWED.md` line in this same commit**
      per the deferral rule. Low on measured evidence (worst person-clip run 18
      frames, ~1.5 s) but it is the escalation path for the frame-rate defect.

## Person check (camera card 4 step 3) — T3 round 2, Low findings

Round 2 found ZERO Critical/High, so the packet ships (:5348 rule 1). Both Lows
below are FIXED in the same commit. Both are comment-only: no shipped arithmetic
was touched, deliberately — see L10.

- [x] **L9 · The burst fixture's comment mis-stated how it fails.** It said "a
      burst that starts earlier eats the first rep", implying one failure mode
      either side. Measured by drifting the fixture and reading which control
      went red: starting at frame 24 or earlier eats a rep (1, not 2), but
      starting 26–34 keeps both reps and empties the message tail instead — a
      different worthless clip. Comment corrected with all four measured drifts.
      Found by the round-2 fixture audit, not by a test.
- [x] **L10 · `nominalDtMs` is applied to all three rate signals, and is right
      for one.** The fix for round 1's C/H-2 converts every reading at a fixed
      82 ms. That is physically correct for `bone_stretch` (per-frame estimator
      noise, does not grow with dt) and WRONG for `centre_drift` and
      `motion_incoherence`, which measure displacement — a fixed interval erases
      the elapsed time they are made of. **Nothing on screen is wrong today**:
      the shipped gate runs one rule and `measure-pose.ts` sections 4/5 pass
      null, which is why this is Low and not C/H. The trap is for whoever adds
      the second rule — their cut-off would silently stop being the number it
      was measured at. **Fixed as a warning at both sites, NOT as a per-signal
      split**: splitting the conversion would move readings the ruled table was
      measured against, which is a ruling, not a Low fix (:5348 rule 6).
- [x] **L11 · the red-test commit did not typecheck or lint, and a green vitest
      run said nothing about it.** `repTimingAbsence.test.ts` (`84ff14d`)
      imported `RepEvent` — a `@app/shared` payload type the engine re-exports
      nowhere — from `../src/index.js`. `tsc --noEmit` fails on it; vitest runs
      it green regardless, because esbuild strips types without checking them.
      So a file committed "deliberately red on one assertion" was also red for a
      second reason nobody had seen. **Fixing the import then exposed three lint
      errors it had been masking** (the unresolved type made the whole file
      error-typed, so `no-unnecessary-condition` could not fire), including a
      dead `summary?.reps ?? 0` — `end()` returns a SetSummary, never null, and
      had that ever fired the helper would have reported **0 reps** and every
      assertion in the file would have passed for the wrong reason. Low: no user
      can see it, and the assertions themselves were sound. **The lesson is the
      instrument — a green vitest run is not evidence that a test file
      compiles.** Fixed in the rep-timing fix commit; DECISIONS :7404.
- [x] **L12 · §3.1's count of three is enforced TWICE, and only one half was
      pinned.** `ingest.ts` applies it to frames that do not ARRIVE; `fsm.ts`
      applies it to frames that arrive carrying no usable METRIC (the occluded
      path). **Measured 2026-08-14: loosening the FSM's own threshold tenfold
      (`>= INVALID_STREAK_FOR_VISIBILITY` → `>= 30`) left all 199 tests GREEN**,
      because the blink test — the one test whose whole subject is that boundary
      — fed only blank frames and so exercised the ingest counter alone. Nothing
      on screen was wrong, which is why it is Low: the shipped value is correct
      and matches `sessionController.js`'s own `METRIC_UNUSABLE_STREAK = 3`. The
      trap is for whoever changes it next, with a green suite telling them
      nothing. **Fixed:** the blink test now runs over BOTH kinds via `it.each`,
      and mutant **M8** is RED. Found by T3 round 1 (Low-1); DECISIONS :7487.
- [x] **L13 · the card's "6 mutants, 6 RED" rested on a harness that was never
      committed.** :5199's class, and the exact failure `DECISIONS :6532` was
      written about — an evidence claim whose instrument cannot be re-run is not
      evidence. `tools/` held two harnesses (duration-kcal, workout-summary),
      neither for this card. **Fixed:** `tools/mutate-rep-timing.mjs`, carrying
      the same five safeguards, EOL-normalising anchors per file (:4267), and
      running 9 mutants over engine-only suites — no DB mutant, per the
      severity-scoping rule 4a, since this card changes no server behaviour.
      Found by T3 round 1 (Low-2); DECISIONS :7487.
- [ ] **L14 · `assertTrace` is structurally blind to rep TIMING.** It asserts rep
      count, fault multiset, scores, hold time and phase sequence — and nothing
      about `durationMs` or `tempoMsAvg`. So the §7.4 golden gate, the mechanism
      that is supposed to make this engine safe to change, cannot see the entire
      subject of this card: every timing guarantee here rests on one hand-written
      test file. Pre-existing and NOT introduced by this card. **NOT fixed in this
      round and therefore promoted to a deferral with its own `OWED.md` line**
      (:5348 rule 6 keeps a fix round to the fix; adding a field to the trace
      assertion layer means every golden trace must declare expected timings,
      which is a card). Found by T3 round 1 (Low-3); DECISIONS :7487.
- [x] **L15 · the mutation harness's last safeguard could not fail.** Safeguard 5
      restored every target from the snapshot and then, on the NEXT line, compared
      those same targets to that same snapshot — so `dirty` was always empty and
      the run always printed "every TARGET is byte-identical to its pre-run
      snapshot", whatever had happened. That sentence was quoted as evidence in
      the rep-timing fix commit and in the card's HANDOFF block, which is what
      makes it worth a line: **the claim was true, but it was not EARNED, and the
      instrument that was supposed to earn it was decorative.** :5199's and
      :5748's class again, and the third time this card has produced one — L13
      was the harness that did not exist, this is the harness that could not fail.
      Low because nothing a user can see is affected and the tree really was clean
      (verified by hand at the time). **Fixed:** `dirty` is computed BEFORE
      `restoreAll()`, so it measures what the LOOP left; `restoreAll()` still runs
      before every exit path, so a failed sweep never leaves mutated source on
      disk; the message now says which files the loop left modified and that they
      were restored. **Proven both ways 2026-08-14** — same injected dirty file,
      old order: "byte-identical", exit 0; new order: `*** THE LOOP LEFT THESE
      MODIFIED (restored before exit): packages/engine/src/pipeline/fsm.ts ***`,
      exit 1, working tree clean afterwards. Note this is NOT the per-mutant check
      inside the loop, which was always real — but that one only ever looks at the
      file its own mutant named, so a mutation writing somewhere it did not
      declare is caught by safeguard 5 and nowhere else. Found by the diff-only
      re-review (Low-1).
- [x] **L16 · the card's headline promise was untested on the one path the fix
      added.** The promise is "never bill more exercise than the camera watched"
      (`reps × tempoMsAvg` ≤ watched time, the arithmetic `kcalPointForSetsV2`
      actually charges). Every billing sweep in `repTimingAbsence.test.ts` splices
      ONE absence into the two-rep clip — and one absence always leaves a rep
      watched end to end, so the all-interrupted fallback that round 1 added never
      runs under any of them. The three tests round 1 did add check what the
      average EQUALS, which is a different claim: an average can be perfectly
      well-formed and still bill more time than the camera ever saw. **This is
      round 1's own finding — that the FIXTURE's shape was the hole, not the
      assertions — one level up.** Low because the promise does hold today, not
      because it was checked: zero overbilled with absence 1 pinned mid-descent of
      rep 1 and absence 2 walked across every remaining frame, both blindness
      kinds. (**That is the sweep's actual shape, not every PAIR of positions** —
      the re-review quoted a differently-shaped sweep of its own and its number is
      deliberately not reproduced here.) **Fixed:** a two-absence billing sweep
      that pins absence 1 mid-descent of rep 1 and walks absence 2 across every
      remaining frame, asserting its own fixture reaches an unmeasured rep before
      asserting the billing claim (:7298's rule against vacuous fixtures).
      **Non-vacuity proven 2026-08-14**: halving the budget produces 85 offenders,
      so the comparison computes real numbers; and with `loseSight()` reduced to
      the legacy no-op the new test goes RED (on its fixture guard, correctly
      refusing to pass vacuously) alongside 9 others. Found by the diff-only
      re-review (Low-2).
- [x] **L17 · my own comment claimed a property the code does not have.** The
      first draft of the watched-time block in `session.ts` said the number "can
      never exceed what was really seen". **That is FALSE for a PAUSE**, which
      feeds no frames at all and therefore lands inside watched time. Found by
      measuring the pause case rather than by reading — the promise made to Kd in
      the plan is what forced the measurement, and the comment was written before
      it ran. **This is the defect class this repo has recorded more than any
      other** (:6150, :4556 F3, :3610): a comment asserting a guarantee the code
      does not carry, which then re-arms the bug for whoever trusts it.
      **Fixed before the commit**: the comment now states what the number cannot
      see, with the measured figures, and points at the `OWED.md` line for the
      cause. Found in-card, 2026-08-14; DECISIONS :7730.
- [x] **L18 · the between-reps test could not see its own mutant.** M11 (moving
      `sightLostNow = true` after `loseSight()`'s early return) came back **ALIVE**
      against the first draft of "excludes an absence taken BETWEEN reps". The
      reason is structural and worth keeping: **the BLANK path never consults the
      FSM at all** — `session.ts` sets `blindSinceLastUsable` itself for a frame
      that fails ingest — so only the OCCLUDED path reads `fsm.sightLost`, and the
      draft swept blank frames only. **The fixture's shape was the hole, not the
      assertion, for the third time on this card** (:7487's own lesson, :7634's
      restatement of it). **Fixed**: the sweep runs both blindness kinds and
      asserts a between-reps position exists for EACH before testing either;
      M11 is RED. Found by this card's own mutation sweep, 2026-08-14;
      DECISIONS :7730.
