import { useState, useRef, useCallback } from 'react';

// Named because it is compared, not just displayed: `unmute` lifts THIS error
// and no other.
const MUTE_ERROR = 'Camera stopped sending video';

export default function useCamera() {
  const [stream,        setStream]        = useState(null);
  const [error,         setError]         = useState(null);
  const [ready,         setReady]         = useState(false);
  const [deviceLabel,   setDeviceLabel]   = useState('');
  const [availableCams, setAvailableCams] = useState([]);
  const videoRef = useRef(null);

  // ── Get all available cameras ─────────────────────────────────────────────
  const getAvailableCameras = useCallback(async () => {
    try {
      // Must request permission first to get labels. IMPORTANT: stop this
      // temporary stream immediately — previously it was never stopped, so
      // the camera stayed active (indicator light on, battery draining) for
      // the rest of the session even before/after the workout.
      const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      tmp.getTracks().forEach((t) => t.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((d) => d.kind === 'videoinput');
      setAvailableCams(cameras);
      return cameras;
    } catch {
      return [];
    }
  }, []);

  // ── Start camera by device ID ─────────────────────────────────────────────
  const startCamera = useCallback(async (deviceId = null) => {
    try {
      setError(null);
      setReady(false);

      // Stop any existing stream first
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject
          .getTracks()
          .forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }

      // Small delay — gives virtual cameras (DroidCam) time to initialize
      await new Promise((resolve) => setTimeout(resolve, 500));

      const constraints = {
        video: deviceId
          ? {
              deviceId:  { exact: deviceId },
              width:     { ideal: 1280 },
              height:    { ideal: 720 },
              frameRate: { ideal: 30 },
            }
          : {
              // On phones, default to the front camera — that's how people
              // actually position themselves for form checking.
              facingMode: { ideal: 'user' },
              width:     { ideal: 1280 },
              height:    { ideal: 720 },
              frameRate: { ideal: 30 },
            },
        audio: false,
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Verify stream has active video tracks
      const videoTracks = mediaStream.getVideoTracks();
      if (videoTracks.length === 0) {
        throw new Error('No video tracks in stream');
      }

      setStream(mediaStream);

      const track = videoTracks[0];
      setDeviceLabel(track?.label || 'Camera');

      // A camera that DIES after streaming started reported nothing at all
      // before this: `setError` was written only in the catch below, which can
      // only fire while the camera is being opened. Unplug the webcam mid-set
      // and the stream simply stopped producing frames — silently, with `error`
      // still null — so the workout screen had no signal to fall back on and
      // the user was left with no way to record the rest of the set (T3 F1).
      // `ended` fires on unplug/device-removal; `mute` covers the OS or another
      // app seizing the device, which stops frames without ending the track.
      // `ended` is permanent — a removed device does not come back on this
      // track. `mute` is BY DEFINITION temporary: the track raises `unmute` when
      // it resumes, so it must be cleared again, or one app briefly grabbing the
      // camera (or a mobile browser backgrounding the page) leaves a red "Camera
      // Error" panel over a working camera for the rest of the workout, with
      // every remaining set filed unscored. `error` is otherwise cleared in
      // exactly one place — inside `startCamera`, which is not called again
      // mid-workout — so nothing else would ever lift it (round 2 F3).
      if (track) {
        track.addEventListener('ended', () => setError('Camera disconnected'));
        track.addEventListener('mute',  () => setError(MUTE_ERROR));
        // Only the mute message is lifted: an `ended` that arrives afterwards
        // must not be wiped by a late `unmute`.
        track.addEventListener('unmute', () => setError((e) => (e === MUTE_ERROR ? null : e)));
      }

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;

        // Wait for video to actually have frames
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            // Don't reject — just mark as ready anyway
            clearTimeout(timeout);
            setReady(true);
            resolve();
          }, 15000);

          videoRef.current.onloadedmetadata = () => {
            clearTimeout(timeout);
            // Component may have unmounted before metadata arrived.
            if (!videoRef.current) { resolve(); return; }
            videoRef.current.play()
              .then(() => {
                // Extra delay for virtual cameras to send real frames
                setTimeout(() => {
                  if (videoRef.current) setReady(true);
                  resolve();
                }, 300);
              })
              .catch(reject);
          };
        });
      }

      return mediaStream;
    } catch (err) {
      const msg =
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access.'
          : err.name === 'NotFoundError'
          ? 'No camera found. Please connect a camera.'
          : err.name === 'NotReadableError'
          ? 'Camera is in use by another app. Close DroidCam Client and reopen it.'
          : `Camera error: ${err.message}`;
      setError(msg);
      return null;
    }
  }, []);

  // ── Switch camera ─────────────────────────────────────────────────────────
  const switchCamera = useCallback(async (deviceId) => {
    // Stop current stream
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
      setReady(false);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    // Wait before switching — important for virtual cameras
    await new Promise((resolve) => setTimeout(resolve, 600));

    return startCamera(deviceId);
  }, [stream, startCamera]);

  // ── Stop camera ───────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
      setReady(false);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stream]);

  return {
    videoRef,
    stream,
    error,
    ready,
    deviceLabel,
    availableCams,
    startCamera,
    stopCamera,
    switchCamera,
    getAvailableCameras,
  };
}