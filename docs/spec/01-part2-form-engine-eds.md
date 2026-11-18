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

**AMENDED 2026-10-12 (RULINGS that day; §11 below).** How an exercise is made is Kd's
own way now: he names it and gives one or two good-form links, and records nothing
himself. §9.1's 3 to 5 videos and self-recorded fault clips, §7.3's six self-recorded
traces and §10's cadence are replaced by §11, which also says what the code held that
day and which tools come first. Where this Part differs from §11, §11 wins.

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

**Since 2026-10-31 (§11.8):** a session takes a `CameraFrame`, a `PoseFrame` plus the picture's `aspect`. A trace header also carries `aspect`, though the example in §7.1 does not show it; rep numbers in §4 and §8.1 are the old ones, and the definition files hold today's.

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

**Since 2026-10-31 (§11.8):** the Python outputs stay in the `.responses.jsonl` files and check the formulas; a trace's `expected` no longer holds them.

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

## 11. The exercise line (planned 2026-10-12; Kd, RULINGS that day; ROADMAP Stage 5 items 50 to 65)

Written by a planning terminal that read the engine, the web's workout pages and Kd's
own video folder that day. No code. Where §7.3, §9.1, §10 or Part 6 §3 differ from this
section, this section wins. **Since 2026-11-16 the counting and the form check are made
fresh: §12 wins where this section differs. The same day the Exercise Library and the
Workout section were made fresh: §13 wins for them.** Exercise folder 1 builds the camera and the form rules
(items 50 to 55); exercise folder 2 builds the Exercise Library and the Workout section
(items 60 to 65).

### 11.1 What the code holds today (read 2026-10-12, spot-checked, not run)

- **The camera counts 3 of the 58:** squat, chair squat, jump squat. Only rep mode A
  (`alternating_threshold`) is built: `compile.ts` refuses a hold, alternating sides,
  cadence, `tracking: "timer"` and the floor reference. There is no airborne check, so
  jump squat is a knee angle of 160/130 and nothing asks that the feet left the floor.
- **One rule can reach the screen.** A frame-scoped rule gives the live cue; a per-rep
  rule is only counted in the set's summary and is shown nowhere (`faults.ts`,
  `evaluateFrame` skips it). The three definitions hold one frame-scoped rule, squat's
  `trunk_lean`. Chair squat and jump squat hold one per-rep, front-view knee rule each,
  under a camera hint that says side-on, so they give no advice and "Good Form" shows
  whenever no cue is live. Squat's `shallow_depth` cannot fire on a rep that counted.
- **What the web feeds the engine:** at most 15 frames a second (`FEED_INTERVAL_MS` 67),
  image landmarks only (`worldLandmarks` are read nowhere), one pose, and nothing picks
  which person is the user; the person check is not an identity check. Follow-along is
  not built. A workout in progress lives in memory only.
- **Three sizes of the pose model in three places:** the web runs `full`, Kd's video
  tools `heavy`, the archived `feed_video.py` `lite`; the person check's 0.923 was
  measured on `lite`.
- **The voice** picks its line by a keyword in the cue's text (`voice.js`), so the cue
  "Cannot see your legs clearly — step back…" is spoken as "Keep your chest up".
- **The exercise list is in three places**, joined by slug: `exerciseCatalog.ts`,
  `exerciseContent.ts`, and the `exercises` table with muscles, equipment and difficulty
  NULL. The web bundles its definitions and never asks `/v1/exercise-definitions`. A GIF
  is found by the exercise's display name; the GIFs are 259 MB with no licence record.
- **A workout:** no weight anywhere; the 22 timed exercises are given "12 reps"; the
  typed name is saved nowhere; saved workouts read the old backend; the summary shows no
  set; the records are three for a whole workout and none for an exercise; the
  difficulty stars are sent nowhere.
- **Tools in the repo:** `packages/engine/scripts` (`measure-pose`, `measure-rest`,
  `validate-trace`, `bench`, `lint-defs`), the web's trace recorder
  (`VITE_TRACE_RECORD`), ten traces. No tool turns a video into a trace without the old
  Python server.

What is right and stays: exercises are data; the engine is pure and the same code can
run on the laptop, in the tests and on the phone (I1 to I3); golden traces gate every
change; the workout save is safe to send twice.

### 11.2 The tools, built before any new exercise

1. **A video to a trace.** One command for every exercise: a video file in, a trace out
   (§7.1's format, with the world landmarks beside the image ones), made with the SAME
   model file and settings the phone runs (tool 5 decides them). Python with MediaPipe is
   on Kd's laptop already and may stay the extractor; nothing but landmarks comes from it.
   **As built (50b, 2026-11-01):** `corepack pnpm --filter @app/engine measure-video "<video>" --exercise <key> [--reps <counted by eye>]` writes the trace, `report.json` and pictures to `measured/<label>/`, which git ignores; inside a checkout it writes nowhere else, and it refuses a folder holding files it did not make. A frame where the model found nobody stays in the trace with an empty `kp`, as the app feeds it; world points are `wkp`; a trace nobody has counted has `expected.reps` -1 and cannot pass as a stored test. The model is Kd's heavy one until item 51 picks.
2. **Measured by the app's own engine.** The trace is replayed through `@app/engine`
   (§7), and the numbers that set a rule are the engine's own signals, never a second
   copy of the maths. Kd's `analyze*.py` measure angles their own way: a cross-check,
   never the source.
3. **Pictures a terminal can look at.** A terminal cannot watch a video. The tool writes
   still frames with the skeleton, the signals and the engine's decision drawn on them,
   at the bottom of each rep and at each fired rule, and a chart of the signals over time.
4. **The cross-check.** Every exercise's definition is replayed on every other
   exercise's trace. A count there is a named twin (a chair squat is a squat) or a fault
   to fix.
5. **The camera test on Kd's phone** (item 51; Part 6 §3.2's bars, on an ordinary recent
   phone): each candidate's speed, heat, battery and memory over 20 minutes, and a video
   file run through the phone's own path and compared with tool 1's trace.
6. **The clip line** (item 62): the original shortened, the generated clip made small
   (one shape, 16:9, no sound), a still picture cut from it, and the clip run through
   tools 1 and 2: it must count its reps with no fault.
7. **One exercise list on the server** (item 60): name, muscles, equipment, how it is
   counted (camera · by hand · timed), where the phone goes, its clip, steps and
   mistakes, sent with the definitions.
8. **The engine's missing parts** (item 52; §11.5).

### 11.3 How one exercise is made (Kd's rules)

1. Kd says the name.
2. The terminal says where the phone goes and which way the person faces, and whether
   the selfie camera can count it and judge it. If it cannot, the exercise gets the clip,
   the steps and counting by hand, and the Library says so.
3. Kd gives one or two good-form links. The terminal looks for a coach's "common
   mistakes" clip of the same exercise. A free-to-use clip is used first where one exists.
4. The videos stay on his laptop and never go to git. Tools 1 to 3 measure them.
5. The terminal reads proper sources on the form (NSCA, ACSM, ACE, published studies;
   never a random article) and lists EVERY common mistake. Each is either checked by the
   camera or marked "the camera cannot see this from here".
6. The exercise is written as data: how it is counted, its rules, its words, each number
   traced to a measurement or a source.
7. The checks of §11.6.
8. The terminal writes the picture prompt (his character, male or female, with the
   equipment) and the Google Flow prompt. Kd makes the clip. The clip passes tool 6.
9. Kd's test, the real path: pick it in the Library, add it to a workout, do it in front
   of the selfie camera.

### 11.4 The order of exercises, and what the camera cannot do

The first seven (item 54): squat, chair squat and jump squat, which the engine has, then
bicep curl, bicycle crunch, barbell bench press and dumbbell bench press; Kd's folder
holds videos for six of the seven. Then the rest of the 58, family by family (§5), so
each kind of counting is built once. Then common gym exercises (barbell, dumbbell, cable,
machine), then Pilates and studio, then others. He names them as it goes.

Before any work on an exercise the terminal answers two questions: can a phone standing
2 to 3 metres away count it, and can it judge it? Where equipment hides the body, the
movement is too small, or the person faces away, the honest answer is the clip, the
steps and counting by hand. Some are only timed (meditation), with no form check.

The two exercise folders take different families, so two terminals never write one
definition. A definition is one file, found by the tools without a hand-kept index.

### 11.5 The engine on the phone

The terminal's own choices. Each is kept only if a measurement on clips says it is
better, and the number is shown to Kd.

- **One model everywhere**, chosen by tool 5. Every threshold is measured with it.
- **A leaning phone.** The adapter passes the phone's gravity reading with the frames,
  and the engine works in gravity-aligned coordinates. The engine stays pure: gravity is
  an input, like the frame.
- **Steadier points.** A one-euro filter on the landmarks is measured against today's
  7-frame mean on the fast clips. Today only the rep metric is smoothed.
- **World landmarks.** Joint angles from them are measured against the image ones across
  camera angles, and used only where steadier.
- **The rate:** as many frames a second as the phone holds steady in tool 5. The
  engine's frame counts (3 down, 2 up, 8 standing, 10 for the view) become times.
- **One person.** More than one pose is asked for, the person who starts the set is
  followed, and counting pauses, never counts, while they are hidden (Kd's busy gym).
- **Every rule can speak.** A per-rep rule reaches the screen at the rep's end; a spoken
  line belongs to its rule's own key, never to a keyword; a rep that fails to count says
  why ("not counted: go lower").
- **Set-up is checked, not ticked:** the whole body in view, the distance, the light,
  the phone's lean, the view the definition asks for. The set arms when it passes.
  **Replaced 2026-10-18 (Kd; §11.8 step 4):** nothing waits for a check to pass; the
  reference picture shows how to set up, with one line.
- **The screen is for somebody 2 to 3 metres from a phone:** the count and the colour
  carry it, the voice says the rest, a short sound marks each counted rep. Its look is
  shown to Kd as pictures first (item 53).
- **The kinds still to build:** hold, alternating sides, cadence, timed only, the
  airborne check, the floor reference (§3.5, §3.6), and Stage 4 item 6's faults.

### 11.6 The checks, and the review

An exercise leaves the line when: (a) its own good-form trace counts exactly what a
person counts by eye, with no fault; (b) each mistake clip fires its mistake; (c) the
cross-check is clean; (d) §7.6's fuzz and performance gates hold; (e) its generated clip
passes tool 6; (f) Kd has done it on the phone from the Library. Accuracy is told to him
as those numbers, never as a promise.

The tools and the engine are jobs like any other, reviewed as CLAUDE.md §2 says. An
exercise is checked by (a) to (f), and a fresh terminal reviews a whole FAMILY of
exercises at once, never each one (RULINGS 2026-10-12).

### 11.7 Kd's own folder, outside git

`D:\vidoe referene` (his spelling), made 2026-09-28 to 2026-10-01: `tools/analyze.py`
(bicycle crunch), `analyze_squat.py`, `analyze_curl.py` (which takes `--bad`, a wrong-way
clip, so a rule's number sits between right and wrong), `pose_landmarker_heavy.task`;
`character/male` and `character/female`; and for each exercise a reference video, a
`reference_profile.json` and a `VEO_PROMPT.md` (a start picture, then Google Flow, Veo
3.1, frames to video, 16:9, 8 seconds, then checked and looped). Six exercises have
material: squat, chair squat, bicep curl, bicycle crunch, barbell bench press, dumbbell
bench press.

A terminal reads that folder and never changes it unasked. A video never goes to git. A
trace is body points only (§7.1) and may; so may a definition and a tool.

The web's camera page reads this same engine. Until Kd says the web's five workout pages
may go, an engine change keeps their tests green; the terminal asks him when the phone's
Workout section has passed his test.

### 11.8 The workout's steps and the live form engineering (Kd, 2026-10-18)

Written by a planning terminal in exercise folder 1 (Opus 5.5, max) with Kd's answers of
that day (`rulings/2026-10-18-exercise-flow-plan.md`); no code. **Nothing in the plan of
2026-10-12 changes:** the jobs, their order and the rulings stay, and this section says how
the person's steps and the live form analysis work inside items 50 to 55 and 60 to 65 (Kd:
*"I JUST ASKED YOU IMPROVE THE ENGINEERING OF REAL TIME FORM ANALSYSIS AND THE STEPS THAT
USER FOLLOW"*). Where §11.5 differs, this section wins. The member web's workout pages were
read as a reference for the idea only.

**The steps (Kd's answers)**
1. The Workout tab says **Choose the plan you want**: the app's plan, the gym's plan (Part 3
   §15.7) or the person's own, made from the Exercise Library with Add to workout. Nobody
   adds an exercise of their own (RULINGS 2026-08-16 stands).
2. **Start** opens ONE screen for the whole workout: each exercise with its sets (reps,
   time, weight), the rest timer and the next exercise (item 64).
3. For each exercise the person picks **Camera** or **Count myself**, every time; nothing is
   remembered. Count this set myself stays on the camera screen (RULINGS 2026-08-07).
4. With the camera, the exercise's reference picture shows where the phone goes and which
   way to face, with one line: "Set up your phone like the picture. From another angle the
   count may be wrong." The set starts at once; nothing waits for a check to pass. If the
   camera loses the person during the set, the screen says so.
5. A set's target (reps, time, weight) comes from the chosen plan or from what the person
   sets, never from last time. The set ends by itself at its target, or on Done; the rest,
   the next set and the next exercise follow with nothing to press from 3 m away.
6. A timed exercise gets a timer; where the camera can judge the position (a plank), the
   timer runs only while it is held right. Machines: some by hand, some by camera, settled
   for each exercise when it is built (§11.3 step 2).
7. The person is told what stays private (below), to build trust (Kd): on the screen before
   the phone first asks for the camera, and in one short line on the camera screen.

**The engineering** (the terminal's own; each kept only if the measuring line says it is
better, and the number is shown to Kd)
- **Only on the phone.** The camera works only in the phone app; the laptop only measures
  reference videos (item 50). Today's ordinary phones are the target, measured on Kd's
  (item 51): the strongest pose model that runs smoothly there, on the phone's graphics
  chip. Part 6 §3.5's floor and test phones are not the target (Kd: *"WE ARE NOT
  TARGETTING NOKIA PHONES THOSE OLD BOXES"*).
- **True proportions, item 50's first part.** Found 2026-10-18: `PoseFrame` carries x
  divided by the picture's width and y by its height, and `geometry.ts` measures angles on
  them as if the picture were square (the archived `angles.py` did the same). With the
  engine's own formula, a true knee angle of 115° reads 139° on a 16:9 picture and 86° on a
  9:16 one, and a true 160° reads 169° and 145°; the view classifier's width ratios move
  the same way. The frame carries the picture's shape, angles are taken in true
  proportions, the three web definitions are measured again so the web's tests stay green
  (§11.7), and every number after it is measured that way. **As built (50a, 2026-10-31):** `CameraFrame` is a `PoseFrame` plus `aspect` (width / height); a session rescales x once; a frame without a usable shape decides nothing; a trace's header says its shape. Measured again so far: each rep's up and down lines and squat's depth curve; the other angle numbers are measured with item 52.
- **One person locked on (item 52).** More than one pose is asked for. The set's person is
  the one standing where the reference picture shows, nearest the phone (the largest);
  when two stand there, the screen asks one to raise a hand (Microsoft's own Xbox study,
  CHI 2014, found a raised open hand the best way to engage). The lock keeps that body's
  limb-length ratios and its place, in memory and only for the workout, and follows the
  pose that matches; any other is ignored. Hidden or unsure, counting pauses: it never
  guesses and never switches. A chair, a poster, a mirror or a TV is never chosen (the
  person gate and the start rule). No camera fitness product read on 2026-10-18 publishes
  how it does this; Exer's help asks for one person in view.
- **Like machine learning, with rules.** Every number is set from measured videos, good and
  wrong. Each person is judged against their own standing position and first reps (§3.5's
  C1 and C2). A rep or a mistake is decided only when two separate signs agree (a knee
  angle and the hip's height); a point seen poorly is not used and the decision waits.
- **The voice coach.** Pre-recorded lines, made by Kd by hand on ElevenLabs' Starter plan
  (about $6 a month), never through their API. Lines made on the free plan, or with a
  model ElevenLabs marks beta, may not be used in an app (ElevenLabs' help centre, read
  2026-10-18). The terminal writes the script: the shared lines (numbers, ready, rest, next,
  praise) once, with item 53; each exercise's own lines when that exercise is built
  (§11.3). A script is a table (when it plays, the line, the file name), two or three
  wordings a line, with the one voice and its settings named once so every line sounds the
  same. The coach knows the set: the count ("Halfway", "Last two"), one correction at a
  time and only between reps, praise when it is earned ("Better — that's the depth" once a
  mistake is fixed), another wording when a mistake comes back, encouragement when reps
  slow near the end, the rest and what is next. **It is never wrong out loud** (Kd: *"IF
  THE VOICE GIVES WRONG INPUT THAT WILL BE BIG NEGATIVE POINT"*): a correction plays only
  for a rule that fired from the view it was made for, held long enough or on more than
  one rep; unsure is silent; a line belongs to its rule's key (§11.5). The phone's music is
  lowered, not stopped, while it speaks.
- **Battery, and never a crash.** The camera and the pose model run only during a set and
  sleep during the rest; the voice plays files on the phone. Item 51 measures battery, heat
  and memory over 20 minutes and shows Kd the numbers. A camera or model failure turns
  that set into Count myself and the workout goes on, kept on the phone at every step
  (item 61).
- **Privacy** (Kd: *"NOTHING SHOULD BE ONLINE OR ANYTHING EVERYTHING REMANS TO THE USER
  ONLY EXCPET THE END RESULT WHCIH USERS CAN SHARE"*). The video and the body points stay
  on the phone, are never stored and never sent, crash reports included. Only the finished
  workout's numbers (sets, reps, time, weight, form score) are saved to the account;
  sharing is the person's own tap.
- **Thousands at once.** Each phone counts for itself, so the server does nothing during a
  set. It receives one small save when a workout ends (`POST /v1/workouts/sync`, safe to
  send twice), measured with many arriving at once before launch (CLAUDE.md §4, "Cost at
  full size"). Clips and voice lines are downloaded once and kept on the phone.
- **Share** (ROADMAP Stage 5 item 39): after a workout, a meal photo or a run, the person
  takes or picks a photo and the stats are drawn on it, as Strava and Hevy do; the picture
  is made on the phone and goes out through the phone's own share menu.

**Proof, added to §11.6:** each mistake video plays its own line, and no correction plays
on a good-form video; crowd tests made from real videos (a person walking past, crossing
in front, a class side by side, a mirror) leave the count unchanged; each video is
replayed the ways the world changes it (the phone tilted, nearer, farther, fewer frames a
second, shaky points, a passer-by) and the count must not change. Kd gets these as
numbers for each exercise.

## 12. The movement engine, made fresh (Kd, 2026-11-16; `rulings/2026-11-16-movement-engine.md`)

Written by a planning terminal in exercise folder 1 (Fable 5.2, max) and reviewed once at
Kd's ask before his *"go"*. No code. **Where §3 to §5, §8, §11.2 tool 4, §11.3, §11.5 or §11.6
differ from this section, this section wins.** Exercise folder 2 re-made its own side the same
day; the two meet at the exercise's file (§12.3) and the set's summary (§2.4).

**Why.** At 50c's click-through Kd stood on one leg, bent the other in the air, and a squat
counted. The counter (`fsm.ts`, a straight port of the old Python `RepCounter`) decides a rep
from one knee's angle, and its check of the other knee runs only when both knees are seen.
Measured that day: on Kd's own squat video one knee alone was usable in 74 of 164 frames, on
his chair squat video in 112 of 112; a one-leg lift drawn on a real standing body counted 3
of 3 under the squat, chair squat and jump squat rules with the far knee hidden, and 0 with
both seen. 50c had only added an upright check on top of that counter; its pull request
(#434) was closed unmerged. Kd: *"it just build a wrapper on top of the exsiting bugs"* ·
*"regad them as worthless as we need to do everything fresh"*.

**What is replaced.** The old engine's counting and judging (§3.2 to §3.8), its definition
format (§4), the 12 templates (§5) and the three definitions (squat, chair squat, jump
squat). The new engine is built beside the old one and shares none of its counting code.
`packages/engine` as it is today is touched no more: the web's five workout pages keep it
until Kd says they may go (§11.7).

**What stays.** §1.3's invariants (pure, the same frames in give the same events out,
garbage decides nothing, an exercise is data, engine code never names an exercise); §2.4's
outputs, so the workout save, calories, XP, challenges and boards read a set as they do
today (`SetSummary`; fields may be added, none removed); a video to body points (50b) and
true proportions (50a); §11.8's steps, privacy and the voice made by hand; §9.3's staged
release. Everything a person can do today stays: exercises are added as data, the camera
counts, each rep is scored, the set and the workout are summed up.

### 12.1 The five principles

1. **Count only what matches.** The engine never works from a list of wrong movements. A
   rep counts, and advice is given, only while what the camera sees matches the chosen
   exercise; every other movement, whatever it is, gets no count and no word (Kd: walking
   and standing on one leg were *"only the strnge shape"*, not the rule).
2. **More than angles** (Kd: *"the camera only depend on correct angle … will not be a
   correct judgement"*). An exercise's file says which of these matter for it, and the mix
   differs for every exercise:

   | What the engine looks at | In a squat, for example |
   |---|---|
   | Where the body is | standing, both feet on the floor |
   | What moves together | knees and hips bend while the hips sink |
   | What stays still | the feet do not lift or travel |
   | The path and the order | hips and chest come up together |
   | Speed and rhythm | not a drop, not a bounce |
   | Left against right | both sides move alike |
   | The person's own body | depth judged from their own standing height and first reps |
   | How sure the camera is | a part it sees poorly decides nothing |

3. **Three questions, in order, every frame.** Can I see this person well enough? Is the
   body in this exercise's position and moving its way? Only then: count, and judge form.
   A "no" stops everything after it.
4. **Counting is a little forgiving; advice is strict.** A real rep of a different body is
   not thrown away for a small difference, and every rep that did not count carries its
   reason for the screen ("Go lower to count", "Turn side-on", "Can't see your feet"). A
   correction is spoken only when the engine is sure (§12.6). "Count this set myself" and
   changing the count by hand stay.
5. **Accuracy is held by proof, never by Kd's test of each exercise** (about 200 are
   planned, many on machines; §12.5).

### 12.2 The stages

One frame in: the picture's points and the model's 3D points for up to several people, how
sure the model is of each, the time, the picture's shape, and which way is down (the phone's
own sensor; a reference video is taken as upright).

1. **One person locked on** (§11.8's rule; job 52d). The frame format carries several people
   from the first job.
2. **Is this body possible?** Bones keep their length, joints do not jump, left and right do
   not swap. An impossible frame decides nothing. The model's own "how sure" is never
   trusted alone: a chair once read 0.99, and Kd's barbell video holds a mirror with the
   man's reflection.
3. **Steady points**, with every wait a time, never a count of frames.
4. **The body's picture:** one fixed list of body measures, the same for every exercise
   (joint angles, the trunk against "down", how high the hips are above what the body
   stands or lies on as a share of the leg, where hands and feet are, left against right),
   each with how sure it is. It is worked out once for a video and every movement is then
   checked against it, so the proof table stays fast.
5. **The movement matcher** reads the exercise's movement (§12.3) and answers question 2:
   in position or not, how far through the rep, how well it matches, and why not.
6. **The form judge** runs only inside a matched rep, on the mistakes that exercise names.
7. **The coach** picks at most one line (§12.6). **The summary** is §2.4's.

**Flat picture or 3D: measured, never assumed.** On 2026-11-16, with the heavy model: Kd's
dumbbell bench press clip, filmed from the head end, reads the trunk 171° from upright on
the flat picture and 90° (lying, right) in 3D; his barbell bench press video, filmed from
the feet, reads 1° flat and 31° in 3D where the truth is about 90°. So 3D helps and is not
enough: **each exercise fixes where the phone stands, so that its movement runs across the
picture** (§11.8 step 4's reference picture), and job 50c measures every body measure both
ways on real videos and keeps the steadier.

**As built, stages 2 and 3 (50c-ii, 2026-11-17).** `PossibleBody` (`packages/movement/src/body`)
takes one person a frame and says, for each of the 33 points, used or refused and why: nobody
found, no 3D points, hidden (the model gives it less than an even chance of being seen), off the
picture, settling (the body's first half second, or a bone not yet known), unchecked (what it
hangs from cannot be seen or is not used), a broken bone, a jump, a swap. Every check compares
the body with itself. Each point hangs from a parent on the way to the trunk (shoulder, elbow,
wrist, fingers; hip, knee, ankle, foot; both shoulders, nose, face) and is used only while the
bone to its parent keeps its own length within 0.25 of the same body's trunk and the parent is
used: a wrong elbow takes its forearm and hand with it, a wrong wrist never takes the elbow, and
a hand, foot or head moved in one piece cannot vouch for itself. The trunk's corners are checked
by the trunk's bones. A bone learns its length from frames in which it held; a new steady length
replaces it only after being seen as long as the old one had been seen holding, at least half a
second and at most 3 s, counting only time the bone is seen (a few lone looks never add up), so a
wrong first look is soon replaced and a wrong pose is refused for up to 3 s (held longer, it gets
in: a known limit). A person gone longer than 3 s, or a clock that went back, is
a new body. The allowance is a share of the trunk,
not of the bone: on Kd's videos the model's error does not grow with a bone's length. A point
faster than 20 m/s across the picture has jumped (a kick's foot, the fastest part of a person, is
measured at 12 to 18 m/s); left and right have swapped when each side lies where the other was a
moment before, the two at least a fifth of the trunk apart; either is used again only after it
stays at its new place for 0.2 s. `SteadyPoints` is the one-euro filter on the used points, on
the frames' times: on Kd's one-person videos it takes out 42 to 84 in 100 of a used big joint's
shake, and it trails a hand moving at 1 m/s by 2.3 cm at most. `body-check` sets the fitted
numbers from Kd's six videos, each from five people and tried on the sixth, and draws every
refused frame. What it cannot catch: a slow wrong pose the model is sure of (the squat video's
lifted ankle at 2.8 to 3.8 s passes in all 30 frames; job 52a's two signs); a wrong head at a
right distance from the shoulders (a head moved at random is used in 13 to 16 in 100 frames); at
8 frames a second only a move of more than 2.5 m is a jump; the follower used until job 52d may
follow a reflection. What it costs: a point whose parent is hidden decides nothing, 0 to 5 in 100
of the big joints on the one-person videos (most, the far ankle while the far knee is hidden).

**As built, stage 4 (50c-iii, 2026-11-17).** `BodyMeasures` (`packages/movement/src/body`) takes
the steady points of each frame and gives one fixed list of 38 measures, the same for every
exercise: ten joint angles (elbows, shoulders, hips, knees, ankles), nine leans against "down"
(the trunk from upright; upper arms, forearms, thighs and shins from hanging), six heights above
the floor in the body's own legs (hips, shoulders, wrists, ankles), two widths in its own trunks
(hands apart, feet apart), and eleven left-against-right differences. **Both readings are kept,
never one chosen here:** each measure is read on the flat picture and from the 3D points, and
each movement uses the one that is steadier from its own phone place (job 52a), since neither is
always the better. Measured on Kd's six videos with `measure-check`: side on, the near side is
read flat in every frame it is read in 3D, and the flat reading shakes less for most measures (the
squat's knee 0.22° against 0.40° in 3D); side on, the 3D arms read 15° to 25° away from the flat
picture where the arm lies across it (the squat's straight arms 25° more bent); from the head end
of the bench, the lying man's trunk is refused flat in 319 of 321 frames (the two given read 110°
and 111°, lying) and read lying in 3D in all 321. **How sure.** `shown` is how much of each part
it measures the flat picture shows, its length on the picture against its own length in 3D, parts
laid end to end included, how much of "down" the picture shows for a lean or a height, the lines
from the foot to the hips and on to the points for a height, and the line between the two points
for a width. Below half, the flat reading is not given: the picture's own shake could turn the part
any way. Above half a share proves nothing (round one and its re-check): two parts each shown 0.94
of themselves can bend 40° towards the camera and look straight, and side on a limb bone reads
steadily longer or shorter on the picture than in 3D, each by its own amount (the curl's upper arm
1.38 of itself, the squat's far shin 0.81), so a length can hide a turn. So a flat reading is given
only while it agrees with its 3D reading (`off`, the difference): **within 30° for an angle, 0.15 of
a leg or trunk for a height or width**, each the difference not passed in 95 frames of 100 where
the picture shows every part at cos 10° of its length or more (the 3D points' own error: measured
25.9° and 0.124), raised to the next 5° or 0.05, set by `measure-check` from Kd's one-person videos
(from three of them and tried on the fourth: three folds set 30°, one 25°; on the one left out 93
to 99 in 100 of its flat angles are given). A height is compared above the foot seen in that frame,
in both readings, since the 3D floor is placed by the picture and remembered. What it gives,
measured: a squat filmed from the front, whose knee bends towards the camera and looks straight, is
refused once the bend passes 30°, with the arms hanging or reaching to the phone (a knee bent to
120° is never read straight); side on, the squat's and chair squat's near leg, trunk and heights
are given flat in every frame, the curl's elbow in 145 of 159 (where its 3D arm is more than 30°
off, two models that disagree decide nothing); a flat angle at the edge is given up to 30° off (the
chair squat's folded arm, pointing at the camera, 24° flat and 49° in 3D in the middle); the
squat's feet apart, across her body, never; from the feet of the bench the trunk in 221 of 596
frames, 82° in the middle where lying is 90° (59° in 3D, the video's "down" taken as upright). How
sure a movement needs a reading is its own number, set from its own videos (52a). **Heights**
stand on a remembered floor, where the lowest heel or toes have been: it drops at once to a lower
foot, and rises to the feet only after they have been seen above it for a second, longer than a
body stays up in a jump of 1.1 m (0.95 s), and only when they show the body moved: both feet seen
above it, or one foot as far below the hips in 3D as when it last stood on the floor, within 0.05 of
a leg (a standing foot's drop shakes by 0.042 in 95 frames of 100 on the squat video). So one foot
lifted while the other is hidden leaves the hips at standing height, and a step back from the phone
moves the floor a second later, at once when the body's size on the picture changes by more than
0.15 (while a person stays in place it changes by 4 to 11 in 100 on Kd's videos). A height is read
only while a foot is in view. Checked from outside the code: on the squat, every number of Kd's own
`analyze_squat.py` (2026-09-28, measured its own way) is met within 3° (each rep's deepest knee
within 0.6°, the hips' drop within 0.03 of a leg). The same videos at half the frames a second: 0
to 1 in 100 readings differ on the one-person videos, and 95 in 100 lie within 0.9° to 2.7°. About
105 microseconds a frame on the laptop (the phone's number is job 51's). What it cannot do yet:
heights for a body lying with its feet in the air (the floor is the feet; job 52c's floor work); a
floor first seen, or set afresh, under a lifted foot while the other is hidden; for a second after
a step, heights stand on the old floor; from the head end of the bench, where the legs are seen in
6 frames of 100 and the stand-in follower changes bodies (his size on the picture jumps up to
threefold within 3 s), the hips' height is read flat in 8 frames, 4 of them below the floor, with
the 3D reading agreeing: the leg points themselves are wrong (52d); a reference video's "down" is
taken as upright, so a camera looking down at a bench gives its 3D leans no true "down" (the phone
gives its own).

### 12.3 A movement, and an exercise on top of it

Many exercises are one movement with other equipment (a squat with a barbell, with a
dumbbell, to a chair). So there are two files.

- **A movement:** where the body is, what moves together and how far, what stays still, the
  path and the order, the speed, the kind of counting (a rep · one side at a time · a hold ·
  a fast rhythm · timed only · a jump), and where the phone stands. Built and proven once.
- **An exercise:** the movement it uses, its own ranges, its mistakes from proper sources
  (each checked by the camera, or marked "the camera cannot see this from here"), its words
  and voice lines, and one honest level, which the Library shows: **the camera counts and
  coaches · the camera counts only · count by hand or timer** (a machine that hides the
  body is the third).

Exercises of one movement are twins by declaration: a count of one on the other's video is
expected, never a fault. Every number in either file names where it came from (which
videos, or which source). Adding or removing an exercise changes no engine code.

### 12.4 How one exercise is made (it replaces §11.3 where they differ)

1. Kd names it. The terminal says where the phone stands, which way the person faces, and
   which of the three levels it expects.
2. Kd gives **3 to 5 videos of different people**, filmed from about there with the whole
   body in the picture (1 or 2 for a twin of a movement already proven), and a research
   file on its form; a coach's "common mistakes" video where one exists. He records nothing
   himself, and the terminal does not go looking for videos (Kd: *"that will consume more
   tokken"*).
3. The line measures them (50b). **The numbers are set from all the people but one and
   tested on the one left out, in turn**, so the score says how the exercise does on a body
   it has never seen.
4. The research file says which mistakes matter and what good form is; the numbers of a
   rule come from measuring the videos, since an article's angle is not measured the way
   the camera measures it. A safety claim is checked against one proper source (§11.3
   step 5).
5. The proof of §12.5, then the voice script (§12.6), then the clip (§11.3 step 8).

### 12.5 The proof table (it replaces §11.2 tool 4 and §11.6)

For every exercise, on real videos:

- its own good-form videos count what a person counts by eye, and **no correction is
  spoken on them**;
- each mistake video fires its own mistake and plays its own line, and no other;
- **every other movement's videos count 0 and say nothing**, with the parts of every video
  before and after the set, and a small set of everyday clips found once;
- each video is replayed the ways the world changes it (nearer, farther, the phone tilted,
  fewer frames a second, shaky points, a passer-by) and **as a phone lower, higher or
  turned would see it**, redrawn from the 3D points; the count must hold. The redraw is
  kept only if, drawn from the phone's own place, it lands on the original points;
- §7.6's fuzz and speed gates.

The table runs on GitHub for ALL exercises whenever an exercise or the engine changes. One
page lists every exercise with its real numbers. **The phone tests itself** (job 51): every
exercise's videos are played through the phone's own pose model while it sits on the
cable, and its counts must match the laptop's.

**As built, the phone test (51a, 2026-11-17 and 18; `rulings/2026-11-17-51a.md`).** A folder's
copy of the app holds a test screen, opened only from the laptop's cable, that plays the kept
videos, or the laptop's own decoded pictures of them, through Google's own Android library
(MediaPipe Tasks `tasks-vision` 1.0.0, the laptop's own release line, from the app's own Android
code in `apps/mobile/modules/phone-test`; the store's app holds none of it) on the very frames
the laptop read. `corepack pnpm --filter @app/movement phone-test` sends the files, takes one
file a run back and deletes everything on the phone. A run is **not comparable**, and nothing
in it used, when it read other pictures or ran other settings, or reads its person a wrong way
(a picture late or early, mirrored, the sides swapped, no 3D); **compared only** when the phone
decoded the video itself, which judges its video decoder as well as its chip; **the same** when,
on the laptop's own pictures, it lies within a tenth of the model's own shake from the laptop in
99 of 100 big joints, no joint in any frame further than the shake in 3D or four times it on the
picture, and gives a reading the laptop does not in at most 1 of 1,000; otherwise it
**differs**. A file naming another plan, video or model than the run's is refused, and each kind
of run clears its old files before it sends anything. Whether a chip that differs counts the same is the proof table's question (from
52a: the laptop's count, reason for each rep not counted and spoken line), never this test's.
The library sends Google usage reports by itself (never a picture or a point); a copy's
manifest takes away the transport's only sender. Measured on Kd's phone (motorola moto g35 5G,
Android 15), 66 runs:
- **3D points, and up to four people, from every model on both chips**; where the laptop found
  more than one person, the phone found as many in 16 to 58 frames of 100.
- **The main chip gives the laptop's numbers**: on the laptop's own pictures of the chair squat,
  all three sizes, 0.15 to 0.18 mm in 99 of 100 big joints in 3D (0.02 mm in the middle, where
  the model itself shakes 9 to 11 mm a frame), its largest 3D gap 0.03 to 0.05 of the shake, and
  0 to 1 of 17,024 readings given by one only. Not bit for bit (two processors round their last
  digits apart): on the picture lone joints in single frames reach 1.9 times the shake (one hip
  in 2,121, its 3D unmoved). The same in use. The
  **graphics chip differs**: 49 to 58 mm in 99 of 100 there; phone against phone on the same
  pictures, asked for one person, its big joints lie 0.9 to 2.2 cm from the main chip's in 95
  of 100 on the three standing videos and 2.9 to 5.1 cm on the floor video, the flat near-side
  knee, hip and trunk lean spreading 0.5° to 1.1° with full and leaning 0.3° or less, but one
  far knee in 3D leaning 3.6° (full, chair squat). Decoding the files itself, the phone lies 1
  to 6.5 cm from the laptop even on the main chip: that is its video decoder, and a live
  camera's pictures are not decoded from a file.
- **One picture takes**, the middle, asked for one person / for six: lite 42 / 71 ms on the
  graphics chip and 69 / 128 ms on the main chip, full 54 / 83 and 100 / 151, heavy 137 / 167 and
  278 / 335; a model starts in 0.3 to 1.5 s. The main chip ran on the library's own number of
  cores, which may be one (job 51b counts them first), on a still screen with no camera.
  Heavy cannot run live on this phone on either chip.
- **Asked for one person, the model shakes 2 to 5 times less** than asked for six (on the laptop,
  a used big joint's middle frame-to-frame shake in 3D: 0.9 to 4.4 mm against 4.9 to 11.2 mm on
  the standing videos, 8.6 to 13.1 against 18.0 to 30.6 mm on the floor), and one against six
  moves big joints 5 to 12 cm in 95 of 100. Every kept file and every number 50c fitted was made
  asked for six.
- **The sizes read the body apart, most where a limb points at the camera**: full against heavy,
  asked for one, the flat near-side knee, hip and trunk lean by 1.7° or less and spread 2.8° to
  5.4°, the 3D elbow leaning 10° to 40°. Neither is known to be right there: heavy reads the
  squat's straight arm 25° bent in 3D (§12.2).
- 51a picks nothing; job 51b picks on the live selfie camera.

An exercise that does not pass is published as "count by hand", never with a wrong camera
count. Kd tries one exercise of each kind of movement on the phone, about a dozen, never
each one. After launch the server sees, for each exercise, how often members changed the
camera's count or left the camera for "Count this set myself" (numbers of the finished set
only, inside the privacy ruling of 2026-10-18), and a weak exercise is switched to "count
by hand" with no new app version. The bar an exercise must reach is set from the first
movements' real numbers and written here then; until then it is not a number.

### 12.6 The coach's voice (added to §11.8)

- **Only what is happening in front of the camera** (Kd: *"it should not be static like say
  this line after this line … it should be relevent to the scene"*). A line belongs to one
  thing the engine detects and plays only when that has just happened; nothing plays on a
  timer or in a fixed order. A correction needs the mistake on more than one rep, or held
  long enough, from a phone place that can see it; unsure is silent; good form gets no
  correction. One correction at a time, between reps, the most important first; when the
  mistake is fixed the coach says so; when it returns, another wording; never the same
  line rep after rep. With no line for what happened, the coach is silent, never a
  near-enough line.
- **Proper wording** (Kd: Opus's wording through the project was *"very cheap … like
  talking with friend"*). The terms certified coaches use; a correction says what to do in
  a few words; calm; no slang, hype or jokes; one phrase for one thing in every exercise;
  two or three wordings a line; always a whole sentence, never glued from pieces. The
  register: "Lower your hips to knee level." · "Keep your chest up." · "Keep your knees in
  line with your toes." · "Slower on the way down." · "Better. That's the depth." · "Two
  more." · "Set complete. Rest."
- **Made once where it can be.** The shared lines (the counts, rest, praise, and the advice
  most exercises share) are recorded once, with job 53; an exercise adds only the lines no
  other has.
- **One paste, one download.** The terminal gives a script as one text; Kd generates it on
  his ElevenLabs plan (never the API) and downloads one file; a laptop tool cuts it into
  its lines, names them, evens the loudness, and **reads each cut clip back as text to
  check it says its own line**, since a clip cut or named wrongly would speak the wrong
  advice. Not tried yet: if a batch does not cut cleanly, its failed lines are generated
  one at a time. The read-back needs a free speech-reading tool on the laptop: Kd's yes in
  that job's plan. The script's size is counted against his plan's monthly allowance when
  the first one is written.

### 12.7 Body points, small enough to keep

The body points of four of Kd's videos take 1.7 MB as stored today (measured 2026-11-16),
so 200 exercises with several videos each would be hundreds of MB. Job 50c makes a compact
file for them. A video never goes to git (§11.7).

**As built (50c-i, 2026-11-16).** The engine made fresh lives in `packages/movement`, beside
the old one. Its frame is `movementFrameSchema` in `@app/shared`: the time, the picture's
shape, which way is down (a unit vector in the picture's own frame; a reference video is
`[0, 1, 0]`), and every person the model found, up to six, in no particular order, each
with 33 picture points `[x, y, depth, visibility, presence]` and 33 3D points in metres (or
none). `corepack pnpm --filter @app/movement measure-points "<video>" --keep` turns a video
into a `.bodypoints` file (`scripts/bodyPoints.ts` says its bytes) at 30 frames a second,
asking the model for six people. Each number is rounded once: 1/100,000 of the picture,
1/10,000 for depth and both kinds of sureness, 0.01 mm in 3D, a tenth of a millisecond;
the file says its own rounding and is read by it, so a later change of the steps cannot
read a kept file wrong.
On four of Kd's videos the model's own frame-to-frame shake was at least 0.0009 of the
picture, 0.019 of depth and 1.5 mm in 3D, and the rounding moved no joint angle of a
well-seen joint by more than 0.03°. A damaged file (a check number, a format number, every
length) is refused whole. Measured on his six reference videos: 2,054 frames, 2,406 people
across them, 1.2 MB kept against 13.6 MB as the model gave them; 502 bytes for each person
in a frame against 2,525 a frame in the old trace files; about 14 KB a second of video for
one person, so 200 exercises with four 15-second videos each would be about 160 MB. Where
they are kept once there are that many is job 52a's or 54's question.

### 12.8 The jobs (ROADMAP Stage 5, exercise folder 1; ROADMAP wins where they differ)

| Job | What it builds |
|---|---|
| 50c | The body's picture: the frame's new inputs, compact files, "is this body possible", steady points, the body measures (each read flat and in 3D, with how much of it the picture shows) |
| 51 | The phone test: model and library, speed, heat and battery, 3D points, several people; the phone testing itself on the videos |
| 52a | The movement matcher and the proof table, with the squat movement made fresh as the first proof |
| 52b | The form judge, the reason for a rep not counted, the summary |
| 52c | The other kinds of counting: one side at a time, holds, fast rhythm, jumps, floor work |
| 52d | One person locked on (a busy gym, mirrors) |
| 53 | The camera screen, the shared voice lines and the tool that cuts and checks them |
| 54 | Exercises, movement by movement, towards about 200; no fixed first list |

The phone test is second on purpose: if the phone cannot give 3D points and several people
at speed, the design changes before the matcher is built. Each job is built in a fresh
terminal (Kd, 2026-11-16).

### 12.9 Not measured yet

How fast the main chip reads with more of its cores, which model and chip hold a live selfie
camera for 20 minutes, their heat and battery, and whether the graphics chip's coarser numbers
change a count (jobs 51b and 52a; 51a measured the rest, §12.5) · whether
one long recording cuts cleanly into lines (job 53) · whether a video redrawn from another
phone place is faithful (job 52a) · what the hips do in a real one-leg lift: on the drawn
one they moved at most 0.026 of the trunk's length, while the smallest rise in a real rep
on twelve squat-family videos was 0.110 of the leg's length, under the old rules (job 52a
measures both again with the new engine).

## 13. The Exercise Library and the Workout section, made fresh (Kd, 2026-11-16; `rulings/2026-11-16-exercise-library.md`)

Written by a planning terminal in exercise folder 2 (Fable 5.2) after it read the server,
the member web's workout pages and the phone app that day, and §12 whole. No code. **Where
§11.1, §11.2 tools 6 and 7, §11.4's "different families", Part 4 §3.4 and §3.5, or Part 6
§16.3's "built once, with the workout (item 61)" differ from this section, this section
wins. It never wins over §12, which is not changed by it, nor over §11.8's steps and
privacy, which are Kd's answers and stand.**

**Why.** Kd: *"when i say build the next thing it just build a wrapper on top of the
exsiting bugs and unstructred ai slop code"*. Measured on 2026-11-16:

- One exercise's facts sit in five places: `exerciseCatalog.ts`, `exerciseContent.ts`
  (2,359 lines, a straight copy of the old seed), the `exercises` table (muscles, equipment
  and difficulty empty), the web's `messages.en.js`, and rules that read a family code. Two
  of those rules disagree on "reps or seconds" for 11 of the 58.
- Muscles are free text: 22 different words for the main muscle and 28 for the others.
  Equipment reads "None" for 50 of 58, Skipping Rope and Chair Squats among them.
- A workout keeps no weight, no name and no target. Saved workouts read the switched-off
  backend. The 22 timed exercises are given "12 reps". A set of an exercise the server does
  not know is dropped in silence while the workout is kept. Calories have three formulas,
  chosen by the shape of what was sent. Records are three for a whole workout, none for an
  exercise.
- On the phone, "Exercises" and "My Workout" are two "Coming soon" cards; four features
  each keep their own copy of "kept on the phone until the server has it".

**What is replaced, for all new code.** The five places above as the source of an
exercise's facts; `GET /v1/exercises` and `/v1/exercise-definitions` as what the phone
reads; `POST /v1/workouts/sync` as how the phone saves; the three records of a whole
workout; `workout_templates`' shape.

**What stays.** The saved data: every exercise's row and id, every workout and set. The old
routes, tables' old columns and shared files exactly as they are, for the web's frozen
pages, until Kd says those pages may go; then they go together. §2.4's `SetSummary`. The
level curve, the streak, the meal ideas' rules and the stretches (RULINGS 2026-07-24,
2026-08-06 and its amendments). Nobody adds an exercise of their own (RULINGS 2026-08-16).
Everything a member can do today (§13.8).

### 13.1 The principles

1. **One fact, one place.** Everything the Library knows about an exercise is in that
   exercise's own file. Nothing is typed twice, and nothing is worked out from a code that
   means something else.
2. **New code never uses the old exercise code.** A lint rule refuses an import of
   `exerciseCatalog`, `exerciseContent` or the family-code helpers from `apps/mobile` and
   from the new server modules, so it is GitHub that holds this, not a promise. The server
   and phone code that use them today (`goals/service.ts`, `orgs/challenges/service.ts`,
   `summaryContent.ts`, `Goals.tsx`) move to the new facts in the job that reaches each.
3. **The camera's facts are exercise folder 1's** (§12.3): what the camera can do for an
   exercise, where the phone stands, which mistakes it checks. This side reads them and
   never types them again (§13.3).
4. **Adding or removing an exercise is data.** No new app version, no code change, and a
   removed exercise is retired, never deleted: old workouts still show its name.
5. **The server works out what has value**: calories, XP, records. What a phone reports is
   held inside limits.
6. **What a person does is kept on the phone until the server has it**, by ONE shared
   piece, and a workout in progress is written to the phone at every step.
7. **An installed app never breaks on new data.** A word list may grow: a phone that meets
   a word it does not know shows it plainly and goes on.

### 13.2 An exercise's file (the Library's part)

One file for each exercise, named by its id word, in `packages/shared/library/exercises/`
(job 60a), with the Compendium table beside it (`packages/shared/library/compendium.json`).
The tools find the files by reading the folder: there is no hand-kept list. The word lists
and the file's rules are `packages/shared/src/library/`; its check runs in that package's
tests, so GitHub refuses a faulty file.

| Fact | Rule |
|---|---|
| Id word | lower case, never changed, never used again for another exercise; an exercise that continues from the old 58 keeps its row and id |
| Name, other names | the other names are for search ("press-up" finds Push-up) |
| Kind | one of: strength · cardio · plyometrics · stretching · mobility · yoga · Pilates (60a, from the old web's 11 categories and the public list's 7: body areas are the muscle filter, "bodyweight" the equipment filter, HIIT and endurance are cardio, powerlifting, Olympic lifting and strongman are strength; "Rehabilitation" is dropped, a health claim for a fitness app) |
| Muscles | main and also-worked, from ONE fixed list: abdominals, abductors, adductors, biceps, calves, chest, forearms, glutes, hamstrings, hip flexors, lats, lower back, middle back, neck, quadriceps, shoulders, traps, triceps |
| Equipment | from one fixed list (60a): barbell, dumbbell, kettlebell, EZ curl bar, weight plate, cable machine, machine, Smith machine, resistance band, pull-up bar, dip bars, gymnastic rings, suspension trainer, bench, box, step, chair, jump rope, medicine ball, exercise ball, foam roller, mat, treadmill, rowing machine, exercise bike; empty means none, and a wall or the floor is not equipment |
| Level | beginner · intermediate · advanced |
| A set is measured in | reps or time. This is what a set's target is, said once; it replaces every family-code rule |
| Weight | a set never takes one · may · usually does |
| Each side | whether a set is done for each side |
| Starting numbers | the sets and target offered when it is added to a workout; the person changes them |
| Energy (MET) | the file names a code of the 2024 Adult Compendium of Physical Activities; the MET is read from the Compendium table, copied from the Compendium's own pages, and is never typed in an exercise's file (60a) |
| About, steps, mistakes, cautions | in proper wording, each from a named proper source (§11.3 step 5); a caution is its own fact, never a step, and as strong as its source says it (60a); text is kept by language, English first |
| Clip, still picture | empty until job 62 |
| Status | live · retired. Before launch a file may simply be deleted (Kd, 2026-11-17: no real members yet); after it, an exercise is retired |

An exercise's page is written and checked for this file (job 65); the old text is never
copied across in bulk. A draft may start from the public-domain list free-exercise-db (the
Unlicense; 876 exercises with muscles, equipment and steps, read 2026-11-16) and is then
checked against proper sources.

### 13.3 Where the two exercise folders meet

§12 names two places: the exercise's file and the set's summary. This is what this side
gives and expects there. Nothing here changes §12; where 52a's or 53's plan needs it
otherwise, that plan says so and this section is amended.

- **The level.** The Library shows §12.3's three levels in its words: the camera counts and
  coaches · the camera counts only · count by hand or timer. It is read from folder 1's
  data for that exercise. An exercise with no camera data is "count by hand or timer". The
  old three definitions do not make an exercise camera-counted on the phone.
- **Camera data rides the same download, unopened.** Folder 1's movement and exercise files
  are checked by folder 1's own code when the list is published, and sent to the phone as
  they are, with their versions and §9.3's beta and live. A level lowered on the server
  reaches every phone with no new app version (§12.5).
- **One list of mistakes.** Until an exercise has camera data, its mistakes are words in
  its Library file. Once its camera data lists them with "checked by the camera" or "the
  camera cannot see this from here", that list is the one shown, and publishing refuses
  two lists.
- **A set's summary** is taken as §2.4 gives it; fields may be added there, and this side
  reads none it does not know.
- **The camera screen** (job 53). The workout asks for one set to be counted and gets back
  that set's summary, or "count by hand". A camera failure turns the set into by hand and
  the workout goes on (§11.8).
- **For §12.5's numbers after launch** a saved set keeps the camera's own count beside the
  final count, and whether the person left the camera to count by hand.
- **Pictures and sound.** Job 62's store may also hold the reference pictures and the voice
  lines, if folder 1's jobs choose it.

### 13.4 Publishing, and the phone's download (job 60)

- **Publishing is a part of its own**, run when the server is deployed and by the local
  seed. It reads every exercise file and refuses the whole publish, naming the file and the
  fact, for: a word outside a fixed list, a missing fact, two exercises sharing a name or
  other name, a number outside its limits, a Compendium code the table does not hold, a
  misspelt fact. The same check runs on GitHub, so a faulty file never merges (60a). A
  deleted file is not refused (Kd, 2026-11-17); 60b keeps the row of an exercise whose file
  is gone, hidden, while saved sets still name it.
- It writes each exercise's row (its id, status and the facts the server reckons with) and,
  only when the content changed, one new numbered copy of the whole list for each of beta
  and live. A published copy is never changed; going back is pointing at the copy before.
- **One download** for a signed-in phone: the whole list, the retired ones marked so that
  history can name them, and folder 1's camera data. It carries its own fingerprint, and a
  phone that already holds it is answered "not changed". Its size at 200 exercises is
  measured in job 60 and written here.
- The old routes are left exactly as they are, with nothing added.

**As built in 60b (2026-11-18).** Publishing is `apps/api/src/modules/library/publish.ts`, run by
the seed after the old rows. The download is `GET /v1/library` (`libraryDownloadSchema` in
`packages/shared`): the fingerprint, the copy's number and the list; a signed-out caller gets 401.
- **Rows.** `library_exercises` holds one row for each published exercise: its status, its MET read
  from the Compendium table, its code, reps or time, weight, each side, and its whole entry. An
  exercise that continues from the old 58 (squat, plank) keeps its `exercises` row and id; the old
  58 rows and their own MET are not changed (squat 6.0 there, 3.0 in the Library). Any other gets a
  new `exercises` row with none of the old camera facts, 'hidden' to the old routes (migration
  0243). New code reckons with the Library's MET. The old save route counts a set of such an
  exercise as unknown, as it does any name it does not know.
- **A deleted file.** Its Library row stays, 'hidden', while a saved set names it, and the download
  carries its last entry so that history names it; once no set names it, the row goes. Its
  `exercises` row stays, so its id word is never given to another exercise. "Named" means a saved
  set today; job 61 adds its saved workouts to that check.
- **Copies.** `library_copies` holds each copy's exact text, so the fingerprint is the text's
  sha256. A copy is added for each of live and beta only when the text changed; beta is the
  `beta_definitions` flag's list, and while beta has no copy a tester gets live. There is no going
  back to an older copy (Kd, 2026-11-18: no real members yet): a mistake is fixed in the file and
  published again. One publish runs at a time; a second waits and then finds nothing changed.
- **Measured at 200 exercises** (2026-11-18, `apps/api/tools/measure-library.ts`, local database,
  five runs, medians): publishing a new list of 200, 101.5 ms in all, of which 21.7 ms holds its
  process; it runs in the seed's own process at a deploy, never in the api. The download is
  343.5 KB as the api sends it. Compressed, the real list is 606 bytes an exercise (1,730 as sent),
  so about 120 KB at most for 200 different exercises (the 7.2 KB the tool prints is of copies of
  three files and too low). A download's own work in the api: 5.6 ms the first time a copy is read
  (its fingerprint and its check), then 0.3 ms from memory.
- **For job 63:** the phone reads `libraryDownloadSchema`, which refuses a word it does not know;
  principle 7 asks the phone to show such a word plainly and go on, so the phone's own reading of an
  entry is looser than the server's.

### 13.5 What a workout keeps (job 61)

- **The save** is one whole workout under the id the phone made. Sent twice it is one
  workout, and XP and the streak are given once. Somebody else's id is refused as not
  found. The old save route stays for the web, untouched.
- **A workout:** its name, start and end, the person's time zone, what it was started from
  (their saved workout, the app's plan, the gym's plan, or nothing), the effort stars, and
  the heart rate from a connected monitor (Kd, 2026-11-12).
- **A set:** the exercise, its place in the workout, its target and what was done (reps or
  seconds, and weight), the rest taken, how it was counted (camera · by hand · timer), and
  for a camera set the summary of §2.4 with the two facts of §13.3. Weight is kept in whole
  grams and shown in the person's kg or lb.
- **An exercise the server does not know refuses the whole save with a reason the phone
  understands.** The phone keeps the workout, reads the list again and sends it again.
  Nothing is dropped in silence.
- **Limits and reckoning.** Reps, weight, time and the number of sets are held inside
  limits, time against the workout's own length, and the route has its own rate limit. The
  server reckons calories with ONE formula with a version number (MET, the person's weight,
  the active time), XP by the kept level curve, and the records.
- **Records for each exercise**, worked out from the sets when read and never stored:
  heaviest weight, most reps, best set by estimated one-rep max (Epley's formula, named on
  the screen as an estimate), longest hold, most lifted in one workout. "New record" is
  told against everything before that workout.
- **A planned workout** is one shape: a name and, in order, exercises with their sets,
  targets, weight and rest. A person's saved workouts use it now (list, save, delete, with
  a limit for each person); the app's weekly plan (item 36) and the gym's plan (Stage 2's
  24b) use the same shape when their folders build them.
- **History:** a month, a day's workouts, and one workout set by set.
- **The other readers** (goals, XP, the boards, the gym's numbers) keep reading the same
  tables; a new column is empty for an old row, and a camera set is still marked as the
  engine's so none of them changes. Every new column or table joins the privacy download
  and delete lists and the policy's words in the same pull request.

### 13.6 The phone (jobs 63 and 64)

- **The list is kept on the phone** and searched there, so search answers at once and works
  with no internet after the first open. Search reads names, other names, muscles and
  equipment, with name matches first. Filters: muscle, equipment, level, kind, and how it is
  counted (the three levels).
- **An exercise's page:** the clip or its still picture, the level in one line, equipment,
  muscles, about, steps, mistakes (each with its tick or "the camera cannot see this from
  here" once folder 1 has it), the person's own records, and Add to workout.
- **The Workout tab** follows §11.8's steps as Kd gave them: Choose the plan you want (the
  app's, the gym's, your own); one screen for the whole workout; Camera or Count myself
  picked every time; a set's target from the plan or the person, never from last time; the
  set ends by itself at its target.
- **The workout's steps are one pure piece**: the same presses in give the same state out,
  tested as a table (start, a set done, rest, skip, pause, stop, the phone closed and
  opened). The screen only draws it. It is written to the phone at every step, so a dead
  battery loses nothing.
- **Kept until saved, built once.** One shared piece holds what waits for the server, with
  the three answers the app already knows (saved · refused · no answer). Job 64a builds it
  with the workout. The four older copies (meals, weigh-ins, runs, minutes) are not
  rewritten here.
- **Ids** are made from the phone's proper random source, never `Math.random`.
- **Goals' exercise picker** reads this list (names, and "measured in reps") from job 63.
- Sound in a workout uses one player, shared with job 53; whichever job comes first asks
  Kd for the package.

### 13.7 The jobs (ROADMAP Stage 5, exercise folder 2; ROADMAP wins where they differ)

| Job | What it builds | Waits for |
|---|---|---|
| 60a | One file for each exercise, the word lists, the check that refuses a faulty file, the lint rule | nothing |
| 60b | The list on the server: publishing, its rows, one download for the phone | 60a |
| 61 | What a workout keeps: the save, saved workouts, records, history | 60 |
| 63 | The Exercise Library on the phone | 60 |
| 64a | Build a workout, do it by hand or by timer, the summary, history | 61, 63 |
| 62 | The clip line, and where clips are kept | 60; its check of a clip against its exercise's rules waits for folder 1's 52a and 52b |
| 64b | The camera in the workout | 64a and folder 1's 53 |
| 65 | Each exercise's Library page, towards about 200 | 60; alongside the rest |

The numbers stay because other lists point at them (items 36, 38 and 39, Stage 2's 24b).
All camera rules are folder 1's job 54; this folder writes none. Which exercises the
Library holds is Kd's list: job 65 brings him names to cross out or add.

### 13.8 Nothing a member can do today is lost

Read in the member web on 2026-11-16. Each line is ticked by the job named.

| What a member does today | Job |
|---|---|
| Search exercises; filter by category and difficulty; A to Z; 20 at a time with Load more; "none found" with Clear filters; "could not load" with Try again | 63 |
| An exercise's card and page: picture, clips, difficulty, equipment, calories a minute, reps or time, sets, about, how to do it, common mistakes, main and other muscles; a link that opens one exercise | 63 (clips: 62) |
| What the camera can do for it, said on the card (was "AI Supported") | 63, from folder 1's data |
| Add to workout, no repeats; My Workout with its count | 63, 64a |
| Name a workout; its exercises, estimated time and calories; move up and down, remove; sets, reps or time, rest; Clear; Add more | 64a |
| Save a workout, list saved ones, load, delete with a question first | 61, 64a |
| Start; camera or count myself | 64a, 64b |
| The timer, "Exercise 2 of 5", the exercise's clip beside it, target and done, +1, change the target, reset the set, Complete set, Skip exercise, Pause and Resume, stop with a question first, Next up, the screen kept awake | 64a |
| The rest ring, 15 seconds more or less, Skip rest, Coming up next, the next set starting by itself; the sounds at a rep, a set's end and the last 3 seconds | 64a |
| Setting up the camera; the camera's count, skeleton, one correction, the form score, Count this set myself, the voice and its switch | folder 1's 53, opened by 64b |
| After it: the confetti, time, calories as an estimate, exercises, form, grade, XP and level, streak, personal records, effort stars, meal ideas with the allergy caution, stretches, the water reminder, New workout | 64a |
| The share card | feature folder 2's item 39 |
| History: the calendar's days and a day's workouts; recent workouts | 61, 64a |

Better than today, said to Kd on 2026-11-16: weight for each set; a timer for a timed
exercise where it was "12 reps"; the name and the stars saved; records for each exercise;
a workout that survives a dead phone; a summary set by set.

### 13.9 Not measured yet

The download's size and the publish time at 200 exercises (measured in 60b, §13.4) · many saves arriving at
once (job 61; CLAUDE.md §4, "Cost at full size") · where clips are kept and what that
costs each month (job 62, with Stage 4 item 4) · how long Kd's hand time for 200 generated
clips is (job 62 says it before the first one).

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
