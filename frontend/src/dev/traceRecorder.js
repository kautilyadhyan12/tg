/**
 * traceRecorder.js — DEV-ONLY golden-trace recorder (task P1.3, spec Part 2 §7.2).
 *
 * Active only when VITE_TRACE_RECORD=1. Tees (a) the exact keypoint frames the
 * hook sends to the server and (b) every server response, then downloads:
 *
 *   <exercise>-<label>.jsonl            — §7.1 trace: header line + PoseFrame/line
 *   <exercise>-<label>.responses.jsonl  — sidecar: full per-frame Python outputs
 *                                          (the §7.5 parity source of truth)
 *
 * The header's `expected` block is auto-filled with what is unambiguous from
 * the Python outputs (final rep count; score range observed while active).
 * faultsExact starts EMPTY and is authored during P1.8b from the sidecar —
 * Python emits per-frame correction strings, not per-rep fault ids, and that
 * mapping is exactly what the P1.8a constants-inventory review pins down.
 *
 * Frame `t` is remapped to session-relative monotonic ms (first frame = 0):
 * the engine contract (§2.1) — wall-clock never enters the file.
 */

export const TRACE_RECORD_ENABLED = import.meta.env.VITE_TRACE_RECORD === '1';

const state = {
  recording: false,
  exercise: null,
  t0: null,
  frames: [],       // { t, kp }
  responses: [],    // { t, ...server response }
  startedAt: null,  // for fps calc only (duration), not stored per-frame
};

export function isRecording() {
  return state.recording;
}

export function frameCount() {
  return state.frames.length;
}

export function startRecording(exercise) {
  if (!TRACE_RECORD_ENABLED) return;
  state.recording = true;
  state.exercise = exercise;
  state.t0 = null;
  state.frames = [];
  state.responses = [];
}

/** Called with the EXACT keypoints array sent to the server (33×[x,y,z,vis]). */
export function recordFrame(keypoints, nowMs) {
  if (!state.recording || !Array.isArray(keypoints) || keypoints.length !== 33) return;
  if (state.t0 === null) state.t0 = nowMs;
  state.frames.push({ t: +(nowMs - state.t0).toFixed(1), kp: keypoints });
}

/** Called with every non-keepalive server message (the Python analyzer output). */
export function recordResponse(data, nowMs) {
  if (!state.recording) return;
  const t = state.t0 === null ? 0 : +(nowMs - state.t0).toFixed(1);
  state.responses.push({ t, ...data });
}

function download(name, text) {
  const blob = new Blob([text], { type: 'application/x-ndjson' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Stop and download trace + sidecar.
 * meta: { label, view, device } — label/view authored by the human recording
 * (§7.1: "expected is authored by you watching the video once").
 */
export function stopRecording(meta) {
  if (!state.recording) return null;
  state.recording = false;

  const frames = state.frames;
  const responses = state.responses;
  if (frames.length === 0) return null;

  const durationMs = frames[frames.length - 1].t;
  const fps = durationMs > 0 ? +((frames.length - 1) / (durationMs / 1000)).toFixed(1) : 0;

  const last = responses[responses.length - 1] || {};
  const activeScores = responses
    .filter((r) => r.is_active && typeof r.form_score === 'number')
    .map((r) => r.form_score);
  const scoreLo = activeScores.length ? Math.min(...activeScores) : 0;
  const scoreHi = activeScores.length ? Math.max(...activeScores) : 100;

  const header = {
    traceVersion: 1,
    exercise: state.exercise,
    recordedWith: { engine: 'python-parity', defs: 0 },
    device: meta.device || 'unknown',
    platform: 'web',
    fps,
    view: meta.view || 'unknown',
    label: meta.label || 'unlabeled',
    expected: {
      reps: typeof last.rep_count === 'number' ? last.rep_count : 0,
      // Authored in P1.8b from the sidecar (python corrections → TS fault ids):
      faultsExact: {},
      scoreRange: [scoreLo, scoreHi],
      formCorrectAll: responses.every((r) => r.form_correct !== false),
    },
  };

  const traceText =
    [JSON.stringify(header), ...frames.map((f) => JSON.stringify(f))].join('\n') + '\n';
  const sidecarText = responses.map((r) => JSON.stringify(r)).join('\n') + '\n';

  const base = `${state.exercise}-${header.label}`.replace(/[^a-z0-9_-]/gi, '_');
  download(`${base}.jsonl`, traceText);
  download(`${base}.responses.jsonl`, sidecarText);

  return { frames: frames.length, responses: responses.length, reps: header.expected.reps, fps };
}
