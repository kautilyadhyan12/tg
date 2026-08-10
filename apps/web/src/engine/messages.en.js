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
  // THE PERSON CHECK (card 4 step 3). NOT an Appendix A key and not an engine
  // key — Appendix A has no string for "what I am tracking does not move like a
  // body", because the check that asks did not exist when it was written. The
  // cue is raised in the web bridge, where the 2026-08-07 ruling puts the scene
  // decision and the screen; it lives in this catalog anyway so every sentence a
  // user reads is in one place and testable without a browser.
  //
  // IT DELIBERATELY NAMES NO CAUSE. The app cannot tell a chair from a bad angle
  // from a user half out of shot — it knows only that its own reading says "not
  // a body". A cue that named the reason would be naming a cause the app cannot
  // know, which is the defect recorded at :6150.
  //
  // THERE ARE TWO OF THEM, AND THE SECOND ONE IS A BUG FIX. The sentence stays
  // up for a run of clean frames after blocking stops, so that it can be read —
  // but counting resumes on the FIRST clean frame, so a single present-tense
  // "not counting" was on screen while the count moved and the rep beep played.
  // Measured on Kd's own recordings: a rep was counted underneath that sentence
  // on four of the six clips containing him. Two figures on one screen that
  // cannot both be true is :5807, and :5618's "31s over 1 min total" is the same
  // shape. The state that is still blocking says so in the present tense; the
  // state that has recovered says so in the past.
  "cue.scene.no_person":
    "Not counting — the camera isn't sure it's looking at you. Check that your whole body is in the picture.",
  "cue.scene.no_person_recent": "Counting again — the camera lost sight of you for a moment.",
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
