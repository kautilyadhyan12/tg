# ROADMAP — what we build, in order

The ordered list of work to launch on web and mobile. Kd decides the order; a chat
picks the next unticked item in the current stage unless Kd says otherwise.
Tick an item when it is merged to main and Kd has clicked through it — or, for a
card with no screen, on merge alone (RULINGS 2026-09-09). If a feature is
deferred, add it here in the same commit, never in prose elsewhere.

One lettered line is one chat and one pull request. A chat that finds its line is
still too big (it touches more than one of sign-in, money and other people's data,
or a review would have to read more than about a thousand new lines) splits the
line here first, then builds the first half. Item 1 below was four features in one
line and drew a review of that size; that is why the lines are now small.

The full previous list (304 open items, 2026-09-07) is kept at
`archive/records/OWED.md` for detail; anything from it that matters before launch
is here, the rest is under "After launch".

## Stage 0 — Reset (2026-09-07)

- [x] Archive the record files, old backends and smoke sheets; write `CLAUDE.md`, `RULINGS.md`, `ROADMAP.md`, `HANDOFF.md`.
- [x] Merge `web-repoint` into `master` (fast-forward, 2026-09-07, CI green); 47 merged remote branches and 37 local ones deleted; `web-repoint` retired. Every feature from now on is a short branch off `master` and a pull request.

## Stage 1 — The member's core, web first

1. [x] **Sign-in by email code.** One "Get started" screen: Continue with Google · Continue with email (6-digit code). Signed in at once, straight to onboarding. Sign-in doors relabelled "Train" and "Manage my gym, studio or clients". No password at all (Kd, 2026-09-07 — the optional-password and reset-screen halves are struck); verify-email step gone (a code proves the email); deleting an account confirmed by an emailed code. Email through Resend (the service is the dependency; no new package). *Built 2026-09-07; three review rounds; merged to `master` 2026-09-08 (PR #51, CI green).*
2. **Organisation types** (split 2026-09-08).
   - 2a. [x] **Types at creation.** Gym · studio · personal trainer; a new owner from the "Manage" door lands on "create your organisation" with no personal onboarding. *Merged 2026-09-08 (PR #53).*
   - 2b. [x] **Words by type, everywhere else.** Every console screen, the member's
     join door and My Gyms speak the organisation's own words — Clients / Coach for a
     studio and a personal trainer where a gym says Members / Trainer (spec Part 3 §2.2).
     One table in `@app/shared`, read by the API and by every screen, so the server's
     refusals and the screen agree. *Merged 2026-09-08 (PR #55).*

3. **Onboarding v2, server side** (split 2026-09-08; the science first because every screen shows its number).
   - 3a. [x] **The plan maths and its sanity rules.** Resting burn, daily activity + training days, pace → deficit or surplus, macros, finish date; target direction, healthy-weight floor, over-a-year pace, the calorie floor; the under-18 and flagged-condition rules (no deficit). Pure functions, a test for every rule. Nothing on screen yet; the click-through says so.
   - 3b. [x] **Health screening, Safe mode and the consent log, server side.** ONE general question stored as a yes/no plus the "Check first" choice, changeable any time (RULINGS 2026-09-09 — no named condition, ever); Safe mode and "no calorie cut" derived on the server and read by the plan maths (`hasCondition` + `safeMode`, reasons `health_answer` / `safe_mode`) and by the live macro rings; the consent log (time, app version, wording verbatim) for sign-up, the health step and the plan screen. Tenancy test on every route. *Built 2026-09-09, branch `health-screening`; review round 1 fixed the same day; Kd ruled on the consent log (kept six years, sweep built) and the old conditions box (off at 4b); re-check done the same day (one High — the consent limiter throttled a whole gym — five Low, all fixed); round-2 re-check found no Critical/High (four Low + three test gaps, all fixed). No click-through: 3b has no screen (RULINGS 2026-09-09). Merged 2026-09-09 (PR #57, CI green, branch deleted).*
   - 3c. ~~Allergen tags on every food.~~ **Struck 2026-09-09** (RULINGS): no tags, no allergy question; every meal suggestion carries a food-allergy caution line instead, built with 7a. (Contraindication tags on exercises were struck the same way: with one general health question the app cannot know which exercises to exclude, RULINGS 2026-09-09; a cleared person gets the normal plan with a "follow your professional" line, built with 6a.)
4. **Onboarding v2, screens** (split 2026-09-08 along the twelve screens in RULINGS; master is not live, so a half-built flow may land and the next half continues it).
   - 4a-i. [x] **The answers and the live plan, server side** (split 2026-09-09: seven screens plus a migration, two routes and the macro rings' move is more than one chat and more than a reviewable diff). Stores what the screens ask — the one main goal, pace, the day, the two fitness checks, the week, equipment — saved as you go, so a screen never wipes an answer it did not ask about. `GET`/`PATCH /v1/users/me/onboarding` answer with the plan numbers or the honest list of what is still missing; "today" comes from the device's time zone and the server clock, never a body field. Nothing on screen yet, so no click-through (RULINGS 2026-09-09). *Built 2026-09-09, branch `onboarding-plan-server`; six review rounds, the last with no Critical/High and its re-check waived by Kd. Merged 2026-09-10 (PR #58, CI green, branch deleted).*
   - 4a-i-b. [x] **Weight has one source and no copy** (Kd's redesign, 2026-09-10: the profile form echoing a weigh-in's number left a "typed by me" entry the person never typed, so deleting the mistaken weigh-in kept its number). Migration `0027` drops the `users.weight_kg` cache after re-running 0026's safety backfill; every reader computes the weight from the history. No screen changes, so no click-through (RULINGS 2026-09-09). *Built 2026-09-10; Kd waived the re-check (no Critical/High). Merged 2026-09-10 (PR #59, CI green, branch deleted).*
   - 4a-ii. [ ] **Screens 1–7:** goal · about you · target · your day · your training (push-up and plank checks) · your week · equipment. Tap-only, saved as you go on the 4a-i routes, the live plan number on every screen from the moment it exists (after "your week", screen 6, when the eight core answers are in; earlier screens say what is still needed — no number from a default, RULINGS 2026-07-15). The nutrition targets route (`/v1/nutrition/targets`, still shown by the web's macro rings) moves onto the stored plan answers so ONE daily-calories number exists — today it reads the old profile with a fixed −400/+300 and can differ from the plan number by a few hundred kcal; the one-element `fitness_goals` mirror 4a-i writes ends there, and with it the one gap it leaves open — the v1 PUT replaces that array without touching `main_goal`, so until the rings move the two can disagree for anyone who edits goals on the old form. Screen 7 makes "no equipment" exclusive as you tap, AND drops "none" as it LOADS an answer the old form already wrote: the v2 contract refuses "none" beside real equipment, the old free multi-select can still send that pair, so without this a person carried over from it taps Save without touching equipment and gets a 400 with nothing on screen to explain it (the old form is left alone until this screen replaces it). Also here: `onboardingCompleted` is stored exactly as the client sends it, so `true` with no answers saved opens the training side (the v1 PUT has always been the same, and nothing on the server reads that column as a gate) — the server refuses `true` while `missing` is non-empty, which is what RULINGS 2026-07-19 asks for.
   - 4b. [ ] **Screens 8–11:** health (the ONE question, "Check first", the disclaimer tap — on the 3b routes) · food · running · code, with the gym code applied first. Settings gets the same health screen so the answer can be changed later (RULINGS 2026-09-09). The old free-text "medical conditions" box (Onboarding, Settings) is switched off here and `user_fitness_profiles.medical_conditions` is wiped by migration (RULINGS 2026-09-09).
   - 4c. [ ] **Screen 12, your plan:** live numbers, the disclaimer, Adjust, and the Safe mode version that shows no workout or run plan.
5. **Goals and the Today screen** (split 2026-09-08).
   - 5a. [ ] **Goals, server side.** The goal object (type, target, period day/week/month/year, app-set or user-set), the starter set from onboarding answers, progress from existing data. Routes with the stranger-gets-404 test.
   - 5b. [ ] **The Today screen.** Rings from progress, the goal list, change, remove and add.
6. **Recommended workout and the weekly plan** (split 2026-09-08).
   - 6a. [ ] **The plan builder, server side.** Shape from days and level; exercises by goal, equipment and health limits; numbers by level and goal; push-up and plank checks set the starting numbers; progression to the harder variant once mastered; Safe mode builds no plan. Pure and tested.
   - 6b. [ ] **The weekly plan screen.** The week, swap, move, add. Replaces the dead old-backend "Recommended for you" on the dashboard.
   - 6c. [ ] **Doing a planned workout.** Camera counting where the engine supports the exercise, guided otherwise; a finished workout feeds progression.
7. **Meal suggestions and the run plan** (split 2026-09-08).
   - 7a. [ ] **Meal suggestions.** From the food table by diet, cuisine, meals a day and calories left; a food-allergy caution line on every suggestion (RULINGS 2026-09-09 — no allergen tags, no allergy question); under-18 and Safe mode rules respected.
   - 7b. [ ] **The run plan.** A week's run schedule from the running answers (phone app; web says "in the app"); none in Safe mode.
8. [ ] **Dead web screens off the old backend**, one screen per chat. Predictions, workout templates, profile photo (needs image storage), badges/challenges/leaderboard "coming soon" — each either moved to the new API or shown as "in the app", never left broken. Delete account moved to the new API on 2026-09-07, with the undo page (`/restore-account`) built the same day after review.
9. [ ] **Chat coach switched off** on the web (route and import), cost counter moved out of the coach service. Kd's ruling; still live and billing today.
10. [ ] **Known defects on the way**, one defect per chat, each starting with a failing test: a network blip on page load logs you out · a dropped request logs you out instead of offering retry · sync upload has no timeout · the full API suite flakes because nine test files share one seeded database · a workout's calories use the weight on the day it syncs, not the day it was done (spec Part 4 §3.6 asks for the newest weigh-in at or before the workout; the two differ only for a workout synced after a later weigh-in).

## Stage 2 — The gym console, remaining

1. [ ] Gym leaderboard (R1–R18 of 2026-09-07): one ranked list, filters, member's My Gyms view, goal points, greyed opt-out, info symbol.
2. [ ] "Slipping away" web half + message expiry after 7 days (server half is built, unreviewed).
3. [ ] Roster import: CSV + XLSX upload, column-mapping preview, attach-on-join.
4. [ ] Staff invites by email; a gym can be handed to another owner; a gym can change its own name, city, timezone.
5. [ ] Members screen contents (last active, streak, search, CSV export); notify members when confirmed or removed.
6. [ ] Gym profile page for members; gym announcements feed; gym greeting and branding on the member home.
7. [ ] Member-to-coach / gym messaging.
8. [ ] Classes, schedules and booking (the largest gym item).
9. [ ] Gyms set their own prices, offers and promos; gyms sell products to members.
10. [ ] Coach-authored workout and diet plans for a named member; coach videos (20 per gym, 1 minute).
11. [ ] Photo sharing to the gym (one-week life, reactions only, report-and-remove), the photo/stats editor.
12. [ ] Reports section; billing section buttons; the seat cap re-counted; the two sweeps run in production configuration.
13. [ ] Kd's admin panel — last.

## Stage 3 — Money

1. [ ] Paddle checkout for individuals and gyms; the subscription state machine; webhooks (raw body, dedupe, worker); invoices.
2. **Trials enforced** (split 2026-09-08 after Kd's trial-abuse ruling; no approval queue, ever).
   - 2a. [ ] Trial lengths 7 days individual and 15 days organisation (the button still says 30), one per owner account (built), no card; the price book seeded as ruled; bands 3–5 USD and the INR book to Kd if he wants to revisit.
   - 2b. [ ] Same person, new spelling: Gmail dots and `+tags` collapse for trial counting; throwaway email domains refused at the Manage door.
   - 2c. [ ] One device, one trial, whatever the email: a browser mark on the web, the stores on the phone.
   - 2d. [ ] The trial belongs to the gym: a new organisation whose first members were members of an already-trialled organisation gets no second trial and sees the subscribe prompt; the owner's own device counts as member one.
   - 2e. [ ] Allow now, look later: the "have a look" list for weaker clues (an email to Kd until the admin panel; pause and remove already exist) and the second-trial code for a real owner of two gyms.
3. [ ] Gym-collects-from-members (Stripe Connect) — after launch unless a gym asks.

## Stage 4 — Launch readiness

1. [ ] Deploy: a server, a domain, secrets in the platform, automatic deploy from main, health checks, the worker running (DPDP day-14 purge must run before the first real sign-up).
2. [ ] Backup and restore drill performed; the secrets escrow list.
3. [ ] Consent screens for health data and the camera; terms and privacy notice reviewed by a lawyer; company and insurance (Kd).
4. [ ] Image storage on R2 (meal photos with 7-day deletion, avatars, gym logos).
5. [ ] The pricing/allowance questions still open with Kd: bands 3–5 and INR after the raise; does the gym raise move the individual tier; the yearly book; "custom above 2,100" has no route in.
6. [ ] Camera accuracy list (from the archive): rest billed as squatting, a too-shallow squat says nothing, constant voice coaching, 12 vs 15 frames a second, person-check tuned on a different model, degradation ladder, choosing which person is the user, follow-the-demo mode.

## Stage 5 — The phone app

1. [ ] Expo dev client; the two-day pose spike (≥20 fps on a mid-range Android is the gate).
2. [ ] Screens on shared packages: sign-in (code, Google, Apple), onboarding v2, Today, goals, plans, library, camera workout, progress, My Gyms, console.
3. [ ] Offline SQLite mirror and the sync engine.
4. [ ] Running end to end: MapLibre + OpenStreetMap tiles, background tracking, the Play permission flow, routes, published routes only.
5. [ ] Meal scan and barcode on the phone.
6. [ ] Store billing (RevenueCat), push, EAS release trains, store listings and privacy labels, Apple small-business programme.

## After launch

- The Pact (random matching, squads, identity reveal, joint photo) · territory capture (individual perk, 200 m end-trim on routes) · published routes and the running social layer · wearables both ways · the global leaderboard · City League · TV mode · share cards · nearby gyms · a map of gyms · exercises 4–58 through the production line (12 solid before pitching) · Hindi and Assamese exercise text · the eight residual coach items (only if the coach ever returns).
- Undecided, do not build: day passes · paid friend/family invites · training together live · nearby-runner connection.

## Ruled out — never build, never re-propose

The AI chat coach (off, not deleted) · per-seat pricing · phone OTP at sign-up · gym-team territory · the eight struck gym ideas (see RULINGS) · session names · join-code labels · user-added exercises · Google Maps · desktop webcam capture for meal photos · clinics as an organisation type · Kd approval before a gym can start · a pooled route heatmap.
