// The per-set engine lifecycle, factored OUT of React so it is unit-testable
// without a DOM (the hook is thin glue over this + MediaPipe). Owns one
// @app/engine session per set; maps frames to the display shape; captures the
// §2.4 SetSummary at set end. No clock, no network — the caller passes each
// frame's timestamp (R5.1 keeps time out of the engine).
import {
  EngineUnsupportedError,
  getDefinition,
  startSet as adapterStartSet,
} from "./poseAdapter.js";
import { frameToDisplay } from "./frameMapping.js";
import { translate } from "./messages.en.js";

// §3.1's rule, applied at the signal level: after this many consecutive frames
// where the exercise's rep-metric joints are unusable (occluded legs — the
// frames themselves are valid, so the engine's ingest-level visibilityOk stays
// true), the UI shows the legacy "cannot see your legs clearly — step back"
// cue instead of a false "Good Form". Mirrors the legacy form_analyzer leg-
// visibility warning that the port had narrowed to ingest-invalid frames only
// (found via the sitting_idle live recording — its regression golden pins the
// no-counting half; this constant drives the honest-UI half).
const METRIC_UNUSABLE_STREAK = 3;

// Log-only display (Part 6 §3.6): no analysis for this exercise — the screen
// falls back to manual rep counting, honestly, and the workout still counts.
function logOnlyDisplay(keypointsPresent) {
  return {
    rep_count: null, // manual: the UI owns the count
    state: "up",
    phase: "top",
    is_active: false,
    person_detected: keypointsPresent,
    view: null,
    form_correct: null, // no grading in log-only
    corrections: [],
    form_score: null,
    logOnly: true,
  };
}

export class SessionController {
  constructor() {
    this._session = null;
    this._analysisAvailable = false;
    this._lastRepScore = null;
    this._repScores = [];
    this._framesFed = 0;
    this._metricSignals = [];
    this._metricUnusableStreak = 0;
  }

  get analysisAvailable() {
    return this._analysisAvailable;
  }

  /** Begin a set. If the exercise has a published definition, run the engine;
   *  otherwise enter log-only mode (Part 6 §3.6) — never fabricate analysis. */
  startSet(exerciseKey, setIndex) {
    const def = getDefinition(exerciseKey);
    this._lastRepScore = null;
    this._repScores = [];
    this._framesFed = 0;
    this._metricSignals = [];
    this._metricUnusableStreak = 0;
    this._session = null;
    this._analysisAvailable = false;
    if (def == null) return; // no definition yet → log-only (Part 6 §3.6)
    try {
      this._session = adapterStartSet(def, setIndex);
      this._metricSignals = this._session.metricSignals;
      this._analysisAvailable = true;
      this._session.onRep((e) => {
        this._lastRepScore = e.score;
        this._repScores.push(e.score);
      });
    } catch (err) {
      // I4: engine too old for this def → degrade to log-only, honestly. A real
      // compile/authoring error is a bug, not a degradation — let it surface.
      if (err instanceof EngineUnsupportedError) {
        this._session = null;
        this._analysisAvailable = false;
        return;
      }
      throw err;
    }
  }

  /** Feed one provider result + its timestamp; returns the display object the
   *  UI renders. In log-only mode there is no engine call. */
  feed(landmarks, tMs, keypointsPresent) {
    if (this._session == null) return logOnlyDisplay(keypointsPresent);
    this._framesFed += 1;
    const fr = this._session.feed(landmarks, tMs);
    const display = { ...frameToDisplay(fr), form_score: this._lastRepScore };

    // Honest degradation when the measured joints are occluded: the engine
    // already refuses to count (metric null → FSM holds), but with no fault
    // firing the UI would read "Good Form" while seeing only a face. Surface
    // the legacy legs warning and withdraw the form verdict instead.
    const metricUsable = this._metricSignals.some(
      (name) => typeof fr.signals[name] === "number",
    );
    this._metricUnusableStreak = metricUsable ? 0 : this._metricUnusableStreak + 1;
    if (fr.visibilityOk && this._metricUnusableStreak >= METRIC_UNUSABLE_STREAK) {
      display.form_correct = null; // no verdict — nothing is being measured
      display.corrections = [translate("cue.visibility.step_back")];
    }
    return display;
  }

  /** Per-rep scores observed so far this set (engine RepEvent.score, §2.4). */
  get repScores() {
    return this._repScores;
  }

  /** End the set → the §2.4 SetSummary, or null in log-only mode OR when the set
   *  never ran (zero frames fed). The zero-frames guard suppresses phantom
   *  summaries from a set that was set up but never started and from React
   *  StrictMode's dev mount→cleanup→mount double-invoke — so the P1.10c sync
   *  queue built on onSetComplete never sees junk reps:0 summaries. Idempotent
   *  (the engine's end() is, §3.9). */
  endSet() {
    if (this._session == null || this._framesFed === 0) return null;
    return this._session.end();
  }
}
