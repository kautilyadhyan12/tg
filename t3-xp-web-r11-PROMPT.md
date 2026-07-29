# T3 ROUND 11 — paste this into a FRESH chat

You are reviewing, not fixing.

Task: T3 round 11 on the XP display / Dashboard XP card, branch `web-repoint`.
This round reviews **round 10's fixes** — commit `690cdfb`. The diff is
`t3-xp-web-r11.diff` at the repo root (`git diff HEAD~1..HEAD -- apps/web/src`,
4 files). Round 10's findings and what was done about them are in DECISIONS under
2026-07-29 ("T3 round 10"); HANDOFF.md's top block is the fix chat's own account.

Follow CLAUDE.md Part I.6 (session-start) first: ground in the repo, show
`git log --oneline -3` and `git status --short`, read HANDOFF.md's TOP block and
the tail of DECISIONS.md. **The repo beats this prompt if they disagree — this
prompt is hearsay (V4).**

## THE STOPPING RULE still applies — Kd ruling, 2026-07-29

**A finding blocks the 🔴 OWED ticks only if it is a defect a user could see on
screen.** Tag every finding **VISIBLE** or **NOT-VISIBLE**, justifying a VISIBLE
tag by naming the state a user reaches it in and what they would see. Everything
else is reported at full severity and fixed, but holds nothing.

Round 10's verdict was that **round 11 "should be able to close this, and I
would hold it to that."** If nothing VISIBLE survives, say so plainly.

## Audit against

CLAUDE.md Part II R0–R11 and the spec §§ the card touches. Output only:
(1) violations as `rule# · file:line · one-line fix`; (2) a security pass; (3)
anything that would fail the Done gate.

## Where to look hardest

**Ten rounds running, the previous round's fix has opened the next finding**, and
the last two were both *the other half of what the round before fixed* — round 9
F4 fixed the caption's READINESS and left its COUNTING; round 10 F1 fixed the
counting. Ask what axis of the week strip is still unexamined.

- **`weekDates()` in `gamificationApi.js`** is new and is now the single source
  for both the caption and the dots. It uses `toISOString()` (UTC) while the day
  numbers it renders come from the same string — check the timezone reasoning
  against what the old backend keys `activity` with
  (`completed_at.strftime("%Y-%m-%d")`, `backend-ml/app/routers/workouts.py:86-89`),
  and check the month/year boundary and DST. It has unit coverage only through
  the render tests; decide whether that is enough.
- **The caption's zero.** `activity` arrived and empty now prints "0 of 7 days
  active". Round 10 argues that is a fact, not a fabrication. Test that argument
  against every state (`activity` `{}` vs missing vs a 200 with no `activity`
  key) and against this card's own rule that unknown must never render as zero.
- **`difficultyStyle` / `tierStyle`** now carry 5 and 7 fields. Round 10 found
  that the completeness loop covered only the neutral tier. Check the new
  known-half test actually reaches what it claims, and that no call site reads a
  field neither table defines.
- **The three assertions round 10 added or rewrote** in
  `xpDisplay.render.test.jsx`. Round 10 caught one vacuous assertion in its own
  first draft (`if (x) expect(x).not.toBe('')`) and one adjacency false-positive.
  Assume there is a third.

**Re-measure, do not re-read.** Round 10 claims 13 mutations, 12 RED, and that
round 9's protections still hold. Re-run them and invent ones round 10 would not
have thought of.

## Known-and-declared — do NOT report as new

- **M3** — WeekStrip's date shifted by 24h — survives and is a DATE-DEPENDENT
  equivalent: `weekDates(t)` subtracts `t`'s own Monday offset, so `t` and `t+1d`
  are identical except across a Sunday boundary. If you run this on a Sunday it
  should be RED; that is expected, not a finding either way. The decoupling it
  probes is caught by M13.
- `Object.create(null)` in `Achievements.jsx` (declared before it ran, round 9).
- A1 — `weekState === 'ready'` vs `activity !== null`, verified equivalent.
- Round 8 F6's other eight mutants (MUT-3/4/15/16/17/29/2/10) have their own 🔴
  OWED line and have not been addressed by Round B, round 9 or round 10.
  Confirming they are still alive is useful; reporting the deferral is not.
- `apps/web` is excluded from the root lint gate — on OWED. Parity is the
  measure: six touched files = 1 pre-existing `ChevronRight` error; package-wide
  67 errors / 9 warnings.
- `syncClient.test.js` fails locally because `apps/web/.env` sets `VITE_API_URL`.
- Round 10 disclosed two defects of its own that it caught and fixed in-session
  (a dangling `date.getDate()`, and a document-wide sweep hitting adjacency).
  Verify they are actually fixed; the disclosures are not findings.

## Verification

```
corepack pnpm --filter web exec vitest run src/api/gamificationApi.test.js src/pages/xpDisplay.render.test.jsx
corepack pnpm --filter web exec vite build
```

Baseline: **90 passed**. Every count, lint figure or coverage claim must come
from a command you ran in this chat, with output shown (V1).

## The verdict

Both 🔴 ticks (XP display, Dashboard XP) are OFF pending this round. Say plainly
whether they can go on.
