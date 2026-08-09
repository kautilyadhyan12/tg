/**
 * traceRecorder — the camera card's MEASURING INSTRUMENT, so it gets tests.
 *
 * It had none. That matters more here than it usually would: this card cannot
 * choose any threshold from judgement (the OWED line forbids it), so every
 * number it eventually uses comes out of clips this file produces. An
 * instrument that silently drops the most important clip would not fail loudly
 * — it would hand back a smaller, plausible measurement, which is the exact
 * shape this project has been burned by repeatedly.
 *
 * THE DEFECT THESE PIN: a clip in which the model never finds a pose — an EMPTY
 * ROOM, which is the control the whole card rests on — recorded NOTHING and
 * downloaded NOTHING, because frames without a pose returned before the time
 * origin was ever set. "The camera saw no one" and "the recorder was not
 * running" produced identical output: none.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const KP33 = () => Array.from({ length: 33 }, (_, i) => [0.5, 0.5, 0, i < 12 ? 0.99 : 0.01]);

let downloads;
let lastBlob;
let hadDocument;

beforeEach(() => {
  downloads = [];
  lastBlob = null;
  // The recorder stamps the pose settings into every header, and those live in
  // sessionStorage (poseTuning.js), which the `node` environment does not have.
  // A minimal real-behaviour stand-in rather than jsdom: this file hand-builds
  // `document` for the download path, and a real DOM would fight it. The
  // storage SEMANTICS are covered in poseTuning.test.js, which runs in jsdom.
  const cells = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (cells.has(k) ? cells.get(k) : null),
    setItem: (k, v) => cells.set(k, String(v)),
    removeItem: (k) => cells.delete(k),
    clear: () => cells.clear(),
  };
  globalThis.Blob = class {
    constructor(parts) {
      this._text = parts.join('');
    }
  };
  globalThis.URL.createObjectURL = (blob) => {
    lastBlob = blob;
    return 'blob:fake';
  };
  globalThis.URL.revokeObjectURL = () => {};
  hadDocument = 'document' in globalThis;
  globalThis.document = {
    createElement: () => ({
      href: '',
      download: '',
      click() {
        downloads.push({ name: this.download, text: lastBlob._text });
      },
    }),
  };
});

afterEach(() => {
  if (!hadDocument) delete globalThis.document;
  vi.unstubAllEnvs();
});

/** The module reads VITE_TRACE_RECORD once at import, so the flag must be
 *  stubbed BEFORE the import — hence a fresh module per test. */
async function loadRecorder() {
  vi.stubEnv('VITE_TRACE_RECORD', '1');
  vi.resetModules();
  return import('./traceRecorder.js');
}

function fileNamed(suffix) {
  return downloads.find((d) => d.name.endsWith(suffix));
}

function linesOf(text) {
  return text.trim().split('\n');
}

describe('traceRecorder', () => {
  it('records a clip in which the model NEVER finds a pose', async () => {
    const rec = await loadRecorder();
    rec.startRecording('squat');
    for (let i = 0; i < 30; i++) rec.recordFrame([], 1000 + i * 67);
    const summary = rec.stopRecording({ label: 'empty_room', view: 'side', device: 'laptop' });

    // Without the fix this is null and NOTHING downloads — the empty-room
    // control, the one clip that answers "does it draw a person on furniture",
    // would have come back as an absence indistinguishable from operator error.
    expect(summary).not.toBeNull();
    expect(summary.detections).toBe(30);
    expect(summary.withPose).toBe(0);

    const detect = fileNamed('.detect.jsonl');
    expect(detect, 'a .detect.jsonl must be written').toBeDefined();
    const rows = linesOf(detect.text).map((l) => JSON.parse(l));
    expect(rows).toHaveLength(30);
    expect(rows.every((r) => r.n === 0)).toBe(true);
    // Time is anchored to the clip, not to a pose frame that never arrived.
    expect(rows[0].t).toBe(0);
    expect(rows[29].t).toBeCloseTo(29 * 67, 1);
  });

  it('separates frames offered from frames carrying a pose', async () => {
    const rec = await loadRecorder();
    rec.startRecording('squat');
    rec.recordFrame([], 0);
    rec.recordFrame(KP33(), 67);
    rec.recordFrame([], 134);
    rec.recordFrame(KP33(), 201);
    const summary = rec.stopRecording({ label: 'mixed', view: 'side', device: 'laptop' });

    expect(summary.detections).toBe(4);
    expect(summary.withPose).toBe(2);
    expect(summary.frames).toBe(2);

    const rows = linesOf(fileNamed('.detect.jsonl').text).map((l) => JSON.parse(l));
    expect(rows.map((r) => r.n)).toEqual([0, 33, 0, 33]);

    // The trace itself still carries ONLY full poses — the §7.1 format is
    // unchanged, so these clips stay replayable by the existing harness.
    const traceLines = linesOf(fileNamed('-mixed.jsonl').text);
    expect(traceLines).toHaveLength(3); // header + 2 pose frames
    for (const line of traceLines.slice(1)) {
      expect(JSON.parse(line).kp).toHaveLength(33);
    }
  });

  it('does not let leading empty frames shift the trace time axis', async () => {
    const rec = await loadRecorder();
    rec.startRecording('squat');
    // Five frames of nobody there, THEN the person walks in.
    for (let i = 0; i < 5; i++) rec.recordFrame([], i * 67);
    rec.recordFrame(KP33(), 5 * 67);
    rec.recordFrame(KP33(), 6 * 67);
    rec.stopRecording({ label: 'walkin', view: 'side', device: 'laptop' });

    const traceLines = linesOf(fileNamed('-walkin.jsonl').text);
    const first = JSON.parse(traceLines[1]);
    const second = JSON.parse(traceLines[2]);
    // The trace is timed from the first POSE (t=0), so a clip that starts with
    // an empty room does not report a stretched duration or a collapsed fps —
    // which would quietly push a newly recorded golden outside the 8-40 fps
    // contract that validate-trace.ts enforces.
    expect(first.t).toBe(0);
    expect(second.t).toBeCloseTo(67, 1);

    // ...while the detect log IS timed from the clip, and so still shows that
    // the first five frames had nobody in them.
    const rows = linesOf(fileNamed('.detect.jsonl').text).map((l) => JSON.parse(l));
    expect(rows[0]).toEqual({ t: 0, n: 0 });
    expect(rows[5].n).toBe(33);
  });

  it('writes no empty legacy responses sidecar', async () => {
    const rec = await loadRecorder();
    rec.startRecording('squat');
    rec.recordFrame(KP33(), 0);
    rec.stopRecording({ label: 'plain', view: 'side', device: 'laptop' });

    // The Python analyzer that fed it is gone, so this file is always empty
    // now. One junk file per clip is a file the person recording has to
    // identify and discard.
    expect(fileNamed('.responses.jsonl')).toBeUndefined();
    expect(fileNamed('.detect.jsonl')).toBeDefined();
  });

  // ── The slug, and the settings a clip was recorded under (card 2) ─────────
  //
  // THE DEFECT THESE PIN: the recorder stamped the workout's DISPLAY name
  // (`squats`) into the header while definitions are keyed `squat.json`, so
  // measure-pose.ts threw ENOENT and its engine-replay section — the whole
  // point of the script — silently did not run on ANY of Kd's five clips,
  // underneath two sections that had rendered normally.
  it('stamps the DEFINITION ID in the header, not the display name', async () => {
    const rec = await loadRecorder();
    rec.startRecording('squats'); // what ActiveWorkout actually passes
    rec.recordFrame(KP33(), 0);
    rec.stopRecording({ label: 'slug', view: 'side', device: 'laptop' });

    const header = JSON.parse(linesOf(fileNamed('-slug.jsonl').text)[0]);
    // `squat.json` — loadable by filename. `squats` was not, and that is the bug.
    expect(header.exercise).toBe('squat');
  });

  it('leaves an exercise with no definition alone rather than inventing a key', async () => {
    // 55 of the 58 have no engine definition. There is nothing to be canonical
    // about, and guessing a singular would be the `slugForLegacyName` mistake
    // (:3538 — exact match, or null; never a guess).
    const rec = await loadRecorder();
    rec.startRecording('bicep_curls');
    rec.recordFrame(KP33(), 0);
    rec.stopRecording({ label: 'nodef', view: 'side', device: 'laptop' });

    const header = JSON.parse(linesOf(fileNamed('-nodef.jsonl').text)[0]);
    expect(header.exercise).toBe('bicep_curls');
  });

  it('records WHICH camera settings produced the clip', async () => {
    const rec = await loadRecorder();
    rec.startRecording('squat');
    rec.recordFrame(KP33(), 0);
    rec.stopRecording({ label: 'settings', view: 'side', device: 'laptop' });

    const header = JSON.parse(linesOf(fileNamed('-settings.jsonl').text)[0]);
    // Card 3 records one scene several times under different settings. A clip
    // that cannot name its own settings makes the comparison rest on filenames.
    expect(header.provider).toEqual({
      model: 'lite',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  });

  it('captures the settings at START, so a mid-clip change cannot relabel it', async () => {
    const { capturePoseTuning } = await import('./poseTuning.js');
    const rec = await loadRecorder();
    capturePoseTuning('?detectConf=0.9');
    rec.startRecording('squat');
    // Someone opens a differently-tuned address while the clip is running. The
    // model in memory was built at 0.9 and is STILL running at 0.9, so a header
    // that said 0.1 would be describing a recording that never happened.
    capturePoseTuning('?detectConf=0.1');
    rec.recordFrame(KP33(), 0);
    rec.stopRecording({ label: 'midedit', view: 'side', device: 'laptop' });

    const header = JSON.parse(linesOf(fileNamed('-midedit.jsonl').text)[0]);
    expect(header.provider.minPoseDetectionConfidence).toBe(0.9);
  });

  it('stays inert when the dev flag is off', async () => {
    vi.stubEnv('VITE_TRACE_RECORD', '0');
    vi.resetModules();
    const rec = await import('./traceRecorder.js');
    rec.startRecording('squat');
    rec.recordFrame(KP33(), 0);
    expect(rec.isRecording()).toBe(false);
    expect(rec.stopRecording({ label: 'x' })).toBeNull();
    expect(downloads).toHaveLength(0);
  });
});
