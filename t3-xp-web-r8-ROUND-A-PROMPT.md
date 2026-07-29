# ROUND A — fix T3 round 8's three LIVE defects (F3, F4, F5)

Paste everything below the line into a **FRESH Claude Code chat in this repo**.
Nothing needs attaching — `CLAUDE.md` loads automatically and every file named
below is on disk.

---

Task: **T3 round 8, Round A — fix the three LIVE defects on branch `web-repoint`:
F3, F4 and F5.** Kd approved this split on 2026-07-28; Round B (F1, F2, F6, the
protection layer) is a SEPARATE later chat and is out of scope here.

Follow CLAUDE.md Part I.6 (session-start) first: ground in the repo, show
`git log --oneline -3` and `git status --short`, read HANDOFF.md's TOP block and
the tail of DECISIONS.md. The repo beats this prompt if they disagree — this
prompt is hearsay (V4).

**Read `t3-xp-web-r8-FINDINGS.md` in full before planning.** It is the reviewer's
verbatim text. The three findings in scope:

- **F4 · `Achievements.jsx:431-436` and `:61`** — `b.category in CATEGORY_LABELS`
  walks the prototype chain, so a category of `toString` / `constructor` /
  `valueOf` / `__proto__` / `hasOwnProperty` is treated as a known key;
  `badgesByCategory[key]` then resolves to the inherited `Object.prototype`
  member, which is truthy, so the array is never created and `.push` is called on
  a function. **The entire Achievements page renders blank** — there is no
  ErrorBoundary in `apps/web`. `category` is `text(b?.category)`: any non-empty
  string from the old backend, i.e. external input used as an object key (R2.3).
  The same shape is at `:61` (`badge.tier in TIER_CONFIG`), where an unknown tier
  takes the known-tier path with every style `undefined`.
- **F3 · `Dashboard.jsx:461-463` and `:62`** — WeekStrip and its caption branch
  on `stats.activity === null` alone, collapsing loading and failed. Against a
  hung old backend (`mlApi` sets no timeout) the page permanently claims
  "Weekly activity unavailable" plus seven "Activity unavailable" dot tooltips,
  while the sibling pane in the same component correctly says "Loading recent
  workouts…". `oldPayloadState` exists for exactly this and was applied to
  `recsState` and `recentState` in round 7 but not here.
- **F5 · `GamificationStrip.jsx:317-320`** — the tier ternary's final `else` is
  bronze, so an UNKNOWN tier is painted as a definite one; the pill prints "—" in
  bronze while `Achievements`' BadgeCard renders the same badge neutral. Round 6
  F5 fixed one of the two sites. The reviewer's fix: export a tier-colour
  resolver from `gamificationApi.js` the way `difficultyColor` was, and call it
  from BOTH sites.

## The rules that bind this round

1. **R9.5 — a bug fix starts with a FAILING test that reproduces it.** Write the
   test, show it RED, then fix, then show it GREEN. Round 7's F5/F6 fixes shipped
   with no test at any layer and round 8's mutation run proved every one of them
   reintroducible. That is the specific failure this round must not repeat.
2. **Mutation-test every assertion you add, before you claim it protects
   anything.** Restore from a `cp` backup, never `git checkout --`. The last four
   rounds produced 7 blocking findings and ZERO user-visible defects — every one
   was an assertion that could not fail.
3. **This is the EIGHTH consecutive round in which the previous round's fix
   opened the next finding.** F5 is the eighth instance of "fixed at one of N
   sites". So when you fix F5, enumerate EVERY site that resolves a tier or a
   colour from a nullable field and prove you got all of them — do not fix the
   two the reviewer named and call it a class fix. Round 6 F3 and round 7 F2 are
   both that exact mistake, recorded.
4. **Do not widen scope.** F1, F2 and F6 are Round B. The four non-blocking
   findings have OWED lines already and stay there. If you find something new,
   report it in one line at the end (R1.1).
5. `apps/web` is JavaScript and is **excluded from the lint gate** (root lint is
   `turbo run lint --filter=!web`, on OWED) — so "lint clean" is not evidence
   here. Scoped lint parity against the committed version is.

## What to produce

A **PLAN only** first (CLAUDE.md Part I §2): the files you will touch, the tests
you will write and what each must catch, the mutations you will run against them,
and any SPEC GAP. **No implementation code until Kd approves it.**

Then, after approval: implement, and give Kd the exact commands to run. He runs
them and pastes real output; you never declare success on output you have not
seen. Finish with the R0–R10 self-audit table, the universal DoD checklist,
`DEVIATION/SPEC GAP: none` or the list, and the HANDOFF block.

## Verification commands for this round

```bash
corepack pnpm --filter web exec vitest run src/api/gamificationApi.test.js src/pages/xpDisplay.render.test.jsx
corepack pnpm --filter web exec vite build
```

Baseline before you start: **75 passed** across those two files. The separate
`syncClient.test.js` failure is a known local env quirk with its own OWED line —
it is not yours and must not be "fixed" here.
