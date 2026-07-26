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
- [ ] 🟡 **Rotate the Neon database password (`DATABASE_URL`).** Exposed
      2026-07-26: a `grep` for the connection string during the XP-card smoke
      setup matched a neighbouring comment line, and the mangled value — password
      included — was printed into a Claude chat transcript in an error message.
      Same class as the two rotations above, and treated the same way rather than
      waved off because it was accidental. This one is heavier than a provider
      key: it is direct read/write access to the dev database. Rotate in the Neon
      console (Roles → reset password), update `apps/api/.env` and the
      `infra/api.env` on any host, and re-run the migrations check. The dev
      branch holds only test fixtures, which is why this is 🟡 and not 🔴.
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

- [ ] 🔴 **XP / levels display** (GamificationStrip, Achievements). XP storage
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
      **STILL OWED: a second T3 round.** Round 1 found two blocking defects and
      both fixes are new, independently-unreviewed code — which on this project
      is exactly where the next defect has been every time. If round 2 finds a
      blocking defect this tick comes off (the google-login / DPDP precedent).
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
- [ ] 🔴 **Workout history calendar** (WorkoutCalendar → workoutApi.getHistory).
      **BLOCKED — NOT a client repoint. Do not pick this up as a quick win.**
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
- [ ] 🔴 **Dashboard's XP surfaces still fabricate — XPBar + "Current Level"
      StatCard.** Kd-ruled OUT of the 2026-07-26 XP-display card and given this
      line in the same commit, per the deferral rule. `Dashboard.jsx` renders
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
- [ ] 🟡 **`.catch(console.error)` on axios errors prints the old backend's
      Bearer token to the browser console.** Pre-existing, R3.10, in files the
      XP card edited but out of its scope to fix — recorded because that card
      applied the message-only rule to its own new log line and left the same
      class two lines away (its T3 made the point). `GamificationStrip.jsx` and
      `Achievements.jsx` both `.catch(console.error)` the whole axios error
      object, whose `config.headers.Authorization` carries whatever `mlApi.js`
      attached. Harmless while that value is the string "Bearer null" on this
      branch, real the moment any client attaches a live one. The fix is the
      `err?.message` form used in `useXp.js`; it belongs to a small sweep of
      every `catch(console.error)` on an axios call, not to one card.
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
