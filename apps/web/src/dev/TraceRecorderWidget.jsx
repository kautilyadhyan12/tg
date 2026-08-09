/**
 * DEV-ONLY floating trace-recorder control (P1.3). Renders nothing unless
 * VITE_TRACE_RECORD=1. Self-contained: fixed-position overlay, no coupling to
 * ActiveWorkout's layout or state beyond the exercise slug prop.
 */
import { useState } from 'react';
import {
  TRACE_RECORD_ENABLED,
  definitionIdFor,
  isRecording,
  startRecording,
  stopRecording,
  frameCount,
  detectionCount,
} from './traceRecorder';
import { describeTuning, isTuned, readPoseTuning } from './poseTuning';

export default function TraceRecorderWidget({ exercise }) {
  const [, force] = useState(0);
  const [summary, setSummary] = useState(null);

  if (!TRACE_RECORD_ENABLED) return null;

  const recording = isRecording();
  const tuning = readPoseTuning();

  const onClick = () => {
    if (!recording) {
      startRecording(exercise);
      setSummary(null);
    } else {
      const label = window.prompt('Trace label (e.g. clean_10_reps, fault_shallow, occlusion):', 'unlabeled') || 'unlabeled';
      const view = window.prompt('View (side / front):', 'side') || 'unknown';
      const device = window.prompt('Device (e.g. laptop-720p):', 'laptop') || 'unknown';
      setSummary(stopRecording({ label, view, device }));
    }
    force((n) => n + 1);
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        left: 12,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.75)',
        color: '#fff',
        padding: '8px 12px',
        borderRadius: 8,
        fontSize: 12,
        fontFamily: 'monospace',
      }}
    >
      <button
        onClick={onClick}
        style={{
          background: recording ? '#d33' : '#2a2',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          padding: '4px 10px',
          cursor: 'pointer',
        }}
      >
        {recording ? `■ stop & download (${detectionCount()} frames)` : '● record trace'}
      </button>
      <div style={{ marginTop: 4 }}>
        {/* BOTH counts, because on a clip of an empty room the second is
            SUPPOSED to be 0 and only the first says the recorder is alive.
            Showing frames-with-a-pose alone made a working recorder look
            broken in exactly the case worth recording. */}
        {recording
          ? `recording ${definitionIdFor(exercise)}… ${frameCount()} with a person`
          : summary
            ? `saved: ${summary.detections} frames, ${summary.withPose} with a person, ` +
              `${summary.reps} reps @ ${summary.fps}fps`
            : 'trace recorder (dev)'}
      </div>
      {/* THE SETTINGS, ON SCREEN, ALWAYS — not only when they are non-default.
          This line used to render only when tuned, and that cost Kd a whole
          session: his eight clips all recorded at the defaults because the
          router had stripped the query string, and the check he had been given
          was "look for a yellow line and stop if it is MISSING". He did not
          notice the absence and recorded all eight. **Asking someone to spot a
          missing thing is not a check.** Two visible lines can be compared;
          one absent line cannot be. Colour still marks the difference, and the
          word `default` is spelled out so a screenshot is self-explanatory. */}
      <div style={{ marginTop: 4, color: isTuned(tuning) ? '#ffd166' : '#8a8a8a' }}>
        ⚙ {describeTuning(tuning)}
        {isTuned(tuning) ? '' : '  (default)'}
      </div>
    </div>
  );
}
