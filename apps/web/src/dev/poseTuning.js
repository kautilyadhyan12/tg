/**
 * poseTuning.js — DEV-ONLY MediaPipe settings, driven from the URL.
 *
 * WHY THIS EXISTS. Phase 2 has two halves. The first — a bridge-layer gate that
 * NOTICES a bad read — was measured on clips already recorded (DECISIONS :6662).
 * The second is making the model lock onto the PERSON instead of the chair, and
 * that cannot be evaluated on those clips at all: changing MediaPipe's settings
 * changes what MediaPipe OUTPUTS, so it needs fresh recordings (:6386). Without
 * this file every candidate setting costs Kd a separate ~25-minute session in
 * his own room. With it, one session covers several.
 *
 * WHAT IS BEING VARIED, and none of it was ever chosen by anyone. The three
 * confidences sit at MediaPipe's 0.5 defaults and `numPoses` at 1; :6386 named
 * them the first thing to try and recorded why they matter:
 *   - `minPoseDetectionConfidence` gates STAGE ONE, the detector — the closest
 *     thing there is to the "is this a person" score `PoseLandmarker` never
 *     exposes. Per-landmark `visibility` cannot answer it (a chair reports 0.99
 *     on its chest), so this dial is where that question actually lives.
 *   - `minTrackingConfidence` decides when tracking is abandoned and the
 *     detector re-runs. A stationary chair is trivially trackable, so a lock-on
 *     persists; raising this forces re-detection more often.
 *   - `numPoses: 1` means the model ALWAYS crowns a winner. Above 1 it returns
 *     several candidates — but each extra pose costs another landmark pass
 *     against Part 6 §3.4's budget, so it is a measurement, not a default.
 *   - the MODEL: Part 6 §3.3 makes `full` the default and `lite` the automatic
 *     step-down, and we ship `lite` everywhere. **Do not switch it blind** — Kd's
 *     clips landed at 7.2–12.5 fps against a 15 fps target, so he is already
 *     under budget on the LIGHT model (own OWED line).
 *
 * SAFETY. Gated on `import.meta.env.DEV`, which a production build sets to false
 * and Vite then dead-code-eliminates — so no production path can reach a dial,
 * whatever the URL says. Deliberately NOT gated on an env var: an env var can be
 * set in a production build by mistake, `DEV` cannot.
 *
 * Every value is validated against a fixed set or clamped to a range. The model
 * URL is looked up in a frozen map and never built by interpolating the query
 * string, so a typo cannot silently fetch nothing (or anything else).
 */

/** True only in a dev build. The one gate that matters. */
export const POSE_TUNING_ENABLED = import.meta.env.DEV;

/** MediaPipe's own defaults — today's shipped behaviour, byte for byte
 *  (usePoseDetection.js before this file existed). An absent or malformed URL
 *  parameter lands here, so the app is unchanged unless someone deliberately
 *  asks for something else. */
export const POSE_DEFAULTS = Object.freeze({
  model: 'lite',
  numPoses: 1,
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

/** The three variants Google publishes. A frozen map, so `?model=` can only
 *  ever select one of these — never interpolate the query string into a URL. */
const MODEL_FILES = Object.freeze({
  lite: 'pose_landmarker_lite',
  full: 'pose_landmarker_full',
  heavy: 'pose_landmarker_heavy',
});

export const MODEL_NAMES = Object.freeze(Object.keys(MODEL_FILES));

/** Where a model variant is fetched from. `local` is tried first and is
 *  ordinarily absent (`apps/web/public/models/` ships no `.task` file), so in
 *  practice every variant comes from Google's CDN and switching costs a URL,
 *  not a vendored binary. */
export function modelUrls(model) {
  const file = MODEL_FILES[model] ?? MODEL_FILES[POSE_DEFAULTS.model];
  return {
    local: `/models/${file}.task`,
    remote:
      'https://storage.googleapis.com/mediapipe-models/' +
      `pose_landmarker/${file}/float16/1/${file}.task`,
  };
}

/** ABSENT IS NOT ZERO, and this is the trap that has to be closed explicitly:
 *  `Number(null)` and `Number('')` are both **0**, which is a perfectly valid
 *  confidence. Without this guard every dial the URL did NOT mention read as
 *  0.0 — "trust anything" — so merely opening the app with the recorder on
 *  would have silently reconfigured the model to its most credulous setting,
 *  and the header would have recorded that as deliberate. Caught by the test
 *  written with this file, in the same shape as :5543: a condition identified
 *  by what it LACKS rather than what it IS. */
function present(raw) {
  return raw !== null && raw !== '';
}

function clamp01(raw, fallback) {
  if (!present(raw)) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
}

function clampPoses(raw, fallback) {
  if (!present(raw)) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 4) return fallback;
  return n;
}

/**
 * Read the settings for this page load.
 *
 * `search` is passed in rather than read from `window` so this is testable and
 * has no hidden global — the caller supplies `window.location.search`.
 *
 * In a production build this returns the frozen defaults without looking at the
 * query string at all.
 */
export function readPoseTuning(search = '') {
  if (!POSE_TUNING_ENABLED) return { ...POSE_DEFAULTS };
  const q = new URLSearchParams(search);
  const model = q.get('model');
  return {
    model: model !== null && Object.hasOwn(MODEL_FILES, model) ? model : POSE_DEFAULTS.model,
    numPoses: clampPoses(q.get('numPoses'), POSE_DEFAULTS.numPoses),
    minPoseDetectionConfidence: clamp01(
      q.get('detectConf'),
      POSE_DEFAULTS.minPoseDetectionConfidence,
    ),
    minPosePresenceConfidence: clamp01(
      q.get('presenceConf'),
      POSE_DEFAULTS.minPosePresenceConfidence,
    ),
    minTrackingConfidence: clamp01(q.get('trackConf'), POSE_DEFAULTS.minTrackingConfidence),
  };
}

/** True when this page load is running anything other than shipped behaviour.
 *  The widget shows it, so an operator cannot record a clip believing it was
 *  default when it was not. */
export function isTuned(tuning) {
  return Object.keys(POSE_DEFAULTS).some((k) => tuning[k] !== POSE_DEFAULTS[k]);
}

/** One-line rendering for the recorder widget and the trace header. */
export function describeTuning(tuning) {
  return (
    `${tuning.model} n=${tuning.numPoses} ` +
    `det=${tuning.minPoseDetectionConfidence} ` +
    `pres=${tuning.minPosePresenceConfidence} ` +
    `track=${tuning.minTrackingConfidence}`
  );
}
