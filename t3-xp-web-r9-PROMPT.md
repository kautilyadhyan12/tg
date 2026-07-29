# T3 ROUND 9 — paste this into a FRESH chat

You are reviewing, not fixing.

Task: T3 round 9 on the XP display / Dashboard XP card, branch `web-repoint`.
This round reviews **Rounds A and B together** — commits `7b91c68` (F3, F4, F5,
the live defects) and `0869f01` (F1, F2, F6, the protection layer). The diff is
`t3-xp-web-r9.diff` at the repo root: `git diff 733d82b..HEAD -- apps/web/src`,
6 files, scoped to source and tests. Records (DECISIONS/OWED/HANDOFF) are
excluded from the diff but ARE in scope for claim-checking — see below.

Follow CLAUDE.md Part I.6 (session-start) first: ground in the repo, show
`git log --oneline -3` and `git status --short`, read HANDOFF.md's TOP block and
the tail of DECISIONS.md. **The repo beats this prompt if they disagree — this
prompt is hearsay (V4).**

Read `t3-xp-web-r8-FINDINGS.md` in full: it is round 8's verbatim text, and
Rounds A and B are its remedy. A finding is closed only if the remedy actually
reaches it.

## Audit against

CLAUDE.md Part II R0–R11, and the spec §§ the card touches. Output only:
(1) violations as `rule# · file:line · one-line fix`; (2) a security pass —
authn/authz/tenancy, input parsing, idempotency, secrets/log leaks, SQL safety;
(3) anything that would fail the phase's Done gate. No praise, no restating the
diff.

## What this card's history says to look at hardest

**Eight consecutive rounds have found that the PREVIOUS round's fix opened the
next finding.** That pattern has not broken once. Round A's and Round B's own
new artifacts are therefore the highest-yield surface:

- Round A's `tierStyle()` and its `edge` field; `weekState`/`oldPayloadState`
  applied to WeekStrip; `Object.hasOwn` + `Object.create(null)` in Achievements.
- Round B's `statValue`/`tileValue` helpers, the two Sidebar tests, the
  Achievements XP-fails test, and the `\b0\b` whole-document sweeps.

**Claims are the thing this card keeps failing on.** Four rounds' blocking
findings were assertions that could not fail, and five separate false claims
have been carried by the guard section in `gamificationApi.test.js`. So:

- **Re-measure, do not re-read.** Every "this is now protected" statement in
  DECISIONS 2026-07-29 (both entries), OWED and the source comments is a claim.
  Mutate it and see.
- Round B reports **9 mutations, 9 RED**. Re-run them, or better, invent ones it
  did not think of. Round B's own list is the set of attacks it already imagined
  — which is the exact limitation that defeated the regex guard ten times.
- Round B deliberately did NOT restore the sentence "all ten bypasses fail
  there". If you find that claim reinstated anywhere, that is a finding.

**Known-and-declared, do NOT report as new:**

- `Object.create(null)` in `Achievements.jsx` survives its mutation and always
  will while `Object.hasOwn` stands. Declared in the plan before it ran,
  recorded in DECISIONS 2026-07-29 and in the source comment. A test for it
  would be the vacuous assertion this card is about.
- Round 8 F6's other eight mutants (MUT-3/4/15/16/17/29/2/10) were NOT addressed
  by Round B and NOT re-measured. They have their own 🔴 OWED line. Confirming
  they are still alive is useful; reporting the deferral itself as undisclosed
  is not.
- `apps/web` is excluded from the root lint gate (`turbo run lint --filter=!web`)
  — on OWED. "Lint clean" is not evidence; parity is. Measured: touched files
  0 problems, package-wide 67 errors / 9 warnings.
- `apps/web/src/sync/syncClient.test.js` fails locally because `apps/web/.env`
  sets `VITE_API_URL`, falsifying that test's premise. Known, on OWED, in
  neither commit.

## Verification

```
corepack pnpm --filter web exec vitest run src/api/gamificationApi.test.js src/pages/xpDisplay.render.test.jsx
corepack pnpm --filter web exec vite build
```

Baseline: **84 passed** across those two files (75 pre-existing + Round A's 6 +
Round B's 3). Anything else you assert about counts, lint or coverage must come
from a command you ran in this chat, with output shown (V1).

## THE STOPPING RULE — Kd ruling, set 2026-07-29, BEFORE this round ran

**A finding blocks the 🔴 OWED ticks only if it is a defect a user could see on
screen. Everything else is fixed in the same commit but does not hold the line.**

This is the rule Kd set for the PostWorkout card before its round 4 and which
closed that card (DECISIONS 2026-07-28, "THE STOPPING RULE"). It is invoked here
for the same measured reason: **Round A's findings were user-visible** — a blank
Achievements page, a false "Weekly activity unavailable" during a healthy load, a
bronze ring on an unknown badge — **and Round B's were not.** F1, F2 and F6 were
defects of the TEST layer only; nothing on screen was ever wrong, and Round B
changed no component file. What remains in this area is claim-and-assertion work,
which a review can always find more of, so the rule is set in advance rather than
argued about after the findings land.

It is set BEFORE the round deliberately. A stopping rule invented after seeing
the findings is a rationalisation; this one binds whatever you find.

**It does not soften the review.** Report every finding, at full severity, with
the same evidence bar (V1 — measured, not reasoned). Tag each one
**VISIBLE** or **NOT-VISIBLE**, and justify a VISIBLE tag by naming the state a
user reaches it in and what they would see. The tag decides the ticks; it does
not decide whether the finding gets written down or fixed.

## The verdict this round must reach

Both OWED 🔴 ticks (XP display, Dashboard XP) are OFF pending this round. Say
plainly whether they can now go on, applying the rule above. If nothing VISIBLE
survives, say so in those words — this card has run eight rounds and "no
user-visible defect" is a legitimate result, not a failure to look hard enough.
