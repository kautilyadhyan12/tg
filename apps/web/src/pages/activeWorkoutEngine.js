// P1.10b-2b — pure accumulation logic for ActiveWorkout's engine-era set
// summaries, factored out of the page so it is unit-testable without a DOM
// (same pattern as sessionController). The page holds one log per workout in a
// ref; every §2.4 SetSummary the hook emits lands here, and the workout-level
// form average is derived from the collected per-rep scores.

/** A fresh per-workout log. */
export function createSummaryLog() {
  return { summaries: [], repScores: [] };
}

/** Record one set's outcome. `summary` may be null — a log-only set (Part 6
 *  §3.6) produces no engine summary and contributes nothing here (its reps are
 *  manual, ungraded, and still count toward the old-backend session save).
 *  Mutates and returns the log. */
export function accumulateSummary(log, summary) {
  if (summary == null) return log;
  log.summaries.push(summary);
  for (const s of summary.repScores ?? []) {
    log.repScores.push(Math.max(0, Math.min(100, Math.round(s))));
  }
  return log;
}

/** Workout-level average form score (0–100, rounded) from every scored rep so
 *  far, or null when nothing was scored (all log-only / zero reps) — the UI
 *  shows "—" and the session save sends 0, exactly as the old screen did. */
export function averageFormScore(log) {
  const scores = log.repScores;
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}
