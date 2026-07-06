<!--
Part 2 v2.1 — Form Engine & Exercise Definition System (keystone)
Extracted from aihomegym.pdf (pdftotext). Hard line-wraps and occasional
table/DDL wrapping are extraction artifacts, not content changes. When an
exact value (price, threshold, SQL) looks garbled, verify against the PDF.
This file is spec — BINDING. Do not modify; record deviations in DECISIONS.md.
-->

# AI Home Gym — Part 2: The Form Engine & Exercise Definition System (EDS)

**Full engineering specification · v2.1 · follows Architecture v1 (§5, §22
Phase 1, §23 Part 2)**
**Audience:** Kd (solo developer, owner)
**Status:** This is the keystone spec. Every later deliverable — the
mobile app, all remaining exercises, offline mode, anti-cheat, and the gym
demo — depends on what is defined here. It is written to be followed
without needing the v1 doc open, but it never contradicts v1.

**Changelog v2.1** (evidence-verified reconciliation): catalog corrected
to the definitive **58 exercises** from `scripts/seed_exercises.py` —
media-alias ghosts removed (`soldierpress`, `hamstring` were Shoulder
Press / Hamstring Stretch media, confirmed by decoding GIF frames), five
genuinely missing entries added (Warrior II, Bridge Pose, Arm Circles,
Mountain Pose, Brisk Walking), `tracking: "pose"|"timer"` field added to
the schema, Appendix B converted to a resolved evidence log, §9.1 gains
the formal video-derived threshold protocol, §8.2 gains the dead-ONNX
cleanup item. Companion document: **Part 2B — The Trust Layer** (calories,
meal-photo portions, recommendations, predictions).

---

## 0. What this document locks in place

Architecture v1 made two decisions this document now specifies completely:

**D1** — all pose analysis runs on-device (browser and phone), inside one
shared, pure TypeScript package `@app/engine`. The server never sees
keypoints during a workout; it receives only compact set summaries.

**D2** — exercises are data, not code. One generic engine interprets
declarative Exercise Definitions. Shipping exercise #14 or #59 is
publishing a config, not writing a Python function or deploying anything.

I have verified this spec line-by-line against your actual code. Every
threshold your squat, jump-squat and chair-squat analyzers use today
(`form_analyzer.py`, `angles.py`, `rep_counter.py`, the
`_StandingCalibration` and chair-depth calibration in `pose_ws.py`)
appears in this document explicitly, mapped to the field of the new system
that carries it. **Nothing you validated with real footage is lost or

changed — it is translated.** Where this spec proposes numbers for the 50+
exercises that don't exist yet, they are clearly marked *starting values,
to be tuned via recorded traces* — never presented as validated.

One correction to v1 while we're here (small, but you should rotate these
too): beyond the secrets v1 listed, the archive also contains real values
for `VITE_LOCATIONIQ_KEY` (this one ships **inside the public browser
bundle** — anyone can read it from your JS today), `RAPIDAPI_KEY`, and
`USDA_API_KEY`. Rotate all three along with the rest, and move geocoding
behind the server `geo` module exactly as v1 §6.1 already plans.

---

## 1. Scope, non-goals, and the six invariants

### 1.1 In scope

The engine package (`packages/engine`), its input/output contracts, the
eight-stage per-frame pipeline, the signal library, the calibration
modules, the rep and hold state machines, the fault DSL, the scoring
model, the Exercise Definition JSON schema, the 12 family templates, the
complete mapping of your real catalog onto those templates, the
golden-trace test harness, the Python→TypeScript parity protocol, and the
authoring/publishing workflow that gets you from 3 exercises to 59.

### 1.2 Non-goals

No UI specification (the existing `ActiveWorkout` surface survives; it
consumes engine events). No ML classifiers — the CTR-GCN/ST-GCN/YOLO work
stays parked in `ml-training/` as a research track exactly as v1 §1.3
ruled; the rule engine is the product. No server code — the sync
endpoint's contract is restated here only so the engine's output is
unambiguous.

### 1.3 The six invariants (violating any of these is a build failure, not
a style issue)

**I1 — Purity.** `@app/engine` imports nothing platform-specific: no DOM,
no React, no React Native, no Node APIs, no timers, no `Date.now()`. Time

enters only through frame timestamps. This is what lets the identical code
run in the browser, in Hermes on a phone, and in the Node test runner.

**I2 — Determinism.** Same frame sequence in → same events out,
bit-for-bit, on every platform, every run. No randomness, no wall-clock
reads, no locale-dependent formatting. Determinism is what makes golden
traces (§7) and server-side replay audits (v1 §14) possible at all.

**I3 — One canonical skeleton.** The engine consumes exactly the BlazePose
33-landmark layout, on every platform. If a future mobile pose provider
emits a different layout, the *adapter* converts it before the engine ever
sees it; the engine never branches on platform.

**I4 — Versioned everything.** Every session records `engineVersion`
(semver of the package) and `defsVersion` (bundle number) — both already
appear in the v1 §5.3 sync payload. A definition declares
`minEngineVersion`; a client whose engine is older simply doesn't offer
that exercise. No silent behavioral drift, ever.

**I5 — Performance budget.** Per-frame evaluation (stages 2–8, i.e.
everything after pose inference itself) must run in **≤ 3 ms p95 on a
mid-range Android (₹12k class)** and allocate no growing memory across a
30-minute session. Pose inference (MediaPipe/BlazePose) is outside this
budget — it dominates and is the pose provider's cost. The budget is
enforced by a benchmark test in CI (§7.6), not by hope.

**I6 — Fail soft, never silently wrong.** Missing landmarks, NaN, dropped
frames, fps collapse — every degraded input maps to a defined behavior in
this spec (usually: hold state, don't count, surface a visibility hint).
An exception escaping the engine is a P0 bug; an incorrectly counted rep
because inputs were garbage is also a bug. The correct response to garbage
is *no decision*, exactly the principle your current `RepCounter.update()`
already applies when the angle is `None`.

---

## 2. Canonical data contracts

### 2.1 `PoseFrame` — the engine's only input during a set

One frame from the pose provider:

```jsonc
{
    "t": 123456.7,          // monotonic ms since session start (float). NOT
wall-clock.
    "kp": [ [x, y, z, vis], /* × 33 */ ]
}
```

Landmark semantics (identical to what MediaPipe Tasks gives you today, and
what your `KP` map in `angles.py` indexes):

| Field | Range / convention |
|---|---|
| `x`, `y` | Normalized image coordinates in [0, 1]. Origin top-left, **y
increases downward** (your elevation code already depends on this: "risen
above standing" = y decreased). |
| `z` | BlazePose relative depth, roughly hip-origin, same scale as x.
Used sparingly (§3.4) — it is the noisiest channel. |
| `vis` | Visibility/presence score [0, 1]. The engine's visibility gate
(§3.2) uses your existing threshold of **0.3**. |
| Index layout | BlazePose 33: 0 nose … 11/12 shoulders, 13/14 elbows,
15/16 wrists, 23/24 hips, 25/26 knees, 27/28 ankles, 29/30 heels, 31/32
foot index. The engine ships this index map as a frozen constant; it is
the same table your `angles.py` `KP` dict encodes. |

Frame-rate contract: the engine accepts **8–40 fps** and adapts (all
temporal logic below is specified in milliseconds, then converted to
frames using measured inter-frame deltas — never hardcoded frame counts at
an assumed fps). The target remains ~15 fps analysis / ~30 fps overlay,
exactly your current web throttling; those numbers now live in the *pose
provider adapters*, not in the engine.

### 2.2 Mirroring and left/right policy (this bites every camera app — pin
it now)

- "left_*" always means the **person's anatomical left**, which is
MediaPipe's convention. It usually appears on the *right side of the
image* for a front-facing camera.

- Front cameras typically render a mirrored *preview*. The rule: **mirror
only the drawn overlay, never the coordinates.** The engine always
receives un-mirrored provider coordinates. (Your current pipeline already
behaves this way implicitly; making it a stated rule prevents the classic
mobile bug where someone mirrors the landmark array to "fix" the overlay
and silently flips every left/right and valgus sign.)
- Signals that live in image-space (valgus x-positions) keep your
documented convention: signs are in image space, and the
*baseline-relative delta* is what carries meaning — which is precisely why
your `standing_baseline` calibration design is correct and survives
unchanged.

### 2.3 Session inputs

A session is created with: the resolved **ExerciseDefinition** (already
parsed and lint-validated, §4), optional **carry-over calibration** from a
previous set of the same exercise in the same workout (so set 2 doesn't
recalibrate — your `active_sessions` reconnect-persistence behavior,
reproduced locally), and an optional **user profile hint** block
(reserved: height, mobility limitations — v2 territory, ignored by engine
v1).

### 2.4 Outputs — three event levels plus one document

**FrameResult** (every analyzed frame; feeds the overlay and live UI):
`phase`, `repCount`, `isActive`, `view`, `visibilityOk`, `liveCue`
(nullable message key), `signals` (the small set the definition declares,
for debug/telemetry overlays), `calibrationState` (`pending | ready`).

**RepEvent** (at the moment a rep is credited): `repIndex`, `score`
(0–100), `faults` (array of fault ids observed in that rep cycle),
`durationMs`, `phaseTimings` (ms in descent/bottom/ascent), `romExtreme`
(e.g. min knee angle reached), `view`.

**HoldTick / HoldEvent** (isometric family only): accumulated qualifying
ms, in-band or out-of-band, ended-hold summary.

**SetSummary** (at set end — this is *the only thing that leaves the
device*, byte-compatible with v1 §5.3):

```jsonc
{
    "exercise": "squat", "setIndex": 1, "reps": 12, "durationMs": 48000,
    "avgFormScore": 84, "repScores": [90, 88, 76, ...],
    "faultCounts": { "shallow_depth": 2, "knee_valgus": 1 },
    "tempoMsAvg": 3900,
    "romStats": { "metricMinAvg": 96 },
    "view": "side",
    "holdMs": null,                       // isometrics: qualifying hold time
    "calibration": { "usedStandingBaseline": true, "chairDepthTarget": null
},
    "engineVersion": "1.0.0", "definitionVersion": 5
}
```

Design note: per-rep scores stay as a small array inside the set (matches
v1 §7.1's "no billion-row rep_events table"); everything a screen or a gym
report needs is derivable from SetSummary.

---

## 3. The pipeline — eight stages, fully specified

Order per frame: **ingest → condition → view → signals → calibration → FSM
→ faults → score/emit.** Each stage below states its algorithm, its
parameters with defaults, and its failure behavior. Parameters marked ⚙
are overridable per-definition; everything else is engine-global.

### 3.1 Ingest & validation

Port of your `_valid_keypoints` verbatim: exactly 33 entries, each with ≥4
finite numbers (NaN check `v !== v`). Additionally: `t` must be finite and
strictly greater than the previous frame's `t` (out-of-order frames are
dropped, counted in a session diagnostic). An invalid frame is **dropped
silently** — state holds, nothing counts, no event. Three consecutive
invalid frames flip `visibilityOk=false` on FrameResult so the UI can show
"step back into frame" (your existing "cannot see your legs clearly"
behavior, generalized).

### 3.2 Conditioning: smoothing + visibility gating

- **Angle smoothing:** rolling mean over a **7-frame window** — your
`RepCounter.angle_buffer` value, kept. Implemented as a per-signal ring
buffer; window is time-aware (falls back to fewer samples at low fps
rather than stretching latency).
- **Two smoothing channels, deliberately:** FSM/fault evaluation reads
*smoothed* signals; the **elevation signals used for airborne detection
read raw** values with only a 3-frame spike filter. Reason: a 7-frame mean
at 15 fps is ~470 ms of lag, and a jump-squat flight phase is often
300–500 ms — heavy smoothing would erase the very event you're detecting.
Your current server code effectively gets away with this because elevation
is computed per-frame from geometry; the engine makes the raw-path
explicit so nobody "optimizes" it away later.
- **Visibility gating with hysteresis:** a landmark is *usable* when `vis
≥ 0.30` (your threshold) and becomes *unusable* only when `vis < 0.15` —
the 0.15 gap stops flicker at the boundary from toggling signals on/off
every frame. A signal whose required landmarks are unusable returns `null`
for the frame; consumers of `null` follow §3.6's no-decision rule.

### 3.3 View classifier

Direct port of your `detect_view` — it is measured against labeled clips
and the clusters don't overlap, so it stays:

- Reference height = |ankle_y − shoulder_y| (distance-invariant
normalizer).
- `shoulder_width_norm` and `hip_width_norm` = x-spans divided by that
height.
- **side** if both < 0.15 · **front** if shoulder > 0.20 or hip > 0.15 ·
else **unknown**. Requires shoulders, hips, one ankle visible; otherwise
**unknown**.

Two engine-level additions:

1. **Hysteresis:** the reported view changes only after the new
classification persists **10 consecutive frames** (~0.7 s at 15 fps).
Prevents mid-rep view flapping when someone rotates slightly, which would
otherwise toggle view-scoped faults (valgus) on and off within one rep.
2. **View policy per definition** (⚙): `views: ["front","side"]` plus
`preferredView` and `requireView` flags. If a definition *requires* a view

(e.g. valgus coaching genuinely needs front), the UI gets a `liveCue:
"cue.turn_to_front"` instead of silently skipping checks. `quarter` (~45°)
is not a v1 output class — your measured clusters are binary + unknown; a
quarter stance lands in `unknown` and simply gets the view-agnostic
checks, which is safe. (Recorded as a v1.1 candidate, not scope creep
now.)

### 3.4 Signal library v1

A *signal* is a named, typed, per-frame scalar with a declared formula,
view validity, smoothing channel, and calibration dependency. Definitions
declare which signals they need; the engine computes **only those** (perf
budget I5). The v1 library — 22 signals — covers every exercise in §6.
Formulas are exact where ported from your code.

| # | Signal | Formula / source | Valid views | Needs calibration | Notes
|
|---|---|---|---|---|---|
| 1–6 | `knee_L/R`, `hip_L/R`, `elbow_L/R` | Interior angle at joint via
your 3-point `calculate_angle` (arccos of normalized dot product, degrees)
| any | — | The workhorses. `hip` = shoulder–hip–knee. |
| 7–8 | `shoulder_L/R` | Interior angle elbow–shoulder–hip | any | — |
Drives raises, presses, jacks. |
| 9 | `knee_avg` | Mean of visible knee angles (1 or 2) | any | — | Your
`_analyze_squat` uses exactly this. |
| 10 | `trunk_incline` | Angle of shoulder→hip vector from vertical,
degrees; prefers left pair, falls back right — your
`incline_from_vertical` | any (best side) | — | 0 = upright. |
| 11 | `shin_incline` | Knee→ankle vector from vertical, same helper |
side | — | Used in *relative* lean checks (trunk vs shin). |
| 12–13 | `valgus_L/R` | `(knee_x − ankle_x) / hip_width` — your
validated-notebook formula, image-space sign | front | — | Raw stance
value. |
| 14–15 | `valgus_delta_L/R` | Raw minus **standing-baseline** value |
front | standing_baseline | Negative = inward drift. The only valgus
numbers rules may reference. |
| 16 | `hip_elevation` | `(baseline_hip_y − hip_y) / torso_height`, **raw
channel** | any | standing_baseline | Positive = airborne rising. Your
jump-squat signal, normalized exactly as captured by
`_StandingCalibration`. |

| 17 | `ankle_elevation` | Same construction on ankles, raw channel | any
| standing_baseline | Confirms true flight (both feet leave). |
| 18 | `body_line` | Angle at hip between shoulder→hip and hip→ankle
vectors; 180 = straight body | side | — | Plank/push-up sag-or-pike. Your
current plank rule (`left_hip` 160–180) is this signal by another name. |
| 19 | `elbow_under_shoulder` | \|elbow_x − shoulder_x\| / torso_height |
side | — | Plank stacking cue. |
| 20 | `cadence` | Cycle events per minute from the FSM (§3.6 cadence
mode) | any | — | Derived, not geometric. |
| 21 | `stillness` | Windowed (700 ms) mean displacement of hip+shoulder
midpoints, torso-normalized | any | — | Hold quality for
isometrics/stretch holds; also the "person is set up and ready" detector.
|
| 22 | `symmetry_knee` / `symmetry_elbow` | \|L − R\| of the smoothed
pair, degrees | front | — | Uneven press/curl/squat cue; only evaluated
when both sides usable. |

Reliability annotations ship with the library (and drive the risk notes in
§6): `z` is used by **no** v1 signal (too noisy — rotation-type exercises
are handled via x-span oscillation instead, see russian twist in §6);
prone/supine poses (superman, cobra, bridges) reduce landmark confidence,
so their definitions require the side view and lean on hip/knee/shoulder
angles that survive it.

Adding a signal later = adding one pure function + its row here + trace
coverage. Signals are versioned with the engine (I4), not with
definitions.

### 3.5 Calibration modules

Calibration exists so checks are *relative to this person's own body and
setup* rather than absolute cutoffs — the single smartest property of your
current squat system, generalized. Three modules in v1:

**C1 `standing_baseline` — port, unchanged semantics.** Arms automatically
when smoothed knee ≥ **160°** (`STANDING_KNEE_MIN`); captures after **8
consecutive** qualifying frames; buffers reset on any non-qualifying frame
— your exact `_StandingCalibration` state machine. Captures: `valgus_L/R`
baselines (front view), `hip_y`, `ankle_y`, `shoulder_y`, and
`torso_height = |shoulder_y − hip_y|`. Lifetime: the exercise session;

**carried across sets** of the same exercise in the same workout (§2.3),
matching today's reconnect-surviving server sessions. Invalidations that
force re-capture: view flips front↔side, or subject-lost for > 3 s (the
person who walks back into frame may be standing elsewhere).

**C2 `adaptive_target` — port of chair-depth calibration.** Observes the
metric extreme (min knee angle) across the **first 2 completed reps**,
sets `session_target` = mean of those extremes, clamped to a
definition-declared range (⚙ chair squat: clamp [80°, 120°], fallback
**100°** = your `CHAIR_FALLBACK_TARGET`). Until it fires, scoring uses the
fallback — precisely today's early-rep behavior. Declared generically so
any "target-depth, not max-depth" exercise (step-up height, wall-sit
angle) can reuse it.

**C3 `floor_reference` — new, tiny.** For supine/prone starts (glute
bridge, superman, leg raises): captures resting `hip_y` / `shoulder_y`
during the first **1 s of stillness** (signal 21 below threshold). Gives
bridges and leg raises the same "relative to your own setup" quality —
camera height and mat position stop mattering.

UI contract: `calibrationState: "pending"` on FrameResult until required
modules are ready; the UI shows the "stand still facing the camera" beat
your users already experience implicitly. Faults that depend on an unready
calibration are **not evaluated** (no decision on missing data, I6) —
depth and rep counting still work, exactly as today.

### 3.6 Rep & hold state machines

One generic FSM, four modes (⚙ `rep.mode`). All modes share the
anti-garbage guards, which are straight ports of your `RepCounter`
hardening:

- Null metric this frame → **hold state, count nothing, mark
`isActive:false`** (your None-angle rule).
- Debounce: state must persist **≥ 3 frames down / ≥ 2 frames up**
(time-normalized at low fps).
- **Minimum rep interval 450 ms** engine-wide, and per-definition
`minRepMs` / `maxRepMs` (⚙) on top — the same numbers the server later
uses for plausibility validation (v1 §14), so honest clients can't trip
anti-cheat.

- **Bilateral gate** (⚙, on by default for two-leg knee metrics): the
*other* knee must be ≤ **150°** when both are visible — your
one-legged-phantom-squat rejector, kept, including its
fall-back-to-single-knee-when-occluded behavior.

**Mode A — `alternating_threshold`** (squats, push-ups, curls, presses…).
Metric + `upAt`/`downAt` hysteresis + `countOn: "up" | "down"`. Phase
model derived for free: `top` (≥ upAt), `descent` (falling between),
`bottom` (rising-edge of local minimum, captured as the ROM-extreme
event), `ascent`. Faults may scope to phases; "at bottom" faults evaluate
once per rep at the captured extreme (this is how depth scoring becomes
per-rep instead of per-frame noise).

**Mode B — `hold`** (plank, wall sit, side plank, stretch holds). Enter
qualifying hold when metric inside `holdBand` **and** `stillness` below
threshold for `enterMs` (default 700 ms); accumulate qualifying ms; exit
when out-of-band for `exitMs` (default 500 ms — brief wobbles don't reset
a plank, which is today's biggest hold-UX complaint pattern in every
competitor). Emits HoldTicks (UI timer) and per-hold summaries. "Reps" for
isometrics = number of qualifying holds; the headline number is `holdMs`.

**Mode C — `alternating_sides`** (lunges, Bulgarian split squat, step-ups,
cycling crunch). Two Mode-A sub-machines, one per side; frame routes to
the side whose metric is *more flexed*; total = L + R with per-side counts
kept (the UI can show 6+6). A side-switch mid-descent voids that partial
rep (no double-count exploit, no confusion when someone alternates legs
freely).

**Mode D — `cadence`** (jumping jacks, high knees, mountain climbers,
skipping…). Counts *cycles* of a periodic signal: rising-edge crossings of
the signal's own rolling midline, accepted only when peak-to-trough
amplitude ≥ `minAmplitude` (⚙) and instantaneous cadence within
`[minCadence, maxCadence]` (⚙). Robust to the ROM sloppiness that's
*normal* in conditioning moves, and cheap. Reports cadence (signal 20) for
pace cues.

### 3.7 Fault rules — the DSL

A fault rule is data. Full shape:

```jsonc
{
    "id": "knee_valgus",
    "view": "front",                    // optional; omit = any view
    "phase": ["descent", "ascent"],     // optional; omit = any phase
    "when":   "valgus_delta_min < -0.15",// condition (grammar below)
    "sustainMs": 0,                     // condition must hold this long (0
= instant)
    "perRep": true,                     // fire at most once per rep cycle
    "severity": 20,                     // score deduction weight (§3.8)
    "severe": "valgus_delta_min < -0.30", // optional: forces rep
'incorrect' regardless of score
    "msg": "fault.squat.valgus",        // message key — localization &
voice for free
    "cueCooldownMs": 4000               // don't re-speak/re-show within
this window
}
```

**Condition grammar** (kept deliberately small — every operator below is
required by some exercise in §6, and nothing else is included):
comparisons `< <= > >= ==` between a signal reference and a number;
boolean `&&`, `||`, parentheses; signal refs may take per-rep aggregates
`_min`, `_max`, `_avg` (evaluated at rep completion, e.g. `knee_avg_min >
130` = your shallow-depth check) or calibration refs (`target`, from C2,
e.g. `knee_avg_min > target + 25` = your chair shallow-margin check).
That's the whole grammar. It is parsed **once at definition load** into an
expression tree — zero per-frame parsing (I5). The linter (§9.2) rejects
unknown signals, view-invalid signals (valgus in a side-only definition),
and unsatisfiable ranges at authoring time, not at runtime in a gym.

**Runtime semantics.** Frame-scoped rules evaluate on smoothed signals
each frame within their phase/view scope, honoring `sustainMs` (a lean
must persist ~300 ms to fault — single-frame noise never speaks).
Rep-scoped rules (`_min/_max/_avg`, `perRep`) evaluate exactly once at rep
completion. Fired faults join the current rep's fault set; `severe`
conditions additionally mark the rep incorrect — the generalization of
your `severe_faults` list (trunk > 60° and valgus < −0.30 both port as
`severe` expressions).

**Coaching output policy — port of your best UX decision.** At most **2
corrections** surfaced at a time, deduplicated, ordered by severity —
exactly your `deduped[:2]`. Voice gets only the single worst, throttled by
`cueCooldownMs`. Message *keys*, not strings: the engine emits
`fault.squat.depth`; the client's locale table renders
English/Hindi/Assamese text and TTS. Appendix A seeds the key catalog from
your current correction strings so nothing regresses.

### 3.8 Scoring

Two-layer model that reproduces your squat scorer exactly and generalizes
it:

**Layer 1 — component curves.** A definition declares scoring components,
each mapping a signal (or rep-aggregate) through a **piecewise-linear band
curve** — the declarative form of your `_score_depth` /
`_score_trunk_lean` / `_score_valgus` functions. Example, squat depth,
which is *numerically identical* to `_score_depth`:

```jsonc
{ "component": "depth", "input": "knee_avg_min",
 "curve": [ [100, 100], [130, 30], [155, 0] ],     // ≤100°→100 pts …
≥155°→component inactive
 "inactiveAbove": 155 }                               // standing = no depth
opinion (your None)
```

Trunk lean ports as `[[45,100],[75,0]]` (100 down to 0 across your 30°
falloff); valgus as a curve on `|valgus_delta_min|`:
`[[0.15,100],[0.30,0]]`, inactive for outward drift. Chair depth uses C2's
`target`: full credit ≤ `target+10`, linear to 40 at `target+25`, then
your low-credit tail — the three chair constants (`TOLERANCE 10`,
`SHALLOW_MARGIN 25`, standing cutoff 155) become curve parameters.

**Layer 2 — aggregation.** Per-rep score = **mean of active components**
(your rule), **80 neutral** when none are active (your
standing-between-reps rule), floored at a definition `floor` (default 0;
squat keeps behavior via curves). `formCorrect` per rep = score ≥ **70**
and no `severe` fault — verbatim. Set `avgFormScore` = mean of rep scores.
Session **Form Score™** (the v1 §21 retention anchor) = exposure-weighted

mean across the workout — computed by the engine so web, mobile, and the
server's audit replays can never disagree about the headline number.

Isometrics score differently (they have no reps): hold score = `% of hold
time in-band` (0–100) with a stillness bonus band (up to +10, capped 100);
definition declares the band. Wall-sit example in §6.

### 3.9 Emission & the set lifecycle

`startSet(definition, carryOverCalibration?) → feedFrame(PoseFrame) →
endSet() : SetSummary`. `endSet` is idempotent; an abandoned set (app
killed) is reconstructed from the last emitted RepEvents by the client
shell — the engine additionally exposes `snapshot()` (plain-JSON state)
every 5 s to the shell for exactly this, replacing the server-side session
store's crash-resilience role.

---

## 4. The Exercise Definition schema

Field-by-field. One definition = one exercise = one JSON document,
validated by the linter (§9.2) before it can be published. (Schema
formalized as JSON-Schema/Zod in `packages/shared` — the table below is
the human contract.)

| Field | Type / constraints | Meaning |
|---|---|---|
| `key` | slug, unique, immutable | e.g. `chair_squat`. Aliases list
absorbs your existing plural keys (`chair_squats`) so old clients/URLs
keep working. |
| `version` | int, monotonic | Bumped on any behavioral change. Appears in
every SetSummary. |
| `minEngineVersion` | semver | Client gate (I4). |
| `family` | enum of §5 | Template this definition instantiates. |
| `name`, `muscles`, `equipment`, `difficulty`, `mediaRef` | catalog
metadata | Carried for the library UI; not read by the engine. |
| `views` | array: front/side | Allowed views. |
| `preferredView`, `requireView` | slug / bool | §3.3 policy;
`requireView` triggers the turn-cue. |

| `calibration` | array of C1/C2/C3 refs + params | e.g. `[{ "module":
"adaptive_target", "clamp": [80,120], "fallback": 100, "observeReps": 2
}]`. |
| `signals` | array of §3.4 names | Everything the engine must compute.
Linter cross-checks every rule/curve reference against this list. |
| `rep` | object | `mode` (A–D §3.6) + mode params: `metric`, `upAt`,
`downAt`, `countOn`, `minRepMs`, `maxRepMs`, `bilateralGate`, `holdBand`,
`enterMs`, `exitMs`, `cadenceSignal`, `minAmplitude`, `minCadence`,
`maxCadence`, `perSide`. |
| `phases` | array | Names for Mode A phases (UI + fault scoping). |
| `faults` | array of §3.7 rules | The coaching brain. |
| `scoring` | object | Components with curves (§3.8), `floor`, `neutral`
(default 80), `correctAt` (default 70), isometric band if Mode B. |
| `setup` | object | Pre-set guidance: `cameraHint` key ("place phone
sideways, 3 m away, full body visible"), `positionCheck` (a boolean signal
condition that must hold before the set arms — e.g. body horizontal for
planks). Kills the #1 real-world failure mode: wrong camera placement. |
| `safety` | object | `contraindicationNote` key + `maxRecommendedReps`
(UI nudge only, never a hard block). |
| `status` | draft / beta / live | Publishing state (§9.3). |

**Worked example — `squat` v5, expressing today's Python behavior
exactly** (this is the parity target for §7.5; abbreviated to the
load-bearing parts):

```jsonc
{
    "key": "squat", "version": 5, "minEngineVersion": "1.0.0", "family":
"squat_pattern",
    "tracking": "pose",
    "views": ["front", "side"], "preferredView": "side", "requireView":
false,
    "calibration": [{ "module": "standing_baseline" }],
    "signals": ["knee_avg", "knee_L", "knee_R", "trunk_incline",
                  "valgus_delta_L", "valgus_delta_R"],
    "rep": { "mode": "alternating_threshold", "metric": "knee_avg",
             "upAt": 160, "downAt": 100, "countOn": "up",
             "minRepMs": 900, "maxRepMs": 12000, "bilateralGate": 150 },
    "phases": ["standing", "descent", "bottom", "ascent"],
    "faults": [

         { "id": "shallow_depth", "when": "knee_avg_min > 130", "perRep": true,
          "severity": 25, "msg": "fault.squat.depth" },
         { "id": "trunk_lean", "when": "trunk_incline > 45", "sustainMs": 300,
          "severe": "trunk_incline > 60", "severity": 20, "msg":
"fault.squat.lean" },
         { "id": "knee_valgus", "view": "front", "phase": ["descent","ascent"],
          "when": "valgus_delta_min < -0.15", "severe": "valgus_delta_min <
-0.30",
          "perRep": true, "severity": 20, "msg": "fault.squat.valgus" }
    ],
    "scoring": {
         "components": [
          { "component": "depth", "input": "knee_avg_min",
              "curve": [[100,100],[130,30],[155,0]], "inactiveAbove": 155 },
          { "component": "trunk", "input": "trunk_incline",
              "curve": [[45,100],[75,0]] },
          { "component": "valgus", "input": "abs(valgus_delta_min)", "view":
"front",
              "curve": [[0.15,100],[0.30,0]], "inactiveWhenPositiveDrift": true
}
         ],
         "neutral": 80, "correctAt": 70
    },
    "setup": { "cameraHint": "setup.squat.camera" },
    "status": "live"
}
```

**`tracking` (added v1.1):** `"pose" | "timer"`, default `"pose"`. Your
seed already contains one non-camera entry (Brisk Walking, `ai_supported:
false`), so the schema must represent it honestly rather than pretending
every catalog row is pose-tracked. `"timer"` entries carry no
`signals`/`fsm`/`faults`/`scoring` blocks — the linter *rejects* them if
present — and the app renders duration logging instead of the camera flow.
This is also the future home of GPS-tracked entries on mobile (`"gps"`
reserved, not implemented). One enum field now prevents a class of "why is
the camera opening for walking?" bugs later.

---

## 5. The 12 family templates

A template = a pre-filled definition (FSM mode, phase model, default fault
set, required signals, calibration, view policy) exposing a small
parameter surface. Authoring exercise #23 means picking its template and
filling parameters — hours, not weeks. v1 sketched ~11 families; building
the real mapping against your actual catalog (§6) refined that to **12** —
the deltas: bridges split from hinge (supine FSM + C3, not standing),
holds split from mobility (a plank and a hamstring stretch share an FSM
but not a fault philosophy), single-joint isolations unified
(curl/extension/raise/calf-raise are one template with the metric
swapped), and a dedicated cadence family for conditioning moves.

| # | Template | FSM mode | Default metric | Core default faults | Calib.
| Views |
|---|---|---|---|---|---|---|
| F1 | `squat_pattern` | A | `knee_avg` 160/100 | shallow depth, trunk
lean, valgus (front) | C1 | front+side |
| F2 | `hinge` | A | `trunk_incline` (hip-driven: down = incline rises
while knees stay > 140) | knees-bend-too-much (turns it into a squat), ROM
short, jerk (tempo min) | C1 | **side req.** |
| F3 | `bridge_supine` | A (inverted: countOn "up" = hips peak) |
`hip_elevation` vs C3 floor | incomplete lockout (hip angle < 160 at top),
feet drift, hold-at-top missing | C3 | side req. |
| F4 | `lunge_split` | C (per-side) | front `knee` 160/100 | front knee
past toe (shin incline > 25 side-view), torso lean, shallow back knee | C1
| side pref. |
| F5 | `push_horizontal` | A | `elbow_avg` 160/90 | half reps (elbow_min >
110), hip sag (body_line < 160), hip pike (> 195 equiv.), flared symmetry
| — | side req. |
| F6 | `push_vertical` | A | `elbow_avg` 160/90 | incomplete lockout,
asymmetric press (symmetry_elbow > 15), trunk lean-back > 20 | C1 | front
pref. |
| F7 | `pull` | A | `elbow_avg` 160/70 | partial ROM, kip (hip_elevation
oscillation), chin-short | C1 | front |
| F8 | `isolation_single_joint` | A | configured joint (elbow / shoulder /
heel-elev.) | partial ROM both ends, swing (trunk_incline oscillation >
10), speed | C1 for elevation variants | front/side per exercise |

| F9 | `core_dynamic` | A or C | `hip_avg` or knee-to-chest proxy | ROM
short, momentum (maxCadence), lower-back arch (body_line on leg raises) |
C3 | side req. |
| F10 | `hold_isometric` | B | exercise band (body_line 160–180 plank;
knee 80–100 wall-sit) | out-of-band (implicit), sag/pike cues, elbow
stacking | C1/C3 | side (plank), front (wall-sit ok) |
| F11 | `cadence_conditioning` | D | exercise periodic signal | amplitude
too small ("knees higher"), cadence out of band | C1 | front pref. |
| F12 | `mobility_hold_flow` | B (or D for cat-cow) | pose-specific band,
generous | none scored harshly — coaching tone is encouragement + hold
timer; score = hold time attained | — | per pose |

Template defaults are starting values; every concrete exercise tunes via
traces (§7). F12 deliberately has a different *product* posture: stretches
are guided-and-timed, not graded — grading a hamstring stretch's ROM
without knowing the user's history reads as punishment, and these are your
retention-friendly rest-day content (v1 §21 #14 territory).

---

## 6. The complete catalog mapping — every exercise, its template, its
starting parameters, its risks

Ground truth (verified, v1.1): the canonical catalog is
`scripts/seed_exercises.py`, which seeds **exactly 58 exercises** into
Mongo — matching your dashboard count. The earlier "57" was an artifact of
counting media *filenames*: several misspelled GIF basenames (`hillraise`
→ Heel Raises, `soldierpress2.gif` → Shoulder Press's second demo,
`hamstring2.gif` → Hamstring Stretch's second demo, `truckjump` → Tuck
Jumps) are media aliases inside `frontend/src/utils/exerciseMedia.js`, not
separate exercises — confirmed by decoding the GIF frames themselves. Two
seeded exercises (**Mountain Pose**, **Brisk Walking**) are hidden by the
frontend's `REMOVED_EXERCISES` set, so the visible library is 56; both
remain in this mapping because they exist in the system of record and need
an explicit migration decision (§6, Tier 3). `arnold_shoulder_press` has a
rep-counter config but is **not** in the 58 — it's noted as a ready-made
expansion candidate, not counted.

**Tiers:** T1 = the 12-exercise gym-demo set (v1 Phase 4 bar) — chosen for
landmark reliability, camera simplicity, and coverage of the movements a

skeptical trainer will actually test. T2 = next 17. T3 = remainder.    ✅=
validated logic exists today and ports with its numbers.

**Tier 1 — the demo dozen**

| Exercise | Family | Rep metric & thresholds | Primary faults (starting
values) | View / Calib | Risk notes |
|---|---|---|---|---|---|
| squat ✅ | F1 | knee_avg 160/100, count up | depth >130 · lean >45
(severe 60) · valgus −0.15/−0.30 | F+S / C1 | None — parity target. |
| chair squat ✅ | F1 | knee 155/110 | shallow > target+25 · lean: >50
**and** trunk−shin >20 | F+S / C1+C2 | None — parity target. |
| jump squat ✅ | F1+airborne | knee 160/130 | no-flight (hip_elev <0.15
in cycle) · stiff landing (knee >130 at touchdown) · shallow load (<40°
flex) · lean 50(+shin 15)/55 front | F+S / C1 | Raw-channel elevation
(§3.2) is mandatory. |
| push-up | F5 | elbow 160/90 (your config) | half-rep elbow_min>110 · hip
sag body_line<160 (your 160–180 rule) · pike | S req / — | Wrist landmarks
jitter on the floor — metric uses elbows only. |
| wall push-up | F5 | elbow 155/95 | half-rep · hips-to-wall
(trunk_incline < 10 means standing too upright) | S / — |
Beginner-critical for gym demos; easiest camera setup in the catalog. |
| lunge | F4 | front knee 160/100 (your config) | front-knee-past-toe
shin>25 · torso lean >20 · back-knee shallow | S pref / C1 |
Side-detection of *which* leg is forward comes free from Mode C routing. |
| glute bridge | F3 | hip_elevation vs floor, top = lockout | no lockout
(hip angle <160 at peak) · partial height (<60% of calibrated best) | S
req / C3 | Supine landmark confidence drops — require side, mark first
release beta. |
| plank | F10 | hold: body_line 160–180 (your band) | sag <160 · pike
>posture-max · elbow not under shoulder | S req / — | Your existing rule
set maps 1:1 to the hold band. |
| wall sit | F10 | hold: knee 80–100 | too-high knee>110 sustained · heels
lifting (ankle_elev) | F or S / C1 | Very reliable; great demo. |
| bicep curl | F8 (elbow) | elbow 150/60 (your config) | partial ROM
(min>70 or max<140, your 50–160 band) · swing trunk osc >10 | F / C1 |
Dumbbell occlusion of wrist is fine — elbow drives everything. |
| shoulder press | F6 | elbow 160/90 (your config) | lockout short
(max<160, your 80–170 band) · asym >15° · lean-back >20 | F / C1 | |

| high knees | F11 | cadence on knee_L/R alternation | amplitude: knee
must pass hip height ("higher!") · cadence <100/min | F / C1 | Amplitude
via hip-relative knee_y — visibility-robust. |

**Tier 2 — next 17** (compressed: metric → faults → view · risk)

| Exercise | Family | Spec seed |
|---|---|---|
| deadlift (RDL pattern) | F2 | hip-hinge: trunk_incline rises to 60–90
while knee stays >140 → faults: knees-collapse-to-squat (knee<120
mid-rep), ROM short, tempo-jerk · **S req** · Honest limitation, stated
in-app: spine *rounding* is not directly measurable from 33 landmarks — we
coach hinge *pattern*, and say so. Never oversell; trainers respect the
honesty in a demo. |
| hip thrust | F3 | as glute bridge with bench setup hint; lockout hip
≥170 · S · bench occludes hips at bottom — positionCheck gates start. |
| bulgarian split squat | F4 | per-side, front knee 160/95; balance fault
via stillness spikes · S · rear-foot elevation makes ankle vis low —
metric ignores rear ankle. |
| step up | F4 | per-side knee 160/100 + hip_elevation gain; fault:
push-off-with-floor-leg (bilateral gate inverted) · S · needs C2-style
height target — reuse `adaptive_target` on hip_elevation. |
| calf raises | F8 (heel-elev) | heel/ankle_elevation vs C1, up/down on
elevation band | partial raise, bounce (maxCadence) · S · smallest ROM in
catalog — raw channel + generous bands; beta until traces confirm. |
| crunch | F9 | shoulder-lift proxy (shoulder_y drop vs C3) or hip angle
140/110 · faults: neck-pull unobservable (excluded — don't fake it),
momentum cadence cap · S. |
| leg raises | F9 | hip angle 170/95 lying · lower-back arch via body_line
during descent · S / C3. |
| mountain climber | F11 | cadence on alternating knee-to-chest;
plank-line fault from F10 rules concurrently · S · the one exercise
combining two templates' fault sets — supported: faults are just rules. |
| jumping jack | F11 | cadence on wrist-above-head + stance width
oscillation; amplitude faults ("arms all the way up") · F. |
| superman | F9 (prone) | chest+thigh elevation vs C3 floor, hold-ish reps
· S req · prone = worst-case landmark confidence; **beta**, generous
thresholds. |
| side plank | F10 | body_line lateral (shoulder-hip-ankle) 160–180,
per-side holds · S · elbow-under-shoulder check reused. |

| tricep dips | F6 | elbow 160/80; shoulder-shrug fault (shoulder_y rise)
· S · bench occlusion — camera hint critical. |
| lateral raises | F8 (shoulder) | shoulder abduction 20/80–90; fault:
shrug, swing, over-raise >100 · F. |
| russian twist | F9 (rotation) | oscillation of shoulder-line x-span
(side-to-side), Mode D counting; fault: feet-down (if variant), tempo · F
· rotation via x-span oscillation, **not z** (I-noisy) — twist *depth* is
approximate; framed as tempo/count coach. |
| tricep extension | F8 (elbow, overhead) | elbow 160/70 overhead;
elbow-flare via symmetry+elbow_x drift · S. |
| lunge jump | F4+D hybrid | per-side landing detection + flight (hip_elev
raw) · S · uses jump-squat's airborne module verbatim. |
| skipping rope | F11 | cadence on ankle/hip elevation micro-oscillation;
rope invisible — count jumps, coach rhythm only, never "form" · F · set
expectations in-app copy. |

**Tier 3 — remaining 29** (one line each; 28 pose-tracked through the same
pipeline, 1 timer-only)

pull-up (F7 — hardest camera story in the catalog: bar height forces
low-angle camera; kip detection via hip_elevation oscillation; ship late,
beta, with explicit camera hint) · bench press (F5 side-view low camera;
bar path not visible — elbow ROM + tempo only, stated honestly) · pike
push-up (F6) · resistance band pull (F7, wrist-x span 0.4→1.1
torso-widths) · burpees (F11 composite cycle: floor→jump detection chain)
· plank jack (F11 + F10 concurrent) · skater jump (F11 lateral hip_x
oscillation) · tuck jump *(media alias `truckjump` — confirmed from GIF
frames)* (F11 + airborne + knee-to-chest amplitude) · jogging in place
(F11) · flutter kick (F9 cadence on alternating ankle_y, small amplitude —
beta) · bicycle crunch (F9 per-side) · seated leg raise (F9) · heel raise
*(media alias `hillraise` — GIF frames show unsupported standing heel
raise; distinct catalog entry from Calf Raises, which is the supported
variant)* (F8, elevation vs C1, generous bands, beta until traces) · **arm
circles** (F11/F8 hybrid: wrist circular oscillation via wrist_y + wrist_x
phase, Mode D cadence; amplitude fault "full circles" via wrist-path span;
F view — trivially reliable, good warm-up demo) · **mountain pose** (F12
posture hold: stillness score + trunk_incline < 5° + arms-at-side;
currently hidden by frontend `REMOVED_EXERCISES` — *migration decision:*
reinstate as a 30s "posture reset" between mobility flows, or drop from
the Postgres seed; both are one-line changes) · **brisk walking**

(`tracking: "timer"` — the catalog's one non-camera entry, already
`ai_supported: false` in your seed; no pose definition; at migration
either reclassify under the running/steps module (mobile GPS) or
timer-only logging on web — do **not** delete: gym walking-warmup programs
reference it) · **mobility thirteen** (F12): cat-cow (Mode D slow cycles
on trunk flexion oscillation), child's pose, cobra, downward dog (body
inverted-V: hip angle 60–100 band), **bridge pose** (supine backbend
*hold* — same landmark story as glute bridge but F12 hold semantics, not
F3 reps: hip_elevation ≥ calibrated band sustained; S req / C3; beta with
superman), hamstring stretch *(its second demo GIF is the misnamed
`hamstring2.gif` — one entry, not two)*, hip-flexor stretch, seated
forward bend, shoulder stretch, world's greatest stretch (3-position flow
= sequenced holds — the only *sequenced* definition; template supports
ordered hold stages), tree pose (stillness-scored balance hold — great
share-card moment), warrior I (front knee 100–130 + arms-overhead band),
**warrior II** (front knee 100–130 + arms-horizontal band via wrist_y ≈
shoulder_y ±0.05 torso-heights + stance width > 1.4 shoulder-widths; F
view — the width signal makes it *front*-view unlike Warrior I) — all:
generous bands, timer-first UX, no harsh scoring.

*Expansion candidate (not in the 58):* `arnold_shoulder_press` — a
validated rep-counter config (160/90) already exists with no catalog entry
or media; adding it later is one seed row + one definition inheriting
shoulder press with rotation unscored.

Coverage check: **12 + 17 + 29 = 58 — every seeded exercise mapped, zero
open slots.** (Shoulder Press's strict variant and the "hamstring curl"
that earlier drafts listed were media-alias ghosts, now removed; Warrior
II, Bridge Pose, Arm Circles, Mountain Pose, and Brisk Walking were the
genuinely missing five.) Live visible today = 56 (58 − the two
`REMOVED_EXERCISES`).

---

## 7. The golden-trace harness — how "no bugs" is actually engineered

This is the quality system. Budget ~2 days to build; it protects every
exercise forever after.

### 7.1 Trace file format

One recorded session = one file: a JSON header + JSONL frames (streams
cheaply, diffs cleanly in git):

```jsonc
// header line
{ "traceVersion": 1, "exercise": "squat", "recordedWith": { "engine":
"1.0.0", "defs": 41 },
 "device": "poco-x5", "platform": "web", "fps": 15.2, "view": "side",
 "label": "clean_10_reps",
 "expected": { "reps": 10, "faultsExact": {}, "scoreRange": [82, 95],
                 "formCorrectAll": true } }
// then one PoseFrame per line
{ "t": 0.0,   "kp": [ ... ] }
{ "t": 66.9, "kp": [ ... ] }
```

`expected` is authored by *you watching the video once* and locking the
truth — after that, CI is the reviewer. Raw video is never stored (privacy
invariant); the trace is stick-figure data only, ~1–2 MB per 10-minute
session uncompressed, ~150 KB gzipped in the repo.

### 7.2 Recording mode

A dev-flag in the web app (and later mobile) adds a "record trace" toggle
to ActiveWorkout: it tees the exact PoseFrames the engine consumes into a
downloadable file. Because it captures *engine input*, a trace recorded on
web replays identically on mobile CI — that's I2 and I3 doing their job.

### 7.3 Required fixture matrix — per exercise, before it may leave `beta`

At least **6 traces**: (1) clean set, 8–12 reps · (2–3) one trace per
*major* fault, deliberately performed · (4) occlusion/interruption — walk
partially out of frame mid-set, return · (5) wrong-view attempt
(front-only exercise done side-on) — expected: cue fires, nothing
miscounts · (6) speed extremes — rushed reps and grinding-slow reps.
Isometrics swap (6) for a wobble-and-recover hold. The matrix is a
checklist in the authoring workflow (§9.1), not folklore.

### 7.4 Assertions & tolerances

Rep count: **exact**. Fault multiset: **exact** for scripted-fault traces;
clean traces assert *empty*. Scores: within the trace's declared
`scoreRange` (±5-point authoring slack absorbs smoothing-window edge
effects). Hold time: ±700 ms. Phase sequences: optionally asserted for
FSM-sensitive traces. A failing assertion names the first divergent frame
— debugging is "open frame 412", not archaeology.

### 7.5 The parity protocol (Python → TypeScript port gate)

Before `pose_ws.py` is decommissioned: (1) run the *current* system in a
capture mode that logs, per frame, both the incoming keypoints and the
server's full response; (2) record **≥ 6 squat, 4 jump-squat, 4
chair-squat** real sessions this way, across front and side views,
including your known real footage cases (the chair-squat clips bottoming
at ~62° and ~71–90° that your comments cite); (3) these become traces
whose `expected` values are *the Python outputs*; (4) the TS engine must
match rep counts exactly and scores within ±3 before the port is called
done. This converts "I think the port is faithful" into a green checkmark.

### 7.6 CI wiring & the performance gate

Every push: lint definitions → unit tests (signal formulas against
hand-computed geometry fixtures) → **replay all traces** → perf bench
(replay a 10-minute trace in a tight loop; assert p95 frame cost ≤ 3 ms
scaled to the CI baseline machine, and stable heap) → fuzz pass (random
NaN injection, landmark dropout bursts, fps jitter 8–40 on a clean trace;
assert: no throw, no count *increase*, recovery after signal returns). A
threshold tweak that would break squat counting fails the build before any
gym member ever sees it — this, concretely, is the "no bug" machinery.

---

## 8. Porting plan — nothing validated gets lost

### 8.1 Constant-preservation table (the audit trail for the port PR)

| Today (file · constant) | Value | Lands in |
|---|---|---|
| rep_counter squat up/down | 160 / 100 | squat `rep.upAt/downAt` |

| rep_counter jump squat down | 130 | jump_squat `rep.downAt` (+ rationale
comment carried into def description) |
| rep_counter chair up/down | 155 / 110 | chair_squat `rep` |
| smoothing window | 7 frames | engine conditioning (§3.2) |
| min down / up frames | 3 / 2 | FSM debounce defaults |
| bilateral engage angle | 150° | `bilateralGate` default |
| min rep interval | 0.45 s | engine floor; defs add `minRepMs: 900` |
| SQUAT_STANDING_KNEE_MIN / SHALLOW / PARALLEL | 155 / 130 / 100 | depth
curve `[[100,100],[130,30],[155,0]]` |
| SQUAT_TRUNK_LEAN_MAX (+severe) | 45 (+15→60) | trunk fault
`when`/`severe` + curve `[[45,100],[75,0]]` |
| VALGUS flag / severe | 0.15 / 0.30 | valgus fault + curve |
| neutral score / correct bar / corrections cap | 80 / ≥70 / 2 | scoring
`neutral`, `correctAt`; coaching policy |
| _StandingCalibration frames / knee min | 8 / 160° | C1 params |
| CHAIR fallback / tolerance / shallow margin / standing | 100 / 10 / 25 /
155 | C2 fallback + chair curves |
| CHAIR trunk absolute / shin delta | 50 / 20 | chair lean fault (relative
check) |
| JUMP airborne elevation / stiff landing / loading depth / lean S+F |
0.15 / 130 / 140 / 50+15, 55 | jump_squat airborne module + faults |
| visibility threshold | 0.3 | conditioning gate (+0.15 hysteresis floor,
new) |
| view thresholds | side <0.15/<0.15 · front >0.20 or >0.15 | view
classifier (§3.3) |
| FORM_RULES bands (push-up, lunge, plank, curls, presses) | as coded |
T1/T2 definitions' starting fault bands (§6) |

### 8.2 Sequence (fits v1 Phase 1, weeks 2–4)

Week 2: engine skeleton — contracts, conditioning, view, signals 1–17, C1,
Mode A, DSL parser, scorer; harness built; parity traces recorded *first*
(while the Python path still runs). Week 3: squat/jump/chair definitions
to parity green; C2, airborne module; web `usePoseDetection` swapped to
local engine behind a flag (the hook's public API barely changes —
`ActiveWorkout` mostly doesn't notice); `/v1/workouts/sync` live. Week 4:
Modes B–D, C3, signals 18–22; T1's nine new exercises drafted to `beta`;
flag flipped, WS path deleted. Exit = v1 Phase 1's acceptance line: full
workout with the API server switched off, then a clean sync.

**Cleanup item (verified dead code, v1.1):**
`frontend/src/ai/FormClassifier.js` and the 17 MB
`public/models/ctr_gcn_clean_ensemble_quant.onnx` it loads are imported by
**nothing** in the app — a remnant of the ML-classifier path you correctly
abandoned for rule-based (the right call: no server inference cost, no
dataset-limitation ceiling, deterministic and auditable). Delete both plus
the `onnxruntime-web` dependency in Week 2. It costs nothing at runtime
today but is 17 MB of deploy weight, a misleading signal to future-you,
and a dependency with its own security-update surface.

---

## 9. Definition lifecycle: authoring → publishing → rollback

### 9.1 Authoring workflow (the production line)

Pick exercise → copy family template → fill parameters (§6 row is the
seed) → derive/verify thresholds via the protocol below → self-record the
§7.3 fixture matrix → adjust until traces green locally → PR (definitions
are code-reviewed data; the diff *is* the behavioral change) → CI green →
status `beta`.

**The threshold-derivation protocol (v1.1 — your existing method,
formalized and upgraded).** The method that produced the validated
squat/chair/jump thresholds — extract joint angles from good-form videos
in Colab, cross-check against published exercise research — is the right
method; MediaPipe-measured numbers beat textbook numbers because they
include MediaPipe's own systematic biases. Keep it, with four upgrades
that fix its blind spots:

1. **3–5 good-form videos, not 2** — different body proportions (limb
ratios, torso length) shift measured angles by 5–15° for the *same*
quality of movement. Two videos give you the center of the distribution;
they cannot give you its width. From 3–5 sources, take the **p10–p90
band** of the target metric at each phase (bottom, lockout, etc.), not a
single value. The pass threshold sits at the *permissive* edge of the
band; the coaching-cue threshold sits at the strict edge. Where a
subject's own standing baseline matters more than the population (valgus,
chair depth), the C1/C2 calibration modules absorb the variance — that's
what they're for.

2. **2–3 deliberate-fault videos per fault rule** — record yourself
intentionally shallow, intentionally leaning, intentionally caving the
knees. A fault threshold set only from good reps is a guess about where
"bad" begins; a threshold set with true fault positives is a measurement.
Every fault rule in a definition must have at least one trace where it
fires and one where it correctly stays silent (this is already the §7.3
fixture requirement — the fault videos are those fixtures).
3. **Research pass is corroboration, not source** — the desk-research step
(published ROM norms, coaching standards) stays, but its role is to
*sanity-check* the video-derived band, flag safety-relevant limits (e.g.,
knee-past-toe conventions), and supply coaching language. When research
and your measured band disagree, trust the measurement and write one line
in the definition PR explaining the delta — that line is gold six months
later.
4. **Numbers land in the definition JSON, never in code** — the Colab
notebook's output is a filled §4 definition (plus its band evidence pasted
into the PR description). The same session's videos become the golden
traces. One recording session per exercise therefore yields the thresholds
*and* the regression fixtures — that's the whole production line for the
2–3/week cadence in §10.

### 9.2 The linter (runs in CI and on publish)

Rejects: unknown signal references; rules/components referencing signals
absent from `signals`; view-scoped rules in definitions that exclude that
view; curves not monotonic in x; `upAt ≤ downAt`; hold bands inverted;
missing `msg` keys or keys absent from the locale table; `severe` without
a base fault; missing camera hint; fixture matrix incomplete for a `live`
promotion. Every rejection message says which field and why — authoring
stays a one-person-friendly loop.

### 9.3 Publishing & staged rollout

Definitions live in Postgres (`exercise_definitions`, v1 §7.1) and ship as
the **signed, ETag-cached bundle** (v1 §5.2): `beta` definitions are
included only for flagged users (you + consenting pilot-gym members — one
feature flag); `live` for everyone. Promotion `beta → live` requires:
fixture matrix complete, ≥ 1 week of beta telemetry with fault-rate and
reps-per-set distributions inside expected bands (a fault firing on 95% of
reps means the threshold is wrong, not that everyone squats badly — the

telemetry check catches exactly this). Rollback = repoint the bundle to
the previous version row; clients pick it up on next fetch; no deploy, no
app-store anything, in either direction.

### 9.4 Post-publish telemetry to watch (per definition, on your admin
panel)

Fault-rate per fault id (distribution, not average) · reps-per-set
distribution vs. family norm · % sessions ending < 60 s (rage-quit proxy —
usually a setup/camera problem) · view distribution vs. `preferredView` ·
score histogram shape. These five catch every bad-threshold incident class
I can anticipate, cheaply.

---

## 10. Production cadence, and definitions of done

**Cadence:** with templates and harness in place, budget **2–3
exercises/week** sustainably (each ≈ half a day of parameterization + one
recording session + tuning). T1's nine new exercises land inside v1 Phase
4's window; T2 completes ~5 weeks later; the full 59 well inside a quarter
— while the gym pilots run on T1, which is the point: gyms buy on 12
solid, not 59 (unchanged conclusion from the business discussion).

**Definition of done — engine v1:** all §1.3 invariants enforced in CI ·
parity traces green (§7.5) · perf gate green on the mid-Android profile ·
fuzz pass green · web app runs a full offline workout through the local
engine · sync payload byte-matches §2.4.

**Definition of done — any exercise:** linter green · fixture matrix
complete and green · beta telemetry week clean · camera-hint copy + all
message keys in EN (HI/AS keys may lag but must exist) · §6 risk note
either resolved or surfaced as honest in-app copy.

---

## Appendix A — Message-key seed (from your current strings, so nothing
regresses)

`fault.squat.depth` "Squat lower — aim to get your hips level with your
knees" · `fault.squat.lean` "Keep your chest up — you're leaning too far
forward" · `fault.squat.valgus` "Push your knees out — don't let them cave
inward" · `fault.body.visibility` "Cannot see your legs clearly — step
back so your full body is in frame" · `fault.pushup.depth` "Lower your
chest closer to the floor" · `fault.pushup.line` "Keep your body in a
straight line" · `fault.pushup.sag` "Don't let your hips sag" ·
`fault.lunge.frontknee` "Bend your front knee to 90 degrees" ·
`fault.lunge.backknee` "Bend your back knee toward the floor" ·
`fault.lunge.torso` "Keep your torso upright" · `fault.plank.hips` "Raise
your hips — keep body straight" / "Don't let your hips drop" ·
`fault.plank.elbows` "Keep elbows directly under shoulders" ·
`fault.curl.rom` "Full range of motion — curl all the way up" ·
`fault.press.lockout` "Press all the way up" · plus new
`cue.turn_to_front`, `cue.turn_to_side`, `setup.<exercise>.camera` family.
Hindi/Assamese columns are a translation task, not an engineering one —
schedule with a native speaker before T1 goes to pilot gyms (it's a
demo-day differentiator, v1 §21 #10).

## Appendix B — Reconciliation log (RESOLVED, v1.1 — evidence-verified
against your repo)

All six questions closed. Method: decoded frames from every ambiguous GIF,
cross-referenced `frontend/src/utils/exerciseMedia.js` (the name→media
map), and treated `scripts/seed_exercises.py` (58 entries, unique-name
index) as the canonical catalog.

1. `hillraise` → **Heel Raises** — real catalog entry (seed line ~1424).
GIF frames show an unsupported standing heel raise; `exerciseMedia.js`
maps the files to the `'heel raises'` key. Distinct from **Calf Raises**
(the supported/holding-on variant per its own GIF). *Not* hill sprints —
no running content in the media; hill/incline running belongs to the GPS
module if you ever want it.
2. `hamstring2.gif` → the **second demo GIF of Hamstring Stretch**, not a
separate hamstring-curl exercise (`'hamstring stretch': [...,
'hamstringstretch1.gif', 'hamstring2.gif']`). The "hamstring curl" row in
earlier drafts was a ghost — removed.
3. `soldierpress` → **media alias of Shoulder Press** (`'shoulder press':
['soldierpress.jpg', 'shoulderpress1.gif', 'soldierpress2.gif']`). GIF
confirms a standing overhead press. The separate "military press" row was

a ghost — removed; the strict-form lean-back fault (≤10°) is now simply
part of the single Shoulder Press definition.
4. `truckjump` → **Tuck Jumps**, real entry, confirmed from GIF frames
(knees-to-chest airborne). Misspelling only.
5. Count: **58, not 59 or 57.** The seed script is unambiguous (58
inserts, unique index on `name`). Your dashboard figure was correct. The
five entries earlier drafts missed: Warrior II, Bridge Pose, Arm Circles,
Mountain Pose, Brisk Walking — all now mapped in §6. The frontend hides
Mountain Pose + Brisk Walking via `REMOVED_EXERCISES`, hence 56 visible.
Nothing is missing; no exercises need inventing.
6. T1 demo-dozen: stands as specified in §6 (no objection raised).
Swappable at any time — T1 membership is a tag on the definition, not
engine structure.

**Two product decisions surfaced by the reconciliation (make them during
Part 4's migration, both one-liners):** (a) Mountain Pose — reinstate as a
posture-reset hold or drop from the Postgres seed; (b) Brisk Walking —
reclassify `tracking: "timer"` on web and fold into the running module on
mobile, or timer-only forever.

*— End of Part 2. Next deliverables, one at a time as agreed (v1 §23):
Part 3 Gym Dashboard screen-by-screen · Part 4 Database DDL & migration ·
Part 5 Billing & webhooks · Part 6 Mobile deep spec · Part 7 Retention
playbook · Part 8 Ops runbook.*
