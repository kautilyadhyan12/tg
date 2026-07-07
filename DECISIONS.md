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

## Pending (SPEC GAPs raised, awaiting Kd)

- Part 5 §1.2 vs Part 4 §3.3: plan-row codes for org USD book and org annual (×10) book — `plans` holds one currency+interval per row; codes like `org_micro_us_m` / `org_micro_in_y` need ratifying before P3.1.
- Part 4 §3.3: org plans' subscriber `entitlements` ("console features") shape unspecified — seeded `{}`.
- Part 4 §3.3: `name_key` convention unspecified — using `plan.<code>` until ratified.
