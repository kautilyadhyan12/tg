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

// Send/overlay throttles now live client-side (§2.1: the provider adapter owns
// fps, not the engine). Analysis + overlay both run locally, no network.
const DETECT_INTERVAL_MS = 33;    // ~30fps pose inference
const PUBLISH_INTERVAL_MS = 33;   // ~30fps overlay publish (one re-render each)
const FEED_INTERVAL_MS = 67;      // ~15fps engine feed (§2.1 target analysis rate)

export default function usePoseDetection({ exercise, setIndex = 1, enabled, onSetComplete }) {
  const [poseData, setPoseData] = useState(null);
  const [keypointsData, setKeypointsData] = useState(null);
  const [analysisAvailable, setAnalysisAvailable] = useState(false);
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

  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { onSetCompleteRef.current = onSetComplete; }, [onSetComplete]);

  // ── Initialise MediaPipe on mount (unchanged from the WS version) ───────────
  useEffect(() => {
    let cancelled = false;

    async function initML() {
      try {
        const { PoseLandmarker, FilesetResolver } =
          await import('@mediapipe/tasks-vision');

        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
        );

        const LOCAL_MODEL  = '/models/pose_landmarker_lite.task';
        const REMOTE_MODEL =
          'https://storage.googleapis.com/mediapipe-models/' +
          'pose_landmarker/pose_landmarker_lite/float16/1/' +
          'pose_landmarker_lite.task';

        async function createLandmarker(delegate, modelAssetPath) {
          return PoseLandmarker.createFromOptions(filesetResolver, {
            baseOptions: { modelAssetPath, delegate },
            runningMode:  'VIDEO',
            numPoses:     1,
            minPoseDetectionConfidence:  0.5,
            minPosePresenceConfidence:   0.5,
            minTrackingConfidence:       0.5,
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
  }, []); // run once on mount

  // ── One engine session PER SET (§3.9) ───────────────────────────────────────
  // Keyed on (exercise, setIndex) — NOT on `enabled`, so pausing does not end the
  // set. On teardown / set change, emit the previous set's SetSummary (§2.4).
  useEffect(() => {
    const controller = controllerRef.current;
    controller.startSet(exercise, setIndex);
    setAnalysisAvailable(controller.analysisAvailable);
    setError(null);
    setPoseData(null);
    return () => {
      const summary = controller.endSet();
      if (summary && onSetCompleteRef.current) onSetCompleteRef.current(summary);
    };
  }, [exercise, setIndex]);

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

  return { poseData, keypointsData, analysisAvailable, error, startStreaming, stop };
}
