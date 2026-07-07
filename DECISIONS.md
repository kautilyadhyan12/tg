# DECISIONS.md — judgment calls beyond the spec (Part I §5)

Format: date · spec § affected · decision · reason.

- 2026-07-06 · (tooling, spec silent) · Test runner = vitest ^2 · de-facto standard for pnpm/TS monorepos; approved at P0.1 gate.
- 2026-07-06 · (tooling, spec silent) · Node >= 22 pinned via engines; pnpm 9.15.4 via packageManager field · current LTS.
- 2026-07-06 · Part I §6 · Branch protection on master NOT enforced — GitHub Free + private repo returns 403 · green-before-merge is procedural until GitHub Pro or the repo goes public.
- 2026-07-06 · Part 4 §1 · Migration file named 0001_init (drizzle-kit generated 0000; file + journal tag renamed) · spec's naming convention wins.
- 2026-07-06 · Part 4 §1/§3 · Bare `REFERENCES` kept as generated (`ON DELETE NO ACTION`) rather than rewriting to `RESTRICT` · matches the §3 DDL literally; NO ACTION and RESTRICT differ only under deferred constraints, which we don't use.
- 2026-07-06 · Part 4 §8 · Seeded now: plans + feature_flags. Deferred: exercises (needs Part 2 §6 + 2B App A METs), definitions (needs P1.8 ported constants), achievements (needs badges.py port), demo-org fixture (needed by Part 3 console work) · each lands with its owning task.
- 2026-07-07 · v1 §19 · Deployment target stays Hetzner per spec; the VPS is provisioned (and spend starts, ~₹400–1,200/mo) only at P0.4b · owner accepts the cost as the stack's one pre-revenue line item; all other services ride free tiers until real usage.
- 2026-07-07 · (tooling) · tsx added as api devDep for `pnpm --filter api dev` · TS runner; dev-only.

- 2026-07-07 · Part 2 §2.4 vs v1 §5.3 · Sync payload `sets[]` = the full §2.4 SetSummary (incl. holdMs/calibration/engineVersion/definitionVersion), superseding v1 §5.3's abbreviated example · §2.4 declares SetSummary the only thing leaving the device; Part 2 §10 gate requires byte-match; Part 4 §3.5 persists those fields per set. Approved at P1.1 gate.

- 2026-07-07 · Part 2 §3.1 · Out-of-order-t drops do NOT count toward the 3-invalid visibility streak · the person may be fully visible; only invalid keypoints signal occlusion. (P1.4, T3-review ratified.)
- 2026-07-07 · Part 2 §3.2 · Smoothing latency ceiling encoded as a hard 470 ms constant from the spec's "~470 ms" prose; low fps uses fewer samples · the "~" needed one number; 7 frames @15 fps = 466.7 ms rounded. (P1.4.)
- 2026-07-07 · Part 2 §3.2 · SpikeFilter passes the first 2 frames of a set unfiltered (warm-up unspecified in spec) · harmless: elevation baselines require ≥8 calibration frames before any consumer reads the raw channel. (P1.4, T3 finding.)
- 2026-07-07 · Part 2 §3.3 vs legacy source · classifyView requires the LEFT ankle + LEFT shoulder (angles.py detect_view verbatim), not §3.3's looser "one ankle"; degenerate-height epsilon restored to the source's `< 1e-4` · §3.3 says "direct port … it stays"; the source wins. (T3 findings, fixed.)
- 2026-07-07 · Part 2 §3.2/§3.3 interaction · TS view classification reads the hysteresis VisibilityGate (0.30/0.15) while legacy is_visible is memoryless ≥0.3 · §3.2 mandates the gate engine-wide; 100% parity holds on current traces; a future trace with 0.15–0.30 oscillation will diverge BY DESIGN and the red should be judged then, not pre-weakened.
- 2026-07-07 · Part 2 §7.1/§7.5 · Four parity trace headers' `view` corrected post-recording to the Python-dominant view (filenames lied — angled cameras); feeder now derives view from responses · §7.5: Python outputs are the parity truth; header edit = correcting authoring metadata, expected blocks untouched.
- 2026-07-07 · Part 2 §7.4 · Parity traces carry `expected.faultsPending: true` until P1.8 authors the legacy→EDS fault mapping; the fault assertion skips (never treats {} as "clean") · T3 finding. Degenerate trace renamed jumpsquat_fast_reps_uncounted_by_legacy_side (Python truth: 0 reps — locks the legacy fast-jump undercount deliberately).
- 2026-07-07 · (harness) · Trace-replay ingest assertion = exactly 0 dropped frames (feeder-written traces are valid by construction) · replaces an uncited 95% threshold; T3 finding.
- 2026-07-07 · R3.10 note · Legacy pose WS carries the JWT in the query string; acceptable in the dev rig only — the new API must never put tokens in URLs. (T3 security note.)

- 2026-07-07 · Part 2 §3.4 · Legacy output rounding is part of the ported formulas: angles/inclines round to 0.1° (angles.py:62,168), valgus/elevation to 1e-4 (angles.py:275–306) · downstream FSM/fault parity needs bit-identical inputs; JS half-up vs Python half-even divergence is measure-zero on acos outputs (P1.8a audits). (P1.5.)
- 2026-07-07 · Part 2 §3.4 · trunk_incline/shin_incline/body_line/elbow_under_shoulder prefer the LEFT landmark pair, fall back right · §3.4 states left-preference for trunk_incline; extended to its sibling side-view signals for consistency; P1.8a audits against Python per signal. (P1.5.)
- 2026-07-07 · Part 2 §3.5 · C3 floor_reference stillness threshold is definition-declared (⚙) with NO engine default · the spec names no number; inventing one would violate R0.2. (P1.5.)
- 2026-07-07 · Part 2 §7.5 · Parity comparisons skip byte-identical repeated responses in the sidecars (legacy flood-guard echoes stale results when frames arrive <33 ms apart in wall-clock; 2 such frames exist in chairsquat_sideview_badform) · an echoed response is not an analysis of that frame. (P1.5.)

- 2026-07-07 · Part 2 §3.4 row 19 · elbow_under_shoulder divides by CURRENT-FRAME |shoulder_y − hip_y| with no calibration dependency · the §3.4 table lists no calibration for row 19, and planks never arm C1 (knees bent); inference recorded rather than silent. (P1.5 T3.)
- 2026-07-07 · Part 2 §3.4 #21 · stillness = mean of the TWO midpoint displacements (shoulder midpoint + hip midpoint), spec-literal · a torso rotation moves both midpoints while their centroid can stay still; no legacy source to arbitrate. (P1.5 T3.)
- 2026-07-07 · R5.5 note · SignalEngine/StillnessTracker allocate small per-frame objects; acceptable until the P1.9 bench gate measures — ring-buffer refactor queued for P1.9 if p95 needs it. (P1.5 T3.)
- 2026-07-07 · §7.5 harness note · sidecar offset assumes extra lines are a greeting PREFIX; keypoint-echo guard catches shear only on echoing frames. Feeder writes 1 response per frame by construction; if a future recorder drops trailing responses the count mismatch itself flags it. (P1.5 T3.)

## Pending (SPEC GAPs raised, awaiting Kd)

- **SPEC GAP (P1.5, needs ratification at PR #9 merge):** §3.5 says `torso_height = |shoulder_y − hip_y|` but §3.4 row 16 says elevation is normalized "exactly as captured by _StandingCalibration", and the Python capture is `|avg_ankle_y − avg_shoulder_y|` (pose_ws.py:204-207) — the two spec sentences conflict. IMPLEMENTED: the Python capture (shoulder→ankle), because §7.5 parity compares against Python-derived elevations and would otherwise fail by a ~2–2.5× ratio. Merging PR #9 ratifies this; reopen if you read it differently.
- **SPEC GAP (P1.5, decision needed by P1.8b):** C2 formula — spec §3.5 mandates mean-of-2-extremes clamped [80,120] (implemented, R0), but legacy chair calibration uses median + 5° buffer, no clamp. §7.5's chair-squat score-±3 parity will compare scores built on DIFFERENT targets. Options: (a) parity gate uses legacy median+5° via a definition override, spec formula ships after parity passes; (b) accept chair score divergence and assert reps only. Recommend (a).

- Part 5 §1.2 vs Part 4 §3.3: plan-row codes for org USD book and org annual (×10) book — `plans` holds one currency+interval per row; codes like `org_micro_us_m` / `org_micro_in_y` need ratifying before P3.1.
- Part 4 §3.3: org plans' subscriber `entitlements` ("console features") shape unspecified — seeded `{}`.
- Part 4 §3.3: `name_key` convention unspecified — using `plan.<code>` until ratified.
