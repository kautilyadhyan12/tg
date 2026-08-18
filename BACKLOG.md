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

## Rep timing + pause, T3 ROUND 1 — ZERO Critical/High, the packet SHIPS (2026-08-15)

*(The fresh-chat review covering BOTH commits — the API half (`faa7f06`) and the
pause fix (`8c2d204`) — found no Critical/High, so under :5348 rule 1 the packet
ships and no further round is owed. All four Lows are fixed anyway: rule 1
changes the SCHEDULE, never the bar. Kd approved the fix round before any file
was touched. Every finding below was re-verified against the code IN THIS
SESSION before being acted on — a review is another chat's claim, and V4 binds
it like any other.)*

- [x] **L19 · my own comment claimed an invariant the code does not have — the
      SECOND time on this card, three lines from where L17 had just corrected
      it.** `session.ts` said `watchedMs` is "never more than the span by
      construction … Asserted rather than assumed", and **both halves were
      false**. `lastT = frame.t` is stamped at `session.ts:202` BEFORE the
      ingest check, and an out-of-order frame is dropped with `visibilityOk`
      deliberately untouched (§3.1, `ingest.ts:48-53`), so nothing re-arms — the
      span moves BACKWARDS while watched time keeps what it accrued. Measured:
      a clean clip reports watched 8400 / duration 8400; one out-of-order final
      frame reports watched 8400 / duration 1. **And nothing asserted it**:
      every sweep in the file compared `watchedMs` to a span the TEST computed
      from the fixture, never to the summary's own `durationMs` — which is a
      different claim, and the one both readers actually rely on.
      **Low, not Critical/High, on measured grounds**: no browser client can
      reach it (the web feed stamps frames from a monotonic clock) and both
      readers clamp to `durationMs` anyway (the write boundary and
      `kcalPointForSetsV3`), so no user can see a wrong number. **Fixed BOTH
      ways rather than by deleting the claim**: the comment now states the true
      scope and names the ordering it does not cover, and a new test
      ("never claims to have watched more of the set than the set lasted")
      compares the two SUMMARY FIELDS across the untouched clip, both blindness
      kinds at every frame boundary, and a pause declared and undeclared.
      **Mutant M16 pins it** (`firstT ??=` → `firstT =`, collapsing the span
      while leaving watched time alone) — **and it was measured to be caught by
      the NEW test ALONE: 1 failed, 22 passed**, which is the whole point, since
      those 22 are the sweeps that looked like coverage.
      Found by T3 round 1 (its Low-1).
- [x] **L20 · the v3 budget cap on a HAND-COUNTED set was protected by nothing,
      and the sweep had no mutant for it.** `const metMs = Math.min(s.durationMs,
      remaining)` (`calories.ts:173`) is new behaviour — v2 billed a log-only
      span in full and never trimmed it — and mutants A1–A5 all sit on the
      engine-set branch. **Measured before the fix, not argued: A6 came back
      `*** ALIVE ***` with `apiCalories: GREEN`.** It matters more than its
      severity suggests because the log-only branch prices the **55 exercises
      with no engine definition**. Low because the cap only binds when charged
      MET time approaches the whole timer, which an honest workout does not
      reach — on Kd's own smoke A it was 17.3 s against a 46 s budget.
      **Fixed:** a test pinning both the cap (30 minutes claimed inside a
      10-minute workout bills 70, not 210) and that sets SHARE one budget rather
      than each getting the whole timer; mutant **A6 is now RED**.
      Found by T3 round 1 (its Low-2), which reported it under rule 4 (listed,
      not fixed) — this round fixed it.
- [x] **L21 · a payload carrying watched time but no rest time prices at v1,
      which ignores the field.** `service.ts:85` selects on `restSeconds` first,
      so that shape would be billed by a formula that cannot read the number it
      is named for. **The stamp stays v1, so the stored row is still explicable
      from itself** — this is a missed upgrade, never a wrong number. **No client
      can produce it today** (verified: `ActiveWorkout.jsx:1074-1075` sends both
      fields unconditionally); the plausible producer is the P5 mobile client.
      **NOT fixed in code and it needs none — deferred, so it has an `OWED.md`
      line in this same commit**, per the deferral rule.
      Found by T3 round 1 (its Low-3).
- [x] **L22 · a 126-character line in a file that wraps at ~100.** `calories.ts`'s
      `timerIdleMs` ternary, measured against the file's next-longest line (100).
      No prettier config exists, so eslint passed it — inconsistency, not a
      violation. Wrapped. Found by T3 round 1 (its Low-4).
- [ ] **L23 · sign-up demands a capital letter the server never asks for.**
      `apps/web/src/pages/Register.jsx:47` refuses any password failing
      `(?=.*[a-z])(?=.*[A-Z])(?=.*\d)` with "Password must contain uppercase,
      lowercase, and a number". The API's `authPasswordSchema`
      (`packages/shared/src/auth.ts:11`) accepts **any 8–128 characters**. So a
      password the server would take is refused by the browser, and an account
      created through the API with such a password logs in fine through the same
      UI that would not let you register it — the login form checks only that the
      boxes are non-empty (`Login.jsx:39`).
      **Low, not Critical/High** (Part I §2.5 rule 1a): nothing false is shown and
      no one is blocked from a flow — the stricter rule is a defensible policy.
      **What is wrong is that the two disagree**, and the fix is to decide WHICH
      is the policy and state it once, not to weaken either in passing.
      **Found by Kd on 2026-08-15** during the dashboard-stats smoke, head-on: he
      was handed `smoke1234` and the screen refused it. NOT fixed there (R1.1 —
      out of that card's scope). Not part of the dashboard-stats diff.
- [x] **L24 · a user-visible colour change went unrecorded.** The recent list's
      form-score tint moved from an inline two-way ladder
      (`Dashboard.jsx`, `>= 60 ? '#FFB347' : '#f87171'`) to the shared `formColor`
      (`workoutHistory.js:435-439`: `>= 80` green, `>= 60` `#FF8A1F`, else red).
      **The change is correct and deliberate** — it is the ONE-LADDER
      consolidation, and it gives scores of 80+ the green band the inline version
      had no concept of. What was wrong is that the card's DECISIONS entry
      ENUMERATED the user-visible changes and this was not among them, so a
      score of 85 changed colour with no line saying so.
      **Low under Part I §2.5 rule 1a**: nothing false is shown — a tint is not a
      claim — so it is cosmetic-and-true.
      **Fixed:** recorded as the fourth user-visible change at `DECISIONS.md:8267`.
      The fix for a Low that is a missing record IS the record.
      Found by T3 round 1 (its Low-1).
- [x] **L25 · a failed totals read still captioned the em dashes "all time".**
      `totalsWindowLabel(null)` returns "all time", which is true of an UNGATED
      plan and equally true of a read that never arrived — so three tiles showing
      "—" sat under a sub-line describing a window nobody had told the page
      about. **Low, not Critical/High**: no number is stated falsely, and the
      value itself correctly reads "—". What is wrong is a caption asserting
      something about a number that does not exist.
      **Fixed:** the Total Workouts and Calories tiles now omit the sub-line when
      their own value is null — per FIELD, matching the guard the Hours tile has
      always had, because a 200 missing one field must still caption the others.
      **An existing test was pinning the defect** (`getByText(/kcal ·/)` inside
      "a PARTIAL 200 fabricates nothing for the missing fields" — one line below
      its own subject); flipped, with the reasoning at the assertion. Mutants
      **M5 and M6 are RED**.
      Found by T3 round 1 (its Low-2).
- [x] **L26 · "No workouts in the last 1 days."** The Dashboard's empty pane
      interpolated the plan window with a hard-coded plural, while its sibling
      caption on the SAME page already handles the singular
      (`progressClamp.js`, `days === 1 ? "day" : "days"`) — so a 1-day gate would
      print both spellings on one screen, the ONE-LADDER drift the pane's own
      comment argues against. **Low**: grammar, and nothing false is stated.
      Latent — no seeded plan uses `history_days: 1` (only -1 and 90) — but the
      reader deliberately accepts any positive gate, so 1 is inside the range it
      chose to admit. **Fixed** in the same expression as the round-2 redesign,
      with a render test at a 1-day window; mutant **W5 is now RED**, having
      survived the first sweep.
      Found by T3 round 2 (its Low-1).
- [x] **L27 · three line citations off by one.** `service.ts:131` was cited for
      "maps an unlimited plan to null" (that is line **130**; 131 is the gated
      branch) and `service.ts:182,190` for "clamps and reports it" (182 is right,
      the report is line **191**; 190 is `nextCursor`). Four sites across
      `dashboardStats.js`, `dashboardStats.test.js`. **Low**: nothing on screen,
      nothing false to a user — but V2 says quote by line, and an off-by-one
      citation sends the next chat to the wrong statement, which is the whole
      cost the rule exists to avoid. **Fixed**, and my own new
      `entitlements/service.ts` range was re-derived rather than copied while I
      was there (95-99, not 95-98 — the free-plan fallback is only visible across
      the whole `Promise.all`).
      Found by T3 round 2 (its Low-2).
- [x] **L28 · the fix for L26 was itself the drift L26 was about.** L26 added a
      singular by writing a FIFTH inline spelling of "the last N days", with its
      own pluralization, in `Dashboard.jsx` — while `totalsWindowLabel(90)` on
      the same page already returns exactly `last 90 days` with the singular
      handled, and `progressClamp.js`'s docstring names this by anticipation
      ("a fourth spelling … is how a screen starts describing the same window
      two ways"). **Fixed:** the pane calls `totalsWindowLabel`. Mutant **W5\***
      (replace the call with an inline copy) is RED.
      Found by T3 round 3.
- [x] **L29 · a third copy of "≤ 0 is no gate", under a comment arguing there
      must be one.** The rule was in `monthClamp` and `effectiveClamp` already;
      the round-2 redesign added a third in `readRecentWorkouts`. **Fixed:**
      normalised in `readWorkoutPage` — the one reader both the calendar and the
      Dashboard pass through — and deleted from the consumer. `monthClamp` keeps
      its guard because it is reachable with values that never came through that
      reader. Mutant **W6\*** is RED.
      Found by T3 round 3.
- [x] **L30 · a test fixture's comment described a default it does not have.**
      "Both default to the UNGATED, UNKNOWN case" — `limitedToDays` does;
      `hasAnyWorkouts` defaults to `items.length > 0`, a definite boolean. An
      author trusting it would believe `historyOk([])` reaches the UNKNOWN arm
      when it reaches the brand-new-account arm. **Fixed:** the comment now says
      what each default is and how to actually reach UNKNOWN.
      Found by T3 round 3.
- [x] **L31 · three render fixtures the server cannot emit.** Each paired a
      totals tile counting 1 / 12 / 3 workouts with a history page saying the
      user owns none, and no gate to explain the gap. Round 2 named the class —
      "a fixture that cannot occur is a test asserting about nobody" — and the
      round-2 default made these contradictions explicit rather than creating
      them. **Fixed:** totals set to 0 in all three; each test's actual subject
      (which arguments are sent, and that a settled read does not wait on a
      hanging sibling) is untouched.
      Found by T3 round 3.
- [x] **L32 · a known-false sentence written fresh into DECISIONS.** The round-1
      entry says the denial sat "inches under a Total Workouts tile counting the
      very history it was denying"; the round-2 entry disproves it (that tile is
      clamped by the same floor and reads 0). Both entries are in the SAME
      uncommitted change, so this is not inherited diary — it would have shipped
      a sentence known to be wrong. **Fixed:** a correction clause at the claim
      itself, pointing at the entry that disproves it. Nothing rewritten or
      deleted; the append-only record still reads in order.
      Found by T3 round 3.

- [x] **L33 · `removeItem` was the one storage helper that could throw.** Its
      siblings `getItem`/`setItem` each swallow and log; `removeItem` did not.
      The dual-write retirement moved `ActiveWorkout`'s two calls OUT of the
      `try` that used to contain them, and neither caller awaits or catches
      `handleWorkoutComplete` — so a throw became an unhandled rejection that
      skipped the navigation to the summary and left the user on "workout
      complete" indefinitely. Rated Low because no browser state was found where
      it throws while the same workout's earlier `getItem`/`setItem` succeeded.
      **Fixed:** same `try {} catch {}` as `setItem`, with the reason recorded.
      Found by T3 round 1.
- [x] **L34 · the "waits for ever" symptom was invented and copied into four
      places.** The summary-id defect is real; the failure it was said to
      produce is not. `PostWorkout` gates "not synced yet" on
      `isAwaitingSync(workoutId)` and the outbox is keyed by the SYNC id, so a
      legacy id answers false and takes the immediate failure path — "Failed to
      load summary" and a redirect, **on the first failed read** (this clause
      first read "five retries (~4 s)", which round 2's Low-1 struck: the retry
      is gated on the same `awaitingSync`). **Fixed:** corrected at all four
      sites (`ActiveWorkout.jsx`, the test's own comment, `DECISIONS.md` struck
      in place, `DECISIONS-INDEX.md`) rather than only where it was noticed —
      :8405's lesson. Found by T3 round 1; **its own replacement text was wrong
      and was fixed by L38 below.**
- [x] **L35 · a `stopCamera` assertion satisfied before the button was
      pressed.** `handleModeChange` calls `stopCamera()` when the user picks
      "I'll count my own reps", which the test does first — so the assertion was
      green with the call deleted from `handleStart` entirely, and the reviewer
      measured exactly that (all 10 tests in the file stayed green under the
      mutation). **Fixed:** `stopCamera.mockClear()` between the two clicks,
      with the reason written above it. Found by T3 round 1.
- [x] **L36 · a test name promising a save that no longer happens.** "does not
      sync — but still saves and still finishes" was true while the legacy save
      existed. **Fixed:** renamed to "still FINISHES cleanly"; the assertions
      were correct throughout and are untouched. The stale RATIONALE it came
      from (`syncClient.js` justifying the refusal by the legacy save) is the
      more serious half and is corrected there, with its own `OWED.md` line
      because the trade-off itself inverted. Found by T3 round 1.
- [x] **L37 · malformed markdown in `OWED.md`'s offline-start line** — an
      unmatched `**` and a sentence broken across an edit seam. **Fixed**, and
      the same line's smoke status updated: step 9 has since passed.
      Found by T3 round 1.
- [x] **L38 · the CORRECTION to the summary-id symptom was itself wrong, in five
      places.** Round 1 struck "the screen waits for ever" and wrote "after five
      retries (~4 s)". Also false: `PostWorkout` gates the RETRY on the same
      `isAwaitingSync(workoutId)` as the reassuring wording, so a legacy id never
      enters the retry branch — it is "Failed to load summary" and a redirect on
      the FIRST failed read. **`xpDisplay.render.test.jsx` has asserted exactly
      that (one call, no retry) all along, green, while two of my sentences said
      otherwise.** Both wrong versions came from reading the retry CONSTANTS
      instead of the BRANCH that reaches them. **Fixed** at all five sites.
      **Standing lesson: a correction is a claim and takes the same evidence as
      the thing it corrects.** Found by T3 round 2.
- [x] **L39 · a fifth copy of the retired symptom survived in the harness** —
      M58's own name still read "404s, screen never resolves". A mutant's NAME is
      what a future chat reads to decide what the mutant proves, so a false one
      mis-teaches at exactly the moment someone is deciding whether a red row
      matters. **Fixed:** renamed to the real outcome. Found by T3 round 2.
- [x] **L40 · the recorded test count was stale in three files** — 631/631 where
      the suite is 634/634. Measured before `storage.test.js`'s three new cases
      were added, then carried into `HANDOFF.md`, `DECISIONS.md` and the review
      prompt without re-measuring. V1, on my own work, in the same session that
      cited V1 against someone else's number. **Fixed:** re-run and corrected
      everywhere. Found by T3 round 2.
- [x] **L41 · `OWED.md`'s dual-write line still said the smoke was UNRUN and the
      sweep KILLED.** Both had since become false — smoke 9/9, sweep completed —
      and L37 had updated the SIBLING line's status while leaving this one. **The
      shape is L37's own lesson recurring inside its own fix: a status written in
      two places is a status that goes stale in one of them.** **Fixed**, and the
      line now ticks. Found by T3 round 2.
- [x] **L42 · the loud new warning printed `Cause: undefined`** — found by Kd's
      smoke, not by a test: with the bundled files removed, the bundling card's
      new warning named the consequence correctly ("this workout will need an
      internet connection") and the reason not at all. `bundledErr.message` is
      the wrong reach — MediaPipe rejects with values that are not `Error`s. The
      same flaw pre-existed at the GPU→CPU line and, worse, at the init-failure
      line, which puts its text ON SCREEN as "Pose detection unavailable —
      undefined". **Fixed** at all three sites with one `describeError` helper
      that never throws. Half the point of that warning was the reason; it had
      been shipping without it. Found by fresh-chat T3 round 1 (L1).
- [x] **L43 · the smoke sheet still told the next person to use an instrument
      the run proved inert** — steps 1–2 specified DevTools "Network request
      blocking", which did nothing: the control round printed `THE APP BUNDLE`
      with both patterns listed and enabled. Only the RESULT block at the top
      had been corrected, so the body still read as instructions. **The shape is
      L41's lesson again — a status written in two places goes stale in one of
      them — this time between a file's header and its own steps.** **Fixed:**
      steps 1–2 replaced with the two instruments that worked (files moved off
      disk; the machine's Wi-Fi switched off), step 4 marked superseded with its
      reasoning kept, and the reason DevTools' Offline throttle is NOT the
      substitute written down so it is not reinvented. Found by T3 round 1 (L2).
- [x] **L44 · turbo replayed a cached PASS for a contract test whose subject was
      broken** — the `test` task hashed 136 files, none of them under `tools/`,
      so editing `tools/fetch-pose-assets.mjs` left the task hash byte-identical
      and `turbo run test` served a stale green. A direct `vitest` run went RED
      correctly, and CI is unaffected today because every runner is fresh with no
      remote cache — **this becomes Critical the day remote caching is enabled**,
      which is exactly the kind of latent trap that is cheap now and expensive
      later. `build` had the same gap. **Fixed:** `tools/**` added to both tasks'
      inputs. Found by T3 round 1 (L3).
- [x] **L45 · the throughput meter opened every set with a line that reported
      nothing** — `lastHzLogRef` was seeded at `0` while `now` is
      `performance.now()`, so `now - 0 >= 10_000` was true on the very first
      frame and every set began `delivered not measurable yet … 1 frames in
      window`. It appeared four times in Kd's smoke. **Fixed:** the ref starts
      `null`, meaning "no window has started", and the first frame opens one
      instead of closing one; the three places that reset the throughput now
      reset the log window with it. Found by T3 round 1 (L5).
- [x] **L46 · this card's own assets broke `pnpm --filter web lint` — 578 errors,
      found in the FIX round, not by the review** — the five fetched files land
      in `public/`, and `eslint .` happily lints the two minified emscripten
      loaders among them. 653 problems total, of which **578 were vendor code
      nobody wrote**. It had been missed because every check so far — the
      packet's, the T3's and mine — linted the CHANGED FILES, which are all
      genuinely clean; only `eslint .` sees it. **The coupling is the part worth
      keeping: lint passes in CI today ONLY because CI never runs the fetch
      script, which is C/H-3. Closing C/H-3 without this would have turned a
      silent gap into a red CI gate and looked like the deploy fix broke lint.**
      **Fixed:** `public/mediapipe` ignored alongside `dist` in
      `eslint.config.js`, with that coupling written into the comment. Residual
      75 are pre-existing app lint, untouched (R1.1). Found while running the
      universal DoD checklist rather than by any review.
- [ ] **L47 · the camera-rate row names a ceiling the app essentially cannot
      reach** — the row prints `<rate> of 14.9/s`, and 14.9 is `MAX_FEED_HZ`, the
      throttle's arithmetic cap. On an ordinary 60 Hz display the real cap is
      **12.0** (:9003, asserted by a test driving the frame loop), so a user
      sitting **exactly at the practical maximum reads as 20 % short** —
      structurally the misreading :9003 exists to remove, at a different pair of
      numbers. **TRUE, not false, therefore Low under :5807**, and the format is
      Kd's ruling verbatim (:9003) — this is NOT a licence to change the display.
      Note for whoever picks it up: the ceiling is **display-dependent**, so any
      fix has to decide what to show on a 120 Hz screen, where 14.9 IS reachable.
      Found by fresh-chat T3 round 1 (Low-1) on the strong-model/rate card.

- [x] **The page's read of the rate meter was protected by nothing, so the
      expiry could have been undone one layer up without a single test noticing.**
      FIXED 2026-08-17 in the round-2 fix round. Found by fresh-chat T3 round 2
      (Low-1), and found the only way it could be: the reviewer WROTE the defect
      — a component-level ref holding the last non-null reading, which is round
      1's "14.9 over a dead camera" restored at the consumer — and **all 690
      tests stayed green**. Every rate test rendered once against a CONSTANT stub
      (`activeWorkout.render.test.jsx`), so nothing anywhere asserted that the
      page ASKS the meter rather than remembering what it last said. :2912's
      standing lesson ("a repoint nothing asserts is one the next edit undoes")
      and :5104 F5, in a third file. Closed by a render test that changes what the
      meter answers and advances the page's own once-a-second repaint: the row
      must follow the new figure, the old one must be GONE, and a later null must
      reach the screen as the dash. **Mutation-proven: the reviewer's exact
      mutant is now RED (1 failed / 43).**
- [ ] **The ceiling's figure moved, so L47's arithmetic is now slightly wider than
      it records.** Opened 2026-08-17 by the round-2 fix. A reading is now measured
      up to the moment it is READ rather than up to the last frame, so a reader —
      never exactly on a frame's arrival — always has part of a trailing gap
      inside the measurement, and a perfect machine reads about **14.6** where the
      row's ceiling says 14.9 (measured: 14.67 with an infinitely fast loop, 14.59
      at one 67 ms gap). **This does not change L47's finding or its severity** —
      the ceiling was already unreachable in practice at 12.0 on a 60 Hz display,
      which is the number that matters — it widens the gap by a fraction and is
      recorded so the next reader of L47 is not surprised by the arithmetic.
      **TRUE, not false, therefore Low (:5807), and the format stays Kd's (:9003).**

## Org slice — T3 round 1 Lows (2026-08-18, all FIXED in the same round)

Six Low findings from the first review of `apps/api/src/modules/orgs`. None is
user-visible, none bought another review round (:5348 rule 1), and all six were
fixed — the rule governs the SCHEDULE, never the quality bar.

- [x] **L-1 — a comment of mine that was false about the code three lines away.**
      `groupLabel` was documented as "null when the membership predates any code
      (owner seat)", and the owner's seat is given the first code's id at
      creation, so that null is unreachable. Corrected to say what actually makes
      it nullable (the column is, and the roster IMPORT will be the first writer
      with no code). :7974 L19's class — a comment asserting an invariant the
      code does not have.
- [x] **L-2 — two `as` casts outside an adapter file (R2.2).** `Object.keys(...)
      as SupportedCountry[]` was unguarded. Removed BOTH by making the country
      list a Zod enum: `SUPPORTED_COUNTRIES` is now `schema.options` (typed, no
      cast) and `currencyForCountry` uses `safeParse`, which narrows without a
      cast **and** closes the inherited-key hole for free — a bare `in` check
      matches `constructor` and `toString`. The test that pinned that hole was
      already there and still passes.
- [x] **L-3 — `timezone` and `locale` were shape-only (R2.3).** Length-bounded
      strings written straight into a permanent row, while the column's own
      comment says every org-day boundary comes from it and nowhere else.
      Nothing reads `gyms.timezone` yet, so no user could see a wrong day — but
      a junk zone written today is permanent, and the rollup that eventually
      reads it cannot tell "Mars/Olympus" from a zone it merely does not know.
      Both now validated at the parse boundary by asking `Intl` (a try/catch
      around its `RangeError`), deliberately not a regular expression: the IANA
      zone list changes, so a pattern would be wrong by next year.
- [x] **L-4 — four response schemas re-exported and parsed nowhere**, while
      three sibling modules do parse theirs. All four responses now go out
      through their schema. Not ceremony: it is what would have caught a
      response missing `currencyDisplay` when the schema gained the field, and
      on the roster it is the §2.4 visibility boundary — a field added to the
      row but not the schema is now dropped rather than served. `/mine` was also
      unbounded; it takes a documented `LIMIT` rather than a cursor, since a
      person belongs to one or two gyms and the point was to have a ceiling at
      all.
- [x] **L-5 — `POST /v1/orgs` has no per-route rate limit**, so one account can
      mint gyms at the global 300/min and squat readable slugs. `OWED.md`
      recorded this gap for `/join` only; create was tracked nowhere. Fixed as
      the reviewer's own first option — an `OWED.md` line, now covering BOTH
      routes rather than adding a limiter mid-fix-round (:5348 rule 6).
- [x] **L-6 — I over-claimed about my own tests, in two places.** The test-file
      header and the commit message both said BOTH concurrency tests would fail
      if the `FOR UPDATE` were deleted. Measured by the reviewer: the seat-cap
      race goes RED, the same-person race stays GREEN — it is carried by the
      partial unique index and `ON CONFLICT`, not by the lock. Corrected IN
      PLACE in the header (a commit message cannot be edited, so the correction
      lives where the next reader will be). The test is kept for what it does
      prove: the idempotent path holds when two transactions genuinely overlap.
      **:8707's standing lesson, incurred again — a claim about the artifact is
      verified against the artifact, not against intent.**

## Org slice — T3 round 2 Lows (2026-08-18, diff-only round; ZERO Critical/High, the packet SHIPS)

Both are paperwork, both are mine, and both are the same class the round-1 entry
above already records: **a record is a claim.** Fixed in the round that found
them; neither bought another round.

- [x] **L-1 (V2) — the clinic-parking line cited the wrong entry.** It pointed at
      DECISIONS :10010, the parent card, when the ruling itself is at :10248 —
      which the commit message and the index line both had right, so the OWED
      line was the one copy that drifted. Citation corrected. The rule it breaks
      is V2's own point: an index or a parent heading is a POINTER, and a
      citation has to land on the ruling.
- [x] **L-2 (R7.1) — two comments said the clinic consent gate lives "in the
      service layer"; it lives in the repo.** One is mine (`repo.ts`), one has
      been in `tenancy.ts` since `0001_init` and simply described where the gate
      was EXPECTED to live rather than where it landed. Corrected in BOTH
      places, because a correction applied to one copy is half a correction
      (:5748's lesson). Kept despite being borderline out of scope for a
      diff-only round: the C/H-2 argument rests entirely on that gate still
      biting, and the new legacy-clinic test is what pins it — a next reader
      sent to the wrong file would conclude the guard was gone.

**Recorded, NOT scored as a finding** (the reviewer's, and worth not
rediscovering): `alreadyHolds` plus a concurrent account self-deletion could in
principle let one join skip the seat cap — it needs the user to delete their own
account between two statements of their own join. The only writer of
`removed_at` today is `users/repo.ts:281`. Unreachable in practice, no cap exists
yet anyway, and the fix would cost more than the hazard.

## Console screen — T3 round 1 (2026-08-18, DECISIONS :10596)

Seven Low, all FIXED in the same round (:5348 rule 1 — a Low buys no further
review round and is still fixed). Commit: the fix round on `web-repoint`.

- [x] **L-1 (R7.3) — the join-code list had no bound**, the only list in the orgs
      module without one while `/mine` is capped and the roster is keyset-paged.
      Unreachable today (a gym has exactly one code) and `POST /codes` is already
      owed. `ORG_CODES_LIMIT = 100`, with its own OWED line for the cursor.
- [x] **L-2 — a gym named "New" slugged to `new`, which the console's own router
      already spends.** `/console/new` is declared ahead of `/console/:orgSlug`,
      so that gym appeared in its owner's list and clicking it landed them on the
      blank create form — with no way in, and no later repair, because a slug is
      minted once. `RESERVED_SLUGS` suffixes rather than rejects (the owner named
      their gym something reasonable and should not be told the name is taken).
      Only words the router SPENDS TODAY are reserved; reserving `settings` or
      `billing` for routes that do not exist would be inventing them.
- [x] **L-3 — `Promise.all` collapsed two INDEPENDENTLY-AUTHORISED reads.** §2.2
      grants a trainer Invite while the roster is held back, and the API is built
      that way with a test proving one trainer gets 200 on codes and 403 on
      members — collapsed, that trainer lost the WHOLE gym screen to the roster's
      refusal, under a Try again that could never succeed. `allSettled`, one
      outcome per pane. Unreachable today (no route creates a trainer row), fixed
      anyway: a screen that cannot express a guarantee the API really makes is
      the client half of the same defect.
- [x] **L-4 — the console showed the OLDEST join code.** Right today (there is
      one) and wrong the moment rotate/expire lands, when a rotated gym would
      keep handing out the retired code. `codeToShow` picks the first LIVE one
      and falls back to the oldest, so a gym whose only code is paused still SEES
      it with its state rather than being told it has no code.
- [x] **L-5 — "1 member" directly above "Nobody has joined yet".** Both sentences
      TRUE (the one membership is the owner's own complimentary seat, §4.0 step
      6) and together they read as a contradiction. Fixed by saying whose it is —
      "1 member (you)" — rather than changing either number.
- [x] **L-6 — raw database vocabulary on screen** (`gym`, `owner`). Mapped to
      display words, and fixed at BOTH sites: the review named `Overview.jsx`,
      and `ConsoleHome.jsx` printed the same raw role (:1239, the class not the
      case). Unknown values render as themselves rather than being relabelled,
      and the lookup is `Object.hasOwn` so a role of `toString` cannot resolve to
      `Object.prototype`.
- [x] **L-7 — no console response was parsed against the `@app/shared` schemas
      that define it.** This is the one with reach: a 200 missing `orgs` became
      `[]`, then `notFound`, then "we couldn't find a gym you run at this
      address"; a 200 missing `items` became an empty roster and "nobody has
      joined yet". **Both are the empty-vs-failed defect arriving through the
      PARSER rather than the network** — the same class two of this card's own
      mutants already guard on the network side. Fixed across ALL FOUR reads
      (the review named one), with its own message, because a contract failure is
      not a network failure and "check your connection" would send a person to
      fix the wrong thing.

**Rule-4 tests that stayed green when their subject broke, all three fixed:**
`does not submit without a name` exercised the button's `disabled` attribute and
survived deleting the `canSubmit` guard; the timezone prefill asserted only
`/^Asia\//`, which `timezoneOptions` puts at index 0 anyway, so a prefill reading
`zones[0]` would have passed; and nothing pinned the wizard's default country at
all — which is why the Critical/High shipped.

**Recorded, NOT scored as a finding:** the reviewer noted `manager` appears in
zero API tests (grep-verified). No route creates a manager row, so it rides the
staff-route owed line — but the TEST gap itself had no line, and now has one.
