// The per-set engine lifecycle, factored OUT of React so it is unit-testable
// without a DOM (the hook is thin glue over this + MediaPipe). Owns one
// @app/engine session per set; maps frames to the display shape; captures the
// §2.4 SetSummary at set end. No clock, no network — the caller passes each
// frame's timestamp (R5.1 keeps time out of the engine).
import {
  EngineUnsupportedError,
  getDefinition,
  landmarksToFrame,
  startSet as adapterStartSet,
} from "./poseAdapter.js";
import { frameToDisplay } from "./frameMapping.js";
import { translate } from "./messages.en.js";
import { SceneGate } from "./sceneGate.js";

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
    this._scene = null;
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
    this._scene = null;
    if (def == null) return; // no definition yet → log-only (Part 6 §3.6)
    try {
      this._session = adapterStartSet(def, setIndex);
      this._metricSignals = this._session.metricSignals;
      this._analysisAvailable = true;
      // ONE PERSON CHECK PER SET, and only where there is something to protect:
      // in log-only mode the user is counting, so there are no reps to invent
      // and nothing to take away from them.
      this._scene = new SceneGate();
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

    // ── THE PERSON CHECK, BEFORE THE ENGINE SEES ANYTHING ────────────────────
    // It reads the REAL frame — always, including the ones it goes on to block.
    // That is what the simulation Kd ruled the cut-off on did, and a gate fed
    // its own blanked output would build a different rolling median from the
    // one the printed table described.
    const scene = this._scene.push(landmarksToFrame(landmarks, tMs));
    // A blocked frame reaches the engine with NO landmarks, which is exactly
    // what `measure-pose.ts` replayed and what the engine's ingest already
    // treats as "invalid — hold state, count nothing" (§3.1 fail-soft). The
    // engine is not told why, and does not need to be: it is handed 33 numbers
    // and cannot know where they came from (the 2026-08-07 ruling).
    const fr = this._session.feed(scene.blocked ? [] : landmarks, tMs);
    const display = { ...frameToDisplay(fr), form_score: this._lastRepScore };

    if (scene.blocked) {
      // NO VERDICT ON A FRAME WE OURSELVES BLANKED. Without this the screen
      // keeps grading through short blocks — the engine reports no live cue for
      // the first two invalid frames, so `form_correct` comes back TRUE and "✓
      // Good Form" sits over a frame the app deliberately refused to look at;
      // once its own visibility cue arrives it comes back FALSE, which is worse
      // (:5807: on screen AND wrong, in both directions).
      display.form_correct = null;
      // AND THE OCCLUSION STREAK BELOW IS NOT ADVANCED. A blanked frame is
      // evidence about the SCENE, not about whether the user's legs are visible.
      // Letting our own blanking feed that counter would raise the engine's
      // "cannot see your legs clearly" at a user standing in full view — a cue
      // naming a cause the app cannot know (:6150 C/H-2).
    } else {
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
    }

    // THE ONE PLACE THE SENTENCE GOES ON SCREEN. It deliberately sits outside
    // the branch above, because the message outlives the blocked frames that
    // caused it — it clears after a run of clean ones, so that it can be read.
    // Written once: a rule with two declarations is where a correction gets lost
    // (:4556 F1), and the first draft of this method had exactly two.
    if (scene.showMessage) {
      display.form_correct = null;
      display.corrections = [translate("cue.scene.no_person")];
    }
    return display;
  }

  /** Forget the scene check's history without ending the set — an un-pause.
   *  Frames stop arriving while a set is paused or resting, so the frame before
   *  the pause is not the frame before now, and a message raised before it would
   *  be explaining something the user can no longer see. No-op in log-only mode,
   *  where there is no check to reset. */
  resetScene() {
    if (this._scene != null) this._scene.reset();
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
