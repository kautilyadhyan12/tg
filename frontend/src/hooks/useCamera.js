import { useState, useRef, useCallback } from 'react';

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