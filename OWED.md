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

- [ ] ⏰🔴 **Groq COACH_MODEL migration — HARD DATE before 2026-08-16.**
      `llama-3.1-8b-instant` (config.ts:30) is decommissioned that day; after it
      the AI coach returns nothing and goes dark. Flip the default (Groq
      recommends GPT OSS 20B) AND re-quote the model-specific price constants
      (coach/service.ts:23-24) from groq.com/pricing per Part 0 rule 4 — they
      are model-specific and must never be carried over by assumption. Verify
      answer quality against the 5 KB guides. Date-gated, NOT launch-gated: do
      it even if cutover slips. (DECISIONS 2026-07-16; cutover.md.)
      Note: the old GROQ_API_KEY reuse was Kd-approved with rotation deferred —
      this card is the natural moment for the new key (DECISIONS 2026-07-16).

## 🔴 Blocks the cutover — the old backend cannot be switched off until these exist

### Screens still reading the OLD backend (no new-API home yet)
Each needs an API surface built BEFORE its screen can be repointed. Per the
no-removal rule these UIs stay untouched and working on the old backend until
then; none may be hidden or reduced to close the gap.

- [ ] 🔴 **XP / levels display** (GamificationStrip, Achievements). XP storage
      does not exist anywhere in Part 4 — inventing a column would violate R0.2,
      so the badges.py XP/level curve stays unported until a ruled migration
      card. (DECISIONS 2026-07-11 P2.3 GAP-1.)
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
- [ ] 🔴 **Google login** (`GOOGLE_LOGIN_ENABLED=false`, Login.jsx/Register.jsx).
      **THE AUDIT MISS — owed since 2026-07-15 and tracked NOWHERE until now.**
      v1 §6.1:438 lists Google OAuth in the auth module; P2.1 shipped
      email/password only and there is no `/v1/auth/google` route, so the
      buttons are HIDDEN and the `/auth/google/success` route was removed.
      A user-facing feature is currently switched off — exactly what the
      no-removal rule forbids leaving untracked.
      Scope must include: `pages/GoogleAuthSuccess.jsx` is ORPHANED dead code
      still calling `localStorage.setItem('accessToken')` and the now-wrong
      `/auth/me` — rewrite or delete it; and it calls `setUser` RAW, bypassing
      `adoptSession`, which would key the user to 'guest' and re-open the
      shared-browser queue hazard Card 2 closed. Route session adoption through
      `adoptSession` or stop exporting `setUser`. (DECISIONS 2026-07-15 Cards
      1–2.)
- [ ] 🔴 **Avatar / profile-picture storage.** No `profilePicture` field exists
      in the shared schema or the users DDL (command-verified), so this is the
      one Settings surface still on legacy mlApi. **Scope MUST include the R3.9
      security the current path lacks** — it base64-inlines a 2 MB image into a
      JSON PATCH; R3.9 requires magic-byte content-type validation (not
      extension), a size cap, R2 storage under SERVER-generated keys, and
      signed-URL/CDN delivery. Do NOT inherit the current shape at cutover.
      (DECISIONS 2026-07-20, Card 7.)
- [ ] 🔴 **Coach chat retry protection.** `/v1/coach/chat` has no per-route rate
      limit and accepts no Idempotency-Key, so a client retry double-charges
      quota, re-calls Groq, and duplicates messages. The ruling tied this to
      "when the client is wired" — Card 4 wired it, so the API side is now due.
      Client change is one header line (coachApi.js notes where).
      (DECISIONS 2026-07-12 P2.5b T3; Kd D1(b) 2026-07-16.)

### Legal / operational gates
- [ ] 🔴🟡 **DPDP Day-14 hard-delete + JSON-export worker.** §5.2 ANONYMIZES the
      users row rather than deleting it, so NO FK cascade collects user-owned
      PII; §5.2's explicit Day-14 DELETE list is the only mechanism and the
      worker does not exist. Needs BullMQ (**not installed** — verified) and a
      worker mode. Must cover BOTH §5.2 lists (hard DELETE and JSON export) and
      MUST include `user_fitness_profiles`, which holds `medical_conditions`
      (health data). **Promoted to next-priority on 2026-07-16 as the explicit
      PRICE of merging the onboarding-storage card**, and has since been
      deferred past seven cards — record that honestly rather than let it drift.
      Exposure is theoretical only while the DB is empty; it becomes real with
      the first registration.
      **Build note (T3 assessment, 2026-07-21):** carry the retention window as
      ONE named constant, and make the export a table list rather than a bespoke
      format — see the open scope question below.
- [ ] 🔴 **Drain offline sync queues before cutover.** Per-user localStorage
      buckets are keyed `user_<id>_*`; pre-cutover that id is the old Mongo
      ObjectId, after it the new UUID, so unflushed workouts orphan. Non-issue
      on greenfield prod (empty DB) — matters only for a data-carrying cutover.
      (DECISIONS 2026-07-15.)
- [ ] 🔴 New API deployed and healthy (`/health`), `data_backend` flag seeded.
- [ ] 🔴 Secrets in the deploy platform (escrow doc, Part 8 §1) — never in repo.
- [ ] 🔴 Backup/restore drill actually performed and logged (Part 8).

## 🟡 Needed before real users, not before cutover

- [ ] 🟡 **Timezone capture.** **THE SECOND AUDIT MISS — owed since 2026-07-11,
      tracked NOWHERE until now.** The web never captures a timezone, so
      `users.timezone` is null and day-bucketing falls back to UTC for
      EVERYONE. Streaks and "today" therefore roll over at the wrong local hour
      for every user outside UTC — which is all of them, this being a Jorhat
      pilot. Trap #8 in the playbook is precisely this.
      Scope also includes the §3.5 **timezone-travel rule** (a day is kept if it
      qualifies in either the stored-at-the-time TZ or the new one), which is
      NOT implemented — streak replay uses only the current `users.timezone`.
      Shielded today only because everyone is UTC; both must land together.
      (DECISIONS 2026-07-11 P2.3 GAP-3 + the §3.5 note.)
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
