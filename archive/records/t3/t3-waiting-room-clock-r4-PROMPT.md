You are reviewing, not fixing. **This is a FOURTH round and it is DIFF-ONLY:
cover ONLY round 3's fixes and the surfaces they touch — no fresh pass over the
card** (CLAUDE.md Part I §2.5 rule 2). Audit against R0–R11, and DECISIONS
:11385 (the ruling), :12878 (the build), :13075 (round 1), :13174 (the smoke,
which PASSED 10/10) and **:13247 (round 3 — read this one first; it is what you
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
Round 2: one, in `apps/web/src/utils/joinClock.js`.
Round 3: one (two findings), in `apps/api/tools/mutate-orgs.mjs`.
**Three rounds, three different subsystems, so it has never armed.** **If this
round finds Critical/High in `tools/mutate-orgs.mjs` again, that is two
consecutive rounds in one subsystem: say so and STOP.** Do not propose a third
patch there — it becomes Kd's redesign decision and his alone.

**And name the pattern if you see it.** Three rounds running, a fix has created
the next round's finding: round 1's fix left dead code (round 2's Low-1), round
1's fix for L2 created round 2's Critical, round 2's re-aim created round 3's
Critical. That is not the escape hatch as written — different subsystems each
time — but if you judge it to be the same underlying problem wearing different
files, **say so plainly**. It is the kind of call the hatch exists to surface,
and I would rather hear it than not.

Diff: `t3-waiting-room-clock-r4.diff`. Earlier diffs are
`t3-waiting-room-clock-r1.diff`, `-r2.diff` and `-r3.diff` if you need a
before-state.

**A NOTE ON THE DIFF'S SHAPE, so you can scope yourself correctly.** None of this
card is committed yet, so this diff is everything the card touches against
`HEAD` — not round 3's fixes alone. **Your scope is still round 3's fixes**
(listed below); the rest is there for context and has already been through two
rounds. If something outside that scope looks wrong, say so briefly rather than
auditing it — but do not re-open ground rounds 1 and 2 already covered.

## What round 3 found, and what changed for it

- **C/H-1 (two findings, one class)** — `tools/mutate-orgs.mjs` did not PARSE (a
  raw newline inside a mutant string), so none of its 57 mutants could run;
  and four anchors (O48–O51) were stale, which would have aborted every run
  anyway. **Both were introduced by round 2's re-aim.** **Fix:** syntax
  repaired, all four re-anchored, and `lint` now ends with
  `node --check tools/mutate-orgs.mjs` as the permanent guard (:5348 rule 5).
- **O48 then came back ALIVE and correctly so** — the re-anchor had made it a
  NO-OP, because round 2's Low-1 left the notice comparison as the only
  surviving condition and that is itself NULL for an unflagged row. **Fix:**
  re-aimed at both conditions together; re-run RED.
- **Low-1** — `sweep.ts` still described a TWO-ARM guard and named the wrong arm
  as deleted, while HANDOFF and the index had been corrected. **Fix:** corrected
  in place.
- **Low-2** — a second un-struck copy in `HANDOFF.md`, backwards as well as
  false. **Fix:** struck with both errors named.
- **Low-3** — the tomorrow / couple-of-days boundary was unpinned. **Fix:** a
  case either side, verified RED under the reviewer's own mutant.
- **Low-4** — `vi.useRealTimers()` was the last statement in three test bodies,
  which a failing assertion never reaches. **Fix:** moved to `afterEach`, proven
  by injecting a failure (`1 failed | 52 passed`, no cascade).
- **Low-5** — `joinClock.js`'s header stated an absolute the file deliberately
  breaks. **Fix:** the exception declared where the rule is.

## Aim here first

1. **The harness is the subject this round, so start by running it.**
   `MUTATE_ONLY=O48,…,O57` from `apps/api` with `DATABASE_URL` set. Does every
   anchor still match, does every mutant go RED, and does each go red for the
   guarantee it NAMES rather than for a compile error (:4718 F2)?
2. **Check the re-aimed O48 specifically.** It is the one that survived. Satisfy
   yourself that its new anchor mutates something OBSERVABLE — a no-op that
   reports ALIVE proves nothing, and a no-op that reports RED would be worse.
3. **Judge the permanent guard.** `node --check` catches a syntax error and
   nothing else. Is that the right bar, or does the class that bit here need
   more? Say so either way — I claimed it is the cheapest thing that would have
   caught this.
4. **Did any round-3 fix create a defect?** Three rounds running, a fix has
   created the next round's finding. Ask it explicitly.
5. **The two control aborts.** Both were on tests that pass cleanly alone,
   against a database in Singapore under contention. I read them as the harness
   working (:11846's precedent). **Challenge that reading if you disagree** — if
   they are a real intermittent failure rather than latency, that is
   Critical/High and I have mis-called it.

## Rule 4 — tests that stay green when what they claim is broken

Write mutants of your own rather than only re-running
`apps/api/tools/mutate-orgs.mjs`. Round 1's sharpest finding and round 3's
Low-1 both came from the reviewer's own mutant; the author's harness inherits
the author's blind spots twice over by now.

Harness rows for this card are **O48–O57**. Run with
`MUTATE_ONLY=O48,O49,O50,O51,O52,O53,O54,O55,O56,O57` and `DATABASE_URL` set,
from `apps/api`.

## Measured state (challenge it if you doubt it)

- **Mutation: 10 mutants, 10 RED, 0 ALIVE, 0 never ran**, across three runs
  (O48 re-aimed · O49–O54 · O55–O57), restores sha256-verified, source verified
  free of any leftover mutant. **O56 and O57 — the permanent guards on round 1's
  two Criticals — went RED for the first time in their existence**, which is what
  this round was for.
- sweep suite **18/18** on real Postgres · web suites green after every fix ·
  tsc clean · **lint now includes the harness syntax check and passes**.
- **`RUNBOOK/smoke-clock.md` PASSED 10/10 on 2026-08-21** (:13174) — not an
  outstanding gate.
- Read exit codes, not summaries: this card has now had two separate findings
  where a number was quoted and the run behind it had not happened or had not
  passed.
