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
   from the first job. As built in 52d-i: §12.5 "As built, one person locked on".
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
bone to its parent keeps its own length within 0.3 of the same body's trunk (0.25 until 51c) and the parent is
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
the frames' times: on Kd's videos that set numbers it takes out 21 to 54 in 100 of a used big joint's
shake on the picture and 32 to 73 in 3D (51c; 42 to 84 before), and it trails a hand moving at 1 m/s by 2.3 cm at most. `body-check` sets the fitted
numbers from Kd's videos that set numbers, each from all of them but one and tried on the one left out, and draws every
refused frame. What it cannot catch: a slow wrong pose the model is sure of (the squat video's
lifted ankle at 2.8 to 3.8 s passes in all 30 frames; job 52a's two signs); a wrong head at a
right distance from the shoulders (a head moved at random is used in 16 to 22 in 100 frames since 51c, 12 to 14 at 0.25; no measure reads the head); at
8 frames a second only a move of more than 2.5 m is a jump; the follower used until job 52d may
follow a reflection (since 51c the model itself follows one body; see "As built, measured again"). What it costs: a point whose parent is hidden decides nothing, 0 to 6 in 100
of the big joints on the videos that set numbers (most, the far ankle while the far knee is hidden).

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
25.9° and 0.124), raised to the next 5° or 0.05, set by `measure-check` from Kd's videos that set numbers
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
`analyze_squat.py` (2026-09-28, measured its own way on the heavy model's points, and checked on the heavy model's own file since 51c) is met within 3°, the 3D knee within 3.5° since 51c (each rep's deepest knee
within 0.6°, the hips' drop within 0.03 of a leg). The same videos at half the frames a second: 0
to 1 in 100 readings differ on the videos that set numbers, and 95 in 100 lie within 0.9° to 2.7°. About
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
  kept only if, drawn from the phone's own place, it lands on the original points. **Since
  2026-11-20 the phone standing on the floor is the first place a count must hold** (Kd:
  most members will stand it there), proven on real floor videos where there are any, and
  the redraw is kept only if it also reads as those real videos do ("As measured and
  planned, a phone on the floor", below);
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
  cores, which is one (51b-i measured it), on a still screen with no camera.
  Heavy cannot run live on this phone on either chip.
- **Asked for one person, the model shakes 2 to 5 times less** than asked for six (on the laptop,
  a used big joint's middle frame-to-frame shake in 3D: 0.9 to 4.4 mm against 4.9 to 11.2 mm on
  the standing videos, 8.6 to 13.1 against 18.0 to 30.6 mm on the floor), and one against six
  moves big joints 5 to 12 cm in 95 of 100. Every kept file and every number 50c fitted was made
  asked for six, until 51c measured them again asked for one.
- **The sizes read the body apart, most where a limb points at the camera**: full against heavy,
  asked for one, the flat near-side knee, hip and trunk lean by 1.7° or less and spread 2.8° to
  5.4°, the 3D elbow leaning 10° to 40°. Neither is known to be right there: heavy reads the
  squat's straight arm 25° bent in 3D (§12.2).
- 51a picks nothing; job 51b picks on the live selfie camera.

**As built, the main chip on more cores (51b-i, 2026-11-18).** The library's Android door has no
cores setting; its own settings have one (XNNPACK's number of threads), reached from the app's own
debug code (`PhoneTestCores.java`, in the library's package, which only replaces the chip's part of
the settings and refuses anything but the main chip). A run names its cores in its file; a file on
other cores than the run asked for is never judged as it, nor one asked for 2 or more cores that kept
1.3 or fewer busy (the file says back the plan's number; only the cores busy show the phone took them).
Each picture's reading also writes the app's time on the cores, so a run says how many it kept busy.
Measured on Kd's phone (a Unisoc UMS9620, eight cores: four at 2.2 GHz, four at 2.0;
`measured/phone-test/phone-facts-51b-i.txt`), 40 runs, asked for one person, on the laptop's own
pictures of the four one-person videos:
- **The library's own number is one core** (1.03 to 1.05 busy), and its numbers are XNNPACK's on one core.
- **More cores change nothing in the numbers**: on 1, 2 and 4 cores every point of every picture is
  the library's own, digit for digit, on all four videos with both models (33,495 points a model).
- **They make it faster** (the middle / 95 in 100 of a reading, over the four videos): full 103 / 123 ms
  on its own, 68 / 83 on 2 cores (1.54 to 1.66 busy), **52 / 68 on 4** (2.25 to 2.68 busy); lite 80 / 98,
  54 / 70, 44 / 59; the graphics chip full 69 / 77, lite 51 / 57. Full on 4 cores is faster than full on
  the graphics chip in the middle on the three 1080-wide videos (49 to 56 ms against 68 to 72), not on
  the 720 by 1280 chair squat (47 against 46); lite on the graphics chip is the faster in 95 of 100 (57
  against 59) and on the chair squat (33 against 40). 51a read the graphics chip faster (full 54, lite 42
  ms, the phone decoding the videos itself, thermal status 1); here it read the laptop's pictures, at
  thermal 1 on the squat and 2 after, and the squat's full run was 72 ms at 1: why is not known. Which
  is faster live is 51b-ii's. Seen from outside (`top -H`) during a 4-core run: three helper threads of
  the library at about 27% each beside the test's own. Android's thermal status reached 2 ("moderate"),
  on the charging cable.
- **Asked for one person, no chip gives the laptop's numbers, the main chip included**: the library
  looks for the body where its last points were, so the last digits two processors round apart are
  carried from picture to picture and grow (the squat's hip 0.01 mm apart in the first picture, up to
  7 mm later). That the main chip is the laptop's model holds asked for six (51a), where it looks afresh
  in every picture. So the laptop's numbers are judged on a phone by the count and the reasons (52a),
  never by its points. How far apart, big joints in 3D in 95 of 100 (standing videos / floor video), and
  the flat knees, hips and trunk lean, the largest lean and spread:

  | | full model | lite model |
  |---|---|---|
  | the phone's main chip against the laptop | 1.3 to 1.4 cm / 4.0 cm; lean 0.3° or less; spread 0.4° to 1.3° standing, 3.9° on the floor | 1.8 to 2.2 cm / 4.4 cm; lean up to 1.3° (the squat's right hip and knee); spread up to 10.3° standing (the squat's right knee; 5.6° otherwise), 4.0° on the floor |
  | the graphics chip against the main chip | 1.4 to 1.8 cm / 3.9 cm; lean 0.4° or less; spread 0.4° to 1.7° standing, 2.9° on the floor; the largest in any picture 5.6 cm standing, 50.4 cm on the floor | 1.9 to 2.1 cm / 4.6 cm; lean 0.4° or less; spread up to 4.6° standing, 3.9° on the floor; the largest in any picture 8.2 cm standing, 14.1 cm on the floor |

  The graphics chip is about as far from the main chip as the main chip is from the laptop (full: 1.4 to
  1.8 cm against 1.3 to 1.4); lite is up to twice as far as full, so 52a's "largest gap on a chip the app
  allows" is lite's numbers wherever lite is allowed.
- 51b-i picks nothing; the live runs are 51b-ii's: full on the main chip on 4 cores, full on the
  graphics chip, lite on the main chip on 4 cores.

**As built, the live camera (51b-ii, 2026-11-18).** A folder's copy holds a second test screen, opened only from
the laptop's cable (`PhoneTestLive.kt`), that runs the phone's own camera as the camera screen will: CameraX's newest
picture at 480 by 640, turned upright and mirrored for the selfie camera as Google's own Android sample does, the
library's live mode (it drops a picture while it is busy), asked for one person, the camera and the skeleton drawn.
`corepack pnpm --filter @app/movement phone-live` sends the plan and the models, lets the copy use the camera (and
takes it back after, when the copy did not have it), shows one still picture of a person and then Kd's four one-person
videos full screen on the laptop for the phone's camera, keeps the laptop awake, waits for the phone to come back to
the cable, takes its files back and deletes everything it sent. Nobody exercises and nobody is filmed, and no picture
is ever written: a run writes, each second, the camera's pictures, the model's answers, those that found the body, the
wait from a picture to its answer and the app's time on the cores; each minute, heat, battery and memory. Each set-up
of the ladder runs 20 minutes off the charger, cooling between runs (at least 10 minutes, until the phone is no warmer
than at the first run's start, at most 30); a run the cable goes into is dropped and made again. `phoneLive.ts` judges
each run: **not fair** when it is not that step's run (its plan, step, camera, model, people, chip, cores or picture
size), is short of 20 minutes by its count or by its real length, had the charger in at any moment, saw the body in fewer
than 80 in 100 answers in any minute, or kept 2.7 cores or fewer busy when asked for 4 (the app's own camera, turning and
drawing kept 1.65 busy with the model on the graphics chip, so one core more; 51b-i's 1.3 was set with no camera; a
main-chip step asked for another number of cores has no bar and is never judged); or, having fallen short, when the
model was waiting for the camera (it answered 95 in 100 of the camera's pictures), the battery saver was on, the
battery fell to 15%, it started above Android's thermal status "light" or with the battery above 40 °C (the first run
included, so a test started on a hot phone is never stepped past), or it started warmer than the first run; **holds**
when, fair, every minute answers 15 times a second or more, over each second's real length; otherwise it **falls
short**. A step with a note of a failed start is not fair, a still body is read only as the look the plan asked for, and
files kept beside another plan are refused. The pick is the first step that holds, every step above it having fallen
short in a fair run: a step not run fairly is run again, never stepped past. Measured on Kd's phone (moto g35 5G), the
phone facing the laptop's screen, the second try (the first ran its first run on the charger and was stopped):
- **Full on the main chip on 4 cores held** (3.82 cores busy): 24.6 to 25.3 answers a second in its first four minutes,
  then, the phone warm, 17.4 to 20.0 in every minute after (its slowest second 8); the wait from a picture to its answer
  74 ms in the middle, 94 to 96 once warm; the body found in 89 to 94 in 100 answers; 7% of the battery in 20 minutes
  (69% to 62%), the battery 32.8 to 37.8 °C, Android's thermal status 1 at the start and 2 after; the app 242 to 343 MB,
  no growth, 712 to 1,041 MB of the phone left free. **It is the pick.** Its margin over 15 is about a sixth in its
  slowest minute (17.4) and a fifth to a quarter in the other warm minutes (18.2 to 18.8), before the camera screen adds
  the engine, the voice and its own drawing: job 53 measures it again on the real screen.
- **Full on the graphics chip** answered 27.1 to 28.1 a second on 1.65 cores, cooler (31.8 to 33.3 °C, thermal 1 until
  minute 15), 6% of the battery; **not fair**: the camera saw the body in only 57 to 77 in 100 of its answers. **Lite on
  the main chip on 4 cores** answered 18.1 to 29.8 a second on 3.30 cores, 8% of the battery; **not fair** the same way
  (62 to 81 in 100 in its first ten minutes, 94 to 96 after). Why the body was lost in those two runs and not in the first
  is not known; neither changes the pick, since both stand below it.
- **A still body, from the laptop's screen** (not a person in the room), full on the main chip on 4 cores, on the
  cable: the back camera 24.3 answers a second, its used big joints shaking 1.4 mm in 3D in the middle; the selfie camera
  25.7 a second, 2.1 mm. (The first try's report gave 2.7 mm and 2.1 mm; its files were not kept.) The selfie camera is
  not steadier than the back one here; how either reads a person 2 to 3 m away is job 53's.
- **The selfie camera's picture is mirrored before the model reads it**, as Google's own Android sample does, so the
  model's left is the person's right. It changes neither speed nor shake; the form rules compare left against right, so
  job 53 decides knowingly how the camera screen hands the picture over.
- Nothing chosen is Android's alone: the same model and the library's own settings exist on an iPhone, which gets its own
  test (§12.5, 51a).

**As built, the kept videos measured again (51c, 2026-11-18; `rulings/2026-11-18-51c.md`).** Every kept file is now
what the phone runs reads: Google's full model, asked for one person, at 30 frames a second
(`scripts/keptVideos.ts` names the model; `measure-points` makes that by default and `--keep` refuses any other). Asked
for one, the model gives one body in every frame whoever it is, so **which videos may set a fitted number is written,
never inferred**: a video sets numbers only when a terminal has drawn it (16 frames spread over the whole video) and
seen the person exercising in each frame drawn (`KEPT_VIDEOS`, with what the pictures showed), that look names the very
file by its SHA-256 (a file measured again sets nothing until it is looked at again), the file is the phone's model
asked for one person at 30 frames a second, every frame holds one body whose size can be read, and **the plain sign of a
changed body** finds none: the body's middle moving faster than a jump's take-off (5 m/s; for a jump of 1.1 m,
√(2 · 9.81 · 1.1) = 4.6) or its size on the picture jumping by more than 1.25 times from one frame to the next
(`bodyChanges`, `scripts/follow.ts`; across a frame with nobody, the body after is judged against the body before). Measured: on the six new files the middle moves at most 1.5 m/s and the size at most
1.12 times, and the sign finds nothing; on the old six-person bench files, with the stand-in follower, it finds 80
changes each (up to 27.6 m/s and 4.5 times); a woman put in the squatting woman's place 0.38 m off is found (11.3 m/s);
another body of the same size in the same place is not (job 52d). A video nobody has looked at sets nothing.
- **The two bench videos follow the right man** in every one of 16 frames drawn each (never the reflection), and still
  set no number: filmed from the ends of the bench, the model marks the head-end man's knees and feet hidden in 98 frames
  of 100 and puts the barbell man's knees off the picture in 64 and his feet below it in all. They try the refusals.
- **The numbers set again by their rules**: the bone allowance 0.3 of the trunk (was 0.25); steady on the picture 2 Hz at
  rest +10 Hz a m/s (was 0.5 +10), in 3D 0.05 Hz +20 (was 0.05 +10); the angle limit 30°, the length limit 0.15 and the
  floor's size change 0.15 unchanged. Set from three of the four and tried on the fourth: the bone 3 of 4 folds, the picture
  4 of 4, 3D 2 of 4 (without the chair squat the other three set 0.25 Hz +10, which leaves her moving joints 1.14 cm
  further off than the model's own shake, over the rule's 1 cm: the 3D setting rests on the four together). **The bicycle crunch sets the bone allowance**: twisting, his far leg straightens and its 3D length
  changes, so at 0.25 his real left knee and foot are refused in 16 frames from 0.6 to 1.5 s (1.1 in 100 of his sure
  joints, above the rule's 1 in 200); without him the others set 0.2. The price: a head moved at random is used in 16 to
  22 frames of 100 (12 to 14 at 0.25); no measure reads the head.
- **Found**: at 0.57 s of the crunch the phone's model swaps his legs for two frames (his left knee thrown 16.6 m/s and
  back at 13; a knee in a crunch moves 0.4 to 3): the check refuses both legs as swapped until 1.1 s. Drawn 1.3 times
  bigger the same throw passes the jump limit, is refused as a jump, the swap is not seen and his wrong right leg is used
  for a few frames (a known limit, 52a). From the side, the phone's model marks the squatting woman's far knee hidden in
  every frame, so her feet apart is read in no frame (the heavy model read it in 3D in 73).
- **Against Kd's own squat measuring** (made on the heavy model): the engine's measuring, on the heavy model's own file
  (`test/outside`), within 3° and the 3D knee within 3.5° (its looser 3D steadying reaches 2.1° to 3.2° deeper at the
  bottom than his median filter); the phone's model on the same video, from his numbers: the deepest knee 0.2° to 2.8°,
  the hip 0.9° to 3.0°, standing, the knee 4.3° and 4.8°, the hip 0.5° and 2.3°.
- **The body's half-rate and steadiness**: at half the frames a second, 0 to 0.7 in 100 of big joints answered
  differently (the bench videos now 0.2 and 0.4, from 3.2 and 3.3); readings 0 to 1 in 100, 95 in 100 within 0.5° to
  2.1°.

**As built, the movement matcher and the squat (52a-i, 2026-11-19; `rulings/2026-11-19-52a-i.md`).** A movement is
a file (`packages/movement/movements/squat.json`, checked by `movementSchema` in `@app/shared` and by `checkMovement`
before it is trusted: rule names of letters, digits and spaces, one depth rule above 0, the drive and a rise on a height,
"apart" on a left-against-right measure, a rep's time over the rep). It names the drive (the measure whose fall is the
rep: for the squat, the hips' height, read on the picture only, since from the front the 3D heights drift by up to a
third of a leg while a person stands still), what standing tall is (knees within 20° of straight, the trunk within 20° of
upright, not fitted), and its rules, each read in the person's own terms. **Two roles:** a "count" rule says how far a
rep went (depth, knees bent): a rep that fell short, having gone at least three quarters of the way on every count rule,
is not counted and says why; a "match" rule says what kind of movement it was (hips and knees bending together, chest up,
feet stay down, feet stay in place, stance holds, hips alike): a rep that breaks one, or a dip that never tried, is
another movement, with no count and no word. A rule the camera must see is unseen, and the rep decides nothing, when its
readings break off anywhere in the rep or the 0.3 s after it for longer than 0.1 s or one and a half frame steps; one
marked "when seen" (stance holds, hips alike) is checked only where the phone's place shows it. A left-against-right
reading counts only when the picture and the 3D points both see the sides differ (a man's leg pointing at the camera read
173° on the picture and 137° in 3D). The feet are read on the picture against the body's size while standing (from the
front the size read from the thighs lags about a second behind a squat, and still feet and hips seemed to move): heels
and toes for where they stand, from the top of the rep before; for leaving the floor, each foot's rise above the lowest
place it reached in the same rep (never from the top before: in reps with no pause a hop's feet are already leaving the
floor as the rep before comes back up), its heel and toes both, and both feet where both are seen (side on, the far foot
wanders 4 to 5 cm at the bottom of a real squat), a point back from hiding starting afresh. Standing is the highest still
standing remembered; a
lower one is taken only once held for a second, so a slow descent never becomes the new standing; a repeated frame
decides nothing; at the end of a set a rep counts only once back up for 0.3 s (on Kd's four squat-jump videos the feet
leave the floor from 0.17 s before to 0.2 s after the hips are three quarters up, in 18 take-offs of 19). `MovementMatcher`
(`packages/movement/src/movement`) is pure, about 22 microseconds a frame in the middle and 60 at most on the laptop (measured after round one).
**The numbers** are set by `movement-check` from eight people (Kd's folder `D:\exercise video collection`, 2026-11-19,
and his reference squat), from the reps counted by eye (the deepest dips of each video, as many as were counted): a count
rule a quarter of the way back towards standing from the shallowest rep; a match rule beyond the furthest rep by half its
distance from the middle rep; each person left out in turn. **Measured:** the eight people (2 side on, 4 from the front,
2 in between; 24 reps) count what was counted by eye with the squat's numbers and with themselves left out, and the same
at 7.5, 8 and 10 frames a second; the chair squat (2) and the kettlebell goblet squat (2) count right with every set of
numbers; 28 videos of other movements (jumps, squat jacks, lunges, split squats, step-ups, deadlifts, Romanian deadlifts,
swings, good mornings, rows, calf raises, presses, curls, a crunch, two bench presses) count 0 with every set of numbers
and are given no word; a real squat turned by hand into a hop of 5 to 15 cm at the top, or with the feet carried out
wide, counts 0, and so does the hop with the feet or the whole body hidden in the air, and hops of 10 and 12 cm starting
0.2 s before each rep is back in five reps with no pause. The limit: leaving the floor is told from about 3 cm. **Then fresh**, 39 videos never looked at while
the rules were first chosen: 33 of 34 other movements count 0; **a kettlebell push press counts 3 of its 4 dips** (knees
120° to 127°, the hips 0.15 to 0.19 of a leg down, as deep as the shallowest squat of the eight): open, for 52b, where the
squat's depth is set from its form standard; of three squat variants on a still camera, the plate goblet squat (4) and a
Smith machine clip that starts low (0) count right, and **the barbell front squat counts 2 of 3** since round one's
re-check (her third rep, rising in the video's last 0.3 s, reads both feet 3.1 cm up, over the 3 cm number: open, a missed
rep, for 52a-ii); two whose camera pans or tilts are reported, never judged
(a moving camera makes still feet look as if they moved). Each video is played with its first and last pictures held
for a second (a live set starts and ends with the person in view; the engine learns a body in its first half second).
The 72 files take 7.7 MB in git (§12.7: where 200 exercises' files live is job 54's). The squat is not passing until the
two open cases are closed; nobody uses it before job 53.

**As built, the replays (52a-ii-a, 2026-11-19; `rulings/2026-11-19-52a-ii-a.md`).** `scripts/replays.ts` plays each judged
video again: **nearer** (up to 1.3 times bigger, the whole body kept in the picture; a video whose body cannot grow 1.05
times is not counted as tried), **farther** (0.6), **tilted** 15° each way ("down" as the phone's sensor gives it), **15 and
8 pictures a second**, **uneven** (each picture 1 to 4 camera pictures after the last, as live mode drops them), **shaky**
(every point 1 cm afresh, 95 in 100), **the chip's gap** (every point moved by the very gap the chosen set-up, full on the
main chip on 4 cores, read from the laptop on the same pictures of the squat and the chair squat, 51b-i; kept as body points
in `test/phone-points` under labels of their own: the foot points 0.7 to 1.1 cm up or down in 95 of 100, heel and toes mostly
together; a drift drawn by hand, each point alone, was harsher than the phone), and **a passer-by** about 1 m from the phone
hiding everything under them (0.45 of the picture's width) for 0.8 s, between reps and at a rep's bottom (with no rep, the
video's middle and where the hips are lowest), taking at most the one rep it covers. `movement-check --replays` prints the
table. **The numbers are set from the eight people as filmed and as each replay that changes only how the camera reads a
body** (all but the passer-by): set from the videos alone, two fresh videos lost reps as filmed. Measured: under each of the
11 held replays every other movement (61 videos) counts 0 and is given no word; the 13 squat videos with a count by eye
count 35 of 35, every person also with themselves left out of the numbers, but where a passer-by covers a rep (the one
between reps 34, the one at a bottom 23: each rep it hid decides nothing). Shown, never held: the graphics chip's gap 35 of
35; the small model's 9 of 35, and one kettlebell swing counts 1; 3 pictures in 10 dropped at random 33 of 35.
**Jumps, true to gravity** (in the air 2·√(2h/g), the whole body carried up; `test/movementHops*.test.ts`), on three squat
videos (side on; in between with no pause between reps; from the front), taking off from 0.2 s before to 0.2 s after a rep
is back up, as filmed, at 15 and 8 pictures a second and with pictures skipped unevenly: **no jump of 8 cm or more is
counted** (Kd's four squat-jump videos lift the ankles 12 to 34 cm); jumps of 10 and 15 cm with the feet hidden or the
pictures missing for 130 to 240 ms round their top, or one foot lost at take-off and the other in the air, are never counted;
a jump from the bottom is refused from 8 cm where both feet are seen. **Known limits, in plain sight:** smaller hops (4 to
6 cm) may count, the feet's own wobble at this camera being up to 4 cm; side on, with only the near foot seen, a jump from
the bottom counts up to 10 cm and is refused from 12 (the model slides that foot 2.6 to 4.4 cm up the picture at the bottom
itself): a squat done with a hop, never a squat jump. **What changed in the matcher:** the feet are read as the model gave
them (steadying trails a fast foot); a foot point's rise is from where it rests, its lowest place on the picture over the
whole rep, worked out when the rep is judged (the way up and the 0.4 s after hold the floor before a take-off and after a
landing), never below 0; a foot is up only when its heel and toes are, the body only when both feet are where both are read,
and at the bottom only with both feet read; a foot point hidden longer than a break reads nothing for the rest of the rep;
a rep whose feet are hidden at the moment it would be judged waits for them, and one that ends hidden decides nothing; the
break that leaves "feet stay down" unseen, pictures in it or none, is the longest that hides no 10 cm jump
(`PROMISED_JUMP`, with a centimetre of room; 2·√(2(0.10 − 0.04 − 0.01)/g), 202 ms); the moment after a rep is 0.4 s (the measured take-offs reach 0.2 s, and a
12 cm jump then rises past twice the feet's number); once back up, a rep is no longer dropped for the hips being unread. The
fresh barbell front squat counts 3 of 3 (was 2; looked at for this, so no longer a fresh test). The numbers: depth 0.16, knees
125°, hips and knees together 34°, chest 56°, feet down 4 cm, in place 0.10, stance 0.24, hips alike 42°. **The body check:**
the crunch's legs thrown onto each other at 0.57 s (the left onto the right's place, the right only part way) were used at his
own size and drawn 1.3 times bigger; a swap is now each side nearer the other's last place and the two together twice as
well explained, and a point back near its last used place is used again at once: refused at 0.57 s at both sizes, used at
0.60 s, and every verdict the same at 1.3 times. On the laptop the replay and jump test files take 30 to 75 s each.

**As built, the phone's own runs judged (52a-iii, 2026-11-20; `rulings/2026-11-20-52a-iii.md`).** The chosen set-up (full model,
main chip, 4 cores, asked for one person) read the laptop's own pictures of all 78 proof videos on Kd's phone (`phone-test
--pictures laptop --people 1 --models full --chips cpu --threads 4`, nine batches named by `--kind`, 19,793 pictures for the 74
not run before; 55 minutes of the phone, about 9 pictures a second with the pictures' decoding). `keep-phone-points` keeps each
run as body points in `test/phone-points` (76 new files, 8.0 MB), so GitHub judges them again whenever the engine changes, with
no phone. `phoneCounts.ts` plays each video through the movement twice, from the laptop's kept file and from the phone's, and
calls the phone **the same** only when a person would be told the same: the count, and every rep that says something (counted;
short, with its rule; unseen) in the same order, verdict, rule and place; a dip read as another movement says nothing and is not
compared. A phone file is judged only when it is the phone's reading, from the chosen set-up, under the kept file's phone label,
of the kept file's very frames; anything else is refused, and a video with no phone run never passes (`phone-counts` prints the
table). The coach's lines are compared once 52b and 53 make them. **Measured:** 74 of 78 the same: the 13 squat videos with a
count by eye count 35 of 35 on the phone as on the laptop, every other movement counts 0 on both, the push press's open case
counts 3 on both. **Open, in plain sight** (`phoneOpen`, each with the judge's exact words for it: any other difference fails
the table). On three other movements both count 0 and call nothing short, but one side marks one dip "the camera could not see
the feet" (its feet's rule reads nothing) where the other says nothing: on a barbell Romanian deadlift and a dumbbell step-up
the laptop finds no dip at all and the phone finds one (the deadlift's in its last five frames as he leaves the picture, its hips
and knees 54° apart where the rule is 34°; the step-up's as he steps onto the box, the knees straight at 174°, a dip that never
tried, the foot points seen as well as the laptop's); on a kettlebell deadlift the laptop marks its dip so (hips and knees 79°
apart) and the phone reads a shorter dip there as another movement, silent. Each dip's seen readings already make it another
movement or a dip that never tried: whether such a dip is called unseen at all, and whether an unseen dip says anything on the
screen, is the reason for a rep not counted (52b). On `sumo_squat_1`, reported and never judged (a card hides him at 0.33 s), he
goes from rep to rep with almost no pause at the top: the hips' height above the floor lies within 0.01 of a leg on both
readings in 144 of 148 frames of his first 5 s (0.017 at most); the phone's reads him standing still at 1.97 s and counts one
sumo squat (2.1 to 3.0 s), the laptop's not until 5.8 s and counts none: a squat twin's rep at the edge of standing still, for
54, never another movement counted. Every time here is the video's own. **Kept only as the phone's reading of those very
pictures** (`phoneKeep.ts`, after round one): the pinned model asked for one person with the laptop's settings, the set-up its
name says, the laptop's pictures at the kept file's size, the plan its folder kept and the pictures that plan gave; and
`test/phone-points/manifest.json` names, for each file, the kept file it was read against, so a proof video measured again is
refused, never judged against a phone run of its old pictures.

**As measured and planned, a phone on the floor (2026-11-20; `rulings/2026-11-20-floor-phone-plan.md`; a planning terminal,
no code).** Every squat video until that day was a web clip filmed from about hip height. Kd then filmed 14 of his own, never
asked for (they stay on his laptop; measured with the laptop's line from even copies at 30 pictures a second; the body points
in `measured/`, the tables, scripts and pictures in exercise folder 1's `reviews/floor-phone`, none of it in git): squats from
a phone standing on the floor, on a shiny floor (side on, half turned and from the front, 3 each) and on a dull one (3 side on,
after one deep squat held 5 s); 10 squats from a raised phone (its height not measured); and the usual positions of other
exercises, from the floor and from the raised phone, upright and on its long side: standing and turning round, sitting cross-legged, on all fours,
lying with a leg raised, sitting down on a chair and getting up, one leg lifted beside a chair. **Measured, with the engine as
merged that day:** the body is found in 85 to 100 pictures of 100 in every video. The squat counts 0 of 9 on the shiny floor
as filmed (each way of facing played as a set of its own: side on 0 of 3, half turned 0 of 3, from the front 3 of 3), 1 of 3 on
the dull floor, and from the raised phone 6 of 10 as filmed and 9 of 10 by sets; on the eleven videos with no squat it counts
0. With "feet stay down" and "feet stay in place" taken out, the shiny floor counts 9 of 9 by sets and the raised phone 10 of
10, with the numbers set from the eight hip-height people: from the floor the knees, hips, chest and depth read right. Three
readings are wrong, all near the floor:
- **The foot points wander.** Side on, the near foot's heel and toes move together 4 to 5 cm down the picture on the way down
  and on the way up; half turned on the shiny floor a toes' point lies up to 8.7 cm under the foot, on the floor's reflection
  by the pictures. A foot's resting place is the lowest it was in the rep (`liftOf`), so "feet stay down" reads 6 to 8 cm on
  properly done reps where its number is 4; "feet stay in place" reads 0.12 to 0.13 where its number is 0.10.
- **The floor line follows them.** The remembered floor (`Floor`: the lowest heel or toes, taken at once, rising only after a
  second) lies up to 7.6 cm under the lowest foot point seen in the same frame, so every height moves while the person stands.
- **The body's own leg is not steady.** It is the middle of the last 3 s of the 3D points, and between its 2nd and 98th
  hundredth it spreads 22 and 76 in 100 over the two floor videos (11 from the raised phone; 1 to 13 on the 21 hip-height
  squat-family files). On the dull floor the hips' height while he stands reads 1.08 to 1.13 before a squat and 1.30 to 1.32
  after it, where a rep begins at a drop of 0.08 and is back within 0.08: a rep opens while he stands, and two real squats are
  one dip (15.7 to 23.5 s).

Also seen, and not 52a-ii-b's: in one take he turns between the ways of facing, and the first rep after a turn is lost or
merged (nobody turns in the middle of a set: 52d); sitting down on a chair and getting up, a chair squat's movement, is found
as no dip at all, the phone upright or on its side (54); `measure-points` stops at its drawing step on a phone's own recording,
whose frame times are uneven (52a-ii-b-i mends it).

**Planned (ROADMAP 52a-ii-b, in two jobs).** *52a-ii-b-i, the feet, the floor line and standing read steadily from a low
phone.* The cause is found first, each of the three readings measured again in the building terminal, and mended where it
lies, in the body measures and the matcher that every exercise shares, never by loosening the squat's numbers until his videos
pass. The rules of the mend: a resting place, a floor and a body's own length are the middle of what was seen over a time,
never the one lowest or newest reading; a foot point under the floor is refused, never made the new floor (garbage decides
nothing); a body's leg does not change within a set. The squat's numbers are then set again by `movement-check` from the
readings as mended, his videos among the people (one person, both rooms left out together, unless Kd says they are two), and
every number 50c fitted that the mend touches by its own tool. First tests, written first: his three squat videos count their
squats, each way of facing as a set of its own (9, 3 and 10), the first set from the video's first picture, as he walks back
from the phone; then every jump test of 52a-ii-a holds as it stands, and the same true-to-gravity jumps drawn on his floor
videos are never counted from 8 cm; the 35 reps of the 13 squat videos, every other movement under the 11 replays and the
phone's kept runs as before; his eleven other videos count 0. His squat videos are good-form videos: no advice is ever spoken
on them (52b). His videos are kept as body points only, under labels that name nobody. *52a-ii-b-ii, the floor view for every
other exercise.* Each proof video is replayed as a low phone would see it: the 3D points drawn from a lower place as a change
added to the picture's own points, so that from the phone's own place the picture comes back exactly, and the foot wander
measured on his floor videos, as the chip's gap was measured, never drawn by hand. It is kept only if a hip-height squat
replayed so reads as his real floor squats do (he squats from the floor and from the raised phone); otherwise it is not used,
and the table says so. With it, one table of what a floor phone sees of each kind of position (his eleven videos: the ankles
are used in 29 of 100 found pictures sitting cross-legged, 61 on all fours, 91 lying), for 52c and for 54's "can a phone on the
floor count it". **Limits, in plain sight:** the floor is proven on one man in two rooms; the replay is an estimate; a floor
phone in front of a live person is tried at job 53.

**As built, the feet, the floor line and standing from a low phone (52a-ii-b-i, 2026-11-20; `rulings/2026-11-20-52a-ii-b-i.md`).**
His 14 videos are kept as body points in `test/movement-points` (`floor_phone_test`, `usual_v02` to `usual_v14`; 5.3 MB) and
each way he faced is a set of its own (`cut` in `scripts/movementVideos.ts`), the engine started afresh for it. Eight of his
sets were drawn (16 pictures each, the one man followed in each) and set the squat's numbers with the eight people of 52a;
the first set, from his first picture at the phone, finds nobody in some frames and is judged only. **The three readings,
measured again and mended where they lie:** the body's own leg and trunk are the middle of every reading of them in the last
minute, each side's reading in each frame one reading, the leg only while its knee is within 30° of straight (held over 3 s
from both sides' middles his leg spread 37 in 100 on one video, as the far leg came and went, read short at the bottom; held
so, 1 to 3 in 100 on his squat videos, 0 to 2 on the squat videos of 52a, the trunk at most 6); the floor is the middle of
where the lowest foot stood over the last 2 s, a foot point under it moving it only once it has stood there for most of that,
or at once after a step down, when the foot is as far below the hips as when it stood both in 3D and on the picture (the
floor lay at most 5.0 cm under the lowest foot point seen on his shiny floor, 3.0 cm on the dull one, from 8.0 and 4.9,
before round one), or at once to where the lowest foot has stood still for 0.3 s, above or below it, with every knee seen
within 30° of straight (round one: walking back from the phone, the floor had followed his feet up the picture over a second);
a foot point rests where it was lowest in the rep, but never more than 1 cm (`FOOT_ROOM`) under where the foot stands, the
lower of the moment before the rep and the middle of where it stood once back up. **And the feet's travel:** a foot moved as
far as its heel and toes moved the same way (his shiny floor's toe point lay 9 cm down on the reflection while the heel point
rose 5 cm); where the feet stand is the middle of the last moment before the rep, never the instant the rep before came back
up (a squat jack's feet are still out then); a foot point that comes into view during a rep decides nothing (the far foot
showed for a frame 29 cm from where it stood); in the moment after a rep only both feet moving together is a jump (he turned
to the phone 0.4 s after his last squat); a next rep begun before a rep's moment after is over starts only once the hips are
past the line a rep starts at by the shake of standing (a person back up to just that line began a "next rep" one picture
later, and a 20 cm jump in the moment after was never judged); standing ready is taken only while the lowest foot stands on
the floor line (walking back, a standing taken while the floor caught up read his hips 0.12 to 0.19 of a leg too high, and
two squats were one). **Two rules made right in passing:** "knees and hips together" refuses the knees
bending far more than the hips, as "hips and knees together" refuses the other way (a Smith machine split squat, its knees
62° more bent than its hips, had been refused only by its foot points' noise); a match rule's room is half the furthest
rep's distance from the middle of each person's own middle rep, each person counted once, and its number is rounded towards
the reps (counted rep by rep, his sets, 42 in 100 of the reps, opened the room on the other side, and a kettlebell swing
was counted with pictures skipped). "Feet stay down" is never above `LIFT_CEILING`, an 8 cm jump seen at 8 pictures a second
less 2 cm (0.04): with his floor squats among the people the usual room put it at 6 cm, where 22 of 270 jumps drawn on the
three squat videos of 52a-ii-a were counted. The numbers: depth 0.16, knees 125°, hips and knees together 34°, knees and hips
together −57°, chest 52°, feet down 0.04, in place 0.07, stance 0.21, hips alike 41°. **Measured:** his squats count 9 of 9,
3 of 3 and 10 of 10 by sets (3, 1 and 9 before), none called short; his eleven other videos count 0; the 13 squat videos of 52a
count 35 of 35; every other movement counts 0 with every set of numbers and under every replay that must hold; jumps true to
gravity of 8, 10 and 12 cm at five take-off times, seen six ways, on three squat videos of 52a (270): none counted, as before;
on all nine of his sets, floor and raised (810): 55 counted, 37 of 8 cm, 14 of 10 and 4 of 12, most taking off 0.1 to 0.2 s
before the rep is back up, six of them as filmed, each written in `movementHops.test.ts`; of 15 and 20 cm on his nine sets
(540), none. Side on with one foot seen, a jump from the bottom is refused from 10 cm (12 before). His two sets that begin at
the phone, begun at every picture of his walk back (40 starts to 1.3 s, 106 to 3.5 s), count every squat
(`movementWalkBack.test.ts`). Three replays change the pace (the reps in three quarters of the time, 1.5 and twice as
slowly): every squat set holds but five rows, and every other movement counts 0 but a squat jack slowed, written below. **The phone's own reading** (his 14 videos read on Kd's phone
in three batches, 29 minutes of the phone, kept in `test/phone-points`, 5.1 MB): 91 of the 99 proof sets the same as the
laptop (the 78 older videos 76, 74 before the job). His squats on the phone: 19 of 22, one fewer in three sets, each written
(`phoneOpen`): side on, the body check relearns his near knee's length after he walks back from the lens until 4.9 s (the
laptop's 4.1 s), and his first squat at 5.0 s is never begun (53); half turned, a squat's feet read 4 cm up where the
laptop's read 3 (52a-ii-b-ii); on the dull floor the phone's model puts his near foot 10 cm up for one picture as a squat
begins (52a-ii-b-ii; letting a foot reading count only where a picture beside it agrees let 14 of 540 drawn jumps count, and
was not kept). Five others are a dip of another movement marked unseen on one side or for another reason, no count on either
(52b). On the laptop, before round one, the measures
take 148 to 203 microseconds a frame in the middle, the matcher 17 to 23. **Open, in plain sight, each with its job:** the 55
jumps above (52a-ii-b-ii); his first set, side on on the shiny floor, under 8 a second, uneven pictures, shake, the chip's gap
and the reps done faster, and with his own videos left out (52a-ii-b-ii), its foot points reading 3 to 4 cm up as filmed
against a rule held at 4 by the jumps; his half-turned floor set done 1.5, 2 or 3 times as slowly, its third squat's feet
over the 4 cm, and his first raised pair done 3 times as slowly (not a replay: about nine seconds a squat), 1 of 2
(52a-ii-b-ii); a squat jack done 1.5 or 2 times as slowly, counted twice: still long enough between jacks to be read
standing, its feet under the rules and its stance read nowhere (52b-i); his last raised pair under shake, the chip's gap and 1.5 times as slowly with his videos left out
(52a-ii-b-ii); `prisoner_squat_2` with its person left out, and twice as slowly so, and the plate goblet squat under uneven
pictures, both at the line half the depth sets (52b-i); his sit-and-stand on a chair when a passer-by hides the sitting (54,
the chair squat); with the camera left on across his turns his three videos count 8 of 9, 3 of 3 and 8 of 10, the standing
of one way of facing kept after a turn (52d); a body new within 3 s keeps the one before's leg and trunk for up to a minute
(52d). Tried in round one and not kept, for 52a-ii-b-ii: reading a foot's rise only from the foot points seen since the rep
began, wherever any is, with the floor moved by feet above it only once they stand still, brought the drawn jumps counted on
his nine sets to 24 of 1,080, two as filmed (53 with the floor change alone); but on its own it made the eight
people's readings set "feet stay down" at 3 cm without him, and four of his sets miscounted with him left out under 13
replays.

**As built, the floor view (52a-ii-b-ii-a, 2026-11-21; `rulings/2026-11-21-52a-ii-b-ii-a.md`).** `onTheFloor` in
`scripts/replays.ts` redraws a video as a phone standing upright on the floor would see it. The replay "on the floor" is
**shown, not held**: it would be held once a man's own squats from a raised phone, redrawn, read as his real floor squats do,
and at none of his six leans do they yet (below). It is not tried on a video filmed from the floor (`floor` in
`movementVideos.ts`) and sets no number (the squat's stay as 52a-ii-b-i set them). **How it draws.** Each frame's 3D points
are laid where the picture has the body, as far from the phone as the body's size on the picture says through a phone's usual
main lens (26 mm in 35 mm terms: fitted to each video from its own points, the best lens lay anywhere from 1 to 8 picture
heights with almost the same fit, and on his floor video it put the phone 6 to 12 m from him where the 26 mm lens puts it
1.8 m). The phone is moved straight down to 15 cm above the floor (a phone 16 to 17 cm tall on its short end; not measured),
leaned back 14°, and stepped back by quarter metres where the whole body would not be in the picture; each point is moved on
the picture by how far its 3D place moves between the two phones, and how far the picture's point lies from its 3D place (the
pose model's own wobble) grows or shrinks as the body does, one number for the video from the hips. Drawn from the phone's
own place the picture, the 3D points and "down" come back exactly (tested point for point), and a body the phone saw exactly
lands within 1 cm of where the floor phone sees it (tested). The 3D points and "down" turn with the phone, as the model and the
sensor would give them. Four things, each found on a video and mended: the 3D points are centred between the hips, so the feet
keep one distance from the phone and the hips move about them (laid on the hips instead, the squat videos' planted feet read 5
to 27 cm lifted); a foot that stays where it stands on the picture keeps its 3D place, the model's own beyond 10 cm and in
proportion between 5 and 10 (on a sumo squat the 3D points put one foot 30 cm forward and the other back on every rep, as if
she twisted: redrawn, her planted foot points slid 7 to 10 cm up and down the picture; held, her feet read 0.6 to 1.1 cm
moved); standing tall the hips are over the feet, and only bending knees move them back (turning between his sets, the 3D
points put his feet 18 cm in front of his hips for half a second, and his standing read 8 cm taller than once he stood still);
the wobble shrinks with the body (kept at its old size, a foot's wobble read 1.3 to 1.5 cm more travel on the body the floor
phone, further away, sees smaller; scaled point by point and picture by picture instead, it added travel of its own wherever a
foot passed between held and moving). **How his phone stood** (`phoneLean`, from where his feet and his size lie on the
picture in the pictures he stands tall in): leaning back 6.4° in his first floor video and 12.6 to 14.5° in his five other
upright ones, 1.6 to 1.9 m from him; 14 is their middle. **Not yet as his floor reads** (`faithful`; `floor-view` prints it,
`movementFloorView.test.ts` pins it). It would be held when his ten raised squats, redrawn, all count, none called short,
and each of four readings is taken at least half way from his raised sets' reading towards the middle of his four real floor
sets, the middle of the five redrawn sets never past the furthest floor set (each set past it is listed, never hidden by the
middle):

| Leaning back | His raised squats counted | Short of his floor on |
|---|---|---|
| 6.4° (his first video) and 6.5° | 9 of 10 | feet stay down; hips, picture against 3D, below standing and standing |
| 12.6° and 13.7° | 10 of 10 | feet stay down |
| 14° (the replay) | 10 of 10 | feet stay down; hips, picture against 3D, standing |
| 14.3°, 14.4° and 14.5° | 9 of 10 | feet stay in place |

At 14°: "feet stay down" 1.7 cm (his raised sets as filmed 1.3; his floor sets 2.0, 2.3 in the middle, 2.9; half way is 1.8);
"feet stay in place" 2.4 cm (1.7; 1.4, 3.1, 3.6); the picture's hips against the 3D hips in 95 of 100 pictures below standing
0.088 of a leg (0.063; 0.061, 0.081, 0.103) and standing 0.088 (0.097; 0.052, 0.077, 0.141; half way 0.087). Every one moves
towards his floor's, and three of his five sets lie past every floor set on one reading or more: feet travel his pairs at 22
and 30 s, the hips below standing his pair at 22 s, standing his front-on pair. At 14.3 to 14.5° one squat of his pair at 22 s
is lost: from the floor it begins at 0.8 s instead of 1.7, while he still settles after turning to face the phone, and takes
the settling feet in. The redraw takes "feet stay down" only 4 tenths of the way from his raised phone to his floor: the rest is
most likely the pose model's own wander near the floor, which the redraw does not draw (the plan's foot wander measured on his
floor videos, left out here as it seemed to count twice); 52a-ii-b-ii-b adds it and checks again. The readings of how he moved
are shown and not checked: a phone changes them (the knees and the trunk are read on the picture first), but part of each gap
is how he moved, his raised and floor squats not being the same squats ("knees bent" 58.5° raised as filmed, 55.7 redrawn, his
floor 50.6; "chest up" 28.8, 27.7, 30.2). **How the check came to be:** first written to judge every reading, it failed both
leans then tried, on "knees bent" (taken 4 of 10 degrees towards the floor) and "chest up" (moved away); it was changed to
judge only the readings above, and as changed it held at 14° alone of the leans tried; round one's review showed it held only
at the middle of his leans and hid sets past the floor's, and found the redraw's wobble kept at its old size; mended (every
lean, every set listed, an even count's middle the mean of its two middle values), it holds at none, as the table says.
**Measured under the floor view, shown:** every other movement counts 0 and says nothing (64 videos tried); jumps true to
gravity of 8, 10 and 12 cm at five take-off times on three squat videos, seen from the floor as filmed and at 8 pictures a
second, are never counted; on his five raised sets, 14 of the same 150 cases count a rep nobody did from the floor, four of
them cases the raised phone refuses (from the raised phone itself 12 of 150, 52a-ii-b-i's open jumps), each pinned; of the 18 squat sets tried, 16 count by eye (pinned too), and two do
not: his pair at 22 s with his own videos left out (its first squat's feet 6.7 cm moved, past his floor's 3.6, as above), and
the barbell front squat 2 of 3 (the squat she rises from in the video's last 0.3 s decides nothing: her picture's hips and 3D
hips 0.18 of a leg apart, past the 0.15 the picture is trusted within; the redraw keeps a hip-height phone's 3D points, where
a real floor phone's model reads its own). **What a floor phone sees** (`positionsTable`,
his eleven other videos as filmed; of every 100 pictures the body is found in, a part used on one side / on both, and the
hips' height and each knee given on the picture):

| His video | Phone | Found | Hips | Knees | Ankles | Heels and toes | Hips height | Knees (left, right) |
|---|---|---|---|---|---|---|---|---|
| stands and turns round | floor, upright | 96 | 99/99 | 99/85 | 99/83 | 99/83 | 95 | 94, 88 |
| stands and turns round | floor, long side | 90 | 98/98 | 93/89 | 92/88 | 91/88 | 90 | 91, 89 |
| sits cross-legged, turns round | floor, upright | 99 | 98/98 | 84/56 | 29/20 | 29/20 | 23 | 16, 16 |
| on all fours, turns round | floor, long side | 100 | 99/99 | 96/60 | 61/13 | 61/13 | 53 | 21, 25 |
| lies, raises a leg, sits up | floor, long side | 100 | 99/99 | 96/32 | 91/25 | 91/24 | 91 | 24, 87 |
| sits on a chair, gets up, sits | floor, upright | 93 | 98/98 | 97/21 | 93/18 | 93/18 | 89 | 38, 69 |
| one leg lifted at a chair | floor, upright | 97 | 96/96 | 90/87 | 89/72 | 89/72 | 78 | 84, 73 |
| sits on a chair, gets up, sits | floor, long side | 85 | 98/98 | 97/33 | 97/23 | 97/23 | 94 | 66, 52 |
| sits on a chair, one knee on it | raised, upright | 98 | 99/99 | 99/81 | 98/50 | 97/49 | 94 | 54, 75 |
| lies on a bed, raises a leg | raised, long side | 94 | 98/98 | 92/41 | 74/26 | 74/25 | 73 | 26, 73 |
| stands and turns round | raised, upright | 96 | 98/98 | 98/86 | 94/81 | 92/79 | 85 | 89, 85 |

From the floor, sitting cross-legged hides the feet in 71 found pictures of 100 and the hips' height in 77; on all fours,
both ankles are seen in 13: what floor work can count from a floor phone is 52c's and 54's question, and this table their
start. **Limits, in plain sight:** one man, one phone, two rooms; the lens and the lens's height are taken, not measured; the
redraw keeps the hip-height phone's 3D points and its model's own errors; a real floor phone in front of a live person is
tried at job 53.

**As built, the floor's own foot wander (52a-ii-b-ii-b-i, 2026-11-21; `rulings/2026-11-21-52a-ii-b-ii-b-i.md`).** The floor
view's gap to his floor was most likely the pose model's own wander near the floor, which the redraw does not draw. It is
measured on his four floor sets (`wanderOf`, `floorWander` in `scripts/replays.ts`): each squat the squat counts on its
own, from half a second before it to half a second after, each foot point's place on the picture against where it lay
while he stood tall in the half second before that squat, in his body's size then. A planted foot does not move in a
properly done squat, so every move is the model's; a person may step or turn between squats (round one found that, on
his dull floor, he turns round between his second and third squats, his heel 35 cm across, which a place taken over
the whole set had read as wander; a set of its own each way since 52a-ii-b-ii-b-ii, below).
While his knees are straight around a squat, no floor set's foot point lies 10 cm from where it stood (pinned). His five
raised sets are measured the same way, since the redraw already carries their wander: over his squats the foot points
spread 3.2 cm across and 3.9 down on his floor, 2.5 and 2.6 from his raised phone (root mean square, `floor-view` prints
it). **Tried first, not kept** (measured once, on code not kept and before round one's mend, so no number is given): carried
on in time, as the chip's gap is, it put the wander of a squat's bottom on his standing feet. **Tried as built:** in step
with each foot's own knee, the middle of each foot point's wander at each 5° of the knee's bend, his floor sets' less his
raised sets' (`faithful(lean, …, wander)`, `floor-view` prints it, `movementFloorView.test.ts` pins it). **It loses squats
his real floor counts** (his four floor sets count 12 of 12) **and still does not read as his floor**, every way:

| Wander taken from | His raised squats counted (of 10) | "Feet stay in place" (his floor 0.014 to 0.036) | Short of his floor on |
|---|---|---|---|
| none (as 52a-ii-b-ii-a left it), 14° | 10 | 0.024 | feet stay down (0.017; his floor 0.020 to 0.029); hips, picture against 3D, standing |
| all four floor sets, 14° | 8 | 0.032 | feet stay down (0.016); hips, picture against 3D, standing |
| all four, at his six leans (6.4° to 14.5°; without it 9 or 10) | 7 to 9 | 0.027 to 0.033 | feet stay down at every lean; the hips readings at all but 12.6° |
| all but one, each in turn, 14° | 7 to 9 | 0.032 to 0.040 | in each fold one to four of the judged readings |
| one floor set alone, 14° | 4, 10, 7 and 7 | 0.029 to 0.082 | in each two or three |

The wander depends on the set: from his side-on set on the shiny floor 4 of his 10 raised squats count and their feet read
8.2 cm moved; from his half-turned set all 10 count, yet both hips readings fall short. With one floor set for each of two
of his three ways of facing, a wander matched to the way a person faces could never be tried on a set it was not measured
from. **So the floor view stays shown, never held, and the replay "on the floor" adds no wander.** Kept so that the trial
can be made again when more floor videos exist (job 53's live tries). **Limits, in plain sight:** one man, four floor sets;
a phone on the floor is proven only on his real floor videos (52a-ii-b-i) and, for the other exercises, waits for job 53's
live tries and 54's own videos.

**As built, the floor mended in the engine (52a-ii-b-ii-b-ii, 2026-11-22; `rulings/2026-11-22-52a-ii-b-ii-b-ii.md`).** Measured
first, on his sets frame by frame, what let the drawn jumps through: the lesser of the two feet, read where both are, was a
foot the model reads poorly. Side on, the far foot, hidden behind the near one while he stands, shows during a squat where the
model guesses it; on his raised phone one foot's toe point slides 8 cm down the picture as he stands up while its heel rises.
Read so, such a far foot rested where it stood once back up, and in a jump from the top the feet are in the air for most
of that moment, so it read the jump at a few centimetres. **Two rules in the matcher, the squat's numbers untouched:** a foot
point not seen in the moment before the rep rests where it was lowest in the rep, never where it stood once back up; and away
from the bottom of a rep, where both feet are read, a foot whose heel and toes rise apart by more than 3 cm (`FOOT_ENDS_AGREE`)
while the other's agree is set aside and the other foot decides. At the bottom both feet are read together as before: set
aside there too, a weight-plate goblet squat shaken 1 cm lost a squat. First built as "such a foot point decides nothing away
from the bottom": round one found it refused a proper squat (his last raised pair, his left foot hidden while he stood and
seen through each squat: his right foot read alone, its toe point sliding as he stood up, 4.7 cm, and his first squat lost),
so the far foot stays in the reading and only its resting place changed; with that foot hidden while he stands, on every
judged squat set and either foot, heel or toes, the counts are the engine's before the job, case for case. **His dull-floor set is two:**
from 16.9 to 19.0 s he turns round, through facing the phone, to side on the other way (his shoulder line in 3D from 73 to
-75°), so his first two squats (9.8 to 17.5 s) and his third (19.2 to 23.2 s) are each a set of their own; his ten sets count
2 and 1 there, as by eye. **Measured:** jumps of 8 to 12 cm drawn on his ten sets, 9 of 900 counted (55 without the two
rules, 39 with either alone; the 3 cm: 9 at 3, 10 at 2.5, 11 at 3.5, 16 at 2, 14 at 4, 25 at 5), all 8 cm, all on his shiny
floor, taking off 0.1 or 0.2 s before the rep is back up, one of them as filmed; of 15 and 20 cm, none of 780 on his ten sets
and the three squat videos of 52a-ii-a; the 270 jumps on those three, and the jumps from the bottom, none, as before. Every
squat set counts as before, as filmed and under every held replay, with every person's numbers and with each left out, and
the squat's numbers are as they were; every other movement counts 0 as before, but a squat jack done twice as slowly now 1
(was 2: open, 52b-i); under the small model's gap, shown only (the app does not use that model), 27 of 57 squats, 29 before:
each sumo squat loses one, one foot's heel and toes set apart by its noise and the other foot alone reading 4.5 and 5.1 cm (the
heel-and-toe rule off, 29); the phone's own runs, 92 of 100 sets the same (his squats 19 of 22, as before). The floor view, judged
against his five floor sets, still does not read as his floor at any lean and stays shown (`movementFloorView.test.ts` pins
each lean and fold again; with his first shiny set left out of the wander, 7 of his 10 raised squats, 8 before round one's
fix); at the replay's lean the hips below standing now go past his floor's (0.088 of a leg redrawn, his
floor 0.073, his raised phone 0.063); jumps drawn on his raised sets seen from the floor, 4 of 150 counted (14 before), none
from the raised phone itself (12 before). **Tried and not kept,
each measured:** a jump read against where the feet were just before and just after it (his squats right but one rep under
three replays, 158 of 810 jumps), or against the higher of where they stood before the rep and where they settled after, with the rep judged
only once the feet are down (114); the knees rising and falling with the feet (119, and a real squat lost); the hips rising
above standing (a proper squat's hips stand up to 0.18 of a leg above the standing first taken); the hips rising and falling
in the moment after (two of his open rows put right, yet a Smith machine split squat's step, a foot up while the hips stay,
counted); a middle of each foot point over 0.1 s (6 more jumps of 810, and the phone's one-picture foot on his dull floor is
read by the feet's travel too). **Open, for job 53's live tries of a floor phone, each written on its video:** side on, on
his shiny floor, the model settles his near foot's points 4 to 5 cm higher on the picture after each squat he stands up from,
so a reading of the foot points that keeps these squats measures an 8 cm jump at 4 cm or under (the 9 jumps above), and his
first set under 8 pictures a second, uneven pictures, shake, the chip's gap and the reps done faster still loses squats;
half turned, his toe point lies on the floor's reflection, up to 8 cm down the picture, and his third squat there done 1.5 or
2 times as slowly, and on the phone as filmed, reads its feet over 4 cm; on the phone his dull floor's second squat, a foot
put 10 cm up for one picture; and with his videos left out, "feet stay in place" set at 5 cm from the eight people filmed at
hip height, under his first set's and his last raised pair's 5 to 6 cm.

**As built, how deep a squat must go, and why a rep did not count (52b-i, 2026-11-22; `rulings/2026-11-22-52b-i.md`).**
**How deep, from the form standard, never from how shallow anybody went.** A count rule may now be set from its exercise's
form standard (`standard` in the movement's file): the standard's own line, moved the forgiving way by the camera's own room
on that reading where it has one, and `movement-check` writes where each came from. *The knees:* a quarter squat bends them
to an inner angle of 110° to 140°, a half squat to 80° to 100°, a parallel squat to 60° to 70° (Front. Sports Act. Living
2024, a scoping review of the deep squat, PMC11618833; Kd's research file asks for about 90°), so the line is the quarter
squat's deepest end, 110°, plus the camera's own room (the forgiving way): how much the same rep's bottom knee reads differently between a video
as filmed and each replay that sets numbers, each replayed rep paired with the filmed rep it overlaps most in time, 3.88° in
99 reps of 100 (313 reps paired; paired by their order, 2.78° on 303): a rep read at 114° or deeper counts (113° to 116° with
one person left out). *The hips:* a hip stands no higher above its ankle than a leg bent so allows, thigh and shin of equal
length (Drillis and Contini, as Winter gives them: 0.245 and 0.246 of the height), so at the knees' 114° they have sunk at
least 1 − sin 57° = 0.161 of a leg; that is already the least the body allows, so it has no room of
its own: 0.16 in every fold (0.16 to 0.23 with one person left out before, and the lines a rep starts and is back up at
moved with it). *Measured:* every proper squat of the 23 squat sets with a count by eye reads its knees at 107.4° or deeper,
as filmed and under every held replay; all 23 count by eye; none is told to go lower, as filmed, under any held replay or
in the phone's own runs. The kettlebell push press counts 0 (3 of its 4 dips before; its knees 120° to 127°); its dips that
went three quarters of the way are told "Go lower to count.": the squat's movement does not read the arms, so to the camera
they are a quarter squat, told as a quarter squat is (written on its video, `told`; no other movement is told to go lower,
and as filmed none says anything).
Kd's ruling after five ways of telling it apart were measured and none kept every proper squat (its knees, its speed, the
hands' rise, the arm pointing up, the last two together; the rulings file has each number): keep it. The
shallowest man of the nine counts his 3 with his own videos left out, and so done twice as slowly (2 before). **Back up once
standing tall.** A rep is also back up once the person stands tall again: for the whole of the last 0.2 s every condition of
the movement's standing ready held (both knees within 20° of straight, the trunk within 20° of upright), each read on both
sides, and the hips still, however low they read against the standing first taken; and a rep never begins while the person
stands tall. The weight-plate goblet squat, her hips 0.09 of a leg under her first standing while she stood between her
third and fourth reps with her knees straight, counts 4 with pictures skipped (3 before). Found while building: read on the
knee seen alone, a passer-by hiding a barbell lunge's front leg left its straight back knee in view, the lunge read as
standing between two halves of one dip, and the second half passed every rule but the knees, by under a degree; so both
sides must be read. Three of the 23 squat sets begin a rep later than before, each one that had begun while the person
still stood (prisoner squat 1's third, 0.47 s before he moved; the plate goblet squat's fourth; his last raised pair's
second, 0.9 s). Through the floor view, shown only and still read as his floor at no lean, his raised squats count 10 of
10 at 14.3° to 14.5° (9 before), his pair at 22 s with his videos left out 2 (1 before), 3 of 150 drawn jumps on his
raised sets (4 before), and his raised sets' foot wander reads 1.7 cm across (2.5 before: the half second before that
squat, its foot's reference, had not been his standing). **What the camera saw decides first.** A rep's verdict, in order: a
dip whose seen readings make it another movement (a rule seen and broken that says what kind of movement it was), or that
never tried, says nothing, whatever else the camera could not see; only then does a rule the camera must see and could not
leave it undecided, saying what it could not see; then a count rule not reached makes it short, with its words. So a dip of
another movement the camera could not judge says what it could not see: under the held replays 13 dips of 6 such videos say
"Keep your whole body in view." (none as filmed), since the rule that would show them another movement is the one unseen. A rep whose hips were lost from view on its way
is judged on what was seen of it the same way, otherwise undecided by the depth's own rule; a rep longer than 15 s is
another movement. Counting is the same in every order. The five other movements whose dips one side called "the camera
could not see" (52a-iii, 52a-ii-b-i: a barbell Romanian deadlift, a barbell lunge, a man turning round three times) are
silent on both, and the phone's own runs are the same as the laptop's on 97 of 100 sets (92 before), the three left his
floor squats, each written for job 53. **The words for the screen**, in the movement's file, one short whole sentence
each, the file refused without them: a count rule says "Go lower to count." when a rep that tried falls short of it; a rule
the camera must see says "Keep your whole body in view.", the feet's two rules too (a passer-by hides the whole body, and
"Keep your feet in view." would have told him so at the bottom of every one of the 23 squat sets).
`RepResult.reason` carries them; another movement and a dip that never tried carry none. **Open, each written on its
video:** a squat jack done 1.5 or 2 times as slowly counts 2 and 1 (52c): the standing before each is taken as his feet
jump out, both feet moving 3.9 to 4.1 cm in that 0.2 s, where a real squat's feet move up to 3.8 cm in the standing taken
before it, so the feet's stillness cannot tell them apart; his first shiny-floor set under five replays, his slowed
half-turned set, his last raised pair under shake and the chip's gap with his videos left out (53); his sit-and-stand with a
passer-by (54). The fresh kettlebell front squat, reported and never judged since its camera moves, counts 1 of its 3 by
eye (0 before). Under the small model's gap, shown only, 30 of 57 squats (27 before). On the laptop the matcher takes 19 to
40 microseconds a frame in the middle, master's 17 to 43, measured the same hour. **Found, not changed:** the measuring run
that sets the numbers (`measuringMovement`) keeps every rule with no number, so its break for the feet is 0.1 s, not the
squat's 0.2 s; on master's engine it gave no rep at all to set numbers from on 20 of the 22 squat sets with reps under
uneven pictures and on 11 at 8 a second, most likely for that break (52b-ii, which sets numbers next).

**As built, the squat's form check (52b-ii-a, 2026-11-22; `rulings/2026-11-22-52b-ii-a.md`).** **An exercise's camera
file** (`packages/movement/exercises/squat.json`, checked by `exerciseCameraSchema` in `@app/shared` and by `checkExercise`
against its movement) lists every common mistake of its research file (Kd's "Normal Squat (Bodyweight Squat) Guide", its
eleven) and the Library's (ACE's feet that shift), under the Library's own ids where it has them (§13.3), each marked one of
four: **checked** by the camera; left to the **counting** (quarter reps: "knees bent", told "Go lower to count."; feet that
shift: "feet stay in place", another movement); **cannot see**, with why, measured where it can be; **not checked** yet, with
why and the job that will. **The form judge** (`packages/movement/src/movement/form.ts`) runs inside a counted rep only, on
the rep's own frames from its start to back up, and reads the picture only: a 3D reading alone never gives advice. A mistake
is read at the bottom (the middle of the matcher's own bottom frames, seen in at least half of them), on the way up against
the bottom (from the deepest frame until half way back up), or over the rep (its furthest, seen for at least 0.3 s), as it is
or against the person's own standing before the rep; a lean ("side") only where the body stands side on, its hips' line
showing at most 0.57 of itself on the picture (a new measure, "hips apart"; at the bottom of the 23 squat sets, side on 0.14
to 0.53, from the front 0.61 to 1.00), and a width ("front") wherever the picture shows the body's line across. A body turned
from the phone shows a lean or a width shorter than it is (a lean's forward line √(1 − share²) of itself, a width the hips'
share), so a rep is fine only when the largest the mistake could truly be at that turn stays inside its line, and otherwise
unseen (round one: a half-turned body had been read fine; on the 57 counted reps of the 23 sets, the lean is fine on 26 and
unseen on 31, the knees fine on 16 and unseen on 41). `RepResult.form` carries, for each checked mistake of a counted rep,
made, fine or unseen ("the camera cannot see this from here", for that rep). **A line** is set by `form-check` from the same reps the
movement's numbers are set from (the nine people, as filmed and as each replay that sets numbers), never nearer the reps than
the further out of the form standard's line and the furthest proper rep, each moved out by the camera's own room on that
reading (in 99 reps of 100), rounded outward; each person left out in turn; `form-check` prints, and the file says, how many
reps as filmed and how many people read each mistake, the line resting on them alone. **Checked:** *leaning too far forward*, the trunk
at the bottom side on, at most 46 degrees (the research file's 30 to 45 moderate, plus 0.41 of room; the furthest proper rep
40.06, of 118; 46 in every fold; read on 14 reps as filmed of three people, the light-gym woman, the green-mat man and the
man filmed from the floor); *knees caving inward*, the knees' width less the feet's against standing, over the rep, at
least -0.06 of a trunk (never closer together than they stood, ACE's knees over the second toes, less 0.05 of room; the
furthest proper rep 0, of 144; -0.11 to -0.03 in the folds; read on 17 reps as filmed of six people, three prisoner
squatters, the two sumo squatters, whose wide stance is "not checked", and the floor man). From the front the bottom of a squat points the thighs at the
phone and its knees' width is never read there, so it is read on the way down and up (on 16 counted reps of the 23 good-form sets; the 17 above are the measuring run's reps of
the sets that set numbers). **Measured:** on the 23 good-form squat sets (the eight people, the twins, his floor and raised
sets) no mistake is marked, as filmed and under each of the 14 held replays, with every person's numbers and with their own
left out (600 runs), nor in the phone's own runs of the same pictures, which mark what the laptop marks on every rep both
count, paired by when it was (the three sets the phone counts one fewer on included, round one); every other
movement's dips carry no form check. Drawn onto every rep of those sets that reads it (`scripts/mistakes.ts`: the trunk turned
forward about the hips, or the knees carried towards each other, in 3D and on the picture through a 26 mm lens, growing with
the knees' bend), each mistake searched to just past its line (2 degrees, 0.03 of a trunk) is marked on all its reps (26 for
the lean, 16 for the knees), each still counted, with no other mistake; just short of its line none is; and the reading
follows the drawing (each rep's lean moves within a quarter of the degrees drawn; frame by frame in each set, the knees'
width moves by 0.95 to 1.26 of what the drawing carried there in the middle, and never the other way). The counter takes 35
to 98 microseconds a frame with the form check, 21 to 95 without, in two runs (66 and 55 in the middle, the 23 sets, measured
the same hour). **Not checked, each measured:** *hips rising before the chest* (the chest's lean half way out of the bottom against
the bottom: his proper floor squats read 3.1 to 4.2 degrees, once 12.6, and a line set from the eight others alone, all
filmed from hip height, lies at 3) and *knees shooting far forward with the hips high* (side on, the shins' lean less the
thighs' at the bottom: his proper squats -17 to -29, the eight others -32 at most, their line -30): each line set without him
marks his proper squats, and he is the only person filmed from the floor (53's live tries, 54); the stance's width is the sumo
squat's own (54, with the twins). **Cannot see:** heels lifting (the heel point alone wanders up to 11.5 cm on proper squats
from the floor, 5.1 from hip height), bouncing (proper squats stay at the bottom for as little as 0.10 s), the lower back
rounding (no point on the spine), the knees locked hard, the breath held. **Found while building, mended:** from the front,
knees drawn caving in read as knees far forward (a knee moving sideways turns the thigh and shin on the picture as a forward
lean does), hence "side"; the knees' width needed half a rep's frames, which a front-on rep only just gave, so the knees drawn
in a little were no longer seen, hence 0.3 s. **Limits, in plain sight:** a counted squat is told it leans too far from 46 to
52 degrees; past 52 the movement's own "chest up" reads it as another movement, neither counted nor told (Kd's ruling of
2026-11-16), until 52b-ii-b, which tells it "Keep your chest up." when it is a squat in every other way (Kd, 2026-11-23); the
knees caving in is read only facing the phone or half turned; the lean's line rests on three people and the research file's
"moderate, about 30 to 45 degrees", a usual range rather than a source that names a mistake, so before the coach says it (53)
it is backed by a primary source or Kd's ruling, or set from more side-on bodies.

**As built, "Keep your chest up.", each rep's score and the set's summary (52b-ii-b with 52b-iii, 2026-11-23;
`rulings/2026-11-23-52b-ii-b.md`).** **Past "chest up".** A checked mistake may name the movement's match rule that refuses a rep it
has gone that far past (`refused` in the camera file: leaning too far forward, "chest up", "Keep your chest up."); `checkExercise`
refuses a rule that is not a match rule read where the mistake is read, as the same value of the same measures, its line further out
the same way, and two mistakes on one rule. A rep that breaks that rule alone, every other rule seen and held and every count rule
reached, in a set that has already counted a rep of the movement, is **refused**: not counted, told the words, its form check that
mistake made; but only when the form judge, reading the picture as the mistake is read (a lean side on), finds it past the rule's
own line too. Before the set has counted a rep, facing the phone, half turned, with any other rule broken or anything unseen, it
says nothing, as another movement does (round one: under the floor view, shown and not held, a kettlebell swing's first dip, half
turned at 0.56, broke "chest up" alone and was told it; every other movement counts 0, so it can never be told now). *Measured:* as
filmed, no rep of the 100 videos is told it; nor under any of the 18 replays, held or shown, any other movement's dip (73 videos),
nor under the 14 held replays any good-form squat set, with every person's numbers and with their own left out. The lean drawn onto
the side-on squat reps that read it (`scripts/mistakes.ts`), 2 degrees past chest up on every rep but each set's first (15 reps of
11 sets): 13 are told it; the other 2 (`squat_normal_2` at 3.0 s, the chair squat at 4.5 s) are silent, since a trunk turned that far
forward about the hips folds their hips far past their knees and "hips and knees together" reads a hinge (each drawn 12 degrees
further: another movement by that rule); each set's first rep drawn 8 degrees past it is not counted and says nothing. 2 degrees
short of it, on all 26 reps, 25 count with the lean marked, and the plate goblet squat's first is already a hinge, silent. Facing
the phone, the chest drawn 40 degrees forward on every rep but the first, nobody is told (the picture cannot see a lean from the
front). **Each rep's score** (`repScore`): of the checked mistakes the camera could see in a
counted rep, the share that were fine, out of 100; one it could not see counts neither way, and a rep in which it saw none has no
score (side on the squat is scored on the lean, facing the phone on the knees). **The set's summary** (`SetRecord`, given every frame
the matcher returns): §2.4's fields in the server's own shape (`engineSetSummarySchema`): the reps counted; each scored rep's score
and their mean, null with none; each mistake made in a counted rep or in a rep refused for it; the time from the first picture to
the last, and the time watched (each gap between pictures counted up to 0.5 s, the matcher's `lost`, after a picture that read the
person); a counted rep's own time, from half way down to back up, the mean; the count rules' readings, the mean; "side" when side on
by the middle of the reps' turns at the bottom, else "front", half turned included (§2.4 has no third way); the movement engine's
version, 2.0.0, and the camera file's own `version`, raised whenever it or its movement's file changes (a test pins both files' hash
beside it). A
clock that went back is a new set, as it is to the matcher. **The two marks** a member reads beside a mistake (Kd, 2026-11-23;
`mistakeMark`): "Checked by the camera" (checked, or left to the counting) and "Not checked by the camera" (cannot see, or not checked
yet). **The measuring run now reads with the movement's own break** (`breakOf`: the squat's 202 ms, which hides no 10 cm jump, where
the measuring movement alone took the plain 0.1 s), so uneven pictures and 8 a second give their reps (430 reps set the numbers, 356
before; every squat set that sets numbers gives reps under both). The numbers it set, kept by Kd: the knees' line 116 (the camera's
room 5.13 degrees on 387 pairs, 3.88 on 313 before: 114); the stance 0.22 (0.21); knees caving inward at least -0.12 of a trunk
(room 0.10 on 148 reps, the furthest proper rep -0.02; -0.06 before), so a small cave is no longer called; the lean stays 46. **The
hips' line stays 0.16**, the least a leg bent to 114 degrees allows (1 − sin 57), no longer the knees' own line: at 116 it would be
0.152, so 0.15, and a rep starts and is back at lines set from it (half of it, and a quarter of a rep's own depth); so low, on GitHub's
run, his first shiny-floor set at 15 a second and his walk back begun at 3.23 s each lost a squat, two running together, and 14 of
the floor view's pinned readings moved; at 0.16 every one is as before (`movementDepth.test.ts` pins the lost squat at 0.15). With
these numbers every squat set counts as by eye as filmed and under every held replay, every other movement 0, the kettlebell push
press 0, jumps and the floor view as before, and the phone's own runs are the same as the laptop's on 97 of 100 sets, as before. On a
half-turned sumo rep (`sumo_squat_2b` at 7.7 s) knees drawn in just under what passes -0.15 leave the knees' width in sight too
briefly, so the camera says nothing there, and at 0.12 m it marks them. **Open:** the coach's line for each mistake, and how often a
correction is spoken (53).

**As built, a jump in a fast rhythm, and one side at a time (52c-i, 2026-11-23; `rulings/2026-11-23-52c-i.md`).** **The kinds
of counting** (`counting` in a movement's file, `MOVEMENT_COUNTINGS`): "rep" (the squat), "fast rhythm", "jump" and "one side at a
time"; holds, timed only and floor work are 52c-ii's. Two movements are built on them, each from Kd's own videos and research
files, with no engine code naming either: the squat jump (`movements/squat-jump.json`, four people, `squat/Squat Jump`) and the
lunge (`movements/lunge.json`, forward and reverse lunges of six people, `Kettlebell Forward Lunge`, `Barbell Forward Lunge`,
`Weight-Plate Forward Lunge`, `Dumbbell Reverse Lunge`). **A standing read on the move** (fast rhythm, jump): squat jumpers never
stand still (in all four videos the engine as it was never took a standing), so where a person stands is also read from the
pictures of the last 2 s in which they stood upright on the floor (every condition of standing ready held, read on both sides, the
feet on the floor line), the middle of them, with no stillness asked; the last one read is kept while none comes (at 8 pictures a
second the one to five pictures a jumper is upright on the floor between two jumps are often never taken). **A jump** is a match
rule, "feet leave the floor", at least 8 cm, the smallest jump the squat never counts (`NEVER_JUMP`), so no rep is both a squat and a
squat jump (between the squat's 4 cm and 8 cm, neither); it is read only in pictures where both feet are read, heel and toes, and
the whole body was carried up, the hips above where the person stands by more than the shake of standing (on the picture, or in
3D where the picture gives none: in the air it often gives none for the first 0.1 s), each foot resting where it stood while the
hips were down in the dip (the moments before and after a rep, which the squat uses, are in the air in a run of jumps: her jumps,
the ankles 0.26 of a leg up, read 3 to 6 cm so); and its height is its highest picture held up by a picture beside it with both feet
at least 4 cm up (`JUMP_SUPPORT`, half the 8 cm): a jump is in the air 2·√(2h/g), so at 8 pictures a second the pictures beside the top
of a 12 cm jump, Kd's lowest, are at least 4.3 cm up, while both feet thrown up the picture for one frame as a squat filmed from the
front stands up had each squat counted as a squat jump (`movementKinds.test.ts`; taken as the least of two pictures in a row instead,
a woman's 15 cm jump read 7 cm at 8 a second). Nor is a man stepping out of a split squat with one foot read a jump. **One side at a time**: a rep's side
(`RepResult.side`) is the leg whose shin stands the more upright over the rep's lower half (`side` in the file: "shins, left
against right", the working side the "less"), in the frames whose picture and 3D readings agree on which side is larger, the side
most of them say, never guessed on a tie; it is the pose model's own left and right, so the selfie camera's mirror swaps it, and
the camera screen turns it back (53; tested on a mirrored video, every leg the other). **Two new ways a rule reads:** "lower half"
(the frames at least half as deep as the deepest: a lunge's legs are split all through it, and at the very bottom its back knee is
often hidden, so at 15 pictures a second "legs split" went unread on a reverse lunge); and `seen` "or another movement", a match
rule the camera must see, unseen making the rep another movement with no word: side on, a lunge's far leg hides behind the near one
only when the legs are together, and until then a squat filmed side on, done where a lunge was chosen, was told "Keep your whole
body in view." on 12 dips of 6 videos as filmed, and a split squat done where a squat jump was chosen, "Jump higher to count.".
**What kind of movement a dip is** (the chest, the stance, the hips alike) is set from the squat's nine people as well as the
movement's own (`alsoFrom`): four squat-jump people alone set "chest up" from 45 to 62 degrees with one left out. **Found and
mended in passing:** the plain break 0.1 s became 0.2 s (`MatchLimits.gap`; the phone's live mode leaves up to 133 ms between two
pictures, and every movement without "feet stay down", the squat's 202 ms, lost its feet at such a gap); a rep's first picture
step comes from the pictures just before it (at 8 a second a squat jump's feet were lost at its second picture); the measuring run
never takes a dip short of three quarters of its measuring depth as a rep (a replay that lost a lunge took its 0.09 step in its
place); and the plain sign of a changed body allows a trunk moving straight up or down (under 1 m/s across) up to 8 m/s, a jump's
take-off or landing (5.1 to 7.1 m/s on the four squat-jump videos, at most 0.6 across), every real change of body on the files
moving 2.2 m/s or more across, so all twelve swaps of the videos that set numbers and the bench file's six are still told. The
squat's numbers and table are as before. **The numbers** (`movement-check`, each person left out in turn): the squat jump, depth at
least 0.10 of a leg (the knees' own line, 128, by the hips' geometry, 1 − sin 64°), knees at most 128 degrees (the research file's
"about 90 to 120", 120 plus the camera's room), chest up at most 65, the jump at least 0.08 m (its people's smallest, under every replay,
0.12), stance holds 0.23 and hips alike 43 of a trunk and degrees; the lunge, depth at least 0.26, knees at most 120 (from its people's shallowest: no source gives the shallowest lunge that is one), legs split at
least 25 degrees (its people's narrowest 45), chest up at most 57. **Measured:** the squat jump
counts its four people's 16 jumps as filmed and under every held replay (12 of 16 where a passer-by hides one at a time, as it must;
15 of 16 done twice as slowly, written: gravity sets a jump's time in the air); the lunge counts 26 of 26 lunges of eight people as
filmed and under every held replay (the half-turned woman's first lunge, begun 0.2 s into her video at the very edge of standing
tall, lost shaken or slowed: written), every counted lunge given the leg the pictures show in front (13 left, 13 right, by eye,
and the phone's runs give each the same leg);
every other movement Kd's folders hold (97 videos under the squat jump, 88 under the lunge, the squat's own among them) counts 0 and
is told nothing, as filmed and under every held replay, with every person's numbers and with each left out, but Kd's two squat
jacks under the squat jump (3 and 2: each of his wide squats ends with a jump up as his feet come in; written, 54); the phone's own
runs count and speak as the laptop's on 101 of 101 videos under the lunge and 99 of 101 under the squat jump (the two squat jacks).
**Each video, by eye:** a squat jump clip begins low, cut from a set; it is played from the first picture of the person upright on
the floor, held a second as every first picture is, where a live set begins standing; a man's rooftop lunges are two takes joined by
a fade, each a set of its own. **Open, each written on its video:** with her own videos left out, the woman who leans 51 to 54 degrees
counts 1 of 4 squat jumps ("chest up" set at 51 from the others); with his left out, the side-on barbell man's shins read 46 apart
and he counts 1 of 2 (the line set at 49); the Smith machine split squat, a twin of the lunge, stays split between reps and is seldom
standing tall, 4 of 10 by eye (54); the squat jack as Kd's research file describes it stays low and never jumps up, and his two videos
stand up between jacks, so it is not made here (54).

**As built, floor work, holds and timed only (52c-ii, 2026-11-24; `rulings/2026-11-24-52c-ii.md`).** **Floor work** is a rep
counted from a body lying or seated low, with no new kind of counting: a movement's drive (`drive`) may now go `toward` "lower" or
"higher", on an angle as well as a height (never a width or a left-against-right measure), and an angle's stillness is 3 degrees
(`MatchLimits.stillAngle`: the same as 0.03 of a leg at the end of a trunk; a still lying, seated or held body's trunk lean moved at
most 1.2 degrees in any 0.2 s on six still spans); standing ready waits for the feet on the floor line only where the drive is a
height. A set may end at the far end of its last rep (`lastRep`): a rep held still out there when the set ends is judged then (a man
still sat up after his third sit-up as his video ends: 3 of 3; without it, 2). **The sit-up** (`movements/sit-up.json`): the trunk's
lean falls from lying as the trunk comes up; lying back is the trunk 60 degrees or more from upright **and the thighs within 20 of
level or above**, since the trunk's lean alone is the same bent forward: with the trunk alone, deadlifts, Romanian deadlifts, good
mornings and a swing counted up to 3 each as sit-ups (lying for a sit-up the thighs read 83 to 176 degrees from hanging, bent
forward 10 to 44), **and the shins 20 degrees or more from hanging**, since at the top of a hip thrust the trunk and thighs read so too (lying for a sit-up the shins read 28 to 90 degrees, at the top of a hip thrust 0 to 11; without it, the phone's own reading of a man sliding down off his hip-thrust bench counted a sit-up). Its depth is 45 degrees, the end of a crunch's whole range in Kd's "Decline Sit-Up" file (30 to 45), used as it
is, told "Sit up higher to count."; "thighs stay" at most 55 degrees and "hips stay down" at most 0.21 of a leg, each set from the
people (without the hips' rule a dumbbell hip thrust's lowering, its trunk falling 46 degrees, counts). **Measured:** six people (four
weighted sit-ups, a decline sit-up and Kd's own straight-leg sit-ups from a phone on the floor and on a bed, found in two of his
"usual positions" videos: lying flat, sitting up and lying back twice each) count 16 of 16 as filmed and under all 14 held replays and
the four shown; every other video (114) counts 0 and is told nothing, with every set of numbers; written: the man filmed from his feet
counts 0 with his own video left out (his hips read 0.15 moved, the others at most 0.11). A decline sit-up whose trunk comes up 25 to
35 degrees by the camera, a decline crunch by the research file's own measure, is reported. **The hip thrust**
(`movements/hip-thrust.json`): the hips' height rises from low; its start is the knees and hips each bent 130 degrees or less and
the trunk 65 or less from upright, the back on the bench and short of lying (and the shoulders 0.2 of a leg above the hips, the shins within 15 degrees of upright: a man sat up on the floor for a sit-up read as its start under uneven pictures; first built on the knees alone, its start also held at
the top of a thrust, so a thrust split in two, and a sit-up lying down read as a short hip thrust and was told so); depth 0.15 of a leg,
"hips open" 146, "back on the bench" at least 39 (a body that stood up reads under 20), "shoulders stay" at most 0.15. Of Kd's four
videos two are judged, 5 of 5 as filmed and under 12 of the 14 held replays, and two reported (filmed from in front and above, the hips'
height is not read at the top of each thrust; the other, the model loses the man). **Not passing yet:** each of the two women alone
sets a line the other misses (side on the trunk reads level at 92 degrees, facing the phone 57; facing the phone the shoulders barely
move), so both count 0 with themselves left out, and the one facing the phone loses thrusts done 1.5 and 2 times as slowly (her hips'
height not read near the bottom): all written, for 54's videos. **A hold** (`holdMovementSchema`, `HoldMatcher`): a clock that runs
only while every condition of the position holds, each read; the position must hold for a whole second before it is a hold, that
second counted too (`HOLD_LIMITS.settle`); the picture a condition breaks in, and every one after, is never held time; unread
pictures between two held ones are bridged, and counted, while that gap is no longer than 0.2 s, and a longer gap ends the hold (so a
hold's time can be a little more than the time watched, never more than the set); a clock that goes back is a new set, its old time
dropped, and a repeated picture decides nothing. `HoldRecord` gives a hold's set its `holdMs` (§2.4), no reps and no form score yet. **The
L-sit** (`movements/l-sit.json`, numbers by `hold-check` from every picture held by eye): thighs at least 71 degrees from hanging, trunk
at most 9, knees at least 155, elbows at least 165, the arms down within 18. His two videos are timed 7.87 and 3.10 s, as the
pictures show (the second's clock stops at the last picture before the video cuts to him hanging his knees), as filmed and under all 14
held replays (within 0.25 s, less what a passer-by hides, stretched when done slower or faster); every other video (120: the leg and
knee raises on the bars, a captain's chair, sitting on a chair, the support hold, lying) is timed 0. **Not passing yet:** two people,
so each counts 0 with himself left out (one's legs a little below level, the other leaning 6 to 8 degrees forward): written. And
nothing in its position reads the body as held up off the floor (round one): a long sit on the floor, the legs straight and the hands on
the floor by the hips, reads as an L-sit (at the top of a straight-leg sit-up four of its five conditions hold, the plate held overhead
failing the fifth); 54 adds a reading that tells held up from on the floor, with a long-sit video among the proof, or makes it timed
only, as the support hold is. Both of his
clips are of the full L-sit, the legs straight; the tuck L-sit his research file describes is a seated body's shape (54). **Timed only**
(`timedMovementSchema`): a plain timer, the camera judging nothing, with why. **The support hold** (`movements/support-hold.json`) is
timed only: made as a hold from his video it times him 6.60 s, and 28 of the 121 other videos, 75 s in all (people standing, calf
raises, deadlifts): to the camera it is standing with the arms by the sides. The movement engine is 2.1.0. Of his 21 new videos (13 of
these exercises, 8 others lying or held on the bars), 2.1 MB of body points. **The phone's own runs** of the 21 (the chosen set-up on the
laptop's pictures, 10 minutes of Kd's phone, kept in `test/phone-points`): under the sit-up and the L-sit every one of the 122 proof
videos counts, says and is timed as on the laptop; under the hip thrust two differ, both filmed from the front and written on each (the
barbell man's first thrust seen on the phone where the laptop could not; the Smith machine woman's hips read up again after her last
thrust, which would tell her "Push your hips higher to count."); under the squat, the squat jump and the lunge, the new videos read the
same on both (119 of 122 under the squat, the same three of his floor squats written as before).

**As built, one person locked on (52d-i, 2026-11-25; `rulings/2026-11-25-52d-i.md`).** Asked for one person the phone's
model gives one body in every picture, whoever it is. `OnePerson` (`packages/movement/src/body/person.ts`) is now the
engine's first stage: picture by picture it says which body is the set's person, and only that body reaches the stages
after it, so a body it refuses counts nothing, is told nothing and adds no time held. `CameraSet` (`src/movement/camera.ts`)
runs a set as the phone will, the lock first, every stage after it, and tells the lock the moment the set first counts (its
first counted rep, or its first held second); the proof's own run is held the same as it on every proof set
(`movementCamera.test.ts`). Nothing in it is any exercise's own: every movement gets it, with the same numbers. **Measured
first: the body's own proportions cannot tell two people apart** (`lock-check`: the 3D length of each bone as a share of the
trunk, the middle of each of 122 proof sets): one man's own 22 sets spread over nearly all of everybody's (the thigh 0.75 to
0.98 of his trunk, every set's 5th to 95th hundredth 0.73 to 0.90; the shin 0.71 to 0.91 against 0.69 to 0.87; the
shoulders 0.56 to 0.79 against 0.57 to 0.80), and one second's middle within one set moves 10 to 17 in 100 of itself. So the
lock reads where the trunk's middle lies on the picture and the body's size there (`bodySize`, picture heights a metre, from
the trunk and the legs; the arms only where fewer than four of those are sure, since one arm guessed in a new place each
picture, read too, made the size jump on Kd's reference videos). **Before the set has counted** the person is the body the
model follows, through a walk back from the phone or to a machine: a body that came bit by bit from their newest look (the
plain sign of 51c, now the engine's `bodyChange`), or one within the room below of it, is them. A body found after a picture
with nobody that is none of these is a new person, and every stage starts afresh with it (`fresh` on the checked, steady and
measured body; the matcher and a hold's clock start again as at a clock that went back), so it never borrows the body
before's bones, leg or floor (52a-ii-b-i's known limit, closed); on his own videos the sign fires on him so, walking back
from the phone unseen for a moment and found again 1.3 to 1.8 times smaller. A body that came all at once with no picture of
nobody between (a passer-by walking in front) is withheld while the person may come back, and the person then goes on as
they were; followed 3 s (the body check's memory of bones) while the person is not seen, it is the person instead, afresh.
**Once the set has counted** the person is a body within 0.95 m of where their trunk's middle lay over the second before,
at 1.35 times their size there or less either way; any other body counts nothing, however long it stays. A body that came
all at once from outside that place (the model changes bodies all at once) stays another while it goes on, into the place
too, followed up to a jump's 8 m/s in any direction and across pictures with nobody or whose size cannot be read, until it
has stood in the place for 3 s or has not been seen for 3 s: two bodies at the place at one size cannot be told apart, one
that stays there is the person far more often than one crossing it, and held longer a member the model goes back to there
would be refused for the rest of the set (round one). Every body seen outside the place is held so, the person who stepped
out of it too, who back in their place waits 3 s. A held body reaches no further than a jump's speed over one picture at
the slowest rate the engine takes (125 ms, about 1 m), however long it was unseen: judged over the whole time, after a third
of a second of nobody it reached 2.6 m, and the person found again in their place after a passer-by beside them was refused
3 s (round one's re-check). A body whose size cannot be read decides nothing; a set that has counted never starts afresh. **The two numbers** are set by `lock-check` from every proof set the camera
counts or times (778, as filmed and under the 14 replays that must hold), from the moment it counted to the last rep it told
the person about: the furthest anybody's trunk went from their place 0.72 m (a squat jump done 1.5 times as slowly), the
middle set's 0.33; the most their size changed 1.25 times, the middle set's 1.08; each bound beyond the furthest set by half
its distance from the middle set, rounded up. **Measured, the worst thing first** (`onePerson.test.ts`): six members' sets
(two squats, a lunge, a squat jump, a sit-up, a hip thrust) and the L-sit's hold, each with another person's real reps of the
same movement put in front of the phone as the model would follow them, 1.6 times the member's size at their place, 0.6
of it, 1.8 m beside, and 1.8 m beside at 0.8 (the member drawn further back, as the "farther" replay does, so that a stranger
fits): on every one of the 22 cases a picture has room for, the stranger counts and is told exactly as nobody there would be,
and the camera reads nobody in each of their pictures, the proof's own run the camera's on each; so does the member's own
reflection behind them (0.55 of their size) and beside them (1.2 m, 0.8); a stranger of each member's size who comes in all
at once 1.5 m beside and walks through their place (1.6 s within the room), with every picture read, every third of nobody,
or every third's size unreadable; a stranger who walks in and stays is taken only once 3 s in the place, never before; the
member back where a stranger stood is the member again within 3 s, on all six; a stranger 1.2, 1.5 or 2 m beside the member
for 0.5 s, then nobody for 3 or 10 pictures, then the member in their place, counts as with nobody there, on all six; a
passer-by nearer the phone just before the first squat is withheld and the set counts as with nobody passing. Lying side on, a body fills the picture's width, and a neighbour 1.8 m along it is off the picture (three
cases, listed); on the bars the second man is not timed alone put nearer or beside (three). **Deliberate breaks**, each
run red and put back, after the re-check: the set never telling the lock it counted (71 of the worst-thing tests red); no
place, size alone (46 red); no hold on a body seen outside the place (33 red). **The whole proof before and after** (every video under every movement the camera
counts or times, as filmed and under all 18 replays, 13,908 runs, the engine as merged against the lock; and every case a
later change of the lock decides otherwise, run again): 16 differ, all on his own floor videos where he walks from the phone.
His walk-back set counts 2 of 3 under uneven pictures (0 before) and done faster (1 before), still open (53). His
sit-and-stand on a chair (`usual_v08`) counts its second sit-and-stand, 13.8 to 17.1 s, a chair squat by eye and the squat's
twin: before, the standing taken at the phone, him found again 1.3 to 1.8 times smaller, was kept and no dip ever began;
written open for 54, with its count under each replay. The phone's own runs: his walk-back set now counts 3 of 3 on the phone as
on the laptop (the body learned while he was at the lens, whose knee the body check refused until 4.9 s, is forgotten when he
is found again smaller), so 20 of his 22 floor squats on the phone; `usual_v08` counts its chair squat on both, the phone also
telling his first sit to go lower (written). Through the floor view, shown only, his floor sets read through the lock move its
readings: from 12.6 to 14.5 degrees "feet stay down" alone falls short of his floor, his standing hips now within reach; with
the measured wander added, every judged reading is within reach from 12.6 degrees and 2 of his 10 raised squats are lost; on all
fours a floor phone sees one ankle in 60 found pictures of 100 (61 before); it is held at no lean (`movementFloorView.test.ts`).
On the old six-person barbell file the lock keeps the man in the three frames where the stand-in follower jumped between
bodies. **Limits, in plain sight:** a body of the member's size whose trunk
lies within 0.95 m of their place when the model changes to them is taken for them (a stranger squatting 0.5 m beside; a
neighbour lunging 1.1 m beside, 0.95 m away mid-lunge), so a neighbour doing a moving exercise is never taken only beyond about
1.7 m; a body of the member's size that walks into their place and stays there 3 s is taken (the walk-in that squats there
for 9 s counts 1 or 2 of their reps on four pairs); a member who steps out of their place and walks back is counted again 3 s
after being back in it, and one found again within about 1 m of where a held body was last seen waits as long (a stranger
1.0 m beside, just outside the room, then a moment of nobody: the member refused 3 s, 2 of 3 squats counted on two squat sets;
from 1.1 m nothing is lost); a member
who comes back to another place, more than 0.95 m from it, is not counted again in that set (52d-ii); before the set has counted, whoever the model follows is the person (a stranger who squats first is counted, and the
member after them is not): job 53's screen shows whose body the camera follows and, with two people there, asks one to raise
a hand (§11.8); a step to another place in the middle of a set leaves the place (52d-ii); walking to a machine, and a
neighbour already in view while the member is at the phone, are tried on the phone at job 53.

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
asking the model for six people (since 51c: the phone's own full model, asked for one). Each number is rounded once: 1/100,000 of the picture,
1/10,000 for depth and both kinds of sureness, 0.01 mm in 3D, a tenth of a millisecond;
the file says its own rounding and is read by it, so a later change of the steps cannot
read a kept file wrong.
On four of Kd's videos the model's own frame-to-frame shake was at least 0.0009 of the
picture, 0.019 of depth and 1.5 mm in 3D, and the rounding moved no joint angle of a
well-seen joint by more than 0.03°. A damaged file (a check number, a format number, every
length) is refused whole. Measured on his six reference videos: 2,054 frames, 2,406 people
across them, 1.2 MB kept against 13.6 MB as the model gave them (since 51c, asked for one person: 2,048
people, 0.85 MB kept); 502 bytes for each person
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

How the phone counts what its own live camera sees, rather than the laptop's pictures of a video (job 53; on the laptop's
pictures of all 78 proof videos it counts and speaks as the laptop on 74, the other four open in §12.5, 52a-iii) · whether full on the main chip still holds 15 a second with the camera
screen's engine, voice and drawing, and how the selfie camera reads a person in the room (job 53) · whether
one long recording cuts cleanly into lines (job 53) · a busy room in front of the live phone: a neighbour, a passer-by, a mirror, a walk to a machine (52d-i is proven on
real videos with a second person put into them; job 53) · whether a video redrawn from another
phone place is faithful (52a-ii-b-ii-a: drawn as a change added to the picture, it comes back exactly from its own place; his raised squats, redrawn from the floor, move every phone-changed reading towards his real floor squats but not yet far enough at any of his six leans, so it is shown, not held; the pose model's foot wander measured on his four floor sets and added lost squats his real floor counts and still did not read as it, 52a-ii-b-ii-b-i, so it stays shown until more floor videos exist) · the lens of a web clip (taken as 26 mm) and how high a phone's lens stands on the floor (taken as 15 cm) · a floor phone on anybody but the one man of 2026-11-20, and on a floor that is neither his shiny nor his dull one (job 53's live tries) · what the hips do in a real one-leg lift: on the drawn
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
| Muscles | three rows, each from the file's named source: main (what it calls primary), also worked (its other movers), keeps you steady (what it calls stabilisers). ONE fixed list of specific muscles (63a, Kd 2026-11-19: *"accurate specific"*): every muscle seen on the body's surface, each a shape of the phone's figures (front, side and rear deltoid; upper and lower chest; the three visible quadriceps heads; the two hamstrings; gastrocnemius and soleus; and so on), and the deep ones a source names (rotator cuff, transverse abdominis), which light the shape over them. `packages/shared/src/library/words.ts` holds the list and each muscle's plain name and anatomical name |
| Equipment | from one fixed list (60a): barbell, dumbbell, kettlebell, EZ curl bar, weight plate, cable machine, machine, Smith machine, resistance band, pull-up bar, dip bars, gymnastic rings, suspension trainer, bench, box, step, chair, jump rope, medicine ball, exercise ball, foam roller, mat, treadmill, rowing machine, exercise bike; empty means none, and a wall or the floor is not equipment |
| Level | beginner · intermediate · advanced |
| A set is measured in | reps or time. This is what a set's target is, said once; it replaces every family-code rule |
| Weight | a set never takes one · may · usually does |
| Each side | whether a set is done for each side |
| Starting numbers | the sets and target offered when it is added to a workout; the person changes them |
| Energy (MET) | the file names a code of the 2024 Adult Compendium of Physical Activities; the MET is read from the Compendium table, copied from the Compendium's own pages, and is never typed in an exercise's file (60a) |
| About, steps, mistakes, cautions | in proper wording, each from a named proper source (§11.3 step 5); a caution is its own fact, never a step, and as strong as its source says it (60a); text is kept by language, English first |
| Clip, still picture | each named by its own sha256, with its shape (and the clip's length, the picture's edge colour); made by job 62a's command from Kd's `final` folder; null until it is ("As built in 62a" below) |
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
  two lists. Beside each the member reads one of two marks (Kd, 2026-11-23; `mistakeMark`
  in `@app/shared`): "Checked by the camera" or "Not checked by the camera".
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
  and live. A published copy is never changed. There is no going back to an older copy (Kd,
  2026-11-18; "As built in 60b" below).
- **One download** for a signed-in phone: the whole list, the retired ones marked so that
  history can name them, and folder 1's camera data. It carries its own fingerprint, and a
  phone that already holds it is answered "not changed". Its size at 200 exercises is
  measured in job 60 and written here.
- The old routes are left as they are, with nothing added, but for one clause in the old save
  route ("As built in 60b" below).

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
- **A deleted file.** A Library row is never deleted: it is the one place a gone exercise's name
  is kept. While a saved set names it, it is 'hidden' and the download carries its last entry so
  that history names it; one of the old 58 is always 'hidden', because the old save route can
  still name it. Otherwise it is 'removed': out of the download, its entry kept. Every publish asks
  again about every gone row, so a set that arrives later brings it back as 'hidden'. Its
  `exercises` row stays, so its id word is never given to another exercise. "Named" means a saved
  set today; job 61 adds its saved workouts to that check and takes the publish lock shared while it
  saves, so no set lands between a publish's question and its answer. A save that names a 'removed'
  exercise is kept (61a, round one): the phone did that workout before the file was deleted, and the
  next publish finds the set and brings the exercise back as 'hidden'.
- **Copies.** `library_copies` holds each copy's exact text, so the fingerprint is the text's
  sha256. A copy is added for each of live and beta only when the text changed; beta is the
  `beta_definitions` flag's list, the one rule the old definitions use too, and while beta has no
  copy a tester gets live. A phone's tag is compared weakly (RFC 9110 §13.1.2). There is no going
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

**As built in 62a (2026-11-24; `rulings/2026-11-24-62a.md`).** It replaces §11.2 tool 6 but for its last part, which is 62c.
- **Kd's `final` folder.** Each exercise's folder in `D:\vidoe referene` holds a `final` folder (`final_<x>` where one exercise has
  two) with `final.mp4` and `final.png` of one shape, tall or wide. The picture is that `final.png`, never a frame of the clip. A
  clip outside a `final` folder is not finished and is never read.
- **The command.** `corepack pnpm --filter api exec tsx tools/library-media.ts "<exercise folder>" <id> [--write]` makes the clip
  (H.264 main, yuv420p, no sound, none of the original's own details, CRF 28, slow, fast start) and the picture (WebP quality
  90), each 1280 on its long side at most in its own shape, names each by its sha256 in `media/library/` (git ignores `media/`),
  measures the colour round the picture's edge, and writes a sheet (the picture, then a frame of the clip a second) to
  `media/sheets/<id>.png`. The terminal looks at the sheet; with `--write` the command names both in the exercise's file. An
  automatic check of the clip against the picture was measured and does not work (62a's plan): the look is the check, and a real
  person filmed in a real gym is never published.
- **Measured** (2026-11-24, the three exercises): clips 3,048 to 5,243 KB → 144 to 186 KB, pictures 1,317 to 1,632 KB → 29 to
  37 KB; 596 KB for the three. The server's check of a file before it sends it (its sha256): 0.28 to 0.34 ms a clip, 0.06 to
  0.07 ms a picture, once for each phone, which keeps it.
- **Where they are kept.** The server's own disk (`LIBRARY_MEDIA_DIR`, unset: `media/library/` at the repository's root) until
  Cloudflare R2 (Stage 4 item 4). `GET /v1/library/media/<sha256>.<webp|mp4>`, signed in: 400 for any other name; 404 for a file no
  live, retired or hidden exercise names, one the server does not hold, or one whose bytes are not its name's sha256 and what its
  ending says (logged by its name alone); 304 to a phone that holds it; kept a year. A server without the files answers 404 and
  the phone keeps the app's own picture.
- **The check.** One exercise's picture or clip is never named by a second, and a clip and its picture are one shape; the phone's
  reading takes a picture or clip it cannot read as none.
- **The phone.** It fetches a picture with the person's token the first time its exercise is shown, keeps it only when its
  sha256 is its name, in the documents folder under that name (the app's content, nobody's data, so it is kept for everybody on
  the phone), and never asks again. Until then, and for an exercise with none, the app's picture of its kind is shown. The
  exercise's page shows its picture whole under the top buttons, its own edge colour from the top of the phone and to both sides,
  the name under it; the card fits it whole beside the small muscle box, the kind word on a dark backing; My Workout, Saved
  workouts, the calendar's day and the workout's sets show it small. The workout screen's big picture changes in 62b, with the
  clip.

**As built in 62b (2026-11-25; `rulings/2026-11-25-62b.md`, Kd's drawing "Exercise Clips on the Phone").**
- **KWAZO in every clip.** The command lays the app's wordmark (`apps/api/tools/library-mark.png`, its white pill, made by
  `library-mark.py` from `look/Wordmark.tsx`'s font and colours) into the clip itself, bottom-left, the pill 9.5 % of the clip's
  short side tall and 4 % in (`markPlace`); `--mark-right` puts it bottom-right for a clip whose person reaches that corner, which
  the terminal decides from the sheet, and the clip's file says which (`mark`, left where a file made before says none). Still
  pictures carry no mark.
- **A clip's grey meets its picture's.** On the walk Kd's clips were 2 to 8 shades off their pictures' grey (#CDCDCD on #D5D5D5,
  #D5D9D4 on #D1D1D1, #B2B2B0 on #B8B6B7, as the command printed them), which showed as a box round the clip. The command measures the clip's grey round its edge (a frame each
  second) and moves its colours by the difference before the mark is laid (`greyShift`, refused past 24 shades as not from one
  final folder); the phone melts only the clip's last few per cent into the grey, short of the mark. The three clips were made
  again (141 to 203 KB) and meet their pictures' grey within 2 shades.
- **The player** is expo-video 57.0.5 (`library/clipPlayer.tsx`), loaded only where the phone has it (`library/clipNative.ts`): a
  copy built before shows the picture. It plays the file the phone keeps (62a's sha256-checked download), so no Range request is
  needed and a clip plays with no internet once it has come; looping, muted and mixing, so the person's music plays on (a muted
  player never asks Android for the sound); the screen is never kept on by it; drawn as part of the page (texture view).
- **One clip, one player.** Each exercise's clip has a player of its own and shows only from its own first frame, over its
  picture; the kept-file hook never gives the last file's address for a new one (`useKeptFile`), so moving on in a workout shows
  the new exercise's clip, its picture while the clip is still coming, and never the last one's.
- **The page:** the clip over the picture, the same box; a pause button at the band's foot on the side away from KWAZO ("Pause the
  clip" / "Play the clip"). With the phone's Remove animations on it waits for Play, and nothing moves before that setting is read.
  The page and a workout show the clip by one rule: once the exercise's own picture has come (it is small and comes first).
- **A workout:** the exercise's own picture whole at the top on its own grey, the top's buttons above it, the clip over it, the
  line above the name and the name under it (`workoutPictureHeight`: its shape at the phone's width, at most 29 % of the screen's
  height, never under 160); an exercise with no picture of its own keeps the band of 64a-ii. In a rest it is the exercise coming up
  next; paused, the clip stops on its frame; with Remove animations on, the picture alone. Every exercise's picture and clip is
  asked for when the workout opens.
- **What the phone keeps:** every clip and picture once shown, in the documents folder; about 45 MB at most for 200 exercises (62a's
  mean sizes), so no limit is set.
- **Measured on Kd's phone** (2026-11-25, the development copy, a workout with the clip playing): the video player 8 % and its
  decoder 4.5 % of one core, beside the app's own 38 %; the phone's sound-focus list empty while a clip played (no request from the
  app), so the person's music plays on.

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

**As built in 61a (2026-11-18).** The save is `POST /v1/workouts` (`workoutSaveSchema` in
`packages/shared`, `apps/api/src/modules/training/`); its Idempotency-Key is the workout's id.
- **Answers:** 201 saved · 200 saved already · 400 a broken phone (a NUL character included), naming
  its fields and never its values · 404 somebody else's id · 422 `unknown_exercise` with the id words · 429 past ten a minute
  for the person (never counted by address).
- **Kept** (migration 0244, new columns on `workouts` and `workout_sets`, empty on every old row): the
  name, end, time zone, what it was started from, the effort stars, the heart rate's average and
  highest (the readings are not kept, as a run's); for a set its unit, target, weight in grams, rest
  after it and how it was counted. Reps done stay in `reps` and time done in `hold_ms`; a set by hand
  or timer is `log_only`; `engine_version` is the app's version, as the old route's means. Counted by
  camera is refused until job 64b adds it with the set's summary.
- **Known exercise:** any exercise with a Library row, a removed one included (the next publish brings
  it back as 'hidden'); only an id word the Library never had is refused. The save holds the publish
  lock shared, so no set lands between a publish's question and its answer. Once its fields pass the
  shared schema, an id already the person's is answered "duplicate" before anything else is asked (its
  end, its exercises), so a saved workout sent again is never refused later.
- **A set is kept in its own unit and weight**, as the phone's list had them, whatever the Library
  says when it arrives: refusing it would leave a finished workout that can never be saved after a
  Library edit. Job 61b's records read each set by its own unit.
- **Time zone:** kept by its own name as the server spells it ("asia/kolkata" is kept as Asia/Calcutta,
  Etc/GMT-3 as itself). One the server cannot use (not a zone, or an offset such as +05:30, which
  Postgres reads with the opposite sign) is kept as none and never refuses the workout; a day is then
  worked out in the person's own zone.
- **Limits:** 200 sets; 1,000 reps; four hours a set; 1,000 kg; an hour's rest; 12 hours a workout; its
  sets and rests within its length, with a second a set of slack; a time done no more than a second
  past its set; an end no more than five minutes past the server's clock. The phone measures the
  length with its steady clock.
- **Calories:** version 4 (`training/calories.ts`): a set's time at its exercise's Library MET, a set
  with nothing done and every rest at REST_MET 1.8, a pause at nothing, all spent against the
  workout's length in the order of the sets. XP and the streak are worked out again from history after
  the commit, as for the old route, so a second send gives nothing twice.
- **Old readers:** the old exercise mix (`/v1/progress/distribution`) leaves out an exercise with no old
  family; the history, a workout's page and its summary read a new workout unchanged.
- **Measured** (2026-11-18, `apps/api/tools/measure-workout-save.ts`, local database, the api's pool of
  10): a usual save (20 sets, an hour of heart rate, 51 KB) holds the server 7.2 ms, the biggest (200
  sets, 12 hours of heart rate, 652 KB) 46.3 ms; 199 people saving at the same instant took 3.0 s in
  all, 2.5 s each (median), and the server answered nobody for at most 15.8 ms at a time.

**As built in 61b (2026-11-18).** Four reads beside the save (`apps/api/src/modules/training/history.ts`,
shapes in `packages/shared/src/library/workoutHistory.ts`), each the person's own:
- **Routes:** `GET /v1/training/month?month=YYYY-MM` (the days and how many workouts on each) ·
  `GET /v1/training/days/:day` (that day's workouts in the order they started, the first 100, with `total`) ·
  `GET /v1/training/workouts/:id` (set by set, with its new records) · `GET /v1/training/exercises/:exercise/records`.
  Somebody else's workout, a broken id and an exercise the server never had are 404; a bad month or day 400;
  120 reads a minute for the person, never by address.
- **A day** is the day in the zone the workout was done in, or in the person's own zone for one kept without one. The person's
  own zone is read by its name, once, for the plan's days too; one kept as an offset ("+05:30", which Postgres
  reads with the opposite sign) is UTC, in the old history's reads as well.
- **Free plan:** the month, the day and the records read back the old history's days (`historyGate`, the same
  rule) and say so in `limitedToDays`. A workout's own page opens whatever its age, as the old one does, and its
  "New record" is told against everything before it: told against only part of the past, it could call a set a
  record that is not one.
- **The rule** (`training/records.ts`, pure, table-tested): a set with nothing done is no record; a set is read in
  its own unit (an old set with a hold is in time); heaviest, most reps, best estimated one-rep max (Epley, sets of
  1 to 10 reps with a weight), most lifted in one workout (reps sets), longest hold and heaviest in time; a tie
  keeps the first time it was reached; "New record" needs something of that kind before it to beat, so the first
  time is not a record. An exercise the Library never had is named null; the phone shows its id word.
- **Measured** (2026-11-18, `apps/api/tools/measure-training-history.ts`, local database, 846,622 sets in the
  table): for a person of 1,560 workouts and 46,800 sets, the server answered nobody for at most 4.9 ms on a
  month, 2.7 ms on a day, 16.7 ms on their newest workout with its new records against five years, 16.4 ms on an
  exercise's records over five years. The database sends only the first set of each way a set was done, and each
  workout's lifted total: reading every set held the server 75.6 ms.

**As built in 61c (2026-11-19).** A person's saved workouts (`apps/api/src/modules/training/saved.ts` and
`savedRepo.ts`; the shape is `plannedWorkoutSchema` in `packages/shared/src/library/plannedWorkout.ts`, which
items 36 and 24b take as it is):
- **The shape:** a name (1 to 60 characters) and 1 to 50 exercises in order, each with its unit (reps or time, as
  the phone's list had it) and 1 or more sets of a target, a weight in grams (or none) and the rest after it (or
  none); 200 sets at most in all. The same exercise may come twice.
- **Routes:** `GET /v1/training/saved` (the list, the most recently changed first: each one's exercises' id words
  in order, each once, and its number of sets; with `most`) · `GET /v1/training/saved/:id` (one, whole) ·
  `PUT /v1/training/saved/:id` (save, or save a change, under the phone's own id) · `DELETE /v1/training/saved/:id`.
  Somebody else's saved workout is 404 to all four; a broken id is 404 to a read or a delete and 400 to a save.
  Saves and deletes 30 a minute for the person, reads within the 120 of the history; never by address.
- **A save** answers 201 created, or 200 `updated`, `unchanged` (the server holds this change or a newer one, by
  the phone's `editedAt`, so a late send never undoes a newer change) or `removed` (the person deleted it; nothing
  is kept and the phone forgets it), with the `editedAt` the server holds (one finer than a millisecond is
  refused, as a broken phone, so what is kept is what reads back): an
  "unchanged" whose `editedAt` differs from the phone's tells it to read the saved workout again. A save and a
  delete of one id take a lock on the id, whoever sends them, so an id has one owner. 422 `unknown_exercise` as for a workout; 409 `saved_workouts_full` past
  **50 for each person, on every plan** (Kd, 2026-11-19), counted under the person's own lock so two at the same
  instant cannot both pass; 400 for an `editedAt` more than five minutes past the server's clock. It holds the
  publish lock shared, as a workout's save does.
- **A delete** answers 204, sent twice too, and for an id the server does not hold yet: the id is kept with its
  owner (`saved_workout_removed_ids`, as `meal_removed_ids`), so a save of it still on its way keeps nothing. A
  person's newest 1,000 are kept and the oldest go, so deletes cannot add rows for ever.
- **Kept** (migration 0245): `saved_workouts`, `saved_workout_sets` (no user_id of its own, collected with its
  saved workout by the cascade) and `saved_workout_removed_ids`, all three in the privacy download and delete
  lists and the policy's words. The old `workout_templates` is left as it is. A publish asks of saved workouts
  too: an exercise one names stays 'hidden' while its file is gone.
- **Measured** (2026-11-19, `apps/api/tools/measure-saved-workouts.ts`, local database, 209,750 saved sets in the
  table, the api's pool of 10): for a person at the limit (50 of 200 sets), the server answered nobody for at
  most 7.0 ms on the list (8 KB), 6.3 ms on one (13 KB), 5.4 ms on a new one, 5.9 ms on a change and 2.2 ms on a
  delete; 200 people saving 200 sets at the same instant took 0.9 s in all and the server answered nobody for at
  most 23.7 ms. The publish's question was measured over this folder's 3 Library rows only (2.6 ms).

**As built in 64a-ii-b (2026-11-22; Kd's "yes" of 2026-11-21).** A workout counts its time trained, never its pauses: the
save carries `trainedMs` (the time the workout's screen showed, every pause and every away-time past 10 minutes left out), no
longer than its length and never shorter than its sets and rests (a second a set of slack), a whole number of milliseconds up to 12
hours, else 400. The server keeps it as `workouts.duration_ms`, which Hours Trained, the minutes challenges, goals and the gym's
numbers read; the start and end stay the workout's own, and the calories are unchanged (version 4: a pause was never charged). A
workout kept on a phone before it sent the field still saves, counting its sets and rests within its length (`trainedMsOf` in
`packages/shared`). Workouts saved before it keep the length they were saved with: only the folders' own test accounts have any,
as the testers' store version (17 November) has no Start workout.

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
  Kd for the package. (64a-vi came first: expo-audio 57.0.5, `apps/mobile/src/sound/soundNative.ts`, Kd's "go".)

**As built in 63a (2026-11-19).** Workout → Exercises is the Library (`apps/mobile/src/screens/library/`, rules in
`apps/mobile/src/library/`), drawn from Kd's approved drawing of that day.
- **The figures** are Kd's own four line drawings (male and female, front and back, made in ChatGPT), each half mirrored
  onto the other and every closed shape named as a muscle by `apps/mobile/tools/figures/trace.py`, which writes
  `src/library/figures.ts`. A test holds them to the word list: every muscle is drawn or lights a drawn one, and the male
  and female figures show the same muscles. The figure is the person's own, from their setup answer, with no switch (Kd,
  2026-11-19: a man never sees the female figure, a woman never the male one); "other", "prefer not to say" or none show
  the male figure.
- **The list kept on the phone:** the newest download in one file for everybody (`library.json`), shown at once; each open
  asks `GET /v1/library` with its fingerprint (If-None-Match) and 304 keeps it. With no copy and no internet the page says
  "Couldn't load the exercises" with Try again. The phone reads the download through `readPhoneLibrary`
  (`packages/shared`): any short word is taken, one exercise that cannot be read is left out, and one whose cautions cannot
  be read is left out, never shown without them. Only live exercises are listed.
- **Search** (`search.ts`, table-tested): the name (whole, its start, every word starting a word of it, then held in it with
  spaces and marks aside), then another name, then the muscles it works (main and also, never the steadying row), its
  equipment or kind; A to Z within each. A search made of a muscle's plain name ("biceps") reads plain names only, so the
  hamstring's "biceps femoris" does not answer it.
- **A card:** a picture (the app's own of that exercise, else of its kind, until job 62) shown whole in its own colours
  inside the card's top, never cut and never faded (Kd), a small figure lit, the level as plates, the main muscles' plain
  names, the starting target and the intensity as flames: the Compendium's own bands on the MET, light under 3.0,
  moderate to 5.9, vigorous from 6.0. Kinds offered are only those the Library holds.
- **The page:** the facts strip (sets × reps or time, level, intensity, equipment; none shown as the dumbbell struck
  through), every caution above the tabs (one alert each), then Muscles (front and back lit, a line naming the first main
  muscle, the three rows in gym terms: Primary, Secondary, Stabilisers), Instructions (one step a card, swiped, then
  About) and Mistakes (a mistake's first sentence as what goes wrong, the rest as the fix), then ⓘ Sources, which opens
  the list from the bottom. How it is counted reads "Manual tracking" for every exercise until exercise folder 1's 52a
  publishes camera data and its shape.
- **Round one (2026-11-19):** a copy is served by its frame and fingerprint, never checked again against today's word
  lists (`libraryCopyFrameSchema`), and a publish carries on a stored entry of an exercise whose file is gone in the words
  it was written under (`storedLibraryEntrySchema`), so a list may change without refusing what was published before. No
  figure is drawn until the person's setup answer is known; the answer the server last gave is kept on the phone for that
  person (`figure-<id>.txt`) and the kept Library is one file a person (`library-<id>.json`), both removed with the
  account. A Library not yet published (404) reads "Exercises aren't available yet". Search takes the muscle words people
  type ("quads", "core").
- **Not in 63a:** the filter button and "Find by muscle" (63b); records, calories a minute and Add to workout (63c).

**As built in 63b (2026-11-19, Kd's second drawing after his click-through).** Two screens, each from its own place on
the Library. **Find by muscle** (`FindByMuscle.tsx`; from the card, which shows the person's own figure front and back and
hides while searching or while a filter other than the kind is on): the person's own figure fills the screen, Front or
Back; two fingers zoom it about the fingers (up to four times), one finger moves it while zoomed, a double tap zooms in
where it lands and back out, and Fit body puts it back (`src/library/stage.ts`). Every muscle can be tapped: a tap is read
against each shape's outline (`muscleAt` in `figure.ts`), never by the shape's own press, so a double tap or a moving
finger picks nothing. One tap picks that exact muscle (the vastus lateralis, not the whole quadriceps; a deep muscle
belongs to the drawn one over it) and the same tap lets it go. Underneath, at once: the group's name over the muscle's
own (`muscleFamily`, `muscleTitle` in `words.ts`: "Quadriceps" over "Vastus lateralis"), how many exercises, and each as a
row (Primary or Secondary, level, starting target) that opens its page over the body; a muscle no exercise works says "No
exercises for this muscle yet." Show in Library puts it on the Library as a tag. **Filters** (`Filters.tsx`; from the
filter button): Muscle as one row that opens the same body ("Use this muscle"; its rows there are lines, not buttons), then
Equipment (No equipment first), Level, How it is counted and Kind as chips, only the values the Library holds, each with
its count; a choice already on is always shown, lit, even where the search has taken its exercises away (its count 0),
so it can be let go. Two choices in one group mean either, choices in different groups mean both, and a choice's count is
the exercises that have it with every other group's choices kept (`src/library/filters.ts`, table-tested). The counts are
taken within the search, so "Show 2 exercises" opens exactly two. Muscles are those an exercise works (main and also), never the
steadying row. Changes show on the Library only by Show; the ✕ leaves it as it was. On the Library each choice is a tag
with ×, and Clear all; the kind chips and Kind are one choice (a chip picks its kind alone, and a lit chip lets it go).
Where the search finds exercises that the filters hide, the Library says "No exercises match these filters", never that
nothing matches the word. The body screen is a window of its own on Android, so it
has its own gesture root. Until the setup answer is known there is no figure, so no Muscle row. Not yet: picking a muscle
with a screen reader.

**As built in 63c (2026-11-20, Kd's fifth drawing that day).** On an exercise's page, under the facts strip and its cautions:
- **Calories a minute** for the person's newest weight, the one a saved workout's calories are reckoned at (`kcalPerMinute` in
  `packages/shared`, held to the server's `kcalForSave` by a test): "About 5 kcal a minute for you, at 82 kg"; with no weight,
  "About 4 kcal a minute at 70 kg" and Add your weight, which opens Progress on Body; closing it asks for the weight again. No
  line until setup's answer is heard.
- **Your records**, read from the server (`GET /v1/training/exercises/:exercise/records`, which since 63c also gives `recent`:
  the person's latest seven workouts of the exercise in which something was done, each with its own best of each kind, by the
  same rule as the records), drawn as the gym's own things (`screens/library/Records.tsx`, rules in `library/records.ts`,
  table-tested). Heaviest as the loaded bar: a standard 20 kg bar with the standard plates a side (red 25, blue 20, yellow 15,
  green 10, white 5, the change plates the same) that make the weight exactly, and the estimated one-rep max (Epley, named as
  an estimate) as outlined plates beyond them, rounded down; drawn only for a barbell exercise in kilograms from 20 kg with every
  plate on the sleeve, else the number alone, and the estimate's plates left off where they would not fit. Each day shown is the
  workout's own (`days` in the answer, in the zone it was done in), as History tells it. No one-rep max is shown below the heaviest weight lifted. Most reps (red), best volume (amber, all sets of one
  workout) and longest hold (green) on the LED wall timer; the last times as its bars, each lit as far as it came to the
  record, the record's own workout in red with "PR". Which record leads: a time exercise its longest hold; one in reps its
  heaviest where the person has lifted a weight in it, else most reps. None yet: one line ("Your best set shows here after
  your first workout."), no box. A free plan's records say "From your last 90 days".
- **Add to workout** held at the foot: added once, pressed again it comes out, with "N in My Workout" and Open.
- **My Workout**, the Workout tab's second part, its count on its button: the exercises added, in that order, each opening its
  page, each with its ✕; one no longer in the Library says so. Kept on the phone in a file of each person's own
  (`my-workout-<id>.json`), removed with the account; at most 50. Start workout reads "Coming soon" until 64a.
- **Not in 63c:** Goals' exercise picker on this list (its job is Kd's to place).

**As built in 64a-i (2026-11-20, Kd's drawing of that day).** My Workout is now set up before it is done:
- **Kept on the phone** in the same file (`my-workout-<id>.json`, removed with the account), now `{ v: 2, name, items }`:
  each exercise in order with its plan (its unit and its sets, each a target, a weight in grams or none, and the rest
  after it), checked by `plannedExerciseSchema` and at most 10 sets. An exercise nobody has changed keeps no plan and
  shows the Library's starting numbers (its sets of its reps or time, no weight, 60 s of rest). 63c's `{ v: 1, ids }`
  is read as exercises on those numbers, so the update loses nobody's list; a plan that cannot be read leaves its
  exercise on them.
- **The page:** the workout's name over the picture (typed in place, 60 characters, "Name this workout" until named),
  and under it "3 exercises · about 14 min · about 95 kcal": a rep at 3 s, a set "each side" twice, the rest after
  every set but the workout's very last, calories as a saved workout's (MET × kg × hours, rests at 1.8,
  `KCAL_REST_MET` held to the server's by a test); where the person has given no weight, "about 95 kcal at 70 kg" with
  Add your weight, as the exercise's page says it (round one, H2); none until the weight is heard or where one
  exercise's MET is not known. Each row says its sets ("3 × 10 reps · 20 kg · rest 1:00", "4 sets · 10, 10, 10, 6
  reps · 35 to 40 kg · rest 1:00", "on some sets" where a set has none). Reorder puts up and down in place of ✕; Clear
  asks first and keeps the name; Add exercises opens the Library.
- **Setting up one exercise** (`SetUpSheet.tsx`, rules `library/workoutSetup.ts`, table-tested): a box from the
  bottom, About and Done at its foot.
  - **The weight**, the same for every exercise and offered on every exercise from "None" (Kd's click-through: *"weight
    needs to be a symbol tha can go with any exercises for representing weight not a barbell"*): a bumper plate in the
    app's orange, light running deep as its main buttons, with a soft orange glow and a steel hub, the number above the
    hub and the unit below, a small pop when it changes; black rubber reading "NONE" for no weight (Kd turned down a red
    face and a black one: *"orange type vibe better"*). Always the same size, so the box never moves under a press.
    − and + go 2.5 kg or 5 lb (a barbell exercise's + from none gives the empty 20 kg or 45 lb bar), up to 1,000 kg.
  - **Type a weight**, under the plate or a tap on the plate (Kd: *"a manually writing weight with a option should also
    be there"*), types it with the number keyboard, to one decimal: "47,5" is read, empty or 0 is no weight, words say
    "Enter a weight such as 47.5." and past 1,000 kg "Enter a weight up to 1,000 kg.". What is typed is kept by every
    way of leaving it (Done, ✕, the background, Back, About, another set, + or −); Done keeps the box open where it
    cannot be read (round one, H1 and L2).
  - **Sets** (amber), **reps or time** (red) and **rest** (green) on the LED wall timer, each with − and +. Time goes
    5 s a press under a minute, 15 s to five minutes, 30 s past it, from 5 s to an hour; reps 1 to 1,000; rest 15 s a
    press, to 10 minutes; sets 1 to 10, a new one a copy of the last.
  - **The sets**, always listed under the controls, "Every set" at the top: the line picked is what the controls
    change, and they always show its real numbers; a press on Every set gives every set the first set's number after
    it (Kd's click-through: "--" and "varies" with presses that changed nothing he could see).
  - **Your records** on the exercise's page keep 63c's loaded bar, with the chrome 1.25 kg change plate added so every
    2.5 kg step is drawn there.
- **The phone's reading of an exercise** now keeps `set.weight` and `set.eachSide` (`phoneLibraryEntrySchema`).
- **Not in 64a-i:** Start workout reads "Coming soon" until 64a-ii; saving it as a saved workout is 64a-iv.

**As built in 64a-ii (2026-11-21, Kd's drawing of that day).** Start workout on My Workout does the workout:
- **The steps** are one pure piece (`apps/mobile/src/library/workoutRun.ts`, table-tested): every press carries the phone's clock, and
  the workout's own clocks (`totalMs`, and `activeMs` less every pause) move on by the time that passed, never back. A set by hand
  counts reps (+, or a tap on the red number) and ends by itself at its target, or on Set done, which keeps the reps shown or the
  target where none were counted; a set measured in time is a timer ending by itself at its target, Set done keeping the time held.
  Then its rest, then the next set by itself; a timed set with no rest before it gets 10 s to get ready (Start now skips it). The
  set's target and weight change right there; −15 and +15 change a rest, Skip rest ends it, and the set just done by hand can be
  put right during it. Reset set, Skip exercise, Pause (every clock stops), End with a question: End and save keeps the sets done,
  Discard workout keeps nothing (Kd: the browser's Stop lost the workout). Every phase that ended while the app was away ends at its
  own time, in order; away more than 10 minutes, the workout comes back paused from when it was last seen.
- **Kept on the phone** in a file of the person's own (`workout-now-<id>.json`, `workoutRunSchema` in `packages/shared`), written at
  every press and every 15 s while the clocks run; removed with the account. It holds each exercise as it was at Start, so the
  workout goes on with no internet and whatever the Library says meanwhile.
- **Kept until saved, built once** (`apps/mobile/src/session/waitingList.ts`): the one shared piece; anything sent whole under its own
  id is written to the person's file before it is sent, sent oldest first, and taken out only when the server answered. Saved ·
  refused (words for the person) · not now (no answer, 401, 422, 429, 5xx), tried after 15 s, then twice as long each time up to 5
  minutes, and at once when the app opens or comes back. A finished workout goes to it (`workouts-<id>.json`, at most 100), and only
  once it is there is the workout's own file emptied; a phone that dies between the two hands it over again, kept once by its id.
  Then `POST /v1/workouts` (61a) with the workout's id as its Idempotency-Key, made by `expo-crypto`. Its sets: by hand `hand`, a
  timer `timer`; `startedFrom` "none" until 64a-iv; no heart rate until 64a-vi; at most 12 hours long, never shorter than its sets
  and rests; its time trained beside it since 64a-ii-b (§13.5).
- **The screen** (`apps/mobile/src/screens/workout/`): over every tab, as a run is; the exercise's picture with "Exercise 1 of 3 · Set 2
  of 3" (in a rest, "Coming up next" and that set), the LED wall timer (reps red, target amber, the rest's ring green, get-ready
  amber, PAUSED with a capital D), the set-up box's weight plate, Next up, one main button saying what it keeps. The screen stays
  awake. Put away (the arrow, or Back), a bar over every tab says "Workout in progress" and opens it again, and My Workout says Open
  workout. Its last screen: Workout complete, its time, sets and exercises, and "Saved to your account", "Saving…", "Saved on this
  phone" (no answer), or "This workout couldn't be saved." (also on My Workout until OK).
- **Round one (2026-11-21):** a workout ending more than five minutes past the server's clock (a phone whose clock runs fast)
  is answered 400 `not_ended_yet` (`WORKOUT_NOT_ENDED`), its own word, and the phone sends it again later, never refusing it for
  good; a set or a rest left open is kept as no longer than the 12 hours a save allows, so a workout is always one the server and
  the phone's file take; a finished workout the waiting list could not keep (full, or its write failed) stays in the workout's own
  file, is handed over again every 15 s and at each open, and Start workout waits for it ("Your last workout is still being kept on
  this phone. Try again in a moment."); a workout of more than 200 sets does the first 200, and My Workout says so; "Saved on this
  phone · It goes to your account as soon as it can."; the time shown is the time trained, every pause left out.
- **Not in 64a-ii:** the summary (64a-iii), saved workouts (64a-iv), history (64a-v), heart rate and sounds (64a-vi), the camera (64b).

**As built in 64a-iii (2026-11-21, Kd's drawing of that day, its fonts and glow brought down at his word).** A workout's last
screen (`apps/mobile/src/screens/workout/Summary.tsx`, words `afterWords.ts`, table-tested):
- **What the phone holds shows at once, with no internet:** confetti (none under Reduce motion), the wall timer with the time,
  calories and sets (calories unlit until the server's are known), whether it is saved, then three tabs. **Sets:** every set
  done, exercise by exercise, "8 reps of 10" where a set stopped short, the weight, what each exercise lifted in all, a gold PR
  on the set that made a record. **Recover:** the cool-down stretches and the water reminder (500 ml in 30 minutes, 17 fl oz
  beside it in imperial). `Finished` now carries the sets done and the exercises as they were at Start.
- **What the server works out** fills in once the workout is saved: `GET /v1/training/workouts/:id/summary`
  (`workoutAfterSchema`, `apps/api/src/modules/training/summary.ts`), the person's own workout only (somebody else's, a broken
  id or none is 404), within the 120 reads a minute of the history. It gives the calories the save worked out and the weight
  they are reckoned at (null: 70 kg, said so, with Add your weight), the stars as kept, XP earned (the workout's 50 and its form
  bonus, plus 10 for the day's first workout continuing the streak, the same rule the total counts) with the level now, the
  streak now, each new record with what it was (61b's records, the heaviest, the estimate and most lifted in grams, most reps,
  the longest hold in seconds), and the meal ideas after a workout (the one rule of 34d-ii) with the allergy warning, which
  the phone's reading refuses empty, so no idea is drawn without it. **Results:** XP with where it came from, the level bar,
  the streak, New records under a bell, and How hard was it?. Waiting: "Adding up your XP and records…"; on the phone: "…
  show here once this workout reaches your account."; unread: "Couldn't load your XP and records." with Try again.
- **The stars** (Too easy, Easy, Just right, Challenging, Very hard): `PUT /v1/training/workouts/:id/effort`
  (`workoutEffortSchema`, 1 to 5), 200 with what the workout holds, 404 for somebody else's, 30 a minute for the person.
  On the phone each press waits in the one shared list (`library/effortSaving.ts`, `workout-effort-<id>.json`, removed with the
  account) under its own id, sent in the order pressed so the last pressed is kept, and only once its workout is on the server.
  A 404 or 400 is let go with no words (nothing the person could do); no answer, 401, 429 and 5xx are tried again.
- **The stretches** (`stretchesFor` in `packages/shared`): the old summary's words, picked by the plain names of the Library's
  main muscles of the workout's exercises, read from the Library kept on the phone. The old summary route and its
  `summaryContent.ts` stay as they are for the web's frozen page.
- **New workout** closes the screen onto Workout → Exercises; Done onto where the person was.
- **Round one (2026-11-21):** the weight beside the calories is the one the save worked them out at, kept on the workout
  (`kcal_weight_grams`, migration 0246, empty where none was given; a weigh-in after the save never changes the line); a
  person who has given a weight since reads "Your weight is saved. Your next workouts use it." in place of Add your weight;
  the XP adds the badges the save awarded (`forBadges`: a badge a workout can earn, never a meal's, awarded within 10 s of
  the workout's save and before the person's next workout or run; "· 50 for a new badge"); the streak says "Train today to keep it" where today is not yet one of its days (`streak.today`); a press of the
  stars counts as waiting until the server has it, and one the full list could not keep says "These stars couldn't be saved.
  Try again later."; a refused workout's Results says "This workout wasn't saved, so it earns no XP or records."; the shared
  waiting list takes `ready`, so stars waiting for their workout keep their place and never hold up another workout's.
- **Not in 64a-iii:** the form score and grade (64b, with the camera); the share card (item 39).

**As built in 64a-iv (2026-11-22, Kd's drawing of that day).** A person's saved workouts on the phone (61c's routes):
- **On My Workout** (`apps/mobile/src/screens/library/SavedPart.tsx`, one place on the page whatever My Workout holds): under Start
  workout, **Save workout**, which opens a box with the name (the same name as at the top of My Workout) and "3 exercises · 9 sets",
  then Save; "✓ Saved" once My Workout is exactly the saved workout it holds, and **Save changes** once it is not, whose box offers
  "Save changes to Leg day" and "Save as a new workout". What is saved is what Start workout does: each exercise the Library still
  offers, with its sets as set up (`toPlanned`); one no longer in the Library is left out, and the box says so. At 50 (the server's
  `most`) the box says "You have 50 saved workouts, the most you can keep. Delete one to save this one." with See saved workouts; past
  200 sets it says so. Under it, **Saved workouts**: the newest three (the first exercise's picture, the name, "3 exercises · 9 sets",
  the names), See all N (every one, in a box from the bottom, "4 saved workouts of 50"), the one My Workout holds marked In My Workout.
- **Load:** a press puts it in My Workout ("Push day is in My Workout."), asking first only where something would be lost (My Workout
  holds exercises that are not exactly the saved workout it holds), and asking to save it first, as any app does (Kd's click-through):
  "Save changes to Push day?" (or "Save Legs?") · "Your changes to Push day aren't saved. Pull day then takes its place in My Workout." ·
  Save and load Pull day · Don't save · Cancel. **Create workout**, beside Save workout, asks a name ("Create workout", Create) and
  gives an empty My Workout under it ("Pull is ready. Add exercises from the Library."), asking the same question first where My Workout
  holds what is not saved. The pen beside My Workout's name opens it for typing, as a tap on the name does. My Workout keeps which saved workout it holds (`from` in `my-workout-<id>.json`) until Clear,
  another load, or that one's delete; an exercise twice keeps its first place, and an exercise's first 10 sets (`fromSaved`). One
  this phone does not hold whole is read from the server; with no internet, "Couldn't load Push day. Check your internet connection
  and try again."; one gone, "Push day is no longer in your saved workouts."
- **Saved or not (round one, H1):** judged against what My Workout last loaded or saved (`base` beside `from`, `savedState`),
  never against the list alone. Where the account holds a newer change of it, made on another device, and nothing was changed
  here: "Push day was changed on another device." with Load the newer one, and loading another asks nothing; where both changed,
  the save boxes say "Push day was changed on another device. Saving replaces that change." A loaded saved workout holding an
  exercise since removed from the Library reads as saved; a save leaves that exercise out and says so. Create workout shows on an
  empty My Workout too. The `edited_ahead` answer carries `serverTime`, and the phone stamps the change again with it (still after
  the change it last heard of) and sends it at once.
- **Delete:** the bin asks first ("Delete Push day?" · "It's removed from your saved workouts." and, for the one My Workout holds, "My
  Workout keeps its exercises."), then "Push day was deleted."
- **Kept on the phone** (`apps/mobile/src/library/savedWorkouts.ts`, table-tested): the person's list as last heard
  (`saved-workouts-<id>.json`, with the whole of each one this phone saved or loaded at that change), so it opens with no internet,
  and each save and delete in the one shared waiting list (`saved-changes-<id>.json`, at most 200), sent from the moment the tabs open,
  in the order made, every 15 s and when the app comes back; both removed with the account. The list shown is the copy with every
  change still waiting laid over it; a list the server sent before a change's answer is asked for again, so a saved workout never
  vanishes. A change's time is the phone's clock and always after the change the phone last heard of. Answers: saved; `removed`
  (deleted on another phone) forgotten; `unchanged` with another time (a newer change elsewhere) reads the list again; no answer,
  401, 422, 429, 5xx and `edited_ahead` tried again; 409 says "You can keep 50 saved workouts. Delete one, then save this one again."
  on My Workout until OK; any other refusal "This workout couldn't be saved." A delete answered 404 is let go.
- **The server:** a change made more than five minutes past its clock is answered 400 `edited_ahead` (`SAVED_EDITED_AHEAD`), its own
  word, so a phone whose clock runs fast keeps it and sends it again once the server's clock has passed it, never losing it.
- **A workout started from a saved workout** (My Workout holds one still in the list) is sent as `startedFrom: "saved"`; the workout's
  file keeps the mark (`workoutRunSchema.startedFrom`, absent for one kept before).
- **The policy** says the phone keeps a copy of saved workouts and each save or delete until it reaches the server.

**As built in 64a-v (2026-11-22, Kd's drawing of that day).** History is Me → Progress → Calendar, the one place a person's
workouts are kept day by day (Part 6 §2: Progress holds history), with doors to it:
- **The calendar's days** are 61b's rule since 64a-v: `GET /v1/training/days?from=YYYY-MM-DD&to=YYYY-MM-DD` (`historyRangeQuerySchema`,
  both days included, at most 366, else 400; the person's own; within the history's 120 reads a minute) counts each workout on
  the day in the zone it was done in, as the month, the day and an exercise's records do; the phone asks for the year that ends on
  its today. The old `/v1/progress/heatmap` stays for the web. The year is read again each time the server takes a finished workout,
  and while finished workouts wait on the phone the calendar says "1 workout is saved on this phone. It shows here once it reaches
  your account."
- **A day** (`GET /v1/training/days/:day`): its workouts, each with its picture (its first exercise's), its name ("Workout" for one
  never named), "7:05 am · 42 min · 9 sets" (a workout under a minute is "1 min", never "0 min"), its exercises ("Bench Press,
  Barbell Curl and Plank", past three "… and 2 more"), and its calories. An exercise is named by ONE rule on the day and on the
  workout's page (`serverFirst`, round one L2): the server's Library name (the day's read carries `exerciseNames` since 64a-v),
  then the Library kept on the phone (`useNamed`), then its id word made readable. Today's box, which lies over the calendar,
  says the workouts still on the phone itself, never "No workout this day" (round one H1), and the day open is read again when
  the server takes one; pages read again from the newest workout sent (`useSentCount`), as the waiting list keeps only 50 ids.
- **One workout** (`apps/mobile/src/screens/workout/PastWorkout.tsx`, `GET /v1/training/workouts/:id`): the screen after a workout's
  own pieces (`WorkoutParts.tsx`, shared with the summary): the wall timer with the time trained, calories and sets, "About 238
  kcal for you, at 82 kg" (the weight the save used, `kcalWeightKg` on the read since 64a-v), how hard it was as the stars kept,
  the heart rate where one was kept, the new records with what each was (`recordValues` and Epley's formula now in
  `packages/shared`, one rule for both screens), then every set, exercise by exercise, a gold PR on the set that made a record.
  A workout of any age opens. Not found: "This workout is no longer in your history."; unread: "Your workout couldn't load." with
  Try again. An answer for a workout left, coming late, is never drawn on the next one's page.
- **Doors:** Today's Recent Activity names a workout as the person did (the old `/v1/workouts` list carries `name` since 64a-v) and
  opens it, as a run's row opens the run; a row that opens a page has an arrow. My Workout has **History** ("Your past workouts,
  day by day") under the saved workouts, opening Progress on the calendar.
- **Measured** (2026-11-22, `apps/api/tools/measure-training-history.ts`, local database, 846,685 sets in the table): for the person
  of five years, the calendar's year held the server answering nobody for at most 1.8 ms (a free plan's 90 days, 2 KB) and 1.2 ms
  (all 365 days, 8 KB).
- **Not in 64a-v:** stars given from History; a workout deleted or repeated from History (neither the web nor the phone has them).

**As built in 64a-vi (2026-11-23, Kd's drawing of that day).** Heart rate and sounds in a workout:
- **Heart rate** from the person's own saved monitor (37f-i), on the workout's screen in a row under the exercise's name, beside
  Sound (Kd's click-through: the top's buttons are one row over the picture, each on its own see-through backing) (`heart/HeartPill.tsx`, shared with
  the run's pill, larger): "142 bpm · Zone 3" in the zone's colour where a maximum heart rate is known, "No signal"
  where there is no reading in the last 5 s, never 0 or an old number; none at all with no monitor. Kept with the workout
  (`workoutRunSchema.heart`, `withHeart` in `library/workoutRun.ts`, table-tested): only while its clocks run, never while paused,
  after more than 10 minutes away, before the workout was last moved on, or once it is done; each reading on the workout's whole
  clock by when it came, one a second at most, none past 12 hours; the save sends only those within its length, so a heart rate
  never makes the server refuse a workout. The workout takes its readings from a queue of its own (`heartQueue` in
  `heart/monitor.ts`), so a run and a workout on at once each get every reading; a monitor being tried, another device and a
  reading with no heart behind it never reach it. The monitor is held connected while a workout is on. The server is unchanged
  (61a keeps the average and highest); the summary shows "Heart rate 138 average · 171 highest" worked out on the phone by the
  server's own rule (`heartSums`), the same line as History (`HeartLine`), and none with under a minute of it.
- **Sounds** (`library/workoutSounds.ts`, pure and table-tested; the browser's four tones, made as the app's own files by
  `apps/mobile/tools/make-workout-sounds.mjs`): a tick for a rep counted by +, two beeps when a set ends, a beep at each of the last
  3 seconds of a rest, a get-ready or a set measured in time, a rising "go" when the next set starts after a rest or a get-ready.
  None while paused, for Pause or Resume, on coming back to the app, or after a tick more than 1.5 s late. The one player
  (`sound/soundNative.ts`, expo-audio 57.0.5) mixes with the person's music, never pausing it, and asks for no microphone; a copy
  of the app built before it plays nothing. Sound on or off beside the heart rate, kept for the person
  (`workout-sounds-<id>.json`, removed with the account). Sounds play while the app is open; with the phone locked or the app
  left, a rest ends silently.
- **My Workout** has "Heart rate monitor" under History, opening the same box as Settings and the Running page, whose words now
  say runs or workouts.
- **Found on the walk and fixed:** while a workout ran, every page reading the workout layer (the Dashboard, My Workout, the
  calendar) was drawn again four times a second, as the layer's value held the ticking workout (since 64a-ii; `master` the
  same): on Kd's phone the app's JavaScript ran at 100 % and presses landed seconds late. Pages now get the workout's place,
  changed only when something happens (`placeKey`); a page showing its time draws `WorkoutClock` alone, as often as the
  workout's screen. Measured on the phone (development copy): 22 to 50 % on the workout screen, 0 to 11 % on the Dashboard.
  A sound's first play in a session comes 0.5 to 1.3 s after the screen in the development copy (each file loaded from the
  bundler at first use), later ones 0.1 to 0.2 s; loading them ahead lost the set's end once on the phone and was taken out.
- **Not in 64a-vi:** a heart rate chart or zones kept for a workout (a run's 37f-ii-a); a notification when a rest ends with the
  phone locked.

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
| An exercise's card and page: picture, clips, difficulty, equipment, calories a minute, reps or time, sets, about, how to do it, common mistakes, main and other muscles; a link that opens one exercise | 63 (clips: 62b) |
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
once (measured in 61a, §13.5) · history and records for five years (measured in 61b, §13.5) · what keeping clips costs each month
(Stage 4 item 4: about 52 MB for 200 exercises, measured in 62a's plan; R2's free allowance not yet read). Where they are
kept is the server's own disk (62a). Kd's hand time: about 30 minutes between his finished clips while he works (the middle of
the gaps under 90 minutes between the saved times of his 45 `final` clips, 62a), so about 75 hours for the 150 still to make.

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
