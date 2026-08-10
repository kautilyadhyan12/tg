/**
 * usePoseDetection.js — P1.10b: ON-DEVICE analysis (v1 §13, D1).
 *
 * The WebSocket + server analyzer are GONE. The browser runs MediaPipe to get
 * keypoints and feeds them to the local @app/engine (via SessionController).
 * The engine computes reps/form/cues on-device; the server never sees keypoints.
 *
 * One engine session PER SET (§3.9): a set is (exercise, setIndex). When either
 * changes, the previous set's SetSummary (§2.4) is emitted via onSetComplete and
 * a fresh session starts. Exercises with no published definition run in log-only
 * mode (Part 6 §3.6) — manual counting, honest, still counts.
 *
 * Hook API:
 *   { poseData, keypointsData, analysisAvailable, error, startStreaming, stop }
 * poseData is the display shape the old ActiveWorkout already reads (rep_count,
 * state, corrections, form_correct, is_active, person_detected, view, form_score)
 * so the screen "mostly doesn't notice" the swap (v1 §13).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { SessionController } from '../engine/sessionController.js';
// DEV-ONLY (P1.3): raw-frame recorder tee. No-op unless VITE_TRACE_RECORD=1.
import { TRACE_RECORD_ENABLED, recordFrame } from '../dev/traceRecorder';
// DEV-ONLY: MediaPipe settings from the URL. Returns the frozen shipped
// defaults in a production build, so this import changes nothing there.
import { modelUrls, readPoseTuning } from '../dev/poseTuning';

// Send/overlay throttles now live client-side (§2.1: the provider adapter owns
// fps, not the engine). Analysis + overlay both run locally, no network.
const DETECT_INTERVAL_MS = 33;    // ~30fps pose inference
const PUBLISH_INTERVAL_MS = 33;   // ~30fps overlay publish (one re-render each)
const FEED_INTERVAL_MS = 67;      // ~15fps engine feed (§2.1 target analysis rate)

/** `analysisEnabled: false` is the user having CHOSEN to count their own reps
 *  (2026-08-03). It is deliberately stronger than `enabled`, which only pauses
 *  the feed: no MediaPipe model is downloaded, no engine session is started for
 *  any set, and `analysisAvailable` stays false — so the page's hand-counting UI
 *  is the one the user sees, on every exercise, including the three the engine
 *  could have graded. Part 6 §3.6 described log-only mode as an AUTOMATIC
 *  degradation on weak devices; a user-chosen one is Kd's ruling of the same
 *  date, recorded in DECISIONS. */
export default function usePoseDetection({
  exercise,
  setIndex = 1,
  enabled,
  onSetComplete,
  analysisEnabled = true,
}) {
  const [poseData, setPoseData] = useState(null);
  const [keypointsData, setKeypointsData] = useState(null);
  const [analysisAvailable, setAnalysisAvailable] = useState(false);
  // "HAS THIS HOOK ANSWERED YET?", which is NOT the same question as
  // `analysisAvailable`, and conflating them cost the first set of every camera
  // workout its form score (round 2 F1). `analysisAvailable` is state
  // initialised to false and only flipped from the per-set effect below, so on
  // the FIRST render of every camera workout the page is told "nothing is
  // analysing" — indistinguishable, from the page's side, from "this exercise
  // has no definition". The page acted on it, marked set 1 as hand-counted, and
  // never took it back. False here means "not known yet"; false in
  // `analysisAvailable` means "known, and there is nothing".
  //
  // IT HOLDS WHICH EXERCISE THE ANSWER IS ABOUT, not a bare yes/no — round 3 F1.
  // A boolean answered "has this hook EVER answered", which never goes back to
  // false, so it protected the mount and nothing else. `analysisAvailable` is
  // per-exercise state written from the same effect, so on the render where the
  // exercise CHANGES it still holds the previous exercise's answer: going from
  // an ungraded exercise to a graded one (press-ups → squats) presented exactly
  // the round-2 F1 state again — settled, and available still false — and the
  // page marked the squat set as hand-counted before the engine had spoken.
  // Single-exercise workouts never hit it, which is every test in the suite.
  const [settledFor, setSettledFor] = useState(null);
  const [error, setError] = useState(null);

  const controllerRef   = useRef(null);
  if (controllerRef.current === null) controllerRef.current = new SessionController();

  const landmarkerRef   = useRef(null);   // MediaPipe PoseLandmarker instance
  const rafRef          = useRef(null);   // requestAnimationFrame handle
  const videoRef        = useRef(null);
  const enabledRef      = useRef(enabled);
  const lastDetectRef   = useRef(0);
  const lastPublishRef  = useRef(0);
  const lastFeedRef     = useRef(0);
  const lastKeypointsRef = useRef([]);    // most recent detection result
  const lastTimestampRef = useRef(0);     // monotonic timestamp for detectForVideo
  const mpReadyRef      = useRef(false);
  const loopRunningRef  = useRef(false);
  const onSetCompleteRef = useRef(onSetComplete);

  // A RESUMED SET IS NOT A CONTINUATION. `enabled` false is a pause or a rest —
  // the feed below stops, the SET does not end, and frames start arriving again
  // from a scene that may have changed completely. The person check's rolling
  // window would otherwise carry readings from before the break, and any message
  // it had raised would still be on screen explaining a moment that is over.
  useEffect(() => {
    const wasEnabled = enabledRef.current;
    enabledRef.current = enabled;
    if (enabled && !wasEnabled) controllerRef.current.resetScene();
  }, [enabled]);
  useEffect(() => { onSetCompleteRef.current = onSetComplete; }, [onSetComplete]);

  // ── Initialise MediaPipe on mount (unchanged from the WS version) ───────────
  // Skipped entirely when the user is counting their own reps: this effect
  // downloads a pose model from a CDN, and doing that for a workout that will
  // never look at a camera is both waste and a failure the user cannot act on
  // (the catch below sets a "Pose detection unavailable" error).
  useEffect(() => {
    if (!analysisEnabled) return undefined;
    let cancelled = false;

    async function initML() {
      try {
        const { PoseLandmarker, FilesetResolver } =
          await import('@mediapipe/tasks-vision');

        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
        );

        // In a production build these ARE the previous hard-wired values —
        // `readPoseTuning` returns the frozen defaults and never reads the URL
        // (poseTuning.js). In dev they are whatever the query string asked for,
        // so one recording session can cover several candidate settings instead
        // of costing Kd a session each (DECISIONS :6386's phase-2 order).
        const tuning = readPoseTuning();
        const { local: LOCAL_MODEL, remote: REMOTE_MODEL } = modelUrls(tuning.model);

        async function createLandmarker(delegate, modelAssetPath) {
          return PoseLandmarker.createFromOptions(filesetResolver, {
            baseOptions: { modelAssetPath, delegate },
            runningMode:  'VIDEO',
            numPoses:     tuning.numPoses,
            minPoseDetectionConfidence:  tuning.minPoseDetectionConfidence,
            minPosePresenceConfidence:   tuning.minPosePresenceConfidence,
            minTrackingConfidence:       tuning.minTrackingConfidence,
          });
        }

        async function createWithFallback(modelAssetPath) {
          try {
            return await createLandmarker('GPU', modelAssetPath);
          } catch (gpuErr) {
            console.warn('[usePoseDetection] GPU delegate failed, trying CPU:', gpuErr.message);
            return await createLandmarker('CPU', modelAssetPath);
          }
        }

        let landmarker;
        try {
          landmarker = await createWithFallback(LOCAL_MODEL);
          console.log('[usePoseDetection] pose model loaded from', LOCAL_MODEL);
        } catch (localErr) {
          console.warn('[usePoseDetection] local model unavailable, trying remote CDN:', localErr.message);
          landmarker = await createWithFallback(REMOTE_MODEL);
        }

        if (cancelled) { landmarker.close(); return; }

        landmarkerRef.current = landmarker;
        mpReadyRef.current    = true;
        console.log('[usePoseDetection] MediaPipe ready');
      } catch (err) {
        if (!cancelled) {
          console.warn('[usePoseDetection] MediaPipe init failed:', err.message);
          setError('Pose detection unavailable — ' + err.message);
        }
      }
    }

    initML();

    return () => {
      cancelled = true;
      if (landmarkerRef.current) {
        try { landmarkerRef.current.close(); } catch { /* landmarker already closing */ }
        landmarkerRef.current = null;
      }
      mpReadyRef.current = false;
    };
  }, [analysisEnabled]); // analysisEnabled is fixed for a workout; effectively mount-only

  // ── One engine session PER SET (§3.9) ───────────────────────────────────────
  // Keyed on (exercise, setIndex) — NOT on `enabled`, so pausing does not end the
  // set. On teardown / set change, emit the previous set's SetSummary (§2.4).
  //
  // No session is started at all when the user is counting their own reps, so
  // `analysisAvailable` stays false and endSet() has nothing to emit. That is
  // the difference between "this exercise has no definition" and "this user
  // asked to do it themselves": both end up hand-counted, and the page tells
  // them apart only to word the message honestly.
  useEffect(() => {
    // No session, and no state written either — `analysisAvailable` is reported
    // as false by DERIVING it below rather than by setting it here. Writing
    // state straight from an effect is the thing the hook lint rules ban, and
    // the derivation is stronger anyway: it cannot be left stale by a path that
    // forgets to reset it.
    if (!analysisEnabled) return undefined;
    const controller = controllerRef.current;
    controller.startSet(exercise, setIndex);
    setAnalysisAvailable(controller.analysisAvailable);
    setSettledFor(exercise);    // the answer exists, and it is about THIS exercise
    setError(null);
    setPoseData(null);
    return () => {
      const summary = controller.endSet();
      if (summary && onSetCompleteRef.current) onSetCompleteRef.current(summary);
    };
  }, [exercise, setIndex, analysisEnabled]);

  // ── Frame processing loop ───────────────────────────────────────────────────
  const processFrame = useCallback((videoElement) => {
    if (!mpReadyRef.current || !landmarkerRef.current) return;
    if (!videoElement || videoElement.readyState < 2) return;

    const now = performance.now();
    let landmarks = lastKeypointsRef.current;

    // 1. MediaPipe detection, throttled to ~30fps (the expensive call).
    if (now - lastDetectRef.current >= DETECT_INTERVAL_MS) {
      lastDetectRef.current = now;
      let ts = Math.round(now);
      if (ts <= lastTimestampRef.current) ts = lastTimestampRef.current + 1;
      lastTimestampRef.current = ts;
      try {
        const results = landmarkerRef.current.detectForVideo(videoElement, ts);
        landmarks = (results.landmarks && results.landmarks.length > 0)
          ? results.landmarks[0]
          : [];
        lastKeypointsRef.current = landmarks;
      } catch {
        return; // MediaPipe occasionally throws on the first few frames
      }
    }

    // 2. Publish keypoints locally for the overlay (~30fps). PoseOverlay expects
    //    [x, y, z, vis] rows; provider gives {x, y, z, visibility}.
    if (now - lastPublishRef.current >= PUBLISH_INTERVAL_MS) {
      lastPublishRef.current = now;
      setKeypointsData({
        keypoints: landmarks.map((lm) => [lm.x, lm.y, lm.z, lm.visibility ?? 1.0]),
        person_detected: landmarks.length > 0,
      });
    }

    // 3. Feed the engine at ~15fps (§2.1). Only while enabled (pause = stop
    //    feeding, NOT end the set). The controller maps to the display shape.
    if (enabledRef.current && now - lastFeedRef.current >= FEED_INTERVAL_MS) {
      lastFeedRef.current = now;
      const display = controllerRef.current.feed(landmarks, now, landmarks.length > 0);
      setPoseData(display);
      if (TRACE_RECORD_ENABLED) {
        recordFrame(landmarks.map((lm) => [lm.x, lm.y, lm.z, lm.visibility ?? 1.0]), now);
      }
    }
  }, []);

  // ── Start frame loop on a video element ─────────────────────────────────────
  const startStreaming = useCallback((videoElement) => {
    videoRef.current = videoElement;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }

    function loop() {
      if (!videoRef.current) { loopRunningRef.current = false; return; }
      if (document.hidden) { loopRunningRef.current = false; rafRef.current = null; return; }
      processFrame(videoRef.current);
      rafRef.current = requestAnimationFrame(loop);
    }
    loopRunningRef.current = true;
    rafRef.current = requestAnimationFrame(loop);
  }, [processFrame]);

  // Resume the loop when the page becomes visible again mid-session.
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden && videoRef.current && !loopRunningRef.current) {
        startStreaming(videoRef.current);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [startStreaming]);

  // ── Stop the loop (camera teardown). Set-end summary is emitted by the
  //    per-set effect's cleanup, not here. ─────────────────────────────────────
  const stop = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    loopRunningRef.current = false;
    videoRef.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);

  return {
    poseData,
    keypointsData,
    // Hard false whenever analysis is switched off, whatever the last session
    // left in state. The page reads this to decide whether to offer hand
    // counting, so a stale true is a screen with no way to record a rep.
    analysisAvailable: analysisEnabled && analysisAvailable,
    // Settled IMMEDIATELY when analysis is switched off: that answer came from
    // the user, not from the engine, so there is nothing to wait for.
    // Otherwise it is settled only for the exercise the answer was computed for,
    // so an exercise change reopens the question instead of carrying a stale yes.
    analysisSettled: !analysisEnabled || settledFor === exercise,
    error,
    startStreaming,
    stop,
  };
}
