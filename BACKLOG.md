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
