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

import { getDefinition } from '../engine/poseAdapter';
import { readPoseTuning } from './poseTuning';

export const TRACE_RECORD_ENABLED = import.meta.env.VITE_TRACE_RECORD === '1';

/**
 * The header's `exercise` must be a DEFINITION ID, not a display name.
 *
 * THE DEFECT THIS CLOSES (OWED, "the measuring instrument silently skipped its
 * own main section"). The caller hands over the workout's display name lowered
 * and underscored — `squats` — and the app works anyway, because `squat.json`
 * declares `squats` as an alias, so the ENGINE resolves it. The trace header
 * does not get that help: `measure-pose.ts` loads `definitions/<exercise>.json`
 * by filename, got ENOENT on all five of Kd's clips, and the engine-replay
 * section — the whole point of the script — did not run, underneath two
 * sections that had rendered normally.
 *
 * Spec §7.1's own header example writes `"exercise": "squat"`, so this is the
 * format being obeyed rather than a convention being invented.
 *
 * Resolution goes through the SAME lookup the engine uses, so the two can never
 * disagree about which definition a clip belongs to. An exercise with no
 * definition (55 of the 58) keeps its raw slug: there is nothing to be
 * canonical about, and the clip is still worth having as raw pose data.
 */
export function definitionIdFor(exercise) {
  return getDefinition(exercise)?.key ?? exercise;
}

const state = {
  recording: false,
  exercise: null,
  t0: null,         // CLIP origin — the first frame offered, of any kind
  frameT0: null,    // TRACE origin — the first frame carrying a pose
  frames: [],       // { t, kp }   — 33-landmark frames only (§7.1 format)
  detections: [],   // { t, n }    — EVERY frame offered, including n = 0
  responses: [],    // { t, ...server response }
  startedAt: null,  // for fps calc only (duration), not stored per-frame
  tuning: null,     // the MediaPipe settings this clip was recorded under
};

export function isRecording() {
  return state.recording;
}

export function frameCount() {
  return state.frames.length;
}

/** Frames the loop OFFERED, whether or not the model found a pose in them.
 *  `frameCount()` counts only the ones with a pose, so on a clip of an empty
 *  room the two differ — which is the entire point of recording one. */
export function detectionCount() {
  return state.detections.length;
}

export function startRecording(exercise) {
  if (!TRACE_RECORD_ENABLED) return;
  state.recording = true;
  state.exercise = definitionIdFor(exercise);
  // Captured at START, not at stop: the settings are read once when MediaPipe
  // is created, and reading them at stop would report whatever the URL says by
  // then. A clip attributed to settings it was not recorded under is worse than
  // one with no settings at all.
  state.tuning = readPoseTuning(
    typeof window === 'undefined' ? '' : window.location.search,
  );
  state.t0 = null;
  state.frameT0 = null;
  state.frames = [];
  state.detections = [];
  state.responses = [];
}

/** Called with the EXACT keypoints array handed to the engine (33×[x,y,z,vis]),
 *  or an EMPTY array when the model found no pose in that frame.
 *
 *  Empty frames used to return here before recording anything, which made
 *  "the model saw nothing" and "the recorder was not running" the same file:
 *  a clip of an empty room downloaded as nothing at all, because `t0` was
 *  anchored to a 33-landmark frame that never arrived. Both are now logged —
 *  `detections` counts every frame offered, so absence of a pose is DATA.
 *
 *  Two origins, deliberately. `detections` is timed from the first frame of any
 *  kind (the clip), `frames` from the first frame with a pose (the trace), so
 *  the §7.1 trace this still emits is unchanged in shape and timing from before
 *  — leading empty frames do not shift its `t` axis or its measured fps. */
export function recordFrame(keypoints, nowMs) {
  if (!state.recording) return;
  const n = Array.isArray(keypoints) ? keypoints.length : 0;

  if (state.t0 === null) state.t0 = nowMs;
  state.detections.push({ t: +(nowMs - state.t0).toFixed(1), n });

  if (n !== 33) return;
  if (state.frameT0 === null) state.frameT0 = nowMs;
  state.frames.push({ t: +(nowMs - state.frameT0).toFixed(1), kp: keypoints });
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
  const detections = state.detections;
  const responses = state.responses;
  // Only a clip where the loop never ran at all is nothing. A clip with frames
  // but NO pose in any of them is a result — it is what an empty room looks
  // like, and returning null here would have thrown that measurement away.
  if (frames.length === 0 && detections.length === 0) return null;

  const durationMs = frames.length > 0 ? frames[frames.length - 1].t : 0;
  const fps =
    frames.length > 1 && durationMs > 0
      ? +((frames.length - 1) / (durationMs / 1000)).toFixed(1)
      : 0;

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
    // WHICH SETTINGS PRODUCED THIS CLIP. Card 3 records the same two scenes
    // under several candidate settings; without this a clip cannot be told
    // apart from one recorded under different ones, and the whole comparison
    // rests on the operator's filenames. "A record is a claim" (:1173) applies
    // to a clip exactly as it does to a comment. Optional in the trace format,
    // so every existing golden is unaffected.
    provider: state.tuning === null ? undefined : { ...state.tuning },
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
  const detectText = detections.map((d) => JSON.stringify(d)).join('\n') + '\n';

  const base = `${state.exercise}-${header.label}`.replace(/[^a-z0-9_-]/gi, '_');
  download(`${base}.jsonl`, traceText);
  download(`${base}.detect.jsonl`, detectText);
  // The responses sidecar is the LEGACY Python analyzer's output, and that
  // server is gone (`recordResponse` has no caller since the WS path was
  // deleted), so this array is now always empty. Downloading an empty file per
  // clip is a file the recorder's operator has to identify and discard; write
  // it only if something ever feeds it again.
  if (responses.length > 0) {
    download(`${base}.responses.jsonl`, responses.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }

  return {
    frames: frames.length,
    detections: detections.length,
    withPose: detections.filter((d) => d.n === 33).length,
    responses: responses.length,
    reps: header.expected.reps,
    fps,
  };
}
