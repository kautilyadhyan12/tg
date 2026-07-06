import { useEffect, useRef } from 'react';

// MediaPipe BlazePose skeleton connections (33 keypoints)
// Replaces the old COCO-17 connections.
const CONNECTIONS = [
  // Arms
  [11, 13], [13, 15],  // left shoulder → elbow → wrist
  [12, 14], [14, 16],  // right shoulder → elbow → wrist
  // Shoulders
  [11, 12],
  // Torso
  [11, 23], [12, 24], [23, 24],
  // Left leg
  [23, 25], [25, 27],
  // Right leg
  [24, 26], [26, 28],
  // Feet
  [27, 29], [27, 31],
  [28, 30], [28, 32],
];

const KEYPOINT_COLORS = {
  correct:   '#22c55e',  // green
  incorrect: '#ef4444',  // red
  neutral:   '#6366f1',  // purple
};

export default function PoseOverlay({
  keypoints   = [],
  formCorrect = false,
  repState    = 'up',
  width       = 640,
  height      = 480,
  mirrored    = false,
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !keypoints || keypoints.length === 0) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (mirrored) {
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    const color = repState === 'down'
      ? (formCorrect ? KEYPOINT_COLORS.correct : KEYPOINT_COLORS.incorrect)
      : KEYPOINT_COLORS.neutral;

    const w = canvas.width;
    const h = canvas.height;

    // ── Draw skeleton lines ───────────────────────────────────────────────────
    ctx.strokeStyle = color;
    ctx.lineWidth   = 4;
    ctx.globalAlpha = 0.95;
    ctx.lineCap     = 'round';

    for (const [i, j] of CONNECTIONS) {
      const kpA = keypoints[i];
      const kpB = keypoints[j];

      if (!kpA || !kpB) continue;

      // MediaPipe keypoints are [x, y, z, visibility] — confidence at index 3
      const visA = kpA.length >= 4 ? kpA[3] : kpA[2];
      const visB = kpB.length >= 4 ? kpB[3] : kpB[2];
      if (visA < 0.3 || visB < 0.3) continue;

      ctx.beginPath();
      ctx.moveTo(kpA[0] * w, kpA[1] * h);
      ctx.lineTo(kpB[0] * w, kpB[1] * h);
      ctx.stroke();
    }

    // ── Draw keypoint circles ─────────────────────────────────────────────────
    ctx.globalAlpha = 1.0;

    for (let i = 0; i < keypoints.length; i++) {
      const kp  = keypoints[i];
      if (!kp) continue;

      const vis = kp.length >= 4 ? kp[3] : kp[2];
      if (vis < 0.3) continue;

      const x = kp[0] * w;
      const y = kp[1] * h;

      // Outer glow
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      // Inner white dot
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }

    if (mirrored) {
      ctx.restore();
    }
  }, [keypoints, formCorrect, repState, width, height, mirrored]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0 w-full h-full"
      style={{ pointerEvents: 'none' }}
    />
  );
}
