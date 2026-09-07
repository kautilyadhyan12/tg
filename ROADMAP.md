# ROADMAP — what we build, in order

The ordered list of work to launch on web and mobile. Kd decides the order; a chat
picks the next unticked item in the current stage unless Kd says otherwise.
Tick an item when it is merged to main and Kd has clicked through it. If a
feature is deferred, add it here in the same commit, never in prose elsewhere.

The full previous list (304 open items, 2026-09-07) is kept at
`archive/records/OWED.md` for detail; anything from it that matters before launch
is here, the rest is under "After launch".

## Stage 0 — Reset (2026-09-07)

- [x] Archive the record files, old backends and smoke sheets; write `CLAUDE.md`, `RULINGS.md`, `ROADMAP.md`, `HANDOFF.md`.
- [x] Merge `web-repoint` into `master` (fast-forward, 2026-09-07, CI green); 47 merged remote branches and 37 local ones deleted; `web-repoint` retired. Every feature from now on is a short branch off `master` and a pull request.

## Stage 1 — The member's core, web first

1. [ ] **Sign-in by email code.** One "Get started" screen: Continue with Google · Continue with email (6-digit code). Signed in at once, straight to onboarding. Sign-in doors relabelled "Train" and "Manage my gym, studio or clients". No password at all (Kd, 2026-09-07 — the optional-password and reset-screen halves are struck); verify-email step gone (a code proves the email); deleting an account confirmed by an emailed code. Email through Resend (the service is the dependency; no new package). *Built 2026-09-07 on branch `sign-in-by-email-code`; awaiting review, merge and Kd's click-through.*
2. [ ] **Organisation types** gym · studio · personal trainer at creation; a new owner from the "Manage" door lands on "create your organisation" with no personal onboarding.
3. [ ] **Onboarding v2, server side.** The science (resting burn, daily activity + training days, pace → deficit or surplus, macros, finish date), the sanity rules (target direction, healthy-weight floor, over-a-year pace, calorie floor, under-18 and flagged-condition rules), the health screening and Safe mode flag, the consent log (time, version, wording), allergen tags on every food, contraindication tags on every exercise. Tests for every rule.
4. [ ] **Onboarding v2, screens.** Twelve tap-only screens, saved as you go, gym code applied first, live plan numbers, disclaimers, the "Check first" choice, the plan screen with Adjust.
5. [ ] **Goals and the Today screen.** Goal object (type, target, period day/week/month/year, app-set or user-set), starter goals from onboarding, editable and addable, progress from existing data, rings on a Today home.
6. [ ] **Recommended workout and the weekly plan.** Per-person plan builder from the catalog (shape from days and level; exercises by goal, equipment, health; numbers by level and goal; push-up and plank checks set starting numbers; progression to the harder variant once mastered); swap, move, add; camera counting where the engine supports it, guided otherwise. Replaces the dead old-backend "Recommended for you" on the dashboard.
7. [ ] **Meal suggestions and the run plan.** Suggestions from the food table by diet, allergens, cuisine, meals a day and calories left; a week's run schedule from the running answers (phone app; web says "in the app"). Under-18 and Safe-mode rules respected.
8. [ ] **Dead web screens off the old backend.** Predictions, workout templates, profile photo (needs image storage), badges/challenges/leaderboard "coming soon" — each either moved to the new API or shown as "in the app", never left broken. Delete account moved to the new API on 2026-09-07; still owed here: the **undo page** for the deletion email's restore link (until it exists the undo email is deliberately not sent, and the screen says "removed after 14 days" rather than promising a link).
9. [ ] **Chat coach switched off** on the web (route and import), cost counter moved out of the coach service. Kd's ruling; still live and billing today.
10. [ ] **Known defects on the way:** a network blip on page load logs you out · a dropped request logs you out instead of offering retry · sync upload has no timeout · the full API suite flakes because nine test files share one seeded database.

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
2. [ ] Trials enforced: 7 days individual, 15 days organisation, one per owner account, one per device on the web, no card; the price book seeded as ruled; bands 3–5 USD and the INR book to Kd if he wants to revisit.
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
