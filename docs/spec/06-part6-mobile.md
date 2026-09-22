<!--
Part 6 — Mobile App (Expo/React Native)
Extracted from aihomegym.pdf (pdftotext). Hard line-wraps and occasional
table/DDL wrapping are extraction artifacts, not content changes. When an
exact value (price, threshold, SQL) looks garbled, verify against the PDF.
This file is spec — BINDING. Do not modify; record deviations in DECISIONS.md.
-->

# Part 6 — Mobile App (Expo / React Native): Full Specification

**Prerequisites:** Architecture v1 §12 · Part 2 (PoseFrame §2.1, mirroring
§2.2, outputs §2.4, bundle §9.3, perf gate §7.6) · Part 4
(client-generated IDs = sync idempotency) · Part 5 (§4.3 RevenueCat, §5.4
cross-channel guards) · Part 2B (provisional calories §2.2, barcode path
§3.5).

**Scope:** the developer-workflow change · app architecture & screen
parity · the pose pipeline with a pass/fail spike protocol · the offline
sync protocol in full · background-GPS Running · push, IAP, auth, assets ·
EAS build/update pipeline · store listings & privacy labels · testing,
sequence, risks.

**AMENDED 2026-09-22 (RULINGS 2026-09-21 and 2026-09-22; Parts 1 and 8 of Kd's
planning document).** Where this Part differs, RULINGS wins. The phone app is the
MEMBER's alone: no console in it (the console is the browser's). `apps/mobile` was
empty on that day. It is built in two versions. **First**: sign-in (code, Google,
Apple) with ONE phone at a time (Part 3 §10.5) · "Before you start" · the invitations
waiting for the signed-in address and Join, with the food-and-weight switch (Part 3
§10.2, §15.7) · setup · the pass (Part 3 §12.2) · classes and booking (Part 3 §13) ·
the gym's shared page (Part 3 §15) · the inbox and push (Part 3 §16.1) · meal scan,
the food search and the rings · a workout logged by hand. **Second**: the camera
coach (§3) · running (§5) · the offline layer (§4) · paying inside the app (§7). The
support floor is an ORDINARY RECENT phone — the ₹10–12k device of §3.2, §3.5 and §14's
acceptance line is dropped (Kd, 2026-09-22) — and §3.2's two-day spike stays as a test
of the pose LIBRARY on such a phone. Android and iPhone are one Expo app; Kd works on
Windows, so iPhone builds run in EAS's cloud. The member web stays as the testing
place until the phone app holds everything, and is deleted then.

## 0. Amendments & locked context

1. **Engine thread placement** (amends v1 §12's "landmarks stay in
worklet-land"): the engine runs **on the JS thread** in v1 of the app; the
worklet ships only the landmark array across. Measured honestly: one
`PoseFrame` is 33×4 floats = **528 bytes**; at 20 Hz that's ~10 KB/s of
marshalling — nothing. What worklet-hosting the engine would cost is real:
no Sentry, no debugger, a restricted JS runtime, and every engine bugfix
becoming a worklet-compat question. Moving the engine into the worklet
(via `react-native-worklets-core`) is the documented **escape hatch if
profiling ever shows bridge pressure — not the default.** The engine's
purity (Part 2 invariants) is what makes this a config choice instead of a
rewrite.
2. **Pose-provider candidate order ratified** (§3.2):
`react-native-mediapipe` (MediaPipe Tasks wrapper — full 33-landmark
parity with web) first, `react-native-fast-tflite` second, own native
module last. The 17-keypoint MoveNet path is **rejected up front**: it
lacks heels and foot-index, which silently kills `knee_over_toe`,
`ankle_angle`, and `heel_elev` — i.e., lunges, calf raises, and parts of
T2. Landmark-set parity is not negotiable; it's what lets golden traces
and definitions transfer unmodified.
3. **Android-first ship.** iOS follows 2–4 weeks later through EAS +
TestFlight — **no Mac required at any step** (EAS builds iOS in the cloud;
you test on a physical iPhone via TestFlight). Apple Individual developer
account ($99/yr) is the only prerequisite; start that enrollment now
(review lead times, like Part 5's open items).

What's already decided and merely referenced here: Expo + **EAS
dev-client, not Expo Go** (v1 §12 — pose needs native modules Expo Go
can't load); shared `@app/engine` + `@app/shared`; SQLite offline-first;
RC for IAP; Running is mobile-only with web showing the install prompt.

---

## 1. The workflow change (read this first — it's the only disruption to
how you build today)

Your current loop (Expo Go on your Android) becomes, **once**:
1. `eas build --profile development --platform android` → cloud-builds a
**custom dev client APK** (~15 min) → install on your phone.
2. Daily loop is unchanged in feel: `npx expo start --dev-client` → scan
QR → fast refresh exactly as in Expo Go.
3. Rebuild the dev client **only when native deps change** (add/upgrade
vision-camera, mediapipe, RC, location) — expect a handful of rebuilds
during Phase 5, then rarely.

Windows is fine for everything: Android dev needs no Android Studio (EAS
builds remotely; `adb` optional for logs), and iOS never touches your
machine. Build profiles (in `eas.json`): `development` (dev client,
internal), `preview` (release-mode APK/IPA for testers + the pilot gym),
`production` (store artifacts). Secrets (RC keys, Sentry DSN, API URL)
come from EAS env per profile — never committed, per standing doctrine.

---

## 2. App architecture & screen inventory

**Position in the monorepo:** `apps/mobile` consumes `packages/engine`
(pose logic, untouched) and `packages/shared` (zod types, API client) —
the entire point of v1 §4's layout. State: React Query (server) + zustand
(session) matching web; persistence via the §4 SQLite layer. Navigation:
expo-router. Capability flags from one `platform.ts` (`runTracking: true`,
`barcodeScan: true`, `poseAvailable: detected at runtime` — §3.6).

**Tabs:** Home (today, streak, quick-start) · **Workout** (library →
ActiveWorkout) · **Run** (mobile-only) · Coach · Progress (history, PRs,
body log) · Profile (settings, billing, org membership).

| Surface | Parity with web | Mobile-specific |
|---|---|---|
| ActiveWorkout | same engine, same events, same UI logic ported to RN +
Skia overlay | camera pipeline §3; landscape lock per definition `setup` |
| Library / detail | same (bundle-driven) | demo videos streamed §9 |

| Coach / Nutrition | same endpoints, quotas | **barcode scan** (2B §3.5:
OpenFoodFacts path — mobile finally unlocks it), camera meal capture |
| Progress / Templates / Gamification | same | — |
| Run suite | web shows browse-only + install prompt (v1 §12) | live
tracking §5, planner, schedules |
| Org membership | join-by-code + **"What {org} can see" sheet** +
leaderboard opt-out (Part 3 §2.4/§4.4 obligations) | QR-scan join (poster
QRs) |
| Billing | reads entitlements; **no prices for org plans ever shown
in-app** (Part 5 §2 — B2B stays off-store) | RC paywall for Pro (§7) |

---

## 3. The pose pipeline (camera → landmarks → engine → UI)

### 3.1 Dataflow & threading

```
VisionCamera (720p, target 30 fps, front cam default)
 └─ frame processor (worklet):      pose model → 33 landmarks + confidences
         └─ shared value (latest landmarks)    ──►   Skia overlay draws at UI
rate (decoupled)
         └─ runOnJS @ inference rate (≤ 24 Hz): Float32Array(132) + t +
aspect + mirrored
               └─ PoseProvider adapter → PoseFrame (Part 2 §2.1,
mirrored=true for front cam per §2.2)
                    └─ @app/engine.push() → FrameResult / RepEvent / cues
→ UI + voice
```

Rules: the **overlay never waits for the engine** (draws the latest shared
landmarks — camera feels 60 fps even if inference is 20); the engine
consumes every frame it receives and is fps-agnostic by construction (Part
2 time-constant smoothing); inference is frame-dropping (process-latest,
never queue — a backlog of stale frames is worse than a lower rate).

### 3.2 The spike (2 days, run before any screen is built) — pass/fail
bars

Build one throwaway **Benchmark screen**: camera + candidate pipeline +
counters (inference ms p50/p95, delivered Hz, JS-thread FPS, memory,
battery %, thermal state) + a "record trace" button (Part 2 §7.2 format —
the recorder ships in the spike because its output *is* the parity
evidence).

| Bar | Pass | Fail action |
|---|---|---|
| Throughput | ≥ 20 Hz landmarks sustained **20 min**, mid-device (§3.5) |
try `lite` model variant → next candidate |
| Thermal | no throttle-crash; ≥ 15 Hz at minute 20 | drop camera to 24
fps / 640p → next candidate |
| UI health | JS thread ≥ 50 fps during session | move overlay fully to
Skia/worklet side (it should already be) |
| Battery | ≤ 20 % drain / 20-min session | resolution/model step-down |
| **Landmark parity** | replay one recorded video through web MediaPipe
*and* the device pipeline → per-landmark RMSE small enough that the three
✅ exercises' golden traces produce **identical rep counts and fault
sets** on-device | candidate rejected regardless of speed — parity is the
contract |
| Memory | stable over 20 min (no creep > 100 MB) | leak hunt or reject |

Candidate order per §0.2. Deliverable: a one-page decision record (numbers
per bar per candidate) committed to the repo — the same discipline as
definition rationales.

### 3.3 Model & camera configuration

BlazePose **full** as default, **lite** as the automatic step-down (§3.6);
1280×720, front camera, `mirrored=true` end-to-end (the Part 2 §2.2 policy
means the engine and definitions never know which camera);
landscape-orientation prompt driven by the definition's `setup` block
exactly like web. Torch off, exposure auto, focus continuous.

### 3.4 Performance budget (per frame, mid-device)

Inference ≤ 35 ms (full) / ≤ 22 ms (lite) · worklet→JS marshal ≤ 1 ms ·
adapter ≤ 0.5 ms · engine ≤ 1.5 ms (Part 2 §7.6 gate, unchanged — same
number web and mobile) · UI event handling ≤ 2 ms. Total JS-side ≤ 5
ms/frame keeps the thread breathing at 20 Hz with 10× headroom.

### 3.5 Device matrix & support floor

Test trio: your Android · one ₹10–12k 4 GB device (Redmi/Realme class —
**the pilot gym's median phone**; buy one, it's the most valuable ₹11k in
this project) · one Android 10 / 3 GB floor unit. Support floor: Android
9+, 3 GB; iOS: iPhone XR+ (trivially clears every bar). `minSdkVersion`
26, but capability detection decides features, not SDK level.

### 3.6 Graceful degradation ladder (runtime, automatic, honest)

full model → lite model (delivered Hz < 15 for 10 s) → 640p (still < 15) →
**log-only mode**: pose unavailable on this device → manual rep counting
UI + honest copy ("Form checking needs a bit more phone than this one —
your workout still counts"). Degradation events → PostHog with device
model, so the support floor is data, not guesswork. A user on a weak phone
gets a working app, never a slideshow.
---

## 4. Offline-first data layer & the sync protocol (in full)

**Doctrine:** the phone is a *client-side ledger* of things the user did,
append-only, eventually delivered. Nothing here is a distributed-systems
problem because Part 4 made every entity **client-ID'd and idempotent** —
there are no conflicts to resolve, only deliveries to complete. Offline
never blocks a workout: pose, logging, streak-provisional, and cached
history all work in airplane mode; only metered features
(coach/meal/route-gen) honestly require a network, and say so.

### 4.1 SQLite schema (expo-sqlite; mirrors, not masters)

```sql
local_workouts(id TEXT PK, payload TEXT, started_at INT, synced INT
DEFAULT 0);
local_runs(id TEXT PK, payload TEXT, points BLOB, started_at INT, synced
INT DEFAULT 0);
sync_queue(id TEXT PK, kind TEXT, entity_id TEXT, attempts INT DEFAULT 0,
           next_attempt_at INT, last_error TEXT, status TEXT DEFAULT
'pending');

cached_bundle(channel TEXT PK, version INT, sha256 TEXT, json TEXT,
fetched_at INT);
cached_entitlements(json TEXT, etag TEXT, fetched_at INT);
cached_history(page_key TEXT PK, json TEXT, fetched_at INT);
kv(key TEXT PK, value TEXT);          -- profile, streak-provisional,
flags
```

### 4.2 Write path

`engine.endSet()` → SetSummaries accumulate in the session → workout
finish → **one transaction**: insert `local_workouts` (id = client UUID,
Part 4 §3.5) + enqueue `sync_queue(kind:'workout')` → UI shows the workout
instantly with a subtle "pending ↻" badge. Runs identical (`kind:'run'`,
GPS points crash-safe per §5.3). App-kill mid-set loses at most the
in-progress set — an accepted, stated bound (summaries exist only at set
end by design).

### 4.3 Delivery engine

Triggers: connectivity regained (NetInfo) · app foreground · immediately
post-enqueue · a 15-min background fetch (best-effort; OS-throttled —
treated as bonus, never relied on). Per item: `POST /v1/workouts/sync` (or
`/runs/sync`) → **any 2xx or 409 ⇒ delivered** (server `ON CONFLICT DO
NOTHING` returns canonical state; a retry of a delivered item is a no-op
by construction) → mark `synced`, reconcile server-computed fields (kcal
per 2B §2.2, streak, achievements) into caches. Failures: network/5xx →
exponential backoff with jitter (1 m → 2 h cap), forever (append-only data
never expires from the queue); 4xx validation → park item
`status:'rejected'`, surface in Profile → "sync issues" with a
*send-report* action (this is a bug in our code, not the user's problem —
the report is for you). Battery courtesy: batch flushes, never hold a
wakelock for sync.

### 4.4 Read path & caches

History/progress/leaderboards: server truth, cursor-cached in
`cached_history`, stale-while-revalidate; pending locals overlay on top
with the badge. **Definition bundle:** boot uses cache instantly;
background `GET /v1/exercise-definitions` with `If-None-Match` (Part 2

§9.3); new bundle → applied on next session start (never mid-set);
`minEngineVersion` filter as specced. **Entitlements offline:** last-known
doc honored up to **72 h** stale for UI gating; past that, gate as
free-tier for anything metered (which is offline-dead anyway) —
pose/logging never gate. Clock skew: client timestamps stand; server
clamps `started_at` > now+24 h and flags `quality_flags:['clock_skew']`
(Part 4 field).

### 4.5 Housekeeping & multi-device

Synced locals pruned after 90 days; queue > 200 pending → gentle "you've
been offline a while" note. Two phones, one account: append-only makes it
safe; streaks/achievements are **server-computed at sync** (authoritative)
with client-provisional display — the only place a second device can
"surprise" you is a streak looking better after sync, which is the good
direction.

---

## 5. Running (mobile-only; the feature web advertises but doesn't have)

### 5.1 Permissions (the compliance-critical flow — Play rejects apps that
fumble this)

Foreground-only first: start a run → `ACCESS_FINE_LOCATION` request with
one prior in-app screen stating exactly why. Background is asked **only**
when the user enables "keep tracking with screen off" — preceded by Play's
required **prominent disclosure** screen (our copy: "AI Home Gym collects
location data to record your running route even when the screen is off or
the app is closed. Routes are private to you — never shared with your gym
or anyone else."), then the OS "Allow all the time" step. iOS mirrors:
WhenInUse → Always upgrade with
`NSLocationAlwaysAndWhenInUseUsageDescription` in the same words. **Play's
background-location review** requires a screen-recording of this exact
flow + a policy declaration — deliverable in §12, prepared before
submission, not after rejection.

### 5.2 Tracking mechanics

expo-location + TaskManager background task · accuracy High,
`distanceInterval: 5 m` / `timeInterval: 3 s` · **Android foreground
service** with persistent notification (pause/stop actions) and
`foregroundServiceType: 'location'` declared (Android 14 requirement) ·
auto-pause when speed < 0.7 m/s for 30 s (resume on movement) · GPS-loss:
keep timing, flag the gap, straight-line the *display* only — distance
uses measured points, honesty per Trust doctrine (no invented meters).

### 5.3 Data & save

Points stream to `local_runs.points` (crash-safe: a killed app recovers
the partial run on next launch and offers save/discard) → on stop:
polyline-encode, splits computed on device (port of `scoring.py`, v1 §12),
**pace-based MET** kcal (running rows from the Compendium keyed by avg
pace; provisional on device, server recompute at sync stamps
`kcal_calc_version` — the Part 2B pattern, third use) → route name via
server geo cache at sync (cached reverse-geocode; does **not** consume the
`route_gen` quota — that quota is the planner's). Battery target ≤ 8 %/30
min tracked.

### 5.4 Planner & privacy

Route planner (ORS loop generation) is the `route_gen`-quota'd feature,
cached per v1 §6.1. Privacy: GPS data is org-invisible (Part 4 §3.9), and
**share cards trim 200 m from both route ends** by default — the map thumb
shows your run, not your front door.

---

## 6. Push notifications

expo-notifications → token → `POST /v1/push-tokens` (Part 4 table).
Android channels: `workout-reminders`, `streaks`, `org`, `billing`
(user-mutable in OS settings — respect it, don't re-ask). All
send-decisions, caps, and quiet hours are **server-side** (v1 §15); the
app only renders and deep-links (`aihg://workout/...`,
`aihg://org/join?code=`). Notification taps land logged-in or route
through auth first — deep links never dead-end on a login wall.

## 7. IAP (RevenueCat — mechanics; policy already in Part 5)

Configure RC with **our user UUID** at login (Part 5 §4.3 — deterministic
restores/transfers) · entitlement id `pro` · paywall placements:
locked-exercise tap, metered-quota hit, Progress-history gate — each
records `paywall_viewed{trigger}` (Part 5 §13) · Restore Purchases on
login + paywall · the §5.4 cross-channel guards verbatim (web-Pro hides
purchase; IAP-Pro shows "managed in your app store" on web) · sandbox test
list: purchase, renewal (accelerated), billing-issue grace, cancel,
restore on second device, PRODUCT_CHANGE m↔y — each asserting our
`subscriptions` row lands correctly via the RC webhook, because the app
never writes entitlements (Part 5 §10).

## 8. Auth on mobile

Refresh token in **SecureStore** (Keychain/Keystore), access token in
memory only · Google Sign-In via `@react-native-google-signin` (dev-client
native module) → ID token → existing `auth_identities` exchange — same
table, same backend path as web (Part 4 §3.1) · session revocation honored
(401 + refresh-family reuse → local logout everywhere) · optional
biometric app-lock deferred to a fast-follow (flagged, not built).

## 9. Assets (the 58-demo problem)

Bundling 58 GIFs would be a 150+ MB app — instead: **convert once** GIF →
MP4 (H.264) + WebP poster (~80–90 % smaller), upload to R2 `app-assets/`
behind Cloudflare CDN with immutable cache headers → app bundles only T1
posters (~1 MB) and streams the rest with expo-image/av caching. Library
works offline for anything ever viewed; never for never-viewed T3 videos —
acceptable and stated. The conversion script lives in `infra/` and runs in
CI when assets change.
---

## 10. Observability

Sentry RN with EAS source maps, every event tagged `{engineVersion,
bundleVersion, deviceModel, poseTier: full|lite|logonly}` · performance
transactions on pose sessions (delivered Hz, dropped frames, degradation
events) · PostHog RN mirroring the v1 §16 taxonomy + mobile-only events
(`pose_degraded{step}`, `offline_workout`, `sync_delivered{age_s}`,
`bg_location_granted`) · a hidden **Diagnostics screen** (7 taps on

version): delivered Hz live, model tier, bundle version, queue depth, last
sync, and **"run device parity check"** — replays the bundled squat golden
trace through the installed engine and asserts rep/fault equality (the
Part 2 harness, shipped in the app; when a gym owner's phone "counts
wrong," this button answers *engine or camera?* in 30 seconds).

## 11. EAS pipeline & release trains

`runtimeVersion: { policy: 'fingerprint' }` — OTA updates apply only to
compatible native builds, mechanically (the classic OTA-crash footgun
deleted by config) · channels: `preview` (pilot gym testers) and
`production`, mapped per build profile · **release trains:** JS-only
changes ship OTA weekly (definitions already bypass releases entirely via
the bundle — Part 2's design doing its job); native changes batch into a
monthly store release; store submits via `eas submit` both platforms ·
versioning `1.x.y` app / build numbers auto-incremented by EAS · rollout:
Android staged 10 % → 50 % → 100 % with a 24 h Sentry-crash gate between
steps; halt = one dashboard toggle.

## 12. Store listings, privacy labels & review-proofing (what on-device
processing has earned)

**The two sentences that define the listing (and are architecturally
true):** *"Your camera is processed entirely on your phone — workout video
never leaves your device."* and *"Meal photos are analyzed and immediately
discarded — never stored."*

**Google Play Data Safety (exact rows):** Location (precise) — collected,
not shared, optional, users can delete · Photos — collected (meal photos
are transmitted for analysis), **ephemeral processing**, not stored, not
shared · Health & fitness (workout activity) — collected, not shared,
deletable · Personal info (name, email) — collected, account ·
**Camera/pose video — NOT declared as collected, because it never leaves
the device** (on-device processing is exempt; this row's absence *is* the
selling point) · No data sold; no ads; encrypted in transit; deletion
available in-app (Part 4 §5.2).
**Apple privacy nutrition label:** Health & Fitness, Contact Info,
Location — linked to identity, App Functionality only · Photos — App
Functionality, not linked beyond the meal log it creates · **Tracking:
none → no ATT prompt.**

**Permission strings (same words both platforms, honesty doctrine):**
Camera — "AI Home Gym checks your exercise form on your device. Video
never leaves your phone." · Location Always — the §5.1 disclosure copy ·
Notifications — standard.
**Review-proofing checklist:** background-location screen-recording +
policy declaration (§5.1) ready **at first submission** · Android 14
FGS-type declaration · demo account with seeded data for reviewers ·
health-content disclaimer ("general fitness guidance, not medical advice")
in listing + onboarding — doubly load-bearing given the clinic segment's
positioning boundary (Part 2B §7) · age rating: no restricted content; IAP
declared · target API level current.

## 13. Testing

Layered exactly like the rest of the system: **engine** — untouched, Node
golden traces already gate it (Part 2 §7) · **device parity** — §10's
on-device trace replay, run in CI on one real device via EAS + Maestro
cloud lane, and manually on the §3.5 trio before any store release · **E2E
(Maestro)** — flows: signup→first workout offline→airplane-off→sync
verified server-side · join-by-code + visibility sheet · paywall→sandbox
purchase→entitlement flip · run with backgrounding→save→route named ·
degradation ladder forced via debug flag · **sync engine** — unit-tested
with a mock network: dedupe on 409, backoff schedule, park-on-4xx,
crash-recovery of a partial run · **beta ramp** — internal (you) →
`preview` channel to the pilot gym's members (v1 Phase 5's closed Android
test) with the §10 diagnostics screen as your remote eyes.

## 14. Build sequence (Phase 5, weeks 10–14 — expanded to working
granularity)

**W10:** dev-client stands up (§1) · spike days 1–2 (§3.2) with decision
record · Benchmark screen kept as the Diagnostics seed. **W11:**
ActiveWorkout on-device (camera→engine→overlay→voice) · SQLite layer +
write path · auth + SecureStore. **W12:** sync engine + reconciliation ·
library/progress/coach/nutrition screens on shared client · bundle caching
· barcode scan. **W13:** Running end-to-end (§5, permissions flow filmed
for Play) · push · RC paywall + sandbox suite. **W14:** asset pipeline ·
store listings/labels/review pack (§12) · Maestro flows green · `preview`
build to pilot-gym testers · staged production rollout begins.

**Acceptance (v1 Phase 5 line, now fully expanded):** a member on the
₹10–12k device completes a **full offline workout at ≥ 20 Hz pose**,
thermally stable for 20 minutes, and it syncs cleanly later
(409-idempotent) · the three    ✅ exercises pass the on-device parity check
byte-for-byte with web · a real outdoor run records through screen-off,
survives an app kill, saves with splits + cached route name, and never
appears to any org · sandbox IAP flips `subscriptions` via webhook with
both cross-channel guards proven · background-location review pack
accepted by Play on first submission · crash-free sessions ≥ 99.5 % across
the beta week.

## 15. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Pose perf on low-end Android | §3.6 ladder + log-only floor; support
floor is telemetry-driven, not hoped |
| `react-native-mediapipe` maintenance risk (community wrapper) | adapter
isolates it (PoseProvider interface); fallback candidates pre-ordered
§0.2; worst case = own thin native module over MediaPipe Tasks (bounded,
documented) |
| Play background-location rejection | §5.1 disclosure + §12 review pack
prepared pre-submission; feature degrades to screen-on tracking if ever
forced |
| OTA/native mismatch crashes | fingerprint runtimeVersion (§11) makes the
mismatch impossible to ship |
| GIF/app-size bloat | §9 pipeline; app stays < 60 MB installed |
| Two-store release overhead (solo dev) | Android-first (§0.3); iOS rides
the same EAS pipeline when Android is proven |

---

*— End of Part 6. Queue: **Part 7 — Retention & Growth Playbook** (exact
mechanics, triggers, and copy for the v1 §21 set: Form Score™, streak
freezes, TV-mode leagues, WhatsApp share cards, referral, programs, recap
engine) · Part 8 — Ops runbook.*
