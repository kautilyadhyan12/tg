// P2.3 — calorie estimation, ported from calories.py per 2B §2 ("keep the
// method — it's right"). kcal = MET × weight_kg × hours (2B §2.2 / Compendium;
// calories.py:14-19). MET now comes from exercises.met (Part 4 §3.4 — the 2B
// Appendix A table lands there row by row, replacing calories.py's
// EXERCISE_MET dict). ACTIVE time only in v1 — the §2.4 payload carries no
// rest seconds (DECISIONS P2.3 GAP-2; REST_MET=1.8 from calories.py:85 waits
// for a ruled payload change). Explicitly NOT ported, per the module's own
// docstring-now-policy (2B §2.4): form-score multipliers, age/sex RMR
// corrections, per-rep work physics.

/** Versioned under kcal_calc_version (Part 4 §3.5); bump on ANY formula
 *  change so stored numbers stay explicable. v1 = active-only MET method. */
export const KCAL_CALC_VERSION = 1;

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
