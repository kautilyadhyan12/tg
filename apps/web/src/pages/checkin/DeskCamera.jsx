import { useEffect, useRef, useState } from 'react';
import { CAMERA_ASK, READS_PER_SECOND, READ_WAYS, REST_TIMES, nextWay, readPixels, readPlan } from './deskRead';

// THE DESK'S CAMERA (spec Part 3 §12.3): for a desk with no USB scanner, the tablet's own
// camera reads the member's pass. Every frame read stays in this browser; only the text of
// a QR goes to the scan, as a scanner's typing would.
//
// Each picture is read one way a turn (`deskRead.js`): whole or its middle, as it is or
// with the grey pulled apart from the white, which is what a phone's screen needs in a dim
// room. The reading is done off the page's own thread (`deskReadWorker.js`), one picture
// at a time, so a slow read in the dark never holds up a tap; a browser with no workers
// reads on the page, with `jsqr` loaded only when the camera is opened.

/** The reader: `read(pixels, width, height, levels)` answers the QR's text or null. */
async function openReader() {
  if (typeof Worker === 'undefined') {
    const jsQR = (await import('jsqr')).default;
    return { read: async (pixels, width, height, levels) => readPixels(jsQR, pixels, width, height, levels), close: () => {} };
  }
  const worker = new Worker(new URL('./deskReadWorker.js', import.meta.url), { type: 'module' });
  const waiting = new Map();
  let sent = 0;
  worker.onmessage = (event) => {
    waiting.get(event.data.id)?.(event.data.text);
    waiting.delete(event.data.id);
  };
  // A worker that fails reads nothing; the camera says so rather than looking alive.
  let failed = null;
  worker.onerror = () => {
    failed?.();
  };
  return {
    read: (pixels, width, height, levels) =>
      new Promise((resolve) => {
        sent += 1;
        waiting.set(sent, resolve);
        worker.postMessage({ id: sent, pixels: pixels.buffer, width, height, levels }, [pixels.buffer]);
      }),
    close: () => worker.terminate(),
    onFail: (tell) => {
      failed = tell;
    },
  };
}

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
    let reader = null;
    const canvas = document.createElement('canvas');

    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      reader?.close();
      reader = null;
    };

    const start = async () => {
      if (navigator.mediaDevices?.getUserMedia === undefined) {
        setProblem("This browser can't open the camera. Use a scanner, or open this page in Chrome, Edge or Safari.");
        return;
      }
      try {
        // The reader first, so a camera is never opened that nothing then reads.
        reader = await openReader();
        if (cancelled) {
          stop();
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia(CAMERA_ASK);
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
      reader.onFail?.(() => {
        if (cancelled) return;
        setProblem("The camera can't read passes in this browser. Use a scanner, or open this page in Chrome, Edge or Safari.");
        stop();
      });
      video.srcObject = stream;
      void video.play().catch(() => {});
      const context = canvas.getContext('2d', { willReadFrequently: true });
      let last = -1;
      let reading = false;
      const restUntil = READ_WAYS.map(() => 0);
      const mine = reader;
      timer = setInterval(() => {
        if (reading || context === null || video.readyState < 2 || video.videoWidth === 0) return;
        const from = performance.now();
        const turn = nextWay(last, restUntil, from);
        if (turn === -1) return;
        const way = READ_WAYS[turn];
        const plan = readPlan(video.videoWidth, video.videoHeight, way);
        canvas.width = plan.width;
        canvas.height = plan.height;
        context.drawImage(video, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, plan.width, plan.height);
        const frame = context.getImageData(0, 0, plan.width, plan.height);
        reading = true;
        void mine.read(frame.data, plan.width, plan.height, way.levels).then((text) => {
          reading = false;
          if (cancelled) return;
          if (text !== null) {
            // The way that read it goes again next turn: it suits this light.
            last = turn - 1;
            onCodeRef.current(text);
            return;
          }
          last = turn;
          const now = performance.now();
          restUntil[turn] = now + (now - from) * REST_TIMES;
        });
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
      <p className="c-s14 c-t2 mt-2 text-center">Hold the pass up to the camera and keep it still.</p>
      <p className="c-s14 c-t2 mt-1 text-center">If it doesn&apos;t read, bring the phone closer or tilt it away from the lights.</p>
    </div>
  );
}
