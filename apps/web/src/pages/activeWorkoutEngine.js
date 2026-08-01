// P1.10b-2b — pure accumulation logic for ActiveWorkout's engine-era set
// summaries, factored out of the page so it is unit-testable without a DOM
// (same pattern as sessionController). The page holds one log per workout in a
// ref; every §2.4 SetSummary the hook emits lands here, and the workout-level
// form average is derived from the collected per-rep scores.
//
// WEB WRITE PATH (2026-08-02): hand-logged sets are built HERE too, for the
// same reason the engine ones are accumulated here — the page is untestable
// without a DOM and this file is not. `buildLogOnlySet` is the whole of the
// name→slug + emptiness policy, so a reviewer reads one function rather than
// four call sites inside a 1,300-line component.
import { slugForLegacyName } from "@app/shared";

/** A fresh per-workout log. `unresolved` holds the display names of exercises
 *  that have no catalog row — non-empty means this workout must NOT be synced
 *  (see `buildLogOnlySet`). */
export function createSummaryLog() {
  return { summaries: [], repScores: [], unresolved: [] };
}

/** Record one set's outcome. `summary` may be null — a set the engine did not
 *  analyse produces no summary here; `recordLogOnlySet` is what gives it a
 *  home on the wire. Mutates and returns the log.
 *
 *  An engine summary REPLACES any log-only entry already held for the same
 *  set ordinal. That cannot happen through the page's own logic (a set is
 *  either analysed or hand-counted, never both) but the two paths are driven
 *  by different clocks — the capture is synchronous at set end, the engine's
 *  summary arrives later, on the session teardown — so "cannot happen" is a
 *  claim about timing, and this repo's record on those is poor. Two entries
 *  sharing a setIndex would fail the contract's duplicate check and PARK the
 *  whole workout, so the collision is resolved here, in favour of the entry
 *  that carries real measurement. */
export function accumulateSummary(log, summary) {
  if (summary == null) return log;
  const clash = log.summaries.findIndex((s) => s.setIndex === summary.setIndex);
  if (clash !== -1) {
    // Rebuild rather than push: the displaced entry's rep scores are already in
    // log.repScores, and splicing the summary alone would leave them behind to
    // skew the workout's form average. That is unreachable today (the only
    // entries that can be displaced are hand-counted ones, which carry no
    // scores) — but "unreachable" here rests on the same timing claim this
    // clash branch exists BECAUSE it distrusts. T3 round 1, F4.
    log.summaries.splice(clash, 1);
    log.summaries.push(summary);
    log.repScores = log.summaries.flatMap((s) => (s.repScores ?? []).map(clampScore));
    return log;
  }
  log.summaries.push(summary);
  for (const s of summary.repScores ?? []) log.repScores.push(clampScore(s));
  return log;
}

const clampScore = (s) => Math.max(0, Math.min(100, Math.round(s)));

// Wire bounds, quoted from the shared contract rather than repeated as
// literals: reps lands in a smallint column and durationMs in an int4 (Part 4
// §3.5), and a value the schema rejects would park the workout.
const REPS_MAX = 32_767;
const DURATION_MS_MAX = 2_147_483_647;

/** Build the §2.4 SetSummary for ONE hand-counted set, or say why there isn't
 *  one. Pure: the caller supplies the reps, the ordinal and the elapsed time.
 *
 *  Three outcomes, deliberately distinguished because they must be handled
 *  differently by the caller:
 *
 *    { kind: 'set', set }        — send it.
 *    { kind: 'empty' }           — nobody did anything; DROP THIS SET, and the
 *                                  rest of the workout still syncs.
 *    { kind: 'unresolved-exercise', exerciseName }
 *                                — the exercise has no catalog row, so the
 *                                  server would DISCARD the set and leave a
 *                                  0-rep workout in history. The caller must
 *                                  refuse to sync the WHOLE workout; the legacy
 *                                  save still holds it, so nothing is lost.
 *
 *  The name is resolved through the reviewed 58-row table and NOWHERE else.
 *  Lowercasing the display name resolves nothing (the slugs are singular, the
 *  library's names plural) and inventing a slug on a null is what produces the
 *  discarded-set outcome above. */
export function buildLogOnlySet({ exerciseName, setIndex, reps, durationMs }) {
  // Reps first: an unresolvable name on a set nobody performed is still just an
  // empty set, and must not veto a workout the user did do.
  const countedReps = Math.max(0, Math.min(REPS_MAX, Math.round(Number(reps) || 0)));
  if (countedReps === 0) return { kind: "empty" };

  const slug = typeof exerciseName === "string" ? slugForLegacyName(exerciseName) : null;
  if (slug == null) return { kind: "unresolved-exercise", exerciseName };

  const ms = Math.max(0, Math.min(DURATION_MS_MAX, Math.round(Number(durationMs) || 0)));

  return {
    kind: "set",
    set: {
      exercise: slug,
      setIndex,
      reps: countedReps,
      durationMs: ms,
      tempoMsAvg: null,
      romStats: null,
      // Nothing watched this set, so no camera view was established. 'unknown'
      // is the contract's own word for that; 'front'/'side' would be a guess.
      view: "unknown",
      holdMs: null,
      calibration: null,
      mode: "log_only",
      // Every scoring field pinned empty: this is the one claim the feature
      // must never be able to make. The server enforces the same rule again.
      avgFormScore: null,
      repScores: null,
      faultCounts: {},
      engineVersion: null,
      definitionVersion: null,
    },
  };
}

/** Build a hand-counted set and file it on the log. Returns the same tagged
 *  result as `buildLogOnlySet` so the caller can react, and is IDEMPOTENT per
 *  set ordinal: a second call for a set already recorded is a no-op.
 *
 *  Idempotency is not defensive padding — the four points at which a set can
 *  end overlap by design (finishing the last set both completes the set AND
 *  ends the workout), so the alternative is four subtly different call sites
 *  each deciding whether it is the one that counts. */
export function recordLogOnlySet(log, { exerciseName, setIndex, reps, durationMs }) {
  if (log.summaries.some((s) => s.setIndex === setIndex)) return { kind: "duplicate" };
  const result = buildLogOnlySet({ exerciseName, setIndex, reps, durationMs });
  if (result.kind === "set") log.summaries.push(result.set);
  if (result.kind === "unresolved-exercise" && !log.unresolved.includes(result.exerciseName)) {
    // The duplicate guard above reads `summaries`, which an unresolved set
    // never reaches — so without this check a set captured twice recorded its
    // name twice, and the console line read "Arnold Shoulder Press, Arnold
    // Shoulder Press". The refusal was correct either way; the message was not.
    // T3 round 1, F3.
    log.unresolved.push(result.exerciseName);
  }
  return result;
}

/** Workout-level average form score (0–100, rounded) from every scored rep so
 *  far, or null when nothing was scored (all log-only / zero reps) — the UI
 *  shows "—" and the session save sends 0, exactly as the old screen did. */
export function averageFormScore(log) {
  const scores = log.repScores;
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}
