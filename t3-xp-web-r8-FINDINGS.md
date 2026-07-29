# T3 ROUND 8 — findings, verbatim

Run 2026-07-28 in a fresh chat against `t3-xp-web-r8.diff` (regenerated
`1164a86..HEAD`, the card's ten files). Reviewer's method: 31 mutations against
the committed tree, each run through `gamificationApi.test.js` +
`xpDisplay.render.test.jsx` (baseline 75/75 green). **16 caught, 15 survived.**
Plus 4 render probes. Working tree restored and re-verified clean.

**Recorded verbatim** so the fix chat reads the reviewer's own words rather than
a summary. A paraphrase of a finding is hearsay (V4), and this card has already
lost three rounds to claims nobody re-measured.

**INDEPENDENTLY VERIFIED 2026-07-28** by the chat that received it, before any
plan was written — all six blocking findings confirmed against the current
files, no overstatement found. Evidence recorded in DECISIONS under this date.

---

## (1) Violations

### 🔴 F1 · R9.5, R11.3 · `Sidebar.jsx:164` + `xpDisplay.render.test.jsx:72-75` — the card's own defect is reintroducible with the suite green

`Level {(xp ?? { level: 1 }).level}` in Sidebar — verbatim the live bug this card
was opened to delete (`user?.level || 1`, "Level 1" for every user) — survives
everything. **MUT-28 GREEN.**

Two independent reasons, and each is a claim the repo makes and does not hold:

1. `FIELD_READ` (`gamificationApi.test.js:517`) requires `.` or `[` after `xp`;
   `xp ??` has neither. This is documented bypass #6 (the destructure).
2. The render test never mounts Sidebar. Its imports are Dashboard,
   Achievements, GamificationStrip, PostWorkout. **The one consumer where the
   original bug lived is the one with zero DOM coverage.**

`gamificationApi.test.js:454-457` and DECISIONS 2026-07-26 (line 1173) both
assert "all ten bypasses fail there … it does not care how a fabrication was
spelled." Falsified twice: MUT-28 (Sidebar) and MUT-34 (Achievements) are both
bypass #6 and both GREEN. That is the fifth false claim this guard section has
carried, and it is the one the section was rewritten to stop making.

**Fix:** render Sidebar in `xpDisplay.render.test.jsx` with `getMe` DEAD; assert
`container.textContent` matches neither `/Level\s*\d/` nor `/\bL\d/`. Then
correct the two "all ten bypasses" claims to what is measured.

### 🔴 F2 · R9.5 · `Achievements.jsx:483-492` — Achievements' XP header is never rendered in the unknown state

All 12 Achievements tests use `getMe.mockResolvedValue({ data: XP_LEVEL_3 })`;
none uses DEAD (verified by grep of every `getMe.` line in the file). Dashboard,
GamificationStrip and PostWorkout each have an XP-fails fixture; Achievements has
none — so `formatLevel`, `formatXpTotal`, `formatXpFraction`, `formatNextLevel`
and `xpBarWidth` on that page are only ever exercised with a known block.
**MUT-34 GREEN** confirms: the destructure fabrication renders "Level 1" there
with all 75 green.

**Fix:** one Achievements test with `getMe` DEAD asserting the whole-document
sweep (`not.toMatch(/Level\s*\d/)`, `toMatch(/—\/—/)`), matching the Dashboard
test at line 185.

### 🔴 F3 · three states, never two — the fifth, and it is LIVE · `Dashboard.jsx:461-463` + `Dashboard.jsx:62`

WeekStrip and its caption branch on `stats.activity === null` alone — loading and
failed collapsed. Probe A, measured with `getStats` HANGS (`mlApi` sets no
timeout, so this is permanent):

```
PROBE A caption: UNAVAILABLE CLAIMED
PROBE A dashed dots: 7
PROBE A recent-workouts pane: Loading
```

A failure claim plus seven "Activity unavailable" tooltips during a genuinely
in-flight read — while the sibling pane eight inches away in the same component
correctly says "Loading recent workouts…". That is round 3 F2 / round 7 F1's
defect, at the one site in `Dashboard.jsx` that `oldPayloadState` was not applied
to. Round 7 fixed `recsState` and `recentState` and left this.

**Fix:** `const weekState = oldPayloadState({ data: stats.activity, loading });`
caption = loading → "Loading this week…", failed → "Weekly activity unavailable";
pass the state to WeekStrip so the dots' `title` matches.

### 🔴 F4 · R2.3 — a render throw blanks the page, fifth route to finding ① · `Achievements.jsx:431-436`

`b.category in CATEGORY_LABELS` walks the prototype chain, so a category of
`toString` / `constructor` / `valueOf` / `__proto__` / `hasOwnProperty` is
treated as a known key; `badgesByCategory[key]` then resolves to the inherited
`Object.prototype` member, which is truthy, so the array is never created and
`.push` is called on a function. Probe C, measured:

```
PROBE C body length: 0
TypeError: badgesByCategory[key].push is not a function
```

The entire Achievements page is blank — XP header included. `category` is
`text(b?.category)`, i.e. any non-empty string from the old backend: external
input (R2.3) used as an object key with no own-property guard. Structurally
identical to round 6 F2 (non-array → `.slice()` → blank page), one layer in — the
round-7-F7 shape again.

**Fix:** `Object.hasOwn(CATEGORY_LABELS, b.category)` at line 433 and
`const badgesByCategory = Object.create(null)` at 431. **Same at
`Achievements.jsx:61`** (`badge.tier in TIER_CONFIG` → `tierKnown` is true for
`toString`, so an unknown tier takes the known-tier path with every style
`undefined` — round 6 F5 through the prototype chain).

### 🔴 F5 · round 6 F5 fixed at one of two sites · `GamificationStrip.jsx:317-320`

```js
b.tier === 'silver' ? '#c0c0c0' : '#cd7f32';   // unknown tier → BRONZE
```

Probe D, measured on the same badge in both components:

| | tier pill colour |
|---|---|
| GamificationStrip "Latest Badges" | `rgb(205, 127, 50)` — bronze (card border bronze too) |
| Achievements BadgeCard | `rgba(255, 255, 255, 0.45)` — neutral |

The pill prints "—" in bronze: the text says unknown, the colour makes a definite
claim. Round 6 F5's exact finding ("`|| TIER_CONFIG.bronze` FABRICATED a tier"),
fixed in one component and left live in the other — the same one-of-N shape as
round 7 F2's difficulty ternary, which was itself round 6 F3 fixed one-of-three.
**Eighth occurrence of this pattern.**

**Fix:** export the NEUTRAL_TIER / tier-colour resolver from `gamificationApi.js`
the way `difficultyColor` was, and call it from both sites.

### 🔴 F6 · R9.5 · the assertion layer, measured — 15 of 31 mutants survived

Round 7's own fixes are the least covered code in the diff, exactly as the
kickoff predicted.

| Mutation | Result |
|---|---|
| MUT-3 `orUnknown(badge.name)` → bare read (round 7 F5) | GREEN |
| MUT-4 `orUnknown(challenge.icon)` → bare read (round 7 F5) | GREEN |
| MUT-15 `orUnknown(badge.xpReward)` → bare read | GREEN |
| MUT-16 `orUnknown(b.name)` (Latest Badges) → bare read | GREEN |
| MUT-17 `orUnknown(ex.primaryCategory)` → bare read | GREEN |
| MUT-29 `entry.isCurrentUser === true` → truthy (round 7 F6) | GREEN |
| MUT-2 rec pill background → hard-red for unknown (round 7 F2's own site) | GREEN |
| MUT-21 Total Workouts → `?? 0` | GREEN |
| MUT-24 Calories Burned → `?? 0` | GREEN |
| MUT-26 This week tile → `?? 0` | GREEN |
| MUT-20 Your Rank → `?? 0` | GREEN |
| MUT-10 useXp: malformed 200 reported ready | GREEN |

**MUT-20/21/24/26 are the serious four:** numeric fabrications — the defect class
the card exists to delete — reintroduced at four render sites with all 75 tests
green. **MUT-21 is round 4 F2 verbatim** ("0 workouts / 0h / 0 kcal printed as
fact").

The mechanism is the kickoff's known escape, generalised:
`expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)` at render
test `:144`, `:161`, `:182` is **a floor with two dashes of slack** — in the DEAD
fixture five sites render "—", so any one of them can start fabricating and the
floor still passes. The stat number itself is explicitly unasserted (comment at
line 176-177: "not asserted here").

**Fix:** replace the floors with identity assertions per site
(`screen.getByText('Total Workouts').previousElementSibling.textContent === '—'`,
etc.), and add a whole-document `expect(text).not.toMatch(/\b0\b/)`-class sweep to
the DEAD fixture the way the XP-fails test at line 205-207 already does. **Then
mutation-test each new assertion before calling F6 closed** — the standing lesson
from rounds 6 F11 and 7 F3.

---

## (2) Security pass

| Area | Result |
|---|---|
| authn | `getMe` rides `authApi` (httpOnly cookie client) — R10.1 clean. Guard test at `gamificationApi.test.js:50` pins it and asserts `mlApi` saw nothing. |
| authz / tenancy | N/A — client-side; no id-addressable reads added. |
| input parsing | New API's payload → `xpViewSchema` from `@app/shared` (R2.3/R7.2 ✅, verified at `packages/shared/src/gamification.ts:20-27`). Old payloads → hand-rolled readers; the "not Zod because they die at P2.8" rationale is a stated, reasoned deviation, and every element reader is unit-covered. **One parse hole: `text()` validates non-emptiness, never key-safety — see F4.** |
| idempotency | N/A (GET only). |
| secrets / log leaks | Clean. All 6 `console.error` calls in the touched files are `err?.message` only (grep-verified) — R3.10 held, including the two Dashboard sites round 5 fixed. No token, no axios config, no payload. |
| SQL | N/A. |
| injection | `Dashboard.jsx:591` `encodeURIComponent(ex.id)` ✅. |
| DoS-by-render | F3/F4 are the real availability issues: one unguarded key lookup blanks a whole authenticated page and there is no ErrorBoundary in `apps/web` (grep-confirmed). |

---

## (3) Done-gate / non-blocking

- **R9.5 is the gate this card fails.** "A bug fix starts with a failing test that
  reproduces it." Round 7's F5 and F6 fixes shipped with no test at any layer
  (MUT-3, 4, 15, 16, 17, 29 all GREEN), and round 7 F2's fix is asserted on
  colour but not background (MUT-2 GREEN). Round 6's own anti-vacuous-assertion
  ruling, violated again by the round that issued it — for the third consecutive
  round.
- **lint** — `pnpm --filter web lint` fails: 67 errors package-wide, 2 in files
  this diff touches (`Sidebar.jsx:8` unused `Zap`, `Achievements.jsx:5` unused
  `ChevronRight`). Both pre-existing on master (verified) and correctly untouched
  per R1.1. **CI stays green only because root lint is
  `turbo run lint --filter=!web`** — so the DoD "lint clean" box is true by
  exclusion, not by fact. Worth stating plainly rather than ticking.
- **New deps** — `@testing-library/react`, `jsdom` as devDependencies:
  Kd-approved 2026-07-26 (DECISIONS line 1173, R1.4 ✅).
- `apps/web/src/sync/syncClient.test.js` fails on Kd's machine
  (`ReferenceError: window is not defined`) and passes in CI. Cause verified:
  `apps/web/.env` sets `VITE_API_URL`, which vitest loads, so the test's premise
  ("in this node test env `VITE_API_URL` is unset") is false locally. Not this
  diff (neither file is in it) — but it makes every local PROVE run report 1
  failure, so it should get an OWED line.
- `formatXpEarned` has **2 call sites in 1 file** (`PostWorkout.jsx:202`, `:615`),
  not the four the kickoff states. Its move into the shared module is sound and
  unit-covered (MUT-13 RED).
- `Achievements.jsx:737` `key={entry.name ?? i}` — `readLeaderboardEntry`
  discards the payload's `user_id` (present in the file's own fixture at line
  411), forcing name-as-key; two athletes with the same display name collide and
  React reuses the wrong row.
- `Achievements.jsx:268` `podiumColors[entry.rank]` — `rank` is `finite()`, so 0
  or a negative passes `isPodium` and yields a Crown with `color: undefined`.
  Cosmetic.
- `Dashboard.jsx:733` `{!loading && (CTA)}` — the static "Ready to start?" CTA
  borrows the stats read's knowability, so a hung `getStats` hides it forever.
  Round 7 F8's shape, one site over.

**Not ready to merge.** F1–F5 are blocking; F6 is the reason four previous
rounds' fixes could regress unnoticed.
