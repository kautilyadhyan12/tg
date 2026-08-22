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

## Console screen — T3 round 2, diff-only (2026-08-19, DECISIONS :10726)

Four Low, all FIXED in the round that found them. Zero Critical/High, so the
packet ships (:5348 rule 1).

- [x] **Low-1 — a line citation in `DECISIONS-INDEX.md` went stale inside the
      commit that moved it.** The fix-round insert pushed the two-doors ruling
      off `:10596`, and `:10596` is now round 1's own sub-heading — so the
      pointer **failed silently by landing on a real heading** rather than on
      nothing. It then moved twice more the same day (:10695 → :10715 →
      :10824) as further sections were inserted above it. The index's own header
      already says to re-derive line numbers with `grep -n "^## "`; this is what
      it is warning about.
- [x] **Low-2 — round 1 recorded the WRONG CAUSE for its own fixture defect.**
      It said run 2 would lose the slug race and fail; the shipped assertion
      tolerates a suffix and says so, so run 2 would have passed. The real
      breakage is `gyms.owner_user_id` having no `onDelete`, so a surviving gym
      makes cleanup's user DELETE raise 23503 and **all 46 tests** fail. Struck
      in place. Load-bearing: a later chat reading the wrong version would take
      the prefix tolerance for the protection and drop the owner half of cleanup.
- [x] **Low-3 — "(you)" was inferred rather than checked.** True only while the
      sole `INSERT INTO gym_staff` in the tree writes `owner`. A manager opening
      a new gym would have been told the owner's seat was theirs. The viewer is
      now passed in and compared; an unknown viewer gets the plain count.
- [x] **Low-4 — the L-3 fix closed one half of its own finding.** It stopped one
      refused read taking the whole screen and left the refused pane offering a
      **Try again over a permanent 403**. Only 403 is treated as permanent, with
      the reasoning written beside it. Second half: when both reads fail — the
      ordinary offline case — the split stacked two identical error cards with
      two buttons; the duplicate is suppressed and the panes stay independent.

**The round's own near-miss, worth more than any of the four:** the Low-3 rewrite
**dropped a truncation guard**, so a page-of-one out of a roster of hundreds
would have read "1 member (you)" — a wrong number on screen. Caught by
`leaves every other case exactly as it was`, a round-1 test. :6277's class (a fix
creating a defect) for the SECOND time in this card, and both times the catch was
a test written earlier rather than the author re-reading their own work. `C19`
now re-breaks it deliberately.

**Instrument, recorded not scored:** `corepack pnpm exec vitest` intermittently
prints `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "vitest" not found` inside an
otherwise successful run — seen by the reviewer and in this chat's own runs. It
is fail-safe (the harness refuses to score a run with no tally) and pre-existing.
It is a datapoint for the local-Postgres line in `OWED.md`, whose saving remains
UNMEASURED — no number is quoted for it here.

## 2026-08-19 — the crossing packet, T3 round 1 (DECISIONS :11616 / :11706)

**ZERO Critical/High — the packet SHIPS (:5348 rule 1). Eight Low, ALL FIXED**
(rule 1: the severity gate changes the SCHEDULE, never the quality bar).

- [x] **L1 — a liar test, and its own comment claimed otherwise.** `signing out
      is not a skip` never clicked anything: it rendered the wizard and asserted
      "Basic Info" present and "MEMBER APP" absent, both true of a page nobody
      had touched. **The reviewer PROVED it** — he turned `handleSignOut` into
      `navigate('/dashboard')`, a real skip, and it stayed GREEN while only its
      sibling went red, on a claim the sibling does not make. Fixed by clicking,
      and by moving the distinct assertion (never lands in the member app) after
      the press. **Its own mutant is now KEPT as D17** — a mutation-found hole
      closed without a mutant is the same hole with a comment on it (:5104 F5).
- [x] **L2 — an `it.each` case that did not drive what its name said.** Picking
      the two sign-out controls by `[0]`/`[1]` meant that under D12 (the rail
      becomes a link) the case named "from the desktop rail" silently drove the
      PHONE BAR and passed, while `[1]` came back undefined and the other case
      caught it. No defect hidden; a red run would have named the wrong surface.
      Now found by `closest('aside')`, and a missing control throws by name.
- [x] **L3 — `landingRoute.js` still described the deleted link.** Its comment
      said an un-onboarded owner meets the wizard on "the first tap on 'Back to
      the app'". Four call sites read that block for their rule. Now names the
      member DOOR, with the supersession dated.
- [x] **L4 — the same dead mechanism justifying `Onboarding`'s exit.** The
      conclusion (`/dashboard` unconditionally) became MORE true when the link
      went, and the stated reason evaporated. Corrected in place, both halves.
- [x] **L5 — `ConsoleLayout`'s own header contradicted its own diff**: "the rail
      carries the brand and the way back into the app" is precisely what was
      removed. Now "the way OUT".
- [x] **L6 — the DoD's lint box could not be ticked.** `Zap` (Sidebar) and
      `Ruler` (Onboarding) were unused. **The "HEAD baseline" claim was honest
      and the reviewer verified it independently**, but a true baseline is not a
      clean gate — and the packet had already removed `Building2` from that same
      Sidebar import line while leaving `Zap` beside it. Both deleted; `eslint`
      on all six touched files now exits 0 with no output.
- [x] **L7 — a deferral living in DECISIONS prose alone**, which is the shape
      CLAUDE.md names as how work gets silently lost. :11706 states outright that
      the "phone" check was a narrowed desktop window, and :9604 §4 is Kd's
      ruling that the console is reached from a phone. **Now its own 🟡
      `OWED.md` line** — pre-existing gap, made visible by this packet rather
      than created by it.
- [x] **L8 — three Sign outs with no pending feedback, and one real hang.** The
      member sidebar wraps its own in `triggerTransition`; these two shells have
      no overlay, so a slow press looked like a dead button. Worse, **`authApi`
      sets no global timeout** (verified — `nutritionApi`'s `TARGETS_TIMEOUT_MS`
      exists for exactly this gap), so a server that ACCEPTS the request and
      never answers leaves `await logout()` pending, its `finally` unreached and
      the navigation never fired — **on two screens where Sign out is the only
      control**. Fixed both ways: a `signingOut` state that disables and relabels
      the button, and `LOGOUT_TIMEOUT_MS` on the logout request following the
      existing per-request precedent rather than a new mechanism. On timeout the
      request rejects, which is the good case — `logout()`'s `finally` still
      clears the client state, so it degrades to a client-side sign-out rather
      than a frozen screen.

**Rule 4 list, from the reviewer:** L1 and L2 were the only liars in the new
file; the two absence assertions and the sidebar non-vacuity pair all failed
correctly under his mutation.

**Instrument note, not scored:** the reviewer independently re-derived the
`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` flake already recorded on the previous
round — it recurred in this chat's runs too, and remains fail-safe.

## 2026-08-19 — the join door, step 1 (server half), T3 round 1 (DECISIONS :11846)

**ZERO Critical/High — the packet SHIPS** (Part I §2.5 rule 1). Four Low, **all
FIXED in this round**, plus one item the reviewer raised inside his security
pass rather than as a numbered finding and which is fixed with them. A Low buys
no further round; it does not buy a pass either.

**L-1 · a test that stays green (rule 4) · `orgs.routes.test.ts`.** "every route
requires authentication" named FIVE of the module's NINE routes and **none of
the four this card added** — measured, not argued: the reviewer deleted
`app.authenticate` from the confirm route and the test stayed GREEN. Low rather
than Critical because every handler calls `requireUserId`, which throws when the
preHandler did not run, so a missing guard is a 500 and not an open door.
**Fixed:** four 401 assertions added, plus the trainer-403 case on REJECT, which
runs through the same `requirePrivilege` call as confirm and had none.

**L-2 · R7.3 · `orgs/repo.ts`, the confirm queue's cursor.** A well-formed
cursor naming a row the gym does not have returned an **empty page while
`pendingCount` still reported the true total** — a console showing "3 people
waiting" over an empty list. Cause: the scalar subquery yields no row, so the
row comparison is NULL rather than false and NULL filters everything out.
Reachable today only by a gym's own staff hand-editing a cursor (nothing
hard-deletes applications — `grep 'DELETE FROM gym'` returns no hits), hence
Low. **Fixed** with a `NOT EXISTS` arm so an unknown cursor restarts at page
one, matching the convention the service already states out loud for a
MALFORMED cursor. Semantics verified against the live database, not reasoned.

**L-3 · R3.5 · `orgs/service.ts`, reject.** Confirm was idempotent by design
("a person pressing a button twice") and reject was not — a second tap 409'd.
The message was TRUE, so not :5807's class, but the asymmetry was never
designed and two front-desk staff working one queue is the case this card cites
everywhere else. **Fixed:** a second reject returns the same `{status:
"rejected"}`. Every other terminal state keeps its 409 — `confirmed` must not be
silently reversible, and `cancelled`/`expired` are facts the front desk should
be told rather than shown a success for something they did not do.

**L-4 · lock order · `users/repo.ts` vs `orgs/repo.ts`.** The card decides lock
order once — application, then gym — but the DPDP Day-0 cascade is a **third
writer of the same two rows and took them the other way**, so for a person
holding both a live membership and a pending application the two transactions
could form a cycle and Postgres would abort one with 40P01 (a 500 for the
loser; no data loss, both are all-or-nothing). **The reviewer marked the cycle
UNREPRODUCED and it stays unreproduced** — reproducing it needs two
transactions interleaved at one statement. What IS verified is the premise: the
two orders differed. **Fixed** by swapping the two statements so every writer
takes them in one order. The comment that described the moved statement moved
with it, rather than being left to describe its new neighbour.

**Security-pass note, not numbered, fixed here.** The permanent guard's check 5
asserted a **hand-written copy** of the spend-attribution query instead of the
real `getLiveGymId` in coach/geo/nutrition — a guard that cannot see the thing
it guards, so drift in any of those three would not have tripped it. Now calls
all three REAL functions (named individually, because R7.1 keeps them
module-local and "they are the same query" is the assumption that would hide
the drift), **with a positive control**: a CONFIRMED member must resolve to the
gym, or three null-returning functions would satisfy the whole check.

**Instrument note, not scored:** writing an explanation as a SQL comment INSIDE
the query turned six lines into parse errors — a backtick inside a JS template
literal ends the literal. The paragraph now lives above the query, which is
where it should have been.

## 2026-08-20 — the join door, step 2 (the two screens + REMOVE), T3 round 1

**The round did NOT ship the packet: two Critical/High.** Those are not logged
here (rule 1 — a Critical/High is fixed or it holds the packet); they are at
`DECISIONS.md`'s entry for this round. Six Lows, **ALL FIXED in the same round**,
none of them buying a round.

**L-1 · four wiring points asserted by nothing** — `App.jsx`'s `/org/join`
route, `pages/JoinGym.jsx`, the `Dashboard` card, and Settings → Gym. Every
component this card built was tested and **nothing asserted any of them was
reachable**: deleting any one left all 857 web tests green while the feature
vanished from the product. The same class the card exists to close, one level
up from the code it closed it in. **Fixed** with five source assertions in
`joinGym.render.test.jsx` (the repo's own precedent — `gamificationApi.test.js`
reads pages the same way), mutation-proved by deleting the Dashboard card and
renaming the route: 2 RED, both restored. **Their limit is stated in the file**:
they prove a page still NAMES the component, not that it renders. A page-level
render harness for `Dashboard`/`Settings` is a card of its own and has an
`OWED.md` line — this catches DELETION, which is the failure that happened.

**L-2 · the poster prefill was tested at the PROP, never at the URL** —
`<JoinGymPanel initialCode=…>` proves the panel honours the prop and says
nothing about where the value comes from. Renaming the query parameter
(`params.get('code')` → `params.get('c')`) sent every QR in existence to an
empty box with the suite green. **Fixed** by driving the real address through a
route: three tests on `/org/join?code=…`. Mutation-proved — the rename now takes
2 tests RED.

**L-3 · a failed removal dead-ended** — `<ConsoleFailed message={removeError} />`
passed no `onRetry`, contradicting `ConsoleStates.jsx`'s own stated contract
("a failure ALWAYS offers a way out", Part 3 §4). **Fixed** by passing
`reloadRoster`, which already clears the banner before re-reading, so the retry
both dismisses the error and settles whether the removal landed.

**L-4 · the consent question arrived as an error** — `JoinGymPanel`'s handler
says in a comment that `consent_required` "is a question, not an error", then
fell through to `setError`, so it rendered in the red AlertTriangle card sitting
above the checkbox it had just revealed. **Fixed** with an early return.
Unreachable today (no new clinic can be created, :10182), which is why it is Low.

**L-5 · a second poster kept the first gym's code** — `initialCode` seeds the
input at mount, which is correct, and React Router does not remount a route when
only the SEARCH string changes. So scanning a second QR left the first code in
the box, and the person asks to join the wrong gym. **Fixed** with `key={code}`
in `JoinGym.jsx` rather than an effect that would fight typing. Mutation-proved.

**L-6 · the card and the box disagreed an inch apart** — on Settings → Gym,
`GymMembershipCard` read once at mount, so the panel below could answer "You've
asked to join Iron House" over a card that still said nothing until a reload.
**Fixed** with a `refreshToken` prop bumped by the panel's new `onApplied`
callback. The Dashboard passes neither and keeps its single read.

## 2026-08-20 — the join door, step 2, T3 round 2 (diff-only): ZERO Critical/High, THE PACKET SHIPS

Four Lows and three lying tests, **all fixed in the same round** (:5348 rule 1;
none bought a round). The verdict is unchanged by them: zero Critical/High, and
the escape hatch is **NOT** armed.

**L2-1 · the removal card claimed something no gym has ever done.** "You keep the
free app; **the features your gym was paying for have ended**." Verified rather
than argued: **nothing in `apps/api/src` inserts into `subscriptions`** (grep),
and `entitlements/repo.ts` grants gym-sponsored entitlements ONLY through a gym
subscription in `('trialing','active','past_due')` — so no gym has ever paid and
a removed member loses nothing. The clause described a state no reader has ever
been in. **Fixed** by ending the sentence at "You keep the free app"; the clause
returns with billing, said by a screen that can check it.
**Severity note, because the reviewer put it to Kd rather than deciding it:**
under :5807 ("on screen AND wrong") this is arguably Critical/High, and calling
it so would have ARMED the redesign hatch, round 1 having found two C/H in this
same subsystem. It stayed **Low** on the grounds that nobody has ever been in the
state it misdescribes, no user action or number changes, and the wording predates
this card. **The fix is identical either way**, which is why it did not wait.

**L2-2 · a doc comment asserted an invariant that is false.** `listFormerOrgsForUser`
claimed a self-deleted account "cannot be in flight here … by definition a live
account". `restoreUser` reactivates such an account and **deliberately leaves
memberships closed** (P2.2 T3 finding 4 — auto-reopen could exceed seat caps),
and both windows are 14 days, so a restored user reads this list carrying a
`removed_at` they caused. **Nothing user-visible is false** — "You're no longer a
member of X" is true however it ended — which is why the fix is the COMMENT.
The sharp edge is recorded: an owner who deletes and restores is told they are no
longer a member of their own gym while the console still lists them as owner.
The durable fix is a reason column on `gym_members`, **not invented here** (R0.2).

**L2-3 · `formerOrgs` could name one gym twice.** `gym_members_live_uq` is
PARTIAL (`WHERE removed_at IS NULL`), so join → remove → join → remove leaves two
closed rows and the query had no `DISTINCT`. It broke `listOrgsForUser`'s own
promise one function above ("a caller can never render the same gym twice") and
was invisible only because the client dedupes by org id — a contract holding
because of what today's single caller happens to do. **Fixed** with
`DISTINCT ON (m.gym_id) … ORDER BY m.gym_id, m.removed_at DESC` in a subquery,
re-sorted outside. **It now has a test** (there was none), whose fixture asserts
two closed rows really exist before asserting one row comes back — mutation-
proved by deleting `DISTINCT ON`.

**L2-4 · the two reads of `/orgs/mine` were not one snapshot.** `Promise.all` over
two independent statements can straddle a commit: a removal landing between them
returns a response where the gym is in NEITHER list — the exact silence Kd's
ruling exists to end — or in BOTH, drawn as "You're a member" over a membership
that has just ended. **Fixed** by reading both inside one `sql.begin`, sequential
because one connection cannot run two statements at once. Both repo signatures
widened to `SqlOrTx`. **No test**: reproducing it needs a commit interleaved
between two statements, and a fake would assert nothing.

### Rule 4 — three tests that stayed GREEN when their subject broke

**T1 · the deploy-gap test tested nothing.** `joinGym.render.test.jsx`'s
"survives an API that does not send formerOrgs" mocks `orgService` wholesale, so
`readThrough` and the shared schema never ran — **deleting `.default([])` left it
green**, and the only real coverage was incidental, in an `orgsApi.test.js`
fixture a later chat could have "tidied" by adding `formerOrgs: []`. **Fixed** by
putting the real guard in `orgsApi.test.js`, pushing a body with no `formerOrgs`
through the actual parser, **plus a companion asserting a MALFORMED `formerOrgs`
is still rejected** — the default tolerates absence, not nonsense. The render
test was **renamed to what it actually does** rather than deleted. Mutation-
proved: removing the default takes 3 RED.

**T2 · the Settings wiring test missed the line that renders the tab.** It
asserted `id: 'gym'` and two component names that all live INSIDE `GymTab()`;
`{tab === 'gym' && <GymTab />}` could be deleted, the tab render empty, and all
three assertions pass — **the exact deletion failure L-1 was written to catch.**
**Fixed** with an assertion on that line. Mutation-proved: deleting it goes RED.

**T3 · `stripComments` only stripped line comments at the START of a line**, so a
trailing `// <GymMembershipCard />` would have satisfied a wiring regex over
deleted markup. **Fixed** to `(^|\s)//`, which cannot eat a URL because
`https://` has no whitespace before its slashes.

### One reporting correction, recorded because it was mine

Round 1's summary said eslint was "clean on every changed file". **It was not**
— `Settings.jsx` carries 4 pre-existing errors. The measured claim ("4 before,
4 after, none of them this round's") was accurate; the summarised one was not.
Round 2's figures name the files linted rather than generalising.

---

## The waiting room's clock — T3 round 1 Lows (2026-08-20, DECISIONS :12878)

Seven Low findings, **all fixed in the round that found them** (`CLAUDE.md`
Part I §2.5 rule 1 — the gate changes the SCHEDULE, never the quality bar).
The two Critical/High are not here: they were fixed and hold the packet.

**L1 · "You reminded them today" could be false.** `nudgeState`'s `ready` means
"24 hours since the last nudge", not "since midnight" — so a nudge at 23:00
Monday, read at 09:00 Tuesday, printed a sentence about today that was simply
untrue. **Fixed** to "You've reminded them in the last day", which is the rule
that actually produced the state.

**L2 · `nextNudgeAt` was added so the client would never invent a time, and then
went unread.** Both arms hardcoded "again tomorrow" while the server's own
instant sat in the response. On `already_sent` the next slot is often LATER
TODAY (nudged 13:00 yesterday, tapped 09:00 today). **Fixed**: both sentences
read the field. The render test's fixture was rewritten to the four-hours-out
case on purpose, so the assertion is one the old constant would fail.

**L3 · `nudgedLabel` claimed calendar days off elapsed arithmetic** — "yesterday"
at 25 hours, which is Sunday if you read it at 00:30 on Tuesday. Same class as
L1. **Fixed** to elapsed wording throughout ("1 day ago", "in the last hour"),
which matches how the server measures the same rule.

**L4 · the suite's header claimed an isolation it does not have.** The FIXTURES
are namespaced; the SWEEP is table-wide, and `vitest.config.ts` runs four suites
at once against one database — so `sweep(TTL * 3)` could expire the applications
`orgs.routes.test.ts` was midway through confirming. **A flake generator this
card introduced, and the two suites had only ever been run separately.** **Fixed**
by giving the sweep an optional `gymIds` scope, which `waitingGym()` now binds;
the header says what is true. **It also made every count assertion EXACT**, which
closes the same round's finding that a table-wide `toBeGreaterThanOrEqual(1)` is
satisfiable by a row the test never created.

**L5 · a comment described the wrong rows.** It said the three clock fields are
"undefined on every other kind by construction"; they are set on refused and
expired rows too — the suite's own `appRow('refused', …)` asserts it. What stops
a button appearing there is `nudgeState`'s `kind !== 'waiting'` test. Corrected
in place (:5748's rule — a correction goes where the false claim is).

**L6 · the smoke sheet told Kd to expect exact counts from a table-wide
command.** On a dev database with other leftover rows those numbers are higher,
and step 6 would expire unrelated requests. **Fixed before he ran it**: "at least
1", plus a warning naming which database the command touches.

**L7 · a dashboard component imported from a console PAGE module.** One helper
for both screens is right — it is what stops the two quoting different deadlines
— but `pages/console/consoleView.js` is not its home. **Fixed** by moving the
clock's words to `utils/joinClock.js`, with a re-export so the console's own
consumers and tests keep one name.

### Two weak instruments, both fixed

**`expect(afterRow).toBeDefined()` was missing.** `find` returns undefined when
a row has left the queue, and `expect(undefined).not.toBeNull()` PASSES — so the
assertions caught a dropped FIELD and would have said nothing about the row
vanishing, which is the larger failure.

**And one of my own fixtures failed the whole suite while reporting it green.**
`mockReturnValue(Promise.reject(…))` builds the rejected promise at setup time,
and nothing handles it until the click several lines later — so vitest printed
`906/906 passed` with `Errors 1` and **exited 1**. Caught by reading the exit
code rather than the summary; :5906's shape, and the reason that habit exists.
Fixed with `mockImplementation`, which builds it at call time.

## The waiting room's clock — T3 round 2 Lows (2026-08-21, DECISIONS :13247)

Five Low findings, **all fixed in the round that found them**. The one
Critical/High is not here: it was fixed and held the packet.

**L1 · round 1's own fix left DEAD CODE, and four documents called it
load-bearing.** The expiry guard's first arm
(`gym_notified_at <= expires_at - notice`) is implied by its second
(`<= now - notice`) whenever `expires_at <= now`, which the statement always
requires — so it could never decide anything. **Proven twice**: the reviewer
deleted it and the suite stayed 18/18 green, and an exhaustive check over the
three dates finds no case where the first holds and the second does not. The
sentence "arm 1 must not simply be deleted — two tests go red" was TRUE of the
arm before round 1's fix and FALSE of the arm that fix produced, and it was
copied into `sweep.ts`, `DECISIONS.md`, `HANDOFF.md` and the index **inside the
same commit that made it false**. **Fixed**: arm deleted, guard is one
condition, claim struck in all four places, and mutant O56 re-aimed at the
notice subtraction — where the guarantee actually lives.

**L2 + L4 · `joinClock.js` had no unit test, and that is what hid the
Critical.** Its two new functions were reached only through render tests at two
convenient values, leaving every bucket boundary unpinned: a mutant widening
`hours <= 12` to `hours <= 20` left 150 tests green — **precisely the window the
Critical lived in**. **Fixed** with `joinClock.test.js`, every test aimed at a
boundary or a refusal, including local midnight one minute either side.
**My first draft of it failed for the finding's own reason**: I wrote the case in
UTC and this suite pins `Asia/Kolkata`, where those instants are the same local
day. The corrected case is cross-day in the VIEWER's zone, which is the only
thing "today" and "tomorrow" can mean.

**L3 · the gate I quoted was true of a RUN, not of the SUITE.**
`console.render.test.jsx` pinned its clock exactly on a day boundary while
`shouldAdvanceTime` lets real milliseconds elapse before the render — measured,
one millisecond turned "Expires in 11 days" into 10. The reviewer ran the web
suite three times and got **905/906 exit 1** on one of them. **Fixed** by pinning
half an hour inside the day; re-proved with three consecutive clean runs
(919/919, exit 0 each). **Second instrument finding on this card about believing
a number without the run behind it.**

**L5 · recorded, not actioned.** The C/H-2 transaction now holds row locks across
N sequential audit inserts. Correctness is strictly better than before; the cost
is lock duration on a table the console writes to, and it belongs with the
existing no-batch-limit `OWED.md` line rather than a second one.

## The waiting room's clock — T3 round 3 Lows (2026-08-21, DECISIONS :13336)

Five Low findings, **all fixed in the round that found them**. The two
Critical/High are not here: they were in the mutation harness, and they held the
packet.

**L1 · round 2's own correction landed in three documents and missed the
fourth — the one with the code in it.** `sweep.ts` still laid the expiry guard
out as TWO live bullets, still said "both arms" in four places, and said round 2
"DELETED THE SECOND ARM" when the survivor IS the second arm — contradicting its
own next sentence and the code three lines below. `HANDOFF.md` and the index had
been corrected properly. **Fixed** in place. :5748's rule with a sharper edge:
the place a correction gets missed is the file you were not editing at the time.

**L2 · a second un-struck copy in `HANDOFF.md`, and it was backwards.** "Dropping
arm 1 → a late-flagged row can never die at all" — dropping arm TWO is what would
strand such a row, and arm one turned out to be dead code. **Fixed**, struck with
both errors named.

**L3 · the tomorrow / in-a-couple-of-days boundary was unpinned.** The reviewer's
mutant `days === 1` → `days <= 2 && days >= 1` — a slot two local days out
announced as "tomorrow" — left all 163 tests green. **Same shape as the gap that
hid round 2's Critical, in the file written to close it.** **Fixed** with a case
either side of the boundary, verified RED under that exact mutant, source
restored and hashed. **My first draft of the fix failed for the finding's own
reason**: I wrote the instants in UTC while the suite pins `Asia/Kolkata`.

**L4 · fake timers leaked on failure.** Three tests called `vi.useRealTimers()`
as their last statement, which a failing assertion never reaches — one red test
would freeze the clock for every later test in the file. A flake generator inside
the fix for a flake. **Fixed** by moving it into `afterEach`, and **proven** by
injecting a failure into the first clock-pinning test: `1 failed | 52 passed`,
no cascade.

**L5 · `joinClock.js`'s header stated an absolute the file deliberately breaks.**
"ELAPSED TIME, NEVER CALENDAR DAYS", with `nextNudgeText` reading the calendar on
purpose forty lines below. The function's own docblock carved it out; the header
did not — and the absolute version of that rule is what produced round 2's
Critical. **Fixed**: the exception is declared where the rule is stated.

### And one the sweep found rather than the reviewer

**O48 came back ALIVE after its re-anchor, and the survival was correct.** The
mutant deleted `AND gym_notified_at IS NOT NULL` alone — which round 2's Low-1
had made redundant, since the surviving notice comparison is itself NULL for an
unflagged row and filters it out anyway. **A no-op mutation reporting ALIVE says
nothing about coverage** (:12878's own lesson: ask whether the guarantee is
OBSERVABLE before assuming a test is missing). Re-aimed at BOTH conditions
together — which is what actually carries "the gym must have been told" —
and re-run **RED**.

## The waiting room's clock — T3 round 4 Lows (2026-08-21, DECISIONS :13421)

Five Lows, **all fixed in the round that found them**. The Critical/High is not
here: it held the packet.

**L1 · "Asked today" about somebody who applied last night.** Same cause as the
Critical, past tense — a calendar word computed from floored elapsed
milliseconds. Low by :13281's line (a wrong WORD about the past, no number and
no action changes) and fixed by the same rule: `waitingForLabel` now asks the
calendar for its day word and counts elapsed time for its duration.

**L2 · the header declared ONE exception to a rule that three functions broke.**
Round 3's fix was right about `nextNudgeText` and stopped there. **Fixed** by
replacing the exception with one rule the whole file obeys.

**L3 · `sweep.ts`'s prose named a DEAD condition as the guard — third round
running.** The reviewer measured it: delete `gym_notified_at IS NOT NULL` and
the sweep suite still passes 18/18, because an unflagged row's notice comparison
is NULL and filters it out anyway. **The correction reached the harness, BACKLOG
and HANDOFF in round 3 and missed `sweep.ts` again** — :5748 for the third time,
always in the file nobody was editing. **Fixed** with the measurement written in;
the condition stays as an explicit restatement, but is no longer called the
enforcement.

**L4 · two overclaims of mine from round 3, both checked.** The comment said
`useRealTimers` was moved out of the test bodies — it was ADDED to `afterEach`
and the three in-body calls were still there. And the "1 failed | 52 passed"
proof **reproduces identically with the teardown removed**, because no later test
in that file is date-sensitive: a real measurement that proved nothing (V1).
**Fixed** — calls deleted, claim reworded to what was actually shown.

**L5 · the permanent guard was a case fix, and the reviewer said so when asked to
judge it.** `node --check` named ONE file; ~~the repo has **18** mutation
harnesses~~ **— STRUCK by round 5's Low-4: 18 is the count of `.mjs` files in
those directories, FOUR of which are not harnesses at all, and it omits the three
`.sh` harnesses entirely. Counted by command: 14 `.mjs` + 3 `.sh` = 17 mutation
harnesses** — and the ones outside `apps/web` were parsed by nothing.
`turbo.json` also omitted `tools/**` from the lint inputs, so a harness-only fix
round left the cache valid and skipped the check locally. **Fixed** with
`apps/api/scripts/check-harnesses.mjs`, which WALKS the directories (a harness
added tomorrow is covered), treats an empty walk as a failure (:4855's shape),
and is proven by breaking a web harness the old guard could not see — 1 of 18
broken, exit 1; restored, 18 parse, exit 0. **The `turbo.json` half was only half
a fix and round 5's Low-6 finished it.**

### And two tests that were asserting the defect

`consoleView.test.js` demanded `waitingForLabel(..., +23h) === 'Asked today'` —
08:00 the next morning — and the console render test's countdown expected the
floored value. **That is the round-4 finding written down as an expectation, and
it is how a wrong rule survives four reviews.** Both corrected to the rule.

## The waiting room's clock — T3 round 5 Lows (2026-08-21, DECISIONS :13552)

**Nine Lows, ZERO Critical/High — the round that shipped the packet.** All nine
fixed in the round that found them (:5348 rule 1: the gate changes the SCHEDULE,
never the quality bar). Four of the nine are prose that round 4's own fix
falsified, which is the shape to expect after a STRUCTURAL fix: the code moves
and the sentences about it do not.

**L1 · "Waiting 1 day" about a request two minutes old.** The rule at the top of
`joinClock.js` names THREE day words and `waitingForLabel` implemented two — with
no "yesterday", a midnight crossing fell through to the duration and the floor
rounded it up. Measured in the pinned zone: applied 23:59, read 00:01 →
"Waiting 1 day"; at 1 h and 13 h the same. **Reachable by every evening applicant
on the morning after they applied.** **Kept Low and the call is recorded, not
buried:** it is a wrong NUMBER on screen, which :5807 names Critical/High, and
the reviewer said so before choosing Low on :13281's own line (a wrong word about
the past; nothing acts on it) — the identical judgement round 4 made about the
identical function. Kd was shown the alternative and its cost (a C/H tag arms the
escape hatch and demands a redesign of the file round 4 had just redesigned) and
chose Low. **Fixed** with the third day word.

**L1a · the review's proposed one-line fix was MEASURED AND REJECTED, and this is
the part worth keeping.** It was "add the yesterday branch, then drop
`Math.max`", on the premise that two calendar days apart implies a whole day
elapsed. **False across a spring-forward day:** in `America/New_York`, 7 Mar 2026
23:59 → 9 Mar 00:01 is **23h02m**, which floors to ZERO — the fix would have
printed "Waiting 0 days" twice a year in every DST zone, in the round that
existed to stop the screen saying false numbers. The floor STAYS and now fires
only in that corner, where "1 day" is the honest reading of 23 hours. Pinned by a
test that switches zone (restored in `afterEach`, and the restore is asserted),
with a positive control proving the assertion is about the transition and not
about any zone at all.

**L2 · the rule's own DURATION example was wrong about this file.** It named
"in 11 days", which `expiresInLabel` computes from a COUNT OF CALENDAR DAYS —
correctly, since it is the tail of the same sentence as "today" and "tomorrow".
**Fixed**: the example is now one the file really treats as elapsed, with the
reason recorded so nobody re-classifies the countdown.

**L3 · "the two screens cannot quote different deadlines" stopped being true.**
Once the countdown moved to the reader's calendar, one `expiresAt` at one instant
reads "Expires tomorrow" in Kolkata and "Expires today" in London and New York —
**measured across three zones**. Each is true where it is read; the absolute claim
was not. **Fixed** in both places it appeared (the file header and
`expiresInLabel`'s own doc), qualified to what the shared helper does guarantee:
one reader never sees two answers.

**L4 · the harness guard skipped three harnesses and the count was wrong in five
documents.** Its first line says EVERY mutation harness; it looked only at
`.mjs`, so `mutate-exercise-library.sh`, `mutate-postworkout-summary.sh` and
`mutate-workout-calendar.sh` were parsed by nothing. And **"18 mutation
harnesses" was never true** — 18 is the `.mjs` count in those directories, four of
which are tools rather than harnesses. **Counted by command: 14 `.mjs` + 3 `.sh`
= 17.** **Fixed**: `.sh` checked with `bash -n`, the label corrected everywhere it
was quoted, and the guard now reports what it CHECKED (22 scripts) rather than a
name for it.

**L5 · the walk missed the directory the guard lives in, and did not recurse.**
**Fixed**: `apps/api/scripts` added and the walk made recursive. **Said rather
than glossed — the recursion has no observable subject today**: no harness lives
in a subdirectory (the only nested one, `apps/api/tools/migrate-mongo`, holds
`.ts`), so the mutant that stops it recursing is **ALIVE** and reports the same 22
files. It is future-proofing, not a guarded guarantee, and this line is the
honest record of that (:12343's lesson — ask whether the guarantee is OBSERVABLE
before assuming the test is missing).

**L6 · round 4's cache fix was half a fix.** The check ran only from `api#lint`,
whose cache inputs are **172 files with not one outside `apps/api`** — measured
with turbo's own `--dry=json`. So breaking any of the 16 harnesses that live in
`apps/web`, `packages/` or root `tools/` left a warm `turbo run lint` free to
replay a cached pass without ever running the guard: exactly the harness-only fix
round that rounds 2 and 3 were. **Fixed** by invoking it from the ROOT `lint`
script, before turbo, where no cache decides whether it happened — **proven by
breaking a web harness and watching root lint exit 1 at the guard with turbo
never reached.** Not duplicated in `api#lint`, and its `package.json` says why.

**L6a · the narrowing guard's first draft could not fail, and its own audit
caught it.** It asked "for each entry in `CHECKERS`, did the walk find one?" —
so deleting the `.sh` checker deleted the expectation with it: measured, "19
scripts parse", exit 0, three harnesses silently unguarded. **:5104 F5's shape,
inside the fix written for exactly that class.** Fixed by declaring
`REQUIRED_KINDS` separately from the checkers; the same mutant is now RED.

**L7 · the expiry boundary instant was unpinned, and the reviewer's mutant
survived because of it.** Both neighbours of `expiresAt` were tested and the
instant itself was not, so loosening `<=` to `<` left all five clock suites
green while the exact deadline flipped to "Expires today". Code was right, the
test was missing. **Fixed** — the mutant now dies on the new test alone.

**L8 · a comment reasoning in UTC in a suite pinned to Asia/Kolkata.** The
explanation said "23 hours after 09:00 — 08:00 the NEXT morning"; locally those
instants are 14:30 and 13:30. Assertion right, explanation wrong — the same
UTC/local slip that broke two earlier drafts on this card. **Fixed** by stating
the local times.

**L9 · a pinning note that outlived half its reason.** The 09:30 pin says "both
figures here are floored day counts"; only the waiting figure still is, and the
countdown's boundary is now local midnight, nowhere near 09:30Z. The pin stays
justified — by half the stated reason. **Fixed** by narrowing the sentence.

---

## 2026-08-21 · Kd's join-code smoke — instrument findings (DECISIONS :14013)

Not review findings: nobody had run a T3 on this packet yet. These came out of
the mutation audit :5348 rule 4 makes mandatory, and they are about the AUDIT'S
OWN INSTRUMENT rather than the product.

**L1 · three mutant anchors were broken by the change under test, and the
harness aborted on ONE PER RUN.** O21, O26 and O60 all anchored on text the
count subquery re-wrote (`gym_codes` became `gym_codes AS c`). The abort is
correct and is :5199's class fix — a no-op mutation must never be read as a
missing test — but discovering them one at a time cost three full harness
startups. **Fixed for this card by writing a whole-file anchor checker** that
reports every `from` matching its target other than exactly once, in one pass.
It lives in the scratchpad, not the repo: promoting it is a real change to two
harnesses and belongs to a card that is about them, not to this one (R1.1).
**Worth promoting** — `node --check` (:13336) proves a harness PARSES, and
nothing yet proves its anchors still POINT anywhere.

**L2 · O17 and O29 each match their target file TWICE (pre-existing).**
Verified against `HEAD`, so neither was introduced here. `String.replace` with a
string pattern takes the FIRST occurrence, which in both cases is the intended
site — O17's `if (held === null) {` in `claimSeat` (the second is a deeper-indented
line that merely contains it), O29's application lookup in the confirm path
(reject holds the second). **So both mutants still test what they claim**, and
the risk is drift: an edit above either site would silently re-point the mutant
rather than abort. Not fixed here (R1.1 — this card changed neither site).

---

## 2026-08-21 · T3 round 1 on the three join-code commits — 10 Lows, ALL FIXED

**VERDICT: 0 Critical/High → the packet SHIPS** (:5348 rule 1). No redesign
trigger — round 1, nothing to repeat. Ten Low findings, every one fixed in the
same round, because a Low buys no further round and is still fixed. Fixed in
commit named at the end of this block.

**The reviewer's own instrument work is worth keeping**: they ran a mutation
themselves rather than reading, which is what turned L-1 from an opinion into a
measurement — `onSaveLimits` shorn of `expiresAt`, 101 tests still green.

| # | What | Fix |
|---|---|---|
| L-1 | **The per-code Limits editor was reached by NO test.** Proved by mutation: dropping `expiresAt` from its save left 101 tests green. C26 guards this exact class on the PAUSE switch; the control beside it had nothing, and :13920 claimed it was guarded. | Four render tests (both-fields, refusal, past-date, changed-past-date) + mutants **C33/C34/C35**, all RED. |
| L-2 | `DELETE …/codes/:code` missing from the 401 list — whose own comment says the list exists because "a card can add routes and leave this list naming the old ones". Second time. | Added beside the other four. |
| L-3 | `createCode`'s comment claimed one transaction made the cap safe. **Under READ COMMITTED it does not**: two staff both read 99, both insert, and the 101st code is invisible to `listCodes`' `LIMIT` while the door honours it. | **Made the claim TRUE**: `lockOrgRow` (§4.2's own instrument, same row, same order) in `createCode` and `rotateCode`; two-client race test; mutant **O71**. |
| L-4 | `updateCode`'s comment implied `FOR UPDATE OF c` covered the live count — it cannot, `joined` comes from `gym_members`. | **Comment corrected, code left alone**, with the reason stated: the race is self-healing (a code reads "Fully used" early, revives when anybody leaves) and the fix would serialise an owner's typing against every confirm in the gym. |
| L-5 | `ORG_CODES_MAX`'s comment still said "retired codes count" and "delete an old code is a real feature request" — both made false by removal shipping in the same diff. | Rewritten against `0012`. |
| L-6 | `whyNotUsable`'s exhausted sentence ("used the number of times you allowed") described the retired `uses` semantics and implied the state was permanent. Reviewer weighed C/H under :5807 1a and landed Low — no number, and true when shown. | Reworded to name people who are IN and say it lifts when somebody leaves; the test now asserts the CLAIM, not the phrasing. |
| L-7 | `save()` closed the editor before the await, so any refusal discarded the owner's edits. The create form does the opposite. | `run()` now answers whether the change landed; the editor closes only on success. Mutant **C34**. |
| L-8 | `removeOrgCode` returned a bare `{ removed: true }` — the only answer in the module not parsed through a shared schema. | `removeOrgCodeResponseSchema` in `@app/shared`, parsed on the way out, `{ status: "removed" }` like its sibling. |
| L-9 | A test titled "leaves a value it cannot read alone" asserted the opposite. Behaviour fine, title wrong. | Renamed to what it asserts, with the reasoning. |
| L-10 | Opening Limits on an EXPIRED code seeded the past date, so saving a limit change was refused over a field the owner never touched (and, per L-7, lost the edit). | An UNTOUCHED past date is omitted from the PATCH; a date they DID change still travels and still gets refused. Mutant **C35**. |

**Two instrument guards fired while fixing these, both worth the noise:** a first
draft of C33 mutated to `if (false)` before a `const` — a SyntaxError, which the
harness caught as "no test tally" rather than reporting a false RED; and C35's
`expect` filter carried a curly apostrophe copied from its test's title, which
the harness refuses outright because `-t` would match nothing and the mutant
would look ALIVE. **Neither guard was written for this card.**

**Also learned and worth carrying: the web harness has NO scoping flag** — no
`MUTATE_ONLY`, no `--only`. It always runs all 35. The api harness reads
`MUTATE_ONLY` from the environment (`--only=` is silently ignored there too).

## Staff card, T3 round 1 (2026-08-22) — DECISIONS :14401

Three Critical/High, all fixed in the round (they hold the packet; they are not
logged as Low). **One Low, fixed here:**

| # | Finding | Fix |
|---|---|---|
| L-1 | `orgStaffSchema.email` serves the address as it is TODAY, not the one the owner typed to appoint somebody — so a later address change is disclosed without the owner ever asking. §2.4's never-see list does not cover contact details either way, and the list is owner-only, so nothing is wrong on screen. | Named on the join screen's "What {org} can see" sheet when the Staff screen lands — carried on that card rather than fixed in the server half, since the sheet is a web surface. |

**The two audit survivors are NOT Low findings and are recorded in the DECISIONS
entry instead**, because both are facts about the fixes rather than defects:
**O86** had no subject until a staff row with no membership existed to give it
one, and **O3** is double-covered now that the owner is excluded as staff as well
as complimentary.

## Staff card, T3 round 2 (2026-08-22) — DECISIONS :14493

One Critical/High (missing coverage on correct code) — fixed in the round with
permanent guards, so it is not logged here. **Two Low, both fixed:**

| # | Finding | Fix |
|---|---|---|
| L-1 | Two test titles promised "…and puts their seat back" / "…and removing them takes it back". Neither body checked the return half, and round 1 had deleted the flag assertions that used to stand in for it. Behaviour was correct; the suite over-claimed. | One title trimmed to what it checks; the other claim now genuinely tested against the seat cap — remove the trainer, the gym is over its one paid seat again, the next applicant is refused. |
| L-2 | `listStaff` had no eligibility filter, so after round 1's C/H-3 fix it disagreed with `getStaffRole`: a deleted account came back as `"role":"manager"` while its authority was already null. **The row was TRUE before the fix — the fix is what made it false.** Low only because no Staff screen exists yet (grep-verified: no staff call in `orgsApi.js`, no Staff tab). | The eligibility test written out in BOTH readers — duplicated deliberately, since a shared `sql` fragment is R3.8's forbidden shape — and anchored by a test that drives both and asserts they agree row for row. Mutant **O91**. |

**Carried forward as a harness improvement, not fixed here:** the whole-table
pre-check asks "does this anchor match?" and cannot ask "does it match ONCE".
`listStaff` and `getStaffRole` now share SQL text, so O85/O86's one-line anchors
matched twice and hit the intended function only by position (:11846's O14).
Both were re-anchored; the harness gap is real and wants a uniqueness check.

## Staff SCREEN (web half), T3 round 1 (2026-08-22) — DECISIONS :14840

**Two Critical/High, fixed in the round with permanent guards (S13/S14/S15), so
they are not logged here. Five Low, all fixed:**

| # | Finding | Fix |
|---|---|---|
| L-1 | The four staff endpoints were the ONLY reads on `orgsApi.js` not parsed under test. Deleting `readThrough` from `getStaff` left 223 tests green, and the consequence is the console's oldest defect arriving through the parser: no `staff` key → `[]` → the screen prints a number about who runs a gym that nobody wrote. | Five contract tests, one per shape — a non-list, a row missing the fields the screen prints, both mutation answers, and the removal. |
| L-2 | `if (!allowed) return null` in `StaffPanel` was S11's SIBLING: delete it and every console test stayed green, because `Settings.jsx` never mounts the panel for a non-owner. Two guards in one file, and making the first observable left the second exactly as it was. | Mounted directly with a non-owner role, asserting an empty container, with a positive control so a panel that rendered nothing at all could not satisfy it. |
| L-3 | `staffCountLabel([])` returned "0 people run this gym" — the sentence the helper exists to make impossible. Only non-arrays were guarded. Unreachable today (the owner's own row is always present) and one empty array away. | Empty array returns null, beside the non-array arm. |
| L-4 | `Try again` was drawn over refusals retrying cannot fix — a permanent 403, and the half-done removal notice where `retry` re-reads the STAFF LIST and cannot finish the membership. | `actionError` carries a `retryable` flag; the add form is its own retry surface so its failures carry no button. Follows `Overview`'s existing precedent. |
| L-5 | A one- or two-character email hit the server's `.min(3)` and printed `email: too_small` at the owner verbatim. | Bound mirrored client-side with the number quoted from the schema. Deliberately NOT a format check — the server does not do one either, so a format opinion here could reject an address registration accepted. |

## Staff SCREEN (web half), T3 round 2 — diff-only (2026-08-22) — DECISIONS :15007

**ZERO Critical/High — the packet SHIPS.** All four re-derivations of round 1's
fixes came back clean and no fix created a new defect. **Six Low, all fixed:**

| # | Finding | Fix |
|---|---|---|
| L-1 | Round 1's own empty-array guard was observed by nothing — deleted, 57 tests stayed GREEN. | `expect(staffCountLabel([])).toBeNull()` beside the non-array cases. |
| L-2 | Round 1's `.min(3)` mirror was observed by nothing — neutered to `if (false)`, 35 tests stayed GREEN. | A render test typing `ab` and asserting the WRITTEN sentence, that `too_small` is absent, and that no request left the client. |
| L-3 | Round 1's whole `retryable` gate was observed by nothing — reverted to an unconditional `onRetry`, 35 tests stayed GREEN, **the half-done test included, because it asserts the notice and never that Try again is ABSENT.** | Two tests: no button over the half-done removal, none over a permanent 403 — **with a positive control proving the identical failure offline still offers it**, so the gate is a bound and not a ban. |
| L-4 | Only the LOWER bound was mirrored. The schema is `.min(3).max(320)`, so a pasted 321-character entry still printed `email: too_big` verbatim. **The same defect at the other end, inside the fix written for it.** | Upper bound mirrored with the number quoted from the schema; its own test, plus a control that an ordinary address is still SENT. |
| L-5 | `errorStatus(err) !== 403` was inlined twice in `StaffPanel` while `Overview.jsx` held the identical predicate as `isRetryable` — three copies of one rule, and the fix's own comment cited that file as its precedent. | `isRetryable` moved to `orgsApi.js` beside `errorStatus` and imported by both. Moved rather than exported from a page: a component importing a predicate out of a screen is a dependency nobody wants. |
| L-6 | **:14840 and its index line both said the five Lows were logged "(BACKLOG.md)". They were not** — `git log -- BACKLOG.md` last touched it four commits earlier, and a grep for the entry found nothing. A record is a claim (:1173's class), and this one was mine. | Both sections written — round 1's above, and this one. |

**The shape worth carrying: three of round 1's six Lows were guards decided in one
file and observed in none — the same finding round 1 itself made about S11's
sibling, recurring in round 1's own fix commit.** Behaviour was correct every
time; only the coverage was absent. A fix is not done when the code is right, it
is done when something would notice the code going wrong.
