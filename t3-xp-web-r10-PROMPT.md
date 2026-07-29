# T3 ROUND 10 — paste this into a FRESH chat

You are reviewing, not fixing.

Task: T3 round 10 on the XP display / Dashboard XP card, branch `web-repoint`.
This round reviews **round 9's fixes** — commit `df0ea05`. The diff is
`t3-xp-web-r10.diff` at the repo root (`git diff df0ea05~1..df0ea05 --
apps/web/src`, 5 files). Round 9's findings are in DECISIONS under
2026-07-29 ("T3 round 9: 4 findings"), and HANDOFF.md's top block is the fix
chat's own account of what it did.

Follow CLAUDE.md Part I.6 (session-start) first: ground in the repo, show
`git log --oneline -3` and `git status --short`, read HANDOFF.md's TOP block and
the tail of DECISIONS.md. **The repo beats this prompt if they disagree — this
prompt is hearsay (V4).**

## THE STOPPING RULE still applies — Kd ruling, 2026-07-29

**A finding blocks the 🔴 OWED ticks only if it is a defect a user could see on
screen.** Tag every finding **VISIBLE** or **NOT-VISIBLE**, and justify a VISIBLE
tag by naming the state a user reaches it in and what they would see. Everything
else is still reported at full severity and still fixed — the tag decides the
ticks, not whether the finding counts.

Round 9's own verdict was *"worth one more round; it is not worth a tenth."*
That sentence was about round 9. **This is the round that should close the
card** — so if nothing VISIBLE survives, say so in those words rather than
reaching for something.

## Audit against

CLAUDE.md Part II R0–R11 and the spec §§ the card touches. Output only:
(1) violations as `rule# · file:line · one-line fix`; (2) a security pass; (3)
anything that would fail the Done gate.

## Where to look hardest

**Nine rounds running, the previous round's fix has opened the next finding.**
Round 9's own new artifacts are the highest-yield surface:

- `difficultyStyle()` and the extended `tierStyle()` in `gamificationApi.js` —
  five new fields across two resolvers. Round 9's F1 was *"Round A fixed one of
  eight sites"*; check that round 9 did not itself fix seven of nine. Grep for
  any surviving `${...}NN` concatenation, and check the NEUTRAL values are
  actually valid CSS and visually distinct from the known ones.
- The Dashboard week caption's new third arm, and whether the caption and the
  dots can still disagree in any combination of (state × count).
- The three assertions round 9 added or rewrote in `xpDisplay.render.test.jsx`.
  **Round 9 found that one of Round B's four new assertions could not fail;
  round 9 wrote five more.** Mutate each one. It also caught and fixed a vacuous
  `if (x) expect(x).not.toBe('')` loop in its own first draft — look for others.

**Re-measure, do not re-read.** Round 9 claims 12 mutations, 12 RED, and that
Round B's nine still hold. Re-run them, and invent ones round 9 did not think of
— its list is by definition the attacks it already imagined, which is exactly the
limitation that defeated the regex guard ten times.

## Known-and-declared — do NOT report as new

- `Object.create(null)` in `Achievements.jsx` survives its mutation and always
  will while `Object.hasOwn` stands (declared before it ran, DECISIONS
  2026-07-29).
- A1 — `weekState === 'ready'` vs `activity !== null` is an **equivalent
  mutant**, verified by round 9: `oldPayloadState` returns 'ready' iff
  `stats.activity` is truthy and `readStatsView` makes it an object or null, so
  the two cannot diverge.
- Round 8 F6's other eight mutants (MUT-3/4/15/16/17/29/2/10) have their own 🔴
  OWED line and were not addressed by Round B or round 9. Confirming they are
  still alive is useful; reporting the deferral as undisclosed is not.
- `apps/web` is excluded from the root lint gate — on OWED. Parity is the
  measure: six touched files = 1 pre-existing `ChevronRight` error; package-wide
  67 errors / 9 warnings.
- `syncClient.test.js` fails locally because `apps/web/.env` sets
  `VITE_API_URL`. Known, on OWED, not in these files.
- The round 9 fix chat recorded a process failure of its own (two mutation
  harnesses, one holding stale snapshots, silently reverting three source files
  mid-run). It is in DECISIONS and HANDOFF. Verify the tree is actually correct
  now — that is worth checking — but the disclosure itself is not a finding.

## Verification

```
corepack pnpm --filter web exec vitest run src/api/gamificationApi.test.js src/pages/xpDisplay.render.test.jsx
corepack pnpm --filter web exec vite build
```

Baseline: **87 passed**. Every count, lint figure or coverage claim you make
must come from a command you ran in this chat, with output shown (V1).

## The verdict

Both 🔴 ticks (XP display, Dashboard XP) are OFF pending this round. Say plainly
whether they can go on.
