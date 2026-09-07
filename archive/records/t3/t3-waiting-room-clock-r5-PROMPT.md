You are reviewing, not fixing. **This is a FIFTH round and it is DIFF-ONLY:
cover ONLY round 4's fixes and the surfaces they touch — no fresh pass over the
card** (CLAUDE.md Part I §2.5 rule 2). Audit against R0–R11 and DECISIONS
:11385 (the ruling), :13174 (the smoke, PASSED 10/10) and **:13432 (round 4 —
read this first; it is what you are checking)**.

Output only: (1) violations as rule# · file:line · one-line fix; (2) a security
pass over the changed surfaces; (3) anything that would fail the phase's Done
gate. No praise, no restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (DECISIONS :5348, amended by
:5807). Critical/High = security, data loss, privacy, money, a broken core flow,
**or anything a user can SEE that is FALSE**. Zero Critical/High ⇒ the packet
SHIPS. A Low buys no further round — but it is STILL FIXED and logged in
BACKLOG.md; report it at full severity, never soften it to duck a round.

**ESCAPE HATCH — SAY WHERE IT STANDS BEFORE YOU START.**
Round 1: two C/H in `apps/api/src/modules/orgs/sweep.ts`.
Round 2: one C/H in `apps/web/src/utils/joinClock.js`.
Round 3: one C/H in `apps/api/tools/mutate-orgs.mjs`.
Round 4: one C/H in `apps/web/src/utils/joinClock.js`.
**It has never armed — no two CONSECUTIVE rounds in one subsystem. But
`joinClock.js` has now produced a Critical in two of four rounds, both the same
defect class, and round 4's reviewer flagged that as worth Kd's eyes.**
**If this round finds Critical/High in `joinClock.js` again, that IS two
consecutive rounds in one subsystem: say so and STOP.** Do not propose another
patch there — it becomes Kd's redesign decision and his alone.

Diff: `t3-waiting-room-clock-r5.diff`. Earlier rounds' diffs are `-r1` … `-r4`.
**None of this card is committed**, so the diff is everything against `HEAD`,
not round 4's fixes alone. **Your scope is still round 4's fixes**; the rest has
been through four rounds already.

## What round 4 found, and what changed for it

- **C/H-1** — `expiresInLabel` said "Expires today" the day BEFORE expiry
  (measured: 21 hours out across a local midnight; reachable every day, since
  `expires_at` = `applied_at + 14 days`). **Fix: the reviewer's structural one.**
  `joinClock.js` now states ONE rule — day words compare local calendar days,
  durations measure elapsed time — with `calendarDaysBetween` as the only place
  a day comparison happens. `nextNudgeText` lost its private copy of the helper.
- **Low-1** — `waitingForLabel` said "Asked today" about last night's applicant.
  Same rule.
- **Low-2** — the header declared one exception to a rule three functions broke.
  Replaced by the single rule.
- **Low-3** — `sweep.ts`'s prose named a dead condition as the guard (third
  round running). Corrected with the measurement in it; the condition stays as
  an explicit restatement.
- **Low-4** — round 3's timer comment was contradicted by the file, and its
  "proof" reproduced identically with the fix removed. Calls deleted, claim
  reworded.
- **Low-5** — the harness guard named one file. Now
  `apps/api/scripts/check-harnesses.mjs` walks the directories; `turbo.json`
  gained `tools/**` and `scripts/**` in its lint inputs.
- **Two old tests were updated because they asserted the defect.**

## Aim here first

1. **Attack the new rule, not the old bug.** Every day word in the product now
   flows through `calendarDaysBetween`. Try to make it lie: a DST transition on
   either side, offsets out to ±14h, `now` and the target in different offsets,
   and the exact local-midnight instant. Round 4 fixed a bug that four rounds
   missed — assume this fix has its own corner and go looking for it.
2. **Check the DURATION half did not silently change.** `waitingForLabel` now
   uses BOTH measures. Is "Waiting N days" still elapsed, and does the
   `Math.max(1, days)` floor ever print a number nobody means?
3. **The two updated tests.** They previously asserted the wrong rule. Verify
   the new expectations are right rather than merely green — a test rewritten to
   match the code it tests proves nothing.
4. **`check-harnesses.mjs` is new production-adjacent tooling.** Does the walk
   miss a directory that holds a harness? Is an empty walk really fatal? Does it
   fail for the right reason on a broken file?
5. **Did any round-4 fix create a defect?** Rounds 1→2, 2→3 each did. Round 4
   broke that chain; check whether round 4 restarts it.

## Rule 4 — tests that stay green when what they claim is broken

Write your own mutants. Round 4's sharpest findings — the two tests asserting
the defect, and the "proof" that proved nothing — both came from the reviewer
probing rather than reading. Harness rows for this card are **O48–O57**:
`MUTATE_ONLY=O48,…,O57` with `DATABASE_URL` set, from `apps/api`.

## Measured state (challenge it if you doubt it)

- web **924/924, exit 0** · sweep **18/18** on real Postgres · api tsc clean ·
  api lint clean **including the widened harness check (18 harnesses parse)**.
- Both new boundary tests measured RED against the restored defect; source
  sha256-verified restored.
- Round 3's mutation figures (10/10 RED) were independently re-run by round 4's
  reviewer with no control aborts.
- **`RUNBOOK/smoke-clock.md` PASSED 10/10 on 2026-08-21** (:13174) — not an
  outstanding gate.
- Read exit codes, not summaries. This card has now had three separate findings
  where a number was quoted and the run behind it did not support it.
