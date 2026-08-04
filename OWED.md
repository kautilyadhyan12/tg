# OWED — the single list of everything outstanding

**Why this file exists.** DECISIONS.md is a diary: it records *what was decided
and why*, in the order it happened. It is excellent for "why is this like this?"
and useless for "what is still to do?" — 580 lines of prose where a deferral
recorded on day 3 is indistinguishable from one recorded yesterday.
RUNBOOK/cutover.md tracks only what BLOCKS the P2.8 cutover, so anything that
does not block it had no home at all. An audit on 2026-07-21 found two real
items owed and tracked NOWHERE (Google login; timezone capture) — one of them a
user-facing feature that had been switched off, which the CLAUDE.md
MIGRATION-STANCE no-removal rule exists specifically to prevent.

**How to use it.** Every entry says what it is, why it was deferred, who ruled
it, what unblocks it, and what it blocks. Nothing leaves this file except by
being DONE (tick it, date it, name the commit) or by an explicit Kd ruling that
it will never be built (strike it, cite the ruling — the desktop-webcam
precedent, DECISIONS 2026-07-19).

**How to keep it true.** Any card that defers something adds its line HERE in
the same commit that records the deferral in DECISIONS. A deferral recorded in
prose only is the exact failure this file was built to stop.

Legend: 🔴 blocks the P2.8 cutover · 🟡 needed before real users · ⚪ improvement
· ⏰ has a real-world deadline

---

## ⏰ Deadline-driven — do these on the clock, not on the queue

- [x] ⏰🔴 **Groq COACH_MODEL migration — DONE 2026-07-22, merged as PR #44**
      (merge `ad3b1ee`), ahead of the 2026-08-16 decommission of
      `llama-3.1-8b-instant`. Default flipped to `openai/gpt-oss-20b` and the
      model-specific price constants re-quoted from groq.com/pricing per Part 0
      rule 4 ($0.075/1M in, $0.30/1M out → 75_000/300_000 micro-USD); the
      discounted cached-input rate is deliberately unused (never under-count).
      `COACH_MAX_TOKENS` 800→1200 folded in by Kd ruling — the more verbose
      model truncated mid-sentence at the old cap. Fresh-chat T3, live-driven
      against real Groq. A follow-up web commit (`ca4b2cc`) added `remark-gfm`
      because the new model answers with markdown TABLES, which react-markdown
      alone rendered as pipe soup. **The key rotation it was expected to carry
      did NOT happen — its own line below.**

- [ ] 🟡 **Rotate GROQ_API_KEY.** The old key was reused for local dev with
      rotation explicitly DEFERRED, not waived — Kd's reasoning was that the zip
      carrying the old `.env` went only to Claude sessions, and he stated "I will
      rotate it later" (DECISIONS 2026-07-16). The Groq model-migration card was
      named as the natural moment (new key + new model in one visit to the Groq
      console); that card shipped on 2026-07-22 WITHOUT rotating, so the item
      would have vanished with its ticked line. Given its own line here on
      2026-07-22 rather than being lost. The P0 rule treats every secret in the
      old repo's `.env` as burned, so this is a real deferral, not hygiene.
- [x] 🟡 **Rotate the Neon database password (`DATABASE_URL`) — DONE
      2026-07-27 (Kd rotated in the Neon console; verified by query).** Exposed
      2026-07-26: a `grep` for the connection string during the XP-card smoke
      setup matched a neighbouring comment line, and the mangled value — password
      included — was printed into a Claude chat transcript in an error message.
      Same class as the two rotations above, and treated the same way rather than
      waved off because it was accidental. This one is heavier than a provider
      key: it is direct read/write access to the dev database.
      **HOW IT WAS DONE:** Neon console → Roles → `neondb_owner` → Reset
      password. Kd pasted the new value straight into `apps/api/.env` line 5 in
      the editor — deliberately NOT through the chat, since a chat transcript is
      exactly how the old one burned. Verified by connecting with the new URL and
      running `select current_user, current_database()` plus a table count:
      `neondb_owner` / `neondb` / 46 public tables. The API was restarted and
      re-listens on :3000. Grep confirmed `apps/api/.env` was the ONLY file
      holding the real secret — `.github/workflows/ci.yml` takes its URL from the
      `neon-branch` step output, and `infra/docker-compose.dev.yml` carries local
      container credentials (`aihg`/`postgres`), neither of which is this one.
      The dev branch holds only test fixtures, which is why this was 🟡 not 🔴.
- [ ] 🟡 **Rotate the GOOGLE_CLIENT_SECRET.** The secret created for the
      google-login local smoke (2026-07-24) was pasted into a Claude chat to wire
      `apps/api/.env`, so treat it as exposed (same class as GROQ above). Fine for
      local dev; before any real deployment, regenerate it in the Google Cloud
      console (Clients → "AI Home Gym Local" → + Add secret), put the new value in
      the deploy platform's secrets, and delete the old. The client ID is public
      by design; only the secret needs rotating.

## 🔴 Blocks the cutover — the old backend cannot be switched off until these exist

### Screens still reading the OLD backend (no new-API home yet)
Each needs an API surface built BEFORE its screen can be repointed. Per the
no-removal rule these UIs stay untouched and working on the old backend until
then; none may be hidden or reduced to close the gap.

- [x] 🔴 **XP / levels display — DONE 2026-07-30.** Closed by T3 round 11
      under THE CAP (DECISIONS 2026-07-29): round 11 returned ONE visible
      finding, it was fixed, and the card closes on that fix. Eleven review
      rounds; commits `7b91c68` (Round A) · `0869f01` (Round B) · `df0ea05`
      (round 9) · `690cdfb` (round 10) · this one (round 11). Smoke passed
      11/11 on 2026-07-28 and no fix since has changed user-visible
      behaviour beyond a defect. Was: UNTICKED 2026-07-26 by round 3, still
      off after rounds 4, 5, 6 AND 7.
      **SMOKE HALF DISCHARGED 2026-07-28: the re-smoke PASSED, all 11 steps**
      (Kd, steps at `RUNBOOK/smoke-xp-dashboard.md`, result recorded there). It
      replaces the 2026-07-27 attempt voided by the rig's CORS wildcard. Level 3
      / `332/374` / `680 XP` held on all five XP surfaces in all ten rig states,
      including `dead` and `hang`; no fabricated zero and no false "unavailable"
      over visible content anywhere. **THE TICK STAYS OFF: this line needs the
      smoke AND T3 round 8.**
      **ROUND 8 HAS NOW RUN (2026-07-28) AND THE CARD FAILED IT: 6 BLOCKING
      FINDINGS, 15 of 31 MUTANTS SURVIVED.** Findings verbatim at
      `t3-xp-web-r8-FINDINGS.md`; all six independently re-verified against the
      current files before any fix was planned. The eighth consecutive round in
      which the previous round's fix opened the next finding.
      THREE ARE LIVE DEFECTS: F4 an unguarded `in` lookup on external input
      blanks the WHOLE Achievements page (a badge category of `toString` →
      `.push` on `Object.prototype.toString`); F3 the week strip claims
      "Weekly activity unavailable" during an in-flight read, permanently when
      the old backend hangs; F5 an unknown badge tier is painted BRONZE in
      GamificationStrip while Achievements renders it neutral — round 6 F5 fixed
      at one of two sites, the eighth instance of the one-of-N shape.
      THREE ARE THE PROTECTION: F1 `Sidebar` — the component the ORIGINAL bug
      lived in — is mounted by no render test at all, and the source guard's
      `FIELD_READ` misses `xp ?? { level: 1 }`, so the card's own defect is
      reintroducible with all 75 tests green; F2 no Achievements test ever runs
      with the XP read failing; F6 four numeric fabrications (`?? 0` at Total
      Workouts, Calories, This-week, Your Rank) survive because
      `getAllByText('—').length >= 3` is a floor with two dashes of slack.
      **Also falsified: the claim in `gamificationApi.test.js` (the guard
      section's header — round 8 cited it as :454-457, which Round A's edits had
      already shifted to :515-518; corrected here per V4) and DECISIONS
      (2026-07-26, line 1173) that "all ten bypasses fail there".** Two of them
      pass. Fifth false claim carried by that guard section.
      FIX ORDER, Kd-approved 2026-07-28: **Round A** = the live defects
      (F3, F4, F5), failing test first per R9.5; **Round B** = the protection
      layer (F1, F2, F6), every new assertion mutation-tested before it counts.
      The smoke does NOT need re-running for Round A/B unless a fix changes
      user-visible behaviour beyond the defect — and note the smoke could not
      have caught F4: the rig never sends a prototype-name category.
      **ROUND A IS DONE (2026-07-29). F3, F4 and F5 are FIXED.** Each began as a
      failing test written and shown RED before any source was touched (R9.5 —
      the gate round 7 failed): 6 new tests, and the F4 red run reproduced the
      reviewer's Probe C exactly (`TypeError: badgesByCategory[key].push is not
      a function`, `<body><div /></body>`). Suite 81/81 green. **11 mutations
      were run against the new assertions: 10 RED, 1 GREEN** — and the green one
      was declared green in the PLAN before it ran. It is `Object.create(null)`
      at `Achievements.jsx`, which is behaviourally inert once the
      `Object.hasOwn` check stands, so no assertion can distinguish it; that is
      written in the source comment instead of being credited to a test (rounds
      6 F11 / 7 F3's lesson). F5 was fixed as a CLASS: every site in the card's
      ten files resolving a colour from a nullable field was enumerated, the two
      defective ones fixed, the six already-correct ones re-read and left, and
      the one excluded (`podiumColors[entry.rank]`) is the OWED line below.
      Lint parity checked rather than "lint clean" ticked: the six touched files
      produce 1 error at HEAD and the same 1 error after (pre-existing
      `ChevronRight`), package-wide 67 both times.
      **ROUND B IS DONE (2026-07-29). F1, F2 and F6 are FIXED, and NO component
      file changed — all three were defects of the TEST layer, so Round B alters
      no shipping behaviour and owes no re-smoke.** F1: `Sidebar` is mounted by
      two new tests (XP dead → no level at either of its two sites; XP ready →
      the TRUE level at both, the positive control without which an empty
      sidebar would pass). F2: one Achievements test with `getMe` DEAD, the
      whole-document sweep matching the Dashboard's. F6: the three
      `getAllByText('—').length >= 3` floors at :144/:161/:182 are REPLACED by
      per-site identity assertions (`statValue`/`tileValue`, which throw when
      their anchor is absent or ambiguous so they cannot pass vacuously) plus a
      whole-document `\b0\b` sweep on the dead fixtures; `Your Rank` got its own
      identity assertion in GamificationStrip, since the pre-existing `of 0`
      check reads the TOTAL and never touched the rank.
      **9 mutations, 9 RED — every new assertion mutation-tested before it was
      claimed to protect anything**, restored from `cp` backups. B1/B3 are
      MUT-28/MUT-34 verbatim (the destructure that defeats `FIELD_READ`);
      B5/B6/B7/B8 are MUT-21/24/26/20, the four numeric fabrications, of which
      MUT-21 is round 4 F2 verbatim; B2 and B9 are the vanishing-site controls.
      Suite 84/84 (81 + 3). `vite build` green. Lint parity: the two touched
      files produce 0 problems, package-wide 67 errors — the same 67 Round A
      measured and round 8's reviewer counted independently.
      The two false "all ten bypasses" claims are CORRECTED IN THE SAME COMMIT,
      in the guard header and at DECISIONS line 1173, and neither is replaced by
      a new sweeping claim: what is written is what was measured (Kd chose this
      over re-running all ten to earn the strong sentence back).
      **ROUND 9 HAS RUN (2026-07-29) ON ROUNDS A+B: 4 findings, 2 VISIBLE, ALL
      FIXED.** The stopping rule worked in both directions — two findings held
      the ticks, two were fixed without holding anything. F1 (VISIBLE): Round A's
      own `${color}NN` hazard was applied to ONE of EIGHT sites, so seven more
      dropped their colour entirely in the unknown state — measured, a progress
      bar with no fill beside a card printing "2 / 5" and "40%", on two
      components. `difficultyStyle()` now joins `tierStyle()` and no call site
      concatenates (grep: zero remain). F4 (VISIBLE, pre-existing): round 5 F8's
      other direction — seven definite dots, 4 flames, under "Weekly activity
      unavailable". F2/F3 (NOT-VISIBLE) are both **Round B's own work**: its tile
      helper covered two tiles of three, leaving the LEVEL tile unasserted and a
      fabricated Level 1 green past all three protections; and one of its four
      new Achievements assertions could not fail, because the regex was copied
      from a site where digits sit next to "XP" to one spelled "N total XP".
      **12 new mutations, 12 RED**, including a positive control; Round B's nine
      re-run and all still RED with identical counts. Suite 87/87.
      Also corrected: this card's round-9 prompt claimed "touched files 0
      problems", which was Round B's two test files, not the combined six-file
      diff — that is 1 pre-existing `ChevronRight` error, as Round A recorded.
      **ROUND 10 HAS RUN (2026-07-29): 4 findings, 1 VISIBLE, ALL FIXED.**
      F1 (VISIBLE): the week caption printed `weekly_workouts` — a count of
      SESSIONS since Monday — labelled "days active", above a strip whose flames
      come from `activity`, keyed by DAY over a ROLLING seven days. Two
      mismatches, not one (verified at `backend-ml/app/routers/workouts.py`
      :72-74 and :86-89). Measured: "5 of 7 days active" over three flames, and
      "10 of 7 days active" — a sentence that cannot be true. Round 9 F4 fixed
      the readiness axis of round 5 F8 and left the counting axis. Caption and
      dots now derive from ONE `weekDates()`. F2/F3/F4 (NOT-VISIBLE): neutral
      style slots asserted for presence but not neutrality (4 mutants survived);
      the completeness loop listing 5 of 7 fields **and** covering only the
      NEUTRAL tier, so the four known tiers had no check at all (found while
      fixing, not by the review); and the recommendation pill's background
      knowing one vocabulary while its label knew two.
      **13 mutations, 12 RED, 1 GREEN** — the green one declared: a
      date-dependent equivalent (a 24h shift changes nothing except across a
      Sunday). Round 9's protections re-run as regression: all still RED.
      Suite 90/90.
      **ROUND 11 HAS RUN (2026-07-30): 6 findings, 1 VISIBLE, ALL FIXED — AND
      THE CARD CLOSES ON IT, per THE CAP.** F1 (VISIBLE) was a REGRESSION ROUND
      10 INTRODUCED: `weekDates` does local calendar arithmetic and serialises
      in UTC, and round 10 routed the printed day number through the UTC string,
      so in IST between 00:00 and 05:29 every day number was one behind and the
      orange "today" cell showed yesterday — measured, 26 27 28 29 30 31 1
      against a calendar reading 27 28 29 30 31 1 2. In DST zones the same
      mixing duplicated a key in the spring-forward week and skipped one in the
      fall-back week. Fixed by returning `{ key, day }`: the key stays UTC
      because the backend buckets UTC, the day is local because that is what the
      user's calendar says. F2/F5/F6 fixed too (two assertions that could not
      fail — one dominated, one whose producer the round 10 fix had made
      structurally bounded; an orphaned JSDoc; two `new Date()` calls where one
      was claimed). **10 mutations, 9 RED**; the survivor is declared (P9: the
      strip reading its own instant can only diverge across UTC midnight).
      A gap the mutations found in round 11's OWN fixture is closed in the same
      commit: every activity key sat inside the displayed week, so "count this
      week" and "count every key" were the same number and the caption could
      abandon the Mon-Sun window unnoticed.
- [ ] 🔴 **Week strip date axis — render-side coverage.** Round 11 F3 measured
      TEN surviving mutants on this axis and round 11's fix closed the helper
      half with pinned-clock, pinned-TZ unit tests (`weekDates` now has three).
      What is still UNCOVERED is the RENDER side: no assertion in
      `xpDisplay.render.test.jsx` reads a day NUMBER, a label↔date relationship,
      or which seven days the strip covers, so "labels rotated", "Monday
      permanently highlighted" and "dates reversed" are caught only at the unit
      layer. Needs `vi.setSystemTime` plus a pinned TZ in the render file, which
      is why it is a line rather than a same-commit fix: fake timers interact
      with framer-motion's animation waits, and this card has twice recorded
      that a timing instrument chosen carelessly produces a vacuous assertion.
- [ ] 🟡 **`xpDisplay.render.test.jsx`'s week fixture re-implements
      `weekDates`.** Round 11 F4: the fixture computes its own keys with the
      same algorithm, `toISOString` included, so a helper wrong in the SAME way
      is invisible to it — which is exactly how round 10's UTC/local mixing
      survived there. The overclaiming comment ("a wrong helper cannot make this
      test agree with itself") is CORRECTED in place; the structural fix is to
      derive the fixture from a pinned clock and literal dates.
- [ ] 🟡 **`ExerciseLibrary.jsx:63` — `DIFF_COLORS[exercise.difficulty] ||
      DIFF_COLORS.beginner`.** Raised by round 11 under R1.1 as out of scope: a
      FOURTH site of the one-of-N shape round 7 F2 declared fixed as a class, on
      a screen this card does not own — an unknown difficulty painted as a
      definite `beginner`. Belongs to whichever card repoints the exercise
      library.
      **ROUND 7 (2026-07-27, fresh chat): 8 findings, 3 blocking, all fixed.**
      Seventh consecutive round in which the previous round's fix opened the
      next one. F1: `recsState` derived from the STATS read's loading flag —
      the recommendations request had no settled flag at all — so BOTH failure
      modes this card exists to delete fired at once, a false "unavailable"
      during a healthy load and a permanent "Loading…" against a hung backend.
      F2: round 6's difficulty "class fix" covered one site of three; the
      hard-red `else` was still live in ChallengeCard and ChallengeRow. There
      is one exported `difficultyColor()` now. F3: round 6's F11 ruling
      (an assertion whose stated failure mode the code cannot produce is
      vacuous) was violated by the F11 commit itself — a `/advanced/i` check
      that could never fail, whose false premise then propagated into two
      source comments, DECISIONS, OWED and the commit message. All corrected.
      Also: a stale comment naming deleted functions (F4), seven bare nullable
      fields rendering blank where siblings print "—" (F5), six bare
      `isCurrentUser` reads the record claimed were fixed (F6),
      `earnedBadgeCount([null])` throwing one layer inside F12's own fix (F7),
      a section that vanished when both lists were empty (F8), and an
      unencoded id in a route query.
      **ROUND 6 (2026-07-27, fresh chat): 12 findings, 3 blocking, all fixed.**
      Sixth consecutive round in which the previous round's fix opened the next
      one. F1 is the headline and it is the INVERSE of this card's defect:
      round 5's F2 fix made the earned-count null whenever any badge's `earned`
      is unknown, and the list's STATE borrowed that test — so a catalog that
      arrived and was rendered on screen got "Badges are unavailable right now."
      printed directly above two visible badge cards. Not a fabricated number;
      a false denial of content the user can see. Same rule, opposite sign.
      F2/F3: `recommendations` was a SECOND unparsed list in Dashboard — round
      5's claim that `recent_workouts` was "the ONE" was false. A non-array
      value reached `.slice().map()` and blanked the entire page (no
      ErrorBoundary), and six bare reads painted an unknown difficulty red and
      "advanced". Also fixed: blank loading arms in the strip (F4), a fabricated
      bronze tier ring (F5), three more empty-list states (F6), a literal
      "Invalid Date" (F7), nullable booleans read as definite-false (F8), a
      failed recent-workouts read looking like a zero-workout account (F9), a
      fourth false claim in the guard (F10), two assertions that could not fail
      for the class they named (F11), and a throw on `earnedBadgeCount(undefined)`
      (F12). `badgesKnown`/`challengesKnown` DELETED — dead surface that still
      carried five assertions, which reads as protection and is not.
      **ROUND 5 (2026-07-26, fresh chat): 8 more findings, 3 blocking, all
      fixed.** The pattern held a fifth time — round 4's own F4 fix created
      round 5's F1, and round 4's new readers created F2 and F3.
      F1: the per-tab captions branched on the ENVELOPE's state, so "200 with no
      list" matched neither arm and three tabs said "Loading…" forever after
      both reads had settled. F2: the new readers defaulted every BOOLEAN to
      `false` (only the 15 numeric/string fields were nulled), so a catalog with
      no `earned` field printed "0 of 40 badges" and "earn your first badge" —
      the round-2 fabrication restored through a default instead of an envelope
      gate. F3: `recent_workouts` was the one list left unparsed, so three
      Dashboard sites rendered "0 min · 0 kcal · 0% form" with the unknown
      accuracy painted RED. Plus a dead current-user highlight (F4), a badges
      tab that rendered nothing when the catalog was empty (F7), a caption and
      its dots gated on different fields (F8), a false consumer count in
      `useXp`'s comment (F6), and two `.catch(console.error)` leaking the axios
      config in Dashboard (R3.10).
      **F5 is the one to remember: round 4's 132-line "class fix" shipped with
      NO tests on the class** — every render fixture used empty lists, so
      `readBadge`/`readChallenge` never produced output any test looked at,
      which is exactly why F2 and F3 survived a round. Now 19 unit tests over
      all ten readers/formatters + 6 render tests that render a real badge,
      challenge and recent workout. The render tests also caught TWO more
      page-blanking ReferenceErrors in the round-4/5 edits themselves.
      It was ticked on the round-2 smoke; round 3 then found
      three behaviour defects that a click-through cannot see, so the tick was
      premature and comes off (the google-login / DPDP precedent). Re-ticks when
      the fixes have their own smoke AND a round comes back clean.
      **ROUND 4 (2026-07-26, fresh chat): 8 findings, all real, all fixed — the
      fourth consecutive round to find that the previous round's fix opened
      something new.** Headline: the source guard was defeated FOUR more ways
      (ten total across four rounds), including a destructure that FIELD_READ
      structurally cannot see, and a contradiction appended to FIELD_READ that
      disarmed the whole scan silently because it had no positive control.
      **Kd approved two new dev deps (jsdom + @testing-library/react) on
      2026-07-26 and the protection of record is now RENDER tests**
      (`apps/web/src/pages/xpDisplay.render.test.jsx`, 13 tests): the regex
      battery cannot win because source text has unbounded spellings for the
      same rendered output. All four of the reviewer's paste-in mutations were
      re-run against the fix and each goes RED — verified, not asserted. Round
      4's other findings: `statsKnown` was `Boolean(data)` under a new name so a
      `{stats:{}}` 200 still printed six zeros (F2); the week strip rendered
      seven inactive dots — seven claims — beside a caption reading
      "unavailable" (F3); `allSettled` decoupled the FETCH but every render was
      still gated on the overview payload, so a healthy leaderboard was thrown
      away and disclaimed (F4); seven element-level fields were still read bare
      (F5); the old payloads never crossed a parser at all, which is the CLASS
      behind rounds 2-4 and is now fixed with `readOverviewView` /
      `readLeaderboardView` / `readStatsView` (F6); `useXp` exposed one state
      where three exist, so a hung old backend + failed XP read hid the surface
      forever (F7); and three claims in the guard's own header were false (F8).
      Round 3's findings:
      an unguarded `leaderboard.leaderboard.map` — the twin of the read round 2
      claimed to have fixed — which blanks the whole page including the XP
      header on a partial 200; "Failed to load achievements" asserted while the
      old read was still IN FLIGHT (a failure claim during a healthy load, and
      permanent against a hanging backend, since mlApi sets no timeout); and
      `oldReady = Boolean(data)` testing the envelope rather than the field, so
      a 200 with `{}` still printed "(0/—)" and "earn your first badge".
      Commits `7750478` (build) +
      `f918cc4` (T3 round 2). RE-SMOKE PASSED (Kd) on the round-2 bytes: the
      strip read "330 XP · Level 2" / "230/248 to Lv 3" with the old backend
      OFF, the counters read "(—/—)" and "of —" rather than zeros, Achievements
      read "Level 2 / 330 total XP · — of — badges", and the sidebar read
      "Level 2 / L2".** Two fresh-chat T3 rounds (6 + 8 findings, all resolved);
      round 2's own headline was that round 1's fix had re-created this card's
      defect elsewhere, which is why the re-smoke was required rather than
      assumed. A third round was offered and not run — if one is ever run and
      finds something blocking, this tick comes off (the google-login / DPDP
      precedent). The Dashboard XP surfaces are a SEPARATE line below, Kd-ruled
      out of this card on 2026-07-26 and confirmed wrong by the same smoke.
      (GamificationStrip, Achievements). XP storage
      does not exist anywhere in Part 4 — inventing a column would violate R0.2,
      so the badges.py XP/level curve stays unported until a ruled migration
      card. (DECISIONS 2026-07-11 P2.3 GAP-1.)
      **RULED 2026-07-24 (Kd): KEEP the feature — add XP storage.** XP/levels is
      a live feature on the old backend and the no-removal rule keeps it; the
      GAP-1 deferral is now discharged by an explicit ruling to build its home.
      Next: a 🔴 migration card adds XP storage (column or small table, SQL
      reviewed by Kd — the onboarding-storage / user_fitness_profiles precedent
      for Kd-authorised schema beyond the spec) and ports the badges.py
      XP/level curve verbatim (R5.4). THEN the web XP display repoints.
      Dropping it was never on the table — no-removal.
      **API HALF ✅ MERGED TO MASTER 2026-07-26 as PR #50 (merge `47cc001`) —
      this line stays OPEN because its actual subject, the web display, is
      still on the old backend.**
      Migration `0008_user_xp` (1:1 `user_xp`, SQL reviewed by Kd) + the
      verbatim badges.py curve/constants in `gamification/xp.ts`; XP is
      RECOMPUTED from full history at every sync (never `$inc` — a retried sync
      would double-count), and `user_xp` is on BOTH DPDP lists (delete +
      export). `/v1/gamification/me` now returns an `xp` block
      `{total, level, xpInLevel, xpForNext, progressPct, nextLevelAt}`.
      ~~NB **`web-repoint` does not carry it yet**~~ — DONE: master merged into
      this branch at `1164a86` (2026-07-26), which is what put the `xp` block
      here before the web half was built.
      T3 ran FIVE fresh-chat rounds (25 findings, all resolved). The code has
      been stable since round 1's lock fix; rounds 2-5 were about evidence and
      records. Three behavioural guarantees each carry a mutation-verified test:
      the advisory-lock body, its CALL SITE (probed via `pg_blocking_pids`), and
      that `/me` reads stored XP rather than recomputing. api 366/366 on Neon.
      **READ BEFORE TOUCHING XP NUMBERS:** `xp.ts` carries a governing rule —
      *every recomputed input to every component diverges from the old backend*
      (day bucketing, activity-vs-sync time, retroactive backfill, the
      server-derived form score, and all four badge-stat inputs). The constants
      are verbatim; the TOTALS deliberately are not. Do not "fix" a difference
      against the old app without reading it.
      **STILL OWED (the web half, this line's actual subject):** repoint
      GamificationStrip + Achievements off `gamificationApi`'s old-backend
      `getOverview` onto the new `xp` block. TRAP, same class as the
      nutrition-targets card: the API speaks camelCase (`xpInLevel`) while the
      components read the old shape (`user.progress.xp_in_level`,
      `user.xp`, `user.level`) — a straight swap yields `undefined`, which
      renders as a plausible-looking blank rather than an error. The browser
      SMOKE is owed WITH that card (the API half ships no reachable UI and
      correctly claims none).
      **WEB HALF BUILT + SMOKE PASSED (Kd) 2026-07-26 — commit `7750478` on
      `web-repoint`. Box stays UNTICKED pending the T3 round below.**
      Sidebar + GamificationStrip ("Your Rank" only) + Achievements (header
      only) now read the new `xp` block via a `useXp()` hook on the Card-1
      cookie client; `readXpView` returns NULL rather than a default so no
      fabricated number can reach the UI, mutation-verified. Kd's SCOPE RULING
      (2026-07-26) put **Sidebar IN** — its `user?.level || 1` read a field the
      auth user shape does not have, so it rendered "Level 1" for everyone —
      and **Dashboard OUT** (different old endpoint; its own line below).
      SMOKE evidence, on a seeded account at total_xp 330 → Level 2 (a value
      chosen BECAUSE a fresh account is genuinely Level 1, which is what the old
      bug faked and so could not discriminate): sidebar read "Level 2 / L2";
      "Your Rank" read "330 XP · Level 2" with "230/248 to Lv 3"; the
      Achievements header read "Level 2 / 330 total XP" with "Failed to load
      achievements" BELOW it. The last two both prove the T3 ① fix — they
      rendered with the old backend switched off, which the first cut of this
      card could not have done. `/v1/gamification/me` matched all three.
      **T3 ROUND 2 DONE — 8 findings, all fixed, and it proved the round-1 fix
      had created a NEW instance of this card's own defect** (hoisting XP out of
      the old payload made the badge/challenge counters render "of 0" and "0 of
      — badges" on a failed read, asserting zeros where nothing is known — the
      state Kd's smoke ran in, and which I wrongly reported as correct). Also:
      the Achievements spinner still gated the header on the old backend; two
      unguarded payload reads could blank the page; and BOTH source guards were
      bypassable nine ways until redesigned as a positive rule. **RE-SMOKE OWED
      on these bytes** — the previous pass does not carry over, because what the
      two screens display with the old backend off has changed ("—", not "0").
      NB the SMOKE also exposed a Docker trap worth knowing: `aihg-dev-api-1`
      publishes port 3000 and points at its OWN Postgres, so with that container
      up the browser talks to a different database than a locally-run api and a
      login can fail for no code reason at all.
      SCOPE BOUNDARY (verified by grep, so the web card does not over-reach):
      those two screens ALSO render `badge.xp_reward` (Achievements.jsx) and
      leaderboard `entry.xp`/`entry.level` — those belong to the **badge
      catalog** and **leaderboard** lines below, NOT to this one. The per-badge
      tier XP those need IS already ported (`ACHIEVEMENTS[].tier` +
      `badgeXpForCodes`, in `gamification/badges.ts`), but it is not yet served
      by any endpoint and is NOT stored on the `achievements` table — the badge
      catalog card decides whether it needs a column.
- [ ] 🔴 **Round 8 F6's other EIGHT surviving mutants — NOT addressed by Round B,
      NOT re-measured.** F6's table listed twelve; Round B's prescription
      ("per-site identity assertions plus a whole-document numeric sweep on the
      DEAD fixture") covers the four NUMERIC render-site fabrications only —
      MUT-20/21/24/26, all four now mutation-verified caught. The other eight
      stand exactly as the reviewer measured them on 2026-07-28 and have NOT been
      re-run since, so this line records a round-8 measurement and not a current
      one: MUT-3, 4, 15, 16, 17 (`orUnknown(...)` → bare read at badge
      name/icon/xpReward and `ex.primaryCategory` — round 7 F5's own fix, which
      shipped with no test at any layer), MUT-29 (`entry.isCurrentUser === true`
      → truthy, round 7 F6's fix), MUT-2 (the recommendation pill's BACKGROUND —
      round 7 F2's own site, asserted on colour but not background), and MUT-10
      (`useXp` reporting a malformed 200 as ready). Recorded rather than folded
      in because Kd approved a plan naming exactly nine mutations (R1.1/S4) —
      and recorded AT ALL because "fix the class, not the case" plus an untracked
      known gap is the precise combination this card has lost rounds to. Close it
      in whichever round next touches these assertions.
- [ ] 🔴 **Badge catalog + challenges screens.** "Tables now, screens later"
      carve; needs catalog/challenges read endpoints. Challenges also need a
      scheduler for weekly rotation. (DECISIONS 2026-07-11 P2.3.)
- [ ] 🔴 **Leaderboard** (GamificationStrip, Achievements). P4.x work: Redis
      ZSET + snapshots, verified-entries-only for global boards (v1 §14).
      ⚠ SEQUENCING CONFLICT, recorded and NOT yet ruled: the playbook puts P4
      AFTER P2.8, but cutover requires every feature's endpoint to exist first.
      Kd must either land a minimal read early or explicitly accept a dark
      window. DECIDE AT THIS LINE — do not silently flip it.
      (DECISIONS 2026-07-16, Card 3.)
      **RULED 2026-07-24 (Kd): the feature STAYS and is built PROPERLY in P4;
      accept a temporary "coming soon" state at the cutover moment** (the
      framework's sanctioned dark-window option — NOT a removal; the leaderboard
      screen stays working on the old backend until cutover, and shows a
      "coming soon" placeholder only if P4 has not yet landed when the old
      backend is switched off). Rationale: at launch the DB is empty
      (DECISIONS 2026-07-13), so a global board has no entries to show, and it
      needs the full verified-entries-only anti-cheat (v1 §14) that is real P4
      work — a rushed empty board before cutover buys nothing. No feature is
      deleted or reduced; this only sequences WHEN its new-backend home is
      built. Revisit if Kd later wants it visible at cutover → then a minimal
      read lands early instead.
      **INHERITED THREAT MODEL — read before ranking anyone by XP** (from the
      XP card's round-5 review, full text in master's DECISIONS): XP is safe
      today ONLY because it grants nothing. Every one of its four components is
      client-determined. PRIMARY vector: fabricated workout VOLUME — each
      accepted sync of a fresh client-generated `workoutId` mints 50 (base) +
      up to 50 (perfect-form bonus, since `avgFormScore` is client-sent per set
      and the server merely averages it), and **`POST /v1/workouts/sync` has NO
      per-route rate limit** (verified: `app.authenticate` is its only
      preHandler). SECOND: backdated `startedAt` (no past/future clamp) mints
      +10 per fabricated distinct day. The moment a leaderboard ranks on XP,
      both become value-granting inputs — a per-route limit plus v1 §14.1
      plausibility checks (P4.y) are the home for closing them, and v1 §14's
      "verified entries only" for global boards is the other half.
- [ ] 🔴 **Predictions** (PredictionsSection) — the 2B §5 card (P2.3 carve).
- [ ] 🔴 **Exercise library content**: display names, instructions, media/GIFs,
      server-side search. The Part 4 §3.4 catalog is data-only
      (slug/nameKey/family/tier/met/equipment/muscles) and stores none of it.
      Owed to the P4 production line / Part 2 Appendix A localization.
      (DECISIONS 2026-07-16, Card 3.)
- [x] 🔴 **THE EXERCISE CATALOG — DONE 2026-08-01** (DECISIONS :3538, commit on
      `web-repoint` the same day). 3 → **58** rows, verified against the live DB
      (`SELECT count(*) FROM exercises` = 58; pose 57 / timer 1). The reviewed
      table is `CATALOG_58` in `packages/shared/src/exerciseCatalog.ts` — Kd
      signed it off before any code was written (artifact `docs/catalog-58.md`),
      and the two SPEC GAPs in it were ruled by Kd (both F11: `brisk_walking`
      had no family, `arm_circles` had two). The seed imports that one table, so
      the API and the web cannot drift on what an exercise is called;
      `slugForLegacyName` is exact-match and returns null rather than guessing.
      api 381/381 · shared 41/41 · 9 shared mutants + 1 DB mutant, all RED
      against a verified green baseline. **The write-path line below is
      unblocked by this.** The original entry follows.
      **WAS: the exercise catalog holds 3 rows — every other exercise a user can
      pick is UNKNOWN to the new API, and its sets are SILENTLY DISCARDED.**
      Created 2026-08-01 (DECISIONS :3424), found while planning the web write
      path. **It had NO line anywhere in this file** — the gap was visible only
      as prose inside the write-path entry below ("nearly every exercise is
      log-only TODAY"), which is about DEFINITIONS, a different thing: an
      exercise can be hand-logged without a definition, but it cannot be STORED
      without a catalog row. Same shape of miss as the write-path line itself.
      **The chain, command-verified 2026-08-01:**
      1. `db/seed.ts:201-203` seeds exactly **3** exercises (squat, jump_squat,
         chair_squat) and `db/seed.ts:254` is the **only** insert site in
         `apps/api` (grep: one hit). The Mongo→PG tool adds none and says so
         (`tools/migrate-mongo/exerciseNames.ts:4-6`).
      2. `modules/workouts/repo.ts:58` filters sets whose slug has no row;
         `:71` flags the workout `unknown_exercise`; the parent workout is
         inserted REGARDLESS, so an all-unknown payload lands as a workout with
         `sets_count = 0`, `total_reps = 0`.
      3. `db/schema/training.ts:55-57` — `workout_sets.exercise_id` is NOT NULL
         with an FK, so "store it anyway" needs a migration AND an R0.3
         deviation against Part 4 §3.5. Kd did NOT choose that.
      4. There is **no name→slug resolver for a log-only set**. The engine path
         is unaffected only because definitions carry the plural legacy name as
         an alias (`definitions/squat.json:3`) and the compiled config takes the
         definition KEY (`definition/compile.ts:89`).
      **⇒ Until this line is closed, a hand-logged workout of anything but those
      three exercises would be ACCEPTED and then emptied — worse than today's
      missing data, because it writes a 0-rep workout into history.**
      **THIS BLOCKS THE WEB WRITE PATH BELOW** (Kd's ruling, DECISIONS :3424:
      catalog first). Scope when it runs: catalog rows for every exercise a user
      can pick, plus a REVIEWED name→slug table (the P1.8a-precedent instrument
      already exists in miniature at `tools/migrate-mongo/exerciseNames.ts`,
      covering **14** legacy names — not the library).
      **CORRECTED 2026-08-01, same day (DECISIONS :3501) — this line first
      claimed an OPEN RULING here and there is none.** The three unmapped legacy
      names (`exerciseNames.ts` rows 12–14: Arnold Shoulder Press, 1-Arm
      Half-Kneeling Lat Pulldown, 1 Leg Box Squat) are **not in the library**
      (`grep -in "arnold\|lat pulldown\|box squat" scripts/seed_exercises.py` →
      no match), so no user can pick or hand-log one; they exist only in historic
      legacy workout rows, which the migration already skips + flags. The spec
      rules the case directly: Part 4 §3.4:373 — "`arnold_shoulder_press` stays
      unseeded — first expansion candidate". **Nothing is owed for the write
      path, and Kd must NOT be asked to rule on it.**
      **The catalog decisions this card DOES need are likewise already ruled**
      (Part 4 §3.4:366-372): Mountain Pose → `status 'live'`, T3, F12, MET 2.3
      (the frontend's `REMOVED_EXERCISES` hack dies with the migration) · Brisk
      Walking → `tracking 'timer'`, excluded from every form-score surface.
      Catalog size is **58** (Part 2 §6:721, "verified, v1.1"); the visible
      library is 56 because of that same frontend hack.
      NOT this line: display names, instructions, media/GIFs and server-side
      search, which are the separate "Exercise library content" line above.
- [x] 🔴 **THE WORKOUT WRITE PATH — DONE 2026-08-02** (DECISIONS, web-repoint).
      Both halves shipped: the API half on 2026-08-01, the WEB half now. A
      hand-counted workout of any of the 58 catalog exercises reaches the new
      API with its real rep count, its own set ordinals and a per-set duration.
      **Kd's browser SMOKE PASSED and was verified in the database**, not merely
      in tests: a 3-rep hand-logged Push-ups set stored as `mode 'log_only'`,
      duration 19.2 s, `avg_form_score` NULL, `bundle_version` NULL, and
      `quality_flags []` — i.e. the server recognised the exercise rather than
      discarding the set. XP updated at the sync second.
      web 310/310 · 13 mutants across 2 files, all RED against a verified green
      baseline, all targets restored byte-for-byte · lint identical to HEAD ·
      TWO fresh-chat T3 rounds (5 findings each, ZERO VISIBLE in both), closed
      under the two-round cap.
      **THE TWO THINGS THIS LINE WAS HOLDING NOW HAVE THEIR OWN LINES BELOW** —
      the legacy dual-write removal, and a hole the web half creates. Neither is
      allowed to travel inside a ticked entry. The original follows.
      **WAS: and the ruling under it: where does a
      HAND-LOGGED workout live after the old backend is off?**
      Created 2026-08-01 (DECISIONS :2912). This was visible only as prose inside
      the calendar line below (:514) and had no line of its own; the audit rule
      exists for exactly this shape of miss.
      **The chain, every link command-verified this session:**
      1. `engine/sessionController.js:67` — `if (def == null) return; // no
         definition yet → log-only`.
      2. `ls packages/engine/src/definitions/` = **3** (squat, jump_squat,
         chair_squat) against the **58**-exercise catalog (CLAUDE.md:106). So
         nearly every exercise is log-only TODAY.
      3. `sync/syncClient.js:72` — an all-log-only workout is never queued.
      4. DECISIONS :75 — the server ENFORCES `sets[]` non-empty, so it would
         reject one even if sent.
      5. `pages/ActiveWorkout.jsx:536` — every workout is still written to the
         OLD backend via `completeSession`.
      **⇒ Today the new API holds only workouts containing one of three
      exercises. ⇒ After P2.8 switches the old backend off, a workout of any
      other exercise would be saved NOWHERE AT ALL.** That is data loss on the
      product's core action, and it blocks the cutover on its own terms.
      **What is owed FIRST is a Kd RULING, not code.** "All-log-only workouts are
      NOT synced" is Kd-approved (DECISIONS :67, P1.10c 2026-07-10) and was right
      for the sync contract — with no SetSummaries there is nothing
      engine-verified to send. It becomes a different question once the old
      backend is the only place those workouts live. Options exist (a log-only
      workout shape the server accepts; a separate manual-log surface; gating on
      P4 shipping definitions) and each has a different blast radius — R0.2, so
      none may be picked by a chat.
      **What it unblocks:** the calendar below, PostWorkout's summary, the
      Dashboard's stats — every workout-history surface reads whatever this
      ruling decides.
      **RULED AND API HALF DONE 2026-08-01 (DECISIONS :3085).** Kd ruled option
      A: the new API accepts hand-logged workouts. Part 6 §3.6 already promised
      it in its own user-facing copy ("your workout still counts"), so this was
      honouring the spec, not a new product call. Migration `0009_log_only_sets`
      (expand-only, SQL reviewed by Kd first) + the `setSummarySchema` union +
      the sync/read paths landed with 9 new real-Postgres tests, api 373/373.
      **[RULED 2026-08-01 — option A, DECISIONS :3298. No longer blocking.]**
      **WAS: blocking sub-item, open for Kd (T3 round 1 F3, DECISIONS :3199):** an
      all-log-only workout must still send a WORKOUT-level `engineVersion`
      (required string) and `defsVersion` (required positive int), both stored
      and served back by `GET /v1/workouts/:id`. The API card's own test hides
      this by hardcoding `"1.0.0"`/1 — the fabrication deleted at set level,
      performed at workout level by the fixture. It is invisible today and
      becomes real the moment the web half lands: `syncClient.js:40` builds that
      value as `summaries[0].engineVersion`, which does not exist when there are
      no summaries, so the next card must either invent a number or change this
      contract. Options: (a) make `defsVersion` nullable — matches Part 4
      §3.5:384, which declares `bundle_version int` NULLABLE while the payload
      forbids null; shared-schema only, no migration — and record that
      workout-level `engineVersion` means "the engine build the client was
      running", honest and non-null even when nothing was scored; or (b) a
      DEVIATION PROPOSAL to make `workouts.engine_version` nullable, which the
      spec declares NOT NULL (R0.3).
      **RESOLVED: Kd chose (a).** `engineVersion` at workout level now means
      "the engine build the CLIENT was running" — true whether or not anything
      was scored — and `defsVersion` is nullable, matching the spec DDL. No
      migration, no deviation. The web card can now build an all-log-only
      payload without inventing a number.
      **THE WEB HALF IS WHAT REMAINS AND THIS LINE STAYS OPEN FOR IT:**
      `ActiveWorkout.jsx:536` still posts every workout to the legacy backend and
      `syncClient.js:72` still refuses to queue an all-log-only one, so NOTHING
      has changed for a user yet and the cutover is still blocked. That is the
      next card. Also owed with it: `queueWorkoutSync` must build the log-only
      set shape, and the client must stop calling `completeSession`.
      **PLANNED 2026-08-01 AND BLOCKED, BOTH HALVES RULED BY Kd (DECISIONS
      :3424) — do NOT start this card until the CATALOG line above is closed:**
      1. ~~**BLOCKED ON THE CATALOG.**~~ **DISCHARGED 2026-08-01** (DECISIONS
         :3538): all 58 are seeded, so a hand-logged set of any pickable
         exercise now resolves to a real row. **This card is READY TO START.**
         It must resolve the exercise NAME through `slugForLegacyName`
         (`@app/shared`) — never by lowercasing the name itself, which resolves
         nothing (the slugs are singular, the names plural), and never by
         inventing a slug on a null, which the server would discard.
      2. **`completeSession` STAYS — the removal above is DEFERRED, not done,
         and this line is what holds it.** The web card DUAL-WRITES (new API in
         addition to the legacy save), exactly as engine workouts already do.
         Removal is discharged only when the post-workout summary, the Dashboard
         stats and the calendar have new-API homes; dropping it today makes the
         summary screen print duration/calories/form as 0 **and a plausible
         "+50 XP" that was never awarded** (the old handler recomputes that
         number: `backend-ml/app/routers/workouts.py:591`) — a screen that looks
         true and is false. No-removal rule: replacement before removal.
      3. **When it runs, hook `handleSetComplete` (`ActiveWorkout.jsx:386`) — the
         single funnel — plus the three `engineSetKey` bump sites (:426, :483,
         :508) and the discard at :359-366. NOT the rep-counter trigger:** a
         "Complete Set" BUTTON at :1004 ends a set before the rep target, and
         hooking the counter would lose every early-ended set.
      4. Also owed with it (recorded at DECISIONS :3332): the local
         `syncClient.test.js` "window is not defined" failure is fixed by THIS
         card, not by the catalog card (R1.1).
      5. **THE TRAP THAT WOULD RECORD EVERY HAND-LOGGED SET AS 0 REPS.**
         Command-verified 2026-08-01: the manual rep count lives ONLY in the
         `setReps` STATE (`ActiveWorkout.jsx:156`) and **nothing mirrors it into
         a ref** (grep: no `setRepsRef` exists). `handleSetComplete` is a
         `useCallback` whose deps (`[targetSets, restDuration, exercises,
         voiceOn]`, :412) rarely change after mount, so it stays pinned to an
         early render — reading `setReps` inside it yields that render's stale
         value. This is the SAME hazard the file already documents at :120-129
         for `elapsedSecs`/`repFormScores`, which is why `elapsedSecsRef` exists.
         A ref is required, or every hand-logged set syncs 0 reps while the
         screen shows the right number.
      6. Per-set DURATION has no source either: the page tracks whole-session
         elapsed time, movement-gated active seconds and total rest, but nothing
         per set — and `durationMs` is REQUIRED and non-null on every set in the
         wire contract. A per-set start timestamp is part of this card (wall
         clock is fine here — R5.1 binds `packages/engine`, not `apps/web`).
      7. Decided but not yet built (state it in the card's PLAN so it is
         reviewable): a set with 0 reps is not sent (nothing happened), and if
         an exercise name cannot be resolved to a slug the workout is NOT synced
         at all rather than synced partially — the legacy save still holds it,
         so nothing is lost while `completeSession` stays.
- [ ] 🔴 **REMOVE THE LEGACY DUAL-WRITE (`completeSession`) from ActiveWorkout.**
      Created 2026-08-02, lifted OUT of the write-path entry above as that entry
      was ticked — it was item 2 there and the entry said in terms "this line is
      what holds it", so ticking without re-homing it is precisely the silent
      loss the deferral rule exists to stop.
      **NOT A CLEANUP. Replacement before removal (Kd's ruling, DECISIONS
      :3424):** every finished workout is still written to BOTH backends, and
      the old one is what the post-workout summary, the Dashboard stats and the
      workout calendar read. Dropping the call today makes the summary screen
      print duration, calories and form as 0 **and a plausible "+50 XP" that was
      never awarded** — the old handler recomputes that number
      (`backend-ml/app/routers/workouts.py:591`). A screen that looks true and
      is false.
      **Discharged only when all three of those surfaces have new-API homes.**
      Two of them already have OWED lines (the calendar below; PostWorkout's
      summary reader is done but still reads the OLD payload). Until then the
      dual-write is the correct behaviour, and a chat that proposes deleting it
      as tidy-up has not read this line.
- [x] 🔴 **A camera-graded set can still land NOWHERE — and now it can leave a
      workout with sets MISSING.** **CODE COMPLETE 2026-08-03 (DECISIONS :3720);
      TICKED 2026-08-04 on the smoke**: step 4 passed and is DB-verified
      (camera refused on squats → hand-counted → `squat`/`log_only`/reps 3,
      `exercise_id` resolved; runbook table). Step 6, this line's other route,
      was **SKIPPED BY KD'S RULING** (DECISIONS :4081); the reconcile code it
      would have exercised stays covered by the unit suite + mutation harness.
      Original text below. Fixed as part of Kd's ruling that
      hand counting is a user CHOICE: the page no longer decides who files a set
      by asking whether a definition exists — it records the user's count for
      every set and settles ownership once at workout end, when the engine's
      answer actually exists. **The proposed fix in this entry could not have
      worked**: it assumed hand-counted reps were available to fall back on, and
      on a camera-graded exercise the `+1 Rep` button was not rendered at all,
      so the count was always 0. **This entry's own suite asserted the defect as
      correct** — a test called "files nothing itself when the engine is
      analysing the set" expected an empty queue and described it as "nothing to
      send"; it is replaced by four that assert the opposite.
      **The mutant that reinstated the old gate (M8) was RETIRED in T3 round 3 —
      it could not be made to bite.** Corrected here rather than left standing:
      at capture time the engine has not filed yet, so a "has the engine filed
      this?" guard never fires, and an `analysisAvailable` guard reads the first
      render's value through a pinned callback. That impossibility IS this
      card's central design claim. The behaviour is covered instead by M4, M7
      (both capture call sites) and M47 (the recording itself, 12 tests red).
      Created 2026-08-02 (write-path T3 round 2,
      F-3, NOT-VISIBLE, deliberately not fixed inside that card — R1.1).
      `analysisAvailable` is true whenever a DEFINITION exists
      (`sessionController.js:59-71`), independent of the camera. But `endSet()`
      returns null when zero frames were fed (`:123`) — reachable when camera
      permission is denied (the page carries on; the error is an inline banner,
      not a block), while MediaPipe is still loading, or when the set ends
      inside that window. The engine then files nothing, and the web half's
      capture correctly stands aside because the engine "owns" that set. Neither
      side files it.
      **Before the web half this was invisible** — an all-squat workout simply
      synced nothing and the legacy save held it whole. Now: **squats mixed with
      any hand-logged exercise sync a workout with the squat sets missing**,
      which is the partial-workout outcome the unresolved-exercise guard exists
      to prevent, with no equivalent guard. The zero-frame guard itself is
      P1.10b's and deliberate (it suppresses phantom StrictMode summaries); what
      changed is the consequence.
      Scope when it runs: reconcile at workout end — any ordinal with reps but
      no summary from either side gets filed — or refuse the sync the way an
      unresolved exercise does. Both are more than a one-line fix, which is why
      this is a line and not a patch.
- [x] 🔴 **RE-RUN SMOKE STEPS 5 AND 6 — DISCHARGED 2026-08-04.** Step 5
      re-ran on the final code and met this line's exact closure condition: a
      TWO-set camera squat workout, BOTH sets `mode` `engine`, real scores
      83/83 (started 03:55 UTC 08-04; table in the runbook). Step 6 was
      **SKIPPED BY KD'S RULING** (DECISIONS :4081) — not run, not owed; the
      handover code and its unit/mutation coverage stay. Original text below.
      Reopened 2026-08-03 by T3 round 2. Step 5 (the camera control) DID pass and
      is recorded below, but **it passed on ROUND 1 CODE**, and round 2's F1
      showed that code filed the FIRST set of every camera workout as the user's
      own count with the form score discarded. Re-run against the current code it
      would have failed. **A passed control cannot be carried across a change to
      the thing it controls.** Step 6 (camera dies mid-set) is owed for the
      separate reason that its round-1 expectation was unreachable, so its
      "pass" proved nothing either.
      **To close:** one camera-on squat workout of TWO OR MORE sets — set 1 is
      the whole point — then the step-3 query showing BOTH sets `mode` `engine`
      with real `avg_form_score`. Then step 6.
- [x] 🔴 **The camera control step (smoke 5) — passed 2026-08-03 on ROUND 1
      code; see the reopened line above, which supersedes this for the tick.**
      Two real camera workouts stored the same day:
      `squat`/`engine`/3 reps/`avg_form_score` 100/`view` `side` (started
      07:45:37) and `squat`/`engine`/3 reps/score 67 (started 07:58:05). The
      camera path grades and stores exactly as before this card.
      **KEPT UNSTRUCK BECAUSE THE ROUTE TO IT IS THE LESSON.** For 35 minutes
      this looked like a card-breaking regression, and the chat said so. Three
      queries (07:19, 07:47, 07:50 UTC) found no engine row, and the chat used
      that absence to conclude, in order: that steps 5–6 wrote nothing; that the
      workout was NOT sitting in the browser queue ("ruled out"); and finally,
      after tracing `buildLogOnlySet` dropping 0-rep sets into `queueWorkoutSync`
      returning `no-sets` SILENTLY, that a camera workout measuring nothing
      vanishes without trace — "a real bug, and it's mine".
      **Every one of those was wrong, and the mechanism is worth knowing.** The
      07:45 workout was queued correctly and simply had not flushed: it reached
      the DB at 07:57:21, TWELVE MINUTES after it started, the instant Kd
      hard-reloaded and `AuthContext` kicked the app-load flush. That is the
      documented, accepted behaviour (DECISIONS 2026-07-15 — "a liveness delay,
      never data loss"), and it means **a DB query moments after a workout is not
      a valid test of whether it was saved.** The runbook told the reader to
      trust the DB over the screen and never said the DB can lag the screen by
      minutes; that is a real gap in the runbook, now fixed there.
      Two further self-inflicted confounds, both avoidable: the chat ran the
      mutation harness — which rewrites `ActiveWorkout.jsx` 26 times, live, under
      Kd's running dev server — WHILE Kd was mid-smoke, so an unknown part of his
      session exercised deliberately sabotaged code; and it read `no-sets`, a
      real silent path, as the explanation for an absence that had a duller
      cause. **Do not run the mutation harness while a smoke is in progress.**
      Smoke 6 (camera dies mid-set) remains screen-only — see its own line.
- ~~🟡 **Switching between the camera and hand counting MID-WORKOUT, by
      choice.**~~ **STRUCK 2026-08-03 — Kd RULED IT WILL NOT BE BUILT**, in
      response to the T3 F2 finding: "if some chooses by hand then they can not
      change to camera in the middle of exercise same for the other part." The
      choice is made before the workout and is fixed for its length, both ways.
      **This is a design rule now, not an absent feature**, and the code enforces
      it in two places: `engineStalled` is sticky for the set it fired on, and
      `reconcileSets` rule 1 gives a hand-owned set to the user even when the
      engine also filed one. The ruling is what CLOSED F2 — the alternative on
      the table was comparing rep counts, which is a worse rule for the same
      reason it was tempting: it makes the stored number depend on arithmetic the
      user cannot see.
      **NOT struck, and deliberately: the AUTOMATIC handover when the camera
      DIES.** That is not a switch the user chooses, it is the only alternative
      to a set they cannot finish, and removing it would restore the exact defect
      this card exists to kill. Camera → hand on failure: yes. Hand → camera
      ever: no.
- [ ] 🟡 **The LOCAL pose model is broken — every camera workout silently
      downloads it from a CDN instead.** Found 2026-08-03 in Kd's smoke console,
      NOT caused by this card and not fixed by it (R1.1 — reported, not touched).
      MediaPipe fails to open the bundled model with `Unable to open zip
      archive` (`MediaPipeTasksStatus=104`), retries GPU→CPU, fails both, logs
      `local model unavailable, trying remote CDN`, and only then succeeds:
      "MediaPipe ready" arrives ~1.4 s later than it should. Consequences:
      camera workouts need INTERNET even though the whole engine was built to
      run offline (Part 2 I1 / the P1.10 Done gate's "full workout with the API
      server off"), and the first-set delay is exactly what the untested
      5-second stall threshold trades against (its own line above). Likely a
      corrupt or LFS-pointer model file in the web assets rather than a code
      fault — check the file's real size first.
- [ ] 🟡 **Replace the "who is counting this set?" if-ladder with one explicit
      state machine.** Raised 2026-08-04 after FOUR T3 rounds found ELEVEN
      blocking defects, and the same one kept returning in a new disguise: the
      hidden-tab/backgrounded-camera failure was found and "fixed" in rounds 2,
      3 AND 4, by three different routes (the stall poll, the mute latch, the
      error stamp). Each fix guarded one path; the next round found the next.
      **The cause is the shape of the code, and CLAUDE.md R2.4 already forbids
      it**: `countItYourself` is a four-term boolean OR, fed by a sticky key
      written from two separate effects, with `document.hidden` guards in two
      places and a special case for redo — the "ad-hoc if-ladder" the rule names.
      Nobody can enumerate its states, which is why every round found a new
      combination rather than a new mistake.
      **Shape of the replacement:** one pure reducer over three states —
      `deciding` (the hook has not answered for this exercise) · `camera` · `you`
      — with an explicit transition table: the hook answers → camera or you; a
      camera failure or stall → you, locked for the set; hidden/paused/resting →
      NO transition; a new set → deciding. Then a table test walks every row, and
      a new situation must be ADDED as a row or the test fails.
      **DELIBERATELY NOT DONE INSIDE THIS CARD (Kd, 2026-08-04).** The chat
      proposed doing it immediately; Kd's judgement was that a rewrite at the end
      of an exhausted four-round card is how you get rounds five, six and seven,
      and that the exit is his smoke run, not more new code. Correct call —
      recorded here so the idea is not lost, to be taken as its own small card in
      a fresh chat, on committed and smoke-passed code.
- [ ] 🟡 **`captureHandCountedSet` silently ignores render state — any future
      guard added inside it will not work.** Found 2026-08-03 by T3 round 2's
      mutation run, indirectly. It is a `useCallback` pinned to `[exercises]`, so
      anything it reads that is not a ref comes from the FIRST render of the
      workout. Today it reads only refs, deliberately and correctly. The hazard
      is the next edit: a reviewer or a chat adding an ordinary-looking condition
      like `if (analysisAvailable) return;` gets a guard that never fires — on
      every camera workout that value is `false` at first render, because the
      pose hook answers one commit later. **This was not theoretical: mutant M8
      injected exactly that guard and went ALIVE for precisely this reason.**
      Re-anchoring it onto a ref read did not help either — the second form asked
      "has the engine filed this ordinal?", which at capture time is always no —
      so M8 was RETIRED in round 3, with its reasoning kept where it stood in
      `mutate-write-path.mjs`. Nothing is broken now;
      what is owed is making it hard to get wrong — either widen the deps, or
      pass the values the function needs as arguments from its call sites.
- [ ] 🟡 **The Coach's message id still assumes a secure context — the assumption
      THIS card deleted.** T3 F8, 2026-08-03. Reported not fixed (R1.1): not this
      card's file. `coachApi.js` calls `crypto.randomUUID()` bare, under a comment
      justifying it as "the same requirement the sync path already relies on,
      ActiveWorkout.jsx". The sync path stopped relying on it the moment a workout
      could start without ever asking for a camera — `newWorkoutId` now falls back
      to `getRandomValues`. So on a plain-http origin (a phone opening the dev
      server by LAN address) sending a coach message throws where a workout now
      survives. The comment is the dangerous part: it cites a guarantee that no
      longer exists, so a reader checking it would conclude the call is safe.
      Fix is the same three-line fallback, or lift `newWorkoutId` into a shared
      helper both call.
- [ ] 🟡 **The camera is switched on before the user can say they don't want it.**
      T3 F9, 2026-08-03. Reported not fixed (R1.1): pre-existing mount behaviour,
      not something this card introduced. `PreWorkout` calls `getAvailableCameras()`
      on mount, which calls `getUserMedia` unconditionally, then starts the camera.
      So a user who always counts their own reps still gets a permission prompt and
      a lit recording light on every visit, and the new copy that says no camera is
      used is only true AFTER they have already been asked. The device list needs
      permission to carry labels, which is why it was written this way — but the
      list is only needed once the camera path is actually chosen.
- [ ] ⚪ **The rep-counting choice is not remembered between workouts.** Created
      2026-08-03. Every workout starts on "Use the camera" and a user who always
      counts by hand re-picks every time. Deliberately out of scope: per-user
      preference storage on this branch is `packages/shared` + the profile API,
      not a localStorage flag, and that is a card not a line of code.
- [ ] ⚪ **The 5-second camera-stall threshold has never been watched by a
      human.** Created 2026-08-03. `ENGINE_STALL_MS` in `ActiveWorkout.jsx` is
      how long a camera-graded set may produce no analysed frame before the
      screen offers hand counting. **It is not a spec value — there is none**
      (Part 0 rule 4 applies to spec numbers; this is a UI patience threshold).
      Chosen so a slow MediaPipe start does not flash the button and a dead
      camera does not cost a whole set. Never measured on a real slow phone,
      where model load is exactly the case it is trading against — the mobile
      camera smoke below is where it would be observed.
- [x] 🔴 **Workout history calendar — DONE 2026-08-04** (WorkoutCalendar →
      workoutApi.getHistory). **CLOSED under the two-round T3 cap after round 2
      (DECISIONS :4355): 6 findings, 1 user-visible, all fixed.** The visible one
      was a bold "0 active days this month" printed for a month the walk never
      finished reading — beneath the very caption admitting so; five others were
      states no render test had ever exercised (the truncation caption, the plan
      clamp's straddling arm, the "+N more" chip), each measured to survive with
      all 62 tests green. Round 1's two fixes were independently audited and both
      hold. Final: web 426/426, 29/29 mutants RED, `vite build` green. No
      re-smoke owed — both changed sentences need 1,000 workouts to reach, so no
      step of the 8-step smoke touches them.
      **HISTORY BELOW, kept because its lessons outlive the card.**
      **UNBLOCKED AND UNPARKED 2026-08-04 (DECISIONS :4119) — the code is now on
      `web-repoint`.** Two-round T3 cap, set before round 1.
      **SMOKE ROUND 1 RAN 2026-08-04 AND FAILED — one defect, VISIBLE, now
      FIXED (DECISIONS :4182).** Every duration on Kd's screen was false: real
      `duration_ms` of 8491/4767/36290/37681 displayed as `0m`/`0m`/`1m`/`1m`,
      i.e. two workouts shown as taking no time and two rounded UP past a minute
      they never reached. Cause: the OLD backend sent whole MINUTES, so rounding
      was right for the field this replaced and wrong for milliseconds — and
      every fixture in the suite used 1,800,000 ms, so no test could see it.
      Fixed to whole seconds through the shared `secondsLabel`; reads
      `8s`/`5s`/`36s`/`38s`. Failing tests shown RED first (R9.5); M23 guards the
      regression. 417/417, 23/23 mutants RED.
      **STEPS 1-4 OTHERWISE PASSED** — camera workouts 83%/84% in green,
      hand-counted ones `—` in the neutral tint, chips correct, and the mixed
      camera+hand workout rendered as ONE session with both chips.
      **SMOKE FULLY DISCHARGED 2026-08-04 — ALL 8 STEPS PASS on `5133114`**
      (result table in `RUNBOOK/smoke-workout-calendar.md`). The re-smoke of
      steps 1-4 was run on the FIXED bytes rather than carried over, because the
      numbers Kd had judged were the ones that changed (the XP-card precedent):
      the four sessions now read `8s`/`5s`/`36s`/`38s`, confirmed by Kd.
      Steps 5-8 had never run before today and all pass — including step 8, the
      hand-counted case written for this card's own new coverage.
      **T3 ROUND 1 (2026-08-04, DECISIONS :4267): 6 findings, 1 VISIBLE, ALL
      FIXED.**
      F1 (VISIBLE) was the duration defect's twin: the walk pages BACKWARDS from
      today, so an unreadable row from a NEWER month was counted and printed as
      "1 workout couldn't be read" over a month that had read perfectly — and
      every fixture put its unreadable rows INSIDE the viewed month, so none
      could see it. F2 (blocking, not visible) was measured both ways: the
      day-bucketing guard was **inert in CI** — with the UTC-day defect live the
      suites went 57/57 GREEN under TZ=UTC and RED only under Asia/Kolkata, and
      runners are UTC. Zone now pinned in `apps/web/vitest.config.js`, with a
      test asserting the pin survives and `turbo.json`'s input glob widened so
      deleting it cannot be masked by a cache hit.
      **The harness's OWN bite-check was blind** and that is the finding to
      remember: it claimed "every sed is proven to have bitten (md5 must
      change)", but the files are CRLF and `sed -i` rewrites them to LF, so the
      md5 moved on a sed matching nothing. A mutation whose anchor had DRIFTED
      was therefore reported as a missing TEST. Fixed to compare content; the
      false header claim corrected in place. Same class as DECISIONS :3720.
      Two untracked deferrals it surfaced now have their own lines below (the
      calorie BANDING rule, and the unit-drift gap in the reader's stand-in for
      `safeParse`).
      Measured after the round: web **422/422**, **25 mutants 25 RED, 0 alive,
      0 invalid**, `vite build` green, lint 1 pre-existing error (own line).
      **WHAT DISCHARGED THE BLOCK** was other cards, not a ruling here: blocker 1
      below said the new API held only squat / jump-squat / chair-squat
      workouts, and the 58-exercise catalog (:3538) plus the web write path
      (:3610) closed that; the rep-choice smoke (:4081) confirmed a hand-counted
      workout reaches the API from a real browser.
      **THE ONE GAP THE PARKED CODE HAD, and it is a date.** The screen was
      built 2026-08-01; hand-counted workouts first reached the new API on
      2026-08-02. So no parked fixture carried their shape — real duration, real
      kcal, and NO form score (migration 0009's CHECK forbids a log-only set
      from carrying one). The code was already correct; the COVERAGE was absent,
      which is the gap this repo has lost eight rounds to. Five render tests and
      mutations M19–M22 added. Measured: web 413/413, 22/22 mutants RED with a
      green baseline before AND after, `vite build` green.
      **ALSO CORRECTED IN THAT COMMIT:** `RUNBOOK/smoke-workout-calendar.md`
      claimed an unknown Form score was "not browser-reachable". True when
      written, false since 2026-08-02. Step 8 walks it now, and the smoke's setup
      warns that pre-2026-08-02 months look emptier here than in the old app —
      those workouts exist in the old backend alone, so that is not a defect to
      report.
      **The blockers below are kept as the record of why it waited. Blocker 1 is
      DISCHARGED; 2 and 3 were solved in the parked work itself.**
      **THE ORIGINAL ENTRY FOLLOWS AND ITS PRESENT TENSE IS 2026-08-01's** — in
      particular "code is on branch `workout-calendar-parked`, deliberately NOT
      on `web-repoint`" was true then and is superseded above. The branch is
      left in place unmerged as the provenance of these files.
      A chat
      recommended this card to Kd as the cheapest one left — the THIRD time,
      on the reasoning the next line pre-refutes — built it to PROVE (320/321,
      18/18 mutants), and only then read this entry. Code is on branch
      `workout-calendar-parked`, deliberately NOT on `web-repoint`, which merges
      wholesale at cutover and would have ARMED the broken repoint. Blockers 2
      and 3 below were solved in that work (detail endpoint for names; the Card-5d
      page-walk) and the dead `getHistory` duplicate is fixed there too, so the
      card resumes at the smoke + T3 once the WRITE-PATH item above is ruled.
      `/v1/workouts` exists, which is why this was twice (wrongly) recommended
      as the cheapest card left; existence is not usability, and three separate
      blockers were found only on the third check (2026-07-21):
      1. **THE BLOCKER — the new API holds only a SUBSET of workouts.**
         `syncClient.js:72` — `if (!summaries || summaries.length === 0) return
         { queued:false, reason:'log-only' }` — so an all-log-only workout
         (no engine-scored sets) is deliberately never synced (the ruling at
         DECISIONS 2026-07-10 P1.10c: with no SetSummaries there is nothing
         engine-verified to send, and `sets: []` would record an empty engine
         workout). Meanwhile `ActiveWorkout.jsx:536` still writes EVERY workout
         to the old backend via `completeSession`. Repointing the calendar
         today would therefore BLANK every hand-logged day — history showing
         less training than actually happened. **Unblocks only when the workout
         WRITE path moves to the new API, which is cutover work itself.**
      2. The list item carries no exercise breakdown (`workoutListItemSchema`:
         setsCount/totalReps only). Exercise identity lives on the per-workout
         DETAIL endpoint (N+1 for a month view) and as SLUGS — display names
         are the separate owed "exercise library content" card.
      3. `/v1/workouts` is a keyset cursor list with no month filter, so a
         month view needs the page-walk pattern from Card 5d.
      Also fix while here: `workoutApi.js` declares **`getHistory` TWICE** in
      one object literal (lines 5 and 9) — the second silently wins, so the
      `(limit)` variant is dead code and a footgun.
- [x] 🔴 **Dashboard XP — DONE 2026-07-30**, ticked with the XP display line above under THE CAP after T3 round 11. (Was: UNTICKED 2026-07-26 by its own T3, STILL OFF after round 4.)
      **SMOKE HALF DISCHARGED 2026-07-28 — the re-smoke PASSED, all 11 steps**
      (`RUNBOOK/smoke-xp-dashboard.md`). Step 6 is this line's own defect and it
      is CLOSED at the browser: in the `statsEmpty` state — a 200 carrying
      `{"stats":{}}`, the exact payload round 4 F2 was about — the three stat
      cards read `—`, not "0 workouts / 0h / 0 kcal". Step 17 (`emptyLists`)
      confirms the opposite sign still works: a zero the server actually sent
      still renders as `0`. **DONE 2026-07-30 — ticked with the XP display line
      above, under THE CAP after T3 round 11.** (Was: tick stays off
      pending T3 round 8; rounds 8, 9, 10 and 11 all ran.) The
      original entry follows. The
      card repointed XP but left the page's OTHER six figures fabricating
      (`s.total_workouts || 0` and friends), and `stats` is null whenever the old
      read fails — so a real "Level 2" sat beside three fabricated zeros and lent
      them credibility, while the strip below it correctly showed "—/—".
      Round 3 "fixed" this with `statsKnown`; **round 4 F2 found that fix was the
      SAME DEFECT under a new name** — `Boolean(stats?.stats)` asserted the
      envelope, then six sites read fields off it with `?? 0`, so a 200 carrying
      `{stats:{}}` (or any subset missing `total_minutes`) still printed
      "0 workouts / 0h / 0 kcal" as fact. That is verbatim the shape round 3 had
      just deleted from two OTHER files and shipped here in the same commit. The
      guard could not catch it because it banned `|| 0` and PERMITTED `?? 0`,
      which is the spelling the code was actually written in.
      Round 4 also found the week strip claiming seven untrained days it knew
      nothing about (F3), beside its own correct "unavailable" caption.
      Now fixed per-field through `readStatsView`, with the envelope gate gone
      entirely and render tests covering `{stats:{}}`, a partial 200, and the
      unknown week strip. Re-ticks on a fresh smoke AND a clean round 5.
      The DECISIONS entry calling that mix "honest" was false and is struck there.
      Kd chose
      option (a) on 2026-07-26 (ship the XP card, then this immediately) and
      confirmed the defect from his own re-smoke screenshot: the same page read
      "Level 1 / 0 XP earned" in a stat card and "0/100 XP → Level 2" in the
      Experience Points panel while the strip below it read "330 XP · Level 2".
      All four Dashboard sites now read the new API through the same `useXp()`
      hook and the shared formatters: the stat card's level + total, the XPBar,
      and the small "Level" figure. **The `xp % 100` maths is deleted FROM THIS
      PAGE** — the original wording said "DELETED" full stop, which its own T3
      showed was false of the app: `PostWorkout.jsx` still carries it, and has
      its own line below — it
      assumed every level costs 100 XP, but the curve is
      `floor(100*(level-1)^1.8)` (badges.py:215-227), so it was wrong for every
      user above level 2; the server's own `xpInLevel`/`xpForNext` are rendered
      instead. No fabricated defaults remain (`s.xp || 0`, `s.level || 1`, and
      XPBar's `xp = 0, level = 1` parameter defaults are all gone).
      The XP-guard's consumer list is DERIVED from the hook's importers, so it
      FAILED on this card until Dashboard was added — the guard working as
      designed rather than needing a human to remember. Both regressions
      mutation-verified caught: reinstating `xp?.level || 1`, and reinstating
      `xp.total % 100`. web 177 passed / 1 failed (178, the pre-existing
      syncClient quirk); lint clean on both touched files; `vite build` green.
      **SMOKE PASSED (Kd, 2026-07-26):** the stat card read "Level 2 / 330 XP
      earned", the Experience Points panel read "Level 2 / 230/248 XP → Level 3"
      with the bar nearly full, and all three XP surfaces on the page agreed
      with the sidebar and with `/v1/gamification/me`. The contradiction that
      the XP card's own smoke exposed — a real level beside a fabricated one on
      one page — is closed.
      **Still owed with it:** a T3 — no independent review has seen this card,
      and on the XP card each of two rounds found the previous round's fix had
      opened something new.
      ORIGINAL ENTRY, kept because it is the evidence the deferral was recorded
      rather than remembered: "Dashboard's XP surfaces still fabricate — XPBar +
      Current Level StatCard." Kd-ruled OUT of the 2026-07-26 XP-display card and
      given this line in the same commit, per the deferral rule. `Dashboard.jsx` renders
      `s.xp || 0` / `s.level || 1` (StatCard, XPBar, and a "Level" stat row) off
      `workoutService.getStats()` — a **different** old endpoint from the two
      the XP card repointed, so folding it in would have meant a second repoint
      in one card. Per the no-removal rule it STAYS working on the old backend,
      untouched, until its card. Two things that card must not inherit:
      (a) the `|| 0` / `|| 1` fallbacks are the fabrication class the XP card
      exists to remove — Dashboard shows a real-looking "Level 1" and "0 XP" for
      everyone whose stats read fails; (b) `XPBar` renders
      `{progress}/100 XP → Level {level + 1}`, i.e. a **hardcoded 100-XP
      level**, but the real curve is not linear (L2=100, L3=348, L4=722 —
      `xp_for_level`, badges.py:215-227). Render the API's precomputed
      `xpInLevel`/`xpForNext`/`progressPct` via the existing `useXp()` hook;
      never client-side XP math. Unblocked today — the endpoint exists.
- [ ] 🟡 **`/dashboard` and `/achievements` redirect to `/login` when the OLD ML
      API is RUNNING and rejecting.** Found by the XP card's T3 (2026-07-26)
      while it was busy getting the same question wrong in the other direction.
      `mlApi` sources a Bearer from `localStorage.accessToken`, which Card 1 no
      longer writes, so every old-backend read 401s and `mlApi.js`'s response
      interceptor navigates to `/login` before the page paints. The planned
      Card-1 interim (DECISIONS 2026-07-15: "the planned multi-card
      consequence"), closing when `workoutApi` / `recommendationApi` /
      `gamificationApi.getOverview` get their own repoint cards (③/⑦).
      **THE NUANCE THAT MATTERS FOR EVERY SMOKE FROM NOW ON, and that the XP
      card originally got wrong:** this only happens when the old API is UP and
      answering 401. When it is simply NOT RUNNING — the ordinary local-dev
      state — the axios error carries no `response`, `error.response?.status`
      is undefined, no redirect fires, and the page renders its own failure
      state. So "old backend down" is MORE smokeable than "old backend up", and
      a card that assumes unreachability without checking which case it is in
      will under-claim what it can prove.
- [ ] 🟡 **Achievements can now show two contradictory XP totals for the same
      user.** Raised by the XP card's T3 (2026-07-26); correct under no-removal,
      but it was not recorded and it is visible. The page HEADER now reads the
      new API (`xp.level` / `xp.total`) while the leaderboard tab's rows —
      including the current user's own highlighted row — still read the OLD
      backend's `entry.level` / `entry.xp`. Before this card both came from one
      payload and agreed by construction; they are now two stores whose totals
      accrued independently (the new one recomputes from history and diverges
      by design — see `xp.ts`'s governing rule). Closes with the leaderboard
      card (P4.x), which is where `entry.*` gets its new-API home. Until then,
      "header level vs. my own leaderboard row may disagree" is an EXPECTED
      smoke observation, not a bug to chase.
- [ ] 🟡 **`.catch(console.error)` on axios errors logs the whole error object,
      including any Authorization header.** Pre-existing, R3.10. **CORRECTED
      2026-07-26 twice over by the T3s.** (a) The original line said the leaked
      value is the string "Bearer null" — FALSE: `mlApi.js` sets the header only
      `if (token)`, so on this branch NO Authorization header is attached at all.
      The item is real but LESS urgent than recorded, not more; it becomes real
      the day any client attaches a live token. (b) The line named only
      `GamificationStrip.jsx` and `Achievements.jsx` while its own criterion was
      "files the XP card edited" — `Dashboard.jsx` qualified too and was missing.
      Round 3 has since converted the two gamification call sites to the
      `err?.message` form as part of the `allSettled` change, so what remains is
      the wider sweep: every other `catch(console.error)` on an axios call in
      `apps/web`, `Dashboard.jsx` included.
- [x] 🔴 **`PostWorkout.jsx` has the same 100-XP-per-level bug the Dashboard
      card deleted — and it is shown after EVERY workout. DONE 2026-07-28,
      commits `c681b23` + the round-4 fixes.** Smoke passed 2026-07-27 on a
      Level-3 account; FOUR T3 rounds (7+8+8+9 findings, 7 blocking, all fixed),
      round 4 clean of user-visible defects and recommending the tick.
      **THE TICK'S HISTORY, kept because it is the point:** it went on early
      after round 1, and round 2 took it off — correctly, on two counts. (a) It
      named no commit while nothing was committed, against OWED's own "tick it,
      date it, NAME THE COMMIT". (b) The argument for ticking without a clean
      round — "round 1 found no behaviour defect, only gaps in the protection" —
      is what the re-tick precedent forecloses. It goes back on now under a
      stopping rule Kd set explicitly: a finding blocks the tick only if it is a
      defect a user could see. Round 4 found none, said so, and recommended
      this. (Round 2's finding was a VACUOUS ASSERTION over a screen-visible
      defect class — corrected at round 4 F4, which verified ShareCard already
      read `formatLevel(xp)` before round 1: the mutant would have been visible,
      the shipped code never was.)
      Found by the T3 on
      888e750 (its F4) and given this line because the MIGRATION STANCE requires
      the deferral to be recorded in the deferring commit; grep confirmed
      "PostWorkout" appeared in neither OWED.md nor DECISIONS.md before now.
      `const xpProgress = summary.current_xp % 100`, rendered by a three-span
      row as `Level {summary.current_level}` · `{xpProgress}/100 XP` ·
      `Level {summary.current_level + 1}` — the identical assumption, on a live
      route (App.jsx). The real curve is `floor(100*(level-1)^1.8)`, so it is
      wrong for every user above level 2.
      **QUOTE CORRECTED 2026-07-27:** this line used to render the second half
      as `{xpProgress}/100 XP → Level {summary.current_level + 1}`, which is the
      DASHBOARD's wording — PostWorkout has no arrow and splits the caption
      across three spans. Small, but it is a paraphrase of a file the writer had
      not opened, which is exactly what CITATION DISCIPLINE (DECISIONS
      2026-07-20) exists to stop: quote the text, do not reconstruct it.
      OUT of the Dashboard card's scope because it reads a different payload
      (`summary.*` from the workout-complete response, not `/v1/gamification/me`),
      so it needs its own repoint rather than a formatter swap. **OWED.md said
      "The `xp % 100` maths is DELETED" — true of the Dashboard, false of the
      app**, which is the "fix the class, not the case" failure this project
      keeps recording; that wording is corrected on the Dashboard line above.
      **STATUS 2026-07-28: the user-facing bug IS fixed and browser-verified**
      (smoke passed on a Level-3 account, where the right answer `332/374 XP`
      and the deleted maths `80/100 XP` are visibly different) — but the line
      stays open until a clean round and a commit. Two T3 rounds have now found
      the same shape: the fix is right, the protection around it is not. Three
      vacuous assertions across the two rounds, each satisfied by a DIFFERENT
      site than the one it named. What landed: the page takes the level and the
      position within it from `useXp()` through the shared formatters exactly as
      the Dashboard does, `xpProgress` is deleted, and no XP arithmetic remains
      on the page. The SHARE CARD moved to the same source in the same commit —
      it read `summary.current_level`, so the page and the downloadable PNG
      would otherwise have printed two different levels. Web-only: no API
      change, no migration, no new dependency.

- [ ] 🟡 **The post-workout XP bar no longer animates from where you were to
      where you are.** Raised by T3 round 4 (F6) as a deferral-rule gap: the
      PostWorkout repoint changed the bar's `initial` from
      `max(0, xpProgress − xp_earned)` to `0`, so it now fills from empty rather
      than sweeping the gain. The reasoning was sound and declared in DECISIONS
      — the old "before" was computed on the broken `% 100` curve, and
      reconstructing it today means arithmetic across two stores that diverge by
      design — but CLAUDE.md's rule is that a UI reduction forced by a missing
      backend surface gets an OWED LINE, and that commit added three and missed
      this one. What the user lost is the ANIMATION, not a number (the number it
      used to sweep from was wrong), which is why round 4 did not call it
      blocking. Closes when the new API carries a per-workout delta: the bar can
      then start at `progressPct − thatDelta` honestly, from one store.

- [ ] 🟡 **The post-workout XP can be one workout stale — on the one screen that
      exists to be about that workout.** Raised by the PostWorkout repoint
      (2026-07-27); recorded rather than fixed, because closing it is sync-card
      work and this card was scoped to the curve. `ActiveWorkout.jsx` calls
      `queueWorkoutSync(...)` FIRE-AND-FORGET and navigates to the summary route
      about two seconds later, while the new API recomputes XP server-side at
      `POST /v1/workouts/sync`. So `useXp()` here can read a total that does not
      yet include the workout just finished — and offline it certainly does,
      since the queue flushes later BY DESIGN (R10.3). Nothing is fabricated:
      every number shown is a real server value, and the `+N XP` delta beside it
      is the old store's own figure. But the screen can truthfully report a
      level that looks like the workout did not count, which is a poor thing for
      a congratulations page to do. Real fixes are a refetch on the
      sync-settled event, or a shared XP store with invalidation — the SAME
      mechanism the `useXp` staleness line needs, so they should be built
      together rather than twice.

- [x] 🟡 **`PostWorkout.jsx`'s `summary` payload — DONE 2026-07-30.** Was: UNPARSED,
      the class rounds 4-7 closed for the other three old-backend payloads.
      **CLOSED under THE CAP (DECISIONS :2692, ruled BEFORE round 3 ran): round 3
      returned nine findings and ZERO VISIBLE ones, so the card closes and this
      box ticks.** Commits `fb1956c` (the card) · `271bbc8` (smoke) · `677ba90`
      (round 1) · `b2fa37a` (round 2) · `1334236` (the cap) · this one (round 3).
      **WHAT THE TICK RESTS ON, stated so it cannot be misread later:** Kd's
      passed browser smoke, THREE independent fresh-chat reviews, 21 findings
      across them all fixed or given lines, and a mutation harness whose own three
      false-success modes were each found and closed. **Not "nobody found
      anything"** — every round found six to nine things, and not one of them was
      a defect a user could see. No component file changed in ANY of the three
      rounds (reviewer-verified, not merely claimed), so the bytes Kd smoked are
      the bytes that ship.
      **T3 ROUNDS 1, 2 AND 3: 6 + 6 + 9 findings, ZERO VISIBLE in any of them.**
      **T3 round 2 (2026-07-30, fresh chat; full entry DECISIONS :2614).** It
      reproduced both PROVE claims before writing a word and re-verified round 1's
      five claims, then found six more — all mutants over correct code.
      **F3 is the one to know: the mutation harness had NO GREEN BASELINE, so
      "RED" could not distinguish "an assertion caught it" from "the tests never
      ran"** — proven with a broken runner producing a full table of REDs and exit
      0. Fixed, and the fix verified with the reviewer's own probe (exit 1, table
      never reached). F1: the Workout Time SUB-LINE had no failing assertion and
      printed "NaNh NaNm total" under mutation — root cause, no fixture had
      `active_seconds` absent with `duration_minutes` present. F2: round 1's own
      `/null/` sweep was added at ONE of its two sites. F4: a comment's evidence
      was false, and the rig now carries both record shapes so that path is
      browser-reachable at last. F6: harness restoration was silent on an
      uncatchable kill.
      Now a green baseline plus **21 mutations, 21 RED**. web 272/273.
      **No component file changed in either round**, so nothing a user sees has
      moved since the smoked bytes.
      **THE PATTERN, recorded because it is the card's real finding:** "fixed the
      instance, left the class" has happened FOUR times here — `xp_earned` →
      `current_streak` → `durationMinutes` → the sweep's own second site — each
      found in the fix written for the previous one.
      **T3 round 1 (2026-07-30, fresh chat; full entry DECISIONS :2546).** Every
      finding was a MUTANT a user could have seen, over shipped code that is
      correct; none was deferred, so none created an OWED line. F1: the
      anti-fabrication sweep checked `undefined`/`NaN` — what the PRE-fix code
      produced — but not `null`, the one spelling the NEW code can produce.
      **F2 is the one to remember: `current_streak` rendered at both surfaces and
      was asserted at neither — the same rename regression this card already
      recorded, ONE FIELD OVER, in the same commit.** F3: all four list-element
      render bodies were unreachable from every fixture. F4: the empty-200 test
      proved the toast and not the redirect. F5: "13 mutations, 13 RED" was
      unreproducible from the repo — the harness now lives at
      `apps/web/tools/mutate-postworkout-summary.sh` and exits non-zero if a
      mutant survives. F6: a helper's doc claimed protection it could not give.
      Now **18 mutations, 18 RED**, five of which were GREEN before this round.
      web 270/271. **No component file changed, so no re-smoke is owed** (the
      Round B precedent, DECISIONS :1950).
      **SMOKE HALF DISCHARGED 2026-07-30: PASSED (Kd), on commit `fb1956c`**,
      reported as a blanket pass rather than step-by-step and recorded that way
      (result at `RUNBOOK/smoke-postworkout-summary.md`). The `healthy` CONTROL was
      part of the run, which is the step that matters most — it is the only one
      that can catch the fix dashing out numbers the backend really sent.
      **THE TICK IS KD'S CALL, and the honest case against ticking is recorded
      first.** This card's own predecessor writes, on the line above: "the
      argument for ticking without a clean round — *round 1 found no behaviour
      defect, only gaps in the protection* — is what the re-tick precedent
      forecloses." That describes rounds 1 AND 2 exactly, and round 2's reviewer
      declined to recommend closure for that reason in its own words: the
      instance-not-class pattern "is now the card's most reliable output, and each
      round has found it in the fix written for the previous one."
      **RESOLVED 2026-07-30 — THE CAP (Kd ruling, DECISIONS :2692), set BEFORE
      round 3 runs so it binds whatever comes back: ROUND 3 IS THE LAST ROUND.**
      Nothing VISIBLE ⇒ this line TICKS. Something VISIBLE ⇒ it is fixed and the
      line ticks on that fix. NOT-VISIBLE findings are fixed if cheap, else take
      their own lines here, and block nothing.
      Round 3 exists for ONE named reason rather than as another cycle: **round 2
      fixed the mutation harness itself and that fix is unaudited**, so every
      "21 RED" figure this card quotes rests on a baseline gate written by the same
      chat, in the same session it was told the instrument was untrustworthy.
      The evidence the cap rests on: rounds 1 and 2 each returned six findings and
      ZERO VISIBLE ones, from two independent fresh chats; neither changed a
      component file, so the bytes Kd smoked at `fb1956c` are still the shipping
      bytes. The card will tick on a passed smoke + three fresh-chat reviews + a
      baselined harness — not on "nobody found anything": twelve findings were
      found and all twelve were fixed.
      What landed: `readSummaryView` + `formGrade` + the time/percent formatters in
      `gamificationApi.js`, beside `readStatsView` — which parses a
      `workoutService` payload too, so the location is precedent and not a new
      pattern. All 34 bare reads across 9 fields go through it; ONE grade ladder
      serves the page AND the share card, so the PNG can no longer print
      "undefined% (D)"; a 200 with no `summary` key takes the page's EXISTING
      toast+redirect instead of rendering a blank white screen; a list arriving as
      a string can no longer reach `.map` and blank the page. web **269/270** (the
      1 is the `syncClient` env quirk on its own line below), **+21 tests**,
      **13 mutations / 13 RED**, lint parity measured at HEAD and after. Smoke
      steps at `RUNBOOK/smoke-postworkout-summary.md`; new `unscored` rig state.
      Full entry at DECISIONS :2444.
      **THE LESSON, recorded because it nearly shipped:** `xp_earned` survived the
      snake→camel rename at ONE of two sites, so the page's XP card read "—" for
      every workout while the PNG read "+70" — and all 7 render tests stayed
      GREEN, because a whole-document `/\+70/` sweep is satisfied by the SHARE
      CARD (round 1 F1 verbatim). Found by grep, not by the tests. The missing
      identity assertion now exists and its mutation is RED.
      ORIGINAL ENTRY FOLLOWS. Reported not fixed
      by the PostWorkout XP repoint (2026-07-27) under R1.1, and Kd ruled
      "record as OWED, fix XP only" at that card's plan gate: the named task was
      the XP curve, and adding a fourth reader would have doubled a card on the
      page carrying the app's last live XP defect. CONCRETE, not theoretical —
      `getFormGrade(summary.form_accuracy)` has no unknown arm, so an absent
      score falls through every threshold to the final `return`: grade **D**,
      "Keep practicing", in red, with the bar animating to `undefined%`. That is
      a definite bad-form verdict on a workout whose form we were never told,
      i.e. verbatim round 5 F3's defect ("an unknown accuracy painted RED by the
      <60 branch") one page along. **A SECOND CONCRETE CASE, found by the T3:**
      a 200 with no `summary` key sets `summary = undefined` WITHOUT throwing,
      so the catch never runs and the page renders BLANK — no toast, no
      redirect, no text. The smoke rig's `empty200` state serves exactly that,
      and its comment says so, meaning a white screen there is the known state
      rather than a broken rig.
      **COUNT CORRECTED 2026-07-27 (T3 F5) — the line said "roughly fourteen",
      which was a guess.** Measured: 40 `summary.*` occurrences, minus 3
      comment-only and 3 `xp_earned` (which IS guarded), = **34 bare reads
      across NINE distinct fields** — `active_seconds` (8), `form_accuracy` (6),
      `duration_minutes` (6), `personal_records` (4), `current_streak` (4),
      `exercises_count` (2), `calories_burned` (2), `stretches` (1),
      `meal_suggestions` (1). (The review that raised this said eight fields; it
      is nine. A finding is a claim and inherits V1 too.) The fix is the
      established shape — a `readSummaryView` alongside `readStatsView` — and
      its natural home is the `workoutApi` repoint card, since that is the
      client this payload arrives on.

- [x] ~~🟡 **The XP bar's width has no protection a render test can give it —
      framer-motion is invisible to jsdom.**~~ **STRUCK 2026-07-28: THE PREMISE
      WAS FALSE, and this card should never have existed.** Raised by the
      PostWorkout T3 round 1 on the claim that `animate` "never executes under
      jsdom — the node reads `width: 0px` in every state". Round 2 MEASURED it
      on framer-motion 12.42.2: `0px` is the `initial`, and after the element's
      own `delay: 0.8 + duration: 1` the node settles at the real width. Round 1
      read the DOM about 1.8s too early — the existing `waitFor` resolves long
      before the animation ends — and generalised one instant into "every
      state". Measuring the case and calling it the class, in the fix written
      for exactly that mistake.
      **Consequences, all now undone:** the bar is asserted in the DOM where it
      always could have been (`expect(…style.width).toBe('61.5%')`, which
      catches the destructure bypass the regex cannot see); round 4's standing
      "add a render assertion instead" was never actually overridden; and no
      framer-motion mock is needed, so the 28 tests in that file stay untouched.
      Kept struck rather than deleted, per the rule that items leave this file
      by being done or by a ruling — and because "a card raised on a premise
      nobody measured" is the failure worth being able to find again.

- [ ] 🟡 **`gamificationApi.test.js`'s `validXp` fixture is impossible.**
      Found by T3 round 2 while checking a claim in the PostWorkout card — the
      corrected render fixture's comment cited this one as corroboration, and it
      does not corroborate. It reads `total: 330, level: 3, xpInLevel: 52`, but
      330 is LEVEL 2 on this curve (`xpForLevel(3)` = 348).
      **COUNT CORRECTED 2026-07-28 (T3 round 3 F3) — this line said "four of its
      six fields are unreachable together", and no reading of the block yields
      four.** Measured against `xp.ts`'s own `xpProgress`: hold `total: 330` and
      FIVE are wrong (the truth for 330 is level 2 / 230 / 248 / 92.7 / 348);
      hold the other five and exactly ONE is — `{level:3, xpInLevel:52,
      xpForNext:374, progressPct:13.9, nextLevelAt:722}` is `xpProgress(400)` to
      the digit. **So the fix is one character class: `total: 400`.** The same
      sentence also named `nextLevelAt` 348 and then left it out of its own
      tally. Recompute from `xpProgress`, never by hand — which is the whole
      lesson of the fixture this one was cited to corroborate.
      Same class as the render fixture corrected on 2026-07-27, one file along,
      and the tests using it are passthrough/shape tests that would pass with any
      six numbers, which is why nothing caught it. NOT fixed by the PostWorkout
      card (R1.1 — it is the XP card's file and its assertions would need
      re-checking against real values).

- [ ] 🟡 **`Running.jsx` fabricates a level: `stats?.running_level ?? 1`.**
      Found by the PostWorkout T3 (2026-07-27) while checking whether the
      100-XP class was really closed. It is verbatim the `user?.level || 1`
      class deleted from the Sidebar and the `s.level || 1` class deleted from
      the Dashboard — a confident "Level 1" for a user whose level nobody knows
      — on a live screen, differing only in which payload it reads (running has
      its OWN progression, `running.py`'s `running_xp`, which is a separate
      system from `user_xp` and was explicitly out of that card's scope,
      DECISIONS 2026-07-25 D4). Not fixed here (R1.1: different payload,
      different card). Closes with the running/geo repoint.
- [ ] 🟡 **The sidebar level is STALE until a full page reload.** Raised by the
      XP card's T3 round 2 (2026-07-26), which correctly demolished the reason
      the code gave for its own design. `useXp` reads once with `[]` deps and
      `Sidebar` mounts in `AppLayout` and never unmounts across navigation, so
      after a workout sync the sidebar keeps showing the pre-sync level until
      the user reloads. The comment had claimed the hook AVOIDED the staleness
      that an AuthContext value would have; it does not — the two differ only in
      WHEN the single read happens, and the honest reason to prefer the hook is
      that it is contained, not that it is fresher. Kd's smoke did not catch it
      because step 6 said "complete a workout, then reload", and the reload is
      exactly what hides it. Real fixes: refetch on the sync event, or a shared
      store with invalidation (which pairs with the dedupe line below). Not
      built with the card because either one is the Card-2/6 widening Kd ruled
      out — but the card must not claim freshness it does not have.
- [x] 🟡 **The XP source guards catch spellings, not the whole class — DONE
      2026-07-26 (round 4), by making the DOM test the protection of record.**
      Kd approved `jsdom` + `@testing-library/react` (R1.4) and
      `apps/web/src/pages/xpDisplay.render.test.jsx` now carries 13 render
      assertions; `vitest.config.js` gives `*.render.test.jsx` a jsdom
      environment. This also closes the JSX-coverage gap recorded from Cards
      2/3/4 for these three screens.
      **THE ORIGINAL TEXT OF THIS LINE WAS ITSELF FALSE, and the correction is
      the point:** it claimed "eight real bypasses were mutation-tested and are
      caught, including … destructuring defaults". Round 4 F1(a) then defeated
      the guard with exactly a destructure — `const { level = 1 } = xp ?? {}` —
      which `FIELD_READ` structurally cannot match, because it requires a `.` or
      `[` after `xp` and a destructure has neither. The earlier mutation must
      have tested a different spelling than the one the sentence names. Recorded
      here rather than quietly overwritten: a guard's own coverage claim is
      exactly the kind of assertion that needs re-testing, not re-reading.
      Ten bypasses across four rounds is the evidence that source-text matching
      cannot close this class; the guard stays as a cheap tripwire and its header
      now says so in those words.
- [ ] ⚪ **Render-test coverage is three screens, not all XP consumers.**
      Recorded 2026-07-26 (round 4). `xpDisplay.render.test.jsx` covers
      Dashboard, GamificationStrip and Achievements. **`Sidebar.jsx` is a
      `useXp` consumer with NO render assertion** — during round 4's mutation
      (b) the fabrication was re-introduced there and only the source guard's new
      positive control caught it, not a DOM assertion. Add a Sidebar render case
      when its layout dependencies (AppLayout, router) are cheap to mount.
- [ ] ⚪ **The guard's per-file lists are still four hardcoded literals.**
      Recorded 2026-07-26 (round 4 F8), which found the header's claim that they
      were "DERIVED from xpConsumers()" false — only the field-read scan is
      derived. `gamificationApi.test.js` hardcodes paths in the `gated` list and
      in three per-site blocks, so a FIFTH consumer added tomorrow gets zero
      gating coverage and nothing turns red. Not fixed in round 4 because the
      render tests now carry the real protection and growing this file further is
      explicitly the wrong direction (see its header); revisit only if a fifth
      consumer actually appears.
- [ ] ⚪ **`useXp()` makes one request per mounting component.** Sidebar always
      mounts it; GamificationStrip and Achievements add a second on their pages.
      A shared cache / in-flight dedupe (or a context value with a
      post-sync refresh) is the eventual home — deliberately NOT built with the
      XP card, because an unproven cache is worse than a cheap authenticated
      GET, and a value read once at session adoption goes stale on every
      workout sync. (2026-07-26.)
- [ ] ⚪ **XP display in the workout calendar — CURRENTLY DEAD, do not "restore"
      it.** WorkoutCalendar renders XP behind `session.xp_earned > 0`, but the
      old backend NEVER WRITES `xp_earned` onto a workout: the completion
      handler computes it, `$inc`s the USER's total and returns it in that one
      response (workouts.py:221-259, :311), while the session `$set`
      (:192-203) stores only completed/calories/duration/active_seconds/
      form_accuracy/exercises/completed_at. `/history` then projects a field
      that was never written (:373) and reads `s.get("xp_earned", 0)` → 0 for
      every workout, so the block has never rendered for anyone. **The
      no-removal rule is therefore NOT engaged** — there is no live feature to
      preserve when the calendar eventually moves. Any real XP display is
      gated on the XP-storage card above (P2.3 GAP-1), not on this.
      (Found 2026-07-21 while planning the calendar card.)
      **AMENDED 2026-08-01 when the calendar actually moved (DECISIONS :2912).**
      The block is gone from `WorkoutCalendar.jsx` with the old payload, and
      nothing a user has seen was lost — this line's own finding is why. What
      this card ADDS to it, command-verified: per-workout XP has no home in the
      NEW schema either. `grep -rn "xp" apps/api/src/db/schema/workouts.ts`
      returns nothing, and `user_xp` (db/schema/game.ts:39) stores ONE running
      total per user with `level` derived on read. So a real per-workout XP
      display is a MIGRATION plus a sync-time write, not a client change — and
      it is the SAME gap PostWorkout carries (`PostWorkout.jsx:40`: "`xp_earned`
      STAYS on the old summary payload, because the new API has no [per-workout
      XP]"). One backend card would close both surfaces; neither can be closed
      from the web side.
- [x] 🔴 **Google login — DONE, SMOKE PASSED (Kd, 2026-07-24).** End-to-end
      browser click-through on the local stack succeeded: `/login` → "Continue
      with Google" → Google account chooser → callback → logged in. All three
      closing conditions met (master merged into `web-repoint` @ 57526aa; Google
      OAuth credentials created + redirect URI `http://localhost:3000/v1/auth/
      google/callback`; smoke passed). The un-tick (web-half T3, 2026-07-24) held
      exactly until the feature actually worked — the DPDP Day-14 precedent.
      API half merged to master 2026-07-24 (PR #48): `GET /v1/auth/google` +
      `/callback` set httpOnly-cookie sessions (no token in URL/localStorage),
      3-way upsert, email-verified via consumed token, CSRF state, per-IP limit;
      fresh-chat T3 (2 blocking + 2 low, all fixed + mutation-verified). Web half
      done on `web-repoint` (this branch): Login/Register buttons un-gated and
      pointing at `${VITE_API_URL}/v1/auth/google`; `/auth/google/success` route
      restored (bare route); Login toasts the callback's `?error=`;
      `GoogleAuthSuccess.jsx` REWRITTEN — the `#token`/localStorage/raw-`setUser`
      flow is GONE, it reads the cookie session AuthProvider restored (getMe →
      adoptSession) and routes via the pure `googleSuccessRoute` (unit-tested);
      `setUser` no longer exported from AuthContext.
      **CLOSES WHEN:** (1) master merged into `web-repoint` so the endpoint the
      buttons target exists ON THIS BRANCH (web-repoint trails master by 11 — the
      API is real, just not integrated here yet; without the merge the buttons
      404 in local dev/smoke), AND (2) Kd creates the Google OAuth credentials +
      sets the API's `WEB_ORIGIN` to the web origin, AND (3) the browser
      click-through passes. (v1 §6.1:438; DECISIONS 2026-07-15 Cards 1–2,
      2026-07-24 google-login.)
- [ ] 🔴 **Avatar / profile-picture storage.** No `profilePicture` field exists
      in the shared schema or the users DDL (command-verified), so this is the
      one Settings surface still on legacy mlApi. **Scope MUST include the R3.9
      security the current path lacks** — it base64-inlines a 2 MB image into a
      JSON PATCH; R3.9 requires magic-byte content-type validation (not
      extension), a size cap, R2 storage under SERVER-generated keys, and
      signed-URL/CDN delivery. Do NOT inherit the current shape at cutover.
      (DECISIONS 2026-07-20, Card 7.)
- [x] 🔴 **Coach chat retry protection — API half DONE, merged 2026-07-22 as
      PR #43** (merge commit `facc804`; five fresh-chat T3 rounds).
      `/v1/coach/chat` had no per-route rate limit and accepted no
      Idempotency-Key, so a client retry opened a second thread, spent a second
      quota slot, and duplicated the messages. The API half now takes an
      optional `Idempotency-Key` and carries a 10-message/minute per-user cap,
      both placed BEFORE `requireQuota` (which increments the counter itself).
      (DECISIONS 2026-07-12 P2.5b T3; Kd D1(b)
      2026-07-16; design + Kd-approved numbers, DECISIONS 2026-07-21 on that
      branch.) **The two open lines below are what it does NOT close.**
- [x] 🔴 **Coach "Try again" control — the client half — DONE 2026-07-22.**
      Built as described below: the key is minted ONCE per composed message and
      stored with it, so "Try again" resends an IDENTICAL body under the SAME
      key; the input box is deliberately not restored (the button is the retry
      path). The 429 fold-in below is delivered too — the catch now branches on
      `err.response?.data?.error`, so the burst cap says "you're sending
      messages too quickly" and only a real `quota_exceeded` mentions upgrading.
      An unrecognised 429 also falls back to the "too quickly" copy: the global
      @fastify/rate-limit throws an untyped error, so its 429 reaches the client
      as `{error:"request_error"}` (verified) and must never produce the upgrade
      copy. `quota_exceeded`, `not_found` and `validation_error` offer NO retry
      button (it could not help); the two key-errors retry with a FRESH key
      (the same one would 400 for the full window). Fresh-chat T3: its BLOCKING
      finding was that the button was addressed per-message while the send
      writes to the TAIL, so a stale button resent the right key into the wrong
      bubble and overwrote a newer reply — closed at BOTH layers (offers
      withdrawn on compose; the button cannot render off-tail) and pinned by
      unit tests. Live-driven before handover: replay returned a byte-identical
      body with `idempotent-replay: true`, a same-key/different-message request
      returned 400 `idempotency_key_mismatch`, and one thread existed after
      three requests.
      **What was owed, kept for the record:** `Coach.jsx` cleared the message
      box on send and never restored it, and there was NO retry affordance — so
      a key minted inside `sendMessage` would have differed on every attempt and
      deduped nothing, and the user's only route back was retyping, which the
      server sees as a new message. (An earlier version of this line called the
      client half "one header line"; that was wrong and was corrected on
      2026-07-21.) The FOLD-IN was that every 429 mapped to the quota copy, so a
      free user with four questions left who sent quickly was told to UPGRADE.
      **SMOKE — PASSED (Kd, 2026-07-22), all three steps**, which also closes
      the API half's owed smoke (per CLAUDE.md Part I §2 none of its three new
      client-visible responses was browser-reachable until this landed):
      (1) request blocked in devtools → error with a **Try again** button →
      unblocked → click → real answer, ONE conversation in the sidebar;
      (2) the T3 V1 case — fail one message, then send a different one that
      succeeds → the stale button is gone and the newer answer is NOT
      overwritten; (3) ~11 rapid sends → the burst-cap message says "sending
      too quickly", not the upgrade copy.
- [ ] 🟡 **Empty conversation left behind by a failed coach message.**
      PRE-EXISTING, found 2026-07-21 while verifying the card above, not
      introduced by it. `repo.createThread` commits on its own BEFORE the
      provider is called and messages are appended only on success, so a
      message that fails after that point leaves an empty thread in the sidebar
      **even if the user never retries**. Scope, verified: only for the FIRST
      message of a new conversation, and never when the coach is unconfigured
      (that 503 precedes creation). The retry path now RESUMES such a thread, so
      only the never-retried case remains. Proper fix = create the thread in the
      same transaction as the exchange, which touches the `api_cost_events`
      ledger transaction (DECISIONS 2026-07-12 T3 finding 3) — its own card, not
      a drive-by.
- [ ] 🟡❓ **A coach question is spent even when the provider never answers —
      needs a Kd ruling.** `requireQuota` increments BEFORE the handler runs
      (the ported quotas.py doctrine, "a request that fails later still
      consumed a slot"), so a Groq failure costs a free user one of their five
      monthly questions and returns nothing; a retry spends another, because it
      does real work. **Newly REACHABLE rather than theoretical:** Groq's free
      tier allows 6,000 tokens/minute and a real coach call measures ~2,573
      tokens (from this project's own `api_cost_events` rows), i.e. about two
      questions a minute before Groq refuses. Refunding the slot when no answer
      was produced is a small, contained change to the coach route's failure
      path — but it changes ported behaviour, so it is Kd's call, not a chat's.
      (DECISIONS 2026-07-21.)

### Legal / operational gates
- [ ] 🔴 **DPDP Day-14 HARD-DELETE — CODE COMPLETE 2026-07-22, BUT NOT YET
      RUNNING ANYWHERE, so it is NOT done** (branch `dpdp-day14-purge`).
      This line was first written ticked; its T3 (finding D1) proved that
      wrong and it is UNTICKED. A correct sweep that is scheduled nowhere
      deletes nothing, and "a deleted user's data actually goes" is the whole
      obligation. Command-verified 2026-07-22: **no Dockerfile exists in the
      repo**, `docker-compose.yml` defines only mongo/redis/mongo-express (no
      api, no worker), `ci.yml` has no deploy job, and nothing in RUNBOOK says
      where `pnpm worker` runs. **What closes it:** the deploy path runs the
      worker (or a cron runs `tools/dpdp-purge.ts --apply`), and the entry
      names where. The code below is real, T3'd and proven — the deployment
      is what is missing. §5.2 ANONYMIZES the users row rather than deleting
      it, so NO FK cascade collects user-owned PII; §5.2's explicit Day-14
      DELETE list is the only mechanism, and it now exists as
      `apps/api/src/modules/privacy`. 17 tables end empty per purged user — 15
      deleted directly, `meal_log_corrections` and `coach_messages` collected by
      CASCADE from their parents (they carry NO `user_id`, which the approved
      plan had assumed they did — caught by verification before any code).
      `user_fitness_profiles` IS included, so the condition on which
      onboarding-storage was merged (2026-07-16) is discharged for this half.
      Runs on BullMQ (**now installed**, 5.80.10) from a new `worker`
      entrypoint per v1 §6, plus `tools/dpdp-purge.ts` which is **dry by
      default** and needs `--apply` to destroy anything.
      **The build note is honoured and was bigger than it looked:** the
      retention window is ONE constant (`apps/api/src/retention.ts`), and there
      turned out to be FOUR hard-coded 14s, not one — two of them the
      user-facing strings on `DELETE /v1/users/me`. Had only the code read the
      constant, widening to GDPR's 30 would have left the API telling users
      "you have 14 days" while purging at 30.
      **PARTIAL PROGRESS 2026-07-24 (deploy-infra card) — STILL UNTICKED, and
      deliberately so.** Three of the four command-verified absences above are
      now closed: `infra/Dockerfile` exists (one image, two modes, v1 §6),
      `infra/docker-compose.yml` defines a `worker` service running
      `src/worker.ts`, and `infra/README.md` NAMES where the purge runs — the
      worker service on the Hetzner VPS, `dpdp.purge` on the `rollups` queue at
      03:00 UTC. What remains is the part that actually deletes data: **no host
      is provisioned and nothing is running**, and `ci.yml` still has no deploy
      job. An image proven on a laptop is not a scheduled sweep. This line ticks
      when the compose runs on a real host — the same standard that unticked it
      after T3 finding D1, applied to the card that built the image rather than
      relaxed for it.
- [x] 🔴 **CI runs none of the database tests — including the purge suite.**
      Found by the DPDP T3 (finding D2) and MEASURED both ways: the gate job
      runs `pnpm test` with NO `DATABASE_URL`, giving **151 passed / 173
      skipped**, while the same suite with a `DATABASE_URL` gives **324
      passed**. The Neon-branch job only runs `drizzle-kit migrate`. So every
      DB-gated suite this project has built — auth, workouts, nutrition,
      coach, the Mongo migration, and now the Day-14 purge — is green on merge
      without ever executing. **Pre-existing infrastructure, not broken by any
      one card**, but the purge is what makes it serious: the only code in the
      repo that irreversibly destroys user data has zero enforced coverage.
      Fix is to give the test job a Neon branch (the migrations job already
      creates one, so the mechanism exists). Its own card — R1.1.
      **DONE 2026-07-23 — PR #47, branch `ci-db-tests`.** The proposed fix
      ("give the test job a Neon branch") was TRIED (commit 34aa7c0) and MEASURED
      too slow: every test PASSED but the full suite took ~38 min against remote
      Neon from a GH runner (uniform latency, not a hang), overrunning a 30-min
      cap. Kd ruled to SPLIT instead: `migrations` keeps proving DDL on a real
      Neon branch; a NEW `db-tests` job runs migrate + seed + `pnpm --filter api
      test` against a pgvector/pgvector:pg16 SERVICE CONTAINER on the runner
      (~2 min, no paid Neon compute per PR, DB clean by construction). PROVE both
      ways: `api tests on local Postgres` green 341/341, 0 skipped; a
      deliberately-broken purge assertion turned that check RED while the DB-free
      gate stayed green, then reverted. See DECISIONS 2026-07-23 "CI runs the
      database-backed api suites".
- [ ] ⚪ **Assert the DB suites POSITIVELY executed (count floor / fail-if-skipped).**
      T3 defense-in-depth on the CI db-tests card (2026-07-23). No silent-skip
      path exists TODAY — `DATABASE_URL` is one job-level value shared by
      migrate/seed/test, and a bad URL fails `drizzle-kit migrate` loudly before
      the test step, so a green-with-0-DB-tests run is unreachable. But nothing
      POSITIVELY asserts a non-zero executed count, so a future refactor that
      split the env or changed the `skipIf` var could skip the suites while
      migrate/seed still pass → false green. Add a guard that fails the db-tests
      job if skipped>0 / passed<floor (a verified vitest-JSON read, not a brittle
      grep). NOT built with the card: an unverified CI guard risks a false-red,
      worse than the low residual. R1.1 — its own small card.
- [ ] 🟡 **The DPDP purge's single-marker guarantee rests on ONE call site.**
      Raised by the round-5 T3 (2026-07-23) as latent, not a live bug —
      recorded so it is not lost. `lockDueUserForPurge` was widened from
      `TransactionSql` to `SqlOrTx` purely so the concurrency test could drive
      it on two explicitly-ordered reserved connections. That removed the
      COMPILE-TIME guard: a pooled `Sql` now satisfies the parameter, and on a
      pooled handle `FOR UPDATE` autocommits and drops the row lock instantly —
      silently reverting to the double-marker race this card fixed across four
      rounds. There is no DB backstop either: `audit_log` has only
      `(gym_id, at)` btree + a BRIN on `at`, **no unique index on
      `(action, target_id)`**, so a duplicate marker raises no 23505. Verified
      today: the sole production caller (`purgeUser` → `deps.sql.begin`) does
      pass a real transaction, so nothing is broken now. Two real closures,
      either of which ends the reliance: (a) revert the signature to
      `TransactionSql` and rework the test, or (b) add a partial unique index —
      **but NOT a naive one on `(action, target_id)`**, which would break the
      legitimate re-deletion case the `at >= deleted_at` bound exists to allow
      (a user deletes, restores, and deletes again). Pairs naturally with the
      CI line above, since neither is enforced on merge today.
- [x] 🔴 **DPDP JSON export — DONE 2026-07-23, merged as PR #46** (merge
      `5c76d6c`). `GET /v1/users/me/export` returns the user's data as JSON:
      17 tables + profile, DERIVED from the Day-14 delete list so the two §5.2
      rights cannot drift apart. Kd-ruled DEVIATION on delivery only — §5.2
      describes a zip behind a signed URL; none of that infrastructure exists
      and v1 §18 itself says "data-export endpoint", so the content is
      identical and adding signed-URL delivery later changes only how it is
      sent. Three fresh-chat T3 rounds (10+6+4). Notable: the rate limit
      shipped with an IP dimension that refused a second gym member's FIRST
      export (and cited a precedent saying the opposite); internal columns
      rode along on SELECT * (our per-request AI cost on every coach message,
      and the anti-cheat flags the spec calls silent); and an untyped lookup
      let a typo ship them, found three times one level down each round —
      now guarded against the real drizzle schema by a test needing NO
      database, so CI actually runs it. **STILL OPEN, its own line below:**
      whether `gym_members` and `leaderboard_snapshots` belong in the export.
      ~~the OTHER half of §5.2, still owed and still blocks P2.8~~ Split from the delete half by Kd ruling 2026-07-22
      because NONE of its infrastructure exists — command-verified: no R2/S3
      client in any `package.json`, no bucket or signing keys among
      `config.ts`'s 17 env vars, no zip library, and no Part 4 table to track an
      export job. It therefore needs new credentials plus ≥2 new dependencies,
      which would have blown the 🔴 one-thing-per-chat ceiling and delayed the
      legally load-bearing half. §5.2 wants "a JSON zip of every user-owned
      table above + profile, delivered via signed URL, 7-day expiry".
      **A DEVIATION PROPOSAL is on file for that card:** serve it as an
      authenticated `GET /v1/users/me/export` returning JSON directly — no zip,
      no R2, no signed URL — which satisfies §5.2's "both flows exist at launch"
      with zero new infrastructure and keeps the export a table LIST, so adding
      signed-URL delivery later changes delivery only, never content. Kd rules
      on that at the card.
- [ ] 🔴 **Drain offline sync queues before cutover.** Per-user localStorage
      buckets are keyed `user_<id>_*`; pre-cutover that id is the old Mongo
      ObjectId, after it the new UUID, so unflushed workouts orphan. Non-issue
      on greenfield prod (empty DB) — matters only for a data-carrying cutover.
      (DECISIONS 2026-07-15.)
- [ ] 🔴 New API deployed and healthy (`/health`), `data_backend` flag seeded.
      The IMAGE and compose now exist (`infra/`, 2026-07-24) and are proven on a
      local Docker stack; no host is provisioned, so nothing is deployed and this
      stays open. Provisioning starts the ~₹700–1,200/mo spend Kd already accepted
      at the P0.4b ruling (DECISIONS 2026-07-07) — it is a decision to execute,
      not a decision still to make.
- [ ] 🔴 Secrets in the deploy platform (escrow doc, Part 8 §1) — never in repo.
      `infra/README.md` lists the four hard-required variables (`DATABASE_URL`,
      `WEB_ORIGIN`, `JWT_SECRET`, plus `REDIS_URL` in production) and the file
      they belong in on the host (`infra/api.env`, gitignored + dockerignored).
      The escrow doc itself is still owed, as are the two rotations above.
- [ ] 🔴 Backup/restore drill actually performed and logged (Part 8).
- [ ] ⚪ **CI does not build or push the API image, and nothing auto-deploys.**
      Deferred by the 2026-07-24 deploy-infra card rather than half-built: v1 §19's
      pipeline ends "build images → migrate → deploy staging → manual promote",
      but there is no registry and no host to push to yet, so a build-and-push job
      would be ceremony that proves nothing. Its own card once a host exists.
- [ ] ⚪ **The image runs TypeScript through `tsx` rather than a compiled `dist/`.**
      Kd-approved at the deploy-infra plan gate as option A. No package the image
      needs has a build script (`apps/api`, `@app/shared` and `@app/engine` all
      run from source; only `apps/web` has one, `vite build`), so compiling means
      adding build scripts to three packages and repointing their `main`/`exports`
      — which changes module resolution for typecheck and test everywhere, past
      the Part I §7b one-thing-per-chat ceiling. Cost today: a boot-time transpile
      and a larger image. Worth revisiting if boot time or image size ever bites.

## 🟡 Needed before real users, not before cutover

- [x] 🟡 **Timezone capture** — DONE 2026-07-21 (the second audit miss, owed
      since 2026-07-11). The web now reports the browser's IANA zone on session
      adoption, so `users.timezone` is real and day-bucketing stops falling back
      to UTC — streaks had been rolling over at the wrong local hour for every
      user outside UTC (05:30 IST, in a Jorhat pilot). Pure web card: the PATCH
      has accepted `timezone` since P2.2. Writes only on a real change;
      best-effort; the client reports its zone and never computes a day
      boundary. Kd's smoke caught a duplicate write on first login (login and
      session-restore both firing) — guarded. SMOKE passed, and the stored
      value was verified written BY THE BROWSER on an untouched account.
- [ ] 🟡 **Timezone TRAVEL rule (§3.5) — still owed, deliberately NOT absorbed
      by the capture card.** "A day is kept if it qualifies in either the
      stored-at-the-time TZ or the new one" is not implemented: streak replay
      uses only the CURRENT `users.timezone`, so a user who moves between zones
      can lose a day that legitimately qualified under their old one. This was
      shielded while every user was UTC; capturing real zones makes it
      reachable, which is why it is now its own line rather than a footnote.
      (DECISIONS 2026-07-11 P2.3 T3 note.)
- [x] 🟡 **`limitedToDays` surfaced in the Progress UI** — DONE 2026-07-21.
      Every `/v1/progress` read returns the plan-clamp field and the page
      ignored it entirely, so a free-plan user saw "1 Year" over 90 days of
      data. Now: a notice under the period buttons, and the caption corrected
      to the window actually shown. **The clamp is compared against the
      REQUESTED window, never rendered on `limitedToDays !== null`** — the
      server reports it unconditionally (7d also returns 90), so the naive
      check would warn about a limit that is not limiting.
      Its fresh-chat T3 caught that the notice closed only HALF of f.4: the
      heatmap and personal-records endpoints take NO period and are gated
      anyway, so their own headings still lied at the three periods where the
      notice correctly stays quiet. Both now caption from their own window
      (`heatmapCaption` / `recordsNote`), with `longestStreak` carved out
      because it is deliberately ungated. Copy states the history is SAVED —
      it is a read gate, not deletion. SMOKE passed.
      (T3 Card 3 f.4, owed 2026-07-16 → closed by the Progress-clamp card.)
- [ ] 🟡 **Real-phone mobile-web camera smoke.** The claim "the file input opens
      the camera on phones" is UNVERIFIED (V1) — every smoke to date ran on
      Kd's desktop. The desktop-webcam ruling makes mobile web the PRIMARY
      meal-capture path, so this needs one real-device run: `vite dev --host`,
      `VITE_API_URL` + API `WEB_ORIGIN` on the LAN address (a phone resolves
      `localhost` to itself; CORS is exact-origin + credentials — the Card-4
      lesson). Also settles the recorded `capture`-vs-photo-library trade-off
      (options A/B/C, DECISIONS 2026-07-19; recommendation was "A now, C later
      only if the phone smoke shows the gallery limitation bites").
      (DECISIONS 2026-07-19.)

## ⚪ Improvements and residuals

- [ ] ⚪ **`db.migration.test.ts`'s "0009 workout_sets CHECKs bite at the DB" is
      79 ms inside vitest's default timeout — it will keep flaking.** Recorded
      2026-08-01 (DECISIONS :3538) by the catalog card, which is NOT its cause:
      that test never calls the seed and does its own inserts. **Measured, not
      guessed:** it FAILED one full-suite run ("Test timed out in 5000ms"),
      PASSED the very next with nothing changed, and passes at
      `--testTimeout=45000` taking **5079 ms** — 1.6% over the 5000 ms default.
      It is ~15 sequential round-trips to a Neon branch, so any latency bump
      tips it. Fix is one argument (the file already uses `120_000` and
      `30_000` elsewhere), left untouched under R1.1 because it belongs to the
      log-only card. Whoever next edits that file should give this test its
      budget — a test that fails on network weather teaches the suite to be
      ignored.
- [ ] 🟡 **T3 round 8's four non-blocking findings (2026-07-28).** Given lines
      here in the same commit that deferred them, per the deferral rule — they
      were reported by a review that named them explicitly, which is exactly how
      items get lost when only prose records them. Full text at
      `t3-xp-web-r8-FINDINGS.md` §(3).
      1. `Achievements.jsx:737` `key={entry.name ?? i}` — `readLeaderboardEntry`
         DISCARDS the payload's `user_id` (which the file's own fixture carries
         at line 411), forcing name-as-key. Two athletes with the same display
         name collide and React reuses the wrong row. Fix is to keep `user_id`
         in the reader and key on it; the reason it is not in Round A/B is that
         it changes a reader's shape, which is its own small card.
      2. `Achievements.jsx:268` `podiumColors[entry.rank]` — `rank` is
         `finite()`, so 0 or a negative passes `isPodium` and yields a Crown
         with `color: undefined`. Cosmetic.
      3. `Dashboard.jsx:733` `{!loading && (CTA)}` — the STATIC "Ready to
         start?" call-to-action borrows the stats read's knowability, so a hung
         `getStats` hides it forever. Round 7 F8's shape, one site over. Note
         this is the same three-states-never-two family as F3 and is worth
         folding into whichever round touches `Dashboard.jsx` last.
         **RAISED at Round A's plan gate (2026-07-29) as a labelled
         RECOMMENDATION, since Round A WAS the last round touching that file —
         Round B touches only `Sidebar.jsx` and the two test files. Kd approved
         the plan as written, so it was not folded in and there is now no
         scheduled round that will pass this file.** It needs a card of its own.
- [ ] 🔴 **A long-time user's OLD MONTHS GO BLANK on the calendar, and the page-
      walk is why. `/v1/workouts` needs a date filter.** Raised by Kd on
      2026-08-04, in response to this chat calling the truncated state
      "unreachable" — **which was wrong, and the correction is the point of this
      line.** 1,000 workouts is four sessions a week for five years. Real users
      reach it; the app is being built for a lot of them.
      **WHAT THEY SEE.** `/v1/workouts` is a keyset cursor list with NO date
      filter, so `fetchMonth` assembles a month by paging BACKWARDS from today,
      capped at `HISTORY_MAX_PAGES` × `HISTORY_PAGE_LIMIT` = 10 × 100 = 1,000
      rows (`apps/web/src/api/workoutHistory.js`). Browse to a month with 1,000
      workouts logged since, and the walk never reaches it: `truncated` comes
      back true and the grid is EMPTY. The T3 round-2 fixes make that state stop
      LYING (it no longer prints a bold "0 active days this month", and the
      caption is now true) — **they do not make the month readable, and this line
      exists so that is not mistaken for done.**
      **THE FIX IS ON THE API, not the client.** A month filter on
      `/v1/workouts` (or a dedicated month/range read) returns the month in one
      request at any history size: no cap, no walk, no truncation caption, and
      the ten requests per month view collapse to one. The client's page-walk was
      always a stand-in for a filter the endpoint does not have — the Card-5d
      precedent it cites (`listMealsForDay`, DECISIONS 2026-07-19) made the same
      trade under the same constraint, so **the same question should be asked of
      that reader when this is built.**
      **Not a regression and not this card's defect** — the cap predates it and
      the old backend answered `?month=&year=` server-side, which is exactly the
      surface the repoint lost. Needs its own card (API half, then the client
      simplification); size it against the P2.8 order at DECISIONS :2866.
- [ ] ⚪ **The timezone-pin guard asserts only that the offset is NOT ZERO, so a
      DST zone would satisfy it.** Raised by the calendar's T3 round 2
      (2026-08-04, DECISIONS :4355) while auditing round 1's own fix, and
      reported rather than patched — the fix is not free, since naming the zone
      in the assertion duplicates the value the config already owns, and a
      duplicated constant is its own drift risk.
      `apps/web/vitest.config.js` pins `TZ=Asia/Kolkata` because under UTC the
      local day and the UTC day are identical by definition, so no fixture can
      tell a correct day-bucketing from the UTC-day defect (round 1's F2, which
      was inert on the CI runner). The config's stated reason for THAT zone is
      that it is the product's own market AND has no DST — a date fixture cannot
      drift twice a year. The guard at `workoutHistory.test.js:112` checks
      `getTimezoneOffset() !== 0`, which a DST zone passes. So the pin can be
      edited to, say, `Europe/London` and every date test keeps passing while the
      no-DST half of the rationale silently stops holding, and two fixtures a year
      start landing on the wrong day. **Not visible and not urgent: nothing on
      screen is wrong today, and the pin is not something a card routinely
      touches.** Closing it means asserting the property the rationale actually
      depends on — that January and July offsets agree — which is one line and
      names no zone.
- [ ] 🟡 **The calendar's stand-in for `safeParse` catches renamed fields but NOT
      changed UNITS — and a changed unit is what actually bit.** Raised inside
      the calendar T3 round 1's security pass (2026-08-04) as an observation
      rather than a numbered finding, and given a line because an observation
      with no tracker is how this exact thing gets lost.
      `readCalendarSession` deliberately reads per field instead of running
      `workoutListItemSchema.safeParse`, and the documented reason is sound: a
      strict parse would DROP a row the calendar could draw perfectly, over a
      field the screen never shows. The substitute is a contract-drift test that
      feeds a schema-valid row through the reader and fails if a field NAME
      moves. **That substitute is narrower than the R2.3 rule it replaces**: a
      field whose unit, scale or range changes keeps its name and sails through.
      **Not hypothetical — it is this card's own duration defect exactly.**
      `durationMs` kept its name while the payload changed from the old
      backend's whole minutes; the drift test was green throughout, and the
      screen printed a 9-second workout as "0m" until Kd's browser caught it.
      Closing it means asserting the SHAPE of values, not just the presence of
      keys — a unit fixture per numeric field (1000 ms ⇒ 1 s; a 0-100 form
      score; integer kcal), or a narrowed parse that validates only the fields
      this screen reads and keeps the drop-nothing property. Belongs with
      whichever card next revisits the reader, and the same question should be
      asked of every other per-field reader on the repoint (`readSummaryView`,
      `readOverviewView`, `readStatsView`, `readLeaderboardView`).
- [ ] 🟡 **Calories are shown as a flat number where the spec requires a RANGE.**
      Raised by the calendar's T3 round 1 (F3, NOT-VISIBLE) on 2026-08-04 and
      given a line the same day — it was tracked NOWHERE, which is the exact
      shape the deferral rule exists to stop, and it had survived every card
      that ever rendered a kcal figure.
      **Verified this session, not taken on the reviewer's word:**
      `docs/spec/02-part2b-trust-layer.md:148-152` — "**Range = point estimate
      ± 20%**, both ends rounded to the nearest 5 kcal; e.g. computed 212.4 →
      **'≈ 170–255 kcal.'** … constant, `CALORIE_BAND = 0.20`, versioned under
      `calc_version`" — and the §2.3 display table at :475 marks the session
      calories row "range ±20% / nearest 5 kcal / **always**".
      `grep -in "banding|CALORIE_BAND|calorie range" OWED.md` returned nothing
      before this line.
      **Why it is a trust requirement and not polish:** the number is an
      estimate derived from MET × body weight × time, and the spec's whole
      Trust-Layer argument is that a point value presented as fact overstates
      what the app knows. Same family as this project's em-dash rule, one step
      further on: `210` claims a precision the calculation does not have.
      **Not the calendar's to fix (R1.1)** — it is the display rule for EVERY
      surface reading a kcal point value from the new API. Both shared contracts
      already say so and are the pointer to the work:
      `packages/shared/src/workouts.ts:23` ("2B §2.3: display banding is the
      client's job") and `packages/shared/src/progress.ts:15`. One shared
      formatter, `CALORIE_BAND = 0.20` quoted from the spec and never
      re-derived, plus the "estimated" label — then every consumer switched to
      it, the one-ladder rule (a second spelling is how two screens come to
      disagree about one number).
- [ ] 🟡 **Exercise names in the workout calendar are TITLE-CASED SLUGS.**
      Created 2026-08-01 by the calendar repoint (DECISIONS :2912) in the same
      commit that deferred it. The old `/workouts/history` projected up to five
      exercise NAMES per session (`workouts.py:388-393`) — a live feature, so the
      no-removal rule was engaged and the chips stayed. But the new API carries
      only `sets[].exerciseSlug` (`workoutDetailSchema`), so `exerciseLabel`
      renders `barbell_squat` as `Barbell Squat`. That is a label DERIVED from
      the value, not a name invented for it — the identifier is unchanged, only
      its punctuation — which is why it shipped rather than a guessed name.
      **Closes with the exercise-library content card** (already 🔴 above: display
      names, instructions, media, server-side search), which is the thing that
      gives a slug a real name and its hi/as translations. Until then the chips
      read machine-ish, and the smoke doc says so at step 2 rather than letting
      Kd report it as a defect.
- [ ] 🟡 **`WorkoutCalendar.jsx` keeps the pre-existing
      `react-hooks/set-state-in-effect` error.** Measured both ways 2026-08-01,
      not ticked: the file at HEAD produces **2** eslint errors (an unused
      `Dumbbell` import + this one); after the repoint it produces **1** — the
      unused import is gone, and this one was PRESERVED rather than restructured,
      under R1.1 (it predates the card and fixing it changes the loading
      semantics the new tests pin). Parity improved, so it blocked nothing; it is
      listed because "same as baseline" is a claim that decays into "clean" if
      nobody writes the number down. Whoever next restructures that effect should
      close it.
- [ ] 🟡 **`Running.jsx:97-100` carries BOTH of Round A's defect classes, in a
      SAFETY signal.** Found 2026-07-29 while enumerating F5's class across the
      XP card's ten files; outside those files, so reported under R1.1 and
      deferred rather than fixed — and given a line here so it is not lost the
      way Google login and timezone capture were.
      Verified by reading the file this session:
      1. `colors[weather.risk] || '#FFD66B'` — `#FFD66B` is the **low**-risk
         colour, so an unrecognised risk is painted as a definite LOW risk.
         That is round 8 F5's fabrication (unknown rendered as a definite
         value), except the claim here understates a weather hazard to a runner
         rather than mis-colouring a badge. Line 96 already special-cases
         `risk === 'unknown'` and `'none'`, so the backend HAS a declared
         unknown — the gap is every other unrecognised string.
      2. It is also round 8 F4's shape: an object indexed by external text with
         no own-property guard, so `risk: 'toString'` resolves to
         `Object.prototype.toString` — truthy, so the `||` fallback never fires
         and the colour is invalid. Not a crash here (unlike Achievements),
         because nothing is called on the result.
      **`apps/web/src/api/runningApi.js` declares ZERO readers** (grep-verified,
      `^export function read` → 0) and never mentions `weather` or `risk`, so
      this payload reaches the render completely unparsed — the same
      external-input-rendered-raw condition that produced rounds 1-7's entire
      finding sequence on the XP card. The running feature has not had that
      pass yet.
- [ ] 🟡 **R3.6's pre-commit gitleaks HAS NEVER EXISTED, and a feature-branch
      push is scanned by nothing.** CLAUDE.md R3.6 states "Gitleaks runs in CI
      and pre-commit". Verified 2026-07-28: there is no `.husky`, no
      `.git/hooks/pre-commit`, and `gitleaks` is not on PATH — so the pre-commit
      half is a rule the repo asserts and does not implement. The CI half is real
      but narrower than it reads: `.github/workflows/ci.yml` triggers on
      `pull_request` and `push: branches: [master]` ONLY. Found while pushing
      `web-repoint` (31 commits) as a backup — the push went out with a
      hand-written pattern scan standing in for gitleaks, which is weaker and was
      stated as such rather than ticked.
      **CORRECTED 2026-07-31: "so pushing a feature branch runs NO scan at all"
      was FALSE as written, and the correction narrows this item.** A push to a
      branch with an OPEN PR fires the `pull_request` event (`synchronize`), and
      `ci.yml` has no draft filter (grep-verified) — so `web-repoint` has been
      scanned on every push since PR #29 was opened, and its checks read "All
      checks have passed — 5 successful checks" on `a9a9d17`, gitleaks included.
      The claim holds ONLY for a branch with NO open PR. It was written on
      2026-07-28 about the very branch that did have one. Corrected in the same
      session a chat repeated the error one level worse — asserting that 112
      commits "have never been through CI" while an open PR had been gating them
      the whole time. Both errors share a cause: reading the trigger list and not
      checking what was actually running.
      **This matters here more than in most repos: three secrets have already
      burned** (Groq key, Neon password, Google client secret — all three above
      on this list), and two of those reached a chat transcript rather than git,
      which is the failure mode a pre-commit hook does NOT catch either. Fix is
      either (a) install gitleaks + a pre-commit hook so the rule becomes true,
      or (b) amend R3.6 to describe what actually runs. Do NOT leave the sentence
      standing as-is: a protection everyone believes in and nobody installed is
      worse than a known gap.
- [ ] 🟡 **`apps/web/src/sync/syncClient.test.js` fails locally, passes in CI.**
      `ReferenceError: window is not defined`. Cause VERIFIED by T3 round 8:
      `apps/web/.env` sets `VITE_API_URL`, vitest loads it, so the test's premise
      ("in this node test env `VITE_API_URL` is unset") is false on a dev machine
      with a populated `.env`. Not a product defect — but it makes EVERY local
      PROVE run report "1 failed", which is how a real regression gets waved
      through as "that's just the known one". It has been described as "the
      pre-existing syncClient env quirk" in five handoff blocks without anyone
      naming the cause until now.
- [ ] 🟡 **`apps/web` is excluded from the lint gate and the DoD box says
      "lint clean" anyway.** Root lint is `turbo run lint --filter=!web`, and
      `pnpm --filter web lint` fails with 67 errors package-wide. So every web
      card has ticked "lint clean" truthfully-by-exclusion while the package it
      changed was never linted. Found by T3 round 8, which also confirmed the 2
      errors in this card's own files (`Sidebar.jsx:8` unused `Zap`,
      `Achievements.jsx:5` unused `ChevronRight`) are pre-existing on master and
      correctly untouched per R1.1. Either lint web and fix the 67, or change the
      DoD wording so the box stops asserting something nobody checked.
- [ ] ⚪ **Two PostWorkout behaviours are render-test-proven but BROWSER-unreachable.**
      T3 round 3 F7 (2026-07-30). No rig state has `duration_minutes` present with
      `active_seconds` absent (the minutes-fallback arm, where "NaNh NaNm total"
      lived), and none has unreadable list ELEMENTS — so two behaviours rounds 2
      and 3 wrote fixtures for cannot be seen in a browser. Round 2 F4 established
      that a jsdom-only path should be made rig-reachable and then did it for one
      of the three paths it created. Fix is a `minutesOnly` and a `badElements`
      state in `apps/web/tools/mock-ml-backend.mjs` plus smoke steps — deferred
      because it only pays off with a RE-RUN smoke, which is Kd's call, not a
      chat's.
- [ ] ⚪ **The mutation harness is not run by CI, so its table decays.**
      `apps/web/tools/mutate-postworkout-summary.sh` is a point-in-time
      measurement: it was green at `HEAD` on 2026-07-30 and nothing re-checks it
      when the files it mutates change. Raised by T3 round 3 as the general form of
      its own F1 — the same reasoning that says "prove a test RAN" says "prove the
      table is still true". Recorded rather than wired into CI, because the sed
      anchors are literal source strings and a CI job that goes red on an innocent
      refactor teaches people to ignore it. Its header says so; revisit if a second
      harness ever appears.
- [ ] ⚪❓ **Should `readSummaryView` DROP unreadable list elements rather than
      preserve them as null? — needs a Kd ruling.** Raised by T3 round 2 (F5),
      2026-07-30. Today an all-unreadable `personal_records` renders N trophy rows
      of "—" at both surfaces: not a fabricated VALUE, but a fabricated COUNT.
      Preserving is strictly better than the pre-card code (which threw), and
      dropping would silently remove rows the payload did claim exist — which is
      why a chat must not choose. A render fixture pins today's behaviour, so
      whichever way it is ruled the change is one assertion.
- [ ] ⚪ **`secondsLabel` carries to "1m 60s" on fractional input.**
      `Math.round(totalSeconds % 60)` rounds 59.6 to 60 instead of carrying into
      the minute. Found by T3 round 2 and verified a FAITHFUL port of the
      `formatSeconds` deleted at `dd07856`, so it predates this card (R1.1,
      reported not fixed). Reachable only if the old backend sends fractional
      seconds.
- [ ] ⚪ **`ShareCard` stamps today's date, not the workout's.** It renders
      `new Date()`, so a PNG exported the day after a workout dates it wrong.
      Pre-existing; `completed_at` is deliberately outside the reader's nine
      rendered fields, so closing this adds a field as well as a line. Found by T3
      round 2 (R1.1, reported not fixed).
- [ ] ⚪ **PostWorkout prints calories unrounded while its share card rounds
      them.** One workout can read `280.4 kcal` on screen and `280 kcal` in the
      downloadable PNG — two surfaces, one number. Pre-existing (the page never
      rounded, the card always did); found while writing the summary reader
      2026-07-30 and Kd chose **report only** at that card's gate, since rounding
      the page would be an unrequested display change to a real value. Both sites
      ARE now honest about an ABSENT value ("— kcal"). Close it by picking one
      rounding rule for both, in whichever card next touches that screen's copy.
- [ ] ⚪ **An EMPTY meal-suggestion or stretch list renders a heading with nothing
      under it.** Pre-existing, and distinct from the defect the summary reader
      closed: a list that ARRIVED empty is a truthful "none", so it is not a
      fabrication — but "Post-Workout Nutrition" over blank space reads as broken.
      The UNKNOWN case now says "unavailable right now" (2026-07-30); the empty
      case was left alone because writing empty-state copy is a product decision,
      not a defect fix. Same family as round 6 F6 / round 7 F8's empty-list states
      on the other three payloads.
- [ ] 🟡 **`RUNBOOK/cutover.md` is STALE — its checkboxes must not be quoted as
      fact.** Flagged by `DECISIONS-INDEX.md` when it was written (2026-07-30) and
      command-verified the same day: `cutover.md:107` still reads
      `- [ ] XP/levels display (GamificationStrip, Achievements)` although that
      card CLOSED on 2026-07-30 and both 🔴 lines for it above are ticked. The file
      states no verification date; the newest past date anywhere in it is
      2026-07-26 (`cutover.md:108`, the XP API-half merge — `2026-08-16` also
      appears but is the future Groq decommission deadline). So it predates THREE
      card closures, and `grep -ci postworkout` over it returns **0** although that
      card closed 2026-07-28.
      It matters because CLAUDE.md's grounding rule sends every
      migration-affecting card to cutover.md's prerequisites, and the P2.8 gate is
      "every owed endpoint exists" — a checklist that under-reports what is DONE
      reads as work still outstanding, and one that over-reported would be worse.
      Given a line here rather than fixed in passing because re-verifying the whole
      file against OWED.md is its own pass, not a one-checkbox edit. Closes by
      re-verifying every box against OWED.md and re-dating the file.

- [ ] ⚪ **Onboarding wizard's native unit dropdowns → the shared `Select`.** A
      native `<select>` popup is OS-drawn and its hovered row uses the system
      accent (blue) which CSS cannot override; Settings' five dropdowns moved to
      `components/common/Select` in Card 7, the wizard's cm/ft + kg/lbs pickers
      were left rather than folded in silently. (DECISIONS 2026-07-20.)
- [ ] ⚪ **Food matching residuals** (Card 5c T3, DECISIONS 2026-07-17/18):
      (a) `bySubstring`'s cross-word `includes` is a latent master-era hazard
      ("tea" ⊂ steak, "ham" ⊂ hamburger) reachable by any short manual query —
      fixing it trades honest-drops for wrong-guesses and needs a Kd product
      ruling, not a silent widening; (b) REMOVALS of drafted items produce no
      Stage-5 correction row, though 2B §3.2 counts "item swapped" as a
      correction; (c) the API does not dedupe canonicals within one request
      (double-counts the item and the correction pair; the web excludes
      duplicates client-side only).
      Also recorded: descriptive names whose head noun we stock but the
      substring pass misses still drop honestly ("Margherita Pizza", plurals
      like "Plate of Rotis") — same product call.
- [ ] ⚪❓ **Raw HTML in coach answers renders as visible text — needs a Kd
      ruling, not a drive-by.** Seen in the 2026-07-22 smoke: the model emitted
      `<br>` inside a markdown table cell and it displayed literally
      ("→ 90-120 g `<br>` Carbs:"). `react-markdown` ignores raw HTML BY DESIGN
      and prints it as text; rendering it needs the `rehype-raw` plugin — a NEW
      DEPENDENCY (R1.4) **and** a decision to let model-authored HTML into the
      DOM, which is a security-shaped choice (rehype-raw does not sanitise on
      its own). The honest alternatives are (a) add rehype-raw + a sanitiser,
      (b) strip/convert a small set of known tags client-side, or (c) nudge the
      system prompt away from HTML (relies on the model obeying, the same
      weakness Kd rejected when choosing remark-gfm over prompt instructions).
      Cosmetic today and harms no data. (2026-07-22.)
- [ ] ⚪ **An over-long coach message is hard to recover.** The composer sets no
      `maxLength`, but the contract caps a message at 2000 chars
      (`COACH_MAX_MESSAGE_CHARS`, packages/shared/src/coach.ts), so a longer one
      is rejected with `validation_error` AFTER the box has been cleared — and
      that error correctly offers no "Try again" (resending the same too-long
      text fails identically), so the only route back is selecting the text out
      of the user bubble. The copy hedges ("may be too long"), asserting nothing
      false. Pre-existing; surfaced by the Try-again card's T3 (V5) and reported
      rather than fixed (R1.1) since it needs a client-side length affordance,
      not a change to the error mapping. (2026-07-22.)
- [ ] ⚪ **Coach streaming.** Non-streaming was chosen for v1 (exact token/cost
      accounting + exact-match cacheability, nothing consumed the endpoint until
      P2.8). A streaming card can follow post-cutover.
      (DECISIONS 2026-07-11 P2.5 GAP-3.)
- [ ] ⚪ **Outbox for external-call ledger writes.** `api_cost_events` is written
      immediately after a provider response but outside a transaction with the
      application rows (coach: same tx; vision: two statements). The residual
      "provider spent + total DB failure" window is inherent to a
      non-transactional external call; an OUTBOX is the eventual answer, owed
      with the billing/worker phase. (DECISIONS 2026-07-12.)
- [ ] ⚪ **Coach read-path ordering tiebreaker.** `getRecentMessages` has no id
      tiebreaker on equal `created_at`, so live same-millisecond user/assistant
      pairs could invert. Pre-existing; the migration sidesteps it by making
      `created_at` monotonic per thread. (DECISIONS 2026-07-13 P2.7e T3.)
- [ ] ⚪ **Sync POST timeout.** `syncApi` has no timeout, so a hung POST holds a
      flush run open indefinitely. Made harmless by Card 2's owner check
      (correctness no longer depends on run length), so it was reported not
      fixed (R1.1). (DECISIONS 2026-07-15.)

## Phase-1 engine debt (does NOT block cutover; blocks the P4 exercise line)

- [ ] ⚪ **§7.5 trace-count shortfall — the phase's own hard gate is NOT met.**
      §7.5 / Part 0 #4 require ≥6 squat + 4 jump + 4 chair recorded parity
      sessions; the repo has 3 + 3 + 3. "9/9 green" means all PRESENT clips
      pass, NOT certification. Kd records the remaining ~3 squat + 1 jump + 1
      chair (front views included) to unblock. Accepted as tracked debt under
      the Option-B scope Kd set; traces.replay warns loudly.
- [ ] ⚪ **Fault multisets have zero trace coverage** (`faultsPending` stays),
      blocked on the same jump-airborne / chair-target template work below.
- [ ] ⚪ **Phase timings asserted only structurally** — a tolerance must be
      declared before any trace asserts them (§7.4 names none).
- [ ] ⚪ **Kd spot-check owed:** 2–3 re-recorded goldens' `expected.reps` against
      the raw videos (gate and fixtures changed in the same PR).
- [ ] ⚪ **Jump-squat airborne-state scoring/faults** (SPEC GAP → P4). Stiff
      landing, loading-depth window, just-landed score and the `(trunk−shin)`
      relative lean all need per-frame airborne gating the current template
      cannot express. Jump ships counting + an interim depth curve only.
- [ ] ⚪ **Chair adaptive depth scoring** (SPEC GAP → P4). The legacy curve is
      anchored to the C2 `target`; scoring-curve x-values are fixed numbers.
      Chair ships an interim fixed-fallback-target curve.
- [ ] ⚪ **±3 per-rep score parity has no defined extraction rule** (SPEC GAP,
      needs a Kd decision). Python emits per-FRAME scores, the engine per-REP.
      Recommendation on file: "Python rep score = min form_score within that
      rep's descent→completion window", asserted for squat only.

## Open questions awaiting a Kd ruling (nothing built on these)

- [ ] ❓ **Privacy-law scope beyond DPDP** (raised by Kd 2026-07-21). Should the
      product satisfy EU/UK GDPR, US state laws (CCPA/CPRA), Brazil's LGPD —
      not DPDP alone? The spec is partly with him: Part 4 §5.2:829 heads the
      flow "DPDP/GDPR", 2B:538 says "under India's DPDP Act 2023 and GDPR for EU
      users" — but it never enumerates the GDPR deltas and never mentions
      CCPA/LGPD. **Engineering assessment:** the worker's MECHANISM is common to
      all of them (hard-delete pass + JSON export); the deltas are mostly TIMERS
      (DPDP 14 days · GDPR "without undue delay", conventionally ≤30 · CCPA 45)
      and metadata, so building it now boxes nothing in PROVIDED the window is
      one named constant. **Not code, and Kd's alone:** lawful basis, consent
      records, privacy notice, breach notification, DPAs, an EU representative,
      and whether the product is even offered in those jurisdictions at launch.
      "India-only at launch, widen before an EU/US launch" is a legitimate
      answer that leaves the worker card unchanged.
- [ ] ❓ **Leaderboard sequencing** — see the 🔴 leaderboard line above. Kd must
      choose: land a minimal read before cutover, or accept a dark window.
- [ ] ❓ **`capture="environment"` trade-off** — keep as-is (A), drop `capture`
      so phones offer a Take-Photo/Library chooser (B), or two explicit buttons
      (C). Recommendation: A now, C later only if the owed phone smoke shows the
      gallery limitation actually bites.

---

## Done (kept, not deleted — the record of what closed and when)

- [x] argon2id rehash-on-login — merged 2026-07-15, PR #28.
- [x] Onboarding/fitness-profile storage — merged 2026-07-16, PR #30.
- [x] Vision model migration (Scout → qwen/qwen3.6-27b, prices re-quoted) —
      2026-07-16, during web Card 5a.
- [x] Dishware in-flow UI + portion API — Card 5c2, 2026-07-18.
- [x] Food synonym/alias matching — Card 5c, 2026-07-17 (residuals above).
- [x] Meal composition (add/remove ingredients) + change-label — Card 5c.
- [x] Previous-days meal view — Card 5d, 2026-07-19.
- [x] Settings profile forms → new API — Card 7, 2026-07-20.
- [x] Nutrition targets, API + web halves — PR #42 + commit aa362ce, 2026-07-21.
- [x] ~~Desktop webcam capture~~ — **WON'T BUILD**, Kd ruled 2026-07-19. Not a
      removal: no meal-photo webcam was ever built, Part 2B §3 mandates no
      capture mechanism, and nobody is blocked (the file picker already works on
      desktop). A laptop webcam is a worse input to 2B's portion problem and
      would burn paid vision calls on poor photos.
