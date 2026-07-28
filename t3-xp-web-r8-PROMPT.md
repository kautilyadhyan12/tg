# T3 ROUND 8 — web XP display + Dashboard XP card

Paste everything below the line into a **FRESH Claude Code chat in this repo**
(not a subagent — a subagent review is not a T3).

**Nothing needs attaching.** Claude Code loads `CLAUDE.md` automatically and can
read every other file from disk; the prompt names the paths. The upload list this
file used to carry was inherited from the claude.ai workflow in CLAUDE.md Part I
§3, which was written for chats that cannot see the repo. In Claude Code, an
upload is a stale COPY of a file the reviewer can read live — which is the exact
failure this round exists to avoid, since the diff it reviews had already gone
stale once.

---

You are reviewing, not fixing. Audit this diff strictly against CLAUDE.md Part II
R0–R11. Output only: (1) violations as rule# · file:line · one-line fix; (2) a
security pass — authn/authz/tenancy, input parsing, idempotency, secrets/log
leaks, SQL safety; (3) anything that would fail the phase's Done gate. No praise,
no restating the diff.

READ FROM DISK — nothing is attached and nothing needs to be:
  · the diff under review: `t3-xp-web-r8.diff` at the repo root
  · the spec: `docs/spec/07-part7-retention.md` (§2 Form Score / gamification)
  · `CLAUDE.md` is already loaded for you
Read the CURRENT files too, not only the diff — every file it touches is on disk
and the live copy is the one that ships.

## What this diff is

The web XP/level display repointed off the old ML backend onto
`/v1/gamification/me`, plus the Dashboard's own XP surfaces. Branch
`web-repoint`. The class of defect both cards exist to DELETE is **fabrication** —
rendering `0` / `Level 1` / `0 of —` when nothing actually knows the value. The
governing rule, written by the operator: **an unknown must show a dash, not a 0.**

Scope: `1164a86..HEAD`, restricted to this card's own ten files — the card's whole
life, at its current state. **`PostWorkout.jsx` is deliberately NOT in the diff.**
It became a fifth `useXp` consumer on 2026-07-27 and you will see it named in the
guard's consumer list; it was separately reviewed over four rounds and closed. It
is not round 8's subject. Everything else the guard names is in scope.

## SEVEN rounds already ran. Assume the pattern continues

Rounds 1–7: **63 findings, 21 blocking.** In every single round, the PREVIOUS
round's fix had opened a new instance of the defect the card exists to remove.
Not once did the pattern break. Some of the through-line:

- R4 F2: round 3's `statsKnown` fix was **the same defect under a new name** —
  it asserted the ENVELOPE, then six sites read fields off it with `?? 0`. The
  guard permitted `?? 0` while banning `|| 0`, which is the spelling the code was
  actually written in.
- R5 F1: round 4's per-tab fix branched on the ENVELOPE's state, so "200 arrived,
  list absent" matched neither arm and three tabs said `Loading…` **permanently**.
- R6 F1: round 5's fix **inverted** the defect — a catalog that arrived and
  rendered on screen got "Badges are unavailable right now." printed directly
  above two visible badge cards. A false denial of visible content.
- R7 F2: round 6's difficulty fix was recorded in DECISIONS as a "class fix". It
  covered **one site of three**.
- R7 F3: round 6's own ruling (an assertion whose stated failure mode the code
  cannot produce is vacuous) was violated **by the commit that made the ruling**,
  and the false premise then propagated into two source comments, DECISIONS,
  OWED and the commit message.

**Treat round 7's fixes as the most suspect code in the diff.**

## Never-reviewed bytes — everything after commit `9644fa5`

Round 7's diff was cut one minute after its own fix commit, so these 359 lines
have had **zero rounds** on them. They arrived via the PostWorkout card, which
reviewed them for PostWorkout's purposes — not for these four screens':

```
apps/web/src/api/gamificationApi.js          |  20 +
apps/web/src/api/gamificationApi.test.js     |  84 +-
apps/web/src/hooks/useXp.js                  |  18 +-
apps/web/src/pages/xpDisplay.render.test.jsx | 252 +-
```

Specifically: `formatXpEarned` MOVED into `gamificationApi.js` from a page (so
its tests are new here), the `useXp` consumer-count comment (which has now gone
stale twice, and been corrected twice), and the render-test file more than
doubling. **A helper moved into a shared module is a new export with four
consumers, not a relocation** — check what else can now reach it.

## The highest-yield attacks, in order

**1. Mutation, not reading.** The last four rounds produced 7 blocking findings
and ZERO user-visible defects: every one was **an assertion that could not fail**,
or a claim nobody measured. Reading an assertion tells you nothing. Pick the
assertions that protect this card's core (level, fraction, bar width, earned
count, difficulty colour) and ask what mutation would leave them green. Known
escapes: a `\b` word boundary that cannot match inside a run of digits; a
`getAllByText(...).length >= 2` satisfied by two sites on the SAME component;
a `waitFor` whose asserted value is also the animation's STARTING value.

**2. The source guard in `gamificationApi.test.js`.** Meant to stop the
fabrication class returning. **It has been defeated at least seven times** —
including by `{xp ? xp.level : 1}` (this codebase's own idiom), by `?? 0` where
it banned only `|| 0`, and by a test string containing `/*` which made the
comment-stripper eat the rest of the file so every negative assertion passed
vacuously. Its consumer list is derived from the hook's importers; check the
derivation, not the list.

**3. Three states, never two.** `useXp` returns `{xp, status}` and
`oldPayloadState`/`listState` exist because "loading" and "failed" collapsing
into one state has caused a blocking finding in rounds 4, 5, 6 AND 7 — in both
directions (a failure claim during a healthy load; a permanent `Loading…` against
a hung backend that never times out — `mlApi` sets no timeout). Find the fifth.

**4. Element-level reads.** Rounds 2, 3, 4 each closed the bare reads they could
see and each missed a layer: envelope → list → **element**. `readBadge` /
`readChallenge` / `readLeaderboardEntry` / `readRecommendation` / `readRecentWorkout`
exist for that. Check every render site actually goes through them, and check the
readers themselves for the round-7-F7 shape (`earnedBadgeCount([null])` threw one
layer inside the fix for `earnedBadgeCount(undefined)` throwing).

**5. A throw in render blanks the whole page.** There is no ErrorBoundary
anywhere in `apps/web` (grep-verified). Round 6 F2: a non-array `recommendations`
reached `.slice().map()` and blanked the Dashboard.

## Also in scope

The `.js` files are not typechecked (`apps/web` is JS + JSX), so R2's protections
do not apply mechanically here — say so if you find something a typed boundary
would have caught. And per V1/V2: any count, line number or "the file contains X"
claim in YOUR review must come from a command you ran, not from reading. Findings
in past rounds have been wrong in the operator's favour and against it; one
round's proposed fix would have undone a security fix (`listen(8000, '::')` is
the IPv6 wildcard, not loopback).
