// EN message catalog (Part 2 Appendix A — "so nothing regresses"). The engine
// emits message KEYS only (§2.4 liveCue, §3.7 faults, §4 cameraHint); the client
// renders language. EN is the required base (Part 2 §10 exercise DoD); HI/AS keys
// may lag but the keys must exist. Verbatim from Appendix A where it gives copy;
// chair/jump valgus reuse squat's coaching (same movement fault); the engine's
// visibility liveCue key (cue.visibility.step_back, DECISIONS 2026-07-09) maps to
// Appendix A's fault.body.visibility string.
const EN = {
  // Live fault cues (the 3 defs' `msg` keys)
  "fault.squat.depth": "Squat lower — aim to get your hips level with your knees",
  "fault.squat.lean": "Keep your chest up — you're leaning too far forward",
  "fault.squat.valgus": "Push your knees out — don't let them cave inward",
  "fault.chair_squat.valgus": "Push your knees out — don't let them cave inward",
  "fault.jump_squat.valgus": "Push your knees out — don't let them cave inward",
  // Visibility hint (engine liveCue when landmarks drop)
  "cue.visibility.step_back": "Cannot see your legs clearly — step back so your full body is in frame",
  // Setup camera hints (§4 cameraHint; setup.<exercise>.camera family, Appendix A)
  "setup.squat.camera": "Place your phone sideways, about 3 m away, with your full body in frame",
  "setup.jump_squat.camera": "Place your phone sideways, about 3 m away, with your full body in frame",
  "setup.chair_squat.camera": "Place your phone sideways, about 3 m away, with your full body and the chair in frame",
};

/** Translate a message key to EN. Unknown keys return the key itself — visible
 *  but never a crash, and easy to spot in QA (a missing string, not a blank). */
export function translate(key) {
  if (key == null) return null;
  return EN[key] ?? key;
}

export { EN };
