/**
 * usePoseDetection.js — Phase 3 (rule-based only)
 *
 * The browser runs MediaPipe Pose ONLY to get keypoints and sends them to the
 * server; the server's rule-based analyzer is the sole source of
 * form_score / form_correct.
 *
 * Hook API (unchanged):
 *   { poseData, keypointsData, connected, error,
 *     connect, disconnect, startStreaming, resetReps }
 *
 * Production hardening in this revision (analysis behavior unchanged):
 *   1. BATTERY: pose inference (detectForVideo — by far the most expensive
 *      operation in the whole app) previously ran on EVERY rAF tick, i.e.
 *      up to 60x/second on 60Hz screens and 120x/s on newer phones, even
 *      though the overlay publishes at 30fps and the server needs 15fps.
 *      Detection itself is now throttled to 30fps — roughly HALF (or 1/4 on
 *      120Hz devices) the CPU/GPU work per second of workout, directly less
 *      battery drain and heat, with zero visible difference.
 *   2. BATTERY: when the tab/app goes to background (visibilitychange), the
 *      frame loop stops completely and resumes on return. rAF alone is not a
 *      reliable pause on all mobile browsers.
 *   3. BUG: switching exercises mid-workout only changed the per-message
 *      exercise field, but the server's RepCounter is created and keyed by
 *      the CONNECT-TIME query param — so exercise #2's reps were counted by
 *      a counter configured for exercise #1. The hook now reconnects
 *      automatically when `exercise` changes while active.
 *   4. Reconnect uses exponential backoff (1.5s → 3s → 6s → capped 10s,
 *      reset on success) instead of hammering a down server every 1.5s.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
// DEV-ONLY (P1.3): golden-trace recorder tee. Both calls below are no-ops
// unless VITE_TRACE_RECORD=1; analysis behavior is untouched either way.
import { TRACE_RECORD_ENABLED, recordFrame, recordResponse } from '../dev/traceRecorder';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws';

// How often to send keypoints to the server (ms). The server does rep
// counting + corrections and needs only ~15fps.
const SEND_INTERVAL_MS = 67;      // ~15fps

// How often to RUN pose inference (ms). 30fps is visually indistinguishable
// for a skeleton overlay and halves battery cost vs running every rAF tick.
const DETECT_INTERVAL_MS = 33;    // ~30fps

// Local overlay publish rate (ms) — one React re-render per publish.
const PUBLISH_INTERVAL_MS = 33;   // ~30fps

const RECONNECT_BASE_MS = 1500;
const RECONNECT_MAX_MS  = 10000;

export default function usePoseDetection({ exercise, enabled }) {
  const [poseData,  setPoseData]  = useState(null);
  // Keypoints live in their OWN state, updated ~30fps for the overlay. Keeping
  // them separate from poseData means the consumer's [poseData] effect (rep
  // counting, form) does NOT re-run on every keypoint frame — which is what
  // caused the "Maximum update depth exceeded" render storm.
  const [keypointsData, setKeypointsData] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error,     setError]     = useState(null);

  const wsRef           = useRef(null);   // WebSocket connection
  const landmarkerRef   = useRef(null);   // MediaPipe PoseLandmarker instance
  const rafRef          = useRef(null);   // requestAnimationFrame handle
  const videoRef        = useRef(null);
  const enabledRef      = useRef(enabled);
  const exerciseRef     = useRef(exercise);
  const lastSendRef     = useRef(0);      // timestamp of last WS send
  const lastDetectRef   = useRef(0);      // timestamp of last pose inference
  const lastPublishRef  = useRef(0);      // timestamp of last local keypoint publish
  const lastKeypointsRef = useRef([]);    // most recent detection result
  const lastTimestampRef = useRef(0);     // monotonic timestamp for detectForVideo
  const mpReadyRef      = useRef(false);  // true once MediaPipe is initialised
  const shouldReconnectRef = useRef(false); // do we want the socket to stay up?
  const reconnectTimerRef  = useRef(null);  // pending auto-reconnect timer
  const reconnectDelayRef  = useRef(RECONNECT_BASE_MS); // backoff state
  const loopRunningRef     = useRef(false); // is the rAF loop currently going?

  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // ── Initialise MediaPipe on mount ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function initML() {
      try {
        const { PoseLandmarker, FilesetResolver } =
          await import('@mediapipe/tasks-vision');

        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
        );

      // Self-hosted model is tried first so we never depend on
      // storage.googleapis.com (some networks fail to resolve it).
      // Place the file at frontend/public/models/pose_landmarker_lite.task
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

      // GPU first, fall back to CPU, for a given model path
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
        landmarker = await createWithFallback(LOCAL_MODEL);   // self-hosted
        console.log('[usePoseDetection] pose model loaded from', LOCAL_MODEL);
      } catch (localErr) {
        console.warn('[usePoseDetection] local model unavailable, trying remote CDN:', localErr.message);
        try {
          landmarker = await createWithFallback(REMOTE_MODEL); // CDN fallback
        } catch (remoteErr) {
          if (!cancelled) {
            console.warn('[usePoseDetection] MediaPipe init failed:', remoteErr.message);
            setError('Pose detection unavailable — ' + remoteErr.message);
          }
          return;
        }
      }

      if (cancelled) {
        landmarker.close();
        return;
      }

      landmarkerRef.current = landmarker;
      mpReadyRef.current    = true;
      console.log('[usePoseDetection] MediaPipe ready');
      } catch (err) {
        if (!cancelled) {
          console.warn('[usePoseDetection] MediaPipe init failed:', err.message);
          setError('Pose detection unavailable — ' + err.message);
        }
        return;
      }
    }

    initML();

    return () => {
      cancelled = true;
      if (landmarkerRef.current) {
        try { landmarkerRef.current.close(); } catch (_) {}
        landmarkerRef.current = null;
      }
      mpReadyRef.current = false;
    };
  }, []); // run once on mount

  // ── Connect WebSocket ──────────────────────────────────────────────────────
  const connect = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { setError('No auth token'); return; }

    // We want to stay connected from here on; an UNSOLICITED close should
    // trigger an automatic reconnect (see ws.onclose below).
    shouldReconnectRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      // Closing an existing socket on PURPOSE — detach its onclose first so it
      // doesn't kick off the auto-reconnect path.
      const old = wsRef.current;
      wsRef.current = null;
      old.onclose = null;
      try { old.close(); } catch (_) {}
    }

    const url = `${WS_URL}/pose?token=${encodeURIComponent(token)}&exercise=${encodeURIComponent(exercise)}`;
    const ws  = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);
      reconnectDelayRef.current = RECONNECT_BASE_MS; // reset backoff on success
      console.log('[usePoseDetection] WS connected');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'keepalive') {
          // Server data drives reps/corrections/angles — but NOT the skeleton.
          // The overlay keypoints are set locally every frame from MediaPipe
          // (see processFrame), which removes the network round-trip lag.
          // Strip the server's keypoints field so it never overwrites the
          // fresh local ones.
          const { keypoints: _staleKeypoints, ...rest } = data;
          if (TRACE_RECORD_ENABLED) recordResponse(rest, performance.now());
          setPoseData((prev) => ({ ...(prev || {}), ...rest }));
        }
      } catch (e) {
        console.error('[usePoseDetection] WS parse error:', e);
      }
    };

    ws.onerror = () => {
      setError('WebSocket connection failed');
      setConnected(false);
    };

    ws.onclose = () => {
      setConnected(false);
      console.log('[usePoseDetection] WS disconnected');
      // Auto-reconnect on an UNSOLICITED close, with exponential backoff so a
      // down server isn't hammered every 1.5s (which also drains battery).
      // After reconnect the server may report a different rep count — the
      // consumer's rep effect handles that via its per-set baseline.
      if (shouldReconnectRef.current && !reconnectTimerRef.current) {
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, RECONNECT_MAX_MS);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (shouldReconnectRef.current) connect();
        }, delay);
      }
    };
  }, [exercise]);

  // ── Reconnect when the exercise changes mid-session ────────────────────────
  // The server creates its RepCounter from the CONNECT-TIME query param; only
  // changing the per-message exercise field left exercise #2 being counted by
  // exercise #1's counter. A fresh connection re-keys the server session.
  useEffect(() => {
    const changed = exerciseRef.current !== exercise;
    exerciseRef.current = exercise;
    if (changed && shouldReconnectRef.current) {
      connect();
    }
  }, [exercise, connect]);

  // ── Disconnect ─────────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    // Intentional disconnect — do NOT auto-reconnect, and cancel any pending one.
    shouldReconnectRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectDelayRef.current = RECONNECT_BASE_MS;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    loopRunningRef.current = false;
    if (wsRef.current) {
      const old = wsRef.current;
      wsRef.current = null;
      old.onclose = null;   // don't trigger reconnect on this intentional close
      try { old.close(); } catch (_) {}
    }
    setConnected(false);
  }, []);

  // ── Frame processing loop ──────────────────────────────────────────────────
  const processFrame = useCallback(async (videoElement) => {
    if (!enabledRef.current) return;
    if (!mpReadyRef.current || !landmarkerRef.current) return;
    if (!videoElement || videoElement.readyState < 2) return;

    const now = performance.now();

    // ── 1. MediaPipe pose detection, throttled to ~30fps ────────────────────
    // detectForVideo is the most expensive call in the entire app. Running it
    // on every rAF tick (60–120Hz) doubled-to-quadrupled battery cost for no
    // visible benefit. Between detections we reuse the last result.
    let keypoints = lastKeypointsRef.current;

    if (now - lastDetectRef.current >= DETECT_INTERVAL_MS) {
      lastDetectRef.current = now;

      // MediaPipe VIDEO mode requires STRICTLY increasing timestamps. We feed
      // a monotonic counter that can never go backwards or repeat, rather
      // than relying on performance.now() directly (which can momentarily
      // stall or be equal between very fast frames).
      let ts = Math.round(now);
      if (ts <= lastTimestampRef.current) {
        ts = lastTimestampRef.current + 1;
      }
      lastTimestampRef.current = ts;

      try {
        const results = landmarkerRef.current.detectForVideo(videoElement, ts);
        if (results.landmarks && results.landmarks.length > 0) {
          keypoints = results.landmarks[0].map((lm) => [
            lm.x,
            lm.y,
            lm.z,
            lm.visibility ?? 1.0,
          ]);
        } else {
          keypoints = [];
        }
        lastKeypointsRef.current = keypoints;
      } catch (err) {
        // MediaPipe occasionally throws on first few frames — safe to ignore
        return;
      }
    }

    // ── 1b. Publish keypoints LOCALLY ────────────────────────────────────────
    // The skeleton overlay renders from this — zero network lag. Throttled to
    // ~30fps: each publish re-renders the page component.
    if (now - lastPublishRef.current >= PUBLISH_INTERVAL_MS) {
      lastPublishRef.current = now;
      setKeypointsData({
        keypoints,
        person_detected: keypoints.length > 0,
      });
    }

    // ── 2. Send to server at ~15fps (server does rep counting + corrections) ─
    const shouldSend =
      wsRef.current?.readyState === WebSocket.OPEN &&
      now - lastSendRef.current >= SEND_INTERVAL_MS;

    if (shouldSend) {
      lastSendRef.current = now;
      try {
        wsRef.current.send(JSON.stringify({
          keypoints: keypoints,
          exercise:  exercise,
        }));
        if (TRACE_RECORD_ENABLED) recordFrame(keypoints, now);
      } catch (_) {
        // WS may have closed between the readyState check and send — ignore
      }
    }
  }, [exercise]);

  // ── Start frame loop on video element ─────────────────────────────────────
  const startStreaming = useCallback((videoElement) => {
    videoRef.current = videoElement;

    // Cancel any existing loop
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    function loop() {
      if (!videoRef.current) { loopRunningRef.current = false; return; }
      // Fully stop while the tab/app is in the background — camera pipelines
      // and rAF behave inconsistently across mobile browsers, and there is
      // nothing useful to compute with the screen off. The visibility
      // listener below restarts the loop on return.
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

  // Tell the server to zero its rep counter — call at the start of each set.
  const resetReps = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'reset_reps' })); } catch (_) {}
    }
  }, []);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return {
    poseData,
    keypointsData,
    connected,
    error,
    connect,
    disconnect,
    startStreaming,
    resetReps,
  };
}
