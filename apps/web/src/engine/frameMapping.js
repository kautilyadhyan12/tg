// Map the engine's per-frame FrameResult (§2.4) onto the display shape the
// existing ActiveWorkout screen already consumes, so the UI "mostly doesn't
// notice" the WS→engine swap (v1 §13). Pure + testable — no React, no clock.
import { translate } from "./messages.en.js";

// Engine Mode-A phases (§3.6): top | descent | bottom | ascent. The overlay/UI
// only needs the coarse "in the working half vs. returning" split the old
// server state carried.
export function phaseToState(phase) {
  return phase === "descent" || phase === "bottom" ? "down" : "up";
}

/** FrameResult → the `poseData`-shaped object ActiveWorkout reads. `form_correct`
 *  is simply "no active fault cue this frame"; `corrections` carries the single
 *  translated live cue (§2.4 liveCue is one nullable key). Per-rep score is NOT
 *  here — it arrives on RepEvent (§2.4) and the hook threads it separately. */
export function frameToDisplay(fr) {
  return {
    rep_count: fr.repCount,
    state: phaseToState(fr.phase),
    phase: fr.phase,
    is_active: fr.isActive,
    person_detected: fr.visibilityOk,
    view: fr.view,
    form_correct: fr.liveCue == null,
    corrections: fr.liveCue != null ? [translate(fr.liveCue)] : [],
  };
}
