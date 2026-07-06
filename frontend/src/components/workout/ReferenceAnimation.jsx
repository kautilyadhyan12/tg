import { useRef, useEffect, memo } from 'react';
import GifCarousel from '../exercise/GifCarousel';
import { getExerciseGifs } from '../../utils/exerciseMedia';

// ─── Skeleton fallback sequences ─────────────────────────────────────────────
const POSE_SEQUENCES = {
  squat: {
    fps: 8, color: '#6366f1',
    frames: [
      [[0.50,0.08],[0.48,0.07],[0.52,0.07],[0.46,0.08],[0.54,0.08],[0.42,0.22],[0.58,0.22],[0.38,0.38],[0.62,0.38],[0.36,0.52],[0.64,0.52],[0.44,0.50],[0.56,0.50],[0.44,0.72],[0.56,0.72],[0.44,0.92],[0.56,0.92]],
      [[0.50,0.18],[0.48,0.17],[0.52,0.17],[0.46,0.18],[0.54,0.18],[0.40,0.30],[0.60,0.30],[0.32,0.42],[0.68,0.42],[0.28,0.54],[0.72,0.54],[0.42,0.55],[0.58,0.55],[0.40,0.72],[0.60,0.72],[0.43,0.92],[0.57,0.92]],
      [[0.50,0.28],[0.48,0.27],[0.52,0.27],[0.46,0.28],[0.54,0.28],[0.38,0.38],[0.62,0.38],[0.30,0.48],[0.70,0.48],[0.26,0.58],[0.74,0.58],[0.40,0.60],[0.60,0.60],[0.36,0.75],[0.64,0.75],[0.42,0.92],[0.58,0.92]],
      [[0.50,0.18],[0.48,0.17],[0.52,0.17],[0.46,0.18],[0.54,0.18],[0.40,0.30],[0.60,0.30],[0.32,0.42],[0.68,0.42],[0.28,0.54],[0.72,0.54],[0.42,0.55],[0.58,0.55],[0.40,0.72],[0.60,0.72],[0.43,0.92],[0.57,0.92]],
    ],
  },
  push_up: {
    fps: 6, color: '#22c55e',
    frames: [
      [[0.50,0.18],[0.48,0.17],[0.52,0.17],[0.46,0.18],[0.54,0.18],[0.35,0.28],[0.65,0.28],[0.28,0.42],[0.72,0.42],[0.22,0.55],[0.78,0.55],[0.38,0.55],[0.62,0.55],[0.40,0.72],[0.60,0.72],[0.42,0.88],[0.58,0.88]],
      [[0.50,0.28],[0.48,0.27],[0.52,0.27],[0.46,0.28],[0.54,0.28],[0.35,0.36],[0.65,0.36],[0.26,0.46],[0.74,0.46],[0.22,0.56],[0.78,0.56],[0.38,0.58],[0.62,0.58],[0.40,0.72],[0.60,0.72],[0.42,0.88],[0.58,0.88]],
      [[0.50,0.38],[0.48,0.37],[0.52,0.37],[0.46,0.38],[0.54,0.38],[0.34,0.46],[0.66,0.46],[0.25,0.54],[0.75,0.54],[0.22,0.58],[0.78,0.58],[0.38,0.60],[0.62,0.60],[0.40,0.72],[0.60,0.72],[0.42,0.88],[0.58,0.88]],
      [[0.50,0.28],[0.48,0.27],[0.52,0.27],[0.46,0.28],[0.54,0.28],[0.35,0.36],[0.65,0.36],[0.26,0.46],[0.74,0.46],[0.22,0.56],[0.78,0.56],[0.38,0.58],[0.62,0.58],[0.40,0.72],[0.60,0.72],[0.42,0.88],[0.58,0.88]],
    ],
  },
  plank: {
    fps: 4, color: '#f59e0b',
    frames: [
      [[0.50,0.20],[0.48,0.19],[0.52,0.19],[0.46,0.20],[0.54,0.20],[0.38,0.30],[0.62,0.30],[0.28,0.42],[0.72,0.42],[0.22,0.53],[0.78,0.53],[0.44,0.52],[0.56,0.52],[0.50,0.68],[0.56,0.68],[0.50,0.85],[0.58,0.85]],
      [[0.50,0.21],[0.48,0.20],[0.52,0.20],[0.46,0.21],[0.54,0.21],[0.38,0.31],[0.62,0.31],[0.28,0.43],[0.72,0.43],[0.22,0.54],[0.78,0.54],[0.44,0.53],[0.56,0.53],[0.50,0.69],[0.56,0.69],[0.50,0.86],[0.58,0.86]],
    ],
  },
  lunge: {
    fps: 6, color: '#ec4899',
    frames: [
      [[0.50,0.08],[0.48,0.07],[0.52,0.07],[0.46,0.08],[0.54,0.08],[0.42,0.22],[0.58,0.22],[0.38,0.38],[0.62,0.38],[0.36,0.52],[0.64,0.52],[0.44,0.50],[0.56,0.50],[0.44,0.72],[0.56,0.72],[0.44,0.92],[0.56,0.92]],
      [[0.46,0.15],[0.44,0.14],[0.48,0.14],[0.42,0.15],[0.50,0.15],[0.38,0.26],[0.56,0.26],[0.34,0.40],[0.60,0.40],[0.32,0.54],[0.62,0.54],[0.40,0.48],[0.58,0.48],[0.34,0.68],[0.62,0.72],[0.30,0.88],[0.66,0.92]],
      [[0.46,0.18],[0.44,0.17],[0.48,0.17],[0.42,0.18],[0.50,0.18],[0.38,0.28],[0.56,0.28],[0.34,0.42],[0.60,0.42],[0.32,0.56],[0.62,0.56],[0.40,0.52],[0.58,0.52],[0.32,0.70],[0.64,0.78],[0.28,0.90],[0.68,0.92]],
      [[0.46,0.15],[0.44,0.14],[0.48,0.14],[0.42,0.15],[0.50,0.15],[0.38,0.26],[0.56,0.26],[0.34,0.40],[0.60,0.40],[0.32,0.54],[0.62,0.54],[0.40,0.48],[0.58,0.48],[0.34,0.68],[0.62,0.72],[0.30,0.88],[0.66,0.92]],
    ],
  },
  bicep_curl: {
    fps: 8, color: '#06b6d4',
    frames: [
      [[0.50,0.08],[0.48,0.07],[0.52,0.07],[0.46,0.08],[0.54,0.08],[0.42,0.22],[0.58,0.22],[0.38,0.42],[0.62,0.42],[0.36,0.60],[0.64,0.60],[0.44,0.50],[0.56,0.50],[0.44,0.70],[0.56,0.70],[0.44,0.92],[0.56,0.92]],
      [[0.50,0.08],[0.48,0.07],[0.52,0.07],[0.46,0.08],[0.54,0.08],[0.42,0.22],[0.58,0.22],[0.36,0.40],[0.64,0.40],[0.32,0.28],[0.68,0.28],[0.44,0.50],[0.56,0.50],[0.44,0.70],[0.56,0.70],[0.44,0.92],[0.56,0.92]],
      [[0.50,0.08],[0.48,0.07],[0.52,0.07],[0.46,0.08],[0.54,0.08],[0.42,0.22],[0.58,0.22],[0.36,0.38],[0.64,0.38],[0.34,0.22],[0.66,0.22],[0.44,0.50],[0.56,0.50],[0.44,0.70],[0.56,0.70],[0.44,0.92],[0.56,0.92]],
      [[0.50,0.08],[0.48,0.07],[0.52,0.07],[0.46,0.08],[0.54,0.08],[0.42,0.22],[0.58,0.22],[0.36,0.40],[0.64,0.40],[0.32,0.28],[0.68,0.28],[0.44,0.50],[0.56,0.50],[0.44,0.70],[0.56,0.70],[0.44,0.92],[0.56,0.92]],
    ],
  },
  shoulder_press: {
    fps: 6, color: '#8b5cf6',
    frames: [
      [[0.50,0.08],[0.48,0.07],[0.52,0.07],[0.46,0.08],[0.54,0.08],[0.42,0.22],[0.58,0.22],[0.34,0.24],[0.66,0.24],[0.30,0.22],[0.70,0.22],[0.44,0.50],[0.56,0.50],[0.44,0.70],[0.56,0.70],[0.44,0.92],[0.56,0.92]],
      [[0.50,0.08],[0.48,0.07],[0.52,0.07],[0.46,0.08],[0.54,0.08],[0.42,0.22],[0.58,0.22],[0.36,0.14],[0.64,0.14],[0.34,0.06],[0.66,0.06],[0.44,0.50],[0.56,0.50],[0.44,0.70],[0.56,0.70],[0.44,0.92],[0.56,0.92]],
      [[0.50,0.08],[0.48,0.07],[0.52,0.07],[0.46,0.08],[0.54,0.08],[0.42,0.22],[0.58,0.22],[0.40,0.10],[0.60,0.10],[0.40,0.02],[0.60,0.02],[0.44,0.50],[0.56,0.50],[0.44,0.70],[0.56,0.70],[0.44,0.92],[0.56,0.92]],
      [[0.50,0.08],[0.48,0.07],[0.52,0.07],[0.46,0.08],[0.54,0.08],[0.42,0.22],[0.58,0.22],[0.36,0.14],[0.64,0.14],[0.34,0.06],[0.66,0.06],[0.44,0.50],[0.56,0.50],[0.44,0.70],[0.56,0.70],[0.44,0.92],[0.56,0.92]],
    ],
  },
  default: {
    fps: 4, color: '#6366f1',
    frames: [
      [[0.50,0.08],[0.48,0.07],[0.52,0.07],[0.46,0.08],[0.54,0.08],[0.42,0.22],[0.58,0.22],[0.38,0.38],[0.62,0.38],[0.36,0.52],[0.64,0.52],[0.44,0.50],[0.56,0.50],[0.44,0.72],[0.56,0.72],[0.44,0.92],[0.56,0.92]],
      [[0.50,0.08],[0.48,0.07],[0.52,0.07],[0.46,0.08],[0.54,0.08],[0.42,0.22],[0.58,0.22],[0.36,0.36],[0.64,0.36],[0.34,0.50],[0.66,0.50],[0.44,0.50],[0.56,0.50],[0.44,0.72],[0.56,0.72],[0.44,0.92],[0.56,0.92]],
    ],
  },
};

const CONNECTIONS = [
  [5,6],[5,7],[7,9],[6,8],[8,10],
  [5,11],[6,12],[11,12],
  [11,13],[13,15],[12,14],[14,16],
];

function interpolate(poseA, poseB, t) {
  return poseA.map((kpA, i) => {
    const kpB = poseB[i];
    return [kpA[0] + (kpB[0] - kpA[0]) * t, kpA[1] + (kpB[1] - kpA[1]) * t];
  });
}

function getExerciseKey(name) {
  const n = (name || '').toLowerCase().replace(/\s+/g, '_');
  if (n.includes('squat'))                           return 'squat';
  if (n.includes('push'))                            return 'push_up';
  if (n.includes('plank'))                           return 'plank';
  if (n.includes('lunge'))                           return 'lunge';
  if (n.includes('bicep') || n.includes('curl'))     return 'bicep_curl';
  if (n.includes('press') || n.includes('shoulder')) return 'shoulder_press';
  return 'default';
}

// Memoized: the parent (ActiveWorkout) re-renders ~30x/second from live
// keypoints, but this component's props (exercise name/size) change only on
// exercise transitions — memo removes ~30 wasted re-renders per second.
function ReferenceAnimation({
  exerciseName = '',
  isPlaying    = true,
  width        = 240,
  height       = 340,
}) {
  const canvasRef   = useRef(null);
  const frameRef    = useRef(0);
  const subFrameRef = useRef(0);

  const gifs        = getExerciseGifs(exerciseName);
  const exerciseKey = getExerciseKey(exerciseName);
  const { fps, color, frames } = POSE_SEQUENCES[exerciseKey] || POSE_SEQUENCES.default;
  const INTERP = 8;

  useEffect(() => {
    if (gifs.length > 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    frameRef.current    = 0;
    subFrameRef.current = 0;

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(17,17,27,0.97)';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(10, h * 0.93);
      ctx.lineTo(w - 10, h * 0.93);
      ctx.stroke();

      const fi   = frameRef.current % frames.length;
      const ni   = (fi + 1) % frames.length;
      const t    = subFrameRef.current / INTERP;
      const pose = interpolate(frames[fi], frames[ni], t);

      const lAnk = pose[15];
      const rAnk = pose[16];
      if (lAnk && rAnk) {
        const cx   = ((lAnk[0] + rAnk[0]) / 2) * w;
        const cy   = h * 0.93;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30);
        grad.addColorStop(0, color + '30');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 30, 6, 0, 0, 2 * Math.PI);
        ctx.fill();
      }

      ctx.lineCap     = 'round';
      ctx.lineWidth   = 3.5;
      ctx.globalAlpha = 0.92;
      for (const [i, j] of CONNECTIONS) {
        const a = pose[i];
        const b = pose[j];
        if (!a || !b) continue;
        const grad = ctx.createLinearGradient(a[0]*w, a[1]*h, b[0]*w, b[1]*h);
        grad.addColorStop(0, color);
        grad.addColorStop(1, color + 'cc');
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(a[0]*w, a[1]*h);
        ctx.lineTo(b[0]*w, b[1]*h);
        ctx.stroke();
      }

      ctx.globalAlpha = 1.0;
      for (let i = 0; i < pose.length; i++) {
        const kp = pose[i];
        if (!kp) continue;
        const x = kp[0] * w;
        const y = kp[1] * h;
        ctx.beginPath(); ctx.arc(x, y, 8, 0, 2*Math.PI);
        ctx.fillStyle = color + '35'; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 5, 0, 2*Math.PI);
        ctx.fillStyle = color; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 2*Math.PI);
        ctx.fillStyle = '#ffffff'; ctx.fill();
      }

      ctx.globalAlpha = 0.45;
      ctx.fillStyle   = '#ffffff';
      ctx.font        = 'bold 10px system-ui, sans-serif';
      ctx.textAlign   = 'center';
      ctx.fillText('REFERENCE', w/2, h - 7);
      ctx.globalAlpha = 1.0;

      if (isPlaying) {
        subFrameRef.current += 1;
        if (subFrameRef.current >= INTERP) {
          subFrameRef.current = 0;
          frameRef.current    = (frameRef.current + 1) % frames.length;
        }
      }
    };

    const id = setInterval(draw, 1000 / (fps * INTERP / 2));
    return () => clearInterval(id);
  }, [exerciseName, isPlaying, gifs.length]);

  // ── GIF carousel mode ─────────────────────────────────────────────────────
  if (gifs.length > 0) {
    return (
      <div className="flex-shrink-0" style={{ width, height }}>
        <GifCarousel
          gifs={gifs}
          interval={3500}
          playing={isPlaying}
          alt={exerciseName}
          rounded="rounded-xl"
          bg="rgba(17,17,27,0.97)"
        />
      </div>
    );
  }

  // ── Skeleton canvas fallback ───────────────────────────────────────────────
  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="rounded-xl"
      style={{ background: 'rgba(17,17,27,0.97)' }}
    />
  );
}

export default memo(ReferenceAnimation);
