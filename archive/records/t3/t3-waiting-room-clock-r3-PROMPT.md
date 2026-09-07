You are reviewing, not fixing. **This is a THIRD round and it is DIFF-ONLY:
cover ONLY round 2's fixes and the surfaces they touch — no fresh pass over the
card** (CLAUDE.md Part I §2.5 rule 2). Audit against R0–R11, and DECISIONS
:11385 (the ruling), :12878 (the build), :13075 (round 1), :13174 (the smoke,
which PASSED 10/10) and **:13247 (round 2 — read this one first; it is what you
are checking)**.

Output only: (1) violations as rule# · file:line · one-line fix; (2) a security
pass over the changed surfaces; (3) anything that would fail the phase's Done
gate. No praise, no restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (DECISIONS :5348, amended by
:5807). Critical/High = security, data loss, privacy, money, a broken core flow,
**or anything a user can SEE that is FALSE**. Low = spelling, comments, naming,
style. Zero Critical/High ⇒ the packet SHIPS. A Low finding buys no further
round — but it is STILL FIXED and logged in BACKLOG.md; report it at full
severity, never soften it to duck a round.

**ESCAPE HATCH — CHECK IT BEFORE YOU START AND SAY WHERE IT STANDS.**
Round 1: two Critical/High, both in `apps/api/src/modules/orgs/sweep.ts`.
Round 2: one Critical/High, in `apps/web/src/utils/joinClock.js` — **zero in
`sweep.ts`**, which is why the hatch did not arm. **If this round finds
Critical/High in `joinClock.js` again, that is two consecutive rounds in one
subsystem: say so and STOP.** Do not propose a third patch there — it becomes
Kd's redesign decision and his alone.

Diff: `t3-waiting-room-clock-r3.diff`. Earlier diffs are
`t3-waiting-room-clock-r1.diff` and `-r2.diff` if you need a before-state.

**A NOTE ON THE DIFF'S SHAPE, so you can scope yourself correctly.** None of this
card is committed yet, so this diff is everything the card touches against
`HEAD` — not round 2's fixes alone. **Your scope is still round 2's fixes**
(listed below); the rest is there for context and has already been through two
rounds. If something outside that scope looks wrong, say so briefly rather than
auditing it — but do not re-open ground rounds 1 and 2 already covered.

## What round 2 found, and what changed for it

- **C/H-1** — `nextNudgeText` bucketed by elapsed HOURS and printed a CALENDAR
  word ("later today" for a slot that was tomorrow morning). **Fix:** it now
  compares LOCAL CALENDAR DAYS via a `localDayIndex` helper.
- **Low-1** — round 1's own fix left arm 1 of the expiry guard as **dead code**
  while four documents called it load-bearing. **Fix:** arm deleted, guard is
  one condition, the false claim struck in `sweep.ts`, `DECISIONS.md`,
  `HANDOFF.md` and the index, and **mutant O56 re-aimed** at the notice
  subtraction.
- **Low-2 + Low-4** — `joinClock.js` had no unit test. **Fix:**
  `joinClock.test.js`, every test on a boundary or a refusal.
- **Low-3** — a day-boundary flake in `console.render.test.jsx`. **Fix:** clock
  pinned half an hour inside the day.
- **Low-5** — lock duration on the C/H-2 transaction: recorded against the
  existing no-batch-limit `OWED.md` line, not actioned.

## Aim here first

1. **`localDayIndex` is new date arithmetic and it is the Critical's fix.**
   `Math.floor((t - offset*60000) / 86400000)`. Check it across a DST
   transition, across the international date line, and where `now` and `at` fall
   in zones with different offsets from each other. Does it ever say "later
   today" for tomorrow, or "tomorrow" for today?
2. **Is the deleted arm really dead?** Re-derive it — do not take round 2's word
   or mine. If there is any reachable state where the deletion changes an
   outcome, that is Critical/High: it would mean a request expiring with less
   notice than the promise.
3. **Mutant O56 was re-aimed.** Run it. Does it go RED, and does it go red for
   the guarantee it names rather than for a compile error (:4718 F2)?
4. **The new test file.** Its own first draft failed because it was written in
   UTC while the suite pins `Asia/Kolkata`. Check the corrected cases actually
   distinguish local-day from elapsed-hours — a test that passes under both
   rules pins nothing.
5. **Did any round-2 fix create a defect?** This project has shipped a Critical
   created by a Low fix (:6277), and round 2's own Critical was created by a
   round-1 Low fix. Ask it explicitly.

## Rule 4 — tests that stay green when what they claim is broken

Write mutants of your own rather than only re-running
`apps/api/tools/mutate-orgs.mjs`. Round 1's sharpest finding and round 2's
Low-1 both came from the reviewer's own mutant; the author's harness inherits
the author's blind spots twice over by now.

Harness rows for this card are **O48–O57**. Run with
`MUTATE_ONLY=O48,O49,O50,O51,O52,O53,O54,O55,O56,O57` and `DATABASE_URL` set,
from `apps/api`.

## Measured state (challenge it if you doubt it)

- sweep suite **18/18** on real Postgres, against the simplified guard.
- web **919/919, exit 0, on three consecutive runs** — stated that way
  deliberately: round 2's Low-3 was that "906/906, exit 0" had been true of a
  run and not of the suite, and that is the second time on this card a number
  was quoted without the run behind it holding up. Read exit codes, not
  summaries.
- tsc clean on api and shared · eslint clean on every changed file.
- **`RUNBOOK/smoke-clock.md` PASSED 10/10 on 2026-08-21** (:13174) — the smoke is
  not an outstanding gate. Two defects in the SHEET were found and fixed during
  that run; the app was not at fault in either.
