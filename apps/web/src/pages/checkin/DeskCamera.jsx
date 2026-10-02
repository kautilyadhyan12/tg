import { useEffect, useRef, useState } from 'react';

// THE DESK'S CAMERA (spec Part 3 §12.3): for a desk with no USB scanner, the tablet's own
// camera reads the member's pass. `jsqr` is loaded only when the camera is opened, so no
// other page carries it. Every frame read stays in this browser; only the text of a QR
// goes to the scan, as a scanner's typing would.

/** Frames a second the camera is read at: enough to feel instant, light on a tablet. */
const READS_PER_SECOND = 5;
/** Frames are read at this width at most; a pass fills the frame, so detail is not needed. */
const READ_WIDTH = 640;

export default function DeskCamera({ onCode }) {
  const videoRef = useRef(null);
  const onCodeRef = useRef(onCode);
  const [problem, setProblem] = useState(null);

  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    let cancelled = false;
    let stream = null;
    let timer = null;
    const canvas = document.createElement('canvas');

    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    const start = async () => {
      if (navigator.mediaDevices?.getUserMedia === undefined) {
        setProblem("This browser can't open the camera. Use a scanner, or open this page in Chrome, Edge or Safari.");
        return;
      }
      let jsQR;
      try {
        // The reader first, so a camera is never opened that nothing then reads.
        jsQR = (await import('jsqr')).default;
        if (cancelled) return;
        // A tablet at the desk faces the member, so its front camera is the one that sees
        // the pass; a computer has one camera, and `ideal` takes whatever it has.
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'user' } }, audio: false });
      } catch {
        if (!cancelled) setProblem("We couldn't open the camera. Allow camera access for this page in the browser, or use a scanner.");
        stop();
        return;
      }
      if (cancelled) {
        stop();
        return;
      }
      const video = videoRef.current;
      if (video === null) {
        stop();
        return;
      }
      video.srcObject = stream;
      void video.play().catch(() => {});
      const context = canvas.getContext('2d', { willReadFrequently: true });
      timer = setInterval(() => {
        if (context === null || video.readyState < 2 || video.videoWidth === 0) return;
        const scale = Math.min(1, READ_WIDTH / video.videoWidth);
        const width = Math.round(video.videoWidth * scale);
        const height = Math.round(video.videoHeight * scale);
        canvas.width = width;
        canvas.height = height;
        context.drawImage(video, 0, 0, width, height);
        const frame = context.getImageData(0, 0, width, height);
        const found = jsQR(frame.data, width, height, { inversionAttempts: 'dontInvert' });
        if (found !== null && typeof found.data === 'string' && found.data !== '') onCodeRef.current(found.data);
      }, Math.round(1000 / READS_PER_SECOND));
    };

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  if (problem !== null) {
    return (
      <p className="c-callout c-s15 max-w-xl" role="alert">
        {problem}
      </p>
    );
  }
  return (
    <div className="c-card p-3 w-full max-w-md">
      {/* Shown as a mirror, as every front camera is, so a member lines the pass up
          naturally; the frames read are the camera's own. */}
      <video
        ref={videoRef}
        className="w-full rounded-xl"
        style={{ transform: 'scaleX(-1)' }}
        muted
        playsInline
        aria-label="Camera: hold the pass up to it"
      />
      <p className="c-s14 c-t2 mt-2 text-center">Hold the pass up to the camera.</p>
    </div>
  );
}
