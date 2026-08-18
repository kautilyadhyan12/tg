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

/** Today's shipped behaviour, byte for byte. An absent or malformed URL
 *  parameter lands here, so the app is unchanged unless someone deliberately
 *  asks for something else.
 *
 *  ── `model` CHANGED FROM `lite` TO `full` ON 2026-08-17, BY KD'S RULING ────
 *  Part 6 §3.3 has said so all along — *"BlazePose **full** as default,
 *  **lite** as the automatic step-down"* (`06-part6-mobile.md:164`) — and the
 *  app shipped the opposite for months. **Nobody had ever chosen `lite`:** it
 *  was inherited from the previous version of this app and never revisited,
 *  which is why this line used to describe itself as "MediaPipe's own
 *  defaults". A default nobody picked is not a decision, and it was the wrong
 *  way round.
 *
 *  **The reason it matters is accuracy, not tidiness. A weaker model is a more
 *  credulous one** — it was `lite` that reported a chair's chest and hips at
 *  0.99 confidence (:6386) and `lite` that counted 6, 2, 0 and 2 reps off four
 *  clips of an empty room (:6856). Whether `full` fixes that is now a
 *  measurement rather than an argument.
 *
 *  **The objection this used to carry, and why it fell.** The old comment said
 *  *"do not switch it blind — Kd's clips landed at 7.2–12.5 fps against a 15 fps
 *  target, so he is already under budget on the LIGHT model."* That premise was
 *  measured false on 2026-08-17: `FEED_INTERVAL_MS = 67` caps the engine feed at
 *  **14.93/s on any hardware and 12.0/s on a 60 Hz display**, so 7.2–12.5 was
 *  never evidence about his machine's capacity — he was sitting on the app's own
 *  ceiling. There is headroom between what inference costs and what the throttle
 *  allows, and `MAX_FEED_HZ` plus the camera-rate row in the workout screen's
 *  `debug` panel are what measure whether `full` eats it.
 *
 *  **WHAT THIS DOES NOT DO, deliberately (R5.4, R5.7).** Changing the model
 *  changes the landmarks, and the person check's Kd-ruled `bone_stretch > 0.923`
 *  was derived from thirteen clips recorded under `lite` (`sceneGate.js`,
 *  DECISIONS :7037). **That number is NOT touched here and must not be retuned
 *  to fit the new model** — whether it still holds is a question for a fresh
 *  recording, and it has its own OWED line. The bundled MediaPipe WASM stays at
 *  0.10.21 for the same reason: two frame-changing edits at once make the result
 *  unattributable. */
export const POSE_DEFAULTS = Object.freeze({
  model: 'full',
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

/** Where a model variant is fetched from. `local` is tried first.
 *
 *  ── THIS COMMENT USED TO SAY THE OPPOSITE, AND IT WAS RIGHT AT THE TIME ────
 *  It read: *"`local` … is ordinarily absent (`apps/web/public/models/` ships no
 *  `.task` file), so in practice every variant comes from Google's CDN."* That
 *  was TRUE and it was the defect — an accurate description of a camera that
 *  needed the internet, sitting in the codebase being read as a design note.
 *  `apps/web/tools/fetch-pose-assets.mjs` now puts the shipped variant on disk
 *  before `dev` and `build`, sha256-verified, and `usePoseDetection` reports
 *  which source it used on every run so the two can never quietly diverge again.
 *
 *  NO LONGER TRUE EITHER, as of 2026-08-17: **`full` AND `lite` are both
 *  bundled**, so switching between them in dev (`?model=lite`) stays offline and
 *  the two are comparable on equal terms. `heavy` is the one variant still
 *  reachable only from Google's CDN — it is in the map so a URL cannot smuggle
 *  in an arbitrary path, not because anything ships it. */
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
  return raw !== null && raw !== undefined && raw !== '';
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

/** Every query parameter this module answers to. Used to decide whether a page
 *  load is ASKING for settings at all, which is a different question from what
 *  those settings resolve to. */
const TUNING_PARAMS = ['model', 'numPoses', 'detectConf', 'presenceConf', 'trackConf'];

/**
 * Resolve a query string to settings. Pure — no globals, no storage.
 *
 * In a production build this returns the frozen defaults without looking at the
 * query string at all.
 */
export function parsePoseTuning(search = '') {
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

// ── Surviving the router, which is what the first real session tripped over ──
//
// THE DEFECT, measured 2026-08-09 on eight clips Kd recorded: **all eight say
// `detect=0.5 track=0.5 lite numPoses=1` in their headers.** Four rounds at four
// different addresses produced four IDENTICAL runs, and only the `provider`
// stamp built in the same card revealed it — without that the comparison would
// have "shown" that no setting makes any difference.
//
// The cause is one line of routing: `App.jsx` sends `/` to
// `<Navigate to="/login" replace />`, and a react-router `to` of a bare path
// carries NO search string. So the query is gone before login, long before the
// workout screen mounts and the camera reads anything.
//
// So the URL is read ONCE, at first import, and kept in `sessionStorage`:
// per-tab, survives every in-app navigation and reload, and dies with the tab —
// which is also how it gets reset. Any page load that names at least one tuning
// parameter REPLACES what is stored, so an explicit `?model=lite` returns to
// defaults without having to explain storage to anyone.
//
// The wider lesson, and it is the one to carry: **the operator's check was
// "look for a yellow line and stop if it is missing" — an ABSENCE.** Kd did not
// notice it was missing and recorded all eight clips, which is exactly what
// asking someone to spot a missing thing gets you. The widget now shows the
// settings ALWAYS, so the check is comparing two visible lines instead.

const STORAGE_KEY = 'aihg.poseTuning';

function storage() {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null; // storage disabled (private mode, blocked cookies)
  }
}

/** True when this page load is ASKING for settings — as opposed to resolving
 *  to the defaults because it named nothing. Those are different, and treating
 *  them the same would let a plain reload wipe the captured settings. */
export function hasTuningParams(search = '') {
  const q = new URLSearchParams(search);
  return TUNING_PARAMS.some((p) => q.has(p));
}

/** Read the URL once and remember it for this tab. Exported for tests; called
 *  at module load below, which in a dev build happens before the router has had
 *  a chance to rewrite anything. */
export function capturePoseTuning(search) {
  if (!POSE_TUNING_ENABLED) return;
  const store = storage();
  if (store === null || !hasTuningParams(search)) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(parsePoseTuning(search)));
  } catch {
    /* storage full or blocked — the run is simply untuned, and the widget says so */
  }
}

/**
 * The settings in force for this tab.
 *
 * Anything unreadable or unrecognised falls back to the shipped defaults rather
 * than to a half-populated object: a partly-applied setting recorded in a trace
 * header as deliberate is worse than no setting at all.
 */
export function readPoseTuning() {
  if (!POSE_TUNING_ENABLED) return { ...POSE_DEFAULTS };
  const store = storage();
  if (store === null) return { ...POSE_DEFAULTS };
  let raw = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return { ...POSE_DEFAULTS };
  }
  if (raw === null) return { ...POSE_DEFAULTS };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...POSE_DEFAULTS };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ...POSE_DEFAULTS };
  // Re-validated on the way OUT as well as in. Storage is editable by hand and
  // is external input like any other (R2.3).
  return {
    model: Object.hasOwn(MODEL_FILES, parsed.model) ? parsed.model : POSE_DEFAULTS.model,
    numPoses: clampPoses(parsed.numPoses, POSE_DEFAULTS.numPoses),
    minPoseDetectionConfidence: clamp01(
      parsed.minPoseDetectionConfidence,
      POSE_DEFAULTS.minPoseDetectionConfidence,
    ),
    minPosePresenceConfidence: clamp01(
      parsed.minPosePresenceConfidence,
      POSE_DEFAULTS.minPosePresenceConfidence,
    ),
    minTrackingConfidence: clamp01(
      parsed.minTrackingConfidence,
      POSE_DEFAULTS.minTrackingConfidence,
    ),
  };
}

// Runs at first import — before the router can strip the query string.
if (typeof window !== 'undefined') capturePoseTuning(window.location.search);

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
