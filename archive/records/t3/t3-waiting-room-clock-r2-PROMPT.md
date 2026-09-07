You are reviewing, not fixing. **This is a RE-REVIEW: cover ONLY the round-1
fixes and the surfaces they touch — no fresh full pass** (CLAUDE.md Part I §2.5
rule 2). Audit against R0–R11, Part 3 §2.4/§4.3, and DECISIONS :11385 (the
ruling), :12878 (the build) and :13075 (round 1 — read this one first; it is
what you are checking).

Output only: (1) violations as rule# · file:line · one-line fix; (2) a security
pass over the changed surfaces; (3) anything that would fail the phase's Done
gate. No praise, no restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (DECISIONS :5348, amended by
:5807). Critical/High = security, data loss, privacy, money, a broken core flow,
**or anything a user can SEE that is FALSE**. Low = spelling, comments, naming,
style. Justify a Critical/High tag by naming the concrete failure. Zero
Critical/High ⇒ the packet SHIPS. A Low finding buys no further round — but it
is STILL FIXED and logged in BACKLOG.md; report it at full severity, never
soften it to duck a round.

**ESCAPE HATCH — READ THIS BEFORE YOU START.** Round 1 found two Critical/High
in `modules/orgs/sweep.ts`. **If this round finds Critical/High in that same
file, that is two rounds running in one subsystem: say so and STOP.** Do not
propose a third patch — it becomes Kd's redesign decision, and it is his alone
to make.

Diff: `t3-waiting-room-clock-r2.diff`. Round 1's own diff is
`t3-waiting-room-clock-r1.diff` if you need the before-state.

## What round 1 found, and what was changed for it

**C/H-1 — the ordering rule was a yes/no where the promise is a duration.**
`gym_notified_at <= expires_at` was satisfied by a flag raised a minute before
the deadline; measured at 31 minutes' notice against a promise of two days.
**Fix:** both arms now measure the same `EXPIRY_NOTICE_DAYS`, one back from
`expires_at` and one back from `now`.

**C/H-2 — the expiry and its audit rows were two transactions.** **Fix:** one
`sql.begin` around both; the audit writer is injectable so the failure is
testable (`purge.ts`'s `purgeOne` precedent).

**Seven Lows**, all fixed: three about copy claiming calendar facts off elapsed
arithmetic; `nextNudgeAt` being added and then ignored; an unscoped test sweep
that could expire a sibling suite's rows (closed with a `gymIds` option on the
sweep); a false comment; a cross-module import moved to `utils/joinClock.js`;
and smoke-sheet counts corrected. Plus a production refusal on
`tools/orgs-sweep.ts --now`.

## Aim here first

1. **Re-derive the C/H-1 fix rather than reading it.** Two arms, one constant.
   Ask both directions: (a) can any sequence of runs still delete a request the
   gym had less than `EXPIRY_NOTICE_DAYS` to act on? (b) can any sequence now
   leave a request that can NEVER die? Round 1's finding was that the first
   version answered one and not the other, so check both.
2. **Did either fix create a defect?** Round 1's C/H-2 fix moved a statement
   into a transaction that also runs a loop of inserts — consider lock duration
   and the no-batch-limit `OWED.md` line together. This project has shipped a
   Critical created by a Low fix before (:6277); ask the question explicitly.
3. **`gymIds` is new production surface added to serve a test.** Judge it.
   Is the `(NULL IS NULL OR gym_id = ANY(...))` composition correct in all four
   statements, and does an empty array behave sanely? Does the nightly job still
   sweep everything?
4. **The new tests.** For each of the two regression tests, satisfy yourself it
   fails without its fix — the C/H-2 one asserts a rollback, which is only a
   real assertion if the audit genuinely shares the transaction.
5. **The copy changes.** `nextNudgeText` buckets by hours and prints
   "later today" / "tomorrow" / "in a couple of days". Is any of that sayable
   and false?

## Rule 4 — tests that stay green when what they claim is broken

Round 1 found two weak instruments (`expect(undefined).not.toBeNull()` passing;
table-wide counts satisfiable by rows the test never created) — both addressed.
**Check the new and changed tests for the same shapes**, and write mutants of
your own rather than only re-running `apps/api/tools/mutate-orgs.mjs`: round 1's
sharpest finding came from the reviewer's own mutant, and O51 survived my first
sweep for exactly the reason a borrowed harness inherits its author's blind
spots.

Harness rows for this card are **O48–O57**; O56 and O57 pin the two round-1
fixes. Run them with
`MUTATE_ONLY=O48,O49,O50,O51,O52,O53,O54,O55,O56,O57` and `DATABASE_URL` set,
from `apps/api`.

## Measured state (challenge it if you doubt it)

- sweep suite **18/18** on real Postgres; the three orgs suites run together.
- web **906/906, exit 0, no error line** — round 1's own instrument finding was
  a fixture that made the suite exit 1 while printing all-passed, so read the
  exit code, not the summary.
- shared 48/48 · `vite build` ✓ · tsc clean on api and shared · eslint clean on
  every changed file.
- **`RUNBOOK/smoke-clock.md` — state whether it has been run when you review.**
  If it has not, that is a GATE, not a finding.
