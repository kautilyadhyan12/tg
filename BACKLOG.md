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

## ROSTER BADGE, T3 round 1 (2026-08-22) — DECISIONS :15259

**ZERO Critical/High — the packet SHIPS** (:5348 rule 1). Escape hatch NOT armed:
the previous orgs round (:15007) found zero, so there is no two-rounds-running
trigger. **Six Low, all fixed in the round.** Every one was re-measured here
before being fixed — one of the reviewer's own figures did not reproduce first
time and is noted below.

| # | Finding | Fix |
|---|---|---|
| L-1 | **The roster's new cross-gym predicate had NO observer.** Deleting `s.gym_id = m.gym_id` from `listMembers`' `takes_seat` left the whole file green — including the both-ends test the record names as what stops the two copies drifting. **The FOURTH `gym_id` predicate on this table to ship untested**; :14401 round 2 wrote O88–O90 because "round 1's three fixes added three `gym_id` predicates and NOT ONE had a test", and this card added a fourth and repeated it. Consequence: a paying member of gym B who holds keys at gym A is badged Complimentary on B's roster and loses their Remove button — false on screen AND a money undercount, across tenants. | Asserted on the fixture that already existed (`CROSS-GYM: being staff at one gym does not free your seat at another`), so the door's refusal and the roster's answer are anchored by ONE fixture — with gym A's roster as the control, so it cannot pass by calling everybody a payer. New mutant **O94**. |
| L-2 | **This card made an existing mutant's anchor ambiguous and three documents recorded the opposite as verified.** O88's anchor matched ONCE at `3950a5d` and TWICE after, because the roster's new 14-space line contains its 12-space prefix; it still landed on `claimSeat` only because `String.replace` takes the first occurrence. The claim "the door's anchors and the roster's each match EXACTLY ONCE" was **generalised from a five-anchor sample**. | O88 re-anchored on `claimSeat`'s backtick-semicolon tail (unique). **The pre-check now REFUSES any anchor matching more than once** — the improvement :14493 named and never built — with the three pre-existing ambiguous rows in a shrink-only allow-list carrying an `OWED.md` line. **Guard proven to abort by removing one of them.** Both false claims corrected. |
| L-3 | **A past-tense verification that had not happened, in the two documents that were not being edited.** `HANDOFF.md` and `DECISIONS-INDEX.md` both said `git status` "was clean immediately after" the commit, while `DECISIONS.md` said the opposite in as many words and no commit existed. **:5748's own lesson, one paragraph after quoting it.** | Both corrected to say what is verified (mtimes: no source file touched between the smoke and the record) and what is owed (the post-commit check). |
| L-4 | **The smoke was cited by step numbers that do not match the sheet.** The sheet has 8 steps; Kd ran a **7-step compressed version typed in chat**, and every number in the record was one lower. The sheet was untracked, so no version existed to diff. | The mapping is written out, the subject and controls named in BOTH numberings, and **sheet step 2 named as unrun rather than counted** — implicitly covered, because `readThrough` throws on a contract mismatch so a roster that failed to parse would have shown no list at all. Sheet committed. |
| L-5 | **The §2.4 argument was unsound as written — two load-bearing sentences false.** (a) "It says this place is free, NOT this person is staff": `complimentary === false && takesSeat === false` means exactly "holds a `gym_staff` row here", and both fields ship in one object — an exact inference, not a probabilistic one. (b) "A trainer learns no more than they already could": `members.read` is granted to trainer and manager, `staff.manage` to the owner alone, and `listOrgStaff` gates the staff list on `staff.manage` — so the two roles refused that list with a 403 can now derive it. | **The record corrected to what is true, and the disclosure ACCEPTED rather than reversed.** §2.4's never-see list is member health and personal data and none of it moves; what a colleague learns is a role in their own gym. **Not "fixed" by withholding `takesSeat` from trainers — that trades a disclosure for a FALSEHOOD**, handing them back the pre-card defect (:5807 outranks a tidier boundary). Hiding it is Kd's ruling and has its own `OWED.md` line. |
| L-6 | **The both-ends test is described doing something it does not do.** The record said the cap assertions were "derived from the ROSTER's own count rather than from a number typed into the test". They are not — `seatsTaken()` reads the roster and is compared to a literal 0/1/2, and the door's half is independent 409/200 assertions. The test is sound; the account of why is wrong, and that account is what a later chat trusts while editing it. | Corrected in `DECISIONS.md` and the index line. |

**MY OWN MEASUREMENT NOTE, because a verdict nobody can name a cause for is not
evidence (:11846).** The reviewer reported L-1's probe as 92/92 GREEN. My first
run of it came back RED — and the single red was **`Test timed out in 5000ms` on
an unrelated cross-gym test**, i.e. the instrument, not the mutant being caught.
Re-measured scoped: all three candidate tests GREEN under the mutation, restore
sha256-verified both times. **The reviewer's finding was right; my first red would
have "disproved" it for the wrong reason.**

**The shape worth carrying: five of the six are the RECORD rather than the code,
and four of those five are claims that outran what was measured** — a
generalisation from five anchors, a verification written in the past tense before
it happened, step numbers taken from a sheet nobody ran, and a description of a
test that does not match the test. The code shipped correct; the account of it did
not.

## PER-STAFF PRIVILEGE TICKS (server half), T3 ROUND 1 — 2026-08-22, commit `3526a44`

**ONE Critical/High — the packet did NOT ship this round** (:5348 rule 1). The
C/H and its fix are in `DECISIONS.md`, not here; this file logs the **six Low,
all fixed in the round**. Escape hatch NOT armed: the previous orgs round
(:15259) found zero Critical/High, so there is no two-rounds-running trigger —
but the reviewer noted, short of the trigger, that **two of the last three orgs
rounds found an AUTHORITY defect** (:14401's ghost staff row, and this one). A
third is the hatch.

| # | Finding | Fix |
|---|---|---|
| L-1 | **LATENT CRITICAL — the last-owner guard counted owner ROWS, not owners who still HOLD the power.** Stripping a privilege removes no row, so the count never fell: with two owners each could strip the other, and the reviewer proved it by inserting a second owner directly — both left with `["members.read"]`, both 403 on the staff list, **nobody inside the gym able to repair it**. `removeStaff`'s identically-shaped count is correct because DELETE *does* decrement it; **copying the shape did not transfer the property**, and the docstring's claim that it "stays correct on the day a second owner becomes possible" was exactly backwards. Unreachable through the product today (`staffAssignableRoleSchema` is `manager\|trainer`, `createOrgAttempt` writes one owner — verified). | Counts owners **other than this row** who still hold every `lastOwnerRequires` entry (`privileges @> …`, with NULL counting as a holder because `privilegesFor` gives it the owner template). New test inserts a second owner directly and drives BOTH arms — stripping the second is allowed (the positive control), stripping the first is then refused. Mutant **O103**. |
| L-2 | **R2.2 — an `as` cast outside an adapter file**, one of five in `apps/api/src`: `(ORG_PRIVILEGES as readonly string[]).includes(p)`, on the path every authorisation decision runs through. | A module-level `ReadonlySet<string>` and `.has(p)`. No cast, and the O(1) is incidental — the point is the rule needs no cast to express. |
| L-3 | **`canonicalPrivileges` was exported and used nowhere outside its own module** (grep-verified; only `defaultPrivilegesFor` is imported elsewhere). | Export dropped; the function stays. |
| L-4 | **The recorded timing baseline did not reproduce.** The author measured the four seat-cap tests at 4782 · 5020 · 4762 · 5017 ms at HEAD (two already failing); the reviewer measured 1412 · 1716 · 1363 · 1348 ms over two consecutive local runs. Neither reading is disputed and **nobody has explained the ~3x gap**. The comment presented one machine's numbers as characterising the tests, and `30_000` is ~21x the reviewer's baseline, so a genuine 10x regression now passes silently. | **Both measurements written into the comment with the environments named**, plus the sensitivity cost stated out loud. The timeout stays at the file's own convention (30_000) rather than being fitted to either reading — a tighter bound re-opens the flake on the slower one. |
| L-5 | **Nothing bound `ORG_PRIVILEGES` to the database CHECK** — the same six strings written down twice, with each direction of drift failing far from the edit: add a privilege in code without a migration and `createOrgAttempt` raises an unmapped `23514`, so **CREATING A GYM 500s** rather than merely appointing somebody; remove one from the CHECK and `privilegesFor`'s filter silently narrows every stored row. | **A permanent guard** (:5348 rule 5) in `db.migration.test.ts`: it reads the DEPLOYED predicate from `pg_get_constraintdef` — not a copy of the DDL, which is what drifts — and asserts its string list equals `ORG_PRIVILEGES` exactly. |
| L-6 | **The role-reset's stated cost was too small.** The comment said hand-made edits "are lost"; the ticks BECOME the new role's template, which for a hand-NARROWED person can be MORE than they had (ticked to nothing, then set to trainer ⇒ regains `members.read` + `codes.invite`). Not a silent widening — an owner tapped it — but the Staff screen's warning copy would have been written from a false description. | Comment corrected, and the wording the screen must use is named in it: **"their permissions become the defaults for the new role"**, never "your changes will be lost". |

**THE REVIEWER'S RULE-4 FINDINGS, and the first is the one to carry.** Three
tests were green while the thing they claim was broken:

1. **"a MANAGER and a TRAINER are refused all five staff routes with 403" says
   in its own comment that it shuts "the privilege-escalation door :11429 rule
   1" — and it was green with that door WIDE OPEN.** It asserts the DEFAULT
   state, never the invariant. Closed by the C/H's own regression test.
2. **The LOCKOUT test could not tell the two counts apart** — one owner, so
   "count rows" and "count holders" agree. **The identical blind spot O87 was
   written for at the REMOVE door**, one function away.
3. **No test bound the vocabulary to the CHECK** (L-5) — a drift went red in no
   suite.

**And the sharpest thing in the round is about the instrument, not the code:
mutant O100's `why` claimed it guarded this exact escalation, and O100 PASSES.**
It deletes the route's gate, which was owner-only by accident rather than by
enforcement — **a mutation harness can only kill a guard that EXISTS.** Same
lesson :14745 recorded when Kd's browser found what no mutant could. O100's
wording is corrected and **O102 is the escalation itself**.

## PER-STAFF PRIVILEGE TICKS, T3 ROUND 2 (diff-only) — 2026-08-23, reviews `fc72c88`

**ZERO Critical/High — THE PACKET SHIPS** (:5348 rule 1). Escape hatch NOT
armed: no Critical/High in `modules/orgs` this round, so there is no
two-rounds-running trigger. **Three Low, all fixed in the round.** The reviewer
confirmed by RUNNING rather than reading that no non-owner can hold
`staff.manage` by any route or sequence (four writers grep-verified, two probes
covering every role transition and four request shapes), that rule 3 holds
(O102/O103 both RED), and that the last-owner guard counts holders at the ticks
door.

| # | Finding | Fix |
|---|---|---|
| L-1 | **THE SAME LOCKOUT AT THE OTHER DOOR — and the THIRD time this guard has been copied and got the same thing wrong.** `removeStaff` still counted owner ROWS. Counting rows was right while a row was the only thing carrying authority; since the ticks card an owner can be ticked DOWN, so two owner rows can mean ONE person who can manage staff — remove that person and the gym keeps an owner and loses the ability to appoint anybody, unrepairable from inside. Latent today (no route makes a second owner), exactly as round 1's Low-1 was. | Both doors now ask the identical question — does anybody ELSE still HOLD every privilege the last owner may not lose. **Written out twice, not shared** (R3.8, :14493 Low-2) and **anchored by ONE TEST DRIVING BOTH DOORS** (:14013's precedent), so an edit that fixes one and forgets the other fails in the test rather than in production. Mutant **O104**; O77 and O87 re-anchored onto the new count. |
| L-2 | **The new drift guard could not see half the vocabulary.** It parsed the deployed CHECK with `/'([a-z][a-z.]*)'::text/`, so any privilege whose name falls outside `[a-z.]` was INVISIBLE and the guard stayed green. The reviewer measured all four directions: code+1 RED, code−1 RED, CHECK−1 RED, **CHECK + `tv_token` GREEN**. :11429's own catalogue names a TV-mode token, so this was not a hypothetical shape. | `/'([^']*)'::text/` — every quoted string in the literal. **Proven by CAUSING it**: the deployed constraint was altered to accept `tv_token`, the guard went RED, the constraint was restored and verified byte-identical against the definition captured before the break, and the suite re-run GREEN. |
| L-3 | **A comment claiming a guarantee the test does not make.** The five-routes test still said it shuts ":11429 rule 1's privilege-escalation door" — round 1 measured that it does not: it asserts the DEFAULT state (a manager holds no `staff.manage`, so the route refuses them), never the invariant. A later chat editing that test would have trusted the comment. | Comment rewritten to claim only what the test proves, and to name the ESCALATION test as what actually shuts the door. |

**MY OWN HARNESS FOUND WHAT THE REVIEW COULD NOT, AND IT IS THE ENTRY WORTH
READING: the L-1 fix made O87 ALIVE.** O87 deletes `role = 'owner'` from the
remove door's count. Adding the `privileges @>` clause meant an ordinary trainer
failed the count anyway, so deleting the role filter **changed nothing the test
could observe** — a guarantee enforced twice over, which is :14401's O3 and
:11846's both-halves-moved, one card later, incurred by the fix written for a
different finding.

**The subject that isolates it is a staff row with NULL privileges** — a row
written before the ticks column existed, which counts as "holds the template" by
design (the deploy window). Without the role filter that legacy TRAINER would be
counted as somebody who can still run the gym, and the last owner could walk out.
Added to the last-owner test, inserted directly because no route can produce it
any more — **which is the point: it is what a row from the previous deploy looks
like**. O87 re-measured RED.

## THE STAFF SCREEN'S TICK BOXES (web half) — T3 ROUND 1's THREE LOW (2026-08-23)

Reviews `245632d`; the round's Critical/High is in `DECISIONS.md`. All three fixed
in the round (:5348 rule 1 — a Low buys no further round and is still fixed), and
**all three carry a test that fails without the fix, which rule 3 does not demand
of a Low and which is the whole reason this round exists**: round 1's finding was
guards decided in one file and observed in none.

| # | Finding | Fix |
|---|---|---|
| L-1 | **A LATENT HIGH: the "a permission this screen is too old to show" feature could never run, and the window it exists for would have KILLED the screen.** `orgStaffSchema.privileges` validated the whole list against THIS build's enum, so a response naming a privilege a newer api knows failed to parse before any component saw it; `readThrough` turns that into a hard contract failure. Consequences measured, with a positive control: a known-only row parsed, the same row plus `billing.manage` did not. So `unknownPrivileges`, its on-screen sentence and **mutant S18 all guarded a path no response could survive** — and the day a seventh privilege ships api-first, **every owner's Staff screen shows an error instead of their staff**, which is precisely what `.optional()` was chosen to prevent, arriving through the PARSER instead of the network. Tagged Low on :15534 Low-1's precedent (a latent critical unreachable through the product today). | **Lenient IN, strict OUT.** The two READ schemas (`orgStaffSchema`, `myOrgSchema`) take `z.array(z.string())`; the WRITE body keeps the enum, because the server is the authority on its own vocabulary and the database CHECK agrees with it. The SCREEN filters to what it has words for and carries the rest through, which is what it was always written to do. Three tests in `packages/shared`, two through the REAL client parser in `orgsApi.test.js` — **that last pair is what closes rule 4's first item**, since the Staff screen's own tests mock `orgService` and never reach the parser the defect lived in. Both directions measured against the enum restored. |
| L-2 | **The read-only row said "you" about somebody else.** `readOnly` keyed on `person.role === 'owner'` and drove BOTH editability and the wording, so a SECOND owner reading the first owner's row was told it was their own. `person.isYou` is the server's answer and the row already carried it. Unreachable today — a gym has one owner — and `OWED.md` keeps the second owner live. | Wording moves to `isYou`; **editability stays on the ROLE**, and the test asserts both, or it would pass against a build that let one owner edit another's ticks. |
| L-3 | **A comment describing the opposite of the code.** It said a manager row holding `staff.manage` "is therefore saved without it — silently narrowed". It was not: `ticked` came from the STORED set, so the box nobody was offered rode into the save and the server answered 409 `owner_only_privilege` — **every save on such a row failed**, which is the opposite of silently narrowing. | The CODE changed to match the comment rather than the comment to match the code: `ticked` is filtered to the boxes the row is actually offered, so the save succeeds and drops the tick. Unknown ticks are still added back — they are the opposite case, since nothing refuses those. |

**THE INSTRUMENT ENTRIES, AND THREE OF THE FOUR ARE MINE.**

1. **I MASKED A SWEEP'S EXIT CODE WITH A PIPE — `| head -14` — WHICH IS
   :15770's finding 1, THIRD RECORDED OCCURRENCE, MADE A FOURTH TIME IN THE
   SESSION THAT READ IT.** `head` closed the pipe, the harness was killed
   mid-run, and the `exit 0` reported belonged to `head`. Ten minutes bought
   nothing and **no verdict existed**. The tell was the same as every previous
   time: controls printed, then the summary never came. Re-run with output to a
   FILE and the exit code written into it by the shell.
2. **THE KILLED RUN'S TREE WAS CHECKED RATHER THAN ASSUMED** (:15770 finding 2,
   where a killed run left `code.paused && false` in the source). Nothing
   survived — but the checker written for it **raised two false alarms**, S4 and
   S13, because it could not read BACKTICK anchors and mis-paired ids with
   strings. Both were run down by hand: S4's original is present at
   `staffView.js:146`, S13's two-line anchor matches exactly once and the file is
   LF. **It lied toward a FALSE ALARM, which is the safe direction** (:11846).
3. **I DECLARED THE API HARNESS BROKEN AND IT IS NOT.** Its control aborted with
   "no test tally", I reproduced a filter losing its quotes through
   `corepack pnpm --filter api exec`, and I told Kd the harness cannot pass a
   multi-word `-t`. **The database had gone down**, which produces the identical
   symptom; with it back, the harness's exact command form returns
   `1 passed | 103 skipped`. **A diagnosis is a claim and takes V1's evidence
   like any other** (:13552, applied to my own). Corrected to Kd in the same
   session, and nothing was changed in the harness on the strength of it.
4. **I RAN A SEED-ASSERTING SUITE WHILE A SWEEP WAS LIVE against the same
   database** and got one red in `db.migration.test.ts` — the exact collision
   `vitest.config.ts` documents (nine files call `seed()`, two assert global
   counts). :3819's "never run the harness while something else is using the
   database", one instrument over. Re-run alone: **8/8**. The red was NOT quoted
   as a result in either direction until it had been re-measured.

## THE TICK BOXES — T3 ROUND 2's THREE LOW (2026-08-23)

Reviews `f1a334a`. **ZERO Critical/High — the packet SHIPS** (DECISIONS :16221).
All three fixed in the round; L-1 carries a test, L-2 is a deploy note with no
code, L-3 is the record and the sheet.

| # | Finding | Fix |
|---|---|---|
| L-1 | **The THIRD gate of round 1's own class.** `canManageStaff` still read `staffRole === 'owner'`, deciding whether the Settings TAB exists (`ConsoleLayout`), whether Settings renders the panel, and whether the panel renders at all — **while the commit and :16095 both claimed "no screen may DECIDE on `staffRole`"**. Round 1 fixed the two gates the defect surfaced on and left the third: :1239's instance-not-class, inside the fix written for that class. **Low, with the reasoning shown rather than asserted**: `staff.manage` cannot diverge from `role === 'owner'` on any reachable row — the server 409s it onto a non-owner, the last owner cannot be ticked out of it, an owner's role cannot be changed, and `owner` is not a role this screen hands out. **It stops being Low the day a second owner or delegated staff management ships**, both of which have live `OWED.md` lines. | Reads `privileges.includes('staff.manage')`, same shape as its two siblings; three call sites pass `viewerPrivileges(org)`. The unit tests were **re-expressed, not deleted** — every old case survives as a claim about that role's DEFAULT set, plus the case the old shape could not express (a set that holds the tick without the title, and a role NAME failing CLOSED). **Mutant S1 re-anchored AND re-aimed** — both halves moved (:11846), the sharp mutation now being the WRONG TICK (`members.read`, held by every staff role) rather than a widened role test. **Breaking the gate turns 64 tests red.** |
| L-2 | **The absent⇒role-defaults fallback is right in one direction and wrong in the other.** Correct for the window it was chosen for (web newer than api: a real manager keeps their controls). Wrong in the NARROWING direction — with an api that has the ticks WRITE route but not the `/orgs/mine` READ field, **somebody an owner has narrowed is still drawn Remove and the code controls**, and the server 403s them. R3.3 holds throughout; the 403 is still the enforcement. | **A deploy order, not a code change: api first for this field**, written onto the `OWED.md` ticks line. The code has no better answer than the one it already makes — every alternative fallback is wrong in the other window. |
| L-3 | **The smoke's step 7 proved nothing, and the record said it did.** The result block claimed "both directions" while :16095 said only the untick parenthetical — both could not be true, **and neither was the useful statement**: step 7 ran with a MANAGER, whose ROLE alone drew the join-code controls, so it discriminated in NEITHER direction. Its ✅ read *"gone or refused"*, which **the defect satisfied** — buttons present, server 403. **A runner would fairly mark that ✅ over a live bug, and did.** | Struck in **all four** documents rather than only where it was noticed (:5748). Step 7 rewritten: needs a **TRAINER**, demands a **reload** first, and demands the control **DISAPPEAR** rather than be refused. **Two edits, not one** — the direction that WAS run could not discriminate either. The missing widening step keeps its own 🟡 `OWED.md` line. |

**INSTRUMENT, AND IT IS THE SIXTH TIME ON THIS BRANCH:** my own fix moved the
lines three mutants point at (S1, S9, S15), and **the whole-table pre-check
ABORTED on S15 before a byte was written.** Re-anchored and re-measured. The guard
:15259 added and :15770 ported keeps earning its place — a no-op mutation reports
ALIVE, whose honest reading is "this guarantee has no test".

## THE CONSOLE STOPS NEEDING F5 — T3 ROUND 1's TWO LOW (2026-08-24)

Reviews `e8a7e5c`. **TWO Critical/High, so the packet did NOT ship on this
round** — the two below are the Low half, fixed in the same commit as the
Criticals (DECISIONS :17218). Neither bought a round; both are fixed.

| # | Finding | Fix |
|---|---|---|
| L-1 | **A comment that describes the cost this very card removed.** `ConsoleLayout.jsx` still said knowing the role "is one extra request per console page" — true when written, and precisely what the kept answer deleted. **It is the first file somebody opens to ask how the console learns a role**, so a stale answer there sends the next reader looking for a request that no longer happens. | Rewritten to say what it now costs (nothing of its own — the shell and its screen are one read between them), **with the correction left visible rather than the old sentence quietly deleted**: the paragraph names what it used to say and which ruling removed it. |
| L-2 | **The smoke sheet's result block called step 1 what the sheet calls step 2, and the other way round.** The block said *"Step 1 … a permission ticked ON"* / *"Step 2 … the power taken away"*, while the sheet's step 1 unticks and step 2 ticks on — and the sheet's own *"the step that matters most is 2"* paragraph agrees with the steps, not the block. `DECISIONS.md:16495` copied the crossing. **Both directions genuinely passed, so nothing was claimed that was not established** — only the labels were crossed. | Numbers corrected in the result block, **not by a blind swap**: the correction states WHY they crossed (Kd ran the ON direction first, which step 1's own preamble tells you to do when the helper has no Remove button to take away yet, and the block then described the steps in the order he RAN them while calling them by number). The 4/4 pass is untouched. |

**The instrument that matters here is not in the table.** Both Lows are records
that drifted from the code inside ONE card — the file comment and the smoke
sheet — and the round's two Criticals were also things the card's own reasoning
had never looked at. A card that changes when a screen asks a question leaves
stale sentences behind in every document that described the old cost.

## THE CONSOLE STOPS NEEDING F5 — T3 ROUND 2's TWO LOW (2026-08-24)

Reviews `4c40cd2`, diff-only. **ZERO Critical/High — the packet SHIPS**
(DECISIONS :17676). Both Low fixed in the round; neither bought another.

| # | Finding | Fix |
|---|---|---|
| L-1 | **A docblock crediting the wrong statement, inside the fix written for round 1's L-1 — which was also a record that had stopped matching its code.** `refreshConsoleOrgs` said *"bumping the generation first means the discarded read cannot publish"*, but `load` bumps unconditionally on that path, so the discard happened with or without the line. The reviewer measured it properly: the three statements are **mutually redundant** — deleting any ONE leaves the store suite GREEN, keeping only the bump goes RED. No behaviour was wrong; the record was. | The redundant `generation += 1` **deleted rather than kept as belt-and-braces**, and the paragraph rewritten to credit what actually does the work: clearing `inFlight` is what stops `load` sharing the read, and `load`'s own `++generation` is what stops the forgotten read publishing. **Same standard applied earlier in the session to an unreachable guard** — a line that cannot be observed is a line that should not be shipped, whichever direction the redundancy runs. |
| L-2 | **The guard the whole round's design turns on had NO test.** The reviewer deleted `inFlightUserId = forUserId;` — permanently disabling in-flight sharing — and **both console suites stayed GREEN**. Its only instrument was mutant C49, **whose signal is a HANG rather than a RED**: a sweep that aborts reads as "the harness is broken", which is very nearly how it was missed. :5348 rule 5 wants a permanent guard for a class that has already recurred, and :16388's retry loop is that class. | One store test — hang the read, fire `consoleOrgsRegainedFocus()`, assert `getMine` was called ONCE. **Watched RED under the reviewer's own probe before the fix existed** (2 calls, not 1; the other 9 tests stayed green, reproducing their measurement exactly). Plus **mutant C54** on that line, so the guarantee now fails as a RED rather than as an abort. |

**AN INSTRUMENT LESSON CAME OUT OF FIXING L-1, and it is bigger than the finding.**
Re-anchoring C53 aborted twice: once because L-1 deleted a line it pointed at, and
once because **`git checkout --` had rewritten `consoleOrgs.js` from LF to CRLF**,
and a `\n` anchor matches nothing in a CRLF file. The harness's CRLF warning was
written as if it were about one file; it is about **any file git has touched**.
**99 two-line anchors across 9 harnesses are exposed** — counted, and now carrying
their own 🟡 `OWED.md` line. It fails SAFE (the pre-check aborts rather than
reporting ALIVE), which is the only reason it is not blocking. The fix used here
was not a cleverer anchor but a named step in the source — `forgetTheReadInTheAir`
— so that ONE line can carry the guarantee.

## The plans-seed card, T3 round 1 (2026-08-25)

Reviews the seed card (`DECISIONS.md:18488`). **THREE Critical/High — the packet
did NOT ship this round**; they are in the round's own DECISIONS entry, not here.
Four Low, all fixed in the round, none of which bought another round.

| # | Finding | Fix |
|---|---|---|
| L-4 | **Two `OWED.md` lines read as open work that is finished.** The card kept the original text of both closed items "for the record" and left the kept copies as `- [ ]` unticked boxes — one of them the 🔴 headed *"THE PLANS SEED MATCHES NO PRICE BOOK THAT HAS EVER BEEN RULED"*. Measured by the reviewer: 2 lines matching `^- \[ \] ~~`. **`OWED.md` is the authority for "what is still to do", so a finished item presenting as an open 🔴 is precisely the failure that file exists to prevent** — and the strikethrough is invisible in a `grep` for unticked boxes, which is how the file is actually read. | Both kept copies ticked. The struck text stays; only the checkbox changed. |
| L-5 | **"Only a count can fail on an absence" is false, and it was written in two places** (the test's own comment and `DECISIONS.md:18488` §4). The per-code helper `row(code)` throws `missing plan X` for any code it is handed, and the `expectPrice` helper it replaced did the same. **The USD book's absence was invisible because no USD code was ever LISTED — not because counts uniquely see absence.** A sentence that credits the wrong mechanism teaches the next chat to reach for the wrong instrument. | Struck in DECISIONS with the correction beside it; the test comment rewritten from scratch as part of C/H-1's replacement assertion, which is a SET comparison and catches absence, extras and renames together. |
| L-6 | **"The abort arm is not reachable by any fixture I can build" is over-broad — the reviewer proved the opposite by reasoning the case out.** It is unreachable for the seven mutants that exist, because each changes a value the re-seed overwrites. **It IS reachable for a mutant that renames a plan code**: the re-seed cannot remove the orphaned active row, the active-set assertion then sees eleven codes, and the arm fires. (The reviewer deliberately did NOT run it, because running it would leave exactly that orphan row in the shared database — the right call, and the same hazard as C/H-3.) **Left as written, that sentence is an invitation for a later chat to delete a live guard citing :17218/:17676.** | Sentence struck and narrowed to "the seven mutants that exist today", with an explicit "do not delete this arm" note attached in both DECISIONS and the harness. |
| L-7 | **The seed suite's filter string was written out eight times** — as `expect` on O106–O112 and again as a bare literal inside the database-repair guard. Renaming the test breaks the seven LOUDLY (the control aborts on a filter matching nothing) but breaks the guard SILENTLY in the same edit, and the guard's failure mode is an abort reading *"no test tally"*, which looks like a broken harness rather than a stale string. Fails safe, hence Low. | One `SEED_FILTER` constant, referenced by all eight sites. **The reviewer's second half needed no code: he noted that nothing asserted `RETIRED_PLAN_CODES` is disjoint from `planRows`, and C/H-1's replacement assertion already covers it** — a code in both lists ends up inactive, so the active set would be nine rather than ten and the test fails. |

**THE ROUND'S OWN LESSON IS NOT IN THIS TABLE AND IS RECORDED WITH C/H-2: the
fix written for C/H-2 WAS ITSELF BROKEN, and only forcing a real abort found
it.** The repair was hooked to `process.on('exit')` but registered BELOW the
mutation loop, so an in-loop `abort()` exited before the handler existed and the
repair never ran — measured, `pro_us_m` left at 699 exactly as if the guard did
not exist. **A guard registered after the thing it guards is not a guard**, and
reading the code would not have shown it; the forced abort did.

## The plans-seed card, T3 round 2 (diff-only) (2026-08-25)

Reviews round 1's fixes (`DECISIONS.md:18652`). **ZERO Critical/High — the packet
SHIPS** (`DECISIONS.md:18830`). Escape hatch not armed. Seven Low, all fixed in
the round; none bought another.

| # | Finding | Fix |
|---|---|---|
| L-1 | **The new "exactly ten gym plans" assertion counted a plan another suite owns.** `orgs.routes.test.ts` creates `zz_orgs_cap1` for its run, so an unscoped count sees eleven. Reproduced: inserted the row, watched the assertion fail with `received` ending `"zz_orgs_cap1"`. It also reddened the mutation harness's control, aborting a sweep before it began. **AND THE REVIEW'S FIX WAS HALF OF IT** — running the two suites in ONE invocation (which nobody had done) failed somewhere else instead: `expected 22 to be 21`, the IDEMPOTENCY comparison counting the same foreign row between its two reads. Same defect, one line up. | Fixed as a **CLASS** (:1239): every read in the file scoped to the seed's own `free`/`pro_`/`org_` namespace, written out literally rather than derived from `planRows` (:3610). Measured after: three suites in one invocation **121/121, twice** — a race that passes once is not evidence — and 121/121 on a fresh database. The prefix convention is now load-bearing and said to be. |
| L-2 | **Round 1 claimed repointing five fixtures gave the 5-scan rule "its first real observer". Measured false — not one of them looks at the number.** They assert `source`, `coach` 30/day and `history_days`, all three IDENTICAL in the paid and gym-member blocks, so every one stays green if 5 becomes 20. The claim reached three documents before anyone checked. **Moving a test onto the right fixture does not make it ask the right question** — :12731's lesson one round later, in the round that quoted it. | Made TRUE rather than retracted: the gym-membership test now asserts `/v1/entitlements/me` returns `meal_scan` 5/day — **through the resolver a real member's app reads, not off the plans table** — carried by mutant **O113**, deliberately a SIBLING of O110 rather than a replacement (:15770). O113 measured RED. Three documents struck in place. |
| L-3 | **A sentence round 1 struck as false had a third copy, and the harness PRINTS it on every sweep.** *"a price book can be wrong by being ABSENT, which only a count can catch"*, inside O108's `why`. Doubly wrong by then — the replacement assertion is a set comparison, not a count. | Rewritten to describe what the assertion actually does. |
| L-4 | **The index still carried the "abort arm is honestly unreachable" sentence round 1 struck in DECISIONS — both written in the same uncommitted change.** The worse of the two copies: CLAUDE.md requires the index be read in full every session while DECISIONS entries are opened selectively, and says outright that when the two disagree the index is the thing to fix. Low-6's stated harm was that the sentence invites a later chat to delete a live guard. | Struck in the index with the "do NOT delete that arm" instruction carried across. **:5748 landing twice in one round — the place a correction is missed is the file you were not editing.** |
| L-5 | **The repair guard's comment cited, as a reason it was needed, the one case it could not handle.** It names ":17218 a mutant killed at 600 s"; `:17284` records that as one that *"had to be killed, which left the mutated file on disk"* — and a kill fires no `exit` handler. With the deliberate remote opt-in set, a Ctrl-C would leave an unruled price in the database Kd's browser reads. | Fixed by **handling it rather than narrowing the citation**: `SIGINT`/`SIGTERM` repair, then exit 130/143. **Cost accepted and printed** — Ctrl-C now takes about one suite run, and says so, because a tool that appears to ignore Ctrl-C is worse than a slow one. `SIGKILL`, a power cut and a second Ctrl-C are named as still uncovered. |
| L-6 | **Neither tool fix from round 1 had any automated protection — the rule-3 answer.** The repair's placement was guarded by a comment reading "do not move this back down", **when that round's own standing lesson is that reading the code did not reveal the defect, only causing it did**. The remote refusal was equally naked: delete it, nothing goes red. | No test harness exists for `tools/*.mjs` (its own card), so both guards live inside the tool and fire every run: a **placement check** that aborts if the handlers are registered after the loop, and an **`isLocalHost` self-check table carrying BOTH directions** — a table of only-should-pass hosts is satisfied by a function that passes everything (:7104's PG1), so `localhost.evil.com` and `192.168.1.50` are in it as traps. Both proven by causing them; harness restored byte-identical either side. |
| L-7 | **The review's own closing finding was WRONG, and why it was wrong is a real defect of ours.** It said Kd's 5-scans-vs-20 question is still open and needs his ruling. He closed it 2026-08-24 (`:17366` §2, his own words), `OWED.md` has been ticked since, and the seed comment it objected to is quoting that ruling. Acting on it would have been the protocol failure CLAUDE.md names by name. **The cause: `DECISIONS-INDEX.md` §2 still listed it as OPEN — and CLAUDE.md requires §2 be read in full every session, so a reviewer doing exactly what the protocol asks read it and believed it.** | Index line struck with the closure and its reason written in. **Standing lesson recorded: a stale index line is not cosmetic — it is the one document guaranteed to be read in full, so an error there propagates into every session, and this one reached the point of putting a settled ruling back in front of Kd. Whoever closes an entry closes its index line in the same commit.** |

## Gym details (server half), T3 round 1 (2026-08-26)

Reviews `DECISIONS.md:19366` + `:19560`. **THREE Critical/High — the packet did
NOT ship this round** (`DECISIONS.md:19656`); those are recorded there, not here.
Escape hatch not armed (round 1). Three Low, all fixed in the round; none bought
another.

| # | Finding | Fix |
|---|---|---|
| L-1 | **The `.default(null)` on `country` quietly loosened a safety net.** The server parses its own responses on the way out, which is what caught a missing `currencyDisplay` at :10402. `country` defaulting to null is RIGHT for the browser — a required field would blank the whole gym list during a web-newer-than-api deploy (:12660), and the reviewer checked both directions and agreed. The cost is that a future read which forgets to select the column now serves "no country" **silently** instead of throwing. All seven reads verified correct today. | **A TEST rather than undoing the default** — the reviewer's own recommendation, and the right one. A gym that HAS a country must never read back without one, asserted on both endpoints that carry an org summary (`/v1/orgs/mine` and the edit response). Undoing the default would trade a silent-degradation risk for a certain outage during a deploy window. |
| L-2 | **Two tests rebuilt an email address by hand** from `makeUser`'s naming convention (`orgs-t-<local>@example.com`) instead of using the account they had just created. Works today; works only while that convention holds, and the day it changes they fail somewhere far from the cause. | Fixed at the **SOURCE**, not the two call sites (:1239, the class not the case): `makeUser` now returns `email`. That also removed a `void person` which existed only because one loop was not using its own subject — a tell that the fixture was being worked around. |
| L-3 | **The 409 points at a door that does not exist.** *"Contact us and we'll move it for you"* — but the app sends no email and has no contact page, so an owner reading it has nowhere to go. **Not a lie** (:5807's test is "on screen AND wrong"): Kd approves every gym by hand at this scale (:11072), and both Stripe and Paddle treat a currency move as a support request too. | ~~Named on the admin-panel `OWED.md` line so the real channel is written down when that panel arrives.~~ **FALSE WHEN WRITTEN — struck by round 2's Low-4, which proved it with `git show da4a5ee --numstat -- OWED.md` (`22 0`, every insertion the lock block). Nothing was named on that line until the round-2 commit, where it was actually written.** The sentence stays, because a refusal that names no way out is worse than one naming a way out that is still being built. |

## Gym details (server half), T3 round 2 (diff-only) (2026-08-26)

Reviews `da4a5ee`. **ONE Critical/High — the packet did NOT ship**
(`DECISIONS.md:19799`); it is in `tools/mutate-orgs.mjs`, not the app, and is
recorded there. Escape hatch NOT armed (round 1's three were all in
`modules/orgs`; this round found zero there). Five Low, all fixed in the round;
**four of the five are MINE and are in the RECORD rather than the code.**

| # | Finding | Fix |
|---|---|---|
| L-1 | **The rewritten 409 says "on a paid plan" to gyms that are not.** The guard fires on `status <> 'trialing'`, and :19560 deliberately locks `canceled` and `expired` too ("over-locking is the safe direction") — so two states it knowingly covers were told they were on a paid plan. **From the round whose stated purpose was to make the refusal TRUE**: the other half of the same sentence, carried over from the pre-fix wording unexamined. The reviewer disclosed weighing it Critical/High and landing Low on :12731's fact-pattern — nobody can be in the state (nothing inserts into `subscriptions`, re-derived not inherited), no number or action changes — **and said so rather than burying it**; a C/H tag would have armed the hatch over a wording clause. | "…can't change **while your gym has a subscription**, and that country uses a different one." True of every state the guard covers. |
| L-2 | **THE ONE WITH TEETH: the user-visible half of C/H-2's fix was protected by nothing.** C/H-2 had two parts — the money-moves rule (guarded, O126) and the sentence being TRUE (guarded by nothing). The outcome NAME was asserted; the words a gym owner reads were not. **The reviewer measured it: reverted the string, both tests that reach the 409 stayed GREEN**, so the pre-fix falsehood — "your gym's country is fixed", to a gym that has no country — could return under a green suite. :5104 F5, inside a fix written for exactly that class. | Asserts the **PROMISE, not the prose**: the message must name the CURRENCY (true of every gym) and must not claim a fixed country or a paid plan. **Banning the exact old string would force vaguer wording to satisfy a test** (:14840's lesson), so the CLAIM is what is banned. Watched RED against the restored pre-fix sentence; source sha256-verified back. |
| L-3 | **`OWED.md` — the file the billing and admin-panel cards actually READ — still named the old outcome (`country_locked`) and the old, over-broad condition ("any gym holding a subscription past `trialing`")**, inside the closed ❓ item whose own next paragraph is headed *"What the billing card still inherits"*. The refusal has fired only on a currency MOVE since round 1. | Both clauses corrected in place with the supersession dated. :18830's standing point: a stale record is not cosmetic — it manufactures work and can re-open settled ground. |
| L-4 | **THE WORST OF THE FIVE, and it is :15007 L-6 exactly: a Low was recorded as FIXED in four documents and was never fixed.** All four (BACKLOG, DECISIONS, the index, the commit message) say the 409's missing contact channel was "named on the admin-panel `OWED.md` line". It was not — `git show da4a5ee --numstat -- OWED.md` is `22 0`, and all 22 insertions are the new lock block. **A claim of a fix is a claim, and V1 does not relax for bookkeeping.** | Actually written onto the admin-panel line — the tool that performs the move AND the sentence naming a real channel, closing together — and the four false claims corrected at their source (:1173). |
| L-5 | **The headline PROVE figure does not reproduce.** :19656 claims `orgs.routes` **129/129 (+12)**; measured **119/119 (+2)**. 129 is the COMBINED total, which the same line separately and correctly quotes — so the entry contradicted itself (129 + 10 ≠ 129), and "+12" invites the next chat to believe twelve tests were added where the round added two `it(` blocks. Both neighbouring entries are internally consistent, which is what made this one the outlier. | Re-measured and corrected in all four places, with the arithmetic written out so the correction can be checked rather than believed. |

## Gym details (server half), T3 round 3 (diff-only) — THE PACKET SHIPS (2026-08-26)

Reviews `076ed0a`. **ZERO Critical/High** (`DECISIONS.md`'s round-3 entry).
**ESCAPE HATCH NOT ARMED** — round 2's Critical was in `tools/mutate-orgs.mjs`
and this round found none there or anywhere, so there is no two-round streak.
Six Low, all fixed in the ship commit; **three of the six are my own overclaims
about my own guards.**

| # | Finding | Fix |
|---|---|---|
| L-1 | **A failed BEFORE-probe passed the sweep, and the summary was silent about it.** `gymFingerprint()` collapses every failure to `null`, and the baseline branch printed one WARNING and returned `true` — so a run with mass-write detection OFF was byte-identical in its summary to one where it passed. **That is the exact mode that made v1 of this guard dead** (:19799 — the warning was printed and nobody acted on it). Its two siblings in the same file already fail closed (exit 3 and exit 4); only the baseline did not, and the asymmetry was undocumented. | **Now fatal.** `abort()` with the reason and "Nothing has been mutated". The probe needs only `node` and `postgres` from `apps/api`, both required for the suite to run at all, so a failure here means something is broken enough to stop for. **Proven by causing it** — forced the baseline to `null`, got exit 2 before any mutation. |
| L-2 | **The comment said the assertion "bans the CLAIM"; it banned one substring, and a still-false message passed.** The reviewer planted *"…can't change because your gym's country is locked…"* — telling one of the 59 gyms that have NO country that its country is locked, C/H-2's exact falsehood — **and the suite went GREEN**. He also observed `not.toMatch(/country is fixed/i)` had no case in the round where it was the assertion doing the work. | A **GOLDEN STRING**, and the honest reasoning is written where the weaker version's overclaim used to be: a lexical rule cannot express "makes no false claim about THIS gym", but equality can express "nobody reworded this without a human re-reading it against a gym that has no country". **AND MY FIRST VERSION OF THIS FIX WAS TAUTOLOGICAL** — it asserted against the exported constant, so planting probe-D into the constant moved both sides and the test PASSED (:3610: a test whose inputs and subject share a source proves only that the source is self-consistent). Caught before shipping by re-running the reviewer's own probe. Now a **literal written out in the test**; probe-D re-measured RED. |
| L-3 | **The green line did not carry its own caveat.** `gym rows verified — 65 pre-existing rows unchanged` was all a reader saw; the limitation (the guard cannot re-alarm on an already-uniform table) lived in a code comment and an `OWED.md` line, neither in front of the person reading the sweep. :19799 named the hazard in those words — *"that green line reads as 'O114 is safe' and is not"* — and the recording did not reach the line. | The line now carries it: `…(table is UNIFORM — a REPEAT mass-write is invisible to this check; see OWED)`, printed whenever the post-sweep table has one distinct fingerprint. |
| L-4 | **The comment claimed the CLASS was fixed; the code covers one table and five columns.** *"a mutant that mass-writes is caught wherever it lives"* is false — `gym_members`, `gym_staff`, `gym_codes`, `gym_join_applications` and `gyms.slug`/`.status`/`.owner_user_id`/`.removed_at` are all invisible to it. **The reviewer checked whether the hole is live and it is not**, enumerating every mutant whose replacement writes or neuters a predicate and finding them all bounded. | Sentence narrowed to what the code does, with the tables it cannot see named, and **the trigger to widen it written down**: the next route that writes rows a caller does not own. |
| L-5 | **THE ONE THAT MADE THE GUARD USABLE: a sweep containing O114 and a working guard were mutually exclusive.** O114 mass-writes by design — that is how it proves the tenancy predicate is load-bearing — so on a healthy table the guard fired and exited 4 with no green line obtainable, and on a flattened table it exited 0 and was blind. **The round's own green PROVE figure was therefore only obtainable because the local table was already destroyed**, and `OWED.md`'s own remedy (clean the junk rows) guaranteed the next sweep would exit 4 and re-flatten it. | **ATTRIBUTION.** The guard now fingerprints around EACH mutant and names the one that moved rows, so "O114 rewrote the table" and "O119 rewrote the table" stop being the same event. A mutant declaring `writesRows` is expected — reported loudly, by name, with a count, not an alarm; anything else still exits 4. **`writesRows` is checked in BOTH directions**: a mutant that declares it and moves nothing is reported too, because a declaration nobody can observe is how a guard quietly stops guarding. Proven both ways on a healthy table: declared ⇒ named, exit 0; declaration removed ⇒ `A MUTANT REWROTE GYM ROWS IT HAD NO BUSINESS TOUCHING`, exit 4. |
| L-6 | **"the four false claims corrected at their source" — none of the four was edited.** Round 2's own entry claimed the correction; `git show 076ed0a --numstat -- BACKLOG.md` is `16 0` (insertions only) and the three sites still read as before. No reader was misled about the contact channel, because the same commit's `OWED.md` write made all three sentences TRUE — **but "corrected" is a claim about an edit that did not happen, which is L-4's own class recurring in the entry that records it.** | The three sites annotated for real, each struck with the proof (`git show --numstat`), and round 2's claim restated: they were **made true, not corrected**. |

## Gym details (WEB half), T3 round 1 — ONE Critical/High, packet did NOT ship (2026-08-26)

Reviews `7236093` · `2a2f581` · `428bbfb` (`DECISIONS.md`'s round-1 entry).
**ESCAPE HATCH NOT ARMED** — round 1 for the web half, and the server half's
Criticals were in `modules/orgs` and its mutation harness, neither of which this
round touches. The Critical/High is recorded in `DECISIONS.md`, not here; these
are the four Low, all fixed in the same commit.

| # | Finding | Fix |
|---|---|---|
| L-1 | **Pressing "Try again" shut the Staff section under the click.** `forceOpen` was derived from a live error, and `retry` clears the error before the read lands — so the section collapsed, taking the spinner with it (the loading arm lives inside the body that had just been unmounted). An owner saw everything vanish and read it as a broken button. Severity disclosed rather than decided quietly (:13552): weighed as C/H under :5807 and landed **Low**, because the closed heading is TRUE (it carries the real count) and one tap re-opens. | **Latched.** `if (forceOpen && !open) setOpen(true)` in `ConsoleSection`, so the force survives its own cause going away. Both halves kept and both tested: while the error is live it still cannot be tapped shut, and afterwards it is an ordinary open section that closes. Mutant **C76**. |
| L-2 | **Two submits, two requests.** The guard checked `problem` and `patch` but not `saving`, in the handler whose own comment reasons about the Enter key — and ENTER submits a form without going through the disabled button. Measured: two submit events → `updateOrg` called twice. Harmless (PATCH, idempotent, a no-op writes no audit row) and still the app asking twice for one act. | `saving` added to the guard. Mutant **C78**, and a test that fires two submits and asserts one call. |
| L-3 | **`aria-controls` dangled on every closed row.** Closed means UNMOUNTED here — the deliberate choice — so the attribute promised a screen reader an element to move to and there was none. | Set only while open. Mutant **C77**. |
| L-4 | **Two numbers in my own record were stated without counting** (V1, on bookkeeping): "all **33** call sites … 27 staff and **6** gym". Measured: `7236093` held **35** `drawSettings();` sites, **3** correctly left alone because they assert ABSENCE, **32** converted — 27 staff and **5** gym. The 6th gym conversion was reverted by hand minutes later (the manager who is drawn no section at all), so 33 and 6 were a count of an intermediate state nobody ever committed. The `27` was right. | Corrected in `DECISIONS.md`, `DECISIONS-INDEX.md`, `HANDOFF.md` and the test file's own header, each struck rather than silently rewritten, with the arithmetic written out so the correction can be checked. **The commit message carries the old figures and cannot be edited; the DECISIONS entry is the correction of record** (:5748). |

## Gym details (WEB half), T3 round 2 (diff-only) — ONE Critical/High, packet did NOT ship (2026-08-26)

Reviews `0638b46` (`DECISIONS.md`'s round-2 entry). **ESCAPE HATCH ARMED** — the
Critical/High is in `GymDetailsPanel.jsx` two rounds running, and the reviewer
stopped without proposing a fix, correctly. **KD RULED PATCH**, the fourth time
this trigger has fired and the fourth PATCH ruling (:6277, :9509, :14493). The
Critical/High is in `DECISIONS.md`; these are the two Low.

| # | Finding | Fix |
|---|---|---|
| L-1 | **"Saved." outlived the bytes it was about.** The follow block replaces what is in the boxes and left `saved` standing — so a confirmation could sit beside values the owner never saved, after a co-owner's rename arrived. It is the rule the same file states eleven lines further down (`edit` clears it on every keystroke, *"a claim about bytes that are no longer on screen"*), reached through a door round 1's fix opened. Severity disclosed rather than decided quietly (:13552): weighed as C/H under :5807 and landed **Low** — every value on screen is the server's true current value, no number is wrong, and Save is correctly disabled, so nothing false about the GYM is shown; what is stale is a confirmation word. | `setSaved(false)` and `setError(null)` in the same block that replaces the draft — the refusal for the same reason, since a leftover one would read as a refusal of values the owner never sent. Mutant **C80**. |
| L-2 | **V1 on the round's OWN correction.** Round 1's Low-4 corrected "33 call sites … 27 staff and 6 gym" in four documents and said so; **two copies survived** — `OWED.md` and the smoke sheet — and both are the sentence carrying the evidence that the smoke's steps 2–9 hold across the collapse commit. :5748's recorded class (*the place a correction is missed is the file you were not editing*) recurring **inside the round whose own finding that was**, which is :19960's Low-6 shape exactly. | Both corrected, each struck rather than silently rewritten and each naming why a wrong count matters in that particular sentence. Re-measured independently by the reviewer: 35 at `7236093`, 3 left alone as ABSENCE assertions, 32 converted — 27 staff, 5 gym. |

## Gym details (WEB half), T3 round 3 (diff-only) — ONE Critical/High, packet did NOT ship (2026-08-26)

Reviews `f1e995c` (`DECISIONS.md`'s round-3 entry). **ESCAPE HATCH FIRED FOR THE
THIRD CONSECUTIVE ROUND** in `GymDetailsPanel.jsx` and the reviewer stopped
without proposing a fix, correctly. **KD RULED PATCH**, having been given the one
fact that separates this firing from the last two: **rounds 1 and 2 were a fix
causing the next round's defect; this one is OLDER than round 1 and round 1's
work made it less bad, not worse.** The Critical/High is in `DECISIONS.md`; these
are the four Low.

| # | Finding | Fix |
|---|---|---|
| L-1 | **A test I wrote in round 2 CANNOT FAIL, and round 2's whole variadic guarantee had no observer.** `keeps EVERY zone it is asked for, not just the last one` mocked the runtime list as `['Europe/Paris']` and asked for `Europe/Paris` + `Asia/Kolkata` — so only ONE zone was ever missing, and a helper keeping just the last missing one passes it. **Measured: the entire web suite, 45 files, 1232/1232, exit 0, with the guarantee broken.** The shipped code was correct throughout; the coverage was absent — :5104 F5's shape, in the test written to close round 2's own Critical/High. | Mock a list containing NEITHER zone, so two are missing at once — the only shape that can tell the two implementations apart (:4267 F2's class). Mutant **C83**, which could not have existed before this fixture change. |
| L-2 | **The untested half of round 2's Low-1 fix.** `setError(null)` in the follow block has no test and no mutant; replacing it with `void 0` left `takes "Saved." down…` green, because **C80** covers only `setSaved(false)`. | Recorded rather than closed with a second mutant: the two statements are one act (clearing what the previous save said) and C80 already fails if the block stops running. Named here so the gap is visible rather than assumed covered. |
| L-3 | **A comment falsified by round 1 and left standing for two rounds.** `GymDetailsPanel`'s memo note still said `timezoneChoices` "walks ~400 zones. Neither depends on anything that changes while the form is open — and the gym's own zone is taken from the row this panel was FIRST given." All three clauses became false at round 1; the memo depends on `draft.timezone` and `org?.timezone`, both of which move while the form is open. | Rewritten to describe what the code does. :5748 — a comment that outlives the code it describes is how the next chat inherits a false premise. |
| L-4 | **The rule-3 certificate was incomplete, not false.** Round 2's entry and commit say "both new render tests watched RED first" while the same PROVE line says three render cases were added — the third is the CONTROL, which must be green. Same class as round 1's L-4 and round 2's L-2: a count stated without saying what it counts. | Round 3's entry states the split explicitly (which tests were expected RED, which GREEN, and why). |

## Gym details (WEB half), T3 round 4 (diff-only) — ONE Critical/High, packet did NOT ship (2026-08-26)

Reviews `97d1098` (`DECISIONS.md`'s round-4 entry, :20867). **ESCAPE HATCH FIRED
FOR THE FOURTH CONSECUTIVE ROUND** — rounds 1–2 in `GymDetailsPanel.jsx`, rounds
3–4 at its mount site in `Settings.jsx` — and the reviewer stopped without
proposing a fix, correctly. **KD RULED PATCH**, having been given the fact that
decides it in plain words: **round 3's own fix created round 4's defect** (the
spiral condition, MET this time and not argued around), and a redesign would not
have prevented it, because a rebuilt screen with two matching keys breaks
identically. The Critical/High is in `DECISIONS.md`; these are the three Low.

| # | Finding | Fix |
|---|---|---|
| L-1 | **The recorded CAUSE of round 3's test shape is FALSE, in four documents.** "react-router 7 + React 19 leave the OUTGOING route subtree in jsdom, so every query after a navigation matches twice" — measured on the same bytes: **one `h1`, one subtitle, one Staff heading**. Nothing of the route subtree duplicates. Only the gym panel did, and only because round 3 put the same `key` on both siblings. The clause *"the first is the departing tree a real browser removes"* is the **opposite** of the truth — React never scheduled its deletion, so no browser removes it. **This false line is the proximate reason C/H-1 shipped**: it is what justified taking `last(...)`, which is what looked past the stranded panel. | Corrected in all four — `DECISIONS.md` (struck with a banner at its own line, kept rather than deleted because the wrong diagnosis IS the lesson), `DECISIONS-INDEX.md`, `HANDOFF.md`, and superseded by the round-4 entry the commit message points at. **Rule earned and recorded: a "test-environment quirk" is not a finding until it has been controlled against the code under test — if the quirk disappears when you fix your own bug, it WAS your bug.** |
| L-2 | **`carries NOTHING from one gym onto another, even mid-edit` could not fail on the thing its name claims.** Its `last(...)` convention and its "click the LAST heading open" step look past a stranded panel **by construction** — measured, it passes on the shipped duplicate-key bytes. Not wholly vacuous (it went red with the keys removed), so mutant **C81**'s red proved *the key is present*, not *that state stops crossing*. :5104 F5 / :11846's filter half, and **the same shape as round 3's own L-1, one round later**. | Rewritten to **COUNT** rather than choose: exactly one `Gym details` heading, exactly one of each box holding gym B's own value, exactly one Save, disabled. **Now guards BOTH failure modes where the old one guarded neither** — RED on the shipped bytes (`length of 1 but got 2`) and RED with both keys removed (**C84**: `[ 'Iron House HQ' ]` vs `[ 'Iron Palace' ]`). |
| L-3 | **Which panel leaked was decided purely by SOURCE ORDER, and nothing recorded it.** `StaffPanel` survived the duplicate pair only because it is written second; reordering the two blocks would have silently handed the defect to the staff list, and neither the file, the tests nor the harness said so. | Removed rather than documented: the per-panel prefix makes each key unique, so the ordering dependency no longer exists. Stated in the comment at both mount sites so a future author does not reintroduce a shared key. |

## Gym details (WEB half), T3 round 5 (diff-only) — ZERO Critical/High, THE PACKET SHIPS (2026-08-26)

Reviews `af27965` (`DECISIONS.md`'s round-5 entry, :20986). **The hatch does NOT
fire**: five rounds on this file, but this one found no Critical, so there is no
redesign question. The reviewer re-measured every claim round 4 made rather than
trusting it — including two single-key mutants round 4's own certificate did not
carry — and all held. One Low.

| # | Finding | Fix |
|---|---|---|
| L-1 | **The bug class that cost four rounds got a case fix and no PERMANENT GUARD** (:5348 rule 5). `Encountered two children with the same key` is React announcing this defect on every render; it costs nothing to ignore, and it WAS ignored for four rounds while a green suite said "fine". Round 4 fixed the pair and tested that pair; nothing stopped the next one. Measured at report time: the suite was printing **6 such warnings and staying green**. | `apps/web/src/test-setup.js` **fails the run** on the warning, registered via `setupFiles`. **Proven load-bearing independently of round 4's test**: mutant **C85** (both keys back to bare `org.id`) reds `settings.render.test.jsx` across many tests on the guard alone. The 6 pre-existing offences were all `activeWorkout.render.test.jsx`'s `exercise()` helper hardcoding `id: 'e1'` — **a fixture manufacturing a defect the app cannot produce** (`ExerciseLibrary.jsx:290` refuses a repeat); helper now issues a unique id per call, no test read the literal. **Blind spot named, `OWED.md` line opened**: a test silencing `console.error` with its own mock disables the guard for its duration (one does today). **Second limit, deliberate**: React de-dupes its own warnings, so the guard is a FLOOR, not a census. |

**Not a finding — carried out of the round anyway.** The reviewer flagged
`ActiveWorkout.jsx:1645` (`key={ex.id || i}`) as possibly the same class and
marked it **UNVERIFIED** rather than asserting it, which is round 4's own earned
rule being applied to round 5. Verified: **it cannot fire today** — no workout can
hold one exercise twice. It is a landmine with nothing on it until the first
feature that allows a repeat, when it would fail *silently and identically* to
:20867. Kd was given exactly that and ruled it be disarmed now: the key combines
id and position. One line, outside the card's files, approved before written.

## The gym's self-serve trial (SERVER half), T3 round 1 — ONE Critical/High, packet did NOT ship (2026-08-27)

Reviews `a313861` (`DECISIONS.md`'s round-1 entry, :21353). **The escape hatch is
NOT armed** and the reviewer said so unprompted: round 1 for this card, and the
previous Criticals on this branch were in the web console — a different subsystem.
The Critical/High (nothing ends a trial, tracked nowhere) is in `DECISIONS.md` and
now has its own 🔴 `OWED.md` line. **All eight Low are FIXED in the same round**
(:5348 rule 1 — a Low buys no round and is still fixed); they are logged here.

**L-4 arrived TRUNCATED in the paste and could not be read.** Rather than guess at
it, the same surfaces were re-read and what was found there is recorded below as a
RE-DERIVATION, not as the reviewer's finding. If the original L-4 was something
else, it is still outstanding and nobody knows it — the one honest thing to say.

| # | Finding | Fix |
|---|---|---|
| L-1 | **Migration `0015`'s backfill had no test and COULD NOT FAIL** — the highest-value item in the round. Its own SQL comment says *"Without this line the card ships DEAD"*, and nothing could falsify that: on a fresh database every owner row is written by `createOrg` from the role template, which already carries `billing.manage`, so **no test anywhere had a pre-`0015` subject**. `O134` mutates the template, not the migration. `0014`'s backfill got a dedicated test at :19366; `0015`'s got none. | `db.migration.test.ts` gains one built on `0014`'s shape — construct the legacy owner row, run the statement **read out of the shipped migration file**, roll back — **plus a non-owner control `0014` never had**. Three mutants RED: delete the `UPDATE` (*"found 0"*), drop `WHERE role = 'owner'` (*"expected [ Array(8) ] to not include 'billing.manage'"*), `array_append` → wholesale `ARRAY[...]` (*"expected [ 'billing.manage' ] to include 'members.read'"*). |
| L-2 | **A false claim in the repo about the strength of its own gate.** `startGymTrial`'s docblock said *"a second trial costs a second email address"*. It does not: the Day-14 DPDP purge sets `users.email = NULL` (`privacy/repo.ts:130`), so deleting the account **releases** the address — the same person re-registers it, gets a new `users.id`, and the gate (which matches on `gyms.owner_user_id`) cannot see them. | Rewritten to what is true: a second address **or** deleting the account and waiting out fourteen days, losing everything in it. **The gate is still as strong as §12 asks** — the second route is strictly the worse deal for an abuser — so only the sentence was wrong. The structural hazard is now stated too: the evidence is anchored on the gym's CURRENT owner, so the first feature that transfers or deletes a gym silently erases and misattributes trial history. |
| L-3 | **The `last_owner_locked` 409 named the wrong power.** *"has to keep the ability to manage staff"* — but `LAST_OWNER_REQUIRED_PRIVILEGES` covers `staff.manage` **and** `billing.manage`, and this card's own test drives the billing case, where staff management was kept and billing is what is missing. An owner would be told they were refused over a power they still held. | Message names both abilities. **Not** threaded through as "which one is missing": that needs a new field on a typed outcome union at two call sites, and the message can be made true without it — recorded here so the more specific version is a known option rather than an oversight. |
| L-4 | **RE-DERIVED, see the note above.** `packages/shared/src/orgs.ts` carried **two adjacent docblocks**: `/** WHAT THE GYM IS ON … */` — which describes `orgSubscriptionSchema` — sat immediately above `orgSubscriptionStatusSchema`, documenting the symbol one line below the one it was attached to. Shipped that way for four commits. | Moved onto the schema it describes, with a one-line note saying where it had been. |
| L-5 | **`trialEndsAt` was documented as something it will stop being, on the field the very next card renders.** *"ISO instant, or null when this is not a trial"* — but nothing clears the column when a subscription leaves `trialing`, so once billing exists a PAYING gym answers with the date its old trial ran out: a past date under a field promising null. Unreachable today, **which is the danger and not the comfort**. | Doc rewritten to say what the field is (the trial's end, whenever there was one) and to say **gate on `status`, never on this being null**. |
| L-6 | **The trial's audit row could not be joined to the subscription it named.** `targetType: "subscription"` carrying `targetId: input.gymId`. P3's Done gate asks that any subscription's life be narratable from `audit_log` alone. | `RETURNING id` on the `INSERT`; `targetId: row.id`. **Given a mutant despite being Low**, because it is a claim a phase gate rests on: flipping it back to `input.gymId` reds the trial test. The assertion carries `not.toBe(gymId)` beside `toBe(subscriptionId)` — both are uuids on the same row, so a shape-only check would have passed on the old value. |
| L-7 | **A dead field on a typed outcome.** `{ kind: "no_plan"; currency: string }` — the service's `case "no_plan"` ignores it and no other caller exists. An unread field reads as a fact somebody uses. | Dropped, with the reason on the line. No test read it. |
| L-8 | **A docblock asserting who is looking at the screen, contradicted by the card's own test.** The entitlement-bust note said *"the owner is member #1 of their own gym … so they are the one person looking at a screen when this returns"*. `billing.manage` is a TICK, and the test `a manager is refused the trial until the owner ticks billing across` makes a manager the actor — in which case the manager is busted and the owner waits out the TTL. | Rewritten to say the CALLER, with the manager case named. **The 60-second R6.5 guarantee holds either way** — only the sentence was wrong. |

**Not a finding — carried out of the round anyway.** The reviewer flagged that
`DECISIONS-INDEX.md` (6,096 lines) can no longer be read in full in one session,
which is the 2026-07-30 amendment's own wall reached by the instrument that
escaped it, **and declared its own grounding shortcut rather than hiding it**.
That is the right behaviour under a broken rule and is not a fix. It now has a 🟡
`OWED.md` line; the shape of the repair is Kd's ruling, not a chat's.

**Also carried out: gap (a) of the card's own three understated one direction.**
The record says the stale dev branch would hand a gym *"a 25-seat, 7-day plan"* —
true of an INR gym. :17902 measured that same seed as carrying **zero USD org
rows**, so a US gym there is **refused outright** with *"We're not open for
business in your country yet"*. That is the symptom Kd's browser will hit on the
web half, and it reads as the app being broken. Corrected in `DECISIONS.md` §5;
no code change (R1.1), and the dev branch is his data and was not touched.

## The gym's self-serve trial (SERVER half), T3 round 2 (diff-only) — ZERO Critical/High, THE PACKET SHIPS (2026-08-27)

Reviews `215882c` (`DECISIONS.md`'s round-1 entry, :21353). **The hatch does NOT
fire**: round 1's single Critical/High was in the RECORD, not a subsystem, so there
are no Criticals two rounds running. **Six Low, all fixed here** (:5348 rule 1 — a
Low buys no round and is still fixed), plus two items from the round's rule-4 list.

**Three of the six are defects in round 1's own fixes.** That is the shape worth
keeping: a round that corrects false sentences introduced three more, and the
reviewer caught them by re-measuring rather than by reading what round 1 claimed.

| # | Finding | Fix |
|---|---|---|
| L-1 | **The C/H document's own "measured, not reasoned" table was WRONG, in the paragraph labelled measured.** It said the scheduled work is *"rollups + the join-application sweep, nothing else"*. `rollups` is the QUEUE's name and **no rollup job is registered at all**, while the **DPDP purge** — which is — was omitted. `worker.ts` registers exactly two schedulers: `dpdp.purge` `0 3 * * *` (:68) and `orgs.join_sweep` `30 3 * * *` (:100). Conclusion unaffected (round 2 re-derived it independently), but this is the round whose entire subject is a claim reported as measured. | All three sites corrected — `OWED.md`, `DECISIONS.md` :21353 §1 (the wrong row struck and explained rather than quietly amended), `HANDOFF.md` item 1. **The correction carries what the wrong list hid and is worth more than the error: trial expiry needs NO new infrastructure** — queue, worker process and daily-pattern precedent are already there, two lines below the join sweep. |
| L-2 | **Round 1's replacement 409 was a differently-wrong sentence.** *"…otherwise nobody could hand those out again, and nobody could pay"* — but `OWNER_ONLY_PRIVILEGES` is `["staff.manage"]` alone, so `billing.manage` is not owner-only, and `updateOrgStaffPrivileges` does not exclude self-targeting. **A last owner keeping `staff.manage` — which this very guard guarantees they keep — can tick billing straight back onto their own row.** Recoverable, exactly like `org.manage`. | Causal clause dropped: *"…has to keep both staff management and billing, so somebody in the gym can always hand out the keys and pay."* **Fixed as a CLASS, not a case:** the same self-refuting argument was the stated JUSTIFICATION for the guard at `service.ts`'s `LAST_OWNER_REQUIRED_PRIVILEGES` docblock, and it is rewritten on the reason that actually holds — over-locking is the safe direction and :11429 rule 2 names both doors, so this is **defence in depth, not the only thing between the gym and an unpayable invoice**. The guard's BEHAVIOUR is untouched (R1.1 / rule 6). |
| L-3 | **The corrected sentence had stale copies in the web.** `orgsApi.js` and `StaffPanel.jsx` both quoted the OLD server wording. No user impact — the panel prints `errorText` from the server, never a copy — but it is round 1's own lesson recurring one file over, and no sweep for copies had been done. | Both updated. `StaffPanel.jsx`'s note now records that **the drift happened to that very comment**, which is the paragraph's own rule vindicated by its own staleness. |
| L-4 | **A false statement 630 lines above the writer that falsified it, in the file this round re-measured.** `repo.ts`'s currency-guard note still read *"Unreachable today — nothing in the product inserts into `subscriptions`, grep-verified"* — untrue since `a313861`. **Round 1 quoted this exact guard twice and did not notice.** | Rewritten: the requirement is DISCHARGED (`startGymTrial` is the one writer and takes `lockOrgRow` first), **and it does not expire with the discharge — it binds every future writer**. The identical sentence in `0015`'s SQL is left alone: a shipped forward-only migration, correct at write time, and the reviewer agreed it is not a finding. |
| L-5 | **The line-count-neutral rewrite left a garbled sentence in the index** — two phrasings merged into something ungrammatical — and dropped the `:19083` reference every other document uses, so a chat reading the index alone could not find the struck line. `check-decisions-index` cannot see this (`:19016` resolves correctly), so nothing automated would ever catch it. | Rewritten to parse, with **line 19083 cited UNBOLDED on purpose** — the checker's pointer regex is `**:NNNN**`, and a bold pointer at a mid-entry line is a break the checker is right to refuse. The reason is stated in the entry so the next author does not "fix" it into a break. |
| L-6 | **The currency lock's wake-up trigger named the wrong card.** *"starts working the day the sweep lands"* — but the condition is `status <> 'trialing'`, which a CHECKOUT writing `active` (P3.4/P3.5) satisfies just as well as an expiry sweep (P3.8), and checkout may land first. | Corrected in all three sites (`OWED.md`, `repo.ts`'s `startGymTrial` docblock, `HANDOFF.md` item 2): it wakes **the day a subscription first LEAVES `trialing`, whichever of billing or expiry lands first** — so the first live exercise of this guard may belong to neither of the people currently expecting it. |

**Rule-4 list — two of the three acted on, one accepted as-is.**

| Item | Action |
|---|---|
| `settings.render.test.jsx` — *"says something TRUE about the last owner"* stubbed a hard-coded COPY of the server's sentence and asserted that same copy, so **it stayed green when the server's wording changed and structurally could not have noticed** | **FIXED.** The stub is now an arbitrary `ZZ-MARKER` string that is deliberately not any real server text, so the test can never drift out of step with the API again — because it no longer makes a claim about what the API says. Renamed to what it actually proves (pass-through), and given a negative assertion that the generic fallback is absent. **Mutant: swallow `errorText` in `savePrivileges` → RED**, on this test and three others. |
| The `0015` test never re-asserted the OWNER row after the second backfill run, so *"idempotent by its own WHERE"* was exercised but not asserted | **FIXED.** Asserts the owner's set is unchanged by the second run and that `billing.manage` appears exactly once. **Mutant: delete the `NOT (privileges @> …)` clause → RED** (*"expected [ Array(9) ] to deeply equal [ Array(8) ]"*). |
| M1 is a file-shape guard keyed on the literal token `array_append`, so a semantically identical rewrite would also red it | **ACCEPTED, not fixed.** `0015` is shipped and forward-only, so the statement cannot legitimately be rewritten; M2/M3/M4 are the behavioural guards. Recorded so nobody reads M1 as more than it is. |

**Carried out of the round, not a finding.** `POST /v1/orgs/:gymId/trial` is live and
reachable with `curl` by any gym owner even though **no screen calls it**
(`grep -rn "/trial" apps/web/src` → nothing). That is the whole of the Critical/High's
blast radius today, and it is already named on the trial-expiry `OWED.md` line.

**Kd's to weigh, deliberately NOT actioned by a chat.** The trial-expiry `OWED.md`
line has **no automated trigger**: nothing goes red if the app reaches the internet
with expiry unbuilt — its *"or earlier if the app goes on the internet first"* is
enforced by a human reading a file. **Identical shape to the cost-breaker line two
entries below it**, which is the argument for solving both once rather than either
twice. Put to Kd 2026-08-27 as a "before you go online" decision, not a today one.

---

## THE GYM TRIAL, WEB HALF — KD'S SMOKE, 2026-08-27 (`be21bd0`)

**9/9 reported passed, and BOTH findings are his.** Neither is a defect in what
the app DOES — nothing on screen was false — so both are Low under the severity
gate, and both are fixed here (rule 1: the schedule changes, never the bar).

**The shape worth keeping: a person using the product found something no test,
no mutant and no reviewer could have.** One is a sentence that is true and reads
as a different rule; the other is a step of MINE that could not fail. This is the
fourth time on this branch that only Kd's browser produced a finding.

| # | Finding | Fix |
|---|---|---|
| L-1 | **"One free trial per person." read as the wrong rule.** His words: *"what is this free trial is given to gym i think it need to be mentioned"*. The trial belongs to the GYM; what is capped at one is the PERSON's allowance of them. A line naming only the person invites an owner to read it as a limit on individual app users — a different product rule entirely. **True, therefore Low** (:5807's test is "on screen AND wrong"), and confusing enough that he stopped to ask. | ~~Reworded to name both halves, in the server's own words.~~ **— SUPERSEDED THE SAME DAY: Kd ruled the line OUT.** Shown the reworded version he answered ***"nothing need to mention keep blank"***. **DELETED, not reworded.** Nothing is lost: the rule is still enforced, and still explained at the only moment it bites — the 409's *"It's one per person, not one per gym."*, which the card prints in the server's own words. The no-removal rule's authorised path (an explicit ruling against a stated cost, :10182). **Do not re-add it as an improvement.** Copy only — rule 4a never mutates wording. |
| L-3 | **MY REWRITTEN STEP 6 WAS JARGON, and he caught that too**: *"use the normal app, not the console"* → ***"what console men i am using in web"***. Right twice — it is ALL ONE WEBSITE, so "not the console" reads as though a second application existed, and `user@example.com` staffs nothing so that account has no gym console to avoid anyway. | Rewritten in plain words, naming the **"I'm a member"** door. **Part 0.5's K1 inside a RUNBOOK**, which :12343 already ruled these sheets are held to: a smoke sheet describes what a BEGINNER SEES, never what a thing is called internally. Two jargon findings from one operator message, in the sheet written to be readable. |
| L-2 | **MY SMOKE STEP 6 COULD NOT FAIL, and he is the one who noticed.** It asked that *"nothing anywhere tells this person your gym is on a trial"*; he answered *"nothing anywhere is mentioned now and also nothing anywhere was mentioned before as well it is exactly as it was."* Correct — **no member screen mentions billing at all, in either direction**, so the ✅ was satisfied by a server LEAKING the plan exactly as happily as by one withholding it. :16095 L-3's class (a step whose ✅ is satisfied by the defect it exists to catch), third recorded occurrence. | **Its pass is WITHDRAWN in all four places** (the sheet's RESULT block, the step, DECISIONS, HANDOFF) rather than quietly left standing. The privacy guarantee is carried by the API test that asks for the same gym as the member AND as the owner, **the owner half being the control** — without it the test would pass on a server that told nobody anything. **A browser cannot check this and the sheet now says so**, instead of collecting a ✅ that means nothing. Step 6 is rewritten into something falsifiable: the two new fields ride on the response the MEMBER app reads to draw its gym card, and a contract break makes that card VANISH — so a member's gym card is the visible tripwire on this change. **The new step 6 is UNRUN.** |

**What step 6's withdrawal does NOT cost.** The eight other steps stand, and the
two with the most in them are untouched by it: the meter read **1 of 300 and not
3** on live data — the owner's complimentary seat and the trainer's free seat
both correctly excluded, which is the one number on this screen that could
silently be counted the wrong way — and the **one-trial-per-person refusal fired
on a second real gym owned by the same person**, which is the gate that replaced
Kd approving every gym by hand.

---

## THE GYM TRIAL, WEB HALF — T3 ROUND 1, 2026-08-28 (`c749d2e`)

**Three Low, all fixed in the round** (:5348 rule 1 — the gate changes the
SCHEDULE, never the bar). The round's two Critical/High are not here: they are
fixed, and they held the packet. DECISIONS :21897.

**The shape worth keeping: two of the three are guards and sentences that could
not fail** — one clause nothing could falsify, and one sentence with three homes
and no owner. Neither was a defect in what the app DID.

| # | Finding | Fix |
|---|---|---|
| L-1 | **A banner dismissed on one gym silenced the OTHER gym's for the day.** `closedAt` exists only to re-render on the press, it is gym-agnostic, and it short-circuits ahead of the per-gym stored record — so an owner of two gyms who put one notice away lost the other one too. **Low, and the line is worth reading**: only `trial_info` is dismissible, so nothing FALSE is drawn (:5807's test is "on screen AND wrong") and the amber `trial_urgent` state, which is the one that matters, is not dismissible at all and is untouched. What is lost is a notice, not a truth. | The same one-line class fix as the round's C/H-1: `key={org?.id ?? 'no-gym'}` on `<ConsoleBanner>`. `'no-gym'` rather than a bare `org?.id`. **The reason given here was wrong and is corrected in round 2** — it claimed `undefined` "would have restored the bug for anyone navigating out through the gym list", and that journey was then measured with a bare `org?.id`: it draws correctly, because React reads `'A-id'` → `undefined` → `'B-id'` as two remounts. The control (no key at all) leaked, so the probe could fail. `?? 'no-gym'` is explicitness, not a guard. Mutant **C94**, RED. |
| L-2 | **`cap <= 0` in `seatMeter` could not fail.** `seatCap` is `z.number().int().positive().nullable()` and every console read is `readThrough`-parsed, so a finite cap at or below zero cannot arrive from today's server. Same unfalsifiable shape C88 was deleted for **one round earlier, in the same function**. | **KEPT, not deleted, and the distinction is the whole point.** C88's `typeof` line was LOGICALLY subsumed by the `Number.isFinite` below it — it decided nothing, so deleting it lost nothing. `cap <= 0` is subsumed by **nothing** (`Number.isFinite(0)` is true); it is unreachable only because a schema in ANOTHER PACKAGE says so, which makes it defence in depth against a contract moving rather than dead code. So it takes **C91's resolution from the previous round — keep the guard, plant the fixture that makes it observable** — with a test driving `seatCap: 0` and `-5`, and mutant **C92** deleting only that clause. Without it: `{ used: 0, cap: 0, pressure: true, full: true }`, i.e. *"0 of 0 places used — your gym is full"* at a gym nothing limits. |
| L-3 | **The seat meter's sentence had THREE homes and the full-gym clause had TWO copies** — `billingView`'s banner, the Overview's trial card, and the Members header — with nothing keeping them equal. The banner overhead and the line directly under it could drift into saying different things about the same gym on the same screen. :14493's Low-2 in copy rather than in SQL. | One owner: `seatLineText`, read by all three. Asserted as a **LITERAL** in the test rather than against the function that produces it — :19960's tautological-golden-string finding, which cost that round a second fix. Mutant **C95** drops the full-gym arm. **Visible consequence, stated rather than slipped past: the trailing full stop now appears on all three surfaces**; two of them had none, and unifying the sentence is what makes one owner possible. **What C95 cannot see, said plainly: somebody re-inlining an IDENTICAL copy at a call site.** |

**Not scored, and worth more than any of the three: the permanent guard.**
`gymSwitch.render.test.jsx` now asks one question of the whole console — do
something on gym A, walk to gym B, is anything on screen still about gym A? Four
Critical/High findings have lived on that journey (:20712, :20867, :20986 and
this round's C/H-1) and nothing watched it. **Adding a console panel means adding
a case there.**

**ROUND 2 FOUND THAT GUARD GREEN OVER A BROKEN SCREEN.** It was blind for two
reasons and only one of them was obvious. Recorded here because the paragraph
above oversold it: see the round 2 section below.

---

## THE GYM TRIAL, WEB HALF — T3 ROUND 2, 2026-08-28

**One Low, fixed in the round.** The round's Critical/High is not here: it armed
the :5348 escape hatch, **Kd ruled REDESIGN** (the first such ruling — the four
previous firings all went to PATCH), and it held the packet. DECISIONS entry to
follow with the round's commit.

**⚠️ THE C/H WAS NOT USER-REACHABLE, AND THAT WAS FOUND ONLY WHILE WRITING THE
SMOKE — after the ruling.** The console offers no gym switcher: every path
between two gyms goes through "Your gyms", which unmounts the screen and clears
its state on the way past. Measured on the real journey with the real list and
rail link — gym A's join code appears **x0** under gym B **both with the fix and
without it**. Under :5807 1a the finding therefore fails the "on screen AND
wrong" test, so **it should not have been tagged Critical/High and the escape
hatch should not have fired on it**. The state leakage is real and sits in the
screens; it needs a direct gym-to-gym link to become visible.

**Recorded here rather than quietly dropped, because the ruling it produced was
Kd's and was made on a summary that told him a user sees this.** He was told the
correction, with the option to revert, and the fix stands by his decision. The
process lesson is the reviewer's severity tag and my own repetition of it: BOTH
of us reasoned from what the component does, and neither asked whether the app
draws a path to it. **"Can a user get here?" is a question the severity gate
needs and does not currently ask.**

| # | Finding | Fix |
|---|---|---|
| L-1 | **A comment stated a false measurement as fact** (V1/V5). `ConsoleLayout`'s banner-key comment, and its copy in this file at L-1 above, both said a bare `org?.id` "would quietly restore the bug for anyone navigating out through the gym list". Measured on that exact journey: it does not — React reads `'A-id'` → `undefined` → `'B-id'` as two remounts. **Low because nothing a user sees is wrong**; it is the next reader who is misled, and misled by something wearing the word "Measured". | Both homes corrected, not deleted (:5748), each carrying what was actually measured AND its control (no key at all → the journey leaks, so the probe could fail). The `?? 'no-gym'` code is unchanged and is now described as what it is: explicitness, not a guard. |

**The lesson this round is worth keeping, and it is about the guard, not the
bug.** Round 1's guard could not see round 2's Critical for TWO reasons:

1. **Both gyms were handed the same fake data**, so "still about gym A" was not a
   thing any assertion could say. This one is obvious in hindsight.
2. **And the fake answers arrived instantly.** `mockResolvedValue` settles in a
   microtask, which React has already flushed by the time `findBy*` returns — so
   the stale window is zero frames wide. **Measured: a probe with per-gym data
   and instant answers is GREEN on the broken screen.** Only holding gym B's read
   open — the way a ~200 ms request does — makes the defect visible.

Fixing only (1) would have produced a second guard that passes over the same
broken app. **Anything added to that file copies both halves: different data per
gym, and the second gym's read held.**

---

## THE GYM TRIAL, WEB HALF — T3 ROUND 3 (diff-only), 2026-08-28

**ZERO Critical/High — THE PACKET SHIPS.** Reviews `13fec81`. One Low, fixed
here. **The escape-hatch streak is broken**: rounds 1 and 2 both put a Critical
in `Overview.jsx`; round 3 finds none anywhere.

| # | Finding | Fix |
|---|---|---|
| L-1 | **The fix's own comment promised an invariant nothing enforced.** It said a console screen added later "cannot opt out of it or forget it" — true only because every `/console` route is wrapped in `ConsoleLayout`, which `App.jsx` does BY HAND five times. **A sixth route added without the wrapper would silently lose the guarantee**, and no test could see it: the cases in `gymSwitch.render.test.jsx` declare their own route table, so they are structurally blind to `App.jsx` drifting. | A SOURCE assertion reading `App.jsx`, in the repo's existing pattern (`joinGym.render.test.jsx:317`), failing if any `/console` route is drawn outside `ConsoleLayout` — **with a control asserting at least five routes are found at all**, or a regex that stopped matching would assert nothing over an empty list for ever (:7104's PG1). Comments stripped first, `joinGym`'s own round-2 lesson. **Measured RED**: dropping the wrapper from the Settings route fails with `'/console/:orgSlug/settings → NOT WRAPPED'`. The comment now states the dependency instead of assuming it. |

**Also corrected, raised by the reviewer as a note rather than a finding and
worth more than its billing:** the "THE COST … each screen's own Loading… for one
round trip" paragraph described a cost **no user pays today**, two paragraphs
after the text saying the journey does not exist. Same class as round 2's Low —
a comment true in the abstract and false about the present — so it is fixed on
the same principle rather than left because nobody scored it.

**The instrument note, because it will bite the next person.**
`readFileSync(fileURLToPath(new URL(rel, import.meta.url)))` is this repo's
established way to read source in a test, and it throws **"The URL must be of
scheme file"** in `gymSwitch.render.test.jsx`: that file's top-level
`await import` makes it a module vite-node serves over http, so `import.meta.url`
is not a file URL. Vite's `?raw` import is used instead and is the better
instrument here anyway.
