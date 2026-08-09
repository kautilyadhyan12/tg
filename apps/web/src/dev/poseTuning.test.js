/**
 * @vitest-environment jsdom
 *
 * jsdom, not node, because this module remembers settings in sessionStorage —
 * see the router block below. The node default has no storage at all, so a node
 * run would exercise only the graceful-degradation path and prove nothing about
 * the behaviour that actually failed in Kd s browser.
 */
/**
 * poseTuning — DEV-ONLY MediaPipe settings from the URL.
 *
 * WHY THESE MATTER MORE THAN THEY LOOK. This module decides what the pose model
 * is actually configured with. Two failure directions, and both are silent:
 *   - a bad URL value quietly REPLACING a shipped default would change what the
 *     camera does with nobody noticing, and card 3's whole point is comparing
 *     runs whose settings are known;
 *   - the gate leaking into a PRODUCTION build would let a query string
 *     reconfigure a real user's camera.
 * Neither shows up on screen, so neither would be caught by a smoke test.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MODEL_NAMES,
  POSE_DEFAULTS,
  describeTuning,
  isTuned,
  modelUrls,
  parsePoseTuning,
  capturePoseTuning,
  hasTuningParams,
  readPoseTuning,
} from './poseTuning';

describe('parsePoseTuning', () => {
  it('returns exactly the shipped defaults when the URL says nothing', () => {
    // These four numbers ARE what usePoseDetection hard-wired before this
    // module existed. If this test ever has to change, shipped behaviour
    // changed with it — which is a decision, not a refactor.
    expect(parsePoseTuning('')).toEqual({
      model: 'lite',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  });

  it('reads every dial the recording session needs', () => {
    const t = parsePoseTuning(
      '?model=full&numPoses=2&detectConf=0.9&presenceConf=0.7&trackConf=0.95',
    );
    expect(t).toEqual({
      model: 'full',
      numPoses: 2,
      minPoseDetectionConfidence: 0.9,
      minPosePresenceConfidence: 0.7,
      minTrackingConfidence: 0.95,
    });
  });

  it('falls back to the default for a value out of range, never clamps silently to an edge', () => {
    // A clamp would turn `detectConf=5` into 1.0 — a REAL setting nobody asked
    // for, recorded in the header as deliberate. Falling back to the default is
    // the honest reading of a typo.
    expect(parsePoseTuning('?detectConf=5').minPoseDetectionConfidence).toBe(0.5);
    expect(parsePoseTuning('?detectConf=-1').minPoseDetectionConfidence).toBe(0.5);
    expect(parsePoseTuning('?detectConf=banana').minPoseDetectionConfidence).toBe(0.5);
    expect(parsePoseTuning('?trackConf=').minTrackingConfidence).toBe(0.5);
  });

  it('refuses a non-integer or absurd numPoses', () => {
    expect(parsePoseTuning('?numPoses=1.5').numPoses).toBe(1);
    expect(parsePoseTuning('?numPoses=0').numPoses).toBe(1);
    expect(parsePoseTuning('?numPoses=99').numPoses).toBe(1);
  });

  it('accepts ONLY the three published model names', () => {
    for (const name of MODEL_NAMES) {
      expect(parsePoseTuning(`?model=${name}`).model).toBe(name);
    }
    expect(parsePoseTuning('?model=turbo').model).toBe('lite');
    expect(parsePoseTuning('?model=../../etc/passwd').model).toBe('lite');
  });

  it('accepts 0 and 1, which are real settings and not "missing"', () => {
    // `Number('0')` is falsy — a `||` fallback would silently turn "trust
    // nothing" into the default, and 0/1 are exactly the extremes card 3 wants
    // to sweep.
    expect(parsePoseTuning('?detectConf=0').minPoseDetectionConfidence).toBe(0);
    expect(parsePoseTuning('?detectConf=1').minPoseDetectionConfidence).toBe(1);
  });
});

describe('modelUrls', () => {
  it('builds both URLs from the variant, never from the raw query value', () => {
    const full = modelUrls('full');
    expect(full.local).toBe('/models/pose_landmarker_full.task');
    expect(full.remote).toContain('pose_landmarker_full/float16/1/pose_landmarker_full.task');
  });

  it('falls back to lite for an unknown variant rather than fetching a bad path', () => {
    expect(modelUrls('turbo').local).toBe(modelUrls('lite').local);
  });

  it('keeps the lite URLs byte-identical to what the app shipped', () => {
    // The exact two strings usePoseDetection carried before this module. A
    // change here changes which model every user downloads.
    expect(modelUrls('lite')).toEqual({
      local: '/models/pose_landmarker_lite.task',
      remote:
        'https://storage.googleapis.com/mediapipe-models/' +
        'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    });
  });
});

describe('isTuned / describeTuning', () => {
  it('is false for the defaults, so the widget stays quiet on a normal run', () => {
    expect(isTuned(parsePoseTuning(''))).toBe(false);
  });

  it('is true when ANY single dial has moved', () => {
    for (const q of ['?model=full', '?numPoses=2', '?detectConf=0.9', '?presenceConf=0.9', '?trackConf=0.9']) {
      expect(isTuned(parsePoseTuning(q)), q).toBe(true);
    }
  });

  it('names every dial, so a screenshot of the widget is a complete record', () => {
    const text = describeTuning(parsePoseTuning('?model=full&numPoses=2&detectConf=0.9'));
    expect(text).toContain('full');
    expect(text).toContain('n=2');
    expect(text).toContain('det=0.9');
    expect(text).toContain('pres=0.5');
    expect(text).toContain('track=0.5');
  });
});

// ── Surviving the router (the defect that cost Kd a whole recording session) ──
//
// All eight of his clips on 2026-08-09 recorded at the DEFAULTS, from four
// different addresses, because `App.jsx` sends `/` to
// `<Navigate to="/login" replace />` and a bare react-router path carries no
// search string. The settings were gone before login, long before the camera
// read anything. Only the `provider` stamp in the trace header revealed it.
describe('capturePoseTuning / readPoseTuning — surviving the router', () => {
  beforeEach(() => sessionStorage.clear());

  it('remembers settings after the URL that carried them is gone', () => {
    capturePoseTuning('?detectConf=0.9&trackConf=0.9');
    // The router has now navigated to /login and the query string is history.
    expect(readPoseTuning().minPoseDetectionConfidence).toBe(0.9);
    expect(readPoseTuning().minTrackingConfidence).toBe(0.9);
  });

  it('a later page load naming NOTHING does not wipe what was captured', () => {
    // This is the whole point: every navigation after the first names nothing.
    capturePoseTuning('?model=full');
    capturePoseTuning('');
    capturePoseTuning('?someUnrelatedParam=1');
    expect(readPoseTuning().model).toBe('full');
  });

  it('an explicit request REPLACES what was captured, so defaults are reachable', () => {
    capturePoseTuning('?model=full&detectConf=0.9');
    capturePoseTuning('?model=lite');
    const t = readPoseTuning();
    expect(t.model).toBe('lite');
    // ...and the dials it did not name go back to default rather than lingering.
    expect(t.minPoseDetectionConfidence).toBe(0.5);
  });

  it('returns the defaults when nothing was ever captured', () => {
    expect(readPoseTuning()).toEqual(POSE_DEFAULTS);
  });

  it('re-validates on the way OUT — storage is hand-editable external input', () => {
    sessionStorage.setItem(
      'aihg.poseTuning',
      JSON.stringify({ model: 'turbo', numPoses: 99, minPoseDetectionConfidence: 7 }),
    );
    expect(readPoseTuning()).toEqual(POSE_DEFAULTS);
  });

  it('survives garbage in storage without throwing', () => {
    sessionStorage.setItem('aihg.poseTuning', 'not json at all');
    expect(readPoseTuning()).toEqual(POSE_DEFAULTS);
  });
});

describe('hasTuningParams', () => {
  it('distinguishes "asked for nothing" from "asked for the defaults"', () => {
    // Treating those the same is what would let a plain reload wipe the capture.
    expect(hasTuningParams('')).toBe(false);
    expect(hasTuningParams('?foo=1')).toBe(false);
    expect(hasTuningParams('?model=lite')).toBe(true);
    expect(hasTuningParams('?detectConf=0.5')).toBe(true);
  });
});
