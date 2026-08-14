// P2.3 — calorie estimation, ported from calories.py per 2B §2 ("keep the
// method — it's right"). kcal = MET × weight_kg × hours (2B §2.2 / Compendium;
// calories.py:14-19). MET now comes from exercises.met (Part 4 §3.4 — the 2B
// Appendix A table lands there row by row, replacing calories.py's
// EXERCISE_MET dict). Explicitly NOT ported, per the module's own
// docstring-now-policy (2B §2.4): form-score multipliers, age/sex RMR
// corrections, per-rep work physics.
//
// TWO FORMULA VERSIONS LIVE HERE, and both are reachable — which one runs is
// decided by the PAYLOAD, not the deploy date (see the service). v1 must stay
// byte-identical for payloads queued before the 2026-08-07 card: a client's
// outbox survives deploys, and re-pricing a workout it already priced would
// make a retry change a stored number (R3.5's spirit).

/** v1 = active-only MET method: every set's whole span at its exercise MET,
 *  rest uncounted (DECISIONS P2.3 GAP-2's deliberate undercount). Runs for
 *  payloads that predate the v2 fields. */
export const KCAL_CALC_VERSION_V1 = 1;

/** v2 = the three-tier method, Kd-ruled 2026-08-07 (the "ruled payload
 *  change" GAP-2 was waiting for): rep time at the exercise MET · idle time
 *  (standing mid-set, rest breaks) at REST_MET · paused/out-of-set time at
 *  NOTHING. Selected when the payload carries `restSeconds`. */
export const KCAL_CALC_VERSION_V2 = 2;

/** v3 = v2 with the GUESSING TAKEN OUT, Kd-ruled 2026-08-14. v2 reconstructs
 *  exercise time as `reps × tempoMsAvg` — a rate the engine could only estimate
 *  from whatever it managed to see, so a set the camera kept losing was billed
 *  ~20% low (:7487) and the stretch nobody watched was still billed as resting.
 *  v3 reads the engine's own `watchedMs`: nothing outside it is charged at all,
 *  and when no rep was watched end to end (`tempoMsAvg` null with reps counted)
 *  the watched time IS the exercise time rather than a guess at one.
 *  Selected when the payload carries `watchedMs` on any set. */
export const KCAL_CALC_VERSION_V3 = 3;

/** calories.py:85 verbatim — "Resting between sets: standing/light movement,
 *  not lying down — closer to the Compendium's light-intensity band (1.6-2.9
 *  MET) than true sedentary". Ported, never re-derived (R5.4 discipline). */
export const REST_MET = 1.8;

/** calories.py:96 — conservative cross-population fallback; every user who
 *  provides real weight gets a number specific to them (2B §2.3 nudge). */
export const DEFAULT_WEIGHT_KG = 70;

export interface KcalSetInput {
  met: number; // exercises.met for this set's exercise
  durationMs: number; // ACTIVE time (SetSummary.durationMs, 2B §2.2)
}

/** Point estimate for a workout, rounded to the integer kcal_point column.
 *  Session total = sum of per-exercise points (2B §2.3: band the TOTAL at
 *  display time, never sum bands). */
export function kcalPointForSets(sets: readonly KcalSetInput[], weightKg: number | null): number {
  const weight = weightKg !== null && weightKg > 0 ? weightKg : DEFAULT_WEIGHT_KG;
  const total = sets.reduce((acc, s) => acc + s.met * weight * (s.durationMs / 3_600_000), 0);
  return Math.round(total);
}

export interface KcalSetInputV2 extends KcalSetInput {
  reps: number;
  /** Mean rep duration from the engine (SetSummary.tempoMsAvg); null when no
   *  rep was counted. reps × tempoMsAvg reconstructs the set's WORKING time
   *  from fields the payload has always carried — nothing new is trusted. */
  tempoMsAvg: number | null;
  /** A log-only set has no rep timings (nothing measured it), so it keeps the
   *  v1 treatment: whole span at the exercise MET. Stated to Kd in the plan
   *  as the honest best-available for hand-counted workouts. */
  logOnly: boolean;
}

/** The v2 point estimate. Three tiers (Kd, 2026-08-07):
 *
 *  - REP TIME (engine sets: reps × tempoMsAvg, capped at the set span) at the
 *    exercise MET. A set with ZERO reps — camera running, nobody exercising,
 *    the defect Kd caught — therefore charges NOTHING at the exercise rate.
 *  - IDLE time at REST_MET: the non-rep remainder of each engine set's span,
 *    plus `restSeconds` (the client's rest-break counter).
 *  - PAUSED time at NOTHING — enforced by the `durationSeconds` cap below.
 *
 *  THE CAP IS THE PAUSE GUARD, not an ornament. The engine's set span is
 *  first-frame-to-last-frame, and a mid-set pause stops the FRAMES but not the
 *  CLOCK (verified: ActiveWorkout tears the feed down on pause, and frame `t`
 *  keeps advancing) — so the pause lands INSIDE the span and would be billed
 *  as idle. The on-screen timer is the one measurement that stops on pause, so
 *  chargeable idle is floored against it: idle can never exceed what the timer
 *  actually saw beyond rep time. Absent the timer (older client), span idle
 *  stands uncapped — those payloads carry no pause information at all. */
export function kcalPointForSetsV2(
  sets: readonly KcalSetInputV2[],
  weightKg: number | null,
  session: { restSeconds: number; durationSeconds: number | undefined },
): number {
  const weight = weightKg !== null && weightKg > 0 ? weightKg : DEFAULT_WEIGHT_KG;
  let kcal = 0;
  let chargedMetMs = 0; // time already billed at an exercise MET (rep time + log-only spans)
  let idleSpanMs = 0; // engine-set span minus rep time, before the pause cap
  for (const s of sets) {
    if (s.logOnly) {
      kcal += s.met * weight * (s.durationMs / 3_600_000);
      chargedMetMs += s.durationMs;
      continue;
    }
    const repMs =
      s.reps > 0 && s.tempoMsAvg !== null ? Math.min(s.durationMs, s.reps * s.tempoMsAvg) : 0;
    kcal += s.met * weight * (repMs / 3_600_000);
    idleSpanMs += s.durationMs - repMs;
    chargedMetMs += repMs;
  }
  const timerIdleMs =
    session.durationSeconds === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, session.durationSeconds * 1000 - chargedMetMs);
  const idleMs = Math.min(idleSpanMs, timerIdleMs) + session.restSeconds * 1000;
  kcal += REST_MET * weight * (idleMs / 3_600_000);
  return Math.round(kcal);
}

export interface KcalSetInputV3 extends KcalSetInputV2 {
  /** SetSummary.watchedMs — ms of this set the camera could actually watch.
   *  `null` means NOBODY TOLD US (a client older than the 2026-08-14 card, or a
   *  hand-counted set), which is not the same claim as 0 and must not be
   *  treated as one: null falls back to the set's whole span, i.e. exactly v2's
   *  behaviour for that set. Already clamped to `durationMs` at the write
   *  boundary; clamped again here so the function is honest about its own
   *  input rather than about its caller. */
  watchedMs: number | null;
}

/** The v3 point estimate. The three tiers of the 2026-08-07 ruling are
 *  unchanged — reps at the exercise MET, idle at REST_MET, paused at nothing —
 *  and v3 changes only WHERE the numbers come from:
 *
 *  - **Nothing outside the watched time is charged at all.** v2 billed the
 *    non-rep remainder of the whole SET SPAN at REST_MET, so two minutes of an
 *    empty room came out at ~4 kcal instead of 0. Idle is now the watched
 *    remainder only.
 *  - **A set with no rep watched end to end is billed at its watched time**,
 *    not at a rate guessed from half-seen reps. `tempoMsAvg` is null in exactly
 *    that case now (the engine stopped inventing the fallback in the same
 *    card), and `reps > 0` is what separates it from a set where nobody moved —
 *    a zero-rep set still charges NOTHING at the exercise rate, which is the
 *    defect Kd caught on 2026-08-10 and it stays fixed.
 *  - **THE TIMER IS A BUDGET, not just an idle floor.** A mid-set PAUSE stops
 *    the frames but not the timestamps inside them, and no frames arriving is
 *    indistinguishable to the engine from a slow camera — so a pause lands
 *    inside `watchedMs` and would otherwise be billed as squatting. The
 *    on-screen timer is the one measurement that stops, so exercise time is
 *    spent against it in payload order and cannot exceed it. Absent the timer
 *    (older client) the budget is infinite: those payloads carry no pause
 *    information at all, and inventing a bound for them would be worse.
 *    This CLAMPS the symptom; the cause is that the client never tells the
 *    engine it stopped feeding, and that has its own `OWED.md` line. */
export function kcalPointForSetsV3(
  sets: readonly KcalSetInputV3[],
  weightKg: number | null,
  session: { restSeconds: number; durationSeconds: number | undefined },
): number {
  const weight = weightKg !== null && weightKg > 0 ? weightKg : DEFAULT_WEIGHT_KG;
  const budgetMs =
    session.durationSeconds === undefined
      ? Number.POSITIVE_INFINITY
      : session.durationSeconds * 1000;
  let kcal = 0;
  let chargedMetMs = 0; // time already billed at an exercise MET (rep time + log-only spans)
  let idleSpanMs = 0; // watched-but-not-rep time
  for (const s of sets) {
    const remaining = Math.max(0, budgetMs - chargedMetMs);
    if (s.logOnly) {
      // No camera ran, so there is no watched time and the span is all we have
      // — v1's treatment, unchanged since the log-only card. Still spent
      // against the budget: a hand-counted set cannot last longer than the
      // workout it happened in either.
      const metMs = Math.min(s.durationMs, remaining);
      kcal += s.met * weight * (metMs / 3_600_000);
      chargedMetMs += metMs;
      continue;
    }
    const watched = Math.min(s.watchedMs ?? s.durationMs, s.durationMs);
    const repMsRaw =
      s.reps > 0 ? (s.tempoMsAvg !== null ? Math.min(watched, s.reps * s.tempoMsAvg) : watched) : 0;
    const repMs = Math.min(repMsRaw, remaining);
    kcal += s.met * weight * (repMs / 3_600_000);
    idleSpanMs += watched - repMs;
    chargedMetMs += repMs;
  }
  const timerIdleMs = budgetMs === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : Math.max(0, budgetMs - chargedMetMs);
  const idleMs = Math.min(idleSpanMs, timerIdleMs) + session.restSeconds * 1000;
  kcal += REST_MET * weight * (idleMs / 3_600_000);
  return Math.round(kcal);
}
